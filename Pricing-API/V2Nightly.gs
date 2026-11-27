/* Pricing-API / V2Nightly.gs — the SECOND worker for orders per ASIN and ad units (added 2026-10-30).
 *
 * The main nightly (Nightly.gs) is NOT changed and does not know this exists. This worker:
 *   - writes ONLY its own caches v2_weekly, v2_dailyAsin, v2_adsAsin, v2_adsAsinDay into the main cache
 *     sheet (four writes a day — Code.gs serves any cache by name, so the page needs no deploy)
 *   - keeps ALL its scratch work in a SEPARATE spreadsheet of its own ("v2 scratch", id in V2N_SCRATCH_ID).
 *     The main cache sheet is already timing out under the nightly's own load (29-30 Oct); forty-odd big
 *     scratch writes a round on top of that failed on the very first one, and could slow the main pass.
 *   - keeps its own state in the V2N_STATE property, never NIGHTLY_STATE
 *   - never takes the script lock, so it can never make a main nightly tick skip; it guards against
 *     running twice itself with a short-lived V2N_RUNNING marker instead
 *   - does nothing while the main nightly is in a heavy phase (orders, Shopify, ads), so the two never
 *     read the workbooks or write the cache sheet at the same time; the main pass's 'sess' phase is light
 *   - starts one fresh round a day after V2N_START_HOUR (script time zone), and only once the main pass
 *     has started today's run and left its heavy phases — in practice about 7–8 am, done by about 9
 * Shapes are the live ones plus one number: weekly/dailyAsin [units, sales, orders];
 * adsAsin/adsAsinDay [impr, clicks, spend, orders, adSales, adUnits].
 *
 * Editor: v2RunNow() starts a round now · v2Tick() works a few minutes · v2Status() shows where it is ·
 * installV2Nightly() / removeV2Nightly() add / remove the 10-minute timer. Undo everything = removeV2Nightly(). */
// Same morning as the main pass. The round still only STARTS once the main pass has begun today's run
// (v2TickRun_) and left its heavy phases (v2nMainBusy_), so at 05:00 it simply waits for the main worker.
var V2N_START_HOUR = 5;
var V2N_KEY = 'V2N_STATE';
var V2N_RUN_KEY = 'V2N_RUNNING';
var V2N_WEEKS = 26;
var V2N_ADS_BACK = 93;              // same margin as nPhaseAdsAsk_: Amazon keeps ~95 days
var V2N_ADS_GIVE_UP_MS = 6 * 3600000;
var V2N_MAIN_HEAVY = { daily: 1, shop: 1, shopSku: 1, weekly: 1, adsAsk: 1, adsGet: 1 };

var V2N_SCRATCH_KEY = 'V2N_SCRATCH_ID';
var V2N_TABS = ['v2_weekly', 'v2_dayAsin', 'v2_adsAsin', 'v2_adsAsinDay'];

function v2nState_() { try { return JSON.parse(nProp_(V2N_KEY) || '{}'); } catch (e) { return {}; } }
function v2nSave_(st) { nSet_(V2N_KEY, JSON.stringify(st)); }

/* ---------- scratch: its own spreadsheet, same row format as accAppend_ / accReadAll_ ---------- */

/** The v2 scratch spreadsheet, made on first use. Only scratch lives here — losing it loses one round. */
function v2nScratch_() {
  var id = nProp_(V2N_SCRATCH_KEY);
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e1) { Utilities.sleep(2000); return SpreadsheetApp.openById(id); }   // throws: the tick retries
  }
  var ss = SpreadsheetApp.create('Amazon Research — v2 scratch (second worker, safe to delete)');
  nSet_(V2N_SCRATCH_KEY, ss.getId());
  return ss;
}

function v2nAppend_(name, obj) {
  var ss = v2nScratch_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var s = JSON.stringify(obj), rows = [];
  for (var i = 0; i < s.length; i += CACHE_CELL) rows.push(["'" + s.substr(i, CACHE_CELL)]);
  rows.push(['<<END>>']);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
}

