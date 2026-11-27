/* Pricing-API / V2Test.gs (was OrdersTest.gs; calls the V2 functions in V2Orders / V2Ads / V2Merge) — editor-only checks for orders per ASIN and ad units (ORDERS_V2).
 * Added 2026-10-30. Nothing here is called by the nightly run or by doGet/doPost.
 *
 * WRITES ONLY caches named `test_…` and scratch tabs `_t_…`. It never writes a real cache and never
 * touches NIGHTLY_STATE. ordersTestClean() removes everything it made.
 *
 * Order of use (afternoon, after nightlyStatus says the pass is done):
 *   ordersTestStart()  →  ordersTestTick() until it says DONE  →  ordersTestCheck()
 *   adsUnitsTestAsk()  →  wait 15–20 min  →  adsUnitsTestGet() until it says DONE
 *   ordersTestClean()  once the results have been looked at
 * After ORDERS_V2 is switched on, ordersV2NightlyCheck() checks what the real nightly wrote.
 */
var OT_KEY = 'ORDERS_TEST';
var AT_KEY = 'ADS_UNITS_TEST';
var OT_SETTLED_DAYS = 7;   // newer days can differ from last night's cache: orders arrive and get cancelled

function otGet_(k) { try { return JSON.parse(nProp_(k) || '{}'); } catch (e) { return {}; } }
function otPut_(k, v) { nSet_(k, JSON.stringify(v)); }

/** The phase a nightly pass is still in, or '' when it has finished. The tests share its workbooks. */
function otNightlyBusy_() {
  var st = nState_();
  // 'sess' (sessions and page views, SP-API only) comes after every phase that writes the orders and ad
  // caches and can run for hours; it neither reads nor writes what this test uses, so it is not "busy".
  return st.day && st.phase && st.phase !== 'done' && st.phase !== 'sess' ? st.phase : '';
}

