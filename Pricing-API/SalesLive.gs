/* Pricing-API / SalesLive.gs — LIVE VS LAST YEAR (Ravi, 2026-11-19: the Prime Day tracker as a page in Sellora, for any day).
 * Amazon's Sales API (getOrderMetrics) answers per hour or per day for any window, per brand with its own credentials —
 * this year live, last year from history. Nothing is stored here; last year's figures (which never change) are kept in the
 * script cache for six hours so a refresh every few minutes only asks Amazon for today.
 *
 *   ?live=yoy&brand=SP|CPC&day=YYYY-MM-DD&ly=YYYY-MM-DD
 *     → { ok, brand, asOf, day, ly, lw,
 *         now:[hour rows of `day` so far], last:[hour rows of `ly`], lastWeek:[hour rows of day-7],
 *         week:[day rows, day-6 … day], ads:{ at, types, days:{date: {impressions, clicks, spend, orders, sales}}, err } }
 *   ?live=range — a run of days against last year's run, by day (liveRange_ below).
 *   A row is { t, orders, units, items, sales } — t is the start of the hour / day, Pacific.
 * Routed from Code.gs doGet. Every day boundary is Amazon.com's day: Pacific time. */

var LIVE_TZ = 'America/Los_Angeles';

/** "2026-11-19" at hh:00 Pacific, as an ISO string with that day's offset (so DST is right). */
function liveIso_(day, hh) {
  var off = Utilities.formatDate(new Date(day + 'T12:00:00Z'), LIVE_TZ, 'Z');
  return day + 'T' + (hh < 10 ? '0' : '') + hh + ':00:00' + off.slice(0, 3) + ':' + off.slice(3);
}
/** A YYYY-MM-DD moved by n days. */
function liveShift_(day, n) {
  return Utilities.formatDate(new Date(new Date(day + 'T12:00:00Z').getTime() + n * 864e5), 'UTC', 'yyyy-MM-dd');
}
/** One getOrderMetrics call for the brand set by setBrand_. */
function liveMetrics_(startIso, endIso, gran) {
  var path = '/sales/v1/orderMetrics?marketplaceIds=' + marketplaceId_()
    + '&interval=' + encodeURIComponent(startIso + '--' + endIso)
    + '&granularity=' + encodeURIComponent(gran || 'Hour')
    + '&granularityTimeZone=' + encodeURIComponent('US/Pacific');
  var res = spRetry_(path);
  return (res.payload || []).map(function (x) {
    return { t: String(x.interval || '').split('--')[0], orders: x.orderCount || 0, units: x.unitCount || 0,
      items: x.orderItemCount || 0, sales: x.totalSales ? Number(x.totalSales.amount) || 0 : 0 };
  });
}
/** A window that is wholly in the past never changes: read it once per six hours. */
function liveCached_(key, fn) {
  var cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* read again */ } }
  var v = fn();
  try { cache.put(key, JSON.stringify(v), 6 * 3600); } catch (e) { /* over 100 KB: just asked again next time */ }
  return v;
}

function liveYoy_(brand, day, ly) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(day || '')) || !re.test(String(ly || ''))) return { ok: false, error: 'day and ly must be YYYY-MM-DD.' };
  var b = setBrand_(brand), nowMs = Date.now();
  var start = new Date(liveIso_(day, 0)).getTime();
  if (start >= nowMs) return { ok: false, error: day + ' has not started yet in Pacific time.' };
  var dayEnd = Math.min(nowMs, new Date(liveIso_(liveShift_(day, 1), 0)).getTime());
  var endIso = new Date(dayEnd).toISOString();
  var past = dayEnd < nowMs;                         // a finished day: cache it too
  var lw = liveShift_(day, -7);
  var whole = function (d, gran, back) {             // a closed window: back days before d, through the end of d
    return liveCached_('live_v1_' + b + '_' + gran + '_' + d + '_' + back, function () {
      return liveMetrics_(liveIso_(liveShift_(d, -back), 0), liveIso_(liveShift_(d, 1), 0), gran);
    });
  };
  var out = { ok: true, brand: b, asOf: new Date(nowMs).toISOString(), day: day, ly: ly, lw: lw };
  out.now = past ? whole(day, 'Hour', 0) : liveMetrics_(liveIso_(day, 0), endIso, 'Hour');
  out.last = whole(ly, 'Hour', 0);
  out.lastWeek = whole(lw, 'Hour', 0);
  // The 7 days to `day` (today so far included), by day — for TACoS yesterday and over the week (Ravi, 2026-11-20).
  try { out.week = liveMetrics_(liveIso_(liveShift_(day, -6), 0), endIso, 'Day'); } catch (e) { out.week = []; }
  out.ads = liveAdsRead_(b);                         // what the 15-minute job last stored — no Amazon call here
  return out;
}

