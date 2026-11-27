/* R-one · DOUBLE WRITE TO ERP DATA (Supabase) — Ravi, 16 Nov 2026: "whatever the Apps Script writes to Firebase, it also
 * writes to Supabase".
 *
 * WHAT: right after Firestore has TAKEN a batch of writes (InvSync's invCommit_, ReplSnap's rsCommit_, ShopifyCache's
 * scCommit_ each call sbMirror_ once their own commit worked), the same documents are sent to ERP data — exactly as the
 * Apps Script reader would send them: its live copy of Firestore (core.fs_docs_put), and for replshop / replshoprows, whose
 * rows the engine builds, the inbox too (core.mirror). So ERP data has them at once — no copier tab, no reader.
 *
 * SAFE BY DESIGN: Firebase is written FIRST and stays the real copy. This never throws, never retries in a loop, and never
 * changes what the job does: if ERP data does not answer, the job carries on as before (the copier / the nightly check
 * bring the documents over later). API keys are never sent (config/*: key / secret / token / password fields are left out).
 *
 * SET UP: Project Settings → Script properties → SUPABASE_SERVICE_KEY = the ERP data secret key (sb_secret_…), typed there
 * by you. Switch off at any time without a deploy: SUPABASE_MIRROR_OFF = 1. Without the key it does nothing.
 *   sbMirrorStatus — the last sends (how many documents, any error)
 */
var SBM = { url: 'https://xkpktnsdmpkwaingvdbd.supabase.co', sendBytes: 3000000, maxDocs: 300 };
var SBM_SECRET = /key|secret|token|pass/i;

/** A Firestore value as plain JSON — the same way the reader and the backup loaders read it. */
function sbmDec_(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(sbmDec_);
  if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(function (k) { o[k] = sbmDec_(f[k]); }); return o; }
  return v;
}

