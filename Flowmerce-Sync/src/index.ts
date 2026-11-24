/* Flowmerce's sync backend on Firebase (project price-research-48ff3, codebase "flowmerce-sync").
 * Only THIS file knows about Firebase. Everything else is plain TypeScript, so on "Firebase zero" day only this file
 * is swapped for Cloud Run (or any other runner).
 *
 *   flowmerceShopifyOrders    every 15 min · orders changed since last run → flowmerce.*   (RBP, then CPC)
 *   flowmerceShopifyBackfill  every 5 min  · older orders, a few pages per run, while switched on in flowmerce.sync_job
 *   flowmerceShopifySetup     every 30 min · the Flowmerce app's own webhooks in each store (creates missing ones;
 *                                            one Shopify call per store when nothing is missing)
 *   flowmerceShopifyWebhook   HTTPS        · Shopify calls it when an order, parcel or return changes
 *
 * Shopify access: each store's own Flowmerce app (client ID + secret → store token), falling back to Sellora's store tokens.
 * Region asia-south1 (Mumbai), next to the Supabase ERP project. One copy at a time for the timers.
 * What each run did: flowmerce.sync_run, flowmerce.webhook_subscription, and the Firebase function logs. */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { SECRET_NAMES, STORES, SUPABASE_URL, WEBHOOK_URL, appCred, processEnv, storeBase, type ShopCred, type StoreBase } from './config.ts';
import { resolveCred } from './auth.ts';
import { Db } from './db.ts';
import { Shopify } from './shopify.ts';
import { runOrders } from './orders.ts';
import { ensureWebhooks } from './setup.ts';
import { handleWebhook } from './webhook.ts';

const secrets = SECRET_NAMES.map(n => defineSecret(n));

function db(): Db {
  const key = processEnv('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is not set');
  return new Db(process.env.SUPABASE_URL || SUPABASE_URL, key);
}

function stores(): StoreBase[] {
  return STORES.map(s => storeBase(processEnv, s)).filter((b): b is StoreBase => !!b);
}

/** Log in to every store (app first, store token as fallback). Notes say why a fallback was used. */
async function creds(d: Db | null): Promise<{ list: ShopCred[]; notes: Record<string, string> }> {
  const list: ShopCred[] = [], notes: Record<string, string> = {};
  for (const b of stores()) {
    const r = await resolveCred(b, appCred(processEnv, b.code));     // each store logs in with its own app
    if (r.note) notes[b.code] = r.note;
    if (r.cred) {
      list.push(r.cred);
      if (r.cred.via === 'app' && d) await d.appOk(b.code).catch(() => {});
    }
  }
  return { list, notes };
}

async function runAll(mode: 'incremental' | 'backfill', budgetMs: number) {
  const d = db();
  const owner = `${mode}:${process.env.K_REVISION || 'local'}:${Date.now()}`;
  const { list, notes } = await creds(d);
  const out = [];
  for (const c of list) {
    try { out.push({ via: c.via, ...(await runOrders(d, new Shopify(c), mode, owner, budgetMs / 2)) }); }
    catch (e) { out.push({ store: c.code, via: c.via, mode, ok: false, error: String((e as Error).message) }); }
  }
  logger.info(`flowmerce shopify ${mode}`, { results: out, login: notes });
  const bad = out.filter(r => !r.ok);
  if (bad.length) logger.warn(`flowmerce shopify ${mode}: some stores failed`, bad);
}

export const flowmerceShopifyOrders = onSchedule(
  { schedule: 'every 15 minutes', region: 'asia-south1', memory: '512MiB', timeoutSeconds: 540,
    maxInstances: 1, retryCount: 0, secrets },
  async () => { await runAll('incremental', 480_000); },
);

export const flowmerceShopifyBackfill = onSchedule(
  { schedule: 'every 5 minutes', region: 'asia-south1', memory: '512MiB', timeoutSeconds: 300,
    maxInstances: 1, retryCount: 0, secrets },
  async () => { await runAll('backfill', 240_000); },
);

export const flowmerceShopifySetup = onSchedule(
  { schedule: 'every 30 minutes', region: 'asia-south1', memory: '256MiB', timeoutSeconds: 120,
    maxInstances: 1, retryCount: 0, secrets },
  async () => {
    const d = db();
    const { list, notes } = await creds(d);
    const out = [];
    for (const c of list) {
      if (c.via !== 'app') { out.push({ store: c.code, ok: false, skipped: 'app cannot log in yet: ' + (notes[c.code] || '') }); continue; }
      try { out.push(await ensureWebhooks(d, new Shopify(c), process.env.WEBHOOK_URL || WEBHOOK_URL)); }
      catch (e) { out.push({ store: c.code, ok: false, error: String((e as Error).message) }); }
    }
    logger.info('flowmerce shopify setup', { results: out });
  },
);

export const flowmerceShopifyWebhook = onRequest(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5, secrets },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(200).json({ ok: true, what: 'Flowmerce Shopify webhook receiver' }); return; }
    try {
      const out = await handleWebhook(db(), stores(), b => resolveCred(b, appCred(processEnv, b.code)).then(r => r.cred), {
        raw: (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v])),
      });
      if (out.status !== 200) logger.warn('flowmerce webhook refused', out.body);
      res.status(out.status).json(out.body);
    } catch (e) {
      // 500 → Shopify sends it again later (up to 8 times in 4 hours)
      logger.error('flowmerce webhook failed', String((e as Error).message));
      res.status(500).json({ error: 'could not keep the message' });
    }
  },
);
