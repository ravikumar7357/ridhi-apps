/* Pricing-API / Nightly.gs — the nightly pipeline.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Nightly pipeline ===================== */
/*
 * Everything the browser used to grind through â€” the Orders scan, the ad reports, the per-week
 * session reports â€” done overnight instead, so opening a tab becomes a read rather than a wait.
 *
 * SHAPED BY TWO HARD LIMITS, not by preference:
 *   1. Apps Script stops a run at six minutes. The full job is far longer, so this is not one long
 *      script â€” it is a STATE MACHINE that wakes every ten minutes, does a few minutes of work,
 *      writes down where it got to, and stops. A phase needing an hour simply takes six wake-ups.
 *   2. Apps Script cannot write to Firestore without a service account. It can write to a Sheet, so
 *      results land in a cache spreadsheet the app reads through one fast endpoint.
 *
 * The asynchronous ad and session reports suit this far better than a browser ever did: asking and
 * collecting become two different wake-ups, and nobody is sitting there watching.
 */
var NIGHTLY_START_HOUR = 5;          // script-timezone hour a fresh daily pass begins
var NIGHTLY_BUDGET_MS = 4.5 * 60000; // work per wake-up, leaving slack inside the 6-minute ceiling
var NIGHTLY_ROWS = 12000;            // Orders rows per pass
// How far back per-ASIN PER-DAY figures are kept, for date ranges that are not whole weeks.
// Short deliberately: this shape is ~50x the size of the weekly one, the browser pulls it whole,
// and Amazon only retains ad data for ~95 days anyway. Older ranges are answered from the weeks.
var ASIN_DAY_WINDOW = 45;
// 800 days, not 400: the dashboard compares this year against last year, and a YTD figure in
// December needs the whole of the previous year to sit beside it.
var NIGHTLY_DAILY_DAYS = 800;
var NIGHTLY_SHOP_STEP = 60;          // days of Shopify orders per pass
var CACHE_CELL = 40000;              // characters per cell; the hard limit is 50k

function nProp_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function nSet_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function nowStamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

/** The cache spreadsheet, created on first use; its id is remembered in Script Properties. */
function cacheSheet_() {
  var id = nProp_('CACHE_SHEET_ID');
  if (id) {
    /* A sheet that WILL NOT OPEN IS AN EMERGENCY, NOT A REASON TO START OVER.
     *
     * This used to fall through and create a fresh spreadsheet, which silently discarded every cache
     * in the old one — months of ad history read "empty" one morning with nothing to explain it, and
     * the only visible trace was that the id had changed. A transient Drive error or a moment of
     * quota is enough to trigger it, and the cost is enormous and irreversible.
     *
     * So: retry once, and if it still will not open, THROW. The nightly stops with a message a person
     * can act on. Rebuilding deliberately is a decision; having it happen while nobody is looking is
     * not. Clearing CACHE_SHEET_ID is the explicit way to ask for a new one. */
    try { return SpreadsheetApp.openById(id); }
    catch (e1) {
      Utilities.sleep(2000);
      try { return SpreadsheetApp.openById(id); }
      catch (e2) {
        nSet_('CACHE_SHEET_LOST', id + ' @ ' + nowStamp_() + ' :: ' + String(e2.message || e2).slice(0, 200));
        throw new Error('The cache spreadsheet ' + id + ' will not open, twice in a row: '
          + (e2.message || e2) + '. Nothing has been rebuilt — every cache is still in that file if it '
          + 'can be recovered. Open https://docs.google.com/spreadsheets/d/' + id + '/edit to see why. '
          + 'To deliberately start a NEW cache from scratch, clear the CACHE_SHEET_ID script property.');
      }
    }
  }
  var ss = SpreadsheetApp.create('Amazon Research â€” nightly cache');
  nSet_('CACHE_SHEET_ID', ss.getId());
  return ss;
}

/**
 * Store an object as JSON split across rows: a cell holds ~50k characters and these datasets run to
 * megabytes. Column A, one chunk per row, read back by plain concatenation.
 */
function cacheWrite_(name, obj) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var s = JSON.stringify(obj), rows = [];
  for (var i = 0; i < s.length; i += CACHE_CELL) rows.push(["'" + s.substr(i, CACHE_CELL)]);
  if (!rows.length) rows.push(["'{}"]);
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
  cacheTrim_(sh, rows.length);
  return rows.length;
}

/**
 * Cut a sheet back to the cells it actually uses.
 *
 * Every new sheet arrives as 1000 rows x 26 columns = 26,000 cells, and these sheets only ever use
 * COLUMN A. `clear()` empties content but leaves the grid at whatever size it grew to, so the waste
 * accumulates and never comes back. A spreadsheet is capped at 10 million cells, and there is no
 * reason to spend any of them on emptiness.
 *
 * Ravi spotted this looking at the cache sheet directly. It is housekeeping rather than the cause of
 * the file becoming unopenable — the sheer VOLUME OF TEXT is the likelier culprit there — but there
 * is no argument for carrying 25 empty columns on every cache either.
 */
function cacheTrim_(sh, usedRows) {
  try {
    var maxC = sh.getMaxColumns();
    if (maxC > 1) sh.deleteColumns(2, maxC - 1);
    var keep = Math.max(1, usedRows);
    var maxR = sh.getMaxRows();
    if (maxR > keep) sh.deleteRows(keep + 1, maxR - keep);
  } catch (e) { /* trimming is housekeeping — never let it fail a write that already succeeded */ }
}

/**
 * Editor: shrink EVERY sheet in the cache file to the cells it uses, and say how much came back.
 *
 * One-off for the sheets that already exist; new writes trim themselves from now on.
 */
function cacheTrimAll() {
  var ss = cacheSheet_();
  var before = 0, after = 0;
  ss.getSheets().forEach(function (sh) {
    var r0 = sh.getMaxRows(), c0 = sh.getMaxColumns();
    before += r0 * c0;
    var used = sh.getLastRow();
    cacheTrim_(sh, used);
    var r1 = sh.getMaxRows(), c1 = sh.getMaxColumns();
    after += r1 * c1;
    Logger.log(sh.getName() + ': ' + r0 + 'x' + c0 + ' -> ' + r1 + 'x' + c1
      + (used ? '  (' + used + ' row(s) of data)' : '  (empty)'));
  });
  Logger.log('TOTAL cells ' + before.toLocaleString() + ' -> ' + after.toLocaleString()
    + '  ·  ' + (before - after).toLocaleString() + ' freed. A spreadsheet allows 10,000,000.');
}

