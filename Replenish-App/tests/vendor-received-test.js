/* RECEIVED ON THE PRINTER'S OWN SCREEN (Ravi, 12 Nov: VPO-261021-I24 — 1 pc received on its RFD challan; the office's printer's view
 * said 1, the printer's own sign-in said "—" and still offered the qty / Add box).
 *   node tests/vendor-received-test.js
 * The real functions are cut out of src/ and run against stubs: vendor-portal.js vpRecvOf / vpRecvAll / vpVsHtml, vendor-orders.js
 * voLines / voParts, flow-receive.js flowChIndex. What must hold: a printer's sign-in (no challans) reads the office's copy on its
 * order (flowProg.items); every SKU of a combined line counts; a quilt's Front and Back get half each; the ruffle cloth counts on its
 * own; the office (challans read) counts what is on the challans, a line moved to another printer left out; a line received in full
 * loses the box, a part-received one keeps it. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const VP = rd(path.join(APP, 'vendors/portal/vendor-portal.js')), VO = rd(path.join(APP, 'vendors/orders/vendor-orders.js')), FR = rd(path.join(APP, 'flow/flow-receive.js'));
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const PARTS = [line(VO, 'const voLines ='), line(VO, 'const voParts ='), line(VP, 'const vpQty ='), line(VP, 'const VP_RECV_CNT ='), line(VP, 'const vpRecvKey ='),
  cut(VP, 'vpRecvCnt'), cut(VP, 'vpRecvOf'), line(VP, 'const vpRecvAll ='), cut(VP, 'vpVsHtml'),
  line(FR, 'const flowChUnit ='), line(FR, 'const flowChSent ='), line(FR, 'let FLOW_CHX ='), line(FR, 'const flowChMoved ='), cut(FR, 'flowChIndex'), cut(FR, 'flowChRecv')].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function load(flowCh) {
  const ctx = {
    FLOW: { ch: flowCh }, FLOW_RUF: '~ruffle', flowR2: n => Math.round((+n || 0) * 100) / 100,
    voDone: l => +(l && l.dispatchedQty) || 0, esc: s => String(s == null ? '' : s), nf: n => String(n), ME: { email: 'p@x' },
    vpVsOf: () => [], vpVsSum: () => 0, vpVsCan: () => true, vpVsWhen: () => '',
  };
  const names = Object.keys(ctx);
  return new Function(...names, PARTS + '\nreturn { vpRecvOf, vpRecvAll, vpVsHtml };')(...names.map(k => ctx[k]));
}

/* ---- the printer's own sign-in: no challans, the office's copy on the order ---- */
const P = load(null);
const one = { orderType: 'cut', flowProg: { items: { 'SHP-1__T1': { given: 1, back: 1 } } }, lines: [{ flowKey: 'SHP-1__T1', flowPart: 'SHP-1__T1|sku', qty: 1 }] };
ok('printer\'s sign-in: Received = the office\'s copy of the challan (was "—")', P.vpRecvOf(one.lines[0], one).qty === 1, JSON.stringify(P.vpRecvOf(one.lines[0], one)));
ok('…nothing on the copy yet: still nothing', P.vpRecvOf(one.lines[0], { orderType: 'cut', flowProg: { given: 0, back: 0 }, lines: one.lines }).qty === 0);
ok('…an order the flow did not make: the vendor order\'s own deliveries, as before', P.vpRecvOf({ qty: 5, dispatchedQty: 3 }).qty === 3);
const comb = { orderType: 'running', flowProg: { items: { 'B2B-1__A': { back: 4 }, 'B2B-1__B': { back: 3 } } },
  lines: [{ flowKey: 'B2B-1__A', flowPart: 'B2B-1__A|body+B2B-1__B|body', meters: 10 }] };
ok('…a combined line counts every SKU on it (4 + 3)', P.vpRecvOf(comb.lines[0], comb).qty === 7, JSON.stringify(P.vpRecvOf(comb.lines[0], comb)));
const quilt = { orderType: 'running', flowProg: { items: { 'AMZ-9__Q': { back: 6 } } },
  lines: [{ flowKey: 'AMZ-9__Q', flowPart: 'AMZ-9__Q|Front', meters: 5 }, { flowKey: 'AMZ-9__Q', flowPart: 'AMZ-9__Q|Back', meters: 5 }] };
ok('…a quilt\'s Front and Back get half each, the way the order split them', P.vpRecvOf(quilt.lines[0], quilt).qty === 3 && P.vpRecvOf(quilt.lines[1], quilt).qty === 3);
const ruf = { orderType: 'running', flowProg: { items: { 'SHP-2__R': { back: 9 }, 'SHP-2__R~ruffle': { back: 2 } } },
  lines: [{ flowKey: 'SHP-2__R', flowPart: 'SHP-2__R|body', meters: 9 }, { flowKey: 'SHP-2__R', flowPart: 'SHP-2__R|ruffle', meters: 2 }] };
ok('…the ruffle cloth counts on its own line', P.vpRecvOf(ruf.lines[0], ruf).qty === 9 && P.vpRecvOf(ruf.lines[1], ruf).qty === 2);
ok('…received in full is "all in"; part-received is not', P.vpRecvAll(one, one.lines[0]) && !P.vpRecvAll(comb, comb.lines[0]));
ok('…no box on a line received in full', !/data-vsadd/.test(P.vpVsHtml(one, one.lines[0], 0, 1, 'pcs', 'td')));
ok('…the box stays on a part-received line', /data-vsadd/.test(P.vpVsHtml(comb, comb.lines[0], 0, 10, 'm', 'td')));

/* ---- the office: the challans themselves ---- */
const CH = {
  c1: { no: 'RFD-1', lines: [{ key: 'AMZ-1__X1', pcs: 11, metres: 20, print: { kind: 'sku' } }], receipts: { r1: { items: { 'AMZ-1__X1': 11 } } } },
  c2: { no: 'RFD-2', lines: [{ key: 'B2B-1__A', metres: 5 }, { key: 'B2B-1__B', metres: 5 }], receipts: { r1: { items: { 'B2B-1__A': 2, 'B2B-1__B': 1 } } } },
  c3: { no: 'RFD-3', lines: [{ key: 'B2B-1__A', metres: 3 }], receipts: { r1: { items: { 'B2B-1__A': 2 } } }, moved: { 'B2B-1__A': { to: { name: 'Other' } } } },
};
const O = load(CH);
const x1 = { flowKey: 'AMZ-1__X1', flowPart: 'AMZ-1__X1|sku', qty: 11 };
ok('office: Received = what came back on the challan', O.vpRecvOf(x1).qty === 11 && /RFD-1/.test(O.vpRecvOf(x1).how), JSON.stringify(O.vpRecvOf(x1)));
const combO = { orderType: 'running', lines: comb.lines };
ok('office: a combined line counts every SKU (was only the first)', O.vpRecvOf(combO.lines[0], combO).qty === 3, JSON.stringify(O.vpRecvOf(combO.lines[0], combO)));
ok('office: a line moved to another printer is left out (RFD-3 not counted)', !/RFD-3/.test(O.vpRecvOf(combO.lines[0], combO).how));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
