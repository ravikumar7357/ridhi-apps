/* Pricing-API / Mcf.gs — MCF: shipping a Shopify order out of FBA, and marking it in progress.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== MCF: shipping a Shopify order out of FBA =====================
 *
 * Three calls, deliberately separate, because they carry very different consequences.
 *
 *   PREVIEW  asks Amazon what it WOULD do â€” which speeds are possible, the fee for each, the
 *            delivery date. Creates nothing. Safe to call as often as you like.
 *   CREATE   places a real shipment. Amazon picks, packs and ships; it costs money and there is no
 *            undo button in this app.
 *   STATUS   reads back what happened, including the tracking number once Amazon has one.
 *
 * The whole design rests on ONE idea: the fulfilment order id is derived from the Shopify order
 * number, never generated. Amazon rejects a duplicate id, so a double-click, a retry after a
 * timeout, or two people working the same list cannot ship the same order twice. That is a much
 * stronger guarantee than a disabled button, because it holds even when the browser is not involved.
 */

/** 'SHOP-1042' from Shopify's '#1042'. Stable, so the same order always maps to the same MCF id. */
function mcfIdOf_(orderNo) {
  return 'SHOP-' + String(orderNo || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
}

/** The address and item shape both preview and create need, built once from what the browser sent. */
function mcfBody_(o) {
  var a = o.ship || {};
  if (!a.a1 || !a.city || !a.country) throw new Error('The order has no usable shipping address.');
  var items = (o.items || []).filter(function (i) { return i.sku && Number(i.qty) > 0; });
  if (!items.length) throw new Error('No line has a SKU Amazon could ship.');
  return {
    address: {
      name: String(a.name || '').slice(0, 50) || 'Customer',
      addressLine1: String(a.a1).slice(0, 60),
      addressLine2: String(a.a2 || '').slice(0, 60) || undefined,
      city: String(a.city).slice(0, 50),
      stateOrRegion: String(a.state || '').slice(0, 150),
      postalCode: String(a.zip || '').slice(0, 20),
      countryCode: String(a.country).slice(0, 2).toUpperCase(),
      phone: String(a.phone || '').slice(0, 20) || undefined,
    },
    items: items.map(function (i, n) {
      return {
        sellerSku: String(i.sku).trim(),
        // Amazon keys its response by this, so it has to be stable AND unique inside the order.
        sellerFulfillmentOrderItemId: String(n + 1),
        quantity: Number(i.qty),
      };
    }),
  };
}

/**
 * What Amazon would charge and when it would arrive, per speed. Creates nothing.
 *
 * Every speed is asked for at once rather than one at a time: the answer for Standard does not tell
 * you whether Priority is even available, and a person choosing how to ship needs all three in front
 * of them or they are not choosing, they are guessing.
 */
function mcfPreview_(o) {
  setBrand_(o.brand || 'SP');
  /* The Shopify half of this — marking the order in progress — belongs to the store the order
   * is in, which is not always the Amazon account it ships from. Absent means Ridhi. */
  setShopBrand_(o.shop || '');
  var b = mcfBody_(o);
  var r = sp_('/fba/outbound/2020-07-01/fulfillmentOrders/preview', 'post', {
    marketplaceId: marketplaceId_(),
    address: b.address,
    items: b.items,
    shippingSpeedCategories: ['Standard', 'Expedited', 'Priority'],
  });
  var previews = (r.payload && r.payload.fulfillmentPreviews) || [];
  return {
    ok: true,
    mcfId: mcfIdOf_(o.no),
    previews: previews.map(function (p) {
      var fees = (p.estimatedFees || []).reduce(function (s, f) {
        return s + Number((f.amount && f.amount.value) || 0);
      }, 0);
      var dates = (p.fulfillmentPreviewShipments || []).map(function (s) {
        return String(s.latestArrivalDate || '').slice(0, 10);
      }).filter(Boolean).sort();
      return {
        speed: p.shippingSpeedCategory,
        // Amazon says outright when it cannot ship this; showing a fee beside "not fulfillable"
        // would invite somebody to click it.
        ok: p.isFulfillable !== false,
        fee: Math.round(fees * 100) / 100,
        cur: ((p.estimatedFees || [])[0] || {}).amount ? p.estimatedFees[0].amount.currencyCode : 'USD',
        weight: (p.estimatedShippingWeight && p.estimatedShippingWeight.value) || null,
        arriveBy: dates[dates.length - 1] || '',
        unfulfillable: (p.unfulfillablePreviewItems || []).map(function (u) {
          return u.sellerSku + ': ' + (u.itemUnfulfillableReasons || []).join(', ');
        }),
      };
    }),
  };
}

/** Place the shipment. Real money, real parcel. The id makes a repeat call harmless. */
function mcfCreate_(o) {
  setBrand_(o.brand || 'SP');
  /* The Shopify half of this — marking the order in progress — belongs to the store the order
   * is in, which is not always the Amazon account it ships from. Absent means Ridhi. */
  setShopBrand_(o.shop || '');
  var speed = String(o.speed || 'Standard');
  if (['Standard', 'Expedited', 'Priority'].indexOf(speed) < 0) throw new Error('Unknown shipping speed "' + speed + '".');
  var b = mcfBody_(o);
  var id = mcfIdOf_(o.no);
  try {
    sp_('/fba/outbound/2020-07-01/fulfillmentOrders', 'post', {
      marketplaceId: marketplaceId_(),
      sellerFulfillmentOrderId: id,
      displayableOrderId: String(o.no || id).slice(0, 40),
      displayableOrderDate: (o.at || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z',
      displayableOrderComment: String(o.comment || 'Thank you for your order.').slice(0, 1000),
      shippingSpeedCategory: speed,
      destinationAddress: b.address,
      items: b.items,
    });
  } catch (e) {
    // A repeat of an order already placed is NOT a failure. Amazon rejecting the duplicate is the
    // safety net doing its job, and the honest answer is "it is already on its way", not an error.
    if (String(e.message || '').indexOf('DuplicateRequest') < 0) throw e;
    return { ok: true, mcfId: id, already: true, shop: mcfMarkShopInProgress_(o) };
  }
  return { ok: true, mcfId: id, already: false, shop: mcfMarkShopInProgress_(o) };
}

/**
 * Tell Shopify the order is being worked on, now that Amazon has it.
 *
 * DELIBERATELY UNABLE TO FAIL THE MCF ORDER. By the time this runs the parcel is already booked with
 * Amazon and money is committed; throwing here would report a failure for something that succeeded,
 * and the obvious next move — pressing the button again — would be an attempt to place it twice.
 * So every outcome comes back as data on the response and the caller shows it.
 */
function mcfMarkShopInProgress_(o) {
  if (String(prop_('SHOPIFY_INPROGRESS') || '').toLowerCase() !== 'on') {
    return { ok: false, off: true, note: 'Shopify "in progress" is switched off (Script Property SHOPIFY_INPROGRESS).' };
  }
  try { return shopifyMarkInProgress_(o && o.id); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 220) }; }
}

