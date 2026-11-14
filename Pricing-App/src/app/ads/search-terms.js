/* ================= ADS · SEARCH TERM ANALYSIS: what shoppers typed, what it cost, what to do — and Campaign × Product =================
 * Screen: Search Term Analysis (tab 'st', pane paneSt; core/nav.js calls ensureSt when it opens). The tab was called
 * "Search Terms" until 14 Nov 2026; its key stays 'st' because permissions are stored under it.
 *
 * Layout, top to bottom:
 *   the bar        brand (stBrand), filter (stFilter), minimum spend (stMinSpend), Review list (stRlBtn), Export (stCsv),
 *                  and the data line (stMsg): which window the verdicts are judged on, and whether both brands arrived.
 *   four boxes     (stBoxes) Burning money, Worth scaling, Competing paths, Review list. A click opens that view.
 *   the view card  title (stTitle / stSub), the view switch (stViewSeg: burn / scale / paths / all / cp), the table (stTable),
 *                  the footer (stFoot). Burning money has its own switch (stBurnSeg: by search term / by target) and a
 *                  selection bar (stSelBar) for adding several negatives at once. All terms opens first.
 *   one dialog     (stDlg) for every change: Add negative, Raise / Reduce bid, Pause, Add as exact, Target this ASIN.
 *   the review list (stRl): the changes picked here, waiting → approved → downloaded as an Amazon bulk file → seen at Amazon.
 *
 * SELLORA CHANGES NOTHING AT AMAZON. Approved changes leave as a bulk file the user uploads in the Ads console
 * (Campaign manager → Bulk operations). When edit access is confirmed, the same review items will be applied by the
 * backend (route POST ?ads=act, AdsActions.gs, not written yet) — the item shape below is what it will read.
 *
 * Data: ST holds the three nightly caches read through baCall (search terms, targets, ad groups with their products) —
 * the Overview's recommendations may hand them over already loaded (ads-health.js share) — plus five optional caches
 * that switch parts on when the backend starts writing them:
 *   adEntities              Amazon's IDs, current bids, states and existing negatives (Pricing-API AdsEntities.gs).
 *                           Without it: current bids show "—", bid and pause changes wait in the review list, and the
 *                           "no negative yet" check can only look at the review list.
 *   stSettled / stRecent    search terms over days 8–37 and the last 7, with 7-day sales (Pricing-API AdsDecide.gs).
 *   tgtSettled / tgtRecent  the same for targets. Without them: verdicts are judged on the 30-day caches.
 * Break-even and target ACoS per ad group come from Overview's lines (ADSX.lines: Profit & Margin's unit costs and fee
 * model, weighted by the ad group's ad sales); FBA stock and pace from Campaign × Product's loader (cpLoadBasics).
 *
 * The review list is the Firestore collection adsActions/{id}. Until its rules are deployed (Ravi, firestore.rules),
 * a read is refused and the list is kept in this browser instead (localStorage 'staReview'), and the bar says so.
 *
 * Main functions: ensureSt, staModel (every verdict, once per load), renderSt and the view drawers (staDrawAll,
 * staDrawBurn, staDrawBurnTgt, staDrawScale, staDrawPaths), staOpen (the dialog), the review list (staRlLoad,
 * staRlSave, staRlDraw), the bulk file (staBulkRow, staXlsx, staDownload), and the Campaign × Product half below. */

/* ================= SEARCH TERMS =================
 *
 * Two lists that have to be read against each other: what shoppers TYPED (search terms) and what we
 * BID ON (targets). Amazon reports them separately and never joins them, so the join is here.
 *
 * A search term carries NO ASIN — Amazon reports it against the ad group it matched in, and an ad
 * group can advertise several products. So "product wise" goes through the ad group, and where a
 * group holds more than one ASIN the term belongs to all of them. It is shown that way rather than
 * picking one, because picking one would be a made-up answer that reads like a real one.
 *
 * A PATH is one way a search term reaches us: the campaign, ad group and keyword or target that caught it. The same
 * term can come through several paths — that is the Competing paths view. Bids belong to the path's keyword or target,
 * never to the search term, so a bid change moves every search term of that target.
 */
// The three caches (terms, tgts, ag, each per brand; at = when built; loaded once they are in) and the optional five
// (ent, set, rec, tset, trec; extra once asked for — each null when the backend has not written it).
let ST = { at: '', terms: {}, tgts: {}, ag: {}, loaded: false, extra: false,
  ent: null, set: null, rec: null, tset: null, trec: null, costs: true };
// ST_VIEW: burn / scale / paths / all / cp. ST_SUB: Burning money by 'term' or 'target'. ST_LAST: the rows of the last
// draw, for the export. ST_SHOW: rows drawn before "Show more". ST_SEL: the ticked rows of Burning money, by key.
let ST_VIEW = 'all', ST_SUB = 'term', ST_LAST = [], ST_SHOW = 100;
const ST_SEL = new Map();
let ST_FT = null;

/* THE LINES EVERY VERDICT IS DRAWN WITH. One place, so the dialog's explanations and the tables cannot disagree. */
const STA = {
  MIN_CLICKS: 10,      // clicks before "no order" is evidence at all (Campaign × Product's CP_MIN_CLICKS)
  CHANCE: 0.05,        // below this chance of 0 orders by bad luck, "unlikely to be chance"
  RATE_ORDERS: 3,      // orders a target or campaign needs before its own conversion rate is used
  SCALE_ORDERS: 3,     // orders before a raise is suggested
  SCALE_SHARE: 0.75,   // a raise needs ACoS at or under 75% of the target
  EXACT_ORDERS: 2,     // orders before "add as exact" is suggested for a term that is not its own keyword
  STEP: 0.20,          // a bid moves at most 20% a step, up or down
  MIN_BID: 0.02,       // Amazon's lowest Sponsored Products bid (USD)
  NOT_LIMIT: 3,        // a bid this many times the CPC is not what holds a term back
  COOLDOWN: 3,         // days to wait after a bid change before the next one
  RAISE_COVER: 30,     // days of FBA stock a raise needs
  TGT: 30, BE: 35,     // target and break-even ACoS % when the unit cost is not known (Overview's 25–35% range)
  PAGE: 100,           // rows drawn per "Show more"
  // Amazon's limits on keyword text: a negative exact up to 10 words, a negative phrase up to 4; 80 characters each.
  NEG: { negativeExact: { words: 10, chars: 80, t: 'Negative exact' }, negativePhrase: { words: 4, chars: 80, t: 'Negative phrase' } },
  KW: { words: 10, chars: 80 },
};
// The columns of Amazon's Sponsored Products bulk sheet that an upload uses (the same headers as Amazon's blank
// template, without its "Informational only" and performance columns). If Amazon ever rejects the headers, this is the
// one list to change.
const STA_BULK_COLS = ['Product', 'Entity', 'Operation', 'Campaign ID', 'Ad Group ID', 'Portfolio ID', 'Ad ID', 'Keyword ID',
  'Product Targeting ID', 'Campaign Name', 'Ad Group Name', 'Start Date', 'End Date', 'Targeting Type', 'State', 'Daily Budget',
  'SKU', 'Ad Group Default Bid', 'Bid', 'Keyword Text', 'Native Language Keyword', 'Native Language Locale', 'Match Type',
  'Bidding Strategy', 'Placement', 'Percentage', 'Product Targeting Expression'];

/* ---------- small helpers ---------- */
const staEsc = s => String(s == null ? '' : s)
  .replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const staMoney = v => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const staMoney0 = v => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
const staPct = v => v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%';
const staInt = v => (Number(v) || 0).toLocaleString('en-US');
const staLow = s => String(s || '').toLowerCase().trim();
const staIsAsin = t => /^b0[a-z0-9]{8}$/i.test(String(t || '').trim());
const staDash = '<span class="sta-dash">—</span>';
const staBadge = (t, k, tip) => `<span class="ui-badge${k ? ' is-' + k : ''}"${tip ? ` title="${staEsc(tip)}"` : ''}>${staEsc(t)}</span>`;
const staBtn = (t, act, key, cls) => `<button type="button" class="sta-btn${cls ? ' ' + cls : ''}" data-act="${act}" data-k="${staEsc(key)}">${staEsc(t)}</button>`;
const staCan = t => ME.admin || (ME.tabs || []).includes(t);
const staKwMt = mt => /^(BROAD|PHRASE|EXACT)$/i.test(mt || '');
const staAutoMt = mt => /PREDEFINED/i.test(mt || '');
const staBrandName = b => (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[b]) || b;
const staR2 = v => Math.round(v * 100) / 100;
const staDay = ms => ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
// "yyyy-MM-dd HH:mm" as the backend writes it (script time zone, India) → ms; 0 when it cannot be read.
const staStamp = s => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? Date.parse(m[1] + 'T' + m[2] + ':00+05:30') || 0 : 0;
};

// Write the data line under the toolbar (HTML allowed); bad = true shows it in red.
function stMsg(t, bad) {
  const m = $('stMsg');
  m.innerHTML = t || '';
  m.classList.toggle('err', !!bad);
}
// Write the footer under the table (HTML allowed); bad = true shows it in red.
function stFoot(t, bad) {
  const m = $('stFoot');
  m.innerHTML = t || '';
  m.classList.toggle('err', !!bad);
}

// The words a target is shown with: "tablecloth (broad)", "Auto · close-match", 'asin="B0…"'.
function staPathLabel(kw, mt) {
  const M = String(mt || '').toUpperCase();
  if (staKwMt(M)) return `${kw || '—'} (${M.toLowerCase()})`;
  if (staAutoMt(M)) return 'Auto · ' + (kw || 'target not reported');
  return kw || 'Target not reported';
}

/* ---------- loading ---------- */

// Called when the tab opens: the three caches (unless the Overview already handed them over), the five optional ones,
// the stock / sales / costs the break-even needs, and the review list — all at the same time — then draw.
async function ensureSt() {
  if (!ST.loaded || !ST.extra) {
    stMsg('Loading the search terms, targets, ad groups and the review list…');
    $('stTable').innerHTML = '';
    stFoot('');
    // Each cache ONCE, all at the same time (2026-10-03: "ye bahut hang ho rha h"). A cache the backend has not
    // written yet answers "nothing cached" — that is null here, not an error.
    const grab = async name => {
      try {
        const r = await baCall({ cache: name });
        return (r && r.data) || null;
      } catch (e) { return null; }
    };
    const jobs = [];
    if (!ST.loaded) {
      jobs.push(Promise.all([grab('srchTerm'), grab('targeting'), grab('adGroup')]).then(([t, g, a]) => {
        ST.terms = (t && t.d) || {};
        ST.tgts = (g && g.d) || {};
        ST.ag = (a && a.d) || {};
        ST.at = (t && t.at) || '';
        ST.loaded = true;
      }));
    }
    if (!ST.extra) {
      const ok = x => (x && x.d ? x : null);
      jobs.push(Promise.all(['adEntities', 'stSettled', 'stRecent', 'tgtSettled', 'tgtRecent'].map(grab)).then(([e, s, r, ts, tr]) => {
        ST.ent = ok(e);
        ST.set = ok(s);
        ST.rec = ok(r);
        ST.tset = ok(ts);
        ST.trec = ok(tr);
        ST.extra = true;
        Object.keys(STA_ENTX).forEach(k => delete STA_ENTX[k]);
      }));
      jobs.push(cpLoadBasics().catch(() => { /* break-even and stock stay unknown */ }));
      jobs.push(staRlLoad());
    }
    await Promise.all(jobs);
    await staRlSeen();
    ST.costs = Object.keys(COST || {}).length > 0;
    STM = null;
  }
  renderSt();
}

/* ---------- the figures each verdict is drawn from ---------- */

// The search terms of one brand to judge on: the settled window when the backend writes it, else the 30-day cache.
function staTermsOf(b) {
  const s = ST.set && ST.set.d && ST.set.d[b];
  if (s && s.rows) return Object.assign({ settled: true }, s);
  return Object.assign({ settled: false }, ST.terms[b] || {});
}
// The same for targets.
function staTgtsOf(b) {
  const s = ST.tset && ST.tset.d && ST.tset.d[b];
  if (s && s.rows) return Object.assign({ settled: true }, s);
  return Object.assign({ settled: false }, ST.tgts[b] || {});
}
// The last 7 days of one brand, by 'ag|term' (or 'ag|target|match' for targets) → { c, sp, o, s }. Empty without stRecent.
function staRecentOf(b, tgt) {
  const src = tgt ? ST.trec : ST.rec;
  const rows = (src && src.d && src.d[b] && src.d[b].rows) || [];
  const m = new Map();
  rows.forEach(x => m.set(tgt ? x.ag + '|' + staLow(x.t) + '|' + staLow(x.mt) : x.ag + '|' + staLow(x.t), x));
  return m;
}
// A campaign's or ad group's name, from whichever cache knows it.
function staName(b, id) {
  if (!id) return '';
  const look = [ST.set && ST.set.d && ST.set.d[b], ST.terms[b], ST.tset && ST.tset.d && ST.tset.d[b], ST.tgts[b], ST.ag[b]];
  for (const p of look) {
    const n = p && p.names && p.names[id];
    if (n) return n;
  }
  const E = ST.ent && ST.ent.d && ST.ent.d[b];
  if (E) {
    if (E.cp && E.cp[id]) return E.cp[id][0] || '';
    if (E.ag && E.ag[id]) return E.ag[id][1] || '';
  }
  return '';
}

/** The products behind an ad group, with their parents. A list, because a group can hold several. */
// { asins, parents } advertised in one ad group of one brand; both empty when the group is unknown.
function stProductsOf(brand, agId) {
  const pack = ST.ag[brand] || {};
  const g = (pack.groups || {})[agId];
  if (!g || !g.a || !g.a.length) return { asins: [], parents: [] };
  const pmap = pack.parent || {};
  const parents = [...new Set(g.a.map(a => pmap[a] || '').filter(Boolean))];
  return { asins: g.a, parents };
}

/* AMAZON'S OWN RECORD (adEntities): keywords, targets, negatives, campaigns and ad groups with their IDs and bids, as
 * read from Amazon's lists by AdsEntities.gs. Indexed once per load and brand. */
const STA_ENTX = {};
// { kw, tg, neg, negPh, cp, ag, at } for one brand, or null when adEntities has nothing for it.
function staEnt(b) {
  if (b in STA_ENTX) return STA_ENTX[b];
  const E = ST.ent && ST.ent.d && ST.ent.d[b];
  if (!E || !E.kw) return (STA_ENTX[b] = null);
  const kw = new Map(), tg = new Map(), neg = new Set(), negPh = [];
  (E.kw || []).forEach(k => kw.set(k[1] + '|' + staLow(k[3]) + '|' + staLow(k[4]), { id: String(k[0]), ag: k[1], cid: k[2], bid: k[5], st: k[6], kind: 'kw' }));
  (E.tg || []).forEach(t => tg.set(t[1] + '|' + staLow(t[3]), { id: String(t[0]), ag: t[1], cid: t[2], bid: t[4], st: t[5], kind: 'tg' }));
  // A negative, by where it sits ('cp|campaign' or 'ag|ad group'), its text and its kind (nx exact, np phrase, na ASIN).
  (E.neg || []).forEach(n => {
    const kind = /PHRASE/i.test(n[5]) ? 'np' : /EXACT/i.test(n[5]) ? 'nx' : 'na';
    const where = n[0] === 'cp' ? 'cp|' + n[2] : 'ag|' + n[3];
    neg.add(where + '|' + staLow(n[4]) + '|' + kind);
    if (kind === 'np') negPh.push({ where, text: staLow(n[4]) });
  });
  return (STA_ENTX[b] = { kw, tg, neg, negPh, cp: E.cp || {}, ag: E.ag || {}, at: E.at || (ST.ent && ST.ent.at) || '' });
}
// The keyword or target behind a path at Amazon: { id, bid, st, kind } with the ad group's default bid when the
// keyword has none of its own; null when adEntities does not know it.
function staEntOf(b, ag, kw, mt) {
  const E = staEnt(b);
  if (!E) return null;
  const hit = staKwMt(mt) ? E.kw.get(ag + '|' + staLow(kw) + '|' + staLow(mt)) : E.tg.get(ag + '|' + staLow(kw));
  if (!hit) return null;
  const out = Object.assign({}, hit);
  if (!(out.bid > 0)) {
    const g = E.ag[ag];
    out.bid = g && g[2] > 0 ? g[2] : null;
  }
  return out;
}
// Is there already a negative for this term at Amazon, where a new one would go? where = 'cp|campaignId' or 'ag|adGroupId'.
function staNegAtAmazon(b, where, term, kind) {
  const E = staEnt(b);
  if (!E) return null;   // not known
  const t = staLow(term);
  if (kind === 'na') return E.neg.has(where + '|asin="' + t + '"|na');
  if (E.neg.has(where + '|' + t + '|nx') && kind === 'nx') return true;
  // A phrase negative blocks every term holding its words in that order.
  const words = ' ' + t + ' ';
  return E.negPh.some(p => p.where === where && words.includes(' ' + p.text + ' '));
}

