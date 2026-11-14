/* Pricing-API / AmazonMatch.gs — Amazon's OWN day totals, so Sellora can match Seller Central and the Ads console.
 *
 * A NEW FILE THAT CHANGES NOTHING ELSE. It has its own 10-minute timer (matchTick), its own state (Script Property
 * MATCH_STATE) and writes two new tabs in the cache spreadsheet: matchBiz and matchAds. It never edits Nightly.gs,
 * AdsApi.gs or any other file, never changes anything at Amazon (it only asks for reports), and never takes the
 * script lock the nightly run uses, so the two cannot block each other.
 *
 * WHY. Sellora worked its numbers out itself — sales from the Orders Data workbooks, sessions as per-product weeks added
 * together, ads as Sponsored Products only with 30-day sales. All close, none equal to Amazon's screens. This file reads
 * the reports those screens are built from instead:
 *
 *   matchBiz  Seller Central → Business Reports → By Date → Sales and Traffic
 *             SP-API GET_SALES_AND_TRAFFIC_REPORT, the salesAndTrafficByDate part (one row per day, whole account).
 *             Per day: [Ordered Product Sales, Units Ordered, Total Order Items, Sessions – Total, Page Views – Total,
 *                       Ordered Product Sales B2B, Units Ordered B2B, Total Order Items B2B]   (B2B is a PART of the total)
 *
 *   matchAds  Ads console → Campaign manager, per campaign type, per day (Ads API v3 campaign reports, summed).
 *             sp: [impressions, clicks, cost, sales7d, purchases7d, sales14d, purchases14d, sales30d, purchases30d, spend]
 *             sb / sd: [impressions, clicks, cost, sales*, orders*, salesAll, ordersAll, salesClicks, ordersClicks]
 *               * "console rule": vCPM campaigns count sales from clicks AND views, CPC campaigns from clicks only —
 *                 Amazon's attribution help says that is how the console counts. salesAll is every sale the report
 *                 has, whatever the cost type. matchDay prints both, so the first check settles which one the console uses.
 *
 * EVERY NIGHT (a pass starts after MATCH_START_HOUR in the script's time zone, when the Pacific day has ended):
 *   - Business Reports: the last MATCH_BIZ_REFRESH days, one report per brand. First time: two years, in slices.
 *   - Ads: the last MATCH_ADS_REFRESH days for SP, SB and SD, in 31-day reports (Amazon's maximum). First time: as far
 *     back as Amazon still keeps each type — the start is read off Amazon's own refusal message rather than guessed.
 *   - A report that fails is asked for again, up to MATCH_TRIES times. A day is only ever REPLACED by a report that
 *     arrived; it is never set to zero because a report failed. History older than Amazon keeps is never deleted, so
 *     the ad history grows past Amazon's own retention over time.
 *
 * RUN FROM THE EDITOR
 *   matchSetup()      once: checks the cache sheet, installs the timer, starts the first fill
 *   matchStatus()     what it is doing, what it holds, any errors
 *   matchBizFresh()   asks Amazon live for the day 10 days ago and prints it (2-5 minutes) — the quick proof
 *   matchCheck()      prints 3 days (10, 20, 40 days ago) for both brands, laid out like Amazon's screens
 *   matchDay('2026-11-01')   one day from the cache
 *   matchRunNow()     start a fresh pass now instead of waiting for tomorrow
 *   matchStop()       removes the timer. To undo everything: matchStop, delete this file, delete the two tabs.
 *
 * Sellora reads the results through the existing endpoint: ?cache=matchBiz and ?cache=matchAds. No redeploy needed.
 */

var MATCH_START_HOUR = 14;      // script time zone (Asia/Kolkata): 14:00 IST is after midnight Pacific all year
var MATCH_BUDGET_MS = 4.5 * 60000;
var MATCH_BIZ_REFRESH = 62;     // days re-read every night (Amazon restates recent days)
var MATCH_ADS_REFRESH = 62;     // conversions are restated for up to ~60 days
var MATCH_BIZ_BACK = 728;       // Amazon: start must be no more than two years before the request
var MATCH_BIZ_SLICE = 182;      // days per Business Reports request during the first fill
var MATCH_ADS_BACK = 95;        // first ask; Amazon's refusal message moves the start to what it really keeps
var MATCH_ADS_SLICE = 31;       // Ads API v3 maximum per report
var MATCH_TRIES = 3;
var MATCH_BIZ_ASKS_PER_TICK = 3;   // SP-API createReport allows about one a minute after a burst; nightly needs some too
var MATCH_BRANDS = ['SP', 'CPC'];
var MATCH_BRAND_LABEL = { SP: 'Ridhi', CPC: 'CPC' };
var MATCH_KINDS = ['biz', 'sp', 'sb', 'sd'];

