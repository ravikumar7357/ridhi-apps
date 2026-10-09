/* ==== DELTA SYNC, PHASE 2: THE SHADOW (2026-10-09) ====
 * Ravi: "data wala heavy part kam karo (but make sure mere kaam par impact nahi aana chahiye)".
 *
 * A factory screen downloads the gate registers whole — 7.2 MB, and the database compresses none of it. Phase 1
 * (core/history.js ptSyncNote) records which rows every save changes: pt_sync/<register>/<row> = server time.
 * The idea for phase 3: keep a copy in the browser and fetch only the rows changed since.
 *
 * THIS PHASE CHANGES NOTHING ANYBODY SEES OR USES. The screens keep reading the registers exactly as before. Once per
 * page session, a little after the registers have loaded, this runs in the background and asks: "if this browser
 * had used its copy from last time plus only the changed rows, would it have the very same data as the full read?"
 *   1. its copy from last time (IndexedDB), and the server time that copy was good to;
 *   2. pt_sync since then → the changed rows, fetched one by one (rows with no line are a delete);
 *   3. the register's keys (?shallow=true) → a row added or removed by anything that wrote no pt_sync line;
 *   4. compared row by row with the live copy the app already holds (core/live-copies.js) — NO second full download;
 *   5. one line in pt_syncAudit/<day>/<id>: per register, how many rows changed, the bytes the delta took against the
 *      full size, and every mismatch. Phase 3 happens only after days of zero mismatches.
 * Then the copy is replaced with today's. Everything is caught; nothing here can stop or slow a save or a screen.
 * Off with localStorage deltaShadowOff = '1'. Never in the test harnesses (AUDIT_OFF) or for a vendor. */
/* OFF until probes/sync-coverage.js shows every save since phase 1 noted (Ravi agreed: deploy after that check). */
const DELTA = { on: false, delayMs: 20000, maxRows: 300, marginMs: 2 * 60 * 1000, done: false, running: false, offset: null };
const DELTA_DB = 'ridhi-delta', DELTA_STORE = 'copies';

function deltaShadowSoon() {
  try {
    if (DELTA.done || DELTA.running || !DELTA.on || !AUDIT.on) return;
    try { if (localStorage.getItem('deltaShadowOff') === '1') return; } catch (e) { /* no storage: carry on */ }
    if (typeof indexedDB === 'undefined' || !auth || !auth.currentUser || spIsVendor()) return;
    DELTA.done = true;              // once a page session: the open that phase 3 would make cheaper
    setTimeout(() => {
      deltaShadowRun().catch(e => { DELTA.running = false; deltaLog({ at: new Date().toISOString(), by: deltaWho(), err: deltaErr(e) }); });
    }, DELTA.delayMs);
  } catch (e) { /* never in the way */ }
}

const deltaWho = () => { try { return (ME && ME.email) || ''; } catch (e) { return ''; } };
const deltaErr = e => String((e && e.message) || e).slice(0, 160);
const deltaYield = () => new Promise(r => setTimeout(r, 0));
/** The same data written in a different key order is the same data. */
const deltaCanon = v => JSON.stringify(v === undefined ? null : v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.keys(x).sort().reduce((o, k2) => { o[k2] = x[k2]; return o; }, {}) : x);

/* ---- the browser's copy ---- */
function deltaIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DELTA_DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(DELTA_STORE)) r.result.createObjectStore(DELTA_STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('indexedDB'));
  });
}
const deltaTx = (db, mode, fn) => new Promise((res, rej) => {
  const tx = db.transaction(DELTA_STORE, mode), st = tx.objectStore(DELTA_STORE), q = fn(st);
  tx.oncomplete = () => res(q && 'result' in q ? q.result : undefined);
  tx.onerror = () => rej(tx.error || new Error('indexedDB'));
  tx.onabort = () => rej(tx.error || new Error('indexedDB aborted'));
});
const deltaCopyGet = (db, node) => deltaTx(db, 'readonly', st => st.get(node));
const deltaCopyPut = (db, node, v) => deltaTx(db, 'readwrite', st => st.put(v, node));

/* ---- the server's clock: a phone set five minutes wrong must not skip a change ---- */
async function deltaServerNow() {
  if (DELTA.offset === null) {
    try {
      const { m, db } = await ptLiveDb();
      DELTA.offset = await new Promise(res => {
        let off = null;
        off = m.onValue(m.ref(db, '.info/serverTimeOffset'), s => { res(Number(s.val()) || 0); if (off) off(); });
        setTimeout(() => res(null), 3000);
      });
    } catch (e) { DELTA.offset = null; }
  }
  return Date.now() + (DELTA.offset || 0);
}

