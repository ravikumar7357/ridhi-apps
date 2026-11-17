/* ================= ADS · SEARCH TERM ANALYSIS: what shoppers typed, what it cost, what to do — and Campaign × Product =================
 * Screen: Search Term Analysis (tab 'st', pane paneSt; core/nav.js calls ensureSt when it opens). Called "Search Terms"
 * until 14 Nov 2026; its key stays 'st' because permissions are stored under it.
 *
 * Layout, top to bottom:
 *   the bar        brand, filter, minimum spend, Filters (match type, campaign type, verdict, tag), Lists & settings,
 *                  Review list, Export; the data line (stMsg): window, completeness, data checks, unit costs.
 *   summary strip  (stSum) ad spend, sales, ACoS, orders, and the spend in terms too small to be listed.
 *   four boxes     (stBoxes) Burning money, Worth scaling, Competing paths, Review list.
 *   the view card  title, "How Sellora decides", the view switch (burn / scale / paths / all / cp) with Burning money's
 *                  own switch (by search term / by target / by word), the table (stTable) with pages, the footer.
 *   dialogs        stDlg (every change), stRl (review list + bulk-file preview), stSet (lists per brand), stLegend.
 *
 * SELLORA CHANGES NOTHING AT AMAZON. Approved changes leave as a bulk file the user uploads in the Ads console
 * (Campaign manager → Bulk operations). The review items are the shape a later apply route (AdsActions.gs) will read.
 *
 * THE RULES, in the order a row is judged (staVerdict; the numbers are in STA, the words in "How Sellora decides"):
 *   1. Data check: more orders than clicks, orders without sales, sales without clicks → set aside, never used.
 *   2. A brand whose search terms are missing or older than 36 hours gets no suggestions.
 *   3. 30 days first: a product new to ads (weekly ad spend), a new campaign or keyword (Amazon's record, when read),
 *      or a launch campaign (by its name) is not judged.
 *   4. Never a negative on: brand terms, own and sister-brand ASINs, the product's own product words, main keywords
 *      (our own keywords, or 10+ orders), seasonal terms. These get a lower bid on their target, or a stated hold.
 *   5. No sales: judged only when 0 orders in that many clicks is unlikely to be chance (under 5%); otherwise Watch.
 *   6. No unit cost: no profit verdict (above break-even, converts poorly, worth scaling), unless a target ACoS is set
 *      in Lists & settings for that brand.
 *   7. Bids are worked out per keyword or target, from the whole target's figures — one bid line per target.
 *   8. Competing paths only within the same product; the lead path needs 3+ orders and must be under break-even; a
 *      path doing as well as the lead is never negated.
 *
 * Data: three nightly caches (search terms, targets, ad groups) read through baCall — the Overview may hand them over
 * (ads-health.js) — and five optional ones that switch parts on: adEntities (AdsEntities.gs: IDs, bids, negatives,
 * ages), stSettled / stRecent and tgtSettled / tgtRecent (AdsDecide.gs: 7-day sales, settled days 8–37 and the last 7,
 * and the word roll-up of the terms too small to be kept). Break-even and target per ad group from Overview's lines
 * (ADSX.lines); stock, weekly sales and unit costs from cpLoadBasics; product titles from Listing Health.
 *
 * Stored in Firestore: the review list (adsActions/{id}) and the lists (adsSettings/{brand}). Until their rules are
 * deployed (firestore.rules) a read is refused, both are kept in this browser instead, and the page says so.
 */

/* A search term carries NO ASIN — Amazon reports it against the ad group it matched in, and an ad group can advertise
 * several products. A PATH is one way a term reaches us: the campaign, ad group and keyword or target that caught it.
 * Bids belong to the keyword or target, never to the search term, so a bid change moves every term of that target. */

// The three caches and the optional five (each null until the backend writes it); costErr when unit costs could not be read.
let ST = { at: '', terms: {}, tgts: {}, ag: {}, loaded: false, extra: false,
  ent: null, set: null, rec: null, tset: null, trec: null, costs: true, costErr: '' };
// The view, Burning money's sub-view (term / target / word), the rows of the last draw (for the export), the page and its
// size, the sort ({ k: column, d: 1 / -1 }), the ticked rows by key, the open groups of All terms.
let ST_VIEW = 'all', ST_SUB = 'term', ST_LAST = [], ST_PG = 0, ST_SIZE = 100, ST_SORT = { k: '', d: -1 };
const ST_SEL = new Map();
const ST_OPEN = new Set();
let ST_FT = null;

/* THE LINES EVERY VERDICT IS DRAWN WITH. One place, so the dialog, the tables and the legend cannot disagree. */
const STA = {
  MIN_CLICKS: 10,      // clicks before "no order" is evidence at all
  CHANCE: 0.05,        // under this chance of the result by bad luck: "unlikely to be chance"
  RATE_ORDERS: 3,      // orders a target or campaign needs before its own conversion rate is the yardstick
  POOR_CLICKS: 30,     // "converts poorly": at least this many clicks …
  POOR_SHARE: 0.5,     // … and under half the yardstick's conversion rate
  SCALE_ORDERS: 5,     // orders before a raise
  SCALE_SHARE: 0.75,   // a raise needs ACoS at or under 75% of the target
  EXACT_ORDERS: 3,     // orders before "add as exact"
  LEAD_ORDERS: 3,      // a competing path's lead needs this many orders, and ACoS under break-even
  MAIN_ORDERS: 10,     // a term with this many orders across the brand is a main keyword
  STEP: 0.20,          // a bid moves at most 20% a step
  MIN_BID: 0.02,       // Amazon's lowest Sponsored Products bid (USD)
  NOT_LIMIT: 3,        // a bid this many times the CPC is not what holds a term back
  COOLDOWN: 14,        // days after a bid change from Sellora before that bid is judged again
  RAISE_COVER: 30,     // days of FBA stock a raise needs
  AGE_DAYS: 30,        // days of ads before anything is judged
  LOW_ACOS: 3,         // ACoS under this with 3+ orders: probably a data error, never scaled or used as a lead
  STALE_H: 36,         // hours before a brand's search terms count as old
  BRAND_TGT: 50,       // brand terms are judged against this ACoS, never negated
  HALO: 0.3,           // an ad group whose own product brings under 30% of its ad sales is flagged
  DAY_MAX: 60,         // negatives a brand can take into the review list per day
  WORD_TERMS: 5, WORD_SPEND: 20, WORD_CLICKS: 20,   // a word is listed when it spans this many terms, spend and clicks with no order
  // Amazon's limits on keyword text: a negative exact up to 10 words, a negative phrase up to 4; 80 characters each.
  NEG: { negativeExact: { words: 10, chars: 80, t: 'Negative exact' }, negativePhrase: { words: 4, chars: 80, t: 'Negative phrase' } },
  KW: { words: 10, chars: 80 },
};
// The columns of Amazon's Sponsored Products bulk sheet an upload uses (Amazon's blank template, without the
// "Informational only" and performance columns). If Amazon rejects the headers, this is the one list to change.
const STA_BULK_COLS = ['Product', 'Entity', 'Operation', 'Campaign ID', 'Ad Group ID', 'Portfolio ID', 'Ad ID', 'Keyword ID',
  'Product Targeting ID', 'Campaign Name', 'Ad Group Name', 'Start Date', 'End Date', 'Targeting Type', 'State', 'Daily Budget',
  'SKU', 'Ad Group Default Bid', 'Bid', 'Keyword Text', 'Native Language Keyword', 'Native Language Locale', 'Match Type',
  'Bidding Strategy', 'Placement', 'Percentage', 'Product Targeting Expression'];
// Product types: a term that IS one of the advertised product's types ("tablecloth" on a tablecloth) is never negated
// in that product's campaigns. Found in the product titles and the campaign / ad-group names. More in Lists & settings.
const STA_TYPES = ['tablecloth', 'table cover', 'table linen', 'table runner', 'runner', 'placemat', 'place mat', 'napkin',
  'cloth napkin', 'dinner napkin', 'cocktail napkin', 'coaster', 'pillow cover', 'cushion cover', 'pillow case',
  'throw pillow cover', 'throw pillow', 'lumbar pillow cover', 'pillow sham', 'euro sham', 'sham', 'pillow insert',
  'pillow', 'cushion', 'tissue box cover', 'tissue cover', 'tissue holder', 'apron', 'tea towel', 'kitchen towel',
  'dish towel', 'hand towel', 'towel', 'quilt', 'bedspread', 'coverlet', 'duvet cover', 'comforter', 'bed sheet',
  'curtain', 'bread basket', 'oven mitt', 'pot holder', 'tote bag'];
// Campaigns meant to cost more for a while, by name: launch and ranking (seasonal terms have their own rule).
const STA_LAUNCH = /launch|new product|\(new\)|\bnew\b|ranking|\brank\b|preset/i;
// Words that say nothing on their own, left out of the word roll-up.
const STA_STOP = new Set(['a', 'an', 'and', 'the', 'for', 'of', 'with', 'in', 'on', 'to', 'by', 'x', 'set', 'inch', 'inches',
  'in.', 'pack', 'pcs', 'piece', 'pieces', 'size', 'large', 'small', 'big', 'my', 'from', 'or', 'at', 'is', 'it']);

/* ---------- small helpers ---------- */
const staEsc = s => String(s == null ? '' : s)
  .replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const staMoney = v => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const staMoney0 = v => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
