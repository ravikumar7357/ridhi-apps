/* ================= SALES · PROFIT & MARGIN: what is left after a sale, per ASIN, over the last weeks =================
 * Screens: Profit & Margin (ensureProfit runs when the tab opens — core/nav.js), its Cost model dialog and
 * its Import costs dialog.
 * Does: adds up units, sales and real ad spend per ASIN (or per parent) from the weekly cache for the weeks
 * picked (pfRows), costs each row with the landed unit cost typed or imported for it and the model's
 * percentages (pfMoney), and draws the KPI strip and the table (renderProfitKpis, renderProfit). A row
 * without a unit cost gets no profit figure. Costs and the model live in one Firestore document,
 * audit/costs (loadCosts, saveCosts); a cost is typed by clicking the Unit cost cell, or imported from a
 * CSV (Download template, Choose CSV…, preview, Import), and the whole table exports as CSV.
 * Main functions: ensureProfit, loadCosts, saveCosts, pfCostOf, pfMoney, pfWeeks, pfRows, renderProfitKpis,
 * renderProfit, pfModelOpen, pfModelNote; the handlers of the cost click, the Cost model dialog, the Import
 * costs dialog and Export. */

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
const PF_DEFAULT_MODEL = { ref: 15, fba: 11, ret: 10, oh: 10, sal: 10 };   // % of sales (ret: % of the landed cost)
let PF_MODEL = { ...PF_DEFAULT_MODEL };   // the percentages in use, from audit/costs when saved there
let COST = {};            // ASIN → { c: landed unit cost USD, note, at, by }
let COST_AT = '';         // when the costs were last saved, "YYYY-MM-DD HH:MM" (UTC)
let PF_LOADED = false;    // audit/costs has been read once
let PF_EDIT = null;

// The message line under the controls: grey normally, red when bad is true; blank text clears it.
function pfMsg(text, bad) {
  const msg = $('pfMsg');
  msg.textContent = text || '';
  msg.className = bad ? 'err' : 'muted';
}

/* ---------- storage ----------
 * One document. 3,600 ASINs at a cost and a short note is well inside Firestore's 1 MB, and it is
 * the ONLY copy of a number nothing can regenerate — so it is written whole, every time, rather
 * than patched field by field. */
// Read audit/costs once into COST, COST_AT and PF_MODEL (the defaults stay when nothing is stored).
async function loadCosts() {
  if (PF_LOADED) return;
  try {
    const snap = await getDoc(doc(db, 'audit', 'costs'));
    if (snap.exists()) {
      const data = snap.data();
      COST = data.c || {};
      COST_AT = data.at || '';
      if (data.model) PF_MODEL = { ...PF_DEFAULT_MODEL, ...data.model };
    }
  } catch (e) { /* no access, or nothing stored yet — the tab says so when it draws */ }
  PF_LOADED = true;
}
// Write the whole of COST and the model to audit/costs, stamped with now and who saved it.
async function saveCosts() {
  COST_AT = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await setDoc(doc(db, 'audit', 'costs'), {
    c: COST, model: PF_MODEL, at: COST_AT, n: Object.keys(COST).length,
    by: ME.email, saved: serverTimestamp(),
  });
}

// Opening the tab: load the parent names, the listings, the costs and the weekly cache, then draw.
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
  const rec = COST[asin];
  const cost = rec && Number(rec.c);
  return (cost > 0) ? cost : null;
}

/**
 * One row's money, or null when it cannot be worked out honestly.
 *
 * Sales and ad spend are real. Referral, FBA, overhead and salary are the model's percentages of
 * sales; return loss is the model's percentage of the landed cost, exactly as the workbook has it.
 */
function pfMoney(cell, unitCost) {
  const sales = cell.rev || 0;
  const units = cell.u || 0;
  const ads = cell.spend || 0;
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
  const nWeeks = Number($('pfWeeks').value) || 4;
  return (WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26)).slice(-nWeeks);
}

