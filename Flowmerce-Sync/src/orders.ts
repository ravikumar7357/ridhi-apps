/* The Shopify orders job, for one store. Two modes, both run by the timer:
 *
 *   incremental  every 15 min. Orders CHANGED since the cursor (minus a 10-minute overlap, so nothing slips through),
 *                oldest change first. First run ever: the last 3 days. Catches anything a webhook missed.
 *   backfill     every 5 min while switched on in flowmerce.sync_job. Walks back through ALL older orders, newest first,
 *                a few pages per run, until it reaches the first order; then it says "done" and stops costing anything.
 *
 * Each run: job_start (lock + log line) → pages → ingest_shopify_orders (one call per page) → job_finish (cursor + counts).
 * A run stops by itself before its time limit and carries on from its cursor next time. */

import type { Db } from './db.ts';
import type { Shopify } from './shopify.ts';
import { mapOrder } from './map.ts';

export interface RunResult { store: string; mode: string; ok: boolean; skipped?: string; pages: number; read: number; written: number; error?: string }

const OVERLAP_MS = 10 * 60_000;
const FIRST_RUN_DAYS = 3;

export async function runOrders(db: Db, shop: Shopify, mode: 'incremental' | 'backfill',
                                owner: string, budgetMs = 240_000, trigger = 'schedule'): Promise<RunResult> {
  const store = shop.cred.code;
  const t0 = Date.now();
  const res: RunResult = { store, mode, ok: true, pages: 0, read: 0, written: 0 };
  const js = await db.jobStart(store, 'shopify.orders', mode, owner, trigger);
  if (!js.ok) return { ...res, skipped: js.reason };
  const jobId = js.job_id!, runId = js.run_id!;
  const cursor: Record<string, any> = { ...(js.cursor || {}) };

  if (mode === 'backfill' && cursor.done) {
    await db.jobFinish(jobId, runId, owner, 'skipped', cursor, 0, 0, 0, null);
    return { ...res, skipped: 'backfill already done' };
  }

  let search: string, sortKey: 'UPDATED_AT' | 'CREATED_AT', reverse: boolean;
  if (mode === 'incremental') {
    const since = cursor.updated_at ? Date.parse(cursor.updated_at) - OVERLAP_MS : Date.now() - FIRST_RUN_DAYS * 86_400_000;
    search = `updated_at:>='${new Date(since).toISOString()}'`;
    sortKey = 'UPDATED_AT'; reverse = false;
  } else {
    // first backfill run starts from now; later runs from the oldest order already copied
    const before = cursor.before || new Date().toISOString();
    search = `created_at:<'${before}'`;
    sortKey = 'CREATED_AT'; reverse = true;
  }

  let after: string | null = null, error: string | null = null, finished = false;
  try {
    while (Date.now() - t0 < budgetMs) {
      const page = await shop.ordersPage(search, sortKey, reverse, after);
      res.pages++;
      const rows = page.nodes.map(mapOrder);
      res.read += rows.length;
      if (rows.length) {
        const r = await db.ingestOrders(store, rows, runId);
        res.written += r.orders;
        // move the cursor only after the page is safely saved
        if (mode === 'incremental') {
          const newest = page.nodes.reduce((m: string, o: any) => (o.updatedAt > m ? o.updatedAt : m), cursor.updated_at || '');
          if (newest) cursor.updated_at = newest;
        } else {
          const oldest = page.nodes.reduce((m: string, o: any) => (!m || o.createdAt < m ? o.createdAt : m), '');
          if (oldest) cursor.before = oldest;
        }
      }
      if (!page.pageInfo.hasNextPage) { finished = true; break; }
      after = page.pageInfo.endCursor;
    }
  } catch (e) {
    error = String((e as Error).message || e).slice(0, 1500);
    res.ok = false;
    res.error = error;
  }

  if (mode === 'backfill' && finished && !error) cursor.done = true;
  if (mode === 'incremental' && finished && !error && !cursor.updated_at) cursor.updated_at = new Date(t0).toISOString();
  const status = error ? (res.written ? 'partial' : 'failed') : (finished ? 'ok' : 'partial');
  await db.jobFinish(jobId, runId, owner, status, cursor, res.read, res.written, shop.calls, error);
  return res;
}

/** Re-read ONE order from Shopify and save it (used by the webhook). */
export async function syncOneOrder(db: Db, shop: Shopify, orderId: string | number): Promise<number> {
  const o = await shop.order(orderId);
  if (!o) return 0;
  const r = await db.ingestOrders(shop.cred.code, [mapOrder(o)], null);
  return r.orders;
}
