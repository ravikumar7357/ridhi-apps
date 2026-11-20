/* Pricing-API / SalesLive.gs — LIVE VS LAST YEAR (Ravi, 2026-11-19: the Prime Day tracker as a page in Sellora, for any day).
 * Amazon's Sales API (getOrderMetrics) answers per hour or per day for any window, per brand with its own credentials —
 * this year live, last year from history. Nothing is stored here; last year's figures (which never change) are kept in the
 * script cache for six hours so a refresh every few minutes only asks Amazon for today.
 *
 *   ?live=yoy&brand=SP|CPC&day=YYYY-MM-DD&ly=YYYY-MM-DD
 *     → { ok, brand, asOf, day, ly, lw,
 *         now:[hour rows of `day` so far], last:[hour rows of `ly`], lastWeek:[hour rows of day-7],
 *         week:[day rows, day-6 … day], ads:{ at, types, days:{date: {impressions, clicks, spend, orders, sales}}, err },
 *         shop:{ now, last, lastWeek, fourWk: [Pacific hour rows of the brand's Shopify store], fourWkDay } | { err },
 *         meta:{ configured, at, days:{date: {spend, clicks, impressions, purchases, value}} } | { configured:false } }
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
  try { out.shop = liveShop_(b, day, ly, lw, dayEnd, past); } catch (e) { out.shop = { err: String(e.message || e).slice(0, 200) }; }
  try { out.meta = liveMeta_(b, day); } catch (e) { out.meta = { configured: true, err: String(e.message || e).slice(0, 200) }; }
  return out;
}

/* ---- SHOPIFY ON THE LIVE PAGE (Ravi, 2026-11-20: "add Shopify sales … and Meta ads") ----
 * The brand's own Shopify store (Ridhi → SHOPIFY_*, CPC → CPC_SHOPIFY_*; Shopify.gs) by PACIFIC hour, so it lines up hour
 * for hour with Amazon on the same page: today so far, the same weekday last year and the same day last week. Sales =
 * line-item price × quantity, as shopifyDaily_ counts them (not total_price: no shipping, no tax); voided orders left out.
 * Finished days are kept in the script cache for six hours. Rows are { t, orders, units, sales }, one per hour. */
function liveShopHours_(day, endMs) {
  var startIso = liveIso_(day, 0), endIso = endMs ? new Date(endMs).toISOString() : liveIso_(liveShift_(day, 1), 0);
  var hours = [], fields = 'id,created_at,financial_status,line_items';
  var path = '/orders.json?status=any&limit=250&fields=' + fields
    + '&created_at_min=' + encodeURIComponent(startIso) + '&created_at_max=' + encodeURIComponent(endIso);
  var pageInfo = null, guard = 0;
  do {
    var r = shopifyGet_(pageInfo ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo) : path);
    (r.json.orders || []).forEach(function (o) {
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      var at = new Date(o.created_at);
      if (Utilities.formatDate(at, LIVE_TZ, 'yyyy-MM-dd') !== day) return;
      var h = Number(Utilities.formatDate(at, LIVE_TZ, 'H'));
      while (hours.length <= h) hours.push({ orders: 0, units: 0, sales: 0 });
      var b = hours[h];
      (o.line_items || []).forEach(function (li) { var q = Number(li.quantity) || 0; b.units += q; b.sales += (Number(li.price) || 0) * q; });
      b.orders += 1;
    });
    pageInfo = shopifyNextPageInfo_(r.link);
  } while (pageInfo && ++guard < 100);
  // Today: an hour row up to the hour now running, even when it had no order. A finished day: all 24.
  var n = endMs ? Number(Utilities.formatDate(new Date(endMs), LIVE_TZ, 'H')) + 1 : 24;
  while (hours.length < n) hours.push({ orders: 0, units: 0, sales: 0 });
  hours.forEach(function (x) { x.sales = Math.round(x.sales * 100) / 100; });
  return hours;
}
function liveShop_(b, day, ly, lw, dayEnd, past) {
  setShopBrand_(b);
  if (!prop_(SHOP_PREFIX + 'SHOPIFY_TOKEN')) return { err: 'no Shopify store set up for ' + b };
  var whole = function (d) { return liveCached_('live_shop_v1_' + b + '_' + d, function () { return liveShopHours_(d, 0); }); };
  // fourWk: the same weekday four weeks back (Ravi, 2026-11-20) — the store's first sale was 28 Dec 2025, so until then
  // last year has nothing in it and this is the closest same-day comparison that does.
  var m4 = liveShift_(day, -28);
  return { now: past ? whole(day) : liveShopHours_(day, dayEnd), last: whole(ly), lastWeek: whole(lw), fourWk: whole(m4), fourWkDay: m4 };
}

