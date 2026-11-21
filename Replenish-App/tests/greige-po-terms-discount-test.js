/* A GREIGE PO'S DISCOUNT AND TERMS & CONDITIONS (Ravi, 21 Nov: "add a terms and condition box … and also the discount box").
 *   - a discount per line, as a percent; the line amount and the PO total are after it, to the paisa
 *   - the printed PO has Rate, Disc %, Amount columns and the terms & conditions above the signature
 *   - the mail carries the terms; the WhatsApp text says "less x%"
 *   - a new PO starts with the standard terms from the PO settings (the app's "Default terms")
 * Loads the real src/app/flow/greige-desk.js. Made-up mills and POs only.
 *   node tests/greige-po-terms-discount-test.js
 *   GD_FILE=<a broken copy> node tests/greige-po-terms-discount-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

const code = fs.readFileSync(SRC, 'utf8');
const anchor = '  return { open: open,';
if (code.split(anchor).length !== 2) throw new Error('greige-desk.js: the closing "return { open" line moved; update this test');
const names = ['gpoLineMoney', 'gpoTotals', 'gpoDiscPct', 'poDocBody', 'poMailText', 'poWaText'];
const ctx = { console, window: { document: {} }, GPO: { settings: { terms: 'Payment in 30 days.\nGoods as per sample.' } } };
vm.createContext(ctx);
vm.runInContext(code.replace(anchor, '  globalThis.__GDT = { ' + names.map(n => n + ': ' + n).join(', ') + ', setDB: function (v) { DB = v; } };\n' + anchor), ctx);
const G = ctx.__GDT;
const text = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ---- the business, in its own words ---- */
const line = (metres, rate, disc) => ({ greige: 'Greige Cambric 48', rfd: 'Cambric 44', metres: metres, rate: rate, disc: disc, due: '2026-12-01' });
const po = (lines, tc) => ({ id: 'p1', poNo: 'RIDHI/PO/GREIG/101', date: '2026-11-21', mill: 'Test Mill', lines: lines, tc: tc });
G.setDB({ gpo: [], fab: [], mst: [], ven: [{ name: 'Test Mill', email: 'mill@example.test' }], co: { name: 'Test Co', terms: 'Payment in 30 days.' }, users: [], me: '' });

console.log('== the discount, line by line ==');
ok('no discount: metres × rate', G.gpoLineMoney(line(1000, 44, '')).amount === 44000);
ok('2.5% off 1,000 m at ₹44: ₹1,100 off, ₹42,900', (m => m.disc === 1100 && m.amount === 42900)(G.gpoLineMoney(line(1000, 44, '2.5'))));
ok('to the paisa: 333 m at ₹33.33 less 1.5% = ₹10,932.41', G.gpoLineMoney(line(333, 33.33, '1.5')).amount === 10932.41, G.gpoLineMoney(line(333, 33.33, '1.5')).amount);
ok('no drift: 1 m at ₹0.30 less 33.33% is exactly ₹0.20 (not 0.19999…)', G.gpoLineMoney(line(1, 0.3, '33.33')).amount === 0.2, G.gpoLineMoney(line(1, 0.3, '33.33')).amount);
ok('100% off is nothing to pay', G.gpoLineMoney(line(500, 40, '100')).amount === 0);
ok('a discount over 100 counts as 100, below 0 as 0 (the save refuses both)', G.gpoDiscPct({ disc: '150' }) === 100 && G.gpoDiscPct({ disc: '-5' }) === 0);
ok('an old PO line with no discount field is full price', G.gpoLineMoney({ metres: 10, rate: 5 }).amount === 50);
const two = po([line(1000, 44, '2.5'), line(500, 60, '')]);
ok('the PO total is the lines after their discounts', G.gpoTotals(two).amount === 42900 + 30000 && G.gpoTotals(two).disc === 1100);

console.log('== the printed PO ==');
const paper = G.poDocBody(po([line(1000, 44, '2.5')], 'Payment in 30 days.\nGoods as per sample.'));
ok('a Disc % column between Rate and per', /<th>Rate<\/th><th>Disc %<\/th><th>per<\/th>/.test(paper));
ok('the line shows 2.50 % and the amount after it', /2\.50 %/.test(paper) && /42,900\.00/.test(paper));
ok('the total in words is after the discount', /Forty Two Thousand Nine Hundred/i.test(text(paper)));
ok('the terms & conditions are printed, line breaks kept', /Terms &amp; Conditions/.test(paper) && /white-space:pre-line">Payment in 30 days\.\nGoods as per sample\./.test(paper));
ok('every row has the same number of cells (8)', (paper.match(/<colgroup>[\s\S]*?<\/colgroup>/g) || [])[1].split('<col ').length - 1 === 8);
ok('no terms typed: no empty terms block', !/Terms &amp; Conditions/.test(G.poDocBody(po([line(10, 5, '')], ''))));

console.log('== the mail and WhatsApp ==');
const mail = G.poMailText(po([line(1000, 44, '2.5')], 'Payment in 30 days.')).body;
ok('the mail carries the terms & conditions', /Terms & conditions:\nPayment in 30 days\./.test(mail));
ok('…and the total after discount', /₹ 42,900\.00/.test(mail));
ok('no terms: the mail does not mention them', !/Terms & conditions/.test(G.poMailText(po([line(10, 5, '')], '')).body));
ok('WhatsApp says "less 2.50%" on the discounted line', /@ ₹44\.00 less 2\.50%/.test(G.poWaText(po([line(1000, 44, '2.5')], ''))));

console.log('== a new PO starts with the standard terms ==');
ok('the new PO draft takes the standard terms from the company (PO settings)', /tc: \(DB\.co \|\| \{\}\)\.terms \|\| ''/.test(code));
ok('the app\'s PO settings "Default terms" become the company\'s standard terms', /terms: s\.terms \|\| \(DB\.co \|\| \{\}\)\.terms \|\| ''/.test(code));
ok('the box is optional (nothing refuses an empty one)', /Terms &amp; conditions \(optional\)/.test(code) && !/Fill in the terms/.test(code));
ok('a supplement PO keeps its PO\'s terms and the line\'s discount', /tc: po\.tc \|\| ''/.test(code) && /rate: pl\.rate, disc: pl\.disc/.test(code));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
