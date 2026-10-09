/* Pricing-API / BrandAnalytics.gs — Brand Analytics reports.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Brand Analytics ===================== */

/**
 * Probe whether the SP-API app can use Brand Analytics: try to CREATE a Search Terms report for the
 * last complete week. Success (a reportId comes back) â‡’ access is there. A 403 / Unauthorized /
 * access-denied â‡’ the app is missing the Brand Analytics role (add it in Developer Central, then
 * re-authorize). An "InvalidInput" about dates still means ACCESS is fine â€” just the window.
 */
function baCheck_() {
  var now = new Date();
  var d = now.getUTCDay();                                   // 0 Sun â€¦ 6 Sat
  var lastSat = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((d + 1) % 7 || 7)));
  var start = new Date(lastSat.getTime() - 6 * 86400000);   // that week's Sunday
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT',
      marketplaceIds: [marketplaceId_()],
      reportOptions: { reportPeriod: 'WEEK' },
      dataStartTime: start.toISOString(), dataEndTime: lastSat.toISOString(),
    });
    return { ok: true, access: true, reportId: r.reportId,
      note: 'Brand Analytics access looks OK â€” the report was accepted (id ' + r.reportId + ').' };
  } catch (e) {
    var msg = String(e.message || e);
    var denied = /403|unauthorized|access|forbidden|not have|role/i.test(msg);
    return { ok: false, access: false, denied: denied, error: msg.slice(0, 400),
      note: denied
        ? 'The app is missing the Brand Analytics role. Add it in Seller Central â†’ Developer Central, then re-authorize + update SP_REFRESH_TOKEN.'
        : 'Access may be fine but the request was rejected (likely the date window) â€” share this error.' };
  }
}

/** Most recent COMPLETE reporting window for a Brand Analytics period. */
/* WHICH WINDOW A BRAND ANALYTICS REPORT COVERS — and why you cannot just pick two dates.
 *
 * Amazon builds these per PERIOD, not per date range: a whole Sunday-to-Saturday week, a whole
 * calendar month, a whole calendar quarter. Ask for 3 August to 19 August and it does not trim to
 * fit, it refuses. So the app offers real periods rather than a date picker that would silently
 * snap to something nobody chose.
 *
 * `back` counts completed periods backwards: 0 is the most recent COMPLETE one, 1 the one before.
 * Never the running period — a month in progress is not a month, and its figures set beside
 * finished ones read as a collapse. PPC & Organic learned that one the hard way.
 */
function baPeriodWindow_(period, back) {
  var n = Math.max(0, Number(back) || 0);
  var now = new Date();
  var p = String(period || 'WEEK').toUpperCase();

  if (p === 'MONTH') {
    var s0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n - 1, 1));
    var e0 = new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 0));
    return { start: s0, end: e0, label: Utilities.formatDate(s0, 'UTC', 'MMMM yyyy') };
  }

  if (p === 'QUARTER') {
    var q = Math.floor(now.getUTCMonth() / 3) - n - 1;
    var y = now.getUTCFullYear();
    while (q < 0) { q += 4; y -= 1; }
    return { start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 0)),
      label: 'Q' + (q + 1) + ' ' + y };
  }

  var d = now.getUTCDay();
  var lastSat = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - ((d + 1) % 7 || 7) - n * 7));
  var ws = new Date(lastSat.getTime() - 6 * 86400000);
  return { start: ws, end: lastSat,
    label: Utilities.formatDate(ws, 'UTC', 'd MMM') + ' to ' + Utilities.formatDate(lastSat, 'UTC', 'd MMM yyyy') };
}

/* The periods that can actually be asked for, with their real dates.
 *
 * Built by the SAME function that builds the request, so a dropdown label and the window Amazon is
 * actually asked for cannot drift apart. This app has been bitten by exactly that: two copies of the
 * same date arithmetic, one in the browser and one in the backend, disagreeing by a day and putting
 * a seventh of every week in the wrong bucket.
 */
function baPeriods_(period, howMany) {
  var p = String(period || 'MONTH').toUpperCase();
  var n = Math.min(Math.max(Number(howMany) || 12, 1), 24);
  var out = [];
  for (var i = 0; i < n; i++) {
    var w = baPeriodWindow_(p, i);
    out.push({ back: i, label: w.label,
      from: Utilities.formatDate(w.start, 'UTC', 'yyyy-MM-dd'),
      to: Utilities.formatDate(w.end, 'UTC', 'yyyy-MM-dd') });
  }
  return { ok: true, period: p, periods: out };
}

/** Create a Brand Analytics report. type='terms' â†’ Search Terms (whole marketplace, top-3 ASINs per
 *  term); otherwise Search Query Performance (own products, optionally one ASIN). Returns a reportId. */
