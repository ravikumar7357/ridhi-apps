/* RFD ON SHELF LESS WHAT WENT TO PRINTERS (Vishesh, 23 Nov). The Greige Desk Inventory's "RFD on shelf" takes off the metres
 * that left on the flow's RFD challans to printers since the desk began counting that fabric, so it agrees with PPC's
 * "RFD free"; the total follows; the lot list says how much went on challans. Loads the real greige-desk.js with a fake page
 * and a stand-in for the flow's challan count. Made-up lots only.
 *   node tests/rfd-shelf-challans-test.js
 *   GD_FILE=<a broken copy> node tests/rfd-shelf-challans-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

const els = {};
const stub = () => ({ value: '', textContent: '', innerHTML: '', className: '', hidden: false, classList: { add() {}, remove() {}, toggle() {}, has: () => false }, getAttribute: () => null, setAttribute() {} });
const root = { getElementById: id => els[id] || (els[id] = stub()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
const asked = [];
function desk(flow) {
  const code = fs.readFileSync(SRC, 'utf8');
  const rootLine = '  var GD_ROOT = null;', anchor = '  return { open: open,';
  if (code.split(rootLine).length !== 2 || code.split(anchor).length !== 2) throw new Error('greige-desk.js: an anchor this test needs moved; update the test');
  const opened = code.replace(rootLine, '  var GD_ROOT = globalThis.__ROOT;').replace(anchor, '  globalThis.__GDT = { invAll: invAll, invDetail: invDetail, gdRfdShelf: gdRfdShelf,'
    + ' invHistRows: invHistRows, renderLedger: renderLedger, ledChallanRows: ledChallanRows, fabShelfLedger: fabShelfLedger, invTodoHtml: invTodoHtml, invLotsLeft: invLotsLeft,'
    + ' setDB: function (v) { DB = v; GD_STATE = "ok"; GD_SNAP = gdSnap(); } };\n' + anchor);
  const ctx = Object.assign({ console, window: { document: {} }, __ROOT: root, ptPatch: async () => {}, ptPut: async () => {}, setTimeout: () => 0, clearTimeout: () => {},
    ME: { admin: true, email: 'test@example.test', tabs: [] } }, flow || {});
  vm.createContext(ctx);
  vm.runInContext(opened, ctx);
  return ctx.__GDT;
}
const rows = [{ id: 'o1', date: '2026-11-01', lot: 'LOT-OPEN', fabricType: 'Cambric', txnType: 'OPENING_RFD', qty: 1149, party: '', bill: '', orderNo: '' }];
const db = { gpo: [], fab: rows, mst: [{ rfd: 'Cambric', greige: 'Greige Cambric 48', active: true, rfdWidth: 44 }], ven: [], co: {}, users: [], me: '' };
/* the flow, as far as this needs it: 273 m of Cambric went on challans since 1 Nov */
const flowWith = out => ({ FLOW: { ch: { 'RFD-1': {} } }, flowRfdChallanOut: (name, from) => { asked.push([name, from]); return String(name).toUpperCase() === 'CAMBRIC' ? out : 0; },
  flowRfdChallanMoves: (name, from) => String(name).toUpperCase() === 'CAMBRIC' ? [{ no: 'RFD-1', date: '2026-11-20', vendor: 'Printer A', metres: out }] : [] });

