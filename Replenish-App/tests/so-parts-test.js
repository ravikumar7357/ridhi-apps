/* SALES ORDERS PAGE PARTS — the screen's use of core/page-parts.js (Ravi, 24 Nov 2026).
 *   node tests/so-parts-test.js            (SO_SRC_DIR=<folder> to test another copy of src/app/orders; the teeth suite does)
 * What must hold: with nothing hidden everything behaves as today; a hidden column leaves the header AND every row cell
 * (same count, so the table never slants); a hidden tile, filter, row button and the "Sent back by PPC" card carry their
 * mark; a hidden filter never narrows the list; the export leaves out hidden columns; a pop-up that is off refuses to open
 * (order, change quantity, Review, form, deletion requests, quantity confirm) and says so; the shared Save / second /
 * Delete buttons of a pop-up are taken off when their part is off. */
const fs = require('fs'), path = require('path');
const ORDERS = process.env.SO_SRC_DIR || path.join(__dirname, '..', 'src', 'app', 'orders');
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const FILES = ['sales-orders.js', 'raise-sales-order.js', 'quantity-sheet.js', 'delete-requests.js'].map(f => read(path.join(ORDERS, f)));
const INDEX = read(path.join(__dirname, '..', 'src', 'index.html'));
/* The Shopify stock page's "Open sales order" button: only its function is run here (the rest of that file needs the whole page). */
const SHOPIFY_FILE = read(process.env.SH_SRC || path.join(__dirname, '..', 'src', 'app', 'replenishment', 'shopify-stock.js'));
const SHOPIFY_OPEN = SHOPIFY_FILE.match(/^async function shOpenSo\(\) \{[\s\S]*?\n\}$/m);
FILES.push(SHOPIFY_OPEN ? SHOPIFY_OPEN[0] : '');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* The four files run in one scope, as in the app, against a fake page. Names the files do not declare come from the fake
 * page (a catch-all stub); names they declare are theirs. hidden: the part keys switched off. */
function load(hidden) {
  const src = FILES.join('\n');
  const declared = new Set([...src.matchAll(/^(?:async )?function\s+(\w+)|^(?:const|let)\s+(\w+)/gm)].map(m => m[1] || m[2]));
  const els = {};
  const el = id => (els[id] = els[id] || { id, value: '', innerHTML: '', textContent: '', className: '', style: {}, title: '',
    classList: { add() { this.hidden = true; }, remove() {}, toggle() {} }, addEventListener() {}, set onclick(f) { this._onclick = f; }, get onclick() { return this._onclick; },
    onchange: null, querySelector: () => null });
  const warned = [], opened = [], downloads = [], shown = [];
  const env = {
    $: el, esc: s => String(s == null ? '' : s), nf: n => String(n), csvCell: v => String(v == null ? '' : v),
    apxOn: key => !hidden.includes(key),
    console: { info: m => warned.push(String(m)), warn() {}, log() {}, error() {} },
    ME: { admin: true, email: 'a@x.com', tabs: ['so'] },
    ptOpenDialog: cfg => { opened.push(cfg); }, ptDownload: (name, lines) => downloads.push({ name, lines }),
    ptImgCell: sku => `<td data-img="${sku}">pic</td>`, ptImgCellSrc: sku => `<td>pic</td>`, ptImgFill() {}, ptImgPatch() {},
    ptEmpty() {}, ptDebounce() {}, ptRangeOf: () => ['', ''], ptInRange: () => true, ptStamp: () => '', ptIsoDate: s => s,
    obUC: s => String(s || '').trim().toUpperCase(), soMonthTxt: s => s, soChannels: () => [], soModeOf: () => '',
    soCanEdit: () => true, soCanApprove: () => true, soNeedsMode: () => false, soDoneOn: () => ({ floor: 0, cut: 0, made: 0, pressed: 0 }),
    spIsVendor: () => false, ordLines: () => [], obBaseIndex: () => new Map(), obKeyOf: (a, b) => a + '|' + b,
    shMsg: (text, bad) => { shown.push({ text, bad }); }, SH_LAST: [], SH_PICK: new Set(),
    PT: { cut: [] }, PTG: { press: [], ob: [], mdb: [] }, flowBackCard: () => '', ptDlgMsg() {}, dToday: () => '2026-11-24',
    document: { querySelectorAll: () => [] }, CSS: { escape: s => s },
  };
  const scope = new Proxy(env, {
    has: (t, k) => typeof k === 'string' && !declared.has(k) && !(k in globalThis) && k !== 'arguments' ? true : k in t && !declared.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : () => ({}))),
  });
  const body = 'with (scope) {\n' + src + '\nreturn { SOX, soOpen, soQtyOpen, soFormOpen, soReview, odrListOpen, renderSox, soExportCols, soDlgRow, soSummary, soWork, soPopupAllowed, soDlgButtonOff, odrCanAnswer, shOpenSo };\n}';
  const api = new Function('scope', body)(scope);
  return Object.assign(api, { els, warned, opened, downloads, shown, env });
}

