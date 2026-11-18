/* Pricing-API / AdsDecide.gs — search terms and targets split into SETTLED and RECENT days, READ ONLY (14 Nov 2026).
 *
 * WHY. Search Term Analysis (Sellora, tab 'st') says "no sales in 44 clicks" and "ACoS above break-even". Judged on the
 * last 30 days with 30-day sales (the srchTerm / targeting caches), the newest days are not finished: a click from
 * yesterday can still turn into an order next week, so a fresh term looks worse than it is. This asks Amazon for the
 * same two reports twice a day-window apart, with 7-DAY sales (what the Ads console shows):
 *   settled   days 8–37 ago — older than the 7-day window, so their sales are final. Verdicts are judged on these.
 *   recent    the last 7 days — shown under each figure ("+12 last 7 days"), never counted in a verdict.
 * The existing srchTerm / targeting caches are NOT touched: Search Terms' Campaign × Product, the Overview's
 * recommendations and the Listing Optimiser keep reading them exactly as before. Sellora switches to these the moment
 * they exist, and falls back to the 30-day caches when they do not.
 *
 * THE CACHES — each { v, at, from, to, cols, d: { SP: pack, CPC: pack }, err }, pack in the same shape as srchTerm's:
 *   stSettled, stRecent     rows [{ t: term, ag, cid, kw: keyword or target, mt: match type, i, c, sp, o, s, kid? }],
 *                           names { id → name }, dropped, dropSpend, minClicks
 *   tgtSettled, tgtRecent   rows [{ t: keyword or target, ag, cid, mt, i, c, sp, o, s, kid? }], names
 * o and s are 7-day purchases and sales; os / oo the advertised product's own 7-day sales and orders (same SKU). kid is
 * Amazon's keyword / target ID. The optional columns (targeting, keywordId, same-SKU) are asked for, and dropped once and
 * for all if Amazon refuses one (st.noOpt).
 * stSettled also carries grams: the words of the terms too small to keep one by one (no order, under ST_MIN_CLICKS
 * clicks — about $100k a month between them), as [[word or two-word phrase, terms, clicks, spend, orders, sales,
 * [[campaignId, spend] …top 8]]], so Search Term Analysis → Burning money → By word can show which recur without selling.
 * Settled search terms are cut like srchTerm (no order and under ST_MIN_CLICKS clicks → counted, not kept); recent
 * ones keep anything with a click, since "+1 click last 7 days" is the point of them.
 * A brand whose report fails keeps its last good copy in that cache, and its error is in err.
 *
 * WHERE THEY LIVE (17 Nov 2026): in "Sellora Ads Cache", the spreadsheet AdsEntities.gs creates (adsBook_, adsPut_,
 * adsCacheRead_ are in that file — both files are needed), not in the nightly cache spreadsheet.
 * A FAILED REPORT IS ASKED AGAIN UNDER A NEW NAME (…-r2, -r3): asked under the same name, Amazon answers 425 "duplicate
 * of <the failed id>" and adsAsk_ would hand the failed report straight back.
 * THE TIMER IS ON ONLY WHILE THERE IS WORK: decStart (daily, DEC_START_HOUR) switches the 10-minute decTick on; decTick
 * switches itself off once the day's pass is done, or after DEC_PASS_MAX_H hours (what is left then gives up, and those
 * brands keep their last good copy).
 *
 * RUN FROM THE EDITOR (Ravi):
 *   decSetup()      once: creates (or checks) the "Sellora Ads Cache" spreadsheet, installs the daily decStart,
 *                   switches decTick on and starts today's pass
 *   decStatus()     what it is doing, what each cache holds, any errors
 *   decCheck()      one campaign's settled totals, to hold against the Ads console (7-day attribution, same dates)
 *   decRunNow()     start a fresh pass now instead of waiting for this afternoon
 *   decStop()       removes both timers (decStart and decTick).
 * Sellora reads them through ?cache=stSettled … — Code.gs sends these names to the Ads spreadsheet.
 *
 * Same pattern as AmazonMatch.gs: own file, own timer (decTick), own state (Script Property DEC_STATE), own lease, no
 * script lock — it never holds up the nightly run, and it changes no other file. Placement decisions (plcDecide) come
 * later, with the placement screen.
 */

