/* THE EMERGENCY OFF for her new features (Ravi, 3 Nov) — the bridge's own code, run here with MEERA_V2_ON = true:
 *   node meera/tests/v2-off.cjs
 * 1. her router says on → the seven are on, meera.js is fetched;
 * 2. her router says off → the seven are off at once, meera.js is NOT fetched, and the next page starts off already
 *    (remembered in the browser) — Meera as before;
 * 3. on again → back on at the next page;
 * 4. her router out of reach → as the ERP sets it (on), never stuck;
 * 5. a tester's own ?meera=… still wins; server search and autobank never come on. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'Replenish-App/src/app/core/meera-bridge.js'), 'utf8').replace(/const MEERA_V2_ON = (true|false);/, 'const MEERA_V2_ON = true;');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const store = new Map();
async function page({ flags, search = '' }) {
  const scripts = [];
  const ctx = {
    console, Promise, URLSearchParams, JSON, Math, Date, Array, Object, String, Number, Boolean, Set, Map, Error,
    location: { search }, setTimeout: (f) => f(), requestIdleCallback: f => f(),
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    fetch: async u => { if (String(u).endsWith('/flags')) { if (flags === 'down') throw new Error('down'); return { ok: true, json: async () => ({ v2: flags }) }; } return { ok: false, json: async () => null }; },
    document: { readyState: 'complete', createElement: () => ({}), head: { appendChild: s => scripts.push(s.src) }, addEventListener() {} },
    addEventListener() {}, ME: null, TAB_NOW: '', PTE: { emp: [] },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n;globalThis.__on = n => meeraOn(n); globalThis.__load = () => meeraLoadFile(); globalThis.__flags = MEERA_FLAGS;', ctx);
  const startedOff = !ctx.__on('lazy');   // what the page decided as it opened (in-page Meera if off)
  await ctx.__flags;
  ctx.__load(); await ctx.__flags; await new Promise(r => setImmediate(r));
  const seven = ['lazy', 'spell', 'design', 'learn', 'screenfirst', 'hindinames', 'data'].map(n => ctx.__on(n));
  return { startedOff, seven, fetched: scripts.filter(s => /meera/.test(String(s))).length > 0, other: ['server', 'serveruse', 'autobank'].map(n => ctx.__on(n)) };
}
(async () => {
  let r = await page({ flags: true });
  ok(r.seven.every(Boolean) && r.fetched && !r.startedOff, '1. router on: all seven on, meera.js fetched');
  r = await page({ flags: false });
  ok(r.seven.every(x => !x) && !r.fetched, '2. router off: all seven off at once, meera.js not fetched');
  r = await page({ flags: false });
  ok(r.startedOff && r.seven.every(x => !x), '2. the next page opens with them off already (Meera as before)');
  r = await page({ flags: true });
  ok(r.seven.every(Boolean) && r.fetched, '3. on again: back on');
  store.set('meera.v2off', '1'); r = await page({ flags: 'down' });
  ok(r.seven.every(x => !x), '4. router out of reach after an off: stays off (remembered)');
  store.clear(); r = await page({ flags: 'down' });
  ok(r.seven.every(Boolean), '4. router out of reach, never told off: as the ERP sets it — on');
  store.set('meera.v2off', '1'); r = await page({ flags: false, search: '?meera=spell' });
  ok(r.seven[1] === true && r.seven[0] === false, '5. a tester\'s own ?meera=spell still works');
  ok(r.other.every(x => !x), '5. server search and autobank never come on');
  console.log(`v2-off: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
