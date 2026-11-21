/* N-Gram Analysis (src/app/ads/ngram.js), the pattern index it shares with Search Term Analysis's "By word" (staGramIndex in
 * ads/search-terms.js) and the status dropdown both screens use (staStatus), over the real files in a stub page (the same one
 * ppc-history-test.js uses), with a small sample account.
 *   node tests/ngram-test.js
 * Covers: counting (1-, 2-, 3-word sequences, a term once per pattern, stop words, ASIN, negated and data-check terms left
 * out, the tail), every classification rule (the chance test, the $10 floor, break-even, the loss line, Winner, Mixed, no unit
 * costs), protected patterns get no negative, blocked words and competitor brands, the negate plan keeps campaigns where it
 * sells, the harvest pick, the dialogs it opens and the selection bar, By word rows unchanged after the refactor (against
 * search-terms.js at BEFORE), the status summary (notes, red and open by itself when suggestions are blocked), the page
 * drawn, the CSV, and the speed of a re-filter on 20,000 terms. */
const cp = require('child_process');
const { setup } = require('./ppc-history-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
// search-terms.js before the pattern index was shared (the PPC History commit, 21 Nov 2026).
const BEFORE = '51f8c075';
const NAMES = ['ST', 'STS', 'STA', 'STA_SET_DEF', 'staModel', 'staDataLine', 'staStatus', 'renderSt', 'staDlgOk', 'staOpen',
  'NG', 'NGS', 'ngBuild', 'ngClassOf', 'ngCls', 'ngNext', 'ngPlan', 'ngHarvest', 'ngWordRow', 'ngRows', 'ngCsvLines', 'NG_CSV_COLS', 'renderNg', 'ensureNgram', 'ngQuick', 'getNGX: () => NGX', 'staGramIndex', 'ngDistinct', 'ensureSt', 'staLoadSure'];

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
    T('vinyl table runner', 'c1', 'a1', 30, 15, 0, 0, 'table runner', 'BROAD'),
    T('vinyl tablecloth', 'c2', 'a2', 25, 12, 0, 0),
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
  ];
  const CPC = o.cpcEmpty ? [] : [T('cotton print club napkins', 'k1', 'b1', 30, 6, 4, 80, 'napkins', 'BROAD'), T('plain napkins', 'k1', 'b1', 40, 12, 1, 20, 'napkins', 'BROAD')];
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
    ok('Waste: "Negate in 2 campaigns", kept where it sells', nv.act === 'neg' && nv.n === 2 && /kept in 1 where it sells/.test(nv.text), JSON.stringify(nv));
    const w = C.ngWordRow(v);
    ok('the pattern shaped like a By word row', w.type === 'word' && w.key === 'w:SP|vinyl' && w.gram === 'vinyl' && w.cps.length === 2 && w.cps.every(c => c.o === 0) && w.protect === '');
    const h = C.ngHarvest(byGram(C, 'SP', 'linen'));
    ok('the harvest pick: lowest ACoS with 3+ orders under target, no exact keyword yet', h.r && h.r.term === 'linen placemats', JSON.stringify(h.why || h.r.term));
    const fl = C.ngHarvest(Object.assign({}, byGram(C, 'SP', 'floral'), { _harv: null }));
    ok('no term qualifies: says why', !fl.r && /no term with 3\+ orders under target yet/.test(fl.why));
    // The dialogs: Search Term Analysis's own.
    C.staOpen('word', w.key, w);
    ok('Negate opens the By word dialog with the plan\'s campaigns', !A.$('stDlg').classList.contains('hide') && /Add negative phrase "vinyl"/.test(A.$('stDlgTitle').textContent)
      && (A.$('stDlgBody').innerHTML.match(/data-cp=/g) || []).length === 2, A.$('stDlgTitle').textContent);
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
    if (!old) ok('commit ' + BEFORE + ' readable with git', false);
    else {
      for (const tail of [false, true]) {
        const was = setup({ stText: old, names: ['ST', 'STS', 'STA_SET_DEF', 'staModel'] });
        account(was.C, { tail });
        const now = page({ tail });
        const a = JSON.stringify(was.C.staModel('ALL').words), z = JSON.stringify(now.C.staModel('ALL').words);
        ok(`By word rows identical before and after${tail ? ' (with the backend\'s tail)' : ''}: ${JSON.parse(z).length} rows`, a === z && JSON.parse(z).length > 0, a === z ? '' : a.slice(0, 300) + ' ≠ ' + z.slice(0, 300));
      }
      const was = setup({ stText: old, names: ['ST', 'STS', 'STA_SET_DEF', 'staModel'] }), now = page({ tail: true });
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
    ok('the chips: All, Waste, Winner, Mixed, Needs data, Protected, with counts', /data-a=""[^>]*>All<span>/.test($('ngActBar').innerHTML) && /Protected<span>\d+<\/span>/.test($('ngActBar').innerHTML));
    ok('the footer says how patterns are counted', /a term counts once for every pattern it holds/.test($('ngFoot').innerHTML));
    ok('the status line', /Data: settled 14 Oct – 12 Nov/.test(strip($('ngMsg').innerHTML)) && /aria-controls="ngMsgP"/.test($('ngMsg').innerHTML));
    C.NGS.size = 2; C.NGS.cls = 'waste';
    C.renderNg();
    ok('2-word, Waste only: "ridhi tablecloth" (protected), no 1-word row, no Winner', /"ridhi tablecloth"/.test($('ngTable').innerHTML) && !/"plastic"/.test($('ngTable').innerHTML) && !/"linen /.test($('ngTable').innerHTML), strip($('ngTable').innerHTML).slice(0, 300));
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
    const rows = C.getNGX().rows.filter(g => g.words === 1);
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
