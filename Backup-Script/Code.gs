/**
 * ERP NIGHTLY BACKUP (Ravi, 2026-09-26: "Scheduled backup — auto karo").
 *
 * Once a night this copies the whole production database (every pt_* node of the Realtime Database) and the small
 * Firestore collections (access, config, stock, overrides, Shopify notes…) into a Drive folder called "ERP backups",
 * one JSON file each, dated. Thirty days are kept, plus the first of every month.
 *
 * A SEPARATE SCRIPT ON PURPOSE. The Pricing-API backend serves the live apps; giving it Drive and database scopes
 * would have made every one of its calls wait on a fresh authorisation. This one touches nothing but the two
 * databases (read only) and its own Drive folder.
 *
 * ONE-TIME SETUP: open this script (Ravi's account), run installBackup() once from the editor, and allow it. After
 * that it runs by itself at about 03:00 IST. backupNow() runs it by hand; backupStatus() lists what is there.
 *
 * NOT BACKED UP: the Replenishment and Listing Health snapshots (repl*, health*) — 30+ MB a day and rebuilt from
 * Amazon's own reports on demand.
 */
var PROJECT = 'price-research-48ff3';
var RTDB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
var FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
var FOLDER = 'ERP backups';
var SKIP_COLLECTIONS = ['repl', 'replrows', 'replslim', 'replslimrows', 'health', 'healthrows'];
var KEEP_DAYS = 30;
var TZ = 'Asia/Kolkata';

/* THE GOOGLE SHEETS (2026-10-17). The 367,000 order rows and the brands' main workbooks had no backup but Google's
 * own version history, and nothing restorable if a script cleared a tab. Each night a full copy of each goes into
 * "ERP backups/Sheets", kept SHEET_KEEP_DAYS. Same ids as Pricing-API/Code.gs. */
var SHEETS = [
  { id: '1OLIo0mYIgClBuABrfivPoLG-M1xS_rLwkQpFRAF_0kA', name: 'Ridhi Orders Data' },
  { id: '1jjDNWNF327mVQTKfmcadioB5AO5A9BP_9M1CC9t4L2o', name: 'CPC Orders Data' },
  { id: '1QPTz69Q128OWAm2ewe13jkciXOC9CUfkmVEJMA-iKKo', name: 'Ridhi main workbook' },
  { id: '1UHHVMqUu3Q2vfLQRKvbOnesjvjL_YdKg2KCh-G084fg', name: 'CPC main workbook' },
];
var SHEET_KEEP_DAYS = 14;
/* Who is told. Script Property ALERT_TO (comma-separated); else the account this runs as. */
var OWNER = 'ravi@thefabricrush.com';

/** Run once from the editor. Running it again replaces the old triggers. */
function installBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNightly' || t.getHandlerFunction() === 'dailyHealth') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupNightly').timeBased().atHour(3).nearMinute(15).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('dailyHealth').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  Logger.log('backupNightly runs every night around 03:15 and dailyHealth every morning around 08:30 ' + TZ + '. Running the backup once now so you can see it work…');
  backupNightly();
}

function removeBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNightly' || t.getHandlerFunction() === 'dailyHealth') ScriptApp.deleteTrigger(t);
  });
  Logger.log('The nightly backup and the morning health mail are off.');
}

function alertTo_() {
  var p = PropertiesService.getScriptProperties().getProperty('ALERT_TO');
  return (p && p.trim()) || Session.getEffectiveUser().getEmail() || OWNER;
}
/** Mail a person. Never throws: a failed mail must not hide the failure it was about. */
function mail_(subject, body) {
  try { MailApp.sendEmail(alertTo_(), subject, body); } catch (e) { Logger.log('could not mail: ' + (e.message || e)); }
}

/** Run it by hand. */
function backupNow() { backupNightly(); }

function backupNightly() {
  try { backupNightlyLocked_(); }
  catch (e) {
    /* A backup that failed in silence is the same as no backup. Say so the same night. */
    mail_('ERP backup FAILED', 'The nightly backup did not finish: ' + (e && (e.stack || e.message) || e)
      + '\n\nRun backupNow() from the Backup-Script editor once the cause is fixed.');
    throw e;
  }
}

