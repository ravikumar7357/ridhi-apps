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

/* ================= WHAT EACH VENDOR IS OWED =================
 *
 * The contractor payout on the other side of the gate. A contractor is paid for pieces received
 * against a production line; a vendor for what was KEPT out of what it delivered.
 *
 * WHAT IS PAID, AND WHAT IS NOT:
 *   · kept          — paid. This is ok.qty, what somebody actually took in.
 *   · returned      — NOT paid. The printer is credited with what was kept, so a rejected piece
 *                     stays owed and has to be made again. Paying for it would pay for it twice.
 *   · over the      — paid, because it was taken in. It is shown apart on the row, because a figure
 *     challan         bigger than the challan is the one somebody will query.
 *   · not yet       — nothing. A delivery nobody has accepted is not owed yet, and a screen that
 *     accepted        guessed otherwise would put a claim into a bill unchecked.
 *
 * DATED BY THE DAY THE GOODS CAME, not the day somebody got round to accepting them. Cloth delivered
 * on the 14th and accepted on the 17th belongs to the first fortnight, because that is when the work
 * was done.
 *
 * NOTHING HERE IS SETTLED. There is no freeze on this screen yet, so every figure is live and a rate
 * change will move it. The panel says so rather than letting the number look final.
 */

/** Is this delivery inside the period being looked at? Compared as plain day keys, never as dates. */
function vpayInWindow(d, w) {
  const k = voDayKey(voDayOf(d && d.date));
  if (!k) return false;
  return k >= w.from.replace(/-/g, '') && k <= w.to.replace(/-/g, '');
}

/**
 * One row per vendor, per piece of work, per rate.
 *
 * The rate is part of the key and not only of the row: the same cloth in two colours is two prices,
 * so merging them would produce a figure at a rate that priced neither.
 */
/** The type a vendor freeze is filed under, beside the two contractor types, in pt_payoutFreezes. */
const VPAY_TYPE = 'Vendor';

/**
 * The payout for a period: each half frozen-or-live ON ITS OWN, then the month is the two merged.
 * A month is never one 1st-to-end sum — freezing the first half and then opening the month would
 * quietly recalculate it, which is the one thing a freeze exists to prevent.
 */
function vpayRows(yr, mo, period) {
  if (period === 3) {
    const m = {};
    [1, 2].forEach(p => vpayRows(yr, mo, p).forEach(x => {
      if (!m[x.key]) { m[x.key] = Object.assign({}, x, { dels: (x.dels || []).slice() }); return; }
      const t = m[x.key];
      /* AMOUNTS ARE ADDED, never re-multiplied — re-pricing the merged quantity would pay the frozen
       * half at today's rate. */
      ['qty', 'over', 'rej', 'gone', 'amount'].forEach(f => { t[f] = (t[f] || 0) + (x[f] || 0); });
      t.dels = t.dels.concat(x.dels || []);
      t.frozen = t.frozen && x.frozen;
    }));
    return Object.values(m).sort(vpaySort);
  }
  const held = payFrozenRows(VPAY_TYPE, yr, mo, period);
  if (held) return held.map(x => Object.assign({ over: 0, rej: 0, gone: 0, why: '', dels: [] }, x,
    { rate: x.rate == null ? null : x.rate, frozen: true }));
  return vpayLive(yr, mo, period);
}
const vpaySort = (a, b) => String(a.vendor).toLowerCase().localeCompare(String(b.vendor).toLowerCase())
  || String(a.what).toLowerCase().localeCompare(String(b.what).toLowerCase());

/** What a rate row says about itself, in words — kept on the payout row so a FROZEN one can still say it. */
const vpayRateNote = rw => (rw ? (rw.service || 'Block print')
  + (rw.anyBand ? ', every colour band charges this' : '')
  + (prCols(rw) ? ', ' + prCols(rw) + ' colours' : '')
  + (rw.approvedBy ? ', approved by ' + rw.approvedBy : '') : '');

function vpayLive(yr, mo, period) {
  const w = payWindow(period, yr, mo);
  const g = {};
  (VO.rows || []).forEach(o => {
    if (!o) return;
    voLines(o).forEach((l, li) => {
      if (!l) return;
      /* A CANCELLED ORDER STILL OWES WHAT WAS TAKEN IN. Thirteen accepted deliveries — 275 pieces —
       * were sitting on cancelled orders and had dropped out of every bill. Cancelling the rest of
       * an order does not un-receive the goods that came before it; it only stops the ones after.
       * Nothing is accepted on a cancelled line after the fact, so what is here was owed already. */
      const gone = o.status === 'Cancelled' || !!l.cancelled;
      const run = voRunning(o) || l.kind === 'running';
      const m = run ? null : mdbOf(l.sku);
      const what = run
        ? [l.fabricType, l.color, l.printDirection].filter(Boolean).join(' · ')
        : [l.articleType || (m && m.articleType), l.articleSubtype || (m && m.subtype),
           l.size || (m && m.size)].filter(Boolean).join(' · ');
      const row = prRateRowFor(o.vendorCode, o, l);
      const rate = row ? (parseFloat(row.rate) || 0) : null;
      const why = row ? '' : prRateWhy(o.vendorCode, o, l);
      voDels(l).forEach((d, di) => {
        /* NOT YET ACCEPTED IS NOT YET OWED. */
        const ok = vlOk(d);
        if (!ok) return;
        const kept = parseFloat(ok.qty) || 0;
        if (kept <= 0) return;
        if (!vpayInWindow(d, w)) return;
        const key = [o.vendorCode, run ? 'running' : 'cut', what, rate == null ? 'no-rate' : rate].join('|');
        if (!g[key]) g[key] = { key, vendorCode: o.vendorCode, vendor: voName(o.vendorCode),
          run, unit: run ? 'm' : 'pcs', what, rate, rateNote: vpayRateNote(row), why,
          service: row ? (row.service || '') : (prLineServices(o.vendorCode, o)[0] || ''),
          qty: 0, over: 0, rej: 0, gone: 0, dels: [] };
        g[key].qty += kept;
        g[key].over += parseFloat(ok.over) || 0;
        g[key].rej += parseFloat(ok.rej) || 0;
        if (gone) g[key].gone += kept;
        g[key].dels.push({ day: voDayOf(d.date), orderNo: o.orderNo || o.id, sku: l.sku || '',
          claimed: parseFloat(d.qty) || 0, kept, rej: parseFloat(ok.rej) || 0,
          over: parseFloat(ok.over) || 0, note: ok.note || '', by: ok.by || '', li, di, gone,
          /* WHAT IT SAID BEFORE. A receipt that was corrected is a different fact from one that was
           * right first time, and this figure is what somebody is paid on. */
          was: (Array.isArray(ok.was) ? ok.was : []).map(x => parseFloat(x && x.qty) || 0) });
      });
    });
  });
  return Object.values(g)
    .map(x => Object.assign(x, { amount: x.rate == null ? 0 : x.qty * x.rate }))
    .sort(vpaySort);
}

