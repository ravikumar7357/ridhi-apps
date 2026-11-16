/* Pricing-API / ListingMatch.gs — Amazon's OWN listing data, so every Sellora Listing screen matches Seller Central
 * (the backend: what we submitted, Amazon's status and issues) and the catalog (what shoppers see).
 *
 * A NEW FILE THAT CHANGES NOTHING ELSE. Same shape as AmazonMatch.gs: its own 10-minute timer (lmTick), its own state
 * (Script Property LM_STATE), its own lease (LM_LEASE — never LockService's script lock, which the nightly run holds),
 * work cut into ticks of about 4.5 minutes that carry on where the last one stopped. It never changes anything at
 * Amazon (reads and reports only) and never edits another file's data.
 *
 * WHAT IT READS, both brands (SP = Ridhi, CPC), amazon.com:
 *   1. All Listings report        GET_MERCHANT_LISTINGS_ALL_DATA → every SKU: ASIN, status (Active/Inactive…),
 *                                 quantity, price, fulfilment channel. The SKU list of a full pass comes from here.
 *   2. Suppressed listings report  GET_MERCHANTS_LISTINGS_FYP_REPORT (Seller Central "Fix your products") → the
 *                                 suppressed SKUs and Amazon's reason. "Suppressed" comes ONLY from this report, or
 *                                 from a status that is BUYABLE without DISCOVERABLE.
 *   3. FBA stock                  the report Sellora already uses for stock (Listing Health / stock/{brand}):
 *                                 GET_FBA_INVENTORY_PLANNING_DATA through ageCreate_ / agePoll_, the afn-fulfillable
 *                                 column ("Available" in Seller Central).
 *   4. Listings Items API          searchListingsItems by SKU, 20 a call, includedData=summaries,attributes,issues:
 *                                 status, product type, issues, title, bullets, description, Item Highlights
 *                                 (title_differentiation), search terms (generic_keyword), variation attributes and
 *                                 our picture slots MAIN, PT01–PT08, SWCH.
 *   5. Catalog Items 2022-04-01    20 ASINs a call (summaries,images,relationships,attributes,classifications,
 *                                 salesRanks): the title shoppers see, live pictures with width/height, parent ↔
 *                                 children with the variation theme and its values, browse path, sales ranks.
 *                                 A+ is NOT in the catalog API: `aplus` stays null ("not read"), never false.
 *
 * WHEN (script time zone, Asia/Kolkata):
 *   full pass   at 13:00 and 18:00 — the three reports, then every SKU and every ASIN read again;
 *   light pass  09:00–21:00, on the first tick at least LM_LIGHT_EVERY_MIN minutes after the last one — only the
 *               listings Amazon says changed since the last pass (lastUpdatedAfter), and their catalog entries;
 *               if Amazon refuses that question, the LM_LIGHT_MAX listings read longest ago instead.
 *   lmTick every 10 minutes drives both. A full pass spans several ticks (Amazon builds reports in minutes).
 *
 * NEVER EMPTY BECAUSE A READ FAILED. A report, page or batch that fails is asked again (LM_TRIES); if it still
 * fails, the listings it would have refreshed KEEP their previous record (`stale: 1`, the old readAt). An All
 * Listings report with no rows is a failure, not "no listings": that brand's whole pass is dropped and the cache is
 * left as it was. Only a SKU that is missing from a good All Listings report leaves the cache.
 *
 * WHERE IT WRITES: its OWN spreadsheet, "Sellora Listing Cache" — never the nightly cache spreadsheet. lmSetup creates it
 * once and keeps its id in Script Property LM_CACHE_ID (never in the code). A tab is stored the way cacheWrite_ stores
 * one (JSON cut into CACHE_CELL-character cells in column A, the sheet trimmed with cacheTrim_), and no tab passes
 * LM_PART_MAX characters. Sellora reads each tab with ?cache=<tab>: Code.gs sends lmMeta / lmListings_* / lmCatalog_*
 * here (lmCacheRead_) and every other name to the nightly cache exactly as before.
 *
 * WHAT IT WRITES:
 *   lmMeta                         { v, kind: 'full'|'light', startedAt, finishedAt, upTo, nextRun, counts per brand,
 *                                    errors, lastFull, lastLight, hash: 'h31', parts: { listings: {SP: [tabs]},
 *                                    catalog: {SP: [tabs]} } } — read this first, then the tabs it names.
 *   lmListings_<brand>_<P>_<i>     { b, part, of, at, items: { sku: record } } — one record per SKU (see lmItem_).
 *   lmCatalog_<brand>_<P>_<i>      { b, part, of, at, items: { asin: record } } — one record per ASIN (see lmCat_).
 *   A SKU lives in part lmHash_(sku) % P (an ASIN likewise), so a light pass rewrites only the parts it touched and a
 *   reader never sees a SKU twice. P grows (and the tab names change) only when a part passes LM_PART_MAX characters.
 *   Scratch tabs lmScr_* exist only while a full pass runs and are deleted at its end.
 *
 * RUN FROM THE EDITOR
 *   lmSetup()          once: creates (or finds) "Sellora Listing Cache", checks it can be written, installs the timer,
 *                      starts the first full pass
 *   lmStatus()         what it is doing, what the cache holds, any errors, today's script minutes — with a warning
 *                      when the project looks near Apps Script's daily trigger limit
 *   lmRunNow()         a full pass on the next tick instead of waiting for 13:00 / 18:00
 *   lmSku('RTC14-1')   one SKU from the cache: the listing, its catalog entry, its stock
 *   lmCheck()          THE PROOF: the cache against Amazon right now (counts vs fresh reports, 10 SKUs vs live reads)
 *   lmStop()           removes the timer. To undo everything: lmStop, delete this file and the lmCacheRead_ line in
 *                      Code.gs, the "Sellora Listing Cache" spreadsheet and the Script Properties LM_*.
 *
 * CALLS AND QUOTAS (about 4,400 SKUs: Ridhi ~2,680, CPC ~1,720 — measured 9 Oct; see lmQuota_ for the arithmetic):
 *   full pass  ≈ 6 report requests + ~40 report polls, ~220 Listings Items calls, ~240 Catalog Items calls
 *              ≈ 510 SP-API calls, ~10–14 minutes of script time spread over ~5–8 ticks;
 *   light pass ≈ 2–4 calls per brand when little changed, at most ~22 per brand (200 changed listings);
 *   per day    ≈ 1,000 (two full passes) + 150–1,800 (36 light passes) ≈ 1,200–2,800 UrlFetch calls, of the
 *              20,000 (Gmail) / 100,000 (Workspace) Apps Script allows; ~45–60 minutes of trigger time.
 *   Rates: Listings Items 5 req/s — we leave LM_LIST_GAP_MS between calls (≤ 4/s); Catalog Items 2 req/s — we leave
 *   LM_CAT_GAP_MS (≈ 1.6/s). Sellora's own reads share those buckets; limgSp_ already waits and retries on 429, and
 *   a 429 that survives that ends the tick ("Amazon asked us to slow down"), the next tick carries on.
 */

var LM_BUDGET_MS = 4.5 * 60000;
var LM_FULL_HOURS = [13, 18];          // script time zone (Asia/Kolkata)
var LM_LIGHT_FROM = 9, LM_LIGHT_TO = 21, LM_LIGHT_EVERY_MIN = 15;
var LM_TRIES = 3;
var LM_BRANDS = ['SP', 'CPC'];
var LM_LABEL = { SP: 'Ridhi', CPC: 'CPC' };
var LM_PAGE = 20;                      // searchListingsItems: SKUs per call (Amazon's maximum)
var LM_CAT_BATCH = 20;                 // searchCatalogItems: ASINs per call (Amazon's maximum)
var LM_LIST_GAP_MS = 250;              // Listings Items allows 5 requests a second
var LM_CAT_GAP_MS = 600;               // Catalog Items allows 2 requests a second
var LM_PART_SKUS = 250;                // records per part when a brand is laid out for the first time
var LM_PART_MAX = 1000000;             // characters per part tab (25 cells of 40,000); past this the brand is laid out in twice the parts
var LM_SCR_MAX = 1200000;              // characters per scratch tab before a new one is started
var LM_LIGHT_MAX = 200;                // listings a light pass reads at most per brand
var LM_LIGHT_OVERLAP_MS = 5 * 60000;   // a light pass asks from a little before the last one, so nothing slips between
var LM_TEXT_MAX = 2000;                // Amazon's own limit for a description; bullets are cut at 500
var LM_REPORT_WAIT_MS = 50 * 60000;    // a report Amazon has not finished after this is asked for again
var LM_REPORTS = { L: 'GET_MERCHANT_LISTINGS_ALL_DATA', F: 'GET_MERCHANTS_LISTINGS_FYP_REPORT', S: 'GET_FBA_INVENTORY_PLANNING_DATA' };
var LM_REPORT_NAME = { L: 'All Listings report', F: 'Suppressed listings report', S: 'FBA stock report' };
// Variation attributes kept per listing and per catalog entry (a theme names some of these; Sellora reads the parent's).
var LM_BOOK_NAME = 'Sellora Listing Cache';
var LM_TICK_GAP_MIN = 25;              // no tick for this long while the timer is on: Apps Script is skipping it
var LM_VAR_ATTRS = ['color', 'size', 'set_name', 'style', 'pattern', 'pattern_name', 'material', 'item_shape', 'scent',
  'flavor', 'number_of_items', 'item_package_quantity', 'unit_count', 'size_name', 'color_name', 'style_name', 'team_name'];

/* ============================== its own spreadsheet ============================== */

