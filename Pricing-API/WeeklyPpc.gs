/* Pricing-API / WeeklyPpc.gs — Weekly PPC & Organic dashboard.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Weekly PPC & Organic dashboard ===================== */
/*
 * Three sources, one grid. Per ASIN, per week:
 *   total sales + units   â† the seller's own Orders workbooks (full history)
 *   ad spend + ad sales   â† Ads API          (only ~95 days back â€” Amazon's retention, not a choice)
 *   sessions + page views â† SP-API Sales & Traffic report
 * Organic sales is then total âˆ’ ad sales, TACoS is spend Ã· total, CVR is units Ã· sessions.
 *
 * Weeks run SUNDAYâ†’SATURDAY, which is how Seller Central cuts its own weekly reports. Matching that
 * matters: a week boundary one day off makes every figure disagree with Amazon's own screens, and
 * the disagreement is small enough to be argued about rather than noticed.
 */
var WEEKLY_WEEKS = 26;

/** The Sunday (PT) that starts the week containing `ms`, as yyyy-MM-dd. */
/**
 * The Sunday starting the week that contains `ms`.
 *
 * `ms` ALREADY carries the trading date as UTC midnight — that is what toMs_ hands back, and what
 * the ad reports are normalised to before they get here. So the weekday is read in UTC and no
 * timezone conversion happens at all.
 *
 * This used to re-format that instant in PT to get the weekday, which is the same trap as reading
 * the Orders date cell in the wrong zone: UTC midnight is the previous evening in PT, so every date
 * came back a day early. On six days of seven the "days back" arithmetic quietly absorbed it and the
 * right Sunday still came out. On SUNDAY it did not — a Sunday looked like the Saturday before, went
 * back six days instead of none, and every Sunday's orders were filed under the PREVIOUS week.
 *
 * A week was therefore missing its own Sunday and carrying the next one, which is worth roughly a
 * seventh of the week. Found by Ravi checking Aug 2-8 against Seller Central: $119,735 here against
 * $143,718.88 there, and the gap was one Sunday.
 */
function weekKeyOf_(ms) {
  var back = new Date(ms).getUTCDay();                         // 0=Sun â€¦ 6=Sat
  return Utilities.formatDate(new Date(ms - back * 86400000), 'UTC', 'yyyy-MM-dd');
}

/** The week keys the dashboard covers, oldest first, ending with the week in progress. */
function weeklyKeys_(weeks) {
  var n = Math.min(Math.max(Number(weeks) || WEEKLY_WEEKS, 1), 104);
  // Which week we are in is a question about the MARKETPLACE's day, so "now" is turned into the PT
  // trading date first and then handed over the same way a stored date is. Passing the raw instant
  // would roll the window into the next week on Saturday evening PT, when UTC has already ticked.
  var todayPt = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var thisWeek = weekKeyOf_(Date.parse(todayPt + 'T00:00:00Z'));
  var base = new Date(thisWeek + 'T00:00:00Z').getTime();
  var out = [];
  for (var i = n - 1; i >= 0; i--) out.push(Utilities.formatDate(new Date(base - i * 7 * 86400000), 'UTC', 'yyyy-MM-dd'));
  return out;
}

/**
 * One bounded slice of the Orders scan, bucketed by week instead of a single 30-day total.
 * Same chunking contract as sales30Chunk_ â€” follow `next` until it is 0.
 * Shape: { ASIN: { '2026-05-10': [units, revenue], â€¦ } }
 *
 * Also buckets the SAME rows by day, for the recent window only, and returns them as `asinDays`.
 * A date range that is not a whole number of Sunâ†’Saturday weeks can only be answered from per-day
 * figures, and doing it here costs nothing: the rows have already been read and the day is one more
 * bucket off the timestamp that the week key is derived from anyway. Walking the workbooks a second
 * time for it would be the expensive way to get the same numbers.
 */
function weeklySalesChunk_(bookIx, startRow, nRows, weeks, withDays) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
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

  // The per-day breakdown is ONLY built when asked for, and only the nightly run asks. It is several
  // times the size of the weekly shape, and the browser's own refresh does not use it: adding it to
  // every response made the biggest workbook's slice large enough that the fetch died, which wiped
  // that brand's sales and left them wiped, because the caller clears before it scans.
  //
  // The window is short for the same reason. Per ASIN per day over six months is megabytes, and
  // nobody asks a question that old at day resolution â€” they ask it about the last few weeks.
  var wantDays = !!withDays && String(withDays) !== 'false' && String(withDays) !== '0';
  var dayFrom = wantDays ? Utilities.formatDate(new Date(Date.now() - ASIN_DAY_WINDOW * 86400000), ORDERS_PT, 'yyyy-MM-dd') : '';

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

    // toMs_ hands back UTC midnight of the calendar date the cell holds, so formatting it back in
    // UTC returns that same date. Reading it in any other zone moves it a day â€” the oldest bug in
    // this file, and the one that looks most plausible when it is wrong.
    if (wantDays) {
      var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
      if (day >= dayFrom) {
        var ad = outDays[asin] || (outDays[asin] = {});
        var bd = ad[day] || (ad[day] = [0, 0]);
        bd[0] += units; bd[1] += rev;
      }
    }

    var wk = weekKeyOf_(dMs);
    if (wk < first || !want[wk]) continue;          // outside the window
    var a = out[asin] || (out[asin] = {});
    var b = a[wk] || (a[wk] = [0, 0]);
    b[0] += units;
    b[1] += rev;
  }

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length, weeks: keys,
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out, asinDays: wantDays ? outDays : undefined, dayFrom: dayFrom,
  };
}

