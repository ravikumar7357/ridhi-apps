/* CLOTH LEFT BY CHALLAN (Ravi, 14 Nov 2026 — team handover "Printed Fabric Flow", proposal b).
 *   node tests/flow-balance-test.js      (BAL_DIR=<dir> tests another copy of flow-balance.js — teeth/teeth-balance.js does)
 * flow-balance.js runs whole; the challan helpers (flow-receive.js), the line key (flow-core.js) and the store's reading of a
 * cutting entry (store.js stCutting) are cut out of src/ and run as they are. What must hold: used = metres cut less the waste put
 * back; the oldest challan of a line is used first; used more than came shows 0 and the extra; a moved line, a cancelled challan
 * and a cut from wastage cloth count nothing; a pieces line counts what was issued; Leftover vs Waiting; red after 7 days. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const BAL = rd(path.join(process.env.BAL_DIR || path.join(APP, 'flow'), 'flow-balance.js'));
const FR = rd(path.join(APP, 'flow/flow-receive.js')), FC = rd(path.join(APP, 'flow/flow-core.js')), ST = rd(path.join(APP, 'inventory/store.js'));
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const PARTS = [line(FR, 'const flowChUnit ='), line(FR, 'const flowChSent ='), line(FR, 'const flowQtyTxt ='), line(FR, 'const flowMixTxt =') + line(FR, '  return [t.m ?'),
  line(FR, 'const flowChMoved ='), cut(FR, 'flowChRecv'), line(FR, 'const flowRemDays ='), line(FC, 'const flowKey ='), line(ST, 'const stNum ='), cut(ST, 'stCutting'), BAL].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function load(ch, cuts, states, due) {
  const fixed = {};   // setFlowRows: the same flow lines on every call, as the app keeps them until something changes
  const ctx = {
    FLOW: { ch }, PT: { cut: cuts }, flowRows: () => fixed.rows || states.map(s => ({ r: {}, s })), flowR2: n => Math.round((+n || 0) * 100) / 100,
    flowDueRows: () => (due || []).map(([key, code]) => ({ l: { key }, code, printer: 'P' })),
    flowIsTest: no => /^TEST-/.test(String(no || '')), flowChLineWhat: l => 'what ' + l.sku, cutSkuOf: () => ({ color: 'Blue' }),
    mdbOf: () => ({}), ptPrintIssueAs: () => 'running', ptConsPlan: () => ({ why: 'no plan' }),
    dToday: () => '2026-11-14', obUC: s => String(s == null ? '' : s).trim().toUpperCase(), esc: s => String(s == null ? '' : s), nf: n => String(n),
    console: { warn() {} },
  };
  const names = Object.keys(ctx);
  const B = new Function(...names, PARTS + '\nreturn { flowBalRows, flowBalTable, flowBalBar, FLOW_BAL };')(...names.map(k => ctx[k]));
  return Object.assign(B, { FLOW: ctx.FLOW, setFlowRows: v => { fixed.rows = v; } });
}

const L = (sku, o) => Object.assign({ key: 'AMZ-1__' + sku, orderNo: 'AMZ-1', sku, metres: 100, pcs: 0, print: { kind: 'fabric', code: 'PF-' + sku } }, o);
const rc = (date, items) => ({ date, at: date + 'T10:00:00Z', items });
const CH = {
  A: { no: 'A', orderNo: 'AMZ-1', vendor: { name: 'Shree' }, lines: [L('S1')], receipts: { r1: rc('2026-11-01', { 'AMZ-1__S1': 100 }) } },
  B: { no: 'B', orderNo: 'AMZ-1', vendor: { name: 'Shree' }, lines: [L('S2', { metres: 30 })], receipts: { r1: rc('2026-11-02', { 'AMZ-1__S2': 30 }) } },
  C: { no: 'C', orderNo: 'AMZ-1', vendor: { name: 'Om' }, lines: [L('S2', { metres: 50 })], receipts: { r1: rc('2026-11-05', { 'AMZ-1__S2': 50 }) } },
  D: { no: 'D', orderNo: 'AMZ-1', vendor: { name: 'Om' }, lines: [L('S3', { metres: 40 })], receipts: { r1: rc('2026-11-06', { 'AMZ-1__S3': 40 }) } },
  E: { no: 'E', orderNo: 'AMZ-1', vendor: { name: 'Om' }, lines: [L('S4', { pcs: 50, metres: 0, print: { kind: 'sku', code: 'S4' } })], receipts: { r1: rc('2026-11-12', { 'AMZ-1__S4': 50 }) } },
  F: { no: 'F', orderNo: 'AMZ-1', vendor: { name: 'Om' }, lines: [L('S5')], receipts: { r1: rc('2026-11-03', { 'AMZ-1__S5': 20 }) }, moved: { 'AMZ-1__S5': { to: { name: 'X' } } } },
  G: { no: 'G', orderNo: 'AMZ-1', vendor: { name: 'Om' }, cancelled: { at: 'x' }, lines: [L('S6')], receipts: { r1: rc('2026-11-03', { 'AMZ-1__S6': 20 }) } },
  /* Live, 14 Nov: pieces cut with no metres typed (CPC-SC-007, 807 pcs) and pieces issued beyond what came on the challan (CPC007-04). */
  H: { no: 'H', orderNo: 'AMZ-1', vendor: { name: 'Shree' }, lines: [L('S7', { metres: 30 })], receipts: { r1: rc('2026-11-04', { 'AMZ-1__S7': 30 }) } },
  I: { no: 'I', orderNo: 'AMZ-1', vendor: { name: 'Shree' }, lines: [L('S8', { pcs: 10, metres: 0, print: { kind: 'sku', code: 'S8' } })], receipts: { r1: rc('2026-11-04', { 'AMZ-1__S8': 10 }) } },
};
const CUTS = [
  { id: 'c1', orderNo: 'AMZ-1', sku: 'S1', pieces: 10, fabricWidth: 'Cotton', fabricUsed: 65, fabricWaste: 5 },
  { id: 'c2', orderNo: 'AMZ-1', sku: 'S1', pieces: 3, fabricWidth: 'Cotton', fabricUsed: 20, clothFrom: 'wastage' },
  { id: 'c3', orderNo: 'AMZ-1', sku: 'S2', pieces: 9, fabricWidth: 'Cotton', fabricUsed: 45 },
  { id: 'c4', orderNo: 'AMZ-1', sku: 'S3', pieces: 9, fabricWidth: 'Cotton', fabricUsed: 52 },
  { id: 'c5', orderNo: 'AMZ-1', sku: 'S5', pieces: 9, fabricWidth: 'Cotton', fabricUsed: 5 },
  { id: 'c6', orderNo: 'AMZ-1', sku: 'S7', pieces: 12, fabricWidth: 'Cotton' },
];
const STATES = [{ key: 'AMZ-1__S1', bucket: 'wip' }, { key: 'AMZ-1__S2', bucket: 'cut' }, { key: 'AMZ-1__S3', bucket: 'raw' }, { key: 'AMZ-1__S4', bucket: 'raw', issuedNet: 30 },
  { key: 'AMZ-1__S7', bucket: 'raw' }, { key: 'AMZ-1__S8', bucket: 'wip', issuedNet: 25 }];

