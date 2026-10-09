/* Pricing-API / Shopify.gs — Shopify: store tokens, REST calls, orders and daily totals.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Shopify ===================== */
/*
 * A third sales channel alongside the two Amazon accounts. Ported from the Amazon Hub script rather
 * than written afresh â€” that version already handles the store-domain confusion and the 429s.
 *
 * Credentials live in Script Properties, never in code:
 *   SHOPIFY_STORE   â€” "mystore.myshopify.com" (the admin.shopify.com URL is also understood)
 *   SHOPIFY_TOKEN   â€” Admin API access token (shpat_â€¦)
 *
 * Sales = line-item price Ã— quantity, which is the same thing Amazon calls Ordered Product Sales.
 * Not total_price: that includes shipping and tax and would not compare with the Amazon figures.
 */
var SHOP_API_VERSION = '2024-10';

/** '' is Ridhi's store; 'CPC_' is Cotton Print Club's. Nothing sets this but setShopBrand_. */
var SHOP_PREFIX = '';

/** Point the following Shopify calls at a store. 'CPC' â†’ CPC_SHOPIFY_*, anything else â†’ SHOPIFY_*. */
function setShopBrand_(b) {
  SHOP_PREFIX = (String(b || '').toUpperCase() === 'CPC') ? 'CPC_' : '';
  return SHOP_PREFIX;
}

/** The Admin API token for whichever store is selected. */
function shopifyToken_() {
  /* A token pasted into Script Properties often brings a space or a newline with it, and Shopify
   * answers that with a 401 that reads like the token itself is wrong. */
  var t = String(prop_(SHOP_PREFIX + 'SHOPIFY_TOKEN') || '').trim();
  if (t && t.indexOf('shpss_') === 0) throw new Error(SHOP_PREFIX + "SHOPIFY_TOKEN holds the app's SECRET (shpss_...), not an Admin API access token (shpat_...).");
  if (!t) throw new Error(SHOP_PREFIX + 'SHOPIFY_TOKEN missing â€” set the Admin API access token in Script Properties.');
  return t;
}