/** "Sellora Listing Cache". Its id lives in Script Property LM_CACHE_ID. Created only when `create` (lmSetup). A sheet
 *  that will not open is an emergency, not a reason to start over (the same rule as cacheSheet_): retry once, then throw. */
function lmBook_(create) {
  var id = prop_('LM_CACHE_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e1) {
      Utilities.sleep(2000);
      try { return SpreadsheetApp.openById(id); }
      catch (e2) {
        throw new Error('The "' + LM_BOOK_NAME + '" spreadsheet ' + id + ' will not open: ' + (e2.message || e2) + '. Nothing was rebuilt. '
          + 'To deliberately start a new one, clear Script Property LM_CACHE_ID and run lmSetup().');
      }
    }
  }
  if (!create) throw new Error('No "' + LM_BOOK_NAME + '" yet — run lmSetup() once.');
  var ss = SpreadsheetApp.create(LM_BOOK_NAME);
  PropertiesService.getScriptProperties().setProperty('LM_CACHE_ID', ss.getId());
  return ss;
}

/** Store one tab: JSON cut into CACHE_CELL-character cells down column A (exactly as cacheWrite_), trimmed with cacheTrim_. */
function lmPut_(name, obj) {
  var ss = lmBook_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var s = JSON.stringify(obj), rows = [];
  for (var i = 0; i < s.length; i += CACHE_CELL) rows.push(["'" + s.substr(i, CACHE_CELL)]);
  if (!rows.length) rows.push(["'{}"]);
  sh.clear();
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
  cacheTrim_(sh, rows.length);
  return rows.length;
}

function lmGet_(name) {
  var sh = lmBook_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), s = '';
  for (var i = 0; i < vals.length; i++) s += String(vals[i][0] || '').replace(/^'/, '');
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** For Code.gs ?cache=lmMeta / lmListings_* / lmCatalog_*: null (→ "nothing cached yet") until lmSetup has run. */
function lmCacheRead_(name) {
  if (!prop_('LM_CACHE_ID')) return null;
  return lmGet_(name);
}

/* ============================== script minutes ============================== */

/** After every tick: today's minutes, runs, the longest run, and any long gap between two ticks (Apps Script stops
 *  running a project's timers for the rest of the day once its daily trigger time is used up). Script Property LM_USAGE. */
function lmUsageAdd_(t0) {
  try {
    var props = PropertiesService.getScriptProperties(), now = Date.now();
    var day = Utilities.formatDate(new Date(t0), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var u = {};
    try { u = JSON.parse(props.getProperty('LM_USAGE') || '{}'); } catch (e) { u = {}; }
    if (u.day !== day) u = { day: day, ms: 0, runs: 0, longest: 0, gaps: [] };
    if (u.last && t0 - u.last > LM_TICK_GAP_MIN * 60000) {
      u.gaps = (u.gaps || []).concat([lmIso_(u.last).slice(11) + '–' + lmIso_(t0).slice(11)]).slice(-6);
    }
    u.ms += now - t0; u.runs++; u.longest = Math.max(u.longest || 0, now - t0); u.last = now;
    props.setProperty('LM_USAGE', JSON.stringify(u));
  } catch (e) { /* counting must never fail a tick */ }
}

/** The daily trigger-time limit of the account the timers run as: 90 minutes (Gmail) or 6 hours (Google Workspace). */
function lmDailyLimit_() {
  var mail = '';
  try { mail = String(Session.getEffectiveUser().getEmail() || ''); } catch (e) { mail = ''; }
  if (/@(gmail|googlemail)\.com$/i.test(mail)) return { min: 90, kind: 'a Gmail account' };
  if (mail) return { min: 360, kind: 'a Google Workspace account' };
  return { min: 90, kind: 'account not known — the stricter Gmail limit assumed' };
}

function lmUsageLog_() {
  var u = {};
  try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('LM_USAGE') || '{}'); } catch (e) { u = {}; }
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (u.day !== today) u = { day: today, ms: 0, runs: 0, longest: 0, gaps: [] };
  var lim = lmDailyLimit_(), mins = Math.round(u.ms / 6000) / 10, share = mins / lim.min;
  var others = [];
  ScriptApp.getProjectTriggers().forEach(function (t) { var h = t.getHandlerFunction(); if (h !== 'lmTick' && others.indexOf(h) < 0) others.push(h); });
  Logger.log('— script time today (' + today + ') —');
  Logger.log('ListingMatch  ' + mins + ' min in ' + u.runs + ' run(s)' + (u.runs ? ', longest ' + Math.round((u.longest || 0) / 6000) / 10 + ' min' : ''));
  Logger.log('daily limit   ' + lim.min + ' min of timer time for the WHOLE project (' + lim.kind + '). Apps Script does not tell a script');
  Logger.log('              the project\'s total — only ListingMatch\'s own minutes are counted here.');
  Logger.log('other timers  ' + (others.length ? others.join(', ') : 'none') + ' (they share that limit)');
  var warn = [];
  if (share >= 1 / 3) warn.push('ListingMatch alone has used ' + Math.round(share * 100) + '% of the daily limit today. With ' + (others.length ? others.join(', ') : 'the other timers')
    + ' on top, the project may run out — a light pass every 30 minutes (LM_LIGHT_EVERY_MIN = 30) would about halve ListingMatch\'s share.');
  if ((u.gaps || []).length) warn.push('lmTick did not run ' + u.gaps.join(', ') + ' today, although its timer is every 10 minutes. Apps Script stops a project\'s timers'
    + ' when its daily trigger time is used up (or during a Google outage): the project looks NEAR OR OVER ITS DAILY LIMIT. Check Executions in the editor.');
  if (warn.length) warn.forEach(function (w) { Logger.log('⚠️ ' + w); });
  else Logger.log('✓ no sign of the daily limit today');
}

/* ============================== editor functions ============================== */

function lmSetup() {
  var had = !!prop_('LM_CACHE_ID'), ss;
  try {
    ss = lmBook_(true);
    var probe = ss.getSheetByName('lmProbe') || ss.insertSheet('lmProbe');
    probe.getRange(1, 1).setValue('ok ' + lmNow_());
    ss.deleteSheet(probe);
  } catch (e) {
    Logger.log('❌ cannot use the "' + LM_BOOK_NAME + '" spreadsheet: ' + (e.message || e));
    Logger.log('   If it exists but is not yours, ask its owner to share it with you as Editor (Script Property LM_CACHE_ID).');
    Logger.log('   Then run lmSetup again. Nothing was installed.');
    return;
  }
  Logger.log((had ? 'Using' : 'Created') + ' the spreadsheet "' + LM_BOOK_NAME + '": ' + ss.getUrl());
  Logger.log('   Its id is kept in Script Property LM_CACHE_ID. The nightly cache spreadsheet is not touched.');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lmTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lmTick').timeBased().everyMinutes(10).create();
  var st = lmState_(); st.reset = true; lmSave_(st);
  Logger.log('✅ lmTick now runs every 10 minutes.');
  Logger.log('   The first full pass starts on the next tick: three reports per brand, then every SKU and ASIN.');
  Logger.log('   It takes about an hour (Amazon builds the reports first). Watch it with lmStatus().');
  Logger.log('   After that: full passes at ' + LM_FULL_HOURS.join(':00 and ') + ':00, light passes ' + LM_LIGHT_FROM + ':00–' + LM_LIGHT_TO + ':00 ('
    + Session.getScriptTimeZone() + '). When the first pass is done, run lmCheck() for the proof.');
}

function lmStop() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lmTick') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n ? 'lmTick timer removed. The lm* tabs are left as they are.' : 'No lmTick timer was installed.');
}

function lmRunNow() {
  var st = lmState_(); st.reset = true; lmSave_(st);
  Logger.log('A full pass starts on the next tick (within 10 minutes). To go now, run lmTick yourself.');
}

function lmStatus() {
  var st = lmState_();
  var run = st.run;
  if (run) {
    Logger.log('running    ' + run.kind + ' pass, started ' + run.startedAt);
    LM_BRANDS.forEach(function (b) {
      var x = run.B && run.B[b];
      if (!x) return;
      var rep = Object.keys(LM_REPORTS).map(function (k) { var j = x.rep[k]; return LM_REPORT_NAME[k] + ' ' + (j ? j.st + (j.t ? ' (try ' + j.t + ')' : '') : '—'); }).join(' · ');
      Logger.log(LM_LABEL[b] + '  step ' + x.ph + '  ·  listings ' + (x.i || 0) + '/' + (x.n || '?') + '  ·  catalog ' + (x.ci || 0) + '/' + (x.cn || '?')
        + (x.miss ? '  ·  ' + x.miss + ' not read (old kept)' : '') + (x.err ? '  ·  ' + x.err : ''));
      Logger.log('        ' + rep);
    });
  } else Logger.log('running    nothing' + (st.reset ? ' — a full pass is asked for' : ''));
  Logger.log('next       ' + lmNextRun_(st));
  (st.errors || []).forEach(function (e) { Logger.log('error      ' + e); });
  var meta = prop_('LM_CACHE_ID') ? lmGet_('lmMeta') : null;
  Logger.log('— what the cache holds —');
  if (!meta) { Logger.log(prop_('LM_CACHE_ID') ? 'nothing yet (lmMeta is empty)' : 'no "' + LM_BOOK_NAME + '" yet — run lmSetup()'); lmUsageLog_(); return; }
  Logger.log('last full  ' + ((meta.lastFull && meta.lastFull.finishedAt) || 'never') + '   ·   last light ' + ((meta.lastLight && meta.lastLight.finishedAt) || 'never'));
  LM_BRANDS.forEach(function (b) {
    var c = (meta.counts && meta.counts[b]) || {};
    Logger.log(LM_LABEL[b] + '  ' + lmNf_(c.skus) + ' SKUs (' + lmStatusLine_(c.status) + ')  ·  suppressed ' + lmNf_(c.supReport) + ' by report + ' + lmNf_(c.supStatus)
      + ' by status  ·  ' + lmNf_(c.asins) + ' ASINs  ·  stock for ' + lmNf_(c.fba) + '  ·  ' + lmNf_(c.stale) + ' kept from an older read'
      + '  ·  ' + (((meta.parts || {}).listings || {})[b] || []).length + '+' + (((meta.parts || {}).catalog || {})[b] || []).length + ' tabs');
  });
  (meta.errors || []).forEach(function (e) { Logger.log('last pass  ' + e); });
  lmUsageLog_();
}