const B = load(CH, CUTS, STATES, [['AMZ-1__S8', 'P1']]), rows = B.flowBalRows('', false), row = no => rows.find(r => r.no === no) || {};
const j = r => JSON.stringify({ recv: r.recv, used: r.used, left: r.left, over: r.over, where: r.where, days: r.days });

console.log('Metres: cut less the waste put back');
ok('A: 100 m in, 65 m cut, 5 m waste back → 60 m used, 40 m left', row('A').used === 60 && row('A').left === 40, j(row('A')));
ok('A: a cut from wastage cloth uses nothing of the challan', row('A').left === 40);
ok('A: the line is with karigars → Leftover', row('A').where === 'leftover', j(row('A')));
ok('A: 13 days since the receipt', row('A').days === 13, j(row('A')));

console.log('One order line on two challans: oldest first');
ok('B (2 Nov, 30 m): used in full first → 0 left', row('B').used === 30 && row('B').left === 0 && row('B').where === 'used', j(row('B')));
ok('C (5 Nov, 50 m): the other 15 m → 35 m left', row('C').used === 15 && row('C').left === 35, j(row('C')));
ok('C: the line is still in To cut → Waiting', row('C').where === 'waiting', j(row('C')));
ok('B: no days once nothing is left', row('B').days === null);

