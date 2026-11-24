/**
 * ERP NIGHTLY BACKUP (Ravi, 2026-09-26: "Scheduled backup — auto karo").
 *
 * Once a night this copies the whole production database (every pt_* node of the Realtime Database) and the small
 * Firestore collections (access, config, stock, overrides, Shopify notes…) into a Drive folder called "ERP backups",
 * one dated folder per night. Thirty days are kept, plus the first of every month.
 *
 * IN PIECES (2026-10-31). Until 24 Oct the whole database came down as ONE file. On 25 Oct it passed 50 MB, the most
 * Apps Script will download in one request: the answer was cut off, JSON.parse failed, and six nights were lost
 * without anyone hearing. Now every top-level node is fetched and saved on its own, and a node too big for one file is
 * paged by key into parts of at most PART_BYTES. Firestore is saved one collection per file, split the same way.
 * Night folder: "ERP backups/yyyy-MM-dd/" holding rtdb-<node>.json or rtdb-<node>-part001.json…, firestore-<col>….json,
 * and manifest.json written LAST — a night without a manifest did not finish.
 *
 * A SEPARATE SCRIPT ON PURPOSE. The Pricing-API backend serves the live apps; giving it Drive and database scopes
 * would have made every one of its calls wait on a fresh authorisation. This one touches nothing but the two
 * databases (read only) and its own Drive folder.
 *
 * ONE-TIME SETUP: open this script (Ravi's account), run installBackup() once from the editor, and allow it. After
 * that it runs by itself at about 03:15 IST. backupNow() runs it by hand; backupStatus() lists what is there.
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
/* No saved file is larger than this. Apps Script cuts a download at 50 MB and refuses a Drive file over 50 MB. */
var PART_BYTES = 30 * 1024 * 1024;
/* An answer this long may have been cut off at 50 MB; it is fetched again in smaller pages. */
var FETCH_LIMIT = 45 * 1024 * 1024;
/* Entries per page when a node is paged; halved by itself whenever a page is still too big. */
var PAGE_START = 2000;

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
    var root = folder_();
    var day = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    /* A second run on the same day starts the night's folder afresh, so no part of the first run is left mixed in. */
    var old = root.getFoldersByName(day);
    while (old.hasNext()) old.next().setTrashed(true);
    var dir = root.createFolder(day);

    var manifest = { day: day, startedAt: new Date().toISOString(), rtdb: {}, firestore: {}, skipped: [] };
    backupRtdb_(dir, tok, manifest);
    backupFirestore_(dir, tok, manifest);
    manifest.finishedAt = new Date().toISOString();
    manifest.seconds = Math.round((Date.now() - t0) / 1000);
    save_(dir, 'manifest.json', JSON.stringify(manifest, null, 1));

    prune_(root);

    /* The Sheets last: a Sheets failure must not cost tonight's database backup, which is already saved above. */
    var sh = backupSheets_(root, day);
    if (sh.failed.length) mail_('ERP backup: some Sheets were not copied', sh.failed.join('\n'));
    Logger.log('Sheets copied: ' + sh.done.join(', ') + (sh.failed.length ? ' — FAILED: ' + sh.failed.join('; ') : ''));

    var nodes = Object.keys(manifest.rtdb), cols = Object.keys(manifest.firestore);
    var mb = function (o) { return Math.round(Object.keys(o).reduce(function (s, k) { return s + o[k].bytes; }, 0) / 1048576 * 10) / 10; };
    Logger.log('Backed up ' + day + ': RTDB ' + mb(manifest.rtdb) + ' MB, ' + nodes.length + ' nodes ('
      + nodes.map(function (n) { return n + (manifest.rtdb[n].parts > 1 ? ' ×' + manifest.rtdb[n].parts : ''); }).join(', ')
      + '); Firestore ' + mb(manifest.firestore) + ' MB, ' + cols.length + ' collection(s)'
      + (manifest.skipped.length ? ' — skipped ' + manifest.skipped.join(', ') : '') + '. ' + Math.round((Date.now() - t0) / 1000) + ' s.');
  } finally { lock.releaseLock(); }
}

