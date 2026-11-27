/* Pricing-API / SupaJob.gs — WRITE TO ERP DATA (SUPABASE) FIRST (23 Nov 2026).
 *
 * Ravi, 23 Nov: "pricing api to supabase and then it copy to firebase". ReplSnap, ShopifyCache and CreatorOrders now read
 * and write ERP data through its job door (migration/sql/job_door_pricing_api.sql). The way back (pushBack, every minute)
 * copies every write on to Firebase, so Firebase stays a full backup.
 *
 * SAFE BY DESIGN
 *   * OFF until Script Property SB_JOB_ON = yes. Delete that property and everything is exactly as before (Firestore).
 *   * If ERP data does not answer, THAT RUN goes back to Firestore for the rest of the run (as before), and the capture
 *     brings those writes into ERP data within seconds. The job never stops because of ERP data.
 *   * Its own key (SB_JOB_KEY), made here by sbjMakeKey and never shown. ERP data keeps only its hash, and the key may
 *     write only Pricing-API's own lists. It is NOT the server key.
 *   * InvSync (fabricrush-inventory) is NOT moved: the way back copies only price-research-48ff3.
 */

var SBJ = {
  url: 'https://xkpktnsdmpkwaingvdbd.supabase.co/rest/v1/rpc/',
  pub: 'sb_publishable_niq2DDjeCaqJl3_ccv0vtQ_BS8bqQ2Q',   // the public (publishable) key — the same one the ERP page carries
  job: 'pricing-api',
  proj: 'price-research-48ff3',
  maxChanges: 400,
  maxBytes: 3500000,
};
var SBJ_DOWN = false;                                       // set for the rest of this run when ERP data did not answer

function sbjProp_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function sbjOn_() { return !SBJ_DOWN && sbjProp_('SB_JOB_ON') === 'yes' && sbjProp_('SB_JOB_KEY').length >= 32; }

function sbjCall_(fn, body) {
  body.p_job = SBJ.job; body.p_key = sbjProp_('SB_JOB_KEY');
  var r = UrlFetchApp.fetch(SBJ.url + fn, { method: 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { apikey: SBJ.pub, 'Content-Profile': 'core', 'Accept-Profile': 'core' }, payload: JSON.stringify(body) });
  var code = r.getResponseCode(), t = r.getContentText();
  if (code >= 300) throw new Error('ERP data ' + fn + ' ' + code + ': ' + String(t).slice(0, 300));
  return t ? JSON.parse(t) : null;
}
function sbjDown_(where, e) {
  SBJ_DOWN = true;
  var msg = new Date().toISOString() + ' ' + where + ': ' + String(e && e.message || e).slice(0, 300);
  console.warn('ERP data did not answer — this run uses Firestore. ' + msg);
  try { PropertiesService.getScriptProperties().setProperty('SB_JOB_LAST_ERROR', msg); } catch (x) {}
}
/** 'coll/doc' with the URL escapes of the Firestore address taken out (perms/<email> …). */
function sbjPath_(p) { return String(p).replace(/^\/+|\/+$/g, '').split('/').map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } }).join('/'); }

/* Firestore REST typed values → plain JSON, the way the capture stores them (timestamps as ISO text) */
function sbjPlain_(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).toISOString();
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(sbjPlain_);
  if ('mapValue' in v) { var o = {}, f = (v.mapValue && v.mapValue.fields) || {}; Object.keys(f).forEach(function (k) { o[k] = sbjPlain_(f[k]); }); return o; }
  return null;
}

/** ONE DOCUMENT from ERP data: the plain document, null when it is not there, or undefined = "ask Firestore" (off / down). */
function sbjTryGet_(path) {
  if (!sbjOn_()) return undefined;
  var p = sbjPath_(path);
  try { var got = sbjCall_('job_get', { p_paths: [p] }) || {}; return got[p] == null ? null : got[p]; }
  catch (e) { sbjDown_('read ' + p, e); return undefined; }
}

/** FIRESTORE :commit WRITES ({update:{name,fields}} | {delete:name}) sent to ERP data instead. true = done there;
 *  false = off or down → the caller writes Firestore as before. */
