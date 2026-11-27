/* Pricing-API / WideTest.gs — a HAND-RUN test of the four 30-day ad reports (added 2026-11-05).
 *
 * WHY: on 2026-11-05 Ridhi (SP) was missing from the srchTerm / targeting / adGroup / placement caches.
 * The main nightly drops a report Amazon marks FAILED/CANCELLED without saving why. This file asks for
 * the same four reports for both brands and shows, in the log, exactly what Amazon does with each —
 * and tests the fix (ask a failed report once more under a new name) on real Amazon before Nightly.gs
 * is touched.
 *
 * SAFE BY DESIGN:
 *   - no timer: it runs only when you press Run
 *   - never reads or writes NIGHTLY_STATE, never writes any cache, never touches the cache sheet
 *   - its only state is the script property WIDE_TEST
 *   - asks under its OWN report names ("wtest-…"), so it never shares a report with the nightly
 *   - refuses to run while the main nightly is asking for / collecting ad reports
 *   - every function here starts with "wt" or "wideTest", so nothing can clash with another file
 * UNDO: delete this file (and, if you like, the WIDE_TEST script property). Nothing else changes.
 *
 * HOW: run wideTestAsk() once → wait 15–20 min → run wideTestGet() (again every few minutes until it
 * says "all done") → wideTestStatus() shows the result any time. */

var WT_KEY = 'WIDE_TEST';
var WT_KINDS = ['st', 'tgt', 'ag', 'plc'];
var WT_NAMES = { st: 'search terms', tgt: 'targeting', ag: 'ad groups', plc: 'placements' };
var WT_BRANDS = { SP: 'Ridhi', CPC: 'CPC' };

function wtGet_() { try { return JSON.parse(nProp_(WT_KEY) || '{}'); } catch (e) { return {}; } }
function wtPut_(st) { nSet_(WT_KEY, JSON.stringify(st)); }

/** The main nightly's phase if it is busy with ad reports right now, else ''. */
function wtMainBusy_() {
  var m = nState_();
  return (m.phase === 'adsAsk' || m.phase === 'adsGet') ? m.phase : '';
}

/** Ask Amazon for one wide report under a test name. Returns { id } or { error }. */
function wtAsk_(kind, start, end, tag) {
  if (typeof ADS_WIDE_CFG === 'undefined' || !ADS_WIDE_CFG[kind]) return { error: 'ADS_WIDE_CFG.' + kind + ' is not defined in this project' };
  var cfg = ADS_WIDE_CFG[kind];
  var body = {
    name: 'wtest-' + tag + '-' + kind + '-' + ACTIVE_PREFIX + '-' + start + '-to-' + end + '-' + Date.now(),
    startDate: start, endDate: end,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: cfg.groupBy, columns: cfg.columns, reportTypeId: cfg.reportTypeId,
      timeUnit: cfg.timeUnit || 'SUMMARY', format: 'GZIP_JSON',
    },
  };
  var waits = [4000, 12000];                         // Amazon busy (429) or broke (5xx): try again twice
  for (var t = 0; ; t++) {
    try {
      var r = adsCall_('/reporting/reports', 'post', body, adsProfileId_(), ADS_REPORT_MIME);
      return r && r.reportId ? { id: r.reportId, tries: t + 1 } : { error: 'Amazon accepted but sent no reportId' };
    } catch (err) {
      var m = String(err.message || err);
      if (t < waits.length && /Ads API (429|5\d\d)\b/.test(m)) { Utilities.sleep(waits[t]); continue; }
      return { error: m.slice(0, 300), tries: t + 1 };
    }
  }
}

