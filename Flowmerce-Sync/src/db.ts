/* Supabase, schema "flowmerce", through its REST API with the secret key. The backend only calls database FUNCTIONS
 * (job_start, ingest_shopify_orders, job_finish, webhook_keep, webhook_done): all table logic lives in the database,
 * so one page of orders = one call, saved in one transaction.
 * Needs "flowmerce" in Supabase → Project Settings → API → Exposed schemas.
 * A new sb_secret_ key goes in the apikey header only; an older service_role key (a JWT, "eyJ…") also as Bearer. */

import { callJson } from './http.ts';

export interface JobStart { ok: boolean; reason?: string; job_id?: string; run_id?: string; cursor?: Record<string, any> }
export interface IngestResult { orders: number; lines: number; fulfillments: number; tracking: number; raw: number; skipped_older: number }

export class Db {
  url: string;
  key: string;
  schema: string;
  constructor(url: string, key: string, schema = 'flowmerce') {
    this.url = url.replace(/\/+$/, '');
    this.key = key.trim();
    this.schema = schema;
  }

  private headers(): Record<string, string> {
    const auth: Record<string, string> = this.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + this.key } : {};
    return { apikey: this.key, ...auth, 'Content-Type': 'application/json', 'Accept-Profile': this.schema, 'Content-Profile': this.schema };
  }

  async rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
    // writes are NOT retried blindly on network errors: 2 tries only (every function is safe to repeat anyway)
    return callJson<T>(`Supabase ${fn}`, `${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(args),
    }, 2, 2000);
  }

  jobStart(store: string, stream: string, mode: string, owner: string, trigger = 'schedule') {
    return this.rpc<JobStart>('job_start', { p_store: store, p_stream: stream, p_mode: mode, p_owner: owner, p_trigger: trigger });
  }

  jobFinish(jobId: string, runId: string, owner: string, status: 'ok' | 'partial' | 'failed' | 'skipped',
            cursor: unknown, rowsRead: number, rowsWritten: number, apiCalls: number, error?: string | null) {
    return this.rpc<void>('job_finish', {
      p_job: jobId, p_run: runId, p_owner: owner, p_status: status, p_cursor: cursor ?? null,
      p_rows_read: rowsRead, p_rows_written: rowsWritten, p_api_calls: apiCalls, p_error: error ?? null,
    });
  }

  ingestOrders(store: string, orders: unknown[], runId?: string | null) {
    return this.rpc<IngestResult>('ingest_shopify_orders', { p_store: store, p_orders: orders, p_run: runId ?? null });
  }

  webhookKeep(store: string, topic: string, webhookId: string, shopDomain: string, headers: Record<string, string>, payload: unknown) {
    return this.rpc<{ id: number | null; duplicate: boolean }>('webhook_keep', {
      p_store: store, p_topic: topic, p_webhook_id: webhookId, p_shop_domain: shopDomain, p_headers: headers, p_payload: payload,
    });
  }

  webhookDone(id: number, error?: string | null) {
    return this.rpc<void>('webhook_done', { p_id: id, p_error: error ?? null });
  }
}
