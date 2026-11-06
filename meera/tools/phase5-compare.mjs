/* PHASE 5 — the browser's search and the router's, side by side, on every test set; then whole answers with the
 * "serveruse" switch; then the router down. All on this computer: Meera's real meera.js (the test bench), the router's
 * real code with its tables in Node's SQLite, her answers loaded as a deploy loads them (kb-sql.cjs).
 *   node meera/tools/phase5-compare.mjs */
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { handle } from '../router/src/worker.js';
import { store } from '../router/src/store.js';
import { resetEngine } from '../router/src/search.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { load } = require('../tests/harness.cjs');
const { classify, typoSet } = require('../tests/measure.cjs');
const frozen = require('../tests/typo-sets.cjs').load();
const EV = n => JSON.parse(readFileSync(path.join(HERE, '..', 'bank', 'evals', n + '.json'), 'utf8'));
const ORIGIN = 'https://fabricrush-replenish.web.app';

/* the router, as deployed: schema, then her answers (kb-sql.cjs), then her meaning table bundled */
function router() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(path.join(HERE, '..', 'router', 'schema.sql'), 'utf8'));
  raw.exec(execFileSync(process.execPath, [path.join(HERE, '..', 'router', 'kb-sql.cjs')], { maxBuffer: 1e9 }).toString('utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => raw.prepare(sql).get(...args) || null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => { raw.prepare(sql).run(...args); return { success: true }; },
    _run: () => ({ results: /RETURNING/i.test(sql) ? raw.prepare(sql).all(...args) : (raw.prepare(sql).run(...args), []) }),
  });
  const db = { prepare: sql => stmt(sql), batch: async list => list.map(s => s._run()), raw };
  const w = readFileSync(path.join(ROOT, 'Replenish-App', 'public', 'guide', 'meera-words.bin'));
  const words = w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength);
  const env = { ENABLED: 'true', ALLOWED_ORIGINS: ORIGIN, ADMIN_EMAILS: 'ravi@x', DB: db };
  resetEngine();
  const call = async (p, body) => {
    const r = await handle(new Request('https://router.example' + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: 'Bearer t' }, body: JSON.stringify(body) }),
      env, { store: store(db), verify: async () => ({ uid: 'u', email: 'staff@x', admin: false }), words, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    return { status: r.status, body: await r.json() };
  };
  return { call, raw };
}

