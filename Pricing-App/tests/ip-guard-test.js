/* IP & Trademark Guard (roadmap #9, 18 Nov 2026): src/app/listing/ip-guard.js over the real listing-match.js, family-check.js, the Listing
 * Rules, the Workspace, Fix all, kw-fix.js, title-fix.js, the one send path and Listing History, in a stub page.
 *   node tests/ip-guard-test.js
 * Mock data in the shapes ListingMatch.gs writes (title, bullets, description, search terms, Item Highlights per listing): other brands'
 * names and restricted claims in each field, "style" / "inspired by" / "like" beside a name, upper and lower case, a name inside another
 * word, our own brands, a listing out of stock, a listing with no family, a listing Sellora holds no read of. Then: the matcher, the
 * screen (summary, cards, chips, search, the Stock toggle, both views), SCREEN = DOWNLOAD, Allowed on purpose + Undo (a listing, a whole
 * family), Fix = the existing popups (Fix all search terms takes the risky words out and sends through the one send path; Fix all titles
 * for a title; Listing Errors for bullets), no Amazon call by the screen itself, the rule results untouched, ipReport(). */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 900) : '')); } };
const H = 3600000;
const IST = ms => new Date(ms + 5.5 * H).toISOString().slice(0, 16).replace('T', ' ');
const A = sku => 'B0' + sku.replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(8, 'X').slice(0, 8);
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const text = html => String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const wait = async (cond, n) => { for (let i = 0; i < (n || 400) && !cond(); i++) await new Promise(r => setTimeout(r, 1)); };
const idle = async C => { for (let i = 0; i < 400 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await new Promise(r => setTimeout(r, 2)); await new Promise(r => setTimeout(r, 2)); };
const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${size} Inch Block Print - ${color}`;
const B5 = ['Soft cotton', 'Machine washable', 'Set of six', 'Made by hand', 'Fits every table'];

/* ---- the sample: brand, sku, parent sku, stock, and the texts ListingMatch holds ---- */
const KIDS = [
  // family NP (Ridhi napkins)
  { b: 'SP', sku: 'NP-1', p: 'NP-P', qty: 5, t: GOOD('18 x 18', 'Blue'), kw: 'cotton dinner napkins reusable', color: 'Blue', size: '18x18' },
  { b: 'SP', sku: 'NP-2', p: 'NP-P', qty: 7, t: GOOD('20 x 20', 'Red'), kw: 'cotton napkins, pottery barn style; dinner table, organic cloth', color: 'Red', size: '20x20' },
  { b: 'SP', sku: 'NP-3', p: 'NP-P', qty: 3, t: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Pottery Barn Style - Green', kw: 'cotton napkins',
    bl: ['Soft cotton', 'A Disney-inspired print the children love', 'Set of six', 'Made by hand', 'Fits every table'], d: 'Hand printed in Jaipur. ANTIBACTERIAL finish keeps the cloth fresh for the whole dinner and for many washes after it.', color: 'Green', size: '18x18' },
  { b: 'SP', sku: 'NP-4', p: 'NP-P', qty: 0, t: GOOD('20 x 20', 'Grey'), kw: 'napkins like West Elm cotton', color: 'Grey', size: '20x20' },
  { b: 'SP', sku: 'NP-5', p: 'NP-P', qty: 4, t: GOOD('18 x 18', 'Sage'), kw: 'cotton napkins', hl: ['Best Seller in block print napkins'], color: 'Sage', size: '18x18' },
  { b: 'SP', sku: 'NP-6', p: 'NP-P', qty: 4, t: GOOD('20 x 20', 'Navy'), kw: 'inorganic dye disneyland marvelous channel stitch #10 pick', color: 'Navy', size: '20x20' },
  { b: 'SP', sku: 'NP-7', p: 'NP-P', qty: 4, t: GOOD('18 x 18', 'Rust'), kw: 'whimsical corner ridhi cpc fabricrush napkins', color: 'Rust', size: '18x18' },
  // family TC (Ridhi tablecloths)
  { b: 'SP', sku: 'TC-1', p: 'TC-P', qty: 9, t: 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Block Print - Blue', kw: 'hello kitty tablecloth party HELLO KITTY', color: 'Blue', size: '60x90', sub: 'Rectangle Tablecloth' },
  { b: 'SP', sku: 'TC-2', p: 'TC-P', qty: 9, t: 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 84 Inch Block Print - Red', kw: 'cotton tablecloth', color: 'Red', size: '60x84', sub: 'Rectangle Tablecloth' },
  { b: 'SP', sku: 'TC-3', p: 'TC-P', qty: 2, t: 'Ridhi Tablecloth Rectangle Organic Cotton 60 x 90 Inch Block Print - Pink', kw: 'cotton tablecloth', color: 'Pink', size: '60x90', sub: 'Rectangle Tablecloth' },
  // family CD (the other brand)
  { b: 'CPC', sku: 'CD-1', p: 'CD-P', qty: 6, t: 'Whimsical Corner Desk Organizer Set', kw: 'desk set like Kate Spade office', color: 'Gold', size: '' },
  { b: 'CPC', sku: 'CD-2', p: 'CD-P', qty: 6, t: 'Whimsical Corner Desk Organizer Set Large', kw: 'desk organizer office', color: 'Gold', size: '' },
  // no family
  { b: 'SP', sku: 'LS-1', p: '', qty: 2, t: 'Ridhi Table Runner', kw: 'runner', d: 'Our #1 best seller for three years.', color: 'Blue', size: '' },
  { b: 'SP', sku: 'LX-1', p: '', qty: 0, t: 'Ridhi Old Runner', kw: 'gucci runner', color: 'Blue', size: '' },
];
const SALES = { [A('NP-2')]: [9, 900], [A('NP-3')]: [5, 500], [A('TC-1')]: [20, 4000], [A('TC-3')]: [1, 100], [A('CD-1')]: [2, 150], [A('LS-1')]: [1, 30] };
const PARENT_T = { 'NP-P': 'Block Print Napkins', 'TC-P': 'Floral Tablecloth', 'CD-P': 'Desk Organizer Set' };

function cacheOf(kids, at) {
  const tabs = {};
  const meta = { v: 2, kind: 'full', startedAt: IST(at - 20 * 60000), finishedAt: IST(at), upTo: IST(at), lastFull: { finishedAt: IST(at), brands: ['SP', 'CPC'], gaveUp: [] }, hash: 'h9', parts: { listings: {}, catalog: {} } };
  ['SP', 'CPC'].forEach(b => {
    const items = {}, cat = {};
    kids.filter(k => k.b === b).forEach(k => {
      items[k.sku] = { sku: k.sku, asin: A(k.sku), b, as: 'BUYABLE,DISCOVERABLE', pt: 'NAPKIN', t: k.t, bl: k.bl || B5, d: k.d || 'A plain description of the product, long enough to be a description.', hl: k.hl || [], kw: k.kw || '',
        lvl: k.p ? 'child' : '', psku: k.p, va: Object.assign({ color: k.color, material: 'Cotton' }, k.size ? { size: k.size } : {}), img: {}, iss: [],
        readAt: at, rs: 'Active', price: 20, ch: 'AMAZON_NA', rAt: at - 30 * 60000, fba: k.qty, fyp: null, inSupReport: false, sup: null };
      cat[A(k.sku)] = { asin: A(k.sku), t: k.t, brand: '', img: { MAIN: { u: `https://m.media-amazon.com/images/I/${k.sku.replace(/\W/g, '')}.jpg`, w: 2000, h: 2000 } }, pa: k.p ? [A(k.p)] : [], kids: [], theme: '', tattrs: [], vals: {},
        bc: 'Home & Kitchen', rk: { main: null, sub: null }, aplus: null, readAt: at };
    });
    tabs[`lmListings_${b}_1_0`] = { b, items };
    tabs[`lmCatalog_${b}_1_0`] = { b, items: cat };
    meta.parts.listings[b] = [`lmListings_${b}_1_0`];
    meta.parts.catalog[b] = [`lmCatalog_${b}_1_0`];
  });
  tabs.lmMeta = meta;
  return tabs;
}

