import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSave } from '../src/erp/rules/check.ts';
import { RULES } from '../src/erp/rules/registers.ts';
import { MONTH_RULES } from '../src/erp/rules/month-lock.ts';

const NOW = Date.parse('2026-11-28T12:00:00+05:30');   // October closed, November open

const data: Record<string, unknown> = {
  'pt_extraHours/e1': { date: '2026-11-20', empName: 'Asha', department: 'Cutting', hours: 2, status: 'pending' },
  'pt_audit/2026-11/a1': { what: 'saved', who: 'x' },
  'pt_trash/t1': { item: 'old' },
  'pt_pressInventory/p1': { entryDate: '2026-11-01', qty: 3 },
  'pt_vendorOrders/V1/o1': { status: 'open', qty: 10, rate: 50 },
  'pt_kaTargets/k1': { target: 5 },
  'pt_baseData/old1': { receivingDate: '2026-10-12', qty: 5 },
};
const deps = (o: { admin?: boolean; vendor?: boolean } = {}) => ({
  getRecord: async (p: string) => data[p] ?? null,
  isAdmin: async () => !!o.admin,
  isVendor: async () => !!o.vendor,
  now: NOW,
});
const rules = async (changes: any[], o: { admin?: boolean; vendor?: boolean } = {}) =>
  (await checkSave('a@x.com', changes, deps(o))).map(n => n.rule);

test('the rule list matches the database checker: 21 registers, 16 with a month', () => {
  assert.equal(Object.keys(RULES).length, 21);
  assert.equal(Object.keys(MONTH_RULES).length, 16);
});

test('admin-only register: noted for staff, not for admins', async () => {
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_kaTargets/k1/target', v: 6 }]), ['admin_only']);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_kaTargets/k1/target', v: 6 }], { admin: true }), []);
});

test('admin-only value: setting status = authorized is noted for staff; other statuses are fine', async () => {
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/status', v: 'authorized' }]), ['admin_value']);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/status', v: 'authorized' }], { admin: true }), []);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/status', v: 'rejected' }]), []);
});

test('required fields: a missing or blank one is noted, with its name', async () => {
  const n = await checkSave('a@x.com', [{ k: 'put', p: 'pt_extraHours/e2', v: { date: '2026-11-21', empName: ' ', department: 'QC', hours: 1, status: 'pending' } }], deps());
  assert.deepEqual(n.map(x => [x.rule, x.detail]), [['required', 'missing: empName']]);
});

test('ranges: extra hours 0 to 16; text numbers count; non-numbers are left alone', async () => {
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/hours', v: 17 }]), ['range']);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/hours', v: '-1' }]), ['range']);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/hours', v: 16 }]), []);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/hours', v: 'n/a' }]), []);
});

test('history (add-only): adding is fine; changing, deleting, or writing over the whole list is noted', async () => {
  assert.deepEqual(await rules([{ k: 'put', p: 'pt_audit/2026-11/a2', v: { what: 'new' } }]), []);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_audit/2026-11/a1/what', v: 'edited' }]), ['add_only']);
  assert.deepEqual(await rules([{ k: 'delete', p: 'pt_trash/t1' }]), ['add_only']);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_audit', v: {} }]), ['add_only']);
});

test('no new rows (press entry): a new record is noted, editing an existing one is not', async () => {
  assert.deepEqual(await rules([{ k: 'put', p: 'pt_pressInventory/p2', v: { entryDate: '2026-11-02' } }]), ['no_new']);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_pressInventory/p1/qty', v: 4 }]), []);
});

test('vendor fields: a vendor may change status, vSent, rfdReqs only; staff are not checked', async () => {
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_vendorOrders/V1/o1', v: { status: 'sent', vSent: 10 } }], { vendor: true }), []);
  const n = await checkSave('v@x.com', [{ k: 'patch', p: 'pt_vendorOrders/V1/o1/rate', v: 99 }], deps({ vendor: true }));
  assert.deepEqual(n.map(x => [x.rule, x.detail]), [['vendor_field', 'vendor changed: rate']]);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_vendorOrders/V1/o1/rate', v: 99 }]), []);
});

test('month lock is part of the same check', async () => {
  assert.deepEqual(await rules([{ k: 'delete', p: 'pt_baseData/old1' }]), ['month_lock']);
});

test('several changes to one record are judged together, as the record ends up', async () => {
  // set hours too high, then fix it in the same save: nothing to note
  assert.deepEqual(await rules([
    { k: 'patch', p: 'pt_extraHours/e1/hours', v: 20 },
    { k: 'patch', p: 'pt_extraHours/e1/hours', v: 8 },
  ]), []);
});

test('registers without rules, and saves that change nothing, give no notes', async () => {
  assert.deepEqual(await rules([{ k: 'put', p: 'pt_masters/x', v: 1 }]), []);
  assert.deepEqual(await rules([{ k: 'patch', p: 'pt_extraHours/e1/hours', v: 2 }]), []);
});

test('admin and vendor are each looked up at most once per save', async () => {
  let a = 0, v = 0;
  await checkSave('a@x.com', [
    { k: 'patch', p: 'pt_kaTargets/k1/target', v: 7 },
    { k: 'put', p: 'pt_kaTargets/k2', v: { target: 1 } },
    { k: 'patch', p: 'pt_vendorOrders/V1/o1/rate', v: 1 },
  ], { getRecord: async p => data[p] ?? null, isAdmin: async () => { a++; return false; }, isVendor: async () => { v++; return false; }, now: NOW });
  assert.equal(a, 1);
  assert.equal(v, 1);
});