function cacheRead_(name) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), s = '';
  // The leading apostrophe forces Sheets to keep the text verbatim; it is not part of the JSON.
  for (var i = 0; i < vals.length; i++) s += String(vals[i][0] || '').replace(/^'/, '');
  try { return JSON.parse(s); } catch (e) { return null; }
}

function nState_() { try { return JSON.parse(nProp_('NIGHTLY_STATE') || '{}'); } catch (e) { return {}; } }
function nSaveState_(st) { nSet_('NIGHTLY_STATE', JSON.stringify(st)); }

/* ---------- accumulators live in the SHEET, never in Script Properties ----------
 *
 * A Script Property value is capped at 9 KB. The state started out carrying the data it was
 * collecting â€” 800 days across two brands is already past that, and the per-ASIN weekly set runs to
 * megabytes â€” so the whole nightly run would have died the moment it had gathered anything worth
 * keeping, and died quietly, because the write that fails is the one recording where it got to.
 *
 * So the state holds only the CURSOR, and each pass APPENDS its slice as one row to a scratch tab.
 * Appending is cheap and needs nothing read back; the rows are merged once, when the phase ends.
 */
/**
 * Append a slice, wiping whatever a previous pass left in this accumulator first.
 *
 * The accumulator must only ever hold slices from the pass that is running. Clearing it when a
 * fresh pass STARTS was not enough: a pass that died before its phase reached the merge left its
 * slices behind, and the next pass added its own on top. The merges add, so every figure came out
 * exactly double — for every day at once, which is what made it look like a data problem rather
 * than a bookkeeping one.
 *
 * Keying the slices did not save it either. Leftovers written before keys existed carried no key,
 * and the dedupe deliberately keeps unkeyed slices rather than risk dropping real sales — so the
 * one case that mattered was the one case it let through.
 *
 * Clearing on the FIRST append of each phase, tracked in the run's own state, makes it true by
 * construction: whatever is in there when a phase starts writing is from another pass, and goes.
 */
function accStart_(st, name) {
  st.acc = st.acc || {};
  if (st.acc[name]) return;
  accClear_(name);
  st.acc[name] = 1;
}

function accAppend_(name, obj) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName('_' + name) || ss.insertSheet('_' + name);
  var s = JSON.stringify(obj);
  // Still chunked: one pass's slice can itself exceed a cell.
  //
  // ONE setValues, not appendRow per chunk. Each appendRow is its own round-trip to Sheets, so a
  // multi-megabyte slice — which the search-term report certainly is — turned into hundreds of them
  // and ate the whole tick before it could record where it had got to. The rows are built in memory
  // and written once.
  var rows = [];
  for (var i = 0; i < s.length; i += CACHE_CELL) rows.push(["'" + s.substr(i, CACHE_CELL)]);
  rows.push(['<<END>>']);                       // marks where one appended object stops
  var at = sh.getLastRow() + 1;
  sh.getRange(at, 1, rows.length, 1).setValues(rows);
  // Scratch tabs arrive 1000x26 like any other. They only use column A, and they can be appended to
  // many times in a pass, so the empty columns are pure carried weight.
  if (sh.getMaxColumns() > 1) { try { sh.deleteColumns(2, sh.getMaxColumns() - 1); } catch (e) {} }
}

/**
 * Every appended object, in order, WITH DUPLICATE SLICES DROPPED.
 *
 * Each append carries a `k` naming the piece of work it came from â€” the workbook row it started at,
 * the ad report id, the session week. The same `k` appearing twice means the same rows were read
 * twice: a retry, a tick that died after appending but before its cursor was saved, two ticks that
 * overlapped. It has happened three separate ways now, and every time the merges ADDED the slice a
 * second time and produced sales that were exactly double for a run of days.
 *
 * Dropping repeats HERE fixes it for every merge at once, and does it structurally: it no longer
 * matters how a duplicate got written, only that it is counted once. The LAST copy wins, being the
 * more recent read of the same rows.
 *
 * A slice with no `k` is from an older append and is always kept â€” there is nothing to compare it
 * against, and silently dropping it would lose real sales.
 */
function accReadAll_(name) {
  var raw = accReadRaw_(name);
  var lastAt = {}, out = [];
  raw.forEach(function (p, i) { if (p && p.k) lastAt[p.k] = i; });
  raw.forEach(function (p, i) {
    if (!p) return;
    if (p.k && lastAt[p.k] !== i) return;          // an earlier copy of a slice read again later
    out.push(p);
  });
  return out;
}

/** Every appended object exactly as stored, duplicates and all. */
function accReadRaw_(name) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName('_' + name);
  if (!sh || sh.getLastRow() < 1) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  var out = [], buf = '';
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '');
    if (v === '<<END>>') { if (buf) { try { out.push(JSON.parse(buf)); } catch (e) {} } buf = ''; continue; }
    buf += v.replace(/^'/, '');
  }
  if (buf) { try { out.push(JSON.parse(buf)); } catch (e) {} }
  return out;
}

function accClear_(name) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName('_' + name);
  if (sh) ss.deleteSheet(sh);
}

/**
 * Editor: redo the ADS phases only, from a clean slate. Nothing else in the pass is touched.
 *
 * `nightlyRunNow` restarts everything — 800 days of orders, Shopify, the weekly rebuild — which is
 * hours of work to get at ad reports that take fifteen minutes. This resets just `adsAsk`/`adsGet`.
 *
 * It CLEARS the ad accumulators first, and that is the point of it. Slices already collected under an
 * older shape would otherwise survive the merge (they key on a report id that is no longer being
 * re-collected, so nothing replaces them) and the cache would be written in the old format from data
 * nobody can see. Starting the phase clean is the only way to be sure of what comes out.
 *
 * Then run nightlyTick() every few minutes until nightlyStatus() says the queue is empty.
 */