/** One SKU from the cache, laid out to compare with Seller Central. */
function lmSku(sku) {
  sku = String(sku || '').trim();
  if (!sku) { Logger.log('Give a SKU, like lmSku("RTC14-1").'); return; }
  var meta = lmGet_('lmMeta');
  if (!meta || !meta.parts) { Logger.log('Nothing cached yet — run lmSetup and wait for the first pass.'); return; }
  var found = false;
  LM_BRANDS.forEach(function (b) {
    var tabs = (meta.parts.listings || {})[b] || [];
    if (!tabs.length) return;
    var part = lmGet_(tabs[lmHash_(sku) % tabs.length]);
    var r = part && part.items && part.items[sku];
    if (!r) return;
    found = true;
    Logger.log('━━ ' + LM_LABEL[b] + ' · ' + sku + ' · ASIN ' + (r.asin || '—') + ' · read ' + lmWhen_(r.readAt) + (r.stale ? '  ⚠ kept from an older read' : ''));
    lmLogItem_(r);
    var ctabs = (meta.parts.catalog || {})[b] || [];
    var cp = r.asin && ctabs.length ? lmGet_(ctabs[lmHash_(r.asin) % ctabs.length]) : null;
    var c = cp && cp.items && cp.items[r.asin];
    Logger.log('Catalog (what shoppers see)' + (c ? ' · read ' + lmWhen_(c.readAt) : ''));
    if (c) lmLogCat_(c); else Logger.log('   not in the cache');
  });
  if (!found) Logger.log(sku + ' is not in the cache (neither brand).');
}

/* ============================== the timer ============================== */

function lmTick() {
  var props = PropertiesService.getScriptProperties();
  var lease = Number(props.getProperty('LM_LEASE') || 0);
  if (lease && Date.now() - lease < 7 * 60000) { Logger.log('lmTick: another run is still going — skipped.'); return; }
  var t0 = Date.now();
  props.setProperty('LM_LEASE', String(t0));
  try {
    try { lmBook_(); }                     // no spreadsheet (or one that will not open): nothing is asked of Amazon
    catch (e) { var st = lmState_(); lmErr_(st, String(e.message || e)); lmSave_(st); Logger.log('lmTick: ' + (e.message || e)); return; }
    lmTick_();
  } finally {
    props.deleteProperty('LM_LEASE');
    lmUsageAdd_(t0);
  }
}

function lmTick_() {
  var t0 = Date.now();
  var left = function () { return LM_BUDGET_MS - (Date.now() - t0); };
  var st = lmState_();
  var now = new Date(), tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), hour = Number(Utilities.formatDate(now, tz, 'H'));
  st.slots = st.slots || {};
  var due = LM_FULL_HOURS.filter(function (h) { return hour >= h && !st.slots[today + '|' + h]; });
  if (!st.run && (st.reset || due.length)) {
    due.forEach(function (h) { st.slots[today + '|' + h] = 1; });       // one pass covers every slot that is due
    Object.keys(st.slots).forEach(function (k) { if (k.slice(0, 10) < lmAddDays_(today, -2)) delete st.slots[k]; });
    st.run = lmPlanFull_();
    st.reset = false;
    lmSave_(st);
    Logger.log('lmTick: full pass started.');
  }
  if (st.run) {
    try { lmFullStep_(st, left); }
    finally { lmSave_(st); }
    return;
  }
  var mins = (Date.now() - (st.lightAt || 0)) / 60000;
  if (hour >= LM_LIGHT_FROM && hour < LM_LIGHT_TO && mins >= LM_LIGHT_EVERY_MIN) {
    try { lmLight_(st, left); }
    finally { lmSave_(st); }
  }
}

function lmPlanFull_() {
  var B = {};
  LM_BRANDS.forEach(function (b) {
    B[b] = { ph: 'rep', rep: { L: { st: 'new', t: 0 }, F: { st: 'new', t: 0 }, S: { st: 'new', t: 0 } }, i: 0, n: 0, ci: 0, cn: 0, nL: 0, nC: 0, wp: 0, wc: 0, bt: 0, miss: 0 };
  });
  return { kind: 'full', startedAt: lmNow_(), startMs: Date.now(), B: B, errors: [] };
}

/** One tick of a full pass: every brand moves as far as the time allows. Steps: rep → items → cat → write → done. */
function lmFullStep_(st, left) {
  var run = st.run;
  try {
    for (var k = 0; k < LM_BRANDS.length && left() > 30000; k++) {
      var b = LM_BRANDS[k], x = run.B[b];
      setBrand_(b);
      if (x.ph === 'rep') lmReports_(st, b, x, left);
      if (x.ph === 'items') lmItems_(st, b, x, left);
      if (x.ph === 'cat') lmCatalogStep_(st, b, x, left);
      if (x.ph === 'write') lmWrite_(st, b, x, left);
    }
  } catch (e) {
    var m = String(e.message || e);
    lmErr_(st, /429|quota|throttl|too many/i.test(m) ? 'Amazon asked us to slow down — next tick' : m.slice(0, 200));
  }
  var busy = LM_BRANDS.some(function (b) { return run.B[b].ph !== 'done' && run.B[b].ph !== 'gave'; });
  if (!busy) lmFinishFull_(st);
}

/* ----- step 1: the three reports ----- */
function lmReports_(st, b, x, left) {
  Object.keys(LM_REPORTS).forEach(function (k) {
    var j = x.rep[k];
    if (j.st !== 'new' || left() < 20000) return;
    try {
      j.id = lmAsk_(k); j.st = 'asked'; j.t++; j.at = Date.now();
    } catch (e) {
      j.t++;
      lmRepRetry_(st, b, k, j, String(e.message || e));
    }
  });
  lmSave_(st);
  var R = null;
  var loadR = function () { if (!R) R = lmGet_(lmScr_(b, 'R')) || { L: null, F: null, S: null }; return R; };
  var dirty = false;
  Object.keys(LM_REPORTS).forEach(function (k) {
    var j = x.rep[k];
    if (j.st !== 'asked' || left() < 45000) return;
    try {
      var got = lmCollect_(k, j.id);
      if (got.wait) {
        if (Date.now() - j.at > LM_REPORT_WAIT_MS) lmRepRetry_(st, b, k, j, 'not ready after ' + Math.round(LM_REPORT_WAIT_MS / 60000) + ' minutes');
        return;
      }
      if (got.err) { lmRepRetry_(st, b, k, j, got.err); return; }
      loadR()[k] = got.data; dirty = true; j.st = 'got';
    } catch (e) { lmRepRetry_(st, b, k, j, String(e.message || e)); }
  });
  if (dirty) {
    try { lmPut_(lmScr_(b, 'R'), R); Object.keys(LM_REPORTS).forEach(function (k) { if (x.rep[k].st === 'got') x.rep[k].st = 'done'; }); }
    catch (we) { lmErr_(st, LM_LABEL[b] + ': could not write the cache sheet: ' + String(we.message || we).slice(0, 160)); Object.keys(LM_REPORTS).forEach(function (k) { if (x.rep[k].st === 'got') x.rep[k].st = 'new'; }); }
  }
  var L = x.rep.L;
  if (L.st === 'gave') {                     // no SKU list: nothing of this brand is touched
    x.ph = 'gave'; x.err = 'All Listings report could not be read — the cache keeps the last good data';
    lmDropScratch_(b);
    return;
  }
  var waiting = Object.keys(LM_REPORTS).some(function (k) { return x.rep[k].st === 'new' || x.rep[k].st === 'asked' || x.rep[k].st === 'got'; });
  if (waiting) return;
  var Rr = loadR();
  x.n = Object.keys(Rr.L || {}).length;
  x.ph = 'items'; x.i = 0;
}

function lmRepRetry_(st, b, k, j, msg) {
  lmErr_(st, LM_LABEL[b] + ' ' + LM_REPORT_NAME[k] + ': ' + String(msg).slice(0, 160));
  if (j.t >= LM_TRIES) { j.st = 'gave'; j.m = String(msg).slice(0, 160); }
  else { j.st = 'new'; j.id = ''; }
}

function lmAsk_(k) {
  if (k === 'S') {                               // the stock report Listing Health already uses
    var a = ageCreate_();
    if (!a.ok || !a.reportId) throw new Error(a.error || 'no reportId');
    return a.reportId;
  }
  var r = sp_('/reports/2021-06-30/reports', 'post', { reportType: LM_REPORTS[k], marketplaceIds: [marketplaceId_()] });
  if (!r.reportId) throw new Error('Amazon accepted the request but returned no reportId.');
  return r.reportId;
}

/** → { wait: true } | { err } | { data }. All Listings: { sku: [asin, status, qty|null, price|null, channel] };
 *  Suppressed: { sku: [reason, issue, changed] }; stock: { sku: available } plus how many rows the report had. */