/** Every appended slice, the LAST copy per key — a slice read twice after a retry counts once. */
function v2nReadAll_(name) {
  var sh = v2nScratch_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), raw = [], buf = '';
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '');
    if (v === '<<END>>') { if (buf) { try { raw.push(JSON.parse(buf)); } catch (e) {} } buf = ''; continue; }
    buf += v.replace(/^'/, '');
  }
  var lastAt = {}, out = [];
  raw.forEach(function (p, j) { if (p && p.k) lastAt[p.k] = j; });
  raw.forEach(function (p, j) { if (p && (!p.k || lastAt[p.k] === j)) out.push(p); });
  return out;
}

function v2nClear_(name) {
  var ss = v2nScratch_(), sh = ss.getSheetByName(name);
  if (!sh) return;
  if (ss.getSheets().length > 1) ss.deleteSheet(sh); else sh.clear();   // a spreadsheet keeps one sheet
}

/** The main nightly's phase when it is doing heavy work right now, else ''. */
function v2nMainBusy_() {
  var m = nState_();
  return m.day && V2N_MAIN_HEAVY[m.phase] ? m.phase : '';
}

/** One wake-up of the second worker. Safe to run by hand; a second copy at the same time just stops. */
function v2Tick() {
  var p = PropertiesService.getScriptProperties();
  var running = Number(p.getProperty(V2N_RUN_KEY) || 0);
  if (running && Date.now() - running < 6 * 60000) { Logger.log('v2: another v2Tick is running — skipped.'); return; }
  p.setProperty(V2N_RUN_KEY, String(Date.now()));
  try { v2TickRun_(); } finally { p.deleteProperty(V2N_RUN_KEY); }
}

function v2TickRun_() {
  var t0 = Date.now();
  var left = function () { return NIGHTLY_BUDGET_MS - (Date.now() - t0); };
  var busy = v2nMainBusy_();
  if (busy) { Logger.log('v2: main nightly is in phase ' + busy + ' — waiting for it.'); return; }
  var st = v2nState_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  // A new daily round waits for the main pass to have STARTED today's run: at 05:00 its state still says
  // yesterday's light 'sess' phase for a few minutes, and starting then would collide with its heavy work.
  var mainToday = nState_().day === today;
  if (!st.reset && st.day !== today && hour >= V2N_START_HOUR && !mainToday) {
    Logger.log('v2: waiting for the main nightly to start today\'s run.');
    return;
  }
  if (st.reset || (st.day !== today && hour >= V2N_START_HOUR)) {
    // The merges must take the slices read from the v2 scratch sheet. An older V2Merge.gs takes only a
    // tab name, reads the MAIN sheet, finds nothing, and the round publishes empty caches (31 Oct).
    if (nMergeWeeklyV2_.length < 2 || nMergeDayAsinV2_.length < 2 || nMergeAdsAsinV2_.length < 2) {
      st.lastErrorAt = nowStamp_();
      st.lastError = 'V2Merge.gs is the OLD version (its merges take no "parts") — paste the new V2Merge.gs, save, then v2RunNow.';
      v2nSave_(st);
      Logger.log('v2: ' + st.lastError);
      return;
    }
    Logger.log('v2: starting a fresh round' + (st.reset ? ' (asked for by v2RunNow)' : ''));
    st = { day: today, phase: 'orders', book: 0, row: 2, pending: [], started: nowStamp_() };
    v2nSave_(st);
    V2N_TABS.forEach(v2nClear_);
  }
  if (!st.day || st.phase === 'done') { Logger.log('v2: nothing to do (' + (st.phase || 'idle') + ').'); return; }
  try {
    while (left() > 20000) {
      if (st.phase === 'orders') { if (!v2nOrders_(st)) { v2nSave_(st); break; } }
      else if (st.phase === 'adsAsk') { v2nAdsAsk_(st); }
      else if (st.phase === 'adsGet') { if (!v2nAdsGet_(st, left)) { v2nSave_(st); break; } }
      else break;
      v2nSave_(st);
    }
  } catch (e) {
    st.lastErrorAt = nowStamp_(); st.lastError = String(e.message || e).slice(0, 300);
  }
  v2nSave_(st);
  Logger.log('v2: phase ' + st.phase + (st.phase === 'orders' ? ' · book ' + st.book + ' row ' + st.row : '')
    + (st.lastError ? ' · last error [' + st.lastErrorAt + '] ' + st.lastError : ''));
}

