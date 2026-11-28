import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveVendorOrder, planVoApproval, checkVoInput, pickLines, istDay, NO_VO_RIGHT } from '../src/erp/actions/approve-vendor-order.ts';

const NOW = Date.parse('2026-11-28T20:00:00Z');   // 29 Nov, 1:30 AM in India
const req = () => ({
  id: 'vrq1', reqNo: 'VRQ-12', status: 'pending', vendorCode: 'V1', vendorName: 'Asha Prints', service: 'Block print',
  orderType: 'cut', requestedBy: 'buyer@x.com', notes: 'rush',
  lines: [{ sku: 'RPC1', qty: 10 }, { sku: 'RPC2', qty: 5, cancelled: true }, { sku: 'RPC3', qty: 7 }],
});
const vendors = [{ code: 'V1', name: 'Asha', desc: 'Asha Prints', email: 'ASHA@X.COM' }, { code: 'V2', name: 'Om', active: false }, { code: 'V3', name: 'Ravi Emb' }];
const input = (extra: object = {}) => ({ requestId: 'req-vo-0001', reqId: 'vrq1', ...extra });

test('input checks', () => {
  assert.equal(checkVoInput(input()), '');
  assert.match(checkVoInput(input({ reqId: 'a/b' })), /Which request/);
  assert.match(checkVoInput(input({ stampedLines: 'x' })), /not a list/);
});

test('the day is India time: the number and the order date follow it', () => {
  assert.deepEqual(istDay(NOW), { dmy: '29/11/2026', yymmdd: '261129', yyyymm: '202611' });
});

test('cancelled lines are left out; the page\'s stamped lines are taken only when they are the same lines', () => {
  const mine = req().lines;
  assert.deepEqual(pickLines(mine, undefined).map(l => l.sku), ['RPC1', 'RPC3']);
  const stamped = [{ sku: 'RPC1', qty: 10, orders: ['SO-1'] }, { sku: 'RPC3', qty: 7, orders: ['SO-2'] }];
  assert.deepEqual(pickLines(mine, stamped)[0].orders, ['SO-1']);
  const changed = [{ sku: 'RPC1', qty: 99, orders: ['SO-1'] }, { sku: 'RPC3', qty: 7 }];
  assert.equal(pickLines(mine, changed)[0].qty, 10);   // quantity changed by the page: the request's own lines are used
});

test('the order, the vendor login and the approved request, as the page writes them', () => {
  const p = planVoApproval(req(), vendors, null, input({ note: ' ok ' }), 'boss@x.com', 'T', '29/11/2026', 'VPO-261129-004') as any;
  assert.equal(p.order.id, 'vpo_vrq1');
  assert.equal(p.order.orderNo, 'VPO-261129-004');
  assert.equal(p.order.status, 'Placed');
  assert.equal(p.order.vendorName, 'Asha Prints');
  assert.equal(p.order.createdBy, 'buyer@x.com');
  assert.equal(p.order.demandSource, 'bulk');
  assert.deepEqual(p.map, { email: 'asha@x.com', name: 'Asha' });
  assert.equal(p.request.status, 'approved');
  assert.equal(p.request.vendorOrderNo, 'VPO-261129-004');
  assert.match(p.request.log.at(-1).what, /Approved and sent to Asha Prints as VPO-261129-004 — ok/);
});

test('sent to another vendor: the log says who was asked for', () => {
  const p = planVoApproval(req(), vendors, null, input({ vendor: 'V3' }), 'b', 'T', 'd', 'VPO-1') as any;
  assert.equal(p.order.vendorCode, 'V3');
  assert.match(p.request.log.at(-1).what, /\(asked for Asha Prints\)/);
  assert.equal(p.map, null);   // V3 has no email: no login to map
});