/** yyyy-MM-dd that many days before the day `stamp` (a nowStamp_ string) was written. */
function otCut_(stamp, days) {
  var d = String(stamp || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  return Utilities.formatDate(new Date(Date.parse(d + 'T00:00:00Z') - days * 86400000), 'UTC', 'yyyy-MM-dd');
}

function otKb_(obj) { return Math.round(JSON.stringify(obj || {}).length / 1024); }

/* ===================== 1. Orders per ASIN ===================== */

function ordersTestStart() {
  var busy = otNightlyBusy_();
  if (busy) { Logger.log('The nightly pass is still running (phase ' + busy + '). Try again once nightlyStatus() says done.'); return; }
  accClear_('t_weekly'); accClear_('t_dayAsin');
  otPut_(OT_KEY, { book: 0, row: 2, ticks: 0, slices: 0, slowMs: 0, totalMs: 0, started: nowStamp_() });
  Logger.log('Test cursor reset. Now run ordersTestTick() — again and again — until it says DONE.');
}

/**
 * Reads the Orders workbooks exactly as the nightly weekly phase does, with orders ON, into the test
 * scratch tabs. Holds the same script lock as nightlyTick, so the two can never run at the same time.
 */
function ordersTestTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { Logger.log('A nightly tick is running right now — try again in a few minutes.'); return; }
  try {
    var busy = otNightlyBusy_();
    if (busy) { Logger.log('The nightly pass is still running (phase ' + busy + '). Not testing now.'); return; }
    var s = otGet_(OT_KEY);
    if (s.book == null) { Logger.log('Run ordersTestStart() first.'); return; }
    if (s.done) { Logger.log('Already DONE at ' + s.finished + '. Run ordersTestCheck().'); return; }
    var t0 = Date.now();
    s.ticks++;
    while (Date.now() - t0 < NIGHTLY_BUDGET_MS - 20000) {
      var c0 = Date.now();
      var r = weeklySalesChunkV2_(s.book, s.row, NIGHTLY_ROWS, 26, true);
      if (!r.ok) { otPut_(OT_KEY, s); Logger.log('Stopped: ' + r.error); return; }
      var brand = s.book === 0 ? 'SP' : 'CPC', k = 'weekly|' + s.book + '|' + s.row;
      accAppend_('t_weekly', { k: k, brand: brand, d: r.asins || {} });
      if (r.asinDays && Object.keys(r.asinDays).length) accAppend_('t_dayAsin', { k: k, brand: brand, d: r.asinDays });
      var ms = Date.now() - c0;
      s.slices++; s.totalMs += ms; s.slowMs = Math.max(s.slowMs, ms);
      if (!r.done && r.next) s.row = r.next;
      else { s.book++; s.row = 2; }
      otPut_(OT_KEY, s);
      if (s.book >= (r.books || ORDERS_DATA_IDS.length)) {
        cacheWrite_('test_weekly', { at: nowStamp_(), rows: nMergeWeeklyV2_('t_weekly') });
        cacheWrite_('test_dailyAsin', { at: nowStamp_(), from: dayWindowFrom_(), d: nMergeDayAsinV2_('t_dayAsin') });
        accClear_('t_weekly'); accClear_('t_dayAsin');
        s.done = true; s.finished = nowStamp_();
        otPut_(OT_KEY, s);
        Logger.log('DONE. ' + s.slices + ' slices in ' + s.ticks + ' run(s). Now run ordersTestCheck().');
        return;
      }
    }
    Logger.log('Not finished yet — book ' + s.book + ', row ' + s.row + '. Run ordersTestTick() again.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Test caches against the real ones. Units and sales must be identical on SETTLED weeks/days (older
 * than OT_SETTLED_DAYS before last night's run); newer ones are listed, not failed.
 */
function ordersTestCheck() {
  var s = otGet_(OT_KEY);
  var test = cacheRead_('test_weekly'), testD = cacheRead_('test_dailyAsin');
  var real = cacheRead_('weekly'), realD = cacheRead_('dailyAsin'), daily = cacheRead_('daily');
  if (!test || !testD) { Logger.log('No test caches yet — run ordersTestStart() and ordersTestTick() first.'); return; }
  var cut = otCut_(real && real.at, OT_SETTLED_DAYS);
  var fails = 0;
  Logger.log('Real weekly cache written ' + ((real && real.at) || 'never') + '  ·  settled = before ' + cut);

  var cmp = function (label, R, T, settled) {
    var cells = 0, diff = [], recent = 0, noOrd = 0, oGtU = [], uNoO = [], orders = 0, units = 0;
    ['SP', 'CPC'].forEach(function (b) {
      var Rb = (R || {})[b] || {}, Tb = (T || {})[b] || {}, asins = {};
      Object.keys(Rb).forEach(function (a) { asins[a] = 1; });
      Object.keys(Tb).forEach(function (a) { asins[a] = 1; });
      Object.keys(asins).forEach(function (a) {
        var ks = {};
        Object.keys(Rb[a] || {}).forEach(function (k) { ks[k] = 1; });
        Object.keys(Tb[a] || {}).forEach(function (k) { ks[k] = 1; });
        Object.keys(ks).forEach(function (k) {
          var r = (Rb[a] || {})[k] || [0, 0], t = (Tb[a] || {})[k] || [0, 0];
          cells++;
          var same = (r[0] || 0) === (t[0] || 0) && Math.abs((r[1] || 0) - (t[1] || 0)) < 0.011;
          if (!same) {
            if (settled(k)) diff.push(b + ' ' + a + ' ' + k + '  real ' + r[0] + ' / ' + r[1] + '  test ' + t[0] + ' / ' + t[1]);
            else recent++;
          }
          if (t[2] == null) { if (t[0]) noOrd++; return; }
          orders += t[2]; units += t[0] || 0;
          if (t[2] > (t[0] || 0)) oGtU.push(b + ' ' + a + ' ' + k + '  orders ' + t[2] + ' > units ' + t[0]);
          if ((t[0] || 0) > 0 && t[2] < 1) uNoO.push(b + ' ' + a + ' ' + k + '  units ' + t[0] + ' but 0 orders');
        });
      });
    });
    Logger.log('');
    Logger.log('== ' + label + ' ==  ' + cells + ' cells  ·  test orders ' + orders + '  ·  test units ' + units);
    Logger.log((diff.length ? 'FAIL ' : 'OK   ') + 'units & sales identical on settled cells  (' + diff.length + ' differ)');
    diff.slice(0, 15).forEach(function (x) { Logger.log('       ' + x); });
    Logger.log('     ' + recent + ' recent cell(s) differ — expected, orders arrived/cancelled since last night');
    Logger.log((oGtU.length ? 'INFO ' : 'OK   ') + 'orders <= units  (' + oGtU.length + ' break it)');
    oGtU.slice(0, 10).forEach(function (x) { Logger.log('       ' + x); });
    Logger.log((uNoO.length ? 'FAIL ' : 'OK   ') + 'units > 0 has at least 1 order  (' + uNoO.length + ' break it)');
    uNoO.slice(0, 10).forEach(function (x) { Logger.log('       ' + x); });
    Logger.log((noOrd ? 'FAIL ' : 'OK   ') + 'every cell with units carries an order count  (' + noOrd + ' missing)');
    fails += diff.length + uNoO.length + noOrd;
  };
  cmp('WEEKLY (per ASIN per week)', real && real.rows, test.rows, function (wk) {
    return Utilities.formatDate(new Date(Date.parse(wk + 'T00:00:00Z') + 6 * 86400000), 'UTC', 'yyyy-MM-dd') < cut;
  });
  cmp('DAILY (per ASIN per day)', realD && realD.d, testD.d, function (day) { return day < cut && day >= (testD.from || ''); });

  // The account rule: adding ASIN orders can only ever be >= the UNIQUE count, never below it.
  Logger.log('');
  Logger.log('== ASIN orders added up vs UNIQUE orders (daily cache), settled days ==');
  var below = 0, shown = 0;
  ['SP', 'CPC'].forEach(function (b) {
    var sum = {};
    Object.keys((testD.d || {})[b] || {}).forEach(function (a) {
      var byDay = testD.d[b][a];
      Object.keys(byDay).forEach(function (d) { sum[d] = (sum[d] || 0) + (byDay[d][2] || 0); });
    });
    var uq = ((daily && daily.d) || {})[b] || {};
    Object.keys(sum).sort().forEach(function (d) {
      if (d >= cut || !uq[d]) return;
      var u = uq[d][2] || 0;
      if (sum[d] < u) below++;
      if (shown < 8 || sum[d] < u) { Logger.log('  ' + b + ' ' + d + '  ASIN orders ' + sum[d] + '  ·  unique ' + u + (sum[d] < u ? '  <-- BELOW' : '')); shown++; }
    });
  });
  Logger.log((below ? 'FAIL ' : 'OK   ') + 'added-up ASIN orders never below unique orders  (' + below + ' day(s) below)');
  fails += below;

  Logger.log('');
  Logger.log('== size and time ==');
  var kw = otKb_(test), kd = otKb_(testD);
  Logger.log('test_weekly ' + kw + ' KB (real ' + otKb_(real) + ' KB)  ·  test_dailyAsin ' + kd + ' KB (real ' + otKb_(realD) + ' KB)');
  Logger.log('(each cache is stored in 40 KB cells; the browser pulls it whole — 1 MB = 1024 KB)');
  if (s.slices) {
    Logger.log('slices ' + s.slices + '  ·  slowest ' + Math.round(s.slowMs / 1000) + ' s  ·  average '
      + Math.round(s.totalMs / s.slices / 1000) + ' s  ·  one nightly tick allows ' + Math.round(NIGHTLY_BUDGET_MS / 1000) + ' s');
    if (s.slowMs > NIGHTLY_BUDGET_MS - 20000) { Logger.log('FAIL a single slice is longer than one tick'); fails++; }
  }
  Logger.log('');
  Logger.log(fails ? 'RESULT: ' + fails + ' problem(s) — do NOT switch ORDERS_V2 on.' : 'RESULT: all checks passed.');
}

/* ===================== 2. Ad units ===================== */

/** Asks ONE 31-day report per brand with ad units. Run once; do not repeat — Amazon rate-limits asks. */
function adsUnitsTestAsk() {
  var busy = otNightlyBusy_();
  if (busy) { Logger.log('The nightly pass is still running (phase ' + busy + '). Try again once it is done.'); return; }
  var old = otGet_(AT_KEY);
  if (old.jobs && old.jobs.length && !old.done) { Logger.log('Reports were already asked for at ' + old.asked + ' — run adsUnitsTestGet().'); return; }
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var end = new Date(Date.now() - 86400000), start = new Date(end.getTime() - 30 * 86400000);
  var jobs = [];
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    var c = ppcCreateRangeV2_(iso(start), iso(end));
    Logger.log(b + ': ' + (c.ok ? 'asked, report ' + c.reportId : 'FAILED ' + c.error));
    if (c.ok && c.reportId) jobs.push({ brand: b, id: c.reportId, start: iso(start), end: iso(end) });
  });
  otPut_(AT_KEY, { jobs: jobs, asked: nowStamp_(), got: {} });
  Logger.log('Amazon takes 10–20 minutes. Then run adsUnitsTestGet().');
}

function adsUnitsTestGet() {
  var s = otGet_(AT_KEY);
  if (!s.jobs || !s.jobs.length) { Logger.log('Run adsUnitsTestAsk() first.'); return; }
  var out = {};
  var waiting = 0;
  s.jobs.forEach(function (j) {
    setBrand_(j.brand);
    var st = ppcStatus_(j.id);
    if (!st.ready) { waiting++; Logger.log(j.brand + ': still ' + (st.status || '?') + (st.error ? ' ' + st.error : '')); return; }
    var d = ppcFetchV2_(j.id, 'both');
    out[j.brand] = d.asinDays || {};
  });
  if (waiting) { Logger.log('Not all reports are ready — run adsUnitsTestGet() again in a few minutes.'); return; }
  cacheWrite_('test_adsAsinDay', { at: nowStamp_(), d: out });
  s.done = true; otPut_(AT_KEY, s);
  Logger.log('DONE — written to test_adsAsinDay. Checking…');
  adsUnitsTestCheck();
}

function adsUnitsTestCheck() {
  var test = cacheRead_('test_adsAsinDay'), real = cacheRead_('adsAsinDay');
  var units = cacheRead_('test_dailyAsin') || cacheRead_('dailyAsin');
  if (!test) { Logger.log('No test_adsAsinDay yet.'); return; }
  var cut = otCut_(real && real.at, 3);       // spend/clicks settle in ~3 days; ad orders/sales take up to 30
  var fails = 0, cells = 0, six = 0, sameSpend = 0, diffSpend = [], adU = 0;
  var dayU = {}, dayAdU = {}, asinOver = 0, asinOverEx = [];
  ['SP', 'CPC'].forEach(function (b) {
    var T = (test.d || {})[b] || {}, R = ((real && real.d) || {})[b] || {}, U = ((units && units.d) || {})[b] || {};
    Object.keys(T).forEach(function (a) {
      Object.keys(T[a]).forEach(function (day) {
        var t = T[a][day], r = (R[a] || {})[day];
        cells++;
        if (t.length >= 6) { six++; adU += t[5]; }
        if (r && day < cut) {
          if (r[1] === t[1] && Math.abs(r[2] - t[2]) < 0.011) sameSpend++;
          else diffSpend.push(b + ' ' + a + ' ' + day + '  real clicks/spend ' + r[1] + '/' + r[2] + '  test ' + t[1] + '/' + t[2]);
        }
        var key = b + '|' + day;
        dayAdU[key] = (dayAdU[key] || 0) + (t[5] || 0);
        var u = ((U[a] || {})[day] || [0])[0] || 0;
        if ((t[5] || 0) > u) { asinOver++; if (asinOverEx.length < 8) asinOverEx.push(b + ' ' + a + ' ' + day + '  ad units ' + t[5] + ' > units ' + u); }
      });
    });
    Object.keys(U).forEach(function (a) {
      Object.keys(U[a]).forEach(function (day) { var key = b + '|' + day; dayU[key] = (dayU[key] || 0) + (U[a][day][0] || 0); });
    });
  });
  Logger.log('== AD UNITS ==  ' + cells + ' ASIN-days  ·  total ad units ' + adU);
  Logger.log((six === cells ? 'OK   ' : 'FAIL ') + 'every cell has the 6th number (ad units)  (' + six + ' of ' + cells + ')');
  if (six !== cells) fails++;
  Logger.log((diffSpend.length ? 'WARN ' : 'OK   ') + 'old numbers unchanged: clicks & spend match the real cache on settled days  ('
    + sameSpend + ' match, ' + diffSpend.length + ' differ)');
  diffSpend.slice(0, 10).forEach(function (x) { Logger.log('       ' + x); });
  var acctOver = 0;
  Object.keys(dayAdU).sort().forEach(function (k) {
    if (dayU[k] == null) return;
    if (dayAdU[k] > dayU[k]) { acctOver++; Logger.log('       ' + k + '  ad units ' + dayAdU[k] + ' > units ' + dayU[k]); }
  });
  Logger.log((acctOver ? 'FAIL ' : 'OK   ') + 'account: ad units <= units every day, so organic units >= 0  (' + acctOver + ' day(s) break it)');
  fails += acctOver;
  Logger.log('INFO ' + asinOver + ' child-ASIN day(s) have ad units > own units — expected: Amazon counts other sizes bought after the click');
  asinOverEx.forEach(function (x) { Logger.log('       ' + x); });
  Logger.log('size test_adsAsinDay ' + otKb_(test) + ' KB (real adsAsinDay ' + otKb_(real) + ' KB)');
  Logger.log(fails ? 'RESULT: ' + fails + ' problem(s).' : 'RESULT: all checks passed.');
}

/* ===================== 3. Clean up ===================== */

/** Deletes every test_ cache, every _t_ scratch tab and the test cursors. Real caches are not touched. */
function ordersTestClean() {
  var ss = cacheSheet_();
  ['test_weekly', 'test_dailyAsin', 'test_adsAsinDay', '_t_weekly', '_t_dayAsin'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh) { ss.deleteSheet(sh); Logger.log('deleted ' + n); }
  });
  PropertiesService.getScriptProperties().deleteProperty(OT_KEY);
  PropertiesService.getScriptProperties().deleteProperty(AT_KEY);
  Logger.log('Test sheets and cursors removed. Real caches untouched.');
}