async function setup(opts) {
  opts = opts || {};
  const kids = (opts.kids || KIDS).map(k => Object.assign({}, k));
  const store = opts.store || {};
  const saved = [];
  const now = Date.now();
  const at = opts.at || now - H;
  const net = { tabs: opts.noCache ? null : cacheOf(kids.filter(k => !k.noRead), at) };
  let C;
  const sent = (sku, attr) => { const p = C.calls.filter(c => c.lfix === 'patch' && c.apply && c.sku === sku && c.patches.some(x => x.path === '/attributes/' + attr)).slice(-1)[0]; return p ? p.patches.find(x => x.path === '/attributes/' + attr).value[0].value : null; };
  const kidOf = sku => kids.find(k => k.sku === sku) || {};
  const baCall = async q => {
    C.asked.push(q);
    if (q.cache) {
      const d = net.tabs && net.tabs[q.cache];
      if (!d) throw new Error(`nothing cached for "${q.cache}" yet`);
      return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(d)) };
    }
    if (q.lfix === 'content') {
      const items = {};
      q.skus.split(',').forEach(sku => { const k = kidOf(sku); items[sku] = { productType: 'NAPKIN', item_name: [{ value: sent(sku, 'item_name') || k.t }], bullet_point: (k.bl || B5).map(v => ({ value: v })), product_description: [{ value: k.d || 'd'.repeat(300) }],
        generic_keyword: [{ value: sent(sku, 'generic_keyword') != null ? sent(sku, 'generic_keyword') : k.kw }] }; });
      return { items };
    }
    if (q.lfix === 'get') { const k = kidOf(q.sku); return { productType: 'NAPKIN', status: ['BUYABLE', 'DISCOVERABLE'], issues: [], title: sent(q.sku, 'item_name') || k.t,
      attributes: { generic_keyword: [{ value: sent(q.sku, 'generic_keyword') != null ? sent(q.sku, 'generic_keyword') : k.kw, language_tag: 'en_US' }], item_name: [{ value: sent(q.sku, 'item_name') || k.t, language_tag: 'en_US' }],
        color: [{ value: k.color }], material: [{ value: 'Cotton' }], size: k.size ? [{ value: k.size }] : [] } }; }
    return {};
  };
  C = load({ lm: true, ws: true, sp: true, fa: true, lh: true, baCall, window: opts.window,
    getDoc: async ref => { const d = store[ref.path]; return { exists: () => !!d, data: () => JSON.parse(JSON.stringify(d)) }; },
    setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); const cur = store[ref.path] || {}; store[ref.path] = Object.assign({}, cur, data, data.items ? { items: Object.assign({}, cur.items || {}, data.items) } : {}); },
    ctx: Object.assign({ leOnly() {}, leShow() {}, leListEnsure() {}, imOnly() {}, imListRender() {}, ME: { email: 'vishesh.g@example.com' },
      apcSales: asin => (opts.noSales ? null : (SALES[asin] || [0, 0])[1]), apcSalesAt: () => (opts.noSales ? '' : '2026-11-17 09:00'), imThumb: u => u, parentName: (b, asin, fallback) => fallback }, opts.ctx || {}) });
  C.asked = [];
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 6, 15);
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: now, ok: [], hl: { none: true } }; });
  ['SP', 'CPC'].forEach(b => {
    const mine = kids.filter(k => k.b === b);
    const parents = [...new Set(mine.map(k => k.p).filter(Boolean))];
    C.IML[b] = { at: new Date(), items: parents.map(p => ({ sku: p, asin: A(p), lvl: 'parent', st: 'DISCOVERABLE', pt: 'NAPKIN', t: PARENT_T[p] || p, img: {}, live: {}, iss: [] }))
      .concat(mine.map(k => ({ sku: k.sku, asin: A(k.sku), st: 'BUYABLE,DISCOVERABLE', pt: 'NAPKIN', t: k.t, lvl: k.p ? 'child' : '', psku: k.p, pa: k.p ? A(k.p) : '', c: '', z: '', img: {}, live: {}, iss: [] }))) };
    C.HEALTH[b] = { at: new Date(), rows: mine.map(k => ({ brand: b, sku: k.sku, asin: A(k.sku), parent: k.p ? A(k.p) : '', title: k.t, qty: k.qty, status: 'Active', channel: 'AMAZON_NA', price: 20, aplus: true, aplusAt: now, checked: now,
      content: { titleLen: k.t.length, images: 8, bullets: 5, descLen: 300, title: k.t } })) };
    const cat = {};
    mine.forEach(k => { cat[k.sku] = { subcat: k.sub || 'Napkin Set', color: k.color, size: k.size }; });
    C.setCat(b, cat);
  });
  const mem = { copy: null };
  C.lmStoreUse({ get: async () => mem.copy, put: async c => { mem.copy = JSON.parse(JSON.stringify(c)); return true; } });
  await C.lmEnsure();
  await C.lmRefresh();                 // the backend's copy is in (lmEnsure itself only waits for the browser's saved copy)
  C.reset();
  return { C, saved, store, kids, net };
}
const open = async T => { await T.C.ipgOpen(); await wait(() => T.C.IPG.loaded && T.C.IPG.okLoaded); T.C.ipgDraw(); return T.C.el('ipgBody').innerHTML; };
const body = C => { C.ipgDraw(); return C.el('ipgBody').innerHTML; };
const click = (C, d) => C.ipgClick({ dataset: d, closest: () => null });
const rowOf = (C, sku) => C.ipgBuild().rows.find(p => (p.c.skus || [p.c.sku]).includes(sku));
const found = (C, sku) => rowOf(C, sku).finds.map(fd => `${fd.label}:${fd.word}${fd.mark ? '(ok)' : ''}`).sort().join(' | ');
const patches = (C, apply) => C.calls.filter(c => c.lfix === 'patch' && c.apply === apply);