function lmCollect_(k, id) {
  if (k === 'S') {
    var p = agePoll_(id);
    if (!p.ok) return { err: p.error || 'stock report failed' };
    if (p.status !== 'done') return { wait: true };
    if (!(p.rows || []).length) return { err: 'the stock report came back with no rows' };
    var m = {};
    p.rows.forEach(function (r) { if (r.sku) m[r.sku] = Number(r.available) || 0; });
    return { data: { m: m, col: p.availCol || '', total: p.total || p.rows.length, at: Date.now() } };
  }
  var r = sp_('/reports/2021-06-30/reports/' + encodeURIComponent(id));
  var s = r.processingStatus || '';
  // A suppressed-listings report with nothing in it ends CANCELLED ("no data") — that is "none suppressed".
  if (s === 'CANCELLED' && k === 'F') return { data: { m: {}, at: Date.now(), empty: 1 } };
  if (s === 'FATAL' || s === 'CANCELLED') return { err: 'Amazon could not build it (' + s + ')' };
  if (s !== 'DONE') return { wait: true };
  var text = lmDoc_(r.reportDocumentId);
  var head = String(text || '').split(/\r?\n/)[0] || '';
  if (!/sku/i.test(head)) return { err: 'the report came back without its header row' };
  var rows = parseTsv_(text);
  var out = {};
  if (k === 'L') {
    var num = function (v) { if (v === undefined || v === null || String(v).trim() === '') return null; var f = parseFloat(v); return isNaN(f) ? null : f; };
    rows.forEach(function (x) {
      var sku = String(pick_(x, ['seller-sku', 'sku', 'msku']) || '').trim();
      if (!sku) return;
      out[sku] = [String(pick_(x, ['asin1', 'asin', 'product-id']) || '').trim(), String(pick_(x, ['status', 'listing-status', 'item-status']) || '').trim(),
        num(pick_(x, ['quantity'])), num(pick_(x, ['price', 'item-price'])), String(pick_(x, ['fulfillment-channel', 'fulfilment-channel']) || '').trim()];
    });
    if (!Object.keys(out).length) return { err: 'the All Listings report came back with no listings' };   // never "no listings"
  } else {
    rows.forEach(function (x) {
      var sku = String(pick_(x, ['sku', 'seller-sku', 'msku']) || '').trim();
      if (!sku) return;
      out[sku] = [String(pick_(x, ['reason', 'status']) || '').trim().slice(0, 120), String(pick_(x, ['issue description', 'issue-description', 'description']) || '').trim().slice(0, 300),
        String(pick_(x, ['status change date', 'status-change-date']) || '').trim().slice(0, 30)];
    });
  }
  return { data: { m: out, at: Date.now() } };
}

function lmDoc_(docId) {
  var d = sp_('/reports/2021-06-30/documents/' + encodeURIComponent(docId));
  if (!d.url) throw new Error('Report document carries no download url.');
  var resp = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');
  return String(d.compressionAlgorithm || '').toUpperCase() === 'GZIP'
    ? Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString('UTF-8')
    : resp.getContentText('UTF-8');
}

/* ----- step 2: every SKU from the Listings Items API, 20 a call ----- */
function lmItems_(st, b, x, left) {
  var R = lmGet_(lmScr_(b, 'R'));
  if (!R || !R.L) { x.ph = 'rep'; x.rep.L = { st: 'new', t: 0 }; lmErr_(st, LM_LABEL[b] + ': the report scratch tab is gone — asking again'); return; }
  var skus = Object.keys(R.L.m || R.L).sort();
  x.n = skus.length;
  var seller = limgSeller_('');
  var buf = {}, size = 0, i = x.i, stop = '';
  while (i < skus.length && left() > 40000 && size < LM_SCR_MAX) {
    var batch = skus.slice(i, i + LM_PAGE), r;
    try {
      r = limgSp_('/listings/2021-08-01/items/' + seller + '?marketplaceIds=' + marketplaceId_() + '&identifiers=' + batch.map(encodeURIComponent).join(',')
        + '&identifiersType=SKU&pageSize=' + LM_PAGE + '&includedData=summaries,attributes,issues', 'get');
    } catch (e) { stop = 'Listings page at ' + batch[0] + ': ' + String(e.message || e).slice(0, 140) + ' — next tick'; break; }   // what was read is still written below
    if (r.code === 429) { stop = 'Amazon asked us to slow down (Listings) — next tick'; break; }
    if (r.code >= 300) {
      x.bt = (x.bt || 0) + 1;
      if (x.bt < LM_TRIES) { stop = 'Listings page at ' + batch[0] + ': ' + limgErr_(r, 'Listings').error.slice(0, 140) + ' — trying again'; break; }
      lmErr_(st, LM_LABEL[b] + ': gave up on ' + batch.length + ' listings from ' + batch[0] + ' after ' + LM_TRIES + ' tries — their last good data is kept');
      x.miss = (x.miss || 0) + batch.length; x.bt = 0; i += batch.length;
      continue;
    }
    x.bt = 0;
    var now = Date.now();
    // A SKU Amazon did not return keeps its last good record at write time.
    (r.body.items || []).forEach(function (it) { var rec = lmItem_(it, now); buf[rec.sku] = rec; size += JSON.stringify(rec).length; });
    i += batch.length;
    Utilities.sleep(LM_LIST_GAP_MS);
  }
  if (stop) lmErr_(st, LM_LABEL[b] + ': ' + stop);
  if (Object.keys(buf).length) {
    try { lmPut_(lmScr_(b, 'L', x.nL), { items: buf }); x.nL++; }
    catch (we) { lmErr_(st, LM_LABEL[b] + ': could not write the cache sheet — those listings are read again: ' + String(we.message || we).slice(0, 120)); return; }
  }
  x.i = i;                                  // moved on only once what was read is in the sheet
  if (i >= skus.length) {
    // the catalog list: every ASIN of a listing read now (or in the report), parents are added as Amazon names them
    var asins = {};
    for (var n = 0; n < x.nL; n++) {
      var part = lmGet_(lmScr_(b, 'L', n));
      Object.keys((part && part.items) || {}).forEach(function (s) { var a = part.items[s].asin; if (lmIsAsin_(a)) asins[a] = 1; });
    }
    Object.keys(R.L.m || R.L).forEach(function (s) { var a = (R.L.m || R.L)[s][0]; if (lmIsAsin_(a)) asins[a] = 1; });
    var list = Object.keys(asins).sort();
    try { lmPut_(lmScr_(b, 'A'), { list: list }); } catch (we2) { lmErr_(st, LM_LABEL[b] + ': could not write the ASIN list — next tick'); return; }
    x.ph = 'cat'; x.ci = 0; x.cn = list.length;
  }
}

/* ----- step 3: every ASIN from the catalog, 20 a call; parents are added as children name them ----- */
function lmCatalogStep_(st, b, x, left) {
  var A = lmGet_(lmScr_(b, 'A'));
  if (!A || !A.list) { lmErr_(st, LM_LABEL[b] + ': the ASIN list is gone — reading listings again'); x.ph = 'items'; x.i = 0; x.nL = 0; return; }
  var list = A.list, have = {};
  list.forEach(function (a) { have[a] = 1; });
  var buf = {}, size = 0, i = x.ci, stop = '', added = 0;
  while (i < list.length && left() > 40000 && size < LM_SCR_MAX) {
    var batch = list.slice(i, i + LM_CAT_BATCH), r;
    try { r = lmCatRead_(batch); }
    catch (e) { stop = 'Catalog batch at ' + batch[0] + ': ' + String(e.message || e).slice(0, 140) + ' — next tick'; break; }
    if (r.code === 429) { stop = 'Amazon asked us to slow down (Catalog) — next tick'; break; }
    if (r.code >= 300) {
      x.bt = (x.bt || 0) + 1;
      if (x.bt < LM_TRIES) { stop = 'Catalog batch at ' + batch[0] + ': answered ' + r.code + ' — trying again'; break; }
      lmErr_(st, LM_LABEL[b] + ': gave up on ' + batch.length + ' catalog entries from ' + batch[0] + ' — their last good data is kept');
      x.bt = 0; i += batch.length;
      continue;
    }
    x.bt = 0;
    var now = Date.now();
    (r.body.items || []).forEach(function (it) {
      var c = lmCat_(it, now);
      buf[c.asin] = c; size += JSON.stringify(c).length;
      (c.pa || []).forEach(function (p) { if (lmIsAsin_(p) && !have[p]) { have[p] = 1; list.push(p); added++; } });
    });
    i += batch.length;
    Utilities.sleep(LM_CAT_GAP_MS);
  }
  if (stop) lmErr_(st, LM_LABEL[b] + ': ' + stop);
  try {
    if (Object.keys(buf).length) { lmPut_(lmScr_(b, 'C', x.nC), { items: buf }); x.nC++; }
    if (added) lmPut_(lmScr_(b, 'A'), { list: list });
  } catch (we) { lmErr_(st, LM_LABEL[b] + ': could not write the cache sheet — those entries are read again: ' + String(we.message || we).slice(0, 120)); return; }
  x.ci = i; x.cn = list.length;
  if (i >= list.length) { x.ph = 'write'; x.wp = 0; x.wc = 0; }
}

function lmCatRead_(asins) {
  return limgSp_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() + '&identifiers=' + asins.join(',')
    + '&identifiersType=ASIN&pageSize=' + LM_CAT_BATCH + '&includedData=summaries,images,relationships,attributes,classifications,salesRanks', 'get');
}

