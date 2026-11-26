/* Stand-ins for Supabase and every outside service, so everything can be tested with no keys and no network. */

import type { DbLike, RunLog } from '../src/lib/db.ts';

export class FakeDb implements DbLike {
  tables: Record<string, Map<string, any>> = {};
  runs: RunLog[] = [];
  failLog = false;
  async upsert(table: string, rows: any[], onConflict: string, ignoreExisting = false): Promise<number> {
    const t = this.tables[table] || (this.tables[table] = new Map());
    const cols = onConflict.split(',');
    for (const r of rows) {
      const k = cols.map(c => r[c]).join('|');
      if (ignoreExisting && t.has(k)) continue;
      t.set(k, { ...(t.get(k) || {}), ...r });
    }
    return rows.length;
  }
  failSelect = false;
  rpcs: { fn: string; args: any }[] = [];
  async select(table: string) {
    if (this.failSelect) throw new Error('Supabase ' + table + ' 500');
    return [...(this.tables[table] || new Map()).values()];
  }
  async rpc(fn: string, args: object): Promise<any> { this.rpcs.push({ fn, args }); return null; }
  async logRun(r: RunLog) { if (this.failLog) throw new Error('Supabase job_runs 500'); this.runs.push(r); }
}

export type FakeRoute = (url: URL, init: RequestInit) => Response | Promise<Response> | null;

/** Replace global fetch with a router; every call is recorded. restore() puts the real fetch back. */
export function fakeFetch(routes: FakeRoute[]) {
  const real = globalThis.fetch;
  const calls: { url: string; method: string; body?: string }[] = [];
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), method: String(init.method || 'GET'), body: init.body ? String(init.body) : undefined });
    for (const r of routes) { const res = await r(url, init); if (res) return res; }
    return new Response('no fake for ' + url, { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

export const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

export const ENV: Record<string, string> = {
  API_KEY: 'secret-key',
  SUPABASE_SERVICE_KEY: 'sb_secret_test',
  SP_CLIENT_ID: 'spid', SP_CLIENT_SECRET: 'spsec', SP_REFRESH_TOKEN: 'sprefresh',
  CPC_CLIENT_ID: 'cpcid', CPC_CLIENT_SECRET: 'cpcsec', CPC_REFRESH_TOKEN: 'cpcrefresh',
  SP_ADS_CLIENT_ID: 'spadsid', SP_ADS_CLIENT_SECRET: 'spadssec', SP_ADS_REFRESH_TOKEN: 'spadsrefresh',
  CPC_ADS_CLIENT_ID: 'cpcadsid', CPC_ADS_CLIENT_SECRET: 'cpcadssec', CPC_ADS_REFRESH_TOKEN: 'cpcadsrefresh',
  SP_ADS_PROFILE_ID: '111', CPC_ADS_PROFILE_ID: 'none',
};
export const envFrom = (o: Record<string, string>) => (n: string) => {
  const v = String(o[n] || '').trim();
  return /^(none|-|n\/a)$/i.test(v) ? '' : v;
};
export const env = envFrom(ENV);

/** Amazon's login: answers a token for the right refresh token, 400 otherwise. */
export const lwa: FakeRoute = (url, init) => {
  if (url.hostname !== 'api.amazon.com') return null;
  const body = new URLSearchParams(String(init.body || ''));
  const good = ['sprefresh', 'cpcrefresh', 'spadsrefresh', 'cpcadsrefresh'].includes(body.get('refresh_token') || '');
  return good ? json({ access_token: 'Atza|' + body.get('client_id'), expires_in: 3600 })
              : json({ error: 'invalid_grant', error_description: 'The request has an invalid grant parameter' }, 400);
};