function renderVpay() {
  const { yr, mo } = payParts(), per = payPeriod(), w = payWindow(per, yr, mo);
  if (VO.err) {
    $('hrKpis').innerHTML = ''; ptEmpty('hrTable', 'Nothing to show.');
    $('hrMsg').className = 'err';
    $('hrMsg').textContent = 'The vendor orders could not be read, so there is no payout to show: ' + VO.err + '. Press Refresh.';
    return;
  }
  const q = $('hrQ').value.trim().toLowerCase();
  const all = vpayRows(yr, mo, per);
  const rows = all.filter(r => !q || [r.vendor, r.vendorCode, r.service, r.what].join(' ').toLowerCase().includes(q));
  const frozen = payFrozen(VPAY_TYPE, yr, mo, per);
  $('hrFreeze').textContent = per === 3 ? 'Freeze a fortnight' : (frozen ? `Re-open ${PER_LBL[per]}` : `Freeze ${PER_LBL[per]}`);
  $('hrFreeze').disabled = per === 3 || !ME.admin;
  $('hrFreeze').title = per === 3 ? 'The two halves are settled separately — pick a fortnight.'
    : (ME.admin ? 'Freezing locks these figures so a later rate change cannot move them.'
                : 'Only an admin can freeze or re-open a period.');
  HR.rows = rows;

  const amt = rows.reduce((t, r) => t + r.amount, 0);
  const noRate = rows.filter(r => r.rate == null);
  const noRateQty = noRate.reduce((t, r) => t + r.qty, 0);
  const over = rows.reduce((t, r) => t + r.over, 0);
  const rej = rows.reduce((t, r) => t + r.rej, 0);
  const vendors = new Set(rows.map(r => r.vendorCode)).size;

  $('hrKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Vendor payout — ${esc(payYM())} · ${PER_LBL[per]}</span>
      <span class="kpiwhen">${frozen ? 'frozen — settled figures' : 'live — not settled yet'}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(vendors)}</div><div class="l">Vendors</div></div>
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Lines</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${rs(amt)}</div><div class="l">Payable</div></div>
      ${noRate.length ? `<div class="metric"><div class="v" style="color:var(--bad)">${nf(noRate.length)}</div>
        <div class="l">Lines with no rate</div></div>` : ''}
      ${over ? `<div class="metric"><div class="v" style="color:#C55A11">${nf(over)}</div>
        <div class="l">Taken in over the challan</div></div>` : ''}
      ${rej ? `<div class="metric"><div class="v" style="color:var(--muted)">${nf(rej)}</div>
        <div class="l">Returned — not paid</div></div>` : ''}
    </div></div>`;

  if (!rows.length) {
    ptEmpty('hrTable', all.length ? 'No vendor matches that search.'
      : `Nothing was accepted from any vendor between ${w.from} and ${w.to}. `
        + 'A delivery is owed once somebody accepts it in History.');
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = 'Counted on what was KEPT, dated by the day the goods came — not by the day they were accepted.';
    return;
  }

  const byV = new Map();
  rows.forEach(r => { if (!byV.has(r.vendorCode)) byV.set(r.vendorCode, []); byV.get(r.vendorCode).push(r); });
  const head = '<thead><tr>' + ['Vendor', 'Work', 'What', 'Received', 'Unit', 'Rate', 'Amount']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 3 || i >= 5 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const body = [...byV.keys()].map(vc => {
    const list = byV.get(vc);
    const sub = list.reduce((t, r) => t + r.amount, 0);
    const bar = '<tr style="background:var(--hover,#f1f5f9)">'
      + `<td class="frz" style="text-align:left;font-weight:700;background:var(--hover,#f1f5f9)">${esc(voName(vc))}</td>`
      + `<td colspan="5" class="muted" style="text-align:left">${voCatOf(vc) ? esc(voCatOf(vc)) + ' · ' : ''}${nf(list.length)} line(s)</td>`
      + `<td class="num" style="font-weight:700">${rs(sub)}</td></tr>`;
    return bar + list.map(r => `<tr data-vpay-group="${encodeURIComponent(r.key)}" style="cursor:pointer"`
      + ' title="Click to see every delivery this figure is made of.">'
      + '<td class="frz"></td>'
      + `<td style="text-align:left">${esc(r.service) || '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left">${esc(r.what)}${r.over ? ` <span class="pill pill-low" title="${nf(r.over)} more than the challans said, taken in and paid for.">+${nf(r.over)} over</span>` : ''}`
      + `${r.rej ? ` <span class="pill pill-out" title="${nf(r.rej)} sent back. Not paid — the work is still owed.">${nf(r.rej)} returned</span>` : ''}`
      + `${r.gone ? ` <span class="pill pill-low" title="${nf(r.gone)} of these were taken in on an order that was cancelled afterwards. Still owed — cancelling does not un-receive them.">${nf(r.gone)} on a cancelled order</span>` : ''}</td>`
      + `<td class="num">${nf(r.qty)}</td>`
      + `<td class="muted">${r.run ? 'per m' : 'per pc'}</td>`
      /* A rate of null is not free work — it is a rate nobody has written, and it says so. */
      + `<td class="num"${r.rate == null ? ` style="color:var(--bad)" title="${esc(r.why)}"` : ''}>${r.rate == null ? 'no rate' : rs(r.rate)}</td>`
      + `<td class="num" style="font-weight:700">${rs(r.amount)}</td></tr>`).join('');
  }).join('');
  const foot = `<tfoot><tr><td class="frz">TOTAL · ${nf(rows.length)}</td><td colspan="5"></td>`
    + `<td class="num" style="font-weight:700">${rs(amt)}</td></tr></tfoot>`;
  $('hrTable').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;

  $('hrMsg').className = noRate.length ? 'err' : 'muted';
  $('hrMsg').textContent = `${nf(rows.length)} line(s) · click one to see the deliveries behind it · `
    + 'counted on what was KEPT, dated by the day the goods came'
    + (frozen ? ' · FROZEN — these are the settled figures and a rate change cannot move them'
              : ' · not frozen, so a rate change will still move these figures')
    + (noRate.length ? ` · ${nf(noRate.length)} line(s) covering ${nf(noRateQty)} received have NO approved rate and are `
      + 'adding nothing to the total — check the Vendor rate list' : '');
}

