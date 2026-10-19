/* The store typed by hand (Ravi, 14 Oct 2026: "remove all thing bas store stock balance rahega jo batayega ki mere pas
 * printed fabric kitna pada h jise me manually chadaunga"). Loads src/app/inventory/store.js alone with its neighbours
 * stubbed, once in the default (by hand) mode and once with storeAuto = 1.   node tests/store-hand-test.js */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'inventory', 'store.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

function load(ls, extra) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', className: '', title: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, onclick: null, onchange: null });
  const ctx = {
    $: el, localStorage: { getItem: k => (ls || {})[k] ?? null, setItem() {} }, document: { querySelectorAll: () => [], querySelector: () => null },
    esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
    nf: v => String(v), ptIsoDate: v => String(v || '').slice(0, 10), attToday: () => '2026-10-14', ptCanEdit: () => true, PT_NO_EDIT: 'no',
    ptCi: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase(),
    fabFilters: () => ({ q: '', fab: '', col: '', d1: '', d2: '' }), FAB: { rows: [], shown: null }, PTG: { mdb: [] },
    __STORE: { rows: [
      { id: 'o1', kind: 'OPENING', unit: 'm', fabric: 'Sheeting 62', colour: 'Sage Green', qty: 120, at: '2026-10-14T09:00:00Z', date: '2026-10-14' },
      { id: 'o2', kind: 'OUT', unit: 'm', fabric: 'Sheeting 62', colour: 'Sage Green', qty: 20, at: '2026-10-14T10:00:00Z', date: '2026-10-14' },
      { id: 'o3', kind: 'IN', unit: 'pcs', sku: 'RTC377-6060', qty: 25, at: '2026-10-14T11:00:00Z', date: '2026-10-14' },
    ], checks: {}, at: 'now', busy: false, err: '' },
    voLogRows: () => [{ key2: 'd1', unit: 'm', fabric: 'Sheeting 62', colour: 'Sage Green', vendor: 'RBP-Bagru', qty: 500, at: '2026-10-14T12:00:00Z', ok: { qty: 500, at: '2026-10-14T12:00:00Z' } }],
    PT: { cut: [], base: [{ id: 'b1', sku: 'RTC377-6060', issuePieces: 7, addedAt: '2026-10-14T13:00:00Z', issueDate: '2026-10-14' }] },
    ptEmpty: (id, t) => { el(id).innerHTML = '<tbody><tr><td>' + t + '</td></tr></tbody>'; }, ptImgSpan: () => '', ptImgFill: () => {}, ptIfTab: (t, f) => f, ptImgPatch: () => {},
    ptOpenDialog: cfg => { ctx.__dlg = cfg; }, cutFabrics: () => ['Sheeting 62'], ptDownload: () => {}, csvCell: v => String(v), renderFab: () => {},
    fabKey: v => String(v || '').trim().toUpperCase(), obUC: v => String(v == null ? '' : v).trim().toUpperCase(), ptCutPerPiece: () => 0, ptPrintIssueAs: () => 'running', cutSkuOf: () => null, ensureStore: () => {},
  };
  Object.assign(ctx, extra || {});
  const keys = Object.keys(ctx);
  const fn = new Function(...keys, SRC + '\n;Object.assign(STORE, __STORE);return { ST_MANUAL_ONLY, stMoves, stBalances, renderStore: typeof renderStore === "function" ? renderStore : null, stEntryOpen };');
  return Object.assign(fn(...keys.map(k => ctx[k])), { els, ctx });
}

