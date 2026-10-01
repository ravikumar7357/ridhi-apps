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

