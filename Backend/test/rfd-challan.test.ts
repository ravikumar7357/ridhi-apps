import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInput, challanNo, challanChanges, makeRfdChallan } from '../src/erp/actions/rfd-challan.ts';
import { erpDoor } from '../src/erp/door.ts';
import { RepeatGuard } from '../src/erp/actions/rfd-challan.ts';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const good = () => ({
  requestId: 'req-0001-abcd', date: '2026-11-28', orderNo: 'PO-77', vendor: { code: 'V9', name: 'Sharma Prints' }, note: ' van 12 ',
  lines: [
    { key: 'PO-77__RPC1', sku: 'RPC1', item: 'Cushion', fabric: 'Cotton 60', pcs: 0, metres: 12.345 },
    { key: 'PO-77__RPC2', sku: 'RPC2', fabric: 'Cotton 60', pcs: 0, metres: 8 },
    { key: 'PO-77__RPC2', ruffleOnly: true, sku: 'RPC2', fabric: 'Voile', pcs: 0, metres: 3 },
  ],
  setPrinter: ['PO-77__RPC2'],
});

/** A pretend database: a counter, records, and rt_save that applies a whole list or nothing (like the real one). */
function fakeDb(o: { failSave?: boolean; taken?: string[] } = {}) {
  const records: Record<string, unknown> = {};
  for (const no of o.taken || []) records['pt_flowChallans/' + no] = { no };
  const calls: string[] = [];
  let counter = 0, saves = 0;
  const asPerson = async (fn: string, args: any) => {
    calls.push(fn);
    if (fn === 'next_no') return ++counter;
    if (fn === 'rt_get') return records[args.p_path] ?? null;
    if (fn === 'rt_save') {
      if (o.failSave) throw new Error('rt_save: permission denied');
      saves++;
      for (const c of args.p_changes) records[c.p] = c.v;
      return args.p_changes.length;
    }
    throw new Error('unexpected ' + fn);
  };
  return { asPerson, records, calls, saves: () => saves };
}

test('input checks: each problem gets a plain message', () => {
  assert.equal(checkInput(good()), '');
  assert.match(checkInput({ ...good(), requestId: '' }), /request has no id/);
  assert.match(checkInput({ ...good(), date: '28/11/2026' }), /2026-11-28/);
  assert.match(checkInput({ ...good(), vendor: { code: ' ' } }), /vendor/);
  assert.match(checkInput({ ...good(), lines: [] }), /at least one line/);
  assert.match(checkInput({ ...good(), lines: [{ key: 'a/b', sku: 'X', pcs: 1, metres: 1 }] }), /proper key/);
  assert.match(checkInput({ ...good(), lines: [{ key: 'k', sku: 'X', pcs: 1.5, metres: 1 }] }), /whole number/);
  assert.match(checkInput({ ...good(), lines: [{ key: 'k', sku: 'X', pcs: 0, metres: 0 }] }), /nothing to send/);
  assert.match(checkInput({ ...good(), lines: [{ key: 'k', sku: 'X', ruffleOnly: true, pcs: 0, metres: 0 }] }), /ruffle/);
  assert.match(checkInput({ ...good(), lines: [{ key: 'k', sku: 'X', pcs: 1, metres: 1 }, { key: 'k', sku: 'X', pcs: 1, metres: 1 }] }), /twice/);
  assert.match(checkInput({ ...good(), setPrinter: ['other'] }), /only be set for a line on this challan/);
});

test('numbers look like today: RFD-202611-007, TRFD- for test orders', () => {
  assert.equal(challanNo(false, '2026-11-28', 7), 'RFD-202611-007');
  assert.equal(challanNo(true, '2026-12-01', 12), 'TRFD-202612-012');
});

test('the changes are the same records the page writes today', () => {
  const { challan, changes } = challanChanges(good() as any, 'RFD-202611-001', 'a@x.com', '2026-11-28T10:00:00.000Z');
  assert.deepEqual(changes.map(c => c.p), [
    'pt_flowChallans/RFD-202611-001',
    'pt_ppc/PO-77__RPC2/printer',
    'pt_flowDemand/PO-77__RPC1/fabricReady',
    'pt_flowDemand/PO-77__RPC2/fabricReady',   // the ruffle-only line is on the challan but marks no demand
  ]);
  assert.equal((challan as any).note, 'van 12');
  assert.equal((challan as any).lines[0].metres, 12.35);
  assert.equal((challan as any).lines[2].ruffleOnly, true);
  assert.deepEqual((changes[2].v as any).challan, 'RFD-202611-001');
  assert.equal((changes[1].v as any).why, 'set by challan RFD-202611-001');
});