/** One slice of the Orders workbooks into the scratch tabs; publishes both caches after the last one. */
function v2nOrders_(st) {
  // Past the last workbook already means only the publish is left — e.g. it timed out last tick.
  if (st.book >= ORDERS_DATA_IDS.length) return v2nOrdersPublish_(st);
  var r = weeklySalesChunkV2_(st.book, st.row, NIGHTLY_ROWS, V2N_WEEKS, true);
  if (!r.ok) {
    // Never publish part of the workbooks: half the orders would read as a real figure.
    st.lastErrorAt = nowStamp_(); st.lastError = 'orders: ' + r.error;
    st.phase = 'adsAsk'; st.book = 0; st.row = 2;
    return true;
  }
  var brand = st.book === 0 ? 'SP' : 'CPC', k = 'v2w|' + st.book + '|' + st.row;
  v2nAppend_('v2_weekly', { k: k, brand: brand, d: r.asins || {} });
  if (r.asinDays && Object.keys(r.asinDays).length) v2nAppend_('v2_dayAsin', { k: k, brand: brand, d: r.asinDays });
  // WRITTEN FOR REAL before the cursor moves. Sheets may hold writes back and send them when the run
  // ends; a timeout THEN would leave the cursor past a slice that never landed (orders too low). A
  // flush that fails here throws before the cursor moves, so the slice is simply read again next tick
  // (the repeat replaces the earlier copy — accReadAll_ keeps the last one per key).
  SpreadsheetApp.flush();
  if (!r.done && r.next) { st.row = r.next; return true; }
  st.book++; st.row = 2;
  if (st.book < (r.books || ORDERS_DATA_IDS.length)) return true;
  return v2nOrdersPublish_(st);
}

function v2nOrdersPublish_(st) {
  var rows = nMergeWeeklyV2_('v2_weekly', v2nReadAll_('v2_weekly'));
  st.check = v2nCheck_(rows);
  // A FAILED CHECK IS NOT PUBLISHED. Yesterday's v2 caches stay; the page keeps showing them (or "—").
  // A few weeks can differ legitimately (a very late cancellation), so only more than three blocks it.
  if (st.check.bad.length > 3) {
    st.lastErrorAt = nowStamp_();
    st.lastError = 'orders NOT published: ' + st.check.bad.length + ' finished week(s) differ from the main weekly cache — see v2 check';
    v2nClear_('v2_weekly'); v2nClear_('v2_dayAsin');
    st.phase = 'adsAsk'; st.book = 0; st.row = 2;
    return true;
  }
  cacheWrite_('v2_weekly', { at: nowStamp_(), rows: rows, check: st.check });
  cacheWrite_('v2_dailyAsin', { at: nowStamp_(), from: dayWindowFrom_(), d: nMergeDayAsinV2_('v2_dayAsin', v2nReadAll_('v2_dayAsin')) });
  SpreadsheetApp.flush();
  v2nClear_('v2_weekly'); v2nClear_('v2_dayAsin');
  st.ordersAt = nowStamp_();
  st.phase = 'adsAsk'; st.book = 0; st.row = 2;
  return true;
}

/**
 * The new weekly units & sales against the MAIN weekly cache, per brand per week, before publishing.
 * Both come from the same workbooks by the same rules, so FINISHED weeks must agree; a slice that went
 * missing shows here as a week that is short. Only weeks that ended at least 8 days before the main
 * cache was written are compared: newer ones legitimately move (late orders, cancellations).
 */