console.log('== RFD on shelf goes down when cloth goes to a printer on an RFD challan ==');
{
  const G = desk(flowWith(273)); G.setDB(JSON.parse(JSON.stringify(db)));
  const r = G.invAll().filter(x => x.fabric === 'Cambric')[0] || {};
  ok('1,149 m counted, 273 m went on challans → RFD on shelf 876 m', r.inStoreRfd === 876 && r.rfdToPrinters === 273, JSON.stringify(r && { rfd: r.inStoreRfd, out: r.rfdToPrinters }));
  ok('…counted from the day the desk began counting Cambric (its opening stock)', asked.some(a => a[0] === 'Cambric' && a[1] === '2026-11-01'), JSON.stringify(asked));
  ok('…and the total follows: 876 m', r.owned === 876, String(r.owned));
  const d = G.invDetail(r, 'rfd');
  ok('the RFD lot shows what is left now (876 m), not what it had (1,149 m)', /<td class="num b">876 m<\/td>/.test(d), d.slice(0, 300));
  ok('…and no note about challans on the Inventory page', !/went to printers/.test(d));
  const L = G.fabShelfLedger(G.invHistRows('Cambric'), 'Cambric', 'rfd', '', '');
  ok('the stock history lists the challan as "RFD to printer", 273 m out', L.lines.some(x => x.row.txnType === 'RFD_TO_PRINTER' && x.outQty === 273 && x.row.party === 'Printer A'));
  ok('…and closes on the Inventory figure: 876 m', L.closing === 876, String(L.closing));
  const T = G.invTodoHtml([Object.assign({}, r, { ppc: { lines: 3, greigeM: 500, greige: 'G' } })], true, false);
  ok('no "Short for PPC" or "RFD for PPC lines" tile on the page', !/Short for PPC|RFD for PPC lines/.test(T), T);
  ok('the desk\'s own count for the flow is not changed (the flow takes the challans off itself — never twice)', G.gdRfdShelf('Cambric') === 1149);
}
{
  const G = desk(flowWith(2000)); G.setDB(JSON.parse(JSON.stringify(db)));
  const r = G.invAll().filter(x => x.fabric === 'Cambric')[0];
  ok('more on challans than counted never shows below 0 (nothing left: 0, or the empty row is not shown)', !r || r.inStoreRfd === 0, JSON.stringify(r && r.inStoreRfd));
}
{
  const G = desk({}); G.setDB(JSON.parse(JSON.stringify(db)));
  const r = G.invAll().filter(x => x.fabric === 'Cambric')[0] || {};
  ok('the flow not in the page (or not read yet): the shelf shows the desk\'s own count, nothing invented', r.inStoreRfd === 1149 && !r.rfdToPrinters && !/went to printers/.test(G.invDetail(r, 'rfd')));
}

console.log('== the Fabric ledger lists the challans to printers too (Ravi, 25 Nov) ==');
{
  const G = desk(flowWith(273)); G.setDB(JSON.parse(JSON.stringify(db)));
  const rows = G.ledChallanRows(), h = G.renderLedger();
  ok('one read-only row: RFD to printer, 273 m, Printer A, challan RFD-1', rows.length === 1 && rows[0].txnType === 'RFD_TO_PRINTER' && rows[0].qty === 273 && rows[0].party === 'Printer A' && rows[0].bill === 'RFD-1' && rows[0].flow === true, JSON.stringify(rows));
  ok('…shown on the ledger page as an out of 273 m, with no Edit button of its own', /RFD to printer/.test(h) && /−273/.test(h) && /from the RFD challan/.test(h) && !/data-edit="ch:/.test(h) && !/data-done="ch:/.test(h));
  ok('…and the page says 2 movements, 273 m out', /2 movements/.test(h) && /273 m<\/b> out/.test(h), (h.match(/ff-cap">[^<]*/) || [''])[0]);
  const G0 = desk({}); G0.setDB(JSON.parse(JSON.stringify(db)));
  ok('the flow not read: the register alone, nothing invented', G0.ledChallanRows().length === 0 && !/RFD to printer<\/span>/.test(G0.renderLedger()));
}
console.log('== two lots: the challans come off the oldest lot first, and the lots add up to the shelf ==');
{
  const two = JSON.parse(JSON.stringify(db));
  two.fab.push({ id: 'o2', date: '2026-11-10', lot: 'LOT-NEW', fabricType: 'Cambric', txnType: 'PURCHASE_RFD', qty: 500, party: 'Mill', bill: 'B1', orderNo: '' });
  const G = desk(flowWith(1300)); G.setDB(two);
  const r = G.invAll().filter(x => x.fabric === 'Cambric')[0] || {}, left = G.invLotsLeft('Cambric', r.rfdToPrinters);
  ok('1,149 + 500 less 1,300 → LOT-OPEN 0, LOT-NEW 349', left['LOT-OPEN'] === 0 && left['LOT-NEW'] === 349, JSON.stringify(left));
  ok('…and the lots add up to RFD on shelf (349 m)', r.inStoreRfd === 349, String(r.inStoreRfd));
  const d = G.invDetail(r, 'rfd');
  ok('…the emptied lot is not listed', !/LOT-OPEN/.test(d) && /LOT-NEW/.test(d));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