console.log('Used more than came');
ok('D: 40 m in, 52 m cut → 0 left and 12 m more than came', row('D').left === 0 && row('D').over === 12, j(row('D')));

console.log('Pieces printed on the SKU');
ok('E: 50 pcs in, 30 issued → 20 pcs left', row('E').unit === 'pcs' && row('E').used === 30 && row('E').left === 20, j(row('E')));
ok('E: still in Raw cutting in store → Waiting', row('E').where === 'waiting');

console.log('Left out');
ok('F: a line moved to another printer is not here', !rows.some(r => r.no === 'F'));
ok('G: a cancelled challan is not here', !rows.some(r => r.no === 'G'));
console.log('Live data, 14 Nov');
ok('H: 12 pcs cut with no metres typed → not Leftover, not Waiting; says so', row('H').where === 'nometres' && row('H').left === 30, j(row('H')));
ok('I: 10 pcs came, 25 issued → 0 left, 15 issued more than came', row('I').left === 0 && row('I').over === 15, j(row('I')));
ok('order: Leftover, metres not typed, Waiting, then used up',
  rows.map(r => r.where).join(',') === 'leftover,nometres,waiting,waiting,used,used,used', rows.map(r => r.no + ':' + r.where).join(','));
ok('search narrows to the printer', B.flowBalRows('om', false).every(r => r.printer === 'Om') && B.flowBalRows('om', false).length === 3);
ok('TEST only: a real order is not shown', B.flowBalRows('', true).length === 0);

console.log('The screen (14 Nov: drop-downs and one wide table)');
const html = B.flowBalTable('', false);
const has = no => new RegExp('<b>' + no + '</b>').test(html);
ok('by default: every line with a job (A C D E H I), not the used-up one (B)', ['A', 'C', 'D', 'E', 'H', 'I'].every(has) && !has('B'));
ok('one wide table: all 13 columns, Challan to Who · open', ['Challan', 'Printer', 'Order', 'SKU', 'Printed fabric', 'Sent', 'Received', 'Used', 'Left', 'Last received', 'Days', 'What to do', 'Who · open']
  .every(h => html.includes('>' + h + '</th>')));
