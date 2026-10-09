/* Pricing-API / Research.gs — DataDive proxy, catalogue pictures and parent ASINs (?imgs=, ?parents=), Variation explorer, Product research.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== DataDive proxy ===================== */

/**
 * Forward a GET DataDive path (must start with /v1/) using the server-held DD_API_KEY. Read-only,
 * GET-only, /v1/-only â€” so the browser can drive any DataDive read without ever seeing the key.
 * Returns { ok, data } (raw DataDive JSON) or { ok:false, error }.
 */
function ddProxy_(path) {
  path = String(path || '');
  if (path.indexOf('/v1/') !== 0) return { ok: false, error: 'Only /v1/ paths are allowed (got "' + path.slice(0, 40) + '").' };
  var key = prop_('DD_API_KEY');
  if (!key) return { ok: false, error: 'DD_API_KEY is not set on the backend (Script Properties).' };
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://api.datadive.tools' + path, {
      method: 'get', muteHttpExceptions: true,
      headers: { accept: 'application/json', 'x-api-key': key },
    });
  } catch (e) { return { ok: false, error: 'DataDive fetch failed: ' + (e.message || e) }; }
  var code = resp.getResponseCode(), text = resp.getContentText();
  if (code >= 300) return { ok: false, error: 'DataDive ' + code + ': ' + String(text).slice(0, 300) };
  var body; try { body = JSON.parse(text); } catch (e) { return { ok: false, error: 'DataDive returned non-JSON.' }; }
  return { ok: true, data: body };
}

/* ===================== Variation explorer ===================== */

/**
 * MAIN photo per ASIN, up to 20 at a time.
 *
 * Amazon returns the same photo at a dozen resolutions. The SMALLEST one at least 150px wide is
 * picked: a planner grid draws these at thumbnail size, and pulling a 1,600px original for each row
 * would cost more to download than the whole page.
 */
function lhImages_(asinsCsv) {
  // Malformed identifiers are dropped rather than passed on. Amazon rejects the WHOLE batch of 20
  // with a 400 if one of them is not an ASIN, so a single stray value (the health snapshot carries
  // literal "N/A" for listings with no parent) would cost every photo in the chunk.
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9]{10}$/.test(s); }).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no valid ASINs in the request' };
  var r;
  try {
    // `relationships` costs nothing extra on this call and answers the question that comes next: a
    // VARIATION parent is usually not buyable and carries no photo of its own, so when it comes back
    // empty the caller needs its children â€” and the seller's own catalogue is the only reliable
    // place to get them. Guessing from a stale snapshot is how 65 parents ended up with no picture
    // and nothing to fall back to.
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20' +
      '&includedData=images,relationships', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }

  var out = {}, kids = {};
  (r.items || []).forEach(function (it) {
    ((it.relationships && it.relationships[0] && it.relationships[0].relationships) || []).forEach(function (rel) {
      if (rel && rel.childAsins && rel.childAsins.length) {
        kids[it.asin] = (kids[it.asin] || []).concat(rel.childAsins.slice(0, 6));
      }
    });
  });
  (r.items || []).forEach(function (it) {
    var imgs = (it.images && it.images[0] && it.images[0].images) || [];
    var best = null;
    imgs.forEach(function (im) {
      if (!im || im.variant !== 'MAIN' || !im.link) return;
      var w = Number(im.width) || 0;
      if (w < 150) return;
      if (!best || w < best.w) best = { w: w, link: im.link };
    });
    // No MAIN at 150px+ â€” take the largest MAIN there is rather than showing nothing.
    if (!best) {
      imgs.forEach(function (im) {
        if (!im || im.variant !== 'MAIN' || !im.link) return;
        var w = Number(im.width) || 0;
        if (!best || w > best.w) best = { w: w, link: im.link };
      });
    }
    if (best) out[it.asin] = best.link;
  });
  // "No photo" and "Amazon has never heard of this ASIN under these credentials" are different
  // problems with different fixes, and reporting them as one number is why this kept looking like a
  // fallback that was not trying hard enough. Separated here so the caller can say which it is.
  var returned = {};
  (r.items || []).forEach(function (it) { returned[it.asin] = 1; });
  return {
    ok: true, images: out, kids: kids,
    noImage: asins.filter(function (x) { return returned[x] && !out[x]; }),
    notFound: asins.filter(function (x) { return !returned[x]; }),
    missing: asins.filter(function (x) { return !out[x]; }),
  };
}

