/* ================= SHARED LOOKUPS (India Stock + In Production tabs) ================= */
// Product details (brand / sub-cat / colour / size) + the backend's Air/Sea/AWD requirement for a SKU,
// taken from the Replenishment snapshot. Built on demand — the snapshot is already loaded by then.
function replRowMap() {
  const m = {};
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].rows) || []).forEach(r => {
    const k = String(r.sku || '').trim().toUpperCase();
    if (k && !m[k]) m[k] = { ...r, brand: b };
  }));
  return m;
}
// EVERY SKU that exists as a listing, from the backend's Catalog tab. The snapshot itself is built from
// Amazon's FBA inventory report, which DROPS a SKU that currently has no inventory record — so "missing
// from the snapshot" never meant "not on Amazon". A SKU here but not in the snapshot is simply listed
// with no FBA stock, which is exactly the case worth reordering.
function catalogSet() {
  const s = new Set();
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].catalogSkus) || []).forEach(k => {
    const u = String(k || '').trim().toUpperCase(); if (u) s.add(u);
  }));
  return s;
}
const onAmazon = (key, rmap, cat) => !!rmap[key] || cat.has(key);
// Units of a SKU sitting on ONGOING purchase orders (ordered / in transit).
function poQtyMap() {
  const m = {};
  PO.filter(p => ['ordered', 'transit'].includes(p.status)).forEach(p => (p.lines || []).forEach(l => {
    const k = String(l.sku || '').trim().toUpperCase(); if (!k) return;
    m[k] = (m[k] || 0) + lTot(l);
  }));
  return m;
}
function csvDownload(name, cols, rows) {
  const lines = [cols.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
// Header lookup for CSV import: first matching column name wins, -1 when absent.
const colIdx = (head, names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
const cellAt = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
function fillSel(id, vals, label) {
  const sel = $(id), cur = sel.value;
  const opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">${label}</option>` + opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = opts.includes(cur) ? cur : '';
}

/* ================= SHOPIFY =================
 * Shopify's own stock against Shopify's own 90-day rate. Nothing here is shared with the Amazon
 * maths on purpose: the same SKU can be comfortable at FBA and empty on Shopify, and one blended
 * number would hide exactly that.
 *
 * Built by the Price Research nightly (phase `shopSku`) and read through ITS backend, because the
 * Shopify connection lives only there.
 */
let SH = { at: '', from: '', to: '', days: 90, orders: 0, d: {}, stock: null, stockAt: '', loaded: false };
let SH_VIEW = 'reorder', SH_LAST = [], SH_TOPN = 0;
/* Ticked SKUs, for a sales order opened from here. Cleared when the store changes. */
const SH_PICK = new Set();
/* One figure set per store; SH is the one on screen. */
const SH_BY = { SP: SH, CPC: { at: '', from: '', to: '', days: 90, orders: 0, d: {}, stock: null, stockAt: '', loaded: false } };
const shStore = () => (($('shStore') || {}).value === 'CPC' ? 'CPC' : 'SP');
function shMsg(t, bad) { const m = $('shMsg'); m.innerHTML = t || ''; m.className = bad ? 'err' : 'muted'; }

async function ensureShopify() {
  if (!SH.loaded) await loadShopify();
  renderShopify();
  /* The master list names the SKUs (Ravi, 2026-09-29: "i have updated my masterdata please check and fill the blank
   * data"); when it is not in hand yet the table is drawn again once it is. */
  if (!PTG.mdb && typeof ptLoadGates === 'function') { try { await ptLoadGates(); renderShopify(); } catch (e) { /* the snapshot names stay */ } }
}
async function loadShopify() {
  const store = shStore();
  shMsg('Loading…');
  try {
    const r = await prGet({ cache: store === 'CPC' ? 'shopSkuCPC' : 'shopSku' });
    const d = r.data || {};
    SH = SH_BY[store] = { at: d.at || '', from: d.from || '', to: d.to || '', days: d.days || 90,
      orders: d.orders || 0, d: d.d || {}, stock: d.stock || null, stockAt: d.stockAt || '',
      d30: d.d30 || null, orders30: d.orders30 || 0, from30: d.from30 || '',
      loaded: true };
    shMsg('');
  } catch (e) {
    SH = SH_BY[store] = Object.assign({}, SH_BY[store], { d: {}, stock: null, loaded: true });
    shMsg(store === 'CPC' && /nothing cached/i.test(String(e.message || e))
      ? 'CPC Shopify figures are not built yet — the nightly run makes them from tonight.'
      : 'Could not load the Shopify figures: ' + (e.message || e), true);
  }
}
if ($('shStore')) $('shStore').addEventListener('change', async () => {
  SH = SH_BY[shStore()];
  SH_PICK.clear();
  if (!SH.loaded) await loadShopify();
  renderShopify();
});
$('shGo').onclick = async () => {
  const b = $('shGo'); b.disabled = true; b.textContent = '…';
  SH.loaded = false; await loadShopify();
  b.disabled = false; b.textContent = 'Refresh';
  renderShopify();
};

/** SKU → its article, colour and size, so a row is readable: the MASTER DATABASE first, then what the Amazon snapshot
 * knows, then — for a SKU in neither — its look-alikes in the master. */
function shDetails() {
  const m = {};
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].rows) || []).forEach(r => {
    const k = skuKey(r.sku); if (k && !m[k]) m[k] = { subcat: r.subcat || '', color: r.color || '', size: r.size || '' };
  }));
  const pick = (a, b) => (String(a == null ? '' : a).trim() || b || '');
  const skus = new Set(Object.keys(SH.d || {}).concat(Object.keys(SH.stock || {})).map(skuKey));
  skus.forEach(k => {
    const r = typeof mdbOf === 'function' ? mdbOf(k) : null, s = m[k] || {};
    if (r) { m[k] = { subcat: pick(r.subtype, pick(r.articleType, s.subcat)), color: pick(r.color, s.color), size: pick(r.size, s.size) }; return; }
    if (s.subcat && s.color && s.size) return;
    const g = PTG.mdb && typeof skuLookalike === 'function' ? skuLookalike(k) : null;
    if (g) m[k] = { subcat: s.subcat || g.subtype || g.articleType || '', color: s.color || g.color || '', size: s.size || g.size || '', guess: true };
  });
  return m;
}