test('refused: request gone or not pending, vendor inactive or unknown, no lines', () => {
  assert.match((planVoApproval(null, vendors, null, input(), 'b', 'T', 'd', 'n') as any).error, /gone/);
  assert.match((planVoApproval({ ...req(), status: 'approved' }, vendors, null, input(), 'b', 'T', 'd', 'n') as any).error, /not waiting/);
  assert.match((planVoApproval(req(), vendors, null, input({ vendor: 'V2' }), 'b', 'T', 'd', 'n') as any).error, /not active/);
  assert.match((planVoApproval(req(), vendors, null, input({ vendor: 'V9' }), 'b', 'T', 'd', 'n') as any).error, /not active/);
  assert.match((planVoApproval({ ...req(), lines: [{ sku: 'X', qty: 1, cancelled: true }] }, vendors, null, input(), 'b', 'T', 'd', 'n') as any).error, /no lines/);
});

test('the order was already sent (an earlier try): it is not written again and keeps its number', () => {
  const p = planVoApproval(req(), vendors, { orderNo: 'VPO-261120-ABC' }, input(), 'b', 'T', 'd', '') as any;
  assert.equal(p.order, null);
  assert.equal(p.map, null);
  assert.equal(p.request.vendorOrderNo, 'VPO-261120-ABC');
});

function fakeDb(o: { request?: any; existing?: any; failSave?: boolean } = {}) {
  const records: Record<string, unknown> = {}, calls: string[] = [];
  let n = 0, saves = 0;
  const asPerson = async (fn: string, args: any) => {
    calls.push(fn);
    if (fn === 'rt_get') {
      if (args.p_path === 'pt_vendorOrderReqs/vrq1') return 'request' in o ? o.request : req();
      if (args.p_path === 'pt_masters/vendor') return { a: vendors[0], b: vendors[1], c: vendors[2] };
      if (args.p_path.startsWith('pt_vendorOrders/')) return o.existing ?? null;
      return null;
    }
    if (fn === 'next_no') return ++n;
    if (fn === 'rt_save') { if (o.failSave) throw new Error('rt_save: refused'); saves++; for (const c of args.p_changes) records[c.p] = c.v; return args.p_changes.length; }
    throw new Error('unexpected ' + fn);
  };
  return { asPerson, records, calls, saves: () => saves };
}
const may = async () => ({ vreqApprove: true });

test('the right is checked by the server first: nothing read or written without it', async () => {
  for (const perms of [async () => ({ soApprove: true }), async () => ({ admin: true, vendor: true }), async () => null]) {
    const db = fakeDb();
    await assert.rejects(approveVendorOrder('x@x.com', input(), { asPerson: db.asPerson, perms, now: () => NOW }), new RegExp(NO_VO_RIGHT.slice(0, 30)));
    assert.deepEqual(db.calls, []);
  }
});

test('order + vendor login + request in ONE save, with a number from the counter', async () => {
  const db = fakeDb();
  const r = await approveVendorOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW });
  assert.deepEqual(r, { ok: true, orderNo: 'VPO-261129-001', vendor: 'Asha Prints', sentBefore: false });
  assert.equal(db.saves(), 1);
  assert.deepEqual(Object.keys(db.records).sort(), ['pt_vendorMap/V1', 'pt_vendorOrderReqs/vrq1', 'pt_vendorOrders/V1/vpo_vrq1']);
});

test('approving after an earlier half-finished try: the order is not sent twice and no new number is used', async () => {
  const db = fakeDb({ existing: { orderNo: 'VPO-261120-ABC' } });
  const r = await approveVendorOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW });
  assert.equal(r.sentBefore, true);
  assert.equal(r.orderNo, 'VPO-261120-ABC');
  assert.ok(!db.calls.includes('next_no'));
  assert.deepEqual(Object.keys(db.records), ['pt_vendorOrderReqs/vrq1']);
});

test('all or nothing: a refused save writes none of the three', async () => {
  const db = fakeDb({ failSave: true });
  await assert.rejects(approveVendorOrder('boss@x.com', input(), { asPerson: db.asPerson, perms: may, now: () => NOW }), /refused/);
  assert.deepEqual(Object.keys(db.records), []);
});