function adsRedo() {
  var st = nState_();
  if (!st.day) { Logger.log('No pass in progress — run nightlyRunNow() instead.'); return; }
  ['ads', 'adsAsin', 'adsAsinDay', 'srchTerm', 'targeting', 'adGroup', 'placement'].forEach(function (n) {
    accClear_(n);
    if (st.acc) delete st.acc[n];          // so accStart_ does not think it has already cleared them
  });
  st.phase = 'adsAsk';
  st.pending = [];
  nSaveState_(st);
  Logger.log('Ad phases reset. Every ad accumulator is cleared and the reports will be asked for again.');
  Logger.log('Now run nightlyTick() — wait 2-3 minutes between runs — until nightlyStatus() shows');
  Logger.log('"queued 0" and the srchTerm / targeting / adGroup / placement caches carry a stamp.');
  Logger.log('Amazon usually takes 10-20 minutes to build these, so the first few ticks will collect nothing.');
}

/** Install the wake-up. Run once from the editor; running it again replaces the old trigger. *//** Install the wake-up. Run once from the editor; running it again replaces the old trigger. */
function installNightly() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyTick').timeBased().everyMinutes(10).create();
  Logger.log('âœ… nightlyTick now runs every 10 minutes.');
  Logger.log('   Each run does a few minutes of work and stops; a fresh pass starts after '
    + NIGHTLY_START_HOUR + ':00 ' + Session.getScriptTimeZone() + '.');
  Logger.log('   Watch it with nightlyStatus().');
}

function removeNightly() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyTick') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Nightly trigger removed.');
}

function nightlyStatus() {
  var st = nState_();
  Logger.log('day       ' + (st.day || 'â€”'));
  Logger.log('phase     ' + (st.phase || 'idle'));
  Logger.log('cursor    book ' + (st.book == null ? 'â€”' : st.book) + ', row ' + (st.row || 'â€”'));
  Logger.log('queued    ' + ((st.pending || []).length) + ' ad report(s)');
  Logger.log('finished  ' + (st.finishedAt || 'not yet'));
  // WITH ITS TIME. An unstamped lastError is unreadable: a quota refusal from the 06:00 tick looks
  // exactly like one from a minute ago, and the two mean opposite things — one is history, the other
  // is the reason nothing is moving. Old errors were being chased as if they were live.
  if (st.lastError) Logger.log('last error ' + (st.lastErrorAt ? '[' + st.lastErrorAt + '] ' : '[time unknown — recorded before stamping] ') + st.lastError);
  // The weekly cache's own verdict on itself, from the last time it was published. This is the one
  // that used to go unchecked, so it gets a line of its own rather than a footnote.
  var wc = st.weeklyCheck;
  if (!wc) Logger.log('weekly check  not run yet - it happens when the weekly phase publishes');
  else if (wc.bad && wc.bad.length) {
    Logger.log('weekly check  ' + wc.bad.length + ' WEEK(S) DISAGREE with the daily cache  (' + (wc.at || '?') + ')');
    wc.bad.forEach(function (b) {
      Logger.log('   ' + b.brand + '  ' + b.wk + '  weekly ' + b.weekly + '  vs daily ' + b.daily + '  ' + b.ratio + 'x');
    });
    Logger.log('   run weeklyAudit(0) / weeklyAudit(1) to see which ASINs are behind it');
  } else Logger.log('weekly check  OK - ' + (wc.checked || 0) + ' week(s) match the daily cache  (' + (wc.at || '?') + ')');
  ['daily', 'weekly', 'dailyAsin', 'ads', 'adsAsin', 'adsAsinDay',
   'srchTerm', 'targeting', 'adGroup', 'placement', 'shopSku', 'shopSkuCPC', 'sessions'].forEach(function (n) {
    var c = cacheRead_(n);
    Logger.log('cache ' + n + ': ' + (c ? ('ok Â· updated ' + (c.at || '?')
      + (c.from ? ' Â· from ' + c.from : '')) : 'empty'));
  });
  var lost = nProp_('CACHE_SHEET_LOST');
  if (lost) {
    Logger.log('⚠️ THE CACHE SHEET WAS REPLACED — every cache was lost and is rebuilding.');
    Logger.log('   old sheet ' + lost);
    Logger.log('   clear the CACHE_SHEET_LOST script property once this is understood.');
  }
  var id = nProp_('CACHE_SHEET_ID');
  if (id) Logger.log('cache sheet https://docs.google.com/spreadsheets/d/' + id + '/edit');
}

/**
 * Force a fresh pass now, without waiting for the start hour.
 *
 * Takes the same lock a tick does, and says so rather than pretending. Clearing the state while a
 * tick is mid-flight achieved nothing: that tick finishes on the state it read at the start and
 * saves it back over the reset, so the pass carries on from where it was and the person who asked
 * for a fresh one has no way to tell it did not happen.
 */
