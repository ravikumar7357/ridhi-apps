/* The Flowmerce app registers its OWN webhooks in each store, so nobody has to click them in Shopify admin.
 * Runs every 6 hours (and after every deploy, at its first run): lists the app's webhooks, creates any topic that is
 * missing, moves any that point to an old address, and records what Shopify answered in flowmerce.webhook_subscription.
 * Safe to run again and again — a topic that is already right is left alone.
 *
 * Needs the APP's token (webhooks made with Sellora's token would belong to Sellora's app), so it is skipped
 * when the backend is running on the store-token fallback.
 *
 * The three privacy webhooks every app must answer (customers/data_request, customers/redact, shop/redact) cannot be
 * created through the API: their address is set once in the Dev Dashboard (App → Configuration → Compliance webhooks). */

import type { Shopify } from './shopify.ts';

export const TOPICS = [
  'ORDERS_CREATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'ORDERS_PAID', 'ORDERS_FULFILLED', 'REFUNDS_CREATE',
  'FULFILLMENTS_CREATE', 'FULFILLMENTS_UPDATE',
  'RETURNS_REQUEST', 'RETURNS_APPROVE', 'RETURNS_CLOSE',
  'APP_UNINSTALLED',
] as const;

export interface SetupResult { store: string; ok: boolean; kept: string[]; created: string[]; moved: string[]; failed: { topic: string; error: string }[] }
export interface SetupDb { webhookSubscriptionSave(store: string, topic: string, externalId: string | null, url: string, status?: string): Promise<void> }

/** 'ORDERS_CREATE' → 'orders/create' (the name Shopify puts in the X-Shopify-Topic header). */
export const topicHeader = (t: string) => t.toLowerCase().replace('_', '/');

// Newer Admin API versions use `uri`; older ones `endpoint { callbackUrl }` / `callbackUrl`. Both are tried.
const Q = {
  uri: {
    list: `query($after: String) { webhookSubscriptions(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor } nodes { id topic uri } } }`,
    create: `mutation($topic: WebhookSubscriptionTopic!, $url: String!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $url, format: JSON }) {
        webhookSubscription { id } userErrors { field message } } }`,
    update: `mutation($id: ID!, $url: String!) {
      webhookSubscriptionUpdate(id: $id, webhookSubscription: { uri: $url }) {
        webhookSubscription { id } userErrors { field message } } }`,
    urlOf: (n: any) => n.uri as string,
  },
  callbackUrl: {
    list: `query($after: String) { webhookSubscriptions(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor } nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
    create: `mutation($topic: WebhookSubscriptionTopic!, $url: URL!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
        webhookSubscription { id } userErrors { field message } } }`,
    update: `mutation($id: ID!, $url: URL!) {
      webhookSubscriptionUpdate(id: $id, webhookSubscription: { callbackUrl: $url }) {
        webhookSubscription { id } userErrors { field message } } }`,
    urlOf: (n: any) => (n.endpoint?.callbackUrl || '') as string,
  },
};

async function listAll(shop: Shopify, q: typeof Q.uri) {
  const have = new Map<string, { id: string; url: string }>();
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const d = await shop.query(q.list, { after });
    for (const n of d.webhookSubscriptions.nodes) have.set(n.topic, { id: n.id, url: q.urlOf(n) });
    if (!d.webhookSubscriptions.pageInfo.hasNextPage) break;
    after = d.webhookSubscriptions.pageInfo.endCursor;
  }
  return have;
}

export async function ensureWebhooks(db: SetupDb, shop: Shopify, url: string): Promise<SetupResult> {
  const store = shop.cred.code;
  const res: SetupResult = { store, ok: true, kept: [], created: [], moved: [], failed: [] };

  let q = Q.uri, have: Map<string, { id: string; url: string }>;
  try { have = await listAll(shop, q); }
  catch (e) {
    if (!/uri/i.test(String((e as Error).message))) throw e;
    q = Q.callbackUrl;
    have = await listAll(shop, q);
  }

  for (const topic of TOPICS) {
    try {
      const cur = have.get(topic);
      let id: string;
      if (cur && cur.url === url) {
        id = cur.id; res.kept.push(topic);
      } else if (cur) {
        const d = await shop.query(q.update, { id: cur.id, url });
        const r = d.webhookSubscriptionUpdate;
        if (r.userErrors?.length) throw new Error(r.userErrors.map((e: any) => e.message).join('; '));
        id = r.webhookSubscription.id; res.moved.push(topic);
      } else {
        const d = await shop.query(q.create, { topic, url });
        const r = d.webhookSubscriptionCreate;
        if (r.userErrors?.length) throw new Error(r.userErrors.map((e: any) => e.message).join('; '));
        id = r.webhookSubscription.id; res.created.push(topic);
      }
      await db.webhookSubscriptionSave(store, topicHeader(topic), id, url, 'active');
    } catch (e) {
      res.ok = false;
      const error = String((e as Error).message || e).slice(0, 300);
      res.failed.push({ topic, error });
      await db.webhookSubscriptionSave(store, topicHeader(topic), null, url, 'failing').catch(() => {});
    }
  }
  return res;
}
