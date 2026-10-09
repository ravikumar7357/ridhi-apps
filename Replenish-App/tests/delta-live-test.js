/* DELTA SYNC, phase 3 — a gate register's live copy built from the browser's copy (core/delta-sync.js deltaLiveOpen),
 * against a fake database that both the REST reads and a fake live connection see.
 *   node tests/delta-live-test.js        (DELTA_SRC=<file> to test another copy — teeth/teeth-delta-live.js does)
 * The one rule: what a screen reads must ALWAYS equal the database — through saves, deletes, resets, outside writes
 * and failures — and whenever that cannot be promised, it must be today's way (the whole register, live). */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.DELTA_SRC || path.join(__dirname, '..', 'src', 'app', 'core', 'delta-sync.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
function sortDeep(v) { if (!v || typeof v !== 'object' || Array.isArray(v)) return v; return Object.keys(v).sort().reduce((o, k) => (o[k] = sortDeep(v[k]), o), {}); }
const wait = ms => new Promise(r => setTimeout(r, ms == null ? 30 : ms));
const DAY = 24 * 3600 * 1000;

function world(opts) {
  opts = opts || {};
  const S = opts.S || {
    pt_orderBook: { a: { sku: 'A', qty: 1 }, b: { sku: 'B', qty: 2 }, d: { sku: 'D', qty: 4 } },
    pt_sync: { pt_orderBook: {}, _reset: {} },
  };
  const at = p => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), S);
  const calls = [], logs = [], L_ = [];
  const fetch = async (url, init) => {
    init = init || {};
    const u = new URL(url), p = decodeURIComponent(u.pathname.replace(/^\//, '').replace(/\.json$/, ''));
    calls.push({ method: init.method || 'GET', path: p, query: u.search });
    if (opts.rowFails && p.startsWith('pt_orderBook/')) throw new Error('Failed to fetch');
    const d = opts.delay ? opts.delay(p) : 0;
    let v = clone(at(p));                     // read the value NOW, answer after the delay — like the network
    if (d) await wait(d);
    if (u.searchParams.get('shallow') === 'true' && v && typeof v === 'object') v = Object.fromEntries(Object.keys(v).map(k => [k, true]));
    const start = u.searchParams.get('startAt');
    if (start != null && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([, x]) => Number(x) >= Number(start)));
    const t = JSON.stringify(v === undefined ? null : v);
    return { ok: true, status: 200, text: async () => t };
  };
  /* The live connection: value / child_added / child_changed listeners on paths, with startAt on a query. */
  const snap = (p, key) => ({ key: key || p.split('/').pop(), val: () => clone(at(p)) === undefined ? null : clone(at(p)) });
  const m = {
    ref: (db, p) => ({ path: p }), orderByValue: () => ({}), startAt: v => ({ startAt: v }),
    query: (r, ...c) => ({ path: r.path, startAt: (c.find(x => x && x.startAt != null) || {}).startAt }),
    onValue: (r, cb) => { const l = { kind: 'value', path: r.path, cb }; L_.push(l); setTimeout(() => L_.includes(l) && cb(snap(r.path)), 0); return () => L_.splice(L_.indexOf(l), 1); },
    onChildAdded: (q, cb) => { const l = { kind: 'added', path: q.path, start: q.startAt, cb }; L_.push(l);
      setTimeout(() => { const o = at(q.path) || {}; Object.keys(o).forEach(k => { if (L_.includes(l) && Number(o[k]) >= (q.startAt || 0)) cb({ key: k, val: () => o[k] }); }); }, 0);
      return () => L_.splice(L_.indexOf(l), 1); },
    onChildChanged: (q, cb) => { const l = { kind: 'changed', path: q.path, start: q.startAt, cb }; L_.push(l); return () => L_.splice(L_.indexOf(l), 1); },
  };
  const fireNode = node => L_.filter(l => l.kind === 'value' && l.path === node).forEach(l => l.cb(snap(node)));
  const api = {
    /* A save through the app: the row, then (after it) its pt_sync line — as core/history.js does. */
    save(node, key, value) {
      if (value === null) delete S[node][key]; else S[node][key] = clone(value);
      fireNode(node);
      const had = key in S.pt_sync[node];
      S.pt_sync[node][key] = Date.now() + (had ? 1 : 0);
      L_.filter(l => l.path === 'pt_sync/' + node && l.kind === (had ? 'changed' : 'added') && S.pt_sync[node][key] >= (l.start || 0))
        .forEach(l => l.cb({ key, val: () => S.pt_sync[node][key] }));
    },
    outside(node, key, value) { if (value === null) delete S[node][key]; else S[node][key] = clone(value); fireNode(node); },
    reset(node) { S.pt_sync._reset[node] = Date.now(); L_.filter(l => l.path === 'pt_sync/_reset/' + node).forEach(l => l.cb(snap('pt_sync/_reset/' + node))); },
    fullListeners: node => L_.filter(l => l.kind === 'value' && l.path === node).length,
    failRows: v => { opts.rowFails = v; },
  };
  const store = opts.store || new Map();
  const indexedDB = { open: () => { const req = {}; const db = { objectStoreNames: { contains: () => true }, createObjectStore: () => {}, close: () => {},
    transaction: () => { const tx = {}; const st = {
      get: k => { const q = { result: clone(store.get(k)) }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return q; },
      put: (v, k) => { store.set(k, clone(v)); const q = { result: k }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return q; } };
      tx.objectStore = () => st; return tx; } };
    setTimeout(() => { req.result = db; req.onsuccess && req.onsuccess(); }, 0); return req; } };
  const ls = { deltaUse: opts.use === undefined ? '1' : opts.use };
  const ctx = {
    fetch, indexedDB, PT_URL: 'https://db', ptAuthQuery: async () => '?auth=t', ptPath: p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/'),
    PT_SYNC_NODES: new Set(['pt_orderBook']), PT_LIVE: new Map(), PT_LIVE_UP: true, PT_LIVE_UID: 'u1', PT_LIVE_NO: { none: true }, PT_LIVE_SETTLE_MS: 5000, PT_LIVE_SEQ: 0,
    ptLiveDb: async () => ({ m: Object.assign({}, m, { onValue: (r, cb, e) => r.path === '.info/serverTimeOffset' ? (setTimeout(() => cb({ val: () => 0 }), 0), () => {}) : m.onValue(r, cb, e) }), db: {} }),
    auth: { currentUser: { uid: opts.uid || 'u1' } }, ME: { email: 'x@y' }, AUDIT: { on: true }, spIsVendor: () => false, auditId: () => Math.random().toString(36).slice(2),
    ptAuditWrite: async u => { logs.push(Object.values(u)[0]); Object.keys(u).forEach(k => calls.push({ method: 'AUDIT', path: k })); return true; },
    localStorage: { getItem: k => (k in ls ? ls[k] : null) }, setTimeout, structuredClone: undefined,
  };
  const fn = new Function(...Object.keys(ctx), SRC + '\n;return { DELTA, deltaLiveOpen, deltaUseOn, deltaShadowSoon };');
  const D = fn(...Object.values(ctx));
  if (opts.globalUse) D.DELTA.use = true;
  return Object.assign(D, api, { S, store, calls, logs, L_, ls });
}
async function open(W) { const L = W.deltaLiveOpen('pt_orderBook'); if (!L) return null; await L.first; await wait(); return L; }