/* ---------- the model: every verdict, worked out once per load, brand and review-list change ---------- */
let STM = null;

// Every row of the screen for the brand picked: rows (one per term and path, with its verdict), tgtRows (Burning money
// by target), groups (Competing paths), byKey (key → row, for the buttons), and the per-brand figures behind them.
function staModel() {
  const pick = $('stBrand').value;
  const key = pick + '|' + ST_RL.stamp;
  if (STM && STM.key === key) return STM;
  const brands = pick === 'ALL' ? ['SP', 'CPC'] : [pick];
  const M = { key, brands, rows: [], tgtRows: [], groups: [], byKey: new Map(), settled: false, have: {} };
  try { ADSX.paceFresh(); } catch (e) { /* Overview's lines are not there: defaults below */ }
  const lineOf = a => {
    try { return ADSX.lines(a); } catch (e) { return null; }
  };
  const rlOpen = staRlIndex();
  brands.forEach(b => staModelBrand(b, M, lineOf, rlOpen));
  STM = M;
  return M;
}

// One brand's share of the model (see staModel).
function staModelBrand(b, M, lineOf, rlOpen) {
  const src = staTermsOf(b), tsrc = staTgtsOf(b);
  const terms = src.rows || [], tgts = tsrc.rows || [];
  M.have[b] = { terms: terms.length, tgts: tgts.length, ag: ((ST.ag[b] || {}).rows || []).length, settled: src.settled,
    from: src.from || '', to: src.to || '', dropped: src.dropped || 0, dropSpend: src.dropSpend || 0, minClicks: src.minClicks || 3 };
  if (src.settled) M.settled = true;
  if (!terms.length && !tgts.length) return;
  const rec = staRecentOf(b, false), trec = staRecentOf(b, true);

  // --- targets: by path, per campaign, the brand, what kind of ad group each one is ---
  const tIdx = new Map(), tIdx2 = new Map(), cAgg = new Map(), bAgg = { c: 0, o: 0 };
  const kwAg = new Set(), ptAg = new Set(), autoCp = new Set(), exactBy = new Map(), ptBy = new Map();
  const addAgg = (m, k, x) => {
    const a = m.get(k) || { c: 0, o: 0, sp: 0, s: 0 };
    a.c += x.c || 0; a.o += x.o || 0; a.sp += x.sp || 0; a.s += x.s || 0;
    m.set(k, a);
  };
  tgts.forEach(x => {
    const t = staLow(x.t);
    tIdx.set(x.ag + '|' + t + '|' + staLow(x.mt), x);
    addAgg(tIdx2, x.ag + '|' + t, x);
    addAgg(cAgg, x.cid, x);
    bAgg.c += x.c || 0; bAgg.o += x.o || 0;
    if (staKwMt(x.mt)) kwAg.add(x.ag);
    if (staAutoMt(x.mt)) autoCp.add(x.cid);
    if (/^asin=/i.test(t) && !staAutoMt(x.mt)) ptAg.add(x.ag);
    if (/^EXACT$/i.test(x.mt)) (exactBy.get(t) || exactBy.set(t, []).get(t)).push(x);
    const am = /^asin="?([a-z0-9]{10})"?$/i.exec(t);
    if (am) (ptBy.get(am[1].toLowerCase()) || ptBy.set(am[1].toLowerCase(), []).get(am[1].toLowerCase())).push(x);
  });
  terms.forEach(x => { if (staAutoMt(x.mt)) autoCp.add(x.cid); });
  if (!tgts.length) terms.forEach(x => { addAgg(cAgg, x.cid, x); bAgg.c += x.c || 0; bAgg.o += x.o || 0; });
  const E = staEnt(b);
  if (E) {
    Object.keys(E.cp).forEach(cid => { if (/AUTO/i.test(E.cp[cid][7] || '')) autoCp.add(cid); });
    E.kw.forEach(k => {
      if (/^(ENABLED|PAUSED)$/i.test(k.st || 'ENABLED')) kwAg.add(k.ag);
    });
    E.kw.forEach((k, key) => {
      const parts = key.split('|');
      if (parts[2] === 'exact' && !/ARCHIVED/i.test(k.st || '')) {
        const t = parts[1];
        const list = exactBy.get(t) || exactBy.set(t, []).get(t);
        if (!list.some(y => y.ag === k.ag)) list.push({ ag: k.ag, cid: k.cid, t, mt: 'EXACT', c: 0, o: 0, sp: 0, s: 0 });
      }
    });
  }

  // --- break-even and target per ad group, from its products' unit costs, weighted by their ad sales ---
  const agRows = new Map();
  ((ST.ag[b] || {}).rows || []).forEach(x => (agRows.get(x.ag) || agRows.set(x.ag, []).get(x.ag)).push(x));
  const linesMemo = new Map();
  const agLines = ag => {
    if (linesMemo.has(ag)) return linesMemo.get(ag);
    const list = agRows.get(ag) || [];
    let w = 0, tw = 0, bw = 0, cover = null;
    const stock = CP.stock[b];
    list.forEach(x => {
      const ln = lineOf(x.a);
      if (ln && ln.tgt != null) {
        const wt = (x.s || 0) + (x.sp || 0) * 0.01 + 0.001;   // ad sales, and a little spend so a group with none still counts
        w += wt; tw += wt * ln.tgt; bw += wt * ln.be;
      }
      const st = stock && x.sku && Object.prototype.hasOwnProperty.call(stock, x.sku) ? Number(stock[x.sku]) || 0 : null;
      if (st != null && ln && ln.perDay > 0) {
        const cv = st / ln.perDay;
        cover = cover == null ? cv : Math.min(cover, cv);
      }
    });
    const out = w > 0 ? { tgt: tw / w, be: bw / w, known: true, cover }
      : { tgt: STA.TGT, be: STA.BE, known: false, cover };
    linesMemo.set(ag, out);
    return out;
  };

  // --- protected: brand words and own ASINs are never negated ---
  const ownAsins = new Set();
  ['SP', 'CPC'].forEach(x => ((ST.ag[x] || {}).rows || []).forEach(r => r.a && ownAsins.add(String(r.a).toLowerCase())));
  Object.keys((typeof WEEKLY !== 'undefined' && WEEKLY.rows) || {}).forEach(a => ownAsins.add(a.toLowerCase()));
  const brandTerms = new Set(['ridhi']);
  tgts.forEach(x => {
    if (/brand/i.test(staName(b, x.cid)) && staKwMt(x.mt)) brandTerms.add(staLow(x.t));
  });
  M.protect = M.protect || {};
  M.protect[b] = { ownAsins, brandTerms };

  // --- one row per search term and path ---
  const mine = [];
  terms.forEach(x => {
    const term = String(x.t || ''), tl = staLow(term);
    const kw = x.kw || '', mt = x.mt || '';
    const r7 = rec.get(x.ag + '|' + tl) || null;
    const tr = tIdx.get(x.ag + '|' + staLow(kw) + '|' + staLow(mt)) || tIdx2.get(x.ag + '|' + staLow(kw)) || null;
    const ln = agLines(x.ag);
    const p = stProductsOf(b, x.ag);
    const row = {
      key: 't:' + b + '|' + x.ag + '|' + tl, type: 'term', brand: b, term, tl, kw, mt, ag: x.ag, cid: x.cid,
      cn: staName(b, x.cid), agn: staName(b, x.ag), i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0,
      r7, tr, ln, asins: p.asins, parents: p.parents, auto: autoCp.has(x.cid), asin: staIsAsin(term), kid: x.kid || '',
    };
    row.acos = row.s > 0 ? row.sp / row.s * 100 : null;
    row.cpc = row.c > 0 ? row.sp / row.c : null;
    row.own = (/^EXACT$/i.test(mt) && staLow(kw) === tl) || (row.asin && /^asin=/i.test(staLow(kw)) && staLow(kw).includes(tl));
    row.ent = staEntOf(b, x.ag, kw, mt);
    row.pathKey = 'p:' + b + '|' + x.ag + '|' + staLow(kw) + '|' + staLow(mt);
    // The conversion rate this term is held to: its target's, else its campaign's, else the brand's.
    const ca = cAgg.get(x.cid);
    row.rate = tr && tr.o >= STA.RATE_ORDERS && tr.c > 0 ? { p: tr.o / tr.c, w: 'its target' }
      : ca && ca.o >= STA.RATE_ORDERS && ca.c > 0 ? { p: ca.o / ca.c, w: 'its campaign' }
        : bAgg.o > 0 && bAgg.c > 0 ? { p: bAgg.o / bAgg.c, w: 'the brand' } : null;
    row.chance = row.rate ? Math.pow(1 - row.rate.p, row.c) : null;
    row.tgtAcos = tr && tr.s > 0 ? tr.sp / tr.s * 100 : null;
    row.exactElsewhere = (exactBy.get(tl) || []).filter(y => y.ag !== x.ag);
    row.ptElsewhere = row.asin ? (ptBy.get(tl) || []).filter(y => y.ag !== x.ag) : [];
    row.rl = rlOpen.get(row.key) || null;
    row.rlPath = rlOpen.get(row.pathKey) || null;
    row.negated = staTermNegated(b, row, rlOpen);
    row.hay = (term + ' ' + kw + ' ' + row.cn + ' ' + row.agn + ' ' + p.asins.join(' ') + ' ' + p.parents.join(' ')).toLowerCase();
    mine.push(row);
  });

  // --- competing paths: the same term through two or more ad groups of this brand ---
  const byTerm = new Map();
  mine.forEach(r => { if (r.sp > 0 || r.o > 0) (byTerm.get(r.tl) || byTerm.set(r.tl, []).get(r.tl)).push(r); });
  byTerm.forEach((list, tl) => {
    if (list.length < 2) return;
    const ranked = list.slice().sort((p, q) => (q.o - p.o) || ((p.acos == null ? 1e9 : p.acos) - (q.acos == null ? 1e9 : q.acos)) || (q.c - p.c));
    const lead = ranked[0];
    if (!(lead.o > 0)) return;
    const la = lead.sp / lead.s;   // the lead path's ACoS, as a fraction
    let excess = 0;
    ranked.slice(1).forEach(r => {
      // A path already negated is stopped: what it spent is history, not overlap still running.
      r.excess = r.negated ? 0 : Math.max(0, r.sp - r.s * la);
      excess += r.excess;
    });
    if (!(excess > 0.005)) return;
    const g = { key: 'g:' + b + '|' + tl, brand: b, term: lead.term, tl, lead, paths: ranked, excess,
      campaigns: new Set(ranked.map(r => r.cid)).size };
    lead.role = 'lead';
    lead.group = g;
    ranked.slice(1).forEach(r => {
      r.role = 'other';
      r.group = g;
      r.leadAcos = la * 100;
      // Where the negative goes: the campaign, unless the lead path is in the same campaign (it would block that too).
      r.pathLevel = r.cid === lead.cid || r.asin ? 'ag' : 'cp';
      r.dupExact = r.own;   // the term is its own exact keyword here too: a duplicate keyword, paused rather than negated
    });
    M.groups.push(g);
  });

  // --- the verdict of each row ---
  mine.forEach(r => {
    staVerdict(r);
    M.rows.push(r);
    M.byKey.set(r.key, r);
  });

  // --- Burning money by target: the keywords and targets themselves ---
  tgts.forEach(x => {
    if (!(x.sp > 0) || (x.c || 0) < STA.MIN_CLICKS) return;
    const ln = agLines(x.ag);
    const acos = x.s > 0 ? x.sp / x.s * 100 : null;
    const ca = cAgg.get(x.cid);
    const rate = ca && ca.o >= STA.RATE_ORDERS ? { p: ca.o / ca.c, w: 'its campaign' } : bAgg.o > 0 ? { p: bAgg.o / bAgg.c, w: 'the brand' } : null;
    const noSale = !(x.o > 0);
    if (!noSale && !(acos > ln.be)) return;
    const r = {
      key: 'g:' + b + '|' + x.ag + '|' + staLow(x.t) + '|' + staLow(x.mt), type: 'target', brand: b, term: x.t, kw: x.t, mt: x.mt,
      ag: x.ag, cid: x.cid, cn: staName(b, x.cid), agn: staName(b, x.ag), i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0,
      acos, cpc: x.c > 0 ? x.sp / x.c : null, ln, rate, auto: autoCp.has(x.cid), kid: x.kid || '',
      r7: trec.get(x.ag + '|' + staLow(x.t) + '|' + staLow(x.mt)) || null,
    };
    r.pathKey = 'p:' + b + '|' + x.ag + '|' + staLow(x.t) + '|' + staLow(x.mt);
    r.ent = staEntOf(b, x.ag, x.t, x.mt);
    r.tgtAcos = acos;
    r.chance = rate ? Math.pow(1 - rate.p, r.c) : null;
    r.rl = rlOpen.get(r.pathKey) || null;
    r.paused = r.ent && /PAUSED|ARCHIVED/i.test(r.ent.st || '');
    r.hay = (x.t + ' ' + r.cn + ' ' + r.agn).toLowerCase();
    if (noSale) {
      r.burned = r.sp;
      r.kind = 'none';
      r.next = r.chance != null && r.chance < STA.CHANCE ? 'pause' : 'reduce';
    } else {
      r.burned = r.sp - r.s * ln.be / 100;
      r.kind = 'be';
      r.next = 'reduce';
    }
    if (r.paused || r.rl) r.next = null;
    M.tgtRows.push(r);
    M.byKey.set(r.key, r);
  });

  // --- what the dialog needs: the ad groups a new exact keyword or ASIN target can go into ---
  M.dest = M.dest || {};
  M.dest[b] = { kwAg, ptAg, agRows };
}

// Is this term already negated where it ran — at Amazon (adEntities) or by a review item that has been done?
function staTermNegated(b, r, rlOpen) {
  const done = rlOpen.get('done:' + r.key);
  if (done) return 'Negative added ' + staDay(done.exportedAt || done.at);
  const kind = r.asin ? 'na' : 'nx';
  if (staNegAtAmazon(b, 'cp|' + r.cid, r.term, kind) || staNegAtAmazon(b, 'ag|' + r.ag, r.term, kind)) return 'Negative at Amazon';
  return '';
}

/* THE VERDICT of one search term on one path: its badges, the money it burned, the evidence, and the one next step.
 * In order: queued or negated already → no sales → above break-even → a weaker competing path → worth scaling. */
