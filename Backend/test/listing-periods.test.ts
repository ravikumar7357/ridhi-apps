import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/lib/router.ts';
import { ROUTES } from '../src/routes/index.ts';
import { baPeriods, periodWindow } from '../src/routes/listing-periods.ts';
import { FakeDb, env } from './fakes.ts';

/* Thursday 26 November 2026. The last complete month is October, the last complete week 15–21 Nov, the last
 * complete quarter Q3. */
const THU = Date.parse('2026-11-26T10:00:00Z');

const ask = (p: object, nowMs = THU) =>
  handle({ env, db: new FakeDb(), routes: ROUTES, now: () => nowMs }, 'GET',
    { listing: 'periods', key: 'secret-key', ...p }, '');

const win = (period: string, back: number, nowMs = THU) => {
  const w = periodWindow(period, back, nowMs);
  return [new Date(w.start).toISOString().slice(0, 10), new Date(w.end).toISOString().slice(0, 10), w.label];
};

test('months: whole calendar months, most recent COMPLETE one first', async () => {
  const got = JSON.parse((await ask({ period: 'MONTH', n: '3' })).body);
  assert.deepEqual(got, {
    ok: true, period: 'MONTH', periods: [
      { back: 0, label: 'October 2026', from: '2026-10-01', to: '2026-10-31' },
      { back: 1, label: 'September 2026', from: '2026-09-01', to: '2026-09-30' },
      { back: 2, label: 'August 2026', from: '2026-08-01', to: '2026-08-31' },
    ],
  });
});

test('the running period is never offered', async () => {
  // November is in progress on 26 Nov, so back:0 is October. A month in progress set beside finished ones
  // reads as a collapse.
  const got = JSON.parse((await ask({ period: 'MONTH', n: '1' })).body);
  assert.equal(got.periods[0].to, '2026-10-31');
});

test('weeks: Sunday to Saturday, and on a Saturday the week that ends TODAY is not complete', async () => {
  assert.deepEqual(win('WEEK', 0), ['2026-11-15', '2026-11-21', '15 Nov to 21 Nov 2026']);
  assert.deepEqual(win('WEEK', 1), ['2026-11-08', '2026-11-14', '8 Nov to 14 Nov 2026']);

  // Saturday 28 Nov: the last complete week is still 15–21, not 22–28.
  assert.deepEqual(win('WEEK', 0, Date.parse('2026-11-28T10:00:00Z')),
    ['2026-11-15', '2026-11-21', '15 Nov to 21 Nov 2026']);
  // Sunday 29 Nov: 22–28 has finished.
  assert.deepEqual(win('WEEK', 0, Date.parse('2026-11-29T10:00:00Z')),
    ['2026-11-22', '2026-11-28', '22 Nov to 28 Nov 2026']);
});

test('quarters, including the roll back into last year', async () => {
  assert.deepEqual(win('QUARTER', 0), ['2026-07-01', '2026-09-30', 'Q3 2026']);
  assert.deepEqual(win('QUARTER', 1), ['2026-04-01', '2026-06-30', 'Q2 2026']);
  // January 2026: the last complete quarter is Q4 of 2025.
  assert.deepEqual(win('QUARTER', 0, Date.parse('2026-01-15T10:00:00Z')),
    ['2025-10-01', '2025-12-31', 'Q4 2025']);
});

test('a leap February comes out whole', async () => {
  assert.deepEqual(win('MONTH', 0, Date.parse('2028-03-10T10:00:00Z')),
    ['2028-02-01', '2028-02-29', 'February 2028']);
});

test('how many: default 12, at least 1, at most 24 — and MONTH when no period is named', async () => {
  assert.equal((baPeriods(undefined, undefined, THU) as any).period, 'MONTH');
  assert.equal((baPeriods('MONTH', undefined, THU) as any).periods.length, 12);
  assert.equal((baPeriods('MONTH', 0, THU) as any).periods.length, 12);
  assert.equal((baPeriods('MONTH', 30, THU) as any).periods.length, 24);
  assert.equal((baPeriods('MONTH', -4, THU) as any).periods.length, 1);
  assert.equal((baPeriods('month', 2, THU) as any).period, 'MONTH');   // the name is upper-cased, as in Apps Script
});

test('anything that is not MONTH or QUARTER is a week, as in Apps Script', async () => {
  assert.deepEqual(win('WEEK', 0), win('something else', 0));
});

test('the label and the dates come from one place, so a dropdown cannot drift from the window asked for', async () => {
  const got = JSON.parse((await ask({ period: 'QUARTER', n: '4' })).body);
  for (const p of got.periods) {
    const w = periodWindow('QUARTER', p.back, THU);
    assert.equal(p.label, w.label);
    assert.equal(p.from, new Date(w.start).toISOString().slice(0, 10));
  }
});