const staPct = v => v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%';
const staInt = v => (Number(v) || 0).toLocaleString('en-US');
const staLow = s => String(s || '').toLowerCase().trim();
// Lower case, letters, digits and single spaces.
const staNorm = s => staLow(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// One word in the singular: covers → cover, boxes → box, ruffles → ruffle; "dress", "glass" stay.
const staSing = w => w.length > 3 && /ss$/.test(w) ? w : w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + 'y'
  : w.length > 4 && /(ches|shes|xes|sses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w;
// A comparison key: singular, no spaces — "table cloths", "tablecloth" and "Table-Cloth" are one key.
const staKey = s => staNorm(s).split(' ').map(staSing).join('');
const staIsAsin = t => /^b0[a-z0-9]{8}$/i.test(String(t || '').trim());
const staDash = '<span class="sta-dash">—</span>';
const staBadge = (t, k, tip) => `<span class="ui-badge${k ? ' is-' + k : ''}"${tip ? ` title="${staEsc(tip)}"` : ''}>${staEsc(t)}</span>`;
const staBtn = (t, act, key, cls, tip) => `<button type="button" class="sta-btn${cls ? ' ' + cls : ''}" data-act="${act}" data-k="${staEsc(key)}"${tip ? ` title="${staEsc(tip)}"` : ''}>${staEsc(t)}</button>`;
const staKwMt = mt => /^(BROAD|PHRASE|EXACT)$/i.test(mt || '');
const staAutoMt = mt => /PREDEFINED/i.test(mt || '');
const STA_BRANDS = { SP: 'Ridhi', CPC: 'Cotton Print Club' };
const staBrandName = b => STA_BRANDS[b] || b;
const staR2 = v => Math.round(v * 100) / 100;
const staDay = ms => ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const staDays = ms => Math.floor((Date.now() - ms) / 86400000);
// "yyyy-MM-dd HH:mm" as the backend writes it (India time) → ms; 0 when it cannot be read.
const staStamp = s => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? Date.parse(m[1] + 'T' + m[2] + ':00+05:30') || 0 : 0;
};
// "2026-10-08" → "8 Oct".
const staShortDay = iso => {
  const t = Date.parse(String(iso || '').slice(0, 10) + 'T12:00:00Z');
  return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : String(iso || '');
};
// Clicks still needed before 0 orders would be unlikely to be chance at conversion rate p; 0 when already enough.
const staNeed = (p, c) => p > 0 && p < 1 ? Math.max(0, Math.ceil(Math.log(STA.CHANCE) / Math.log(1 - p)) - c) : 0;
// The chance of o orders or fewer in n clicks at rate p (binomial), worked in logs so large n stays exact enough.
function staBinomLe(o, n, p) {
  if (!(p > 0)) return 1;
  if (p >= 1) return o >= n ? 1 : 0;
  let sum = 0, lc = 0;
  for (let k = 0; k <= o && k <= n; k++) {
    if (k > 0) lc += Math.log(n - k + 1) - Math.log(k);
    sum += Math.exp(lc + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return Math.min(1, sum);
}

// Write the data line under the toolbar (HTML allowed).
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
// The match-type filter's group of a path: exact / phrase / broad / auto / pt.
const staMtGroup = mt => /^EXACT$/i.test(mt) ? 'exact' : /^PHRASE$/i.test(mt) ? 'phrase' : /^BROAD$/i.test(mt) ? 'broad' : staAutoMt(mt) ? 'auto' : 'pt';

/* ---------- the seasonal calendar ----------
 * A seasonal term is never negated: a negative put on "christmas tablecloth" in March would still be there in December.
 * From six weeks before its peak until the peak is over it is "in season"; out of season it is held. */
const staYmd = (y, m, d) => Date.UTC(y, m - 1, d);
// The n-th weekday (0 = Sunday) of a month.
const staNthDow = (y, m, dow, n) => {
  const first = new Date(staYmd(y, m, 1)).getUTCDay();
  return staYmd(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
};
// Easter Sunday (Gregorian computus).
function staEaster(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return staYmd(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
const STA_TABLE = { diwali: { 2026: [11, 8], 2027: [10, 29], 2028: [10, 17] }, hanukkah: { 2026: [12, 4], 2027: [12, 24], 2028: [12, 12] } };
const STA_SEASONS = [
  { t: "Valentine's Day", re: /valentine/, peak: y => staYmd(y, 2, 14) },
  { t: "St Patrick's Day", re: /st\.? ?patrick|shamrock/, peak: y => staYmd(y, 3, 17) },
  { t: 'Easter', re: /easter|bunny/, peak: staEaster },
  { t: "Mother's Day", re: /mother'?s? day/, peak: y => staNthDow(y, 5, 0, 2) },
  { t: '4th of July', re: /4th of july|fourth of july|july 4|patriotic|independence day|americana/, peak: y => staYmd(y, 7, 4) },
  { t: 'Halloween', re: /halloween|spooky/, peak: y => staYmd(y, 10, 31) },
  { t: 'Diwali', re: /diwali|deepavali|rangoli/, peak: y => (STA_TABLE.diwali[y] ? staYmd(y, STA_TABLE.diwali[y][0], STA_TABLE.diwali[y][1]) : null) },
  { t: 'Fall / Thanksgiving', re: /thanksgiving|\bfall\b|autumn|harvest|pumpkin|turkey/, from: y => staYmd(y, 9, 1),
    peak: y => staNthDow(y, 11, 4, 4), end: 4 },   // to Cyber Monday
  { t: 'Hanukkah', re: /hanukkah|chanukah|menorah/, peak: y => (STA_TABLE.hanukkah[y] ? staYmd(y, STA_TABLE.hanukkah[y][0], STA_TABLE.hanukkah[y][1]) : null), end: 8 },
  { t: 'Christmas / holiday', re: /christmas|xmas|holiday|santa|noel/, peak: y => staYmd(y, 12, 25), end: 1 },
];
// The season a term belongs to: { t, peak, from, to, inSeason } for its next (or current) occurrence; null when none.
function staSeasonOf(term) {
  const s = staLow(term);
  const now = Date.now();
  for (const x of STA_SEASONS) {
    if (!x.re.test(s)) continue;
    const y0 = new Date().getUTCFullYear();
    for (const y of [y0, y0 + 1]) {
      const peak = x.peak(y);
      if (peak == null) continue;
      const to = peak + ((x.end || 1) + 1) * 86400000;
      if (to < now) continue;
      const from = x.from ? x.from(y) : peak - 42 * 86400000;
      return { t: x.t, peak, from, to, inSeason: now >= from };
    }
    return { t: x.t, peak: null, from: null, to: null, inSeason: false };
  }
  return null;
}

/* ---------- the lists (Lists & settings), per brand ---------- */
const STA_SET_DEF = {
  SP: { brandTerms: ['ridhi'], productWords: [], blocked: ['cheap', 'free', 'used', 'diy'], competitors: [], fallbackTgt: null },
  CPC: { brandTerms: ['cotton print club', 'cottonprintclub'], productWords: [], blocked: ['cheap', 'free', 'used', 'diy'], competitors: [], fallbackTgt: null },
};
let STS = { SP: null, CPC: null, where: '', err: '' };
const STA_SET_LOCAL = 'staSettings';
// The lists of one brand (saved, else the defaults).
const staSet = b => STS[b] || STA_SET_DEF[b] || STA_SET_DEF.SP;
// Read both brands' lists: Firestore adsSettings/{brand}; this browser when the database refuses.
async function staSetLoad() {
  try {
    for (const b of ['SP', 'CPC']) {
      const snap = await getDoc(doc(db, 'adsSettings', b));
      STS[b] = snap.exists() ? Object.assign({}, STA_SET_DEF[b], snap.data()) : null;
    }
    STS.where = 'fs';
  } catch (e) {
    STS.where = 'local';
    STS.err = String((e && (e.code || e.message)) || e);
    let loc = {};
    try { loc = JSON.parse(localStorage.getItem(STA_SET_LOCAL) || '{}'); } catch (x) { loc = {}; }
    ['SP', 'CPC'].forEach(b => { STS[b] = loc[b] ? Object.assign({}, STA_SET_DEF[b], loc[b]) : null; });
  }
}
// Save one brand's lists.
async function staSetSave(b, data) {
  const clean = JSON.parse(JSON.stringify(Object.assign({}, data, { up: Date.now(), by: String(ME.email || '') })));
  if (STS.where === 'fs') {
    try { await setDoc(doc(db, 'adsSettings', b), clean); } catch (e) { STS.where = 'local'; STS.err = String((e && (e.code || e.message)) || e); }
  }
  STS[b] = Object.assign({}, STA_SET_DEF[b], clean);
  if (STS.where === 'local') {
    let loc = {};
    try { loc = JSON.parse(localStorage.getItem(STA_SET_LOCAL) || '{}'); } catch (x) { loc = {}; }
    loc[b] = clean;
    localStorage.setItem(STA_SET_LOCAL, JSON.stringify(loc));
  }
}

/* ---------- loading ---------- */

// Called when the tab opens: the caches, the optional caches, stock / sales / costs, the review list and the lists, all at
// the same time; then draw; then the product titles in the background (they name ASINs and find product words).
async function ensureSt() {
  if (!ST.loaded || !ST.extra) {
    stMsg('Loading the search terms, targets, ad groups, the review list and the lists…');
    $('stTable').innerHTML = '';
    stFoot('');
    // A cache the backend has not written yet answers "nothing cached" — that is null here, not an error.
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
      jobs.push(staSetLoad());
    }
    await Promise.all(jobs);
    await staRlSeen();
    ST.costs = Object.keys(COST || {}).length > 0;
    ST.costErr = CP.costErr || '';
    STM = null;
    staTitlesLater();
  }
  renderSt();
}
// Listing Health's titles, once, after the first draw: product words come from them, and own ASINs are named.
let STA_TITLES = false;
function staTitlesLater() {
  if (STA_TITLES) return;
  STA_TITLES = true;
  if (typeof H_LOADED !== 'undefined' && H_LOADED) return;
  setTimeout(async () => {
    try {
      await loadHealthCache();
      STM = null;
      if (!$('paneSt').classList.contains('hide')) renderSt();
    } catch (e) { /* no titles: names of campaigns and ad groups still find most product words */ }
  }, 50);
}
// A product's title, when Listing Health has it.
const staTitle = a => {
  try { return wTitle(String(a || '').toUpperCase()) || ''; } catch (e) { return ''; }
};

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
// The last 7 days, by 'ag|term' (or 'ag|target|match' for targets) → { c, sp, o, s }. Empty without stRecent.
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
// { asins, parents } advertised in one ad group; both empty when the group is unknown.
function stProductsOf(brand, agId) {
  const pack = ST.ag[brand] || {};
  const g = (pack.groups || {})[agId];
  if (!g || !g.a || !g.a.length) return { asins: [], parents: [] };
  const pmap = pack.parent || {};
  const parents = [...new Set(g.a.map(a => pmap[a] || '').filter(Boolean))];
  return { asins: g.a, parents };
}

/* AMAZON'S OWN RECORD (adEntities, AdsEntities.gs): keywords, targets, negatives, campaigns and ad groups with IDs, bids
 * and, when read with them, creation dates. Indexed once per load and brand. */
const STA_ENTX = {};
function staEnt(b) {
  if (b in STA_ENTX) return STA_ENTX[b];
  const E = ST.ent && ST.ent.d && ST.ent.d[b];
  if (!E || !E.kw) return (STA_ENTX[b] = null);
  const kw = new Map(), tg = new Map(), neg = new Set(), negPh = [];
  (E.kw || []).forEach(k => kw.set(k[1] + '|' + staLow(k[3]) + '|' + staLow(k[4]), { id: String(k[0]), ag: k[1], cid: k[2], bid: k[5], st: k[6], made: k[7] || 0, kind: 'kw' }));
  (E.tg || []).forEach(t => tg.set(t[1] + '|' + staLow(t[3]), { id: String(t[0]), ag: t[1], cid: t[2], bid: t[4], st: t[5], made: t[6] || 0, kind: 'tg' }));
  (E.neg || []).forEach(n => {
    const kind = /PHRASE/i.test(n[5]) ? 'np' : /EXACT/i.test(n[5]) ? 'nx' : 'na';
    const where = n[0] === 'cp' ? 'cp|' + n[2] : 'ag|' + n[3];
    neg.add(where + '|' + staLow(n[4]) + '|' + kind);
    if (kind === 'np') negPh.push({ where, text: staLow(n[4]) });
  });
  return (STA_ENTX[b] = { kw, tg, neg, negPh, cp: E.cp || {}, ag: E.ag || {}, at: E.at || (ST.ent && ST.ent.at) || '' });
}
// The keyword or target behind a path at Amazon: { id, bid, st, made, kind } (the ad group's default bid when the keyword
// has none of its own); null when adEntities does not know it.
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
// Is there already a negative for this text at Amazon where a new one would go? true / false, or null when not known.
function staNegAtAmazon(b, where, term, kind) {
  const E = staEnt(b);
  if (!E) return null;
  const t = staLow(term);
  if (kind === 'na') return E.neg.has(where + '|asin="' + t + '"|na');
  if (kind === 'np') return E.neg.has(where + '|' + t + '|np');
  if (E.neg.has(where + '|' + t + '|nx')) return true;
  const words = ' ' + staNorm(t) + ' ';
  return E.negPh.some(p => p.where === where && words.includes(' ' + staNorm(p.text) + ' '));
}

/* ================= THE MODEL: every verdict, once per load, brand, list or review-list change ================= */
let STM = null;

// Everything the views draw for the brand picked: rows (one per term and path), tg (every keyword / target), words,
// groups (Competing paths), byKey, and per brand: have (what arrived), info (stale, data checks), protect, dest.
function staModel() {
  const pick = $('stBrand').value;
  const key = pick + '|' + ST_RL.stamp + '|' + (STS.stamp || 0);
  if (STM && STM.key === key) return STM;
  const brands = pick === 'ALL' ? ['SP', 'CPC'] : [pick];
  const M = { key, brands, rows: [], tgRows: [], words: [], groups: [], overlap: 0, byKey: new Map(), settled: false,
    have: {}, info: {}, protect: {}, dest: {}, agInfo: {} };
  try { ADSX.paceFresh(); } catch (e) { /* Overview's lines are not there: no unit costs */ }
  const rlOpen = staRlIndex();
  brands.forEach(b => staModelBrand(b, M, rlOpen));
  STM = M;
  return M;
}

// One brand's share of the model.
function staModelBrand(b, M, rlOpen) {
  const src = staTermsOf(b), tsrc = staTgtsOf(b);
  const terms = src.rows || [], tgts = tsrc.rows || [];
  const S = staSet(b);
  M.have[b] = { terms: terms.length, tgts: tgts.length, settled: src.settled, from: src.from || '', to: src.to || '',
    dropped: src.dropped || 0, dropSpend: src.dropSpend || 0, minClicks: src.minClicks || 3 };
  if (src.settled) M.settled = true;
  // 2. A brand with no search terms, or ones older than 36 hours, gets no suggestions.
  const at = (ST.set && ST.set.d && ST.set.d[b]) ? ST.set.at : ST.at;
  const old = at && Date.now() - staStamp(at) > STA.STALE_H * 3600000;
  const info = M.info[b] = { stale: !terms.length ? 'No search terms for this brand in the last run' : old ? `Search terms from ${at}: not refreshed since` : '', bad: 0, badSp: 0 };
  if (!terms.length && !tgts.length) return;
  const rec = staRecentOf(b, false), trec = staRecentOf(b, true);
  const E = staEnt(b);
  const now = Date.now();

  // --- per ad group: products, kind of campaign, break-even, product words, own-product share, age, launch ---
  const kwAg = new Set(), ptAg = new Set(), autoCp = new Set();
  tgts.forEach(x => {
    if (staKwMt(x.mt)) kwAg.add(x.ag);
    if (staAutoMt(x.mt)) autoCp.add(x.cid);
    if (/^asin=|^category=/i.test(staLow(x.t)) && !staAutoMt(x.mt)) ptAg.add(x.ag);
  });
  terms.forEach(x => { if (staAutoMt(x.mt)) autoCp.add(x.cid); });
  if (E) Object.keys(E.cp).forEach(cid => { if (/AUTO/i.test(E.cp[cid][7] || '')) autoCp.add(cid); });
  const agRows = new Map();
  ((ST.ag[b] || {}).rows || []).forEach(x => (agRows.get(x.ag) || agRows.set(x.ag, []).get(x.ag)).push(x));
  const manualTypes = (S.productWords || []).map(staKey).filter(Boolean);
  const typeKeys = STA_TYPES.map(t => [t, staKey(t)]);
  const weeks = (typeof WEEKLY !== 'undefined' && WEEKLY.rows) || {};
  const weeksHaveAds = Object.keys(weeks).some(a => weeks[a] && weeks[a].brand === b && Object.values(weeks[a].weeks || {}).some(w => (w.spend || 0) > 0));
  const infoOf = new Map();
  const agInfo = (ag, cid) => {
    if (infoOf.has(ag)) return infoOf.get(ag);
    const p = stProductsOf(b, ag);
    const list = agRows.get(ag) || [];
    // Break-even and target: the products' Overview lines, weighted by their ad sales in this ad group.
    let w = 0, tw = 0, bw = 0, cover = null, s = 0, os = 0;
    const stock = CP.stock[b];
    list.forEach(x => {
      s += x.s || 0; os += x.os || 0;
      let ln = null;
      try { ln = ADSX.lines(x.a); } catch (e) { ln = null; }
      if (ln && ln.tgt != null) {
        const wt = (x.s || 0) + (x.sp || 0) * 0.01 + 0.001;
        w += wt; tw += wt * ln.tgt; bw += wt * ln.be;
      }
      const st = stock && x.sku && Object.prototype.hasOwnProperty.call(stock, x.sku) ? Number(stock[x.sku]) || 0 : null;
      if (st != null && ln && ln.perDay > 0) {
        const cv = st / ln.perDay;
        cover = cover == null ? cv : Math.min(cover, cv);
      }
    });
    const fb = Number(S.fallbackTgt) > 0 ? Number(S.fallbackTgt) : null;
    const ohSal = (PF_MODEL.oh || 0) + (PF_MODEL.sal || 0);
    const lines = w > 0 ? { tgt: tw / w, be: bw / w, known: true, cover }
      : fb ? { tgt: fb, be: fb + ohSal, known: false, fallback: true, cover } : { tgt: null, be: null, known: false, cover };
    // Product words: the product types named in the titles, the campaign and the ad group, plus the brand's own list.
    const cn = staName(b, cid), agn = staName(b, ag);
    const hay = staKey([cn, agn].concat(p.asins.map(staTitle)).join(' '));
    const types = new Set(manualTypes);
    typeKeys.forEach(([t, k]) => { if (k && hay.includes(k)) types.add(k); });
    // The main parent: the parent (or ASIN) with the most ad sales here — the "same product" of Competing paths.
    let pk = '', best = -1;
    const pmap = (ST.ag[b] || {}).parent || {};
    list.forEach(x => {
      const k = pmap[x.a] || x.a;
      if ((x.s || 0) + (x.sp || 0) > best) { best = (x.s || 0) + (x.sp || 0); pk = k; }
    });
    if (!pk) pk = p.parents[0] || p.asins[0] || 'ag:' + ag;
    // 3. 30 days first: when this product's ads began (the first finished week with ad spend), and the campaign's start.
    let firstAd = null, knownAge = false;
    p.asins.forEach(a => {
      const r = weeks[a];
      if (!weeksHaveAds || !r || !r.weeks) return;
      knownAge = true;
      Object.keys(r.weeks).forEach(k => {
        if ((r.weeks[k].spend || 0) > 0) {
          const t = Date.parse(k + 'T00:00:00Z');
          if (t && (firstAd == null || t < firstAd)) firstAd = t;
        }
      });
    });
    const cpMade = E && E.cp[cid] && E.cp[cid][8] ? Number(E.cp[cid][8]) || 0 : 0;
    const ageFrom = Math.max(firstAd || 0, cpMade || 0);
    const isNew = (knownAge && firstAd == null) || (ageFrom && now - ageFrom < (STA.AGE_DAYS + 6) * 86400000);
    const ctype = autoCp.has(cid) ? 'auto' : ptAg.has(ag) && !kwAg.has(ag) ? 'pt' : kwAg.has(ag) ? 'kw' : '';
    const out = { ag, cid, cn, agn, asins: p.asins, parents: p.parents, pk, ln: lines, types, ctype,
      own: s >= 50 ? os / s : null, isNew: !!isNew, newFrom: isNew ? (ageFrom || now) + (STA.AGE_DAYS + 7) * 86400000 : 0,
      launch: STA_LAUNCH.test(cn) };
    infoOf.set(ag, out);
    return out;
  };
  M.agInfo[b] = infoOf;

  // --- protected: brand terms, own / sister ASINs, main keywords ---
  const own = new Set(), sister = new Set();
  ((ST.ag[b] || {}).rows || []).forEach(r => r.a && own.add(String(r.a).toLowerCase()));
  const other = b === 'SP' ? 'CPC' : 'SP';
  ((ST.ag[other] || {}).rows || []).forEach(r => r.a && !own.has(String(r.a).toLowerCase()) && sister.add(String(r.a).toLowerCase()));
  Object.keys(weeks).forEach(a => {
    const w = weeks[a];
    const k = a.toLowerCase();
    if (w && w.brand === b) own.add(k); else if (w && w.brand && !own.has(k)) sister.add(k);
  });
  const brandTerms = (S.brandTerms || []).map(staNorm).filter(Boolean);
  tgts.forEach(x => { if (/brand/i.test(staName(b, x.cid)) && staKwMt(x.mt)) brandTerms.push(staNorm(x.t)); });
  const isBrand = t => {
    const s = ' ' + staNorm(t) + ' ';
    return brandTerms.find(w => w && s.includes(' ' + w + ' ')) || '';
  };
  // Main keywords: our own keywords (any match type), by the products of the ad groups that hold them.
  const ownKw = new Map();
  tgts.forEach(x => {
    if (!staKwMt(x.mt)) return;
    const k = staKey(x.t);
    (ownKw.get(k) || ownKw.set(k, new Set()).get(k)).add(agInfo(x.ag, x.cid).pk);
  });
  const brandOrders = new Map();
  terms.forEach(x => { const k = staKey(x.t); brandOrders.set(k, (brandOrders.get(k) || 0) + (x.o > x.c ? 0 : x.o || 0)); });
  const rawOf = new Map();
  (S.blocked || []).concat(S.competitors || []).forEach(w => { if (staNorm(w)) rawOf.set(staNorm(w), String(w).trim().toLowerCase()); });
  M.protect[b] = { own, sister, isBrand, ownKw, brandOrders, rawOf, blocked: (S.blocked || []).map(staNorm).filter(Boolean),
    competitors: (S.competitors || []).map(staNorm).filter(Boolean) };
  const P = M.protect[b];

  // --- targets: the yardsticks, and one object per keyword / target for the bid lines ---
  const cAgg = new Map(), bAgg = { c: 0, o: 0 };
  const addAgg = (k, x) => {
    const a = cAgg.get(k) || { c: 0, o: 0 };
    a.c += x.c || 0; a.o += x.o || 0;
    cAgg.set(k, a);
  };
  const tObj = new Map(), tByAgKw = new Map(), exactBy = new Map(), ptBy = new Map();
  tgts.forEach(x => {
    const bad = staBadData(x);
    if (!bad) { addAgg(x.cid, x); bAgg.c += x.c || 0; bAgg.o += x.o || 0; }
    const t = staLow(x.t);
    const key = 'g:' + b + '|' + x.ag + '|' + t + '|' + staLow(x.mt);
    const ai = agInfo(x.ag, x.cid);
    const g = {
      key, type: 'target', brand: b, term: x.t, kw: x.t, mt: x.mt, ag: x.ag, cid: x.cid, cn: ai.cn, agn: ai.agn,
      i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0, kid: x.kid || '', ai, ln: ai.ln, bad,
      r7: trec.get(x.ag + '|' + t + '|' + staLow(x.mt)) || null,
    };
    g.acos = g.s > 0 ? g.sp / g.s * 100 : null;
    g.cpc = g.c > 0 ? g.sp / g.c : null;
    g.pathKey = 'p:' + b + '|' + x.ag + '|' + t + '|' + staLow(x.mt);
    g.ent = staEntOf(b, x.ag, x.t, x.mt);
    g.rl = rlOpen.get(g.pathKey) || null;
    g.paused = g.ent && /PAUSED|ARCHIVED/i.test(g.ent.st || '');
    g.hay = (x.t + ' ' + ai.cn + ' ' + ai.agn).toLowerCase();
    tObj.set(key, g);
    tByAgKw.set(x.ag + '|' + t, key);
    if (/^EXACT$/i.test(x.mt)) (exactBy.get(staKey(t)) || exactBy.set(staKey(t), []).get(staKey(t))).push(g);
    const am = /^asin="?([a-z0-9]{10})"?$/i.exec(t);
    if (am) (ptBy.get(am[1].toLowerCase()) || ptBy.set(am[1].toLowerCase(), []).get(am[1].toLowerCase())).push(g);
  });
  if (!tgts.length) terms.forEach(x => { if (!staBadData(x)) { addAgg(x.cid, x); bAgg.c += x.c || 0; bAgg.o += x.o || 0; } });
  tObj.forEach(g => {
    const ca = cAgg.get(g.cid);
    g.rate = ca && ca.o >= STA.RATE_ORDERS && ca.c > 0 ? { p: ca.o / ca.c, w: 'its campaign' } : bAgg.o > 0 && bAgg.c > 0 ? { p: bAgg.o / bAgg.c, w: 'the brand' } : null;
  });
  if (E) E.kw.forEach((k, key) => {
    const parts = key.split('|');
    if (parts[2] !== 'exact' || /ARCHIVED/i.test(k.st || '')) return;
    const list = exactBy.get(staKey(parts[1])) || exactBy.set(staKey(parts[1]), []).get(staKey(parts[1]));
    if (!list.some(y => y.ag === k.ag)) list.push({ ag: k.ag, cid: k.cid, ai: agInfo(k.ag, k.cid) });
  });
  const rateFor = (tr, cid) => {
    const ca = cAgg.get(cid);
    return tr && !tr.bad && tr.o >= STA.RATE_ORDERS && tr.c > 0 ? { p: tr.o / tr.c, w: 'its keyword / target' }
      : ca && ca.o >= STA.RATE_ORDERS && ca.c > 0 ? { p: ca.o / ca.c, w: 'its campaign' }
        : bAgg.o > 0 && bAgg.c > 0 ? { p: bAgg.o / bAgg.c, w: 'the brand' } : null;
  };

  // Product words belong to the product, not the ad group: every ad group of the same product shares what any of them
  // (titles, campaign and ad-group names) says it sells — an ad group named just "Auto" still sells pillow covers.
  terms.forEach(x => agInfo(x.ag, x.cid));
  const pkTypes = new Map();
  infoOf.forEach(ai => {
    const set = pkTypes.get(ai.pk) || pkTypes.set(ai.pk, new Set()).get(ai.pk);
    ai.types.forEach(k => set.add(k));
  });
  infoOf.forEach(ai => { ai.types = pkTypes.get(ai.pk); });

  // --- one row per search term and path ---
  const mine = [];
  terms.forEach(x => {
    const term = String(x.t || ''), tl = staLow(term), kw = x.kw || '', mt = x.mt || '';
    const ai = agInfo(x.ag, x.cid);
    const tkey = tObj.has('g:' + b + '|' + x.ag + '|' + staLow(kw) + '|' + staLow(mt)) ? 'g:' + b + '|' + x.ag + '|' + staLow(kw) + '|' + staLow(mt)
      : tByAgKw.get(x.ag + '|' + staLow(kw)) || '';
    const tr = tkey ? tObj.get(tkey) : null;
    const row = {
      key: 't:' + b + '|' + x.ag + '|' + tl, type: 'term', brand: b, term, tl, tk: staKey(term), kw, mt, ag: x.ag, cid: x.cid,
      cn: ai.cn, agn: ai.agn, i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0, kid: x.kid || '',
      r7: rec.get(x.ag + '|' + tl) || null, tr, tkey, ai, ln: ai.ln, asins: ai.asins, parents: ai.parents,
      auto: autoCp.has(x.cid), asin: staIsAsin(term),
    };
    row.bad = staBadData(row);
    if (row.bad) { info.bad++; info.badSp += row.sp; }
    row.acos = row.s > 0 ? row.sp / row.s * 100 : null;
    row.cpc = row.c > 0 ? row.sp / row.c : null;
    row.cvr = row.c > 0 ? row.o / row.c * 100 : null;
    row.suspect = !row.bad && row.o >= 3 && row.acos != null && row.acos < STA.LOW_ACOS;
    row.own = (/^EXACT$/i.test(mt) && staKey(kw) === row.tk) || (row.asin && /^asin=/i.test(staLow(kw)) && staLow(kw).includes(tl));
    row.ent = staEntOf(b, x.ag, kw, mt);
    if (row.ent && row.ent.made && now - row.ent.made < STA.AGE_DAYS * 86400000) row.kwNew = row.ent.made + STA.AGE_DAYS * 86400000;
    row.pathKey = 'p:' + b + '|' + x.ag + '|' + staLow(kw) + '|' + staLow(mt);
    row.rate = rateFor(tr, x.cid);
    row.chance = row.rate ? Math.pow(1 - row.rate.p, row.c) : null;
    row.tgtAcos = tr && tr.s > 0 ? tr.sp / tr.s * 100 : null;
    row.exactElsewhere = (exactBy.get(row.tk) || []).filter(y => y.ag !== x.ag && y.ai && y.ai.pk === ai.pk);
    row.ptElsewhere = row.asin ? (ptBy.get(tl) || []).filter(y => y.ag !== x.ag && y.ai.pk === ai.pk) : [];
    // 4. What protects this term from a negative here.
    const tags = [];
    const brandHit = P.isBrand(term);
    if (brandHit) tags.push(['brand', 'Brand term', `Holds your brand term "${brandHit}". Brand searches are never negated; they are judged against ${STA.BRAND_TGT}% ACoS.`]);
    if (row.asin) {
      if (P.own.has(tl)) tags.push(['own', 'Own product', 'One of this brand\'s own ASINs: a defence placement, never negated or scaled here.' + (staTitle(tl) ? ' ' + staTitle(tl) : '')]);
      else if (P.sister.has(tl)) tags.push(['sister', 'Sister brand', `An ASIN of ${staBrandName(other)}: never negated or scaled here — agree which brand owns this shopper.`]);
      else tags.push(['comp', 'Competitor ASIN', 'A product page that is not yours.']);
    }
    if (ai.types.has(row.tk)) tags.push(['product', 'Product word', `"${term}" is what this ad group sells: never negated in this product's campaigns. A lower bid, or a look at the listing, instead.`]);
    const okw = P.ownKw.get(row.tk);
    if ((okw && okw.has(ai.pk)) || (P.brandOrders.get(row.tk) || 0) >= STA.MAIN_ORDERS) {
      tags.push(['main', 'Main keyword', (okw && okw.has(ai.pk) ? 'You bid on it as your own keyword for this product' : `${P.brandOrders.get(row.tk)} orders across ${staBrandName(b)}`)
        + '. Only negated on a weaker path when its own exact keyword keeps it.']);
    }
    const season = staSeasonOf(term);
    if (season) {
      row.season = season;
      tags.push(['season', 'Seasonal', `${season.t}${season.peak ? ', peak ' + staDay(season.peak) : ''}. Never negated — a negative would still be there next season. ${season.inSeason ? 'In season now: a lower bid at most.' : 'Out of season: held.'}`]);
    }
    if (ai.own != null && ai.own < STA.HALO) tags.push(['halo', 'Other products\' sales', `Only ${Math.round(ai.own * 100)}% of this ad group's ad sales were the advertised product itself; the rest are other products bought after the click. Judged on all ad sales.`]);
    if (ai.isNew || ai.launch || row.kwNew) tags.push(['new', ai.launch ? 'Launch campaign' : 'New', ai.launch ? 'A launch or ranking campaign (by its name): not judged on ACoS.'
      : `Fewer than ${STA.AGE_DAYS} days of ads: judged from ${staDay(row.kwNew || ai.newFrom)}.`]);
    row.tags = tags;
    row.tagSet = new Set(tags.map(t => t[0]));
    row.noNeg = row.tagSet.has('brand') ? 'brand term' : row.tagSet.has('own') ? 'own product' : row.tagSet.has('sister') ? 'sister-brand product'
      : row.tagSet.has('product') ? 'product word' : row.tagSet.has('season') ? 'seasonal term' : '';
    row.main = row.tagSet.has('main');
    row.containsProduct = [...ai.types].some(k => k && row.tk.includes(k));
    row.rl = rlOpen.get(row.key) || null;
    row.rlPath = rlOpen.get(row.pathKey) || null;
    row.negated = staTermNegated(b, row, rlOpen);
    row.hay = (term + ' ' + kw + ' ' + ai.cn + ' ' + ai.agn + ' ' + ai.asins.join(' ') + ' ' + ai.parents.join(' ')).toLowerCase();
    mine.push(row);
  });

  // --- 8. competing paths: the same term reaching the same product through two or more ad groups ---
  const byTerm = new Map();
  mine.forEach(r => { if (!r.bad && (r.sp > 0 || r.o > 0)) (byTerm.get(r.tk) || byTerm.set(r.tk, []).get(r.tk)).push(r); });
  byTerm.forEach(list => {
    const products = new Set(list.map(r => r.ai.pk));
    if (products.size > 1 && list.length > 1) M.overlap++;
    products.forEach(pk => {
      const paths = list.filter(r => r.ai.pk === pk);
      if (paths.length < 2) return;
      // The lead: 3+ orders, under break-even (needs a unit cost or a set target), not a suspect ACoS; an own exact
      // keyword first, then the lowest ACoS.
      const can = paths.filter(r => r.o >= STA.LEAD_ORDERS && r.ln.be != null && r.acos != null && r.acos <= r.ln.be && !r.suspect);
      if (!can.length) return;
      can.sort((p, q) => (q.own - p.own) || (p.acos - q.acos) || (q.o - p.o));
      const lead = can[0];
      const la = lead.acos / 100;
      const g = { key: 'h:' + b + '|' + lead.tk + '|' + pk, brand: b, term: lead.term, tk: lead.tk, lead, paths: [], excess: 0, campaigns: 0 };
      paths.forEach(r => {
        r.group = g;
        r.leadAcos = lead.acos;
        if (r === lead) { r.role = 'lead'; return; }
        // Doing as well as the lead (or better): left alone.
        if (r.o > 0 && r.acos != null && r.acos <= lead.acos + 0.05) { r.role = 'fine'; r.excess = 0; return; }
        r.role = 'other';
        r.excess = r.negated ? 0 : Math.max(0, r.sp - r.s * la);
        r.pathLevel = r.cid === lead.cid || r.asin ? 'ag' : 'cp';
        r.dupExact = r.own && lead.own;   // two own exact keywords for the same product: a duplicate
        g.excess += r.excess;
      });
      g.paths = [lead].concat(paths.filter(r => r !== lead).sort((p, q) => (q.excess || 0) - (p.excess || 0)));
      g.campaigns = new Set(g.paths.map(r => r.cid)).size;
      if (g.excess > 0.5) M.groups.push(g);
      else paths.forEach(r => { delete r.role; delete r.group; delete r.excess; });
    });
  });

  // --- the verdict of every keyword / target, then of every term ---
  tObj.forEach(g => {
    staTgtVerdict(g, info, P);
    M.byKey.set(g.key, g);
    if (g.cat) M.tgRows.push(g);
  });
  mine.forEach(r => {
    staVerdict(r, info);
    M.rows.push(r);
    M.byKey.set(r.key, r);
  });
  // --- 12. words: what recurs across many terms without selling, and the blocked words and competitor brands ---
  staWords(b, M, mine, P, info, rlOpen, bAgg);
  M.dest[b] = { kwAg, ptAg, agRows };
}

// 1. A row whose figures cannot be true is set aside: why, or '' when it is fine.
function staBadData(x) {
  if ((x.o || 0) > (x.c || 0)) return `${staInt(x.o)} orders from ${staInt(x.c)} click${x.c === 1 ? '' : 's'}: more orders than clicks`;
  if ((x.o || 0) > 0 && !((x.s || 0) > 0)) return 'Orders without sales';
  if ((x.s || 0) > 0 && !((x.c || 0) > 0)) return 'Sales without a click';
  return '';
}

// Is this term already negated where it ran — at Amazon (adEntities) or by a review item that has been done?
function staTermNegated(b, r, rlOpen) {
  const done = rlOpen.get('done:' + r.key);
  if (done) return 'Negative added ' + staDay(done.exportedAt || done.at);
  const kind = r.asin ? 'na' : 'nx';
  if (staNegAtAmazon(b, 'cp|' + r.cid, r.term, kind) || staNegAtAmazon(b, 'ag|' + r.ag, r.term, kind)) return 'Negative at Amazon';
  return '';
}

/* THE VERDICT of one keyword or target: the bid line. Listed in Burning money "by target" when it burns, and the place
 * every term's "lower / raise the bid" points to. */
function staTgtVerdict(g, info, P) {
  const ln = g.ln;
  g.cat = '';
  g.next = null;
  g.hold = '';
  g.burned = 0;
  g.kind = '';
  const tk = staKey(g.kw);
  // A keyword that is a product word, a brand term or a main keyword is lowered, never paused.
  g.noPause = g.ai.types.has(tk) ? 'product word' : P.isBrand(g.kw) ? 'brand term' : staSeasonOf(g.kw) ? 'seasonal keyword' : '';
  g.brandTerm = !!P.isBrand(g.kw);
  if (g.bad) { g.hold = 'Data check: ' + g.bad; return; }
  if (info.stale) { g.hold = info.stale; return; }
  if (g.ai.launch) { g.hold = 'Launch campaign: not judged on ACoS'; return; }
  if (g.ai.isNew) { g.hold = `New: judged from ${staDay(g.ai.newFrom)}`; return; }
  if (g.ent && g.ent.made && Date.now() - g.ent.made < STA.AGE_DAYS * 86400000) { g.hold = `New keyword: judged from ${staDay(g.ent.made + STA.AGE_DAYS * 86400000)}`; return; }
  if (g.paused) { g.hold = 'Paused at Amazon'; return; }
  if (g.c < STA.MIN_CLICKS || !(g.sp > 0)) return;
  const tgt = g.brandTerm ? STA.BRAND_TGT : ln.tgt, be = g.brandTerm ? STA.BRAND_TGT : ln.be;
  g.tgtUse = tgt;
  g.beUse = be;
  const last = staLastChange(g.pathKey);
  const cool = last && Date.now() - last < STA.COOLDOWN * 86400000;
  if (!(g.o > 0)) return staTgtNoSale(g, cool, last);
  if (tgt == null) { g.hold = 'No unit cost: profit not judged'; return; }
  const poor = g.c >= STA.POOR_CLICKS && g.rate && g.o / g.c < g.rate.p * STA.POOR_SHARE && staBinomLe(g.o, g.c, g.rate.p) < STA.CHANCE;
  if (g.acos > be) { g.cat = 'burn'; g.kind = 'be'; g.burned = g.sp - g.s * be / 100; g.next = 'reduce'; }
  else if (poor && g.acos > tgt) { g.cat = 'burn'; g.kind = 'poor'; g.burned = g.sp - g.s * tgt / 100; g.next = 'reduce'; }
  else if (g.acos > tgt) g.hold = `Between target ${staPct(tgt)} and break-even ${staPct(be)}: covers its costs`;
  else if (g.o >= STA.SCALE_ORDERS && g.acos <= tgt * STA.SCALE_SHARE && !(g.acos < STA.LOW_ACOS)) {
    g.cat = 'scale';
    const bid = g.ent && g.ent.bid;
    if (bid > 0 && g.cpc > 0 && bid >= g.cpc * STA.NOT_LIMIT) g.next = 'limit';
    else if (g.ln.cover != null && g.ln.cover < STA.RAISE_COVER) g.next = 'lowstock';
    else g.next = 'raise';
  } else g.hold = 'Selling within target';
  if (cool && /reduce|raise/.test(g.next || '')) { g.hold = `Bid changed by Sellora ${staDay(last)}: judged again after ${STA.COOLDOWN} days`; g.next = null; }
  if (g.rl) g.next = null;
  staTgtBid(g);
}
// The no-sales half of a target's verdict.
function staTgtNoSale(g, cool, last) {
  const p = g.rate && g.rate.p;
  g.chance = p ? Math.pow(1 - p, g.c) : null;
  if (g.chance == null) { g.hold = 'Nothing in this brand has sold yet to compare with'; return; }
  if (g.chance >= STA.CHANCE) { g.cat = 'watch'; g.hold = `Could be chance: about ${staNeed(p, g.c)} more clicks to tell`; return; }
  g.cat = 'burn';
  g.kind = 'none';
  g.burned = g.sp;
  g.next = g.noPause ? 'reduce' : 'pause';
  if (cool) { g.hold = `Bid changed by Sellora ${staDay(last)}: judged again after ${STA.COOLDOWN} days`; g.next = null; }
  if (g.rl) g.next = null;
  staTgtBid(g);
}
// The suggested bid of a target: the current bid (or, until it is read, the CPC) × target ÷ ACoS, within ±20% a step.
function staTgtBid(g) {
  const base = g.ent && g.ent.bid > 0 ? g.ent.bid : g.cpc;
  if (!(base > 0)) return;
  const f = !(g.o > 0) || g.acos == null ? 1 - STA.STEP
    : Math.min(1 + STA.STEP, Math.max(1 - STA.STEP, (g.tgtUse || 0) / g.acos));
  g.sugBid = Math.max(STA.MIN_BID, staR2(base * f));
  g.bidBase = g.ent && g.ent.bid > 0 ? 'bid' : 'cpc';
}

/* THE VERDICT of one search term on one path: its badges, money burned, evidence, and the one next step or the reason
 * there is none. Order: data check → incomplete data → 30 days / launch → no sales → no unit cost → above break-even
 * → converts poorly → between → worth scaling; then a weaker competing path; then what protects it; then the queue. */
function staVerdict(r, info) {
  const ln = r.ln;
  r.badges = [];
  r.cat = '';
  r.next = null;
  r.hold = '';
  r.burned = 0;
  r.kind = '';
  r.ev = '';
  const b = r.badges;
  const brandTerm = r.tagSet.has('brand');
  const tgt = brandTerm ? STA.BRAND_TGT : ln.tgt, be = brandTerm ? STA.BRAND_TGT : ln.be;
  r.tgtUse = tgt;
  r.beUse = be;
  const g = r.tr;
  const finish = () => staFinish(r);
  if (r.bad) { r.cat = 'check'; r.hold = 'Data check: ' + r.bad + ' — set aside, never used'; b.push(['Data check', 'bad', r.bad]); return finish(); }
  if (info.stale) { r.hold = info.stale + ': no suggestions'; b.push(['Data incomplete', 'warn']); return finish(); }
  if (r.ai.launch) { r.hold = 'Launch campaign: not judged on ACoS'; b.push(['Launch', 'info']); return finish(); }
  if (r.ai.isNew || r.kwNew) { r.hold = `Fewer than ${STA.AGE_DAYS} days of ads: judged from ${staDay(r.kwNew || r.ai.newFrom)}`; b.push(['New', 'info']); return finish(); }
  const chancePct = r.chance != null ? (r.chance * 100).toFixed(1) + '%' : '';
  // --- no sales ---
  if (!(r.o > 0)) {
    if (!r.rate) { r.hold = 'Nothing in this brand has sold yet to compare with'; b.push(['No sales', '']); return finish(); }
    const need = staNeed(r.rate.p, r.c);
    if (r.c < STA.MIN_CLICKS) {
      r.hold = `Too few clicks: about ${need} more to tell`;
      b.push(['Too few clicks', '', `${r.c} click${r.c === 1 ? '' : 's'} and no order.`]);
      return finish();
    }
    if (r.chance >= STA.CHANCE) {
      r.cat = 'watch';
      r.hold = `Could be chance (${chancePct}): about ${need} more clicks to tell`;
      b.push(['Watch', 'warn', `0 orders in ${r.c} clicks happens ${chancePct} of the time if it converted like ${r.rate.w}.`]);
      return finish();
    }
    r.cat = 'burn';
    r.kind = 'none';
    r.burned = r.sp;
    b.push(['No sales', 'bad']);
    r.ev = `0 orders in <b>${staInt(r.c)} clicks</b> · ${chancePct} chance of that if it converted like ${r.rate.w} (${(r.rate.p * 100).toFixed(1)}%): <b>unlikely to be chance</b>`;
    r.next = 'neg';
  } else if (tgt == null) {
    r.hold = 'No unit cost: profit not judged';
    b.push([r.o >= STA.SCALE_ORDERS ? 'Selling' : 'Selling', 'ok']);
    return finish();
  } else if (r.acos > be && r.c >= STA.MIN_CLICKS) {
    r.cat = 'burn';
    r.kind = 'be';
    r.burned = Math.max(0, r.sp - r.s * be / 100);
    b.push(['Above break-even', 'bad']);
    r.ev = `ACoS <b>${staPct(r.acos)}</b> vs break-even ${staPct(be)} (target ${staPct(tgt)}${brandTerm ? ', brand term' : ln.fallback ? ', from your setting' : ''}): ${staMoney(r.burned)} more than break-even allows`;
    // The bid belongs to the target: lower it when the target as a whole is over target; otherwise this one term is the
    // problem, and a negative stops it without touching the terms that sell.
    r.next = g && g.acos != null && g.acos > tgt ? 'reduce' : 'neg';
    if (r.next === 'neg' && g) r.ev += `. Its target sells at ${staPct(g.acos)} overall, so a negative for this term is safer than a lower bid`;
  } else if (r.c >= STA.POOR_CLICKS && r.rate && r.o / r.c < r.rate.p * STA.POOR_SHARE && staBinomLe(r.o, r.c, r.rate.p) < STA.CHANCE && r.acos > tgt) {
    r.cat = 'burn';
    r.kind = 'poor';
    r.burned = Math.max(0, r.sp - r.s * tgt / 100);
    b.push(['Converts poorly', 'bad']);
    r.ev = `${staInt(r.o)} order${r.o === 1 ? '' : 's'} in <b>${staInt(r.c)} clicks</b> (${staPct(r.cvr)}) vs ${(r.rate.p * 100).toFixed(1)}% for ${r.rate.w}: under half, and unlikely to be chance · ACoS ${staPct(r.acos)} over target ${staPct(tgt)}`;
    r.next = g && g.acos != null && g.acos > tgt ? 'reduce' : 'neg';
  } else if (r.acos > tgt) {
    r.hold = `Between target ${staPct(tgt)} and break-even ${staPct(be)}: covers its costs`;
    b.push(['Over target', 'warn']);
  } else {
    b.push([r.o >= STA.SCALE_ORDERS ? 'Winner' : 'Selling', 'ok']);
    if (r.suspect) { r.hold = `ACoS under ${STA.LOW_ACOS}%: check the data before scaling`; }
    else if (r.tagSet.has('own') || r.tagSet.has('sister')) r.hold = 'Own or sister-brand ASIN: not scaled here';
    else if (r.own && r.o >= STA.SCALE_ORDERS && r.acos <= tgt * STA.SCALE_SHARE) {
      r.cat = 'scale';
      r.scaleKind = 'raise';
      b.push(['Room to grow', 'ok', `ACoS ${staPct(r.acos)} is at or under ${Math.round(STA.SCALE_SHARE * 100)}% of the target ${staPct(tgt)}.`]);
      r.ceil = Math.min(r.cpc * tgt / r.acos, r.cpc * 2);
      r.next = g && g.next === 'limit' ? 'limit' : r.ln.cover != null && r.ln.cover < STA.RAISE_COVER ? 'lowstock' : 'raise';
    } else if (!r.own && r.o >= STA.EXACT_ORDERS && !r.exactElsewhere.length && !r.ptElsewhere.length) {
      r.cat = 'scale';
      r.scaleKind = r.asin ? 'asinT' : 'exact';
      b.push([r.asin ? 'Not its own target' : 'Not its own keyword', 'info']);
      r.ceil = Math.min(r.cpc * tgt / r.acos, r.cpc * 2);
      r.sugBid = Math.max(STA.MIN_BID, staR2(Math.min(r.cpc * (1 + STA.STEP), r.ceil)));
      r.next = r.scaleKind;
    } else if (r.o < STA.EXACT_ORDERS) r.hold = `Selling: ${STA.EXACT_ORDERS} orders before it is added as its own keyword`;
    else r.hold = 'Selling within target';
  }
  // --- a weaker path of a competing term (same product, a lead that is under break-even): a negative here sends the term
  // to the lead and leaves this target's other terms alone, so it comes before a lower bid on the whole target ---
  if (r.role === 'other' && r.excess > 0.5) {
    if (!r.cat || r.cat === 'scale') { r.cat = 'paths'; r.scaleKind = ''; }
    r.next = r.dupExact ? 'pause' : 'neg';
    r.routing = true;
  }
  if (r.role === 'lead') b.push(['Lead path', 'info', 'Of this product\'s paths for this term, this one sells it best.']);
  else if (r.role === 'other') b.push(['Competing path', 'info', `The lead path sells it at ${staPct(r.leadAcos)} ACoS.`]);
  // --- 4. what protects it: no negative on a protected term (a main keyword only on a weaker path whose lead is its own exact) ---
  if (r.next === 'neg' || r.next === 'pause') {
    const mainOk = r.main && !r.noNeg && r.routing && r.group && r.group.lead.own;
    if (r.noNeg || (r.main && !mainOk)) {
      const why = r.noNeg || 'main keyword';
      if (g && g.acos != null && r.tgtUse != null && g.acos > r.tgtUse && r.kw) { r.next = 'reduce'; r.protectNote = `${why[0].toUpperCase() + why.slice(1)}: never negated — a lower bid on its target instead`; }
      else {
        r.next = null;
        r.hold = `${why[0].toUpperCase() + why.slice(1)}: never negated` + (r.tagSet.has('product') ? ' — if it keeps losing, check the listing (price, images, reviews)' : '')
          + (r.tagSet.has('season') ? (r.season.inSeason ? ' — in season' : ' — out of season') : '');
      }
    }
  }
  // Seasonal out of season: no bid cut on old figures either.
  if (r.tagSet.has('season') && !r.season.inSeason && r.next === 'reduce') { r.next = null; r.hold = 'Seasonal, out of season: held until it comes round'; }
  if (r.next === 'reduce' || r.next === 'raise') {
    if (!g) { r.next = r.next === 'reduce' && !r.noNeg && !r.main ? 'neg' : null; if (!r.next) r.hold = "Amazon didn't report which target caught this term"; }
    else if (g.rl) { r.status = 'In review'; }
    else if (g.hold && /changed by Sellora/.test(g.hold)) { r.hold = g.hold; r.next = null; }
  }
  return finish();
}
// The status of a row, after its verdict: In review / Negated / Promoted / Active.
function staFinish(r) {
  if (r.negated) {
    r.status = 'Negated';
    r.next = null;
    r.cat = r.cat === 'check' ? 'check' : '';
    r.hold = r.negated;
  } else if (r.rl || (r.rlPath && /^(reduce|raise|pause)$/.test(r.next || ''))) r.status = 'In review';
  else if (!r.own && (r.exactElsewhere.length || r.ptElsewhere.length)) r.status = 'Promoted';
  else r.status = r.status || 'Active';
  r.act = !!(r.next && !/limit|lowstock/.test(r.next) && r.status !== 'In review' && r.status !== 'Negated');
  r.stake = r.cat === 'paths' ? (r.excess || 0) : (r.burned || 0);
}

/* 12. WORDS: every one-, two- and three-word piece of the brand's search terms, summed over the terms that hold it. A word
 * that recurs across many terms with no order — or one of your blocked words or competitor brands — gets one negative
 * phrase per campaign. Never a product word, a brand term, a main keyword or a seasonal word. */
function staWords(b, M, mine, P, info, rlOpen, bAgg) {
  const map = new Map();
  // The brand's own product words (found for its ad groups, plus its list) — not every product type there is: "euro sham"
  // is fair game for a brand that sells no shams.
  const typeWords = new Set();
  const allTypes = new Set();
  const agI = M.agInfo[b];
  if (agI) agI.forEach(a => a.types.forEach(k => allTypes.add(k)));
  STA_TYPES.filter(t => allTypes.has(staKey(t))).concat(staSet(b).productWords || [])
    .forEach(t => staNorm(t).split(' ').forEach(w => typeWords.add(staSing(w))));
  mine.forEach(r => {
    if (r.bad || r.asin) return;
    const w = staNorm(r.term).split(' ').filter(Boolean);
    const seen = new Set();
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const parts = w.slice(i, i + n);
        if (parts.every(x => STA_STOP.has(x) || /^\d/.test(x))) continue;
        if (n === 1 && (STA_STOP.has(parts[0]) || parts[0].length < 3 || /\d/.test(parts[0]))) continue;
        const gram = parts.join(' ');
        if (seen.has(gram)) continue;
        seen.add(gram);
        const x = map.get(gram) || map.set(gram, { n: 0, c: 0, sp: 0, o: 0, s: 0, zsp: 0, cps: new Map(), terms: [] }).get(gram);
        x.n++; x.c += r.c; x.sp += r.sp; x.o += r.o; x.s += r.s;
        if (!(r.o > 0)) x.zsp += r.sp;
        if (x.terms.length < 8) x.terms.push(r.term);
        const cp = x.cps.get(r.cid) || x.cps.set(r.cid, { cid: r.cid, cn: r.cn, sp: 0, s: 0, o: 0, n: 0 }).get(r.cid);
        cp.sp += r.sp; cp.s += r.s; cp.o += r.o; cp.n++;
      }
    }
  });
  // The tail the backend kept as words (AdsDecide.gs: terms too small to be listed one by one).
  const tail = (ST.set && ST.set.d && ST.set.d[b] && ST.set.d[b].grams) || [];
  tail.forEach(t => {
    const x = map.get(t[0]) || map.set(t[0], { n: 0, c: 0, sp: 0, o: 0, s: 0, zsp: 0, cps: new Map(), terms: [] }).get(t[0]);
    x.n += t[1]; x.c += t[2]; x.sp += t[3]; x.o += t[4]; x.s += t[5]; x.tail = (x.tail || 0) + t[3];
    if (!(t[4] > 0)) x.zsp += t[3];
    (t[6] || []).forEach(([cid, sp]) => {
      const cp = x.cps.get(cid) || x.cps.set(cid, { cid, cn: staName(b, cid), sp: 0, s: 0, o: 0, n: 0 }).get(cid);
      cp.sp += sp;
    });
  });
  const p = bAgg.c > 0 && bAgg.o > 0 ? bAgg.o / bAgg.c : null;
  const rows = [];
  map.forEach((x, gram) => {
    const words = gram.split(' ');
    const blocked = P.blocked.find(w => w === gram);
    const comp = P.competitors.find(w => w === gram);
    const tagged = blocked || comp;
    if (!tagged) {
      if (x.n < STA.WORD_TERMS || x.o > 0 || x.sp < STA.WORD_SPEND || x.c < STA.WORD_CLICKS) return;
      if (p && Math.pow(1 - p, x.c) >= STA.CHANCE) return;
    } else if (!(x.sp > 0)) return;
    const k = staKey(gram);
    const protect = allTypes.has(k) ? 'product word' : P.isBrand(gram) ? 'brand term' : staSeasonOf(gram) ? 'seasonal word'
      : P.ownKw.has(k) ? 'your own keyword' : !tagged && words.every(w => typeWords.has(staSing(w))) ? 'part of a product word' : '';
    if (protect && !tagged) return;
    const key = 'w:' + b + '|' + gram;
    const cps = [...x.cps.values()].filter(c => c.sp >= 0.5).sort((a, z) => z.sp - a.sp);
    const row = { key, type: 'word', brand: b, term: tagged ? (P.rawOf.get(gram) || gram) : gram, gram, words: words.length, n: x.n, c: x.c, sp: x.sp, o: x.o, s: x.s,
      zsp: x.zsp, tail: x.tail || 0, cps, terms: x.terms, tag: blocked ? 'blocked' : comp ? 'competitor' : '', protect,
      hay: (gram + ' ' + x.terms.join(' ') + ' ' + cps.map(c => c.cn).join(' ')).toLowerCase() };
    row.cat = 'burn';
    row.kind = 'word';
    row.burned = x.o > 0 ? Math.max(0, x.zsp) : x.sp;
    row.stake = row.burned;
    row.rl = [...rlOpen.keys()].some(kk => kk.startsWith(key + '|'));
    row.next = protect ? null : info.stale ? null : row.rl ? null : 'word';
    row.hold = protect ? `A ${protect}: never negated` : info.stale ? info.stale : '';
    row.status = row.rl ? 'In review' : 'Active';
    row.act = row.next === 'word';
    rows.push(row);
  });
  // One piece per idea: a shorter piece found in exactly the terms of a longer one gives way to the longer (more exact)
  // one; then a longer piece holding a shorter one that is still listed adds nothing (that negative phrase covers it).
  const inside = (a, z) => a !== z && (' ' + z.gram + ' ').includes(' ' + a.gram + ' ');
  const left = rows.filter(a => a.tag || !rows.some(z => !z.tag && inside(a, z) && z.n >= a.n));
  left.sort((a, z) => a.words - z.words || z.sp - a.sp);
  const kept = [];
  left.forEach(r => {
    if (!r.tag && kept.some(k => !k.tag && inside(k, r))) return;
    kept.push(r);
  });
  kept.forEach(r => { M.words.push(r); M.byKey.set(r.key, r); });
}

/* ---------- filtering ---------- */

// The text filter, minimum spend and the four Filters, as one test for a row.
function staPass() {
  const q = $('stFilter').value.trim().toLowerCase();
  const minSp = Number($('stMinSpend').value) || 0;
  const fMt = $('stFMt').value, fCt = $('stFCt').value, fV = $('stFV').value, fTag = $('stFTag').value;
  return r => {
    if (minSp && r.sp < minSp) return false;
    if (q && !r.hay.includes(q)) return false;
    if (r.type === 'word') return !fMt && !fCt && (!fTag || (fTag === 'brand' && r.protect === 'brand term')) && staVPass(r, fV);
    if (fMt && staMtGroup(r.mt) !== fMt) return false;
    if (fCt && (r.ai && r.ai.ctype) !== fCt) return false;
    if (fTag && !(r.tagSet && r.tagSet.has(fTag))) return false;
    return staVPass(r, fV);
  };
}
// The verdict filter.
function staVPass(r, v) {
  if (!v) return true;
  if (v === 'act') return !!r.act;
  if (v === 'burn') return r.cat === 'burn';
  if (v === 'scale') return r.cat === 'scale';
  if (v === 'watch') return r.cat === 'watch';
  if (v === 'check') return r.cat === 'check';
  if (v === 'hold') return !r.act && !!r.hold && r.cat !== 'check';
  if (v === 'ok') return (r.badges || []).some(b => b[1] === 'ok');
  return true;
}
// What each view lists, after the filters.
function staLists() {
  const M = staModel(), ok = staPass();
  const all = M.rows.filter(ok);
  const groups = M.groups.map(g => Object.assign({}, g, { shown: g.paths.filter(ok) }))
    .filter(g => g.shown.some(r => r.role === 'other'));
  return {
    M, all,
    burn: all.filter(r => r.cat === 'burn'),
    burnTgt: M.tgRows.filter(g => g.cat === 'burn' || g.cat === 'watch').filter(ok),
    words: M.words.filter(ok),
    scale: all.filter(r => r.cat === 'scale'),
    groups,
  };
}

/* ---------- sorting and pages ---------- */
const STA_SORTS = {
  stake: r => r.stake || 0, sp: r => r.sp, s: r => r.s, acos: r => (r.acos == null ? -1 : r.acos), o: r => r.o, c: r => r.c,
  cvr: r => (r.c > 0 ? r.o / r.c : -1), cpc: r => (r.cpc == null ? -1 : r.cpc), i: r => r.i || 0, term: r => staLow(r.term),
};
// The sort of the view: the column clicked, else the view's own (money at stake, or spend in All terms).
function staSorted(rows, def) {
  const k = ST_SORT.k || def, d = ST_SORT.k ? ST_SORT.d : -1;
  const f = STA_SORTS[k] || STA_SORTS.sp;
  return rows.slice().sort((a, z) => {
    const x = f(a), y = f(z);
    return (x < y ? -1 : x > y ? 1 : 0) * d || (z.sp - a.sp);
  });
}
// A sortable heading.
function staTh(t, k, num, tip) {
  const on = (ST_SORT.k || '') === k;
  return `<th class="${num ? 'num ' : ''}sta-sort${on ? ' on' : ''}" data-sort="${k}" title="${staEsc(tip || 'Sort by ' + t)}" aria-sort="${on ? (ST_SORT.d > 0 ? 'ascending' : 'descending') : 'none'}">${t}${on ? (ST_SORT.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
}
// This page of rows.
function staPage(rows) {
  const pages = Math.max(1, Math.ceil(rows.length / ST_SIZE));
  if (ST_PG >= pages) ST_PG = pages - 1;
  return rows.slice(ST_PG * ST_SIZE, ST_PG * ST_SIZE + ST_SIZE);
}
// The footer: rows shown, the pages, and a note.
function staPager(total, what, note) {
  const pages = Math.max(1, Math.ceil(total / ST_SIZE));
  const a = total ? ST_PG * ST_SIZE + 1 : 0, z = Math.min(total, (ST_PG + 1) * ST_SIZE);
  stFoot(`<span>${staInt(a)}–${staInt(z)} of ${staInt(total)} ${what}${note ? ' · ' + note : ''}</span>`
    + (pages > 1 ? `<span class="sta-pages"><button type="button" class="ghost" data-pg="prev"${ST_PG ? '' : ' disabled'}>‹ Previous</button>`
      + `<span>Page ${ST_PG + 1} of ${pages}</span><button type="button" class="ghost" data-pg="next"${ST_PG < pages - 1 ? '' : ' disabled'}>Next ›</button></span>` : ''));
}

/* ---------- drawing ---------- */

// Draw the whole screen.
function renderSt() {
  const isCp = ST_VIEW === 'cp';
  $('stViewSeg').querySelectorAll('[data-v]').forEach(x => {
    x.classList.toggle('on', x.dataset.v === ST_VIEW);
    x.setAttribute('aria-selected', x.dataset.v === ST_VIEW ? 'true' : 'false');
  });
  $('stBurnSeg').classList.toggle('hide', ST_VIEW !== 'burn');
  $('stBurnSeg').querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x.dataset.s === ST_SUB));
  $('stCpShow').classList.toggle('hide', !isCp);
  $('stCpTarget').classList.toggle('hide', !isCp);
  $('stSizeWrap').classList.toggle('hide', isCp);
  staRlBadge();
  const nF = ['stFMt', 'stFCt', 'stFV', 'stFTag'].filter(id => $(id).value).length;
  $('stMoreN').textContent = nF;
  $('stMoreN').classList.toggle('hide', !nF);
  const haveAny = ['SP', 'CPC'].some(b => ((ST.terms[b] || {}).rows || []).length || ((ST.tgts[b] || {}).rows || []).length
    || (ST.set && ST.set.d && ST.set.d[b]));
  if (!haveAny && !isCp) {
    ['stBoxes', 'stSum', 'stTable'].forEach(id => { $(id).innerHTML = ''; });
    $('stTitle').textContent = 'No search terms yet';
    $('stSub').textContent = '';
    stMsg('The nightly run has not collected any search-term data yet, or the last one came back empty. Nothing is suggested '
      + 'until it does: an empty night is never read as "no sales".', true);
    stFoot('');
    staSelBar();
    return;
  }
  const L = staLists();
  staDataLine(L.M);
  staSummary(L);
  staBoxes(L);
  if (isCp) {
    $('stTitle').textContent = 'Which campaign × product is working?';
    $('stSub').textContent = 'One row per campaign, ad group and SKU over 30 days, with whether the ad runs, its FBA stock and a verdict. Advice only.';
    renderCp();
  } else if (ST_VIEW === 'burn' && ST_SUB === 'target') staDrawBurnTgt(L);
  else if (ST_VIEW === 'burn' && ST_SUB === 'word') staDrawWords(L);
  else if (ST_VIEW === 'burn') staDrawBurn(L);
  else if (ST_VIEW === 'scale') staDrawScale(L);
  else if (ST_VIEW === 'paths') staDrawPaths(L);
  else staDrawAll(L);
  staSelBar();
}

// The data line: window, completeness per brand, data checks, unit costs, Amazon's record, where the lists are kept.
function staDataLine(M) {
  const parts = [];
  const h = M.have;
  if (M.settled) {
    const x = M.brands.map(b => h[b]).find(y => y && y.from) || {};
    parts.push(`Judged on <b>settled clicks${x.from ? ', ' + staEsc(staShortDay(x.from)) + ' – ' + staEsc(staShortDay(x.to)) : ''}</b>, with 7-day sales as in the Ads console.`
      + (ST.rec ? ' The last 7 days show under the figures in Burning money and are not counted.' : ''));
  } else {
    parts.push(`Judged on <b>the last 30 days</b>${ST.at ? ' (nightly run ' + staEsc(ST.at) + ')' : ''}, with Amazon's 30-day sales — the Ads console shows 7-day, so figures run a little higher here. The newest days can still gain orders.`);
  }
  M.brands.forEach(b => {
    const i = M.info[b] || {};
    if (i.stale) parts.push(`<span class="sta-bad">✗ ${staBrandName(b)}: ${staEsc(i.stale)} — no suggestions for it</span>`);
  });
  const okB = M.brands.filter(b => !(M.info[b] || {}).stale);
  if (okB.length) parts.push(`<span class="sta-ok">✓ ${okB.map(staBrandName).join(' and ')}${okB.length > 1 ? ' both' : ''} complete</span>`);
  const bad = M.brands.reduce((t, b) => t + ((M.info[b] || {}).bad || 0), 0);
  if (bad) parts.push(`<span class="sta-bad">${staInt(bad)} row${bad === 1 ? '' : 's'} set aside as a data check (more orders than clicks, or sales without clicks): never used in a verdict</span>`);
  if (!ST.costs) parts.push(`<span class="sta-bad">${ST.costErr ? 'Unit costs could not be read for your account (Profit &amp; Margin access needed)' : 'No unit costs in Profit &amp; Margin'}: no profit verdicts — only "no sales" — unless a target ACoS is set in Lists &amp; settings</span>`);
  parts.push(ST.ent ? `Amazon IDs and current bids read ${staEsc(ST.ent.at || '')}` : 'Amazon IDs and current bids not read yet: bids are worked from the CPC, and bid changes wait in the review list');
  if (ST_RL.where === 'local' || STS.where === 'local') parts.push('<span class="sta-bad">The review list and the lists are kept in this browser only until they are switched on for everyone</span>');
  stMsg(parts.map(p => `<span>${p}</span>`).join(''));
}

// The summary strip: the whole account's Sponsored Products figures for the brands in view, and what is not listed.
function staSummary(L) {
  const M = L.M;
  let sp = 0, s = 0, o = 0, c = 0, tail = 0, tailN = 0;
  M.brands.forEach(b => {
    (staTgtsOf(b).rows || []).forEach(x => { sp += x.sp || 0; s += x.s || 0; o += x.o || 0; c += x.c || 0; });
    tail += (M.have[b] || {}).dropSpend || 0;
    tailN += (M.have[b] || {}).dropped || 0;
  });
  const act = L.all.filter(r => r.act).length + L.burnTgt.filter(g => g.next && g.next !== 'limit' && g.next !== 'lowstock').length + L.words.filter(w => w.act).length;
  const cell = (k, v, tip) => `<div${tip ? ` title="${staEsc(tip)}"` : ''}><small>${k}</small><b>${v}</b></div>`;
  $('stSum').innerHTML = cell('Ad spend', staMoney0(sp), 'All keywords and targets of the brands in view, this window')
    + cell('Ad sales', staMoney0(s)) + cell('ACoS', s > 0 ? staPct(sp / s * 100) : '—') + cell('Orders', staInt(o)) + cell('Clicks', staInt(c))
    + cell('Search terms', staInt(M.rows.length), 'Listed one by one')
    + cell('Suggestions', staInt(act), 'Rows with a next step, after the filters')
    + cell('Not listed', staMoney0(tail), `${staInt(tailN)} terms with fewer than 3 clicks and no order, too small to list one by one. Their recurring words appear in Burning money → By word once the backend sends them.`);
}

// The four boxes over the table.
function staBoxes(L) {
  const IC = {
    burn: '<path d="M12 2c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-6 1.5 1 2 2.5 2 4 1-1 1.5-4 1-8Z"/>',
    scale: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    paths: '<path d="M6 3v6a6 6 0 0 0 6 6h6"/><path d="M18 3v6"/><path d="M15 18l3-3-3-3"/>',
    rl: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  };
  const box = (k, c, label, big, unit, q, go) => `
    <button type="button" class="adx-box sta-box${ST_VIEW === k ? ' on' : ''}" data-box="${k}" style="--c:${c};--adx-glow:.10" aria-label="${staEsc(label + ': ' + big + ' ' + unit + '. ' + go)}">
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg></span>${label}</div>
      <div class="sta-big"><b>${big}</b><span>${unit}</span></div>
      <div class="sta-q">${q}</div>
      <div class="sta-go"><span>${go} →</span></div>
    </button>`;
  const burned = L.burn.reduce((t, r) => t + r.burned, 0);
  const none = L.burn.filter(r => r.kind === 'none').length, be = L.burn.filter(r => r.kind === 'be').length, poor = L.burn.filter(r => r.kind === 'poor').length;
  const exact = L.scale.filter(r => r.scaleKind !== 'raise').length;
  const excess = L.groups.reduce((t, g) => t + g.shown.filter(r => r.role === 'other').reduce((u, r) => u + (r.excess || 0), 0), 0);
  const open = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved');
  const appr = open.filter(x => x.status === 'approved').length;
  $('stBoxes').innerHTML =
    box('burn', 'var(--bad)', 'Burning money', staMoney0(burned), `on ${staInt(L.burn.length)} search term${L.burn.length === 1 ? '' : 's'}`,
      `${staInt(none)} with no sales, ${staInt(be)} above break-even${poor ? `, ${staInt(poor)} converting poorly` : ''}.`, 'Negatives and lower bids')
    + box('scale', 'var(--accent)', 'Worth scaling', staInt(L.scale.length), 'search terms',
      `Selling under target with room to grow${exact ? ` · ${staInt(exact)} not their own keyword yet` : ''}.`, 'Raise bids, add as exact')
    + box('paths', 'var(--brand)', 'Competing paths', staInt(L.groups.length), 'search terms',
      `One product reached through several targets · ${staMoney0(excess)} of overlap cost.`, 'Keep the lead path')
    + box('rl', 'var(--violet-ink)', 'Review list', staInt(open.length), 'waiting',
      appr ? `${staInt(appr)} approved, ready for the bulk file.` : 'Approve, then download as an Amazon bulk file.', 'Open the review list');
}

// The view's title and sub-line.
function staHead(title, sub) {
  $('stTitle').textContent = title;
  $('stSub').innerHTML = sub;
}
// The first heading: the tick-all box (when given) and "sort by term".
const staThStick = (tick, label) => `<th class="sta-stick sta-sort${ST_SORT.k === 'term' ? ' on' : ''}" data-sort="term" title="Sort by ${staEsc(label.toLowerCase())}">${tick || ''} ${label}${ST_SORT.k === 'term' ? (ST_SORT.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
// The tick box of a row (only rows with a next step that can go into the review list).
const staTick = r => r.act ? `<input type="checkbox" class="sta-cb" data-sel="${staEsc(r.key)}"${ST_SEL.has(r.key) ? ' checked' : ''} aria-label="Select ${staEsc(r.term)}">` : '<span class="sta-cbgap"></span>';
// The term cell (stays in place when the table scrolls sideways): tick, term, brand, tags.
function staTermCell(r, opts) {
  const o = opts || {};
  const asinT = r.asin ? `<span class="sta-asin">${staEsc(r.term.toUpperCase())}</span>${staTitle(r.term) ? `<small class="sta-s">${staEsc(staTitle(r.term).slice(0, 70))}</small>` : ''}` : staEsc(r.term);
  const tags = (r.tags || []).filter(t => t[0] !== 'halo' || o.halo).map(t => staBadge(t[1], t[0] === 'brand' || t[0] === 'main' || t[0] === 'product' ? 'info' : t[0] === 'season' ? 'warn' : '', t[2]));
  return `<td class="sta-stick">${o.noTick ? '' : staTick(r)}<div class="sta-tc"><div class="sta-term">${o.caret || ''}${asinT}</div>`
    + `<div class="sta-under">${staBadge(staBrandName(r.brand), 'brand-' + r.brand)}${tags.join('')}</div></div></td>`;
}
// The path cell: campaign, then ad group · target.
function staPathCell(r) {
  const label = staPathLabel(r.kw, r.mt);
  const agn = r.agn && !label.toLowerCase().includes(r.agn.toLowerCase()) ? r.agn + ' · ' : '';
  return `<td class="sta-path" title="${staEsc(r.cn + ' · ' + r.agn + ' · ' + label)}"><b>${staEsc(r.cn || 'Campaign ' + r.cid)}</b>`
    + `<small>${staEsc(agn)}${staEsc(label)}</small></td>`;
}
// The "+n last 7 days" line under a figure; blank without the recent cache.
function staUp(r, k, money) {
  if (!r.r7) return '';
  const v = r.r7[k] || 0;
  return `<small class="sta-s up">${v ? '+' + (money ? staMoney(v) : staInt(v)) + ' last 7 days' : '&nbsp;'}</small>`;
}
// The verdict cell: the one main badge, and the evidence or the hold reason under it.
function staVerdictCell(r, long) {
  const main = (r.badges || [])[0];
  const more = (r.badges || []).slice(1).filter(x => x[1] === 'info').map(x => staBadge(x[0], x[1], x[2])).join('');
  const why = r.ev || r.protectNote || r.hold || '';
  return `<td class="sta-ev${long ? '' : ' sta-ev-s'}">${main ? staBadge(main[0], main[1], main[2]) : ''}${more}${why ? `<div class="sta-why">${why}</div>` : ''}</td>`;
}
// The next-step cell: exactly what the button will do.
function staNextCell(r) {
  if (r.status === 'In review') return '<td class="sta-next"><span class="sta-inrl">In the review list</span></td>';
  if (r.status === 'Negated') return `<td class="sta-next"><span class="sta-hold">Hold · ${staEsc(r.negated)}</span></td>`;
  const n = r.next;
  const g = r.type === 'target' ? r : r.tr;
  const lvl = r.pathLevel === 'ag' || r.asin ? 'ad group' : 'campaign';
  const negType = r.asin ? 'Negative ASIN target' : 'Negative exact';
  const where = r.pathLevel === 'ag' || r.asin ? (r.agn || 'this ad group') : (r.cn || 'this campaign');
  const bidTxt = gg => gg && gg.sugBid ? (gg.bidBase === 'bid' ? `${staMoney(gg.ent.bid)} → <b>${staMoney(gg.sugBid)}</b>` : `CPC ${staMoney(gg.cpc)} → <b>${staMoney(gg.sugBid)}</b>`) : '';
  if (n === 'neg') return `<td class="sta-next"><small>${negType} · ${lvl} · ${staEsc(where)}</small>${staBtn('Add negative', 'neg', r.key, 'neg')}</td>`;
  if (n === 'reduce' && g) return `<td class="sta-next"><small>Bid on ${staEsc(staPathLabel(g.kw, g.mt))}: ${bidTxt(g)}</small>${staBtn('Lower bid', 'reduce', g.key)}</td>`;
  if (n === 'raise' && g) return `<td class="sta-next"><small>Bid on ${staEsc(staPathLabel(g.kw, g.mt))}: ${bidTxt(g)}</small>${staBtn('Raise bid', 'raise', g.key)}</td>`;
  if (n === 'exact') return `<td class="sta-next"><small>New exact keyword at <b>${staMoney(r.sugBid)}</b></small>${staBtn('Add as exact', 'exact', r.key)}</td>`;
  if (n === 'asinT') return `<td class="sta-next"><small>New ASIN target at <b>${staMoney(r.sugBid)}</b></small>${staBtn('Target this ASIN', 'asinT', r.key)}</td>`;
  if (n === 'pause') return `<td class="sta-next"><small>${r.type === 'term' ? 'Duplicate exact keyword in ' + staEsc(r.cn) : 'Pause ' + staEsc(staPathLabel(r.kw, r.mt))}</small>${staBtn(r.type === 'term' ? 'Pause duplicate' : 'Pause', 'pause', r.type === 'term' ? r.key : r.key, 'neg')}</td>`;
  if (n === 'word') return `<td class="sta-next"><small>Negative phrase "${staEsc(r.term)}" · campaign level · ${staInt(r.cps.length)} campaign${r.cps.length === 1 ? '' : 's'}</small>${staBtn('Add negative phrase', 'word', r.key, 'neg')}</td>`;
  if (n === 'limit') {
    const x = g && g.ent && g.cpc ? (g.ent.bid / g.cpc).toFixed(1) : '';
    return `<td class="sta-next"><div class="sta-limit"><b>The bid isn't the limit.</b> It is ${x}× the CPC already. Check the campaign's budget and top-of-search placement.</div></td>`;
  }
  if (n === 'lowstock') return `<td class="sta-next"><div class="sta-limit"><b>Low stock.</b> About ${Math.round((r.ln || {}).cover || 0)} days of FBA stock: no raise under ${STA.RAISE_COVER} days.</div></td>`;
  return `<td class="sta-next"><span class="sta-hold">${r.hold ? 'Hold · ' + staEsc(r.hold.replace(/<[^>]+>/g, '')) : 'No change needed'}</span></td>`;
}
// The figure cells of a row, in the order of the headings.
const staFigCells = r => `<td class="num">${staMoney(r.sp)}</td><td class="num">${staMoney(r.s)}</td><td class="num"><b>${r.acos != null ? staPct(r.acos) : staDash}</b></td>`
  + `<td class="num">${staInt(r.o)}</td><td class="num">${staInt(r.c)}</td><td class="num">${r.c > 0 ? staPct(r.o / r.c * 100) : staDash}</td>`
  + `<td class="num">${r.cpc != null ? staMoney(r.cpc) : staDash}</td>`;
const staFigHeads = () => staTh('Spend', 'sp', 1) + staTh('Sales', 's', 1) + staTh('ACoS', 'acos', 1) + staTh('Orders', 'o', 1)
  + staTh('Clicks', 'c', 1) + staTh('CVR', 'cvr', 1) + staTh('CPC', 'cpc', 1);
// The heading of the tick-all box.
const staTickAll = rows => {
  const t = rows.filter(r => r.act);
  const on = t.length && t.every(r => ST_SEL.has(r.key));
  return `<input type="checkbox" class="sta-cb" data-selall="1"${on ? ' checked' : ''} title="Tick every suggestion on this page" aria-label="Tick every suggestion on this page">`;
};

// All terms: one row per search term — several paths open underneath — with its verdict and next step.
function staDrawAll(L) {
  // Group the paths of a term (same brand); a term with one path is one row.
  const gm = new Map();
  L.all.forEach(r => {
    const k = r.brand + '|' + r.tk;
    const g = gm.get(k) || gm.set(k, { key: 'a:' + k, brand: r.brand, term: r.term, tk: r.tk, paths: [] }).get(k);
    g.paths.push(r);
  });
  const groups = [...gm.values()].map(g => {
    const p = g.paths;
    const sum = f => p.reduce((t, r) => t + (r[f] || 0), 0);
    const x = Object.assign(g, { sp: sum('sp'), s: sum('s'), o: sum('o'), c: sum('c'), i: sum('i'), stake: sum('stake') });
    x.acos = x.s > 0 ? x.sp / x.s * 100 : null;
    x.cpc = x.c > 0 ? x.sp / x.c : null;
    x.nAct = p.filter(r => r.act).length;
    return x;
  });
  const sorted = staSorted(groups, 'sp');
  ST_LAST = L.all;
  const page = staPage(sorted);
  staHead('Every search term', 'One row per search term; one with several paths opens to show each campaign and target. Verdict and next step first, figures after.');
  const pathRow = (r, sub) => `<tr class="${sub ? 'sta-subrow' : ''}${ST_SEL.has(r.key) ? ' sel' : ''}">
    ${sub ? `<td class="sta-stick">${staTick(r)}<div class="sta-tc"><small class="sta-s">↳ ${staEsc(r.cn)}</small></div></td>` : staTermCell(r)}
    ${staVerdictCell(r)}${staNextCell(r)}${staFigCells(r)}${staPathCell(r)}<td class="num ui-dim">${staInt(r.i)}</td></tr>`;
  let body = '';
  page.forEach(g => {
    if (g.paths.length === 1) { body += pathRow(g.paths[0], false); return; }
    const open = ST_OPEN.has(g.key);
    const lead = g.paths.slice().sort((a, z) => (z.act - a.act) || (z.stake - a.stake) || (z.sp - a.sp))[0];
    const caret = `<button type="button" class="sta-caret" data-open="${staEsc(g.key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} the paths of ${staEsc(g.term)}">${open ? '▾' : '▸'}</button>`;
    body += `<tr class="sta-grprow">
      ${staTermCell(Object.assign({}, lead, { term: g.term, act: false, tags: lead.tags }), { caret, noTick: false })}
      <td class="sta-ev sta-ev-s">${g.nAct ? staBadge(`${g.nAct} to act on`, 'bad') : staBadge('No change', '')}<div class="sta-why">${staInt(g.paths.length)} paths · ${staInt(new Set(g.paths.map(r => r.cid)).size)} campaign${new Set(g.paths.map(r => r.cid)).size === 1 ? '' : 's'}</div></td>
      <td class="sta-next"><button type="button" class="sta-btn dim" data-open="${staEsc(g.key)}">${open ? 'Hide paths' : 'Show paths'}</button></td>
      ${staFigCells(g)}<td class="sta-path"><b>${staInt(g.paths.length)} paths</b><small>${staEsc(g.paths.slice(0, 2).map(r => r.cn).join(', '))}${g.paths.length > 2 ? '…' : ''}</small></td>
      <td class="num ui-dim">${staInt(g.i)}</td></tr>`;
    if (open) staSorted(g.paths, 'sp').forEach(r => { body += pathRow(r, true); });
  });
  $('stTable').innerHTML = `<thead><tr>${staThStick(staTickAll(page.flatMap(g => g.paths.length === 1 || ST_OPEN.has(g.key) ? g.paths : [])), 'Search term')}<th>Verdict</th><th>Next step</th>${staFigHeads()}
    <th>Path · campaign and target</th>${staTh('Impr.', 'i', 1)}</tr></thead><tbody>`
    + (body || '<tr><td colspan="12" class="muted" style="padding:14px">Nothing matches.</td></tr>') + '</tbody>';
  const dropped = L.M.brands.reduce((a, b) => {
    const h = L.M.have[b] || {};
    a.n += h.dropped || 0;
    a.sp += h.dropSpend || 0;
    a.min = h.minClicks || a.min;
    return a;
  }, { n: 0, sp: 0, min: 3 });
  staPager(sorted.length, 'search terms', `sorted by ${ST_SORT.k ? 'the column picked' : 'spend'}`
    + (dropped.n ? ` · ${staInt(dropped.n)} more terms with fewer than ${dropped.min} clicks and no order are not listed (${staMoney0(dropped.sp)})` : ''));
}

// Burning money, by search term.
function staDrawBurn(L) {
  const rows = staSorted(L.burn, 'stake');
  ST_LAST = rows;
  const page = staPage(rows);
  const tot = rows.reduce((t, r) => t + r.burned, 0);
  const none = rows.filter(r => r.kind === 'none').length, poor = rows.filter(r => r.kind === 'poor').length;
  staHead('Which search terms are burning money?', `${staInt(rows.length)} terms earned no profit: ${staInt(none)} with no sales, ${staInt(rows.length - none - poor)} above break-even, ${staInt(poor)} converting at under half the normal rate.`
    + ` Protected terms (brand, product words, main keywords, seasonal, own ASINs) get a lower bid or a hold — never a negative.`);
  const body = page.map(r => `<tr${ST_SEL.has(r.key) ? ' class="sel"' : ''}>
      ${staTermCell(r)}${staVerdictCell(r, true)}${staNextCell(r)}
      <td class="num sta-money">${staMoney(r.burned)}</td>
      <td class="num">${staMoney(r.sp)}${staUp(r, 'sp', true)}</td><td class="num">${staInt(r.o)}${staUp(r, 'o')}</td><td class="num">${staInt(r.c)}${staUp(r, 'c')}</td>
      <td class="num">${r.acos != null ? staPct(r.acos) : staDash}</td>${staPathCell(r)}</tr>`).join('');
  $('stTable').innerHTML = `<thead><tr>${staThStick(staTickAll(page), 'Search term')}<th>Verdict · evidence</th><th>Next step</th>
    ${staTh('Money burned', 'stake', 1, 'Spend with no sale, or the spend above what break-even allows')}${staTh('Spend', 'sp', 1)}${staTh('Orders', 'o', 1)}${staTh('Clicks', 'c', 1)}${staTh('ACoS', 'acos', 1)}<th>Path</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="9" class="muted" style="padding:14px">Nothing is burning money in this view.</td></tr>')
    + (page.length ? `<tr class="tot"><td class="sta-stick">Total, all ${staInt(rows.length)}</td><td></td><td></td><td class="num sta-money">${staMoney(tot)}</td><td colspan="5"></td></tr>` : '')
    + '</tbody>';
  staPager(rows.length, 'terms', '"By target" has one bid line per keyword or target; "By word" the words that recur without selling');
}

// Burning money, by target: the keywords and targets themselves, one bid line each.
function staDrawBurnTgt(L) {
  const rows = staSorted(L.burnTgt, 'stake');
  ST_LAST = rows;
  const page = staPage(rows);
  const tot = rows.filter(g => g.cat === 'burn').reduce((t, g) => t + g.burned, 0);
  staHead('Which keywords and targets are burning money?', `${staInt(rows.filter(g => g.cat === 'burn').length)} keywords and targets lost ${staMoney0(tot)} against break-even, with ${STA.MIN_CLICKS}+ clicks.`
    + ` One bid line per target, worked out from the whole target — it moves every search term of that target.`);
  const body = page.map(g => {
    const p = g.rate && g.rate.p;
    const ev = g.kind === 'none' ? `0 orders in <b>${staInt(g.c)} clicks</b> · ${(g.chance * 100).toFixed(1)}% chance of that at ${(p * 100).toFixed(1)}% (${g.rate.w})`
      : g.kind === 'be' ? `ACoS <b>${staPct(g.acos)}</b> vs break-even ${staPct(g.beUse)}: ${staMoney(g.burned)} over`
        : g.kind === 'poor' ? `${staInt(g.o)} orders in <b>${staInt(g.c)} clicks</b>, under half ${g.rate.w}'s rate; ACoS ${staPct(g.acos)} over target ${staPct(g.tgtUse)}` : '';
    const v = Object.assign({}, g, { badges: [[g.cat === 'watch' ? 'Watch' : g.kind === 'none' ? 'No sales' : g.kind === 'be' ? 'Above break-even' : 'Converts poorly', g.cat === 'watch' ? 'warn' : 'bad']], ev,
      status: g.rl ? 'In review' : 'Active', act: !!(g.next && !/limit|lowstock/.test(g.next) && !g.rl), tags: [] });
    if (g.noPause && g.next === 'reduce' && g.kind === 'none') v.protectNote = `A ${g.noPause}: lowered, never paused`;
    return `<tr${ST_SEL.has(g.key) ? ' class="sel"' : ''}>
      <td class="sta-stick">${staTick(v)}<div class="sta-tc"><div class="sta-term">${staEsc(staPathLabel(g.kw, g.mt))}</div><div class="sta-under">${staBadge(staBrandName(g.brand), 'brand-' + g.brand)}</div></div></td>
      ${staVerdictCell(v, true)}${staNextCell(v)}
      <td class="num sta-money">${g.cat === 'burn' ? staMoney(g.burned) : staDash}</td>
      <td class="num">${staMoney(g.sp)}${staUp(g, 'sp', true)}</td><td class="num">${staInt(g.o)}${staUp(g, 'o')}</td><td class="num">${staInt(g.c)}${staUp(g, 'c')}</td>
      <td class="num">${g.acos != null ? staPct(g.acos) : staDash}</td>
      <td class="sta-path"><b>${staEsc(g.cn)}</b><small>${staEsc(g.agn)}</small></td></tr>`;
  }).join('');
  $('stTable').innerHTML = `<thead><tr>${staThStick(staTickAll(page.map(g => Object.assign({}, g, { act: !!(g.next && !/limit|lowstock/.test(g.next) && !g.rl) }))), 'Keyword / target')}<th>Verdict · evidence</th><th>Next step</th>
    ${staTh('Money burned', 'stake', 1)}${staTh('Spend', 'sp', 1)}${staTh('Orders', 'o', 1)}${staTh('Clicks', 'c', 1)}${staTh('ACoS', 'acos', 1)}<th>Campaign · ad group</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="9" class="muted" style="padding:14px">No keyword or target is burning money in this view.</td></tr>') + '</tbody>';
  staPager(rows.length, 'keywords and targets', `no sales and unlikely to be chance → pause (a protected keyword is lowered instead); losing money → a bid ${Math.round(STA.STEP * 100)}% lower at most`);
}

// Burning money, by word.
function staDrawWords(L) {
  const rows = staSorted(L.words, 'stake');
  ST_LAST = rows;
  const page = staPage(rows);
  const blocked = rows.filter(r => r.tag).length;
  staHead('Which words keep costing without selling?', `${staInt(rows.length)} words and short phrases: ${staInt(blocked)} from your blocked words and competitor brands, the rest recurring across ${STA.WORD_TERMS}+ terms with no order.`
    + ' One negative phrase per campaign stops every term holding it. Product words, brand terms, main keywords and seasonal words are never listed.');
  const body = page.map(r => {
    const v = Object.assign({}, r, { badges: [[r.tag === 'blocked' ? 'Blocked word' : r.tag === 'competitor' ? 'Competitor brand' : 'No sales', r.tag ? 'warn' : 'bad']],
      ev: `In <b>${staInt(r.n)} terms</b>, ${staInt(r.c)} clicks, ${staInt(r.o)} orders${r.o ? ` (${staMoney(r.s)} of sales would be blocked)` : ''}${r.tail ? ` · ${staMoney(r.tail)} of it in terms too small to list` : ''}`
        + `<br><span class="sta-dash">${staEsc(r.terms.slice(0, 4).join(' · '))}${r.n > 4 ? ' …' : ''}</span>` });
    return `<tr${ST_SEL.has(r.key) ? ' class="sel"' : ''}>
      <td class="sta-stick">${staTick(r)}<div class="sta-tc"><div class="sta-term">"${staEsc(r.term)}"</div><div class="sta-under">${staBadge(staBrandName(r.brand), 'brand-' + r.brand)}</div></div></td>
      ${staVerdictCell(v, true)}${staNextCell(r)}
      <td class="num sta-money">${staMoney(r.burned)}</td><td class="num">${staMoney(r.sp)}</td><td class="num">${staInt(r.o)}</td><td class="num">${staInt(r.c)}</td>
      <td class="sta-path"><b>${staInt(r.cps.length)} campaign${r.cps.length === 1 ? '' : 's'}</b><small>${staEsc(r.cps.slice(0, 2).map(c => c.cn).join(', '))}${r.cps.length > 2 ? '…' : ''}</small></td></tr>`;
  }).join('');
  $('stTable').innerHTML = `<thead><tr>${staThStick(staTickAll(page), 'Word')}<th>Verdict · evidence</th><th>Next step</th>
    ${staTh('Money burned', 'stake', 1)}${staTh('Spend', 'sp', 1)}${staTh('Orders', 'o', 1)}${staTh('Clicks', 'c', 1)}<th>Campaigns</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="8" class="muted" style="padding:14px">No word stands out in this view. Add words you never want to pay for in Lists &amp; settings.</td></tr>') + '</tbody>';
  staPager(rows.length, 'words', 'blocked words and competitor brands are listed at any spend');
}

// Worth scaling.
function staDrawScale(L) {
  const rows = staSorted(L.scale, 's');
  ST_LAST = rows;
  const page = staPage(rows);
  staHead('Which search terms are worth scaling?', `${staInt(rows.length)} terms sell under their target ACoS with enough orders: ${STA.SCALE_ORDERS}+ to raise a bid, ${STA.EXACT_ORDERS}+ to add as exact.`
    + ' The ceiling is the CPC that would land on target, capped at twice today\'s CPC.');
  const body = page.map(r => {
    const under = r.tgtUse - r.acos;
    const v = Object.assign({}, r, { ev: `<b>${staPct(r.acos)}</b> ACoS, ${under.toFixed(1)} pts under ${staPct(r.tgtUse)}${r.ln.fallback ? ' (your setting)' : ''} · CPC ${staMoney(r.cpc)} → ceiling ${staMoney(r.ceil)}` });
    return `<tr${ST_SEL.has(r.key) ? ' class="sel"' : ''}>${staTermCell(r)}${staVerdictCell(v, true)}${staNextCell(r)}
      <td class="num">${staInt(r.o)}</td><td class="num">${staMoney(r.s)}</td><td class="num">${staMoney(r.sp)}</td><td class="num"><b>${staPct(r.acos)}</b></td>${staPathCell(r)}</tr>`;
  }).join('');
  $('stTable').innerHTML = `<thead><tr>${staThStick(staTickAll(page), 'Search term')}<th>Verdict · evidence</th><th>Next step</th>
    ${staTh('Orders', 'o', 1)}${staTh('Sales', 's', 1)}${staTh('Spend', 'sp', 1)}${staTh('ACoS', 'acos', 1)}<th>Path</th></tr></thead><tbody>`
    + (body || '<tr><td colspan="8" class="muted" style="padding:14px">Nothing in this view is ready to scale.</td></tr>') + '</tbody>';
  staPager(rows.length, 'terms', `no raise under ${STA.RAISE_COVER} days of FBA stock · own and sister-brand ASINs are never scaled`);
}

// Competing paths: grouped by term and product, the lead path first.
function staDrawPaths(L) {
  const groups = staSorted(L.groups.map(g => Object.assign(g, { stake: g.excess, sp: g.paths.reduce((t, r) => t + r.sp, 0) })), 'stake');
  ST_LAST = groups;
  const page = staPage(groups);
  staHead('Which paths compete for the same search term?', `${staInt(groups.length)} terms reach the same product through more than one target. The lead path has ${STA.LEAD_ORDERS}+ orders and sells under break-even at the lowest ACoS;`
    + ' a path doing as well as the lead is left alone.' + (L.M.overlap ? ` ${staInt(L.M.overlap)} more terms reach different products — shown in All terms, not changed here.` : ''));
  let html = '';
  page.forEach(g => {
    const ps = g.shown;
    const sum = ps.filter(r => r.role === 'other').reduce((t, r) => t + (r.excess || 0), 0);
    html += `<tr class="grp"><td colspan="9" class="sta-grp"><b>"${staEsc(g.term)}"</b><span>${staInt(g.paths.length)} paths · ${staInt(g.campaigns)} campaign${g.campaigns === 1 ? '' : 's'} · ${staEsc(staBrandName(g.brand))}`
      + ` · ${staEsc((g.lead.parents[0] || g.lead.asins[0] || '').toUpperCase())} · overlap cost <em>${staMoney(sum)}</em></span></td></tr>`;
    ps.forEach(r => {
      const lead = r.role === 'lead', fine = r.role === 'fine';
      const txt = lead ? `Keep: sells it best for this product (${staInt(r.o)} orders at ${staPct(r.acos)}${r.own ? ', its own exact keyword' : ''}).`
        : fine ? 'Also fine: sells it as well as the lead — left alone.'
          : r.next === 'pause' ? 'A second exact keyword for the same product: pause this one so the lead takes it.'
            : r.next === 'neg' ? `${r.asin ? 'Negative ASIN target' : 'Negative exact'} at ${r.pathLevel === 'ag' ? 'ad-group' : 'campaign'} level here${r.pathLevel === 'ag' && !r.asin ? ' (the lead is in the same campaign)' : ''}, so the term goes through the lead path.`
              : r.next === 'reduce' ? (r.protectNote || 'A lower bid on this path.') : (r.hold || '');
      html += `<tr${ST_SEL.has(r.key) ? ' class="sel"' : ''}>${fine || lead ? `<td class="sta-stick"><span class="sta-cbgap"></span><div class="sta-tc"><small class="sta-s">${lead ? 'Lead' : 'Also fine'}</small></div></td>` : `<td class="sta-stick">${staTick(r)}<div class="sta-tc"><small class="sta-s">Other path</small></div></td>`}
        ${staPathCell(r)}<td class="num">${staMoney(r.sp)}</td><td class="num">${staInt(r.o)}</td><td class="num">${r.acos != null ? staPct(r.acos) : staDash}</td><td class="num">${r.cpc != null ? staMoney(r.cpc) : staDash}</td>
        <td class="num">${lead || fine ? staDash : staMoney(r.excess)}</td>
        <td class="sta-ev sta-ev-s"><div class="sta-why" style="margin:0">${txt}</div></td>${lead || fine ? '<td class="sta-next"></td>' : staNextCell(r)}</tr>`;
    });
  });
  $('stTable').innerHTML = `<thead><tr><th class="sta-stick">Role</th><th>Path</th><th class="num">Spend</th><th class="num">Orders</th><th class="num">ACoS</th><th class="num">CPC</th>
    <th class="num" title="Spend above what the lead path's ACoS would have cost for the same sales">Overlap cost</th><th>Recommendation</th><th>Next step</th></tr></thead><tbody>`
    + (html || '<tr><td colspan="9" class="muted" style="padding:14px">No search term competes with itself for the same product in this view.</td></tr>') + '</tbody>';
  staPager(groups.length, 'terms', 'a lead needs a unit cost (or your target in Lists & settings) to show it is profitable');
}

// The selection bar.
function staSelBar() {
  const on = ST_VIEW !== 'cp' && ST_SEL.size > 0;
  $('stSelBar').classList.toggle('hide', !on);
  if (!on) return;
  const rows = [...ST_SEL.values()];
  $('stSelTxt').innerHTML = `<b>${staInt(rows.length)} selected</b> · ${staMoney(rows.reduce((t, r) => t + (r.stake || r.burned || 0), 0))} at stake`;
  $('stSelAdd').textContent = `Add ${rows.length} to the review list`;
}

// "How Sellora decides": every rule with its numbers.
function staLegend() {
  const L = (h, items) => `<h4>${h}</h4><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  $('stLegendBody').innerHTML = '<div class="sta-legcols"><div>'
    + L('Before anything is judged', [
      '<b>Data check</b>: a row with more orders than clicks, orders without sales or sales without clicks is set aside and never used.',
      `<b>Incomplete data</b>: a brand with no search terms, or ones older than ${STA.STALE_H} hours, gets no suggestions.`,
      `<b>30 days first</b>: a product with fewer than ${STA.AGE_DAYS} days of ads (from the weekly ad spend), a new campaign or keyword (Amazon's record), or a launch / ranking campaign (by its name) is not judged.`,
      '<b>No unit cost</b>: no profit verdict, only "no sales" — unless a target ACoS is set for the brand in Lists & settings.'])
    + L('Never a negative on', [
      '<b>Brand terms</b> (Lists & settings, and keywords in campaigns named "brand"): judged against ' + STA.BRAND_TGT + '% ACoS.',
      '<b>Own and sister-brand ASINs</b>: defence placements, never negated or scaled.',
      '<b>Product words</b>: what the ad group sells — found in the titles and the campaign and ad-group names, plus your list.',
      `<b>Main keywords</b>: your own keywords for that product, or terms with ${STA.MAIN_ORDERS}+ orders. Only negated on a weaker path when its own exact keyword keeps the term.`,
      '<b>Seasonal terms</b>: never negated. In season (from six weeks before the peak) a lower bid at most; out of season, held.',
      'These get a lower bid on their keyword or target instead, or a stated hold.'])
    + '</div><div>'
    + L('Burning money', [
      `<b>No sales</b>: ${STA.MIN_CLICKS}+ clicks and 0 orders, and under ${Math.round(STA.CHANCE * 100)}% chance of that by bad luck. The yardstick is the conversion rate of its keyword or target (with ${STA.RATE_ORDERS}+ orders), else its campaign's, else the brand's — named on each row.`,
      `<b>Watch</b>: 0 orders, but ${Math.round(STA.CHANCE * 100)}% or more chance of that — shows how many more clicks would tell.`,
      '<b>Above break-even</b>: ACoS over break-even (unit cost + fees; overhead and salary left out). Money burned = spend − sales × break-even.',
      `<b>Converts poorly</b>: ${STA.POOR_CLICKS}+ clicks, under ${Math.round(STA.POOR_SHARE * 100)}% of the yardstick's rate, unlikely to be chance, and over target.`,
      '<b>By word</b>: a word or short phrase in ' + STA.WORD_TERMS + '+ terms with $' + STA.WORD_SPEND + '+ spend, ' + STA.WORD_CLICKS + '+ clicks and no order; your blocked words and competitor brands at any spend.'])
    + L('Bids and scaling', [
      `One bid line per keyword or target, from the whole target: bid × target ÷ ACoS, at most ±${Math.round(STA.STEP * 100)}% a step, never under $${STA.MIN_BID}. Until Amazon's bids are read, worked from the CPC.`,
      `${STA.COOLDOWN} days after a bid change from Sellora before that bid is judged again.`,
      `<b>Raise</b>: ${STA.SCALE_ORDERS}+ orders, ACoS at or under ${Math.round(STA.SCALE_SHARE * 100)}% of target, ${STA.RAISE_COVER}+ days of FBA stock, and the bid under ${STA.NOT_LIMIT}× the CPC.`,
      `<b>Add as exact</b>: ${STA.EXACT_ORDERS}+ orders under target and no exact keyword for it on that product yet.`,
      `ACoS under ${STA.LOW_ACOS}% with ${STA.LOW_ACOS}+ orders is treated as a likely data error: never scaled, never a lead.`])
    + L('Competing paths', [
      'Only paths to the <b>same product</b> (the parent with the most ad sales in the ad group) compete.',
      `The lead has ${STA.LEAD_ORDERS}+ orders and ACoS under break-even; an own exact keyword first, then the lowest ACoS.`,
      'A path doing as well as the lead is never negated. Overlap cost = spend − sales × the lead\'s ACoS.'])
    + L('Badges', ['<b>Promoted</b>: the term has its own exact keyword for this product elsewhere.', '<b>In review</b>: a change for it is in the review list.',
      '<b>Negated</b>: a negative is already in place.', '<b>Other products\' sales</b>: most of the ad group\'s ad sales were other products bought after the click.'])
    + '</div></div>';
}

/* ================= THE DIALOG: one for every change ================= */
let STD = null;   // { kind, row, fields… } of the open dialog

// The six figures at the top of every dialog, and the line under them.
function staFigs(r) {
  const fig = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
  const win = (STM && STM.settled) ? 'Settled clicks' : 'The last 30 days';
  const r7 = r.r7 ? ` Last 7 days: ${staInt(r.r7.c || 0)} more clicks, ${staMoney(r.r7.sp || 0)}, ${staInt(r.r7.o || 0)} orders.` : '';
  return `<div class="sta-figs">${fig('Clicks', staInt(r.c))}${fig('Spend', staMoney(r.sp))}${fig('Sales', staMoney(r.s))}`
    + `${fig('Orders', staInt(r.o))}${fig('ACoS', r.acos != null ? staPct(r.acos) : '—')}${fig('ROAS', r.sp > 0 ? (r.s / r.sp).toFixed(2) : '—')}</div>`
    + `<div class="sta-figs-7">${win}.${r7}${r.acos == null && r.o === 0 ? ' ACoS shows — because there are no sales.' : ''}</div>`;
}
// One line of the checks box: st = ok / warn / bad.
const staCheck = (st, t) => `<div class="ck-${st}"><i>${st === 'ok' ? '✓' : st === 'warn' ? '!' : '✗'}</i><span>${t}</span></div>`;
// Negatives the brand already took into the review list today.
function staDayCount(b) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  return ST_RL.items.filter(x => x.brand === b && x.kind === 'neg' && x.status !== 'removed' && x.at >= d0.getTime()).length;
}

