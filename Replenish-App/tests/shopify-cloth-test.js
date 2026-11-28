/* SHOPIFY BOARD ORDERS GET FREE CLOTH FIRST (28 Nov 2026). Cloth already marked ready or on a challan stays with its line.
 *   node tests/shopify-cloth-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };

const dm = read('flow/flow-demand.js');
const ORDER = cut(dm, 'const flowIsShpOrder', ';\n') + cut(dm, 'const flowClothOrder', '.localeCompare(String(b.orderNo));\n');
const line = (key, orderNo, orderDate, need, o = {}) => ({ r: { orderNo, orderDate }, s: Object.assign({ key, route: 'inhouse', plan: { qty: 1, fabric: { name: 'Sheeting' }, need }, demand: null }, o) });
const cover = rows => {
  const ctx = { flowRows: () => rows, flowFabKey: x => String(x || '').toUpperCase(), flowRfdStock: () => 100, flowInView: (v, s) => !s.demand,
    flowPrinted: () => true, flowFabOwed: (r, s) => ({ metres: s.plan.need }), flowR2: n => Math.round(n * 100) / 100 };
  vm.createContext(ctx); vm.runInContext(ORDER + cut(dm, 'function flowRfdCover(', '\n}\n') + 'this.c = flowRfdCover();', ctx); return ctx.c; };

console.log('== who gets the free cloth ==');
{ const held = line('H', 'AMZ-1', '2026-11-01', 40, { demand: { fabricReady: { what: 'Sheeting', metres: 40 } } });
  const c = cover([held, line('A', 'AMZ-2', '2026-11-10', 60), line('S', 'SHP-9', '2026-11-20', 10)]);
  ok('the newer Shopify order is covered first', c.line.S.short === 0 && c.line.S.avail === 60, JSON.stringify(c.line.S));
  ok('the older Amazon order takes what is left, and is short', c.line.A.avail === 50 && c.line.A.short === 10, JSON.stringify(c.line.A));
  ok('cloth already marked ready stays with its line', c.fab.SHEETING.held === 40); }
{ const c = cover([line('B', 'SHP-2', '2026-11-20', 60), line('A', 'SHP-1', '2026-11-10', 60), line('O', 'ONL-1', '2026-11-01', 60)]);
  ok('among Shopify orders the oldest is first; Online and others come after', c.line.A.short === 0 && c.line.B.short === 20 && c.line.O.short === 60, JSON.stringify(c.line)); }

console.log('== every list that gives cloth out ==');
{ const ctx = {}; vm.createContext(ctx);
  vm.runInContext(ORDER + cut(read('flow/flow-cutpiece.js'), 'const flowPriRank', ';\n') + cut(read('flow/flow-cutpiece.js'), 'function flowPriSort(', '\n}\n')
    + cut(dm, 'const flowShpFirst', ';\n') + 'this.s = (l, of) => flowShpFirst(flowPriSort(l, of), x => x.orderNo); this.p = flowPriSort; this.shp = flowIsShpOrder;', ctx);
  const o = (orderNo, orderDate, priority) => ({ orderNo, orderDate, priority });
  const got = ctx.s([o('AMZ-1', '2026-01-01', 'P1'), o('SHP-2', '2026-02-01', ''), o('SHP-1', '2026-03-01', 'P2')], x => x).map(x => x.orderNo).join();
  ok('on the send cards Shopify is ahead even of a P1; inside Shopify the priority still counts', got === 'SHP-1,SHP-2,AMZ-1', got);
  ok('the priority sort alone is as before: the P1 order first', ctx.p([o('SHP-2', '2026-02-01', ''), o('AMZ-1', '2026-01-01', 'P1')], x => x)[0].orderNo === 'AMZ-1');
  ok('a test copy gets no priority', !ctx.shp('TEST-SHP-AB-01'));
  ok('only SHP- order numbers are Shopify board orders', ctx.shp(' shp-RBP1 ') && !ctx.shp('SPY-1') && !ctx.shp('ONL-1') && !ctx.shp('AMZ-SHP-1') && !ctx.shp('')); }
{ const v = read('flow/flow-view.js'), ch = read('flow/flow-challan.js'), gd = read('flow/greige-desk.js');
  ok('challan by size, the Demand list, bulk challans, the send cards and cutting use the same order',
    /const flowFifoSort = \(a, b\) => flowClothOrder\(a\.x\.r, b\.x\.r\)/.test(v) && /FLOW_VIEW === 'drfd' \? flowClothOrder\(a\.r, b\.r\)/.test(v)
    && /rows: g\.rows\.sort\(\(a, b\) => flowClothOrder\(a\.r, b\.r\)\)/.test(v) && /\.sort\(\(a, b\) => flowClothOrder\(a\.x\.r, b\.x\.r\)\);\n  if \(typeof flowPriSort/.test(ch)
    && /return flowClothOrder\(a\.x\.r, b\.x\.r\); \}\);/.test(gd) && /return flowClothOrder\(a\.ln\.x\.r, b\.ln\.x\.r\); \}\);/.test(gd)
    && /return flowShpFirst\(flowPriSort\(oldest,/.test(ch) && /return flowShpFirst\(flowPriSort\(list,/.test(gd) && /\}\)\.filter\(Boolean\)\.sort\(flowClothOrder\);/.test(dm));
  ok('Shopify lines are marked Priority on Demand → RFD', /flowIsShpOrder\(x\.r\.orderNo\) \? '<span[^']*>Priority<\/span>/.test(v)); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
