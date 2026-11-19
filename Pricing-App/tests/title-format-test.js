/* OUR TITLE FORMAT (20 Nov 2026, the manager's decision): src/app/listing/listing-rules.js lrTitleProblems / lrTitleFix — the one rule
 * every title check and suggestion uses — over the real Listing Rules, Workspace, Fix all and Fix all titles, in a stub page.
 *   node tests/title-format-test.js
 * Our titles: "Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch" = Brand · Colour · Hand Block Print · Shape · Product ·
 * Size · Inch. A title keeps its own format and word order; only real mistakes are errors, each fixed with the smallest change. CPC is
 * judged and fixed exactly like Ridhi (no template needed). Colour names and our brand words are never "corrected". */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const wait = async (cond, n) => { for (let i = 0; i < (n || 400) && !cond(); i++) await new Promise(r => setTimeout(r, 1)); };

const COLOURS = ['Indigo Blue', 'Rust Orange', 'Sage Green', 'Verdant Mist', 'Harvest Gold', 'Rose Pink', 'Slate Grey', 'Ivory White', 'Coral Red', 'Teal Blue', 'Olive Green', 'Plum Purple'];
const KIDS = [
  { sku: 'A1', t: 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch', color: 'Amber Marigold', size: '54x54', sub: 'Square Tablecloth' },
  { sku: 'A2', t: 'Ridhi Harbor Blue Hand Block Print Rectange Tablecloth 60x108 Inch', color: 'Harbor Blue', size: '60x108', sub: 'Rectangle Tablecloth' },
  { sku: 'A3', t: 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 60x90 Inch', color: 'Amber Marigold', size: '60x90', sub: 'Rectangle Tablecloth' },
  { sku: 'A4', t: 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54', color: 'Amber Marigold', size: '54x54', sub: 'Square Tablecloth' },
  { sku: 'A5', t: 'Ridhi Tablecloth Rectangle Cotton 60x90 Inch Hand Block Print Verdant Mist', color: 'Verdant Mist', size: '60x90', sub: 'Rectangle Tablecloth' },
].concat(COLOURS.map((c, i) => ({ sku: 'G' + i, t: `Ridhi ${c} Hand Block Print Rectangle Tablecloth 60x90 Inch`, color: c, size: '60x90', sub: 'Rectangle Tablecloth' })));
const CPC = [{ sku: 'C1', t: 'CPC Sage Green Hand Block Print Rectangle Tablcloth 60x90 Inch', color: 'Sage Green', size: '60x90', sub: 'Rectangle Tablecloth' }]
  .concat(COLOURS.slice(0, 4).map((c, i) => ({ sku: 'D' + i, t: `CPC ${c} Hand Block Print Rectangle Tablecloth 60x90 Inch`, color: c, size: '60x90', sub: 'Rectangle Tablecloth' })));

function setup() {
  const C = load({ ws: true, sp: true, fa: true, lh: true, ctx: { imOnly() {}, leOnly() {}, leShow() {}, leListEnsure() {}, imListRender() {} } });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].TABLECLOTH = { at: Date.now(), ok: [], hl: { none: true } }; });
  const now = Date.now();
  const put = (b, parent, list) => {
    C.HEALTH[b].rows.length = 0;
    const cat = {};
    list.forEach(k => {
      C.HEALTH[b].rows.push({ brand: b, parent, sku: k.sku, asin: 'B0' + k.sku.padEnd(8, 'X'), title: k.t, qty: 5, price: 30, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
        content: { titleLen: k.t.length, images: 8, bullets: 5, descLen: 300, title: k.t } });
      cat[k.sku] = { subcat: k.sub, color: k.color, size: k.size };
      C.LI_WS.live[b][k.sku] = { at: now, cAt: now, pt: 'TABLECLOTH', title: k.t, titleLen: k.t.length, catTitle: k.t, tAt: now, kw: 'cotton', kwBytes: 6, bul: 5, desc: 300 };
      C.TT.read.set(b + '|' + k.sku, { va: { color: k.color, size: k.size, material: 'Cotton' }, pt: 'TABLECLOTH', at: now });
    });
    C.setCat(b, cat);
  };
  put('SP', 'PT', KIDS);
  put('CPC', 'PC', CPC);
  C.TT.readV++;
  C.LI_WS.liveV++;
  C.reset();
  return C;
}
const C = setup();
const ctx = () => C.hCtx();
const row = (b, sku) => C.HEALTH[b].rows.find(r => r.sku === sku);
const titleHits = (b, sku) => C.healthOf(row(b, sku), ctx()).found.filter(h => ['title_template', 'size_format', 'dimension_order', 'title_keyword', 'variation_naming'].includes(h.detector));
const fix = (b, sku) => C.lrTitleFix(row(b, sku), ctx());
const words = (a, b) => { const x = a.split(' '), y = b.split(' '); return x.length === y.length ? x.map((w, i) => (w === y[i] ? '' : `${w}→${y[i]}`)).filter(Boolean) : ['length ' + x.length + '→' + y.length]; };

