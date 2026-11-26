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
  lift('reports/last-week.js', ['repRecvParts', 'repRecvDated']),
  'const VP_RECV_CNT = new WeakMap();', lift('vendors/portal/vendor-portal.js', ['vpRecvKey', 'vpRecvCnt'])].join('\n');

function load(o) {
  o = o || {};
  const ctx = {
    obUC, flowKey, flowR2, esc: s => String(s == null ? '' : s), console, Date, Math, Set, Map, setTimeout: () => 0,
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }, $: () => null, ME: { admin: true, tabs: [] },
    ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0, ptNum: v => +v || 0,
    FLOW: { ppc: {}, res: {}, ch: o.ch || {} }, FLOW_ROUTES: [], flowRouteOf: () => 'inhouse', FLOW_RUF: '~ruffle',
    PTG: { ob: [] }, PT: { cut: o.cut || [], base: o.base || [] }, flowRows: () => (o.onList || []).map(s => ({ s, r: { orderNo: (s.key || 'x__x').split('__')[0], sku: (s.key || 'x__x').split('__')[1], qty: s.qty } })), flowQcWaiting: () => 0, flowQcLine: () => ({ altOpen: 0, deptOpen: 0 }), ordLines: () => o.lines || [],
    flowState: r => { if (o.stateFails) throw new Error('no registers'); return (o.states || {})[flowKey(r.orderNo, r.sku)]; },
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
  vm.runInContext(HELPERS + '\n' + fs.readFileSync(FILE, 'utf8') + '\n;this.__t = { P1, p1PrinterWork, p1Report, p1Events, p1OutList, repRecvParts, p1Wip, p1HoldDays, p1StageCell };', ctx);
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
/* pieces on the challan, metres on the vendor order: 325 pieces on 100 m of cloth */
const KB2 = flowKey('SHP-1', 'RPC-B');
const pcsLine = (key, pcs, metres) => ({ key, sku: key.split('__')[1], print: { kind: 'sku' }, pcs, metres });
const byPcs = (voRows, x) => {
  x = x || {};
  const challan = (no, lines, more) => Object.assign({ no, date: '2026-10-22', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines }, more);
  const ch3 = { P: challan('P', x.lines || [pcsLine(KA, 325, 100)]) };
  if (x.metreChallan) ch3.M = challan('M', [{ key: KA, sku: 'RPC-A', metres: 100 }]);
  if (x.metreFirst) ch3.G = challan('G', [{ key: KA, sku: 'RPC-A', metres: 6 }], { closed: { at: 'x' }, receipts: { r: { date: '2026-10-24', items: { [KA]: 6 } } } });
  if (x.first) ch3.F = challan('F', [pcsLine(KA, 325, 100)], { closed: { at: 'x' }, receipts: { r: { date: '2026-10-25', items: { [KA]: 325 } } } });
  const w = load({ ch: ch3, vo: voRows }).p1PrinterWork('', ''), p = w.parties[0];
  return { got: [w.holds.filter(h => h.unit === 'pcs').reduce((a, h) => a + h.pcs, 0), p.transit, p.unbooked], m: [w.holds.filter(h => h.unit === 'm').reduce((a, h) => a + h.pcs, 0), p.tm] };
};
const cloth = (line, head) => order(Object.assign({ meters: 100 }, line), head);
is('pieces challan, metre order, all 100 m entered: all 325 pieces sent not received', byPcs([cloth({ sent: 100 })]), [0, 325, 0]);
is('…half the metres entered: half the pieces, whole ones only (162 of 325)', byPcs([cloth({ sent: 50 })]), [163, 162, 0]);
is('…nothing entered: all still out', byPcs([cloth({})]), [325, 0, 0]);
is('…more entered than the challan carries: no more than its pieces', byPcs([cloth({ sent: 140 })]), [0, 325, 0]);
is('…all delivered on the vendor order: finished, not booked', byPcs([cloth({ deliveries: [{ qty: 100 }] })]), [0, 0, 325]);
is('…half delivered: half not booked, half out', byPcs([cloth({ meters: 200, deliveries: [{ qty: 50 }] })]), [163, 0, 162]);
is('…an order marked Received: nothing out', byPcs([cloth({}, { status: 'Received' })]), [0, 0, 325]);
is('a vendor line in pieces for it is the one that counts', byPcs([cloth({ sent: 100 }), order({ qty: 325, sent: 25 }, { orderType: 'cut' })]), [300, 25, 0]);
is('a first lot received on a closed piece challan comes off what was entered', byPcs([cloth({ meters: 200, sent: 100 })], { first: true }), [325, 0, 0]);
const both = byPcs([cloth({ sent: 100 })], { metreChallan: true });
ok('with a metre challan for the same line too, the metres go to it first: nothing left for the pieces', String(both.got) === '325,0,0' && String(both.m) === '0,100', JSON.stringify(both));
/* a 6 m metre challan received and closed, then 1 piece on 2.65 m: one vendor line of 8.65 m for both */
const after = said => byPcs([cloth({ meters: 8.65, sent: said })], { lines: [pcsLine(KA, 1, 2.65)], metreFirst: true });
is('after a closed metre lot, all 8.65 m entered: the piece is sent not received', after(8.65), [0, 1, 0]);
is('…only the 6 m of that lot entered: the piece is still out', after(6), [1, 0, 0]);
is('a metre lot that came back in full fills the order: the pieces sent after it are still out', byPcs([cloth({ meters: 6 })], { lines: [pcsLine(KA, 1, 2.65)], metreFirst: true }), [1, 0, 0]);
is('…unless the order is marked Received', byPcs([cloth({ meters: 6 }, { status: 'Received' })], { lines: [pcsLine(KA, 1, 2.65)], metreFirst: true }), [0, 0, 1]);
const mixed = byPcs([cloth({ meters: 11, sent: 11 })], { lines: [{ key: KA, sku: 'RPC-A', metres: 6 }, pcsLine(KA, 2, 5)] });
ok('metres and pieces on one challan, all 11 m entered: 6 m and 2 pieces sent not received', String(mixed.got) === '0,2,0' && String(mixed.m) === '0,6', JSON.stringify(mixed));
/* one vendor line for a size sent as metres and pieces (6 + 5 m) and another sent as 11 m: half entered is half of each size */
const weighed = byPcs([cloth({ parts: [KA, KB2], meters: 22, sent: 11 })], { lines: [{ key: KA, sku: 'RPC-A', metres: 6 }, pcsLine(KA, 10, 5), { key: KB2, sku: 'RPC-B', metres: 11 }] });
ok('a shared line weighs a size by all its cloth, metres and pieces together (11 m each, 5.5 m entered to each)', String(weighed.got) === '10,0,0' && String(weighed.m) === '6,11', JSON.stringify(weighed));
is('one cloth line for two sizes, all of it entered: both sizes\' pieces sent not received', byPcs([cloth({ parts: [KA, KB2], meters: 90, sent: 90 })], { lines: [pcsLine(KA, 100, 30), pcsLine(KB2, 100, 60)] }), [0, 200, 0]);
is('…two thirds entered: two thirds of each size', byPcs([cloth({ parts: [KA, KB2], meters: 90, sent: 60 })], { lines: [pcsLine(KA, 90, 30), pcsLine(KB2, 90, 60)] }), [60, 120, 0]);
is('the other way round is left alone: a metre challan is not cleared by an order in pieces', one([order({ qty: 1, sent: 1 }, { orderType: 'cut' })]), [6, 0, 0]);
/* ---- the order line has moved on (Ravi, 26 Nov) ---- 10 m sent, 4 m received, 25 pieces ordered */
const moved = (state, x) => {
  x = x || {};
  const challan = { no: 'RFD-1', date: '2026-10-22', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [Object.assign({ key: KA, sku: 'RPC-A', metres: 10 }, x.line)], receipts: { r: { date: '2026-10-30', items: { [KA]: 4 } } } };
  const t = load(Object.assign({ ch: { 'RFD-1': challan }, vo: x.vo || [order({})], lines: [{ orderNo: 'SHP-1', sku: 'RPC-A', qty: 25 }], states: { [KA]: state }, standing: x.standing }, x.more));
  const w = t.p1PrinterWork('', ''), p = w.parties[0] || {};
  return { got: [w.holds.reduce((a, h) => a + h.pcs, 0), p.tm, p.um] };
};
const st0 = o => Object.assign({ key: KA, bucket: 'fabric', cut: 0, issuedNet: 0, made: 0 }, o);
is('nothing cut or made: the 6 m with no receipt is still out', moved(st0({})), [6, 0, 0]);
is('the whole line cut (25 of 25): nothing out, the 6 m not booked', moved(st0({ cut: 25 })), [0, 0, 6]);
is('…the whole line given to karigars (a line with no cutting)', moved(st0({ issuedNet: 25 })), [0, 0, 6]);
is('…the whole line made', moved(st0({ made: 25 })), [0, 0, 6]);
['fgin', 'ship', 'done'].forEach(bucket => is('…the line at "' + bucket + '": moved on', moved(st0({ bucket })), [0, 0, 6]));
is('part of the line moved on (24 of 25): left as it is', moved(st0({ cut: 24, issuedNet: 20, made: 10 })), [6, 0, 0]);
is('moved on, and the printer entered it as sent: not booked, no longer on the way', moved(st0({ cut: 25 }), { vo: [order({ sent: 10 })] }), [0, 0, 6]);
is('moved on while the vendor orders are not read yet: still not booked', moved(st0({ cut: 25 }), { more: { vo: null } }), [0, 0, 6]);
is('a line still on the PPC list is read from the list', moved(undefined, { more: { onList: [st0({ made: 25 })], stateFails: true } }), [0, 0, 6]);
is('a line whose state cannot be read keeps its cloth out', moved(st0({ cut: 25 }), { more: { stateFails: true } }), [6, 0, 0]);
is('a line not in the order book keeps its cloth out', moved(st0({ cut: 25 }), { more: { lines: [] } }), [6, 0, 0]);
const ruffle = { line: { ruffleOnly: true } };
is('ruffle cloth stays out though the whole line is cut and given to karigars', moved(st0({ cut: 25, issuedNet: 25 }), ruffle), [6, 0, 0]);
is('…not booked once the whole line is made', moved(st0({ made: 25 }), ruffle), [0, 0, 6]);
is('…or waiting for Finished Goods', moved(st0({ bucket: 'fgin' }), ruffle), [0, 0, 6]);
is('standing cloth stays out though its line has moved on', moved(st0({ bucket: 'done' }), { standing: [{ code: 'RBP', printer: 'RBP-Bagru', qty: 70, unit: 'm', no: 'RFD-0', orderNo: 'SHP-1', sku: 'RPC-A', at: '2026-10-05' }] }), [70, 0, 6]);
is('standing cloth stays out though the vendor order is Received', st1, [70, 0, 6]);
const done = one([order({}, { status: 'Received' })]), L = done.list[0] || {};
ok('the not-booked line names the SKU, order and challan to receive it on', L.sku === 'RPC-A' && L.orderNo === 'SHP-1' && L.ref === 'Challan RFD-1' && L.pcs === 6, JSON.stringify(L));
const rep = done.t.p1Report(), row = rep.rows.find(p => p.name === 'RBP-Bagru') || { out: {} };
ok('a printer with only not-booked cloth keeps its row and list, with nothing still out', row.um === 6 && row.out.m === 0 && (row.unbookedItems || []).length === 1, JSON.stringify(row));
const html = done.t.p1OutList('Not booked on the challan', row.unbookedItems || []);
ok('its list shows the title, SKU, 6 m and the challan', ['Not booked on the challan', 'RPC-A', '6 m', 'Challan RFD-1'].every(w => html.includes(w)), html);

/* ---- karigars (Ravi, 26 Nov): Back is the register's Received; one karigar, one name ---- */
const job = (empName, issue, received, o) => Object.assign({ orderNo: 'AMZ-1', sku: 'X1', empName, issuePieces: issue, receivedPieces: received, rejectionPieces: 0, issueDate: '2026-10-01' }, o);
const rc = (day, qty) => ({ at: day, qty });
const karigarReport = (rows, from, to) => { const t = load({ base: rows }); t.P1.rr = from ? 'custom' : 'all'; t.P1.rf = from; t.P1.rt = to; return t.p1Report(); };
const backOf = (rows, from, to) => karigarReport(rows, from, to).rows.filter(p => p.kind === 'Karigar').reduce((a, p) => a + p.back, 0);
const twice = [job('Kajal', 125, 120, { receipts: [rc('2026-10-05', 2), rc('2026-10-12', 120)], receivingDate: '2026-10-12' })];
ok('a history holding more than was received counts the received figure (120, not 122)', backOf(twice) === 120, String(backOf(twice)));
ok('…dated as the Reports date it: 2 on 5 Oct, the other 118 on 12 Oct', backOf(twice, '2026-10-05', '2026-10-05') === 2 && backOf(twice, '2026-10-12', '2026-10-12') === 118);
const reportsSay = load({}).repRecvParts(twice[0]).filter(x => x.ms >= Date.parse('2026-10-12') && x.ms < Date.parse('2026-10-13')).reduce((a, x) => a + x.pcs, 0);
ok('…the same day, the same figure as the Reports', reportsSay === backOf(twice, '2026-10-12', '2026-10-12'), String(reportsSay));
ok('rejected pieces kept in the history do not come back (received 0)', backOf([job('Kajal', 29, 0, { rejectionPieces: 29, receipts: [rc('2026-10-16', 29)] })]) === 0);
const short = [job('Kajal', 214, 214, { receipts: [rc('2026-10-07', 100)], receivingDate: '2026-10-09' })];
ok('a history short of the received figure: the rest on the receiving date (214 in all, 114 on 9 Oct)', backOf(short) === 214 && backOf(short, '2026-10-09', '2026-10-09') === 114 && backOf(short, '2026-10-07', '2026-10-07') === 100);
const undated = [job('Kajal', 50, 50, { receipts: [rc('2026-10-07', 20)] })];
ok('…with no receiving date the rest has no date: 50 in all, only 20 on 7 Oct', backOf(undated) === 50 && backOf(undated, '2026-10-07', '2026-10-07') === 20 && backOf(undated, '2026-10-08', '2026-10-31') === 0);
ok('an undated part makes no row of its own in day by day', karigarReport(undated).days.every(d => d.day));
const split = [job('Kajal', 40, 40, { receipts: [rc('2026-10-05', 15), rc('2026-10-08', 25)] })];
ok('a history that agrees keeps each receipt on its own day', backOf(split, '2026-10-05', '2026-10-05') === 15 && backOf(split, '2026-10-08', '2026-10-08') === 25);
ok('a row from before receipts were kept: its received figure on its receiving date', backOf([job('Kajal', 10, 7, { receivingDate: '2026-10-03' })], '2026-10-03', '2026-10-03') === 7);
const names = [job('Ikram Khan', 100, 60, { receivingDate: '2026-10-02' }), job('Ikram  khan', 10, 10, { receivingDate: '2026-10-02' }), job('IKRAM KHAN', 5, 0), job('Roopsingh', 3, 0), job('Roop Singh', 30, 0), job('Ramesh Singh', 4, 0)];
const K = karigarReport(names).rows.filter(p => p.kind === 'Karigar'), ik = K.find(p => p.name === 'Ikram Khan') || { out: { items: [] } };
ok('one karigar, one row, under the spelling most was issued to', K.map(p => p.name).sort().join(',') === 'Ikram Khan,Ramesh Singh,Roop Singh', K.map(p => p.name).join(','));
ok('…with every spelling\'s given, back and still out together (115, 70, 45)', ik.given === 115 && ik.back === 70 && ik.out.pcs === 45 && ik.out.items.length === 2, JSON.stringify([ik.given, ik.back, ik.out.pcs]));
ok('the stored rows keep their own spelling', names[1].empName === 'Ikram  khan');
/* ---- the Production page still shows what is on the way (Ravi, 26 Nov) ---- 10 m sent, 4 m received, the printer says 8 sent */
const way = (voRows, line) => {
  const challan = { no: 'RFD-1', date: '2026-10-22', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [Object.assign({ key: KA, sku: 'RPC-A', metres: 10 }, line)], receipts: { r: { date: '2026-10-30', items: { [KA]: 4 } } } };
  const t = load({ ch: { 'RFD-1': challan }, vo: voRows });
  return { t, wip: t.p1Wip().filter(w => w.stage === 'Printer'), rep: t.p1Report().rows.find(p => p.name === 'RBP-Bagru') || { out: { m: 0 } } };
};
const W1 = way([order({ sent: 8 })]);
ok('Production: all 6 m not received stays at the printer, 2 m with them and 4 m on the way', W1.wip.map(w => w.pcs + (w.onWay ? ' on the way' : ' with')).sort().join(', ') === '2 with, 4 on the way', JSON.stringify(W1.wip.map(w => [w.pcs, !!w.onWay])));
ok('…the report counts it as before: 2 m still out, 4 m sent not received', W1.rep.out.m === 2 && W1.rep.tm === 4, JSON.stringify([W1.rep.out.m, W1.rep.tm]));
const allSent = way([order({ sent: 10 })]);
ok('everything entered as sent: the line still shows 6 m at the printer, nothing still out in the report', allSent.wip.length === 1 && allSent.wip[0].pcs === 6 && allSent.wip[0].onWay === true && allSent.rep.out.m === 0);
const D1 = allSent.t.p1HoldDays(allSent.wip), cell = allSent.t.p1StageCell({ w: 0, m: 6 }, D1.prn, 'prn');
ok('…its cell reads 6 m, "6 m sent, to receive"', />6 m<\/b>/.test(cell) && /<span class="for">6 m sent, to receive<\/span>/.test(cell), cell);
ok('cloth only with the printer carries no mark', !/to receive/.test(way([order({})]).t.p1StageCell({ w: 0, m: 6 }, way([order({})]).t.p1HoldDays(way([order({})]).wip).prn, 'prn')));
ok('cloth finished on the vendor order (not booked) is not on the way', way([order({}, { status: 'Received' })]).wip.length === 0);
ok('ruffle cloth on the way is left off the Production page, as ruffle cloth is', way([order({ parts: [KA + '|ruffle'], deliveries: [] , sent: 8 })], { ruffleOnly: true }).wip.length === 0);

/* ---- Production: moved-on pieces are not counted at the printer too; cut pieces show though the cloth is not booked (Ravi, 26 Nov) ---- */
const lineAt = o => Object.assign({ key: KA, qty: 16, bucket: 'fabric', cut: 0, issuedNet: 0, made: 0, india: 0, canCut: 0, canIssue: 0, cutReq: true }, o);
const page = (state, x) => {
  x = x || {};
  const challan = { no: 'RFD-1', date: '2026-10-22', vendor: { code: 'RBP', name: 'RBP-Bagru' }, lines: [Object.assign({ key: KA, sku: 'RPC-A' }, x.line || { print: { kind: 'sku' }, pcs: 16, metres: 8 })] };
  const t = load({ ch: { 'RFD-1': challan }, vo: x.vo || [], onList: [state], standing: x.standing });
  const wip = t.p1Wip(), sumOf = f => wip.filter(f).reduce((a, w) => a + w.pcs, 0);
  return { t, prn: sumOf(w => w.stage === 'Printer'), onWay: sumOf(w => w.stage === 'Printer' && w.onWay), iss: sumOf(w => w.stage === 'Raw cutting in store') };
};
ok('nothing moved on: all 16 pieces at the printer', page(lineAt({})).prn === 16);
ok('3 given to karigars: 13 at the printer, not 16', page(lineAt({ issuedNet: 3 })).prn === 13);
ok('…cut, made and stock count the same way (the furthest of them)', page(lineAt({ cut: 5 })).prn === 11 && page(lineAt({ made: 6, cut: 5 })).prn === 10 && page(lineAt({ india: 7, made: 6 })).prn === 9);
ok('all moved on: none at the printer', page(lineAt({ issuedNet: 16 })).prn === 0);
const extra = { line: { print: { kind: 'sku' }, pcs: 18, metres: 9 } };
ok('18 sent for 16 ordered, nothing moved on: all 18 at the printer', page(lineAt({}), extra).prn === 18);
ok('…once 3 have moved on, no more than the 13 left of the order', page(lineAt({ issuedNet: 3 }), extra).prn === 13);
/* 10 ordered, 5 cut before PPC planned it, no print order given yet */
const notGiven = page(lineAt({ bucket: 'vendor', qty: 10, cut: 5, canIssue: 5 }), { line: { ruffleOnly: true, metres: 1 } });
ok('print order not given, 5 of 10 already cut: 5 waiting for the print order and 5 to issue, not 15', notGiven.prn === 5 && notGiven.iss === 5, JSON.stringify([notGiven.prn, notGiven.iss]));
const part = page(lineAt({ issuedNet: 10 }), { vo: [order({ qty: 16, sent: 12 }, { orderType: 'cut' })] });
ok('what is on the way goes first: 4 with the printer, 12 on the way, 10 moved on leaves 4 with them and 2 on the way', part.prn === 6 && part.onWay === 2, JSON.stringify([part.prn, part.onWay]));
ok('cloth in metres stays (it does not say how many pieces)', page(lineAt({ issuedNet: 3 }), { line: { metres: 80 } }).prn === 80);
ok('the report still counts all 16 pieces of challan cloth', page(lineAt({ issuedNet: 3 })).t.p1Report().rows.find(p => p.name === 'RBP-Bagru').out.pcs === 16);
const st2 = page(lineAt({ issuedNet: 16 }), { standing: [{ code: 'RBP', printer: 'RBP-Bagru', qty: 7, unit: 'pcs', key: KA, no: 'RFD-0', orderNo: 'SHP-1', sku: 'RPC-A', at: '2026-10-05' }] });
ok('standing cloth stays with the printer', st2.prn === 7, String(st2.prn));
const cutLine = o => lineAt(Object.assign({ qty: 10, cut: 10, canIssue: 10 }, o));
['fabric', 'demand', 'vendor'].forEach(bucket => ok('10 cut, cloth not booked (line at "' + bucket + '"): 10 to issue', page(cutLine({ bucket })).iss === 10, String(page(cutLine({ bucket })).iss)));
ok('…never more than are still to make (8 of 10 made: 2)', page(cutLine({ made: 8 })).iss === 2);
ok('…all made: nothing to issue', page(cutLine({ made: 10 })).iss === 0);
ok('a line that needs no cutting is left as it was while its cloth is awaited', page(cutLine({ cutReq: false })).iss === 0);
ok('a line not planned yet shows nothing to issue', page(cutLine({ bucket: 'ppc' })).iss === 0);
ok('a line already in the store shows its figure as before', page(cutLine({ bucket: 'raw', canIssue: 4, made: 9 })).iss === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
