/* QC pass → Finished Goods "From QC — to accept" (asked 27 Nov: "when the piece is clicked QC pass it should actually show in
 * the QC to accept page"). One chain, with the app's own code at every link:
 *   1. QC pass saves a QC check            src/app/production/quality-control.js — qcCheckRecords (what qcInboxSave writes)
 *   2. the order line counts it as passed  src/app/orders/vendor-holdings.js     — ordQcIndex / ordQcOf
 *   3. Finished Goods lists the line        src/app/flow/flow-qcfg.js             — flowFgWaiting / flowFgLines
 * Between 2 and 3 the line's "made" is the QC passed figure, capped at the line's quantity (flow-core.js, flowState's
 * `made: Math.max(cap(r.pressed), cap(q.ok))`); this test reads that line from flow-core.js to make sure it still says so.
 * Orders and SKUs are made up.
 *   node tests/qc-pass-to-fg-test.js      (QC_SRC=<file> / VH_SRC=<file> / QCFG_SRC=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const QC_SRC = process.env.QC_SRC || path.join(APP, 'production', 'quality-control.js');
const VH_SRC = process.env.VH_SRC || path.join(APP, 'orders', 'vendor-holdings.js');
const QCFG_SRC = process.env.QCFG_SRC || path.join(APP, 'flow', 'flow-qcfg.js');
const CORE_SRC = path.join(APP, 'flow', 'flow-core.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/** One top-level function or const, cut out of a source file as it stands. */
function pick(file, name) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex(l => l.startsWith('function ' + name + '(') || l.startsWith('const ' + name + ' ='));
  if (at < 0) throw new Error(name + ' not found in ' + path.basename(file));
  if (lines[at].startsWith('const ') && /;\s*$/.test(lines[at])) return lines[at];
  const end = lines.findIndex((l, i) => i > at && /^}/.test(l));
  return lines.slice(at, end + 1).join('\n');
}
const CODE = [
  ...['qcNorm', 'qcPcs', 'QC_DEPTS', 'qcSendRemark', 'qcNewCheckId', 'qcMyName', 'qcCheckRecords'].map(n => pick(QC_SRC, n)),
  ...['ordShareBySku', 'ordQcIndex', 'ordQcOf'].map(n => pick(VH_SRC, n)),
  ...['flowFgToAccept', 'flowFgWaiting', 'flowFgLines'].map(n => pick(QCFG_SRC, n)),
].join('\n');

/* The line in flow-core.js that turns the QC passed figure into the line's "made". */
ok('flow-core.js still makes a line\'s "made" from what QC passed', /made: Math\.max\(cap\(r\.pressed\), q \? cap\(q\.ok\) : 0\)/.test(fs.readFileSync(CORE_SRC, 'utf8')));

