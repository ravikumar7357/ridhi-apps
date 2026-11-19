/* THE ONE SUGGESTION-WORDS RULE (19 Nov 2026): listing-rules.js lrSuggestWords decides which words every suggestion keeps, removes or
 * adds — Fix all search terms (kw-fix.js), Fix all titles (title-fix.js), the title template suggestion (lrSuggest), Fix all's short
 * title (fix-all.js), Listing Content's 75 cut and search-terms suggestion (listing-content.js), the Listing Optimiser's suggested title
 * (listing-optimiser.js, filtered in the browser) and the Season planner's trim (season-planner.js spTrim).
 *   node tests/suggestion-words-test.js
 * RULE 1 protected words never go the first time they appear; RULE 2 what may go, in order, stopping once it fits; RULE 3 titles keep
 * "Hand Block Print", product, shape, material and colour in the template's order. The two real cases (RTC-627-5454, RT146-70118) and
 * the small rules one by one. With git, the code of HEAD's parent is run on the same cases too and its answers printed (before / after). */
const cp = require('child_process'), fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const has = (text, w) => new RegExp('(^|[^a-z0-9])' + w.toLowerCase().replace(/\s+/g, '\\s+') + '(?=$|[^a-z0-9])').test(String(text).toLowerCase());
const count = (text, w) => (String(text).toLowerCase().match(new RegExp('(^|[^a-z0-9])' + w + '(?=$|[^a-z0-9])', 'g')) || []).length;

// The two real listings, as the catalogue and Amazon hold them
const REAL = {
  'RTC-627-5454': { cat: { subcat: 'Square Tablecloth', color: 'Harbor Blue', size: '54x54' }, va: { color: 'Harbor Blue', size: '54 x 54 Inch', material: 'Cotton', item_shape: 'Square' },
    title: 'Ridhi Harbor Blue Hand Block Print Square Tablecloth 54×54 Inch' },
  'RT146-70118': { cat: { subcat: 'Rectangle Tablecloth', color: 'Turquoise Moss Green', size: '70x118' }, va: { color: 'Turquoise Moss Green', size: '70 x 118 Inch', material: 'Cotton', item_shape: 'Rectangle' },
    title: 'Ridhi Tablecloth Rectangle 100% Cotton 70 x 118 Inch Hand Block Print - Turquoise Moss Green' },
};
// RT146-70118's search terms (over 249): its important words, a wrong shape (square), colours that are not its colour (pink, blue),
// repeats (tablecloth, green, hand, square, indian), low-value words (indian, colorful, gift) and ordinary words
const KW146 = 'hand block print tablecloth rectangle turquoise moss green cotton 70 x 118 inch kitchen dining table cover tablecloth for farmhouse party wedding '
  + 'green square pink blue indian colorful gift hand rustic boho floral printed cloth large long banquet buffet picnic holiday outdoor restaurant hotel event '
  + 'linen rectangular dinner home decor indian handmade washable reusable wrinkle free everyday housewarming square xmas brunch tea';

function page(files) {
  const C = load({ ws: true, sp: true, fa: true, lo: true, files, ctx: { leOnly() {}, leShow() {}, leListEnsure() {}, imOnly() {}, imListRender() {} } });
  if (C.setHealthLoaded) C.setHealthLoaded(true);
  const now = Date.now();
  const cat = {};
  Object.entries(REAL).forEach(([sku, r]) => {
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'P-' + sku, sku, asin: 'B0' + sku.replace(/\W/g, '').slice(0, 8), title: r.title, qty: 5, price: 40, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now,
      checked: now, content: { titleLen: r.title.length, images: 8, bullets: 5, descLen: 300, title: r.title } });
    cat[sku] = r.cat;
  });
  C.setCat('SP', cat);
  C.reset();
  return C;
}
const rowOf = (C, sku) => C.HEALTH.SP.rows.find(r => r.sku === sku);
const factsOf = (C, sku) => C.lrSwFacts({ brand: 'SP', sku }, null, REAL[sku].va, { title: REAL[sku].title, pt: 'TABLECLOTH' });

