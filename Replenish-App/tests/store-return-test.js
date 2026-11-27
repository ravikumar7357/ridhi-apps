/* STORE RECEIVE AND RETURN (Ravi, 24 Nov: "receive krne ke bad vendor order yaha store me dikhne chahiye in out me ... cut pcs ho chah running, and ye
 * return ka option bhi chahiye ... jaha se aaya wahi wapas jana chahiye, same method me jisase order track rahe").
 *   node tests/store-return-test.js
 * Loads src/app/inventory/store.js alone with its neighbours stubbed. What must hold: a receipt on a challan comes into the store as "Store receive",
 * whether it is running cloth (m) or cut pieces (pcs); pieces given to a karigar go out only for SKUs a printer delivered here; a Return takes at most what is
 * left of one receipt, needs a reason, is a store OUT "Returned to <printer>", and carries the order; the entries list shows the history tiles and a Return
 * button for a receipt that has something left; and a store Return shows in the order's journey.
 * THE PAGE (25 Nov): the list of what printers sent is gone from this screen (receiving is on Vendor Orders); the store list comes whole (no pages), with
 * quick filters and a Returned column; and the Return button, which sits in the entries dialog, is heard wherever it is on the page. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SRC = rd('src/app/inventory/store.js'), VH = rd('src/app/orders/vendor-holdings.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' - ' + extra : '')); } };

function load(o) {
  o = o || {};
  const els = {}, puts = [], pageClicks = [];
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', className: '', title: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, onclick: null, onchange: null });
  const ctx = {
    $: el, localStorage: { getItem: () => null, setItem() {} }, document: { addEventListener: (type, fn) => { if (type === 'click') pageClicks.push(fn); }, querySelectorAll: () => [], querySelector: () => null },
    esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
    nf: v => String(v), ptIsoDate: v => String(v || '').slice(0, 10), attToday: () => '2026-11-24', ptCanEdit: () => true, PT_NO_EDIT: 'no', ME: { email: 'ravi@x' },
    ptCi: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase(), alert() {},
    fabFilters: () => ({ q: '', fab: '', col: '', d1: '', d2: '' }), FAB: { rows: [], shown: null }, PTG: { mdb: [] },
    __STORE: { rows: o.rows || [{ id: 'o1', kind: 'OPENING', unit: 'm', fabric: 'Sheeting 62', colour: 'Sage Green', qty: 10, at: '2026-10-14T09:00:00Z', date: '2026-10-14' }], checks: {}, at: 'now', busy: false, err: '' },
    voLogRows: () => [], FLOW_ON: true, FLOW: { ppc: {} }, flowKey: (a, b) => a + '__' + b, cutSkuOf: () => ({ color: 'Light Steel Blue' }), mdbOf: sku => ({ sku, color: 'Light Steel Blue' }),
    flowPrintWhat: () => ({ kind: 'fabric', code: '' }),
    flowVlogRows: () => o.vlog || [],
    PT: { cut: [], base: o.base || [] }, vprPendingAll: () => (o.pend === undefined ? [] : o.pend), flowMay: () => o.may !== false, CSS: { escape: s => s },
    ptEmpty: (id, text) => { el(id).innerHTML = ''; el(id).emptyText = text; }, ptImgSpan: () => '', ptImgFill() {}, ptIfTab: (t, f) => f, ptImgPatch() {},
    ptOpenDialog: cfg => { ctx.__dlg = cfg; }, cutFabrics: () => [], ptDownload() {}, csvCell: v => String(v), renderFab() {},
    fabKey: v => String(v || '').trim().toUpperCase(), obUC: v => String(v == null ? '' : v).trim().toUpperCase(), ptCutPerPiece: () => 0, ptPrintIssueAs: () => 'running', ensureStore() {},
    ptPut: async (p, v) => { if (o.putFails) throw new Error('offline'); puts.push([p, v]); }, ptDelete: async () => {}, ptList: v => Object.keys(v || {}).map(k => v[k]),
  };
  const keys = Object.keys(ctx);
  const fn = new Function(...keys, SRC + '\n;Object.assign(STORE, __STORE);return { stMoves, stBalances, stReturnSave, stReturnLeft, stReturnOpen, stEntriesOpen, stKey, stPickHas, renderStoreHand, STORE };');
  return Object.assign(fn(...keys.map(k => ctx[k])), { els, ctx, puts, pageClicks });
}

/* a receipt row, as flowVlogRows gives it */
const row = (key2, unit, over) => Object.assign({ key2, unit, qty: 100, at: '2026-11-24T10:00:00Z', day: '2026-11-24', vendor: 'RBP-Bagru', vendorCode: 'VND001', id: 'RFD-202611-465',
  orderNo: 'RFD-202611-465 · AMZ-24112026-01', ordNo: 'AMZ-24112026-01', sku: 'RTC327-6060', fabric: '', colour: 'Light Steel Blue', test: false, by: 'ravi@x' }, over || {});
