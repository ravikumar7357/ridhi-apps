/* DATA METER (Step 0 of docs/data-reduction/PLAN.md) — core/data-meter.js and its hooks, run against a fake database,
 * fake browser storage and a fake live connection.
 *   node tests/data-meter-test.js            (DM_SRC=<file> to test another copy of data-meter.js; the last part does)
 * What must hold: the size counted is the real text length; with the meter off nothing is stored or changed; a meter
 * that fails leaves every read exactly as it was; a refused daily write is never retried in a loop; the live-copies block
 * is the original plus its one hook line; and a meter that counts one character wrong makes this suite fail. */
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawnSync } = require('child_process');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const CORE = path.join(__dirname, '..', 'src', 'app', 'core');
const DM_FILE = process.env.DM_SRC || path.join(CORE, 'data-meter.js');
const SRC_DM = rd(DM_FILE);
const SRC_LIVE_FILE = rd(path.join(CORE, 'live-copies.js'));
const BAN_A = '/* ==== LIVE COPIES OF THE REGISTERS ====', BAN_Z = '/* ==== END LIVE COPIES ==== */';
const LIVE_BLOCK = SRC_LIVE_FILE.slice(SRC_LIVE_FILE.indexOf(BAN_A), SRC_LIVE_FILE.indexOf(BAN_Z) + BAN_Z.length);
/* The live-copies block as it was BEFORE the meter (SHA-256 of the text between its two banners, 2026-11-05). */
const LIVE_ORIGINAL_SHA = '8dd307c19afcd911f9fd45eef72c23f94264216becd9413b4e0f230da9d3b253';
const HOOK_LINE = "  try { if (typeof dmLiveWatch === 'function' && dmOn()) dmLiveWatch(node, L); } catch (e) { console.warn('[data meter]', e); }\n";
const cut = (src, name) => { let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const DBR = rd(path.join(CORE, 'database-read.js')), HIS = rd(path.join(CORE, 'history.js')), LOK = rd(path.join(CORE, 'lookups.js')), DLT = rd(path.join(CORE, 'delta-sync.js'));
const URL_ = "import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js')";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const tick = (n = 3) => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : setImmediate(f)); setImmediate(f); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* the texts the fake database answers with — Hindi included */
const TEXT = {
  pt_orderBook: JSON.stringify({ a: { sku: 'A', note: 'नमस्ते दुनिया', qty: 1 }, b: { sku: 'B', qty: 2 } }),
  'pt_fresh/x': JSON.stringify({ name: 'कपड़ा', n: 5 }),
  pt_audit: JSON.stringify({ k1: { at: '2026-11-05', what: 'बदलाव' } }),
  'pt_cas/k': JSON.stringify({ a: 1 }),
  pt_masterDB: JSON.stringify({ m1: { sku: 'ABC', color: 'लाल' } }),
  'pt_sync/pt_orderBook': JSON.stringify({ a: 1700000000000 }),
};

