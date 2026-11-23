/* THE GREIGE PO WINDOW: SUPPLIER PICKED FROM MASTER DATA, LAST RATE AS A SAMPLE (Vishesh, 23 Nov).
 *   - the supplier box offers only Master data's greige suppliers; a typed name that is not one cannot be saved
 *   - its grey sample text is the last PO's supplier (not "Shri Balaji Mills")
 *   - an empty rate box shows in grey the rate that greige was last bought at (0 when never); Tab takes it; a rate must be put in
 * Loads the real src/app/flow/greige-desk.js with a small fake page. Made-up suppliers and fabrics only.
 *   node tests/greige-po-test.js */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* The desk with a fake page: every element the PO window asks for is a plain object that keeps what is written to it. */
function desk() {
  const code = fs.readFileSync(SRC, 'utf8');
  const anchor = '  return { open: open,', root = '  var GD_ROOT = null;';
  if (code.split(anchor).length !== 2 || code.split(root).length !== 2) throw new Error('greige-desk.js: an anchor this test needs moved; update the test');
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', placeholder: '', textContent: '', innerHTML: '', readOnly: false, open: false, hidden: false, style: {}, attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, focus() {}, addEventListener() {}, querySelector: () => null,
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { this.attrs[k] = null; } });
  const opened = code.replace(root, '  var GD_ROOT = { getElementById: function (id) { return globalThis.__el(id); }, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} };')
    .replace(anchor, '  globalThis.__GDT = { gpoPickMills, gpoPickedMill, gpoLastMill, poRateSample, poRateTab, poMillKept, poOpen, poSave, poDraw, gpoCheck, poMillMatches, poMillListDraw, poMillKey, poMillPick,'
      + ' setDB: function (v) { DB = v; }, db: function () { return DB; }, draft: function () { return PO_DRAFT; } };\n' + anchor);
  /* saves go nowhere: a broken copy that lets a bad supplier through then fails on the PO count, not on a missing database */
  const ctx = { console, window: { document: { createElement: () => ({}) }, scrollTo() {} }, ME: { admin: true }, __el: el,
    ptPatch: async () => {}, ptPut: async () => {}, setTimeout: () => 0, clearTimeout() {} };
  vm.createContext(ctx);
  vm.runInContext(opened, ctx);
  return Object.assign(ctx.__GDT, { els });
}

/* ---- the business, in its own words ---- */
const supplier = (name, more) => Object.assign({ name, kind: 'Supplier', active: true }, more || {});
const greigePo = (no, date, mill, lines) => ({ id: 'id-' + no, poNo: no, date, mill, sent: { at: date }, lines: lines.map(([greige, rate]) => ({ rfd: 'Sheeting 62', greige, metres: '100', rate: String(rate), due: date })) });
const G67 = '20\'s Sheeting 67" Greige 60x56', G48 = '60\'s Cambric 48" Greige 92x80';
const book = () => ({
  co: { poPrefix: 'TEST/PO/', poNext: 4 }, users: [], fab: [],
  mst: [{ rfd: 'Sheeting 62', greige: G67, active: true }, { rfd: 'Cambric', greige: G48, active: true }],
  ven: [supplier('Test Weavers'), supplier('Sample Mills'), supplier('Old Desk Mill', { deskOnly: true }), supplier('Closed Mill', { active: false }),
    { name: 'Test Processors', kind: 'RFD Processor', active: true }],
  gpo: [greigePo('TEST/PO/001', '2026-10-01', 'Sample Mills', [[G67, 52]]), greigePo('TEST/PO/002', '2026-11-02', 'Test Weavers', [[G67, 55.5]]),
    greigePo('TEST/PO/003', '2026-11-20', 'Old Desk Mill', [[G67, 60]])],
});

console.log('== the supplier box: Master data\'s suppliers only ==');
{
  const D = desk(); D.setDB(book());
  ok('the list is the greige suppliers of Master data, switched on — no processor, no old desk-only name, no switched-off one',
    D.gpoPickMills().join() === 'Test Weavers,Sample Mills', D.gpoPickMills().join());
  ok('a supplier typed in any case is found, with Master data\'s spelling', D.gpoPickedMill('  test weavers ') === 'Test Weavers');
  ok('a name that is not a Master data supplier is not', D.gpoPickedMill('New Mill Ltd') === '' && D.gpoPickedMill('Old Desk Mill') === '' && D.gpoPickedMill('') === '');
}

console.log('== the grey sample in the supplier box is the last PO\'s supplier ==');
{
  const D = desk(); D.setDB(book());
  ok('the latest PO whose supplier is in Master data: Test Weavers (2 Nov) — not the newer PO of a desk-only name', D.gpoLastMill() === 'Test Weavers', D.gpoLastMill());
  D.poOpen();
  ok('a new PO opens with it as grey sample text, the box itself empty — still to be picked', D.els.poMill.placeholder === 'Test Weavers' && D.els.poMill.value === '');
  ok('…the browser\'s own suggestion list is switched off: the desk draws its own', D.els.poMill.attrs.list === null && D.els.poMills.innerHTML === '');
  const E = desk(); E.setDB(Object.assign(book(), { gpo: [] }));
  E.poOpen();
  ok('no PO yet: the sample asks for a pick, never a made-up mill', E.els.poMill.placeholder === 'Pick a supplier from the list' && !/Shri Balaji/.test(E.els.poMill.placeholder));
}