/* ---- META ADS ON THE LIVE PAGE (ready before the token is: it switches itself on) ----
 * Needs, in Script Properties: META_TOKEN (a system-user token with ads_read — Meta Business Settings → System users) and
 * META_AD_ACCOUNT for Ridhi / CPC_META_AD_ACCOUNT for CPC ("act_123…" or just the number). Optional META_API_VERSION.
 * Without them this answers { configured: false } and the page says what to add. Meta's insights run about 15 minutes
 * behind, in the AD ACCOUNT's own timezone — which may not be Pacific, so the page says so.
 * Answers { configured, days: { 'YYYY-MM-DD': { spend, clicks, impressions, purchases, value } } } for the 8 days to `day`. */
function liveMeta_(b, day) {
  var token = prop_('META_TOKEN'), acct = prop_((b === 'CPC' ? 'CPC_' : '') + 'META_AD_ACCOUNT');
  if (!token || !acct) return { configured: false };
  acct = String(acct).replace(/^act_/, '');
  var ver = prop_('META_API_VERSION') || 'v23.0';
  var tr = JSON.stringify({ since: liveShift_(day, -7), until: day });
  var url = 'https://graph.facebook.com/' + ver + '/act_' + acct + '/insights?level=account&time_increment=1'
    + '&fields=' + encodeURIComponent('spend,clicks,impressions,actions,action_values')
    + '&time_range=' + encodeURIComponent(tr);
  var ckey = 'live_meta_' + b + '_' + day;
  var cached = CacheService.getScriptCache().get(ckey);                 // Meta's own figures move every ~15 min
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* ask again */ } }
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error('Meta ' + res.getResponseCode() + ': ' + ((body.error && body.error.message) || '').slice(0, 160));
  var pick = function (list) {                       // the purchase count / value Meta reports, by the usual action types
    var v = 0; (list || []).forEach(function (a) { if (a.action_type === 'purchase' || a.action_type === 'omni_purchase') v = Math.max(v, Number(a.value) || 0); });
    return v;
  };
  var days = {};
  (body.data || []).forEach(function (r) {
    days[r.date_start] = { spend: Number(r.spend) || 0, clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0,
      purchases: pick(r.actions), value: pick(r.action_values) };
  });
  var out = { configured: true, at: new Date().toISOString(), days: days };
  try { CacheService.getScriptCache().put(ckey, JSON.stringify(out), 300); } catch (e) { /* asked again next time */ }
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

/* ---- THE DAILY AD ARCHIVE (Ravi, 2026-11-20: "the Events page should have data which is perfect") ----
 * The live report above covers 7 days; before that the pages fell back to the nightly figure, which is Sponsored Products
 * only — so an event a few weeks back showed too little spend and too low a TACoS. Once a day, per brand and ad type, this
 * asks Amazon for every day it still hands out (Products about 90 days, Brands about 60, Display about 65; it refuses an
 * older start date) and keeps them in cache "adsDay" — { SP|CPC: { date: { sp|sb|sd: [impr, clicks, spend, orders, sales],
 * u: { sp: 1 } } } } — adding to it every day, so the archive grows beyond Amazon's window from now on. Older days come
 * from uploaded Ads console reports (liveAdsPut_, marked in u). liveHist_ hands the pages the three types added up. */