// The rows: one per ASIN (or per parent) with units, sales and ad spend over the weeks picked, its unit
// cost and its money (m, from pfMoney — null when it has no cost), filtered and sorted as the controls say.
function pfRows() {
  // --- the controls ---
  const weeks = new Set(pfWeeks());
  const brand = $('pfBrand').value;
  const search = $('pfFilter').value.trim().toLowerCase();
  const byParent = $('pfView').value === 'parent';
  const have = $('pfHave').value;

  // --- add up the weekly cache per ASIN or per parent ---
  // Summed straight from WEEKLY.rows rather than through wRows(), because that one reads the PPC &
  // Organic tab's own brand and view pickers — this tab has its own, and sharing them would make
  // one tab silently change the other.
  const acc = new Map();
  Object.entries(WEEKLY.rows).forEach(([asin, row]) => {
    const key = byParent ? wParentOf(asin) : asin;
    let entry = acc.get(key);
    if (!entry) {
      entry = {
        key, brand: row.brand || '', title: '', kids: 0,
        rev: 0, u: 0, spend: 0,
        costUnits: 0, costed: 0, kidsNoCost: 0,
      };
      acc.set(key, entry);
    }
    entry.brand = entry.brand || row.brand || '';
    entry.kids++;
    if (!entry.title) {
      entry.title = byParent
        ? (PNAME[entry.brand]?.[key]?.v || HEALTH[entry.brand]?.parentNames?.[key]
          || (wTitle(asin) ? '~ ' + wTitle(asin) : ''))
        : wTitle(asin);
    }
    let rev = 0, u = 0, spend = 0;
    Object.entries(row.weeks || {}).forEach(([wk, figures]) => {
      if (!weeks.has(wk)) return;
      rev += figures.rev || 0;
      u += figures.u || 0;
      spend += figures.spend || 0;
    });
    entry.rev += rev;
    entry.u += u;
    entry.spend += spend;
    /* A PARENT IS COSTED CHILD BY CHILD. Two sizes of the same tablecloth do not cost the same, so
     * the parent's COGS is the sum of each child's own cost × that child's own units — and the
     * units belonging to children with no cost are counted separately, because a parent that is
     * half costed must not be drawn as if it were fully costed. */
    const cost = pfCostOf(asin);
    if (cost) {
      entry.costUnits += u;
      entry.costed += cost * u;
    } else if (u) {
      entry.kidsNoCost++;
    }
  });

  // --- cost each row ---
  let rows = [...acc.values()].map(entry => {
    // At child level the unit cost is the ASIN's own; at parent level it is the weighted average of
    // the children that HAVE one, which is the only average that means anything here.
    const unitCost = byParent
      ? (entry.costUnits > 0 ? entry.costed / entry.costUnits : null)
      : pfCostOf(entry.key);
    // A parent with some children uncosted is costed on the units it CAN account for, and says so.
    const cell = { rev: entry.rev, u: byParent ? (entry.costUnits || entry.u) : entry.u, spend: entry.spend };
    const m = pfMoney(byParent ? { ...cell, rev: entry.rev } : cell, unitCost);
    return { ...entry, asin: entry.key, unitCost, m, partial: byParent && entry.kidsNoCost > 0 && entry.costUnits > 0 };
  });

  // --- filter and sort ---
  if (brand !== 'ALL') rows = rows.filter(row => row.brand === brand);
  if (search) rows = rows.filter(row => (row.asin + ' ' + row.title).toLowerCase().includes(search));
  if (have === 'have') rows = rows.filter(row => row.m);
  else if (have === 'none') rows = rows.filter(row => !row.m && row.rev > 0);
  // Biggest sellers first. Sorting by profit would bury the uncosted rows, which are the ones that
  // most need finding.
  rows.sort((a, b) => b.rev - a.rev);
  return rows;
}

