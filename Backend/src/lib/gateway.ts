/* THE ONLY WAY THIS BACKEND CALLS AMAZON. Every job and route goes through AmazonGateway.call; nothing else may fetch
 * an Amazon address. In order, for every call:
 *
 *   1. switches   paused? is this dataset ours? If not, refuse before anything is sent (controls.ts).
 *   2. speed      wait for a token under Amazon's limit for this kind of call, times our share (amazon-limits.ts,
 *                 limiter.ts). A long wait is not slept through: the call is put off (ThrottledError) and the job
 *                 comes back on its next run.
 *   3. send       with the brand's login.
 *   4. listen     429 → wait as long as Amazon's Retry-After says (or its rate header, or a doubling wait), then try
 *                 again; a long wait is put off the same way. 5xx → a short wait and try again. Other errors are
 *                 thrown with Amazon's words. An error is NEVER turned into an empty answer.
 *   5. count      every outcome is counted per brand and call; flush() adds the counts to backend.amazon_calls. */

import { OPS, effective, type Op } from './amazon-limits.ts';
import type { Limiter } from './limiter.ts';
import type { Controls, Dataset } from './controls.ts';
import type { Brand, Env } from './env.ts';
import type { DbLike } from './db.ts';
import { adsClientId, adsHost, adsToken, spHost, spToken } from './amazon.ts';

