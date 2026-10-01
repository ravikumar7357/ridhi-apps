/* ================= JOB WORK: COMPLETED ENTRIES KEPT APART (2026-10-01) =================
 *
 * Ravi: "job work ki entry jo complete ho chuki h hum unko complete section me add kr sakte h jisase wo again and again
 * download nahi hoga" — "sirf hum us particular entry ko complete krenge order ko complete nhi krenge, complete hui entry
 * sab jagah kam aa sakti h" — "complete section me entry auto complete ho jay to shift honi chahiye".
 *
 * On 1 Oct 4,452 of the 4,541 Job Work rows (2.64 of 2.68 MB) were complete; the open ones were 43 KB. The database
 * sends nothing compressed, and every page load of a factory screen downloaded all of it again.
 *
 *   pt_baseData/<id>                     the entries still open, and the ones completed today
 *   pt_baseDone/<YYYY-MM-DD>/<id>        completed entries, by the DAY they came back (receivingDate)
 *   pt_baseDone/_ver/<YYYY-MM-DD>        changes whenever anything in that day changes
 *   pt_baseDone/_auto                    { enabled, at, by } — the automatic move, and when it last ran
 *
 * EVERY SCREEN STILL SEES ONE REGISTER. ptGet('pt_baseData') answers with both parts joined, keyed by entry id as before;
 * a write to pt_baseData/<id> of an entry that now lives in the completed part is sent there (and that day's _ver moves),
 * so a correction, an admin edit, a WhatsApp stamp or a SKU rename works exactly as it did. Only the ENTRY moves — its
 * order is not touched, and every total, cap, payout and report still counts it.
 *
 * BY DAY, NOT BY MONTH: a finished day does not change again (bar the rare correction), so each browser downloads it
 * once and keeps it (IndexedDB). A month would change all month long and be downloaded again after every completion.
 * The one read always made is _ver itself, a few bytes per day. Without IndexedDB (a private window) the days are read
 * every time — slower, never wrong.
 *
 * MOVED AUTOMATICALLY: an entry that is complete (frozen, nothing pending) and came back BEFORE TODAY moves on its own —
 * whoever has Job Work open runs baseAutoMove at most every BASE_AUTO_EVERY_MS, once _auto.enabled is set (it is set by
 * hand after the first, supervised move). Entries completed today stay where they are for the day's corrections.
 * Each batch is ONE database write — copy in, original out, _ver moved — so an entry can never be in neither place.
 */
/* BASE_SPLIT_OFF is never set in the browser; the test harnesses set it so the existing tests see the register as before. */
const BASE = { on: typeof BASE_SPLIT_OFF === 'undefined' || !BASE_SPLIT_OFF, where: null, openIds: null, days: null, loading: null, autoBusy: false };
const BASE_NODE = 'pt_baseData', DONE_NODE = 'pt_baseDone';
const BASE_MOVE_BATCH = 400, BASE_AUTO_EVERY_MS = 6 * 3600 * 1000;
const BASE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE_IDB = 'replenish-cache', BASE_IDB_STORE = 'baseDone';