/* ----- step 4: the parts — new reads, the reports, and the last good record where a read failed ----- */
function lmWrite_(st, b, x, left) {
  var R = lmGet_(lmScr_(b, 'R')) || {};
  var L = (R.L && (R.L.m || R.L)) || {};
  var meta = lmGet_('lmMeta') || {};
  var oldL = ((meta.parts || {}).listings || {})[b] || [], oldC = ((meta.parts || {}).catalog || {})[b] || [];
  var fresh = {}, freshC = {};
  for (var n = 0; n < x.nL; n++) { var p = lmGet_(lmScr_(b, 'L', n)); lmMerge_(fresh, p && p.items); }
  for (var m = 0; m < x.nC; m++) { var q = lmGet_(lmScr_(b, 'C', m)); lmMerge_(freshC, q && q.items); }
  var A = lmGet_(lmScr_(b, 'A')) || { list: [] };
  var skus = Object.keys(L).sort(), asins = A.list.slice();
  // The layout: kept unless a part would pass LM_PART_MAX (then twice the parts, under new tab names).
  if (!x.P) {
    x.P = Math.max(oldL.length || 0, Math.ceil(skus.length / LM_PART_SKUS) || 1);
    x.PC = Math.max(oldC.length || 0, Math.ceil(asins.length / LM_PART_SKUS) || 1);
  }
  var ctx = { b: b, L: L, F: R.F, S: R.S, rAt: (R.L && R.L.at) || 0, fresh: fresh };
  var oldAll = {};                                   // a new layout: every old record, read once a tick
  while (x.wp < x.P && left() > 30000) {
    var tab = lmTab_('lmListings', b, x.P, x.wp);
    var old = lmOldPart_(oldL, x.P, x.wp, oldAll);
    var items = {};
    skus.forEach(function (s) { if (lmHash_(s) % x.P === x.wp) items[s] = lmJoin_(ctx, s, old[s]); });
    var obj = { b: b, part: x.wp, of: x.P, at: lmNow_(), items: items };
    if (JSON.stringify(obj).length > LM_PART_MAX && x.P < 512) {        // too big: lay the brand out again in twice the parts
      lmDropNew_(oldL, 'lmListings', b, x.P, x.wp);
      x.P = x.P * 2; x.wp = 0; lmErr_(st, LM_LABEL[b] + ': listings laid out in ' + x.P + ' parts');
      continue;
    }
    lmPut_(tab, obj);
    x.wp++;
  }
  if (x.wp < x.P) return;
  var oldAllC = {};
  while (x.wc < x.PC && left() > 30000) {
    var ctab = lmTab_('lmCatalog', b, x.PC, x.wc);
    var oldc = lmOldPart_(oldC, x.PC, x.wc, oldAllC);
    var citems = {};
    asins.forEach(function (a) {
      if (lmHash_(a) % x.PC !== x.wc) return;
      var c = freshC[a] || (oldc[a] ? lmStale_(oldc[a]) : null);
      if (c) citems[a] = c;
    });
    var cobj = { b: b, part: x.wc, of: x.PC, at: lmNow_(), items: citems };
    if (JSON.stringify(cobj).length > LM_PART_MAX && x.PC < 512) { lmDropNew_(oldC, 'lmCatalog', b, x.PC, x.wc); x.PC = x.PC * 2; x.wc = 0; continue; }
    lmPut_(ctab, cobj);
    x.wc++;
  }
  if (x.wc < x.PC) return;
  // Every part is written: lmMeta now names them (read fresh — the other brand may have just written its own).
  var tabsL = [], tabsC = [];
  for (var i = 0; i < x.P; i++) tabsL.push(lmTab_('lmListings', b, x.P, i));
  for (var j = 0; j < x.PC; j++) tabsC.push(lmTab_('lmCatalog', b, x.PC, j));
  var counts = lmCounts_(b, tabsL, tabsC, x);
  var M = lmGet_('lmMeta') || {};
  M.v = 1; M.hash = 'h31';
  M.parts = M.parts || {}; M.parts.listings = M.parts.listings || {}; M.parts.catalog = M.parts.catalog || {};
  M.parts.listings[b] = tabsL; M.parts.catalog[b] = tabsC;
  M.counts = M.counts || {}; M.counts[b] = counts;
  M.readAt = M.readAt || {}; M.readAt[b] = { listings: st.run.startedAt, reports: { L: lmIso_(R.L && R.L.at), F: R.F ? lmIso_(R.F.at) : '', S: R.S ? lmIso_(R.S.at) : '' } };
  lmPut_('lmMeta', M);
  // Tabs of an older layout go only now, after lmMeta has moved on.
  [[oldL, tabsL], [oldC, tabsC]].forEach(function (pr) { pr[0].forEach(function (t) { if (pr[1].indexOf(t) < 0) lmDropTab_(t); }); });
  lmDropScratch_(b);
  x.ph = 'done';
}

function lmMerge_(into, items) { Object.keys(items || {}).forEach(function (k) { into[k] = items[k]; }); }

/** The last good records for new part i: the same part when the layout is unchanged, else every old part (read once,
 *  into `all`). */
function lmOldPart_(oldTabs, P, i, all) {
  if (!oldTabs.length) return {};
  if (oldTabs.length === P) { var o = lmGet_(oldTabs[i]); return (o && o.items) || {}; }
  if (!all.__read) {
    oldTabs.forEach(function (t) { var p = lmGet_(t); lmMerge_(all, p && p.items); });
    Object.defineProperty(all, '__read', { value: 1, enumerable: false });
  }
  return all;
}

/** Parts of this pass already written under a layout that turned out too small (never a tab lmMeta still names). */
function lmDropNew_(oldTabs, base, b, P, upTo) {
  for (var i = 0; i < upTo; i++) { var t = lmTab_(base, b, P, i); if (oldTabs.indexOf(t) < 0) lmDropTab_(t); }
}

/** A listing's record: this pass's read (else the last good one, marked stale), the report's facts, suppression, stock. */
function lmJoin_(ctx, sku, old) {
  var rep = ctx.L[sku] || [];
  var rec = ctx.fresh[sku] || (old ? lmStale_(old) : { sku: sku, asin: rep[0] || '', readAt: 0, noRead: 1 });
  rec.b = ctx.b;
  rec.rs = rep[1] || ''; rec.qty = rep[2] == null ? null : rep[2]; rec.price = rep[3] == null ? null : rep[3]; rec.ch = rep[4] || '';
  if (!rec.asin && rep[0]) rec.asin = rep[0];
  rec.rAt = ctx.rAt;
  if (ctx.F) {
    var f = (ctx.F.m || {})[sku];
    rec.fyp = f ? { r: f[0], d: f[1], at: f[2] } : null;
    delete rec.fypStale;
  } else if (old && old.fyp !== undefined) { rec.fyp = old.fyp; rec.fypStale = 1; }
  if (ctx.S) {
    var m = ctx.S.m || {};
    rec.fba = Object.prototype.hasOwnProperty.call(m, sku) ? m[sku] : null;
    delete rec.fbaStale;
  } else if (old && old.fba !== undefined) { rec.fba = old.fba; rec.fbaStale = 1; }
  rec.sup = lmSup_(rec);
  return rec;
}

function lmStale_(old) { var r = JSON.parse(JSON.stringify(old)); r.stale = 1; return r; }

/** "Suppressed" only from the Suppressed listings report, or from a status that is BUYABLE without DISCOVERABLE. */
function lmSup_(rec) {
  if (rec.fyp) return { src: 'report', why: rec.fyp.r + (rec.fyp.d ? ' — ' + rec.fyp.d : '') };
  var s = String(rec.as || '');
  if (/BUYABLE/.test(s) && !/DISCOVERABLE/.test(s)) return { src: 'status', why: 'Buyable but not discoverable (Amazon status ' + s + ')' };
  return null;
}

function lmCounts_(b, tabsL, tabsC, x) {
  var c = { skus: 0, status: {}, supReport: 0, supStatus: 0, fba: 0, stale: 0, noRead: 0, asins: 0, missing: x ? x.miss || 0 : 0 };
  tabsL.forEach(function (t) {
    var p = lmGet_(t);
    Object.keys((p && p.items) || {}).forEach(function (s) {
      var r = p.items[s];
      c.skus++;
      c.status[r.rs || '(none)'] = (c.status[r.rs || '(none)'] || 0) + 1;
      if (r.sup && r.sup.src === 'report') c.supReport++;
      else if (r.sup && r.sup.src === 'status') c.supStatus++;
      if (r.fba != null) c.fba++;
      if (r.stale) c.stale++;
      if (r.noRead) c.noRead++;
    });
  });
  tabsC.forEach(function (t) { var p = lmGet_(t); c.asins += Object.keys((p && p.items) || {}).length; });
  return c;
}

function lmFinishFull_(st) {
  var run = st.run;
  var M = lmGet_('lmMeta') || {};
  var gave = LM_BRANDS.filter(function (b) { return run.B[b].ph === 'gave'; });
  M.kind = 'full'; M.startedAt = run.startedAt; M.finishedAt = lmNow_(); M.upTo = run.startedAt;
  M.errors = (run.errors || []).slice(-8);
  M.lastFull = { startedAt: run.startedAt, finishedAt: M.finishedAt, brands: LM_BRANDS.filter(function (b) { return run.B[b].ph === 'done'; }), gaveUp: gave };
  st.run = null;
  st.lightAt = Date.now();
  st.lightFrom = st.lightFrom || {};
  LM_BRANDS.forEach(function (b) { if (M.lastFull.brands.indexOf(b) >= 0) st.lightFrom[b] = run.startMs; });
  M.nextRun = lmNextRun_(st);
  try { lmPut_('lmMeta', M); } catch (e) { lmErr_(st, 'could not write lmMeta: ' + String(e.message || e).slice(0, 120)); }
  if (gave.length && typeof jobAlert_ === 'function') {
    jobAlert_('ListingMatch', 'The full listing pass could not read ' + gave.map(function (b) { return LM_LABEL[b]; }).join(' and ')
      + ' (All Listings report failed ' + LM_TRIES + ' times). The cache keeps the last good data.');
  }
  Logger.log('lmTick: full pass finished.');
}

