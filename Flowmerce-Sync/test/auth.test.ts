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
    const e = env({ SHOPIFY_STORE: 'guz0he-21', SHOPIFY_TOKEN: 'shpat_store', FLOWMERCE_RBP_CLIENT_ID: 'cid', FLOWMERCE_RBP_CLIENT_SECRET: 'csec' });
    const r = await resolveCred(storeBase(e, 'RBP')!, appCred(e, 'RBP'));
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
                            FLOWMERCE_CPC_CLIENT_ID: 'cid', FLOWMERCE_CPC_CLIENT_SECRET: 'same' }), 'CPC')!;
  assert.deepEqual(b.webhookSecrets, ['same']);
  assert.equal(b.host, 'liquidationfashion.myshopify.com');
});

test('one app per store: each store uses its own app, never the other store\'s', async () => {
  const e = env({
    SHOPIFY_STORE: 'guz0he-21', CPC_SHOPIFY_STORE: 'liquidationfashion',
    FLOWMERCE_RBP_CLIENT_ID: 'rbp-id', FLOWMERCE_RBP_CLIENT_SECRET: 'rbp-secret',
    FLOWMERCE_CPC_CLIENT_ID: 'cpc-id', FLOWMERCE_CPC_CLIENT_SECRET: 'cpc-secret',
  });
  assert.deepEqual(appCred(e, 'RBP'), { clientId: 'rbp-id', clientSecret: 'rbp-secret' });
  assert.deepEqual(appCred(e, 'CPC'), { clientId: 'cpc-id', clientSecret: 'cpc-secret' });
  assert.deepEqual(storeBase(e, 'RBP')!.webhookSecrets, ['rbp-secret']);
  assert.deepEqual(storeBase(e, 'CPC')!.webhookSecrets, ['cpc-secret']);
  // a store whose app is not set up yet has no app login (falls back to its store token)
  assert.equal(appCred(env({ FLOWMERCE_RBP_CLIENT_ID: 'only-id' }), 'RBP'), null);

  clearTokenCache();
  const real = globalThis.fetch;
  const { f, seen } = fakeFetch(url => new Response(JSON.stringify({ access_token: url.includes('guz0he') ? 'tok-rbp' : 'tok-cpc', expires_in: 86399 }), { status: 200 }));
  globalThis.fetch = f;
  try {
    const rbp = await resolveCred(storeBase(e, 'RBP')!, appCred(e, 'RBP'));
    const cpc = await resolveCred(storeBase(e, 'CPC')!, appCred(e, 'CPC'));
    assert.equal(rbp.cred?.token, 'tok-rbp');
    assert.equal(cpc.cred?.token, 'tok-cpc');
    assert.equal(new URLSearchParams(seen[0].body).get('client_id'), 'rbp-id');
    assert.equal(new URLSearchParams(seen[1].body).get('client_id'), 'cpc-id');
  } finally { globalThis.fetch = real; clearTokenCache(); }
});
