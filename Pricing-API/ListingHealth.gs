/* Pricing-API / ListingHealth.gs — Listing Health.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Listing health ===================== */

/**
 * Ask Amazon for the full listings report. Same async create/poll shape as the ageing report.
 * GET_MERCHANT_LISTINGS_ALL_DATA covers EVERY listing (active and inactive) â€” inactive ones are the
 * whole point here, so the "active only" variant of this report would defeat the purpose.
 */
function lhCreate_() {
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [marketplaceId_()],
    });
    return { ok: true, reportId: r.reportId, brand: ACTIVE_PREFIX };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/**
 * Poll the listings report; when DONE, shape one row per SKU.
 *
 * Column names are resolved through pick_ with several candidate spellings because Amazon's flat
 * files are not consistent between report flavours (and have drifted over the years) â€” the ageing
 * report taught us the same lesson. A missing column degrades one field, it never breaks the row.
 *
 * NOTE: this returns FACTS ONLY (status, price, qty, dates). The health SCORE is computed in the
 * browser so the rules can be tuned without a backend redeploy â€” the backend is version-pinned and
 * every rule change would otherwise cost a Manage-deployments round trip.
 */
function lhPoll_(id) {
  if (!id) return { ok: false, error: 'no report id' };
  var r;
  try { r = sp_('/reports/2021-06-30/reports/' + id, 'get'); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var st = r.processingStatus;
  if (st === 'FATAL' || st === 'CANCELLED') return { ok: false, status: st, error: 'Report ended as ' + st };
  if (st !== 'DONE') return { ok: true, status: 'processing' };

  var doc;
  try { doc = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get'); }
  catch (e) { return { ok: false, error: 'document: ' + String(e.message || e).slice(0, 200) }; }
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') {
    try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) {}
  }
  var rows = parseTsv_(blob.getDataAsString('UTF-8'));
  if (!rows.length) return { ok: true, status: 'done', rows: [], total: 0 };

  var parents = catalogParents_();
  // BLANK IS NOT ZERO. This report's `price` and `quantity` are the MERCHANT-fulfilled fields, and on
  // an FBA listing they are routinely empty â€” the stock lives on the FBA side, not here. Reading an
  // empty cell as 0 made every FBA listing look "out of stock / no price", which is how the first
  // run reported 2,437 of 2,437 listings as not selling. So an absent cell returns null ("unknown")
  // and only a real 0 returns 0; the frontend must never treat null as a fault.
  function numOrNull_(v) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    var f = parseFloat(v);
    return isNaN(f) ? null : f;
  }

  var out = rows.map(function (x) {
    var sku = String(pick_(x, ['seller-sku', 'sku', 'msku']) || '').trim();
    if (!sku) return null;
    // "status" is a free-text word (Active / Inactive / Incomplete). Kept verbatim so an unexpected
    // value is visible rather than silently bucketed.
    var status = String(pick_(x, ['status', 'listing-status', 'item-status']) || '').trim();
    return {
      sku: sku,
      asin: String(pick_(x, ['asin1', 'asin', 'product-id']) || '').trim(),
      parent: parents[sku] || '',
      title: String(pick_(x, ['item-name', 'product-name']) || '').slice(0, 200),
      price: numOrNull_(pick_(x, ['price', 'item-price'])),
      qty: numOrNull_(pick_(x, ['quantity', 'afn-fulfillable-quantity'])),
      status: status,
      channel: String(pick_(x, ['fulfillment-channel', 'fulfilment-channel']) || '').trim(),
      opened: String(pick_(x, ['open-date', 'open_date']) || '').slice(0, 10),
    };
  }).filter(Boolean);

  // A peek at the real column names + one real row. The first run showed that guessing at this
  // report's schema is exactly how the numbers went wrong, so the schema is now inspectable from the
  // UI instead of being argued about.
  var sample = {};
  var hdrs = Object.keys(rows[0]);
  hdrs.forEach(function (h) { sample[h] = String(rows[0][h] == null ? '' : rows[0][h]).slice(0, 60); });
  // How many rows actually carry a merchant price / quantity at all â€” the honest answer to
  // "is this column usable for this seller".
  var withPrice = 0, withQty = 0;
  out.forEach(function (r) { if (r.price != null) withPrice++; if (r.qty != null) withQty++; });

  return { ok: true, status: 'done', rows: out.slice(0, 3000), total: out.length,
    headers: hdrs, sample: sample, withPrice: withPrice, withQty: withQty };
}