function v2nCheck_(rows) {
  var c = cacheRead_('weekly');
  var main = (c && c.rows) || {};
  var stamp = String((c && c.at) || '').slice(0, 10);
  var cut = /^\d{4}-\d{2}-\d{2}$/.test(stamp)
    ? Utilities.formatDate(new Date(Date.parse(stamp + 'T00:00:00Z') - 8 * 86400000), 'UTC', 'yyyy-MM-dd') : '';
  var out = { at: nowStamp_(), against: (c && c.at) || '', checked: 0, bad: [] };
  if (!cut) return out;
  var sum = function (byAsin) {
    var w = {};
    Object.keys(byAsin || {}).forEach(function (a) {
      Object.keys(byAsin[a] || {}).forEach(function (k) {
        var v = byAsin[a][k] || [], t = w[k] || (w[k] = [0, 0]);
        t[0] += v[0] || 0; t[1] += v[1] || 0;
      });
    });
    return w;
  };
  ['SP', 'CPC'].forEach(function (b) {
    var mine = sum(rows[b]), theirs = sum(main[b]);
    Object.keys(theirs).sort().forEach(function (k) {
      var end = Utilities.formatDate(new Date(Date.parse(k + 'T00:00:00Z') + 6 * 86400000), 'UTC', 'yyyy-MM-dd');
      if (end >= cut) return;
      out.checked++;
      var m = mine[k] || [0, 0], t = theirs[k];
      if (m[0] !== t[0] || Math.abs(m[1] - t[1]) > 1) {
        out.bad.push({ brand: b, wk: k, units: m[0] + ' vs ' + t[0], sales: Math.round(m[1]) + ' vs ' + Math.round(t[1]) });
      }
    });
  });
  return out;
}

/** Ask for the ad reports WITH ad units, in the same 31-day windows the main pass uses. Instant. */
function v2nAdsAsk_(st) {
  var end0 = new Date(Date.now() - 86400000);
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  st.pending = [];
  ['SP', 'CPC'].forEach(function (brand) {
    setBrand_(brand);
    var oldest = new Date(end0.getTime() - V2N_ADS_BACK * 86400000);
    for (var off = 0; off < V2N_ADS_BACK; off += 31) {
      var e = new Date(end0.getTime() - off * 86400000);
      var s = new Date(e.getTime() - Math.min(30, V2N_ADS_BACK - off - 1) * 86400000);
      if (s.getTime() < oldest.getTime()) s = oldest;
      // An ask Amazon REFUSES (rate limit, a blip) is kept as a job without an id and asked again on the
      // next ticks (v2nAdsGet_). Dropping it, as before 2 Nov, left that window silently short on the page.
      var job = { brand: brand, start: iso(s), end: iso(e), id: '', tries: 1 };
      try {
        var c = ppcCreateRangeV2_(iso(s), iso(e));
        if (c.ok && c.reportId) job.id = c.reportId;
        else { st.lastErrorAt = nowStamp_(); st.lastError = 'ads ask ' + brand + ': ' + (c.error || 'no reportId'); }
      } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ads ask ' + brand + ': ' + String(err.message || err).slice(0, 160); }
      st.pending.push(job);
    }
  });
  st.askedAt = Date.now();
  st.phase = 'adsGet';
}