var LIVE_ADS_BACK = { sp: 90, sb: 59, sd: 64 };
function liveAdsBackTick_(b) {
  setBrand_(b);
  var key = 'LIVE_ADSB_' + b, st = {};
  try { st = JSON.parse(prop_(key) || '{}') || {}; } catch (e) { st = {}; }
  var nowMs = Date.now(), day = Utilities.formatDate(new Date(nowMs), LIVE_TZ, 'yyyy-MM-dd'), arc = null;
  Object.keys(LIVE_ADS_TYPES).forEach(function (k) {
    var T = LIVE_ADS_TYPES[k], x = st[k] || (st[k] = {});
    if (x.id) {
      try {
        var s = ppcStatus_(x.id);
        if (s.ready) {
          var days = liveAdsFold_(x.id, T);
          arc = arc || cacheRead_('adsDay') || {};
          var A = arc[b] || (arc[b] = {});
          Object.keys(days).forEach(function (d) {
            var r = days[d], e = A[d] || (A[d] = {});
            e[k] = [r.impressions, r.clicks, Math.round(r.spend * 100) / 100, r.orders, Math.round(r.sales * 100) / 100];
            if (e.u) delete e.u[k];                    // Amazon's own figure replaces an uploaded one
          });
          x.doneDay = x.askDay; x.id = ''; x.err = ''; x.n = Object.keys(days).length;
        } else if (/fail|cancel/i.test(s.status || '')) { x.err = 'report ' + s.status + (s.error ? ': ' + String(s.error).slice(0, 160) : ''); x.id = ''; x.doneDay = x.askDay; }
        else if (nowMs - (x.askedMs || 0) > 3 * 3600000) x.id = '';
      } catch (e) { x.err = 'read: ' + String(e.message || e).slice(0, 160); x.id = ''; }
      return;
    }
    if (x.doneDay === day) return;
    try {
      var r = adsCall_('/reporting/reports', 'post', {
        name: 'liveback-' + k + '-' + b + '-' + nowMs, startDate: liveShift_(day, -LIVE_ADS_BACK[k]), endDate: liveShift_(day, -1),
        configuration: { adProduct: T.adProduct, groupBy: ['campaign'], reportTypeId: T.reportTypeId,
          columns: ['date', 'impressions', 'clicks', 'cost', T.o, T.s], timeUnit: 'DAILY', format: 'GZIP_JSON' },
      }, adsProfileId_(), ADS_REPORT_MIME);
      if (r.reportId) { x.id = r.reportId; x.askedMs = nowMs; x.askDay = day; }
      else { x.err = 'no report id (' + String(r.status || r.message || '?').slice(0, 160) + ')'; x.doneDay = day; }
    } catch (e) { x.err = 'ask: ' + String(e.message || e).slice(0, 160); x.doneDay = day; }
  });
  if (arc) cacheWrite_('adsDay', arc);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(st));
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
    try { liveAdsBackTick_(b); } catch (e) { /* the archive catches up on a later run */ }
    try { x.yoy = liveYoy_(b, day, ly); } catch (e) { x.yoyErr = String(e.message || e).slice(0, 200); }
    try { x.range = liveRange_(b, from, to, 364); } catch (e) { x.rangeErr = String(e.message || e).slice(0, 200); }
    brands[b] = x;
  });
  var out = { asOf: new Date().toISOString(), day: day, ly: ly, lw: liveShift_(day, -7), from: from, to: to, brands: brands };
  try { liveShopCpcTick_(day); } catch (e) { out.shopCpcErr = String(e.message || e).slice(0, 200); }
  try { out.hist = liveHist_(day); } catch (e) { out.histErr = String(e.message || e).slice(0, 200); }
  return out;
}

/* ---- CPC'S SHOPIFY HISTORY (Ravi, 2026-11-20: "add CPC data also") ----
 * The nightly run keeps daily totals for Ridhi's Shopify store only ("daily".SHOP). CPC's store (CPC_SHOPIFY_*) is built here,
 * a slice at a time so no run takes long: every 15-minute run reads the last 3 days again (late orders, refunds) and one more
 * 60-day slice further back, until it reaches 1 January of last year. Same counting as the nightly (shopifyDaily_: line-item
 * sales, store-local day, voided orders out). Kept in the cache sheet "shopCPC": { at, back: oldest day read, d: { date:
 * [sales, units, orders] } }; liveHist_ hands it to the pages as d.SHOP_CPC. */