/**
 * PARENT ASIN per ASIN, up to 20 at a time, straight from Amazon's catalogue (relationships only, so the answer is small).
 * Three answers kept apart, because they mean different things to whoever fills the master:
 *   parents[asin]  = the variation parent;
 *   single         = Amazon knows the ASIN and it has no parent (a stand-alone listing, or itself a parent);
 *   notFound       = Amazon returned nothing for it under these credentials.
 */
function catParents_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9]{10}$/.test(s); }).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no valid ASINs in the request' };
  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20&includedData=relationships', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var parents = {}, seen = {};
  (r.items || []).forEach(function (it) {
    seen[it.asin] = 1;
    (it.relationships || []).forEach(function (block) {
      (block.relationships || []).forEach(function (rel) {
        if (!parents[it.asin] && rel && rel.parentAsins && rel.parentAsins.length) parents[it.asin] = rel.parentAsins[0];
      });
    });
  });
  return {
    ok: true, parents: parents,
    single: asins.filter(function (x) { return seen[x] && !parents[x]; }),
    notFound: asins.filter(function (x) { return !seen[x]; }),
  };
}

/** Generic Catalog Items get for one ASIN with the given includedData. Returns {} on failure. */
function catGet_(asin, included) {
  try {
    return spRetry_('/catalog/2022-04-01/items/' + asin + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=' + included, 'get');
  } catch (e) { Logger.log('catGet ' + asin + ': ' + e); return {}; }
}

/** The variation relationship array for this marketplace, flattened. */
function relOf_(item) {
  var rels = (item.relationships || []).filter(function (r) { return true; });
  var out = [];
  rels.forEach(function (block) { (block.relationships || []).forEach(function (r) { out.push(r); }); });
  return out;
}

/**
 * From any ASIN in a variation family, resolve â†’ { parent, theme, children:[asin,â€¦] }.
 * The pasted link is usually a CHILD, so: read its relationships; if it lists children it IS the
 * parent; if it lists a parent, fetch that parent's children; if neither, it's a standalone listing.
 */
function resolveVariation_(asin) {
  var item = catGet_(asin, 'relationships,summaries');
  var rels = relOf_(item);
  var kids = [], parent = asin, theme = '';
  rels.forEach(function (r) {
    if (r.childAsins && r.childAsins.length) { kids = r.childAsins.slice(); if (r.variationTheme) theme = r.variationTheme.theme || ''; }
    if (r.parentAsins && r.parentAsins.length) parent = r.parentAsins[0];
  });
  if (!kids.length && parent !== asin) {
    var pit = catGet_(parent, 'relationships');
    relOf_(pit).forEach(function (r) {
      if (r.childAsins && r.childAsins.length) { kids = r.childAsins.slice(); if (r.variationTheme) theme = r.variationTheme.theme || ''; }
    });
  }
  if (!kids.length) kids = [asin];                        // standalone listing â†’ just itself
  var title = (item.summaries && item.summaries[0] && item.summaries[0].itemName) || '';
  return { parent: parent, theme: theme, children: kids, title: title };
}

/** Colour / size / BSR / title for a batch of child ASINs (up to 20 per Catalog call). */
function childAttrs_(asins) {
  var out = {};
  for (var i = 0; i < asins.length; i += 20) {
    var batch = asins.slice(i, i + 20);
    var r;
    try {
      r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
        '&identifiers=' + batch.join(',') + '&identifiersType=ASIN&pageSize=20' +
        '&includedData=summaries,attributes,salesRanks', 'get');
    } catch (e) { Logger.log('childAttrs: ' + e); r = {}; }
    (r.items || []).forEach(function (it) {
      var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
      out[it.asin] = {
        title: s.itemName || '',
        color: s.color || attrVal_(a, 'color') || '',
        size: s.size || attrVal_(a, 'size') || attrVal_(a, 'size_name') || '',
        bsr: bsrOf_(it),
      };
    });
    if (i + 20 < asins.length) Utilities.sleep(600);
  }
  return out;
}
function attrVal_(a, key) {
  var v = a[key];
  if (Array.isArray(v) && v.length) return v[0].value != null ? v[0].value : v[0];
  return '';
}
/** Best (lowest) sales rank across the item's display-group / classification ranks. 0 if none. */
function bsrOf_(it) {
  var best = 0;
  ((it.salesRanks && it.salesRanks[0]) ? (it.salesRanks[0].displayGroupRanks || []).concat(it.salesRanks[0].classificationRanks || []) : [])
    .forEach(function (r) { var n = num_(r.rank); if (n > 0 && (best === 0 || n < best)) best = n; });
  return best;
}

