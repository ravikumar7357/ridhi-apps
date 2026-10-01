/* ================= PAYOUTS: CC, EC, ADVANCE, SALARY SLIP =================
 *
 * This is the money. Four rules carry it, and every one of them exists because getting it wrong pays
 * somebody the wrong amount:
 *
 *  1. PAID ON WHAT CAME BACK, DATED BY WHEN IT CAME BACK. The figure is `receivedPieces`, and the
 *     row falls in a period by its `receivingDate` — not the issue date. Work issued in one
 *     fortnight and returned in the next belongs to the next.
 *
 *  2. A FROZEN FORTNIGHT RETURNS ITS SNAPSHOT, NOT A FRESH SUM. Once a half is frozen it has been
 *     paid; editing a rate afterwards must not move it. `pt_payoutFreezes` holds the locked rows per
 *     employer-type and month, per half, and they are returned verbatim.
 *
 *  3. CC IS PER PERSON, EC IS POOLED. A Company Contractor's payout is grouped by employee; an
 *     External Contractor's is grouped by article alone, because the money is settled with the firm.
 *     Using one shape for both would either split the EC bill or merge CC people together.
 *
 *  4. ADVANCES COME OFF THE FULL MONTH ONLY. They are recorded per employee per month, so applying
 *     them to a fortnight would deduct the same money twice.
 */
const PAY_TYPES = { cc: 'Company Contractor', ec: 'External Contractor' };

const payFreezeKey = (empType, yr, mo) => empType + '|' + yr + '-' + String(mo).padStart(2, '0');

/** Is this half (1 or 2), or the whole month (3), frozen? Legacy records with no `frozen` map
 *  counted as frozen, and that is kept — they were paid. */
function payFrozen(empType, yr, mo, period) {
  const r = (HR.freezes || {})[payFreezeKey(empType, yr, mo)];
  if (!r) return false;
  if (period === 3) return payFrozen(empType, yr, mo, 1) && payFrozen(empType, yr, mo, 2);
  if (r.frozen) return !!r.frozen[period];
  return !!(r.periods && r.periods[period]);
}

/** The locked rows for a half, or null when that half is still live. */
function payFrozenRows(empType, yr, mo, period) {
  const r = (HR.freezes || {})[payFreezeKey(empType, yr, mo)];
  if (!r || !r.periods) return null;
  if (r.frozen && !r.frozen[period]) return null;
  return r.periods[period] || null;
}

/**
 * The payout rows for one employer type and period.
 *   period 1 = the 1st to the 15th · 2 = the 16th to the end · 3 = both halves merged
 * A full month is NOT a single 1st-to-end sum: each half is taken frozen-or-live on its own, then
 * merged — otherwise freezing the first half and re-running the month would silently unfreeze it.
 */
