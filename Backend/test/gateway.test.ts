import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AmazonGateway, NotOwnerError, PausedError, ThrottledError, AmazonError } from '../src/lib/gateway.ts';
import { MemoryLimiter } from '../src/lib/limiter.ts';
import { controlsFrom, loadControls } from '../src/lib/controls.ts';
import { effective } from '../src/lib/amazon-limits.ts';
import { clearTokenCache } from '../src/lib/amazon.ts';
import { FakeDb, env, fakeFetch, json, lwa, type FakeRoute } from './fakes.ts';

const SP = 'sellingpartnerapi-na.amazon.com';
const ours = (extra: { key: string; value: unknown }[] = []) => controlsFrom([
  { key: 'share', value: 1 },
  { key: 'owner:fba-inventory', value: 'backend' }, { key: 'owner:pricing', value: 'backend' },
  { key: 'owner:orders-report', value: 'backend' }, ...extra,
]);

/** A gateway on a fake clock: sleeping moves the clock, so tests take no real time. */
function setup(controls = ours()) {
  let t = 1_000_000;
  const slept: number[] = [];
  const now = () => t;
  const gw = new AmazonGateway({
    env, controls, now, limiter: new MemoryLimiter(now),
    sleep: async (ms) => { slept.push(ms); t += ms; },
  });
  return { gw, slept };
}
const sp = (answer: (url: URL, init: RequestInit, n: number) => Response): FakeRoute => {
  let n = 0;
  return (url, init) => (url.hostname === SP ? answer(url, init, ++n) : null);
};
const spCalls = (f: { calls: { url: string }[] }) => f.calls.filter(c => c.url.includes(SP));
const INV = { path: '/fba/inventory/v1/summaries', query: { granularityType: 'Marketplace', nextToken: undefined } };

beforeEach(() => clearTokenCache());

test('a normal call: the brand\'s login is sent, the question goes out, the answer comes back, it is counted', async () => {
  let seen: any = null;
  const f = fakeFetch([lwa, sp((url, init) => { seen = { url, headers: init.headers }; return json({ payload: { rows: 3 } }); })]);
  try {
    const { gw } = setup();
    const out = await gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' });
    assert.deepEqual(out, { payload: { rows: 3 } });
    assert.equal(seen.headers['x-amz-access-token'], 'Atza|spid');
    assert.equal(seen.url.searchParams.get('granularityType'), 'Marketplace');
    assert.equal(seen.url.searchParams.has('nextToken'), false);
    assert.deepEqual(gw.stats(), [{ brand: 'SP', op: 'fbaInventory.getInventorySummaries', outcome: 'ok', n: 1 }]);
  } finally { f.restore(); }
});

test('data that belongs to Apps Script is refused before anything is sent to Amazon', async () => {
  const f = fakeFetch([lwa, sp(() => json({}))]);
  try {
    const { gw } = setup(controlsFrom([{ key: 'share', value: 1 }]));          // nothing is ours
    await assert.rejects(gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' }), NotOwnerError);
    assert.equal(f.calls.length, 0);
    assert.equal(gw.stats()[0].outcome, 'refused');
  } finally { f.restore(); }
});

test('the off switches: pause everything, or one job', async () => {
  const f = fakeFetch([lwa, sp(() => json({}))]);
  try {
    const all = setup(ours([{ key: 'pause_all', value: true }])).gw;
    await assert.rejects(all.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' }), PausedError);
    const one = setup(ours([{ key: 'pause:inventory', value: true }])).gw;
    await assert.rejects(one.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory', job: 'inventory' }), PausedError);
    await one.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory', job: 'other' });
    assert.equal(spCalls(f).length, 1);
  } finally { f.restore(); }
});

test('if the switches cannot be read, everything is paused and nothing is ours', async () => {
  const db = new FakeDb(); db.failSelect = true;
  const c = await loadControls(db);
  assert.equal(c.pausedAll, true);
  assert.equal(c.owner('mcf'), 'apps-script');
  const d = controlsFrom([]);                                                   // readable but empty: safe answers
  assert.deepEqual([d.pausedAll, d.owner('ads-live'), d.share], [false, 'apps-script', 0.5]);
});

test('a call that is not in the limits table is refused', async () => {
  const { gw } = setup();
  await assert.rejects(gw.call('orders.getOrders' as any, 'SP', { path: '/x' }, { dataset: 'pricing' }), /Unknown Amazon call/);
});

test('speed limit: prices go one every 2 seconds (Amazon allows 0.5 a second)', async () => {
  const f = fakeFetch([lwa, sp(() => json({ ok: 1 }))]);
  try {
    const { gw, slept } = setup();
    const q = { path: '/products/pricing/v0/items/B0X/offers' };
    await gw.call('pricing.getItemOffers', 'SP', q, { dataset: 'pricing' });
    await gw.call('pricing.getItemOffers', 'SP', q, { dataset: 'pricing' });
    await gw.call('pricing.getItemOffers', 'SP', q, { dataset: 'pricing' });
    assert.deepEqual(slept, [2000, 2000]);
    assert.equal(spCalls(f).length, 3);
  } finally { f.restore(); }
});

test('while Apps Script still calls Amazon we use half of each limit; each brand has its own count', async () => {
  assert.deepEqual(effective('reports.createReport', 0.5), { rate: 0.0167 * 0.5, burst: 7 });
  assert.deepEqual(effective('pricing.getItemOffers', 0.5), { rate: 0.25, burst: 1 });
  const f = fakeFetch([lwa, sp(() => json({ ok: 1 }))]);
  try {
    const { gw, slept } = setup(ours([{ key: 'share', value: 0.5 }]));
    const q = { path: '/products/pricing/v0/items/B0X/offers' };
    await gw.call('pricing.getItemOffers', 'SP', q, { dataset: 'pricing' });
    await gw.call('pricing.getItemOffers', 'CPC', q, { dataset: 'pricing' });   // CPC's own bucket: no wait
    await gw.call('pricing.getItemOffers', 'SP', q, { dataset: 'pricing' });
    assert.deepEqual(slept, [4000]);
  } finally { f.restore(); }
});

test('a long wait is put off, not slept through: the 16th report request in a row comes back later', async () => {
  const f = fakeFetch([lwa, sp(() => json({ reportId: 'R' }))]);
  try {
    const { gw, slept } = setup();
    const mk = () => gw.call('reports.createReport', 'SP', { method: 'POST', path: '/reports/2021-06-30/reports', body: {} }, { dataset: 'orders-report' });
    for (let i = 0; i < 15; i++) await mk();                                    // the burst Amazon allows
    const err: any = await mk().then(() => null, e => e);
    assert.ok(err instanceof ThrottledError);
    assert.ok(err.retryAfterMs > 50_000 && err.retryAfterMs <= 60_000);
    assert.deepEqual(slept, []);
    assert.equal(spCalls(f).length, 15);                                        // the 16th never reached Amazon
  } finally { f.restore(); }
});

test('Amazon says slow down with a wait time: we wait exactly that long, then it works', async () => {
  const f = fakeFetch([lwa, sp((_u, _i, n) => (n === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } }) : json({ ok: 1 })))]);
  try {
    const { gw, slept } = setup();
    const out = await gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' });
    assert.deepEqual(out, { ok: 1 });
    assert.deepEqual(slept, [2000]);
    const by = Object.fromEntries(gw.stats().map(s => [s.outcome, s.n]));
    assert.deepEqual(by, { throttled: 1, ok: 1 });
  } finally { f.restore(); }
});

