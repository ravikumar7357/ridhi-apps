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
 *                                 (title_differentiation), search terms (generic_keyword), variation attributes,
 *                                 which of the Workspace's spec attributes are filled (LM_SPEC_ATTRS → `sp`) and
 *                                 our picture slots MAIN, PT01–PT08, SWCH.
 *   5. Catalog Items 2022-04-01    20 ASINs a call (summaries,images,relationships,attributes,classifications,
 *                                 salesRanks): the title shoppers see, live pictures with width/height, parent ↔
 *                                 children with the variation theme and its values, browse path, sales ranks.
 *                                 A+ is NOT in the catalog API: `aplus` stays null ("not read"), never false.
 *   6. A+ Content API 2020-11-01   once a day, after the 13:00 full pass: every A+ document (searchContentDocuments — name,
 *                                 status, type, last update) and the ASINs it is attached to
 *                                 (listContentDocumentAsinRelations) → lmAplus_<brand>. See "A+ content" below.
 *
 * WHEN (script time zone, Asia/Kolkata):
 *   full pass   for 13:00 and 18:00 — the three reports are asked LM_EARLY_MIN minutes early (12:30 / 17:30) so they
 *               are ready when the reading starts; at 13:00 / 18:00 every SKU and every ASIN is read again. The reading
 *               does not wait for the reports: it starts from the SKU list of the last pass and adds the report's new
 *               SKUs when the All Listings report is in. Only the final write waits for all three reports.
 *               Ready about 20–30 minutes after 13:00 / 18:00.
 *   light pass  09:00–21:00, on the first tick at least LM_LIGHT_EVERY_MIN minutes after the last one — only the
 *               listings Amazon says changed since the last pass (lastUpdatedAfter), and their catalog entries;
 *               if Amazon refuses that question, the LM_LIGHT_MAX listings read longest ago instead.
 *   lmTick drives both: every 10 minutes, every 5 while a full pass runs (lmTimer_ swaps the timer and back).
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
 *   lmAplus_<brand>                { b, at, ok, calls, docs: { key: document }, asins: { asin: [keys] } } — the A+ documents and
 *                                  what they are attached to; lmMeta.aplus[brand] names the tab, its read time and `stale`.
 *
 * RUN FROM THE EDITOR
 *   lmSetup()          once: creates (or finds) "Sellora Listing Cache", checks it can be written, installs the timer,
 *                      starts the first full pass
 *   lmStatus()         what it is doing, what the cache holds, any errors, today's script minutes — with a warning
 *                      when the project looks near Apps Script's daily trigger limit
 *   lmRunNow()         a full pass on the next tick instead of waiting for 13:00 / 18:00
 *   lmSku('RTC14-1')   one SKU from the cache: the listing, its catalog entry, its stock
 *   lmCheck()          THE PROOF: the cache against Amazon right now (counts vs fresh reports, 10 SKUs vs live reads)
 *   lmAplusNow()       A+ read again on the next free tick (the daily one follows the 13:00 pass)
 *   lmAplus('B0…')     one ASIN's A+ documents from the cache          lmAplusCheck()  A+ against Amazon's publish records now
 *   lmStop()           removes the timer. To undo everything: lmStop, delete this file and the lmCacheRead_ line in
 *                      Code.gs, the "Sellora Listing Cache" spreadsheet and the Script Properties LM_*.
 *
 * CALLS AND QUOTAS (about 4,400 SKUs: Ridhi ~2,680, CPC ~1,720 — measured 9 Oct; see lmQuota_ for the arithmetic):
 *   full pass  ≈ 6 report requests + ~40 report polls, ~220 Listings Items calls, ~240 Catalog Items calls
 *              ≈ 510 SP-API calls, ~10–14 minutes of script time in ~4–6 five-minute ticks after 13:00 / 18:00
 *              (a tick keeps reading until its time is used; a full scratch buffer is written and the reading goes on);
 *   light pass ≈ 2–4 calls per brand when little changed, at most ~22 per brand (200 changed listings);
 *   per day    ≈ 1,000 (two full passes) + 150–1,800 (36 light passes) ≈ 1,200–2,800 UrlFetch calls, of the
 *              20,000 (Gmail) / 100,000 (Workspace) Apps Script allows; ~45–60 minutes of trigger time.
 *   A+ (once a day): per brand ceil(documents / Amazon's page) + one call per document — e.g. 150 documents ≈ 160 calls a
 *              brand, ~2–3 minutes of script time. The exact count of the last read is in lmStatus ("with N calls").
 *   Rates: Listings Items 5 req/s — we leave LM_LIST_GAP_MS between calls (≤ 4/s); Catalog Items 2 req/s — we leave
 *   LM_CAT_GAP_MS (≈ 1.6/s). Sellora's own reads share those buckets; limgSp_ already waits and retries on 429, and
 *   a 429 that survives that ends the tick ("Amazon asked us to slow down"), the next tick carries on.
 */

var LM_BUDGET_MS = 4.5 * 60000;
var LM_FULL_HOURS = [13, 18];          // script time zone (Asia/Kolkata)
var LM_EARLY_MIN = 30;                 // the reports of a full pass are asked this many minutes before its hour
var LM_TICK_MIN = 10, LM_TICK_FULL_MIN = 5;   // the timer: every 10 minutes, every 5 while a full pass runs
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
var LM_SCR_MAX = 1200000;              // characters per scratch tab: then it is written, a new one started, the reading goes on
var LM_LIGHT_MAX = 200;                // listings a light pass reads at most per brand
var LM_LIGHT_OVERLAP_MS = 5 * 60000;   // a light pass asks from a little before the last one, so nothing slips between
var LM_TEXT_MAX = 2000;                // Amazon's own limit for a description; bullets are cut at 500
var LM_RANKS_MAX = 8;                  // category ranks kept per ASIN (Amazon gives one to three)
var LM_REPORT_WAIT_MS = 50 * 60000;    // a report Amazon has not finished after this is asked for again
var LM_REPORTS = { L: 'GET_MERCHANT_LISTINGS_ALL_DATA', F: 'GET_MERCHANTS_LISTINGS_FYP_REPORT', S: 'GET_FBA_INVENTORY_PLANNING_DATA' };
var LM_REPORT_NAME = { L: 'All Listings report', F: 'Suppressed listings report', S: 'FBA stock report' };
// Variation attributes kept per listing and per catalog entry (a theme names some of these; Sellora reads the parent's).
var LM_BOOK_NAME = 'Sellora Listing Cache';
var LM_TICK_GAP_MIN = 25;              // no tick for this long while the timer is on: Apps Script is skipping it
var LM_VAR_ATTRS = ['color', 'size', 'set_name', 'style', 'pattern', 'pattern_name', 'material', 'item_shape', 'scent',
  'flavor', 'number_of_items', 'item_package_quantity', 'unit_count', 'size_name', 'color_name', 'style_name', 'team_name'];
// The spec attributes Sellora's Workspace checks (listing-workspace.js LI_WS_SPECS — keep the two lists the same): `sp` names the filled ones.
var LM_SPEC_ATTRS = ['material', 'color', 'size', 'pattern', 'style', 'item_shape', 'number_of_items', 'theme', 'care_instructions',
  'special_feature', 'item_type_name', 'fabric_type'];

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

/** For Code.gs ?cache=lmMeta / lmListings_* / lmCatalog_* / lmAplus_*: null (→ "nothing cached yet") until lmSetup has run. */
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
  ScriptApp.newTrigger('lmTick').timeBased().everyMinutes(LM_TICK_MIN).create();
  PropertiesService.getScriptProperties().setProperty('LM_TIMER_MIN', String(LM_TICK_MIN));
  var st = lmState_(); st.reset = true; lmSave_(st);
  Logger.log('✅ lmTick now runs every ' + LM_TICK_MIN + ' minutes (every ' + LM_TICK_FULL_MIN + ' while a full pass runs).');
  Logger.log('   The first full pass starts on the next tick: three reports per brand, then every SKU and ASIN.');
  Logger.log('   The very first one waits for the All Listings report before reading (there is no SKU list yet): about 30–45 minutes. Watch it with lmStatus().');
  Logger.log('   After that: full passes for ' + LM_FULL_HOURS.join(':00 and ') + ':00 (reports asked ' + LM_EARLY_MIN + ' minutes early), light passes ' + LM_LIGHT_FROM + ':00–' + LM_LIGHT_TO + ':00 ('
    + Session.getScriptTimeZone() + '). When the first pass is done, run lmCheck() for the proof.');
}

