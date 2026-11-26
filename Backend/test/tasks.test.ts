import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTask, runName, runTask, type JobDef } from '../src/lib/tasks.ts';
import { ThrottledError, PausedError } from '../src/lib/gateway.ts';
import { JOBS } from '../src/jobs/index.ts';
import { TIMERS } from '../src/jobs/timers.ts';
import { FakeDb, env } from './fakes.ts';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const noGateway = async () => { throw new Error('this test does not call Amazon'); };

const deps = (jobs: Record<string, JobDef>, db = new FakeDb()) =>
  ({ jobs, env, db, gateway: noGateway as any, now: () => NOW });

const job = (name: string, run: JobDef['run']): JobDef => ({ name, run });

test('a good task runs its job and is logged under job:brand', async () => {
  const db = new FakeDb();
  const seen: unknown[] = [];
  const jobs = { orders: job('orders', async (t) => { seen.push(t); return 42; }) };
  const r = await runTask({ job: 'orders', brand: 'CPC', args: { days: 3 } }, deps(jobs, db));
  assert.equal(r.outcome, 'done');
  assert.equal(r.rows, 42);
  assert.deepEqual(seen, [{ job: 'orders', brand: 'CPC', args: { days: 3 } }]);
  assert.equal(db.runs.length, 1);
  assert.equal(db.runs[0].job, 'orders:CPC');
  assert.equal(db.runs[0].ok, true);
});

test('Amazon says wait: the task goes back on the queue', async () => {
  const jobs = { orders: job('orders', async () => { throw new ThrottledError('orders.getOrders', 30_000, 'amazon'); }) };
  const r = await runTask({ job: 'orders', brand: 'SP' }, deps(jobs));
  assert.equal(r.outcome, 'retry');
  assert.equal(r.retryAfterMs, 30_000);
});

test('any other failure is logged and NOT retried, so a broken job cannot hammer Amazon', async () => {
  const db = new FakeDb();
  const jobs = {
    broken: job('broken', async () => { throw new Error('Amazon 403: access denied'); }),
    paused: job('paused', async () => { throw new PausedError('the job "paused"'); }),
  };
  const a = await runTask({ job: 'broken' }, deps(jobs, db));
  const b = await runTask({ job: 'paused' }, deps(jobs, db));
  assert.equal(a.outcome, 'failed');
  assert.equal(b.outcome, 'failed');
  assert.match(db.runs[0].error!, /403/);
  assert.equal(db.runs.length, 2);
});

test('an unknown job is logged as failed, not retried', async () => {
  const db = new FakeDb();
  const r = await runTask({ job: 'ordres' }, deps(JOBS, db));
  assert.equal(r.outcome, 'failed');
  assert.match(db.runs[0].error!, /No job named "ordres"/);
});

test('a name that only exists on every object (toString, constructor) is not a job', async () => {
  const r = await runTask({ job: 'constructor' }, deps(JOBS));
  assert.equal(r.outcome, 'failed');
});

test('bad tasks are refused with a reason, never guessed at', async () => {
  assert.deepEqual(checkTask(null), { error: 'The task was not an object.' });
  assert.deepEqual(checkTask([]), { error: 'The task was not an object.' });
  assert.deepEqual(checkTask({}), { error: 'The task has no valid job name.' });
  assert.deepEqual(checkTask({ job: '../etc' }), { error: 'The task has no valid job name.' });
  assert.deepEqual(checkTask({ job: 'orders', brand: 'sp' }), { error: 'Unknown brand "sp".' });
  assert.deepEqual(checkTask({ job: 'orders', args: [1] }), { error: 'The task\'s args must be an object.' });
  assert.deepEqual(checkTask({ job: 'orders', extra: 'dropped' }), { task: { job: 'orders' } });
  const db = new FakeDb();
  const r = await runTask('not a task', deps(JOBS, db));
  assert.equal(r.outcome, 'failed');
  assert.equal(db.runs[0].job, 'task:invalid');
});

test('runName: per-brand jobs log separately', () => {
  assert.equal(runName({ job: 'orders' }), 'orders');
  assert.equal(runName({ job: 'orders', brand: 'SP' }), 'orders:SP');
});

test('heartbeat runs and is logged, proving timer → queue → roneGet → job_runs', async () => {
  const db = new FakeDb();
  const r = await runTask({ job: 'heartbeat' }, deps(JOBS, db));
  assert.equal(r.outcome, 'done');
  assert.deepEqual(db.runs[0].details, { at: '2026-11-26T10:00:00.000Z' });
});

test('every job is listed under its own name', () => {
  for (const [key, def] of Object.entries(JOBS)) assert.equal(def.name, key);
});

test('every timer queues only jobs that exist, with valid tasks, and has a usable name', () => {
  const names = new Set<string>();
  for (const t of TIMERS) {
    assert.match(t.name, /^[a-zA-Z][a-zA-Z0-9]*$/, `timer name "${t.name}" cannot be a function name`);
    assert.ok(!names.has(t.name), `two timers are named "${t.name}"`);
    names.add(t.name);
    assert.ok(t.schedule.trim().length > 0);
    const tasks = t.tasks();
    assert.ok(tasks.length > 0, `timer "${t.name}" queues nothing`);
    for (const task of tasks) {
      assert.ok('task' in checkTask(task), `timer "${t.name}" queues a bad task`);
      assert.ok(Object.hasOwn(JOBS, task.job), `timer "${t.name}" queues unknown job "${task.job}"`);
    }
  }
});
