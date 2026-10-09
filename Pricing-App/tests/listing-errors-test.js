/* Listing Errors (src/app/listing/listing-errors.js): the kinds, the list, and the patches the editor builds.
 *   node tests/listing-errors-test.js [path to an imgsnap-<brand>.json written by Replenish-App/tests/probes/limg-snap.js]
 * Runs the real file in a stub page. With a snapshot it also runs the list over every real listing. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'listing-errors.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

function load(items) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: { leBrand: 'SP', leKind: 'all', leSev: 'err', leQ: '' }[id] || '', innerHTML: '', textContent: '',
    classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [], disabled: false, style: {} });
  const ctx = {
    $: el, IML: { SP: { at: new Date(), items } }, IML_BUSY: false, imListLoad: async () => {}, imListBuild: async () => {},
    imState: x => ({ label: /BUYABLE/.test(x.st || '') ? 'Buyable' : 'No offer', fill: '#eee', ink: '#333' }), imThumb: u => u,
    baCall: async () => ({}), imPost: async () => ({}), showTab: () => {}, imLoad: () => {}, IM_SKU_CHOICES: null, ME: { email: 't' },
    window: { scrollTo() {} }, confirm: () => true, setTimeout, clearTimeout,
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { leKind, leRows, leRender, leCard, lePatches, leFields, leGet, leSet, leNewEntry,'
    + ' setLE: v => { LE = v; }, setSchema: v => { LE_SCHEMA = v; }, setEdit: v => { LE_EDIT = v; } };')(...Object.values(ctx));
  return Object.assign(api, { els, el });
}

console.log('== what kind each of Amazon\'s messages is ==');
const A = load([]);
const K = (m, a) => A.leKind({ m, a: a || [] });
ok('a main image problem is an image', K('The main image is missing or incorrect. Please submit a compliant image to lift the suppression.') === 'image');
ok('a PT image is an image', K("Your image PT02 violates Amazon's 'Product image requirements'") === 'image');
ok('an image attribute is an image', K('Something about it', ['main_product_image_locator']) === 'image');
ok('the 75-character rule is the title', K('Provide an Item Name that is 75 characters or less to use Item Highlights.') === 'title');
ok('a value Amazon will not take is a value', K("The value 'black friday' of the attribute 'Occasion' is not a valid value.") === 'value');
ok('"Ounce" for Unit Count is a value', K("We can't accept the Ounce you entered for Unit Count. To fix this, select an approved value from the list") === 'value');
ok('catalogue disagreement is catalogue', K("The Listing data provided is different from what's already in the Amazon catalog. The item_id provided matches ASIN B0D…") === 'catalog');
ok('a child clash is variation', K('Your child ASIN B0F cannot be added because another child ASIN [B0D] already shares the same [color, item_shape]') === 'variation');
ok('anything else is other', K('This product has other listing limitations.') === 'other');

console.log('== the editor builds the right patches ==');
const B = load([]);
B.setLE({ sku: 'X', productType: 'CLOTH_NAPKIN', attributes: {
  unit_count: [{ value: 4, type: { value: 'Ounce', language_tag: 'en_US' }, marketplace_id: 'M' }],
  occasion_type: [{ value: 'Wedding', language_tag: 'en_US', marketplace_id: 'M' }] }, issues: [] });
B.setSchema({
  unit_count: { name: 'unit_count', fields: [{ field: 'value', type: 'number' }, { field: 'type', type: 'object' }, { field: 'type.value', type: 'string', enum: ['Count'] }, { field: 'type.language_tag', type: 'string' }] },
  occasion_type: { name: 'occasion_type', missing: true } });
ok('a nested object is edited by its inside (type.value), not as a whole', B.leFields(B.leSet ? { fields: [{ field: 'value' }, { field: 'type', type: 'object' }, { field: 'type.value' }] } : {}).map(f => f.field).join() === 'value,type.value');
const e = { value: 4, type: { value: 'Ounce' } }; B.leSet(e, 'type.value', 'Count');
ok('a nested value is set in place', B.leGet(e, 'type.value') === 'Count' && e.value === 4);
B.setEdit({ unit_count: { vals: [{ value: 4, type: { value: 'Count', language_tag: 'en_US' }, marketplace_id: 'M' }] }, occasion_type: { del: true } });
const P = B.lePatches();
ok('a changed attribute is a replace with its whole value', P.some(p => p.op === 'replace' && p.path === '/attributes/unit_count' && p.value[0].type.value === 'Count' && p.value[0].value === 4));
ok('an attribute Amazon no longer uses is a delete', P.some(p => p.op === 'delete' && p.path === '/attributes/occasion_type'));
ok('nothing else is sent', P.length === 2);
const ne = B.leNewEntry('unit_count');
ok('a new value takes the only allowed choice, and a language for the inner field', ne.type && ne.type.value === 'Count' && ne.type.language_tag === 'en_US');
const card = B.leCard('occasion_type');
ok('an attribute Amazon no longer uses offers removal, not editing', /Remove this attribute|Will be removed/.test(card) && !/<select/.test(card));
B.setEdit({});
const uc = B.leCard('unit_count');
ok('a value not on Amazon\'s list is shown as not allowed', /Ounce — not allowed/.test(uc) && /<option value="Count"/.test(uc));

console.log('== the list ==');
const items = [
  { sku: 'A1', asin: 'B01', st: 'DISCOVERABLE', iss: [{ s: 'E', m: 'The main image is missing or incorrect.', a: [] }, { s: 'W', m: 'Provide an Item Name that is 75 characters or less', a: ['item_name'] }] },
  { sku: 'A2', asin: 'B02', st: 'BUYABLE,DISCOVERABLE', iss: [{ s: 'W', m: 'a warning only', a: [] }] },
  { sku: 'A3', asin: 'B03', st: 'BUYABLE', iss: [] },
  { sku: 'P', asin: 'B00', lvl: 'parent', iss: [{ s: 'E', m: 'parent issue', a: [] }] },
  { sku: 'OLD', asin: 'B04', ie: 1, im: "The value 'x' of the attribute 'Occasion' is not a valid value." },
];
const C = load(items);
let rows = C.leRows();
ok('errors only: listings with an error, not parents, not warning-only', rows.map(r => r.x.sku).join() === 'A1,OLD', rows.map(r => r.x.sku).join());
ok('a snapshot from before every issue was kept still shows its first error', rows.find(r => r.x.sku === 'OLD').iss[0].m.indexOf('Occasion') > 0);
C.el('leSev').value = 'all';
rows = C.leRows();
ok('with warnings, the warning-only listing appears too', rows.some(r => r.x.sku === 'A2'));
C.el('leKind').value = 'title';
ok('the kind filter keeps listings that have that kind', C.leRows().map(r => r.x.sku).join() === 'A1');
C.el('leKind').value = 'all'; C.el('leQ').value = 'b04';
ok('search finds by ASIN', C.leRows().map(r => r.x.sku).join() === 'OLD');
C.el('leQ').value = ''; C.el('leSev').value = 'err';
C.leRender();
ok('the page draws', /What Amazon says/.test(C.el('leList').innerHTML) && /data-fix="OLD"/.test(C.el('leList').innerHTML) && /data-img="A1"/.test(C.el('leList').innerHTML));

const snap = process.argv[2];
if (snap && fs.existsSync(snap)) {
  console.log('== every real listing in ' + path.basename(snap) + ' ==');
  const PFX = 'https://m.media-amazon.com/images/I/';
  const real = JSON.parse(fs.readFileSync(snap, 'utf8')).map(x => Object.assign({}, x, { live: Object.fromEntries(Object.entries(x.live || {}).map(([k, v]) => [k, /^http/.test(v) ? v : PFX + v])) }));
  const R = load(real);
  const t0 = Date.now(); const rr = R.leRows(); R.leRender(); const ms = Date.now() - t0;
  const kinds = {}; rr.forEach(r => new Set(r.iss.filter(i => i.s === 'E').map(R.leKind)).forEach(k => kinds[k] = (kinds[k] || 0) + 1));
  const msgs = {}; rr.forEach(r => r.iss.forEach(i => { if (R.leKind(i) === 'other') { const k = String(i.m).replace(/\d+/g, '#').slice(0, 90); msgs[k] = (msgs[k] || 0) + 1; } }));
  console.log('  ' + rr.length + ' listings with an error; by kind ' + JSON.stringify(kinds) + '; list drawn in ' + ms + ' ms');
  console.log('  issues counted as other: ' + JSON.stringify(Object.entries(msgs).sort((a, b) => b[1] - a[1]).slice(0, 8)));
  ok('the real list draws, with every listing that has an error', rr.length > 0 && /data-(fix|img)=/.test(R.el('leList').innerHTML));
  ok('it carries every issue, not only the first', real.some(x => (x.iss || []).length > 1));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
