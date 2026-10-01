/* LIVE COPIES OF THE REGISTERS — the block cut out of the page and run against a fake database listener and a
 * counting fetch. Ravi, 2026-09-27: "storage ka problrm sahi kro" — the free plan's 10 GB a month of download had
 * gone to 19.4 GB because every screen re-read whole registers. Run: node tests/live-test.js */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('/* ==== LIVE COPIES OF THE REGISTERS ===='), z = src.indexOf('/* ==== END LIVE COPIES ==== */');
if (a < 0 || z < 0) throw new Error('the live-copy block is not in the page');
const gi = src.indexOf('async function ptGet(node'), ge = src.indexOf('\n}', gi) + 2;
if (gi < 0) throw new Error('ptGet is not in the page where the test expects');
const cut = name => { const i = src.indexOf('async function ' + name + '('); return src.slice(i, src.indexOf('\n}', i) + 2); };
const URL_ = "import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js')";
if (src.slice(a, z).indexOf(URL_) < 0) throw new Error('the database library is not loaded where the test expects');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* the fake database: one listener per path; the test pushes values and cancels */
const L = {}, NET = [];
const fake = {
  getDatabase: () => ({}), ref: (_db, p) => p,
  onValue: (p, ok_, bad) => { (L[p] = L[p] || []).push({ ok_, bad }); return () => { L[p] = []; }; },
};
const push = (p, v) => (L[p] || []).forEach(x => x.ok_({ val: () => JSON.parse(JSON.stringify(v)) }));
const refuse = p => (L[p] || []).forEach(x => x.bad(new Error('permission_denied')));
const STORE = { pt_orderBook: { a: { sku: 'A', qty: 1 } }, pt_masterDB: { m: { sku: 'M' } } };
const fetch = async (u, o) => { NET.push(((o && o.method) || 'GET') + ' ' + u); const m = u.match(/\.app\/([^?]*)\.json/);
  return { ok: true, status: 200, json: async () => (m && STORE[m[1]] !== undefined ? JSON.parse(JSON.stringify(STORE[m[1]])) : null) }; };
const code = src.slice(a, z).replace(URL_, 'Promise.resolve(FAKE)') + '\n' + src.slice(gi, ge) + '\n' + cut('ptPut') + '\n' + cut('ptPatch')
  /* the history / recycle bin (2026-10-01) has its own tests in prod-test; here it does nothing */
  + '\nconst auditLog = () => {}; const auditTrash = async () => 0;'
  /* Job Work's completed section (2026-10-01) is off here; prod-test covers it. */
  + '\nconst BASE = { on: false }; const BASE_NODE = "pt_baseData"; const baseRoutePath = () => null; const baseReadAll = async () => ({});'
  + '\nconst baseEnsureWhere = async () => {}; const baseRouteUpdates = u => ({ updates: u, months: [] }); const baseForget = async () => {};';
