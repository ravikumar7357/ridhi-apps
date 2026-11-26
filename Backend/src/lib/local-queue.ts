/* The job queue and timers for running the backend as one ordinary Node process: on this PC, or on a plain
 * server (DigitalOcean). Same contract as the Google version (Cloud Tasks + Cloud Scheduler in index.ts):
 *
 *   a timer puts tasks on the queue → the queue runs a few at a time → runTask answers done / retry / failed
 *
 * Retries happen only for "retry" (Amazon or our own speed limit said wait), with a growing wait, like Cloud Tasks.
 * The queue lives in memory: if the process stops, waiting tasks are lost and the next timer tick queues them again.
 * That is fine because every job reads what it needs fresh; nothing is half-done between runs. */

import type { Task, TaskResult } from './tasks.ts';

export interface QueueOpts {
  /** How many tasks run at the same time. */
  concurrency?: number;
  /** Tries per task, counting the first. */
  maxAttempts?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Stand-in for setTimeout, so tests control time. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  log?: (line: object) => void;
}

interface Item { task: Task; attempt: number }

export class LocalQueue {
  private run: (t: Task) => Promise<TaskResult>;
  private o: QueueOpts;
  private waiting: Item[] = [];
  private running = 0;
  private counts = { done: 0, failed: 0, retried: 0 };

  constructor(run: (t: Task) => Promise<TaskResult>, o: QueueOpts = {}) {
    this.run = run;
    this.o = o;
  }

  enqueue(task: Task, attempt = 1): void {
    this.waiting.push({ task, attempt });
    this.pump();
  }

  stats() {
    return { pending: this.waiting.length, running: this.running, ...this.counts };
  }

  private pump(): void {
    const max = Math.max(1, this.o.concurrency ?? 2);
    while (this.running < max && this.waiting.length) {
      const item = this.waiting.shift()!;
      this.running++;
      this.run(item.task)
        .catch((e): TaskResult => ({ job: item.task.job, ok: false, rows: 0, ms: 0, error: String((e as Error)?.message || e), outcome: 'failed' }))
        .then(r => this.after(item, r))
        .finally(() => { this.running--; this.pump(); });
    }
  }

  private after(item: Item, r: TaskResult): void {
    const maxTries = this.o.maxAttempts ?? 5;
    if (r.outcome === 'retry' && item.attempt < maxTries) {
      const min = this.o.minBackoffMs ?? 10_000, cap = this.o.maxBackoffMs ?? 600_000;
      const wait = Math.min(cap, Math.max(r.retryAfterMs || 0, min * 2 ** (item.attempt - 1)));
      this.counts.retried++;
      (this.o.setTimer ?? setTimeout)(() => this.enqueue(item.task, item.attempt + 1), wait);
      this.o.log?.({ job: r.job, outcome: 'retry', attempt: item.attempt, waitMs: wait });
      return;
    }
    if (r.outcome === 'done') this.counts.done++; else this.counts.failed++;
    this.o.log?.({ job: r.job, outcome: r.outcome, attempt: item.attempt, rows: r.rows, ms: r.ms, error: r.error });
  }
}

/** "every 30 minutes" / "every 2 hours" → milliseconds. Anything else (cron) is not run here yet: null. */
export function everyMs(schedule: string): number | null {
  const m = /^every\s+(\d+)\s+(minutes?|hours?)$/i.exec(String(schedule).trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n >= 1)) return null;
  return n * (m[2].toLowerCase().startsWith('hour') ? 3_600_000 : 60_000);
}

export interface TimerLike { name: string; schedule: string; tasks(): Task[] }

export interface TimerOpts {
  /** Queue each timer's tasks once at start, so a fresh start shows a run straight away. */
  runAtStart?: boolean;
  setEvery?: (fn: () => void, ms: number) => unknown;
  log?: (line: object) => void;
}

/** Start every timer this process can run; answers the names started. A timer it can't read is named in the log. */
export function startTimers(timers: TimerLike[], enqueue: (t: Task) => void, o: TimerOpts = {}): string[] {
  const started: string[] = [];
  for (const t of timers) {
    const ms = everyMs(t.schedule);
    if (ms === null) { o.log?.({ timer: t.name, skipped: `schedule "${t.schedule}" is not "every N minutes/hours"` }); continue; }
    const tick = () => { for (const task of t.tasks()) enqueue(task); };
    (o.setEvery ?? setInterval)(tick, ms);
    if (o.runAtStart) tick();
    started.push(t.name);
  }
  return started;
}