const shMultOf = () => Math.min(20, Math.max(0.5, Number(($('shMult') || {}).value) || 1));
function shRows() {
  const det = shDetails();
  const target = Math.max(1, Number($('shTarget').value) || 60);
  /* SALES × (Ravi, 2026-09-29: "last 90 days me 100 pcs sale hue h to future ke liye kitne x krke le lu like 3x"):
   * the plan is the sales rate times this, over the cover target — 100 sold in 90 days at ×3 and 90 days is 300. */
  const mult = shMultOf();
  /* THE WINDOW: the last 90 days, or the last 30 (built in the same nightly walk, since 29 Sep). */
  const win30 = Number(($('shWin') || {}).value) === 30;
  const sales = win30 ? (SH.d30 || {}) : (SH.d || {});
  const days = win30 ? 30 : (SH.days || 90);
  const haveStock = SH.stock && typeof SH.stock === 'object';
  const rows = [];
  const seen = new Set();
  const push = (sku, sold, rev) => {
    const k = skuKey(sku);
    if (seen.has(k)) return; seen.add(k);
    // ABSENT stock is not zero stock. A SKU Shopify has never heard of and a SKU sitting at zero are
    // different problems — one is a listing job, the other is a reorder — so the figure stays null
    // and the row says which it is.
    const stock = haveStock ? (SH.stock[sku] != null ? SH.stock[sku] : (SH.stock[k] != null ? SH.stock[k] : null)) : null;
    const rate = sold / days;                       // units a day
    /* STOCK BELOW ZERO IS NOT DEMAND (Ravi, 2026-09-29: "yadi 90 days me 1 unit sale hua h then 18 unit kese project kar
     * sakte h"). RTME-521-4 sold 1 in 90 days and Shopify holds it at -17: the old sum sent 1 + 17 = 18. A count below
     * zero is Shopify's record gone wrong (sold past what it held, or never corrected), not seventeen customers
     * waiting — open orders are the production bucket's job. So it counts as empty: cover 0, send what the rate asks. */
    const have = stock == null ? null : Math.max(0, stock);
    const cover = rate > 0 ? (have == null ? null : have / rate) : null;
    const plan = rate > 0 ? Math.round(rate * target * mult) : 0;
    const need = rate > 0 && have != null ? Math.max(0, plan - have) : null;
    const d = det[k] || {};
    rows.push({ sku, sold, rev, stock, rate, cover, need, plan,
      subcat: d.subcat || '', color: d.color || '', size: d.size || '', guess: !!d.guess });
  };
  Object.entries(sales).forEach(([sku, v]) => push(sku, v[0] || 0, v[1] || 0));
  // Stocked but nothing sold in the window — still worth seeing; it is money sitting still.
  if (haveStock) Object.keys(SH.stock).forEach(sku => push(sku, 0, 0));

  /* TOP 80%: the best sellers, most first, until together they hold 80% of the units sold in the window — the one that
   * crosses the line is in. Worked out on every SKU that sold, before any other filter, so it does not move with them. */
  const sold = rows.filter(r => r.sold > 0).sort((a, b) => b.sold - a.sold);
  const allUnits = sold.reduce((t, r) => t + r.sold, 0);
  let cum = 0;
  sold.forEach(r => { r.top = allUnits > 0 && cum < allUnits * 0.8; cum += r.sold; r.cumPct = allUnits ? cum / allUnits * 100 : 0; });
  SH_TOPN = sold.filter(r => r.top).length;
  let out = rows;
  if (($('shTop') || {}).checked) out = out.filter(r => r.top);
  if (SH_VIEW === 'reorder') out = out.filter(r => r.need > 0);
  else if (SH_VIEW === 'out') out = out.filter(r => r.stock != null && r.stock <= 0 && r.sold > 0);
  else if (SH_VIEW === 'nostock') out = out.filter(r => r.stock == null && r.sold > 0);
  const q = $('shFilter').value.trim().toLowerCase();
  if (q) out = out.filter(r => (r.sku + ' ' + r.subcat + ' ' + r.color + ' ' + r.size).toLowerCase().includes(q));
  // Most urgent first: what runs out soonest, then what sells most.
  out.sort((a, b) => (a.cover == null ? 1e9 : a.cover) - (b.cover == null ? 1e9 : b.cover) || b.sold - a.sold);
  return out;
}

