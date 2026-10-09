/* Pricing-API / OrderAudits.gs — audits of the Orders workbooks (duplicates, daily / weekly, day split) and editor checks.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/**
 * Are there duplicate order rows in an Orders workbook?
 *
 * Every scan in this file trusts the workbook: it adds up the rows it finds. So if the same orders
 * were imported twice, every figure built on them is double and no amount of care on this side can
 * tell â€” the rows look exactly like real sales, because they ARE real sales, written down twice.
 *
 * This counts each (Order ID + ASIN + date) combination and reports the ones that appear more than
 * once, with the dates they fall on. A clean workbook reports nothing. Run it from the editor:
 *
 *   ordersDupCheck(0)   Ridhi        ordersDupCheck(1)   CPC
 */
function ordersDupCheck(bookIx, days) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }
  var back = Math.min(Math.max(Number(days) || 60, 1), 400);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  var lastRow = sh.getLastRow();
  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), 10).getValues();
  var seen = {}, perDay = {}, dupDay = {}, rows = 0, dupRows = 0;

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
    // Order id + ASIN + date: one line of one order on one day can only legitimately appear once.
    var key = String(r[0] || '') + '|' + String(r[4] || '') + '|' + day;
    rows++;
    perDay[day] = (perDay[day] || 0) + 1;
    if (seen[key]) { dupRows++; dupDay[day] = (dupDay[day] || 0) + 1; }
    seen[key] = (seen[key] || 0) + 1;
  }

  Logger.log('workbook  #' + ix + '  (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')');
  Logger.log('window    last ' + back + ' days, ' + rows + ' rows read');
  Logger.log('duplicates ' + dupRows + ' row(s) repeat an order line already seen');
  if (!dupRows) { Logger.log('âœ… Nothing repeated â€” the workbook is clean.'); return; }
  Logger.log('');
  Logger.log('date         rows   repeated');
  Object.keys(perDay).sort().forEach(function (d) {
    Logger.log('  ' + d + '  ' + String(perDay[d]).padStart(6) + '   ' + String(dupDay[d] || 0).padStart(6)
      + (dupDay[d] ? '   <-- ' + Math.round(dupDay[d] / perDay[d] * 100) + '% of this day is a repeat' : ''));
  });
}

/**
 * The workbook against the cache, day by day.
 *
 * Two numbers for the same day from the two ends of the pipeline: one counted here and now straight
 * off the sheet in a single pass, the other whatever the nightly run left in the `daily` cache. They
 * should be identical. Where they are not, the fault is between them â€” in the slicing, the
 * accumulator or the merge â€” and the ratio says how badly.
 *
 *   dailyAudit(0)   Ridhi        dailyAudit(1)   CPC
 */
function dailyAudit(bookIx, days) {
  var ix = Number(bookIx) || 0;
  var brand = ix === 0 ? 'SP' : 'CPC';
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }
  // Reaches as far back as the cache itself does. The old 120-day ceiling meant a YTD figure could
  // not be checked at all past April, and a year-to-date number nobody can audit is a number nobody
  // can trust. The sheet is read in one pass either way, so a longer window costs nothing extra.
  //   dailyAudit(0, 260)  the year so far      dailyAudit(0, 800)  everything the cache holds
  var back = Math.min(Math.max(Number(days) || 21, 1), NIGHTLY_DAILY_DAYS);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  // Counted exactly the way dailySalesChunk_ counts, but in ONE pass over the whole window, so no
  // slicing, no accumulator and no merge can come between the rows and the total.
  var lastRow = sh.getLastRow();
  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), 10).getValues();
  var sheet = {}, offChan = {}, offRows = 0;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
    // Off-marketplace rows are counted SEPARATELY rather than just skipped. A filter nobody can see
    // is how the last one hid: dropping thousands of dollars silently and dropping nothing look
    // identical from the outside.
    if (!chanOk_(r[8])) {
      offChan[String(r[8] || '(blank)')] = (offChan[String(r[8] || '(blank)')] || 0) + (Number(r[6]) || 0);
      offRows++;
      continue;
    }
    sheet[day] = (sheet[day] || 0) + (Number(r[6]) || 0);
  }

  var c = cacheRead_('daily');
  var cached = (c && c.d && c.d[brand]) || {};
  Logger.log('workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')  ·  cache written ' + ((c && c.at) || 'never'));
  Logger.log('');
  Logger.log('date            sheet        cache     ratio');
  var bad = 0, totS = 0, totK = 0;
  var days = Object.keys(sheet).sort();
  days.forEach(function (d) {
    var s = Math.round(sheet[d]);
    var k = Math.round((cached[d] && cached[d][0]) || 0);
    totS += s; totK += k;
    var ratio = s ? (k / s) : 0;
    if (s && Math.abs(ratio - 1) > 0.02) bad++;
    Logger.log('  ' + d + '  ' + String(s).padStart(10) + '   ' + String(k).padStart(10)
      + '   ' + ratio.toFixed(2) + (s && Math.abs(ratio - 1) > 0.02 ? '  <--' : ''));
  });
  Logger.log('');
  // The window's TOTAL, so a period figure can be checked against Seller Central in one line instead
  // of adding up a screen of days by hand. Day-by-day says where; this says how much.
  Logger.log('  TOTAL ' + (days.length ? days[0] + ' to ' + days[days.length - 1] : '(nothing)')
    + '   sheet ' + Math.round(totS).toLocaleString('en-US')
    + '   cache ' + Math.round(totK).toLocaleString('en-US')
    + '   ' + (totS ? (totK / totS).toFixed(3) : '-') + 'x'
    + (totS ? '   diff ' + Math.round(totK - totS).toLocaleString('en-US') : ''));
  if (offRows) {
    Logger.log('');
    Logger.log('  EXCLUDED, not on ' + ORDERS_CHANNELS.join('/') + ' -- ' + offRows
      + ' row(s), in their own marketplace currency, NOT dollars:');
    Object.keys(offChan).sort().forEach(function (k) {
      Logger.log('    ' + k + '   ' + offChan[k].toFixed(2));
    });
  }
  Logger.log('');
  Logger.log(bad ? bad + ' day(s) where the cache disagrees with the sheet.'
                 : 'OK - every day matches, the pipeline is faithful to the workbook.');
}