function sbjCommitFs_(writes) {
  if (!sbjOn_() || !writes || !writes.length) return false;
  var mine = 'projects/' + SBJ.proj + '/databases/(default)/documents/', other = false;
  var changes = writes.map(function (w) {
    var name = String(w['delete'] || (w.update && w.update.name) || '');
    if (name.indexOf(mine) !== 0 || w.transform || w.updateTransforms) { other = true; return null; }
    if (w['delete']) return { k: 'delete', p: name.slice(mine.length) };
    return { k: w.updateMask ? 'patch' : 'put', p: name.slice(mine.length), v: sbjPlain_({ mapValue: { fields: w.update.fields || {} } }) };
  });
  if (other) return false;                                  // not a plain write to this project: leave it to Firestore
  try {
    var batch = [], bytes = 0;
    var flush = function () { if (batch.length) sbjCall_('job_save', { p_changes: batch }); batch = []; bytes = 0; };
    changes.forEach(function (c) {
      c.p = sbjPath_(c.p);
      var n = JSON.stringify(c).length;
      if (batch.length && (batch.length >= SBJ.maxChanges || bytes + n > SBJ.maxBytes)) flush();
      batch.push(c); bytes += n;
    });
    flush();
    return true;
  } catch (e) { sbjDown_('write ' + changes.length + ' docs', e); return false; }   // the same writes then go to Firestore
}

/** Create only if not there: 'created' | 'exists', or undefined = "use Firestore". */
function sbjTryCreate_(path, data) {
  if (!sbjOn_()) return undefined;
  var p = sbjPath_(path);
  try {
    var r = sbjCall_('job_save', { p_changes: [{ k: 'create', p: p, v: data }] }) || {};
    return (r.exists || []).length ? 'exists' : 'created';
  } catch (e) { sbjDown_('create ' + p, e); return undefined; }
}

/** Fields merged into a document that must exist. true = done; false = "use Firestore". Throws like Firestore's 404. */
function sbjTryPatch_(path, fields) {
  if (!sbjOn_()) return false;
  var p = sbjPath_(path), r;
  try { r = sbjCall_('job_save', { p_changes: [{ k: 'patch', p: p, v: fields, x: true }] }) || {}; }
  catch (e) { sbjDown_('patch ' + p, e); return false; }
  if ((r.missing || []).length) throw new Error('Firestore 404 writing');
  return true;
}

/* ---------------- run by hand, from the editor ---------------- */

/** STEP 1 (once). Makes this script's own key, keeps it in Script Properties, and prints ONLY its hash. */
function sbjMakeKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SB_JOB_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SB_JOB_KEY', key);
  }
  var hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  Logger.log('Paste this into ERP data → SQL editor and Run:\n\nselect core.job_key_register(\'pricing-api\', \'' + hex + '\');\n\n'
    + '(This is only the hash — the key itself stays in this script.)');
}

/** STEP 2. Reads three documents from ERP data and from Firestore and says whether they match. Writes nothing. */
function sbjSelfTest() {
  if (sbjProp_('SB_JOB_KEY').length < 32) { Logger.log('Run sbjMakeKey first.'); return; }
  ['repl/SP', 'replshop/SP', 'shopify_cache/meta'].forEach(function (p) {
      var s;
      try { s = (sbjCall_('job_get', { p_paths: [p] }) || {})[p]; }
      catch (e) { Logger.log('FAIL ' + p + ' — ' + String(e.message || e).slice(0, 300)); return; }
      var r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + SBJ.proj + '/databases/(default)/documents/' + p,
        { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
      var f = r.getResponseCode() === 200 ? sbjPlain_({ mapValue: { fields: JSON.parse(r.getContentText()).fields || {} } }) : null;
      var a = s && (s.at || s.n), b = f && (f.at || f.n);
      Logger.log((String(a) === String(b) ? 'PASS ' : 'DIFFERENT ') + p + ' · ERP data: ' + a + ' · Firestore: ' + b);
  });
  Logger.log('SB_JOB_ON is ' + (sbjProp_('SB_JOB_ON') === 'yes' ? 'ON — the jobs use ERP data' : 'off — the jobs still use Firestore'));
}

/** Switch ERP data first ON (run by hand). */
function sbjSwitchOn() {
  PropertiesService.getScriptProperties().setProperty('SB_JOB_ON', 'yes');
  Logger.log('SB_JOB_ON = ' + PropertiesService.getScriptProperties().getProperty('SB_JOB_ON') + ' — the jobs now use ERP data first');
}
/** Switch it OFF again (run by hand) — everything goes back to Firestore. */
function sbjSwitchOff() {
  PropertiesService.getScriptProperties().deleteProperty('SB_JOB_ON');
  Logger.log('SB_JOB_ON removed — the jobs use Firestore again');
}