/** What Amazon has done with it since, tracking included. */
function mcfStatus_(mcfId, brand) {
  setBrand_(brand || 'SP');
  var r = sp_('/fba/outbound/2020-07-01/fulfillmentOrders/' + encodeURIComponent(mcfId), 'get');
  var p = r.payload || {};
  var trk = [], co = '', shipped = '';
  (p.fulfillmentShipments || []).forEach(function (s) {
    (s.fulfillmentShipmentPackage || []).forEach(function (k) {
      var t = String(k.trackingNumber || '').trim();
      if (t && trk.indexOf(t) < 0) trk.push(t);
      if (!co && k.carrierCode) co = String(k.carrierCode);
    });
    var d = String(s.shippingDate || '').slice(0, 10);
    if (d && (!shipped || d < shipped)) shipped = d;
  });
  return {
    ok: true, mcfId: mcfId,
    status: (p.fulfillmentOrder && p.fulfillmentOrder.fulfillmentOrderStatus) || '',
    trk: trk, trkCo: co, shippedAt: shipped,
  };
}

/**
 * Mark the Shopify order shipped, with Amazon's tracking number on it.
 *
 * Goes through FULFILMENT ORDERS rather than the old per-order endpoint, which Shopify has retired:
 * you ask which fulfilment orders exist, then fulfil the ones assigned to you. Only OPEN ones are
 * touched, so running this twice cannot raise a second fulfilment or send the customer a second
 * shipping email.
 */