ok('the over-used line says by how much, in red', /color:#b91c1c;white-space:normal">Used 12 m more than came/.test(html));
ok('pieces say Issued, not Used', /color:#b91c1c;white-space:normal">Issued 15 pcs more than came/.test(html));
ok('metres not typed: grey Fix metres, and Used says "not typed"', /color:#475569;white-space:normal">Fix metres · 12 pcs cut/.test(html) && /not typed/.test(html));
ok('days over 7 are red, 2 days is not', /color:#b91c1c;font-weight:700">13</.test(html) && !/font-weight:700">2</.test(html));
ok('the waste back is shown under Used', /cut 65 m, 5 m waste back/.test(html));
ok('the foot adds up what is shown: 105 m · 20 pcs left', /<td class="num">105 m · 20 pcs<\/td><td><\/td>/.test(html), (html.match(/Total[\s\S]*<\/tr>/) || [''])[0]);
const bar = B.flowBalBar('', false);
ok('one line of totals: Leftover 40 m · Waiting 35 m · 20 pcs (metres-not-typed kept out) · 3 challans over 7 days',
  /Leftover 40 m · Waiting to cut \/ issue 35 m · 20 pcs · <span[^>]*>3 challan\(s\) over 7 days/.test(bar), bar);
ok('What to do drop-down with counts: All 6 · Cut 1 · Issue 1 · Fix metres 1 · Check receipt 2 · Leftover 1 · Every line',
  /data-flbalsel="todo"/.test(bar) && /All jobs — 6/.test(bar) && /Cut — 1/.test(bar) && /Issue — 1/.test(bar) && /Fix metres — 1/.test(bar) && /Check receipt — 2/.test(bar) && /Leftover — 1/.test(bar) && /value="every"/.test(bar));
ok('Days and Printer drop-downs: Any age / Over 7 days · All printers / Om / Shree',
  /data-flbalsel="late"[\s\S]*Over 7 days/.test(bar) && /data-flbalsel="printer"[\s\S]*<option value="Om">Om<\/option><option value="Shree">Shree<\/option>/.test(bar));
ok('no chips and no tick boxes left', !/data-flbaltodo|type="checkbox"/.test(bar));

console.log('What to do (Ravi, 14 Nov: "make it actionable")');
const todo = no => row(no).todo;
ok('each line has its job: A leftover · C cut · E issue · H fix metres · D and I check receipt · B nothing',
  [todo('A'), todo('C'), todo('E'), todo('H'), todo('D'), todo('I'), todo('B')].join(',') === 'left,cut,issue,fix,over,over,', ['A', 'C', 'E', 'H', 'D', 'I', 'B'].map(todo).join(','));
ok('C: Cutting entry → opens the line\'s cutting entry (the To cut button)', /data-flent="cut\|AMZ-1__S2"[^>]*>Cutting entry →/.test(html));
ok('E: Issue to karigar → opens the line\'s issue', /data-flent="issue\|AMZ-1__S4"[^>]*>Issue to karigar →/.test(html));
ok('H: Fix metres → opens that cutting entry\'s Edit', /data-flbalfix="c6"[^>]*>Fix metres →/.test(html));
ok('I: the printer still owes it → Receive on challan, searched to the SKU', /data-flbalrecv="P1\|S8"[^>]*>Receive on challan →/.test(html));
ok('D: nothing owed → no Receive button, says where to look', /came another way: check Vendor Orders/.test(html) && !/data-flbalrecv="[^"]*\|S3"/.test(html));
ok('A: leftover → Store, check the shelf (nothing to press)', /Store<\/div><div style="font-size:11.5px">Check it is on the shelf/.test(html));
const shown = () => B.flowBalTable('', false), on = (h, no) => new RegExp('<b>' + no + '</b>').test(h);
B.FLOW_BAL.todo = 'cut'; const onlyCut = shown();
ok('What to do = Cut: only the line to cut', on(onlyCut, 'C') && !on(onlyCut, 'A') && !on(onlyCut, 'E'));
B.FLOW_BAL.todo = 'every'; const every = shown();
ok('What to do = Every line: the used-up line (B) shows too', on(every, 'B') && on(every, 'A'));
B.FLOW_BAL.todo = ''; B.FLOW_BAL.late = true; const late = shown();
ok('Days = Over 7 days: A (13), C (9), H (10) stay; E (2) goes', on(late, 'A') && on(late, 'C') && on(late, 'H') && !on(late, 'E'));
B.FLOW_BAL.late = false; B.FLOW_BAL.printer = 'Om'; const om = shown();
ok('Printer = Om: only Om\'s lines (C, D, E)', on(om, 'C') && on(om, 'D') && on(om, 'E') && !on(om, 'A') && !on(om, 'H'));
B.FLOW_BAL.printer = '';

console.log('Worked out once per screen');
const S1 = load(CH, CUTS, STATES); S1.setFlowRows(STATES.map(s => ({ r: {}, s })));
const r1 = S1.flowBalRows('', false), r2 = S1.flowBalRows('', false);
ok('drawn twice with nothing changed: the same lines, not worked out again', r1 === r2);
ok('a new search: worked out again', S1.flowBalRows('om', false) !== r1);
const r3 = S1.flowBalRows('', false);
ok('…back to no search, and drawn again: kept', S1.flowBalRows('', false) === r3);
S1.FLOW.ch = Object.assign({}, CH);
ok('the challans changed (a receipt): worked out again', S1.flowBalRows('', false) !== r3);
ok('a line gone from the flow is never one to cut (it is done: Leftover), so no Cutting entry for it', load(CH, CUTS, STATES.filter(s => s.key !== 'AMZ-1__S2')).flowBalRows('', false).filter(r => r.key === 'AMZ-1__S2').every(r => r.todo !== 'cut'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