function staVerdict(r) {
  const ln = r.ln, b = [];
  r.badges = b;
  r.next = null;
  r.cat = '';
  r.burned = 0;
  const chancePct = r.chance != null ? (r.chance * 100).toFixed(1) + '%' : '';
  // --- no sales ---
  if (!(r.o > 0)) {
    if (r.c < STA.MIN_CLICKS) {
      b.push(['Too few clicks', '', `${r.c} click${r.c === 1 ? '' : 's'} and no order: not enough to judge (${STA.MIN_CLICKS} needed).`]);
    } else {
      r.cat = 'burn';
      r.kind = 'none';
      r.burned = r.sp;
      b.push(['No sales', 'bad']);
      const sure = r.chance != null && r.chance < STA.CHANCE;
      if (!sure) b.push(['Could be chance', '', 'With this few clicks, no order can still be bad luck.']);
      r.ev = r.rate
        ? `0 orders in <b>${staInt(r.c)} clicks</b> · ${chancePct} chance of that if it converted like ${r.rate.w} (${(r.rate.p * 100).toFixed(1)}%)`
          + (sure ? ', <b>unlikely to be chance</b>' : ', so it <b>could still be chance</b>')
        : `0 orders in <b>${staInt(r.c)} clicks</b> · nothing in this brand has sold yet to compare with`;
      r.next = 'neg';
    }
  } else if (r.acos > ln.be && r.c >= STA.MIN_CLICKS) {
    // --- sells, but above break-even ---
    r.cat = 'burn';
    r.kind = 'be';
    r.burned = Math.max(0, r.sp - r.s * ln.be / 100);
    b.push(['Above break-even', 'bad']);
    r.ev = `ACoS <b>${staPct(r.acos)}</b> vs break-even ${staPct(ln.be)} (target ${staPct(ln.tgt)})`
      + (ln.known ? '' : ' — no unit cost in Profit &amp; Margin, so the default range is used')
      + `: spent ${staMoney(r.burned)} more than break-even allows`;
    // The bid belongs to the target: lower it only when the target as a whole is over target; otherwise this one term is
    // the problem, and a negative stops it without touching the terms that sell.
    if (r.role === 'other') {
      // It sells better through another path: a negative here sends it there, and leaves this target's other terms alone.
      r.next = 'neg';
      r.ev += `. It sells at ${staPct(r.leadAcos)} through ${staEsc(r.group.lead.cn)}, so a negative here sends it there`;
    } else {
      r.next = r.tgtAcos != null && r.tgtAcos > ln.tgt && r.kw ? 'reduce' : 'neg';
      if (r.next === 'neg') r.ev += `. Its target sells at ${staPct(r.tgtAcos)} overall, so a negative for this term is safer than a lower bid`;
    }
  } else if (r.acos > ln.tgt) {
    b.push(['Over target', 'warn', `ACoS ${staPct(r.acos)} is between the target ${staPct(ln.tgt)} and break-even ${staPct(ln.be)}: it pays its costs, not its share of overhead and salary.`]);
  } else {
    b.push([r.o >= STA.SCALE_ORDERS ? 'Winner' : 'Selling', 'ok']);
  }
  // --- a weaker path of a competing term ---
  if (!r.cat && r.role === 'other' && r.excess > 0.005) {
    r.cat = 'paths';
    r.next = r.dupExact ? 'pause' : 'neg';
  }
  if (r.role) b.push([r.role === 'lead' ? 'Lead path' : 'Competing path', 'info', r.role === 'lead'
    ? 'Of the paths this term comes through, this one brings the most orders.'
    : `This term also comes through another path that sells it at ${staPct(r.leadAcos)} ACoS.`]);
  // --- worth scaling ---
  if (!r.cat && r.o > 0 && r.acos != null && r.acos <= ln.tgt) {
    if (r.own && r.o >= STA.SCALE_ORDERS && r.acos <= ln.tgt * STA.SCALE_SHARE) {
      r.cat = 'scale';
      r.scaleKind = 'raise';
      b.push(['Room to grow', 'ok', `ACoS ${staPct(r.acos)} is at or under ${Math.round(STA.SCALE_SHARE * 100)}% of the target ${staPct(ln.tgt)}.`]);
      r.ceil = r.cpc * ln.tgt / r.acos;
      const bid = r.ent && r.ent.bid;
      if (bid > 0 && r.cpc > 0 && bid >= r.cpc * STA.NOT_LIMIT) r.next = 'limit';
      else if (ln.cover != null && ln.cover < STA.RAISE_COVER) r.next = 'lowstock';
      else {
        r.next = 'raise';
        if (bid > 0) r.sugBid = Math.max(STA.MIN_BID, staR2(bid * Math.min(1 + STA.STEP, ln.tgt / r.acos)));
      }
    } else if (!r.own && r.o >= STA.EXACT_ORDERS && !r.exactElsewhere.length && !r.ptElsewhere.length) {
      r.cat = 'scale';
      r.scaleKind = r.asin ? 'asinT' : 'exact';
      b.push([r.asin ? 'Not its own target' : 'Not its own keyword', 'info',
        r.asin ? 'No product target for this ASIN yet.' : 'No exact keyword for this term in this brand yet.']);
      r.ceil = r.cpc * ln.tgt / r.acos;
      r.sugBid = Math.max(STA.MIN_BID, staR2(Math.min(r.cpc * (1 + STA.STEP), r.ceil)));
      r.next = r.scaleKind;
    }
  }
  if (!r.own && (r.exactElsewhere.length || r.ptElsewhere.length) && !r.role) b.push(['Promoted', 'ok', 'It already has its own exact keyword or product target in this brand.']);
  // --- already queued, or already negated: nothing more to do ---
  if (r.negated) {
    // Already stopped at Amazon: shown in All terms, left out of what is still burning, scaling or competing.
    r.status = 'Negated';
    r.next = null;
    r.cat = '';
  } else if (r.rl || (r.rlPath && /^(reduce|raise|pause)$/.test(r.next || ''))) {
    r.status = 'In review';
  } else if (!r.own && (r.exactElsewhere.length || r.ptElsewhere.length)) {
    r.status = 'Promoted';
  } else {
    r.status = 'Active';
  }
}

/* ---------- filtering ---------- */

// The text filter and the minimum spend, as one test for a row.
function staPass() {
  const q = $('stFilter').value.trim().toLowerCase();
  const minSp = Number($('stMinSpend').value) || 0;
  return r => (!minSp || r.sp >= minSp) && (!q || r.hay.includes(q));
}
// What each view lists, after the filters: all, burn (by term), burnTgt, scale, paths (groups with at least one path left).
function staLists() {
  const M = staModel(), ok = staPass();
  const all = M.rows.filter(ok);
  const groups = M.groups.map(g => Object.assign({}, g, { shown: g.paths.filter(ok) }))
    .filter(g => g.shown.length && g.shown.some(r => r.role === 'other'));
  return {
    M, all,
    burn: all.filter(r => r.cat === 'burn').sort((p, q) => q.burned - p.burned || q.sp - p.sp),
    burnTgt: M.tgtRows.filter(ok).sort((p, q) => q.burned - p.burned || q.sp - p.sp),
    scale: all.filter(r => r.cat === 'scale').sort((p, q) => (q.s - p.s) || (q.o - p.o)),
    groups: groups.sort((p, q) => q.excess - p.excess),
  };
}

/* ---------- drawing ---------- */

// Draw the whole screen: data line, boxes, the view's title and table, the footer and the selection bar.
function renderSt() {
  const isCp = ST_VIEW === 'cp';
  $('stViewSeg').querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x.dataset.v === ST_VIEW));
  $('stBurnSeg').classList.toggle('hide', ST_VIEW !== 'burn');
  $('stBurnSeg').querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x.dataset.s === ST_SUB));
  $('stCpShow').classList.toggle('hide', !isCp);
  $('stCpTarget').classList.toggle('hide', !isCp);
  staRlBadge();
  // --- nothing collected yet ---
  const haveAny = ['SP', 'CPC'].some(b => ((ST.terms[b] || {}).rows || []).length || ((ST.tgts[b] || {}).rows || []).length
    || (ST.set && ST.set.d && ST.set.d[b]));
  if (!haveAny && !isCp) {
    $('stBoxes').innerHTML = '';
    $('stTable').innerHTML = '';
    $('stTitle').textContent = 'No search terms yet';
    $('stSub').textContent = '';
    stMsg('The nightly run has not collected any search-term data yet. It asks Amazon for these reports overnight and picks '
      + 'them up on a later wake-up, so they appear the morning after the first run that includes them.', true);
    stFoot('');
    staSelBar();
    return;
  }
  const L = staLists();
  staDataLine(L.M);
  staBoxes(L);
  if (isCp) {
    $('stTitle').textContent = 'Which campaign × product is working?';
    $('stSub').textContent = 'One row per campaign, ad group and SKU over 30 days, with whether the ad runs, its FBA stock and a verdict. Advice only.';
    renderCp();
  } else if (ST_VIEW === 'burn' && ST_SUB === 'target') staDrawBurnTgt(L);
  else if (ST_VIEW === 'burn') staDrawBurn(L);
  else if (ST_VIEW === 'scale') staDrawScale(L);
  else if (ST_VIEW === 'paths') staDrawPaths(L);
  else staDrawAll(L);
  staSelBar();
}

// The data line: which window the verdicts are judged on, whether both brands arrived, what Amazon's own record holds.
function staDataLine(M) {
  const parts = [];
  const h = M.have;
  if (M.settled) {
    const x = M.brands.map(b => h[b]).find(y => y && y.from) || {};
    parts.push(`Judged on <b>settled clicks${x.from ? ', ' + staEsc(staShortDay(x.from)) + ' – ' + staEsc(staShortDay(x.to)) : ''}</b>: older than Amazon's 7-day window, so their sales are final.`);
    if (ST.rec) parts.push('The last 7 days show under each figure in Burning money and are not counted yet.');
  } else {
    parts.push(`Judged on <b>the last 30 days</b>${ST.at ? ' (nightly run ' + staEsc(ST.at) + ')' : ''}, with sales Amazon credits within 30 days of a click. The newest days can still gain orders.`);
  }
  // Both brands there? A missing brand is said, never left to look like a quiet month.
  const miss = M.brands.filter(b => !(h[b] && (h[b].terms || h[b].tgts)));
  const old = ST.at && Date.now() - staStamp(ST.at) > 36 * 3600 * 1000;
  if (miss.length) parts.push(`<span class="sta-bad">✗ ${miss.map(staBrandName).join(' and ')}: no search terms in the last run</span>`);
  else if (old) parts.push(`<span class="sta-bad">✗ The search terms are from ${staEsc(ST.at)}: last night's run did not replace them</span>`);
  else parts.push(`<span class="sta-ok">✓ ${M.brands.map(staBrandName).join(' and ')}${M.brands.length > 1 ? ' both' : ''} complete</span>`);
  if (!ST.costs) parts.push('No unit costs readable for this account: every product is held to the default 30% target and 35% break-even.');
  const E = ST.ent;
  parts.push(E ? `Amazon IDs and current bids read ${staEsc(E.at || '')}` : 'Amazon IDs and current bids are not read yet: bid and pause changes wait in the review list');
  if (ST_RL.where === 'local') parts.push('<span class="sta-bad">The review list is kept in this browser only until it is switched on for everyone</span>');
  stMsg(parts.map(p => `<span>${p}</span>`).join(''));
}
// "2026-10-08" → "8 Oct".
const staShortDay = iso => {
  const t = Date.parse(String(iso || '').slice(0, 10) + 'T12:00:00Z');
  return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : String(iso || '');
};

// The four boxes over the table. Each opens its view; the last opens the review list.
function staBoxes(L) {
  const IC = {
    burn: '<path d="M12 2c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-6 1.5 1 2 2.5 2 4 1-1 1.5-4 1-8Z"/>',
    scale: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    paths: '<path d="M6 3v6a6 6 0 0 0 6 6h6"/><path d="M18 3v6"/><path d="M15 18l3-3-3-3"/>',
    rl: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  };
  const box = (k, c, label, big, unit, q, go) => `
    <button type="button" class="adx-box sta-box${ST_VIEW === k ? ' on' : ''}" data-box="${k}" style="--c:${c};--adx-glow:.10">
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24">${IC[k]}</svg></span>${label}</div>
      <div class="sta-big"><b>${big}</b><span>${unit}</span></div>
      <div class="sta-q">${q}</div>
      <div class="sta-go"><span>${go} →</span></div>
    </button>`;
  const burned = L.burn.reduce((t, r) => t + r.burned, 0);
  const none = L.burn.filter(r => r.kind === 'none').length, be = L.burn.length - none;
  const exact = L.scale.filter(r => r.scaleKind !== 'raise').length;
  const excess = L.groups.reduce((t, g) => t + g.shown.filter(r => r.role === 'other').reduce((u, r) => u + (r.excess || 0), 0), 0);
  const open = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved');
  const appr = open.filter(x => x.status === 'approved').length;
  $('stBoxes').innerHTML =
    box('burn', 'var(--bad)', 'Burning money', staMoney0(burned), `on ${staInt(L.burn.length)} search term${L.burn.length === 1 ? '' : 's'}`,
      `${staInt(none)} with no sales and ${staInt(be)} selling above break-even ACoS.`, 'Add negatives, reduce bids')
    + box('scale', 'var(--accent)', 'Worth scaling', staInt(L.scale.length), 'search terms',
      `Selling under their campaign's target ACoS with room to grow${exact ? ` · ${staInt(exact)} not their own keyword yet` : ''}.`, 'Raise bids, add as exact')
    + box('paths', 'var(--brand)', 'Competing paths', staInt(L.groups.length), 'search terms',
      `Reach you through more than one target · the other paths spent ${staMoney0(excess)} above the lead path's ACoS.`, 'Keep one path, negate the rest')
    + box('rl', 'var(--violet-ink)', 'Review list', staInt(open.length), 'waiting',
      appr ? `${staInt(appr)} approved, ready to download as an Amazon bulk file.` : 'Changes picked here wait to be approved, then download as an Amazon bulk file.', 'Open the review list');
}

// The view's title and sub-line.
function staHead(title, sub) {
  $('stTitle').textContent = title;
  $('stSub').innerHTML = sub;
}
// The footer: "N of M · sorted by …" and a Show more button when rows are left.
function staMore(shown, total, sortTxt, extra) {
  stFoot(`<span>${staInt(shown)} of ${staInt(total)} · sorted by ${sortTxt}${extra ? ' · ' + extra : ''}</span>`
    + (total > shown ? `<button type="button" class="ghost" data-more="1">Show ${Math.min(STA.PAGE, total - shown)} more</button>` : ''));
}
// The term cell: the term, then its badges and brand underneath.
function staTermCell(r, badges) {
  return `<td><div class="sta-term">${staEsc(r.term)}</div><div class="sta-under">${(badges || []).map(x => staBadge(x[0], x[1], x[2])).join('')}`
    + `${staBadge(staBrandName(r.brand))}</div></td>`;
}
// The path cell: campaign, then ad group · target.
function staPathCell(r) {
  const label = staPathLabel(r.kw, r.mt);
  const agn = r.agn && !label.toLowerCase().includes(r.agn.toLowerCase()) ? r.agn + ' · ' : '';
  return `<td class="sta-path" title="${staEsc(r.cn + ' · ' + r.agn)}"><b>${staEsc(r.cn || 'Campaign ' + r.cid)}</b>`
    + `<small>${staEsc(agn)}${staEsc(label)}</small></td>`;
}
// The "+n last 7 days" line under a figure; blank without the recent cache.
function staUp(r, k, money) {
  if (!r.r7) return '';
  const v = r.r7[k] || 0;
  return `<small class="sta-s up">${v ? '+' + (money ? staMoney(v) : staInt(v)) + ' last 7 days' : '&nbsp;'}</small>`;
}
// The next-step cell of a row.
function staNextCell(r) {
  if (r.status === 'In review') return '<td class="sta-next"><span class="sta-inrl">In the review list</span></td>';
  if (r.status === 'Negated') return `<td class="sta-next"><span class="sta-dash">${staEsc(r.negated)}</span></td>`;
  const n = r.next;
  if (n === 'neg') return `<td class="sta-next">${staBtn('Add negative', 'neg', r.key, 'neg')}</td>`;
  if (n === 'reduce') return `<td class="sta-next">${staBtn('Reduce bid', 'reduce', r.key)}</td>`;
  if (n === 'raise') return `<td class="sta-next">${r.sugBid ? `<small>Raise the bid to ${staMoney(r.sugBid)}.</small>` : ''}${staBtn('Raise bid', 'raise', r.key)}</td>`;
  if (n === 'exact') return `<td class="sta-next"><small>Add it as an exact keyword at ${staMoney(r.sugBid)}.</small>${staBtn('Add as exact', 'exact', r.key)}</td>`;
  if (n === 'asinT') return `<td class="sta-next"><small>Target this ASIN at ${staMoney(r.sugBid)}.</small>${staBtn('Target this ASIN', 'asinT', r.key)}</td>`;
  if (n === 'pause') return `<td class="sta-next">${staBtn(r.type === 'term' ? 'Pause duplicate' : 'Pause', 'pause', r.key, 'neg')}</td>`;
  if (n === 'limit') {
    const x = r.ent && r.cpc ? (r.ent.bid / r.cpc).toFixed(1) : '';
    return `<td class="sta-next"><div class="sta-limit"><b>The bid isn't the limit.</b> It is already ${x}× what is paid, so a higher bid buys nothing. Check this campaign's budget and top-of-search placement instead.</div></td>`;
  }
  if (n === 'lowstock') return `<td class="sta-next"><div class="sta-limit"><b>Low stock.</b> About ${Math.round(r.ln.cover)} days of FBA stock: no raise under ${STA.RAISE_COVER} days.</div></td>`;
  return `<td class="sta-next">${staDash}</td>`;
}
// The status chip of a row.
function staStatus(r) {
  const s = r.status || 'Active';
  return s === 'In review' ? staBadge(s, 'info') : s === 'Promoted' ? staBadge(s, 'ok') : s === 'Negated' ? staBadge(s, 'warn') : staBadge(s);
}