function renderShopify() {
  if (!SH.loaded) return;
  if (!Object.keys(SH.d).length && !SH.stock) {
    $('shTable').innerHTML = '';
    if (!$('shMsg').textContent) {
      shMsg('The nightly run has not built the Shopify per-SKU figures yet. It walks the last 90 days '
        + 'of orders and then reads the stock, straight after the Shopify totals.', true);
    }
    return;
  }
  const rows = shRows(); SH_LAST = rows;
  const target = Math.max(1, Number($('shTarget').value) || 60);
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');

  const win30 = Number(($('shWin') || {}).value) === 30, wDays = win30 ? 30 : SH.days;
  const shown = rows.slice(0, 400), allOn = shown.length && shown.every(r => SH_PICK.has(r.sku));
  const head = `<thead><tr><th style="width:30px"><input type="checkbox" data-shall="1" style="width:auto" title="Tick every row on screen"${allOn ? ' checked' : ''}></th><th class="frz">SKU</th><th>Article</th><th>Colour</th><th>Size</th>`
    + `<th class="num" title="Units sold on Shopify in the ${wDays} days to ${esc(SH.to)}.">${wDays}d units</th>`
    + '<th class="num">Revenue</th>'
    + '<th class="num" title="Units a day, over the whole window.">Per day</th>'
    /* NO STOCK OR COVER COLUMNS (Ravi, 2026-09-29: "not need here stock and cover here"). Send still takes off what Shopify
     * holds above zero, and says so on its heading. */
    + `<th class="num" title="Per day × ${target} days × ${shMultOf()} — what to hold.">Plan${shMultOf() !== 1 ? ' (×' + shMultOf() + ')' : ''}</th>`
    + `<th class="num" title="Plan less what Shopify holds above zero (a count below zero is taken as 0).">Send</th></tr></thead>`;

  const CAP = 400;
  /* Not in the master: filled from its look-alikes, and shown as such. */
  const cell = (v, g) => !v ? '<span class="muted">—</span>'
    : (g ? `<span style="font-style:italic;color:var(--muted)" title="Not in the master database — read from SKUs that look like it">${esc(v)}</span>` : esc(v));
  const body = rows.slice(0, CAP).map(r => '<tr>'
    + `<td><input type="checkbox" data-shpick="${esc(r.sku)}" style="width:auto"${SH_PICK.has(r.sku) ? ' checked' : ''}></td>`
    + `<td class="frz" style="font-weight:600">${esc(r.sku)}${r.top ? ' <span title="In the top 80% of units sold" style="font-size:10.5px;font-weight:700;color:#1D4ED8;background:#EEF5FF;border-radius:6px;padding:1px 5px">TOP</span>' : ''}</td>`
    + `<td>${cell(r.subcat, r.guess)}</td>`
    + `<td>${cell(r.color, r.guess)}</td>`
    + `<td>${cell(r.size, r.guess)}</td>`
    + `<td class="num">${nf(r.sold)}</td><td class="num">${money(r.rev)}</td>`
    + `<td class="num">${r.rate > 0 ? r.rate.toFixed(2) : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${r.plan > 0 ? nf(r.plan) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="font-weight:700">${r.need > 0 ? nf(r.need) : '<span class="muted">—</span>'}</td>`
    + '</tr>').join('');

  $('shTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="10" class="muted" style="padding:14px">Nothing matches.</td></tr>') + '</tbody>';
  shPickBtn();

  const send = rows.reduce((s, r) => s + (r.need || 0), 0);
  shMsg(`<b>${shStore() === 'CPC' ? 'CPC Shopify' : 'Ridhi Shopify'}</b> · ${nf(rows.length)} SKU(s) · <b>${nf(send)}</b> units to reach ${target} days of cover${shMultOf() !== 1 ? ` at <b>${shMultOf()}×</b> the sales` : ''}`
    + (rows.length > CAP ? ` · showing the first ${CAP}` : '')
    + (win30 ? (SH.d30 ? ` · last 30 days to ${esc(SH.to)}, ${nf(SH.orders30)} order(s)` : ' · <span class="err">the last-30-day figures come with the next nightly run</span>')
      : ` · ${SH.days} days to ${esc(SH.to)}, ${nf(SH.orders)} order(s)`)
    + (SH_TOPN ? ` · <b>${nf(SH_TOPN)}</b> SKU(s) make 80% of the units` : '')
    + (SH.at ? ` · built ${esc(SH.at)}` : '')
    // Said out loud, because a stock column silently full of dashes reads as "nothing in stock".
    + (SH.stock ? (SH.stockAt ? ` · stock read ${esc(SH.stockAt)}` : '')
        : ' · <span class="err">stock could not be read this run — the Stock and Send columns are blank, not zero</span>'));
}

