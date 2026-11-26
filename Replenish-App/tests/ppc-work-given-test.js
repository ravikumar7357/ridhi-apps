/* PPC → Report · Work given out, and the fabric with the printers (src/app/core/ppc-one.js — p1PrinterWork, p1Report, p1Events).
 * Ravi, 25 Nov: "in ppc page the report column is showing wrong data especially for the data of the fabric with work given"; of what is
 * still out: "it should only show that data that the printer has not sent … the printer has sent but not recived by us is not counted
 * in that data also the orders that are against that data are to be accurate"; the Cutting row: "Remove Cutting row".
 * Checked on the test ERP first: challan RFD-202610-091 (two orders, one order-number text) sent 3,174 m for RPC72-2020 and the line's
 * history said "Cloth sent: none yet". These cases are made up in that shape.
 * Ravi, 26 Nov: cloth whose vendor order is finished is not with the printer — what the challan has no receipt for is said apart as
 * "not booked on the challan"; what the printer entered as sent (challan RFD-202610-051, 0.96 m lines) is "sent, not received".
 * The vendor-order and portal helpers are the page's own, lifted from their source files.
 *   node tests/ppc-work-given-test.js      (PPC_ONE=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.PPC_ONE || path.join(__dirname, '..', 'src', 'app', 'core', 'ppc-one.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
const flowKey = (o, s) => (obUC(o) + '__' + obUC(s)).replace(/[.#$\[\]\/]/g, '_');
const flowR2 = n => Math.round((+n || 0) * 100) / 100;

/* the page's own helpers, by name: a "function x(…) {" block, or a const with its indented continuation lines */
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', f), 'utf8').replace(/\r\n/g, '\n');
const lift = (file, names) => { const text = SRC(file); return names.map(n => {
  const m = text.match(new RegExp('^(?:function|const) ' + n + '\\b.*\\{\\n[\\s\\S]*?^\\};?', 'm')) || text.match(new RegExp('^(?:const|function) ' + n + '\\b.*(?:\\n  .*)*', 'm'));
  if (!m) throw new Error(n + ' not found in ' + file); return m[0]; }).join('\n'); };
const HELPERS = [lift('vendors/orders/vendor-orders.js', ['voLines', 'voRunning', 'voUnit', 'voQty', 'voDels', 'voDone', 'voParts']),
  lift('vendors/orders/accept-delivery.js', ['vlOk', 'vlNo', 'vlQtyOf']), lift('vendors/portal/printer-receive.js', ['vprKeys']),
  'const VP_RECV_CNT = new WeakMap();', lift('vendors/portal/vendor-portal.js', ['vpRecvKey', 'vpRecvCnt'])].join('\n');