/**
 * The workbook against the PER-ASIN WEEKLY cache, week by week.
 *
 * dailyAudit checks the `daily` cache, which is what the Ad Console draws. Parent Listing Review and
 * PPC & Organic never touch that cache â€” they read `weekly`, a different shape built by a different
 * phase, and nothing checked it. That is how a six-week average sat 28% high while dailyAudit
 * reported every day at 1.00: both were true, about different caches.
 *
 * Same method as dailyAudit. One pass over the sheet, bucketed by the same week key the pipeline
 * uses, against whatever the nightly run published. Where a week disagrees the ASINs behind it are
 * named, because a doubled week is always a handful of ASINs and not the whole catalogue â€” and
 * knowing which ones turns a rebuild into a question you can answer.
 *
 *   weeklyAudit(0)   Ridhi        weeklyAudit(1)   CPC
 */
function weeklyAudit(bookIx, weeks) {
  var ix = Number(bookIx) || 0;
  var brand = ix === 0 ? 'SP' : 'CPC';
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  var keys = weeklyKeys_(Number(weeks) || 26), first = keys[0], want = {};
  keys.forEach(function (k) { want[k] = 1; });

  // Counted exactly the way weeklySalesChunk_ counts, but in ONE pass over the whole window, so no
  // slicing, no accumulator and no merge can come between the rows and the total.
  var lastRow = sh.getLastRow();
  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), 10).getValues();
  var sheetWk = {}, sheetAsin = {};
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs) continue;
    var wk = weekKeyOf_(dMs);
    if (wk < first || !want[wk]) continue;
    var rev = Number(r[6]) || 0;
    sheetWk[wk] = (sheetWk[wk] || 0) + rev;
    var sa = sheetAsin[wk] || (sheetAsin[wk] = {});
    sa[asin] = (sa[asin] || 0) + rev;
  }

  var c = cacheRead_('weekly');
  var byAsin = (c && c.rows && c.rows[brand]) || {};
  var cacheWk = {}, cacheAsin = {};
  Object.keys(byAsin).forEach(function (a) {
    var byWeek = byAsin[a] || {};
    Object.keys(byWeek).forEach(function (w) {
      var v = (byWeek[w] && byWeek[w][1]) || 0;
      cacheWk[w] = (cacheWk[w] || 0) + v;
      var ca = cacheAsin[w] || (cacheAsin[w] = {});
      ca[a] = (ca[a] || 0) + v;
    });
  });

  Logger.log('workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC')
    + ')  Â·  weekly cache written ' + ((c && c.at) || 'never'));
  Logger.log('');
  Logger.log('week            sheet        cache     ratio');
  var bad = [];
  keys.forEach(function (w) {
    var s = Math.round(sheetWk[w] || 0), k = Math.round(cacheWk[w] || 0);
    if (!s && !k) return;
    var ratio = s ? (k / s) : 0;
    var off = s && Math.abs(ratio - 1) > 0.02;
    if (off) bad.push(w);
    Logger.log('  ' + w + '  ' + String(s).padStart(10) + '   ' + String(k).padStart(10)
      + '   ' + ratio.toFixed(2) + (off ? '  <--' : ''));
  });
  Logger.log('');
  if (!bad.length) { Logger.log('OK - every week matches the workbook.'); return; }

  Logger.log(bad.length + ' week(s) disagree with the workbook. The ASINs behind them:');
  bad.forEach(function (w) {
    var s = sheetAsin[w] || {}, k = cacheAsin[w] || {}, names = {};
    Object.keys(s).forEach(function (a) { names[a] = 1; });
    Object.keys(k).forEach(function (a) { names[a] = 1; });
    // Sorted by how many dollars each ASIN is out by, not by ratio: an ASIN that is 3x on $40 is
    // noise, and one that is 1.4x on $30,000 is the whole problem.
    var list = Object.keys(names).map(function (a) {
      return { a: a, s: Math.round(s[a] || 0), k: Math.round(k[a] || 0) };
    }).filter(function (x) { return Math.abs(x.k - x.s) > 1; })
      .sort(function (p, q) { return Math.abs(q.k - q.s) - Math.abs(p.k - p.s); });
    Logger.log('  ' + w + '  ' + list.length + ' ASIN(s) differ, worst first:');
    list.slice(0, 8).forEach(function (x) {
      Logger.log('    ' + x.a + '  sheet ' + String(x.s).padStart(8) + '   cache ' + String(x.k).padStart(8)
        + '   ' + (x.s ? (x.k / x.s).toFixed(2) : '-'));
    });
  });
}

