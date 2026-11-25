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
const names = ['gpoLineMoney', 'gpoTotals', 'gpoDiscPct', 'poDocBody', 'poMailText', 'poWaText', 'gdSample', 'gdTabFillOf', 'gdTabFillKey'];
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

console.log('== the greige is named as Master data names it (Ravi, 21 Nov) ==');
{
  /* Master data has a spec that used to be turned into "Cambric 60S 48\" Gray Fabric"; the PO must still say the greige name */
  G.setDB({ gpo: [], fab: [], ven: [{ name: 'Test Mill', email: 'mill@example.test' }], co: { name: 'Test Co' }, users: [], me: '',
    mst: [{ rfd: 'Cambric 44', greige: 'Greige Cambric 48', warp: '60', greigeWidth: 48 }] });
  const p = po([line(1000, 44, '')]);
  const paper = text(G.poDocBody(p)), wa = G.poWaText(p);
  ok('the printed PO says "Greige Cambric 48", not a built "Gray Fabric" name', /Greige Cambric 48/.test(paper) && !/Gray Fabric/.test(paper));
  ok('so does the WhatsApp text (the mail itself names no lines; the PO goes with it)', /Greige Cambric 48/.test(wa) && !/Gray Fabric/.test(wa));
  ok('so do the screens: no PO view shows the built name', !code.includes('esc(poDesc(') && code.includes("function lineGreigeText(l) { return String(l.greige || ''); }"));
  ok('the greige name is not shown twice on a PO line', !code.includes("esc(lineGreigeText(l)) + '</b><div class=\"sub\">' + esc(l.greige)"));
}

console.log('== the printed PO ==');
const paper = G.poDocBody(po([line(1000, 44, '2.5')], 'Payment in 30 days.\nGoods as per sample.'));
ok('a Disc % column between Rate and per', /<th>Rate<\/th><th>Disc %<\/th><th>per<\/th>/.test(paper));
ok('the line shows 2.50 % and the amount after it', /2\.50 %/.test(paper) && /42,900\.00/.test(paper));
ok('the total in words is after the discount', /Forty Two Thousand Nine Hundred/i.test(text(paper)));
ok('the terms & conditions are printed, line breaks kept', /Terms &amp; Conditions/.test(paper) && /white-space:pre-line">Payment in 30 days\.\nGoods as per sample\./.test(paper));
ok('every row has the same number of cells (8)', (paper.match(/<colgroup>[\s\S]*?<\/colgroup>/g) || [])[1].split('<col ').length - 1 === 8);
ok('the terms are in the terms box beside the consignee, not in a box of their own under the total (Ravi, 25 Nov)', (paper.match(/Terms &amp; Conditions/g) || []).length === 1 && paper.indexOf('Terms &amp; Conditions') < paper.indexOf('Description of Goods') && !/Terms of Delivery/.test(paper));
ok('the Order Value box carries the amount in figures and in words; the words are not printed again under the total', /Order Value<\/span>[\s\S]*?42,900\.00[\s\S]*?Forty Two Thousand Nine Hundred/i.test(paper) && paper.indexOf('Forty Two Thousand') < paper.indexOf('Description of Goods') && !/Amount Chargeable/.test(paper) && (paper.match(/Forty Two Thousand/gi) || []).length === 1);
ok('no terms typed: the terms box is there, empty', /Terms &amp; Conditions<\/div><div class="val"[^>]*><\/div>/.test(G.poDocBody(po([line(10, 5, '')], ''))));

ok('Other References left empty: no empty box on the paper', !/Other References/.test(paper));
ok('…filled in, it is printed', /Other References<\/div><div class="val"[^>]*>Ref 55</.test(G.poDocBody(Object.assign(po([line(10, 5, '')], ''), { other: 'Ref 55' }))));

console.log('== Tab takes the grey sample (Ravi, 25 Nov) ==');
{
  const box = v => { const at = {}; return { value: v || '', placeholder: '', getAttribute: k => (k in at ? at[k] : null), setAttribute: (k, x) => { at[k] = String(x); }, removeAttribute: k => { delete at[k]; }, dispatchEvent: e => { box.seen = (box.seen || []).concat(e.type); } }; };
  ctx.Event = function (t) { this.type = t; };   // the page's own Event, as far as this needs it
  const sup = box(''); G.gdSample(sup, 'Suresh Textiles', 'Suresh Textiles');
  ok('the supplier box shows the last supplier in grey and Tab would take it', sup.placeholder === 'Suresh Textiles' && G.gdTabFillOf(sup) === 'Suresh Textiles');
  G.gdTabFillKey({ key: 'Tab', shiftKey: false, target: sup });
  ok('Tab in the empty box writes it in, and tells the box (input, change)', sup.value === 'Suresh Textiles' && String(box.seen) === 'input,change', sup.value + ' ' + box.seen);
  const typed = box('Patch'); G.gdSample(typed, 'Suresh Textiles'); G.gdTabFillKey({ key: 'Tab', shiftKey: false, target: typed });
  ok('a box somebody typed in is never touched', typed.value === 'Patch');
  const back = box(''); G.gdSample(back, 'Suresh Textiles'); G.gdTabFillKey({ key: 'Tab', shiftKey: true, target: back });
  ok('Shift + Tab (going back) fills nothing', back.value === '');
  const eg = box(''); G.gdSample(eg, '', '1200'); G.gdTabFillKey({ key: 'Tab', shiftKey: false, target: eg });
  ok('grey text that is only an example ("1200") is not filled', eg.value === '' && eg.placeholder === '1200');
  const due = box(''); G.gdSample(due, 728, '728 still due'); G.gdTabFillKey({ key: 'Tab', shiftKey: false, target: due });
  ok('"728 still due" fills 728', due.value === '728');
  const ro = box(''); ro.readOnly = true; G.gdSample(ro, 'x'); G.gdTabFillKey({ key: 'Tab', shiftKey: false, target: ro });
  ok('a read-only box is left alone', ro.value === '');
}

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