function payRows(empType, period, yr, mo) {
  if (period === 3) {
    const merged = {};
    [1, 2].forEach(p => payRows(empType, p, yr, mo).forEach(x => {
      const key = empType === PAY_TYPES.cc
        ? `${x.empName}|${x.articleType}|${x.subtype}|${x.size}`
        : `${x.articleType}|${x.subtype}|${x.size}`;
      if (!merged[key]) merged[key] = { empName: x.empName, articleType: x.articleType, subtype: x.subtype, size: x.size, recvPcs: 0, amount: 0, rate: x.rate, _mixed: false };
      merged[key].recvPcs += x.recvPcs;
      /* The AMOUNTS are added, not re-multiplied. Re-pricing the merged pieces at one rate threw the
       * frozen half's figure away and paid it at today's rate — which defeats the whole point of
       * freezing a fortnight. (The old tool does re-multiply here; this is a deliberate departure.)
       * When the two halves were paid at different rates there is no single rate to show, and a
       * blended one would be a number nobody could check, so it is reported as mixed. */
      merged[key].amount += x.amount;
      if (merged[key].rate !== x.rate) merged[key]._mixed = true;
    }));
    return Object.values(merged).map(x => Object.assign({}, x, { rate: x._mixed ? null : x.rate }));
  }

  const frozen = payFrozenRows(empType, yr, mo, period);
  if (frozen) return frozen.map(x => Object.assign({}, x));

  const lastDay = new Date(yr, mo, 0).getDate();
  const [ds, de] = period === 1 ? [1, 15] : [16, lastDay];
  const g = {};
  (PT.base || []).forEach(r => {
    if (!r || r.empType !== empType) return;
    if (!r.receivingDate || !ptNum(r.receivedPieces)) return;
    const ms = ptDtMs(r.receivingDate); if (!ms) return;
    const d = new Date(ms);
    if (d.getFullYear() !== yr || d.getMonth() + 1 !== mo) return;
    if (d.getDate() < ds || d.getDate() > de) return;
    const rate = rateFor(r.articleType, r.articleSubtype, r.size, empType);
    const key = empType === PAY_TYPES.cc
      ? `${r.empName}|${r.articleType}|${r.articleSubtype}|${r.size}`
      : `${r.articleType}|${r.articleSubtype}|${r.size}`;
    if (!g[key]) g[key] = { empName: r.empName, articleType: r.articleType, subtype: r.articleSubtype, size: r.size, recvPcs: 0, rate };
    g[key].recvPcs += ptNum(r.receivedPieces);
  });
  return Object.values(g).map(x => Object.assign({}, x, { amount: x.recvPcs * x.rate }));
}

/** Advances recorded for one person in one month (YYYY-MM). */
const payAdvance = (name, ym) => (HR.adv || [])
  .filter(a => hrN(a.empName) === hrN(name) && a.ym === ym)
  .reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
const payAdvanceTotal = ym => (HR.adv || []).filter(a => a.ym === ym)
  .reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

const rs = v => 'Rs.' + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const payYM = () => $('hrMonth').value || dToday().slice(0, 7);
const payPeriod = () => parseInt($('hrPeriod').value, 10) || 3;
const payParts = () => { const [y, m] = payYM().split('-').map(Number); return { yr: y, mo: m }; };
const PER_LBL = { 1: '1st–15th', 2: '16th–end', 3: 'full month' };

/* ---- CC and EC payout ---- */

