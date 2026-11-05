/* Listing Rules (src/app/listing/listing-rules.js): what people may write is not an error, every problem says how to fix it,
 * and the Workspace (listing-workspace.js) counts exactly what Parent ASINs counts.
 *   node tests/listing-rules-test.js
 * Runs the real files in a stub page over SAMPLE — a small set of listings of both brands, written the way people write them.
 * The sample is exported so a report can run another version of the rules over the same listings (before / after). */
const fs = require('fs'), path = require('path');
const L = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/* ---- the sample: two brands, every listing live (Active, FBA, in stock, priced, A+ published, 5 bullets, 300-character description) ---- */
const row = (brand, parent, sku, title, extra) => Object.assign({ brand, parent, sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN',
  aplus: true, aplusAt: 1, checked: 1, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});
const SAMPLE = [
  // Ridhi — cloth napkins (template: brand, product, material, size, colour)
  row('SP', 'P1', 'R1', 'Ridhi Cloth Napkins 100% Cotton 18x18 Inc Block Print Dinner Napkins - Blue'),          // 75: short forms fine
  row('SP', 'P1', 'R2', 'Ridhi Cloth Napkins Cotton 18x18 Inc Block Print Dinner - Blue'),                       // 62: strict
  row('SP', 'P1', 'R3', 'Ridhi Cloth Napkins 100% Cotton 18x18 Block Print Dinner Napkins Set - Red'),          // 74: no unit, fine
  row('SP', 'P1', 'R4', 'Ridhi Cloth Napkins 100% Cotton 18x18 Block Print Dinner Napkin Set - Red'),           // 73: no unit, strict
  row('SP', 'P1', 'R5', 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inc Block Print Dinner Napkins Blue'),         // 75: "18 x 18 Inc" is a size
  row('SP', 'P1', 'R6', 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Napkins - Blue'),             // 71: the house style
  (r => { r.content.images = 4; return r; })(row('SP', 'P1', 'R13', 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner Napkins - Blue')),   // 73, with 4 pictures
  // Ridhi — pillow covers (template: brand, colour, print, product, size); two siblings say Block Print
  row('SP', 'P2', 'R7', 'Ridhi White Cotton Throw Pillow Cover 18 x 18 Inch for Couch Sofa'),                    // white = embroidery
  row('SP', 'P2', 'R8', 'Ridhi Blue Cotton Throw Pillow Cover 18 x 18 Inch for Couch Sofa'),                     // blue, no Block Print: error
  row('SP', 'P2', 'R9', 'Ridhi Blue Block Print Throw Pillow Cover 18 x 18 Inch for Couch Sofa'),
  row('SP', 'P2', 'R10', 'Ridhi Green Block Print Throw Pillow Cover 18 x 18 Inch for Couch Sofa'),
  // Ridhi — embroidered pillows, no proof of block print anywhere
  row('SP', 'P3', 'R11', 'Ridhi Red Ombre Embroidered Throw Pillow Cover 18 x 18 Inch for Couch'),
  row('SP', 'P3', 'R12', 'Ridhi Blue Ombre Embroidered Throw Pillow Cover 18 x 18 Inch for Couch'),
  // Ridhi — a table runner written larger-first
  row('SP', 'P4', 'R14', 'Ridhi Table Runner Cotton 36 x 14 Inch Block Print for Dining Table - Blue'),
  // CPC — tablecloths (template: brand, product, shape, material, size, colour); Amazon's brand read for C1a
  row('CPC', 'C1', 'C1a', 'MY WHIMSICAL CORNER Tablecloth Rectangle Cotton 60x90 Inch Block Print Blue', { amzBrand: 'THE WHIMSICAL CORNER' }),   // 75
  row('CPC', 'C1', 'C1b', 'The Whimsical Corner Tablecloth Rectangle Cotton 60x90 Inch Block Print Red'),       // 75
  row('CPC', 'C1', 'C1c', 'Cotton Tablecloth Rectangle 60 x 90 Inch Block Print Table Cover - Red'),            // no brand at all
  // CPC — napkins: Grey written Gray, Block-Print with a hyphen
  row('CPC', 'C2', 'C2a', 'Whimsical Corner Cloth Napkins Cotton 18 x 18 Inch Block Print Gray'),
  row('CPC', 'C2', 'C2b', 'Whimsical Corner Cloth Napkins Cotton 18 x 18 Inch Block-Print Grey'),
];
const CAT = {
  SP: { R1: { color: 'Blue', size: '18x18', subcat: 'Napkin Set' }, R2: { color: 'Blue', size: '18x18', subcat: 'Napkin Set' }, R3: { color: 'Red', size: '18x18', subcat: 'Napkin Set' },
    R4: { color: 'Red', size: '18x18', subcat: 'Napkin Set' }, R5: { color: 'Blue', size: '18x18', subcat: 'Napkin Set' }, R6: { color: 'Blue', size: '18x18', subcat: 'Napkin Set' },
    R13: { color: 'Blue', size: '18x18', subcat: 'Napkin Set' },
    R7: { color: 'White', size: '18x18', subcat: 'Pillow Cover' }, R8: { color: 'Blue', size: '18x18', subcat: 'Pillow Cover' }, R9: { color: 'Blue', size: '18x18', subcat: 'Pillow Cover' },
    R10: { color: 'Green', size: '18x18', subcat: 'Pillow Cover' }, R11: { color: 'Red Ombre', size: '18x18', subcat: 'Pillow Cover' }, R12: { color: 'Blue Ombre', size: '18x18', subcat: 'Pillow Cover' },
    R14: { color: 'Blue', size: '14x36', subcat: 'Table Runner' } },
  CPC: { C1a: { color: 'Blue', size: '60x90', subcat: 'Rectangle Tablecloth' }, C1b: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' }, C1c: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' },
    C2a: { color: 'Grey', size: '18x18', subcat: 'Napkin Set' }, C2b: { color: 'Grey', size: '18x18', subcat: 'Napkin Set' } },
};
const TITLE_LEN = { R1: 75, R2: 62, R3: 74, R4: 73, R5: 75, R6: 71, R13: 73, C1a: 75, C1b: 75 };

/** The rules (and, with `ws`, the Workspace) in a stub page, over SAMPLE. `src` may be another version of listing-rules.js. */
function load(opts) {
  opts = opts || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: id === 'hBrandView' ? 'ALL' : '', innerHTML: '', textContent: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const rows = SAMPLE.map(r => JSON.parse(JSON.stringify(r)));
  const HEALTH = { SP: { at: new Date(), rows: rows.filter(r => r.brand === 'SP') }, CPC: { at: new Date(), rows: rows.filter(r => r.brand === 'CPC') } };
  const calls = [];
  const ctx = {
    $: el, document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }) }, window: { addEventListener() {}, scrollTo() {} },
    MutationObserver: class { observe() {} }, localStorage: { getItem: () => null, setItem() {} }, CSS: { escape: s => s }, setTimeout, clearTimeout,
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, HEALTH, H_LOADED: true, H_RULES: { minTitle: 80, maxTitle: 200, minBullets: 5, minImages: 6, minDesc: 200 },
    IML: { SP: { at: new Date(), items: [] }, CPC: { at: new Date(), items: [] } }, IM_SLOTS: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'], IM_SKU_CHOICES: null,
    getDoc: async () => ({ exists: () => false }), setDoc: async () => {}, doc: () => ({}), db: {}, serverTimestamp: () => 0, baCall: async () => ({}),
    showTab: t => calls.push({ tab: t }), imLoad() {}, leOpen: (sku, attrs) => calls.push({ sku, attrs }), hFocusOpen() {}, ensureHealth: async () => {}, imListLoad: async () => {},
    parentName: (brand, asin) => 'Parent ' + asin, lcBytes: s => Buffer.byteLength(String(s || ''), 'utf8'),
    lrEsc: s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])),
  };
  const src = (opts.src || L('listing-rules.js')) + (opts.ws ? '\n' + L('listing-workspace.js') : '');
  const tail = '\n;LR = JSON.parse(JSON.stringify(LR_DEFAULT)); LR_CAT.SP = ' + JSON.stringify(CAT.SP) + '; LR_CAT.CPC = ' + JSON.stringify(CAT.CPC) + ';'
    + '\n;return { rows: ' + JSON.stringify(rows) + ', LR_DEFAULT, getLR: () => LR, healthOf, hCtx: () => hCtx(), reset: () => { H_CTX = null; }, hTitleSizes,'
    + ' typeofFix: typeof lrProblemHtml, lrProblemHtml: typeof lrProblemHtml === "function" ? lrProblemHtml : null, lrProblemsHtml: typeof lrProblemsHtml === "function" ? lrProblemsHtml : null,'
    + ' lrAllow: typeof lrAllow === "function" ? lrAllow : null, lrFixOpen: typeof lrFixOpen === "function" ? lrFixOpen : null,'
    + (opts.ws ? ' LI_WS, LI_WS_AUDIT, liWsParents: (brands) => liWsParents(brands, hCtx(), Date.now()), liWsDetail, liWsAuditBox, liWsKidTable,' : '') + ' };';
  const api = new Function(...Object.keys(ctx), src + tail)(...Object.values(ctx));
  api.rows = api.rows.map(r => r);   // plain rows, brand on each
  api.score = sku => { const r = api.rows.find(x => x.sku === sku); return api.healthOf(r, api.hCtx()); };
  api.ids = sku => api.score(sku).found.map(h => h.detector).sort().join(',');
  api.hit = (sku, det) => api.score(sku).found.find(h => h.detector === det) || null;
  api.counts = brand => api.rows.filter(r => r.brand === brand).reduce((acc, r) => { acc[api.healthOf(r, api.hCtx()).bucket]++; return acc; }, { critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0 });
  return Object.assign(api, { els, el, calls, HEALTH });
}

