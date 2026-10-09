/* Pricing-API / Lookups.gs — the ?asin= lookup (By Amazon Link): catalogue, offers, fees.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Lookups ===================== */

/**
 * ASIN out of any Amazon URL form (/dp/ASIN, /gp/product/ASIN, /product/ASIN, ?asin=ASIN),
 * or a bare ASIN. Returns '' when nothing looks like an ASIN.
 */
function asinFromUrl_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();                      // bare ASIN
  var m = s.match(/\/(?:dp|gp\/product|product|gp\/aw\/d)\/([A-Z0-9]{10})/i)   // the usual link shapes
       || s.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})/)
       || s.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);                              // last-resort path segment
  return m ? m[1].toUpperCase() : '';
}

/**
 * Catalog details for an ASIN â†’ {title, brand, category, weight, dims}. Non-fatal: blanks on failure.
 * `dims` = {l, w, h, unit} â€” the PACKAGE size Amazon has on file (falls back to item size), for the
 * seller's reference only. Weight prefers item, dims prefer package (the FBA tier is sized on package).
 */
function fetchCatalog_(asin) {
  var out = { title: '', brand: '', category: '', weight: 0, dims: null };
  try {
    var r = spRetry_('/catalog/2022-04-01/items/' + asin + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=summaries,attributes,dimensions', 'get');
    var s = (r.summaries && r.summaries[0]) || {};
    out.title = s.itemName || '';
    out.brand = s.brandName || s.brand || '';
    out.category = (s.browseClassification && s.browseClassification.displayName) || '';
    var d = (r.dimensions && r.dimensions[0]) || {};
    var w = (d.item && d.item.weight) || (d.package && d.package.weight) || null;
    if (w && w.value) out.weight = num_(w.value);
    // Package size preferred (matches the FBA tier / the app's "Package size" fields); else item size.
    var box = d.package || d.item || {};
    var l = box.length && num_(box.length.value), wd = box.width && num_(box.width.value),
        h = box.height && num_(box.height.value);
    if (l > 0 && wd > 0 && h > 0) {
      var u = (box.length && box.length.unit) || (box.width && box.width.unit) || '';
      out.dims = { l: l, w: wd, h: h, unit: String(u || '').toLowerCase() };
    }
  } catch (e) { Logger.log('catalog ' + asin + ': ' + e); }
  return out;
}

/** Live offers for an ASIN â†’ {buyBox, lowest, offers}. 0s when the ASIN has no live offer. */
function fetchOffers_(asin) {
  var out = { buyBox: 0, lowest: 0, offers: 0 };
  var r = spRetry_('/products/pricing/v0/items/' + asin + '/offers?MarketplaceId=' + marketplaceId_() +
    '&ItemCondition=New', 'get');
  var sum = (r.payload && r.payload.Summary) || {};
  out.offers = num_(sum.TotalOfferCount);
  var bb = (sum.BuyBoxPrices && sum.BuyBoxPrices[0]) || null;
  if (bb) out.buyBox = num_((bb.LandedPrice && bb.LandedPrice.Amount) || (bb.ListingPrice && bb.ListingPrice.Amount));
  // LowestPrices carries several fulfilment channels â€” take the cheapest landed price of any of them.
  ((sum.LowestPrices) || []).forEach(function (lp) {
    var amt = num_((lp.LandedPrice && lp.LandedPrice.Amount) || (lp.ListingPrice && lp.ListingPrice.Amount));
    if (amt > 0 && (out.lowest === 0 || amt < out.lowest)) out.lowest = amt;
  });
  return out;
}

/**
 * Amazon's fee estimate for selling THIS asin at `price`, fulfilled by FBA â†’ {referral, fba, total}.
 * Works for any ASIN, not just your own listings â€” that's what makes product research possible.
 * Referral scales with the price, so the estimate is only valid at the price it was quoted at.
 */
function fetchFees_(asin, price) {
  var out = { referral: 0, fba: 0, total: 0 };
  var body = {
    FeesEstimateRequest: {
      MarketplaceId: marketplaceId_(),
      IsAmazonFulfilled: true,
      Identifier: asin + '-' + Date.now(),
      PriceToEstimateFees: { ListingPrice: { CurrencyCode: 'USD', Amount: price } },
    },
  };
  var r = spRetry_('/products/fees/v0/items/' + asin + '/feesEstimate', 'post', body);
  var res = (r.payload && r.payload.FeesEstimateResult) || {};
  if (res.Status && String(res.Status).toUpperCase() !== 'SUCCESS') {
    throw new Error('fees ' + res.Status + (res.Error ? ' â€” ' + (res.Error.Message || '') : ''));
  }
  var est = res.FeesEstimate || {};
  out.total = num_(est.TotalFeesEstimate && est.TotalFeesEstimate.Amount);
  (est.FeeDetailList || []).forEach(function (f) {
    var t = String(f.FeeType || '').toLowerCase();
    var amt = num_(f.FeeAmount && f.FeeAmount.Amount);
    if (t.indexOf('referral') >= 0) out.referral += amt;
    else if (t.indexOf('fba') >= 0 || t.indexOf('fulfillment') >= 0) out.fba += amt;
  });
  return out;
}