/* ---- reads: always small, and their size is counted ---- */
async function deltaRead(path, query) {
  const q = await ptAuthQuery();
  const url = `${PT_URL}/${ptPath(path)}.json` + q + (query ? (q ? '&' : '?') + query : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error(path + ' answered ' + r.status);
  const t = await r.text();
  return { v: t ? JSON.parse(t) : null, bytes: t.length };
}

/** The register as the live copy holds it now — never a download. PT_LIVE_NO when there is no trustworthy copy. */
function deltaLiveNow(node) {
  const L = PT_LIVE.get(node);
  if (!L || L.dead || !L.snap || !PT_LIVE_UP) return PT_LIVE_NO;
  if (!auth || !auth.currentUser || auth.currentUser.uid !== PT_LIVE_UID) return PT_LIVE_NO;
  if (L.wroteSeq && L.evSeq < L.wroteSeq && Date.now() - L.wroteAt < PT_LIVE_SETTLE_MS) return PT_LIVE_NO;
  return L.snap.val();
}

/** Last time's copy + the rows changed since = what phase 3 would hand the screens. */
async function deltaRebuild(node, copy) {
  const info = { mode: 'delta', bytes: 0 };
  const reset = await deltaRead('pt_sync/_reset/' + node);
  info.bytes += reset.bytes;
  if (reset.v && Number(reset.v) >= copy.mark) { info.mode = 'reset'; return { info }; }
  const s = await deltaRead('pt_sync/' + node, 'orderBy=%22%24value%22&startAt=' + Math.floor(copy.mark));
  info.bytes += s.bytes;
  const keys = Object.keys(s.v || {});
  info.changed = keys.length;
  if (keys.length > DELTA.maxRows) { info.mode = 'toomany'; return { info }; }
  const R = Object.assign({}, copy.v || {});
  for (let i = 0; i < keys.length; i += 20) {
    const part = await Promise.all(keys.slice(i, i + 20).map(k => deltaRead(node + '/' + k)));
    part.forEach((x, j) => {
      info.bytes += x.bytes;
      const k = keys[i + j];
      if (x.v === null) delete R[k]; else R[k] = x.v;
    });
  }
  /* A row added or removed by something that wrote no pt_sync line shows here. */
  const sh = await deltaRead(node, 'shallow=true');
  info.bytes += sh.bytes;
  const there = new Set(Object.keys(sh.v || {}));
  info.addedOutside = [...there].filter(k => !(k in R)).length;
  info.removedOutside = Object.keys(R).filter(k => !there.has(k)).length;
  return { info, R };
}

/** Row by row against the live copy. A row saved WHILE this ran is a race, not a fault, and is counted apart. */
async function deltaCompare(node, R, F, startedAt) {
  const keys = new Set(Object.keys(R).concat(Object.keys(F || {})));
  const bad = [];
  let n = 0;
  for (const k of keys) {
    if (deltaCanon(R[k]) !== deltaCanon((F || {})[k])) bad.push(k);
    if (++n % 200 === 0) await deltaYield();
  }
  let race = 0;
  const mism = [];
  for (const k of bad.slice(0, 20)) {
    let ts = 0;
    try { ts = Number((await deltaRead('pt_sync/' + node + '/' + k)).v) || 0; } catch (e) { /* unknown: count it as a mismatch */ }
    if (ts && ts >= startedAt - DELTA.marginMs) race++; else mism.push(k);
  }
  return { rows: keys.size, mismatch: mism.length + Math.max(0, bad.length - 20), race, sample: mism.slice(0, 10) };
}

async function deltaShadowRun() {
  if (DELTA.running) return;
  DELTA.running = true;
  const t0 = Date.now(), uid = auth.currentUser.uid;
  const out = { at: new Date().toISOString(), by: deltaWho(), nodes: {} };
  let db;
  try { db = await deltaIdb(); } catch (e) { DELTA.running = false; out.err = 'no IndexedDB: ' + deltaErr(e); return deltaLog(out); }
  for (const node of PT_SYNC_NODES) {
    const r = {};
    try {
      const copy = await deltaCopyGet(db, node);
      const startedAt = await deltaServerNow();
      let res = null;
      if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') r.mode = 'nocopy';
      else { res = await deltaRebuild(node, copy); Object.assign(r, res.info); }
      /* The truth, taken AFTER the delta so both describe the same moment. */
      const mark = (await deltaServerNow()) - DELTA.marginMs;
      const F = deltaLiveNow(node);
      if (F === PT_LIVE_NO) { r.mode = (r.mode || '') + '+nolive'; out.nodes[node] = r; continue; }
      r.full = JSON.stringify(F || {}).length;
      if (res && res.R) Object.assign(r, await deltaCompare(node, res.R, F || {}, startedAt));
      await deltaCopyPut(db, node, { uid, mark, v: F || {}, at: Date.now() });
    } catch (e) { r.mode = (r.mode || '') + '+error'; r.err = deltaErr(e); }
    out.nodes[node] = r;
    await deltaYield();
  }
  try { db.close(); } catch (e) { /* closed already */ }
  out.ms = Date.now() - t0;
  DELTA.running = false;
  return deltaLog(out);
}

/** One line per run, for the phase 3 decision. Never throws. */
function deltaLog(rec) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    return ptAuditWrite({ ['pt_syncAudit/' + day + '/' + auditId()]: rec }).catch(() => {});
  } catch (e) { return Promise.resolve(); }
}
/* ==== END DELTA SYNC SHADOW ==== */