/* ============================== editor functions ============================== */

function matchSetup() {
  // 1. The cache sheet must be writable by whoever runs this — the timer runs as that person.
  try {
    var ss = cacheSheet_();
    var probe = ss.getSheetByName('matchProbe') || ss.insertSheet('matchProbe');
    probe.getRange(1, 1).setValue('ok ' + ammNow_());
    ss.deleteSheet(probe);
  } catch (e) {
    var id = PropertiesService.getScriptProperties().getProperty('CACHE_SHEET_ID') || '';
    Logger.log('❌ cannot edit the cache spreadsheet: ' + (e.message || e));
    if (id) Logger.log('   Ask Ravi to share it with you as Editor: https://docs.google.com/spreadsheets/d/' + id + '/edit');
    Logger.log('   Then run matchSetup again. Nothing was installed.');
    return;
  }
  // 2. The timer.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'matchTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('matchTick').timeBased().everyMinutes(10).create();
  // 3. Start the first fill now rather than tomorrow afternoon.
  var st = ammState_(); st.reset = true; ammSave_(st);
  Logger.log('✅ matchTick now runs every 10 minutes.');
  Logger.log('   The first fill starts on the next tick: about 2 years of Business Reports and as much ad');
  Logger.log('   history as Amazon keeps. It takes 1-3 hours. Watch it with matchStatus().');
  Logger.log('   After that, a fresh pass starts each day after ' + MATCH_START_HOUR + ':00 ' + Session.getScriptTimeZone() + '.');
  Logger.log('   Quick proof while you wait: run matchBizFresh().');
}

function matchStop() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'matchTick') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n ? 'matchTick timer removed. The matchBiz / matchAds tabs are left as they are.' : 'No matchTick timer was installed.');
}

function matchRunNow() {
  var st = ammState_(); st.reset = true; ammSave_(st);
  Logger.log('A fresh pass starts on the next tick (within 10 minutes). To go now, run matchTick yourself.');
}

function matchStatus() {
  var st = ammState_();
  Logger.log('pass day   ' + (st.day || '(none yet)') + (st.reset ? '  — fresh pass asked for' : ''));
  Logger.log('phase      ' + (st.phase || 'idle') + (st.doneAt ? '  · finished ' + st.doneAt : ''));
  var jobs = st.jobs || [];
  var waiting = jobs.filter(function (j) { return j.st === 'new' || j.st === 'asked'; });
  var gave = jobs.filter(function (j) { return j.st === 'gave'; });
  Logger.log('to get     ' + (waiting.length ? waiting.length + ' report(s): ' + waiting.map(ammJobName_).join(', ') : 'nothing'));
  Logger.log('collected  ' + (st.doneN || 0) + ' report(s) this pass');
  if (gave.length) {
    Logger.log('⚠️ GAVE UP on ' + gave.length + ' report(s) after ' + MATCH_TRIES + ' tries (old figures kept):');
    gave.forEach(function (j) { Logger.log('   ' + ammJobName_(j) + ' :: ' + (j.m || '?')); });
  }
  var filled = st.filled || {};
  Logger.log('first fill ' + MATCH_BRANDS.map(function (b) {
    return MATCH_BRAND_LABEL[b] + ' ' + MATCH_KINDS.map(function (k) { return k + (filled[b + '|' + k] ? ' ✓' : ' …'); }).join(' ');
  }).join('  |  '));
  (st.errors || []).forEach(function (e) { Logger.log('error      ' + e); });

  var biz = cacheRead_('matchBiz'), ads = cacheRead_('matchAds');
  Logger.log('— what the cache holds —');
  MATCH_BRANDS.forEach(function (b) {
    var lab = MATCH_BRAND_LABEL[b];
    var bd = (biz && biz.d && biz.d[b]) || {};
    Logger.log(lab + '  Seller Central  ' + ammSpan_(Object.keys(bd)) + (biz && biz.cur && biz.cur[b] ? '  (' + biz.cur[b] + ')' : ''));
    var ad = (ads && ads.d && ads.d[b]) || {};
    ['sp', 'sb', 'sd'].forEach(function (k) {
      var days = Object.keys(ad).filter(function (d) { return ad[d] && ad[d][k]; });
      Logger.log(lab + '  ' + ammKindName_(k) + '  ' + ammSpan_(days) + ammGaps_(days));
    });
  });
  Logger.log('updated    matchBiz ' + ((biz && biz.at) || 'never') + '  ·  matchAds ' + ((ads && ads.at) || 'never'));
}

