import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthOf, monthClosed, checkMonthLock } from '../src/erp/rules/month-lock.ts';
import { erpDoor } from '../src/erp/door.ts';

// 28 Nov 2026, noon India time: October closed on 6 Nov; November is open.
const NOW = Date.parse('2026-11-28T12:00:00+05:30');

test('monthOf reads every date shape the ERP stores', () => {
  assert.equal(monthOf('2026-10-14'), '2026-10');
  assert.equal(monthOf('2026-10-14T23:00:00Z'), '2026-10');
  assert.equal(monthOf('14/10/2026, 10:30'), '2026-10');
  assert.equal(monthOf('4/9/2026'), '2026-09');
  assert.equal(monthOf(Date.parse('2026-10-31T20:00:00Z')), '2026-11');   // 1 Nov in India
  assert.equal(monthOf(String(Date.parse('2026-10-10T00:00:00Z'))), '2026-10');
  assert.equal(monthOf(''), null);
  assert.equal(monthOf('yesterday'), null);
  assert.equal(monthOf(null), null);
});

test('a month closes at midnight India time after the 5th of the next month', () => {
  assert.equal(monthClosed('2026-10', Date.parse('2026-11-05T23:59:00+05:30')), false);
  assert.equal(monthClosed('2026-10', Date.parse('2026-11-06T00:00:00+05:30')), true);
  assert.equal(monthClosed('2026-12', Date.parse('2027-01-06T00:00:00+05:30')), true);   // December closes in the next year
  assert.equal(monthClosed('2026-11', NOW), false);
  assert.equal(monthClosed(null, NOW), false);
});

const data: Record<string, unknown> = {
  'pt_baseData/old1': { receivingDate: '2026-10-12', qty: 5 },
  'pt_baseData/new1': { receivingDate: '2026-11-20', qty: 5 },
  'pt_vendorChallans/V1/c1': { date: '10/10/2026', qty: 1 },
};
const deps = (admins: string[] = []) => ({
  getRecord: async (p: string) => data[p] ?? null,
  isAdmin: async (e: string) => admins.includes(e),
  now: NOW,
});

test('changing a record of a closed month is noted; an open month is not', async () => {
  const n = await checkMonthLock('a@x.com', [{ k: 'patch', p: 'pt_baseData/old1/qty', v: 6 }, { k: 'patch', p: 'pt_baseData/new1/qty', v: 6 }], deps());
  assert.deepEqual(n.map(x => [x.rule, x.path]), [['month_lock', 'pt_baseData/old1']]);
  assert.match(n[0].detail, /2026-10/);
});

test('deleting a closed-month record, adding into a closed month, and moving out of one are all noted', async () => {
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'delete', p: 'pt_baseData/old1' }], deps())).length, 1);
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'put', p: 'pt_baseData/brandnew', v: { receivingDate: '2026-09-01' } }], deps())).length, 1);
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'patch', p: 'pt_baseData/old1', v: { receivingDate: '2026-11-01' } }], deps())).length, 1);
});

test('admins are noted as allowed, not as breaking the rule', async () => {
  const n = await checkMonthLock('boss@x.com', [{ k: 'delete', p: 'pt_baseData/old1' }], deps(['boss@x.com']));
  assert.equal(n[0].rule, 'month_lock_admin');
});

test('three-level registers, saving the same value, and other registers are handled', async () => {
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'patch', p: 'pt_vendorChallans/V1/c1/qty', v: 2 }], deps())).length, 1);
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'patch', p: 'pt_baseData/old1/qty', v: 5 }], deps())).length, 0);   // no real change
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'put', p: 'pt_masters/x', v: 1 }], deps())).length, 0);
  assert.equal((await checkMonthLock('a@x.com', [{ k: 'put', p: 'pt_baseData', v: {} }], deps())).length, 0);           // above one record
});

test('in the door: the note is logged and the save still goes through', async () => {
  const lines: any[] = [];
  const out = await erpDoor({
    verifyIdToken: async () => 'a@x.com',
    rules: { getRecord: async p => data[p] ?? null, isAdmin: async () => false },
    fetch: (async () => new Response('1', { status: 200 })) as unknown as typeof fetch,
    log: l => lines.push(l), now: () => NOW,
  }, 'save', JSON.stringify({ idToken: 't', changes: [{ k: 'delete', p: 'pt_baseData/old1' }] }));
  assert.deepEqual(out, { ok: true, saved: 1 });
  assert.equal(lines.find(l => l.ruleNote)?.ruleNote, 'month_lock');
});

test('in the door: a broken rule check never stops the save', async () => {
  const lines: any[] = [];
  const out = await erpDoor({
    verifyIdToken: async () => 'a@x.com',
    rules: { getRecord: async () => { throw new Error('database away'); }, isAdmin: async () => false },
    fetch: (async () => new Response('1', { status: 200 })) as unknown as typeof fetch,
    log: l => lines.push(l), now: () => NOW,
  }, 'save', JSON.stringify({ idToken: 't', changes: [{ k: 'delete', p: 'pt_baseData/old1' }] }));
  assert.equal(out.ok, true);
  assert.equal(lines.find(l => l.ruleNote)?.ruleNote, 'checker_error');
});