/* ---- AD SPEND ON THE LIVE PAGE (Ravi, 2026-11-20: "add TACoS and Ad Spend … the things Amazon gives us") ----
 * The Ads API has no live number: a report is asked for, Amazon builds it (minutes, sometimes an hour), and today's figures
 * in it run behind. So liveSnapshotJob asks, per brand, for three DAILY campaign reports from a week back through today —
 * Sponsored Products, Sponsored Brands, Sponsored Display — collects each when Amazon has finished it, then asks again.
 * The figures shown are the three added up, which is what the Ads console's all-campaigns view shows (Ravi checked Ridhi's
 * 19 Nov against it: Products alone was $650 of spend short). Attribution as the console shows it for a seller: Products
 * 7-day (purchases7d / sales7d), Brands and Display 14-day (their plain purchases / sales).
 * Stored per brand in a Script Property: { t: { sp|sb|sd: { days: {date: {impressions, clicks, spend, orders, sales}}, at,
 * pendingId, askedAt, askedMs, err } } }. A report name carries the time so Amazon never hands back an older identical
 * report as a "duplicate". A type whose report never arrives is simply left out; the page says which types are in. */
var LIVE_ADS_TYPES = {
  sp: { name: 'Products', adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spCampaigns', o: 'purchases7d', s: 'sales7d' },
  sb: { name: 'Brands', adProduct: 'SPONSORED_BRANDS', reportTypeId: 'sbCampaigns', o: 'purchases', s: 'sales' },
  sd: { name: 'Display', adProduct: 'SPONSORED_DISPLAY', reportTypeId: 'sdCampaigns', o: 'purchases', s: 'sales' },
};
function liveAdsKey_(b) { return 'LIVE_ADS_' + b; }
/** The three types added up, by day — what ?live=yoy and the snapshot hand the page. */
function liveAdsRead_(b) {
  var s;
  try { s = JSON.parse(prop_(liveAdsKey_(b)) || 'null'); } catch (e) { return null; }
  if (!s || !s.t) return null;
  var days = {}, types = [], errs = [], at = '';
  Object.keys(LIVE_ADS_TYPES).forEach(function (k) {
    var x = s.t[k]; if (!x) return;
    if (x.err) errs.push(LIVE_ADS_TYPES[k].name + ': ' + x.err);
    if (!x.days) return;
    types.push(LIVE_ADS_TYPES[k].name);
    if (x.at && (!at || x.at < at)) at = x.at;        // the oldest of the three is how fresh the total is
    Object.keys(x.days).forEach(function (d) {
      var r = x.days[d], t = days[d] || (days[d] = { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 });
      for (var f in t) t[f] += Number(r[f]) || 0;
    });
  });
  Object.keys(days).forEach(function (d) { days[d].spend = Math.round(days[d].spend * 100) / 100; days[d].sales = Math.round(days[d].sales * 100) / 100; });
  return types.length ? { at: at, days: days, types: types, err: errs.join(' · ') } : (errs.length ? { err: errs.join(' · ') } : null);
}
/** One report's rows, folded to {date: {impressions, clicks, spend, orders, sales}}. */
function liveAdsFold_(id, T) {
  var rows = adsWideRows_(id), days = {};
  rows.forEach(function (y) {
    var d = String(y.date || '').slice(0, 10); if (!d) return;
    var t = days[d] || (days[d] = { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 });
    t.impressions += Number(y.impressions) || 0; t.clicks += Number(y.clicks) || 0; t.spend += Number(y.cost) || 0;
    t.orders += Number(y[T.o]) || 0; t.sales += Number(y[T.s]) || 0;
  });
  return days;
}
function liveAdsTick_(b) {
  setBrand_(b);
  var key = liveAdsKey_(b), st = {};
  try { st = JSON.parse(prop_(key) || '{}') || {}; } catch (e) { st = {}; }
  if (!st.t) st = { t: {} };                         // the Products-only shape of the first day is dropped
  var nowMs = Date.now(), day = Utilities.formatDate(new Date(nowMs), LIVE_TZ, 'yyyy-MM-dd'), from = liveShift_(day, -7);
  Object.keys(LIVE_ADS_TYPES).forEach(function (k) {
    var T = LIVE_ADS_TYPES[k], x = st.t[k] || (st.t[k] = {});
    if (x.pendingId) {
      try {
        var s = ppcStatus_(x.pendingId);
        if (s.ready) { x.days = liveAdsFold_(x.pendingId, T); x.at = x.askedAt; x.pendingId = ''; x.err = ''; }
        else if (/fail|cancel/i.test(s.status || '')) { x.err = 'report ' + s.status + (s.error ? ': ' + String(s.error).slice(0, 120) : ''); x.pendingId = ''; }
        else if (nowMs - (x.askedMs || 0) > 90 * 60000) x.pendingId = '';     // stuck: ask afresh
        else return;                                 // still building: collect it next time
      } catch (e) { x.err = 'read: ' + String(e.message || e).slice(0, 140); x.pendingId = ''; }
    }
    try {
      var r = adsCall_('/reporting/reports', 'post', {
        name: 'live-' + k + '-' + b + '-' + nowMs, startDate: from, endDate: day,
        configuration: { adProduct: T.adProduct, groupBy: ['campaign'], reportTypeId: T.reportTypeId,
          columns: ['date', 'impressions', 'clicks', 'cost', T.o, T.s], timeUnit: 'DAILY', format: 'GZIP_JSON' },
      }, adsProfileId_(), ADS_REPORT_MIME);
      if (r.reportId) { x.pendingId = r.reportId; x.askedAt = new Date(nowMs).toISOString(); x.askedMs = nowMs; }
      else x.err = 'no report id (' + (r.status || '?') + ')';
    } catch (e) { x.err = 'ask: ' + String(e.message || e).slice(0, 140); }
  });
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(st));
  return st;
}

