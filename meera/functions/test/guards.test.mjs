/* NEVER A CENT — her search function's guards, tested with no internet and no Google account:
 *   node meera/functions/test/guards.test.mjs
 * 1. its meter: every request counted with its billed time (rounded up to 0.1 s; a cold start adds its start-up), sent
 *    to her router every 20 requests;
 * 2. "half used": her router says stop → this copy shuts its own door once and refuses everything after;
 * 3. the cent alarm: cost 0.01 → her router's switch off and the door shut, at once; cost 0 → nothing;
 * 4. nothing in meera/functions can touch billing; the door it shuts is only meeraSearch's. */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), F = path.join(HERE, '..');
createRequire(import.meta.url)(path.join(F, 'build.cjs'));
const imp = f => import('file:///' + path.join(F, f).replace(/\\/g, '/'));
const { makeService } = await imp('service.js'), { makeAlarm } = await imp('alarm.js'), { stopServing, resetStop } = await imp('stop.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const files = { bank: JSON.parse(readFileSync(path.join(F, 'data/meera-bank.json'), 'utf8')).slice(0, 50), walks: [], words: null, version: 't' };

/* a fake router: the meter and its answer */
let meterSent = [], meterStop = false;
const fake = async (url, o = {}) => {
  url = String(url);
  if (url.endsWith('/meter')) { meterSent.push({ key: o.headers['x-meter-key'], ...JSON.parse(o.body) }); return { ok: true, json: async () => ({ stop: meterStop, why: meterStop ? 'free' : '' }) }; }
  return { ok: false, status: 404, json: async () => ({}) };
};
let stops = 0;
const S = makeService({ files, env: { FIREBASE_PROJECT_ID: 'p', ROUTER_URL: 'https://router.example', METER_KEY: 'k'.repeat(30) }, fetcher: fake,
  deps: { stopServing: async () => { stops++; return { ok: true }; }, uptimeMs: () => 1200 } });
const call = (o = {}) => S.handle({ method: 'GET', path: '/nothing', origin: o.origin || 'https://evil.example', authorization: '', body: '' });

console.log('1. its meter');
for (let i = 0; i < 20; i++) await call();
ok(meterSent.length === 1 && meterSent[0].req === 20 && meterSent[0].key === 'k'.repeat(30), 'after 20 requests (even refused ones) the meter goes to her router: ' + JSON.stringify(meterSent[0] && { req: meterSent[0].req, ms: meterSent[0].ms }));
ok(meterSent[0].ms >= 20 * 100 + 4200, 'billed time counted generously: 0.1 s each at least, plus the cold start (1.2 s + 3 s): ' + meterSent[0].ms + ' ms');

console.log('2. "half used" — her router says stop');
meterStop = true;
for (let i = 0; i < 20; i++) await call();
ok(S.state().stopped === 'free', 'this copy has stopped');
ok(stops === 1, 'its door shut once (' + stops + ')');
const after = await call({ origin: 'https://fabricrush-replenish.web.app' });
ok(after.status === 503 && JSON.parse(after.body).error === 'stopped-free', 'everything after is refused at once: ' + after.status + ' ' + after.body);
for (let i = 0; i < 25; i++) await call();
ok(stops === 1, 'the door is shut only once, however many requests follow');

console.log('3. the cent alarm');
{ const calls = []; let door = 0;
  const A = makeAlarm({ env: { ROUTER_URL: 'https://router.example', STOP_KEY: 's'.repeat(30) }, fetcher: async (u, o) => { calls.push({ u: String(u), key: o.headers['x-stop-key'] }); return { ok: true, json: async () => ({}) }; },
    stopServing: async () => { door++; return { ok: true }; } });
  const t0 = Date.now(), r1 = await A.onBudget({ costAmount: 0.01, currencyCode: 'INR', budgetDisplayName: 'Meera — 1 rupee' }), took = Date.now() - t0;
  ok(r1.acted && r1.router && r1.door && calls.length === 1 && calls[0].u.endsWith('/alarm') && calls[0].key === 's'.repeat(30) && door === 1, 'cost 0.01: her router\'s switch off and the door shut');
  ok(took < 60e3, `…within a minute (here ${took} ms; on Google, once the budget message arrives)`);
  const r0 = await A.onBudget({ costAmount: 0, currencyCode: 'INR' });
  ok(!r0.acted && calls.length === 1 && door === 1, 'cost 0: nothing happens');
  ok(!(await A.onBudget({})).acted && !(await A.onBudget({ costAmount: 'x' })).acted, 'a message without a cost: nothing happens'); }

console.log('4. only her search, never billing');
{ resetStop(); const seen = [];
  const r = await stopServing(async (u, o = {}) => { seen.push({ u: String(u), m: o.method || 'GET', b: o.body || '' }); return { ok: true, json: async () => ({ access_token: 't' }) }; });
  ok(r.ok && seen.length === 2 && seen[1].m === 'PATCH' && /services\/meerasearch\?update_mask=ingress$/.test(seen[1].u) && /INTERNAL_ONLY/.test(seen[1].b), 'the door: only meeraSearch, only its ingress set to internal');
  const code = readdirSync(F).filter(f => f.endsWith('.js')).map(f => readFileSync(path.join(F, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok(!/cloudbilling|billingAccounts|billingInfo|billingEnabled|projects\.updateBillingInfo/i.test(code), 'no billing call anywhere in meera/functions');
  const idx = readFileSync(path.join(F, 'index.js'), 'utf8');
  ok(/maxInstances:\s*2\b/.test(idx) && /minInstances:\s*0\b/.test(idx) && /timeoutSeconds:\s*10\b/.test(idx) && /memory:\s*'1GiB'/.test(idx), 'search: at most 2, none warm, 1 GiB, 10 s');
  ok(/topic:\s*'meera-budget'/.test(idx) && /maxInstances:\s*1\b/.test(idx) && /memory:\s*'256MiB'/.test(idx), 'alarm: its topic, at most 1, 256 MiB'); }

console.log(`meera-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
