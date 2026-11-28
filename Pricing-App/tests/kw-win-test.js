/* SEARCH KEYWORDS — winning words + our house style: listing/kw-win.js and the one suggestion-words rule (listing-rules.js lrSuggestWords,
 * search-terms mode) over the real Fix all search terms popup, Listing Content, ✨ AI and Create Listing.
 *   node tests/kw-win-test.js
 * (28 Nov 2026) The 2nd source is the Bestseller keyword scout (Pricing-API/KeywordScout.gs), in place of the Brand Analytics uploads: its
 * tab here is what the real backend file writes for SAMPLE bestsellers (tests/kw-scout-sample.js — this machine cannot reach Amazon).
 * Two listings in our real title format: a Ridhi tablecloth and a Whimsical Corner (CPC) napkin set; their before → after is printed. */
const cp = require('child_process');
const path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const bytes = s => Buffer.byteLength(String(s).replace(/[\s;,.]+/g, ''), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 1)); };

// ---- the bestseller scout's tab, as Pricing-API/KeywordScout.gs writes it for the sample bestsellers (one Run now) ----
const fs = require('fs');
const { scoutTab } = require('./kw-scout-sample.js');
const SCOUT = scoutTab();
// …as if it had run at `ms` (a day ago by default) — the words stay the sample's
const scoutAt = ms => { const t = JSON.parse(JSON.stringify(SCOUT)); t.ms = ms || Date.now() - 864e5; t.at = new Date(t.ms).toISOString().slice(0, 16).replace('T', ' '); return t; };

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
  if (o.data !== false) C.kwUse({ scout: scoutAt(o.ranAt) });
  else C.kwUse({});
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
  console.log('== the bestseller scout\'s words in Sellora: ≥ 30 %, brand names out, never invented ==');
  const C = setup();
  {
    const st = C.kwStatus();
    ok('its line: "Bestseller words: the top 25 by Best Seller Rank per product type, scout of …"', st.ok && /^Bestseller words: the top 25 by Best Seller Rank per product type, scout of \d+ \w{3} \d{4}$/.test(st.text), st.text);
    const tw = C.kwScoutWords('tablecloth');
    const tws = tw.map(e => e.w);
    ok('tablecloth: the words ≥ 30 % of the top 25 use — farmhouse 12 (48 %), wrinkle free 10, boho 9 …; never rustic (6 = 24 %)', tw.length > 0 && tw.every(e => e.share >= 0.3) && tw.find(e => e.w === 'farmhouse').n === 12 && tw.find(e => e.w === 'wrinkle free').n === 10 && tw.find(e => e.w === 'boho').n === 9 && !tws.includes('rustic'), tws.join(' | '));
    ok('brand names out: every bestseller brand (Lahome, Utopia Home, Etopia, Maison, Angry Orange), ours, and the IP & Trademark Guard\'s — "pottery barn" (in the backend\'s list) and "pottery", "barn" alone',
      !tws.some(w => /lahome|utopia|etopia|maison|hermine|angry|orange|ridhi|pottery|barn/.test(w)) && SCOUT.types.tablecloth.words.some(x => x.w === 'pottery barn') && SCOUT.types.tablecloth.words.some(x => x.w === 'pottery'), tws.join(' | '));
    ok('…most used first', tw.every((e, i, a) => !i || a[i - 1].n >= e.n));
    ok('the bestseller brands go into "other brands" — taken out of our search terms (Lahome, Utopia Home)', ['Lahome', 'Utopia Home'].every(b => C.kwOthers(C.getLR()).includes(b)), C.kwOthers(C.getLR()).join());
    const nw = C.kwScoutWords('napkin').map(e => e.w);
    ok('napkins: farmhouse, wedding, boho, linen, fall … — never "organic" (a restricted claim on the Guard\'s list)', ['farmhouse', 'wedding', 'boho', 'linen', 'fall'].every(w => nw.includes(w)) && !nw.some(w => /organic/.test(w)), nw.join(' | '));
    ok('a product type with no results (placemats) has no words — none are made up', C.kwScoutWords('placemat').length === 0 && C.kwWinFor({ brand: 'SP', sku: 'X', title: 'Ridhi Floral Placemats Set of 4', kw: '', facts: {}, pt: 'PLACEMAT' }).words.length === 0);
    const D = setup({ data: false });
    D.kwUse({ scout: Object.assign(scoutAt(), { types: Object.assign({}, SCOUT.types, { blanket: Object.assign({}, SCOUT.types.tablecloth, { q: 'blanket', pt: 'BLANKET' }) }) }) });
    ok('ANY product type in our listings: an Amazon type the scout read under its own name is the listing\'s type ("BLANKET" → blanket); unknown without it', D.kwTypeOfListing(null, 'BLANKET', 'Ridhi Throw') === 'blanket' && C.kwTypeOfListing(null, 'BLANKET', 'Ridhi Throw') === '');
    D.HEALTH.SP.rows.push({ brand: 'SP', sku: 'BL-1', pt: 'BLANKET' }, { brand: 'SP', sku: 'NP-9', pt: 'NAPKIN' }, { brand: 'SP', sku: 'HM-1', pt: 'HOME' });
    const tl = D.kwScoutTypeList();
    ok('…Run now sends our listings\' product types: ours by their word (napkin → "cloth napkins"), another by its own name (blanket); too-wide ones (HOME) not', tl.some(x => x.join('~') === 'blanket~blanket~BLANKET') && tl.some(x => x.join('~') === 'napkin~cloth napkins~NAPKIN') && !tl.some(x => x[2] === 'HOME'), JSON.stringify(tl));
    const calls = [];
    const R = setup({ baCall: async q => { calls.push(q); if (q.kwscout === 'run') return { ok: true, running: false, last: { ms: 100 } }; if (q.kwscout === 'status') return { ok: true, running: false, last: { ms: 200, types: 6, fail: 0 } }; if (q.cache === 'kwScout') return { ok: true, data: scoutAt() }; return {}; } });
    R.KW.tab = 'scout';
    await R.kwScoutRun();
    ok('↻ Run now asks the backend (?kwscout=run, with our product types) — the page itself calls no Amazon and sends nothing', calls.some(q => q.kwscout === 'run' && typeof q.types === 'string') && R.KW.running && /^Running: the scout is reading/.test(R.KW.runMsg), JSON.stringify(calls));
    const done = await R.kwScoutPoll(0);
    clearTimeout(R.KW.pollT);
    ok('…then where it is (?kwscout=status): done → the new words read again from the backend (?cache=kwScout), every screen works them out again', done && calls.some(q => q.kwscout === 'status') && calls.some(q => q.cache === 'kwScout') && !R.KW.running && /^Done: 6 product types read/.test(R.KW.runMsg), R.KW.runMsg);
    const U = setup({ data: false, baCall: async q => { if (q.kwscout) throw new Error('The backend sent something that is not data: <html>'); return {}; } });
    await U.kwScoutRun();
    ok('the backend not deployed yet: Run now says so — nothing else happens', !U.KW.running && /does not have the scout yet \(KeywordScout\.gs is waiting to be deployed\)/.test(U.KW.runMsg), U.KW.runMsg);
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
    ok('the tablecloth (indigo blue rectangle cotton 60x90): "farmhouse" and "boho" (the most used first) — each with why (not "buffalo plaid": a Christmas word, and a pattern it is not)', w.type === 'tablecloth' && words.join() === 'farmhouse,boho'
      && w.words[0].why === 'used by 12 of the top 25 bestsellers' && w.words[1].why === 'used by 9 of the top 25 bestsellers' && w.words.every(x => x.src === 'scout'), JSON.stringify(w.words.map(x => x.w + ': ' + x.why)));
    ok('skipped: another shape (round), colour (white), material (linen), what it is not (waterproof), a low-value word (elegant), a word under 30 % (rustic), the listing\'s own words (wrinkle free)', !words.some(x => /round|floral|white|linen|waterproof|elegant|rustic|wrinkle|free|70|120/.test(x)), words.join());
    ok('never a season word (christmas … — the Season planner adds those), never a brand (etopia, lahome, utopia home, pottery barn — the IP & Trademark Guard\'s), never a product word', !words.some(x => /christmas|buffalo|plaid|vintage|etopia|lahome|utopia|home|maison|pottery|barn|tablecloth|table/.test(x)), words.join());
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
    ok('…then the ADDED words, the weakest first ("boho", then "farmhouse"), before any of the listing\'s own words is cut — a bestseller word only takes room left over', lastLow < firstCut
      && r.toks.filter(t => t.added).sort((a, b) => a.n - b.n).map(t => t.w).join() === 'boho,farmhouse' && order.findIndex(x => x.why === 'cut to fit') > -1, JSON.stringify([r.notAdded, addCut]));
    // (1 Dec 2026) low value and the leftovers (style, for, her, the, a) go first — so only 4 of its own words are cut to fit, and the
    // bestseller words (they never push its own words out) find no room left
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
    ok('its plan of the over-limit tablecloth: "Shorten to 248 bytes" (no room left for a bestseller word)', /^Shorten to 248 bytes$/.test(plan.what) && !plan.added.length, plan.what);
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
    ok('the data line: "🔎 Bestseller words: the top 25 by Best Seller Rank per product type, scout of … · N words added" — no Brand Analytics', /🔎 Bestseller words: the top 25 by Best Seller Rank per product type, scout of \d+ \w{3} \d{4} · \d+ words? added/.test(s) && !/Brand Analytics|🏆 Winning keywords/.test(s), s.slice(0, 600));
    ok('a removed word struck through with its reason: duplicate, other brand, limit', /<s class="kf-cut" title="duplicate">napkin<\/s><small class="kf-why">duplicate<\/small>/.test(html) && /<s class="kf-cut" title="other brand">angry<\/s>/.test(html) && /title="limit">z{200}<\/s>/.test(html), (html.match(/<div class="kf-text">[\s\S]*?<\/div>/) || [''])[0].slice(0, 1500));
    ok('our brands and important words shown protected 🔒 (with what they are on hover)', /<span class="kf-lock" title="protected: our brand">🔒cpc<\/span>/.test(html) && /title="protected: its product">🔒napkins/.test(html) && /title="protected: its colour">🔒sage/.test(html), html.match(/kf-lock[^<]*<\/span>/g) && html.match(/kf-lock[^<]*<\/span>/g).slice(0, 6).join(' '));
    ok('each added word marked "+ farmhouse (used by 10 of the top 20 bestsellers)"', /<ins class="kf-add">\+ farmhouse<\/ins> <span class="muted">\(used by 10 of the top 20 bestsellers\)<\/span>/.test(html), (html.match(/kf-adds[\s\S]{0,400}/) || [''])[0]);
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

  console.log('== no scout data / old data: that source is skipped — never a made-up keyword ==');
  {
    const N = setup({ data: false });
    const st = N.kwStatus();
    ok('the scout has not run: "Bestseller scout hasn\'t run yet — skipped"', !st.ok && st.text === "Bestseller scout hasn't run yet — skipped", st.text);
    const r = suggest(N, N1, N1.kw);
    ok('…the suggestion only takes out (duplicates, other brands) — nothing is added', r.added.length === 0 && !r.removed.some(x => x.why === 'limit') && r.removed.some(x => x.why === 'repeated') && r.removed.some(x => x.why === 'other brand'), r.after);
    const O = setup({ ranAt: Date.parse('2026-09-01T06:10:00Z') });
    const so = O.kwStatus();
    ok('older than 45 days: "Bestseller scout last ran 1 Sep 2026 — older than 45 days: skipped" — and nothing added', !so.ok && /^Bestseller scout last ran 1 Sep 2026 — older than 45 days: skipped$/.test(so.text) && suggest(O, N1, N1.kw).added.length === 0, so.text);
    ok('…the Workspace / Listing Errors plan says nothing is added either', N.kfPlan(N.kfItemOf('SP', N.HEALTH.SP.rows.find(x => x.sku === T1.sku), N.hCtx(), null)).added.length === 0);
  }

  console.log('== the panel (Listing → Listing Rules · Winning keywords): 📈 Proven in our ads · 🔎 Bestseller words, and the CSV ==');
  {
    C.KW.tab = 'scout'; C.KW.stype = 'tablecloth'; C.KW.q = '';
    const html = C.kwPanelHtml(), s = strip(html);
    ok('two tabs: "📈 Proven in our ads" and "🔎 Bestseller words" — the "🏆 Brand Analytics" tab is gone', /data-kw-tab="ppc"[^>]*>📈 Proven in our ads/.test(html) && /data-kw-tab="scout"[^>]*>🔎 Bestseller words/.test(html) && !/Brand Analytics/.test(html) && !/data-kw-tab="ba"/.test(html), s.slice(0, 300));
    ok('no upload: no file input, no "Upload Brand Analytics", no "No winning-keyword data (nothing uploaded yet)"', !/type="file"|data-kw-file|Upload Brand Analytics|Choose a file|nothing uploaded yet|No winning-keyword data/.test(html));
    ok('per product type: word, % of bestsellers using it, best rank, we use it? yes / no, last run', /Word \/ phrase Bestsellers using it Best rank seen We use it\? Last run/.test(s) && /farmhouse 48% 12 of 25 #120 no 28 Nov 2026/.test(s) && /tablecloth 100% 25 of 25 #120 ✓ yes 28 Nov 2026/.test(s), s.slice(0, 1400));
    ok('the product type picker (with each type\'s word count), ↻ Run now and the last run', /<select data-kw-f="stype"/.test(html) && /Tablecloths \(\d+\)/.test(s) && /Napkins \(\d+\)/.test(s) && /data-kw-act="run"[^>]*>↻ Run now/.test(html) && /Last run: \d+ \w{3} \d{4} \d\d:\d\d \(run now\) · next weekly run about/.test(s), s.slice(0, 900));
    const csv = C.kwScoutCsv();
    ok('the CSV: every product type\'s words, Excel-ready (BOM, CRLF)', /^\uFEFFProduct type,Search,Word \/ phrase,Bestsellers using it,Of the top,Share,Best rank seen,We use it,Last run\r\n/.test(csv.text)
      && /\r\nTablecloths,tablecloth,farmhouse,12,25,48%,120,no,2026-11-28 06:10\r\n/.test(csv.text) && /\r\nNapkins,cloth napkins,farmhouse,10,20,50%,/.test(csv.text), csv.text.slice(0, 400));
    C.KW.tab = '';
    const none = setup({ data: false });
    none.KW.tab = 'scout';
    const nh = strip(none.kwPanelHtml()).replace(/&#39;/g, "'");
    ok('no scout data: the tab says "Bestseller scout hasn\'t run yet — skipped" and offers ↻ Run now', /Bestseller scout hasn't run yet — skipped/.test(nh) && /↻ Run now/.test(nh), nh.slice(0, 400));
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
    ok('PRIORITY: the proven words first, by orders (farmhouse 14, bistro 3), then the bestseller words (boho — "farmhouse" once, from our ads)', w.words.map(x => x.w).join() === 'farmhouse,bistro,boho' && w.proven === 2, w.words.map(x => x.w + '/' + x.src).join());
    const n = P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: N1.kw, facts: facts(P, N1), pt: N1.pt });
    ok('the napkins: "rustic" and "wedding" proven in our ads (7 orders) — the bestseller words then add only what is still missing (farmhouse, boho): "wedding" once, from our ads', n.words.map(x => x.w + '/' + x.src).join() === 'rustic/ppc,wedding/ppc,farmhouse/scout,boho/scout', n.words.map(x => x.w + '/' + x.src).join());
    // space short: a napkin text with room for about one word — the proven word stays, the bestseller ones go first
    let tight = N1.kw.replace(' angry orange maison', '');
    const PAD = 'tea brunch picnic bridal baby kitchen everyday buffet banquet catering hotel cafe linen cocktail luncheon dinnerware gathering restaurant patio garden backyard porch lunch supper feast meal family friends hosting entertaining cottage chalet cabin lodge'.split(' ');
    const base = t => P.lrSuggestWords(t, { mode: 'kw', facts: facts(P, N1), title: N1.title, brands: P.lrBrandWords({ brand: 'CPC' }, P.getLR()), others: P.kwOthers(P.getLR()), fits }).after;
    for (let i = 0; bytes(base(tight)) < 241 && i < PAD.length; i++) tight += ' ' + PAD[i];
    const r = P.lrSuggestWords(tight, { mode: 'kw', facts: facts(P, N1), title: N1.title, brands: P.lrBrandWords({ brand: 'CPC' }, P.getLR()), others: P.kwOthers(P.getLR()), fits,
      add: P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: tight, facts: facts(P, N1), pt: N1.pt }).words });
    ok('space short: the PROVEN words (rustic, wedding) get in — "wedding" takes the room of one of the listing\'s own words with no orders — the bestseller words (farmhouse, boho) do not push anything out; ≤ 249 bytes',
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
    const ba = P.lrSuggestWords(near, { mode: 'kw', facts: N1f, title: N1.title, brands: ['cpc'], fits, proof: proofOf, add: [{ w: 'farmhouse', why: 'used by 10 of the top 20 bestsellers' }] });
    ok('a BESTSELLER word does NOT push out the listing\'s own words: not added, nothing taken out, the text as it was', !ba.added.length && !ba.removed.length && ba.after === near && ba.notAdded.map(a => a.w).join() === 'farmhouse', JSON.stringify([ba.added, ba.removed.map(x => x.w + ':' + x.why)]));

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
    // works with NO scout data
    const U = setup({ data: false, ppc: true });
    const wu = U.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(U, T1), pt: T1.pt });
    ok('works with NO scout data: the proven words alone (farmhouse, bistro) — the scout skipped; the panel opens on "Proven in our ads"', wu.words.map(x => x.w).join() === 'farmhouse,bistro' && /class="segbtn on" data-kw-tab="ppc"/.test(U.kwPanelHtml()), wu.words.map(x => x.w).join());
    // no PPC data → skipped
    const NP = setup({ ppc: 'none' });
    const wn = NP.kwWinFor({ brand: T1.brand, sku: T1.sku, title: T1.title, kw: T1.kw, facts: facts(NP, T1), pt: T1.pt });
    ok('no PPC data: that source is skipped ("No PPC search-term data") — the bestseller words only', !NP.kwPpcStatus().ok && /^No PPC search-term data/.test(NP.kwPpcStatus().text) && wn.words.map(x => x.w).join() === 'farmhouse,boho' && wn.words.every(x => x.src === 'scout'), wn.words.map(x => x.w + '/' + x.src).join());
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
    ok('…a PATTERN and a SEASON it is not said to be: "buffalo" / "plaid" (9 of the top 25 bestsellers) skipped and said; "christmas" too', w.skipped.some(x => x.why === 'skipped: not sure the product is buffalo' && /^Bestseller scout: 9 of the top 25$/.test(x.from)) && w.skipped.some(x => x.why === 'skipped: not sure the product is plaid') && w.skipped.some(x => /christmas/.test(x.term)), sk.join(' ; '));
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
  console.log('== before → after (two listings in our real title format; our ads\' proven words + the sample bestsellers) ==');
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

  console.log('== the search-keyword rules themselves are unchanged; the upload code is gone ==');
  {
    const ROOT = path.join(__dirname, '..', '..');
    let before = null;
    try { before = cp.execSync('git show dae39d46:Pricing-App/src/app/listing/listing-rules.js', { cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { before = null; }
    if (!before) ok('(the rules before this change, dae39d46, are not in this checkout — skipped)', true);
    else {
      const A = load({ src: before }), B = load({});
      const texts = [T1.kw, N1.kw, 'ridhi ridhi napkins etopia style dinner gift for her washable', 'napkins sage green cotton hot pink light blue fun cute rhidi 18x18 20x20', 'cpc cotton print club whimsical corner napkins pottery barn style organic'];
      const add = [{ w: 'farmhouse', why: "PPC: 14 orders from 'farmhouse tablecloth' in 30 days", proven: true }, { w: 'boho', why: 'used by 9 of the top 25 bestsellers' }, { w: 'wedding', why: 'used by 8 of the top 20 bestsellers' }];
      const run = (X, t, L) => { const r = X.lrSuggestWords(t, { mode: 'kw', facts: X.lrSwFacts({ brand: L.brand, sku: L.sku }, null, null, { title: L.title, pt: L.pt }), title: L.title, brands: ['ridhi', 'cpc', 'whimsical corner', 'cotton print club'], others: ['Etopia', 'Angry Orange', 'Maison'], add, proof: ['picnic'], fits });
        return JSON.stringify([r.after, r.removed.map(x => [x.w, x.why, x.by]), r.added, r.notAdded, r.important]); };
      ok('every search-terms answer is the same as before this change (dae39d46), word for word — our brands once, 🔒 words, duplicates, other brands, low value, leftovers, colours, sizes, 249 bytes, proven words before bestseller words',
        texts.every(t => [T1, N1].every(L => run(A, t, L) === run(B, t, L))));
    }
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'kw-win.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok('kw-win.js: the upload code is gone (no file reading, no history/kwwin_* or kwsqp_* reads or writes) — what was uploaded stays stored, unused', !/kwUpload|kwParse|kwwin|kwsqp|getDocs|setDoc|deleteDoc|type="file"|file\.text\(/.test(src));
    const fix = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'kw-fix.js'), 'utf8');
    ok('Fix search terms: no Brand Analytics line or upload either — its sources are 📈 our ads and 🔎 the bestseller words', !/Brand Analytics|🏆|kwUpload|type="file"/.test(fix) && /line\(pp, nP, '📈'\) \+ line\(st, nB, '🔎'\)/.test(fix));
  }

  console.log('== priority: PPC proven words > bestseller words; a bestseller word never replaces the listing\'s own words ==');
  {
    const P = setup({ ppc: true });
    const N1f = facts(P, N1);
    const fill = (start, pad, to) => { let t = start; for (let i = 0; bytes(t) < to; i++) t += ' ' + pad + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)); return t; };
    const near = fill('napkins sage green cotton cpc dinner washable reusable', 'w', 246);
    const w = P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: near, facts: N1f, pt: N1.pt });
    const r = P.lrSuggestWords(near, { mode: 'kw', facts: N1f, title: N1.title, brands: ['cpc'], fits, add: w.words, proof: w.proof });
    const own = keysOf(near);
    ok('a nearly full text: the proven words (rustic, wedding) take room of its own words with no orders; the bestseller words (farmhouse, boho) are NOT added and take nothing', r.added.every(a => a.proven) && r.added.length >= 1 && r.notAdded.filter(a => !a.proven).map(a => a.w).sort().join() === 'boho,farmhouse'
      && r.removed.filter(x => x.why === 'replaced').every(x => ['rustic', 'wedding'].includes(x.by)), JSON.stringify([r.added, r.notAdded, r.removed.map(x => x.w + ':' + x.why + ':' + (x.by || ''))]));
    const room = 'napkins sage green cotton cpc dinner washable reusable';
    const r2 = P.lrSuggestWords(room, { mode: 'kw', facts: N1f, title: N1.title, brands: ['cpc'], fits, add: P.kwWinFor({ brand: N1.brand, sku: N1.sku, title: N1.title, kw: room, facts: N1f, pt: N1.pt }).words });
    ok('with room: every word — proven first, then the bestseller words — added at the end, the listing\'s own words all kept', r2.added.map(a => a.w).join() === 'rustic,wedding,farmhouse,boho' && own.slice(0, 8).every(k => keysOf(r2.after).includes(k)) && !r2.removed.length, r2.after);
    ok('…the reason on a bestseller word: "used by 10 of the top 20 bestsellers"', r2.added.find(a => a.w === 'farmhouse').why === 'used by 10 of the top 20 bestsellers');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