function lmStop() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lmTick') { ScriptApp.deleteTrigger(t); n++; }
  });
  PropertiesService.getScriptProperties().deleteProperty('LM_TIMER_MIN');
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
    Logger.log('running    ' + run.kind + ' pass, started ' + run.startedAt
      + (run.readFrom && lmNow_() < run.readFrom ? ' — reports asked early; listings are read from ' + run.readFrom.slice(11) : ''));
    LM_BRANDS.forEach(function (b) {
      var x = run.B && run.B[b];
      if (!x) return;
      var rep = Object.keys(LM_REPORTS).map(function (k) { var j = x.rep[k]; return LM_REPORT_NAME[k] + ' ' + (j ? j.st + (j.t ? ' (try ' + j.t + ')' : '') : '—'); }).join(' · ');
      var step = x.ph === 'go' ? 'reading' + (x.kl ? '' : ' (waits for the All Listings report: no SKU list yet)') : x.ph;
      Logger.log(LM_LABEL[b] + '  step ' + step + '  ·  listings ' + (x.i || 0) + '/' + (x.n || '?') + (x.kl && !x.kx ? ' (SKU list of the last pass; the report adds new ones)' : '')
        + '  ·  catalog ' + (x.ci || 0) + '/' + (x.cn || '?') + (x.miss ? '  ·  ' + x.miss + ' not read (old kept)' : '') + (x.err ? '  ·  ' + x.err : ''));
      Logger.log('        ' + rep);
    });
  } else Logger.log('running    nothing' + (st.reset ? ' — a full pass is asked for' : ''));
  Logger.log('next       ' + lmNextRun_(st));
  Logger.log('timer      ' + (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'lmTick'; })
    ? 'every ' + (prop_('LM_TIMER_MIN') || LM_TICK_MIN) + ' minutes' : 'not installed — run lmSetup()'));
  // a part layout that grew is a fact, not a fault (older versions filed it under errors)
  (st.errors || []).forEach(function (e) { Logger.log((lmIsNote_(e) ? 'note       ' : 'error      ') + e); });
  (st.notes || []).forEach(function (e) { Logger.log('note       ' + e); });
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
  (meta.errors || []).forEach(function (e) { Logger.log('last pass  ' + (lmIsNote_(e) ? 'note: ' : '') + e); });
  (meta.notes || []).forEach(function (e) { Logger.log('last pass  note: ' + e); });
  lmAplusStatus_(st, meta);
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
    lmTimer_();
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
  var mins = hour * 60 + Number(Utilities.formatDate(now, tz, 'mm'));
  st.slots = st.slots || {};
  if (st.run && st.run.v !== 2) {          // a pass begun by the version before this one: begin it again with these steps
    lmNote_(st, 'a full pass begun by the older ListingMatch was started again with the new steps');
    st.run = null; st.reset = true;
  }
  // a slot is due LM_EARLY_MIN minutes before its hour: the reports are asked then, the reading waits for the hour
  var due = LM_FULL_HOURS.filter(function (h) { return mins >= h * 60 - LM_EARLY_MIN && !st.slots[today + '|' + h]; });
  if (!st.run && (st.reset || due.length)) {
    due.forEach(function (h) { st.slots[today + '|' + h] = 1; });       // one pass covers every slot that is due
    Object.keys(st.slots).forEach(function (k) { if (k.slice(0, 10) < lmAddDays_(today, -2)) delete st.slots[k]; });
    var last = due.length ? due[due.length - 1] : null;
    var readFrom = !st.reset && last != null && mins < last * 60 ? today + ' ' + lmHH_(last) + ':00' : '';
    LM_BRANDS.forEach(function (b) { lmDropScratch_(b); });          // nothing left from a pass that was cut short
    st.run = lmPlanFull_(readFrom);
    st.reset = false;
    lmSave_(st);
    Logger.log('lmTick: full pass started' + (readFrom ? ' — reports asked now, listings read from ' + readFrom.slice(11) : '') + '.');
  }
  if (st.run) {
    try { lmFullStep_(st, left); }
    finally { lmSave_(st); }
    return;
  }
  // A+ content: once a day, on the ticks after today's 13:00 full pass has finished (or when lmAplusNow asked)
  if (lmAplusDue_(st, today, mins)) {
    LM_BRANDS.forEach(function (b) { lmDropTab_(lmAplusScr_(b)); });     // nothing left from a read that was cut short
    st.ap = lmAplusPlan_(today);
    st.apAsk = false;
    lmSave_(st);
    Logger.log('lmTick: A+ read started.');
  }
  if (st.ap) {
    try { lmAplusStep_(st, left); }
    finally { lmSave_(st); }
    return;                                    // this tick was the A+ read's; the light pass has the next one
  }
  var mins = (Date.now() - (st.lightAt || 0)) / 60000;
  if (hour >= LM_LIGHT_FROM && hour < LM_LIGHT_TO && mins >= LM_LIGHT_EVERY_MIN) {
    try { lmLight_(st, left); }
    finally { lmSave_(st); }
  }
}

/** A brand's progress (kept in LM_STATE, so the names are short):
 *    ph   'go' (reports and reads together) → 'write' → 'done' | 'gave' (no All Listings report: nothing touched)
 *    kl   the SKU list is in scratch tab K (ks: 'report', or 'cache' = the last pass's SKUs while the report is not in)
 *    kx   the report's SKUs the list did not have are added      ki  every SKU of the list so far is read
 *    kf   listings finished (kx and ki)                          i / n   listings read / in the list
 *    ca   the ASIN list (scratch A) is started                   cx  it has every ASIN of kf's listings and the report
 *    cf   catalog finished (cx and every ASIN read)              ci / cn  ASINs read / in the list
 *    bt / cbt  tries of the current Listings / Catalog call     nL / nC  scratch tabs written    wp / wc  parts written */
function lmPlanFull_(readFrom) {
  var B = {};
  LM_BRANDS.forEach(function (b) {
    B[b] = { ph: 'go', rep: { L: { st: 'new', t: 0 }, F: { st: 'new', t: 0 }, S: { st: 'new', t: 0 } }, kl: 0, ks: '', kx: 0, ki: 0, kf: 0, i: 0, n: 0,
      ca: 0, cx: 0, cf: 0, ci: 0, cn: 0, nL: 0, nC: 0, wp: 0, wc: 0, bt: 0, cbt: 0, miss: 0 };
  });
  // readFrom 'yyyy-MM-dd HH:mm' (script time): the listings and the catalog are read from then on; '' = at once
  return { v: 2, kind: 'full', startedAt: lmNow_(), startMs: Date.now(), readFrom: readFrom || '', B: B, errors: [], notes: [] };
}

