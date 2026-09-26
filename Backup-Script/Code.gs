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

/** Run once from the editor. Running it again replaces the old trigger. */
function installBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupNightly').timeBased().atHour(3).nearMinute(15).everyDays(1).inTimezone(TZ).create();
  Logger.log('backupNightly now runs every night around 03:15 ' + TZ + '. Running it once now so you can see it work…');
  backupNightly();
}

function removeBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNightly') ScriptApp.deleteTrigger(t);
  });
  Logger.log('The nightly backup is off.');
}

/** Run it by hand. */
function backupNow() { backupNightly(); }

function backupNightly() {
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

/** What is in the folder, newest first. */
function backupStatus() {
  var files = folder_().getFiles(), list = [];
  while (files.hasNext()) { var f = files.next(); list.push(f.getName() + '  ' + Math.round(f.getSize() / 1048576 * 10) / 10 + ' MB'); }
  list.sort().reverse();
  Logger.log(list.length ? list.join('\n') : 'No backups yet — run installBackup() once.');
  var trig = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'backupNightly'; }).length;
  Logger.log(trig ? 'The nightly trigger is installed.' : 'NO nightly trigger — run installBackup().');
}