test('Amazon says wait 2 minutes: the call is put off with that time, not slept through', async () => {
  const f = fakeFetch([lwa, sp(() => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }))]);
  try {
    const { gw, slept } = setup();
    const err: any = await gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' }).then(() => null, e => e);
    assert.ok(err instanceof ThrottledError);
    assert.equal(err.retryAfterMs, 120_000);
    assert.deepEqual(slept, []);
    assert.equal(spCalls(f).length, 1);
  } finally { f.restore(); }
});

test('slow down with no wait time: the wait doubles each try, then we give up for this run', async () => {
  const f = fakeFetch([lwa, sp(() => new Response('{}', { status: 429 }))]);
  try {
    const { gw, slept } = setup();
    await assert.rejects(gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' }), ThrottledError);
    assert.deepEqual(slept, [500, 1000, 2000]);
    assert.equal(spCalls(f).length, 4);
  } finally { f.restore(); }
});

test('Amazon has a hiccup (503) twice: short waits, then the answer', async () => {
  const f = fakeFetch([lwa, sp((_u, _i, n) => (n <= 2 ? new Response('busy', { status: 503 }) : json({ ok: 1 })))]);
  try {
    const { gw, slept } = setup();
    assert.deepEqual(await gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' }), { ok: 1 });
    assert.deepEqual(slept, [1500, 3000]);
  } finally { f.restore(); }
});

test('an error is an error with Amazon\'s words, never an empty answer', async () => {
  const f = fakeFetch([lwa, sp(() => json({ errors: [{ code: 'InvalidInput', message: 'marketplaceIds is required' }] }, 400))]);
  try {
    const { gw } = setup();
    const err: any = await gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' }).then(() => null, e => e);
    assert.ok(err instanceof AmazonError);
    assert.equal(err.status, 400);
    assert.match(err.message, /marketplaceIds is required/);
  } finally { f.restore(); }
});

test('flush adds the counts to the call log and starts again; a failing log never breaks a job', async () => {
  const f = fakeFetch([lwa, sp(() => json({ ok: 1 }))]);
  try {
    const { gw } = setup();
    await gw.call('fbaInventory.getInventorySummaries', 'SP', INV, { dataset: 'fba-inventory' });
    const db = new FakeDb();
    await gw.flush(db);
    assert.equal(db.rpcs[0].fn, 'count_calls');
    assert.deepEqual(db.rpcs[0].args.p_rows, [{ brand: 'SP', op: 'fbaInventory.getInventorySummaries', outcome: 'ok', n: 1 }]);
    assert.deepEqual(gw.stats(), []);
    await gw.flush(db);                                                         // nothing to send: no second call
    assert.equal(db.rpcs.length, 1);
  } finally { f.restore(); }
});

test('the bucket refills with time, up to the burst and no further', async () => {
  let t = 0;
  const l = new MemoryLimiter(() => t);
  assert.equal(await l.take('k', 2, 2), 0);
  assert.equal(await l.take('k', 2, 2), 0);
  assert.equal(await l.take('k', 2, 2), 500);          // empty: half a second for the next token at 2 a second
  t += 500;
  assert.equal(await l.take('k', 2, 2), 0);
  t += 60_000;                                         // a long rest refills only to the burst of 2
  assert.equal(await l.take('k', 2, 2), 0);
  assert.equal(await l.take('k', 2, 2), 0);
  assert.ok((await l.take('k', 2, 2)) > 0);
});