test('one save: the number, then everything in ONE rt_save call', async () => {
  const db = fakeDb();
  const r = await makeRfdChallan('a@x.com', good() as any, { asPerson: db.asPerson, now: () => NOW });
  assert.equal(r.no, 'RFD-202611-001');
  assert.deepEqual(db.calls, ['next_no', 'rt_get', 'rt_save']);
  assert.equal(db.saves(), 1);
  assert.ok(db.records['pt_flowChallans/RFD-202611-001']);
  assert.ok(db.records['pt_flowDemand/PO-77__RPC1/fabricReady']);
});

test('all or nothing: when the save is refused, nothing at all is written', async () => {
  const db = fakeDb({ failSave: true });
  await assert.rejects(makeRfdChallan('a@x.com', good() as any, { asPerson: db.asPerson, now: () => NOW }), /permission denied/);
  assert.deepEqual(Object.keys(db.records), []);
});

test('a number made the old way is skipped, never written over', async () => {
  const db = fakeDb({ taken: ['RFD-202611-001', 'RFD-202611-002'] });
  const r = await makeRfdChallan('a@x.com', good() as any, { asPerson: db.asPerson, now: () => NOW });
  assert.equal(r.no, 'RFD-202611-003');
  assert.deepEqual(db.records['pt_flowChallans/RFD-202611-001'], { no: 'RFD-202611-001' });
});

test('bad input never reaches the database', async () => {
  const db = fakeDb();
  await assert.rejects(makeRfdChallan('a@x.com', { ...good(), lines: [] } as any, { asPerson: db.asPerson, now: () => NOW }), /at least one line/);
  assert.deepEqual(db.calls, []);
});

// through the door, as a page would call it
const fakeFetch = (db: ReturnType<typeof fakeDb>) => (async (url: string, init: any) => {
  const fn = String(url).split('/rpc/')[1];
  try { return new Response(JSON.stringify(await db.asPerson(fn, JSON.parse(init.body))), { status: 200 }); }
  catch (e) { return new Response(JSON.stringify({ message: (e as Error).message }), { status: 400 }); }
}) as unknown as typeof fetch;

test('through the door: signed in, made once; the same request again gives the same answer and writes nothing', async () => {
  const db = fakeDb(), repeat = new RepeatGuard(), lines: any[] = [];
  const deps = { verifyIdToken: async () => 'a@x.com', fetch: fakeFetch(db), repeat, now: () => NOW, log: (l: any) => lines.push(l) };
  const body = JSON.stringify({ idToken: 't', ...good() });
  const a = await erpDoor(deps, 'action/rfd-challan', body);
  const b = await erpDoor(deps, 'action/rfd-challan', body);
  assert.deepEqual(a, { ok: true, no: 'RFD-202611-001', lines: 3 });
  assert.deepEqual(b, a);
  assert.equal(db.saves(), 1);
  assert.ok(lines.some(l => l.repeat));
});

test('through the door: a failed try can be sent again (it was not remembered)', async () => {
  const db = fakeDb({ failSave: true }), repeat = new RepeatGuard();
  const deps = { verifyIdToken: async () => 'a@x.com', fetch: fakeFetch(db), repeat, now: () => NOW };
  const body = JSON.stringify({ idToken: 't', ...good() });
  assert.equal((await erpDoor(deps, 'action/rfd-challan', body)).ok, false);
  assert.equal(repeat.get('a@x.com|rfd-challan|req-0001-abcd', NOW), null);
});

test('through the door: no sign-in, no challan', async () => {
  const db = fakeDb();
  const out = await erpDoor({ verifyIdToken: async () => null, fetch: fakeFetch(db) }, 'action/rfd-challan', JSON.stringify(good()));
  assert.equal(out.ok, false);
  assert.deepEqual(db.calls, []);
});
