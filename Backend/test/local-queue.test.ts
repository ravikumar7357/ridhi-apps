import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalQueue, everyMs, startTimers } from '../src/lib/local-queue.ts';
import type { Task, TaskResult } from '../src/lib/tasks.ts';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const res = (job: string, outcome: TaskResult['outcome'], extra: Partial<TaskResult> = {}): TaskResult =>
  ({ job, ok: outcome === 'done', rows: 0, ms: 1, outcome, ...extra });

test('runs every task, a few at a time', async () => {
  let live = 0, most = 0; const seen: string[] = [];
  const q = new LocalQueue(async (t) => {
    live++; most = Math.max(most, live); seen.push(t.job);
    await new Promise(r => setImmediate(r)); live--;
    return res(t.job, 'done');
  }, { concurrency: 2 });
  for (const j of ['a', 'b', 'c', 'd', 'e']) q.enqueue({ job: j });
  await settle();
  assert.deepEqual(seen.sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(most, 2);
  assert.deepEqual(q.stats(), { pending: 0, running: 0, done: 5, failed: 0, retried: 0 });
});

test('"wait" goes back on the queue after at least the wait Amazon asked for, growing each time', async () => {
  const waits: number[] = []; let tries = 0;
  const q = new LocalQueue(async (t) => (++tries < 3 ? res(t.job, 'retry', { retryAfterMs: 30_000 }) : res(t.job, 'done')), {
    minBackoffMs: 10_000, setTimer: (fn, ms) => { waits.push(ms); fn(); },
  });
  q.enqueue({ job: 'orders', brand: 'SP' });
  await settle();
  assert.equal(tries, 3);
  assert.deepEqual(waits, [30_000, 30_000]);        // Amazon's 30 s beats our 10 s, then 20 s
  assert.equal(q.stats().done, 1);
  assert.equal(q.stats().retried, 2);
});

test('our own backoff grows when it is longer than what Amazon asked for, and stops at the cap', async () => {
  const waits: number[] = [];
  const q = new LocalQueue(async (t) => res(t.job, 'retry', { retryAfterMs: 1 }), {
    minBackoffMs: 10_000, maxBackoffMs: 25_000, maxAttempts: 4, setTimer: (fn, ms) => { waits.push(ms); fn(); },
  });
  q.enqueue({ job: 'orders' });
  await settle();
  assert.deepEqual(waits, [10_000, 20_000, 25_000]);
  assert.equal(q.stats().failed, 1);                // the 4th try is the last: counted as failed, not retried again
});

test('a failure is not retried, and a job that throws does not stop the queue', async () => {
  let n = 0;
  const q = new LocalQueue(async (t) => { n++; if (t.job === 'boom') throw new Error('bug'); return res(t.job, 'failed'); });
  q.enqueue({ job: 'boom' }); q.enqueue({ job: 'bad' }); q.enqueue({ job: 'next' });
  await settle();
  assert.equal(n, 3);
  assert.equal(q.stats().failed, 3);
  assert.equal(q.stats().retried, 0);
});

test('everyMs reads "every N minutes/hours" and nothing else', () => {
  assert.equal(everyMs('every 30 minutes'), 1_800_000);
  assert.equal(everyMs('every 1 minute'), 60_000);
  assert.equal(everyMs('Every 2 hours'), 7_200_000);
  assert.equal(everyMs('every 0 minutes'), null);
  assert.equal(everyMs('*/10 * * * *'), null);
  assert.equal(everyMs('every day'), null);
});

test('timers: each starts on its own interval, runs once at start when asked, and a cron one is named and skipped', () => {
  const intervals: number[] = []; const queued: Task[] = []; const lines: object[] = [];
  const started = startTimers([
    { name: 'heartbeat', schedule: 'every 30 minutes', tasks: () => [{ job: 'heartbeat' }] },
    { name: 'orders', schedule: 'every 10 minutes', tasks: () => [{ job: 'orders', brand: 'SP' }, { job: 'orders', brand: 'CPC' }] },
    { name: 'nightly', schedule: '0 5 * * *', tasks: () => [{ job: 'nightly' }] },
  ], t => queued.push(t), { runAtStart: true, setEvery: (_fn, ms) => { intervals.push(ms); }, log: l => lines.push(l) });
  assert.deepEqual(started, ['heartbeat', 'orders']);
  assert.deepEqual(intervals, [1_800_000, 600_000]);
  assert.deepEqual(queued.map(t => t.job + (t.brand ? ':' + t.brand : '')), ['heartbeat', 'orders:SP', 'orders:CPC']);
  assert.equal(lines.length, 1);
  assert.match(JSON.stringify(lines[0]), /nightly/);
});
