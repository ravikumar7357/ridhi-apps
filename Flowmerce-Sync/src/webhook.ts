/* Shopify webhooks → Flowmerce, the moment something changes.
 *
 * 1. The signature is checked (HMAC-SHA256 of the exact body, base64) against every key a genuine message may carry:
 *    the store's own webhook key (webhooks made in Shopify admin) and the Flowmerce app's client secret (webhooks the
 *    app registered itself, see setup.ts). The store is the one whose key matches — the shop domain is tried first
 *    (the same rule as shopify-os/shopify-webhook, which fixed swapped keys on 5 Nov). Nothing matches → 401.
 * 2. The message is kept once in flowmerce.raw_webhook_event (X-Shopify-Webhook-Id; a resend is skipped).
 * 3. Then, by topic:
 *      orders/*, refunds/create, fulfillments/*, returns/*   the order is re-read from Shopify and saved
 *                                                            (same function as the timer, so they never disagree)
 *      app/uninstalled                                       the store's connection is marked revoked
 *      customers/data_request, customers/redact, shop/redact Shopify's required privacy webhooks: kept and answered.
 *                                                            Flowmerce stores no customer names, emails, phones or
 *                                                            street addresses, so there is nothing personal to send
 *                                                            or erase; the request stays on record.
 * 4. Shopify gets 200 straight after step 2. If step 3 fails, the 15-minute job picks the order up anyway. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { Shopify } from './shopify.ts';
import { syncOneOrder } from './orders.ts';
import type { ShopCred, StoreBase } from './config.ts';

export const PRIVACY_TOPICS = ['customers/data_request', 'customers/redact', 'shop/redact'];

export function signatureOk(raw: Buffer | string, sent: string, secret: string): boolean {
  if (!sent || !secret) return false;
  const want = createHmac('sha256', secret).update(raw).digest();
  let got: Buffer;
  try { got = Buffer.from(sent, 'base64'); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

type Signer = Pick<StoreBase, 'code' | 'host' | 'webhookSecrets'>;

/** Which store sent it: the shop domain first, then whichever store's key matches. */
export function whichStore<T extends Signer>(raw: Buffer | string, domain: string, sent: string, stores: T[]): T | null {
  const ok = (s: T) => s.webhookSecrets.some(k => signatureOk(raw, sent, k));
  const byDomain = stores.find(s => s.host === domain.toLowerCase());
  if (byDomain && ok(byDomain)) return byDomain;
  // a key shared by both stores (the app secret) cannot tell them apart: then only the domain decides
  const matches = stores.filter(ok);
  if (matches.length === 1) return matches[0];
  return null;
}

/** The order a message is about, for every topic we subscribe to. */
export function orderIdOf(topic: string, payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  if (topic.startsWith('orders/')) return payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (topic.startsWith('returns/')) {
    const o = payload.order;
    if (o?.admin_graphql_api_id) return o.admin_graphql_api_id;
    if (o?.id) return String(o.id).startsWith('gid://') ? String(o.id) : `gid://shopify/Order/${o.id}`;
  }
  if (payload.order_id) return `gid://shopify/Order/${payload.order_id}`;
  return null;
}

export interface WebhookIn { raw: Buffer | string; headers: Record<string, string | undefined> }
export interface WebhookOut { status: number; body: Record<string, unknown> }

/** stores: every store we know (for the signature); credFor: logs in to one store when an order must be re-read. */
export async function handleWebhook(db: Db, stores: StoreBase[], credFor: (s: StoreBase) => Promise<ShopCred | null>,
                                    req: WebhookIn): Promise<WebhookOut> {
  const h = (k: string) => String(req.headers[k] ?? '');
  const domain = h('x-shopify-shop-domain').toLowerCase();
  const topic = h('x-shopify-topic');
  const webhookId = h('x-shopify-webhook-id') || h('x-shopify-event-id');
  const store = whichStore(req.raw, domain, h('x-shopify-hmac-sha256'), stores);
  if (!store) return { status: 401, body: { error: 'signature does not match', shop: domain } };

  let payload: any;
  try { payload = JSON.parse(String(req.raw)); } catch { return { status: 400, body: { error: 'not JSON' } }; }
  if (!webhookId) return { status: 400, body: { error: 'no webhook id' } };

  const kept = await db.webhookKeep(store.code, topic, webhookId, domain,
    { topic, domain, webhook_id: webhookId, api_version: h('x-shopify-api-version') }, payload);
  if (kept.duplicate || kept.id === null) return { status: 200, body: { ok: true, duplicate: true } };
  const id = kept.id;

  if (topic === 'app/uninstalled') {
    await db.appUninstalled(store.code);
    await db.webhookDone(id, null);
    return { status: 200, body: { ok: true, store: store.code, note: 'store disconnected' } };
  }
  if (PRIVACY_TOPICS.includes(topic)) {
    await db.webhookDone(id, null);
    return { status: 200, body: { ok: true, store: store.code, note: 'no customer personal data is stored' } };
  }

  const orderId = orderIdOf(topic, payload);
  if (!orderId) { await db.webhookDone(id, null); return { status: 200, body: { ok: true, note: 'topic not used yet' } }; }
  try {
    const cred = await credFor(store);
    if (!cred) throw new Error('cannot log in to ' + store.code);
    const n = await syncOneOrder(db, new Shopify(cred), orderId);
    await db.webhookDone(id, null);
    return { status: 200, body: { ok: true, store: store.code, saved: n } };
  } catch (e) {
    await db.webhookDone(id, String((e as Error).message || e)).catch(() => {});
    return { status: 200, body: { ok: true, store: store.code, saved: 0, later: 'the 15-minute job will pick it up' } };
  }
}
