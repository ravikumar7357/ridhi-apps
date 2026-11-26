/* Supabase through its REST API with the secret key, the same way Sellora-Backend does it. The schema is chosen per
 * client: "backend" for this service's own log tables; other schemas when a route moves its data in.
 * A new sb_secret_ key goes in the apikey header only; an older service_role JWT ("eyJ…") also goes in Authorization. */

import { call, callJson } from './http.ts';

export interface RunLog {
  job: string;               // a timer job ("ads-daily") or a route ("route:ping")
  started_at: string;
  finished_at: string;
  ok: boolean;
  rows_written?: number;
  error?: string | null;
  details?: unknown;
}

export interface DbLike {
  upsert(table: string, rows: object[], onConflict: string, ignoreExisting?: boolean): Promise<number>;
  select<T = any>(table: string, query: string): Promise<T[]>;
  rpc<T = any>(fn: string, args: object): Promise<T>;
  logRun(r: RunLog): Promise<void>;
}

export class Db implements DbLike {
  url: string;
  key: string;
  schema: string;
  constructor(url: string, key: string, schema = 'backend') {
    this.url = url.replace(/\/+$/, '');
    this.key = key.trim();
    this.schema = schema;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const auth: Record<string, string> = this.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + this.key } : {};
    return { apikey: this.key, ...auth, 'Content-Type': 'application/json', 'Accept-Profile': this.schema, 'Content-Profile': this.schema, ...extra };
  }

  /** Insert or update rows on their key, 500 at a time. ignoreExisting: never overwrite a row that is already there. */
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

  async select<T = any>(table: string, query: string): Promise<T[]> {
    return (await callJson<T[]>(`Supabase ${table}`, `${this.url}/rest/v1/${table}?${query}`, { headers: this.headers() })) || [];
  }

  async rpc<T = any>(fn: string, args: object): Promise<T> {
    return callJson<T>(`Supabase ${fn}`, `${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(args),
    });
  }

  async logRun(r: RunLog): Promise<void> {
    await call('Supabase job_runs', `${this.url}/rest/v1/job_runs`, {
      method: 'POST', headers: this.headers({ Prefer: 'return=minimal' }), body: JSON.stringify([r]),
    });
  }
}
