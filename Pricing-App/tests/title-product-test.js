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

const EXPORT = '\n;globalThis.__R = { lrTitleFix, lrSwFacts, lrSuggestWords, lrTitleLost: typeof lrTitleLost === "function" ? lrTitleLost : null, lrDropMaterial: typeof lrDropMaterial === "function" ? lrDropMaterial : null,'
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
      !y.held && /^Ridhi /.test(y.after) && /Tissue Box Cover/.test(y.after) && y.after.includes(CAT.SP[sku].color) && /4\.5x4\.5x5 Inch/.test(y.after) && y.after.length <= 75, y.held || y.after);
  });
  eq('RTBX129: material first, then the filler word "Square" (still over 75 without it)', fix('RTBX129').after, 'Ridhi Hand Block Print Tissue Box Cover Blue Floral Bunch 4.5x4.5x5 Inch');
}

console.log('== the real colours: the shape word stays when the title fits with it ==');
{
  eq('Taupe → "…Tissue Box Cover Square Taupe 4.5x4.5x5 Inch" (Square kept)', fix('RTBXT').after, 'Ridhi Hand Block Print Tissue Box Cover Square Taupe 4.5x4.5x5 Inch');
  // 46 + " Goldenrod Yellow" + the size = 78: nothing else may go (brand, print, product, colour, size), so the shape goes — the very last step
  eq('Goldenrod Yellow (78 with Square): the shape goes only as the very last step → 71', [fix('RTBXG').after, fix('RTBXG').after.length], ['Ridhi Hand Block Print Tissue Box Cover Goldenrod Yellow 4.5x4.5x5 Inch', 71]);
  eq('Light Steel Blue: "Light" is part of its colour, never a low-value word → the shape goes last', fix('RTBXB').after, 'Ridhi Hand Block Print Tissue Box Cover Light Steel Blue 4.5x4.5x5 Inch');
}

console.log('== filler in whole phrases; the shape is protected ==');
{
  const y = fix('RTCF');
  ok('"Cotton" first, then "Dining Table Cover" whole (never "Table" or "Dining" left behind); "Rectangle" kept', !y.held && /Rectangle Tablecloth/.test(y.after) && !/\b(?:Dining|Table|Cover)\b/.test(y.after.replace('Tablecloth', '')) && y.after.length <= 75, y.held || y.after);
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

console.log('== the rest of the sample: what material-first changes ==');
{
  const sample = A.rows.filter(r => !/^RTBX/.test(r.sku));
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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
