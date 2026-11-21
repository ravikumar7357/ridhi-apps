/* ================= ADS · N-GRAM ANALYSIS: word patterns across the search terms (21 Nov 2026) =================
 * Screen: N-Gram Analysis (tab 'ngram', pane paneNgram; core/nav.js calls ensureNgram when it opens). Whoever has Search
 * Term Analysis sees it (TAB_INHERIT ngram: 'st'): it reads the same loaded data (staLoad, staModel — the settled window),
 * with no backend call of its own.
 *
 * WHAT IT IS. The 1-, 2- and 3-word sequences of the search terms (Search Term Analysis's pattern index, staGramIndex — the
 * same one its "By word" view reads), summed over the terms that hold them: the patterns that spend without converting across
 * many terms, and the ones that convert within target, with the action each supports. A term counts once per pattern it
 * holds, so the rows do not add up to the account. Left out: ASIN terms (product pages), data-check rows, and terms already
 * blocked by a negative (at Amazon, or a done review item).
 *
 * THE CLASSES (per brand; with Both brands one row per brand and pattern). The numbers are in NG and STA, and in the legend.
 *   Needs data  fewer clicks than the Minimum clicks choice; or 0 orders that could still be chance (the chance of 0 orders
 *               at the brand's order rate is NG.NEG_CHANCE or more), or under NG.NOSALE_MIN_SP spent.
 *   Waste       0 orders, under NG.NEG_CHANCE chance and NG.NOSALE_MIN_SP+ spent; or NG.BE_ORDERS+ orders above the
 *               spend-weighted break-even of its terms; or ACoS over NG.LOSS_ACOS with NG.LOSS_MIN_SP+ spent. A blocked word or
 *               a competitor brand (Lists & settings) is Waste at any spend.
 *   Winner      NG.WIN_ORDERS+ orders at or under the spend-weighted target of its terms.
 *   Mixed       the rest: between target and break-even, or too few orders.
 *   Protected   a badge on any class: brand term, product word, main keyword, seasonal, own or sister ASIN — never negated.
 *   Without unit costs or a target setting for a brand, "above break-even" and Winner are off for it.
 *
 * THE ACTIONS, always through the shared review list and Search Term Analysis's own dialogs and checks:
 *   Waste   "Negate in N campaigns": a campaign-level negative phrase in each campaign where the pattern spent and has no
 *           order there (staOpen('word', …) with the pattern shaped like a By word row; staWordItems). Campaigns where it
 *           sells are kept. A protected pattern gets "Lower bids instead" (its terms in Search Term Analysis).
 *   Winner  "Harvest best term": its term with the lowest ACoS among those with NG.HARVEST_ORDERS+ orders, within target,
 *           without its own exact keyword yet — Search Term Analysis's "Add as exact" dialog for that term.
 *   Mixed / Needs data: a short "Watch" reason.
 * Main functions: ngBuild, ngClassOf, ngRows, ngPlan, ngHarvest, renderNg, ngDraw, ngSubRow, ngQuick, ngCsvLines, ngLegend. */

const NG = {
  MIN_CLICKS: 10,                   // the default "Minimum clicks": fewer is Needs data
  NEG_CHANCE: STA.NEG_CHANCE,       // 0 orders is Waste only under this chance of it by bad luck (1%)
  NOSALE_MIN_SP: STA.NOSALE_MIN_SP, // … and with this much spent ($10)
  BE_ORDERS: STA.BE_ORDERS,         // orders before "above break-even" is Waste (3)
  LOSS_ACOS: STA.LOSS_ACOS,         // ACoS over this is a loss whatever the unit cost (100%) …
  LOSS_MIN_SP: STA.LOSS_MIN_SP,     // … once this much was spent ($20)
  WIN_ORDERS: 2,                    // orders a Winner needs, at or under target
  HARVEST_ORDERS: STA.EXACT_ORDERS, // orders the harvested term needs (3), as "Add as exact" in Search Term Analysis
  CP_MIN_SP: 0.5,                   // a campaign takes part in the plan with this much spend (as By word)
  TERMS_SHOWN: 15,                  // terms listed under an opened pattern
};
const NG_CLS = [['waste', 'Waste', 'bad'], ['winner', 'Winner', 'ok'], ['mixed', 'Mixed', 'warn'], ['need', 'Needs data', ''], ['prot', 'Protected', 'info']];
const NG_CHIP = { waste: 'neg', winner: 'exact', mixed: 'reduce', need: 'hold', prot: 'review' };
const NG_TAGS = { brand: 'Brand term', product: 'Product word', main: 'Main keyword', season: 'Seasonal', own: 'Own product', sister: 'Sister brand',
  blocked: 'Blocked word', comp: 'Competitor brand' };
// The screen's choices: brand, pattern size (0 = all), minimum clicks, classification, filter text, sort, page, rows per
// page, the opened rows, the ticked rows (key → pattern).
let NGS = { size: 1, min: NG.MIN_CLICKS, cls: '', sort: { k: 'sp', d: -1 }, pg: 0, pgSize: 100, open: new Set(), sel: new Map() };
// The patterns of the model drawn last (rebuilt with the model: a new load, the lists, the review list).
let NGX = null;
// The rows of the last draw, every page (the export); the last "Added …" note.
let NG_LAST = [], NG_NOTE = { t: 0, text: '' };

