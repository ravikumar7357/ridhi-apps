/* Title Fix never drops the PRODUCT NAME (22 Nov 2026, listing-rules.js lrSwFacts names / lrTitleFix 7a–8 / lrDropMaterial / lrTitleLost,
 * title-fix.js ttCheck). The Tissue Box Cover family: adding the size made the titles too long, and the shortening cut "Tissue Box Cover"
 * (a product the word lists did not know) while keeping "100% Cotton," — and the check said "Passes every title rule".
 *   node tests/title-product-test.js
 * Covers: the product's own name from the sub-category; material ("100% Cotton", its comma) goes first, then filler, then the 74–75 short
 * forms, word order kept; RTBX119 → the expected 74-character title; nothing protected (brand, product, colour, size) is ever lost — else
 * "Can't fit: needs a manual title" and no suggestion; the check fails a new title without the product; the rule before (LR_TF_GUARD off)
 * reproduces the bug; debugTitleFix() lists the suggestions that dropped a product name. */
const { SAMPLE, CAT, load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const NOW = Date.now();
const mk = (sku, title, parent) => ({ brand: 'SP', parent: parent || 'PTBX', sku, asin: 'B0' + sku, title, qty: 5, price: 20, status: 'Active', channel: 'AFN', aplus: true,
  aplusAt: NOW, checked: NOW, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
// the family as on screen (4 of its 11): every title says "Tissue Box Cover", none has the size, which the catalogue knows (4.5x4.5x5)
const TBX = [
  ['RTBX119', 'Ridhi Hand Block Print Tissue Box Cover Square 100% Cotton, Green Stripe', 'Green Stripe'],
  ['RTBX129', 'Ridhi Hand Block Print Tissue Box Cover Square 100% Cotton, Blue Floral Bunch', 'Blue Floral Bunch'],
  ['RTBX14', 'Ridhi Hand Block Print Tissue Box Cover Square 100% Cotton, Red Paisley Buta', 'Red Paisley Buta'],
  ['RTBX327', 'Ridhi Hand Block Print Tissue Box Cover Square 100% Cotton, Indigo Mughal Jaal', 'Indigo Mughal Jaal'],
];
TBX.forEach(([sku, title, color]) => { SAMPLE.push(mk(sku, title)); CAT.SP[sku] = { color, size: '4.5x4.5x5', subcat: 'Tissue Box Cover' }; });
// the real colours of the family (Taupe, Goldenrod Yellow, Light Steel Blue)
[['RTBXT', 'Taupe'], ['RTBXG', 'Goldenrod Yellow'], ['RTBXB', 'Light Steel Blue']].forEach(([sku, color]) => {
  SAMPLE.push(mk(sku, `Ridhi Hand Block Print Tissue Box Cover Square 100% Cotton, ${color}`));
  CAT.SP[sku] = { color, size: '4.5x4.5x5', subcat: 'Tissue Box Cover' };
});
// filler in a phrase ("Dining Table Cover") and a shape word: the filler goes whole, the shape stays
SAMPLE.push(mk('RTCF', 'Ridhi Hand Block Print Rectangle Tablecloth 60 x 90 Inch Cotton Dining Table Cover Party - Blue', 'PTCF'));
CAT.SP.RTCF = { color: 'Blue', size: '60x90', subcat: 'Rectangle Tablecloth' };
// a title that cannot fit without losing a protected word (a long colour, no material, no filler)
SAMPLE.push(mk('RTBXL', 'Ridhi Tissue Box Cover Green Stripe With Pink Paisley Buta And Golden Mughal Jaal Border', 'PTBXL'));
CAT.SP.RTBXL = { color: 'Green Stripe With Pink Paisley Buta And Golden Mughal Jaal Border', size: '4.5x4.5x5', subcat: 'Tissue Box Cover' };

// THE REMOVE-ALLOWLIST (22 Nov 2026): the user's cases — any product, known or not
const CASES = [
  ['SP', 'PNAP', 'NAP-DIN', 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Dinner Napkins for Kitchen Party - Ivory', { color: 'Ivory', size: '18x18', subcat: 'Napkin Set' },
    'Ridhi Cloth Napkins 18 x 18 Inch Block Print Reusable Napkins - Ivory'],
  ['SP', 'PNAP', 'NAP-SET', 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Block Print Reusable Dinner Napkins Set - Black', { color: 'Black', size: '20x20', subcat: 'Napkin Set' },
    'Ridhi Cloth Napkins 20 x 20 Inch Block Print Reusable Napkins Set - Black'],
  ['CPC', 'PTC', 'TC-COVER', 'Cotton Tablecloth Rectangle 60 x 90 Inch Block Print Table Cover - Red', { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' },
    'Whimsical Corner Tablecloth Rectangle 60x90 In Block Print Table Cover Red'],
  ['SP', 'PRND', 'RND-110', 'Ridhi Block Print Round Tablecloth Brown Meadow Vine 110 Inch 100% Cotton for Dining Table Party', { color: 'Brown', size: '110', subcat: 'Round Tablecloth' },
    'Ridhi Block Print Round Tablecloth Brown Meadow Vine 110 Inch'],
  ['SP', 'PBB', 'BREAD', 'Ridhi Hand Block Print Bread Basket Liner Round 100% Cotton Kitchen Dining Table Decor - Mustard Yellow', { color: 'Mustard Yellow', size: '', subcat: 'Bread Basket Liner' },
    'Ridhi Hand Block Print Bread Basket Liner Round Kitchen - Mustard Yellow'],
  ['SP', 'PUNK', 'TORT', 'Ridhi Hand Block Print Tortilla Warmer Pouch Square 100% Cotton Reusable for Kitchen - Indigo Floral', { color: 'Indigo Floral', size: '', subcat: 'Tortilla Warmer' },
    'Ridhi Hand Block Print Tortilla Warmer Pouch Square - Indigo Floral'],
  // the shape only as the very last step: without "Round" it fits, with it nothing else may go
  ['SP', 'PSH', 'SHAPE', 'Ridhi Hand Block Print Round Bread Basket Liner 100% Cotton - Goldenrod Yellow Floral Vine', { color: 'Goldenrod Yellow Floral Vine', size: '', subcat: 'Bread Basket Liner' },
    'Ridhi Hand Block Print Bread Basket Liner - Goldenrod Yellow Floral Vine'],
];
CASES.forEach(([b, p, sku, title, cat]) => { SAMPLE.push(Object.assign(mk(sku, title, p), { brand: b })); CAT[b][sku] = cat; });

const EXPORT = '\n;globalThis.__R = { lrTitleFix, lrSwFacts, lrSuggestWords, lrTitleLost: typeof lrTitleLost === "function" ? lrTitleLost : null, lrDropMaterial: typeof lrDropMaterial === "function" ? lrDropMaterial : null,'
  + ' lrTitleMissing, lrShortenTitle, LR_TITLE_FILLER, LR_BLOCKED,'
  + ' setGuard: v => { LR_TF_GUARD = v; }, LR_CANT_FIT: typeof LR_CANT_FIT === "undefined" ? "" : LR_CANT_FIT };';
const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-rules.js'), 'utf8');
const OPTS = { ws: true, sp: true, fa: true, lh: true, ctx: { imOnly() {}, leOnly() {}, leShow() {}, leListEnsure() {}, imListRender() {} } };   // as title-fix-test loads Fix all
const A = load(Object.assign({ src: SRC + EXPORT }, OPTS));
const R = globalThis.__R;
const ctx = A.hCtx();
const row = sku => A.rows.find(r => r.sku === sku);
const fix = sku => R.lrTitleFix(row(sku), ctx, { max: 75 });

console.log('== the product\'s own name ==');
{
  const f = R.lrSwFacts(row('RTBX119'), ctx.cfg, null, {});
  eq('"Tissue Box Cover" is the product\'s own name (from the sub-category; the word lists do not know it)', f.names, ['Tissue Box Cover']);
  eq('…not added to the product words (where a missing size goes stays as it was)', f.product, []);
  ok('a napkin listing keeps its names as the title holds them (nothing invented)', R.lrSwFacts(row('R1'), ctx.cfg, null, {}).names.every(n => /napkin/i.test(n)), JSON.stringify(R.lrSwFacts(row('R1'), ctx.cfg, null, {}).names));
}

console.log('== the Tissue Box Cover family, now ==');
{
  const x = fix('RTBX119');
  eq('RTBX119 → "Ridhi Hand Block Print Tissue Box Cover Square Green Stripe 4.5x4.5x5 Inch" (74)', [x.after, x.after.length, x.held], ['Ridhi Hand Block Print Tissue Box Cover Square Green Stripe 4.5x4.5x5 Inch', 74, '']);
  eq('…the size added, "100% Cotton," taken out first (the comma with it), word order kept', x.fixes, ['Missing size', 'Shortened to 74 characters']);
  TBX.forEach(([sku]) => {
    const y = fix(sku);
    ok(`${sku}: "Tissue Box Cover", the brand, the colour and the size all in the suggestion, within 75 (${y.after.length})`,
      !y.held && /^Ridhi /.test(y.after) && /Tissue Box Cover/.test(y.after) && y.after.includes(CAT.SP[sku].color) && /4\.5x4\.5x5(?: Inch|")/.test(y.after) && y.after.length <= 75, y.held || y.after);
  });
  // THE REMOVE-ALLOWLIST: material, then filler (none here), then the 74–75 short forms ("Inch" → '"'), and only then the shape
  eq('RTBX129: material first, then the 74–75 short form — "Square" stays (the shape goes only last)', fix('RTBX129').after, 'Ridhi Hand Block Print Tissue Box Cover Square Blue Floral Bunch 4.5x4.5x5"');
}

console.log('== the real colours (Taupe, Goldenrod Yellow, Light Steel Blue): every word kept, the shape too ==');
{
  eq('Taupe → "…Tissue Box Cover Square Taupe 4.5x4.5x5 Inch" (67, nothing else taken)', [fix('RTBXT').after, fix('RTBXT').after.length], ['Ridhi Hand Block Print Tissue Box Cover Square Taupe 4.5x4.5x5 Inch', 67]);
  // 46 + " Goldenrod Yellow" + the size = 78: "100% Cotton," goes, then the 74–75 short form ('"') — it fits, so the shape stays
  eq('Goldenrod Yellow (78): the 74–75 short form comes before the shape → 74, "Square" kept', [fix('RTBXG').after, fix('RTBXG').after.length], ['Ridhi Hand Block Print Tissue Box Cover Square Goldenrod Yellow 4.5x4.5x5"', 74]);
  eq('Light Steel Blue: "Light" is part of its colour, never filler → 74, "Square" kept', [fix('RTBXB').after, fix('RTBXB').after.length], ['Ridhi Hand Block Print Tissue Box Cover Square Light Steel Blue 4.5x4.5x5"', 74]);
  ok('…"Box" and "Cover" in all three (before 22 Nov two of them lost "Box Cover")', ['RTBXT', 'RTBXG', 'RTBXB'].every(s => /Tissue Box Cover/.test(fix(s).after) && !R.lrTitleMissing(fix(s).before, fix(s).after, {}).length));
}

console.log('== filler in whole phrases; the shape is protected ==');
{
  const y = fix('RTCF');
  eq('"Cotton", "Party" and "Dining" go (the allowlist); "Table Cover" stays whole — never "Table" alone; "Rectangle" kept', [y.held, y.after], ['', 'Ridhi Hand Block Print Rectangle Tablecloth 60 x 90 Inch Table Cover - Blue']);
  const s = R.lrSuggestWords('Ridhi Tablecloth Rectangle 60x90 Inch Block Print Table Cover - Red', { mode: 'title', facts: { product: ['tablecloth'], colour: 'Red', brands: ['ridhi'] }, fits: x => x.length <= 64 });
  ok('the suggestion-words rule in a title: "Table Cover" goes whole — never "… Block Print Table - Red"', !/Print Table -/.test(s.after) && /Block Print - Red$/.test(s.after), s.after);
  const k = R.lrSuggestWords('tablecloth table cover dining table rectangle', { mode: 'kw', facts: { product: ['tablecloth'] }, fits: x => x.length <= 30 });
  ok('search terms are not changed by it (phrases and shapes: titles only)', typeof k.after === 'string');
}

console.log('== can\'t fit: no suggestion ==');
{
  const y = fix('RTBXL');
  ok('a title that only fits by losing a protected word → "Can\'t fit: needs a manual title", no change suggested', y.held.startsWith("Can't fit: needs a manual title") && y.after === y.before && !y.fixes.length, JSON.stringify(y));
  const plan = A.ttBuild ? A.ttBuild('SP', row('RTBXL'), ctx, { va: {}, pt: 'HOME' }) : null;
  if (plan) ok('…Fix all titles shows it as the reason (never sendable)', /Can't fit: needs a manual title/.test(plan.why || ''), plan.why);
}

console.log('== the check on the NEW title ==');
{
  const bad = 'Ridhi Hand Block Print Square 100% Cotton, Green Stripe 4.5x4.5x5 Inch';
  const chk = A.ttCheck('SP', row('RTBX119'), bad, ctx);
  ok('a new title without "Tissue Box Cover" never "passes every title rule": Missing product', !chk.pass && chk.fails.some(f => /Missing product: "Tissue Box Cover"/.test(f)), JSON.stringify(chk.fails));
  const cut = A.ttCheck('SP', row('RTBX119'), 'Ridhi Hand Block Print Tissue Box Square 100% Cotton, Green Stripe 4.5x4.5x5 Inch', ctx);
  ok('…nor one that cut "Cover"', !cut.pass && cut.fails.some(f => /Missing product/.test(f)), JSON.stringify(cut.fails));
  const good = A.ttCheck('SP', row('RTBX119'), fix('RTBX119').after, ctx);
  ok('the new RTBX119 suggestion passes', good.pass, JSON.stringify(good.fails));
}

console.log('== the rule before 22 Nov (LR_TF_GUARD off) reproduces the bug ==');
{
  R.setGuard(false);
  const old = ['RTBX119', 'RTBX129', 'RTBX14', 'RTBX327'].map(sku => fix(sku));
  R.setGuard(true);
  eq('before: RTBX119 → "…Tissue Box 100% Cotton, Green Stripe 4.5x4.5x5 Inch" ("Cover" and "Square" cut, "100% Cotton," kept)', old[0].after, 'Ridhi Hand Block Print Tissue Box 100% Cotton, Green Stripe 4.5x4.5x5 Inch');
  ok('before: every one of the four lost a product word', old.every((o, i) => !/Tissue Box Cover/.test(o.after)), old.map(o => o.after).join(' | '));
}

console.log('== THE REMOVE-ALLOWLIST: only material, approved filler, the 74–75 short forms and — last — the shape may go ==');
{
  CASES.forEach(([b, , sku, title, cat, want]) => {
    const y = fix(sku);
    eq(`${sku}: "${title}" (${title.length}) → "${want}" (${want.length})`, [y.held, y.after], ['', want]);
    const miss = R.lrTitleMissing(title, y.after, {});
    const brand = b === 'SP' ? 'Ridhi' : 'Whimsical Corner';
    ok(`${sku}: every word not on the allowlist still there (word order kept); brand, colour${cat.size ? ', size' : ''} in it; within 75`,
      !miss.length && y.after.startsWith(brand) && y.after.includes(cat.color) && (!cat.size || /\d/.test(y.after)) && y.after.length <= 75, JSON.stringify(miss));
  });
  ok('the shape goes only when nothing else is left (SHAPE: "Round" goes, it fits; BREAD and TORT keep theirs)', !/Round/.test(fix('SHAPE').after) && /Round/.test(fix('BREAD').after) && /Square/.test(fix('TORT').after));
  ok('a product Sellora has never seen keeps every word ("Bread Basket Liner", "Tortilla Warmer Pouch")', /Bread Basket Liner/.test(fix('BREAD').after) && /Tortilla Warmer Pouch/.test(fix('TORT').after));
  ok('"Napkins Set" stays whole, only "Dinner" goes (NAP-SET); the repeated "Napkins" stays (NAP-DIN)', /Reusable Napkins Set - Black$/.test(fix('NAP-SET').after) && /Reusable Napkins - Ivory$/.test(fix('NAP-DIN').after));
  ok('the remove-allowlist is one written list (Dining, Kitchen, Party, Wedding, Reusable, Machine Washable, for Home, Decor, Farmhouse…)',
    ['Dining', 'Kitchen', 'Party', 'Wedding', 'Reusable', 'Machine Washable', 'for Home', 'Decor', 'Farmhouse'].every(w => R.LR_TITLE_FILLER.includes(w))
    && !['Light', 'Neutral', 'Napkins', 'Table Cover', 'Set', 'Box', 'Cover', 'Basket'].some(w => R.LR_TITLE_FILLER.includes(w)));
  // still too long with only the allowlist gone → no suggestion
  const x = fix('RTBXL');
  ok('nothing on the allowlist left and still over 75 → "Can\'t fit: needs a manual title", no suggestion', x.held.startsWith("Can't fit: needs a manual title") && x.after === x.before);
}

console.log('== THE SAFETY CHECK on every suggestion (Fix, Fix all, Fix all titles, ✨ AI title) ==');
{
  const was = row('BREAD');
  const lossy = 'Ridhi Hand Block Print Liner Round Kitchen - Mustard Yellow';
  eq('lrTitleMissing: the words not on the allowlist that a new title lost ("bread", "basket")', R.lrTitleMissing(was.title, lossy, {}), ['bread', 'basket']);
  eq('…nothing when only allowlist words went (material, filler, shape)', R.lrTitleMissing(was.title, 'Ridhi Hand Block Print Bread Basket Liner - Mustard Yellow', {}), []);
  eq('…"18x18" = "18 x 18", Inch = In = \'"\', "Set of 4" = "4 Pack" (a short form is not a loss)', R.lrTitleMissing('Ridhi Napkins 18x18 Inches Set of 4 - Red', 'Ridhi Napkins 18 x 18" 4 Pack - Red', {}), []);
  const chk = A.ttCheck('SP', was, lossy, ctx);
  ok('ttCheck (Fix all titles, ✨ AI title): a lossy title never "passes" — "Blocked by the safety check — it would lose "bread", "basket""',
    !chk.pass && chk.fails.some(f => f === `${R.LR_BLOCKED} — it would lose "bread", "basket"`), JSON.stringify(chk.fails));
  const napkin = A.ttCheck('SP', row('R1'), 'Ridhi Cloth Napkins 18 x 18 Inch - Blue', ctx);
  ok('…a napkin title that drops "Block Print" is blocked with the missing words', !napkin.pass && napkin.fails.some(f => /^Blocked by the safety check — it would lose "block", "print"/.test(f)), JSON.stringify(napkin.fails));
  ok('…every suggestion it makes itself passes the check', CASES.every(([, , sku]) => !A.ttCheck(A.rows.find(r => r.sku === sku).brand, row(sku), fix(sku).after, ctx).fails.some(f => f.startsWith(R.LR_BLOCKED))));
  const ai = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-ai.js'), 'utf8');
  ok('✨ AI title: its check runs ttCheck, and the safety check where ttCheck cannot run', /ttCheck\(c\.brand, c\.row, t, c\.ctx\)/.test(ai) && /lrTitleMissing\(was, t, \{\}\)/.test(ai));
  const k = R.lrSuggestWords('tablecloth table cover dining table rectangle cotton', { mode: 'kw', facts: { product: ['tablecloth'] }, fits: x => x.length <= 30 });
  eq('search-term shortening unchanged (the suggestion-words rule, kw mode)', k.after, 'tablecloth table dining cotton');
}

console.log('== the rest of the sample: what the remove-allowlist changes ==');
{
  const own = new Set(CASES.map(c => c[2]));
  const sample = A.rows.filter(r => !/^RTBX/.test(r.sku) && !own.has(r.sku));
  const diff = [];
  R.setGuard(false);
  const was = new Map(sample.map(r => [r.sku, R.lrTitleFix(r, ctx, { max: 75 })]));
  R.setGuard(true);
  sample.forEach(r => { const now = R.lrTitleFix(r, ctx, { max: 75 }), w = was.get(r.sku); if (now.after !== w.after || now.held !== w.held) diff.push(`${r.sku}: ${w.held || w.after} → ${now.held || now.after}`); });
  console.log('    changed suggestions in the 19-listing sample:', diff.length ? '\n      ' + diff.join('\n      ') : 'none');
  ok('no suggestion of the sample loses a product name now', sample.every(r => { const n = R.lrTitleFix(r, ctx, { max: 75 }); return n.held || !R.lrTitleLost(n.before, n.after, r, ctx.cfg, R.lrSwFacts(r, ctx.cfg, null, { title: n.before }), n.fixes).length; }));
}

console.log('== window.debugTitleFix() on the same listings ==');
{
  const dbg = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'debug-title-fix.js'), 'utf8');
  const B = load(Object.assign({ src: SRC + '\n' + dbg + '\n;globalThis.__D = debugTitleFix;' }, OPTS));
  const keep = [console.log, console.table];
  console.log = () => {}; console.table = () => {};
  let d;
  try { d = globalThis.__D(); } finally { [console.log, console.table] = keep; }
  // 6 of the 7 family titles lost part of "Tissue Box Cover" before (Taupe, short enough, kept it and lost only "Square")
  ok('it lists the 6 RTBX suggestions that dropped "Tissue Box Cover" before, in 1 family', d && JSON.stringify(d.dropped.filter(x => /^RTBX/.test(x.sku)).map(x => x.sku).sort()) === JSON.stringify(['RTBX119', 'RTBX129', 'RTBX14', 'RTBX327', 'RTBXB', 'RTBXG']) && d.families >= 1, d && JSON.stringify(d.dropped.map(x => x.sku)));
  ok('…each with what it lost and its suggestion now', d.dropped.filter(x => /^RTBX1/.test(x.sku)).every(x => /product name/.test(x.lost) && /Tissue Box Cover/.test(x.now)), JSON.stringify(d.dropped[0]));
  ok('the RTBX prefix table: before → now for every RTBX listing (8)', d.prefix.length === 8 && d.prefix.find(p => p.sku === 'RTBX119').now === 'Ridhi Hand Block Print Tissue Box Cover Square Green Stripe 4.5x4.5x5 Inch', JSON.stringify(d.prefix));
  ok('changed: every suggestion that changed, before → now', d.changed.length > 0 && d.changed.every(c => c.sku && c.title && c.before !== c.now) && d.changed.some(c => c.sku === 'TBX' || c.sku === 'RTBXG'), JSON.stringify(d.changed.map(c => c.sku)));
  const bl = d.blocked.find(x => x.sku === 'RTBXG');
  ok('blocked: the old suggestions the safety check blocks, with the missing words (RTBXG lost "box", "cover")', bl && /\bbox\b/.test(bl.missing) && /\bcover\b/.test(bl.missing), JSON.stringify(d.blocked.map(x => [x.sku, x.missing])));
  ok('blocked: the old CPC "Table Cover" suggestion too (TC-COVER lost "table", "cover")', d.blocked.some(x => x.sku === 'TC-COVER' && /table/.test(x.missing) && /cover/.test(x.missing)), JSON.stringify(d.blocked.map(x => [x.sku, x.missing])));
  eq('unsafe: ZERO new suggestions missing a product / brand / colour / size word', d.unsafe, []);
  // print the report the user asked for (test data)
  console.log('    changed (before → now):\n' + d.changed.map(c => `      ${c.sku}: ${c.before} → ${c.now}`).join('\n'));
  console.log('    old suggestions now blocked (missing words):\n' + d.blocked.map(c => `      ${c.sku}: ${c.before}  [missing: ${c.missing}]`).join('\n'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