/** One tick of a full pass: every brand moves as far as the time allows. The reports are polled first; the listings
 *  and the catalog are read in the same tick, whether or not the reports are in yet. The write waits for both. */
function lmFullStep_(st, left) {
  var run = st.run;
  var reading = !run.readFrom || lmNow_() >= run.readFrom;
  try {
    for (var k = 0; k < LM_BRANDS.length && left() > 30000; k++) {
      var b = LM_BRANDS[k], x = run.B[b];
      if (x.ph !== 'go' && x.ph !== 'write') continue;
      setBrand_(b);
      if (x.ph === 'go') {
        lmReports_(st, b, x, left);
        if (x.ph === 'go' && !x.kl) lmSkuList_(st, b, x);
        if (x.ph === 'go' && reading && x.kl && !x.kf) lmItems_(st, b, x, left);
        if (x.ph === 'go' && reading && x.ki && !x.cf) lmCatalogStep_(st, b, x, left);
        if (x.ph === 'go' && x.kf && x.cf && lmReportsIn_(x)) { x.ph = 'write'; x.wp = 0; x.wc = 0; }
      }
      if (x.ph === 'write' && left() > 30000) lmWrite_(st, b, x, left);
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
  }
}

/** Every report is in (or given up on after LM_TRIES — the All Listings report never is: then the brand is 'gave'). */
function lmReportsIn_(x) {
  return !Object.keys(LM_REPORTS).some(function (k) { var s = x.rep[k].st; return s === 'new' || s === 'asked' || s === 'got'; });
}

/** The SKUs to read: the All Listings report's when it is in, else the last pass's (so the reading need not wait for
 *  the report — lmItems_ adds the report's new SKUs later). The very first pass has no last pass: it waits. */
function lmSkuList_(st, b, x) {
  var list = null, src = '';
  if (x.rep.L.st === 'done') {
    var R = lmGet_(lmScr_(b, 'R'));
    if (R && R.L) { list = Object.keys(R.L.m || R.L).sort(); src = 'report'; }
  }
  if (!list) {
    var meta = lmGet_('lmMeta') || {}, seen = {};
    (((meta.parts || {}).listings || {})[b] || []).forEach(function (t) { var p = lmGet_(t); Object.keys((p && p.items) || {}).forEach(function (s) { seen[s] = 1; }); });
    if (Object.keys(seen).length) { list = Object.keys(seen).sort(); src = 'cache'; }
  }
  if (!list) return;
  try { lmPut_(lmScr_(b, 'K'), { list: list }); }
  catch (we) { lmErr_(st, LM_LABEL[b] + ': could not write the SKU list — next tick: ' + String(we.message || we).slice(0, 120)); return; }
  x.kl = 1; x.ks = src; x.kx = src === 'report' ? 1 : 0; x.n = list.length; x.i = 0;
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
  var K = lmGet_(lmScr_(b, 'K'));
  if (!K || !K.list) {
    lmErr_(st, LM_LABEL[b] + ': the SKU list scratch tab is gone — reading the listings again');
    x.kl = 0; x.kx = 0; x.ki = 0; x.kf = 0; x.i = 0; x.nL = 0; x.ca = 0; x.cx = 0; x.cf = 0; x.ci = 0; x.nC = 0;
    return;
  }
  var skus = K.list;
  if (!x.kx && x.rep.L.st === 'done') {        // the All Listings report is in: its SKUs the list did not have (new since the last pass)
    var R = lmGet_(lmScr_(b, 'R'));
    if (!R || !R.L) { x.rep.L = { st: 'new', t: 0 }; lmErr_(st, LM_LABEL[b] + ': the report scratch tab is gone — asking again'); return; }
    var inK = {};
    skus.forEach(function (s) { inK[s] = 1; });
    var extra = Object.keys(R.L.m || R.L).filter(function (s) { return !inK[s]; }).sort();
    if (extra.length) {
      skus = skus.concat(extra);
      try { lmPut_(lmScr_(b, 'K'), { list: skus }); }
      catch (we0) { lmErr_(st, LM_LABEL[b] + ': could not write the SKU list — next tick: ' + String(we0.message || we0).slice(0, 120)); return; }
    }
    x.kx = 1;
  }
  x.n = skus.length;
  var seller = limgSeller_('');
  var buf = {}, size = 0, i = x.i, stop = '';
  // a full buffer goes to a scratch tab and the reading goes on in the same tick; x.i moves only once it is in the sheet
  var flush = function () {
    if (Object.keys(buf).length) {
      try { lmPut_(lmScr_(b, 'L', x.nL), { items: buf }); x.nL++; }
      catch (we) { lmErr_(st, LM_LABEL[b] + ': could not write the cache sheet — those listings are read again: ' + String(we.message || we).slice(0, 120)); return false; }
    }
    buf = {}; size = 0; x.i = i;
    return true;
  };
  while (i < skus.length && left() > 40000) {
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
    if (size >= LM_SCR_MAX && !flush()) return;
    Utilities.sleep(LM_LIST_GAP_MS);
  }
  if (stop) lmErr_(st, LM_LABEL[b] + ': ' + stop);
  if (!flush()) return;
  if (x.i >= skus.length) { x.ki = 1; if (x.kx) x.kf = 1; }
}

/* ----- step 3: every ASIN from the catalog, 20 a call; parents are added as children name them ----- */
/** Starts once the SKU list is read (the report need not be in); the ASINs of the report and of its new SKUs are
 *  added when the listings are finished (kf), and only then can the catalog finish. */
function lmCatalogStep_(st, b, x, left) {
  var A = x.ca ? lmGet_(lmScr_(b, 'A')) : null;
  if (x.ca && (!A || !A.list)) { lmErr_(st, LM_LABEL[b] + ': the ASIN list is gone — reading the catalog again'); x.ca = 0; x.cx = 0; x.ci = 0; x.nC = 0; A = null; }
  if (!x.ca || (x.kf && !x.cx)) {
    // every ASIN of a listing read so far (and of the All Listings report once it is in); parents are added as Amazon names them
    var cur = A ? A.list : [], had = {};
    cur.forEach(function (a) { had[a] = 1; });
    var R = x.rep.L.st === 'done' ? lmGet_(lmScr_(b, 'R')) : null;
    var more = lmAsinsRead_(b, x, R).filter(function (a) { return !had[a]; });
    A = { list: cur.concat(more) };
    try { lmPut_(lmScr_(b, 'A'), A); } catch (we2) { lmErr_(st, LM_LABEL[b] + ': could not write the ASIN list — next tick'); return; }
    if (!x.ca) { x.ca = 1; x.ci = 0; }
    if (x.kf) x.cx = 1;
  }
  var list = A.list, have = {};
  list.forEach(function (a) { have[a] = 1; });
  var buf = {}, size = 0, i = x.ci, stop = '', added = 0;
  var flush = function () {
    try {
      if (Object.keys(buf).length) { lmPut_(lmScr_(b, 'C', x.nC), { items: buf }); x.nC++; }
      if (added) lmPut_(lmScr_(b, 'A'), { list: list });
    } catch (we) { lmErr_(st, LM_LABEL[b] + ': could not write the cache sheet — those entries are read again: ' + String(we.message || we).slice(0, 120)); return false; }
    buf = {}; size = 0; added = 0; x.ci = i; x.cn = list.length;
    return true;
  };
  while (i < list.length && left() > 40000) {
    var batch = list.slice(i, i + LM_CAT_BATCH), r;
    try { r = lmCatRead_(batch); }
    catch (e) { stop = 'Catalog batch at ' + batch[0] + ': ' + String(e.message || e).slice(0, 140) + ' — next tick'; break; }
    if (r.code === 429) { stop = 'Amazon asked us to slow down (Catalog) — next tick'; break; }
    if (r.code >= 300) {
      x.cbt = (x.cbt || 0) + 1;
      if (x.cbt < LM_TRIES) { stop = 'Catalog batch at ' + batch[0] + ': answered ' + r.code + ' — trying again'; break; }
      lmErr_(st, LM_LABEL[b] + ': gave up on ' + batch.length + ' catalog entries from ' + batch[0] + ' — their last good data is kept');
      x.cbt = 0; i += batch.length;
      continue;
    }
    x.cbt = 0;
    var now = Date.now();
    (r.body.items || []).forEach(function (it) {
      var c = lmCat_(it, now);
      buf[c.asin] = c; size += JSON.stringify(c).length;
      (c.pa || []).forEach(function (p) { if (lmIsAsin_(p) && !have[p]) { have[p] = 1; list.push(p); added++; } });
    });
    i += batch.length;
    if (size >= LM_SCR_MAX && !flush()) return;
    Utilities.sleep(LM_CAT_GAP_MS);
  }
  if (stop) lmErr_(st, LM_LABEL[b] + ': ' + stop);
  if (!flush()) return;
  if (x.ci >= list.length && x.cx) x.cf = 1;
}

/** Every ASIN of a listing read in this pass (scratch L tabs) and, once it is in, of the All Listings report — sorted. */
function lmAsinsRead_(b, x, R) {
  var asins = {};
  for (var n = 0; n < x.nL; n++) {
    var part = lmGet_(lmScr_(b, 'L', n));
    Object.keys((part && part.items) || {}).forEach(function (s) { var a = part.items[s].asin; if (lmIsAsin_(a)) asins[a] = 1; });
  }
  var L = R && R.L ? (R.L.m || R.L) : {};
  Object.keys(L).forEach(function (s) { var a = L[s][0]; if (lmIsAsin_(a)) asins[a] = 1; });
  return Object.keys(asins).sort();
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
  var skus = Object.keys(L).sort();
  // Only the ASINs of the report's SKUs and their parents: a SKU read from the last pass's list but gone from the
  // report takes its catalog entry with it.
  var want = {};
  skus.forEach(function (s) { var a = (L[s] || [])[0], f = fresh[s]; if (lmIsAsin_(a)) want[a] = 1; if (f && lmIsAsin_(f.asin)) want[f.asin] = 1; });
  Object.keys(want).forEach(function (a) { ((freshC[a] || {}).pa || []).forEach(function (p) { want[p] = 1; }); });
  var asins = A.list.filter(function (a) { return want[a]; });
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
      x.P = x.P * 2; x.wp = 0; lmNote_(st, LM_LABEL[b] + ': listings laid out in ' + x.P + ' parts');
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
    if (JSON.stringify(cobj).length > LM_PART_MAX && x.PC < 512) {
      lmDropNew_(oldC, 'lmCatalog', b, x.PC, x.wc);
      x.PC = x.PC * 2; x.wc = 0; lmNote_(st, LM_LABEL[b] + ': catalog laid out in ' + x.PC + ' parts');
      continue;
    }
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
  // In Amazon's Suppressed listings report: true / false; null when that report has never been read for this SKU.
  rec.inSupReport = rec.fyp === undefined ? null : !!rec.fyp;
  if (ctx.S) {
    var m = ctx.S.m || {};
    rec.fba = Object.prototype.hasOwnProperty.call(m, sku) ? m[sku] : null;
    delete rec.fbaStale;
  } else if (old && old.fba !== undefined) { rec.fba = old.fba; rec.fbaStale = 1; }
  rec.sup = lmSup_(rec);
  return rec;
}

function lmStale_(old) { var r = JSON.parse(JSON.stringify(old)); r.stale = 1; return r; }

/** "Suppressed" — the same three-part rule as Sellora's lrShopOf: a status that is BUYABLE without DISCOVERABLE, an issue whose
 *  enforcement action is SEARCH_SUPPRESSED or LISTING_SUPPRESSED, or the Suppressed listings report. An ERROR alone never is. */
var LM_SUPPRESS_ACTS = ['SEARCH_SUPPRESSED', 'LISTING_SUPPRESSED'];
function lmSup_(rec) {
  var s = String(rec.as || '');
  if (/BUYABLE/.test(s) && !/DISCOVERABLE/.test(s)) return { src: 'status', why: 'Buyable but not discoverable (Amazon status ' + s + ')' };
  var hit = (rec.iss || []).filter(function (i) { return (i.e || []).some(function (a) { return LM_SUPPRESS_ACTS.indexOf(a) >= 0; }); })[0];
  if (hit) return { src: 'enforcement', why: hit.e.filter(function (a) { return LM_SUPPRESS_ACTS.indexOf(a) >= 0; })[0] + ' (' + hit.c + ') — ' + String(hit.m || '').slice(0, 140) };
  if (rec.fyp) return { src: 'report', why: rec.fyp.r + (rec.fyp.d ? ' — ' + rec.fyp.d : '') };
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
      if (r.inSupReport) c.supReport++;                 // Amazon's own count: everything its report lists
      if (r.sup && r.sup.src === 'status') c.supStatus++;
      else if (r.sup && r.sup.src === 'enforcement') c.supEnforced = (c.supEnforced || 0) + 1;
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
  M.notes = (run.notes || []).slice(-6);
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
  // filled = any value besides the marketplace / language tags (the same test as the Workspace's live ?lfix=get read)
  var filled = function (k) { return (at[k] || []).some(function (e) { return e && Object.keys(e).some(function (f) { return f !== 'marketplace_id' && f !== 'language_tag' && e[f] != null && e[f] !== ''; }); }); };
  return {
    sku: it.sku, asin: s.asin || '', as: (s.status || []).join(','), pt: s.productType || '',
    sp: LM_SPEC_ATTRS.filter(filled),
    t: String(s.itemName || one('item_name')).slice(0, 300),
    bl: vals('bullet_point', 500), d: vals('product_description', LM_TEXT_MAX).join('\n').slice(0, LM_TEXT_MAX),
    hl: vals('title_differentiation', 200), kw: vals('generic_keyword', 500).join(' '),
    lvl: one('parentage_level'), psku: rel ? String(rel.parent_sku || '') : '', theme: one('variation_theme', 'name'), va: va, img: img,
    itk: one('item_type_keyword').slice(0, 80),            // Amazon's word for what the product is (the Listing Optimiser's title rules)
    // e = Amazon's enforcement action names (SEARCH_SUPPRESSED, LISTING_SUPPRESSED, …), only when it names some
    iss: (it.issues || []).slice(0, 12).map(function (i) {
      var o = { c: String(i.code || ''), s: String(i.severity || ''), m: String(i.message || '').slice(0, 300), a: (i.attributeNames || []).slice(0, 4) };
      var e = ((i.enforcements && i.enforcements.actions) || []).map(function (x) { return String((x && x.action) || ''); }).filter(Boolean);
      if (e.length) o.e = e;
      return o;
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
    var r = 0, c = '', id = '';
    (list || []).forEach(function (x) { var n = Number(x.rank) || 0; if (n > 0 && (!r || n < r)) { r = n; c = x.title || x.classificationId || ''; id = String(x.classificationId || ''); } });
    if (!r) return null;
    var o = { r: r, c: String(c).slice(0, 80) };
    if (id) o.id = id;                                   // the category's id (classification ranks only; a department rank has none)
    return o;
  };
  var ranks = (it.salesRanks && it.salesRanks[0]) || {};
  var path = lmPathOf_(it);
  // EVERY category rank Amazon gives (not only the best), each with its category id — Sellora's Categories tab matches them to the path by id
  var rks = (ranks.classificationRanks || []).filter(function (x) { return x && Number(x.rank) > 0; }).slice(0, LM_RANKS_MAX).map(function (x) {
    return { id: String(x.classificationId || ''), c: String(x.title || x.classificationId || '').slice(0, 80), r: Number(x.rank) };
  });
  return {
    asin: it.asin, t: String(s.itemName || attrVal_(a, 'item_name') || '').slice(0, 300), brand: s.brand || s.brandName || '',
    img: img, pa: pa, kids: kids, theme: theme, tattrs: tattrs, vals: vals,
    bc: path.names.join(' › '), bcIds: path.ids, bcId: (s.browseClassification && s.browseClassification.classificationId) || '',
    rk: { main: best(ranks.displayGroupRanks), sub: best(ranks.classificationRanks) }, rks: rks,
    aplus: null, readAt: now,
  };
}

/** The browse path from the classification's parent chain: { names: ['Home & Kitchen', …, 'Tablecloths'], ids: the category id of each
 *  name, in the same order ('' where Amazon gives none) }. `bc` is the names joined with " › "; `bcIds` the ids. */
function lmPathOf_(it) {
  var cls = (it.classifications && it.classifications[0] && it.classifications[0].classifications) || [];
  var c = cls[0];
  var names = [], ids = [];
  for (var g = 0; c && g < 12; g++) { if (c.displayName) { names.unshift(c.displayName); ids.unshift(String(c.classificationId || '')); } c = c.parent; }
  var bcl = it.summaries && it.summaries[0] && it.summaries[0].browseClassification;
  if (!names.length && bcl && bcl.displayName) { names.push(bcl.displayName); ids.push(String(bcl.classificationId || '')); }
  return { names: names, ids: ids };
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
      lmCompare_('status', lmStatusKey_(rec.as), lmStatusKey_(live.as));   // BUYABLE,DISCOVERABLE = DISCOVERABLE,BUYABLE
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
function lmStatusKey_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).sort().join(','); }
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

/* ============================== A+ content: once a day, after the 13:00 full pass ============================== */
/* WHAT: every A+ document of the brand (A+ Content API 2020-11-01 searchContentDocuments) — its name, status (APPROVED /
 * SUBMITTED / DRAFT / REJECTED), type (Premium / Basic, from Amazon's badges), last update, any rejection reason Amazon
 * sends — and the ASINs each document is attached to (listContentDocumentAsinRelations, one document at a time).
 * WHEN: once a day, on the ticks after the 13:00 full pass has finished (never during a full pass, never in the 18:00
 * one, never in a light pass). lmAplusNow() asks for an extra read on the next tick.
 * WHERE: one tab per brand, lmAplus_<brand>: { b, at, atMs, ok, calls, nDocs, nAsins, partial,
 *   docs:  { key: { k, n (name), s (status), t ('Premium' | 'Basic' | ''), bd (badges), u (updated), rr (reasons),
 *                   a (attached ASINs; null = could not be read), as (1 = the list is from an older read) } },
 *   asins: { asin: [document keys] } }                      and lmMeta.aplus[brand] = { tab, at, atMs, calls, docs,
 *   asins, partial, stale, err } — Sellora reads lmMeta first, then the tab it names (?cache=lmAplus_<brand>).
 * NEVER WIPED BY A FAILURE: a search that fails LM_APLUS_TRIES times, an answer of no documents where the last read had
 * some, or documents that all come back with no ASIN, leave the last good tab as it is and mark it stale in lmMeta
 * (with the reason). A single document whose ASIN list cannot be read keeps the list of the last read (`as: 1`), or
 * `a: null` when there is none — Sellora then shows "Not checked" where it cannot be sure, never "Missing".
 * CALLS: per brand ceil(documents / Amazon's page) searches + one ASIN-list call per document (+1 per extra page of a
 * long list). The exact number of each read is kept (`calls`) and printed by lmStatus. Rate: A+ Content allows 10
 * requests a second; we leave LM_APLUS_GAP_MS between calls. */
var LM_APLUS_HOUR = 13;                // the full pass the daily A+ read follows (script time zone)
var LM_APLUS_GAP_MS = 150;
var LM_APLUS_TRIES = 3;
var LM_APLUS_PAGES_MAX = 500;          // a backstop against a page token that never ends
var LM_APLUS_FAILS = 6;                // ticks an A+ read may fail before today's read is given up
var LM_APLUS_MAX_MS = 3 * 3600000;     // …or this long after it started
var LM_APLUS_REASON_MAX = 300;

function lmAplusTab_(b) { return 'lmAplus_' + b; }
function lmAplusScr_(b) { return 'lmApScr_' + b; }       // its own scratch name: a full pass drops every lmScr_ tab when it starts

/** Is today's A+ read due? After the 13:00 full pass of today has been run and finished — or when lmAplusNow asked. */
function lmAplusDue_(st, today, mins) {
  if (st.run || st.ap) return false;
  if (st.apAsk) return true;
  if (st.apDay === today) return false;
  if (mins < LM_APLUS_HOUR * 60) return false;
  if (!(st.slots || {})[today + '|' + LM_APLUS_HOUR]) return false;       // today's 13:00 pass has not been started
  var meta = lmGet_('lmMeta');
  return !!(meta && meta.parts);                                         // nothing to attach A+ to before the first pass
}
function lmAplusPlan_(today) {
  var B = {};
  LM_BRANDS.forEach(function (b) { B[b] = { ph: 'docs', pg: 0, nd: 0, di: 0, calls: 0, t: 0, miss: 0 }; });
  return { day: today, startedAt: lmNow_(), startMs: Date.now(), B: B };
}

/** One tick of the A+ read: every brand as far as the time allows. */
function lmAplusStep_(st, left) {
  var ap = st.ap;
  try {
    for (var k = 0; k < LM_BRANDS.length && left() > 40000; k++) {
      var b = LM_BRANDS[k], x = ap.B[b];
      if (x.ph === 'done' || x.ph === 'gave') continue;
      setBrand_(b);
      if (x.ph === 'docs') lmAplusDocs_(st, b, x, left);
      if (x.ph === 'asins' && left() > 40000) lmAplusAsins_(st, b, x, left);
      if (x.ph === 'write' && left() > 30000) lmAplusWrite_(st, b, x);
      if (x.ph === 'gave') lmAplusGave_(st, b, x);
    }
  } catch (e) {
    var m = String(e.message || e);
    lmErr_(st, 'A+ read: ' + (/429|quota|throttl|too many/i.test(m) ? 'Amazon asked us to slow down — next tick' : m.slice(0, 180)));
    // A read that keeps failing must not hold the light passes back all day: after LM_APLUS_FAILS failed ticks (or
    // LM_APLUS_MAX_MS) today's read is given up — the last good data stays, tomorrow's read tries again.
    ap.fails = (ap.fails || 0) + 1;
  }
  if ((ap.fails || 0) >= LM_APLUS_FAILS || Date.now() - ap.startMs > LM_APLUS_MAX_MS) {
    LM_BRANDS.forEach(function (b) {
      var x = ap.B[b];
      if (x.ph === 'done' || x.ph === 'gave') return;
      x.ph = 'gave'; x.err = (ap.fails || 0) >= LM_APLUS_FAILS ? 'the read failed on ' + ap.fails + ' ticks' : 'not finished after ' + Math.round(LM_APLUS_MAX_MS / 3600000) + ' hours';
      try { setBrand_(b); lmAplusGave_(st, b, x); } catch (e2) { /* lmMeta keeps what it had */ }
    });
  }
  var busy = LM_BRANDS.some(function (b) { return ap.B[b].ph !== 'done' && ap.B[b].ph !== 'gave'; });
  if (busy) return;
  lmNote_(st, 'A+ read ' + LM_BRANDS.map(function (b) {
    var x = ap.B[b];
    return LM_LABEL[b] + (x.ph === 'done' ? ' ' + lmNf_(x.nd) + ' documents, ' + lmNf_(x.na || 0) + ' ASINs, ' + lmNf_(x.calls) + ' calls' : ' NOT read (' + (x.err || 'failed') + ') — last good data kept');
  }).join(' · '));
  st.apDay = ap.day; st.apAsk = false; st.ap = null;
  Logger.log('lmTick: A+ read finished.');
}

/* ----- step 1: every document (searchContentDocuments), page by page ----- */
function lmAplusDocs_(st, b, x, left) {
  var S = x.pg ? lmGet_(lmAplusScr_(b)) : null;
  if (x.pg && (!S || !S.docs)) { x.pg = 0; S = null; lmErr_(st, LM_LABEL[b] + ' A+: the scratch tab is gone — reading the documents again'); }
  S = S || { docs: [], tok: '' };
  var seen = {}, stop = '', pages = 0, done = false;
  S.docs.forEach(function (d) { seen[d.k] = 1; });
  while (left() > 40000) {
    var r = limgSp_('/aplus/2020-11-01/contentDocuments?marketplaceId=' + marketplaceId_() + (S.tok ? '&pageToken=' + encodeURIComponent(S.tok) : ''), 'get');
    x.calls++;
    if (r.code === 429) { stop = 'Amazon asked us to slow down (A+ documents) — next tick'; break; }
    if (r.code >= 300) {
      x.t = (x.t || 0) + 1;
      var why = limgErr_(r, 'A+ documents').error.slice(0, 160);
      if (r.code === 403 || x.t >= LM_APLUS_TRIES) { x.ph = 'gave'; x.err = (r.code === 403 ? 'no access to the A+ Content API (403)' : 'the document list failed ' + LM_APLUS_TRIES + ' times') + ': ' + why; return; }
      stop = why + ' — trying again'; break;
    }
    x.t = 0;
    (r.body.contentMetadataRecords || []).forEach(function (rec) {
      var d = lmAplusMeta_(rec);
      if (d.k && !seen[d.k]) { seen[d.k] = 1; S.docs.push(d); }
    });
    pages++; x.pg++;
    S.tok = r.body.nextPageToken || '';
    if (!S.tok || x.pg >= LM_APLUS_PAGES_MAX) { done = true; break; }
    Utilities.sleep(LM_APLUS_GAP_MS);
  }
  if (stop) lmErr_(st, LM_LABEL[b] + ' A+: ' + stop);
  if (!pages && !done) return;
  try { lmPut_(lmAplusScr_(b), S); }
  catch (we) { x.pg -= pages; lmErr_(st, LM_LABEL[b] + ' A+: could not write the cache sheet — those pages are read again: ' + String(we.message || we).slice(0, 120)); return; }
  x.nd = S.docs.length;
  if (done) { x.ph = 'asins'; x.di = 0; x.t = 0; }
}

/** One document of the search answer, as kept. */
function lmAplusMeta_(rec) {
  var m = (rec && rec.contentMetadata) || {};
  var bd = (m.badgeSet || []).map(function (s) { return String(s).toUpperCase(); });
  return { k: String((rec && rec.contentReferenceKey) || ''), n: lmCut_(m.name, 140), s: String(m.status || '').toUpperCase(), u: String(m.updateTime || ''),
    bd: bd, t: bd.indexOf('PREMIUM') >= 0 ? 'Premium' : bd.indexOf('STANDARD') >= 0 ? 'Basic' : '', rr: lmAplusReasons_(rec) };
}
/** Any rejection reason Amazon sends with a document (a field whose name says reject / reason / violation): the texts, as written.
 *  Amazon's API usually gives only the status; then this is [] and Sellora says where the reason is (A+ Content Manager). */
function lmAplusReasons_(rec) {
  var out = [];
  var take = function (v) {
    if (v == null) return;
    if (typeof v === 'string') { if (v.trim() && out.indexOf(v.trim()) < 0) out.push(lmCut_(v, LM_APLUS_REASON_MAX)); return; }
    if (Array.isArray(v)) { v.forEach(take); return; }
    if (typeof v === 'object') { take(v.message || v.description || v.reason || v.text || v.code || null); }
  };
  [rec || {}, (rec && rec.contentMetadata) || {}].forEach(function (o) {
    Object.keys(o).forEach(function (key) { if (/reject|reason|violation/i.test(key)) take(o[key]); });
  });
  return out.slice(0, 5);
}

/* ----- step 2: the ASINs of each document (listContentDocumentAsinRelations) ----- */
function lmAplusAsins_(st, b, x, left) {
  var S = lmGet_(lmAplusScr_(b));
  if (!S || !S.docs) { x.ph = 'docs'; x.pg = 0; x.nd = 0; x.di = 0; lmErr_(st, LM_LABEL[b] + ' A+: the scratch tab is gone — reading the documents again'); return; }
  var i = x.di, stop = '', touched = 0;
  while (i < S.docs.length && left() > 40000) {
    var d = S.docs[i], asins = [], have = {}, tok = '', pages = 0, bad = null;
    do {
      var r = limgSp_('/aplus/2020-11-01/contentDocuments/' + encodeURIComponent(d.k) + '/asins?marketplaceId=' + marketplaceId_()
        + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), 'get');
      x.calls++;
      if (r.code >= 300) { bad = r; break; }
      (r.body.asinMetadataSet || []).forEach(function (m) { var a = String((m && m.asin) || '').toUpperCase(); if (lmIsAsin_(a) && !have[a]) { have[a] = 1; asins.push(a); } });
      tok = r.body.nextPageToken || '';
      pages++;
      Utilities.sleep(LM_APLUS_GAP_MS);
    } while (tok && pages < LM_APLUS_PAGES_MAX && left() > 20000);
    if (!bad && tok) { stop = 'out of time inside a long ASIN list — that document is read again next tick'; break; }
    if (bad && bad.code === 429) { stop = 'Amazon asked us to slow down (A+ ASIN lists) — next tick'; break; }
    if (bad && bad.code === 404) { d.gone = 1; x.t = 0; i++; touched++; continue; }                 // deleted since the search: it covers nothing
    if (bad) {
      x.t = (x.t || 0) + 1;
      if (x.t < LM_APLUS_TRIES) { stop = 'ASIN list of "' + lmCut_(d.n || d.k, 40) + '": ' + limgErr_(bad, 'A+ ASIN list').error.slice(0, 120) + ' — trying again'; break; }
      d.a = null; d.af = 1; x.miss = (x.miss || 0) + 1; x.t = 0; i++; touched++;
      lmErr_(st, LM_LABEL[b] + ' A+: gave up on the ASIN list of "' + lmCut_(d.n || d.k, 40) + '" — the last good list is kept');
      continue;
    }
    d.a = asins; x.t = 0; i++; touched++;
  }
  if (stop) lmErr_(st, LM_LABEL[b] + ' A+: ' + stop);
  if (touched) {
    try { lmPut_(lmAplusScr_(b), S); }
    catch (we) { lmErr_(st, LM_LABEL[b] + ' A+: could not write the cache sheet — those ASIN lists are read again: ' + String(we.message || we).slice(0, 120)); return; }
    x.di = i;
  }
  if (x.di >= S.docs.length) x.ph = 'write';
}

/* ----- step 3: the tab — this read, and the last good list where one document's could not be read ----- */
function lmAplusWrite_(st, b, x) {
  var S = lmGet_(lmAplusScr_(b));
  if (!S || !S.docs) { x.ph = 'docs'; x.pg = 0; x.nd = 0; x.di = 0; return; }
  var old = lmGet_(lmAplusTab_(b));
  var oldDocs = (old && old.ok && old.docs) || {};
  var docs = {}, byAsin = {}, nAsins = 0, partial = 0, approved = 0, attached = 0;
  S.docs.forEach(function (d) {
    if (d.gone) return;
    var rec = { k: d.k, n: d.n, s: d.s, t: d.t, bd: d.bd, u: d.u, rr: d.rr || [], a: d.a === undefined ? null : d.a };
    if (rec.a === null) {
      var was = oldDocs[d.k];
      if (was && Array.isArray(was.a)) { rec.a = was.a.slice(); rec.as = 1; } else partial++;
    }
    docs[d.k] = rec;
    if (rec.s === 'APPROVED') approved++;
    (rec.a || []).forEach(function (a) { attached++; if (!byAsin[a]) { byAsin[a] = []; nAsins++; } byAsin[a].push(d.k); });
  });
  var nDocs = Object.keys(docs).length;
  // An answer that cannot be right is a failed read, not "no A+": the last good tab stays.
  var bad = '';
  if (!nDocs && Object.keys(oldDocs).length) bad = 'Amazon listed no A+ documents, the last read had ' + Object.keys(oldDocs).length;
  else if (approved && !attached) bad = 'Amazon listed ' + nDocs + ' documents but no ASIN on any of them';
  if (bad) { x.ph = 'gave'; x.err = bad; return; }
  var out = { b: b, v: 1, at: lmNow_(), atMs: Date.now(), ok: true, calls: x.calls, nDocs: nDocs, nAsins: nAsins, partial: partial, docs: docs, asins: byAsin };
  if (JSON.stringify(out).length > LM_PART_MAX) delete out.asins;          // Sellora works the ASIN map out from the documents
  lmPut_(lmAplusTab_(b), out);
  var M = lmGet_('lmMeta') || {};
  M.aplus = M.aplus || {};
  M.aplus[b] = { tab: lmAplusTab_(b), at: out.at, atMs: out.atMs, calls: x.calls, docs: nDocs, asins: nAsins, partial: partial, stale: 0, err: '' };
  lmPut_('lmMeta', M);
  lmDropTab_(lmAplusScr_(b));
  x.na = nAsins; x.ph = 'done';
}

/** The read failed: nothing is wiped. lmMeta says the tab (when there is one) is from an older read, and why. */
function lmAplusGave_(st, b, x) {
  lmErr_(st, LM_LABEL[b] + ' A+ could not be read: ' + (x.err || 'failed') + ' — the last good data is kept');
  try {
    var M = lmGet_('lmMeta') || {};
    M.aplus = M.aplus || {};
    var was = M.aplus[b] || {};
    M.aplus[b] = { tab: was.tab || '', at: was.at || '', atMs: was.atMs || 0, calls: x.calls, docs: was.docs || 0, asins: was.asins || 0, partial: was.partial || 0,
      stale: 1, err: lmCut_(x.err || 'failed', 200), triedAt: lmNow_() };
    lmPut_('lmMeta', M);
  } catch (e) { lmErr_(st, 'could not write lmMeta: ' + String(e.message || e).slice(0, 120)); }
  lmDropTab_(lmAplusScr_(b));
}

/* ----- editor ----- */
/** An A+ read on the next tick (outside the daily one). */
function lmAplusNow() {
  var st = lmState_(); st.apAsk = true; lmSave_(st);
  Logger.log('A+ is read on the next tick that no full pass is using (within 10 minutes). Watch it with lmStatus().');
}
/** One ASIN's A+ documents as the cache holds them. */
function lmAplus(asin) {
  asin = String(asin || '').trim().toUpperCase();
  if (!asin) { Logger.log('Give an ASIN, like lmAplus("B0ABC12345").'); return; }
  var found = false;
  LM_BRANDS.forEach(function (b) {
    var t = lmGet_(lmAplusTab_(b));
    if (!t || !t.docs) return;
    Object.keys(t.docs).forEach(function (k) {
      var d = t.docs[k];
      if (!d.a || d.a.indexOf(asin) < 0) return;
      found = true;
      Logger.log(LM_LABEL[b] + ' · ' + asin + ' · "' + d.n + '" · ' + d.s + ' · ' + (d.t || 'type not given') + ' · updated ' + (d.u || '—') + ' · on ' + d.a.length + ' ASINs · read ' + t.at
        + (d.rr && d.rr.length ? ' · Amazon: ' + d.rr.join(' | ') : ''));
    });
  });
  if (!found) Logger.log(asin + ' is on no A+ document in the cache (or A+ has not been read yet — lmStatus()).');
}
/** lmStatus's A+ lines. */
function lmAplusStatus_(st, meta) {
  Logger.log('— A+ content (read once a day after the ' + LM_APLUS_HOUR + ':00 pass) —');
  if (st.ap) LM_BRANDS.forEach(function (b) { var x = st.ap.B[b]; Logger.log(LM_LABEL[b] + '  reading: step ' + x.ph + ' · documents ' + lmNf_(x.nd) + ' · ASIN lists ' + lmNf_(x.di) + '/' + lmNf_(x.nd) + ' · ' + lmNf_(x.calls) + ' calls so far'); });
  LM_BRANDS.forEach(function (b) {
    var a = ((meta || {}).aplus || {})[b];
    if (!a || !a.at) { Logger.log(LM_LABEL[b] + '  A+ not read yet' + (a && a.err ? ' — last try ' + (a.triedAt || '') + ': ' + a.err : '')); return; }
    Logger.log(LM_LABEL[b] + '  ' + lmNf_(a.docs) + ' documents on ' + lmNf_(a.asins) + ' ASINs · read ' + a.at + ' with ' + lmNf_(a.calls) + ' calls'
      + (a.partial ? ' · ' + a.partial + ' document(s) with no ASIN list (shown as not checked)' : '') + (a.stale ? '  ⚠ KEPT FROM THAT READ — the last try (' + (a.triedAt || '') + ') failed: ' + a.err : ''));
  });
}
/** THE PROOF from the editor: up to 5 ASINs with a live document and 5 with none, per brand, against Amazon's publish records now. */
function lmAplusCheck() {
  LM_BRANDS.forEach(function (b) {
    var t = lmGet_(lmAplusTab_(b)), meta = lmGet_('lmMeta') || {};
    if (!t || !t.docs) { Logger.log(LM_LABEL[b] + ': A+ not read yet.'); return; }
    setBrand_(b);
    var live = {}, any = {};
    Object.keys(t.docs).forEach(function (k) { var d = t.docs[k]; (d.a || []).forEach(function (a) { any[a] = 1; if (d.s === 'APPROVED') live[a] = d.n; }); });
    var none = [];
    (((meta.parts || {}).catalog || {})[b] || []).slice(0, 2).forEach(function (tab) {
      var p = lmGet_(tab);
      Object.keys((p && p.items) || {}).forEach(function (a) { var c = p.items[a]; if (none.length < 5 && !any[a] && (c.pa || []).length && !(c.pa || []).some(function (pa) { return any[pa]; })) none.push(a); });
    });
    var rows = Object.keys(live).slice(0, 5).map(function (a) { return [a, 'Live — "' + live[a] + '"', true]; }).concat(none.map(function (a) { return [a, 'Missing', false]; }));
    Logger.log('━━ ' + LM_LABEL[b] + ' · A+ read ' + t.at + ' ━━');
    rows.forEach(function (row) {
      var r = limgSp_('/aplus/2020-11-01/contentPublishRecords?marketplaceId=' + marketplaceId_() + '&asin=' + row[0], 'get');
      var pub = r.code < 300 ? (r.body.publishRecordList || []).length > 0 : null;
      Logger.log('   ' + row[0] + '  cache: ' + lmPad_(row[1], 46) + ' Amazon: ' + (pub === null ? 'could not be read (' + r.code + ')' : pub ? 'A+ published' : 'no A+ published') + '   '
        + (pub === null ? '—' : pub === row[2] ? 'MATCH' : 'DIFFERENT'));
      Utilities.sleep(LM_APLUS_GAP_MS);
    });
  });
}

/* ----- one document, when a person asks for it in Sellora (?lh=aplusdoc&brand=&doc=<key>[&asins=1]) ----- */
/** getContentDocument: the document's name, status, type and what is in it (each module's type, its texts cut short, its
 *  pictures' ids) — for "Preview A+" and for aplusAccuracyReport. `withAsins`: its attached ASINs too (one more call a page). */
function lmAplusDoc_(key, withAsins) {
  key = String(key || '').trim();
  if (!key) return { ok: false, error: 'no document key' };
  var r = limgSp_('/aplus/2020-11-01/contentDocuments/' + encodeURIComponent(key) + '?marketplaceId=' + marketplaceId_() + '&includedDataSet=CONTENTS,METADATA', 'get');
  if (r.code >= 300) return limgErr_(r, 'A+ document');
  var rec = r.body.contentRecord || {}, d = lmAplusMeta_({ contentReferenceKey: key, contentMetadata: rec.contentMetadata });
  var doc = rec.contentDocument || {};
  var modules = (doc.contentModuleList || []).slice(0, 12).map(function (m) {
    var texts = [], imgs = [];
    var walk = function (v, depth) {
      if (v == null || depth > 8) return;
      if (Array.isArray(v)) { v.forEach(function (y) { walk(y, depth + 1); }); return; }
      if (typeof v !== 'object') return;
      if (typeof v.uploadDestinationId === 'string' && imgs.length < 6) imgs.push({ id: v.uploadDestinationId, alt: lmCut_(v.altText || '', 80) });
      if (typeof v.value === 'string' && v.value.trim() && texts.length < 6) texts.push(lmCut_(v.value, 200));
      Object.keys(v).forEach(function (kk) { if (kk !== 'value' && kk !== 'decoratorSet') walk(v[kk], depth + 1); });
    };
    walk(m, 0);
    return { type: String(m.contentModuleType || ''), texts: texts, imgs: imgs };
  });
  var out = { ok: true, key: key, name: d.n || lmCut_(doc.name, 140), status: d.s, type: d.t, badges: d.bd, updated: d.u, reasons: d.rr.concat(lmAplusReasons_(rec)).slice(0, 5),
    contentType: String(doc.contentType || ''), subType: String(doc.contentSubType || ''), locale: String(doc.locale || ''), modules: modules, readAt: Date.now() };
  if (withAsins) {
    var asins = [], tok = '', pages = 0;
    do {
      var a = limgSp_('/aplus/2020-11-01/contentDocuments/' + encodeURIComponent(key) + '/asins?marketplaceId=' + marketplaceId_() + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), 'get');
      if (a.code >= 300) { out.asinsError = limgErr_(a, 'A+ ASIN list').error.slice(0, 200); asins = null; break; }
      (a.body.asinMetadataSet || []).forEach(function (m) { if (m && m.asin) asins.push(String(m.asin).toUpperCase()); });
      tok = a.body.nextPageToken || '';
      pages++;
    } while (tok && pages < 20);
    out.asins = asins;
  }
  return out;
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
  while (s.length > 8800 && st.notes && st.notes.length) { st.notes.shift(); s = JSON.stringify(st); }
  while (s.length > 8800 && st.run && st.run.notes && st.run.notes.length) { st.run.notes.shift(); s = JSON.stringify(st); }
  PropertiesService.getScriptProperties().setProperty('LM_STATE', s);
}
function lmErr_(st, msg) {
  var line = '[' + lmNow_() + '] ' + String(msg).slice(0, 180);
  st.errors = (st.errors || []).concat([line]).slice(-8);
  if (st.run) st.run.errors = (st.run.errors || []).concat([line]).slice(-8);
}
/** Something worth knowing that is not a fault (a part layout that grew). lmStatus prints it as "note". */
function lmNote_(st, msg) {
  var line = '[' + lmNow_() + '] ' + String(msg).slice(0, 180);
  st.notes = (st.notes || []).concat([line]).slice(-6);
  if (st.run) st.run.notes = (st.run.notes || []).concat([line]).slice(-6);
}
/** Lines older versions filed under errors that are notes. */
function lmIsNote_(line) { return /laid out in \d+ parts/.test(String(line)); }

