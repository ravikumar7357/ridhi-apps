import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import { verifyFirebaseIdToken } from '../src/lib/firebase-token.ts';

const PROJECT = 'price-research-48ff3';
const NOW = Date.parse('2026-11-26T10:00:00Z');
const sec = Math.floor(NOW / 1000);

const google = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async () => new Map<string, KeyObject>([['k1', google.publicKey]]);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: object, o: { kid?: string; alg?: string; key?: KeyObject } = {}) {
  const head = b64({ alg: o.alg ?? 'RS256', kid: o.kid ?? 'k1', typ: 'JWT' });
  const body = b64(claims);
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(o.key ?? google.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const good = {
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'uid123', email: 'staff@example.com',
  iat: sec - 60, auth_time: sec - 600, exp: sec + 3000,
};
const check = (t: string) => verifyFirebaseIdToken(t, PROJECT, { now: () => NOW, keys });

test('a good sign-in gives the email', async () => {
  assert.equal(await check(token(good)), 'staff@example.com');
});

test('signed by someone else: not signed in', async () => {
  assert.equal(await check(token(good, { key: stranger.privateKey })), null);
});

test('changed after signing (a different email): not signed in', async () => {
  const [h, , s] = token(good).split('.');
  assert.equal(await check(`${h}.${b64({ ...good, email: 'boss@example.com' })}.${s}`), null);
});

test('expired, from the future, another project, no user: not signed in', async () => {
  assert.equal(await check(token({ ...good, exp: sec - 1 })), null);
  assert.equal(await check(token({ ...good, iat: sec + 3600 })), null);
  assert.equal(await check(token({ ...good, aud: 'some-other-app' })), null);
  assert.equal(await check(token({ ...good, iss: 'https://securetoken.google.com/some-other-app' })), null);
  assert.equal(await check(token({ ...good, sub: '' })), null);
});

test('an unknown key id, a weak algorithm, or rubbish: not signed in, never an error', async () => {
  assert.equal(await check(token(good, { kid: 'k9' })), null);
  assert.equal(await check(token(good, { alg: 'HS256' })), null);
  assert.equal(await check('not-a-token'), null);
  assert.equal(await check(''), null);
  assert.equal(await check('a.b.c'), null);
});

test('a sign-in with no email: not usable here', async () => {
  const { email: _e, ...noEmail } = good;
  assert.equal(await check(token(noEmail)), null);
});