var DEC_START_HOUR = 15;        // script time zone (India): after midnight Pacific all year, and after AmazonMatch's start
var DEC_BUDGET_MS = 4.5 * 60000;
var DEC_TRIES = 3;
var DEC_PASS_MAX_H = 6;         // a pass still not finished after this gives up what is left, and the timer goes off
var DEC_BRANDS = ['SP', 'CPC'];
var DEC_RECENT = 7;             // the last 7 days: Amazon's 7-day window is still open on them
var DEC_SETTLED = 30;           // settled days: from 8 to 37 days ago
// The four caches: which report, which window.
var DEC_JOBS = {
  stSettled: { rep: 'st', win: 'settled' }, stRecent: { rep: 'st', win: 'recent' },
  tgtSettled: { rep: 'tgt', win: 'settled' }, tgtRecent: { rep: 'tgt', win: 'recent' },
};
// The two reports. `optional` columns are asked for and dropped for good if Amazon refuses them.
var DEC_CFG = {
  st: { reportTypeId: 'spSearchTerm', groupBy: ['searchTerm'],
    columns: ['searchTerm', 'keyword', 'matchType', 'campaignId', 'campaignName', 'adGroupId', 'adGroupName',
      'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d'],
    optional: ['targeting', 'keywordId', 'attributedSalesSameSku7d', 'purchasesSameSku7d'] },
  tgt: { reportTypeId: 'spTargeting', groupBy: ['targeting'],
    columns: ['keyword', 'targeting', 'matchType', 'campaignId', 'campaignName', 'adGroupId', 'adGroupName',
      'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d'],
    optional: ['keywordId', 'attributedSalesSameSku7d', 'purchasesSameSku7d'] },
};
// Words left out of the word roll-up, and its limits.
var DEC_STOP = { a: 1, an: 1, and: 1, the: 1, 'for': 1, of: 1, 'with': 1, 'in': 1, on: 1, to: 1, by: 1, x: 1, set: 1, inch: 1,
  inches: 1, pack: 1, pcs: 1, piece: 1, pieces: 1, size: 1, large: 1, small: 1, big: 1, my: 1, from: 1, or: 1, at: 1, is: 1, it: 1 };
var DEC_GRAM_MIN_TERMS = 5, DEC_GRAM_MIN_SPEND = 5, DEC_GRAM_MAX = 3000;

/* ============================== editor functions ============================== */

function decSetup() {
  try { Logger.log(adsBookCheck_()); }
  catch (e) {
    Logger.log('❌ cannot use the "' + ADS_BOOK_NAME + '" spreadsheet: ' + (e.message || e) + ' — nothing was installed.');
    return;
  }
  decStop();
  ScriptApp.newTrigger('decStart').timeBased().atHour(DEC_START_HOUR).everyDays(1).create();
  var st = decState_(); st.reset = true; decSave_(st);
  decTimerOn_();
  Logger.log('✓ installed: decStart daily at ' + DEC_START_HOUR + ':00 (' + Session.getScriptTimeZone() + ') switches the 10-minute decTick on;'
    + ' decTick switches itself off when the pass is done. Today\'s pass starts on the next tick. decStatus() shows progress.');
}

function decStop() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'decTick' || h === 'decStart') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('decStop: ' + n + ' timer(s) removed.');
}

function decRunNow() {
  var st = decState_(); st.reset = true; decSave_(st);
  decTimerOn_();                      // the later ticks collect what this one asks for
  decTick();
  decStatus();
}

