/* ISSUED TODAY, RECEIVED ON THE DAY IT CAME — THE GREIGE DESK (Vishesh, 23 Nov: "any date of issue is to be fixed but reciving
 * date can be changed"). Also: Cut to size starts with the cloth's RFD width from Master data, and a new vendor has no
 * "Work done" box. Loads the real src/app/flow/greige-desk.js with a fake page (the cut-to-size test's way). Made-up lots only.
 *   node tests/issue-receive-dates-test.js
 *   GD_FILE=<a broken copy> node tests/issue-receive-dates-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

const els = {};
const stub = () => { const cls = new Set(); return { value: '', textContent: '', innerHTML: '', className: '', hidden: false, readOnly: true, max: '', min: '', title: '',
  classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c) }, getAttribute: () => null, setAttribute() {}, focus() {} }; };
const root = { getElementById: id => els[id] || (els[id] = stub()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };

function desk() {
  const code = fs.readFileSync(SRC, 'utf8');
  const rootLine = '  var GD_ROOT = null;', anchor = '  return { open: open,';
  if (code.split(rootLine).length !== 2 || code.split(anchor).length !== 2) throw new Error('greige-desk.js: an anchor this test needs moved; update the test');
  const names = ['gdRecvDateErr', 'rrSentOn', 'rrOpen', 'cutOpen', 'ctsSave', 'lmToday', 'openDrawer', 'rdSave', 'rrSave', 'rrDraw', 'rrSums', 'rrLotCloses', 'gdDateDecide', 'gdDateAskItems', 'gdDateAsksHtml', 'fabLot', 'rrApprovalsHtml', 'rrDecide', 'chList', 'gdDateAskNote'];
  const opened = code.replace(rootLine, '  var GD_ROOT = globalThis.__ROOT;').replace(anchor, '  globalThis.__GDT = { ' + names.map(n => n + ': typeof ' + n + ' === "function" ? ' + n + ' : null').join(', ')
    + ', setDB: function (v) { DB = v; GD_STATE = "ok"; GD_SNAP = gdSnap(); }, getCUT: function () { return CUT; }, getDB: function () { return DB; }, getRD: function () { return RD; }, getRR: function () { return RR; } };\n' + anchor);
  const ctx = { console, window: { document: {} }, __ROOT: root, ptPatch: async p => { (ctx.__writes = ctx.__writes || []).push(p); }, ptPut: async () => {}, setTimeout: () => 0, clearTimeout: () => {},
    ME: { email: 'ramesh@example.test', name: 'Ramesh', admin: true, tabs: [] } };
  vm.createContext(ctx);
  vm.runInContext(opened, ctx);
  ctx.__GDT.ctx = ctx;
  return ctx.__GDT;
}
const G = desk(), today = G.lmToday();
const dayBefore = d => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() - 1); const two = n => (n < 10 ? '0' : '') + n; return t.getFullYear() + '-' + two(t.getMonth() + 1) + '-' + two(t.getDate()); };
const yesterday = dayBefore(today), tomorrow = (() => { const t = new Date(today + 'T00:00:00'); t.setDate(t.getDate() + 1); const two = n => (n < 10 ? '0' : '') + n; return t.getFullYear() + '-' + two(t.getMonth() + 1) + '-' + two(t.getDate()); })();
const row = (id, txnType, date, more) => Object.assign({ id, date, lot: 'LOT-001', fabricType: 'Greige Sheeting 80', txnType, qty: 500, party: 'Test Processors', bill: '', orderNo: 'PO/1', done: false }, more || {});

console.log('== a receive date: today or earlier, never before it went out ==');
ok('today is fine', G.gdRecvDateErr(today, yesterday, 'sent') === '');
ok('an earlier day is fine', G.gdRecvDateErr(yesterday, dayBefore(yesterday), 'sent') === '');
ok('a day after today is refused, in words', /cannot have come after today/.test(G.gdRecvDateErr(tomorrow, '', 'sent')));
ok('a day before it went out is refused, saying when it went', /cannot have come before .*when the greige was sent for RFD/.test(G.gdRecvDateErr(dayBefore(yesterday), yesterday, 'the greige was sent for RFD')));
ok('no date is refused', /Put the date it came/.test(G.gdRecvDateErr('', '', 'sent')));

console.log('== Receive RFD: the day can be changed, within the limits ==');
G.setDB({ gpo: [{ id: 'g1', poNo: 'PO/1', date: dayBefore(yesterday), mill: 'Test Mills', sent: { at: dayBefore(yesterday) }, lines: [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', metres: 500, rate: 50 }] }],
  fab: [row('a', 'RECEIVE_GREIGE', dayBefore(yesterday), { chId: 'c1' }), row('b', 'ISSUE_TO_RFD', yesterday)], mst: [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', rfdWidth: 72, active: true }], ven: [], co: {}, users: [], me: '' });
ok('the first day the lots went for RFD', G.rrSentOn(['LOT-001']) === yesterday && G.rrSentOn([]) === '');
if (G.rrOpen) { try { G.rrOpen('PO/1'); } catch (e) { /* the fake page may lack a box the drawing needs; the date box is set first */ } }
ok('the Receive RFD date box opens on today, can be changed, today at most, not before the greige went', els.rrDate && els.rrDate.value === today && els.rrDate.readOnly === false && els.rrDate.max === today && els.rrDate.min === yesterday,
  JSON.stringify(els.rrDate && { v: els.rrDate.value, ro: els.rrDate.readOnly, max: els.rrDate.max, min: els.rrDate.min }));

