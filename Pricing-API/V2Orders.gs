/* Pricing-API / V2Orders.gs — ORDERS_V2 test stage (added 2026-10-30).
 * NEW names only, so nothing here replaces a live function: all .gs files share one scope, and a second
 * function with an existing name would silently take its place. The live nightly does not call anything
 * in this file until Nightly.gs is switched over (a separate, later step). Deleting this file undoes it.
 *
 * weeklySalesChunkV2_ = weeklySalesChunk_ (WeeklyPpc.gs) plus orders per ASIN at [2]:
 *   { ASIN: { week: [units, revenue, orders] } }, and the same per day in asinDays.
 * Positions 0–1 are computed by the same lines as the live function. */
function weeklySalesChunkV2_(bookIx, startRow, nRows, weeks, withDays) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };

  var ss;
  try { ss = bookOpen_(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, asins: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) {
    return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, asins: {} };
  }
  var n = Math.min(Math.max(1, Math.min(Number(nRows) || SALES30_CHUNK, SALES30_CHUNK)), lastRow - start + 1);

  var keys = weeklyKeys_(weeks), first = keys[0];
  var want = {};
  keys.forEach(function (k) { want[k] = 1; });

  var wantDays = !!withDays && String(withDays) !== 'false' && String(withDays) !== '0';
  var dayFrom = wantDays ? Utilities.formatDate(new Date(Date.now() - ASIN_DAY_WINDOW * 86400000), ORDERS_PT, 'yyyy-MM-dd') : '';

  // An order counts once for each ASIN it holds. Its lines sit together in the sheet, so a CHANGE of
  // order id for that ASIN is a new order — the same test dailySalesChunk_ uses, kept per ASIN.
  var lastOid = ordersSeedV2_(sh, start);

  var out = {}, outDays = {};
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs) continue;
    var units = Number(r[5]) || 0, rev = Number(r[6]) || 0;
    var oid = r[0] ? String(r[0]) : '';
    var newOrd = !!oid && lastOid[asin] !== oid;
    if (newOrd) lastOid[asin] = oid;

    if (wantDays) {
      var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
      if (day >= dayFrom) {
        var ad = outDays[asin] || (outDays[asin] = {});
        var bd = ad[day] || (ad[day] = [0, 0, 0]);
        bd[0] += units; bd[1] += rev;
        if (newOrd) bd[2] += 1;
      }
    }

    var wk = weekKeyOf_(dMs);
    if (wk < first || !want[wk]) continue;          // outside the window
    var a = out[asin] || (out[asin] = {});
    var b = a[wk] || (a[wk] = [0, 0, 0]);
    b[0] += units;
    b[1] += rev;
    if (newOrd) b[2] += 1;
  }

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length, weeks: keys,
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out, asinDays: wantDays ? outDays : undefined, dayFrom: dayFrom,
  };
}

/**
 * The order the slice before this one ended on, per ASIN, so an order whose lines straddle the
 * 12,000-row edge is not counted twice. Looks back at most 50 rows — no order has more lines — and
 * skips exactly the rows the scan itself skips, so a cancelled line never blocks a real one.
 */
function ordersSeedV2_(sh, start) {
  var seed = {};
  if (start <= 2) return seed;
  var from = Math.max(2, start - 50);
  var prev = sh.getRange(from, 1, start - from, 10).getValues();
  // A line with a blank order id neither starts nor ends an order in the scan, so it is stepped over
  // here too — otherwise a blank line sitting on the edge would hide the order it belongs to.
  var i = prev.length - 1;
  while (i >= 0 && !String(prev[i][0] || '')) i--;
  if (i < 0) return seed;
  var oid = String(prev[i][0]);
  for (; i >= 0; i--) {
    var id = String(prev[i][0] || '');
    if (id && id !== oid) break;
    if (!id) continue;
    var r = prev[i], asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF' || !chanOk_(r[8])) continue;
    if (String(r[7] || '').toLowerCase() === 'cancelled' || !toMs_(r[2])) continue;
    seed[asin] = oid;
  }
  return seed;
}
