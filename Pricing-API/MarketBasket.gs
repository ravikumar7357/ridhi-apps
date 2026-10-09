/* Pricing-API / MarketBasket.gs — Bought Together: Market Basket Analysis, one ASIN and the whole catalogue.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Bought together: Market Basket Analysis =====================
 *
 * "Which of my other products end up in the same basket as this one" is a real Brand Analytics
 * report — GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT — and it answers exactly that: for each of your
 * ASINs, the products most often purchased alongside it, with the share of baskets.
 *
 * It is worth having for two different reasons, and they pull in opposite directions:
 *   - a product frequently bought with yours is a BUNDLE, a virtual bundle, or a cross-sell.
 *   - if that product is a COMPETITOR'S, it is a gap in your own range: the customer wanted both and
 *     you only sold one of them.
 * So the report is kept whole and the "is it mine" question is answered separately, from the
 * seller's own catalogue, rather than being assumed either way.
 *
 * Whether this report needs an `asin` option is NOT assumed. SQP did, and that was only discovered
 * by asking and reading Amazon's own refusal. The same reader is in place here, so a wrong guess
 * comes back as a sentence rather than as silence.
 */
var MB_PENDING = 'MB_PENDING';

function basketAsk_(period, back) {
  var p = (period || 'MONTH').toUpperCase();
  var w = baPeriodWindow_(p, back);
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT',
      marketplaceIds: [marketplaceId_()],
      reportOptions: { reportPeriod: p },
      dataStartTime: w.start.toISOString(), dataEndTime: w.end.toISOString(),
    });
    return { ok: true, reportId: r.reportId, period: p,
      window: w.start.toISOString().slice(0, 10) + ' → ' + w.end.toISOString().slice(0, 10) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/**
 * Collect a finished basket report into { asin: [ {withAsin, title, share, mine} ] }.
 *
 * `mine` is answered from the seller's OWN Catalog tab, not guessed from the brand name on the
 * title — a brand string can be anything, and getting this backwards turns "extend your range" into
 * "build a bundle" or the other way round.
 */
function basketGet_(id) {
  var p = baPoll_(id);
  if (!p.ok) return p;
  if (p.status !== 'done') return { ok: true, status: p.status };

  var mineSet = {};
  try {
    var cat = skuAsinMap_();
    Object.keys(cat.map || {}).forEach(function (sku) { mineSet[cat.map[sku]] = 1; });
  } catch (e) { /* no catalogue access — every row simply comes back with mine:null */ }
  var known = !!Object.keys(mineSet).length;

  var out = {}, rows = 0, noAsin = 0;
  (p.raw || []).forEach(function (x) {
    var a = String(baGet_(x, /^asin$/i, true) || baGet_(x, /purchased.*asin|^asin/i, true) || '').toUpperCase();
    var w = String(baGet_(x, /purchased.?with.?asin|combination.*asin|with.?asin/i, true) || '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(a) || !/^[A-Z0-9]{10}$/.test(w)) { noAsin++; return; }
    rows++;
    (out[a] || (out[a] = [])).push({
      withAsin: w,
      title: String(baGet_(x, /product.?title|title|name/i, true) || ''),
      share: num_(baGet_(x, /combination.?percent|percentage|share/i)),
      // null, not false, when the catalogue could not be read: "not mine" and "I could not tell"
      // are different answers and only one of them is a reason to go and source a product.
      mine: known ? !!mineSet[w] : null,
    });
  });
  Object.keys(out).forEach(function (a) {
    out[a].sort(function (x, y) { return (y.share || 0) - (x.share || 0); });
    if (out[a].length > 10) out[a].length = 10;
  });
  return { ok: true, status: 'done', asins: Object.keys(out).length, rows: rows,
    noAsin: noAsin, total: p.total || 0, sample: p.sample || null, catalogueKnown: known, d: out };
}

/** Editor check, two runs: ask, then collect. Proves the report exists and what its rows look like. */
function basketTest(period) {
  var props = PropertiesService.getScriptProperties();
  var pend = prop_(MB_PENDING);
  if (!pend) {
    var a = basketAsk_(period || 'MONTH');
    if (!a.ok) { Logger.log('Could not ask: ' + a.error); return; }
    props.setProperty(MB_PENDING, a.reportId);
    Logger.log('Market Basket report ' + a.reportId + ' asked for ' + a.period + ' (' + a.window + ').');
    Logger.log('RUN AGAIN in a few minutes.');
    return;
  }
  var r = basketGet_(pend);
  if (!r.ok) {
    var dead = /FATAL|CANCELLED/i.test(String(r.error || ''));
    Logger.log((dead ? 'Failed: ' : 'Not ready: ') + r.error);
    if (r.reason) { Logger.log('AMAZON’S OWN REASON:'); Logger.log('   ' + r.reason); }
    if (dead) props.deleteProperty(MB_PENDING); else Logger.log('Still parked — run again shortly.');
    return;
  }
  if (r.status !== 'done') { Logger.log('Still ' + r.status + ' — run again shortly.'); return; }
  props.deleteProperty(MB_PENDING);

  Logger.log(r.total + ' row(s) in the report; ' + r.rows + ' usable, covering ' + r.asins + ' ASIN(s).');
  if (r.noAsin) Logger.log(r.noAsin + ' row(s) had no readable ASIN pair.');
  if (!r.rows) {
    Logger.log('Nothing usable. RAW FIRST ROW so the field names are visible rather than guessed:');
    Logger.log('   ' + JSON.stringify(r.sample).slice(0, 900));
    return;
  }
  if (!r.catalogueKnown) Logger.log('(the Catalog tab could not be read, so "mine" is unknown on every row)');
  Object.keys(r.d).slice(0, 4).forEach(function (a) {
    Logger.log('');
    Logger.log(a + ' is bought together with:');
    r.d[a].slice(0, 5).forEach(function (x) {
      Logger.log('   ' + x.withAsin + '  ' + (x.share ? x.share + '%' : '')
        + '  ' + (x.mine === null ? '[unknown]' : x.mine ? '[YOURS]' : '[someone else’s]')
        + '  ' + String(x.title).slice(0, 70));
    });
  });
}

/* ===================== Market Basket, across the whole catalogue =====================
 *
 * The report is BRAND-WIDE, so one of it answers for every product — which is why this is a screen
 * of its own rather than a card on a single listing.
 *
 * It is split into two buckets because the two answers call for opposite work:
 *
 *   BUNDLE CANDIDATES — both products are yours. Customers are already buying them together, so a
 *   bundle, a virtual bundle or a cross-sell placement is capturing something that is happening
 *   anyway. Nothing to source, nothing to make.
 *
 *   RANGE GAPS — the partner is somebody else's. The customer wanted both and you sold one of them.
 *   That is a product to add, and it is ranked by HOW MANY of your ASINs it pairs with rather than
 *   by a single share: a product that shows up beside twenty of yours is a hole in the range, while
 *   one that shows up beside a single ASIN at a high share is that ASIN's accessory.
 *
 * Mixing the two into one "bought together" list is what makes the report look interesting and turn
 * out to be unusable — you cannot act on a row until you know whose the other product is.
 */
function basketAll_(id) {
  var g = basketGet_(id);
  if (!g.ok || g.status !== 'done') return g;

  /* SKU beside the ASIN, for our own products only. An ASIN is not a thing anyone recognises; the
   * SKU is what Ravi's own sheets, POs and packing lists are keyed on. */
  var skuOf = {};
  try {
    var cat = skuAsinMap_();
    Object.keys(cat.map || {}).forEach(function (sku) {
      var a = cat.map[sku];
      if (a && !skuOf[a]) skuOf[a] = sku;
    });
  } catch (e) { /* no catalogue — the ASIN stands on its own */ }

  var pairs = [], gapBy = {}, seenPair = {};
  Object.keys(g.d || {}).forEach(function (a) {
    (g.d[a] || []).forEach(function (x) {
      if (x.mine) {
        /* A PAIR IS ONE FACT, REPORTED TWICE. Amazon lists A-with-B and B-with-A, and showing both
         * makes twenty bundle ideas look like forty. Keyed on the sorted pair so it lands once, and
         * the higher of the two shares is kept — they are usually not identical, because the share
         * is of each product's OWN baskets. */
        var k = [a, x.withAsin].sort().join('|');
        if (seenPair[k]) { seenPair[k].share = Math.max(seenPair[k].share, x.share || 0); return; }
        seenPair[k] = { a: a, b: x.withAsin, aSku: skuOf[a] || '', bSku: skuOf[x.withAsin] || '',
          title: x.title || '', share: x.share || 0 };
        pairs.push(seenPair[k]);
      } else if (x.mine === false) {
        var e = gapBy[x.withAsin] || (gapBy[x.withAsin] = {
          asin: x.withAsin, title: x.title || '', n: 0, best: 0, with: [] });
        e.n++;
        if ((x.share || 0) > e.best) e.best = x.share || 0;
        if (e.with.length < 8) e.with.push({ asin: a, sku: skuOf[a] || '' });
        if (!e.title && x.title) e.title = x.title;
      }
    });
  });

  pairs.sort(function (p, q) { return (q.share || 0) - (p.share || 0); });
  var gaps = Object.keys(gapBy).map(function (k) { return gapBy[k]; })
    // How MANY of your products it pairs with first: that is what separates a hole in the range from
    // one product's accessory. The best single share breaks ties.
    .sort(function (p, q) { return (q.n - p.n) || (q.best - p.best); });

  return { ok: true, status: 'done', asins: g.asins, rows: g.rows, total: g.total,
    catalogueKnown: g.catalogueKnown, mineCount: Object.keys(skuOf).length,
    pairs: pairs.slice(0, 300), gaps: gaps.slice(0, 300), skuOf: skuOf, d: g.d };
}

