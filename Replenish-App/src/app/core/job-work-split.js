/* ================= JOB WORK: COMPLETED ENTRIES KEPT APART (2026-10-01) =================
 *
 * Ravi: "job work ki entry jo complete ho chuki h hum unko complete section me add kr sakte h jisase wo again and again
 * download nahi hoga" — and: "sirf hum us particular entry ko complete krenge order ko complete nhi krenge, complete
 * hui entry sab jagah kam aa sakti h".
 *
 * On 1 Oct 4,452 of the 4,541 Job Work rows (2.64 of 2.68 MB) were complete; the open ones were 43 KB. The database
 * sends nothing compressed, and every page load of a factory screen downloaded all of it again.
 *
 *   pt_baseData/<id>                 the entries still open, and the ones completed in the last few days
 *   pt_baseDone/<YYYY-MM>/<id>       completed entries, by the month they came back (receivingDate)
 *   pt_baseDone/_ver/<YYYY-MM>       changes whenever anything in that month changes
 *
 * EVERY SCREEN STILL SEES ONE REGISTER. ptGet('pt_baseData') answers with both parts joined, keyed by entry id as before;
 * a write to pt_baseData/<id> of an entry that now lives in the completed part is sent there (and that month's _ver
 * moves), so a correction, an admin edit, a WhatsApp stamp or a SKU rename works exactly as it did. Only the ENTRY moves —
 * its order is not touched, and every total, cap, payout and report still counts it.
 *
 * A completed month already in this browser (IndexedDB) is not downloaded again unless its _ver changed: the one read
 * that is always made is _ver itself, a few bytes. Without IndexedDB (a private window) the months are read every time —
 * slower, never wrong.
 *
 * An entry is moved only by baseArchiveRun (admins, a button on Job Work): complete (frozen, nothing pending), back for
 * at least BASE_MOVE_AFTER_DAYS days, and no correction request waiting on it. Each batch is ONE database write — copy
 * in, original out, _ver moved — so an entry can never be in neither place.
 */
/* BASE_SPLIT_OFF is never set in the browser; the test harnesses set it so the existing tests see the register as before. */
const BASE = { on: typeof BASE_SPLIT_OFF === 'undefined' || !BASE_SPLIT_OFF, where: null, openIds: null, months: null, loading: null };
const BASE_NODE = 'pt_baseData', DONE_NODE = 'pt_baseDone';
const BASE_MOVE_AFTER_DAYS = 3, BASE_MOVE_BATCH = 400;
const BASE_IDB = 'replenish-cache', BASE_IDB_STORE = 'baseDone';