function decStatus() {
  var st = decState_();
  Logger.log('Pass of ' + (st.day || '—') + ': ' + (st.phase || 'not started') + ' · ' + (st.doneN || 0) + ' report(s) in'
    + (st.windows ? ' · settled ' + st.windows.settled.join(' – ') + ' · recent ' + st.windows.recent.join(' – ') : ''));
  (st.jobs || []).forEach(function (j) { Logger.log('  ' + decJobName_(j) + ': ' + j.st + (j.m ? ' — ' + j.m : '')); });
  if (st.noOpt) Logger.log('  Amazon refused the optional columns (' + st.noOpt + '); asking without them.');
  (st.errors || []).forEach(function (e) { Logger.log('  ! ' + e); });
  var hs = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  Logger.log('timers: decStart ' + (hs.indexOf('decStart') >= 0 ? 'on' : 'MISSING — run decSetup()') + ' · decTick '
    + (hs.indexOf('decTick') >= 0 ? 'on (every 10 minutes)' : 'off until decStart'));
  Object.keys(DEC_JOBS).forEach(function (name) {
    var c = adsCacheRead_(name);
    if (!c) { Logger.log(name + ': nothing yet'); return; }
    Logger.log(name + ' (' + c.from + ' – ' + c.to + ', written ' + c.at + '): ' + DEC_BRANDS.map(function (b) {
      var p = (c.d || {})[b];
      return b + ' ' + (p ? (p.rows || []).length + ' rows' + (p.dropped ? ' (+' + p.dropped + ' cut)' : '') + (p.stale ? ' STALE' : '') : 'none')
        + ((c.err || {})[b] ? ' error: ' + c.err[b] : '');
    }).join(' · '));
  });
}

/** The settled totals of the biggest campaign of each brand — check them against the Ads console, 7-day attribution. */
function decCheck() {
  var c = adsCacheRead_('tgtSettled');
  if (!c) { Logger.log('No tgtSettled yet — run decSetup() and wait for the pass.'); return; }
  DEC_BRANDS.forEach(function (b) {
    var p = (c.d || {})[b];
    if (!p) return;
    var by = {};
    (p.rows || []).forEach(function (r) {
      var x = by[r.cid] || (by[r.cid] = { i: 0, c: 0, sp: 0, o: 0, s: 0 });
      x.i += r.i; x.c += r.c; x.sp += r.sp; x.o += r.o; x.s += r.s;
    });
    var top = Object.keys(by).sort(function (a, z) { return by[z].sp - by[a].sp; })[0];
    if (!top) return;
    var x = by[top];
    Logger.log(b + ' · ' + (p.names[top] || top) + ' · ' + c.from + ' – ' + c.to + ': impressions ' + x.i + ', clicks ' + x.c
      + ', spend ' + x.sp.toFixed(2) + ', orders ' + x.o + ', sales ' + x.s.toFixed(2)
      + '  → Ads console: Campaign manager, this campaign, the same dates, attribution 7 days. Within ~5% is normal.');
  });
}

/* ============================== the timer ============================== */

function decTick() {
  var props = PropertiesService.getScriptProperties();
  var lease = Number(props.getProperty('DEC_LEASE') || 0);
  if (lease && Date.now() - lease < 7 * 60000) { Logger.log('decTick: another run is still going — skipped.'); return; }
  props.setProperty('DEC_LEASE', String(Date.now()));
  var saved = ACTIVE_PREFIX;
  try { decTick_(); }
  finally { setBrand_(saved); props.deleteProperty('DEC_LEASE'); }
  // Nothing left to collect today: stop ticking until decStart switches it on tomorrow.
  var st = decState_();
  if (st.phase === 'done' && !st.reset) {
    if (decTimerOff_()) Logger.log('decTick: today\'s pass is done — the 10-minute timer is off until decStart tomorrow.');
  }
}

// The daily starter (DEC_START_HOUR): switch the 10-minute timer on and take the first tick now.
function decStart() {
  decTimerOn_();
  decTick();
}

function decTimerOn_() {
  var on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'decTick'; });
  if (!on) ScriptApp.newTrigger('decTick').timeBased().everyMinutes(10).create();
}