/** Collect whatever Amazon has finished; publish once nothing is left (or Amazon has had 6 hours). */
function v2nAdsGet_(st, left) {
  st.pending = st.pending || [];
  var still = [];
  for (var i = 0; i < st.pending.length; i++) {
    var job = st.pending[i];
    if (left() < 25000) { still = still.concat(st.pending.slice(i)); break; }
    setBrand_(job.brand);
    if (!job.id) {                                           // Amazon refused the ask earlier: ask again
      if ((job.tries || 0) >= 3) {
        (st.missing = st.missing || []).push({ brand: job.brand, start: job.start, end: job.end });
        st.lastErrorAt = nowStamp_(); st.lastError = 'ads ' + job.brand + ' ' + job.start + '..' + job.end + ': Amazon refused the ask 3 times';
        continue;
      }
      job.tries = (job.tries || 0) + 1;
      try {
        var a = ppcCreateRangeV2_(job.start, job.end);
        if (a.ok && a.reportId) job.id = a.reportId;
      } catch (e2) { /* asked again next tick */ }
      still.push(job);
      continue;
    }
    try {
      var s = ppcStatus_(job.id);
      if (/fail|cancel/i.test(s.status || '')) {
        st.lastErrorAt = nowStamp_(); st.lastError = 'ads ' + job.brand + ' ' + job.start + '..' + job.end + ' ' + s.status;
        // Amazon fails a report now and then (31 Oct: CPC 29 Aug–28 Sep). Ask ONCE more, under its own
        // name so the duplicate check cannot hand back the failed one. Still failing: that window is
        // recorded as MISSING, and the page shows "—" for that brand on those dates instead of a total
        // that is quietly short.
        if (!job.retried) {
          var c = v2nAskRetry_(job.start, job.end);
          if (c.ok && c.reportId) { still.push({ brand: job.brand, start: job.start, end: job.end, id: c.reportId, retried: true }); continue; }
        }
        (st.missing = st.missing || []).push({ brand: job.brand, start: job.start, end: job.end });
        continue;
      }
      if (!s.ready) { still.push(job); continue; }
      var d = ppcFetchV2_(job.id, 'both');
      v2nAppend_('v2_adsAsin', { k: 'v2a|' + job.id, brand: job.brand, d: d.asins || {} });
      if (d.asinDays && Object.keys(d.asinDays).length) v2nAppend_('v2_adsAsinDay', { k: 'v2a|' + job.id, brand: job.brand, d: d.asinDays });
      SpreadsheetApp.flush();                                // landed for real before the job is let go
    } catch (e) { still.push(job); }                         // a blip — try again next wake-up
  }
  st.pending = still;
  if (st.pending.length && Date.now() - (st.askedAt || 0) > V2N_ADS_GIVE_UP_MS) {
    st.lastErrorAt = nowStamp_(); st.lastError = 'ads: gave up on ' + st.pending.length + ' report(s) after 6 hours';
    st.pending.forEach(function (j) { (st.missing = st.missing || []).push({ brand: j.brand, start: j.start, end: j.end }); });
    st.pending = [];
  }
  if (st.pending.length) return false;
  var adParts = v2nReadAll_('v2_adsAsin'), adRows = nMergeAdsAsinV2_('v2_adsAsin', adParts);
  // Slices collected but nothing merged = the merge read the wrong place. Never publish that as "no ads".
  if (adParts.length && !Object.keys(adRows).length) {
    st.lastErrorAt = nowStamp_(); st.lastError = 'ads NOT published: ' + adParts.length + ' report(s) collected but the merge came out empty';
    st.phase = 'done'; st.finishedAt = nowStamp_();
    return true;
  }
  // `missing`: windows Amazon would not deliver — the page shows "—" for that brand on those dates.
  cacheWrite_('v2_adsAsin', { at: nowStamp_(), d: adRows, missing: st.missing || [] });
  cacheWrite_('v2_adsAsinDay', { at: nowStamp_(), from: dayWindowFrom_(), d: v2nMergeAdsAsinDay_(v2nReadAll_('v2_adsAsinDay')), missing: st.missing || [] });
  SpreadsheetApp.flush();
  v2nClear_('v2_adsAsin'); v2nClear_('v2_adsAsinDay');
  st.phase = 'done'; st.finishedAt = nowStamp_();
  return true;
}

/** ppcCreateRangeV2_ again, under a retry name (Amazon answers a repeat of the same body with the old id). */
function v2nAskRetry_(startDate, endDate) {
  var body = {
    name: 'ppcwur-' + ACTIVE_PREFIX + '-' + startDate + '-to-' + endDate,
    startDate: startDate, endDate: endDate,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['advertiser'],
      columns: ['date', 'advertisedAsin', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d', 'unitsSoldClicks30d'],
      reportTypeId: 'spAdvertisedProduct',
      timeUnit: 'DAILY',
      format: 'GZIP_JSON',
    },
  };
  try { return adsAsk_(body, { brand: ACTIVE_PREFIX, kind: 'ppc', start: startDate, end: endDate }); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/** nMergeAdsAsinDay_ over already-read slices: REPLACES per day (31-day slices never share a day). */
function v2nMergeAdsAsinDay_(parts) {
  var out = {};
  parts.forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byDay = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byDay).forEach(function (day) { row[day] = byDay[day]; });
    });
  });
  return out;
}

/* ---------- editor buttons ---------- */

/** Start a fresh round on the next v2Tick (and run one now). */
function v2RunNow() {
  var st = v2nState_();
  v2nSave_({ reset: true, day: st.day || '' });
  Logger.log('v2: fresh round requested. Running one tick now; run v2Tick() again (every few minutes) until v2Status() says done.');
  v2Tick();
}