function nightlyRunNow() {
  var lock = LockService.getScriptLock();
  // WAITS for the running tick rather than giving up. A tick lasts about five minutes and the
  // trigger fires every ten, so tryLock(0) turned a one-click reset into a guessing game about
  // which half of the ten minutes you were in. This just sits until the tick is done.
  Logger.log('Waiting for any running tick to finishâ€¦ (up to 8 minutes)');
  if (!lock.tryLock(8 * 60 * 1000)) {
    Logger.log('A tick held the lock for the whole wait, so the reset was NOT done. Try again.');
    return;
  }
  try {
    var st = nState_();
    // An explicit flag, not just a blank day. The day check depends on the very state being
    // replaced, so a reset that failed to take looked exactly like one that worked.
    nSaveState_({ day: '', reset: true, sessDone: st.sessDone || {} });
    var back = nState_();
    Logger.log(back.reset
      ? 'Cleared and verified — the next nightlyTick starts a fresh pass.'
      : 'âš  The reset did NOT stick: the state still reads ' + JSON.stringify(back).slice(0, 200));
    Logger.log('To go immediately, run nightlyTick() yourself â€” repeatedly, until nightlyStatus() says done.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * One wake-up. Advances whatever phase the run is in, for a few minutes, then stops.
 * The phases run in dependency order and every one of them is resumable â€” that is the whole point.
 */
function nightlyTick() {
  // ONE TICK AT A TIME, always.
  //
  // The 10-minute trigger and a Run from the editor are two different callers of this same function,
  // and nothing stopped them overlapping. Two ticks that start together read the same cursor, scan
  // the same rows and both append the slice â€” and the merges ADD, so those orders get counted twice.
  // The result is a sales figure that is simply too high, with nothing anywhere to say so.
  //
  // tryLock(0), not a wait: a tick that cannot get in has nothing useful to do, and the next one is
  // ten minutes away.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('Another tick is already running â€” skipped.');
    return;
  }
  try {
    nightlyTickLocked_();
  } finally {
    lock.releaseLock();
  }
}

function nightlyTickLocked_() {
  var t0 = new Date().getTime();
  var left = function () { return NIGHTLY_BUDGET_MS - (new Date().getTime() - t0); };
  var st = nState_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));

  // What this tick decided and why. Without it, "the reset did not take" is impossible to tell
  // apart from "the reset took and the pass was quick", and both have happened.
  Logger.log('tick: day=' + (st.day || '(none)') + ' today=' + today + ' hour=' + hour
    + ' phase=' + (st.phase || '(none)') + ' reset=' + (st.reset ? 'yes' : 'no'));

  // A new day starts the moment the clock passes the start hour â€” not on a rolling 24h timer, which
  // drifts a little each run and eventually kicks off in the middle of the afternoon.
  //
  // `reset` is an EXPLICIT request from nightlyRunNow and is honoured whatever the clock says. The
  // day check alone was ambiguous: it depends on the state that is being replaced, so when a reset
  // silently failed to take there was no way to tell from the outside.
  if (st.reset || (st.day !== today && hour >= NIGHTLY_START_HOUR)) {
    Logger.log('tick: starting a FRESH pass' + (st.reset ? ' (asked for by nightlyRunNow)' : ''));
    st = { day: today, phase: 'daily', book: 0, row: 2, daily: {}, weekly: {},
           pending: [], acc: {}, sessDone: (st.sessDone || {}) };
    // Start every pass with empty scratch tabs. Each phase clears its own once it has merged, but a
    // pass abandoned half way â€” the clock rolling past the start hour while reports were still
    // pending, a phase erroring out â€” leaves slices behind. The merges ADD, so those leftovers would
    // be counted a second time tonight and the week would report more spend than was ever bought.
    ['daily', 'weekly', 'dayAsin', 'ads', 'adsAsin', 'adsAsinDay',
     'srchTerm', 'targeting', 'adGroup', 'placement', 'shopSku', 'sessions'].forEach(accClear_);
    nSaveState_(st);
  }
  if (!st.day || st.phase === 'done') return;

  try {
    while (left() > 20000) {
      // SAVE AFTER EVERY STEP, not once at the end.
      //
      // A step appends its slice to the scratch tab and moves the cursor past it, but the cursor
      // only becomes real when the state is written. Saving once at the end meant an execution that
      // died â€” a 30-minute timeout on a slow Sheets read is the way it actually happens â€” left every
      // slice it had appended sitting there with the cursor still pointing at the first of them. The
      // next tick re-read those same rows and appended them a second time, and the merges ADD, so
      // the sales came out higher than they ever were. Saving per step costs one Properties write
      // and bounds the damage at a single slice.
      if (st.phase === 'daily') { if (!nPhaseOrders_(st, 'daily')) { nSaveState_(st); break; } }
      else if (st.phase === 'shop') { if (!nPhaseShop_(st, left)) { nSaveState_(st); break; } }
      else if (st.phase === 'shopSku') { if (!nPhaseShopSku_(st, left)) { nSaveState_(st); break; } }
      else if (st.phase === 'weekly') { if (!nPhaseOrders_(st, 'weekly')) { nSaveState_(st); break; } }
      else if (st.phase === 'adsAsk') { nPhaseAdsAsk_(st); }
      else if (st.phase === 'adsGet') { if (!nPhaseAdsGet_(st, left)) { nSaveState_(st); break; } }
      else if (st.phase === 'sess') { if (!nPhaseSessions_(st, left)) { nSaveState_(st); break; } }
      else break;
      nSaveState_(st);
    }
  } catch (e) {
    st.lastErrorAt = nowStamp_(); st.lastError = String(e.message || e).slice(0, 300);
  }
  nSaveState_(st);
}

/** Orders scan, one bounded slice per call, moving through books then on to the next phase. */
function nPhaseOrders_(st, kind) {
  var r = kind === 'daily'
    ? dailySalesChunk_(st.book, st.row, NIGHTLY_ROWS, NIGHTLY_DAILY_DAYS)
    : weeklySalesChunk_(st.book, st.row, NIGHTLY_ROWS, 26, true);   // true: also bucket by day
  if (!r.ok) {
    st.lastErrorAt = nowStamp_(); st.lastError = r.error;
    st.phase = (kind === 'daily') ? 'weekly' : 'adsAsk'; st.book = 0; st.row = 2;
    return true;
  }
  var brand = st.book === 0 ? 'SP' : 'CPC';
  // Appended, not held in the state â€” see the note on accAppend_.
  // Keyed by exactly which rows this is: the same book and start row can only mean the same orders,
  // however many times it gets appended.
  var sliceKey = kind + '|' + st.book + '|' + st.row;
  accStart_(st, kind);
  accAppend_(kind, { k: sliceKey, brand: brand, d: (kind === 'daily' ? (r.dates || {}) : (r.asins || {})) });
  // The weekly pass buckets the same rows by day as well, for the recent window. Written to its own
  // accumulator so the two shapes stay separable, but read from the one scan.
  if (kind === 'weekly' && r.asinDays && Object.keys(r.asinDays).length) {
    accStart_(st, 'dayAsin');
    accAppend_('dayAsin', { k: sliceKey, brand: brand, d: r.asinDays });
  }

  if (!r.done && r.next) { st.row = r.next; return true; }
  st.book++; st.row = 2;
  if (st.book < (r.books || ORDERS_DATA_IDS.length)) return true;
  st.book = 0;
  if (kind === 'daily') { st.phase = 'shop'; st.shopTo = ''; }
  else {
    var wkRows = nMergeWeekly_();
    // Checked BEFORE it is published, against the cache that is already proven against the sheet.
    // Published either way: a tab with sales somebody has been warned about beats a tab with none,
    // and there is nothing to put back if this is thrown away. The verdict travels with the cache
    // and sits in nightlyStatus, so a bad week is a thing that gets noticed rather than a thing
    // somebody eventually spots in an average six weeks wide.
    st.weeklyCheck = nWeekVsDay_(wkRows);
    st.weeklyCheck.at = nowStamp_();
    if (st.weeklyCheck.bad.length) {
      Logger.log('WEEKLY CACHE DISAGREES with the daily cache on '
        + st.weeklyCheck.bad.length + ' week(s): '
        + st.weeklyCheck.bad.map(function (b) {
            return b.brand + ' ' + b.wk + ' weekly ' + b.weekly + ' vs daily ' + b.daily + ' (' + b.ratio + 'x)';
          }).join(' Â· ')
        + '  -- run weeklyAudit(0) / weeklyAudit(1) to see which ASINs.');
    }
    cacheWrite_('weekly', { at: nowStamp_(), rows: wkRows, check: st.weeklyCheck });
    cacheWrite_('dailyAsin', { at: nowStamp_(), from: dayWindowFrom_(), d: nMergeDayAsin_() });
    accClear_('weekly'); accClear_('dayAsin');
    st.phase = 'adsAsk';
  }
  return true;
}