export class NotOwnerError extends Error {
  constructor(dataset: string, owner: string) { super(`Not fetched: "${dataset}" belongs to ${owner}, not this backend.`); }
}
export class PausedError extends Error {
  constructor(what: string) { super(`Not fetched: ${what} is paused.`); }
}
/** Amazon (or our own limit) says wait. Nothing was lost: come back after retryAfterMs. */
export class ThrottledError extends Error {
  retryAfterMs: number;
  constructor(op: string, retryAfterMs: number, by: 'amazon' | 'limit') {
    super(`${op}: ${by === 'amazon' ? 'Amazon said slow down' : 'our speed limit is used up'}; try again in ${Math.ceil(retryAfterMs / 1000)} s.`);
    this.retryAfterMs = retryAfterMs;
  }
}
export class AmazonError extends Error {
  status: number;
  body: string;
  constructor(op: string, status: number, body: string) {
    super(`${op} ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export interface Req {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Extra headers for this one call, on top of the login headers. Ads needs it: every Ads endpoint except
   *  /v2/profiles is scoped to a profile with Amazon-Advertising-API-Scope, and 401s without it. */
  headers?: Record<string, string>;
}

export interface CallCtx {
  /** Which data this call is for. Required, so ownership is always checked. */
  dataset: Dataset;
  /** The job making the call, for its pause switch. */
  job?: string;
}

/** How one Amazon API is reached: its address and login headers for a brand. */
export type Transport = (brand: Brand) => Promise<{ host: string; headers: Record<string, string> }>;

export interface GatewayDeps {
  env: Env;
  limiter: Limiter;
  controls: Controls;
  transports?: Partial<Record<'sp' | 'ads', Transport>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Waits longer than this are put off instead of slept through (a function must not sit idle for minutes). */
  maxInlineWaitMs?: number;
  maxTries?: number;
}

type Outcome = 'ok' | 'throttled' | 'error' | 'deferred' | 'refused';

export class AmazonGateway {
  private d: GatewayDeps;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private maxInline: number;
  private maxTries: number;
  private counts = new Map<string, number>();

  constructor(deps: GatewayDeps) {
    this.d = deps;
    this.now = deps.now || Date.now;
    this.sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.maxInline = deps.maxInlineWaitMs ?? 20_000;
    this.maxTries = deps.maxTries ?? 4;
  }

  private count(brand: Brand, op: Op, outcome: Outcome) {
    const k = `${brand}|${op}|${outcome}`;
    this.counts.set(k, (this.counts.get(k) || 0) + 1);
  }

  private async transport(api: 'sp' | 'ads', brand: Brand) {
    const t = this.d.transports?.[api];
    if (t) return t(brand);
    if (api === 'sp') {
      return { host: spHost(this.d.env, brand), headers: { 'x-amz-access-token': await spToken(this.d.env, brand, this.now()) } };
    }
    // Ads, like adsCall_: a bearer token plus the client id. The profile scope is per call, so it comes from req.headers.
    return {
      host: adsHost(this.d.env, brand),
      headers: {
        Authorization: 'Bearer ' + await adsToken(this.d.env, brand, this.now()),
        'Amazon-Advertising-API-ClientId': adsClientId(this.d.env, brand),
      },
    };
  }

  async call<T = any>(op: Op, brand: Brand, req: Req, ctx: CallCtx): Promise<T> {
    const spec = OPS[op];
    if (!spec) throw new Error(`Unknown Amazon call "${op}": add it to amazon-limits.ts with its limit first.`);
    const c = this.d.controls;

    // 1. switches
    if (c.pausedAll) { this.count(brand, op, 'refused'); throw new PausedError('all Amazon calls'); }
    if (ctx.job && c.paused(ctx.job)) { this.count(brand, op, 'refused'); throw new PausedError(`the job "${ctx.job}"`); }
    const owner = c.owner(ctx.dataset);
    if (owner !== 'backend') { this.count(brand, op, 'refused'); throw new NotOwnerError(ctx.dataset, owner); }

    const lim = effective(op, c.share);
    const key = `${brand}:${op}`;

    for (let attempt = 0; ; attempt++) {
      // 2. speed
      const wait = await this.d.limiter.take(key, lim.rate, lim.burst);
      if (wait > 0) {
        if (wait > this.maxInline) { this.count(brand, op, 'deferred'); throw new ThrottledError(op, wait, 'limit'); }
        await this.sleep(wait);
        const again = await this.d.limiter.take(key, lim.rate, lim.burst);
        if (again > 0) { this.count(brand, op, 'deferred'); throw new ThrottledError(op, again, 'limit'); }
      }

      // 3. send
      const t = await this.transport(spec.api, brand);
      const url = new URL(t.host + req.path);
      for (const [k, v] of Object.entries(req.query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
      let r: Response;
      try {
        r = await fetch(url, {
          method: req.method || 'GET',
          headers: { ...t.headers, ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(req.headers || {}) },
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        });
      } catch (e) {
        this.count(brand, op, 'error');
        if (attempt + 1 >= this.maxTries) throw new AmazonError(op, 0, 'network: ' + String((e as Error)?.message || e));
        await this.sleep(1500 * (attempt + 1));
        continue;
      }

      // 4. listen
      if (r.status === 429) {
        this.count(brand, op, 'throttled');
        const ra = Number(r.headers.get('retry-after'));
        const hinted = Number(r.headers.get('x-amzn-ratelimit-limit'));
        const backoff = ra > 0 ? ra * 1000
          : (hinted > 0 ? 1000 / hinted : Math.min(60_000, 1000 / lim.rate)) * 2 ** attempt;
        await r.text().catch(() => '');
        if (backoff > this.maxInline || attempt + 1 >= this.maxTries) throw new ThrottledError(op, backoff, 'amazon');
        await this.sleep(backoff);
        continue;
      }
      if (r.status >= 500) {
        this.count(brand, op, 'error');
        const body = await r.text().catch(() => '');
        if (attempt + 1 >= this.maxTries) throw new AmazonError(op, r.status, body);
        await this.sleep(1500 * (attempt + 1));
        continue;
      }
      const text = await r.text();
      if (!r.ok) { this.count(brand, op, 'error'); throw new AmazonError(op, r.status, text); }

      // 5. count
      this.count(brand, op, 'ok');
      return (text ? JSON.parse(text) : null) as T;
    }
  }

  /** What this gateway did since the last flush: one row per brand, call and outcome. */
  stats(): { brand: string; op: string; outcome: string; n: number }[] {
    return [...this.counts].map(([k, n]) => { const [brand, op, outcome] = k.split('|'); return { brand, op, outcome, n }; });
  }

  /** Add the counts to backend.amazon_calls (per minute) and start again. Never throws: counting is best effort. */
  async flush(db: DbLike): Promise<void> {
    const rows = this.stats();
    if (!rows.length) return;
    this.counts.clear();
    try { await db.rpc('count_calls', { p_rows: rows }); } catch { /* the calls themselves went fine */ }
  }
}
