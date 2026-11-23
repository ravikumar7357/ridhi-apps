/* CUT TO SIZE ON THE GREIGE DESK (Vishesh, 23 Nov). Pins the business rules of cutting RFD to a size with no product behind it:
 *   - Send to cutting has a second way: width × length (inches) and pieces; metres = pieces × length × 0.0254
 *   - the width may not be more than the fabric's RFD width in Master data; narrower is allowed with a warning line; no RFD
 *     width in Master data means no cutting to size
 *   - a request is ONE ledger row that waits for approval (right gdcut): it counts nowhere until approved, so the metres stay
 *     on the RFD shelf; approved, the shelf goes down, Cut to size goes up and the Total stays the same; refused moves nothing
 *   - the Cut to size cell shows the pieces left, the metres and how many wait for approval
 *   - Send to printer from the cut pieces: a line matches by fabric and size (60x60 = 60 X 60 = 60×60, and 60x90 = 90x60),
 *     pieces are filled oldest order first, one RFD challan, and CUT_TO_PRINTER rows that move only Sent to printer and Left
 * Loads the real src/app/flow/greige-desk.js with a fake page. Made-up fabrics, lots and orders only.
 *   node tests/cut-to-size-test.js
 *   GD_FILE=<a broken copy> node tests/cut-to-size-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
const CORE = path.join(__dirname, '..', 'src', 'app', 'core');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* ---- a fake page: every element the desk asks for is a small stand-in that remembers what was put in it ---- */
const els = {};
const stub = () => { const cls = new Set(); return { value: '', textContent: '', innerHTML: '', className: '', hidden: false, classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c) }, getAttribute: () => null, setAttribute() {} }; };
const root = { getElementById: id => els[id] || (els[id] = stub()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
const wrote = [];   // every patch the desk sent to the database

function desk() {
  const code = fs.readFileSync(SRC, 'utf8');
  const rootLine = '  var GD_ROOT = null;', anchor = '  return { open: open,';
  if (code.split(rootLine).length !== 2 || code.split(anchor).length !== 2) throw new Error('greige-desk.js: the GD_ROOT line or the closing "return { open" line moved; update this test');
  const names = ['ctsCheck', 'ctsMetres', 'ctsSave', 'ctsDecide', 'ctsOf', 'ctsParseSize', 'ctsSizeMatches', 'ctsSendPlan', 'ctsSendWrite', 'ctsInfoDraw', 'ctsWaiting',
    'ctsLotsLeft', 'ctsDetailRows', 'ctsApprovalsHtml', 'invAll', 'invCutCell', 'invDetail', 'renderLedger', 'dashAlerts', 'rrPending',
    'fabFlowRows', 'fabLots', 'fabShelfLedger', 'fabEntryCheck', 'fabCounts', 'fabLineOf', 'gdRfdShelf', 'canCutApprove', 'cutDraw', 'cutOpen', 'rrDecide', 'lmSaveDb'];
  const opened = code.replace(rootLine, '  var GD_ROOT = globalThis.__ROOT;').replace(anchor, '  globalThis.__GDT = { ' + names.map(n => n + ': ' + n).join(', ')
    + ', setDB: function (v) { DB = v; GD_STATE = "ok"; GD_SNAP = gdSnap(); }, setCUT: function (v) { CUT = v; }, getCUT: function () { return CUT; }, getDB: function () { return DB; }, FAB_LABEL: FAB_LABEL, FAB_SIGN: FAB_SIGN, ui: UI };\n' + anchor);
  const ctx = { console, window: { document: {} }, __ROOT: root, ptPatch: async p => { wrote.push(p); }, ptPut: async () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  vm.createContext(ctx);
  vm.runInContext(opened, ctx);
  ctx.__GDT.ctx = ctx;
  return ctx.__GDT;
}
const G = desk(), ctx = G.ctx;

/* ---- the business, in its own words ---- */
const HEAD = { email: 'neha@example.test', name: 'Neha', admin: false, tabs: ['gdesk', 'gdled', 'gdcut'] };
const STORE = { email: 'ramesh@example.test', name: 'Ramesh', admin: false, tabs: ['gdesk', 'gdled', 'gdledit', 'gdappr'] };
const ADMIN = { email: 'ravi@example.test', name: 'Ravi', admin: true, tabs: [] };
const signIn = me => { ctx.ME = me; };
const MST = (rfdWidth) => [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', rfdWidth: rfdWidth, active: true }];
const shelf = (m, lot) => ({ id: 'o-' + lot, date: '2026-11-01', lot: lot || 'LOT-001', fabricType: 'Sheeting 72', txnType: 'OPENING_RFD', qty: m, party: '', bill: '', orderNo: '', done: false });
const deskWith = (fab, rfdWidth) => { G.setDB({ gpo: [], fab: fab, mst: MST(rfdWidth === undefined ? 72 : rfdWidth), ven: [], co: {}, users: [], me: '' }); wrote.length = 0; };
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const ask = (w, l, pcs, lot) => {   // the Send to cutting card, Cut to size way, filled and saved
  G.setCUT({ lot: lot || 'LOT-001', pick: {}, qty: '', lines: [], lpick: {}, mode: 'size', w: String(w), l: String(l), p: String(pcs) });
  els.cutDate = Object.assign(stub(), { value: '2026-11-23' }); els.cutTo = stub(); els.cutRem = stub(); els.cutErr = stub();
  G.ctsSave();
};
const invRow = name => G.invAll().filter(r => r.fabric === name)[0];
const cutRows = () => G.getDB().fab.filter(r => r.cutToSize);

console.log('== the size and the metres ==');
signIn(STORE); deskWith([shelf(1000)]);
ok('metres = pieces × length × 0.0254: 40 × 90" = 91.44 m', G.ctsMetres(40, 90) === 91.44);
ok('…rounded to two places: 7 × 33" = 5.87 m', G.ctsMetres(7, 33) === 5.87);
ok('a width over the RFD width is refused, in words',
  G.ctsCheck({ rfd: 'Sheeting 72', lot: 'LOT-001', w: 90, l: 90, pcs: 10, date: '2026-11-23' }).err === 'Sheeting 72 is 72" wide — a 90" piece can\'t be cut from it.');
const narrow = G.ctsCheck({ rfd: 'Sheeting 72', lot: 'LOT-001', w: 60, l: 90, pcs: 10, date: '2026-11-23' });
ok('a narrower width is NOT an error: it carries a warning', narrow.err === '' && narrow.warn === 'Cutting 60" wide from 72" cloth — 12" of each piece\'s width is left over.', JSON.stringify(narrow));
ok('the full width has no warning', G.ctsCheck({ rfd: 'Sheeting 72', lot: 'LOT-001', w: 72, l: 90, pcs: 10, date: '2026-11-23' }).warn === '');
ok('more metres than the lot\'s RFD on the shelf: refused (the existing check)', /holds 1,000 m of RFD/.test(G.ctsCheck({ rfd: 'Sheeting 72', lot: 'LOT-001', w: 72, l: 90, pcs: 500, date: '2026-11-23' }).err));
ok('half a piece is refused', /whole numbers/.test(G.ctsCheck({ rfd: 'Sheeting 72', lot: 'LOT-001', w: 60, l: 90, pcs: 2.5, date: '2026-11-23' }).err));
deskWith([shelf(1000)], '');
ok('no RFD width in Master data: cutting to size is refused', G.ctsCheck({ rfd: 'Sheeting 72', lot: 'LOT-001', w: 60, l: 90, pcs: 10, date: '2026-11-23' }).err === 'Put the RFD width of Sheeting 72 in Master data first.');
ask(60, 90, 10);
ok('…and nothing is saved', cutRows().length === 0 && /Master data/.test(els.cutErr.textContent) && !els.cutErr.classList.has('hide'));

console.log('== asking: one ledger row that waits ==');
deskWith([shelf(1000)]); signIn(STORE);
ask(60, 90, 40);
const asked = cutRows();
ok('one row is written, in the ledger, as RFD to cutting', asked.length === 1 && asked[0].txnType === 'ISSUE_TO_CUTTING' && asked[0].lot === 'LOT-001' && asked[0].fabricType === 'Sheeting 72');
ok('it carries size, pieces, metres and the asking', asked[0].size.w === 60 && asked[0].size.l === 90 && asked[0].pcs === 40 && asked[0].qty === 91.44 && asked[0].cutToSize === true && asked[0].by === 'Ramesh');
ok('it waits: status pending, with who and when (world time)', asked[0].approval.status === 'pending' && asked[0].approval.by === 'Ramesh' && /^\d{4}-\d\d-\d\dT.*Z$/.test(asked[0].approval.at) && /Cut 40 pcs of 60 × 90/.test(asked[0].approval.ask));
ok('the person is told it waits for approval', els.toast.textContent === 'Saved — waits for the production head or accounts head to approve.');
ok('only that row is written to the database', wrote.length === 1 && Object.keys(wrote[0]).length === 1 && Object.keys(wrote[0])[0] === 'pt_gdTest/fab/' + asked[0].id);
ok('the pending row does NOT move the RFD on the shelf', G.fabFlowRows(G.getDB().fab)[0].rfdLeft === 1000 && G.gdRfdShelf('Sheeting 72') === 1000);
ok('the live line under the boxes shows the warning while typing', (G.setCUT({ lot: 'LOT-001', pick: {}, qty: '', lines: [], lpick: {}, mode: 'size', w: '60', l: '90', p: '10' }), els.cutDate.value = '2026-11-23', G.ctsInfoDraw(), els.ctsInfo.textContent === 'Cutting 60" wide from 72" cloth — 12" of each piece\'s width is left over.' && els.ctsM.value === '22.86'), els.ctsInfo.textContent);
const r0 = invRow('Sheeting 72');
ok('before approval: RFD on shelf 1,000, Cut to size nothing, 1 waiting, Total 1,000', r0.inStoreRfd === 1000 && r0.cut.leftPcs === 0 && r0.cut.waiting === 1 && r0.owned === 1000);

console.log('== approving ==');
signIn({ email: 'ramesh@example.test', name: 'Ramesh', admin: false, tabs: ['gdesk', 'gdledit', 'gdappr'] });
ok('the shrinkage approver (gdappr) may NOT approve a cut', G.canCutApprove() === false && /Only the production head or accounts head/.test(G.ctsDecide(asked[0].id, true, '')) && asked[0].approval.status === 'pending');
ok('the non-approver sees no Approve button in the drop-down', !/data-ctsdec/.test(G.invDetail(invRow('Sheeting 72'), 'cut')) && /for the production head or accounts head/.test(G.invDetail(invRow('Sheeting 72'), 'cut')));
signIn(HEAD); wrote.length = 0;
ok('the head sees Approve and Refuse on the waiting cut', /data-ctsdec="[^"]+\|ok"/.test(G.invDetail(invRow('Sheeting 72'), 'cut')) && /\|no"/.test(G.invDetail(invRow('Sheeting 72'), 'cut')));
ok('the head sees it on the POs page card and the to-do list', /data-ctsdec/.test(G.ctsApprovalsHtml()) && G.dashAlerts().some(a => a.tag === 'Approve' && /Cut 40 pcs of 60 × 90/.test(a.what)));
ok('the shrinkage approvals list does not pick it up', G.rrPending().length === 0);
ok('approving works', G.ctsDecide(asked[0].id, true, '') === '' && asked[0].approval.status === 'approved' && asked[0].approval.by === 'Neha' && /^\d{4}-\d\d-\d\dT/.test(asked[0].approval.at));
ok('only that row\'s approval field is written', wrote.length === 1 && Object.keys(wrote[0]).join() === 'pt_gdTest/fab/' + asked[0].id + '/approval' && wrote[0]['pt_gdTest/fab/' + asked[0].id + '/approval'].status === 'approved');
const r1 = invRow('Sheeting 72');
ok('RFD on the shelf goes down by the metres (908.56)', Math.abs(r1.inStoreRfd - 908.56) < 1e-6, String(r1.inStoreRfd));
ok('Cut to size goes up: 40 pcs, 91.44 m', r1.cut.leftPcs === 40 && r1.cut.leftM === 91.44 && r1.cut.waiting === 0);
ok('the Total is the same: no cloth is lost', Math.abs(r1.owned - 1000) < 1e-6, String(r1.owned));
ok('deciding twice is refused', /not waiting/.test(G.ctsDecide(asked[0].id, true, '')));
signIn(ADMIN);
deskWith([shelf(1000)]); ask(60, 90, 40); const adminAsk = cutRows()[0];
ok('an admin may approve', G.canCutApprove() === true && G.ctsDecide(adminAsk.id, true, '') === '');

console.log('== refusing ==');
deskWith([shelf(1000)]); signIn(STORE); ask(60, 90, 40); signIn(HEAD);
const toRefuse = cutRows()[0];
ok('refused with a reason: status refused, the reason kept', G.ctsDecide(toRefuse.id, false, ' too wide a mix ') === '' && toRefuse.approval.status === 'refused' && toRefuse.approval.why === 'too wide a mix');
const r2x = invRow('Sheeting 72');
ok('nothing moves: shelf 1,000, no cut pieces, nothing waiting, Total 1,000', r2x.inStoreRfd === 1000 && r2x.cut.leftPcs === 0 && r2x.cut.waiting === 0 && r2x.owned === 1000);
ok('the refused one shows muted in the drop-down with its reason, and has no buttons', (h => /Refused/.test(h) && /too wide a mix/.test(h) && !/data-ctsdec/.test(h))(G.invDetail(r2x, 'cut')));
ok('an approval asked for more metres than the lot holds now is refused at approval', (() => {
  deskWith([shelf(100)]); signIn(STORE); ask(72, 100, 30); signIn(HEAD);
  const big = cutRows()[0]; G.getDB().fab.push({ id: 'dmg', date: '2026-11-22', lot: 'LOT-001', fabricType: 'Sheeting 72', txnType: 'ISSUE_TO_CUTTING', qty: 50, party: 'Cutting' });
  return /holds 50 m of RFD now/.test(G.ctsDecide(big.id, true, '')) && big.approval.status === 'pending';
})());

console.log('== the Cut to size cell ==');
deskWith([shelf(1000)]); signIn(STORE); ask(60, 90, 40); signIn(HEAD); G.ctsDecide(cutRows()[0].id, true, ''); signIn(STORE); ask(60, 60, 10);
const cell = G.invCutCell(invRow('Sheeting 72'));
ok('the cell shows pieces left, the metres under them and the waiting count', /40 pcs/.test(text(cell)) && /91\.44 m/.test(text(cell)) && /1 waiting approval/.test(text(cell)) && /data-invd="Sheeting 72\|cut"/.test(cell), text(cell));
ok('a fabric with nothing cut shows a dash', /muted/.test(G.invCutCell({ fabric: 'Cambric 44', cut: { leftPcs: 0, leftM: 0, waiting: 0 } })));
const det = G.invDetail(invRow('Sheeting 72'), 'cut');
ok('the drop-down has the Send to printer button at the top when pieces are left', det.indexOf('data-ctssend="Sheeting 72"') > 0 && det.indexOf('data-ctssend') < det.indexOf('<table'));
ok('…rows by size with Cut, Sent to printer, Left', /60 × 90/.test(text(det)) && /Sent to printer/.test(text(det)) && /Left/.test(text(det)) && /40 pcs/.test(text(det)));
ok('…and the waiting 60 × 60 with its status', /Waiting approval/.test(text(det)) && /10 pcs/.test(text(det)));
deskWith([shelf(1000)]); signIn(STORE); ask(60, 90, 40);
ok('no Send to printer button while nothing approved is left', !/data-ctssend/.test(G.invDetail(invRow('Sheeting 72'), 'cut')));

console.log('== the Send to cutting card: both ways in one card ==');
deskWith([shelf(1000)]); signIn(STORE);
els.cutDate = Object.assign(stub(), { value: '2026-11-23' });
G.setCUT({ lot: 'LOT-001', pick: {}, qty: '', lines: [], lpick: {}, mode: 'size', w: '', l: '', p: '' }); G.cutDraw();
ok('cut to size shows Width, Length and Pieces boxes and the worked-out metres, read-only', /id="ctsW"/.test(els.cutBody.innerHTML) && /id="ctsL"/.test(els.cutBody.innerHTML) && /id="ctsP"/.test(els.cutBody.innerHTML) && /id="ctsM" readonly/.test(els.cutBody.innerHTML));
ok('the choice names both ways, with this one on, and the button says what it does', /data-ctsmode="products"/.test(els.cutMode.innerHTML) && /segbtn on" aria-selected="true" data-ctsmode="size"/.test(els.cutMode.innerHTML) && els.cutSave.textContent === 'Ask for approval');
G.setCUT({ lot: 'LOT-001', pick: {}, qty: '', lines: [], lpick: {}, mode: 'products', w: '', l: '', p: '' }); G.cutDraw();
ok('the product way is as it was: the same message, the Send to cutting button, no size boxes', /No product on the no-printing route is waiting/.test(els.cutBody.innerHTML) && !/ctsW/.test(els.cutBody.innerHTML) && els.cutSave.textContent === 'Send to cutting');

console.log('== a size on a PPC line matches the cut size ==');
ok('60x60, 60 X 60 and 60×60 all read as 60 by 60', ['60x60', '60 X 60', '60×60', ' 60 x 60 '].every(t => G.ctsSizeMatches(t, 60, 60)));
ok('60x90 matches 90 by 60, either way round', G.ctsSizeMatches('60x90', 90, 60) && G.ctsSizeMatches('90 x 60', 60, 90));
ok('60x72 does not match 60 by 60', !G.ctsSizeMatches('60x72', 60, 60));
ok('a size that is not two numbers matches nothing', !G.ctsSizeMatches('King', 60, 60) && !G.ctsSizeMatches('1 pc 60x60', 60, 60) && !G.ctsSizeMatches('', 60, 60));

console.log('== Send to printer from the cut pieces ==');
const orderLine = (key, orderNo, date, fabric, size, owed, printer) => ({ r: { orderNo, orderDate: date, sku: 'sku-' + key, size, qty: owed },
  s: { key, route: 'inhouse', bucket: 'demand', needFab: true, plan: { fabric: { name: fabric }, printer: printer ? { code: printer, name: 'Printer ' + printer } : null } } });
let FLOWROWS = [], challans = [];
Object.assign(ctx, {
  flowRows: () => FLOWROWS, flowInView: (v, s) => v === 'drfd' && s.bucket === 'demand' && s.needFab, flowFabKey: n => String(n || '').trim().toUpperCase(),
  flowShLine: x => ({ x, key: x.s.key, pcs: x.r.qty, perPc: 0, metres: 0, printer: (x.s.plan.printer || {}).code || '', printerName: (x.s.plan.printer || {}).name || '', print: null, printKey: '' }),
  flowChallanWrite: async (ch, v, how) => { ch.no = 'RFD/00' + (challans.length + 1); challans.push({ ch, v, how }); return ''; },
  flowPrinters: () => [{ code: 'P1', desc: 'Printer P1' }, { code: 'P2', desc: 'Printer P2' }], obUC: x => String(x || '').toUpperCase(), flowChItem: r => r.sku, dToday: () => '2026-11-23'
});
const sendSetup = () => {
  deskWith([shelf(100, 'LOT-001'), shelf(100, 'LOT-002')]); signIn(STORE);
  ask(60, 60, 20, 'LOT-001'); ask(60, 60, 30, 'LOT-002'); signIn(HEAD);
  cutRows().forEach(r => G.ctsDecide(r.id, true, '')); signIn(STORE);
  challans = [];
  FLOWROWS = [
    orderLine('B', 'SHP-2', '2026-11-05', 'Sheeting 72', '60 X 60', 30),   // second oldest
    orderLine('A', 'SHP-1', '2026-11-01', 'Sheeting 72', '60x60', 30),     // oldest
    orderLine('C', 'SHP-3', '2026-11-02', 'Sheeting 72', '60x90', 10),     // another size
    orderLine('D', 'SHP-4', '2026-11-03', 'Cambric 44', '60×60', 10),      // another fabric
    orderLine('E', 'SHP-5', '2026-11-04', 'Sheeting 72', '60x72', 10)      // another size
  ];
};
sendSetup();
const figures = l => Object.assign({}, l, { n: 0 });   // how many rows a lot has is not a stock figure
const SP = { fabric: 'Sheeting 72', size: '60×60', off: {} };
const plan = G.ctsSendPlan(SP, 'P1');
ok('only the lines of this fabric and this size are listed', plan.lines.map(l => l.key).join() === 'A,B', plan.lines.map(l => l.key).join());
ok('oldest order first: the first takes its 30, the second only what is left (20 of 50)', plan.picks.map(p => p.line.key + ':' + p.pcs).join() === 'A:30,B:20', plan.picks.map(p => p.line.key + ':' + p.pcs).join());
ok('metres = pieces × length: 50 × 60" = 76.2 m', plan.metres === 76.2 && plan.pcs === 50);
ok('an unticked line is left out and the next takes the pieces', G.ctsSendPlan({ fabric: 'Sheeting 72', size: '60×60', off: { A: true } }, 'P1').picks.map(p => p.line.key + ':' + p.pcs).join() === 'B:30');
FLOWROWS[1].s.plan.printer = { code: 'P2', name: 'Printer P2' };
const planP = G.ctsSendPlan(SP, 'P1');
ok('a line PPC planned for another printer is skipped, with a note', planP.picks.map(p => p.line.key).join() === 'B' && planP.skipped.length === 1 && /Planned for Printer P2/.test(planP.skipped[0].why));
FLOWROWS[1].s.plan.printer = null;
const before = JSON.stringify(G.fabFlowRows(G.getDB().fab)), lotsBefore = JSON.stringify(G.fabLots(G.getDB().fab).map(figures)), shelfBefore = G.fabShelfLedger(G.getDB().fab, 'Sheeting 72', 'rfd', '', '').closing;
(async () => {
  const made = await G.ctsSendWrite({ code: 'P1', desc: 'Printer P1' }, 'Sheeting 72', plan, 'by tempo');
  const ch = challans[0] && challans[0].ch;
  ok('one RFD challan is made, for the printer, from the desk', made.no === 'RFD/001' && challans.length === 1 && ch.vendor.code === 'P1' && ch.from === 'Greige Desk cut to size' && ch.date === '2026-11-23');
  ok('it holds only the matching lines, with pieces, metres and the cut size', ch.lines.map(l => l.key + ':' + l.pcs + ':' + l.metres + ':' + l.cutSize).join() === 'A:30:45.72:60×60,B:20:30.48:60×60', ch.lines.map(l => l.key + ':' + l.pcs + ':' + l.metres + ':' + l.cutSize).join());
  ok('the orders are on the challan', ch.orders.join() === 'SHP-1,SHP-2' && ch.orderNo === 'SHP-1, SHP-2');
  const sent = G.getDB().fab.filter(r => r.txnType === 'CUT_TO_PRINTER');
  ok('desk ledger rows are written, one per lot the pieces came from, oldest lot first', sent.map(r => r.lot + ':' + r.pcs).join() === 'LOT-001:20,LOT-002:30', sent.map(r => r.lot + ':' + r.pcs).join());
  ok('each carries the printer, the challan, the size, the metres and who', sent.every(r => r.party === 'Printer P1' && r.bill === 'RFD/001' && r.size.w === 60 && r.size.l === 60 && r.by === 'Ramesh' && r.at) && sent[0].qty === 30.48 && sent[1].qty === 45.72);
  const after = invRow('Sheeting 72');
  ok('Sent to printer rises and Left drops to nothing', G.ctsOf('Sheeting 72').sizes[0].sent === 50 && G.ctsOf('Sheeting 72').sizes[0].left === 0 && after.cut.leftPcs === 0);
  ok('it moves NO cloth figure: the RFD on the shelf and the flow rows are as before', JSON.stringify(G.fabFlowRows(G.getDB().fab)) === before && G.fabShelfLedger(G.getDB().fab, 'Sheeting 72', 'rfd', '', '').closing === shelfBefore);
  ok('the lot figures ignore it too', JSON.stringify(G.fabLots(G.getDB().fab).map(figures)) === lotsBefore);
  ok('the ledger page shows it as "Cut pieces to printer" with no plus or minus on the metres', (() => { const h = G.renderLedger(); return /Cut pieces to printer/.test(h) && /20 pcs of 60 × 60/.test(text(h)); })());
  ok('the vocabulary names it and it is not a hand-entered kind', G.FAB_LABEL.CUT_TO_PRINTER === 'Cut pieces to printer' && G.FAB_SIGN.CUT_TO_PRINTER === undefined);
  ok('the ledger does not offer Edit on cut-to-size and cut-to-printer rows', (() => { signIn(ADMIN); const h = G.renderLedger(); const rows = h.split('<tr>').filter(x => /Cut pieces to printer|cut to size/.test(x)); return rows.length >= 2 && rows.every(x => !/data-edit=/.test(x)); })());
  /* a test order and a real one cannot share a challan; nothing ticked is refused */
  sendSetup();
  ok('nothing ticked: refused, nothing written', (await G.ctsSendWrite({ code: 'P1' }, 'Sheeting 72', { picks: [], size: null }, '')).err === 'Tick at least one line.' && challans.length === 0);
  FLOWROWS[0].r.__t = true;
  ok('a test order and a real one cannot share a challan', /cannot share a challan/.test((await G.ctsSendWrite({ code: 'P1' }, 'Sheeting 72', G.ctsSendPlan({ fabric: 'Sheeting 72', size: '60×60', off: {} }, 'P1'), '')).err) && challans.length === 0);
  delete FLOWROWS[0].r.__t;
  ctx.flowChallanWrite = async () => 'Could not get a free challan number — press Refresh and try again.';
  const failed = await G.ctsSendWrite({ code: 'P1' }, 'Sheeting 72', G.ctsSendPlan({ fabric: 'Sheeting 72', size: '60×60', off: {} }, 'P1'), '');
  ok('a challan that cannot be made writes no desk rows: the pieces stay left', /free challan number/.test(failed.err) && G.getDB().fab.filter(r => r.txnType === 'CUT_TO_PRINTER').length === 0 && G.ctsOf('Sheeting 72').leftPcs === 50);

  console.log('== who may approve is a right of its own ==');
  const files = ['access-design.js', 'access-host.js', 'auth.js', 'setup.js', 'friendly.js'].map(f => [f, fs.readFileSync(path.join(CORE, f), 'utf8')]);
  files.forEach(([f, c]) => ok(f + ' knows the right gdcut', /gdcut/.test(c)));
  ok('Sellora\'s Access list says what it is', /\['gdcut', 'Approve cutting to size \(production head, accounts head\)'\]/.test(files[0][1]));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the run stopped: ' + (e && e.stack || e)); process.exit(1); });