/* ---- THE STANDALONE PAGE'S DATA (Ravi, 2026-11-19: "make it a working html like prime.html") ----
 * Every 15 minutes liveSnapshotJob asks Amazon for both brands — today by hour against the same weekday last year and last
 * week, and the 15 Nov – 1 Dec run against last year — and writes it as JSON into one Google Sheet, published as CSV.
 * Pricing-App/public/live.html reads that CSV: no sign-in, nothing depends on anybody's computer. Same shape as prime.html.
 * Run liveSnapshotSetup once from the editor: it makes the sheet, writes the first snapshot and installs the trigger. */
function liveSnapshot_() {
  var day = Utilities.formatDate(new Date(), LIVE_TZ, 'yyyy-MM-dd'), ly = liveShift_(day, -364), y = day.slice(0, 4);
  var from = y + '-11-15', to = y + '-12-01', brands = {};
  ['SP', 'CPC'].forEach(function (b) {
    var x = {};
    try { liveAdsTick_(b); } catch (e) { /* the sales figures still go out */ }
    try { x.yoy = liveYoy_(b, day, ly); } catch (e) { x.yoyErr = String(e.message || e).slice(0, 200); }
    try { x.range = liveRange_(b, from, to, 364); } catch (e) { x.rangeErr = String(e.message || e).slice(0, 200); }
    brands[b] = x;
  });
  return { asOf: new Date().toISOString(), day: day, ly: ly, lw: liveShift_(day, -7), from: from, to: to, brands: brands };
}
function liveSnapshotSheet_() {
  var id = prop_('LIVE_SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* made again below */ } }
  var ss = SpreadsheetApp.create('Sellora Live vs Last Year (live.html data)');
  PropertiesService.getScriptProperties().setProperty('LIVE_SHEET_ID', ss.getId());
  return ss;
}
/** The JSON in column A, 40,000 characters a cell (a cell holds 50,000). Row 1 says when. */
function liveSnapshotWrite_(data) {
  var ss = liveSnapshotSheet_(), sh = ss.getSheets()[0];
  var s = JSON.stringify(data), parts = [];
  for (var i = 0; i < s.length; i += 40000) parts.push([s.slice(i, i + 40000)]);
  sh.clear();
  sh.getRange(1, 1).setValue('asOf ' + data.asOf + ' · parts ' + parts.length);
  if (parts.length) sh.getRange(2, 1, parts.length, 1).setValues(parts);
  SpreadsheetApp.flush();
  return { id: ss.getId(), url: ss.getUrl(), parts: parts.length, chars: s.length };
}
/** The 15-minute trigger. */
function liveSnapshotJob() {
  try { liveSnapshotWrite_(liveSnapshot_()); } catch (e) { console.error('live snapshot: ' + (e.message || e)); }
}
/** Run once from the editor: sheet + first snapshot + the trigger (any older one removed first). */
function liveSnapshotSetup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'liveSnapshotJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('liveSnapshotJob').timeBased().everyMinutes(15).create();
  var w = liveSnapshotWrite_(liveSnapshot_());
  Logger.log(JSON.stringify(w));
  return w;
}