console.log('== issued today, whatever the box says ==');
const code = fs.readFileSync(SRC, 'utf8');
ok('Issue to RFD is dated today', /function issSave\(\) \{\n  var po = poFind\(ISS\.po\), proc = \$\('issProc'\)\.value\.trim\(\), date = lmToday\(\)/.test(code));
ok('Send to cutting (for products) is dated today', /thans = lotThans\(CUT\.lot\), date = lmToday\(\);/.test(code));
ok('Receive RFD and Receive greige check the day', /function rrSave\(\) \{[\s\S]{0,300}gdRecvDateErr\(typed, rrSentOn\(RR\.lots\)/.test(code) && /gdRecvDateErr\(\$\('dDate'\)\.value, po\.date, 'the PO was raised'\)/.test(code));
G.setDB({ gpo: [], fab: [row('o', 'OPENING_RFD', yesterday, { fabricType: 'Sheeting 72', qty: 1000 })], mst: [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', rfdWidth: 72, active: true }], ven: [], co: {}, users: [], me: '' });
try { G.cutOpen('LOT-001'); } catch (e) { /* drawing on the fake page may stop; CUT is set first */ }
const C = G.getCUT() || {};
ok('Cut to size starts with the cloth\'s RFD width from Master data (72)', C.w === '72', JSON.stringify(C.w));
C.mode = 'size'; C.l = '60'; C.p = '10'; C.w = '60'; els.cutDate = Object.assign(stub(), { value: '2020-01-01' }); els.cutTo = stub(); els.cutRem = stub(); els.cutErr = stub();
G.ctsSave();
const cut = (G.getDB().fab || []).filter(r => r.cutToSize)[0] || {};
ok('a cut-to-size request is dated today even if the box says 2020-01-01', cut.date === today, JSON.stringify(cut.date));

console.log('== a new vendor has no "Work done" box ==');
const fm = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'masters', 'fabric-master.js'), 'utf8');
const addVendor = fm.slice(fm.indexOf('function fmAddVendor'), fm.indexOf('saveLabel: \'Add vendor\''));
ok('the Add vendor window has no Work done box and does not save one', !/Work done/.test(addVendor) && !/'work'/.test(fm.slice(fm.indexOf('function fmAddVendor'), fm.indexOf('function fmAddVendor') + 3000)));


/* ---- A CHANGED RECEIVE DATE WAITS FOR ACCOUNTS; THE RFD LOT CLOSES BY ITSELF (Vishesh, 23 Nov) ---- */
(async () => {
  const asRole = o => { G.ctx.ME = Object.assign({ email: 'ramesh@example.test', name: 'Ramesh', admin: false, tabs: [] }, o); };
  const asAdmin = () => asRole({ admin: true }), asAccounts = () => asRole({ email: 'neha@example.test', name: 'Neha', tabs: ['gdpoappr'] }), asStore = () => asRole({ tabs: ['gdesk', 'gdappr'] });
  const mst = [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', rfdWidth: 72, active: true }];
  const fabOf = type => G.getDB().fab.filter(r => r.txnType === type);
  const writes = () => G.ctx.__writes || [];
  const ownPaths = (id) => writes().every(w => Object.keys(w).every(k => new RegExp('^pt_gdTest/fab/' + id + '/(date|dateAsk)$').test(k)));

  /* a greige PO and the receipt typed in the drawer */
  const receiveGreige = typed => {
    G.setDB({ gpo: [{ id: 'g9', poNo: 'PO/9', date: dayBefore(yesterday), mill: 'Test Mills', sent: { at: dayBefore(yesterday) }, lines: [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', metres: 500, rate: 50 }] }],
      fab: [], mst, ven: [], co: {}, users: [], me: '' });
    asStore(); G.ctx.__writes = [];
    try { G.openDrawer('PO/9'); } catch (e) { /* the fake page may stop the drawing; the drawer's state is set first */ }
    G.getRD().lines[0] = [{ than: '1', m: '100' }, { than: '2', m: '120' }]; G.getRD().lot[0] = 'LOT-777';
    els.dNo.value = 'CH-1'; els.dLr.value = ''; els.dInv.value = ''; els.dTrn.value = ''; els.dDate.value = typed;
    G.rdSave();
    return fabOf('RECEIVE_GREIGE');
  };

  console.log('== Receive greige: another day waits for accounts, the receipt counts today ==');
  let rows = receiveGreige(yesterday);
  ok('a back-dated greige receipt is saved with TODAY\'s date', rows.length === 1 && rows[0].date === today, JSON.stringify(rows.map(r => r.date)));
  ok('…with the typed day as a waiting ask: date, status, who, when', rows[0] && rows[0].dateAsk && rows[0].dateAsk.date === yesterday && rows[0].dateAsk.status === 'waiting' && rows[0].dateAsk.by === 'ramesh@example.test' && /^\d{4}-\d\d-\d\dT/.test(rows[0].dateAsk.at), JSON.stringify(rows[0] && rows[0].dateAsk));
  ok('…the challan shows today with the small note "asked: … waiting for accounts"', G.chList()[0].date === today && /asked: .* — waiting for accounts/.test(G.gdDateAskNote(G.chList()[0].rows)));
  ok('…it is in the list of dates waiting, as a greige receipt of 220 m', G.gdDateAskItems().length === 1 && G.gdDateAskItems()[0].kind === 'Greige' && G.gdDateAskItems()[0].m === 220);
  const gId = rows[0].id, gLinks = JSON.stringify([rows[0].chId, rows[0].lot, rows[0].orderNo, rows[0].bill, rows[0].qty]);
  rows = receiveGreige(today);
  ok('received today: no ask, nothing waits', rows.length === 1 && rows[0].date === today && !rows[0].dateAsk && G.gdDateAskItems().length === 0 && G.gdDateAsksHtml() === '');

  console.log('== deciding a greige date: accounts head or admin only, once ==');
  rows = receiveGreige(yesterday);
  asStore(); G.ctx.__writes = [];
  ok('a store person who may not approve is refused, nothing written, the receipt unchanged', /Only Ravi, or the accounts head/.test(await G.gdDateDecide(rows[0].id, true, '')) && !writes().length && rows[0].date === today && rows[0].dateAsk.status === 'waiting');
  ok('…the card shows them "for the accounts head" and no Approve button', !/data-gdask/.test(G.gdDateAsksHtml()) && /for the accounts head/.test(G.gdDateAsksHtml()));
  asAccounts();
  ok('…the accounts head sees Approve and Refuse on the card', /data-gdask="[^"]+\|ok"/.test(G.gdDateAsksHtml()) && /data-gdask="[^"]+\|no"/.test(G.gdDateAsksHtml()));
  ok('a refusal without a reason is turned back', /Type why/.test(await G.gdDateDecide(rows[0].id, false, '  ')) && rows[0].dateAsk.status === 'waiting');
  G.ctx.__writes = [];
  ok('the accounts head approves: the receipt moves to the day asked', await G.gdDateDecide(rows[0].id, true, '') === '' && rows[0].date === yesterday && rows[0].dateAsk.status === 'approved' && rows[0].dateAsk.decidedBy === 'neha@example.test' && !!rows[0].dateAsk.decidedAt, JSON.stringify(rows[0]));
  ok('…only that receipt\'s own date and ask are written (no whole row)', writes().length === 1 && ownPaths(rows[0].id) && writes()[0]['pt_gdTest/fab/' + rows[0].id + '/date'] === yesterday, JSON.stringify(writes()));
  ok('…its challan, lot, PO, bill and metres stay as they were', JSON.stringify([rows[0].chId, rows[0].lot, rows[0].orderNo, rows[0].bill, rows[0].qty]) === JSON.stringify([rows[0].chId, 'LOT-777', 'PO/9', 'CH-1', 220]) && G.chList()[0].date === yesterday);
  ok('…it is no longer waiting, and a second decision says "already decided"', G.gdDateAskItems().length === 0 && /Already decided/.test(await G.gdDateDecide(rows[0].id, true, '')) && /Already decided/.test(await G.gdDateDecide(rows[0].id, false, 'late')));
  rows = receiveGreige(yesterday); asAdmin(); G.ctx.__writes = [];
  ok('Ravi (admin) can approve too', await G.gdDateDecide(rows[0].id, true, '') === '' && rows[0].date === yesterday);
  rows = receiveGreige(yesterday); asAccounts(); G.ctx.__writes = [];
  ok('a refusal with a reason: the receipt stays on today, the reason is kept', await G.gdDateDecide(rows[0].id, false, 'Not the day on the challan') === '' && rows[0].date === today && rows[0].dateAsk.status === 'refused' && rows[0].dateAsk.why === 'Not the day on the challan' && rows[0].dateAsk.decidedBy === 'neha@example.test');
  ok('…and the refusal writes only the ask (the date was never moved)', writes().length === 1 && Object.keys(writes()[0]).every(k => /\/dateAsk$/.test(k)), JSON.stringify(writes()));
  rows = receiveGreige(yesterday); asAccounts(); G.ctx.__writes = [];
  G.ctx.ptCas = async () => 'changed';
  ok('two approvers at once: the one who loses the compare-and-set is told "already decided" and nothing moves', /Already decided by someone else/.test(await G.gdDateDecide(rows[0].id, true, '')) && rows[0].date === today && rows[0].dateAsk.status === 'waiting' && !writes().length);
  delete G.ctx.ptCas;

  /* RFD receipts */
  const sentRow = bales => row('b', 'ISSUE_TO_RFD', yesterday, Object.assign({ qty: 500 }, bales ? { bales } : {}));
  const rfdDesk = bales => G.setDB({ gpo: [{ id: 'g1', poNo: 'PO/1', date: dayBefore(yesterday), mill: 'Test Mills', sent: { at: dayBefore(yesterday) }, lines: [{ rfd: 'Sheeting 72', greige: 'Greige Sheeting 80', metres: 500, rate: 50 }] }],
    fab: [row('a', 'RECEIVE_GREIGE', dayBefore(yesterday), { chId: 'c1' }), sentRow(bales)], mst, ven: [], co: {}, users: [], me: '' });
  const receiveRfd = (typed, metres, no) => {
    asStore(); G.ctx.__writes = [];
    try { G.rrOpen('PO/1'); } catch (e) { /* the fake page may stop the drawing */ }
    G.getRR().thans['LOT-001'] = metres.map((m, i) => ({ than: String(i + 1), m: String(m) }));
    els.rrNo.value = no || 'PC-1'; els.rrDate.value = typed;
    G.rrSave();
    return fabOf('RECEIVE_RFD');
  };
  console.log('== Receive RFD: another day waits for accounts too ==');
  rfdDesk(['1', '2', '3', '4']);
  rows = receiveRfd(yesterday, [100, 100]);
  ok('a back-dated RFD receipt is saved today with a waiting ask', rows.length === 1 && rows[0].date === today && rows[0].dateAsk && rows[0].dateAsk.date === yesterday && rows[0].dateAsk.status === 'waiting', JSON.stringify(rows[0]));
  ok('…it is on the list of dates waiting, as an RFD receipt', G.gdDateAskItems().length === 1 && G.gdDateAskItems()[0].kind === 'RFD' && /Receive dates waiting for accounts/.test(G.gdDateAsksHtml()));
  asAccounts();
  ok('…approving moves its date and keeps lot, PO and the processor\'s challan', await G.gdDateDecide(rows[0].id, true, '') === '' && rows[0].date === yesterday && rows[0].lot === 'LOT-001' && rows[0].orderNo === 'PO/1' && rows[0].bill === 'PC-1');
  rfdDesk(['1', '2', '3', '4']); rows = receiveRfd(today, [100, 100]);
  ok('received today: no ask', rows.length === 1 && !rows[0].dateAsk);
  rfdDesk(['1', '2', '3', '4']); rows = receiveRfd(yesterday, [100, 100]); asStore();
  ok('a non-approver cannot decide an RFD date', /Only Ravi/.test(await G.gdDateDecide(rows[0].id, true, '')) && rows[0].date === today);
  asAccounts();
  ok('a refused RFD date stays on today', await G.gdDateDecide(rows[0].id, false, 'wrong day') === '' && rows[0].date === today && rows[0].dateAsk.status === 'refused');

  console.log('== Receive RFD: the lot closes by itself (no tick) ==');
  const lotClosed = () => !!G.fabLot('LOT-001').closed;
  const code = fs.readFileSync(SRC, 'utf8');
  ok('the "this closes the lot" tick is gone from the dialog, the note says the lot closes by itself', !/data-rrfin/.test(code) && !/whole lot back \(close it\)/.test(code) && /The lot closes by itself when all its thans are back/.test(code));
  rfdDesk(['1', '2', '3', '4']); receiveRfd(today, [125, 125, 125], 'P1');
  ok('thans listed: 3 of the 4 thans sent are back, the lot stays open and the receipt is not final', !lotClosed() && fabOf('RECEIVE_RFD')[0].final === false && G.fabLot('LOT-001').withProcessor === 125);
  receiveRfd(today, [110], 'P2');
  ok('…the 4th than makes all 4 back: the lot closes by itself', lotClosed() && fabOf('RECEIVE_RFD')[1].final === true);
  rfdDesk(['1', '2', '3', '4']); receiveRfd(today, [250, 245], 'P1');
  ok('thans listed: 490 of 500 m is over 95% but only 2 of 4 thans are back, so the lot stays open (thans decide, not metres)', !lotClosed());
  rfdDesk(null); receiveRfd(today, [200, 270], 'P1');
  ok('no thans listed: 470 of 500 m is under 95%, the lot stays open', !lotClosed() && fabOf('RECEIVE_RFD')[0].final === false);
  receiveRfd(today, [10], 'P2');
  ok('…then 480 of 500 m is back (96%): the lot closes by itself', lotClosed() && fabOf('RECEIVE_RFD')[1].final === true);
  rfdDesk(null); receiveRfd(today, [475], 'P1');
  ok('no thans listed: exactly 95% closes it', lotClosed());
  rfdDesk(['1', '2', '3', '4']); receiveRfd(today, [110, 110, 110, 110], 'P1');
  ok('all 4 thans back with 440 of 500 m (12% loss): the receipt is the closing one', fabOf('RECEIVE_RFD')[0].final === true);
  ok('…more than 5% on a lot that closes still waits for the shrinkage approval, as before: not counted, cloth still at the processor', fabOf('RECEIVE_RFD')[0].approval && fabOf('RECEIVE_RFD')[0].approval.status === 'pending' && fabOf('RECEIVE_RFD')[0].approval.pct === 12 && G.rrApprovalsHtml().includes('RFD receipts waiting for approval') && G.fabLot('LOT-001').withProcessor === 500, JSON.stringify(fabOf('RECEIVE_RFD')[0].approval));
  rfdDesk(['1', '2', '3', '4']); receiveRfd(today, [120, 120, 120, 120], 'P1');
  ok('…and within 5% (96%) it goes straight into stock', lotClosed() && !fabOf('RECEIVE_RFD')[0].approval);
  rfdDesk(['1', '2', '3', '4']); receiveRfd(today, [100, 100, 100], 'P1');
  ok('a lot left open carries no shrinkage ask, however little came', !fabOf('RECEIVE_RFD')[0].approval);

  /* the bell: approvers only, all three kinds */
  console.log('== the bell: My work today lists the dates waiting, for approvers only ==');
  const FR_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'friendly.js'), 'utf8').replace(/\r\n/g, '\n');
  const cut = FR_SRC.slice(FR_SRC.indexOf('function frPrnWaiting'), FR_SRC.indexOf('/** Every card')), cards = FR_SRC.slice(FR_SRC.indexOf('function frCards'), FR_SRC.indexOf('/** What the page needs'));
  const bell = (approver, deskItems, chs, flowCh) => new Function('flowPrnMay', 'FR', 'FLOW', 'flowPrnWaiting', 'frMay', 'frTry', 'frNum', 'frQ', 'frWhen', 'showTab', 'GD', 'flowPrnApprove', 'flowEnsureData', 'ME', 'flowDateAsksWaiting', 'flowDateDecide', 'flowLoad',
    cut + '\n' + cards + '\n;return frCards;')(undefined, { dem: null, fg: [], chs }, { dem: null, ch: flowCh || null }, undefined, t => approver && t === 'gdpoappr', (f, d) => { try { return f(); } catch (e) { return d; } }, v => Number(v) || 0, s => s, () => {}, () => {},
    { state: () => 'ok', dateAsks: () => deskItems, dateAsksIn: () => deskItems, ensure: async () => {}, dateDecide: async () => '' }, async () => '', async () => {}, { admin: false, tabs: [] },
    chs2 => Object.entries(chs2 || {}).flatMap(([no, ch]) => Object.entries(ch.receipts || {}).filter(([, r]) => r.dateAsk && r.dateAsk.status === 'waiting').map(([id, rc]) => ({ no, id, rc, ask: rc.dateAsk, ch }))), async () => '', async () => {});
  const deskItems = [{ id: 'f1', kind: 'Greige', no: 'CH-1', po: 'PO/9', ask: { date: yesterday, by: 'a@x' }, m: 220 }, { id: 'f2', kind: 'RFD', no: 'PC-1', po: 'PO/1', ask: { date: yesterday, by: 'b@x' }, m: 200 }];
  const flowCh = { 'RFD-1': { no: 'RFD-1', orderNo: 'AMZ-1', receipts: { r1: { date: today, items: { K1: 10 }, dateAsk: { date: yesterday, status: 'waiting', by: 'c@x' } }, r2: { date: today, items: { K1: 5 }, dateAsk: { date: yesterday, status: 'approved' } } } } };
  const titles = c => c.map(x => x.title);
  const all = bell(true, deskItems, null, flowCh)();
  ok('an approver sees all three kinds: greige, RFD and printed goods', all.length === 3 && /^Receive date · Greige · CH-1/.test(all[0].title) && /^Receive date · RFD · PC-1/.test(all[1].title) && /^Receive date · Printed goods · RFD-1/.test(all[2].title), JSON.stringify(titles(all)));
  ok('…each has Approve and an Open button, and none goes in "Approve all"', all.every(c => c.act && c.act.label === 'Approve' && typeof c.act.run === 'function' && typeof c.open === 'function' && !c.act.bulk));
  ok('…a printed-goods ask the bell read for itself (flow not loaded) shows too', bell(true, [], { 'RFD-1': flowCh['RFD-1'] }, null)().length === 1);
  ok('a person without the right sees none', bell(false, deskItems, null, flowCh)().length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