(async () => {
  console.log('== the matcher: whole words, any case, written together, with "style" / "inspired" / "like" beside a name ==');
  {
    const { C } = await setup();
    const f = s => C.ipgFind(s).map(m => `${m.word}=${m.text}`).join(' ; ');
    ok('"Pottery Barn style" → the name with its "style", as written', f('Ridhi Napkins Pottery Barn style print') === 'Pottery Barn=Pottery Barn style');
    ok('"inspired by POTTERY-BARN" (capitals, a hyphen) and "potterybarn" (written together)', f('inspired by POTTERY-BARN napkins') === 'Pottery Barn=inspired by POTTERY-BARN' && f('potterybarn napkins') === 'Pottery Barn=potterybarn');
    ok('"like West Elm", "Disney-inspired", "Kate Spade look"', f('napkins like West Elm') === 'West Elm=like West Elm' && f('A Disney-inspired print') === 'Disney=Disney-inspired' && f('a Kate Spade look') === 'Kate Spade=Kate Spade look');
    ok('inside another word: not matched (Disneyland, inorganic, marvelous, channel, #10, dislike)', f('Disneyland trip, inorganic dye, marvelous look, channel stitch, #10 pick') === '' && f('I dislike Disney') === 'Disney=Disney');
    ok('accents, \'s, plural, "&" / "and" / nothing', f("Disney's Hermès scarf") === "Disney=Disney's ; Hermes=Hermès" && f('Crate and Barrel, Crate&Barrel, crate barrel').split(' ; ').length === 3 && f('best sellers') === 'best seller=best sellers');
    ok('claims: organic, eco friendly / ecofriendly, non toxic, OEKO TEX / oekotex, FDA-approved, #1, top-rated — no "style" taken with a claim',
      C.ipgFind('organic style cotton, eco friendly, ecofriendly, non toxic, OEKO TEX, oekotex, FDA-approved, #1 seller, top-rated').map(m => m.text).join('|') === 'organic|eco friendly|ecofriendly|non toxic|OEKO TEX|oekotex|FDA-approved|#1|top-rated'
      && C.ipgFind('organic').every(m => m.type === 'claim') && C.ipgFind('Disney').every(m => m.type === 'tm'));
    ok('OUR brands are never a finding: Ridhi, CPC, Whimsical Corner, Fabricrush', f('Whimsical Corner by Ridhi, CPC and Fabricrush') === '');
    ok('…nor the brand Amazon shows for the listing (o.ours), even when the list names it', C.ipgFind('Gucci runner by Gucci Home', null, { ours: ['Gucci'] }).length === 0 && C.ipgFind('Gucci runner').length === 1);
    ok('a word of ours taken out of the list by the rules: "CPC" typed into Other brands is ignored', (() => { const cfg = { allow: { otherBrands: 'CPC, Disney', claims: '' } }; return C.ipgFind('CPC napkins Disney', cfg).map(m => m.word).join() === 'Disney'; })());
    ok('the lists are Listing Rules\' own (lrAllow): 20 names + 15 claims to start with, edited there', C.ipgWords().tm === 20 && C.ipgWords().claim === 15
      && C.ipgFind('vegan leather', { allow: { otherBrands: '', claims: 'vegan' } }).map(m => m.word + '/' + m.type).join() === 'vegan/claim');
    const s = C.ipgSnip('This soft cotton napkin has a Pottery Barn style look that every dining table will love for many years to come', 30, 48);
    ok('the snippet: a short piece round the word, cut at whole words', s.hit === 'Pottery Barn style' && s.a === 'This soft cotton napkin has a ' && /^ look that every dining table will love/.test(s.b) && /…$/.test(s.b), JSON.stringify(s));
  }

  console.log('== every listing\'s title, bullets, description, search terms and Item Highlights (from ListingMatch) ==');
  const T = await setup();
  const { C } = T;
  const html0 = await open(T);
  {
    ok('NP-2: search terms — "Pottery Barn" (as "pottery barn style") and the claim "organic"', found(C, 'NP-2') === 'Search terms:Pottery Barn | Search terms:organic', found(C, 'NP-2'));
    ok('NP-3: the title, a bullet and the description', found(C, 'NP-3') === 'Bullet 2:Disney | Description:antibacterial | Title:Pottery Barn', found(C, 'NP-3'));
    ok('NP-5: Item Highlights ("Best Seller")', found(C, 'NP-5') === 'Item Highlights:best seller', found(C, 'NP-5'));
    ok('NP-6 (words inside words) and NP-7 (our own brands): clean', rowOf(C, 'NP-6').bucket === 'clean' && rowOf(C, 'NP-7').bucket === 'clean');
    ok('TC-1: "hello kitty … HELLO KITTY" is one finding, twice in the text', found(C, 'TC-1') === 'Search terms:Hello Kitty' && rowOf(C, 'TC-1').finds[0].n === 2);
    ok('LS-1 (no family): two claims in the description', found(C, 'LS-1') === 'Description:#1 | Description:best seller', found(C, 'LS-1'));
    ok('each finding: field, the exact words, a snippet, the type', (() => { const fd = rowOf(C, 'NP-2').finds.find(x => x.word === 'Pottery Barn'); return fd.f === 'kw' && fd.text === 'pottery barn style' && fd.type === 'tm' && fd.snip.hit === 'pottery barn style' && /cotton napkins, $/.test(fd.snip.a); })());
    ok('levels: a trademark is red, a claim amber (a listing with both is red)', rowOf(C, 'NP-2').bucket === 'tm' && rowOf(C, 'TC-3').bucket === 'claim' && C.IPG_TYPE.tm.cls === 'r' && C.IPG_TYPE.claim.cls === 'y');
    ok('why: "another brand\'s trademark — Amazon can remove the listing" / "restricted claim — needs proof/certificate"', C.IPG_TYPE.tm.why === "another brand's trademark — Amazon can remove the listing" && C.IPG_TYPE.claim.why === 'restricted claim — needs proof/certificate');
  }

  console.log('== the screen: summary, cards, chips, families closed ==');
  {
    const t = strip(html0);
    // risky: NP-2, NP-3, NP-5, TC-1, TC-3, CD-1, LS-1 in stock + NP-4, LX-1 out of stock = 9 (7 with stock)
    ok('top summary: "9 listings with risky words (7 with stock)", Trademark / Claims, where most are', /9 listings with risky words \(7 with stock\)/.test(t) && /Trademark 4 Claims 5/.test(t) && /Most are in search terms \(4 of 11 findings\)/.test(t), t.slice(0, 400));
    ok('…and "2 more are out of stock — switch “Stock > 0 only” off to see them"', /2 more are out of stock — switch “Stock > 0 only” off to see them/.test(t));
    ok('cards: Trademark words 4 · Restricted claims 5 · Allowed on purpose 0 · Clean 5', /Trademark words 4 another brand's name/.test(t) && /Restricted claims 5 needs proof/.test(t) && /Allowed on purpose 0 not counted/.test(t) && /Clean 5 nothing risky/.test(t), t.slice(300, 800));
    ok('chips with their numbers: All risky 7 · Trademark 4 · Claims 5 · In title 2 · In bullets 1 · In description 2 · In search terms 3 · In Item Highlights 1', /All risky 7 Trademark 4 Claims 5 In title 2 In bullets 1 In description 2 In search terms 3 In Item Highlights 1 Allowed on purpose 0 Clean 5/.test(t), t.slice(600, 1100));
    ok('families closed by default (no listing row drawn), each one line with its badges and words', !/class="fc-row/.test(html0) && (html0.match(/class="fc-head"/g) || []).length === 4 && /Block Print Napkins[^]*?2 trademark[^]*?3 claims/.test(t) && /Pottery Barn, organic, Disney, antibacterial \+1/.test(t), t.slice(900, 1500));
    const order = [...html0.matchAll(/class="fc-head" data-ipg="grp" data-ipg-v="([^"]+)"/g)].map(m => m[1]);
    ok('sorted red first, then the most 30-day sales: Tablecloth ($4,100) · Napkins ($1,400) · Desk set ($150) · then the claim-only runner', order.join() === 'SP|S:TC-P,SP|S:NP-P,CPC|S:CD-P,SP|L:' + A('LS-1'), order.join());
    ok('the same look as Family & Category Check / A+ Content: its cards, chips, arrows and table classes', /class="fc-boxes"/.test(html0) && /class="cc-chips"/.test(html0) && /class="fc-arrow"/.test(html0) && /class="xl fc-tbl cc-tbl ipg-tbl"/.test(html0));
    const shell = C.el('ipgPane').innerHTML;
    ok('toolbar: By listing / By word, the brand picker, "Stock > 0 only" ON by default, search (SKU, ASIN, family or word), Edit the word lists', /data-ipg="view" data-ipg-v="list"[^>]*>By listing</.test(shell) && /data-ipg-v="word"[^>]*>By word</.test(shell)
      && /data-ipg-f="brand"/.test(shell) && /data-ipg-f="stock" checked> Stock &gt; 0 only/.test(shell) && /placeholder="Search SKU, ASIN, family or word"/.test(shell) && /data-ipg="rules"/.test(shell));
    ok('Open all / Close all and ⬇ Download', /data-ipg="openall">Open all</.test(C.el('ipgTools').innerHTML) && /data-ipg="closeall"/.test(C.el('ipgTools').innerHTML) && /data-ipg="csv"[^>]*>⬇ Download</.test(C.el('ipgTools').innerHTML));
    ok('the top line says what was checked and that nothing is read from Amazon', /Checked for 20 other brands' names and 15 restricted claims \(Listing Rules → What people may write\) · This screen reads nothing from Amazon/.test(strip(C.el('ipgMeta').innerHTML)), strip(C.el('ipgMeta').innerHTML));
  }

  console.log('== a family open: the child rows ==');
  {
    click(C, { ipg: 'grp', ipgV: 'SP|S:NP-P' });
    const h = C.el('ipgBody').innerHTML, t = strip(h);
    ok('its risky listings as rows (NP-2, NP-3, NP-5): picture, SKU, ASIN link, stock', (h.match(/class="fc-row ipg-row/g) || []).length === 3 && /<img class="cc-pic" src="https:\/\/m\.media-amazon\.com\/images\/I\/NP2\.jpg"/.test(h)
      && new RegExp(`<a href="https://www\\.amazon\\.com/dp/${A('NP-2')}" target="_blank" rel="noopener"[^>]*>${A('NP-2')}</a>`).test(h) && /<td class="num">7<\/td>/.test(h));
    ok('each finding: its type, the word, why, the field and the snippet with the word marked', /<span class="fc-chip is-r ipg-c">Trademark<\/span><b>Pottery Barn<\/b><small>another brand's trademark — Amazon can remove the listing<\/small>/.test(h.replace(/&#39;/g, "'"))
      && /<span class="ipg-fld">Search terms<\/span><span class="ipg-tx">cotton napkins, <mark class="ipg-hit is-r">pottery barn style<\/mark>; dinner table, organic cloth<\/span>/.test(h)
      && /<span class="fc-chip is-y ipg-c">Restricted claim<\/span><b>organic<\/b><small>restricted claim — needs proof\/certificate<\/small>/.test(h) && /<mark class="ipg-hit is-y">organic<\/mark>/.test(h));
    ok('NP-3: Title, Bullet 2 and Description each with their snippet', /<span class="ipg-fld">Title<\/span>[^]*?<mark class="ipg-hit is-r">Pottery Barn Style<\/mark>/.test(h) && /<span class="ipg-fld">Bullet 2<\/span><span class="ipg-tx">A <mark class="ipg-hit is-r">Disney-inspired<\/mark> print/.test(h)
      && /<span class="ipg-fld">Description<\/span>[^]*?<mark class="ipg-hit is-y">ANTIBACTERIAL<\/mark>/.test(h));
    ok('What to do, in plain words', /Remove it from the search terms — Fix search terms does it \(Amazon checks first\)/.test(t) && /Take it out of the title — Fix title shows the new title for your OK/.test(t) && /Edit the bullet in Listing Errors and take it out/.test(t)
      && /Edit the description in Listing Errors and take it out — or keep it only with proof \/ a certificate, then mark it Allowed on purpose/.test(t));
    ok('the row\'s buttons: Fix search terms (NP-2), Fix title + Edit in Listing Errors (NP-3), and Allowed on purpose / Allow for the whole family on every word',
      new RegExp(`data-ipg="fixkw" data-ipg-b="SP" data-ipg-s="SP\\|${A('NP-2')}"`).test(h) && new RegExp(`data-ipg="fixtitle" data-ipg-b="SP" data-ipg-s="SP\\|${A('NP-3')}"`).test(h)
      && new RegExp(`data-ipg="edit" data-ipg-b="SP" data-ipg-s="SP\\|${A('NP-3')}" data-ipg-v="NP-3"`).test(h) && (h.match(/data-ipg="ok" /g) || []).length === 6 && (h.match(/data-ipg="okfam"/g) || []).length === 6);
    ok('the family\'s own buttons: Fix all search terms (1) · Fix all titles (1)', /data-ipg="famkw" data-ipg-v="SP\|S:NP-P"[^>]*>Fix all search terms \(1\)</.test(h) && /data-ipg="famtitle" data-ipg-v="SP\|S:NP-P"[^>]*>Fix all titles \(1\)</.test(h));
    click(C, { ipg: 'grp', ipgV: 'SP|S:NP-P' });
    ok('closed again: no rows', !/class="fc-row/.test(C.el('ipgBody').innerHTML));
    click(C, { ipg: 'openall' });
    ok('Open all: every family in view open (7 risky listings); Close all: none', (C.el('ipgBody').innerHTML.match(/class="fc-row ipg-row/g) || []).length === 7 && (click(C, { ipg: 'closeall' }), !/class="fc-row/.test(C.el('ipgBody').innerHTML)));
  }

  console.log('== chips, search, the brand picker, the Stock toggle ==');
  {
    const skus = () => C.ipgShownRows(C.ipgBuild()).map(p => p.c.sku).sort().join();
    click(C, { ipg: 'chip', ipgV: 'tm' });
    ok('Trademark: CD-1, NP-2, NP-3, TC-1', skus() === 'CD-1,NP-2,NP-3,TC-1', skus());
    click(C, { ipg: 'chip', ipgV: 'claim' });
    ok('Claims: LS-1, NP-2, NP-3, NP-5, TC-3 (a listing with both is under both)', skus() === 'LS-1,NP-2,NP-3,NP-5,TC-3', skus());
    click(C, { ipg: 'chip', ipgV: 'f:kw' });
    ok('In search terms: CD-1, NP-2, TC-1', skus() === 'CD-1,NP-2,TC-1', skus());
    click(C, { ipg: 'chip', ipgV: 'f:title' });
    ok('In title: NP-3, TC-3', skus() === 'NP-3,TC-3', skus());
    click(C, { ipg: 'f', ipgV: 'clean' });
    ok('the Clean card: the five clean listings in stock', skus() === 'CD-2,NP-1,NP-6,NP-7,TC-2', skus());
    click(C, { ipg: 'f', ipgV: 'clean' });
    ok('…pressed again: back to all risky', C.IPG.f === '' && skus() === 'CD-1,LS-1,NP-2,NP-3,NP-5,TC-1,TC-3', skus());
    C.IPG.q = 'hello kitty';
    ok('search a word: "hello kitty" → TC-1', skus() === 'TC-1');
    C.IPG.q = A('NP-3').toLowerCase();
    ok('search an ASIN', skus() === 'NP-3');
    C.IPG.q = 'np-2';
    ok('search a SKU', skus() === 'NP-2');
    C.IPG.q = 'floral tablecloth';
    ok('search a family: its risky listings', skus() === 'TC-1,TC-3');
    C.IPG.q = '';
    C.ipgFilter({ dataset: { ipgF: 'brand' }, value: 'CPC' });
    ok('brand picker: CPC only — "1 listings…": CD-1', skus() === 'CD-1' && /1 listing with risky words \(1 with stock\)/.test(strip(C.el('ipgBody').innerHTML)));
    C.ipgFilter({ dataset: { ipgF: 'brand' }, value: 'ALL' });
    C.ipgFilter({ dataset: { ipgF: 'stock' }, checked: false });
    const t = strip(C.el('ipgBody').innerHTML);
    ok('Stock toggle OFF: the out-of-stock ones too — NP-4 ("like West Elm") and LX-1 (no family, "gucci")', skus() === 'CD-1,LS-1,LX-1,NP-2,NP-3,NP-4,NP-5,TC-1,TC-3' && found(C, 'NP-4') === 'Search terms:West Elm' && found(C, 'LX-1') === 'Search terms:Gucci', skus());
    ok('…the summary still says 9 (7 with stock); the cards now count them: Trademark words 6', /9 listings with risky words \(7 with stock\)/.test(t) && /Trademark words 6/.test(t) && !/more are out of stock/.test(t), t.slice(0, 300));
    C.ipgFilter({ dataset: { ipgF: 'stock' }, checked: true });
    ok('Stock toggle ON again: 7 listings', C.ipgShownRows(C.ipgBuild()).length === 7);
  }

  console.log('== SCREEN = DOWNLOAD ==');
  {
    click(C, { ipg: 'openall' });
    const h = C.el('ipgBody').innerHTML;
    const csv = C.ipgCsv();
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    ok('Excel-ready: UTF-8 BOM, CRLF, the 14 columns (and Priority)', csv.text.charCodeAt(0) === 0xFEFF && lines[0] === 'Brand,Family,SKU,ASIN,Stock,Field,Risky word,Type,Snippet,Why,What to do,Allowed on purpose,Amazon link,Data time,Priority'
      && C.IPG_CSV_COLS.join() === 'Brand,Family,SKU,ASIN,Stock,Field,Risky word,Type,Snippet,Why,What to do,Allowed on purpose,Amazon link,Data time,Priority');
    const snips = [...h.matchAll(/<div class="ipg-snip[^"]*" data-ipg-fd="([^"]+)"><span class="ipg-fld">([^<]*)<\/span><span class="ipg-tx">([^]*?)<\/span>/g)].map(m => ({ id: text(m[1]), field: text(m[2]), snip: text(m[3]) }));
    ok(`one sheet row per finding line on the screen (${snips.length})`, csv.n === snips.length && csv.n === 11 && lines.length === 12, `${csv.n} vs ${snips.length}`);
    ok('…the same lines in the same order: SKU, field, word, snippet', csv.rows.every((r, i) => snips[i].id.startsWith(r.sku + '|' + r.field + '|') && snips[i].field === r.field && snips[i].snip === r.snippet),
      JSON.stringify([csv.rows.map(r => r.sku + '|' + r.field), snips.map(s => s.id)]));
    const r = csv.rows.find(x => x.sku === 'NP-2' && x.word === 'Pottery Barn');
    ok('a row in full: brand, family, SKU, ASIN, stock, field, word, type, snippet, why, what to do, allowed, link, data time', r.brand === 'Ridhi' && r.family === 'Block Print Napkins' && r.asin === A('NP-2') && r.stock === 7 && r.field === 'Search terms'
      && r.type === 'trademark' && r.snippet === 'cotton napkins, pottery barn style; dinner table, organic cloth' && r.why === "another brand's trademark — Amazon can remove the listing" && /^Remove it from the search terms/.test(r.what)
      && r.allowed === 'No' && r.link === 'https://www.amazon.com/dp/' + A('NP-2') && /\d{4}/.test(r.time), JSON.stringify(r));
    ok('what to do on the screen = the sheet\'s, row by row', csv.rows.every(x => strip(h).includes(x.what)));
    click(C, { ipg: 'chip', ipgV: 'f:kw' });
    ok('a chip narrows both the same way (In search terms: 3 listings, their 4 findings)', C.ipgCsv().n === (C.el('ipgBody').innerHTML.match(/class="ipg-snip/g) || []).length && C.ipgCsv().n === 4);
    click(C, { ipg: 'f', ipgV: 'clean' });
    ok('Clean: one line per clean listing, on the screen and in the sheet', C.ipgCsv().n === 5 && (C.el('ipgBody').innerHTML.match(/class="fc-row ipg-row/g) || []).length === 5 && C.ipgCsv().rows.every(x => x.word === '' && x.what === 'Nothing to do — no risky word'));
    click(C, { ipg: 'chip', ipgV: '' });
    click(C, { ipg: 'closeall' });
  }

  console.log('== By word ==');
  {
    click(C, { ipg: 'view', ipgV: 'word' });
    const h = C.el('ipgBody').innerHTML, t = strip(h);
    const cards = C.ipgCardsShown(C.ipgBuild());
    ok('each risky word as a card, trademark first then the most listings: Pottery Barn 2 · Disney 1 · Hello Kitty 1 · Kate Spade 1 · best seller 2 · organic 2 · #1 1 · antibacterial 1',
      cards.map(c => c.w.word + ':' + c.rows.size).join() === 'Pottery Barn:2,Disney:1,Hello Kitty:1,Kate Spade:1,best seller:2,organic:2,#1:1,antibacterial:1', cards.map(c => c.w.word + ':' + c.rows.size).join());
    ok('a card: the word, its type and why, how many listings (with stock), the families, the fields', /Pottery Barn Trademark another brand's trademark — Amazon can remove the listing 2 listings \(2 with stock\) · 1 family · 2 findings/.test(t.replace(/&#39;/g, "'")) && /Title 1 · Search terms 1/.test(t) && /Families: Block Print Napkins/.test(t), t.slice(0, 600));
    ok('…with buttons: Show the 2 listings · Fix all in search terms (1)', /data-ipg="show" data-ipg-w="pottery_barn"[^>]*>Show the 2 listings</.test(h) && /data-ipg="wordkw" data-ipg-w="pottery_barn"[^>]*>Fix all in search terms \(1\)</.test(h));
    const csv = C.ipgCsv();
    ok('the download there: the cards\' findings (11), card by card', csv.n === cards.reduce((n, c) => n + c.finds.length, 0) && csv.n === 11 && csv.rows[0].word === 'Pottery Barn' && csv.rows.map(r => r.word).join() === cards.flatMap(c => c.finds.map(() => c.w.word)).join());
    click(C, { ipg: 'chip', ipgV: 'claim' });
    ok('chip Claims: only claim cards', C.ipgCardsShown(C.ipgBuild()).every(c => c.w.type === 'claim') && C.ipgCardsShown(C.ipgBuild()).length === 4);
    click(C, { ipg: 'chip', ipgV: '' });
    click(C, { ipg: 'show', ipgW: 'hello_kitty' });
    ok('"Show the listings" → By listing with the word in the search box', C.IPG.view === 'list' && C.IPG.q === 'Hello Kitty' && C.ipgShownRows(C.ipgBuild()).map(p => p.c.sku).join() === 'TC-1');
    C.IPG.q = ''; C.IPG.built = false;
    C.ipgDraw();
  }

  console.log('== the screen reads nothing from Amazon ==');
  {
    ok('opening, drawing, chips, search, both views, the download: only the saved cache was read — no Amazon call', T.C.asked.length > 0 && T.C.asked.every(q => q.cache), JSON.stringify(T.C.asked.filter(q => !q.cache)));
    ok('…and nothing is queued for Amazon', !C.LI_WS.q.length && !C.LI_WS.inflight);
  }

  console.log('== Allowed on purpose (a word on a listing; a word for a whole family) + Undo ==');
  {
    const key = 'SP|' + A('NP-2');
    await click(C, { ipg: 'ok', ipgS: key, ipgW: 'organic' });
    ok('NP-2 "organic" allowed: it no longer counts (Claims 5 → 4), the listing is still red for "Pottery Barn"', found(C, 'NP-2') === 'Search terms:Pottery Barn | Search terms:organic(ok)' && rowOf(C, 'NP-2').claim === 0 && rowOf(C, 'NP-2').bucket === 'tm'
      && /Claims <b>4<\/b>/.test(body(C)) && /Allowed on purpose 1 not counted/.test(strip(body(C))), found(C, 'NP-2') + ' · ' + strip(body(C)).slice(0, 200));
    const mark = T.store['listingrules/ipok_SP'];
    ok('saved the way "Removed on purpose" is: listingrules/ipok_SP, kind "ipok", who and when', mark && mark.kind === 'ipok' && mark.items['NP-2~organic'].on === true && mark.items['NP-2~organic'].by === 'vishesh.g@example.com'
      && mark.items['NP-2~organic'].word === 'organic' && mark.items['NP-2~organic'].at > 0, JSON.stringify(mark));
    click(C, { ipg: 'grp', ipgV: 'SP|S:NP-P' });
    const h = C.el('ipgBody').innerHTML;
    ok('on the row: "Allowed on purpose · organic · allowed by Vishesh G on <date>" with Undo', /<span class="fc-chip is-g ipg-c">Allowed on purpose<\/span><b>organic<\/b><small>restricted claim · allowed by Vishesh G on \d+ \w+ \d{4}<\/small>/.test(h) && new RegExp(`data-ipg="undo" data-ipg-b="SP" data-ipg-s="SP\\|${A('NP-2')}" data-ipg-w="organic"`).test(h), strip(h).slice(0, 500));
    ok('the sheet says so: Allowed on purpose "Yes — Vishesh G on …", What to do "Nothing to do — allowed on purpose"', (() => { const r = C.ipgCsv().rows.find(x => x.sku === 'NP-2' && x.word === 'organic'); return /^Yes — Vishesh G on /.test(r.allowed) && r.what === 'Nothing to do — allowed on purpose'; })());
    // Fix does not take an allowed word out
    const risk = C.ipgKwRisk('SP', 'NP-2', C.HEALTH.SP.rows.find(r => r.sku === 'NP-2'), C.getLR());
    ok('an allowed word does not show in Fix: the search-terms fix takes "pottery barn style" out and leaves "organic"', C.kfShorten(KIDS[1].kw, { risk, riskOnly: true }).after === 'cotton napkins, dinner table, organic cloth', C.kfShorten(KIDS[1].kw, { risk, riskOnly: true }).after);
    await click(C, { ipg: 'undo', ipgS: key, ipgW: 'organic' });
    ok('Undo: it counts again; who undid it is kept beside the first mark', found(C, 'NP-2') === 'Search terms:Pottery Barn | Search terms:organic' && T.store['listingrules/ipok_SP'].items['NP-2~organic'].on === false && T.store['listingrules/ipok_SP'].items['NP-2~organic'].undoneBy === 'vishesh.g@example.com');
    // a whole family
    await click(C, { ipg: 'okfam', ipgV: 'SP|S:NP-P', ipgW: 'pottery_barn' });
    ok('"Allow for the whole family": Pottery Barn allowed on NP-2 (search terms) and NP-3 (title) at once', /Pottery Barn\(ok\)/.test(found(C, 'NP-2')) && /Title:Pottery Barn\(ok\)/.test(found(C, 'NP-3')) && rowOf(C, 'NP-2').bucket === 'claim' && rowOf(C, 'NP-3').bucket === 'tm',
      found(C, 'NP-2') + ' || ' + found(C, 'NP-3'));
    ok('…one mark for the family ("F~<parent ASIN>~pottery_barn"), said on the rows: "for the whole family", Undo (whole family)', T.store['listingrules/ipok_SP'].items['F~' + A('NP-P') + '~pottery_barn'].on === true
      && /allowed by Vishesh G on [^<]* for the whole family/.test(body(C)) && /Undo \(whole family\)/.test(body(C)));
    ok('…another family is untouched (TC-1 still red)', rowOf(C, 'TC-1').bucket === 'tm');
    await click(C, { ipg: 'undo', ipgS: 'SP|' + A('NP-3'), ipgW: 'pottery_barn' });
    ok('Undo on one row undoes the family\'s mark: both count again', found(C, 'NP-2') === 'Search terms:Pottery Barn | Search terms:organic' && /Title:Pottery Barn$/.test(found(C, 'NP-3')));
    click(C, { ipg: 'closeall' });
    // a new page reads the marks back
    const T2 = await setup({ store: { 'listingrules/ipok_SP': { kind: 'ipok', items: { 'TC-1~hello_kitty': { on: true, id: 'TC-1~hello_kitty', by: 'a@b.c', name: 'Asha', at: Date.now(), word: 'Hello Kitty', sku: 'TC-1' } } } } });
    await open(T2);
    ok('a mark saved earlier is read back when the page opens (TC-1 allowed: 8 risky, 6 with stock)', rowOf(T2.C, 'TC-1').bucket === 'allowed' && /8 listings with risky words \(6 with stock\)/.test(strip(T2.C.el('ipgBody').innerHTML)), strip(T2.C.el('ipgBody').innerHTML).slice(0, 200));
  }

  console.log('== Fix search terms: the EXISTING "Fix all search terms" popup, the one send path ==');
  {
    const before = C.asked.length;
    click(C, { ipg: 'fixkw', ipgS: 'SP|' + A('NP-2'), ipgB: 'SP' });
    await wait(() => C.KF.run && C.KF.run.plans.length && !C.KF.run.total);
    const run = C.KF.run, p = run.plans[0];
    const pop = C.el('spModalBox').innerHTML;
    ok('the Guard\'s Fix opens that popup for the listing ("Fix all search terms — NP-2")', run.plans.length === 1 && p.sku === 'NP-2' && /<b>Fix all search terms — NP-2<\/b>/.test(pop), strip(pop).slice(0, 200));
    ok('the plan: ONLY the risky words go — "pottery barn style" and "organic"; the rest as written', p.ok && p.after === 'cotton napkins, dinner table, cloth' && p.removed.map(r => r.w).join() === 'pottery,barn,style,organic' && p.removed.every(r => r.risk) && p.what === 'Take out 4 risky words', JSON.stringify([p.after, p.removed, p.why]));
    ok('the popup shows it: the risky words struck through, "1 child · all will be ≤ 249 bytes · 4 risky words taken out"', /<s class="kf-cut is-risk" title="risky: another brand&#39;s name">pottery<\/s>|<s class="kf-cut is-risk" title="risky: another brand's name">pottery<\/s>/.test(pop)
      && /<s class="kf-cut is-risk" title="risky: restricted claim">organic<\/s>/.test(pop) && /1 child · all will be ≤ 249 bytes · 4 risky words taken out/.test(strip(pop)), strip(pop).slice(0, 500));
    ok('…a text within the limit is not shown in red (53 → 29 bytes)', /<span class="">\d+<\/span> → <span class="ok" data-kf-n="SP\|NP-2">\d+<\/span> bytes/.test(pop));
    ok('nothing sent yet', patches(C, false).length === 0 && patches(C, true).length === 0);
    const done = C.kfGo();
    await C.SQ.run.checked;
    ok('Check with Amazon: Amazon checks the change first (not sent), screen "Search terms · Fix all"', patches(C, false).length === 1 && patches(C, true).length === 0 && patches(C, false)[0].patches[0].path === '/attributes/generic_keyword'
      && patches(C, false)[0].patches[0].value[0].value === 'cotton napkins, dinner table, cloth' && C.SQ.screens.slice(-1)[0] === 'Search terms · Fix all');
    await C.sqApprove();
    ok('Approve & send: sent, read again, accepted', patches(C, true).length === 1 && C.SQ.run.jobs[0].state === 'accepted', C.SQ.run.jobs[0].state + ' ' + C.SQ.run.jobs[0].why);
    C.sqClose();
    await done;
    await idle(C);
    ok('kept with its OLD text (History, Put back) and in Listing History', C.FA.log.length === 1 && C.FA.log[0].before.kw === KIDS[1].kw && C.FA.log[0].after.kw === 'cotton napkins, dinner table, cloth' && C.FA.log[0].name === 'Risky words in search terms'
      && T.saved.some(x => /^history\/listing_/.test(x.path) && Object.values(x.data.rows).some(r => r.sku === 'NP-2' && r.screen === 'Search terms · Fix all')), JSON.stringify(C.FA.log[0]));
    ok('the Guard follows: NP-2 is clean now (9 → 8 listings)', rowOf(C, 'NP-2').bucket === 'clean' && /8 listings with risky words \(6 with stock\)/.test(strip(body(C))), found(C, 'NP-2') + ' · ' + strip(body(C)).slice(0, 120));
    const rec = C.FA.log[0];
    const pb = C.faPutBack(rec.id);
    await C.SQ.run.checked;
    await C.sqApprove();
    C.sqClose();
    await pb;
    await idle(C);
    ok('Put back sends the old text again — and the Guard shows the words again', patches(C, true).slice(-1)[0].patches[0].value[0].value === KIDS[1].kw && found(C, 'NP-2') === 'Search terms:Pottery Barn | Search terms:organic', found(C, 'NP-2'));
    ok('only on a person\'s press did anything go to Amazon (the reads and sends of this Fix)', C.asked.slice(0, before).every(q => q.cache));
  }

  console.log('== Fix all for a family, and for a word ==');
  {
    C.ipgFilter({ dataset: { ipgF: 'stock' }, checked: false });
    click(C, { ipg: 'famkw', ipgV: 'SP|S:NP-P' });
    await wait(() => C.KF.run && C.KF.run.plans.length === 2 && !C.KF.run.total);
    ok('the family\'s "Fix all search terms (2)": one popup, NP-2 and NP-4 ("like West Elm" goes whole)', C.KF.run.plans.map(p => p.sku).sort().join() === 'NP-2,NP-4' && C.KF.run.plans.find(p => p.sku === 'NP-4').after === 'napkins cotton' && C.KF.run.plans.every(p => p.ok),
      JSON.stringify(C.KF.run.plans.map(p => [p.sku, p.after, p.why])));
    C.kfClick({ dataset: { kf: 'cancel' } });
    click(C, { ipg: 'view', ipgV: 'word' });
    click(C, { ipg: 'wordkw', ipgW: 'hello_kitty' });
    await wait(() => C.KF.run && C.KF.run.plans.length === 1 && C.KF.run.plans[0].sku === 'TC-1' && !C.KF.run.total);
    ok('a word card\'s "Fix all in search terms": every listing with that word (TC-1: both "hello kitty" out)', C.KF.run.plans[0].after === 'tablecloth party' && /every listing with “Hello Kitty” in its search terms/.test(C.el('spModalBox').innerHTML), C.KF.run.plans[0].after);
    C.kfClick({ dataset: { kf: 'cancel' } });
    click(C, { ipg: 'view', ipgV: 'list' });
    C.ipgFilter({ dataset: { ipgF: 'stock' }, checked: true });
  }

  console.log('== the Workspace\'s own "Search terms over the limit" fix now takes risky words out too ==');
  {
    const LONG = 'cotton cotton napkins the organic disney style ' + Array.from({ length: 45 }, (_, k) => 'word' + k).join(' ');
    const T3 = await setup({ kids: KIDS.map(k => (k.sku === 'NP-1' ? Object.assign({}, k, { kw: LONG }) : k)) });
    await open(T3);
    const D = T3.C;
    const g = D.faGroups('SP', A('NP-P'), D.faKids('SP', A('NP-P'))).find(x => x.kind === 'kw');
    ok('(NP-1 is over the limit: the Workspace has its "Search terms over the limit" row)', g && g.kids.map(k => k.sku).join() === 'NP-1', g && g.kids.map(k => k.sku).join());
    const plan = D.faPlans(g, D.hCtx())[0];
    ok('its plan: the risky words out ("organic", "disney style") with the usual steps, and it fits', plan.ok && !/organic|disney|style/.test(plan.after) && plan.removed.filter(r => r.risk).map(r => r.w).join() === 'organic,disney,style' && plan.removed.some(r => r.why === 'repeated') && plan.b1 <= 249,
      JSON.stringify([plan.why, plan.removed.slice(0, 8)]));
  }

  console.log('== Fix title: the EXISTING "Fix all titles" popup — the person approves every new title ==');
  {
    click(C, { ipg: 'fixtitle', ipgS: 'SP|' + A('NP-3'), ipgB: 'SP' });
    await wait(() => C.TT.run && C.TT.run.plans.length && !C.TT.run.total);
    const p = C.TT.run.plans[0];
    const pop = C.el('spModalBox').innerHTML;
    ok('the Guard\'s Fix title opens that popup for the listing', C.TT.run.plans.length === 1 && p.sku === 'NP-3' && /<b>Fix all titles — NP-3<\/b>/.test(pop), strip(pop).slice(0, 200));
    ok('the new title is made by the title template from the listing\'s facts — no "Pottery Barn Style" — and it says what it fixes', p.ok && p.after === 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable - Green' && p.fixes.includes('Risky word: Pottery Barn'), JSON.stringify([p.after, p.why, p.fixes]));
    ok('nothing is sent without the person: ticked row, "Check with Amazon & send 1", Edit new title', patches(C, false).filter(c => c.sku === 'NP-3').length === 0 && /data-tt="go"[^>]*>Check with Amazon &amp; send 1</.test(pop) && /Edit new title/.test(pop));
    C.ttInput({ dataset: { ttEdit: 'SP|NP-3' }, value: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Disney - Green' });
    const chk = C.ttRunCheck(C.TT.run, p);
    ok('a title edited to hold another brand\'s name is refused: ✕ risky word “Disney”', !chk.pass && chk.fails.some(f => /risky word “Disney” \(another brand's name\)/.test(f)), chk.fails.join(' | '));
    C.ttClick({ dataset: { tt: 'cancel' } });
    ok('Cancel: nothing sent', patches(C, true).filter(c => c.sku === 'NP-3').length === 0);
    // TC-3: the claim is in the title and the template's own material is "100% Cotton"
    click(C, { ipg: 'fixtitle', ipgS: 'SP|' + A('TC-3'), ipgB: 'SP' });
    await wait(() => C.TT.run && C.TT.run.plans.length && C.TT.run.plans[0].sku === 'TC-3' && !C.TT.run.total);
    ok('TC-3 ("Organic Cotton" in the title, Amazon\'s material is Cotton): the new title says "100% Cotton"', C.TT.run.plans[0].ok && /^Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch (Hand )?Block Print - Pink$/.test(C.TT.run.plans[0].after), C.TT.run.plans[0].after + ' · ' + C.TT.run.plans[0].why);
    C.ttClick({ dataset: { tt: 'cancel' } });
  }

  console.log('== bullets / description: the listing in Listing Errors ==');
  {
    const n = C.calls.length;
    click(C, { ipg: 'edit', ipgB: 'SP', ipgV: 'NP-3', ipgHl: '' });
    ok('Edit in Listing Errors opens that listing there (the existing editor; Amazon checks before a send)', C.calls.slice(n).some(c => c.tab === 'lerr') && C.calls.slice(n).some(c => c.sku === 'NP-3'), JSON.stringify(C.calls.slice(n)));
  }

  console.log('== not checked is never "clean" ==');
  {
    const T4 = await setup({ kids: KIDS.concat([{ b: 'SP', sku: 'UN-1', p: 'NP-P', qty: 3, t: GOOD('18 x 18', 'Teal'), kw: 'disney', color: 'Teal', size: '18x18', noRead: true }]) });
    await open(T4);
    ok('a listing ListingMatch holds no read of: "Not checked" — not risky, not clean; its chip shows', rowOf(T4.C, 'UN-1').bucket === 'unchecked' && /Not checked <b>1<\/b>/.test(T4.C.el('ipgBody').innerHTML) && /Clean 5 nothing risky/.test(strip(T4.C.el('ipgBody').innerHTML)));
    const T5 = await setup({ noCache: true });
    const h5 = strip(await open(T5));
    ok('no cache at all: "Not checked yet … Nothing is flagged and nothing is called clean" — never "No risky words found ✓"', /Not checked yet/.test(h5) && /nothing is called clean/.test(h5) && !/No risky words found/.test(h5), h5.slice(0, 300));
    const T6 = await setup({ kids: KIDS.filter(k => ['NP-1', 'NP-6', 'NP-7', 'TC-2', 'CD-2'].includes(k.sku)) });
    const h6 = strip(await open(T6));
    ok('everything checked and nothing found: "No risky words found ✓"', /No risky words found ✓/.test(h6) && /0 listings with risky words \(0 with stock\)/.test(h6), h6.slice(0, 300));
    T6.C.IPG.loaded = false; T6.C.IPG.loading = true;
    T6.C.ipgDraw();
    ok('a skeleton while loading', /sp-skel/.test(T6.C.el('ipgBody').innerHTML));
  }

  console.log('== the rule results of the other checks are untouched ==');
  {
    const ids = D => ['SP', 'CPC'].flatMap(b => D.HEALTH[b].rows.map(r => r.sku + ':' + D.healthOf(Object.assign({}, r, { brand: b }), D.hCtx()).found.map(h => h.id + '/' + h.sev + '/' + h.detail).join(','))).join(' | ');
    const with0 = ids(C);
    const lr = C.getLR();
    lr.allow = Object.assign({}, C.lrAllow(lr), { otherBrands: '', claims: '' });
    C.reset();
    const without = ids(C);
    ok('Listing Health finds the very same with the Guard\'s lists and with both lists empty (the lists are no Listing Rules rule)', with0 === without && /NP-3:/.test(with0));
    ok('no rule of the defaults reads the lists', C.LR_DEFAULT.issues.every(i => !/otherBrands|claims/.test(JSON.stringify(i))) && !C.LR_DEFAULT.issues.some(i => /trademark|restricted claim/i.test(i.name)));
    lr.allow = C.lrAllow({});
    C.reset();
  }

  console.log('== ipReport() ==');
  {
    const log = console.log, table = console.table;
    console.log = () => {}; console.table = () => {};
    let r;
    try { r = C.ipReport(); } finally { console.log = log; console.table = table; }
    ok('per brand: listings, checked, risky (with stock), trademark, claims, allowed, clean, per field', r.counts.Ridhi.listings === 12 && r.counts.Ridhi.checked === 12 && r.counts.Ridhi.risky === 8 && r.counts.Ridhi.riskyWithStock === 6 && r.counts.Ridhi.trademark === 5
      && r.counts.Ridhi.claims === 5 && r.counts.Ridhi.clean === 4 && r.counts.Ridhi['in Search terms'] === 5 && r.counts.Ridhi['in Title'] === 2 && r.counts.CPC.risky === 1 && r.counts.CPC.clean === 1, JSON.stringify(r.counts));
    ok('…and up to 10 example findings with the snippet (the word in [ ])', r.examples.length === 9 && r.examples.every(x => x.SKU && x.field && x.word && /\[[^\]]+\]/.test(x.snippet)) && r.examples[0].type === 'trademark', JSON.stringify(r.examples.slice(0, 2)));
    ok('…and the words found most', r.topWords.length > 0 && r.topWords[0].findings >= r.topWords[r.topWords.length - 1].findings);
  }

  console.log('== fast enough: 4,000 listings ==');
  {
    const big = [];
    for (let i = 0; i < 4000; i++) {
      const fam = Math.floor(i / 20);
      big.push({ b: i % 3 ? 'SP' : 'CPC', sku: 'BG-' + i, p: 'BGP-' + fam + (i % 3 ? '' : 'C'), qty: i % 7 ? 5 : 0, t: GOOD('18 x 18', 'Blue ' + i), kw: i % 11 === 0 ? 'cotton napkins pottery barn style dinner table organic' : 'cotton napkins dinner table reusable cloth soft washable ' + i,
        bl: B5.map(b => b + ' — a longer line of text about the product that goes on for a while so the bullet is close to a real one ' + i), d: 'A description. '.repeat(40) + (i % 97 === 0 ? 'Antibacterial.' : ''), color: 'Blue', size: '18x18' });
    }
    const T7 = await setup({ kids: big });
    const t0 = Date.now();
    await open(T7);
    const first = Date.now() - t0;
    const t1 = Date.now();
    T7.C.ipgDraw();
    const again = Date.now() - t1;
    const s = T7.C.ipgSummary(T7.C.ipgBuild());
    ok(`4,000 listings checked and drawn in ${first} ms (drawn again in ${again} ms); ${s.risky} risky found`, first < 4000 && again < 300 && s.risky === 364 + 42 - 4 /* every 11th has risky search terms, every 97th a claim in its description, four have both */, `${first} ms / ${again} ms / ${s.risky}`);
    ok('…only a screenful of family lines is drawn at first ("Show more families")', (T7.C.el('ipgBody').innerHTML.match(/class="fc-head"/g) || []).length === 60 && /Show more families \(\d+ left\)/.test(T7.C.el('ipgBody').innerHTML));
  }

  console.log('== in a browser: the first check runs in slices under the skeleton — the page is never held ==');
  {
    const big = [];
    for (let i = 0; i < 3000; i++) big.push({ b: 'SP', sku: 'BW-' + i, p: 'BWP-' + Math.floor(i / 25), qty: 5, t: GOOD('18 x 18', 'Blue ' + i), kw: i % 10 === 0 ? 'cotton napkins disney style' : 'cotton napkins dinner ' + i,
      bl: B5.map(b => b + ' — a longer line of text about the product that goes on for a while ' + i), d: 'A description. '.repeat(40), color: 'Blue', size: '18x18' });
    const doc = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }), body: {} };
    const T8 = await setup({ kids: big, ctx: { requestAnimationFrame: () => 0, document: doc } });
    const D = T8.C;
    let last = performance.now(), hold = 0, on = true;
    const tick = () => { const t = performance.now(); hold = Math.max(hold, t - last); last = t; if (on) setTimeout(tick, 0); };
    setTimeout(tick, 0);
    const seen = [];
    const opening = D.ipgOpen();
    for (let i = 0; i < 4000 && !(D.IPG.loaded && !D.IPG.warm && /ipg-tbl/.test(D.el('ipgBody').innerHTML)); i++) { seen.push(D.el('ipgMeta').textContent); await new Promise(r => setTimeout(r, 1)); }
    await opening;
    on = false;
    ok('while it checks: the skeleton and "Checking 3,000 listings…"', seen.some(s => /^Checking 3,000 listings…$/.test(s)), [...new Set(seen)].join(' | ').slice(0, 200));
    ok('then the page, drawn once it is done: 300 risky listings found', /300 listings with risky words \(300 with stock\)/.test(strip(D.el('ipgBody').innerHTML)) && !D.IPG.warm, strip(D.el('ipgBody').innerHTML).slice(0, 160));
    ok(`the page was never held long while 3,000 listings were checked (at most ${Math.round(hold)} ms between two turns)`, hold < 400, Math.round(hold) + ' ms');
    const t0 = performance.now();
    D.ipgDraw();
    ok(`drawn again from the kept findings (${Math.round(performance.now() - t0)} ms), no second check`, performance.now() - t0 < 300 && !D.IPG.warm && /ipg-tbl/.test(D.el('ipgBody').innerHTML));
  }

  console.log('== the editor in Listing Errors names the word (a note, never a refusal) ==');
  {
    const lc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'listing-content.js'), 'utf8');
    ok('lcCheck adds "IP & Trademark Guard: risky word …" for the field being edited, from the same matcher and marks', /if \(typeof ipgTitleRisk === 'function'\) \[\.\.\.new Set\(ipgTitleRisk\(ctx\.brand \|\| '', ctx\.sku \|\| '', null, vals\.join\('\\n'\), LR \|\| LR_DEFAULT\)\)\]/.test(lc) && /push\(false, `IP & Trademark Guard: /.test(lc));
    ok('…the words it names: “Disney-inspired” (another brand\'s name), “ANTIBACTERIAL” (a restricted claim); an allowed word is not named',
      C.ipgTitleRisk('SP', 'NP-3', null, 'A Disney-inspired print. ANTIBACTERIAL finish.', C.getLR()).join(' | ') === "risky word “Disney-inspired” (another brand's name) | risky word “ANTIBACTERIAL” (a restricted claim)"
      && (C.IPG.ok.SP['NP-3~disney'] = { on: true, id: 'NP-3~disney' }, C.ipgTitleRisk('SP', 'NP-3', null, 'A Disney-inspired print.', C.getLR()).length === 0) && (delete C.IPG.ok.SP['NP-3~disney'], true));
  }

  console.log('== wired in: the menu, the pane, the styles, the settings ==');
  {
    const src = p => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
    const html = src('index.html'), nav = src('app/core/nav.js'), css = src('styles.css'), order = src('app/ORDER'), tab = src('app/listing/listing-rules-tab.js');
    ok('"IP & Trademark Guard" in the Listing menu under "2 · Check", after A+ Content', /<button id="tabAplus" class="nav">A\+ Content<\/button>\s*<button id="tabIpg" class="nav">IP &amp; Trademark Guard<\/button><\/div>/.test(html)
      && /data-tabs="[^"]*fam,aplus,ipg,lhist"/.test(html) && /<div id="paneIpg" class="hide"><div id="ipgPane"><\/div><\/div>/.test(html));
    ok('the tab is known to the app: TABS, its title, and it comes with Listing Health', /'aplus', 'ipg'\];/.test(nav) && /ipg: 'IP & Trademark Guard'/.test(nav) && /TAB_INHERIT = \{[^}]*ipg: 'health'/.test(nav));
    ok('ip-guard.js joined after aplus-audit.js', /listing\/aplus-audit\.js\r?\nlisting\/ip-guard\.js\r?\n/.test(order));
    ok('the same look as Family & Category Check and A+ Content: their styles cover the three panes', /:is\(#paneFam,#paneAplus,#paneIpg\) \.fc-box\{/.test(css) && /:is\(#paneFam,#paneAplus,#paneIpg\) \.cc-fchip\{/.test(css));
    const own = css.slice(css.indexOf('/* ----- IP & Trademark Guard'), css.indexOf('@media (max-width:860px){#paneIpg'));
    ok('its own colours are the theme\'s (var(--…)): light and dark, no fixed colour', own.length > 2000 && !/#[0-9a-f]{3,6}\b|rgb\(/i.test(own) && /var\(--bad-bg\)/.test(own) && /var\(--rev-bg\)/.test(own));
    ok('a sticky header', /#paneIpg \.ipg-tb\{position:sticky;top:var\(--ipg-top,0px\)/.test(css));
    ok('the two lists are edited in Listing Rules → What people may write (saved with the rules, named in its history)', /field\('otherBrands', allow\.otherBrands, 'w-xl'\)/.test(tab) && /field\('claims', allow\.claims, 'w-xl'\)/.test(tab)
      && /else if \(key === 'otherBrands'\) allow\.otherBrands = value;/.test(tab) && /otherBrands: "Other brands' names", claims: 'Restricted claims'/.test(tab));
    ok('no backend file is needed: the screen calls nothing new (only the existing lfix get / content / patch of the existing fixes)', !/baCall\(/.test(src('app/listing/ip-guard.js')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
