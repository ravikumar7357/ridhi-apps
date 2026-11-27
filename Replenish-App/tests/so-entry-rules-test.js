/* THE NUMBER AND DATE RULES ON SALES ORDERS (Ravi, 27 Nov 2026: a draft saved with order date 0008, delivery 2099 and 2.5
 * pieces). Pins soEntryErr / soBigAsk and that save, approval and Change quantity ask them behind switch lineHold.
 *   node tests/so-entry-rules-test.js      (SO_FILE=<a broken copy> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const read = (env, rel) => fs.readFileSync(process.env[env] ? path.resolve(process.env[env]) : path.join(APP, rel), 'utf8').replace(/\r\n/g, '\n');
const SO = read('SO_FILE', 'orders/raise-sales-order.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = re => { const i = SO.search(re); if (i < 0) throw new Error(re + ' not found'); return SO.slice(i, SO.indexOf('\n}', i) + 2); };

const NOW = Date.UTC(2026, 10, 27, 4, 30), Real = Date;
const ctx = { console, Date: class extends Real { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
  obUC: s => String(s == null ? '' : s).trim().toUpperCase(), soLines: o => (o && o.lines) || [] };
vm.createContext(ctx);
vm.runInContext(read('HELPERS_FILE', 'core/helpers.js') + '\n' + cut(/^function soEntryErr\(/m) + '\n' + cut(/^function soBigAsk\(/m) + '\nthis.__t = { soEntryErr, soBigAsk };', ctx);
const { soEntryErr: err, soBigAsk: big } = ctx.__t;
const L = (qty, deliveryDate) => ({ sku: 'CPC-01', qty, deliveryDate: deliveryDate || '' });

console.log('== the draft the Test page took ==');
ok('order date 0008 is refused', /Order date 03-11-0008 is more than 60 days back/.test(err([L('5')], null, '0008-11-03', '')));
ok('delivery in 2099 is refused', /Delivery date 01-01-2099 is more than a year ahead/.test(err([L('5')], null, '2026-11-27', '2099-01-01')));
ok('2.5 pieces is refused, naming the SKU', /CPC-01 · Quantity must be whole pieces — you typed 2\.5/.test(err([L('2.5')], null, '2026-11-27', '')));
ok('a good order passes', err([L('25', '2026-12-10'), L('')], null, '2026-11-27', '2026-12-10') === '');
console.log('== lines ==');
ok('a minus line (takes from an order) is allowed, a minus part piece is not', err([L('-10')], null, '2026-11-27', '') === '' && /whole pieces/.test(err([L('-1.5')], null, '2026-11-27', '')));
ok('a line delivery date in the past is refused', /CPC-01 · Delivery date 01-11-2026 is before today/.test(err([L('5', '2026-11-01')], null, '2026-11-27', '')));
console.log('== an order being edited keeps the dates it had ==');
const old = { orderDate: '2026-08-01', deliveryDate: '2026-09-01', lines: [L(5, '2026-09-15')] };
ok('its old order and delivery dates pass', err([L('6', '2026-09-15')], old, '2026-08-01', '2026-09-01') === '');
ok('a changed one is checked', /before today/.test(err([L('6', '2026-09-20')], old, '2026-08-01', '2026-09-01')) && /60 days back/.test(err([L('6')], old, '2026-08-02', '')));
console.log('== big quantities ==');
ok('1,500 is not asked about; 1,600 is', big([{ sku: 'A', qty: 1500 }]) === '' && /A: 1,600 pcs is more than 1,500 pcs/.test(big([{ sku: 'A', qty: 1600 }])));
ok('one question for the whole order', /1 more line/.test(big([{ sku: 'A', qty: 1600 }, { sku: 'B', qty: -2000 }])));
console.log('== asked behind switch lineHold ==');
ok('save', /if \(lineHoldOn\(\)\) \{\n    const entryErr = soEntryErr\(SOF\.lines, existing, orderDate, \$\('sof_delivery'\)\.value \|\| ''\);\n    if \(entryErr\) return entryErr;\n    const big = soBigAsk\(lines\);\n    if \(big && !confirm\(big\)\) return/.test(SO));
ok('Change quantity', /const big = lineHoldOn\(\) \? ptNumBig\(plan\.to, plan\.sku, 'pcs'\) : '';\n  if \(big && !confirm\(big\)\) return/.test(SO));
ok('approval', /const dateErr = lineHoldOn\(\) \? ptDateErr\(d, 'Delivery date', 'plan', o\.deliveryDate\) : '';\n    if \(dateErr\) return dateErr;/.test(SO));
ok('the B2B line details box', read('SD_FILE', 'orders/sales-orders.js').includes("const dateErr = lineHoldOn() && moved.some(f => f.k === 'deliveryDate') ? ptDateErr(want.deliveryDate, obUC(sku) + ' · Delivery date', 'plan', was.deliveryDate) : '';"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
