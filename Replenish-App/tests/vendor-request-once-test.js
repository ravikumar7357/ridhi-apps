/* Vendor Order Requests · two people answering one request at once (src/app/vendors/orders/vendor-order-requests.js — vrqApprove,
 * vrqReject, vrqWithdraw, vrqWrite; src/app/core/history.js — lineHoldOn).
 * Ravi, 26 Nov, "two users, one request": both approvers passed the on-screen "still pending" check, each made a printer order under
 * a NEW order number, and the second replaced the first. With the switch lineHold on, the printer order is written only where none
 * is yet, and the request's answer only if it is still waiting and unchanged. Cases are made up.
 *   node tests/vendor-request-once-test.js      (VRQ_FILE=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.VRQ_FILE || path.join(__dirname, '..', 'src', 'app', 'vendors', 'orders', 'vendor-order-requests.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const SRC = fs.readFileSync(FILE, 'utf8');
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const REQ = () => ({ id: 'R1', reqNo: 'REQ-1', status: 'pending', vendorCode: 'V1', vendorName: 'Bhavya', orderType: 'cut', requestedBy: 'sales@x', lines: [{ sku: 'S1', qty: 10, kind: 'cut' }], log: [] });

/** One PC (screen): its own copy of the request list, one shared database. */
function pc(db, who, on, n) {
  const ctx = {
    console, JSON, Object, String, Math, Date, Array, Promise, nf: x => String(x), $: () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null }), document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    spIsVendor: () => false, ME: { email: who, admin: true }, prOn: () => false, vrqCanApprove: () => true, VRQ_NO_APPROVE: 'no', lineHoldOn: () => !!on,
    ptDebounce: f => f, setTimeout: () => 0, VRQ: { rows: [Object.assign({ _key: 'R1' }, REQ())] }, VO: { rows: [], map: null }, SOX: { rows: [] }, ensureVo: async () => {}, renderVrq: () => {},
    voAllVendors: () => [{ code: 'V1', name: 'Bhavya', desc: 'Bhavya', email: '' }], voLines: r => r.lines || [], voIsPrinting: () => false, voValidateCut: () => [], voCapMsg: String,
    voKind: l => l.kind, voServiceOf: () => 'printing', voNewOrderNo: () => 'PO-' + who, voTodayDMY: () => '26/11/2026', voStampOrders: ls => ls, flowOwnedIn: () => [], flowOwnsMsg: String, voName: String,
    ptGet: async () => [], ptGetFresh: async p => clone(db[p]),
    ptPut: async (p, v) => { await Promise.resolve(); db[p] = clone(v); },
    ptCas: async (p, expect, next) => { await Promise.resolve(); if (JSON.stringify(db[p] == null ? null : db[p]) !== JSON.stringify(expect == null ? null : expect)) return 'changed'; db[p] = clone(next); return ''; },
  };
  ctx.flowClaim = async (p, v) => ((await ctx.ptCas(p, null, v)) ? 'taken' : '');
  ctx.vrqOf = id => ctx.VRQ.rows.find(r => r.id === id);
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n;this.__t = { vrqApprove, vrqReject, vrqWithdraw };', ctx);
  /* the file declares VRQ / VO / SOX itself: this screen's own copy is put into them after loading */
  ctx.__rows = [Object.assign({ _key: 'R1' }, REQ())];
  vm.runInContext('VRQ.rows = __rows; VO.rows = []; SOX.rows = []; renderVrq = function () {};', ctx);
  return ctx.__t;
}
const fresh = () => ({ 'pt_vendorOrderReqs/R1': REQ() });
const ORD = 'pt_vendorOrders/V1/vpo_R1', RQ = 'pt_vendorOrderReqs/R1';

(async () => {
  { const db = fresh(), A = pc(db, 'a@x', false), B = pc(db, 'b@x', false);
    const [ra, rb] = await Promise.all([A.vrqApprove('R1'), B.vrqApprove('R1')]);
    ok('switch off: as before — both approve, the second printer order replaces the first (this is what the switch stops)', ra === '' && rb === '' && !!db[ORD]); }

  { const db = fresh(), A = pc(db, 'a@x', true), B = pc(db, 'b@x', true);
    const [ra, rb] = await Promise.all([A.vrqApprove('R1'), B.vrqApprove('R1')]);
    const won = [ra, rb].filter(x => x === '').length, lost = [ra, rb].filter(x => /approved and sent by somebody else/.test(x)).length;
    ok('two approvers at once: one sends, the other is told it was already sent', won === 1 && lost === 1, JSON.stringify([ra, rb]));
    ok('…one printer order stands, under the winner\'s number — never replaced', !!db[ORD] && /^PO-[ab]@x$/.test(db[ORD].orderNo) && db[RQ].status === 'approved' && db[RQ].vendorOrderNo === db[ORD].orderNo, JSON.stringify(db[ORD] && db[ORD].orderNo)); }

  { const db = fresh(), A = pc(db, 'a@x', true), B = pc(db, 'b@x', true);
    await A.vrqApprove('R1');
    const m = await B.vrqReject('R1', 'too much');
    ok('rejected on a screen that still shows it waiting, after another approved it: refused, the approval stands', /was approved by somebody else/.test(m) && db[RQ].status === 'approved', m); }

  { const db = fresh(), A = pc(db, 'a@x', true), B = pc(db, 'b@x', true);
    const m1 = await A.vrqReject('R1', 'wrong vendor'), m2 = await B.vrqApprove('R1');
    ok('rejected first: the late approver is told, and NO printer order reaches the vendor', m1 === '' && /rejected by somebody else/.test(m2) && db[RQ].status === 'rejected' && !db[ORD], m2 + ' ' + JSON.stringify(db[ORD]));
    ok('…and a withdraw after a reject is refused too', /rejected by somebody else/.test(await B.vrqWithdraw('R1')) && db[RQ].status === 'rejected'); }

  { const db = fresh(), A = pc(db, 'a@x', true);
    const m = await A.vrqApprove('R1');
    ok('alone, with the switch on: approves normally', m === '' && db[RQ].status === 'approved' && db[ORD].orderNo === 'PO-a@x'); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