/* ---------- the patterns, once per model ---------- */
// Every pattern of every brand in the model, with its figures over the terms not yet negated (plus the tail), what protects
// it, its yardsticks and its class before the Minimum clicks choice. Cached on the model.
function ngBuild(M) {
  if (NGX && NGX.M === M) return NGX;
  const rows = [];
  M.brands.forEach(b => {
    const idx = (M.grams || {})[b];
    const P = M.protect[b];
    if (!idx || !P) return;
    const info = M.info[b] || {};
    const { typeWords, allTypes } = staBrandTypes(b, M);
    // The yardstick: the brand's order rate over its search terms (an order more than its clicks counts as one per click).
    let bc = 0, bo = 0;
    M.rows.forEach(r => { if (r.brand === b && !r.bad) { bc += r.c || 0; bo += Math.min(r.o || 0, r.c || 0); } });
    const p = bc > 0 && bo > 0 ? bo / bc : null;
    const costsOn = !!(ST.costs || staFb(b));
    idx.forEach(x => {
      const live = x.terms.filter(r => !r.negated);
      if (!live.length && !x.tn) return;
      const g = { key: 'w:' + b + '|' + x.gram, brand: b, gram: x.gram, words: x.words, terms: live, n: live.length + x.tn, tn: x.tn,
        c: x.tc, sp: x.tail, s: x.ts, o: x.to, zsp: x.to > 0 ? 0 : x.tail, conv: 0, cps: new Map(), negN: x.terms.length - live.length, p, info };
      let tw = 0, bw = 0, w = 0;
      live.forEach(r => {
        g.c += r.c; g.sp += r.sp; g.s += r.s; g.o += r.o;
        if (r.o > 0) g.conv++; else g.zsp += r.sp;
        const cp = g.cps.get(r.cid) || g.cps.set(r.cid, { cid: r.cid, cn: r.cn, c: 0, sp: 0, s: 0, o: 0, n: 0 }).get(r.cid);
        cp.c += r.c; cp.sp += r.sp; cp.s += r.s; cp.o += r.o; cp.n++;
        if (r.tgtUse != null && r.beUse != null) { const wt = r.sp + 0.001; w += wt; tw += wt * r.tgtUse; bw += wt * r.beUse; }
      });
      x.tcp.forEach((sp, cid) => {
        const cp = g.cps.get(cid) || g.cps.set(cid, { cid, cn: staName(b, cid), c: 0, sp: 0, s: 0, o: 0, n: 0 }).get(cid);
        cp.sp += sp;
      });
      if (!(g.sp > 0) && !(g.o > 0)) return;
      g.tgt = costsOn && w > 0 ? tw / w : null;
      g.be = costsOn && w > 0 ? bw / w : null;
      g.costsOn = costsOn;
      g.acos = g.s > 0 ? g.sp / g.s * 100 : null;
      g.cvr = g.c > 0 ? g.o / g.c * 100 : null;
      g.chance = p && g.c > 0 ? Math.pow(1 - p, g.c) : p ? 1 : null;
      g.ncp = [...g.cps.values()].filter(c => c.sp > 0 || c.o > 0).length;
      // What protects it, and your own lists.
      const k = staKey(x.gram), wds = x.gram.split(' ');
      const tags = [];
      if (P.isBrand(x.gram)) tags.push('brand');
      if (allTypes.has(k) || wds.every(wd => typeWords.has(staSing(wd)))) tags.push('product');
      if (P.ownKw.has(k) || (P.brandOrders.get(k) || 0) >= STA.MAIN_ORDERS) tags.push('main');
      if (staSeasonOf(x.gram)) tags.push('season');
      if (wds.some(wd => P.own.has(wd))) tags.push('own');
      else if (wds.some(wd => P.sister.has(wd))) tags.push('sister');
      g.tag = P.blocked.includes(x.gram) ? 'blocked' : P.competitors.includes(x.gram) ? 'comp' : '';
      if (g.tag) tags.push(g.tag);
      g.tags = tags;
      g.protect = tags.find(t => t !== 'blocked' && t !== 'comp') || '';
      g.term = g.tag ? (P.rawOf.get(x.gram) || x.gram) : x.gram;
      Object.assign(g, ngClassOf(g));
      g.hay = x.gram;
      rows.push(g);
    });
  });
  return (NGX = { M, rows });
}
// The class before the Minimum clicks choice, and the line saying why: { base, why }.
function ngClassOf(g) {
  const pct = v => (v * 100).toFixed(1) + '%';
  if (g.tag) return { base: 'waste', why: (g.tag === 'blocked' ? 'One of your blocked words' : 'A competitor brand') + ' (Lists & settings): waste at any spend' };
  if (!(g.o > 0)) {
    if (!g.p) return { base: 'need', why: 'Nothing in this brand has sold yet to compare with' };
    if (g.chance >= NG.NEG_CHANCE) return { base: 'need', why: `0 orders in ${staInt(g.c)} clicks could still be chance (${pct(g.chance)} at the brand's ${pct(g.p)}): about ${staInt(staNeed(g.p, g.c, NG.NEG_CHANCE))} more clicks to tell` };
    if (g.sp < NG.NOSALE_MIN_SP) return { base: 'need', why: `0 orders on ${staMoney(g.sp)}: judged from ${staMoney(NG.NOSALE_MIN_SP)} of spend` };
    return { base: 'waste', why: `0 orders in ${staInt(g.c)} clicks: only ${pct(g.chance)} chance of that at the brand's ${pct(g.p)}` };
  }
  if (g.be != null && g.o >= NG.BE_ORDERS && g.acos > g.be) return { base: 'waste', why: `ACoS ${staPct(g.acos)} over break-even ${staPct(g.be)} on ${staInt(g.o)} orders` };
  if (g.acos != null && g.acos > NG.LOSS_ACOS && g.sp >= NG.LOSS_MIN_SP) return { base: 'waste', why: `ACoS ${staPct(g.acos)}: the ads cost more than the sales` };
  if (g.tgt != null && g.o >= NG.WIN_ORDERS && g.acos <= g.tgt) return { base: 'winner', why: `ACoS ${staPct(g.acos)} at or under target ${staPct(g.tgt)} on ${staInt(g.o)} orders` };
  if (!g.costsOn) return { base: 'mixed', why: `${staInt(g.o)} order${g.o === 1 ? '' : 's'} at ACoS ${staPct(g.acos)}: no unit cost or target, so not judged on profit` };
  if (g.tgt == null) return { base: 'mixed', why: `${staInt(g.o)} order${g.o === 1 ? '' : 's'} at ACoS ${staPct(g.acos)}: its products have no unit cost` };
  if (g.o < NG.WIN_ORDERS || (g.acos > g.be && g.o < NG.BE_ORDERS)) return { base: 'mixed', why: `${staInt(g.o)} order${g.o === 1 ? '' : 's'} at ACoS ${staPct(g.acos)}: too few orders to judge` };
  return { base: 'mixed', why: `ACoS ${staPct(g.acos)}: between target ${staPct(g.tgt)} and break-even ${staPct(g.be)}` };
}
// The class with the Minimum clicks choice: fewer clicks is Needs data (a blocked word or competitor brand stays Waste).
const ngCls = (g, min) => (!g.tag && g.c < min ? 'need' : g.base);
function ngWhy(g, min) {
  if (g.tag || g.c >= min) return g.why;
  const more = g.p && !(g.o > 0) ? ` · about ${staInt(staNeed(g.p, g.c, NG.NEG_CHANCE))} more to tell` : '';
  return `${staInt(g.c)} click${g.c === 1 ? '' : 's'}: fewer than ${min}${more}`;
}

