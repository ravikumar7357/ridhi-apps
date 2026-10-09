/* Pricing-API / InventoryAge.gs — FBA inventory age.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== FBA inventory age ===================== */

/** Kick off the FBA Inventory Planning report (a snapshot â€” no date range). */
function ageCreate_() {
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_FBA_INVENTORY_PLANNING_DATA',
      marketplaceIds: [marketplaceId_()],
    });
    return { ok: true, reportId: r.reportId, brand: ACTIVE_PREFIX };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/**
 * Poll the ageing report; when DONE, parse the TSV and attach Parent ASIN per SKU from the brand's
 * Catalog tab. The age-bucket COLUMN NAMES are read from the report itself â€” Amazon has changed the
 * bucket boundaries over the years, so nothing is hard-coded.
 */
function agePoll_(id) {
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
    try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) {}   // may already be plain
  }
  var rows = parseTsv_(blob.getDataAsString('UTF-8'));
  if (!rows.length) return { ok: true, status: 'done', rows: [], ageCols: [], total: 0 };

  var headers = Object.keys(rows[0]);
  var ageCols = headers.filter(function (h) { return /inv[-_ ]?age|inventory[-_ ]?age/i.test(h); });
  // Estimated storage cost â€” the money side of ageing, so it belongs next to the buckets.
  var storageCol = headers.filter(function (h) {
    return /storage/i.test(h) && /cost|fee|charge/i.test(h) && !/long.?term/i.test(h);
  })[0] || headers.filter(function (h) { return /storage/i.test(h); })[0] || '';
  var parents = catalogParents_();

  /* WHICH COLUMN IS "AVAILABLE" — and it is not the one called `available`.
   *
   * MCF can only ship what Amazon can pick TODAY. Seller Central calls that Available, and the
   * column that means exactly that is `afn-fulfillable-quantity`: "units in Amazon fulfilment
   * centres that can be picked, packed and shipped". This report ALSO carries a column literally
   * named `available` which counts more than that — RQL147-K read 13 there while Seller Central
   * showed Available 7, with 0 inbound and 1 reserved (Ravi, 2026-09-01). Reading the friendlier
   * name first meant MCF offered stock Amazon would refuse to ship.
   *
   * So the fulfillable column is preferred EXPLICITLY, `available` is only a fallback for an account
   * whose report does not carry it, and the name that was used rides back in the response so the
   * screen can say which number it is looking at rather than leaving it to be guessed again. */
  var AVAIL_PREF = ['afn-fulfillable-quantity', 'sellable-quantity', 'available'];
  var availCol = '';
  for (var ai = 0; ai < AVAIL_PREF.length && !availCol; ai++) {
    for (var hi = 0; hi < headers.length; hi++) {
      if (String(headers[hi]).trim().toLowerCase() === AVAIL_PREF[ai]) { availCol = headers[hi]; break; }
    }
  }

  var out = rows.map(function (x) {
    var sku = String(pick_(x, ['sku', 'msku', 'seller-sku']) || '').trim();
    if (!sku) return null;
    /* FNSKU  the code on the label stuck to the piece. The scanner in the Replenishment app reads it,
     * and it is in THIS report and nowhere else the app already asks for. */
    var o = { sku: sku, asin: pick_(x, ['asin']) || '', parent: parents[sku] || '', fnsku: String(pick_(x, ['fnsku', 'fn-sku']) || '').trim(),
      product: String(pick_(x, ['product-name', 'item-name']) || '').slice(0, 90),
      available: availCol ? num_(x[availCol]) : num_(pick_(x, AVAIL_PREF)),
      storage: storageCol ? num_(x[storageCol]) : 0,
      age: {}, total: 0 };
    ageCols.forEach(function (h) { var v = num_(x[h]); o.age[h] = v; o.total += v; });
    return o;
  }).filter(Boolean).sort(function (a, b) { return b.total - a.total; });   // worst ageing first

  return { ok: true, status: 'done', rows: out.slice(0, 3000), ageCols: ageCols,
    storageCol: storageCol, availCol: availCol, headers: headers, total: out.length };
}

/** SKU â†’ Parent ASIN from the brand's Catalog tab on its main workbook (col A = SKU, col D = Parent). */
function catalogParents_() {
  var out = {};
  try {
    var id = (ACTIVE_PREFIX === 'CPC') ? CPC_SHEET_ID : RIDHI_SHEET_ID;
    var tab = (ACTIVE_PREFIX === 'CPC') ? 'CPC Catalog' : 'Catalog';
    var sh = SpreadsheetApp.openById(id).getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (row) {
      var sku = String(row[0] || '').trim();
      if (sku) out[sku] = row[3] || '';
    });
  } catch (e) { Logger.log('catalogParents_: ' + e); }   // no Sheets access â†’ parents just stay blank
  return out;
}

/** TSV text â†’ array of objects keyed by lowercased header. */
function parseTsv_(text) {
  var lines = String(text || '').split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = lines[0].split('\t').map(function (h) { return h.trim().toLowerCase(); });
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var c = lines[i].split('\t'), o = {};
    for (var j = 0; j < headers.length; j++) o[headers[j]] = c[j];
    out.push(o);
  }
  return out;
}

/** First non-empty value among candidate keys of an object. */
function pick_(o, names) {
  for (var i = 0; i < names.length; i++) if (o[names[i]] !== undefined && o[names[i]] !== '') return o[names[i]];
  return '';
}

