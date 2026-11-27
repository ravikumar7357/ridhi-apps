/* SEARCH KEYWORDS — fixes from real data (30 Nov 2026): Tablecloth Main, RT146-70118 (Turquoise Moss Green, 118 × 70) and RT354_70118
 * (Bubblegum Pink, 118 × 70). The one rule (listing-rules.js lrSuggestWords, search-terms mode) and the words it may add (kw-win.js
 * kwWinFor) on the two listings in our real title format, with search terms and our own Sponsored Products search terms written the way
 * the real ones read (colours of other cloths, other sizes, card tables, kids, misspelt brands, "rhidi", low-value words).
 *   node tests/kw-real-test.js
 * 1 colours (close shades kept) · 2 fit (card table, kids, small, another shape) · 3 low value · 4 only its own size 🔒 · 5 brand variants
 * and "rhidi" · 6 the popup's "Skipped N words (not this product)". Titles are never touched (kw-win-test.js compares them). */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const bytes = s => Buffer.byteLength(String(s).replace(/[\s;,.]+/g, ''), 'utf8');
const fits = t => bytes(t) <= 249;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 1)); };

const T146 = { brand: 'SP', sku: 'RT146-70118', asin: 'B0RT146001', parent: 'TABLECLOTH-MAIN', pt: 'TABLECLOTH', color: 'Turquoise Moss Green', size: '70x118', subcat: 'Rectangle Tablecloth',
  title: 'Ridhi Turquoise Moss Green Hand Block Print Rectangle Tablecloth 70x118 Inch',
  kw: 'ridhi rhidi tablecloth tablecloths turquoise teal aqua moss green sage salmon coral navy mustard cotton 100% cotton 118x70 70 x 118 inch 60x90 60x60 90x60 60x108 rectangle '
    + 'table cover anthropology potterybarn hand block print dining kitchen table linen everyday washable fun nice cute' };
const T354 = { brand: 'SP', sku: 'RT354_70118', asin: 'B0RT354001', parent: 'TABLECLOTH-MAIN', pt: 'TABLECLOTH', color: 'Bubblegum Pink', size: '70x118', subcat: 'Rectangle Tablecloth',
  title: 'Ridhi Bubblegum Pink Hand Block Print Rectangle Tablecloth 70x118 Inch',
  kw: 'ridhi pink rose blush hot pink salmon coral navy blue tablecloth 70x118 118 x 70 60x90 90x60 cotton fun cute pretty potterybarn anthropology rhidi floral dining kitchen' };
// our own Sponsored Products search terms (nightly srchTerm shape), one ad group per listing of the family
const st = (t, ag, c, o, sp, s) => ({ t, ag, cid: 'C1', kw: t, mt: 'BROAD', i: c * 40, c, sp, o, s });
const PPC = { SP: { from: '2026-10-31', to: '2026-11-29', rows: [
  st('farmhouse tablecloth', 'AG146', 140, 14, 60, 420), st('card table tablecloth', 'AG146', 60, 6, 20, 180), st('salmon tablecloth', 'AG146', 50, 5, 20, 150),
  st('kids tablecloth', 'AG146', 40, 4, 15, 120), st('small tablecloth', 'AG146', 30, 3, 10, 90), st('square tablecloth', 'AG146', 45, 4, 15, 120),
  st('cute tablecloth', 'AG146', 30, 3, 10, 90), st('rhidi tablecloth', 'AG146', 20, 2, 5, 60), st('anthropology tablecloth', 'AG146', 20, 2, 5, 60),
  st('tablecloth 60x90', 'AG146', 30, 3, 10, 90), st('teal tablecloth', 'AG146', 30, 5, 10, 150), st('king size tablecloth', 'AG354', 20, 2, 5, 60),
  st('rose tablecloth', 'AG354', 30, 3, 10, 90), st('picnic tablecloth', 'AG354', 30, 3, 10, 90), st('cars tablecloth', 'AG354', 20, 2, 5, 60)] } };
const AG = { SP: { groups: { AG146: { n: 'RT146', a: ['B0RT146001'] }, AG354: { n: 'RT354', a: ['B0RT354001'] } } } };