function shopifyStore_() {
  var s = prop_(SHOP_PREFIX + 'SHOPIFY_STORE');
  if (!s) throw new Error(SHOP_PREFIX + 'SHOPIFY_STORE missing â€” set it (e.g. mystore.myshopify.com) in Script Properties.');
  s = s.trim().replace(/^https?:\/\//, '');
  // The new admin URL form: admin.shopify.com/store/<handle> â†’ <handle>.myshopify.com
  var m = s.match(/admin\.shopify\.com\/store\/([^\/?#]+)/i);
  if (m) return m[1] + '.myshopify.com';
  s = s.replace(/\/.*$/, '');
  if (/^admin\.shopify\.com$/i.test(s)) {
    throw new Error('SHOPIFY_STORE is the admin URL. Use the myshopify domain instead, '
      + 'e.g. "yourstore.myshopify.com" (Shopify Admin â†’ Settings â†’ Domains).');
  }
  if (s.indexOf('.myshopify.com') < 0) s += '.myshopify.com';
  return s;
}

/** GET an Admin API path. Returns { json, link } â€” the Link header carries the next page. */
function shopifyGet_(pathQuery) {
  var token = shopifyToken_();
  var url = 'https://' + shopifyStore_() + '/admin/api/' + SHOP_API_VERSION + pathQuery;
  for (var att = 0; att < 5; att++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true,
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    var code = resp.getResponseCode();
    if (code === 429) { Utilities.sleep(2500); continue; }
    if (code >= 300) throw new Error('Shopify ' + code + ': ' + resp.getContentText().slice(0, 300));
    var h = resp.getHeaders();
    return { json: JSON.parse(resp.getContentText() || '{}'), link: h['Link'] || h['link'] || '' };
  }
  throw new Error('Shopify: too many 429s (rate limit) â€” try again.');
}

/** POST/PUT an Admin API path. Same retry on 429 as the GET, same error shape. */
function shopifyWrite_(pathQuery, method, body) {
  /* The store this call belongs to — Ridhi unless somebody set the other one. */
  var token = shopifyToken_();
  var url = 'https://' + shopifyStore_() + '/admin/api/' + SHOP_API_VERSION + pathQuery;
  for (var att = 0; att < 5; att++) {
    var resp = UrlFetchApp.fetch(url, {
      method: method || 'post', muteHttpExceptions: true, contentType: 'application/json',
      headers: { 'X-Shopify-Access-Token': token },
      payload: JSON.stringify(body || {}),
    });
    var code = resp.getResponseCode();
    if (code === 429) { Utilities.sleep(2500); continue; }
    var text = resp.getContentText();
    if (code === 401 || code === 403) {
      throw new Error('Shopify ' + code + ' â€” the token cannot WRITE. The app needs the fulfilment '
        + 'write scope, and a token issued before the scope was added will not have it: '
        + text.slice(0, 200));
    }
    if (code >= 300) throw new Error('Shopify ' + code + ': ' + text.slice(0, 300));
    return JSON.parse(text || '{}');
  }
  throw new Error('Shopify: too many 429s (rate limit) â€” try again.');
}

function shopifyNextPageInfo_(link) {
  var m = String(link || '').match(/<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* THE QUERY WINDOW AND THE DAY WERE MEASURED IN DIFFERENT ZONES.
 *
 * `created_at_min`/`max` were sent as ...T00:00:00Z and ...T23:59:59Z, in UTC. The day an order
 * belongs to is then taken from the first ten characters of `created_at`, which Shopify returns in
 * the STORE's offset. Those two only agree if the store runs on UTC, and this one does not.
 *
 * On a store behind UTC every evening order falls into the next UTC day and was cut off by the max
 * bound: orders placed after about 5pm simply never arrived. That is exactly what "the app stops at
 * #3411 while Shopify shows #3416" looks like. A store ahead of UTC loses its early mornings the
 * same way, at the other end.
 *
 * Rather than hard-code the shop's timezone — which is a setting somebody can change without
 * telling anyone — the window is widened by a day at each end and the exact filtering is done on
 * the store-local date afterwards. One extra day of orders costs one page; a missing day costs a
 * shipment.
 */
function shopWindow_(fromIso, toIso) {
  var shift = function (iso, days) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  };
  return '&created_at_min=' + encodeURIComponent(shift(fromIso, -1) + 'T00:00:00Z')
       + '&created_at_max=' + encodeURIComponent(shift(toIso, 1) + 'T23:59:59Z');
}
/** The store-local trading date of an order, and whether it lands inside the asked-for window. */
function shopDayOf_(o) { return String((o && o.created_at) || '').slice(0, 10); }
function shopInWindow_(o, fromIso, toIso) {
  var d = shopDayOf_(o);
  return !!d && d >= fromIso && d <= toIso;
}

/**
 * Daily totals between two dates: { 'YYYY-MM-DD': [sales, units, orders] }.
 *
 * The day comes from `created_at`, which Shopify returns with the STORE's own offset â€” so slicing
 * the first ten characters gives the store-local trading date. That is deliberately the same idea
 * as the Amazon side, where the day is the marketplace's day, not the server's. Getting this wrong
 * is what shifted the Amazon figures by a day, and it is just as easy to get wrong here.
 */
function shopifyDaily_(fromIso, toIso, deadlineMs) {
  var fields = 'id,created_at,financial_status,line_items';
  var path = '/orders.json?status=any&limit=250&fields=' + fields + shopWindow_(fromIso, toIso);
  var out = {}, pageInfo = null, guard = 0, orders = 0;
  do {
    var r = shopifyGet_(pageInfo
      ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo)
      : path);
    (r.json.orders || []).forEach(function (o) {
      // Cancelled and refunded-to-zero orders should not count as sales.
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      // The window was widened by a day at each end; this is where it is trimmed back, on the
      // store's own date rather than on UTC.
      if (!shopInWindow_(o, fromIso, toIso)) return;
      var day = shopDayOf_(o);
      var b = out[day] || (out[day] = [0, 0, 0]);
      (o.line_items || []).forEach(function (li) {
        var qty = Number(li.quantity) || 0;
        b[0] += (Number(li.price) || 0) * qty;
        b[1] += qty;
      });
      b[2] += 1;
      orders++;
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    guard++;
  } while (pageInfo && guard < 300 && (!deadlineMs || Date.now() < deadlineMs));
  Object.keys(out).forEach(function (d) { out[d][0] = Math.round(out[d][0] * 100) / 100; });
  return { ok: true, from: fromIso, to: toIso, orders: orders, more: !!pageInfo, dates: out };
}

/**
 * Individual orders, with everything a shipment needs on them.
 *
 * The daily roll-up above answers "how did we do"; this answers "what has to go out of the door",
 * so it carries the address, the line items with their SKUs, and the per-item weight Shopify keeps
 * in `grams`. Nothing is aggregated â€” a courier label is made from one order at a time.
 *
 * `unfulfilled` narrows it to what is still owed, which is almost always the question. Shopify
 * reports a fully shipped order as 'fulfilled' and leaves the field NULL when nothing has shipped,
 * so "still owed" is "not fulfilled", null included â€” checking for the string alone would hide
 * every untouched order.
 */
/**
 * The store's own IANA timezone, e.g. "America/New_York".
 *
 * Shopify stamps `created_at` with the STORE's offset, and that is the date every order in this
 * response carries. So "today" in the app has to mean today in the STORE's day — not the viewer's
 * in India, and not the marketplace's PT. Read rather than hard-coded, for the same reason
 * shopWindow_ refuses to hard-code it: it is a setting somebody can change without telling anyone.
 * One extra request, cached for the execution so a paged fetch does not ask again.
 */
var SHOP_TZ_CACHE = null;
function shopTz_() {
  if (SHOP_TZ_CACHE !== null) return SHOP_TZ_CACHE;
  try {
    var r = shopifyGet_('/shop.json?fields=iana_timezone');
    SHOP_TZ_CACHE = (r.json.shop && r.json.shop.iana_timezone) || '';
  } catch (e) { SHOP_TZ_CACHE = ''; }   // the orders still work; the app falls back and says so
  return SHOP_TZ_CACHE;
}

function shopifyOrders_(fromIso, toIso, unfulfilled, deadlineMs) {
  // `fulfillments` carries the tracking numbers. `fulfillment_status` alone only says whether
  // something shipped, never what it shipped on â€” and "shipped" without a tracking number is not an
  // answer anybody can give a customer.
  // cancelled_at is the ONLY honest marker for a cancelled order: status=any returns them looking
  // exactly like live ones, and fulfillment_status stays null on both. Without it the app cannot
  // tell "nothing has shipped yet" from "this is never shipping".
  // `refunds` is what makes a refunded line visible at all. Shopify does NOT put "this line was
  // refunded" on the line item — it puts the refund on the order, as a list pointing back by
  // line_item_id. Without it a refunded line looks exactly like a live one: it keeps its order in
  // "Need from production" for ever and it goes into an MCF parcel that nobody is owed.
  var fields = 'id,name,order_number,created_at,cancelled_at,cancel_reason,'
    + 'financial_status,fulfillment_status,currency,'
    + 'total_price,shipping_address,customer,email,phone,note,line_items,tags,fulfillments,refunds';
  var base = '/orders.json?status=any&limit=250&fields=' + fields + shopWindow_(fromIso, toIso);
  var out = [], pageInfo = null, guard = 0;
  do {
    var r = shopifyGet_(pageInfo
      ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo)
      : base);
    (r.json.orders || []).forEach(function (o) {
      if (!shopInWindow_(o, fromIso, toIso)) return;      // trimmed on the STORE's date
      var ff = String(o.fulfillment_status || '').toLowerCase();
      if (unfulfilled && ff === 'fulfilled') return;
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      var a = o.shipping_address || {};
      // Refunded units per line, added up across every refund on the order.
      var refBy = {};
      (o.refunds || []).forEach(function (rf) {
        (rf.refund_line_items || []).forEach(function (rl) {
          var k = String(rl.line_item_id || '');
          if (k) refBy[k] = (refBy[k] || 0) + (Number(rl.quantity) || 0);
        });
      });
      var refUnits = 0;
      var items = (o.line_items || []).map(function (li) {
        var lid = li.id ? String(li.id) : '';
        var rq = refBy[lid] || 0;
        refUnits += rq;
        return {
          lid: lid,
          // Refunded units on this line.
          rq: rq,
          // Shopify's OWN "still to fulfil" count, and the line's own fulfilment state. Both are
          // needed together: fulfillable_quantity drops to 0 when a line SHIPS as well as when it
          // is refunded, so it means "fulfilment not required" only on a line that never shipped.
          // Read alone it would mark every despatched order as cancelled.
          fq: li.fulfillable_quantity == null ? null : Number(li.fulfillable_quantity),
          // What is left after REFUNDS AND ORDER EDITS. An edit that takes a line off the order does
          // not refund it and does not appear in `refunds` at all — Shopify keeps the original
          // quantity and drops this one, and its admin lists those lines under "Removed". Without it
          // a line the buyer had taken off still got picked, packed and sent.
          cq: li.current_quantity == null ? null : Number(li.current_quantity),
          ffl: li.fulfillment_status || '',
          sku: String(li.sku || '').trim(),
          name: li.title || '',
          variant: li.variant_title || '',
          qty: Number(li.quantity) || 0,
          price: Number(li.price) || 0,
          // Shopify holds weight in grams per UNIT; the line's weight is that times the quantity.
          grams: (Number(li.grams) || 0) * (Number(li.quantity) || 0),
          // Carried so the photo can be looked up below. A line item has no image of its own.
          pid: li.product_id ? String(li.product_id) : '',
          vid: li.variant_id ? String(li.variant_id) : '',
        };
      });
      /* Tracking, gathered across every fulfilment on the order.
       *
       * An order can ship in more than one parcel, so there can be more than one number, and a
       * single fulfilment can itself carry several in `tracking_numbers`. All of them are kept:
       * showing the first and hiding the rest is how a customer gets told half a shipment is lost.
       * Cancelled fulfilments are dropped â€” their numbers point at parcels that never went. */
      var trk = [], trkCo = '', trkUrl = '', shippedAt = '';
      (o.fulfillments || []).forEach(function (f) {
        if (String(f.status || '').toLowerCase() === 'cancelled') return;
        var list = (f.tracking_numbers && f.tracking_numbers.length)
          ? f.tracking_numbers : [f.tracking_number];
        list.forEach(function (t) {
          var s = String(t || '').trim();
          if (s && trk.indexOf(s) < 0) trk.push(s);
        });
        if (!trkCo && f.tracking_company) trkCo = String(f.tracking_company);
        var u = f.tracking_url || (f.tracking_urls && f.tracking_urls[0]);
        if (!trkUrl && u) trkUrl = String(u);
        var c = String(f.created_at || '').slice(0, 10);
        if (c && (!shippedAt || c < shippedAt)) shippedAt = c;
      });

      out.push({
        id: String(o.id),
        no: o.name || ('#' + o.order_number),
        at: String(o.created_at || '').slice(0, 10),
        // Empty for a live order. Kept as a DATE rather than a boolean so the app can say when.
        cancelledAt: String(o.cancelled_at || '').slice(0, 10),
        cancelReason: o.cancel_reason || '',
        fin: o.financial_status || '',
        // Units refunded across the whole order. An order whose every unit came back is over,
        // whatever its fulfilment status says.
        refUnits: refUnits,
        // Shopify leaves this NULL when nothing has shipped; 'unfulfilled' is clearer to read than
        // an empty cell, and 'partial' is a real state that must not be rounded to either end.
        ff: String(o.fulfillment_status || 'unfulfilled'),
        trk: trk, trkCo: trkCo, trkUrl: trkUrl, shippedAt: shippedAt,
        cur: o.currency || 'USD',
        total: Number(o.total_price) || 0,
        note: o.note || '',
        tags: o.tags || '',
        ship: {
          name: a.name || ((a.first_name || '') + ' ' + (a.last_name || '')).trim(),
          company: a.company || '', a1: a.address1 || '', a2: a.address2 || '',
          city: a.city || '', state: a.province_code || a.province || '',
          zip: a.zip || '', country: a.country_code || a.country || '',
          phone: a.phone || o.phone || '',
        },
        email: o.email || '',
        items: items,
      });
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    guard++;
  } while (pageInfo && guard < 300 && (!deadlineMs || Date.now() < deadlineMs));

  shopifyAttachImages_(out, deadlineMs);
  return { ok: true, from: fromIso, to: toIso, tz: shopTz_(),
    n: out.length, more: !!pageInfo, orders: out };
}

