/* Report-Mail / SupaJob.gs — READ AND WRITE ERP DATA (SUPABASE) FIRST (23 Nov 2026).
 *
 * The three mails read the ERP lists from ERP data, and the reject stamp (mailedAt) is written to ERP data. The way back
 * (pushBack, every minute) copies the stamp on to Firebase. Door: migration/sql/job_door_report_mail.sql.
 *
 * SAFE BY DESIGN — same rules as Pricing-API's SupaJob.gs:
 *   * OFF until Script Property SB_JOB_ON = yes. Delete it and everything is exactly as before (Firebase).
 *   * ERP data does not answer → that run uses Firebase, as before.
 *   * Its own key (SB_JOB_KEY, made by sbjMakeKey, never shown). It may write ONLY pt_recvRejects.
 *   * Still read from Firestore, unchanged: config/api (the Pricing script's key never goes to ERP data) and audit/shoporders.
 */

const SBJ = {
  url: 'https://xkpktnsdmpkwaingvdbd.supabase.co/rest/v1/rpc/',
  pub: 'sb_publishable_niq2DDjeCaqJl3_ccv0vtQ_BS8bqQ2Q',   // the public (publishable) key — the same one the ERP page carries
  job: 'report-mail',
};
let SBJ_DOWN = false;

const sbjProp_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const sbjOn_ = () => !SBJ_DOWN && sbjProp_('SB_JOB_ON') === 'yes' && sbjProp_('SB_JOB_KEY').length >= 32;

function sbjCall_(fn, body) {
  body.p_job = SBJ.job; body.p_key = sbjProp_('SB_JOB_KEY');
  const r = UrlFetchApp.fetch(SBJ.url + fn, { method: 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { apikey: SBJ.pub, 'Content-Profile': 'core', 'Accept-Profile': 'core' }, payload: JSON.stringify(body) });
  const code = r.getResponseCode(), t = r.getContentText();
  if (code >= 300) throw new Error('ERP data ' + fn + ' ' + code + ': ' + String(t).slice(0, 300));
  return t ? JSON.parse(t) : null;
}
function sbjDown_(where, e) {
  SBJ_DOWN = true;
  const msg = new Date().toISOString() + ' ' + where + ': ' + String((e && e.message) || e).slice(0, 300);
  console.warn('ERP data did not answer — this run uses Firebase. ' + msg);
  try { PropertiesService.getScriptProperties().setProperty('SB_JOB_LAST_ERROR', msg); } catch (x) {}
}

/** The lists from ERP data, in the order asked ({} for an empty one) — or undefined = "read Firebase". At most 20 a call. */
function sbjReadLists_(paths) {
  if (!sbjOn_()) return undefined;
  try {
    const out = [];
    for (let i = 0; i < paths.length; i += 20) {
      const part = paths.slice(i, i + 20), got = sbjCall_('job_rt_get', { p_paths: part }) || {};
      part.forEach(p => out.push(got[p.replace(/^\/+|\/+$/g, '')] || {}));
    }
    return out;
  } catch (e) { sbjDown_('read ' + paths.join(','), e); return undefined; }
}

/** A Firebase-style multi-path update ({ '<id>/mailedAt': when }) on one list, into ERP data. true = done; false = "use Firebase". */
function sbjPatchList_(list, updates) {
  if (!sbjOn_()) return false;
  const changes = Object.keys(updates).map(k => ({ k: updates[k] == null ? 'delete' : 'put', p: list + '/' + k.replace(/^\/+/, ''), v: updates[k], db: 'rt' }));
  try { sbjCall_('job_save', { p_changes: changes }); return true; }
  catch (e) { sbjDown_('write ' + list, e); return false; }
}

/* ---------------- run by hand, from the editor ---------------- */

/** STEP 1 (once). Makes this script's own key, keeps it in Script Properties, prints ONLY its hash. */
function sbjMakeKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SB_JOB_KEY');
  if (!key) { key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); props.setProperty('SB_JOB_KEY', key); }
  const hex = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
  Logger.log("Paste this into ERP data → SQL editor and Run:\n\nselect core.job_key_register('report-mail', '" + hex + "');\n\n"
    + '(This is only the hash — the key itself stays in this script.)');
}

/** STEP 2. Reads three lists from ERP data and from Firebase and compares the record counts. Writes nothing. */
function sbjSelfTest() {
  if (sbjProp_('SB_JOB_KEY').length < 32) { Logger.log('Run sbjMakeKey first.'); return; }
  const lists = ['pt_orderBook', 'pt_vendorOrders', 'pt_recvRejects'];
  let mine;
  try { const got = sbjCall_('job_rt_get', { p_paths: lists }) || {}; mine = lists.map(p => got[p] || {}); }
  catch (e) { Logger.log('FAIL — ERP data: ' + String(e.message || e).slice(0, 300)); return; }
  const theirs = lists.map(p => {
    const r = UrlFetchApp.fetch(RM_DB_URL + '/' + p + '.json?shallow=true', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    return r.getResponseCode() === 200 ? (JSON.parse(r.getContentText() || 'null') || {}) : null;
  });
  lists.forEach((p, i) => {
    const a = Object.keys(mine[i]).length, b = theirs[i] ? Object.keys(theirs[i]).length : '?';
    Logger.log((a === b ? 'PASS ' : 'DIFFERENT ') + p + ' · ERP data: ' + a + ' records · Firebase: ' + b);
  });
  Logger.log('SB_JOB_ON is ' + (sbjProp_('SB_JOB_ON') === 'yes' ? 'ON — the mails use ERP data' : 'off — the mails still use Firebase'));
}
