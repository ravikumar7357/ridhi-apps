/* THE NUMBER AND DATE RULES ON SALES ORDERS (Ravi, 27 Nov 2026: a draft saved with order date 0008, delivery 2099 and 2.5
 * pieces). Pins soEntryErr / soBigAsk and that save, approval and Change quantity ask them, for everybody since 28 Nov, with
 * the checks added that day: half-filled lines, sale month, taking off, the same line twice, and the upload file's cells.
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
console.log('== asked of everybody (28 Nov) ==');
ok('save', /\n  const entryErr = soEntryErr\([\s\S]*?\|\| soSaleMonthErr\([\s\S]*?\|\| soTakeErr\(lines, existing && existing\._id\);\n  if \(entryErr\) return entryErr;\n  const ask = \[soBigAsk\(lines\), soTwiceAsk\(lines\)\][\s\S]*?await ptPut\(/.test(SO));
ok('no half-filled line is dropped: asked before the lines are filtered', /const halfDone = soHalfLineErr\(SOF\.lines, b2b, existing\);\n  if \(halfDone\) return halfDone;\n  const lines = SOF\.lines\.map/.test(SO));
ok('Change quantity', /\n  const big = ptNumBig\(plan\.to, plan\.sku, 'pcs'\);\n  if \(big && !confirm\(big\)\) return/.test(SO));
ok('approval', /\n    const dateErr = ptDateErr\(d, 'Delivery date', 'plan', o\.deliveryDate\);\n    if \(dateErr\) return dateErr;/.test(SO));
ok('a placed order stays placed on Save', /const keepPlaced = !place && existing &&/.test(SO));
console.log('== half-filled lines, sale month, taking off, twice ==');
{ const one = re => { const i = SO.search(re); return SO.slice(i, SO.indexOf(';\n', i) + 2); };
  const c2 = { obUC: ctx.obUC, soLines: ctx.soLines, nf: v => Number(v).toLocaleString('en-US'),
    SOX: { rows: [{ _id: 'X', status: 'approved', lines: [{ sku: 'A', qty: -10 }] }, { _id: 'Y', status: 'approved', lines: [{ sku: 'A', qty: 15 }] }] },
    spBulkDate: v => (String(v) === '46356' ? '2026-11-30' : '') };
  vm.createContext(c2);
  vm.runInContext([/^function soCurrentNetQty\(/m, /^function soFilePriority\(/m, /^function soHalfLineErr\(/m, /^function soSaleMonthErr\(/m, /^function soTakeErr\(/m, /^function soTwiceAsk\(/m, /^function soParseDMY\(/m].map(cut).join('\n') + '\n'
    + cut(/^function soFileQty\(/m) + '\n' + one(/^const soFileDate/m) + 'this.t = { soCurrentNetQty, soFilePriority, soFileDate, soHalfLineErr, soSaleMonthErr, soTakeErr, soTwiceAsk, soFileQty, soParseDMY };', c2);
  const T = c2.t, good = { sku: 'A', qty: '5' };
  ok('a SKU with no quantity, and 0, are named', /Line 2 \(B\): type a quantity/.test(T.soHalfLineErr([good, { sku: 'B', qty: '' }])) && /Line 2 \(B\)/.test(T.soHalfLineErr([good, { sku: 'B', qty: '0' }])));
  ok('a quantity with no SKU is named', /Line 2: the quantity 50 has no SKU/.test(T.soHalfLineErr([good, { sku: '', qty: '50' }])));
  ok('empty rows, minus lines and a B2B name line pass', T.soHalfLineErr([good, { sku: '', qty: '' }, { sku: 'A', qty: '-2' }]) === '' && T.soHalfLineErr([{ sku: '', itemName: 'Mat', qty: '3' }], true) === '');
  ok('a sale month before the order month is refused', /Sale month 01-2026 is before/.test(T.soSaleMonthErr('2026-01', '2026-11-28')));
  ok('the same month, a later one, none, and one already saved pass', ['2026-11', '2027-02', ''].every(m => T.soSaleMonthErr(m, '2026-11-28') === '') && T.soSaleMonthErr('2026-01', '2026-11-28', { saleMonth: '2026-01' }) === '');
  const minus = (...q) => q.map(n => ({ sku: 'A', qty: n, orderTypeKey: 'regular' }));
  ok('no more than is on approved orders may be taken off, over all lines', /only 5 are on/.test(T.soTakeErr(minus(-999999))) && /999,999 pieces/.test(T.soTakeErr(minus(-999999))) && /6 pieces cannot/.test(T.soTakeErr(minus(-3, -3))) && T.soTakeErr(minus(-3, -2)) === '');
  ok('an approved minus order saved again does not count itself', T.soTakeErr(minus(-10), 'X') === '' && T.soTakeErr(minus(-10)) !== '');
  ok('a 0 the order already holds passes; a new 0 and a blank do not', T.soHalfLineErr([{ sku: 'A', qty: 0 }], false, { lines: [{ sku: 'A', qty: 0 }] }) === ''
    && T.soHalfLineErr([{ sku: 'B', qty: '0' }], false, { lines: [{ sku: 'A', qty: 0 }] }) !== '' && T.soHalfLineErr([{ sku: 'A', qty: '' }], false, { lines: [{ sku: 'A', qty: 0 }] }) !== '');
  ok('a B2B name line with a minus is named, not dropped', /quantity to make/.test(T.soHalfLineErr([{ sku: '', itemName: 'Mat', qty: '-3' }], true)));
  ok('an Excel day count is read as its date', T.soFileDate('46356') === '2026-11-30' && T.soFileDate('30-11-2026') === '2026-11-30' && T.soFileDate('46') === null);
  ok('the same SKU twice asks; another delivery date does not', /Save both lines/.test(T.soTwiceAsk([{ sku: 'A' }, { sku: 'A' }])) && T.soTwiceAsk([{ sku: 'A', deliveryDate: '1' }, { sku: 'A', deliveryDate: '2' }]) === '');
  console.log('== the file ==');
  ok('1,000 and 1,00,000 are read whole', T.soFileQty('1,000') === 1000 && T.soFileQty('1,00,000') === 100000 && T.soFileQty('-25') === -25 && T.soFileQty('') === 0);
  ok('100abc, 1-000, 2.5, 1e3 and 1,00 are refused', ['100abc', '1-000', '2.5', '1e3', '1,00'].every(v => T.soFileQty(v) === null));
  ok('an impossible date is refused in either order', T.soParseDMY('2026-13-45') === null && T.soParseDMY('2026-02-31') === null && T.soParseDMY('2026-02-28') === '2026-02-28' && T.soParseDMY('28-02-2026') === '2026-02-28');
  ok('priority is blank or P1 to P4', T.soFilePriority('p2') === 'P2' && T.soFilePriority('') === '' && T.soFilePriority('P9') === null);
  ok('a wrong priority refuses the file', /if \(pr === null\) \{ errors\.push\(/.test(SO)); }
ok('the B2B line details box', read('SD_FILE', 'orders/sales-orders.js').includes("const dateErr = lineHoldOn() && moved.some(f => f.k === 'deliveryDate') ? ptDateErr(want.deliveryDate, obUC(sku) + ' · Delivery date', 'plan', was.deliveryDate) : '';"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