/**
 * One day of one Orders workbook, pulled apart every way that could explain a gap.
 *
 * dailyAudit and weeklyAudit both answer "is the pipeline faithful to the workbook". Neither can
 * answer "is the workbook the same thing Seller Central is showing", because that question is not
 * about the pipeline at all â€” it is about what the workbook's columns MEAN.
 *
 * So this prints the header row in full, then that one day broken down by every column that could
 * account for a difference: the totals the code uses, the totals it throws away, every numeric
 * column summed, and every short text column grouped. The code has only ever read columns A to J;
 * if tax, shipping or a marketplace sits past that, nothing has ever looked at it.
 *
 *   daySplit(1, '2026-08-09')     CPC, 9 Aug        daySplit(0, '2026-08-09')     Ridhi
 */
function daySplit(bookIx, day) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }
  var want = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) {
    Logger.log('Pass the day as yyyy-mm-dd, e.g.  daySplit(1, "2026-08-09")'); return;
  }

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  Logger.log('workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')   tab "' + sh.getName()
    + '"   ' + (lastRow - 1) + ' rows x ' + lastCol + ' columns');
  Logger.log('the code reads only:  [0] order  [2] date  [4] asin  [5] units  [6] sales  [7] status  [9] mcf');
  Logger.log('');
  Logger.log('COLUMNS');
  head.forEach(function (h, i) { Logger.log('  [' + i + '] ' + (String(h || '').trim() || '(blank)')); });

  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), lastCol).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var dMs = toMs_(data[i][2]);
    if (dMs && Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd') === want) rows.push(data[i]);
  }

  var isMcf = function (r) { return String(r[9] || '').toUpperCase() === 'MCF'; };
  var isCan = function (r) { return String(r[7] || '').toLowerCase() === 'cancelled'; };
  var sum = function (list, c) {
    return list.reduce(function (s, r) { return s + (Number(r[c]) || 0); }, 0);
  };
  var offChan = function (r) { return !chanOk_(r[8]); };
  var kept = rows.filter(function (r) { return !isMcf(r) && !isCan(r) && !offChan(r); });

  Logger.log('');
  Logger.log('DAY ' + want);
  Logger.log('  rows on this date          ' + rows.length);
  Logger.log('  units  [5]  all rows       ' + Math.round(sum(rows, 5)));
  Logger.log('  sales  [6]  all rows       ' + sum(rows, 6).toFixed(2));
  Logger.log('  sales  [6]  MCF rows       ' + sum(rows.filter(isMcf), 6).toFixed(2) + '   (dropped)');
  Logger.log('  sales  [6]  cancelled      ' + sum(rows.filter(isCan), 6).toFixed(2) + '   (dropped)');
  Logger.log('  sales  [6]  other channel  ' + sum(rows.filter(offChan), 6).toFixed(2)
    + '   (dropped - not ' + ORDERS_CHANNELS.join('/') + ', and in another currency)');
  Logger.log('  >> WHAT THE APP COUNTS     ' + sum(kept, 6).toFixed(2)
    + '   from ' + kept.length + ' rows, ' + Math.round(sum(kept, 5)) + ' units');

  Logger.log('');
  Logger.log('EVERY NUMERIC COLUMN, over the rows the app counts');
  Logger.log('  (a tax or shipping column here is the usual reason a workbook sits above Seller Central)');
  head.forEach(function (h, c) {
    var n = 0, tot = 0;
    kept.forEach(function (r) { if (r[c] !== '' && r[c] != null && !isNaN(Number(r[c]))) { n++; tot += Number(r[c]); } });
    if (n && Math.abs(tot) > 0.005) {
      Logger.log('  [' + c + '] ' + (String(h || '').trim() || '(blank)') + '  =  ' + tot.toFixed(2));
    }
  });

  Logger.log('');
  Logger.log('EVERY SHORT TEXT COLUMN, grouped (rows / sales)');
  head.forEach(function (c0, c) {
    var g = {}, keys = [];
    for (var j = 0; j < rows.length; j++) {
      var v = rows[j][c];
      if (v instanceof Date || (v !== '' && v != null && !isNaN(Number(v)))) return;   // not a label
      var k = String(v == null ? '' : v).trim() || '(blank)';
      if (k.length > 40) return;                       // free text, not a category
      if (!g[k]) { g[k] = [0, 0]; keys.push(k); if (keys.length > 12) return; }
      g[k][0]++; g[k][1] += Number(rows[j][6]) || 0;
    }
    if (!keys.length || keys.length > 12) return;
    Logger.log('  [' + c + '] ' + (String(c0 || '').trim() || '(blank)'));
    keys.sort().forEach(function (k) {
      Logger.log('        ' + k + '   ' + g[k][0] + ' rows   ' + g[k][1].toFixed(2));
    });
  });

  Logger.log('');
  Logger.log('FIRST 2 ROWS, every column, so the shape is not a guess');
  rows.slice(0, 2).forEach(function (r, n) {
    Logger.log('  row ' + (n + 1) + ':');
    r.forEach(function (v, c) {
      Logger.log('     [' + c + '] ' + (String(head[c] || '').trim() || '?') + ' = '
        + (v instanceof Date ? Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd HH:mm') + ' (Date)' : String(v)));
    });
  });
}
/**
 * Can this script place MCF orders at all?
 *
 * Creating a fulfilment order needs the "Amazon Fulfillment" role ("Ship to Amazon, and Amazon ships
 * directly to customer"). NOT "Shipping" / "Direct-to-Consumer Shipping" — those cover buying your
 * OWN labels through a different API.
 *
 * WARNING: a 403 here is NOT proof the role is missing. SP-API answers an unrecognised PATH with
 * "403 Unauthorized - Access to requested resource is denied", the very same words it uses for a real
 * permission refusal. These calls sat on `/fbaOutbound/2020-07-01/...` for a while, which is the
 * API's NAME and not its URL; the path is `/fba/outbound/2020-07-01/...`. The role was ticked and the
 * refresh token was current the whole time, and neither made any difference, because the request
 * never reached the API at all. Check the path before touching any credentials.
 *
 * The role is granted per app in Seller Central, NOT by the credentials already working here â€” catalogue,
 * pricing, reports and inventory all come from roles this app has, and none of them imply this one.
 * Without it every call returns 403 no matter how correct the payload is.
 *
 * So this asks the LIST endpoint, which is read-only and creates nothing. A 200 means the door is
 * open. Run it before anybody builds a button that spends money.
 */
function mcfCheck() {
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    var label = (b === 'SP' ? 'Ridhi' : 'CPC') + ' (' + b + ')';
    try {
      var from = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
      var r = sp_('/fba/outbound/2020-07-01/fulfillmentOrders?queryStartDate=' + encodeURIComponent(from), 'get');
      var list = (r.payload && r.payload.fulfillmentOrders) || [];
      Logger.log(label + '  OK - outbound fulfilment is authorised.  ' + list.length
        + ' MCF order(s) in the last 7 days.  marketplace ' + marketplaceId_());
    } catch (e) {
      var m = String(e.message || e);
      Logger.log(label + '  FAILED');
      Logger.log('   ' + m.slice(0, 300));
      if (m.indexOf('403') >= 0 || m.toLowerCase().indexOf('unauthorized') >= 0) {
        Logger.log('   -> 403. Check in THIS order:');
        Logger.log('      1. the PATH - SP-API says 403 for an unknown path too, in the same words.');
        Logger.log('         It must be /fba/outbound/2020-07-01/... ("fbaOutbound" is the API name).');
        Logger.log('      2. the role "Amazon Fulfillment" on the app in Develop Apps.');
        Logger.log('         NOT "Shipping" - that one is for buying your own labels.');
        Logger.log('      3. the token - one minted before the role does not carry it, so re-authorise');
        Logger.log('         and paste the NEW refresh token into ' + b + '_REFRESH_TOKEN.');
      }
    }
  });
  setBrand_('SP');
}