/* ---------- Account trends: one row per DAY, whole account ---------- */
/*
 * Deliberately NOT per ASIN. This answers "how is the account doing" â€” the shape a PPC dashboard
 * takes â€” and dropping the ASIN dimension makes it small enough to hold a year of days and roll up
 * into weeks, months or quarters in the browser without asking Amazon anything again.
 *
 * Orders are counted DISTINCT by Order ID, not as rows: a two-item order is one order, and treating
 * it as two would quietly inflate every conversion figure built on top of it.
 */
function dailySalesChunk_(bookIx, startRow, nRows, days) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, dates: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) {
    return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, dates: {} };
  }
  var n = Math.min(Math.max(1, Math.min(Number(nRows) || SALES30_CHUNK, SALES30_CHUNK)), lastRow - start + 1);

  var back = Math.min(Math.max(Number(days) || 400, 1), 800);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;

  var out = {};
  var firstOrder = '', lastOrder = '', prevOrder = '';
  // Day strings are derived from the ms value, and the same date repeats for thousands of rows in a
  // row â€” so the last one is remembered instead of re-formatting a Date per row. Utilities.formatDate
  // is the single most expensive thing in this loop; calling it 20,000 times is what made the whole
  // request outlive the browser's patience.
  var lastMs = -1, lastDay = '';
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    if (dMs !== lastMs) { lastMs = dMs; lastDay = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd'); }
    var b = out[lastDay] || (out[lastDay] = [0, 0, 0]);   // sales, units, orders
    b[0] += Number(r[6]) || 0;
    b[1] += Number(r[5]) || 0;
    // The lines of one order sit together, so a CHANGE of order id is a new order. That replaces a
    // per-row "have I seen this id" map â€” 20,000 string keys per chunk, for an answer a single
    // comparison already gives.
    var oid = r[0] ? String(r[0]) : '';
    if (oid) {
      if (!firstOrder) firstOrder = oid;
      if (oid !== prevOrder) { b[2] += 1; prevOrder = oid; }
      lastOrder = oid;
    }
  }
  Object.keys(out).forEach(function (d) { out[d][0] = Math.round(out[d][0] * 100) / 100; });

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length,
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    // The caller uses these to avoid counting one order twice when its lines straddle a chunk edge.
    // The lines of an order sit together in the sheet, so comparing the two ends is enough.
    firstOrder: firstOrder, lastOrder: lastOrder,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    dates: out,
  };
}

/**
 * Just the last few days, read from the TAIL of each Orders sheet.
 *
 * The nightly cache is right for history and wrong for today: sales keep arriving all day, and a
 * figure stamped 05:47 is not "today", it is breakfast. This exists to top up the recent end
 * without re-reading a quarter of a million rows — new orders are appended, so the answer is in the
 * last few thousand rows.
 *
 * If the tail turns out to hold nothing recent (a sheet ordered newest-first), it falls back to the
 * head rather than reporting an empty day, which would read as "no sales today".
 */