const ORDER = { _id: 'AMZ-1', orderDate: '2026-11-01', channel: 'AMZ', buyerName: 'Asha', status: 'approved', saleMonth: '2026-12',
  lines: [{ sku: 'AB-1', qty: 10, deliveryDate: '2026-12-01', priority: 'P1' }, { sku: 'CD-2', qty: 5, deliveryDate: '2026-12-02' }] };
const OTHER = { _id: 'AMZ-2', orderDate: '2026-11-02', channel: 'AMZ', buyerName: 'Raj', status: 'draft', lines: [{ sku: 'EF-3', qty: 1 }] };
const cells = (html, tag) => (html.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length;
const markedCount = (html, tag, key) => (html.match(new RegExp('<' + tag + '[^>]*data-part="' + key.replace(/\./g, '\\.') + '"', 'g')) || []).length;
const listHtml = app => app.els.sxTable.innerHTML;
function draw(app, rows) { app.SOX.rows = rows; app.SOX.busy = false; app.renderSox(); return listHtml(app); }
const firstRow = html => html.split('<tbody>')[1].split('</tr>')[0];

/* ---- nothing hidden: as today ---- */
const plain = load([]);
const plainHtml = draw(plain, [ORDER, OTHER]);
ok('nothing hidden: both orders listed', cells(plainHtml, 'tr') === 3, 'rows ' + cells(plainHtml, 'tr'));
ok('nothing hidden: header and rows have the same number of cells', cells(plainHtml.split('<tbody>')[0], 'th') === cells(firstRow(plainHtml), 'td'));
ok('nothing hidden: the message line counts both', /2 of 2 order/.test(plain.els.sxMsg.textContent));
ok('nothing hidden: export writes all 15 columns', plain.soExportCols().length === 15);

/* ---- a hidden column leaves the header and every row together ---- */
const noRaised = load(['so.col.raisedBy']);
noRaised.SOX.rows = [Object.assign({}, ORDER, { channel: 'B2B' })]; noRaised.SOX.busy = false;
noRaised.env.$('sxChan').value = 'B2B';
noRaised.renderSox();
const b2bHtml = listHtml(noRaised);
ok('B2B list: Raised by is marked on the header', markedCount(b2bHtml, 'th', 'so.col.raisedBy') === 1);
ok('B2B list: Raised by is marked on every row cell', markedCount(b2bHtml, 'td', 'so.col.raisedBy') === 1);
ok('B2B list: cells per row match the header', cells(b2bHtml.split('<tbody>')[0], 'th') === cells(firstRow(b2bHtml), 'td'));
const COLS = { Date: 'so.col.date', Channel: 'so.col.channel', Buyer: 'so.col.buyer', Status: 'so.col.status', SKUs: 'so.col.skus', Pieces: 'so.col.pieces', Cut: 'so.col.cut', Made: 'so.col.made', 'In order book': 'so.col.inBook', Delivery: 'so.col.delivery' };
Object.values(COLS).forEach(key => {
  const html = draw(load([key]), [ORDER, OTHER]);
  ok(key + ': header cell and each of 2 rows are marked', markedCount(html, 'th', key) === 1 && markedCount(html, 'td', key) === 2,
    'th ' + markedCount(html, 'th', key) + ' td ' + markedCount(html, 'td', key));
});
ok('the Order column is never marked', !/<th class="frz"[^>]*data-part/.test(plainHtml) && !/<td class="frz"[^>]*data-part/.test(plainHtml));
ok('with nothing hidden the marks are still on the page (the style sheet does the hiding)', markedCount(plainHtml, 'th', 'so.col.status') === 1);

/* ---- tiles, row buttons, the PPC card ---- */
['so.tile.orders', 'so.tile.awaiting', 'so.tile.approved', 'so.tile.pieces', 'so.tile.missing'].forEach(key =>
  ok(key + ' is marked on its tile', (plain.els.sxKpis.innerHTML.match(new RegExp('class="metric" data-part="' + key.replace(/\./g, '\\.') + '"', 'g')) || []).length === 1));
ok('row buttons are marked (Open, Edit, Review, Add the missing)', ['so.btn.open', 'so.btn.edit'].every(k => plainHtml.includes('data-part="' + k + '"'))
  && load([]).env && draw(load([]), [OTHER, Object.assign({}, OTHER, { _id: 'AMZ-3', status: 'submitted' })]).includes('data-part="so.btn.review"')
  && draw(load([]), [ORDER]).includes('data-part="so.btn.addMissing"'));
const backOn = load([]); backOn.env.flowBackCard = () => '<div class="card">back</div>'; draw(backOn, [ORDER]);
ok('the Sent back by PPC card sits inside its mark', /^<div data-part="so\.sec\.backByPpc"><div class="card">back<\/div><\/div>$/.test(backOn.els.sxBack.innerHTML), backOn.els.sxBack.innerHTML);
const backNone = load([]); draw(backNone, [ORDER]);
ok('no card, no empty mark', backNone.els.sxBack.innerHTML === '');

/* ---- the toolbar in index.html ---- */
const BAR = INDEX.split('id="paneSo"')[1].split('<!-- ============ VENDOR PORTAL')[0];
const NOT_OPEN_TEXT = 'This is not open to your account.';
const FIXED_IDS = ['sxMsg', 'sxTable', 'sxBack', 'sxKpis', 'sxQtyFile'];
const BAR_PARTS = { sxStatus: 'so.flt.status', sxChan: 'so.flt.channel', sxMode: 'so.flt.shipMode', sxSMonth: 'so.flt.saleMonth', sxQ: 'so.flt.search',
  sxD1: 'so.flt.dates', sxD2: 'so.flt.dates', sxClear: 'so.btn.clear', sxNew: 'so.btn.new', sxDelReqs: 'so.btn.delReqs', sxExport: 'so.btn.export',
  sxQtyTpl: 'so.btn.qtySheet', sxQtyImp: 'so.btn.qtyImport', sxGo: 'so.btn.refresh' };
Object.keys(BAR_PARTS).forEach(id => ok('toolbar: #' + id + ' carries ' + BAR_PARTS[id], new RegExp('<(?:select|input|button)[^>]*id="' + id + '"[^>]*data-part="' + BAR_PARTS[id].replace(/\./g, '\\.') + '"').test(BAR)));
ok('toolbar: the "Ordered" label goes with the dates', /<span[^>]*data-part="so\.flt\.dates"[^>]*>Ordered<\/span>/.test(BAR));

/* ---- a hidden filter never narrows the list ---- */
const filt = load(['so.flt.status']);
filt.env.$('sxStatus').value = 'draft';
ok('a hidden status filter does not narrow the list', cells(draw(filt, [ORDER, OTHER]), 'tr') === 3);
const filtOn = load([]);
filtOn.env.$('sxStatus').value = 'draft';
ok('a shown status filter does narrow it (control)', cells(draw(filtOn, [ORDER, OTHER]), 'tr') === 2);
const search = load(['so.flt.search']); search.env.$('sxQ').value = 'zzz-nothing';
ok('a hidden search box does not narrow the list', cells(draw(search, [ORDER, OTHER]), 'tr') === 3);
const searchOn = load([]); searchOn.env.$('sxQ').value = 'zzz-nothing';
ok('a shown search box does (control)', cells(draw(searchOn, [ORDER, OTHER]), 'tr') === 1);
const SHOP = Object.assign({}, OTHER, { _id: 'SHP-1', channel: 'SHP' });
const chan = load(['so.flt.channel']); chan.env.$('sxChan').value = 'SHP';
ok('a hidden channel filter does not narrow the list', cells(draw(chan, [ORDER, OTHER, SHOP]), 'tr') === 4);
const chanOn = load([]); chanOn.env.$('sxChan').value = 'SHP';
ok('a shown channel filter does (control)', cells(draw(chanOn, [ORDER, OTHER, SHOP]), 'tr') === 2);
const smon = load(['so.flt.saleMonth']); smon.env.$('sxSMonth').value = '2030-01';
ok('a hidden sale-month filter does not narrow the list', cells(draw(smon, [ORDER, OTHER]), 'tr') === 3);
const smonOn = load([]); smonOn.env.$('sxSMonth').value = '2030-01';
ok('a shown sale-month filter does (control)', cells(draw(smonOn, [ORDER, OTHER]), 'tr') === 1);
const mode = load(['so.flt.shipMode']); mode.env.$('sxMode').value = 'SEA';
ok('a hidden AIR / SEA filter does not narrow the list', cells(draw(mode, [ORDER, OTHER]), 'tr') === 3);
const dates = load(['so.flt.dates']); dates.env.ptRangeOf = () => ['2031-01-01', '2031-01-02']; dates.env.ptInRange = (when, a, b) => !a && !b;
ok('hidden dates do not narrow the list', cells(draw(dates, [ORDER, OTHER]), 'tr') === 3);

/* ---- the export follows the screen ---- */
const exp = load(['so.col.buyer', 'so.col.delivery']);
const heads = exp.soExportCols().map(c => c.head);
ok('export: Order is always there', heads[0] === 'Order');
ok('export: a hidden column and its twin are left out (Buyer; Delivery + Priority)', !heads.includes('Buyer') && !heads.includes('Delivery') && !heads.includes('Priority') && heads.includes('Status'));
exp.SOX.shown = [{ o: ORDER }]; draw(exp, [ORDER]); exp.SOX.shown = [{ o: ORDER, s: exp.soSummary(ORDER, exp.soWork()) }];
exp.env.$('sxExport').onclick();
ok('export: the file has the same columns as the header line on every row', exp.downloads.length === 1 && exp.downloads[0].lines.every(l => l.split(',').length === heads.length), JSON.stringify(exp.downloads[0] && exp.downloads[0].lines));
const raised = load(['so.col.raisedBy']);
ok('export: Raised by off takes Buyer out (on B2B Buyer is who raised it)', !raised.soExportCols().some(c => c.head === 'Buyer') && raised.soExportCols().length === 14);
ok('export: with both switches on, Buyer writes the buyer name', plain.soExportCols().find(c => c.head === 'Buyer').value(ORDER) === 'Asha');
const sale = load(['so.col.date']);
ok('export: Date takes Sale month with it', !sale.soExportCols().some(c => c.head === 'Sale month' || c.head === 'Date'));
const made = load(['so.col.made']);
ok('export: Made takes Owed with it', !made.soExportCols().some(c => c.head === 'Made' || c.head === 'Owed'));

/* ---- pop-ups that are off refuse to open ---- */
const NOT_OPEN = 'This is not open to your account.';
const msgOf = app => app.env.$('sxMsg').textContent;
function refuses(name, key, run) {
  const off = load([key]); off.SOX.rows = [ORDER, OTHER]; run(off);
  ok(name + ' refuses when ' + key + ' is off', off.opened.length === 0 && msgOf(off) === NOT_OPEN && off.warned.some(w => w.includes(key)),
    'opened ' + off.opened.length + ' msg "' + msgOf(off) + '"');
  const on = load([]); on.SOX.rows = [ORDER, OTHER]; run(on);
  ok(name + ' opens when nothing is hidden', on.opened.length === 1 && msgOf(on) === '');
}
refuses('the order pop-up', 'so.dlg.order', app => app.soOpen('AMZ-1'));
refuses('Change qty', 'so.dlg.changeQty', app => app.soQtyOpen('AMZ-1', 'AB-1'));
refuses('Review', 'so.dlg.review', app => app.soReview('AMZ-1'));
refuses('the order form', 'so.dlg.form', app => app.soFormOpen('AMZ-1'));
refuses('Deletion requests', 'so.dlg.delReqs', app => app.odrListOpen());

/* ---- the Shopify stock page's "Open sales order" button ---- */
ok('Shopify Open sales order: the function was found in shopify-stock.js', !!SHOPIFY_OPEN);
const shOff = load(['so.dlg.form']); shOff.shOpenSo();
ok('Shopify Open sales order refuses when the order form is off, with the same message as the Sales Orders page', shOff.opened.length === 0 && shOff.shown.length === 1 && shOff.shown[0].text === NOT_OPEN_TEXT && shOff.shown[0].bad === true);
const shOn = load([]); shOn.shOpenSo();
ok('Shopify Open sales order goes on when the form is on (control: it reaches its own "nothing to send" message)', shOn.shown.length === 1 && /anything to send/.test(shOn.shown[0].text));
ok('the Shopify button carries the order form mark', /<button[^>]*id="shOpen"[^>]*data-part="so\.dlg\.form"/.test(INDEX));

/* ---- the shared pop-up buttons ---- */
const taken = (app, id) => app.env.$(id).classList.hidden === true;
const keep = load([]); keep.soDlgButtonOff('ptDlgSave', 'so.dlg.form.btn.saveDraft');
ok('a shared button stays when its part is on', !taken(keep, 'ptDlgSave'));
const rv = load(['so.dlg.review.btn.approve', 'so.dlg.review.btn.sendBack']); rv.SOX.rows = [ORDER]; rv.soReview('AMZ-1');
ok('Review: Approve and Send back are both taken off', taken(rv, 'ptDlgSave') && taken(rv, 'ptDlgAlt'));
const rvOn = load([]); rvOn.SOX.rows = [ORDER]; rvOn.soReview('AMZ-1');
ok('Review: both stay when nothing is hidden', !taken(rvOn, 'ptDlgSave') && !taken(rvOn, 'ptDlgAlt'));
const fm = load(['so.dlg.form.btn.saveDraft', 'so.dlg.form.btn.delete']); fm.SOX.rows = [ORDER]; fm.soFormOpen('AMZ-1');
ok('Form: Save draft and Delete are taken off', taken(fm, 'ptDlgSave') && taken(fm, 'ptDlgDelete'));
ok('Form: the add, template and upload buttons carry their marks', (() => { const h = load([]); h.SOX.rows = [ORDER]; h.soFormOpen('AMZ-1');
  return ['addLine', 'template', 'upload'].every(k => h.opened[0].html.includes('data-part="so.dlg.form.btn.' + k + '"')); })());
ok('Form: the four optional fields carry their marks, Channel / Order date do not', (() => { const h = load([]); h.SOX.rows = [ORDER]; h.soFormOpen('AMZ-1');
  const t = h.opened[0].html;
  return ['saleMonth', 'orderType', 'delivery', 'reference'].every(k => t.includes('data-part="so.dlg.form.fld.' + k + '"'))
    && /<label>Channel<select/.test(t) && /<label>Order date<input/.test(t); })());

/* ---- the order pop-up ---- */
function dlgHtml(hidden) { const a = load(hidden); a.SOX.rows = [ORDER]; a.soOpen('AMZ-1'); return a.opened[0].html; }
const dlgTable = html => html.split('<tbody>');
const dlgPlain = dlgTable(dlgHtml([]));
ok('order pop-up: header and row have the same number of cells', cells(dlgPlain[0], 'th') === cells(dlgPlain[1].split('</tr>')[0], 'td'));
const POP_COLS = { image: 'Image', cut: 'Cut', made: 'Made', owed: 'Owed', delivery: 'Delivery', priority: 'Priority', inBook: 'In order book' };
Object.keys(POP_COLS).forEach(k => {
  const key = 'so.dlg.order.col.' + k, parts = dlgTable(dlgHtml([key]));
  ok('order pop-up: ' + POP_COLS[k] + ' is marked on the header and on both SKU rows', markedCount(parts[0], 'th', key) + markedCount(parts[0], 'td', key) === 1
    && markedCount(parts[1], 'td', key) === 2, 'head th ' + markedCount(parts[0], 'th', key) + ' rows td ' + markedCount(parts[1], 'td', key));
});
ok('order pop-up: Change qty is marked', dlgHtml([]).includes('data-part="so.dlg.order.btn.changeQty"'));

/* ---- the quantity sheet, last: reading it is asynchronous ---- */
(async () => {
  const off = load(['so.dlg.qtyConfirm']);
  const file = { name: 'a.csv', text: async () => { throw new Error('the sheet must not be read'); } };
  await off.env.$('sxQtyFile').onchange({ target: { files: [file], value: 'x' } });
  ok('the quantity sheet is not read when its confirm pop-up is off', off.opened.length === 0 && msgOf(off) === NOT_OPEN);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