/** Print one day the way Amazon's screens show it. */
function matchDay(day) {
  day = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { Logger.log('Give a date like matchDay("2026-11-01").'); return; }
  ammPrintDay_(day, cacheRead_('matchBiz'), cacheRead_('matchAds'));
}

/** Three test days at once: about 10, 20 and 40 days ago (Pacific). */
function matchCheck() {
  var biz = cacheRead_('matchBiz'), ads = cacheRead_('matchAds');
  var today = ammToday_();
  Logger.log('Compare each block with Seller Central (Business Reports → By Date → Sales and Traffic, both dates on that day)');
  Logger.log('and the Ads console (Campaign manager, custom range with start and end on that day, filter by campaign type).');
  Logger.log('Days under ~15 days old may still move a little for SB/SD ad sales; the 40-day one should be exact.');
  [10, 20, 40].forEach(function (n) { ammPrintDay_(ammAdd_(today, -n), biz, ads); });
}

/** Ask Amazon NOW for the day 10 days ago, both brands, and print it. Does not touch the cache. */
function matchBizFresh() {
  var day = ammAdd_(ammToday_(), -10);
  var t0 = Date.now();
  var jobs = [];
  MATCH_BRANDS.forEach(function (b) {
    try {
      setBrand_(b);
      var id = ammBizAsk_(ammAdd_(day, -1), ammAdd_(day, 1));   // padded, like the nightly run
      jobs.push({ b: b, id: id });
    } catch (e) { Logger.log(MATCH_BRAND_LABEL[b] + ': could not ask Amazon :: ' + String(e.message || e).slice(0, 300)); }
  });
  Logger.log('Asked Amazon for ' + day + ' (' + ammWeekday_(day) + '). Waiting for the reports — usually 1-3 minutes…');
  while (jobs.some(function (j) { return !j.out; }) && Date.now() - t0 < 5.2 * 60000) {
    Utilities.sleep(15000);
    jobs.forEach(function (j) {
      if (j.out) return;
      try {
        setBrand_(j.b);
        var s = ammBizStatus_(j.id);
        if (s.dead) j.out = { err: 'Amazon could not build the report (' + s.status + ').' };
        else if (s.ready) j.out = { d: ammBizFetch_(s.doc) };
      } catch (e) { j.out = { err: String(e.message || e).slice(0, 300) }; }
    });
  }
  jobs.forEach(function (j) {
    var lab = MATCH_BRAND_LABEL[j.b];
    if (!j.out) { Logger.log(lab + ': Amazon has not finished yet. Run matchBizFresh again in a few minutes.'); return; }
    if (j.out.err) { Logger.log(lab + ': ' + j.out.err); return; }
    var v = j.out.d.days[day];
    if (!v) { Logger.log(lab + ': the report came back without ' + day + '. Days in it: ' + Object.keys(j.out.d.days).join(', ')); return; }
    Logger.log('');
    Logger.log('━━ ' + lab + ' · ' + day + ' (' + ammWeekday_(day) + ') · Seller Central → Business Reports → By Date → Sales and Traffic');
    ammLogBiz_(v, j.out.d.cur);
  });
}

/* ============================== the timer ============================== */

function matchTick() {
  // Our own lease, NOT LockService.getScriptLock(): the nightly run holds that lock while it works, and taking it
  // here would make the two runs skip each other's ticks.
  var props = PropertiesService.getScriptProperties();
  var lease = Number(props.getProperty('MATCH_LEASE') || 0);
  if (lease && Date.now() - lease < 7 * 60000) { Logger.log('matchTick: another run is still going — skipped.'); return; }
  props.setProperty('MATCH_LEASE', String(Date.now()));
  try { ammTick_(); }
  finally { props.deleteProperty('MATCH_LEASE'); }
}