/**
 * GET one path of the Realtime Database. Returns { text, value } — or { tooBig: true } when the answer may have been
 * cut off at Apps Script's 50 MB (long, or not valid JSON), so the caller fetches it again in smaller pages.
 */
function rtdbGet_(path, query, tok) {
  var r = UrlFetchApp.fetch(RTDB + '/' + path + '.json' + (query || ''), {
    headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
  var code = r.getResponseCode();
  if (code === 401 || code === 403) throw new Error('RTDB answered ' + code + ' for /' + path + ': the database refused this script. '
    + 'Open the script as ' + OWNER + ', run backupNow() by hand and press Allow when asked. ' + r.getContentText().slice(0, 200));
  if (code !== 200) throw new Error('RTDB answered ' + code + ' for /' + path + ': ' + r.getContentText().slice(0, 200));
  var text = r.getContentText();
  if (text.length >= FETCH_LIMIT) return { tooBig: true };
  try { return { text: text, value: JSON.parse(text) }; }
  catch (e) { return { tooBig: true }; }
}

/** Every top-level node on its own; a node too big for one file goes down in pages. */
function backupRtdb_(dir, tok, manifest) {
  var top = rtdbGet_('', '?shallow=true', tok);
  if (top.tooBig) throw new Error('Even the list of top-level nodes is too big to read.');
  Object.keys(top.value || {}).sort().forEach(function (node) {
    /* format=export keeps priorities, the shape a restore needs. */
    var res = rtdbGet_(encodeURIComponent(node), '?format=export', tok);
    if (!res.tooBig && res.text.length <= PART_BYTES) {
      save_(dir, 'rtdb-' + node + '.json', res.text);
      manifest.rtdb[node] = { parts: 1, bytes: res.text.length, entries: entries_(res.value) };
    } else {
      manifest.rtdb[node] = rtdbInPages_(dir, node, tok);
    }
  });
}

/**
 * A node too big for one file, page by page in key order. Each page is its own file rtdb-<node>-part001.json…
 * holding { path, data }: `data` is some of the children of `path`. A page too big is asked for again at half the
 * size; when ONE child alone is still too big (pt_audit has such children, 31 Oct 2026) that child is paged the same
 * way one level down, as deep as needed. Priorities are not kept here — the app does not use them.
 */
function rtdbInPages_(dir, node, tok) {
  var st = { node: node, parts: 0, bytes: 0, entries: 0 };
  pageChildren_(dir, node, tok, st);
  return { parts: st.parts, bytes: st.bytes, entries: st.entries };
}

function pageChildren_(dir, path, tok, st) {
  var sh = rtdbGet_(encPath_(path), '?shallow=true', tok);
  if (sh.tooBig) throw new Error(path + ': too many entries even to list.');
  if (!sh.value || typeof sh.value !== 'object') throw new Error(path + ': one single value over ' + Math.round(PART_BYTES / 1048576) + ' MB — it cannot be split.');
  var keys = Object.keys(sh.value).sort(keyOrder_), seen = {}, i = 0, size = PAGE_START;
  var keep = function (data) {
    var ks = Object.keys(data).filter(function (k) { return !seen[k]; });
    ks.forEach(function (k) { seen[k] = true; });
    if (!ks.length) return;
    var page = {};
    ks.forEach(function (k) { page[k] = data[k]; });
    var text = JSON.stringify({ path: path, data: page });
    st.parts++;
    save_(dir, 'rtdb-' + st.node + '-part' + pad_(st.parts) + '.json', text);
    st.bytes += text.length;
    st.entries += ks.length;
  };
  /* One child on its own: saved as a page of one, or paged one level down when even that is too big. */
  var one = function (k) {
    var res = rtdbGet_(encPath_(path + '/' + k), '', tok);
    if (res.tooBig || res.text.length > PART_BYTES) { pageChildren_(dir, path + '/' + k, tok, st); seen[k] = true; return; }
    var d = {};
    if (res.value != null) d[k] = res.value;
    keep(d);
    seen[k] = true;
  };
  while (i < keys.length) {
    var chunk = keys.slice(i, i + size);
    if (chunk.length === 1) { one(chunk[0]); i++; size = PAGE_START; continue; }
    var res = rtdbGet_(encPath_(path), '?orderBy=' + encodeURIComponent('"$key"')
      + '&startAt=' + encodeURIComponent(JSON.stringify(chunk[0]))
      + '&endAt=' + encodeURIComponent(JSON.stringify(chunk[chunk.length - 1])), tok);
    if (res.tooBig || res.text.length > PART_BYTES) { size = Math.max(1, Math.floor(size / 2)); continue; }
    keep(res.value || {});
    i += chunk.length;
    size = Math.min(PAGE_START, size * 2);
  }
  /* Any key a range missed (were our key order ever to differ from Firebase's) is fetched on its own. */
  keys.filter(function (k) { return !seen[k]; }).forEach(one);
}

/** Firebase's $key order: keys that read as 32-bit integers first, by number; then the rest as strings. */
function keyOrder_(a, b) {
  var ia = int32_(a), ib = int32_(b);
  if (ia !== null && ib !== null) return ia - ib;
  if (ia !== null) return -1;
  if (ib !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function int32_(k) {
  if (!/^(0|-?[1-9]\d*)$/.test(k)) return null;
  var n = Number(k);
  return (n >= -2147483648 && n <= 2147483647) ? n : null;
}
function encPath_(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }

/** Firestore, collection by collection, in the API's own document format (restorable through the same API). */
function backupFirestore_(dir, tok, manifest) {
  var opts = { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true };
  var ids = UrlFetchApp.fetch(FS + ':listCollectionIds', Object.assign({ method: 'post', contentType: 'application/json', payload: '{}' }, opts));
  if (ids.getResponseCode() !== 200) throw new Error('Firestore answered ' + ids.getResponseCode() + ': ' + ids.getContentText().slice(0, 200));
  var cols = (JSON.parse(ids.getContentText()).collectionIds || []).sort();
  cols.forEach(function (c) {
    if (SKIP_COLLECTIONS.indexOf(c) >= 0) { manifest.skipped.push(c); return; }
    var docs = [], token = '';
    do {
      var res = UrlFetchApp.fetch(FS + '/' + encodeURIComponent(c) + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), opts);
      if (res.getResponseCode() !== 200) throw new Error('Firestore ' + c + ' answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
      var page = JSON.parse(res.getContentText());
      (page.documents || []).forEach(function (d) { docs.push(JSON.stringify(d)); });
      token = page.nextPageToken || '';
    } while (token);
    manifest.firestore[c] = saveDocs_(dir, c, docs);
  });
}

/** A collection's documents as JSON arrays, firestore-<col>.json, or -part001… when they pass PART_BYTES. */
function saveDocs_(dir, c, docs) {
  var groups = [[]], len = 0, bytes = 0;
  docs.forEach(function (s) {
    if (len && len + s.length > PART_BYTES) { groups.push([]); len = 0; }
    groups[groups.length - 1].push(s);
    len += s.length + 1;
  });
  groups.forEach(function (g, i) {
    var text = '[' + g.join(',') + ']';
    save_(dir, 'firestore-' + c + (groups.length > 1 ? '-part' + pad_(i + 1) : '') + '.json', text);
    bytes += text.length;
  });
  return { parts: groups.length, bytes: bytes, documents: docs.length };
}

function entries_(v) { return (v && typeof v === 'object') ? Object.keys(v).filter(function (k) { return k !== '.priority'; }).length : 1; }
function pad_(n) { return n < 1000 ? ('00' + n).slice(-3) : String(n); }

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
}

/** The night folder of `day`, or null. */
function dayFolder_(day) {
  var it = folder_().getFoldersByName(day);
  return it.hasNext() ? it.next() : null;
}

/** One file per name: a second save under the same name replaces the first. */
function save_(folder, name, text) {
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(name, text, 'application/json');
}

/** Thirty days are kept; the first of each month is kept for good. Covers the night folders and the old single files. */
function prune_(root) {
  var cutoff = Date.now() - KEEP_DAYS * 86400000;
  var old = function (y, m, d) { return d !== '01' && new Date(y + '-' + m + '-' + d + 'T12:00:00').getTime() < cutoff; };
  var dirs = root.getFolders();
  while (dirs.hasNext()) {
    var dir = dirs.next(), n = dir.getName().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (n && old(n[1], n[2], n[3])) dir.setTrashed(true);
  }
  var files = root.getFiles();
  while (files.hasNext()) {
    var f = files.next(), m = f.getName().match(/^(rtdb|firestore)-(\d{4})-(\d{2})-(\d{2})\.json$/);
    if (m && old(m[2], m[3], m[4])) f.setTrashed(true);
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
 * one unless that is asked for by name. testRestore() proves the whole path once and says what it found.
 * They read both shapes: the night folders (from 31 Oct 2026) and the single rtdb-<day>.json files before them. */

/**
 * The saved pieces of top-level `node` on `day`, one at a time, each { path, data, whole }: whole = true means `data`
 * IS the value at `path`; otherwise `data` holds some children of `path`. Reads the oldest shape too.
 */
function eachPart_(day, node, fn) {
  var dir = dayFolder_(day);
  if (!dir) {
    var files = folder_().getFilesByName('rtdb-' + day + '.json');
    if (!files.hasNext()) throw new Error('No database backup for ' + day + '. backupStatus() lists the days there are.');
    fn({ path: node, whole: true, data: JSON.parse(files.next().getBlob().getDataAsString())[node] });
    return;
  }
  if (!dir.getFilesByName('manifest.json').hasNext()) Logger.log('Warning: the backup of ' + day + ' did not finish; using what it saved.');
  var whole = dir.getFilesByName('rtdb-' + node + '.json');
  if (whole.hasNext()) { fn({ path: node, whole: true, data: JSON.parse(whole.next().getBlob().getDataAsString()) }); return; }
  for (var i = 1; ; i++) {
    var p = dir.getFilesByName('rtdb-' + node + '-part' + pad_(i) + '.json');
    if (!p.hasNext()) return;
    fn(JSON.parse(p.next().getBlob().getDataAsString()));
  }
}

function normPath_(p) { return String(p).split('/').filter(String).join('/'); }
function descend_(v, segs) {
  segs.filter(String).forEach(function (k) { v = (v == null || typeof v !== 'object') ? null : v[k]; });
  return v === undefined ? null : v;
}

/**
 * How one saved piece meets the asked-for path R. Calls put(value) when the piece holds R itself or something above
 * it, patch(piecePath, children) when the piece lies inside R.
 */
function pieceAt_(p, R, put, patch) {
  if (p.whole) { var w = descend_(p.data, R.slice(p.path.length + 1).split('/')); if (w != null) put(w); return; }
  if (p.path === R || p.path.indexOf(R + '/') === 0) { patch(p.path, p.data); return; }
  if (R.indexOf(p.path + '/') !== 0) return;
  var rest = R.slice(p.path.length + 1).split('/');
  if (!Object.prototype.hasOwnProperty.call(p.data, rest[0])) return;
  var v = descend_(p.data[rest[0]], rest.slice(1));
  if (v != null) put(v);
}

/** The node at `path` (e.g. "pt_masters" or "pt_orderBook/ob_123") as it was in the backup of `day` (yyyy-MM-dd). */
function backedUpNode_(day, path) {
  var R = normPath_(path), out = null;
  eachPart_(day, R.split('/')[0], function (p) {
    pieceAt_(p, R, function (v) { out = v; }, function (at, kids) {
      if (out == null || typeof out !== 'object') out = {};
      var o = out;
      at.slice(R.length + 1).split('/').filter(String).forEach(function (k) { o = o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}; });
      Object.keys(kids).forEach(function (k) { o[k] = kids[k]; });
    });
  });
  return out;
}

/**
 * Put one node back from a backup. target: the database URL to write into (default RESTORE_TARGET_DB). Writing into
 * the LIVE database needs target === 'LIVE' spelled out, and then only where nothing is stored now — a restore never
 * overwrites what people have saved since. A node saved in parts is written back part by part.
 */
function restoreNode(day, path, target) {
  var live = target === 'LIVE';
  var url = live ? RTDB : (target || PropertiesService.getScriptProperties().getProperty('RESTORE_TARGET_DB') || '');
  if (!url) throw new Error('Set Script Property RESTORE_TARGET_DB to a TEST database URL first, or pass one.');
  if (!live && url.replace(/\/$/, '') === RTDB) throw new Error('That is the live database. Pass "LIVE" on purpose if that is really meant.');
  path = normPath_(path);
  var opts = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  var base = url.replace(/\/$/, '') + '/';
  if (live) {
    var now = UrlFetchApp.fetch(base + encPath_(path) + '.json?shallow=true', opts);
    if (now.getContentText() !== 'null') throw new Error('Something is stored at ' + path + ' now — not restored, nothing overwritten.');
  }
  var write = function (at, method, v) {
    var r = UrlFetchApp.fetch(base + encPath_(at) + '.json', Object.assign({ method: method, contentType: 'application/json', payload: JSON.stringify(v) }, opts));
    if (r.getResponseCode() !== 200) throw new Error('The database answered ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  };
  /* One write per saved piece, so no single request passes 50 MB; a piece only adds children, never replaces a sibling. */
  var n = 0;
  eachPart_(day, path.split('/')[0], function (p) {
    pieceAt_(p, path, function (v) { write(path, 'put', v); n += entries_(v); },
      function (at, kids) { write(at, 'patch', kids); n += Object.keys(kids).length; });
  });
  if (!n) throw new Error(path + ' is empty in the backup of ' + day + '.');
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
  if (!finished_(day)) day = Utilities.formatDate(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
  var want = entries_(backedUpNode_(day, 'pt_masters'));
  var got = restoreNode(day, 'pt_masters');
  var msg = 'Test restore of pt_masters from ' + day + ': ' + got + ' of ' + want + ' lists written to the test database — '
    + (got === want ? 'PASSED.' : 'FAILED.');
  Logger.log(msg);
  PropertiesService.getScriptProperties().setProperty('LAST_TEST_RESTORE', new Date().toISOString() + ' ' + msg);
  return msg;
}

/** True when the backup of `day` finished (its manifest is there). */
function finished_(day) {
  var dir = dayFolder_(day);
  return !!dir && dir.getFilesByName('manifest.json').hasNext();
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

  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var haveDb = finished_(today);
  lines.push('\nLast night\'s database backup: ' + (haveDb ? 'complete' : 'MISSING or did not finish'));
  if (!haveDb) problems.push('no complete database backup last night');
  var lt = PropertiesService.getScriptProperties().getProperty('LAST_TEST_RESTORE');
  lines.push('Last test restore: ' + (lt || 'never — run testRestore() once'));

  mail_((problems.length ? 'ERP health: ' + problems.join(', ') : 'ERP health: all clear') + ' (' + day + ')', lines.join('\n'));
}

/** What is in the folder, newest first. */
function backupStatus() {
  var root = folder_(), list = [];
  var dirs = root.getFolders();
  while (dirs.hasNext()) {
    var d = dirs.next();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.getName())) continue;
    var size = 0, count = 0, files = d.getFiles();
    while (files.hasNext()) { size += files.next().getSize(); count++; }
    list.push(d.getName() + '  ' + (finished_(d.getName()) ? 'complete' : 'DID NOT FINISH') + ', ' + count + ' files, '
      + Math.round(size / 1048576 * 10) / 10 + ' MB');
  }
  var old = root.getFiles();
  while (old.hasNext()) { var f = old.next(); list.push(f.getName() + '  ' + Math.round(f.getSize() / 1048576 * 10) / 10 + ' MB (old single file)'); }
  list.sort().reverse();
  Logger.log(list.length ? list.join('\n') : 'No backups yet — run installBackup() once.');
  var trig = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'backupNightly'; }).length;
  Logger.log(trig ? 'The nightly trigger is installed.' : 'NO nightly trigger — run installBackup().');
}