function load(o) {
  o = o || {};
  const ctx = {
    obUC, flowKey, flowR2, esc: s => String(s == null ? '' : s), console, Date, Math, Set, Map, setTimeout: () => 0,
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }, $: () => null, ME: { admin: true, tabs: [] },
    ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0, ptNum: v => +v || 0,
    FLOW: { ppc: {}, res: {}, ch: o.ch || {} }, FLOW_ROUTES: [], flowRouteOf: () => 'inhouse', FLOW_RUF: '~ruffle',
    PTG: { ob: [] }, PT: { cut: o.cut || [], base: o.base || [] }, flowRows: () => [], ordLines: () => o.lines || [],
    /* the challan helpers, as flow-receive.js has them */
    flowChUnit: l => (l && l.print && l.print.kind === 'sku' ? 'pcs' : 'm'),
    flowChSent: l => (l && l.print && l.print.kind === 'sku' ? (+l.pcs || 0) : (+l.metres || 0)),
    flowChRecv: c => { const out = {}; Object.values(c.receipts || {}).forEach(rc => Object.entries(rc.items || {}).forEach(([k, m]) => { out[k] = flowR2((out[k] || 0) + (+m || 0)); })); return out; },
    flowChMoved: (c, l) => !!(c && l && !l.ruffleOnly && c.moved && c.moved[l.key]),
    flowStanding: () => o.standing || [],
    /* the vendor orders, and the printer's own "sent" (what it entered, as one figure per line) */
    VO: { rows: o.vo === undefined ? [] : o.vo, err: o.voErr || '' }, vpSentKept: (v, l) => +l.sent || 0,
  };
  vm.createContext(ctx);
  vm.runInContext(HELPERS + '\n' + fs.readFileSync(FILE, 'utf8') + '\n;this.__t = { P1, p1PrinterWork, p1Report, p1Events, p1OutList };', ctx);
  return ctx.__t;
}
const lines = [{ orderNo: 'AMZ-1-SEA', sku: 'RPC72-2020', qty: 2760 }, { orderNo: 'AMZ-6-AIR', sku: 'RPC72-1818', qty: 900 }, { orderNo: 'SHP-9', sku: 'RTC-R1', qty: 20 }];
const K1 = flowKey('AMZ-1-SEA', 'RPC72-2020'), K2 = flowKey('AMZ-6-AIR', 'RPC72-1818'), K3 = flowKey('SHP-9', 'RTC-R1');
const ch = {
  /* one challan for two orders: its order is the text of both; the lines carry their keys only */
  'RFD-091': { no: 'RFD-091', date: '2026-11-20', at: '2026-11-27T05:00:00Z', orderNo: 'AMZ-1-SEA, AMZ-6-AIR', vendor: { code: 'RBP', name: 'RBP-Bagru' },
    lines: [{ key: K1, sku: 'RPC72-2020', fabric: 'Canvas', metres: 3174 }, { key: K2, sku: 'RPC72-1818', fabric: 'Canvas', metres: 1638 }],
    receipts: { r1: { date: '2026-11-22', items: { [K2]: 1638 } } } },
  /* a challan made from cloth already standing with the printer: it gave nothing new */
  'RFD-200': { no: 'RFD-200', date: '2026-11-21', standing: true, orderNo: 'SHP-9', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: K3, sku: 'RTC-R1', fabric: 'Canvas', metres: 40 }] },
  /* a ruffle line goes to the printer too */
  'RFD-201': { no: 'RFD-201', date: '2026-11-21', orderNo: 'SHP-9', vendor: { code: 'BH', name: 'Bhavya Ethinic' }, lines: [{ key: K3, sku: 'RTC-R1', fabric: 'Cambric', metres: 12, ruffleOnly: true },
    { key: K3 + 'P', sku: 'RTC-R1', print: { kind: 'sku' }, pcs: 246 }], receipts: { r1: { date: '2026-11-23', items: { [K3 + 'P']: 246 } } } },
  /* closed short: the rest is not waited for */
  'RFD-050': { no: 'RFD-050', date: '2026-10-01', closed: { at: 'x' }, orderNo: 'AMZ-6-AIR', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: K2, sku: 'RPC72-1818', metres: 300 }] },
  /* moved off its line: standing with the printer; part of it came back to the store unprinted on 22 Nov */
  'RFD-060': { no: 'RFD-060', date: '2026-10-05', orderNo: 'AMZ-6-AIR', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: K2, sku: 'RPC72-1818', metres: 100 }],
    moved: { [K2]: { metres: 100, settles: { s1: { how: 'store', as: 'rfd', qty: 30, metres: 30, at: '2026-11-22T06:00:00Z' } } } } },
  'RFD-X': { no: 'RFD-X', date: '2026-11-21', cancelled: { at: 'x' }, vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: K1, sku: 'RPC72-2020', metres: 999 }] } };
