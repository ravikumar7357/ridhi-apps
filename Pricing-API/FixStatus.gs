/* Pricing-API / FixStatus.gs — the OPTIONAL daily "Still not fixed on Amazon" email (24 Nov 2026, MD task #4). NOT DEPLOYED.
 *
 * Sellora works out the fix status itself (src/app/listing/fix-status.js): every fix sent from Sellora is compared with Amazon's newest
 * read of that listing, and the ⚠️ "Still on Amazon" (24 h after the fix) and ❌ "New error after fix" items are kept in ONE Firestore
 * document of the Sellora project, history/fixstatus = { at (ms), items: [{ brand, sku, state, issue, at, who, hint, err }], fixedToday }.
 * This file only READS that document once a day and mails the list to the listing team. It never calls Amazon and never writes.
 * The bell in Sellora works without it.
 *
 * Setup (once): Script Property FIX_EMAIL_TO = the listing team's addresses, comma-separated; then run fixStatusInstall() from the editor.
 * Try it first: fixStatusTest() mails the current list to you only. Stop it: fixStatusRemove().
 * Reads Firestore with the script's own token (the datastore scope is already in appsscript.json, as InvSync / ShopifyCache use). */

var FIX_STATUS = {
  proj: 'price-research-48ff3',          // the Sellora Firebase project
  doc: 'history/fixstatus',
  hour: 9,                               // the mail goes out around 09:00 (the script's time zone, Asia/Kolkata)
  oldH: 30,                              // a list older than this is still mailed, but says Sellora has not been opened since
  max: 60,                               // items in one mail (the rest: "and N more — see Fix status in Sellora")
};

/** The document as a plain object (Firestore's typed values unpacked), or null when it does not exist yet. */
function fixStatusRead_() {
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIX_STATUS.proj + '/databases/(default)/documents/' + FIX_STATUS.doc;
  var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Firestore ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  var f = JSON.parse(r.getContentText() || '{}').fields || {};
  var out = {};
  Object.keys(f).forEach(function (k) { out[k] = fixStatusVal_(f[k]); });
  return out;
}
function fixStatusVal_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fixStatusVal_);
  if ('mapValue' in v) { var o = {}; var mf = v.mapValue.fields || {}; Object.keys(mf).forEach(function (k) { o[k] = fixStatusVal_(mf[k]); }); return o; }
  return null;
}

/** The mail's text: ⚠️ first, then ❌, newest fix first; the time the list was worked out; the way to the full list. */
function fixStatusText_(st, now) {
  var items = (st && st.items) || [];
  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  var when = function (ms) { return ms ? Utilities.formatDate(new Date(ms), tz, 'd MMM HH:mm') : '—'; };
  var hours = function (ms) { var h = Math.round((now - ms) / 3600000); return h < 48 ? h + ' h' : Math.round(h / 24) + ' days'; };
  var brand = function (b) { return b === 'SP' ? 'Ridhi' : b; };
  var still = items.filter(function (i) { return i.state === 'still'; });
  var news = items.filter(function (i) { return i.state === 'newerr'; });
  var line = function (i) {
    return '• ' + i.sku + ' (' + brand(i.brand) + ') — ' + (i.issue || '') + '\n    fixed in Sellora ' + when(i.at) + ' by ' + (i.who || '?') + ', ' + hours(i.at) + ' ago'
      + (i.state === 'newerr' ? ' — a NEW error appeared: ' + (i.err || '') : ' — Amazon still shows it') + (i.hint ? '\n    → ' + i.hint : '');
  };
  var parts = [];
  parts.push('Sellora fix status — ' + Utilities.formatDate(new Date(now), tz, 'd MMM yyyy'));
  parts.push('As of ' + when(st.at) + (now - st.at > FIX_STATUS.oldH * 3600000 ? ' (Sellora has not been opened since — this list may be old)' : '') + '. Amazon was only read, nothing was sent.');
  if (still.length) parts.push('\n⚠️ Still on Amazon 24 h after the fix (' + still.length + ')\n' + still.slice(0, FIX_STATUS.max).map(line).join('\n'));
  if (news.length) parts.push('\n❌ New error after the fix (' + news.length + ')\n' + news.slice(0, FIX_STATUS.max).map(line).join('\n'));
  var more = Math.max(0, still.length - FIX_STATUS.max) + Math.max(0, news.length - FIX_STATUS.max);
  if (more) parts.push('\n…and ' + more + ' more.');
  parts.push('\n✅ ' + (st.fixedToday || 0) + ' fixes confirmed by Amazon today.');
  parts.push('Full list: Sellora → Listing → Listing History → Fix status.');
  return { subject: 'Sellora: ' + still.length + ' still on Amazon, ' + news.length + ' new error' + (news.length === 1 ? '' : 's') + ' after a fix', body: parts.join('\n'), n: still.length + news.length };
}

/** THE DAILY JOB (the trigger runs it): mails the list to FIX_EMAIL_TO — nothing when there is nothing to fix. Never throws. */
function fixStatusDaily() {
  try {
    var to = prop_('FIX_EMAIL_TO');
    if (!to) { Logger.log('FIX_EMAIL_TO is not set — no mail.'); return; }
    var st = fixStatusRead_();
    if (!st || !(st.items || []).length) { Logger.log('Nothing still on Amazon — no mail.'); return; }
    var m = fixStatusText_(st, Date.now());
    var res = notifyApproval_(to, m.subject, m.body);          // Notifications.gs: up to 20 valid addresses, best effort
    Logger.log('fix status mail: ' + JSON.stringify(res));
  } catch (e) {
    jobAlert_('fixStatusDaily', String(e && e.message || e));   // Notifications.gs: tells ALERT_TO, at most once every 6 hours
  }
}
/** RUN FROM THE EDITOR to try it: the current list, mailed to you only. */
function fixStatusTest() {
  var me = Session.getEffectiveUser().getEmail();
  var st = fixStatusRead_();
  if (!st) { Logger.log('history/fixstatus does not exist yet — open Sellora (live) as a Listing user once, it is written within 10 minutes.'); return; }
  var m = fixStatusText_(st, Date.now());
  MailApp.sendEmail(me, '[test] ' + m.subject, m.body);
  Logger.log('SENT to ' + me + ' — ' + m.n + ' item(s).\n\n' + m.body);
}
/** RUN ONCE FROM THE EDITOR: the daily trigger at FIX_STATUS.hour (any old one of this job is replaced). */
function fixStatusInstall() {
  fixStatusRemove();
  ScriptApp.newTrigger('fixStatusDaily').timeBased().everyDays(1).atHour(FIX_STATUS.hour).create();
  Logger.log('Daily fix status mail set for about ' + FIX_STATUS.hour + ':00 (' + Session.getScriptTimeZone() + ') to: ' + (prop_('FIX_EMAIL_TO') || '(FIX_EMAIL_TO not set yet!)'));
}
/** Stop the daily mail. */
function fixStatusRemove() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'fixStatusDaily') { ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('removed ' + n + ' fix status trigger(s)');
}
