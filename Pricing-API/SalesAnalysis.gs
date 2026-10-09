/* Pricing-API / SalesAnalysis.gs — Sales Analysis, read from the Orders workbooks in chunks.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== SALES ANALYSIS =====================
 *
 * Monthly units and revenue per SKU, straight off the brand's own Orders workbook, plus the Catalog
 * tab that says what colour and article a SKU is. Everything the report shows is built from these
 * two — nothing is read from any other project.
 *
 * READ IN CHUNKS, NOT IN ONE GO. These workbooks hold 174,000 and 193,000 rows. A single pass over
 * one of them has already been measured at 92 seconds and then started failing outright, which is
 * why the daily figures are chunked as well. The browser calls this repeatedly and adds the pieces
 * up; each call is small and finishes.
 *
 * The same three exclusions as every other sales figure in this backend, so the totals here can be
 * held against the Sales Dashboard without an argument: MCF orders are not sales (they are somebody
 * else's order being shipped), cancelled rows are not sales, and other marketplaces are priced in
 * their own currency — a single Amazon.com.mx line read as dollars once moved a day by 13%.
 *
 *   ?sales=cat&brand=SP                       → { map: { SKU: {color,size,subcat,asin} } }
 *   ?sales=chunk&book=0&start=2&rows=20000    → { d: { SKU: { 'YYYY-MM': [qty, amt] } }, next, done }
 */
function saCatalog_(brand) {
  var isCpc = String(brand || '').toUpperCase() === 'CPC';
  // The Catalog tab lives in the brand's MAIN workbook, not the Orders one — the same books and the
  // same tab names skuAsinMap_ already uses, so there is one idea of where the catalogue is.
  var bookId = isCpc ? CPC_SHEET_ID : RIDHI_SHEET_ID;
  var tab = isCpc ? 'CPC Catalog' : 'Catalog';
  var ss = null, sh = null;
  try { ss = SpreadsheetApp.openById(bookId); sh = ss.getSheetByName(tab); }
  catch (e) { return { ok: false, error: 'Could not open the ' + (isCpc ? 'CPC' : 'Ridhi') + ' workbook: ' + e }; }
  if (!sh) return { ok: false, error: 'No "' + tab + '" tab in the ' + (isCpc ? 'CPC' : 'Ridhi') + ' workbook.' };
  if (sh.getLastRow() < 2) return { ok: true, map: {}, n: 0, tab: sh.getName() };

  var nc = Math.min(13, sh.getLastColumn());
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, nc).getValues();
  var map = {}, n = 0;
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var sku = String(r[0] || '').trim();
    if (!sku) continue;
    map[sku] = {
      asin: String(r[1] || '').trim(),
      color: String(r[7] || '').trim(),
      size: String(r[8] || '').trim(),
      subcat: String(r[9] || '').trim(),
    };
    n++;
  }
  return { ok: true, map: map, n: n, tab: sh.getName(), book: ss.getName() };
}

function saChunk_(bookIx, startRow, nRows) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };
  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, d: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, d: {} };
  var n = Math.min(Math.max(1, Math.min(Number(nRows) || SALES30_CHUNK, SALES30_CHUNK)), lastRow - start + 1);

  var out = {};
  // The month string is derived from the date, and the same date repeats for thousands of rows —
  // so the last one is remembered rather than re-formatted per row. formatDate is by far the most
  // expensive call in this loop; that lesson was learned on the daily figures.
  var lastMs = -1, lastMk = '';
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var sku = String(r[3] || '').trim();
    if (!sku) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    if (!chanOk_(r[8])) continue;
    var dMs = toMs_(r[2]); if (!dMs) continue;
    if (dMs !== lastMs) { lastMs = dMs; lastMk = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM'); }
    var m = out[sku] || (out[sku] = {});
    var b = m[lastMk] || (m[lastMk] = [0, 0]);
    b[0] += Number(r[5]) || 0;      // units
    b[1] += Number(r[6]) || 0;      // revenue
  }
  var next = start + n;
  return { ok: true, book: ix, lastRow: lastRow, read: n, next: next > lastRow ? 0 : next,
    done: next > lastRow, d: out };
}

/** Editor check: does one chunk read, and what does it actually say? */
function saChunkTest() {
  for (var ix = 0; ix < ORDERS_DATA_IDS.length; ix++) {
    var t0 = new Date().getTime();
    var r = saChunk_(ix, 2, 20000);
    if (!r.ok) { Logger.log('book %s: %s', ix, r.error); continue; }
    var skus = Object.keys(r.d);
    Logger.log('book %s (%s rows total): 20,000 rows in %sms · %s SKU(s) touched · a full pass needs ~%s chunks',
      ix, r.lastRow, new Date().getTime() - t0, skus.length, Math.ceil(r.lastRow / 20000));
    if (skus.length) {
      var s = skus[0];
      Logger.log('   e.g. %s → %s', s, JSON.stringify(r.d[s]));
    }
  }
  var c = saCatalog_('SP');
  Logger.log('catalog: %s', c.ok ? c.n + ' SKU(s) from "' + c.tab + '" in "' + c.book + '"' : c.error);
  if (c.ok && c.n) {
    var k = Object.keys(c.map)[0];
    Logger.log('   e.g. %s → %s', k, JSON.stringify(c.map[k]));
  }
}