function daySplitRidhiYesterday() { daySplit(0, Utilities.formatDate(new Date(Date.now() - 86400000), ORDERS_PT, 'yyyy-MM-dd')); }
function daySplitCPCYesterday()   { daySplit(1, Utilities.formatDate(new Date(Date.now() - 86400000), ORDERS_PT, 'yyyy-MM-dd')); }

/* The editor's Run button takes no arguments, so the second brand needs its own name in the list. */
function dailyAuditRidhi() { dailyAudit(0); }
function dailyAuditCPC()   { dailyAudit(1); }
/* The whole year so far, for checking a YTD figure against Seller Central in one line. */
function dailyAuditYearRidhi() { dailyAudit(0, 400); }
function dailyAuditYearCPC()   { dailyAudit(1, 400); }
function weeklyAuditRidhi() { weeklyAudit(0); }
function weeklyAuditCPC()   { weeklyAudit(1); }
function ordersDupCheckRidhi() { ordersDupCheck(0); }
function ordersDupCheckCPC()   { ordersDupCheck(1); }

/**
 * What is sitting in each scratch accumulator right now.
 *
 * The merges add slices up, so a slice that is in there twice doubles whatever it covers. This lists
 * what a merge would actually see: how many slices, how many carry a key, and which keys repeat.
 * Run it DURING a pass to catch the state that produced a bad cache â€” a finished phase clears its
 * own accumulator, so afterwards there is nothing left to look at.
 */