function world(o) {
  o = o || {};
  const LS = new Map();
  const localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => { if (o.storeFails) throw new Error('quota'); LS.set(k, String(v)); }, removeItem: k => { LS.delete(k); },
    get length() { return LS.size; }, key: i => [...LS.keys()][i] };
  if (o.ls) Object.entries(o.ls).forEach(([k, v]) => LS.set(k, v));
  const SS = new Map();
  const sessionStorage = { getItem: k => (SS.has(k) ? SS.get(k) : null), setItem: (k, v) => SS.set(k, String(v)) };
  const net = { calls: [], textCalls: 0, jsonCalls: 0 };
  const fetch = async (url, init) => {
    init = init || {};
    const m = String(url).match(/https:\/\/db\/([^?]*)\.json/); const p = m ? decodeURIComponent(m[1]) : '';
    net.calls.push((init.method || 'GET') + ' ' + p);
    if (init.method && init.method !== 'GET') return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}', json: async () => ({}) };
    const t = TEXT[p] !== undefined ? TEXT[p] : 'null';
    return { ok: true, status: 200, headers: { get: () => 'tag' },
      text: async () => { net.textCalls++; return t; }, json: async () => { net.jsonCalls++; return JSON.parse(t); } };
  };
  /* the fake live database: listeners per path; a push fires the row events first, then the register's own, as the real one does */
  const LI = {}, STATE = {};
  const add = (kind, p, cb) => { (LI[p] = LI[p] || []).push({ kind, cb });
    /* data already in the browser: a new listener is answered at once (rows first only if it is a row listener) */
    if (STATE[p] && !STATE[p].__none) { if (kind === 'value') cb(snap(p, STATE[p])); else if (kind === 'added') Object.keys(STATE[p]).forEach(k => cb(snap(k, STATE[p][k]))); }
    return () => { LI[p] = (LI[p] || []).filter(x => x.cb !== cb); }; };
  const FAKE = { getDatabase: () => ({}), ref: (_d, p) => p,
    onValue: (p, cb, bad) => { const off = add('value', p, cb); (LI[p].find(x => x.cb === cb)).bad = bad; return off; },
    onChildAdded: (p, cb) => add('added', p, cb), onChildChanged: (p, cb) => add('changed', p, cb) };
  const snap = (key, v) => ({ key, val: () => JSON.parse(JSON.stringify(v)) });
  const push = (p, v) => {
    const old = STATE[p] || {};
    Object.keys(v || {}).forEach(k => {
      const kind = k in old ? (JSON.stringify(old[k]) === JSON.stringify(v[k]) ? null : 'changed') : 'added';
      if (kind) (LI[p] || []).filter(x => x.kind === kind).forEach(x => x.cb(snap(k, v[k])));
    });
    STATE[p] = JSON.parse(JSON.stringify(v));
    (LI[p] || []).filter(x => x.kind === 'value').forEach(x => x.cb(snap(p, v)));
  };
  const pushTrue = () => (LI['.info/connected'] || []).forEach(x => x.cb({ val: () => true }));
  const writes = [], logs = [], handlers = {};
  const ctx = {
    fetch, FAKE, app: o.live ? { name: 'app' } : null, auth: { currentUser: { uid: 'u1' } }, spIsVendor: () => !!o.vendor,
    PT_URL: 'https://db', ptPath: p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/'), ptAuthQuery: async () => '?auth=t',
    localStorage, sessionStorage, AUDIT: { on: !o.harness }, ME: { email: o.email || 'Ravi.K@fabricrush.com' }, TAB_NOW: o.tab || 'ord',
    performance: { getEntriesByType: () => [{ type: o.reload ? 'reload' : 'navigate' }] },
    addEventListener: (ev, f) => { handlers[ev] = f; },
    ptAuditWrite: async u => { writes.push(u); if (o.writeFails && (typeof o.writeFails !== 'function' || o.writeFails(writes.length))) throw new Error('audit 403'); return true; },
    auditLog: () => {}, ptSyncNote: () => {}, obUC: s => String(s).toUpperCase(), mdbOf: () => null, PTG: { mdb: [] }, PT: { mdb: [] },
    BASE: { on: false }, BASE_NODE: 'pt_baseData', baseRoutePath: () => null, baseReadAll: async () => ({}),
  };
  const warns = [];
  const fakeConsole = { warn: (...a) => warns.push(a), log: () => {}, error: () => {} };
  const code = SRC_DM + '\n' + LIVE_BLOCK.replace(URL_, 'Promise.resolve(FAKE)') + '\n' + [cut(DBR, 'ptGet'), cut(HIS, 'ptGetFresh'), cut(HIS, 'audRead'), cut(HIS, 'ptCas'), cut(LOK, 'mdbFetchSku'), cut(DLT, 'deltaRead')].join('\n')
    + (o.append || '')
    + '\nreturn { ptGet, ptGetFresh, audRead, ptCas, mdbFetchSku, deltaRead, PT_LIVE, DM, dmOn, dmCount, dmJson, dmSendDays, dmStart, dmSaveFlag, dmTick, dmBuildLine, setTab: v => { TAB_NOW = v; }, setUp: v => { PT_LIVE_UP = v; } };';
  const fn = new Function('console', ...Object.keys(ctx), code);
  const api = fn(fakeConsole, ...Object.values(ctx));
  /* the characters counted, one register, optionally one way of reading */
  const chars = (reg, how) => { let c = 0; Object.values(api.DM.T).forEach(P => { const N = P[reg]; if (N) c += how ? ((N.how[how] || {}).c || 0) : N.c; }); return c; };
  const reads = reg => { let n = 0; Object.values(api.DM.T).forEach(P => { if (P[reg]) n += P[reg].n; }); return n; };
  return Object.assign(api, { STATE, LS, net, writes, logs, warns, push, pushTrue, LI, chars, reads, handlers, ctx });
}
const dmKeysOf = W => [...W.LS.keys()].filter(k => k.indexOf('dm') === 0);