// All terms: one row per search term and path, with its verdict and next step. Opens first.
function staDrawAll(L) {
  const rows = L.all.slice().sort((p, q) => q.c - p.c || q.sp - p.sp);
  ST_LAST = rows;
  const shown = rows.slice(0, ST_SHOW);
  staHead('Every search term', 'One row per search term and the target that caught it, with what Sellora makes of it and the next step.');
  const body = shown.map(r => `<tr>
    <td><div class="sta-term">${staEsc(r.term)}</div><small class="sta-s">${staEsc(staBrandName(r.brand))}</small></td>
    ${staPathCell(r)}
    <td>${staStatus(r)}</td>
    <td class="num">${staInt(r.c)}</td><td class="num">${staMoney(r.sp)}</td><td class="num">${staMoney(r.s)}</td><td class="num">${staInt(r.o)}</td>
    <td class="num"><b>${r.acos != null ? staPct(r.acos) : staDash}</b></td>
    <td class="num">${r.sp > 0 ? (r.s / r.sp).toFixed(2) : staDash}</td>
    <td class="num">${r.c > 0 ? staPct(r.o / r.c * 100) : staDash}</td>
    <td class="num">${r.cpc != null ? staMoney(r.cpc) : staDash}</td>
    <td class="num ui-dim">${staInt(r.i)}</td>
    <td><div class="sta-under" style="margin:0">${r.badges.map(x => staBadge(x[0], x[1], x[2])).join('')}</div></td>
    ${staNextCell(r)}</tr>`).join('');
  $('stTable').innerHTML = `<thead><tr><th>Search term</th><th>Path · campaign and target</th><th>Status</th><th class="num">Clicks</th>
    <th class="num">Spend</th><th class="num">Sales</th><th class="num">Orders</th><th class="num">ACoS</th><th class="num">ROAS</th>
    <th class="num">CVR</th><th class="num">CPC</th><th class="num">Impr.</th><th>Verdict</th><th>Next step</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="14" class="muted" style="padding:14px">Nothing matches.</td></tr>') + '</tbody>';
  const dropped = L.M.brands.reduce((a, b) => {
    const h = L.M.have[b] || {};
    a.n += h.dropped || 0;
    a.sp += h.dropSpend || 0;
    a.min = h.minClicks || a.min;
    return a;
  }, { n: 0, sp: 0, min: 3 });
  // Said plainly. A cap nobody is told about reads as "this is everything".
  staMore(shown.length, rows.length, 'clicks', dropped.n
    ? `${staInt(dropped.n)} more terms not shown: fewer than ${dropped.min} clicks and no order (${staMoney(dropped.sp)} between them)` : '');
}

// Burning money, by search term: ticks, the last 7 days under each figure, money burned, evidence, next step.
function staDrawBurn(L) {
  const rows = L.burn;
  ST_LAST = rows;
  const shown = rows.slice(0, ST_SHOW);
  const tot = rows.reduce((t, r) => t + r.burned, 0), totSp = shown.reduce((t, r) => t + r.sp, 0), totB = shown.reduce((t, r) => t + r.burned, 0);
  const none = rows.filter(r => r.kind === 'none').length;
  staHead('Which search terms are burning money?', `${staInt(rows.length)} terms earned no profit: ${staInt(none)} with no sales and ${staInt(rows.length - none)} above break-even ACoS.`
    + (L.M.settled ? ' Settled clicks only.' : ` At least ${STA.MIN_CLICKS} clicks each.`));
  const canTick = r => r.next === 'neg' && r.status !== 'In review' && r.status !== 'Negated';
  const body = shown.map(r => {
    const sel = ST_SEL.has(r.key);
    return `<tr${sel ? ' class="sel"' : ''}>
      <td>${canTick(r) ? `<input type="checkbox" class="sta-cb" data-sel="${staEsc(r.key)}"${sel ? ' checked' : ''}>` : ''}</td>
      ${staTermCell(r, r.badges.filter(x => x[1] === 'bad' || x[0] === 'Could be chance'))}
      ${staPathCell(r)}
      <td class="num">${staInt(r.c)}${staUp(r, 'c')}</td>
      <td class="num">${staMoney(r.sp)}${staUp(r, 'sp', true)}</td>
      <td class="num">${staInt(r.o)}${staUp(r, 'o')}</td>
      <td class="num sta-money">${staMoney(r.burned)}</td>
      <td class="sta-ev">${r.ev || ''}</td>
      ${staNextCell(r)}</tr>`;
  }).join('');
  const ticks = shown.filter(canTick);
  const allOn = ticks.length && ticks.every(r => ST_SEL.has(r.key));
  $('stTable').innerHTML = `<thead><tr><th style="width:28px"><input type="checkbox" class="sta-cb" data-selall="1"${allOn ? ' checked' : ''} title="Tick every row that can take a negative"></th>
    <th>Search term</th><th>Path</th><th class="num">Clicks</th><th class="num">Spend</th><th class="num">Orders</th>
    <th class="num">Money burned</th><th>Evidence</th><th>Next step</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="9" class="muted" style="padding:14px">Nothing is burning money in this view.</td></tr>')
    + (shown.length ? `<tr class="tot"><td></td><td colspan="3">${staInt(shown.length)} of ${staInt(rows.length)} shown</td><td class="num">${staMoney(totSp)}</td><td></td>
      <td class="num sta-money">${staMoney(totB)}</td><td colspan="2" style="font-weight:500;color:var(--muted)">of ${staMoney(tot)} burned across all ${staInt(rows.length)}</td></tr>` : '')
    + '</tbody>';
  staMore(shown.length, rows.length, 'money burned', '"By target" lists keywords and targets that lost money across many small search terms');
}

// Burning money, by target: the keywords and targets themselves, for a lower bid or a pause.
function staDrawBurnTgt(L) {
  const rows = L.burnTgt;
  ST_LAST = rows;
  const shown = rows.slice(0, ST_SHOW);
  const tot = rows.reduce((t, r) => t + r.burned, 0);
  staHead('Which keywords and targets are burning money?', `${staInt(rows.length)} keywords and targets spent ${staMoney0(tot)} more than they earned back at break-even,`
    + ` with at least ${STA.MIN_CLICKS} clicks. A bid or a pause here moves every search term of that target.`);
  const body = shown.map(r => {
    const chancePct = r.chance != null ? (r.chance * 100).toFixed(1) + '%' : '';
    const ev = r.kind === 'none'
      ? (r.rate ? `0 orders in <b>${staInt(r.c)} clicks</b> · ${chancePct} chance of that if it converted like ${r.rate.w} (${(r.rate.p * 100).toFixed(1)}%)`
        + (r.chance < STA.CHANCE ? ', <b>unlikely to be chance</b>' : ', so it <b>could still be chance</b>') : `0 orders in <b>${staInt(r.c)} clicks</b>`)
      : `ACoS <b>${staPct(r.acos)}</b> vs break-even ${staPct(r.ln.be)} (target ${staPct(r.ln.tgt)}): spent ${staMoney(r.burned)} more than break-even allows`;
    const st = r.paused ? 'Paused at Amazon' : r.rl ? 'In review' : '';
    const fake = Object.assign({}, r, { status: st === 'In review' ? 'In review' : 'Active', badges: [] });
    return `<tr>
      <td><div class="sta-term">${staEsc(staPathLabel(r.kw, r.mt))}</div><div class="sta-under">${staBadge(r.kind === 'none' ? 'No sales' : 'Above break-even', 'bad')}${staBadge(staBrandName(r.brand))}${st === 'Paused at Amazon' ? staBadge(st, 'warn') : ''}</div></td>
      <td class="sta-path"><b>${staEsc(r.cn)}</b><small>${staEsc(r.agn)}</small></td>
      <td class="num">${staInt(r.c)}${staUp(r, 'c')}</td><td class="num">${staMoney(r.sp)}${staUp(r, 'sp', true)}</td><td class="num">${staInt(r.o)}${staUp(r, 'o')}</td>
      <td class="num">${r.acos != null ? staPct(r.acos) : staDash}</td>
      <td class="num sta-money">${staMoney(r.burned)}</td>
      <td class="sta-ev">${ev}</td>
      ${staNextCell(fake)}</tr>`;
  }).join('');
  $('stTable').innerHTML = `<thead><tr><th>Keyword / target</th><th>Campaign · ad group</th><th class="num">Clicks</th><th class="num">Spend</th>
    <th class="num">Orders</th><th class="num">ACoS</th><th class="num">Money burned</th><th>Evidence</th><th>Next step</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="9" class="muted" style="padding:14px">No keyword or target is burning money in this view.</td></tr>') + '</tbody>';
  staMore(shown.length, rows.length, 'money burned', 'no sales and unlikely to be chance → pause; otherwise → a lower bid');
}

// Worth scaling: raise the bid of a term's own keyword, or add a term that sells as its own exact keyword.
function staDrawScale(L) {
  const rows = L.scale;
  ST_LAST = rows;
  const shown = rows.slice(0, ST_SHOW);
  staHead('Which search terms are worth scaling?', `${staInt(rows.length)} terms sell under their campaign's target ACoS`
    + (ST.costs ? ' (from Profit &amp; Margin costs)' : '') + ' with enough orders to trust it. Ceiling = the CPC that would land exactly on target.');
  const body = shown.map(r => {
    const under = r.ln.tgt - r.acos;
    const bid = r.ent && r.ent.bid;
    let bidCell;
    if (r.scaleKind === 'raise') {
      bidCell = !bid ? `<b>+${Math.round(STA.STEP * 100)}%</b><small class="sta-s">on the current bid (not read yet)</small>`
        : r.next === 'limit' ? `${staMoney(bid)} → ${staDash}<small class="sta-s">bid is ${(bid / r.cpc).toFixed(1)}× the CPC</small>`
          : !r.sugBid ? `${staMoney(bid)} → ${staDash}<small class="sta-s">no raise: low stock</small>`
          : `${staMoney(bid)} → <b>${staMoney(r.sugBid || bid)}</b><small class="sta-s">+${((r.sugBid / bid - 1) * 100).toFixed(1)}%${r.sugBid >= staR2(bid * (1 + STA.STEP)) - 0.001 ? ' · safety limit' : ''}</small>`;
    } else {
      bidCell = `<span class="sta-dash">new</span> → <b>${staMoney(r.sugBid)}</b><small class="sta-s">CPC +${Math.round(STA.STEP * 100)}%, under the ceiling</small>`;
    }
    return `<tr>
      ${staTermCell(r, r.badges.filter(x => x[1] === 'info' && x[0] !== 'Lead path'))}
      ${staPathCell(r)}
      <td class="num">${staInt(r.o)}</td>
      <td class="num"><b>${staPct(r.acos)}</b><small class="sta-s">${under.toFixed(1)} pts under ${staPct(r.ln.tgt)}${r.ln.known ? '' : ' (default)'}</small></td>
      <td class="num">${staMoney(r.cpc)} → ${staMoney(r.ceil)}</td>
      <td class="num">${bidCell}</td>
      ${staNextCell(r)}</tr>`;
  }).join('');
  $('stTable').innerHTML = `<thead><tr><th>Search term</th><th>Path</th><th class="num">Orders</th><th class="num">ACoS</th>
    <th class="num">CPC → ceiling</th><th class="num">Bid → suggested</th><th>Next step</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="7" class="muted" style="padding:14px">Nothing in this view is ready to scale.</td></tr>') + '</tbody>';
  staMore(shown.length, rows.length, 'sales', `no raise on a product with under ${STA.RAISE_COVER} days of FBA stock · raises are capped at +${Math.round(STA.STEP * 100)}% a step`);
}

// Competing paths: grouped by term, the lead path first, the others with what they spent above its ACoS.
function staDrawPaths(L) {
  const groups = L.groups;
  ST_LAST = groups;
  const shown = groups.slice(0, ST_SHOW);
  staHead('Which paths compete for the same search term?', `${staInt(groups.length)} terms reach you through more than one target. The lead path brings the most orders;`
    + ' for the others, the money spent above its ACoS is an estimate of what the overlap costs.');
  let html = '';
  shown.forEach(g => {
    const ps = g.shown;
    const sum = ps.filter(r => r.role === 'other').reduce((t, r) => t + (r.excess || 0), 0);
    html += `<tr class="grp"><td colspan="8" class="sta-grp"><b>"${staEsc(g.term)}"</b><span>${staInt(g.paths.length)} paths · ${staInt(g.campaigns)} campaign${g.campaigns === 1 ? '' : 's'} · ${staEsc(staBrandName(g.brand))}`
      + ` · other paths spent <em>${staMoney(sum)}</em> above the lead path's ACoS</span></td></tr>`;
    ps.forEach(r => {
      const lead = r.role === 'lead';
      const txt = lead ? `Keep: this path brings the most orders for this term (${staInt(r.o)}).`
        : r.dupExact ? 'A second exact keyword for the same term: pause this one so the lead path takes it.'
          : r.pathLevel === 'ag' ? 'Negative exact at ad-group level here (the lead path is in the same campaign), so the term goes through the lead path.'
            : 'Negative exact at campaign level here, so the term goes through the lead path.';
      const act = lead || r.status === 'In review' || r.status === 'Negated' ? (r.status === 'In review' ? '<span class="sta-inrl">In the review list</span>' : r.status === 'Negated' ? `<span class="sta-dash">${staEsc(r.negated)}</span>` : '')
        : r.dupExact ? staBtn('Pause duplicate', 'pause', r.key, 'neg') : staBtn('Add negative', 'neg', r.key, 'neg');
      html += `<tr>${staPathCell(r)}<td class="num">${staInt(r.c)}</td><td class="num">${staMoney(r.sp)}</td>
        <td class="num">${staInt(r.o)}</td><td class="num">${r.acos != null ? staPct(r.acos) : staDash}</td><td class="num">${r.cpc != null ? staMoney(r.cpc) : staDash}</td>
        <td>${lead ? staBadge('Lead path', 'info') : staBadge('Other path') + `<small class="sta-s" style="margin-top:4px">${staMoney(r.excess)} above lead ACoS</small>`}</td>
        <td class="sta-next"><div style="display:flex;justify-content:space-between;align-items:center;gap:16px;min-width:380px">
          <span style="color:var(--muted);white-space:normal">${txt}</span>${act}</div></td></tr>`;
    });
  });
  $('stTable').innerHTML = `<thead><tr><th>Path</th><th class="num">Clicks</th><th class="num">Spend</th><th class="num">Orders</th>
    <th class="num">ACoS</th><th class="num">CPC</th><th>Role</th><th>Recommendation</th></tr></thead><tbody>`
    + (html || '<tr><td colspan="8" class="muted" style="padding:14px">No search term competes with itself in this view.</td></tr>') + '</tbody>';
  staMore(shown.length, groups.length, 'money above the lead path', 'only paths inside the same brand\'s ad account compete');
}

// The selection bar under Burning money: how many are ticked and what they burned.
function staSelBar() {
  const on = ST_VIEW === 'burn' && ST_SUB === 'term' && ST_SEL.size > 0;
  $('stSelBar').classList.toggle('hide', !on);
  if (!on) return;
  const rows = [...ST_SEL.values()];
  $('stSelTxt').innerHTML = `<b>${staInt(rows.length)} selected</b> · ${staMoney(rows.reduce((t, r) => t + r.burned, 0))} burned`;
  $('stSelAdd').textContent = `Add ${rows.length} negative${rows.length === 1 ? '' : 's'} to the review list`;
}

/* ================= THE DIALOG: one for every change =================
 * staOpen fills stDlg for one row and one kind: neg (Add negative), raise / reduce (bid), pause, exact (Add as exact) and
 * asinT (Target this ASIN). Every check is worked out again on each change of a field (staDlgCheck); a failed check that
 * matters (a brand term, too long, already there, over the safety limit) disables "Add to review list". */
let STD = null;   // { kind, row, fields… } of the open dialog

// The six figures at the top of every dialog, and the line under them (window, last 7 days).
function staFigs(r) {
  const fig = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
  const win = (STM && STM.settled) ? 'Settled clicks' : 'The last 30 days';
  const r7 = r.r7 ? ` Last 7 days: ${staInt(r.r7.c || 0)} more clicks, ${staMoney(r.r7.sp || 0)}, ${staInt(r.r7.o || 0)} orders.` : '';
  return `<div class="sta-figs">${fig('Clicks', staInt(r.c))}${fig('Spend', staMoney(r.sp))}${fig('Sales', staMoney(r.s))}`
    + `${fig('Orders', staInt(r.o))}${fig('ACoS', r.acos != null ? staPct(r.acos) : '—')}${fig('ROAS', r.sp > 0 ? (r.s / r.sp).toFixed(2) : '—')}</div>`
    + `<div class="sta-figs-7">${win}.${r7}${r.acos == null ? ' ACoS shows — because there are no sales.' : ''}</div>`;
}
// One line of the checks box: st = ok / warn / bad.
const staCheck = (st, t) => `<div class="ck-${st}"><i>${st === 'ok' ? '✓' : st === 'warn' ? '!' : '✗'}</i><span>${t}</span></div>`;