function ammTick_() {
  var t0 = Date.now();
  var left = function () { return MATCH_BUDGET_MS - (Date.now() - t0); };
  var st = ammState_();
  var todayLocal = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));

  if (st.reset || (st.day !== todayLocal && hour >= MATCH_START_HOUR)) {
    st = ammPlan_(st, todayLocal);
    ammSave_(st);
    Logger.log('matchTick: fresh pass, ' + st.jobs.length + ' report(s) to get.');
  }
  if (!st.day || st.phase === 'done') return;

  var biz = null, ads = null, dirtyBiz = false, dirtyAds = false;
  var loadBiz = function () { if (!biz) biz = cacheRead_('matchBiz') || { d: {}, cur: {} }; biz.d = biz.d || {}; biz.cur = biz.cur || {}; return biz; };
  var loadAds = function () { if (!ads) ads = cacheRead_('matchAds') || { d: {} }; ads.d = ads.d || {}; return ads; };
  var bizAsks = 0, got = [];

  try {
    for (var i = 0; i < st.jobs.length && left() > 30000; i++) {
      var j = st.jobs[i];
      if (j.st === 'done' || j.st === 'gave' || j.st === 'skip' || j.st === 'got') continue;
      setBrand_(j.b);
      try {
        if (j.st === 'new') {
          if (j.k === 'biz') {
            if (bizAsks >= MATCH_BIZ_ASKS_PER_TICK) continue;
            bizAsks++;
            j.id = ammBizAsk_(ammAdd_(j.s, -1), ammMin_(ammAdd_(j.e, 1), ammToday_()));
          } else {
            var a = ammAdsAsk_(j.k, j.s, j.e);
            if (a.skip) { j.st = 'skip'; j.m = a.skip; ammSave_(st); continue; }
            j.s = a.s; j.id = a.id;
          }
          j.st = 'asked'; j.t = (j.t || 0) + 1;
          ammSave_(st);
          continue;                       // Amazon needs a few minutes; collect on a later loop or tick
        }
        // asked: see whether it is ready
        if (j.k === 'biz') {
          var s = ammBizStatus_(j.id);
          if (s.dead) { ammRetry_(st, j, 'Amazon could not build it (' + s.status + ')'); continue; }
          if (!s.ready) continue;
          if (left() < 45000) break;
          var fetched = ammBizFetch_(s.doc);
          var B = loadBiz(), into = B.d[j.b] || (B.d[j.b] = {});
          var n = 0;
          Object.keys(fetched.days).forEach(function (day) {
            if (day < j.s || day > j.e) return;             // the padding day each side may be partial
            into[day] = fetched.days[day]; n++;
          });
          if (fetched.cur) B.cur[j.b] = fetched.cur;
          if (!n) { ammRetry_(st, j, 'report came back without the days asked for'); continue; }
          dirtyBiz = true;
        } else {
          var r = ammAdsStatus_(j.id);
          if (r.failed) { ammRetry_(st, j, 'Amazon could not build it: ' + (r.error || r.status)); continue; }
          if (!r.ready) continue;
          if (left() < 45000) break;
          var days = ammAdsFetch_(j.k, r.url);
          var A = loadAds(), intoA = A.d[j.b] || (A.d[j.b] = {});
          // Every day the report covered is REPLACED — including days with no rows, which had no ad activity
          // and are a real zero, not a gap. Only a report that arrived can change a day.
          for (var day = j.s; day <= j.e; day = ammAdd_(day, 1)) {
            var cell = intoA[day] || (intoA[day] = {});
            cell[j.k] = days[day] || ammZero_(j.k);
          }
          dirtyAds = true;
        }
        got.push(j); j.st = 'got';      // becomes 'done' only once the cache write below has succeeded
      } catch (e) {
        var m = String(e.message || e);
        if (/429|quota|throttl|too many/i.test(m)) { ammErr_(st, ammJobName_(j) + ': Amazon asked us to slow down — next tick'); if (j.k === 'biz') bizAsks = MATCH_BIZ_ASKS_PER_TICK; continue; }
        if (j.st === 'new') j.t = (j.t || 0) + 1;      // a refused ask counts as a try too, or it would repeat forever
        ammRetry_(st, j, m.slice(0, 200));
      }
    }
  } finally {
    // Written even if the tick dies part-way, so what was collected is never thrown away. A report counts as collected
    // only once its days are in the sheet: if the write fails, the report is downloaded again next tick.
    var wrote = true;
    try {
      if (dirtyBiz) { biz.at = ammNow_(); biz.v = 1; biz.upTo = ammUpTo_(biz.d); cacheWrite_('matchBiz', biz); }
      if (dirtyAds) { ads.at = ammNow_(); ads.v = 1; cacheWrite_('matchAds', ads); }
    } catch (we) { wrote = false; ammErr_(st, 'could not write the cache sheet: ' + String(we.message || we).slice(0, 160)); }
    got.forEach(function (x) {
      if (wrote) { x.st = 'done'; st.doneN = (st.doneN || 0) + 1; } else x.st = 'asked';
    });
    // Done jobs leave the list (the state must stay under the 9 KB property limit); the count stays.
    st.jobs = st.jobs.filter(function (x) { return x.st !== 'done'; });
    if (!st.jobs.some(function (x) { return x.st === 'new' || x.st === 'asked'; })) {
      ammFinish_(st);
    }
    ammSave_(st);
  }
}

