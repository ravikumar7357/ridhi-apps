/* The timers. A timer does ONE thing: put tasks on the queue. It never fetches or writes data itself, so a timer
 * cannot run long, and the queue's retries and copy limits apply to every job the same way.
 *
 * Each timer becomes its own Cloud Scheduler job (about ₹9 a month each beyond the first three free per account).
 * Times are India time. Schedules use Cloud Scheduler's forms: cron ("*\/10 * * * *") or "every 30 minutes". */

import type { Task } from '../lib/tasks.ts';

export interface Timer {
  /** Letters and digits only: it becomes part of the function's name (timers-<name>). */
  name: string;
  schedule: string;
  /** The tasks to queue on each tick. */
  tasks(): Task[];
}

export const TIMERS: Timer[] = [
  { name: 'heartbeat', schedule: 'every 30 minutes', tasks: () => [{ job: 'heartbeat' }] },
];