/* ============================== the light pass ============================== */

/** Only what changed since the last pass: listings Amazon says were updated (lastUpdatedAfter), and their catalog
 *  entries. Reports are not re-read (they are a full-pass thing); a listing keeps its report facts and stock. */
function lmLight_(st, left) {
  var meta = lmGet_('lmMeta');
  if (!meta || !meta.parts) return;                     // no full pass yet: nothing to update
  var startMs = Date.now(), n = {};
  st.lightFrom = st.lightFrom || {};
  LM_BRANDS.forEach(function (b) {
    var tabs = (meta.parts.listings || {})[b] || [], ctabs = (meta.parts.catalog || {})[b] || [];
    if (!tabs.length || left() < 60000) return;
    setBrand_(b);
    var got;
    try { got = lmChanged_(b, st.lightFrom[b] || 0, tabs, left); }
    catch (e) { lmErr_(st, LM_LABEL[b] + ' light pass: ' + String(e.message || e).slice(0, 160)); return; }
    if (got.err) { lmErr_(st, LM_LABEL[b] + ' light pass: ' + got.err); return; }
    var recs = got.recs, skus = Object.keys(recs);
    n[b] = { changed: skus.length, how: got.how };
    if (skus.length) try {
      // catalog entries of those listings (and their parents when the cache knows them)
      var asins = {};
      skus.forEach(function (s) { if (lmIsAsin_(recs[s].asin)) asins[recs[s].asin] = 1; });
      var list = Object.keys(asins), freshC = {};
      for (var i = 0; i < list.length && left() > 40000; i += LM_CAT_BATCH) {
        var r = lmCatRead_(list.slice(i, i + LM_CAT_BATCH));
        if (r.code >= 300) { lmErr_(st, LM_LABEL[b] + ' light pass: catalog answered ' + r.code + ' — those entries keep their last read'); continue; }
        (r.body.items || []).forEach(function (it) { var c = lmCat_(it, Date.now()); freshC[c.asin] = c; });
        Utilities.sleep(LM_CAT_GAP_MS);
      }
      lmUpdateParts_(tabs, recs, function (old, rec) {
        // keep the report facts and the stock; take everything Amazon's Listings API said now
        ['rs', 'qty', 'price', 'ch', 'rAt', 'fyp', 'fypStale', 'fba', 'fbaStale'].forEach(function (k) { if (old && old[k] !== undefined) rec[k] = old[k]; });
        rec.b = b; rec.sup = lmSup_(rec);
        return rec;
      });
      if (ctabs.length && Object.keys(freshC).length) lmUpdateParts_(ctabs, freshC, function (old, c) { return c; });
    } catch (e) { lmErr_(st, LM_LABEL[b] + ' light pass: ' + String(e.message || e).slice(0, 160)); return; }   // the next light pass asks again from the same time
    // More changed than one light pass reads: the next one carries on from the last listing read (Amazon sorts by change time).
    if (left() > 20000) st.lightFrom[b] = got.until || startMs;
  });
  st.lightAt = Date.now();
  var M = lmGet_('lmMeta') || meta;
  M.kind = 'light'; M.lastLight = { startedAt: lmIso_(startMs), finishedAt: lmNow_(), brands: n };
  M.finishedAt = M.lastLight.finishedAt; M.upTo = lmIso_(startMs); M.nextRun = lmNextRun_(st);
  try { lmPut_('lmMeta', M); } catch (e) { lmErr_(st, 'could not write lmMeta: ' + String(e.message || e).slice(0, 120)); }
}

/** The listings changed since `fromMs`: { recs: { sku: record }, how } — or the LM_LIGHT_MAX read longest ago. */
function lmChanged_(b, fromMs, tabs, left) {
  var seller = limgSeller_(''), recs = {}, now = Date.now();
  if (fromMs) {
    var since = new Date(fromMs - LM_LIGHT_OVERLAP_MS).toISOString(), token = '', pages = 0, last = '';
    do {
      var r = limgSp_('/listings/2021-08-01/items/' + seller + '?marketplaceIds=' + marketplaceId_() + '&lastUpdatedAfter=' + encodeURIComponent(since)
        + '&sortBy=lastUpdatedDate&sortOrder=ASC&pageSize=' + LM_PAGE + '&includedData=summaries,attributes,issues' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), 'get');
      if (r.code === 400 && !pages) { recs = null; break; }        // the question is not accepted: oldest-first instead
      if (r.code >= 300) return { err: limgErr_(r, 'Changed listings').error.slice(0, 200) };
      (r.body.items || []).forEach(function (it) { var x = lmItem_(it, now); recs[x.sku] = x; if (x.upd) last = x.upd; });
      token = (r.body.pagination && r.body.pagination.nextToken) || '';
      pages++;
      Utilities.sleep(LM_LIST_GAP_MS);
    } while (token && Object.keys(recs).length < LM_LIGHT_MAX && left() > 60000);
    if (recs) return { recs: recs, how: 'changed since ' + since, until: token && last ? Date.parse(last) + LM_LIGHT_OVERLAP_MS : 0 };
  }
  // oldest-first: the LM_LIGHT_MAX listings whose last read is oldest
  var all = [];
  tabs.forEach(function (t) { var p = lmGet_(t); Object.keys((p && p.items) || {}).forEach(function (s) { all.push([s, p.items[s].readAt || 0]); }); });
  all.sort(function (x, y) { return x[1] - y[1]; });
  var pick = all.slice(0, LM_LIGHT_MAX).map(function (x) { return x[0]; });
  recs = {};
  for (var i = 0; i < pick.length && left() > 40000; i += LM_PAGE) {
    var batch = pick.slice(i, i + LM_PAGE);
    var q = limgSp_('/listings/2021-08-01/items/' + seller + '?marketplaceIds=' + marketplaceId_() + '&identifiers=' + batch.map(encodeURIComponent).join(',')
      + '&identifiersType=SKU&pageSize=' + LM_PAGE + '&includedData=summaries,attributes,issues', 'get');
    if (q.code >= 300) continue;
    (q.body.items || []).forEach(function (it) { var x = lmItem_(it, now); recs[x.sku] = x; });
    Utilities.sleep(LM_LIST_GAP_MS);
  }
  return { recs: recs, how: 'oldest ' + pick.length };
}

/** Update records in place: only the parts that hold them are read and written. `take(old, new)` → the record kept. */
function lmUpdateParts_(tabs, recs, take) {
  var byPart = {};
  Object.keys(recs).forEach(function (k) { var i = lmHash_(k) % tabs.length; (byPart[i] = byPart[i] || []).push(k); });
  Object.keys(byPart).forEach(function (i) {
    var p = lmGet_(tabs[i]);
    if (!p || !p.items) return;                       // a part that will not read is left alone, never replaced
    byPart[i].forEach(function (k) { p.items[k] = take(p.items[k], recs[k]); });
    p.at = lmNow_();
    lmPut_(tabs[i], p);
  });
}

/* ============================== shaping Amazon's answers ============================== */

/** One listing from the Listings Items API. */
function lmItem_(it, now) {
  var s = (it.summaries && it.summaries[0]) || {}, at = it.attributes || {};
  var vals = function (k, max) { return (at[k] || []).map(function (v) { return String(v && v.value != null ? v.value : '').slice(0, max || 500); }).filter(Boolean); };
  var one = function (k, f) { var v = at[k]; return v && v[0] ? String((f ? v[0][f] : v[0].value) || '') : ''; };
  var img = {};
  Object.keys(LIMG_ATTR).forEach(function (slot) { var v = at[LIMG_ATTR[slot]]; if (v && v[0] && v[0].media_location) img[slot] = v[0].media_location; });
  var va = {};
  LM_VAR_ATTRS.forEach(function (k) { var v = one(k); if (v) va[k] = v.slice(0, 120); });
  var rel = at.child_parent_sku_relationship && at.child_parent_sku_relationship[0];
  return {
    sku: it.sku, asin: s.asin || '', as: (s.status || []).join(','), pt: s.productType || '',
    t: String(s.itemName || one('item_name')).slice(0, 300),
    bl: vals('bullet_point', 500), d: vals('product_description', LM_TEXT_MAX).join('\n').slice(0, LM_TEXT_MAX),
    hl: vals('title_differentiation', 200), kw: vals('generic_keyword', 500).join(' '),
    lvl: one('parentage_level'), psku: rel ? String(rel.parent_sku || '') : '', theme: one('variation_theme', 'name'), va: va, img: img,
    iss: (it.issues || []).slice(0, 12).map(function (i) {
      return { c: String(i.code || ''), s: String(i.severity || ''), m: String(i.message || '').slice(0, 300), a: (i.attributeNames || []).slice(0, 4) };
    }),
    upd: s.lastUpdatedDate || '', cr: s.createdDate || '', readAt: now,
  };
}

