/* Pricing-API / AplusModules.gs — the daily read of every A+ document's MODULES, for Sellora's A+ Content screen (2 Dec 2026).
 *
 * A NEW FILE THAT CHANGES NOTHING ELSE. No line of Code.gs or ListingMatch.gs changes, and no new web-app deployment is needed:
 * Sellora reads what this writes through the ?cache= route that is already live — a tab whose name starts with "lmAplus_" is read
 * from ListingMatch's own spreadsheet (Code.gs: /^lm(Meta$|Listings_|Catalog_|Aplus_)/ → lmCacheRead_).
 *
 * WHAT IT DOES: after ListingMatch's daily A+ read (lmAplus_<brand>: every document, its status and its ASINs), it reads each of those
 * documents once with Amazon's getContentDocument (includedDataSet=CONTENTS) and keeps, per document, only
 *     { n: how many modules, ty: the module types (STANDARD_HEADER_IMAGE_TEXT, STANDARD_COMPARISON_TABLE…), sub: Amazon's content
 *       sub-type (Brand Story shows here), ct: content type (EBC / EMC), at: when it was read }
 * in the tab lmAplus_Mods_<brand> of the same spreadsheet. Sellora counts the modules against the team's standard from it.
 * READ-ONLY: it only READS Amazon (GET). It never changes an A+ document, never submits anything.
 * NEVER INVENTED: a document that cannot be read keeps what the last read had for it; a brand with no A+ read is skipped.
 * WHEN: a time trigger every 15 minutes (apmInstall). A tick does work only from APM_HOUR (14:00, script time zone — after the 13:00
 * A+ read), only when today's A+ read of the brand is there, and only until today's module read is done. A tick works at most
 * APM_BUDGET_MS and goes on where it stopped at the next tick (Script Property APM_STATE).
 * CALLS: one getContentDocument per A+ document per day. A+ Content allows 10 requests a second; APM_GAP_MS is left between calls.
 * BY HAND (Apps Script editor): apmInstall() once — the trigger; apmNow() — read today's modules now; apmStatus() — where it is.
 * Uses ListingMatch.gs (lmGet_, lmPut_, lmNow_, LM_BRANDS), ListingImages.gs (limgSp_), Code.gs (setBrand_), SpApi.gs (marketplaceId_). */
var APM_HOUR = 14;
var APM_GAP_MS = 150;
var APM_BUDGET_MS = 4.5 * 60000;
var APM_TRIES = 3;
var APM_STATE = 'APM_STATE';
function apmTab_(b) { return 'lmAplus_Mods_' + b; }
function apmState_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(APM_STATE) || '{}'); } catch (e) { return {}; } }
function apmSave_(st) { PropertiesService.getScriptProperties().setProperty(APM_STATE, JSON.stringify(st)); }
function apmToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Once: the 15-minute trigger (an old apmTick trigger is replaced). */
function apmInstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'apmTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('apmTick').timeBased().everyMinutes(15).create();
  Logger.log('apmTick runs every 15 minutes; it reads the A+ modules once a day from ' + APM_HOUR + ':00, after the A+ read.');
}
/** Read today's modules again now (whatever the hour). */
function apmNow() {
  var st = apmState_();
  st.ask = true; st.day = ''; st.run = null;
  apmSave_(st);
  apmTick();
  apmStatus();
}
function apmTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try { apmTickLocked_(); } finally { lock.releaseLock(); }
}
function apmTickLocked_() {
  var t0 = Date.now(), left = function () { return APM_BUDGET_MS - (Date.now() - t0); };
  var st = apmState_(), today = apmToday_();
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  if (st.day === today && !st.ask) return;                                  // today's read is done
  if (!st.ask && hour < APM_HOUR) return;                                   // before the A+ read has had its time
  if (!st.run || st.run.day !== today) st.run = { day: today, B: {} };
  var meta = lmGet_('lmMeta') || {};
  var allDone = true;
  LM_BRANDS.forEach(function (b) {
    var x = st.run.B[b] || (st.run.B[b] = { i: 0, calls: 0, fail: 0, t: 0, done: false });
    if (x.done) return;
    var ap = meta.aplus && meta.aplus[b];
    if (!ap || !ap.tab) { x.done = true; x.skip = 'no A+ read for this brand'; return; }
    if (!st.ask && String(ap.at || '').slice(0, 10) !== today) { allDone = false; return; }   // today's A+ read is not there yet
    if (left() < 30000) { allDone = false; return; }
    setBrand_(b);
    var aTab = lmGet_(ap.tab);
    var keys = aTab && aTab.docs ? Object.keys(aTab.docs) : [];
    var old = lmGet_(apmTab_(b)) || {};
    var docs = old.docs || {};                                              // what the last read had: kept where a read fails
    var stop = '';
    while (x.i < keys.length && left() > 20000) {
      var k = keys[x.i];
      var r = limgSp_('/aplus/2020-11-01/contentDocuments/' + encodeURIComponent(k) + '?marketplaceId=' + marketplaceId_() + '&includedDataSet=CONTENTS', 'get');
      x.calls++;
      if (r.code === 429) { stop = 'Amazon asked us to slow down — next tick'; break; }
      if (r.code === 404) { delete docs[k]; x.i++; x.t = 0; continue; }     // deleted since the A+ read
      if (r.code >= 300) {
        x.t++;
        if (x.t < APM_TRIES) { stop = 'document ' + k + ' failed (' + r.code + ') — trying again next tick'; break; }
        x.fail++; x.t = 0; x.i++;                                          // given up for today: the last read's answer stays
        continue;
      }
      x.t = 0;
      var doc = ((r.body || {}).contentRecord || {}).contentDocument || {};
      var list = doc.contentModuleList || [];
      docs[k] = { n: list.length, ty: list.map(function (m) { return String((m && m.contentModuleType) || ''); }), sub: String(doc.contentSubType || ''),
        ct: String(doc.contentType || ''), at: Date.now() };
      x.i++;
      Utilities.sleep(APM_GAP_MS);
    }
    var done = x.i >= keys.length;
    if (done) {                                                              // documents no longer in the A+ read go
      var keep = {};
      keys.forEach(function (k2) { if (docs[k2]) keep[k2] = docs[k2]; });
      docs = keep;
    }
    lmPut_(apmTab_(b), { b: b, v: 1, at: done ? lmNow_() : String(old.at || ''), atMs: done ? Date.now() : Number(old.atMs) || 0, ok: true, partial: !done,
      calls: x.calls, failed: x.fail, nDocs: Object.keys(docs).length, docs: docs });
    if (stop) x.err = stop;
    if (done) x.done = true; else allDone = false;
  });
  if (allDone) { st.day = today; st.ask = false; st.last = st.run; st.run = null; }
  apmSave_(st);
}
/** Where it is: today's read per brand (documents read, calls, failures), and each tab's time and size. */
function apmStatus() {
  var st = apmState_();
  Logger.log('A+ modules: ' + (st.day ? 'last finished day ' + st.day : 'not finished yet') + (st.run ? ' · running: ' + JSON.stringify(st.run.B) : '') + (st.last ? ' · last run: ' + JSON.stringify(st.last.B) : ''));
  LM_BRANDS.forEach(function (b) {
    var t = lmGet_(apmTab_(b));
    Logger.log(b + ': ' + (t ? t.nDocs + ' documents, read ' + (t.at || '(partial)') + ', ' + t.calls + ' calls, ' + (t.failed || 0) + ' failed' : 'no tab yet'));
  });
}