/* ===================== 4. After switching on: check the REAL nightly ===================== */

/**
 * Reads what the real nightly wrote and says whether the new numbers are there and sane.
 * Run the morning after ORDERS_V2 is set to 1 (after nightlyStatus says done).
 */
function ordersV2NightlyCheck() {
  var st = nState_();
  Logger.log('nightly pass ' + (st.day || '?') + '  ·  phase ' + (st.phase || '?') + '  ·  finished ' + (st.finishedAt || 'not yet')
    + '  ·  orders v2 this pass ' + (st.v2 ? 'ON' : 'off'));
  if (st.lastError) Logger.log('last error [' + (st.lastErrorAt || '?') + '] ' + st.lastError);
  var fails = 0;
  var look = function (name, rowsKey, pos, label) {
    var c = cacheRead_(name);
    if (!c) { Logger.log('FAIL ' + name + ': empty'); fails++; return; }
    var src = c[rowsKey] || {}, cells = 0, has = 0, bad = 0;
    Object.keys(src).forEach(function (b) {
      Object.keys(src[b] || {}).forEach(function (a) {
        Object.keys(src[b][a] || {}).forEach(function (k) {
          var v = src[b][a][k]; cells++;
          if (v.length > pos) { has++; if (pos === 2 && v[2] > v[0]) bad++; }
        });
      });
    });
    var ok = has === cells && !bad;
    if (!ok) fails++;
    Logger.log((ok ? 'OK   ' : 'FAIL ') + name + ' (' + (c.at || '?') + ', ' + otKb_(c) + ' KB): ' + label + ' on ' + has + ' of ' + cells
      + (pos === 2 ? '  ·  orders > units on ' + bad : ''));
  };
  look('weekly', 'rows', 2, 'orders');
  look('dailyAsin', 'd', 2, 'orders');
  look('adsAsin', 'd', 5, 'ad units');
  look('adsAsinDay', 'd', 5, 'ad units');
  Logger.log(fails ? 'RESULT: ' + fails + ' problem(s) — set ORDERS_V2 back to 0 if anything looks wrong.' : 'RESULT: the nightly wrote the new numbers correctly.');
}
/** Finishes a Tick that read both workbooks but timed out writing the test caches. Safe to run again. */
function ordersTestFinish() {
  var s = otGet_(OT_KEY);
  if (s.book == null) { Logger.log('Run ordersTestStart() first.'); return; }
  if (s.done) { Logger.log('Already DONE at ' + s.finished + '. Run ordersTestCheck().'); return; }
  if (s.book < ORDERS_DATA_IDS.length) { Logger.log('Not all workbooks are read yet (book ' + s.book + ') - run ordersTestTick().'); return; }
  var ss = cacheSheet_();
  if (!ss.getSheetByName('_t_weekly') || !ss.getSheetByName('_t_dayAsin')) {
    Logger.log('The scratch tabs are gone - run ordersTestStart() and ordersTestTick() again.'); return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { Logger.log('A nightly tick is running right now - try again in a few minutes.'); return; }
  try {
    var w = nMergeWeeklyV2_('t_weekly'), d = nMergeDayAsinV2_('t_dayAsin');
    cacheWrite_('test_weekly', { at: nowStamp_(), rows: w });
    cacheWrite_('test_dailyAsin', { at: nowStamp_(), from: dayWindowFrom_(), d: d });
    accClear_('t_weekly'); accClear_('t_dayAsin');
    s.done = true; s.finished = nowStamp_(); otPut_(OT_KEY, s);
    Logger.log('DONE. Now run ordersTestCheck().');
  } finally {
    lock.releaseLock();
  }
}
/** Shows the order lines behind one ASIN-week the check flagged ("orders 1 > units 0"), and how V2 counted them. Read-only. */
function ordersTestWhy() {
  var ASIN = 'B0DZNFLGTC', FROM = '2026-07-05', TO = '2026-07-11', BOOK = 0;   // SP workbook
  var ss = bookOpen_(ORDERS_DATA_IDS[BOOK]), sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  var last = sh.getLastRow(), t0 = Date.now(), lines = 0, counted = 0, zero = 0, neg = 0, lastOid = '';
  for (var start = 2; start <= last && Date.now() - t0 < 200000; start += 20000) {
    var n = Math.min(20000, last - start + 1), data = sh.getRange(start, 1, n, 10).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (String(r[4] || '').trim().toUpperCase() !== ASIN) continue;
      var ms = toMs_(r[2]); if (!ms) continue;
      var d = Utilities.formatDate(new Date(ms), 'UTC', 'yyyy-MM-dd');
      if (d < FROM || d > TO) continue;
      var why = String(r[9] || '').toUpperCase() === 'MCF' ? 'skip MCF' : !chanOk_(r[8]) ? 'skip channel'
        : String(r[7] || '').toLowerCase() === 'cancelled' ? 'skip cancelled' : '';
      var units = Number(r[5]) || 0, oid = r[0] ? String(r[0]) : '', note = why;
      if (!why) {
        lines++; if (units === 0) zero++; if (units < 0) neg++;
        if (oid && oid !== lastOid) { counted++; lastOid = oid; note = 'NEW ORDER'; } else note = 'same order';
      }
      Logger.log('row ' + (start + i) + '  ' + d + '  ' + oid + '  units ' + r[5] + '  rev ' + r[6] + '  status ' + r[7] + '  chan ' + r[8] + '  ful ' + r[9] + '  -> ' + note);
    }
  }
  Logger.log('SUMMARY ' + ASIN + ' ' + FROM + '..' + TO + ': ' + lines + ' counted line(s), V2 orders ' + counted + ', lines with units 0: ' + zero + ', with negative units: ' + neg);
}