/** The timer: every LM_TICK_FULL_MIN minutes while a full pass runs, else every LM_TICK_MIN. Apps Script cannot say
 *  how often a trigger runs, so Script Property LM_TIMER_MIN remembers it (none = the 10 minutes lmSetup made). The new
 *  timer is made before the old one goes, so a failure leaves the old one; it is tried again on the next tick. Never
 *  makes a timer when there is none (lmStop). */
function lmTimer_() {
  var st = lmState_(), want = st.run ? LM_TICK_FULL_MIN : LM_TICK_MIN;
  var props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty('LM_TIMER_MIN') || LM_TICK_MIN) === want) return;
  try {
    var old = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'lmTick'; });
    if (!old.length) return;
    ScriptApp.newTrigger('lmTick').timeBased().everyMinutes(want).create();
    old.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    props.setProperty('LM_TIMER_MIN', String(want));
    if (st.timerErr) { delete st.timerErr; lmSave_(st); }
    Logger.log('lmTick: the timer now runs every ' + want + ' minutes.');
  } catch (e) {
    var m = 'could not set the timer to every ' + want + ' minutes: ' + String(e.message || e).slice(0, 120);
    if (st.timerErr !== m) { st.timerErr = m; lmErr_(st, m + ' — the old timer is kept'); lmSave_(st); }
  }
}
function lmHH_(h) { return (h < 10 ? '0' : '') + h; }
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
  var early = function (h) { var m = h * 60 - LM_EARLY_MIN; return lmHH_(Math.floor(m / 60)) + ':' + lmHH_(m % 60); };
  return (full != null ? 'full pass at ' + full + ':00 (its reports asked at ' + early(full) + ') · ' : '') + 'light pass from ' + light;
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
  var ap = 0, apKnown = false;
  LM_BRANDS.forEach(function (b) { var a = (meta.aplus || {})[b]; if (a && a.calls) { ap += a.calls; apKnown = true; } });
  Logger.log('A+ (daily)  ' + (apKnown ? lmNf_(ap) + ' calls in the last read (both brands)' : 'not read yet — about one call per A+ document, once a day'));
}