/** After a Firestore commit WORKED: the same documents to ERP data. Never throws. */
function sbMirror_(writes) {
  var P, key, t0 = Date.now(), sent = 0, err = '';
  try {
    P = PropertiesService.getScriptProperties();
    key = P.getProperty('SUPABASE_SERVICE_KEY');
    if (!key || P.getProperty('SUPABASE_MIRROR_OFF') === '1' || !writes || !writes.length) return;
    var byProj = {}, t = new Date().toISOString();
    writes.forEach(function (w) {
      var name = w && (w.update ? w.update.name : w['delete']);
      if (!name) return;
      var proj = String(name).split('/')[1], p = String(name).split('/documents/')[1];
      if (!proj || !p || p.split('/').length !== 2) return;            // only top-level documents (collection/id), as Firestore holds them here
      var doc;
      if (w.update) {
        var o = {}, f = w.update.fields || {};
        Object.keys(f).forEach(function (k) { if (!(p.split('/')[0] === 'config' && SBM_SECRET.test(k))) o[k] = sbmDec_(f[k]); });
        doc = { k: 'put', p: p, v: o, t: t };
      } else doc = { k: 'delete', p: p, v: null, t: t };
      (byProj[proj] = byProj[proj] || []).push(doc);
    });
    Object.keys(byProj).forEach(function (proj) {
      var docs = byProj[proj];
      sent += sbmPost_(key, 'fs_docs_put', function (b) { return { p_project: proj, p_docs: b }; }, docs);
      if (proj === 'price-research-48ff3') {
        var m = docs.filter(function (d) { return /^replshop(rows)?\//.test(d.p); });
        if (m.length) sbmPost_(key, 'mirror', function (b) { return { p_changes: b, p_screen: 'pricing api double write' }; },
          m.map(function (d) { return { k: d.k, p: 'fs/' + d.p, v: d.v, t: d.t }; }));
      }
    });
  } catch (e) { err = String(e && e.message || e).slice(0, 300); }
  try {   // a short record of the last sends (never in the way)
    if (P && key) { var log = []; try { log = JSON.parse(P.getProperty('sbm_log') || '[]'); } catch (x) {}
      log.unshift({ at: new Date().toISOString(), docs: sent, ms: Date.now() - t0, error: err }); P.setProperty('sbm_log', JSON.stringify(log.slice(0, 15)).slice(0, 8000)); }
  } catch (x) { /* nothing */ }
}

/** POST to an ERP data door in pieces; how many it took. Throws only to sbMirror_, which catches it. */
function sbmPost_(key, fn, body, list) {
  var taken = 0, batch = [], size = 0;
  var flush = function () {
    if (!batch.length) return;
    var r = UrlFetchApp.fetch(SBM.url + '/rest/v1/rpc/' + fn, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Profile': 'core', 'Accept-Profile': 'core' },
      payload: JSON.stringify(body(batch)) });
    if (r.getResponseCode() >= 300) throw new Error('ERP data ' + fn + ' ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    taken += Number(r.getContentText()) || 0; batch = []; size = 0;
  };
  list.forEach(function (c) { var s = JSON.stringify(c).length; if (batch.length && (size + s > SBM.sendBytes || batch.length >= SBM.maxDocs)) flush(); batch.push(c); size += s; });
  flush();
  return taken;
}

function sbMirrorStatus() {
  var P = PropertiesService.getScriptProperties();
  Logger.log(P.getProperty('sbm_log') || 'nothing sent yet');
  Logger.log('full copy: ' + (P.getProperty('sbm_all_done') || (P.getProperty('sbm_all_cursor') ? 'still running — ' + P.getProperty('sbm_all_cursor') : 'not run yet')));
}

/* ---------- ONE-TIME FULL COPY (replaces the copier tab) ----------
 * sbMirrorAll — run it ONCE from the editor. It reads EVERY top-level document of both Firestore projects as the script's
 * owner (the same token the jobs write with, so no rights problem) and sends them to ERP data's live copy (fs_docs_put),
 * so ERP data also has what Firestore held before the double write was switched on. It only READS Firebase. API keys are
 * left out (config/*). It works for about 4½ minutes, remembers where it stopped, and starts itself again one minute
 * later until everything is sent; then it removes its own timer. Safe to run again at any time (it just copies again). */
var SBM_ALL = { projects: ['price-research-48ff3', 'fabricrush-inventory'], pageSize: 100, stopMs: 270000 };

function sbMirrorAll() {
  var P = PropertiesService.getScriptProperties(), key = P.getProperty('SUPABASE_SERVICE_KEY'), t0 = Date.now();
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sbMirrorAll') ScriptApp.deleteTrigger(tr); });
  if (!key) { Logger.log('No SUPABASE_SERVICE_KEY in Script properties — nothing done.'); return; }
  var cur = null; try { cur = JSON.parse(P.getProperty('sbm_all_cursor') || 'null'); } catch (x) {}
  if (!cur) { cur = { pi: 0, colls: null, ci: 0, page: '', sent: 0, started: new Date().toISOString() }; P.deleteProperty('sbm_all_done'); }
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  while (cur.pi < SBM_ALL.projects.length) {
    var proj = SBM_ALL.projects[cur.pi], base = 'https://firestore.googleapis.com/v1/projects/' + proj + '/databases/(default)/documents';
    if (!cur.colls) {                                                    // the project's top-level collections
      var ids = [], tok = '';
      do { var r = UrlFetchApp.fetch(base + ':listCollectionIds', { method: 'post', contentType: 'application/json', headers: auth, muteHttpExceptions: true,
             payload: JSON.stringify({ pageSize: 300, pageToken: tok || undefined }) });
           if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' listing ' + proj + ': ' + r.getContentText().slice(0, 200));
           var j = JSON.parse(r.getContentText() || '{}'); ids = ids.concat(j.collectionIds || []); tok = j.nextPageToken || ''; } while (tok);
      cur.colls = ids; cur.ci = 0; cur.page = '';
    }
    while (cur.ci < cur.colls.length) {
      var coll = cur.colls[cur.ci];
      do {
        if (Date.now() - t0 > SBM_ALL.stopMs) {                          // out of time: remember, start again in a minute
          P.setProperty('sbm_all_cursor', JSON.stringify(cur));
          ScriptApp.newTrigger('sbMirrorAll').timeBased().after(60000).create();
          Logger.log('Paused at ' + proj + ' / ' + coll + ' after ' + cur.sent + ' documents — it carries on by itself in 1 minute.');
          return;
        }
        var r2 = UrlFetchApp.fetch(base + '/' + encodeURIComponent(coll) + '?pageSize=' + SBM_ALL.pageSize + (cur.page ? '&pageToken=' + encodeURIComponent(cur.page) : ''),
                                   { headers: auth, muteHttpExceptions: true });
        if (r2.getResponseCode() >= 300) throw new Error('Firestore ' + r2.getResponseCode() + ' reading ' + proj + '/' + coll + ': ' + r2.getContentText().slice(0, 200));
        var j2 = JSON.parse(r2.getContentText() || '{}'), docs = [];
        (j2.documents || []).forEach(function (d) {
          var o = {}, f = d.fields || {};
          Object.keys(f).forEach(function (k) { if (!(coll === 'config' && SBM_SECRET.test(k))) o[k] = sbmDec_(f[k]); });
          docs.push({ k: 'put', p: coll + '/' + String(d.name).split('/').pop(), v: o, t: d.updateTime || new Date().toISOString() });
        });
        if (docs.length) { sbmPost_(key, 'fs_docs_put', function (b) { return { p_project: proj, p_docs: b }; }, docs); cur.sent += docs.length; }
        cur.page = j2.nextPageToken || '';
      } while (cur.page);
      cur.ci++;
    }
    cur.pi++; cur.colls = null; cur.ci = 0;
  }
  P.deleteProperty('sbm_all_cursor');
  var msg = 'done ' + new Date().toISOString() + ' — ' + cur.sent + ' documents from ' + SBM_ALL.projects.join(' + ') + ' (started ' + cur.started + ')';
  P.setProperty('sbm_all_done', msg);
  Logger.log('Full copy ' + msg);
}