/** Any date cell/string â†’ epoch ms (date only, UTC midnight of the yyyy-MM-dd). 0 if unparseable. */
/*
 * âš ï¸ The Date column is a DATE-ONLY cell, and Apps Script hands it over as midnight in the SCRIPT's
 * timezone (Asia/Kolkata). Re-formatting that instant in ANY other zone moves the calendar date:
 * 2026-08-05 00:00 IST is 2026-08-04 11:30 PT, so reading it "in PT" silently reported every day's
 * sales against the day before. The figures looked plausible â€” just shifted â€” which is the worst
 * kind of wrong.
 *
 * The cell already holds the PT trading date (that is what the FBA-Sheet system writes into it), so
 * the job here is to READ BACK the date as written, not to convert it. That means formatting in the
 * script's own zone â€” the one the Date was built in.
 */
function toMs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
  }
  var m = String(v == null ? '' : v).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], (+m[2]) - 1, +m[3]) : 0;
}

/**
 * REAL last-30-day units + revenue per ASIN, summed from the seller's own Orders Data workbooks
 * (both brands). MCF + cancelled excluded, PT day boundaries â€” same rules the FBA reports use.
 * One pass per sheet, keyed by ASIN. Competitor ASINs simply won't be in the map.
 *
 * `wantSet` narrows it to one variation family (the explorer's case). Pass NOTHING and every ASIN
 * that sold is returned â€” that is what the listing-audit launch tracker needs, and it costs the same
 * single pass, so there is no reason to make the caller enumerate thousands of ASINs it already has.
 */
function sales30ByAsin_(wantSet) {
  var all = !wantSet;
  var map = {};
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - 30 * 86400000;
  ORDERS_DATA_IDS.forEach(function (id) {
    var ss; try { ss = SpreadsheetApp.openById(id); } catch (e) { Logger.log('openById ' + id + ': ' + e); return; }
    ['Orders', 'CPC Orders'].forEach(function (tab) {          // each workbook holds only its brand's tab
      var sh = ss.getSheetByName(tab); if (!sh || sh.getLastRow() < 2) return;
      var data = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        var asin = String(r[4] || '').trim().toUpperCase(); if (!asin || (!all && !wantSet[asin])) continue;
        if (String(r[9] || '').toUpperCase() === 'MCF') continue;
        if (!chanOk_(r[8])) continue;                // other marketplaces, other currencies
        if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
        var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
        var b = map[asin] || { qty: 0, amt: 0 };
        b.qty += Number(r[5]) || 0; b.amt += Number(r[6]) || 0;
        map[asin] = b;
      }
    });
  });
  return map;
}