/**
 * READ ONLY: why "orders <= units" fails. Walks both Orders workbooks once (last 26 weeks), with the
 * same skip rules and the same order rule as weeklySalesChunkV2_, and sorts every counted line by its
 * units: > 0, = 0, < 0. Says how many lines, how many units, and how many ORDERS each kind started.
 * Writes nothing, asks Amazon nothing.
 */
function ordersTestExcess() {
  var keys = weeklyKeys_(26), first = keys[0], want = {};
  keys.forEach(function (k) { want[k] = 1; });
  var cls = function (u) { return u > 0 ? 'pos' : u < 0 ? 'neg' : 'zero'; };
  for (var ix = 0; ix < ORDERS_DATA_IDS.length; ix++) {
    var t0 = Date.now(), sh = null, ss = bookOpen_(ORDERS_DATA_IDS[ix]);
    ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
    if (!sh) { Logger.log('workbook #' + ix + ': no Orders tab'); continue; }
    var last = sh.getLastRow();
    var data = last > 1 ? sh.getRange(2, 1, last - 1, 10).getValues() : [];
    var lastOid = {}, s = { pos: [0, 0, 0], zero: [0, 0, 0], neg: [0, 0, 0] }, ex = { zero: [], neg: [] };
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
      if (String(r[9] || '').toUpperCase() === 'MCF') continue;
      if (!chanOk_(r[8])) continue;
      if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
      var dMs = toMs_(r[2]); if (!dMs) continue;
      var units = Number(r[5]) || 0;
      var oid = r[0] ? String(r[0]) : '';
      var newOrd = !!oid && lastOid[asin] !== oid;
      if (newOrd) lastOid[asin] = oid;
      var wk = weekKeyOf_(dMs);
      if (wk < first || !want[wk]) continue;
      var c = cls(units);
      s[c][0] += 1; s[c][1] += units; if (newOrd) s[c][2] += 1;
      if (c !== 'pos' && ex[c].length < 5) {
        ex[c].push('row ' + (i + 2) + '  ' + asin + '  ' + Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd')
          + '  order ' + oid + '  status ' + r[7] + '  units ' + r[5] + '  revenue ' + r[6]);
      }
    }
    Logger.log('== workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')  rows ' + data.length + '  ·  '
      + Math.round((Date.now() - t0) / 1000) + ' s  ·  weeks ' + first + ' .. ' + keys[keys.length - 1]);
    ['pos', 'zero', 'neg'].forEach(function (k) {
      Logger.log('  units ' + ({ pos: '> 0', zero: '= 0', neg: '< 0' })[k] + ':  lines ' + s[k][0]
        + '  ·  units ' + s[k][1] + '  ·  orders started ' + s[k][2]);
    });
    ['zero', 'neg'].forEach(function (k) {
      if (ex[k].length) { Logger.log('  examples units ' + (k === 'zero' ? '= 0' : '< 0') + ':'); ex[k].forEach(function (x) { Logger.log('    ' + x); }); }
    });
  }
  Logger.log('Nothing was written. Send this log back.');
}