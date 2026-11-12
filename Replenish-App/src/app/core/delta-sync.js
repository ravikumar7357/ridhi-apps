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
/* ON since 2026-10-10: sync-coverage.js showed every gate-row save since phase 1 noted (458 of 458), Ravi said go. */
const DELTA = { on: true, delayMs: 20000, maxRows: 300, marginMs: 2 * 60 * 1000, done: false, running: false, offset: null,
  /* A copy is saved only after the connection has been up this long: just after a reconnect the live copy can still be an old one. */
  minUpMs: 60 * 1000, upAt: null, netOn: false,
  /* A wipe bumps gen, so a run or an open that was already under way cannot write a copy back afterwards. */
  gen: 0, wipeSaid: {},
  /* phase 3 (below): its switch is config/flags deltaUse (kept by deltaSaveFlag); one device can override with localStorage
   * deltaUse = '1' / '0'. After go-live, this share of page sessions takes the full path and runs the shadow. */
  sampleRate: 0.1, sample: null, maxAgeMs: 24 * 3600 * 1000, keyCheckMs: 24 * 3600 * 1000 };
const DELTA_DB = 'ridhi-delta', DELTA_STORE = 'copies';

function deltaShadowSoon() {
  try {
    if (DELTA.done || DELTA.running || !DELTA.on || !AUDIT.on || deltaLiveOn()) return;   // nothing to shadow once the copy IS used
    try { if (localStorage.getItem('deltaShadowOff') === '1') return; } catch (e) { /* no storage: carry on */ }
    if (typeof indexedDB === 'undefined' || !auth || !auth.currentUser || spIsVendor()) return;
    DELTA.done = true;              // once a page session: the open that phase 3 would make cheaper
    deltaNetWatch();
    /* late enough that the connection has been up for the minimum before the copy is taken */
    setTimeout(() => {
      deltaShadowRun().catch(e => { DELTA.running = false; deltaLog({ at: new Date().toISOString(), by: deltaWho(), err: deltaErr(e) }); });
    }, Math.max(DELTA.delayMs, DELTA.minUpMs ? DELTA.minUpMs + 5000 : 0));
  } catch (e) { /* never in the way */ }
}