if (require.main === module) {
  const A = load();
  console.log('== the sample is what it says ==');
  ok('title lengths are the ones the checks talk about', Object.entries(TITLE_LEN).every(([sku, n]) => SAMPLE.find(r => r.sku === sku).title.length === n),
    Object.entries(TITLE_LEN).map(([sku, n]) => sku + '=' + SAMPLE.find(r => r.sku === sku).title.length + '/' + n).join(' '));

  console.log('== A1: near the 75-character limit ==');
  ok('75-character title with "18x18 Inc": no size error', !A.hit('R1', 'size_format') && !A.hit('R1', 'variation_naming'), A.ids('R1'));
  ok('the same size in a 62-character title: size error', !!A.hit('R2', 'size_format'), A.ids('R2'));
  ok('74-character title with no unit: no error', A.ids('R3') === '', A.ids('R3'));
  ok('73-character title with no unit: error', !!A.hit('R4', 'size_format'), A.ids('R4'));
  ok('"18 x 18 Inc" is read as a size', A.hTitleSizes('Ridhi 18 x 18 Inc Blue').map(s => s.text).join() === '18 x 18 Inc');
  ok('…so no "missing size" and no "no size in the title"', !A.hit('R5', 'variation_value_missing') && !/missing[^·]*size/.test((A.hit('R5', 'title_template') || {}).detail || '') && A.ids('R5') === '', A.ids('R5'));
  ok('the house style passes', A.ids('R6') === '', A.ids('R6'));
  ok('the fix says how: size as "18 x 18 Inch", what it says, and why the short form does not apply',
    A.hit('R2', 'size_format').fix === 'Write the size as "18 x 18 Inch". It says "18x18 Inc" and the title is only 62 characters (short forms are allowed from 74).', A.hit('R2', 'size_format').fix);

  console.log('== A2 / A3: same meaning, and the brands ==');
  ok('CPC title "MY WHIMSICAL CORNER …" with Amazon brand "THE WHIMSICAL CORNER": no brand error', !A.hit('C1a', 'title_template') && A.ids('C1a') === '', A.ids('C1a') + ' ' + JSON.stringify(A.hit('C1a', 'title_template')));
  ok('"The Whimsical Corner" from the Brand words setting: no brand error', A.ids('C1b') === '', A.ids('C1b'));
  ok('a CPC title with no brand word at all: brand error, and the fix names the brand to write', /missing brand/.test((A.hit('C1c', 'title_template') || {}).detail || '') && /^Put the brand in the title: "Whimsical Corner …"\./.test(A.hit('C1c', 'title_template').fix), JSON.stringify(A.hit('C1c', 'title_template')));
  ok('Grey in the catalogue, Gray in the title: no colour error', A.ids('C2a') === '', A.ids('C2a'));
  ok('"Block-Print" counts as Block Print', A.ids('C2b') === '', A.ids('C2b'));
  ok('the code CPC is never looked for', !A.rows.some(r => r.brand === 'CPC' && /missing brand/.test((A.hit(r.sku, 'title_template') || {}).detail || '') && r.sku !== 'C1c'));

  console.log('== A4: Block Print vs embroidery ==');
  ok('white child whose siblings say Block Print: no Block Print error', !A.hit('R7', 'title_keyword') && A.ids('R7') === '', A.ids('R7'));
  ok('blue sibling without it: error, and the message says why', /no "Block Print" in the title, but 2 of its siblings say it/.test((A.hit('R8', 'title_keyword') || {}).detail || ''), JSON.stringify(A.hit('R8', 'title_keyword')));
  ok('…with the fix "Add "Block Print" to the title, because …"', (A.hit('R8', 'title_keyword') || {}).fix === 'Add "Block Print" to the title, because 2 of its siblings say it.', (A.hit('R8', 'title_keyword') || {}).fix);
  ok('embroidered red ombre pillow with no proof: no Block Print error', A.ids('R11') === '' && A.ids('R12') === '', A.ids('R11') + ' | ' + A.ids('R12'));
  ok('a mixed colour is not white: "Blue & White" would still be asked', (() => { const r = Object.assign({}, A.rows.find(x => x.sku === 'R8'), { amzColor: 'Blue & White' }); return !!A.healthOf(r, A.hCtx()).found.find(h => h.detector === 'title_keyword'); })());
  ok('its own bullets as proof: a child read from Amazon whose bullets say Block Print is asked', (() => { const r = Object.assign({}, A.rows.find(x => x.sku === 'R11'), { title: 'Ridhi Red Ombre Throw Pillow Cover 18 x 18 Inch for Couch Sofa Bed', content: null, amzWords: { bp: true, emb: false } }); const h = A.healthOf(r, A.hCtx()).found.find(x => x.detector === 'title_keyword'); return !!h && /its bullets say it/.test(h.detail); })());

  console.log('== A5: every other detector as it was; B1: how to fix, in plain words ==');
  ok('4 pictures: Secondary images missing stays, with its fix', (A.hit('R13', 'images_below') || {}).fix === 'Add 2 more pictures in Image Manager (it has 4, needs 6).', JSON.stringify(A.hit('R13', 'images_below')));
  ok('36 x 14: Dimension order stays, with its fix', (A.hit('R14', 'dimension_order') || {}).fix === 'Put the smaller number first: "14 x 36".', JSON.stringify(A.hit('R14', 'dimension_order')));
  ok('every finding carries fix, tag and where Fix goes', A.rows.every(r => A.score(r.sku).found.every(h => h.fix && h.tag && 'kind' in h)));
  ok('tags: pictures and sizes are company rules; Amazon\'s own verdicts are Amazon\'s', A.hit('R13', 'images_below').tag === 'Company rule' && A.hit('R13', 'images_below').kind === 'img' && A.hit('R2', 'size_format').kind === 'lerr'
    && (() => { const r = Object.assign({}, A.rows.find(x => x.sku === 'R6'), { status: 'Inactive', qty: 3 }); const h = A.healthOf(r, A.hCtx()).found.find(x => x.detector === 'inactive_with_stock'); return h && h.tag === 'Amazon' && h.fix === 'It has stock but is Inactive. Open Listing Errors to see why.'; })());
  const html = A.lrProblemHtml(A.hit('R13', 'images_below'), { brand: 'SP', sku: 'R13' }, 'Listing Health snapshot · content read 2d ago');
  ok('B2: one problem block — dot, what is wrong, how to fix, source line, tag with its hover, Fix button to the Image Manager',
    /class="sev sev-a"/.test(html) && /lr-prob-what">Secondary images missing — 4 of 6</.test(html) && /lr-prob-how">Add 2 more pictures/.test(html)
    && /lr-prob-src">Listing Health snapshot/.test(html) && /lr-tag is-own" title="Your own rule. Amazon does not check this.">Company rule/.test(html) && /data-lr-fix="img\|SP\|R13"/.test(html), html);
  const two = A.lrProblemsHtml([A.hit('R4', 'variation_naming'), Object.assign({}, A.hit('R4', 'size_format'), { sev: 'critical' })], { brand: 'SP', sku: 'R4' });
  ok('B4: worst first', two.indexOf('sev-c') < two.indexOf('sev-a'));
  A.lrFixOpen('lerr', 'SP', 'R4', ['material']);
  ok('Fix hands over to Listing Errors with the attributes', A.calls.some(c => c.tab === 'lerr') && A.calls.some(c => c.sku === 'R4' && c.attrs.join() === 'material'), JSON.stringify(A.calls));

  console.log('== the settings ==');
  ok('defaults: 74, Ridhi / Whimsical Corner, White / Off White', JSON.stringify(A.lrAllow({})) === JSON.stringify({ shortFrom: 74, brandWords: { SP: 'Ridhi', CPC: 'Whimsical Corner' }, embroideryColors: 'White, Off White' }), JSON.stringify(A.lrAllow({})));
  A.getLR().allow = { shortFrom: 70 }; A.reset();
  ok('Short forms allowed from 70: the 62-character title still fails, a 70+ one would not', !!A.hit('R2', 'size_format') && A.lrAllow(A.getLR()).shortFrom === 70);
  A.getLR().allow = { brandWords: { CPC: '' } }; A.reset();
  ok('no brand words and no Amazon brand: the brand is not judged', !/missing brand/.test((A.hit('C1c', 'title_template') || {}).detail || ''), JSON.stringify(A.hit('C1c', 'title_template')));
  A.getLR().allow = {}; A.reset();

  console.log('== Workspace = Parent ASINs ==');
  const W = load({ ws: true });
  const health = {};
  W.rows.forEach(r => { const key = r.brand + '|' + r.parent; const g = health[key] || (health[key] = { critical: 0, action: 0, review: 0 }); const b = W.healthOf(r, W.hCtx()).bucket; if (g[b] !== undefined) g[b]++; });
  const same = mode => { W.LI_WS.mode = mode; return W.liWsParents(['SP', 'CPC']).every(p => { const g = health[p.key]; return g && p.critN === g.critical && p.actN === g.action && p.revN === g.review; }); };
  ok('Live mode: Critical / Needs action / Needs review per parent equal Parent ASINs\' counts', same('live'));
  ok('All mode too', same('all'));
  W.LI_WS.mode = 'live';
  const parents = W.liWsParents(['SP', 'CPC']);
  const p1 = parents.find(p => p.key === 'SP|P1');
  ok('C1: the audit reads the same checks — Standard format fails for the 2 strict titles only, R1 (75, "18x18 Inc") passes it',
    p1.audit.steps.find(s => s.k === 'fmt').failN === 2 && p1.kids.find(k => k.sku === 'R1').c.other.pass === true && p1.kids.find(k => k.sku === 'R2').c.other.pass === false, JSON.stringify(p1.audit.steps.map(s => [s.k, s.state, s.failN])));
  const box = W.liWsAuditBox(p1);
  ok('C2: a failing step says what, how many, how to fix, and offers "Show these listings"; passing steps fold into one line; no red ✗ for steps without data',
    /✗ Standard format — 2 of 7 listings fail: Size formatting inconsistent \(2\)/.test(box) && /li-ws-astep-how">Write the size as/.test(box) && /data-li-ws-show="SP\|P1\|fmt"[^>]*>Show these listings/.test(box)
    && /✗ Images — 1 of 7 listings fails: Secondary images missing \(1\)/.test(box) && /li-ws-astep-how">Add 2 more pictures in Image Manager/.test(box)
    && /Not checked yet: Spec sheet \(needs the Amazon read/.test(box) && /Keyword research \(needs keyword data/.test(box) && !/✗ Keyword/.test(box) && /✓<\/span><div class="li-ws-astep-body">1 step passes: Template/.test(box), box);
  W.LI_WS.showStep.set('SP|P1', 'fmt');
  const kidTable = W.liWsKidTable(p1, 8);
  ok('"Show these listings" narrows the checklist to the 2 failing children', (kidTable.match(/class="li-ws-kid[" ]/g) || []).length === 2 && /Showing the 2 listings that fail “Standard format”/.test(kidTable), (kidTable.match(/class="li-ws-kid[" ]/g) || []).length);
  W.LI_WS.showStep.clear();
  const detail = W.liWsDetail(p1.kids.find(k => k.sku === 'R2'), 8);
  ok('B3: the detail shows only the problem, as the one block, with a source line; passed checks behind "Show passed checks (N)"; no Needed column, no "Nothing found"',
    (detail.match(/class="lr-prob"/g) || []).length === 1 && /lr-prob-src">Listing Rules/.test(detail) && /Show passed checks \(\d+\)/.test(detail) && !/Needed/.test(detail) && !/Nothing found/.test(detail) && /data-lr-fix="lerr\|SP\|R2"/.test(detail), detail);
  ok('B3: the extras from Amazon (Specs, Search terms) are listed as not checked yet, never as failures', /Not checked yet: [^<]*Specs[^<]*Search terms/.test(detail), detail);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
module.exports = { SAMPLE, CAT, load };
