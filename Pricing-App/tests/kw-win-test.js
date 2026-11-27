/* SEARCH KEYWORDS — winning keywords + our house style (27 Nov 2026): listing/kw-win.js and the one suggestion-words rule
 * (listing-rules.js lrSuggestWords, search-terms mode) over the real Fix all search terms popup, Listing Content, ✨ AI and Create Listing.
 *   node tests/kw-win-test.js
 * The data is SAMPLE rows in Amazon's real download layouts (Brand Analytics → Top search terms with the "Top Clicked Brand" columns, the
 * older layout without them, Search Query Performance Brand view) — this machine cannot reach Seller Central, so no real report is here.
 * Two listings in our real title format: a Ridhi tablecloth and a Whimsical Corner (CPC) napkin set; their before → after is printed. */
const cp = require('child_process');
const path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const bytes = s => Buffer.byteLength(String(s).replace(/[\s;,.]+/g, ''), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 1)); };

// ---- Amazon's Top search terms download (2023+ layout: brands and categories, then the 3 clicked products) ----
const HEAD = 'Search Frequency Rank,Search Term,Top Clicked Brand #1,Top Clicked Brands #2,Top Clicked Brands #3,Top Clicked Category #1,Top Clicked Category #2,Top Clicked Category #3,'
  + [1, 2, 3].map(n => `Top Clicked Product #${n}: ASIN,Top Clicked Product #${n}: Product Title,Top Clicked Product #${n}: Click Share,Top Clicked Product #${n}: Conversion Share`).join(',') + ',Reporting Date';
const row = (rank, term, prods) => [rank, term, ...[0, 1, 2].map(i => (prods[i] ? `"${prods[i][0]}"` : '')), 'Home & Kitchen', prods[1] ? 'Home & Kitchen' : '', prods[2] ? 'Home & Kitchen' : '',
  ...[0, 1, 2].flatMap(i => (prods[i] ? [prods[i][1], `"${prods[i][2]}"`, prods[i][3], prods[i][4]] : ['', '', '', ''])), '11/21/2026'].join(',');
const MAISON = "Maison d' Hermine";
const TERMS_CSV = ['Reporting Range=["Weekly"],Select week=["Week 47 | 2026-11-15 - 2026-11-21 2026"]', HEAD,
  row(12400, 'farmhouse tablecloth rectangle', [[MAISON, 'B0MAISON01', "Maison d' Hermine Colmar 100% Cotton Tablecloth 60 x 90 Inch", 18.2, 22.1], ['Etopia', 'B0ETOPIA01', 'Etopia Rectangle Tablecloth Farmhouse', 9.1, 8.0], ['Angry Orange', 'B0ANGRY001', 'Angry Orange Tablecloth', 5.0, 4.1]]),
  row(3100, 'boho tablecloth', [['Etopia', 'B0ETOPIA02', 'Etopia Boho Tablecloth', 20.0, 15.0]]),
  row(5200, 'round tablecloth floral', [['Angry Orange', 'B0ANGRY002', 'Angry Orange Round Floral Tablecloth', 30, 25]]),
  row(8800, 'white tablecloth', [['Lahome', 'B0LAHOME01', 'Lahome White Tablecloth', 30, 25]]),
  row(9900, 'waterproof tablecloth', [['Lahome', 'B0LAHOME02', 'Lahome Waterproof Tablecloth', 30, 25]]),
  row(13000, 'linen tablecloth', [['Lahome', 'B0LAHOME03', 'Lahome Linen Tablecloth', 30, 25]]),
  row(14000, 'tablecloth 70 x 120', [['Lahome', 'B0LAHOME04', 'Lahome Tablecloth 70x120', 30, 25]]),
  row(16000, 'christmas tablecloth buffalo plaid', [['Angry Orange', 'B0ANGRY003', 'Angry Orange Christmas Tablecloth', 30, 25]]),
  row(18000, 'thanksgiving tablecloth vintage', [['Etopia', 'B0ETOPIA05', 'Etopia Vintage Tablecloth', 1.0, 0.5]]),      // nobody wins it (shares too small)
  row(20000, 'block print tablecloth', [['Ridhi', 'B0RIDHI001', 'Ridhi Hand Block Print Tablecloth', 40, 35]]),           // we win it: not a competitor's win
  row(22000, 'etopia tablecloth', [['Etopia', 'B0ETOPIA03', 'Etopia Tablecloth', 40, 35]]),
  row(7400, 'cloth napkins farmhouse wedding', [['Etopia', 'B0ETOPIA04', 'Etopia Cloth Napkins Set of 6', 14, 12], [MAISON, 'B0MAISON02', "Maison d' Hermine Napkins", 9, 7]]),
  row(15000, 'cotton napkins cloth washable', [['Etopia', 'B0ETOPIA06', 'Etopia Cotton Napkins', 14, 12]]),
  row(21000, 'linen napkins', [['Etopia', 'B0ETOPIA07', 'Etopia Linen Napkins', 14, 12]]),
  row(17000, 'thanksgiving napkins fall', [['Angry Orange', 'B0ANGRY004', 'Angry Orange Fall Napkins', 14, 12]]),
  row(19000, 'napkin rings set', [['Angry Orange', 'B0ANGRY005', 'Angry Orange Napkin Rings', 14, 12]]),
  row(25000, 'organic cotton napkins', [['Etopia', 'B0ETOPIA08', 'Etopia Organic Napkins', 14, 12]]),
  row(27000, 'napkins boho green', [['Angry Orange', 'B0ANGRY006', 'Angry Orange Boho Napkins Green', 14, 12]]),
].join('\n');
// the older layout: "#1 Clicked ASIN", "#1 Product Title", shares with %, no brand column
const OLD_CSV = 'Department,Search Term,Search Frequency Rank,#1 Clicked ASIN,#1 Product Title,#1 Click Share,#1 Conversion Share,#2 Clicked ASIN,#2 Product Title,#2 Click Share,#2 Conversion Share,#3 Clicked ASIN,#3 Product Title,#3 Click Share,#3 Conversion Share\n'
  + 'Amazon.com,placemats set of 4 boho,9100,B0ANGRY009,"Angry Orange Boho Placemats",12.50%,10.00%,B0XX000001,"Bohemian Home Placemats",5.00%,3.00%,,,,\n'
  + 'Amazon.com,table runner farmhouse,9300,B0ETOPIA09,"Etopia Farmhouse Table Runner",11.00%,9.00%,,,,,,,,\n';
// Search Query Performance, Brand view
const SQP_CSV = 'Brand=["Ridhi"],Reporting Range=["Weekly"],Select week=["Week 47 | 2026-11-15 - 2026-11-21 2026"]\n'
  + 'Search Query,Search Query Score,Search Query Volume,Impressions: Total Count,Impressions: Brand Count,Impressions: Brand Share %,Clicks: Total Count,Clicks: Click Rate %,Clicks: Brand Count,Clicks: Brand Share %,Purchases: Total Count,Purchases: Purchase Rate %,Purchases: Brand Count,Purchases: Brand Share %,Reporting Date\n'
  + 'farmhouse tablecloth rectangle,1,48210,900000,1876,0.21,10420,1.2,13,0.12,610,0.07,2,0.33,11/21/2026\n'
  + 'boho tablecloth,2,120400,2100000,940,0.04,30100,1.4,4,0.01,1800,0.09,0,0,11/21/2026\n';