(async () => {
  console.log('== switched off, it is not there ==');
  let W = world({ use: null });
  ok('off as shipped: the register is opened today\'s way', W.deltaLiveOpen('pt_orderBook') === null);
  W = world({ use: '0', globalUse: true });
  ok('deltaUse = 0 on a device turns it off even when switched on for everyone', W.deltaLiveOpen('pt_orderBook') === null);
  W = world({ use: '1' });
  ok('deltaUse = 1 on one device turns it on there', W.deltaUseOn() === true);
  ok('a register outside the eight is never touched', W.deltaLiveOpen('pt_salesOrders') === null);

  console.log('== first open on a device: no copy, so today\'s way, and a copy is kept ==');
  W = world();
  let L = await open(W);
  ok('the whole register is listened to, as today', W.fullListeners('pt_orderBook') === 1);
  ok('the screen reads the database', same(L.snap.val(), W.S.pt_orderBook));
  ok('a copy is kept for next time', W.store.get('pt_orderBook') && same(W.store.get('pt_orderBook').v, W.S.pt_orderBook));
  ok('the log says why', W.logs.some(l => l.mode === 'full' && l.why === 'no copy'));
  const S = W.S, store = W.store;

  console.log('== the next open: the copy + what changed ==');
  W = world({ S, store });
  W.save('pt_orderBook', 'a', { sku: 'A', qty: 11 });                  // saved by someone while this device was closed
  L = await open(W);
  ok('no whole-register listener', W.fullListeners('pt_orderBook') === 0);
  ok('the screen reads exactly the database', same(L.snap.val(), W.S.pt_orderBook), JSON.stringify(L.snap.val()));
  ok('it read the changed row, not the register', W.calls.some(c => c.path === 'pt_orderBook/a') && !W.calls.some(c => c.path === 'pt_orderBook' && !/shallow/.test(c.query)));
  ok('logged as a delta open', W.logs.some(l => l.mode === 'delta' && l.changed === 1));

  console.log('== saves while it is open ==');
  W.save('pt_orderBook', 'b', { sku: 'B', qty: 20 });
  W.save('pt_orderBook', 'c', { sku: 'C', qty: 3 });
  W.save('pt_orderBook', 'd', null);
  await wait(60);
  ok('an edit, a new row and a delete all arrive', same(L.snap.val(), W.S.pt_orderBook), JSON.stringify(L.snap.val()));
  const v1 = L.snap.val(); v1.a.qty = 999; delete v1.b;
  ok('every read is a fresh object: a screen changing what it read changes nothing', same(L.snap.val(), W.S.pt_orderBook));
  const seqBefore = L.evSeq;
  W.save('pt_orderBook', 'a', { sku: 'A', qty: 12 });
  await wait(60);
  ok('each arrival moves the sequence a just-saved read waits for', L.evSeq > seqBefore);

  console.log('== two saves to one row, the first answer arriving last ==');
  let slow = true;
  W = world({ S, store, delay: p => (p === 'pt_orderBook/a' && slow ? (slow = false, 80) : 0) });
  L = await open(W);
  slow = true;
  W.save('pt_orderBook', 'a', { sku: 'A', qty: 100 });
  await wait(5);
  W.save('pt_orderBook', 'a', { sku: 'A', qty: 200 });
  await wait(150);
  ok('the newer value wins', L.snap.val().a.qty === 200, JSON.stringify(L.snap.val().a));

  console.log('== anything doubtful falls back to today\'s way ==');
  W = world({ S, store });
  L = await open(W);
  W.reset('pt_orderBook');
  W.S.pt_orderBook.z = { sku: 'Z' };                                   // what the whole-register write wrote
  await L.first; await wait(60);
  ok('a whole-register write: back to the whole register', W.fullListeners('pt_orderBook') === 1 && same(L.snap.val(), W.S.pt_orderBook));
  S.pt_sync._reset = {};                                              // the reset above is done with; the rest start clean
  const st2 = new Map(store); const c2 = clone(st2.get('pt_orderBook')); c2.mark -= 2 * DAY; st2.set('pt_orderBook', c2);
  W = world({ S, store: st2 });
  L = await open(W);
  ok('a copy older than a day: the whole register', W.fullListeners('pt_orderBook') === 1 && W.logs.some(l => l.why === 'copy older than a day'));
  W = world({ S, store: new Map(store), uid: 'someone-else' });
  L = await open(W);
  ok('another account\'s copy: the whole register', W.fullListeners('pt_orderBook') === 1 && same(L.snap.val(), W.S.pt_orderBook));
  const st3 = new Map(store); const c3 = clone(st3.get('pt_orderBook')); c3.keysAt = 0; st3.set('pt_orderBook', c3);
  W = world({ S, store: st3 });
  W.outside('pt_orderBook', 'q', { sku: 'Q' });                         // added by something that wrote no pt_sync line
  L = await open(W);
  ok('a row added outside the app (found by the daily key check): the whole register', W.fullListeners('pt_orderBook') === 1
    && same(L.snap.val(), W.S.pt_orderBook) && W.logs.some(l => /outside/.test(l.why || '')));
  W = world({ S, store: new Map(store) });
  L = await open(W);
  W.opts = null;
  const W2 = world({ S, store: new Map(store) });
  const L2 = await open(W2);
  ok('(it opened from the copy)', W2.fullListeners('pt_orderBook') === 0);
  W2.failRows(true);                                                   // the network fails only now
  W2.save('pt_orderBook', 'a', { sku: 'A', qty: 7 });
  await wait(80); await L2.first; await wait(30);
  W2.failRows(false);
  await wait(60);
  ok('a changed row that cannot be read: the whole register', W2.fullListeners('pt_orderBook') === 1 && same(L2.snap.val(), W2.S.pt_orderBook)
    && W2.logs.some(l => l.why === 'a changed row could not be read'));

  console.log('== closing, and what it must never do ==');
  W = world({ S, store: new Map(store) });
  L = W.deltaLiveOpen('pt_orderBook');
  L.off();
  await L.first; await wait(60);
  ok('closed before it finished opening: nothing left listening', W.L_.filter(l => l.path.indexOf('pt_orderBook') >= 0 || l.path.indexOf('pt_sync') === 0).length === 0, String(W.L_.length));
  W = world({ S, store: new Map(store) });
  L = await open(W);
  W.save('pt_orderBook', 'b', { sku: 'B', qty: 21 });
  await wait(60);
  ok('it never writes through fetch', !W.calls.some(c => c.method !== 'GET' && c.method !== 'AUDIT'));
  ok('its only writes are pt_syncAudit lines', W.calls.filter(c => c.method === 'AUDIT').every(c => /^pt_syncAudit\//.test(c.path)));
  ok('the shadow stays quiet while the copy is in use', (W.deltaShadowSoon(), true) && (await wait(60), !W.logs.some(l => l.nodes)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