const standing = [{ printer: 'RBP-Bagru', code: 'RBP', qty: 70, unit: 'm', key: K2, no: 'RFD-060', orderNo: 'AMZ-6-AIR', sku: 'RPC72-1818', at: '2026-10-05' }];
/* RBP-Bagru entered 1,000 m sent for RPC72-2020 on its portal; nothing of it received yet */
const vo = [{ vendorCode: 'RBP', orderType: 'running', lines: [{ parts: [K1], meters: 3174, sent: 1000 }] }];
const A = load({ ch, lines, standing, vo });
const W = A.p1PrinterWork('2026-11-19', '2026-11-25'), rbp = W.parties.find(p => p.name === 'RBP-Bagru') || {}, bh = W.parties.find(p => p.name === 'Bhavya Ethinic') || {};
const holdOf = (who, sku, ref) => W.holds.filter(h => h.who === who && h.sku === sku && (!ref || ref.test(h.ref)));
ok('given in the days: the two orders\' cloth (3,174 + 1,638 m), by the challan\'s own date (saved 27 Nov, dated 20 Nov)', rbp.gm === 4812, JSON.stringify(rbp));
ok('…a challan made from standing cloth gave nothing new; a cancelled one nothing at all', rbp.gm === 4812 && !W.parties.some(p => p.gm === 4852));
ok('back in the days: printed back on the challan (1,638 m) and standing cloth returned to the store unprinted (30 m)', rbp.bm === 1668, JSON.stringify(rbp.bm));
ok('ruffle cloth counts as given (12 m), beside the 246 pcs printed on the SKU', bh.gm === 12 && bh.given === 246 && bh.back === 246, JSON.stringify(bh));
const h1 = holdOf('RBP-Bagru', 'RPC72-2020')[0] || {};
ok('still with RBP-Bagru for RPC72-2020: 3,174 m sent, 1,000 m the printer has sent → 2,174 m, on order AMZ-1-SEA (not "AMZ-1-SEA, AMZ-6-AIR")', h1.pcs === 2174 && h1.orderNo === 'AMZ-1-SEA' && h1.unit === 'm', JSON.stringify(h1));
ok('…the 1,000 m the printer sent and we have not received: said apart (not counted as with them)', rbp.tm === 1000, JSON.stringify(rbp.tm));
ok('received in full (RPC72-1818 on RFD-091), closed short (RFD-050): nothing still out from them', !holdOf('RBP-Bagru', 'RPC72-1818', /RFD-091|RFD-050/).length, JSON.stringify(holdOf('RBP-Bagru', 'RPC72-1818')));
const st = holdOf('RBP-Bagru', 'RPC72-1818', /standing/)[0] || {};
ok('standing cloth (moved off its line, 70 m not settled) is still with the printer, against the order it was given for', st.pcs === 70 && st.orderNo === 'AMZ-6-AIR', JSON.stringify(st));
ok('the standing challan\'s 40 m is with the printer for its own order line (SHP-9)', (holdOf('RBP-Bagru', 'RTC-R1')[0] || {}).pcs === 40 && (holdOf('RBP-Bagru', 'RTC-R1')[0] || {}).orderNo === 'SHP-9');
ok('ruffle cloth not back is with the printer too, marked ruffle', (holdOf('Bhavya Ethinic', 'RTC-R1', /^ruffle/)[0] || {}).pcs === 12);
const N = load({ ch, lines, standing, vo: null }).p1PrinterWork('', ''), n1 = N.holds.find(h => h.sku === 'RPC72-2020') || {};
ok('vendor orders not read yet: still out counts only what we received (3,174 m), and says so', n1.pcs === 3174 && N.vendorRead === false);
/* the line's own history: the challan's cloth is on RPC72-2020's line */
const ev = A.p1Events().filter(e => e.k === 'RFD');
ok('history: "Cloth sent to printer" lands on the order line the challan line names (AMZ-1-SEA · RPC72-2020, 3,174 m)', ev.some(e => e.orderNo === 'AMZ-1-SEA' && e.sku === 'RPC72-2020' && e.pcs === 3174 && e.day === '2026-11-20'), JSON.stringify(ev.map(e => [e.orderNo, e.sku, e.pcs, e.day])));
/* the Report: no Cutting row; a karigar's pieces count while with him, whatever his line */
const base = [{ orderNo: 'AMZ-OLD', sku: 'X1', issuePieces: 10, receivedPieces: 4, rejectionPieces: 1, empName: 'Kajal', issueDate: '2026-09-30' },
  { orderNo: 'AMZ-1-SEA', sku: 'RPC72-2020', issuePieces: 5, receivedPieces: 5, empName: 'Kajal', issueDate: '2026-11-20' }];
const B = load({ ch, lines, standing, vo, base, cut: [{ orderNo: 'AMZ-1-SEA', sku: 'RPC72-2020', pieces: 98, cutDate: '2026-11-21', addedBy: 'cutter' }] }); B.P1.rr = 'custom'; B.P1.rf = '2026-11-19'; B.P1.rt = '2026-11-25';
const R = B.p1Report(), kajal = R.rows.find(p => p.name === 'Kajal') || { out: {} };
ok('no Cutting row (Ravi, 25 Nov)', !R.rows.some(p => p.kind === 'Cutting'), JSON.stringify(R.rows.map(p => p.kind)));
ok('a karigar\'s 5 pieces still with him count, though their order line is not in production any more', kajal.out.pcs === 5 && kajal.out.items[0].orderNo === 'AMZ-OLD', JSON.stringify(kajal.out));
ok('the Fabric tiles add up the same figures as the printer rows', (R.tiles.find(t => t[0] === 'RFD') || [])[3] === 4824 && (R.tiles.find(t => t[0] === 'PRN') || [])[3] === 1668, JSON.stringify(R.tiles.slice(2, 4)));