// Open the dialog for one row (key from the table) and one kind of change.
function staOpen(kind, key) {
  const M = staModel();
  const r = M.byKey.get(key);
  if (!r) return;
  STD = { kind, row: r };
  const by = $('stDlgBody');
  const sub = $('stDlgSub');
  const ok = $('stDlgOk');
  ok.textContent = 'Add to review list';
  $('stDlgNote').textContent = 'Goes to the review list. Approved items download as an Amazon bulk file; Sellora changes nothing at Amazon yet.';
  const where = `${staEsc(r.cn)} · ${staEsc(staBrandName(r.brand))}`;
  if (kind === 'neg') {
    const asin = r.type === 'term' && r.asin;
    $('stDlgTitle').textContent = asin ? 'Add negative ASIN' : 'Add negative';
    sub.innerHTML = `"${staEsc(r.term)}" in ${where}<br>It came through ${staEsc(r.auto ? 'the auto target ' + (r.kw || '') : staPathLabel(r.kw, r.mt))}.`;
    const lvl = r.pathLevel || (asin ? 'ag' : 'cp');
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stNegType">Type</label>${asin
        ? '<select id="stNegType" disabled><option value="na">Negative ASIN target</option></select><small>Stops this product page from showing the ad.</small>'
        : `<select id="stNegType"><option value="negativeExact">Negative exact</option><option value="negativePhrase">Negative phrase</option></select>
          <small id="stNegTypeTip"></small>`}</div>
      <div class="sta-f"><label for="stNegLvl">Where</label><select id="stNegLvl"${asin ? ' disabled' : ''}>
        <option value="cp"${lvl === 'cp' ? ' selected' : ''}>This campaign</option><option value="ag"${lvl === 'ag' ? ' selected' : ''}>This ad group only</option></select>
        <small id="stNegLvlTip"></small></div></div>
      <div id="stDlgChecks" class="sta-checks"></div>`;
  } else if (kind === 'raise' || kind === 'reduce') {
    const up = kind === 'raise';
    const isTgt = r.type === 'target';
    $('stDlgTitle').textContent = (up ? 'Raise' : 'Reduce') + ' bid on the ' + (isTgt ? 'target' : 'source target');
    sub.innerHTML = isTgt ? `${staEsc(staPathLabel(r.kw, r.mt))} in ${where}. The new bid applies to every search term of this target.`
      : `Search terms aren't bid on directly. "${staEsc(r.term)}" is matched by <b>${staEsc(staPathLabel(r.kw, r.mt))}</b>, so the new bid applies to every search term of that target.`;
    const cur = r.ent && r.ent.bid > 0 ? r.ent.bid : null;
    const acos = isTgt ? r.acos : (r.tgtAcos != null && !up ? r.tgtAcos : r.acos);
    const f = acos > 0 ? r.ln.tgt / acos : 1 - STA.STEP;
    const lim = up ? Math.min(1 + STA.STEP, f) : Math.max(1 - STA.STEP, Math.min(1, f));
    const sug = cur ? Math.max(STA.MIN_BID, staR2(cur * lim)) : null;
    STD.cur = cur;
    STD.lim = lim;
    STD.acos = acos;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stBidNew">New bid (USD)</label><input id="stBidNew" type="number" min="0.02" step="0.01" value="${sug != null ? sug.toFixed(2) : ''}"></div>
      <div class="sta-f"><label for="stBidCur">Current bid</label><input id="stBidCur" type="number" min="0.02" step="0.01" value="${cur != null ? cur.toFixed(2) : ''}"${cur != null ? ' disabled' : ' placeholder="Type it from the console"'}>
        ${cur == null ? '<small>Not read from Amazon yet: type the bid shown in the Ads console to work the suggestion out.</small>' : ''}</div></div>
      <div id="stBidCalc" class="sta-calc"></div><div id="stDlgChecks" class="sta-checks"></div>`;
  } else if (kind === 'pause') {
    const isTgt = r.type === 'target';
    $('stDlgTitle').textContent = isTgt ? 'Pause this target' : 'Pause the duplicate keyword';
    sub.innerHTML = isTgt ? `${staEsc(staPathLabel(r.kw, r.mt))} in ${where}. Pausing stops every search term of this target; it can be turned back on.`
      : `"${staEsc(r.term)}" is an exact keyword here and in ${staEsc(r.group ? r.group.lead.cn : 'another campaign')}, which sells it better. Pausing this one sends the term through the lead path.`;
    by.innerHTML = staFigs(r) + '<div id="stDlgChecks" class="sta-checks"></div>';
  } else if (kind === 'exact' || kind === 'asinT') {
    const asin = kind === 'asinT';
    $('stDlgTitle').textContent = asin ? 'Target this ASIN' : 'Add as exact keyword';
    sub.innerHTML = asin ? `"${staEsc(r.term.toUpperCase())}" sold through ${staEsc(staPathLabel(r.kw, r.mt))} in ${where}. A product target bids on that page directly.`
      : `"${staEsc(r.term)}" sold through ${staEsc(staPathLabel(r.kw, r.mt))} in ${where}. Its own exact keyword gets its own bid and its own figures.`;
    const cands = staDestinations(r, asin);
    STD.cands = cands;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stExDest">Into ad group</label><select id="stExDest">${cands.length
        ? cands.map((c, i) => `<option value="${i}">${staEsc(c.cn)} · ${staEsc(c.agn)}</option>`).join('')
        : '<option value="">No ad group fits</option>'}</select>
        <small>${asin ? 'Manual product-targeting ad groups' : 'Manual keyword ad groups'} advertising the same product, the most exact-heavy first.</small></div>
      <div class="sta-f"><label for="stExBid">Starting bid (USD)</label><input id="stExBid" type="number" min="0.02" step="0.01" value="${(r.sugBid || STA.MIN_BID).toFixed(2)}">
        <small>CPC ${staMoney(r.cpc)} +${Math.round(STA.STEP * 100)}%, kept under the ceiling ${staMoney(r.ceil)} (the CPC that lands on the ${staPct(r.ln.tgt)} target).</small></div></div>
      <div id="stDlgChecks" class="sta-checks"></div>`;
  }
  staDlgCheck();
  $('stDlg').classList.remove('hide');
  const first = by.querySelector('select:not([disabled]),input:not([disabled])');
  if (first) first.focus();
}

// The ad groups a new exact keyword (or ASIN target) for this row can go into: same brand, a manual keyword (or product)
// ad group, advertising at least one of the same products; the most exact-heavy and same-campaign first.
function staDestinations(r, asin) {
  const D = (STM.dest || {})[r.brand];
  if (!D) return [];
  const pool = asin ? D.ptAg : D.kwAg;
  const mine = new Set(r.asins);
  const tg = staTgtsOf(r.brand).rows || [];
  const exactN = new Map(), allN = new Map(), cidOf = new Map();
  tg.forEach(x => {
    allN.set(x.ag, (allN.get(x.ag) || 0) + 1);
    if (/^EXACT$/i.test(x.mt)) exactN.set(x.ag, (exactN.get(x.ag) || 0) + 1);
    cidOf.set(x.ag, x.cid);
  });
  const out = [];
  pool.forEach(ag => {
    const p = stProductsOf(r.brand, ag);
    if (mine.size && !p.asins.some(a => mine.has(a))) return;
    const eAg = (staEnt(r.brand) || { ag: {} }).ag[ag];
    const cid = cidOf.get(ag) || (eAg ? eAg[0] : '');
    const cn = staName(r.brand, cid), agn = staName(r.brand, ag);
    const share = (exactN.get(ag) || 0) / Math.max(1, allN.get(ag) || 1);
    out.push({ ag, cid, cn, agn, score: share * 10 + (/exact/i.test(cn + ' ' + agn) ? 5 : 0) + (ag === r.ag ? 1 : 0) });
  });
  return out.sort((p, q) => q.score - p.score).slice(0, 40);
}

// Work the dialog's checks out again for what is in its fields now, and enable or disable "Add to review list".
function staDlgCheck() {
  if (!STD) return;
  const { kind, row: r } = STD;
  const out = [];
  let block = false;
  const bad = t => { out.push(staCheck('bad', t)); block = true; };
  const P = (STM.protect || {})[r.brand] || { ownAsins: new Set(), brandTerms: new Set() };
  const idNote = () => out.push(staCheck('warn', "Amazon's ID for this target is not read yet, so the change can't go into the bulk file until it is (backend step 1). It waits in the review list."));
  if (kind === 'neg') {
    const asin = r.type === 'term' && r.asin;
    const type = asin ? 'na' : $('stNegType').value;
    const lvl = $('stNegLvl').value;
    STD.type = type;
    STD.lvl = asin ? 'ag' : lvl;
    if (!asin) {
      $('stNegTypeTip').textContent = type === 'negativeExact'
        ? `Exact blocks only "${r.term}" (and its plurals).` : `Phrase also blocks longer searches holding "${r.term}", like "${r.term} set".`;
      $('stNegLvlTip').textContent = lvl === 'cp' ? `Applies to every ad group in ${r.cn}.` : `Applies only to ${r.agn || 'this ad group'}.`;
    } else {
      $('stNegLvlTip').textContent = 'ASIN negatives go in at ad-group level: the bulk file takes them there in every kind of campaign.';
    }
    // 1. Not a brand term or one of our own ASINs.
    const tl = r.tl;
    const brandHit = [...P.brandTerms].find(w => w && (tl === w || (' ' + tl + ' ').includes(' ' + w + ' ')));
    if (asin && P.ownAsins.has(tl)) bad(`${r.term.toUpperCase()} is one of your own ASINs: it is never negated.`);
    else if (brandHit) bad(`Holds your brand term "${staEsc(brandHit)}": brand searches are never negated here.`);
    else out.push(staCheck('ok', asin ? 'Not one of your own ASINs' : 'Not one of your brand terms or your own ASINs'));
    // 2. No negative there yet — at Amazon, or in the review list.
    const whereKey = STD.lvl === 'cp' ? 'cp|' + r.cid : 'ag|' + r.ag;
    const nk = asin ? 'na' : type === 'negativePhrase' ? 'np' : 'nx';
    const at = staNegAtAmazon(r.brand, whereKey, r.term, nk);
    const queued = ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.kind === 'neg'
      && x.brand === r.brand && staLow(x.term) === tl && (x.neg.level === 'cp' ? x.cid === r.cid : x.ag === r.ag));
    const place = STD.lvl === 'cp' ? 'this campaign' : 'this ad group';
    if (at) bad(`A negative for "${staEsc(r.term)}" is already in ${place} at Amazon.`);
    else if (queued) bad(`A negative for "${staEsc(r.term)}" in ${place} is already in the review list.`);
    else if (at === null) out.push(staCheck('warn', `Not in the review list yet. Amazon's existing negatives are not read yet (backend step 1), so check ${place} in the console before uploading.`));
    else out.push(staCheck('ok', `No negative for "${staEsc(r.term)}" in ${place} yet`));
    // 3. Sales through other paths.
    const others = STM.rows.filter(x => x.brand === r.brand && x.tl === tl && x.ag !== r.ag && x.o > 0);
    const sameCp = others.filter(x => x.cid === r.cid);
    if (STD.lvl === 'cp' && sameCp.length) bad(`A campaign-level negative would also block it in ${staEsc(sameCp[0].agn || 'another ad group')}, where it sold ${staInt(sameCp[0].o)}: choose "This ad group only".`);
    else if (others.length) out.push(staCheck('ok', `It sells through ${staEsc(others[0].cn)} (${staInt(others.reduce((t, x) => t + x.o, 0))} orders): that path is left alone, and the term goes there.`));
    else out.push(staCheck('ok', 'No sales through any other path in the window'));
    // 4. Amazon's length limits.
    if (!asin) {
      const lim = STA.NEG[type];
      const words = r.term.trim().split(/\s+/).length, chars = r.term.length;
      if (words > lim.words || chars > lim.chars) bad(`Too long for a ${lim.t.toLowerCase()}: ${words} words, ${chars} characters (Amazon allows up to ${lim.words} words, ${lim.chars} characters).`);
      else out.push(staCheck('ok', `Fits as a ${lim.t.toLowerCase()}: ${words} word${words === 1 ? '' : 's'} (Amazon allows up to ${lim.words} words, ${lim.chars} characters)`));
    }
  } else if (kind === 'raise' || kind === 'reduce') {
    const up = kind === 'raise';
    const curIn = Number($('stBidCur').value);
    const cur = STD.cur || (curIn > 0 ? curIn : null);
    const nb = Number($('stBidNew').value);
    if (!STD.cur && cur && !$('stBidNew').dataset.touched) {
      $('stBidNew').value = Math.max(STA.MIN_BID, staR2(cur * STD.lim)).toFixed(2);
    }
    const nbv = Number($('stBidNew').value) || nb;
    STD.from = cur;
    STD.to = nbv;
    const ceil = r.cpc && STD.acos ? r.cpc * r.ln.tgt / STD.acos : null;
    $('stBidCalc').innerHTML = cur
      ? `Suggested <b>${staMoney(Math.max(STA.MIN_BID, staR2(cur * STD.lim)))}</b>: the bid × target ${staPct(r.ln.tgt)} ÷ ACoS ${staPct(STD.acos)}`
        + `${ceil ? ` (ceiling CPC ${staMoney(ceil)}, CPC now ${staMoney(r.cpc)})` : ''}, limited to ${up ? '+' : '−'}${Math.round(STA.STEP * 100)}% a step by the safety limit.`
        + ` Target ACoS ${staPct(r.ln.tgt)} · break-even ${staPct(r.ln.be)}${r.ln.known ? '' : ' (defaults: no unit cost)'}.`
      : `Suggested: the current bid × target ${staPct(r.ln.tgt)} ÷ ACoS ${staPct(STD.acos)}, limited to ${up ? '+' : '−'}${Math.round(STA.STEP * 100)}% a step. Type the current bid to see it.`;
    if (!(nbv >= STA.MIN_BID)) bad(`The new bid must be at least ${staMoney(STA.MIN_BID)}.`);
    if (up) {
      const cv = r.ln.cover;
      if (cv == null) out.push(staCheck('warn', 'FBA stock cover is not known for this product: check it before raising.'));
      else if (cv < STA.RAISE_COVER) bad(`FBA stock: about ${Math.round(cv)} days of cover (a raise needs ${STA.RAISE_COVER} or more).`);
      else out.push(staCheck('ok', `FBA stock: ${Math.round(cv)} days of cover (a raise needs ${STA.RAISE_COVER} or more)`));
    }
    const last = staLastChange(r);
    if (last && Date.now() - last < STA.COOLDOWN * 86400000) out.push(staCheck('warn', `Last change to this bid from Sellora: ${staDay(last)} — wait at least ${STA.COOLDOWN} days so it can show in the figures.`));
    else out.push(staCheck('ok', last ? `Last change to this bid from Sellora: ${Math.floor((Date.now() - last) / 86400000)} days ago (wait at least ${STA.COOLDOWN})` : `No change to this bid recorded by Sellora (wait at least ${STA.COOLDOWN} days between changes)`));
    if (cur && nbv > 0) {
      const step = nbv / cur - 1;
      if ((up && step <= 0) || (!up && step >= 0)) bad(`The new bid is not ${up ? 'above' : 'below'} the current ${staMoney(cur)}.`);
      else if (Math.abs(step) > STA.STEP + 0.0001) bad(`${(step * 100).toFixed(1)}% is past the safety limit of ${Math.round(STA.STEP * 100)}% a step.`);
      else out.push(staCheck('ok', `Within the safety limit of ${Math.round(STA.STEP * 100)}% a step (${step > 0 ? '+' : ''}${(step * 100).toFixed(1)}%)`));
    } else if (!cur) bad('Type the current bid (from the Ads console) so the step can be checked.');
    if (!r.kw) bad("Amazon didn't report which target caught this term, so there is no bid to change. A negative is the way to stop it.");
    if (!r.ent && !r.kid) idNote();
  } else if (kind === 'pause') {
    out.push(staCheck('ok', r.type === 'target' ? (r.kind === 'none' && r.chance != null
      ? `0 orders in ${staInt(r.c)} clicks: a ${(r.chance * 100).toFixed(1)}% chance of that by bad luck` : 'Spends without paying back')
      : `The lead path sells it at ${staPct(r.leadAcos)} ACoS`));
    if (!r.ent && !r.kid) idNote();
  } else if (kind === 'exact' || kind === 'asinT') {
    const asin = kind === 'asinT';
    const c = STD.cands[Number($('stExDest').value)];
    STD.dest = c || null;
    STD.bid = Number($('stExBid').value);
    if (!c) bad(asin ? 'No manual product-targeting ad group advertises this product. Create one in the Ads console first.'
      : 'No manual keyword ad group advertises this product. Create one in the Ads console first.');
    else {
      const there = (staTgtsOf(r.brand).rows || []).some(x => x.ag === c.ag && (asin ? staLow(x.t).includes(r.tl) : staLow(x.t) === r.tl && /^EXACT$/i.test(x.mt)));
      const queued = ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.kind === kind
        && x.brand === r.brand && staLow(x.term) === r.tl && x.dest && x.dest.ag === c.ag);
      if (there) bad(`${staEsc(c.agn)} already has ${asin ? 'a target for this ASIN' : 'this exact keyword'}.`);
      else if (queued) bad('Already in the review list for this ad group.');
      else out.push(staCheck('ok', `${staEsc(c.agn)} has no ${asin ? 'target for this ASIN' : 'exact keyword for it'} yet`));
    }
    if (!asin) {
      const words = r.term.trim().split(/\s+/).length, chars = r.term.length;
      if (words > STA.KW.words || chars > STA.KW.chars) bad(`Too long for a keyword: ${words} words, ${chars} characters (Amazon allows up to ${STA.KW.words} words, ${STA.KW.chars}).`);
      else out.push(staCheck('ok', `Fits as a keyword: ${words} word${words === 1 ? '' : 's'}`));
    }
    if (!(STD.bid >= STA.MIN_BID)) bad(`The bid must be at least ${staMoney(STA.MIN_BID)}.`);
    else if (r.ceil && STD.bid > r.ceil * 1.0001) out.push(staCheck('warn', `${staMoney(STD.bid)} is above the ceiling ${staMoney(r.ceil)}: at that CPC the ACoS would pass the target.`));
    else out.push(staCheck('ok', `Under the ceiling CPC ${staMoney(r.ceil)}`));
    out.push(staCheck('ok', `Competing paths will show the old path once the new ${asin ? 'target' : 'keyword'} starts taking the term.`));
  }
  $('stDlgChecks').innerHTML = out.join('');
  $('stDlgOk').disabled = block;
}

