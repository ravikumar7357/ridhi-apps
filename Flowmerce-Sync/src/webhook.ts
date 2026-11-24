/* Shopify webhooks → Flowmerce, the moment an order changes.
 *
 * 1. The signature is checked with the store's webhook key (HMAC-SHA256 of the exact body, base64).
 *    The store is the one whose key signed it (the same rule as shopify-os/shopify-webhook, which fixed a swapped-keys
 *    problem on 5 Nov). Nothing matches → 401, nothing saved.
 * 2. The message is kept once in flowmerce.raw_webhook_event (Shopify's X-Shopify-Webhook-Id; a resend is skipped).
 * 3. The order is re-read from Shopify by id and saved with the same function the timer uses, so a webhook and the
 *    timer can never disagree about what an order looks like.
 * 4. Shopify gets 200 straight after step 2. If step 3 fails, the 15-minute job picks the order up anyway.
 *
 * Topics to subscribe: orders/create, orders/updated, orders/cancelled, orders/paid, orders/fulfilled,
 * fulfillments/create, fulfillments/update, refunds/create. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { Shopify } from './shopify.ts';
import { syncOneOrder } from './orders.ts';
import type { ShopCred } from './config.ts';

export function signatureOk(raw: Buffer | string, sent: string, secret: string): boolean {
  if (!sent || !secret) return false;
  const want = createHmac('sha256', secret).update(raw).digest();
  let got: Buffer;
  try { got = Buffer.from(sent, 'base64'); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Which store sent it: the shop domain first, then whichever store's key matches. */
export function whichStore(raw: Buffer | string, domain: string, sent: string, creds: ShopCred[]): ShopCred | null {
  const byDomain = creds.find(c => c.host === domain.toLowerCase());
  if (byDomain && signatureOk(raw, sent, byDomain.webhookSecret)) return byDomain;
  return creds.find(c => signatureOk(raw, sent, c.webhookSecret)) || null;
}

/** The order a message is about, for every topic we subscribe to. */
export function orderIdOf(topic: string, payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  if (topic.startsWith('orders/')) return payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (payload.order_id) return `gid://shopify/Order/${payload.order_id}`;
  return null;
}

export interface WebhookIn { raw: Buffer | string; headers: Record<string, string | undefined> }
export interface WebhookOut { status: number; body: Record<string, unknown> }

export async function handleWebhook(db: Db, creds: ShopCred[], req: WebhookIn): Promise<WebhookOut> {
  const h = (k: string) => String(req.headers[k] ?? '');
  const domain = h('x-shopify-shop-domain').toLowerCase();
  const topic = h('x-shopify-topic');
  const webhookId = h('x-shopify-webhook-id') || h('x-shopify-event-id');
  const cred = whichStore(req.raw, domain, h('x-shopify-hmac-sha256'), creds);
  if (!cred) return { status: 401, body: { error: 'signature does not match', shop: domain } };

  let payload: any;
  try { payload = JSON.parse(String(req.raw)); } catch { return { status: 400, body: { error: 'not JSON' } }; }
  if (!webhookId) return { status: 400, body: { error: 'no webhook id' } };

  const kept = await db.webhookKeep(cred.code, topic, webhookId, domain,
    { topic, domain, webhook_id: webhookId, api_version: h('x-shopify-api-version') }, payload);
  if (kept.duplicate || kept.id === null) return { status: 200, body: { ok: true, duplicate: true } };

  const orderId = orderIdOf(topic, payload);
  if (!orderId) { await db.webhookDone(kept.id, null); return { status: 200, body: { ok: true, note: 'topic not used yet' } }; }
  try {
    const n = await syncOneOrder(db, new Shopify(cred), orderId);
    await db.webhookDone(kept.id, null);
    return { status: 200, body: { ok: true, store: cred.code, saved: n } };
  } catch (e) {
    await db.webhookDone(kept.id, String((e as Error).message || e)).catch(() => {});
    return { status: 200, body: { ok: true, store: cred.code, saved: 0, later: 'the 15-minute job will pick it up' } };
  }
}