// Open the dialog for one row (by key) and one kind of change.
function staOpen(kind, key) {
  const M = staModel();
  const r = M.byKey.get(key);
  if (!r) return;
  if (kind === 'raise' || kind === 'reduce') kind = 'bid:' + kind;
  STD = { kind, row: r };
  const by = $('stDlgBody'), sub = $('stDlgSub');
  $('stDlgOk').textContent = 'Add to review list';
  $('stDlgNote').textContent = 'Goes to the review list. Approved items download as an Amazon bulk file; Sellora changes nothing at Amazon itself.';
  const where = `${staEsc(r.cn || '')} · ${staEsc(staBrandName(r.brand))}`;
  if (kind === 'neg') {
    const asin = r.asin;
    $('stDlgTitle').textContent = asin ? 'Add negative ASIN target' : 'Add negative';
    sub.innerHTML = `"${staEsc(asin ? r.term.toUpperCase() : r.term)}" in ${where}<br>It came through ${staEsc(staPathLabel(r.kw, r.mt))}.`;
    const lvl = r.pathLevel || (asin ? 'ag' : 'cp');
    const noPhrase = r.containsProduct;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stNegType">Type</label>${asin
        ? '<select id="stNegType" disabled><option value="na">Negative ASIN target (asin="…")</option></select><small>Stops the ad on this product page. A negative keyword would not.</small>'
        : `<select id="stNegType"><option value="negativeExact">Negative exact</option><option value="negativePhrase"${noPhrase ? ' disabled' : ''}>Negative phrase${noPhrase ? ' (holds a product word)' : ''}</option></select>
          <small id="stNegTypeTip"></small>`}</div>
      <div class="sta-f"><label for="stNegLvl">Where</label><select id="stNegLvl"${asin ? ' disabled' : ''}>
        <option value="cp"${lvl === 'cp' ? ' selected' : ''}>This campaign</option><option value="ag"${lvl === 'ag' ? ' selected' : ''}>This ad group only</option></select>
        <small id="stNegLvlTip"></small></div></div>
      <div id="stDlgChecks" class="sta-checks"></div>`;
  } else if (kind.startsWith('bid:')) {
    const up = kind === 'bid:raise';
    $('stDlgTitle').textContent = (up ? 'Raise' : 'Lower') + ' the bid on ' + staPathLabel(r.kw, r.mt);
    sub.innerHTML = `${where} · ${staEsc(r.agn)}. Worked out from this keyword or target's own figures; the new bid moves every search term it catches.`;
    const cur = r.ent && r.ent.bid > 0 ? r.ent.bid : null;
    STD.cur = cur;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stBidNew">New bid (USD)</label><input id="stBidNew" type="number" min="0.02" step="0.01" value="${r.sugBid ? r.sugBid.toFixed(2) : ''}"></div>
      <div class="sta-f"><label for="stBidCur">Current bid</label><input id="stBidCur" type="number" min="0.02" step="0.01" value="${cur != null ? cur.toFixed(2) : ''}"${cur != null ? ' disabled' : ' placeholder="From the Ads console"'}>
        ${cur == null ? `<small>Not read from Amazon yet. The suggestion is worked from the CPC (${staMoney(r.cpc)}); type the bid from the console to work it from that.</small>` : ''}</div></div>
      <div id="stBidCalc" class="sta-calc"></div><div id="stDlgChecks" class="sta-checks"></div>`;
  } else if (kind === 'pause') {
    const isTgt = r.type === 'target';
    $('stDlgTitle').textContent = isTgt ? 'Pause ' + staPathLabel(r.kw, r.mt) : 'Pause the duplicate keyword';
    sub.innerHTML = isTgt ? `${where} · ${staEsc(r.agn)}. Pausing stops every search term of this target; it can be turned back on.`
      : `"${staEsc(r.term)}" is an exact keyword here and in ${staEsc(r.group ? r.group.lead.cn : 'another campaign')} for the same product, which sells it better.`;
    by.innerHTML = staFigs(r) + '<div id="stDlgChecks" class="sta-checks"></div>';
  } else if (kind === 'exact' || kind === 'asinT') {
    const asin = kind === 'asinT';
    $('stDlgTitle').textContent = asin ? 'Target this ASIN' : 'Add as exact keyword';
    sub.innerHTML = `"${staEsc(asin ? r.term.toUpperCase() : r.term)}" sold through ${staEsc(staPathLabel(r.kw, r.mt))} in ${where}.`;
    const cands = staDestinations(r, asin);
    STD.cands = cands;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stExDest">Into ad group</label><select id="stExDest">${cands.length
        ? cands.map((c, i) => `<option value="${i}">${staEsc(c.cn)} · ${staEsc(c.agn)}</option>`).join('') : '<option value="">No ad group fits</option>'}</select>
        <small>${asin ? 'Manual product-targeting ad groups' : 'Manual keyword ad groups'} advertising the same product, the most exact-heavy first.</small></div>
      <div class="sta-f"><label for="stExBid">Starting bid (USD)</label><input id="stExBid" type="number" min="0.02" step="0.01" value="${(r.sugBid || STA.MIN_BID).toFixed(2)}">
        <small>CPC ${staMoney(r.cpc)} +${Math.round(STA.STEP * 100)}%, kept under the ceiling ${staMoney(r.ceil)}.</small></div></div>
      <div id="stDlgChecks" class="sta-checks"></div>`;
  } else if (kind === 'word') {
    $('stDlgTitle').textContent = `Add negative phrase "${r.term}"`;
    sub.innerHTML = `${staEsc(staBrandName(r.brand))} · in ${staInt(r.n)} search terms. A negative phrase stops every search holding these words in this order, in the campaigns ticked.`;
    by.innerHTML = `<div class="sta-figs">${['Terms', 'Clicks', 'Spend', 'Orders', 'Sales', 'Campaigns'].map((l, i) => `<div><small>${l}</small><b>${[staInt(r.n), staInt(r.c), staMoney(r.sp), staInt(r.o), staMoney(r.s), staInt(r.cps.length)][i]}</b></div>`).join('')}</div>
      <div class="sta-figs-7">For example: ${staEsc(r.terms.slice(0, 5).join(' · '))}</div>
      <div class="sta-f" style="margin-top:12px"><label>Campaigns</label><div class="sta-cplist">${r.cps.map((c, i) => `<label><input type="checkbox" class="sta-cb" data-cp="${i}" checked> ${staEsc(c.cn)} <span class="sta-dash">${staMoney(c.sp)}${c.o ? ` · ${staInt(c.o)} orders, ${staMoney(c.s)}` : ''}</span></label>`).join('')}</div></div>
      <div id="stDlgChecks" class="sta-checks"></div>`;
  }
  staDlgCheck();
  $('stDlg').classList.remove('hide');
  const first = by.querySelector('select:not([disabled]),input:not([disabled])');
  if (first) first.focus();
}

