import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveSalesOrder, planApproval, checkApproveInput, NO_RIGHT } from '../src/erp/actions/approve-sales-order.ts';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const order = () => ({
  _id: 'SO-101', channel: 'ONL', buyerName: 'Meera', orderDate: '2026-11-20', status: 'pending',
  lines: [
    { sku: 'rpc1', qty: 10, deliveryDate: '2026-12-10' },
    { sku: 'RPC1', qty: 5, deliveryDate: '2026-12-12' },     // the same SKU twice: one book row of 15
    { sku: 'RPC2', qty: 4 },                                  // no date of its own
  ],
});
const master = new Map([['RPC1', { sku: 'RPC1', articleType: 'Cushion', subtype: 'Square', color: 'Blue', size: '16x16' }]]);
const input = (extra: object = {}) => ({ requestId: 'req-so-0001', orderId: 'SO-101', mode: 'complete' as const, date: '2026-12-15', remarks: ' ok ', ...extra });

test('input checks', () => {
  assert.equal(checkApproveInput(input()), '');
  assert.match(checkApproveInput(input({ mode: 'complete', date: '' })), /delivery date/);
  assert.match(checkApproveInput(input({ mode: 'other' })), /how delivery is dated/);
  assert.match(checkApproveInput(input({ orderId: 'a/b' })), /Which order/);
});

test('one date for the whole order: every line gets it; one book row per SKU with the summed quantity', () => {
  const p = planApproval(order(), new Set(), master, input(), 'boss@x.com', '2026-11-28T10:00:00.000Z') as any;
  assert.equal(p.order.status, 'approved');
  assert.equal(p.order.approvedBy, 'boss@x.com');
  assert.equal(p.order.saRemarks, 'ok');
  assert.ok(p.order.lines.every((l: any) => l.deliveryDate === '2026-12-15'));
  assert.deepEqual(p.rows.map((r: any) => [r.id, r.qty]), [['ob_so_SO-101_RPC1', 15], ['ob_so_SO-101_RPC2', 4]]);
  assert.equal(p.rows[0].articleType, 'Cushion');
  assert.equal(p.rows[0].remarks, 'From approved Sales Order · Meera');
});

test('date on each line: refused while a line has none', () => {
  const p = planApproval(order(), new Set(), master, input({ mode: 'lines' }), 'b', 'T') as any;
  assert.match(p.error, /1 line\(s\) have no delivery date/);
});

test('approving again adds only what is missing from the book', () => {
  const p = planApproval(order(), new Set(['RPC1']), master, input(), 'b', '2026-11-28T10:00:00.000Z') as any;
  assert.deepEqual(p.rows.map((r: any) => r.sku), ['RPC2']);
});

test('B2B: the line describes the row, and a SKU the master lacks is flagged', () => {
  const o = { ...order(), channel: 'B2B', lines: [{ sku: 'NEW9', qty: 3, brand: 'Acme', itemName: 'Throw', label: 'No', material: 'Linen', color: 'Red', size: 'L' }] };
  const p = planApproval(o, new Set(), master, input(), 'b', '2026-11-28T10:00:00.000Z') as any;
  assert.equal(p.rows[0].needsSku, true);
  assert.equal(p.rows[0].color, 'Red');
  assert.equal(p.rows[0].remarks, 'From approved Sales Order · Meera · Acme · Throw · Material: Linen');
});

function fakeDb(o: any, book: Record<string, any> = {}, failSave = false) {
  const records: Record<string, unknown> = {}, calls: string[] = [];
  let saves = 0;
  const asPerson = async (fn: string, args: any) => {
    calls.push(fn + (args.p_path ? ':' + args.p_path : ''));
    if (fn === 'rt_get') {
      if (args.p_path === 'pt_salesOrders/SO-101') return o;
      if (args.p_path === 'pt_orderBook') return book;
      if (args.p_path === 'pt_masterDB') return { a: { sku: 'RPC1', articleType: 'Cushion' } };
      return null;
    }
    if (fn === 'rt_save') { if (failSave) throw new Error('rt_save: at most 8 MB at once'); saves++; for (const c of args.p_changes) records[c.p] = c.v; return args.p_changes.length; }
    throw new Error('unexpected ' + fn);
  };
  return { asPerson, records, calls, saves: () => saves };
}
const may = async () => ({ soApprove: true });

test('the right is checked by the server: no right, a vendor, or rights unknown → refused, nothing read or written', async () => {
  for (const perms of [async () => ({}), async () => ({ admin: true, vendor: true }), async () => null]) {
    const db = fakeDb(order());
    await assert.rejects(approveSalesOrder('x@x.com', input(), { asPerson: db.asPerson, perms, now: () => NOW }), new RegExp(NO_RIGHT.slice(0, 30)));
    assert.deepEqual(db.calls, []);
  }
});

test('approval and every book row in ONE save', async () => {
  const db = fakeDb(order());
  const r = await approveSalesOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW });
  assert.deepEqual(r, { ok: true, orderId: 'SO-101', added: 2, alreadyInBook: 0 });
  assert.equal(db.saves(), 1);
  assert.equal((db.records['pt_salesOrders/SO-101'] as any).status, 'approved');
  assert.ok(db.records['pt_orderBook/ob_so_SO-101_RPC1'] && db.records['pt_orderBook/ob_so_SO-101_RPC2']);
});

test('the book is read fresh: rows already there (from any key) are not written again', async () => {
  const db = fakeDb(order(), { old1: { orderNo: 'SO-101', sku: 'rpc1' } });
  const r = await approveSalesOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW });
  assert.equal(r.added, 1);
  assert.equal(db.records['pt_orderBook/ob_so_SO-101_RPC1'], undefined);
});

test('all or nothing: a refused save leaves the order not approved and the book untouched', async () => {
  const db = fakeDb(order(), {}, true);
  await assert.rejects(approveSalesOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW }), /8 MB/);
  assert.deepEqual(Object.keys(db.records), []);
});

test('an order that is gone is said plainly', async () => {
  const db = fakeDb(null);
  await assert.rejects(approveSalesOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW }), /That order is gone/);
});
