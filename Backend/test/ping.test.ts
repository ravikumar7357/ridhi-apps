import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../src/lib/router.ts';
import { ROUTES } from '../src/routes/index.ts';
import { clearTokenCache } from '../src/lib/amazon.ts';
import { diffJson, describe } from '../src/lib/parity.ts';
import { FakeDb, env, envFrom, ENV, fakeFetch, lwa } from './fakes.ts';

const golden = JSON.parse(readFileSync(new URL('./golden/ping.json', import.meta.url), 'utf8'));
const ask = (e = env) => handle({ env: e, db: new FakeDb(), routes: ROUTES }, 'GET', { ping: '1', key: 'secret-key' }, '');

beforeEach(() => clearTokenCache());

test('ping answers exactly what Apps Script answers', async () => {
  const f = fakeFetch([lwa]);
  try {
    const got = JSON.parse((await ask()).body);
    const diffs = diffJson(golden, got);
    assert.equal(diffs.length, 0, describe(diffs));
  } finally { f.restore(); }
});

test('ping logs in to Amazon with Ridhi (SP) credentials, and only once while the token is fresh', async () => {
  const f = fakeFetch([lwa]);
  try {
    await ask(); await ask();
    const logins = f.calls.filter(c => c.url.startsWith('https://api.amazon.com/'));
    assert.equal(logins.length, 1);
    assert.match(logins[0].body!, /client_id=spid/);
  } finally { f.restore(); }
});

test('missing credentials: the same message as Apps Script getToken_', async () => {
  const got = JSON.parse((await ask(envFrom({ ...ENV, SP_REFRESH_TOKEN: 'none' }))).body);
  assert.deepEqual(got, { ok: false, error: 'SP credentials missing in Script Properties.' });
});

test('Amazon refuses the login: ok:false with Amazon\'s words', async () => {
  const f = fakeFetch([lwa]);
  try {
    const got = JSON.parse((await ask(envFrom({ ...ENV, SP_REFRESH_TOKEN: 'expired' }))).body);
    assert.equal(got.ok, false);
    assert.match(got.error, /invalid grant/);
  } finally { f.restore(); }
});

test('a brand set to the EU region answers the EU host (same rule as spHost_)', async () => {
  const f = fakeFetch([lwa]);
  try {
    const got = JSON.parse((await ask(envFrom({ ...ENV, SP_REGION: 'eu', SP_MARKETPLACE_ID: 'A1F83G8C2ARO7P' }))).body);
    assert.equal(got.host, 'https://sellingpartnerapi-eu.amazon.com');
    assert.equal(got.marketplace, 'A1F83G8C2ARO7P');
  } finally { f.restore(); }
});