/**
 * Every ASIN that sold in the last 30 days, for the listing-audit launch review ("a month after
 * launch, is it doing $6,000?"). Rolling a CHILD's sales up to its PARENT is left to the browser â€”
 * it already holds the parentâ†”child map from the listing-health snapshot, so sending that mapping
 * here would only be a second, staler copy of it.
 *
 * Pairs are [units, revenue] rather than {q,a}: same numbers, roughly half the JSON, and this
 * response carries a few thousand ASINs.
 */
function sales30All_() {
  var map = sales30ByAsin_(null);
  var out = {}, n = 0;
  Object.keys(map).forEach(function (a) {
    out[a] = [map[a].qty, Math.round(map[a].amt * 100) / 100];
    n++;
  });
  return { ok: true, days: 30, n: n,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out };
}

var SALES30_CHUNK = 20000;   // rows per request â€” big enough to finish quickly, small enough to return

/**
 * ONE bounded slice of the 30-day Orders scan: rows [start, start+n) of one workbook.
 *
 * The caller walks the workbook by following `next` until it comes back 0, adding up the ASIN
 * figures as it goes. Splitting it this way is what makes the scan survivable: the work per request
 * is capped by the caller, not by how many orders the business has ever taken, so the endpoint
 * cannot grow its way into a timeout the way the single-shot version did.
 *
 * Revenue is returned UNROUNDED â€” a slice is a partial sum, and rounding each one before they are
 * added together would drift by up to half a cent per slice.
 */
function sales30Chunk_(bookIx, startRow, nRows) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + ' (there are ' + ORDERS_DATA_IDS.length + ').' };

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  // Each workbook holds only its own brand's tab, so the first one that exists is the right one.
  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, asins: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) {
    return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, asins: {} };
  }
  var want = Number(nRows) || SALES30_CHUNK;
  var n = Math.min(Math.max(1, Math.min(want, SALES30_CHUNK)), lastRow - start + 1);

  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - 30 * 86400000;

  var out = {};
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    var b = out[asin] || (out[asin] = [0, 0]);
    b[0] += Number(r[5]) || 0;
    b[1] += Number(r[6]) || 0;
  }

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length, tab: sh.getName(),
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out,
  };
}

/** Orchestrate the explorer response for a reference link/ASIN. */
function exploreChildren_(input) {
  var asin = asinFromUrl_(input);
  if (!asin) return { ok: false, error: 'No ASIN found in "' + input + '".' };
  var v = resolveVariation_(asin);
  var kids = v.children.slice(0, 60);                        // safety cap
  var attrs = childAttrs_(kids);

  var wantSet = {}; kids.forEach(function (a) { wantSet[a] = 1; });
  var sales = sales30ByAsin_(wantSet);                       // one Orders scan for the whole family

  var rows = kids.map(function (a) {
    var at = attrs[a] || {}, s = sales[a] || null, price = 0;
    try { var off = fetchOffers_(a); price = off.buyBox || off.lowest; } catch (e) {}
    Utilities.sleep(700);                                    // Offers ~0.5-1 req/sec
    return {
      asin: a, title: at.title || '', color: at.color || '', size: at.size || '',
      price: price, bsr: at.bsr || 0,
      qty30: s ? s.qty : null, amt30: s ? s.amt : null,      // null = not in the seller's own sales
    };
  });

  return {
    ok: true, parent: v.parent, theme: v.theme, title: v.title,
    count: rows.length, truncated: v.children.length > kids.length, children: rows,
  };
}

/* ===================== Product research (keyword â†’ market) ===================== */

/**
 * Keyword-search Amazon's catalog and describe each hit for competitor research:
 * brand Â· size Â· outer material Â· inner material Â· weight Â· BSR Â· an ESTIMATED monthly sale qty
 * ASSUMED from the BSR (a rough heuristic â€” Amazon publishes no competitor sales). Materials come
 * from whatever attributes the listing actually carries, so they're often sparse (blank, not wrong).
 */
