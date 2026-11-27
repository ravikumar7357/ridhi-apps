/* THE SAME NUMBER AND NAME ON EVERY SCREEN (fix 10 of the PPC flow test, Ravi 26 Nov 2026). PPC said In QC 30,622 while the
 * QC screen said 161; "Into FG" held pieces waiting for shipping; the same cut pieces had three names; Complete read 0.
 * Agreed: In QC matches the QC screen, alteration counted on its own; "To hand to shipping" is its own column; a lot never
 * cut says "No cutting needed" and its pieces are "Cut, in store" on the Report too.
 *   node tests/ppc-same-number-test.js      (PPC_ONE / FLOW_REPORT=<a broken copy> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const src = (env, rel) => fs.readFileSync(process.env[env] ? path.resolve(process.env[env]) : path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
const PPC = src('PPC_ONE', 'core/ppc-one.js');

function ppc(extra) {
  const ctx = Object.assign({ PT: { base: [], cut: [] }, QC: { checks: [] }, obUC, console: { warn() {} }, ME: { admin: true }, FLOW: { ppc: {}, res: {} }, flowRouteOf: () => 'inhouse',
    esc: s => String(s == null ? '' : s), Date, Math, Set, Map, setTimeout: () => 0, document: { querySelector: () => null, addEventListener: () => {} } }, extra);
  vm.createContext(ctx);
  vm.runInContext(PPC + '\n;this.__t = { p1QcWaiting, p1QcAway, p1LineStages, p1WipLine, p1HistPassed, p1HistPlaces, P1_COLS, P1_COL_OF, P1_WCOLS, P1_WXL, p1WxlVals };', ctx);
  return ctx.__t;
}
const line = (s, q) => ({ r: { orderNo: 'AMZ-1', sku: 'cpc-01', qty: q || 50 }, s: Object.assign({ bucket: 'wip', plan: {} }, s) });

console.log('== In QC is what the QC screen lists as waiting ==');
{ const inbox = [{ r: { orderNo: 'AMZ-1', sku: 'CPC-01' }, wait: 9 }, { r: { orderNo: 'amz-1', sku: 'cpc-01' }, wait: 4 }, { r: { orderNo: 'AMZ-2', sku: 'CPC-01' }, wait: 7 }];
  const A = ppc({ qcInboxRows: () => inbox, flowQcWaiting: () => 30622, flowQcLine: () => ({ altOpen: 2, deptOpen: 1 }) });
  ok('a line\'s rows added up, not the all-time count', A.p1QcWaiting(line({})) === 13);
  ok('a line the QC screen does not list has nothing in QC', A.p1QcWaiting({ r: { orderNo: 'OLD-1', sku: 'CPC-01' }, s: {} }) === 0);
  ok('alteration, spotting and touching are counted apart', A.p1QcAway({}) === 3);
  inbox.push({ r: { orderNo: 'AMZ-1', sku: 'CPC-01' }, wait: 1 });
  ok('not worked out again while nothing was entered', A.p1QcWaiting(line({})) === 13); }
{ let said = 0; const checks = [];
  const A = ppc({ QC: { checks }, console: { warn: () => { said++; } }, qcInboxRows: () => { if (!checks.length) throw new Error('not read'); return [{ r: { orderNo: 'AMZ-1', sku: 'CPC-01' }, wait: 5 }]; }, flowQcWaiting: () => 8 });
  ok('a QC list that cannot be read: counted as before, said once', A.p1QcWaiting(line({})) === 8 && A.p1QcWaiting(line({})) === 8 && said === 1);
  checks.push({});
  ok('read again once QC entries change', A.p1QcWaiting(line({})) === 5); }
ok('the page\'s QC stage uses it, and alteration is its own stage', /qcw = p1QcWaiting\(x\); away = p1QcAway\(r\);/.test(PPC) && /stage: 'In alteration'/.test(PPC) && !/p1QcWaiting\(x\) \+ /.test(PPC));
ok('the "QC check" add button counts the same way', !/\['QC', 'QC check', 'qc', x => \{ try \{ return flowQcWaiting/.test(PPC) && /if \(k === 'QC'\) \{ try \{ return p1QcWaiting\(x\)/.test(PPC));

console.log('== Into FG and To hand to shipping are two columns ==');
{ const A = ppc({}), cols = A.P1_COLS.map(c => c[1]);
  ok('both columns, and In alteration beside In QC', cols.join('|').includes('In QC|In alteration|Into FG|To hand to shipping'), cols.join('|'));
  ok('shipping pieces never land under Into FG', A.P1_COL_OF['To hand to shipping'] === 'ship' && A.P1_COL_OF['Finished Goods to accept'] === 'rdy');
  const holds = new Map([['AMZ-1|CPC-01', [{ stage: 'To hand to shipping', pcs: 40, unit: 'pcs' }, { stage: 'Finished Goods to accept', pcs: 5, unit: 'pcs' }, { stage: 'In alteration', pcs: 3, unit: 'pcs' }, { stage: 'QC', pcs: 2, unit: 'pcs' }]]]);
  const w = A.p1WipLine(line({}), holds), st = A.p1LineStages(line({}), w);
  ok('a line\'s stages keep them apart', st.rdy.w === 5 && st.ship.w === 40 && st.alt.w === 3 && st.qc.w === 2, JSON.stringify({ rdy: st.rdy.w, ship: st.ship.w, alt: st.alt.w, qc: st.qc.w }));
  ok('all of them are still counted in process, none as not started', w.inp === 50 && w.todo === 0, w.inp + '/' + w.todo);
  ok('the Excel has a heading for every figure', A.P1_WXL.length === A.p1WxlVals(w).length && A.P1_WXL.includes('To shipping') && A.P1_WXL.includes('In alteration'));
  ok('the history card places add up the same way', A.p1HistPlaces([w], 50, {}).rows.reduce((t, x) => t + x.pcs, 0) === 50); }

{ const A = ppc({ flowIsMto: r => r.orderNo === 'SHP-1' }), done = { bucket: 'ship', qc: 50 };
  const stock = A.p1LineStages(line(done), A.p1WipLine(line(done), new Map()));
  const mto = { r: { orderNo: 'SHP-1', sku: 'cpc-01', qty: 50 }, s: Object.assign({ plan: {} }, done) };
  const m = A.p1LineStages(mto, A.p1WipLine(mto, new Map()));
  ok('a stock lot: no shipping column; alteration ticked once QC passed it', stock.ship.na && !stock.rdy.na && stock.alt.done);
  ok('a made-to-order lot: no Into FG column, a shipping one', m.rdy.na && !m.ship.na); }
ok('the cut pieces have one name on PPC', !/To issue'|Raw cutting in store/.test(PPC) && /\['iss', 'Cut, in store'\]/.test(PPC));

console.log('== a lot that is never cut ==');
{ const A = ppc({}), S = { cut: { na: false } };
  const cutRow = noCut => A.p1HistPassed([], S, noCut).find(x => x.k === 'CUT');
  ok('says "No cutting needed"', cutRow(true).none === 'No cutting needed');
  ok('a lot that is cut still says "none yet"', cutRow(false).none === 'none yet');
  ok('says so even where the cut column is not its way (Job Work)', A.p1HistPassed([], { cut: { na: true } }, true).some(x => x.k === 'CUT' && x.none === 'No cutting needed')); }

console.log('== the Report names those pieces "Cut, in store" ==');
{ const REP = src('FLOW_REPORT', 'flow/flow-report.js');
  const cut = (re, end) => { const i = REP.search(re); if (i < 0) throw new Error(re + ' not found'); return REP.slice(i, REP.indexOf(end, i) + end.length); };
  const ctx = { flowRouteOf: () => 'inhouse', flowPrinted: () => true, flowInHand: () => false, flowFabOwed: () => ({ unit: 'pcs', left: 0 }), Math };
  vm.createContext(ctx);
  vm.runInContext(cut(/^const FLOW_REP_PLACES/m, '];\n') + cut(/^function flowRepWhere\(/m, '\n}') + '\nthis.__w = flowRepWhere;', ctx);
  const where = cutReq => ctx.__w({ qty: 50 }, { cutReq, back: 15, cut: 0, issuedNet: 0, challan: 1 }, {});
  ok('printed on the item itself: back from the printer is "Cut, in store"', where(false).cutStore === 15 && where(false).prnStore === 0, JSON.stringify(where(false)));
  ok('a lot that is cut: still "Printed, in store" until cut', where(true).prnStore === 15 && where(true).cutStore === 0); }

console.log('== Complete counts before its tab is opened ==');
ok('the tab shows the finished lots\' count', /const done = p1DoneRead\(\)\.filter\(/.test(PPC) && /tab\('done', 'Complete', done\.length\)/.test(PPC) && !/P1\.doneN/.test(PPC));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