// When Sellora last sent a bid or state change for this path (exported or done), in ms; 0 when never.
function staLastChange(r) {
  let t = 0;
  ST_RL.items.forEach(x => {
    if ((x.kind === 'bid' || x.kind === 'pause') && (x.status === 'exported' || x.status === 'done') && x.pathKey === r.pathKey) t = Math.max(t, x.exportedAt || 0);
  });
  return t;
}

// Close the dialog.
function staClose() {
  $('stDlg').classList.add('hide');
  STD = null;
}

// "Add to review list": turn the dialog into one review item and save it.
async function staDlgOk() {
  if (!STD || $('stDlgOk').disabled) return;
  const { kind, row: r } = STD;
  let it;
  if (kind === 'neg') it = staNegItem(r, STD.type, STD.lvl);
  else if (kind === 'raise' || kind === 'reduce') {
    it = staItem(r, 'bid', {
      bid: { from: STD.from, to: staR2(STD.to), dir: kind === 'raise' ? 'up' : 'down' },
      what: `${staMoney(STD.from)} → ${staMoney(STD.to)}`,
      why: kind === 'raise' ? `ACoS ${staPct(r.acos)} vs target ${staPct(r.ln.tgt)} · ${staInt(r.o)} orders`
        : `${r.type === 'term' ? '"' + r.term + '" ' : ''}ACoS ${staPct(STD.acos)} vs break-even ${staPct(r.ln.be)}`,
    });
  } else if (kind === 'pause') {
    it = staItem(r, 'pause', { what: 'Pause', why: r.type === 'target' ? (r.kind === 'none' ? `0 orders in ${staInt(r.c)} clicks` : `ACoS ${staPct(r.acos)} vs break-even ${staPct(r.ln.be)}`)
      : `Duplicate exact keyword · lead path at ${staPct(r.leadAcos)} ACoS` });
  } else {
    const c = STD.dest;
    it = staItem(r, kind, {
      dest: { ag: c.ag, cid: c.cid, cn: c.cn, agn: c.agn }, newBid: staR2(STD.bid),
      what: `New ${kind === 'asinT' ? 'ASIN target' : 'exact keyword'} at ${staMoney(STD.bid)} in ${c.agn}`,
      why: `${staInt(r.o)} orders at ACoS ${staPct(r.acos)} through ${staPathLabel(r.kw, r.mt)}`,
    });
  }
  $('stDlgOk').disabled = true;
  try {
    await staRlSave(it);
    staClose();
    STM = null;
    renderSt();
    stFoot(`<span>Added to the review list: ${staEsc(staKindName(it))} · ${staEsc(it.term || it.target)}.</span>`);
  } catch (e) {
    $('stDlgOk').disabled = false;
    $('stDlgChecks').insertAdjacentHTML('beforeend', staCheck('bad', 'Could not save: ' + staEsc(e.message || e)));
  }
}

/* ================= THE REVIEW LIST =================
 * One item per change, in the shape the backend's apply route will read later:
 *   { v, brand, kind: neg | bid | pause | exact | asinT, key (term rows) / pathKey, term, target (the keyword or target),
 *     mt, cid, ag, cn, agn, neg: { type, level }, bid: { from, to, dir }, dest: { ag, cid, cn, agn }, newBid,
 *     what, why, ev: { c, sp, o, s, win }, status: review → approved → exported → done (or removed), by, at, exportedAt, up }
 * Kept in Firestore adsActions/{id}; in this browser (localStorage) while the rules for it are not deployed. */
let ST_RL = { items: [], where: '', stamp: 0, err: '', tab: 'open', sel: new Set() };
const STA_LOCAL = 'staReview';

// Read the review list: Firestore first; when the database refuses (rules not deployed yet), this browser's copy.
async function staRlLoad() {
  try {
    const snap = await getDocs(query(collection(db, 'adsActions'), orderBy('at', 'desc'), limit(500)));
    ST_RL.items = snap.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    ST_RL.where = 'fs';
  } catch (e) {
    ST_RL.where = 'local';
    ST_RL.err = String((e && (e.code || e.message)) || e);
    try { ST_RL.items = JSON.parse(localStorage.getItem(STA_LOCAL) || '[]'); } catch (x) { ST_RL.items = []; }
  }
  ST_RL.stamp++;
}
// Save one item (new or changed). Falls back to this browser if the database refuses the write.
async function staRlSave(it) {
  it.up = Date.now();
  const clean = JSON.parse(JSON.stringify(it));   // Firestore takes no undefined values
  delete clean.id;
  if (ST_RL.where === 'fs') {
    try {
      await setDoc(doc(db, 'adsActions', it.id), clean);
    } catch (e) {
      ST_RL.where = 'local';
      ST_RL.err = String((e && (e.code || e.message)) || e);
    }
  }
  const i = ST_RL.items.findIndex(x => x.id === it.id);
  if (i >= 0) ST_RL.items[i] = it; else ST_RL.items.unshift(it);
  if (ST_RL.where === 'local') {
    try { localStorage.setItem(STA_LOCAL, JSON.stringify(ST_RL.items.slice(0, 500))); } catch (e) { throw new Error('this browser would not store it'); }
  }
  ST_RL.stamp++;
}
// Index of the open items (review / approved / exported) by row key and path key, and of the done ones by 'done:' + key.
function staRlIndex() {
  const m = new Map();
  ST_RL.items.forEach(x => {
    const open = x.status === 'review' || x.status === 'approved' || x.status === 'exported';
    if (open) {
      if (x.key) m.set(x.key, x);
      if ((x.kind === 'bid' || x.kind === 'pause') && x.pathKey) m.set(x.pathKey, x);
    } else if (x.status === 'done' && x.kind === 'neg' && x.key) m.set('done:' + x.key, x);
  });
  return m;
}
// The count on the toolbar's Review list button.
function staRlBadge() {
  const n = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved').length;
  $('stRlN').textContent = n;
  $('stRlN').classList.toggle('hide', !n);
}
// A new review item for one row, with the figures it was based on.
function staItem(r, kind, extra) {
  const who = String(ME.email || '').split('@')[0].split(/[._]/)[0];
  return Object.assign({
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), v: 1, brand: r.brand, kind,
    key: r.type === 'term' ? r.key : '', pathKey: r.pathKey, term: r.type === 'term' ? r.term : '', target: staPathLabel(r.kw, r.mt),
    kw: r.kw || '', mt: r.mt || '', kid: r.kid || '', cid: r.cid, ag: r.ag, cn: r.cn, agn: r.agn,
    ev: { c: r.c, sp: staR2(r.sp), o: r.o, s: staR2(r.s), win: STM && STM.settled ? 'settled' : '30d' },
    status: 'review', by: who ? who[0].toUpperCase() + who.slice(1) : '', byEmail: ME.email || '', at: Date.now(),
  }, extra);
}
// A negative item: type negativeExact / negativePhrase / na (ASIN), level cp / ag.
function staNegItem(r, type, level) {
  const why = r.kind === 'none' ? `0 orders in ${staInt(r.c)} clicks${r.chance != null ? ' · ' + (r.chance * 100).toFixed(1) + '% chance' : ''}`
    : r.kind === 'be' ? `ACoS ${staPct(r.acos)} vs break-even ${staPct(r.ln.be)}`
      : r.role === 'other' ? `Competing path · ${staMoney(r.excess)} above the lead path's ACoS` : `ACoS ${staPct(r.acos)}`;
  return staItem(r, 'neg', {
    neg: { type, level },
    what: (type === 'na' ? 'Negative ASIN' : STA.NEG[type].t) + ' · ' + (level === 'cp' ? 'campaign level' : 'ad-group level'), why,
  });
}
// "Add negative exact", "Raise bid"… for the review list.
function staKindName(x) {
  if (x.kind === 'neg') return x.neg.type === 'na' ? 'Add negative ASIN' : 'Add ' + STA.NEG[x.neg.type].t.toLowerCase();
  if (x.kind === 'bid') return x.bid.dir === 'up' ? 'Raise bid' : 'Reduce bid';
  if (x.kind === 'pause') return 'Pause';
  if (x.kind === 'exact') return 'Add as exact';
  return 'Target this ASIN';
}

/* DONE, SEEN AT AMAZON. An item that went out in a bulk file is "done" once Amazon's own record (adEntities) shows it:
 * the negative there, the keyword created, the bid at the new value, the target paused. Written back once. */
async function staRlSeen() {
  if (!ST.ent) return;
  const jobs = [];
  ST_RL.items.forEach(x => {
    if (x.status !== 'exported') return;
    const E = staEnt(x.brand);
    if (!E) return;
    let seen = false;
    if (x.kind === 'neg') {
      const where = x.neg.level === 'cp' ? 'cp|' + x.cid : 'ag|' + x.ag;
      seen = staNegAtAmazon(x.brand, where, x.term, x.neg.type === 'na' ? 'na' : x.neg.type === 'negativePhrase' ? 'np' : 'nx') === true;
    } else if (x.kind === 'exact') seen = E.kw.has(x.dest.ag + '|' + staLow(x.term) + '|exact');
    else if (x.kind === 'asinT') seen = E.tg.has(x.dest.ag + '|asin="' + staLow(x.term) + '"');
    else {
      const hit = staEntOf(x.brand, x.ag, x.kw, x.mt);
      seen = !!hit && (x.kind === 'pause' ? /PAUSED/i.test(hit.st || '') : Math.abs((hit.bid || 0) - x.bid.to) < 0.005);
    }
    if (seen) {
      x.status = 'done';
      x.doneAt = Date.now();
      jobs.push(staRlSave(x).catch(() => { /* shown as done anyway; written next time */ }));
    }
  });
  await Promise.all(jobs);
}

