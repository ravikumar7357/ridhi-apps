import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureWebhooks, TOPICS, topicHeader } from '../src/setup.ts';

const URL_ = 'https://asia-south1-price-research-48ff3.cloudfunctions.net/flowmerceShopifyWebhook';

function fakeShop(existing: { topic: string; url: string }[], mode: 'uri' | 'callbackUrl' = 'uri') {
  const created: string[] = [], updated: string[] = [];
  return {
    created, updated,
    cred: { code: 'RBP' },
    query: async (q: string, v: any) => {
      if (q.includes('webhookSubscriptions(')) {
        if (mode === 'callbackUrl' && q.includes(' uri ')) throw new Error("Shopify: Field 'uri' doesn't exist on type 'WebhookSubscription'");
        return { webhookSubscriptions: { pageInfo: { hasNextPage: false, endCursor: null },
          nodes: existing.map((e, i) => (mode === 'uri' ? { id: 'w' + i, topic: e.topic, uri: e.url }
                                                       : { id: 'w' + i, topic: e.topic, endpoint: { callbackUrl: e.url } })) } };
      }
      if (q.includes('webhookSubscriptionCreate')) { created.push(v.topic); return { webhookSubscriptionCreate: { webhookSubscription: { id: 'new-' + v.topic }, userErrors: [] } }; }
      if (q.includes('webhookSubscriptionUpdate')) { updated.push(v.id); return { webhookSubscriptionUpdate: { webhookSubscription: { id: v.id }, userErrors: [] } }; }
      throw new Error('unexpected query');
    },
  } as any;
}
const fakeDb = () => { const saved: string[] = []; return { saved, webhookSubscriptionSave: async (_s: string, t: string, _id: any, _u: string, st = 'active') => { saved.push(t + ':' + st); } }; };

test('creates only the missing topics, moves one pointing elsewhere, keeps the right ones', async () => {
  const shop = fakeShop([{ topic: 'ORDERS_CREATE', url: URL_ }, { topic: 'ORDERS_UPDATED', url: 'https://old.example/hook' }]);
  const db = fakeDb();
  const r = await ensureWebhooks(db, shop, URL_);
  assert.equal(r.ok, true);
  assert.deepEqual(r.kept, ['ORDERS_CREATE']);
  assert.deepEqual(r.moved, ['ORDERS_UPDATED']);
  assert.equal(r.created.length, TOPICS.length - 2);
  assert.ok(!shop.created.includes('ORDERS_CREATE'));
  assert.equal(db.saved.length, TOPICS.length);
  assert.ok(db.saved.includes('app/uninstalled:active'));
});

test('running it again changes nothing', async () => {
  const shop = fakeShop(TOPICS.map(t => ({ topic: t, url: URL_ })));
  const r = await ensureWebhooks(fakeDb(), shop, URL_);
  assert.equal(r.created.length + r.moved.length, 0);
  assert.equal(r.kept.length, TOPICS.length);
});

test('works on the older API (callbackUrl) too', async () => {
  const shop = fakeShop([{ topic: 'ORDERS_CREATE', url: URL_ }], 'callbackUrl');
  const r = await ensureWebhooks(fakeDb(), shop, URL_);
  assert.equal(r.ok, true);
  assert.deepEqual(r.kept, ['ORDERS_CREATE']);
  assert.equal(r.created.length, TOPICS.length - 1);
});

test('topic names as Shopify sends them in the header', () => {
  assert.equal(topicHeader('ORDERS_CREATE'), 'orders/create');
  assert.equal(topicHeader('APP_UNINSTALLED'), 'app/uninstalled');
  assert.equal(topicHeader('RETURNS_REQUEST'), 'returns/request');
});