function load(lines, plans) {
  const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
  const ctx = {
    obUC, obKeyOf: (o, s) => obUC(o) + '|' + obUC(s), ptNum: v => +v || 0, ptDtMs: v => Date.parse(v) || 0, PT_NONE: Object.freeze([]),
    ME: { email: 'qc.tester@example.com' }, QC: { checks: [] }, ORD_QC_IX: { src: null, n: -1, map: null },
    qcParts: () => ({ at: 'Bedsheet', sub: '', col: 'Blue', size: 'King', brand: 'Test' }), rejWhySaved: () => ({}), rejWhyOf: () => ({ why: '', note: '' }),
    ordLines: () => lines, flowIsMto: r => /^(SHP|ONL)-/.test(obUC(r.orderNo)), console, Date, Math, Map, Set, Object, String, parseInt,
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\n;this.T = { qcCheckRecords, ordQcOf, flowFgLines };', ctx);
  /* The flow's rows: each order line with its state, "made" worked out as flow-core.js does. */
  ctx.flowRows = () => lines.map(r => {
    const q = ctx.T.ordQcOf(r.orderNo, r.sku), cap = n => Math.max(0, Math.min(r.qty, +n || 0)), p = plans[r.orderNo] || null;
    return { r, s: { key: r.orderNo + '__' + r.sku, plan: p, route: p ? p.route : '', made: Math.max(cap(r.pressed), q ? cap(q.ok) : 0), india: r.india || 0 } };
  });
  return ctx;
}
/** QC pass on one Job Work row, as the QC Check window saves it; the records join the QC register in memory. */
function qcPass(ctx, row, entry) {
  const recs = ctx.T.qcCheckRecords(row, Object.assign({ checkedBy: 'Sunita' }, entry), '27/11/2026, 12:00');
  ctx.QC.checks = ctx.QC.checks.concat(recs);
  return recs;
}
const job = (id, orderNo, sku) => ({ id, orderNo, sku, empName: 'Karigar A' });
const waitingOf = (ctx, orderNo) => { const x = ctx.T.flowFgLines().find(y => y.r.orderNo === orderNo); return x ? x.s.made - x.s.india : 0; };

/* A planned, in-house Amazon line: 20 ordered, 20 back from the karigar. */
{ const line = { orderNo: 'AMZ-T1', sku: 'TST-BS-01', qty: 20, received: 20 }, ctx = load([line], { 'AMZ-T1': { route: 'inhouse' } });
  ok('before QC pass, nothing of the line is in To accept', ctx.T.flowFgLines().length === 0);
  const recs = qcPass(ctx, job('jw1', 'AMZ-T1', 'TST-BS-01'), { passed: 12, forAlteration: 3, rejected: 1 });
  ok('QC pass saves a check against the order and SKU, with what passed', recs.length === 1 && recs[0].orderNo === 'AMZ-T1' && recs[0].sku === 'TST-BS-01' && recs[0].ok === 12, JSON.stringify(recs));
  ok('the order line counts the 12 as passed', (ctx.T.ordQcOf('AMZ-T1', 'TST-BS-01') || {}).ok === 12);
  ok('…and the 12 show in Finished Goods → From QC — to accept', waitingOf(ctx, 'AMZ-T1') === 12, String(waitingOf(ctx, 'AMZ-T1')));
  qcPass(ctx, job('jw1', 'AMZ-T1', 'TST-BS-01'), { passed: 4 });
  ok('a second QC pass on the same line adds to it (16 to accept)', waitingOf(ctx, 'AMZ-T1') === 16, String(waitingOf(ctx, 'AMZ-T1')));
  line.india = 10;
  ok('what Finished Goods already accepted is taken off (16 passed, 10 accepted → 6)', waitingOf(ctx, 'AMZ-T1') === 6); }

/* The SKU typed in another case or with spaces on the Job Work row still lands on the order line. */
{ const ctx = load([{ orderNo: 'AMZ-T2', sku: 'TST-BS-02', qty: 5, received: 5 }], { 'AMZ-T2': { route: 'inhouse' } });
  qcPass(ctx, job('jw2', ' amz-t2', ' tst-bs-02 '), { passed: 5 });
  ok('a Job Work row with the SKU in small letters or spaces still reaches To accept', waitingOf(ctx, 'AMZ-T2') === 5); }

/* Pieces only sent to spotting or touching have not passed: nothing to accept until they come back. */
{ const ctx = load([{ orderNo: 'AMZ-T3', sku: 'TST-BS-03', qty: 8, received: 8 }], { 'AMZ-T3': { route: 'inhouse' } });
  qcPass(ctx, job('jw3', 'AMZ-T3', 'TST-BS-03'), { spotting: 3, touching: 2 });
  ok('pieces sent to spotting or touching are not in To accept', ctx.T.flowFgLines().length === 0); }

/* Lines that are not the Finished Goods team's — by design (flow-qcfg.js, flowFgWaiting). */
{ const lines = [{ orderNo: 'SHP-T4', sku: 'TST-BS-04', qty: 2, received: 2 }, { orderNo: 'AMZ-T5', sku: 'TST-BS-05', qty: 6, received: 6 },
    { orderNo: 'AMZ-T6', sku: 'TST-BS-06', qty: 6, received: 6 }];
  const ctx = load(lines, { 'SHP-T4': { route: 'inhouse' }, 'AMZ-T5': { route: 'outsource' } });
  lines.forEach((l, i) => qcPass(ctx, job('jw' + (4 + i), l.orderNo, l.sku), { passed: 2 }));
  ok('a Shopify (SHP-) line goes to shipping, not To accept', waitingOf(ctx, 'SHP-T4') === 0);
  ok('an outsourced line is received from its vendor, not To accept', waitingOf(ctx, 'AMZ-T5') === 0);
  ok('a line with no PPC plan is not in To accept', waitingOf(ctx, 'AMZ-T6') === 0); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