const mk = new Function('FAKE', 'fetch', 'app', 'auth', 'spIsVendor', 'PT_URL', 'ptPath', 'ptAuthQuery', 'setTimeout',
  code + '\nreturn { ptGet, ptPut, ptPatch, ptLiveWrote, PT_LIVE, up: v => { PT_LIVE_UP = v; } };');
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  const auth = { currentUser: { uid: 'u1' } }; let vendor = false;
  const A = mk(fake, fetch, { name: 'app' }, auth, () => vendor, 'https://x.app', p => p, async () => '?auth=t', setTimeout);

  console.log('== the first read downloads the register once, over the live connection');
  const p1 = A.ptGet('pt_orderBook'); await tick(); await tick();
  push('.info/connected', true); push('pt_orderBook', STORE.pt_orderBook);
  const v1 = await p1;
  ok('it answers with the register', v1 && v1.a && v1.a.qty === 1, JSON.stringify(v1));
  ok('…and nothing went over the plain read', NET.length === 0, NET.join(' | '));

  console.log('== a screen opened again reads the copy');
  const v2 = await A.ptGet('pt_orderBook');
  ok('no download at all', NET.length === 0 && v2.a.qty === 1, NET.join(' | '));
  v2.a.qty = 999;
  ok('each read is its own object — a screen that edits what it read cannot edit the copy', (await A.ptGet('pt_orderBook')).a.qty === 1);
  push('pt_orderBook', { a: { sku: 'A', qty: 5 } });
  ok('somebody else\'s change is on the next read without asking', (await A.ptGet('pt_orderBook')).a.qty === 5 && NET.length === 0);

  console.log('== after this page writes, the register is read plainly until the change comes back');
  STORE.pt_orderBook = { a: { sku: 'A', qty: 7 } };
  await A.ptPatch({ 'pt_orderBook/a/qty': 7 });
  NET.length = 0;
  const v3 = await A.ptGet('pt_orderBook');
  ok('the read straight after "Saved" has the saved figure', v3.a.qty === 7 && NET.some(x => /GET .*pt_orderBook\.json/.test(x)), NET.join(' | '));
  push('pt_orderBook', { a: { sku: 'A', qty: 7 } }); NET.length = 0;
  ok('…and once it has come back, the copy again', (await A.ptGet('pt_orderBook')).a.qty === 7 && NET.length === 0, NET.join(' | '));
  await A.ptPut('pt_orderBook/b', { sku: 'B' }); NET.length = 0;
  await A.ptGet('pt_orderBook');
  ok('a PUT marks it too', NET.some(x => /GET .*pt_orderBook\.json/.test(x)), NET.join(' | '));
  push('pt_orderBook', STORE.pt_orderBook); NET.length = 0;
  await A.ptPatch({ 'pt_masterDB/m/x': 1 }); await A.ptGet('pt_orderBook');
  ok('a write to ANOTHER register does not', NET.filter(x => /^GET/.test(x)).length === 0, NET.join(' | '));

  console.log('== when the copy cannot be trusted, the plain read — as before');
  A.up(false); NET.length = 0;
  await A.ptGet('pt_orderBook');
  ok('connection down', NET.some(x => /GET .*pt_orderBook\.json/.test(x)));
  A.up(true); NET.length = 0;
  await A.ptGet('pt_orderBook/a');
  ok('a path below a register', NET.some(x => /GET .*pt_orderBook\/a\.json/.test(x)) && !L['pt_orderBook/a']);
  vendor = true; NET.length = 0;
  await A.ptGet('pt_masterDB');
  ok('a vendor account', NET.length === 1 && !L.pt_masterDB, NET.join(' | '));
  vendor = false;
  const p4 = A.ptGet('pt_masterDB'); await tick(); await tick(); refuse('pt_masterDB'); NET.length = 0;
  const v4 = await p4;
  ok('a refused listener falls back and still answers', v4 && v4.m && v4.m.sku === 'M' && NET.length === 1, NET.join(' | '));
  NET.length = 0; await A.ptGet('pt_masterDB');
  ok('…and stays on the plain read', NET.length === 1);

  console.log('== another account signs in on the same page');
  auth.currentUser = { uid: 'u2' }; NET.length = 0;
  const p5 = A.ptGet('pt_orderBook'); await tick(); await tick();
  ok('the first account\'s copies are closed and opened again as the new one', (L.pt_orderBook || []).length === 1, String((L.pt_orderBook || []).length));
  push('pt_orderBook', { a: { sku: 'A', qty: 42 } });
  ok('…and answer with what the new account reads', (await p5).a.qty === 42);

  console.log('== a network that blocks the live connection');
  for (const k in L) delete L[k];
  const A2 = mk(fake, fetch, { name: 'app' }, { currentUser: { uid: 'u3' } }, () => false, 'https://x.app', p => p, async () => '?auth=t',
    (f, ms) => setTimeout(f, Math.min(ms, 30)));
  NET.length = 0;
  const v6 = await A2.ptGet('pt_masterDB');
  ok('never comes up: the screen still gets its data, by the plain read', v6 && v6.m && v6.m.sku === 'M' && NET.length === 1, NET.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