// The ad groups a new exact keyword (or ASIN target) for this row can go into: same brand, manual keyword (or product)
// ad groups advertising the same product; the most exact-heavy and same-campaign first.
function staDestinations(r, asin) {
  const D = (STM.dest || {})[r.brand];
  if (!D) return [];
  const pool = asin ? D.ptAg : D.kwAg;
  const tg = staTgtsOf(r.brand).rows || [];
  const exactN = new Map(), allN = new Map(), cidOf = new Map();
  tg.forEach(x => {
    allN.set(x.ag, (allN.get(x.ag) || 0) + 1);
    if (/^EXACT$/i.test(x.mt)) exactN.set(x.ag, (exactN.get(x.ag) || 0) + 1);
    cidOf.set(x.ag, x.cid);
  });
  const infoOf = (STM.agInfo || {})[r.brand] || new Map();
  const out = [];
  pool.forEach(ag => {
    const cid = cidOf.get(ag) || '';
    const ai = infoOf.get(ag);
    if (ai && ai.pk !== r.ai.pk && !ai.asins.some(a => r.asins.includes(a))) return;
    if (!ai && r.asins.length && !stProductsOf(r.brand, ag).asins.some(a => r.asins.includes(a))) return;
    const share = (exactN.get(ag) || 0) / Math.max(1, allN.get(ag) || 1);
    const cn = staName(r.brand, cid), agn = staName(r.brand, ag);
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
  const idNote = () => out.push(staCheck('warn', "Amazon's ID for this keyword or target is not read yet, so the change waits in the review list until it is."));
  if (kind === 'neg') {
    const asin = r.asin;
    const type = asin ? 'na' : $('stNegType').value;
    const lvl = asin ? 'ag' : $('stNegLvl').value;
    STD.type = type;
    STD.lvl = lvl;
    if (!asin) {
      $('stNegTypeTip').textContent = type === 'negativeExact' ? `Blocks only "${r.term}".`
        : `Also blocks longer searches holding "${r.term}", like "${r.term} set".` + (r.containsProduct ? '' : '');
      $('stNegLvlTip').textContent = lvl === 'cp' ? `Every ad group in ${r.cn}.` : `Only ${r.agn || 'this ad group'}.`;
    } else $('stNegLvlTip').textContent = 'ASIN negatives go in at ad-group level: the bulk file takes them there in every kind of campaign.';
    // 1. Protected?
    const mainOk = r.main && !r.noNeg && r.routing && r.group && r.group.lead.own;
    if (r.noNeg) bad(`A ${staEsc(r.noNeg)}: never negated.`);
    else if (r.main && !mainOk) bad('A main keyword: only negated on a weaker path when its own exact keyword keeps it.');
    else if (mainOk) out.push(staCheck('ok', `Main keyword: it stays on its own exact keyword in ${staEsc(r.group.lead.cn)}`));
    else out.push(staCheck('ok', 'Not a brand term, product word, main keyword, seasonal term or one of your ASINs'));
    // 2. Already there?
    const whereKey = lvl === 'cp' ? 'cp|' + r.cid : 'ag|' + r.ag;
    const nk = asin ? 'na' : type === 'negativePhrase' ? 'np' : 'nx';
    const at = staNegAtAmazon(r.brand, whereKey, r.term, nk);
    const queued = ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.kind === 'neg'
      && x.brand === r.brand && staLow(x.term) === r.tl && (x.neg.level === 'cp' ? x.cid === r.cid : x.ag === r.ag));
    const place = lvl === 'cp' ? 'this campaign' : 'this ad group';
    if (at) bad(`A negative for it is already in ${place} at Amazon.`);
    else if (queued) bad(`A negative for it in ${place} is already in the review list.`);
    else if (at === null) out.push(staCheck('warn', `Not in the review list. Amazon's existing negatives are not read yet: check ${place} in the console before uploading.`));
    else out.push(staCheck('ok', `No negative for it in ${place} yet`));
    // 3. Sales through other paths, and what this negative would block.
    const others = STM.rows.filter(x => x.brand === r.brand && x.tk === r.tk && x.ag !== r.ag && x.o > 0 && !x.bad);
    const sameCp = others.filter(x => x.cid === r.cid);
    if (lvl === 'cp' && sameCp.length) bad(`A campaign-level negative would also block it in ${staEsc(sameCp[0].agn || 'another ad group')}, where it sold ${staInt(sameCp[0].o)}: choose "This ad group only".`);
    else if (others.length) out.push(staCheck('ok', `It sells through ${staEsc(others[0].cn)} (${staInt(others.reduce((t, x) => t + x.o, 0))} orders): that path is left alone.`));
    let risk = r.s;
    if (type === 'negativePhrase') {
      const re = ' ' + staNorm(r.term) + ' ';
      risk = STM.rows.filter(x => x.brand === r.brand && (lvl === 'cp' ? x.cid === r.cid : x.ag === r.ag) && (' ' + staNorm(x.term) + ' ').includes(re)).reduce((t, x) => t + x.s, 0);
    }
    out.push(staCheck(risk > 0 ? 'warn' : 'ok', risk > 0 ? `Sales at risk: ${staMoney(risk)} came through what this negative would block.` : 'Sales at risk: none'));
    // 4. Amazon's limits; 5. the day's limit.
    if (!asin) {
      const lim = STA.NEG[type];
      const words = r.term.trim().split(/\s+/).length, chars = r.term.length;
      if (words > lim.words || chars > lim.chars) bad(`Too long for a ${lim.t.toLowerCase()}: ${words} words, ${chars} characters (Amazon allows ${lim.words} words, ${lim.chars} characters).`);
      else out.push(staCheck('ok', `Fits as a ${lim.t.toLowerCase()} (Amazon allows ${lim.words} words, ${lim.chars} characters)`));
    }
    const day = staDayCount(r.brand);
    if (day >= STA.DAY_MAX) bad(`${day} negatives for ${staBrandName(r.brand)} added today already: the limit is ${STA.DAY_MAX} a day.`);
  } else if (kind.startsWith('bid:')) {
    const up = kind === 'bid:raise';
    const curIn = Number($('stBidCur').value);
    const cur = STD.cur || (curIn > 0 ? curIn : null);
    const tgt = r.tgtUse;
    if (!STD.cur && cur && !$('stBidNew').dataset.touched && r.acos > 0 && tgt) {
      $('stBidNew').value = Math.max(STA.MIN_BID, staR2(cur * Math.min(1 + STA.STEP, Math.max(1 - STA.STEP, tgt / r.acos)))).toFixed(2);
    } else if (!STD.cur && cur && !$('stBidNew').dataset.touched && !(r.o > 0)) $('stBidNew').value = Math.max(STA.MIN_BID, staR2(cur * (1 - STA.STEP))).toFixed(2);
    const nbv = Number($('stBidNew').value);
    STD.from = cur;
    STD.to = nbv;
    const base = cur || r.cpc;
    $('stBidCalc').innerHTML = `${cur ? 'The bid' : 'The CPC'} ${staMoney(base)} × ${r.o > 0 && r.acos ? `target ${staPct(tgt)} ÷ ACoS ${staPct(r.acos)}` : `${Math.round((1 - STA.STEP) * 100)}% (no sales)`}, within ±${Math.round(STA.STEP * 100)}% a step.`
      + (tgt != null ? ` Target ${staPct(tgt)} · break-even ${staPct(r.beUse)}${r.brandTerm ? ' (brand term)' : r.ln.known ? '' : r.ln.fallback ? ' (your setting)' : ''}.` : '');
    if (!(nbv >= STA.MIN_BID)) bad(`The new bid must be at least ${staMoney(STA.MIN_BID)}.`);
    if (up) {
      const cv = r.ln.cover;
      if (cv == null) out.push(staCheck('warn', 'FBA stock cover is not known for this product: check it before raising.'));
      else if (cv < STA.RAISE_COVER) bad(`FBA stock: about ${Math.round(cv)} days of cover (a raise needs ${STA.RAISE_COVER} or more).`);
      else out.push(staCheck('ok', `FBA stock: ${Math.round(cv)} days of cover`));
    }
    const last = staLastChange(r.pathKey);
    if (last && Date.now() - last < STA.COOLDOWN * 86400000) bad(`Sellora changed this bid ${staDay(last)}: wait ${STA.COOLDOWN} days so the change can show.`);
    else out.push(staCheck('ok', last ? `Last change from Sellora: ${staDays(last)} days ago` : 'No change to this bid recorded by Sellora'));
    if (cur && nbv > 0) {
      const step = nbv / cur - 1;
      if ((up && step <= 0) || (!up && step >= 0)) bad(`The new bid is not ${up ? 'above' : 'below'} the current ${staMoney(cur)}.`);
      else if (Math.abs(step) > STA.STEP + 0.0001) bad(`${(step * 100).toFixed(1)}% is past the safety limit of ${Math.round(STA.STEP * 100)}% a step.`);
      else out.push(staCheck('ok', `Within the safety limit (${step > 0 ? '+' : ''}${(step * 100).toFixed(1)}%)`));
    } else out.push(staCheck('warn', `Current bid not known: worked from the CPC. Check the console's bid before uploading.`));
    if (!r.ent && !r.kid) idNote();
  } else if (kind === 'pause') {
    if (r.type === 'target' && r.noPause) bad(`A ${staEsc(r.noPause)}: lowered, never paused.`);
    else out.push(staCheck('ok', r.type === 'target' ? `0 orders in ${staInt(r.c)} clicks: ${r.chance != null ? (r.chance * 100).toFixed(1) + '% chance of that' : 'no sales'}`
      : `The lead path for the same product sells it at ${staPct(r.leadAcos)} ACoS`));
    if (!r.ent && !r.kid) idNote();
  } else if (kind === 'exact' || kind === 'asinT') {
    const asin = kind === 'asinT';
    const c = STD.cands[Number($('stExDest').value)];
    STD.dest = c || null;
    STD.bid = Number($('stExBid').value);
    if (!c) bad(asin ? 'No manual product-targeting ad group advertises this product. Create one in the Ads console first.'
      : 'No manual keyword ad group advertises this product. Create one in the Ads console first.');
    else {
      const there = (staTgtsOf(r.brand).rows || []).some(x => x.ag === c.ag && (asin ? staLow(x.t).includes(r.tl) : staKey(x.t) === r.tk && /^EXACT$/i.test(x.mt)));
      const queued = ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.kind === kind
        && x.brand === r.brand && staLow(x.term) === r.tl && x.dest && x.dest.ag === c.ag);
      if (there) bad(`${staEsc(c.agn)} already has ${asin ? 'a target for this ASIN' : 'this exact keyword'}.`);
      else if (queued) bad('Already in the review list for this ad group.');
      else out.push(staCheck('ok', `${staEsc(c.agn)} has no ${asin ? 'target for this ASIN' : 'exact keyword for it'} yet`));
    }
    if (!asin) {
      const words = r.term.trim().split(/\s+/).length, chars = r.term.length;
      if (words > STA.KW.words || chars > STA.KW.chars) bad(`Too long for a keyword: ${words} words, ${chars} characters.`);
    }
    if (!(STD.bid >= STA.MIN_BID)) bad(`The bid must be at least ${staMoney(STA.MIN_BID)}.`);
    else if (r.ceil && STD.bid > r.ceil * 1.0001) out.push(staCheck('warn', `${staMoney(STD.bid)} is above the ceiling ${staMoney(r.ceil)}.`));
    else out.push(staCheck('ok', `Under the ceiling CPC ${staMoney(r.ceil)}`));
    out.push(staCheck('ok', 'Once the new keyword takes the term, Competing paths will suggest the negative on the old path — not before, so no sales are lost while it ramps up.'));
  } else if (kind === 'word') {
    const picks = [...$('stDlgBody').querySelectorAll('input[data-cp]:checked')].map(x => r.cps[Number(x.dataset.cp)]);
    STD.picks = picks;
    if (r.protect) bad(`A ${staEsc(r.protect)}: never negated.`);
    else out.push(staCheck('ok', 'Not a product word, brand term, main keyword or seasonal word'));
    if (!picks.length) bad('Tick at least one campaign.');
    const risk = picks.reduce((t, c) => t + (c.s || 0), 0);
    out.push(staCheck(risk > 0 ? 'warn' : 'ok', risk > 0 ? `Sales at risk: ${staMoney(risk)} in those campaigns came through terms holding it.` : 'Sales at risk: none'));
    if (r.term.split(/\s+/).length > STA.NEG.negativePhrase.words) bad('A negative phrase can hold 4 words at most.');
    const queued = picks.filter(c => ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.kind === 'neg' && x.brand === r.brand && staNorm(x.term) === r.gram && x.cid === c.cid));
    if (queued.length) out.push(staCheck('warn', `${queued.length} of these campaigns already have it in the review list: left out.`));
    const at = picks.filter(c => staNegAtAmazon(r.brand, 'cp|' + c.cid, r.term, 'np'));
    if (at.length) out.push(staCheck('warn', `${at.length} of these campaigns already have it at Amazon: left out.`));
    const day = staDayCount(r.brand);
    if (day + picks.length > STA.DAY_MAX) bad(`That would pass the day's limit of ${STA.DAY_MAX} negatives for ${staBrandName(r.brand)} (${day} today).`);
    $('stDlgOk').textContent = `Add ${picks.length} negative${picks.length === 1 ? '' : 's'} to review list`;
  }
  $('stDlgChecks').innerHTML = out.join('');
  $('stDlgOk').disabled = block;
}