/**
 * Every delivery behind one figure.
 *
 * This is the whole point of the screen: a vendor's bill is argued about one challan at a time, and
 * a total nobody can take apart is a total nobody can check.
 */
function vpayShowDrill(key) {
  const { yr, mo } = payParts(), per = payPeriod(), w = payWindow(per, yr, mo);
  const r = vpayRows(yr, mo, per).find(x => x.key === key);
  if (!r) return;
  const head = ['Date', 'Order', 'SKU', 'Challan said', 'Kept', 'Returned', 'Over', 'Accepted by', 'Note']
    .map((h, i) => `<th${i >= 3 && i <= 6 ? ' class="num"' : ''}>${h}</th>`).join('');
  const body = (r.dels || []).slice().sort((a, b) => voDayKey(a.day).localeCompare(voDayKey(b.day))).map(d => '<tr>'
    + `<td>${esc(d.day) || '<span class="muted">—</span>'}</td>`
    + `<td>${esc(d.orderNo)}${d.gone ? ' <span class="pill pill-low" title="Cancelled after this was taken in. Still owed.">cancelled</span>' : ''}</td>`
    + `<td style="font-family:ui-monospace,monospace">${esc(d.sku) || '<span class="muted">—</span>'}</td>`
    + `<td class="num">${nf(d.claimed)}</td>`
    + `<td class="num" style="font-weight:700">${nf(d.kept)}${(d.was || []).length
        ? ` <span class="muted" style="font-weight:400;font-size:11px" title="This receipt was corrected after it was first accepted.">was ${d.was.map(nf).join(' → ')}</span>` : ''}</td>`
    + `<td class="num"${d.rej ? ' style="color:var(--bad)"' : ''}>${d.rej ? nf(d.rej) : '<span class="muted">—</span>'}</td>`
    + `<td class="num"${d.over ? ' style="color:#C55A11;font-weight:700"' : ''}>${d.over ? nf(d.over) : '<span class="muted">—</span>'}</td>`
    + `<td class="muted" style="font-size:12px">${esc(String(d.by || '').split('@')[0])}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:260px;font-size:12px" class="muted">${esc(d.note)}</td></tr>`).join('');
  ptOpenDialog({
    title: r.what + ' — ' + voName(r.vendorCode),
    subtitle: `${PER_LBL[per]} of ${payYM()}  ·  ${w.from} to ${w.to}`,
    note: (r.rate == null
      ? 'NO APPROVED RATE prices this work, so it is adding nothing to the total: ' + r.why + '. The pieces '
        + 'were still received and are still owed — the rate is what is missing, not the work.'
      : `Paid at Rs.${r.rate} ${r.run ? 'per metre' : 'per piece'} — ${r.rateNote || 'Block print'}`
        + `. ${nf(r.qty)} ${r.unit} × Rs.${r.rate} = ${rs(r.amount)}.`)
      + (r.frozen ? ' FROZEN — this is the settled figure, at the rate that applied when it was frozen.' : '')
      + ' Returned pieces are not in this figure — the vendor is credited with what was kept, so a '
      + 'returned piece stays owed and has to be made again.',
    html: `<div class="driller">
      Every delivery accepted in this period, for this work, at this rate. The total above is the
      <b>Kept</b> column — nothing else.
    </div>
    <div class="xlwrap" style="max-height:48vh;border:1px solid var(--line);border-radius:10px">
      <table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
  });
}

/* ---- Advance payout ---- */

function renderAdvance() {
  const ym = payYM(), { yr, mo } = payParts();
  const pay = {};
  payRows(PAY_TYPES.cc, 3, yr, mo).forEach(r => { const n = r.empName || '—'; pay[n] = (pay[n] || 0) + r.amount; });
  const names = new Set(Object.keys(pay));
  (HR.adv || []).filter(a => a.ym === ym).forEach(a => names.add(a.empName));
  const q = $('hrQ').value.trim().toLowerCase();
  const rows = [...names].filter(n => !q || String(n).toLowerCase().includes(q)).sort()
    .map(n => { const p = pay[n] || 0, a = payAdvance(n, ym); return { name: n, pay: p, adv: a, net: Math.max(0, p - a) }; });
  HR.rows = rows;

  const tp = rows.reduce((s, r) => s + r.pay, 0), ta = rows.reduce((s, r) => s + r.adv, 0);
  $('hrKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Advance payout — ${esc(ym)}</span>
      <span class="kpiwhen">deducted from the full month, never from a fortnight</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">People</div></div>
      <div class="metric"><div class="v">${rs(tp)}</div><div class="l">Full-month payout</div></div>
      <div class="metric"><div class="v" style="color:#C55A11">${rs(ta)}</div><div class="l">Advance paid</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${rs(Math.max(0, tp - ta))}</div><div class="l">Net payable</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Employee', 'Full-month payout', 'Advance', 'Net payable', 'Set advance']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 1 && i <= 3 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('hrTable').innerHTML = head + '<tbody>' + rows.map(r => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(r.name)}</td>`
    + `<td class="num">${rs(r.pay)}</td>`
    + `<td class="num"${r.adv ? ' style="color:#C55A11;font-weight:700"' : ''}>${r.adv ? rs(r.adv) : '<span class="muted">—</span>'}</td>`
    /* An advance bigger than the payout cannot make the net negative — nobody pays it back here. */
    + `<td class="num" style="font-weight:700">${rs(r.net)}${r.adv > r.pay ? ' <span class="muted">(capped)</span>' : ''}</td>`
    + `<td><button class="ghost" data-hr-adv="${esc(r.name)}" style="padding:3px 10px;font-size:12px">Set</button></td></tr>`).join('')
    + '</tbody>';
  $('hrMsg').className = 'muted';
  $('hrMsg').textContent = `${nf(rows.length)} Company Contractor(s) with a payout or an advance in ${ym}`;
}

function hrSetAdvance(name) {
  const ym = payYM();
  const cur = payAdvance(name, ym);
  ptOpenDialog({
    title: 'Advance for ' + name,
    subtitle: ym,
    note: 'One figure per person per month. It is deducted from the FULL-MONTH payout only — taking it '
      + 'off a fortnight as well would deduct the same money twice.',
    fields: [
      { key: 'amount', label: 'Advance paid (Rs.)', type: 'number', step: '0.01', value: cur || '' },
      { key: 'remarks', label: 'Remarks', value: '', span: true },
    ],
    onSave: async v => {
      const amt = parseFloat(v.amount) || 0;
      if (amt < 0) return 'An advance cannot be negative.';
      // One row per person per month: the old one goes, so two do not stack up unnoticed.
      let next = (HR.adv || []).filter(a => !(hrN(a.empName) === hrN(name) && a.ym === ym));
      if (amt > 0) next = next.concat([{ id: 'adv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        empName: name, ym, amount: amt, remarks: String(v.remarks || '').trim(),
        addedBy: ME.email, addedAt: new Date().toISOString() }]);
      await hrPutList('pt_advances', next.length ? next : null);
      HR.adv = next;
      renderHr();
      return '';
    },
  });
}

/* ---- Salary slip ---- */

function renderSlip() {
  const ym = payYM(), { yr, mo } = payParts();
  const name = $('hrSlipEmp').value;
  const people = [...new Set(payRows(PAY_TYPES.cc, 3, yr, mo).map(r => r.empName).filter(Boolean))].sort();
  const cur = $('hrSlipEmp').value;
  $('hrSlipEmp').innerHTML = '<option value="">— Select an employee —</option>'
    + people.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('hrSlipEmp').value = cur;
  if ($('hrSlipEmp').value !== cur) $('hrSlipEmp').value = '';

  $('hrKpis').innerHTML = '';
  if (!$('hrSlipEmp').value) {
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = people.length ? 'Pick an employee to build their slip.'
      : `Nobody has a Company Contractor payout in ${ym}.`;
    ptEmpty('hrTable', 'No slip yet.');
    return;
  }

  /* Collapsed by ARTICLE TYPE only, and with no rate column — the rate varies by subtype and size,
   * and a blended rate across a mixed article would be a number nobody could check. */
  const merged = {};
  [1, 2].forEach(p => payRows(PAY_TYPES.cc, p, yr, mo).filter(r => r.empName === name).forEach(r => {
    const k = r.articleType || '(unknown)';
    if (!merged[k]) merged[k] = { articleType: k, recvPcs: 0, amount: 0 };
    merged[k].recvPcs += r.recvPcs; merged[k].amount += r.amount;
  }));
  const lines = Object.values(merged).sort((a, b) => String(a.articleType).localeCompare(String(b.articleType)));
  const pcs = lines.reduce((s, r) => s + r.recvPcs, 0);
  const gross = lines.reduce((s, r) => s + r.amount, 0);
  const adv = payAdvance(name, ym);
  const net = Math.max(0, gross - adv);
  const rec = (HR.emp || []).find(e => hrN(e[1]) === hrN(name)) || [];
  const hours = (HR.eh || []).filter(r => hrN(r.empName) === hrN(name) && String(r.date || '').slice(0, 7) === ym);
  const hAuth = hours.filter(r => (r.status || 'pending') === 'authorized').reduce((s, r) => s + ptNum(r.hours), 0);
  const hPend = hours.filter(r => (r.status || 'pending') !== 'authorized').reduce((s, r) => s + ptNum(r.hours), 0);

  HR.rows = lines.map(l => ({ name, articleType: l.articleType, recvPcs: l.recvPcs, amount: l.amount }));
  $('hrSlip').classList.remove('hide');
  $('hrSlip').innerHTML = `
    <div class="slip">
      <div class="sliphead">
        <div><div class="slipco">RIDHI BLOCK PRINT</div><div class="slipsub">Salary slip</div></div>
        <div class="slipwhen">${esc(ym)}</div>
      </div>
      <div class="slipgrid">
        <div><span>Employee</span><b>${esc(name)}</b></div>
        <div><span>Department</span><b>${esc(rec[2] || '—')}</b></div>
        <div><span>Employment type</span><b>${esc(rec[0] || 'Company Contractor')}</b></div>
        <div><span>Phone</span><b>${esc(rec[3] || '—')}</b></div>
      </div>
      <table class="sliptab">
        <thead><tr><th>Article type</th><th class="num">Pieces</th><th class="num">Amount</th></tr></thead>
        <tbody>${lines.length ? lines.map(l => `<tr><td>${esc(l.articleType)}</td>`
          + `<td class="num">${nf(l.recvPcs)}</td><td class="num">${rs(l.amount)}</td></tr>`).join('')
          : '<tr><td colspan="3" class="muted" style="padding:14px">No earnings this month.</td></tr>'}</tbody>
      </table>
      <div class="sliptot">
        <div><span>Total pieces</span><b>${nf(pcs)}</b></div>
        <div><span>Gross payout</span><b>${rs(gross)}</b></div>
        <div><span>Advance deducted</span><b style="color:#C55A11">${adv ? '− ' + rs(adv) : rs(0)}</b></div>
        <div class="net"><span>Net payable</span><b>${rs(net)}</b></div>
      </div>
      <!-- Extra hours are shown but NOT added: they are authorised separately and are not part of
           the piece-rate payout. Leaving them off the slip entirely would hide work that was done. -->
      <div class="slipnote">Extra hours this month: ${nf(hAuth)} authorised${hPend ? `, ${nf(hPend)} still awaiting authorisation` : ''}.
        They are recorded separately and are not included in the amount above.</div>
    </div>`;
  ptEmpty('hrTable', 'The slip is above.');
  $('hrMsg').className = 'muted';
  $('hrMsg').textContent = `${esc(name)} · ${esc(ym)}`;
}

$('hrSlipPrint').onclick = () => {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write('<html><head><title>Salary slip</title><style>'
    + 'body{font-family:system-ui,sans-serif;margin:24px;color:#111827}'
    + '.slip{max-width:720px;margin:0 auto}.sliphead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1f3864;padding-bottom:12px}'
    + '.slipco{font-size:22px;font-weight:900;color:#1f3864}.slipsub{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;font-weight:700}'
    + '.slipwhen{font-size:14px;font-weight:700}'
    + '.slipgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin:18px 0;font-size:13px}'
    + '.slipgrid span{color:#6b7280;margin-right:6px}'
    + '.sliptab{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}'
    + '.sliptab th{background:#1f3864;color:#fff;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px}'
    + '.sliptab td{padding:7px 12px;border-bottom:1px solid #f3f4f6}.num{text-align:right}'
    + '.sliptot{margin-left:auto;width:300px;font-size:13px;border:1px solid #e5e7eb;border-radius:6px}'
    + '.sliptot div{display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #f3f4f6}'
    + '.sliptot .net{background:#f9fafb;font-size:15px}'
    + '.slipnote{margin-top:18px;font-size:12px;color:#6b7280}'
    + '</style></head><body>' + $('hrSlip').innerHTML + '</body></html>');
  w.document.close();
  w.focus();
  w.print();
};

$('hrTable').addEventListener('click', e => {
  const a = e.target.closest('[data-hr-adv]'); if (a) hrSetAdvance(a.getAttribute('data-hr-adv'));
});
['hrMonth', 'hrPeriod', 'hrSlipEmp', 'hrPayEmp'].forEach(id => $(id).addEventListener('change', renderHr));

/* ---- Authorising extra hours ----
 *
 * Authorisation was reachable only through the Edit dialog's admin section, which is to say it was
 * reachable by nobody: the table said "Pending" and offered no way to change it. With 224 entries
 * open, one dialog at a time would not have been usable even once it was found.
 *
 * So: a button on the row, and one for everything currently filtered. The bulk write goes as a
 * single multi-path update — 224 separate writes would leave a half-authorised month behind if the
 * connection dropped in the middle, and nothing would say which half.
 */
function ehStamp(row, on) {
  const next = Object.assign({}, row, {
    status: on ? 'authorized' : 'pending',
    authorizedBy: on ? ME.email : '',
    authorizedByName: on ? ME.email : '',
    authorizedAt: on ? new Date().toISOString() : '',
  });
  delete next._key;
  return next;
}

async function ehSetOne(id, on) {
  const r = (HR.eh || []).find(x => x.id === id); if (!r) return;
  if (!ME.admin) { $('hrMsg').className = 'err'; $('hrMsg').textContent = 'Only an admin can authorise extra hours.'; return; }
  if (ehFrozen(r.date)) {
    $('hrMsg').className = 'err';
    $('hrMsg').textContent = `${ehMonthKey(r.date)} is frozen — extra hours for that month are locked.`;
    return;
  }
  const next = ehStamp(r, on);
  try {
    await ptPut('pt_extraHours/' + r.id, next);
    HR.eh = (HR.eh || []).map(x => (x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
    renderHr();
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = `${r.empName} · ${r.date} · ${nf(ptNum(r.hours))}h ${on ? 'authorised' : 'moved back to pending'}.`;
  } catch (e) {
    $('hrMsg').className = 'err';
    $('hrMsg').textContent = 'Not saved: ' + (e.message || e);
  }
}

$('hrAuthAll').onclick = async () => {
  if (!ME.admin) { $('hrMsg').className = 'err'; $('hrMsg').textContent = 'Only an admin can authorise extra hours.'; return; }
  const shown = (HR.rows || []).filter(r => r && r.id && (r.status || 'pending') !== 'authorized');
  const open = shown.filter(r => !ehFrozen(r.date));
  const locked = shown.length - open.length;
  if (!open.length) {
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = shown.length ? `All ${nf(shown.length)} of those are in a frozen month.` : 'Nothing pending in this view.';
    return;
  }
  const hours = open.reduce((s, r) => s + ptNum(r.hours), 0);
  const people = new Set(open.map(r => r.empName)).size;
  /* Named, not "are you sure?" — this is the step that lets these hours reach a payout. */
  if (!confirm(`Authorise ${nf(open.length)} entr${open.length === 1 ? 'y' : 'ies'}?\n\n`
    + `${nf(hours)} hour(s) across ${nf(people)} ${people === 1 ? 'person' : 'people'}.\n`
    + (locked ? `${nf(locked)} more are in a frozen month and will be left alone.\n` : '')
    + '\nThis is what lets these hours reach a payout.')) return;

  const upd = {};
  const stamped = open.map(r => { const n = ehStamp(r, true); Object.keys(n).forEach(k => { upd[`pt_extraHours/${r.id}/${k}`] = n[k]; }); return n; });
  $('hrAuthAll').disabled = true;
  $('hrMsg').className = 'muted';
  $('hrMsg').textContent = `Authorising ${nf(open.length)}…`;
  try {
    await ptPatch(upd);
    const byId = {}; stamped.forEach((n, i) => { byId[open[i].id] = n; });
    HR.eh = (HR.eh || []).map(x => (byId[x.id] ? Object.assign({ _key: x.id }, byId[x.id]) : x));
    renderHr();
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = `Authorised ${nf(open.length)} entr${open.length === 1 ? 'y' : 'ies'} · ${nf(hours)} hour(s)`
      + (locked ? ` · ${nf(locked)} left alone, frozen month` : '');
  } catch (e) {
    $('hrMsg').className = 'err';
    $('hrMsg').textContent = 'Nothing was authorised: ' + (e.message || e);
  }
  $('hrAuthAll').disabled = false;
};

$('hrTable').addEventListener('click', e => {
  const a = e.target.closest('[data-eh-auth]');
  if (a) return ehSetOne(a.getAttribute('data-eh-auth'), a.getAttribute('data-on') === '1');
});

/* ---- Group drilldown: which entries made this payout line, and which did not ----
 *
 * A payout line is a total. On its own it cannot be checked — the only question anybody actually
 * asks is "why is this 86 and not 101?", and the answer is always in the rows that were left out.
 *
 * So every row that COULD have belonged to the group is listed, PAID or DROP, with the reason it was
 * dropped: no receiving date yet, returned in a different month, or returned outside this fortnight.
 * Showing only the paid rows would make a missing figure look like a mistake in the arithmetic
 * rather than what it usually is — work that has not come back yet.
 */
function payWindow(period, yr, mo) {
  const lastDay = new Date(yr, mo, 0).getDate();
  const [ds, de] = period === 3 ? [1, lastDay] : (period === 1 ? [1, 15] : [16, lastDay]);
  const p = n => String(n).padStart(2, '0');
  return { ds, de, from: `${yr}-${p(mo)}-${p(ds)}`, to: `${yr}-${p(mo)}-${p(de)}` };
}

/** Every Base Data row that could belong to this group, with a verdict and a reason. */
function payDrill(empType, group, period, yr, mo) {
  const w = payWindow(period, yr, mo);
  const same = (a, b) => hrN(a) === hrN(b);
  return (PT.base || []).filter(r => r && r.empType === empType
    && same(r.articleType, group.articleType) && same(r.articleSubtype, group.subtype) && same(r.size, group.size)
    // A CC line belongs to one person; an EC line is the whole firm's, so no name is matched.
    && (empType !== PAY_TYPES.cc || same(r.empName, group.empName)))
    .map(r => {
      const recv = ptNum(r.receivedPieces);
      const ms = ptDtMs(r.receivingDate);
      let verdict = 'COUNTED', why = 'received inside this period — counted in the total';
      if (!r.receivingDate || !ms) { verdict = 'EXCLUDED'; why = 'no receiving date yet — still out'; }
      else {
        const d = new Date(ms);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (d.getFullYear() !== yr || d.getMonth() + 1 !== mo) { verdict = 'EXCLUDED'; why = `came back ${iso} — a different month`; }
        else if (d.getDate() < w.ds || d.getDate() > w.de) { verdict = 'EXCLUDED'; why = `came back ${iso} — outside ${w.from} to ${w.to}`; }
        else if (!recv) { verdict = 'EXCLUDED'; why = 'nothing received against it'; }
      }
      return { r, recv, verdict, why };
    })
    .sort((a, b) => (a.verdict === b.verdict ? (ptDtMs(b.r.receivingDate) - ptDtMs(a.r.receivingDate)) : (a.verdict === 'COUNTED' ? -1 : 1)));
}

function payShowDrill(group) {
  const kind = $('hrView').value;
  const empType = PAY_TYPES[kind];
  const { yr, mo } = payParts(), per = payPeriod();
  const w = payWindow(per, yr, mo);
  const rows = payDrill(empType, group, per, yr, mo);
  const issued = rows.reduce((s, x) => s + ptNum(x.r.issuePieces), 0);
  const recvAll = rows.reduce((s, x) => s + x.recv, 0);
  const counted = rows.filter(x => x.verdict === 'COUNTED').reduce((s, x) => s + x.recv, 0);
  const frozen = payFrozen(empType, yr, mo, per);

  const head = ['In this period?', 'Why', 'SKU', 'Issue date', 'Receiving date', 'Issue pcs', 'Recv pcs', 'Type']
    .map((h, i) => `<th${i === 5 || i === 6 ? ' class="num"' : ''}>${h}</th>`).join('');
  const body = rows.map(x => {
    const ok = x.verdict === 'COUNTED';
    return `<tr style="background:${ok ? 'var(--accent-bg)' : 'var(--bad-bg)'}">`
      + `<td style="font-weight:700;color:${ok ? 'var(--accent)' : 'var(--bad)'}">${x.verdict}</td>`
      // The reason sits beside the verdict, not eight columns to the right where nobody scrolls.
      + `<td style="white-space:normal;min-width:230px;max-width:300px">${esc(x.why)}</td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(x.r.sku)}</td>`
      + `<td>${esc(x.r.issueDate) || '<span class="muted">—</span>'}</td>`
      + `<td>${esc(x.r.receivingDate) || '<span class="muted">(empty)</span>'}</td>`
      + `<td class="num">${nf(ptNum(x.r.issuePieces))}</td>`
      + `<td class="num">${nf(x.recv)}</td>`
      + `<td>${esc(x.r.empType)}</td></tr>`;
  }).join('');

  ptOpenDialog({
    title: 'Group drilldown',
    subtitle: [group.empName, group.articleType, group.subtype, group.size].filter(Boolean).join('  ·  '),
    note: `Period ${w.from} to ${w.to} · ${nf(rows.length)} row(s) in this group · `
      + `issued ${nf(issued)} · received ${nf(recvAll)} · counted in this period ${nf(counted)}.`
      + (recvAll !== counted ? ' The difference is the EXCLUDED rows below, each with its reason.' : '')
      /* "Counted" is not "paid". Nothing here records that money changed hands — freezing a
       * fortnight is the closest this system comes to saying a period is settled. */
      + (frozen ? ' This fortnight is FROZEN: the figures above are the ones that were settled, and may differ from what these rows add up to today.'
                : ' This fortnight is not frozen, so the total is still a live calculation and can change.'),
    html: `<div class="driller">
      <b style="color:var(--accent)">COUNTED</b> — the pieces came back inside this period, so they are in the total above.
      <b style="color:var(--bad);margin-left:10px">EXCLUDED</b> — they are not, and the reason is beside each row.
      <div style="margin-top:6px">Neither word says the money has been paid. Only freezing a fortnight means settled.</div>
    </div>
    <div class="xlwrap" style="max-height:48vh;border:1px solid var(--line);border-radius:10px">
      <table class="xl"><thead><tr>${head}</tr></thead><tbody>${body
        || '<tr><td colspan="8" class="muted" style="padding:14px">No Job Work Register rows match this group at all.</td></tr>'}</tbody></table></div>`,
  });
}

/* The payout tables are written with innerHTML, so the click is delegated like every other row action. */
$('hrTable').addEventListener('click', e => {
  const vp = e.target.closest('[data-vpay-group]');
  if (vp) { try { vpayShowDrill(decodeURIComponent(vp.getAttribute('data-vpay-group'))); } catch (err) { /* malformed row */ } return; }
  const tr = e.target.closest('[data-pay-group]');
  if (!tr) return;
  try { payShowDrill(JSON.parse(decodeURIComponent(tr.getAttribute('data-pay-group')))); } catch (err) { /* malformed row */ }
});

/* ---- Freezing a fortnight: the only thing in this system that means "settled" ----
 *
 * "PAID" was the wrong word and it has been removed. Nothing here records that money left the till.
 * A row is COUNTED — it falls in this period's total — or it is EXCLUDED, with a reason. That is all
 * the data knows.
 *
 * FREEZING is the nearest thing to "paid": it takes a snapshot of the fortnight's figures and locks
 * them, so a later rate change cannot move what was settled. Until a fortnight is frozen its total
 * is still a live calculation and can change under you.
 */
function payFreezeRec(empType, yr, mo) {
  const r = (HR.freezes || {})[payFreezeKey(empType, yr, mo)];
  return r ? JSON.parse(JSON.stringify(r)) : { frozen: {}, periods: {}, meta: {} };
}

async function paySetFreeze(on) {
  const kind = $('hrView').value;
  if (kind === 'vpay') return vpaySetFreeze(on);
  if (kind !== 'cc' && kind !== 'ec') return;
  if (!ME.admin) { $('hrMsg').className = 'err'; $('hrMsg').textContent = 'Only an admin can freeze or re-open a period.'; return; }
  const empType = PAY_TYPES[kind];
  const { yr, mo } = payParts(), per = payPeriod();
  if (per === 3) {
    $('hrMsg').className = 'err';
    $('hrMsg').textContent = 'Freeze a fortnight, not the whole month — the two halves are settled separately.';
    return;
  }
  const key = payFreezeKey(empType, yr, mo);
  const rec = payFreezeRec(empType, yr, mo);

  if (on) {
    /* The snapshot is taken from the LIVE calculation, not from what is on screen — a filter could
     * be hiding half of it, and freezing what you can see would settle only part of the fortnight. */
    const live = payRows(empType, per, yr, mo);
    if (!live.length) { $('hrMsg').className = 'err'; $('hrMsg').textContent = 'Nothing to freeze in this period.'; return; }
    const pcs = live.reduce((s, r) => s + r.recvPcs, 0), amt = live.reduce((s, r) => s + r.amount, 0);
    if (!confirm(`Freeze ${PER_LBL[per]} of ${payYM()} for ${empType}?\n\n`
      + `${nf(live.length)} line(s) · ${nf(pcs)} piece(s) · ${rs(amt)}\n\n`
      + 'These figures are locked from now on: later rate changes will not move them. '
      + 'It can be re-opened, but only by an admin.')) return;
    rec.frozen[per] = true;
    rec.periods[per] = live.map(r => ({ empName: r.empName, articleType: r.articleType, subtype: r.subtype,
      size: r.size, recvPcs: r.recvPcs, rate: r.rate, amount: r.amount }));
    rec.meta[per] = { by: ME.email, at: new Date().toISOString(), lines: live.length, pieces: pcs, amount: amt };
  } else {
    if (!confirm(`Re-open ${PER_LBL[per]} of ${payYM()} for ${empType}?\n\n`
      + 'The locked figures are discarded and the period goes back to being calculated live, '
      + 'which means it can change.')) return;
    delete rec.frozen[per];
    delete rec.periods[per];
    delete rec.meta[per];
  }

  $('hrFreeze').disabled = true;
  try {
    const empty = !Object.keys(rec.frozen).length;
    await ptPut('pt_payoutFreezes/' + key, empty ? null : rec);
    const next = Object.assign({}, HR.freezes || {});
    if (empty) delete next[key]; else next[key] = rec;
    HR.freezes = next;
    renderHr();
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = on ? `${PER_LBL[per]} of ${payYM()} is frozen — those figures are settled.`
                                : `${PER_LBL[per]} of ${payYM()} is open again and calculating live.`;
  } catch (e) {
    $('hrMsg').className = 'err';
    $('hrMsg').textContent = 'Not saved: ' + (e.message || e);
  }
  $('hrFreeze').disabled = false;
};

$('hrFreeze').onclick = () => {
  const kind = $('hrView').value;
  const { yr, mo } = payParts();
  paySetFreeze(!payFrozen(kind === 'vpay' ? VPAY_TYPE : PAY_TYPES[kind], yr, mo, payPeriod()));
};

/**
 * Freeze or re-open one fortnight of the vendor payout.
 *
 * WORK WITH NO RATE CANNOT BE FROZEN. A freeze says "this is what is owed and it is settled"; a line
 * with no rate is owed an amount nobody has written down, and locking it in at nothing would settle
 * real work for Rs.0 where no later rate could reach it.
 */
async function vpaySetFreeze(on) {
  const say = (t, bad) => { $('hrMsg').className = bad ? 'err' : 'muted'; $('hrMsg').textContent = t; };
  if (!ME.admin) return say('Only an admin can freeze or re-open a period.', true);
  const { yr, mo } = payParts(), per = payPeriod();
  if (per === 3) return say('Freeze a fortnight, not the whole month — the two halves are settled separately.', true);
  const key = payFreezeKey(VPAY_TYPE, yr, mo), rec = payFreezeRec(VPAY_TYPE, yr, mo);
  if (on) {
    const live = vpayLive(yr, mo, per);
    if (!live.length) return say('Nothing to freeze in this period.', true);
    const bare = live.filter(r => r.rate == null);
    if (bare.length) return say(`${nf(bare.length)} line(s) in this period have NO approved rate — `
      + bare.slice(0, 3).map(r => r.vendor + ' · ' + r.what).join('; ') + (bare.length > 3 ? '; …' : '')
      + '. Freezing would settle that work at nothing, where no later rate could reach it. Price them first.', true);
    const amt = live.reduce((t, r) => t + r.amount, 0);
    if (!confirm(`Freeze ${PER_LBL[per]} of ${payYM()} for vendors?\n\n`
      + `${nf(live.length)} line(s) · ${nf(new Set(live.map(r => r.vendorCode)).size)} vendor(s) · ${rs(amt)}\n\n`
      + 'These figures are locked from now on: a later rate change, a corrected receipt or a cancelled '
      + 'order will not move them. It can be re-opened, but only by an admin.')) return;
    rec.frozen[per] = true;
    rec.periods[per] = live.map(r => ({ key: r.key, vendorCode: r.vendorCode, vendor: r.vendor, run: r.run, unit: r.unit,
      what: r.what, service: r.service, rate: r.rate, rateNote: r.rateNote, qty: r.qty, over: r.over, rej: r.rej,
      gone: r.gone, amount: r.amount, dels: r.dels }));
    rec.meta[per] = { by: ME.email, at: new Date().toISOString(), lines: live.length, amount: amt };
  } else {
    if (!confirm(`Re-open ${PER_LBL[per]} of ${payYM()} for vendors?\n\nThe locked figures are discarded and the `
      + 'period goes back to being calculated live, which means it can change.')) return;
    delete rec.frozen[per]; delete rec.periods[per]; delete rec.meta[per];
  }
  $('hrFreeze').disabled = true;
  try {
    const empty = !Object.keys(rec.frozen).length;
    await ptPut('pt_payoutFreezes/' + key, empty ? null : rec);
    const next = Object.assign({}, HR.freezes || {});
    if (empty) delete next[key]; else next[key] = rec;
    HR.freezes = next;
    renderHr();
    say(on ? `${PER_LBL[per]} of ${payYM()} is frozen for vendors.` : `${PER_LBL[per]} of ${payYM()} is live again.`);
  } catch (e) { $('hrFreeze').disabled = false; say('Not saved: ' + (e.message || e), true); }
}