// Open the review list.
function staRlOpen() {
  ST_RL.sel = new Set();
  $('stRl').classList.remove('hide');
  staRlDraw();
}
// Draw the review list for the tab picked (open / done / removed).
function staRlDraw() {
  const tab = ST_RL.tab;
  $('stRlSeg').querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x.dataset.r === tab));
  const list = ST_RL.items.filter(x => tab === 'open' ? (x.status === 'review' || x.status === 'approved')
    : tab === 'done' ? (x.status === 'exported' || x.status === 'done') : x.status === 'removed');
  const open = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved');
  const appr = open.filter(x => x.status === 'approved').length;
  $('stRlSub').textContent = `${open.length} change${open.length === 1 ? '' : 's'} waiting${appr ? `: ${appr} approved` : ''}. Each one keeps the figures it was based on, so you can see why it was suggested.`;
  const chip = x => x.status === 'review' ? staBadge('Waiting') : x.status === 'approved' ? staBadge('Approved', 'ok')
    : x.status === 'exported' ? staBadge('In bulk file · ' + staDay(x.exportedAt), 'info') : x.status === 'done' ? staBadge('Done · seen at Amazon', 'ok') : staBadge('Removed', 'warn');
  const when = x => `${staEsc(x.by || '')}<br>${new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const body = list.map(x => {
    const blocked = staBulkRow(x).skip;
    return `<tr>
      <td>${tab === 'open' ? `<input type="checkbox" class="sta-cb" data-rl="${staEsc(x.id)}"${ST_RL.sel.has(x.id) ? ' checked' : ''}>` : ''}</td>
      <td><b>${staEsc(staKindName(x))}</b><small class="sta-s">${staEsc(staBrandName(x.brand))}</small></td>
      <td class="sta-term">${staEsc(x.term || x.target)}${x.term && x.kind !== 'neg' ? `<small class="sta-s">${staEsc(x.target)}</small>` : ''}</td>
      <td class="sta-rlcp" title="${staEsc(x.cn + ' · ' + x.agn)}">${staEsc(x.cn)}<small class="sta-s">${staEsc(x.agn)}</small></td>
      <td class="sta-rlwhat">${staEsc(x.what || '')}${blocked && tab === 'open' ? `<small class="sta-s" style="color:var(--rev-ink);white-space:normal">${staEsc(blocked)}</small>` : ''}</td>
      <td class="sta-ev">${staEsc(x.why || '')}<br><span class="sta-dash">${staInt(x.ev.c)} clicks · ${staMoney(x.ev.sp)} · ${staInt(x.ev.o)} orders</span></td>
      <td style="color:var(--muted);white-space:nowrap">${when(x)}</td>
      <td>${chip(x)}</td></tr>`;
  }).join('');
  $('stRlTable').innerHTML = `<thead><tr><th style="width:28px">${tab === 'open' ? '<input type="checkbox" class="sta-cb" data-rlall="1">' : ''}</th><th>Change</th><th>Search term / target</th>
    <th>Campaign</th><th>What changes</th><th>Why</th><th>Added</th><th>Status</th></tr></thead><tbody>`
    + (body || `<tr><td colspan="8" class="muted" style="padding:14px 22px">${tab === 'open' ? 'Nothing waiting. Pick a change from any view with its button.' : 'Nothing here yet.'}</td></tr>`) + '</tbody>';
  const note = $('stRlNote');
  note.classList.toggle('warn', ST_RL.where === 'local');
  note.innerHTML = (ST_RL.where === 'local'
    ? '<b>Kept in this browser only.</b> The shared review list needs its database rules switched on (Ravi: adsActions in firestore.rules). Until then, what is added here is not seen on another computer. '
    : '')
    + 'Sellora changes nothing at Amazon yet. Approved changes download as an Amazon bulk file, one per brand, to upload in the Ads console '
    + '(Campaign manager → Bulk operations). Once edit access is confirmed, Approve will apply them directly, with an undo.';
  staRlSelTxt();
}
// The footer of the review list: how many are ticked, and what the buttons will do.
function staRlSelTxt() {
  const sel = [...ST_RL.sel].map(id => ST_RL.items.find(x => x.id === id)).filter(Boolean);
  const appr = ST_RL.items.filter(x => x.status === 'approved');
  const ready = appr.filter(x => !staBulkRow(x).skip).length;
  $('stRlSel').textContent = ST_RL.tab !== 'open' ? '' : sel.length ? `${sel.length} selected` : 'Tick changes to approve or remove them.';
  $('stRlApprove').textContent = sel.length ? `Approve ${sel.filter(x => x.status === 'review').length}` : 'Approve';
  $('stRlApprove').disabled = ST_RL.tab !== 'open' || !sel.some(x => x.status === 'review');
  $('stRlRemove').disabled = ST_RL.tab !== 'open' || !sel.length;
  $('stRlDl').textContent = `Download bulk file · ${ready} approved`;
  $('stRlDl').disabled = !ready;
}
// Approve or remove the ticked items.
async function staRlSet(status) {
  const ids = [...ST_RL.sel];
  for (const id of ids) {
    const x = ST_RL.items.find(y => y.id === id);
    if (!x || (status === 'approved' && x.status !== 'review')) continue;
    x.status = status;
    if (status === 'approved') {
      x.approvedBy = String(ME.email || '');
      x.approvedAt = Date.now();
    }
    try { await staRlSave(x); } catch (e) { /* the next save writes it */ }
  }
  ST_RL.sel = new Set();
  STM = null;
  staRlDraw();
  renderSt();
}

/* ================= THE BULK FILE =================
 * One row of Amazon's Sponsored Products bulk sheet per approved item, in the columns of STA_BULK_COLS. Negatives and new
 * keywords need only the campaign and ad-group IDs the reports already carry; a bid or a pause changes an existing
 * keyword or target and needs its own ID, which only Amazon's record (adEntities) holds — without it the item waits. */
// { row: { column → value } } for one item, or { skip: why it cannot go into a file yet }.
function staBulkRow(x) {
  const base = { 'Product': 'Sponsored Products', 'Campaign ID': x.cid };
  if (!x.cid) return { skip: 'No campaign ID on record.' };
  if (x.kind === 'neg') {
    if (x.neg.type === 'na') {
      if (!x.ag) return { skip: 'No ad-group ID on record.' };
      return { row: Object.assign(base, { 'Entity': 'Negative Product Targeting', 'Operation': 'Create', 'Ad Group ID': x.ag, 'State': 'enabled',
        'Product Targeting Expression': 'asin="' + String(x.term).toUpperCase() + '"' }) };
    }
    const cp = x.neg.level === 'cp';
    if (!cp && !x.ag) return { skip: 'No ad-group ID on record.' };
    return { row: Object.assign(base, { 'Entity': cp ? 'Campaign Negative Keyword' : 'Negative Keyword', 'Operation': 'Create',
      'Ad Group ID': cp ? '' : x.ag, 'State': 'enabled', 'Keyword Text': x.term, 'Match Type': x.neg.type }) };
  }
  if (x.kind === 'exact' || x.kind === 'asinT') {
    const d = x.dest || {};
    if (!d.cid || !d.ag) return { skip: 'No destination ad group on record.' };
    return { row: Object.assign(base, { 'Campaign ID': d.cid, 'Ad Group ID': d.ag, 'Operation': 'Create', 'State': 'enabled', 'Bid': x.newBid },
      x.kind === 'exact' ? { 'Entity': 'Keyword', 'Keyword Text': x.term, 'Match Type': 'exact' }
        : { 'Entity': 'Product Targeting', 'Product Targeting Expression': 'asin="' + String(x.term).toUpperCase() + '"' }) };
  }
  // bid / pause: the keyword's or target's own ID.
  // Amazon's record first; else the ID the settled report carried (stSettled / tgtSettled keywordId).
  const hit = staEntOf(x.brand, x.ag, x.kw, x.mt) || (x.kid ? { id: x.kid, kind: staKwMt(x.mt) ? 'kw' : 'tg' } : null);
  if (!hit) return { skip: ST.ent ? "Not found in Amazon's record of keywords and targets (it may have been archived)." : "Waits for Amazon's keyword and target IDs (backend step 1)." };
  const kwRow = hit.kind === 'kw';
  return { row: Object.assign(base, { 'Entity': kwRow ? 'Keyword' : 'Product Targeting', 'Operation': 'Update', 'Ad Group ID': x.ag,
    [kwRow ? 'Keyword ID' : 'Product Targeting ID']: hit.id }, x.kind === 'pause' ? { 'State': 'paused' } : { 'Bid': x.bid.to }) };
}

// An .xlsx of one sheet (rows[0] the heading) — Listing Content's zip and XML helpers, a plain bold heading, IDs as text.
function staXlsx(sheet, rows) {
  const cell = (v, ref, rowIx) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${rowIx === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
    const s = String(v == null ? '' : v);
    if (s === '') return '';
    return `<c r="${ref}" t="inlineStr"${rowIx === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${lcXml(s)}</t></is></c>`;
  };
  const x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ws = x + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + rows.map((cells, i) => `<row r="${i + 1}">${cells.map((v, j) => cell(v, lcColName(j) + (i + 1), i)).join('')}</row>`).join('')
    + '</sheetData></worksheet>';
  const styles = x + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  return lcZip([
    ['[Content_Types].xml', x + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', x + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', x + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${lcXml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', x + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', ws],
    ['xl/styles.xml', styles],
  ]);
}

// Download every approved item that can go into a file, one file per brand (each brand is its own ad account), and mark
// them "in bulk file". Items that still wait for an ID stay approved.
async function staDownload() {
  const ready = ST_RL.items.filter(x => x.status === 'approved').map(x => ({ x, b: staBulkRow(x) })).filter(y => !y.b.skip);
  if (!ready.length) return;
  const day = new Date().toISOString().slice(0, 10);
  const brands = [...new Set(ready.map(y => y.x.brand))];
  for (const b of brands) {
    const mine = ready.filter(y => y.x.brand === b);
    const rows = [STA_BULK_COLS].concat(mine.map(y => STA_BULK_COLS.map(c => y.b.row[c] == null ? '' : y.b.row[c])));
    const blob = new Blob([staXlsx('Sponsored Products Campaigns', rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sellora-bulk-${staBrandName(b)}-${day}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    // A second download straight after the first is sometimes held back by the browser.
    if (brands.length > 1) await new Promise(res => setTimeout(res, 700));
  }
  for (const y of ready) {
    y.x.status = 'exported';
    y.x.exportedAt = Date.now();
    y.x.exportedBy = String(ME.email || '');
    try { await staRlSave(y.x); } catch (e) { /* the next save writes it */ }
  }
  STM = null;
  staRlDraw();
  renderSt();
}

/* ================= EVENTS ================= */

// The view switch: a box, or a segment of stViewSeg ('neg' and 'harvest' still open, from older links).
function staSetView(v) {
  if (v === 'neg' || v === 'waste') {
    ST_SUB = v === 'waste' ? 'target' : 'term';
    v = 'burn';
  }
  if (v === 'harvest') v = 'scale';
  ST_VIEW = v;
  ST_SHOW = STA.PAGE;
  if (v === 'cp' && !CP.loaded) {
    ensureCp().then(renderSt);
    return;
  }
  renderSt();
}
$('stViewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if (b) staSetView(b.dataset.v);
});
$('stBoxes').addEventListener('click', e => {
  const b = e.target.closest('[data-box]');
  if (!b) return;
  if (b.dataset.box === 'rl') staRlOpen(); else staSetView(b.dataset.box);
});
$('stBurnSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  ST_SUB = b.dataset.s;
  ST_SHOW = STA.PAGE;
  renderSt();
});
// The brand picker redraws at once; a new brand empties the ticks.
$('stBrand').addEventListener('change', () => {
  ST_SEL.clear();
  ST_SHOW = STA.PAGE;
  renderSt();
});
$('stCpShow').addEventListener('change', renderSt);
// The target ACoS typed last time comes back from localStorage.
try {
  const t = localStorage.getItem('stCpTarget');
  if (t) $('stCpTarget').value = t;
} catch (e) { /* no storage */ }
// Typing a target ACoS remembers it and redraws after a short pause.
$('stCpTarget').addEventListener('input', () => {
  try { localStorage.setItem('stCpTarget', $('stCpTarget').value); } catch (e) { /* no storage */ }
  clearTimeout(ST_FT);
  ST_FT = setTimeout(renderSt, 250);
});
// Typing in the filter or the minimum spend redraws after the same short pause.
['stFilter', 'stMinSpend'].forEach(id =>
  $(id).addEventListener('input', () => {
    clearTimeout(ST_FT);
    ST_SHOW = STA.PAGE;
    ST_FT = setTimeout(renderSt, 250);
  }));
// The table: a next-step button opens the dialog; a tick selects a row for the selection bar.
$('stTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (b) {
    staOpen(b.dataset.act, b.dataset.k);
    return;
  }
  const cb = e.target.closest('input[data-sel],input[data-selall]');
  if (!cb) return;
  const M = staModel();
  if (cb.dataset.selall) {
    $('stTable').querySelectorAll('input[data-sel]').forEach(x => {
      const r = M.byKey.get(x.dataset.sel);
      if (!r) return;
      if (cb.checked) ST_SEL.set(r.key, r); else ST_SEL.delete(r.key);
    });
  } else {
    const r = M.byKey.get(cb.dataset.sel);
    if (r) { if (cb.checked) ST_SEL.set(r.key, r); else ST_SEL.delete(r.key); }
  }
  renderSt();
});
$('stFoot').addEventListener('click', e => {
  if (!e.target.closest('[data-more]')) return;
  ST_SHOW += STA.PAGE;
  renderSt();
});
// The selection bar: every ticked row becomes a negative exact (campaign level, or ad group where the campaign also sells
// the term; ASINs at ad group), after the same checks the dialog runs. Rows a check stops are left out and named.
$('stSelAdd').addEventListener('click', async () => {
  const M = staModel();
  const rows = [...ST_SEL.values()];
  let added = 0;
  const skipped = [];
  for (const r of rows) {
    const asin = r.asin;
    const sameCp = M.rows.some(x => x.brand === r.brand && x.tl === r.tl && x.ag !== r.ag && x.cid === r.cid && x.o > 0);
    const level = asin || sameCp || r.pathLevel === 'ag' ? 'ag' : 'cp';
    const type = asin ? 'na' : 'negativeExact';
    const P = (M.protect || {})[r.brand] || { ownAsins: new Set(), brandTerms: new Set() };
    const words = r.term.trim().split(/\s+/).length;
    const brandHit = [...P.brandTerms].some(w => w && (' ' + r.tl + ' ').includes(' ' + w + ' '));
    const where = level === 'cp' ? 'cp|' + r.cid : 'ag|' + r.ag;
    if ((asin && P.ownAsins.has(r.tl)) || brandHit) { skipped.push(`"${r.term}" (brand term or own ASIN)`); continue; }
    if (!asin && (words > STA.NEG.negativeExact.words || r.term.length > STA.NEG.negativeExact.chars)) { skipped.push(`"${r.term}" (too long)`); continue; }
    if (staNegAtAmazon(r.brand, where, r.term, asin ? 'na' : 'nx')) { skipped.push(`"${r.term}" (already negated)`); continue; }
    try {
      await staRlSave(staNegItem(r, type, level));
      added++;
    } catch (e) { skipped.push(`"${r.term}" (${e.message || e})`); }
  }
  ST_SEL.clear();
  STM = null;
  renderSt();
  stFoot(`<span>Added ${added} negative${added === 1 ? '' : 's'} to the review list${skipped.length ? ` · left out ${skipped.length}: ${staEsc(skipped.slice(0, 4).join(', '))}${skipped.length > 4 ? '…' : ''}` : ''}.</span>`);
});
$('stSelClear').addEventListener('click', () => {
  ST_SEL.clear();
  renderSt();
});
// The dialog: every field change re-runs the checks; the buttons; Escape and the backdrop close it.
$('stDlgBody').addEventListener('input', e => {
  if (e.target.id === 'stBidNew') e.target.dataset.touched = '1';
  staDlgCheck();
});
$('stDlgBody').addEventListener('change', staDlgCheck);
$('stDlgOk').addEventListener('click', staDlgOk);
$('stDlgCancel').addEventListener('click', staClose);
$('stDlgX').addEventListener('click', staClose);
$('stDlg').addEventListener('click', e => { if (e.target === $('stDlg')) staClose(); });
// The review list: open, tabs, ticks, the three buttons, close.
$('stRlBtn').addEventListener('click', staRlOpen);
$('stRlX').addEventListener('click', () => $('stRl').classList.add('hide'));
$('stRl').addEventListener('click', e => { if (e.target === $('stRl')) $('stRl').classList.add('hide'); });
$('stRlSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  ST_RL.tab = b.dataset.r;
  ST_RL.sel = new Set();
  staRlDraw();
});
$('stRlTable').addEventListener('change', e => {
  const cb = e.target.closest('input[data-rl],input[data-rlall]');
  if (!cb) return;
  if (cb.dataset.rlall) {
    $('stRlTable').querySelectorAll('input[data-rl]').forEach(x => {
      x.checked = cb.checked;
      if (cb.checked) ST_RL.sel.add(x.dataset.rl); else ST_RL.sel.delete(x.dataset.rl);
    });
  } else if (cb.checked) ST_RL.sel.add(cb.dataset.rl); else ST_RL.sel.delete(cb.dataset.rl);
  staRlSelTxt();
});
$('stRlApprove').addEventListener('click', () => staRlSet('approved'));
$('stRlRemove').addEventListener('click', () => staRlSet('removed'));
$('stRlDl').addEventListener('click', staDownload);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('stDlg').classList.contains('hide')) staClose();
  else if (!$('stRl').classList.contains('hide')) $('stRl').classList.add('hide');
});

// Export: every row of the current view (not just the ones drawn) as a CSV; the cp view has its own (cpCsv).
$('stCsv').onclick = () => {
  if (ST_VIEW === 'cp') {
    cpCsv();
    return;
  }
  if (!ST_LAST.length) {
    stFoot('Nothing to export.', true);
    return;
  }
  // --- one CSV cell: quoted when it holds a comma, a quote or a line break ---
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const pct = v => v == null ? '' : Math.round(v * 10) / 10;
  const cols = ['Brand', 'View', ST_VIEW === 'burn' && ST_SUB === 'target' ? 'Keyword / target' : 'Search term', 'Target', 'Match type',
    'Campaign', 'Ad group', 'ASINs', 'Impressions', 'Clicks', 'Spend', 'Orders', 'Sales', 'ACoS %', 'Target ACoS %', 'Break-even ACoS %',
    'Verdict', 'Money burned', 'Next step', 'Status', 'Evidence'];
  const lines = [cols.map(cell).join(',')];
  const NEXT = { neg: 'Add negative', reduce: 'Reduce bid', raise: 'Raise bid', exact: 'Add as exact', asinT: 'Target this ASIN',
    pause: 'Pause', limit: 'Bid is not the limit', lowstock: 'Low stock: no raise' };
  const rows = ST_VIEW === 'paths' ? ST_LAST.flatMap(g => g.shown) : ST_LAST;
  rows.forEach(r => lines.push([staBrandName(r.brand), ST_VIEW + (ST_VIEW === 'burn' ? ' by ' + ST_SUB : ''), r.term, r.kw || '', r.mt || '',
    r.cn, r.agn, (r.asins || []).join(' '), r.i, r.c, r.sp, r.o, r.s, pct(r.acos), pct(r.ln && r.ln.tgt), pct(r.ln && r.ln.be),
    (r.badges || []).map(x => x[0]).join('; ') || (r.kind === 'none' ? 'No sales' : r.kind === 'be' ? 'Above break-even' : ''),
    r.burned ? staR2(r.burned) : '', NEXT[r.next] || '', r.status || '', strip(r.ev)].map(cell).join(',')));
  // --- download ---
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'search-term-analysis-' + ST_VIEW + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};


/* ================= CAMPAIGN × PRODUCT =================
 *
 * Ravi, 2026-10-03: "mujhe ek aisa view chahiye jisme me pata laga saku ki mera kis campaign me kis product me mera
 * achcha ya bura chal rha h and uska action kya and uske against me stock h ya nahi" — then "add indivisual tacos and
 * add kro ki wo particular asin active h or pause h us campaign me".
 *
 * One row per (campaign, ad group, SKU) over the same 30-day window as the search terms, from the advertised-product
 * report the nightly run asks for. Beside it: whether that ad is running today (one letter per row, from Amazon's
 * product-ad / ad-group / campaign lists, read nightly), the FBA stock of that SKU (stock/{brand}), days of cover and the
 * ASIN's own TACoS over the last four finished weeks (PPC & Organic's store), and the break-even ACoS where the unit
 * cost is known (Profit & Margin).
 *
 * The verdict asks: is it running at all, then STOCK, then evidence (under CP_MIN_CLICKS clicks with no order nothing
 * can be said yet), then the money against the break-even ACoS or the typed target. Sellora only ADVISES — nothing
 * here changes a bid, a state or a campaign at Amazon.
 *
 * SPEED: everything that does not depend on the target ACoS is worked out ONCE per load (cpBase); a keystroke in the
 * filter or the target only re-runs the verdict and the filter over that list.
 */
const CP_MIN_CLICKS = 10;       // clicks before "no order" is evidence rather than chance
const CP_LOW_COVER = 14;        // days of stock below which the ad is slowed so the product does not run out
const CP_SCALE_COVER = 45;      // days of stock needed before "spend more" is advice anyone can follow
const CP_TARGET_DEFAULT = 30;   // ACoS % used when the unit cost is not known and nothing is typed in
// The one-letter ad status from the nightly run → its label and tooltip.
const CP_STATE = {
  E: { t: 'Active', tip: 'Ad, ad group and campaign are all enabled.' },
  a: { t: 'Paused — ad', tip: 'This product is paused inside the ad group.' },
  g: { t: 'Paused — ad group', tip: 'The ad group holding this product is paused.' },
  c: { t: 'Paused — campaign', tip: 'The whole campaign is paused.' },
  A: { t: 'Archived', tip: 'The ad, its ad group or its campaign is archived.' },
  '?': { t: 'Not found', tip: "Not in Amazon's lists when they were last read." },
};
// stock = per brand { sku → FBA units }, stockAt = when each was saved, base = cpBase's list once worked out.
let CP = { loaded: false, basics: null, stock: {}, stockAt: {}, base: null };
// The rows of the last cp draw, for the export.
let CP_LAST = [];

// First use of the cp view: the stock, sales and costs (cpLoadBasics, often already in from Search Term Analysis), and
// Listing Health for the product titles.
async function ensureCp() {
  if (CP.loaded) return;
  stMsg('Loading the FBA stock, weekly sales, unit costs and product titles…');
  await Promise.all([
    cpLoadBasics(),
    (async () => {
      try {
        if (!H_LOADED) await loadHealthCache();
      } catch (e) { /* titles stay blank */ }
    })(),
  ]);
  CP.loaded = true;
  CP.base = null;
  stMsg('');
}
// The FBA stock of both brands, the weekly sales and the unit costs — what every break-even and every stock check needs.
// Once per session, all at the same time; a second caller waits on the same promise.
function cpLoadBasics() {
  if (CP.basics) return CP.basics;
  const stockOf = async b => {
    try {
      const snap = await getDoc(doc(db, 'stock', b));
      if (!snap.exists()) return;
      const d = snap.data();
      CP.stock[b] = d.m || {};
      CP.stockAt[b] = d.at && d.at.toDate ? d.at.toDate() : null;
    } catch (e) { /* no read access, or never saved — stock shows as unknown */ }
  };
  CP.basics = Promise.all([
    stockOf('SP'), stockOf('CPC'),
    (async () => {
      try {
        if (!WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) await loadWeekly();
      } catch (e) { /* cover unknown */ }
    })(),
    (async () => {
      try {
        await loadCosts();
      } catch (e) { /* break-even unknown */ }
    })(),
  ]);
  return CP.basics;
}

/** Units a day, price and the ASIN's TACoS, from the last four FINISHED weeks of its sales. Null when there are none. */
// { perDay, price, tacos } for one ASIN from WEEKLY, or null when it has no finished weeks.
function cpPace(asin) {
  const r = WEEKLY.rows[asin];
  if (!r || !r.weeks) return null;
  const wks = Object.keys(r.weeks).filter(wWeekDone).sort().slice(-4);
  if (!wks.length) return null;
  let u = 0, rev = 0, spend = 0, spendKnown = false;
  wks.forEach(k => {
    const c = r.weeks[k];
    u += c.u || 0;
    rev += c.rev || 0;
    if (c.spend != null) {
      spend += c.spend;
      spendKnown = true;
    }
  });
  return {
    perDay: u / (wks.length * 7),
    price: u > 0 ? rev / u : null,
    tacos: spendKnown && rev > 0 ? spend / rev * 100 : null
  };
}

/** The ACoS at which an ad sale makes nothing — what is left of the price after cost and fees, as a % of it. */
// Break-even ACoS % for one ASIN at the price given, from Profit & Margin's unit cost and fee model; null if unknown.
function cpBreakEven(asin, price) {
  const cost = pfCostOf(asin);
  if (!(cost > 0) || !(price > 0)) return null;
  const pctOfPrice = (PF_MODEL.ref + PF_MODEL.fba + PF_MODEL.oh + PF_MODEL.sal) / 100;
  return (price * (1 - pctOfPrice) - cost * (1 + PF_MODEL.ret / 100)) / price * 100;
}

/** { v: 'bad' | 'watch' | 'good' | '', act, why } — running?, then stock, then evidence, then money. */
// The verdict for one cp row: v = its colour class, act = the short advice, why = the sentence behind it.
function cpVerdict(r) {
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const acos = r.s > 0 ? r.sp / r.s * 100 : null;
  const tgt = r.be != null ? r.be : r.tgt;
  const tgtTxt = r.be != null ? `break-even ${Math.round(r.be)}%` : `target ${Math.round(r.tgt)}%`;
  // --- running at all? ---
  /* Not running today: nothing to cut. Only worth a word when it was working and the stock is there to sell. */
  if (r.st && r.st !== 'E' && r.st !== '?') {
    const where = (CP_STATE[r.st] || {}).t || 'Stopped';
    if (r.st !== 'A' && r.o >= 3 && acos != null && tgt > 0 && acos <= tgt && r.stock > 0
      && (r.cover == null || r.cover >= CP_LOW_COVER)) {
      return { v: 'watch', act: 'Paused but was working',
        why: `${where}. In the 30 days it made ${r.o} orders at ACoS ${Math.round(acos)}% (within the ${tgtTxt}) and ${r.stock.toLocaleString('en-US')} are in stock — worth turning back on.` };
    }
    return { v: '', act: 'Not running', why: `${where} — nothing to change. It spent ${money(r.sp)} in the 30 days.` };
  }
  // --- stock ---
  if (r.stock === 0 && r.sp > 0) {
    return { v: 'bad', act: 'Pause — no stock',
      why: `FBA stock is 0 and this ad spent ${money(r.sp)} in 30 days. Pause it until stock lands.` };
  }
  if (r.cover != null && r.cover < CP_LOW_COVER && r.o > 0) {
    return { v: 'watch', act: 'Slow down — low stock',
      why: `About ${Math.round(r.cover)} days of stock left. Lower the bids so it does not run out before the next shipment.` };
  }
  // --- evidence ---
  if (!(r.o > 0) && r.c < CP_MIN_CLICKS) {
    return { v: '', act: 'Too early',
      why: `${r.c} click${r.c === 1 ? '' : 's'} and no order yet — not enough to judge. Leave it running.` };
  }
  if (!(r.o > 0)) {
    return { v: 'bad', act: 'Pause / cut bids', why: `${money(r.sp)} on ${r.c} clicks and not one order.` };
  }
  // --- money ---
  if (tgt <= 0) {
    return { v: 'bad', act: 'Loses money',
      why: 'At this price and unit cost the product loses money before any ad, so every ad sale adds to the loss. '
        + 'Fix the price or the cost first.' };
  }
  if (acos > tgt) {
    return { v: 'bad', act: 'Lower bids',
      why: `ACoS ${Math.round(acos)}% is over the ${tgtTxt} — each ad sale costs more than it should.` };
  }
  if (acos <= tgt * 0.7 && r.o >= 3 && r.cover != null && r.cover >= CP_SCALE_COVER) {
    return { v: 'good', act: 'Scale up',
      why: `ACoS ${Math.round(acos)}% is well under the ${tgtTxt}, ${r.o} orders, ${Math.round(r.cover)} days of stock. Raise the budget or bids.` };
  }
  return { v: 'good', act: 'Keep', why: `ACoS ${Math.round(acos)}% is within the ${tgtTxt}.`
    + (r.cover == null ? ' Stock cover is not known, so no advice to spend more.'
      : r.cover < CP_SCALE_COVER ? ` Only ${Math.round(r.cover)} days of stock — hold here.` : '') };
}

/** Everything that does not change with the target ACoS, worked out once per load. */
// One row per advertised product of both brands, with pace, stock, cover, TACoS and break-even; cached in CP.base.
function cpBase() {
  if (CP.base) return CP.base;
  const out = [], paceOf = {};
  ['SP', 'CPC'].forEach(b => {
    const pack = ST.ag[b] || {};
    const pmap = pack.parent || {}, names = pack.names || {}, stock = CP.stock[b];
    (pack.rows || []).forEach(x => {
      // --- pace and stock of this ASIN / SKU ---
      const pace = x.a in paceOf ? paceOf[x.a] : (paceOf[x.a] = cpPace(x.a));
      const st = stock && x.sku && Object.prototype.hasOwnProperty.call(stock, x.sku)
        ? Number(stock[x.sku]) || 0 : null;
      // --- the row ---
      const r = {
        brand: b,
        cn: names[x.cid] || '',
        agn: names[x.ag] || '',
        asin: x.a,
        sku: x.sku || '',
        parent: pmap[x.a] || '',
        title: wTitle(x.a),
        st: x.st || '',
        i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0,
        // OWN sales (this SKU only). Absent on caches built before 2026-10-03 — then unknown, never zero.
        os: x.os != null ? x.os : null,
        oo: x.oo != null ? x.oo : null,
        stock: st,
        cover: st != null && pace && pace.perDay > 0 ? st / pace.perDay : null,
        tacos: pace ? pace.tacos : null,
        be: cpBreakEven(x.a, pace && pace.price)
      };
      r.hay = [r.cn, r.agn, r.asin, r.sku, r.parent, r.title, (CP_STATE[r.st] || {}).t || '']
        .join(' ').toLowerCase();
      out.push(r);
    });
  });
  CP.base = out;
  return out;
}

// The cp rows to show: cpBase filtered by brand, spend, Show and text, each given its verdict; bad first.
function cpRows() {
  // --- the filters ---
  const pick = $('stBrand').value;
  const q = $('stFilter').value.trim().toLowerCase();
  const minSp = Number($('stMinSpend').value) || 0;
  const typed = Number($('stCpTarget').value);
  const tgt = typed > 0 ? typed : CP_TARGET_DEFAULT;
  const show = $('stCpShow').value;
  // --- verdict and filter ---
  const rows = [];
  cpBase().forEach(b => {
    if (pick !== 'ALL' && b.brand !== pick) return;
    if (minSp > 0 && b.sp < minSp) return;
    b.tgt = tgt;
    Object.assign(b, cpVerdict(b));
    if (show === 'running' ? b.st !== 'E' : show === 'stopped' ? (b.st === 'E' || !b.st) : show && b.v !== show) return;
    if (q && !(b.hay + ' ' + b.act.toLowerCase()).includes(q)) return;
    rows.push(b);
  });
  // --- sort ---
  // Bad first, and the biggest spend first inside each — the money leaving is what gets read first.
  const rank = { bad: 0, watch: 1, good: 2, '': 3 };
  rows.sort((x, y) => (rank[x.v] - rank[y.v]) || (y.sp - x.sp));
  return rows;
}

// Draw the Campaign × product view: the table (first 300 rows) and the summary in the message line.
function renderCp() {
  const esc = s => String(s == null ? '' : s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  // --- nothing collected yet ---
  const haveRows = ['SP', 'CPC'].some(b => ((ST.ag[b] || {}).rows || []).length);
  if (!haveRows) {
    $('stTable').innerHTML = '';
    stFoot('No campaign × product figures yet. The nightly run keeps them, so they appear here the morning after, for the '
      + 'same 30 days as the search terms.', true);
    return;
  }
  // --- rows ---
  const rows = cpRows();
  CP_LAST = rows;
  const CAP = 300, shown = rows.slice(0, CAP);
  const TAG = { bad: 'st-rejected', watch: 'st-pending', good: 'st-approved' };
  const dash = '<span class="muted">—</span>';
  // --- build table: header ---
  const head = '<thead><tr>'
    + '<th class="frz">Campaign</th><th>Ad group</th><th>ASIN</th><th>SKU</th>'
    + '<th title="Is this product\'s ad running today? Ad, ad group and campaign must all be enabled.">Ad status</th>'
    + '<th class="num">Clicks</th><th class="num">Spend</th><th class="num">Orders</th><th class="num">Sales</th>'
    + '<th class="num" title="This ad\'s spend ÷ ALL the sales Amazon gives it, 30 days — as in Campaign Manager. '
      + 'Includes other products the shopper bought after the click.">ACoS</th>'
    + '<th class="num" title="Sales of THIS SKU only that came from this ad, 30 days.">Own sales</th>'
    + '<th class="num" title="This ad\'s spend ÷ sales of THIS SKU only. '
      + 'Far above the ACoS means the ad mostly sells other products, not the one it advertises.">ACoS (own)</th>'
    + '<th class="num" title="The ASIN\'s TOTAL ad spend ÷ its TOTAL sales (ads + organic), last four finished weeks — '
      + 'the same for every campaign it is in. It can sit far above the ACoS: '
      + 'Amazon counts in an ad sale what the shopper bought of OTHER products after the click, '
      + 'so an ad can look cheap while the product it advertises sells little itself.">TACoS (ASIN)</th>'
    + '<th class="num" title="Orders ÷ clicks.">Conv.</th>'
    + '<th class="num" title="The ACoS at which an ad sale makes nothing: price less unit cost and fees, as a % of the price. '
      + 'Blank when the unit cost is not in Profit &amp; Margin.">Break-even</th>'
    + '<th class="num" title="FBA stock of this SKU that Amazon can sell now.">FBA stock</th>'
    + '<th class="num" title="FBA stock ÷ units a day over the last four finished weeks of this ASIN.">Days of cover</th>'
    + '<th>Verdict</th><th>What to do</th>'
    + '</tr></thead>';
  // --- build table: the Ad status cell ---
  const stCell = r => {
    if (!r.st) return dash;
    const x = CP_STATE[r.st] || CP_STATE['?'];
    return `<span class="st ${r.st === 'E' ? 'st-approved' : r.st === '?' ? 'st-draft' : 'st-pending'}" title="${esc(x.tip)}">${esc(x.t)}</span>`;
  };
  // --- build table: body ---
  const body = shown.map(r => '<tr>'
    + `<td class="frz" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600" title="${esc(r.cn)}">${esc(r.cn) || dash}</td>`
    + `<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.agn)}">${esc(r.agn) || dash}</td>`
    + `<td style="font-family:ui-monospace,monospace" title="${esc(r.title)}">${esc(r.asin)}</td>`
    + `<td style="font-family:ui-monospace,monospace">${esc(r.sku) || dash}</td>`
    + `<td style="white-space:nowrap">${stCell(r)}</td>`
    + `<td class="num">${r.c}</td>`
    + `<td class="num">${money(r.sp)}</td>`
    + `<td class="num"${r.o ? ' style="font-weight:700"' : ''}>${r.o}</td>`
    + `<td class="num">${money(r.s)}</td>`
    + `<td class="num">${r.s > 0 ? Math.round(r.sp * 100 / r.s) + '%' : dash}</td>`
    + `<td class="num">${r.os != null ? money(r.os) : dash}</td>`
    + `<td class="num">${r.os == null ? dash : r.os > 0 ? Math.round(r.sp * 100 / r.os) + '%' : (r.sp > 0 ? '<span class="muted" title="Spent, and not one of this SKU sold from it">no own sale</span>' : dash)}</td>`
    + `<td class="num">${r.tacos != null ? Math.round(r.tacos) + '%' : dash}</td>`
    + `<td class="num">${r.c > 0 ? (r.o / r.c * 100).toFixed(1) + '%' : dash}</td>`
    + `<td class="num">${r.be != null ? Math.round(r.be) + '%' : dash}</td>`
    + `<td class="num"${r.stock === 0 ? ' style="color:var(--bad-ink);font-weight:700"' : ''}>${r.stock != null ? r.stock.toLocaleString('en-US') : dash}</td>`
    + `<td class="num">${r.cover != null ? Math.round(r.cover) : dash}</td>`
    + `<td style="white-space:nowrap">${r.v ? `<span class="st ${TAG[r.v]}">${esc(r.act)}</span>` : `<span class="muted">${esc(r.act)}</span>`}</td>`
    + `<td style="min-width:260px;white-space:normal">${esc(r.why)}</td>`
    + '</tr>').join('');
  $('stTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="19" class="muted" style="padding:14px">Nothing matches.</td></tr>') + '</tbody>';

  // --- the summary in the message line ---
  const sum = v => rows.filter(r => r.v === v).reduce((a, r) => {
    a.n++;
    a.sp += r.sp;
    a.s += r.s;
    return a;
  }, { n: 0, sp: 0, s: 0 });
  const bad = sum('bad'), watch = sum('watch'), good = sum('good');
  const running = rows.filter(r => r.st === 'E').length,
    stopped = rows.filter(r => r.st && r.st !== 'E' && r.st !== '?').length;
  const stockAt = Object.entries(CP.stockAt).filter(([, d]) => d)
    .map(([b, d]) => `${BRAND_NAME[b] || b} ${d.toLocaleDateString('en-GB')}`).join(', ');
  const stAt = ['SP', 'CPC'].map(b => (ST.ag[b] || {}).stAt).filter(Boolean)[0];
  stFoot(`<span><b>${rows.length.toLocaleString('en-US')}</b> campaign × product rows`
    + ` (${running.toLocaleString('en-US')} running, ${stopped.toLocaleString('en-US')} paused or archived)`
    + ` · <b style="color:var(--bad-ink)">${bad.n} bad</b> (${money(bad.sp)} spent, ${money(bad.s)} back)`
    + ` · <b>${watch.n} watch</b> (${money(watch.sp)} spent)`
    + ` · <b style="color:var(--accent-ink)">${good.n} good</b> (${money(good.sp)} spent, ${money(good.s)} back)`
    + (rows.length > CAP ? ` · showing the first ${CAP} — narrow it, or Export for all` : '')
    + (ST.at ? ` · built ${esc(ST.at)}` : '') + ' · a 30-day window'
    + (stAt ? ` · ad status read ${esc(stAt)}` : '')
    + (stockAt ? ` · FBA stock as saved ${esc(stockAt)}`
      : ' · <b>no FBA stock saved yet</b> — refresh Listing Health once to fill it')
    + ' · advice only: nothing here changes a bid at Amazon</span>');
}