/** The oldest day per-ASIN daily figures are kept for, as the marketplace reckons it. */
function dayWindowFrom_() {
  return Utilities.formatDate(new Date(Date.now() - ASIN_DAY_WINDOW * 86400000), ORDERS_PT, 'yyyy-MM-dd');
}

/**
 * Fold every appended per-ASIN daily slice into { brand: { asin: { day: [units, revenue] } } }.
 *
 * ADDS, like the weekly merge it rides along with, and for the same reason: the workbook is walked
 * 12,000 rows at a time, so one day's orders arrive spread across however many slices they fell in.
 */
function nMergeDayAsin_() {
  var out = {};
  accReadAll_('dayAsin').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byDay = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byDay).forEach(function (day) {
        var v = byDay[day], c = row[day] || (row[day] = [0, 0]);
        c[0] += v[0] || 0;
        c[1] = Math.round((c[1] + (v[1] || 0)) * 100) / 100;
      });
    });
  });
  return out;
}

/** Fold every appended daily slice into { brand: { date: [sales, units, orders] } }. */
function nMergeDaily_() {
  var out = {};
  // Recorded in the execution log, so a cache that comes out wrong can be traced to what went into
  // it without having to catch the run in the act.
  var raw = accReadRaw_('daily'), kept = accReadAll_('daily');
  Logger.log('merge daily: ' + raw.length + ' slice(s) written, ' + kept.length + ' counted, '
    + (raw.length - kept.length) + ' dropped as repeats');
  kept.forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (day) {
      var v = part.d[day], b = into[day] || (into[day] = [0, 0, 0]);
      b[0] = Math.round((b[0] + v[0]) * 100) / 100; b[1] += v[1]; b[2] += v[2];
    });
  });
  return out;
}

/** Fold every appended ad slice into { brand: { date: [impr, clicks, spend, orders, sales] } }. */
function nMergeAds_() {
  var out = {};
  accReadAll_('ads').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    // A later slice for the same day REPLACES an earlier one rather than adding to it: the report
    // is a full statement of that day, so adding would double whatever the overlap covered.
    Object.keys(part.d || {}).forEach(function (day) { into[day] = part.d[day]; });
  });
  return out;
}

/**
 * Fold every appended per-ASIN ad slice into { brand: { asin: { week: [impr, clicks, spend, orders,
 * sales] } } } â€” the shape the PPC & Organic grid works in.
 *
 * ADDS where the daily merge above REPLACES, and the difference matters. The slices are disjoint
 * runs of days, so a DAY only ever appears in one of them and replacing is safe. A WEEK is not:
 * the 31-day slices cut straight through the middle of one, and replacing there would throw away
 * whichever half arrived first and report a week at part of its real spend.
 */
/**
 * The three wide reports, per brand.
 *
 * REPLACES where the per-ASIN merge ADDS, and that is right here: each of these is ONE report
 * covering the whole window, so a second slice for the same brand is the same report read again —
 * a retry, not another piece. Adding would double every term in it.
 */
function nMergeWide_(name) {
  var out = {};
  accReadAll_(name).forEach(function (part) { if (part && part.brand) out[part.brand] = part.d; });
  return out;
}

function nMergeAdsAsin_() {
  var out = {};
  accReadAll_('adsAsin').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byWeek = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byWeek).forEach(function (wk) {
        var v = byWeek[wk], c = row[wk] || (row[wk] = [0, 0, 0, 0, 0]);
        c[0] += v[0] || 0; c[1] += v[1] || 0;
        c[2] = Math.round((c[2] + (v[2] || 0)) * 100) / 100;
        c[3] += v[3] || 0;
        c[4] = Math.round((c[4] + (v[4] || 0)) * 100) / 100;
      });
    });
  });
  return out;
}

/**
 * Fold every appended per-ASIN daily ad slice into
 * { brand: { asin: { day: [impr, clicks, spend, orders, sales] } } }.
 *
 * REPLACES per day, unlike the per-week merge beside it. The 31-day slices are disjoint runs of
 * days, so a day only ever comes from one of them â€” whereas a WEEK is cut in half by the boundary
 * between two slices and has to be added up.
 */
function nMergeAdsAsinDay_() {
  var out = {};
  accReadAll_('adsAsinDay').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byDay = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byDay).forEach(function (day) { row[day] = byDay[day]; });
    });
  });
  return out;
}

/** Fold every appended session slice into { brand: { asin: { week: [sessions, pageViews] } } }. */
function nMergeSessions_() {
  var out = {};
  accReadAll_('sessions').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      (into[asin] || (into[asin] = {}))[part.week] = part.d[asin];
    });
  });
  return out;
}

/** Fold every appended weekly slice into { brand: { asin: { week: [units, sales] } } }. */
function nMergeWeekly_() {
  var out = {};
  accReadAll_('weekly').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byWeek = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byWeek).forEach(function (wk) {
        var v = byWeek[wk], c = row[wk] || (row[wk] = [0, 0]);
        c[0] += v[0]; c[1] = Math.round((c[1] + v[1]) * 100) / 100;
      });
    });
  });
  return out;
}

/**
 * The per-ASIN weekly totals against the account daily totals, week by week.
 *
 * These two caches are built by different phases from the same workbook, so they must agree. The
 * daily one is the side dailyAudit already proves against the sheet, which makes it the reference:
 * where they differ, the weekly side is the one that moved.
 *
 * Run at the moment the weekly cache is about to be published, which is the last point anybody is
 * looking. It costs nothing â€” both sets are already in hand, and no workbook is read again.
 *
 * Only WHOLE weeks the daily window covers are compared, and never the week in progress: the two
 * phases run minutes apart, so a live week can legitimately differ by whatever arrived between them.
 */