/* ?live=range&brand=SP|CPC&from=YYYY-MM-DD&to=YYYY-MM-DD&shift=364|365
 *   → { ok, brand, asOf, from, to, lyFrom, lyTo, dates:[…], lyDates:[…], now:{date: row}, last:{lyDate: row} }
 * A run of days this year (up to now — days still to come are simply absent) against the same run `shift` days earlier
 * (364 = same weekday, 365 = same date). Ravi, 2026-11-19: "15 Nov to 1 December" — the Black Friday / Cyber Monday run. */
function liveRange_(brand, from, to, shift) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from || '')) || !re.test(String(to || ''))) return { ok: false, error: 'from and to must be YYYY-MM-DD.' };
  if (from > to) return { ok: false, error: 'from is after to.' };
  shift = Number(shift) || 364;
  if (shift < 360 || shift > 371) return { ok: false, error: 'shift must be about a year (364 or 365 days).' };
  var n = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 864e5) + 1;
  if (n > 62) return { ok: false, error: 'Pick 62 days or fewer.' };
  var b = setBrand_(brand), nowMs = Date.now();
  var dates = [], lyDates = [];
  for (var i = 0; i < n; i++) { dates.push(liveShift_(from, i)); lyDates.push(liveShift_(from, i - shift)); }
  var lyFrom = lyDates[0], lyTo = lyDates[n - 1];
  var byDay = function (rows) { var o = {}; rows.forEach(function (r) { o[String(r.t).slice(0, 10)] = r; }); return o; };
  var out = { ok: true, brand: b, asOf: new Date(nowMs).toISOString(), from: from, to: to, lyFrom: lyFrom, lyTo: lyTo,
    dates: dates, lyDates: lyDates, now: {}, last: {} };
  out.last = byDay(liveCached_('live_v1_' + b + '_range_' + lyFrom + '_' + lyTo, function () {
    return liveMetrics_(liveIso_(lyFrom, 0), liveIso_(liveShift_(lyTo, 1), 0), 'Day');
  }));
  var start = new Date(liveIso_(from, 0)).getTime();
  if (start < nowMs) {
    var endMs = new Date(liveIso_(liveShift_(to, 1), 0)).getTime();
    out.now = byDay(endMs <= nowMs
      ? liveCached_('live_v1_' + b + '_range_' + from + '_' + to, function () { return liveMetrics_(liveIso_(from, 0), liveIso_(liveShift_(to, 1), 0), 'Day'); })
      : liveMetrics_(liveIso_(from, 0), new Date(nowMs).toISOString(), 'Day'));
  }
  return out;
}
