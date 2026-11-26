/* PPC · pieces that passed QC and wait for Finished Goods, on a line that is still being made
 * (src/app/core/ppc-one.js — p1FgWaits, p1WipBuild, P1_ADD, p1Pcs; src/app/flow/flow-qcfg.js — flowFgWaiting, flowFgLines).
 * Ravi, 26 Nov, after the PPC test run: 9 of a 50-piece line passed QC. The Finished Goods screen listed the 9 to accept;
 * the PPC line showed nothing of them, its history card said "Not started", and "Into Finished Goods" said nothing waits.
 * Real lot Oct 1215-JW: "Nothing waiting" on PPC with 38 pieces waiting on the Finished Goods screen. Cases are made up.
 *   node tests/ppc-fg-waiting-test.js      (PPC_ONE=<file> / FLOW_QCFG=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.PPC_ONE || path.join(__dirname, '..', 'src', 'app', 'core', 'ppc-one.js');
const QCFG = process.env.FLOW_QCFG || path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-qcfg.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const obUC = s => String(s == null ? '' : s).trim().toUpperCase();

/* The Finished Goods screen's own rule, cut out of flow-qcfg.js as it stands: the PPC page must answer with it, not a copy. */
const qsrc = fs.readFileSync(QCFG, 'utf8');
const pick = name => { const m = qsrc.match(new RegExp('^const ' + name + ' = .*$', 'm')); if (!m) throw new Error(name + ' not found in flow-qcfg.js'); return m[0]; };
const RULE = [pick('flowFgToAccept'), pick('flowFgWaiting'), pick('flowFgLines')].join('\n');

function load(rows, withFlow) {
  const ctx = {
    obUC, esc: s => String(s == null ? '' : s), flowKey: (o, s) => obUC(o) + '__' + obUC(s), ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0, ptNum: v => +v || 0,
    FLOW: { ppc: {}, res: {}, ch: {} }, FLOW_ROUTES: [], flowRouteOf: () => 'inhouse', ME: { admin: true }, PT: { base: [], cut: [] }, console, Date, Math, Set, Map, setTimeout: () => 0,
    document: { querySelector: () => null, addEventListener() {} }, $: () => null,
    flowRows: () => rows, flowIsMto: r => !!r.mto, flowChRecv: () => ({}), flowR2: n => Math.round((+n || 0) * 100) / 100,
  };
  vm.createContext(ctx);
  vm.runInContext((withFlow === false ? '' : RULE + '\n') + fs.readFileSync(FILE, 'utf8')
    + '\n;this.__t = { p1FgWaits, p1WipBuild, p1WipLine, P1_ADD, p1Pcs, flowFgLines: typeof flowFgLines === "function" ? flowFgLines : null };', ctx);
  ctx.p1Events = () => [];   // no movements needed: only where the pieces are
  return ctx.__t;
}
/** One order line as the flow hands it over: r = the order line, s = its state. */
const L = (o, qty, s, r) => ({ r: Object.assign({ orderNo: o, sku: 'CPC-01', qty }, r), s: Object.assign({ key: obUC(o) + '__CPC-01', plan: { route: 'inhouse' }, route: 'inhouse', made: 0, india: 0, canCut: 0, canIssue: 0 }, s) });
const fgHold = (T, o) => T.p1WipBuild().filter(h => h.stage === 'Finished Goods to accept' && h.orderNo === o);
const addFg = T => T.P1_ADD.find(a => a[0] === 'FG')[3];

/* The test run's line: 50 ordered, 9 passed QC, none in Finished Goods yet, the rest still with karigars — bucket 'wip'. */
{ const part = L('AMZ-1', 50, { bucket: 'wip', made: 9, india: 0 }), T = load([part]);
  ok('a line still being made: its 9 QC-passed pieces wait for Finished Goods', T.p1FgWaits(part) === 9, String(T.p1FgWaits(part)));
  const h = fgHold(T, 'AMZ-1');
  ok('…and are placed at "Finished Goods to accept" (so the line, the history card and the WIP sheet count them)', h.length === 1 && h[0].pcs === 9 && h[0].who === 'Finished Goods team', JSON.stringify(h));
  /* the history card and the WIP sheet read the line through p1WipLine: the 9 are "ready", and only the other 41 "not started" */
  const wipOf = new Map(); T.p1WipBuild().forEach(x => { const k = x.orderNo + '|' + x.sku; (wipOf.get(k) || wipOf.set(k, []).get(k)).push(x); });
  const w = T.p1WipLine(part, wipOf);
  ok('…the history card shows 9 passed QC for Finished Goods, and 41 (not 50) "Not started"', w.rdy === 9 && w.todo === 41, JSON.stringify({ rdy: w.rdy, todo: w.todo }));
  ok('…"Into Finished Goods" lists the line as waiting, with 9 on its button', addFg(T)(part) === true && T.p1Pcs('FG', part) === 9);
  ok('…the Finished Goods screen lists the same line (one rule for both screens)', T.flowFgLines().length === 1 && T.flowFgLines()[0] === part); }

/* 4 of the 9 accepted into Finished Goods: 5 still wait. All 9 accepted: nothing waits. */
{ const some = L('AMZ-2', 50, { bucket: 'qcb', made: 9, india: 4 }), all = L('AMZ-3', 50, { bucket: 'wip', made: 9, india: 9 }), T = load([some, all]);
  ok('what Finished Goods already accepted is taken off (9 passed, 4 accepted → 5 wait)', T.p1FgWaits(some) === 5 && fgHold(T, 'AMZ-2')[0].pcs === 5);
  ok('nothing waits once all passed pieces are accepted', T.p1FgWaits(all) === 0 && fgHold(T, 'AMZ-3').length === 0 && addFg(T)(all) === false); }

/* A finished line counts as it always did. */
{ const fin = L('AMZ-4', 20, { bucket: 'fgin', made: 20, india: 5 }), T = load([fin]);
  ok('a line with every piece made still counts made minus accepted (20 − 5 = 15)', T.p1FgWaits(fin) === 15 && fgHold(T, 'AMZ-4')[0].pcs === 15 && addFg(T)(fin) === true); }

/* Lines that are not the Finished Goods team's to accept. */
{ const mto = L('SHP-1', 3, { bucket: 'wip', made: 2, india: 0 }, { mto: true }), ship = L('SHP-2', 2, { bucket: 'ship', made: 2, india: 0 }, { mto: true }),
    out = L('AMZ-5', 10, { bucket: 'out', route: 'outsource', made: 4, india: 0 }), noPlan = L('AMZ-6', 10, { bucket: 'ppc', plan: null, made: 3, india: 0 }), T = load([mto, ship, out, noPlan]);
  ok('a made-to-order line is handed to shipping: nothing for Finished Goods', T.p1FgWaits(mto) === 0 && T.p1FgWaits(ship) === 0 && fgHold(T, 'SHP-1').length === 0);
  ok('an outsourced line is received from its vendor: nothing for Finished Goods', T.p1FgWaits(out) === 0 && addFg(T)(out) === false);
  ok('a line not planned yet is not listed (the Finished Goods screen does not list it either)', T.p1FgWaits(noPlan) === 0 && T.flowFgLines().length === 0); }

/* Without the flow's helper the page keeps today's answer: finished lines only. */
{ const part = L('AMZ-7', 50, { bucket: 'wip', made: 9, india: 0 }), fin = L('AMZ-8', 20, { bucket: 'fgin', made: 20, india: 5 }), T = load([part, fin], false);
  ok('without the flow helper: finished lines only, as before, and no error', T.p1FgWaits(part) === 0 && T.p1FgWaits(fin) === 15); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
