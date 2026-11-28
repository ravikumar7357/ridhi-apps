/* MORE THAN IS NEEDED (28 Nov 2026, order-to-shipping test): 9 of 8 was accepted by shipping as 8, 10 embroidered pieces came in
 * on a challan of 3, 5,00,000 m of waste was taken and a ship date a year back was saved. Each is now refused with a pop-up.
 *   node tests/too-much-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };

(async () => {
  console.log('== shipping accept ==');
  { const run = async items => { const seen = { saved: null, popped: '' };
      const lines = [{ orderNo: 'SHP-1', sku: 'A', qty: 8 }, { orderNo: 'SHP-1', sku: 'B', qty: 2 }];
      const ctx = { shpCanReceive: () => true, ordLines: () => lines, obUC: x => String(x).toUpperCase(), spKey: (o, s) => o + '|' + s, spOf: () => null,
        ME: {}, PTG: {}, ORD_IX: {}, ptPatch: async u => { seen.saved = u; }, wpRefuse: t => { seen.popped = t; return t; } };
      vm.createContext(ctx); vm.runInContext(cut(read('orders/production-to-shipping.js'), 'async function shpReceive(', '\n}\n') + 'this.f = shpReceive;', ctx);
      seen.err = await ctx.f(items.map(([sku, qty]) => ({ orderNo: 'SHP-1', sku, qty }))); return seen; };
    const over = await run([['A', 9]]);
    ok('9 of 8 saves nothing and says why', !over.saved && /9 typed, 8 still to come/.test(over.err) && over.popped === over.err, JSON.stringify(over));
    ok('one wrong line stops the whole save', !(await run([['B', 2], ['A', 9]])).saved);
    ok('2.5 pieces are not saved as 3', !(await run([['A', 2.5]])).saved);
    const good = await run([['A', 8]]);
    ok('exactly what is owed saves', good.err === '' && good.saved['pt_shopProd/SHP-1|A'].handedQty === 8, JSON.stringify(good));
    ok('the shipping board\'s own box refuses too, instead of cutting the figure down',
      /if \(q > s\.handW\) return wpRefuse\(/.test(read('orders/shp-board.js')) && !/Math\.min\(s\.handW, Math\.round/.test(read('orders/shp-board.js'))); }

  console.log('== embroidery ==');
  { const src = read('flow/flow-emb.js'), ctx = {}; vm.createContext(ctx);
    vm.runInContext(cut(src, 'const flowEmbTooMany', ';\n') + 'this.f = flowEmbTooMany;', ctx);
    ok('10 on 3 is named, 3 on 3 passes', /A: 10 pieces typed, at most 3/.test(ctx.f([{ sku: 'A', typed: 10, most: 3 }])) && ctx.f([{ sku: 'A', typed: 3, most: 3 }]) === '');
    ok('both the challan and the receipt ask before saving', /if \(tooMany\) return wpRefuse\(tooMany\);[\s\S]*flowClaim\([\s\S]*if \(tooMany\) return wpRefuse\(tooMany\);[\s\S]*ptPatch\(patch\)/.test(src)); }

  { const src = read('flow/flow-emb.js');
    const ctx = { FLOW: { emb: { open: { lines: [{ key: 'k', pcs: 4 }], receipts: { r: { items: { k: 1 } } } }, shut: { closed: {}, lines: [{ key: 'k', pcs: 9 }] }, gone: { cancelled: {}, lines: [{ key: 'k', pcs: 9 }] } } } };
    vm.createContext(ctx); vm.runInContext(cut(src, 'function flowEmbRecv(', '\n}\n') + cut(src, 'function flowEmbPcsLeft(', '\n}\n') + 'this.f = flowEmbPcsLeft;', ctx);
    const some = ctx.f({ r: { qty: 10 }, s: { key: 'k', embBack: 1, embOk: 1 } });
    ok('a line of 10 with 3 still out may send 6 once 1 has passed', some === 6, some);
    ctx.FLOW.emb = {};
    ok('pieces rejected at QC may be sent again', ctx.f({ r: { qty: 10 }, s: { key: 'k', embBack: 10, embOk: 8 } }) === 2);
    ok('a challan of 0 pieces is not made', /if \(noPc\.length\) return/.test(src)); }

  console.log('== cutting waste ==');
  { const src = read('core/look-alike-skus.js'), ctx = {}; vm.createContext(ctx);
    vm.runInContext(cut(src, 'const cutWasteWhy', '\n};\n') + 'this.f = cutWasteWhy;', ctx);
    ok('waste above the cloth used is refused', /cannot be more than the cloth used/.test(ctx.f('99', '500000')));
    ok('waste within it, or no waste, passes', ctx.f('99', '5') === '' && ctx.f('99', '99') === '' && ctx.f('', '') === '' && ctx.f('', '0') === '' && ctx.f('99', '') === '');
    ok('waste with no cloth used is refused', /Type the cloth used/.test(ctx.f('', '500000')));
    ok('Cutting Data checks it before saving', /if \(wasteWhy\) return cutFormMsg\(wpRefuse\(wasteWhy\), true\);[\s\S]*cutWrite\(entry\)/.test(src)); }

  console.log('== cloth above the need ==');
  { const ctx = {}; vm.createContext(ctx);
    vm.runInContext(cut(read('core/helpers.js'), 'const PT_CLOTH_EXTRA', '\n}\n') + 'this.f = ptClothOver;', ctx);
    ok('5,000 m for a 5.2 m need is refused and the most is named', /at most 5\.72 m/.test(ctx.f(5000, 5.2, 'A')));
    ok('up to a tenth more passes; more does not', ctx.f(110, 100, 'A') === '' && ctx.f(111, 100, 'A') !== '');
    ok('with no worked-out need nothing is refused', ctx.f(500, 0, 'A') === '' && ctx.f('', 100, 'A') === '');
    const src = read('flow/flow-challan.js'), c2 = { flowRows: () => [{ r: {}, s: { key: 'k' } }], flowFabOwed: () => ({ unit: 'm', metres: 10, left: 10 }),
      flowShLine: () => ({ perPc: 2 }), ptClothOver: ctx.f, console };
    vm.createContext(c2); vm.runInContext(cut(src, 'function flowClothOver(', '\n}\n') + 'this.f = flowClothOver;', c2);
    ok('a challan line is judged against the larger of the plan and the master', c2.f([{ key: 'k', sku: 'A', pcs: 10, metres: 22 }]) === '' && c2.f([{ key: 'k', sku: 'A', pcs: 10, metres: 23 }]) !== '');
    ok('ruffle and cut-to-size lines are not judged', c2.f([{ key: 'k', ruffleOnly: true, metres: 999 }, { key: 'k', cutSize: 'x', metres: 999 }]) === '');
    ok('every challan is checked before its number is claimed, and Cutting before it saves',
      /return wpRefuse\(tooMuch\);[\s\S]*flowClaim\('pt_flowChallans\/' \+ no, ch\)/.test(src.slice(src.indexOf('async function flowChallanWrite('))) && /return cutFormMsg\(wpRefuse\(clothWhy\), true\);[\s\S]*cutWrite\(entry\)/.test(read('core/look-alike-skus.js'))); }

  console.log('== FBA ship date ==');
  { const src = read('inventory/fba-ship-excel.js');
    ok('the date rule runs before anything is written; an admin may enter an older day',
      /ptDateErr\(v\('fbsDate'\), 'Ship date', ME\.admin \? 'fixed' : 'done'\)[\s\S]*return wpRefuse\(dateWhy\)[\s\S]*await ptPatch\(updates\)/.test(src)); }

  { const src = read('inventory/fba-ship-excel.js');
    const run = async admin => { const seen = { saved: 0, kind: '' };
      const ctx = { fbaCan: () => true, fgiRowId: r => r.id, fbaFresh: async () => [{ id: 'a', row: {} }], fbaState: () => ({ st: 'waiting', open: 1 }), ME: { admin }, ptIsoDate: d => d, fgiDmy: d => d, dToday: () => 'now',
        ptDateErr: (d, l, kind) => { seen.kind = kind; return kind === 'done' ? l + ' too old' : ''; }, wpRefuse: x => x, ptPatch: async () => { seen.saved++; }, fbaForget() {}, renderFba() {}, FBA_PILL: {}, fbaSkipText: () => '', nf: String, $: () => ({}) };
      vm.createContext(ctx); vm.runInContext(cut(src, 'async function fbaShipXlRun(', '\n}\n') + 'this.f = fbaShipXlRun;', ctx);
      seen.err = await ctx.f({ items: [{ picks: [{ id: 'a' }], e: { row: 2, date: '2025-01-01', shipment: 'S' } }] }); return seen; };
    const staff = await run(false), admin = await run(true);
    ok('a shipment file with an old date saves nothing for staff', staff.saved === 0 && /Row 2 ship date too old/.test(staff.err), JSON.stringify(staff));
    ok('an admin may ship an older day from a file', admin.saved === 1 && admin.err === '' && admin.kind === 'fixed', JSON.stringify(admin)); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