/* ---- the browser's own copy of the completed days ---- */
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
async function baseCacheGet(day) {
  const db = await baseIdb(); if (!db) return null;
  return new Promise(res => {
    try {
      const rq = db.transaction(BASE_IDB_STORE, 'readonly').objectStore(BASE_IDB_STORE).get(day);
      rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function baseCachePut(day, val) {
  const db = await baseIdb(); if (!db) return;
  await new Promise(res => {
    try {
      const tx = db.transaction(BASE_IDB_STORE, 'readwrite');
      if (val == null) tx.objectStore(BASE_IDB_STORE).delete(day); else tx.objectStore(BASE_IDB_STORE).put(val, day);
      tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res();
    } catch (e) { res(); }
  });
}

/** The completed part: { rows: {id: row}, where: Map(id → day), days }. Days unchanged since this browser last read them
 *  come from IndexedDB; the rest are read and kept. */
async function baseDoneAll() {
  const ver = (await ptGet(DONE_NODE + '/_ver', true)) || {};
  const rows = {}, where = new Map(), days = {};
  for (const d of Object.keys(ver).filter(k => BASE_DAY_RE.test(k)).sort()) {
    let got = await baseCacheGet(d);
    if (!got || got.ver !== ver[d]) {
      const data = (await ptGet(DONE_NODE + '/' + d, true)) || {};
      got = { ver: ver[d], rows: data };
      await baseCachePut(d, got);
    }
    days[d] = got.ver;
    Object.entries(got.rows || {}).forEach(([id, r]) => { if (r && typeof r === 'object') { rows[id] = r; where.set(id, d); } });
  }
  return { rows, where, days };
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
  BASE.where = done.where; BASE.days = done.days; BASE.openIds = new Set(Object.keys(openObj));
  return out;
}

/** Where pt_baseData/<id>[/field] really is: in the completed part when that entry lives there, else null. */
function baseRoutePath(p) {
  if (!BASE.on || !BASE.where) return null;
  const m = /^pt_baseData\/([^/]+)(\/.*)?$/.exec(String(p || ''));
  if (!m) return null;
  const day = BASE.where.get(m[1]);
  if (!day || (BASE.openIds && BASE.openIds.has(m[1]))) return null;
  return { path: DONE_NODE + '/' + day + '/' + m[1] + (m[2] || ''), day };
}
/** Before the first write to a Job Work entry, the page must know which entries are in the completed part. */
async function baseEnsureWhere(paths) {
  if (!BASE.on || BASE.where || !paths.some(p => /^pt_baseData\//.test(String(p || '')))) return;
  if (!BASE.loading) BASE.loading = baseDoneAll().then(d => { BASE.where = d.where; BASE.days = d.days; }).finally(() => { BASE.loading = null; });
  await BASE.loading;
}
/** A write's paths, sent where the entries live; the days touched get a new _ver. Returns { updates, months: days }. */
function baseRouteUpdates(updates) {
  const out = {}, days = new Set();
  Object.keys(updates || {}).forEach(k => {
    const rt = baseRoutePath(k);
    if (rt) { out[rt.path] = updates[k]; days.add(rt.day); } else out[k] = updates[k];
  });
  const stamp = Date.now();
  days.forEach(d => { out[DONE_NODE + '/_ver/' + d] = stamp; });
  return { updates: out, months: [...days] };
}
/** This page changed a completed day: its copy in this browser is no longer that day. */
async function baseForget(days) { for (const d of days || []) await baseCachePut(d, null); }

/* ---- moving completed entries ---- */
/** "DD/MM/YYYY, HH:MM" → "YYYY-MM-DD". */
const baseDayOf = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
/** The entries that may move now: complete, came back before today, no correction waiting, still on the open side. */
function baseArchivePlan(rows, now) {
  const today = new Date(now || Date.now()); today.setHours(0, 0, 0, 0);
  const waiting = new Set(Object.values((typeof JWC !== 'undefined' && JWC && JWC.rows) || {})
    .filter(q => q && q.status === 'pending').map(q => q.rowId || q.row || q.id));
  const take = (rows || []).filter(r => r && r.id && r.frozen === true && ptNum(r.pendingPieces) <= 0
    && baseDayOf(r.receivingDate) && ptDtMs(r.receivingDate) && ptDtMs(r.receivingDate) < today.getTime()
    && !waiting.has(r.id) && (!BASE.openIds || BASE.openIds.has(r.id)));
  const byDay = {};
  take.forEach(r => { const d = baseDayOf(r.receivingDate); (byDay[d] = byDay[d] || []).push(r); });
  return { rows: take, byDay };
}
const baseOnPreview = () => typeof location !== 'undefined' && /--/.test(String(location.hostname || ''));
/** Move them: per batch ONE write — copy into pt_baseDone/<day>/<id>, pt_baseData/<id> removed, _ver moved.
 *  opts.auto: the automatic move (any member of Job Work staff); otherwise an admin pressing the button. */
async function baseArchiveRun(onStep, opts) {
  opts = opts || {};
  if (!opts.auto && !(ME && ME.admin)) return { err: 'Only an admin can move completed entries.' };
  if (!BASE.on) return { err: 'The completed section is switched off.' };
  /* ONLY FROM THE LIVE APP. A preview link (its address has "--") runs code the live app may not have yet: entries moved
   * from there would vanish from every screen of an older live app, which reads pt_baseData alone. */
  if (baseOnPreview()) return { err: 'Entries are moved only from the live app (fabricrush-replenish.web.app), once it reads the completed section.' };
  const plan = baseArchivePlan(PT.base || []);
  /* One write per batch, and a batch never spans days: a day's entries go together with that day's _ver. */
  const batches = [];
  Object.entries(plan.byDay).sort().forEach(([d, list]) => {
    for (let i = 0; i < list.length; i += BASE_MOVE_BATCH) batches.push([d, list.slice(i, i + BASE_MOVE_BATCH)]);
  });
  let moved = 0;
  for (const [d, part] of batches) {
    const up = {};
    part.forEach(r => { const clean = Object.assign({}, r); delete clean._key; up[DONE_NODE + '/' + d + '/' + r.id] = clean; up[BASE_NODE + '/' + r.id] = null; });
    up[DONE_NODE + '/_ver/' + d] = Date.now();
    /* noRoute: these paths already say where; noTrash: nothing is being deleted, it is being moved. */
    await ptPatch(up, { noRoute: true, noTrash: true });
    part.forEach(r => { BASE.where && BASE.where.set(r.id, d); BASE.openIds && BASE.openIds.delete(r.id); });
    await baseForget([d]);
    moved += part.length;
    if (onStep) onStep(moved, plan.rows.length);
  }
  return { moved, days: Object.keys(plan.byDay).sort() };
}
/** THE AUTOMATIC MOVE: run from whoever has Job Work open, quietly, at most every BASE_AUTO_EVERY_MS across everybody,
 *  and only once pt_baseDone/_auto.enabled is true. Never in the way: any failure is only logged. */
async function baseAutoMove(now) {
  if (!BASE.on || BASE.autoBusy || baseOnPreview() || !Array.isArray(PT.base) || !BASE.openIds) return { skipped: 'not ready' };
  BASE.autoBusy = true;
  try {
    const st = (await ptGet(DONE_NODE + '/_auto', true)) || {};
    const t = now || Date.now();
    if (st.enabled !== true) return { skipped: 'off' };
    if (st.at && t - Number(st.at) < BASE_AUTO_EVERY_MS) return { skipped: 'ran recently' };
    /* Say it is running BEFORE moving, so two pages opened together do not both start. (If they do, the second
     * finds nothing left on the open side to move — a move is safe to repeat.) */
    await ptPatch({ [DONE_NODE + '/_auto/at']: t, [DONE_NODE + '/_auto/by']: (ME && ME.email) || '' }, { noRoute: true });
    return await baseArchiveRun(null, { auto: true });
  } catch (e) {
    console.warn('[job work] the automatic move did not run:', e);
    return { err: String((e && e.message) || e) };
  } finally { BASE.autoBusy = false; }
}