function setup() {
  const C = load({ ws: true, sp: true, fa: true, ai: true, le: true, ctx: { imOnly() {}, imListRender() {} }, baCall: async () => ({}) });
  C.setHealthLoaded(true); C.LI_WS.stored = true; C.SP.log = []; C.FA.log = [];
  const now = Date.now();
  [T146, T354].forEach(L => {
    C.LI_WS.schema.SP[L.pt] = { at: now, ok: [], hl: { none: true } };
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: L.parent, sku: L.sku, asin: L.asin, title: L.title, qty: 5, price: 45, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
      content: { titleLen: L.title.length, images: 8, bullets: 5, descLen: 300, title: L.title } });
    C.setCat('SP', { [L.sku]: { subcat: L.subcat, color: L.color, size: L.size } });
    C.LI_WS.live.SP[L.sku] = { at: now, cAt: now, pt: L.pt, title: L.title, titleLen: L.title.length, catTitle: L.title, tAt: now, kw: L.kw, kwBytes: bytes(L.kw), bul: 5, desc: 300 };
    C.KF.full.set('SP|' + L.sku, { kw: L.kw, pt: L.pt, at: now });
  });
  C.LI_WS.liveV++; C.reset();
  C.kwUse({});                                             // no Brand Analytics upload: the proven words of our ads only
  C.kwUsePpc({ terms: PPC, groups: AG, days: 30, src: 'srchTerm' });
  return C;
}
const facts = (C, L) => C.lrSwFacts({ brand: 'SP', sku: L.sku }, null, null, { title: L.title, pt: L.pt });
const winOf = (C, L, text) => C.kwWinFor({ brand: 'SP', sku: L.sku, title: L.title, kw: text, facts: facts(C, L), pt: L.pt });
const suggest = (C, L, text, extra) => { const w = winOf(C, L, text); return C.lrSuggestWords(text, Object.assign({ mode: 'kw', facts: facts(C, L), title: L.title, brands: C.lrBrandWords({ brand: 'SP' }, C.getLR()),
  others: C.kwOthers(C.getLR()), add: w.words, proof: w.proof, fits }, extra || {})); };
const why = (r, w) => (r.removed.find(x => x.w.toLowerCase() === w) || {}).why;
const keys = t => String(t).toLowerCase().split(/\s+/).filter(Boolean);
const keysOf = keys;

