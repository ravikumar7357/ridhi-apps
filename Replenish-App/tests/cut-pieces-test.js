/* CUT PIECES: CHALLAN → CUT TO SIZE → PRINTER (Vishesh, 27 Nov). Pins the business rules of flow/flow-cutpiece.js and the
 * desk's stock side of it:
 *   - priority is the order line's P1–P4, else the SKU's tag, else none (last); inside one priority the oldest order first
 *   - a Cut Pieces Challan takes its cloth off RFD on shelf at once, oldest lot first, and never more than the lots hold
 *   - one product is in one cutting record at a time
 *   - Waiting to cut → Piece Ready for Cut → Cut done → Send to printer, in that order only; take back only before it is cut
 *   - the printer challan of cut pieces takes no more cloth; once sent the piece leaves Cut to size; a cancelled challan brings it back
 * Loads the real source files with a fake database. Made-up fabrics, lots and orders only.
 *   node tests/cut-pieces-test.js
 *   CP_FILE=<a broken copy> node tests/cut-pieces-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app', 'flow');
const CP = process.env.CP_FILE ? path.resolve(process.env.CP_FILE) : path.join(APP, 'flow-cutpiece.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info !== undefined ? ' -- ' + JSON.stringify(info) : '')); } };

const db = {};   // the fake database: path → value
/* like the real one: records come back with their fields sorted, and the swap compares the text */
const inOrder = v => (v && typeof v === 'object' ? (Array.isArray(v) ? v.map(sorted) : Object.keys(v).sort().reduce((o, k) => { o[k] = inOrder(v[k]); return o; }, {})) : v);
const ptGetFresh = async p => (db[p] ? JSON.parse(JSON.stringify(db[p])) : null);
const ptCas = async (p, expect, next) => { if (JSON.stringify(db[p] || null) !== JSON.stringify(expect || null)) return 'changed'; db[p] = next ? inOrder(next) : null; return ''; };
let stockSays = '', sendSays = '';
const taken = [], returned = [], sent = [];
const ctx = {
  console: { warn() {}, error() {}, log() {} }, ptCas, ptGetFresh,
  ME: { email: 'neha@example.test' }, FLOW: { dem: {}, ch: {} },
  SOX: { rows: [{ _id: 'AMZ-1', lines: [{ sku: 'MAT1', priority: 'P3' }, { sku: 'MAT2', priority: '' }] }] }, PTE: { priority: { MAT2: 'P1', MAT1: 'P1' } },
  obUC: v => String(v || '').trim().toUpperCase(), flowR2: n => Math.round(n * 100) / 100, nf: n => String(n), esc: v => String(v),
  dToday: () => '2026-11-27', ptIsoDate: v => v, flowFabKey: v => String(v || '').trim().toLowerCase(),
  flowClaim: async (p, v) => ((await ptCas(p, null, v)) ? 'taken' : ''),
  flowShVname: c => 'Printer ' + c, flowChItem: r => r.item, cutSkuOf: () => ({ size: '15 Round', articleType: 'Placemat' }),
  flowEnsureData: async () => {}, flowRows: () => [{ s: { key: 'k1' }, r: {} }], flowShVen: c => ({ code: c }), flowShLine: x => ({ x, key: x.s.key }),
  flowShMake: async (v, go, note, fabric, extra) => { if (sendSays) return { err: sendSays }; sent.push({ go, extra }); return { no: 'RFD-1' }; },
  flowScreenAllowed: () => [['drfd']],
  GD: { cutFresh: async () => {}, state: () => 'ok', cutCheck: () => '', cutIssue: async (f, no, rows) => { if (stockSays) return stockSays; taken.push({ no, rows }); return ''; }, cutReturn: async (no, key) => { returned.push(no + ' ' + key); return ''; } },
};
vm.createContext(ctx);
const history = fs.readFileSync(path.join(APP, '..', 'core', 'history.js'), 'utf8');
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('moved: ' + a); return src.slice(i, j); };
vm.runInContext(slice(history, 'function ptSame(', '/** SAVE A WHOLE RECORD') + fs.readFileSync(CP, 'utf8') + '\nglobalThis.T = { flowPri, flowPriSort, flowCpMake, flowCpStep, flowCpTakeBack, flowCpSend, flowCpActive, flowCpList, flowCpPicked };', ctx);
const T = ctx.T;
const line = (key, sku, pcs) => ({ key, pcs, perPc: 0.25, metres: pcs * 0.25, to: 'V1',
  x: { r: { orderNo: 'AMZ-1', orderDate: '2026-10-20', sku, item: 'Round mat' }, s: { plan: { fabric: { name: 'Canvas' } } } } });