// ---- the two listings, in our real title format ----
const T1 = { brand: 'SP', sku: 'RTC6090-IND', asin: 'B0RTCIND01', parent: 'P-RTC', pt: 'TABLECLOTH', color: 'Indigo Blue', size: '60x90', subcat: 'Rectangle Tablecloth',
  title: 'Ridhi Indigo Blue Hand Block Print Rectangle Tablecloth 60x90 Inch',
  kw: 'ridhi tablecloth tablecloths 100% cotton cotton table cover indigo blue dining kitchen wrinkle free hand block print block print etopia style rectangular '
    + 'oblong dinner party housewarming gift for her the a indian decor table linen picnic brunch everyday washable thanksgiving christmas holiday spring summer '
    + 'outdoor patio garden wedding reception banquet buffet bridal shower anniversary festive' };
const N1 = { brand: 'CPC', sku: 'CPN18-SAGE6', asin: 'B0CPNSAGE1', parent: 'P-CPN', pt: 'NAPKIN', color: 'Sage Green', size: '18x18', subcat: 'Napkin Set',
  title: 'Whimsical Corner Sage Green Hand Block Print Cloth Napkins 18x18 Inch Set of 6',
  kw: 'cpc cotton print club napkins napkin cotton sage green dinner party washable reusable whimsical corner cotton print club angry orange maison serviettes' };

// ---- our own Sponsored Products search terms, in the nightly srchTerm cache's shape ({ t, ag, cid, kw, mt, i, c, sp, o, s }) and adGroup's ----
const st = (t, ag, c, o, sp, s) => ({ t, ag, cid: 'C1', kw: t, mt: 'BROAD', i: c * 40, c, sp, o, s });
const PPC = {
  SP: { from: '2026-10-27', to: '2026-11-25', rows: [st('farmhouse tablecloth', 'AG1', 120, 14, 60, 400), st('scalloped tablecloth', 'AG1', 40, 3, 20, 90), st('vintage tablecloth', 'AG1', 20, 1, 10, 30),
    st('round tablecloth', 'AG1', 50, 5, 20, 150), st('red tablecloth', 'AG1', 30, 4, 15, 120), st('etopia tablecloth', 'AG1', 25, 6, 12, 160), st('b0abcdefgh', 'AG1', 9, 3, 5, 80),
    st('indigo tablecloth', 'AG1', 30, 5, 10, 140), st('christmas gnome tablecloth', 'AG1', 30, 5, 10, 140), st('bistro tablecloth', 'AG1', 30, 3, 90, 40),
    st('harvest tablecloth napkins', 'AG2', 60, 9, 20, 300)] },
  CPC: { from: '2026-10-27', to: '2026-11-25', rows: [st('cloth napkins sage', 'AG3', 50, 4, 10, 120), st('napkins rustic wedding', 'AG3', 70, 7, 20, 220)] },
};
const AG = { SP: { groups: { AG1: { n: 'RTC indigo', cn: 'SP auto', a: ['B0RTCIND01'] }, AG2: { n: 'mixed', cn: 'SP mixed', a: ['B0RTCIND01', 'B0CPNSAGE1'] } } },
  CPC: { groups: { AG3: { n: 'Sage napkins', cn: 'CPC auto', a: ['B0CPNSAGE1'] } } } };

function setup(o) {
  o = o || {};
  const C = load({ ws: true, sp: true, fa: true, ai: true, le: true, ctx: Object.assign({ imOnly() {}, imListRender() {} }, o.ctx || {}),
    baCall: o.baCall || (async q => (q.lfix === 'get' ? { productType: q.sku === N1.sku ? 'NAPKIN' : 'TABLECLOTH', status: ['BUYABLE'], attributes: { generic_keyword: [{ value: (q.sku === N1.sku ? N1 : T1).kw }] } } : {})) });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.FA.log = [];
  const now = Date.now();
  [T1, N1].forEach(L => {
    ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b][L.pt] = { at: now, ok: [], hl: { none: true } }; });
    C.HEALTH[L.brand].rows.push({ brand: L.brand, parent: L.parent, sku: L.sku, asin: L.asin, title: L.title, qty: 5, price: 30, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
      content: { titleLen: L.title.length, images: 8, bullets: 5, descLen: 300, title: L.title } });
    C.setCat(L.brand, { [L.sku]: { subcat: L.subcat, color: L.color, size: L.size } });
    C.LI_WS.live[L.brand][L.sku] = { at: now, cAt: now, pt: L.pt, title: L.title, titleLen: L.title.length, catTitle: L.title, tAt: now, kw: L.kw, kwBytes: bytes(L.kw), bul: 5, desc: 300 };
  });
  C.LI_WS.liveV++;
  C.reset();
  if (o.data !== false) {
    const p = C.kwParse(TERMS_CSV), q = C.kwParse(OLD_CSV);
    C.kwUse({ terms: C.kwMerge(p.rows, q.rows).rows, to: o.to || p.to, sqp: { SP: C.kwParse(SQP_CSV).rows } });
  } else C.kwUse({});
  if (o.ppc === true) C.kwUsePpc({ terms: PPC, groups: AG, days: 30, src: 'srchTerm' });
  else if (o.ppc === 'none') C.kwUsePpc(null);
  return C;
}
const facts = (C, L) => C.lrSwFacts({ brand: L.brand, sku: L.sku }, null, null, { title: L.title, pt: L.pt });
const fits = t => bytes(t) <= 249;
const winOf = (C, L, text) => C.kwWinFor({ brand: L.brand, sku: L.sku, title: L.title, kw: text, facts: facts(C, L), pt: L.pt });
const suggest = (C, L, text, extra) => C.lrSuggestWords(text, Object.assign({ mode: 'kw', facts: facts(C, L), title: L.title, brands: C.lrBrandWords({ brand: L.brand }, C.getLR()),
  others: C.kwOthers(C.getLR()), add: winOf(C, L, text).words, proof: winOf(C, L, text).proof, fits }, extra || {}));
const keysOf = t => String(t).toLowerCase().split(/\s+/).filter(Boolean);