function nWeekVsDay_(rows) {
  var c = cacheRead_('daily');
  var daily = (c && c.d) || {};
  var todayPt = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var thisWeek = weekKeyOf_(Date.parse(todayPt + 'T00:00:00Z'));
  var out = { checked: 0, bad: [] };

  Object.keys(rows || {}).forEach(function (brand) {
    var byDay = daily[brand];
    if (!byDay) return;                                   // nothing to compare against yet
    var days = Object.keys(byDay).sort();
    if (!days.length) return;
    var lo = days[0], hi = days[days.length - 1];

    var wk = {}, byAsin = rows[brand] || {};
    Object.keys(byAsin).forEach(function (a) {
      var byWeek = byAsin[a] || {};
      Object.keys(byWeek).forEach(function (w) { wk[w] = (wk[w] || 0) + ((byWeek[w] && byWeek[w][1]) || 0); });
    });

    var dw = {};
    days.forEach(function (day) {
      var w = weekKeyOf_(Date.parse(day + 'T00:00:00Z'));
      dw[w] = (dw[w] || 0) + ((byDay[day] && byDay[day][0]) || 0);
    });

    Object.keys(wk).sort().forEach(function (w) {
      if (w >= thisWeek) return;
      // Whole week inside the daily window, judged by DATE rather than by counting seven entries:
      // a day with no orders has no entry at all, and skipping the week for that would quietly stop
      // checking the quiet weeks.
      var end = Utilities.formatDate(new Date(Date.parse(w + 'T00:00:00Z') + 6 * 86400000), 'UTC', 'yyyy-MM-dd');
      if (w < lo || end > hi) return;
      out.checked++;
      var a = Math.round(wk[w]), b = Math.round(dw[w] || 0);
      var ratio = b ? a / b : 0;
      if (Math.abs(ratio - 1) > 0.02) {
        out.bad.push({ brand: brand, wk: w, weekly: a, daily: b, ratio: Math.round(ratio * 100) / 100 });
      }
    });
  });
  return out;
}

/**
 * Shopify daily totals, walked backwards a couple of months at a time.
 *
 * Stored under the brand key 'SHOP' alongside Ridhi and CPC, in the same [sales, units, orders]
 * shape â€” so every total, comparison and chart in the dashboard treats it as just another channel
 * without a single special case.
 */
function nPhaseShop_(st, left) {
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var finish = function () {
    cacheWrite_('daily', { at: nowStamp_(), d: nMergeDaily_() });
    accClear_('daily');
    st.phase = 'shopSku';
    return true;
  };
  if (!prop_('SHOPIFY_STORE') || !prop_('SHOPIFY_TOKEN')) {
    st.shopNote = 'Shopify skipped â€” SHOPIFY_STORE / SHOPIFY_TOKEN not set.';
    return finish();
  }
  var oldest = new Date(Date.now() - NIGHTLY_DAILY_DAYS * 86400000);
  var to = st.shopTo ? new Date(st.shopTo + 'T00:00:00Z') : new Date();
  if (to.getTime() < oldest.getTime()) return finish();        // walked the whole window
  var from = new Date(Math.max(oldest.getTime(), to.getTime() - NIGHTLY_SHOP_STEP * 86400000));
  try {
    var r = shopifyDaily_(iso(from), iso(to), Date.now() + Math.max(20000, left() - 20000));
    // The Shopify walk is keyed by the slice of dates it covers, for the same reason.
    accStart_(st, 'daily');
    accAppend_('daily', { k: 'shop|' + iso(from) + '|' + iso(to), brand: 'SHOP', d: r.dates || {} });
    // Step back past the slice just done. `more` means the page walk ran out of time, so the same
    // slice is retried next wake-up rather than half of it being silently accepted.
    if (!r.more) st.shopTo = iso(new Date(from.getTime() - 86400000));
  } catch (e) {
    st.lastErrorAt = nowStamp_(); st.lastError = 'shopify: ' + String(e.message || e).slice(0, 200);
    return finish();
  }
  return left() > 30000;
}

/**
 * Shopify per SKU: 90 days of sales, then what is on hand right now.
 *
 * Its own phase rather than a job inside nPhaseShop_, because the two want different things. That one
 * walks 800 days for account totals and deliberately does NOT ask for line items — they are most of
 * the payload. This one needs line items but only reaches back 90 days, which is a few hundred
 * orders. Folding them together would have meant carrying line items across 800 days to use 90.
 *
 * Sales first and stock LAST, in that order. Stock is an instant, not a window, so it is taken as
 * close as possible to the moment the cache is published.
 */
/* BOTH STORES (Ravi, 2026-09-29: "shopify stock CPC ke liye bhi add karo"): Ridhi's figures go to the cache
 * 'shopSku' as before, CPC's to 'shopSkuCPC', in the same shape. */
var SHOP_SKU_STORES = ['', 'CPC'];
function shopSkuCacheName_(shop) { return String(shop || '').toUpperCase() === 'CPC' ? 'shopSkuCPC' : 'shopSku'; }

/** One store's 90 days of sales per SKU and its stock now, written to its cache. {ok, more, skipped}. */
function shopSkuBuild_(shop, deadlineMs) {
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  setShopBrand_(shop);
  try {
    if (!prop_(SHOP_PREFIX + 'SHOPIFY_STORE') || !prop_(SHOP_PREFIX + 'SHOPIFY_TOKEN')) return { ok: false, skipped: true };
    var to = new Date(), from = new Date(to.getTime() - SHOP_SKU_DAYS * 86400000);
    var s = shopifySkuSales_(iso(from), iso(to), deadlineMs - 30000);
    // A part-walked window is NOT written. Half the orders would read as a real 90-day figure and
    // every reorder built on it would be short, with nothing on screen to say why.
    if (s.more) return { ok: false, more: true };
    var stock = shopifyStock_(deadlineMs - 5000);
    cacheWrite_(shopSkuCacheName_(shop), {
      at: nowStamp_(), from: iso(from), to: iso(to), days: SHOP_SKU_DAYS,
      orders: s.n, d: s.d, shop: String(shop || '').toUpperCase() === 'CPC' ? 'CPC' : 'SP',
      d30: s.d30, orders30: s.n30, from30: s.from30,
      // Absent rather than empty when the stock walk did not finish — see the note in the app: no
      // stock figure and zero stock are different answers.
      stock: stock.more ? null : stock.stock,
      stockAt: stock.more ? '' : nowStamp_(),
    });
    return { ok: true, more: false, orders: s.n, skus: Object.keys(s.d).length, stockSkus: stock.more ? 0 : Object.keys(stock.stock).length };
  } finally { setShopBrand_(''); }
}

