/* ---------- staged quantity, and what is short ----------
 *
 * Per ORDER LINE, unlike the shelf bin above. "One of the two is on the shelf" is a fact about this
 * order on this day; the bin is a fact about the product. Mixing the two would either wipe the
 * count every time the SKU sold again, or carry a stale count onto the next order.
 *
 * Every change is logged with the date and time rather than overwritten, because the question that
 * gets asked later is never "how many are there" — it is "when did that change, and who by".
 */
function soLine(orderId, sku) {
  const meta = SHOP_META[orderId] || {};
  return ((meta.lines || {})[sku]) || {};
}
function soLogText(ln) {
  const log = (ln && ln.log) || [];
  if (!log.length) return 'Nothing recorded yet.';
  return log.slice(-8).map(e => `${e.at} — ${e.q} pc${e.q === 1 ? '' : 's'}${e.by ? ' · ' + e.by : ''}`).join('\n');
}

/**
 * The adjustment id, built from the Shopify order number and the SKU.
 *
 * Derived, never generated: the same line always produces the same id, so re-entering a quantity
 * cannot raise a second production order for work already sent. It reads back to the Shopify order
 * without a lookup, which is the whole point of putting it on a printed sheet.
 */
function soAdjId(orderNo, sku) {
  return 'ADJ-' + String(orderNo || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase()
    + '-' + String(sku || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
}

/**
 * Copy onto the adjustment everything it needs to stand on its own.
 *
 * The Adjustments tab has to list a job raised six weeks ago without re-fetching that order from
 * Shopify — the window it lives in has long since scrolled past, and a job waiting on production is
 * exactly the one nobody is looking at any more. So the product name, the order number, the
 * customer and the picture are COPIED at the moment it is raised, not looked up later.
 */
function soAdjSnapshot(ln, o, item) {
  if (o) {
    ln.adjOrder = o.no;
    ln.adjOrderDate = o.at;
    ln.adjCustomer = (o.ship && o.ship.name) || '';
    ln.adjOrderId = o.id;
  }
  if (item) {
    ln.adjName = item.name || '';
    ln.adjOrdered = item.qty;
    if (!ln.adjImg && item.img) ln.adjImg = item.img;
  }
  ln.adjStaged = ln.q == null ? null : ln.q;
  ln.adjLoc = soLocOf(item && item.sku) || '';
  if (!ln.adjState) ln.adjState = 'raised';
}
function soAdjHtml(ln, item, esc) {
  const sku = String(item.sku || '').trim().toUpperCase();
  const btn = '<button class="ghost" data-adj="' + esc(sku) + '" style="padding:2px 8px;font-size:11px;margin-top:3px">'
    + (ln.adj ? 'Edit' : '+ Adjust') + '</button>';
  // A SHORT LINE AND A WRONG ONE ARE DIFFERENT PROBLEMS. The quantity can be complete — one ordered,
  // one in hand — and still be the wrong size, which is the case that has to go to production. So
  // the button is always there, not only when something is missing.
  if (!ln.adj) {
    const state = ln.q == null
      ? '<span class="muted" style="font-size:11.5px">enter a quantity</span>'
      : (Number(item.qty) - Number(ln.q) > 0
          ? '<span class="st st-pending">' + (item.qty - ln.q) + ' short</span>'
          : '<span class="st st-approved">complete</span>');
    return state + '<div>' + btn + '</div>';
  }
  return '<span class="st st-pending">' + (ln.adjQty || 0) + ' to make</span>'
    + (ln.adjReason ? ' <span class="muted" style="font-size:10.5px">' + esc(ln.adjReason) + '</span>' : '')
    + (ln.adjSend || ln.adjWant
        ? '<div style="font-size:10.5px;margin-top:2px">' + esc(ln.adjSend || '?') + ' &rarr; <b>' + esc(ln.adjWant || '?') + '</b></div>'
        : '')
    + '<div style="font-family:ui-monospace,monospace;font-size:10px;margin-top:2px">' + esc(ln.adj) + '</div>'
    + (ln.adjAt ? '<div class="muted" style="font-size:10px">' + esc(ln.adjAt) + '</div>' : '')
    + '<div>' + btn + '</div>';
}

/**
 * The customs line for every SKU on the order.
 *
 * One row per SKU, not per line item: two lines of the same SKU are one commodity to a customs
 * officer, and giving them two HS codes to disagree over helps nobody.
 *
 * Rates are held in the SKU record and shown in the order's chosen currency. Nothing is converted —
 * there is no exchange rate in this app, and inventing one would put a number on a customs
 * declaration that nobody could defend.
 */
function soRenderCustoms() {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const cur = $('soCur').value;
  const byS = new Map();
  o.items.forEach(i => {
    const k = String(i.sku || '').trim().toUpperCase();
    if (!k) return;
    if (!byS.has(k)) byS.set(k, { sku: k, name: i.name || '', qty: 0 });
    byS.get(k).qty += Number(i.qty) || 0;
  });
  const rows = [...byS.values()];
  let goods = 0, tax = 0;
  const body = rows.map(r => {
    const s = soSku(r.sku);
    const rate = Number(s.rate);
    const line = rate > 0 ? rate * r.qty : 0;
    const gst = Number(s.gst);
    goods += line;
    if (gst > 0) tax += line * gst / 100;
    return '<tr>'
      + '<td style="font-family:ui-monospace,monospace">' + esc(r.sku) + '</td>'
      + '<td title="' + esc(r.name) + '">' + esc(String(r.name).slice(0, 26)) + '</td>'
      + '<td class="num">' + r.qty + '</td>'
      + '<td><input class="soHs" data-sku="' + esc(r.sku) + '" maxlength="8" inputmode="numeric"'
        + ' placeholder="8 digits" value="' + esc(s.hs || '') + '" style="width:88px;text-align:center"></td>'
      + '<td><input class="soGst" data-sku="' + esc(r.sku) + '" type="number" min="0" max="28" step="0.5"'
        + ' placeholder="%" value="' + (s.gst == null ? '' : s.gst) + '" style="width:64px;text-align:center"></td>'
      + '<td><input class="soRate" data-sku="' + esc(r.sku) + '" type="number" min="0" step="0.01"'
        + ' placeholder="per unit" value="' + (s.rate == null ? '' : s.rate) + '" style="width:88px;text-align:right"></td>'
      + '<td class="num">' + (line ? line.toFixed(2) : '<span class="muted">—</span>') + '</td>'
      + '</tr>';
  }).join('');

  $('soCustoms').innerHTML = '<thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th>'
    + '<th>HS code</th><th>GST %</th><th>Rate/unit</th><th class="num">Line total</th></tr></thead>'
    + '<tbody>' + (body || '<tr><td colspan="7" class="muted" style="padding:10px">No SKU on this order.</td></tr>') + '</tbody>';

  const missing = rows.filter(r => !soSku(r.sku).hs).length;
  $('soInvTot').innerHTML = 'Goods <b>' + goods.toFixed(2) + ' ' + esc(cur) + '</b>'
    + ' · GST <b>' + tax.toFixed(2) + '</b> · total <b>' + (goods + tax).toFixed(2) + '</b>'
    + (missing ? ' <span class="fu fu-amber">· ' + missing + ' SKU(s) with no HS code — DHL rejects a line without one</span>' : '');

  const bind = (cls, field, cast) => $('soCustoms').querySelectorAll('.' + cls).forEach(el => {
    el.onchange = async () => {
      try { await soSetSku(el.dataset.sku, field, el.value.trim() === '' ? '' : cast(el.value)); soRenderCustoms(); }
      catch (err) { $('soErr').textContent = 'Could not save: ' + (err.message || err); $('soErr').classList.remove('hide'); }
    };
  });
  bind('soHs', 'hs', v => String(v).replace(/\D/g, '').slice(0, 8));
  bind('soGst', 'gst', v => Number(v));
  bind('soRate', 'rate', v => Number(v));
}
$('soCur').addEventListener('change', soRenderCustoms);