// When Sellora last sent a bid or state change for this path (exported or done), in ms; 0 when never.
function staLastChange(pathKey) {
  let t = 0;
  ST_RL.items.forEach(x => {
    if ((x.kind === 'bid' || x.kind === 'pause') && (x.status === 'exported' || x.status === 'done') && x.pathKey === pathKey) t = Math.max(t, x.exportedAt || 0);
  });
  return t;
}
function staClose() {
  $('stDlg').classList.add('hide');
  STD = null;
}

// "Add to review list": turn the dialog into review items and save them.
async function staDlgOk() {
  if (!STD || $('stDlgOk').disabled) return;
  const { kind, row: r } = STD;
  let items = [];
  if (kind === 'neg') items = [staNegItem(r, STD.type, STD.lvl)];
  else if (kind.startsWith('bid:')) items = [staBidItem(r, kind === 'bid:raise' ? 'up' : 'down', STD.from, STD.to)];
  else if (kind === 'pause') items = [staItem(r, 'pause', { what: 'Pause', why: r.type === 'target' ? `0 orders in ${staInt(r.c)} clicks` : `Duplicate exact keyword · lead path at ${staPct(r.leadAcos)} ACoS` })];
  else if (kind === 'word') items = staWordItems(r, STD.picks);
  else items = [staExactItem(r, kind, STD.dest, STD.bid)];
  $('stDlgOk').disabled = true;
  try {
    for (const it of items) await staRlSave(it);
    staClose();
    STM = null;
    renderSt();
    stFoot(`<span>Added ${items.length === 1 ? staEsc(staKindName(items[0])) + ' · ' + staEsc(items[0].term || items[0].target) : items.length + ' changes'} to the review list.</span>`);
  } catch (e) {
    $('stDlgOk').disabled = false;
    $('stDlgChecks').insertAdjacentHTML('beforeend', staCheck('bad', 'Could not save: ' + staEsc(e.message || e)));
  }
}

