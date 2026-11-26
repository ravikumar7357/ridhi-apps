import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJob, keepOldIfEmpty } from '../src/lib/jobs.ts';
import { FakeDb } from './fakes.ts';

test('a good run is logged with its rows and time', async () => {
  const db = new FakeDb();
  let t = 1_000_000;
  const r = await runJob(db, 'ads-daily', async () => { t += 250; return 42; }, () => t);
  assert.deepEqual({ ok: r.ok, rows: r.rows, ms: r.ms }, { ok: true, rows: 42, ms: 250 });
  assert.equal(db.runs.length, 1);
  assert.equal(db.runs[0].job, 'ads-daily');
  assert.equal(db.runs[0].rows_written, 42);
  assert.equal(db.runs[0].error, null);
});

test('a failing job is logged as failed and does not throw (the next job still runs)', async () => {
  const db = new FakeDb();
  const r = await runJob(db, 'sales-daily', async () => { throw new Error('Amazon 503: busy'); });
  assert.equal(r.ok, false);
  assert.match(r.error!, /Amazon 503/);
  assert.equal(db.runs[0].ok, false);
});

test('never save empty over good: an empty result stops the job before it writes', async () => {
  const db = new FakeDb();
  const r = await runJob(db, 'listings', async () => {
    const rows = keepOldIfEmpty([], 'Listings report for CPC');
    return db.upsert('listings', rows, 'sku');
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /came back empty; the old data was kept/);
  assert.equal(db.tables.listings, undefined);
});

test('if the log itself fails, a good run is still a good run', async () => {
  const db = new FakeDb();
  db.failLog = true;
  const r = await runJob(db, 'x', async () => 1);
  assert.equal(r.ok, true);
});
