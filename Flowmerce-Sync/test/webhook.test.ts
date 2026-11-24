import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signatureOk, whichStore, orderIdOf, handleWebhook } from '../src/webhook.ts';
import type { ShopCred, StoreBase } from '../src/config.ts';

const APP = 'app-client-secret';
const RBP: StoreBase = { code: 'RBP', host: 'guz0he-21.myshopify.com', storeToken: 'shpat_x', webhookSecrets: ['rbp-secret', APP] };
const CPC: StoreBase = { code: 'CPC', host: 'liquidationfashion.myshopify.com', storeToken: 'shpat_y', webhookSecrets: ['cpc-secret', APP] };
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64');
const credFor = async (s: StoreBase): Promise<ShopCred> => ({ code: s.code, host: s.host, token: 'tok', via: 'app', webhookSecrets: s.webhookSecrets });

test('signature check', () => {
  const body = '{"id":1}';
  assert.equal(signatureOk(body, sign(body, 'k'), 'k'), true);
  assert.equal(signatureOk(body, sign(body, 'k'), 'other'), false);
  assert.equal(signatureOk(body, '', 'k'), false);
});

test('the store is the one whose key signed it; the shared app key needs the right domain', () => {
  const body = '{"id":1}';
  assert.equal(whichStore(body, RBP.host, sign(body, 'rbp-secret'), [RBP, CPC])?.code, 'RBP');
  assert.equal(whichStore(body, 'renamed.myshopify.com', sign(body, 'cpc-secret'), [RBP, CPC])?.code, 'CPC');
  assert.equal(whichStore(body, CPC.host, sign(body, APP), [RBP, CPC])?.code, 'CPC');
  assert.equal(whichStore(body, 'renamed.myshopify.com', sign(body, APP), [RBP, CPC]), null, 'app key + unknown domain is ambiguous');
  assert.equal(whichStore(body, RBP.host, sign(body, 'nobody'), [RBP, CPC]), null);
});

test('order id for each topic', () => {
  assert.equal(orderIdOf('orders/updated', { id: 5, admin_graphql_api_id: 'gid://shopify/Order/5' }), 'gid://shopify/Order/5');
  assert.equal(orderIdOf('fulfillments/update', { id: 9, order_id: 5 }), 'gid://shopify/Order/5');
  assert.equal(orderIdOf('refunds/create', { order_id: 5 }), 'gid://shopify/Order/5');
  assert.equal(orderIdOf('returns/request', { order: { admin_graphql_api_id: 'gid://shopify/Order/7' } }), 'gid://shopify/Order/7');
  assert.equal(orderIdOf('returns/close', { order: { id: 'gid://shopify/Order/8' } }), 'gid://shopify/Order/8');
  assert.equal(orderIdOf('products/update', { id: 1 }), null);
});

function fakeDb(dup = false) {
  const calls: string[] = [];
  return {
    calls,
    webhookKeep: async () => { calls.push('keep'); return { id: dup ? null : 1, duplicate: dup }; },
    webhookDone: async (_id: number, err?: string | null) => { calls.push(err ? 'done:error' : 'done'); },
    ingestOrders: async () => { calls.push('ingest'); return { orders: 1 }; },
    appUninstalled: async (s: string) => { calls.push('uninstalled:' + s); },
  } as any;
}
const hdr = (body: string, secret: string, topic: string, id: string, domain = RBP.host) => ({
  'x-shopify-hmac-sha256': sign(body, secret), 'x-shopify-webhook-id': id, 'x-shopify-topic': topic, 'x-shopify-shop-domain': domain });

test('a bad signature is refused and nothing is kept', async () => {
  const db = fakeDb();
  const out = await handleWebhook(db, [RBP, CPC], credFor, { raw: '{"id":1}', headers: { 'x-shopify-hmac-sha256': 'bad', 'x-shopify-webhook-id': 'w1' } });
  assert.equal(out.status, 401);
  assert.deepEqual(db.calls, []);
});

test('a resend is answered 200 and not processed again', async () => {
  const db = fakeDb(true);
  const body = '{"id":1,"admin_graphql_api_id":"gid://shopify/Order/1"}';
  const out = await handleWebhook(db, [RBP], credFor, { raw: body, headers: hdr(body, APP, 'orders/updated', 'w1') });
  assert.equal(out.status, 200);
  assert.equal(out.body.duplicate, true);
  assert.deepEqual(db.calls, ['keep']);
});

test('app/uninstalled disconnects the store', async () => {
  const db = fakeDb();
  const body = '{"id":1}';
  const out = await handleWebhook(db, [RBP, CPC], credFor, { raw: body, headers: hdr(body, APP, 'app/uninstalled', 'w3', CPC.host) });
  assert.equal(out.status, 200);
  assert.deepEqual(db.calls, ['keep', 'uninstalled:CPC', 'done']);
});

test('privacy webhooks are kept and answered 200, with a 401 for a forged one', async () => {
  for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
    const db = fakeDb();
    const body = '{"shop_domain":"guz0he-21.myshopify.com"}';
    const out = await handleWebhook(db, [RBP], credFor, { raw: body, headers: hdr(body, APP, topic, 'p-' + topic) });
    assert.equal(out.status, 200, topic);
    assert.deepEqual(db.calls, ['keep', 'done'], topic);
    const forged = await handleWebhook(fakeDb(), [RBP], credFor, { raw: body, headers: hdr(body, 'wrong', topic, 'f-' + topic) });
    assert.equal(forged.status, 401, topic);
  }
});

test('if Shopify cannot be read, the message is kept, marked failed, and Shopify still gets 200', async () => {
  const db = fakeDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"errors":[{"message":"boom"}]}', { status: 200 })) as any;
  try {
    const body = '{"id":1,"admin_graphql_api_id":"gid://shopify/Order/1"}';
    const out = await handleWebhook(db, [RBP], credFor, { raw: body, headers: hdr(body, 'rbp-secret', 'orders/updated', 'w2') });
    assert.equal(out.status, 200);
    assert.deepEqual(db.calls, ['keep', 'done:error']);
  } finally { globalThis.fetch = realFetch; }
});
