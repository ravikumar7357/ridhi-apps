/* A token bucket per brand and kind of call, the same way Amazon counts: tokens refill at `rate` per second up to
 * `burst`; each call takes one. take() answers 0 = go now, or how many milliseconds until a token is there.
 *
 *   MemoryLimiter  one process only: tests, and a single local run
 *   DbLimiter      the real one: the bucket lives in Supabase (backend.take_token), so every copy of the backend,
 *                  however many are running, shares one count */

import type { DbLike } from './db.ts';

export interface Limiter {
  take(key: string, rate: number, burst: number): Promise<number>;
}

export class MemoryLimiter implements Limiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  async take(key: string, rate: number, burst: number): Promise<number> {
    const t = this.now();
    const b = this.buckets.get(key) || { tokens: burst, at: t };
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * rate);
    b.at = t;
    this.buckets.set(key, b);
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    return Math.ceil(((1 - b.tokens) / rate) * 1000);
  }
}

export class DbLimiter implements Limiter {
  private db: DbLike;
  constructor(db: DbLike) { this.db = db; }
  async take(key: string, rate: number, burst: number): Promise<number> {
    return Number(await this.db.rpc<number>('take_token', { p_key: key, p_rate: rate, p_burst: burst })) || 0;
  }
}