(async () => {
  console.log('== the files: Amazon\'s download layouts are read, never guessed ==');
  {
    const C = setup({ data: false });
    const p = C.kwParse(TERMS_CSV);
    const f = p.rows.find(r => r.q === 'farmhouse tablecloth rectangle');
    ok('Top search terms (2023+ layout): every search, its rank, the 3 clicked products with brand, click share and conversion share as fractions; the report\'s week end',
      p.ok && p.kind === 'terms' && p.rows.length === 18 && f.r === 12400 && f.p.length === 3 && f.p[0].b === MAISON && f.p[0].a === 'B0MAISON01' && Math.abs(f.p[0].c - 0.182) < 1e-9 && Math.abs(f.p[0].v - 0.221) < 1e-9 && p.to === '2026-11-21',
      JSON.stringify([p.ok, p.rows.length, f && f.p[0], p.to]));
    const q = C.kwParse(OLD_CSV);
    ok('…the older layout (#1 Clicked ASIN, shares with %, no brand column) too', q.ok && q.kind === 'terms' && q.rows.length === 2 && q.rows[0].p[0].b === '' && Math.abs(q.rows[0].p[0].v - 0.10) < 1e-9, JSON.stringify(q.rows[0]));
    const s = C.kwParse(SQP_CSV);
    ok('Search Query Performance (Brand view): our clicks and purchases per search', s.ok && s.kind === 'sqp' && s.rows[0].q === 'farmhouse tablecloth rectangle' && s.rows[0].c === 13 && s.rows[0].o === 2 && s.rows[0].vol === 48210, JSON.stringify(s.rows[0]));
    const bad = C.kwParse('Order ID,SKU,Quantity\n1,2,3');
    ok('another file is refused, naming what it is not', !bad.ok && /neither Brand Analytics "Top search terms"/.test(bad.err));
    const m = C.kwMerge(p.rows, [{ q: 'boho tablecloth', r: 2000, p: [] }, { q: 'new search', r: 1, p: [] }]);
    ok('a new upload replaces the searches it shares — never counted twice', m.rows.length === 19 && m.replaced === 1 && m.added === 1 && m.rows.find(r => r.q === 'boho tablecloth').r === 2000);
    const msg = await C.kwUpload(TERMS_CSV, 'tablecloth.csv', 'SP');
    ok('an upload says what it read (on the test site: kept in this visit only)', /Top search terms: 18 searches read \(up to 21 Nov 2026\) · 18 new, 0 already there/.test(msg) && C.KW.terms.rows.length === 18, msg);
  }

  console.log('== who wins, per product type ==');
  const C = setup();
  {
    const md = C.kwModel();
    const tc = md.types.get('tablecloth').map(t => t.q);
    ok('searches grouped by product type (tablecloth, napkin, placemat, runner) — "napkin rings" are read as napkins too, then skipped as not a napkin', md.types.has('tablecloth') && md.types.has('napkin') && md.types.has('placemat') && md.types.has('runner'), [...md.types.keys()].join());
    const fh = md.types.get('tablecloth').find(t => t.q === 'farmhouse tablecloth rectangle');
    ok('"farmhouse tablecloth rectangle": won by Maison d\' Hermine (the brand column), competitors\' conversion share 34 %', fh.wins && fh.top.brand === MAISON && Math.abs(fh.cv - 0.342) < 1e-9, JSON.stringify([fh.top.brand, fh.cv]));
    ok('a search we win ourselves ("block print tablecloth", Ridhi) is not a competitor\'s win; one with tiny shares is not a win either', !md.types.get('tablecloth').find(t => t.q === 'block print tablecloth').wins && !md.types.get('tablecloth').find(t => t.q === 'thanksgiving tablecloth vintage').wins);
    const pl = md.types.get('placemat')[0];
    ok('no brand column: the brand is a watched brand in the title (Angry Orange), else the title\'s first words — marked as a guess', pl.top.brand === 'Angry Orange' && pl.top.sure && pl.comp[1].brand === 'Bohemian' && !pl.comp[1].sure, JSON.stringify(pl.comp.map(p => [p.brand, p.sure])));
    ok('best first: competitors\' conversion share ÷ search rank ("boho tablecloth" rank 3,100 before "farmhouse…" rank 12,400)', tc.indexOf('boho tablecloth') < tc.indexOf('farmhouse tablecloth rectangle'), tc.join(' | '));
    ok('SQP: our own clicks / purchases sit on the search', fh.sqp.SP && fh.sqp.SP.o === 2);
  }

  console.log('== rule 0: our brands, important words, duplicates (search terms only) ==');
  {
    const r = suggest(C, N1, N1.kw);
    const out = keysOf(r.after);
    const count = w => out.filter(x => x === w).length;
    ok('OUR BRANDS kept, ONE time each: CPC, Cotton Print Club, Whimsical Corner (never taken out — they were before)', count('cpc') === 1 && /cotton print club/.test(r.after) && /whimsical corner/.test(r.after) && count('club') === 1 && count('whimsical') === 1, r.after);
    ok('…"Ridhi" too: our brand in a Ridhi listing\'s search terms stays once', (() => { const t = suggest(C, T1, 'ridhi ridhi tablecloth cotton'); return keysOf(t.after).filter(x => x === 'ridhi').length === 1 && t.removed.some(x => x.w === 'ridhi' && x.why === 'repeated'); })());
    ok('IMPORTANT WORDS kept once: napkins (product), sage green (colour), washable / reusable / dinner (use words) — a second "napkin" (plural = same word) and "cotton" out as duplicates',
      ['napkins', 'sage', 'green', 'washable', 'reusable', 'dinner'].every(w => count(w) === 1) && !out.includes('napkin') && count('cotton') === 1 && r.removed.filter(x => x.why === 'repeated').map(x => x.w).join() === 'napkin,cotton,cotton,print,club', JSON.stringify(r.removed));
    ok('OTHER BRANDS out: "angry orange", "maison" (the watched brands) — "Other brand" in the popup', r.removed.filter(x => x.why === 'other brand').map(x => x.w).join() === 'angry,orange,maison' && C.kwWhyLabel('other brand') === 'other brand', JSON.stringify(r.removed));
    const t = suggest(C, T1, T1.kw);
    const tk = keysOf(t.after);
    ok('a phrase said twice is kept once ("block print … block print"); tablecloth / tablecloths count as one word', tk.filter(w => w === 'block').length === 1 && tk.filter(w => w === 'print').length === 1 && tk.filter(w => /^tablecloths?$/.test(w)).length === 1, t.after);
    ok('hand, block print, its product, real shape (rectangular), material, own colour, wrinkle free — all kept, 🔒 protected', ['hand', 'block', 'print', 'tablecloth', 'rectangular', 'cotton', 'indigo', 'blue', 'wrinkle', 'free'].every(w => tk.includes(w))
      && t.toks.filter(x => x.cls && !x.out).map(x => x.cls).includes('brand'), t.after);
    ok('"etopia" (another brand) out — and "style" after it stays an ordinary word', t.removed.some(x => x.w === 'etopia' && x.why === 'other brand'), JSON.stringify(t.removed.slice(0, 6)));
    const title = C.lrSuggestWords('Ridhi Ridhi Napkins Napkins Cotton', { mode: 'title', facts: facts(C, N1) });
    ok('titles untouched by rule 0: a title within its limit is returned exactly as written (the title rules are their own)', title.after === 'Ridhi Ridhi Napkins Napkins Cotton' && !title.removed.length);
  }

  console.log('== winning words: added when missing, never a brand, a title word, another shape / colour / size / material ==');
  {
    const w = C.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(C, T1), pt: T1.pt });
    const words = w.words.map(x => x.w);
    ok('the tablecloth (indigo blue rectangle cotton 60x90): "boho" and "farmhouse" — each with why (not "buffalo plaid": a Christmas search, and a pattern it is not)', w.type === 'tablecloth' && words.join() === 'boho,farmhouse'
      && w.words[1].why === "wins for Maison d' Hermine on 'farmhouse tablecloth rectangle', search rank 12,400", JSON.stringify(w.words.map(x => x.w + ': ' + x.why)));
    ok('skipped whole: a search for another shape (round), colour (white), material (linen), size (70 x 120), what it is not (waterproof)', !words.some(x => /round|floral|white|linen|waterproof|70|120/.test(x)), words.join());
    ok('never a season search (christmas … — the Season planner adds those), never a brand (etopia, lahome…), never a product word', !words.some(x => /christmas|buffalo|plaid|vintage|etopia|lahome|maison|tablecloth|table/.test(x)), words.join());
    const plaid = C.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: 'plaid', facts: facts(C, T1), pt: T1.pt });
    ok('…a season search stays out even when the listing says its pattern ("plaid" in its search terms)', !plaid.words.some(x => /buffalo/.test(x.w)), plaid.words.map(x => x.w).join());
    const n = C.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw, facts: facts(C, N1), pt: N1.pt });
    ok('the napkins (sage green, cotton, 18x18): "farmhouse", "wedding", "boho" — not "organic" (a restricted claim), not "rings" (not a napkin), not "linen", not "fall"',
      n.type === 'napkin' && n.words.map(x => x.w).join() === 'farmhouse,wedding,boho' && !n.words.some(x => /organic|ring|linen|fall|thanksgiving/.test(x.w)), JSON.stringify(n.words.map(x => x.w)));
    const nT = C.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title + ' Farmhouse', kw: N1.kw, facts: facts(C, N1), pt: N1.pt });
    ok('a word the TITLE already says is never added (Amazon indexes the title): "farmhouse" in the title → not offered', !nT.words.some(x => x.w === 'farmhouse'), nT.words.map(x => x.w).join());
    const nK = C.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw + ' wedding', facts: facts(C, N1), pt: N1.pt });
    ok('…nor one the search terms already hold ("wedding")', !nK.words.some(x => x.w === 'wedding'));
    const r = suggest(C, N1, N1.kw);
    ok('the napkins\' new search terms: the 3 winning words ADDED at the end (they fit), duplicates and other brands out', r.added.map(a => a.w).join() === 'farmhouse,wedding,boho' && / farmhouse wedding boho$/.test(r.after) && fits(r.after), r.after);
    ok('never another brand added: Angry Orange / Etopia / Maison / Lahome are never in what is added', !r.added.some(a => /angry|orange|etopia|maison|hermine|lahome/i.test(a.w)));
    const forced = C.lrSuggestWords('napkins sage green', { mode: 'kw', facts: facts(C, N1), title: N1.title, others: C.kwOthers(C.getLR()), add: [{ w: 'Napkins', why: 'x' }, { w: 'green', why: 'x' }, { w: 'and', why: 'x' }, { w: 'B0ABCDEFGH', why: 'x' }], fits });
    ok('the rule itself never adds a word the text has (plural too), a joining word or an ASIN', forced.added.length === 0 && forced.after === 'napkins sage green', forced.after);
  }

  console.log('== the 249-byte limit: what goes first to make room ==');
  {
    const r = suggest(C, T1, T1.kw);
    const why = r.removed.map(x => x.w + ':' + x.why);
    ok('the tablecloth (over the limit): ≤ 249 bytes after — duplicates, other brands, low-value / joining words go before any winning word', fits(r.after) && bytes(T1.kw) > 249
      && ['tablecloths:repeated', 'cotton:repeated', 'etopia:other brand', 'gift:low-value word', 'indian:low-value word', 'for:leftover', 'her:leftover', 'the:leftover', 'a:leftover'].every(x => why.includes(x)), JSON.stringify([bytes(T1.kw), bytes(r.after), why]));
    const order = r.removed.slice().sort((a, b) => a.n - b.n);
    const firstCut = order.findIndex(x => x.why === 'cut to fit' || x.why === 'in the title');
    const lastLow = Math.max(order.map(x => x.why).lastIndexOf('low-value word'), order.map(x => x.why).lastIndexOf('leftover'));
    const addCut = order.filter(x => x.why === 'limit');
    ok('…then the ADDED words, the weakest first ("farmhouse", then "boho"), before any of the listing\'s own words is cut', lastLow < firstCut
      && r.toks.filter(t => t.added).sort((a, b) => a.n - b.n).map(t => t.w).join() === 'farmhouse,boho' && order.findIndex(x => x.why === 'cut to fit') > -1, JSON.stringify([r.notAdded, addCut]));
    // (1 Dec 2026) low value and the leftovers (style, for, her, the, a) go first — so only 4 of its own words are cut to fit, and the
    // Brand Analytics words (they never push its own words out) find no room left
    ok('…the listing\'s own words keep their place: only 4 cut to fit (bridal, shower, anniversary, festive); boho and farmhouse not added (no room)', r.removed.filter(x => x.why === 'cut to fit').map(x => x.w).join() === 'bridal,shower,anniversary,festive' && r.notAdded.map(a => a.w).sort().join() === 'boho,farmhouse' && !r.added.length && fits(r.after) && r.removed.filter(x => x.why === 'leftover').map(x => x.w).join() === 'style,for,her,the,a', JSON.stringify([r.after, r.removed.filter(x => /leftover|cut/.test(x.why)).map(x => x.w)]));
    ok('…and only then the listing\'s own ordinary words, from the end — never our brand or an important word', !r.removed.some(x => x.why === 'cut to fit' && /^(ridhi|hand|block|print|tablecloth|cotton|indigo|blue|rectangular|dining|kitchen)$/.test(x.w)), JSON.stringify(r.removed.filter(x => x.why === 'cut to fit').map(x => x.w)));
    let kwNS = 'ridhi cpc whimsical corner hand block print blockprint handmade napkins cotton sage green dinner kitchen dining washable reusable wrinkle free';
    for (let i = 10; bytes(kwNS) <= 260; i++) kwNS += ` ${i}x${i}`;
    // (30 Nov 2026) only the product's OWN size is protected — so these padding sizes are protected only while its size is not known
    const noSize = Object.assign({}, facts(C, N1), { size: '' });
    const ns = suggest(C, N1, kwNS, { facts: noSize });
    ok('only our brands + important words left and still over → nothing cut, no word added: "Only important words left — edit by hand"', ns.important && !ns.fits && !ns.removed.length && !ns.added.length && ns.after === kwNS, JSON.stringify([bytes(ns.after), ns.removed]));
    const kp = C.kfShorten(kwNS, { title: N1.title, brands: ['ridhi', 'cpc', 'whimsical corner'], facts: noSize });
    ok('…Fix all search terms holds it with the same words', kp.important && C.kfPlan({ key: 'k', brand: 'CPC', sku: N1.sku, kw: kwNS, title: N1.title, brands: ['cpc'], facts: noSize, full: true, pt: 'NAPKIN' }).why === 'Only important words left — edit by hand');
    const C2 = setup();
    C2.KF.full.set('SP|' + T1.sku, { kw: T1.kw, pt: 'TABLECLOTH', at: Date.now() });          // read whole from Amazon (its product type known)
    const it = C2.kfItemOf('SP', C2.HEALTH.SP.rows.find(x => x.sku === T1.sku), C2.hCtx(), null);
    const plan = C2.kfPlan(it);
    ok('Fix all search terms (kfPlan) sends only generic_keyword — the title, bullets and description are never in the patch', plan.ok && plan.patches.length === 1 && plan.patches[0].path === '/attributes/generic_keyword' && plan.b1 <= 249, JSON.stringify([plan.ok, plan.why, plan.patches]));
    ok('its plan of the over-limit tablecloth: "Shorten to 248 bytes" (no room left for a Brand Analytics word)', /^Shorten to 248 bytes$/.test(plan.what) && !plan.added.length, plan.what);
  }

  console.log('== the preview (Fix all search terms popup): + added with why, struck words with their reason, 🔒 protected, bytes ==');
  {
    const C3 = setup();
    // a napkin set within the limit has no "over the limit" row — the popup is the Fix all one, opened for one child with a risky word
    const row = C3.HEALTH.CPC.rows.find(x => x.sku === N1.sku);
    C3.LI_WS.live.CPC[N1.sku] = Object.assign({}, C3.LI_WS.live.CPC[N1.sku], { kw: N1.kw + ' ' + 'z'.repeat(200), kwBytes: bytes(N1.kw) + 200 });
    C3.LI_WS.liveV++; C3.reset();
    C3.KF.full.set('CPC|' + N1.sku, { kw: N1.kw + ' ' + 'z'.repeat(200), pt: 'NAPKIN', at: Date.now() });   // read whole (its product type known)
    const it = C3.kfItemOf('CPC', row, C3.hCtx(), null);
    C3.kfPreview([it], { title: 'Sage napkins', brand: 'CPC', parent: N1.parent });
    await settle();
    const html = C3.el('spModalBox').innerHTML;
    const s = strip(html);
    ok('the data line: "🏆 Winning keywords: Brand Analytics up to 21 Nov 2026 … · N winning words added"', /🏆 Winning keywords: Brand Analytics up to 21 Nov 2026/.test(s) && /words? added/.test(s), s.slice(0, 600));
    ok('a removed word struck through with its reason: duplicate, other brand, limit', /<s class="kf-cut" title="duplicate">napkin<\/s><small class="kf-why">duplicate<\/small>/.test(html) && /<s class="kf-cut" title="other brand">angry<\/s>/.test(html) && /title="limit">z{200}<\/s>/.test(html), (html.match(/<div class="kf-text">[\s\S]*?<\/div>/) || [''])[0].slice(0, 1500));
    ok('our brands and important words shown protected 🔒 (with what they are on hover)', /<span class="kf-lock" title="protected: our brand">🔒cpc<\/span>/.test(html) && /title="protected: its product">🔒napkins/.test(html) && /title="protected: its colour">🔒sage/.test(html), html.match(/kf-lock[^<]*<\/span>/g) && html.match(/kf-lock[^<]*<\/span>/g).slice(0, 6).join(' '));
    ok('each added word marked "+ farmhouse (wins for … on \'cloth napkins farmhouse wedding\', search rank 7,400)"', /<ins class="kf-add">\+ farmhouse<\/ins> <span class="muted">\(wins for Etopia on 'cloth napkins farmhouse wedding', search rank 7,400\)<\/span>/.test(html.replace(/&#39;/g, "'")), (html.match(/kf-adds[\s\S]{0,400}/) || [''])[0]);
    ok('bytes before → after, within the limit', /<span class="err">\d+<\/span> → <span class="ok" data-kf-n="CPC\|CPN18-SAGE6">\d+<\/span> bytes/.test(html));
    C3.kfClick({ dataset: { kf: 'cancel' } });
  }

  console.log('== ✨ AI kw: the winning words are sent; its answer goes through the same rule before it is shown ==');
  {
    const c = C.aiCtx(N1.brand, N1.sku);
    const before = N1.kw;
    const cl = C.aiKwClean(c, 'cpc napkins napkin sage green etopia boho farmhouse cloth set inch whimsical corner whimsical corner b0abcdefgh organic ' + 'x'.repeat(250), before);
    const why = cl.removed.map(x => x.w + ':' + x.why).join(' ');
    ok('the AI answer re-checked: duplicate (napkin, whimsical corner twice), other brand (etopia), title words it added (cloth, set, inch), ASIN, restricted claim, limit',
      /napkin:duplicate/.test(why) && /etopia:other brand/.test(why) && /cloth:limit — the title already says it/.test(why) && /set:limit — the title already says it/.test(why) && /b0abcdefgh:ASIN/.test(why) && /x{250}:limit/.test(why) && fits(cl.text), why);
    ok('…our brand (cpc, whimsical corner) and the important words stay once', keysOf(cl.text).filter(w => w === 'cpc').length === 1 && keysOf(cl.text).filter(w => w === 'whimsical').length === 1 && /napkins sage green/.test(cl.text), cl.text);
    const opts = C.aiWinWords(c, before).map(x => x.w);
    ok('the words sent with the question (&win=): the winning words of its product type, best first', opts.join() === 'farmhouse,wedding,boho', opts.join());
    const chk = C.aiCheck(c, 'kw', cl.text, {});
    ok('…and the cleaned answer passes our checks (no "our brand name" fail any more)', !chk.fails.some(f => /our brand|said twice|already in the title|bytes/.test(f)), chk.fails.join(' | '));
  }

  console.log('== no data / old data: only rule 0 + the limit — never a made-up keyword ==');
  {
    const N = setup({ data: false });
    const st = N.kwStatus();
    ok('nothing uploaded: "No winning-keyword data (nothing uploaded yet)"', !st.ok && /^No winning-keyword data \(nothing uploaded yet\)/.test(st.text), st.text);
    const r = suggest(N, N1, N1.kw);
    ok('…the suggestion only takes out (duplicates, other brands) — nothing is added', r.added.length === 0 && !r.removed.some(x => x.why === 'limit') && r.removed.some(x => x.why === 'repeated') && r.removed.some(x => x.why === 'other brand'), r.after);
    const O = setup({ to: '2026-09-01' });
    const so = O.kwStatus();
    ok('older than 45 days: "No winning-keyword data (updated 1 Sep 2026)" — and nothing added', !so.ok && /No winning-keyword data \(updated 1 Sep 2026\)/.test(so.text) && suggest(O, N1, N1.kw).added.length === 0, so.text);
    ok('…the Workspace / Listing Errors plan says nothing is added either', N.kfPlan(N.kfItemOf('SP', N.HEALTH.SP.rows.find(x => x.sku === T1.sku), N.hCtx(), null)).added.length === 0);
  }

  console.log('== the panel (Listing → Listing Rules · Winning keywords) and its CSV ==');
  {
    C.KW.type = 'tablecloth'; C.KW.brand = 'ALL';
    let html = C.kwPanelHtml();
    const s = strip(html);
    ok('per product type: the searches other brands win, who wins (brand), click / conversion share, whether we use the words, our SQP', /🏆 Winning keywords/.test(s) && /boho tablecloth/.test(s) && /Maison d' Hermine/.test(s.replace(/&#39;/g, "'")) && /18\.2%/.test(s) && /22\.1%/.test(s) && /Ridhi: 13 clicks · 2 sold/.test(s), s.slice(0, 900));
    ok('…a word none of our tablecloths uses is underlined ("boho", "farmhouse"); a word we use is not ("tablecloth")', /<u [^>]*>boho<\/u>/.test(html) && /<u [^>]*>farmhouse<\/u>/.test(html) && !/<u [^>]*>tablecloth<\/u>/.test(html));
    ok('…the brand filter offers Angry Orange, Etopia, Maison and every brand that wins', ['Angry Orange', 'Etopia', 'Maison', 'Lahome'].every(b => html.includes(`<option value="${b}"`)));
    C.KW.brand = 'Maison';
    html = C.kwPanelHtml();
    ok('…filtered to Maison: only the searches Maison d\' Hermine is in', /farmhouse/.test(strip(html)) && !/boho tablecloth/.test(strip(html)));
    const csv = C.kwCsv();
    ok('the CSV: the rows on screen, Excel-ready (BOM, CRLF), the brand and where it was read from', csv.n === 1 && /^﻿Product type,Search,Search frequency rank,Wins \(brand\)/.test(csv.text) && /Tablecloths,farmhouse tablecloth rectangle,12400,Maison d' Hermine,brand column \/ watched brand,18\.2%,22\.1%/.test(csv.text) && /\r\n/.test(csv.text), csv.text.slice(0, 400));
    C.KW.brand = 'ALL';
    const none = setup({ data: false }).kwPanelHtml();
    ok('no data: the panel says so and shows where to download it', /No winning-keyword data/.test(none) && /Top search terms/.test(none) && /Choose a file/.test(none));
  }

  console.log('== titles, bullets and descriptions unchanged ==');
  {
    const ROOT = path.join(__dirname, '..', '..');
    let before = null;
    try { before = cp.execSync('git show 91c70039:Pricing-App/src/app/listing/listing-rules.js', { cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { before = null; }
    if (!before) ok('(the rules before this change, 91c70039, are not in this checkout — skipped)', true);
    else {
      const A = load({ src: before }), B = load({});
      const titles = ['Ridhi Indigo Blue Hand Block Print Rectangle Tablecloth 60x90 Inch Farmhouse Dining Kitchen Housewarming Gift For Her Cotton Linen',
        'Whimsical Corner Sage Green Hand Block Print Cloth Napkins 18x18 Inch Set of 6 Dinner Napkins Wedding Party Reusable Washable Cotton',
        'Ridhi Ridhi Napkins Napkins Cotton Cotton Blue Square 20 x 20 Inch', 'CPC Floral Table Runner 14 x 72 Inch Hand Block Print Cotton Wedding Decor Party'];
      const run = (X, t, mode) => { const r = X.lrSuggestWords(t, { mode, facts: X.lrSwFacts({ brand: 'SP', sku: 'R1' }, null, null, { title: t }), fits: x => x.length <= 75, shortFrom: 74 }); return JSON.stringify([r.after, r.removed.map(x => [x.w, x.why]), r.important, r.short]); };
      ok('title and Item Highlights suggestions: the very same as before this change, word for word', titles.every(t => run(A, t, 'title') === run(B, t, 'title') && run(A, t, 'hl') === run(B, t, 'hl')));
      ok('every title check the same (Listing Health\'s findings on the sample catalogue)', JSON.stringify(A.rows.map(r => A.healthOf(r, A.hCtx()).found.map(x => [x.id, x.detail]))) === JSON.stringify(B.rows.map(r => B.healthOf(r, B.hCtx()).found.map(x => [x.id, x.detail]))));
    }
    const lc = C.lrSuggestWords('Soft cotton napkins. Soft cotton napkins.', { mode: 'title', facts: facts(C, N1) });
    ok('the search-terms rule never touches another field: a title text keeps its repeats unless it must be cut', lc.after === 'Soft cotton napkins. Soft cotton napkins.');
  }

  console.log('== 2nd source: PROVEN IN OUR ADS (our own Sponsored Products search terms, the nightly cache) ==');
  {
    const P = setup({ ppc: true });
    const w = P.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(P, T1), pt: T1.pt });
    const byW = new Map(w.words.map(x => [x.w, x]));
    ok('a proven word is offered: "farmhouse" (14 orders from \'farmhouse tablecloth\'), "bistro" (3) — with the reason "PPC: 14 orders from \'farmhouse tablecloth\' in 30 days" ("scalloped": not sure it is scalloped)',
      byW.has('farmhouse') && byW.get('farmhouse').src === 'ppc' && byW.get('farmhouse').why === "PPC: 14 orders from 'farmhouse tablecloth' in 30 days" && byW.has('bistro') && !byW.has('scalloped'), JSON.stringify(w.words.map(x => x.w + ': ' + x.why)));
    ok('low-order terms ignored: "vintage tablecloth" (1 order) gives nothing', !byW.has('vintage'));
    ok('the same filters: not another shape (round), colour (red), brand (etopia), an ASIN target, a word of the title (indigo), a season (christmas)', !['round', 'red', 'etopia', 'b0abcdefgh', 'indigo', 'christmas', 'gnome'].some(x => byW.has(x)), [...byW.keys()].join());
    ok('a term from an ad group that advertises two families (tablecloth + napkins) belongs to neither: "harvest" not offered', !byW.has('harvest') && !P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw, facts: facts(P, N1), pt: N1.pt }).words.some(x => x.w === 'harvest'));
    ok('PRIORITY: the proven words first, by orders (farmhouse 14, bistro 3), then the Brand Analytics words (boho)', w.words.map(x => x.w).join() === 'farmhouse,bistro,boho' && w.proven === 2, w.words.map(x => x.w + '/' + x.src).join());
    const n = P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw, facts: facts(P, N1), pt: N1.pt });
    ok('the napkins: "rustic" and "wedding" proven in our ads (7 orders) — Brand Analytics then adds only what is still missing (farmhouse, boho): "wedding" once, from our ads', n.words.map(x => x.w + '/' + x.src).join() === 'rustic/ppc,wedding/ppc,farmhouse/ba,boho/ba', n.words.map(x => x.w + '/' + x.src).join());
    // space short: a napkin text with room for about one word — the proven word stays, the Brand Analytics ones go first
    let tight = N1.kw.replace(' angry orange maison', '');
    const PAD = 'tea brunch picnic bridal baby kitchen everyday buffet banquet catering hotel cafe linen cocktail luncheon dinnerware gathering restaurant patio garden backyard porch lunch supper feast meal family friends hosting entertaining cottage chalet cabin lodge'.split(' ');
    const base = t => P.lrSuggestWords(t, { mode: 'kw', facts: facts(P, N1), title: N1.title, brands: P.lrBrandWords({ brand: 'CPC' }, P.getLR()), others: P.kwOthers(P.getLR()), fits }).after;
    for (let i = 0; bytes(base(tight)) < 241 && i < PAD.length; i++) tight += ' ' + PAD[i];
    const r = P.lrSuggestWords(tight, { mode: 'kw', facts: facts(P, N1), title: N1.title, brands: P.lrBrandWords({ brand: 'CPC' }, P.getLR()), others: P.kwOthers(P.getLR()), fits,
      add: P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: tight, facts: facts(P, N1), pt: N1.pt }).words });
    ok('space short: the PROVEN words (rustic, wedding) get in — "wedding" takes the room of one of the listing\'s own words with no orders — the Brand Analytics words (farmhouse, boho) do not push anything out; ≤ 249 bytes',
      r.added.map(a => a.w).join() === 'rustic,wedding' && r.notAdded.map(a => a.w).sort().join() === 'boho,farmhouse' && fits(r.after) && !r.removed.some(x => x.why === 'cut to fit')
      && r.removed.filter(x => x.why === 'replaced').every(x => x.by === 'rustic' || x.by === 'wedding'), JSON.stringify([bytes(tight), r.added, r.notAdded.map(a => a.w), r.removed.filter(x => x.why === 'replaced'), bytes(r.after)]));
    // (28 Nov 2026 later) PROVEN words may push out the listing's own UNPROVEN, unprotected words — never 🔒 words, never words with proof
    const N1f = facts(P, N1);
    // ordinary words with no proof (not low-value, not joining words): 3-letter pads up to 247 bytes — a 9-byte word needs 3 of them out
    const fill = (start, pad, to) => { let t = start; for (let i = 0; bytes(t) < to; i++) t += ' ' + pad + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)); return t; };
    const near = fill('napkins sage green cotton cpc dinner washable reusable picnic', 'w', 247);
    const proofOf = ['picnic'];
    const pr = P.lrSuggestWords(near, { mode: 'kw', facts: N1f, title: N1.title, brands: ['cpc'], fits, proof: proofOf, add: [{ w: 'farmhouse', why: 'PPC: 14 orders from \'farmhouse napkins\' in 30 days', proven: true }] });
    const repl = pr.removed.filter(x => x.why === 'replaced');
    ok('a 14-order PROVEN word replaces the listing\'s own weakest unproven words (from the end) until it fits: "+ farmhouse … replaces …"', pr.added.map(a => a.w).join() === 'farmhouse' && repl.length === 3 && repl.every(x => x.by === 'farmhouse') && pr.added[0].replaces.slice().sort().join() === repl.map(x => x.w).sort().join() && pr.added[0].replaces[0] === repl[repl.length - 1].w && fits(pr.after) && / farmhouse$/.test(pr.after), JSON.stringify([bytes(near), pr.added, repl.map(x => x.w)]));
    ok('…never a 🔒 protected word (cpc, napkins, sage green, cotton, dinner, washable, reusable) and never a word with proof ("picnic": a search with orders)', !pr.removed.some(x => /^(cpc|napkins|sage|green|cotton|dinner|washable|reusable|picnic)$/.test(x.w)) && /picnic/.test(pr.after));
    let prot = 'napkins sage green cotton cpc whimsical corner dinner washable reusable hand block print';
    for (let i = 10; bytes(prot) < 246; i++) prot += ` ${i}x${i}`;                          // sizes: protected too
    const onlyProt = P.lrSuggestWords(prot, { mode: 'kw', facts: Object.assign({}, N1f, { size: '' }), title: N1.title, brands: ['cpc'], fits, add: [{ w: 'farmhouse', why: 'x', proven: true }] });
    ok('…with only 🔒 words left there is no room: the proven word is not added and nothing is replaced', !onlyProt.added.length && !onlyProt.removed.some(x => x.why === 'replaced') && onlyProt.notAdded.map(a => a.w).join() === 'farmhouse', JSON.stringify([onlyProt.added, onlyProt.removed.slice(0, 4)]));
    const ba = P.lrSuggestWords(near, { mode: 'kw', facts: N1f, title: N1.title, brands: ['cpc'], fits, proof: proofOf, add: [{ w: 'farmhouse', why: 'wins for Etopia on …' }] });
    ok('a Brand Analytics word does NOT push out the listing\'s own words: not added, nothing taken out, the text as it was', !ba.added.length && !ba.removed.length && ba.after === near && ba.notAdded.map(a => a.w).join() === 'farmhouse', JSON.stringify([ba.added, ba.removed.map(x => x.w + ':' + x.why)]));

    // ACoS: with a break-even known (Search Terms' cpBreakEven), a term over it is not proven
    const A = setup({ ppc: true, ctx: { cpBreakEven: () => 30 } });
    const wa = A.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(A, T1), pt: T1.pt });
    const bis = A.kwProvenTerms('SP', T1.asin, T1.parent, 30).find(t => t.t === 'bistro tablecloth');
    ok('good ACoS when known: "bistro tablecloth" (3 orders, ACoS 225 %) is not proven with a break-even of 30 % — "ACoS 225% over break-even 30%"; without a known break-even it is',
      !wa.words.some(x => x.w === 'bistro') && bis && !bis.ok && bis.why === 'ACoS 225% over break-even 30%' && w.words.some(x => x.w === 'bistro') && P.kwProvenTerms('SP', T1.asin, T1.parent, 30).find(t => t.t === 'bistro tablecloth').ok, JSON.stringify(bis));
    // the popup: the reason on the added word
    P.KF.full.set('SP|' + T1.sku, { kw: T1.kw, pt: 'TABLECLOTH', at: Date.now() });
    P.kfPreview([P.kfItemOf('SP', P.HEALTH.SP.rows.find(x => x.sku === T1.sku), P.hCtx(), null)], { title: 'T1', brand: 'SP', parent: T1.parent });
    await settle();
    const html = P.el('spModalBox').innerHTML.replace(/&#39;/g, "'");
    // the over-limit tablecloth: the proven words take the room of its own words with no orders — "farmhouse" replaces "buffet, banquet"
    ok('preview: "+ farmhouse (PPC: 14 orders from \'farmhouse tablecloth\' in 30 days) replaces buffet, banquet (no orders)", the replaced word struck "replaced by farmhouse (no orders)", and the data line "📈 Proven in our ads: … 30 days"',
      /<ins class="kf-add">\+ farmhouse<\/ins> <span class="muted">\(PPC: 14 orders from 'farmhouse tablecloth' in 30 days\)<\/span> <span class="kf-repl">replaces buffet, banquet \(no orders\)<\/span>/.test(html)
      && /<s class="kf-cut" title="replaced by farmhouse \(no orders\)">banquet<\/s>/.test(html)
      && /📈 Proven in our ads: Sponsored Products search terms, 30 days up to 25 Nov 2026 \(nightly\)/.test(strip(html)), (html.match(/kf-adds[\s\S]{0,500}/) || [''])[0] + strip(html).slice(0, 300));
    P.kfClick({ dataset: { kf: 'cancel' } });
    // the panel's tab
    P.KW.tab = 'ppc';
    const ph = P.kwPanelHtml(), ps = strip(ph);
    ok('panel tab "Proven in our ads": search term, listing family, clicks, orders, ACoS, proven?, already in keywords?', /📈 Proven in our ads/.test(ps) && /Search term Listing family Clicks Orders ACoS Proven\? Already in keywords\?/.test(ps)
      && /farmhouse tablecloth .* 120 14 15% ✓ proven missing: farmhouse/.test(ps) && /vintage tablecloth .* 1 order \(fewer than 2\)/.test(ps) && /cloth napkins sage .* ✓ yes/.test(ps), ps.slice(0, 900));
    const csv = P.kwPpcCsv();
    ok('…and its CSV (Excel-ready)', /^\uFEFFBrand,Listing family,Family name,Search term,Clicks,Orders/.test(csv.text) && /Ridhi,P-RTC,.*,farmhouse tablecloth,120,14,60,400,15%,,yes,,no,farmhouse,30/.test(csv.text), csv.text.slice(0, 400));
    P.KW.ppcBrand = 'CPC';
    ok('…brand filter: CPC shows only the napkins\' terms', !/farmhouse tablecloth/.test(strip(P.kwPanelHtml())) && /napkins rustic wedding/.test(strip(P.kwPanelHtml())));
    // works with NO upload
    const U = setup({ data: false, ppc: true });
    const wu = U.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(U, T1), pt: T1.pt });
    ok('works with NO Brand Analytics upload: the proven words alone (farmhouse, bistro); the panel opens on "Proven in our ads"', wu.words.map(x => x.w).join() === 'farmhouse,bistro' && /class="segbtn on" data-kw-tab="ppc"/.test(U.kwPanelHtml()), wu.words.map(x => x.w).join());
    // no PPC data → skipped
    const NP = setup({ ppc: 'none' });
    const wn = NP.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(NP, T1), pt: T1.pt });
    ok('no PPC data: that source is skipped ("No PPC search-term data") — the Brand Analytics words only', !NP.kwPpcStatus().ok && /^No PPC search-term data/.test(NP.kwPpcStatus().text) && wn.words.map(x => x.w).join() === 'boho,farmhouse' && wn.words.every(x => x.src === 'ba'), wn.words.map(x => x.w + '/' + x.src).join());
    // reading: stD60 when the backend writes it, else the nightly 30-day srchTerm
    const R = setup({ data: false, baCall: async q => (q.cache === 'stD60' ? { data: { at: 'x', d: { SP: { rows: PPC.SP.rows, to: '2026-11-25' } } } } : q.cache === 'srchTerm' ? { data: { d: PPC } } : q.cache === 'adGroup' ? { data: { d: AG } } : {}) });
    R.KW.ppc = null;
    await R.kwPpcLoad();
    const R2 = setup({ data: false, baCall: async q => (q.cache === 'srchTerm' ? { data: { at: 'x', d: PPC } } : q.cache === 'adGroup' ? { data: { d: AG } } : {}) });
    R2.KW.ppc = null;
    await R2.kwPpcLoad();
    ok('read-only from the nightly caches: the 60-day one (stD60) when it exists, else the 30-day srchTerm — with adGroup', R.KW.ppc.src === 'stD60' && R.KW.ppc.days === 60 && R2.KW.ppc.src === 'srchTerm' && R2.KW.ppc.days === 30 && /in 30 days/.test(R2.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(R2, T1), pt: T1.pt }).words[0].why));
  }


  console.log('== (29 Nov 2026) leftovers, and added words must match the product ==');
  {
    const L = setup({ ppc: true });
    const nf = facts(L, N1);
    const kw = t => L.lrSuggestWords(t, { mode: 'kw', facts: nf, title: N1.title, brands: ['cpc'], others: L.kwOthers(L.getLR()), fits });
    const a = kw('napkins etopia style dinner');
    ok('a leftover goes once the word before it went: "etopia style" → etopia (other brand), style (leftover)', a.after === 'napkins dinner' && a.removed.some(x => x.w === 'style' && x.why === 'leftover') && L.kwWhyLabel('leftover') === 'leftover', JSON.stringify(a.removed));
    const b = kw('napkins boho style dinner');
    ok('…it stays in a kept phrase ("boho style")', b.after === 'napkins boho style dinner' && !b.removed.length, b.after);
    const c = kw('her napkins dinner');
    ok('…alone at the very start ("her napkins") it goes too', c.after === 'napkins dinner' && c.removed[0].why === 'leftover');
    let over = 'napkins sage green cotton gift for her washable';
    for (let i = 0; bytes(over) < 252; i++) over += ' q' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
    const d = kw(over);
    ok('"gift for her": gift (low value — always, since 1 Dec 2026), then for and her (leftovers: the word before them went) — the protected words stay', /^napkins sage green cotton washable/.test(d.after) && ['gift:low-value word', 'for:leftover', 'her:leftover'].every(x => d.removed.map(r => r.w + ':' + r.why).includes(x)) && fits(d.after), JSON.stringify(d.removed.slice(0, 5)));
    const e = L.lrSuggestWords('napkins etopia style dinner', { mode: 'kw', facts: nf, title: N1.title, brands: ['cpc'], others: ['Etopia'], risk: t => [{ s: t.indexOf('etopia'), e: t.indexOf('etopia') + 6, why: "risky: another brand's name" }], riskOnly: true });
    ok('…never in "risky words only" (the Guard\'s fix: only the risky words go)', !e.removed.some(x => x.why === 'leftover'));
    // added words must match the product
    const w = L.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(L, T1), pt: T1.pt });
    const sk = w.skipped.map(x => x.why + ' | ' + x.from + ' | ' + x.term);
    ok('an EDGE it is not said to have: "scalloped" (PPC, 3 orders) is not added — "skipped: not sure the product is scalloped"', !w.words.some(x => x.w === 'scalloped') && sk.includes("skipped: not sure the product is scalloped | PPC: 3 orders | scalloped tablecloth"), sk.join(' ; '));
    ok('…a PATTERN and a SEASON it is not said to be: "christmas tablecloth buffalo plaid" skipped and said; a Christmas search too', w.skipped.some(x => x.term === 'christmas tablecloth buffalo plaid') && w.skipped.some(x => /christmas/.test(x.term)), sk.join(' ; '));
    const wa = L.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(L, T1), pt: T1.pt, va: { edge_style: [{ value: 'Scalloped' }] } });
    ok('…when its attributes say it (edge style "Scalloped") the word is added', wa.words.some(x => x.w === 'scalloped') && !wa.skipped.some(x => x.w === 'scalloped'), wa.words.map(x => x.w).join());
    const wt = L.kwWinFor({ brand: T1.brand, sku: T1.sku, title: 'Ridhi Indigo Blue Christmas Hand Block Print Rectangle Tablecloth 60x90 Inch', kw: T1.kw, facts: facts(L, T1), pt: T1.pt });
    ok('…when its title says the season (Christmas) the season search is not "not sure" any more', !wt.skipped.some(x => /christmas/.test(x.w)), wt.skipped.map(x => x.w).join());
    const noMat = Object.assign({}, facts(L, N1), { material: '' });
    const wm = L.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw, facts: noMat, pt: N1.pt });
    const wk = L.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw, facts: Object.assign({}, noMat, { material: 'Cotton' }), pt: N1.pt });
    ok('a MATERIAL: the listing\'s not known → "not sure the product is linen"; known cotton → linen searches skipped quietly (it is not linen)', wm.skipped.some(x => x.why === 'skipped: not sure the product is linen') && !wk.skipped.some(x => x.w === 'linen'), JSON.stringify([wm.skipped.map(x => x.w), wk.skipped.map(x => x.w)]));
    L.KF.full.set('SP|' + T1.sku, { kw: T1.kw, pt: 'TABLECLOTH', at: Date.now() });
    L.kfPreview([L.kfItemOf('SP', L.HEALTH.SP.rows.find(x => x.sku === T1.sku), L.hCtx(), null)], { title: 'T1', brand: 'SP', parent: T1.parent });
    await settle();
    const html = L.el('spModalBox').innerHTML.replace(/&#39;/g, "'");
    ok('preview: "skipped: not sure the product is scalloped (PPC: 3 orders from \'scalloped tablecloth\')", and "her" / "style" struck as leftover',
      /<li class="kf-skip muted">skipped: not sure the product is scalloped \(PPC: 3 orders from 'scalloped tablecloth'\)<\/li>/.test(html) && /<s class="kf-cut" title="leftover">her<\/s>/.test(html) && /<s class="kf-cut" title="leftover">style<\/s>/.test(html), (html.match(/kf-adds[\s\S]{0,900}/) || [''])[0]);
    L.kfClick({ dataset: { kf: 'cancel' } });
  }
  console.log('== before → after (two listings in our real title format; our ads\' proven words + the Brand Analytics sample above) ==');
  {
    const PB = setup({ ppc: true });
    [T1, N1].forEach(L => {
      const r = suggest(PB, L, L.kw);
      console.log(`  ${L.sku} (${L.title})`);
      console.log(`    before (${bytes(L.kw)} bytes): ${L.kw}`);
      console.log(`    after  (${bytes(r.after)} bytes): ${r.after}`);
      console.log(`    added: ${r.added.map(a => `+ ${a.w} (${a.why})${a.replaces && a.replaces.length ? ' replaces ' + a.replaces.join(', ') + ' (no orders)' : ''}`).join('; ') || '—'}${r.notAdded.length ? ` · not added (no room): ${r.notAdded.map(a => a.w).join(', ')}` : ''}`);
      console.log(`    removed: ${r.removed.map(x => `${x.w} (${x.why === 'replaced' ? 'replaced by ' + x.by + ', no orders' : C.kwWhyLabel(x.why)})`).join(', ') || '—'}`);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
