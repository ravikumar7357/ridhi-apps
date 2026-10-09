/* DELTA SYNC, phase 1 — the change register written after every save (core/history.js: ptSyncPaths / ptSyncNote).
 *   node tests/sync-test.js
 * Loads the real history.js with a fake network, so what goes over the wire is what is checked. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.SYNC_SRC || path.join(__dirname, '..', 'src', 'app', 'core', 'history.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

function load(opts) {
  opts = opts || {};
  const calls = [];
  const fetch = async (url, init) => {
    init = init || {};
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method || 'GET', body });
    const isSync = body && Object.keys(body).some(k => k.indexOf('pt_sync/') === 0);
    if (isSync && opts.syncFails) return { ok: false, status: 403, json: async () => ({}) };
    if (opts.saveFails && !isSync && (init.method === 'PUT' || init.method === 'PATCH' || init.method === 'DELETE'))
      return { ok: false, status: 500, statusText: 'boom', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (init.method ? body === undefined ? null : body : null) };
  };
  const ctx = {
    fetch, PT_URL: 'https://db', ptAuthQuery: async () => '?auth=t', ptLiveWrote: () => {}, ptPath: p => String(p),
    BASE: { on: false }, baseEnsureWhere: async () => {}, baseRoutePath: () => null, baseRouteUpdates: u => ({ updates: u, months: [] }),
    baseForget: async () => {}, ME: { email: 'a@b', admin: true }, TAB_NOW: 'ord', nf: String, esc: String, $: () => ({}), dToday: () => '2026-10-09',
  };
  if (opts.auditOff) ctx.AUDIT_OFF = true;
  const fn = new Function(...Object.keys(ctx), SRC + '\n;return { ptSyncPaths, ptSyncNote, ptPut, ptPatch, ptDelete, AUDIT };');
  return Object.assign(fn(...Object.values(ctx)), { calls });
}
const tick = () => new Promise(r => setTimeout(r, 5));
const SV = { '.sv': 'timestamp' };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log('== which lines a path makes ==');
  let A = load();
  ok('a row', eq(A.ptSyncPaths(['pt_orderBook/ob_1']), { 'pt_sync/pt_orderBook/ob_1': SV }));
  ok('a field inside a row names the row', eq(A.ptSyncPaths(['pt_orderBook/ob_1/qty']), { 'pt_sync/pt_orderBook/ob_1': SV }));
  ok('a whole register is a reset', eq(A.ptSyncPaths(['pt_masters']), { 'pt_sync/_reset/pt_masters': SV }));
  ok('a list inside pt_masters is that row', eq(A.ptSyncPaths(['pt_masters/recipe/x/y']), { 'pt_sync/pt_masters/recipe': SV }));
  ok('a register outside the gates is not noted', eq(A.ptSyncPaths(['pt_salesOrders/so_1', 'pt_audit/2026-10/x', 'pt_baseData/b1']), {}));
  ok('two writes to one row are one line', eq(A.ptSyncPaths(['pt_cuttingData/c1/qty', 'pt_cuttingData/c1/sku']), { 'pt_sync/pt_cuttingData/c1': SV }));
  ok('a %-encoded key from a URL path is the decoded key', eq(A.ptSyncPaths(['pt_masterDB/mdb_A%2CB'], true), { 'pt_sync/pt_masterDB/mdb_A,B': SV }));
  ok('…but a ptPatch key is taken as it is', eq(A.ptSyncPaths(['pt_masterDB/mdb_A%2CB'], false), { 'pt_sync/pt_masterDB/mdb_A%2CB': SV }));
  ok('a key the database could not hold makes no line', eq(A.ptSyncPaths(['pt_orderBook/a.b', 'pt_orderBook/x$y']), {}));
  ok('leading and doubled slashes are ignored', eq(A.ptSyncPaths(['/pt_shopProd//s1/']), { 'pt_sync/pt_shopProd/s1': SV }));
  ok('every one of the eight registers is noted', ['pt_orderBook', 'pt_masterDB', 'pt_cuttingData', 'pt_pressInventory', 'pt_shopProd',
    'pt_masters', 'pt_cuttingFreezes', 'pt_qcChecks'].every(n => Object.keys(A.ptSyncPaths([n + '/k']))[0] === 'pt_sync/' + n + '/k'));
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-App', 'rules', 'build-rules.js'), 'utf8');
  const ruleList = (rules.match(/const SYNC_NODES = \[([^\]]+)\]/) || [, ''])[1].match(/pt_\w+/g) || [];
  const appList = (SRC.match(/const PT_SYNC_NODES = new Set\(\[([^\]]+)\]/) || [, ''])[1].match(/pt_\w+/g) || [];
  ok('the app and the rules name the same registers', ruleList.length === 8 && eq(ruleList.slice().sort(), appList.slice().sort()), ruleList.join(','));

  console.log('== after a save ==');
  A = load();
  await A.ptPatch({ 'pt_orderBook/ob_1/qty': 3, 'pt_salesOrders/s/x': 1 });
  await tick();
  const syncCalls = A.calls.filter(c => c.body && Object.keys(c.body).some(k => k.startsWith('pt_sync/')));
  ok('ptPatch notes the row it changed', syncCalls.length === 1 && eq(syncCalls[0].body, { 'pt_sync/pt_orderBook/ob_1': SV }), JSON.stringify(syncCalls.map(c => c.body)));
  ok('…as a root PATCH, after the save itself', syncCalls[0].method === 'PATCH' && syncCalls[0].url.indexOf('https://db/.json') === 0
    && A.calls.indexOf(syncCalls[0]) > A.calls.findIndex(c => c.body && c.body['pt_orderBook/ob_1/qty'] === 3));
  ok('the register line is never mixed into the save', A.calls.filter(c => c.body && c.body['pt_orderBook/ob_1/qty'] === 3).every(c => !Object.keys(c.body).some(k => k.startsWith('pt_sync/'))));

  A = load();
  await A.ptPut('pt_masterDB/mdb_X', { sku: 'X' });
  await tick();
  ok('ptPut notes the row', A.calls.some(c => c.body && eq(c.body, { 'pt_sync/pt_masterDB/mdb_X': SV })));
  ok('…and the row written is exactly what was asked (no field added)', A.calls.some(c => c.method === 'PUT' && eq(c.body, { sku: 'X' })));

  A = load();
  await A.ptDelete('pt_pressInventory/p9');
  await tick();
  ok('ptDelete notes the row', A.calls.some(c => c.body && eq(c.body, { 'pt_sync/pt_pressInventory/p9': SV })));

  A = load();
  await A.ptPatch({ 'pt_salesOrders/s/x': 1 });
  await tick();
  ok('a save outside the eight writes no line', !A.calls.some(c => c.body && Object.keys(c.body).some(k => k.startsWith('pt_sync/'))));

  console.log('== it can never break a save ==');
  A = load({ syncFails: true });
  let err = null;
  try { await A.ptPatch({ 'pt_orderBook/ob_1/qty': 3 }); await A.ptPut('pt_orderBook/ob_2', { qty: 1 }); await A.ptDelete('pt_orderBook/ob_3'); await tick(); }
  catch (e) { err = e; }
  ok('a refused register write does not fail the save', !err, err && err.message);
  const unhandled = [];
  process.on('unhandledRejection', e => unhandled.push(e));
  await tick(); await tick();
  ok('…and leaves no unhandled rejection behind', !unhandled.length);

  A = load({ saveFails: true });
  err = null;
  try { await A.ptPatch({ 'pt_orderBook/ob_1/qty': 3 }); } catch (e) { err = e; }
  await tick();
  ok('a save that fails still fails', !!err);
  ok('…and notes nothing, because nothing changed', !A.calls.some(c => c.body && Object.keys(c.body).some(k => k.startsWith('pt_sync/'))));

  A = load({ auditOff: true });
  await A.ptPatch({ 'pt_orderBook/ob_1/qty': 3 });
  await tick();
  ok('the test harnesses (AUDIT_OFF) see only the save itself', A.calls.length === 1, String(A.calls.length));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