function renderPayout(kind) {
  const empType = PAY_TYPES[kind];
  const { yr, mo } = payParts(), per = payPeriod();
  const all = payRows(empType, per, yr, mo);
  // The employee list comes from the period's own rows, so it never offers somebody with nothing in it.
  if (kind === 'cc') {
    const people = [...new Set(all.map(r => r.empName).filter(Boolean))].sort();
    const cur = $('hrPayEmp').value;
    $('hrPayEmp').innerHTML = '<option value="">All employees</option>'
      + people.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('hrPayEmp').value = cur;
    if ($('hrPayEmp').value !== cur) $('hrPayEmp').value = '';
  }
  const who = kind === 'cc' ? $('hrPayEmp').value : '';
  const q = $('hrQ').value.trim().toLowerCase();
  const rows = all.filter(r => !who || r.empName === who)
    .filter(r => !q || [r.empName, r.articleType, r.subtype, r.size].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(a.empName || '').localeCompare(String(b.empName || ''))
      || String(a.articleType || '').localeCompare(String(b.articleType || '')));
  HR.rows = rows;

  const pcs = rows.reduce((s, r) => s + r.recvPcs, 0);
  const amt = rows.reduce((s, r) => s + r.amount, 0);
  const frozen = payFrozen(empType, yr, mo, per);
  $('hrFreeze').textContent = per === 3 ? 'Freeze a fortnight' : (frozen ? `Re-open ${PER_LBL[per]}` : `Freeze ${PER_LBL[per]}`);
  $('hrFreeze').disabled = per === 3 || !ME.admin;
  $('hrFreeze').title = per === 3
    ? 'The two halves are settled separately — pick a fortnight.'
    : (ME.admin ? 'Freezing locks these figures so a later rate change cannot move them.'
                : 'Only an admin can freeze or re-open a period.');
  const noRate = rows.filter(r => r.rate === 0).length;   // null is two rates, not a missing one

  let extra = '';
  // Advances are per month, so they come off the full month and nothing else.
  if (kind === 'cc' && per === 3) {
    const adv = payAdvanceTotal(payYM());
    if (adv > 0) extra = `<div class="metric"><div class="v" style="color:#C55A11">${rs(adv)}</div><div class="l">Advance paid</div></div>`
      + `<div class="metric"><div class="v" style="color:var(--accent)">${rs(amt - adv)}</div><div class="l">Net payable</div></div>`;
  }
  $('hrKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">${kind === 'cc' ? 'Company' : 'External'} Contractor payout — ${esc(payYM())} · ${PER_LBL[per]}</span>
      <span class="kpiwhen">${frozen ? 'frozen — settled figures' : 'live — not settled yet'}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Lines</div></div>
      <div class="metric"><div class="v">${nf(pcs)}</div><div class="l">Pieces received</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${rs(amt)}</div><div class="l">Payout</div></div>
      ${extra}
    </div></div>`;

  const cols = kind === 'cc'
    ? ['Employee', 'Article', 'Subtype', 'Size', 'Pieces', 'Rate', 'Amount']
    : ['Article', 'Subtype', 'Size', 'Pieces', 'Rate', 'Amount'];
  const numFrom = kind === 'cc' ? 4 : 3;
  const head = '<thead><tr>' + cols.map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= numFrom ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const body = rows.map(r => `<tr data-pay-group="${encodeURIComponent(JSON.stringify({
      empName: r.empName || '', articleType: r.articleType || '', subtype: r.subtype || '', size: r.size || '' }))}"`
    + ' style="cursor:pointer" title="Click to see which entries make up this line, and which were left out.">'
    + (kind === 'cc' ? `<td class="frz" style="text-align:left">${esc(r.empName)}</td><td>${esc(r.articleType)}</td>`
                     : `<td class="frz" style="text-align:left">${esc(r.articleType)}</td>`)
    + `<td>${esc(r.subtype)}</td><td>${esc(r.size)}</td>`
    + `<td class="num">${nf(r.recvPcs)}</td>`
    /* A rate of zero is not a free article — it is a rate nobody has entered. Said, not shown as 0. */
    /* null means the two halves were paid at DIFFERENT rates, which is not the same as no rate at
     * all. A blended figure would be a number nobody could check, so it says so. */
    + `<td class="num"${r.rate == null ? ' style="color:var(--muted)"' : (r.rate ? '' : ' style="color:var(--bad)"')}>`
    + `${r.rate == null ? 'mixed' : (r.rate ? rs(r.rate) : 'no rate')}</td>`
    + `<td class="num" style="font-weight:700">${rs(r.amount)}</td></tr>`).join('');
  const foot = `<tfoot><tr><td class="frz">TOTAL · ${nf(rows.length)}</td>`
    + `<td colspan="${kind === 'cc' ? 3 : 2}"></td><td class="num">${nf(pcs)}</td><td></td>`
    + `<td class="num" style="font-weight:700">${rs(amt)}</td></tr></tfoot>`;
  $('hrTable').innerHTML = head + '<tbody>' + body + '</tbody>' + (rows.length ? foot : '');

  $('hrMsg').className = noRate ? 'err' : 'muted';
  $('hrMsg').textContent = `${nf(rows.length)} line(s) · click a line to see what it is made of · counted on pieces RECEIVED, dated by the receiving date`
    + (frozen ? ' · FROZEN — these are the settled figures and rate changes cannot move them'
              : ' · not frozen, so this total is still live and can change')
    + (noRate ? ` · ${nf(noRate)} line(s) have no rate in the rate list and are paying nothing` : '');
}