/* ================= THE REVIEW LIST =================
 * One item per change, in the shape the later apply route will read:
 *   { v, brand, kind: neg | bid | pause | exact | asinT, key / pathKey / wkey, term, target, kw, mt, kid, cid, ag, cn, agn,
 *     neg: { type, level }, bid: { from, to, dir, base }, dest: { ag, cid, cn, agn }, newBid, what, why, ev,
 *     status: review → approved → exported → done (or removed), by, at, approvedBy, exportedAt }
 * Firestore adsActions/{id}; in this browser (localStorage) while its rule is not deployed. */
let ST_RL = { items: [], where: '', stamp: 0, err: '', tab: 'open', sel: new Set(), preview: false };
const STA_LOCAL = 'staReview';

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
async function staRlSave(it) {
  it.up = Date.now();
  const clean = JSON.parse(JSON.stringify(it));
  delete clean.id;
  if (ST_RL.where === 'fs') {
    try { await setDoc(doc(db, 'adsActions', it.id), clean); } catch (e) { ST_RL.where = 'local'; ST_RL.err = String((e && (e.code || e.message)) || e); }
  }
  const i = ST_RL.items.findIndex(x => x.id === it.id);
  if (i >= 0) ST_RL.items[i] = it; else ST_RL.items.unshift(it);
  if (ST_RL.where === 'local') {
    try { localStorage.setItem(STA_LOCAL, JSON.stringify(ST_RL.items.slice(0, 500))); } catch (e) { throw new Error('this browser would not store it'); }
  }
  ST_RL.stamp++;
}
// Open items by row key, path key and word key; done negatives by 'done:' + key.
function staRlIndex() {
  const m = new Map();
  ST_RL.items.forEach(x => {
    const open = x.status === 'review' || x.status === 'approved' || x.status === 'exported';
    if (open) {
      if (x.key) m.set(x.key, x);
      if ((x.kind === 'bid' || x.kind === 'pause') && x.pathKey) m.set(x.pathKey, x);
      if (x.wkey) m.set(x.wkey + '|' + x.cid, x);
    } else if (x.status === 'done' && x.kind === 'neg' && x.key) m.set('done:' + x.key, x);
  });
  return m;
}
function staRlBadge() {
  const n = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved').length;
  $('stRlN').textContent = n;
  $('stRlN').classList.toggle('hide', !n);
}
// A new review item, with the figures it was based on.
function staItem(r, kind, extra) {
  const who = String(ME.email || '').split('@')[0].split(/[._]/)[0];
  return Object.assign({
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), v: 2, brand: r.brand, kind,
    key: r.type === 'term' ? r.key : '', pathKey: r.pathKey || '', term: r.type === 'term' || r.type === 'word' ? r.term : '',
    target: r.type === 'word' ? '' : staPathLabel(r.kw, r.mt), kw: r.kw || '', mt: r.mt || '', kid: r.kid || '', cid: r.cid || '', ag: r.ag || '',
    cn: r.cn || '', agn: r.agn || '', ev: { c: r.c, sp: staR2(r.sp), o: r.o, s: staR2(r.s), win: STM && STM.settled ? 'settled' : '30d' },
    status: 'review', by: who ? who[0].toUpperCase() + who.slice(1) : '', byEmail: ME.email || '', at: Date.now(),
  }, extra);
}
function staNegItem(r, type, level) {
  const why = r.kind === 'none' ? `0 orders in ${staInt(r.c)} clicks${r.chance != null ? ' · ' + (r.chance * 100).toFixed(1) + '% chance' : ''}`
    : r.kind === 'be' ? `ACoS ${staPct(r.acos)} vs break-even ${staPct(r.beUse)}` : r.kind === 'poor' ? `${staInt(r.o)} orders in ${staInt(r.c)} clicks, under half the normal rate`
      : r.role === 'other' ? `Competing path · ${staMoney(r.excess)} overlap cost; lead at ${staPct(r.leadAcos)}` : `ACoS ${staPct(r.acos)}`;
  return staItem(r, 'neg', { neg: { type, level }, what: (type === 'na' ? 'Negative ASIN target' : STA.NEG[type].t) + ' · ' + (level === 'cp' ? 'campaign level' : 'ad-group level'), why });
}
function staBidItem(g, dir, from, to) {
  return staItem(g, 'bid', {
    bid: { from: from || null, to: staR2(to), dir, base: from ? 'bid' : 'cpc', cpc: g.cpc ? staR2(g.cpc) : null },
    what: from ? `${staMoney(from)} → ${staMoney(to)}` : `New bid ${staMoney(to)} (CPC ${staMoney(g.cpc)})`,
    why: g.kind === 'none' ? `0 orders in ${staInt(g.c)} clicks` : `ACoS ${staPct(g.acos)} vs ${dir === 'up' ? 'target ' + staPct(g.tgtUse) : 'break-even ' + staPct(g.beUse)}`,
  });
}
function staExactItem(r, kind, c, bid) {
  return staItem(r, kind, { dest: { ag: c.ag, cid: c.cid, cn: c.cn, agn: c.agn }, newBid: staR2(bid),
    what: `New ${kind === 'asinT' ? 'ASIN target' : 'exact keyword'} at ${staMoney(bid)} in ${c.agn}`,
    why: `${staInt(r.o)} orders at ACoS ${staPct(r.acos)} through ${staPathLabel(r.kw, r.mt)}` });
}
// One negative phrase per campaign for a word.
function staWordItems(r, picks) {
  return picks.filter(c => !ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.kind === 'neg' && x.brand === r.brand && staNorm(x.term) === r.gram && x.cid === c.cid)
    && !staNegAtAmazon(r.brand, 'cp|' + c.cid, r.term, 'np'))
    .map(c => staItem(Object.assign({}, r, { cid: c.cid, cn: c.cn, agn: '', ag: '', c: c.n, sp: c.sp, o: c.o, s: c.s }), 'neg', {
      wkey: r.key, neg: { type: 'negativePhrase', level: 'cp' }, what: 'Negative phrase · campaign level',
      why: r.tag === 'blocked' ? 'Blocked word' : r.tag === 'competitor' ? 'Competitor brand' : `In ${staInt(r.n)} terms, ${staInt(r.c)} clicks, no order`,
    }));
}
function staKindName(x) {
  if (x.kind === 'neg') return x.neg.type === 'na' ? 'Add negative ASIN target' : 'Add ' + STA.NEG[x.neg.type].t.toLowerCase();
  if (x.kind === 'bid') return x.bid.dir === 'up' ? 'Raise bid' : 'Lower bid';
  if (x.kind === 'pause') return 'Pause';
  if (x.kind === 'exact') return 'Add as exact';
  return 'Target this ASIN';
}
// The default change for a ticked row (the selection bar): items, or { skip } with why.
function staQuick(r) {
  const M = staModel();
  if (r.type === 'word') {
    if (!r.act) return { skip: 'no change' };
    const it = staWordItems(r, r.cps);
    return it.length ? { items: it } : { skip: 'already there' };
  }
  const n = r.next;
  if (n === 'neg') {
    const mainOk = r.main && !r.noNeg && r.routing && r.group && r.group.lead.own;
    if (r.noNeg || (r.main && !mainOk)) return { skip: r.noNeg || 'main keyword' };
    const sameCp = M.rows.some(x => x.brand === r.brand && x.tk === r.tk && x.ag !== r.ag && x.cid === r.cid && x.o > 0);
    const level = r.asin || sameCp || r.pathLevel === 'ag' ? 'ag' : 'cp';
    const type = r.asin ? 'na' : 'negativeExact';
    if (!r.asin && (r.term.trim().split(/\s+/).length > 10 || r.term.length > 80)) return { skip: 'too long' };
    if (staNegAtAmazon(r.brand, level === 'cp' ? 'cp|' + r.cid : 'ag|' + r.ag, r.term, r.asin ? 'na' : 'nx')) return { skip: 'already negated' };
    if (staDayCount(r.brand) >= STA.DAY_MAX) return { skip: 'day\'s limit reached' };
    return { items: [staNegItem(r, type, level)] };
  }
  const g = r.type === 'target' ? r : r.tr;
  if ((n === 'reduce' || n === 'raise') && g && g.sugBid) {
    if (ST_RL.items.some(x => x.pathKey === g.pathKey && (x.status === 'review' || x.status === 'approved' || x.status === 'exported'))) return { skip: 'already in the review list' };
    return { items: [staBidItem(g, n === 'raise' ? 'up' : 'down', g.ent && g.ent.bid > 0 ? g.ent.bid : null, g.sugBid)] };
  }
  if (n === 'pause') return r.noPause ? { skip: r.noPause } : { items: [staItem(r, 'pause', { what: 'Pause', why: r.type === 'target' ? `0 orders in ${staInt(r.c)} clicks` : 'Duplicate exact keyword' })] };
  if (n === 'exact' || n === 'asinT') {
    const c = staDestinations(r, n === 'asinT')[0];
    return c ? { items: [staExactItem(r, n, c, r.sugBid)] } : { skip: 'no ad group to add it to' };
  }
  return { skip: 'no change' };
}

