/* WRONG FIGURES AND WORDS ON SCREENS (28 Nov 2026, order-to-shipping test).
 *   node tests/screen-figures-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };
const load = (ctx, code) => { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };

console.log('== Sales Orders counts Made as the console does ==');
{ const w = load({ PT: { cut: [] }, PTG: { press: [] }, obUC: x => String(x).toUpperCase(), ordLines: () => [{ orderNo: 'amz-1', sku: 'a', pressed: 3 }] },
    cut(read('orders/sales-orders.js'), 'function soWork(', '\n}\n') + 'this.w = soWork();').w;
  ok('a QC pass with no press entry shows as made', w.press.get('AMZ-1|A') === 3, String(w.press.get('AMZ-1|A'))); }

console.log('== an outside maker ==');
{ const t = load({ p1N: String }, cut(read('core/ppc-one.js'), 'const p1Pr = ', ';\n') + cut(read('core/ppc-one.js'), 'function p1Outside(', '\n}\n') + 'this.f = p1Outside;').f;
  const line = (bucket, qty, india, name) => ({ r: { qty }, s: { bucket, india, plan: { outVendor: name } } });
  ok('the status names the maker and what is still to come', t([line('out', 6, 2, 'Ravi Works')]) === 'With Ravi Works · 4 to come', t([line('out', 6, 2, 'Ravi Works')]));
  ok('the maker is read where PPC saves it, as a name or a vendor', /outVendor/.test(read('flow/flow-ppc.js')) && t([line('out', 1, 0, { name: 'V Co' })]) === 'With V Co · 1 to come');
  ok('other lines say nothing', t([line('wip', 6, 0, 'x')]) === '' && t([]) === '');
  const src = read('core/ppc-one.js');
  ok('both PPC rows use it', /status\(r\.at, r\.due, r\.over, p1Outside\(r\.lines\)\)/.test(src) && /status\(l\.at, l\.due, od, p1Outside\(\[l\.x\]\)\)/.test(src)); }

console.log('== words ==');
ok('pieces back from the karigar are "waiting for QC"', /nf\(r\.madeToPress\) \+ ' waiting for QC</.test(read('orders/order-console-table.js')) && !/'to press'/.test(read('orders/production-to-shipping.js'))
  && /Made, waiting for QC/.test(read('orders/vendor-holdings.js')));
{ const src = read('flow/flow-challan.js');
  const w = load({ nf: String, flowFabKey: x => x }, cut(src, 'function flowChShortTxt(', '\n}\n') + 'this.f = flowChShortTxt;').f, cv = { fab: { C: { stock: 10 } } };
  ok('with nothing taken first it is simply short', w({ name: 'C', avail: 10, short: 5 }, cv) === 'short 5 m' && w({ name: 'C', avail: 0, short: 5 }, { fab: {} }) === 'short 5 m');
  ok('after an older line took cloth it says so, and the table uses it', w({ name: 'C', avail: 4, short: 5 }, cv) === 'short 5 m after orders ahead of it' && /\$\{flowChShortTxt\(c, cv\)\}<\/span>/.test(src)); }
{ const p = read('replenishment/pack-scan.js');
  ok('the scanner says "no free stock" when stock is the reason', /r\.store \? "Not counted — no free stock for it"/.test(p) && /PKS\.bad\.store \? "Not counted — no free stock"/.test(p) && !/only \$\{r\.n\} of \$\{PKS\.per\}: the orders want no more/.test(p)); }

console.log('== Shipping to accept ==');
{ const src = read('orders/shp-board.js');
  const list = cut(src, "let list = SHPB.tab === 'done'", ';\n');
  const run = done => load({ SHPB: { tab: 'done' }, stg: ['hand', '', '', 'handW'], done, pend: [], sOf: r => r }, list.replace('let list', 'var list')).list;
  ok('a closed line is not listed as waiting', run([{ open: true, handW: 1 }, { open: false, handW: 5 }]).length === 1);
  ok('nor counted on the tile', /const src = x\[0\] === 'hand' \? done\.filter\(r => r\.open\) : pend,/.test(src)); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
