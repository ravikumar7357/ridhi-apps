/* THE BUYER UNDER THE ORDER NUMBER ON THE SHP / AMZ / B2B / SPY BOARD (Ravi, 21 Nov: "add the buyer's name below the order
 * number so that we can easily identify whose order it is").
 *   node tests/shp-buyer-test.js
 * The real shpbOrderLink (src/app/orders/shp-board.js) and ordBuyerOf (src/app/orders/order-console-table.js) are cut out
 * of the source and run against a made-up order book and sales orders. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', ...f.split('/')), 'utf8').replace(/\r\n/g, '\n');
const BOARD = rd('orders/shp-board.js'), CONSOLE = rd('orders/order-console-table.js');
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const PARTS = [line(CONSOLE, 'let ORD_BUYER_IX ='), cut(CONSOLE, 'ordBuyerOf'), cut(BOARD, 'shpbOrderLink')].join('\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* A board with a made-up order book (PTG.ob) and sales orders (SOX.rows). */
function makeBoard({ ob = [], so = [] } = {}) {
  const env = { PTG: { ob }, SOX: { rows: so } };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
  return new Function('PTG', 'SOX', 'esc', 'obUC', PARTS + '\nreturn { shpbOrderLink, ordBuyerOf };')(env.PTG, env.SOX, esc, obUC);
}
const bookLine = (orderNo, brand, sku = 'RTC616-6060') => ({ orderNo, brand, sku });
const buyerShown = html => { const m = html.match(/<\/a><div[^>]*>([^<]*)<\/div>$/); return m ? m[1] : ''; };

/* the buyer shows under the number */
{
  const B = makeBoard({ ob: [bookLine('B2B-24102026-01', 'Insa'), bookLine('B2B-24102026-01', 'Insa', 'RTR204-1690')] });
  const html = B.shpbOrderLink({ orderNo: 'B2B-24102026-01' });
  ok('a B2B order shows its buyer under the order number', buyerShown(html) === 'Insa', html);
  ok('the order number itself is unchanged and still opens the order', html.startsWith('<a href="#" data-ordj="B2B-24102026-01"') && html.includes('>B2B-24102026-01</a>'));
  ok('the same buyer on many lines of one order is shown once', buyerShown(html) === 'Insa');
}
{
  const B = makeBoard({ so: [{ _id: 'B2B-23102026-01', buyerName: 'ravi', lines: { a: { brand: 'Kymberly' } } }] });
  ok('no order-book line yet: the buyer comes from the sales order lines (not who raised it)', buyerShown(B.shpbOrderLink({ orderNo: 'B2B-23102026-01' })) === 'Kymberly');
}
{
  const B = makeBoard({ ob: [bookLine('B2B-1', 'Insa'), bookLine('B2B-1', 'Kymberly'), bookLine('B2B-1', 'Third'), bookLine('B2B-1', 'Fourth')] });
  ok('several buyers on one order: the first two and "+ how many more"', buyerShown(B.shpbOrderLink({ orderNo: 'B2B-1' })) === 'Insa / Kymberly +2');
}

/* nothing under the number when there is no buyer */
{
  const B = makeBoard({ ob: [bookLine('SHP-1001', 'Fabricrush'), bookLine('B2B-9', '')] });
  const shp = B.shpbOrderLink({ orderNo: 'SHP-1001', shopOrderNo: '#1001' });
  ok('a Shopify order shows no buyer line (only B2B orders have a buyer)', !shp.includes('<div') && shp.includes('>1001</a>'), shp);
  ok('a B2B order with no brand typed shows no empty buyer line', !B.shpbOrderLink({ orderNo: 'B2B-9' }).includes('<div'));
  ok('a B2B order not in the book or sales orders shows no buyer line', !B.shpbOrderLink({ orderNo: 'B2B-404' }).includes('<div'));
}

/* the buyer is shown as text, never as page code */
{
  const B = makeBoard({ ob: [bookLine('B2B-7', '<img src=x onerror=alert(1)>')] });
  const html = B.shpbOrderLink({ orderNo: 'B2B-7' });
  ok('a buyer name with page code in it is shown as plain text', !html.includes('<img') && html.includes('&lt;img'), html);
}

/* both board tabs use it */
ok('the pending lines and the Complete tab both show the order through shpbOrderLink',
  (BOARD.match(/[+{] ?shpbOrderLink\(r\)/g) || []).length === 3 && !/const link = r =>/.test(BOARD));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
