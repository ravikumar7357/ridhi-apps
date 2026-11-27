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

function setup(o) {
  o = o || {};
  const C = load({ ws: true, sp: true, fa: true, ai: true, le: true, ctx: { imOnly() {}, imListRender() {} },
    baCall: async q => (q.lfix === 'get' ? { productType: q.sku === N1.sku ? 'NAPKIN' : 'TABLECLOTH', status: ['BUYABLE'], attributes: { generic_keyword: [{ value: (q.sku === N1.sku ? N1 : T1).kw }] } } : {}) });
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
  return C;
}
const facts = (C, L) => C.lrSwFacts({ brand: L.brand, sku: L.sku }, null, null, { title: L.title, pt: L.pt });
const fits = t => bytes(t) <= 249;
const suggest = (C, L, text, extra) => C.lrSuggestWords(text, Object.assign({ mode: 'kw', facts: facts(C, L), title: L.title, brands: C.lrBrandWords({ brand: L.brand }, C.getLR()),
  others: C.kwOthers(C.getLR()), add: C.kwWinFor({ brand: L.brand, sku: L.sku, title: L.title, kw: text, facts: facts(C, L), pt: L.pt }).words, fits }, extra || {}));
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
      && ['tablecloths:repeated', 'cotton:repeated', 'etopia:other brand', 'gift:low-value word', 'the:stop word', 'a:stop word'].every(x => why.includes(x)), JSON.stringify([bytes(T1.kw), bytes(r.after), why]));
    const order = r.removed.slice().sort((a, b) => a.n - b.n);
    const firstCut = order.findIndex(x => x.why === 'cut to fit' || x.why === 'in the title');
    const lastLow = order.map(x => x.why).lastIndexOf('stop word');
    const addCut = order.filter(x => x.why === 'limit');
    ok('…then the ADDED words, the weakest first ("farmhouse", then "boho"), before any of the listing\'s own words is cut', lastLow < firstCut
      && r.toks.filter(t => t.added).sort((a, b) => a.n - b.n).map(t => t.w).join() === 'farmhouse,boho' && order.findIndex(x => x.why === 'cut to fit') > -1, JSON.stringify([r.notAdded, addCut]));
    ok('…and when the listing\'s own words had to go too, the room left over takes back the best winning word that fits ("boho", 4 bytes) — never "farmhouse" (no room)', r.added.map(a => a.w).join() === 'boho' && r.notAdded.map(a => a.w).join() === 'farmhouse' && fits(r.after) && / boho$/.test(r.after), r.after);
    ok('…and only then the listing\'s own ordinary words, from the end — never our brand or an important word', !r.removed.some(x => x.why === 'cut to fit' && /^(ridhi|hand|block|print|tablecloth|cotton|indigo|blue|rectangular|dining|kitchen)$/.test(x.w)), JSON.stringify(r.removed.filter(x => x.why === 'cut to fit').map(x => x.w)));
    let kwNS = 'ridhi cpc whimsical corner hand block print blockprint handmade napkins cotton sage green dinner kitchen dining washable reusable wrinkle free';
    for (let i = 10; bytes(kwNS) <= 260; i++) kwNS += ` ${i}x${i}`;
    const ns = suggest(C, N1, kwNS);
    ok('only our brands + important words left and still over → nothing cut, no word added: "Only important words left — edit by hand"', ns.important && !ns.fits && !ns.removed.length && !ns.added.length && ns.after === kwNS, JSON.stringify([bytes(ns.after), ns.removed]));
    const kp = C.kfShorten(kwNS, { title: N1.title, brands: ['ridhi', 'cpc', 'whimsical corner'], facts: facts(C, N1) });
    ok('…Fix all search terms holds it with the same words', kp.important && C.kfPlan({ key: 'k', brand: 'CPC', sku: N1.sku, kw: kwNS, title: N1.title, brands: ['cpc'], facts: facts(C, N1), full: true, pt: 'NAPKIN' }).why === 'Only important words left — edit by hand');
    const C2 = setup();
    C2.KF.full.set('SP|' + T1.sku, { kw: T1.kw, pt: 'TABLECLOTH', at: Date.now() });          // read whole from Amazon (its product type known)
    const it = C2.kfItemOf('SP', C2.HEALTH.SP.rows.find(x => x.sku === T1.sku), C2.hCtx(), null);
    const plan = C2.kfPlan(it);
    ok('Fix all search terms (kfPlan) sends only generic_keyword — the title, bullets and description are never in the patch', plan.ok && plan.patches.length === 1 && plan.patches[0].path === '/attributes/generic_keyword' && plan.b1 <= 249, JSON.stringify([plan.ok, plan.why, plan.patches]));
    ok('its plan of the over-limit tablecloth: "Shorten to 247 bytes · + 1 winning word"', /^Shorten to 247 bytes · \+ 1 winning word$/.test(plan.what) && plan.added.map(a => a.w).join() === 'boho', plan.what);
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
    ok('the data line: "🏆 Winning keywords: Brand Analytics up to 21 Nov 2026 … · N winning words added"', /🏆 Winning keywords: Brand Analytics up to 21 Nov 2026/.test(s) && /winning words? added/.test(s), s.slice(0, 600));
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

  console.log('== before → after (two listings in our real title format; the winning words from the sample data above) ==');
  {
    [T1, N1].forEach(L => {
      const r = suggest(C, L, L.kw);
      console.log(`  ${L.sku} (${L.title})`);
      console.log(`    before (${bytes(L.kw)} bytes): ${L.kw}`);
      console.log(`    after  (${bytes(r.after)} bytes): ${r.after}`);
      console.log(`    added: ${r.added.map(a => `+ ${a.w} (${a.why})`).join('; ') || '—'}${r.notAdded.length ? ` · not added (no room): ${r.notAdded.map(a => a.w).join(', ')}` : ''}`);
      console.log(`    removed: ${r.removed.map(x => `${x.w} (${C.kwWhyLabel(x.why)})`).join(', ') || '—'}`);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
