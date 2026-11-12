/* Listing Rules (src/app/listing/listing-rules.js): what people may write is not an error, every problem says how to fix it,
 * and the Workspace (listing-workspace.js) counts exactly what Parent ASINs counts.
 *   node tests/listing-rules-test.js
 * Runs the real files in a stub page over SAMPLE — a small set of listings of both brands, written the way people write them.
 * The sample is exported so a report can run another version of the rules over the same listings (before / after). */
const fs = require('fs'), path = require('path');
const L = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/* ---- the sample: two brands, every listing live (Active, FBA, in stock, priced, A+ published, 5 bullets, 300-character description),
 *      its content and A+ read today (an old date would make every Error "Error? Check again") ---- */
const NOW = Date.now();
const DAY = 86400000;
const row = (brand, parent, sku, title, extra) => Object.assign({ brand, parent, sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN',
  aplus: true, aplusAt: NOW, checked: NOW, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});
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
    $: el, document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }) }, window: Object.assign({ addEventListener() {}, scrollTo() {} }, opts.window || {}),
    MutationObserver: class { observe() {} }, localStorage: { getItem: () => null, setItem() {} }, CSS: { escape: s => s }, setTimeout, clearTimeout,
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, HEALTH, H_LOADED: true, H_RULES: { minTitle: 80, maxTitle: 200, minBullets: 5, minImages: 6, minDesc: 200 },
    IML: { SP: { at: new Date(), items: [] }, CPC: { at: new Date(), items: [] } }, IM_SLOTS: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'], IM_SKU_CHOICES: null,
    getDoc: opts.getDoc || (async () => ({ exists: () => false })), setDoc: opts.setDoc || (async () => {}), doc: (db, coll, id) => ({ path: coll + '/' + id }), db: {}, serverTimestamp: () => 0, baCall: opts.baCall || (async () => ({})),
    showTab: t => calls.push({ tab: t }), imLoad() {}, leOpen: (sku, attrs) => calls.push({ sku, attrs }), hFocusOpen() {}, ensureHealth: async () => {}, imListLoad: async () => {},
    parentName: (brand, asin) => 'Parent ' + asin, lcBytes: s => Buffer.byteLength(String(s || ''), 'utf8'),
    ME: { email: 'test@example.com' }, imPost: async body => { calls.push(body); return opts.post ? opts.post(body) : { ok: true, status: 'ACCEPTED', submissionId: 'sub-' + body.sku }; },
    navigator: { clipboard: null },
    lrEsc: s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])),
  };
  if (opts.tab) delete ctx.lrEsc;   // the Rules tab file defines its own
  const src = (opts.src || L('listing-rules.js')) + (opts.ws ? '\n' + L('listing-workspace.js') + '\n' + L('listing-kid.js') : '') + (opts.sp ? '\n' + L('season-planner.js') : '')
    + (opts.pc ? '\n' + L('picture-check.js') : '') + (opts.tab ? '\n' + L('listing-rules-tab.js') : '');
  const tail = '\n;LR = JSON.parse(JSON.stringify(LR_DEFAULT)); LR_CAT.SP = ' + JSON.stringify(CAT.SP) + '; LR_CAT.CPC = ' + JSON.stringify(CAT.CPC) + ';'
    + '\n;return { rows: HEALTH.SP.rows.concat(HEALTH.CPC.rows), LR_DEFAULT, getLR: () => LR, healthOf, hCtx: () => hCtx(), reset: () => { H_CTX = null; }, hTitleSizes,'
    + ' lrAnswer, lrAnswerHtml, lrPicId, lrLooks, setHealthAt: d => { HEALTH.SP.at = d; HEALTH.CPC.at = d; },'
    + (opts.pc ? ' PC, pcMark, pcPictures, pcLoad,' : '') + (opts.tab ? ' lrRulesDiff, lrWho, getHistory: () => LR_HISTORY, setHistory: h => { LR_HISTORY = h; },' : '')
    + ' typeofFix: typeof lrProblemHtml, lrProblemHtml: typeof lrProblemHtml === "function" ? lrProblemHtml : null, lrProblemsHtml: typeof lrProblemsHtml === "function" ? lrProblemsHtml : null,'
    + ' lrAllow: typeof lrAllow === "function" ? lrAllow : null, lrFixOpen: typeof lrFixOpen === "function" ? lrFixOpen : null,'
    + ' lrKwBytes: typeof lrKwBytes === "function" ? lrKwBytes : null, lrBrandWords, lrFind, lrLevel: typeof lrLevel === "function" ? lrLevel : null, lrNotesHtml: typeof lrNotesHtml === "function" ? lrNotesHtml : null, IML,'
    + ' lrWholeCut: typeof lrWholeCut === "function" ? lrWholeCut : null, AMZ: typeof AMZ === "undefined" ? null : AMZ,'
    + (opts.ws ? ' LI_WS, LI_WS_AUDIT, liWsParents: (brands) => liWsParents(brands, hCtx(), Date.now()), liWsDetail, liWsAuditBox, liWsKidTable, liWsRender, liWsRecheck, liWsCheckNow, liWsLiveMap, liWsProblems, liWsPanelOpen, liWsPanelClose, liWsPanelMove, liWsPanelRender, liWsOff, liWsToolbarSync, liWsPanelSync, liWsPanelSchedule, liWsPanelKeep, liWsPanelKid, liWsPanelKidBack, lkHtml, lkKid, LK, liWsReconcile, liWsErrorsCsv, liWsDlButton, liWsSearch, LI_WS_DL_COLS, liWsJob,' : '')
    + (opts.sp ? ' SP, spCompute, spPlan, spChecks, spStrip, spInsert, spDiffHtml, spWordDiff, spKidHtml, spRowHtml, spParentBodyHtml, spParentCardHtml, spGroups, spGroupOf, spOpenParent, spCloseParent, spOpenKid, spCloseKid, spRender, spApprove, spSendAll, spPatches, spLogLoad, spEvents, SP_SEASONS, spHlInfo, spHlTry, spHighlightsCount, spEnsureReads, spApprove, spProgText, spPanelsRender, spAfterRead, setHealthLoaded: v => { H_LOADED = v; }, setCat: (b, m) => { LR_CAT[b] = Object.assign(LR_CAT[b] || {}, m); H_CTX = null; },' : '') + ' };';
  const api = new Function(...Object.keys(ctx), src + tail)(...Object.values(ctx));
  // api.rows ARE the HEALTH rows (the same objects, brand on each): a test that changes one changes what every screen judges.
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
  console.log('== our brand words: Ridhi, CPC and Whimsical Corner, for BOTH accounts ==');
  (() => {
    const B = load();
    const brandOf = (acct, title, extra) => {
      const row = Object.assign({ brand: acct, parent: 'PB', sku: 'B' + Math.random().toString(36).slice(2, 7), asin: 'B0X', title, qty: 5, price: 20, status: 'Active', channel: 'AFN',
        aplus: true, aplusAt: Date.now(), checked: Date.now(), content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});
      const words = B.lrBrandWords(row, B.getLR());
      return words.some(word => B.lrFind(title, word) >= 0);
    };
    ok('"CPC Agate Green Block Print 100% Cotton Square Tablecloth 60×60 Inch" (CPC-01): brand found', brandOf('CPC', 'CPC Agate Green Block Print 100% Cotton Square Tablecloth 60×60 Inch'));
    ok('"MY WHIMSICAL CORNER …": brand found', brandOf('CPC', 'MY WHIMSICAL CORNER Tablecloth Rectangle Cotton 60x90 Inch Block Print Blue'));
    ok('"Ridhi Hand Block …": brand found — on either account', brandOf('SP', 'Ridhi Hand Block Print Cotton Napkins 18 x 18 Inch - Blue') && brandOf('CPC', 'Ridhi Hand Block Print Cotton Napkins 18 x 18 Inch - Blue'));
    ok('"Whimsical Corner" on a Ridhi-account listing: brand found (all three are ours, for both accounts)', brandOf('SP', 'Whimsical Corner Cloth Napkins Cotton 18 x 18 Inch - Blue'));
    ok('"Ridhi" inside another word ("Ridhima"): not found', !brandOf('SP', 'Ridhima Cloth Napkins Cotton 18 x 18 Inch - Blue'));
    ok('"Corner" alone is not the brand (the phrase is "Whimsical Corner")', !brandOf('CPC', 'Corner Table Cloth Cotton 60 x 90 Inch - Blue'));
    ok('a title with none of them: not found (flagged)', !brandOf('CPC', 'Cotton Tablecloth Rectangle 60 x 90 Inch Block Print Table Cover - Red'));
    ok('punctuation and "the" are skipped: "The-Whimsical-Corner, …" and "CPC:" count', brandOf('CPC', 'The-Whimsical-Corner, Napkins Cotton') && brandOf('CPC', 'CPC: Napkins Cotton 18 x 18 Inch'));
    ok('the brand Amazon shows is accepted too', brandOf('CPC', 'Agate Home Napkins Cotton 18 x 18 Inch', { amzBrand: 'Agate Home' }));
  })();
  ok('the CPC sample with no brand word at all is still the only CPC listing flagged', A.rows.filter(r => r.brand === 'CPC' && /missing brand/.test((A.hit(r.sku, 'title_template') || {}).detail || '')).map(r => r.sku).join() === 'C1c');

  console.log('== A4: Block Print vs embroidery ==');
  ok('white child whose siblings say Block Print: no Block Print error', !A.hit('R7', 'title_keyword') && A.ids('R7') === '', A.ids('R7'));
  ok('blue sibling without it: error, and the message says why', /no "Block Print" in the title, but 2 of its siblings say it/.test((A.hit('R8', 'title_keyword') || {}).detail || ''), JSON.stringify(A.hit('R8', 'title_keyword')));
  ok('…with the fix "Add "Block Print" to the title, because …"', (A.hit('R8', 'title_keyword') || {}).fix === 'Add "Block Print" to the title, because 2 of its siblings say it.', (A.hit('R8', 'title_keyword') || {}).fix);
  ok('embroidered red ombre pillow with no proof: no Block Print error', A.ids('R11') === '' && A.ids('R12') === '', A.ids('R11') + ' | ' + A.ids('R12'));
  ok('a mixed colour is not white: "Blue & White" would still be asked', (() => { const r = Object.assign({}, A.rows.find(x => x.sku === 'R8'), { amzColor: 'Blue & White' }); return !!A.healthOf(r, A.hCtx()).found.find(h => h.detector === 'title_keyword'); })());
  ok('its own bullets as proof: a child read from Amazon whose bullets say Block Print is asked', (() => { const r = Object.assign({}, A.rows.find(x => x.sku === 'R11'), { title: 'Ridhi Red Ombre Throw Pillow Cover 18 x 18 Inch for Couch Sofa Bed', content: null, amzWords: { bp: true, emb: false } }); const h = A.healthOf(r, A.hCtx()).found.find(x => x.detector === 'title_keyword'); return !!h && /its bullets say it/.test(h.detail); })());

  console.log('== A5: every other detector as it was; B1: how to fix, in plain words ==');
  ok('4 pictures: Secondary images missing stays (an Error since 6 Nov), with its fix', (A.hit('R13', 'images_below') || {}).fix === 'Add 2 more pictures in Image Manager (the catalogue shows 4, needs 6).'
    && A.hit('R13', 'images_below').sev === 'critical' && A.hit('R13', 'images_below').stale === false, JSON.stringify(A.hit('R13', 'images_below')));
  ok('36 x 14: Dimension order stays, with its fix', (A.hit('R14', 'dimension_order') || {}).fix === 'Put the smaller number first: "14 x 36".', JSON.stringify(A.hit('R14', 'dimension_order')));
  ok('every finding carries fix, tag and where Fix goes', A.rows.every(r => A.score(r.sku).found.every(h => h.fix && h.tag && 'kind' in h)));
  ok('tags: pictures and sizes are company rules; Amazon\'s own verdicts are Amazon\'s', A.hit('R13', 'images_below').tag === 'Company rule' && A.hit('R13', 'images_below').kind === 'img' && A.hit('R2', 'size_format').kind === 'lerr'
    && (() => { const r = Object.assign({}, A.rows.find(x => x.sku === 'R6'), { status: 'Inactive', qty: 3 }); const h = A.healthOf(r, A.hCtx()).found.find(x => x.detector === 'inactive_with_stock'); return h && h.tag === 'Amazon' && h.fix === 'It has stock but is Inactive. Open Listing Errors to see why.'; })());
  const html = A.lrProblemHtml(A.hit('R13', 'images_below'), { brand: 'SP', sku: 'R13' }, 'Listing Health snapshot · content read 2d ago');
  ok('B2: one problem block — dot, the level word, what is wrong, how to fix, source line, tag with its hover, Fix button to the Image Manager',
    /class="sev sev-c"/.test(html) && /lr-lvl is-c">✕ Error: fix first<\/span>Secondary images missing — 4 of 6</.test(html) && /lr-prob-how">Add 2 more pictures/.test(html)
    && /lr-prob-src">Listing Health snapshot/.test(html) && /lr-tag is-own" title="Your own rule. Amazon does not check this.">Company rule/.test(html) && /data-lr-fix="img\|SP\|R13"/.test(html) && !/Check now/.test(html), html);
  const two = A.lrProblemsHtml([A.hit('R4', 'variation_naming'), Object.assign({}, A.hit('R4', 'size_format'), { sev: 'critical' })], { brand: 'SP', sku: 'R4' });
  ok('B4: worst first', two.indexOf('sev-c') < two.indexOf('sev-a'));
  A.lrFixOpen('lerr', 'SP', 'R4', ['material']);
  ok('Fix hands over to Listing Errors with the attributes', A.calls.some(c => c.tab === 'lerr') && A.calls.some(c => c.sku === 'R4' && c.attrs.join() === 'material'), JSON.stringify(A.calls));

  console.log('== the settings ==');
  ok('defaults: 74, our brand words "Ridhi, CPC, Whimsical Corner" (one list for both accounts), White / Off White', JSON.stringify(A.lrAllow({})) === JSON.stringify({ shortFrom: 74, ourBrands: 'Ridhi, CPC, Whimsical Corner', writeAs: { SP: 'Ridhi', CPC: 'Whimsical Corner' }, embroideryColors: 'White, Off White' }), JSON.stringify(A.lrAllow({})));
  ok('a config saved with the old per-account lists: their words join the shared list (nothing typed is lost)', A.lrAllow({ allow: { brandWords: { SP: 'Ridhi, Ridhi Home', CPC: 'Whimsical Corner' } } }).ourBrands === 'Ridhi, CPC, Whimsical Corner, Ridhi Home', A.lrAllow({ allow: { brandWords: { SP: 'Ridhi, Ridhi Home', CPC: 'Whimsical Corner' } } }).ourBrands);
  A.getLR().allow = { shortFrom: 70 }; A.reset();
  ok('Short forms allowed from 70: the 62-character title still fails, a 70+ one would not', !!A.hit('R2', 'size_format') && A.lrAllow(A.getLR()).shortFrom === 70);
  A.getLR().allow = { ourBrands: '' }; A.reset();
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
  ok('B3: the extras from Amazon (Specs, Search terms) are listed as ○ Not checked — not an error, never as failures', /○<\/span> <b>Specs<\/b> — Not checked: [^<]* — not an error/.test(detail) && /○<\/span> <b>Search terms<\/b> — Not checked: Not read from Amazon yet — not an error/.test(detail), detail);

  /* ---- 6 Nov 2026: only TRUE errors — a listing never shows an error its Amazon page does not have ---- */
  console.log('== A1: pictures are judged by the catalogue (what shoppers see) ==');
  const T = load({ ws: true });
  const liveEntry = (brand, sku, extra) => { T.LI_WS.live[brand][sku] = Object.assign({ at: NOW }, extra); T.LI_WS.liveV++; T.reset(); };
  const gallery8 = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07'];
  liveEntry('SP', 'R6', { gAt: NOW, slots: gallery8.slice(1), iAt: NOW, cat: gallery8 });   // our MAIN slot empty, the catalogue shows MAIN + 7
  ok('our MAIN empty + catalogue MAIN present = no error, and a grey note says so', !T.hit('R6', 'no_main_image') && T.ids('R6') === ''
    && T.score('R6').notes.some(n => /Amazon shows a main picture from the catalogue/.test(n)), T.ids('R6') + ' ' + JSON.stringify(T.score('R6').notes));
  liveEntry('SP', 'R6', { gAt: NOW, slots: gallery8, iAt: NOW, cat: ['PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07'] });   // the catalogue shows no MAIN
  ok('catalogue without MAIN = Error (not stale: read just now), even though our own MAIN slot is filled', (T.hit('R6', 'no_main_image') || {}).sev === 'critical'
    && T.hit('R6', 'no_main_image').stale === false && /no main picture in the catalogue \(7 other pictures\)/.test(T.hit('R6', 'no_main_image').detail), JSON.stringify(T.hit('R6', 'no_main_image')));
  liveEntry('SP', 'R6', { gAt: NOW, slots: gallery8, iAt: NOW, cat: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'SWCH'] });   // 5 gallery pictures + the swatch
  ok('SWCH not counted: MAIN + 4 + swatch = 5 pictures → Secondary images missing "5 of 6"', (T.hit('R6', 'images_below') || {}).detail === '5 of 6', T.ids('R6') + ' ' + JSON.stringify(T.hit('R6', 'images_below')));
  liveEntry('SP', 'R6', { gAt: NOW, slots: gallery8, iAt: NOW, cat: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'SWCH'] });
  ok('…and with 6 gallery pictures + swatch: no Secondary images missing (6–7 pictures is Needs attention)', !T.hit('R6', 'images_below') && (T.hit('R6', 'images_between') || {}).sev === 'review', T.ids('R6'));
  ok('the live catalogue beats the Health snapshot count (8) — the Workspace and Parent ASINs see the same 6', T.score('R6').pics.n === 6 && T.score('R6').pics.src === 'live');
  // The Image Manager snapshot (live slots = the catalogue) when newer than the content read; the Health count when nothing else
  delete T.LI_WS.live.SP.R6; T.LI_WS.liveV++; T.reset();
  const r13 = T.rows.find(r => r.sku === 'R13');
  r13.checked = NOW - 3 * DAY;
  const imlItem = { sku: 'R13', asin: 'B0R13', lvl: 'child', live: { MAIN: 'u', PT01: 'u', PT02: 'u', PT03: 'u', PT04: 'u', PT05: 'u', SWCH: 'u' }, img: {} };
  T.IML.SP = { at: new Date(NOW), items: [imlItem] }; T.reset();
  ok('the Image Manager snapshot (newer than the content read) judges: MAIN + 5 + swatch = 6 pictures, so no Secondary images missing, 6–7 pictures instead',
    T.score('R13').pics.src === 'iml' && T.score('R13').pics.n === 6 && T.score('R13').pics.main === true && !T.hit('R13', 'images_below') && !!T.hit('R13', 'images_between'), JSON.stringify(T.score('R13').pics) + ' ' + T.ids('R13'));
  T.IML.SP = { at: new Date(NOW - 10 * DAY), items: [imlItem] }; T.reset();
  ok('…an older snapshot loses to the content read: the Health count (4) judges again', T.score('R13').pics.src === 'health' && T.score('R13').pics.n === 4 && !!T.hit('R13', 'images_below'), JSON.stringify(T.score('R13').pics));
  T.IML.SP = { at: new Date(NOW), items: [{ sku: 'R13', asin: '', lvl: 'child', live: {}, img: {} }] }; T.reset();
  ok('a snapshot item the catalogue was never asked about (no ASIN, empty live map) is no answer: the Health count judges', T.score('R13').pics.src === 'health', JSON.stringify(T.score('R13').pics));
  T.IML.SP = { at: new Date(NOW), items: [] }; r13.checked = NOW; T.reset();
  ok('unknown pictures (no read anywhere): not judged', (() => { const r = Object.assign({}, T.rows.find(x => x.sku === 'R6'), { sku: 'NEW1', content: null, title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Napkins - Blue' }); const h = T.healthOf(r, T.hCtx()); return h.pics === null && !h.found.some(x => /image/.test(x.detector)); })());

  console.log('== A2 / A3: A+ on the parent counts for the child; A+ live = no "Description weak" ==');
  const r9 = T.HEALTH.SP.rows.find(r => r.sku === 'R9');
  r9.aplus = false; r9.aplusAt = NOW; T.reset();
  ok('child says no A+, parent not asked yet: not judged (no error), with a note', !T.hit('R9', 'aplus_missing') && T.score('R9').aplus.v === undefined && T.score('R9').notes.some(n => /parent ASIN's A\+ was not asked yet/.test(n)), T.ids('R9') + ' ' + JSON.stringify(T.score('R9').notes));
  T.LI_WS.aplus.SP.P2 = { v: true, at: NOW }; T.LI_WS.liveV++; T.reset();
  ok('parent has A+ (Workspace answer) = child has no A+ error', !T.hit('R9', 'aplus_missing') && T.score('R9').aplus.v === true && T.score('R9').aplus.src === 'parent', T.ids('R9'));
  delete T.LI_WS.aplus.SP.P2; T.HEALTH.SP.parentAplus = { P2: { v: true, at: NOW } }; T.HEALTH.SP.parentAplusAt = NOW; T.reset();
  ok('parent has A+ (Listing Health snapshot answer) = child has no A+ error', !T.hit('R9', 'aplus_missing') && T.score('R9').aplus.v === true, T.ids('R9'));
  T.HEALTH.SP.parentAplus = { P2: { v: false, at: NOW } }; T.HEALTH.SP.parentAplusAt = NOW + 1; T.reset();
  ok('child and parent both without A+ = A+ missing, an Error', (T.hit('R9', 'aplus_missing') || {}).sev === 'critical' && /listing or its parent/.test(T.hit('R9', 'aplus_missing').detail), JSON.stringify(T.hit('R9', 'aplus_missing')));
  r9.aplusAt = NOW - 20 * DAY; T.HEALTH.SP.parentAplus = { P2: { v: false, at: NOW - 20 * DAY } }; T.HEALTH.SP.parentAplusAt = NOW + 2; T.reset();
  ok('a "missing" answer older than 14 days is not shown as an error (asked again first), with a note', !T.hit('R9', 'aplus_missing') && T.score('R9').aplus.stale === true && T.score('R9').notes.some(n => /A\+ not judged yet/.test(n)), T.ids('R9'));
  r9.aplus = true; r9.aplusAt = NOW; T.HEALTH.SP.parentAplus = {}; T.reset();
  r9.content.descLen = 50; T.reset();
  ok('A+ live = no "Description weak" (Amazon shows the A+ instead)', !T.hit('R9', 'desc_below') && T.ids('R9') === '', T.ids('R9'));
  r9.aplus = false; T.HEALTH.SP.parentAplus = { P2: { v: false, at: NOW } }; T.HEALTH.SP.parentAplusAt = NOW + 3; T.reset();
  ok('…no A+ anywhere: the description is judged again', (T.hit('R9', 'desc_below') || {}).detail === '50 characters', T.ids('R9'));
  r9.aplus = true; r9.content.descLen = 300; T.HEALTH.SP.parentAplus = {}; T.reset();

  console.log('== A4: search terms count the words only ==');
  const words233 = 'x'.repeat(233);                      // 233 bytes of words
  const spaced = Array.from({ length: 36 }, (_, i) => words233.slice(Math.floor(i * 233 / 36), Math.floor((i + 1) * 233 / 36))).join(' ');   // 268 characters: 233 of words + 35 spaces
  ok('268 bytes with 35 spaces = 233 bytes of words', Buffer.byteLength(spaced) === 268 && T.lrKwBytes(spaced) === 233 && T.lrKwBytes('a; b, c. d') === 4 && T.lrKwBytes('é') === 2, Buffer.byteLength(spaced) + ' ' + T.lrKwBytes(spaced));
  liveEntry('SP', 'R10', { cAt: NOW, title: T.rows.find(r => r.sku === 'R10').title, titleLen: 73, bul: 5, desc: 300, kw: spaced, kwBytes: T.lrKwBytes(spaced) });
  ok('…= no problem; the Workspace cell says "Search terms: 233 of 249 bytes"', !T.hit('R10', 'keyword_bytes') && T.ids('R10') === ''
    && (() => { T.LI_WS.mode = 'live'; const p = T.liWsParents(['SP', 'CPC']).find(x => x.key === 'SP|P2'); const k = p.kids.find(x => x.sku === 'R10'); return k.c.kw.pass === true && /^Search terms: 233 of 249 bytes/.test(k.c.kw.found); })(), T.ids('R10'));
  liveEntry('SP', 'R10', { cAt: NOW, title: T.rows.find(r => r.sku === 'R10').title, titleLen: 73, bul: 5, desc: 300, kw: 'y'.repeat(260), kwBytes: 260 });
  ok('260 bytes of words = Needs attention (never an Error), "cut 11 bytes; over the limit Amazon ignores all of them"', (T.hit('R10', 'keyword_bytes') || {}).sev === 'action' && T.lrLevel('action').word === 'Needs attention'
    && /^260 of 249 bytes — cut 11; over the limit Amazon ignores all of them$/.test(T.hit('R10', 'keyword_bytes').detail) && /^Cut 11 bytes from the search terms/.test(T.hit('R10', 'keyword_bytes').fix) && T.hit('R10', 'keyword_bytes').tag === 'Amazon limit', JSON.stringify(T.hit('R10', 'keyword_bytes')));
  ok('a search-term count stored the old way (with spaces) is dropped and counted again', (() => { const e = T.LI_WS.live.SP.R10; delete e.kwBytes; T.LI_WS.liveV++; T.reset(); return T.score('R10').fresh.kwBytes === 260; })());
  delete T.LI_WS.live.SP.R10; T.LI_WS.liveV++; T.reset();

  console.log('== A5: fresh data wins, old data never shouts ==');
  const r14 = T.HEALTH.SP.rows.find(r => r.sku === 'R14');
  r14.content.images = 0; r14.checked = NOW - 21 * DAY; T.reset();
  const oldHit = T.hit('R14', 'no_main_image');
  ok('an Error from 21-day-old data = "Error? Check again" with a Check now button', !!oldHit && oldHit.sev === 'critical' && oldHit.stale === true && T.score('R14').stale === true
    && (h => /lr-lvl is-s">Error\? Check again<\/span>/.test(h) && /from data 21 days old/.test(h) && /data-lr-check="SP\|R14"[^>]*>Check now</.test(h) && /class="sev sev-s"/.test(h))(T.lrProblemHtml(oldHit, { brand: 'SP', sku: 'R14' }, '')), JSON.stringify(oldHit));
  ok('…the Workspace pill reads "None?" in the hollow look and the row\'s mix bar counts it "to check again"', (() => { const p = T.liWsParents(['SP', 'CPC']).find(x => x.key === 'SP|P4'); const k = p.kids[0]; const cell = T.liWsKidTable(p, 8); return k.stale === true && p.staleN === 1 && p.mix.chk === 1 && /li-ws-x is-s"[^>]*>None\?</.test(cell) && /<rect class="is-chk"/.test(T.liWsProblems(p)) && /1 to check again/.test(T.liWsProblems(p)); })());
  r14.checked = NOW - 2 * DAY; T.reset();
  ok('the same Error from 2-day-old data is a plain Error', T.hit('R14', 'no_main_image').stale === false && T.score('R14').stale === false);
  liveEntry('SP', 'R14', { gAt: NOW, slots: gallery8, iAt: NOW, cat: gallery8 });
  ok('a live read today beats the snapshot: the Error is gone on the Workspace AND on Parent ASINs (the same healthOf)', !T.hit('R14', 'no_main_image') && T.score('R14').pics.src === 'live'
    && T.liWsParents(['SP', 'CPC']).find(x => x.key === 'SP|P4').critN === 0);
  ok('an Error from a fresh listings report (no price) is a plain Error', (() => { const r = Object.assign({}, T.rows.find(x => x.sku === 'R6'), { price: 0 }); const h = T.healthOf(r, T.hCtx()).found.find(x => x.detector === 'no_price'); return h && h.stale === false && h.src === 'report'; })());
  ok('…from a 21-day-old listings report it is "Error? Check again" too, but with "press Refresh both brands" instead of a Check now button (a live read cannot renew the price)', (() => {
    const was = T.HEALTH.SP.at; T.HEALTH.SP.at = new Date(NOW - 21 * DAY); T.reset();
    const r = Object.assign({}, T.rows.find(x => x.sku === 'R6'), { price: 0 }); const h = T.healthOf(r, T.hCtx()).found.find(x => x.detector === 'no_price'); const html = T.lrProblemHtml(h, { brand: 'SP', sku: 'R6' }, '');
    T.HEALTH.SP.at = was; T.reset();
    return h && h.stale === true && /Error\? Check again/.test(html) && /from the listings report 21 days old — press “Refresh both brands”/.test(html) && !/Check now/.test(html); })());
  r14.content.images = 8; r14.checked = NOW; delete T.LI_WS.live.SP.R14; T.LI_WS.liveV++; T.reset();
  // Check now and "Re-check all errors with Amazon" read through the Workspace queue
  r14.content.images = 0; r14.checked = NOW - 21 * DAY; T.reset();
  T.LI_WS.mode = 'live';
  T.LI_WS.rows = T.liWsParents(['SP', 'CPC']);
  T.liWsRecheck();
  ok('"Re-check all errors with Amazon" queues content, status, catalogue pictures and A+ for the 2 listings showing an Error only (R13: 4 pictures, R14: old no-image), progress "Re-checking 0 of 2"',
    T.LI_WS.sweep && T.LI_WS.sweep.kind === 'errors' && T.LI_WS.sweep.total === 2 && T.LI_WS.sweep.done === 0 && T.LI_WS.checking.has('SP|R14') && T.LI_WS.checking.has('SP|R13') && !T.LI_WS.checking.has('SP|R6'), JSON.stringify([T.LI_WS.sweep && T.LI_WS.sweep.total, [...T.LI_WS.checking]]));
  T.liWsCheckNow('SP', 'R2', { disabled: false, textContent: '' });
  ok('Check now marks the listing as reading until its LAST read lands (3 reads: content, status, catalogue pictures; its ASINs are not real, so no A+ call)', T.LI_WS.checking.get('SP|R2') === 3, JSON.stringify([...T.LI_WS.checking]));
  const box2 = T.liWsAuditBox(T.liWsParents(['SP', 'CPC']).find(x => x.key === 'SP|P1'));
  ok('the audit box names the level in the two words: Images (R13, 4 pictures, an Error) and Standard format (Needs attention)',
    /lr-lvl is-c">Error: fix first<\/span>✗ Images/.test(box2) && /lr-lvl is-a">Needs attention<\/span>✗ Standard format/.test(box2), box2);
  const box4 = T.liWsAuditBox(T.liWsParents(['SP', 'CPC']).find(x => x.key === 'SP|P4'));
  ok('…and "Error? Check again" (hollow) when every Error in the step rests on old data (R14, 21 days)', /sev sev-s"><\/span>[^]*?lr-lvl is-s">Error\? Check again<\/span>✗ Images/.test(box4), box4);
  r14.content.images = 8; r14.checked = NOW;
  T.HEALTH.SP.rows.find(r => r.sku === 'R13').checked = NOW; T.reset();

  console.log('== B1 / B2: two words everywhere; recommended levels ==');
  ok('the two words: Critical = "Error: fix first" (red), Needs action and Needs review = "Needs attention" (orange)',
    T.lrLevel('critical').word === 'Error: fix first' && T.lrLevel('critical').cls === 'sev-c' && T.lrLevel('action').word === 'Needs attention' && T.lrLevel('review').word === 'Needs attention' && T.lrLevel('review').cls === 'sev-a');
  const lv = T.LR_DEFAULT.issues.reduce((acc, it) => { acc[it.id] = it.sev; return acc; }, {});
  ok('recommended levels: the seven Errors, and Missing required variation value / search terms / 6–7 pictures as Needs attention',
    ['amz_error', 'amz_suppressed', 'inv_mismatch', 'price_error', 'main_image', 'img_secondary', 'aplus_missing'].every(id => lv[id] === 'critical')
    && lv.var_value === 'action' && lv.kw_bytes === 'action' && lv.img_low === 'review' && T.LR_DEFAULT.issues.filter(it => it.sev === 'critical').length === 7, JSON.stringify(lv));
  const two2 = T.lrProblemsHtml([T.hit('R4', 'size_format'), Object.assign({}, T.hit('R4', 'variation_naming'), { sev: 'review' }), Object.assign({}, T.hit('R4', 'size_format'), { sev: 'critical', stale: false })], { brand: 'SP', sku: 'R4' });
  ok('Errors always come first, then Needs attention (action before review); review reads "Needs attention" in orange too',
    two2.indexOf('is-c">✕ Error: fix first') < two2.indexOf('is-a">✕ Needs attention') && (two2.match(/is-a">✕ Needs attention/g) || []).length === 2 && !/sev-r/.test(two2), two2);
  const render = (() => { T.LI_WS.on = true; T.LI_WS.sweep = null; /* the re-check above is still running (its stub calls never land): cleared, or the bar shows Stop */ T.liWsRender(); return T.el('liWs').innerHTML; })();
  ok('the Workspace legend: the two words and "Error? Check again"; the toolbar\'s one main button reads "Re-check all errors with Amazon (N)" with the Errors in view',
    /Error: fix first · <span class="sev sev-a"><\/span> Needs attention/.test(render) && /Error\? Check again/.test(render) && T.el('hRecheck').textContent === 'Re-check all errors with Amazon (1)' && T.el('hRecheck').dataset.liWsRecheck === 'go' && T.el('hRecheck').disabled === false
    && !/sev-r"><\/span> Needs review/.test(render) && !/Critical · /.test(render), render.slice(0, 400) + ' | ' + T.el('hRecheck').textContent);
  ok('the look: number boxes, a flush list card with one row per parent (picture, Fix first line, ASIN, mix bar, ›), no in-row expansion',
    /class="ls-boxes li-ws-cards"/.test(render) && (render.match(/class="ls-box[" ]/g) || []).length === 6 && /class="card xlwrap ls-card ls-clip"><table class="xl li-ws-tbl ls-tbl"/.test(render)
    && (render.match(/<tr class="li-ws-row ls-row"/g) || []).length === 6 && /class="ls-pic is-none"/.test(render) && /<span class="ls-fix" title="Secondary images missing"><b>Fix first:<\/b> Secondary images missing · 1 of 7 listings<\/span>/.test(render)
    && /<svg class="ls-mix"/.test(render) && /class="ls-chev li-ws-open" data-li-ws-panel="SP\|P1"/.test(render) && !/data-li-ws-tog/.test(render), render.slice(render.indexOf('<table'), render.indexOf('<table') + 900));
  ok('the out-of-stock softening stays: 0 in stock turns an Error into Needs attention, except no main image, suppressed and Amazon error',
    (() => { const r = Object.assign({}, T.rows.find(x => x.sku === 'R13'), { qty: 0 }); const h = T.healthOf(r, T.hCtx()); const img = h.found.find(x => x.detector === 'images_below'); const r2 = Object.assign({}, T.rows.find(x => x.sku === 'R6'), { qty: 0, content: Object.assign({}, T.rows.find(x => x.sku === 'R6').content, { images: 0 }) }); const h2 = T.healthOf(r2, T.hCtx()); return img && img.sev === 'action' && / \(0 in stock, so not critical\)$/.test(img.detail) && h2.found.find(x => x.detector === 'no_main_image').sev === 'critical'; })());
  ok('Workspace = Parent ASINs still, with live reads and A+ answers in play', (() => { T.LI_WS.on = false; liveEntry('SP', 'R1', { gAt: NOW, slots: gallery8, iAt: NOW, cat: ['MAIN', 'PT01'] }); T.LI_WS.aplus.SP.P1 = { v: true, at: NOW }; T.LI_WS.liveV++; T.reset();
    const hm = {}; T.rows.forEach(r => { const key = r.brand + '|' + r.parent; const g = hm[key] || (hm[key] = { critical: 0, action: 0, review: 0 }); const b = T.healthOf(r, T.hCtx()).bucket; if (g[b] !== undefined) g[b]++; });
    return ['live', 'all'].every(mode => { T.LI_WS.mode = mode; return T.liWsParents(['SP', 'CPC']).every(p => { const g = hm[p.key]; return g && p.critN === g.critical && p.actN === g.action && p.revN === g.review && p.attN === g.action + g.review; }); }) && hm['SP|P1'].critical >= 1; })());

  console.log('== the Workspace number cards: counts, P parents, and what each click shows ==');
  const C = load({ ws: true });
  const c13 = C.rows.find(r => r.sku === 'R13');
  c13.content.bullets = 3; C.reset();                                // R13: 4 pictures (an Error) AND 3 bullets (Needs attention)
  C.LI_WS.on = true; C.LI_WS.mode = 'live';
  const k13 = C.liWsParents(['SP', 'CPC']).flatMap(p => p.kids).find(k => k.sku === 'R13');
  ok('a listing with an Error AND a Needs attention problem counts in both cards', k13.cards.err === true && k13.cards.att === true && k13.cards.ok === false, JSON.stringify(k13.cards));
  const showN = k => { C.LI_WS.card = k; C.LI_WS.chip = 'all'; C.liWsRender(); return C.LI_WS.rows.map(p => p.key); };
  const errRows = showN('err'), attRows = showN('att'), okRows = showN('ok');
  ok('…and its parent shows under both filters', errRows.includes('SP|P1') && attRows.includes('SP|P1'), JSON.stringify({ errRows, attRows }));
  C.LI_WS.card = ''; C.liWsRender();
  const htmlC = C.el('liWs').innerHTML;
  const pOf = re => +((htmlC.match(re) || [])[1] || -1);
  ok('the P on each card = the number of parents its click shows', pOf(/data-li-ws-card="err"[^]*?in (\d+) parents?</) === errRows.length && pOf(/data-li-ws-card="att"[^]*?in (\d+) parents?</) === attRows.length
    && pOf(/data-li-ws-card="ok"[^]*?(\d+) parents? fully clean/) === okRows.length, JSON.stringify([errRows.length, attRows.length, okRows.length]));
  const parentsC = C.liWsParents(['SP', 'CPC']);
  ok('the No problem filter never shows a parent that has any problem', okRows.length > 0 && okRows.every(key => { const p = parentsC.find(x => x.key === key); return p.kids.filter(k => k.live).every(k => !k.problem && k.bucket === 'healthy'); }), JSON.stringify(okRows));
  ok('the problem line keeps the old number', new RegExp(`${parentsC.reduce((s, p) => s + p.liveProbN, 0)} counted listings have a problem`).test(htmlC));
  C.LI_WS.card = 'att'; C.liWsRender();
  const kt = C.liWsKidTable(C.LI_WS.byKey.get('SP|P1'), 8);
  ok('inside the parent, the matching listings come first and are marked; the others are faded under "Other listings"', /is-match is-m-att/.test(kt) && /Other listings/.test(kt) && kt.indexOf('is-match') < kt.indexOf('Other listings') && kt.indexOf('Other listings') < kt.indexOf('is-other'));
  ok('the "Showing:" bar names the card and the parent count', new RegExp(`Showing: <b>Needs attention</b> · ${attRows.length} parent`).test(C.el('liWs').innerHTML));

  console.log('== the side panel: open, tabs, close, move ==');
  C.LI_WS.card = ''; C.liWsRender();
  C.liWsPanelOpen('SP|P1');
  const P = C.el('lsPanel');
  ok('a parent opens in the side panel: header (name, ASIN · brand · live count), Read from Amazon now, Open in Parent ASINs, three tabs',
    C.LI_WS.panel && C.LI_WS.panel.key === 'SP|P1' && C.LI_WS.panel.tab === 'fix' && P.hidden === false && /class="ls-panel-h"/.test(P.innerHTML) && /Parent P1/.test(P.innerHTML)
    && /<span class="ui-mono">P1<\/span> · Ridhi · 7 live of 7 listings/.test(P.innerHTML) && /data-li-ws-again="SP\|P1"[^>]*>Read from Amazon now</.test(P.innerHTML) && /data-li-ws-open="SP\|P1">Open in Parent ASINs</.test(P.innerHTML)
    && /data-li-ws-ptab="fix" aria-selected="true"/.test(P.innerHTML) && /data-li-ws-ptab="list"/.test(P.innerHTML) && /data-li-ws-ptab="audit"/.test(P.innerHTML), P.innerHTML.slice(0, 700));
  ok('What to fix: one row per rule, Errors first (Secondary images missing — 1 listing), then Needs attention (Size formatting — 2 listings), each with the level word, the SKUs, how to fix, a tag and Fix',
    (() => { const h = P.innerHTML; const a = h.indexOf('is-c">✕ Error: fix first</span>Secondary images missing — 1 listing'), b = h.indexOf('is-a">✕ Needs attention</span>Size formatting inconsistent — 2 listings'); return a > 0 && b > a && /<small title="R13">R13<\/small>/.test(h) && /ls-rec-how">Add 2 more pictures/.test(h) && /data-lr-fix="img\|SP\|R13"/.test(h) && /class="ls-rec is-err"/.test(h) && /class="ls-rec is-att"/.test(h); })(), P.innerHTML.slice(P.innerHTML.indexOf('ls-recs'), P.innerHTML.indexOf('ls-recs') + 900));
  ok('…Errors from old data read "Error? Check again" in the panel too', (() => {
    const r = C.rows.find(x => x.sku === 'R14'); r.content.images = 0; r.checked = NOW - 21 * DAY; C.reset(); C.liWsRender();
    C.liWsPanelOpen('SP|P4'); const h = C.el('lsPanel').innerHTML;
    r.content.images = 8; r.checked = NOW; C.reset(); C.liWsRender();
    return /class="ls-rec is-chk"/.test(h) && /Error\? Check again<\/span>Main image missing/.test(h); })(), C.el('lsPanel').innerHTML.slice(0, 300));
  C.liWsPanelOpen('SP|P1');
  C.LI_WS.panel.tab = 'list'; C.liWsPanelRender();
  ok('Listings tab: every child with picture, SKU, status and its problems as tags or ✓; the table toggle', (C.el('lsPanel').innerHTML.match(/class="ls-kid"/g) || []).length === 7 && /ls-tag is-err"[^>]*>Secondary images missing/.test(C.el('lsPanel').innerHTML)
    && /ls-tag is-ok">✓ No problem/.test(C.el('lsPanel').innerHTML) && /data-li-ws-ptable="1">Show every check as a table/.test(C.el('lsPanel').innerHTML), (C.el('lsPanel').innerHTML.match(/class="ls-kid"/g) || []).length);
  C.LI_WS.openSku.add('SP|R13'); C.liWsPanelRender();
  ok('…a child opens to its own problems with "Show passed checks"', /ls-kid-d/.test(C.el('lsPanel').innerHTML) && /lr-prob-what"><span class="lr-lvl is-c">✕ Error: fix first<\/span>Secondary images missing — 4 of 6/.test(C.el('lsPanel').innerHTML) && /Show passed checks \(\d+\)/.test(C.el('lsPanel').innerHTML), C.el('lsPanel').innerHTML.slice(C.el('lsPanel').innerHTML.indexOf('ls-kid-d'), C.el('lsPanel').innerHTML.indexOf('ls-kid-d') + 400));
  C.LI_WS.openSku.clear();
  C.LI_WS.panel.table = true; C.liWsPanelRender();
  ok('…"Show every check as a table" shows the checklist table', /class="li-ws-kidtable"/.test(C.el('lsPanel').innerHTML) && (C.el('lsPanel').innerHTML.match(/class="li-ws-kid[" ]/g) || []).length === 7);
  C.LI_WS.panel.table = false; C.LI_WS.panel.tab = 'audit'; C.liWsPanelRender();
  ok('Audit tab: the failing steps with "Show these listings", the passing ones folded', /✗ Images/.test(C.el('lsPanel').innerHTML) && /data-li-ws-show="SP\|P1\|fmt"/.test(C.el('lsPanel').innerHTML) && /1 step passes: Template/.test(C.el('lsPanel').innerHTML));
  ok('↓ moves to the next parent in the order showing, ↑ back', (() => { const keys = C.LI_WS.rows.map(p => p.key); const i = keys.indexOf('SP|P1'); C.liWsPanelMove(1); const a = C.LI_WS.panel.key === keys[i + 1]; C.liWsPanelMove(-1); return a && C.LI_WS.panel.key === 'SP|P1'; })());
  C.liWsPanelClose(true);
  ok('close: the panel is hidden and empty, nothing is open', C.LI_WS.panel === null && P.hidden === true && P.innerHTML === '');
  ok('the list did not redraw while the panel opened and closed (the rows are the same objects)', (() => { const before = C.LI_WS.rows; C.liWsPanelOpen('SP|P2'); C.liWsPanelClose(false); return C.LI_WS.rows === before; })());
  ok('the Workspace going away closes the panel too', (() => { C.liWsPanelOpen('SP|P2'); C.liWsOff(); return C.LI_WS.panel === null; })());
  console.log('== one child as a sidebar: the shared component (12 Nov 2026) ==');
  (() => {
    C.LI_WS.on = true; C.LI_WS.mode = 'live'; C.reset(); C.liWsRender();
    const kid = C.lkKid('SP', 'R13');
    const h = C.lkHtml(kid, { close: 'data-lk-close="1"', back: 'data-lk-close="1"', backLabel: '← Back' });
    ok('the component: header (SKU, ASIN, parent, status, stock, ×, Check now), groups by level, rows without a repeated level word, passed checks, sources',
      /class="ls-panel-h lk-h"/.test(h) && /lk-sku[^>]*>R13</.test(h) && /B0R13/.test(h) && /Parent P1/.test(h) && /units? in stock/.test(h) && /data-lk-close="1" aria-label="Close">×/.test(h)
      && /data-lr-check="SP\|R13"[^>]*>Check now/.test(h) && /lk-gh is-c">Error: fix first/.test(h) && /class="ls-rec is-err"/.test(h) && !/ls-rec is-err"><span class="ls-dot" aria-hidden="true"><\/span><div class="ls-rec-t"><b><span class="lr-lvl/.test(h)
      && /class="ls-rec-how"/.test(h) && /Show passed checks \(\d+\)/.test(h) && /class="ls-panel-f">Amazon: .* · Full refresh: .* · Image Manager: .* · Listing Rules/.test(h), h.slice(0, 400));
    ok('…it says what healthOf says: the same findings, no more, no fewer', (h.match(/class="ls-rec is-(err|chk|att)"/g) || []).length === kid.found.length, kid.found.length);
    C.LK.pass.add('SP|R13');
    ok('…"Show passed checks" lists them with their source', /class="lk-passed"/.test(C.lkHtml(kid, { close: '' })) && /Hide passed checks/.test(C.lkHtml(kid, { close: '' })));
    C.LK.pass.clear();
    C.liWsPanelOpen('SP|P1'); C.LI_WS.panel.tab = 'list'; C.liWsPanelRender();
    C.liWsPanelKid('SP|R13');
    const P = C.el('lsPanel').innerHTML;
    ok('Workspace panel → Listings: a child opens as the SAME component, with "← … all listings" and × closing the panel', /class="ls-panel-h lk-h"/.test(P) && /data-li-ws-pback="1">← .* · all listings/.test(P) && /data-li-ws-pclose="1" aria-label="Close"/.test(P));
    C.liWsPanelKidBack();
    ok('…back goes to the Listings tab', !C.LI_WS.panel.kid && /class="ls-kid/.test(C.el('lsPanel').innerHTML));
    C.liWsPanelClose(false);
  })();
  ok('a parent without a counted listing: the panel says so instead of showing rows', (() => { C.LI_WS.on = true; C.LI_WS.mode = 'live'; const r = C.rows.find(x => x.sku === 'R14'); r.qty = 0; C.reset(); C.liWsRender(); C.liWsPanelOpen('SP|P4'); const h = C.el('lsPanel').innerHTML; r.qty = 5; C.reset(); C.liWsPanelClose(false); return /No live listing/.test(h); })());
  console.log('== the side panel stays put while reads land (12 Nov 2026) ==');
  (() => {
    C.LI_WS.on = true; C.LI_WS.mode = 'live'; C.reset(); C.liWsRender();
    C.liWsPanelOpen('SP|P1');
    const P2 = C.el('lsPanel');
    const before = P2.innerHTML;
    // Reads running: a landed read that changes the panel waits (at most once every 2 s); it does not redraw at once.
    C.LI_WS.inflight = 1; C.LI_WS.panelSig = ['changed'];
    C.liWsPanelSync();
    const held = P2.innerHTML === before && !!C.LI_WS.panelT;
    // Scrolling the panel holds even an idle redraw until 400 ms after the last scroll.
    const queued = C.LI_WS.q.splice(0);             // opening the panel queued its reads: idle = nothing queued, nothing out
    C.LI_WS.inflight = 0; C.LI_WS.pScrollAt = Date.now();
    C.liWsPanelSchedule();
    const heldScroll = P2.innerHTML === before && !!C.LI_WS.panelT;
    C.LI_WS.pScrollAt = 0;
    C.liWsPanelSchedule();
    const drawnIdle = !C.LI_WS.panelT && C.LI_WS.panelSig[0] !== 'changed';
    C.LI_WS.q.push(...queued);
    ok('reads running: the panel redraw is held (at most once per 2 s); while it is scrolled it waits; idle and still it draws', held && heldScroll && drawnIdle, [held, heldScroll, drawnIdle].join(' '));
    // Rows keep their order while reads land; new ones join at the end; Sort again (panelResort) sorts afresh.
    C.LI_WS.panelResort = true;
    const ids = list => list.map(x => x.k).join('');
    const first = ids(C.liWsPanelKeep('test', 'ctx', [{ k: 'a' }, { k: 'b' }, { k: 'c' }], x => x.k));
    C.LI_WS.panelResort = false; C.LI_WS.panelMoved = false;
    const kept = ids(C.liWsPanelKeep('test', 'ctx', [{ k: 'c' }, { k: 'd' }, { k: 'a' }, { k: 'b' }], x => x.k));
    const moved = C.LI_WS.panelMoved;
    C.LI_WS.panelResort = true;
    const fresh = ids(C.liWsPanelKeep('test', 'ctx', [{ k: 'c' }, { k: 'a' }], x => x.k));
    C.LI_WS.panelResort = false;
    ok('panel rows keep their order while reads land, new ones at the end, Sort again offered; a resort takes the fresh order', first === 'abc' && kept === 'abcd' && moved && fresh === 'ca', [first, kept, moved, fresh].join(' '));
    C.liWsPanelClose(false);
  })();
  ok('a message a source cut ends on a whole word with …, never mid-word; a short one is untouched',
    C.lrWholeCut('Provide a valid value for the attribute so that the resu', 56) === 'Provide a valid value for the attribute so that the…' && C.lrWholeCut('All fine.', 140) === 'All fine.', C.lrWholeCut('Provide a valid value for the attribute so that the resu', 56));
  (() => {
    const r = C.rows.find(x => x.sku === 'R1');
    const msg = 'The value provided for item_type_keyword is not valid for this product type, so the listing cannot be shown in search results until it is changed';
    const cut = msg.slice(0, 140);
    C.AMZ.map = new Map([['SP|R1', { st: 'BUYABLE,DISCOVERABLE', ie: 1, iw: 0, im: cut, em: ['ERROR 90220: ' + msg] }]]); C.reset();
    const hit = C.healthOf(r, C.hCtx()).found.find(h => h.detector === 'amazon_error');
    const html = hit ? C.lrProblemHtml(hit, { brand: 'SP', sku: 'R1' }) : '';
    const times = html.split('cannot be shown in search').length - 1;
    ok("Amazon's error: its message once, in full (from the issue list, not the 140-character cut); the fix line only says what to do",
      !!hit && times === 1 && html.includes(msg) && hit.fix === 'Open Listing Errors and do what Amazon asks.', hit && (times + ' ' + hit.fix));
    C.AMZ.map.set('SP|R1', { st: '', ie: 1, iw: 0, im: cut, em: [] }); C.reset();
    const hit2 = C.healthOf(r, C.hCtx()).found.find(h => h.detector === 'amazon_error');
    ok('…a snapshot with only the 140-character cut ends it on a whole word with …', !!hit2 && /\b(until|it|is)…$/.test(hit2.detail) && hit2.detail.length <= 141, hit2 && hit2.detail);
    C.AMZ.map = null; C.reset();
  })();
  ok('Size heading: Size not in house style: "18x18 Inc" — no "approved is"', (() => {
    const h = C.lrProblemHtml(C.healthOf(C.rows.find(x => x.sku === 'R2'), C.hCtx()).found.find(x => x.detector === 'size_format'), null);
    return /lr-prob-what"><span class="lr-lvl is-a">✕ Needs attention<\/span>Size not in house style: &quot;18x18 Inc&quot;</.test(h) && !/approved is/.test(h); })());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
module.exports = { SAMPLE, CAT, load };
