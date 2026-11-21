/* Stand-ins for Supabase and every outside service, so the whole run can be tested with no keys and no network. */

import { gzipSync } from 'node:zlib';

/** An in-memory "Supabase": upserts keyed like the real tables, job state, run log. */
export class FakeDb {
  tables: Record<string, Map<string, any>> = {};
  state: Record<string, any> = {};
  runs: any[] = [];
  failUpsert: string | null = null;
  async upsert(table: string, rows: any[], onConflict: string, ignoreExisting = false): Promise<number> {
    if (this.failUpsert === table) throw new Error('Supabase ' + table + ' 500: boom');
    const t = this.tables[table] || (this.tables[table] = new Map());
    const cols = onConflict.split(',');
    for (const r of rows) {
      const k = cols.map(c => r[c]).join('|');
      if (ignoreExisting && t.has(k)) continue;
      t.set(k, { ...(t.get(k) || {}), ...r });
    }
    return rows.length;
  }
  async getState(job: string) { return JSON.parse(JSON.stringify(this.state[job] || {})); }
  async setState(job: string, s: any) { this.state[job] = JSON.parse(JSON.stringify(s)); }
  async logRun(r: any) { this.runs.push(r); }
  async pruneRuns() { /* nothing to prune */ }
  rows(table: string) { return [...(this.tables[table] || new Map()).values()]; }
}

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response> | null;

/** Replace global fetch with a router; every call is recorded. Returns a function that puts the real fetch back. */
export function fakeFetch(routes: Route[]) {
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

export const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
export const gz = (o: unknown) => new Response(gzipSync(Buffer.from(JSON.stringify(o))), { status: 200 });

/** Amazon's orderMetrics answer: one bucket per hour or day between the interval's ends, a fixed pattern of figures. */
export function metricsAnswer(url: URL): Response {
  const [a, b] = String(url.searchParams.get('interval')).split('--');
  const gran = url.searchParams.get('granularity');
  const step = gran === 'Hour' ? 3600000 : 86400000;
  const payload = [];
  for (let t = Date.parse(a); t < Date.parse(b); t += step) {
    // the interval start as Amazon writes it: Pacific wall time with the offset
    const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find(p => p.type === 'timeZoneName')!.value.replace('GMT', '') || '+00:00';
    const wall = new Date(t + offMin(off) * 60000).toISOString().slice(0, 16);
    payload.push({ interval: `${wall}${off}--x`, orderCount: 2, unitCount: 3, orderItemCount: 2, totalSales: { amount: 50.5, currencyCode: 'USD' } });
  }
  return json({ payload });
}
function offMin(off: string) { const m = off.match(/([+-])(\d\d):(\d\d)/); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; }

export const ENV: Record<string, string> = {
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SP_CLIENT_ID: 'spid', SP_CLIENT_SECRET: 'spsec', SP_REFRESH_TOKEN: 'sprefresh-aaaaaaaaaaaa',
  CPC_CLIENT_ID: 'cpcid', CPC_CLIENT_SECRET: 'cpcsec', CPC_REFRESH_TOKEN: 'cpcrefresh-bbbbbbbbbbbb',
  SP_ADS_CLIENT_ID: 'adsid', SP_ADS_CLIENT_SECRET: 'adssec', SP_ADS_REFRESH_TOKEN: 'adsrefresh-cccccccccccc', SP_ADS_PROFILE_ID: '111',
  CPC_ADS_CLIENT_ID: 'adsid', CPC_ADS_CLIENT_SECRET: 'adssec', CPC_ADS_REFRESH_TOKEN: 'adsrefresh-cccccccccccc', CPC_ADS_PROFILE_ID: '222',
  SHOPIFY_STORE: 'ridhi.myshopify.com', SHOPIFY_TOKEN: 'shpat_x', CPC_SHOPIFY_STORE: 'none', CPC_SHOPIFY_TOKEN: 'none',
  META_TOKEN: 'metatoken', META_AD_ACCOUNT: 'act_999', CPC_META_TOKEN: 'cpcmetatoken', CPC_META_AD_ACCOUNT: 'act_888',
};
export const env = (n: string) => { const v = String(ENV[n] || '').trim(); return /^(none|-|n\/a)$/i.test(v) ? '' : v; };
