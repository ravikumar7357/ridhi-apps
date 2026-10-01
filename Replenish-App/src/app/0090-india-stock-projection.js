/* ================= INDIA STOCK — PROJECTION =================
 * The stock list answers "what have we got". This answers the question that actually decides a
 * purchase order: month by month, how much of the India stock gets eaten, when it runs out, and
 * what is left for fresh production to cover once the goods already being made are counted.
 *
 * The cascade per month is deliberate and in this order:
 *   1. India stock   — already paid for and sitting there; nothing should be made while it exists
 *   2. In production — already committed; the money is spent whether it is needed or not
 *   3. Fresh production — the only figure that is a decision, so it is what the tab is really for
 *
 * Both balances CARRY between months: stock left over in August is still there in September. That
 * is why this cannot be read off the per-month requirement columns — those treat every month alone.
 */
let IN_MODE = 'list';

// A production batch is only usable once it can be SOLD, not once it is made: ready date + the time
// to get it out of India + a sea leg. Sea, not air, because that is what a plan should assume — if
// air is the intent, the units arrive earlier than planned, which is the harmless direction to be
// wrong in.
function inProdArrivalMonth(readyStr) {
  if (!readyStr) return -1;                       // no date given → cannot be credited to any month
  const ms = new Date(String(readyStr).trim() + 'T00:00:00').getTime();
  if (isNaN(ms)) return -1;
  const land = ms + (LEAD.disp + LEAD.sea) * DAY_MS;
  for (let i = 0; i < FC_PLAN.length; i++) {
    const p = FC_PLAN[i];
    // A month's stock has to be there at its start; the current month is "now".
    const need = i === 0 ? midnightMs() : new Date(p.y, p.m, 1).getTime();
    if (land <= need) return i;
  }
  return FC_PLAN.length;                          // lands after the horizon — real, but too late
}

function indiaProjRows() {
  const rmap = replRowMap(), pmap = inProdMap();
  const b = $('inBrand').value;
  const fSub = $('inSubcat').value, fCol = $('inColor').value, fSku = $('inSku').value.trim().toLowerCase();

  // Every SKU that has India stock OR something being made OR a shortfall to cover. Starting only
  // from the uploaded list would hide the SKUs that need production precisely BECAUSE India has none.
  const keys = new Set();
  INDIA_ROWS.forEach(r => { const k = String(r.sku || '').trim().toUpperCase(); if (k) keys.add(k); });
  Object.keys(pmap).forEach(k => keys.add(k));

  const out = [];
  keys.forEach(key => {
    const m = rmap[key] || null;
    const india0 = indiaNum(key);
    const p = pmap[key] || { qty: 0, start: '', ready: '', sup: [] };
    const stopped = m ? isStopped(m) : false;
    // A stopped SKU is never re-ordered, so it has no requirement to eat the stock — but the stock
    // and anything already in production still exist, and hiding them would lose real units.
    const fc = (m && !stopped) ? fcFor(m) : [];

    let india = india0, prod = 0;
    const arrival = inProdArrivalMonth(p.ready);
    const usedByMonth = [], shortByMonth = [];
    let usedTotal = 0, fromProd = 0, fresh = 0;

    for (let i = 0; i < FC_PLAN.length; i++) {
      if (i === arrival) prod += p.qty;            // the batch becomes usable this month
      const need = Math.max(0, -((fc[i] || {}).exc || 0));
      const fromIndia = Math.min(need, india); india -= fromIndia; usedTotal += fromIndia;
      let rem = need - fromIndia;
      const fp = Math.min(rem, prod); prod -= fp; fromProd += fp; rem -= fp;
      fresh += rem;
      usedByMonth.push(fromIndia);
      shortByMonth.push(rem);
    }

    const row = {
      sku: (m && m.sku) || (INDIA_ROWS.find(r => String(r.sku || '').trim().toUpperCase() === key) || {}).sku || key,
      key, brand: m ? m.brand : '', subcat: m ? (m.subcat || '') : '', color: m ? (m.color || '') : '',
      india0, usedByMonth, shortByMonth, usedTotal, indiaLeft: india,
      prodQty: p.qty, ready: p.ready, supplier: p.sup.join(', '), arrival,
      fromProd, prodLeft: prod, fresh, stopped, known: !!m,
      // The month the stock runs dry — the single most useful thing on the row, because it is the
      // deadline for a decision rather than a quantity to argue about.
      outAt: (() => { let bal = india0; for (let i = 0; i < usedByMonth.length; i++) { bal -= usedByMonth[i]; if (bal <= 0 && india0 > 0) return i; } return -1; })(),
    };
    if (b !== 'ALL' && row.brand !== b) return;
    if (fSub && row.subcat !== fSub) return;
    if (fCol && row.color !== fCol) return;
    if (fSku && !String(row.sku).toLowerCase().includes(fSku)) return;
    if (!row.india0 && !row.prodQty && !row.fresh) return;   // nothing to say about this SKU
    out.push(row);
  });
  // Biggest fresh-production need first: that is the list somebody has to act on.
  out.sort((a, b2) => (b2.fresh - a.fresh) || (b2.india0 - a.india0));
  return out;
}