// The KPI strip: the totals over the COSTED rows only, how much of the sales they cover, and a note when
// that is not everything.
function renderProfitKpis(rows) {
  const money = value => (value < 0 ? '-$' : '$') + Math.round(Math.abs(value)).toLocaleString('en-US');
  const costed = rows.filter(row => row.m);
  const salesAll = rows.reduce((acc, row) => acc + row.rev, 0);
  const salesCosted = costed.reduce((acc, row) => acc + row.m.sales, 0);
  const profit = costed.reduce((acc, row) => acc + row.m.profit, 0);
  const cogs = costed.reduce((acc, row) => acc + row.m.cogs, 0);
  const ads = costed.reduce((acc, row) => acc + row.m.ads, 0);
  const cover = salesAll > 0 ? salesCosted / salesAll * 100 : 0;
  const tile = (label, val, colour) => `<div class="metric"><div class="v${colour ? ` ${colour}` : ''}">${val}</div>`
    + `<div class="l">${label}</div></div>`;
  const weeks = pfWeeks();
  $('pfKpis').innerHTML = `<div class="kpi sa-basis-full">
    <div class="kpihead"><span class="kpiname">Profit — ${weeks.length} week(s)</span>
      <span class="kpiwhen">${weeks.length ? weeks[0] + ' → ' + weeks[weeks.length - 1] : 'no weekly data yet'}</span></div>
    <div class="metrics">
      ${tile('Sales (costed rows)', money(salesCosted))}
      ${tile('COGS', money(cogs))}
      ${tile('Ad spend', money(ads))}
      ${tile('Profit', money(profit), profit >= 0 ? 'ui-pos' : 'ui-neg')}
      ${tile('Margin', salesCosted > 0 ? (profit / salesCosted * 100).toFixed(1) + '%' : '—')}
      ${tile('ROI on goods', cogs > 0 ? Math.round(profit / cogs * 100) + '%' : '—')}
      ${tile('Sales covered', Math.round(cover) + '%', cover >= 80 ? 'ui-pos' : 'ui-neg')}
      ${tile('ASINs with no cost', (rows.length - costed.length).toLocaleString('en-US'))}
    </div></div>
    ${cover < 99.5 ? `<div class="ui-note sa-basis-full sa-tuck">
      Every figure above covers ONLY the rows that have a unit cost — ${money(salesAll - salesCosted)} of sales is
      not in them. Filter to <b>Missing a cost</b> to see what is left out; nothing is estimated on your behalf.</div>` : ''}`;
}