function liveShopCpcTick_(day) {
  setShopBrand_('CPC');
  if (!prop_('CPC_SHOPIFY_TOKEN')) return;
  var st = cacheRead_('shopCPC') || {}, d = st.d || {}, fromLy = (Number(day.slice(0, 4)) - 1) + '-01-01';
  var yest = liveShift_(day, -1), deadline = Date.now() + 90000;
  var put = function (r) { Object.keys(r.dates || {}).forEach(function (k) { d[k] = r.dates[k]; }); };
  // Recent days, read again every run.
  var top = shopifyDaily_(liveShift_(day, -3), yest, deadline);
  if (!top.more) put(top);
  // One slice further back, until 1 January of last year.
  var back = st.back || day;
  if (back > fromLy && Date.now() < deadline) {
    var end = liveShift_(back, -1), start = liveShift_(end, -59);
    if (start < fromLy) start = fromLy;
    var r = shopifyDaily_(start, end, deadline);
    if (!r.more) { put(r); back = start; }
  }
  cacheWrite_('shopCPC', { at: new Date().toISOString(), back: back, d: d });
}

/* ---- WEEK / MONTH / QUARTER / YEAR on live.html (Ravi, 2026-11-20: "add day, week, month, quarterly and year") ----
 * The nightly run already keeps every day's totals (Nightly.gs → cache sheet "daily": { SP, CPC, SHOP: { date: [sales,
 * units, orders] } }, about 800 days back) and the last ~93 days of Sponsored Products spend per day ("ads": { brand:
 * { date: [impr, clicks, spend, orders, sales] } }). This hands live.html the slice it needs — 1 Jan last year to today —
 * so a period to date is that history plus today's live figures. Nothing extra is asked of Amazon or Shopify.
 * SHOP is Ridhi's Shopify store (the only one the nightly walks). Its first sale was 28 Dec 2025. */
function liveHist_(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) day = Utilities.formatDate(new Date(), LIVE_TZ, 'yyyy-MM-dd');
  // Everything the nightly keeps (about 800 days), not only from 1 January last year: a financial quarter or year picked from
  // the past needs the year before it too (Ravi, 2026-11-20: "a quarter we can change; our year runs April to March").
  var fromLy = liveShift_(day, -800);
  var cut = function (o) { var r = {}; Object.keys(o || {}).forEach(function (d) { if (d >= fromLy && d <= day) r[d] = o[d]; }); return r; };
  var daily = cacheRead_('daily') || {}, dd = daily.d || {}, ads = cacheRead_('ads') || {}, ad = ads.d || {};
  var cpc = cacheRead_('shopCPC') || {};               // CPC's Shopify store, built by liveShopCpcTick_
  var last = '';
  ['SP', 'CPC', 'SHOP'].forEach(function (k) { Object.keys(dd[k] || {}).forEach(function (d) { if (d > last && d <= day) last = d; }); });
  // Ad spend per day: the daily archive's three types added up (liveAdsBackTick_, uploads), else the nightly Products figure.
  var arc = cacheRead_('adsDay') || {}, adOut = {};
  ['SP', 'CPC'].forEach(function (b) {
    var o = cut(ad[b]), A = arc[b] || {};
    Object.keys(A).forEach(function (d) {
      if (d < fromLy || d > day) return;
      var t = [0, 0, 0, 0, 0], any = false;
      ['sp', 'sb', 'sd'].forEach(function (k) { var r = A[d][k]; if (r) { any = true; for (var i = 0; i < 5; i++) t[i] += Number(r[i]) || 0; } });
      if (any) { t[2] = Math.round(t[2] * 100) / 100; t[4] = Math.round(t[4] * 100) / 100; o[d] = t; }
    });
    adOut[b] = o;
  });
  return { ok: true, at: daily.at || '', through: last, from: fromLy,      // ok: Sellora's baCall reads any answer without it as a failure
    d: { SP: cut(dd.SP), CPC: cut(dd.CPC), SHOP: cut(dd.SHOP), SHOP_CPC: cut(cpc.d) }, shopCpcFrom: cpc.back || '',
    ads: adOut, adsAt: ads.at || '' };
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
  try { var snap = liveSnapshot_(); snap.monthsGid = prop_('LIVE_MONTHS_GID') || ''; liveSnapshotWrite_(snap); } catch (e) { console.error('live snapshot: ' + (e.message || e)); }
  // The month-by-product report: a slice of the Orders workbooks a run, then live.html's copy (see liveMonthsTick_).
  try { liveMonthsTick_(); liveMonthsPublish_(); } catch (e) { console.error('live months: ' + (e.message || e)); }
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

