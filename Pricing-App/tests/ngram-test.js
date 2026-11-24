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
  'NG_XL_CP', 'NG_XL_TERMS', 'NG_XL_PAT', 'NG_XL_WCP', 'staXlsx', 'staXlsxBook', 'staFileName', 'staBulkFiles', 'STA_BULK_COLS', 'getNGLAST: () => NG_LAST',
  // 24 Nov: one target, one unit, the dialog, the window, the warning, blanks last.
  'staWordItems', 'staBurnSum', 'staCmpBlank', 'staTgtOf', 'staTgtWarn', 'staNoTgtBrands', 'staPlanRows', 'staPlanRules', 'staPlanHead', 'staLists', 'staActBar',
  'staFChips', 'staSetOpen', 'cpVerdict', 'ngToSt', 'ngSorted', 'STA_SORTS', 'STA_F', 'staWordCpRows',
  'getWin: () => STA_WIN', 'getStsB: () => STS_B', 'setView: (v, s) => { ST_VIEW = v; ST_SUB = s || ST_SUB; }'];
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


  console.log('== 24 Nov: one target ACoS, counts in one unit, the negate dialog, Mixed no-order spend, the window, blanks last ==');
  {
    const ST_SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'ads', 'search-terms.js'), 'utf8');
    const NG_SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'ads', 'ngram.js'), 'utf8');
    const HTML = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'index.html'), 'utf8');
    // 1. ONE TARGET ACoS.
    ok('1. no hidden default: CP_TARGET_DEFAULT is gone, Campaign × Product has no typed target (stCpTarget opens Lists & settings)', !/const CP_TARGET_DEFAULT|CP_TARGET_DEFAULT[;)]/.test(ST_SRC)
      && /<button id="stCpTarget"/.test(HTML) && !/localStorage\.(get|set)Item\('stCpTarget'/.test(ST_SRC) && /\$\('stCpTarget'\)\.addEventListener\('click', \(\) => staSetOpen\(/.test(ST_SRC));
    const T = page({ noTarget: true }), TC = T.C;
    const cpr = o => TC.cpVerdict(Object.assign({ brand: 'SP', st: 'E', stock: 80, cover: 60, c: 120, o: 6, sp: 60, s: 150, be: null, tgt: null }, o));
    ok('1. Campaign × Product with no unit cost and no target: "No target", nothing judged against one', cpr({}).act === 'No target' && cpr({}).v === '' && /no target ACoS/.test(cpr({}).why));
    ok('…over 100% ACoS still loses money whatever the cost: "Lower bids"', cpr({ sp: 200, s: 150 }).act === 'Lower bids' && /cost more than the sales/.test(cpr({ sp: 200, s: 150 }).why));
    ok('…with the brand\'s target from Lists & settings: judged against it, and it says where it came from', cpr({ tgt: 25, tgtSrc: 'list' }).act === 'Lower bids' && /target 25% \(Lists & settings\)/.test(cpr({ tgt: 25, tgtSrc: 'list' }).why));
    ok('1. staTgtOf: no unit cost and no target → none; a target in Lists & settings → that one', TC.staTgtOf('SP', 'B0NONE') === null && (() => {
      TC.STS.CPC = Object.assign({}, TC.STA_SET_DEF.CPC, { fallbackTgt: 22 });
      const t = TC.staTgtOf('CPC', 'B0NONE');
      return t && t.tgt === 22 && t.src === 'list';
    })());
    TC.STS.CPC = Object.assign({}, TC.STA_SET_DEF.CPC, { fallbackTgt: null, fallbackBe: null });
    TC.STS.stamp = (TC.STS.stamp || 0) + 1;
    const TL = TC.staLists();
    const rowsSent = TC.staPlanRows(TL);
    ok('1. Plan my moves sends no target or break-even that is not set (not the 100% loss line; a brand term\'s limit goes as brandLimit)', rowsSent.length > 0 && rowsSent.every(r => r.tgt === null && r.be === null)
      && rowsSent.filter(r => r.brandTerm).every(r => r.brandLimit === 50),
      JSON.stringify(rowsSent.filter(r => r.tgt != null || r.be != null).slice(0, 2)));
    ok('…its own fallback plan never mentions a target or break-even', TC.staPlanRules(TL).every(m => !/target|break-even/i.test(m.title + ' ' + m.why)), JSON.stringify(TC.staPlanRules(TL).map(m => m.why)));
    ok('…and it tells Claude which brands have none, and to never mention one for them', /noTarget: staNoTgtBrands\(/.test(ST_SRC) && /never mention a target, a break-even/.test(ST_SRC));
    T.$('paneNgram').classList.remove('hide');
    await TC.ensureNgram();
    ok('1. N-Gram with no target: no Winner, no pattern with a target', TC.getNGX().rows.every(x => x.tgt == null && x.base !== 'winner'));
    ok('1. the loss line is never a target: N-Gram averages only targets really set (r.tgtSet)', /r\.tgtSet && r\.tgtUse != null/.test(NG_SRC) && /r\.tgtSet = tgt != null/.test(ST_SRC));
    // The no-target warning: at the top of N-Gram too, and "Set a target ACoS" opens Lists & settings on that brand's target field.
    ok('6. the warning at the top of N-Gram (the same piece), per brand', !T.$('ngTgtWarn').classList.contains('hide') && /data-settgt="SP"/.test(T.$('ngTgtWarn').innerHTML)
      && HTML.indexOf('id="ngTgtWarn"') < HTML.indexOf('id="ngWin"') && HTML.indexOf('id="stTgtWarn"') < HTML.indexOf('id="stWin"'));
    TC.staSetOpen('CPC', 'tgt');
    ok('6. "Set a target ACoS": Lists & settings opens on that brand, at its target field', !T.$('stSet').classList.contains('hide') && TC.getStsB() === 'CPC'
      && /if \(focus === 'tgt'\)[\s\S]{0,200}scrollIntoView[\s\S]{0,120}f\.focus\(\)/.test(ST_SRC) && /closest\('\[data-settgt\]'\)[\s\S]{0,120}staSetOpen\(b\.dataset\.settgt, 'tgt'\)/.test(ST_SRC));
    // 2. COUNTS IN ONE UNIT.
    const P2 = page(), PC = P2.C;
    const L2 = PC.staLists(), B2 = PC.staBurnSum(L2.burn);
    PC.setView('burn', 'term');
    PC.staActBar(L2.burn);
    const chipSum = Object.values(B2.by).reduce((t, x) => t + x.sp, 0);
    const money0 = v => '$' + Math.round(v).toLocaleString('en-US');
    P2.$('paneSt').classList.remove('hide');
    PC.renderSt();
    ok('2. Burning money: the box, the chips and Plan my moves\' first line are one sum over the same rows', L2.burn.length > 0 && Math.abs(chipSum - B2.sp) < 0.005
      && Math.abs(PC.staPlanHead(L2).sp - B2.sp) < 0.005 && PC.staPlanHead(L2).n === L2.burn.length
      && P2.$('stBoxes').innerHTML.includes(money0(B2.sp)) && PC.staPlanHead(L2).html.includes(money0(B2.sp)), `${B2.sp} / ${chipSum} / ${PC.staPlanHead(L2).sp}`);
    ok('2. …each Burning-money chip says its $ and they add up to the box', /Next step · term rows/.test(P2.$('stActBar').innerHTML) && P2.$('stActBar').innerHTML.includes(`<span>${L2.burn.length} · ${money0(B2.sp)}</span>`), P2.$('stActBar').innerHTML.slice(0, 300));
    ok('2. …and the plan says why its moves add up to less', /the moves do not add up to it/.test(PC.staPlanHead(L2).html));
    PC.staFChips('stChips', 5, 12, [{ k: 'q', t: 'Search', v: 'x' }]);
    const fc1 = P2.$('stChips').innerHTML;
    PC.staFChips('stChips', 3, 9, [{ k: 'q', t: 'Search', v: 'x' }], 'campaigns');
    ok('2. every count says its unit: "Showing 5 of 12 term rows" (Placement: "campaigns")', /Showing 5 of 12 term rows/.test(fc1) && /Showing 3 of 9 campaigns/.test(P2.$('stChips').innerHTML));
    ok('2. …the boxes say "term rows" and "search terms (one per product)"; the footers the same', /on \d+ term rows?</.test(P2.$('stBoxes').innerHTML) && /search terms \(one per product\)/.test(P2.$('stBoxes').innerHTML)
      && /staPager\(rows\.length, 'term rows'/.test(ST_SRC) && !/staPager\(rows\.length, 'terms'/.test(ST_SRC));
    // 3. THE NEGATE DIALOG.
    const N3 = page({ extra: true }), NC = N3.C;
    N3.$('paneNgram').classList.remove('hide');
    await NC.ensureNgram();
    const gp = NC.getNGX().views[1].find(x => x.brand === 'SP' && x.gram === 'plastic');
    const tailOnly = Object.assign(Object.create(gp), { terms: [], tcp: new Map([['c4', 66.29]]), tag: '', gram: 'boho', term: 'boho', _plans: null,
      cps: new Map([['c1', { cid: 'c1', cn: 'SP - Runner - Broad', c: 200, sp: 30, tsp: 0, s: 0, o: 0, n: 4 }], ['c4', { cid: 'c4', cn: 'SP - Boho', c: 0, sp: 0, tsp: 66.29, s: 0, o: 0, n: 0 }]]) });
    const tp = [0, 5, 10, 20].map(f => NC.ngPlan(tailOnly, f));
    const c4 = tp[0].nodata.find(x => x.cid === 'c4');
    ok('3d. a campaign with $66.29 spend and 0 clicks never says Negate, at any minimum: "Not judged: no click data", saying the spend is small terms\'', c4 && c4.can && !c4.on
      && /\$66\.29 from small search terms not listed one by one/.test(c4.ev) && tp.every(P => !P.neg.some(x => x.cid === 'c4')) && NC.ngCpWhy(c4).startsWith('Not judged: no click data'), c4 && c4.ev);
    NC.staOpen('word', tailOnly.key, NC.ngWordRow(tailOnly));
    const dl3 = N3.$('stDlgBody').innerHTML;
    const fire3 = (el, type, target) => N3.$(el).listeners[type].forEach(f => f({ target }));
    fire3('stDlgBody', 'click', { closest: q => (q === '[data-cpall]' ? {} : null) });
    const rowsNow = NC.staWordCpRows(NC.ngWordRow(tailOnly), 0);
    ok('3b, 3c. "Select all eligible" ticks only "Negate here" rows with clicks; the 0-click row is never ticked, but can be by hand', /Not judged: no click data/.test(dl3)
      && N3.$('stDlgCpN').textContent.startsWith('1 of 2') && rowsNow.find(x => x.cid === 'c4').can && !rowsNow.find(x => x.cid === 'c4').on, N3.$('stDlgCpN').textContent);
    ok('3e. the spend of a campaign\'s small terms is its own line, never in Spend beside Clicks', /\+ \$66\.29 small terms/.test(dl3));
    const T3 = page({ tail: true }), idx = T3.C.staModel('ALL').grams.SP.get('plastic');
    const c1 = idx.cps.get('c1');
    ok('3e. the cause: the backend splits the small terms\' spend by campaign but not their clicks — kept apart now (tsp), Spend and Clicks from the same rows',
      c1 && c1.tsp > 0 && c1.c > 0 && Math.abs(c1.sp - idx.terms.filter(r => r.cid === 'c1').reduce((t, r) => t + r.sp, 0)) < 0.005, JSON.stringify(c1));
    ok('3g. the minimum spend per campaign stays $0 by default', /return NG_CP_FLOORS\.includes\(v\) \? v : 0; \} catch \(e\) \{ return 0; \}/.test(NG_SRC));
    // 4. Mixed: no-order spend for every pattern.
    const mixed = NC.getNGX().rows.filter(x => NC.ngCls(x, 10) === 'mixed');
    ok('4. No-order spend filled for every pattern, every Mixed row included', NC.getNGX().rows.every(x => typeof NC.ngNos(x) === 'number' && NC.ngNos(x) === (x.zsp || 0)) && mixed.length > 0, mixed.length + ' mixed');
    // 5. N-Gram → Search Term Analysis carries the window and the filters.
    const win = NC.getWin(), F = JSON.stringify(Object.fromEntries(Object.entries(NC.STA_F).map(([k, v]) => [k, v instanceof Set ? [...v] : v])));
    NC.ngToSt('SP', 'plastic');
    ok('5. ngToSt keeps N-Gram\'s window and filters (never back to another window)', NC.getWin() === win && JSON.stringify(Object.fromEntries(Object.entries(NC.STA_F).map(([k, v]) => [k, v instanceof Set ? [...v] : v]))) === F
      && N3.$('stFilter').value === 'plastic' && /STA_WIN = win;/.test(NG_SRC));
    // 7. Empty values sort last in both directions.
    const vs = [3, null, 1, undefined, 2];
    const up = vs.slice().sort((a, z) => NC.staCmpBlank(a, z, 1)), down = vs.slice().sort((a, z) => NC.staCmpBlank(a, z, -1));
    ok('7. staCmpBlank: empty last both ways', up.slice(0, 3).join() === '1,2,3' && down.slice(0, 3).join() === '3,2,1' && up.slice(3).every(v => v == null) && down.slice(3).every(v => v == null));
    ok('7. …Search Term Analysis\'s % columns give "no value" for no sales / no clicks (not −1)', NC.STA_SORTS.acos({ acos: null }) === null && NC.STA_SORTS.cvr({ c: 0, o: 0 }) === null && NC.STA_SORTS.cvr({ c: 10, o: 0 }) === 0);
    NC.NGS.sort = { k: 'acos', d: 1 };
    const sA = NC.ngSorted(NC.getNGX().rows);
    NC.NGS.sort = { k: 'acos', d: -1 };
    const sD = NC.ngSorted(NC.getNGX().rows);
    const lastBlank = s => { const i = s.findIndex(x => x.acos == null); return i < 0 || s.slice(i).every(x => x.acos == null); };
    ok('7. …and N-Gram\'s ACoS and CVR: patterns with no sales last whether sorted up or down', lastBlank(sA) && lastBlank(sD) && sA.some(x => x.acos == null));
  }

  console.log('== By word: the same rows as before the shared index ==');
  // 24 Nov: a campaign's spend is its listed terms' (sp, the same rows as its clicks c) and the small terms' apart (tsp); the
  // old rows had them added and no clicks — folded back here, so the comparison checks everything else is unchanged.
  const legacyWords = ws => ws.map(w => Object.assign({}, w, { cps: w.cps.map(x => ({ cid: x.cid, cn: x.cn, sp: x.sp + (x.tsp || 0), s: x.s, o: x.o, n: x.n })) }));
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
        const a = JSON.stringify(was.C.staModel('ALL').words), z = JSON.stringify(legacyWords(now.C.staModel('ALL').words));
        ok(`By word rows identical before and after${tail ? ' (with the backend\'s tail)' : ''}: ${JSON.parse(z).length} rows (each campaign's listed + small-term spend folded back)`, a === z && JSON.parse(z).length > 0, a === z ? '' : a.slice(0, 300) + ' ≠ ' + z.slice(0, 300));
      }
      const was = setup({ stText: oldPlus, names: ['ST', 'STS', 'STA_SET_DEF', 'staModel'] }), now = page({ tail: true });
      account(was.C, { tail: true });
      const big = bigRows();
      was.C.ST.set.d.SP.rows = big;
      now.C.ST.set.d.SP.rows = big.map(r => Object.assign({}, r));
      was.C.STS.stamp++; now.C.STS.stamp++;
      const a = JSON.stringify(was.C.staModel('ALL').words), z = JSON.stringify(legacyWords(now.C.staModel('ALL').words));
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
    ok('no costs and no target (24 Nov): the warning at the top, per brand, each with "Set a target ACoS" on its brand — not inside the notes',
      !N.$('stTgtWarn').classList.contains('hide') && /data-settgt="SP"/.test(N.$('stTgtWarn').innerHTML) && /data-settgt="CPC"/.test(N.$('stTgtWarn').innerHTML)
      && /Ridhi: no target ACoS/.test(strip(N.$('stTgtWarn').innerHTML)) && !/sta-costwarn|data-settgt/.test(N.$('stMsg').innerHTML), strip(N.$('stTgtWarn').innerHTML).slice(0, 160));
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
    // 1, 3. Per campaign (24 Nov): at any minimum, only where 0 orders in its clicks is under NG.NEG_CHANCE — "0 in 0 clicks ·
    // 100% chance" can never say Negate; $5 / $10 / $20 also ask for that much spent. The chance shows either way.
    ok('the yardstick: the campaign\'s own order rate with 3+ orders, else the brand\'s (as Search Term Analysis)', (() => {
      const a = C.ngCpRate(g('vinyl'), 'c1'), z = C.ngCpRate(g('vinyl'), 'c9');
      return a.w === 'its campaign' && Math.abs(a.p - 25 / 300) < 1e-9 && z.w === 'the brand' && Math.abs(z.p - M.rate.SP.b.o / M.rate.SP.b.c) < 1e-9;
    })());
    const vp = C.ngPlan(g('vinyl'));
    const ch1 = Math.pow(1 - 25 / 300, 60);
    ok(`vinyl at $0: both no-order campaigns ticked (each under 1% chance), kept where it sells — tickable by hand, never ticked at first; "0 in 60 clicks · ${C.staChance(ch1)} chance"`, vp.neg.map(c => c.cid).sort().join() === 'c1,c2' && vp.kept.map(c => c.cid).join() === 'c3'
      && vp.neg.find(c => c.cid === 'c1').ev === `0 in 60 clicks · ${C.staChance(ch1)} chance` && vp.neg.every(c => c.can && c.on) && vp.kept.every(c => c.can && !c.on), JSON.stringify(vp.neg.map(c => c.ev)));
    const pp0 = C.ngPlan(g('plastic')), pp10 = C.ngPlan(g('plastic'), 10);
    ok('plastic at $0 (24 Nov): only c1 — c2\'s "0 in 60 clicks · 11.8% chance" can never say Negate: kept, not enough data, tickable by hand', pp0.neg.map(c => c.cid).join() === 'c1'
      && pp0.thin.map(c => c.cid).join() === 'c2' && pp0.thin[0].ev === '0 in 60 clicks · 11.8% chance' && pp0.thin[0].can && !pp0.thin[0].on && /could still be luck/.test(C.ngCpWhy(pp0.thin[0])), JSON.stringify(pp0.neg.map(c => c.ev)));
    ok('plastic at $10: only c1; c2 "Kept: not enough data here (60 clicks, $18.00)", unticked but tickable — could still be luck', pp10.neg.map(c => c.cid).join() === 'c1' && pp10.thin.map(c => c.cid).join() === 'c2'
      && pp10.thin[0].why === '60 clicks, $18.00' && pp10.thin[0].can && !pp10.thin[0].on && /could still be luck/.test(C.ngCpWhy(pp10.thin[0])), C.ngCpWhy(pp10.thin[0]));
    const pn = C.ngNext(g('plastic'), 10);
    ok('the table\'s button uses $0: "Negate in 1 campaign" on plastic; No-order spend is its no-order terms\' spend', pn.act === 'neg' && pn.short === 'Negate in 1 campaign'
      && C.ngNos(g('plastic')) === g('plastic').zsp && g('plastic').zsp > 0, pn.short);
    // The "decorative" case: $30 in c1 (200 clicks), $7.20 in c2 (4 clicks), $5.97 in c3 (300 clicks).
    const dec = Object.assign(Object.create(g('plastic')), { terms: [], tcp: null, tag: '', gram: 'decorative', term: 'decorative',
      cps: new Map([['c1', { cid: 'c1', cn: 'SP - Runner - Broad', c: 200, sp: 30, s: 0, o: 0, n: 4 }], ['c2', { cid: 'c2', cn: 'SP - Napkins - Auto', c: 4, sp: 7.2, s: 0, o: 0, n: 1 }],
        ['c3', { cid: 'c3', cn: 'SP - Exact', c: 300, sp: 5.97, s: 0, o: 0, n: 2 }]]) });
    const decAt = v => C.ngPlan(dec, v).neg.map(c => c.cid).sort().join();
    ok('"decorative": $0 c1 and c3 (c2: 4 clicks could be chance); $5 c1 and c3; $10 and $20 c1 only', decAt(0) === 'c1,c3' && decAt(5) === 'c1,c3' && decAt(10) === 'c1' && decAt(20) === 'c1', [0, 5, 10, 20].map(decAt).join(' / '));
    const d10 = C.ngPlan(dec, 10);
    ok('…at $10: "Kept: not enough data here (4 clicks, $7.20)", and c3 under the $10 minimum', C.ngCpWhy(d10.thin.find(c => c.cid === 'c2')).startsWith('Kept: not enough data here (4 clicks, $7.20)')
      && /under the \$10\.00 minimum spend per campaign/.test(C.ngCpWhy(d10.thin.find(c => c.cid === 'c3'))), d10.thin.map(C.ngCpWhy).join(' | '));
    ok('a blocked word is ticked in every no-order campaign at any minimum (its class)', [0, 20].every(v => { const p = C.ngPlan(g('cheap'), v); return p.neg.length === 1 && /blocked word: negated at any spend/.test(p.neg[0].ev) && !p.thin.length; }));

    // 1. 24 Nov: over every Waste row of every size and every minimum, nothing with 0 clicks, or 0 orders that could still be
    // chance (1% or more), is ever ticked or called "Negate here" — a blocked word or competitor at any chance, never with 0 clicks.
    {
      let n = 0;
      const bad = [];
      [0, 1, 2, 3].forEach(sz => C.getNGX().views[sz].forEach(gn => {
        if (C.ngCls(gn, 10) !== 'waste' || gn.protect) return;
        n++;
        [0, 5, 10, 20].forEach(fl => C.ngPlan(gn, fl).neg.forEach(x => {
          if (!(x.c > 0) || (!gn.tag && !(x.chance < 0.01))) bad.push(`${gn.key} $${fl}: ${x.cid} (${x.ev})`);
        }));
      }));
      ok(`no campaign with 0 clicks or a 1%+ chance is ever "Negate here" (${n} Waste rows, every size, $0 / $5 / $10 / $20)`, n > 5 && !bad.length, bad.slice(0, 4).join(' | '));
    }

    // 1. The popup's campaign table (Amazon's record of the campaigns gives their kind), at the $0 default.
    C.ST.ent.d.SP.cp = { c1: ['SP - Runner - Broad', 'ENABLED', 50, 'LEGACY_FOR_SALES', 0, 0, 0, 'MANUAL', 0], c2: ['SP - Napkins - Auto', 'ENABLED', 40, 'AUTO_FOR_SALES', 0, 0, 0, 'AUTO', 0] };
    C.staOpen('word', g('plastic').key, C.ngWordRow(g('plastic')));
    const body = $('stDlgBody').innerHTML, bt = strip(body).replace(/&lt;/g, '<');
    ok('the popup: a table — ✓ | Campaign | Spend | Clicks | Orders | Terms | Evidence | What happens', /<div class="sta-dcp" id="stDlgCp"><table class="xl"><thead><tr><th class="sta-dcb">/.test(body)
      && /Campaign Spend Clicks Orders Terms Evidence What happens/.test(bt) && !/sta-cplist/.test(body), bt.slice(0, 200));
    ok('…one row per campaign, by spend, the name with "N ad groups · kind" under it', bt.indexOf('SP - Runner - Broad') < bt.indexOf('SP - Napkins - Auto') && /SP - Runner - Broad 1 ad group · Manual/.test(bt) && /SP - Napkins - Auto 1 ad group · Auto/.test(bt), bt);
    ok('…"Minimum spend per campaign": $0 · $5 · $10 · $20, $0 at first', /<select id="stDlgCpMin"><option value="0" selected>\$0<\/option><option value="5">\$5<\/option><option value="10">\$10<\/option><option value="20">\$20<\/option><\/select>/.test(body)
      && /Minimum spend per campaign/.test(bt));
    ok('…at $0 only c1 ticked (c2 could still be chance), the chance on each row: "1 of 2 campaigns ticked", "Add 1 negative"', /data-cp="0" checked/.test(body) && !/data-cp="1" checked/.test(body)
      && /0 in 90 clicks · <0\.1% chance/.test(bt) && /0 in 60 clicks · 11\.8% chance/.test(bt) && $('stDlgCpN').textContent.startsWith('1 of 2 campaigns ticked · $')
      && $('stDlgOk').textContent === 'Add 1 negative to review list', $('stDlgCpN').textContent);
    ok('…"Select all eligible · Clear" above it; the figures card adds "Spend with no orders"; example terms as chips', /data-cpall="1">Select all eligible/.test(body) && /data-cpnone="1">Clear/.test(body)
      && /<small>Spend with no orders<\/small><b>\$45\.00<\/b>/.test(body) && (body.match(/class="sta-tchip"/g) || []).length === 2 && !/For example: /.test(body));
    ok('…the dialog is the wide one, with "Download Excel" in its footer', $('stDlg').classList.contains('sta-dlgword') && !$('stDlgXlsx').classList.contains('hide'));
    const fire = (el, type, target) => $(el).listeners[type].forEach(f => f({ target }));
    const btnOf = s => ({ closest: q => (q === s ? {} : null) });
    // The picker: $10.
    fire('stDlgBody', 'change', { id: 'stDlgCpMin', value: '10', dataset: {} });
    ok('$10: only c1 ticked ("1 of 2", "Add 1 negative"), c2 "Kept: not enough data here"; remembered on this device', /data-cp="0" checked/.test($('stDlgCp').innerHTML) && !/data-cp="1" checked/.test($('stDlgCp').innerHTML)
      && /Kept: not enough data here/.test($('stDlgCp').innerHTML) && $('stDlgCpN').textContent.startsWith('1 of 2 campaigns ticked · $') && $('stDlgOk').textContent === 'Add 1 negative to review list'
      && S.store.ngCpFloor === '10', $('stDlgCpN').textContent);
    // 3. By hand.
    fire('stDlgBody', 'change', { dataset: { cp: '1' }, checked: true });
    ok('ticking c2 by hand: "2 of 2", the button says 2', $('stDlgCpN').textContent.startsWith('2 of 2 campaigns ticked · $') && $('stDlgOk').textContent === 'Add 2 negatives to review list');
    fire('stDlgBody', 'click', btnOf('[data-cpnone]'));
    ok('"Clear": none ticked — "Tick campaigns to negate", disabled', $('stDlgCpN').textContent.startsWith('0 of 2') && $('stDlgOk').disabled && $('stDlgOk').textContent === 'Tick campaigns to negate');
    fire('stDlgBody', 'click', btnOf('[data-cpall]'));
    ok('"Select all eligible": back to the ticks of the minimum chosen ($10: 1)', $('stDlgCpN').textContent.startsWith('1 of 2') && !$('stDlgOk').disabled);
    // 2. The popup's Excel file.
    $('stDlgXlsx').listeners.click.forEach(f => f());
    let f1 = dl.files.slice(-1)[0];
    ok('Download Excel: "plastic - Ridhi.xlsx" with both brands on screen', f1 && f1.name === 'plastic - Ridhi.xlsx' && /spreadsheetml/.test(f1.type), f1 && f1.name);
    await new Promise(r => setImmediate(r));
    ok('…its URL let go after 2 s', dl.timers.includes(2000) && dl.revoked.includes(f1.href));
    let B = book(f1.bytes);
    const cpS = B.sheets.Campaigns, tS = B.sheets['Search terms'], sS = B.sheets.Summary;
    ok('three sheets: Campaigns, Search terms, Summary', B.names.join() === 'Campaigns,Search terms,Summary');
    ok('Campaigns: the columns of the brief', vals(cpS[0]).join('|') === C.NG_XL_CP.join('|') && C.NG_XL_CP.join('|') === 'Campaign|Campaign ID|Brand|Negate|Why|Spend|Clicks|Orders|Sales|ACoS %|Search terms|Top terms|Spend in small terms not listed');
    const c1r = cpS.find(r => r[0].v === 'SP - Runner - Broad'), c2r = cpS.find(r => r[0].v === 'SP - Napkins - Auto');
    ok('…one row per campaign: Negate Yes / No as ticked, the Why with its evidence, IDs as text', c1r[3].v === 'Yes' && c2r[3].v === 'No' && c1r[1].v === 'c1' && /^Negate here — 0 in 90 clicks · <0\.1% chance at its campaign's 8\.3% order rate$/.test(c1r[4].v)
      && /^Kept: not enough data here \(60 clicks, \$18\.00\) — 0 in 60 clicks · 11\.8% chance/.test(c2r[4].v), c1r[4].v + ' / ' + c2r[4].v);
    ok('…numbers as numbers, money with 2 decimals (style), headings bold', c1r[5].v === 27 && c1r[5].s === 2 && c1r[6].v === 90 && c1r[6].s === 0 && cpS[0][0].s === 1 && /numFmtId="4"/.test(B.z['xl/styles.xml']) && /<cols><col min="1"/.test(B.z['xl/worksheets/sheet1.xml']));
    const tot = cpS[cpS.length - 1];
    ok('…a total row, in bold, that adds up', tot[0].v === 'Total' && tot[0].s === 1 && tot[5].v === 45 && tot[5].s === 3 && tot[6].v === 150 && tot[3].v === '1 Yes', JSON.stringify(vals(tot)));
    ok('Search terms: every term behind it, with campaign, ad group and its verdict', vals(tS[0]).join('|') === C.NG_XL_TERMS.join('|') && tS.length === g('plastic').terms.length + 2
      && tS.some(r => r[0].v === 'plastic table runner' && r[1].v === 'SP - Runner - Broad' && r[2].v === 'Runner broad' && r[4].v === 27) && tS[tS.length - 1][4].v === 45, JSON.stringify(tS.map(vals)));
    const sum = Object.fromEntries(sS.slice(1).map(r => [r[0].v, r[1] ? r[1].v : '']));
    ok('Summary: pattern, brand, window, class and reason, totals, campaigns to negate, the minimum chosen, downloaded at / by', sum.Pattern === 'plastic' && sum.Brand === 'Ridhi' && /settled 14 Oct – 12 Nov/.test(sum.Window)
      && sum.Class === 'Waste · no sales' && /0 orders in 150 clicks/.test(sum.Reason) && sum.Spend === 45 && sum['Campaigns to negate'] === 1 && sum['Spend in them'] === 27 && sum['Sales at risk'] === 0
      && sum['No-order spend (its search terms with no order)'] === Math.round(g('plastic').zsp * 100) / 100 && sum['Of them, chosen by hand where it sells'] === 'none'
      && sum['Minimum spend per campaign'] === 10 && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(sum['Downloaded at']) && sum['Downloaded by'] === C.ppchPerson() && !!sum['Downloaded by'], JSON.stringify(sum));
    // The ticks in the dialog go into the file.
    fire('stDlgBody', 'change', { dataset: { cp: '1' }, checked: true });
    $('stDlgXlsx').listeners.click.forEach(f => f());
    B = book(dl.files.slice(-1)[0].bytes);
    ok('…the file follows the ticks in the dialog (both Yes now, c2 "Ticked by hand")', B.sheets.Campaigns.filter(r => r[3] && r[3].v === 'Yes').length === 2
      && /^Ticked by hand — 0 in 60 clicks/.test(B.sheets.Campaigns.find(r => r[0].v === 'SP - Napkins - Auto')[4].v));
    // Only the ticked go to the review list.
    fire('stDlgBody', 'click', btnOf('[data-cpall]'));
    const before = C.ST_RL.items.length;
    await C.staDlgOk();
    const added = C.ST_RL.items.slice(before);
    ok('"Add 1 negative": one review item, the ticked campaign only', added.length === 1 && added[0].cid === 'c1' && added[0].neg.type === 'negativePhrase', JSON.stringify(added.map(x => x.cid)));
    // The minimum is remembered: the next popup opens at $10; back to $0.
    C.staOpen('word', g('vinyl').key, C.ngWordRow(g('vinyl')));
    ok('the next popup opens at the remembered $10', /<option value="10" selected>/.test($('stDlgBody').innerHTML));
    fire('stDlgBody', 'change', { id: 'stDlgCpMin', value: '0', dataset: {} });
    ok('…and back to $0 (remembered too)', S.store.ngCpFloor === '0' && $('stDlgCpN').textContent.startsWith('2 of 3'));
    // 3a, 3f (24 Nov): a campaign where it sells is shown, not ticked, but can be ticked by hand — then an orange line in its row
    // and in the total, and the review item and the Excel file say "sells here — chosen by hand".
    const keptRow = ($('stDlgCp').innerHTML.split('<tr').find(t => /Kept: sells here/.test(t)) || '');
    const keptI = (/data-cp="(\d+)"/.exec(keptRow) || [])[1];
    ok('3a. a campaign where it sells: shown, "Kept: sells here", not ticked, but tickable by hand, with its orange line ready', keptI != null && !/ disabled/.test(keptRow.split('</td>')[0])
      && !/ checked/.test(keptRow.split('</td>')[0]) && /class="sta-sellwarn">Sells here: 3 orders · \$30\.00 sales/.test(keptRow) && /3 orders · \$30\.00 sales/.test($('stDlgCp').innerHTML), keptRow.slice(0, 200));
    fire('stDlgBody', 'change', { dataset: { cp: keptI }, checked: true });
    ok('3f. ticked by hand: the total says it in orange — "includes 1 campaign that sells this pattern: 3 orders · $30.00 sales"',
      /<span class="sta-sellwarn sta-sellwarn-tot">includes 1 campaign that sells this pattern: 3 orders · \$30\.00 sales<\/span>/.test($('stDlgCpN').innerHTML)
      && /chosen by hand/.test($('stDlgChecks').innerHTML), $('stDlgCpN').innerHTML);
    const keptPlan = C.ngPlan(g('vinyl')).kept[0];
    const kItems = C.staWordItems(C.ngWordRow(g('vinyl')), [keptPlan]);
    ok('3f. …the review item marks it "Sells here — chosen by hand"', kItems.length === 1 && kItems[0].sellsHere === true && /^Sells here — chosen by hand: 3 orders · \$30\.00 sales/.test(kItems[0].why), JSON.stringify(kItems.map(x => x.why)));
    $('stDlgXlsx').listeners.click.forEach(f => f());
    const kb = book(dl.files.slice(-1)[0].bytes).sheets.Campaigns.find(r => r[1] && r[1].v === 'c3');
    ok('3f. …and the Excel file: Negate Yes, "Sells here — chosen by hand"', kb && kb[3].v === 'Yes' && /^Sells here — chosen by hand — 3 orders/.test(kb[4].v), kb && kb[4].v);
    $('stDlg').classList.add('hide');
    ok('file names: characters a file name cannot hold are taken out', C.staFileName('a/b:c*?"<>|d.') === 'a b c d' && C.staFileName('christmas') === 'christmas');
    $('ngBrand').value = 'SP';
    ok('one brand on screen: "<pattern>.xlsx"', C.ngXlsxName(g('vinyl')) === 'vinyl.xlsx');
    $('ngBrand').value = 'ALL';
    // By word's own dialog: every campaign "Negate here", ticked, no minimum, no Excel.
    const bw = C.staModel('ALL').words.find(w => w.cps && w.cps.length);
    if (bw) {
      C.staOpen('word', bw.key, bw);
      ok('By word\'s dialog: the same table, its campaigns ticked, no minimum picker, no Excel button', /class="sta-dcp"/.test($('stDlgBody').innerHTML) && (($('stDlgBody').innerHTML.match(/data-cp="\d+" checked/g) || []).length === bw.cps.length)
        && !/stDlgCpMin/.test($('stDlgBody').innerHTML) && $('stDlgXlsx').classList.contains('hide'));
      $('stDlg').classList.add('hide');
    }
    // An opened Waste row: "Download Excel" in What the action does; c1 now waiting in the review list.
    C.NGS.open.add(g('plastic').key);
    C.renderNg();
    const t0 = $('ngTable').innerHTML;
    ok('an opened Waste row: "Download Excel", every campaign and what happens there', new RegExp(`data-ngxl="${g('plastic').key.replace('|', '\\|')}"[^>]*>Download Excel<`).test(t0) && /In the review list/.test(t0));
    const nFiles = dl.files.length;
    $('ngTable').listeners.click.forEach(f => f({ target: { closest: s => (s === 'button[data-ngxl]' ? { dataset: { ngxl: g('plastic').key } } : null) } }));
    ok('…which downloads the same file', dl.files.length === nFiles + 1 && dl.files.slice(-1)[0].name === 'plastic - Ridhi.xlsx');
    C.NGS.open.clear();

    // 2. Every Waste pattern opens its popup: "Campaigns & Excel" where there is no Negate button.
    C.renderNg();
    const rowAt = gram => { const h = $('ngTable').innerHTML, i = h.indexOf('"' + gram + '"'); return h.slice(i, h.indexOf('</tr>', i)); };
    ok('sells in every campaign (jute): "Lower bids where it sells →" and "Campaigns & Excel"', /data-ngact="st"[^>]*>Lower bids where it sells →<\/button><button[^>]*data-ngact="cps"[^>]*>Campaigns &amp; Excel</.test(rowAt('jute')), strip(rowAt('jute')));
    ok('a protected pattern (ridhi): "Lower bids instead →" and "Campaigns & Excel"', /data-ngact="low"[^>]*>Lower bids instead →<\/button><button[^>]*data-ngact="cps"/.test(rowAt('ridhi')), strip(rowAt('ridhi')));
    ok('a row with a Negate button needs no second way in', !/data-ngact="cps"/.test(rowAt('vinyl')));
    const clickAct = (act, key) => $('ngTable').listeners.click.forEach(f => f({ target: { closest: s => (s === 'button[data-ngact]' ? { dataset: { ngact: act, k: key } } : null) } }));
    clickAct('cps', g('jute').key);
    const jb = $('stDlgBody').innerHTML;
    ok('…it opens the same popup: every campaign with its reason, the figures, the chips — nothing ticked', !$('stDlg').classList.contains('hide') && /Add negative phrase "jute"/.test($('stDlgTitle').textContent)
      && (jb.match(/data-cp=/g) || []).length === 2 && !/ checked/.test(jb) && (jb.match(/Kept: sells here/g) || []).length === 2 && /sta-figs7/.test(jb) && /class="sta-tchip"/.test(jb), strip(jb).slice(0, 300));
    ok('…"Tick campaigns to negate", disabled; "Download Excel" there and enabled', $('stDlgOk').textContent === 'Tick campaigns to negate' && $('stDlgOk').disabled && !$('stDlgXlsx').classList.contains('hide') && !$('stDlgXlsx').disabled);
    $('stDlgXlsx').listeners.click.forEach(f => f());
    const jf = dl.files.slice(-1)[0], JB = book(jf.bytes);
    ok('…its file: "jute - Ridhi.xlsx", each campaign "No" with its reason', jf.name === 'jute - Ridhi.xlsx' && JB.sheets.Campaigns.slice(1, -1).every(r => r[3].v === 'No' && /^Kept: sells here — /.test(r[4].v)), JSON.stringify(JB.sheets.Campaigns.map(vals)));
    clickAct('cps', g('ridhi').key);
    ok('the protected pattern\'s popup: every campaign "Protected", none tickable', /Add negative phrase "ridhi"/.test($('stDlgTitle').textContent) && !/data-cp="\d" (checked|>)/.test($('stDlgBody').innerHTML)
      && /Brand term: never negated/.test($('stDlgBody').innerHTML) && $('stDlgOk').disabled);
    $('stDlg').classList.add('hide');
    // 4. Nothing to negate: said in counts.
    const mix = Object.assign(Object.create(g('jute')), { terms: [{ cid: 'c4', noNeg: 'brand term', sp: 3 }], tcp: null, gram: 'mixpattern', wk: 'nosale',
      cps: new Map([['c1', { cid: 'c1', cn: 'A', c: 20, sp: 9, s: 30, o: 2, n: 1 }], ['c2', { cid: 'c2', cn: 'B', c: 10, sp: 6, s: 0, o: 0, n: 1 }], ['c3', { cid: 'c3', cn: 'C', c: 9, sp: 4, s: 20, o: 1, n: 1 }],
        ['c4', { cid: 'c4', cn: 'D', c: 5, sp: 3, s: 0, o: 0, n: 1 }]]) });
    C.ST_RL.items.push({ id: 'q1', kind: 'neg', brand: 'SP', term: 'mixpattern', cid: 'c2', status: 'review' });
    const mx = C.ngNext(mix, 10);
    C.ST_RL.items.pop();
    ok('nothing to negate, in counts: "Sells in 2 campaigns · protected in 1 · 1 in the review list"', mx.act === 'st' && mx.short === 'Sells in 2 campaigns · protected in 1 · 1 in the review list' && mx.pop, JSON.stringify(mx));
    ok('…never "No campaign left to negate" any more', !/No campaign left to negate/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'ads', 'ngram.js'), 'utf8')));

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
    ok('No-order spend (24 Nov): every pattern\'s spend on search terms with no order — Waste, Winner and Mixed alike', ['vinyl', 'plastic', 'linen'].every(x => C.ngNos(g(x)) === g(x).zsp)
      && C.ngNos(g('plastic')) === 45 && C.ngNos(g('linen')) != null);
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
    ok('Patterns: the columns, one row per Waste pattern on screen (in its order), a total', vals(pS[0]).join('|') === 'Pattern|Brand|Waste kind|Reason|No-order spend|Spend|Clicks|Orders|Campaigns to negate|Spend in them|Sales at risk'
      && pS.length === last.length + 2 && pS.slice(1, -1).map(r => r[0].v).join() === last.map(x => x.term).join() && pS.find(r => r[0].v === 'vinyl')[2].v === 'Waste · over break-even'
      && pS.find(r => r[0].v === 'vinyl')[4].v === Math.round(g('vinyl').zsp * 100) / 100 && pS.find(r => r[0].v === 'vinyl')[8].v === 2 && pS.find(r => r[0].v === 'vinyl')[9].v === 27, JSON.stringify(pS.map(vals).slice(0, 4)));
    const negRows = last.flatMap(x => (C.ngNext(x, 10).act === 'neg' ? C.ngPlan(x).neg.map(c => [x.term, c]) : []));
    const allRows = last.flatMap(x => C.ngPlanAll(C.ngPlan(x)).map(c => [x.term, c]));
    ok(`Campaigns: every campaign of every Waste pattern (${allRows.length}), Negate Yes / No by the $0 default (${negRows.length} Yes) and the reason`, vals(wcS[0]).join('|') === 'Pattern|Campaign|Campaign ID|Negate|Reason|Spend|Clicks|Orders|Evidence'
      && wcS.length === allRows.length + 2 && wcS.filter(r => r[3] && r[3].v === 'Yes').length === negRows.length && wcS[wcS.length - 1][3].v === `${negRows.length} Yes`
      && wcS.some(r => r[0].v === 'vinyl' && r[2].v === 'c1' && r[3].v === 'Yes' && /^Negate here — 0 in 60 clicks · 0.5% chance/.test(r[4].v))
      && wcS.some(r => r[0].v === 'vinyl' && r[2].v === 'c3' && r[3].v === 'No' && /^Kept: sells here — 3 orders/.test(r[4].v))
      && wcS.some(r => r[0].v === 'plastic' && r[2].v === 'c1' && r[3].v === 'No' && /^In the review list/.test(r[4].v))
      && wcS.filter(r => r[0].v === 'jute').every(r => r[3].v === 'No') && wcS.filter(r => r[0].v === 'ridhi').every(r => r[3].v === 'No' && /^Protected — Brand term: never negated/.test(r[4].v))
      && Math.abs(pS[pS.length - 1][9].v - negRows.reduce((t, [, c]) => t + c.sp + (c.tsp || 0), 0)) < 0.005, JSON.stringify(wcS.map(vals).slice(0, 6)));
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