function decTimerOff_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'decTick') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function decTick_() {
  var t0 = Date.now();
  var left = function () { return DEC_BUDGET_MS - (Date.now() - t0); };
  var st = decState_();
  var todayLocal = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  if (st.reset || (st.day !== todayLocal && hour >= DEC_START_HOUR)) {
    st = decPlan_(st, todayLocal);
    decSave_(st);
    Logger.log('decTick: fresh pass, ' + st.jobs.length + ' report(s) to get.');
  }
  if (!st.day || st.phase === 'done') return;
  // A pass that has run too long (a report Amazon never finishes) gives up what is left, so the timer can go off.
  if (st.startedMs && Date.now() - st.startedMs > DEC_PASS_MAX_H * 3600000) {
    st.jobs.forEach(function (j) {
      if (j.st !== 'new' && j.st !== 'asked') return;
      j.t = DEC_TRIES;
      decRetry_(st, j, 'not ready after ' + DEC_PASS_MAX_H + ' h — this brand keeps its last good copy');
    });
  }
  try {
    for (var i = 0; i < st.jobs.length && left() > 30000; i++) {
      var j = st.jobs[i];
      if (j.st === 'done' || j.st === 'gave') continue;
      setBrand_(j.b);
      try {
        if (j.st === 'new') {
          j.id = decAsk_(st, j);
          j.st = 'asked';
          j.t = (j.t || 0) + 1;
          decSave_(st);
          continue;                         // Amazon needs a few minutes; collected on a later loop or tick
        }
        var s = ppcStatus_(j.id);
        if (/FAIL|CANCEL/i.test(s.status || '')) { decRetry_(st, j, 'Amazon could not build it: ' + (s.error || s.status)); continue; }
        if (!s.ready) continue;
        if (left() < 60000) break;
        var rows = adsWideRows_(j.id);
        decStore_(st, j, rows);
        j.st = 'done';
        st.doneN = (st.doneN || 0) + 1;
        decSave_(st);
      } catch (e) {
        var m = String(e.message || e);
        if (/429|quota|throttl|too many/i.test(m)) { decErr_(st, decJobName_(j) + ': Amazon asked us to slow down — next tick'); continue; }
        if (j.st === 'new') j.t = (j.t || 0) + 1;
        decRetry_(st, j, m.slice(0, 200));
      }
    }
  } finally {
    // Done jobs stay in the list (there are only eight) so decStatus can show the whole pass.
    if (!st.jobs.some(function (x) { return x.st === 'new' || x.st === 'asked'; })) {
      st.phase = 'done';
      st.endedAt = nowStamp_();
    }
    decSave_(st);
  }
}

// Today's eight reports: four caches × two brands, with today's two windows (Pacific dates).
function decPlan_(old, todayLocal) {
  var today = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var add = function (iso, n) { return Utilities.formatDate(new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000), 'UTC', 'yyyy-MM-dd'); };
  var win = {
    recent: [add(today, -DEC_RECENT), add(today, -1)],
    settled: [add(today, -DEC_RECENT - DEC_SETTLED), add(today, -DEC_RECENT - 1)],
  };
  var jobs = [];
  DEC_BRANDS.forEach(function (b) {
    Object.keys(DEC_JOBS).forEach(function (name) {
      var w = win[DEC_JOBS[name].win];
      jobs.push({ b: b, k: name, s: w[0], e: w[1], st: 'new' });
    });
  });
  return { day: todayLocal, phase: 'running', jobs: jobs, windows: win, doneN: 0, startedAt: nowStamp_(), startedMs: Date.now(),
    errors: (old.errors || []).slice(-3), noOpt: old.noOpt || '' };
}

// Ask for one report. The optional columns go with it until Amazon refuses one; then never again.
function decAsk_(st, j) {
  var cfg = DEC_CFG[DEC_JOBS[j.k].rep];
  var cols = cfg.columns.concat(st.noOpt ? [] : cfg.optional);
  var body = function (c) {
    // A retry gets its own name (-r2, -r3): the same name again is a 425 duplicate of the report that failed.
    return { name: 'dec-' + j.k + '-' + j.b + '-' + j.s + '-to-' + j.e + (st.noOpt ? '-b' : '') + (j.t ? '-r' + (j.t + 1) : ''),
      startDate: j.s, endDate: j.e,
      configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: cfg.groupBy, columns: c, reportTypeId: cfg.reportTypeId,
        timeUnit: 'SUMMARY', format: 'GZIP_JSON' } };
  };
  try {
    return adsAsk_(body(cols), { brand: j.b, kind: j.k, start: j.s, end: j.e }).reportId;
  } catch (e) {
    var m = String(e.message || e);
    if (!st.noOpt && /^Ads API 400\b/.test(m) && /column|invalid|not supported|unknown/i.test(m)) {
      st.noOpt = cfg.optional.join(', ');
      decErr_(st, 'Amazon refused an optional column, asking without ' + st.noOpt + ': ' + m.slice(0, 160));
      return adsAsk_(body(cfg.columns), { brand: j.b, kind: j.k, start: j.s, end: j.e }).reportId;
    }
    throw e;
  }
}