// Draw the screen: the KPI strip, the table (top 400 rows by sales) and the message line.
function renderProfit() {
  // --- formatters ---
  const esc = str => String(str == null ? '' : str)
    .replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const money = value => (value < 0 ? '-$' : '$') + Math.round(Math.abs(value)).toLocaleString('en-US');
  const money2 = value => (value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2);
  // --- nothing to cost yet ---
  if (!WEEKLY.at && !Object.keys(WEEKLY.rows).length) {
    $('pfKpis').innerHTML = '';
    $('pfTable').innerHTML = '<tbody><tr><td class="ui-empty">'
      + 'No weekly sales data is cached yet. Open <b>PPC &amp; Organic</b> once and let it load — '
      + 'this tab costs the same figures.'
      + '</td></tr></tbody>';
    return;
  }
  // --- the rows, the KPIs ---
  const rows = pfRows();
  renderProfitKpis(rows);

  // --- the table ---
  const head = '<thead><tr><th>ASIN</th><th>Product</th><th>Brand</th><th class="num">Units</th>'
    + '<th class="num">Sales</th><th class="num">Ad spend</th><th class="num">TACoS</th>'
    + '<th class="num">Unit cost</th><th class="num">COGS</th><th class="num">Fees (est.)</th>'
    + '<th class="num">Other (est.)</th><th class="num">Profit</th><th class="num">Margin</th>'
    + '<th class="num">ROI</th><th class="num">Per unit</th></tr></thead>';

  const body = rows.slice(0, 400).map(row => {
    const m = row.m;   // the row's money (pfMoney), null when it has no unit cost
    const cell = html => `<td class="num">${html}</td>`;
    const costCell = `<td class="num"><span data-pf="${esc(row.asin)}" `
      + `class="pfcost sa-pf-edit"`
      + ` title="${row.unitCost ? 'Landed cost of one unit. Click to change.'
        : 'No unit cost recorded — click to type one. Until then this row has no profit figure.'}">`
      + `${row.unitCost ? money2(row.unitCost) : '<span class="muted">— set —</span>'}</span></td>`;
    // an uncosted row: the real figures, the cost cell, and one wide note instead of the money columns
    if (!m) {
      return `<tr><td class="ui-mono">${esc(row.asin)}</td>`
        + `<td class="ui-name" title="${esc(row.title)}">${esc(String(row.title).slice(0, 40)) || '<span class="ui-dim">—</span>'}</td>`
        + `<td>${row.brand ? esc(BRAND_NAME[row.brand] || row.brand) : '<span class="ui-dim">—</span>'}</td>`
        + cell(Math.round(row.u).toLocaleString('en-US')) + cell(money(row.rev)) + cell(money(row.spend))
        + cell(row.rev > 0 ? (row.spend / row.rev * 100).toFixed(1) + '%' : '<span class="ui-dim">—</span>')
        + costCell
        + `<td class="ui-note" colspan="7">`
        + (row.u ? 'no unit cost — nothing here is guessed' : 'nothing sold in this window')
        + `</td></tr>`;
    }
    const good = m.profit >= 0;
    return `<tr><td class="ui-mono">${esc(row.asin)}</td>`
      + `<td class="ui-name" title="${esc(row.title)}">${esc(String(row.title).slice(0, 40)) || '<span class="ui-dim">—</span>'}</td>`
      + `<td>${row.brand ? esc(BRAND_NAME[row.brand] || row.brand) : '<span class="ui-dim">—</span>'}</td>`
      + cell(Math.round(m.units).toLocaleString('en-US')
          + (row.partial ? ` <span class="ui-note" title="${row.kidsNoCost} child ASIN(s) under this parent `
            + `have no unit cost. Only the units that could be costed are counted here — the rest are left out rather than `
            + `costed at a guess.">part</span>` : ''))
      + cell(money(m.sales)) + cell(money(m.ads))
      + cell(m.tacos == null ? '<span class="ui-dim">—</span>' : m.tacos.toFixed(1) + '%')
      + costCell
      + cell(money(m.cogs))
      + cell(money(m.referral + m.fba))
      + cell(money(m.ret + m.oh + m.sal))
      + `<td class="num ui-strong ${good ? 'ui-pos' : 'ui-neg'}">${money(m.profit)}</td>`
      + cell(m.margin == null ? '<span class="ui-dim">—</span>' : m.margin.toFixed(1) + '%')
      + cell(m.roi == null ? '<span class="ui-dim">—</span>' : Math.round(m.roi) + '%')
      + cell(m.perUnit == null ? '<span class="ui-dim">—</span>' : money2(m.perUnit))
      + '</tr>';
  }).join('');

  $('pfTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="15" class="ui-empty">Nothing matches these filters.</td></tr>')
    + '</tbody>';
  // --- the message line ---
  const nCost = Object.keys(COST).filter(asin => pfCostOf(asin)).length;
  pfMsg(`${rows.length} row(s)${rows.length > 400 ? ' · showing the top 400 by sales' : ''}`
    + ` · ${nCost.toLocaleString('en-US')} ASIN(s) have a unit cost`
    + (COST_AT ? ` · costs last saved ${COST_AT}` : '')
    + ` · fees are the ${PF_MODEL.ref}% / ${PF_MODEL.fba}% model, not Amazon's settled figures.`);
}

/* ---------- typing a cost straight into the table ---------- */
// A click on a Unit cost cell (child view only): ask for the landed cost of one unit, store it (or clear it
// when left empty), redraw and save.
$('pfTable').addEventListener('click', e => {
  const el = e.target.closest('[data-pf]');
  if (!el) return;
  const asin = el.dataset.pf;
  if ($('pfView').value === 'parent') {
    pfMsg('A cost belongs to ONE child ASIN — two sizes of the same product do not cost the same. '
      + 'Switch to “By child ASIN” to type it.', true);
    return;
  }
  const cur = pfCostOf(asin);
  const typed = prompt(`Landed cost of ONE unit of ${asin}, in USD.\n\nGoods + freight + duty — what it costs you to have one `
    + `sitting in an Amazon warehouse. Leave empty to clear it.`,
    cur ? String(cur) : '');
  if (typed === null) return;
  const text = typed.trim();
  if (!text) {
    delete COST[asin];
  } else {
    const value = Number(text.replace(/[^0-9.]/g, ''));
    if (!(value > 0) || value > 100000) {
      pfMsg('A unit cost has to be a positive number of dollars.', true);
      return;
    }
    COST[asin] = { ...(COST[asin] || {}), c: Math.round(value * 100) / 100, at: sdToday(), by: ME.email };
  }
  renderProfit();
  saveCosts().then(() => pfMsg('Saved.')).catch(err => pfMsg('Could not save: ' + (err.message || err), true));
});

