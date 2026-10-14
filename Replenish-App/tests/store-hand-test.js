/* The store typed by hand (Ravi, 14 Oct 2026: "remove all thing bas store stock balance rahega jo batayega ki mere pas
 * printed fabric kitna pada h jise me manually chadaunga"). Loads src/app/inventory/store.js alone with its neighbours
 * stubbed, once in the default (by hand) mode and once with storeAuto = 1.   node tests/store-hand-test.js */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'inventory', 'store.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

function load(ls) {
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
  ok('…its heading says printed fabric entered by hand, with cloth in metres and pieces', /Printed fabric in store — entered by hand/.test(S.els.fbKpis.innerHTML) && /Printed cloth in store \(m\)/.test(S.els.fbKpis.innerHTML));
  ok('…and the line under it says every figure was typed', /every figure here was typed by hand/.test(S.els.fbMsg.textContent), S.els.fbMsg.textContent);
  S.stEntryOpen({});
  ok('"+ Store entry" starts on cloth (metres) and says the store is only what is typed', S.ctx.__dlg.fields.find(f => f.key === 'unit').value === 'm' && /only what is typed here/.test(S.ctx.__dlg.note));
}
console.log('== storeAuto = 1: the computed movements come back ==');
{
  const S = load({ storeAuto: '1' });
  const mv = S.stMoves();
  ok('the printer delivery and the karigar issue are movements again', S.ST_MANUAL_ONLY === false && mv.some(m => m.src === 'printer') && mv.some(m => m.src === 'jobwork'), JSON.stringify(mv.map(m => m.src)));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