/** Build tonight's list of reports. */
function ammPlan_(old, todayLocal) {
  var today = ammToday_(), yest = ammAdd_(today, -1);
  var filled = old.filled || {};
  var jobs = [];
  MATCH_BRANDS.forEach(function (b) {
    // Business Reports: up to today (today and the last 2-3 days are estimates; the screen will say so).
    var bizFrom = filled[b + '|biz'] ? ammAdd_(today, -(MATCH_BIZ_REFRESH - 1)) : ammAdd_(today, -MATCH_BIZ_BACK);
    var bizSlice = filled[b + '|biz'] ? MATCH_BIZ_REFRESH : MATCH_BIZ_SLICE;
    ammSlices_(bizFrom, today, bizSlice).forEach(function (r) {
      jobs.push({ k: 'biz', b: b, s: r[0], e: r[1], st: 'new', fill: filled[b + '|biz'] ? 0 : 1 });
    });
    // Ads: up to yesterday, newest slice first so the recent days arrive soonest.
    ['sp', 'sb', 'sd'].forEach(function (k) {
      var back = filled[b + '|' + k] ? MATCH_ADS_REFRESH : MATCH_ADS_BACK;
      ammSlices_(ammAdd_(yest, -(back - 1)), yest, MATCH_ADS_SLICE).reverse().forEach(function (r) {
        jobs.push({ k: k, b: b, s: r[0], e: r[1], st: 'new', fill: filled[b + '|' + k] ? 0 : 1 });
      });
    });
  });
  return { day: todayLocal, phase: 'run', startedAt: ammNow_(), jobs: jobs, doneN: 0,
           filled: filled, errors: [], plannedFill: jobs.some(function (j) { return j.fill; }) };
}

function ammFinish_(st) {
  // A type is "filled" once a first-fill pass for it ends with nothing given up. Until then the next pass fills again.
  var gaveBy = {};
  (st.jobs || []).forEach(function (j) { if (j.st === 'gave') gaveBy[j.b + '|' + j.k] = 1; });
  st.filled = st.filled || {};
  MATCH_BRANDS.forEach(function (b) {
    MATCH_KINDS.forEach(function (k) { if (!gaveBy[b + '|' + k]) st.filled[b + '|' + k] = 1; });
  });
  if (st.phase !== 'done') {
    st.phase = 'done'; st.doneAt = ammNow_(); st.reset = false;
    var gave = (st.jobs || []).filter(function (j) { return j.st === 'gave'; });
    if (gave.length && typeof jobAlert_ === 'function') {
      jobAlert_('AmazonMatch', gave.length + ' report(s) could not be collected after ' + MATCH_TRIES + ' tries; the old figures were kept.\n'
        + gave.map(function (j) { return ammJobName_(j) + ' :: ' + (j.m || '?'); }).join('\n'));
    }
  }
}

function ammRetry_(st, j, msg) {
  ammErr_(st, ammJobName_(j) + ': ' + msg);
  if ((j.t || 0) >= MATCH_TRIES) { j.st = 'gave'; j.m = String(msg).slice(0, 160); }
  else { j.st = 'new'; j.id = ''; }
  ammSave_(st);
}

/* ============================== Seller Central: Business Reports by date ============================== */

function ammBizAsk_(s, e) {
  var body = {
    reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
    marketplaceIds: [marketplaceId_()],
    // The range is padded by a day each side by the caller and the padding is thrown away, so the result is the same
    // whether Amazon reads these times in UTC or ignores them and uses the marketplace's own days.
    dataStartTime: s + 'T00:00:00Z',
    dataEndTime: e + 'T23:59:59Z',
    reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
  };
  var r = sp_('/reports/2021-06-30/reports', 'post', body);
  if (!r.reportId) throw new Error('Amazon accepted the request but returned no reportId.');
  return r.reportId;
}

function ammBizStatus_(id) {
  var r = sp_('/reports/2021-06-30/reports/' + encodeURIComponent(id));
  var s = r.processingStatus || '';
  return { status: s, ready: s === 'DONE', doc: r.reportDocumentId || '', dead: s === 'FATAL' || s === 'CANCELLED' };
}