/**
 * Content quality for a batch of ASINs â€” the "is this listing well built" half.
 *
 * Called in CHUNKS from the browser (asins= up to 20 per call, several calls per page of results)
 * because a catalog sweep over ~1,000 ASINs cannot finish inside one Apps Script request. The
 * frontend walks the list and merges each chunk in as it lands.
 *
 * Image count = distinct VARIANTS (MAIN, PT01â€¦, SWCH), not the raw images array â€” Amazon returns the
 * same photo at several resolutions, so counting the array would report ~5x the real number.
 */
/* pageSize=20 on every multi-ASIN catalog call (2026-10-03): Amazon's searchCatalogItems returns TEN items per page by
 * default, so of every 20 ASINs asked, ten came back as "missing" and kept whatever was stored before — which is how
 * Listing Health showed "no image" on listings that had images (RTME-S-001-1420). */
function lhContent_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no asins' };
  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20' +
      '&includedData=summaries,attributes,images', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }

  var out = {};
  (r.items || []).forEach(function (it) {
    var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
    var variants = {};
    ((it.images && it.images[0] && it.images[0].images) || []).forEach(function (im) {
      if (im && im.variant) variants[im.variant] = 1;
    });
    var bullets = Array.isArray(a.bullet_point) ? a.bullet_point.filter(function (b) {
      return b && String(b.value == null ? b : b.value).trim();
    }).length : 0;
    var desc = attrVal_(a, 'product_description');
    var title = s.itemName || attrVal_(a, 'item_name') || '';
    out[it.asin] = {
      title: String(title).slice(0, 200),
      titleLen: String(title).length,
      images: Object.keys(variants).length,
      bullets: bullets,
      descLen: String(desc || '').length,
      brand: s.brandName || attrVal_(a, 'brand') || '',
    };
  });
  // ASINs Amazon returned nothing for are reported as such rather than defaulted to zeros â€” a
  // catalog miss and a genuinely empty listing are different problems and must not look alike.
  var missing = asins.filter(function (x) { return !out[x]; });
  return { ok: true, content: out, missing: missing };
}

/**
 * Which ASINs have LIVE A+ content, walked one page of content documents at a time.
 *
 * Deliberately document-first, not ASIN-first: asking "does this ASIN have A+?" one ASIN at a time
 * would be ~3,000 calls, whereas listing the A+ documents and reading each one's ASINs is a handful
 * of calls per page. The browser pages through with the returned token and inverts the result â€” any
 * ASIN NOT in the set has no A+ content.
 *
 * Only APPROVED documents count. A draft or rejected A+ page is not live on the listing, and
 * counting it would tell the seller a listing is fine when the shopper sees nothing.
 *
 * Needs the A+ Content role on the SP-API app. If it is missing this returns ok:false with the real
 * error rather than an empty set, because an empty set would look exactly like "no listing has A+"
 * and send the seller off to fix 3,000 listings that are already fine.
 */
/**
 * Sales rank for a batch of ASINs (up to 20 per call), for the weekly BSR snapshot.
 *
 * BSR belongs to a CHILD ASIN â€” a variation parent is not buyable and carries no rank of its own â€”
 * so the caller rolls these up per parent. The rank's CATEGORY is returned alongside it because a
 * rank is meaningless without one: 5,000 in Home & Kitchen and 5,000 in Bedding are not comparable,
 * and a listing can be re-categorised between weeks.
 */