/* ---- finished on the vendor order (Ravi, 26 Nov) ---- one challan line: 10 m sent and 4 m received, unless said */
const KA = flowKey('SHP-1', 'RPC-A');
const one = (voRows, x) => {
  x = x || {};
  const challan = { no: 'RFD-1', date: '2026-10-22', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [Object.assign({ key: KA, sku: 'RPC-A', metres: x.sent || 10 }, x.line)],
    receipts: x.recv === 0 ? {} : { r: { date: '2026-10-30', items: { [KA]: 4 } } } };
  const t = load({ ch: { 'RFD-1': challan }, vo: voRows, standing: x.standing }), w = t.p1PrinterWork('', ''), p = w.parties[0] || {};
  return { t, list: w.unbooked, got: [w.holds.reduce((a, h) => a + h.pcs, 0), p.tm, p.um] };
};
const order = (line, head) => Object.assign({ vendorCode: 'RBP', orderType: 'running', status: 'Placed', lines: [Object.assign({ parts: [KA], meters: 10 }, line)] }, head);
/* expected: [still out, sent by the printer and not received, not booked on the challan] */
const is = (name, r, want) => ok(name, String(r.got) === String(want), JSON.stringify(r.got));
is('order open, nothing delivered or entered: the 6 m not received is still out', one([order({})]), [6, 0, 0]);
is('order marked Received: nothing out; the 6 m with no receipt is not booked on the challan', one([order({}, { status: 'Received' })]), [0, 0, 6]);
is('line delivered in full on the vendor order: nothing out, 6 m not booked', one([order({ deliveries: [{ qty: 10 }] })]), [0, 0, 6]);
is('line received in full for what was ordered (4 m of 4), though the challan sent 10: the rest is not booked', one([order({ meters: 4 })]), [0, 0, 6]);
is('partly delivered (7 of 10 m, 4 of them on the challan): only 3 m out, 3 m not booked', one([order({ deliveries: [{ qty: 7 }] })]), [3, 0, 3]);
is('…a delivery we turned away does not count', one([order({ deliveries: [{ qty: 7, no: { reason: 'Print fault' } }] })]), [6, 0, 0]);
is('partly delivered 7, the printer says 9 sent: 1 m out, 2 m sent not received, 3 m not booked', one([order({ deliveries: [{ qty: 7 }], sent: 9 })]), [1, 2, 3]);
is('two lines for the order line, one still open: not finished, the cloth stays out', one([order({}, { status: 'Received' }), order({})]), [6, 0, 0]);
is('a cancelled order finishes nothing', one([order({}, { status: 'Cancelled' })]), [6, 0, 0]);
is('…even one with everything delivered on it', one([order({ deliveries: [{ qty: 10 }] }, { status: 'Cancelled' })]), [6, 0, 0]);
is('…and an open cancelled order does not keep a finished one open', one([order({}, { status: 'Received' }), order({}, { status: 'Cancelled' })]), [0, 0, 6]);
is('a cancelled line finishes nothing', one([order({ cancelled: true, deliveries: [{ qty: 10 }] })]), [6, 0, 0]);
is('another printer\'s finished order does not clear this printer\'s cloth', one([order({}, { status: 'Received', vendorCode: 'OTHER' })]), [6, 0, 0]);
is('a pieces order does not finish cloth in metres', one([order({ qty: 10 }, { status: 'Received', orderType: 'cut' })]), [6, 0, 0]);
is('ruffle cloth is finished by the vendor line for the ruffle part', one([order({ parts: [KA + '|ruffle'] }, { status: 'Received' })], { line: { ruffleOnly: true } }), [0, 0, 6]);
is('…and not by the main cloth\'s line', one([order({}, { status: 'Received' })], { line: { ruffleOnly: true } }), [6, 0, 0]);
is('RFD-202610-051: 0.96 m the printer entered as sent, no receipt: sent not received, not out, not "not booked"', one([order({ meters: 0.96, sent: 0.96 })], { sent: 0.96, recv: 0 }), [0, 0.96, 0]);
const st1 = one([order({}, { status: 'Received' })], { standing: [{ code: 'RBP', printer: 'RBP-Bagru', qty: 70, unit: 'm', no: 'RFD-0', orderNo: 'SHP-1', sku: 'RPC-A', at: '2026-10-05' }] });
/* the gated flow: ordered in two lots. The first challan is received in full and closed; the second is still with the printer */
const lots = (first, voRows) => {
  const ch2 = { A: Object.assign({ no: 'A', date: '2026-10-01', closed: { at: 'x' }, vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: KA, sku: 'RPC-A', metres: 100 }],
    receipts: { r: { date: '2026-10-05', items: { [KA]: 100 } } } }, first), B: { no: 'B', date: '2026-10-20', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: KA, sku: 'RPC-A', metres: 100 }] } };
  const w = load({ ch: ch2, vo: voRows }).p1PrinterWork('', ''), p = w.parties.find(x => x.code === 'RBP');
  return { got: [w.holds.reduce((a, h) => a + h.pcs, 0), p.tm, p.um] };
};
is('cloth the printer sent on the first lot (closed) is not counted again: the second lot is still out', lots({}, [order({ meters: 400, sent: 100 })]), [100, 0, 0]);
is('…the same for what was delivered on the vendor order', lots({}, [order({ meters: 400, deliveries: [{ qty: 100 }] })]), [100, 0, 0]);
is('…and what they send beyond the first lot counts against the second', lots({}, [order({ meters: 400, sent: 130 })]), [70, 30, 0]);
is('another printer\'s receipts for the line do not finish this printer\'s order', lots({ vendor: { code: 'OLD', name: 'Old Printer' } }, [order({ meters: 100 })]), [100, 0, 0]);
/* one fabric line for two sizes: 0.96 m and 1.92 m on one challan, all 2.88 m entered as sent */
const KB = flowKey('SHP-1', 'RPC-B');
const shared = line => { const w = load({ ch: { C: { no: 'C', date: '2026-10-22', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [{ key: KA, sku: 'RPC-A', metres: 0.96 }, { key: KB, sku: 'RPC-B', metres: 1.92 }] } },
  vo: [order(Object.assign({ parts: [KA, KB], meters: 4 }, line))] }).p1PrinterWork('', ''), p = w.parties[0];
  return { got: [w.holds.reduce((a, h) => a + h.pcs, 0), Math.round(p.tm * 100) / 100, Math.round(p.um * 100) / 100] }; };