const rec = key => ((ctx.FLOW.dem[key] || {}).cutPc) || null;

(async () => {
  console.log('== priority ==');
  ok('the order line\'s own priority beats the SKU tag', T.flowPri('AMZ-1', 'MAT1') === 'P3');
  ok('no priority on the line: the SKU tag', T.flowPri('AMZ-1', 'MAT2') === 'P1');
  ok('neither: none', T.flowPri('AMZ-1', 'OTHER') === '');
  const o = (orderNo, orderDate, priority) => ({ orderNo, orderDate, priority });
  const sorted = T.flowPriSort([o('C', '2026-01-01', ''), o('B', '2026-01-02', 'P2'), o('A', '2026-01-03', 'P1'), o('D', '2026-01-01', 'P2'), o('B', '2026-01-02', 'P4')], x => x);
  ok('P1 → P2 (oldest first) → none, an order\'s lines together', sorted.map(x => x.orderNo + x.priority).join(' ') === 'AP1 DP2 BP2 BP4 C', sorted);

  console.log('== making the challan ==');
  const made = await T.flowCpMake('Canvas', [line('k1', 'MAT1', 86), line('k2', 'MAT2', 40)], 'tempo');
  ok('a numbered challan', made.no === 'CP-20261127-01', made);
  ok('each line waits to be cut, with its order, size, pieces, metres, printer and challan', rec('k1').status === 'wait' && rec('k1').orderNo === 'AMZ-1' && rec('k1').size === '15 Round' && rec('k1').pcs === 86 && rec('k1').metres === 21.5 && rec('k1').printer.code === 'V1' && rec('k1').no === made.no);
  ok('the cloth leaves the shelf for exactly these lines', taken.length === 1 && taken[0].rows.map(r => r.key + ':' + r.metres).join() === 'k1:21.5,k2:10');
  ok('the list is most urgent first', T.flowCpList('canvas').map(r => r.sku).join() === 'MAT2,MAT1');
  const again = await T.flowCpMake('Canvas', [line('k1', 'MAT1', 86)], '');
  ok('the same product cannot go into a second record', /already in Cut to size/.test(again.err) && rec('k1').no === made.no && taken.length === 1, again);
  stockSays = 'no cloth';
  const short = await T.flowCpMake('Canvas', [line('k3', 'MAT1', 5)], '');
  ok('cloth cannot be taken: no record is left behind', short.err === 'no cloth' && rec('k3') === null);
  stockSays = '';

  console.log('== the steps ==');
  ok('Cut done before Ready is refused', (await T.flowCpStep('k1', 'cut')) !== '' && rec('k1').status === 'wait');
  ok('sending before it is cut is refused', /Only a cut piece/.test((await T.flowCpSend('k1')).err) && sent.length === 0);
  ok('Piece Ready for Cut', (await T.flowCpStep('k1', 'ready')) === '' && rec('k1').status === 'ready' && rec('k1').ready.by === 'neha@example.test');
  ok('Cut done', (await T.flowCpStep('k1', 'cut')) === '' && rec('k1').status === 'cut');
  ok('a cut piece cannot be taken back', (await T.flowCpTakeBack('k1')) !== '' && returned.length === 0);
  ok('one not yet cut can: record gone, cloth returned', (await T.flowCpTakeBack('k2')) === '' && rec('k2') === null && returned[0] === made.no + ' k2');

  console.log('== to the printer ==');
  sendSays = 'refused';
  ok('a refused printer challan leaves the piece cut', (await T.flowCpSend('k1')).err === 'refused' && rec('k1').status === 'cut');
  sendSays = '';
  const go = await T.flowCpSend('k1');
  ok('one challan for the recorded pieces, marked as cut pieces', go.no === 'RFD-1' && sent[0].go[0].pcs === 86 && sent[0].go[0].metres === 21.5 && sent[0].go[0].to === 'V1' && sent[0].extra.fromCut === made.no, sent[0]);
  ok('sent: it leaves Cut to size', rec('k1').status === 'sent' && T.flowCpActive('k1') === null && T.flowCpList('Canvas').length === 0);
  ok('it cannot be sent twice', /Only a cut piece/.test((await T.flowCpSend('k1')).err) && sent.length === 1);
  ctx.FLOW.ch = { 'RFD-1': { cancelled: true } };
  ok('the printer challan cancelled: back in Cut to size as cut', (T.flowCpActive('k1') || {}).status === 'cut');

  console.log('== a send cut short ==');
  ctx.FLOW.ch = {};
  ctx.flowShMake = async () => ({ err: 'saved, lines not marked', claimed: 'RFD-9' });
  db['pt_flowDemand/k1/cutPc'] = inOrder(Object.assign({}, rec('k1'), { status: 'cut' })); ctx.FLOW.dem.k1.cutPc = db['pt_flowDemand/k1/cutPc'];
  const half = await T.flowCpSend('k1');
  ok('a challan that was saved counts as sent, so it cannot be made twice', /saved/.test(half.err) && rec('k1').status === 'sent' && rec('k1').challan === 'RFD-9', rec('k1'));

  console.log('== the desk\'s stock ==');
  const deskSrc = fs.readFileSync(path.join(APP, 'greige-desk.js'), 'utf8').replace(/\r\n/g, '\n');
  const patches = [];
  const d = { GD_STATE: 'ok', GD_SNAP: { fab: {} }, GD_NODE: 'pt_gdTest', DB: { fab: [] }, r2: ctx.flowR2, ctsN: String, nf: String,
    invChallanOut: () => 0, invLotsLeft: () => ({ OLD: 10, NEW: 20 }), uid: (() => { let n = 0; return () => 'r' + (++n); })(), lmToday: () => '2026-11-27',
    meUser: () => ({ name: 'Neha' }), ptPatch: async p => { patches.push(p); } };
  vm.createContext(d);
  vm.runInContext(slice(deskSrc, 'function gdCutLots(', 'function gdRfdShelf(') + '\nglobalThis.S = { gdCutCheck, gdCutIssue, gdCutReturn };', d);
  ok('never more than the lots hold', /hold 30 m/.test(d.S.gdCutCheck('Canvas', 31)) && d.S.gdCutCheck('Canvas', 30) === '');
  await d.S.gdCutIssue('Canvas', 'CP-1', [{ key: 'a', sku: 'MAT1', orderNo: 'AMZ-1', pcs: 48, metres: 12 }, { key: 'b', sku: 'MAT2', orderNo: 'AMZ-1', pcs: 4, metres: 1 }]);
  ok('the oldest lot goes first, then the next', d.DB.fab.map(r => r.lineKey + r.lot + r.qty).join() === 'aOLD10,aNEW2,bNEW1', d.DB.fab.map(r => r.lineKey + r.lot + r.qty));
  await d.S.gdCutReturn('CP-1', 'a');
  ok('take back removes that line\'s rows only', d.DB.fab.map(r => r.lineKey).join() === 'b' && Object.values(patches[1]).every(v => v === null) && Object.keys(patches[1]).length === 2);

  console.log('== no other way to the printer ==');
  const challan = fs.readFileSync(path.join(APP, 'flow-challan.js'), 'utf8').replace(/\r\n/g, '\n');
  const w = { flowCpActive: () => ({ no: 'CP-1' }) };
  vm.createContext(w);
  vm.runInContext(slice(challan, 'async function flowChallanWrite(', '  let no = flowChallanNo(') + "return 'went';\n}\nglobalThis.W = flowChallanWrite;", w);
  const line1 = { at: '', vendor: { name: 'V' }, lines: [{ key: 'k1', sku: 'MAT1' }] };
  ok('an ordinary challan refuses a line in Cut to size', /is in Cut to size on challan CP-1/.test(await w.W(Object.assign({}, line1), {}, {})));
  ok('its own send goes through', (await w.W(Object.assign({}, line1), {}, { fromCut: 'CP-1' })) === 'went');

  console.log('== ticking ==');
  ctx.flowShGoing = S => S.go; ctx.flowShKind = l => l.kind;
  ok('running cloth ticked with cut pieces is refused', /separately/.test(T.flowCpPicked({ go: [{ kind: 'cut', x: { r: {} } }, { kind: 'run', x: { r: {} } }] }).err));

  console.log('== the shelf is taken once ==');
  const demand = fs.readFileSync(path.join(APP, 'flow-demand.js'), 'utf8');
  const mv = { console, FLOW: { ch: { A: { no: 'A', date: '2026-11-27', fromCut: 'CP-1', lines: [{ fabric: 'Canvas', metres: 20 }] }, B: { no: 'B', date: '2026-11-27', lines: [{ fabric: 'Canvas', metres: 5 }] } } },
    flowFabKey: ctx.flowFabKey, flowR2: ctx.flowR2, ptIsoDate: v => v };
  vm.createContext(mv);
  const from = demand.indexOf('function flowRfdChallanMoves'), to = demand.indexOf('function flowRfdStock');
  vm.runInContext(demand.slice(from, to) + '\nglobalThis.M = flowRfdChallanMoves;', mv);
  ok('the cut pieces\' printer challan takes no cloth from the shelf', mv.M('Canvas', '').map(x => x.no + x.metres).join() === 'B5', mv.M('Canvas', ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
