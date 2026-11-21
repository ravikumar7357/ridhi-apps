/* ROUND products' sizes (22 Nov 2026, listing-rules.js hTitleSizes / lrIsRound / lrSizeWant): on a round product one number WITH a
 * unit is the size (its diameter); everything else reads sizes exactly as before.
 *   node tests/round-size-test.js
 * Covers: the round sizes found ("110 Inch", '110"', "70 In", "90 Inches", "180 cm"); what is never a size ("100% Cotton", "Set of 4",
 * "4 Seater"); round by title, by Amazon's item_shape, by sub-category, and never when the title names another shape; "110x110 Inch"
 * on a round product → "110 Inch" (never the other way); rectangle / non-round unchanged; and the whole sample judged by the rules at
 * HEAD and now — only the round listings' findings change, "Missing size" goes away on them. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { SAMPLE, CAT, load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const NOW = Date.now();
const mk = (brand, parent, sku, title, extra) => Object.assign({ brand, parent, sku, asin: 'B0' + sku, title, qty: 5, price: 30, status: 'Active', channel: 'AFN',
  aplus: true, aplusAt: NOW, checked: NOW, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});

// round tablecloths (one family), one round only by its sub-category, one written 110x110, and a runner (not round) with "110 Inch"
const EXTRA = [
  mk('SP', 'PR', 'RTCR232-110', 'Ridhi Block Print Round Tablecloth Brown Meadow Vine 110 Inch 100% Cotton'),
  mk('SP', 'PR', 'RR90', 'Ridhi Block Print Round Tablecloth Blue Meadow Vine 90 Inches 100% Cotton'),
  mk('SP', 'PR', 'RR70', 'Ridhi Block Print Round Tablecloth Red Meadow Vine 70 In 100% Cotton'),
  mk('SP', 'PR', 'RRQ', 'Ridhi Block Print Round Tablecloth Green Meadow Vine 110" 100% Cotton'),
  mk('SP', 'PR', 'RRX', 'Ridhi Block Print Round Tablecloth Pink Meadow Vine 110x110 Inch 100% Cotton'),
  mk('SP', 'PS', 'RRS', 'Ridhi Block Print Tablecloth Yellow Meadow Vine 110 Inch 100% Cotton'),          // round by sub-category only
  mk('SP', 'PT', 'RUN110', 'Ridhi Table Runner Cotton 110 Inch Block Print for Dining Table - Blue'),     // NOT round
];
const EXTRA_CAT = {
  'RTCR232-110': { color: 'Brown', size: '110', subcat: 'Round Tablecloth' }, RR90: { color: 'Blue', size: '90', subcat: 'Round Tablecloth' },
  RR70: { color: 'Red', size: '70', subcat: 'Round Tablecloth' }, RRQ: { color: 'Green', size: '110', subcat: 'Round Tablecloth' },
  RRX: { color: 'Pink', size: '110', subcat: 'Round Tablecloth' }, RRS: { color: 'Yellow', size: '110', subcat: 'Round Tablecloth' },
  RUN110: { color: 'Blue', size: '14x110', subcat: 'Table Runner' },
};
const ROUND_SKUS = Object.keys(EXTRA_CAT).filter(k => k !== 'RUN110');
EXTRA.forEach(r => SAMPLE.push(r));
Object.assign(CAT.SP, EXTRA_CAT);

const EXPORT = '\n;globalThis.__R = { hTitleSizes, lrIsRound: typeof lrIsRound === "function" ? lrIsRound : null, lrSizeWant, lrTitleFix, lrTitleProblems,'
  + ' lrRoundTwo: typeof lrRoundTwo === "function" ? lrRoundTwo : null, lrSizeOurs, lrSizeOk, lrSizeLoose, setRound: v => { if (typeof LR_ROUND_ON !== "undefined") LR_ROUND_ON = v; } };';
const SRC_NOW = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'listing-rules.js'), 'utf8');
const SRC_HEAD = cp.execSync('git show HEAD:Pricing-App/src/app/listing/listing-rules.js', { cwd: path.join(__dirname, '..', '..') }).toString();
const open = src => { const A = load({ src: src + EXPORT }); const R = globalThis.__R; return { A, R }; };

console.log('== the sizes a title holds ==');
{
  const { R } = open(SRC_NOW);
  const S = (t, round) => R.hTitleSizes(t, round).map(s => s.text);
  eq('round "110 Inch" → a size (110)', R.hTitleSizes('Ridhi Block Print Round Tablecloth Brown Meadow Vine 110 Inch 100% Cotton'), [{ text: '110 Inch', a: 110, b: 110, c: null, one: true, round: true }]);
  eq('round \'110"\' → a size', S('Ridhi Round Tablecloth Green 110" 100% Cotton'), ['110"']);
  eq('round "70 In" → a size', S('Ridhi Round Tablecloth Red 70 In 100% Cotton'), ['70 In']);
  eq('round "90 Inches" → a size', S('Ridhi Round Tablecloth Blue 90 Inches'), ['90 Inches']);
  eq('round "180 cm" → a size', S('Ridhi Round Rug Jute 180 cm Natural'), ['180 cm']);
  eq('"100% Cotton", "Set of 4", "4 Seater" are never a size, even on a round product', S('Ridhi Round Placemats 100% Cotton Set of 4 for 4 Seater Table'), []);
  eq('"Set of 4 In Blue" is not a size (a number after "of")', S('Ridhi Round Coasters Set of 4 In Blue'), []);
  eq('round "110x110 Inch" is read as its W x H (and marked round)', R.hTitleSizes('Ridhi Round Tablecloth Pink 110x110 Inch'), [{ text: '110x110 Inch', a: 110, b: 110, c: null, round: true }]);
  eq('rectangle "60x90 Inch": exactly as before (no extra fields)', R.hTitleSizes('MY WHIMSICAL CORNER Tablecloth Rectangle Cotton 60x90 Inch Block Print Blue'), [{ text: '60x90 Inch', a: 60, b: 90, c: null }]);
  eq('a non-round title with "110 Inch": no size, as today', S('Ridhi Table Runner Cotton 110 Inch Block Print for Dining Table - Blue'), []);
  eq('"Round" with another shape named ("Square … for Round Table") is not round: W x H only', R.hTitleSizes('Ridhi Square Tablecloth 60x60 Inch for Round Table'), [{ text: '60x60 Inch', a: 60, b: 60, c: null }]);
  eq('round given by the listing (item_shape / sub-category), title without "Round": "110 Inch" found', S('Ridhi Block Print Tablecloth Yellow 110 Inch', true), ['110 Inch']);
  eq('round = false forces W x H only', S('Ridhi Round Tablecloth 110 Inch', false), []);
  ok('a round size reads "our way" ("110 Inch") and its short forms are loose forms', R.lrSizeOurs('110 Inch', null, '') && R.lrSizeOk('110 Inch', '14 x 36 Inch') && R.lrSizeLoose('110 In') && R.lrSizeLoose('110"') && !R.lrSizeLoose('110'));
}

console.log('== what is round ==');
{
  const { A, R } = open(SRC_NOW);
  const row = sku => A.rows.find(r => r.sku === sku);
  ok('title says Round → round', R.lrIsRound(row('RTCR232-110')) === true);
  ok('sub-category "Round Tablecloth", title without Round → round', R.lrIsRound(row('RRS')) === true);
  ok('Amazon item_shape Round → round', R.lrIsRound({ brand: 'SP', sku: 'Z', title: 'Ridhi Tablecloth 110 Inch', va: { item_shape: [{ value: 'Round' }] } }) === true);
  ok('a table runner → not round', R.lrIsRound(row('RUN110')) === false);
  ok('a title naming Square → never round, whatever else says round', R.lrIsRound({ brand: 'SP', sku: 'Z', title: 'Ridhi Square Tablecloth 60x60 Inch for Round Table', va: { item_shape: [{ value: 'Round' }] } }) === false);
}

console.log('== the rules on round titles ==');
{
  const { A, R } = open(SRC_NOW);
  const ctx = A.hCtx();
  const row = sku => A.rows.find(r => r.sku === sku);
  const found = sku => A.healthOf(row(sku), ctx).found.map(f => f.detector + ': ' + f.detail);
  ['RTCR232-110', 'RR90', 'RR70', 'RRQ', 'RRS'].forEach(sku => ok(`${sku}: no "Missing size"`, !found(sku).some(x => /Missing size/.test(x)), found(sku).join(' | ')));
  ok('RTCR232-110: no size-format, Inch or order finding either', !found('RTCR232-110').some(x => /^(size_format|dimension_order)|Missing "Inch"/.test(x)), found('RTCR232-110').join(' | '));
  const x = found('RRX').find(f => /^size_format/.test(f));
  ok('round "110x110 Inch" → size format: "a round size is one number: 110 Inch"', /"110x110 Inch" — a round size is one number: "110 Inch"/.test(x || ''), found('RRX').join(' | '));
  const fix = R.lrTitleFix(row('RRX'), ctx);
  eq('…and Fix suggests "110 Inch" (never the other way round)', [fix.after.includes(' 110 Inch '), fix.fixes.includes('Size: 110x110 Inch → 110 Inch')], [true, true]);
  const rfix = R.lrTitleFix(row('RTCR232-110'), ctx);
  ok('round "110 Inch": Fix leaves the size alone', !rfix.fixes.some(f => /Size|Missing size/.test(f)) && rfix.after.includes('110 Inch'), JSON.stringify(rfix.fixes));
  ok('round with no size at all, catalogue 110 → Fix adds "110 Inch"', (() => {
    const r = Object.assign({}, row('RTCR232-110'), { parent: 'PZ', title: 'Ridhi Block Print Round Tablecloth Brown Meadow Vine 100% Cotton' });   // a family of its own (a sized family has its own rule)
    r.content = Object.assign({}, r.content, { title: r.title });
    const p = R.lrTitleProblems(r, ctx).find(q => q.part === 'size');
    const f = R.lrTitleFix(r, ctx);
    return p && /110 Inch/.test(f.after) && f.fixes.includes('Missing size');
  })());
  ok('RUN110 (a runner, not round) with "110 Inch": still "Missing size", as today', found('RUN110').some(x => /Missing size/.test(x)), found('RUN110').join(' | '));
}

console.log('== the whole sample, judged by the rules at HEAD and now ==');
{
  const judge = src => {
    const { A } = open(src);
    const ctx = A.hCtx();
    const out = {};
    A.rows.forEach(r => { out[r.brand + '|' + r.sku] = A.healthOf(r, ctx).found.map(f => f.detector + ': ' + f.detail).sort(); });
    return out;
  };
  const before = judge(SRC_HEAD), after = judge(SRC_NOW);
  const changed = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const nonRound = changed.filter(k => !ROUND_SKUS.includes(k.split('|')[1]));
  eq('no finding changes on a non-round listing (the 19 sample listings + the runner)', nonRound, []);
  // the two ways a title with no size is reported: "Missing size" (title_template), or — in a family whose children name sizes —
  // "no size in the title; N sibling(s) name theirs" (variation_value_missing)
  const missing = j => Object.keys(j).filter(k => j[k].some(x => /Missing size|no size in the title/.test(x))).map(k => k.split('|')[1]).sort();
  console.log('    no size found (Missing size / no size in the title) before:', missing(before).join(', ') || '—', '· after:', missing(after).join(', ') || '—');
  eq('"Missing size" / "no size in the title" go away only on the round listings written with one number (RTCR232-110 among them)',
    missing(before).filter(s => !missing(after).includes(s)), ['RR70', 'RR90', 'RRQ', 'RRS', 'RTCR232-110']);
  ok('…and stays on the runner (not round)', missing(after).includes('RUN110'));
  const per = j => { const c = {}; Object.values(j).forEach(list => list.forEach(x => { const d = x.split(':')[0]; c[d] = (c[d] || 0) + 1; })); return c; };
  const pb = per(before), pa = per(after);
  const diff = [...new Set([...Object.keys(pb), ...Object.keys(pa)])].filter(d => (pb[d] || 0) !== (pa[d] || 0)).map(d => `${d} ${pb[d] || 0}→${pa[d] || 0}`);
  console.log('    per rule, changed:', diff.join(' · ') || 'none');
  ok('per rule: only the round listings move (title_template down by the round ones, size_format up by the one 110x110)', changed.every(k => ROUND_SKUS.includes(k.split('|')[1])) && diff.length > 0, diff.join(' · '));
}

console.log('== window.debugRoundSizes() (listing/debug-round.js) on the same sample ==');
{
  const dbg = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'debug-round.js'), 'utf8');
  const { R } = open(SRC_NOW + '\n' + dbg + '\n;globalThis.__D = debugRoundSizes;');
  const keep = [console.log, console.table];
  console.log = () => {}; console.table = () => {};
  let d;
  try { d = globalThis.__D(); } finally { [console.log, console.table] = keep; }
  eq('no size found: 6 before → 1 after (the runner)', [d.missingBefore, d.missingAfter], [6, 1]);
  eq('the listings that now have a size: the 5 round ones', d.gone.map(g => g.sku).sort(), ['RR70', 'RR90', 'RRQ', 'RRS', 'RTCR232-110']);
  eq('changed findings on non-round listings: none', d.nonRound, []);
  ok('every changed listing is round, with its reason (title says Round / sub-category Round Tablecloth)', d.changed.every(c => /title says Round|sub-category Round/.test(c.round)), d.changed.map(c => c.sku + ':' + c.round).join(' '));
  ok('round sizes are switched back on after it ran', R.hTitleSizes('Ridhi Round Tablecloth 110 Inch').length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
