/* PACKING AN FBA LIST (28 Nov): with FBA lists on, Pack & verify and Scan to pack pack a list, and no stock leaves.
 * The real list rules (fba-lists.js) and both packing screens, over a made-up database.
 *   node tests/fba-pack-test.js      (teeth/teeth-fba-pack.js runs it against broken copies) */
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
/* the real savePkOne and pkDelete, cut out of their screens; savePkOne is renamed so the scenarios can wrap it */
function cut(src, start) {
  const s = src.replace(/\r\n/g, '\n'), at = s.indexOf(start);
  const body = s.slice(at, s.indexOf('\n}\n', at) + 3);
  return body;
}
const R = (f, env) => fs.readFileSync(process.env[env] || path.join(APP, f), 'utf8');
const SRC = [R('replenishment/pack-core.js', 'PKC_SRC'), R('replenishment/pack-scan.js', 'PKS_SRC'),
  R('inventory/fba-lists.js', 'FBL_SRC'), R('inventory/pack-verify.js', 'PKV_SRC'),
  cut(R('replenishment/packing-list-labels.js', 'PKL_SRC'), 'async function savePkOne'),
  cut(R('replenishment/fba-box-template.js', 'PKB_SRC'), 'async function pkDelete')].join('\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const copy = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const tick = () => new Promise(r => setTimeout(r, 5));

const aList = o => Object.assign({ account: 'CPC FBA', store: 'CPC', lane: 'sea', status: 'open', by: 'team@test', at: '2026-11-28T05:00:00.000Z',
  lines: { A: { sku: 'A', qty: 2, packed: 0 } } }, o);

/** o: { sw: '1' | '0', tab (false: no FBA Dispatch tab), repl (false: no Packing List right), entry (stock-entry right), lists,
 *  docs, readFails, saveFails, deleted } */
function load(o = {}) {
  const els = {}, dialogs = [], patches = [], writes = [], msgs = [], drawn = { fba: 0 };
  const lists = copy(o.lists || { L1: aList(), GONE: aList({ status: 'shipping' }) });
  const docs = copy(o.docs || {});
  const mk = id => ({ id, value: '', textContent: '', innerHTML: '', className: '', style: {}, disabled: false, classList: { toggle() {}, add() {}, remove() {} },
    focus() {}, remove() {}, prepend() {}, addEventListener() {}, onclick: null });
  /* an id is on the page only when the dialog or panel just drawn has it */
  const FIXED = /^(pkvList|pkvAcc|pkvOrds|pkvPlanBtn|pkvResume|pkvPlanTa|pkvCloseForm|pksDoneAcc|pksDoneHand|pksQcBox)$/;
  const el = id => {
    if (FIXED.test(id) && !els[id] && !dialogs.some(d => (d.html || '').includes(`id="${id}"`))) return null;
    return els[id] || (els[id] = mk(id));
  };
  const at = p => (p === 'pt_fgiSettings/_fbaLists' ? lists : p.startsWith('pt_fgiSettings/_fbaLists/') ? lists[p.split('/')[2]] : null);
  const ctx = {
    $: el, document: { createElement: () => mk('x'), body: { appendChild() {} }, head: { appendChild() {} }, querySelector: () => null }, window: {}, navigator: {},
    localStorage: { getItem: k => (k === 'fbaList' ? o.sw || '1' : null), setItem() {}, removeItem() {} }, fgaOn: () => true,
    ME: { email: 'team@test', repl: o.repl !== false, fgiEntry: !!o.entry }, fbaCan: () => o.tab !== false, fgiCanEntry: () => !!o.entry, FGI_NO_ENTRY: 'no stock right', FGI_FBA_ACCOUNTS: ['Ridhi FBA', 'CPC FBA'],
    obUC: s => String(s == null ? '' : s).trim().toUpperCase(), shpHoldKey: s => String(s).trim().toUpperCase(), pkNum: v => Number(v) || 0, fgiNum: v => Number(v) || 0,
    nf: String, esc: String, ptDayWords: d => String(d).slice(0, 10), fblvTitle: l => l.lane + ' · ' + l.account, confirm: () => true,
    ptGetFresh: async p => { if (o.readFails) throw new Error('no signal'); return copy(at(p)); },
    ptCas: async (p, expect, next) => { writes.push(p); lists[p.split('/')[2]] = copy(next); return ''; },
    ptPatch: async patch => { patches.push(patch); }, ptGet: async () => ({}), ptList: v => Object.values(v || {}),
    db: {}, doc: (_, c, id) => id, getDoc: async id => ({ exists: () => !!docs[id], data: () => copy(docs[id]) }),
    setDoc: async (id, p) => { if (o.saveFails) throw new Error('offline'); docs[id] = copy(p); }, deleteDoc: async id => { delete docs[id]; },
    renderPack() {}, shpListsOn: () => true,
    FGI: { rows: [], set: {}, err: '' }, fgiLoad: async () => {}, fgiStockReread: async () => '', fgiOf: () => ({ current: 0 }),
    fgiOutCheck: () => '', fgiOutAlloc: () => ({ orders: [] }), fgiOutOrders: () => [], ordLines: () => [], fgiOrderKnown: () => true,
    fgiNewId: p => p + '-X', fbaBadge() {}, fgiOverBadge() {}, lstAlertFor: async () => '', renderFgi() {}, renderFba: () => { drawn.fba++; }, renderPack() {},
    FN: { map: new Map() }, fnLoad: async () => {}, PTG: { mdb: [{ sku: 'A' }, { sku: 'B' }] }, PK_META: {}, mdbOf: () => null, replRowMap: () => ({}),
    pkLookupSku: () => ({}), pkTotals: p => ({ boxes: (p.boxes || []).length, qty: 0 }), PK_WT: {}, PK_LOADED: true, loadPk: async () => {}, loadPkWt: async () => {},
    savePkWt: async () => {}, PK_DEF: { pkgWt: 1.5, volDiv: 5000 }, pkToday: () => '2026-11-28', pkId: () => 'PKNEW', pkMsg: t => msgs.push(t),
    ptOpenDialog: c => { dialogs.length = 0; Object.keys(els).filter(k => /^(pk[sv])/.test(k)).forEach(k => delete els[k]); dialogs.push(c); }, ptDlgClose() {},
    setTimeout, clearTimeout,
  };
  const body = Object.keys(ctx).filter(k => k !== 'PK_ADD');
  const api = new Function('PK_START', 'REG', ...body, `let PK = PK_START;
    REG(p => { PK = [p].concat(PK.filter(x => x.id !== p.id)); });
    ${SRC}
    return { PKS, PKV: () => PKV.p, pkvOpen, pkvOpenFbaList, pkvStart, pkvOnCode, pkvFinish, pksStart, pksCount, pksFinishAsk, pksDone,
      packScanNew, packOrderLines, packLedgerWrite, pkvTakeOut, pkvSaveNow, savePkOne, pkDelete, pksOpen, pksHit, packFbaSession, saveT: () => PKV.saveT };`)(Object.values(docs).map(copy), f => { ctx.PK_ADD = f; }, ...body.map(k => ctx[k]));
  return Object.assign(api, { els, el, dialogs, patches, writes, msgs, lists, docs, drawn });
}
const boxed = (p, sku, qty) => Object.assign(p, { boxes: [{ n: 1, items: [{ sku, qty }] }] });
const listSession = qty => boxed({ id: 'PK-L1', account: 'CPC FBA', scan: { orders: [], plan: [{ sku: 'A', qty: 2 }], planNo: 'L1', fbaListId: 'L1', packed: {}, wrong: [], ledgerIds: [] } }, 'A', qty);

(async () => {
  console.log('== Finish: saved on the list, no stock rows ==');
  let A = load(), p = listSession(2), r = await A.packLedgerWrite(p, 'Raju');
  ok('saved as packed on the list, with the pack id', !r.err && r.fbaList && A.lists.L1.status === 'packed' && A.lists.L1.lines.A.packed === 2 && A.lists.L1.packId === 'PK-L1', JSON.stringify(r));
  ok('no ledger row, no ledger id; marked done with the handover', A.patches.length === 0 && p.scan.ledgerIds.length === 0 && p.scan.done && p.scan.handoverTo === 'Raju');
  r = await A.packLedgerWrite(p, 'Raju');
  ok('Finish again is safe', !r.err && A.lists.L1.lines.A.packed === 2 && A.patches.length === 0);
  r = await A.packLedgerWrite(boxed(p, 'A', 3), '');
  ok('more than the list is refused', /no more than that/.test(r.err) && A.lists.L1.lines.A.packed === 2);
  r = await A.packLedgerWrite(boxed(p, 'B', 1), '');
  ok('a SKU not on the list is refused', /not on this FBA list/.test(r.err));
  r = await A.packLedgerWrite({ id: 'E', boxes: [], scan: p.scan }, '');
  ok('empty boxes: nothing packed yet', /Nothing packed/.test(r.err) && A.lists.L1.lines.A.packed === 2);
  A = load({ entry: true });
  r = await A.packLedgerWrite(boxed({ id: 'BOX', account: 'Ridhi FBA', scan: null }, 'A', 1), '');
  ok('a free box list writes no stock-out row', /only through an FBA list/.test(r.err) && A.patches.length === 0 && A.writes.length === 0);
  A = load({ sw: '0', entry: true });
  r = await A.packLedgerWrite(listSession(1), '');
  ok('switch off: a list session still writes no stock rows', /switched off/.test(r.err) && A.patches.length === 0);

  console.log('== only the list counts ==');
  A = load();
  const ls = A.packOrderLines(listSession(0).scan);
  ok('a list line holds its own quantity as the store figure', ls.length === 1 && ls[0].store === 2 && ls[0].qty === 2 && ls[0].orderNo === 'L1', JSON.stringify(ls));

  console.log('== Pack & verify ==');
  A = load();
  await A.pkvOpen();
  const html = A.dialogs[0].html;
  ok('FBA tab, no stock right: opens, offering open lists only, no orders or plan boxes', /value="L1"/.test(html) && !/value="GONE"/.test(html) && !/pkvOrds|pkvPlanBtn|pkvAcc/.test(html), html);
  await A.pkvStart();
  ok('no list chosen: said, nothing made', /Choose an FBA list/.test(A.els.pkvMsg.textContent) && !Object.keys(A.docs).length);
  A.el('pkvList').value = 'L1'; await A.pkvStart();
  p = A.PKV();
  ok('one packing list for the FBA list, account from it', p && p.id === 'PK-L1' && p.account === 'CPC FBA' && p.scan.fbaListId === 'L1' && p.scan.planNo === 'L1' && Object.keys(A.docs).length === 1);
  A.pkvOnCode('A', 'camera'); A.pkvOnCode('B', 'camera'); A.pkvOnCode('A', 'camera'); A.pkvOnCode('A', 'camera');
  ok('only listed SKUs and pieces count', p.boxes[0].items.length === 1 && p.boxes[0].items[0].qty === 2 && p.scan.wrong.length === 1);
  await A.pkvFinish();
  ok('Finish says it is packed and ships from FBA Dispatch, which is redrawn', A.lists.L1.lines.A.packed === 2 && /ships from FBA Dispatch/.test(A.els.pkvFbSub.innerHTML) && A.drawn.fba === 1 && A.patches.length === 0, A.els.pkvFbSub.innerHTML);

  const had = listSession(1);
  had.scan.plan = [{ sku: 'A', qty: 9 }];
  A = load({ docs: { 'PK-L1': had } });
  await A.pkvOpenFbaList('L1');
  p = A.PKV();
  ok('from FBA Dispatch: the saved packing carries on, with the list as it is now', p.id === 'PK-L1' && p.boxes[0].items[0].qty === 1 && p.scan.plan[0].qty === 2 && Object.keys(A.docs).length === 1);
  A = load();
  await A.pkvOpenFbaList('GONE');
  ok('a list no longer open: said in the dialog, nothing made', /no longer open/.test(A.els.pkvMsg.textContent) && !A.PKV() && !Object.keys(A.docs).length);
  A = load({ tab: false, entry: true });
  await A.pkvOpenFbaList('L1');
  ok('without the FBA Dispatch tab: refused', /FBA team/.test(A.els.pkvMsg.textContent) && !Object.keys(A.docs).length);
  A = load({ saveFails: true });
  await A.pkvOpenFbaList('L1');
  ok('the packing list cannot be made: said', /Could not open the packing list/.test(A.els.pkvMsg.textContent) && !A.PKV());
  A = load({ sw: '0', entry: true });
  await A.pkvOpen();
  ok('switch off: orders and plan as before', /pkvOrds/.test(A.dialogs[0].html) && !/pkvList/.test(A.dialogs[0].html));

  console.log('== Scan to pack ==');
  A = load({ tab: false, entry: true });
  await A.pksStart('order');
  ok('without the FBA Dispatch tab a list cannot be opened here either', /FBA team/.test(A.msgs.join('|')) && !A.dialogs.length && !Object.keys(A.docs).length);
  const shippedDoc = Object.assign(listSession(1), { id: 'PK-OLD', title: 'old' });
  shippedDoc.scan.fbaListId = 'OLD';
  A = load({ docs: { 'PK-OLD': shippedDoc } });
  await A.pksStart('order');
  let d = A.dialogs[0];
  ok('pack by order offers FBA lists, no orders or plan; a shipped list is not offered again', /pksFbaPick/.test(d.html) && !/pksOrds|pksPlan|pksAcc/.test(d.html) && !/PK-OLD/.test(d.html), d.html);
  ok('no list chosen: asked', /Choose an FBA list/.test(await d.onSave()));
  A.el('pksFbaPick').value = 'L1';
  ok('a list chosen: its packing list opens', await d.onSave() === '' && A.PKS.p.id === 'PK-L1' && A.PKS.p.scan.fbaListId === 'L1');
  await tick();
  A.pksCount('A'); A.pksCount('A');
  ok('the third piece and an unlisted SKU do not count', A.pksCount('A').ok === false && A.pksCount('B').kind === 'wrong');
  A.pksFinishAsk();
  ok('the finish card: save as packed, ships from FBA Dispatch', /save as packed/.test(A.els.pksCard.innerHTML) && /ships from FBA Dispatch/.test(A.els.pksCard.innerHTML) && !/Send to FBA/.test(A.els.pksCard.innerHTML));
  await A.pksDone();
  ok('Done: packed on the list, no stock rows, said so', A.lists.L1.lines.A.packed === 2 && A.patches.length === 0 && /ships from FBA Dispatch/.test(A.msgs.join('|')), A.msgs.join('|'));
  await A.pksStart('box');
  d = A.dialogs[0];
  await d.onSave(); await tick();
  A.pksCount('A'); A.pksFinishAsk();
  ok('box pack scan: no Done button, says why', /only through an FBA list/.test(A.els.pksCard.innerHTML) && !/pksDoneBtn/.test(A.els.pksCard.innerHTML));
  A.PKS.on = false; clearTimeout(A.PKS.saveT);

  console.log('== shipping fewer: pieces come out of the boxes ==');
  const packedDoc = () => { const d2 = Object.assign(listSession(2), { title: 't' }); d2.scan.packed = { A: { L1: 2 } }; return d2; };
  const packedList = () => ({ L1: aList({ status: 'packed', lines: { A: { sku: 'A', qty: 2, packed: 2 } } }) });
  A = load({ lists: packedList(), docs: { 'PK-L1': packedDoc() } });
  await A.pkvOpenFbaList('L1');
  ok('each boxed piece of a list has a take-out button', /data-pkvout="A"/.test(A.els.pkvBoxes.innerHTML));
  A.pkvOnCode('A', 'camera');
  ok('a full list says FBA list, not order', /FBA LIST FULL/.test(A.els.pkvFbMsg.innerHTML) && !/order/i.test(A.els.pkvFbSub.innerHTML), A.els.pkvFbMsg.innerHTML);
  A.pkvOnCode('B', 'camera');
  ok('a wrong article says not on this FBA list', /not on this FBA list/.test(A.els.pkvFbSub.innerHTML));
  A.pkvTakeOut(1, 'A');
  p = A.PKV();
  ok('one comes out of the box and the packed count', p.boxes[0].items[0].qty === 1 && p.scan.packed.A.L1 === 1);
  await A.pkvSaveNow();
  ok('saved: the list is no longer packed until Finish', A.docs['PK-L1'].boxes[0].items[0].qty === 1 && A.lists.L1.status === 'open' && A.lists.L1.lines.A.packed === 0);
  await A.pkvFinish();
  ok('Finish: the list and the saved packing list agree', A.lists.L1.status === 'packed' && A.lists.L1.lines.A.packed === 1 && A.docs['PK-L1'].boxes[0].items[0].qty === 1);
  A.pkvOnCode('A', 'camera');
  ok('and a piece can be scanned back in', A.PKV().boxes[0].items[0].qty === 2);
  clearTimeout(A.saveT());

  const edited = packedDoc(); edited.boxes[0].items[0].qty = 1;
  A = load({ lists: packedList(), docs: { 'PK-L1': edited } });
  await A.pkvOpenFbaList('L1');
  ok('boxes changed on the Packing List tab count again in the scanner', A.PKV().scan.packed.A.L1 === 1);
  await A.savePkOne(copy(edited));
  ok('saving changed boxes from anywhere unpacks the list', A.lists.L1.status === 'open');
  A = load({ lists: packedList(), docs: { 'PK-L1': packedDoc() } });
  await A.pkDelete('PK-L1');
  ok('deleting the packing list unpacks the list', A.lists.L1.status === 'open' && !A.docs['PK-L1']);
  A = load({ lists: { L1: aList({ status: 'shipping', claimBy: 'bee@test', claimAt: new Date().toISOString() }) }, docs: { 'PK-L1': packedDoc() } });
  let said = '';
  try { await A.savePkOne(copy(edited)); } catch (e) { said = e.message; }
  ok('while it ships the boxes are not saved', /working on this list/.test(said) && A.docs['PK-L1'].boxes[0].items[0].qty === 2, said);
  A = load({ sw: '0', lists: packedList(), docs: { 'PK-L1': packedDoc() } });
  await A.savePkOne(copy(edited));
  ok('switch off: changed boxes of an FBA list still unpack it', A.lists.L1.status === 'open');
  A = load({ sw: '0', lists: packedList() });
  await A.savePkOne({ id: 'PK-plain', boxes: [] });
  ok('switch off: an ordinary packing list touches no FBA list', A.lists.L1.status === 'packed' && A.writes.every(w => !/_fbaLists/.test(JSON.stringify(w))));

  console.log('== who cannot save packing lists ==');
  A = load({ repl: false });
  await A.pkvOpen();
  ok('Pack & verify does not open, and says what to ask for', !A.dialogs.length && /ask an admin to give you the Packing List tab/.test(A.els.fgMsg.textContent));
  await A.pkvOpenFbaList('L1');
  ok('from FBA Dispatch the same, nothing made', /ask an admin/.test(A.els.pkvMsg.textContent) && !Object.keys(A.docs).length);
  A = load({ repl: false });
  await A.pksStart('order');
  ok('Scan to pack the same', !A.dialogs.length && /ask an admin/.test(A.msgs.join('|')));
  A = load({ repl: false, entry: true });
  await A.pkvOpenFbaList('L1');
  ok('the stock-entry right is enough', !!A.PKV() && A.PKV().id === 'PK-L1');

  A = load({ repl: false });
  ok('no packing list is made for them by any way in', /ask an admin/.test((await A.packFbaSession('L1', {})).err) && !Object.keys(A.docs).length);

  console.log('== scanner words ==');
  A = load();
  await A.pksOpen();
  ok('the Scan menu offers an FBA list, not orders', /Pack an FBA list/.test(A.dialogs[0].html) && !/Amazon plan|Pack by order/.test(A.dialogs[0].html));
  await A.pksStart('order');
  ok('and its form is titled so', A.dialogs[0].title === 'Pack an FBA list');
  A.el('pksFbaPick').value = 'L1'; await A.dialogs[0].onSave(); await tick();
  let c = A.pksCount('B');
  ok('wrong article: not on this FBA list', c.why === 'B is not on this FBA list.', c.why);
  A.pksCount('A'); A.pksCount('A'); c = A.pksCount('A');
  ok('full: the FBA list', /on the FBA list is already packed/.test(c.why), c.why);
  A.pksHit('A', 'typed');
  ok('the line said and the card name the list', /the FBA list wants no more/.test(A.els.pksSay.textContent) && /FBA list wants no more/.test(A.els.pksCard.innerHTML), A.els.pksSay.textContent);
  A.PKS.on = false; clearTimeout(A.PKS.saveT);
  A = load({ sw: '0' });
  await A.pksOpen();
  ok('switch off: the menu as before', /Pack by order scan/.test(A.dialogs[0].html));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
