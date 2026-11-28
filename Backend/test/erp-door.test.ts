import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/lib/http-server.ts';
import { FakeDb, env } from './fakes.ts';

// A fake database: remembers what it was asked, answers like Supabase.
const asked: { fn: string; auth: string; body: any }[] = [];
const fakeFetch = (async (url: string, init: any) => {
  const fn = String(url).split('/rpc/')[1];
  const body = JSON.parse(init.body);
  asked.push({ fn, auth: init.headers.Authorization, body });
  if (body.p_path === 'pt_secret') return new Response(JSON.stringify({ message: 'rt_get: permission denied' }), { status: 400 });
  if (fn === 'rt_save') return new Response(JSON.stringify(body.p_changes.length), { status: 200 });
  return new Response(JSON.stringify({ a: 1 }), { status: 200 });
}) as unknown as typeof fetch;

const server = await startServer({
  env, db: new FakeDb(), apiRoutes: [], saveRoutes: [],
  verifyIdToken: async t => (t === 'good-token' ? 'staff@ridhihome.com' : null),
  erpFetch: fakeFetch,
}, 0, '127.0.0.1');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const post = async (path: string, body: object) =>
  (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json();

test('no sign-in: refused before the database is asked', async () => {
  asked.length = 0;
  const j = await post('/erp/save', { idToken: 'bad', changes: [{ k: 'put', p: 'x/1', v: 1 }] });
  assert.equal(j.ok, false);
  assert.match(j.error, /Sign in again/);
  assert.equal(asked.length, 0);
});

test('save: signed-in person, sent to rt_save as that person', async () => {
  asked.length = 0;
  const j = await post('/erp/save', { idToken: 'good-token', changes: [{ k: 'put', p: 'x/1', v: 1 }, { k: 'put', p: 'x/2', v: 2 }], screen: 'Masters' });
  assert.deepEqual(j, { ok: true, saved: 2 });
  assert.equal(asked[0].fn, 'rt_save');
  assert.equal(asked[0].auth, 'Bearer good-token');
  assert.equal(asked[0].body.p_screen, 'Masters');
});

test('save with nothing in it is refused', async () => {
  const j = await post('/erp/save', { idToken: 'good-token', changes: [] });
  assert.equal(j.ok, false);
});

test('read: answers the list', async () => {
  const j = await post('/erp/read', { idToken: 'good-token', path: 'pt_baseData' });
  assert.deepEqual(j, { ok: true, value: { a: 1 } });
});

test('the database saying no comes back as ok:false with its reason', async () => {
  const j = await post('/erp/read', { idToken: 'good-token', path: 'pt_secret' });
  assert.equal(j.ok, false);
  assert.match(j.error, /permission denied/);
});

test('GET and unknown doors are refused', async () => {
  assert.equal((await (await fetch(base + '/erp/save')).json()).ok, false);
  assert.equal((await (await fetch(base + '/erp/delete', { method: 'POST', body: '{}' })).json()).ok, false);
});
