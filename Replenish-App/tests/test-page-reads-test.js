/* THE TEST PAGE'S READS NEVER WAIT FOR EVER (Ravi, 27 Nov 2026: PPC stayed on "Reading…" after a reload). When ERP data
 * answered "download it all again" for a list this browser held a copy of, the catch-up asked itself and never finished.
 * Runs the reading code of tests/build-test-erp.js against a made-up ERP data.
 *   node tests/test-page-reads-test.js      (BUILD_FILE=<a broken or older copy> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.BUILD_FILE ? path.resolve(process.env.BUILD_FILE) : path.join(__dirname, 'build-test-erp.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const from = src.indexOf('  /* one call to an ERP data door'), first = src.indexOf('  /* NO READ WAITS FOR EVER'), to = src.indexOf('  /* a part of a list from');
if (from < 0 || to < 0) throw new Error('the reading code of the Test page was not found');
/* the code is written inside a template, so it is read the way the build reads it */
const CODE = new Function('return `' + src.slice(first >= 0 ? first : from, to) + '`')();
const URL0 = 'https://made-up.test';

/** A page over a made-up ERP data. door(name, nth) answers each call: a body, or null for "never answers". */
function page(door, held) {
  const calls = [];
  const copies = {}; if (held) copies[URL0 + '|pt_ppc'] = held;
  const ctx = { console: { warn() {}, info() {} }, Promise, JSON, Date, Object, Array, Error, String, Math, encodeURIComponent,
    AbortController, setInterval: () => 0, clearTimeout, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)),   // a time limit passes at once
    document: { visibilityState: 'visible' }, SBSTALE: {}, window: { __TEST_ERP: { sb: { url: URL0, key: 'k' }, origFetch: null } },
    indexedDB: { open: () => { const r = {}; setTimeout(() => { r.result = { transaction: () => ({ objectStore: () => ({
      get: k => { const q = {}; setTimeout(() => { q.result = copies[k]; q.onsuccess(); }); return q; },
      put: (v, k) => { copies[k] = v; const q = {}; setTimeout(() => q.onsuccess()); return q; } }) }) }; r.onsuccess(); }); return r; } } };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nthis.__t = { sbWhole, sbRefresh };', ctx);
  const fetch = (url, opts) => {
    const name = /erp-lists\/manifest/.test(url) ? 'manifest' : /erp-lists\//.test(url) ? 'file' : url.split('/').pop();
    calls.push(name);
    const body = door(name, calls.filter(c => c === name).length);
    if (body === null) return new Promise((_, reject) => { if (opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  };
  ctx.window.__TEST_ERP.origFetch = fetch;
  return { read: () => ctx.__t.sbWhole('pt_ppc', 'tok', fetch), calls, copies };
}
const settled = p => Promise.race([p.then(v => ({ v }), e => ({ e })), new Promise(r => setTimeout(() => r({ hung: true }), 300))]).then(x => { if (x.e) x.why = String(x.e.message); return x; });
const copy = () => ({ text: '{"a":1}', upto: 5, at: Date.now() - 3600000 });
const NEW = '{"a":2}';

(async () => {
  console.log('== "download it all again" for a list this browser holds ==');
  for (const withFile of [true, false]) {
    const p = page((name, nth) => name === 'rt_changes' ? (nth === 1 ? '{"full":true}' : '{"upto":9,"ch":{}}')
      : name === 'manifest' ? (withFile ? '{"pt_ppc":{"upto":9}}' : '{}') : name === 'file' ? NEW : name === 'rt_list_upto' ? '9' : NEW, copy());
    const r = await settled(p.read());
    ok(`${withFile ? 'from the list file' : 'from the database'}: the read finishes with the new list`, r.v === NEW, JSON.stringify(r) + ' ' + p.calls.join(','));
    const again = await settled(p.read());
    ok('…and the next read of the same list finishes too', again.v === NEW, JSON.stringify(again));
  }
  { const p = page(name => name === 'rt_changes' ? '{"full":true}' : name === 'manifest' ? '{"pt_ppc":{"upto":9}}' : name === 'file' ? NEW : name === 'rt_list_upto' ? '9' : NEW, copy());
    const r = await settled(p.read());
    ok('even when ERP data keeps answering "all again", it stops after one download from the database', r.v === NEW && p.calls.filter(c => c === 'rt_get_text').length === 1, JSON.stringify(r) + (r.e ? r.e.message : "") + " " + p.calls.join(",")); }
  console.log('== an ordinary catch-up ==');
  { const p = page(() => '{"upto":9,"ch":{"b":3}}', copy());
    const r = await settled(p.read());
    ok('only the saves since are asked for and added', r.v === '{"a":1,"b":3}' && p.calls.join() === 'rt_changes', JSON.stringify(r)); }
  console.log('== ERP data that never answers ==');
  { const p = page(() => null);
    const r = await settled(p.read());
    ok('a first read gives up and says what to do', !!r.e && /did not answer within (60|120) seconds. Check the internet, then try again\./.test(r.e.message), JSON.stringify(r.hung ? r : r.e && r.e.message)); }
  { const p = page(() => null, copy());
    const r = await settled(p.read());
    ok('with a copy held, the copy is shown after the time limit', r.v === '{"a":1}', JSON.stringify(r)); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