/** → { cur: 'USD', days: { 'yyyy-MM-dd': [ops, units, orderItems, sessions, pageViews, opsB2B, unitsB2B, itemsB2B] } } */
function ammBizFetch_(docId) {
  var d = sp_('/reports/2021-06-30/documents/' + encodeURIComponent(docId));
  if (!d.url) throw new Error('Report document carries no download url.');
  var resp = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');
  var text = String(d.compressionAlgorithm || '').toUpperCase() === 'GZIP'
    ? Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString()
    : resp.getContentText();
  var j = JSON.parse(text || '{}');
  var rows = j.salesAndTrafficByDate || [];
  var out = {}, cur = '';
  var money = function (o) { return ammR2_(Number((o || {}).amount) || 0); };
  rows.forEach(function (x) {
    var day = String(x.date || '').slice(0, 10); if (!day) return;
    var s = x.salesByDate || {}, t = x.trafficByDate || {};
    if (!cur && s.orderedProductSales && s.orderedProductSales.currencyCode) cur = s.orderedProductSales.currencyCode;
    out[day] = [
      money(s.orderedProductSales), Number(s.unitsOrdered) || 0, Number(s.totalOrderItems) || 0,
      Number(t.sessions) || 0, Number(t.pageViews) || 0,
      money(s.orderedProductSalesB2B), Number(s.unitsOrderedB2B) || 0, Number(s.totalOrderItemsB2B) || 0,
    ];
  });
  return { cur: cur, days: out };
}

/* ============================== Ads console: SP, SB, SD campaign reports ============================== */

var AMM_ADS_CFG = {
  sp: { adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spCampaigns',
        columns: ['date', 'campaignId', 'impressions', 'clicks', 'cost', 'spend',
                  'sales7d', 'purchases7d', 'sales14d', 'purchases14d', 'sales30d', 'purchases30d'] },
  sb: { adProduct: 'SPONSORED_BRANDS', reportTypeId: 'sbCampaigns',
        columns: ['date', 'campaignId', 'costType', 'impressions', 'clicks', 'cost',
                  'sales', 'purchases', 'salesClicks', 'purchasesClicks'] },
  sd: { adProduct: 'SPONSORED_DISPLAY', reportTypeId: 'sdCampaigns',
        columns: ['date', 'campaignId', 'costType', 'impressions', 'clicks', 'cost',
                  'sales', 'purchases', 'salesClicks', 'purchasesClicks'] },
};

