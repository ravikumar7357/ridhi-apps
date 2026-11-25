/* ISSUE TO RFD: PART OF A BALE, THE LR NUMBER; A CHECKED BALE IS NOT CHANGED AGAIN (Ravi, 25 Nov).
 * "a bale of 300 m, you can also send 200 m and it will show 100 m in the greige store but you cannot send 400 m from a bale of
 * 300 m". Loads the real greige-desk.js with a fake page. Made-up lots only.
 *   node tests/issue-part-bale-test.js
 *   GD_FILE=<a broken copy> node tests/issue-part-bale-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };
const els = {};
const stub = () => { const cls = new Set(); return { value: '', textContent: '', innerHTML: '', className: '', hidden: false, focus() {}, classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) }, getAttribute: () => null, setAttribute() {} }; };
const root = { getElementById: id => els[id] || (els[id] = stub()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
function desk(me) {
  const code = fs.readFileSync(SRC, 'utf8');
  const rootLine = '  var GD_ROOT = null;', anchor = '  return { open: open,';
  if (code.split(rootLine).length !== 2 || code.split(anchor).length !== 2) throw new Error('greige-desk.js: an anchor this test needs moved; update the test');
  const names = ['lotBales', 'issOpen', 'issSave', 'issDraw', 'issBaleErr', 'fabLot', 'piecesHtml', 'chList', 'renderLedger'];
  const opened = code.replace(rootLine, '  var GD_ROOT = globalThis.__ROOT;').replace(anchor, '  globalThis.__GDT = { ' + names.map(n => n + ': ' + n).join(', ')
    + ', setDB: function (v) { DB = v; GD_STATE = "ok"; GD_SNAP = gdSnap(); }, getDB: function () { return DB; }, getISS: function () { return ISS; } };\n' + anchor);
  const ctx = { console, window: { document: {} }, __ROOT: root, ptPatch: async () => {}, ptPut: async () => {}, setTimeout: () => 0, clearTimeout: () => {}, ME: me };
  vm.createContext(ctx); vm.runInContext(opened, ctx);
  return ctx.__GDT;
}
const ADMIN = { email: 'ravi@example.test', name: 'Ravi', admin: true, tabs: [] };
const STORE = { email: 'ramesh@example.test', name: 'Ramesh', admin: false, tabs: ['gdesk', 'gdled', 'gdledit'] };
const db = () => ({ gpo: [{ id: 'g1', poNo: 'PO/1', date: '2026-11-20', mill: 'Test Mills', sent: { at: '2026-11-20' }, lines: [{ rfd: 'Sheeting 62', greige: 'Greige Sheeting 67', metres: 2000, rate: 50 }] }],
  fab: [{ id: 'a', date: '2026-11-21', lot: 'LOT-016', fabricType: 'Greige Sheeting 67', txnType: 'RECEIVE_GREIGE', qty: 2000, party: 'Test Mills', bill: 'CH-9', orderNo: 'PO/1', chId: 'c1',
    pieces: [{ than: '7580', m: 800, chk: 800 }, { than: '7581', m: 900 }, { than: '7582', m: 300 }] }],
  mst: [{ rfd: 'Sheeting 62', greige: 'Greige Sheeting 67', active: true, rfdWidth: 62 }], ven: [{ name: 'R.K. Bleaching', kind: 'RFD Processor', active: true }], co: {}, users: [], me: '' });
const issue = (G, ticks, typed, lr) => {
  G.issOpen('PO/1'); const I = G.getISS();
  ticks.forEach(t => { I.pick['LOT-016'][t] = true; }); Object.keys(typed || {}).forEach(t => { I.bq['LOT-016|' + t] = typed[t]; });
  els.issProc.value = 'R.K. Bleaching'; els.issLr.value = lr || ''; els.issRem.value = '';
  G.issSave();
  return G.getDB().fab.filter(r => r.txnType === 'ISSUE_TO_RFD');
};

console.log('== part of a bale goes to RFD; the rest stays in the greige store ==');
{
  const G = desk(ADMIN); G.setDB(db());
  let out = issue(G, ['7582'], { 7582: '400' });
  ok('400 m from a bale of 300 m is refused: nothing saved', out.length === 0);
  ok('…and it says the bale has only 300 m and to tick another bale for the rest', /Bale 7582 has only 300\.0 m/.test(els.issErr.innerHTML) && /tick another bale/.test(els.issErr.innerHTML), els.issErr.innerHTML);
  out = issue(G, ['7582'], { 7582: '200' }, 'LR-5521');
  ok('200 m from the bale of 300 m goes', out.length === 1 && out[0].qty === 200 && out[0].baleM['7582'] === 200, JSON.stringify(out[0]));
  ok('…the LR number is kept on the issue, and shown on the Fabric ledger', out[0].lr === 'LR-5521' && /LR LR-5521/.test(G.renderLedger()));
  const b = G.lotBales('LOT-016').find(x => x.than === '7582');
  ok('…the bale is still offered, with 100 m left of 300', !!b && b.m === 100 && b.full === 300, JSON.stringify(b));
  ok('…and the greige store holds 1,800 m of the lot', G.fabLot('LOT-016').greigeLeft === 1800, String(G.fabLot('LOT-016').greigeLeft));
  out = issue(G, ['7582'], { 7582: '150' });
  ok('150 m more from what is left (100 m) is refused', out.length === 1 && /has only 100\.0 m/.test(els.issErr.innerHTML));
  out = issue(G, ['7582', '7581'], {});
  ok('ticked with nothing typed: all that is left of each bale goes (100 + 900 m)', out.length === 2 && out[1].qty === 1000 && out[1].baleM['7582'] === 100 && out[1].baleM['7581'] === 900);
  ok('…a bale all gone is not offered again; 7580 is, whole', G.lotBales('LOT-016').map(x => x.than + ':' + x.m).join() === '7580:800');
}
console.log('== the LR number is filled from the greige receipt ==');
{
  const G = desk(ADMIN), d = db(); d.fab[0].lr = 'LR-7788'; G.setDB(d);
  G.issOpen('PO/1');
  ok('the LR typed when the greige was received is already in the box', els.issLr.value === 'LR-7788', els.issLr.value);
  G.getISS().pick['LOT-016']['7582'] = true; els.issProc.value = 'R.K. Bleaching'; G.issSave();
  ok('…and is saved on the issue', G.getDB().fab.filter(r => r.txnType === 'ISSUE_TO_RFD')[0].lr === 'LR-7788');
  const G2 = desk(ADMIN); G2.setDB(db()); G2.issOpen('PO/1');
  ok('no LR on the receipt: the box is empty', els.issLr.value === '');
}
console.log('== an older issue that named only the bales took them whole ==');
{
  const G = desk(ADMIN), d = db();
  d.fab.push({ id: 'i0', date: '2026-11-22', lot: 'LOT-016', fabricType: 'Greige Sheeting 67', txnType: 'ISSUE_TO_RFD', qty: 800, party: 'R.K. Bleaching', bill: 'RIDHI/RFD/001', orderNo: 'PO/1', bales: ['7580'] });
  G.setDB(d);
  ok('7580 is gone, 7581 and 7582 are whole', G.lotBales('LOT-016').map(x => x.than + ':' + x.m).join() === '7581:900,7582:300');
}
console.log('== a checked bale is not changed again ==');
{
  const G = desk(STORE); G.setDB(db());
  const h = G.piecesHtml(G.chList()[0]);
  ok('the checked bale (7580) is read-only for the store', /id="chk-a-0"[^>]*readonly/.test(h), (h.match(/<input id="chk-a-0"[^>]*>/) || [''])[0]);
  ok('…a bale not yet checked can still be typed', !/id="chk-a-1"[^>]*readonly/.test(h));
  const GA = desk(ADMIN); GA.setDB(db());
  ok('an Admin can still correct a checked bale', !/id="chk-a-0"[^>]*readonly/.test(GA.piecesHtml(GA.chList()[0])));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
