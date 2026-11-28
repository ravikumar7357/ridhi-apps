/* AN OPENED ORDER NEVER CARRIES AN IMPOSSIBLE DATE (28 Nov 2026: 11 orders dated 2026-25-10).
 *   node tests/order-day-test.js      (APP_DIR / SHARED_DIR=<a broken or older copy> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const SHARED = process.env.SHARED_DIR ? path.resolve(process.env.SHARED_DIR) : path.join(__dirname, '..', '..', 'shared');
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };

const said = [], ctx = { soStoreDay: () => '2026-11-28', console: { warn: t => said.push(t) } };
vm.createContext(ctx);
const src = read(APP, 'shopify/orders-to-make.js');
vm.runInContext(cut(read(SHARED, 'imported-orders.js'), 'function soImpDate(', '\n}\n') + cut(src, 'function shpOrderDay(', '\n}\n') + 'this.f = shpOrderDay;', ctx);
const day = at => ctx.f({ no: '42', at });
ok('2026-25-10 is read as 25 October, and it is said', day('2026-25-10') === '2026-10-25' && /"2026-25-10" read as 2026-10-25/.test(said[0] || ''), day('2026-25-10'));
said.length = 0;
ok('a good date, with or without a time, is kept and nothing is said', day('2026-10-25') === '2026-10-25' && day('2026-10-25T10:00:00+05:30') === '2026-10-25' && !said.length);
ok('no date, or no date at all, becomes today', day('') === '2026-11-28' && day(undefined) === '2026-11-28' && day('2026-45-45') === '2026-11-28' && day('2026-02-31') === '2026-11-28', day('2026-02-31'));
ok('the order is dated with it', /\n  const date = shpOrderDay\(o\);\n/.test(src) && !/const date = String\(o\.at/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