function researchProducts_(query, countRaw, foRaw, fiRaw) {
  var q = String(query || '').trim();
  if (!q) return { ok: false, error: 'Enter a product name / keywords to search.' };
  var want = Math.min(Math.max(parseInt(countRaw, 10) || 20, 1), 100);   // hard safety cap 100
  var fo = String(foRaw || '').trim(), fi = String(fiRaw || '').trim();   // outer / inner material filters
  var dbg = { want: want, pages: 0, scanned: 0, raw: 0, priced: 0, filtered: !!(fo || fi), pageErr: '', priceErr: '' };

  // A catalog page holds â‰¤20 hits; walk pages via nextToken until we have `want` MATCHING hits (or
  // Amazon runs out). When a material filter is set, only hits that actually match it are kept.
  var items = [], token = '';
  for (var page = 0; items.length < want && page < 6; page++) {
    var path = '/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&keywords=' + encodeURIComponent(q) + '&pageSize=20' +
      '&includedData=summaries,attributes,salesRanks,dimensions,relationships' +
      (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var r;
    try { r = spRetry_(path, 'get'); dbg.pages++; }
    catch (e) {
      dbg.pageErr = String(e.message || e).slice(0, 160);
      if (!items.length) return { ok: false, error: 'Amazon catalog search failed: ' + (e.message || e) };
      break;                                              // keep the pages we already got
    }
    (r.items || []).forEach(function (it) {
      dbg.scanned++;
      if (matchesMaterials_(it, fo, fi)) items.push(it);
    });
    token = (r.pagination && r.pagination.nextToken) || '';
    if (!token || items.length >= want) break;
    Utilities.sleep(600);
  }
  dbg.raw = items.length;
  items = items.slice(0, want);

  // "How many listings in that family" = variation child-count. Each hit's own relationships tell us
  // if it's a parent (has childAsins) or a child (has parentAsins); for children we batch-look-up the
  // parent's child-count once. varCountFor() then resolves each ASIN â†’ number of variations (â‰¥1).
  var selfKids = {}, parentOf = {};
  items.forEach(function (it) {
    var kids = 0, par = '';
    relOf_(it).forEach(function (r) {
      if (r.childAsins && r.childAsins.length) kids = r.childAsins.length;
      if (r.parentAsins && r.parentAsins.length) par = r.parentAsins[0];
    });
    if (kids) selfKids[it.asin] = kids;
    if (par) parentOf[it.asin] = par;
  });
  var needParents = {};
  Object.keys(parentOf).forEach(function (a) { var p = parentOf[a]; if (p && !selfKids[p]) needParents[p] = 1; });
  var parentKids = parentChildCounts_(Object.keys(needParents));
  function varCountFor(asin) {
    if (selfKids[asin]) return selfKids[asin];
    var p = parentOf[asin];
    if (p) { if (selfKids[p]) return selfKids[p]; if (parentKids[p] > 0) return parentKids[p]; }
    return 1;                                             // standalone listing = just itself
  }

  var rows = items.map(function (it) {
    var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
    var bsr = bsrOf_(it), mat = materialsOf_(a);
    return {
      asin: it.asin || '',
      title: s.itemName || '',
      brand: s.brandName || s.brand || attrFirst_(a, ['brand']) || '',
      size: s.size || attrFirst_(a, ['size', 'size_name']) || '',
      pack: packOf_(a, s.itemName),                       // units per pack (Set of N / Pack of N)
      outer: mat.outer,
      inner: mat.inner,
      weight: round2_(catWeight_(it)),
      price: 0,                                           // filled from batch pricing below
      bsr: bsr,
      variations: varCountFor(it.asin),                   // # of ASINs in that variation family
      saleQtyEst: bsr > 0 ? salesFromBsr_(bsr) : null,    // null = no rank â‡’ can't even guess
    };
  });

  // Selling price â€” the catalog search carries none, so batch the Pricing API (â‰¤20 ASINs/call).
  // Dedupe + validate first: a malformed or duplicate ASIN makes the whole pricing batch 400.
  var seen = {}, asins = [];
  rows.forEach(function (x) {
    var a = x.asin;
    if (a && /^[A-Z0-9]{10}$/.test(a) && !seen[a]) { seen[a] = 1; asins.push(a); }
  });
  var priceMap = pricesForAsins_(asins, dbg);
  rows.forEach(function (x) { x.price = round2_(priceMap[x.asin] || 0); });
  dbg.priced = rows.filter(function (x) { return x.price > 0; }).length;

  return { ok: true, query: q, count: rows.length, rows: rows, dbg: dbg };
}

function round2_(n) { return Math.round(num_(n) * 100) / 100; }

/**
 * Lowest current selling price for a batch of ASINs â†’ {asin: price}. 0 when no live offer.
 * Uses the batch Item-Offers endpoint (same buy-box data as fetchOffers_, â‰¤20 ASINs per POST). That
 * endpoint is HARSHLY rate-limited (~0.1 req/sec), so batches are paced ~2s apart and lean on
 * spRetry_'s 429 back-off; anything still unpriced falls back to the per-ASIN offers (a faster bucket).
 */
function pricesForAsins_(asins, dbg) {
  var out = {}, mp = marketplaceId_();
  for (var i = 0; i < asins.length; i += 20) {
    var batch = asins.slice(i, i + 20);
    var reqs = batch.map(function (a) {
      return { uri: '/products/pricing/v0/items/' + a + '/offers', method: 'GET',
               MarketplaceId: mp, ItemCondition: 'New' };
    });
    var r;
    try { r = spRetry_('/batches/products/pricing/v0/itemOffers', 'post', { requests: reqs }); }
    catch (e) { if (dbg && !dbg.priceErr) dbg.priceErr = priceErrMsg_(e); Logger.log('prices batch: ' + e); r = {}; }
    (r.responses || []).forEach(function (resp) {
      var pl = (resp.body && resp.body.payload) || {};
      var uri = (resp.request && resp.request.uri) || '';
      var m = uri.match(/items\/([A-Z0-9]{10})\//);
      var asin = pl.ASIN || (m ? m[1] : '');
      if (asin) out[asin] = priceFromSummary_(pl.Summary || {});
    });
    if (i + 20 < asins.length) Utilities.sleep(2000);
  }
  // Per-ASIN fallback for any that stayed unpriced â€” a separate (0.5/sec) bucket, so pace ~2s.
  var missing = asins.filter(function (a) { return !(out[a] > 0); });
  for (var j = 0; j < missing.length && j < 60; j++) {
    try {
      var o = spRetry_('/products/pricing/v0/items/' + missing[j] + '/offers?MarketplaceId=' + mp +
        '&ItemCondition=New', 'get');
      out[missing[j]] = priceFromSummary_((o.payload && o.payload.Summary) || {});
    } catch (e) { if (dbg && !dbg.priceErr) dbg.priceErr = priceErrMsg_(e); }
    Utilities.sleep(1800);
  }
  return out;
}

/** Short, human note for a pricing error â€” collapse Amazon's raw error dump to one clean line. */
function priceErrMsg_(e) {
  var m = String((e && e.message) || e || '');
  if (/429|quota/i.test(m)) return 'Amazon rate-limited the pricing calls â€” a few prices were skipped (try a smaller count for full pricing).';
  if (/\b400\b|invalidinput/i.test(m)) return 'Amazon rejected a pricing request for some items â€” those prices were skipped.';
  return 'Some prices could not be fetched â€” those rows show no price.';
}

/** Buy-box (else lowest) price out of a Pricing Summary block. 0 if none. */
function priceFromSummary_(sum) {
  var bb = (sum.BuyBoxPrices && sum.BuyBoxPrices[0]) || null;
  var price = bb ? num_((bb.LandedPrice && bb.LandedPrice.Amount) || (bb.ListingPrice && bb.ListingPrice.Amount)) : 0;
  if (!price) {
    var lp = (sum.LowestPrices && sum.LowestPrices[0]) || null;
    if (lp) price = num_((lp.LandedPrice && lp.LandedPrice.Amount) || (lp.ListingPrice && lp.ListingPrice.Amount));
  }
  return price;
}

/** First non-empty attribute value across candidate keys (attributes vary wildly by product type). */
function attrFirst_(a, keys) {
  for (var i = 0; i < keys.length; i++) { var v = attrVal_(a, keys[i]); if (v) return String(v); }
  return '';
}
// OUTER = the COVER/shell only. Deliberately NO generic `material`/`fabric_type` here â€” on an insert
// those usually describe the FILL, which was leaking into "Outer Material" (e.g. showing "50%
// Polyester, 50% Feathers" for a Cotton-cover pillow). Better blank than wrong.
var PR_OUTER_KEYS = ['outer_material', 'cover_material', 'outer_material_type', 'shell_material', 'outer_shell_material'];
var PR_INNER_KEYS = ['inner_material', 'fill_material', 'filling_material', 'fill_material_type', 'pillow_filling', 'stuffing'];

// Fill/stuffing words â€” a generic "material" string containing one of these describes the FILL, so it
// must never be shown as the cover/outer.
var PR_FILL_RE = /down|feather|fiber ?fill|fiberfill|polyester fiber|microfiber|hollow ?fiber|memory foam|\bfoam\b|alternative|stuffing/i;

/**
 * Resolve {outer, inner} for a listing. Cover-specific attrs first; then parse a combined `fabric_type`
 * ("Cover : 100% Cotton, Filling: â€¦"); then a GENERIC material as a last resort for the cover â€” but
 * only when it isn't just the fill repeated (the MIULEE leak) and doesn't itself read as a fill word.
 */
function materialsOf_(a) {
  var outer = attrFirst_(a, PR_OUTER_KEYS), inner = attrFirst_(a, PR_INNER_KEYS);
  var ft = attrFirst_(a, ['fabric_type', 'material_composition']);
  if (!outer) outer = fabricSeg_(ft, 'outer');
  if (!inner) inner = fabricSeg_(ft, 'inner');
  if (!outer) {
    var gen = attrFirst_(a, ['material', 'fabric_type', 'material_type', 'material_composition']);
    if (gen) {
      if (inner && sameMat_(gen, inner)) { /* the fill repeated â†’ not the cover, leave blank */ }
      else if (PR_FILL_RE.test(gen)) { if (!inner) inner = gen; }   // a fill word â†’ belongs to inner
      else outer = gen;                                             // a real cover/shell fabric
    }
  }
  return { outer: outer, inner: inner };
}
/** Two material strings equal ignoring case/punctuation/spacing. */
function sameMat_(x, y) {
  var n = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  return n(x) === n(y);
}

/** Pull the cover ("outer") or fill ("inner") half out of a "Cover: X, Filling: Y" fabric string. */
function fabricSeg_(s, which) {
  var t = String(s || ''); if (!t) return '';
  var m = t.match(/^([\s\S]*?)(?:filling|fill)\s*:?\s*([\s\S]*)$/i);
  if (!m) return '';                                     // no cover/fill split â†’ don't guess
  if (which === 'inner') return m[2].replace(/[,;|]\s*$/, '').trim();
  return m[1].replace(/cover\s*:?/i, '').replace(/[,;|]\s*$/, '').trim();  // outer = the part before "filling"
}

/**
 * Every word of `term` present in `haystack` â€” as an exact substring OR within a small edit distance
 * of some haystack word (so a typo like "polyster" still matches "polyester", since Amazon's keyword
 * search is fuzzy but our filter would otherwise be exact). Empty term â‡’ no constraint.
 */
function matchTerm_(term, haystack) {
  var t = String(term || '').toLowerCase().trim();
  if (!t) return true;
  var hs = String(haystack || '').toLowerCase();
  var words = hs.split(/[^a-z0-9]+/).filter(Boolean);
  return t.split(/\s+/).every(function (w) {
    if (!w) return true;
    if (hs.indexOf(w) >= 0) return true;                          // exact substring
    var tol = w.length >= 8 ? 2 : (w.length >= 5 ? 1 : 0);       // typo tolerance scales with length
    if (!tol) return false;
    return words.some(function (hw) { return editDist_(w, hw) <= tol; });
  });
}

/** Levenshtein edit distance (bounded use â€” short material words only). */
function editDist_(a, b) {
  var m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;                             // early out â€” can't be within tol
  var prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/**
 * Does a catalog hit match the outer/inner material filters? Materials are sparse, so each term is
 * matched against the COMBINED haystack (outer + inner + title) rather than field-by-field â€” the
 * user's "outer/inner" split doesn't always line up with where Amazon put the word. Both terms must
 * still appear (fuzzily), so an item unrelated to either material is dropped.
 */
function matchesMaterials_(it, fo, fi) {
  if (!fo && !fi) return true;
  var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
  var mat = materialsOf_(a);
  var hay = mat.outer + ' ' + mat.inner + ' ' + (s.itemName || '');
  return matchTerm_(fo, hay) && matchTerm_(fi, hay);
}

/** Units per pack: from pack attributes, else parsed from the title ("Set of 2", "Pack of 10"). 1 default. */
function packOf_(a, title) {
  var keys = ['number_of_items', 'item_package_quantity', 'unit_count'];
  for (var i = 0; i < keys.length; i++) { var n = parseInt(attrVal_(a, keys[i]), 10); if (n > 0) return n; }
  var t = String(title || '');
  var m = t.match(/set of (\d+)/i) || t.match(/pack of (\d+)/i) ||
          t.match(/(\d+)\s*[- ]?(?:count|pack|pcs|pieces|pc)\b/i);
  var k = m ? parseInt(m[1], 10) : 0;
  return k > 0 ? k : 1;
}

/** Batch-fetch relationships for parent ASINs â†’ {parentAsin: childCount}. */
function parentChildCounts_(asins) {
  var out = {};
  for (var i = 0; i < asins.length; i += 20) {
    var batch = asins.slice(i, i + 20), r;
    try {
      r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
        '&identifiers=' + batch.join(',') + '&identifiersType=ASIN&pageSize=20&includedData=relationships', 'get');
    } catch (e) { Logger.log('parentKids: ' + e); r = {}; }
    (r.items || []).forEach(function (it) {
      var kids = 0;
      relOf_(it).forEach(function (rr) { if (rr.childAsins && rr.childAsins.length) kids = rr.childAsins.length; });
      out[it.asin] = kids;
    });
    if (i + 20 < asins.length) Utilities.sleep(600);
  }
  return out;
}

/** Package weight (lb) preferred, else item weight, from a catalog item's dimensions block. 0 if none. */
function catWeight_(it) {
  var d = (it.dimensions && it.dimensions[0]) || {};
  var w = (d.package && d.package.weight) || (d.item && d.item.weight) || null;
  return w && w.value ? num_(w.value) : 0;
}

/**
 * ROUGH monthly sale-qty ASSUMED from a BSR (US Home-&-Kitchen-ish curve). Amazon publishes no
 * competitor sales, so this is a heuristic tier ladder, NOT a measurement â€” the UI labels it "est.".
 * One honest place to tune: adjust the [maxRank, unitsPerMonth] tiers if real experience disagrees.
 */
function salesFromBsr_(rank) {
  var tiers = [
    [50, 2000], [200, 1000], [500, 600], [1000, 350], [2000, 200], [5000, 100],
    [10000, 50], [20000, 25], [50000, 12], [100000, 5],
  ];
  for (var i = 0; i < tiers.length; i++) if (rank <= tiers[i][0]) return tiers[i][1];
  return 2;   // deep in the long tail
}

