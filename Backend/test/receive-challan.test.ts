import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReceipt, checkReceiveInput, receiveOnChallan } from '../src/erp/actions/receive-challan.ts';
import { erpDoor } from '../src/erp/door.ts';
import { RepeatGuard } from '../src/erp/actions/rfd-challan.ts';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const challan = () => ({
  no: 'RFD-202611-001', orderNo: 'PO-77', vendor: { code: 'V9', name: 'Sharma Prints' },
  lines: [
    { key: 'L1', sku: 'RPC1', metres: 100, pcs: 0 },                          // cloth: 100 m given
    { key: 'L2', sku: 'RPC2', pcs: 40, metres: 20, print: { kind: 'sku' } },   // pieces: 40 given
  ],
  receipts: { r0: { items: { L1: 50 } } },                                     // 50 m already back
});
const input = (items: Record<string, number>, extra: object = {}) => ({ requestId: 'req-rcv-0001', no: 'RFD-202611-001', date: '2026-11-28', items, ...extra });

test('input checks', () => {
  assert.equal(checkReceiveInput(input({ L1: 5 })), '');
  assert.match(checkReceiveInput(input({ L1: 5 }, { no: 'ABC' })), /number looks wrong/);
  assert.match(checkReceiveInput(input({})), /at least one line/);
  assert.match(checkReceiveInput(input({ L1: -1 })), /0 or more/);
});

test('cloth may come up to 10% over what was given, never more', () => {
  assert.ok('next' in applyReceipt(challan(), input({ L1: 60 }), 'a', 'T', 'r1'));            // 50 + 60 = 110 = 100 + 10%
  const r = applyReceipt(challan(), input({ L1: 61 }), 'a', 'T', 'r1');
  assert.ok('error' in r && /More came back than was given for RPC1/.test(r.error));
});

test('pieces are whole and never over', () => {
  assert.match((applyReceipt(challan(), input({ L2: 2.5 }), 'a', 'T', 'r1') as any).error, /whole/);
  assert.match((applyReceipt(challan(), input({ L2: 41 }), 'a', 'T', 'r1') as any).error, /More came back/);
});

test('a line not on the challan, a moved line, a closed or cancelled challan are refused', () => {
  assert.match((applyReceipt(challan(), input({ X9: 1 }), 'a', 'T', 'r1') as any).error, /Not on challan/);
  assert.match((applyReceipt({ ...challan(), moved: { L1: { to: { name: 'B' } } } }, input({ L1: 1 }), 'a', 'T', 'r1') as any).error, /Moved/);
  assert.match((applyReceipt({ ...challan(), closed: { why: 'all received' } }, input({ L1: 1 }), 'a', 'T', 'r1') as any).error, /already closed/);
  assert.match((applyReceipt({ ...challan(), cancelled: true }, input({ L1: 1 }), 'a', 'T', 'r1') as any).error, /cancelled/);
  assert.match((applyReceipt(null, input({ L1: 1 }), 'a', 'T', 'r1') as any).error, /not found/);
});

test('the receipt is added; the challan closes only when every line is back', () => {
  const part = applyReceipt(challan(), input({ L1: 50 }, { note: ' lot 4 ', notCame: ['L2'] }), 'a@x.com', '2026-11-28T10:00:00.000Z', 'r1') as any;
  assert.equal(part.closed, false);
  assert.deepEqual(part.next.receipts.r1, { date: '2026-11-28', items: { L1: 50 }, note: 'lot 4', at: '2026-11-28T10:00:00.000Z', by: 'a@x.com', notCame: ['L2'] });
  assert.ok(part.next.receipts.r0);
  const all = applyReceipt(challan(), input({ L1: 50, L2: 40 }), 'a@x.com', 'T', 'r1') as any;
  assert.equal(all.closed, true);
  assert.equal(all.next.closed.why, 'all received');
});

/** A pretend database with a real compare-and-set: writes only if the challan is still as it was read. */
function fakeDb(start: any, o: { otherReceivesFirst?: number } = {}) {
  let value = start, otherWrites = o.otherReceivesFirst || 0;
  const calls: string[] = [];
  const asPerson = async (fn: string, args: any) => {
    calls.push(fn);
    if (fn === 'rt_get') return value;
    if (fn === 'rt_cas') {
      if (otherWrites > 0) { otherWrites--; value = { ...value, receipts: { ...value.receipts, rX: { items: { L1: 45 } } } }; }   // someone else got there first
      if (JSON.stringify(value) !== JSON.stringify(args.p_expect)) return 'changed';
      value = args.p_next; return '';
    }
    throw new Error('unexpected ' + fn);
  };
  return { asPerson, calls, value: () => value };
}

test('saved with compare-and-set: read fresh, write only if unchanged', async () => {
  const db = fakeDb(challan());
  const r = await receiveOnChallan('a@x.com', input({ L1: 20 }), { asPerson: db.asPerson, now: () => NOW, newId: () => 'r1' });
  assert.deepEqual(r, { ok: true, no: 'RFD-202611-001', receipt: 'r1', closed: false });
  assert.deepEqual(db.calls, ['rt_get', 'rt_cas']);
  assert.deepEqual(db.value().receipts.r1.items, { L1: 20 });
});

test('two people at once: the second is checked again against the fresh challan and refused if it would go over', async () => {
  // 50 m back already; someone else just received 45 m more (95 m); this person's 20 m would make 115 m > 110 m
  const db = fakeDb(challan(), { otherReceivesFirst: 1 });
  await assert.rejects(receiveOnChallan('a@x.com', input({ L1: 20 }), { asPerson: db.asPerson, now: () => NOW, newId: () => 'r1' }), /More came back than was given/);
  assert.equal(db.value().receipts.r1, undefined);
});

test('two people at once, both fit: the second is simply written after a fresh read', async () => {
  const db = fakeDb(challan(), { otherReceivesFirst: 1 });
  const r = await receiveOnChallan('a@x.com', input({ L1: 10 }), { asPerson: db.asPerson, now: () => NOW, newId: () => 'r1' });
  assert.equal(r.ok, true);
  assert.deepEqual(db.calls, ['rt_get', 'rt_cas', 'rt_get', 'rt_cas']);
  assert.ok(db.value().receipts.rX && db.value().receipts.r1);
});

test('through the door: repeat-safe, like every action', async () => {
  const db = fakeDb(challan()), repeat = new RepeatGuard();
  const fetchFake = (async (url: string, init: any) => {
    const fn = String(url).split('/rpc/')[1];
    return new Response(JSON.stringify(await db.asPerson(fn, JSON.parse(init.body))), { status: 200 });
  }) as unknown as typeof fetch;
  const deps = { verifyIdToken: async () => 'a@x.com', fetch: fetchFake, repeat, now: () => NOW };
  const body = JSON.stringify({ idToken: 't', ...input({ L1: 5 }) });
  const a = await erpDoor(deps, 'action/receive-challan', body);
  const b = await erpDoor(deps, 'action/receive-challan', body);
  assert.equal(a.ok, true);
  assert.deepEqual(b, a);
  assert.equal(db.calls.filter(c => c === 'rt_cas').length, 1);
});