/** Ask for one report. Moves the start forward if Amazon says it no longer keeps that far back. */
function ammAdsAsk_(kind, s, e) {
  var cfg = AMM_ADS_CFG[kind];
  for (var attempt = 0; attempt < 2; attempt++) {
    var body = {
      name: 'amm-' + kind + '-' + ACTIVE_PREFIX + '-' + s + '-to-' + e,
      startDate: s, endDate: e,
      configuration: {
        adProduct: cfg.adProduct, groupBy: ['campaign'], columns: cfg.columns,
        reportTypeId: cfg.reportTypeId, timeUnit: 'DAILY', format: 'GZIP_JSON',
      },
    };
    try {
      var r = adsCall_('/reporting/reports', 'post', body, adsProfileId_(), ADS_REPORT_MIME);
      if (!r.reportId) throw new Error('Amazon accepted the request but returned no reportId.');
      return { id: r.reportId, s: s };
    } catch (err) {
      var m = String(err.message || err);
      // The same report already asked for (a restarted pass): Amazon names the one it already has.
      var dup = m.match(/duplicate of\s*:?\s*([0-9a-fA-F-]{16,})/);
      if (dup) return { id: dup[1], s: s };
      // "startDate (…) must be equal to or after report type data retention start date (2026-05-16)"
      var ret = m.match(/retention start date\s*\(?\s*(\d{4}-\d{2}-\d{2})/i);
      if (ret && attempt === 0) {
        if (ret[1] > e) return { skip: 'older than Amazon keeps (' + ret[1] + ')' };
        s = ret[1];
        continue;
      }
      // Refused over the dates but without naming one: fall back to 60 days, what Brands and Display are known to keep.
      var floor = ammAdd_(ammToday_(), -59);
      if (attempt === 0 && s < floor && /retention|start ?date|date range|too (old|far)/i.test(m)) {
        if (floor > e) return { skip: 'older than Amazon keeps (about 60 days)' };
        s = floor;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Amazon refused the date range twice.');
}

function ammAdsStatus_(id) {
  var r = adsCall_('/reporting/reports/' + encodeURIComponent(id), 'get', null, adsProfileId_(), ADS_REPORT_MIME);
  var s = String(r.status || '');
  return { status: s, ready: s === 'COMPLETED' && !!r.url, url: r.url || '', failed: /FAIL|CANCEL/i.test(s), error: r.failureReason || '' };
}

/** → { day: [...] } summed over campaigns. Shapes are described at the top of the file. */
function ammAdsFetch_(kind, url) {
  // A presigned S3 link, not an Ads API endpoint: fetched plain, with no auth headers.
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');
  var text;
  try { text = Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString(); }
  catch (e) { text = resp.getContentText(); }
  var rows = JSON.parse(text || '[]') || [];
  var out = {}, N = function (v) { return Number(v) || 0; };
  rows.forEach(function (x) {
    var day = String(x.date || '').slice(0, 10); if (!day) return;
    var c = out[day] || (out[day] = ammZero_(kind));
    c[0] += N(x.impressions); c[1] += N(x.clicks); c[2] += N(x.cost);
    if (kind === 'sp') {
      c[3] += N(x.sales7d); c[4] += N(x.purchases7d); c[5] += N(x.sales14d); c[6] += N(x.purchases14d);
      c[7] += N(x.sales30d); c[8] += N(x.purchases30d); c[9] += N(x.spend);
    } else {
      var vcpm = /vcpm/i.test(String(x.costType || ''));
      var sAll = N(x.sales), oAll = N(x.purchases), sClk = N(x.salesClicks), oClk = N(x.purchasesClicks);
      c[3] += vcpm ? sAll : sClk; c[4] += vcpm ? oAll : oClk;      // the console's rule
      c[5] += sAll; c[6] += oAll; c[7] += sClk; c[8] += oClk;
    }
  });
  Object.keys(out).forEach(function (d) {
    out[d] = out[d].map(function (v, i) { return ammMoneyIx_(kind, i) ? ammR2_(v) : v; });
  });
  return out;
}

function ammZero_(kind) { return kind === 'sp' ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0]; }
function ammMoneyIx_(kind, i) { return kind === 'sp' ? (i === 2 || i === 3 || i === 5 || i === 7 || i === 9) : (i === 2 || i === 3 || i === 5 || i === 7); }

/* ============================== printing ============================== */

function ammPrintDay_(day, biz, ads) {
  Logger.log('');
  MATCH_BRANDS.forEach(function (b) {
    var lab = MATCH_BRAND_LABEL[b];
    Logger.log('━━ ' + lab + ' · ' + day + ' (' + ammWeekday_(day) + ')' + (ammAdd_(ammToday_(), -3) < day ? '  ⚠ under 3 days old: Amazon is still changing it' : ''));
    var v = biz && biz.d && biz.d[b] && biz.d[b][day];
    Logger.log('Seller Central → Business Reports → By Date → Sales and Traffic');
    if (v) ammLogBiz_(v, biz.cur && biz.cur[b]); else Logger.log('   not in the cache yet');
    var a = (ads && ads.d && ads.d[b] && ads.d[b][day]) || null;
    Logger.log('Ads console → Campaign manager (that day only)');
    if (!a) { Logger.log('   not in the cache yet'); return; }
    var tot = [0, 0, 0], totAll = [0, 0, 0], any = false;
    ['sp', 'sb', 'sd'].forEach(function (k) {
      var c = a[k];
      if (!c) { Logger.log('   ' + ammPad_(ammKindName_(k), 20) + 'not collected yet'); return; }
      any = true;
      var spend = c[2], sales = c[3], orders = c[4], salesAll = k === 'sp' ? c[3] : c[5], ordersAll = k === 'sp' ? c[4] : c[6];
      tot[0] += spend; tot[1] += sales; tot[2] += orders; totAll[0] += spend; totAll[1] += salesAll; totAll[2] += ordersAll;
      var line = '   ' + ammPad_(ammKindName_(k), 20) + 'Spend ' + ammMoney_(spend) + ' · Sales ' + ammMoney_(sales) + ' · Orders ' + orders;
      if (k === 'sp') {
        if (Math.abs(c[9] - c[2]) >= 0.005) line += '   (other spend column: ' + ammMoney_(c[9]) + ')';
        line += '   [30-day sales ' + ammMoney_(c[7]) + ', the old Sellora figure]';
      } else if (Math.abs(salesAll - sales) >= 0.005 || ordersAll !== orders) {
        line += '   (if it does not match, try: Sales ' + ammMoney_(salesAll) + ' · Orders ' + ordersAll + ')';
      }
      Logger.log(line);
    });
    if (any) {
      var t = '   ' + ammPad_('All campaigns', 20) + 'Spend ' + ammMoney_(tot[0]) + ' · Sales ' + ammMoney_(tot[1]) + ' · Orders ' + tot[2];
      if (Math.abs(totAll[1] - tot[1]) >= 0.005) t += '   (or Sales ' + ammMoney_(totAll[1]) + ' · Orders ' + totAll[2] + ')';
      Logger.log(t);
      if (tot[0] > 0) Logger.log('   ' + ammPad_('ACoS', 20) + (Math.round(tot[0] / Math.max(tot[1], 0.01) * 10000) / 100) + '%');
    }
  });
}

function ammLogBiz_(v, cur) {
  Logger.log('   Ordered Product Sales  ' + ammMoney_(v[0]) + (cur ? ' ' + cur : ''));
  Logger.log('   Units Ordered          ' + v[1]);
  Logger.log('   Total Order Items      ' + v[2]);
  Logger.log('   Sessions – Total       ' + v[3]);
  Logger.log('   (Page Views – Total ' + v[4] + ' · of which B2B: sales ' + ammMoney_(v[5]) + ', units ' + v[6] + ', order items ' + v[7] + ')');
}

/* ============================== small helpers ============================== */

function ammState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('MATCH_STATE') || '{}'); }
  catch (e) { return {}; }
}
function ammSave_(st) {
  var s = JSON.stringify(st);
  // Script Properties hold 9 KB per value. Errors are the only part that can grow, so they give way first.
  while (s.length > 8800 && st.errors && st.errors.length) { st.errors.shift(); s = JSON.stringify(st); }
  PropertiesService.getScriptProperties().setProperty('MATCH_STATE', s);
}
function ammErr_(st, msg) {
  st.errors = st.errors || [];
  st.errors.push('[' + ammNow_() + '] ' + String(msg).slice(0, 180));
  if (st.errors.length > 8) st.errors = st.errors.slice(-8);
}
function ammNow_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
/** Today as Amazon US reckons it: the Pacific date. */
function ammToday_() { return Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd'); }
/** Date arithmetic on plain yyyy-MM-dd strings, at UTC noon so no time zone can move the day. */
function ammAdd_(iso, n) { return Utilities.formatDate(new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000), 'UTC', 'yyyy-MM-dd'); }
function ammMin_(a, b) { return a < b ? a : b; }
function ammWeekday_(iso) { return Utilities.formatDate(new Date(Date.parse(iso + 'T12:00:00Z')), 'UTC', 'EEE'); }
/** [from, to] inclusive, cut into slices of at most `size` days, oldest first. */
function ammSlices_(from, to, size) {
  var out = [];
  for (var s = from; s <= to; s = ammAdd_(s, size)) {
    var e = ammAdd_(s, size - 1);
    out.push([s, e > to ? to : e]);
  }
  return out;
}
function ammR2_(v) { return Math.round(v * 100) / 100; }
function ammMoney_(v) { return (Number(v) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function ammPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function ammKindName_(k) { return { biz: 'Seller Central', sp: 'Sponsored Products', sb: 'Sponsored Brands', sd: 'Sponsored Display' }[k] || k; }
function ammJobName_(j) { return MATCH_BRAND_LABEL[j.b] + ' ' + ammKindName_(j.k) + ' ' + j.s + '…' + j.e + (j.t ? ' (try ' + j.t + ')' : ''); }
function ammSpan_(days) {
  if (!days.length) return 'nothing yet';
  days = days.slice().sort();
  return days[0] + ' → ' + days[days.length - 1] + '  (' + days.length + ' days)';
}
/** Days missing in the last 60, which is where a silent gap would hurt. */
function ammGaps_(days) {
  if (!days.length) return '';
  var have = {}; days.forEach(function (d) { have[d] = 1; });
  var yest = ammAdd_(ammToday_(), -1), first = days.slice().sort()[0], miss = [];
  for (var d = ammAdd_(yest, -59); d <= yest; d = ammAdd_(d, 1)) if (d >= first && !have[d]) miss.push(d);
  return miss.length ? '  ⚠ missing ' + miss.length + ' day(s): ' + miss.slice(0, 5).join(', ') + (miss.length > 5 ? '…' : '') : '';
}
function ammUpTo_(d) {
  var out = {};
  Object.keys(d || {}).forEach(function (b) { var k = Object.keys(d[b] || {}).sort(); out[b] = k.length ? k[k.length - 1] : ''; });
  return out;
}