/** STEP 1 — ask for the 4 reports for both brands. Instant. */
function wideTestAsk() {
  var busy = wtMainBusy_();
  if (busy) { Logger.log('The main nightly is in phase "' + busy + '" right now. Try again after it moves on (check nightlyStatus).'); return; }
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var end0 = new Date(Date.now() - 86400000), start0 = new Date(end0.getTime() - 29 * 86400000);
  var st = { askedAt: nowStamp_(), jobs: [] };
  var saved = ACTIVE_PREFIX;
  try {
    ['SP', 'CPC'].forEach(function (brand) {
      setBrand_(brand);
      WT_KINDS.forEach(function (kind) {
        var a = wtAsk_(kind, iso(start0), iso(end0), 'a');
        var job = { brand: brand, kind: kind, start: iso(start0), end: iso(end0), id: a.id || '', s: a.id ? 'ASKED' : 'ASK FAILED', why: a.error || '' };
        if (a.tries > 1) job.why = (job.why ? job.why + ' · ' : '') + 'needed ' + a.tries + ' tries (Amazon busy)';
        st.jobs.push(job);
        Logger.log(WT_BRANDS[brand] + ' ' + WT_NAMES[kind] + ': ' + job.s + (job.why ? ' — ' + job.why : ''));
      });
    });
  } finally { try { setBrand_(saved); } catch (e) {} }
  wtPut_(st);
  Logger.log('Asked. Amazon usually needs 10–20 minutes. Run wideTestGet() in about 15 minutes.');
}

/** STEP 2 — check each report; re-ask a failed one ONCE under a new name; download the ready ones. */
function wideTestGet() {
  var t0 = Date.now();
  var st = wtGet_();
  if (!st.jobs || !st.jobs.length) { Logger.log('Nothing asked yet — run wideTestAsk() first.'); return; }
  var saved = ACTIVE_PREFIX;
  try {
    st.jobs.forEach(function (job) {
      if (/^(OK|FAILED TWICE|RE-ASK REFUSED|ASK FAILED)/.test(job.s)) return;     // finished, one way or another
      if (Date.now() - t0 > 4 * 60000) return;                                       // leave time to save; next run carries on
      setBrand_(job.brand);
      try {
        var s = ppcStatus_(job.id);
        var status = s.status || '?';
        if (/fail|cancel/i.test(status)) {
          var why = status + (s.error ? ': ' + s.error : ' (Amazon gave no reason)');
          if (!job.retried) {
            var a = wtAsk_(job.kind, job.start, job.end, 'r');
            if (a.id) { job.firstWhy = why; job.id = a.id; job.retried = true; job.s = 'RE-ASKED'; job.why = 'first try ' + why; }
            else { job.s = 'RE-ASK REFUSED'; job.why = why + ' | re-ask refused: ' + a.error; }
          } else {
            job.s = 'FAILED TWICE'; job.why = 'first: ' + (job.firstWhy || '?') + ' | then: ' + why;
          }
          return;
        }
        if (!s.ready) { job.s = (job.retried ? 'RE-ASKED, ' : '') + 'BUILDING (' + status + ')'; return; }
        var rows = adsWideRows_(job.id);
        job.s = job.retried ? 'OK (on re-ask)' : 'OK';
        job.why = (rows.length || 0) + ' rows' + (job.retried ? ' · first try ' + job.firstWhy : '');
      } catch (e) {
        job.why = 'could not check this time: ' + String(e.message || e).slice(0, 200) + ' (will try again)';
      }
    });
  } finally { try { setBrand_(saved); } catch (e) {} }
  st.checkedAt = nowStamp_();
  wtPut_(st);
  wideTestStatus();
}

/** Show where the test is. Safe to run any time. */
function wideTestStatus() {
  var st = wtGet_();
  if (!st.jobs || !st.jobs.length) { Logger.log('No test run yet — run wideTestAsk().'); return; }
  Logger.log('asked ' + st.askedAt + (st.checkedAt ? ' · last checked ' + st.checkedAt : ''));
  st.jobs.forEach(function (j) {
    Logger.log('  ' + (WT_BRANDS[j.brand] + '      ').slice(0, 6) + ' ' + (WT_NAMES[j.kind] + '             ').slice(0, 13)
      + j.s + (j.why ? '  — ' + j.why : ''));
  });
  var open = st.jobs.filter(function (j) { return !/^(OK|FAILED TWICE|RE-ASK REFUSED|ASK FAILED)/.test(j.s); }).length;
  Logger.log(open ? open + ' still going — run wideTestGet() again in a few minutes.' : 'All done. Send Claude a screenshot of this log.');
}

/** Clear the test's saved state. Touches nothing else. */
function wideTestClear() {
  PropertiesService.getScriptProperties().deleteProperty(WT_KEY);
  Logger.log('WIDE_TEST cleared.');
}