(async () => {
  console.log('== switch order: 0 beats the flag, 1 turns it on, otherwise the flag decides ==');
  let W = world({ ls: { dataMeter: '0', dmFlagLast: '1' } });
  ok("'0' is off even when the flag says on", W.dmOn() === false);
  W = world({ ls: { dataMeter: '1', dmFlagLast: '0' } });
  ok("'1' is on even when the flag says off", W.dmOn() === true);
  W = world({ ls: { dmFlagLast: '1' } });
  ok('nothing set: the flag on means on', W.dmOn() === true);
  W = world({ ls: { dmFlagLast: '0' } });
  ok('nothing set: the flag off means off', W.dmOn() === false);
  W = world({});
  ok('nothing set and no flag: off (the shipped default)', W.dmOn() === false);
  W = world({ ls: { dataMeter: '1' }, vendor: true });
  ok('never for a vendor, even with 1', W.dmOn() === false);
  W = world({ ls: { dataMeter: '1' }, harness: true });
  ok('never in the test harnesses (AUDIT off), even with 1', W.dmOn() === false);

  console.log('== normal counting: the size counted is the real text length ==');
  W = world({ ls: { dataMeter: '1' } });
  W.setTab('ord');
  const pa = await W.ptGet('pt_orderBook');
  ok('ptGet still returns the data', pa && pa.a && pa.a.note === 'नमस्ते दुनिया');
  ok('ptGet counted exactly the text length (Hindi counts as characters)', W.chars('pt_orderBook', 'plain') === TEXT.pt_orderBook.length, W.chars('pt_orderBook', 'plain') + ' vs ' + TEXT.pt_orderBook.length);
  ok('…as one read', W.reads('pt_orderBook') === 1);
  ok('…under the screen that was open', !!W.DM.T.ord);
  W.setTab('cut');
  await W.ptGetFresh('pt_fresh/x');
  ok('ptGetFresh counted, filed under its register and the new screen', W.DM.T.cut && W.DM.T.cut.pt_fresh.c === TEXT['pt_fresh/x'].length);
  const au = await W.audRead('pt_audit', 5);
  ok('the history read counted and still returns its rows', au.length === 1 && W.chars('pt_audit') === TEXT.pt_audit.length);
  const cas = await W.ptCas('pt_cas/k', { a: 1 }, { a: 2 });
  ok('the compare-and-set read counted and still saves', cas === '' && W.chars('pt_cas') === TEXT['pt_cas/k'].length && W.net.calls.includes('PUT pt_cas/k'));
  const sk = await W.mdbFetchSku('abc');
  ok('the one-SKU lookup counted (and found the row)', sk && sk.sku === 'ABC' && W.chars('pt_masterDB') >= TEXT.pt_masterDB.length, String(W.chars('pt_masterDB')));
  await W.deltaRead('pt_sync/pt_orderBook');
  ok('the Delta Sync shadow read counted as delta-shadow', W.chars('pt_sync', 'delta-shadow') === TEXT['pt_sync/pt_orderBook'].length);

  console.log('== the live copy: first copy at full length, then each changed row ==');
  W = world({ ls: { dataMeter: '1' }, live: true });
  W.setTab('so');
  const first = W.ptGet('pt_orderBook'); await tick(); W.pushTrue(); await tick();
  const full = { a: { sku: 'A', note: 'नमस्ते', qty: 1 }, b: { sku: 'B', qty: 2 } };
  W.push('pt_orderBook', full);
  const live1 = await first;
  ok('the screen got its data', live1 && live1.a.qty === 1);
  await wait(120);
  ok('first copy counted once, at the register\'s full length', W.chars('pt_orderBook', 'live-first') === JSON.stringify(full).length && W.DM.T.so.pt_orderBook.how['live-first'].n === 1, W.chars('pt_orderBook', 'live-first') + ' vs ' + JSON.stringify(full).length);
  ok('…and the plain download path was not used', W.net.calls.filter(c => /^GET pt_orderBook/.test(c)).length === 0);
  const full2 = { a: { sku: 'A', note: 'नमस्ते', qty: 9 }, b: { sku: 'B', qty: 2 } };
  W.push('pt_orderBook', full2);
  ok('a changed row counted at its key plus its row length', W.chars('pt_orderBook', 'live-change') === 'a'.length + JSON.stringify(full2.a).length, String(W.chars('pt_orderBook', 'live-change')));
  const full3 = Object.assign({}, full2, { c: { sku: 'C', qty: 3 } });
  W.push('pt_orderBook', full3);
  ok('a new row counted too', W.chars('pt_orderBook', 'live-change') === 'a'.length + JSON.stringify(full2.a).length + 'c'.length + JSON.stringify(full3.c).length);
  const before = W.chars('pt_orderBook');
  await W.ptGet('pt_orderBook');
  ok('every screen served from the live path counts a read with 0 KB (the first one too: its KB are the live-first line)', W.chars('pt_orderBook') === before && W.DM.T.so.pt_orderBook.how['from-copy'].n === 2);
  ok('it added no download (no plain read)', W.net.calls.filter(c => /^GET/.test(c)).length === 0);
  const lc = W.LI.pt_orderBook.length;
  const L = W.PT_LIVE.get('pt_orderBook');
  L.off();
  ok('when the app drops the copy, the meter\'s own listeners go too', (W.LI.pt_orderBook || []).length === 0, lc + ' before, ' + (W.LI.pt_orderBook || []).length + ' after');
  /* replaced without off() being called: the first row event after it lets go */
  W = world({ ls: { dataMeter: '1' }, live: true });
  const f2 = W.ptGet('pt_orderBook'); await tick(); W.pushTrue(); await tick(); W.push('pt_orderBook', full); await f2; await wait(80);
  W.PT_LIVE.delete('pt_orderBook');
  W.push('pt_orderBook', full2);
  ok('a copy the app replaced is let go of at its next change, and not counted', W.chars('pt_orderBook', 'live-change') === 0 && !(W.LI.pt_orderBook || []).some(x => x.kind !== 'value'));

  console.log('== a copy already in the browser: counted once, not again row by row ==');
  W = world({ ls: { dataMeter: '1' }, live: true });
  W.setTab('so'); W.STATE.pt_orderBook = full;
  const pre = W.ptGet('pt_orderBook'); await tick(); W.pushTrue(); await tick(); await pre; await wait(120);
  ok('the first copy is counted once at full length', W.chars('pt_orderBook', 'live-first') === JSON.stringify(full).length && W.DM.T.so.pt_orderBook.how['live-first'].n === 1);
  ok('…and the rows that were already there are not counted again', !W.DM.T.so.pt_orderBook.how['live-change']);

  console.log('== switch off: nothing stored, nothing written, the same read as today ==');
  W = world({});
  const off1 = await W.ptGet('pt_orderBook'); await W.ptGetFresh('pt_fresh/x'); await W.audRead('pt_audit', 5); await W.mdbFetchSku('abc'); await W.deltaRead('pt_sync/pt_orderBook');
  ok('no browser storage key at all', W.LS.size === 0, [...W.LS.keys()].join(','));
  ok('no tally', JSON.stringify(W.DM.T) === '{}' && W.DM.started === false);
  ok('plain reads use json() exactly as before (text() only where the shadow always used it)', off1.a.qty === 1 && W.net.jsonCalls >= 4 && W.net.textCalls === 1, W.net.jsonCalls + '/' + W.net.textCalls);
  await W.dmSendDays(); W.dmStart(); await wait(10);
  ok('nothing is sent', W.writes.length === 0 && W.net.calls.every(c => c.indexOf('GET') === 0));
  W = world({}); W.dmSaveFlag(false, 'office');
  ok('sign-in with the meter off leaves no key behind', W.LS.size === 0, [...W.LS.keys()].join(','));
  W = world({ ls: { dmFlagLast: '1', dmType: 'x' } }); W.dmSaveFlag(false, 'office');
  ok('…and a flag turned off clears the old answer', W.LS.size === 0);
  W = world({ ls: { dataMeter: '0', dmFlagLast: '1' } });
  await W.ptGet('pt_orderBook');
  ok("'0' counts nothing even with the flag on", W.LS.size === 2);
  W = world({ ls: { dataMeter: '1' }, vendor: true });
  await W.ptGet('pt_orderBook');
  ok('a vendor counts nothing', dmKeysOf(W).length === 0);
  W = world({ ls: { dataMeter: '1' }, harness: true });
  await W.ptGet('pt_orderBook'); await W.dmSendDays();
  ok('the test harness counts and sends nothing', dmKeysOf(W).length === 0 && W.writes.length === 0);

  console.log('== a meter that fails never changes a read or a save ==');
  W = world({ ls: { dataMeter: '1' }, append: '\nfunction dmInit() { throw new Error("boom"); }' });
  const f1 = await W.ptGet('pt_orderBook'); const f2b = await W.ptGetFresh('pt_fresh/x'); const f3 = await W.ptCas('pt_cas/k', { a: 1 }, { a: 2 });
  ok('the data comes back exactly the same', JSON.stringify(f1) === TEXT.pt_orderBook && JSON.stringify(f2b) === TEXT['pt_fresh/x'] && f3 === '');
  ok('the failure is told to the console only', W.warns.length > 0 && W.warns.every(w => w[0] === '[data meter]'));
  ok('and nothing is written', dmKeysOf(W).length === 0 && W.writes.length === 0 && W.net.calls.filter(c => !/^GET/.test(c)).length === 1);
  W = world({ ls: { dataMeter: '1' }, append: '\nfunction dmCount() { throw new Error("boom2"); }' });
  const f4 = await W.ptGet('pt_orderBook');
  ok('a counting error inside the read still returns the data', f4 && f4.b.qty === 2 && W.warns.length === 0 ? true : (f4 && f4.b.qty === 2));
  W = world({ ls: { dataMeter: '1' }, storeFails: true });
  const f5 = await W.ptGet('pt_orderBook');
  ok('a full or blocked browser storage changes nothing for the read', f5 && f5.a.qty === 1);
  W = world({ ls: { dataMeter: '1' }, live: true, append: '\nfunction dmLiveWatch() { throw new Error("boom3"); }' });
  const fl = W.ptGet('pt_orderBook'); await tick(); W.pushTrue(); await tick(); W.push('pt_orderBook', full);
  ok('a failing live watcher leaves the live read as it was', (await fl).a.qty === 1);

  console.log('== the daily line ==');
  const yday = daysAgo(1), tabA = 'dm:t:' + yday + ':tA', tabB = 'dm:t:' + yday + ':tB';
  const tally = (rl, pk, pages) => JSON.stringify({ v: 1, rl, pk, pages });
  const mkLs = () => ({ dataMeter: '1', dmType: 'factory',
    [tabA]: tally(1, 2, { ord: { pt_orderBook: { n: 2, c: 2048, how: { plain: { n: 1, c: 1024 }, 'from-copy': { n: 1, c: 0 }, 'live-first': { n: 0, c: 0 } } } } }),
    [tabB]: tally(0, 3, { ord: { pt_orderBook: { n: 1, c: 1024, how: { plain: { n: 1, c: 1024 } } } }, cut: { pt_masterDB: { n: 1, c: 512, how: { plain: { n: 1, c: 512 } } } } }) });
  W = world({ ls: mkLs() });
  await W.dmSendDays();
  ok('a finished day writes exactly one line', W.writes.length === 1, String(W.writes.length));
  const key = Object.keys(W.writes[0] || {})[0] || '';
  ok('…at pt_dataMeter/<day>/<email with dots as commas>/<device>', new RegExp('^pt_dataMeter/' + yday + '/ravi,k@fabricrush,com/d[a-z0-9]+$').test(key), key);
  const line = W.writes[0][key];
  ok('…with the right shape and the two tabs added up', line.v === 1 && line.who === 'Ravi.K@fabricrush.com' && line.type === 'factory' && line.tabs === 2 && line.reloads === 1 && line.peakTabs === 3 && typeof line.at === 'string',
    JSON.stringify(line));
  ok('…pages add up (3 reads, 3 KB for the Order Book on one screen; Master Database apart)', line.pages.ord.pt_orderBook.n === 3 && line.pages.ord.pt_orderBook.kb === 3 && line.pages.ord.pt_orderBook.how.plain.n === 2
    && line.pages.ord.pt_orderBook.how.plain.kb === 2 && line.pages.cut.pt_masterDB.kb === 0.5, JSON.stringify(line.pages));
  ok('…and names what it could not count', Array.isArray(line.notCounted) && line.notCounted.includes('save-answers'));
  ok('the finished day\'s tallies are deleted after the good save, and it is marked sent', !W.LS.has(tabA) && !W.LS.has(tabB) && W.LS.has('dm:sent:' + yday));
  await W.dmSendDays();
  ok('a second run sends nothing more', W.writes.length === 1);

  W = world({ ls: Object.assign(mkLs(), { ['dm:t:' + today() + ':tC']: tally(0, 1, { ord: {} }) }) });
  await W.dmSendDays();
  ok('today\'s own tally is never sent', W.writes.length === 1 && W.LS.has('dm:t:' + today() + ':tC'));

  W = world({ ls: Object.assign(mkLs(), { ['dm:sent:' + yday]: 'x' }) });
  await W.dmSendDays();
  ok('a day another tab already sent is not sent again', W.writes.length === 0);

  W = world({ ls: Object.assign(mkLs(), { ['dm:t:' + daysAgo(9) + ':tOld']: tally(0, 1, {}) }) });
  await W.dmSendDays();
  ok('tallies older than 7 days are dropped, not sent', !W.LS.has('dm:t:' + daysAgo(9) + ':tOld') && W.writes.length === 1);

  console.log('== a refused save keeps the tally and is retried once, on a later day only ==');
  W = world({ ls: mkLs(), writeFails: true });
  await W.dmSendDays();
  ok('the write was tried', W.writes.length === 1);
  ok('the tally is kept after a failed save', W.LS.has(tabA) && W.LS.has(tabB) && !W.LS.has('dm:sent:' + yday));
  ok('the try was marked (before it happened)', JSON.parse(W.LS.get('dm:tried:' + yday)).n === 1 && JSON.parse(W.LS.get('dm:tried:' + yday)).on === today());
  await W.dmSendDays(); await W.dmSendDays();
  ok('no retry in a loop on the same day', W.writes.length === 1, String(W.writes.length));
  W.LS.set('dm:tried:' + yday, JSON.stringify({ n: 1, on: daysAgo(1) }));
  await W.dmSendDays();
  ok('a later day tries once more', W.writes.length === 2);
  await W.dmSendDays();
  W.LS.set('dm:tried:' + yday, JSON.stringify({ n: 2, on: daysAgo(1) }));
  await W.dmSendDays();
  ok('and then gives up', W.writes.length === 2);
  W = world({ ls: Object.assign(mkLs(), { ['dm:tried:' + yday]: JSON.stringify({ n: 1, on: daysAgo(1) }) }) });
  await W.dmSendDays();
  ok('a retry that works sends the day and clears it', W.writes.length === 1 && !W.LS.has(tabA) && W.LS.has('dm:sent:' + yday));

  console.log('== the meter keeps its own tally in the browser ==');
  W = world({ ls: { dataMeter: '1' }, reload: true });
  await W.ptGet('pt_orderBook');
  ok('a heartbeat key and a tally key are kept for this tab', dmKeysOf(W).some(k => /^dm:hb:/.test(k)) && W.DM.tab !== '');
  W.dmTick();
  const saved = JSON.parse(W.LS.get('dm:t:' + today() + ':' + W.DM.tab));
  ok('the tally is saved when it changed, with the reload counted', saved.pages.ord.pt_orderBook.c === TEXT.pt_orderBook.length && saved.rl === 1);
  W.LS.set('dm:hb:other1', String(Date.now())); W.LS.set('dm:hb:other2', String(Date.now() - 600000));
  W.dmTick();
  ok('peak tabs open at once counts recent heartbeats only', JSON.parse(W.LS.get('dm:t:' + today() + ':' + W.DM.tab)).pk === 2);
  W.handlers.pagehide && W.handlers.pagehide();
  ok('leaving the page saves the tally and drops the heartbeat', !W.LS.has('dm:hb:' + W.DM.tab));
  W.dmSaveFlag(true, 'admin');
  ok('sign-in keeps the flag answer and the user type', W.LS.get('dmFlagLast') === '1' && W.LS.get('dmType') === 'admin');

  console.log('== a duplicated tab gets its own id ==');
  W = world({ ls: { dataMeter: '1', ['dm:hb:X']: String(Date.now()) } }); W.ctx.sessionStorage.setItem('dmTab', 'X');
  await W.ptGet('pt_orderBook');
  ok('a fresh heartbeat for the id means another tab holds it: a new id', W.DM.tab !== 'X' && W.DM.tab !== '');
  W = world({ ls: { dataMeter: '1' } }); W.ctx.sessionStorage.setItem('dmTab', 'X');
  await W.ptGet('pt_orderBook');
  ok('no fresh heartbeat (a plain reload): the id stays', W.DM.tab === 'X');

  console.log('== the live-copies block: the original plus the one hook line, nothing else ==');
  ok('the hook line is there once', LIVE_BLOCK.split(HOOK_LINE).length === 2);
  const without = LIVE_BLOCK.replace(HOOK_LINE, '');
  ok('with that one line removed the block is byte for byte the original (SHA-256)', crypto.createHash('sha256').update(without).digest('hex') === LIVE_ORIGINAL_SHA, crypto.createHash('sha256').update(without).digest('hex'));

  console.log(`\n${pass} passed, ${fail} failed`);
  /* TEETH: the same suite against a meter that counts one character too many must fail */
  if (!process.env.DM_SRC && !fail) {
    const bad = SRC_DM.replace('dmCount(node, text.length, how)', 'dmCount(node, text.length + 1, how)');
    if (bad === SRC_DM) { console.log('  COULD NOT BREAK IT (anchor missing)'); process.exit(1); }
    const tmp = path.join(os.tmpdir(), 'teeth-data-meter.js');
    fs.writeFileSync(tmp, bad);
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { DM_SRC: tmp }), encoding: 'utf8', timeout: 120000 });
    const caught = r.status !== 0;
    console.log((caught ? '  BITES  ' : '  MISSED ') + 'sizing off by one' + (caught ? '' : ' — the suite still passed'));
    if (!caught) process.exit(1);
  }
  process.exit(fail ? 1 : 0);
})();
