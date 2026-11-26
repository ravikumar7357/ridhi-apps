/* Every timer job runs through runJob: one row in backend.job_runs per run (ok or not, how long, rows written, the
 * error), and a failing job never throws past here, so one job can't take another down. keepOldIfEmpty is the
 * "never save empty over good" rule (17 Nov: a failed nightly run saved empty caches over 16 Nov's data). */

import type { DbLike } from './db.ts';

export class EmptyResultError extends Error {
  constructor(what: string) { super(`${what} came back empty; the old data was kept`); }
}

/** Throw if a result that should have rows has none. Call it BEFORE writing anything. */
export function keepOldIfEmpty<T>(rows: T[] | null | undefined, what: string): T[] {
  if (!rows || rows.length === 0) throw new EmptyResultError(what);
  return rows;
}

/** retryAfterMs is set when the failure was "come back later" (Amazon or our own speed limit said wait), so the
 *  queue can try the task again instead of dropping it. Any other failure waits for the job's next timer. */
export interface JobResult { job: string; ok: boolean; rows: number; ms: number; error?: string; retryAfterMs?: number }

export async function runJob(db: DbLike, job: string, work: () => Promise<number | { rows: number; details?: unknown }>,
  now: () => number = Date.now): Promise<JobResult> {
  const t0 = now();
  const started_at = new Date(t0).toISOString();
  let ok = true, rows = 0, error: string | undefined, details: unknown, retryAfterMs: number | undefined;
  try {
    const out = await work();
    if (typeof out === 'number') rows = out; else { rows = out.rows; details = out.details; }
  } catch (e) {
    ok = false;
    error = String((e as Error)?.message || e).slice(0, 500);
    const wait = Number((e as { retryAfterMs?: unknown })?.retryAfterMs);
    if (wait > 0) retryAfterMs = wait;
  }
  const ms = now() - t0;
  try {
    await db.logRun({ job, started_at, finished_at: new Date(t0 + ms).toISOString(), ok, rows_written: rows, error: error || null, details });
  } catch { /* the log is best effort: never turn a good run into a failure */ }
  return retryAfterMs ? { job, ok, rows, ms, error, retryAfterMs } : { job, ok, rows, ms, error };
}
