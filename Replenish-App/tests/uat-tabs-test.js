/* THE TEST PAGE'S CHANGES ARE ONE LIST FOR EVERY OPEN TAB (tests/uat-guard.js, the page part).
 * Ravi, 26 Nov, two-screen check: a tab did not see what another tab saved, both numbered their changes alike (one wrote over
 * the other) and a reset cleared only what its own tab knew. Two made-up tabs share one pretend browser storage here.
 *   node tests/uat-tabs-test.js      (UAT_GUARD_FILE=<a broken copy> tests that copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.UAT_GUARD_FILE || path.join(__dirname, 'uat-guard.js');
const CODE = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const settle = () => new Promise(r => setTimeout(r, 30));

/** One browser: its databases and saved settings, shared by every tab opened in it. */
function browser() {
  const stores = { changes: new Map(), points: new Map() }, settings = new Map([['uat:r1UatMode', '1']]), tabs = [];
  let queue = Promise.resolve(), slipIn = null;
  /* a transaction runs whole before the next one starts, as the browser's own do for the same stores */
  function transaction(names, mode) {
    const asked = [], tx = {
      objectStore: name => {
        const m = stores[name], key = name === 'changes' ? 'n' : 'id';
        const ask = work => { const q = {}; asked.push(() => { q.result = work(); if (q.onsuccess) q.onsuccess(); }); return q; };
        return {
          getAll: () => ask(() => [...m.values()].map(clone)),
          openCursor: (range, direction) => {
            const q = {};
            let keys = null;
            const step = i => asked.push(() => {
              if (!keys) { keys = [...m.keys()].sort(); if (direction === 'prev') keys.sort((a, b) => b - a); }
              const k = keys[i];
              q.result = k === undefined ? null : { key: k, value: clone(m.get(k)), delete: () => { m.delete(k); }, continue: () => step(i + 1) };
              if (q.onsuccess) q.onsuccess({ target: q });
            });
            step(0);
            return q;
          },
          clear: () => ask(() => { m.clear(); }),
          put: v => ask(() => { m.set(v[key], clone(v)); }),
          delete: k => ask(() => { m.delete(k); }),
        };
      },
    };
    queue = queue.then(() => new Promise(done => setImmediate(() => {
      if (slipIn && mode === 'readwrite') { slipIn(stores); slipIn = null; }
      while (asked.length) asked.shift()(); if (tx.oncomplete) tx.oncomplete(); done(); })));
    return tx;
  }
  function openTab(opts) {
    opts = opts || {};
    const listeners = [];
    function Storage() {}
    Storage.prototype.getItem = k => (settings.has(k) ? settings.get(k) : null);
    Storage.prototype.setItem = (k, v) => {
      if (opts.fullStorage && /Mark/.test(k)) throw new Error('storage is full');
      settings.set(k, String(v));
      setImmediate(() => tabs.filter(t => t.listeners !== listeners).forEach(t => t.listeners.forEach(f => f({ key: k }))));
    };
    Storage.prototype.removeItem = k => { settings.delete(k); };
    Storage.prototype.key = i => [...settings.keys()][i];
    function IDBFactory() {}
    IDBFactory.prototype.open = () => { const q = { result: { transaction } }; setImmediate(() => q.onsuccess()); return q; };
    IDBFactory.prototype.deleteDatabase = () => {};
    const nothing = () => {};
    const window = { Storage, IDBFactory, localStorage: new Storage(), open: nothing, addEventListener: (type, f) => { if (type === 'storage' && !opts.deaf) listeners.push(f); } };
    const ctx = { window, localStorage: window.localStorage, indexedDB: new IDBFactory(), navigator: {}, URL, Response, Headers,
      location: { hash: '#fgi', reload: nothing }, console: { log: console.log, warn: nothing, error: nothing }, setTimeout, clearTimeout,
      document: { addEventListener: nothing, getElementById: () => null, createElement: () => ({ style: {} }) } };
    vm.createContext(ctx);
    vm.runInContext(CODE, ctx);
    tabs.push({ listeners });
    return window.__UAT;
  }
  /** Another tab's save landing just before the next write to the kept changes runs. */
  const beforeNextWrite = f => { slipIn = f; };
  return { openTab, beforeNextWrite, kept: () => [...stores.changes.values()] };
}

const URL_OF = p => 'https://made-up.firebasedatabase.app/' + p + '.json';
const LIVE = { A: { pcs: 4 } };
const live = async () => new Response(JSON.stringify(LIVE), { status: 200 });
const save = (U, body) => U.write(URL_OF('pt_made'), 'PATCH', { body: JSON.stringify(body) }, live);
const read = async (U, init) => { const r = await U.read(URL_OF('pt_made'), init, live); return { value: await r.json(), tag: r.headers.get('ETag') }; };

