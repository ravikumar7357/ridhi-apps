/* RECEIVE ONLY WHAT THE PRINTER SAYS IT SENT (Ravi, 12 Nov: "instead of giving them option to put how much amount they have received it
 * only gives the fix amount of what the printer has sent").
 *   node tests/receive-vendor-sent-test.js
 * The real functions are cut out of src/ (flow-receive.js flowVsOfKey / flowVsPending / flowVsRecvCell / flowVsCheck / flowChIndex,
 * vendor-portal.js vpVsOf / vpVsSum, vendor-orders.js voLines) and run against stubs. What must hold: a line offers what the printer put
 * on its portal less what is already in; less may be taken, never more; a line the printer said nothing about is blocked; a struck-off
 * batch does not count; a combined line shares the printer's figure; a quilt's Front and Back add up; the ruffle cloth counts on its own. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const FR = rd(path.join(APP, 'flow/flow-receive.js')), VP = rd(path.join(APP, 'vendors/portal/vendor-portal.js')), VO = rd(path.join(APP, 'vendors/orders/vendor-orders.js'));
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const PARTS = [line(VO, 'const voLines ='), line(VP, 'const vpVsKey ='), (s => { const i = s.indexOf('const vpVsAll ='); return s.slice(i, s.indexOf(';\n', i) + 2); })(VP),
  cut(VP, 'vpVsOf'), line(VP, 'const vpVsSum ='),
  line(FR, 'const flowChUnit ='), line(FR, 'const flowChSent ='), line(FR, 'const flowQtyTxt ='), line(FR, 'let FLOW_CHX ='), line(FR, 'const flowChMoved ='), cut(FR, 'flowChIndex'), cut(FR, 'flowChRecv'),
  cut(FR, 'flowVsOfKey'), cut(FR, 'flowVsPending'), cut(FR, 'flowVsRecvCell'), cut(FR, 'flowVsCheck')].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const vs = (lineId, qty, removed) => ({ lineId, qty, unit: 'pcs', at: '2026-11-12T10:00:00Z', ...(removed ? { removed: { at: 'x' } } : {}) });
const VOROWS = [
  { vendorCode: 'P1', id: 'cut1', orderType: 'cut', lines: [{ lineId: 'a', sku: 'X', flowPart: 'O1__X|sku' }, { lineId: 'b', sku: 'Y', flowPart: 'O1__Y|sku' }, { lineId: 'z', sku: 'Z', flowPart: 'O1__Z|sku' }],
    vSent: { s1: vs('a', 3), s2: vs('a', 1), s3: vs('b', 2), s4: vs('b', 5, true) } },
  { vendorCode: 'P1', id: 'run1', orderType: 'running', lines: [
      { lineId: 'c', sku: 'F1', fabricType: 'Cotton', flowPart: 'O2__A|body+O2__B|body' },
      { lineId: 'q1', sku: 'QF', fabricType: 'Cotton', flowPart: 'O2__Q|Front' }, { lineId: 'q2', sku: 'QB', fabricType: 'Cotton', flowPart: 'O2__Q|Back' },
      { lineId: 'r', sku: 'RF', fabricType: 'Cotton', flowPart: 'O2__A|ruffle' }],
    vSent: { m1: { lineId: 'c', qty: 10, unit: 'm', at: 't' }, m2: { lineId: 'q1', qty: 3, unit: 'm', at: 't' }, m3: { lineId: 'q2', qty: 3, unit: 'm', at: 't' }, m4: { lineId: 'r', qty: 2, unit: 'm', at: 't' } } },
];
const PO = { PO1: { items: { O1__X: {}, O1__Y: {}, O1__Z: {} }, vo: { cut: { code: 'P1', id: 'cut1' } } },
  PO2: { items: { O2__A: {}, O2__B: {}, O2__Q: {}, 'O2__A~ruffle': {} }, vo: { running: { code: 'P1', id: 'run1' } } } };
const CH = { c1: { no: 'RFD-1', lines: [{ key: 'O1__X', pcs: 6, print: { kind: 'sku' } }], receipts: { r1: { items: { O1__X: 1 } } } } };

const ctx = { FLOW: { ch: CH, po: PO }, VO: { rows: VOROWS }, FLOW_RUF: '~ruffle', flowR2: n => Math.round((+n || 0) * 100) / 100, nf: n => String(n),
  esc: s => String(s == null ? '' : s), fabKey: s => String(s || '').toLowerCase(), obUC: s => String(s || '').toUpperCase() };
const names = Object.keys(ctx);
const A = new Function(...names, PARTS + '\nreturn { flowVsOfKey, flowVsPending, flowVsRecvCell, flowVsCheck };')(...names.map(k => ctx[k]));

const x = A.flowVsPending('O1__X', false, 'pcs', 'PO1');
ok('printer said 4 sent (3 + 1), 1 already in: 3 offered', x.vs === 4 && x.pending === 3 && !x.blocked, JSON.stringify(x));
ok('…a struck-off batch does not count (Y: 2, not 7)', A.flowVsPending('O1__Y', false, 'pcs', 'PO1').pending === 2);
ok('…the printer said nothing (Z): blocked', A.flowVsPending('O1__Z', false, 'pcs', 'PO1').blocked);
ok('…a combined line shares the printer\'s 10 m over its two SKUs', A.flowVsOfKey('O2__A', false, 'm', 'PO2') === 5 && A.flowVsOfKey('O2__B', false, 'm', 'PO2') === 5);
ok('…a quilt\'s Front and Back add up (3 + 3)', A.flowVsOfKey('O2__Q', false, 'm', 'PO2') === 6);
ok('…the ruffle cloth counts on its own (2 m), not on the body', A.flowVsOfKey('O2__A', true, 'm', null) === 2);
ok('…found without the print order number too (the challan window)', A.flowVsOfKey('O1__X', false, 'pcs', null) === 4);

ok('save: taking all 3 is fine', A.flowVsCheck('O1__X', false, 'pcs', 'PO1', 3, 'X') === '');
ok('save: taking less (2 of 3, short) is fine', A.flowVsCheck('O1__X', false, 'pcs', 'PO1', 2, 'X') === '');
ok('save: taking more (4 of 3) is refused', /more than/.test(A.flowVsCheck('O1__X', false, 'pcs', 'PO1', 4, 'X')));
ok('save: a line the printer said nothing about is refused', /has not said it sent/.test(A.flowVsCheck('O1__Z', false, 'pcs', 'PO1', 1, 'Z')));

const cell = A.flowVsRecvCell('data-fldq', 0, x, 'pcs', '');
ok('screen: the box can go no higher than 3, with a tick that fills 3', /max="3"/.test(cell) && /data-flfill="3"/.test(cell), cell);
ok('screen: a blocked line has no box and says why', !/<input/.test(A.flowVsRecvCell('data-fldq', 0, { blocked: true }, 'pcs', '')) && /has not said it sent/.test(A.flowVsRecvCell('data-fldq', 0, { blocked: true }, 'pcs', '')));
ok('screen: all the printer sent is in: no box', !/<input/.test(A.flowVsRecvCell('data-fldq', 0, { vs: 4, pending: 0, blocked: false }, 'pcs', '')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
