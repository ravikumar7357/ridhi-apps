/* DELTA SYNC, phase 2 — the shadow (core/delta-sync.js) against a fake database, a fake IndexedDB and a fake live copy.
 *   node tests/delta-test.js            (DELTA_SRC=<file> to test another copy — teeth/teeth-delta.js does)
 * What must hold: it rebuilds the same data the full read has; it finds every change made without a pt_sync line;
 * it never writes anywhere but pt_syncAudit; it never downloads a whole register; nothing it does can throw.
 * Step 4d/4e/4f: a mismatch is explained (field diff, note, upFor), a copy is saved only after 60 s connected, the copy
 * carries fullAt, and a wipe deletes it. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.DELTA_SRC || path.join(__dirname, '..', 'src', 'app', 'core', 'delta-sync.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

function world(opts) {
  opts = opts || {};
  const S = {
    pt_orderBook: { a: { sku: 'A', qty: 1 }, b: { sku: 'B', qty: 2 }, d: { sku: 'D', qty: 4 } },
    pt_masterDB: { m1: { sku: 'M1', color: 'Red' } },
    pt_sync: { pt_orderBook: {}, pt_masterDB: {}, _reset: {} },
  };
  const calls = [], logs = [], meter = [], ls = Object.assign({}, opts.ls);
  const at = p => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), S);
  const fetch = async (url, init) => {
    init = init || {};
    const u = new URL(url), p = decodeURIComponent(u.pathname.replace(/^\//, '').replace(/\.json$/, ''));
    calls.push({ method: init.method || 'GET', path: p, query: u.search, body: init.body ? JSON.parse(init.body) : undefined });
    if (opts.netFails && p.indexOf('pt_sync') === 0) throw new Error('Failed to fetch');
    if (init.method && init.method !== 'GET') return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    let v = at(p);
    if (u.searchParams.get('shallow') === 'true' && v && typeof v === 'object') v = Object.fromEntries(Object.keys(v).map(k => [k, true]));
    const start = u.searchParams.get('startAt');
    if (start != null && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([, x]) => Number(x) >= Number(start)));
    const t = JSON.stringify(v === undefined ? null : v);
    return { ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) };
  };
  /* A fake IndexedDB: enough of open / transaction / objectStore / get / put. */
  const store = opts.store || new Map();
  const indexedDB = { open: () => {
    const req = {};
    const db = { objectStoreNames: { contains: () => true }, createObjectStore: () => {}, close: () => {},
      transaction: () => { if (opts.putFails) { const tx = {}; setTimeout(() => tx.onerror && tx.onerror(), 0); tx.objectStore = () => ({ get: k => { setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return { result: clone(store.get(k)) }; }, put: () => ({}) }); return tx; } const tx = {}; const st = {
        get: k => { const q = { result: clone(store.get(k)) }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return q; },
        put: (v, k) => { store.set(k, clone(v)); const q = { result: k }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return q; } };
        tx.objectStore = () => st; return tx; } };
    setTimeout(() => { req.result = db; req.onsuccess && req.onsuccess(); }, 0);
    return req; },
    deleteDatabase: () => { const req = {}; if (opts.hangWipe) return req; if (!opts.keepOnWipe) store.clear(); setTimeout(() => req.onsuccess && req.onsuccess(), 0); return req; } };
  const PT_LIVE = new Map(['pt_orderBook', 'pt_masterDB'].map(n => [n, { dead: false, wroteSeq: 0, evSeq: 1, snap: { val: () => clone(S[n]) } }]));
  const ctx = {
    fetch, indexedDB, PT_URL: 'https://db', ptAuthQuery: async () => '?auth=t', ptPath: p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/'),
    PT_SYNC_NODES: new Set(['pt_orderBook', 'pt_masterDB']), PT_LIVE, PT_LIVE_UP: true, PT_LIVE_UID: opts.uid || 'u1', PT_LIVE_NO: { none: true }, PT_LIVE_SETTLE_MS: 5000,
    ptLiveDb: async () => ({ m: { ref: (d, p) => ({ path: p }), onValue: (r, cb) => { setTimeout(() => cb({ val: () => (r.path === '.info/connected' ? true : 0) }), 0); return () => {}; } }, db: {} }),
    auth: { currentUser: { uid: opts.uid || 'u1' } }, ME: { email: 'x@y' }, AUDIT: { on: !opts.auditOff },
    spIsVendor: () => !!opts.vendor, auditId: () => Math.random().toString(36).slice(2),
    ptAuditWrite: async u => { logs.push(u); return true; },
    localStorage: { getItem: k => (opts.off && k === 'deltaShadowOff' ? '1' : k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } }, setTimeout,
    dmCount: (p, n, how) => meter.push({ p, n, how }),
  };
  const fn = new Function(...Object.keys(ctx), SRC + '\n;return { DELTA, deltaShadowRun, deltaShadowSoon, deltaWipe, deltaSignedIn, deltaNetWatch };');
  const api = fn(...Object.values(ctx));
  api.DELTA.delayMs = 0;
  api.DELTA.minUpMs = opts.minUp || 0;     // the 60 s rule is tested apart, below
  if (!opts.keepSwitch) api.DELTA.on = true;   // the shipped switch is tested apart, below
  const lastLog = () => { const l = logs[logs.length - 1]; return l ? Object.values(l)[0] : null; };
  return Object.assign(api, { S, calls, logs, store, lastLog, meter, ls, sync: (node, k) => { S.pt_sync[node][k] = Date.now(); } });
}
const wait = ms => new Promise(r => setTimeout(r, ms || 20));