(async () => {
  console.log('== a second tab sees what the first saved ==');
  {
    const b = browser(), one = b.openTab(), two = b.openTab();
    await one.ready; await two.ready;
    await save(one, { 'A/pcs': 0 });
    /* read straight away, before the browser has told the second tab anything */
    ok('the very next read in the other tab shows it', (await read(two)).value.A.pcs === 0);
    ok('the tab that saved shows it too', (await read(one)).value.A.pcs === 0);
  }
  console.log('== two tabs saving ==');
  {
    const b = browser(), one = b.openTab(), two = b.openTab();
    await one.ready; await two.ready;
    await save(one, { 'B/pcs': 1 });
    await save(two, { 'C/pcs': 2 });
    await Promise.all([save(one, { 'D/pcs': 3 }), save(two, { 'E/pcs': 4 })]);
    ok('every save is kept: none writes over another', b.kept().length === 4 && new Set(b.kept().map(c => c.n)).size === 4, JSON.stringify(b.kept().map(c => c.n + ' ' + c.p)));
    await settle();
    ok('both tabs hold all four', one.changes.length === 4 && two.changes.length === 4, one.changes.length + ' and ' + two.changes.length);
  }
  console.log('== a compare-and-set read before the other tab saved ==');
  {
    const b = browser(), one = b.openTab(), two = b.openTab();
    await one.ready; await two.ready;
    const seen = await read(two, { headers: { 'X-Firebase-ETag': 'true' } });
    await save(one, { 'A/pcs': 0 });
    const r = await two.write(URL_OF('pt_made'), 'PUT', { body: JSON.stringify({ A: { pcs: 1 } }), headers: { 'if-match': seen.tag } }, live);
    ok('is refused as changed, as the live database would', r.status === 412, 'answered ' + r.status);
  }
  console.log('== a screen that watches ==');
  {
    const b = browser(), one = b.openTab(), two = b.openTab();
    await one.ready; await two.ready;
    const shown = [];
    two.fsWatch({ id: 'doc', path: 'made/doc' }, snap => shown.push(snap.exists() ? snap.data().v : null), () => {},
      (ref, next) => { next({ exists: () => false, data: () => undefined }); return () => {}; });
    await settle();
    await one.fsKeep([{ k: 'put', p: 'fs/made/doc', v: { v: 7 } }], 'made-up save', '');
    await settle();
    ok('is redrawn by the other tab\'s save without being asked', shown[shown.length - 1] === 7, JSON.stringify(shown));
  }
  console.log('== reset ==');
  {
    const b = browser(), one = b.openTab(), two = b.openTab();
    await one.ready; await two.ready;
    await save(two, { 'A/pcs': 0 });
    await save(one, { 'B/pcs': 1 });
    await save(two, { 'C/pcs': 2 });
    await one.undoAfter(null);
    ok('"Reset everything" in one tab clears every tab\'s changes', b.kept().length === 0, b.kept().length + ' left');
    ok('the other tab then shows live again', (await read(two)).value.A.pcs === 4);
    await save(two, { 'A/pcs': 3 });
    ok('a save after a reset is seen by the tab that reset', (await read(one)).value.A.pcs === 3);
  }
  console.log('== reset before the browser has told this tab ==');
  {
    const b = browser(), one = b.openTab({ deaf: true }), two = b.openTab();
    await one.ready; await two.ready;
    await save(two, { 'A/pcs': 0 });
    await one.undoAfter(null);
    ok('clears the other tab\'s save all the same', b.kept().length === 0, b.kept().length + ' left');
  }
  console.log('== another tab saves while the reset is running ==');
  {
    const b = browser(), one = b.openTab();
    await one.ready;
    await save(one, { 'A/pcs': 0 });
    b.beforeNextWrite(s => s.changes.set(99, { n: 99, g: 'late', k: 'put', p: 'pt_made/B/pcs', v: 1, t: new Date().toISOString() }));
    await one.undoAfter(null);
    ok('"Reset everything" takes that save too', b.kept().length === 0, b.kept().length + ' left');
  }
  console.log('== undo after a time ==');
  {
    const b = browser(), one = b.openTab();
    await one.ready;
    await save(one, { 'A/pcs': 0 });
    await new Promise(r => setTimeout(r, 5));
    const cut = new Date().toISOString();
    await new Promise(r => setTimeout(r, 5));
    await save(one, { 'B/pcs': 1 });
    b.beforeNextWrite(s => s.changes.set(99, { n: 99, g: 'late', k: 'put', p: 'pt_made/C/pcs', v: 1, t: new Date().toISOString() }));
    await one.undoAfter(cut);
    ok('keeps what came before the time, drops what came after, another tab\'s late save too', b.kept().map(c => c.p).join() === 'pt_made/A/pcs', b.kept().map(c => c.p).join());
  }
  console.log('== the browser will not store the mark ==');
  {
    const b = browser(), one = b.openTab({ fullStorage: true });
    await one.ready;
    await save(one, { 'A/pcs': 2 });
    ok('the tab that saved still shows its own save', (await read(one)).value.A.pcs === 2);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
setTimeout(() => { console.error('the test did not finish'); process.exit(1); }, 20000).unref();