function accCheck() {
  ['daily', 'weekly', 'dayAsin', 'ads', 'adsAsin', 'adsAsinDay',
   'srchTerm', 'targeting', 'adGroup', 'placement', 'shopSku', 'sessions'].forEach(function (name) {
    var raw = accReadRaw_(name);
    if (!raw.length) { Logger.log(name + ': empty'); return; }
    var keyed = 0, counts = {}, perBrand = {};
    raw.forEach(function (p) {
      if (!p) return;
      if (p.k) { keyed++; counts[p.k] = (counts[p.k] || 0) + 1; }
      perBrand[p.brand || '?'] = (perBrand[p.brand || '?'] || 0) + 1;
    });
    var repeats = Object.keys(counts).filter(function (k) { return counts[k] > 1; });
    Logger.log(name + ': ' + raw.length + ' slice(s), ' + keyed + ' keyed, '
      + (raw.length - keyed) + ' UNKEYED'
      + ' · by brand ' + JSON.stringify(perBrand)
      + (repeats.length ? ' · REPEATED KEYS: ' + repeats.slice(0, 6).join(', ') : ''));
  });
  var st = nState_();
  Logger.log('state: day ' + (st.day || '—') + ', phase ' + (st.phase || 'idle')
    + ', cursor book ' + st.book + ' row ' + st.row
    + ', accumulators started this pass ' + JSON.stringify(st.acc || {}));
}

/** Run from the editor to prove the credentials and see a few days of totals. */
function shopifyCheck() {
  try { Logger.log('store  ' + shopifyStore_()); }
  catch (e) { Logger.log('âŒ ' + e.message); return; }
  var end = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var start = Utilities.formatDate(new Date(Date.now() - 6 * 86400000), ORDERS_PT, 'yyyy-MM-dd');
  try {
    var r = shopifyDaily_(start, end);
    Logger.log('âœ… ' + r.orders + ' order(s) between ' + start + ' and ' + end);
    Object.keys(r.dates).sort().forEach(function (d) {
      var v = r.dates[d];
      Logger.log('   ' + d + '  $' + v[0].toLocaleString() + '  ' + v[1] + ' units  ' + v[2] + ' orders');
    });
    if (!r.orders) Logger.log('   (No orders in that window â€” not an error, just a quiet week.)');
  } catch (e) { Logger.log('âŒ ' + e.message); }
}