function shopifyFulfil_(orderId, trk, company, notify) {
  var fo = shopifyGet_('/orders/' + encodeURIComponent(orderId) + '/fulfillment_orders.json').json;
  var open = (fo.fulfillment_orders || []).filter(function (f) {
    var s = String(f.status || '').toLowerCase();
    return s === 'open' || s === 'in_progress' || s === 'scheduled';
  });
  if (!open.length) return { ok: true, already: true, note: 'Nothing open to fulfil on Shopify.' };
  var list = (trk || []).filter(Boolean).map(String);
  var r = shopifyWrite_('/fulfillments.json', 'post', {
    fulfillment: {
      line_items_by_fulfillment_order: open.map(function (f) { return { fulfillment_order_id: f.id }; }),
      tracking_info: list.length
        ? { number: list[0], company: company || 'Amazon Logistics' }
        : undefined,
      notify_customer: notify !== false,
    },
  });
  // ONE number goes out, however many Amazon gave. Reading keeps them all; writing does not, and the
  // proper fix waits on the write token (there is nothing to test a payload against until then).
  // What must not wait is saying so: a two-parcel order otherwise tells the customer about one
  // parcel and tells us it told them about all of them. The ones left behind ride back in `held`.
  return {
    ok: true, already: false, id: (r.fulfillment && r.fulfillment.id) || '',
    sent: list.slice(0, 1), held: list.slice(1),
  };
}


/* ===================== Shopify: "in progress" after MCF =====================
 *
 * When a parcel has been handed to Amazon MCF, the Shopify order is no longer just sitting there —
 * somebody IS fulfilling it, and Shopify has a status that says exactly that. This moves it.
 *
 * FOUR THINGS TO KNOW BEFORE TOUCHING THIS, all of them checked rather than assumed (2026-09-01):
 *
 *   1. There is no REST way to do it. `fulfillmentOrderReportProgress` is a GRAPHQL mutation, and
 *      it is new — Shopify's docs put it in API version 2026-07. Until 2025 the official answer was
 *      that IN_PROGRESS could not be reached at all without registering a fulfilment service.
 *
 *   2. So it runs on its OWN API version, SHOP_GQL_VERSION, and leaves SHOP_API_VERSION where it is.
 *      Everything else here — reading orders, the images, the fulfilment write — is REST on 2024-10
 *      and has been working for months. Dragging all of it forward two years to gain one mutation is
 *      a much bigger change than this feature is worth, and it would be an untested one.
 *
 *   3. It needs a token the account may not have: scope `write_merchant_managed_fulfillment_orders`
 *      (or `write_assigned_fulfillment_orders`) PLUS the `fulfill_and_ship_orders` permission. A
 *      token issued before those were added does NOT gain them — it has to be re-issued.
 *
 *   4. THE DOCS DO NOT ACTUALLY PROMISE THE STATUS FLIPS. They say the mutation "reports the
 *      progress of an open or in-progress fulfillment order"; that it lands on IN_PROGRESS is a
 *      forum report, not documentation. So this returns whatever Shopify says the status became,
 *      and the caller records that rather than assuming. Run `shopifyInProgressTest` on ONE order
 *      and read the real answer before switching it on for everybody.
 *
 * OFF BY DEFAULT. Set Script Property SHOPIFY_INPROGRESS = "on" to arm it. Off, nothing is called.
 */
var SHOP_GQL_VERSION = '2026-07';

/**
 * One GraphQL call.
 *
 * Kept apart from shopifyWrite_ because GraphQL answers **200 OK with the failure inside the body**.
 * Running it through the REST helper would read that as success, and a write that quietly did
 * nothing is the worst of the three outcomes.
 */
function shopifyGql_(query, variables) {
  /* The store this call belongs to — Ridhi unless somebody set the other one. */
  var token = shopifyToken_();
  var url = 'https://' + shopifyStore_() + '/admin/api/' + SHOP_GQL_VERSION + '/graphql.json';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': token },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
  });
  var code = resp.getResponseCode(), text = resp.getContentText();
  if (code === 401 || code === 403) {
    throw new Error('Shopify ' + code + ' — this token cannot write fulfilment orders. It needs '
      + 'write_merchant_managed_fulfillment_orders and fulfill_and_ship_orders, and a token issued '
      + 'before those scopes were added will not have them: ' + text.slice(0, 160));
  }
  if (code >= 300) throw new Error('Shopify ' + code + ': ' + text.slice(0, 300));
  var d = JSON.parse(text || '{}');
  if (d.errors && d.errors.length) {
    throw new Error('Shopify GraphQL: ' + String(d.errors[0].message || '').slice(0, 200));
  }
  return d.data || {};
}

/**
 * Move an order's OPEN fulfilment orders to "in progress".
 *
 * Only genuinely OPEN ones are touched, so running this twice is harmless — the second run finds
 * nothing open and says so, exactly like shopifyFulfil_ does.
 */