// Export the cp view: every row of the last draw as a CSV.
function cpCsv() {
  if (!CP_LAST.length) {
    stFoot('Nothing to export.', true);
    return;
  }
  // --- one CSV cell: quoted when it holds a comma, a quote or a line break ---
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // --- header line, then one line per row ---
  const cols = ['Brand', 'Campaign', 'Ad group', 'ASIN', 'SKU', 'Parent', 'Ad status', 'Impressions', 'Clicks', 'Spend',
    'Orders', 'Sales', 'ACoS %', 'Own sales', 'ACoS own %', 'TACoS (ASIN) %', 'Break-even ACoS %', 'FBA stock',
    'Days of cover', 'Verdict', 'What to do'];
  const lines = [cols.map(cell).join(',')];
  CP_LAST.forEach(r => lines.push([
    r.brand, r.cn, r.agn, r.asin, r.sku, r.parent, (CP_STATE[r.st] || {}).t || '',
    r.i, r.c, r.sp, r.o, r.s,
    r.s > 0 ? Math.round(r.sp * 100 / r.s) : '',
    r.os != null ? r.os : '',
    r.os > 0 ? Math.round(r.sp * 100 / r.os) : '',
    r.tacos != null ? Math.round(r.tacos) : '',
    r.be != null ? Math.round(r.be) : '',
    r.stock,
    r.cover != null ? Math.round(r.cover) : '',
    r.act, r.why].map(cell).join(',')));
  // --- download ---
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'campaign-product-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