// The pickers redraw at once; the filter box waits a quarter of a second after the last keystroke.
['pfBrand', 'pfWeeks', 'pfView', 'pfHave'].forEach(id => $(id).addEventListener('change', renderProfit));
let PF_FILTER_T = null;
$('pfFilter').addEventListener('input', () => {
  clearTimeout(PF_FILTER_T);
  PF_FILTER_T = setTimeout(renderProfit, 250);
});

/* ---------- the cost model ---------- */
// Cost model: fill the dialog's five fields from PF_MODEL and open it.
function pfModelOpen() {
  $('pmRef').value = PF_MODEL.ref;
  $('pmFba').value = PF_MODEL.fba;
  $('pmRet').value = PF_MODEL.ret;
  $('pmOh').value = PF_MODEL.oh;
  $('pmSal').value = PF_MODEL.sal;
  pfModelNote();
  $('pfModelModal').classList.remove('hide');
}
// The note under the fields: what the percentages add up to, with a warning at 100 % or more.
function pfModelNote() {
  const field = id => Number($(id).value) || 0;
  const ofSales = field('pmRef') + field('pmFba') + field('pmOh') + field('pmSal');
  $('pmNote').innerHTML = `Together these take <b>${ofSales.toFixed(1)}%</b> of every dollar of sales,`
    + ` plus ${field('pmRet').toFixed(1)}% of the landed cost, before ad spend and the goods themselves.`
    + (ofSales >= 100
      ? ' <span class="ui-neg">That is all of it or more — every row will show a loss.</span>' : '');
}
['pmRef', 'pmFba', 'pmRet', 'pmOh', 'pmSal'].forEach(id => $(id).addEventListener('input', pfModelNote));
$('pfModel').onclick = pfModelOpen;
$('pmCancel').onclick = () => $('pfModelModal').classList.add('hide');
// Workbook defaults: put the default percentages back into the fields (not saved until Save).
$('pmReset').onclick = () => {
  Object.entries(PF_DEFAULT_MODEL).forEach(([key, value]) => {
    $('pm' + key[0].toUpperCase() + key.slice(1)).value = value;
  });
  pfModelNote();
};
// Save: the five fields become the model, the screen is redrawn on it, and it is saved with the costs.
$('pmSave').onclick = async () => {
  const field = id => Math.max(0, Number($(id).value) || 0);
  PF_MODEL = { ref: field('pmRef'), fba: field('pmFba'), ret: field('pmRet'), oh: field('pmOh'), sal: field('pmSal') };
  $('pfModelModal').classList.add('hide');
  renderProfit();
  try {
    await saveCosts();
    pfMsg('Cost model saved — every row is costed on it.');
  } catch (err) {
    pfMsg('Could not save the model: ' + (err.message || err), true);
  }
};

/* ---------- importing unit costs ----------
 * ADDS AND UPDATES, never replaces. An ASIN the file does not mention keeps the cost it had: a
 * costing sheet usually covers one range at a time, and wiping the rest to import a dozen rows
 * would destroy months of typing that nothing can regenerate. */
const PF_IMP_COLS = [
  { k: 'asin', t: 'ASIN', need: true, alias: ['child asin', 'product asin', 'asin1'] },
  { k: 'c', t: 'Unit cost USD', need: true,
    alias: ['unit cost', 'landed cost', 'cost', 'cost usd', 'landed', 'landed cost usd'] },
  { k: 'note', t: 'Note', need: false, alias: ['notes', 'remark', 'remarks', 'comment', 'product'] },
];
let PF_IMP_STAGED = null;   // the rows read from the chosen file, waiting for Import

// Import costs: open the dialog clean.
$('pfImport').onclick = () => {
  PF_IMP_STAGED = null;
  $('pfImpPrev').classList.add('hide');
  $('pfImpErr').classList.add('hide');
  $('pfImpSave').disabled = true;
  $('pfImpModal').classList.remove('hide');
};
// Close it: Cancel, or a click on the backdrop. Choose CSV… opens the hidden file picker.
$('pfImpCancel').onclick = () => $('pfImpModal').classList.add('hide');
$('pfImpModal').onclick = e => {
  if (e.target === $('pfImpModal')) $('pfImpModal').classList.add('hide');
};
$('pfImpPick').onclick = () => $('pfImpFile').click();