/** One ASIN from the Catalog Items API (what shoppers see). */
function lmCat_(it, now) {
  var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
  var img = {};
  ((it.images && it.images[0] && it.images[0].images) || []).forEach(function (im) {
    if (!im || !im.variant || !im.link) return;
    var w = Number(im.width) || 0;
    if (!img[im.variant] || w > img[im.variant].w) img[im.variant] = { u: im.link, w: w, h: Number(im.height) || 0 };
  });
  var pa = [], kids = [], theme = '', tattrs = [];
  ((it.relationships && it.relationships[0] && it.relationships[0].relationships) || []).forEach(function (rel) {
    (rel.parentAsins || []).forEach(function (p) { if (pa.indexOf(p) < 0) pa.push(p); });
    (rel.childAsins || []).forEach(function (c) { if (kids.indexOf(c) < 0) kids.push(c); });
    if (rel.variationTheme) { theme = rel.variationTheme.theme || theme; tattrs = rel.variationTheme.attributes || tattrs; }
  });
  var vals = {};
  LM_VAR_ATTRS.concat(tattrs).forEach(function (k) { var v = attrVal_(a, k); if (v !== '' && v != null) vals[k] = String(v).slice(0, 120); });
  var best = function (list) {
    var r = 0, c = '';
    (list || []).forEach(function (x) { var n = Number(x.rank) || 0; if (n > 0 && (!r || n < r)) { r = n; c = x.title || x.classificationId || ''; } });
    return r ? { r: r, c: String(c).slice(0, 80) } : null;
  };
  var ranks = (it.salesRanks && it.salesRanks[0]) || {};
  return {
    asin: it.asin, t: String(s.itemName || attrVal_(a, 'item_name') || '').slice(0, 300), brand: s.brand || s.brandName || '',
    img: img, pa: pa, kids: kids, theme: theme, tattrs: tattrs, vals: vals,
    bc: lmPath_(it), bcId: (s.browseClassification && s.browseClassification.classificationId) || '',
    rk: { main: best(ranks.displayGroupRanks), sub: best(ranks.classificationRanks) },
    aplus: null, readAt: now,
  };
}

/** "Home & Kitchen › Kitchen & Dining › Kitchen & Table Linens › Tablecloths" from the classification's parent chain. */
function lmPath_(it) {
  var cls = (it.classifications && it.classifications[0] && it.classifications[0].classifications) || [];
  var c = cls[0];
  var names = [];
  for (var g = 0; c && g < 12; g++) { if (c.displayName) names.unshift(c.displayName); c = c.parent; }
  if (!names.length && it.summaries && it.summaries[0] && it.summaries[0].browseClassification) names.push(it.summaries[0].browseClassification.displayName || '');
  return names.join(' › ');
}

/* ============================== lmCheck: the proof ============================== */

/** The cache against Amazon RIGHT NOW. Counts: fresh All Listings + Suppressed reports for both brands (asked here,
 *  waited for up to ~4.5 minutes; run again if Amazon is slower — the reports asked are remembered for an hour).
 *  Then 10 random SKUs (5 a brand): a live Listings read, a live catalog read and the live FBA stock, field by field. */
function lmCheck() {
  var meta = lmGet_('lmMeta');
  if (!meta || !meta.parts) { Logger.log('Nothing cached yet — run lmSetup and wait for the first full pass.'); return; }
  var props = PropertiesService.getScriptProperties();
  var pend = {};
  try { pend = JSON.parse(props.getProperty('LM_CHECK') || '{}'); } catch (e) { pend = {}; }
  if (!pend.at || Date.now() - pend.at > 3600000) {
    pend = { at: Date.now(), ids: {} };
    LM_BRANDS.forEach(function (b) {
      setBrand_(b); pend.ids[b] = {};
      ['L', 'F'].forEach(function (k) { try { pend.ids[b][k] = lmAsk_(k); } catch (e) { pend.ids[b][k] = ''; Logger.log(LM_LABEL[b] + ' ' + LM_REPORT_NAME[k] + ': could not ask — ' + String(e.message || e).slice(0, 200)); } });
    });
    props.setProperty('LM_CHECK', JSON.stringify(pend));
    Logger.log('Asked Amazon for fresh All Listings and Suppressed reports (both brands). Waiting — usually 2-10 minutes…');
  }
  var got = {}, t0 = Date.now();
  var pendingAny = function () { return LM_BRANDS.some(function (b) { return ['L', 'F'].some(function (k) { return pend.ids[b][k] && !(got[b] && got[b][k]); }); }); };
  while (Date.now() - t0 < 4.5 * 60000) {
    LM_BRANDS.forEach(function (b) {
      got[b] = got[b] || {};
      setBrand_(b);
      ['L', 'F'].forEach(function (k) {
        if (!pend.ids[b][k] || got[b][k]) return;
        try { var c = lmCollect_(k, pend.ids[b][k]); if (!c.wait) got[b][k] = c; } catch (e) { got[b][k] = { err: String(e.message || e).slice(0, 200) }; }
      });
    });
    if (!pendingAny()) break;
    Utilities.sleep(15000);
  }
  Logger.log('');
  Logger.log('━━ COUNTS — the cache against Amazon\'s reports asked just now (Seller Central → Inventory → All Inventory; → Fix your products → Search suppressed)');
  Logger.log('   The cache is from ' + (meta.upTo || '?') + ' (' + (meta.kind || '?') + ' pass): a listing changed since then can make a line differ.');
  LM_BRANDS.forEach(function (b) {
    var lab = LM_LABEL[b], c = (meta.counts && meta.counts[b]) || {};
    var L = got[b] && got[b].L, F = got[b] && got[b].F;
    if (!L) Logger.log(lab + '  All Listings report: Amazon has not finished yet — run lmCheck again in a few minutes.');
    else if (L.err) Logger.log(lab + '  All Listings report: ' + L.err);
    else {
      var live = {}, total = 0;
      Object.keys(L.data.m).forEach(function (s) { var k = L.data.m[s][1] || '(none)'; live[k] = (live[k] || 0) + 1; total++; });
      Logger.log(lmLine_(lab + '  all listings', total, c.skus));
      var keys = {};
      Object.keys(live).concat(Object.keys(c.status || {})).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).sort().forEach(function (k) { Logger.log(lmLine_(lab + '  status ' + k, live[k] || 0, (c.status || {})[k] || 0)); });
    }
    if (!F) Logger.log(lab + '  Suppressed report: Amazon has not finished yet — run lmCheck again in a few minutes.');
    else if (F.err) Logger.log(lab + '  Suppressed report: ' + F.err);
    else Logger.log(lmLine_(lab + '  suppressed (report)', Object.keys(F.data.m).length, c.supReport || 0));
    Logger.log('     ' + lab + '  also suppressed by status (Buyable, not Discoverable): ' + lmNf_(c.supStatus || 0) + ' — Seller Central counts these under Search suppressed only when the report lists them');
  });
  if (!pendingAny()) props.deleteProperty('LM_CHECK');

  Logger.log('');
  Logger.log('━━ 10 RANDOM SKUs — the cache against a live read now (Seller Central → Inventory → the SKU → Edit listing / the detail page)');
  LM_BRANDS.forEach(function (b) {
    var tabs = (meta.parts.listings || {})[b] || [], ctabs = (meta.parts.catalog || {})[b] || [];
    if (!tabs.length) return;
    setBrand_(b);
    var seller = limgSeller_('');
    var pick = lmPickSkus_(tabs, 5);
    pick.forEach(function (rec) {
      Logger.log('');
      Logger.log('── ' + LM_LABEL[b] + ' · ' + rec.sku + ' · ASIN ' + (rec.asin || '—') + ' · cache read ' + lmWhen_(rec.readAt) + (rec.stale ? ' (kept from an older read)' : ''));
      var r = limgSp_('/listings/2021-08-01/items/' + seller + '/' + encodeURIComponent(rec.sku) + '?marketplaceIds=' + marketplaceId_() + '&includedData=summaries,attributes,issues', 'get');
      if (r.code >= 300) { Logger.log('   live read failed: ' + limgErr_(r, 'Listing').error.slice(0, 200)); return; }
      var live = lmItem_(r.body, Date.now());
      lmCompare_('status', rec.as, live.as);
      lmCompare_('issues', lmIssKey_(rec.iss), lmIssKey_(live.iss));
      lmCompare_('title (ours)', rec.t, live.t);
      lmCompare_('our pictures', lmImgKey_(rec.img), lmImgKey_(live.img));
      var cp = rec.asin && ctabs.length ? lmGet_(ctabs[lmHash_(rec.asin) % ctabs.length]) : null;
      var cc = cp && cp.items && cp.items[rec.asin];
      var cr = rec.asin ? lmCatRead_([rec.asin]) : null;
      var lc = cr && cr.code < 300 && cr.body.items && cr.body.items[0] ? lmCat_(cr.body.items[0], Date.now()) : null;
      if (!lc) Logger.log('   catalog live read failed' + (cr ? ' (' + cr.code + ')' : ''));
      else {
        lmCompare_('title shoppers see', cc ? cc.t : '(not cached)', lc.t);
        lmCompare_('live pictures', cc ? lmLiveKey_(cc.img) : '(not cached)', lmLiveKey_(lc.img));
        lmCompare_('parent ASIN', cc ? (cc.pa || []).join(',') : '(not cached)', (lc.pa || []).join(','));
      }
      var inv = limgSp_('/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=' + marketplaceId_() + '&marketplaceIds=' + marketplaceId_()
        + '&sellerSkus=' + encodeURIComponent(rec.sku), 'get');
      var s = inv.code < 300 && inv.body.payload && (inv.body.payload.inventorySummaries || [])[0];
      if (s) lmCompare_('stock (Available)', rec.fba == null ? '(none)' : String(rec.fba), String((s.inventoryDetails || {}).fulfillableQuantity || 0));
      else Logger.log('   stock (Available)        cache ' + (rec.fba == null ? '(none)' : rec.fba) + ' · live: not an FBA SKU or not read (' + inv.code + ')');
      Utilities.sleep(LM_CAT_GAP_MS);
    });
  });
  Logger.log('');
  Logger.log('A DIFFERENT line on a listing read more than a few minutes ago can be a real change since — run lmSku on it after the next light pass.');
}

