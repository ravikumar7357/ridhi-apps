/* ================= PROFIT & MARGIN =================
 *
 * What is actually left after a sale, per ASIN. Everything here comes from figures the app already
 * holds — units, sales and REAL ad spend per ASIN out of the weekly cache — except one, and that one
 * is the whole point:
 *
 *   AMAZON WILL NEVER TELL YOU WHAT YOUR GOODS COST. There is no report and no API for it. So the
 *   unit cost is typed in or imported, and an ASIN without one gets NO profit figure at all. Not a
 *   zero — a zero would draw a loss-making product as a perfect-margin one and would be added into
 *   the totals besides, which is how a screen ends up confidently wrong.
 *
 * The percentages are the ones from the costing workbook (referral 15%, FBA 11%, return loss 10% of
 * landed, overhead 10%, salary 10%), deliberately so that this tab agrees with the sheet already in
 * use. They are ESTIMATES. Amazon's real referral and FBA fees arrive per order in the settlement
 * report, which this app does not read, and the tab says so rather than passing a model off as a
 * bank statement. Ad spend is the exception: that one is real, per ASIN, per week.
 */
/* Read off the costing workbook itself, ROW BY ROW, not off the multiplier strip at the top of it —
 * that strip says 3% for return loss and the sheet has never used it: every line computes return
 * loss as 10% of the LANDED cost. Taking the header at face value would have made every margin here
 * flatter than the sheet's by 7% of cost, and it would have looked perfectly reasonable. */
const PF_DEFAULT_MODEL = { ref: 15, fba: 11, ret: 10, oh: 10, sal: 10 };
let PF_MODEL = { ...PF_DEFAULT_MODEL };
let COST = {};            // ASIN → { c: landed unit cost USD, note, at, by }
let COST_AT = '';
let PF_LOADED = false;
let PF_EDIT = null;