function dailyRecent_(days) {
  var back = Math.min(Math.max(Number(days) || 5, 1), 40);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;
  // SIZED BY THE WINDOW ASKED FOR, not fixed. 20,000 rows covered five days comfortably and a month
  // not at all â€” and a tail that stops short does not report an error, it reports a day with no
  // orders, which reads as a bad day rather than an unread one. 2,000 rows a day is well clear of
  // the busiest day either book has had, and the read is still bounded by the sheet's own length.
  var TAIL = Math.min(200000, Math.max(20000, back * 2000));
  var out = {};

  for (var ix = 0; ix < ORDERS_DATA_IDS.length; ix++) {
    var brand = ix === 0 ? 'SP' : 'CPC';
    var sh = null;
    try {
      var ss = SpreadsheetApp.openById(ORDERS_DATA_IDS[ix]);
      ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
    } catch (e) { continue; }
    if (!sh) continue;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;

    var scan = function (startRow, n) {
      var got = {};
      // NARROW ON THE DATE COLUMN FIRST, then read the full rows only for the band that is in range.
      //
      // The tail is sized at 2,000 rows a day, which is far more than either book actually writes —
      // deliberately, so a busy day can never run past it. The cost is that on an ordinary book the
      // tail reaches back months, and reading all ten columns of all of it was the bulk of the wait
      // on this call (the Sales Dashboard asks for the whole month on every open). One column is a
      // tenth of the cells to fetch.
      //
      // No assumption is made about the sheet's order: the band is simply the first to the last row
      // whose date falls in the window, and the loop below still filters every row it reads. Rows
      // outside the window never touched the running order id before either, so the order count is
      // unchanged.
      var dcol = sh.getRange(startRow, 3, n, 1).getValues();
      var lo = -1, hi = -1;
      for (var q = 0; q < n; q++) {
        var qMs = toMs_(dcol[q][0]);
        if (!qMs || qMs < cutoff) continue;
        if (lo < 0) lo = q;
        hi = q;
      }
      if (lo < 0) return got;                        // nothing in this stretch falls in the window
      var data = sh.getRange(startRow + lo, 1, hi - lo + 1, 10).getValues();
      var lastMs = -1, lastDay = '';
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (String(r[9] || '').toUpperCase() === 'MCF') continue;
        if (!chanOk_(r[8])) continue;                // other marketplaces, other currencies
        if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
        var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
        if (dMs !== lastMs) { lastMs = dMs; lastDay = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd'); }
        var b = got[lastDay] || (got[lastDay] = [0, 0, 0]);
        b[0] += Number(r[6]) || 0; b[1] += Number(r[5]) || 0;
        var oid = r[0] ? String(r[0]) : '';
        if (oid && oid !== got._last) { b[2] += 1; got._last = oid; }
      }
      delete got._last;
      return got;
    };

    var n = Math.min(TAIL, lastRow - 1);
    var res = scan(lastRow - n + 1, n);
    if (!Object.keys(res).length) res = scan(2, n);      // sheet is newest-first after all
    Object.keys(res).forEach(function (d) {
      var b = (out[brand] || (out[brand] = {}));
      b[d] = res[d];
    });
  }

  // Shopify for the same window — it is a channel like any other and must not lag behind.
  if (prop_('SHOPIFY_STORE') && prop_('SHOPIFY_TOKEN')) {
    try {
      var from = Utilities.formatDate(new Date(cutoff), 'UTC', 'yyyy-MM-dd');
      var s = shopifyDaily_(from, todayStr);
      out.SHOP = s.dates || {};
    } catch (e) { out.shopError = String(e.message || e).slice(0, 160); }
  }
  return { ok: true, days: back, at: nowStamp_(), d: out };
}

/* ---------- Sessions: SP-API Sales & Traffic, one report per week ---------- */
/*
 * ONE REPORT PER WEEK, deliberately. In this report `dateGranularity` only splits the by-DATE
 * section; the by-ASIN section is aggregated over whatever range you ask for, with no date on it.
 * So the only way to get sessions per ASIN per week is to ask for exactly one week at a time.
 * That makes the first backfill 26 requests per brand â€” slow, but it happens once, and after that
 * only the current week needs re-asking.
 */
function trafficCreate_(startDate, endDate) {
  var body = {
    reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
    marketplaceIds: [marketplaceId_()],
    dataStartTime: startDate + 'T00:00:00Z',
    dataEndTime: endDate + 'T23:59:59Z',
    reportOptions: { asinGranularity: 'CHILD', dateGranularity: 'DAY' },
  };
  var r = sp_('/reports/2021-06-30/reports', 'post', body);
  return { ok: true, brand: ACTIVE_PREFIX, reportId: r.reportId || '', start: startDate, end: endDate };
}

function trafficStatus_(id) {
  if (!id) return { ok: false, error: 'No reportId given.' };
  var r = sp_('/reports/2021-06-30/reports/' + encodeURIComponent(id));
  var s = r.processingStatus || '';
  return {
    ok: true, status: s, ready: s === 'DONE', doc: r.reportDocumentId || '',
    // FATAL usually means "no data for this range", which for a week before the listing existed is
    // the correct answer rather than a failure â€” the caller decides.
    dead: s === 'FATAL' || s === 'CANCELLED',
  };
}

/** Shape: { ASIN: [sessions, pageViews, unitsOrdered, orderedProductSales] } */
function trafficFetch_(docId) {
  if (!docId) return { ok: false, error: 'No document id given.' };
  var d = sp_('/reports/2021-06-30/documents/' + encodeURIComponent(docId));
  if (!d.url) return { ok: false, error: 'Report document carries no download url.' };
  var resp = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');
  var text;
  if (String(d.compressionAlgorithm || '').toUpperCase() === 'GZIP') {
    text = Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString();
  } else {
    text = resp.getContentText();
  }
  var j = JSON.parse(text || '{}');
  var rows = j.salesAndTrafficByAsin || [];
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var asin = String(x.childAsin || x.parentAsin || '').trim().toUpperCase(); if (!asin) continue;
    var t = x.trafficByAsin || {}, s = x.salesByAsin || {};
    var b = out[asin] || (out[asin] = [0, 0, 0, 0]);
    b[0] += Number(t.sessions) || 0;
    b[1] += Number(t.pageViews) || 0;
    b[2] += Number(s.unitsOrdered) || 0;
    b[3] += Number((s.orderedProductSales || {}).amount) || 0;
  }
  Object.keys(out).forEach(function (a) { out[a][3] = Math.round(out[a][3] * 100) / 100; });
  return { ok: true, n: Object.keys(out).length, asins: out };
}