function renderIndiaProj() {
  if (!FC_PLAN.length) {
    $('inProjTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">No forecast yet — open Replenishment and hit “Refresh from sheet” first.</td></tr></tbody>';
    return;
  }
  const rows = indiaProjRows();
  IN_LAST = rows;
  const horizon = FC_PLAN[FC_PLAN.length - 1].label;

  const tot = f => rows.reduce((s, r) => s + f(r), 0);
  const totIndia = tot(r => r.india0), totUsed = tot(r => r.usedTotal), totLeft = tot(r => r.indiaLeft);
  const totProd = tot(r => r.prodQty), totFresh = tot(r => r.fresh);
  const outOfStock = rows.filter(r => r.outAt >= 0).length;

  $('inKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">India Stock — projected use through ${esc(horizon)}</span>
      <span class="kpiwhen">${esc(INDIA_AT ? (INDIA_CACHED ? 'last read ' + INDIA_AT + ' — reading the warehouse now' : 'live · read ' + INDIA_AT) : 'not read yet')} · sea lane assumed for goods in production</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(totIndia)}</div><div class="l">India stock today</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(totUsed)}</div><div class="l">Used by ${esc(horizon)}</div></div>
      <div class="metric"><div class="v">${nf(totLeft)}</div><div class="l">Still left after</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(outOfStock)}</div><div class="l">SKUs that run dry</div></div>
      <div class="metric"><div class="v">${nf(totProd)}</div><div class="l">Already in production</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(totFresh)}</div><div class="l">Fresh production needed</div></div>
    </div></div>`;

  const cols = ['SKU', 'Brand', 'Sub-Category', 'India Stock', ...FC_PLAN.map(p => p.label),
    'India left', 'In Production', 'Ready', 'Covered by prod.', 'Fresh production'];
  const numFrom = 3;
  const head = '<thead><tr>' + cols.map((h, i) =>
    `<th${i === 0 ? ' class="frz"' : (i >= numFrom && i !== cols.length - 2 ? ' class="num"' : '')}${
      i >= numFrom && i < numFrom + 1 + FC_PLAN.length && i > numFrom
        ? ` title="Units of India stock consumed in ${esc(FC_PLAN[i - numFrom - 1] ? FC_PLAN[i - numFrom - 1].label : '')}"` : ''}>${esc(h)}</th>`).join('')
    + '</tr></thead>';

  const sub = rows.length ? '<tr style="font-weight:700;background:#eef2ff">'
    + `<td class="frz" style="background:#eef2ff">SUBTOTAL · ${nf(rows.length)}</td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td>`
    + `<td class="num" style="background:#eef2ff">${nf(totIndia)}</td>`
    + FC_PLAN.map((p, i) => `<td class="num" style="background:#eef2ff">${nf(tot(r => r.usedByMonth[i] || 0))}</td>`).join('')
    + `<td class="num" style="background:#eef2ff">${nf(totLeft)}</td>`
    + `<td class="num" style="background:#eef2ff">${nf(totProd)}</td><td style="background:#eef2ff"></td>`
    + `<td class="num" style="background:#eef2ff">${nf(tot(r => r.fromProd))}</td>`
    + `<td class="num" style="background:#eef2ff">${nf(totFresh)}</td></tr>` : '';

  const body = rows.slice(0, 300).map(r => {
    const monthCells = r.usedByMonth.map((u, i) => {
      const dry = i === r.outAt;
      const short = r.shortByMonth[i];
      const tip = `${nf(u)} from India${short > 0 ? ` · ${nf(short)} still short this month` : ''}`;
      return `<td class="num"${dry ? ' style="background:#fef2f2"' : ''} title="${esc(tip)}">`
        + (u ? nf(u) : '<span class="muted">—</span>')
        + (dry ? ' <span class="fu fu-red" title="India stock runs out in this month">dry</span>' : '')
        + '</td>';
    }).join('');
    return `<tr>
      <td class="frz" style="font-family:ui-monospace,monospace">${esc(r.sku)}${
        r.stopped ? ' <span class="st st-stop" title="Discontinued / use-in-mix — no future projection, so nothing is consumed">stopped</span>' : ''}</td>
      <td>${BRAND_NAME[r.brand] || '<span class="muted">—</span>'}</td>
      <td>${esc(r.subcat || '—')}</td>
      <td class="num"${r.india0 > 0 ? ' style="color:#166534;font-weight:700"' : ''}>${nf(r.india0)}</td>
      ${monthCells}
      <td class="num"${r.indiaLeft > 0 ? '' : ' style="color:var(--bad)"'}>${nf(r.indiaLeft)}</td>
      <td class="num"${r.prodQty > 0 ? ' style="font-weight:700"' : ''}>${r.prodQty ? nf(r.prodQty) : '<span class="muted">—</span>'}</td>
      <td${r.prodQty && r.arrival < 0 ? ' title="The order behind these pieces promised no delivery date, so they cannot be credited to a month — they are counted in the total only"' : ''}>${
        esc(r.ready || (r.prodQty ? '⚠ no date' : '—'))}</td>
      <td class="num">${r.fromProd ? nf(r.fromProd) : '<span class="muted">—</span>'}</td>
      <td class="num"${r.fresh > 0 ? ' style="color:var(--bad);font-weight:700"' : ' style="color:#166534"'}>${nf(r.fresh)}</td>
    </tr>`;
  }).join('');

  $('inProjTable').innerHTML = head + '<tbody>' + (sub + body
    || `<tr><td colspan="${cols.length}" class="muted" style="padding:14px">Nothing to project — upload India stock, or run “Refresh from sheet” on Replenishment.</td></tr>`)
    + '</tbody>';
  $('inMsg').textContent = rows.length > 300
    ? `showing first 300 of ${nf(rows.length)} — filter to narrow (subtotal and KPIs cover all ${nf(rows.length)})`
    : `${nf(rows.length)} SKU(s)`;
}

function inSetMode(mode) {
  IN_MODE = mode;
  $('inModeList').classList.toggle('on', mode === 'list');
  $('inModeProj').classList.toggle('on', mode === 'proj');
  $('inListCard').classList.toggle('hide', mode !== 'list');
  $('inProjCard').classList.toggle('hide', mode !== 'proj');
  // The Show buckets are about the uploaded list, not about a forecast.
  $('inShow').classList.toggle('hide', mode === 'proj');
  renderIndiaAny();
}
function renderIndiaAny() { if (IN_MODE === 'proj') renderIndiaProj(); else renderIndia(); }
$('inModeList').onclick = () => inSetMode('list');
$('inModeProj').onclick = () => inSetMode('proj');

['inBrand', 'inSubcat', 'inColor', 'inShow'].forEach(id => $(id).addEventListener('change', renderIndiaAny));
$('inSku').addEventListener('input', debounced(renderIndiaAny));
// Clicking the "Not on Amazon" KPI tile jumps straight to that bucket (click again to clear).
$('inKpis').addEventListener('click', e => {
  const t = e.target.closest('.kpiclick'); if (!t) return;
  $('inShow').value = $('inShow').value === t.dataset.show ? 'all' : t.dataset.show;
  renderIndia();
});
$('inTemplate').onclick = () => csvDownload('india-stock-template', IN_COLS, [['ABC-123', '50'], ['XYZ-456', '0']]);
$('inExport').onclick = () => {
  // Whichever view is on screen is what gets exported — exporting the other one would be a surprise
  // nobody notices until the file is already in somebody else's inbox.
  if (IN_MODE === 'proj') {
    return csvDownload('india-stock-projection',
      ['SKU', 'Brand', 'Sub-Category', 'India Stock', ...FC_PLAN.map(p => p.label + ' used'),
       'India left', 'In Production', 'Ready', 'Covered by production', 'Fresh production needed'],
      IN_LAST.map(r => [r.sku, BRAND_NAME[r.brand] || '', r.subcat, r.india0, ...r.usedByMonth,
        r.indiaLeft, r.prodQty, r.ready, r.fromProd, r.fresh]));
  }
  csvDownload('india-stock', ['SKU', 'India Stock', 'Brand', 'Sub-Category', 'Color', 'Size'],
    IN_LAST.map(r => [r.sku, r.qty, BRAND_NAME[r.brand] || '', r.subcat, r.color, r.size]));
};
/* The Import button is DISABLED, not removed.
 *
 * India stock is now read live from the warehouse workbook, so an upload here would write a Firestore
 * document nothing reads — and the person who uploaded would believe the numbers had changed. Leaving
 * the button visible and explaining why is better than removing it and leaving somebody hunting for
 * where the upload went. Export still works: exporting what is on screen is still useful. */
$('inImport').disabled = true;
$('inImport').title = 'India stock is now read live from the Ready Goods workbook, so there is nothing to upload. '
  + 'Change the numbers there and press Refresh here.';
$('inImport').onclick = () => {
  $('inMsg').textContent = 'India stock comes straight from the Ready Goods workbook now — edit it there, '
    + 'then hit Refresh. An upload here would be stored and never read.';
};
const _inImportDisabled = () => $('inFile').click();
$('inFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { $('inMsg').textContent = 'File is empty.'; return; }
    const head = rows[0].map(h => h.trim().toLowerCase());
    const iSku = colIdx(head, ['sku']), iQty = colIdx(head, ['india stock', 'stock', 'qty', 'quantity', 'india qty']);
    if (iSku < 0 || iQty < 0) { $('inMsg').textContent = 'CSV needs a "SKU" column and an "India Stock" (or Qty) column.'; return; }
    const seen = new Map();
    for (let i = 1; i < rows.length; i++) {
      const sku = cellAt(rows[i], iSku); if (!sku) continue;
      const qty = Number(String(cellAt(rows[i], iQty)).replace(/[, ]/g, '')) || 0;
      seen.set(sku.toUpperCase(), { sku, qty });          // last row for a SKU wins
    }
    const list = [...seen.values()];
    if (!list.length) { $('inMsg').textContent = 'No valid rows found.'; return; }
    if (!confirm(`Replace the India Stock list with ${list.length} SKU(s) from this file?\n\nThis REPLACES the whole list (it is a full snapshot, not a merge).`)) return;
    $('inMsg').textContent = 'Saving…';
    await saveIndiaStock(list);
    INDIA_ROWS = list; INDIA_AT = new Date(); buildIndiaMap();
    renderIndia();
    // Other tabs show India Stock too — refresh whichever is already built.
    if (PO_LOADED) renderFollow();
    if (PROD_LOADED && ['SP', 'CPC'].some(b => REPL[b])) renderTop();
    $('inMsg').textContent = `Imported ${list.length} SKU(s).`; setTimeout(() => { $('inMsg').textContent = ''; }, 2500);
  } catch (err) { $('inMsg').textContent = 'Import failed: ' + (err.message || err); }
};

/* ================= IN PRODUCTION (from the Order Console) ================= */
// What the factories are currently making. Cross-checked against the ongoing POs and the backend's
// Air/Sea/AWD requirement so a SKU being made for NO reason is caught before the money is spent.
const PD_COLS = ['SKU', 'Qty', 'Start Date', 'Ready Date', 'Supplier'];
const PD_ROW_CAP = 200;   // only the painted tbody is capped; subtotal / KPIs / Export use every row
const PD_CHUNK = 900;
let INPROD_ROWS = [], INPROD_AT = null, INPROD_LOADED = false, PD_LAST = [], INPROD_ERR = '';
/**
 * READ THE ORDER BOOK AND THE REGISTERS, then build the list from them.
 *
 * pt_salesOrders is read straight rather than through ensureSox, which would paint the Sales Orders
 * screen as a side effect of opening Replenishment.
 *
 * A FAILED READ LEAVES THE LIST EMPTY AND SAYS WHY. An empty In Production column makes the forecast
 * ask for production that may already be running, so this is the one case where the screen has to
 * carry the reason rather than quietly show a dash.
 */
async function loadInProd() {
  INPROD_ROWS = []; INPROD_AT = null; INPROD_ERR = '';
  try {
    if (!PTG.mdb) await ptLoadGates();
    if (PTG.err) throw new Error(PTG.err);
    if (SOX.rows === null) SOX.rows = ptList(await ptGet('pt_salesOrders'));
    INPROD_ROWS = ordProdRows();
    INPROD_AT = new Date();
  } catch (e) { INPROD_ROWS = []; INPROD_ERR = e.message || String(e); }
  INPROD_LOADED = true;
}
async function ensureProd() {
  $('pdMsg').textContent = 'Loading…';
  await ensureReplData();
  buildFbaMap(); CATALOG_SET = catalogSet();
  if (!PO_LOADED) { await loadPo(); PO_LOADED = true; }
  if (!INDIA_LOADED) await loadIndiaStock();
  if (!PROD_LOADED) await loadProd();          // status overrides decide which SKUs are stopped
  if (!INPROD_LOADED) await loadInProd();
  if (!FC_PLAN.length) { FC_PLAN = buildFcPlan([...new Set(['SP', 'CPC'].flatMap(b => (REPL[b] && REPL[b].recCols) || []))]); FC_CACHE = new Map(); }
  $('pdMsg').textContent = '';
  renderProd();
}
// Units of a SKU currently being made, plus its dates/supplier. A SKU can appear on several uploaded
// rows (two factories, two batches) — quantities add up, the window spans earliest start → latest ready.
function inProdMap() {
  const m = {};
  INPROD_ROWS.forEach(r => {
    const k = String(r.sku || '').trim().toUpperCase(); if (!k) return;
    const e = m[k] || (m[k] = { qty: 0, start: '', ready: '', sup: [], parts: [], noDate: 0 });
    const q = Number(r.qty) || 0;
    e.qty += q;
    const s = String(r.start || '').trim(), rd = String(r.ready || '').trim(), sp = String(r.supplier || '').trim();
    if (s && (!e.start || s < e.start)) e.start = s;
    if (rd && (!e.ready || rd > e.ready)) e.ready = rd;
    if (sp && !e.sup.includes(sp)) e.sup.push(sp);
    /* WHERE THE TOTAL CAME FROM, kept alongside it.
     *
     * Several uploaded rows for one SKU are added up — two factories, two batches — and that is
     * right. But the table then shows one number with nothing to say it was a sum, so an upload that
     * accidentally lists a SKU twice looks exactly like the app inventing units. It cost a round of
     * "I uploaded 1,623 and it shows 2,483". The parts ride along so the cell can show its working.
     *
     * `noDate` counts the units that carry no Ready Date. Those are INVISIBLE to the forecast — see
     * inProdReadyMap — so the plan behaves as though they are not being made at all. */
    e.parts.push({ q: q, ready: rd, supplier: sp });
    if (!rd) e.noDate += q;
  });
  return m;
}
// Total units short across the whole forecast horizon. Each month's shortfall is its own gap (a negative
// excess floors to 0 going into the next month), so they add up.
const fcShortfall = fc => (fc || []).reduce((s, f) => s + Math.max(0, -f.exc), 0);

/* ---------- Which LANE can still cover each month's shortfall (sea / air / too late) ---------- */
// (LEAD + loadLead live with the other globals at the top — the toolbar wiring reads them during
// module evaluation, long before this point, and a `let` down here would sit in the temporal dead zone.)
const DAY_MS = 86400000;
const midnightMs = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); };
// "21 Oct", or "21 Oct '27" once it crosses into another year — short enough to sit inside a tag.
const MON_CAP = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dShort(ms) {
  const d = new Date(ms), y = d.getFullYear();
  return d.getDate() + ' ' + MON_CAP[d.getMonth()] + (y !== new Date().getFullYear() ? " '" + String(y).slice(2) : '');
}
// Earliest ready date per SKU from the uploaded In Production list (earliest wins), pre-parsed to ms.
let INPROD_READY = {}, INPROD_GUESSED = {};
/**
 * SKU → the earliest moment a batch already being made is READY.
 *
 * A row with no Ready Date used to be dropped here entirely, and that was the bug: the units stayed
 * in the "In Production" total but were credited to no month, so "← Production" read as a dash and
 * "Produce" asked for a fresh run of goods already on a machine. Nothing said so.
 *
 * Dropping them is not the only option, and it is the worst one — it is the single case guaranteed to
 * make you pay for the same units twice. So an undated batch is ASSUMED to take a full production
 * cycle from today (LEAD.prod), which is what a fresh run would take. That is deliberately the
 * pessimistic end: if the batch is in fact nearly finished the plan is merely early, whereas
 * assuming it lands sooner than it does leaves a real shortage.
 *
 * A guess is never passed off as a date. `INPROD_GUESSED` marks these SKUs and every cell built on
 * one says it is an assumption and asks for the Ready Date.
 */
function inProdReadyMap() {
  const m = {}; INPROD_GUESSED = {};
  const guess = midnightMs() + (LEAD.prod || 0) * DAY_MS;
  INPROD_ROWS.forEach(r => {
    const k = String(r.sku || '').trim().toUpperCase(); if (!k) return;
    if (!(Number(r.qty) > 0)) return;
    /* pdIso FIRST. "29-09-2026" is a date; new Date("29-09-2026T00:00:00") is not, and every row of
     * the old workbook fell into the guess below because of it. */
    const d = pdIso(r.ready);
    let ms = d ? new Date(d + 'T00:00:00').getTime() : NaN;
    if (isNaN(ms)) { ms = guess; INPROD_GUESSED[k] = true; }
    if (m[k] == null || ms < m[k]) m[k] = ms;
  });
  return m;
}
// Everything the lane decision needs that is the SAME for every row — built ONCE per render. Doing this
// per row meant ~43k Date allocations (4.7k rows × 9 months) on every sort/filter, which is what made
// the grid feel heavy. With this, fcLanes() is pure integer comparison.
let LANE_CTX = null;
function buildLaneCtx() {
  const today = midnightMs();
  return {
    today,
    ready0: today,                                   // India stock: the goods already exist
    readyNew: today + LEAD.prod * DAY_MS,            // nothing anywhere: a fresh run must start
    disp: LEAD.disp * DAY_MS,
    air: LEAD.air * DAY_MS,
    sea: LEAD.sea * DAY_MS,
    // A month's stock is needed at its START; the current month is needed now.
    needBy: FC_PLAN.map((p, i) => i === 0 ? today : new Date(p.y, p.m, 1).getTime()),
  };
}
// When fresh stock can LEAVE India = when the goods are ready + the dispatch time:
//   · India stock on hand   → today       + disp
//   · already in production → its Ready Date + disp
//   · neither               → today + prod + disp
function shipFromMs(key, C) {
  if ((INDIA_STOCK[key] || 0) > 0) return C.ready0 + C.disp;
  const rd = INPROD_READY[key];
  if (rd != null) return (rd > C.today ? rd : C.today) + C.disp;
  return C.readyNew + C.disp;
}
// For each forecast month with a shortfall: can SEA still land in time? else AIR? else nothing will.
// Air-excluded sub-categories (lampshade / quilt / chair pad / seat cushion / insert) can never fly,
// so for them it is sea or nothing.
function fcLanes(r, fc) {
  const C = LANE_CTX || (LANE_CTX = buildLaneCtx());
  const from = shipFromMs(String(r.sku || '').trim().toUpperCase(), C);
  const seaLand = from + C.sea, airLand = from + C.air;
  const excluded = !!r.airExcluded;
  // Per month we report the DISPATCH DEADLINE — the last day goods can leave India and still be
  // sellable when that month needs them (month need-by − transit days). That is the date you can act
  // on; the FBA landing date is just the month itself.
  //   byDate[i] = that deadline for the lane the month fell into
  //   seaBy / airBy = the EARLIEST deadline across the months in each lane, i.e. the next one to hit
  const out = { air: 0, sea: 0, late: 0, by: [], byDate: [], from, seaLand, airLand, seaBy: null, airBy: null };
  const n = fc ? fc.length : 0;
  for (let i = 0; i < n; i++) {
    const short = fc[i].exc < 0 ? -fc[i].exc : 0;
    if (!short) { out.by.push(''); out.byDate.push(null); continue; }
    const needBy = C.needBy[i];
    const seaShip = needBy - C.sea, airShip = needBy - C.air;   // leave India by these to make it
    if (from <= seaShip) {
      out.sea += short; out.by.push('sea'); out.byDate.push(seaShip);
      if (out.seaBy == null || seaShip < out.seaBy) out.seaBy = seaShip;
    } else if (!excluded && from <= airShip) {
      out.air += short; out.by.push('air'); out.byDate.push(airShip);
      if (out.airBy == null || airShip < out.airBy) out.airBy = airShip;
    } else {
      out.late += short; out.by.push('late');
      out.byDate.push(excluded ? seaShip : airShip);            // the deadline that has already gone
    }
  }
  return out;
}

// The verdict. `need` is whichever basis the user picked; cover = India + ongoing PO + production.
// FBA stock is deliberately NOT in cover — the requirement figures already net it out.
// Numbers only — no strings. This runs for every SKU on every render, and building the pill/tooltip
// text here (5 × toLocaleString per row × ~4.7k rows) was the whole reason the tab felt slow.
// The wording is produced by verdictText() for the ~200 rows actually painted.
// hasSignal = the SKU has a run-rate at all. A brand-new product has no sales history, so "no
// requirement" means "we cannot forecast it yet", NOT "nobody needs it" — it must never be called
// wrong production on the strength of a zero we do not believe.
function prodVerdict(need, india, po, prod, stopped, known, hasSignal, noFba) {
  if (!known) return { k: 'unknown' };
  // Listed on Amazon, but the FBA inventory report has no record for it — so there is no requirement
  // figure to judge production against. Say that, rather than pretending it is wrong or brand new.
  if (noFba) return { k: 'nofba' };
  if (stopped) return { k: prod > 0 ? 'wrong' : 'none' };
  const cover = india + po + prod;
  if (need <= 0) {
    if (prod <= 0) return { k: 'none' };
    if (po > 0) return { k: 'ok' };            // deliberate: it is against a purchase order
    if (!hasSignal) return { k: 'new' };       // no sales history to judge it by
    return { k: 'wrong' };
  }
  const gap = need - cover;
  if (gap > 0) return { k: 'short', gap };
  // Surplus is only claimed when INDIA STOCK ALONE already covers the need — that is stock sitting
  // idle while more is being made. An ongoing PO is a decision the user made on purpose (often for a
  // new SKU with no usable forecast), so it counts towards cover but never brands production surplus.
  if (india >= need) return { k: prod > 0 ? 'surplus' : 'india' };
  return { k: 'ok' };
}
// [pill, tooltip] for one row — built lazily, only for the rows on screen (and for the CSV export).
function verdictText(r) {
  const need = r.need, india = r.india, po = r.po, prod = r.prod, cover = r.cover;
  const tally = `India ${nf(india)} + PO ${nf(po)} + production ${nf(prod)} = ${nf(cover)}`;
  switch (r.v.k) {
    case 'unknown': return ['⚠ Not on Amazon', 'This SKU is in neither the Amazon snapshot nor the Catalog — check the SKU spelling, or it really is not listed.'];
    case 'nofba': return ['Listed · no FBA stock', `This SKU IS listed on Amazon (it is in the Catalog), but Amazon's FBA inventory report carries no record for it — normal once it has sat at zero FBA stock. There is no requirement figure to check the ${nf(prod)} units in production against; judge this one yourself.`];
    case 'short': return ['🔴 Short by ' + nf(r.gap), `You need ${nf(need)}; ${tally}. Arrange ${nf(r.gap)} more.`];
    case 'india': return ['📦 Ship from India', `India stock (${nf(india)}) covers the ${nf(need)} needed — ship it, no production required.`];
    case 'surplus': return ['⚠ Surplus production', india >= need
      ? `India stock (${nf(india)}) alone already covers the ${nf(need)} needed, yet ${nf(prod)} are being made. Check whether this production is required.`
      : `India ${nf(india)} + PO ${nf(po)} already cover the ${nf(need)} needed; the ${nf(prod)} in production are on top of that.`];
    case 'new': return ['🆕 New — no forecast', `No sales history for this SKU yet, so there is no requirement to compare ${nf(prod)} units of production against. Judge this one yourself; the app is not calling it wrong.`];
    case 'wrong': return ['⚠ Wrong production', r.stopped
      ? 'This SKU is discontinued / use-in-mix — it should not be in production at all.'
      : 'It sells, there is no requirement for it, and no purchase order covers it — nothing justifies making this. Stop it and save the money.'];
    case 'ok': return need <= 0
      ? ['✓ Against a PO', 'No fresh requirement, but this production is against an ongoing purchase order.']
      : ['✓ Covered', `Need ${nf(need)}; ${tally}.`];
    default: return r.stopped
      ? ['Stopped', 'Discontinued / use-in-mix — nothing to plan.']
      : ['—', 'Nothing needed and nothing being made.'];
  }
}
// Whether a snapshot row is stopped, WITHOUT cloning it. applyStatus() spreads the whole row (image
// URLs, the rec map, inflow…) which is far too expensive to do 4.7k times per render.
function isStopped(x) {
  const ovr = STATUS_OVR[String(x.sku || '').trim().toUpperCase()];
  if (ovr) return REPL_STOP_RE.test(ovr);      // an override to "Listed" also CLEARS a backend stop
  if (isDisc(x.sku)) return true;
  return !!x.stopped;
}