function lhBsr_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no asins' };
  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20' +
      '&includedData=salesRanks,summaries', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }

  // Amazon reports TWO different ranks and they must not be mixed:
  //   displayGroupRanks   â†’ the broad department, e.g. #13,206 in Home & Kitchen  (MAIN)
  //   classificationRanks â†’ the specific browse node, e.g. #109 in Throw Pillow Covers  (SUB)
  // An earlier cut took whichever number was SMALLEST, which is almost always the sub-category rank
  // â€” so it compared a sub-category number one week against a main-category number the next.
  var pick = function (list) {
    var best = 0, cat = '';
    (list || []).forEach(function (x) {
      var n = num_(x.rank);
      if (n > 0 && (best === 0 || n < best)) { best = n; cat = x.title || x.classificationId || ''; }
    });
    return { rank: best, cat: String(cat).slice(0, 60) };
  };
  var out = {};
  (r.items || []).forEach(function (it) {
    var block = (it.salesRanks && it.salesRanks[0]) || {};
    var main = pick(block.displayGroupRanks), sub = pick(block.classificationRanks);
    // rank 0 means "no rank returned", which is NOT rank zero â€” the caller must not store it as one.
    if (main.rank > 0 || sub.rank > 0) {
      out[it.asin] = { rank: main.rank || 0, cat: main.cat,
        sub: sub.rank || 0, subCat: sub.cat };
    }
  });
  return { ok: true, map: out };
}

/**
 * Does each of these ASINs have LIVE A+ content? One call per ASIN, up to 10 per request.
 *
 * This asks Amazon the exact question we need â€” `contentPublishRecords` returns the A+ documents
 * actually PUBLISHED against an ASIN, so a non-empty list means the shopper sees A+ on that page.
 *
 * It replaces an earlier document-first approach (list A+ documents, read their ASINs, invert the
 * set) which was chosen because it needed far fewer calls â€” and which reported A+ as missing on all
 * 3,225 listings. Publish records are the authoritative answer; ~2 minutes for the whole catalogue
 * at 10 per call and 3 calls in flight is a price worth paying for an answer that is correct.
 *
 * Returns { map: {asin: true|false} }. An ASIN whose lookup ERRORS is left OUT of the map entirely
 * rather than recorded as false â€” "we could not tell" must never harden into "it is missing".
 */
function lhAplusAsins_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
  if (!asins.length) return { ok: false, error: 'no asins' };
  var mkt = marketplaceId_(), map = {}, errs = [], roleMissing = false;
  asins.forEach(function (asin) {
    try {
      var r = spRetry_('/aplus/2020-11-01/contentPublishRecords?marketplaceId=' + mkt +
        '&asin=' + encodeURIComponent(asin), 'get');
      map[asin] = ((r.publishRecordList || []).length > 0);
    } catch (e) {
      var msg = String(e.message || e);
      if (/403|Access to requested resource is denied|Unauthorized/i.test(msg)) roleMissing = true;
      if (errs.length < 3) errs.push(asin + ': ' + msg.slice(0, 120));
    }
  });
  return { ok: true, map: map, errors: errs, roleMissing: roleMissing };
}

function lhAplus_(token) {
  var mkt = marketplaceId_();
  var r;
  try {
    r = spRetry_('/aplus/2020-11-01/contentDocuments?marketplaceId=' + mkt +
      (token ? '&pageToken=' + encodeURIComponent(token) : ''), 'get');
  } catch (e) {
    var msg = String(e.message || e);
    return { ok: false, error: msg.slice(0, 300),
      roleMissing: /403|Unauthorized|Access to requested resource is denied/i.test(msg) };
  }
  var recs = r.contentMetadataRecords || [];
  var asins = [], docs = 0, statuses = {}, errs = [];
  recs.forEach(function (rec) {
    var meta = rec.contentMetadata || {};
    var st = String(meta.status || 'UNKNOWN').toUpperCase();
    statuses[st] = (statuses[st] || 0) + 1;
    if (st !== 'APPROVED') return;                     // drafts / rejected are not live on the page
    docs++;
    try {
      var a = spRetry_('/aplus/2020-11-01/contentDocuments/' +
        encodeURIComponent(rec.contentReferenceKey) + '/asins?marketplaceId=' + mkt, 'get');
      (a.asinMetadataSet || []).forEach(function (m) { if (m && m.asin) asins.push(m.asin); });
    } catch (e) {
      // Record it. Silently dropping these is how "A+ missing on everything" could look like a fact.
      if (errs.length < 3) errs.push(String(e.message || e).slice(0, 120));
    }
  });
  return { ok: true, asins: asins, docs: docs, seen: recs.length, statuses: statuses,
    errors: errs, nextToken: r.nextPageToken || '' };
}

