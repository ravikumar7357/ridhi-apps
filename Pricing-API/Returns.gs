/* Pricing-API / Returns.gs — FBA customer returns, nightly, into the cache "returns" (25 Nov 2026). NOT DEPLOYED YET.
 * Sellora's Sales Alerts → "↩ Return spikes" (Pricing-App/src/app/sales/returns.js) reads the cache "returns" through the ?cache=
 * route Code.gs already has (cacheRead_ — no Code.gs change). Until this runs, Sellora uses the reports people upload there.
 *
 * What it does, once a day after RETURNS_START_HOUR (script time), on its own time trigger (returnsInstall):
 *   for each brand (Ridhi = SP, CPC): ask Amazon for GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA over the last RETURNS_DAYS days,
 *   poll it on the next ticks, download it, and when both brands are in write ONE cache:
 *     returns = { at, from, to, d: { SP: [[date, sku, asin, qty, reason, comment, disposition, orderId, lpn], …], CPC: [...] } }
 *   date = the return date on the US Pacific day (the report's timestamp turned into PT). Comments cut to 300 characters.
 * State in Script Properties (RETURNS_STATE). Read-only on Amazon (one report request per brand per day). No other sheet is touched.
 * Functions: returnsTick (the trigger), returnsInstall / returnsRemove, returnsTest (one run by hand, logs what it would write). */

var RETURNS_DAYS = 90;
var RETURNS_START_HOUR = 6;
var RETURNS_TYPE = 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA';

function returnsState_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('RETURNS_STATE') || '{}'); } catch (e) { return {}; } }
function returnsSave_(st) { PropertiesService.getScriptProperties().setProperty('RETURNS_STATE', JSON.stringify(st)); }

/** Ask Amazon for one brand's returns report (the brand set with setBrand_). */
function returnsCreate_() {
  var to = new Date(), from = new Date(Date.now() - RETURNS_DAYS * 86400000);
  var r = sp_('/reports/2021-06-30/reports', 'post', { reportType: RETURNS_TYPE, marketplaceIds: [marketplaceId_()], dataStartTime: from.toISOString(), dataEndTime: to.toISOString() });
  return r.reportId;
}
/** Poll one report: null while Amazon builds it; [] or the rows when done. Throws when Amazon ended it as FATAL / CANCELLED. */
function returnsPoll_(id) {
  var r = sp_('/reports/2021-06-30/reports/' + id, 'get');
  var st = r.processingStatus;
  if (st === 'CANCELLED') return [];                                       // Amazon cancels a report with no rows in it
  if (st === 'FATAL') throw new Error('Returns report ' + id + ' ended as FATAL');
  if (st !== 'DONE') return null;
  var d = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get');
  var blob = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true }).getBlob();
  if (d.compressionAlgorithm === 'GZIP') { try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) { /* plain already */ } }
  return returnsRows_(parseTsv_(blob.getDataAsString('UTF-8')));
}
/** The report's rows → the cache's compact rows. */
function returnsRows_(rows) {
  var out = [];
  (rows || []).forEach(function (x) {
    var raw = String(x['return-date'] || '').trim(), t = Date.parse(raw);
    var day = isFinite(t) ? Utilities.formatDate(new Date(t), 'America/Los_Angeles', 'yyyy-MM-dd') : raw.slice(0, 10);
    var sku = String(x['sku'] || '').trim(), q = Math.round(Number(x['quantity']) || 0);
    if (!day || !sku || q <= 0) return;
    out.push([day, sku, String(x['asin'] || '').trim().toUpperCase(), q, String(x['reason'] || '').trim(), String(x['customer-comments'] || '').trim().slice(0, 300),
      String(x['detailed-disposition'] || '').trim(), String(x['order-id'] || '').trim(), String(x['license-plate-number'] || '').trim()]);
  });
  return out;
}
/** The trigger: start the day's reports, poll them, write the cache when both brands are in. */
function returnsTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
    var st = returnsState_();
    if (st.day !== today) {
      if (hour < RETURNS_START_HOUR) return;
      st = { day: today, b: {} };
      ['SP', 'CPC'].forEach(function (b) { setBrand_(b); try { st.b[b] = { id: returnsCreate_() }; } catch (e) { st.b[b] = { err: String(e.message || e).slice(0, 200) }; } });
      setBrand_('SP');
      returnsSave_(st);
      return;
    }
    if (st.written) return;
    var rows = {}, waiting = false;
    ['SP', 'CPC'].forEach(function (b) {
      var s = st.b[b] || {};
      if (!s.id) return;
      setBrand_(b);
      try { var r = returnsPoll_(s.id); if (r === null) waiting = true; else rows[b] = r; }
      catch (e) { s.err = String(e.message || e).slice(0, 200); }
    });
    setBrand_('SP');
    if (waiting) { returnsSave_(st); return; }
    var all = [].concat(rows.SP || [], rows.CPC || []).map(function (r) { return r[0]; }).sort();
    cacheWrite_('returns', { at: nowStamp_(), from: Utilities.formatDate(new Date(Date.now() - RETURNS_DAYS * 86400000), 'America/Los_Angeles', 'yyyy-MM-dd'),
      to: all.length ? all[all.length - 1] : '', d: { SP: rows.SP || [], CPC: rows.CPC || [] } });
    st.written = nowStamp_();
    returnsSave_(st);
  } finally { lock.releaseLock(); }
}
function returnsInstall() {
  returnsRemove();
  ScriptApp.newTrigger('returnsTick').timeBased().everyMinutes(15).create();
  Logger.log('returnsTick: every 15 minutes; the reports are asked once a day after ' + RETURNS_START_HOUR + ':00 (script time).');
}
function returnsRemove() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'returnsTick') ScriptApp.deleteTrigger(t); });
}
/** By hand: ask, wait, and log what the cache would hold (writes nothing). */
function returnsTest() {
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    var id = returnsCreate_(), r = null;
    for (var i = 0; i < 20 && r === null; i++) { Utilities.sleep(15000); r = returnsPoll_(id); }
    Logger.log(b + ': ' + (r === null ? 'still building after 5 minutes' : r.length + ' returns' + (r.length ? ', first ' + JSON.stringify(r[0]) : '')));
  });
  setBrand_('SP');
}