console.log('== by hand (the default since 14 Oct) ==');
{
  const S = load({});
  ok('the switch is on by default', S.ST_MANUAL_ONLY === true);
  const mv = S.stMoves();
  ok('only what was typed moves the store — no printer delivery, no karigar issue', mv.length === 3 && mv.every(m => m.src === 'typed'), JSON.stringify(mv.map(m => m.src)));
  const bal = S.stBalances(mv), cloth = bal.find(b => b.unit === 'm'), pcs = bal.find(b => b.unit === 'pcs');
  ok('printed cloth: 120 opening − 20 out = 100 m', cloth && cloth.qty === 100, cloth && cloth.qty);
  ok('printed pieces: 25 in, the 7 issued to a karigar do not take any', pcs && pcs.qty === 25, pcs && pcs.qty);
  S.renderStore('store');
  const h = S.els.fbTable.innerHTML;
  ok('the screen is the typed store: Item, Kind, In, Out, Balance, Last entry, Entries — no From printers / Cut / Track', /<th[^>]*>In<\/th>/.test(h) && /Last entry/.test(h) && !/From printers/.test(h) && !/data-st-track/.test(h), h.slice(0, 300));
  ok('…its heading says printed fabric by hand and from the flow, with cloth in metres and pieces', /Printed fabric in store — by hand, and from the production flow since 16 Oct/.test(S.els.fbKpis.innerHTML) && /Printed cloth in store \(m\)/.test(S.els.fbKpis.innerHTML));
  ok('…and the line under it says what moves it by itself', /typed by hand, plus since 16 Oct by itself/.test(S.els.fbMsg.textContent), S.els.fbMsg.textContent);
  S.stEntryOpen({});
  ok('"+ Store entry" starts on cloth (metres) and says what the flow moves by itself, so it is not typed twice', S.ctx.__dlg.fields.find(f => f.key === 'unit').value === 'm' && /do not type those again/.test(S.ctx.__dlg.note));
}
console.log('== the production flow moves it by itself since 16 Oct (Ravi: minus on "PPC plan or cutting entry", plus on receive) ==');
{
  const plan = (o, sku, at, fp, route) => ({ orderNo: o, sku, qty: 10, route: route || 'inhouse', at, by: 'ppc@x', fabric: { name: 'Sheeting 62', perPc: 2, metres: 20, fromPrinted: fp, printedUnit: 'm' } });
  const S = load({}, {
    FLOW_ON: true, flowKey: (o, s) => o + '__' + s, cutSkuOf: () => ({ color: 'Sage Green' }), mdbOf: sku => ({ sku, color: 'Sage Green' }),
    ptConsPlan: () => ({ metres: 2, fabric: 'Sheeting 62' }), flowPrintWhat: () => ({ kind: 'fabric', code: '' }),
    FLOW: { ppc: { 'AMZ-1__S1': plan('AMZ-1', 'S1', '2026-10-16T09:00:00Z', 15), 'AMZ-0__S0': plan('AMZ-0', 'S0', '2026-10-15T09:00:00Z', 30),
      'AMZ-2__S2': plan('AMZ-2', 'S2', '2026-10-16T09:00:00Z', 0, 'stitch') } },
    flowVlogRows: () => [{ unit: 'm', fabric: 'Sheeting 62', colour: 'Sage Green', qty: 40, at: '2026-10-16T10:00:00Z', key2: 'k1', vendor: 'RBP-Bagru', id: 'RFD-202610-003', day: '2026-10-16' },
      { unit: 'm', fabric: 'Sheeting 62', colour: 'Sage Green', qty: 99, at: '2026-10-15T10:00:00Z', key2: 'k0', vendor: 'RBP-Bagru', id: 'RFD-202610-001', day: '2026-10-15' }],
    PT: { base: [], cut: [
      { id: 'c1', sku: 'S1', orderNo: 'AMZ-1', pieces: 10, fabricWidth: 'Sheeting 62', fabricUsed: 20, color: 'Sage Green', addedAt: '2026-10-16T11:00:00Z' },
      { id: 'c2', sku: 'S2', orderNo: 'AMZ-2', pieces: 5, fabricWidth: 'Sheeting 62', fabricUsed: 10, color: 'Sage Green', addedAt: '2026-10-16T11:30:00Z' },
      { id: 'c0', sku: 'S0', orderNo: 'AMZ-0', pieces: 5, fabricWidth: 'Sheeting 62', fabricUsed: 10, color: 'Sage Green', addedAt: '2026-10-15T11:30:00Z' }] } });
  const mv = S.stMoves(), cloth = S.stBalances(mv).find(b => b.unit === 'm');
  ok('received on a challan → IN 40 m (the receipt before 16 Oct is in what was typed)', mv.filter(m => m.src === 'printer').map(m => m.qty).join() === '40', JSON.stringify(mv.filter(m => m.src === 'printer')));
  ok('the PPC plan that took 15 m of printed cloth → OUT 15 m (a plan before 16 Oct takes nothing)', mv.filter(m => m.src === 'plan').map(m => m.qty).join() === '-15');
  ok('cutting 20 m on that line → only the 5 m its plan did not already take; a line sent to Cutting (no printing) and a cut before 16 Oct take nothing',
    mv.filter(m => m.src === 'cut').map(m => m.qty).join() === '-5', JSON.stringify(mv.filter(m => m.src === 'cut').map(m => [m.id, m.qty])));
  ok('balance: 120 − 20 typed + 40 received − 15 plan − 5 cut = 120 m', cloth && cloth.qty === 120, cloth && cloth.qty);
  S.renderStore('store');
  ok('the Out cell says where it went (PPC plans · cutting · typed)', /PPC plans: 15 · cutting: 5 · typed out: 20/.test(S.els.fbTable.innerHTML), S.els.fbTable.innerHTML.slice(0, 600));
  /* Sent to Cutting with the cloth already printed and in hand (16 Oct): its cutting comes off the printed store. */
  S.ctx.FLOW.ppc['AMZ-2__S2'].fabric.noRfd = true;
  const mv2 = S.stMoves();
  ok('a Cutting-route line marked "already printed / in hand" is cut from the printed store (10 m out)', mv2.filter(m => m.src === 'cut').map(m => m.qty).join() === '-5,-10', JSON.stringify(mv2.filter(m => m.src === 'cut').map(m => m.qty)));
}
console.log('== storeAuto = 1: the computed movements come back ==');
{
  const S = load({ storeAuto: '1' });
  const mv = S.stMoves();
  ok('the printer delivery and the karigar issue are movements again', S.ST_MANUAL_ONLY === false && mv.some(m => m.src === 'printer') && mv.some(m => m.src === 'jobwork'), JSON.stringify(mv.map(m => m.src)));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