// ONE view that answers all four questions per SKU: what do I need · what is in India · what is coming
// (PO + production) · is that production right. Rows = everything being made UNION everything that needs
// something, so "start production on this" shows up alongside "stop producing that".
// "How far ahead should production cover?" — one option per forecast month, named by the month itself
// so the choice is concrete ("through Oct '26") rather than a count. Rebuilt each render because the
// horizon is set on the Replenishment tab; the current pick is preserved when it still exists.
function fillBasis() {
  const sel = $('pdBasis'), cur = sel.value;
  sel.innerHTML = '<option value="req">Need = Air + Sea Req</option>'
    + FC_PLAN.map((p, i) => `<option value="fc:${i + 1}">Need = shortfall through ${esc(p.label)} (${i + 1} mo)</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'req';
}
function renderProd() {
  const b = $('pdBrand').value;
  const brands = (b === 'ALL' ? ['SP', 'CPC'] : [b]).filter(x => REPL[x]);
  if (!brands.length) {
    $('pdKpis').innerHTML = '';
    $('pdTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">No snapshot yet — open Replenishment and hit “Refresh from sheet” first.</td></tr></tbody>';
    return;
  }
  fillBasis();
  const basis = $('pdBasis').value;
  const fcN = basis.startsWith('fc:') ? Math.min(Number(basis.slice(3)) || 0, FC_PLAN.length) : 0;
  const basisLabel = fcN
    ? `need = shortfall through ${FC_PLAN[fcN - 1].label} (${fcN} mo)`
    : 'need = Air + Sea Req';
  const _t0 = performance.now();
  const pmap = poQtyMap(), prodMap = inProdMap();
  const mk = (sku, key, brand, subcat, color, size, need, air, sea, stopped, known, hasSignal, noFba) => {
    const p = prodMap[key] || { qty: 0, start: '', ready: '', sup: [] };
    const india = indiaNum(key), po = pmap[key] || 0;
    return { sku, key, brand, subcat, color, size, air, sea, need, india, po, stopped, hasSignal, noFba: !!noFba,
      prod: p.qty, start: p.start, ready: p.ready, supplier: p.sup.join(', '),
      fba: fbaNum(key), cover: india + po + p.qty, gap: Math.max(0, need - (india + po + p.qty)),
      v: prodVerdict(need, india, po, p.qty, stopped, known, hasSignal, noFba) };
  };
  let rows = [];
  const seen = new Set();
  brands.forEach(br => (REPL[br].rows || []).forEach(x => {
    const key = String(x.sku || '').trim().toUpperCase(); if (!key || seen.has(key)) return;
    const stopped = isStopped(x);
    // NEED = Air + Sea only. AWD Req shifts stock you ALREADY own inside the US (AWD → FBA); it is not
    // something to produce or ship from India, so it must not inflate the requirement.
    const air = stopped ? 0 : (x.airReq || 0), sea = stopped ? 0 : (x.seaReq || 0);
    // fcN months picked ⇒ need = the shortfall over just those months; otherwise the Air+Sea requirement.
    const need = fcN ? (stopped ? 0 : fcShortfall(fcFor(x).slice(0, fcN))) : air + sea;
    const inProd = (prodMap[key] || { qty: 0 }).qty;
    if (need <= 0 && inProd <= 0) return;      // nothing needed and nothing being made — not actionable
    seen.add(key);
    // Is there any demand history to judge this SKU by? A brand-new listing has none, so a zero
    // requirement means "cannot forecast yet", not "not wanted".
    const hasSignal = (x.avgSale || 0) > 0 || (x.last90 || 0) > 0 || (x.last30 || 0) > 0;
    rows.push(mk(x.sku, key, br, x.subcat || '', x.color || '', x.size || '', need, air, sea, stopped, true, hasSignal));
  }));
  // Uploaded production rows the loop above didn't already emit.
  // 🔴 "not in `seen`" does NOT mean "not in the snapshot": the loop above returns EARLY (before
  // seen.add) for any SKU that isn't actionable — need 0 and nothing in production. An uploaded row
  // with qty 0 hits exactly that, so hundreds of perfectly normal SKUs fell through to here and were
  // labelled "Not on Amazon". Always ask the SNAPSHOT (rmap) first; the Catalog only decides the
  // remainder, and only a SKU in NEITHER is a real data-entry problem.
  const cat = catalogSet();
  const rmap = replRowMap();                 // SKU → snapshot row (both brands), same lookup India Stock uses
  const origBySku = {};
  INPROD_ROWS.forEach(r => { const k = String(r.sku || '').trim().toUpperCase(); if (k && !origBySku[k]) origBySku[k] = r.sku; });
  Object.keys(prodMap).forEach(key => {
    if (seen.has(key)) return;
    seen.add(key);
    const m = rmap[key] || null;
    if (m) {                                   // it IS on Amazon — carry its real details and figures
      const stopped = isStopped(m);
      const air = stopped ? 0 : (m.airReq || 0), sea = stopped ? 0 : (m.seaReq || 0);
      const need = fcN ? (stopped ? 0 : fcShortfall(fcFor(m).slice(0, fcN))) : air + sea;
      const hasSignal = (m.avgSale || 0) > 0 || (m.last90 || 0) > 0 || (m.last30 || 0) > 0;
      rows.push(mk(m.sku, key, m.brand, m.subcat || '', m.color || '', m.size || '', need, air, sea, stopped, true, hasSignal, false));
    } else {
      rows.push(mk(origBySku[key] || key, key, '', '', '', '', 0, 0, 0, false, cat.has(key), false, cat.has(key)));
    }
  });

  fillSel('pdSupplier', rows.flatMap(r => (r.supplier || '').split(', ')), 'All orders');
  fillSel('pdSubcat', rows.map(r => r.subcat), 'All sub-categories');
  const fSup = $('pdSupplier').value, fSub = $('pdSubcat').value, fSku = $('pdSku').value.trim().toLowerCase();
  if (fSup) rows = rows.filter(r => (r.supplier || '').split(', ').includes(fSup));
  if (fSub) rows = rows.filter(r => r.subcat === fSub);
  if (fSku) rows = rows.filter(r => String(r.sku).toLowerCase().includes(fSku));

  // KPIs describe the brand/supplier/sub-cat/SKU view, not the bucket being drilled into.
  const base = rows, cnt = k => base.filter(r => r.v.k === k);
  const wrong = cnt('wrong'), short = cnt('short'), surplus = cnt('surplus'), fromIndia = cnt('india'), fresh = cnt('new');
  const inProdRows = base.filter(r => r.prod > 0);
  /* WHERE THE FIGURE COMES FROM, on the screen that shows it. It is the Order Console's open lines as
   * of this read - not a workbook, and not something anybody has to remember to refresh. */
  const when = INPROD_ERR ? 'COULD NOT READ THE ORDER BOOK - ' + INPROD_ERR
    : (INPROD_AT ? 'from the Order Console, read ' + INPROD_AT.toLocaleString() : 'not read yet');
  $('pdKpis').innerHTML = `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname">In Production — plan &amp; check</span><span class="kpiwhen"${INPROD_ERR ? ' style="color:var(--bad)"' : ''}>${esc(when)} · ${esc(basisLabel)}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(inProdRows.length)}</div><div class="l">SKUs in production</div></div>
      <div class="metric"><div class="v">${nf(inProdRows.reduce((s, r) => s + r.prod, 0))}</div><div class="l">Units in production</div></div>
      <div class="metric kpiclick" data-show="short" title="Click to see only these"><div class="v" style="color:var(--bad)">${nf(short.length)}</div><div class="l">🔴 Short (SKUs)</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(short.reduce((s, r) => s + r.gap, 0))}</div><div class="l">Units still to arrange</div></div>
      <div class="metric kpiclick" data-show="india" title="Click to see only these"><div class="v" style="color:#166534">${nf(fromIndia.length)}</div><div class="l">📦 Ship from India</div></div>
      <div class="metric kpiclick" data-show="wrong" title="Click to see only these"><div class="v" style="color:var(--bad)">${nf(wrong.length)}</div><div class="l">⚠ Wrong production</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(wrong.reduce((s, r) => s + r.prod, 0))}</div><div class="l">Units being wasted</div></div>
      <div class="metric kpiclick" data-show="surplus" title="Click to see only these"><div class="v" style="color:#92400e">${nf(surplus.length)}</div><div class="l">⚠ Surplus production</div></div>
      <div class="metric kpiclick" data-show="new" title="No sales history yet — the app cannot judge these. Click to see only these."><div class="v" style="color:#6d28d9">${nf(fresh.length)}</div><div class="l">🆕 New — no forecast</div></div>
    </div></div>`;

  const show = $('pdShow').value;
  if (show === 'action') rows = rows.filter(r => ['short', 'wrong', 'surplus', 'india', 'unknown', 'new', 'nofba'].includes(r.v.k));
  else if (show !== 'all') rows = rows.filter(r => r.v.k === show);
  const ORD = { short: 0, wrong: 1, surplus: 2, unknown: 3, new: 4, nofba: 5, india: 6, ok: 7, none: 8 };
  rows.sort((x, y) => (ORD[x.v.k] - ORD[y.v.k]) || (y.gap - x.gap) || (y.need - x.need));
  PD_LAST = rows;

  const cols = ['SKU', 'What to do', 'Brand', 'Sub-Category', 'Color Name', 'Size',
    'Air Req', 'Sea Req', 'NEED', 'India Stock', 'Ongoing PO', 'In Production', 'Start Date', 'Ready Date', 'Supplier',
    'Total cover', 'Gap', 'FBA Stock'];
  const head = '<thead><tr>' + cols.map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const sum = fn => rows.reduce((s, r) => s + fn(r), 0);
  const numCols = new Set([6, 7, 8, 9, 10, 11, 15, 16, 17]);
  const subVals = { 0: 'SUBTOTAL · ' + nf(rows.length), 6: nf(sum(r => r.air)), 7: nf(sum(r => r.sea)),
    8: nf(sum(r => r.need)), 9: nf(sum(r => r.india)), 10: nf(sum(r => r.po)), 11: nf(sum(r => r.prod)),
    15: nf(sum(r => r.cover)), 16: nf(sum(r => r.gap)), 17: nf(sum(r => r.fba)) };
  const sub = rows.length ? '<tr style="font-weight:700">' + cols.map((h, i) =>
    `<td${(i === 0 ? ' class="frz"' : numCols.has(i) ? ' class="num"' : '')} style="background:#eef2ff">${subVals[i] || ''}</td>`).join('') + '</tr>' : '';
  const PILL = { short: 'fu-red', wrong: 'fu-red', surplus: 'fu-amber', unknown: 'fu-amber', new: 'fu-amber', nofba: '', india: 'fu-ok', ok: 'fu-ok', none: '' };
  const TINT = { wrong: '#fef2f2', short: '#fef2f2', surplus: '#fffbeb', new: '#f5f3ff' };
  // Only the visible tbody is capped — the subtotal row, the KPIs and Export all use every filtered row.
  const shown = rows.slice(0, PD_ROW_CAP);
  const body = shown.map(r => { const [pill, why] = verdictText(r);
    return `<tr${TINT[r.v.k] ? ` style="background:${TINT[r.v.k]}"` : ''}>
      <td class="frz" style="font-family:ui-monospace,monospace">${esc(r.sku)}</td>
      <td><span class="fu ${PILL[r.v.k] || ''}" title="${esc(why)}">${esc(pill)}</span></td>
      <td>${BRAND_NAME[r.brand] || '<span class="muted">—</span>'}</td>
      <td>${esc(r.subcat || '—')}</td>
      <td>${esc(r.color || '—')}</td>
      <td>${esc(r.size || '—')}</td>
      <td class="num">${r.air ? nf(r.air) : '<span class="muted">—</span>'}</td>
      <td class="num">${r.sea ? nf(r.sea) : '<span class="muted">—</span>'}</td>
      <td class="num" style="font-weight:700" title="${fcN ? `Units short across ${fcN} month(s), through ${FC_PLAN[fcN - 1].label} — how much extra you need so no month runs out` : 'Air Req + Sea Req (AWD excluded — that is a US-internal transfer, not fresh production)'}">${r.need ? nf(r.need) : '<span class="muted">0</span>'}</td>
      <td class="num"${r.india > 0 ? ' style="color:#166534;font-weight:700"' : ''}>${nf(r.india)}</td>
      <td class="num">${r.po ? nf(r.po) : '<span class="muted">—</span>'}</td>
      <td class="num"${r.prod > 0 ? ' style="font-weight:700"' : ''}>${r.prod ? nf(r.prod) : '<span class="muted">—</span>'}</td>
      <td>${esc(r.start || '—')}</td>
      <td>${esc(r.ready || '—')}</td>
      <td>${esc(r.supplier || '—')}</td>
      <td class="num">${nf(r.cover)}</td>
      <td class="num"${r.gap > 0 ? ' style="color:var(--bad);font-weight:700"' : ' style="color:#166534"'}>${nf(r.gap)}</td>
      <td class="num">${nf(r.fba)}</td>
    </tr>`; }).join('');
  const empty = show === 'action' ? 'Nothing needs action — every SKU is covered and no wrong production. 🎉'
    : show === 'wrong' ? 'No wrong production found. 🎉'
    : show === 'unknown' ? 'Every SKU in the production list matched an Amazon SKU. 🎉'
    : INPROD_ROWS.length ? 'Nothing in this view.'
    : 'Nothing uploaded yet. Hit “Template” for the CSV format, fill it, then “Import”.';
  $('pdTable').innerHTML = head + '<tbody>' + (sub + body || `<tr><td colspan="${cols.length}" class="muted">${empty}</td></tr>`) + '</tbody>';
  $('pdMsg').textContent = rows.length > PD_ROW_CAP
    ? `showing first ${nf(PD_ROW_CAP)} of ${nf(rows.length)} — filter to narrow (subtotal, KPIs and Export cover all ${nf(rows.length)})`
    : `${nf(rows.length)} shown`;
  console.info(`[prod] ${rows.length} rows (${shown.length} painted) in ${Math.round(performance.now() - _t0)}ms`);
}
['pdBrand', 'pdBasis', 'pdSupplier', 'pdSubcat', 'pdShow'].forEach(id => $(id).addEventListener('change', renderProd));
$('pdSku').addEventListener('input', debounced(renderProd));
$('pdKpis').addEventListener('click', e => {
  const t = e.target.closest('.kpiclick'); if (!t) return;
  $('pdShow').value = $('pdShow').value === t.dataset.show ? 'action' : t.dataset.show;
  renderProd();
});
$('pdExport').onclick = () => csvDownload('in-production',
  ['SKU', 'What to do', 'Why', 'Brand', 'Sub-Category', 'Color', 'Size', 'Air Req', 'Sea Req', 'NEED',
   'India Stock', 'Ongoing PO', 'In Production', 'Start Date', 'Ready Date', 'Supplier', 'Total cover', 'Gap', 'FBA Stock'],
  PD_LAST.map(r => { const [pill, why] = verdictText(r);
    return [r.sku, pill, why, BRAND_NAME[r.brand] || '', r.subcat, r.color, r.size,
      r.air, r.sea, r.need, r.india, r.po, r.prod, r.start, r.ready, r.supplier, r.cover, r.gap, r.fba]; }));