const VL = [row('flow/RFD-1/r1/A', 'pcs', { qty: 10 }), row('flow/RFD-1/r1/B', 'm', { qty: 31.6, sku: 'RB-12', fabric: 'Cambric', colour: 'Agate Green' })];

console.log('== a receipt comes into the store as "Store receive" ==');
{
  const S = load({ vlog: VL });
  const mv = S.stMoves().filter(m => m.src === 'printer');
  ok('both the cut pieces (pcs) and the running cloth (m) come in', mv.length === 2 && mv.some(m => m.unit === 'pcs' && m.qty === 10 && m.sku === 'RTC327-6060') && mv.some(m => m.unit === 'm' && m.qty === 31.6 && m.fabric === 'Cambric'), JSON.stringify(mv.map(m => [m.unit, m.qty])));
  ok('…named "Store receive · from <printer> · challan", with printer, challan and order on the move', mv.every(m => /^Store receive · from RBP-Bagru · RFD-202611-465$/.test(m.what) && m.printer === 'RBP-Bagru' && m.challan === 'RFD-202611-465' && m.orderNo === 'AMZ-24112026-01'), JSON.stringify(mv[0]));
  const S2 = load({ vlog: [row('t', 'pcs', { test: true })] });
  ok('a TEST challan does not come in', S2.stMoves().filter(m => m.src === 'printer').length === 0);
  const S3 = load({ vlog: [row('old', 'pcs', { at: '2026-10-10T10:00:00Z' })] });
  ok('a receipt before 16 Oct is not counted again (it is in the hand-typed figures)', S3.stMoves().filter(m => m.src === 'printer').length === 0);
}
console.log('== pieces given to a karigar go out only for SKUs a printer delivered here ==');
{
  const base = [{ id: 'b1', sku: 'RTC327-6060', issuePieces: 4, addedAt: '2026-11-24T12:00:00Z', issueDate: '2026-11-24', empName: 'Mohan' },
    { id: 'b2', sku: 'OTHER-1', issuePieces: 9, addedAt: '2026-11-24T12:00:00Z', issueDate: '2026-11-24', empName: 'Mohan' }];
  const S = load({ vlog: VL, base });
  const mv = S.stMoves(), jw = mv.filter(m => m.src === 'jobwork');
  ok('the received SKU has its issue out; a SKU never delivered through a challan has none', jw.length === 1 && jw[0].sku === 'RTC327-6060' && jw[0].qty === -4, JSON.stringify(jw.map(m => [m.sku, m.qty])));
  const pcs = S.stBalances(mv).find(b => b.unit === 'pcs');
  ok('the shelf of those pieces = 10 received - 4 issued = 6', pcs && pcs.qty === 6, pcs && pcs.qty);
}
console.log('== the store page: no list of what printers sent, the whole list, quick filters ==');
{
  ok('the list of what printers sent is gone from the store code (receiving is on Vendor Orders)', !/stPendHtml|data-stg-go|waiting to be received/.test(SRC));
  /* 60 cloth lines and one SKU, typed in */
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ id: 'c' + i, kind: 'OPENING', unit: 'm', fabric: 'Cambric', colour: 'Shade ' + String(i).padStart(2, '0'), qty: 5, at: '2026-10-14T09:00:00Z', date: '2026-10-14' });
  rows.push({ id: 'p1', kind: 'OPENING', unit: 'pcs', sku: 'ZZ-1', qty: 4, at: '2026-10-14T09:00:00Z', date: '2026-10-14' });
  rows.push({ id: 'p2', kind: 'OUT', unit: 'pcs', sku: 'ZZ-1', qty: 6, at: '2026-10-15T09:00:00Z', date: '2026-10-15' });
  const S = load({ rows, vlog: VL });
  const draw = () => { S.renderStoreHand(); return { k: S.els.fbKpis.innerHTML, t: S.els.fbTable.innerHTML }; };
  const lines = h => (h.match(/data-st-ent=/g) || []).length;
  let d = draw();
  ok('nothing about receiving is drawn on the store', !/Sent by printers|Receive<\/button>/.test(d.k + d.t));
  ok('63 items: all 63 are drawn in one go, with no Previous / Next', lines(d.t) === 63 && !/data-st-page|Showing/.test(d.t), String(lines(d.t)));
  ok('…and the paging is gone from the store code', !/stPageOf|ST_PAGE|data-st-page/.test(SRC));
  ok('the filters carry their counts: All 63, Cloth 61, Pieces 2, Below zero 1, Returned 0', /data-st-pick="all">All <span class="muted">63</.test(d.k) && /data-st-pick="m">[^<]*<span class="muted">61</.test(d.k)
    && /data-st-pick="pcs">[^<]*<span class="muted">2</.test(d.k) && /data-st-pick="neg">[^<]*<span class="muted">1</.test(d.k) && /data-st-pick="ret">[^<]*<span class="muted">0</.test(d.k), d.k.slice(-700));
  S.STORE.pick = 'neg'; d = draw();
  ok('Below zero shows only the SKU taken out beyond its stock, ', lines(d.t) === 1 && /ZZ-1/.test(d.t) && /data-st-pick="neg"/.test(d.k) && /segbtn on" data-st-pick="neg"/.test(d.k));
  S.STORE.pick = 'ret'; d = draw();
  ok('Returned with nothing returned: says so and points back to All', lines(d.t) === 0 && /No item under this filter/.test(S.els.fbMsg.textContent) && /press "All"/.test(S.els.fbTable.emptyText));
}
console.log('== Out is what really left the shelf ==');
{
  ok('Out counts only what really left the shelf: 4 issued of the 10 received shows Out 4, and 9 issued of a SKU never delivered is not an Out', (() => {
    const S2 = load({ vlog: VL, base: [{ id: 'b1', sku: 'RTC327-6060', issuePieces: 4, addedAt: '2026-11-24T12:00:00Z', issueDate: '2026-11-24' }] });
    const b = S2.stBalances(S2.stMoves()).find(x => x.unit === 'pcs'); return b && b.inQty === 10 && b.outQty === 4 && b.qty === 6;
  })());
  ok('…an issue BEFORE the first delivery is "beyond": it no longer shows as an Out (In 10, Out 0, shelf 10)', (() => {
    const S3 = load({ vlog: VL, base: [{ id: 'b0', sku: 'RTC327-6060', issuePieces: 10, addedAt: '2026-11-24T09:00:00Z', issueDate: '2026-11-24' }] });
    const b = S3.stBalances(S3.stMoves()).find(x => x.unit === 'pcs'); return b && b.inQty === 10 && b.outQty === 0 && b.qty === 10 && b.beyond === 10;
  })());
}
console.log('== Return to the printer ==');
{
  const S = load({ vlog: VL });
  const mv = () => S.stMoves().find(m => m.src === 'printer' && m.unit === 'pcs');
  ok('nothing returned yet: all 10 can go back', S.stReturnLeft(mv()) === 10);
  (async () => {
    ok('no reason: refused', /Say why/.test(await S.stReturnSave(mv(), { qty: 3, reason: '' })));
    ok('more than came: refused, says how many are left', /Only 10 pcs/.test(await S.stReturnSave(mv(), { qty: 11, reason: 'bad print' })));
    ok('half a piece: refused', /whole number/.test(await S.stReturnSave(mv(), { qty: 2.5, reason: 'bad print' })));
    ok('nothing was saved by the refusals', S.puts.length === 0);
    const err = await S.stReturnSave(mv(), { qty: 3, reason: 'colour is wrong' });
    ok('3 back with a reason: saved', err === '' && S.puts.length === 1, err);
    const rec = S.puts[0] && S.puts[0][1];
    ok('…as a RETURN row in the store book, with printer, challan, order, SKU and the receipt it came from',
      rec && rec.kind === 'RETURN' && rec.qty === 3 && rec.printer === 'RBP-Bagru' && rec.printerCode === 'VND001' && rec.challan === 'RFD-202611-465' && rec.orderNo === 'AMZ-24112026-01'
        && rec.sku === 'RTC327-6060' && rec.ref === 'flow/RFD-1/r1/A' && rec.reason === 'colour is wrong' && /^pt_storeLedger\//.test(S.puts[0][0]), JSON.stringify(rec));
    const out = S.stMoves().find(m => m.kind === 'RETURN');
    ok('…and it is a store OUT: "Returned to RBP-Bagru · RFD-202611-465", -3, with the order and the reason on it', out && out.qty === -3 && out.what === 'Returned to RBP-Bagru · RFD-202611-465' && /AMZ-24112026-01/.test(out.remark) && /colour is wrong/.test(out.remark), JSON.stringify(out));
    const bal = S.stBalances(S.stMoves()).find(b => b.unit === 'pcs');
    ok('…so the shelf is 10 - 3 = 7', bal && bal.qty === 7, bal && bal.qty);
    ok('7 can still go back from that receipt', S.stReturnLeft(mv()) === 7);
    ok('…and 8 cannot', /Only 7 pcs/.test(await S.stReturnSave(mv(), { qty: 8, reason: 'x' })));
    S.stEntriesOpen(S.stKey({ unit: 'pcs', sku: 'RTC327-6060' }));
    const h = S.ctx.__dlg.html;
    ok('the entries list has the history tiles: Came in 10, Returned to printers 3, On the shelf 7', /Came in/.test(h) && /Returned to printers/.test(h) && /On the shelf/.test(h) && />10<\/div>/.test(h) && />3<\/div>/.test(h) && />7<\/div>/.test(h), h.slice(0, 500));
    ok('…and a Return button on the receipt (7 left), none on the typed return itself', (h.match(/data-st-ret=/g) || []).length === 1);
    ok('…the returned row is labelled "returned to printer"', /returned to printer/.test(h));
    ok('…a receipt partly returned says how much can still go back', /7 pcs of this receipt can still go back/.test(h));
    ok('…and the return itself can be undone (it was entered by mistake)', /data-st-del="[^"]+"[^>]*>Undo return</.test(h));
    S.STORE.pick = 'ret'; S.renderStoreHand();
    ok('the store list has a Returned column (3) apart from Out (0), and the total says 3 pcs went back', /<th class="num">Returned<\/th>/.test(S.els.fbTable.innerHTML)
      && /Sent back to the printer it came from">3<\/td>/.test(S.els.fbTable.innerHTML) && /3 pcs<\/div><div class="l">Returned to printers/.test(S.els.fbKpis.innerHTML), S.els.fbTable.innerHTML.slice(0, 900));
    const b3 = S.stBalances(S.stMoves()).find(x => x.unit === 'pcs');
    ok('…the balance row carries returned 3 inside Out 3', b3 && b3.returned === 3 && b3.outQty === 3, JSON.stringify(b3));
    /* the Return button is in the dialog, not in the store table: a click anywhere on the page must open the return */
    S.ctx.__dlg = null;
    const click = sel => ({ preventDefault() {}, target: { closest: s => (s === sel ? { getAttribute: () => 'flow/RFD-1/r1/A', disabled: false } : null) } });
    for (const fn of S.pageClicks) await fn(click('[data-st-ret]'));
    ok('pressing Return in the entries dialog opens "Return to RBP-Bagru", asking how many (up to 7) and why', S.ctx.__dlg && S.ctx.__dlg.title === 'Return to RBP-Bagru'
      && S.ctx.__dlg.fields.some(f => f.key === 'qty' && f.value === 7 && /up to 7 pcs/.test(f.label)) && S.ctx.__dlg.fields.some(f => f.key === 'reason'), JSON.stringify(S.ctx.__dlg && S.ctx.__dlg.title));
    const ret = S.ctx.__dlg; ret.onCancel();
    ok('…Cancel goes back to the entries of the item', S.ctx.__dlg && /^Entries — RTC327-6060/.test(S.ctx.__dlg.title));
    const e2 = await S.stReturnSave(mv(), { qty: 7, reason: 'rest too' });
    S.stEntriesOpen(S.stKey({ unit: 'pcs', sku: 'RTC327-6060' }));
    ok('all returned: no Return button is left, and the receipt says all of it went back', e2 === '' && !/data-st-ret=/.test(S.ctx.__dlg.html) && /all of this receipt went back/.test(S.ctx.__dlg.html));
    const F = load({ vlog: VL, putFails: true });
    ok('a failed save says so and keeps nothing', /Not saved/.test(await F.stReturnSave(F.stMoves().find(m => m.src === 'printer'), { qty: 1, reason: 'x' })) && F.stMoves().every(m => m.kind !== 'RETURN'));
    const M = load({ vlog: VL });
    ok('running cloth goes back in metres (31.6 m: 40 refused, 10.5 taken)', /Only 31.6 m/.test(await M.stReturnSave(M.stMoves().find(m => m.unit === 'm' && m.src === 'printer'), { qty: 40, reason: 'x' }))
      && (await M.stReturnSave(M.stMoves().find(m => m.unit === 'm' && m.src === 'printer'), { qty: 10.5, reason: 'x' })) === '');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  })();
}