/* DONE, SEEN AT AMAZON: an item that went out in a bulk file is done once Amazon's record (adEntities) shows it. */
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
      jobs.push(staRlSave(x).catch(() => { /* written next time */ }));
    }
  });
  await Promise.all(jobs);
}

function staRlOpen() {
  ST_RL.sel = new Set();
  ST_RL.preview = false;
  $('stRl').classList.remove('hide');
  staRlDraw();
}
// Draw the review list (open / done / removed), or the bulk-file preview.
function staRlDraw() {
  if (ST_RL.preview) return staPreview();
  const tab = ST_RL.tab;
  $('stRlTitle').textContent = 'Review list';
  $('stRlSeg').classList.remove('hide');
  $('stRlBack').classList.add('hide');
  $('stRlRemove').classList.remove('hide');
  $('stRlApprove').classList.remove('hide');
  $('stRlSeg').querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x.dataset.r === tab));
  const list = ST_RL.items.filter(x => tab === 'open' ? (x.status === 'review' || x.status === 'approved')
    : tab === 'done' ? (x.status === 'exported' || x.status === 'done') : x.status === 'removed');
  const open = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved');
  const appr = open.filter(x => x.status === 'approved').length;
  $('stRlSub').textContent = `${open.length} change${open.length === 1 ? '' : 's'} waiting${appr ? `, ${appr} approved` : ''}. Each keeps the figures it was based on.`;
  const chip = x => x.status === 'review' ? staBadge('Waiting') : x.status === 'approved' ? staBadge('Approved', 'ok')
    : x.status === 'exported' ? staBadge('In bulk file · ' + staDay(x.exportedAt), 'info') : x.status === 'done' ? staBadge('Done · seen at Amazon', 'ok') : staBadge('Removed', 'warn');
  const when = x => `${staEsc(x.by || '')}<br>${new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const body = list.map(x => {
    const blocked = staBulkRow(x).skip;
    return `<tr>
      <td>${tab === 'open' ? `<input type="checkbox" class="sta-cb" data-rl="${staEsc(x.id)}"${ST_RL.sel.has(x.id) ? ' checked' : ''} aria-label="Select">` : ''}</td>
      <td><b>${staEsc(staKindName(x))}</b><small class="sta-s">${staEsc(staBrandName(x.brand))}</small></td>
      <td class="sta-term">${staEsc(x.neg && x.neg.type === 'na' ? String(x.term).toUpperCase() : x.term || x.target)}${x.term && x.kind !== 'neg' ? `<small class="sta-s">${staEsc(x.target)}</small>` : ''}</td>
      <td class="sta-rlcp" title="${staEsc(x.cn + ' · ' + x.agn)}">${staEsc(x.cn)}<small class="sta-s">${staEsc(x.agn)}</small></td>
      <td class="sta-rlwhat">${staEsc(x.what || '')}${blocked && tab === 'open' ? `<small class="sta-s" style="color:var(--rev-ink);white-space:normal">${staEsc(blocked)}</small>` : ''}</td>
      <td class="sta-ev">${staEsc(x.why || '')}<br><span class="sta-dash">${staInt(x.ev.c)} clicks · ${staMoney(x.ev.sp)} · ${staInt(x.ev.o)} orders</span></td>
      <td style="color:var(--muted)">${when(x)}${x.approvedBy ? `<small class="sta-s">approved by ${staEsc(String(x.approvedBy).split('@')[0])}</small>` : ''}</td>
      <td>${chip(x)}</td></tr>`;
  }).join('');
  $('stRlTable').innerHTML = `<thead><tr><th style="width:28px">${tab === 'open' ? '<input type="checkbox" class="sta-cb" data-rlall="1" aria-label="Select all">' : ''}</th><th>Change</th><th>Search term / target</th>
    <th>Campaign</th><th>What changes</th><th>Why</th><th>Added</th><th>Status</th></tr></thead><tbody>`
    + (body || `<tr><td colspan="8" class="muted" style="padding:14px 22px">${tab === 'open' ? 'Nothing waiting. Pick a change from any view.' : 'Nothing here yet.'}</td></tr>`) + '</tbody>';
  const note = $('stRlNote');
  note.classList.toggle('warn', ST_RL.where === 'local');
  note.innerHTML = (ST_RL.where === 'local'
    ? '<b>Kept in this browser only.</b> The shared review list needs its database rule (Ravi: adsActions in firestore.rules). Until then nobody else sees these, and clearing the browser loses them. '
    : '') + 'Sellora changes nothing at Amazon. Approved changes download as an Amazon bulk file, one per brand, to upload in the Ads console (Campaign manager → Bulk operations). You see every row before it downloads.';
  staRlSelTxt();
}
function staRlSelTxt() {
  const sel = [...ST_RL.sel].map(id => ST_RL.items.find(x => x.id === id)).filter(Boolean);
  const ready = ST_RL.items.filter(x => x.status === 'approved' && !staBulkRow(x).skip).length;
  $('stRlSel').textContent = ST_RL.tab !== 'open' ? '' : sel.length ? `${sel.length} selected` : 'Tick changes to approve or remove them.';
  $('stRlApprove').textContent = sel.length ? `Approve ${sel.filter(x => x.status === 'review').length}` : 'Approve';
  $('stRlApprove').disabled = ST_RL.tab !== 'open' || !sel.some(x => x.status === 'review');
  $('stRlRemove').disabled = ST_RL.tab !== 'open' || !sel.length;
  $('stRlDl').textContent = `Preview bulk file · ${ready} approved`;
  $('stRlDl').disabled = !ready;
}
async function staRlSet(status) {
  for (const id of [...ST_RL.sel]) {
    const x = ST_RL.items.find(y => y.id === id);
    if (!x || (status === 'approved' && x.status !== 'review')) continue;
    x.status = status;
    if (status === 'approved') { x.approvedBy = String(ME.email || ''); x.approvedAt = Date.now(); }
    try { await staRlSave(x); } catch (e) { /* the next save writes it */ }
  }
  ST_RL.sel = new Set();
  STM = null;
  staRlDraw();
  renderSt();
}

/* ================= THE BULK FILE ================= */
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
  const hit = staEntOf(x.brand, x.ag, x.kw, x.mt) || (x.kid ? { id: x.kid, kind: staKwMt(x.mt) ? 'kw' : 'tg' } : null);
  if (!hit) return { skip: ST.ent ? "Not found in Amazon's record of keywords and targets (it may have been archived)." : "Amazon's keyword and target IDs are not read yet (backend step 1)." };
  const kwRow = hit.kind === 'kw';
  return { row: Object.assign(base, { 'Entity': kwRow ? 'Keyword' : 'Product Targeting', 'Operation': 'Update', 'Ad Group ID': x.ag,
    [kwRow ? 'Keyword ID' : 'Product Targeting ID']: hit.id }, x.kind === 'pause' ? { 'State': 'paused' } : { 'Bid': x.bid.to }) };
}

// An .xlsx of one sheet (rows[0] the heading) — Listing Content's zip and XML helpers, IDs as text.
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

// The bulk-file preview: every row that will download, per brand, and what waits and why.
function staPreview() {
  const appr = ST_RL.items.filter(x => x.status === 'approved').map(x => ({ x, b: staBulkRow(x) }));
  const ready = appr.filter(y => !y.b.skip), wait = appr.filter(y => y.b.skip);
  $('stRlTitle').textContent = 'Bulk file preview';
  $('stRlSeg').classList.add('hide');
  $('stRlBack').classList.remove('hide');
  $('stRlRemove').classList.add('hide');
  $('stRlApprove').classList.add('hide');
  const brands = [...new Set(ready.map(y => y.x.brand))];
  $('stRlSub').textContent = `${ready.length} row${ready.length === 1 ? '' : 's'} in ${brands.length} file${brands.length === 1 ? '' : 's'} (${brands.map(staBrandName).join(', ')}), sheet "Sponsored Products Campaigns".`;
  const td = v => `<td>${staEsc(v == null ? '' : v)}</td>`;
  $('stRlTable').innerHTML = '<thead><tr><th></th><th>File</th><th>Entity</th><th>Operation</th><th>Campaign</th><th>Ad group</th><th>Keyword / target</th><th>Match type</th><th class="num">Bid</th><th>State</th></tr></thead><tbody>'
    + ready.map(({ x, b: { row } }) => `<tr><td></td>${td(staBrandName(x.brand))}${td(row['Entity'])}${td(row['Operation'])}${td((x.dest && x.dest.cn) || x.cn)}${td(row['Ad Group ID'] ? ((x.dest && x.dest.agn) || x.agn || row['Ad Group ID']) : '— (whole campaign)')}`
      + `${td(row['Keyword Text'] || row['Product Targeting Expression'] || row['Keyword ID'] || row['Product Targeting ID'])}${td(row['Match Type'])}<td class="num">${row['Bid'] != null ? staMoney(row['Bid']) : ''}</td>${td(row['State'])}</tr>`).join('')
    + wait.map(({ x, b }) => `<tr class="sta-wait"><td></td>${td(staBrandName(x.brand))}<td colspan="5">${staEsc(staKindName(x) + ' · ' + (x.term || x.target))}</td><td colspan="3">Waits: ${staEsc(b.skip)}</td></tr>`).join('')
    + '</tbody>';
  const note = $('stRlNote');
  note.classList.toggle('warn', ST_RL.where === 'local');
  note.innerHTML = (ST_RL.where === 'local' ? '<b>This list is kept in this browser only</b> — nobody else has approved or seen it. ' : '')
    + 'Upload each file in its own brand\'s Ads console (Campaign manager → Bulk operations → Upload). Start with a small file and check its upload report; if Amazon rejects the headers, tell the team before uploading more.';
  $('stRlSel').textContent = wait.length ? `${wait.length} approved change${wait.length === 1 ? '' : 's'} wait and stay approved.` : '';
  $('stRlDl').textContent = `Download ${brands.length > 1 ? brands.length + ' files' : 'file'} · ${ready.length} row${ready.length === 1 ? '' : 's'}`;
  $('stRlDl').disabled = !ready.length;
}

// Download every approved item that can go into a file, one file per brand, and mark them "in bulk file".
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
    a.download = `sellora-bulk-${staBrandName(b).replace(/\s+/g, '-')}-${day}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (brands.length > 1) await new Promise(res => setTimeout(res, 700));
  }
  for (const y of ready) {
    y.x.status = 'exported';
    y.x.exportedAt = Date.now();
    y.x.exportedBy = String(ME.email || '');
    try { await staRlSave(y.x); } catch (e) { /* the next save writes it */ }
  }
  ST_RL.preview = false;
  ST_RL.tab = 'done';
  STM = null;
  staRlDraw();
  renderSt();
}