function backupNightlyLocked_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { Logger.log('Another backup is already running — skipped.'); return; }
  try {
    var t0 = Date.now();
    var tok = ScriptApp.getOAuthToken();
    var folder = folder_();
    var day = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

    /* The Realtime Database, whole, as an export (priorities kept — the shape restore needs). */
    var r = UrlFetchApp.fetch(RTDB + '/.json?format=export', {
      headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('RTDB answered ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    var rtdbText = r.getContentText();
    var top = Object.keys(JSON.parse(rtdbText));
    save_(folder, 'rtdb-' + day + '.json', rtdbText);

    /* Firestore, collection by collection, in the API's own document format (restorable through the same API). */
    var fsOut = firestore_(tok);
    save_(folder, 'firestore-' + day + '.json', JSON.stringify(fsOut));

    prune_(folder);

    /* The Sheets last: a Sheets failure must not cost tonight's database backup, which is already saved above. */
    var sh = backupSheets_(folder, day);
    if (sh.failed.length) mail_('ERP backup: some Sheets were not copied', sh.failed.join('\n'));
    Logger.log('Sheets copied: ' + sh.done.join(', ') + (sh.failed.length ? ' — FAILED: ' + sh.failed.join('; ') : ''));

    Logger.log('Backed up ' + day + ': RTDB ' + Math.round(rtdbText.length / 1048576 * 10) / 10 + ' MB, ' + top.length + ' nodes (' + top.join(', ') + '); Firestore '
      + Object.keys(fsOut.collections).length + ' collection(s), ' + fsOut.documents + ' document(s)' + (fsOut.skipped.length ? ' — skipped ' + fsOut.skipped.join(', ') : '')
      + '. ' + Math.round((Date.now() - t0) / 1000) + ' s.');
  } finally { lock.releaseLock(); }
}

/** Every collection except the rebuildable snapshots, page by page. */
function firestore_(tok) {
  var opts = { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true };
  var ids = UrlFetchApp.fetch(FS + ':listCollectionIds', Object.assign({ method: 'post', contentType: 'application/json', payload: '{}' }, opts));
  if (ids.getResponseCode() !== 200) throw new Error('Firestore answered ' + ids.getResponseCode() + ': ' + ids.getContentText().slice(0, 200));
  var cols = (JSON.parse(ids.getContentText()).collectionIds || []).sort();
  var out = { at: new Date().toISOString(), collections: {}, documents: 0, skipped: [] };
  cols.forEach(function (c) {
    if (SKIP_COLLECTIONS.indexOf(c) >= 0) { out.skipped.push(c); return; }
    var docs = [], token = '';
    do {
      var res = UrlFetchApp.fetch(FS + '/' + encodeURIComponent(c) + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), opts);
      if (res.getResponseCode() !== 200) throw new Error('Firestore ' + c + ' answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
      var page = JSON.parse(res.getContentText());
      (page.documents || []).forEach(function (d) { docs.push(d); });
      token = page.nextPageToken || '';
    } while (token);
    out.collections[c] = docs;
    out.documents += docs.length;
  });
  return out;
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
}

/** One file per name: a second run on the same day replaces the morning's copy. */
function save_(folder, name, text) {
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(name, text, 'application/json');
}

/** Thirty days are kept; the first of each month is kept for good. */
function prune_(folder) {
  var cutoff = Date.now() - KEEP_DAYS * 86400000;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var m = f.getName().match(/^(rtdb|firestore)-(\d{4})-(\d{2})-(\d{2})\.json$/);
    if (!m) continue;
    if (m[4] === '01') continue;
    var when = new Date(m[2] + '-' + m[3] + '-' + m[4] + 'T12:00:00').getTime();
    if (when < cutoff) f.setTrashed(true);
  }
}

/** One copy of each Sheet per day into "ERP backups/Sheets"; older than SHEET_KEEP_DAYS are binned. */
function backupSheets_(parent, day) {
  var it = parent.getFoldersByName('Sheets');
  var dir = it.hasNext() ? it.next() : parent.createFolder('Sheets');
  var out = { done: [], failed: [] };
  SHEETS.forEach(function (s) {
    var name = s.name + ' ' + day;
    try {
      var old = dir.getFilesByName(name);
      while (old.hasNext()) old.next().setTrashed(true);
      DriveApp.getFileById(s.id).makeCopy(name, dir);
      out.done.push(s.name);
    } catch (e) { out.failed.push(s.name + ': ' + String(e.message || e).slice(0, 160)); }
  });
  var cutoff = Date.now() - SHEET_KEEP_DAYS * 86400000, files = dir.getFiles();
  while (files.hasNext()) {
    var f = files.next(), m = f.getName().match(/ (\d{4})-(\d{2})-(\d{2})$/);
    if (m && new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T12:00:00').getTime() < cutoff) f.setTrashed(true);
  }
  return out;
}

/* ===================== RESTORE ===================== *
 * A backup nobody has restored from is a hope, not a backup. These put a backed-up node back — by default into
 * a TEST database (Script Property RESTORE_TARGET_DB, e.g. a second Realtime Database instance), never the live
 * one unless that is asked for by name. testRestore() proves the whole path once and says what it found. */

/** The node at `path` (e.g. "pt_masters" or "pt_orderBook/ob_123") as it was in the backup of `day` (yyyy-MM-dd). */
function backedUpNode_(day, path) {
  var files = folder_().getFilesByName('rtdb-' + day + '.json');
  if (!files.hasNext()) throw new Error('No database backup for ' + day + '. backupStatus() lists the days there are.');
  var v = JSON.parse(files.next().getBlob().getDataAsString());
  String(path).split('/').filter(String).forEach(function (k) { v = (v == null) ? null : v[k]; });
  return v;
}

/**
 * Put one node back from a backup. target: the database URL to write into (default RESTORE_TARGET_DB). Writing into
 * the LIVE database needs target === 'LIVE' spelled out, and then only where nothing is stored now — a restore never
 * overwrites what people have saved since.
 */
function restoreNode(day, path, target) {
  var live = target === 'LIVE';
  var url = live ? RTDB : (target || PropertiesService.getScriptProperties().getProperty('RESTORE_TARGET_DB') || '');
  if (!url) throw new Error('Set Script Property RESTORE_TARGET_DB to a TEST database URL first, or pass one.');
  if (!live && url.replace(/\/$/, '') === RTDB) throw new Error('That is the live database. Pass "LIVE" on purpose if that is really meant.');
  var v = backedUpNode_(day, path);
  if (v == null) throw new Error(path + ' is empty in the backup of ' + day + '.');
  var opts = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  var dest = url.replace(/\/$/, '') + '/' + path + '.json';
  if (live) {
    var now = UrlFetchApp.fetch(dest + '?shallow=true', opts);
    if (now.getContentText() !== 'null') throw new Error('Something is stored at ' + path + ' now — not restored, nothing overwritten.');
  }
  var r = UrlFetchApp.fetch(dest, Object.assign({ method: 'put', contentType: 'application/json', payload: JSON.stringify(v) }, opts));
  if (r.getResponseCode() !== 200) throw new Error('The database answered ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var n = (v && typeof v === 'object') ? Object.keys(v).length : 1;
  Logger.log('Restored ' + path + ' from ' + day + ' into ' + (live ? 'the LIVE database' : url) + ': ' + n + ' entries.');
  return n;
}

/** A Sheet as it was on `day`: a fresh copy named "RESTORED …" beside the backups, to compare or to swap in by hand. */
function restoreSheet(day, sheetName) {
  var it = folder_().getFoldersByName('Sheets');
  if (!it.hasNext()) throw new Error('No Sheets backups yet.');
  var f = it.next().getFilesByName(sheetName + ' ' + day);
  if (!f.hasNext()) throw new Error('No copy of "' + sheetName + '" for ' + day + '.');
  var copy = f.next().makeCopy('RESTORED ' + sheetName + ' ' + day);
  Logger.log('Restored copy: ' + copy.getUrl());
  return copy.getUrl();
}

/** Run once by hand: restores last night's masters into the TEST database and checks the count matches. */
function testRestore() {
  var day = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (!folder_().getFilesByName('rtdb-' + day + '.json').hasNext())
    day = Utilities.formatDate(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
  var want = Object.keys(backedUpNode_(day, 'pt_masters') || {}).length;
  var got = restoreNode(day, 'pt_masters');
  var msg = 'Test restore of pt_masters from ' + day + ': ' + got + ' of ' + want + ' lists written to the test database — '
    + (got === want ? 'PASSED.' : 'FAILED.');
  Logger.log(msg);
  PropertiesService.getScriptProperties().setProperty('LAST_TEST_RESTORE', new Date().toISOString() + ' ' + msg);
  return msg;
}

/* ===================== THE MORNING HEALTH MAIL ===================== *
 * Reads yesterday's pt_monitor lines (written by every browser, Replenish-App/src/app/core/monitor.js) and checks
 * last night's backups, then mails one short summary: errors, freezes, slowest screens, refused saves. */
function dailyHealth() {
  var day = Utilities.formatDate(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
  var lines = [], problems = [];
  try {
    var r = UrlFetchApp.fetch(RTDB + '/pt_monitor/' + day + '.json', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    var rows = r.getResponseCode() === 200 ? Object.values(JSON.parse(r.getContentText()) || {}) : [];
    var by = {}; rows.forEach(function (x) { (by[x.kind] = by[x.kind] || []).push(x); });
    var count = function (k) { return (by[k] || []).length; };
    lines.push('Browser log for ' + day + ': ' + rows.length + ' lines — errors ' + count('error') + ', console errors ' + count('console')
      + ', freezes ' + count('freeze') + ', long tasks ' + count('long') + ', refused saves ' + count('save') + ', failed requests ' + count('net') + '.');
    ['save', 'error', 'console', 'net', 'freeze'].forEach(function (k) {
      if (!by[k]) return;
      var top = {};
      by[k].forEach(function (x) { var m = String(x.msg || '').split('\n')[0].slice(0, 140); top[m] = (top[m] || 0) + 1; });
      var list = Object.keys(top).sort(function (a, b) { return top[b] - top[a]; }).slice(0, 5);
      lines.push('\nTop ' + k + ':\n' + list.map(function (m) { return '  ' + top[m] + '×  ' + m; }).join('\n'));
    });
    if (by.screen) {
      var sc = {};
      by.screen.forEach(function (x) { (sc[x.screen] = sc[x.screen] || []).push(Number(x.ms) || 0); });
      var med = function (a) { a.sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; };
      var slow = Object.keys(sc).map(function (s) { return [s, med(sc[s]), sc[s].length]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
      lines.push('\nSlowest screens (median time to settle):\n' + slow.map(function (x) { return '  ' + x[0] + '  ' + (Math.round(x[1] / 100) / 10) + ' s  (' + x[2] + ' opens)'; }).join('\n'));
      if (slow.length && slow[0][1] > 10000) problems.push('a screen takes over 10 s');
    }
    if (count('save')) problems.push(count('save') + ' refused save(s)');
    if (count('freeze') > 20) problems.push(count('freeze') + ' freezes');
  } catch (e) { problems.push('could not read the browser log: ' + (e.message || e)); }

  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), f = folder_();
  var haveDb = f.getFilesByName('rtdb-' + today + '.json').hasNext();
  lines.push('\nLast night\'s database backup: ' + (haveDb ? 'present' : 'MISSING'));
  if (!haveDb) problems.push('no database backup last night');
  var lt = PropertiesService.getScriptProperties().getProperty('LAST_TEST_RESTORE');
  lines.push('Last test restore: ' + (lt || 'never — run testRestore() once'));

  mail_((problems.length ? 'ERP health: ' + problems.join(', ') : 'ERP health: all clear') + ' (' + day + ')', lines.join('\n'));
}

/** What is in the folder, newest first. */
function backupStatus() {
  var files = folder_().getFiles(), list = [];
  while (files.hasNext()) { var f = files.next(); list.push(f.getName() + '  ' + Math.round(f.getSize() / 1048576 * 10) / 10 + ' MB'); }
  list.sort().reverse();
  Logger.log(list.length ? list.join('\n') : 'No backups yet — run installBackup() once.');
  var trig = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'backupNightly'; }).length;
  Logger.log(trig ? 'The nightly trigger is installed.' : 'NO nightly trigger — run installBackup().');
}