function pfMsg(t, bad) { const m = $('pfMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/* ---------- storage ----------
 * One document. 3,600 ASINs at a cost and a short note is well inside Firestore's 1 MB, and it is
 * the ONLY copy of a number nothing can regenerate — so it is written whole, every time, rather
 * than patched field by field. */
async function loadCosts() {
  if (PF_LOADED) return;
  try {
    const snap = await getDoc(doc(db, 'audit', 'costs'));
    if (snap.exists()) {
      const d = snap.data();
      COST = d.c || {};
      COST_AT = d.at || '';
      if (d.model) PF_MODEL = { ...PF_DEFAULT_MODEL, ...d.model };
    }
  } catch (e) { /* no access, or nothing stored yet — the tab says so when it draws */ }
  PF_LOADED = true;
}
async function saveCosts() {
  COST_AT = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await setDoc(doc(db, 'audit', 'costs'), {
    c: COST, model: PF_MODEL, at: COST_AT, n: Object.keys(COST).length,
    by: ME.email, saved: serverTimestamp(),
  });
}

async function ensureProfit() {
  pfMsg('Loading…');
  await loadParentNames();
  if (!H_LOADED) await loadHealthCache();       // names, brands and the parent of each child
  await loadCosts();
  // The weekly cache IS the sales and ad data. Without it there is nothing to cost.
  if (!WEEKLY.at && !Object.keys(WEEKLY.rows).length) await loadWeekly();
  pfMsg('');
  renderProfit();
}

/** The landed unit cost recorded for an ASIN, or null. Never 0 — 0 is a cost somebody typed. */
function pfCostOf(asin) {
  const r = COST[asin];
  const v = r && Number(r.c);
  return (v > 0) ? v : null;
}

/**
 * One row's money, or null when it cannot be worked out honestly.
 *
 * Sales and ad spend are real. Referral, FBA, overhead and salary are the model's percentages of
 * sales; return loss is the model's percentage of the landed cost, exactly as the workbook has it.
 */
function pfMoney(c, unitCost) {
  const sales = c.rev || 0, units = c.u || 0, ads = c.spend || 0;
  if (!(unitCost > 0) || !units) return null;
  const cogs = unitCost * units;
  const referral = sales * PF_MODEL.ref / 100;
  const fba = sales * PF_MODEL.fba / 100;
  const ret = cogs * PF_MODEL.ret / 100;
  const oh = sales * PF_MODEL.oh / 100;
  const sal = sales * PF_MODEL.sal / 100;
  const profit = sales - referral - fba - ads - cogs - ret - oh - sal;
  return {
    sales, units, ads, cogs, referral, fba, ret, oh, sal, profit,
    margin: sales > 0 ? profit / sales * 100 : null,
    // ROI is against the money actually tied up in the goods, which is what the workbook means by it.
    roi: cogs > 0 ? profit / cogs * 100 : null,
    perUnit: units > 0 ? profit / units : null,
    tacos: sales > 0 ? ads / sales * 100 : null,
  };
}

/** The weeks being added up — the tail of the weekly cache, however many the picker asks for. */
function pfWeeks() {
  const n = Number($('pfWeeks').value) || 4;
  return (WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26)).slice(-n);
}

function pfRows() {
  const weeks = new Set(pfWeeks());
  const brand = $('pfBrand').value, q = $('pfFilter').value.trim().toLowerCase();
  const byParent = $('pfView').value === 'parent';
  const have = $('pfHave').value;

  // Summed straight from WEEKLY.rows rather than through wRows(), because that one reads the PPC &
  // Organic tab's own brand and view pickers — this tab has its own, and sharing them would make
  // one tab silently change the other.
  const acc = new Map();
  Object.entries(WEEKLY.rows).forEach(([asin, r]) => {
    const key = byParent ? wParentOf(asin) : asin;
    let o = acc.get(key);
    if (!o) {
      o = { key, brand: r.brand || '', title: '', kids: 0, rev: 0, u: 0, spend: 0, costUnits: 0, costed: 0, kidsNoCost: 0 };
      acc.set(key, o);
    }
    o.brand = o.brand || r.brand || '';
    o.kids++;
    if (!o.title) {
      o.title = byParent
        ? (PNAME[o.brand]?.[key]?.v || HEALTH[o.brand]?.parentNames?.[key] || (wTitle(asin) ? '~ ' + wTitle(asin) : ''))
        : wTitle(asin);
    }
    let rev = 0, u = 0, spend = 0;
    Object.entries(r.weeks || {}).forEach(([wk, c]) => {
      if (!weeks.has(wk)) return;
      rev += c.rev || 0; u += c.u || 0; spend += c.spend || 0;
    });
    o.rev += rev; o.u += u; o.spend += spend;
    /* A PARENT IS COSTED CHILD BY CHILD. Two sizes of the same tablecloth do not cost the same, so
     * the parent's COGS is the sum of each child's own cost × that child's own units — and the
     * units belonging to children with no cost are counted separately, because a parent that is
     * half costed must not be drawn as if it were fully costed. */
    const uc = pfCostOf(asin);
    if (uc) { o.costUnits += u; o.costed += uc * u; }
    else if (u) { o.kidsNoCost++; }
  });

  let rows = [...acc.values()].map(o => {
    // At child level the unit cost is the ASIN's own; at parent level it is the weighted average of
    // the children that HAVE one, which is the only average that means anything here.
    const unitCost = byParent
      ? (o.costUnits > 0 ? o.costed / o.costUnits : null)
      : pfCostOf(o.key);
    // A parent with some children uncosted is costed on the units it CAN account for, and says so.
    const cell = { rev: o.rev, u: byParent ? (o.costUnits || o.u) : o.u, spend: o.spend };
    const m = pfMoney(byParent ? { ...cell, rev: o.rev } : cell, unitCost);
    return { ...o, asin: o.key, unitCost, m, partial: byParent && o.kidsNoCost > 0 && o.costUnits > 0 };
  });

  if (brand !== 'ALL') rows = rows.filter(r => r.brand === brand);
  if (q) rows = rows.filter(r => (r.asin + ' ' + r.title).toLowerCase().includes(q));
  if (have === 'have') rows = rows.filter(r => r.m);
  else if (have === 'none') rows = rows.filter(r => !r.m && r.rev > 0);
  // Biggest sellers first. Sorting by profit would bury the uncosted rows, which are the ones that
  // most need finding.
  rows.sort((a, b) => b.rev - a.rev);
  return rows;
}

function renderProfitKpis(rows) {
  const money = v => (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US');
  const costed = rows.filter(r => r.m);
  const salesAll = rows.reduce((s, r) => s + r.rev, 0);
  const salesCosted = costed.reduce((s, r) => s + r.m.sales, 0);
  const profit = costed.reduce((s, r) => s + r.m.profit, 0);
  const cogs = costed.reduce((s, r) => s + r.m.cogs, 0);
  const ads = costed.reduce((s, r) => s + r.m.ads, 0);
  const cover = salesAll > 0 ? salesCosted / salesAll * 100 : 0;
  const tile = (label, val, colour) => `<div class="metric"><div class="v"${colour ? ` style="color:${colour}"` : ''}>${val}</div><div class="l">${label}</div></div>`;
  const wk = pfWeeks();
  $('pfKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Profit — ${wk.length} week(s)</span>
      <span class="kpiwhen">${wk.length ? wk[0] + ' → ' + wk[wk.length - 1] : 'no weekly data yet'}</span></div>
    <div class="metrics">
      ${tile('Sales (costed rows)', money(salesCosted))}
      ${tile('COGS', money(cogs))}
      ${tile('Ad spend', money(ads))}
      ${tile('Profit', money(profit), profit >= 0 ? '#166534' : 'var(--bad)')}
      ${tile('Margin', salesCosted > 0 ? (profit / salesCosted * 100).toFixed(1) + '%' : '—')}
      ${tile('ROI on goods', cogs > 0 ? Math.round(profit / cogs * 100) + '%' : '—')}
      ${tile('Sales covered', Math.round(cover) + '%', cover >= 80 ? '#166534' : 'var(--bad)')}
      ${tile('ASINs with no cost', (rows.length - costed.length).toLocaleString('en-US'))}
    </div></div>
    ${cover < 99.5 ? `<div class="muted" style="flex-basis:100%;font-size:12px;margin-top:-4px">
      Every figure above covers ONLY the rows that have a unit cost — ${money(salesAll - salesCosted)} of sales is
      not in them. Filter to <b>Missing a cost</b> to see what is left out; nothing is estimated on your behalf.</div>` : ''}`;
}

function renderProfit() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US');
  const money2 = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  if (!WEEKLY.at && !Object.keys(WEEKLY.rows).length) {
    $('pfKpis').innerHTML = '';
    $('pfTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">'
      + 'No weekly sales data is cached yet. Open <b>PPC &amp; Organic</b> once and let it load — this tab costs the same figures.'
      + '</td></tr></tbody>';
    return;
  }
  const rows = pfRows();
  renderProfitKpis(rows);

  const head = '<thead><tr><th>ASIN</th><th>Product</th><th>Brand</th><th class="num">Units</th>'
    + '<th class="num">Sales</th><th class="num">Ad spend</th><th class="num">TACoS</th>'
    + '<th class="num">Unit cost</th><th class="num">COGS</th><th class="num">Fees (est.)</th>'
    + '<th class="num">Other (est.)</th><th class="num">Profit</th><th class="num">Margin</th>'
    + '<th class="num">ROI</th><th class="num">Per unit</th></tr></thead>';

  const body = rows.slice(0, 400).map(r => {
    const m = r.m;
    const cell = v => `<td class="num">${v}</td>`;
    const costCell = `<td class="num"><span class="pfcost" data-pf="${esc(r.asin)}" style="cursor:pointer;border-bottom:1px dashed var(--muted)"`
      + ` title="${r.unitCost ? 'Landed cost of one unit. Click to change.' : 'No unit cost recorded — click to type one. Until then this row has no profit figure.'}">`
      + `${r.unitCost ? money2(r.unitCost) : '<span class="muted">— set —</span>'}</span></td>`;
    if (!m) {
      return `<tr><td style="font-family:ui-monospace,monospace">${esc(r.asin)}</td>`
        + `<td title="${esc(r.title)}">${esc(String(r.title).slice(0, 40)) || '<span class="muted">—</span>'}</td>`
        + `<td>${r.brand ? esc(BRAND_NAME[r.brand] || r.brand) : '<span class="muted">—</span>'}</td>`
        + cell(Math.round(r.u).toLocaleString('en-US')) + cell(money(r.rev)) + cell(money(r.spend))
        + cell(r.rev > 0 ? (r.spend / r.rev * 100).toFixed(1) + '%' : '<span class="muted">—</span>')
        + costCell
        + `<td class="num muted" colspan="7" style="text-align:left;font-size:12px">`
        + (r.u ? 'no unit cost — nothing here is guessed' : 'nothing sold in this window')
        + `</td></tr>`;
    }
    const good = m.profit >= 0;
    return `<tr><td style="font-family:ui-monospace,monospace">${esc(r.asin)}</td>`
      + `<td title="${esc(r.title)}">${esc(String(r.title).slice(0, 40)) || '<span class="muted">—</span>'}</td>`
      + `<td>${r.brand ? esc(BRAND_NAME[r.brand] || r.brand) : '<span class="muted">—</span>'}</td>`
      + cell(Math.round(m.units).toLocaleString('en-US')
          + (r.partial ? ` <span class="muted" style="font-size:11px" title="${r.kidsNoCost} child ASIN(s) under this parent have no unit cost. Only the units that could be costed are counted here — the rest are left out rather than costed at a guess.">part</span>` : ''))
      + cell(money(m.sales)) + cell(money(m.ads))
      + cell(m.tacos == null ? '<span class="muted">—</span>' : m.tacos.toFixed(1) + '%')
      + costCell
      + cell(money(m.cogs))
      + cell(money(m.referral + m.fba))
      + cell(money(m.ret + m.oh + m.sal))
      + `<td class="num" style="font-weight:700;color:${good ? '#166534' : 'var(--bad)'}">${money(m.profit)}</td>`
      + cell(m.margin == null ? '<span class="muted">—</span>' : m.margin.toFixed(1) + '%')
      + cell(m.roi == null ? '<span class="muted">—</span>' : Math.round(m.roi) + '%')
      + cell(m.perUnit == null ? '<span class="muted">—</span>' : money2(m.perUnit))
      + '</tr>';
  }).join('');

  $('pfTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="15" class="muted" style="padding:14px">Nothing matches these filters.</td></tr>')
    + '</tbody>';
  const nCost = Object.keys(COST).filter(a => pfCostOf(a)).length;
  pfMsg(`${rows.length} row(s)${rows.length > 400 ? ' · showing the top 400 by sales' : ''}`
    + ` · ${nCost.toLocaleString('en-US')} ASIN(s) have a unit cost`
    + (COST_AT ? ` · costs last saved ${COST_AT}` : '')
    + ` · fees are the ${PF_MODEL.ref}% / ${PF_MODEL.fba}% model, not Amazon's settled figures.`);
}

/* ---------- typing a cost straight into the table ---------- */
$('pfTable').addEventListener('click', e => {
  const el = e.target.closest('[data-pf]');
  if (!el) return;
  const asin = el.dataset.pf;
  if ($('pfView').value === 'parent') {
    pfMsg('A cost belongs to ONE child ASIN — two sizes of the same product do not cost the same. Switch to “By child ASIN” to type it.', true);
    return;
  }
  const cur = pfCostOf(asin);
  const typed = prompt(`Landed cost of ONE unit of ${asin}, in USD.\n\nGoods + freight + duty — what it costs you to have one sitting in an Amazon warehouse. Leave empty to clear it.`,
    cur ? String(cur) : '');
  if (typed === null) return;
  const t = typed.trim();
  if (!t) { delete COST[asin]; }
  else {
    const v = Number(t.replace(/[^0-9.]/g, ''));
    if (!(v > 0) || v > 100000) { pfMsg('A unit cost has to be a positive number of dollars.', true); return; }
    COST[asin] = { ...(COST[asin] || {}), c: Math.round(v * 100) / 100, at: sdToday(), by: ME.email };
  }
  renderProfit();
  saveCosts().then(() => pfMsg('Saved.')).catch(err => pfMsg('Could not save: ' + (err.message || err), true));
});

['pfBrand', 'pfWeeks', 'pfView', 'pfHave'].forEach(id => $(id).addEventListener('change', renderProfit));
let PF_FILTER_T = null;
$('pfFilter').addEventListener('input', () => { clearTimeout(PF_FILTER_T); PF_FILTER_T = setTimeout(renderProfit, 250); });

/* ---------- the cost model ---------- */
function pfModelOpen() {
  $('pmRef').value = PF_MODEL.ref; $('pmFba').value = PF_MODEL.fba;
  $('pmRet').value = PF_MODEL.ret; $('pmOh').value = PF_MODEL.oh; $('pmSal').value = PF_MODEL.sal;
  pfModelNote();
  $('pfModelModal').classList.remove('hide');
}
function pfModelNote() {
  const n = k => Number($(k).value) || 0;
  const ofSales = n('pmRef') + n('pmFba') + n('pmOh') + n('pmSal');
  $('pmNote').innerHTML = `Together these take <b>${ofSales.toFixed(1)}%</b> of every dollar of sales,`
    + ` plus ${n('pmRet').toFixed(1)}% of the landed cost, before ad spend and the goods themselves.`
    + (ofSales >= 100 ? ' <span style="color:var(--bad)">That is all of it or more — every row will show a loss.</span>' : '');
}
['pmRef', 'pmFba', 'pmRet', 'pmOh', 'pmSal'].forEach(id => $(id).addEventListener('input', pfModelNote));
$('pfModel').onclick = pfModelOpen;
$('pmCancel').onclick = () => $('pfModelModal').classList.add('hide');
$('pmReset').onclick = () => {
  Object.entries(PF_DEFAULT_MODEL).forEach(([k, v]) => { $('pm' + k[0].toUpperCase() + k.slice(1)).value = v; });
  pfModelNote();
};
$('pmSave').onclick = async () => {
  const n = id => Math.max(0, Number($(id).value) || 0);
  PF_MODEL = { ref: n('pmRef'), fba: n('pmFba'), ret: n('pmRet'), oh: n('pmOh'), sal: n('pmSal') };
  $('pfModelModal').classList.add('hide');
  renderProfit();
  try { await saveCosts(); pfMsg('Cost model saved — every row is costed on it.'); }
  catch (err) { pfMsg('Could not save the model: ' + (err.message || err), true); }
};

/* ---------- importing unit costs ----------
 * ADDS AND UPDATES, never replaces. An ASIN the file does not mention keeps the cost it had: a
 * costing sheet usually covers one range at a time, and wiping the rest to import a dozen rows
 * would destroy months of typing that nothing can regenerate. */
const PF_IMP_COLS = [
  { k: 'asin', t: 'ASIN', need: true, alias: ['child asin', 'product asin', 'asin1'] },
  { k: 'c', t: 'Unit cost USD', need: true, alias: ['unit cost', 'landed cost', 'cost', 'cost usd', 'landed', 'landed cost usd'] },
  { k: 'note', t: 'Note', need: false, alias: ['notes', 'remark', 'remarks', 'comment', 'product'] },
];
let PF_IMP_STAGED = null;

$('pfImport').onclick = () => {
  PF_IMP_STAGED = null;
  $('pfImpPrev').classList.add('hide');
  $('pfImpErr').classList.add('hide');
  $('pfImpSave').disabled = true;
  $('pfImpModal').classList.remove('hide');
};
$('pfImpCancel').onclick = () => $('pfImpModal').classList.add('hide');
$('pfImpModal').onclick = e => { if (e.target === $('pfImpModal')) $('pfImpModal').classList.add('hide'); };
$('pfImpPick').onclick = () => $('pfImpFile').click();

$('pfImpTemplate').onclick = () => {
  const cell = v => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  // The examples carry REAL landed costs out of the costing workbook, so the column is unmistakable:
  // it is dollars per single unit, not per set, not the selling price.
  const ex = [
    ['B0CR91CFCJ', '8.64', 'CLOTH_NAPKIN_EMBROIDER 18x18 set of 4 — goods + freight + duty'],
    ['B0C625C9RP', '4.57', 'CLOTH_NAPKIN 20x20 set of 4'],
  ];
  const lines = [PF_IMP_COLS.map(c => c.t).map(cell).join(',')].concat(ex.map(r => r.map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'unit-costs-template.csv';
  a.click(); URL.revokeObjectURL(a.href);
};

$('pfImpFile').onchange = async ev => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const err = t => { $('pfImpErr').innerHTML = t; $('pfImpErr').classList.remove('hide'); $('pfImpSave').disabled = true; };
  $('pfImpErr').classList.add('hide'); $('pfImpPrev').classList.add('hide'); PF_IMP_STAGED = null;
  try {
    const rows = dParseCsv(await file.text());
    if (rows.length < 2) { err('That file has no rows under its header.'); return; }
    const head = rows[0].map(h => String(h).trim().toLowerCase());
    const at = {};
    PF_IMP_COLS.forEach(c => {
      let idx = head.indexOf(c.t.toLowerCase());
      if (idx < 0) for (const a of c.alias) { const i = head.indexOf(a); if (i >= 0) { idx = i; break; } }
      if (idx >= 0) at[c.k] = idx;
    });
    const missing = PF_IMP_COLS.filter(c => c.need && at[c.k] == null).map(c => c.t);
    if (missing.length) {
      err('These columns are required and were not found: <b>' + esc(missing.join(', ')) + '</b>. '
        + 'The file has: ' + esc(head.filter(Boolean).slice(0, 18).join(', '))
        + '. Download the template to see the names it looks for.');
      return;
    }
    const cellOf = (row, k) => (at[k] == null ? '' : String(row[at[k]] == null ? '' : row[at[k]]).trim());
    const good = [], bad = [];
    rows.slice(1).forEach((r, i) => {
      if (!r.some(c => String(c || '').trim())) return;
      const line = i + 2;
      const asin = cellOf(r, 'asin').toUpperCase();
      const raw = cellOf(r, 'c');
      const v = Number(raw.replace(/[^0-9.\-]/g, ''));
      if (!D_ASIN_RE.test(asin)) { bad.push(`line ${line}: “${cellOf(r, 'asin').slice(0, 14)}” is not an ASIN`); return; }
      if (!(v > 0)) { bad.push(`line ${line}: “${raw.slice(0, 12)}” is not a cost`); return; }
      if (v > 100000) { bad.push(`line ${line}: ${raw.slice(0, 12)} is too large to be one unit`); return; }
      good.push({ asin, c: Math.round(v * 100) / 100, note: cellOf(r, 'note').slice(0, 120) });
    });
    if (!good.length) {
      err('Nothing in that file could be used.<br>' + esc(bad.slice(0, 8).join(' · ')) + (bad.length > 8 ? ' …' : ''));
      return;
    }
    const byAsin = new Map();
    let dup = 0;
    good.forEach(g => { if (byAsin.has(g.asin)) dup++; byAsin.set(g.asin, g); });
    const list = [...byAsin.values()];
    const changing = list.filter(g => pfCostOf(g.asin) && pfCostOf(g.asin) !== g.c);
    const isNew = list.filter(g => !pfCostOf(g.asin));
    // A cost against an ASIN that has never sold is not an error — it may sell next week — but it is
    // also the shape of a file keyed by the wrong column, so it is counted out loud.
    const unsold = list.filter(g => !WEEKLY.rows[g.asin]);

    PF_IMP_STAGED = list;
    $('pfImpPrev').classList.remove('hide');
    $('pfImpPrev').innerHTML =
      `<div><b>${list.length} ASIN(s)</b> ready — ${isNew.length} new, ${changing.length} changing a cost already stored.</div>`
      + (dup ? `<div class="muted" style="font-size:12px;margin-top:4px">${dup} row(s) repeat an ASIN earlier in the file — the last one wins.</div>` : '')
      + (changing.length ? `<div style="font-size:12px;margin-top:4px">Changing, for example: ${changing.slice(0, 3).map(g => `${esc(g.asin)} $${pfCostOf(g.asin).toFixed(2)} → $${g.c.toFixed(2)}`).join(', ')}${changing.length > 3 ? ' …' : ''}</div>` : '')
      + (unsold.length ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${unsold.length} ASIN(s) have no sales in the weekly cache at all (${unsold.slice(0, 3).map(g => esc(g.asin)).join(', ')}${unsold.length > 3 ? '…' : ''}). Fine if they are new — but if most of the file is like this, check that the ASIN column is really ASINs.</div>` : '')
      + (bad.length ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${bad.length} row(s) will be skipped — ${esc(bad.slice(0, 5).join(' · '))}${bad.length > 5 ? ' …' : ''}</div>` : '')
      + `<div class="muted" style="font-size:12px;margin-top:6px">An ASIN this file does not mention keeps the cost it already has. Nothing is cleared.</div>`;
    $('pfImpSave').disabled = false;
  } catch (e2) { err('Could not read that file: ' + esc(e2.message || e2)); }
};

$('pfImpSave').onclick = async () => {
  if (!PF_IMP_STAGED || !PF_IMP_STAGED.length) return;
  let added = 0, updated = 0;
  PF_IMP_STAGED.forEach(g => {
    if (pfCostOf(g.asin)) updated++; else added++;
    COST[g.asin] = { ...(COST[g.asin] || {}), c: g.c, at: sdToday(), by: ME.email };
    if (g.note) COST[g.asin].note = g.note;
  });
  PF_IMP_STAGED = null;
  $('pfImpModal').classList.add('hide');
  renderProfit();
  try { await saveCosts(); pfMsg(`Imported — ${added} new, ${updated} updated.`); }
  catch (err) { pfMsg('Could not save the import: ' + (err.message || err), true); }
};

$('pfExport').onclick = () => {
  const cell = v => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const r2 = v => (v == null ? '' : Math.round(v * 100) / 100);
  const lines = [['ASIN', 'Product', 'Brand', 'Units', 'Sales', 'Ad spend', 'TACoS %', 'Unit cost',
    'COGS', 'Referral (est.)', 'FBA (est.)', 'Return loss (est.)', 'Overhead (est.)', 'Salary (est.)',
    'Profit', 'Margin %', 'ROI %', 'Profit per unit', 'Costed'].map(cell).join(',')];
  pfRows().forEach(r => {
    const m = r.m;
    lines.push([r.asin, r.title, r.brand ? (BRAND_NAME[r.brand] || r.brand) : '',
      Math.round(r.u), r2(r.rev), r2(r.spend), r.rev > 0 ? r2(r.spend / r.rev * 100) : '',
      r2(r.unitCost), m ? r2(m.cogs) : '', m ? r2(m.referral) : '', m ? r2(m.fba) : '',
      m ? r2(m.ret) : '', m ? r2(m.oh) : '', m ? r2(m.sal) : '',
      m ? r2(m.profit) : '', m ? r2(m.margin) : '', m ? Math.round(m.roi) : '', m ? r2(m.perUnit) : '',
      m ? 'yes' : 'no unit cost'].map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `profit-${dToday()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};