// Download template: a CSV with the three column names and two example rows.
$('pfImpTemplate').onclick = () => {
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  // The examples carry REAL landed costs out of the costing workbook, so the column is unmistakable:
  // it is dollars per single unit, not per set, not the selling price.
  const ex = [
    ['B0CR91CFCJ', '8.64', 'CLOTH_NAPKIN_EMBROIDER 18x18 set of 4 — goods + freight + duty'],
    ['B0C625C9RP', '4.57', 'CLOTH_NAPKIN 20x20 set of 4'],
  ];
  const lines = [PF_IMP_COLS.map(col => col.t).map(cell).join(',')]
    .concat(ex.map(row => row.map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'unit-costs-template.csv';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

// A file was chosen: read it, find the columns (by name or alias), check every row, and show a preview of
// what Import would do. Nothing is stored until Import is pressed.
$('pfImpFile').onchange = async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const esc = str => String(str == null ? '' : str)
    .replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  // a red note in the dialog, and Import stays disabled
  const err = text => {
    $('pfImpErr').innerHTML = text;
    $('pfImpErr').classList.remove('hide');
    $('pfImpSave').disabled = true;
  };
  $('pfImpErr').classList.add('hide');
  $('pfImpPrev').classList.add('hide');
  PF_IMP_STAGED = null;
  try {
    // --- the columns ---
    const rows = dParseCsv(await file.text());
    if (rows.length < 2) {
      err('That file has no rows under its header.');
      return;
    }
    const head = rows[0].map(heading => String(heading).trim().toLowerCase());
    const at = {};   // column key → its index in the file
    PF_IMP_COLS.forEach(col => {
      let idx = head.indexOf(col.t.toLowerCase());
      if (idx < 0) {
        for (const alias of col.alias) {
          const i = head.indexOf(alias);
          if (i >= 0) {
            idx = i;
            break;
          }
        }
      }
      if (idx >= 0) at[col.k] = idx;
    });
    const missing = PF_IMP_COLS.filter(col => col.need && at[col.k] == null).map(col => col.t);
    if (missing.length) {
      err('These columns are required and were not found: <b>' + esc(missing.join(', ')) + '</b>. '
        + 'The file has: ' + esc(head.filter(Boolean).slice(0, 18).join(', '))
        + '. Download the template to see the names it looks for.');
      return;
    }
    // --- the rows: good ones become { asin, c, note }, bad ones a line of explanation ---
    const cellOf = (row, key) => (at[key] == null ? '' : String(row[at[key]] == null ? '' : row[at[key]]).trim());
    const good = [], bad = [];
    rows.slice(1).forEach((row, i) => {
      if (!row.some(field => String(field || '').trim())) return;
      const line = i + 2;
      const asin = cellOf(row, 'asin').toUpperCase();
      const raw = cellOf(row, 'c');
      const cost = Number(raw.replace(/[^0-9.\-]/g, ''));
      if (!D_ASIN_RE.test(asin)) {
        bad.push(`line ${line}: “${cellOf(row, 'asin').slice(0, 14)}” is not an ASIN`);
        return;
      }
      if (!(cost > 0)) {
        bad.push(`line ${line}: “${raw.slice(0, 12)}” is not a cost`);
        return;
      }
      if (cost > 100000) {
        bad.push(`line ${line}: ${raw.slice(0, 12)} is too large to be one unit`);
        return;
      }
      good.push({ asin, c: Math.round(cost * 100) / 100, note: cellOf(row, 'note').slice(0, 120) });
    });
    if (!good.length) {
      err('Nothing in that file could be used.<br>' + esc(bad.slice(0, 8).join(' · ')) + (bad.length > 8 ? ' …' : ''));
      return;
    }
    // --- what Import would do ---
    const byAsin = new Map();
    let dup = 0;
    good.forEach(entry => {
      if (byAsin.has(entry.asin)) dup++;
      byAsin.set(entry.asin, entry);
    });
    const list = [...byAsin.values()];
    const changing = list.filter(entry => pfCostOf(entry.asin) && pfCostOf(entry.asin) !== entry.c);
    const isNew = list.filter(entry => !pfCostOf(entry.asin));
    // A cost against an ASIN that has never sold is not an error — it may sell next week — but it is
    // also the shape of a file keyed by the wrong column, so it is counted out loud.
    const unsold = list.filter(entry => !WEEKLY.rows[entry.asin]);

    // --- the preview ---
    PF_IMP_STAGED = list;
    $('pfImpPrev').classList.remove('hide');
    $('pfImpPrev').innerHTML =
      `<div><b>${list.length} ASIN(s)</b> ready — ${isNew.length} new, ${changing.length} changing a cost already stored.</div>`
      + (dup ? `<div class="ui-note mt-4">${dup} row(s) repeat an ASIN earlier in the file — `
        + `the last one wins.</div>` : '')
      + (changing.length ? `<div class="sa-small mt-4">Changing, for example: `
        + `${changing.slice(0, 3).map(entry => `${esc(entry.asin)} $${pfCostOf(entry.asin).toFixed(2)} → $${entry.c.toFixed(2)}`).join(', ')}`
        + `${changing.length > 3 ? ' …' : ''}</div>` : '')
      + (unsold.length ? `<div class="ui-neg sa-small mt-4">${unsold.length} ASIN(s) have no sales `
        + `in the weekly cache at all (${unsold.slice(0, 3).map(entry => esc(entry.asin)).join(', ')}${unsold.length > 3 ? '…' : ''}). `
        + `Fine if they are new — but if most of the file is like this, check that the ASIN column is really ASINs.</div>` : '')
      + (bad.length ? `<div class="ui-neg sa-small mt-4">${bad.length} row(s) will be skipped — `
        + `${esc(bad.slice(0, 5).join(' · '))}${bad.length > 5 ? ' …' : ''}</div>` : '')
      + `<div class="ui-note mt-8">An ASIN this file does not mention keeps the cost it already has. `
      + `Nothing is cleared.</div>`;
    $('pfImpSave').disabled = false;
  } catch (e2) {
    err('Could not read that file: ' + esc(e2.message || e2));
  }
};

// Import: the previewed rows go into COST (a note too, when the file had one), then redraw and save.
$('pfImpSave').onclick = async () => {
  if (!PF_IMP_STAGED || !PF_IMP_STAGED.length) return;
  let added = 0, updated = 0;
  PF_IMP_STAGED.forEach(entry => {
    if (pfCostOf(entry.asin)) updated++; else added++;
    COST[entry.asin] = { ...(COST[entry.asin] || {}), c: entry.c, at: sdToday(), by: ME.email };
    if (entry.note) COST[entry.asin].note = entry.note;
  });
  PF_IMP_STAGED = null;
  $('pfImpModal').classList.add('hide');
  renderProfit();
  try {
    await saveCosts();
    pfMsg(`Imported — ${added} new, ${updated} updated.`);
  } catch (err) {
    pfMsg('Could not save the import: ' + (err.message || err), true);
  }
};

// Export: every row of pfRows (not just the 400 on screen) as CSV, with the fee estimates broken out.
$('pfExport').onclick = () => {
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const round2 = value => (value == null ? '' : Math.round(value * 100) / 100);
  const lines = [['ASIN', 'Product', 'Brand', 'Units', 'Sales', 'Ad spend', 'TACoS %', 'Unit cost',
    'COGS', 'Referral (est.)', 'FBA (est.)', 'Return loss (est.)', 'Overhead (est.)', 'Salary (est.)',
    'Profit', 'Margin %', 'ROI %', 'Profit per unit', 'Costed'].map(cell).join(',')];
  pfRows().forEach(row => {
    const m = row.m;
    lines.push([row.asin, row.title, row.brand ? (BRAND_NAME[row.brand] || row.brand) : '',
      Math.round(row.u), round2(row.rev), round2(row.spend), row.rev > 0 ? round2(row.spend / row.rev * 100) : '',
      round2(row.unitCost), m ? round2(m.cogs) : '', m ? round2(m.referral) : '', m ? round2(m.fba) : '',
      m ? round2(m.ret) : '', m ? round2(m.oh) : '', m ? round2(m.sal) : '',
      m ? round2(m.profit) : '', m ? round2(m.margin) : '', m ? Math.round(m.roi) : '', m ? round2(m.perUnit) : '',
      m ? 'yes' : 'no unit cost'].map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `profit-${dToday()}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};


