/* N-Gram Analysis (src/app/ads/ngram.js), the pattern index it shares with Search Term Analysis's "By word" (staGramIndex in
 * ads/search-terms.js) and the status dropdown both screens use (staStatus), over the real files in a stub page (the same one
 * ppc-history-test.js uses), with a small sample account.
 *   node tests/ngram-test.js
 * Covers: counting (1-, 2-, 3-word sequences, a term once per pattern, stop words, ASIN, negated and data-check terms left
 * out, the tail), every classification rule (the chance test, the $10 floor, break-even, the loss line, Winner, Mixed, no unit
 * costs), protected patterns get no negative, blocked words and competitor brands, the negate plan keeps campaigns where it
 * sells, the harvest pick, the dialogs it opens and the selection bar, By word rows unchanged after the refactor (against
 * search-terms.js at BEFORE), the status summary (notes, red and open by itself when suggestions are blocked), the page
 * drawn, the CSV, and the speed of a re-filter on 20,000 terms. 26 Nov: the per-campaign evidence before a negative, the
 * popup's campaign table and its ticks, the popup's and the page's Excel files (names, sheets, columns, totals), the bulk
 * file's bytes unchanged by the several-sheet writer, the two kinds of Waste and their filters, and No-order spend. */
const cp = require('child_process');
const { setup } = require('./ppc-history-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
// search-terms.js before the pattern index was shared (the PPC History commit, 21 Nov 2026).
const BEFORE = '51f8c075';
const NAMES = ['ST', 'STS', 'STA', 'STA_SET_DEF', 'staModel', 'staDataLine', 'staStatus', 'renderSt', 'staDlgOk', 'staOpen',
  'NG', 'NGS', 'ngBuild', 'ngClassOf', 'ngCls', 'ngNext', 'ngPlan', 'ngHarvest', 'ngWordRow', 'ngRows', 'ngCsvLines', 'NG_CSV_COLS', 'renderNg', 'ensureNgram', 'ngQuick', 'getNGX: () => NGX', 'staGramIndex', 'ngDistinct', 'ensureSt', 'staLoadSure',
  'NG_CLS', 'STA_NOTGT', 'staChance', 'PLX_CHIPS', 'ngLegend',
  'ngNos', 'ngSetCls', 'ngCpRate', 'ngCpWhy', 'ngPlanAll', 'ngPatternSheets', 'ngWasteSheets', 'ngXlsxName', 'ngXlsxWasteName', 'ngFilters', 'NG_WK',
  'NG_XL_CP', 'NG_XL_TERMS', 'NG_XL_PAT', 'NG_XL_WCP', 'staXlsx', 'staXlsxBook', 'staFileName', 'staBulkFiles', 'STA_BULK_COLS', 'getNGLAST: () => NG_LAST'];
// The real zip and XML helpers (Listing Content's), for the Excel files; the stub page has empty ones.
const LCS = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-content.js'), 'utf8');
const LC = new Function(LCS.slice(LCS.indexOf('const LC_CRC'), LCS.indexOf('/** One sheet, a bold frozen heading')) + '\nreturn { lcZip, lcXml, lcColName };')();
// A stub page that keeps every download: { files: [{ name, bytes }], revoked: [url], timers: [ms] }.
function dlCtx(dl) {
  let last = null;
  return { lcZip: LC.lcZip, lcXml: LC.lcXml, lcColName: LC.lcColName,
    Blob: class { constructor(p, o) { this.p = p; this.type = o && o.type; } },
    URL: { createObjectURL: b => { last = b; return 'blob:' + dl.files.length; }, revokeObjectURL: u => dl.revoked.push(u) },
    document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => { const a = { click() { dl.files.push({ name: a.download, href: a.href, bytes: last.p[0], type: last.type }); } }; return a; } },
    setTimeout: (f, ms) => { dl.timers.push(ms); if (!(ms > 2000)) Promise.resolve().then(f); return 0; } };
}
// A stored zip (no compression) → { name: text }; a sheet's XML → rows of cells ({ v, s }), by column.
function unzip(u8) {
  const out = {}, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let i = 0;
  while (i + 4 <= u8.length && dv.getUint32(i, true) === 0x04034b50) {
    const size = dv.getUint32(i + 18, true), nl = dv.getUint16(i + 26, true), xl = dv.getUint16(i + 28, true);
    const name = Buffer.from(u8.slice(i + 30, i + 30 + nl)).toString();
    out[name] = Buffer.from(u8.slice(i + 30 + nl + xl, i + 30 + nl + xl + size)).toString('utf8');
    i += 30 + nl + xl + size;
  }
  return out;
}
const colIx = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const unXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function sheetRows(xml) {
  return [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map(m => {
    const row = [];
    for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"( t="inlineStr")?(?: s="(\d+)")?>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)<\/c>/g)) {
      row[colIx(c[1])] = { v: c[2] ? unXml(c[5]) : Number(c[4]), s: Number(c[3] || 0) };
    }
    return row;
  });
}
// A downloaded .xlsx: { names: [sheet names], sheets: { name: rows }, styles }.
function book(bytes) {
  const z = unzip(bytes);
  const names = [...z['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => unXml(m[1]));
  const sheets = {};
  names.forEach((n, i) => { sheets[n] = sheetRows(z[`xl/worksheets/sheet${i + 1}.xml`]); });
  return { names, sheets, z };
}
const vals = row => [...row].map(c => (c ? c.v : ''));
const ngSetAll = (C, cls) => { C.ngSetCls(cls); C.renderNg(); };

// An IST stamp "yyyy-MM-dd HH:mm" for now (the caches' own format): fresh data.
const nowIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const T = (t, cid, ag, c, sp, o, s, kw, mt) => ({ t, cid, ag, c, sp, o: o || 0, s: s || 0, i: c * 20, kw: kw || 'close-match', mt: mt || 'TARGETING_EXPRESSION_PREDEFINED' });
// The sample: Ridhi with three campaigns (runner broad, napkins auto, an exact campaign), Cotton Print Club small.
function account(C, o) {
  o = o || {};
  const SP = [
    T('table runner', 'c1', 'a1', 200, 100, 20, 500, 'table runner', 'BROAD'),
    // Waste by "0 orders, unlikely to be chance": plastic, in two campaigns.
    T('plastic table runner', 'c1', 'a1', 90, 27, 0, 0, 'table runner', 'BROAD'),
    T('plastic tablecloth', 'c2', 'a2', 60, 18, 0, 0),
    // Waste by "above break-even" with orders in one campaign only: vinyl — the plan keeps c3.
    // (26 Nov: enough clicks in each campaign to tell — under 1% chance at that campaign's order rate.)
    T('vinyl table runner', 'c1', 'a1', 60, 15, 0, 0, 'table runner', 'BROAD'),
    T('vinyl tablecloth', 'c2', 'a2', 140, 12, 0, 0),
    T('vinyl napkins', 'c3', 'a3', 20, 20, 3, 30, 'vinyl napkins', 'PHRASE'),
    // Winner: linen; its best term (lowest ACoS, 3+ orders, no exact keyword) is "linen placemats".
    T('linen napkins', 'c2', 'a2', 40, 20, 6, 120),
    T('linen table runner', 'c1', 'a1', 20, 10, 2, 50, 'table runner', 'BROAD'),
    T('linen placemats', 'c2', 'a2', 10, 6, 3, 60),
    // Needs data: boho (few clicks), cotton (0 orders, could be chance), paper (0 orders, under $10).
    T('boho decor', 'c1', 'a1', 6, 3, 0, 0, 'table runner', 'BROAD'),
    T('cotton throw', 'c2', 'a2', 12, 6, 0, 0),
    T('paper doilies', 'c2', 'a2', 150, 8, 0, 0),
    // Your lists: a blocked word and a competitor brand, at tiny spend.
    T('cheap napkins', 'c2', 'a2', 3, 1.5, 0, 0),
    T('acme runner', 'c1', 'a1', 4, 2, 0, 0, 'table runner', 'BROAD'),
    // Protected: the brand term, losing.
    T('ridhi tablecloth', 'c2', 'a2', 120, 60, 0, 0),
    // Mixed: floral, between target and break-even on 2 orders.
    T('floral tablecloth', 'c2', 'a2', 30, 14, 2, 40),
    // Left out: negated at Amazon, an ASIN search, a data-check row.
    T('velvet runner', 'c1', 'a1', 50, 30, 0, 0, 'table runner', 'BROAD'),
    T('b0abc12345', 'c2', 'a2', 10, 5, 0, 0),
    T('broken tassel', 'c1', 'a1', 5, 2, 1, 0, 'table runner', 'BROAD'),
    // A second search term for each pattern above that had one (22 Nov: a pattern needs 2 terms), keeping its class.
    T('ridhi napkins', 'c2', 'a2', 40, 20, 0, 0),
    T('floral napkins', 'c2', 'a2', 10, 3, 0, 0),
    T('boho runner', 'c1', 'a1', 3, 1.5, 0, 0, 'table runner', 'BROAD'),
    T('cotton placemats', 'c2', 'a2', 8, 4, 0, 0),
    T('paper napkins', 'c2', 'a2', 20, 1, 0, 0),
    T('cheap placemats', 'c2', 'a2', 2, 1, 0, 0),
    T('acme placemats', 'c2', 'a2', 2, 1, 0, 0),
  ].concat(o.extra ? [
    // Merged: "mudcloth", "tribal" and "mudcloth tribal" are held by exactly the same two terms.
    T('mudcloth tribal pillow', 'c2', 'a2', 30, 12, 0, 0), T('mudcloth tribal throw', 'c2', 'a2', 30, 12, 0, 0),
    // Stop words at an edge ("dish towels for"), a number inside ("18 18 pillow").
    T('dish towels for kitchen', 'c2', 'a2', 6, 2, 0, 0), T('dish towels for bar', 'c2', 'a2', 6, 2, 0, 0),
    T('18 18 pillow cover', 'c2', 'a2', 6, 2, 0, 0), T('18 18 pillow case', 'c2', 'a2', 6, 2, 0, 0),
    // Waste above break-even, but it sells in each campaign it spends in: nothing to negate.
    T('jute rug', 'c1', 'a1', 40, 40, 2, 50, 'table runner', 'BROAD'), T('jute mat', 'c2', 'a2', 30, 30, 1, 25),
  ] : []);
  const CPC = o.cpcEmpty ? [] : [T('cotton print club napkins', 'k1', 'b1', 30, 6, 4, 80, 'napkins', 'BROAD'), T('plain napkins', 'k1', 'b1', 40, 12, 1, 20, 'napkins', 'BROAD')]
    // Ridhi's brand term searched in Cotton Print Club: a sister brand there.
    .concat(o.sister ? [T('ridhi pillow covers', 'k1', 'b1', 150, 45, 0, 0, 'napkins', 'BROAD'), T('ridhi cushion', 'k1', 'b1', 150, 40, 0, 0, 'napkins', 'BROAD')] : []);
  const names = { c1: 'SP - Runner - Broad', c2: 'SP - Napkins - Auto', c3: 'SP - Exact', a1: 'Runner broad', a2: 'Napkins auto', a3: 'Exact napkins', a4: 'Exact runner',
    k1: 'CPC - Napkins', b1: 'Napkins' };
  const ST = C.ST;
  ST.set = { at: nowIst(), d: { SP: { rows: SP, from: '2026-10-14', to: '2026-11-12', names, grams: o.tail ? [['plastic', 6, 30, 9, 0, 0, [['c1', 9]]]] : [] } } };
  if (CPC.length) ST.set.d.CPC = { rows: CPC, from: '2026-10-14', to: '2026-11-12', names };
  ST.tgts = { SP: { rows: [{ t: 'table runner', mt: 'BROAD', ag: 'a1', cid: 'c1', c: 300, sp: 150, o: 25, s: 600 }, { t: 'close-match', mt: 'TARGETING_EXPRESSION_PREDEFINED', ag: 'a2', cid: 'c2', c: 400, sp: 160, o: 14, s: 300 },
    { t: 'vinyl napkins', mt: 'PHRASE', ag: 'a3', cid: 'c3', c: 20, sp: 20, o: 3, s: 30 }, { t: 'napkin set', mt: 'EXACT', ag: 'a3', cid: 'c3', c: 5, sp: 3, o: 1, s: 20 }], names },
    CPC: { rows: [{ t: 'napkins', mt: 'BROAD', ag: 'b1', cid: 'k1', c: 70, sp: 18, o: 5, s: 100 }], names } };
  ST.terms = {};
  ST.ag = { SP: { rows: [{ ag: 'a1', a: 'B0RUNNER01', s: 600, sp: 150 }, { ag: 'a2', a: 'B0NAPKIN01', s: 300, sp: 160 }, { ag: 'a3', a: 'B0NAPKIN01', s: 50, sp: 23 }],
    groups: { a1: { a: ['B0RUNNER01'] }, a2: { a: ['B0NAPKIN01'] }, a3: { a: ['B0NAPKIN01'] } }, parent: {} }, CPC: { rows: [{ ag: 'b1', a: 'B0CPCNAP01', s: 100, sp: 18 }], groups: { b1: { a: ['B0CPCNAP01'] } }, parent: {} } };
  ST.ent = { at: nowIst(), d: { SP: { kw: [], tg: [], neg: [['cp', 'n1', 'c1', '', 'velvet runner', 'NEGATIVE_EXACT']], cp: {}, ag: {} }, CPC: { kw: [], tg: [], neg: [], cp: {}, ag: {} } } };
  ST.loaded = true; ST.extra = true; ST.costs = false;
  const fresh = { ok: true, at: nowIst(), err: {} };
  ST.src = { srchTerm: fresh, targeting: fresh, adGroup: fresh, adEntities: fresh, stSettled: fresh, tgtSettled: fresh };
  C.STS.SP = Object.assign({}, C.STA_SET_DEF.SP, { competitors: ['acme'] }, o.noTarget ? {} : { fallbackTgt: 30, fallbackBe: 45 });
  C.STS.CPC = Object.assign({}, C.STA_SET_DEF.CPC, o.noTarget ? {} : { fallbackTgt: 30, fallbackBe: 45 });
  C.STS.where = 'fs';
  C.STS.stamp = (C.STS.stamp || 0) + 1;
}
// 20,000 search terms over 50 words, the same every run (the speed test, and By word compared on a big account).
function bigRows() {
  const words = ['red', 'blue', 'linen', 'cotton', 'floral', 'boho', 'round', 'square', 'oval', 'christmas', 'farmhouse', 'rustic', 'modern', 'kitchen', 'dining', 'outdoor',
    'waterproof', 'washable', 'vintage', 'gingham', 'striped', 'plaid', 'white', 'black', 'green', 'pink', 'gold', 'navy', 'beige', 'grey', 'table', 'runner', 'cloth',
    'napkins', 'placemats', 'cover', 'set', 'large', 'small', 'long', 'wide', 'party', 'wedding', 'holiday', 'fall', 'spring', 'summer', 'winter', 'easter', 'cheap'];
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const rows = [];
  for (let i = 0; i < 20000; i++) {
    const len = 2 + rnd(4), t = [];
    for (let j = 0; j < len; j++) t.push(words[rnd(words.length)]);
    const c = 1 + rnd(40), o = rnd(10) === 0 ? 1 + rnd(3) : 0;
    rows.push(T(t.join(' ') + ' ' + i % 997, ['c1', 'c2', 'c3'][i % 3], ['a1', 'a2', 'a3'][i % 3], c, c * 0.4, o, o * 25));
  }
  return rows;
}
function page(o) {
  const S = setup(Object.assign({ ngram: true, names: NAMES }, o || {}));
  account(S.C, o);
  S.$('stBrand').value = 'ALL';
  return S;
}
const byGram = (C, b, gram) => C.getNGX().rows.find(g => g.brand === b && g.gram === gram);

(async () => {
  console.log('== counting: sequences, stop words, what is left out ==');
  const A = page();
  {
    const { C } = A;
    const M = C.staModel('ALL');
    const idx = M.grams.SP;
    ok('the index is built with the model, once per brand', idx && M.grams.CPC && C.staGramIndex('SP', M) === idx);
    ok('1-, 2- and 3-word sequences of a term', idx.has('plastic') && idx.has('plastic table') && idx.has('plastic table runner') && idx.has('table runner'));
    const pr = idx.get('plastic');
    ok('a term counts once per pattern: "plastic" in 2 terms, its clicks and spend summed', pr.n === 2 && pr.c === 150 && pr.sp === 45 && pr.terms.every(r => typeof r === 'object' && r.term));
    ok('"table runner" counts each term holding it once (4 terms)', idx.get('table runner').n === 4, String(idx.get('table runner').n));
    ok('one-word patterns skip stop words, short words and numbers', !idx.has('for') && !idx.has('the') && !idx.has('b0abc12345'));
    ok('ASIN searches are left out', ![...idx.values()].some(x => x.terms.some(r => r.asin)));
    ok('data-check rows are left out', !idx.has('broken') && !idx.has('tassel'));
    C.NGS.size = 0;
    const X = C.ngBuild(M);
    ok('terms already negated at Amazon are left out of N-Gram (velvet)', !X.rows.some(g => g.gram === 'velvet') && !!idx.get('velvet'));
    ok('a pattern\'s figures are over the terms not negated: "runner" without velvet', (() => { const g = X.rows.find(y => y.brand === 'SP' && y.gram === 'runner'); return g && !g.terms.some(r => r.term === 'velvet runner'); })());
  }

  console.log('== classification rules ==');
  {
    const { C } = A;
    const G = o => Object.assign({ o: 0, c: 100, sp: 30, s: 0, acos: null, p: 0.05, chance: 0.004, tgt: 30, be: 45, costsOn: true, tag: '' }, o);
    const cls = o => C.ngClassOf(G(o)).base;
    ok('Waste (a): 0 orders, under 1% chance, $10+ spent', cls({}) === 'waste' && /only 0\.4% chance/.test(C.ngClassOf(G({})).why));
    ok('Needs data: 0 orders, 1% chance or more — "about N more clicks to tell"', cls({ chance: 0.01 }) === 'need' && /more clicks to tell/.test(C.ngClassOf(G({ chance: 0.02 })).why));
    ok('Needs data: 0 orders under $10 (the floor)', cls({ sp: 9.99 }) === 'need' && cls({ sp: 10 }) === 'waste' && /judged from \$10\.00/.test(C.ngClassOf(G({ sp: 8 })).why));
    ok('Needs data: nothing in the brand sold yet', cls({ p: null, chance: null }) === 'need');
    ok('Waste (b): 3+ orders above break-even', cls({ o: 3, s: 50, sp: 30, acos: 60 }) === 'waste' && cls({ o: 2, s: 50, sp: 30, acos: 60 }) === 'mixed');
    ok('Waste (c): ACoS over 100% with $20+, even without unit costs', cls({ o: 1, s: 15, sp: 20, acos: 133, tgt: null, be: null, costsOn: false }) === 'waste'
      && cls({ o: 1, s: 15, sp: 19, acos: 127, tgt: null, be: null, costsOn: false }) === 'mixed');
    ok('Winner: 2+ orders at or under target', cls({ o: 2, s: 100, sp: 30, acos: 30 }) === 'winner' && cls({ o: 1, s: 100, sp: 30, acos: 30 }) === 'mixed');
    ok('Mixed: between target and break-even', cls({ o: 5, s: 100, sp: 40, acos: 40 }) === 'mixed' && /between target 30\.0% and break-even 45\.0%/.test(C.ngClassOf(G({ o: 5, s: 100, sp: 40, acos: 40 })).why));
    ok('No unit costs or target: above break-even and Winner are off', cls({ o: 5, s: 100, sp: 10, acos: 10, tgt: null, be: null, costsOn: false }) === 'mixed'
      && cls({ o: 5, s: 100, sp: 60, acos: 60, tgt: null, be: null, costsOn: false }) === 'mixed');
    ok('blocked word or competitor brand: Waste at any spend', cls({ tag: 'blocked', sp: 0.5, c: 1, chance: 0.9 }) === 'waste' && cls({ tag: 'comp', sp: 0.2, c: 1 }) === 'waste');
    ok('Minimum clicks: fewer is Needs data, except your lists', C.ngCls({ tag: '', c: 9, base: 'waste' }, 10) === 'need' && C.ngCls({ tag: '', c: 10, base: 'waste' }, 10) === 'waste' && C.ngCls({ tag: 'blocked', c: 1, base: 'waste' }, 10) === 'waste');
    // On the sample.
    const b = g => C.ngCls(byGram(C, 'SP', g), 10);
    ok('sample: plastic Waste, vinyl Waste, linen Winner, floral Mixed', b('plastic') === 'waste' && b('vinyl') === 'waste' && b('linen') === 'winner' && b('floral') === 'mixed',
      ['plastic', 'vinyl', 'linen', 'floral'].map(x => x + ':' + b(x)).join(' '));
    ok('sample: boho, cotton, paper Needs data (few clicks · could be chance · under $10)', b('boho') === 'need' && b('cotton') === 'need' && b('paper') === 'need'
      && /under|judged from \$10/.test(byGram(C, 'SP', 'paper').why) && /more clicks/.test(byGram(C, 'SP', 'cotton').why), byGram(C, 'SP', 'paper').why);
    ok('sample: cheap is Waste labelled Blocked word, acme Competitor brand', b('cheap') === 'waste' && byGram(C, 'SP', 'cheap').tags.includes('blocked') && b('acme') === 'waste' && byGram(C, 'SP', 'acme').tags.includes('comp'));
    ok('sample: target and break-even weighted from its terms (your settings 30 / 45)', Math.abs(byGram(C, 'SP', 'linen').tgt - 30) < 0.01 && Math.abs(byGram(C, 'SP', 'linen').be - 45) < 0.01);
  }

  console.log('== protected patterns, the plan, the harvest ==');
  {
    const { C } = A;
    const ridhi = byGram(C, 'SP', 'ridhi');
    ok('the brand term is protected', ridhi.protect === 'brand' && ridhi.tags.includes('brand'));
    const nap = byGram(C, 'SP', 'napkins');
    ok('the brand\'s product word is protected ("napkins")', nap && nap.protect === 'product', nap && nap.tags.join(','));
    const rn = C.ngNext(ridhi, 10);
    ok('a protected pattern gets no negative: "Lower bids instead"', C.ngCls(ridhi, 10) === 'waste' ? rn.act === 'low' && /never negated/.test(rn.text) : rn.act !== 'neg', JSON.stringify(rn));
    const v = byGram(C, 'SP', 'vinyl');
    const P = C.ngPlan(v);
    ok('the negate plan: no-order campaigns negated, the one where it sells kept', P.neg.map(c => c.cid).sort().join(',') === 'c1,c2' && P.kept.map(c => c.cid).join(',') === 'c3');
    const nv = C.ngNext(v, 10);
    ok('Waste: "Negate in 2 campaigns", kept where it sells', nv.act === 'neg' && nv.n === 2 && /sells in 1 campaign: lower bids there/.test(nv.text), JSON.stringify(nv));
    const w = C.ngWordRow(v);
    ok('the pattern shaped like a By word row', w.type === 'word' && w.key === 'w:SP|vinyl' && w.gram === 'vinyl' && w.cps.length === 2 && w.cps.every(c => c.o === 0) && w.protect === '');
    const h = C.ngHarvest(byGram(C, 'SP', 'linen'));
    ok('the harvest pick: lowest ACoS with 3+ orders under target, no exact keyword yet', h.r && h.r.term === 'linen placemats', JSON.stringify(h.why || h.r.term));
    const fl = C.ngHarvest(Object.assign({}, byGram(C, 'SP', 'floral'), { _harv: null }));
    ok('no term qualifies: says why', !fl.r && /no term with 3\+ orders under target yet/.test(fl.why));
    // The dialogs: Search Term Analysis's own.
    C.staOpen('word', w.key, w);
    ok('Negate opens the By word dialog with the plan\'s campaigns', !A.$('stDlg').classList.contains('hide') && /Add negative phrase "vinyl"/.test(A.$('stDlgTitle').textContent)
      && (A.$('stDlgBody').innerHTML.match(/data-cp=/g) || []).length === 3 && (A.$('stDlgBody').innerHTML.match(/data-cp="\d" checked/g) || []).length === 2, A.$('stDlgTitle').textContent);
    A.$('stDlg').classList.add('hide');
    C.staOpen('exact', h.r.key, Object.assign({}, h.r, { sugBid: 0.6, ceil: 1 }));
    ok('Harvest opens the Add as exact dialog for that term', /Add as exact keyword/.test(A.$('stDlgTitle').textContent) && /linen placemats/.test(A.$('stDlgSub').innerHTML));
    A.$('stDlg').classList.add('hide');
    // The selection bar's quick add, through the same item builders.
    const q = C.ngQuick(v, {});
    ok('the selection bar: one negative phrase per no-order campaign (staWordItems)', q.items && q.items.length === 2 && q.items.every(x => x.kind === 'neg' && x.neg.type === 'negativePhrase' && x.neg.level === 'cp' && x.wkey === 'w:SP|vinyl')
      && q.items.map(x => x.cid).sort().join(',') === 'c1,c2', JSON.stringify(q.skip || q.items.map(x => x.cid)));
    const qh = C.ngQuick(byGram(C, 'SP', 'linen'), {});
    ok('the selection bar: the harvested term as an exact keyword in an ad group of its product', qh.items && qh.items[0].kind === 'exact' && qh.items[0].term === 'linen placemats' && qh.items[0].dest.ag === 'a3', JSON.stringify(qh.skip || qh.items[0].dest));
    ok('the day\'s limit: no more than 60 negatives a brand', /day's limit/.test((C.ngQuick(v, { SP: 59 }) || {}).skip || ''));
    ok('a protected pattern is never quick-negated', !!C.ngQuick(ridhi, {}).skip);
  }

  console.log('== By word: the same rows as before the shared index ==');
  {
    let old = null;
    try { old = cp.execSync(`git show ${BEFORE}:Pricing-App/src/app/ads/search-terms.js`, { cwd: __dirname, maxBuffer: 1e8 }).toString('utf8'); } catch (e) { old = null; }
    // placement-decide.js (today's) reads the shared "no target" wording made later in search-terms.js.
    const oldPlus = old && old + "\nconst STA_NOTGT = 'Has orders · not judged (no target)';";
    if (!old) ok('commit ' + BEFORE + ' readable with git', false);
    else {
      for (const tail of [false, true]) {
        const was = setup({ stText: oldPlus, names: ['ST', 'STS', 'STA_SET_DEF', 'staModel'] });
        account(was.C, { tail });
        const now = page({ tail });
        const a = JSON.stringify(was.C.staModel('ALL').words), z = JSON.stringify(now.C.staModel('ALL').words);
        ok(`By word rows identical before and after${tail ? ' (with the backend\'s tail)' : ''}: ${JSON.parse(z).length} rows`, a === z && JSON.parse(z).length > 0, a === z ? '' : a.slice(0, 300) + ' ≠ ' + z.slice(0, 300));
      }
      const was = setup({ stText: oldPlus, names: ['ST', 'STS', 'STA_SET_DEF', 'staModel'] }), now = page({ tail: true });
      account(was.C, { tail: true });
      const big = bigRows();
      was.C.ST.set.d.SP.rows = big;
      now.C.ST.set.d.SP.rows = big.map(r => Object.assign({}, r));
      was.C.STS.stamp++; now.C.STS.stamp++;
      const a = JSON.stringify(was.C.staModel('ALL').words), z = JSON.stringify(now.C.staModel('ALL').words);
      ok(`By word rows identical before and after on 20,000 terms: ${JSON.parse(z).length} rows`, a === z && JSON.parse(z).length > 0, a === z ? '' : 'they differ');
    }
  }

  console.log('== the status line (staStatus) ==');
  {
    const { C, $, store } = page();
    $('paneSt').classList.remove('hide');
    C.ST_RL.where = 'local';
    C.renderSt();
    const btn = $('stMsg').innerHTML;
    ok('one summary line: the window, both brands complete, the notes', /Data: settled 14 Oct – 12 Nov/.test(strip(btn)) && /✓ both brands complete/.test(btn) && /2 notes/.test(strip(btn)) /* the data-check row, and this browser only */, strip(btn).slice(0, 200));
    ok('a button with aria-expanded and aria-controls, closed at first', /<button type="button" class="ghost sta-stat" aria-expanded="false" aria-controls="stMsgP">/.test(btn) && /id="stMsgP" class="sta-more-f sta-msg sta-stat-p hide"/.test(btn));
    ok('the panel holds every line, as before', /Judged on <b>settled clicks/.test(btn) && /kept in this browser only/.test(btn) && /Amazon data:/.test(btn));
    // Opened by hand: remembered on this device.
    const click = () => $('stMsg').listeners.click.forEach(f => f({ target: { closest: s => (s === 'button.sta-stat' ? { setAttribute() {}, querySelector: () => ({}) } : null) } }));
    click();
    ok('open / closed is remembered on this device (staStatOpen)', JSON.parse(store.staStatOpen || '{}').stMsg === true);
    // Blocked: Cotton Print Club without search terms → red, and open by itself.
    const B = page({ cpcEmpty: true });
    B.$('paneSt').classList.remove('hide');
    B.C.renderSt();
    const h = B.$('stMsg').innerHTML;
    ok('a brand with no search terms: red, and the panel opens by itself', /class="ghost sta-stat is-bad" aria-expanded="true"/.test(h) && /✗ Cotton Print Club: no suggestions/.test(h) && /id="stMsgP" class="sta-more-f sta-msg sta-stat-p"/.test(h), strip(h).slice(0, 160));
    ok('the notes count the warning and error lines (no data, a data-check row, this browser only)', /3 notes/.test(strip(h)), strip(h).slice(0, 120));
    // No unit costs and no target: the yellow banner and its button, in the panel.
    const N = page({ noTarget: true });
    N.$('paneSt').classList.remove('hide');
    N.C.renderSt();
    ok('no costs and no target: the banner with "Set a target ACoS", counted as a note', /sta-warnline sta-costwarn/.test(N.$('stMsg').innerHTML) && /data-settgt="1"/.test(N.$('stMsg').innerHTML) && /3 notes/.test(strip(N.$('stMsg').innerHTML)), strip(N.$('stMsg').innerHTML).slice(0, 120));
  }

  console.log('== the page ==');
  {
    const S = page();
    const { C, $ } = S;
    $('paneNgram').classList.remove('hide');
    await C.ensureNgram();
    const t = $('ngTable').innerHTML;
    ok('1-word patterns by spend, quoted, with tag badges', /"plastic"/.test(t) && !/"plastic table"/.test(t) && t.indexOf('"ridhi"') < t.indexOf('"plastic"') && /Brand term/.test(t), strip(t).slice(0, 200));
    ok('the columns of the brief', /N-gram.*Classification.*Search terms.*Clicks.*Ad spend.*Ad sales.*Orders.*ACoS.*CVR.*Campaigns.*Converting terms.*Next step/.test(strip(t.slice(0, t.indexOf('</thead>')))));
    ok('Negate and Harvest buttons, Lower bids instead on the brand term', /Negate in 2 campaigns/.test(t) && /Harvest best term/.test(t) && /Lower bids instead/.test(t));
    ok('the four boxes', ['Waste patterns', 'Winner patterns', 'Mixed', 'Needs data'].every(x => $('ngBoxes').innerHTML.includes(x)));
    ok('the chips: All, Waste, Winner, Mixed, Needs data, and the Protected only toggle, with counts', /data-a=""[^>]*>All<span>/.test($('ngActBar').innerHTML) && /data-prot="1"[^>]*>Protected only<span>\d+<\/span>/.test($('ngActBar').innerHTML));
    ok('the footer says how patterns are counted', /a term counts once for every pattern it holds/.test($('ngFoot').innerHTML));
    ok('the status line', /Data: settled 14 Oct – 12 Nov/.test(strip($('ngMsg').innerHTML)) && /aria-controls="ngMsgP"/.test($('ngMsg').innerHTML));
    C.NGS.size = 2;
    C.renderNg();
    ok('2-word: "table runner" (many terms), no 1-word row, none of one search term ("ridhi tablecloth")', /"table runner"/.test($('ngTable').innerHTML) && !/"plastic"/.test($('ngTable').innerHTML)
      && !/"ridhi tablecloth"/.test($('ngTable').innerHTML) && /n-grams? of a single search term left out/.test($('ngSub').innerHTML), strip($('ngTable').innerHTML).slice(0, 300));
    C.NGS.size = 1; C.NGS.cls = ''; C.NGS.open.add('w:SP|vinyl');
    C.renderNg();
    const so = $('ngTable').innerHTML;
    ok('a row opens: the terms behind it, and what the action does per campaign', /Terms behind it/.test(so) && /vinyl napkins/.test(so) && /Negate here/.test(so) && /Kept: sells here/.test(so) && /Negatives left today for Ridhi: 60 of 60/.test(strip(so)));
    const csv = C.ngCsvLines(C.ngRows(C.getNGX(), { brand: 'ALL', q: '', size: 1 }), 10);
    ok('CSV: the heading and one line per pattern', csv[0] === C.NG_CSV_COLS.join(',') && csv.some(l => l.startsWith('Ridhi,vinyl,1,Waste,')) && csv.some(l => l.includes('"Harvest ""linen placemats"""')));
    // Filter text finds a pattern through its terms and campaigns.
    ok('the filter looks in the terms and campaigns too', C.ngRows(C.getNGX(), { brand: 'SP', q: 'placemats', size: 1 }).some(g => g.gram === 'linen'));
    // Empty: no data loaded.
    const E = setup({ ngram: true, names: NAMES });
    E.$('paneNgram').classList.remove('hide');
    E.C.ST.loaded = true; E.C.ST.extra = true;
    E.C.renderNg();
    ok('no search terms yet: the quiet empty line, and the status red', /No search terms yet/.test(E.$('ngTable').innerHTML) && /is-bad/.test(E.$('ngMsg').innerHTML));
  }

  console.log('== loading: tried again by itself, the error and "Try again" when it keeps failing (22 Nov) ==');
  {
    // The caches as the backend answers them, from the sample account.
    const src = page();
    const S0 = src.C.ST;
    const caches = { srchTerm: { at: nowIst(), d: {} }, stSettled: { at: nowIst(), d: S0.set.d }, targeting: { d: S0.tgts }, adGroup: { d: S0.ag }, adEntities: { at: nowIst(), d: S0.ent.d } };
    const NOT_READY = 'Backend not configured — config/api was not read';
    const backend = st => async q => {
      if (q.cache === 'srchTerm') st.calls++;
      if (q.cache === 'srchTerm' && (st.fail === Infinity || st.calls <= st.fail)) throw new Error(NOT_READY);
      if (caches[q.cache]) return { data: JSON.parse(JSON.stringify(caches[q.cache])) };
      throw new Error('nothing cached');
    };
    // Timers: a retry wait runs at once (the test records what the page says while it waits).
    const fresh = st => {
      const S = setup({ ngram: true, names: NAMES, ctx: {
        baCall: q => backend(st)(q),
        setTimeout: (f, ms) => { if (ms >= 2000) st.waits.push([ms, S.$('ngTable').innerHTML + S.$('stTable').innerHTML]); Promise.resolve().then(f); return 0; } } });
      return S;
    };
    // 1. Two failed reads (the backend settings not read yet), then the answer: the page draws by itself.
    const st1 = { calls: 0, fail: 2, waits: [] };
    const A1 = fresh(st1);
    A1.$('paneNgram').classList.remove('hide');
    await A1.C.ensureNgram();
    ok('a failed first load is tried again by itself, then the page draws', A1.C.ST.loaded && st1.calls === 3 && /"plastic"/.test(A1.$('ngTable').innerHTML) && !/is-bad/.test(A1.$('ngMsg').innerHTML),
      `calls ${st1.calls}, loaded ${A1.C.ST.loaded}: ${strip(A1.$('ngTable').innerHTML).slice(0, 120)}`);
    ok('…waiting 2 s, then 4 s, and saying which try it is on', st1.waits.map(w => w[0]).join(',') === '2000,4000' && /trying again \(2 of 5\)/.test(st1.waits[1][1]), JSON.stringify(st1.waits.map(w => w[0])));
    // 2. It keeps failing: after every try, the real error and "Try again"; nothing is kept as loaded.
    const st2 = { calls: 0, fail: Infinity, waits: [] };
    const A2 = fresh(st2);
    A2.$('paneNgram').classList.remove('hide');
    await A2.C.ensureNgram();
    const t2 = A2.$('ngTable').innerHTML;
    ok('a lasting failure: five tries over about 20 s', st2.calls === 5 && st2.waits.reduce((t, w) => t + w[0], 0) === 20000, `calls ${st2.calls}`);
    ok('…then the real error text and "Try again", in the quiet style', new RegExp(NOT_READY).test(t2) && /data-staretry="1"[^>]*>Try again</.test(t2) && /class="muted"/.test(t2), strip(t2));
    ok('…the status line red, with the error', /is-bad/.test(A2.$('ngMsg').innerHTML) && /could not be read/.test(A2.$('ngMsg').innerHTML) && new RegExp(NOT_READY).test(A2.$('ngMsg').innerHTML));
    ok('…and the failure is not kept as loaded', !A2.C.ST.loaded);
    st2.fail = 0;
    A2.$('ngTable').listeners.click.forEach(f => f({ target: { closest: s => (s === '[data-staretry]' ? {} : null) } }));
    await new Promise(r => setImmediate(r));
    await A2.C.staLoadSure();
    await new Promise(r => setImmediate(r));
    ok('"Try again" reads again, and the page draws', A2.C.ST.loaded && /"plastic"/.test(A2.$('ngTable').innerHTML), strip(A2.$('ngTable').innerHTML).slice(0, 120));
    // 3. Search Term Analysis's own first load: the same.
    const st3 = { calls: 0, fail: Infinity, waits: [] };
    const A3 = fresh(st3);
    A3.$('paneSt').classList.remove('hide');
    await A3.C.ensureSt();
    ok('Search Term Analysis: the error and "Try again", not "No search terms yet"', new RegExp(NOT_READY).test(A3.$('stTable').innerHTML) && /data-staretry/.test(A3.$('stTable').innerHTML)
      && !/No search terms yet/.test(A3.$('stTitle').textContent) && /is-bad/.test(A3.$('stMsg').innerHTML), strip(A3.$('stTable').innerHTML));
    st3.fail = 0;
    await A3.C.ensureSt();
    ok('Search Term Analysis: tried again, it draws', A3.C.ST.loaded && /plastic/.test(A3.$('stTable').innerHTML));
  }

  console.log('== the boxes count each search term once; Next step says only what to do (22 Nov) ==');
  {
    const S = page();
    const { C, $ } = S;
    $('paneNgram').classList.remove('hide');
    await C.ensureNgram();
    const rows = C.getNGX().views[1];
    const money0 = v => '$' + Math.round(v).toLocaleString('en-US');
    const waste = rows.filter(g => C.ngCls(g, 10) === 'waste'), win = rows.filter(g => C.ngCls(g, 10) === 'winner');
    const uniq = list => { const m = new Set(); list.forEach(g => g.terms.forEach(r => m.add(r))); return [...m]; };
    const dw = uniq(waste), dwi = uniq(win);
    const dwSp = dw.reduce((t, r) => t + r.sp, 0), sumSp = waste.reduce((t, g) => t + g.sp, 0);
    const dwiS = dwi.reduce((t, r) => t + r.s, 0), sumS = win.reduce((t, g) => t + g.s, 0);
    const box = $('ngBoxes').innerHTML;
    ok(`Waste box: ${money0(dwSp)} spend in ${dw.length} terms, each counted once (the patterns add up to ${money0(sumSp)})`, box.includes(`${money0(dwSp)} spend in ${dw.length} search terms, each counted once`) && sumSp > dwSp, strip(box).slice(0, 200));
    ok(`Winner box: ${money0(dwiS)} sales in ${dwi.length} terms, each counted once (the patterns add up to ${money0(sumS)})`, box.includes(`${money0(dwiS)} sales in ${dwi.length} search terms, each counted once`) && sumS > dwiS);
    ok('ngDistinct: a term in three patterns counts once', (() => { const r = { sp: 5, s: 9 }; const d = C.ngDistinct([{ terms: [r] }, { terms: [r] }, { terms: [r, { sp: 1, s: 0 }] }]); return d.n === 2 && d.sp === 6 && d.s === 9; })());
    ok('the table keeps each pattern\'s own figures', /\$47\.00/.test($('ngTable').innerHTML));
    const t = $('ngTable').innerHTML, txt = strip(t);
    const nextOf = gram => { const i = t.indexOf('"' + gram + '"'); const row = t.slice(i, t.indexOf('</tr>', i)); return row.slice(row.lastIndexOf('<td class="sta-next">')); };
    ok('Waste: the button only ("Negate in 2 campaigns"); the plan on hover', />Negate in 2 campaigns</.test(nextOf('vinyl')) && !strip(nextOf('vinyl')).includes('Negative phrase · campaign level') && /title="Negative phrase · campaign level/.test(nextOf('vinyl')), nextOf('vinyl'));
    ok('Next step no longer repeats the Classification reason', !txt.includes('Watch: ') && !/Negative phrase · campaign level · /.test(txt));
    ok('protected Waste: "Lower bids instead →"', />Lower bids instead →</.test(nextOf('ridhi')));
    ok('Winner: "Harvest best term"', />Harvest best term</.test(nextOf('linen')));
    // boho: 6 clicks and no order — the clicks to reach 10, or to tell (at the 1% line), whichever is more.
    const bohoN = Number((/Wait for more clicks \(~(\d+)\)/.exec(nextOf('boho')) || [])[1]);
    ok(`Needs data: "Wait for more clicks (~N)" (boho ~${bohoN})`, /Wait for more clicks \(~\d+\)/.test(nextOf('cotton')) && bohoN >= 4, strip(nextOf('boho')));
    ok('Mixed: "Watch"', /<span class="sta-hold"[^>]*>Watch</.test(nextOf('floral')));
    // No unit cost and no target: "Set a target ACoS →" opens Lists & settings on that brand.
    const N = page({ noTarget: true });
    N.$('paneNgram').classList.remove('hide');
    await N.C.ensureNgram();
    const nt = N.$('ngTable').innerHTML, ni = nt.indexOf('"linen"'), nrow = nt.slice(ni, nt.indexOf('</tr>', ni));
    ok('no unit cost or target: "Set a target ACoS →"', /data-ngact="tgt"[^>]*>Set a target ACoS →</.test(nrow), strip(nrow));
    N.$('ngTable').listeners.click.forEach(f => f({ target: { closest: s => (s === 'button[data-ngact]' ? { dataset: { ngact: 'tgt', k: 'w:SP|linen' } } : null) } }));
    ok('…and it opens Lists & settings', !N.$('stSet').classList.contains('hide'));
    const csv = C.ngCsvLines(rows, 10);
    ok('CSV: Next step short, Why the classification reason', csv.some(l => l.startsWith('Ridhi,vinyl,') && /,Negate in 2 campaigns,ACoS 156\.7% over break-even/.test(l)), csv.find(l => l.startsWith('Ridhi,vinyl,')));
  }

  console.log('== one search term is not a pattern; same terms, one row; stop-word edges; Waste never "Watch" (22 Nov review) ==');
  {
    const S = page({ extra: true });
    const { C, $ } = S;
    $('paneNgram').classList.remove('hide');
    await C.ensureNgram();
    const X = C.getNGX();
    const view = sz => X.views[sz];
    ok(`a pattern needs ${C.NG.MIN_TERMS} search terms: "ridhi tablecloth" (one term) is left out of every view`, C.NG.MIN_TERMS === 2 && [0, 1, 2, 3].every(sz => !view(sz).some(g => g.gram === 'ridhi tablecloth'))
      && X.solo[2].some(g => g.gram === 'ridhi tablecloth'));
    ok('…and no row on screen has fewer than 2 search terms', [0, 1, 2, 3].every(sz => view(sz).every(g => g.n >= 2)));
    ok('…while its term is still judged in Search Term Analysis (it is a row there)', C.staModel('ALL').rows.some(r => r.term === 'ridhi tablecloth'));
    // The filter text finds single-term n-grams: pointed to Search Term Analysis.
    C.NGS.size = 2;
    $('ngFilter').value = 'tablecloth';
    C.renderNg();
    ok('the filter finds n-grams of one search term: listed under the table, with "Open in Search Term Analysis →"', /class="ng-solo"/.test($('ngTable').innerHTML) && /"ridhi tablecloth"/.test(strip($('ngTable').innerHTML))
      && /data-ngst="1"/.test($('ngTable').innerHTML), strip($('ngTable').innerHTML).slice(-300));
    $('ngTable').listeners.click.forEach(f => f({ target: { closest: s => (s === 'button[data-ngst]' ? {} : null) } }));
    ok('…which opens Search Term Analysis on that filter text', S.ctx.tabs.slice(-1)[0] === 'st' && $('stFilter').value === 'tablecloth');
    $('ngFilter').value = '';
    // Same set of terms, one row.
    const m1 = view(1).find(g => g.brand === 'SP' && (g.gram === 'tribal' || g.gram === 'mudcloth'));
    ok('"mudcloth" and "tribal" (the same two terms) are one 1-word row, named by the shortest', m1 && m1.gram === 'tribal' && m1.same.join() === 'mudcloth'
      && view(1).filter(g => g.brand === 'SP' && ['tribal', 'mudcloth'].includes(g.gram)).length === 1, m1 && JSON.stringify([m1.gram, m1.same]));
    const m0 = view(0).find(g => g.brand === 'SP' && g.gram === 'tribal');
    ok('across sizes (All): "mudcloth tribal" joins them too; counted once', m0 && m0.same.sort().join() === 'mudcloth,mudcloth tribal' && !view(0).some(g => g.gram === 'mudcloth' || g.gram === 'mudcloth tribal')
      && m0.n === 2 && m0.sp === 24, m0 && JSON.stringify(m0.same));
    C.NGS.size = 1;
    C.renderNg();
    ok('the row says "same terms: …", and its action is one negative phrase', /same terms: "mudcloth"/.test(strip($('ngTable').innerHTML)) && (C.ngWordRow(m1).gram === 'tribal'));
    ok('the CSV names the others', C.ngCsvLines([m1], 10)[1].endsWith(',mudcloth'));
    // Stop words at an edge.
    const grams = view(0).map(g => g.gram).concat(...view(0).map(g => g.same || []));
    ok('a stop word at an edge is left out ("dish towels for", "for kitchen"), the pattern inside kept ("dish towels")', !grams.includes('dish towels for') && !grams.includes('for kitchen') && !grams.includes('towels for') && grams.includes('dish towels'));
    ok('a number inside is fine ("18 18 pillow")', grams.includes('18 18 pillow'), grams.filter(g => g.startsWith('18')).join(' | '));
    // Waste with nothing to negate: never "Watch".
    const jute = view(1).find(g => g.gram === 'jute');
    const nj = C.ngNext(jute, 10);
    ok('Waste that sells in every campaign: the exact reason and "Open in Search Term Analysis →", never "Watch"', C.ngCls(jute, 10) === 'waste' && nj.act === 'st' && nj.short === 'Sells everywhere it spends' && nj.low === true
      && /sells in 2 campaigns/.test(nj.text), JSON.stringify(nj));
    const t = $('ngTable').innerHTML, i = t.indexOf('"jute"'), jrow = t.slice(i, t.indexOf('</tr>', i));
    ok('…drawn as the reason, then the button (over break-even and selling: "Lower bids where it sells →")', />Sells everywhere it spends</.test(jrow) && /data-ngact="st"[^>]*>Lower bids where it sells →</.test(jrow), strip(jrow));
    const wasteNext = [0, 1, 2, 3].flatMap(sz => view(sz)).filter(g => C.ngCls(g, 10) === 'waste').map(g => C.ngNext(g, 10).short);
    ok(`no Waste row anywhere says "Watch" (${wasteNext.length} Waste rows)`, wasteNext.length > 0 && !wasteNext.some(x => /Watch/.test(x)), wasteNext.join(' | '));
    ok('the day\'s limit: the reason and the button', (() => { const v = view(1).find(g => g.gram === 'vinyl'); const was = C.STA.DAY_MAX; C.STA.DAY_MAX = 0; const n = C.ngNext(Object.assign(Object.create(v), { _plan: undefined }), 10); C.STA.DAY_MAX = was; return n.act === 'st' && /Day's limit/.test(n.short); })());
    // Chips add up to All; Protected is a toggle, not a class.
    const bar = $('ngActBar').innerHTML;
    const nums = [...bar.matchAll(/data-a="(\w*)"[^>]*>[^<]*<span>([\d,]+)<\/span>/g)].map(m => [m[1], Number(m[2].replace(/,/g, ''))]);
    const all = nums.find(n => n[0] === '')[1], parts = nums.filter(n => n[0]).reduce((s, n) => s + n[1], 0);
    ok(`the classification chips add up to All (${parts} = ${all}), with no Protected chip among them`, all === parts && nums.length === 5 && !nums.some(n => n[0] === 'prot'), JSON.stringify(nums));
    const nProt = view(1).filter(g => g.protect).length;
    ok(`"Protected only" is a toggle at the end, set apart, with its count (${nProt})`, new RegExp(`class="ng-flag"><button[^>]*data-prot="1"[^>]*aria-pressed="false"[^>]*>Protected only<span>${nProt}</span>`).test(bar) && bar.indexOf('data-prot') > bar.lastIndexOf('data-a='));
    $('ngActBar').listeners.click.forEach(f => f({ target: { closest: s => (s === '[data-prot]' ? {} : null) } }));
    const bar2 = $('ngActBar').innerHTML;
    const nums2 = [...bar2.matchAll(/data-a="(\w*)"[^>]*>[^<]*<span>([\d,]+)<\/span>/g)].map(m => Number(m[2].replace(/,/g, '')));
    ok('…on: only protected rows, and the chips still add up', C.NGS.prot && nums2[0] === nProt && nums2.slice(1).reduce((s, n) => s + n, 0) === nProt && /aria-pressed="true"[^>]*>Protected only/.test(bar2));
    ok('the Classification list has no Protected option any more', !['prot'].some(k => C.NG_CLS && C.NG_CLS.some(c => c[0] === k)));
    C.NGS.prot = false;
  }

  console.log('== smaller fixes: no target wording, empty boxes, "<0.1%", sister brand (22 Nov review) ==');
  {
    // Mixed without a target: Placement's words for its "No target" chip.
    const N = page({ noTarget: true });
    N.$('paneNgram').classList.remove('hide');
    await N.C.ensureNgram();
    const fl = N.C.getNGX().views[1].find(g => g.gram === 'floral');
    ok(`no target: Mixed rows with orders are "${N.C.STA_NOTGT}"`, N.C.STA_NOTGT === 'Has orders · not judged (no target)' && N.C.ngCls(fl, 10) === 'mixed' && fl.why.startsWith(N.C.STA_NOTGT), fl.why);
    ok('…the Mixed box says it, not "between target and break-even"', N.$('ngBoxes').innerHTML.includes(N.C.STA_NOTGT) && !/Between target and break-even/.test(N.$('ngBoxes').innerHTML));
    ok('…the same words as Placement\'s chip', (N.C.PLX_CHIPS.find(c => c[0] === 'notgt') || [])[1] === N.C.STA_NOTGT);
    const A2 = page();
    A2.$('paneNgram').classList.remove('hide');
    await A2.C.ensureNgram();
    ok('with a target: "Between target and break-even"', /Between target and break-even, or few orders\./.test(A2.$('ngBoxes').innerHTML) && !A2.$('ngBoxes').innerHTML.includes(A2.C.STA_NOTGT));
    // A box with no rows has no link.
    const winBox = N.$('ngBoxes').innerHTML.split('data-box="winner"')[1].split('</button>')[0];
    ok('a box with 0 rows shows no link (Winner at 0 without a target)', /<b>0<\/b>/.test(winBox) && !/Harvest the best term →/.test(winBox) && !/sta-go/.test(winBox), strip(winBox));
    ok('…a box with rows keeps it', /Negate where they don't sell →/.test(A2.$('ngBoxes').innerHTML));
    // Chances under 0.1%.
    const C = A2.C;
    ok('chances under 0.1% read "<0.1%", never "0.0%"', C.staChance(0.0004) === '<0.1%' && C.staChance(0.00099) === '<0.1%' && C.staChance(0.001) === '0.1%' && C.staChance(0.004) === '0.4%' && C.staChance(null) === '—');
    const why = C.ngClassOf({ o: 0, c: 400, sp: 30, s: 0, acos: null, p: 0.05, chance: 0.0002, tgt: 30, be: 45, costsOn: true, tag: '' }).why;
    ok('…in N-Gram\'s reason', /only <0\.1% chance/.test(why) && !/0\.0%/.test(why), why);
    const plas = C.staModel('ALL').rows.find(r => r.term === 'plastic table runner');
    ok('…and Search Term Analysis uses the same helper', !/0\.0% of the time/.test(JSON.stringify(plas.badges || [])) && /staChance\(r\.chance\)/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'ads', 'search-terms.js'), 'utf8')));
    // Sister brand: Ridhi's brand term in Cotton Print Club.
    const Sb = page({ sister: true });
    Sb.$('paneNgram').classList.remove('hide');
    await Sb.C.ensureNgram();
    const rc = Sb.C.getNGX().views[1].find(g => g.brand === 'CPC' && g.gram === 'ridhi');
    ok('Sister brand: "ridhi" in Cotton Print Club is tagged and protected', rc && rc.tags.includes('sister') && rc.protect === 'sister', rc && JSON.stringify([rc.tags, rc.protect]));
    ok('…never negated in N-Gram', rc && Sb.C.ngNext(rc, 10).act !== 'neg' && !!Sb.C.ngQuick(rc, {}).skip);
    const M = Sb.C.staModel('ALL');
    const tr = M.rows.find(r => r.brand === 'CPC' && r.term === 'ridhi pillow covers');
    ok('…and in Search Term Analysis: the term is "Sister brand", never negated (noNeg)', tr && tr.tagSet.has('sister') && tr.noNeg === 'sister-brand term' && tr.next !== 'neg', tr && JSON.stringify([tr.noNeg, tr.next]));
    ok('…By word leaves it out (the same shared check)', !M.words.some(w => w.brand === 'CPC' && /ridhi/.test(w.gram)));
    ok('…while in Ridhi it is the brand term, not a sister brand', (() => { const g = Sb.C.getNGX().views[1].find(x => x.brand === 'SP' && x.gram === 'ridhi'); return g && g.protect === 'brand' && !g.tags.includes('sister'); })());
    // The luck cut-off, in How Sellora decides.
    Sb.C.ngLegend();
    ok('How Sellora decides: the luck cut-off, 1% for a negative and 5% for a placement, and why', /1%/.test(strip(Sb.$('ngLegendBody').innerHTML)) && /5%/.test(strip(Sb.$('ngLegendBody').innerHTML)) && /harder to undo/.test(Sb.$('ngLegendBody').innerHTML));
  }

  console.log('== per-campaign evidence, the negate popup, Excel, two kinds of Waste, No-order spend (26 Nov) ==');
  {
    const dl = { files: [], revoked: [], timers: [] };
    const S = page({ extra: true, ctx: dlCtx(dl) });
    const { C, $ } = S;
    $('paneNgram').classList.remove('hide');
    $('ngBrand').value = 'ALL';
    await C.ensureNgram();
    const V = C.getNGX().views[1];
    const g = gram => V.find(x => x.brand === 'SP' && x.gram === gram);
    const M = C.getNGX().M;
    // 3. The evidence, per campaign.
    ok('the yardstick: the campaign\'s own order rate with 3+ orders, else the brand\'s (as Search Term Analysis)', (() => {
      const a = C.ngCpRate(g('vinyl'), 'c1'), z = C.ngCpRate(g('vinyl'), 'c9');
      return a.w === 'its campaign' && Math.abs(a.p - 25 / 300) < 1e-9 && z.w === 'the brand' && Math.abs(z.p - M.rate.SP.b.o / M.rate.SP.b.c) < 1e-9;
    })());
    const vp = C.ngPlan(g('vinyl'));
    const ch1 = Math.pow(1 - 25 / 300, 60);
    ok(`vinyl: negated in both no-order campaigns (enough clicks there), kept where it sells; evidence "0 in 60 clicks · ${C.staChance(ch1)} chance"`, vp.neg.map(c => c.cid).sort().join() === 'c1,c2' && vp.kept.map(c => c.cid).join() === 'c3'
      && vp.neg.find(c => c.cid === 'c1').ev === `0 in 60 clicks · ${C.staChance(ch1)} chance` && vp.neg.every(c => c.can && c.on) && vp.kept.every(c => !c.can), JSON.stringify(vp.neg.map(c => c.ev)));
    const pp = C.ngPlan(g('plastic'));
    ok('plastic: negated in c1 (90 clicks, <0.1%), kept in c2 — 60 clicks could still be chance at its 3.5%', pp.neg.map(c => c.cid).join() === 'c1' && pp.thin.map(c => c.cid).join() === 'c2'
      && pp.thin[0].why === '60 clicks, $18.00' && pp.thin[0].can && !pp.thin[0].on && /^0 in 90 clicks · <0\.1% chance$/.test(pp.neg[0].ev), JSON.stringify([pp.neg.map(c => c.ev), pp.thin.map(c => c.ev + ' / ' + c.why)]));
    const pn = C.ngNext(g('plastic'), 10);
    ok('…"Negate in 1 campaign", the other kept without enough data', pn.act === 'neg' && pn.short === 'Negate in 1 campaign' && /kept in 1 without enough data/.test(pn.text), pn.text);
    // The "decorative" case: $7.20 and $5.97 in two campaigns, $30 in a third.
    const dec = Object.assign(Object.create(g('plastic')), { _plan: null, terms: [], tcp: null, tag: '', gram: 'decorative', term: 'decorative',
      cps: new Map([['c1', { cid: 'c1', cn: 'SP - Runner - Broad', c: 200, sp: 30, s: 0, o: 0, n: 4 }], ['c2', { cid: 'c2', cn: 'SP - Napkins - Auto', c: 4, sp: 7.2, s: 0, o: 0, n: 1 }],
        ['c3', { cid: 'c3', cn: 'SP - Exact', c: 300, sp: 5.97, s: 0, o: 0, n: 2 }]]) });
    const dp = C.ngPlan(dec);
    ok('"decorative": ticked only where it spent $10+ with under 1% chance — "Kept: not enough data here (4 clicks, $7.20)"', dp.neg.map(c => c.cid).join() === 'c1' && dp.thin.map(c => c.cid).sort().join() === 'c2,c3'
      && C.ngCpWhy(dp.thin.find(c => c.cid === 'c2')).startsWith('Kept: not enough data here (4 clicks, $7.20)') && /judged from \$10\.00 spent here/.test(C.ngCpWhy(dp.thin.find(c => c.cid === 'c3'))),
      dp.thin.map(C.ngCpWhy).join(' | '));
    ok('a blocked word is negated in every no-order campaign, at any spend (its class)', (() => { const p = C.ngPlan(g('cheap')); return p.neg.length === 1 && /blocked word: negated at any spend/.test(p.neg[0].ev) && !p.thin.length; })());
    const allNeg = Object.assign(Object.create(dec), { _plan: null, cps: new Map([['c2', { cid: 'c2', cn: 'SP - Napkins - Auto', c: 4, sp: 7.2, s: 0, o: 0, n: 1 }]]) });
    const an = C.ngNext(Object.assign(allNeg, { base: 'waste', wk: 'nosale', c: 400, protect: '', words: 1, info: g('plastic').info }), 10);
    ok('no campaign with enough data: no button — "Not enough data in any one campaign" and Search Term Analysis', an.act === 'st' && an.short === 'Not enough data in any one campaign', JSON.stringify(an));

    // 1. The popup's campaign table (Amazon's record of the campaigns gives their kind).
    C.ST.ent.d.SP.cp = { c1: ['SP - Runner - Broad', 'ENABLED', 50, 'LEGACY_FOR_SALES', 0, 0, 0, 'MANUAL', 0], c2: ['SP - Napkins - Auto', 'ENABLED', 40, 'AUTO_FOR_SALES', 0, 0, 0, 'AUTO', 0] };
    C.staOpen('word', g('plastic').key, C.ngWordRow(g('plastic')));
    const body = $('stDlgBody').innerHTML, bt = strip(body).replace(/&lt;/g, '<');
    ok('the popup: a table — ✓ | Campaign | Spend | Clicks | Orders | Terms | Evidence | What happens', /<div class="sta-dcp"><table class="xl"><thead><tr><th class="sta-dcb">/.test(body)
      && /Campaign Spend Clicks Orders Terms Evidence What happens/.test(bt) && !/sta-cplist/.test(body), bt.slice(0, 200));
    ok('…one row per campaign, by spend, the name with "N ad groups · kind" under it', bt.indexOf('SP - Runner - Broad') < bt.indexOf('SP - Napkins - Auto') && /SP - Runner - Broad 1 ad group · Manual/.test(bt) && /SP - Napkins - Auto 1 ad group · Auto/.test(bt), bt);
    ok('…ticked only with evidence: c1 "Negate here", c2 "Kept: not enough data here (60 clicks, $18.00)" unticked', /data-cp="0" checked/.test(body) && !/data-cp="1" checked/.test(body)
      && /Negate here/.test(bt) && /Kept: not enough data here 60 clicks, \$18\.00/.test(bt) && /0 in 90 clicks · <0\.1% chance/.test(bt));
    ok('…"1 of 2 campaigns ticked · $27.00 spend with no orders", and the button counts the ticked', $('stDlgCpN').textContent === '1 of 2 campaigns ticked · $27.00 spend with no orders' && $('stDlgOk').textContent === 'Add 1 negative to review list', $('stDlgCpN').textContent);
    ok('…"Select all eligible · Clear" above it; the figures card adds "Spend with no orders"; example terms as chips', /data-cpall="1">Select all eligible/.test(body) && /data-cpnone="1">Clear/.test(body)
      && /<small>Spend with no orders<\/small><b>\$45\.00<\/b>/.test(body) && (body.match(/class="sta-tchip"/g) || []).length === 2 && !/For example: /.test(body));
    ok('…the dialog is the wide one, with "Download Excel" in its footer', $('stDlg').classList.contains('sta-dlgword') && !$('stDlgXlsx').classList.contains('hide'));
    const fire = (el, type, target) => $(el).listeners[type].forEach(f => f({ target }));
    fire('stDlgBody', 'change', { dataset: { cp: '1' }, checked: true });
    ok('ticking the kept one by hand: "2 of 2", the button says 2', $('stDlgCpN').textContent.startsWith('2 of 2 campaigns ticked · $45.00') && $('stDlgOk').textContent === 'Add 2 negatives to review list');
    const btnOf = s => ({ closest: q => (q === s ? {} : null) });
    fire('stDlgBody', 'click', btnOf('[data-cpnone]'));
    ok('"Clear": none ticked, nothing to add', $('stDlgCpN').textContent.startsWith('0 of 2') && $('stDlgOk').disabled && /Tick at least one campaign/.test($('stDlgChecks').innerHTML));
    fire('stDlgBody', 'click', btnOf('[data-cpall]'));
    ok('"Select all eligible": back to the campaigns with evidence (1)', $('stDlgCpN').textContent.startsWith('1 of 2') && !$('stDlgOk').disabled);
    // 2. The popup's Excel file.
    $('stDlgXlsx').listeners.click.forEach(f => f());
    let f1 = dl.files.slice(-1)[0];
    ok('Download Excel: "plastic - Ridhi.xlsx" with both brands on screen', f1 && f1.name === 'plastic - Ridhi.xlsx' && /spreadsheetml/.test(f1.type), f1 && f1.name);
    await new Promise(r => setImmediate(r));
    ok('…its URL let go after 2 s', dl.timers.includes(2000) && dl.revoked.includes(f1.href));
    let B = book(f1.bytes);
    const cpS = B.sheets.Campaigns, tS = B.sheets['Search terms'], sS = B.sheets.Summary;
    ok('three sheets: Campaigns, Search terms, Summary', B.names.join() === 'Campaigns,Search terms,Summary');
    ok('Campaigns: the columns of the brief', vals(cpS[0]).join('|') === C.NG_XL_CP.join('|') && C.NG_XL_CP.join('|') === 'Campaign|Campaign ID|Brand|Negate|Why|Spend|Clicks|Orders|Sales|ACoS %|Search terms|Top terms');
    const c1r = cpS.find(r => r[0].v === 'SP - Runner - Broad'), c2r = cpS.find(r => r[0].v === 'SP - Napkins - Auto');
    ok('…one row per campaign: Negate Yes / No as ticked, the Why with its evidence, IDs as text', c1r[3].v === 'Yes' && c2r[3].v === 'No' && c1r[1].v === 'c1' && /^Negate here — 0 in 90 clicks · <0\.1% chance at its campaign's 8\.3% order rate$/.test(c1r[4].v)
      && /^Kept: not enough data here \(60 clicks, \$18\.00\)/.test(c2r[4].v), c1r[4].v + ' / ' + c2r[4].v);
    ok('…numbers as numbers, money with 2 decimals (style), headings bold', c1r[5].v === 27 && c1r[5].s === 2 && c1r[6].v === 90 && c1r[6].s === 0 && cpS[0][0].s === 1 && /numFmtId="4"/.test(B.z['xl/styles.xml']) && /<cols><col min="1"/.test(B.z['xl/worksheets/sheet1.xml']));
    const tot = cpS[cpS.length - 1];
    ok('…a total row, in bold, that adds up', tot[0].v === 'Total' && tot[0].s === 1 && tot[5].v === 45 && tot[5].s === 3 && tot[6].v === 150 && tot[3].v === '1 Yes', JSON.stringify(vals(tot)));
    ok('Search terms: every term behind it, with campaign, ad group and its verdict', vals(tS[0]).join('|') === C.NG_XL_TERMS.join('|') && tS.length === g('plastic').terms.length + 2
      && tS.some(r => r[0].v === 'plastic table runner' && r[1].v === 'SP - Runner - Broad' && r[2].v === 'Runner broad' && r[4].v === 27) && tS[tS.length - 1][4].v === 45, JSON.stringify(tS.map(vals)));
    const sum = Object.fromEntries(sS.slice(1).map(r => [r[0].v, r[1] ? r[1].v : '']));
    ok('Summary: pattern, brand, window, class and reason, totals, campaigns to negate, sales at risk, downloaded at / by', sum.Pattern === 'plastic' && sum.Brand === 'Ridhi' && /settled 14 Oct – 12 Nov/.test(sum.Window)
      && sum.Class === 'Waste · no sales' && /0 orders in 150 clicks/.test(sum.Reason) && sum.Spend === 45 && sum['Campaigns to negate'] === 1 && sum['Spend with no orders in them'] === 27 && sum['Sales at risk'] === 0
      && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(sum['Downloaded at']) && sum['Downloaded by'] === C.ppchPerson() && !!sum['Downloaded by'], JSON.stringify(sum));
    // The ticks in the dialog go into the file.
    fire('stDlgBody', 'change', { dataset: { cp: '1' }, checked: true });
    $('stDlgXlsx').listeners.click.forEach(f => f());
    B = book(dl.files.slice(-1)[0].bytes);
    ok('…the file follows the ticks in the dialog (both Yes now)', B.sheets.Campaigns.filter(r => r[3] && r[3].v === 'Yes').length === 2);
    // Only the ticked go to the review list.
    fire('stDlgBody', 'click', btnOf('[data-cpall]'));
    const before = C.ST_RL.items.length;
    await C.staDlgOk();
    const added = C.ST_RL.items.slice(before);
    ok('"Add 1 negative": one review item, the ticked campaign only', added.length === 1 && added[0].cid === 'c1' && added[0].neg.type === 'negativePhrase', JSON.stringify(added.map(x => x.cid)));
    // A file name holds no character a file name can't.
    ok('file names: characters a file name cannot hold are taken out', C.staFileName('a/b:c*?"<>|d.') === 'a b c d' && C.staFileName('christmas') === 'christmas');
    $('ngBrand').value = 'SP';
    ok('one brand on screen: "<pattern>.xlsx"', C.ngXlsxName(g('vinyl')) === 'vinyl.xlsx');
    $('ngBrand').value = 'ALL';
    // The vinyl dialog: the campaign where it sells shows, but cannot be ticked.
    C.staOpen('word', g('vinyl').key, C.ngWordRow(g('vinyl')));
    ok('a campaign where it sells: shown, "Kept: sells here", cannot be ticked', /<tr class="is-off"><td class="sta-dcb"><input type="checkbox" class="sta-cb" data-cp="\d" disabled/.test($('stDlgBody').innerHTML) && /Kept: sells here/.test($('stDlgBody').innerHTML)
      && /3 orders · \$30\.00 sales/.test($('stDlgBody').innerHTML));
    $('stDlg').classList.add('hide');
    // By word's own dialog: every campaign "Negate here", ticked, no Excel.
    const bw = C.staModel('ALL').words.find(w => w.cps && w.cps.length);
    if (bw) {
      C.staOpen('word', bw.key, bw);
      ok('By word\'s dialog: the same table, its campaigns ticked, no Excel button', /class="sta-dcp"/.test($('stDlgBody').innerHTML) && (($('stDlgBody').innerHTML.match(/data-cp="\d+" checked/g) || []).length === bw.cps.length)
        && $('stDlgXlsx').classList.contains('hide'));
      $('stDlg').classList.add('hide');
    }
    // An opened Waste row: "Download Excel" in What the action does; the thin campaign listed with its evidence.
    C.NGS.open.add(g('plastic').key);
    C.renderNg();
    const t0 = $('ngTable').innerHTML;
    ok('an opened Waste row: "Download Excel", and "Kept: not enough data here (60 clicks, $18.00)"', new RegExp(`data-ngxl="${g('plastic').key.replace('|', '\\|')}"[^>]*>Download Excel<`).test(t0) && /Kept: not enough data here \(60 clicks, \$18\.00\)/.test(t0));
    const nFiles = dl.files.length;
    $('ngTable').listeners.click.forEach(f => f({ target: { closest: s => (s === 'button[data-ngxl]' ? { dataset: { ngxl: g('plastic').key } } : null) } }));
    ok('…which downloads the same file', dl.files.length === nFiles + 1 && dl.files.slice(-1)[0].name === 'plastic - Ridhi.xlsx');
    C.NGS.open.clear();

    // 4. Two kinds of Waste.
    ok('which rule made it Waste: plastic and cheap "no sales", vinyl and jute "over break-even"', g('plastic').wk === 'nosale' && g('cheap').wk === 'nosale' && g('vinyl').wk === 'be' && g('jute').wk === 'be');
    C.renderNg();
    const t = $('ngTable').innerHTML, rowOf = gram => { const i = t.indexOf('"' + gram + '"'); return t.slice(i, t.indexOf('</tr>', i)); };
    ok('the badge says which: "Waste · no sales", "Waste · over break-even"', />Waste · no sales</.test(rowOf('plastic')) && />Waste · over break-even</.test(rowOf('vinyl')));
    const bar = $('ngActBar').innerHTML;
    const wasteN = Number(/data-a="waste"[^>]*>Waste<span>(\d+)/.exec(bar)[1]), ns = Number(/data-wk="waste-ns"[^>]*>no sales<span>(\d+)/.exec(bar)[1]), be = Number(/data-wk="waste-be"[^>]*>over break-even<span>(\d+)/.exec(bar)[1]);
    ok(`the chips: Waste ${wasteN} = no sales ${ns} + over break-even ${be}; the box says both`, wasteN === ns + be && ns > 0 && be > 0 && new RegExp(`${ns} no sales, ${be} over break-even`).test($('ngBoxes').innerHTML));
    $('ngActBar').listeners.click.forEach(f => f({ target: { closest: s => (s === '[data-wk]' ? { dataset: { wk: 'waste-be' } } : null) } }));
    ok('the "over break-even" chip: only those rows', C.NGS.cls === 'waste-be' && C.getNGLAST().length === be && C.getNGLAST().every(x => x.wk === 'be') && /class="sta-chip ng-wk on" data-wk="waste-be"/.test($('ngActBar').innerHTML));
    $('ngClass').value = 'waste-ns';
    $('ngClass').listeners.change.forEach(f => f());
    ok('the Classification list: "Waste · no sales" picks the other kind', C.getNGLAST().length === ns && C.getNGLAST().every(x => x.wk === 'nosale'));
    // Over break-even and selling: negate where it never sold, lower bids where it sells.
    const vn = C.ngNext(g('vinyl'), 10);
    ok('over break-even, selling in c3: "Negate in 2 campaigns" and "Lower bids where it sells →"; the line says why', vn.act === 'neg' && vn.low && vn.sellTxt === 'Sells in 1 campaign: lower bids there, negate where it never sold'
      && /sells in 1 campaign: lower bids there, negate where it never sold/.test(vn.text), JSON.stringify(vn));
    ngSetAll(C, 'waste');
    const vr = (() => { const h = $('ngTable').innerHTML, i = h.indexOf('"vinyl"'); return h.slice(i, h.indexOf('</tr>', i)); })();
    ok('…drawn as the line, the Negate button, then the link', /<small>Sells in 1 campaign: lower bids there, negate where it never sold<\/small><button[^>]*data-ngact="neg"[^>]*>Negate in 2 campaigns<\/button><button[^>]*data-ngact="st"[^>]*>Lower bids where it sells →/.test(vr), strip(vr));

    // 6. No-order spend, and the Waste view's first sort.
    ok('No-order spend: the spend in the campaigns to negate (vinyl $15 + $12)', C.ngNos(g('vinyl'), 10) === 27 && C.ngNos(g('plastic'), 10) === 27 && C.ngNos(g('linen'), 10) == null);
    ok('…a sortable column, and the Waste view sorts by it, highest first', C.NGS.sort.k === 'nos' && C.NGS.sort.d === -1 && /data-sort="nos"[^>]*>No-order spend/.test($('ngTable').innerHTML)
      && C.getNGLAST().map(x => C.ngNos(x, 10) == null ? -1 : C.ngNos(x, 10)).every((v, i, a) => !i || a[i - 1] >= v), JSON.stringify(C.getNGLAST().map(x => [x.gram, C.ngNos(x, 10)])));
    ok('…leaving Waste, the sort goes back to spend', (() => { C.ngSetCls('winner'); const k = C.NGS.sort.k; C.ngSetCls('waste'); return k === 'sp' && C.NGS.sort.k === 'nos'; })());
    ok('the CSV: the Waste kind and No-order spend', C.ngCsvLines([g('vinyl')], 10)[1].includes(',over break-even,27,') && C.NG_CSV_COLS.includes('No-order spend (campaigns to negate)'));

    // 6. The page's Waste file.
    C.renderNg();
    ok('"Download Excel" in the toolbar with the Waste filter on, hidden otherwise', !$('ngXlsx').classList.contains('hide') && (() => { C.ngSetCls('winner'); C.renderNg(); const h = $('ngXlsx').classList.contains('hide'); C.ngSetCls('waste'); C.renderNg(); return h; })());
    $('ngXlsx').listeners.click.forEach(f => f());
    const wf = dl.files.slice(-1)[0];
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ok(`the file: "N-Gram waste patterns - Both brands - ${day}.xlsx"`, wf.name === `N-Gram waste patterns - Both brands - ${day}.xlsx`, wf.name);
    const W = book(wf.bytes), last = C.getNGLAST();
    ok('three sheets: Patterns, Campaigns, Summary', W.names.join() === 'Patterns,Campaigns,Summary');
    const pS = W.sheets.Patterns, wcS = W.sheets.Campaigns, wsS = W.sheets.Summary;
    ok('Patterns: the columns, one row per Waste pattern on screen (in its order), a total', vals(pS[0]).join('|') === 'Pattern|Brand|Waste kind|Reason|No-order spend|Spend|Clicks|Orders|Campaigns to negate|Sales at risk'
      && pS.length === last.length + 2 && pS.slice(1, -1).map(r => r[0].v).join() === last.map(x => x.term).join() && pS.find(r => r[0].v === 'vinyl')[2].v === 'Waste · over break-even'
      && pS.find(r => r[0].v === 'vinyl')[4].v === 27 && pS.find(r => r[0].v === 'vinyl')[8].v === 2, JSON.stringify(pS.map(vals).slice(0, 4)));
    const negRows = last.flatMap(x => (C.ngNext(x, 10).act === 'neg' ? C.ngPlan(x).neg.map(c => [x.term, c]) : []));
    ok(`Campaigns: one row per pattern × campaign to negate (${negRows.length}), with its evidence, a total`, vals(wcS[0]).join('|') === 'Pattern|Campaign|Campaign ID|Spend|Clicks|Orders|Evidence' && wcS.length === negRows.length + 2
      && wcS.some(r => r[0].v === 'vinyl' && r[2].v === 'c1' && /^0 in 60 clicks · 0\.5% chance$/.test(r[6].v)) && !wcS.some(r => r[0].v === 'plastic')  /* plastic: c1 now in the review list, c2 without enough data */
      && Math.abs(wcS[wcS.length - 1][3].v - negRows.reduce((t, [, c]) => t + c.sp, 0)) < 0.005 && Math.abs(pS[pS.length - 1][4].v - wcS[wcS.length - 1][3].v) < 0.005);
    const ws = Object.fromEntries(wsS.slice(1).map(r => [r[0].v, r[1] ? r[1].v : '']));
    ok('Summary: the filters, window, totals, downloaded at / by', ws.Brand === 'Both brands' && ws.Classification === 'Waste' && ws['Minimum clicks'] === 10 && ws['Pattern size'] === '1-word' && /settled/.test(ws.Window)
      && ws['Waste patterns'] === last.length && ws['Campaign negatives'] === negRows.length && !!ws['Downloaded by'], JSON.stringify(ws));

    // 2. The bulk file's bytes: the same as before the writer took several sheets.
    let old = null;
    try { old = cp.execSync('git show 7b86904c:Pricing-App/src/app/ads/search-terms.js', { cwd: __dirname, maxBuffer: 1e8 }).toString('utf8'); } catch (e) { old = null; }
    if (!old) ok('commit 7b86904c readable with git', false);
    else {
      const dlo = { files: [], revoked: [], timers: [] }, dln = { files: [], revoked: [], timers: [] };
      const was = setup({ stText: old, names: ['staBulkFiles', 'staXlsx', 'STA_BULK_COLS'], ctx: dlCtx(dlo) }), now = setup({ names: ['staBulkFiles', 'staXlsx', 'STA_BULK_COLS'], ctx: dlCtx(dln) });
      const cols = now.C.STA_BULK_COLS;
      const row = { 'Product': 'Sponsored Products', 'Entity': 'Negative Keyword', 'Operation': 'Create', 'Campaign ID': '123456789012', 'Keyword Text': 'plastic & "vinyl" <x>', 'Match Type': 'negativePhrase', 'Bid': 0.45, 'State': 'enabled' };
      const pairs = [{ x: { brand: 'SP' }, row }, { x: { brand: 'SP' }, row: Object.assign({}, row, { 'Keyword Text': 'christmas', 'Bid': 1.2 }) }];
      await was.C.staBulkFiles(pairs, '');
      await now.C.staBulkFiles(pairs, '');
      const a = dlo.files[0], z = dln.files[0];
      ok(`a bulk file's bytes are identical before and after (${z && z.bytes.length} bytes, "${z && z.name}")`, a && z && a.name === z.name && Buffer.compare(Buffer.from(a.bytes), Buffer.from(z.bytes)) === 0 && a.bytes.length > 500
        && JSON.stringify(cols) === JSON.stringify(was.C.STA_BULK_COLS));
      const big = [cols].concat(Array.from({ length: 300 }, (v, i) => cols.map((c, j) => (j % 3 ? 'v' + i + '-' + j : i * 1.5))));
      ok('…and staXlsx itself on 300 rows', Buffer.compare(Buffer.from(was.C.staXlsx('Sponsored Products Campaigns', big)), Buffer.from(now.C.staXlsx('Sponsored Products Campaigns', big))) === 0);
    }
  }

  console.log('== speed: a re-filter on 20,000 terms ==');
  {
    const S = page();
    const { C, $ } = S;
    C.ST.set.d.SP.rows = bigRows();
    C.STS.stamp++;
    $('paneNgram').classList.remove('hide');
    const t0 = Date.now();
    C.renderNg();
    const built = Date.now() - t0;
    const times = [];
    [[2, 10, ''], [0, 20, ''], [1, 5, 'waste'], [3, 50, ''], [1, 10, '']].forEach(([size, min, cls]) => {
      C.NGS.size = size; C.NGS.min = min; C.NGS.cls = cls;
      const a = Date.now();
      C.renderNg();
      times.push(Date.now() - a);
    });
    $('ngFilter').value = 'linen';
    const a = Date.now(); C.renderNg(); times.push(Date.now() - a);
    ok(`size, minimum clicks, classification and filter re-filter the cached index under 100 ms (${times.join(', ')} ms; first build ${built} ms, ${C.getNGX().rows.length} patterns)`, Math.max(...times) < 100);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
