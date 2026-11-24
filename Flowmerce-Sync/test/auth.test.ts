import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appToken, resolveCred, clearTokenCache } from '../src/auth.ts';
import { storeBase, appCred } from '../src/config.ts';

const env = (vals: Record<string, string>) => (n: string) => vals[n] || '';

function fakeFetch(answer: (url: string, init: any) => Response) {
  const seen: { url: string; body: string }[] = [];
  const f = (async (url: string, init: any) => { seen.push({ url, body: String(init?.body || '') }); return answer(url, init); }) as any;
  return { f, seen };
}

test('app login: client-credentials request, token kept in memory until near expiry', async () => {
  clearTokenCache();
  const real = globalThis.fetch;
  const { f, seen } = fakeFetch(() => new Response('{"access_token":"tok-1","scope":"read_orders","expires_in":86399}', { status: 200 }));
  globalThis.fetch = f;
  try {
    const app = { clientId: 'cid', clientSecret: 'csec' };
    assert.equal(await appToken('guz0he-21.myshopify.com', app, 1_000), 'tok-1');
    assert.equal(seen[0].url, 'https://guz0he-21.myshopify.com/admin/oauth/access_token');
    const body = new URLSearchParams(seen[0].body);
    assert.equal(body.get('grant_type'), 'client_credentials');
    assert.equal(body.get('client_id'), 'cid');
    assert.equal(body.get('client_secret'), 'csec');
    await appToken('guz0he-21.myshopify.com', app, 2_000);                      // cached
    assert.equal(seen.length, 1);
    await appToken('guz0he-21.myshopify.com', app, 1_000 + 86_399_000 - 5 * 60_000);  // 5 min before expiry → fetch again
    assert.equal(seen.length, 2);
  } finally { globalThis.fetch = real; clearTokenCache(); }
});

test('if the app cannot log in, the store token is used and the reason is given', async () => {
  clearTokenCache();
  const real = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => new Response('{"error":"app not installed"}', { status: 400 })).f;
  try {
    const e = env({ SHOPIFY_STORE: 'guz0he-21', SHOPIFY_TOKEN: 'shpat_store', FLOWMERCE_APP_CLIENT_ID: 'cid', FLOWMERCE_APP_CLIENT_SECRET: 'csec' });
    const r = await resolveCred(storeBase(e, 'RBP')!, appCred(e));
    assert.equal(r.cred?.via, 'store_token');
    assert.equal(r.cred?.token, 'shpat_store');
    assert.match(r.note || '', /app login refused/);
  } finally { globalThis.fetch = real; clearTokenCache(); }
});

test('without app secrets the store token is used quietly; with neither the store is skipped', async () => {
  const r1 = await resolveCred(storeBase(env({ SHOPIFY_STORE: 'guz0he-21', SHOPIFY_TOKEN: 'shpat_store' }), 'RBP')!, null);
  assert.equal(r1.cred?.via, 'store_token');
  assert.equal(r1.note, undefined);
  const r2 = await resolveCred(storeBase(env({ CPC_SHOPIFY_STORE: 'liquidationfashion' }), 'CPC')!, null);
  assert.equal(r2.cred, null);
});

test('webhook keys: the store key and the app secret, without duplicates', () => {
  const b = storeBase(env({ CPC_SHOPIFY_STORE: 'liquidationfashion.myshopify.com', SHOPIFY_WEBHOOK_SECRET_CPC: 'same',
                            FLOWMERCE_APP_CLIENT_ID: 'cid', FLOWMERCE_APP_CLIENT_SECRET: 'same' }), 'CPC')!;
  assert.deepEqual(b.webhookSecrets, ['same']);
  assert.equal(b.host, 'liquidationfashion.myshopify.com');
});
