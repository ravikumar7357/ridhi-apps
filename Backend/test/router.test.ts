import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, findRoute, askedFor, type Route, type Deps } from '../src/lib/router.ts';
import { FakeDb, env, envFrom, ENV } from './fakes.ts';

const echo: Route = { name: 'echo', method: 'GET', param: 'echo', auth: 'key', async run(p) { return { ok: true, got: p }; } };
const boom: Route = { name: 'boom', method: 'GET', param: 'boom', auth: 'key', async run() { throw new Error('x'.repeat(400)); } };
const adsA: Route = { name: 'ads:profiles', method: 'GET', param: 'ads', value: 'profiles', auth: 'key', async run() { return { ok: true, a: 1 }; } };
const adsB: Route = { name: 'ads:ppcCreate', method: 'GET', param: 'ads', value: 'ppcCreate', auth: 'key', async run() { return { ok: true, b: 1 }; } };
const write: Route = { name: 'mail:po', method: 'POST', param: 'mail', value: 'po', auth: 'signin', async run(p, ctx) { return { ok: true, p, who: ctx.who }; } };

const deps = (over: Partial<Deps> = {}): Deps => ({
  env, db: new FakeDb(), routes: [echo, boom, adsA, adsB, write],
  verifyIdToken: async (t) => (t === 'good-token' ? 'staff@example.com' : null), ...over,
});
const body = (a: { body: string }) => JSON.parse(a.body);

test('no API_KEY on the backend: says so, like Apps Script', async () => {
  const a = await handle(deps({ env: envFrom({ ...ENV, API_KEY: '' }) }), 'GET', { echo: '1', key: 'x' }, '');
  assert.deepEqual(body(a), { ok: false, error: 'API_KEY is not set on the backend.' });
});

test('wrong or missing key on GET: the same words as Apps Script', async () => {
  assert.deepEqual(body(await handle(deps(), 'GET', { echo: '1', key: 'abc' }, '')),
    { ok: false, error: 'Unauthorized. (sent a 3-char key; backend expects 10)' });
  assert.deepEqual(body(await handle(deps(), 'GET', { echo: '1' }, '')),
    { ok: false, error: 'Unauthorized. (no key sent)' });
});

test('a key with a stray space still works (Apps Script trims it too)', async () => {
  const a = body(await handle(deps(), 'GET', { echo: '1', key: ' secret-key\n' }, ''));
  assert.equal(a.ok, true);
});

test('POST: JSON in a text/plain body, key inside; bad JSON and wrong key answered like doPost', async () => {
  assert.deepEqual(body(await handle(deps(), 'POST', {}, 'not json')), { ok: false, error: 'Body was not JSON.' });
  assert.deepEqual(body(await handle(deps(), 'POST', {}, '{"mail":"po","key":"nope"}')), { ok: false, error: 'Unauthorized.' });
});

test('a route that has not moved yet fails loudly and names itself', async () => {
  const a = body(await handle(deps(), 'GET', { ads: 'ppcStatus', brand: 'CPC', id: '9', key: 'secret-key' }, ''));
  assert.equal(a.ok, false);
  assert.match(a.error, /ads:ppcStatus/);
  assert.match(a.error, /not moved/);
});

test('routes that share a parameter are told apart by its value', () => {
  assert.equal(findRoute([adsA, adsB], 'GET', { ads: 'ppcCreate' })?.name, 'ads:ppcCreate');
  assert.equal(findRoute([adsA, adsB], 'GET', { ads: 'profiles' })?.name, 'ads:profiles');
  assert.equal(findRoute([adsA, adsB], 'POST', { ads: 'profiles' }), null);
  assert.equal(askedFor({ key: 'k', lh: 'poll', brand: 'SP', id: '1' }), 'lh:poll');
  assert.equal(askedFor({ key: 'k', asin: 'B0ABCDEFGH' }), 'asin');
});

test('the key and the sign-in token never reach the route', async () => {
  const a = body(await handle(deps(), 'GET', { echo: '1', key: 'secret-key', x: '2' }, ''));
  assert.deepEqual(a.got, { echo: '1', x: '2' });
});

test('a route that throws gives ok:false with the message cut to 300 characters', async () => {
  const a = body(await handle(deps(), 'GET', { boom: '1', key: 'secret-key' }, ''));
  assert.equal(a.ok, false);
  assert.equal(a.error.length, 300);
});

test('sign-in routes refuse without a good token, and pass the email when it is good', async () => {
  const no = body(await handle(deps(), 'POST', {}, JSON.stringify({ mail: 'po', key: 'secret-key', idToken: 'bad' })));
  assert.equal(no.ok, false);
  assert.match(no.error, /Sign in again/);
  const yes = body(await handle(deps(), 'POST', {}, JSON.stringify({ mail: 'po', key: 'secret-key', idToken: 'good-token', to: 'v' })));
  assert.deepEqual(yes, { ok: true, p: { mail: 'po', to: 'v' }, who: { email: 'staff@example.com' } });
});

test('always HTTP 200 with JSON (pages read ok, not the status); OPTIONS is answered for CORS', async () => {
  const a = await handle(deps(), 'GET', { nothing: '1', key: 'secret-key' }, '');
  assert.equal(a.status, 200);
  assert.match(a.headers['Content-Type'], /application\/json/);
  const o = await handle(deps(), 'OPTIONS', {}, '');
  assert.equal(o.status, 204);
  assert.equal(o.headers['Access-Control-Allow-Origin'], '*');
});

test('every request is logged once, with route, ok and time', async () => {
  const lines: any[] = [];
  await handle(deps({ log: l => lines.push(l) }), 'GET', { echo: '1', key: 'secret-key' }, '');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].route, 'echo');
  assert.equal(lines[0].ok, true);
  assert.equal(typeof lines[0].ms, 'number');
});
