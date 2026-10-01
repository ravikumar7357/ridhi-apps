/* ================= INDIA STOCK (uploaded) ================= */
// The user maintains this list themselves (CSV in/out). It is the ONLY source of the India Stock
// column across every tab — the old pillow-tracker read was removed.
const IN_COLS = ['SKU', 'India Stock'];
async function ensureIndia() {
  $('inMsg').textContent = 'Loading…';
  await ensureReplData();
  if (!INDIA_LOADED) await loadIndiaStock();
  // The projection needs the same three things the In Production tab needs: the status overrides
  // (which SKUs are stopped), what is being made, and the forecast horizon.
  if (!PROD_LOADED) await loadProd();
  if (!INPROD_LOADED) await loadInProd();
  if (!FC_PLAN.length) {
    FC_PLAN = buildFcPlan([...new Set(['SP', 'CPC'].flatMap(b => (REPL[b] && REPL[b].recCols) || []))]);
    FC_CACHE = new Map();
  }
  $('inMsg').textContent = '';
  // The list render also fills the Sub-Category / Colour dropdowns, so it runs either way.
  renderIndia();
  if (IN_MODE === 'proj') renderIndiaProj();
}
let IN_LAST = [];
function renderIndia() {
  const rmap = replRowMap(), cat = catalogSet();
  // Every uploaded row, enriched with the product details we know from the Amazon side.
  // known = it exists on Amazon at all (snapshot OR catalog). noFba = listed, but Amazon's inventory
  // report carries no record for it — normal for a SKU that has sat at zero stock.
  let rows = INDIA_ROWS.map(r => {
    const k = String(r.sku || '').trim().toUpperCase();
    const m = rmap[k] || null;
    return { sku: r.sku, key: k, qty: Number(r.qty) || 0, known: onAmazon(k, rmap, cat), noFba: !m && cat.has(k),
      brand: m ? m.brand : '', subcat: m ? (m.subcat || '') : '', color: m ? (m.color || '') : '',
      size: m ? (m.size || '') : '' };
  });
  const b = $('inBrand').value;
  if (b !== 'ALL') rows = rows.filter(r => r.brand === b);
  fillSel('inSubcat', rows.map(r => r.subcat), 'All sub-categories');
  fillSel('inColor', rows.map(r => r.color), 'All colors');
  const fSub = $('inSubcat').value, fCol = $('inColor').value, fSku = $('inSku').value.trim().toLowerCase(), show = $('inShow').value;
  if (fSub) rows = rows.filter(r => r.subcat === fSub);
  if (fCol) rows = rows.filter(r => r.color === fCol);
  if (fSku) rows = rows.filter(r => r.sku.toLowerCase().includes(fSku));
  // KPIs describe the brand/sub-cat/colour/SKU view — NOT the "Show" bucket you drill into, so the
  // "Not on Amazon" count stays visible (and clickable) while you are looking at some other bucket.
  const base = rows;
  if (show === 'zero') rows = rows.filter(r => r.qty <= 0);
  else if (show === 'pos') rows = rows.filter(r => r.qty > 0);
  else if (show === 'unknown') rows = rows.filter(r => !r.known);
  else if (show === 'known') rows = rows.filter(r => r.known);
  IN_LAST = rows;

  const nUnknown = base.filter(r => !r.known).length;
  const when = INDIA_AT ? ((INDIA_CACHED ? 'last read ' : 'read ') + INDIA_AT) : 'not read yet';
  $('inKpis').innerHTML = `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname">India Stock</span><span class="kpiwhen">last upload: ${esc(when)}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(base.length)}</div><div class="l">SKUs uploaded</div></div>
      <div class="metric"><div class="v">${nf(base.reduce((s, r) => s + r.qty, 0))}</div><div class="l">Total units in India</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(base.filter(r => r.qty <= 0).length)}</div><div class="l">Zero stock</div></div>
      <div class="metric kpiclick" data-show="unknown" title="Click to see only these"><div class="v" style="color:#92400e">${nf(nUnknown)}</div><div class="l">⚠ Not on Amazon</div></div>
    </div></div>`;

  // Deliberately minimal: this tab is only the BRIDGE that feeds India Stock to the Replenishment /
  // Ongoing-PO / In-Production tabs. The FBA-stock and Air/Sea/AWD-requirement cross-reference lives
  // in those tabs, not here.
  const cols = ['SKU', 'Brand', 'Sub-Category', 'Color Name', 'Size', 'India Stock', ''];
  const head = '<thead><tr>' + cols.map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const sub = rows.length ? `<tr style="font-weight:700"><td class="frz" style="background:#eef2ff">SUBTOTAL · ${nf(rows.length)}</td>
    <td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td>
    <td class="num" style="background:#eef2ff">${nf(rows.reduce((s, r) => s + r.qty, 0))}</td><td style="background:#eef2ff"></td></tr>` : '';
  const body = rows.map(r => `<tr>
      <td class="frz" style="font-family:ui-monospace,monospace">${esc(r.sku)}</td>
      <td>${BRAND_NAME[r.brand] || '<span class="muted">—</span>'}</td>
      <td>${esc(r.subcat || '—')}</td>
      <td>${esc(r.color || '—')}</td>
      <td>${esc(r.size || '—')}</td>
      <td class="num"${r.qty > 0 ? '' : ' style="color:var(--bad);font-weight:700"'}>${nf(r.qty)}</td>
      <td>${r.known
        ? (r.noFba ? '<span class="fu" style="background:#e0e7ff;color:#3730a3" title="Listed on Amazon, but Amazon&#39;s FBA inventory report carries no record for it — normal when it has sat at zero FBA stock. Nothing is wrong with the SKU.">Listed · no FBA stock</span>' : '')
        : '<span class="fu fu-amber" title="Not in the Amazon snapshot AND not in the Catalog — check the SKU spelling, or it really is not listed">Not on Amazon</span>'}</td>
    </tr>`).join('');
  $('inTable').innerHTML = head + '<tbody>' + (sub + body || `<tr><td colspan="${cols.length}" class="muted">Nothing uploaded yet. Hit “Template” for the CSV format, fill it, then “Import”.</td></tr>`) + '</tbody>';
}
