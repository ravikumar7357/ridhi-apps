/* The job queue: how "getting and filling" work is handed out.
 *
 *   a timer (Cloud Scheduler)  →  puts one or more TASKS on the queue  →  roneGet takes ONE task, runs it, answers
 *
 * A task is small and plain: which job, for which brand, and any arguments. Splitting a big pull into many tasks
 * ("orders for SP", "orders for CPC") is what lets it grow: twice the work is twice the tasks, run by more copies
 * of roneGet at once, and no single run comes near the 9-minute limit.
 *
 * What happens to a task (runTask):
 *   unknown job or bad task   → logged as failed, NOT retried (retrying cannot fix a typo)
 *   job ran fine              → done
 *   Amazon or our speed limit said wait (ThrottledError) → retry: the queue tries it again later
 *   any other failure         → logged as failed, not retried; the job's next timer tries again
 *
 * Retrying only "wait" failures keeps a broken job from hammering Amazon. Short hiccups (429, 5xx, network) are
 * already retried inside the gateway before a job ever sees them. */

import type { AmazonGateway } from './gateway.ts';
import type { DbLike } from './db.ts';
import type { Brand, Env } from './env.ts';
import { runJob, type JobResult } from './jobs.ts';

export interface Task {
  /** The job's name, a key of the job list (src/jobs/index.ts). */
  job: string;
  /** Which brand the task is for, when the job is per brand. */
  brand?: Brand;
  /** Anything else the job needs; kept small (a queue task is capped at 1 MB, and big ones cost more). */
  args?: Record<string, unknown>;
}

export interface JobCtx {
  env: Env;
  db: DbLike;
  now: () => number;
  /** The one way to call Amazon. Built per task, because it reads the switches. */
  gateway: () => Promise<AmazonGateway>;
}

export interface JobDef {
  name: string;
  run(task: Task, ctx: JobCtx): Promise<number | { rows: number; details?: unknown }>;
}

export type Outcome = 'done' | 'retry' | 'failed';

export interface TaskResult extends JobResult { outcome: Outcome }

const NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/;

/** Check a task as it came off the queue. Anything odd is refused with a reason, never guessed at. */
export function checkTask(raw: unknown): { task: Task } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The task was not an object.' };
  const t = raw as Record<string, unknown>;
  if (typeof t.job !== 'string' || !NAME.test(t.job)) return { error: 'The task has no valid job name.' };
  if (t.brand !== undefined && t.brand !== 'SP' && t.brand !== 'CPC') return { error: `Unknown brand "${String(t.brand)}".` };
  if (t.args !== undefined && (!t.args || typeof t.args !== 'object' || Array.isArray(t.args))) {
    return { error: 'The task\'s args must be an object.' };
  }
  return { task: { job: t.job, ...(t.brand ? { brand: t.brand as Brand } : {}), ...(t.args ? { args: t.args as Record<string, unknown> } : {}) } };
}

/** The name a run is logged under: "orders" or "orders:SP". */
export function runName(task: Task): string {
  return task.brand ? `${task.job}:${task.brand}` : task.job;
}

export interface RunTaskDeps {
  jobs: Record<string, JobDef>;
  env: Env;
  db: DbLike;
  gateway: () => Promise<AmazonGateway>;
  now?: () => number;
}

/** Run one task from the queue. Never throws: the answer says whether the queue should try it again. */
export async function runTask(raw: unknown, deps: RunTaskDeps): Promise<TaskResult> {
  const now = deps.now || Date.now;
  const checked = checkTask(raw);
  if ('error' in checked) {
    const r = await runJob(deps.db, 'task:invalid', async () => { throw new Error(checked.error); }, now);
    return { ...r, outcome: 'failed' };
  }
  const { task } = checked;
  const def = Object.hasOwn(deps.jobs, task.job) ? deps.jobs[task.job] : undefined;
  if (!def) {
    const r = await runJob(deps.db, runName(task), async () => { throw new Error(`No job named "${task.job}".`); }, now);
    return { ...r, outcome: 'failed' };
  }
  const ctx: JobCtx = { env: deps.env, db: deps.db, now, gateway: deps.gateway };
  const r = await runJob(deps.db, runName(task), () => def.run(task, ctx), now);
  return { ...r, outcome: r.ok ? 'done' : (r.retryAfterMs ? 'retry' : 'failed') };
}
