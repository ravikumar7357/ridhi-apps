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
 * WHAT IS A PATTERN (22 Nov review: 13 of 51 Waste rows were one search term cut into pieces). An n-gram needs NG.MIN_TERMS
 * distinct search terms: one held by a single term is not a pattern — it is left out, and that term is judged in Search Term
 * Analysis. N-grams with exactly the same search terms are one row, named by the shortest ("same terms: …"); n-grams that
 * start or end with a stop word (STA_STOP: "dish towels for") are left out.
 *
 * THE CLASSES (per brand; with Both brands one row per brand and pattern). The numbers are in NG and STA, and in the legend.
 *   Needs data  fewer clicks than the Minimum clicks choice; or 0 orders that could still be chance (the chance of 0 orders
 *               at the brand's order rate is NG.NEG_CHANCE or more), or under NG.NOSALE_MIN_SP spent.
 *   Waste       two kinds (ngClassOf's wk; the badge, the chips and the filter show which):
 *               · no sales — 0 orders, under NG.NEG_CHANCE chance and NG.NOSALE_MIN_SP+ spent; a blocked word or a competitor
 *                 brand (Lists & settings) at any spend;
 *               · over break-even — NG.BE_ORDERS+ orders above the spend-weighted break-even of its terms; or ACoS over
 *                 NG.LOSS_ACOS with NG.LOSS_MIN_SP+ spent.
 *   Winner      NG.WIN_ORDERS+ orders at or under the spend-weighted target of its terms.
 *   Mixed       the rest: between target and break-even, or too few orders; with no target, "Has orders · not judged".
 *   Protected   a flag on any class, not a class: brand term, sister-brand term, product word, main keyword, seasonal, own
 *               or sister ASIN — never negated. "Protected only" shows just them.
 *   Without unit costs or a target setting for a brand, "above break-even" and Winner are off for it.
 *
 * THE ACTIONS, always through the shared review list and Search Term Analysis's own dialogs and checks:
 *   Waste   "Negate in N campaigns": a campaign-level negative phrase in each campaign where the pattern has no order AND
 *           the evidence is there in that campaign (ngPlan: under NG.NEG_CHANCE chance at the campaign's order rate, or the
 *           brand's, and NG.NOSALE_MIN_SP+ spent there) — staOpen('word', …) with the pattern shaped like a By word row,
 *           whose dialog lists every campaign with its evidence and what happens there; staWordItems. Campaigns where it
 *           sells are kept; over break-even and selling somewhere also gets "Lower bids where it sells →". A protected
 *           pattern gets "Lower bids instead" (its terms in Search Term Analysis). A Waste pattern with no campaign left to
 *           negate says why, with "Open in Search Term Analysis →" — never "Watch".
 *           No-order spend: its spend in the campaigns it would be negated in (the Waste view's first sort).
 *           Download Excel: one pattern (the dialog, an opened row: ngPatternSheets) or every Waste pattern on screen
 *           (the toolbar: ngWasteSheets), through staXlsxBook.
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
  MIN_TERMS: 2,                     // distinct search terms a pattern needs; one term is judged in Search Term Analysis
  TERMS_SHOWN: 15,                  // terms listed under an opened pattern
};
// The four classes: each pattern is in exactly one (the chips add up to All). Protected is a flag on top (NGS.prot).
const NG_CLS = [['waste', 'Waste', 'bad'], ['winner', 'Winner', 'ok'], ['mixed', 'Mixed', 'warn'], ['need', 'Needs data', '']];
const NG_CHIP = { waste: 'neg', winner: 'exact', mixed: 'reduce', need: 'hold' };
const NG_TAGS = { brand: 'Brand term', product: 'Product word', main: 'Main keyword', season: 'Seasonal', own: 'Own product', sister: 'Sister brand',
  blocked: 'Blocked word', comp: 'Competitor brand' };
// The screen's choices: brand, pattern size (0 = all), minimum clicks, classification, Protected only, filter text, sort,
// page, rows per page, the opened rows, the ticked rows (key → pattern).
let NGS = { size: 1, min: NG.MIN_CLICKS, cls: '', prot: false, sort: { k: 'sp', d: -1 }, pg: 0, pgSize: 100, open: new Set(), sel: new Map() };
// The patterns of the model drawn last (rebuilt with the model: a new load, the lists, the review list).
let NGX = null;
// The rows of the last draw, every page (the export); the last "Added …" note.
let NG_LAST = [], NG_NOTE = { t: 0, text: '' };

/* ---------- the patterns, once per model ---------- */
// Every pattern of every brand in the model, with its figures over the terms not yet negated (plus the tail), what protects
// it, its yardsticks and its class before the Minimum clicks choice; then the rows each size shows (ngViews). Cached on the
// model. { M, rows (every n-gram), views (size → rows on screen), solo (size → n-grams of one search term) }.
function ngBuild(M) {
  if (NGX && NGX.M === M) return NGX;
  const rows = [];
  const ix = new Map();
  M.rows.forEach((r, i) => ix.set(r, i));
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
    const rt = (M.rate || {})[b] || null;   // the per-campaign yardsticks (ngCpRate)
    idx.forEach(x => {
      const wds = x.gram.split(' ');
      // A stop word at either end adds nothing to the pattern inside it ("dish towels for", "desk organizers and").
      if (STA_STOP.has(wds[0]) || STA_STOP.has(wds[wds.length - 1])) return;
      const live = x.terms.filter(r => !r.negated);
      if (!live.length && !x.tn) return;
      const g = { key: 'w:' + b + '|' + x.gram, brand: b, gram: x.gram, words: x.words, terms: live, n: live.length + x.tn, tn: x.tn,
        c: x.tc, sp: x.tail, s: x.ts, o: x.to, zsp: x.to > 0 ? 0 : x.tail, conv: 0, cps: new Map(), negN: x.terms.length - live.length, p, rt, info };
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
      const k = staKey(x.gram);
      const tags = [];
      if (P.isBrand(x.gram)) tags.push('brand');
      else if (P.isSister(x.gram)) tags.push('sister');
      if (allTypes.has(k) || wds.every(wd => typeWords.has(staSing(wd)))) tags.push('product');
      if (P.ownKw.has(k) || (P.brandOrders.get(k) || 0) >= STA.MAIN_ORDERS) tags.push('main');
      if (staSeasonOf(x.gram)) tags.push('season');
      if (wds.some(wd => P.own.has(wd))) tags.push('own');
      else if (wds.some(wd => P.sister.has(wd)) && !tags.includes('sister')) tags.push('sister');
      g.tag = P.blocked.includes(x.gram) ? 'blocked' : P.competitors.includes(x.gram) ? 'comp' : '';
      if (g.tag) tags.push(g.tag);
      g.tags = tags;
      g.protect = tags.find(t => t !== 'blocked' && t !== 'comp') || '';
      g.term = g.tag ? (P.rawOf.get(x.gram) || x.gram) : x.gram;
      Object.assign(g, ngClassOf(g));
      g.hay = x.gram;
      g.tcp = x.tcp;
      // Its set of search terms: the same set means the same row (the tail by its figures — its terms are not listed).
      g.sig = b + '|' + live.map(r => ix.get(r)).sort((a, z) => a - z).join(',') + (x.tn ? `|${x.tn},${x.tc},${Math.round(x.tail * 100)},${x.to}` : '');
      g.solo = g.n < NG.MIN_TERMS;
      rows.push(g);
    });
  });
  return (NGX = Object.assign({ M, rows }, ngViews(rows)));
}
// The rows each size shows: n-grams of one search term apart (solo), and those with exactly the same search terms merged into
// one row named by the shortest — a blocked word or competitor brand first, then fewer words, fewer numbers, fewer letters.
// The others are listed under it (same); a protected one protects the row. Size 0 merges across sizes.
function ngViews(rows) {
  const views = { 0: [], 1: [], 2: [], 3: [] }, solo = { 0: [], 1: [], 2: [], 3: [] };
  const groups = { 0: new Map(), 1: new Map(), 2: new Map(), 3: new Map() };
  rows.forEach(g => {
    [0, g.words].forEach(sz => {
      if (!groups[sz]) return;
      if (g.solo) { solo[sz].push(g); return; }
      const m = groups[sz];
      (m.get(g.sig) || m.set(g.sig, []).get(g.sig)).push(g);
    });
  });
  const nums = g => g.gram.split(' ').filter(w => /^\d/.test(w)).length;
  const rank = (a, z) => (a.tag ? 0 : 1) - (z.tag ? 0 : 1) || a.words - z.words || nums(a) - nums(z) || a.gram.length - z.gram.length || (a.gram < z.gram ? -1 : 1);
  Object.keys(groups).forEach(sz => groups[sz].forEach(list => {
    if (list.length === 1) { views[sz].push(list[0]); return; }
    list.sort(rank);
    const lead = list[0], rest = list.slice(1);
    const tags = [...new Set(list.flatMap(g => g.tags))];
    const pro = lead.protect || (rest.find(g => g.protect) || {}).protect || '';
    views[sz].push(Object.assign(Object.create(lead), { same: rest.map(g => g.gram), tags, protect: pro, hay: list.map(g => g.gram).join(' | ') }));
  }));
  return { views, solo };
}
// The class before the Minimum clicks choice, the line saying why, and for Waste which rule made it: { base, why, wk }.
// wk 'nosale': 0 orders (rule a), or a blocked word or competitor brand; 'be': over break-even or a loss (rules b and c).
function ngClassOf(g) {
  const pct = v => (v * 100).toFixed(1) + '%', ch = staChance;
  if (g.tag) return { base: 'waste', wk: 'nosale', why: (g.tag === 'blocked' ? 'One of your blocked words' : 'A competitor brand') + ' (Lists & settings): waste at any spend' };
  if (!(g.o > 0)) {
    if (!g.p) return { base: 'need', why: 'Nothing in this brand has sold yet to compare with' };
    if (g.chance >= NG.NEG_CHANCE) return { base: 'need', why: `0 orders in ${staInt(g.c)} clicks could still be chance (${ch(g.chance)} at the brand's ${pct(g.p)}): about ${staInt(staNeed(g.p, g.c, NG.NEG_CHANCE))} more clicks to tell` };
    if (g.sp < NG.NOSALE_MIN_SP) return { base: 'need', why: `0 orders on ${staMoney(g.sp)}: judged from ${staMoney(NG.NOSALE_MIN_SP)} of spend` };
    return { base: 'waste', wk: 'nosale', why: `0 orders in ${staInt(g.c)} clicks: only ${ch(g.chance)} chance of that at the brand's ${pct(g.p)}` };
  }
  if (g.be != null && g.o >= NG.BE_ORDERS && g.acos > g.be) return { base: 'waste', wk: 'be', why: `ACoS ${staPct(g.acos)} over break-even ${staPct(g.be)} on ${staInt(g.o)} orders` };
  if (g.acos != null && g.acos > NG.LOSS_ACOS && g.sp >= NG.LOSS_MIN_SP) return { base: 'waste', wk: 'be', why: `ACoS ${staPct(g.acos)}: the ads cost more than the sales` };
  if (g.tgt != null && g.o >= NG.WIN_ORDERS && g.acos <= g.tgt) return { base: 'winner', why: `ACoS ${staPct(g.acos)} at or under target ${staPct(g.tgt)} on ${staInt(g.o)} orders` };
  if (!g.costsOn) return { base: 'mixed', why: `${STA_NOTGT}: ${staInt(g.o)} order${g.o === 1 ? '' : 's'} at ACoS ${staPct(g.acos)}, no unit cost or target ACoS for ${staBrandName(g.brand)}` };
  if (g.tgt == null) return { base: 'mixed', why: `${STA_NOTGT}: ${staInt(g.o)} order${g.o === 1 ? '' : 's'} at ACoS ${staPct(g.acos)}, its products have no unit cost` };
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
// A campaign's yardstick for "0 orders could be chance": its own order rate with STA.RATE_ORDERS+ orders, else the brand's —
// Search Term Analysis's (staModel: over its keywords and targets). { p, w } or null.
function ngCpRate(g, cid) {
  const R = g.rt;
  const ca = R && R.cp.get(cid);
  if (ca && ca.o >= STA.RATE_ORDERS && ca.c > 0) return { p: ca.o / ca.c, w: 'its campaign' };
  if (R && R.b.o > 0 && R.b.c > 0) return { p: R.b.o / R.b.c, w: 'the brand' };
  return g.p ? { p: g.p, w: 'the brand' } : null;
}
// The negate plan of a Waste pattern: per campaign where it spent, what happens there —
//   kept    it sells there;
//   prot    every one of its terms is protected there (Search Term Analysis's own check, noNeg: a brand or sister-brand term,
//           a product word of that ad group, seasonal…);
//   at      already negated at Amazon;  queued  waiting in the review list;
//   neg     0 orders there, unlikely to be chance (under NG.NEG_CHANCE at the campaign's order rate, or the brand's when the
//           campaign has under STA.RATE_ORDERS orders) and NG.NOSALE_MIN_SP+ spent there — ticked; a blocked word or a
//           competitor brand at any spend, as its class;
//   thin    0 orders there but too little to tell (22 Nov: "decorative" ticked campaigns where it spent $7.20 and $5.97) —
//           shown, not ticked.
// Each campaign as a copy with { what, can (can be ticked), on (ticked at first), ev (the evidence), why, chance, rate }.
// { neg, thin, kept, prot, at, queued }, each by spend.
const NG_PLAN_KEYS = ['neg', 'thin', 'kept', 'prot', 'at', 'queued'];
function ngPlan(g) {
  if (Object.prototype.hasOwnProperty.call(g, '_plan') && g._plan) return g._plan;
  const out = { neg: [], thin: [], kept: [], prot: [], at: [], queued: [] };
  const allProt = new Map();
  g.terms.forEach(r => allProt.set(r.cid, (allProt.has(r.cid) ? allProt.get(r.cid) : true) && !!r.noNeg));
  const clk = n => `${staInt(n)} click${n === 1 ? '' : 's'}`;
  [...g.cps.values()].filter(c => c.sp >= NG.CP_MIN_SP || c.o > 0).sort((a, z) => z.sp - a.sp).forEach(c0 => {
    const c = Object.assign({}, c0, { can: false, on: false, why: '' });
    const put = (k, ev) => { c.what = k; c.ev = ev; out[k].push(c); };
    if (c.o > 0) put('kept', `${staInt(c.o)} order${c.o === 1 ? '' : 's'} · ${staMoney(c.s)} sales`);
    else if (allProt.get(c.cid) && !(g.tcp && g.tcp.get(c.cid))) put('prot', 'Every one of its search terms is protected here');
    else if (staNegAtAmazon(g.brand, 'cp|' + c.cid, g.gram, 'np') === true) put('at', 'A negative phrase for it is already here at Amazon');
    else if (ngOpenRl(x => x.kind === 'neg' && x.brand === g.brand && staNorm(x.term) === g.gram && x.cid === c.cid)) put('queued', 'Already waiting in the review list');
    else if (g.tag) { c.can = c.on = true; put('neg', `${g.tag === 'blocked' ? 'Your blocked word' : 'A competitor brand'}: negated at any spend`); }
    else {
      const R = ngCpRate(g, c.cid);
      c.rate = R;
      c.chance = R ? Math.pow(1 - R.p, c.c || 0) : null;
      c.can = true;
      const ev = `0 in ${clk(c.c || 0)}${R ? ` · ${staChance(c.chance)} chance` : ''}`;
      if (R && c.chance < NG.NEG_CHANCE && c.sp >= NG.NOSALE_MIN_SP) { c.on = true; put('neg', ev); }
      else { c.why = `${clk(c.c || 0)}, ${staMoney(c.sp)}`; put('thin', ev); }
    }
  });
  return (g._plan = out);
}
// Every campaign of the plan, by spend (the dialog's table, the Excel file).
const ngPlanAll = P => NG_PLAN_KEYS.flatMap(k => P[k]).sort((a, z) => z.sp - a.sp);
// The longer line for one campaign: what happens there, and the evidence — "Negate here — 0 in 58 clicks · <0.1% chance at
// its campaign's 8.3% order rate".
function ngCpWhy(c) {
  const what = c.what === 'thin' ? `${STA_CP_WHAT.thin[0]} (${c.why})` : STA_CP_WHAT[c.what][0];
  const rate = c.rate ? ` at ${c.rate.w}'s ${(c.rate.p * 100).toFixed(1)}% order rate` : '';
  return `${what} — ${c.ev}${c.chance != null ? rate : ''}${c.what === 'thin' && c.sp < NG.NOSALE_MIN_SP ? ` · judged from ${staMoney(NG.NOSALE_MIN_SP)} spent here` : ''}`;
}
// The term a Winner harvests: the lowest ACoS among its terms with NG.HARVEST_ORDERS+ orders, within target, with no exact
// keyword of its own yet. { r } or { why }.
function ngHarvest(g) {
  if (Object.prototype.hasOwnProperty.call(g, '_harv') && g._harv) return g._harv;
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
// campaigns of the plan where it is negated (ticked: enough evidence there). cpAll: every campaign of the plan, with what
// happens there, for the dialog's table; xlsx: its Excel file, with the campaigns ticked in the dialog.
function ngWordRow(g) {
  const plan = ngPlan(g);
  return { key: g.key, type: 'word', brand: g.brand, term: g.term, gram: g.gram, words: g.words, n: g.n, c: g.c, sp: g.sp, o: g.o, s: g.s, zsp: g.zsp,
    tail: g.sp - g.terms.reduce((t, r) => t + r.sp, 0), terms: g.terms.slice().sort((a, z) => z.sp - a.sp).slice(0, 8).map(r => r.term),
    cps: plan.neg.map(c => ({ cid: c.cid, cn: c.cn, sp: c.sp, s: c.s, o: c.o, n: c.n })), tag: g.tag === 'comp' ? 'competitor' : g.tag, protect: g.protect ? NG_TAGS[g.protect].toLowerCase() : '',
    cpAll: ngPlanAll(plan).map(c => ({ cid: c.cid, cn: c.cn, sp: c.sp, c: c.c, s: c.s, o: c.o, n: c.n, what: c.what, can: c.can, on: c.on, ev: c.ev, why: c.why })),
    xlsx: picks => ngXlsxPattern(g, picks),
    cat: 'burn', kind: 'word', burned: g.zsp, stake: g.zsp, hay: g.gram };
}
// The next step of a pattern under the Minimum clicks choice: { act: 'neg' | 'harvest' | 'low' | 'tgt' | 'st' | '', short, text, n, r }.
// short: only what to do, for the Next step cell (the Classification cell already says why); text: the longer line, for the
// opened row, the tooltip and the CSV. 'st': a Waste pattern with no campaign left to negate — the exact reason, and "Open in
// Search Term Analysis →" (a Waste row never says "Watch").
function ngNext(g, min) {
  const cls = ngCls(g, min);
  const out = (act, short, text, more) => Object.assign({ act, short, text: text || short }, more || {});
  if (g.info.stale) return out('', 'Wait for fresh data', g.info.stale + ': no suggestions');
  if (cls === 'waste') {
    if (g.protect) return out('low', 'Lower bids instead →', `${NG_TAGS[g.protect]}: never negated — a lower bid on its terms instead`);
    if (!g.info.settled) return out('', 'Wait for the settled report', 'Negatives wait for the settled report (this is the 30-day one: its last 7 days\' sales are not all in)');
    if (g.words > STA.NEG.negativePhrase.words) return out('st', 'Too long for a negative phrase', `A negative phrase takes ${STA.NEG.negativePhrase.words} words at most`);
    const P = ngPlan(g);
    const cps = n => `${staInt(n)} campaign${n === 1 ? '' : 's'}`;
    // Over break-even and it sells somewhere: lower bids where it sells, negate where it never sold (low: the second link).
    const sells = g.wk === 'be' && g.conv > 0 && P.kept.length > 0;
    const sellTxt = sells ? `Sells in ${cps(P.kept.length)}: lower bids there, negate where it never sold` : '';
    if (!P.neg.length) {
      const n = (list, t) => (list.length ? [`${t} in ${cps(list.length)}`] : []);
      const parts = n(P.kept, 'sells').concat(n(P.thin, 'not enough data'), n(P.prot, 'protected'), n(P.at, 'already negated at Amazon'), n(P.queued, 'in the review list'));
      const one = [P.kept, P.thin, P.prot, P.at, P.queued].filter(l => l.length).length === 1;
      const short = !parts.length ? 'No campaign spent enough on it' : !one ? 'No campaign left to negate'
        : P.kept.length ? 'Sells everywhere it spends' : P.thin.length ? 'Not enough data in any one campaign' : P.prot.length ? 'Protected in every campaign' : P.at.length ? 'Already negated' : 'In the review list';
      const text = parts.length ? `Nothing to negate: ${parts.join(', ')}` : `No campaign spent ${staMoney(NG.CP_MIN_SP)} or more on it`;
      return out('st', short, text + (sells ? ' · lower bids where it sells' : ''), { low: sells });
    }
    const left = STA.DAY_MAX - staDayCount(g.brand);
    if (left <= 0) return out('st', 'Day\'s limit reached', `The day's limit of ${STA.DAY_MAX} negatives for ${staBrandName(g.brand)} is reached`, { low: sells });
    return out('neg', `Negate in ${cps(P.neg.length)}`, `Negative phrase · campaign level · ${cps(P.neg.length)}`
      + (sells ? ' · ' + sellTxt.charAt(0).toLowerCase() + sellTxt.slice(1) : P.kept.length ? ` · kept in ${staInt(P.kept.length)} where it sells` : '')
      + (P.thin.length ? ` · kept in ${staInt(P.thin.length)} without enough data` : ''), { n: P.neg.length, low: sells, sellTxt });
  }
  if (cls === 'winner') {
    const h = ngHarvest(g);
    if (!h.r) return out('', 'Watch', 'Watch: ' + h.why);
    return out('harvest', 'Harvest best term', `"${h.r.term}" as an exact keyword: ${staInt(h.r.o)} orders at ${staPct(h.r.acos)}`, { r: h.r });
  }
  if (cls === 'need') {
    if (!g.p) return out('', 'Watch', 'Watch: ' + ngWhy(g, min));
    const toTell = !(g.o > 0) ? staNeed(g.p, g.c, NG.NEG_CHANCE) : 0;
    const more = Math.max(g.c < min ? min - g.c : 0, toTell);
    return more > 0 ? out('', `Wait for more clicks (~${staInt(more)})`, 'Watch: ' + ngWhy(g, min)) : out('', 'Wait for more spend', 'Watch: ' + ngWhy(g, min));
  }
  // Mixed: with no unit cost or target ACoS it cannot be judged on profit — a target switches that on.
  if (g.tgt == null) return out('tgt', 'Set a target ACoS →', `No unit cost or target ACoS for ${staBrandName(g.brand)}: set one in Lists & settings to judge it on profit`);
  return out('', 'Watch', 'Watch: ' + ngWhy(g, min));
}
/* ---------- the rows on screen ---------- */
function ngFilters() {
  return { brand: $('ngBrand').value || 'ALL', q: staLow($('ngFilter').value), size: NGS.size, min: NGS.min, cls: NGS.cls, prot: NGS.prot };
}
// The patterns of the size chosen (merged, one term apart: ngViews) that pass brand and filter text (the pattern, the n-grams
// merged into it, or any of its terms, campaigns and ad groups) — before the classification, which the boxes and chips count.
// solo: true for the n-grams of one search term instead (left out of the table, judged in Search Term Analysis).
function ngRows(X, f, solo) {
  const list = (solo ? X.solo : X.views)[f.size || 0] || [];
  return list.filter(g => (f.brand === 'ALL' || g.brand === f.brand)
    && (!f.q || g.hay.includes(f.q) || g.terms.some(r => r.hay.includes(f.q))));
}
// No-order spend: the pattern's spend in the campaigns it would be negated in (no order there, and enough to tell); null
// when its next step is not a negative.
function ngNos(g, min) {
  if (ngNext(g, min).act !== 'neg') return null;
  return ngPlan(g).neg.reduce((t, c) => t + c.sp, 0);
}
const NG_SORTS = { term: g => g.gram, n: g => g.n, c: g => g.c, sp: g => g.sp, s: g => g.s, o: g => g.o, acos: g => (g.acos == null ? -1 : g.acos),
  cvr: g => (g.cvr == null ? -1 : g.cvr), ncp: g => g.ncp, conv: g => g.conv, nos: g => { const v = ngNos(g, NGS.min); return v == null ? -1 : v; } };
// The two kinds of Waste: which rule made it (ngClassOf's wk), and the filter values that pick one.
const NG_WK = { nosale: 'Waste · no sales', be: 'Waste · over break-even' };
const NG_WK_CLS = { 'waste-ns': 'nosale', 'waste-be': 'be' };
const ngIsWaste = cls => cls === 'waste' || cls in NG_WK_CLS;
// A new classification: the Waste view sorts by No-order spend at first (the patterns costing the most first); leaving it,
// that sort goes back to spend.
function ngSetCls(cls) {
  const was = ngIsWaste(NGS.cls), now = ngIsWaste(cls);
  NGS.cls = cls;
  if (now && !was) NGS.sort = { k: 'nos', d: -1 };
  else if (!now && was && NGS.sort.k === 'nos') NGS.sort = { k: 'sp', d: -1 };
}
function ngSorted(rows) {
  const f = NG_SORTS[NGS.sort.k] || NG_SORTS.sp, d = NGS.sort.d;
  return rows.slice().sort((a, z) => { const x = f(a), y = f(z); return (x < y ? -1 : x > y ? 1 : 0) * d || z.sp - a.sp; });
}

/* ---------- drawing ---------- */
// Called when the tab opens: draws what is there (or "Loading…"), then waits for Search Term Analysis's load — the same one,
// tried again by itself while the caches cannot be read (staLoadSure) — and draws again. A failure is never kept: the next
// open, or "Try again", reads again.
async function ensureNgram() {
  renderNg();
  try { await staLoadSure(); } catch (e) { ST.loadErr = String((e && e.message) || e); }
  renderNg();
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
  // Nothing read yet: loading (with its try), or the error and "Try again" (Search Term Analysis's own words).
  if (!staHave()) {
    staNotLoaded({ msg: 'ngMsg', table: 'ngTable', foot: 'ngFoot', clear: ['ngBoxes', 'ngActBar'] });
    $('ngSub').textContent = '';
    ngSelBar();
    return;
  }
  const haveAny = ['SP', 'CPC'].some(b => ((ST.terms[b] || {}).rows || []).length || (ST.set && ST.set.d && ST.set.d[b]));
  if (!haveAny) {
    staStatus('ngMsg', { summary: '<span class="sta-bad">✗ No search terms yet</span>', notes: 1, block: true,
      html: '<span>The nightly run has not collected any search-term data yet, or the last one came back empty. Patterns show once it does.</span>'
        + (staSrcLine() ? '<span>' + staSrcLine() + '</span>' : '') });
    ['ngBoxes', 'ngActBar'].forEach(id => { $(id).innerHTML = ''; });
    $('ngSub').textContent = '';
    $('ngTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">No search terms yet.</td></tr></tbody>';
    $('ngFoot').innerHTML = '';
    ngSelBar();
    return;
  }
  const M = staModel('ALL');
  const X = ngBuild(M);
  const f = ngFilters();
  ngDataLine(M, f.brand === 'ALL' ? M.brands : [f.brand]);
  // Protected only narrows first (a flag, not a class); the four classes then add up to All.
  const all = ngRows(X, f);
  const nProt = all.filter(g => g.protect).length;
  const base = f.prot ? all.filter(g => g.protect) : all;
  const cnt = { waste: [], winner: [], mixed: [], need: [] };
  base.forEach(g => cnt[ngCls(g, f.min)].push(g));
  ngBoxes(cnt, f, M);
  ngChips(cnt, base.length, nProt);
  const wk = NG_WK_CLS[f.cls];
  const rows = ngSorted(wk ? cnt.waste.filter(g => g.wk === wk) : f.cls ? cnt[f.cls] || [] : base);
  NG_LAST = rows;
  $('ngXlsx').classList.toggle('hide', !ngIsWaste(f.cls));
  ngDraw(rows, f, M, ngRows(X, f, true));
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
// The search terms behind a set of patterns, each counted once (a term holding three Waste patterns is one term, its spend
// counted once): { n, sp, s }. Terms too small to be listed one by one (the tail) cannot be told apart, so they are left out.
function ngDistinct(list) {
  const seen = new Set();
  list.forEach(g => g.terms.forEach(r => seen.add(r)));
  let sp = 0, s = 0;
  seen.forEach(r => { sp += r.sp || 0; s += r.s || 0; });
  return { n: seen.size, sp, s };
}
// The four boxes (Search Term Analysis's look); a click sets the classification. Their spend, sales and terms count each
// search term once (ngDistinct); the table's rows are per pattern, and do not add up.
function ngBoxes(cnt, f, M) {
  const IC = {
    waste: '<path d="M12 2c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-6 1.5 1 2 2.5 2 4 1-1 1.5-4 1-8Z"/>',
    winner: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    mixed: '<path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>',
    need: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  // A box with no rows has no link: there is nothing to go to.
  const onK = k => NGS.cls === k || (k === 'waste' && ngIsWaste(NGS.cls));
  const box = (k, c, label, n, unit, q, go) => `
    <button type="button" class="adx-box sta-box${onK(k) ? ' on' : ''}" data-box="${k}" style="--c:${c};--adx-glow:.10" aria-pressed="${onK(k)}" aria-label="${staEsc(label + ': ' + staInt(n) + ' ' + unit + (n ? '. ' + go : ''))}">
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg></span>${label}</div>
      <div class="sta-big"><b>${staInt(n)}</b><span>${unit}</span></div>
      <div class="sta-q">${q}</div>
      ${n ? `<div class="sta-go"><span>${go} →</span></div>` : ''}
    </button>`;
  const w = cnt.waste, wi = cnt.winner, dw = ngDistinct(w), dwi = ngDistinct(wi);
  // Mixed: "between target and break-even" only where a target exists; without one, Placement's words for the same thing.
  const brands = f.brand === 'ALL' ? M.brands : [f.brand];
  const on = brands.filter(b => ST.costs || staFb(b)).length;
  const mixTgt = cnt.mixed.length ? cnt.mixed.some(g => g.tgt != null) : on > 0, mixNo = cnt.mixed.length ? cnt.mixed.some(g => g.tgt == null) : on < brands.length;
  const mixQ = mixTgt && mixNo ? `Between target and break-even, or few orders · without a target: ${STA_NOTGT.toLowerCase()}.`
    : mixNo ? STA_NOTGT + '.' : 'Between target and break-even, or few orders.';
  $('ngBoxes').innerHTML =
    box('waste', 'var(--bad)', 'Waste patterns', w.length, 'patterns', `${staMoney0(dw.sp)} spend in ${staInt(dw.n)} search term${dw.n === 1 ? '' : 's'}, each counted once · `
      + `${staInt(w.filter(g => g.wk === 'nosale').length)} no sales, ${staInt(w.filter(g => g.wk === 'be').length)} over break-even.`, 'Negate where they don\'t sell')
    + box('winner', 'var(--accent)', 'Winner patterns', wi.length, 'patterns', `${staMoney0(dwi.s)} sales in ${staInt(dwi.n)} search term${dwi.n === 1 ? '' : 's'}, each counted once.`, 'Harvest the best term')
    + box('mixed', 'var(--rev)', 'Mixed', cnt.mixed.length, 'patterns', mixQ, mixNo && !mixTgt ? 'Set a target ACoS' : 'Watch')
    + box('need', 'var(--brand)', 'Needs data', cnt.need.length, 'patterns', `Fewer than ${staInt(f.min)} clicks, or not conclusive yet.`, 'Wait for more clicks');
}
// The classification chips, like Search Term Analysis's next-step chips: the four classes add up to All. Protected only is a
// separate toggle at the end (a flag on any class), with how many are protected.
// After Waste, its two kinds as small chips of their own (they add up to Waste).
function ngChips(cnt, all, nProt) {
  const on = k => NGS.cls === k || (k === 'waste' && ngIsWaste(NGS.cls));
  const chip = (k, t, c) => `<button type="button" class="sta-chip${on(k) ? ' on' : ''}${k ? ' a-' + NG_CHIP[k] : ''}" data-a="${k}" aria-pressed="${on(k)}">${t}<span>${staInt(c)}</span></button>`;
  const wkChip = (v, t) => `<button type="button" class="sta-chip ng-wk${NGS.cls === v ? ' on' : ''}" data-wk="${v}" aria-pressed="${NGS.cls === v}" title="${staEsc(NG_WK[NG_WK_CLS[v]])}">${t}<span>${staInt(cnt.waste.filter(g => g.wk === NG_WK_CLS[v]).length)}</span></button>`;
  $('ngActBar').innerHTML = '<span class="sta-actl">Classification</span>' + chip('', 'All', all)
    + NG_CLS.map(([k, t]) => chip(k, t, cnt[k].length) + (k === 'waste' ? `<span class="ng-wks">${wkChip('waste-ns', 'no sales')}${wkChip('waste-be', 'over break-even')}</span>` : '')).join('')
    + `<span class="ng-flag"><button type="button" class="sta-chip ng-prot${NGS.prot ? ' on' : ''}" data-prot="1" aria-pressed="${NGS.prot}" title="Brand and sister-brand terms, product words, main keywords, seasonal words, own and sister ASINs: never negated">Protected only<span>${staInt(nProt)}</span></button></span>`
    + `<label class="sta-pgsz ng-rows">Rows <select id="ngPgSize" aria-label="Rows per page">${[50, 100, 250].map(n => `<option${n === NGS.pgSize ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
}
function ngRlBadge() {
  const n = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved').length;
  $('ngRlN').textContent = n;
  $('ngRlN').classList.toggle('hide', !n);
}
// The class badge; Waste says which kind ("Waste · no sales", "Waste · over break-even").
const ngClsBadge = (g, min) => { const k = ngCls(g, min), c = NG_CLS.find(x => x[0] === k); return staBadge(k === 'waste' && NG_WK[g.wk] ? NG_WK[g.wk] : c[1], c[2]); };
const ngClsName = cls => (NG_WK[NG_WK_CLS[cls]] || (NG_CLS.find(x => x[0] === cls) || [])[1] || '');
// The table: one row per pattern, with a caret that opens its terms and what the action does.
// solo: the n-grams of one search term that pass the same filters (left out; counted in the line above the table, and listed
// at its end when the filter text finds some).
function ngDraw(rows, f, M, solo) {
  const pages = Math.max(1, Math.ceil(rows.length / NGS.pgSize));
  if (NGS.pg >= pages) NGS.pg = pages - 1;
  const page = rows.slice(NGS.pg * NGS.pgSize, (NGS.pg + 1) * NGS.pgSize);
  const sizeTxt = f.size ? `${f.size}-word` : '1-, 2- and 3-word';
  const soloTerms = [...new Set((solo || []).flatMap(g => g.terms.map(r => r.term)))];
  $('ngSub').innerHTML = `${staInt(rows.length)} ${sizeTxt} pattern${rows.length === 1 ? '' : 's'}${f.cls ? ' · ' + ngClsName(f.cls).toLowerCase() : ''}${f.prot ? ' · protected only' : ''} · ${staEsc(staWindowTxt(M))}. `
    + `Each search term counts once for every pattern it holds; a pattern needs ${NG.MIN_TERMS}+ search terms`
    + (solo && solo.length ? ` — ${staInt(solo.length)} n-gram${solo.length === 1 ? '' : 's'} of a single search term left out (judged as that term in Search Term Analysis).` : '.');
  const S = NGS.sort, th = (t, k, tip) => staTh(t, k, 1, tip, S);
  const COLS = 13;
  const body = page.map(g => {
    const nx = ngNext(g, f.min), open = NGS.open.has(g.key), can = nx.act === 'neg' || nx.act === 'harvest';
    if (!can) NGS.sel.delete(g.key);
    const tick = can ? `<input type="checkbox" class="sta-cb" data-ngsel="${staEsc(g.key)}"${NGS.sel.has(g.key) ? ' checked' : ''} aria-label="Select ${staEsc(g.gram)}">` : '<span class="sta-cbgap"></span>';
    const caret = `<button type="button" class="sta-caret" data-ngopen="${staEsc(g.key)}" aria-expanded="${open}" aria-controls="ngS-${staEsc(g.key)}" aria-label="${open ? 'Hide' : 'Show'} the terms behind ${staEsc(g.gram)}">${open ? '▾' : '▸'}</button>`;
    const tags = g.tags.map(t => staBadge(NG_TAGS[t], t === 'blocked' || t === 'comp' || t === 'season' ? 'warn' : 'info')).join('');
    // Next step: only what to do — the button, or a short word (the why is in the Classification cell; the longer line on hover).
    const tip = staEsc(nx.text);
    const btn = nx.act === 'neg' ? `<button type="button" class="sta-btn neg sm" data-ngact="neg" data-k="${staEsc(g.key)}" title="${tip}">${staEsc(nx.short)}</button>`
      : nx.act === 'harvest' ? `<button type="button" class="sta-btn sm" data-ngact="harvest" data-k="${staEsc(g.key)}" title="${tip}">${staEsc(nx.short)}</button>`
        : nx.act === 'low' || nx.act === 'tgt' ? `<button type="button" class="sta-btn dim sm" data-ngact="${nx.act}" data-k="${staEsc(g.key)}" title="${tip}">${staEsc(nx.short)}</button>` : '';
    // Over break-even and it sells somewhere: also "Lower bids where it sells →" (its terms in Search Term Analysis).
    const lowSell = nx.low ? `<button type="button" class="sta-btn dim sm ng-gost" data-ngact="st" data-k="${staEsc(g.key)}" title="Its search terms in Search Term Analysis, where each keyword's bid can be lowered">Lower bids where it sells →</button>` : '';
    // Waste with nothing to negate: the exact reason, and its terms in Search Term Analysis.
    const nextCell = btn ? `<td class="sta-next">${nx.sellTxt ? `<small>${staEsc(nx.sellTxt)}</small>` : ''}${btn}${lowSell}</td>`
      : nx.act === 'st' ? `<td class="sta-next"><span class="sta-hold" title="${tip}">${staEsc(nx.short)}</span>${lowSell || `<button type="button" class="sta-btn dim sm ng-gost" data-ngact="st" data-k="${staEsc(g.key)}">Open in Search Term Analysis →</button>`}</td>`
        : `<td class="sta-next"><span class="sta-hold" title="${tip}">${staEsc(nx.short)}</span></td>`;
    const same = g.same && g.same.length ? `<div class="sta-s ng-same" title="${staEsc(g.same.join(', '))}">same terms: ${staEsc(g.same.slice(0, 3).map(x => '"' + x + '"').join(', '))}${g.same.length > 3 ? ` +${g.same.length - 3}` : ''}</div>` : '';
    const nos = ngNos(g, f.min), why = ngWhy(g, f.min);
    const row = `<tr${NGS.sel.has(g.key) ? ' class="sel"' : ''}>
      <td class="sta-stick">${tick}<div class="sta-tc"><div class="sta-term">${caret}"${staEsc(g.term)}"</div>${same}
        <div class="sta-under">${f.brand === 'ALL' ? staBadge(staBrandName(g.brand), 'brand-' + g.brand) : ''}${tags}</div></div></td>
      <td class="sta-ev sta-ev-s">${ngClsBadge(g, f.min)}${g.protect ? staBadge('Protected', 'info', NG_TAGS[g.protect] + ': never negated') : ''}<div class="sta-why ng-why" title="${staEsc(why)}">${staEsc(why)}</div></td>
      <td class="num">${staInt(g.n)}</td><td class="num">${staInt(g.c)}</td><td class="num">${staMoney(g.sp)}</td><td class="num">${nos != null ? `<b>${staMoney(nos)}</b>` : staDash}</td><td class="num">${staMoney(g.s)}</td>
      <td class="num">${staInt(g.o)}</td><td class="num"><b>${g.acos != null ? staPct(g.acos) : staDash}</b></td><td class="num">${g.cvr != null ? staPct(g.cvr) : staDash}</td>
      <td class="num">${staInt(g.ncp)}</td><td class="num">${staInt(g.conv)}</td>${nextCell}</tr>`;
    return open ? row + ngSubRow(g, f, nx, COLS) : row;
  }).join('');
  const tickable = page.filter(g => { const a = ngNext(g, f.min).act; return a === 'neg' || a === 'harvest'; });
  const allOn = tickable.length && tickable.every(g => NGS.sel.has(g.key));
  const tickAll = tickable.length ? `<input type="checkbox" class="sta-cb" data-ngselall="1"${allOn ? ' checked' : ''} aria-label="Select every pattern with an action on this page">` : '';
  $('ngTable').innerHTML = `<thead><tr><th class="sta-stick sta-sort${S.k === 'term' ? ' on' : ''}" data-sort="term" title="Sort by pattern">${tickAll} N-gram${S.k === 'term' ? (S.d > 0 ? ' ▲' : ' ▼') : ''}</th><th>Classification</th>`
    + th('Search terms', 'n', 'Search terms holding the pattern (each term counts once for every pattern it holds)') + th('Clicks', 'c') + th('Ad spend', 'sp')
    + th('No-order spend', 'nos', 'Its spend in the campaigns it would be negated in: no order there, and enough clicks and spend there to tell') + th('Ad sales', 's')
    + th('Orders', 'o') + th('ACoS', 'acos') + th('CVR', 'cvr', 'Orders ÷ clicks') + th('Campaigns', 'ncp', 'Campaigns it spent in') + th('Converting terms', 'conv', 'Its search terms with at least one order')
    + '<th>Next step</th></tr></thead><tbody>'
    + (body || `<tr><td colspan="${COLS}" class="muted" style="padding:14px">${NGX.rows.length ? 'Nothing matches these filters.' : 'No word pattern in these search terms yet.'}</td></tr>`)
    // The filter text found n-grams of a single search term: not patterns — pointed to where each is judged.
    + (f.q && soloTerms.length && NGS.pg === pages - 1 ? `<tr class="ng-solo"><td colspan="${COLS}"><span class="sta-s">Also ${staInt(solo.length)} n-gram${solo.length === 1 ? '' : 's'} of a single search term — not a pattern, judged as that term in Search Term Analysis: `
      + soloTerms.slice(0, 5).map(t => `"${staEsc(t)}"`).join(', ') + (soloTerms.length > 5 ? ` and ${staInt(soloTerms.length - 5)} more` : '')
      + `</span> <button type="button" class="sta-btn dim sm" data-ngst="1">Open in Search Term Analysis →</button></td></tr>` : '')
    + '</tbody>';
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
  const P = ngPlan(g);
  const li = (c, t, cls) => `<li class="${cls}"><b>${staEsc(c.cn || 'Campaign ' + c.cid)}</b> <span class="sta-dash">${staMoney(c.sp)}${c.o ? ` · ${staInt(c.o)} order${c.o === 1 ? '' : 's'}, ${staMoney(c.s)}` : c.ev ? ' · ' + staEsc(c.ev) : ''}</span><em>${t}</em></li>`;
  // Every campaign of the plan, and what happens there.
  const plan = () => '<ul class="ng-plan">' + P.neg.map(c => li(c, 'Negate here', 'is-neg')).join('') + P.thin.map(c => li(c, `Kept: not enough data here (${staEsc(c.why)})`, '')).join('')
    + P.kept.map(c => li(c, 'Kept: sells here', 'is-kept')).join('')
    + P.prot.map(c => li(c, 'Kept: protected here', 'is-kept')).join('') + P.at.map(c => li(c, 'Already negated at Amazon', '')).join('')
    + P.queued.map(c => li(c, 'In the review list', '')).join('') + '</ul>';
  // Every Waste pattern: its campaigns and search terms as an Excel file.
  const xl = ngCls(g, f.min) === 'waste' ? `<p><button type="button" class="sta-btn dim sm" data-ngxl="${staEsc(g.key)}" title="${staEsc(ngXlsxName(g))}">Download Excel</button></p>` : '';
  if (nx.act === 'neg') {
    right = `<p>A negative phrase "${staEsc(g.term)}" at campaign level, in each campaign where it has no order and enough data to tell (under ${Math.round(NG.NEG_CHANCE * 100)}% chance of that by luck, ${staMoney(NG.NOSALE_MIN_SP)}+ spent there):</p>` + plan()
      + `<p class="sta-s">Sales at risk: none — it has no order in those campaigns. ${nx.sellTxt ? staEsc(nx.sellTxt) + '. ' : ''}Negatives left today for ${staBrandName(g.brand)}: ${staInt(Math.max(0, STA.DAY_MAX - staDayCount(g.brand)))} of ${STA.DAY_MAX}. The dialog runs the usual checks before anything is added.</p>`;
  } else if (nx.act === 'harvest') {
    const r = ngHarvestRow(nx.r);
    const c = staDestinations(r, false)[0];
    right = `<p>Adds <b>"${staEsc(r.term)}"</b> as its own exact keyword${c ? ` in <b>${staEsc(c.cn)}</b> · ${staEsc(c.agn)}` : ''} at about <b>${staMoney(r.sugBid)}</b> (CPC ${staMoney(r.cpc)} +${Math.round(STA.STEP * 100)}%, under the ceiling ${staMoney(r.ceil)}).</p>`
      + `<p class="sta-s">${staInt(r.o)} orders at ${staPct(r.acos)} ACoS through ${staEsc(staPathLabel(r.kw, r.mt))}, target ${staPct(r.tgtUse)}.${c ? '' : ' No manual keyword ad group advertises its product yet: the dialog says so.'} Once the new keyword takes the term, Competing paths suggests the negative on the old path.</p>`;
  } else if (nx.act === 'st') {
    const any = NG_PLAN_KEYS.some(k => P[k].length);
    right = `<p>${staEsc(nx.text)}.</p>${any ? plan() : ''}<p class="sta-s">"${nx.low ? 'Lower bids where it sells' : 'Open in Search Term Analysis'}" shows its search terms there, each judged on its own.</p>`;
  } else if (nx.act === 'low') {
    right = `<p>${staEsc(nx.text)}.</p><p class="sta-s">"Lower bids instead" opens its search terms in Search Term Analysis, where each keyword's bid can be lowered with the usual checks.</p>`;
  } else right = `<p>Nothing to change yet.</p><p class="sta-s">${staEsc(nx.text)}</p>`;
  return `<tr class="ng-sub" id="ngS-${staEsc(g.key)}"><td colspan="${cols}"><div class="ng-split">${left}<div class="ng-col"><h5 class="sta-actl">What the action does</h5>${right}${xl}</div></div></td></tr>`;
}

/* ---------- actions ---------- */
// A row by its key: the size on screen first (a merged row), else any n-gram.
const ngOf = key => (NGX ? (NGX.views[NGS.size] || []).find(g => g.key === key) || NGX.rows.find(g => g.key === key) : null);
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

// Lists & settings, on the brand given (a pattern's, or the one picked here), for its target ACoS.
function ngSetTarget(brand) {
  staSetOpen();
  if (brand === 'SP' || brand === 'CPC') { STS_B = brand; staSetDraw(); }
}

/* ---------- export ---------- */
const NG_CSV_COLS = ['Brand', 'N-gram', 'Words', 'Classification', 'Protected', 'Tags', 'Search terms', 'Clicks', 'Ad spend', 'Ad sales', 'Orders', 'ACoS %', 'CVR %',
  'Campaigns', 'Converting terms', 'Spend with no order', 'Target ACoS %', 'Break-even ACoS %', 'Next step', 'Why', 'Waste kind', 'No-order spend (campaigns to negate)', 'Same search terms as'];
function ngCsvLines(rows, min) {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const r1 = v => (v == null ? '' : Math.round(v * 10) / 10);
  return [NG_CSV_COLS.map(cell).join(',')].concat(rows.map(g => {
    const nx = ngNext(g, min), cls = ngCls(g, min), nos = ngNos(g, min);
    return [staBrandName(g.brand), g.term, g.words, NG_CLS.find(x => x[0] === cls)[1], g.protect ? NG_TAGS[g.protect] : '', g.tags.map(t => NG_TAGS[t]).join('; '),
      g.n, g.c, staR2(g.sp), staR2(g.s), g.o, r1(g.acos), r1(g.cvr), g.ncp, g.conv, staR2(g.zsp), r1(g.tgt), r1(g.be),
      nx.act === 'harvest' ? `Harvest "${nx.r.term}"` : nx.short.replace(/ →$/, ''), ngWhy(g, min), cls === 'waste' ? (NG_WK[g.wk] || '').replace('Waste · ', '') : '',
      nos != null ? staR2(nos) : '', (g.same || []).join('; ')].map(cell).join(',');
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

/* ---------- Excel (Search Term Analysis's .xlsx writer, staXlsxBook) ---------- */
// One pattern's file: "decorative.xlsx"; with both brands on screen, "decorative - Ridhi.xlsx".
function ngXlsxName(g) {
  const both = ($('ngBrand').value || 'ALL') === 'ALL';
  return staFileName(g.term + (both ? ' - ' + staBrandName(g.brand) : '')) + '.xlsx';
}
const ngP2 = n => String(n).padStart(2, '0');
const ngNow = () => { const d = new Date(); return `${d.getFullYear()}-${ngP2(d.getMonth() + 1)}-${ngP2(d.getDate())} ${ngP2(d.getHours())}:${ngP2(d.getMinutes())}`; };
// Who downloads: the person's name as PPC History records it (a shared login's typed name), else the sign-in.
function ngWho() {
  try { const p = typeof ppchPerson === 'function' ? ppchPerson() : ''; if (p) return p; } catch (e) { /* no name */ }
  return String((typeof ME !== 'undefined' && ME && ME.email) || '');
}
const ngAcos = (sp, s) => (s > 0 ? Math.round(sp / s * 1000) / 10 : '');
const ngSum = (list, k) => list.reduce((t, c) => t + (c[k] || 0), 0);
const ngXm = v => ({ v: staR2(v || 0), f: 'money' });
const NG_XL_CP = ['Campaign', 'Campaign ID', 'Brand', 'Negate', 'Why', 'Spend', 'Clicks', 'Orders', 'Sales', 'ACoS %', 'Search terms', 'Top terms'];
const NG_XL_TERMS = ['Search term', 'Campaign', 'Ad group', 'Clicks', 'Spend', 'Orders', 'Sales', 'ACoS %', 'Search Term Analysis verdict'];
// The three sheets of one pattern: Campaigns (every campaign of its plan; Negate = ticked — in the dialog, what is ticked
// there), Search terms (every term behind it, listed one by one), Summary. picks: a Set of campaign IDs, or none for the
// plan's own ticks.
function ngPatternSheets(g, picks) {
  const min = NGS.min, P = ngPlan(g), all = ngPlanAll(P), nx = ngNext(g, min);
  const on = picks instanceof Set ? picks : new Set(P.neg.map(c => c.cid));
  const yes = c => c.can && on.has(c.cid);
  const top = cid => g.terms.filter(r => r.cid === cid).sort((a, z) => z.sp - a.sp).slice(0, 3).map(r => r.term).join(', ');
  const cps = all.map(c => [c.cn || '', String(c.cid), staBrandName(g.brand), yes(c) ? 'Yes' : 'No', ngCpWhy(c), staR2(c.sp), c.c || 0, c.o || 0, staR2(c.s || 0), ngAcos(c.sp, c.s), c.n || 0, top(c.cid)]);
  const picked = all.filter(yes);
  const terms = g.terms.slice().sort((a, z) => z.sp - a.sp);
  const tail = g.sp - terms.reduce((t, r) => t + r.sp, 0);
  return [
    { name: 'Campaigns', fmt: ['', '', '', '', '', 'money', '', '', 'money', 'pct', '', ''], total: true, rows: [NG_XL_CP].concat(cps,
      [['Total', '', '', `${picked.length} Yes`, `${all.length} campaign${all.length === 1 ? '' : 's'}`, staR2(ngSum(all, 'sp')), ngSum(all, 'c'), ngSum(all, 'o'), staR2(ngSum(all, 's')), ngAcos(ngSum(all, 'sp'), ngSum(all, 's')), ngSum(all, 'n'), '']]) },
    { name: 'Search terms', fmt: ['', '', '', '', 'money', '', 'money', 'pct', ''], total: true, rows: [NG_XL_TERMS].concat(
      terms.map(r => [r.term, r.cn || '', r.agn || '', r.c || 0, staR2(r.sp), r.o || 0, staR2(r.s || 0), ngAcos(r.sp, r.s), ((r.badges || [])[0] || [])[0] || '']),
      [['Total', `${terms.length} search term${terms.length === 1 ? '' : 's'}`, '', ngSum(terms, 'c'), staR2(ngSum(terms, 'sp')), ngSum(terms, 'o'), staR2(ngSum(terms, 's')), ngAcos(ngSum(terms, 'sp'), ngSum(terms, 's')), '']]) },
    { name: 'Summary', fmt: ['', ''], rows: [['Field', 'Value'],
      ['Pattern', g.term], ['Same search terms as', (g.same || []).join(', ')], ['Brand', staBrandName(g.brand)], ['Window', staWindowTxt(NGX.M)],
      ['Class', ngCls(g, min) === 'waste' ? NG_WK[g.wk] || 'Waste' : ngClsName(ngCls(g, min))], ['Reason', ngWhy(g, min)], ['Next step', nx.text],
      ['Search terms', g.n], ['Clicks', g.c], ['Spend', ngXm(g.sp)], ['Sales', ngXm(g.s)], ['Orders', g.o], ['ACoS %', g.acos != null ? { v: Math.round(g.acos * 10) / 10, f: 'pct' } : ''],
      ['Campaigns', all.length], ['Campaigns to negate', picked.length], ['Spend with no orders in them', ngXm(ngSum(picked, 'sp'))], ['Sales at risk', ngXm(ngSum(picked, 's'))],
      ['Small terms not listed one by one', g.tn ? `${staInt(g.tn)} (${staMoney(tail)})` : 'none'], ['Minimum clicks', min],
      ['Downloaded at', ngNow()], ['Downloaded by', ngWho()]] },
  ];
}
function ngXlsxPattern(g, picks) {
  const name = ngXlsxName(g);
  staXlsxSave(name, ngPatternSheets(g, picks));
  return name;
}
// The page's file, with the Waste filter or chip on: every Waste pattern on screen (after the filters, in the table's order)
// and each campaign it would be negated in.
const NG_XL_PAT = ['Pattern', 'Brand', 'Waste kind', 'Reason', 'No-order spend', 'Spend', 'Clicks', 'Orders', 'Campaigns to negate', 'Sales at risk'];
const NG_XL_WCP = ['Pattern', 'Campaign', 'Campaign ID', 'Spend', 'Clicks', 'Orders', 'Evidence'];
function ngWasteSheets(rows, f) {
  const W = rows.filter(g => ngCls(g, f.min) === 'waste');
  const negOf = g => (ngNext(g, f.min).act === 'neg' ? ngPlan(g).neg : []);
  const pats = W.map(g => { const neg = negOf(g); return [g.term, staBrandName(g.brand), NG_WK[g.wk] || 'Waste', ngWhy(g, f.min), staR2(ngSum(neg, 'sp')), staR2(g.sp), g.c, g.o, neg.length, staR2(ngSum(neg, 's'))]; });
  const cps = W.flatMap(g => negOf(g).map(c => [g.term, c.cn || '', String(c.cid), staR2(c.sp), c.c || 0, c.o || 0, c.ev]));
  const allNeg = W.flatMap(negOf);
  const nos = ngSum(allNeg, 'sp');
  return [
    { name: 'Patterns', fmt: ['', '', '', '', 'money', 'money', '', '', '', 'money'], total: true, rows: [NG_XL_PAT].concat(pats,
      [['Total', `${W.length} pattern${W.length === 1 ? '' : 's'}`, '', 'a search term counts once for every pattern it holds: spend and clicks overlap', staR2(nos), staR2(ngSum(W, 'sp')), ngSum(W, 'c'), ngSum(W, 'o'), allNeg.length, staR2(ngSum(allNeg, 's'))]]) },
    { name: 'Campaigns', fmt: ['', '', '', 'money', '', '', ''], total: true, rows: [NG_XL_WCP].concat(cps,
      [['Total', `${cps.length} campaign negative${cps.length === 1 ? '' : 's'}`, '', staR2(nos), ngSum(allNeg, 'c'), ngSum(allNeg, 'o'), '']]) },
    { name: 'Summary', fmt: ['', ''], rows: [['Field', 'Value'],
      ['Brand', f.brand === 'ALL' ? 'Both brands' : staBrandName(f.brand)], ['Pattern size', f.size ? `${f.size}-word` : 'All'], ['Minimum clicks', f.min],
      ['Classification', ngClsName(f.cls) || 'Every classification'], ['Protected only', f.prot ? 'Yes' : 'No'], ['Filter text', f.q || '—'], ['Window', staWindowTxt(NGX.M)],
      ['Waste patterns', W.length], ['No-order spend', ngXm(nos)], ['Spend (patterns overlap)', ngXm(ngSum(W, 'sp'))], ['Campaign negatives', allNeg.length], ['Sales at risk', ngXm(ngSum(allNeg, 's'))],
      ['Downloaded at', ngNow()], ['Downloaded by', ngWho()]] },
  ];
}
function ngXlsxWasteName(f) {
  const d = new Date();
  return staFileName(`N-Gram waste patterns - ${f.brand === 'ALL' ? 'Both brands' : staBrandName(f.brand)} - ${d.getFullYear()}-${ngP2(d.getMonth() + 1)}-${ngP2(d.getDate())}`) + '.xlsx';
}
function ngXlsxWaste() {
  const f = ngFilters();
  if (!NG_LAST.some(g => ngCls(g, f.min) === 'waste')) { $('ngFoot').innerHTML = '<span>No Waste pattern on screen to download.</span>'; $('ngFoot').classList.add('err'); return ''; }
  const name = ngXlsxWasteName(f);
  staXlsxSave(name, ngWasteSheets(NG_LAST, f));
  return name;
}

/* ---------- the legend ---------- */
function ngLegend() {
  const L = (h, items) => `<h4>${h}</h4><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  $('ngLegendBody').innerHTML = '<div class="sta-legcols"><div>'
    + L('How patterns are counted', [
      'Each search term splits into its 1-, 2- and 3-word sequences. A term counts once for every pattern it holds, so one term counts toward several patterns and the rows do not add up to the account.',
      'One-word patterns skip small words (a, the, for, set, inch…), words under 3 letters and numbers. Longer ones that start or end with a small word ("dish towels for") are left out: the pattern inside them is already there. Numbers inside are kept ("18 18 pillow").',
      `A pattern needs <b>${NG.MIN_TERMS} or more different search terms</b>. An n-gram held by one search term is not a pattern — it is left out here, and that term is judged on its own in Search Term Analysis.`,
      'N-grams held by exactly the same search terms are one row, named by the shortest ("same terms: …" lists the others): their figures are the same, and one negative phrase covers them all.',
      'Left out: ASIN searches (product pages), rows set aside as a data check, and search terms already blocked by a negative — at Amazon, or a review item that has been done.',
      'Terms too small to be listed one by one (under 3 clicks, no order) are added as the backend keeps them, by word.',
      'The window is Search Term Analysis\'s: settled clicks with 7-day sales when the settled report is there.'])
    + L('Classification', [
      `<b>Needs data</b>: fewer clicks than the Minimum clicks choice; or 0 orders that could still be chance — ${Math.round(NG.NEG_CHANCE * 100)}% or more at the brand's order rate over its search terms — or under ${staMoney(NG.NOSALE_MIN_SP)} spent. Shows about how many more clicks would tell.`,
      `<b>Waste</b>, in two kinds. <b>Waste · no sales</b>: 0 orders with under ${Math.round(NG.NEG_CHANCE * 100)}% chance of that and ${staMoney(NG.NOSALE_MIN_SP)}+ spent — and your blocked words and competitor brands (Lists & settings), at any spend. <b>Waste · over break-even</b>: ${NG.BE_ORDERS}+ orders above the break-even of its terms (weighted by their spend), or ACoS over ${NG.LOSS_ACOS}% with ${staMoney(NG.LOSS_MIN_SP)}+ spent, a loss even without unit costs. The Waste box and chip count both; the two small chips (and the Classification list) pick one.`,
      `<b>Winner</b>: ${NG.WIN_ORDERS}+ orders at or under the target of its terms (weighted by their spend).`,
      `<b>Mixed</b>: the rest — between target and break-even, or too few orders. Without unit costs or a target ACoS for a brand: "${STA_NOTGT}", as on Placement.`,
      'Without unit costs or a target ACoS for a brand, "above break-even" and Winner are off for it; set a target in Lists & settings to switch them on.',
      `<b>The luck cut-off</b>: 0 orders count only when that would happen by bad luck under ${Math.round(NG.NEG_CHANCE * 100)}% of the time — the same line as Search Term Analysis's negatives. Placement lowers an adjustment at under ${Math.round(STA.CHANCE * 100)}%. On purpose: a negative is harder to undo than a lower adjustment, so it needs more proof.`])
    + '</div><div>'
    + L('Protected — never negated', [
      '<b>Brand terms</b>, the other brand\'s brand terms (<b>Sister brand</b>: "ridhi" in Cotton Print Club, and the other way round — from each brand\'s Lists & settings), the brand\'s <b>product words</b> (what its ad groups sell, and your list), <b>main keywords</b> (your own keywords, or ' + STA.MAIN_ORDERS + '+ orders across the brand), <b>seasonal</b> words, and your own and sister-brand ASINs — the same lists and checks as Search Term Analysis.',
      'Protected is a flag, not a class: a pattern is Waste, Winner, Mixed or Needs data, and may be protected as well. "Protected only" shows just those.',
      'A protected Waste pattern gets no negative: "Lower bids instead" opens its terms in Search Term Analysis. A campaign where every one of its terms is protected is kept out of the plan.'])
    + L('What the actions do', [
      `<b>Negate in N campaigns</b> (Waste): one negative phrase at campaign level in each campaign where the pattern has no order <b>and the evidence is there in that campaign</b>: 0 orders with under ${Math.round(NG.NEG_CHANCE * 100)}% chance of that by luck — at the campaign's own order rate, or the brand's when the campaign has under ${STA.RATE_ORDERS} orders, as in Search Term Analysis — and ${staMoney(NG.NOSALE_MIN_SP)}+ spent there. Other campaigns show as "Kept: not enough data here", unticked; campaigns where it sells are kept. The button's count, the review list, the day's limit and the Excel file use the ticked campaigns. Your blocked words and competitor brands are negated in every campaign with no order, at any spend.`,
      `The dialog lists every campaign by spend with its evidence ("0 in 58 clicks · <0.1% chance") and what happens there. Search Term Analysis's own checks: sales at risk, already negated at Amazon, already in the review list, at most ${STA.NEG.negativePhrase.words} words, and the day's limit of ${STA.DAY_MAX} negatives per brand.`,
      '<b>Waste · over break-even</b> that sells in some campaigns: the negative goes where it never sold, and "Lower bids where it sells →" opens its terms in Search Term Analysis.',
      '<b>No-order spend</b>: a pattern\'s spend in the campaigns it would be negated in. The Waste view sorts by it, highest first: the patterns costing the most come first.',
      '<b>Download Excel</b> (the dialog, an opened row, and the toolbar in the Waste view): the pattern\'s campaigns, its search terms and a summary — or, from the toolbar, every Waste pattern on screen and each campaign it would be negated in.',
      `<b>Harvest best term</b> (Winner): the term with the lowest ACoS among those with ${NG.HARVEST_ORDERS}+ orders, within its target and without its own exact keyword yet — Search Term Analysis's "Add as exact" dialog (CPC +${Math.round(STA.STEP * 100)}%, under the ceiling; a manual keyword ad group of the same product).`,
      'A Waste pattern with no campaign left to negate (it sells everywhere it spends, it is protected there, already negated, in the review list, or the day\'s limit is reached) says which, with "Open in Search Term Analysis →".',
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
$('ngClass').addEventListener('change', () => { ngSetCls($('ngClass').value); ngRe(); });
$('ngSize').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  NGS.size = Number(b.dataset.n) || 0;
  ngRe();
});
$('ngBoxes').addEventListener('click', e => {
  const b = e.target.closest('[data-box]');
  if (!b) return;
  const k = b.dataset.box;
  ngSetCls(NGS.cls === k || (k === 'waste' && ngIsWaste(NGS.cls)) ? '' : k);
  ngRe();
});
$('ngActBar').addEventListener('click', e => {
  if (e.target.closest('[data-prot]')) { NGS.prot = !NGS.prot; ngRe(); return; }
  // The two kinds of Waste: one on, or back to every Waste row.
  const w = e.target.closest('[data-wk]');
  if (w) { ngSetCls(NGS.cls === w.dataset.wk ? 'waste' : w.dataset.wk); ngRe(); return; }
  const c = e.target.closest('[data-a]');
  if (!c) return;
  const k = c.dataset.a;
  ngSetCls(NGS.cls === k || (k === 'waste' && ngIsWaste(NGS.cls)) ? '' : k);
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
  if (e.target.closest('[data-staretry]')) { ensureNgram(); return; }
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
    else if (act.dataset.ngact === 'low' || act.dataset.ngact === 'st') ngToSt(g.brand, g.gram);
    else if (act.dataset.ngact === 'tgt') ngSetTarget(g.brand);
    return;
  }
  // The n-grams of a single search term the filter found: those terms in Search Term Analysis, by the same filter text.
  if (e.target.closest('button[data-ngst]')) { ngToSt($('ngBrand').value || 'ALL', $('ngFilter').value.trim()); return; }
  // An opened row's "Download Excel".
  const xl = e.target.closest('button[data-ngxl]');
  if (xl) { const g = ngOf(xl.dataset.ngxl); if (g) ngXlsxPattern(g); return; }
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
$('ngXlsx').addEventListener('click', ngXlsxWaste);
$('ngMsg').addEventListener('click', e => { if (e.target.closest('[data-settgt]')) ngSetTarget($('ngBrand').value); else if (e.target.closest('[data-staretry]')) ensureNgram(); });
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