(async () => {
  const C = setup();
  const r146 = suggest(C, T146, T146.kw), r354 = suggest(C, T354, T354.kw);
  const w146 = winOf(C, T146, T146.kw), w354 = winOf(C, T354, T354.kw);
  const skip = w => w.skipped.map(x => x.why);

  console.log('== 1 colours: never another colour; its own and its close shades stay ==');
  ok('RT146 (Turquoise Moss Green): turquoise, teal, aqua (close shades), moss, green kept', ['turquoise', 'teal', 'aqua', 'moss', 'green'].every(w => keys(r146.after).includes(w)), r146.after);
  ok('…sage, salmon, coral, navy, mustard taken out — "not its colour"', ['sage', 'salmon', 'coral', 'navy', 'mustard'].every(w => why(r146, w) === 'not its colour'), JSON.stringify(r146.removed.map(x => x.w + ':' + x.why)));
  ok('RT354 (Bubblegum Pink): pink, rose, blush kept; salmon, coral, navy, blue out — "not its colour"', ['pink', 'rose', 'blush'].every(w => keys(r354.after).includes(w)) && ['salmon', 'coral', 'navy', 'blue'].every(w => why(r354, w) === 'not its colour'), JSON.stringify(r354.removed.map(x => x.w + ':' + x.why)));
  ok('never ADDED: "salmon" (PPC, 5 orders) — "skipped: not its colour (salmon)"; "teal" is RT146\'s shade but already there', !w146.words.some(x => x.w === 'salmon') && skip(w146).includes('skipped: not its colour (salmon)'), skip(w146).join(' ; '));
  ok('…RT354: "teal" (another colour) and "rose" (its own shade — already in its words) never added', !w354.words.some(x => /teal|rose/.test(x.w)) && skip(w354).includes('skipped: not its colour (teal)'), skip(w354).join(' ; '));
  ok('…a colour word is never added by the rule either (another colour handed to it is dropped)', C.lrSuggestWords('tablecloth', { mode: 'kw', facts: facts(C, T146), title: T146.title, fits, add: [{ w: 'salmon', why: 'x', proven: true }, { w: 'aqua', why: 'x', proven: true }] }).added.map(a => a.w).join() === 'aqua');

  console.log('== 2 fit: never another kind of table, user or size ==');
  ok('"card table tablecloth" (6 orders) — "skipped: not sure the product is for a card table"', skip(w146).includes('skipped: not sure the product is for a card table') && !w146.words.some(x => x.w === 'card'), skip(w146).join(' ; '));
  ok('"kids tablecloth" — for kids; "small tablecloth" — small; "king size tablecloth" — king size', skip(w146).includes('skipped: not sure the product is for kids') && skip(w146).includes('skipped: not sure the product is small') && skip(w354).includes('skipped: not sure the product is king size')
    && !w146.words.concat(w354.words).some(x => /^(kids|small|king|size)$/.test(x.w)), skip(w146).concat(skip(w354)).join(' ; '));
  ok('"square tablecloth" on a rectangle — "skipped: not its shape (square)"', skip(w146).includes('skipped: not its shape (square)'), skip(w146).join(' ; '));
  ok('…the proven word that does fit the product IS added: "+ farmhouse (PPC: 14 orders …)"', w146.words[0].w === 'farmhouse' && r146.added.some(a => a.w === 'farmhouse'), JSON.stringify(r146.added));

  console.log('== 3 low value: never added; the first of its own words to go when space is short ==');
  ok('"cute tablecloth" and "cars tablecloth" give nothing: cute, cars are low-value words', !w146.words.concat(w354.words).some(x => /^(cute|cars)$/.test(x.w)));
  const lv = C.lrSuggestWords('tablecloth turquoise fun nice cute pretty cotton dining', { mode: 'kw', facts: facts(C, T146), title: T146.title, fits: t => bytes(t) <= 32 });
  ok('to fit, fun / nice / cute / pretty go first — "low value"', ['fun', 'nice', 'cute', 'pretty'].every(w => why(lv, w) === 'low-value word') && lv.after === 'tablecloth turquoise cotton dining' && C.kwWhyLabel('low-value word') === 'low value', JSON.stringify([lv.after, lv.removed]));

  console.log('== 4 sizes: only its own size is 🔒 ==');
  const sz = r146.toks.filter(t => t.cls === 'size').map(t => t.w).join(' ');
  ok('RT146: 118x70, "70 x 118 inch" protected 🔒 (its own size, either order)', sz === '118x70 70 x 118 inch' && /118x70 70 x 118 inch/.test(r146.after), sz);
  ok('…60x90, 60x60, 90x60, 60x108 taken out first — "not its size"', ['60x90', '60x60', '90x60', '60x108'].every(w => why(r146, w) === 'not its size'), JSON.stringify(r146.removed.filter(x => x.why === 'not its size')));
  ok('RT354: 70x118 and "118 x 70" stay; 60x90, 90x60 out; "100%" and a count ("set of 4") are not sizes', ['60x90', '90x60'].every(w => why(r354, w) === 'not its size') && /70x118 118 x 70/.test(r354.after)
    && keys(r146.after).includes('100%') && C.lrSuggestWords('napkins set of 4 cotton', { mode: 'kw', facts: facts(C, T146), title: T146.title, fits }).after === 'napkins set of 4 cotton');
  ok('never added: "tablecloth 60x90" (PPC) — "skipped: not its size (60x90)"', skip(w146).includes('skipped: not its size (60x90)'), skip(w146).join(' ; '));

  console.log('== 5 brand variants ==');
  ok('"anthropology" (→ Anthropologie) and "potterybarn" (→ Pottery Barn) taken out — "other brand"', why(r146, 'anthropology') === 'other brand' && why(r146, 'potterybarn') === 'other brand' && why(r354, 'anthropology') === 'other brand', JSON.stringify(r146.removed.map(x => x.w + ':' + x.why)));
  ok('"rhidi" is a duplicate of Ridhi — taken out ("duplicate"), Ridhi kept once', why(r146, 'rhidi') === 'repeated' && why(r354, 'rhidi') === 'repeated' && keys(r146.after).filter(w => w === 'ridhi').length === 1 && C.kwWhyLabel('repeated') === 'duplicate');
  ok('never added: "rhidi tablecloth", "anthropology tablecloth" (PPC) give no word', !w146.words.some(x => /rhidi|anthropolog/.test(x.w)));
  ok('a real word near a brand is not a brand: "pottery" alone, "ridge", "hermit" stay', C.lrSuggestWords('pottery ridge hermit tablecloth', { mode: 'kw', facts: facts(C, T146), title: T146.title, fits }).after === 'pottery ridge hermit tablecloth');
  ok('the typing-slip check itself: anthropology ≈ anthropologie; rhidi ≈ ridhi (ours: two slips); not "riding"; not "hermit" for Hermes (another brand\'s short name: one slip only)', !!C.lrKwBrandSlip('anthropology', ['anthropologie']) && !!C.lrKwBrandSlip('rhidi', ['ridhi'], 2) && !C.lrKwBrandSlip('riding', ['ridhi'], 2) && !C.lrKwBrandSlip('hermit', ['hermes']));

  console.log('== 6 the popup: "Skipped N words (not this product)" on top ==');
  const items = [T146, T354].map(L => C.kfItemOf('SP', C.HEALTH.SP.rows.find(x => x.sku === L.sku), C.hCtx(), null));
  C.LI_WS.live.SP[T146.sku].kw = T146.kw + ' ' + 'z'.repeat(120);    // over the limit: Fix all search terms takes it
  C.KF.full.set('SP|' + T146.sku, { kw: T146.kw + ' ' + 'z'.repeat(120), pt: 'TABLECLOTH', at: Date.now() });
  C.LI_WS.liveV++; C.reset();
  C.kfPreview([C.kfItemOf('SP', C.HEALTH.SP.rows.find(x => x.sku === T146.sku), C.hCtx(), null)], { title: 'Tablecloth Main', brand: 'SP', parent: T146.parent });
  await settle();
  const html = C.el('spModalBox').innerHTML.replace(/&#39;/g, "'");
  const n = items[0].win.skipped.length;
  ok(`the count on top: "Skipped ${n} words (not this product)"`, new RegExp(`<p class="kf-skipn">Skipped ${n} words \\(not this product\\)`).test(html) && n >= 6, strip(html).slice(0, 400));
  ok('…and under the child each reason: "skipped: not sure the product is for a card table (PPC: 6 orders from \'card table tablecloth\')"', /skipped: not sure the product is for a card table \(PPC: 6 orders from 'card table tablecloth'\)/.test(html), (html.match(/kf-adds[\s\S]{0,1200}/) || [''])[0]);
  ok('…the struck words with their reasons: not its colour, not its size, other brand, duplicate', /title="not its colour">salmon<\/s>/.test(html) && /title="not its size">60x90<\/s>/.test(html) && /title="other brand">anthropology<\/s>/.test(html) && /title="duplicate">rhidi<\/s>/.test(html));
  C.kfClick({ dataset: { kf: 'cancel' } });


  console.log('== (1 Dec 2026) low value ALWAYS out; colour phrases stay together ==');
  ok('RT146: fun, nice, cute go though it is within the limit — "low value"', bytes(T146.kw) <= 249 && ['fun', 'nice', 'cute'].every(w => why(r146, w) === 'low-value word') && !/\b(fun|nice|cute)\b/.test(r146.after), JSON.stringify(r146.removed.map(x => x.w + ':' + x.why)));
  ok('RT354: fun, cute, pretty go too', ['fun', 'cute', 'pretty'].every(w => why(r354, w) === 'low-value word'));
  const lb = Object.assign({}, facts(C, T354), { colour: 'Light Blue' });
  const lr = C.lrSuggestWords('light blue napkin light weight', { mode: 'kw', facts: lb, title: 'Ridhi Light Blue Napkins', fits });
  ok('…never a 🔒 word: "light" of its own colour "Light Blue" stays; the other "light" (a low-value word) goes', lr.after === 'light blue napkin weight' && lr.removed.length === 1 && lr.removed[0].i === 3, JSON.stringify([lr.after, lr.removed]));
  ok('RT354 "pink … hot pink": the PHRASE "hot pink" stays, the lone "pink" goes ("duplicate")', /\bhot pink\b/.test(r354.after) && r354.removed.some(x => x.w === 'pink' && x.i === 1 && x.why === 'repeated') && keysOf(r354.after).filter(w => w === 'pink').length === 1, r354.after);
  const p = (L, t, f) => C.lrSuggestWords(t, { mode: 'kw', facts: f || facts(C, L), title: L.title, fits });
  const bb = p(T354, 'tablecloth baby blue baby shower');
  ok('a colour modifier never stays alone: "baby blue" on the pink cloth → blue (not its colour), baby (leftover); "baby shower" stays', bb.after === 'tablecloth baby shower' && bb.removed.map(x => x.w + ':' + x.why).sort().join() === 'baby:leftover,blue:not its colour', JSON.stringify([bb.after, bb.removed]));
  const dk = p(T354, 'tablecloth light pink dark salmon pale coral deep pink');
  ok('"light pink" stays (its colour); "dark salmon", "pale coral" go whole; "deep pink" — the second pink goes with its modifier', /^tablecloth light pink$/.test(dk.after) && ['dark:leftover', 'pale:leftover', 'salmon:not its colour', 'coral:not its colour'].every(x => dk.removed.map(r => r.w + ':' + r.why).includes(x)), JSON.stringify([dk.after, dk.removed]));
  const nb = p(T354, 'blue tablecloth navy blue', Object.assign({}, facts(C, T354), { colour: 'Navy Blue' }));
  ok('"blue … navy blue" on a Navy Blue cloth: "navy blue" stays, the lone "blue" goes', nb.after === 'tablecloth navy blue' && nb.removed.map(x => x.w + ':' + x.why).join() === 'blue:repeated', JSON.stringify([nb.after, nb.removed]));
  const sg = p(T146, 'tablecloth sage green moss green');
  ok('"sage green" on the Moss Green cloth: sage (not its colour), then the second green is a repeat — "moss green" stays whole', sg.after === 'tablecloth moss green' && sg.removed.some(x => x.w === 'sage' && x.why === 'not its colour'), JSON.stringify([sg.after, sg.removed]));
  const ow = p(T146, 'tablecloth off white turquoise');
  ok('"off white" on the turquoise cloth: white (not its colour) and off (leftover) go together', ow.after === 'tablecloth turquoise' && ow.removed.map(x => x.w + ':' + x.why).sort().join() === 'off:leftover,white:not its colour', JSON.stringify([ow.after, ow.removed]));

  console.log('== titles are never touched ==');
  const tt = C.lrSuggestWords(T146.title + ' 60x90 Salmon', { mode: 'title', facts: facts(C, T146), fits: x => x.length <= 200 });
  ok('a title keeps every word (the 30-Nov rules are search terms only)', tt.after === T146.title + ' 60x90 Salmon' && !tt.removed.length);

  console.log('== before → after ==');
  [[T146, r146], [T354, r354]].forEach(([L, r]) => {
    const w = winOf(C, L, L.kw);
    console.log(`  ${L.sku} (${L.title})`);
    console.log(`    before (${bytes(L.kw)} bytes): ${L.kw}`);
    console.log(`    after  (${bytes(r.after)} bytes): ${r.after}`);
    console.log(`    added: ${r.added.map(a => `+ ${a.w} (${a.why})${a.replaces && a.replaces.length ? ' replaces ' + a.replaces.join(', ') + ' (no orders)' : ''}`).join('; ') || '—'}`);
    console.log(`    removed: ${r.removed.map(x => `${x.w} (${C.kwWhyLabel(x.why)})`).join(', ') || '—'}`);
    console.log(`    skipped (${w.skipped.length}): ${w.skipped.map(x => x.why.replace(/^skipped: /, '')).join('; ')}`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