/* ================= LISTS & SETTINGS ================= */
let STS_B = 'SP';
function staSetOpen() {
  STS_B = $('stBrand').value === 'CPC' ? 'CPC' : 'SP';
  $('stSet').classList.remove('hide');
  staSetDraw();
}
function staSetDraw() {
  const b = STS_B, S = staSet(b);
  $('stSetSeg').querySelectorAll('[data-b]').forEach(x => x.classList.toggle('on', x.dataset.b === b));
  const auto = new Set();
  const infoOf = STM && STM.agInfo && STM.agInfo[b];
  if (infoOf) infoOf.forEach(a => a.types.forEach(k => auto.add(STA_TYPES.find(t => staKey(t) === k) || k)));
  const ta = (id, label, list, tip) => `<div class="sta-f"><label for="${id}">${label}</label><textarea id="${id}" rows="4" placeholder="One per line">${staEsc((list || []).join('\n'))}</textarea><small>${tip}</small></div>`;
  $('stSetBody').innerHTML = `<div class="sta-row2">
    ${ta('stSetBrand', 'Brand terms', S.brandTerms, 'Never negated; judged against ' + STA.BRAND_TGT + '% ACoS. Keywords in campaigns named "brand" count too.')}
    ${ta('stSetProd', 'Product words (added to the ones found)', S.productWords, 'What you sell. Never negated in the campaigns of a product they name.')}
    ${ta('stSetBlock', 'Blocked words', S.blocked, 'Words you never want to pay for ("cheap"). Listed in Burning money → By word at any spend, for a negative phrase.')}
    ${ta('stSetComp', 'Competitor brands', S.competitors, 'Listed in By word the same way, unless the terms holding them sell.')}
  </div>
  <div class="sta-f" style="margin-top:12px"><label>Product words found in titles and campaign names</label><div class="sta-chips">${[...auto].sort().map(t => staBadge(t, 'info')).join('') || '<span class="sta-dash">None yet — they appear once the product titles have loaded.</span>'}</div></div>
  <div class="sta-row2" style="margin-top:12px"><div class="sta-f"><label for="stSetTgt">Target ACoS when a product has no unit cost (%)</label>
    <input id="stSetTgt" type="number" min="1" max="100" step="1" value="${S.fallbackTgt || ''}" placeholder="Blank: no profit verdicts">
    <small>Blank keeps profit verdicts off for products without a unit cost. Break-even is this plus overhead and salary (${(PF_MODEL.oh || 0) + (PF_MODEL.sal || 0)} points).</small></div></div>`;
  $('stSetNote').textContent = STS.where === 'local' ? 'Kept in this browser until the lists are switched on for everyone (adsSettings in firestore.rules).' : 'Shared with everyone who has this tab.';
}
async function staSetOk() {
  const lines = id => $(id).value.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  const tgt = Number($('stSetTgt').value);
  await staSetSave(STS_B, { brandTerms: lines('stSetBrand'), productWords: lines('stSetProd'), blocked: lines('stSetBlock'),
    competitors: lines('stSetComp'), fallbackTgt: tgt > 0 ? tgt : null });
  STS.stamp = (STS.stamp || 0) + 1;
  STM = null;
  $('stSet').classList.add('hide');
  renderSt();
  stFoot(`<span>Lists for ${staBrandName(STS_B)} saved${STS.where === 'local' ? ' in this browser' : ''}.</span>`);
}

/* ================= EVENTS ================= */
// The view switch ('neg', 'waste' and 'harvest' still open, from older links).
function staSetView(v) {
  if (v === 'neg' || v === 'waste') { ST_SUB = v === 'waste' ? 'target' : 'term'; v = 'burn'; }
  if (v === 'harvest') v = 'scale';
  ST_VIEW = v;
  ST_PG = 0;
  ST_SORT = { k: '', d: -1 };
  if (v === 'cp' && !CP.loaded) { ensureCp().then(renderSt); return; }
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
  ST_PG = 0;
  ST_SORT = { k: '', d: -1 };
  ST_SEL.clear();
  renderSt();
});
$('stBrand').addEventListener('change', () => { ST_SEL.clear(); ST_PG = 0; renderSt(); });
$('stCpShow').addEventListener('change', renderSt);
try {
  const t = localStorage.getItem('stCpTarget');
  if (t) $('stCpTarget').value = t;
  const z = Number(localStorage.getItem('stSize'));
  if ([50, 100, 250].includes(z)) { ST_SIZE = z; $('stSize').value = String(z); }
} catch (e) { /* no storage */ }
$('stCpTarget').addEventListener('input', () => {
  try { localStorage.setItem('stCpTarget', $('stCpTarget').value); } catch (e) { /* no storage */ }
  clearTimeout(ST_FT);
  ST_FT = setTimeout(renderSt, 250);
});
['stFilter', 'stMinSpend'].forEach(id => $(id).addEventListener('input', () => {
  clearTimeout(ST_FT);
  ST_PG = 0;
  ST_FT = setTimeout(renderSt, 250);
}));
['stFMt', 'stFCt', 'stFV', 'stFTag'].forEach(id => $(id).addEventListener('change', () => { ST_PG = 0; renderSt(); }));
$('stFClear').addEventListener('click', () => { ['stFMt', 'stFCt', 'stFV', 'stFTag'].forEach(id => { $(id).value = ''; }); ST_PG = 0; renderSt(); });
$('stMoreBtn').addEventListener('click', () => {
  const on = $('stMore').classList.toggle('hide');
  $('stMoreBtn').setAttribute('aria-expanded', on ? 'false' : 'true');
});
$('stSize').addEventListener('change', () => {
  ST_SIZE = Number($('stSize').value) || 100;
  ST_PG = 0;
  try { localStorage.setItem('stSize', String(ST_SIZE)); } catch (e) { /* no storage */ }
  renderSt();
});
// The table: next-step buttons, ticks, sortable headings, the group carets.
$('stTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (b) { staOpen(b.dataset.act, b.dataset.k); return; }
  const op = e.target.closest('[data-open]');
  if (op) {
    const k = op.dataset.open;
    if (ST_OPEN.has(k)) ST_OPEN.delete(k); else ST_OPEN.add(k);
    renderSt();
    return;
  }
  const th = e.target.closest('th[data-sort]');
  if (th && !e.target.closest('input')) {
    const k = th.dataset.sort;
    ST_SORT = ST_SORT.k === k ? { k, d: -ST_SORT.d } : { k, d: k === 'term' ? 1 : -1 };
    ST_PG = 0;
    renderSt();
    return;
  }
  const cb = e.target.closest('input[data-sel],input[data-selall]');
  if (!cb) return;
  const M = staModel();
  const pick = k => {
    const r = M.byKey.get(k);
    if (!r) return;
    if (cb.checked) ST_SEL.set(r.key, r); else ST_SEL.delete(r.key);
  };
  if (cb.dataset.selall) $('stTable').querySelectorAll('input[data-sel]').forEach(x => pick(x.dataset.sel));
  else pick(cb.dataset.sel);
  renderSt();
});
$('stFoot').addEventListener('click', e => {
  const b = e.target.closest('[data-pg]');
  if (!b) return;
  ST_PG += b.dataset.pg === 'next' ? 1 : -1;
  if (ST_PG < 0) ST_PG = 0;
  renderSt();
  $('stTable').closest('.sta-wrap').scrollTop = 0;
});
// The selection bar: each ticked row's default change, after the same checks the dialog runs.
$('stSelAdd').addEventListener('click', async () => {
  let added = 0;
  const skipped = [];
  for (const r of [...ST_SEL.values()]) {
    const q = staQuick(r);
    if (q.skip) { skipped.push(`"${r.term}" (${q.skip})`); continue; }
    try {
      for (const it of q.items) { await staRlSave(it); added++; }
    } catch (e) { skipped.push(`"${r.term}" (${e.message || e})`); }
  }
  ST_SEL.clear();
  STM = null;
  renderSt();
  stFoot(`<span>Added ${added} change${added === 1 ? '' : 's'} to the review list${skipped.length ? ` · left out ${skipped.length}: ${staEsc(skipped.slice(0, 4).join(', '))}${skipped.length > 4 ? '…' : ''}` : ''}.</span>`);
});
$('stSelClear').addEventListener('click', () => { ST_SEL.clear(); renderSt(); });
// The dialog.
$('stDlgBody').addEventListener('input', e => {
  if (e.target.id === 'stBidNew') e.target.dataset.touched = '1';
  staDlgCheck();
});
$('stDlgBody').addEventListener('change', staDlgCheck);
$('stDlgOk').addEventListener('click', staDlgOk);
$('stDlgCancel').addEventListener('click', staClose);
$('stDlgX').addEventListener('click', staClose);
$('stDlg').addEventListener('click', e => { if (e.target === $('stDlg')) staClose(); });
// The review list.
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
$('stRlDl').addEventListener('click', () => {
  if (!ST_RL.preview) { ST_RL.preview = true; staRlDraw(); } else staDownload();
});
$('stRlBack').addEventListener('click', () => { ST_RL.preview = false; staRlDraw(); });
// Lists & settings; the legend.
$('stSetBtn').addEventListener('click', staSetOpen);
$('stSetX').addEventListener('click', () => $('stSet').classList.add('hide'));
$('stSetCancel').addEventListener('click', () => $('stSet').classList.add('hide'));
$('stSetOk').addEventListener('click', staSetOk);
$('stSetSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-b]');
  if (!b) return;
  STS_B = b.dataset.b;
  staSetDraw();
});
$('stLegendBtn').addEventListener('click', () => { staLegend(); $('stLegend').classList.remove('hide'); });
$('stLegendX').addEventListener('click', () => $('stLegend').classList.add('hide'));
$('stLegend').addEventListener('click', e => { if (e.target === $('stLegend')) $('stLegend').classList.add('hide'); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('stDlg').classList.contains('hide')) staClose();
  else ['stRl', 'stSet', 'stLegend'].forEach(id => $(id).classList.add('hide'));
});

// Export: every row of the current view (not just this page) as a CSV; the cp view has its own (cpCsv).
$('stCsv').onclick = () => {
  if (ST_VIEW === 'cp') { cpCsv(); return; }
  if (!ST_LAST.length) { stFoot('Nothing to export.', true); return; }
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const pct = v => v == null ? '' : Math.round(v * 10) / 10;
  const NEXT = { neg: 'Add negative', reduce: 'Lower bid', raise: 'Raise bid', exact: 'Add as exact', asinT: 'Target this ASIN',
    pause: 'Pause', limit: 'Bid is not the limit', lowstock: 'Low stock: no raise', word: 'Negative phrase' };
  const cols = ['Brand', 'View', 'Search term / target / word', 'Target', 'Match type', 'Campaign', 'Ad group', 'ASINs', 'Impressions',
    'Clicks', 'Spend', 'Orders', 'Sales', 'ACoS %', 'Target ACoS %', 'Break-even ACoS %', 'Verdict', 'Tags', 'Money at stake',
    'Next step', 'Suggested bid', 'Hold reason', 'Status', 'Evidence'];
  const lines = [cols.map(cell).join(',')];
  const rows = ST_VIEW === 'paths' ? ST_LAST.flatMap(g => g.shown) : ST_LAST;
  rows.forEach(r => lines.push([staBrandName(r.brand), ST_VIEW + (ST_VIEW === 'burn' ? ' by ' + ST_SUB : ''), r.term, r.type === 'word' ? '' : r.kw || '', r.mt || '',
    r.type === 'word' ? r.cps.map(c => c.cn).join(' | ') : r.cn, r.agn || '', (r.asins || []).join(' '), r.i || '', r.c, staR2(r.sp), r.o, staR2(r.s), pct(r.acos),
    pct(r.tgtUse), pct(r.beUse), (r.badges || []).map(x => x[0]).join('; ') || (r.kind === 'none' ? 'No sales' : r.kind === 'be' ? 'Above break-even' : r.kind === 'poor' ? 'Converts poorly' : ''),
    (r.tags || []).map(t => t[1]).join('; '), r.stake || r.burned ? staR2(r.stake || r.burned) : '', NEXT[r.next] || '',
    (r.type === 'target' ? r.sugBid : r.tr && /reduce|raise/.test(r.next || '') ? r.tr.sugBid : r.sugBid) || '', strip(r.hold), r.status || '', strip(r.ev)].map(cell).join(',')));
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
let CP = { loaded: false, basics: null, stock: {}, stockAt: {}, base: null, costErr: '' };
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
      } catch (e) { CP.costErr = String((e && (e.code || e.message)) || e); /* break-even unknown, and the page says why */ }
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