is('a shared fabric line shares what was sent by each size\'s cloth: all 2.88 m sent not received, nothing out', shared({ sent: 2.88 }), [0, 2.88, 0]);
is('…and what was delivered the same way: all 2.88 m not booked', shared({ deliveries: [{ qty: 2.88 }] }), [0, 0, 2.88]);
ok('vendor orders read, none naming a line: read all the same', load({ ch: {}, vo: [] }).p1PrinterWork('', '').vendorRead === true);
ok('a failed read of the vendor orders is not "read"', load({ ch: {}, vo: [], voErr: 'offline' }).p1PrinterWork('', '').vendorRead === false);
is('standing cloth stays out though the vendor order is Received', st1, [70, 0, 6]);
const done = one([order({}, { status: 'Received' })]), L = done.list[0] || {};
ok('the not-booked line names the SKU, order and challan to receive it on', L.sku === 'RPC-A' && L.orderNo === 'SHP-1' && L.ref === 'Challan RFD-1' && L.pcs === 6, JSON.stringify(L));
const rep = done.t.p1Report(), row = rep.rows.find(p => p.name === 'RBP-Bagru') || { out: {} };
ok('a printer with only not-booked cloth keeps its row and list, with nothing still out', row.um === 6 && row.out.m === 0 && (row.unbookedItems || []).length === 1, JSON.stringify(row));
const html = done.t.p1OutList('Not booked on the challan', row.unbookedItems || []);
ok('its list shows the title, SKU, 6 m and the challan', ['Not booked on the challan', 'RPC-A', '6 m', 'Challan RFD-1'].every(w => html.includes(w)), html);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