(async () => {
  console.log('== the first open: no copy yet ==');
  let W = world();
  await W.deltaShadowRun();
  let L = W.lastLog();
  ok('says there was no copy', L && L.nodes.pt_orderBook.mode === 'nocopy', JSON.stringify(L));
  ok('…and keeps today\'s as the copy, with a server-time mark', W.store.get('pt_orderBook') && typeof W.store.get('pt_orderBook').mark === 'number'
    && JSON.stringify(W.store.get('pt_orderBook').v) === JSON.stringify(W.S.pt_orderBook));
  ok('the full size is measured from the live copy', L.nodes.pt_orderBook.full === JSON.stringify(W.S.pt_orderBook).length);

  console.log('== saves made through the app (each with its pt_sync line) ==');
  const store = W.store;
  W = world({ store });
  W.S.pt_orderBook.a.qty = 9; W.sync('pt_orderBook', 'a');           // changed
  delete W.S.pt_orderBook.b; W.sync('pt_orderBook', 'b');             // deleted
  W.S.pt_orderBook.c = { sku: 'C', qty: 3 }; W.sync('pt_orderBook', 'c'); // added
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('three rows changed', L.mode === 'delta' && L.changed === 3, JSON.stringify(L));
  ok('the rebuilt copy is exactly the full read', L.mismatch === 0 && L.race === 0, JSON.stringify(L));
  ok('nothing added or removed outside the app', L.addedOutside === 0 && L.removedOutside === 0);
  ok('the bytes are counted', L.bytes > 0);
  ok('an untouched register reads as no change', W.lastLog().nodes.pt_masterDB.changed === 0 && W.lastLog().nodes.pt_masterDB.mismatch === 0);

  console.log('== a change that wrote no pt_sync line (an old tab, a script) ==');
  W = world({ store });
  W.S.pt_orderBook = clone(W.store.get('pt_orderBook').v);
  W.S.pt_orderBook.d.qty = 40;                                       // edited, no line
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('the edit is caught as a mismatch, by key', L.mismatch === 1 && L.sample.includes('d'), JSON.stringify(L));
  W = world({ store });
  W.S.pt_orderBook = clone(W.store.get('pt_orderBook').v);
  W.S.pt_orderBook.e = { sku: 'E' };                                 // added, no line
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('a row added outside is caught by the key check', L.addedOutside === 1 && L.mismatch === 1, JSON.stringify(L));
  W = world({ store });
  W.S.pt_orderBook = clone(W.store.get('pt_orderBook').v);
  delete W.S.pt_orderBook.a;                                         // removed, no line
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('a row removed outside is caught by the key check', L.removedOutside === 1 && L.mismatch === 1, JSON.stringify(L));

  console.log('== the edges ==');
  W = world({ store });
  W.S.pt_orderBook = clone(W.store.get('pt_orderBook').v);
  for (let i = 0; i < 301; i++) W.S.pt_sync.pt_orderBook['k' + i] = Date.now();
  await W.deltaShadowRun();
  ok('over 300 changed rows is "too many", not 301 reads', W.lastLog().nodes.pt_orderBook.mode === 'toomany'
    && W.calls.filter(c => c.path.indexOf('pt_orderBook/k') === 0).length === 0);
  W = world({ store });
  W.S.pt_sync._reset.pt_orderBook = Date.now();
  await W.deltaShadowRun();
  ok('a whole-register write since the copy is a reset', W.lastLog().nodes.pt_orderBook.mode === 'reset');
  W = world({ store, uid: 'someone-else' });
  await W.deltaShadowRun();
  ok('a copy made under another account is not used', W.lastLog().nodes.pt_orderBook.mode === 'nocopy');
  W = world({ store, uid: 'someone-else', netFails: true });   // the copy the run above left is this account's
  let err = null;
  try { await W.deltaShadowRun(); } catch (e) { err = e; }
  ok('a network failure never throws', !err, err && err.message);
  ok('…it is logged per register, and the run still finishes', /error/.test(W.lastLog().nodes.pt_orderBook.mode || '') && typeof W.lastLog().ms === 'number');

  console.log('== what it must never do ==');
  W = world({ store: new Map(store) });
  W.S.pt_orderBook.a.qty = 7; W.sync('pt_orderBook', 'a');
  await W.deltaShadowRun();
  const writes = W.calls.filter(c => c.method !== 'GET');
  ok('it writes nothing through fetch (its one line goes through ptAuditWrite)', writes.length === 0, JSON.stringify(writes));
  ok('…and that line is only ever under pt_syncAudit', W.logs.length > 0 && W.logs.every(l => Object.keys(l).every(k => /^pt_syncAudit\/\d{4}-\d{2}-\d{2}\/[^/]+$/.test(k))));
  const fullReads = W.calls.filter(c => (c.path === 'pt_orderBook' || c.path === 'pt_masterDB') && c.query.indexOf('shallow=true') < 0);
  ok('it never downloads a whole register', fullReads.length === 0, JSON.stringify(fullReads));
  ok('the live copy it compares against is left as it was', JSON.stringify(W.S.pt_orderBook.a) === JSON.stringify({ sku: 'A', qty: 7 }));

  console.log('== when it runs at all ==');
  W = world(); W.deltaShadowSoon(); W.deltaShadowSoon(); await wait(400);
  ok('once a page session, however often the registers load', W.logs.length === 1, String(W.logs.length));
  W = world({ keepSwitch: true }); W.deltaShadowSoon(); await wait(40);
  ok('while the switch is off (as shipped until the coverage check), it never runs', W.DELTA.on === true || W.logs.length === 0);
  W = world({ auditOff: true }); W.deltaShadowSoon(); await wait(40);
  ok('never in the test harnesses (AUDIT_OFF)', W.logs.length === 0);
  W = world({ vendor: true }); W.deltaShadowSoon(); await wait(40);
  ok('never for a vendor', W.logs.length === 0);
  W = world({ off: true }); W.deltaShadowSoon(); await wait(40);
  ok('off with localStorage deltaShadowOff', W.logs.length === 0);

  console.log('== 4d: a mismatch is explained ==');
  const seed = new Map(); await world({ store: seed }).deltaShadowRun();       // this account's copy of the three rows
  W = world({ store: new Map(seed) });
  W.S.pt_orderBook = clone(seed.get('pt_orderBook').v);
  W.S.pt_orderBook.d.qty = 40;                                       // edited, no line
  W.S.pt_orderBook.a.sku = 'x'.repeat(100);                          // edited, no line, a long value
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('the diff names the row, field, type and both sides', /d\.qty number\/number "4" vs "40"/.test(L.diff), L.diff);
  ok('…cuts a long value to 40 characters', L.diff.includes('"' + 'x'.repeat(40) + '"') && !L.diff.includes('x'.repeat(41)), L.diff);
  ok('…says there was no change line', /no note/.test(L.diff), L.diff);
  ok('upFor is logged in seconds', typeof L.upFor === 'number', JSON.stringify(L));
  W = world({ store: new Map(seed) });
  W.S.pt_orderBook = clone(seed.get('pt_orderBook').v);
  W.S.pt_orderBook.d.qty = 40;
  W.S.pt_sync.pt_orderBook.d = Date.now() - 10 * 60 * 1000;          // a change line, but from BEFORE the copy
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('a row with an older change line shows it against the copy\'s time', /note -\d+s vs copy/.test(L.diff), L.diff);
  W = world({ store: new Map(seed) });
  W.S.pt_orderBook = {}; for (let i = 0; i < 30; i++) W.S.pt_orderBook['r' + i] = { f: 'y'.repeat(300) + i };
  W.store.set('pt_orderBook', Object.assign(clone(W.store.get('pt_orderBook')), { v: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['r' + i, { f: 'z' + i }])) }));
  await W.deltaShadowRun();
  L = W.lastLog().nodes.pt_orderBook;
  ok('at most 3 rows are explained, within 600 characters', L.diff.split(' ;; ').length <= 3 && L.diff.length <= 600, String(L.diff.length));
  ok('bad rows past the first 20 are reported as unchecked, and still counted', L.unchecked === 10 && L.mismatch === 30, JSON.stringify({ u: L.unchecked, m: L.mismatch }));
  ok('a run with no mismatch carries no diff', (W = world({ store: new Map(store) }), await W.deltaShadowRun(), W.lastLog().nodes.pt_masterDB.diff === undefined));

  console.log('== 4d: a copy is saved only after 60 s connected ==');
  const fresh = () => { const st = new Map(); const w = world({ store: st }); return { st, w }; };
  let F1 = fresh(); await F1.w.deltaShadowRun();                       // a first copy, minimum 0
  const old = clone(F1.st.get('pt_orderBook'));
  W = world({ store: F1.st, minUp: 60000 });
  W.S.pt_orderBook.a.qty = 77; W.sync('pt_orderBook', 'a');           // the live register moved on
  W.DELTA.upAt = Date.now() - 5000;                                   // the connection came back 5 s ago
  await W.deltaShadowRun();
  ok('connected for only 5 s: the old copy is kept', JSON.stringify(W.store.get('pt_orderBook')) === JSON.stringify(old), JSON.stringify(W.store.get('pt_orderBook')).slice(0, 120));
  ok('…and the run says so, with upFor', W.lastLog().nodes.pt_orderBook.kept === 'old copy kept' && W.lastLog().nodes.pt_orderBook.upFor === 5, JSON.stringify(W.lastLog().nodes.pt_orderBook));
  W = world({ store: F1.st, minUp: 60000 });
  W.DELTA.upAt = Date.now() - 70000;
  await W.deltaShadowRun();
  ok('connected for 70 s: the copy is replaced', W.store.get('pt_orderBook').at > old.at || W.store.get('pt_orderBook').mark > old.mark);
  ok('…and carries its full-download time', typeof W.store.get('pt_orderBook').fullAt === 'number');
  W = world({ minUp: 60000 }); W.deltaShadowSoon(); W.deltaShadowSoon(); await wait(60);
  ok('its own connection listener starts the clock', typeof W.DELTA.upAt === 'number' && W.DELTA.netOn === true);
  ok('the first run waits for the minimum before it starts', W.logs.length === 0);

  console.log('== 4d: reads are metered as delta-shadow ==');
  W = world({ store: new Map(seed) });
  W.S.pt_orderBook.a.qty = 5; W.sync('pt_orderBook', 'a');
  await W.deltaShadowRun();
  ok('every read the shadow makes is counted as delta-shadow', W.meter.length > 0 && W.meter.every(x => x.how === 'delta-shadow'), JSON.stringify(W.meter.slice(0, 3)));

  console.log('== 4f: the copy can be wiped, and a cleared or full store means a full download ==');
  W = world({ store: new Map(store) });
  ok('there is a copy to wipe', W.store.size > 0);
  await W.deltaWipe('signed out on a shared computer'); await W.deltaWipe('signed out on a shared computer');
  ok('a wipe deletes the whole copy', W.store.size === 0);
  ok('…and logs its reason once', W.logs.filter(l => Object.values(l)[0].wipe === 'signed out on a shared computer').length === 1, JSON.stringify(W.logs));
  W = world({ store: new Map(store) });
  W.DELTA.upAt = Date.now() - 70000;
  const running = W.deltaShadowRun(); await W.deltaWipe('x'); await running;
  ok('a run under way when the copy is wiped does not write one back', W.store.size === 0, String(W.store.size));
  W = world({ store: new Map(store) });
  await W.deltaSignedIn('Ravi@x.com');
  ok('a copy with no known owner is deleted at sign-in', W.store.size === 0);
  W = world({ store: new Map(store), ls: { deltaOwner: 'ravi@x.com' } });
  await W.deltaSignedIn('RAVI@x.com');
  ok('the same person signing in again keeps it', W.store.size > 0);
  await W.deltaSignedIn('other@x.com');
  ok('another person signing in deletes it, and becomes the owner', W.store.size === 0 && W.ls.deltaOwner === 'other@x.com');
  W = world({ store: new Map(store), hangWipe: true });
  const tw = Date.now(); const got = await W.deltaWipe('hung');
  ok('a delete that never answers still lets the caller carry on (within the timeout)', got === false && Date.now() - tw < 3600, String(Date.now() - tw));
  W = world({ putFails: true });
  err = null; try { await W.deltaShadowRun(); } catch (e) { err = e; }
  ok('a full or refused store never throws; the run is logged', !err && /error/.test(W.lastLog().nodes.pt_orderBook.mode), JSON.stringify(W.lastLog() && W.lastLog().nodes.pt_orderBook));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