function baCreate_(type, period, asin, back) {
  period = (period || 'WEEK').toUpperCase();
  var w = baPeriodWindow_(period, back);
  var isTerms = (type === 'terms');
  var options = { reportPeriod: period };
  if (!isTerms && asin) options.asin = String(asin).trim().toUpperCase();
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: isTerms ? 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT'
                          : 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT',
      marketplaceIds: [marketplaceId_()], reportOptions: options,
      dataStartTime: w.start.toISOString(), dataEndTime: w.end.toISOString(),
    });
    return { ok: true, reportId: r.reportId, period: period, label: w.label,
      window: w.start.toISOString().slice(0, 10) + ' â†’ ' + w.end.toISOString().slice(0, 10) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/** Poll a report; when DONE, download + parse + shape the rows. Also returns one raw sample row so
 *  the exact field names can be confirmed against the shaped output. */
function baPoll_(id) {
  if (!id) return { ok: false, error: 'no report id' };
  var r;
  try { r = sp_('/reports/2021-06-30/reports/' + id, 'get'); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var st = r.processingStatus;
  if (st === 'FATAL' || st === 'CANCELLED') {
    /* A FAILED REPORT COMES WITH ITS OWN REASON, and it was being thrown away.
     *
     * Amazon attaches a document to a failed report saying WHY — a date range it will not accept, an
     * option this report type does not take, an entitlement that is missing. Returning only "ended as
     * FATAL" turns a one-line answer into guesswork, and the guessing is done against an API that
     * rate-limits report creation. */
    var why = '';
    try {
      if (r.reportDocumentId) {
        var ed = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get');
        var eb = UrlFetchApp.fetch(ed.url, { muteHttpExceptions: true }).getBlob();
        if (ed.compressionAlgorithm === 'GZIP') {
          try { eb = Utilities.ungzip(eb.setContentType('application/x-gzip')); } catch (e2) {}
        }
        why = String(eb.getDataAsString('UTF-8') || '').slice(0, 700);
      } else {
        why = '(Amazon attached no document to the failure, which usually means the report type '
          + 'accepted the request but had NO DATA for that window.)';
      }
    } catch (e) { why = '(could not read the failure document: ' + (e.message || e) + ')'; }
    return { ok: false, status: st, reason: why, error: 'Report ended as ' + st + (why ? ' — ' + why : '') };
  }
  if (st !== 'DONE') return { ok: true, status: 'processing', raw: st };
  var doc;
  try { doc = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get'); }
  catch (e) { return { ok: false, error: 'document: ' + String(e.message || e).slice(0, 200) }; }
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') {
    // UrlFetchApp sometimes auto-decompresses a gzip response (Content-Encoding), so a second ungzip
    // throws "Could not decompress gzip". Try to ungzip; if it fails, the bytes are already plain.
    try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) {}
  }
  var text = blob.getDataAsString('UTF-8');
  var j; try { j = JSON.parse(text); } catch (e) { return { ok: false, error: 'could not parse report: ' + String(text).slice(0, 150) }; }
  var arr = j.dataByAsin || j.dataByDepartmentAndSearchTerm || [];
  return { ok: true, status: 'done', kind: j.dataByAsin ? 'sqp' : 'terms',
    // The shaped rows are what the Analytics tab has always read. The RAW array rides alongside for
    // callers that need fields the generic shaper flattens away — SQP's asin* figures, which are the
    // listing's own, as opposed to the total* figures, which are the whole market's.
    rows: baShape_(j), raw: arr, sample: arr[0] || null, total: arr.length };
}

/** First value in `o` whose KEY matches `re` (case-insensitive). Optionally require a string value. */
function baGet_(o, re, wantStr) {
  if (!o || typeof o !== 'object') return null;
  for (var k in o) { if (re.test(k)) { var v = o[k]; if (!wantStr || typeof v === 'string') return v; } }
  return null;
}
/** First sub-object in `o` whose key matches `re` (e.g. impressionData / clickData / purchaseData). */
function baObj_(o, re) { var v = baGet_(o, re); return (v && typeof v === 'object') ? v : {}; }

/**
 * Report JSON â†’ flat rows for the UI. Field names differ across report variants, so match keys by
 * PATTERN rather than exact spelling (the nested impression/click/purchase objects map fine; only the
 * top-level query/volume + the share fields needed loosening).
 */
function baShape_(j) {
  function n(v) { return num_(v); }
  if (j.dataByAsin) {
    return j.dataByAsin.map(function (x) {
      var imp = baObj_(x, /impression/i), clk = baObj_(x, /click/i), pur = baObj_(x, /purchase/i);
      return {
        // KEPT. This report can be asked for ONE ASIN or for the whole brand, and the shape is the
        // same either way — so dropping the ASIN was harmless while the app only ever asked about one
        // product, and makes the brand-wide report useless the moment it is asked for. It is the one
        // field that says which listing a query belongs to.
        asin: baGet_(x, /^asin$|asin/i, true) || '',
        query: baGet_(x, /search.?query$|^keyword|search.?term|^query$/i, true) ||
               baGet_(x, /query|keyword|term/i, true) || '',
        volume: n(baGet_(x, /volume/i)),
        impressions: n(baGet_(imp, /total.*impression|impression.*count|total.?count/i)),
        impShare: n(baGet_(imp, /share/i)),
        clicks: n(baGet_(clk, /total.*click|click.*count|total.?count/i)),
        purchases: n(baGet_(pur, /total.*purchase|purchase.*count|total.?count/i)),
        purShare: n(baGet_(pur, /share/i)),
      };
    }).sort(function (a, b) { return (b.volume || 0) - (a.volume || 0); });
  }
  var rows = (j.dataByDepartmentAndSearchTerm || []).map(function (x) {
    return { searchTerm: baGet_(x, /search.?term|^query$/i, true) || '', freqRank: n(baGet_(x, /frequency.?rank|freq/i)),
      asin: baGet_(x, /clicked.*asin|^asin/i, true) || '', title: baGet_(x, /clicked.*name|product.?name|title/i, true) || '',
      clickRank: n(baGet_(x, /click.?share.?rank|click.?rank/i)), clickShare: n(baGet_(x, /click.?share/i)),
      convShare: n(baGet_(x, /conversion.?share|conv.?share/i)) };
  }).sort(function (a, b) { return (a.freqRank || 1e9) - (b.freqRank || 1e9); });
  return rows.slice(0, 1000);                                             // cap the marketplace-wide list
}

