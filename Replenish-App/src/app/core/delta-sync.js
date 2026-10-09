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
const DELTA = { on: false, delayMs: 20000, maxRows: 300, marginMs: 2 * 60 * 1000, done: false, running: false, offset: null,
  /* phase 3 (below): OFF as shipped; one device can try it first with localStorage deltaUse = '1' */
  use: false, maxAgeMs: 24 * 3600 * 1000, keyCheckMs: 24 * 3600 * 1000 };
const DELTA_DB = 'ridhi-delta', DELTA_STORE = 'copies';

function deltaShadowSoon() {
  try {
    if (DELTA.done || DELTA.running || !DELTA.on || !AUDIT.on || deltaUseOn()) return;   // nothing to shadow once the copy IS used
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
async function deltaRebuild(node, copy, keyCheck) {
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
  /* A row added or removed by something that wrote no pt_sync line shows here. Phase 3 asks once a day (it is most
   * of the bytes); the shadow always asks. */
  if (keyCheck === false) { info.addedOutside = 0; info.removedOutside = 0; return { info, R, synced: s.v || {} }; }
  const sh = await deltaRead(node, 'shallow=true');
  info.bytes += sh.bytes;
  const there = new Set(Object.keys(sh.v || {}));
  info.addedOutside = [...there].filter(k => !(k in R)).length;
  info.removedOutside = Object.keys(R).filter(k => !there.has(k)).length;
  return { info, R, synced: s.v || {} };
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

/* ==== DELTA SYNC, PHASE 3: USE THE COPY ====
 * When it is switched on (DELTA.use for everyone, or localStorage deltaUse = '1' on one device; deltaUse = '0' turns
 * it off on that device whatever the switch says), a gate register's live copy (core/live-copies.js) is built from
 * the browser's copy + the rows pt_sync says changed, instead of downloading the whole register:
 *   - kept fresh by listening to pt_sync/<register> from the copy's mark: each changed row is read on its own;
 *   - the key check (?shallow) once a day, because it is most of the bytes;
 *   - FALLS BACK TO TODAY'S WAY — the whole register, live — on anything doubtful: no copy, a copy older than a day,
 *     another account's copy, a whole-register write, a row added or removed outside the app, any error at all.
 * The screens cannot tell the difference: they get a fresh object on every read, as before. */
function deltaUseOn() {
  try {
    const d = localStorage.getItem('deltaUse');
    if (d === '0') return false;
    if (d === '1') return true;
  } catch (e) { /* no storage: the global switch decides */ }
  return !!DELTA.use;
}
const deltaClone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** A live copy for a gate register built from the copy, or null to let core/live-copies.js do it the full way. */
function deltaLiveOpen(node) {
  try {
    if (!PT_SYNC_NODES.has(node) || !AUDIT.on || !deltaUseOn()) return null;
    if (typeof indexedDB === 'undefined' || !auth || !auth.currentUser || spIsVendor()) return null;
  } catch (e) { return null; }
  const L = { snap: null, dead: false, wroteAt: 0, wroteSeq: 0, evSeq: 0, off: null, offs: [], closed: false, delta: 'opening' };
  L.off = () => { L.closed = true; L.offs.forEach(f => { try { f(); } catch (e) { /* gone */ } }); L.offs = []; };
  L.first = deltaLiveStart(L, node).catch(e => deltaToFull(L, node, 'error: ' + deltaErr(e)));
  return L;
}

async function deltaLiveStart(L, node) {
  const uid = auth.currentUser.uid;
  const { m, db } = await ptLiveDb();
  const idb = await deltaIdb();
  const copy = await deltaCopyGet(idb, node);
  const now = await deltaServerNow();
  if (L.closed) return false;
  let why = '';
  if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') why = 'no copy';
  else if (now - copy.mark > DELTA.maxAgeMs) why = 'copy older than a day';
  if (why) return deltaLiveFull(L, node, why, idb);
  const keyCheck = now - (copy.keysAt || 0) > DELTA.keyCheckMs;
  const res = await deltaRebuild(node, copy, keyCheck);
  if (L.closed) return false;
  if (!res.R) return deltaLiveFull(L, node, res.info.mode, idb);
  if (res.info.addedOutside || res.info.removedOutside) return deltaLiveFull(L, node, 'rows added or removed outside the app', idb);
  const val = res.R, seen = Object.assign({}, res.synced), want = {};
  L.snap = { val: () => deltaClone(val) };
  L.evSeq = ++PT_LIVE_SEQ;
  L.delta = 'delta';
  deltaCopyPut(idb, node, { uid, mark: now - DELTA.marginMs, v: val, at: Date.now(), keysAt: keyCheck ? now : (copy.keysAt || 0) }).catch(() => {});
  /* Every later save anywhere: its pt_sync line arrives here, and that one row is read. */
  const onKey = sn => {
    const k = sn.key, ts = Number(sn.val()) || 0;
    if (L.closed || L.delta !== 'delta' || (seen[k] && seen[k] >= ts)) return;
    seen[k] = ts;
    const my = (want[k] || 0) + 1; want[k] = my;
    deltaRead(node + '/' + k).then(x => {
      if (want[k] !== my || L.delta !== 'delta' || L.closed) return;     // a newer read of this row is on its way
      if (x.v === null) delete val[k]; else val[k] = x.v;
      L.evSeq = ++PT_LIVE_SEQ;
    }).catch(() => deltaToFull(L, node, 'a changed row could not be read'));
  };
  const q = m.query(m.ref(db, 'pt_sync/' + node), m.orderByValue(), m.startAt(copy.mark));
  L.offs.push(m.onChildAdded(q, onKey), m.onChildChanged(q, onKey));
  L.offs.push(m.onValue(m.ref(db, 'pt_sync/_reset/' + node), sn => {
    const v = Number(sn.val()) || 0;
    if (v && v >= copy.mark && L.delta === 'delta') deltaToFull(L, node, 'whole register written');
  }));
  deltaLog({ at: new Date().toISOString(), by: deltaWho(), use: node, mode: 'delta', changed: res.info.changed || 0, bytes: res.info.bytes, keyCheck });
  return true;
}

/** Midway (a reset, a row that could not be read): drop the copy and wait for the full register before answering. */
function deltaToFull(L, node, why) {
  if (L.closed || L.delta === 'full') return L.first;
  L.snap = null;
  L.first = deltaLiveFull(L, node, why).catch(() => { L.dead = true; return false; });
  return L.first;
}

/** Today's way — the whole register, live — and keep it as the copy for next time. */
async function deltaLiveFull(L, node, why, idb) {
  L.offs.forEach(f => { try { f(); } catch (e) { /* gone */ } }); L.offs = [];
  L.delta = 'full';
  if (L.closed) return false;
  const uid = auth.currentUser.uid;
  const { m, db } = await ptLiveDb();
  const mark = (await deltaServerNow()) - DELTA.marginMs;     // taken BEFORE the read, so nothing after it is missed
  return new Promise(res => {
    let first = true;
    L.offs.push(m.onValue(m.ref(db, node), sn => {
      L.snap = sn; L.evSeq = ++PT_LIVE_SEQ;
      if (!first) return;
      first = false; res(true);
      (idb ? Promise.resolve(idb) : deltaIdb())
        .then(d => deltaCopyPut(d, node, { uid, mark, v: sn.val() || {}, at: Date.now(), keysAt: mark + DELTA.marginMs }))
        .catch(() => {});
      deltaLog({ at: new Date().toISOString(), by: deltaWho(), use: node, mode: 'full', why });
    }, () => { L.dead = true; L.snap = null; res(false); }));
  });
}
/* ==== END DELTA SYNC PHASE 3 ==== */