console.log('== our format is right: no error, no change ==');
{
  const h = titleHits('SP', 'A1');
  const f = fix('SP', 'A1');
  ok('"Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch" → no title error', !h.length, h.map(x => x.name + ': ' + x.detail).join(' | '));
  ok('…and no change suggested', f.after === f.before && !f.fixes.length, JSON.stringify(f));
  const h5 = titleHits('SP', 'A5');
  ok('a title in ANOTHER word order is not an error either ("Ridhi Tablecloth Rectangle Cotton 60x90 Inch Hand Block Print Verdant Mist") — nothing is reordered', !h5.length && fix('SP', 'A5').after === row('SP', 'A5').title, h5.map(x => x.detail).join(' | '));
  ok('every one of the family\'s good titles: no title error', COLOURS.every((c, i) => !titleHits('SP', 'G' + i).length), COLOURS.map((c, i) => titleHits('SP', 'G' + i).map(x => x.detail).join()).filter(Boolean).join(' | '));
}

console.log('== only real mistakes, the smallest change ==');
{
  let h = titleHits('SP', 'A2'), f = fix('SP', 'A2');
  ok('"… Rectange Tablecloth 60x108 Inch" → the error says "Spelling: Rectange → Rectangle"', h.length === 1 && h[0].what === 'Spelling: Rectange → Rectangle', h.map(x => x.what || x.detail).join(' | '));
  ok('…the fix changes ONLY "Rectange" → "Rectangle", everything else identical', f.after === 'Ridhi Harbor Blue Hand Block Print Rectangle Tablecloth 60x108 Inch' && words(f.before, f.after).join() === 'Rectange→Rectangle', f.after);
  h = titleHits('SP', 'A3'); f = fix('SP', 'A3');
  ok('"… Square Tablecloth 60x90 Inch" → "Shape doesn\'t match size: Square → Rectangle"', h.some(x => x.what === "Shape doesn't match size: Square → Rectangle"), h.map(x => x.what || x.detail).join(' | '));
  ok('…the fix: the shape word only', f.after === 'Ridhi Amber Marigold Hand Block Print Rectangle Tablecloth 60x90 Inch' && words(f.before, f.after).join() === 'Square→Rectangle', f.after);
  h = titleHits('SP', 'A4'); f = fix('SP', 'A4');
  ok('"… Square Tablecloth 54x54" → "Missing "Inch" after the size"', h.some(x => x.what === 'Missing "Inch" after the size'), h.map(x => x.what || x.detail).join(' | '));
  ok('…the fix adds " Inch" only', f.after === 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch' && f.after === f.before + ' Inch', f.after);
  const r = Object.assign({}, row('SP', 'A1'), { shownTitle: 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54×54 Inch' });
  const fx = C.lrTitleFix(r, ctx());
  ok('a size written another way ("54×54 Inch") → the family\'s own way ("54x54 Inch"); "Inch" stays', fx.after === 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch', fx.after);
  const r2 = Object.assign({}, row('SP', 'A1'), { shownTitle: 'Ridhi Amber Marigold Hand Block Print Square Tablecloth Tablecloth 54x54 Inch' });
  const f2 = C.lrTitleFix(r2, ctx());
  ok('a word said twice → "Repeated word: Tablecloth", the second goes', C.lrTitleProblems(r2, ctx()).some(p => p.what === 'Repeated word: Tablecloth') && f2.after === 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch', f2.after);
  const r3 = Object.assign({}, row('SP', 'A1'), { shownTitle: 'Ridhi Hand Block Print Square Tablecloth 54x54 Inch' });
  const f3 = C.lrTitleFix(r3, ctx());
  ok('no colour → "Missing colour", added after the brand only (Brand · Colour · …)', C.lrTitleProblems(r3, ctx()).some(p => p.what === 'Missing colour') && f3.after === 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch', f3.after);
  const r4 = Object.assign({}, row('SP', 'A1'), { parent: '', shownTitle: 'Ridhi Amber Marigold Hand Block Print Square Tablecloth' });
  const f4 = C.lrTitleFix(r4, C.hCtx());
  ok('no size → "Missing size", added after the product, our way, with Inch', C.lrTitleProblems(r4, ctx()).some(p => p.what === 'Missing size') && f4.after === 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch', f4.after);
  // rule e: the family writes "60x90 Inch" — a child that writes "60 x 90 Inch" is told so, and only the size changes; "Inch" stays
  const t5 = 'Ridhi Indigo Blue Hand Block Print Rectangle Tablecloth 60 x 90 Inch', g0 = row('SP', 'G0'), was = g0.title, lv = C.LI_WS.live.SP.G0;
  g0.title = g0.content.title = lv.title = lv.catTitle = t5;
  C.LI_WS.liveV++; C.reset();
  const r5 = Object.assign({}, g0, { shownTitle: t5 });
  const h5 = C.healthOf(g0, ctx()).found.find(x => x.detector === 'size_format');
  g0.title = g0.content.title = lv.title = lv.catTitle = was;
  C.LI_WS.liveV++; C.reset();
  const f5 = C.lrTitleFix(r5, ctx());
  ok('a size written differently from the family → "Size written differently from the family", the size only, the family\'s way, Inch kept',
    !!h5 && /^Size written differently from the family: "60 x 90 Inch" — the family writes "60x90 Inch"$/.test(h5.what) && f5.after === 'Ridhi Indigo Blue Hand Block Print Rectangle Tablecloth 60x90 Inch', (h5 && h5.what) + ' · ' + f5.after);
  const r6 = Object.assign({}, row('SP', 'G0'), { shownTitle: 'Ridhi Indigo Blue Hand Block Print Rectangle Tablecloth 60x90 Inches' });
  ok('…"Inches" → "Inch" (never removed)', C.lrTitleFix(r6, ctx()).after === 'Ridhi Indigo Blue Hand Block Print Rectangle Tablecloth 60x90 Inch', C.lrTitleFix(r6, ctx()).after);
}

console.log('== colour names and our brand words are never "corrected" ==');
{
  const d = C.lrTitleProblems(row('SP', 'A5'), ctx()).filter(p => p.k === 'spell');
  ok('"Verdant Mist", "Marigold" (rare words, but the listing\'s colour) — no spelling finding', !d.length && !C.lrTitleProblems(row('SP', 'A1'), ctx()).some(p => p.k === 'spell'), JSON.stringify(d));
  const r = Object.assign({}, row('SP', 'A1'), { shownTitle: 'Ridhi Amber Marigolde Hand Block Print Square Tablecloth 54x54 Inch' });
  ok('…a word close to a colour of our catalogue is not touched either', !C.lrTitleProblems(r, ctx()).some(p => /Marigold/.test(p.what)) || C.lrTitleProblems(r, ctx()).every(p => p.k !== 'spell' || !/Marigold/.test(p.to)));
  ok('our brand words ("Ridhi", "CPC") are never a spelling mistake', !C.lrTitleProblems(row('CPC', 'D0'), ctx()).some(p => p.k === 'spell'));
}

console.log('== CPC: the same checks, the same Fix ==');
(async () => {
  const h = titleHits('CPC', 'C1');
  ok('a CPC title with a mistake ("Tablcloth") → "Spelling: Tablcloth → Tablecloth" — judged with no template, as Ridhi', h.some(x => x.what === 'Spelling: Tablcloth → Tablecloth'), h.map(x => x.what || x.detail).join(' | '));
  const rows = C.ttRows('CPC');
  const plans = C.ttPlans('CPC', rows, ctx());
  const p = plans.get('C1');
  ok('…Fix all titles has it ready to send (not held for "no title template"), the same minimal fix', !!p && p.ok && p.after === 'CPC Sage Green Hand Block Print Rectangle Tablecloth 60x90 Inch' && p.fixes.includes('Spelling: Tablcloth → Tablecloth'), p && JSON.stringify([p.ok, p.why, p.after, p.fixes]));
  const sp = C.ttPlans('SP', C.ttRows('SP'), ctx());
  ok('Ridhi\'s Fix all titles: Rectange, the shape and the Inch — each its own smallest fix', sp.get('A2').ok && sp.get('A2').after === 'Ridhi Harbor Blue Hand Block Print Rectangle Tablecloth 60x108 Inch'
    && sp.get('A3').ok && sp.get('A3').after === 'Ridhi Amber Marigold Hand Block Print Rectangle Tablecloth 60x90 Inch' && sp.get('A4').ok && sp.get('A4').after === 'Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch'
    && !sp.has('A1') && !sp.has('A5'), JSON.stringify([...sp.values()].map(x => [x.sku, x.ok, x.after, x.why])));
  const hit = C.healthOf(row('CPC', 'C1'), ctx()).found.find(x => x.detector === 'title_template');
  ok('…and its problem row has the same Fix button as Ridhi\'s (Listing Health)', !!hit && /data-lr-det="title_template"/.test(C.lrProblemHtml(hit, { brand: 'CPC', sku: 'C1' }) || ''), hit && C.lrProblemHtml(hit, { brand: 'CPC', sku: 'C1' }));
  ok('the fix sentence says what to change, keeping the rest', /Change only that — the title keeps its own words and order: "CPC Sage Green Hand Block Print Rectangle Tablecloth 60x90 Inch"/.test(hit.fix), hit.fix);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