/** How long the connection has been up without a break — this file's own listener, started with the shadow. */
function deltaNetWatch() {
  if (DELTA.netOn) return;
  DELTA.netOn = true;
  ptLiveDb().then(({ m, db }) => {
    m.onValue(m.ref(db, '.info/connected'), s => { DELTA.upAt = s.val() === true ? (DELTA.upAt || Date.now()) : null; });
  }).catch(() => { DELTA.netOn = false; });
}
const deltaUpMs = () => (DELTA.upAt ? Date.now() - DELTA.upAt : 0);

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
/* A wipe (below) must not wait for a connection this file left open. */
const deltaIdbOpen = () => deltaIdb().then(d => { try { d.onversionchange = () => d.close(); } catch (e) { /* fine */ } return d; });
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
async function deltaRead(path, query, label) {
  const q = await ptAuthQuery();
  const url = `${PT_URL}/${ptPath(path)}.json` + q + (query ? (q ? '&' : '?') + query : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error(path + ' answered ' + r.status);
  const t = await r.text();
  try { if (typeof dmCount === 'function') dmCount(path, t.length, label || 'delta-shadow'); } catch (e) { console.warn('[data meter]', e); }
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
async function deltaRebuild(node, copy, keyCheck, label) {
  const info = { mode: 'delta', bytes: 0 };
  const reset = await deltaRead('pt_sync/_reset/' + node, '', label);
  info.bytes += reset.bytes;
  if (reset.v && Number(reset.v) >= copy.mark) { info.mode = 'reset'; return { info }; }
  const s = await deltaRead('pt_sync/' + node, 'orderBy=%22%24value%22&startAt=' + Math.floor(copy.mark), label);
  info.bytes += s.bytes;
  const keys = Object.keys(s.v || {});
  info.changed = keys.length;
  if (keys.length > DELTA.maxRows) { info.mode = 'toomany'; return { info }; }
  const R = Object.assign({}, copy.v || {});
  for (let i = 0; i < keys.length; i += 20) {
    const part = await Promise.all(keys.slice(i, i + 20).map(k => deltaRead(node + '/' + k, '', label)));
    part.forEach((x, j) => {
      info.bytes += x.bytes;
      const k = keys[i + j];
      if (x.v === null) delete R[k]; else R[k] = x.v;
    });
  }
  /* A row added or removed by something that wrote no pt_sync line shows here. Phase 3 asks once a day (it is most
   * of the bytes); the shadow always asks. */
  if (keyCheck === false) { info.addedOutside = 0; info.removedOutside = 0; return { info, R, synced: s.v || {} }; }
  const sh = await deltaRead(node, 'shallow=true', label);
  info.bytes += sh.bytes;
  const there = new Set(Object.keys(sh.v || {}));
  info.addedOutside = [...there].filter(k => !(k in R)).length;
  info.removedOutside = Object.keys(R).filter(k => !there.has(k)).length;
  return { info, R, synced: s.v || {} };
}

/** One differing row in a few words: the field, its type and the first 40 characters each side. */
function deltaRowDiff(k, a, b) {
  const typ = x => (Array.isArray(x) ? 'array' : x == null ? 'none' : typeof x);
  const cut = x => (x === undefined ? '(none)' : typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 40);
  if (a === undefined || b === undefined) return k + ': row missing in ' + (a === undefined ? 'copy' : 'live');
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return k + ' ' + typ(a) + '/' + typ(b) + ' "' + cut(a) + '" vs "' + cut(b) + '"';
  const fs = [];
  for (const f of new Set(Object.keys(a).concat(Object.keys(b)))) {
    if (deltaCanon(a[f]) !== deltaCanon(b[f])) { fs.push(k + '.' + f + ' ' + typ(a[f]) + '/' + typ(b[f]) + ' "' + cut(a[f]) + '" vs "' + cut(b[f]) + '"'); if (fs.length >= 2) break; }
  }
  return fs.length ? fs.join(', ') : k + ': differs';
}

/** Row by row against the live copy. A row saved WHILE this ran is a race, not a fault, and is counted apart.
 *  For up to 3 differing rows it also says what differs, and whether the row has a change line and when, against the copy's time. */
async function deltaCompare(node, R, F, startedAt, copyMark) {
  const keys = new Set(Object.keys(R).concat(Object.keys(F || {})));
  const bad = [];
  let n = 0;
  for (const k of keys) {
    if (deltaCanon(R[k]) !== deltaCanon((F || {})[k])) bad.push(k);
    if (++n % 200 === 0) await deltaYield();
  }
  let race = 0;
  const mism = [], lines = {};
  for (const k of bad.slice(0, 20)) {
    let ts = 0;
    try { ts = Number((await deltaRead('pt_sync/' + node + '/' + k, '', 'delta-shadow')).v) || 0; } catch (e) { /* unknown: count it as a mismatch */ }
    lines[k] = ts;
    if (ts && ts >= startedAt - DELTA.marginMs) race++; else mism.push(k);
  }
  const unchecked = Math.max(0, bad.length - 20);          // bad rows past the first 20: counted, not re-checked
  const diff = bad.slice(0, 3).map(k => deltaRowDiff(k, R[k], (F || {})[k]) + ' | '
    + (lines[k] ? 'note ' + (lines[k] >= (copyMark || 0) ? '+' : '') + Math.round((lines[k] - (copyMark || 0)) / 1000) + 's vs copy' : 'no note')).join(' ;; ').slice(0, 600);
  return { rows: keys.size, mismatch: mism.length + unchecked, unchecked, race, sample: mism.slice(0, 10), diff };
}

async function deltaShadowRun() {
  if (DELTA.running) return;
  DELTA.running = true;
  const t0 = Date.now(), uid = auth.currentUser.uid, gen = DELTA.gen;
  const out = { at: new Date().toISOString(), by: deltaWho(), nodes: {} };
  let db;
  try { db = await deltaIdbOpen(); } catch (e) { DELTA.running = false; out.err = 'no IndexedDB: ' + deltaErr(e); return deltaLog(out); }
  for (const node of PT_SYNC_NODES) {
    const r = {};
    try {
      const copy = await deltaCopyGet(db, node);
      const startedAt = await deltaServerNow();
      let res = null;
      if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') r.mode = 'nocopy';
      else { res = await deltaRebuild(node, copy, undefined, 'delta-shadow'); Object.assign(r, res.info); }
      /* The truth, taken AFTER the delta so both describe the same moment. */
      const nowS = await deltaServerNow(), mark = nowS - DELTA.marginMs;
      const F = deltaLiveNow(node);
      const up = deltaUpMs();                                  // how long the connection has been up, at the moment of the truth
      r.upFor = Math.round(up / 1000);
      if (F === PT_LIVE_NO) { r.mode = (r.mode || '') + '+nolive'; out.nodes[node] = r; continue; }
      r.full = JSON.stringify(F || {}).length;
      if (res && res.R) Object.assign(r, await deltaCompare(node, res.R, F || {}, startedAt, copy.mark));
      /* The copy is today's full register, so it carries a full-download time (fullAt). Not saved when the connection has
       * only just come back (the live copy may be an old one) or when the copy was wiped meanwhile. */
      if (up >= DELTA.minUpMs && gen === DELTA.gen) await deltaCopyPut(db, node, { uid, mark, v: F || {}, at: Date.now(), fullAt: nowS, keysAt: nowS });
      else r.kept = 'old copy kept';
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
/** Delete the whole browser copy (sign-out on a shared computer, another account signing in). Logs the reason once. Never throws. */
function deltaWipe(reason) {
  DELTA.gen++;
  try {
    if (!DELTA.wipeSaid[reason]) { DELTA.wipeSaid[reason] = 1; deltaLog({ at: new Date().toISOString(), by: deltaWho(), wipe: String(reason || '').slice(0, 80) }); }
  } catch (e) { /* only a note */ }
  return new Promise(res => {
    setTimeout(() => res(false), 3000);     // a delete behind another tab's blocked one gets no event: never hold up a sign-in or sign-out
    try {
      if (typeof indexedDB === 'undefined') return res(false);
      const r = indexedDB.deleteDatabase(DELTA_DB);
      r.onsuccess = () => res(true); r.onerror = () => res(false); r.onblocked = () => res(false);
    } catch (e) { res(false); }
  });
}

/** Called once someone is signed in: a copy kept for another account (or one with no known owner) is deleted. */
function deltaSignedIn(email) {
  try {
    const em = String(email || '').trim().toLowerCase();
    if (!em) return Promise.resolve(false);
    let owner = null;
    try { owner = localStorage.getItem('deltaOwner'); } catch (e) { /* no storage: always wipe */ }
    try { localStorage.setItem('deltaOwner', em); } catch (e) { /* no storage */ }
    if (owner === em) return Promise.resolve(false);
    return deltaWipe(owner ? 'another account signed in' : 'copy of unknown owner');
  } catch (e) { return Promise.resolve(false); }
}
/* ==== END DELTA SYNC SHADOW ==== */

/* ==== DELTA SYNC, PHASE 3: USE THE COPY ====
 * When it is switched on (config/flags deltaUse for everyone, or localStorage deltaUse = '1' on one device; deltaUse = '0' turns
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
    return localStorage.getItem('deltaFlagLast') === '1';
  } catch (e) { return false; }
}
/** Keep the switch's last answer for the next page load (the page reads config/flags once; core/history.js passes it on). */
function deltaSaveFlag(on) {
  try { if (on) localStorage.setItem('deltaFlagLast', '1'); else localStorage.removeItem('deltaFlagLast'); } catch (e) { /* no storage: stays off */ }
}
/** One page session in ten (after go-live) takes today's full path and runs the shadow, so the copy keeps being proved.
 *  Not on a device that chose deltaUse = '1' for itself. Decided once per page session. */
function deltaSampleFull() {
  try { if (localStorage.getItem('deltaUse') === '1') return false; } catch (e) { /* the share decides */ }
  if (DELTA.sample === null) DELTA.sample = Math.random() < DELTA.sampleRate;
  return DELTA.sample;
}
/** Is this page session reading from the copy? Asked at use, never at file load (the vendor check is not ready then). */
const deltaLiveOn = () => deltaUseOn() && !deltaSampleFull();
const deltaClone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** A live copy for a gate register built from the copy, or null to let core/live-copies.js do it the full way. */
function deltaLiveOpen(node) {
  try {
    if (!PT_SYNC_NODES.has(node) || !AUDIT.on || !deltaLiveOn()) return null;
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
  const gen = DELTA.gen;
  const idb = await deltaIdbOpen();
  const copy = await deltaCopyGet(idb, node);
  const now = await deltaServerNow();
  if (L.closed) return false;
  let why = '';
  if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') why = 'no copy';
  else if (typeof copy.fullAt !== 'number') why = 'no full download time';
  else if (now - copy.mark > DELTA.maxAgeMs || now - copy.fullAt > DELTA.maxAgeMs) why = 'copy older than a day';   // a delta open never moves fullAt
  if (why) return deltaLiveFull(L, node, why, idb);
  const keyCheck = now - (copy.keysAt || 0) > DELTA.keyCheckMs;
  const res = await deltaRebuild(node, copy, keyCheck, 'delta');
  if (L.closed) return false;
  if (!res.R) return deltaLiveFull(L, node, res.info.mode, idb);
  if (res.info.addedOutside || res.info.removedOutside) return deltaLiveFull(L, node, 'rows added or removed outside the app', idb);
  const val = res.R, seen = Object.assign({}, res.synced), want = {};
  L.snap = { val: () => deltaClone(val) };
  L.evSeq = ++PT_LIVE_SEQ;
  L.delta = 'delta';
  if (gen === DELTA.gen) deltaCopyPut(idb, node, { uid, mark: now - DELTA.marginMs, v: val, at: Date.now(), keysAt: keyCheck ? now : (copy.keysAt || 0), fullAt: copy.fullAt }).catch(() => {});
  /* Every later save anywhere: its pt_sync line arrives here, and that one row is read. */
  const onKey = sn => {
    const k = sn.key, ts = Number(sn.val()) || 0;
    try { if (typeof dmCount === 'function') dmCount('pt_sync/' + node, JSON.stringify(k).length + String(ts).length + 2, 'delta-notes'); } catch (e) { /* only a count */ }
    if (L.closed || L.delta !== 'delta' || (seen[k] && seen[k] >= ts)) return;
    seen[k] = ts;
    const my = (want[k] || 0) + 1; want[k] = my;
    deltaRead(node + '/' + k, '', 'delta').then(x => {
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
  const uid = auth.currentUser.uid, gen = DELTA.gen;
  const { m, db } = await ptLiveDb();
  const mark = (await deltaServerNow()) - DELTA.marginMs;     // taken BEFORE the read, so nothing after it is missed
  return new Promise(res => {
    let first = true;
    L.offs.push(m.onValue(m.ref(db, node), sn => {
      L.snap = sn; L.evSeq = ++PT_LIVE_SEQ;
      if (!first) return;
      first = false; res(true);
      /* the only place a copy gets its full-download time (the shadow's full save is the other) */
      (idb ? Promise.resolve(idb) : deltaIdbOpen())
        .then(d => (gen === DELTA.gen ? deltaCopyPut(d, node, { uid, mark, v: sn.val() || {}, at: Date.now(), keysAt: mark + DELTA.marginMs, fullAt: mark + DELTA.marginMs }) : null))
        .catch(() => {});
      deltaLog({ at: new Date().toISOString(), by: deltaWho(), use: node, mode: 'full', why });
    }, () => { L.dead = true; L.snap = null; res(false); }));
  });
}
/* ==== END DELTA SYNC PHASE 3 ==== */
