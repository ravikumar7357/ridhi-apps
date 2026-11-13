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
    if (opts.mergedFails && isSync && Object.keys(body).some(k => k.indexOf('pt_sync/') !== 0)) return { ok: false, status: 403, json: async () => ({}) };
    if (isSync && opts.syncFails) return { ok: false, status: 403, json: async () => ({}) };
    if (opts.saveFails && !(isSync && Object.keys(body).every(k => k.indexOf('pt_sync/') === 0)) && (init.method === 'PUT' || init.method === 'PATCH' || init.method === 'DELETE'))
      return { ok: false, status: 500, statusText: 'boom', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (init.method ? body === undefined ? null : body : null) };
  };
  const ctx = {
    fetch, PT_URL: 'https://db', ptAuthQuery: async () => '?auth=t', ptLiveWrote: () => {}, ptPath: p => String(p),
    BASE: { on: false }, baseEnsureWhere: async () => {}, baseRoutePath: () => null, baseRouteUpdates: u => ({ updates: u, months: [] }),
    baseForget: async () => {}, ME: { email: 'a@b', admin: true }, TAB_NOW: 'ord', nf: String, esc: String, $: () => ({}), dToday: () => '2026-10-09',
  };
  if (opts.auditOff) ctx.AUDIT_OFF = true;
  /* what the alert-list hook and the live-write marker were given, to compare switch on and off */
  const hook = [], wrote = [];
  ctx.oalAfterSave = (p, v, k) => hook.push(JSON.stringify([p, v, k]));
  ctx.ptLiveWrote = ps => wrote.push(JSON.stringify(ps));
  if (opts.atomic !== undefined) ctx.localStorage = { getItem: k => (k === 'syncAtomic' ? opts.atomic : null) };
  if (opts.vendor) ctx.spIsVendor = () => true;
  const fn = new Function(...Object.keys(ctx), SRC + '\n;return { ptSyncPaths, ptSyncNote, ptPut, ptPatch, ptDelete, AUDIT };');
  return Object.assign(fn(...Object.values(ctx)), { calls, hook, wrote });
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

  console.log('== Step 4b: data and note in ONE request (switch syncAtomic) ==');
  const dataCalls = X => X.calls.filter(c => c.method !== 'GET' && !(c.body && Object.keys(c.body).every(k => /^pt_(audit|trash|sync)/.test(k))));
  const noteOnly = X => X.calls.filter(c => c.body && Object.keys(c.body).length && Object.keys(c.body).every(k => k.indexOf('pt_sync/') === 0));
  const run = async X => { await X.ptPatch({ 'pt_orderBook/ob_1/qty': 3, 'pt_orderBook/ob_1/sku': 'S' }); await X.ptPut('pt_masterDB/mdb_X', { sku: 'X' }); await X.ptDelete('pt_pressInventory/p9'); await tick(); };
  const OFF = load({ atomic: '0' }); await run(OFF);
  const ON = load({ atomic: '1' }); await run(ON);
  const DEF = load(); await run(DEF);
  ok('switch off: unchanged, data then a separate note each time', noteOnly(OFF).length === 3 && dataCalls(OFF).length === 3 && OFF.calls.some(c => c.method === 'PUT') && OFF.calls.some(c => c.method === 'DELETE'));
  ok('no switch at all behaves exactly as off', eq(DEF.calls.map(c => [c.url, c.method, c.body && Object.keys(c.body).length]), OFF.calls.map(c => [c.url, c.method, c.body && Object.keys(c.body).length])));
  ok('switch on: no separate note request', noteOnly(ON).length === 0, String(noteOnly(ON).length));
  const onP = ON.calls.find(c => c.body && c.body['pt_orderBook/ob_1/qty'] === 3);
  ok('ON ptPatch: the note is inside the same PATCH', !!onP && eq(onP.body['pt_sync/pt_orderBook/ob_1'], SV) && onP.method === 'PATCH' && onP.url === 'https://db/.json?auth=t');
  const onPut = ON.calls.find(c => c.body && c.body['pt_masterDB/mdb_X']);
  ok('ON ptPut: one root PATCH carrying value and note', !!onPut && onPut.method === 'PATCH' && eq(onPut.body, { 'pt_masterDB/mdb_X': { sku: 'X' }, 'pt_sync/pt_masterDB/mdb_X': SV }), JSON.stringify(onPut));
  const onDel = ON.calls.find(c => c.body && 'pt_pressInventory/p9' in c.body);
  ok('ON ptDelete: one root PATCH with null and note', !!onDel && onDel.method === 'PATCH' && eq(onDel.body, { 'pt_pressInventory/p9': null, 'pt_sync/pt_pressInventory/p9': SV }), JSON.stringify(onDel));
  ok('ON: no PUT and no DELETE request for a register path', !ON.calls.some(c => c.method === 'PUT' || c.method === 'DELETE'));
  ok('hook gets the original updates and values, same on and off', eq(ON.hook, OFF.hook) && ON.hook.length === 3 && !ON.hook.join('').includes('pt_sync'), ON.hook.join(' | '));
  ok('ptLiveWrote gets the same paths on and off', eq(ON.wrote, OFF.wrote) && !ON.wrote.join('').includes('pt_sync'));
  const audOf = X => X.calls.filter(c => c.body && Object.keys(c.body).some(k => k.indexOf('pt_audit/') === 0)).map(c => Object.values(c.body)[0]).map(r => JSON.stringify([r.kind, r.paths, r.vals]));
  ok('history lines are the same on and off and never list a note key', eq(audOf(ON), audOf(OFF)) && audOf(ON).length === 3 && !audOf(ON).join('').includes('pt_sync'), audOf(ON).length + ' lines');
  let P = load({ atomic: '1' });
  const rv = await P.ptPut('pt_masterDB/mdb_Y', { sku: 'Y' });
  ok('ON ptPut returns the original value', eq(rv, { sku: 'Y' }));
  P = load({ atomic: '1' }); await P.ptPut('pt_masterDB/mdb_A%2CB', { a: 1 });
  ok('ON: a %-encoded URL path is sent as the decoded database key', P.calls.some(c => c.body && 'pt_masterDB/mdb_A,B' in c.body && 'pt_sync/pt_masterDB/mdb_A,B' in c.body));
  P = load({ atomic: '1' }); await P.ptPatch({ 'pt_salesOrders/s/x': 1 }); await P.ptPut('pt_salesOrders/s', { a: 1 });
  ok('ON: a save outside the registers is left alone', P.calls.some(c => c.method === 'PUT') && !P.calls.some(c => c.body && Object.keys(c.body).some(k => k.indexOf('pt_sync/') === 0)));
  P = load({ atomic: '1', vendor: true }); await P.ptPatch({ 'pt_orderBook/ob_1/qty': 3 }); await tick();
  ok('a vendor login never gets the combined request', noteOnly(P).length === 1 && !dataCalls(P).some(c => c.body && Object.keys(c.body).some(k => k.indexOf('pt_sync/') === 0)));
  P = load({ atomic: '1', auditOff: true }); await P.ptPatch({ 'pt_orderBook/ob_1/qty': 3 });
  ok('with the history off (AUDIT off) it is just the save', P.calls.length === 1 && !('pt_sync/pt_orderBook/ob_1' in P.calls[0].body));
  P = load({ atomic: '1' }); await P.ptPut('pt_masterDB/mdb_U', undefined); await tick();
  ok('a value the database cannot hold (undefined) goes the old way', P.calls.some(c => c.method === 'PUT'));
  P = load({ atomic: '1' }); await P.ptPatch({ 'pt_orderBook/ob_1/qty': 3, 'pt_sync/pt_orderBook/ob_1': SV }); await tick();
  ok('a patch already writing the note key is not merged twice', noteOnly(P).length === 1 && P.calls.filter(c => c.body && c.body['pt_orderBook/ob_1/qty'] === 3).length === 1);
  P = load({ atomic: '1', mergedFails: true });
  let e403 = null;
  try { await P.ptPatch({ 'pt_orderBook/ob_1/qty': 3 }); await P.ptPut('pt_masterDB/mdb_Z', { z: 1 }); await P.ptDelete('pt_orderBook/ob_9'); await tick(); } catch (e) { e403 = e; }
  ok('a refused combined request is retried the old way and the save succeeds', !e403, e403 && e403.message);
  ok('...data first, then the note as before', P.calls.some(c => c.method === 'PUT' && eq(c.body, { z: 1 })) && P.calls.some(c => c.method === 'DELETE') && noteOnly(P).length === 3, String(noteOnly(P).length));
  ok('...and the refusal is logged in pt_syncAudit', P.calls.filter(c => c.body && Object.keys(c.body).some(k => k.indexOf('pt_syncAudit/') === 0)).length === 3);
  ok('...the hook still sees the original updates once each', P.hook.length === 3 && !P.hook.join('').includes('pt_sync'));
  ok('a real save failure with the switch on still fails', await (async () => { const Q = load({ atomic: '1', saveFails: true }); try { await Q.ptPatch({ 'pt_orderBook/ob_1/qty': 3 }); return false; } catch (e) { return true; } })());
  ok('static: ptCas never takes the combined request', (() => { const m = SRC.replace(/\r\n/g, '\n').match(/async function ptCas[\s\S]*?\n}\n/); return !!m && !/saNoteLines|saSend|merged/.test(m[0]) && /ptSyncNote\(\[path\], true\)/.test(m[0]); })());
  ok('static: no vendor check at file load (saOn asks only when called)', !/^(const|let|var)\s+\w+\s*=.*spIsVendor/m.test(SRC));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
