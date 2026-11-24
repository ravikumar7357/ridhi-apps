/* Image Manager — THE PICTURE CHECKS ARE ACCURATE (17 Nov 2026): src/app/listing/image-manager.js imCheck, in the stub page (opts.im).
 *   node tests/image-accuracy-test.js
 * For EACH check: the true cases are flagged, the false cases are not, and a listing the check cannot be decided for (data missing)
 * is "not checked" (null) — never a problem. Also: "Shows another SKU's pictures" and "No swatch" are gone everywhere; the cards count only what is
 * really so; the tiles compare pictures, not links; a failed catalogue read is never "Amazon serves nothing"; and the console proof
 * (imgAccuracyReport, imgCounts) against a stub Amazon: MATCH, DIFFERENT, NOT READ. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const A = id => 'https://m.media-amazon.com/images/I/' + id + '.jpg';
const SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'];
const full = (p, n) => Object.fromEntries(SLOTS.slice(0, n == null ? 9 : n).map(s => [s, A(p + s)]));
const without = (map, ...slots) => Object.fromEntries(Object.entries(map).filter(([s]) => !slots.includes(s)));
// A listing record as the list holds it: buyable, in the catalogue, no issues — then what the case changes.
const mk = (sku, over) => Object.assign({ sku, asin: 'B0' + sku, psku: 'PAR', pa: 'B0PAR', c: 'Blue', z: '18x18', st: 'BUYABLE,DISCOVERABLE', img: full(sku), live: full(sku), iss: [], ie: 0 }, over || {});
const E = (c, m, a) => ({ s: 'E', c: String(c), m, a: a || [] });
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

function page(items, opts) {
  opts = opts || {};
  const P = load(Object.assign({ im: true, sq: true, pc: true }, opts.load || {}));
  P.el('imBrand').value = 'SP';
  P.el('imFilter').value = 'all';
  P.IML.SP = { at: new Date(2026, 10, 17, 13, 14), items: [{ sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins parent', img: { MAIN: A('par') }, live: { MAIN: A('par') } }].concat(items) };
  P.IML.CPC = { at: new Date(2026, 10, 17, 12, 0), items: opts.cpc || [] };
  P.HEALTH.SP.rows = items.map(i => ({ sku: i.sku, asin: i.asin, parent: 'B0PAR', title: 't', qty: opts.qty && i.sku in opts.qty ? opts.qty[i.sku] : 5, status: 'Active', channel: 'AFN' }));
  P.HEALTH.CPC.rows = (opts.cpc || []).map(i => ({ sku: i.sku, asin: i.asin, parent: '', title: 't', qty: 5, status: 'Active', channel: 'AFN' }));
  P.PC.loaded = true;
  P.IMQ.dims = new Map();
  return P;
}

(async () => {
  const P = page([]);
  const chk = (item, k) => P.imCheck(item, k, 'SP');
  // the listings made up below (not on the page) have FBA stock: Image Manager marks problems on children with stock only (24 Nov 2026)
  P.HEALTH.SP.rows = P.HEALTH.SP.rows.concat(['D1', 'W1'].map(sku => ({ sku, qty: 5, status: 'Active', channel: 'AFN' })));
  // every picture of a record measured at w × h
  const measure = (item, w, h) => SLOTS.forEach(s => [item.img && item.img[s], item.live && item.live[s]].forEach(u => { if (u) P.IMQ.dims.set(P.imqId(u), [w, h]); }));

  console.log('== No main at all: none sent by us AND none served by Amazon ==');
  ok('TRUE: our listing has no MAIN and Amazon\'s catalogue (read, answered) serves none', chk(mk('A1', { img: without(full('A1'), 'MAIN'), live: without(full('A1'), 'MAIN') }), 'nomain') === true);
  ok('FALSE: we sent a MAIN (whatever Amazon serves) · FALSE: Amazon serves a MAIN', chk(mk('A2', { live: {} }), 'nomain') === false && chk(mk('A3', { img: without(full('A3'), 'MAIN') }), 'nomain') === false);
  ok('NOT CHECKED: no MAIN of ours and the catalogue did not answer (liveErr) — before this, it was flagged', chk(mk('A4', { img: without(full('A4'), 'MAIN'), live: {}, liveErr: 'catalogue 429' }), 'nomain') === null);
  ok('NOT CHECKED: no MAIN of ours and the listing has no ASIN yet (the catalogue was never asked)', chk(mk('A5', { asin: '', img: without(full('A5'), 'MAIN'), live: {} }), 'nomain') === null);

  console.log('== "Using the family\'s main" is gone (24 Nov 2026, the MD\'s task #5) ==');
  ok('no MAIN of ours while Amazon serves one is no check any more (imCheck has no answer for it)', chk(mk('B1', { img: without(full('B1'), 'MAIN') }), 'noown') === null);

  console.log('== Main not OK: a person\'s mark on the main picture shoppers see ==');
  P.PC.marks.SP = { [P.imqId(A('C1MAIN'))]: { v: 'bad' }, [P.imqId(A('C2MAIN'))]: { v: 'ok' }, [P.imqId(A('oldMAIN'))]: { v: 'bad' } };
  ok('TRUE: the main picture Amazon serves is marked Not OK', chk(mk('C1'), 'pcbad') === true);
  ok('FALSE: marked OK · FALSE: never marked · FALSE: the mark is on an OLD picture, Amazon now serves another main', chk(mk('C2'), 'pcbad') === false && chk(mk('C3'), 'pcbad') === false
    && chk(mk('C4', { img: Object.assign(full('C4'), { MAIN: A('oldMAIN') }) }), 'pcbad') === false);
  ok('NOT CHECKED: the catalogue did not answer (which picture shoppers see is not known)', chk(mk('C1', { live: {}, liveErr: 'catalogue 500' }), 'pcbad') === null);
  { const Q = page([]); Q.PC.loaded = false; Q.PC.marks.SP = {}; ok('NOT CHECKED: the marks are not read yet', Q.imCheck(mk('C9'), 'pcbad', 'SP') === null); }

  console.log('== Too small (under 2000): REMOVED — the company\'s 1500 pictures are fine for Amazon; a size is information only ==');
  {
    const d1 = mk('D1'); measure(d1, 1500, 1500);
    ok('a listing whose every picture is 1500 × 1500: no problem at all — no check, no chip, not in "need pictures", not in the sheet',
      !('small' in P.IM_CHECKS) && chk(d1, 'small') === null && P.imProblems(d1, 'SP').length === 0 && P.imKidChip(d1).t === 'Buyable' && P.imNeeds(d1) === false);
    ok('…before, it was flagged (the old count imgCounts shows)', P.imOldCheck(d1, 'small', 'SP', new Map()) === true);
    ok('no card, no filter option, no download column, no row words, no "below 2000" anywhere', !P.IM_CARDS.some(c => c.k === 'small') && !/value="small"|Too small/.test(SRC('index.html'))
      && !P.IM_DL_COLS.some(c => /Too small|2000/.test(c)) && !P.IM_DL_CHECKS.some(c => c.k === 'small') && !/2000/.test(P.imKidSummary(d1)) && !/below 2000/.test(P.imTile('PT01', A('D1PT01'), A('D1PT01'), false, 'D1')));
    ok('the picture rules give the size as information (an OK chip "1500 × 1500"), never a warning', P.imqCheck({ slot: 'PT01', w: 1500, h: 1500 }).level === 'ok' && P.imqCheck({ slot: 'PT01', w: 1500, h: 1500 }).chips.every(c => c.lv === 'ok'));
    ok('…but an UPLOAD under 2000 × 2000 is still refused (the company rule, unchanged)', /^Company rule: at least 2000 × 2000/.test(P.imqCheck({ slot: 'PT01', upload: true, w: 1500, h: 1500, bytes: 3e6, type: 'image/jpeg' }).block));
  }

  console.log('== Fewer than 7: real pictures = MAIN + PT01–PT08, ours or Amazon\'s, whichever is more ==');
  ok('TRUE: 5 of ours, 5 served', chk(mk('F1', { img: full('F1', 5), live: full('F1', 5) }), 'few') === true);
  ok('FALSE: 7 of ours, 3 served (ours is more) · FALSE: 4 of ours, 8 served (Amazon\'s is more)', chk(mk('F2', { img: full('F2', 7), live: full('F2', 3) }), 'few') === false
    && chk(mk('F3', { img: full('F3', 4), live: full('F3', 8) }), 'few') === false);
  ok('…the old way added the two together: 4 of ours in MAIN–PT03 + 3 served in other slots was "7" — now 4, flagged',
    chk(mk('F4', { img: full('F4', 4), live: { PT04: A('x4'), PT05: A('x5'), PT06: A('x6') } }), 'few') === true && P.imOldCheck(mk('F4', { img: full('F4', 4), live: { PT04: A('x4'), PT05: A('x5'), PT06: A('x6') } }), 'few', 'SP', new Map()) === false);
  ok('TRUE: the swatch is not counted (6 + a swatch = 6)', chk(mk('F5', { img: Object.assign(full('F5', 6), { SWCH: A('F5SW') }), live: full('F5', 6) }), 'few') === true);
  const rej = mk('F6', { img: full('F6', 9), live: full('F6', 6), iss: [E(100581, 'Image rejected', ['other_product_image_locator_6']), E(100581, 'Image rejected', ['other_product_image_locator_7']), E(100581, 'Image rejected', ['other_product_image_locator_8'])] });
  ok('TRUE: 9 sent but Amazon rejected 3 of them (an ERROR naming each slot) and serves 6 → 6 real pictures', chk(rej, 'few') === true && P.imPicCount(rej).ours === 6 && P.imPicCount(rej).n === 6);
  ok('NOT CHECKED: 5 of ours, and the catalogue did not answer · FALSE: 8 of ours is enough whatever Amazon serves', chk(mk('F7', { img: full('F7', 5), live: {}, liveErr: 'catalogue 429' }), 'few') === null
    && chk(mk('F8', { img: full('F8', 8), live: {}, liveErr: 'catalogue 429' }), 'few') === false);

  console.log('== Amazon picture error: only Amazon\'s own issues, by what Amazon names ==');
  ok('TRUE: an ERROR naming a picture slot · TRUE: ERROR 18320 · TRUE: an ERROR naming nothing whose words are about an image',
    chk(mk('G1', { iss: [E(100581, 'Rejected', ['main_product_image_locator'])] }), 'amzerr') === true && chk(mk('G2', { iss: [E(18320, 'The main image is missing or incorrect')] }), 'amzerr') === true
    && chk(mk('G3', { iss: [E(5, 'The image could not be downloaded')] }), 'amzerr') === true);
  ok('TRUE: an ERROR about the swatch, even when Amazon names another attribute on it (the swatch is a picture slot)',
    chk(mk('G4', { iss: [E(99010, 'A value is missing for the colour swatch of this variation', ['color'])] }), 'amzerr') === true
    && P.imOldCheck(mk('G4', { iss: [E(99010, 'A value is missing for the colour swatch of this variation', ['color'])] }), 'amzerr', 'SP', new Map()) === true);
  ok('FALSE: a WARNING on a picture slot · FALSE: an ERROR about the unit count · FALSE: no issues', chk(mk('G5', { iss: [{ s: 'W', c: '1', m: 'Image is small', a: ['other_product_image_locator_2'] }] }), 'amzerr') === false
    && chk(mk('G6', { iss: [E(90244, 'The value for Ounce / Unit Count is missing', ['unit_count'])] }), 'amzerr') === false && chk(mk('G7'), 'amzerr') === false);
  const noIss = sku => { const x = mk(sku); delete x.iss; delete x.ie; return x; };
  ok('NOT CHECKED: Amazon\'s issues were never read for it', chk(noIss('G8'), 'amzerr') === null);
  ok('an old saved record (only the first error\'s words): about a picture → TRUE; 2 errors, the first not about pictures → NOT CHECKED; 0 errors → FALSE',
    chk(Object.assign(noIss('G9'), { ie: 1, im: 'The main image is missing or incorrect' }), 'amzerr') === true && chk(Object.assign(noIss('G10'), { ie: 2, im: 'Unit count missing' }), 'amzerr') === null
    && chk(Object.assign(noIss('G11'), { ie: 0 }), 'amzerr') === false);
  ok('Amazon\'s message is shown with its code on the row', (() => { const Q = page([mk('G1', { iss: [E(100581, 'The image was rejected', ['main_product_image_locator'])] })]); Q.IM_OPEN.add('PAR'); Q.imListRender(); return /ERROR 100581 on MAIN: The image was rejected/.test(Q.el('imList').innerHTML); })());

  console.log('== Amazon picture error: the real ones from the 14:50 sheet are back — every slot, any attribute Amazon names, slot + message shown ==');
  {
    // Amazon's own messages (the 14:50 sheet). `a`: what Amazon may name on the issue — sometimes NOT the picture slot (that is how
    // the stricter rule lost them), sometimes nothing, sometimes the slot itself. Each must be flagged whichever it is.
    const M100238 = slot => `Your image ${slot} violates Amazon's image standards. Review image requirements mentioned in the 'Product image requirements' help page and upload a new image.`;
    const M100581 = slot => `The ${slot} image you submitted for US/Global has text, logo, graphic and watermark which is not permitted for this product type in US/Global store. As a result, your image(s) will not be considered for display to customers`;
    const REAL = [['RCN72', 100238, M100238('PT08'), 'PT08'], ['RCNB327', 100238, M100238('PT08'), 'PT08'], ['RCNB353', 100238, M100238('PT08'), 'PT08'], ['RCNB41', 100238, M100238('PT08'), 'PT08'],
      ['RCNB302', 100238, M100238('PT08'), 'PT08'], ['RCN521', 100238, M100238('PT08'), 'PT08'], ['R-CC-327', 100238, M100238('PT06'), 'PT06'], ['R-CC-508', 100238, M100238('PT06'), 'PT06'],
      ['R-CC-72', 100238, M100238('PT06'), 'PT06'], ['R-CC-9', 100238, M100238('PT06'), 'PT06'], ['RCST72', 100581, M100581('MAIN'), 'MAIN'], ['RTCR302-110', 100581, M100581('SWCH'), 'SWCH']];
    const NAMES = [['externally_assigned_product_identifier'], [], ['merchant_suggested_asin'], ['item_name']];
    const items = REAL.map(([sku, c, m], i) => mk(sku, { iss: [E(c, m, NAMES[i % NAMES.length])] }));
    const Q = page(items);
    items.forEach(it => { Object.values(it.img).concat(Object.values(it.live)).forEach(u => Q.IMQ.dims.set(Q.imqId(u), [2000, 2000])); });
    ok('all 12 are "Amazon picture error" again — whatever attribute Amazon names on the issue (another one, none, the slot)', items.every(it => Q.imCheck(it, 'amzerr', 'SP') === true),
      items.filter(it => Q.imCheck(it, 'amzerr', 'SP') !== true).map(it => it.sku).join());
    ok('…the stricter rule (aa468db) lost the 10 that name another attribute; the 14:50 rule had them all', items.filter((it, i) => NAMES[i % NAMES.length].length).every(it => Q.imOldCheck(it, 'amzerr', 'SP', new Map()) === true));
    ok('each shows its slot and Amazon\'s message: "ERROR 100238 on PT08: Your image PT08 violates…", "ERROR 100581 on SWCH: The SWCH image…"', REAL.every(([sku, c, m, slot], i) => Q.imPicErrText(items[i].iss[0]) === `ERROR ${c} on ${slot}: ${m}`)
      && Q.imKidChip(items[0]).t === 'Amazon picture error' && /ERROR 100238 on PT08: Your image PT08/.test(Q.imKidChip(items[0]).tip));
    Q.IM_OPEN.add('PAR'); Q.imListRender();
    const html = Q.el('imList').innerHTML;
    ok('…on the row, in full', /ERROR 100238 on PT08: Your image PT08 violates Amazon&#39;s image standards|ERROR 100238 on PT08: Your image PT08 violates Amazon's image standards/.test(html) && /ERROR 100581 on MAIN: The MAIN image you submitted/.test(html));
    const card = Q.imCardsData(Q.IML.SP.items).find(c => c.k === 'amzerr');
    ok('the card counts all 12', card.n === 12, String(card.n));
    const rows = Q.imDlRows(['SP'], '');
    ok('the sheet has all 12 under "Amazon picture error", with the slot in Amazon\'s message', rows.length === 12 && rows.every(r => r.cells[P.IM_DL_COLS.indexOf('Amazon picture error')] === 'Yes')
      && rows.find(r => r.sku === 'RCN521').cells[P.IM_DL_COLS.indexOf("Amazon's picture error message")] === `ERROR 100238 on PT08: ${M100238('PT08')}`, rows.map(r => r.sku).join());
    ok('a picture Amazon rejected is not a real picture: RCN72\'s PT08 (100238) does not count, 9 sent → 8', Q.imPicCount(items[0]).ours === 8);
    ok('the MAIN one (RCST72, 100581 on MAIN) is critical: checked live before the sheet is saved; the PT08 / PT06 / SWCH ones are not', Q.imCritical(items[10], 'SP') === true
      && items.filter((it, i) => i !== 10).every(it => Q.imCritical(it, 'SP') === false));
    ok('counted even when Amazon says "will not lead to ASIN suppression" / "No action is required"', Q.imCheck(mk('NA1', { iss: [E(100238, 'Your image PT03 violates Amazon\'s image standards. This will not lead to ASIN suppression. No action is required.', ['item_name'])] }), 'amzerr', 'SP') === true);
    ok('picture FILE errors too: 20005 "Images couldn\'t be associated with SKU", 300403 "We can\'t access your media…"', Q.imCheck(mk('F20', { iss: [E(20005, 'Images couldn\'t be associated with SKU. To fix this: (1) resolve all other product data errors first', [])] }), 'amzerr', 'SP') === true
      && Q.imCheck(mk('F30', { iss: [E(300403, 'We can\'t access your media at https://www.dropbox.com/x.jpeg due to receiving 403 HTTP status code.', ['other_product_image_locator_2'])] }), 'amzerr', 'SP') === true);
    ok('NOT a picture error: a WARNING about a picture, an ERROR about the unit count or the title', Q.imCheck(mk('W1', { iss: [{ s: 'W', c: '100238', m: M100238('PT02'), a: [] }] }), 'amzerr', 'SP') === false
      && Q.imCheck(mk('U1', { iss: [E(90244, 'The value for Ounce / Unit Count is missing', ['unit_count'])] }), 'amzerr', 'SP') === false
      && Q.imCheck(mk('T1', { iss: [E(8541, 'The title is longer than 200 characters', ['item_name'])] }), 'amzerr', 'SP') === false);
    ok('Search suppressed is untouched by any of them (all 12 buyable and in search → not suppressed)', items.every(it => Q.imCheck(it, 'sup', 'SP') === false));
    // the auto refresh keeps Amazon's ERROR messages whole and up to 12 issues — the list held only 8, cut at 220 letters
    const L = load({ lm: true, ws: true, im: true });
    const long = 'Images couldn\'t be associated with SKU. To fix this: (1) resolve all other product data errors first; (2) ensure SKU exists in catalog; (3) verify image meets all requirements; (4) resubmit product data and images. For more information see the help page on images.';
    const m = { sku: 'Z1', asin: 'B0Z1', iss: Array.from({ length: 10 }, (_, i) => ({ s: 'W', c: String(i), m: 'a warning', a: [] })).concat([{ s: 'E', c: '20005', m: long, a: [] }]), img: {}, va: {}, as: 'BUYABLE,DISCOVERABLE' };
    const item = L.lmImlItem(m, null);
    ok('the list keeps the 11th issue (the picture error after 10 warnings) and Amazon\'s whole message, not the first 220 letters', item.iss.length === 11 && item.iss[10].m === long && long.length > 220, item.iss.length + ' / ' + (item.iss[10] || {}).m);
  }

  console.log('== Search suppressed / Not buyable: THE ONE RULE, unchanged ==');
  {
    const cases = [['BUYABLE', 5], ['BUYABLE,DISCOVERABLE', 5], ['DISCOVERABLE', 5], ['DISCOVERABLE', 0], ['', 5], ['BUYABLE,DISCOVERABLE', 0]];
    const Q = page(cases.map(([st], i) => mk('S' + i, { st })), { qty: Object.fromEntries(cases.map(([, q], i) => ['S' + i, q])) });
    const same = cases.every(([st, qty], i) => {
      const k = Q.lrShopOf({ st, iss: [], qty, brand: 'SP', sku: 'S' + i }).k;      // the rule itself
      return Q.imCheck(mk('S' + i, { st }), 'sup', 'SP') === (k === 'unk' ? null : k === 'sup') && Q.imCheck(mk('S' + i, { st }), 'nobuy', 'SP') === (k === 'unk' ? null : k === 'nobuy');
    });
    ok('for every status the answer is lrShopOf\'s own: Suppressed = buyable but not in search; Not buyable = no BUYABLE with stock', same);
    ok('TRUE: BUYABLE alone → Search suppressed · FALSE: BUYABLE + DISCOVERABLE · NOT CHECKED: no status read', Q.imCheck(mk('S0', { st: 'BUYABLE' }), 'sup', 'SP') === true
      && Q.imCheck(mk('S1'), 'sup', 'SP') === false && Q.imCheck(mk('S4', { st: '' }), 'sup', 'SP') === null);
    ok('TRUE: not buyable with 5 in stock · FALSE: not buyable with no stock (nothing shoppers miss) · NOT CHECKED: no status read', Q.imCheck(mk('S2', { st: 'DISCOVERABLE' }), 'nobuy', 'SP') === true
      && Q.imCheck(mk('S3', { st: 'DISCOVERABLE' }), 'nobuy', 'SP') === false && Q.imCheck(mk('S4', { st: '' }), 'nobuy', 'SP') === null);
    const enforced = mk('S1', { iss: [{ s: 'E', c: '18320', m: 'x', a: [], e: ['SEARCH_SUPPRESSED'] }] });
    ok('an enforcement action SEARCH_SUPPRESSED still means Suppressed (rule b)', Q.imCheck(enforced, 'sup', 'SP') === true);
    ok('the chip and its words are as before: "Search suppressed", red', Q.imKidChip(mk('S0', { st: 'BUYABLE' })).t === 'Search suppressed' && Q.imKidChip(mk('S0', { st: 'BUYABLE' })).cls === 'is-bad');
  }

  console.log('== No swatch: REMOVED — Amazon\'s catalogue returns no swatch, so "Amazon serves none" can never be known ==');
  ok('no "noswatch" check, card, filter option, download column or row words', !('noswatch' in P.IM_CHECKS) && P.imCheck(mk('W1'), 'noswatch', 'SP') === null && !P.IM_CARDS.some(c => c.k === 'noswatch')
    && !/value="noswatch"|No swatch/.test(SRC('index.html')) && !P.IM_DL_COLS.includes('No swatch') && !/swatch/i.test(P.imKidSummary(mk('W1'))));
  ok('a listing with no swatch anywhere has no problem for it: no chip, not in "need pictures", not in the sheet', P.imKidChip(mk('W1')).t === 'Buyable' && P.imNeeds(mk('W1')) === false && P.imProblems(mk('W1'), 'SP').length === 0);
  ok('the swatch is never counted: not in "Fewer than 7" (6 + swatch = 6), not in "Live image differs" (a different swatch is not a difference)',
    P.imPicCount(mk('W5', { img: Object.assign(full('W5', 6), { SWCH: A('W5SW') }), live: full('W5', 6) })).n === 6
    && chk(mk('W6', { img: Object.assign(full('W6'), { SWCH: A('oursw') }), live: Object.assign(full('W6'), { SWCH: A('theirsw') }) }), 'diff') === false);

  {
    // the editor's "Live on Amazon now": Amazon's catalogue returns no swatch — ours is shown "from your listing", none of ours: no tile
    const Q = page([]);
    const liveRow = () => { const h = Q.el('imBody').innerHTML; const part = h.split('Live on Amazon now')[1] || ''; return part.split('Your stack')[0]; };
    const cat = Object.fromEntries(SLOTS.map(sl => [sl, { link: A('E1' + sl), w: 2000, h: 2000 }]));
    Q.setIM({ brand: 'SP', sku: 'E1', asin: 'B0E1', listing: Object.assign(full('E1'), { SWCH: A('E1SW') }), catalog: cat, issues: [] }, {}, {});
    try { Q.imRender(); } catch (e) { /* the stub page has no layout: only the HTML matters */ }
    const withOurs = liveRow();
    ok('editor, "Live on Amazon now": our swatch is shown, marked "from your listing" — never "Swatch: empty"', /data-slot="SWCH"[\s\S]*?E1SW[\s\S]*?>Swatch<\/div>\s*<div class="muted"[^>]*>from your listing</.test(withOurs) && !/data-slot="SWCH"[\s\S]*?>empty</.test(withOurs), withOurs.slice(-600));
    Q.setIM({ brand: 'SP', sku: 'E2', asin: 'B0E2', listing: full('E2'), catalog: cat, issues: [] }, {}, {});
    try { Q.imRender(); } catch (e) { /* as above */ }
    ok('…no swatch of ours: no swatch tile there at all', !/data-slot="SWCH"/.test(liveRow()) && /data-slot="PT08"/.test(liveRow()));
    const swTile = Q.imTile('SWCH', '', A('x'), true, 'E1');
    ok('the row\'s swatch tile says "from your listing", never "not live yet"', /Swatch — from your listing \(Amazon(&#39;|')s catalogue does not return swatches\)/.test(swTile) && !/not live yet/.test(swTile), swTile.slice(0, 300));
  }

  console.log('== Live image differs from yours: by the picture, not by its link ==');
  ok('TRUE: Amazon serves another picture in a slot we sent', chk(mk('V1', { live: Object.assign(full('V1'), { PT02: A('someoneElse') }) }), 'diff') === true);
  ok('FALSE: identical · FALSE: the SAME picture at another size ("…._SL1500_.jpg") — before this, it was flagged', chk(mk('V2'), 'diff') === false
    && chk(mk('V3', { live: Object.assign(full('V3'), { MAIN: A('V3MAIN._SL1500_') }) }), 'diff') === false && P.imOldCheck(mk('V3', { live: Object.assign(full('V3'), { MAIN: A('V3MAIN._SL1500_') }) }), 'diff', 'SP', new Map()) === true);
  ok('NOT CHECKED: our picture is not on Amazon\'s servers (our own link) — it cannot be compared', chk(mk('V4', { img: Object.assign(full('V4'), { MAIN: 'https://cdn.example.com/v4-main.jpg' }) }), 'diff') === null);
  ok('NOT CHECKED: the catalogue did not answer', chk(mk('V5', { live: {}, liveErr: 'catalogue 429' }), 'diff') === null);
  const bf = (l, m) => { const x = P.imBfOf(l, m); return x.b + x.f + (x.differs ? '!' : ''); };
  ok('the tiles\' B / F follow: same picture at another size is green (gg), another picture red (gr), ours not comparable "not live yet" (gu)',
    bf(A('p._SL1500_'), A('p')) === 'gg' && bf(A('q'), A('p')) === 'gr!' && bf(A('q'), 'https://cdn.example.com/p.jpg') === 'gu!');

  console.log('== missing data is "not checked" on the screen, never a problem ==');
  {
    const items = [mk('N1', { img: without(full('N1'), 'MAIN'), live: {}, liveErr: 'catalogue 429' }), mk('N2', { img: Object.assign(full('N2'), { SWCH: A('N2SW') }) })];
    const Q = page(items);
    items.forEach(i => SLOTS.forEach(s => { if (i.img[s]) Q.IMQ.dims.set(Q.imqId(i.img[s]), [2400, 2400]); }));
    const cards = Object.fromEntries(Q.imCardsData(Q.IML.SP.items).map(c => [c.k, c]));
    ok('N1 (no MAIN of ours, the catalogue did not answer): in NO card\'s number — "1 not checked" in No main at all, Main not OK',
      ['nomain', 'pcbad'].every(k => cards[k].n === 0 && cards[k].u === 1 && /1 not checked/.test(cards[k].note)) && Object.values(cards).every(c => c.n === 0), JSON.stringify(Object.values(cards).map(c => [c.k, c.n, c.u])));
    ok('…what CAN be decided is: its 8 pictures of ours are enough for "Fewer than 7" (not flagged, not "not checked"); Amazon reports no picture error', cards.few.u === 0 && cards.amzerr.u === 0 && cards.sup.u === 0);
    ok('…before the accuracy pass the same listing was counted under "No main at all" (and "No swatch")', Q.imOldCheck(items[0], 'nomain', 'SP', new Map()) && Q.imOldCheck(items[0], 'noswatch', 'SP', new Map()));
    Q.IM_OPEN.add('PAR'); Q.imListRender();
    const html = Q.el('imList').innerHTML;
    ok('its row says it quietly: "not checked: main, Main not OK"', /class="im-nc"[^>]*>not checked: main, Main not OK</.test(html), (html.match(/not checked:[^<]*/) || [''])[0]);
    ok('…the chip of N1 is its Amazon status ("Buyable"), not "No main at all"', Q.imKidChip(items[0]).t === 'Buyable');
    ok('a filter shows only the listings it is really true for: "No main at all" shows nothing here', (() => { Q.el('imFilter').value = 'nomain'; Q.imListRender(); const n = (Q.el('imList').innerHTML.match(/class="im-kid[" ]/g) || []).length; Q.el('imFilter').value = 'all'; return n === 0; })());
    ok('"N need pictures" on the family counts real problems only: N1 is not one', Q.imNeeds(items[0]) === false);
  }

  console.log('== "Shows another SKU\'s pictures", "No swatch" and "Too small" are gone everywhere ==');
  {
    const im = SRC('app/listing/image-manager.js');
    const code = im.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok('no card, no filter, no chip, no editor line: the code has no imHijack / IM_OWNER / imOwnerBuild', !/imHijack|IM_OWNER|imOwnerBuild|hjThis/.test(code));
    ok('IM_CARDS, the picker (index.html) and the download columns do not name it', !P.IM_CARDS.some(c => c.k === 'other' || /another/i.test(c.t)) && !/value="other"|another/i.test((SRC('index.html').match(/<select id="imFilter"[\s\S]*?<\/select>/) || ['x another'])[0]) && !/another SKU/i.test(SRC('index.html'))
      && !P.IM_DL_COLS.some(c => /another/i.test(c)) && !P.IM_DL_CHECKS.some(c => c.k === 'other'));
    ok('the only place their words remain is the console report\'s "old count → removed" lines', (code.match(/another SKU/gi) || []).length === 1 && /check: "Shows another SKU's pictures"[^\n]*now: 'removed'/.test(code)
      && (code.match(/'No swatch'/g) || []).length === 1 && /check: 'No swatch'[^\n]*now: 'removed'/.test(code)
      && (code.match(/Too small/g) || []).length === 1 && /check: 'Too small \(under 2000\)'[^\n]*now: 'removed'/.test(code));
    const k4 = mk('K4', { live: Object.assign(full('K4'), { MAIN: A('K1MAIN') }) });
    const Q = page([mk('K1'), k4]);
    Q.IM_OPEN.add('PAR'); Q.imListRender();
    ok('a listing Amazon shows another of our pictures on: its chip is its status ("Buyable"), the list and cards never say "another SKU"', Q.imKidChip(k4).t === 'Buyable' && !/another SKU|Shows K1/i.test(Q.el('imList').innerHTML));
    ok('every other check is still there, by its name', ['No main at all', 'Main not OK', 'Fewer than 7 pictures', 'Amazon picture error', 'Search suppressed', 'Not buyable', 'Live image differs from yours']
      .every(name => Object.values(P.IM_CHECKS).includes(name)) && Object.keys(P.IM_CHECKS).length === 7
      && ['nomain', 'pcbad', 'diff', 'sup', 'amzerr', 'few', 'nobuy'].every(k => new RegExp(`<option value="${k}">`).test((SRC('index.html').match(/<select id="imFilter"[\s\S]*?<\/select>/) || [''])[0])));
    ok('the cards keep their names and colours', JSON.stringify(P.IM_CARDS.map(c => [c.k, c.t, c.cls])) === JSON.stringify([['nomain', 'No main at all', 'is-err'],
      ['pcbad', 'Main not OK', 'is-err'], ['few', 'Fewer than 7', 'is-att'], ['amzerr', 'Amazon picture error', 'is-err'], ['sup', 'Search suppressed', 'is-err']]));
  }

  console.log('== sizes are measured on the picture\'s own file; a failed catalogue read is never "Amazon serves nothing" ==');
  ok('imqBase: "71abc._SL1500_.jpg" → "71abc.jpg" (the full-size file); a plain link and a foreign link stay as they are', P.imqBase(A('71abc._SL1500_')) === A('71abc') && P.imqBase(A('71abc._AC_SX679_')) === A('71abc')
    && P.imqBase(A('71abc')) === A('71abc') && P.imqBase('https://cdn.example.com/a.b.jpg') === 'https://cdn.example.com/a.b.jpg');
  {
    const L = load({ lm: true, ws: true });
    L.lmNoteLive('SP', 'X1', 'limg', { listing: { MAIN: A('x1') }, catalog: {}, catalogError: 'Catalogue: 429 throttled' });
    L.lmNoteLive('SP', 'X2', 'limg', { listing: { MAIN: A('x2') }, catalog: { MAIN: { link: A('x2'), w: 2000, h: 2000 } }, catalogError: '' });
    ok('a live read whose catalogue call failed keeps no "empty catalogue" (it would have read as "Amazon serves no picture")', L.LM.over.SP.get('X1').i.catImg === null && L.LM.over.SP.get('X1').i.img.MAIN === A('x1'));
    ok('…a read whose catalogue answered keeps what it serves, with sizes', L.LM.over.SP.get('X2').i.catImg.MAIN.w === 2000);
  }

  console.log('== PROOF in the console: imgAccuracyReport() and imgCounts() against a stub Amazon ==');
  {
    // what Amazon answers NOW, per SKU: by default exactly what the list holds; AMZ changes a listing (it was fixed since the last refresh)
    let P2;
    const AMZ = {};
    const calls = [];
    const now = sku => AMZ[sku] || P2.IML.SP.items.concat(P2.IML.CPC.items).find(i => i.sku === sku);
    const baCall = async q => {
      calls.push(q);
      const it = now(q.sku);
      if (!it || it.fail) throw new Error('Amazon throttled the request');
      const issues = (it.iss || []).map(i => ({ severity: i.s === 'E' ? 'ERROR' : 'WARNING', code: i.c, message: i.m, attrs: i.a || [], acts: i.e || [] }));
      if (q.lfix === 'get') return { ok: true, sku: q.sku, status: String(it.st || '').split(',').filter(Boolean), issues, attributes: {} };
      if (q.limg === 'get') return { ok: true, sku: q.sku, asin: it.asin, status: String(it.st || '').split(',').filter(Boolean), listing: Object.fromEntries(Object.entries(it.img || {}).filter(([, u]) => u)),
        catalog: it.liveErr ? {} : Object.fromEntries(Object.entries(it.live || {}).filter(([, u]) => u).map(([s, u]) => [s, { link: u, w: (P2.IMQ.dims.get(P2.imqId(u)) || [0, 0])[0], h: (P2.IMQ.dims.get(P2.imqId(u)) || [0, 0])[1] }])),
        catalogError: it.liveErr || '', issues: issues.map(i => ({ severity: i.severity, code: i.code, message: i.message, attrs: i.attrs })) };
      return {};
    };
    const items = [mk('R1', { img: full('R1', 5), live: full('R1', 5) }),                                  // Fewer than 7
      mk('R2', { st: 'BUYABLE' }),                                                                       // Search suppressed
      mk('R3', { iss: [E(18320, 'The main image is missing or incorrect', ['main_product_image_locator'])], img: without(full('R3'), 'MAIN') }),   // Amazon picture error, family's main
      mk('R4', { img: Object.assign(full('R4'), { SWCH: A('R4SW') }) })];                                // nothing
    P2 = page(items, { load: { baCall }, cpc: [mk('Q1', { img: without(full('Q1'), 'MAIN'), live: without(full('Q1'), 'MAIN'), psku: '', pa: '' })] });
    // since the last refresh: R2 is back in search; R3's error is gone; R1 cannot be read
    AMZ.R2 = mk('R2', { st: 'BUYABLE,DISCOVERABLE' });
    AMZ.R3 = mk('R3', { iss: [], img: without(full('R3'), 'MAIN') });
    AMZ.R1 = { fail: true };
    const quiet = console.log, quietT = console.table;
    console.log = () => {}; console.table = () => {};
    let rep, counts;
    try { rep = await P2.imgAccuracyReport(10); counts = await P2.imgCounts(); } finally { console.log = quiet; console.table = quietT; }
    const row = (sku, check) => rep.rows.find(r => r.sku === sku && r.check === check) || {};
    ok('each flagged listing is read live once (?limg=get and ?lfix=get), whatever the number of checks it is under', ['R1', 'R2', 'R3', 'Q1'].every(sku => calls.filter(c => c.sku === sku && c.limg === 'get').length === (sku === 'R1' ? 2 : 1))
      && !calls.some(c => c.sku === 'R4'), calls.map(c => c.sku + ':' + (c.limg ? 'limg' : 'lfix')).join(' '));
    ok('MATCH: Q1 (CPC) "No main at all" — Amazon still serves no main; the row says what Sellora said and what Amazon has now',
      row('Q1', 'No main at all').result === 'MATCH' && row('Q1', 'No main at all').brand === 'CPC' && /^YES — our main: no · Amazon serves a main: no$/.test(row('Q1', 'No main at all').sellora) && /^YES — /.test(row('Q1', 'No main at all').amazonNow), JSON.stringify(row('Q1', 'No main at all')));
    ok('DIFFERENT: R2 "Search suppressed" — Amazon now has it in search', row('R2', 'Search suppressed').result === 'DIFFERENT' && /^NO — status BUYABLE,DISCOVERABLE/.test(row('R2', 'Search suppressed').amazonNow), JSON.stringify(row('R2', 'Search suppressed')));
    ok('DIFFERENT: R3 "Amazon picture error" — the error is gone (and no "Using the family\'s main" row: that check is gone)', row('R3', 'Amazon picture error').result === 'DIFFERENT' && /no picture error/.test(row('R3', 'Amazon picture error').amazonNow) && !rep.rows.some(r => r.check === "Using the family's main"));
    ok('NOT READ: R1 — Amazon could not be read (after a second try): never called a match', row('R1', 'Fewer than 7 pictures').result === 'NOT READ' && /could not be read: Amazon throttled/.test(row('R1', 'Fewer than 7 pictures').amazonNow));
    ok('the summary counts per check, and `different` lists what to look at', rep.summary.find(s => s.check === 'Search suppressed').different === 1 && !rep.summary.some(s => s.check === "Using the family's main") && !rep.summary.some(s => s.check === 'No swatch')
      && rep.different.map(r => r.sku + ':' + r.check).sort().join() === 'R2:Search suppressed,R3:Amazon picture error', JSON.stringify(rep.summary));
    ok('…and the screen follows what Amazon said: R2 is no longer under "Search suppressed", R3 no longer under "Amazon picture error"',
      P2.imCheck(P2.IML.SP.items.find(i => i.sku === 'R2'), 'sup', 'SP') === false && P2.imCheck(P2.IML.SP.items.find(i => i.sku === 'R3'), 'amzerr', 'SP') === false);
    const c = (brand, check) => counts.find(r => r.brand === brand && r.check === check) || {};
    ok('imgCounts: per brand and check, the old count → the count now and the not-checked; the removed check says "removed"',
      c('CPC', 'No main at all').now === 1 && c('Ridhi', 'No swatch').old === 3 && c('Ridhi', 'No swatch').now === 'removed' && c('Ridhi', "Shows another SKU's pictures").now === 'removed' && c('Ridhi', 'Too small (under 2000)').now === 'removed', JSON.stringify(counts.filter(r => r.brand === 'Ridhi').map(r => [r.check, r.old, r.now, r.notChecked])));
    // one check, named listings: Amazon NOW reports a picture error on R4 that the list does not hold — Sellora missed it: DIFFERENT
    AMZ.R4 = mk('R4', { img: Object.assign(full('R4'), { SWCH: A('R4SW') }), iss: [E(100238, "Your image PT08 violates Amazon's image standards.", ['externally_assigned_product_identifier'])] });
    calls.length = 0;
    console.log = () => {}; console.table = () => {};
    let one;
    try { one = await P2.imgAccuracyReport({ check: 'amzerr', skus: ['R4', 'R3', 'NOPE-1'] }); } finally { console.log = quiet; console.table = quietT; }
    const r4 = one.rows.find(r => r.sku === 'R4') || {}, r3 = one.rows.find(r => r.sku === 'R3') || {};
    ok('imgAccuracyReport({ check: \'amzerr\', skus }): only that check, only those listings, flagged or not', one.rows.length === 2 && one.rows.every(r => r.check === 'Amazon picture error')
      && one.summary.length === 1 && one.missing.join() === 'NOPE-1' && calls.filter(c => c.limg === 'get').map(c => c.sku).sort().join() === 'R3,R4', JSON.stringify(one.rows.map(r => [r.sku, r.result])));
    ok('…an error Sellora MISSED is DIFFERENT: R4 "NO" in Sellora, "YES — ERROR 100238 on PT08…" on Amazon now', r4.result === 'DIFFERENT' && /^NO — no picture error/.test(r4.sellora) && /^YES — ERROR 100238 on PT08: Your image PT08/.test(r4.amazonNow), JSON.stringify(r4));
    ok('…no error on either side is a MATCH (R3, fixed since the refresh, already read)', r3.result === 'MATCH' && /^NO — /.test(r3.sellora) && /^NO — /.test(r3.amazonNow), JSON.stringify(r3));
    ok('…and the screen follows: R4 now shows its Amazon picture error', P2.imCheck(P2.IML.SP.items.find(i => i.sku === 'R4'), 'amzerr', 'SP') === true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
