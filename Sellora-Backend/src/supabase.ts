/* Supabase, schema "sellora", through its REST API with the SECRET key (writes bypass RLS; nothing else may write).
 * Only the apikey header is sent: that works for the new sb_secret_ keys and the older service_role key alike. */

import { callJson, call } from './http.ts';

export interface RunLog {
  job: string;
  brand?: string | null;
  started_at: string;
  finished_at: string;
  ok: boolean;
  rows_written?: number;
  error?: string | null;
  details?: unknown;
}

export class Db {
  url: string;
  key: string;
  schema: string;
  constructor(url: string, key: string, schema = 'sellora') {
    this.url = url.replace(/\/+$/, '');
    this.key = key;
    this.schema = schema;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, 'Content-Type': 'application/json', 'Accept-Profile': this.schema, 'Content-Profile': this.schema, ...extra };
  }

  /** Insert or update rows on their key. ignoreExisting: never overwrite a row that is already there (history import). */
  async upsert(table: string, rows: object[], onConflict: string, ignoreExisting = false): Promise<number> {
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      await call(`Supabase ${table}`, `${this.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: 'POST',
        headers: this.headers({ Prefer: `resolution=${ignoreExisting ? 'ignore' : 'merge'}-duplicates,return=minimal` }),
        body: JSON.stringify(part),
      });
      n += part.length;
    }
    return n;
  }

  async getState<T = Record<string, any>>(job: string): Promise<T> {
    const rows = await callJson<{ state: T }[]>(`Supabase job_state`,
      `${this.url}/rest/v1/job_state?select=state&job=eq.${encodeURIComponent(job)}`, { headers: this.headers() });
    return (rows && rows[0] && rows[0].state) || ({} as T);
  }

  async setState(job: string, state: unknown): Promise<void> {
    await this.upsert('job_state', [{ job, state, updated_at: new Date().toISOString() }], 'job');
  }

  async logRun(r: RunLog): Promise<void> {
    await call('Supabase fetch_runs', `${this.url}/rest/v1/fetch_runs`, {
      method: 'POST', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify([r]),
    });
  }

  async pruneRuns(keepDays = 30): Promise<void> {
    await call('Supabase prune_runs', `${this.url}/rest/v1/rpc/prune_runs`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ p_keep_days: keepDays }),
    });
  }
}