$('shSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  SH_VIEW = b.dataset.v;
  $('shSeg').querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
  renderShopify();
});
let SH_FT = null;
['shFilter', 'shTarget', 'shMult'].forEach(id =>
  $(id).addEventListener('input', () => { clearTimeout(SH_FT); SH_FT = setTimeout(renderShopify, 250); }));

/* ---- a sales order from the ticked rows (Ravi, 2026-09-29: "top me order open krna chahu to kar pau") ----
 * The ordinary sales-order form opens with the ticked SKUs, each for its Send quantity, and the store's Shopify channel
 * picked; it is saved or placed from there like any other order — nothing new is written from this screen. */
function shPickBtn() {
  const b = $('shOpen'); if (!b) return;
  b.classList.toggle('hide', !SH_PICK.size);
  b.textContent = `Open sales order (${nf(SH_PICK.size)})`;
}
if ($('shTable')) $('shTable').addEventListener('change', e => {
  const t = e.target;
  if (t.hasAttribute && t.hasAttribute('data-shall')) { SH_LAST.slice(0, 400).forEach(r => { if (t.checked) SH_PICK.add(r.sku); else SH_PICK.delete(r.sku); }); renderShopify(); return; }
  const k = t.getAttribute && t.getAttribute('data-shpick'); if (!k) return;
  if (t.checked) SH_PICK.add(k); else SH_PICK.delete(k);
  shPickBtn();
});
async function shOpenSo() {
  const all = new Map(SH_LAST.map(r => [r.sku, r]));
  const picked = [...SH_PICK].map(k => all.get(k)).filter(Boolean);
  const lines = picked.filter(r => r.need > 0).map(r => ({ sku: obUC(r.sku), qty: r.need, deliveryDate: '', orderTypeKey: 'regular', priority: '' }));
  const skipped = picked.length - lines.length;
  if (!lines.length) return shMsg('None of the ticked SKUs has anything to send.', true);
  if (!PTG.masters || !PTG.mdb) await ptLoadGates();
  if (SOX.rows === null) { try { SOX.rows = ptList(await ptGet('pt_salesOrders')); } catch (e) { SOX.rows = SOX.rows || []; } }
  soFormOpen();
  const cpc = shStore() === 'CPC', chans = soChannels();
  const ch = chans.find(c => cpc ? /cpc/i.test(c.name + ' ' + c.code) && /shop/i.test(c.name + ' ' + c.code) : false)
    || chans.find(c => /shopify/i.test(c.name) && (cpc || !/cpc/i.test(c.name))) || chans.find(c => c.code === 'SPY');
  if (ch && $('sof_channel')) $('sof_channel').value = ch.code;
  SOF.lines = lines;
  soFormLines(); soIdPreview();
  ptDlgMsg(`${nf(lines.length)} SKU(s) brought over from ${cpc ? 'CPC' : 'Ridhi'} Shopify, each for its Send quantity`
    + (skipped ? ` · ${nf(skipped)} ticked SKU(s) had nothing to send and were left out` : '') + ' — check the channel and quantities, then save or place it.');
}
if ($('shOpen')) $('shOpen').onclick = () => shOpenSo();
['shWin', 'shTop'].forEach(id => { if ($(id)) $(id).addEventListener('change', () => renderShopify()); });

$('shCsv').onclick = () => {
  if (!SH_LAST.length) { shMsg('Nothing to export.', true); return; }
  csvDownload('shopify-' + (shStore() === 'CPC' ? 'cpc-' : 'ridhi-') + (SH.to || 'now'),
    ['SKU', 'Top 80%', 'Article', 'Colour', 'Size', (Number(($('shWin') || {}).value) === 30 ? 30 : SH.days) + 'd units', 'Revenue', 'Per day', 'Plan (×' + shMultOf() + ')', 'Send'],
    SH_LAST.map(r => [r.sku, r.top ? 'yes' : '', r.subcat, r.color, r.size, r.sold, r.rev,
      r.rate > 0 ? r.rate.toFixed(2) : '', r.plan || 0, r.need || 0]));
};

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