function v2Status() {
  var st = v2nState_();
  Logger.log('v2 round     ' + (st.day || '—') + '  ·  phase ' + (st.phase || 'idle')
    + (st.phase === 'orders' ? '  ·  book ' + st.book + ' row ' + st.row : '')
    + (st.phase === 'adsGet' ? '  ·  waiting on ' + (st.pending || []).length + ' ad report(s)' : ''));
  Logger.log('v2 started   ' + (st.started || '—') + '  ·  orders done ' + (st.ordersAt || '—') + '  ·  finished ' + (st.finishedAt || 'not yet'));
  if (st.lastError) Logger.log('v2 last error [' + st.lastErrorAt + '] ' + st.lastError);
  if (st.missing && st.missing.length) {
    Logger.log('v2 ads MISSING (page shows "—" there): ' + st.missing.map(function (m) { return m.brand + ' ' + m.start + '..' + m.end; }).join(' · '));
  } else if (st.phase === 'done') Logger.log('v2 ads       all reports collected');
  var ck = st.check;
  if (!ck) Logger.log('v2 check     not run yet — it runs when the orders caches are published');
  else if (ck.bad && ck.bad.length) {
    Logger.log('v2 check     ' + ck.bad.length + ' FINISHED WEEK(S) DIFFER from the main weekly cache (' + ck.against + '):');
    ck.bad.slice(0, 10).forEach(function (b) { Logger.log('   ' + b.brand + ' ' + b.wk + '  units ' + b.units + '  sales ' + b.sales); });
  } else Logger.log('v2 check     OK — ' + (ck.checked || 0) + ' finished week(s) match the main weekly cache (' + ck.against + ')');
  var m = nState_();
  Logger.log('main nightly ' + (m.day || '—') + '  ·  phase ' + (m.phase || 'idle') + (V2N_MAIN_HEAVY[m.phase] ? '  (heavy — v2 waits)' : ''));
  ['v2_weekly', 'v2_dailyAsin', 'v2_adsAsin', 'v2_adsAsinDay'].forEach(function (n) {
    var c = cacheRead_(n);
    Logger.log('cache ' + n + ': ' + (c ? 'ok · ' + (c.at || '?') + ' · ' + Math.round(JSON.stringify(c).length / 1024) + ' KB' : 'empty'));
  });
  var sid = nProp_(V2N_SCRATCH_KEY);
  Logger.log('scratch      ' + (sid ? 'https://docs.google.com/spreadsheets/d/' + sid + '/edit' : 'not made yet'));
  var trig = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'v2Tick'; }).length;
  Logger.log('timer        ' + (trig ? 'ON (' + trig + ')' : 'off'));
}

/**
 * ONE-OFF: remove the scratch tabs the first version of this worker left in the MAIN cache sheet
 * (_v2_weekly, _v2_dayAsin, _v2_adsAsin, _v2_adsAsinDay). Only these four names are touched — never a
 * cache, never a tab of the main nightly. Safe to run again: a tab that is not there is skipped.
 */
function v2CleanOldTabs() {
  var ss = cacheSheet_();
  V2N_TABS.forEach(function (n) {
    var sh = ss.getSheetByName('_' + n);
    if (sh) { ss.deleteSheet(sh); Logger.log('deleted _' + n + ' from the main cache sheet'); }
    else Logger.log('_' + n + ' not there — fine');
  });
  SpreadsheetApp.flush();
  Logger.log('Done. Main caches untouched.');
}

/** Add the 10-minute timer for v2Tick. Running it again replaces the old one. */
function installV2Nightly() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'v2Tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('v2Tick').timeBased().everyMinutes(10).create();
  Logger.log('v2Tick now runs every 10 minutes. A fresh round starts once a day after ' + V2N_START_HOUR + ':00 '
    + Session.getScriptTimeZone() + ', once the main nightly has finished its heavy phases. Undo: removeV2Nightly().');
}

/** Remove the timer. The v2_ caches stay as they are; nothing else is touched. */
function removeV2Nightly() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'v2Tick') { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('v2Tick timer removed (' + n + ').');
}