/* ---------- what each pattern's action would do ---------- */
const ngOpenRl = f => ST_RL.items.some(x => STA_OPEN_ST.includes(x.status) && f(x));
// The negate plan of a Waste pattern: per campaign where it spent, negate (no order there) or keep (it sells there), and the
// campaigns where it is already negated at Amazon or waiting in the review list. { neg, kept, at, queued }.
function ngPlan(g) {
  if (g._plan) return g._plan;
  const out = { neg: [], kept: [], at: [], queued: [] };
  [...g.cps.values()].filter(c => c.sp >= NG.CP_MIN_SP || c.o > 0).sort((a, z) => z.sp - a.sp).forEach(c => {
    if (c.o > 0) out.kept.push(c);
    else if (staNegAtAmazon(g.brand, 'cp|' + c.cid, g.gram, 'np') === true) out.at.push(c);
    else if (ngOpenRl(x => x.kind === 'neg' && x.brand === g.brand && staNorm(x.term) === g.gram && x.cid === c.cid)) out.queued.push(c);
    else out.neg.push(c);
  });
  return (g._plan = out);
}
// The term a Winner harvests: the lowest ACoS among its terms with NG.HARVEST_ORDERS+ orders, within target, with no exact
// keyword of its own yet. { r } or { why }.
function ngHarvest(g) {
  if (g._harv) return g._harv;
  const sel = g.terms.filter(r => r.o >= NG.HARVEST_ORDERS && r.acos != null && r.tgtUse != null && r.acos <= r.tgtUse);
  const ok = sel.filter(r => !r.own && !r.exactElsewhere.length && !r.ptElsewhere.length && r.status !== 'In review'
    && !ngOpenRl(x => (x.kind === 'exact' || x.kind === 'asinT') && x.key === r.key)
    && r.term.trim().split(/\s+/).length <= STA.KW.words && r.term.length <= STA.KW.chars);
  ok.sort((a, z) => a.acos - z.acos || z.o - a.o);
  return (g._harv = ok.length ? { r: ok[0] }
    : { why: sel.length ? 'its best terms already have their own exact keyword, or are in the review list' : `no term with ${NG.HARVEST_ORDERS}+ orders under target yet` });
}
// A harvested term as the "Add as exact" dialog takes it: its bid rule (CPC + 20%, under the ceiling) when the model did not
// set one (it does only for terms it lists as worth scaling).
function ngHarvestRow(r) {
  if (r.sugBid > 0 && r.ceil > 0) return r;
  const ceil = r.cpc > 0 && r.acos > 0 ? Math.min(r.cpc * r.tgtUse / r.acos, r.cpc * 2) : r.cpc || STA.MIN_BID;
  return Object.assign({}, r, { ceil, sugBid: Math.max(STA.MIN_BID, staR2(Math.min((r.cpc || STA.MIN_BID) * (1 + STA.STEP), ceil))) });
}
// A pattern shaped like a By word row, so Search Term Analysis's dialog and item builders take it unchanged; cps = the
// campaigns of the plan where it is negated.
function ngWordRow(g) {
  const plan = ngPlan(g);
  return { key: g.key, type: 'word', brand: g.brand, term: g.term, gram: g.gram, words: g.words, n: g.n, c: g.c, sp: g.sp, o: g.o, s: g.s, zsp: g.zsp,
    tail: g.sp - g.terms.reduce((t, r) => t + r.sp, 0), terms: g.terms.slice().sort((a, z) => z.sp - a.sp).slice(0, 8).map(r => r.term),
    cps: plan.neg.map(c => ({ cid: c.cid, cn: c.cn, sp: c.sp, s: c.s, o: c.o, n: c.n })), tag: g.tag === 'comp' ? 'competitor' : g.tag, protect: g.protect ? NG_TAGS[g.protect].toLowerCase() : '',
    cat: 'burn', kind: 'word', burned: g.zsp, stake: g.zsp, hay: g.gram };
}
// The next step of a pattern under the Minimum clicks choice: { act: 'neg' | 'harvest' | 'low' | '', text, n, r }.
function ngNext(g, min) {
  const cls = ngCls(g, min);
  if (g.info.stale) return { act: '', text: g.info.stale + ': no suggestions' };
  if (cls === 'waste') {
    if (g.protect) return { act: 'low', text: `${NG_TAGS[g.protect]}: never negated — a lower bid on its terms instead` };
    if (!g.info.settled) return { act: '', text: 'Negatives wait for the settled report (this is the 30-day one: its last 7 days\' sales are not all in)' };
    if (g.words > STA.NEG.negativePhrase.words) return { act: '', text: `A negative phrase takes ${STA.NEG.negativePhrase.words} words at most` };
    const P = ngPlan(g);
    if (!P.neg.length) return { act: '', text: P.kept.length && !P.at.length && !P.queued.length ? 'It sells in every campaign it spent in: nothing to negate'
      : P.queued.length ? 'Already in the review list where it does not sell' : 'Already negated at Amazon where it does not sell' };
    const left = STA.DAY_MAX - staDayCount(g.brand);
    if (left <= 0) return { act: '', text: `The day's limit of ${STA.DAY_MAX} negatives for ${staBrandName(g.brand)} is reached` };
    return { act: 'neg', n: P.neg.length, text: `Negative phrase · campaign level · ${staInt(P.neg.length)} campaign${P.neg.length === 1 ? '' : 's'}`
      + (P.kept.length ? ` · kept in ${staInt(P.kept.length)} where it sells` : '') };
  }
  if (cls === 'winner') {
    const h = ngHarvest(g);
    if (!h.r) return { act: '', text: 'Watch: ' + h.why };
    return { act: 'harvest', r: h.r, text: `"${h.r.term}" as an exact keyword: ${staInt(h.r.o)} orders at ${staPct(h.r.acos)}` };
  }
  return { act: '', text: 'Watch: ' + ngWhy(g, min) };
}

/* ---------- the rows on screen ---------- */
function ngFilters() {
  return { brand: $('ngBrand').value || 'ALL', q: staLow($('ngFilter').value), size: NGS.size, min: NGS.min, cls: NGS.cls };
}
// The patterns that pass brand, size, filter text (the pattern, or any of its terms, campaigns and ad groups) — before the
// classification, which the boxes and chips count.
function ngRows(X, f) {
  return X.rows.filter(g => (f.brand === 'ALL' || g.brand === f.brand) && (!f.size || g.words === f.size)
    && (!f.q || g.hay.includes(f.q) || g.terms.some(r => r.hay.includes(f.q))));
}
const ngClsPass = (g, cls, min) => !cls || (cls === 'prot' ? !!g.protect : ngCls(g, min) === cls);
const NG_SORTS = { term: g => g.gram, n: g => g.n, c: g => g.c, sp: g => g.sp, s: g => g.s, o: g => g.o, acos: g => (g.acos == null ? -1 : g.acos),
  cvr: g => (g.cvr == null ? -1 : g.cvr), ncp: g => g.ncp, conv: g => g.conv };
function ngSorted(rows) {
  const f = NG_SORTS[NGS.sort.k] || NG_SORTS.sp, d = NGS.sort.d;
  return rows.slice().sort((a, z) => { const x = f(a), y = f(z); return (x < y ? -1 : x > y ? 1 : 0) * d || z.sp - a.sp; });
}