function nPhaseShopSku_(st, left) {
  var done = function () { st.phase = 'weekly'; st.book = 0; st.row = 2; st.shopSkuI = 0; return true; };
  st.shopSkuI = st.shopSkuI || 0;
  while (st.shopSkuI < SHOP_SKU_STORES.length) {
    var r;
    try { r = shopSkuBuild_(SHOP_SKU_STORES[st.shopSkuI], Date.now() + Math.max(20000, left())); }
    catch (e) {
      st.lastErrorAt = nowStamp_(); st.lastError = 'shopSku' + (SHOP_SKU_STORES[st.shopSkuI] || '') + ': ' + String(e.message || e).slice(0, 200);
      r = { ok: false };
    }
    if (r.more) return false;                  // the same store again on the next wake-up
    st.shopSkuI++;
    if (st.shopSkuI < SHOP_SKU_STORES.length && left() < 90000) return false;
  }
  return done();
}

/** Ask for every ad report the run needs. Instant â€” only ids come back. */
function nPhaseAdsAsk_(st) {
  var end0 = new Date(Date.now() - 86400000);
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  st.pending = [];
  ['SP', 'CPC'].forEach(function (brand) {
    setBrand_(brand);
    /* ADS_BACK is 93, not 95, and the start is clamped as well.
     *
     * Amazon keeps Sponsored Products data for about 95 days and refuses a report that starts even
     * ONE day earlier: "startDate (2026-05-15) must be equal to or after report type data retention
     * start date (2026-05-16)". At exactly 95 the oldest window sits on that boundary, and the dates
     * are built by subtracting milliseconds and then formatting in PT — which can land a day early
     * all by itself, the same zone shift that has caused trouble here before. So the oldest slice was
     * rejected EVERY night, quietly, and the far end of the ad history simply never arrived.
     *
     * Two days of margin costs two days of the oldest week — which was never reliably there — and
     * buys a backfill that actually completes. */
    var ADS_BACK = 93;
    var oldest = new Date(end0.getTime() - ADS_BACK * 86400000);
    for (var off = 0; off < ADS_BACK; off += 31) {
      var e = new Date(end0.getTime() - off * 86400000);
      var s = new Date(e.getTime() - Math.min(30, ADS_BACK - off - 1) * 86400000);
      if (s.getTime() < oldest.getTime()) s = oldest;      // never ask past what Amazon still holds
      try {
        var c = ppcCreateRange_(iso(s), iso(e));
        if (c.ok && c.reportId) st.pending.push({ brand: brand, kind: 'ppc', start: iso(s), end: iso(e), id: c.reportId });
      } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ads ask ' + brand + ': ' + String(err.message || err).slice(0, 160); }
    }
    // Search terms, targeting and the ad-group→ASIN map: ONE 30-day window each, not the 95 days the
    // PPC report walks back over. A search term report is orders of magnitude wider than a per-ASIN
    // one, and "what are people typing" is a question about the recent window anyway.
    var we = end0, ws = new Date(end0.getTime() - 29 * 86400000);
    ['st', 'tgt', 'ag', 'plc'].forEach(function (kind) {
      try {
        var w = adsWideCreate_(kind, iso(ws), iso(we));
        if (w.ok && w.reportId) st.pending.push({ brand: brand, kind: kind, start: iso(ws), end: iso(we), id: w.reportId });
        else {
          // "?" told us nothing. An ask can come back ok:true with an EMPTY reportId, which is a
          // different failure from a rejected configuration and needs naming as one.
          st.lastErrorAt = nowStamp_();
          st.lastError = 'ads ask ' + brand + ' ' + kind + ': '
            + (w.error || (w.ok ? 'accepted but returned no reportId (status ' + (w.status || '?') + ')' : 'unknown'));
        }
      } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ads ask ' + brand + ' ' + kind + ': ' + String(err.message || err).slice(0, 160); }
    });
  });
  st.phase = 'adsGet';
}

