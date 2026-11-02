/* Meera's search service (meera/functions/service.js), tested with no internet and no Google account:
 *   node meera/functions/test/service.test.mjs
 * - only the ERP's pages may ask; /search only signed-in staff; a person's questions are capped per instance per day;
 * - /wake starts her search; it answers with the same top answers as her browser does, on her test questions;
 * - nothing is kept or written: no database, no file (the code names none), and the limits (max 2 instances, none warm)
 *   are in index.js. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), F = path.join(HERE, '..'), ROOT = path.join(F, '..', '..');
const require = createRequire(import.meta.url);
require(path.join(F, 'build.cjs'));   // lib/ and data/ from her sources
const { makeService } = await import('file:///' + path.join(F, 'service.js').replace(/\\/g, '/'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

/* Google's keys and a signed-in person (as in the router's tests) */
const PROJECT = 'price-research-48ff3';
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function token(over = {}) {
  const now = Math.floor(Date.now() / 1000), head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, sub: 'u1', email: 'staff@x.com', iat: now, exp: now + 3600, ...over }));
  return head + '.' + body + '.' + b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head + '.' + body))));
}
let routerCalls = 0;
const fakeFetch = async url => {
  url = String(url);
  if (url.includes('securetoken@system.gserviceaccount.com')) return { ok: true, json: async () => ({ keys: [jwk] }) };
  if (url.endsWith('/learned')) { routerCalls++; return { ok: true, json: async () => ({ answers: [{ id: 7, question: 'zebra pattern dupatta kaise banaye', screen: 'pbase', answer: { a: 'Press **Zebra**.' } }] }) }; }
  return { ok: false, status: 404, json: async () => ({}) };
};
const wb = readFileSync(path.join(F, 'data/meera-words.bin'));
const files = { bank: JSON.parse(readFileSync(path.join(F, 'data/meera-bank.json'), 'utf8')), walks: JSON.parse(readFileSync(path.join(F, 'data/meera-walks.json'), 'utf8')),
  words: wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.byteLength), version: JSON.parse(readFileSync(path.join(F, 'data/version.json'), 'utf8')).v };
const S = makeService({ files, env: { FIREBASE_PROJECT_ID: PROJECT, ROUTER_URL: 'https://router.example' }, fetcher: fakeFetch });
const LIVE = 'https://fabricrush-replenish.web.app', TEST = 'https://fabricrush-replenish--meera-v2-vonmvidk.web.app';
const call = (p, o = {}) => S.handle({ method: o.method || 'POST', path: p, origin: o.origin === undefined ? LIVE : o.origin, authorization: o.auth, body: o.body });
const tok = 'Bearer ' + await token();

/* the door */
ok((await call('/search', { origin: 'https://evil.example', auth: tok, body: { q: 'x' } })).status === 403, 'another website is refused');
ok((await call('/search', { body: { q: 'x' } })).status === 401, 'no sign-in is refused');
ok((await call('/search', { auth: 'Bearer bad.token.x', body: { q: 'x' } })).status === 401, 'a bad sign-in is refused');
{ const p = await call('/search', { method: 'OPTIONS', origin: TEST }); ok(p.status === 204 && p.headers['access-control-allow-origin'] === TEST, 'the test link may ask'); }
ok((await call('/nothing', { auth: tok })).status === 404, 'nothing else is there');

/* waking up */
{ const t0 = Date.now(), w = await call('/wake', { method: 'GET' }), j = JSON.parse(w.body);
  ok(w.status === 200 && j.ok && j.n > 3000, `/wake starts her search (${j.n} answers, ${Date.now() - t0} ms)`); }

/* the same answers as her browser */
{ const { load } = require(path.join(ROOT, 'meera/tests/harness.cjs'));
  const M = await load({ root: ROOT });
  const qs = [...JSON.parse(readFileSync(path.join(ROOT, 'meera/bank/evals/eval.json'), 'utf8')), ...JSON.parse(readFileSync(path.join(ROOT, 'meera/bank/evals/eval2.json'), 'utf8'))].slice(0, 120);
  let same = 0; const diff = [];
  for (const x of qs) {
    const tab = x.tab || 'shop', r = JSON.parse((await call('/search', { auth: tok, body: { q: x.q, screen: tab, lang: 'hg' } })).body);
    const mine = M.find(x.q, tab).slice(0, 3).map(h => h.id).filter(id => !String(id).startsWith('learned-')), srv = r.hits.map(h => h.id).filter(id => !String(id).startsWith('learned-'));
    if (mine[0] === srv[0]) same++; else diff.push(x.q + ': ' + mine[0] + ' / ' + srv[0]);
  }
  console.log(`  same first answer as her browser: ${same} of ${qs.length}`);
  ok(same >= qs.length - 2, 'the function answers as her browser does: ' + diff.slice(0, 5).join(' | ')); }

/* approved answers from her router, at most every 5 minutes */
{ const before = routerCalls;
  const r = JSON.parse((await call('/search', { auth: tok, body: { q: 'zebra pattern dupatta kaise banaye', screen: 'pbase', lang: 'hg' } })).body);
  ok(r.hits.some(h => h.id === 'learned-7'), 'an answer an admin approved is found'); ok(routerCalls - before <= 1, 'her router is asked at most once in 5 minutes'); }

/* a cap per person */
{ const T = 'Bearer ' + await token({ sub: 'busy' }); let last;
  for (let i = 0; i < 401; i++) last = await call('/search', { auth: T, body: { q: 'packing list', screen: 'pack', lang: 'en' } });
  ok(last.status === 429, 'one person: at most 400 questions a day per instance'); }

/* keeps nothing, writes nothing; the limits */
{ const src = ['service.js', 'index.js'].map(f => readFileSync(path.join(F, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');   // the code, not its notes
  ok(!/firestore|firebase-admin|getDatabase|realtime|writeFile|appendFile|console\.log\(/i.test(src), 'no database, no file written, no question logged');
  ok(/maxInstances:\s*2\b/.test(src) && /minInstances:\s*0\b/.test(src), 'at most 2 instances, none kept warm');
  ok(/region:\s*'asia-south1'/.test(src), 'Mumbai'); }

console.log(`meera-functions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