// Fold one finished report into its cache, replacing this brand only.
function decStore_(st, j, rows) {
  var job = DEC_JOBS[j.k];
  var pack = job.rep === 'st' ? decFoldSt_(rows, job.win === 'settled') : decFoldTgt_(rows);
  pack.from = j.s;
  pack.to = j.e;
  var c = adsCacheRead_(j.k) || {};
  c.v = 1;
  c.d = c.d || {};
  c.err = c.err || {};
  c.d[j.b] = pack;
  delete c.err[j.b];
  c.at = nowStamp_();
  c.from = j.s;
  c.to = j.e;
  c.cols = st.noOpt ? 'without ' + st.noOpt : 'all';
  adsPut_(j.k, c);
}

// Search terms → one row per (ad group, term). Settled: cut like srchTerm, the cut counted. Recent: anything with a click.
function decFoldSt_(rows, settled) {
  var out = {}, names = {};
  rows.forEach(function (x) {
    var term = wStr_(x.searchTerm); if (!term) return;
    var ag = wStr_(x.adGroupId), cid = wStr_(x.campaignId);
    if (ag && !names[ag]) names[ag] = wStr_(x.adGroupName);
    if (cid && !names[cid]) names[cid] = wStr_(x.campaignName);
    var k = ag + '|' + term.toLowerCase();
    var b = out[k] || (out[k] = { t: term, ag: ag, cid: cid, kw: wStr_(x.keyword) || wStr_(x.targeting),
      mt: wStr_(x.matchType), i: 0, c: 0, sp: 0, o: 0, s: 0 });
    if (x.keywordId != null && !b.kid) b.kid = wStr_(x.keywordId);
    b.i += wNum_(x.impressions); b.c += wNum_(x.clicks); b.sp += wNum_(x.cost);
    b.o += wNum_(x.purchases7d); b.s += wNum_(x.sales7d);
    if (x.attributedSalesSameSku7d != null) { b.os = (b.os || 0) + wNum_(x.attributedSalesSameSku7d); b.oo = (b.oo || 0) + wNum_(x.purchasesSameSku7d); }
  });
  var list = [], dropped = 0, dropSpend = 0, min = settled ? ST_MIN_CLICKS : 1, tail = [];
  Object.keys(out).forEach(function (k) {
    var b = out[k];
    if (!(b.o > 0) && b.c < min) { dropped++; dropSpend += b.sp; if (b.sp > 0) tail.push(b); return; }
    b.sp = wMoney_(b.sp); b.s = wMoney_(b.s);
    if (b.os != null) b.os = wMoney_(b.os);
    list.push(b);
  });
  var pack = { rows: list, names: names, dropped: dropped, dropSpend: wMoney_(dropSpend), minClicks: min };
  if (settled) pack.grams = decGrams_(tail);
  return pack;
}