function shopifyMarkInProgress_(shopifyOrderId) {
  // An IMPORTED order (Etsy, CPC Shopify) has an id like "IMP-…" and does not exist in this Shopify
  // store at all. Sending that to Shopify would 404 on an order somebody would then go looking for.
  var id = String(shopifyOrderId || '').trim();
  if (!/^\d+$/.test(id)) return { ok: true, skipped: true, note: 'Not a Shopify-fetched order — nothing to move.' };

  var fo = shopifyGet_('/orders/' + encodeURIComponent(id) + '/fulfillment_orders.json').json;
  var open = (fo.fulfillment_orders || []).filter(function (f) {
    return String(f.status || '').toLowerCase() === 'open';
  });
  if (!open.length) return { ok: true, already: true, note: 'No open fulfilment order on this Shopify order.' };

  // `progressReport` is optional and its inner field names are not something this code has verified,
  // so it is not sent. One guess fewer.
  var Q = 'mutation($id: ID!) {'
        + '  fulfillmentOrderReportProgress(id: $id) {'
        + '    fulfillmentOrder { id status }'
        + '    userErrors { field message }'
        + '  }'
        + '}';
  var moved = [];
  for (var i = 0; i < open.length; i++) {
    var d = shopifyGql_(Q, { id: 'gid://shopify/FulfillmentOrder/' + open[i].id });
    var p = (d && d.fulfillmentOrderReportProgress) || {};
    var errs = (p.userErrors || []).map(function (e) { return e.message; }).filter(Boolean);
    if (errs.length) throw new Error(errs.join('; ').slice(0, 200));
    moved.push({
      id: open[i].id,
      // What Shopify SAYS it is now — not what this code hoped it would be.
      status: (p.fulfillmentOrder && p.fulfillmentOrder.status) || '',
    });
  }
  return { ok: true, moved: moved };
}

/**
 * Editor check: run the whole thing against ONE order and print exactly what Shopify answered.
 *
 * The same shape as indiaStockTest and basketTest — when something has never run against the real
 * account, the fix is one line printed in the editor, not a redeploy per guess. Put a real Shopify
 * order id (the long number, not "#4136") in ORDER_ID and press Run.
 */
function shopifyInProgressTest() {
  var ORDER_ID = '';
  if (!ORDER_ID) {
    Logger.log('Put a numeric Shopify order id in ORDER_ID first (Shopify admin URL: /orders/<this number>).');
    return;
  }
  Logger.log('token set: %s · graphql version: %s', !!prop_('SHOPIFY_TOKEN'), SHOP_GQL_VERSION);
  try {
    var fo = shopifyGet_('/orders/' + ORDER_ID + '/fulfillment_orders.json').json;
    (fo.fulfillment_orders || []).forEach(function (f) {
      Logger.log('fulfilment order %s — status %s · assigned to %s', f.id, f.status,
        (f.assigned_location && f.assigned_location.name) || '?');
    });
    Logger.log('RESULT: %s', JSON.stringify(shopifyMarkInProgress_(ORDER_ID)));
  } catch (e) {
    Logger.log('FAILED: %s', e.message || e);
  }
}

/**
 * Hang a product photo on every line item.
 *
 * A Shopify line item carries no image, only the ids, so the products have to be asked for
 * separately â€” once for the whole page of orders rather than once per line, which for a few hundred
 * orders is the difference between two requests and a thousand.
 *
 * The VARIANT's own photo wins where it has one: on a catalogue of colourways, the product-level
 * image is whichever colour happens to be first, and shipping the wrong colour because the picture
 * said so is a real mistake. The product image is the fallback, not the answer.
 */
function shopifyAttachImages_(orders, deadlineMs) {
  var ids = {}, list = [];
  orders.forEach(function (o) {
    o.items.forEach(function (i) { if (i.pid && !ids[i.pid]) { ids[i.pid] = 1; list.push(i.pid); } });
  });
  if (!list.length) return;

  var byVariant = {}, byProduct = {};
  for (var i = 0; i < list.length; i += 100) {
    if (deadlineMs && Date.now() > deadlineMs) break;
    var chunk = list.slice(i, i + 100);
    try {
      var r = shopifyGet_('/products.json?limit=250&fields=id,image,images,variants&ids=' + chunk.join(','));
      (r.json.products || []).forEach(function (p) {
        var pid = String(p.id);
        if (p.image && p.image.src) byProduct[pid] = p.image.src;
        var srcById = {};
        (p.images || []).forEach(function (im) { if (im && im.id) srcById[String(im.id)] = im.src; });
        (p.variants || []).forEach(function (v) {
          var src = v.image_id ? srcById[String(v.image_id)] : '';
          if (src) byVariant[String(v.id)] = src;
        });
      });
    } catch (e) { /* photos are a nicety â€” an order still ships without one */ }
  }

  orders.forEach(function (o) {
    o.items.forEach(function (it) {
      it.img = (it.vid && byVariant[it.vid]) || (it.pid && byProduct[it.pid]) || '';
    });
  });
}