/* ---------- drawing ---------- */
async function ensureNgram() {
  if (!ST.loaded || !ST.extra) {
    ngStatusLoading();
    $('ngTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">Loading the search terms…</td></tr></tbody>';
    $('ngBoxes').innerHTML = '';
    $('ngFoot').innerHTML = '';
  }
  try { await staLoad(); } catch (e) { /* drawn below as "not loaded" */ }
  renderNg();
}
function ngStatusLoading() {
  staStatus('ngMsg', { summary: 'Loading the search terms, targets and lists…', notes: 0, block: false, html: '<span>N-Gram Analysis reads the same data as Search Term Analysis: no extra call to Amazon.</span>' });
}
// After a change made anywhere (the review list, the lists): drawn again when on screen.
function ngAfterChange() {
  if ($('paneNgram') && !$('paneNgram').classList.contains('hide')) renderNg();
}
// "Added … · Undo" from Search Term Analysis's dialog, when the change was made here.
function ngAdded(text) {
  if (!$('paneNgram') || $('paneNgram').classList.contains('hide')) return;
  NG_NOTE = { t: Date.now(), text };
  renderNg();
}
function renderNg() {
  if (!$('paneNgram') || $('paneNgram').classList.contains('hide')) return;
  ngRlBadge();
  $('ngSize').querySelectorAll('[data-n]').forEach(x => { const on = Number(x.dataset.n) === NGS.size; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  $('ngClass').value = NGS.cls;
  const haveAny = ['SP', 'CPC'].some(b => ((ST.terms[b] || {}).rows || []).length || (ST.set && ST.set.d && ST.set.d[b]));
  if (!ST.loaded || !haveAny) {
    staStatus('ngMsg', { summary: ST.loaded ? '<span class="sta-bad">✗ No search terms yet</span>' : '<span class="sta-bad">✗ The search terms are not loaded</span>', notes: 1, block: true,
      html: `<span>${ST.loaded ? 'The nightly run has not collected any search-term data yet, or the last one came back empty. Patterns show once it does.'
        : 'Search Term Analysis\'s data could not be read. Open Search Term Analysis to see why, or try again later.'}</span><span>${staSrcLine()}</span>` });
    ['ngBoxes', 'ngActBar'].forEach(id => { $(id).innerHTML = ''; });
    $('ngSub').textContent = '';
    $('ngTable').innerHTML = `<tbody><tr><td class="muted" style="padding:14px">${ST.loaded ? 'No search terms yet.' : 'The search terms are not loaded yet.'}</td></tr></tbody>`;
    $('ngFoot').innerHTML = '';
    ngSelBar();
    return;
  }
  const M = staModel('ALL');
  const X = ngBuild(M);
  const f = ngFilters();
  ngDataLine(M, f.brand === 'ALL' ? M.brands : [f.brand]);
  const base = ngRows(X, f);
  const cnt = { waste: [], winner: [], mixed: [], need: [], prot: [] };
  base.forEach(g => { cnt[ngCls(g, f.min)].push(g); if (g.protect) cnt.prot.push(g); });
  ngBoxes(cnt, f);
  ngChips(cnt, base.length);
  const rows = ngSorted(f.cls ? (f.cls === 'prot' ? cnt.prot : cnt[f.cls]) : base);
  NG_LAST = rows;
  ngDraw(rows, f, M);
}
// The status dropdown: the window, the brands, unit costs and targets, Amazon's data.
function ngDataLine(M, brands) {
  const lines = [];
  const add = (h, lv) => lines.push([h, lv || '']);
  add(M.settled ? 'Patterns over <b>settled clicks</b>, with 7-day sales as in the Ads console — the same window as Search Term Analysis.'
    : 'Patterns over <b>the last 30 days</b> (the settled report is missing): negatives wait for it, as in Search Term Analysis.', M.settled ? '' : 'warn');
  const stale = brands.filter(b => (M.info[b] || {}).stale);
  stale.forEach(b => add(`<span class="sta-bad">✗ ${staBrandName(b)}: ${staEsc(M.info[b].stale)} — no suggestions for it</span>`, 'bad'));
  const ok = brands.filter(b => !(M.info[b] || {}).stale);
  if (ok.length) add(`<span class="sta-ok">✓ ${ok.map(staBrandName).join(' and ')}${ok.length > 1 ? ' both' : ''} complete</span>`);
  const cost = staCostLine(brands);
  if (cost) add(cost[0], cost[1]);
  const off = brands.filter(b => !(ST.costs || staFb(b)));
  if (off.length) add(`<span class="sta-bad">${off.map(staBrandName).join(' and ')}: no unit cost or target ACoS, so "above break-even" and Winner are off — only patterns with no orders, over ${NG.LOSS_ACOS}% ACoS, and your blocked words and competitor brands are judged</span>`, 'warn');
  const neg = M.rows.filter(r => r.negated && brands.includes(r.brand)).length;
  if (neg) add(`<span class="sta-dash">${staInt(neg)} search term${neg === 1 ? '' : 's'} already blocked by a negative ${neg === 1 ? 'is' : 'are'} left out</span>`);
  const src = staSrcState();
  if (src.html) add(src.html, src.block ? 'bad' : src.notes ? 'warn' : '');
  if (ST_RL.where === 'local' || STS.where === 'local') add('<span class="sta-bad">The review list and the lists are kept in this browser only until they are switched on for everyone</span>', 'warn');
  const sum = ['Data: ' + staEsc(staWindowTxt(M))];
  if (stale.length) sum.push(`<span class="sta-bad">✗ ${stale.map(staBrandName).join(' and ')}: no suggestions</span>`);
  else sum.push(`<span class="sta-ok">✓ ${brands.length > 1 ? 'both brands' : staBrandName(brands[0])} complete</span>`);
  if (src.block) sum.push('<span class="sta-bad">✗ Amazon data could not be read</span>');
  staStatus('ngMsg', { summary: sum.join(' · '), notes: lines.filter(l => l[1]).length + Math.max(0, src.notes - 1), block: stale.length > 0 || src.block,
    html: lines.map(l => `<span>${l[0]}</span>`).join('') });
}
// The four boxes (Search Term Analysis's look); a click sets the classification.
function ngBoxes(cnt, f) {
  const IC = {
    waste: '<path d="M12 2c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-6 1.5 1 2 2.5 2 4 1-1 1.5-4 1-8Z"/>',
    winner: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    mixed: '<path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>',
    need: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  const terms = list => { const s = new Set(); list.forEach(g => g.terms.forEach(r => s.add(r))); return s.size + list.reduce((t, g) => t + (g.tn || 0), 0); };
  const sum = (list, k) => list.reduce((t, g) => t + (g[k] || 0), 0);
  const box = (k, c, label, big, unit, q, go) => `
    <button type="button" class="adx-box sta-box${NGS.cls === k ? ' on' : ''}" data-box="${k}" style="--c:${c};--adx-glow:.10" aria-pressed="${NGS.cls === k}" aria-label="${staEsc(label + ': ' + big + ' ' + unit + '. ' + go)}">
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg></span>${label}</div>
      <div class="sta-big"><b>${big}</b><span>${unit}</span></div>
      <div class="sta-q">${q}</div>
      <div class="sta-go"><span>${go} →</span></div>
    </button>`;
  const w = cnt.waste, wi = cnt.winner;
  $('ngBoxes').innerHTML =
    box('waste', 'var(--bad)', 'Waste patterns', staInt(w.length), 'patterns', `${staMoney0(sum(w, 'sp'))} spend in ${staInt(terms(w))} terms.`, 'Negate where they don\'t sell')
    + box('winner', 'var(--accent)', 'Winner patterns', staInt(wi.length), 'patterns', `${staMoney0(sum(wi, 's'))} sales in ${staInt(terms(wi))} terms.`, 'Harvest the best term')
    + box('mixed', 'var(--rev)', 'Mixed', staInt(cnt.mixed.length), 'patterns', 'Between target and break-even, or few orders.', 'Watch')
    + box('need', 'var(--brand)', 'Needs data', staInt(cnt.need.length), 'patterns', `Fewer than ${staInt(f.min)} clicks, or not conclusive yet.`, 'Wait for more clicks');
}
// The classification chips, like Search Term Analysis's next-step chips.
function ngChips(cnt, all) {
  const chip = (k, t, c) => `<button type="button" class="sta-chip${NGS.cls === k ? ' on' : ''}${k ? ' a-' + NG_CHIP[k] : ''}" data-a="${k}" aria-pressed="${NGS.cls === k}">${t}<span>${staInt(c)}</span></button>`;
  $('ngActBar').innerHTML = '<span class="sta-actl">Classification</span>' + chip('', 'All', all) + NG_CLS.map(([k, t]) => chip(k, t, cnt[k].length)).join('')
    + `<label class="sta-pgsz ng-rows">Rows <select id="ngPgSize" aria-label="Rows per page">${[50, 100, 250].map(n => `<option${n === NGS.pgSize ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
}
function ngRlBadge() {
  const n = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved').length;
  $('ngRlN').textContent = n;
  $('ngRlN').classList.toggle('hide', !n);
}
const ngClsBadge = (g, min) => { const k = ngCls(g, min), c = NG_CLS.find(x => x[0] === k); return staBadge(c[1], c[2]); };
// The table: one row per pattern, with a caret that opens its terms and what the action does.
function ngDraw(rows, f, M) {
  const pages = Math.max(1, Math.ceil(rows.length / NGS.pgSize));
  if (NGS.pg >= pages) NGS.pg = pages - 1;
  const page = rows.slice(NGS.pg * NGS.pgSize, (NGS.pg + 1) * NGS.pgSize);
  const sizeTxt = f.size ? `${f.size}-word` : '1-, 2- and 3-word';
  $('ngSub').innerHTML = `${staInt(rows.length)} ${sizeTxt} pattern${rows.length === 1 ? '' : 's'}${f.cls ? ' · ' + NG_CLS.find(x => x[0] === f.cls)[1].toLowerCase() : ''} · ${staEsc(staWindowTxt(M))}. `
    + 'Each search term counts once for every pattern it holds.';
  const S = NGS.sort, th = (t, k, tip) => staTh(t, k, 1, tip, S);
  const COLS = 12;
  const body = page.map(g => {
    const nx = ngNext(g, f.min), open = NGS.open.has(g.key), can = nx.act === 'neg' || nx.act === 'harvest';
    if (!can) NGS.sel.delete(g.key);
    const tick = can ? `<input type="checkbox" class="sta-cb" data-ngsel="${staEsc(g.key)}"${NGS.sel.has(g.key) ? ' checked' : ''} aria-label="Select ${staEsc(g.gram)}">` : '<span class="sta-cbgap"></span>';
    const caret = `<button type="button" class="sta-caret" data-ngopen="${staEsc(g.key)}" aria-expanded="${open}" aria-controls="ngS-${staEsc(g.key)}" aria-label="${open ? 'Hide' : 'Show'} the terms behind ${staEsc(g.gram)}">${open ? '▾' : '▸'}</button>`;
    const tags = g.tags.map(t => staBadge(NG_TAGS[t], t === 'blocked' || t === 'comp' || t === 'season' ? 'warn' : 'info')).join('');
    const btn = nx.act === 'neg' ? `<button type="button" class="sta-btn neg sm" data-ngact="neg" data-k="${staEsc(g.key)}" title="A campaign-level negative phrase in each campaign where it has no order, after the usual checks">Negate in ${staInt(nx.n)} campaign${nx.n === 1 ? '' : 's'}</button>`
      : nx.act === 'harvest' ? `<button type="button" class="sta-btn sm" data-ngact="harvest" data-k="${staEsc(g.key)}" title="Search Term Analysis's Add as exact dialog for this term">Harvest best term</button>`
        : nx.act === 'low' ? `<button type="button" class="sta-btn dim sm" data-ngact="low" data-k="${staEsc(g.key)}" title="Its search terms in Search Term Analysis, where a lower bid can be set">Lower bids instead</button>` : '';
    const nextCell = nx.act ? `<td class="sta-next"><small>${staEsc(nx.text)}</small>${btn}</td>` : `<td class="sta-next"><span class="sta-hold">${staEsc(nx.text)}</span></td>`;
    const row = `<tr${NGS.sel.has(g.key) ? ' class="sel"' : ''}>
      <td class="sta-stick">${tick}<div class="sta-tc"><div class="sta-term">${caret}"${staEsc(g.term)}"</div>
        <div class="sta-under">${f.brand === 'ALL' ? staBadge(staBrandName(g.brand), 'brand-' + g.brand) : ''}${tags}</div></div></td>
      <td class="sta-ev sta-ev-s">${ngClsBadge(g, f.min)}${g.protect && ngCls(g, f.min) !== 'prot' ? staBadge('Protected', 'info', NG_TAGS[g.protect] + ': never negated') : ''}<div class="sta-why">${staEsc(ngWhy(g, f.min))}</div></td>
      <td class="num">${staInt(g.n)}</td><td class="num">${staInt(g.c)}</td><td class="num">${staMoney(g.sp)}</td><td class="num">${staMoney(g.s)}</td>
      <td class="num">${staInt(g.o)}</td><td class="num"><b>${g.acos != null ? staPct(g.acos) : staDash}</b></td><td class="num">${g.cvr != null ? staPct(g.cvr) : staDash}</td>
      <td class="num">${staInt(g.ncp)}</td><td class="num">${staInt(g.conv)}</td>${nextCell}</tr>`;
    return open ? row + ngSubRow(g, f, nx, COLS) : row;
  }).join('');
  const tickable = page.filter(g => { const a = ngNext(g, f.min).act; return a === 'neg' || a === 'harvest'; });
  const allOn = tickable.length && tickable.every(g => NGS.sel.has(g.key));
  const tickAll = tickable.length ? `<input type="checkbox" class="sta-cb" data-ngselall="1"${allOn ? ' checked' : ''} aria-label="Select every pattern with an action on this page">` : '';
  $('ngTable').innerHTML = `<thead><tr><th class="sta-stick sta-sort${S.k === 'term' ? ' on' : ''}" data-sort="term" title="Sort by pattern">${tickAll} N-gram${S.k === 'term' ? (S.d > 0 ? ' ▲' : ' ▼') : ''}</th><th>Classification</th>`
    + th('Search terms', 'n', 'Search terms holding the pattern (each term counts once for every pattern it holds)') + th('Clicks', 'c') + th('Ad spend', 'sp') + th('Ad sales', 's')
    + th('Orders', 'o') + th('ACoS', 'acos') + th('CVR', 'cvr', 'Orders ÷ clicks') + th('Campaigns', 'ncp', 'Campaigns it spent in') + th('Converting terms', 'conv', 'Its search terms with at least one order')
    + '<th>Next step</th></tr></thead><tbody>'
    + (body || `<tr><td colspan="${COLS}" class="muted" style="padding:14px">${NGX.rows.length ? 'Nothing matches these filters.' : 'No word pattern in these search terms yet.'}</td></tr>`) + '</tbody>';
  staPager(rows.length, 'patterns', 'a term counts once for every pattern it holds, so the rows do not add up to the account', { pg: NGS.pg, size: NGS.pgSize, foot: ngFoot });
  ngSelBar();
}
// The footer, with the last "Added …" note for 30 seconds.
function ngFoot(html) {
  const note = Date.now() - NG_NOTE.t < 30000 ? `<span class="sta-added">${NG_NOTE.text} <button type="button" class="sta-linkbtn" data-ngundo="1">Undo</button> · <button type="button" class="sta-linkbtn" data-ngrl="1">Open the list</button></span>` : '';
  $('ngFoot').innerHTML = note + html;
  $('ngFoot').classList.remove('err');
}
// Under an opened pattern: the terms behind it (left) and what its action does (right).
function ngSubRow(g, f, nx, cols) {
  const top = g.terms.slice().sort((a, z) => z.sp - a.sp).slice(0, NG.TERMS_SHOWN);
  const more = g.terms.length - top.length;
  const tr = top.map(r => `<tr><td><span class="sta-term">${staEsc(r.term)}</span></td><td class="ng-cp" title="${staEsc(r.cn + (r.agn ? ' · ' + r.agn : ''))}">${staEsc(r.cn)}</td>
      <td class="num">${staInt(r.c)}</td><td class="num">${staMoney(r.sp)}</td><td class="num">${staInt(r.o)}</td><td class="num">${r.acos != null ? staPct(r.acos) : staDash}</td>
      <td>${(r.badges || [])[0] ? staBadge(r.badges[0][0], r.badges[0][1], r.badges[0][2]) : ''}</td>
      <td><button type="button" class="sta-btn dim sm" data-ngterm="${staEsc(r.key)}">Open in Search Term Analysis</button></td></tr>`).join('');
  const left = `<div class="ng-col"><h5 class="sta-actl">Terms behind it</h5><table class="xl ng-mini"><thead><tr><th>Search term</th><th>Campaign</th><th class="num">Clicks</th><th class="num">Spend</th><th class="num">Orders</th><th class="num">ACoS</th><th>Verdict</th><th></th></tr></thead>`
    + `<tbody>${tr || '<tr><td colspan="8" class="muted">Only terms too small to list one by one.</td></tr>'}</tbody></table>`
    + `<small class="sta-s ng-more">${more > 0 ? `${staInt(more)} more term${more === 1 ? '' : 's'} · ` : ''}${g.tn ? `${staInt(g.tn)} small term${g.tn === 1 ? '' : 's'} not listed one by one (${staMoney(g.sp - g.terms.reduce((t, r) => t + r.sp, 0))})` : ''}${g.negN ? `${g.tn ? ' · ' : ''}${staInt(g.negN)} already negated, left out` : ''}</small></div>`;
  let right = '';
  if (nx.act === 'neg') {
    const P = ngPlan(g);
    const li = (c, t, cls) => `<li class="${cls}"><b>${staEsc(c.cn || 'Campaign ' + c.cid)}</b> <span class="sta-dash">${staMoney(c.sp)}${c.o ? ` · ${staInt(c.o)} order${c.o === 1 ? '' : 's'}, ${staMoney(c.s)}` : ''}</span><em>${t}</em></li>`;
    right = `<p>A negative phrase "${staEsc(g.term)}" at campaign level, in each campaign where it has no order:</p><ul class="ng-plan">`
      + P.neg.map(c => li(c, 'Negate here', 'is-neg')).join('') + P.kept.map(c => li(c, 'Kept: sells here', 'is-kept')).join('')
      + P.at.map(c => li(c, 'Already negated at Amazon', '')).join('') + P.queued.map(c => li(c, 'In the review list', '')).join('') + '</ul>'
      + `<p class="sta-s">Sales at risk: none — it has no order in those campaigns. Negatives left today for ${staBrandName(g.brand)}: ${staInt(Math.max(0, STA.DAY_MAX - staDayCount(g.brand)))} of ${STA.DAY_MAX}. The dialog runs the usual checks before anything is added.</p>`;
  } else if (nx.act === 'harvest') {
    const r = ngHarvestRow(nx.r);
    const c = staDestinations(r, false)[0];
    right = `<p>Adds <b>"${staEsc(r.term)}"</b> as its own exact keyword${c ? ` in <b>${staEsc(c.cn)}</b> · ${staEsc(c.agn)}` : ''} at about <b>${staMoney(r.sugBid)}</b> (CPC ${staMoney(r.cpc)} +${Math.round(STA.STEP * 100)}%, under the ceiling ${staMoney(r.ceil)}).</p>`
      + `<p class="sta-s">${staInt(r.o)} orders at ${staPct(r.acos)} ACoS through ${staEsc(staPathLabel(r.kw, r.mt))}, target ${staPct(r.tgtUse)}.${c ? '' : ' No manual keyword ad group advertises its product yet: the dialog says so.'} Once the new keyword takes the term, Competing paths suggests the negative on the old path.</p>`;
  } else if (nx.act === 'low') {
    right = `<p>${staEsc(nx.text)}.</p><p class="sta-s">"Lower bids instead" opens its search terms in Search Term Analysis, where each keyword's bid can be lowered with the usual checks.</p>`;
  } else right = `<p>Nothing to change yet.</p><p class="sta-s">${staEsc(nx.text)}</p>`;
  return `<tr class="ng-sub" id="ngS-${staEsc(g.key)}"><td colspan="${cols}"><div class="ng-split">${left}<div class="ng-col"><h5 class="sta-actl">What the action does</h5>${right}</div></div></td></tr>`;
}

/* ---------- actions ---------- */
const ngOf = key => (NGX ? NGX.rows.find(g => g.key === key) : null);
// One pattern's default change for the selection bar, after the same checks as the dialogs: { items } or { skip }.
function ngQuick(g, dayUsed) {
  const nx = ngNext(g, NGS.min);
  if (nx.act === 'neg') {
    const items = staWordItems(ngWordRow(g), ngWordRow(g).cps);
    if (!items.length) return { skip: 'already negated or in the review list' };
    if (staDayCount(g.brand) + (dayUsed[g.brand] || 0) + items.length > STA.DAY_MAX) return { skip: `the day's limit of ${STA.DAY_MAX} negatives` };
    dayUsed[g.brand] = (dayUsed[g.brand] || 0) + items.length;
    return { items };
  }
  if (nx.act === 'harvest') {
    const r = ngHarvestRow(nx.r);
    const c = staDestinations(r, false)[0];
    if (!c) return { skip: 'no manual keyword ad group advertises its product' };
    if (ngOpenRl(x => x.kind === 'exact' && x.key === r.key)) return { skip: 'already in the review list' };
    return { items: [staExactItem(r, 'exact', c, r.sugBid)] };
  }
  return { skip: 'no change' };
}
function ngSelBar() {
  const rows = [...NGS.sel.values()];
  $('ngSelBar').classList.toggle('hide', !rows.length);
  if (!rows.length) return;
  $('ngSelTxt').innerHTML = `<b>${staInt(rows.length)} selected</b> · ${staMoney(rows.reduce((t, g) => t + g.sp, 0))} ad spend`;
  $('ngSelAdd').textContent = `Add ${rows.length} to the review list`;
}
// Search Term Analysis on a pattern's terms (Lower bids instead) or on one term.
function ngToSt(brand, text) {
  ST_VIEW = 'all';
  ST_SUB = 'term';
  ST_PG = 0;
  ST_ACT = '';
  ST_SORT = { k: '', d: -1 };
  if ([...$('stBrand').options].some(o => o.value === brand)) $('stBrand').value = brand;
  $('stFilter').value = text;
  STM = null;
  showTab('st');
}

/* ---------- export ---------- */
const NG_CSV_COLS = ['Brand', 'N-gram', 'Words', 'Classification', 'Protected', 'Tags', 'Search terms', 'Clicks', 'Ad spend', 'Ad sales', 'Orders', 'ACoS %', 'CVR %',
  'Campaigns', 'Converting terms', 'Spend with no order', 'Target ACoS %', 'Break-even ACoS %', 'Next step', 'Why'];
function ngCsvLines(rows, min) {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const r1 = v => (v == null ? '' : Math.round(v * 10) / 10);
  return [NG_CSV_COLS.map(cell).join(',')].concat(rows.map(g => {
    const nx = ngNext(g, min);
    return [staBrandName(g.brand), g.term, g.words, NG_CLS.find(x => x[0] === ngCls(g, min))[1], g.protect ? NG_TAGS[g.protect] : '', g.tags.map(t => NG_TAGS[t]).join('; '),
      g.n, g.c, staR2(g.sp), staR2(g.s), g.o, r1(g.acos), r1(g.cvr), g.ncp, g.conv, staR2(g.zsp), r1(g.tgt), r1(g.be),
      nx.act === 'neg' ? `Negate in ${nx.n} campaigns` : nx.act === 'harvest' ? `Harvest "${nx.r.term}"` : nx.act === 'low' ? 'Lower bids instead' : '', nx.act ? nx.text : ngWhy(g, min)].map(cell).join(',');
  }));
}
function ngCsv() {
  if (!NG_LAST.length) { $('ngFoot').innerHTML = '<span>Nothing to export.</span>'; $('ngFoot').classList.add('err'); return; }
  const blob = new Blob(['﻿' + ngCsvLines(NG_LAST, NGS.min).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `n-gram-analysis-${NGS.size ? NGS.size + '-word' : 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- the legend ---------- */
function ngLegend() {
  const L = (h, items) => `<h4>${h}</h4><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  $('ngLegendBody').innerHTML = '<div class="sta-legcols"><div>'
    + L('How patterns are counted', [
      'Each search term splits into its 1-, 2- and 3-word sequences. A term counts once for every pattern it holds, so one term counts toward several patterns and the rows do not add up to the account.',
      'One-word patterns skip small words (a, the, for, set, inch…), words under 3 letters and numbers.',
      'Left out: ASIN searches (product pages), rows set aside as a data check, and search terms already blocked by a negative — at Amazon, or a review item that has been done.',
      'Terms too small to be listed one by one (under 3 clicks, no order) are added as the backend keeps them, by word.',
      'The window is Search Term Analysis\'s: settled clicks with 7-day sales when the settled report is there.'])
    + L('Classification', [
      `<b>Needs data</b>: fewer clicks than the Minimum clicks choice; or 0 orders that could still be chance — ${Math.round(NG.NEG_CHANCE * 100)}% or more at the brand's order rate over its search terms — or under ${staMoney(NG.NOSALE_MIN_SP)} spent. Shows about how many more clicks would tell.`,
      `<b>Waste</b>: 0 orders with under ${Math.round(NG.NEG_CHANCE * 100)}% chance of that and ${staMoney(NG.NOSALE_MIN_SP)}+ spent; or ${NG.BE_ORDERS}+ orders above the break-even of its terms (weighted by their spend); or ACoS over ${NG.LOSS_ACOS}% with ${staMoney(NG.LOSS_MIN_SP)}+ spent, a loss even without unit costs. Your blocked words and competitor brands (Lists & settings) are Waste at any spend.`,
      `<b>Winner</b>: ${NG.WIN_ORDERS}+ orders at or under the target of its terms (weighted by their spend).`,
      '<b>Mixed</b>: the rest — between target and break-even, or too few orders.',
      'Without unit costs or a target ACoS for a brand, "above break-even" and Winner are off for it; set a target in Lists & settings to switch them on.'])
    + '</div><div>'
    + L('Protected — never negated', [
      '<b>Brand terms</b>, the brand\'s <b>product words</b> (what its ad groups sell, and your list), <b>main keywords</b> (your own keywords, or ' + STA.MAIN_ORDERS + '+ orders across the brand), <b>seasonal</b> words, and your own and sister-brand ASINs — the same lists and checks as Search Term Analysis.',
      'A protected Waste pattern gets no negative: "Lower bids instead" opens its terms in Search Term Analysis.'])
    + L('What the actions do', [
      `<b>Negate in N campaigns</b> (Waste): one negative phrase at campaign level in each campaign where the pattern spent and has no order there; campaigns where it sells are kept. Search Term Analysis's own dialog: sales at risk, already negated at Amazon, already in the review list, at most ${STA.NEG.negativePhrase.words} words, and the day's limit of ${STA.DAY_MAX} negatives per brand.`,
      `<b>Harvest best term</b> (Winner): the term with the lowest ACoS among those with ${NG.HARVEST_ORDERS}+ orders, within its target and without its own exact keyword yet — Search Term Analysis's "Add as exact" dialog (CPC +${Math.round(STA.STEP * 100)}%, under the ceiling; a manual keyword ad group of the same product).`,
      '<b>Mixed</b> and <b>Needs data</b>: watched, no change.',
      'Every change goes to the shared review list: approve it, then download the bulk file (or Apply, when it is switched on).'])
    + '</div></div>';
}

/* ---------- events ---------- */
const ngRe = () => { NGS.pg = 0; renderNg(); };
let NG_FT = 0;
$('ngFilter').addEventListener('input', () => { clearTimeout(NG_FT); NG_FT = setTimeout(ngRe, 200); });
$('ngBrand').addEventListener('change', () => { NGS.sel.clear(); ngRe(); });
$('ngMin').addEventListener('change', () => { NGS.min = Number($('ngMin').value) || NG.MIN_CLICKS; ngRe(); });
$('ngClass').addEventListener('change', () => { NGS.cls = $('ngClass').value; ngRe(); });
$('ngSize').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  NGS.size = Number(b.dataset.n) || 0;
  ngRe();
});
$('ngBoxes').addEventListener('click', e => {
  const b = e.target.closest('[data-box]');
  if (!b) return;
  NGS.cls = NGS.cls === b.dataset.box ? '' : b.dataset.box;
  ngRe();
});
$('ngActBar').addEventListener('click', e => {
  const c = e.target.closest('[data-a]');
  if (!c) return;
  NGS.cls = NGS.cls === c.dataset.a ? '' : c.dataset.a;
  ngRe();
});
$('ngActBar').addEventListener('change', e => {
  if (e.target.id !== 'ngPgSize') return;
  NGS.pgSize = Number(e.target.value) || 100;
  try { localStorage.setItem('ngSize', String(NGS.pgSize)); } catch (x) { /* no storage */ }
  ngRe();
});
try { const z = Number(localStorage.getItem('ngSize')); if ([50, 100, 250].includes(z)) NGS.pgSize = z; } catch (e) { /* no storage */ }
$('ngTable').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (th && !e.target.closest('input')) {
    const k = th.dataset.sort;
    NGS.sort = NGS.sort.k === k ? { k, d: -NGS.sort.d } : { k, d: k === 'term' ? 1 : -1 };
    ngRe();
    return;
  }
  const op = e.target.closest('[data-ngopen]');
  if (op) {
    const k = op.dataset.ngopen;
    if (NGS.open.has(k)) NGS.open.delete(k); else NGS.open.add(k);
    renderNg();
    const again = $('ngTable').querySelector(`[data-ngopen="${CSS.escape(k)}"]`);
    if (again) again.focus();
    return;
  }
  const act = e.target.closest('button[data-ngact]');
  if (act) {
    const g = ngOf(act.dataset.k);
    if (!g) return;
    const nx = ngNext(g, NGS.min);
    if (act.dataset.ngact === 'neg' && nx.act === 'neg') staOpen('word', g.key, ngWordRow(g));
    else if (act.dataset.ngact === 'harvest' && nx.act === 'harvest') staOpen('exact', nx.r.key, ngHarvestRow(nx.r));
    else if (act.dataset.ngact === 'low') ngToSt(g.brand, g.gram);
    return;
  }
  const term = e.target.closest('button[data-ngterm]');
  if (term) {
    const r = NGX && NGX.M.byKey.get(term.dataset.ngterm);
    if (r) ngToSt(r.brand, r.term);
  }
});
$('ngTable').addEventListener('change', e => {
  const cb = e.target.closest('input[data-ngsel],input[data-ngselall]');
  if (!cb) return;
  const pick = (k, on) => { const g = ngOf(k); if (!g) return; if (on) NGS.sel.set(k, g); else NGS.sel.delete(k); };
  if (cb.dataset.ngselall) $('ngTable').querySelectorAll('input[data-ngsel]').forEach(x => pick(x.dataset.ngsel, cb.checked));
  else pick(cb.dataset.ngsel, cb.checked);
  renderNg();
});
$('ngFoot').addEventListener('click', e => {
  if (e.target.closest('[data-ngundo]')) { NG_NOTE = { t: 0, text: '' }; staUndoAdd(); return; }
  if (e.target.closest('[data-ngrl]')) { staRlOpen(); return; }
  const b = e.target.closest('[data-pg]');
  if (!b) return;
  NGS.pg = Math.max(0, NGS.pg + (b.dataset.pg === 'next' ? 1 : -1));
  renderNg();
  $('ngTable').closest('.sta-wrap').scrollTop = 0;
});
$('ngSelAdd').addEventListener('click', async () => {
  const added = [], skipped = [], dayUsed = {};
  $('ngSelAdd').disabled = true;
  for (const k of [...NGS.sel.keys()]) {
    const g = ngOf(k);   // the pattern as the model has it now (a change rebuilds it)
    if (!g) continue;
    const q = ngQuick(g, dayUsed);
    if (q.skip) { skipped.push(`"${g.term}" (${q.skip})`); continue; }
    try { for (const it of q.items) { await staRlSave(it); added.push(it); } } catch (x) { skipped.push(`"${g.term}" (could not save: ${x.message || x})`); }
  }
  NGS.sel.clear();
  STM = null;
  $('ngSelAdd').disabled = false;
  const tail = skipped.length ? ` · left out ${skipped.length}: ${staEsc(skipped.slice(0, 4).join(', '))}${skipped.length > 4 ? '…' : ''}` : '';
  if (added.length) { STA_JUST = { ids: added.map(x => x.id), t: Date.now() }; NG_NOTE = { t: Date.now(), text: `Added ${added.length} change${added.length === 1 ? '' : 's'} to the review list${tail}.` }; }
  else NG_NOTE = { t: Date.now(), text: `Nothing added${tail}.` };
  renderNg();
});
$('ngSelClear').addEventListener('click', () => { NGS.sel.clear(); renderNg(); });
$('ngRlBtn').addEventListener('click', () => { if (ST.loaded && ST_RL.where) staRlOpen(); });
$('ngCsv').addEventListener('click', ngCsv);
$('ngMsg').addEventListener('click', e => { if (e.target.closest('[data-settgt]')) staSetOpen(); });
$('ngLegendBtn').addEventListener('click', () => { ngLegend(); $('ngLegend').classList.remove('hide'); });
$('ngLegendX').addEventListener('click', () => $('ngLegend').classList.add('hide'));
$('ngLegend').addEventListener('click', e => { if (e.target === $('ngLegend')) $('ngLegend').classList.add('hide'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ngLegend').classList.contains('hide')) $('ngLegend').classList.add('hide'); });
// "See every pattern in N-Gram Analysis →" in Search Term Analysis's By word view: the same brand.
$('stSub').addEventListener('click', e => {
  if (!e.target.closest('[data-gong]')) return;
  const b = $('stBrand').value;
  if ([...$('ngBrand').options].some(o => o.value === b)) $('ngBrand').value = b;
  showTab('ngram');
});