/** Collect whatever Amazon has finished; anything still building waits for the next wake-up. */
function nPhaseAdsGet_(st, left) {
  st.pending = st.pending || [];
  // One download, two shapes, two caches: whole-account per day for the Ad Console, per ASIN per
  // week for PPC & Organic. Both are written together so neither can be left a night behind.
  var finish = function () {
    cacheWrite_('ads', { at: nowStamp_(), d: nMergeAds_() });
    cacheWrite_('adsAsin', { at: nowStamp_(), d: nMergeAdsAsin_() });
    cacheWrite_('adsAsinDay', { at: nowStamp_(), from: dayWindowFrom_(), d: nMergeAdsAsinDay_() });
    cacheWrite_('srchTerm', { at: nowStamp_(), d: nMergeWide_('srchTerm') });
    cacheWrite_('targeting', { at: nowStamp_(), d: nMergeWide_('targeting') });
    cacheWrite_('adGroup', { at: nowStamp_(), d: nMergeWide_('adGroup') });
    cacheWrite_('placement', { at: nowStamp_(), d: nMergeWide_('placement') });
    // Whether each product ad is running today — read, never written (2026-10-03).
    try { adStateAll_(); } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ad state: ' + String(err.message || err).slice(0, 160); }
    accClear_('ads'); accClear_('adsAsin'); accClear_('adsAsinDay');
    accClear_('srchTerm'); accClear_('targeting'); accClear_('adGroup'); accClear_('placement');
    st.phase = 'sess';
    return true;
  };
  if (!st.pending.length) return finish();
  var still = [];
  for (var i = 0; i < st.pending.length; i++) {
    var job = st.pending[i];
    var kind = job.kind || 'ppc';
    // A search term report is far bigger to download, ungzip and fold than a per-ASIN one, so it
    // needs more of the tick left before it is worth starting. Running out mid-parse costs the
    // whole tick and the job comes back untouched anyway.
    if (left() < (kind === 'ppc' ? 25000 : 60000)) { still = still.concat(st.pending.slice(i)); break; }
    setBrand_(job.brand);
    try {
      var s = ppcStatus_(job.id);
      if (/fail|cancel/i.test(s.status || '')) continue;      // dropped: it will never arrive
      if (!s.ready) { still.push(job); continue; }
      if (kind === 'ppc') {
        var d = ppcFetch_(job.id, 'both');
        accStart_(st, 'ads');
        accAppend_('ads', { k: 'ads|' + job.id, brand: job.brand, d: d.dates || {} });
        accStart_(st, 'adsAsin');
        accAppend_('adsAsin', { k: 'ads|' + job.id, brand: job.brand, d: d.asins || {} });
        if (d.asinDays && Object.keys(d.asinDays).length) {
          accStart_(st, 'adsAsinDay');
          accAppend_('adsAsinDay', { k: 'ads|' + job.id, brand: job.brand, d: d.asinDays });
        }
      } else if (kind === 'st') {
        var f = adsWideFoldSt_(adsWideRows_(job.id));
        accStart_(st, 'srchTerm');
        accAppend_('srchTerm', { k: 'st|' + job.id, brand: job.brand,
          d: { rows: f.rows, names: f.names, dropped: f.dropped, dropSpend: f.dropSpend,
               minClicks: f.minClicks, from: job.start, to: job.end } });
      } else if (kind === 'tgt') {
        accStart_(st, 'targeting');
        accAppend_('targeting', { k: 'tgt|' + job.id, brand: job.brand,
          d: (function (f) { return { rows: f.rows, names: f.names, from: job.start, to: job.end }; })(adsWideFoldTgt_(adsWideRows_(job.id))) });
      } else if (kind === 'ag') {
        accStart_(st, 'adGroup');
        accAppend_('adGroup', { k: 'ag|' + job.id, brand: job.brand, d: adsWideFoldAg_(adsWideRows_(job.id)) });
      } else if (kind === 'plc') {
        accStart_(st, 'placement');
        accAppend_('placement', { k: 'plc|' + job.id, brand: job.brand,
          d: adsWideFoldPlc_(adsWideRows_(job.id)) });
      }
    } catch (e) { still.push(job); }                          // a blip â€” try again next wake-up
  }
  st.pending = still;
  if (!st.pending.length) return finish();
  return false;
}

/**
 * Sessions: one SP-API report per brand per week. The slowest phase by far, and the one that gains
 * most from running overnight. A week already collected is never asked for again â€” only the current,
 * still-changing week is.
 */
function nPhaseSessions_(st, left) {
  st.sessDone = st.sessDone || {};
  var weeks = weeklyKeys_(26);
  var current = weeks[weeks.length - 1];
  /* The CURRENT week for every brand first, then the backfill ALTERNATING brands.
   *
   * This used to be "every outstanding week of SP, then every outstanding week of CPC". With one
   * report per wake-up (see below) that meant CPC was not asked for anything at all until SP's whole
   * 26-week backfill had finished — several nights of it — so CPC had no sessions and no page views
   * for any week, including the current one. On Parent Listing Review that read as a brand nobody
   * visits, sitting next to real units and real sales.
   *
   * Alternating costs nothing and makes starving one brand impossible. The current week goes first
   * because it is the one every tab shows, and it is re-asked every pass regardless of sessDone —
   * the week is still changing. */
  var jobs = [];
  ['SP', 'CPC'].forEach(function (brand) { jobs.push({ brand: brand, week: current }); });
  for (var i = weeks.length - 2; i >= 0; i--) {
    ['SP', 'CPC'].forEach(function (brand) {
      if (!st.sessDone[brand + '|' + weeks[i]]) jobs.push({ brand: brand, week: weeks[i] });
    });
  }
  if (!jobs.length) {
    cacheWrite_('sessions', { at: nowStamp_(), d: nMergeSessions_() });
    accClear_('sessions');
    st.phase = 'done'; st.finishedAt = nowStamp_();
    return true;
  }
  // ONE report per wake-up, not a burst.
  //
  // SP-API allows report creation at roughly one a minute after a small burst, and asking for 52 in
  // a row spends that burst in seconds and then earns a QuotaExceeded for everything after it. The
  // trigger already fires every ten minutes, so pacing to one per wake-up costs nothing that matters
  // — the whole point of running overnight is that it does not have to be quick — and it never
  // trips the limit. A backfill takes a couple of nights instead of one, and then only the current
  // week is ever asked for again.
  var perTick = 1;
  for (var j = 0; j < jobs.length && j < perTick; j++) {
    if (left() < 45000) return false;
    var job = jobs[j];
    setBrand_(job.brand);
    var end = Utilities.formatDate(new Date(new Date(job.week + 'T00:00:00Z').getTime() + 6 * 86400000), 'UTC', 'yyyy-MM-dd');
    try {
      var c = trafficCreate_(job.week, end);
      if (!c.reportId) continue;
      // Waited on here rather than across wake-ups: these are small and usually quick, and a second
      // queue for them would double the bookkeeping for very little gain.
      var got = null;
      for (var k = 0; k < 12 && left() > 25000; k++) {
        Utilities.sleep(10000);
        var s = trafficStatus_(c.reportId);
        if (s.dead) { got = {}; break; }                      // no data that week â€” a real answer
        if (s.ready) { got = (trafficFetch_(s.doc).asins || {}); break; }
      }
      if (got == null) return false;
      var slice = {};
      Object.keys(got).forEach(function (a) { slice[a] = [got[a][0], got[a][1]]; });
      accStart_(st, 'sessions');
      accAppend_('sessions', { k: 'sess|' + job.brand + '|' + job.week, brand: job.brand, week: job.week, d: slice });
      st.sessDone[job.brand + '|' + job.week] = 1;
      nSaveState_(st);
    } catch (e) {
      var m = String(e.message || e);
      st.lastErrorAt = nowStamp_(); st.lastError = 'sessions: ' + m.slice(0, 160);
      // A quota refusal is not a failure to retry harder at — it is a request to come back later.
      if (/429|quota/i.test(m)) return false;
    }
  }
  // Written out after every week collected, so a run that stops half way still leaves the sessions
  // it did gather usable rather than holding them hostage until the whole backfill finishes.
  cacheWrite_('sessions', { at: nowStamp_(), d: nMergeSessions_() });
  return false;
}

