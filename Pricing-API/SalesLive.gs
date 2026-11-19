/* Pricing-API / SalesLive.gs — LIVE VS LAST YEAR (Ravi, 2026-11-19: the Prime Day tracker as a page in Sellora, for any day).
 * Amazon's Sales API (getOrderMetrics) answers per hour or per day for any window, per brand with its own credentials —
 * this year live, last year from history. Nothing is stored here; last year's figures (which never change) are kept in the
 * script cache for six hours so a refresh every few minutes only asks Amazon for today.
 *
 *   ?live=yoy&brand=SP|CPC&day=YYYY-MM-DD&ly=YYYY-MM-DD
 *     → { ok, brand, asOf, day, ly, lw,
 *         now:[hour rows of `day` so far], last:[hour rows of `ly`], lastWeek:[hour rows of day-7] }
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
  return out;
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