const R = router();
const SETS = { 'test set 1': EV('eval'), 'test set 2': EV('eval2'), 'button/column': EV('eval-parts'), 'spelling set 1': typoSet(), 'spelling set 2 (held back)': frozen.held, 'Hindi-script spelling': frozen.hindi };
const out = {};
for (const spell of [false, true]) {
  const B = await load({ root: ROOT, bundle: true, switches: spell ? ['spell'] : [] });
  for (const [name, list] of Object.entries(SETS)) {
    const a = { right: 0, offered: 0, wrong: 0, none: 0 }, b = { right: 0, offered: 0, wrong: 0, none: 0 };
    let sameTop = 0, sameClass = 0;
    for (const x of list) {
      const hb = B.find(x.q, x.tab || 'shop');
      const r = await R.call('/search', { q: x.q, screen: x.tab || 'shop', spell });
      const hs = r.body.hits.map(h => ({ id: h.id, s: h.s }));
      const ca = classify(hb, x), cb = classify(hs, x);
      a[ca]++; b[cb]++;
      if ((hb[0] && hb[0].id) === (hs[0] && hs[0].id)) sameTop++;
      if (ca === cb) sameClass++;
    }
    out[`${name}${spell ? ' (spell on)' : ''}`] = { n: list.length, browser: a, server: b, sameTop, sameClass };
  }
}
console.log('\nEVERY TEST SET, BOTH WAYS (right / offered / wrong / not sure):');
for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(40)} browser ${v.browser.right}/${v.browser.offered}/${v.browser.wrong}/${v.browser.none}   server ${v.server.right}/${v.server.offered}/${v.server.wrong}/${v.server.none}   same first answer ${v.sameTop}/${v.n}, same verdict ${v.sameClass}/${v.n}`);

/* whole answers: switch "serveruse" (answers from the router) against the browser alone */
async function answers(switches, routerFetch) {
  const M = await load({ root: ROOT, bundle: true, switches });
  M.ctx.auth = { currentUser: { getIdToken: async () => 't' } };
  const pageFetch = M.ctx.fetch;
  let calls = 0, bytes = 0;
  M.ctx.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (!u.startsWith('https://meera-router.')) {
      if (/\/guide\/|\/meera\/backup\//.test(u)) { const f = path.join(ROOT, 'Replenish-App', 'public', u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]); if (existsSync(f)) bytes += readFileSync(f).length; }
      return pageFetch(url, opt);
    }
    calls++;
    return routerFetch(new URL(u).pathname, opt.body ? JSON.parse(opt.body) : null);
  };
  return { M, stats: () => ({ calls, bytes: M.state.fetched.reduce((n, u) => { const f = path.join(ROOT, 'Replenish-App', 'public', u); return n + (existsSync(f) ? require('node:zlib').gzipSync(readFileSync(f)).length : 0); }, 0) }) };
}
const all = [...EV('eval'), ...EV('eval2'), ...EV('eval-parts')];
const viaRouter = async (p, body) => { const r = await R.call(p, body || {}); return { ok: r.status < 300, status: r.status, json: async () => r.body }; };
const local = await answers([], viaRouter), remote = await answers(['serveruse'], viaRouter);
let same = 0, firstDiff = [];
const t0 = Date.now();
for (const x of all) {
  const a = await local.M.answer(x.q, x.tab || 'shop'), b = await remote.M.answer(x.q, x.tab || 'shop');
  if (JSON.stringify(a) === JSON.stringify(b)) same++; else if (firstDiff.length < 5) firstDiff.push({ q: x.q, browser: a.text.slice(0, 90) + ' ' + a.acts.join(' '), router: b.text.slice(0, 90) + ' ' + b.acts.join(' ') });
}
console.log(`\nWHOLE ANSWERS, switch "serveruse" against the browser alone: ${same} of ${all.length} identical`);
firstDiff.forEach(d => console.log('  differs: ' + d.q + '\n    browser: ' + d.browser + '\n    router:  ' + d.router));
console.log(`  downloaded (compressed) — browser alone: ${(local.stats().bytes / 1024).toFixed(0)} KB of her files (${local.M.state.fetched.length} fetches); serveruse: ${(remote.stats().bytes / 1024).toFixed(0)} KB (${[...new Set(remote.M.state.fetched)].join(', ')}), ${remote.stats().calls} router calls`);

/* the router down — each question asked with ITS screen open. (a) the internet works: her own full copy is fetched, as
 * before Phase 5; (b) no internet at all: only the small list for the screen (already in the browser) answers */
const bankAll = JSON.parse(readFileSync(path.join(ROOT, 'Replenish-App', 'public', 'guide', 'meera-bank.json'), 'utf8'));
const tabOf = new Map(bankAll.map(e => [e.id, e]));
for (const [label, offline] of [['router down, internet working', false], ['no internet at all (only the small list)', true]]) {
  const down = await answers(['serveruse'], async () => { throw new Error('router down'); });
  if (offline) { const f = down.M.ctx.fetch; down.M.ctx.fetch = async (u, o) => (String(u).includes('/guide/') ? Promise.reject(new Error('offline')) : f(u, o)); }
  let right = 0, offered = 0, wrong = 0, none = 0, saidSo = 0, n = 0;
  for (const x of [...EV('eval'), ...EV('eval2')]) {
    const e = x.id && tabOf.get(x.id);
    if (!e || e.p) continue;
    n++;
    down.M.setTab(e.tab || 'shop');
    const r = await down.M.ctx.MEERA.answer(x.q);
    const k = classify(down.M.find(x.q), x);
    if (k === 'right') right++; else if (k === 'offered') offered++; else if (k === 'wrong') wrong++; else none++;
    if (r.offline) saidSo++;
  }
  console.log(`
ROUTER DOWN — ${label}: ${n} test questions, each with its own screen open: right ${right}, offered ${offered}, wrong ${wrong}, not sure ${none}; said "my full search can't be reached" ${saidSo} times`);
}