function lmPickSkus_(tabs, n) {
  var out = [], tries = 0;
  while (out.length < n && tries < n * 4) {
    tries++;
    var p = lmGet_(tabs[Math.floor(Math.random() * tabs.length)]);
    var keys = Object.keys((p && p.items) || {}).filter(function (s) { return !p.items[s].noRead; });
    if (!keys.length) continue;
    var r = p.items[keys[Math.floor(Math.random() * keys.length)]];
    if (!out.some(function (x) { return x.sku === r.sku; })) out.push(r);
  }
  return out;
}

function lmCompare_(label, cache, live) {
  var a = String(cache == null ? '' : cache), b = String(live == null ? '' : live);
  var same = a === b;
  Logger.log('   ' + lmPad_(label, 22) + (same ? 'OK        ' : 'DIFFERENT ') + (same ? lmCut_(a, 90) : 'cache: ' + lmCut_(a, 70) + '  ·  live: ' + lmCut_(b, 70)));
  return same;
}
function lmIssKey_(iss) { return (iss || []).map(function (i) { return i.s.charAt(0) + i.c; }).sort().join(' ') || 'none'; }
function lmImgKey_(img) { return Object.keys(img || {}).sort().map(function (k) { return k + '=' + String(img[k]).split('/').pop(); }).join(' ') || 'none'; }
function lmLiveKey_(img) { return Object.keys(img || {}).sort().map(function (k) { return k + '=' + String(img[k].u).split('/').pop() + '(' + img[k].w + 'x' + img[k].h + ')'; }).join(' ') || 'none'; }

/* ============================== printing ============================== */

function lmLogItem_(r) {
  Logger.log('Seller Central (our listing)');
  Logger.log('   status          ' + (r.rs || '—') + ' (report) · ' + (r.as || '—') + ' (Amazon)' + (r.sup ? '  ⚠ SUPPRESSED (' + r.sup.src + '): ' + r.sup.why : ''));
  Logger.log('   stock           ' + (r.fba == null ? '—' : r.fba) + ' available (FBA)' + (r.qty != null ? ' · merchant quantity ' + r.qty : '') + (r.price != null ? ' · price ' + r.price : '') + (r.ch ? ' · ' + r.ch : ''));
  Logger.log('   product type    ' + (r.pt || '—') + ' · ' + (r.lvl || 'no parentage') + (r.psku ? ' of ' + r.psku : '') + (r.theme ? ' · theme ' + r.theme : ''));
  Logger.log('   title           ' + (r.t || '—'));
  (r.bl || []).forEach(function (x, i) { Logger.log('   bullet ' + (i + 1) + '        ' + lmCut_(x, 140)); });
  Logger.log('   description     ' + lmCut_(r.d || '—', 140));
  Logger.log('   highlights      ' + ((r.hl || []).join(' | ') || '—'));
  Logger.log('   search terms    ' + (r.kw || '—'));
  Logger.log('   variation       ' + (Object.keys(r.va || {}).map(function (k) { return k + ': ' + r.va[k]; }).join(' · ') || '—'));
  Logger.log('   our pictures    ' + lmImgKey_(r.img));
  Logger.log('   issues          ' + ((r.iss || []).map(function (i) { return i.s + ' ' + i.c + ': ' + lmCut_(i.m, 80); }).join(' | ') || 'none'));
}

function lmLogCat_(c) {
  Logger.log('   title           ' + (c.t || '—'));
  Logger.log('   pictures        ' + lmLiveKey_(c.img));
  Logger.log('   family          ' + (c.pa.length ? 'child of ' + c.pa.join(', ') : c.kids.length ? 'parent of ' + c.kids.length + ' (theme ' + (c.theme || '—') + ': ' + c.tattrs.join(', ') + ')' : 'no family'));
  Logger.log('   values          ' + (Object.keys(c.vals || {}).map(function (k) { return k + ': ' + c.vals[k]; }).join(' · ') || '—'));
  Logger.log('   browse path     ' + (c.bc || '—'));
  Logger.log('   sales rank      ' + (c.rk.main ? '#' + lmNf_(c.rk.main.r) + ' in ' + c.rk.main.c : '—') + (c.rk.sub ? ' · #' + lmNf_(c.rk.sub.r) + ' in ' + c.rk.sub.c : ''));
  Logger.log('   A+              not in the catalog API (not read)');
}

/* ============================== small helpers ============================== */

function lmState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('LM_STATE') || '{}'); }
  catch (e) { return {}; }
}
function lmSave_(st) {
  var s = JSON.stringify(st);
  while (s.length > 8800 && st.errors && st.errors.length) { st.errors.shift(); s = JSON.stringify(st); }
  while (s.length > 8800 && st.run && st.run.errors && st.run.errors.length) { st.run.errors.shift(); s = JSON.stringify(st); }
  PropertiesService.getScriptProperties().setProperty('LM_STATE', s);
}
function lmErr_(st, msg) {
  var line = '[' + lmNow_() + '] ' + String(msg).slice(0, 180);
  st.errors = (st.errors || []).concat([line]).slice(-8);
  if (st.run) st.run.errors = (st.run.errors || []).concat([line]).slice(-8);
}
function lmNow_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
function lmIso_(ms) { return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : ''; }
function lmAddDays_(iso, n) { return Utilities.formatDate(new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000), 'UTC', 'yyyy-MM-dd'); }
function lmWhen_(ms) { if (!ms) return 'never'; var m = Math.round((Date.now() - ms) / 60000); return lmIso_(ms) + (m < 120 ? ' (' + m + ' min ago)' : ' (' + Math.round(m / 60) + ' h ago)'); }
function lmIsAsin_(a) { return /^[A-Z0-9]{10}$/.test(String(a || '')); }
/** The part a SKU or ASIN lives in: lmHash_(key) % parts. Sellora uses the same sum ("h31" in lmMeta). */
function lmHash_(s) { s = String(s); var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function lmTab_(base, b, P, i) { return base + '_' + b + '_' + P + '_' + i; }
function lmScr_(b, kind, n) { return 'lmScr_' + b + '_' + kind + (n == null ? '' : '_' + n); }
function lmDropTab_(name) {
  try { var ss = lmBook_(), sh = ss.getSheetByName(name); if (sh) ss.deleteSheet(sh); } catch (e) { /* housekeeping only */ }
}
function lmDropScratch_(b) {
  try {
    var ss = lmBook_();
    ss.getSheets().forEach(function (sh) { if (sh.getName().indexOf('lmScr_' + b + '_') === 0) ss.deleteSheet(sh); });
  } catch (e) { /* housekeeping only */ }
}
function lmNextRun_(st) {
  var tz = Session.getScriptTimeZone(), now = new Date();
  var hour = Number(Utilities.formatDate(now, tz, 'H')), today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  if (st.run) return 'now (a ' + st.run.kind + ' pass is running)';
  if (st.reset) return 'a full pass on the next tick';
  var full = LM_FULL_HOURS.filter(function (h) { return !(st.slots || {})[today + '|' + h] && h > hour; })[0];
  var light = hour >= LM_LIGHT_FROM && hour < LM_LIGHT_TO ? lmIso_((st.lightAt || Date.now()) + LM_LIGHT_EVERY_MIN * 60000) : today + ' ' + (hour < LM_LIGHT_FROM ? '' : 'tomorrow ') + LM_LIGHT_FROM + ':00';
  return (full != null ? 'full pass at ' + full + ':00 · ' : '') + 'light pass from ' + light;
}
function lmStatusLine_(m) { return Object.keys(m || {}).sort().map(function (k) { return k + ' ' + lmNf_(m[k]); }).join(', ') || '—'; }
function lmLine_(label, amazon, cache) {
  return '   ' + lmPad_(label, 34) + 'Amazon ' + lmPad_(lmNf_(amazon), 8) + 'cache ' + lmPad_(lmNf_(cache), 8) + (Number(amazon) === Number(cache) ? 'OK' : 'DIFFERENT');
}
function lmNf_(n) { return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function lmPad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lmCut_(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** Editor: the arithmetic behind the call estimates in the header, from what the cache holds now. */
function lmQuota_() {
  var meta = lmGet_('lmMeta') || {}, skus = 0, asins = 0;
  LM_BRANDS.forEach(function (b) { var c = (meta.counts || {})[b] || {}; skus += c.skus || 0; asins += c.asins || 0; });
  skus = skus || 4400; asins = asins || 4600;
  var full = 6 + 40 + Math.ceil(skus / LM_PAGE) + Math.ceil(asins / LM_CAT_BATCH);
  var lights = Math.round((LM_LIGHT_TO - LM_LIGHT_FROM) * 60 / 20);       // a 10-minute tick and a 15-minute gap: every ~20 min
  Logger.log('SKUs ' + lmNf_(skus) + ' · ASINs ' + lmNf_(asins));
  Logger.log('full pass   ≈ ' + lmNf_(full) + ' SP-API calls');
  Logger.log('light pass  ≈ 4–' + (2 * (Math.ceil(LM_LIGHT_MAX / LM_PAGE) + Math.ceil(LM_LIGHT_MAX / LM_CAT_BATCH))) + ' calls (both brands), ' + lights + ' a day');
  Logger.log('per day     ≈ ' + lmNf_(2 * full + lights * 4) + ' – ' + lmNf_(2 * full + lights * 40) + ' UrlFetch calls');
}