// The words of the terms too small to keep: every word and two-word phrase, summed over the terms holding it, with the
// campaigns it spent in. Kept when it spans DEC_GRAM_MIN_TERMS terms and DEC_GRAM_MIN_SPEND dollars; the biggest first.
function decGrams_(tail) {
  var g = {};
  tail.forEach(function (b) {
    var w = String(b.t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    var seen = {};
    for (var n = 1; n <= 2; n++) {
      for (var i = 0; i + n <= w.length; i++) {
        var parts = w.slice(i, i + n);
        if (n === 1 && (DEC_STOP[parts[0]] || parts[0].length < 3 || /\d/.test(parts[0]))) continue;
        if (parts.every(function (p) { return DEC_STOP[p] || /^\d/.test(p); })) continue;
        var k = parts.join(' ');
        if (seen[k]) continue;
        seen[k] = 1;
        var x = g[k] || (g[k] = { n: 0, c: 0, sp: 0, o: 0, s: 0, cp: {} });
        x.n++; x.c += b.c; x.sp += b.sp; x.o += b.o; x.s += b.s;
        x.cp[b.cid] = (x.cp[b.cid] || 0) + b.sp;
      }
    }
  });
  var out = [];
  Object.keys(g).forEach(function (k) {
    var x = g[k];
    if (x.n < DEC_GRAM_MIN_TERMS || x.sp < DEC_GRAM_MIN_SPEND) return;
    var cps = Object.keys(x.cp).map(function (c) { return [c, wMoney_(x.cp[c])]; }).sort(function (a, z) { return z[1] - a[1]; }).slice(0, 8);
    out.push([k, x.n, x.c, wMoney_(x.sp), x.o, wMoney_(x.s), cps]);
  });
  out.sort(function (a, z) { return z[3] - a[3]; });
  return out.slice(0, DEC_GRAM_MAX);
}

// Targets → one row per (ad group, target, match type), kept even at zero clicks (as the targeting cache).
function decFoldTgt_(rows) {
  var out = {}, names = {};
  rows.forEach(function (x) {
    var t = wStr_(x.keyword) || wStr_(x.targeting); if (!t) return;
    var ag = wStr_(x.adGroupId), cid = wStr_(x.campaignId);
    if (ag && !names[ag]) names[ag] = wStr_(x.adGroupName);
    if (cid && !names[cid]) names[cid] = wStr_(x.campaignName);
    var k = ag + '|' + t.toLowerCase() + '|' + wStr_(x.matchType).toLowerCase();
    var b = out[k] || (out[k] = { t: t, ag: ag, cid: cid, mt: wStr_(x.matchType), i: 0, c: 0, sp: 0, o: 0, s: 0 });
    if (x.keywordId != null && !b.kid) b.kid = wStr_(x.keywordId);
    b.i += wNum_(x.impressions); b.c += wNum_(x.clicks); b.sp += wNum_(x.cost);
    b.o += wNum_(x.purchases7d); b.s += wNum_(x.sales7d);
    if (x.attributedSalesSameSku7d != null) { b.os = (b.os || 0) + wNum_(x.attributedSalesSameSku7d); b.oo = (b.oo || 0) + wNum_(x.purchasesSameSku7d); }
  });
  var list = [];
  Object.keys(out).forEach(function (k) { var b = out[k]; b.sp = wMoney_(b.sp); b.s = wMoney_(b.s); list.push(b); });
  return { rows: list, names: names };
}

/* ============================== state ============================== */

function decRetry_(st, j, msg) {
  decErr_(st, decJobName_(j) + ': ' + msg);
  if ((j.t || 0) >= DEC_TRIES) {
    j.st = 'gave';
    j.m = msg;
    // The brand keeps yesterday's copy; the cache says why today's is missing.
    try {
      var c = adsCacheRead_(j.k);
      if (c && c.d) {
        c.err = c.err || {};
        c.err[j.b] = String(msg).slice(0, 200);
        if (c.d[j.b]) c.d[j.b].stale = true;
        adsPut_(j.k, c);
      }
    } catch (e) { /* the state still says it */ }
  } else {
    j.st = 'new';
    j.id = '';
  }
}
function decState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEC_STATE') || '{}'); }
  catch (e) { return {}; }
}
function decSave_(st) {
  var s = JSON.stringify(st);
  while (s.length > 8800 && st.errors && st.errors.length) { st.errors.shift(); s = JSON.stringify(st); }
  PropertiesService.getScriptProperties().setProperty('DEC_STATE', s);
}
function decErr_(st, msg) {
  st.errors = st.errors || [];
  st.errors.push('[' + nowStamp_() + '] ' + String(msg).slice(0, 180));
  if (st.errors.length > 8) st.errors = st.errors.slice(-8);
}
function decJobName_(j) { return j.b + ' ' + j.k + ' ' + j.s + '…' + j.e + (j.t ? ' (try ' + j.t + ')' : ''); }