/* ---- MONTH BY MONTH, PER ASIN AND SKU (Ravi, 2026-11-20: "Jan'25 to May'25 Ridhi month on month, Jan'25 to Mar'26 CPC —
 * all metrics: sales, ads / organic, spend, orders, units, ASIN SKU wise") ----
 * Sales, units and orders per SKU (with its ASIN) per month come from the brands' Orders workbooks — the same rows and the
 * same exclusions as every other sales figure in this backend (MCF, cancelled and other marketplaces out). The workbooks run
 * to 170–190 thousand rows, so liveMonthsTick_ reads them a slice at a time from the 15-minute snapshot job (about a minute
 * a run, the work in progress kept in cache "monthWip") and publishes a finished pass as cache "monthAsin". A new pass starts
 * once a day. Orders are counted distinct per SKU: the lines of one order sit together in the workbook.
 * Ad figures per ASIN/SKU for old months cannot be had from Amazon — the Ads API keeps about 95 days — so they come from Ads
 * console reports uploaded in Sellora (liveAdsPut_, POST lads=put), kept in cache "monthAds" per brand, month and ad type.
 * Sellora reads it all with ?live=months; live.html reads the copy liveMonthsPublish_ writes to the "months" tab. */
var LIVE_MONTHS_FROM = '2025-01';
// v2 (same day): orders counted once per ASIN and once per brand-month as well as per SKU — summing the SKUs' orders counted
// an order with two SKUs twice (about 10% too many). A cache of another version is rebuilt.
var LIVE_MONTHS_V = 2;
function liveMonthsTick_() {
  var today = Utilities.formatDate(new Date(), LIVE_TZ, 'yyyy-MM-dd');
  var wip = cacheRead_('monthWip') || {};
  if (wip.day && wip.v !== LIVE_MONTHS_V) wip = {};
  if (!wip.day) {
    var done = cacheRead_('monthAsin') || {};
    if (done.day === today && done.v === LIVE_MONTHS_V) return;          // today's pass is done
    wip = { v: LIVE_MONTHS_V, day: today, book: 0, row: 2, acc: { SP: {}, CPC: {} }, ord: { SP: {}, CPC: {} }, aord: { SP: {}, CPC: {} }, lo: {}, loA: {}, lob: '' };
  }
  var deadline = Date.now() + 60000, BR = ['SP', 'CPC'];
  while (Date.now() < deadline && wip.book < ORDERS_DATA_IDS.length) {
    var ss = bookOpen_(ORDERS_DATA_IDS[wip.book]), sh = null;
    ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
    var last = sh ? sh.getLastRow() : 0;
    if (!sh || wip.row > last) { wip.book++; wip.row = 2; wip.lo = {}; wip.loA = {}; wip.lob = ''; continue; }
    var n = Math.min(15000, last - wip.row + 1), data = sh.getRange(wip.row, 1, n, 10).getValues();
    var acc = wip.acc[BR[wip.book]], ord = wip.ord[BR[wip.book]], aord = wip.aord[BR[wip.book]];
    var lo = wip.lo, loA = wip.loA, lastMs = -1, mk = '';
    for (var i = 0; i < data.length; i++) {
      var r = data[i], sku = String(r[3] || '').trim();
      if (!sku) continue;
      if (String(r[9] || '').toUpperCase() === 'MCF') continue;
      if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
      if (!chanOk_(r[8])) continue;
      var dMs = toMs_(r[2]); if (!dMs) continue;
      if (dMs !== lastMs) { lastMs = dMs; mk = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM'); }
      if (mk < LIVE_MONTHS_FROM) continue;
      var s = acc[sku] || (acc[sku] = { a: '', m: {} });
      var asin = String(r[4] || '').trim().toUpperCase(); if (asin) s.a = asin;
      var b = s.m[mk] || (s.m[mk] = [0, 0, 0]);
      b[0] = Math.round((b[0] + (Number(r[6]) || 0)) * 100) / 100;
      b[1] += Number(r[5]) || 0;
      var oid = String(r[0] || '');
      if (oid && lo[sku] !== oid) { b[2] += 1; lo[sku] = oid; }
      if (oid && wip.lob !== oid) { ord[mk] = (ord[mk] || 0) + 1; wip.lob = oid; }
      if (oid && asin && loA[asin] !== oid) { var ao = aord[asin] || (aord[asin] = {}); ao[mk] = (ao[mk] || 0) + 1; loA[asin] = oid; }
    }
    wip.row += n;
  }
  if (wip.book >= ORDERS_DATA_IDS.length) {
    // Finished: one compact copy — the SKUs once, then per month [sku index, sales, units, orders].
    var d = {};
    BR.forEach(function (br) {
      var acc = wip.acc[br] || {}, skus = Object.keys(acc).sort(), m = {};
      skus.forEach(function (sku, ix) { Object.keys(acc[sku].m).forEach(function (k) { var v = acc[sku].m[k]; (m[k] || (m[k] = [])).push([ix, v[0], v[1], v[2]]); }); });
      // o: distinct orders per month for the brand; ao: distinct orders per ASIN per month (an order with two sizes of one
      // ASIN is one order for that ASIN). The SKU rows' own order counts stay per SKU.
      d[br] = { skus: skus.map(function (sku) { return [sku, acc[sku].a]; }), m: m, o: wip.ord[br] || {}, ao: wip.aord[br] || {} };
    });
    cacheWrite_('monthAsin', { v: LIVE_MONTHS_V, at: new Date().toISOString(), day: wip.day, from: LIVE_MONTHS_FROM, d: d });
    cacheWrite_('monthWip', {});
  } else {
    wip.lo = {}; wip.loA = {};    // an order cut across two slices is counted once more at most — a handful a pass
    cacheWrite_('monthWip', wip);
  }
}
function liveMonths_() {
  var c = cacheRead_('monthAsin') || {}, a = cacheRead_('monthAds') || {}, w = cacheRead_('monthWip') || {};
  return { ok: true, at: c.at || '', from: LIVE_MONTHS_FROM, d: c.d || null, ads: a.d || {}, adsAt: a.at || '', files: a.files || [],
    building: w.day ? { book: w.book, row: w.row, of: ORDERS_DATA_IDS.length } : null };
}
/* POST { key, lads:'put', brand:'SP'|'CPC', kind:'sp'|'sd'|'sb', file, months: { 'YYYY-MM': [[asin, sku, spend, adSales,
 * adOrders, adUnits, clicks, impressions], …] } } — the browser reads the report and sums it by month. A month sent again
 * for the same brand and ad type replaces what was there, so uploading the same report twice does not double it. */
function liveAdsPut_(p) {
  var b = String(p.brand || '').toUpperCase(), kind = String(p.kind || 'sp').toLowerCase();
  if (b !== 'SP' && b !== 'CPC') return { ok: false, error: 'Pick Ridhi or CPC before uploading.' };
  if (['sp', 'sd', 'sb'].indexOf(kind) < 0) return { ok: false, error: 'Ad type must be sp, sd or sb.' };
  var m = p.months || {}, ks = Object.keys(m).filter(function (k) { return /^\d{4}-\d{2}$/.test(k); }).sort();
  if (!ks.length) return { ok: false, error: 'No months in the upload.' };
  var c = cacheRead_('monthAds') || {};
  c.d = c.d || {}; c.d[b] = c.d[b] || {}; c.files = c.files || [];
  var num = function (v) { return Math.round((Number(v) || 0) * 100) / 100; };
  ks.forEach(function (k) {
    var rows = (Array.isArray(m[k]) ? m[k] : []).filter(Array.isArray).slice(0, 6000).map(function (r) {
      return [String(r[0] || '').trim().toUpperCase().slice(0, 12), String(r[1] || '').trim().slice(0, 80), num(r[2]), num(r[3]), num(r[4]), num(r[5]), num(r[6]), num(r[7])];
    });
    var mo = c.d[b][k] || (c.d[b][k] = {});
    mo[kind] = rows;
  });
  c.files.unshift({ at: new Date().toISOString(), brand: b, kind: kind, name: String(p.file || '').slice(0, 120), months: ks });
  c.files = c.files.slice(0, 60); c.at = new Date().toISOString();
  cacheWrite_('monthAds', c);
  // The same report by day ({ date: [spend, adSales, adOrders, adUnits, clicks, impressions] }) goes into the daily ad archive,
  // for Events and the periods — only for days Amazon's own figure for that type is not already there.
  var days = p.days || {}, dk = Object.keys(days).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); });
  if (dk.length) {
    var arc = cacheRead_('adsDay') || {}, A = arc[b] || (arc[b] = {});
    dk.forEach(function (d) {
      var r = days[d] || [], e = A[d] || (A[d] = {});
      if (e[kind] && !(e.u && e.u[kind])) return;
      e[kind] = [num(r[5]), num(r[4]), num(r[0]), num(r[2]), num(r[1])];
      (e.u || (e.u = {}))[kind] = 1;
    });
    cacheWrite_('adsDay', arc);
  }
  return { ok: true, brand: b, kind: kind, months: ks, days: dk.length };
}
/* POST { key, lads:'drop', brand, kind, month } — takes one uploaded month back out (a wrong file). */
function liveAdsDrop_(p) {
  var b = String(p.brand || '').toUpperCase(), kind = String(p.kind || '').toLowerCase(), k = String(p.month || '');
  var c = cacheRead_('monthAds') || {};
  if (!c.d || !c.d[b] || !c.d[b][k] || !c.d[b][k][kind]) return { ok: false, error: 'Nothing uploaded for that month.' };
  delete c.d[b][k][kind]; if (!Object.keys(c.d[b][k]).length) delete c.d[b][k];
  c.at = new Date().toISOString();
  cacheWrite_('monthAds', c);
  // And the uploaded days of that month from the daily archive (Amazon's own days stay).
  var arc = cacheRead_('adsDay') || {}, A = arc[b] || {}, hit = false;
  Object.keys(A).forEach(function (d) { var e = A[d]; if (d.slice(0, 7) === k && e.u && e.u[kind]) { delete e[kind]; delete e.u[kind]; hit = true; } });
  if (hit) cacheWrite_('adsDay', arc);
  return { ok: true };
}
/** live.html's copy, on the "months" tab of the live sheet — written only when something in it changed. */
function liveMonthsPublish_() {
  var m = liveMonths_(), stamp = m.at + '|' + m.adsAt + '|' + (m.building ? m.building.book + ':' + m.building.row : '');
  if (prop_('LIVE_MONTHS_STAMP') === stamp) return;
  var ss = liveSnapshotSheet_(), sh = ss.getSheetByName('months') || ss.insertSheet('months');
  var s = JSON.stringify(m), parts = [];
  for (var i = 0; i < s.length; i += 40000) parts.push(["'" + s.slice(i, i + 40000)]);
  sh.clear();
  sh.getRange(1, 1).setValue('at ' + m.at + ' · parts ' + parts.length);
  sh.getRange(2, 1, parts.length, 1).setValues(parts);
  SpreadsheetApp.flush();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('LIVE_MONTHS_STAMP', stamp);
  props.setProperty('LIVE_MONTHS_GID', String(sh.getSheetId()));
}