// the code before this change (HEAD's parent of this commit, or HEAD while it is not committed yet), when git can show it
function oldFiles() {
  const root = path.join(__dirname, '..', '..');
  const rev = (() => { try { const log = cp.execSync('git log -1 --format=%s', { cwd: root }).toString(); return /suggestion words/i.test(log) ? 'HEAD~1' : 'HEAD'; } catch (e) { return ''; } })();
  if (!rev) return null;
  const out = {};
  try {
    fs.readdirSync(path.join(__dirname, '..', 'src', 'app', 'listing')).filter(f => f.endsWith('.js')).forEach(f => {
      try { out[f] = cp.execSync(`git show ${rev}:Pricing-App/src/app/listing/${f}`, { cwd: root, maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { out[f] = ''; }
    });
  } catch (e) { return null; }
  return out['listing-rules.js'] ? { rev, files: out } : null;
}

(async () => {
  const C = page();
  console.log('== the small rules, one by one ==');
  {
    const blue = { colour: 'Light Blue', shape: 'square', material: '100% Cotton', size: '18x18', product: ['Cloth Napkins', 'napkin'] };
    const fitsAt = n => text => C.lrKwBytes(text) <= n;
    const r1 = C.lrSuggestWords('napkin cotton blue dinner dinner party party wedding', { mode: 'kw', facts: blue, fits: fitsAt(37) });
    ok('repeats go first — and only them when that is enough (the second "dinner", the second "party")', r1.fits && r1.after === 'napkin cotton blue dinner party wedding' && r1.removed.every(x => x.why === 'repeated'), JSON.stringify([r1.after, r1.removed]));
    const r2 = C.lrSuggestWords('hand block print napkin cotton kitchen hand block print', { mode: 'kw', facts: blue, fits: fitsAt(33) });
    ok('a protected word said again: only its 2nd time goes (hand, block, print — the first stay)', r2.fits && r2.after === 'hand block print napkin cotton kitchen' && r2.removed.map(x => x.w).join(' ') === 'hand block print', JSON.stringify([r2.after, r2.removed]));
    const r3 = C.lrSuggestWords('light blue cotton napkin pink red green blue', { mode: 'kw', facts: blue, fits: fitsAt(21) });
    ok('the product\'s own colour stays (Light Blue — both words); colours that are not its colour go (pink, red, green; the 2nd "blue" as a repeat)', r3.fits && r3.after === 'light blue cotton napkin' && ['pink', 'red', 'green'].every(w => r3.removed.some(x => x.w === w && x.why === 'not its colour')), JSON.stringify([r3.after, r3.removed]));
    const r4 = C.lrSuggestWords('square napkin round oval rectangle cotton', { mode: 'kw', facts: blue, fits: fitsAt(19) });
    ok('a shape that is not the product\'s goes (round, oval, rectangle on a square napkin); its own shape stays', r4.fits && r4.after === 'square napkin cotton' && r4.removed.every(x => x.why === 'wrong shape'), JSON.stringify([r4.after, r4.removed]));
    const r5 = C.lrSuggestWords('light blue napkin light weight cotton', { mode: 'kw', facts: blue, fits: fitsAt(27) });
    const navy = Object.assign({}, blue, { colour: 'Navy' });
    const r6 = C.lrSuggestWords('navy napkin light cotton dinner', { mode: 'kw', facts: navy, fits: fitsAt(22) });
    ok('"light" is kept in "Light Blue" (its colour) — said again it goes; on a Navy napkin "light" is a filler and goes', r5.fits && /^light blue napkin/.test(r5.after) && count(r5.after, 'light') === 1
      && r6.fits && !has(r6.after, 'light') && r6.removed.some(x => x.w === 'light' && x.why === 'low-value word'), JSON.stringify([r5.after, r6.after, r6.removed]));
    const r7 = C.lrSuggestWords('napkin cute gift indian colorful neutral decorative cotton tea', { mode: 'kw', facts: blue, fits: fitsAt(15) });
    ok('low-value words go before other words (cute, gift, indian, colorful, neutral, decorative — "tea" stays)', r7.fits && r7.after === 'napkin cotton tea' && r7.removed.every(x => x.why === 'low-value word'), JSON.stringify([r7.after, r7.removed]));
    const r8 = C.lrSuggestWords('hand block print napkin cotton light blue 18 x 18 inch kitchen dining reusable', { mode: 'kw', facts: blue, fits: fitsAt(30) });
    ok('only important words left and still over: nothing is cut, "important" says so', !r8.fits && r8.important && !r8.removed.length && r8.after === 'hand block print napkin cotton light blue 18 x 18 inch kitchen dining reusable', JSON.stringify([r8.after, r8.removed]));
    const kp = C.kfPlan({ key: 'SP|X', brand: 'SP', sku: 'X', kw: 'hand block print napkin cotton light blue kitchen dining reusable washable housewarming everyday ' + Array.from({ length: 20 }, (_, i) => `${10 + i}x${10 + i}`).join(' ') + ' ' + Array.from({ length: 20 }, (_, i) => `${40 + i}x${40 + i}`).join(' '),
      full: true, pt: 'NAPKIN', title: 'Ridhi Cloth Napkins', brands: ['ridhi'], facts: blue });
    ok('…and on the row: "Only important words left — edit by hand"', !kp.ok && kp.why === 'Only important words left — edit by hand', kp.why);
    const r9 = C.lrSuggestWords('napkin cotton pottery barn style organic kitchen', { mode: 'kw', facts: blue, fits: fitsAt(99), risk: t => [{ s: t.indexOf('pottery'), e: t.indexOf('style') + 5, why: "risky: another brand's name" }, { s: t.indexOf('organic'), e: t.indexOf('organic') + 7, why: 'risky: restricted claim' }] });
    ok('other brands\' names and restricted claims always go (quietly — the IP & Trademark Guard says so on its own page)', r9.after === 'napkin cotton kitchen' && r9.risky === 4, JSON.stringify([r9.after, r9.removed]));
    const t1 = C.lrSuggestWords('Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print Decorative Table Cover for Dining Kitchen Farmhouse Party Home - Mustard',
      { mode: 'title', facts: { colour: 'Mustard', shape: 'rectangle', material: '100% Cotton', size: '60x90', product: ['Tablecloth'], brands: ['ridhi'] }, fits: t => t.length <= 75 });
    ok('a title: the template order stays, "Hand Block Print" stays whole, brand, product, shape, material, size and colour stay; fillers and uses go', t1.after === 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Mustard' && t1.important, JSON.stringify([t1.after, t1.removed.map(x => x.w + ':' + x.why)]));
    ok('the shape is worked out from the size: 118 x 70 = rectangle, 54 x 54 = square; a round one says so', C.lrSwShapeOf('118x70', 'Square') === 'rectangle' && C.lrSwShapeOf('54 x 54 Inch', '') === 'square' && C.lrSwShapeOf('70', 'Round') === 'round' && C.lrSwShapeOf('70x70', 'Round Tablecloth') === 'round');
  }

  console.log('== RTC-627-5454 (Harbor Blue, 54 x 54) — Fix all titles and the Season planner ==');
  const rtc = C.ttBuild('SP', rowOf(C, 'RTC-627-5454'), C.hCtx(), { va: REAL['RTC-627-5454'].va, pt: 'TABLECLOTH', src: 'Amazon (read now)' });
  ok('the suggested title keeps "Hand Block Print", "Square", "Harbor Blue", "Tablecloth" (and brand, cotton, the size)', ['Hand Block Print', 'Square', 'Harbor Blue', 'Tablecloth', 'Ridhi', '100% Cotton', '54 x 54 Inch'].every(w => rtc.after.includes(w)), rtc.after);
  ok('…in the template\'s order, the uses words gone to fit; still over 75 with only important words → held back, "Only important words left — edit by hand"',
    rtc.after === 'Ridhi Tablecloth Square 100% Cotton 54 x 54 Inch Hand Block Print - Harbor Blue' && /^Only important words left — edit by hand \(79 characters, over 75\)$/.test(rtc.why || ''), rtc.after + ' · ' + rtc.why);
  // the Season planner's trim (Item Highlights — the season words go in front; the customer's own words make room)
  const item = { brand: 'SP', sku: 'RTC-627-5454', row: rowOf(C, 'RTC-627-5454'), title: REAL['RTC-627-5454'].title, pt: 'TABLECLOTH', active: [{ ev: { id: 'xmas', name: 'Christmas', words: 'Christmas, Xmas' } }] };
  const HL146 = 'Hand Block Print Harbor Blue Square Tablecloth 54x54 Inch, Cotton Table Cover, Colorful Indian Gift for Kitchen Dining, Cute Decorative Square Table Cloth';
  const fitsHl = text => ('Christmas table decor, ' + text).length <= 125;
  const sp = C.spTrim(item, HL146, fitsHl, 'hl');
  ok('Season planner (RTC-627-5454): its seasonal Item Highlights keep Hand Block Print, Square, Harbor Blue, Tablecloth, cotton, the size, kitchen, dining', !!sp && ['Hand Block Print', 'Harbor Blue', 'Square', 'Tablecloth', 'Cotton', '54x54', 'Kitchen', 'Dining'].every(w => sp.text.includes(w)) && fitsHl(sp.text), sp && sp.text);
  ok('…repeats and low-value words go first (the 2nd "Square", "Table"; Colorful, Indian, Gift, Cute, Decorative)', !!sp && ['Colorful', 'Indian', 'Gift', 'Cute', 'Decorative'].every(w => sp.removed.includes(w)) && count(sp.text, 'square') === 1, sp && JSON.stringify(sp.removed));
  const spFull = C.spTrim(item, 'Hand Block Print Harbor Blue Square Tablecloth 54x54 Inch Cotton Kitchen Dining Washable Reusable Housewarming Wrinkle Free Everyday', t => t.length <= 60, 'hl');
  ok('…only important words and no room: nothing is trimmed (the planner says "nothing safe to remove")', spFull === null, JSON.stringify(spFull));

  console.log('== RT146-70118 (Turquoise Moss Green, 118 x 70) — Fix all search terms ==');
  const f146 = factsOf(C, 'RT146-70118');
  ok('its facts: shape rectangle (from 118 x 70), colour Turquoise Moss Green, material Cotton, product tablecloth', f146.shape === 'rectangle' && f146.colour === 'Turquoise Moss Green' && f146.material === 'Cotton' && f146.product.some(p => /tablecloth/i.test(p)), JSON.stringify(f146));
  const s146 = C.kfShorten(KW146, { title: REAL['RT146-70118'].title, brands: ['ridhi'], facts: f146 });
  ok(`over the limit before (${C.lrKwBytes(KW146)} bytes), ≤ 249 after (${s146.bytesAfter})`, s146.over && s146.fits && s146.bytesAfter <= 249, s146.bytesAfter);
  ok('KEEPS hand, block print, tablecloth, rectangle, green (its first time), turquoise, moss, cotton, the size', ['hand', 'block print', 'tablecloth', 'rectangle', 'green', 'turquoise', 'moss', 'cotton', '70', '118'].every(w => has(s146.after, w))
    && count(s146.after, 'green') === 1 && count(s146.after, 'tablecloth') === 1 && count(s146.after, 'hand') === 1, s146.after);
  ok('REMOVES "square" (wrong shape), "pink" and "blue" (not its colour), the repeats, "indian", "colorful", "gift"', ['square', 'pink', 'blue', 'indian', 'colorful', 'gift'].every(w => !has(s146.after, w)), s146.after);
  const first = ['repeated', 'wrong shape', 'not its colour', 'low-value word', 'stop word'];
  const order = s146.removed.slice().sort((a, b) => a.n - b.n);
  const lastFirst = Math.max(...order.map((x, i) => (first.includes(x.why) ? i : -1)));
  const firstOther = order.findIndex(x => !first.includes(x.why));
  ok('…and they go FIRST: every repeat, wrong shape, wrong colour and low-value word before any other word', firstOther === -1 || lastFirst < firstOther, order.map(x => x.w + ':' + x.why).join(', '));
  ok('…its important words are never among the removed (first time): hand, block, print, tablecloth, rectangle, green, cotton, kitchen, dining, washable, reusable, housewarming',
    ['hand', 'block', 'print', 'tablecloth', 'rectangle', 'green', 'cotton', 'kitchen', 'dining', 'washable', 'reusable', 'housewarming'].every(w => has(s146.after, w)), s146.after);

  console.log('== every place uses the ONE rule ==');
  const L = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
  const users = { 'kw-fix.js': 'Fix all search terms', 'title-fix.js': 'Fix all titles', 'fix-all.js': 'Fix all short title', 'listing-content.js': 'Listing Content (75 cut, search terms)', 'listing-optimiser.js': 'Listing Optimiser', 'season-planner.js': 'Season planner' };
  Object.entries(users).forEach(([f, what]) => ok(`${what} (${f}) calls lrSuggestWords`, /lrSuggestWords\(/.test(L(f))));
  ok('the title template suggestion (lrSuggest, listing-rules.js) too, and the rule is defined once, in listing-rules.js', /function lrSuggest\(row, cfg, today\)[\s\S]{0,900}lrSuggestWords\(/.test(L('listing-rules.js'))
    && fs.readdirSync(path.join(__dirname, '..', 'src', 'app', 'listing')).filter(f => /function lrSuggestWords\(/.test(L(f))).join() === 'listing-rules.js');
  ok('no screen keeps its own word list any more (kfShorten\'s steps, spTrim\'s keep words, the Hand → Block Print cut)', !/step 5 still over|SP_TRIM_FILL|spKeepWords|'~pattern'/.test(L('kw-fix.js') + L('season-planner.js') + L('title-fix.js')));
  // Listing Optimiser: the backend's suggestion, filtered in the browser
  const lo = (suggested, current) => C.loKeepWords({ suggestion: { ok: true, current, suggested, curLen: current.length, newLen: suggested.length, cap: 75, why: [] } }, 'SP', 'B0RTC6275', 'RTC-627-5454').suggestion;
  const cur = 'Ridhi Harbor Blue Hand Block Print Square Tablecloth 54×54 Inch for Kitchen Dining Cute Gift Indian Decorative Table Cover';
  const dropHand = lo('Ridhi Block Print Tablecloth 54×54 Inch Kitchen Dining Table Cover', cur);
  ok('Listing Optimiser: a backend suggestion that drops "Hand", "Square" or the colour is replaced by the one rule\'s (the current title, shortened)', ['Hand Block Print', 'Square', 'Harbor Blue', 'Tablecloth'].every(w => dropHand.suggested.includes(w))
    && dropHand.suggested.length <= 75 && dropHand.newLen === dropHand.suggested.length && !/Cute|Gift|Indian|Decorative/.test(dropHand.suggested), dropHand.suggested);
  const good = 'Ridhi Harbor Blue Hand Block Print Square Tablecloth 54×54 Inch Kitchen Dining';
  ok('…a backend suggestion that keeps every important word is shown as it is', lo(good, cur).suggested === good);

  // before / after with the code before this change (printed for the record)
  const old = oldFiles();
  if (old) {
    const O = page(old.files);
    console.log(`\n== the same two cases with the code of ${old.rev} (before) ==`);
    try {
      const ob = O.ttBuild('SP', rowOf(O, 'RTC-627-5454'), O.hCtx(), { va: REAL['RTC-627-5454'].va, pt: 'TABLECLOTH', src: 'Amazon (read now)' });
      console.log(`  RTC-627-5454 title  BEFORE: ${ob.after}${ob.why ? '  [' + ob.why + ']' : ''}\n                      AFTER:  ${rtc.after}  [${rtc.why || 'ready'}]`);
      const os = O.kfShorten(KW146, { title: REAL['RT146-70118'].title, brands: ['ridhi'] });
      console.log(`  RT146-70118 search terms BEFORE (${os.bytesAfter} bytes): ${os.after}\n                      AFTER  (${s146.bytesAfter} bytes): ${s146.after}`);
      console.log(`  …before it removed: ${['hand', 'block', 'print', 'tablecloth', 'rectangle', 'green', 'cotton'].filter(w => !has(os.after, w)).join(', ') || 'none of the important words'}; it kept: ${['square', 'pink', 'blue', 'indian', 'colorful', 'gift'].filter(w => has(os.after, w)).join(', ') || 'none of the bad ones'}`);
    } catch (e) { console.log('  (the old code could not run these: ' + e.message + ')'); }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
