import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/lib/http-server.ts';
import { ROUTES } from '../src/routes/index.ts';
import { SAVE_ROUTES } from '../src/saves/index.ts';
import { FakeDb, env } from './fakes.ts';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const server = await startServer({
  env, db: new FakeDb(), now: () => NOW,
  apiRoutes: ROUTES, saveRoutes: SAVE_ROUTES,
  health: () => ({ queue: { pending: 0 } }),
}, 0, '127.0.0.1');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

test('/health answers without a key and shows the queue', async () => {
  const r = await fetch(base + '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, queue: { pending: 0 } });
});

test('a moved route answers through the server exactly as through the router', async () => {
  const r = await fetch(base + '/?weekly=keys&weeks=2&key=secret-key');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await r.json(), { ok: true, weeks: ['2026-11-15', '2026-11-22'] });
  const r2 = await fetch(base + '/api?weekly=keys&weeks=1&key=secret-key');
  assert.deepEqual(await r2.json(), { ok: true, weeks: ['2026-11-22'] });
});

test('the wrong key is refused', async () => {
  const j = await (await fetch(base + '/?weekly=keys&key=nope')).json();
  assert.equal(j.ok, false);
  assert.match(j.error, /Unauthorized/);
});

test('POST: JSON sent as text, key inside, as pages send it to Apps Script', async () => {
  const r = await fetch(base + '/save', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: 'secret-key', mcf: 'create' }) });
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.match(j.error, /has not moved to the new backend yet/);
});

test('an unknown path is a 404 with JSON; a body over 1 MB is refused', async () => {
  const r = await fetch(base + '/nothing-here');
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, error: 'Not found.' });
  const big = await fetch(base + '/', { method: 'POST', body: 'x'.repeat(1_100_000) }).then(x => x.json()).catch(() => ({ ok: false, error: 'closed' }));
  assert.equal(big.ok, false);
});
