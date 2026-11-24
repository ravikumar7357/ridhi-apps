/* Flowmerce's sync backend on Firebase (project price-research-48ff3, codebase "flowmerce-sync").
 * Only THIS file knows about Firebase. Everything else (orders.ts, webhook.ts, map.ts, db.ts, shopify.ts) is plain
 * TypeScript, so on "Firebase zero" day only this file is swapped for Cloud Run (or any other runner).
 *
 *   flowmerceShopifyOrders    every 15 min · orders changed since last run → flowmerce.*   (RBP, then CPC)
 *   flowmerceShopifyBackfill  every 5 min  · older orders, a few pages per run, while switched on in flowmerce.sync_job
 *   flowmerceShopifyWebhook   HTTPS        · Shopify calls it when an order or parcel changes
 *
 * Region asia-south1 (Mumbai), next to the Supabase ERP project. One copy at a time for the timers.
 * What each run did: flowmerce.sync_run (also the "data as of" on every screen) and the Firebase function logs. */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { SECRET_NAMES, STORES, SUPABASE_URL, processEnv, shopCred, type ShopCred } from './config.ts';
import { Db } from './db.ts';
import { Shopify } from './shopify.ts';
import { runOrders } from './orders.ts';
import { handleWebhook } from './webhook.ts';

const secrets = SECRET_NAMES.map(n => defineSecret(n));

function db(): Db {
  const key = processEnv('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is not set');
  return new Db(process.env.SUPABASE_URL || SUPABASE_URL, key);
}

function creds(): ShopCred[] {
  return STORES.map(s => shopCred(processEnv, s)).filter((c): c is ShopCred => !!c);
}

async function runAll(mode: 'incremental' | 'backfill', budgetMs: number) {
  const d = db();
  const owner = `${mode}:${process.env.K_REVISION || 'local'}:${Date.now()}`;
  const out = [];
  for (const c of creds()) {
    try { out.push(await runOrders(d, new Shopify(c), mode, owner, budgetMs / 2)); }
    catch (e) { out.push({ store: c.code, mode, ok: false, error: String((e as Error).message) }); }
  }
  logger.info(`flowmerce shopify ${mode}`, { results: out });
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

export const flowmerceShopifyWebhook = onRequest(
  { region: 'asia-south1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5, secrets },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(200).json({ ok: true, what: 'Flowmerce Shopify webhook receiver' }); return; }
    try {
      const out = await handleWebhook(db(), creds(), {
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
