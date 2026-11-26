import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/lib/router.ts';
import { ROUTES } from '../src/routes/index.ts';
import { weekKeyOf, weeklyKeys, WEEKLY_WEEKS } from '../src/routes/weekly-keys.ts';
import { FakeDb, env } from './fakes.ts';

/* Thursday 26 November 2026, 10:00 UTC = 02:00 Pacific the same day. Its week is the Sunday before: 22 Nov. */
const THU = Date.parse('2026-11-26T10:00:00Z');

const ask = (p: object, nowMs: number) =>
  handle({ env, db: new FakeDb(), routes: ROUTES, now: () => nowMs }, 'GET',
    { weekly: 'keys', key: 'secret-key', ...p }, '');

test('the route answers ok with the weeks, oldest first, ending with the week in progress', async () => {
  const got = JSON.parse((await ask({ weeks: '3' }, THU)).body);
  assert.deepEqual(got, { ok: true, weeks: ['2026-11-08', '2026-11-15', '2026-11-22'] });
});

test('a week is named by its own Sunday — including when the day IS Sunday', async () => {
  // The bug WeeklyPpc.gs was bitten by: a Sunday filed under the week before, so every week carried the next
  // week's Sunday and lost its own — about a seventh of the week.
  assert.equal(weekKeyOf(Date.parse('2026-11-29T00:00:00Z')), '2026-11-29');   // Sunday → itself
  assert.equal(weekKeyOf(Date.parse('2026-11-28T23:59:59Z')), '2026-11-22');   // Saturday → the Sunday before
  assert.equal(weekKeyOf(Date.parse('2026-11-26T10:00:00Z')), '2026-11-22');   // Thursday → the Sunday before
});

test('the week in progress follows the MARKETPLACE day, not UTC', async () => {
  // Saturday 19:00 Pacific, when UTC has already ticked over to Sunday. The week in progress is still the one
  // that started 22 Nov; taking the raw instant would jump a week early.
  const satEveningPt = Date.parse('2026-11-29T03:00:00Z');
  assert.deepEqual(weeklyKeys(1, satEveningPt), ['2026-11-22']);

  // Noon Pacific on the Sunday itself: now the new week has begun.
  assert.deepEqual(weeklyKeys(1, Date.parse('2026-11-29T20:00:00Z')), ['2026-11-29']);
});

test('how many weeks: default 26, at least 1, at most 104 — same clamp as Apps Script', async () => {
  assert.equal(weeklyKeys(undefined, THU).length, WEEKLY_WEEKS);
  assert.equal(weeklyKeys('', THU).length, 26);
  assert.equal(weeklyKeys(0, THU).length, 26);          // 0 is falsy → the default, as in Apps Script
  assert.equal(weeklyKeys('abc', THU).length, 26);
  assert.equal(weeklyKeys(500, THU).length, 104);
  assert.equal(weeklyKeys(-5, THU).length, 1);
});

test('every key is a Sunday, seven days apart', async () => {
  const weeks = weeklyKeys(26, THU);
  for (const k of weeks) assert.equal(new Date(k + 'T00:00:00Z').getUTCDay(), 0, k + ' is not a Sunday');
  for (let i = 1; i < weeks.length; i++) {
    const gap = Date.parse(weeks[i] + 'T00:00:00Z') - Date.parse(weeks[i - 1] + 'T00:00:00Z');
    assert.equal(gap, 7 * 86400000);
  }
});

test('the wrong key is refused, as everywhere else', async () => {
  const got = JSON.parse((await handle({ env, db: new FakeDb(), routes: ROUTES }, 'GET',
    { weekly: 'keys', key: 'wrong' }, '')).body);
  assert.equal(got.ok, false);
  assert.match(got.error, /Unauthorized/);
});
