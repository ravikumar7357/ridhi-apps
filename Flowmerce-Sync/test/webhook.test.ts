import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signatureOk, whichStore, orderIdOf, handleWebhook } from '../src/webhook.ts';
import type { ShopCred } from '../src/config.ts';

const RBP: ShopCred = { code: 'RBP', host: 'guz0he-21.myshopify.com', token: 'shpat_x', webhookSecret: 'rbp-secret' };
const CPC: ShopCred = { code: 'CPC', host: 'liquidationfashion.myshopify.com', token: 'shpat_y', webhookSecret: 'cpc-secret' };
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64');

test('signature check', () => {
  const body = '{"id":1}';
  assert.equal(signatureOk(body, sign(body, 'k'), 'k'), true);
  assert.equal(signatureOk(body, sign(body, 'k'), 'other'), false);
  assert.equal(signatureOk(body, '', 'k'), false);
});

test('the store is the one whose key signed it, even with a wrong domain', () => {
  const body = '{"id":1}';
  assert.equal(whichStore(body, 'guz0he-21.myshopify.com', sign(body, 'rbp-secret'), [RBP, CPC])?.code, 'RBP');
  assert.equal(whichStore(body, 'renamed.myshopify.com', sign(body, 'cpc-secret'), [RBP, CPC])?.code, 'CPC');
  assert.equal(whichStore(body, 'guz0he-21.myshopify.com', sign(body, 'nobody'), [RBP, CPC]), null);
});

test('order id for each topic', () => {
  assert.equal(orderIdOf('orders/updated', { id: 5, admin_graphql_api_id: 'gid://shopify/Order/5' }), 'gid://shopify/Order/5');
  assert.equal(orderIdOf('fulfillments/update', { id: 9, order_id: 5 }), 'gid://shopify/Order/5');
  assert.equal(orderIdOf('refunds/create', { order_id: 5 }), 'gid://shopify/Order/5');
  assert.equal(orderIdOf('products/update', { id: 1 }), null);
});

function fakeDb(dup = false) {
  const calls: string[] = [];
  return {
    calls,
    webhookKeep: async () => { calls.push('keep'); return { id: dup ? null : 1, duplicate: dup }; },
    webhookDone: async (_id: number, err?: string | null) => { calls.push(err ? 'done:error' : 'done'); },
    ingestOrders: async () => { calls.push('ingest'); return { orders: 1 }; },
  } as any;
}

test('a bad signature is refused and nothing is kept', async () => {
  const db = fakeDb();
  const out = await handleWebhook(db, [RBP, CPC], { raw: '{"id":1}', headers: { 'x-shopify-hmac-sha256': 'bad', 'x-shopify-webhook-id': 'w1' } });
  assert.equal(out.status, 401);
  assert.deepEqual(db.calls, []);
});

test('a resend is answered 200 and not processed again', async () => {
  const db = fakeDb(true);
  const body = '{"id":1,"admin_graphql_api_id":"gid://shopify/Order/1"}';
  const out = await handleWebhook(db, [RBP], { raw: body, headers: {
    'x-shopify-hmac-sha256': sign(body, 'rbp-secret'), 'x-shopify-webhook-id': 'w1', 'x-shopify-topic': 'orders/updated',
    'x-shopify-shop-domain': RBP.host } });
  assert.equal(out.status, 200);
  assert.equal(out.body.duplicate, true);
  assert.deepEqual(db.calls, ['keep']);
});

test('if Shopify cannot be read, the message is kept, marked failed, and Shopify still gets 200', async () => {
  const db = fakeDb();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"errors":[{"message":"boom"}]}', { status: 200 })) as any;
  try {
    const body = '{"id":1,"admin_graphql_api_id":"gid://shopify/Order/1"}';
    const out = await handleWebhook(db, [RBP], { raw: body, headers: {
      'x-shopify-hmac-sha256': sign(body, 'rbp-secret'), 'x-shopify-webhook-id': 'w2', 'x-shopify-topic': 'orders/updated',
      'x-shopify-shop-domain': RBP.host } });
    assert.equal(out.status, 200);
    assert.deepEqual(db.calls, ['keep', 'done:error']);
  } finally { globalThis.fetch = realFetch; }
});