console.log('== typing searches: the matching suppliers drop down to pick from (Vishesh, 23 Nov) ==');
{
  const D = desk(); D.setDB(book()); D.poOpen();
  const L = () => D.els.poMillList.innerHTML, names = () => (L().match(/data-pomill="([^"]+)"/g) || []).map(s => s.slice('data-pomill="'.length, -1));
  ok('nothing typed: every Master data supplier, none else', D.poMillMatches('').join() === 'Test Weavers,Sample Mills');
  D.els.poMill.value = 'mill'; D.poMillListDraw();
  ok('"mill" (any case, any part of the name): Sample Mills only — not the desk-only "Old Desk Mill"', names().join() === 'Sample Mills' && !D.els.poMillList.hidden, L());
  ok('…the matching part is in bold', /Sample <b>Mill<\/b>s/.test(L()));
  D.els.poMill.value = 'zzz'; D.poMillListDraw();
  ok('no match: says so, and how a new supplier comes in', !names().length && /No supplier in Master data matches "zzz"/.test(L()));
  D.els.poMill.value = 'e'; D.poMillListDraw();
  ok('the first match is lit; ↓ lights the next', /data-pomill="Test Weavers"[^>]*aria-selected="true"/.test(L()) && D.poMillKey('ArrowDown') && /data-pomill="Sample Mills"[^>]*aria-selected="true"/.test(L()));
  ok('Enter picks the lit one into the box and closes the list', D.poMillKey('Enter') && D.els.poMill.value === 'Sample Mills' && D.els.poMillList.hidden === true);
  ok('Esc with the list shut is left to the window (the PO is not stopped from closing)', D.poMillKey('Escape') === false);
  D.els.poMill.value = 'test'; D.poMillListDraw();
  ok('Esc with the list open closes the list only', D.poMillKey('Escape') === true && D.els.poMillList.hidden === true);
  D.poMillPick('Test Weavers');
  ok('a click picks it the same way', D.els.poMill.value === 'Test Weavers' && D.els.poMillList.hidden === true);
}

console.log('== a typed name that is not a supplier is not saved ==');
{
  const D = desk(); D.setDB(book());
  D.poOpen(); const before = D.db().gpo.length;
  const line = D.draft().lines[0]; line.greige = G67; line.metres = '100'; line.rate = '55';
  D.els.poMill.value = 'New Mill Ltd'; D.poSave('');
  ok('refused, in words, and nothing saved', /"New Mill Ltd" is not a supplier in Master data/.test(D.els.lmPoErr.textContent) && D.db().gpo.length === before, D.els.lmPoErr.textContent);
  D.els.poMill.value = 'Old Desk Mill'; D.els.lmPoErr.textContent = ''; D.poSave('');
  ok('…an old desk-only name too, on a new PO', /is not a supplier in Master data/.test(D.els.lmPoErr.textContent) && D.db().gpo.length === before);
  const K = desk(); K.setDB(book()); K.poOpen('TEST/PO/003');
  ok('an open PO already saved with an old name keeps it: changing that PO is not refused for its supplier', K.poMillKept('Old Desk Mill') === true && K.poMillKept('New Mill Ltd') === false);
}

console.log('== the rate: the last rate for that greige as a grey sample, 0 when never bought ==');
{
  const D = desk(); D.setDB(book());
  ok('Sheeting 67 greige: last bought at 60 (20 Nov, the latest PO, whichever supplier)', D.poRateSample(G67) === 60, String(D.poRateSample(G67)));
  ok('Cambric 48 greige, never on a PO: 0', D.poRateSample(G48) === 0);
  D.poOpen(); D.draft().lines[0].greige = G67; D.poDraw();
  ok('the empty rate box shows it as grey sample text', /data-f="rate"[^>]*value=""[^>]*placeholder="60"/.test(D.els.poLines.innerHTML), (D.els.poLines.innerHTML.match(/data-f="rate"[^>]*>/) || [''])[0]);
  D.draft().lines[0].greige = G48; D.poDraw();
  ok('…and 0 for a greige never bought', /data-f="rate"[^>]*placeholder="0"/.test(D.els.poLines.innerHTML));
  D.draft().lines[0].greige = G67; D.draft().lines[0].rate = '';
  ok('Tab in the empty box takes the sample: the rate is 60', D.poRateTab(0) === true && D.draft().lines[0].rate === '60');
  D.draft().lines[0].rate = '58';
  ok('…a rate already typed is left as it is', D.poRateTab(0) === false && D.draft().lines[0].rate === '58');
  D.draft().lines[0].greige = G48; D.draft().lines[0].rate = '';
  ok('…a greige never bought: Tab puts nothing in (0 is not a rate)', D.poRateTab(0) === false && D.draft().lines[0].rate === '');
  D.draft().lines[0].metres = '100'; D.els.poMill.value = 'Sample Mills'; D.els.lmPoErr.textContent = '';
  const n = D.db().gpo.length; D.poSave('');
  ok('the sample is only a reference: saving with the rate box empty is refused, naming the greige', /What rate for 60's Cambric/.test(D.els.lmPoErr.textContent) && D.db().gpo.length === n, D.els.lmPoErr.textContent);
}

console.log('== wiring ==');
{
  const code = fs.readFileSync(SRC, 'utf8');
  ok('Tab (not Shift+Tab) in a rate box fills the sample, then moves on as Tab does', /if \(ev\.key !== 'Tab' \|\| ev\.shiftKey \|\| !el\.getAttribute \|\| el\.getAttribute\('data-f'\) !== 'rate'\) return;/.test(code)
    && /if \(poRateTab\(i\)\) \{ el\.value = PO_DRAFT\.lines\[i\]\.rate; poSyncRow\(i\); \}/.test(code) && !/ev\.key !== 'Tab'[^\n]*preventDefault/.test(code));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
