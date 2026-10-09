/* Pricing-API / ShopifySkuSales.gs — Shopify per-SKU: what sold and what is left.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Shopify per-SKU: what sold, and what is left =====================/* ===================== Shopify per-SKU: what sold, and what is left =====================
 *
 * The Shopify side has always been an ACCOUNT total here — one number a day, stored as a third
 * channel beside the two Amazon brands. That is all the dashboard needed. A replenishment view needs
 * the opposite shape: per SKU, and with the stock sitting behind it.
 *
 * Two separate things, deliberately kept apart:
 *   shopifySkuSales_  what sold in a window, per SKU, out of the orders
 *   shopifyStock_     what is on hand right now, per SKU, out of the product variants
 *
 * They cannot be one call: sales are a window and stock is an instant, and pretending otherwise is
 * how a stock figure ends up quietly dated to the start of a 90-day range.
 */
var SHOP_SKU_DAYS = 90;

/**
 * Units and money per SKU over a window.
 *
 * CANCELLED ORDERS ARE NOT DEMAND. A cancelled order tells you somebody changed their mind, not that
 * a unit needs replacing, and counting it would inflate every reorder that follows from it.
 * `financial_status: voided` goes the same way, matching shopifyOrders_.
 *
 * ⚠️ Refunds are NOT deducted. A refunded line still counts as sold, because the line items carry no
 * refund of their own and the refund endpoint is a separate walk. For replenishment that errs the
 * safe way — slightly more demand, not less — but it is a real overstatement and worth knowing.
 */
function shopifySkuSales_(fromIso, toIso, deadlineMs) {
  var fields = 'id,created_at,cancelled_at,financial_status,line_items';
  var base = '/orders.json?status=any&limit=250&fields=' + fields + shopWindow_(fromIso, toIso);
  var out = {}, out30 = {}, pageInfo = null, guard = 0, orders = 0, orders30 = 0;
  /* THE LAST 30 DAYS TOO (Ravi, 2026-09-29), out of the same walk: an order on or after this day counts in both. */
  var from30 = Utilities.formatDate(new Date(Date.parse(toIso + 'T00:00:00Z') - 29 * 86400000), 'UTC', 'yyyy-MM-dd');
  do {
    var r = shopifyGet_(pageInfo
      ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo)
      : base);
    (r.json.orders || []).forEach(function (o) {
      if (!shopInWindow_(o, fromIso, toIso)) return;
      if (o.cancelled_at) return;
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      orders++;
      var recent = shopDayOf_(o) >= from30;
      if (recent) orders30++;
      (o.line_items || []).forEach(function (li) {
        var sku = String(li.sku || '').trim(); if (!sku) return;
        var q = Number(li.quantity) || 0;
        var e = out[sku] || (out[sku] = [0, 0]);          // units, revenue
        e[0] += q;
        e[1] += (Number(li.price) || 0) * q;
        if (recent) { var e3 = out30[sku] || (out30[sku] = [0, 0]); e3[0] += q; e3[1] += (Number(li.price) || 0) * q; }
      });
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    if (deadlineMs && Date.now() > deadlineMs) {
      return { ok: true, more: true, n: orders, d: out };
    }
  } while (pageInfo && ++guard < 80);
  Object.keys(out).forEach(function (k) { out[k][1] = Math.round(out[k][1] * 100) / 100; });
  Object.keys(out30).forEach(function (k) { out30[k][1] = Math.round(out30[k][1] * 100) / 100; });
  return { ok: true, more: false, n: orders, d: out, n30: orders30, d30: out30, from30: from30 };
}

/**
 * On-hand units per SKU, summed across every location.
 *
 * Read off the product VARIANTS rather than the inventory-levels endpoint: variants already carry the
 * SKU, and inventory_levels is keyed by inventory_item_id, which would need a second walk just to
 * learn which SKU each one is. The trade is that this is the total across locations with no split by
 * location — which is the number a reorder decision uses anyway.
 *
 * A SKU that is not in Shopify at all comes back ABSENT, never 0. "Not stocked on Shopify" and
 * "stocked and empty" are different answers and the app shows them differently.
 */
function shopifyStock_(deadlineMs) {
  var out = {}, pageInfo = null, guard = 0;
  do {
    var r = shopifyGet_(pageInfo
      ? '/products.json?limit=250&fields=variants&page_info=' + encodeURIComponent(pageInfo)
      : '/products.json?limit=250&fields=variants');
    (r.json.products || []).forEach(function (p) {
      (p.variants || []).forEach(function (v) {
        var sku = String(v.sku || '').trim(); if (!sku) return;
        out[sku] = (out[sku] || 0) + (Number(v.inventory_quantity) || 0);
      });
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    if (deadlineMs && Date.now() > deadlineMs) return { ok: true, more: true, stock: out };
  } while (pageInfo && ++guard < 80);
  return { ok: true, more: false, stock: out };
}

/**
 * One page of products, with every variant's SKU.
 *
 * A VARIANT WITH NO SKU IS RETURNED, not skipped — "this product has no code" is the thing the audit
 * is looking for, and a reader that drops it cannot find it. Nothing here guesses a code.
 */
function shopifySkuList_(pageInfo) {
  var fields = 'id,title,status,handle,product_type,variants';
  var path = pageInfo
    ? '/products.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(String(pageInfo))
    : '/products.json?limit=250&fields=' + fields;
  var r = shopifyGet_(path);
  var rows = [];
  (r.json.products || []).forEach(function (p) {
    (p.variants || []).forEach(function (v) {
      rows.push([String(p.id), String(p.title || ''), String(p.status || ''), String(p.handle || ''),
        String(p.product_type || ''), String(v.id), String(v.title || ''), String(v.sku == null ? '' : v.sku),
        Number(v.inventory_quantity) || 0, String(v.price == null ? '' : v.price)]);
    });
  });
  return { ok: true, cols: ['productId', 'product', 'status', 'handle', 'type', 'variantId', 'variant', 'sku', 'stock', 'price'],
    n: rows.length, rows: rows, next: shopifyNextPageInfo_(r.link) || '' };
}

/** Editor check: does the Shopify side give per-SKU sales and stock at all, and do the SKUs match? */
function shopSkuTest() {
  var to = new Date(), from = new Date(to.getTime() - 14 * 86400000);
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var s = shopifySkuSales_(iso(from), iso(to), Date.now() + 60000);
  var keys = Object.keys(s.d);
  Logger.log('sales: ' + s.n + ' order(s), ' + keys.length + ' SKU(s)' + (s.more ? ' (ran out of time)' : ''));
  Logger.log('  e.g. ' + keys.slice(0, 5).map(function (k) { return k + ' = ' + s.d[k][0] + 'u $' + s.d[k][1]; }).join(' · '));
  var st = shopifyStock_(Date.now() + 60000);
  var sk = Object.keys(st.stock);
  Logger.log('stock: ' + sk.length + ' SKU(s)' + (st.more ? ' (ran out of time)' : ''));
  Logger.log('  e.g. ' + sk.slice(0, 5).map(function (k) { return k + ' = ' + st.stock[k]; }).join(' · '));
  // The join is the whole feature. If these two sets barely overlap, the SKUs are written differently
  // on the two sides and every projection built on the join would be quietly empty.
  var hit = keys.filter(function (k) { return st.stock[k] != null; }).length;
  Logger.log('overlap: ' + hit + ' of ' + keys.length + ' sold SKUs have a stock figure'
    + (keys.length && hit < keys.length * 0.5 ? '  ⚠ LOW — the two sides may not use the same SKU text' : ''));
}