/* ---- the browser's own copy of the completed months ---- */
function baseIdb() {
  return new Promise(res => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const rq = indexedDB.open(BASE_IDB, 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore(BASE_IDB_STORE); } catch (e) { /* already there */ } };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
async function baseCacheGet(month) {
  const db = await baseIdb(); if (!db) return null;
  return new Promise(res => {
    try {
      const rq = db.transaction(BASE_IDB_STORE, 'readonly').objectStore(BASE_IDB_STORE).get(month);
      rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function baseCachePut(month, val) {
  const db = await baseIdb(); if (!db) return;
  await new Promise(res => {
    try {
      const tx = db.transaction(BASE_IDB_STORE, 'readwrite');
      if (val == null) tx.objectStore(BASE_IDB_STORE).delete(month); else tx.objectStore(BASE_IDB_STORE).put(val, month);
      tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res();
    } catch (e) { res(); }
  });
}

/** The completed part: { rows: {id: row}, where: Map(id → month) }. Months unchanged since this browser last read them
 *  come from IndexedDB; the rest are read and kept. A month this page wrote to is re-read. */
async function baseDoneAll() {
  const ver = (await ptGet(DONE_NODE + '/_ver', true)) || {};
  const rows = {}, where = new Map(), months = {};
  for (const m of Object.keys(ver).filter(k => /^\d{4}-\d{2}$/.test(k)).sort()) {
    let got = await baseCacheGet(m);
    if (!got || got.ver !== ver[m]) {
      const data = (await ptGet(DONE_NODE + '/' + m, true)) || {};
      got = { ver: ver[m], rows: data };
      await baseCachePut(m, got);
    }
    months[m] = got.ver;
    Object.entries(got.rows || {}).forEach(([id, r]) => { if (r && typeof r === 'object') { rows[id] = r; where.set(id, m); } });
  }
  return { rows, where, months };
}

/** ptGet('pt_baseData'): the open entries and the completed ones, one register keyed by entry id. */
async function baseReadAll() {
  const [open, done] = await Promise.all([ptGet(BASE_NODE, true), baseDoneAll()]);
  const out = Object.assign({}, done.rows);
  const openObj = Array.isArray(open) ? Object.fromEntries(open.map((r, i) => [r && r.id ? r.id : String(i), r]).filter(([, r]) => r))
    : (open || {});
  /* An entry in both places (it was written to by its old address after it moved): its fields from both, the open
   * part's winning — that is the later write. The next move tidies it into one. */
  Object.entries(openObj).forEach(([id, r]) => { if (r && typeof r === 'object') out[id] = Object.assign({}, out[id] || {}, r); });
  BASE.where = done.where; BASE.months = done.months; BASE.openIds = new Set(Object.keys(openObj));
  return out;
}

/** Where pt_baseData/<id>[/field] really is: in the completed part when that entry lives there, else null. */
function baseRoutePath(p) {
  if (!BASE.on || !BASE.where) return null;
  const m = /^pt_baseData\/([^/]+)(\/.*)?$/.exec(String(p || ''));
  if (!m) return null;
  const mon = BASE.where.get(m[1]);
  if (!mon || (BASE.openIds && BASE.openIds.has(m[1]))) return null;
  return { path: DONE_NODE + '/' + mon + '/' + m[1] + (m[2] || ''), month: mon };
}
/** Before the first write to a Job Work entry, the page must know which entries are in the completed part. */
async function baseEnsureWhere(paths) {
  if (!BASE.on || BASE.where || !paths.some(p => /^pt_baseData\//.test(String(p || '')))) return;
  if (!BASE.loading) BASE.loading = baseDoneAll().then(d => { BASE.where = d.where; BASE.months = d.months; }).finally(() => { BASE.loading = null; });
  await BASE.loading;
}
/** A write's paths, sent where the entries live; the months touched get a new _ver. Returns { updates, months }. */
function baseRouteUpdates(updates) {
  const out = {}, months = new Set();
  Object.keys(updates || {}).forEach(k => {
    const rt = baseRoutePath(k);
    if (rt) { out[rt.path] = updates[k]; months.add(rt.month); } else out[k] = updates[k];
  });
  const stamp = Date.now();
  months.forEach(m => { out[DONE_NODE + '/_ver/' + m] = stamp; });
  return { updates: out, months: [...months] };
}
/** This page changed a completed month: its copy in this browser is no longer that month. */
async function baseForget(months) { for (const m of months || []) await baseCachePut(m, null); }

/* ---- moving completed entries (admins) ---- */
/** "DD/MM/YYYY, HH:MM" → "YYYY-MM". */
const baseMonthOf = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') : ''; };
/** The entries that may move now: complete, back BASE_MOVE_AFTER_DAYS days or more, no correction waiting, still open-side. */
function baseArchivePlan(rows, now) {
  const cutoff = (now || Date.now()) - BASE_MOVE_AFTER_DAYS * 86400000;
  const waiting = new Set(Object.values((typeof JWC !== 'undefined' && JWC && JWC.rows) || {})
    .filter(q => q && q.status === 'pending').map(q => q.rowId || q.row || q.id));
  const take = (rows || []).filter(r => r && r.id && r.frozen === true && ptNum(r.pendingPieces) <= 0
    && baseMonthOf(r.receivingDate) && ptDtMs(r.receivingDate) && ptDtMs(r.receivingDate) <= cutoff
    && !waiting.has(r.id) && (!BASE.openIds || BASE.openIds.has(r.id)));
  const byMonth = {};
  take.forEach(r => { const m = baseMonthOf(r.receivingDate); (byMonth[m] = byMonth[m] || []).push(r); });
  return { rows: take, byMonth };
}
/** Move them: per batch ONE write — copy into pt_baseDone/<month>/<id>, pt_baseData/<id> removed, _ver moved. */
async function baseArchiveRun(onStep) {
  if (!(ME && ME.admin)) return { err: 'Only an admin can move completed entries.' };
  if (!BASE.on) return { err: 'The completed section is switched off.' };
  const plan = baseArchivePlan(PT.base || []);
  let moved = 0;
  for (const [m, list] of Object.entries(plan.byMonth)) {
    for (let i = 0; i < list.length; i += BASE_MOVE_BATCH) {
      const part = list.slice(i, i + BASE_MOVE_BATCH), up = {};
      part.forEach(r => { const clean = Object.assign({}, r); delete clean._key; up[DONE_NODE + '/' + m + '/' + r.id] = clean; up[BASE_NODE + '/' + r.id] = null; });
      up[DONE_NODE + '/_ver/' + m] = Date.now();
      /* noRoute: these paths already say where; noTrash: nothing is being deleted, it is being moved. */
      await ptPatch(up, { noRoute: true, noTrash: true });
      part.forEach(r => { BASE.where && BASE.where.set(r.id, m); BASE.openIds && BASE.openIds.delete(r.id); });
      await baseForget([m]);
      moved += part.length;
      if (onStep) onStep(moved, plan.rows.length);
    }
  }
  return { moved, months: Object.keys(plan.byMonth) };
}
