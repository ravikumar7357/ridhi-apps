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
  ent: null, set: null, rec: null, tset: null, trec: null, costs: true, costErr: '', src: {} };
// The view, Burning money's sub-view (term / target / word), the rows of the last draw (for the export), the page and its
// size, the sort ({ k: column, d: 1 / -1 }), the ticked rows by key, the open groups of All terms.
let ST_VIEW = 'all', ST_SUB = 'term', ST_LAST = [], ST_PG = 0, ST_SIZE = 100, ST_SORT = { k: '', d: -1 };
// The next-step chip picked under the tabs ('' = every row): neg / reduce / pause / exact / raise / hold / review.
let ST_ACT = '';
const ST_SEL = new Map();
const ST_OPEN = new Set();
let ST_FT = null;

/* THE LINES EVERY VERDICT IS DRAWN WITH. One place, so the dialog, the tables and the legend cannot disagree. */
const STA = {
  MIN_CLICKS: 10,      // clicks before "no order" is evidence at all
  CHANCE: 0.05,        // under this chance of the result by bad luck: "unlikely to be chance" — enough for a lower bid
  NEG_CHANCE: 0.01,    // a negative or a pause (hard to undo) needs under 1%: with ~19,000 terms tested, 5% alone would
                       // flag about 1 in 20 normal terms by bad luck (19 Nov audit); between 1% and 5% → a lower bid
  NOSALE_MIN_SP: 10,   // "no sales" needs at least this much spend ($) before anything is suggested
  LOSS_ACOS: 100,      // over this ACoS the ad costs more than the sale whatever the unit cost: acted on without costs
  LOSS_MIN_SP: 20,     // … once at least this much was spent
  BE_ORDERS: 3,        // "above break-even" needs this many orders; fewer → Watch (one order is not a pattern)
  RATE_ORDERS: 3,      // orders a target or campaign needs before its own conversion rate is the yardstick
  POOR_CLICKS: 30,     // "converts poorly": at least this many clicks …
  POOR_SHARE: 0.5,     // … and under half the yardstick's conversion rate
  SCALE_ORDERS: 5,     // orders before a raise
  SCALE_SHARE: 0.75,   // a raise needs ACoS at or under 75% of the target
  EXACT_ORDERS: 3,     // orders before "add as exact"
  LEAD_ORDERS: 3,      // a competing path's lead needs this many orders, and ACoS under break-even
  PROV_GAP: 1.5,       // no unit cost: a provisional lead; a path is routed to it only at this many times its ACoS or worse
  MAIN_ORDERS: 10,     // a term with this many orders across the brand is a main keyword
  STEP: 0.20,          // a bid moves at most 20% a step
  MIN_BID: 0.02,       // Amazon's lowest Sponsored Products bid (USD)
  NOT_LIMIT: 3,        // a bid this many times the CPC is not what holds a term back
  COOLDOWN: 14,        // days after a bid change from Sellora before that bid is judged again
  RAISE_COVER: 30,     // days of FBA stock a raise needs
  AGE_DAYS: 30,        // days of ads before anything is judged: judged from the start date + 30 (Day 31)
  LAUNCH_DAYS: 60,     // launch and ranking campaigns (by name) are left alone this long from their start, then judged
  LOW_ACOS: 3,         // ACoS under this with 3+ orders: flagged "very low ACoS" to look at — judged like any other
  STALE_H: 36,         // hours before a brand's search terms count as old
  BRAND_TGT: 50,       // brand terms are judged against this ACoS (the brand-term limit), never negated — costs or not
  HALO: 0.3,           // an ad group whose own product brings under 30% of its ad sales is flagged
  DAY_MAX: 60,         // negatives a brand can take into the review list per day
  WORD_TERMS: 5, WORD_SPEND: 20, WORD_CLICKS: 20,   // a word is listed when it spans this many terms, spend and clicks with no order
  // Amazon's limits on keyword text: a negative exact up to 10 words, a negative phrase up to 4; 80 characters each.
  NEG: { negativeExact: { words: 10, chars: 80, t: 'Negative exact' }, negativePhrase: { words: 4, chars: 80, t: 'Negative phrase' } },
  KW: { words: 10, chars: 80 },
};
// The columns of Amazon's Sponsored Products bulk sheet an upload uses (Amazon's blank template, without the
// "Informational only" and performance columns). If Amazon rejects the headers, this is the one list to change.
// Amazon's bidding strategies as the bulk file writes them.
const STA_STRATEGY_BULK = { LEGACY_FOR_SALES: 'Dynamic bids - down only', AUTO_FOR_SALES: 'Dynamic bids - up and down', MANUAL: 'Fixed bid' };
// "Apply now" — Sellora making the change at Amazon itself. Off: the Ads login is read-only and the write route
// (AdsActions.gs, POST ?ads=act, dry-run first) is not built. Every review item already carries what that route needs
// (IDs, from → to, and for placements the full placementBidding to send). Switch on here, behind the adsApply right.
const ADS_APPLY = { on: false, why: 'Needs Amazon edit permission for Sellora. Until then: Send to review, then the bulk file.' };
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
// Formatters made once (20 Nov, speed): toLocaleString with options builds a new formatter on every call, and a page of
// 20,000 terms formats ~200,000 numbers and dates — that alone was 3 of the 5 seconds spent drawing. Same output.
const STA_NF0 = new Intl.NumberFormat('en-US'), STA_NF2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STA_DF = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }), STA_DFU = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const staMoney = v => '$' + STA_NF2.format(Number(v) || 0);
const staMoney0 = v => '$' + STA_NF0.format(Math.round(Number(v) || 0));
const staPct = v => v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%';
// ROAS from an ACoS in % (ROAS = 100 ÷ ACoS).
const staRoas = acos => acos > 0 && isFinite(acos) ? (100 / acos).toFixed(2) : '—';
const staInt = v => STA_NF0.format(Number(v) || 0);
const staLow = s => String(s || '').toLowerCase().trim();
// Lower case, letters, digits and single spaces.
// Remembered per text (20 Nov, speed): the same ~20,000 terms are normalised by several steps of every model build.
const STA_NORMC = new Map();
const staNorm = s => {
  const k = String(s == null ? '' : s);
  let v = STA_NORMC.get(k);
  if (v === undefined) {
    v = staLow(k).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (STA_NORMC.size > 300000) STA_NORMC.clear();
    STA_NORMC.set(k, v);
  }
  return v;
};
// One word in the singular: covers → cover, boxes → box, ruffles → ruffle; "dress", "glass" stay.
const staSing = w => w.length > 3 && /ss$/.test(w) ? w : w.length > 4 && /ies$/.test(w) ? w.slice(0, -3) + 'y'
  : w.length > 4 && /(ches|shes|xes|sses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w;
// A comparison key: singular, no spaces — "table cloths", "tablecloth" and "Table-Cloth" are one key.
const STA_KEYC = new Map();
const staKey = s => {
  const n = staNorm(s);
  let v = STA_KEYC.get(n);
  if (v === undefined) { v = n.split(' ').map(staSing).join(''); if (STA_KEYC.size > 300000) STA_KEYC.clear(); STA_KEYC.set(n, v); }
  return v;
};
const staIsAsin = t => /^b0[a-z0-9]{8}$/i.test(String(t || '').trim());
const staDash = '<span class="sta-dash">—</span>';
const staBadge = (t, k, tip) => `<span class="ui-badge${k ? ' is-' + k : ''}"${tip ? ` title="${staEsc(tip)}"` : ''}>${staEsc(t)}</span>`;
const staBtn = (t, act, key, cls, tip) => `<button type="button" class="sta-btn${cls ? ' ' + cls : ''}" data-act="${act}" data-k="${staEsc(key)}"${tip ? ` title="${staEsc(tip)}"` : ''}>${staEsc(t)}</button>`;
const staKwMt = mt => /^(BROAD|PHRASE|EXACT)$/i.test(mt || '');
const staAutoMt = mt => /PREDEFINED/i.test(mt || '');
const STA_BRANDS = { SP: 'Ridhi', CPC: 'Cotton Print Club' };
const staBrandName = b => STA_BRANDS[b] || b;
const staR2 = v => Math.round(v * 100) / 100;
const staDay = ms => ms ? STA_DF.format(ms) : '';
const staDays = ms => Math.floor((Date.now() - ms) / 86400000);
// Calendar days in this browser's time zone — the dates staDay prints — so one start date always gives one day number,
// whatever the hour Amazon stamped (18 Nov audit: rows with the same start showed Day 26 and Day 27). staDate0: local
// midnight of a moment; staAddDays: n calendar days on; staDayNo: Day 1 = the start date; staStarted: is the n-day wait
// from that start over today (judged from start + n, i.e. Day n + 1)?
const staDate0 = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const staAddDays = (ms, n) => { const d = new Date(staDate0(ms)); d.setDate(d.getDate() + n); return d.getTime(); };
const staDayNo = ms => Math.round((staDate0(Date.now()) - staDate0(ms)) / 86400000) + 1;
const staStarted = (ms, n) => staDate0(Date.now()) >= staAddDays(ms, n);
// "yyyy-MM-dd HH:mm" as the backend writes it (India time) → ms; 0 when it cannot be read.
const staStamp = s => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? Date.parse(m[1] + 'T' + m[2] + ':00+05:30') || 0 : 0;
};
// "2026-10-08" → "8 Oct".
const staShortDay = iso => {
  const t = Date.parse(String(iso || '').slice(0, 10) + 'T12:00:00Z');
  return t ? STA_DFU.format(t) : String(iso || '');
};
// Clicks still needed before 0 orders would be unlikely to be chance at conversion rate p; 0 when already enough.
const staNeed = (p, c, lv) => p > 0 && p < 1 ? Math.max(0, Math.ceil(Math.log(lv || STA.CHANCE) / Math.log(1 - p)) - c) : 0;
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
// "Added … · Undo": for 30 seconds the footer can take back what was just added (each only while still waiting).
let STA_JUST = { ids: [], t: 0 };
function staAddedFoot(items, text) {
  STA_JUST = { ids: items.map(x => x.id), t: Date.now() };
  stFoot(`<span class="sta-added">${text} <button type="button" class="sta-linkbtn" data-undoadd="1">Undo</button> · <button type="button" class="sta-linkbtn" data-openrl="1">Open the list</button></span>`);
  setTimeout(() => { const b = $('stFoot').querySelector('[data-undoadd]'); if (b && Date.now() - STA_JUST.t >= 29000) b.remove(); }, 30000);
}
async function staUndoAdd() {
  const ids = STA_JUST.ids;
  STA_JUST = { ids: [], t: 0 };
  let n = 0;
  for (const id of ids) {
    const x = ST_RL.items.find(y => y.id === id);
    if (x && !(await staRlMove(x, ['review'], { status: 'removed', removedBy: String(ME.email || ''), removedAt: Date.now(), note: 'Taken back right after adding' }))) n++;
  }
  STM = null;
  renderSt();
  staRlBadge();
  stFoot(`<span>${n ? `Taken back: ${n} change${n === 1 ? '' : 's'}.` : 'Nothing taken back — it was already approved or changed.'}</span>`, !n);
}
$('stFoot').addEventListener('click', e => {
  if (e.target.closest('[data-undoadd]')) staUndoAdd();
  else if (e.target.closest('[data-openrl]')) staRlOpen();
});
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
  SP: { brandTerms: ['ridhi'], productWords: [], blocked: ['cheap', 'free', 'used', 'diy'], competitors: [], fallbackTgt: null, fallbackBe: null },
  CPC: { brandTerms: ['cotton print club', 'cottonprintclub'], productWords: [], blocked: ['cheap', 'free', 'used', 'diy'], competitors: [], fallbackTgt: null, fallbackBe: null },
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
  // A refused save is an error the person sees, not a quiet switch to this browser (19 Nov audit).
  if (STS.where === 'fs') await setDoc(doc(db, 'adsSettings', b), clean);
  STS[b] = Object.assign({}, STA_SET_DEF[b], clean);
  if (STS.where === 'local') {
    let loc = {};
    try { loc = JSON.parse(localStorage.getItem(STA_SET_LOCAL) || '{}'); } catch (x) { loc = {}; }
    loc[b] = clean;
    try { localStorage.setItem(STA_SET_LOCAL, JSON.stringify(loc)); } catch (e) { throw new Error('this browser would not store it'); }
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
  }
  await staLoad();
  renderSt();
}
// Everything Search Term Analysis and Placement read, once (both pages share it): the nightly caches, the Ads backend's,
// unit costs, the review list and the lists. Concurrent callers share one load.
let STA_LOADING = null;
function staLoad() {
  if (ST.loaded && ST.extra) return Promise.resolve();
  if (!STA_LOADING) STA_LOADING = staLoad_().finally(() => { STA_LOADING = null; });
  return STA_LOADING;
}
async function staLoad_() {
  {
    // A cache the backend has not written yet answers "nothing cached" — that is null here, not an error.
    // Each cache's answer is kept for the sources line: read (with its time), not switched on yet, or an error.
    const grab = async name => {
      try {
        const r = await baCall({ cache: name });
        const d = (r && r.data) || null;
        ST.src[name] = d ? { ok: true, at: d.at || '', err: d.err || {} } : { ok: false, off: true };
        return d;
      } catch (e) {
        const m = String(e.message || e);
        ST.src[name] = /nothing cached/i.test(m) ? { ok: false, off: true } : { ok: false, err: m };
        return null;
      }
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
      jobs.push(Promise.all(['adEntities', 'stSettled', 'stRecent', 'tgtSettled', 'tgtRecent', 'plcSettled', 'plcRecent'].map(grab)).then(([e, s, r, ts, tr, ps, pr]) => {
        ST.ent = ok(e);
        ST.set = ok(s);
        ST.rec = ok(r);
        ST.tset = ok(ts);
        ST.trec = ok(tr);
        ST.plc = ok(ps);
        ST.plcr = ok(pr);
        ST.extra = true;
        Object.keys(STA_ENTX).forEach(k => delete STA_ENTX[k]);
      }));
      jobs.push(cpLoadBasics().catch(() => { /* break-even and stock stay unknown */ }));
      jobs.push(staRlLoad());
      jobs.push(staSetLoad());
      jobs.push(staApplyCfg().catch(() => { /* Apply stays off */ }));
    }
    await Promise.all(jobs);
    await staRlSeen();
    ST.costs = Object.keys(COST || {}).length > 0;
    ST.costErr = CP.costErr || '';
    STM = null;
    staTitlesLater();
  }
}
// Newer data behind a screen opened from this browser's copy (baCache): read again and redraw — not while a dialog is open
// (the redraw waits for the next one). The caches this screen reads; Placement's decisions come from the same ones.
const STA_CACHES = ['srchTerm', 'targeting', 'adGroup', 'adEntities', 'stSettled', 'stRecent', 'tgtSettled', 'tgtRecent', 'plcSettled', 'plcRecent'];
let STA_NEWER_T = 0;
window.addEventListener('sellora-cache', e => {
  if (!e.detail || !STA_CACHES.includes(e.detail.name)) return;
  e.detail.handled = true;
  clearTimeout(STA_NEWER_T);
  STA_NEWER_T = setTimeout(async () => {
    ST.loaded = false;
    ST.extra = false;
    try { await staLoad(); } catch (x) { return; }
    STM = null;
    const open = id => $(id) && !$(id).classList.contains('hide');
    if (open('paneSt') && !open('stDlg') && !open('stRl')) renderSt();
    if (open('panePlc') && typeof renderPlx === 'function') renderPlx();
  }, 900);
});
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
  const kw = new Map(), tg = new Map(), neg = new Set(), negPh = [], negId = new Map();
  (E.kw || []).forEach(k => kw.set(k[1] + '|' + staLow(k[3]) + '|' + staLow(k[4]), { id: String(k[0]), ag: k[1], cid: k[2], bid: k[5], st: k[6], made: k[7] || 0, kind: 'kw' }));
  (E.tg || []).forEach(t => tg.set(t[1] + '|' + staLow(t[3]), { id: String(t[0]), ag: t[1], cid: t[2], bid: t[4], st: t[5], made: t[6] || 0, kind: 'tg' }));
  (E.neg || []).forEach(n => {
    const kind = /PHRASE/i.test(n[5]) ? 'np' : /EXACT/i.test(n[5]) ? 'nx' : 'na';
    const where = n[0] === 'cp' ? 'cp|' + n[2] : 'ag|' + n[3];
    neg.add(where + '|' + staLow(n[4]) + '|' + kind);
    if (n[1]) negId.set(where + '|' + staLow(n[4]) + '|' + kind, String(n[1]));
    if (kind === 'np') negPh.push({ where, text: staLow(n[4]) });
  });
  return (STA_ENTX[b] = { kw, tg, neg, negPh, negId, cp: E.cp || {}, ag: E.ag || {}, at: E.at || (ST.ent && ST.ent.at) || '' });
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
function staModel(pickArg) {
  const pick = pickArg || $('stBrand').value;
  const key = pick + '|' + ST_RL.stamp + '|' + (STS.stamp || 0);
  if (STM && STM.key === key) return STM;
  const brands = pick === 'ALL' ? ['SP', 'CPC'] : [pick];
  const M = { key, brands, rows: [], tgRows: [], tgAll: [], words: [], groups: [], overlap: 0, byKey: new Map(), settled: false,
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
  const info = M.info[b] = { stale: !terms.length ? 'No search terms for this brand in the last run' : old ? `Search terms from ${at}: not refreshed since` : '', bad: 0, badSp: 0,
    settled: !!src.settled };
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
    // Products without a unit cost: the brand's own break-even and/or target from Lists & settings (19 Nov audit: not
    // "target + overhead" alone — a brand's real break-even is often known even when unit costs are not loaded).
    const fbt = staFb(b);
    const lines = w > 0 ? { tgt: tw / w, be: bw / w, known: true, cover }
      : fbt ? { tgt: fbt.tgt, be: fbt.be, known: false, fallback: true, cover } : { tgt: null, be: null, known: false, cover };
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
    // The start Sellora counts from — one rule for everything (18 Nov audit): judged from the start + 30 days. The start is
    // the campaign's own start at Amazon when the product's ads began with it or before; otherwise the last day of the
    // product's first week with ad spend (the weekly figures say only which week, so its last day — never judged early).
    let start = 0, startEst = false;
    if (cpMade && (!firstAd || cpMade >= firstAd)) start = cpMade;
    else if (firstAd) { start = Math.max(staAddDays(firstAd, 6), cpMade || 0); startEst = true; }
    else if (knownAge) { start = cpMade || now; startEst = !cpMade; }   // a known product with no week of ads yet: starts now
    const isNew = !!start && !staStarted(start, STA.AGE_DAYS);
    // Launch and ranking campaigns (by name) get STA.LAUNCH_DAYS from their start, then are judged like any other campaign
    // (18 Nov audit: the name alone kept them out of every verdict for good). No start known at all: still left alone.
    const ctype = autoCp.has(cid) ? 'auto' : ptAg.has(ag) && !kwAg.has(ag) ? 'pt' : kwAg.has(ag) ? 'kw' : '';
    const out = { ag, cid, cn, agn, asins: p.asins, parents: p.parents, pk, ln: lines, types, ctype,
      own: s >= 50 ? os / s : null, isNew, newFrom: isNew ? staAddDays(start, STA.AGE_DAYS) : 0,
      launchName: STA_LAUNCH.test(cn), launch: false, launchTo: 0, since: start, startEst, cpMade, firstAd: firstAd || 0 };
    if (out.launchName) {
      out.launch = !start || !staStarted(start, STA.LAUNCH_DAYS);
      out.launchTo = start ? staAddDays(start, STA.LAUNCH_DAYS) : 0;
    }
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
    // Very low ACoS (18 Nov audit): no longer "a likely data error" — cheap sales are often real (brand and own-product
    // searches). Flagged to look at, judged like any other, and may lead or be scaled.
    row.lowAcos = !row.bad && row.o >= 3 && row.acos != null && row.acos < STA.LOW_ACOS;
    row.suspect = false;
    row.os = x.os != null ? x.os : null;
    row.own = (/^EXACT$/i.test(mt) && staKey(kw) === row.tk) || (row.asin && /^asin=/i.test(staLow(kw)) && staLow(kw).includes(tl));
    row.ent = staEntOf(b, x.ag, kw, mt);
    if (row.ent && row.ent.made && !staStarted(row.ent.made, STA.AGE_DAYS)) row.kwNew = staAddDays(row.ent.made, STA.AGE_DAYS);
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
    // Other products' sales on THIS term (18 Nov audit: "1 order worth $316" showed no badge): the same-SKU sales Amazon
    // reports for the term when it sends them, else an order worth over 3× the advertised product's price.
    if (!tags.some(t => t[0] === 'halo') && row.s > 0) {
      let why = '';
      if (row.os != null && row.s >= 20 && row.os / row.s < STA.HALO) why = `Only ${staMoney(row.os)} of its ${staMoney(row.s)} ad sales were the advertised product; the rest are other products bought after the click.`;
      else if (row.os == null && row.o > 0) {
        let price = 0;
        try { (ai.asins || []).forEach(a => { const p = ADSX.lines(a).price; if (p > price) price = p; }); } catch (e) { price = 0; }
        if (price > 0 && row.s / row.o > price * 3) why = `${staMoney(row.s / row.o)} per order, against about ${staMoney(price)} for the advertised product: most of it is likely other products bought after the click.`;
      }
      if (why) tags.push(['halot', 'Other products\' sales', why + ' Judged on all ad sales.']);
    }
    if (row.o > row.c) tags.push(['multi', 'More orders than clicks', `${staInt(row.o)} orders from ${staInt(row.c)} click${row.c === 1 ? '' : 's'}: normal with 7-day attribution — a shopper can order again, or several products, after one click. Kept and judged on its real sales.`]);
    if (row.lowAcos) tags.push(['lowacos', 'Very low ACoS', `ACoS ${staPct(row.acos)} with ${staInt(row.o)} orders: very cheap sales, often a brand or own-product search. Worth a look before raising — judged like any other.`]);
    if (ai.isNew || ai.launch || row.kwNew) tags.push(['new', ai.launch ? 'Launch campaign' : 'New', ai.launch ? staLaunchHold(ai) + '.'
      : `Fewer than ${STA.AGE_DAYS} days of ads: judged from ${staDay(row.kwNew || ai.newFrom)}.`]);
    // A brand term spending in a campaign that is not a brand campaign (its name has no brand term, "brand" or "defense").
    if (tags.some(t => t[0] === 'brand') && row.sp > 0 && !staBrandCp(ai.cn, P)) {
      tags.push(['leak', 'Brand leak', `A search for your own brand, paid for in "${ai.cn}", which is not a brand campaign. Brand searches usually cost less in a brand campaign of their own.`]);
    }
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
      let can = paths.filter(r => r.o >= STA.LEAD_ORDERS && r.ln.be != null && r.acos != null && r.acos <= r.ln.be && !r.suspect);
      // No unit cost and no target anywhere on these paths (18 Nov): a PROVISIONAL lead — 3+ orders and the lowest ACoS —
      // so overlap still shows. Then only a path with no order, or at 1.5× the lead's ACoS or worse, is routed to it.
      const provisional = !can.length && paths.every(r => r.ln.be == null);
      if (provisional) can = paths.filter(r => r.o >= STA.LEAD_ORDERS && r.acos != null && !r.suspect);
      if (!can.length) return;
      can.sort((p, q) => (q.own - p.own) || (p.acos - q.acos) || (q.o - p.o));
      const lead = can[0];
      const la = lead.acos / 100;
      const g = { key: 'h:' + b + '|' + lead.tk + '|' + pk, brand: b, term: lead.term, tk: lead.tk, lead, paths: [], excess: 0, campaigns: 0, provisional };
      paths.forEach(r => {
        r.group = g;
        r.leadAcos = lead.acos;
        if (r === lead) { r.role = 'lead'; return; }
        // Doing as well as the lead (or better): left alone. With a provisional lead, anything within 1.5× of it too.
        if (r.o > 0 && r.acos != null && r.acos <= (provisional ? lead.acos * STA.PROV_GAP : lead.acos + 0.05)) { r.role = 'fine'; r.excess = 0; return; }
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
    M.tgAll.push(g);
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

// A brand campaign: its name holds a brand term, or says "brand" / "branded" / "defense" (#20, 18 Nov).
const staBrandCp = (cn, P) => !!cn && (P.isBrand(cn) || /\bbrand(ed)?\b|\bdefen[cs]e\b/i.test(cn));

// 1. A row whose figures cannot be true is set aside: why, or '' when it is fine.
// More orders than clicks is NOT one (18 Nov audit): with 7-day attribution a shopper can order again, or order several
// products, after one click — those rows are kept, judged on their real sales, and carry a "More orders than clicks" tag.
function staBadData(x) {
  if ((x.o || 0) > 0 && !((x.s || 0) > 0)) return 'Orders without sales';
  if ((x.s || 0) > 0 && !((x.c || 0) > 0)) return 'Sales without a click';
  return '';
}

// "Launch campaign" hold: left alone until its LAUNCH_DAYS are over (or for now, when its start is not known).
function staLaunchHold(ai) {
  return ai.launchTo ? `Launch campaign (by its name): not judged on ACoS until ${staDay(ai.launchTo)}`
    : 'Launch campaign (by its name): not judged on ACoS — its start date is not known yet';
}
// A product-targeting expression (asin="…", category="…") rather than a keyword.
const staIsTgtExpr = kw => /^\s*(asin|asin-expanded|category|keyword-group)\s*[=-]/i.test(String(kw || '')) || /=\s*"/.test(String(kw || ''));

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
  g.noPause = g.ai.types.has(tk) ? 'product word' : P.isBrand(g.kw) ? 'brand term' : staSeasonOf(g.kw) ? 'seasonal keyword'
    : (P.brandOrders.get(tk) || 0) >= STA.MAIN_ORDERS ? 'main keyword' : '';
  g.brandTerm = !!P.isBrand(g.kw);
  if (g.bad) { g.hold = 'Data check: ' + g.bad; return; }
  if (info.stale) { g.hold = info.stale; return; }
  if (g.ai.launch) { g.hold = staLaunchHold(g.ai); return; }
  if (g.ai.isNew) { g.hold = `New: judged from ${staDay(g.ai.newFrom)}`; return; }
  if (g.ent && g.ent.made && !staStarted(g.ent.made, STA.AGE_DAYS)) { g.hold = `New ${staIsTgtExpr(g.kw) ? 'target' : 'keyword'}: judged from ${staDay(staAddDays(g.ent.made, STA.AGE_DAYS))}`; return; }
  if (g.paused) { g.hold = 'Paused at Amazon'; return; }
  if (g.c < STA.MIN_CLICKS || !(g.sp > 0)) return;
  const tgt = g.brandTerm ? STA.BRAND_TGT : ln.tgt, be = g.brandTerm ? STA.BRAND_TGT : ln.be;
  g.tgtUse = tgt;
  g.beUse = be;
  const last = staLastChange(g.pathKey);
  const cool = last && Date.now() - last < STA.COOLDOWN * 86400000;
  if (!(g.o > 0)) return staTgtNoSale(g, cool, last);
  if (tgt == null) {
    // No unit cost and no target: an ACoS over 100% still loses money on every sale (19 Nov audit).
    if (g.acos > STA.LOSS_ACOS && g.sp >= STA.LOSS_MIN_SP) {
      g.cat = 'burn'; g.kind = 'loss'; g.burned = g.sp - g.s; g.next = 'reduce'; g.tgtUse = STA.LOSS_ACOS;
      if (cool) { g.hold = `Bid changed by Sellora ${staDay(last)}: judged again after ${STA.COOLDOWN} days`; g.next = null; }
      if (g.rl) g.next = null;
      staTgtBid(g);
      return;
    }
    g.hold = 'No unit cost: profit not judged'; return;
  }
  const poor = g.c >= STA.POOR_CLICKS && g.rate && g.o / g.c < g.rate.p * STA.POOR_SHARE && staBinomLe(g.o, g.c, g.rate.p) < STA.CHANCE;
  g.beBrand = g.brandTerm;   // a brand term is held to the brand-term limit, not a break-even (18 Nov audit)
  if (g.acos > be && g.o < STA.BE_ORDERS) { g.cat = 'watch'; g.hold = `Above break-even on ${g.o} order${g.o === 1 ? '' : 's'}: watched until ${STA.BE_ORDERS}`; }
  else if (g.acos > be) { g.cat = 'burn'; g.kind = 'be'; g.burned = g.sp - g.s * be / 100; g.next = 'reduce'; }
  else if (poor && g.acos > tgt) { g.cat = 'burn'; g.kind = 'poor'; g.burned = g.sp - g.s * tgt / 100; g.next = 'reduce'; }
  else if (g.acos > tgt) g.hold = `Between target ${staPct(tgt)} and break-even ${staPct(be)}: covers its costs`;
  else if (g.o >= STA.SCALE_ORDERS && g.acos <= tgt * STA.SCALE_SHARE) {
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
  if (g.sp < STA.NOSALE_MIN_SP) { g.cat = 'watch'; g.hold = `No order yet on ${staMoney(g.sp)}: judged from ${staMoney(STA.NOSALE_MIN_SP)} of spend`; return; }
  g.cat = 'burn';
  g.kind = 'none';
  g.burned = g.sp;
  // A pause is hard to take back: it needs under 1% chance; between 1% and 5%, a lower bid while more clicks come in.
  g.next = g.noPause || g.chance >= STA.NEG_CHANCE ? 'reduce' : 'pause';
  if (!g.noPause && g.chance >= STA.NEG_CHANCE) g.softNote = `Not yet sure enough to pause (about ${staNeed(p, g.c, STA.NEG_CHANCE)} more clicks): a lower bid meanwhile`;
  if (cool) { g.hold = `Bid changed by Sellora ${staDay(last)}: judged again after ${STA.COOLDOWN} days`; g.next = null; }
  if (g.rl) g.next = null;
  staTgtBid(g);
}
// The suggested bid of a target: the current bid (or, until it is read, the CPC) × target ÷ ACoS, within ±20% a step.
function staTgtBid(g) {
  const bid = g.ent && g.ent.bid > 0 ? g.ent.bid : 0;
  const base = bid || g.cpc;
  if (!(base > 0)) return;
  const f = !(g.o > 0) || g.acos == null ? 1 - STA.STEP
    : Math.min(1 + STA.STEP, Math.max(1 - STA.STEP, (g.tgtUse || 0) / g.acos));
  // A cut from a bid far above what is paid per click changes nothing (19 Nov audit: bid $1.04, CPC $0.38 → $0.84):
  // a cut is worked out from the lower of the two, so it bites; the 20% step is then measured from that same figure.
  const down = f < 1;
  const from = down && bid > 0 && g.cpc > 0 && g.cpc < bid ? g.cpc : base;
  g.sugBid = staBidRound(from * f, from);
  g.bidFrom = from;
  g.bidBase = from === g.cpc && (!bid || g.cpc < bid) ? 'cpc' : 'bid';
}
// A bid to the cent, rounded TOWARD the figure it moves from, so a full 20% step never rounds past the limit (19 Nov
// audit: $1.04 × 0.8 = $0.832 → $0.83 = −20.2%, and the dialog then refused its own default). Never under Amazon's minimum.
function staBidRound(v, from) {
  const c = v * 100, r = v < from ? Math.ceil(c - 1e-9) : v > from ? Math.floor(c + 1e-9) : Math.round(c);
  return Math.max(STA.MIN_BID, r / 100);
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
  if (r.ai.launch) { r.hold = staLaunchHold(r.ai); b.push(['Launch', 'info']); return finish(); }
  if (r.ai.isNew || r.kwNew) { r.hold = `Fewer than ${STA.AGE_DAYS} days of ads: judged from ${staDay(r.kwNew || r.ai.newFrom)}`; b.push(['New', 'info']); return finish(); }
  const chancePct = r.chance != null ? (r.chance * 100).toFixed(1) + '%' : '';
  // The short evidence line: orders in clicks, ROAS against break-even. The statistics stay on the badge's hover.
  const roasBe = be != null && be > 0 ? ` · break-even ${staRoas(be)}` : '';
  const short = `${staInt(r.o)} order${r.o === 1 ? '' : 's'} in <b>${staInt(r.c)} clicks</b> · ROAS <b>${r.sp > 0 ? (r.s / r.sp).toFixed(2) : '—'}</b>${roasBe}`;
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
      r.hold = `Too early: about ${need} more clicks to tell`;
      b.push(['Watch', 'warn', `0 orders in ${r.c} clicks happens ${chancePct} of the time if it converted like ${r.rate.w}.`]);
      return finish();
    }
    if (r.sp < STA.NOSALE_MIN_SP) {
      r.cat = 'watch';
      r.hold = `No order yet on ${staMoney(r.sp)}: judged from ${staMoney(STA.NOSALE_MIN_SP)} of spend`;
      b.push(['Watch', 'warn', `0 orders in ${r.c} clicks, but only ${staMoney(r.sp)} spent.`]);
      return finish();
    }
    r.cat = 'burn';
    r.kind = 'none';
    r.burned = r.sp;
    b.push(['No sales', 'bad', `0 orders in ${r.c} clicks happens only ${chancePct} of the time if it converted like ${r.rate.w} (${(r.rate.p * 100).toFixed(1)}%): unlikely to be chance.`]);
    r.ev = short;
    // A negative is hard to take back (19 Nov audit): it needs under 1% chance AND the settled window — the 30-day
    // fallback counts the last 7 days, before all their sales are in. Short of that: a lower bid on its keyword meanwhile.
    if (r.chance < STA.NEG_CHANCE && info.settled) r.next = 'neg';
    else {
      r.soft = true;
      r.softNote = !info.settled ? 'From the 30-day report (the settled one is missing): its last 7 days\' sales are not all in, so no negative yet'
        : `Not yet sure enough for a negative (about ${staNeed(r.rate.p, r.c, STA.NEG_CHANCE)} more clicks)`;
      r.next = g && r.kw ? 'reduce' : null;
      if (r.next) r.protectNote = r.softNote + ' — a lower bid on its keyword meanwhile';
      else r.hold = r.softNote;
    }
  } else if (tgt == null) {
    // No unit cost: profit is not judged — except an ACoS over 100%, where every sale costs more in ads than it brings
    // whatever the cost (19 Nov audit: 190% and 110% sat on Hold), and a clearly weaker path of a provisional lead.
    if (r.acos > STA.LOSS_ACOS && r.sp >= STA.LOSS_MIN_SP && r.c >= STA.MIN_CLICKS) {
      r.cat = 'burn';
      r.kind = 'loss';
      r.burned = Math.max(0, r.sp - r.s);
      r.tgtUse = r.beUse = STA.LOSS_ACOS;
      r.next = g && g.acos != null && g.acos > STA.LOSS_ACOS ? 'reduce' : 'neg';
      b.push(['Above 100% ACoS', 'bad', `${staMoney(r.sp)} of ads for ${staMoney(r.s)} of sales: every sale costs more in ads than it brings, whatever the unit cost.`]);
      r.ev = short;
    } else if (!(r.role === 'other' && r.excess > 0.5 && r.group && r.group.provisional)) {
      r.hold = 'No unit cost: profit not judged';
      b.push(['Selling', 'ok']);
      return finish();
    } else r.ev = short;
  } else if (r.acos > be && r.c >= STA.MIN_CLICKS && r.o < STA.BE_ORDERS) {
    // One or two orders are not a pattern (19 Nov audit): watched until there are enough.
    r.cat = 'watch';
    r.hold = `Above ${brandTerm ? 'the brand limit' : 'break-even'} on ${r.o} order${r.o === 1 ? '' : 's'}: watched until ${STA.BE_ORDERS}`;
    b.push(['Watch', 'warn', `ACoS ${staPct(r.acos)} on ${r.o} order${r.o === 1 ? '' : 's'}.`]);
  } else if (r.acos > be && r.c >= STA.MIN_CLICKS) {
    r.cat = 'burn';
    r.kind = 'be';
    r.beBrand = brandTerm;
    r.burned = Math.max(0, r.sp - r.s * be / 100);
    // The bid belongs to the target: lower it when the target as a whole is over target; otherwise this one term is the
    // problem, and a negative stops it without touching the terms that sell.
    r.next = g && g.acos != null && g.acos > tgt ? 'reduce' : 'neg';
    b.push(brandTerm ? ['Above brand limit', 'bad', `ACoS ${staPct(r.acos)} vs the ${STA.BRAND_TGT}% limit for brand terms (Lists & settings): ${staMoney(r.burned)} more than that limit allows. Not a break-even — brand terms are held to this limit with or without unit costs.`]
      : ['Above break-even', 'bad', `ACoS ${staPct(r.acos)} vs break-even ${staPct(be)} (target ${staPct(tgt)}${ln.fallback ? ', from your setting' : ''}): ${staMoney(r.burned)} more than break-even allows.`
      + (r.next === 'neg' && g ? ` Its keyword sells at ${staPct(g.acos)} overall, so the fix is for this term alone.` : '')]);
    r.ev = short;
  } else if (r.c >= STA.POOR_CLICKS && r.rate && r.o / r.c < r.rate.p * STA.POOR_SHARE && staBinomLe(r.o, r.c, r.rate.p) < STA.CHANCE && r.acos > tgt) {
    r.cat = 'burn';
    r.kind = 'poor';
    r.burned = Math.max(0, r.sp - r.s * tgt / 100);
    b.push(['Converts poorly', 'bad', `${staPct(r.cvr)} of clicks became orders vs ${(r.rate.p * 100).toFixed(1)}% for ${r.rate.w}: under half, and unlikely to be chance. ACoS ${staPct(r.acos)} over target ${staPct(tgt)}.`]);
    r.ev = short + ' · converts at under half the usual rate';
    r.next = g && g.acos != null && g.acos > tgt ? 'reduce' : 'neg';
  } else if (r.acos > tgt) {
    r.hold = `Between target ${staPct(tgt)} and break-even ${staPct(be)}: covers its costs`;
    b.push(['Over target', 'warn']);
  } else {
    b.push([r.o >= STA.SCALE_ORDERS ? 'Winner' : 'Selling', 'ok']);
    if (r.tagSet.has('own') || r.tagSet.has('sister')) r.hold = 'Own or sister-brand ASIN: not scaled here';
    else if (r.own && r.o >= STA.SCALE_ORDERS && r.acos <= tgt * STA.SCALE_SHARE) {
      r.cat = 'scale';
      r.scaleKind = 'raise';
      r.scaleBrand = brandTerm;
      b.push(['Room to grow', 'ok', `ACoS ${staPct(r.acos)} is at or under ${Math.round(STA.SCALE_SHARE * 100)}% of ${brandTerm ? `the ${STA.BRAND_TGT}% brand-term limit` : `the target ${staPct(tgt)}`}.`]);
      r.ceil = Math.min(r.cpc * tgt / r.acos, r.cpc * 2);
      r.next = g && g.next === 'limit' ? 'limit' : r.ln.cover != null && r.ln.cover < STA.RAISE_COVER ? 'lowstock' : 'raise';
    } else if (!r.own && r.o >= STA.EXACT_ORDERS && !r.exactElsewhere.length && !r.ptElsewhere.length) {
      r.cat = 'scale';
      r.scaleKind = r.asin ? 'asinT' : 'exact';
      r.scaleBrand = brandTerm;
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
  const prov = r.group && r.group.provisional;
  if (r.role === 'lead') b.push([prov ? 'Lead path · provisional' : 'Lead path', 'info', prov ? 'No unit cost, so not proven profitable: of this product\'s paths for this term, this one has the lowest ACoS with 3+ orders.' : 'Of this product\'s paths for this term, this one sells it best.']);
  else if (r.role === 'other') b.push([prov ? 'Competing path · provisional' : 'Competing path', 'info', `The lead path sells it at ${staPct(r.leadAcos)} ACoS${prov ? ' (provisional: no unit cost to prove it profitable)' : ''}.`]);
  // --- 4. what protects it: no negative on a protected term (a main keyword only on a weaker path whose lead is its own exact) ---
  if (r.next === 'neg' || r.next === 'pause') {
    const mainOk = r.main && !r.noNeg && r.routing && r.group && r.group.lead.own;
    if (r.noNeg || (r.main && !mainOk)) {
      const why = r.noNeg || 'main keyword';
      const Why = why[0].toUpperCase() + why.slice(1);
      // Its keyword losing as a whole (no sales, or over target): lower that keyword's bid.
      const gLosing = g && g.c > 0 && (!(g.o > 0) || (g.acos != null && r.tgtUse != null && g.acos > r.tgtUse));
      if (g && gLosing && r.kw) {
        r.next = 'reduce';
        r.protectNote = `${Why}: never negated — a lower bid on its keyword instead`;
      } else if (g && !r.asin && r.kw && !/^EXACT$/i.test(r.mt) && !r.exactElsewhere.length && r.cpc > 0) {
        // Its keyword sells fine and only this term loses: Amazon has no bid per search term, so the term gets its own
        // exact keyword at a lower bid, and a negative exact here stops this ad group paying the old bid for it.
        r.next = 'iso';
        r.isoBid = Math.max(STA.MIN_BID, staR2(r.cpc * (r.o > 0 && r.acos > 0 && r.tgtUse ? Math.max(1 - STA.STEP, Math.min(1 - 0.05, r.tgtUse / r.acos)) : 1 - STA.STEP)));
        r.protectNote = `${Why}: never negated — its own exact keyword at a lower bid instead`;
      } else {
        r.next = null;
        r.hold = `${Why}: never negated` + (r.exactElsewhere.length ? ` — its own exact keyword in ${r.exactElsewhere[0].ai ? r.exactElsewhere[0].ai.cn : 'another campaign'} covers it; a lower bid here at most`
          : r.tagSet.has('product') ? ' — if it keeps losing, check the listing (price, images, reviews)' : '')
          + (r.tagSet.has('season') ? (r.season.inSeason ? ' — in season' : ' — out of season') : '');
      }
    }
  }
  // Seasonal out of season: no bid cut on old figures either.
  if (r.tagSet.has('season') && !r.season.inSeason && (r.next === 'reduce' || r.next === 'iso')) { r.next = null; r.hold = 'Seasonal, out of season: held until it comes round'; }
  // No negative of any kind from the 30-day fallback window (its last 7 days' sales are not all in yet).
  if (!info.settled && (r.next === 'neg' || r.next === 'pause' || r.next === 'iso')) {
    r.next = null;
    r.hold = 'Negatives wait for the settled report (this is the 30-day one: its last 7 days\' sales are not all in)';
  }
  if (r.next === 'reduce' || r.next === 'raise') {
    if (!g) { r.next = r.next === 'reduce' && !r.noNeg && !r.main && !r.soft ? 'neg' : null; if (!r.next) r.hold = r.softNote || "Amazon didn't report which target caught this term"; }
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
  if ($('paneSt').classList.contains('hide')) {
    if (typeof plxAfterChange === 'function') plxAfterChange();
    return;
  }
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
  let L = staLists();
  staDataLine(L.M);
  staSummary(L);
  staBoxes(L);
  // The next-step chips: counted on the view's rows, then the view drawn with only the chip's rows.
  const vr = staViewRows(L);
  staActBar(vr);
  if (ST_ACT && vr) {
    const f = r => staActOf(r) === ST_ACT;
    L = Object.assign({}, L, { burn: L.burn.filter(f), burnTgt: L.burnTgt.filter(f), words: L.words.filter(f), scale: L.scale.filter(f), all: L.all.filter(f),
      groups: L.groups.filter(g => g.shown.some(r => r.role === 'other' && f(r))) });
  }
  if (ST_VIEW === 'new') staDrawNew(L);
  else if (isCp) {
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

/* ---------- the next-step chips ---------- */
const STA_ACTS = [['neg', 'Negative'], ['reduce', 'Lower bid'], ['pause', 'Pause'], ['exact', 'Add exact'], ['raise', 'Raise bid'], ['hold', 'Watch / hold'], ['review', 'In review']];
// The rows the chips count in this view; null for the views without chips.
function staViewRows(L) {
  if (ST_VIEW === 'burn') return ST_SUB === 'target' ? L.burnTgt : ST_SUB === 'word' ? L.words : L.burn;
  if (ST_VIEW === 'scale') return L.scale;
  if (ST_VIEW === 'paths') return L.groups.flatMap(g => g.shown.filter(r => r.role === 'other'));
  if (ST_VIEW === 'all') return L.all;
  return null;
}
// The chip a row belongs to: its next step, or in review, or watch / hold.
function staActOf(r) {
  if (r.status === 'In review' || ((r.type === 'target' || r.type === 'word') && r.rl)) return 'review';
  if (r.status === 'Negated') return 'hold';
  const n = r.next;
  if (n === 'neg' || n === 'word') return 'neg';
  if (n === 'reduce' || n === 'iso') return 'reduce';
  if (n === 'pause') return 'pause';
  if (n === 'exact' || n === 'asinT') return 'exact';
  if (n === 'raise') return 'raise';
  return 'hold';
}
// Can this row be ticked into the review list?
const staCanTick = r => r.type === 'target' ? !!(r.next && !/limit|lowstock/.test(r.next) && !r.rl) : !!r.act;
function staActBar(rows) {
  const bar = $('stActBar');
  if (!rows) { bar.classList.add('hide'); bar.innerHTML = ''; return; }
  bar.classList.remove('hide');
  const n = {};
  rows.forEach(r => { const a = staActOf(r); n[a] = (n[a] || 0) + 1; });
  if (ST_ACT && !n[ST_ACT]) ST_ACT = '';
  const chip = (k, t, c) => `<button type="button" class="sta-chip${ST_ACT === k ? ' on' : ''}${k ? ' a-' + k : ''}" data-a="${k}" aria-pressed="${ST_ACT === k}">${t}<span>${staInt(c)}</span></button>`;
  const shown = ST_ACT ? rows.filter(r => staActOf(r) === ST_ACT) : [];
  const tick = shown.filter(staCanTick);
  const allOn = tick.length && tick.every(r => ST_SEL.has(r.key));
  bar.innerHTML = '<span class="sta-actl">Next step</span>' + chip('', 'All', rows.length) + STA_ACTS.filter(([k]) => n[k]).map(([k, t]) => chip(k, t, n[k])).join('')
    + (tick.length ? `<button type="button" class="sta-btn dim sm sta-actall" data-tickall="1">${allOn ? 'Untick' : 'Tick'} all ${staInt(tick.length)}${tick.length > ST_SIZE ? ' (every page)' : ''}</button>` : '');
  STA_ACTSHOWN = tick;
}
let STA_ACTSHOWN = [];

/* ---------- New: in their first 30 days (launch campaigns: their first 60) — watched, not judged ---------- */
// A name that says little on its own ("SP-PAT", "AUTO", "Ad group 1"): shown with its campaign in front.
const staGenericName = n => { const s = String(n || '').trim(); return !s || s.length <= 10 || !/[a-z]{3}/.test(s) || /^(ad ?group|untitled)\b/i.test(s); };
function staNewRows(L) {
  const M = L.M;
  const q = $('stFilter').value.trim().toLowerCase();
  const byAg = new Map(), out = [], seenCp = new Set();
  M.tgAll.forEach(g => {
    const ai = g.ai;
    if (!ai) return;
    seenCp.add(g.brand + '|' + g.cid);
    if (ai.isNew || ai.launch) {
      const k = g.brand + '|' + g.ag;
      const x = byAg.get(k) || byAg.set(k, { key: 'n:' + k, type: 'new', brand: g.brand, ag: g.ag, cid: g.cid, cn: g.cn || ai.cn, agn: g.agn || ai.agn, ai,
        what: ai.launch ? 'Launch campaign' : ai.cpMade && ai.cpMade === ai.since ? 'New campaign' : 'New product', since: ai.since, est: ai.startEst,
        sp: 0, s: 0, o: 0, c: 0, i: 0, n: 0 }).get(k);
      x.sp += g.sp || 0; x.s += g.s || 0; x.o += g.o || 0; x.c += g.c || 0; x.i += g.i || 0; x.n++;
    } else if (g.ent && g.ent.made && !staStarted(g.ent.made, STA.AGE_DAYS)) {
      // (18 Nov audit: product targets were labelled "New keyword")
      out.push({ key: 'nk:' + g.key, type: 'new', brand: g.brand, ag: g.ag, cid: g.cid, cn: g.cn, agn: g.agn, ai, kw: g.kw, mt: g.mt,
        what: staIsTgtExpr(g.kw) ? 'New target' : 'New keyword', label: staPathLabel(g.kw, g.mt), since: g.ent.made, sp: g.sp || 0, s: g.s || 0, o: g.o || 0, c: g.c || 0, i: g.i || 0 });
    }
  });
  byAg.forEach(x => out.push(x));
  // Campaigns Amazon started recently that have no clicks yet (launch campaigns: within their LAUNCH_DAYS).
  M.brands.forEach(b => {
    const E = staEnt(b);
    if (!E) return;
    Object.keys(E.cp || {}).forEach(cid => {
      const c = E.cp[cid] || [];
      const t = Number(c[8]) || 0, cn = c[0] || staName(b, cid), launch = STA_LAUNCH.test(cn);
      if (!t || staStarted(t, launch ? STA.LAUNCH_DAYS : STA.AGE_DAYS) || seenCp.has(b + '|' + cid)) return;
      out.push({ key: 'nc:' + b + '|' + cid, type: 'new', brand: b, cid, cn, agn: '', ai: null, what: launch ? 'Launch campaign' : 'New campaign',
        state: c[1], since: t, sp: 0, s: 0, o: 0, c: 0, i: 0 });
    });
  });
  out.forEach(r => {
    const launch = r.what === 'Launch campaign';
    // The name: a keyword or target's own text; an ad group's name, with its campaign in front when the name says little.
    r.term = r.label || (r.agn ? (staGenericName(r.agn) && r.cn ? r.cn + ' › ' + r.agn : r.agn) : r.cn);
    r.acos = r.s > 0 ? r.sp / r.s * 100 : null;
    // One rule (18 Nov audit): Day 1 is the start date, by calendar date; judged from start + 30 days (launch: + 60).
    r.days = launch ? STA.LAUNCH_DAYS : STA.AGE_DAYS;
    r.day = r.since ? staDayNo(r.since) : null;
    r.from = launch ? ((r.ai && r.ai.launchTo) || (r.since ? staAddDays(r.since, STA.LAUNCH_DAYS) : 0))
      : r.since ? staAddDays(r.since, STA.AGE_DAYS) : 0;
    const be = r.ai && r.ai.ln ? r.ai.ln.be : null;
    // Warnings first, for launch campaigns too (18 Nov audit: 137 clicks and no order went unflagged under "Launch").
    if (!(r.sp > 0)) { r.note = r.state && !/enabled/i.test(r.state) ? 'No spend yet · ' + String(r.state).toLowerCase() : 'No spend yet'; r.lvl = 'warn'; }
    else if (!(r.o > 0) && r.c >= 40) { r.note = `No order in ${staInt(r.c)} clicks yet: check the listing and the targeting`; r.lvl = 'bad'; }
    else if (launch) {
      r.note = (r.from ? `Launch campaign (by its name): ACoS not judged until ${staDay(r.from)}` : 'Launch campaign (by its name): start date not known yet')
        + (r.o > 0 ? ` · ${staInt(r.o)} order${r.o === 1 ? '' : 's'} at ROAS ${(r.s / r.sp).toFixed(2)}` : '');
      r.lvl = r.o > 0 ? 'ok' : '';
    } else if (r.o > 0 && be != null && r.acos > be) { r.note = `Above break-even so far (ROAS ${staRoas(r.acos)} vs ${staRoas(be)})`; r.lvl = 'warn'; }
    else if (r.o > 0) { r.note = `${staInt(r.o)} order${r.o === 1 ? '' : 's'} at ROAS ${(r.s / r.sp).toFixed(2)}${be != null ? ` (break-even ${staRoas(be)})` : ''}`; r.lvl = 'ok'; }
    else { r.note = 'Too early to tell'; r.lvl = ''; }
    r.hold = r.note;
    r.hay = [r.cn, r.agn, r.label || '', r.what].join(' ').toLowerCase();
  });
  return out.filter(r => !q || r.hay.includes(q));
}
function staDrawNew(L) {
  const rows = staSorted(staNewRows(L), 'sp');
  ST_LAST = rows;
  const page = staPage(rows);
  const nBad = rows.filter(r => r.lvl === 'bad').length, nL = rows.filter(r => r.what === 'Launch campaign').length;
  staHead('What is new, or still launching?', `${staInt(rows.length - nL)} new campaigns, products, keywords and targets in their first ${STA.AGE_DAYS} days`
    + (nL ? `, and ${staInt(nL)} launch-campaign ad group${nL === 1 ? '' : 's'} in their first ${STA.LAUNCH_DAYS}` : '')
    + `. Sellora makes no negative or lower bid on them until then; it only warns`
    + (nBad ? ` — ${staInt(nBad)} need${nBad === 1 ? 's' : ''} a look now.` : '.'));
  const body = page.map(r => `<tr>
      <td class="sta-stick"><span class="sta-cbgap"></span><div class="sta-tc"><div class="sta-term">${staEsc(r.term)}</div>
        <div class="sta-under">${staBadge(staBrandName(r.brand), 'brand-' + r.brand)}${staBadge(r.what, r.what === 'Launch campaign' ? 'warn' : 'info')}</div></div></td>
      <td class="sta-ev sta-ev-s">${staBadge(r.lvl === 'bad' ? 'Look now' : r.lvl === 'warn' ? 'Watch' : r.lvl === 'ok' ? 'Selling' : 'Learning', r.lvl || '')}<div class="sta-why">${staEsc(r.note)}</div></td>
      <td class="num"${r.est ? ' title="Estimated: the last day of the product\'s first week with ad spend (the weekly figures give only the week)"' : ''}>${r.day != null ? `<b>Day ${staInt(r.day)}</b><small class="sta-s">of ${r.days} · since ${r.est ? '~' : ''}${staDay(r.since)}</small>` : staDash}</td>
      <td class="num">${r.from ? staDay(r.from) : staDash}</td>
      <td class="num">${staMoney(r.sp)}</td><td class="num">${staMoney(r.s)}</td><td class="num">${staInt(r.o)}</td><td class="num">${staInt(r.c)}</td>
      <td class="num">${r.acos != null ? staPct(r.acos) : staDash}</td><td class="num">${r.sp > 0 ? (r.s / r.sp).toFixed(2) : staDash}</td>
      ${staPathCell(r, true)}</tr>`).join('');
  $('stTable').innerHTML = `<thead><tr><th class="sta-stick">New</th><th>Status so far</th><th class="num">Age</th><th class="num" title="The first day Sellora suggests a negative or a lower bid">Judged from</th>
    ${staTh('Spend', 'sp', 1)}${staTh('Sales', 's', 1)}${staTh('Orders', 'o', 1)}${staTh('Clicks', 'c', 1)}${staTh('ACoS', 'acos', 1)}<th class="num">ROAS</th><th>Campaign · ad group</th></tr></thead><tbody>`
    + (body || `<tr><td colspan="11" class="muted" style="padding:14px">Nothing in its first ${STA.AGE_DAYS} days, and no launch campaign in its first ${STA.LAUNCH_DAYS}${ST.ent ? '' : ' that Sellora can see yet — campaign start dates come from Amazon once the Ads backend is switched on'}.</td></tr>`) + '</tbody>';
  staPager(rows.length, 'new items', ST.ent ? 'start dates from Amazon\'s record' : 'ages from the first week with ad spend; Amazon\'s start dates once the Ads backend is on');
}

// The data line: window, completeness per brand, data checks, unit costs, Amazon's record, where the lists are kept.
function staDataLine(M) {
  const parts = [];
  const h = M.have;
  if (M.settled) {
    const x = M.brands.map(b => h[b]).find(y => y && y.from) || {};
    const rw = ST.rec ? M.brands.map(b => ST.rec.d && ST.rec.d[b]).find(y => y && y.from) || ST.rec : null;
    parts.push(`Judged on <b>settled clicks${x.from ? ', ' + staEsc(staShortDay(x.from)) + ' – ' + staEsc(staShortDay(x.to)) : ''}</b>, with 7-day sales as in the Ads console.`
      + (rw ? ` The last 7 days${rw.from ? ' (' + staEsc(staShortDay(rw.from)) + ' – ' + staEsc(staShortDay(rw.to)) + ')' : ''} show under the figures in Burning money and are not counted.` : ''));
    // The two windows should meet (settled ends the day before the last 7 days begin). When one report is from an older
    // run they don't, and the days between are in neither (18 Nov audit): say which, and why.
    if (rw && rw.from && x.to) {
      const d0 = Date.parse(String(x.to).slice(0, 10) + 'T12:00:00Z'), d1 = Date.parse(String(rw.from).slice(0, 10) + 'T12:00:00Z');
      const gap = d0 && d1 ? Math.round((d1 - d0) / 86400000) - 1 : 0;
      if (gap > 0) {
        const days = [];
        for (let i = 1; i <= Math.min(gap, 3); i++) days.push(staShortDay(new Date(d0 + i * 86400000).toISOString()));
        parts.push(`<span class="sta-bad">${staEsc(days.join(', '))}${gap > 3 ? ` and ${gap - 3} more` : ''} ${gap === 1 ? 'is' : 'are'} in neither window: the settled report is from an earlier day's run than the last 7 days, so it ends before they begin. They meet again once the next settled report lands.</span>`);
      } else if (gap < 0) {
        parts.push(`<span class="sta-dash">The last 7 days overlap the settled window by ${-gap} day${gap === -1 ? '' : 's'} (reports from different runs); only the settled days are judged.</span>`);
      }
    }
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
  if (bad) parts.push(`<span class="sta-bad">${staInt(bad)} row${bad === 1 ? '' : 's'} set aside as a data check (orders without sales, or sales without a click): left out of every verdict, still counted in the totals above</span>`);
  const multi = M.rows.filter(r => r.tagSet && r.tagSet.has('multi')).length;
  if (multi) parts.push(`<span class="sta-dash">${staInt(multi)} row${multi === 1 ? ' has' : 's have'} more orders than clicks — normal with 7-day attribution (a shopper orders again, or several products, after one click): kept and judged</span>`);
  // #1 (18 Nov): without unit costs nothing can be "above break-even". Say per brand exactly what is still judged — the
  // brand-term limit works without costs, so the cards may show brand terms (18 Nov audit: "10 above break-even").
  const noTgt = M.brands.filter(b => !staFb(b)), withTgt = M.brands.filter(b => !!staFb(b));
  if (!ST.costs) {
    const why = ST.costErr ? 'Unit costs could not be read for your account (Profit &amp; Margin access needed)' : 'No unit costs in Profit &amp; Margin';
    parts.push(noTgt.length
      ? `<div class="sta-warnline sta-costwarn"><b>${why}, and no target ACoS for ${noTgt.map(staBrandName).join(' or ')}.</b> For ${noTgt.length > 1 ? 'them' : 'it'} Sellora judges only search terms with no sales, and brand terms against the ${STA.BRAND_TGT}% brand-term limit — nothing else is called above break-even or worth scaling, placements get no Raise or Lower, and competing paths stay provisional. `
        + (withTgt.length ? `${withTgt.map(b => staBrandName(b) + ' is judged against your ' + staFbTxt(b)).join('; ')}. ` : '')
        + `Set a target ACoS to switch the rest on now; unit costs replace it product by product when they arrive. `
        + `<button type="button" class="sta-btn sm" data-settgt="1">Set a target ACoS</button></div>`
      : `<span class="sta-dash">${why}: judged against your settings (${M.brands.map(b => staBrandName(b) + ' ' + staFbTxt(b)).join(', ')}) from Lists &amp; settings</span>`);
  }
  parts.push(staSrcLine());
  if (!ST.ent) parts.push('Until Amazon IDs and bids are read, bids are worked from the CPC and bid changes wait in the review list');
  if (ST_RL.where === 'local' || STS.where === 'local') parts.push('<span class="sta-bad">The review list and the lists are kept in this browser only until they are switched on for everyone</span>');
  stMsg(parts.map(p => `<span>${p}</span>`).join(''));
}

// Where every figure comes from, and how fresh it is: the three nightly caches and the five of the Ads backend.
function staSrcLine() {
  const src = ST.src || {};
  const old = at => at && Date.now() - staStamp(at) > STA.STALE_H * 3600000;
  const one = (names, label) => {
    const xs = names.map(n => src[n]).filter(Boolean);
    if (!xs.length) return '';
    const bad = xs.find(x => !x.ok && !x.off);
    if (bad) return `<span class="sta-bad" title="${staEsc(bad.err)}">✗ ${label}: could not be read</span>`;
    if (xs.every(x => x.off)) return `<span class="sta-dash" title="The Ads backend has not written it yet (Ravi switches it on)">${label}: not switched on yet</span>`;
    const ok = xs.filter(x => x.ok);
    const at0 = ok.map(x => x.at).filter(Boolean).sort()[0] || '';
    const t0 = staStamp(at0);
    const at = t0 ? new Date(t0).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : at0;
    const errs = ok.flatMap(x => Object.entries(x.err || {}).filter(([, v]) => v).map(([b, v]) => staBrandName(b) + ': ' + v));
    if (errs.length) return `<span class="sta-bad" title="${staEsc(errs.join(' · '))}">! ${label} ${staEsc(at)} — ${errs.length} brand${errs.length === 1 ? '' : 's'} kept the last good copy</span>`;
    if (old(at0)) return `<span class="sta-bad">! ${label} ${staEsc(at)} — over ${STA.STALE_H} h old</span>`;
    return `<span class="sta-ok">✓ ${label} ${staEsc(at)}</span>`;
  };
  return 'Amazon data: ' + [one(['srchTerm', 'targeting', 'adGroup'], 'nightly search terms'), one(['adEntities'], 'IDs, bids, negatives'),
    one(['stSettled', 'tgtSettled'], '7-day settled reports'), one(['stRecent', 'tgtRecent'], 'last 7 days')].filter(Boolean).join(' · ');
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
  const cell = (k, v, tip, cls, sub) => `<div${cls ? ` class="${cls}"` : ''}${tip ? ` title="${staEsc(tip)}"` : ''}><small>${k}</small><b>${v}</b>${sub ? `<em class="sta-sumsub">${sub}</em>` : ''}</div>`;
  // Money at stake: what Burning money and Competing paths would save, each term counted once (the larger of the two).
  // Overlap cost of a PROVISIONAL lead (no unit cost to prove it profitable) is kept apart (18 Nov audit: it was 94% of the
  // figure, shown as if final): the big figure is what is sure; the provisional part shows under it.
  const firm = new Map(), prov = new Map();
  L.burn.forEach(r => firm.set(r.key, Math.max(firm.get(r.key) || 0, r.burned || 0)));
  L.groups.forEach(g => g.shown.forEach(r => {
    if (r.role !== 'other') return;
    const m = g.provisional ? prov : firm;
    m.set(r.key, Math.max(m.get(r.key) || 0, r.excess || 0));
  }));
  const atStake = [...firm.values()].reduce((t, v) => t + v, 0);
  let provStake = 0;
  prov.forEach((v, k) => { provStake += Math.max(0, v - (firm.get(k) || 0)); });
  const cards = L.burn.reduce((t, r) => t + (r.burned || 0), 0) + L.groups.reduce((t, g) => t + g.shown.filter(r => r.role === 'other').reduce((u, r) => u + (r.excess || 0), 0), 0);
  // Branded / non-branded / small terms not listed / other: four parts that add up to the ad spend and the ad sales
  // (18 Nov audit: the two shares left out the small terms, so their ACoS looked far better than the whole). The small
  // terms have no order by definition; "other" is what the keyword report counts and the search-term report does not.
  const br = { sp: 0, s: 0 }, nb = { sp: 0, s: 0 }, lk = { n: 0, sp: 0 };
  M.rows.forEach(r => {
    const t = r.tagSet && r.tagSet.has('brand') ? br : nb;
    t.sp += r.sp || 0; t.s += r.s || 0;
    if (r.tagSet && r.tagSet.has('leak')) { lk.n++; lk.sp += r.sp || 0; }
  });
  const ot = { sp: sp - br.sp - nb.sp - tail, s: s - br.s - nb.s };
  const ac = t => t.s > 0 ? staPct(t.sp / t.s * 100) : '—';
  const stakeTip = 'Spend Sellora suggests stopping or moving, each search term counted once — the larger of its Burning money and its Competing-paths overlap cost, so the boxes below add up to more. '
    + (provStake >= 1 ? `The ${staMoney0(provStake)} under it is overlap cost against a provisional lead (no unit cost or target to prove the lead profitable): it firms up once costs or a target are set. ` : '')
    + 'Only what is listed under the filters.';
  $('stSum').innerHTML = cell('Money at stake', staMoney0(atStake), stakeTip, 'sta-stake', provStake >= 1 ? `+ ${staMoney0(provStake)} provisional` : 'each term counted once')
    + cell('Ad spend', staMoney0(sp), 'All keywords and targets of the brands in view, this window')
    + cell('Ad sales', staMoney0(s)) + cell('ACoS', s > 0 ? staPct(sp / s * 100) : '—') + cell('Orders', staInt(o)) + cell('Clicks', staInt(c))
    + cell('Search terms', staInt(M.rows.length), 'Listed one by one')
    + cell('Suggestions', staInt(act), `Rows with a next step, after the filters — one per row. The boxes below count search terms and competing-path groups instead (a group holds several paths, and a term can be in more than one box), so they add up differently. Boxes together: ${staMoney0(cards)} before each term is counted once.`, '', 'one per row')
    + cell('Not listed', staMoney0(tail), `${staInt(tailN)} terms with fewer than 3 clicks and no order, too small to list one by one. Their recurring words appear in Burning money → By word.`, '', `${staInt(tailN)} small terms`)
    + `<div class="sta-bline"><span title="Search terms holding a brand term from Lists &amp; settings"><b>Branded</b> ${staMoney0(br.sp)} spend · ACoS ${ac(br)}</span>`
    + `<span title="Listed search terms without a brand term"><b>Non-branded</b> ${staMoney0(nb.sp)} spend · ACoS ${ac(nb)}${tail > 0 && nb.s > 0 ? ` <span class="sta-dash">(${staPct((nb.sp + tail) / nb.s * 100)} with the small terms)</span>` : ''}</span>`
    + (tail > 0 ? `<span title="Fewer than 3 clicks and no order: no sales by definition, nearly all non-branded"><b>Small terms, not listed</b> ${staMoney0(tail)} spend · no orders</span>` : '')
    + (Math.abs(ot.sp) >= 1 || Math.abs(ot.s) >= 1 ? `<span class="sta-dash" title="Amazon's keyword-and-target report and its search-term report never match to the cent; this is the difference, so the parts add up to the ad spend">Report difference ${ot.sp < 0 ? '−' : ''}${staMoney0(Math.abs(ot.sp))} spend · ${ot.s < 0 ? '−' : ''}${staMoney0(Math.abs(ot.s))} sales</span>` : '')
    + `<span class="sta-dash">= ${staMoney0(sp)} ad spend</span>`
    + (lk.n ? `<span class="sta-bad">${staInt(lk.n)} brand term${lk.n === 1 ? '' : 's'} paid for outside brand campaigns · ${staMoney0(lk.sp)}</span><button type="button" class="sta-btn dim sm" data-leaks="1">Show them</button>`
      : '<span class="sta-dash">No brand leaks: brand searches run only in brand campaigns</span>')
    + `<span class="sta-dash" title="Brand terms are set per brand in Lists &amp; settings. A brand campaign has a brand term, 'brand', 'branded' or 'defense' in its name.">brand terms from Lists &amp; settings</span></div>`;
}

// Is any brand in view without unit costs AND without a target ACoS (only no-sales and brand terms are judged)?
function staNoTarget() {
  const pick = ($('stBrand') || {}).value || 'ALL';
  return !ST.costs && (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).some(b => !staFb(b));
}
// A brand's own target and break-even for products without a unit cost (Lists & settings), or null. Either one is enough:
// target only → break-even = target + overhead + salary; break-even only → target = break-even − those (at least 1%).
function staFb(b) {
  const S = staSet(b), ohSal = (PF_MODEL.oh || 0) + (PF_MODEL.sal || 0);
  const t = Number(S.fallbackTgt) > 0 ? Number(S.fallbackTgt) : null, e = Number(S.fallbackBe) > 0 ? Number(S.fallbackBe) : null;
  if (!t && !e) return null;
  const tgt = t || Math.max(1, e - ohSal), be = Math.max(e || t + ohSal, tgt);
  return { tgt, be, setBe: !!e };
}
const staFbTxt = b => { const f = staFb(b); return f ? `${Math.round(f.tgt)}% target · ${Math.round(f.be)}% break-even` : 'no target'; };
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
  const none = L.burn.filter(r => r.kind === 'none').length, poor = L.burn.filter(r => r.kind === 'poor').length;
  const beB = L.burn.filter(r => r.kind === 'be' && r.beBrand).length, be = L.burn.filter(r => r.kind === 'be' && !r.beBrand).length;
  const exact = L.scale.filter(r => r.scaleKind !== 'raise').length;
  const scB = L.scale.filter(r => r.scaleBrand).length, scN = L.scale.length - scB;
  const excess = L.groups.reduce((t, g) => t + g.shown.filter(r => r.role === 'other').reduce((u, r) => u + (r.excess || 0), 0), 0);
  const provEx = L.groups.filter(g => g.provisional).reduce((t, g) => t + g.shown.filter(r => r.role === 'other').reduce((u, r) => u + (r.excess || 0), 0), 0);
  const loss = L.burn.filter(r => r.kind === 'loss').length;
  const burnQ = [`${staInt(none)} with no sales`].concat(loss ? [`${staInt(loss)} over 100% ACoS`] : []).concat(be ? [`${staInt(be)} above break-even`] : [])
    .concat(beB ? [`${staInt(beB)} brand term${beB === 1 ? '' : 's'} over the ${STA.BRAND_TGT}% brand limit`] : []).concat(poor ? [`${staInt(poor)} converting poorly`] : []).join(', ') + '.';
  const scaleQ = !L.scale.length ? (staNoTarget() ? 'Needs a unit cost or a target ACoS to judge what sells under target.' : 'Nothing selling well enough under target yet.')
    : (scN ? `${staInt(scN)} selling under target with room to grow` : '') + (scN && scB ? ', ' : '')
      + (scB ? `${staInt(scB)} brand term${scB === 1 ? '' : 's'} well under the ${STA.BRAND_TGT}% brand limit` : '') + (exact ? ` · ${staInt(exact)} not their own keyword yet` : '') + '.';
  const pathsQ = `One product reached through several targets · ${staMoney0(excess)} of overlap cost`
    + (provEx >= 1 ? (provEx >= excess - 0.5 ? ', all provisional (no unit cost or target)' : `, ${staMoney0(provEx)} of it provisional`) : '') + '.';
  const open = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved');
  const appr = open.filter(x => x.status === 'approved').length;
  $('stBoxes').innerHTML =
    box('burn', 'var(--bad)', 'Burning money', staMoney0(burned), `on ${staInt(L.burn.length)} search term${L.burn.length === 1 ? '' : 's'}`,
      burnQ, 'Negatives and lower bids')
    + box('scale', 'var(--accent)', 'Worth scaling', staInt(L.scale.length), 'search terms', scaleQ, 'Raise bids, add as exact')
    + box('paths', 'var(--brand)', 'Competing paths', staInt(L.groups.length), 'search terms', pathsQ, provEx >= 1 ? 'Keep the lead path (provisional)' : 'Keep the lead path')
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
// A copy button for a name, exactly as Amazon has it (paste it into the Ads console's search).
const staCopy = (text, what) => text ? `<button type="button" class="sta-copy" data-copy="${staEsc(text)}" title="Copy the ${what} name" aria-label="Copy the ${what} name">`
  + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button>' : '';
// The path cell: the campaign, the ad group (each with a copy button), then the keyword or target.
function staPathCell(r, noTarget) {
  const label = staPathLabel(r.kw, r.mt);
  const cn = r.cn || 'Campaign ' + r.cid;
  return `<td class="sta-path"><div class="sta-pl" title="Campaign: ${staEsc(cn)}"><b>${staEsc(cn)}</b>${staCopy(r.cn, 'campaign')}</div>`
    + `<div class="sta-pl" title="Ad group: ${staEsc(r.agn || '')}"><small>${staEsc(r.agn || '—')}</small>${staCopy(r.agn, 'ad group')}</div>`
    + (noTarget ? '' : `<small class="sta-pt" title="${staEsc(label)}">${staEsc(label)}</small>`) + '</td>';
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
  if (n === 'neg') {
    // #6 (18 Nov): one click, straight to the review list, after the same checks as Tick → Add (staQuick).
    const ph = !r.asin && staPhraseOk(r);
    return `<td class="sta-next"><small title="${staEsc(where)}">${negType} · ${lvl} level</small><div class="sta-negq">`
      + staBtn(r.asin ? 'Neg ASIN' : 'Neg exact', 'qx', r.key, 'neg sm', `Add a ${r.asin ? 'negative ASIN target' : 'negative exact'} at ${lvl} level (${where}) straight to the review list`)
      + (r.asin ? '' : ph.ok ? staBtn('Neg phrase', 'qp', r.key, 'dim sm', `Add a negative phrase at ${lvl} level straight to the review list: blocks every search containing "${r.term}" there`)
        : `<button type="button" class="sta-btn dim sm" disabled title="${staEsc('No phrase negative: ' + ph.why)}">Neg phrase</button>`)
      + staBtn('More…', 'neg', r.key, 'dim sm', 'Open the full dialog: type, level, sales at risk') + '</div></td>';
  }
  if (n === 'iso') return `<td class="sta-next"><small>Own exact keyword at <b>${staMoney(r.isoBid)}</b> (CPC ${staMoney(r.cpc)}) · negative exact in this ad group</small>${staBtn('Lower bid for this term', 'iso', r.key)}</td>`;
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
  // A hold can still be overruled with a lower bid on its keyword: the person decides.
  const canLower = g && g.cpc > 0 && r.type !== 'word' && r.cat !== 'check' && !g.rl && !(STM && STM.info[r.brand] && STM.info[r.brand].stale)
    && !(r.status === 'In review' || r.status === 'Negated');
  return `<td class="sta-next"><span class="sta-hold">${r.hold ? 'Hold · ' + staEsc(r.hold.replace(/<[^>]+>/g, '')) : 'No change needed'}</span>`
    + (canLower ? staBtn('Lower bid anyway', 'reduce', g.key, 'dim sm', 'Lower the bid on ' + staPathLabel(g.kw, g.mt) + ' anyway — it moves every search term of that keyword') : '') + '</td>';
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
  const beB = rows.filter(r => r.kind === 'be' && r.beBrand).length, be = rows.filter(r => r.kind === 'be' && !r.beBrand).length;
  const loss = rows.filter(r => r.kind === 'loss').length;
  staHead('Which search terms are burning money?', `${staInt(rows.length)} terms: ${staInt(none)} with no sales${loss ? `, ${staInt(loss)} over 100% ACoS` : ''}${be ? `, ${staInt(be)} above break-even` : ''}${beB ? `, ${staInt(beB)} brand term${beB === 1 ? '' : 's'} over the ${STA.BRAND_TGT}% brand-term limit` : ''}${poor ? `, ${staInt(poor)} converting at under half the normal rate` : ''}.`
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
    const ev = `${staInt(g.o)} order${g.o === 1 ? '' : 's'} in <b>${staInt(g.c)} clicks</b> · ROAS <b>${g.sp > 0 ? (g.s / g.sp).toFixed(2) : '—'}</b>`
      + (g.beUse ? ` · break-even ${staRoas(g.beUse)}` : '') + (g.kind === 'poor' ? ' · converts at under half the usual rate' : '');
    const tip = g.kind === 'none' && g.chance != null && p ? `0 orders in ${g.c} clicks happens only ${(g.chance * 100).toFixed(1)}% of the time at ${(p * 100).toFixed(1)}% (${g.rate.w}).`
      : g.kind === 'loss' ? `${staMoney(g.sp)} of ads for ${staMoney(g.s)} of sales: every sale costs more in ads than it brings, whatever the unit cost.`
      : g.kind === 'be' ? `ACoS ${staPct(g.acos)} vs break-even ${staPct(g.beUse)}: ${staMoney(g.burned)} over.`
        : g.kind === 'poor' ? `Under half ${g.rate.w}'s rate; ACoS ${staPct(g.acos)} over target ${staPct(g.tgtUse)}.` : (g.hold || '');
    const v = Object.assign({}, g, { badges: [[g.cat === 'watch' ? 'Watch' : g.kind === 'none' ? 'No sales' : g.kind === 'loss' ? 'Above 100% ACoS' : g.kind === 'be' ? (g.beBrand ? 'Above brand limit' : 'Above break-even') : 'Converts poorly', g.cat === 'watch' ? 'warn' : 'bad', tip]], ev: g.cat === 'watch' ? (g.hold || ev) : ev,
      status: g.rl ? 'In review' : 'Active', act: !!(g.next && !/limit|lowstock/.test(g.next) && !g.rl), tags: [] });
    if (g.noPause && g.next === 'reduce' && g.kind === 'none') v.protectNote = `A ${g.noPause}: lowered, never paused`;
    else if (g.softNote && g.next === 'reduce') v.protectNote = g.softNote;
    return `<tr${ST_SEL.has(g.key) ? ' class="sel"' : ''}>
      <td class="sta-stick">${staTick(v)}<div class="sta-tc"><div class="sta-term">${staEsc(staPathLabel(g.kw, g.mt))}</div><div class="sta-under">${staBadge(staBrandName(g.brand), 'brand-' + g.brand)}</div></div></td>
      ${staVerdictCell(v, true)}${staNextCell(v)}
      <td class="num sta-money">${g.cat === 'burn' ? staMoney(g.burned) : staDash}</td>
      <td class="num">${staMoney(g.sp)}${staUp(g, 'sp', true)}</td><td class="num">${staInt(g.o)}${staUp(g, 'o')}</td><td class="num">${staInt(g.c)}${staUp(g, 'c')}</td>
      <td class="num">${g.acos != null ? staPct(g.acos) : staDash}</td>
      ${staPathCell(g, true)}</tr>`;
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
  const scB = rows.filter(r => r.scaleBrand).length;
  staHead('Which search terms are worth scaling?', `${staInt(rows.length)} terms sell under their target ACoS with enough orders: ${STA.SCALE_ORDERS}+ to raise a bid, ${STA.EXACT_ORDERS}+ to add as exact.`
    + (scB ? ` ${scB === rows.length ? 'All' : staInt(scB)} of them ${scB === 1 ? 'is a brand term' : 'are brand terms'}, judged against the ${STA.BRAND_TGT}% brand-term limit${staNoTarget() ? ' — the only target that works without unit costs' : ''}.` : '')
    + ' The ceiling is the CPC that would land on target, capped at twice today\'s CPC.');
  const body = page.map(r => {
    const under = r.tgtUse - r.acos;
    const v = Object.assign({}, r, { ev: `<b>${staPct(r.acos)}</b> ACoS, ${under.toFixed(1)} pts under ${staPct(r.tgtUse)}${r.scaleBrand ? ' (brand-term limit)' : r.ln.fallback ? ' (your setting)' : ''} · CPC ${staMoney(r.cpc)} → ceiling ${staMoney(r.ceil)}` });
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
      + ` · ${staEsc((g.lead.parents[0] || g.lead.asins[0] || '').toUpperCase())} · overlap cost <em>${staMoney(sum)}</em>${g.provisional ? ' · <b class="sta-prov" title="No unit cost for this product: the lead is the lowest ACoS with 3+ orders, not proven profitable">provisional lead</b>' : ''}</span></td></tr>`;
    ps.forEach(r => {
      const lead = r.role === 'lead', fine = r.role === 'fine';
      const txt = lead ? `Keep: sells it best for this product (${staInt(r.o)} orders at ${staPct(r.acos)}${r.own ? ', its own exact keyword' : ''})${g.provisional ? ' — provisional, no unit cost to prove it profitable' : ''}.`
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
  staPager(groups.length, 'terms', 'without a unit cost or target, the lead is provisional: the lowest ACoS with 3+ orders, and only clearly worse paths are routed to it');
}

// Can this term safely be a negative PHRASE where it ran? Not when it is protected, or when a longer term containing it
// sold in the same campaign (a phrase negative would block that too). { ok, why }.
// Selling rows, indexed once per model (20 Nov, speed): the phrase and same-campaign checks scanned all ~20,000 rows for
// every row drawn. byCp: brand|campaign → its selling terms (normalised, padded); byTk: brand|term|campaign → ad groups.
function staSoldIdx(M) {
  if (M._sold) return M._sold;
  const byCp = new Map(), byTk = new Map();
  M.rows.forEach(x => {
    if (!(x.o > 0)) return;
    const k = x.brand + '|' + x.cid;
    (byCp.get(k) || byCp.set(k, []).get(k)).push({ r: x, n: ' ' + staNorm(x.term) + ' ' });
    const t = x.brand + '|' + x.tk + '|' + x.cid;
    (byTk.get(t) || byTk.set(t, new Set()).get(t)).add(x.ag);
  });
  return (M._sold = { byCp, byTk });
}
function staPhraseOk(r) {
  if (r.noNeg || r.main) return { ok: false, why: r.noNeg || 'main keyword' };
  if (r.containsProduct) return { ok: false, why: 'it contains a product word, so it would block searches that sell' };
  if (r.term.trim().split(/\s+/).length > STA.NEG.negativePhrase.words) return { ok: false, why: `phrase negatives take at most ${STA.NEG.negativePhrase.words} words` };
  const M = STM || staModel();
  const pat = ' ' + staNorm(r.term) + ' ';
  const hit = (staSoldIdx(M).byCp.get(r.brand + '|' + r.cid) || []).find(y => y.r !== r && y.n.includes(pat));
  return hit ? { ok: false, why: `"${hit.term}" contains it and sold ${hit.o} order${hit.o === 1 ? '' : 's'} in this campaign` } : { ok: true, why: '' };
}
// One click from the row: negative exact (or ASIN), or phrase, after staQuick's checks.
async function staQuickNeg(key, phrase, btn) {
  const M = staModel();
  const r = M.byKey.get(key);
  if (!r) return;
  const q = staQuick(r);
  if (q.skip) { stFoot(`<span>Not added: "${staEsc(r.term)}" — ${staEsc(q.skip)}.</span>`, true); return; }
  let items = q.items;
  if (phrase) {
    const ph = staPhraseOk(r);
    if (!ph.ok) { stFoot(`<span>No phrase negative for "${staEsc(r.term)}": ${staEsc(ph.why)}.</span>`, true); return; }
    const lvl = items[0] && items[0].neg ? items[0].neg.level : 'cp';
    items = [staNegItem(r, 'negativePhrase', lvl)];
  }
  if (btn) btn.disabled = true;
  try { for (const it of items) await staRlSave(it); } catch (e) { stFoot(`<span>Could not add it: ${staEsc(e.message || e)}</span>`, true); return; }
  STM = null;
  renderSt();
  staAddedFoot(items, `Added a ${phrase ? 'negative phrase' : r.asin ? 'negative ASIN target' : 'negative exact'} for "${staEsc(r.term)}" to the review list.`);
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
      '<b>Data check</b>: a row with orders but no sales, or sales without a click, is left out of every verdict (still counted in the totals). More orders than clicks is normal with 7-day attribution: kept, judged, tagged.',
      `<b>Incomplete data</b>: a brand with no search terms, or ones older than ${STA.STALE_H} hours, gets no suggestions.`,
      `<b>30 days first</b>: judged from the start date + ${STA.AGE_DAYS} days (Day ${STA.AGE_DAYS + 1}), the same rule for a new campaign, keyword or target (Amazon's start date) and a new product (the last day of its first week with ad spend — the weekly figures give only the week).`,
      `<b>Launch / ranking campaigns</b> (by their name): left alone for ${STA.LAUNCH_DAYS} days from their start, then judged like any other.`,
      `<b>No unit cost</b>: no profit verdict — only "no sales", and brand terms against the ${STA.BRAND_TGT}% brand-term limit — unless a target ACoS is set for the brand in Lists & settings.`])
    + L('Never a negative on', [
      '<b>Brand terms</b> (Lists & settings, and keywords in campaigns named "brand"): held to the ' + STA.BRAND_TGT + '% brand-term limit, with or without unit costs — over it they show as "Above brand limit", well under it as worth scaling.',
      '<b>Own and sister-brand ASINs</b>: defence placements, never negated or scaled.',
      '<b>Product words</b>: what the ad group sells — found in the titles and the campaign and ad-group names, plus your list.',
      `<b>Main keywords</b>: your own keywords for that product, or terms with ${STA.MAIN_ORDERS}+ orders. Only negated on a weaker path when its own exact keyword keeps the term.`,
      '<b>Seasonal terms</b>: never negated. In season (from six weeks before the peak) a lower bid at most; out of season, held.',
      'Instead: when its keyword loses as a whole (no sales, or over target), <b>a lower bid on that keyword</b>. When the keyword sells fine and only this term loses, <b>its own exact keyword at a lower bid</b> in another ad group of the same product, plus a negative exact in this ad group only — the term keeps showing, for less. Otherwise a stated hold.',
      '<b>Lower bid anyway</b> under any hold: your call, on the keyword that caught the term.'])
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
      `ACoS under ${STA.LOW_ACOS}% with 3+ orders is tagged "Very low ACoS" to look at, and judged like any other.`])
    + L('Competing paths', [
      'Only paths to the <b>same product</b> (the parent with the most ad sales in the ad group) compete.',
      `The lead has ${STA.LEAD_ORDERS}+ orders and ACoS under break-even; an own exact keyword first, then the lowest ACoS.`,
      'A path doing as well as the lead is never negated. Overlap cost = spend − sales × the lead\'s ACoS.',
      `No unit cost and no target: a <b>provisional</b> lead (${STA.LEAD_ORDERS}+ orders, the lowest ACoS), and only a path with no order, or at ${STA.PROV_GAP}× the lead's ACoS or worse, is sent to it.`])
    + L('Money at stake, brand split, one-click negatives', [
      '<b>Money at stake</b> (first in the strip): no-sales and above-limit spend plus overlap cost, each term counted once (the larger of the two), so the boxes add up to more. Overlap cost against a provisional lead shows apart, as "provisional".',
      '<b>Branded / non-branded / small terms / other</b>: four parts that add up to the ad spend. Small terms (under 3 clicks, no order) are not listed one by one; "other" is what the keyword report has and the search-term report does not. A <b>brand leak</b> is a brand term paid for in a campaign whose name has no brand term, "brand" or "defense".',
      '<b>Neg exact / Neg phrase</b> in the row add the change straight to the review list after the same checks as the dialog. Neg phrase is off when the term is protected, contains a product word, or a longer search containing it sold in the same campaign.'])
    + L('Next-step chips and New', [
      'The chips under the tabs show one kind of next step at a time — Negative, Lower bid, Pause, Add exact, Raise bid, Watch / hold, In review — with "Tick all" for every page.',
      `<b>New</b>: campaigns, products, keywords and targets in their first ${STA.AGE_DAYS} days, and launch campaigns in their first ${STA.LAUNCH_DAYS}, with the day they are on and the day Sellora starts judging them. Only warnings there: no order after 40 clicks (launch campaigns too), or above break-even so far.`])
    + L('Badges', ['<b>Promoted</b>: the term has its own exact keyword for this product elsewhere.', '<b>In review</b>: a change for it is in the review list.',
      '<b>Negated</b>: a negative is already in place.', '<b>Other products\' sales</b>: most of the ad sales were other products bought after the click — for the ad group, or for this one term (Amazon\'s same-product sales, else an order worth over 3× the product\'s price).',
      '<b>More orders than clicks</b>, <b>Very low ACoS</b>: worth a look, judged like any other.'])
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
  staDlgApplyNote();
  const where = `${staEsc(r.cn || '')} · ${staEsc(staBrandName(r.brand))}`;
  // The ad group only when its name says something the campaign's does not (often the two are the same).
  const whereAg = `${staEsc(r.cn || '')}${r.agn && r.agn !== r.cn ? ' · ad group ' + staEsc(r.agn) : ''} · ${staEsc(staBrandName(r.brand))}`;
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
    sub.innerHTML = `${whereAg}. Worked out from this keyword or target's own figures; the new bid moves every search term it catches.`;
    const cur = r.ent && r.ent.bid > 0 ? r.ent.bid : null;
    STD.cur = cur;
    const base0 = cur != null ? cur : r.cpc;
    // A cut is worked from what is actually paid when the bid is far above it (19 Nov audit); rounded toward the bid.
    const ref0 = !up && cur != null && r.cpc > 0 && r.cpc < cur ? r.cpc : base0;
    STD.ref = ref0;
    const sug = !up && base0 > 0 && !(r.sugBid > 0 && r.sugBid < base0) ? staBidRound(ref0 * (1 - STA.STEP), ref0) : r.sugBid;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stBidNew">New bid (USD)</label><input id="stBidNew" type="number" min="0.02" step="0.01" value="${sug ? sug.toFixed(2) : ''}"></div>
      <div class="sta-f"><label for="stBidCur">Current bid</label><input id="stBidCur" type="number" min="0.02" step="0.01" value="${cur != null ? cur.toFixed(2) : ''}"${cur != null ? ' disabled' : ' placeholder="From the Ads console"'}>
        ${cur == null ? `<small>Not read from Amazon yet: type it from the Ads console. A change can't be sent without it — worked from the CPC alone, a "lower" bid could end up above the real one.</small>`
          : r.cpc > 0 ? `<small>You pay ${staMoney(r.cpc)} a click on average${r.cpc < cur * (1 - STA.STEP) ? ' — far under the bid, so a cut is worked from that' : ''}.</small>` : ''}</div></div>
      <div id="stBidCalc" class="sta-calc"></div><div id="stDlgChecks" class="sta-checks"></div>`;
  } else if (kind === 'pause') {
    const isTgt = r.type === 'target';
    $('stDlgTitle').textContent = isTgt ? 'Pause ' + staPathLabel(r.kw, r.mt) : 'Pause the duplicate keyword';
    sub.innerHTML = isTgt ? `${whereAg}. Pausing stops every search term of this target; it can be turned back on.`
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
  } else if (kind === 'iso') {
    $('stDlgTitle').textContent = 'Lower the bid for this search term only';
    const g = r.tr;
    sub.innerHTML = `"${staEsc(r.term)}" is a ${r.noNeg ? staEsc(r.noNeg) : 'main keyword'}: never negated. Its keyword ${staEsc(staPathLabel(r.kw, r.mt))} sells`
      + `${g && g.acos != null ? ' at ' + staPct(g.acos) + ' ACoS' : ''} overall, so its bid stays. Amazon has no bid per search term, so this term gets its own exact keyword at a lower bid,`
      + ` and a negative exact in ${staEsc(r.agn || 'this ad group')} stops this ad group paying the old bid for it.`;
    const cands = staDestinations(r, false).filter(c => c.ag !== r.ag);
    STD.cands = cands;
    by.innerHTML = staFigs(r) + `<div class="sta-row2">
      <div class="sta-f"><label for="stExDest">New exact keyword in</label><select id="stExDest">${cands.length
        ? cands.map((c, i) => `<option value="${i}">${staEsc(c.cn)} · ${staEsc(c.agn)}</option>`).join('') : '<option value="">No other ad group fits</option>'}</select>
        <small>Manual keyword ad groups advertising the same product, the most exact-heavy first. Not ${staEsc(r.agn || 'this ad group')}: the negative goes there.</small></div>
      <div class="sta-f"><label for="stExBid">Its bid (USD)</label><input id="stExBid" type="number" min="0.02" step="0.01" value="${(r.isoBid || STA.MIN_BID).toFixed(2)}">
        <small>${r.o > 0 ? `CPC ${staMoney(r.cpc)} × target ${staPct(r.tgtUse)} ÷ ACoS ${staPct(r.acos)}` : `CPC ${staMoney(r.cpc)} − ${Math.round(STA.STEP * 100)}% (no sales)`}, at most ${Math.round(STA.STEP * 100)}% lower in one step.</small></div></div>
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
    // The figure a cut is measured from: what is actually paid when the bid is far above it (19 Nov audit).
    const ref = !up && cur && r.cpc > 0 && r.cpc < cur ? r.cpc : cur;
    if (!STD.cur && cur && !$('stBidNew').dataset.touched && r.acos > 0 && tgt) {
      const f = up ? Math.min(1 + STA.STEP, Math.max(1 - STA.STEP, tgt / r.acos)) : Math.max(1 - STA.STEP, Math.min(0.95, tgt / r.acos));
      $('stBidNew').value = staBidRound(ref * f, ref).toFixed(2);
    } else if (!STD.cur && cur && !$('stBidNew').dataset.touched && !(r.o > 0)) $('stBidNew').value = staBidRound(ref * (1 - STA.STEP), ref).toFixed(2);
    const nbv = Number($('stBidNew').value);
    STD.from = cur;
    STD.to = nbv;
    const base = ref || r.cpc;
    const byFormula = r.o > 0 && r.acos > 0 && tgt != null && (up ? tgt / r.acos > 1 : tgt / r.acos < 1);
    $('stBidCalc').innerHTML = `${cur && ref === cur ? 'The bid' : cur ? 'What you pay a click' : 'The CPC'} ${staMoney(base)} × ${byFormula ? `target ${staPct(tgt)} ÷ ACoS ${staPct(r.acos)}`
      : !(r.o > 0) ? `${Math.round((1 - STA.STEP) * 100)}% (no sales)` : `${Math.round((1 - STA.STEP) * 100)}% (a lower bid you asked for)`}, within ±${Math.round(STA.STEP * 100)}% a step.`
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
      // The 20% step is measured from what is paid when a cut starts from a bid far above it; the new bid must still be
      // below (or for a raise, above) the current bid itself.
      const step = nbv / (ref || cur) - 1, real = nbv / cur - 1;
      if ((up && real <= 0) || (!up && real >= 0)) bad(`The new bid is not ${up ? 'above' : 'below'} the current ${staMoney(cur)}.`);
      else if (Math.abs(step) > STA.STEP + 0.0001) bad(`${(step * 100).toFixed(1)}% ${ref !== cur ? `from what you pay (${staMoney(ref)}) ` : ''}is past the safety limit of ${Math.round(STA.STEP * 100)}% a step.`);
      else out.push(staCheck('ok', `Within the safety limit (${step > 0 ? '+' : ''}${(step * 100).toFixed(1)}%${ref !== cur ? ` from ${staMoney(ref)} a click; ${(real * 100).toFixed(0)}% off the bid` : ''})`));
    } else bad('Current bid not known: type it from the Ads console first.');
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
  } else if (kind === 'iso') {
    const c = STD.cands[Number($('stExDest').value)];
    STD.dest = c || null;
    STD.bid = Number($('stExBid').value);
    if (!c) bad('No other manual keyword ad group advertises this product. Create one (an exact campaign) in the Ads console first — or use "Lower bid anyway" on its keyword.');
    else {
      const there = (staTgtsOf(r.brand).rows || []).some(x => x.ag === c.ag && staKey(x.t) === r.tk && /^EXACT$/i.test(x.mt));
      if (there) bad(`${staEsc(c.agn)} already has this exact keyword: lower its bid there instead.`);
      else out.push(staCheck('ok', `${staEsc(c.agn)} has no exact keyword for it yet`));
    }
    const queued = ST_RL.items.some(x => (x.status === 'review' || x.status === 'approved' || x.status === 'exported') && x.brand === r.brand && staLow(x.term) === r.tl
      && ((x.kind === 'exact') || (x.kind === 'neg' && x.ag === r.ag)));
    if (queued) bad('This term is already in the review list.');
    const words = r.term.trim().split(/\s+/).length, chars = r.term.length;
    if (words > STA.KW.words || chars > STA.KW.chars) bad(`Too long for a keyword: ${words} words, ${chars} characters.`);
    if (!(STD.bid >= STA.MIN_BID)) bad(`The bid must be at least ${staMoney(STA.MIN_BID)}.`);
    else if (r.cpc > 0 && STD.bid >= r.cpc) out.push(staCheck('warn', `${staMoney(STD.bid)} is not below today's CPC ${staMoney(r.cpc)}: the term would cost the same.`));
    else if (r.cpc > 0 && STD.bid < r.cpc * (1 - STA.STEP) - 0.0001) out.push(staCheck('warn', `More than ${Math.round(STA.STEP * 100)}% under today's CPC ${staMoney(r.cpc)}: it may stop showing for it.`));
    else out.push(staCheck('ok', `${staMoney(STD.bid)} vs today's CPC ${staMoney(r.cpc)}`));
    const at = staNegAtAmazon(r.brand, 'ag|' + r.ag, r.term, 'nx');
    if (at) out.push(staCheck('warn', `A negative for it is already in ${staEsc(r.agn || 'this ad group')} at Amazon: only the new keyword is added.`));
    else out.push(staCheck('ok', `Negative exact "${staEsc(r.term)}" in ${staEsc(r.agn || 'this ad group')} only — every other ad group is left alone`));
    out.push(staCheck('ok', 'The term keeps showing: through its own exact keyword, at the lower bid'));
    const day = staDayCount(r.brand);
    if (!at && day >= STA.DAY_MAX) bad(`${day} negatives for ${staBrandName(r.brand)} added today already: the limit is ${STA.DAY_MAX} a day.`);
    STD.negAt = !!at;
    $('stDlgOk').textContent = at ? 'Add 1 change to review list' : 'Add 2 changes to review list';
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
  $('stDlgApply').disabled = block || !staApplyOn();
}

// When Sellora last sent a bid or state change for this path (exported or done), in ms; 0 when never.
// The last change Sellora made to a keyword or target: from when Amazon's record showed it (doneAt) — a download is not an
// upload (19 Nov audit) — or, while it is still out in a file and not seen yet, from the download.
function staLastChange(pathKey) {
  let t = 0;
  ST_RL.items.forEach(x => {
    if (!((x.kind === 'bid' || x.kind === 'pause') && x.pathKey === pathKey)) return;
    if (x.status === 'done' || x.status === 'applied') t = Math.max(t, x.doneAt || x.appliedAt || x.exportedAt || 0);
    else if (x.status === 'exported') t = Math.max(t, x.exportedAt || 0);
  });
  return t;
}
// Is an item matching f still open (waiting, approved, or out in a file and not seen at Amazon yet)?
const STA_OPEN_ST = ['review', 'approved', 'exported', 'applying'];
const staRlOpenFor = f => ST_RL.items.some(x => STA_OPEN_ST.includes(x.status) && f(x));
function staClose() {
  $('stDlg').classList.add('hide');
  STD = null;
}

// What "Apply at Amazon" still waits for, in the order it can happen (each step owned by someone outside this page).
function staApplySteps() {
  const c = ADS_CFG;
  return [
    { ok: !!(c.editor || c.on), s: 'Amazon edit permission (Editor role on the Ads login)', t: 'Amazon lets Sellora edit ads (the Ads login gets the Editor role)', who: 'Amazon Ads account admin' },
    { ok: !!(c.route || c.on), s: 'the backend Apply route', t: 'The backend\'s Apply and Undo route', who: 'Pricing-API team' },
    { ok: !!c.on, s: 'the Apply switch', t: 'Apply switched on (config/adsApply)', who: 'Ravi' },
    { ok: !!(ME.admin || ME.adsApply === true), s: 'your Apply right', t: 'Your Apply right (Access screen)', who: 'an admin' },
  ];
}
// The dialog's footer: the Apply button and one line on what it waits for (or what it will do).
function staDlgApplyNote() {
  const st = staApplySteps(), left = st.filter(s => !s.ok);
  const b = $('stDlgApply');
  b.disabled = !!left.length;
  b.title = left.length ? 'Waiting for: ' + left.map(s => s.t + ' — ' + s.who).join('; ') : 'Changes this at Amazon now, and keeps an undo';
  $('stDlgNote').innerHTML = left.length
    ? `<b>Apply at Amazon is locked</b> — waiting for ${left.map(s => staEsc(s.s)).join(', ')}. Until then: add it to the review list, approve, and upload the bulk file.`
    : `Apply changes it at Amazon now${ADS_CFG.dryRun ? ' — <b>dry run</b>: Amazon is only asked, nothing changes' : ''}, with an undo in the review list. Or add it to the review list to approve first.`;
}
// "Apply at Amazon" from the dialog: the same items as "Add to review list", approved by this person, then applied.
async function staDlgApply() {
  if (!STD || $('stDlgApply').disabled || $('stDlgOk').disabled) return;
  const items = staDlgItems();
  const me = String(ME.email || '');
  $('stDlgApply').disabled = $('stDlgOk').disabled = true;
  try {
    for (const it of items) Object.assign(it, { status: 'approved', approvedBy: me, approvedAt: Date.now(), note: 'Apply now' });
    for (const it of items) await staRlSave(it);
    const msg = await staApply(items);
    staClose();
    STM = null;
    renderSt();
    stFoot(`<span>${staEsc(msg)} <button type="button" class="sta-linkbtn" data-openrl="1">Open the review list</button></span>`, /failed|not|Nothing/.test(msg));
  } catch (e) {
    $('stDlgOk').disabled = false;
    staDlgApplyNote();
    $('stDlgChecks').insertAdjacentHTML('beforeend', staCheck('bad', 'Could not apply: ' + staEsc(e.message || e)));
  }
}
// The review items the open dialog stands for.
function staDlgItems() {
  const { kind, row: r } = STD;
  if (kind === 'neg') return [staNegItem(r, STD.type, STD.lvl)];
  if (kind.startsWith('bid:')) return [staBidItem(r, kind === 'bid:raise' ? 'up' : 'down', STD.from, STD.to)];
  if (kind === 'pause') return [staItem(r, 'pause', { what: 'Pause', why: r.type === 'target' ? `0 orders in ${staInt(r.c)} clicks` : `Duplicate exact keyword · lead path at ${staPct(r.leadAcos)} ACoS` })];
  if (kind === 'word') return staWordItems(r, STD.picks);
  if (kind === 'iso') return staIsoItems(r, STD.dest, STD.bid, STD.negAt);
  return [staExactItem(r, kind, STD.dest, STD.bid)];
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
  else if (kind === 'iso') items = staIsoItems(r, STD.dest, STD.bid, STD.negAt);
  else items = [staExactItem(r, kind, STD.dest, STD.bid)];
  $('stDlgOk').disabled = true;
  try {
    for (const it of items) await staRlSave(it);
    staClose();
    STM = null;
    renderSt();
    staAddedFoot(items, `Added ${items.length === 1 ? staEsc(staKindName(items[0])) + ' · ' + staEsc(items[0].term || items[0].target) : items.length + ' changes'} to the review list.`);
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
  // Every open item (waiting, approved, out in a file, being applied) plus 60 days of finished ones — not just the newest
  // 500 (19 Nov audit) — and kept live, so two people never approve or download the same change twice.
  try {
    const col = collection(db, 'adsActions'), since = Date.now() - 60 * 86400000;
    const [a, b] = await Promise.all([getDocs(query(col, where('status', 'in', STA_OPEN_ST))),
      getDocs(query(col, where('at', '>=', since), orderBy('at', 'desc')))]);
    const m = new Map();
    [a, b].forEach(s => s.docs.forEach(d => m.set(d.id, Object.assign({}, d.data(), { id: d.id }))));
    ST_RL.items = [...m.values()].sort((p, q) => (q.at || 0) - (p.at || 0));
    ST_RL.where = 'fs';
    ST_RL.err = '';
    staRlListen();
  } catch (e) {
    ST_RL.where = 'local';
    ST_RL.err = String((e && (e.code || e.message)) || e);
    try { ST_RL.items = JSON.parse(localStorage.getItem(STA_LOCAL) || '[]'); } catch (x) { ST_RL.items = []; }
  }
  ST_RL.stamp++;
}
// Live: what anyone else adds, approves, downloads or removes shows here within seconds.
let STA_RL_LIVE = null, STA_RL_LIVE_T = 0;
function staRlListen() {
  if (STA_RL_LIVE || typeof onSnapshot !== 'function') return;
  try {
    const col = collection(db, 'adsActions'), since = Date.now() - 60 * 86400000;
    const on = s => {
      let changed = false;
      (s.docs || []).forEach(d => {
        const v = Object.assign({}, d.data(), { id: d.id });
        const i = ST_RL.items.findIndex(x => x.id === v.id);
        if (i < 0) { ST_RL.items.unshift(v); changed = true; }
        else if ((ST_RL.items[i].up || 0) < (v.up || 0) || ST_RL.items[i].status !== v.status) { ST_RL.items[i] = v; changed = true; }
      });
      if (!changed) return;
      ST_RL.stamp++;
      staRlBadge();
      clearTimeout(STA_RL_LIVE_T);
      STA_RL_LIVE_T = setTimeout(() => {
        if (!$('stRl').classList.contains('hide') && !ST_RL.preview) staRlDraw();
        STM = null;
        if ($('paneSt') && !$('paneSt').classList.contains('hide') && $('stDlg').classList.contains('hide')) renderSt();
      }, 700);
    };
    STA_RL_LIVE = [query(col, where('status', 'in', STA_OPEN_ST)), query(col, where('at', '>=', since), orderBy('at', 'desc'))]
      .map(q => onSnapshot(q, on, () => { /* the list stays as last read */ }));
  } catch (e) { STA_RL_LIVE = null; }
}
// Save one item. A failed save is an error the person sees — never a quiet switch to "this browser only" for the rest of
// the session (19 Nov audit). This browser is used only when the shared list could not be read at all.
async function staRlSave(it) {
  it.up = Date.now();
  const clean = JSON.parse(JSON.stringify(it));
  delete clean.id;
  if (ST_RL.where === 'fs') await setDoc(doc(db, 'adsActions', it.id), clean);
  const i = ST_RL.items.findIndex(x => x.id === it.id);
  if (i >= 0) ST_RL.items[i] = it; else ST_RL.items.unshift(it);
  if (ST_RL.where === 'local') {
    try { localStorage.setItem(STA_LOCAL, JSON.stringify(ST_RL.items.slice(0, 1500))); } catch (e) { throw new Error('this browser would not store it'); }
  }
  ST_RL.stamp++;
}
// Move one item to a new status only if it is still in one of `from` — inside a transaction at the shared list, so a
// change someone else made meanwhile wins and is reported. Returns '' when done, else why not.
async function staRlMove(x, from, patch) {
  const fromTxt = s => ({ review: 'waiting', approved: 'approved', exported: 'downloaded', done: 'done', removed: 'removed', applied: 'applied' }[s] || s);
  if (ST_RL.where !== 'fs') {
    if (!from.includes(x.status)) return `it is ${fromTxt(x.status)} now`;
    Object.assign(x, patch);
    try { await staRlSave(x); return ''; } catch (e) { return 'could not save: ' + (e.message || e); }
  }
  try {
    const ref = doc(db, 'adsActions', x.id);
    const res = await runTransaction(db, async tx => {
      const s = await tx.get(ref);
      const cur = s.exists() ? s.data() : null;
      if (!cur) return 'it is no longer in the list';
      if (!from.includes(cur.status)) { Object.assign(x, cur); return `someone made it ${fromTxt(cur.status)} meanwhile`; }
      const next = Object.assign({}, cur, patch, { up: Date.now() });
      tx.set(ref, next);
      return '';
    });
    if (!res) Object.assign(x, patch, { up: Date.now() });
    ST_RL.stamp++;
    return res;
  } catch (e) { return 'could not save: ' + String((e && (e.code || e.message)) || e); }
}
// The name of the person behind an email: the part before @ (it@ is the shared office login).
const staWho = e => { const s = String(e || '').split('@')[0]; return s ? s[0].toUpperCase() + s.slice(1) : ''; };
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
  const why = r.kind === 'none' ? `0 orders in ${staInt(r.c)} clicks · ${staMoney(r.sp)} spent`
    : r.kind === 'loss' ? `ACoS ${staPct(r.acos)}: ads cost more than the sales`
    : r.kind === 'be' ? `ACoS ${staPct(r.acos)} vs ${r.beBrand ? 'the brand limit' : 'break-even'} ${staPct(r.beUse)}` : r.kind === 'poor' ? `${staInt(r.o)} orders in ${staInt(r.c)} clicks, under half the normal rate`
      : r.role === 'other' ? `Competing path · ${staMoney(r.excess)} overlap cost; lead at ${staPct(r.leadAcos)}` : `ACoS ${staPct(r.acos)}`;
  return staItem(r, 'neg', { neg: { type, level }, what: (type === 'na' ? 'Negative ASIN target' : STA.NEG[type].t) + ' · ' + (level === 'cp' ? 'campaign level' : 'ad-group level'), why });
}
function staBidItem(g, dir, from, to) {
  return staItem(g, 'bid', {
    bid: { from: from || null, to: staR2(to), dir, base: from ? 'bid' : 'cpc', cpc: g.cpc ? staR2(g.cpc) : null },
    what: from ? `${staMoney(from)} → ${staMoney(to)}` : `New bid ${staMoney(to)} (CPC ${staMoney(g.cpc)})`,
    why: g.kind === 'none' ? `0 orders in ${staInt(g.c)} clicks · ${staMoney(g.sp)} spent` : g.kind === 'loss' ? `ACoS ${staPct(g.acos)}: ads cost more than the sales`
      : `ACoS ${staPct(g.acos)} vs ${dir === 'up' ? 'target ' + staPct(g.tgtUse) : 'break-even ' + staPct(g.beUse)}`,
  });
}
function staExactItem(r, kind, c, bid) {
  return staItem(r, kind, { dest: { ag: c.ag, cid: c.cid, cn: c.cn, agn: c.agn }, newBid: staR2(bid),
    what: `New ${kind === 'asinT' ? 'ASIN target' : 'exact keyword'} at ${staMoney(bid)} in ${c.agn}`,
    why: `${staInt(r.o)} orders at ACoS ${staPct(r.acos)} through ${staPathLabel(r.kw, r.mt)}` });
}
// A protected term's lower bid of its own: an exact keyword at the lower bid elsewhere, and a negative exact in this ad group.
function staIsoItems(r, c, bid, negAt) {
  const ex = staExactItem(r, 'exact', c, bid);
  ex.what = `New exact keyword at ${staMoney(bid)} in ${c.agn} (lower bid for this term)`;
  ex.why = `${r.noNeg || 'Main keyword'}, never negated · ${staInt(r.o)} orders in ${staInt(r.c)} clicks at CPC ${staMoney(r.cpc)}`;
  if (negAt) return [ex];
  const ng = staNegItem(r, 'negativeExact', 'ag');
  ng.why = `Moved to its own exact keyword at ${staMoney(bid)} in ${c.agn}`;
  return [ex, ng];
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
  if (x.kind === 'plc') return x.plc.to > x.plc.from ? 'Raise placement' : 'Lower placement';
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
    const ags = staSoldIdx(M).byTk.get(r.brand + '|' + r.tk + '|' + r.cid);
    const sameCp = !!ags && (ags.size > 1 || !ags.has(r.ag));
    const level = r.asin || sameCp || r.pathLevel === 'ag' ? 'ag' : 'cp';
    const type = r.asin ? 'na' : 'negativeExact';
    if (!r.asin && (r.term.trim().split(/\s+/).length > 10 || r.term.length > 80)) return { skip: 'too long' };
    if (staNegAtAmazon(r.brand, level === 'cp' ? 'cp|' + r.cid : 'ag|' + r.ag, r.term, r.asin ? 'na' : 'nx')) return { skip: 'already negated' };
    if (staDayCount(r.brand) >= STA.DAY_MAX) return { skip: 'day\'s limit reached' };
    if (staRlOpenFor(x => x.kind === 'neg' && x.key === r.key)) return { skip: 'already in the review list' };
    return { items: [staNegItem(r, type, level)] };
  }
  // The same checks as the dialogs (19 Nov audit: tick-all skipped them): duplicates, the wait after a change, a known bid.
  const g = r.type === 'target' ? r : r.tr;
  if ((n === 'reduce' || n === 'raise') && g && g.sugBid) {
    if (staRlOpenFor(x => x.pathKey === g.pathKey && (x.kind === 'bid' || x.kind === 'pause'))) return { skip: 'already in the review list' };
    if (!(g.ent && g.ent.bid > 0)) return { skip: 'current bid not read from Amazon yet (open it to type the bid)' };
    const last = staLastChange(g.pathKey);
    if (last && Date.now() - last < STA.COOLDOWN * 86400000) return { skip: `bid changed ${staDay(last)}, wait ${STA.COOLDOWN} days` };
    return { items: [staBidItem(g, n === 'raise' ? 'up' : 'down', g.ent.bid, g.sugBid)] };
  }
  if (n === 'pause') {
    if (r.noPause) return { skip: r.noPause };
    if (staRlOpenFor(x => x.pathKey === r.pathKey && (x.kind === 'bid' || x.kind === 'pause'))) return { skip: 'already in the review list' };
    return { items: [staItem(r, 'pause', { what: 'Pause', why: r.type === 'target' ? `0 orders in ${staInt(r.c)} clicks · ${staMoney(r.sp)} spent` : 'Duplicate exact keyword' })] };
  }
  if (n === 'exact' || n === 'asinT') {
    const c = staDestinations(r, n === 'asinT')[0];
    if (!c) return { skip: 'no ad group to add it to' };
    if (staRlOpenFor(x => (x.kind === 'exact' || x.kind === 'asinT') && x.key === r.key)) return { skip: 'already in the review list' };
    if (!r.asin && (r.term.trim().split(/\s+/).length > STA.KW.words || r.term.length > STA.KW.chars)) return { skip: 'too long for a keyword' };
    return { items: [staExactItem(r, n, c, r.sugBid)] };
  }
  if (n === 'iso') {
    const c = staDestinations(r, false).filter(x => x.ag !== r.ag)[0];
    if (!c) return { skip: 'no other ad group for its own exact keyword' };
    const at = staNegAtAmazon(r.brand, 'ag|' + r.ag, r.term, 'nx');
    if (!at && staDayCount(r.brand) >= STA.DAY_MAX) return { skip: 'day\'s limit reached' };
    return { items: staIsoItems(r, c, r.isoBid, !!at) };
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
    } else if (x.kind === 'plc') {
      const c = (ST.ent && ST.ent.d && ST.ent.d[x.brand] && ST.ent.d[x.brand].cp || {})[x.cid];
      seen = !!c && Number(c[x.plc.ix]) === Number(x.plc.to);
    } else if (x.kind === 'exact') seen = E.kw.has(x.dest.ag + '|' + staLow(x.term) + '|exact');
    else if (x.kind === 'asinT') seen = E.tg.has(x.dest.ag + '|asin="' + staLow(x.term) + '"');
    else {
      const hit = staEntOf(x.brand, x.ag, x.kw, x.mt);
      seen = !!hit && (x.kind === 'pause' ? /PAUSED/i.test(hit.st || '') : Math.abs((hit.bid || 0) - x.bid.to) < 0.005);
    }
    if (seen) jobs.push(staRlMove(x, ['exported'], { status: 'done', doneAt: Date.now() }));
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
// Open: waiting and approved (and any apply that failed). Downloaded and done: by bulk file, each with Download again and
// Undo this file; a file not seen at Amazon after 3 days says so. Removed: Restore. (19 Nov audit.)
function staRlDraw() {
  if (ST_RL.preview) return staPreview();
  const tab = ST_RL.tab;
  $('stRlTitle').textContent = 'Review list';
  $('stRlSeg').classList.remove('hide');
  $('stRlBack').classList.add('hide');
  const showB = (id, on) => { if ($(id)) $(id).classList.toggle('hide', !on); };
  showB('stRlRemove', tab === 'open'); showB('stRlApprove', tab === 'open'); showB('stRlUnapprove', tab === 'open');
  showB('stRlRestore', tab === 'removed'); showB('stRlCancel', tab === 'done'); showB('stRlDl', tab === 'open'); showB('stRlApply', tab === 'open');
  $('stRlSeg').querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x.dataset.r === tab));
  const inTab = x => tab === 'open' ? ['review', 'approved', 'failed'].includes(x.status)
    : tab === 'done' ? ['exported', 'done', 'applied', 'applying', 'undone'].includes(x.status) : x.status === 'removed';
  const list = ST_RL.items.filter(inTab);
  const open = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved');
  const appr = open.filter(x => x.status === 'approved').length;
  const unseen = ST_RL.items.filter(staNotSeen).length;
  $('stRlSub').textContent = `${open.length} change${open.length === 1 ? '' : 's'} waiting${appr ? `, ${appr} approved` : ''}`
    + (unseen ? ` · ${unseen} downloaded but not seen at Amazon` : '') + '. Each keeps the figures it was based on.';
  const age = x => Math.floor((Date.now() - (x.exportedAt || 0)) / 86400000);
  const chip = x => x.status === 'review' ? staBadge('Waiting') : x.status === 'approved' ? staBadge('Approved', 'ok')
    : x.status === 'failed' ? staBadge('Apply failed', 'bad', x.err || '')
    : x.status === 'exported' ? (staNotSeen(x) ? staBadge(`Not seen at Amazon · ${age(x)} days`, 'warn', 'Downloaded, but Amazon\'s record does not show it yet. Was the file uploaded? Download again, or cancel it.')
      : staBadge('In bulk file · ' + staDay(x.exportedAt), 'info'))
    : x.status === 'done' ? staBadge('Done · seen at Amazon', 'ok') : x.status === 'applied' ? staBadge('Applied · ' + staDay(x.appliedAt), 'ok')
    : x.status === 'undone' ? staBadge('Undone', 'warn') : staBadge('Removed', 'warn');
  const when = x => `${staEsc(x.by || staWho(x.byEmail))}<br>${new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const tickable = x => tab === 'open' || tab === 'removed' || (tab === 'done' && x.status === 'exported');
  const row = x => {
    const blocked = staBulkRow(x).skip;
    const clash = tab === 'open' && x.status === 'approved' ? staClashOf(x) : '';
    return `<tr${clash ? ' class="sta-clash"' : ''}>
      <td>${tickable(x) ? `<input type="checkbox" class="sta-cb" data-rl="${staEsc(x.id)}"${ST_RL.sel.has(x.id) ? ' checked' : ''} aria-label="Select">` : ''}</td>
      <td><b>${staEsc(staKindName(x))}</b><small class="sta-s">${staEsc(staBrandName(x.brand))}</small></td>
      <td class="sta-term">${staEsc(x.neg && x.neg.type === 'na' ? String(x.term).toUpperCase() : x.term || x.target)}${x.term && x.kind !== 'neg' ? `<small class="sta-s">${staEsc(x.target)}</small>` : ''}</td>
      <td class="sta-rlcp" title="${staEsc(x.cn + ' · ' + x.agn)}">${staEsc(x.cn)}<small class="sta-s">${staEsc(x.agn)}</small></td>
      <td class="sta-rlwhat">${staEsc(x.what || '')}${blocked && tab === 'open' ? `<small class="sta-s" style="color:var(--rev-ink);white-space:normal">${staEsc(blocked)}</small>` : ''}${clash ? `<small class="sta-s sta-clashtxt">Clash: ${staEsc(clash)}</small>` : ''}</td>
      <td class="sta-ev">${staEsc(x.why || '')}<br><span class="sta-dash">${staInt(x.ev.c)} clicks · ${staMoney(x.ev.sp)} · ${staInt(x.ev.o)} orders</span></td>
      <td style="color:var(--muted)">${when(x)}${x.approvedBy ? `<small class="sta-s">approved by ${staEsc(staWho(x.approvedBy))}</small>` : ''}</td>
      <td>${chip(x)}</td></tr>`;
  };
  let body = '';
  if (tab === 'done') {
    // One group per bulk file (items downloaded before batches existed: one group of their own).
    const groups = new Map();
    list.forEach(x => { const k = x.batch || (x.status === 'applied' || x.status === 'applying' ? 'applied' : 'old'); (groups.get(k) || groups.set(k, []).get(k)).push(x); });
    body = [...groups.entries()].sort((p, q) => (q[1][0].batchAt || q[1][0].exportedAt || 0) - (p[1][0].batchAt || p[1][0].exportedAt || 0)).map(([k, xs]) => {
      const f = xs[0], seen = xs.filter(x => x.status === 'done').length, und = xs.filter(x => x.status === 'undone').length;
      const head = k === 'old' ? 'Downloaded earlier (before files were kept)' : k === 'applied' ? 'Applied at Amazon from Sellora'
        : `Bulk file · ${new Date(f.batchAt || f.exportedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · by ${staEsc(staWho(f.batchBy || f.exportedBy))}`;
      return `<tr class="sta-batch"><td></td><td colspan="5"><b>${head}</b> <span class="sta-dash">${xs.length} change${xs.length === 1 ? '' : 's'} · ${seen} seen at Amazon${und ? ` · ${und} undone` : ''}</span></td>
        <td colspan="2" class="sta-batchbtns">${k !== 'old' && k !== 'applied' ? `<button type="button" class="sta-btn sm" data-rlredl="${staEsc(k)}">Download again</button>` : ''}
        <button type="button" class="sta-btn sm" data-rlundo="${staEsc(k)}" title="A bulk file that puts these changes back as they were">Undo this file</button></td></tr>` + xs.map(row).join('');
    }).join('');
  } else body = list.map(row).join('');
  $('stRlTable').innerHTML = `<thead><tr><th style="width:28px">${tab !== 'done' ? '<input type="checkbox" class="sta-cb" data-rlall="1" aria-label="Select all">' : ''}</th><th>Change</th><th>Search term / target</th>
    <th>Campaign</th><th>What changes</th><th>Why</th><th>Added</th><th>Status</th></tr></thead><tbody>`
    + (body || `<tr><td colspan="8" class="muted" style="padding:14px 22px">${tab === 'open' ? 'Nothing waiting. Pick a change from any view.' : 'Nothing here yet.'}</td></tr>`) + '</tbody>';
  const note = $('stRlNote');
  note.classList.toggle('warn', ST_RL.where === 'local');
  note.innerHTML = (ST_RL.where === 'local'
    ? '<b>Kept in this browser only.</b> The shared review list needs its database rule (Ravi: adsActions in firestore.rules). Until then nobody else sees these, and clearing the browser loses them. '
    : '') + (tab === 'done' ? 'A change counts as done when Amazon\'s own record shows it (read twice a day) — a download alone is not an upload. "Undo this file" builds a bulk file that puts every change in it back.'
    : (staApplyOn() ? `"Apply approved" changes them at Amazon now${ADS_CFG.dryRun ? ' (dry run: nothing changes yet)' : ''}; or download them` : '<b>Apply at Amazon is locked</b> — waiting for ' + staApplySteps().filter(s => !s.ok).map(s => staEsc(s.s) + ' (' + staEsc(s.who) + ')').join(', ') + '. Until then approved changes download')
      + ' as an Amazon bulk file, one per brand, to upload in the Ads console (Campaign manager → Bulk operations). You see every row before it downloads.');
  staRlSelTxt();
}
// Downloaded more than 3 days ago and still not seen in Amazon's record.
const staNotSeen = x => x.status === 'exported' && Date.now() - (x.exportedAt || 0) > 3 * 86400000;
// Two approved changes that fight each other (19 Nov audit): a bid change and a pause on the same keyword or target; a
// negative and a new exact keyword for the same term in the same ad group. '' when none.
function staClashOf(x) {
  const appr = ST_RL.items.filter(y => y !== x && (y.status === 'approved' || y.status === 'exported') && y.brand === x.brand);
  if ((x.kind === 'bid' || x.kind === 'pause') && x.pathKey) {
    const o = appr.find(y => (y.kind === 'bid' || y.kind === 'pause') && y.pathKey === x.pathKey);
    if (o) return `${staKindName(o)} on the same ${x.kw ? 'keyword' : 'target'} too — keep one`;
  }
  if (x.kind === 'neg' || x.kind === 'exact' || x.kind === 'asinT') {
    const t = staLow(x.term), ag = x.kind === 'neg' ? x.ag : x.dest && x.dest.ag;
    const o = appr.find(y => staLow(y.term) === t && ((x.kind === 'neg') !== (y.kind === 'neg')) && (y.kind === 'neg' || y.kind === 'exact' || y.kind === 'asinT')
      && (y.kind === 'neg' ? (y.neg.level === 'cp' ? y.cid === (x.dest || x).cid : y.ag === ag) : (y.dest && (x.neg && x.neg.level === 'cp' ? y.dest.cid === x.cid : y.dest.ag === ag))));
    if (o) return `a ${o.kind === 'neg' ? 'negative' : 'new keyword'} for the same term where this ${x.kind === 'neg' ? 'negative' : 'keyword'} goes — keep one`;
  }
  return '';
}
function staRlSelTxt() {
  const sel = [...ST_RL.sel].map(id => ST_RL.items.find(x => x.id === id)).filter(Boolean);
  const ready = ST_RL.items.filter(x => x.status === 'approved' && !staBulkRow(x).skip).length;
  const tab = ST_RL.tab, nRev = sel.filter(x => x.status === 'review').length, nAp = sel.filter(x => x.status === 'approved').length;
  $('stRlSel').textContent = tab === 'done' ? (sel.length ? `${sel.length} selected` : 'Tick downloads that were never uploaded to cancel them.')
    : tab === 'removed' ? (sel.length ? `${sel.length} selected` : 'Tick changes to put them back on the list.')
    : sel.length ? `${sel.length} selected` : 'Tick changes to approve or remove them.';
  $('stRlApprove').textContent = nRev ? `Approve ${nRev}` : 'Approve';
  $('stRlApprove').disabled = tab !== 'open' || !nRev;
  if ($('stRlUnapprove')) { $('stRlUnapprove').textContent = nAp ? `Un-approve ${nAp}` : 'Un-approve'; $('stRlUnapprove').disabled = !nAp; }
  if (!$('stRlRemove').dataset.arm) $('stRlRemove').textContent = sel.length ? `Remove ${sel.length}` : 'Remove';
  $('stRlRemove').disabled = tab !== 'open' || !sel.length;
  if ($('stRlRestore')) $('stRlRestore').disabled = !sel.some(x => x.status === 'removed');
  if ($('stRlCancel')) $('stRlCancel').disabled = !sel.some(x => x.status === 'exported');
  $('stRlDl').textContent = `Preview bulk file · ${ready} approved`;
  $('stRlDl').disabled = !ready;
  if ($('stRlApply')) {
    const can = staApplyOn();
    $('stRlApply').disabled = !ready || !can;
    $('stRlApply').title = can ? 'Change the approved items at Amazon now' : staApplyWhy();
  }
}
// Approve / un-approve / remove / restore / cancel the ticked items — each a checked move, so a change someone else made
// meanwhile is reported, never overwritten; a failed save is shown (19 Nov audit).
async function staRlSet(status) {
  const me = String(ME.email || '');
  const moves = { approved: [['review'], { status: 'approved', approvedBy: me, approvedAt: Date.now() }],
    review: [['approved', 'removed'], { status: 'review', approvedBy: '', approvedAt: 0, restoredBy: me }],
    removed: [['review', 'approved'], { status: 'removed', removedBy: me, removedAt: Date.now() }],
    cancel: [['exported'], { status: 'removed', removedBy: me, removedAt: Date.now(), note: 'Downloaded, never seen at Amazon: cancelled' }] };
  const [from, patch] = moves[status];
  const sel = [...ST_RL.sel].map(id => ST_RL.items.find(y => y.id === id)).filter(x => x && from.includes(x.status)
    && (status !== 'review' || ST_RL.tab !== 'open' || x.status === 'approved'));
  const fails = [];
  for (const x of sel) {
    const why = await staRlMove(x, from, Object.assign({}, patch));
    if (why) fails.push(`${x.term || x.target}: ${why}`);
  }
  ST_RL.sel = new Set();
  STM = null;
  staRlDraw();
  if (fails.length) $('stRlSel').innerHTML = `<span style="color:var(--rev-ink)">${fails.length} not changed — ${staEsc(fails.slice(0, 3).join('; '))}${fails.length > 3 ? '…' : ''}</span>`;
  renderSt();
}

/* ================= THE BULK FILE ================= */
// { row: { column → value } } for one item, or { skip: why it cannot go into a file yet }.
function staBulkRow(x) {
  const base = { 'Product': 'Sponsored Products', 'Campaign ID': x.cid };
  if (!x.cid) return { skip: 'No campaign ID on record.' };
  if (x.kind === 'plc') {
    // One placement's bid adjustment, as an absolute percentage (Amazon's bulk file has no "+10").
    return { row: Object.assign(base, { 'Entity': 'Bidding Adjustment', 'Operation': 'Update', 'Placement': x.plc.bulk, 'Percentage': x.plc.to },
      x.plc.strategy && STA_STRATEGY_BULK[x.plc.strategy] ? { 'Bidding Strategy': STA_STRATEGY_BULK[x.plc.strategy] } : {}) };
  }
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

// The bulk-file preview: every row that will download, per brand, and what waits and why. Clashes hold the download
// until one side is removed or un-approved.
function staPreview() {
  const appr = ST_RL.items.filter(x => x.status === 'approved').map(x => ({ x, b: staBulkRow(x), c: staClashOf(x) }));
  const ready = appr.filter(y => !y.b.skip), wait = appr.filter(y => y.b.skip), clash = ready.filter(y => y.c);
  $('stRlTitle').textContent = 'Bulk file preview';
  $('stRlSeg').classList.add('hide');
  $('stRlBack').classList.remove('hide');
  ['stRlRemove', 'stRlApprove', 'stRlUnapprove', 'stRlRestore', 'stRlCancel', 'stRlApply'].forEach(id => { if ($(id)) $(id).classList.add('hide'); });
  $('stRlDl').classList.remove('hide');
  const brands = [...new Set(ready.map(y => y.x.brand))];
  $('stRlSub').textContent = `${ready.length} row${ready.length === 1 ? '' : 's'} in ${brands.length} file${brands.length === 1 ? '' : 's'} (${brands.map(staBrandName).join(', ')}), sheet "Sponsored Products Campaigns".`;
  const td = v => `<td>${staEsc(v == null ? '' : v)}</td>`;
  $('stRlTable').innerHTML = '<thead><tr><th></th><th>File</th><th>Entity</th><th>Operation</th><th>Campaign</th><th>Ad group</th><th>Keyword / target / placement</th><th>Match type</th><th class="num">Bid / %</th><th>State</th></tr></thead><tbody>'
    + ready.map(({ x, b: { row }, c }) => `<tr${c ? ' class="sta-clash"' : ''}><td></td>${td(staBrandName(x.brand))}${td(row['Entity'])}${td(row['Operation'])}${td((x.dest && x.dest.cn) || x.cn)}${td(row['Ad Group ID'] ? ((x.dest && x.dest.agn) || x.agn || row['Ad Group ID']) : '— (whole campaign)')}`
      + `<td>${staEsc(row['Keyword Text'] || row['Product Targeting Expression'] || row['Keyword ID'] || row['Product Targeting ID'] || row['Placement'])}${c ? `<small class="sta-s sta-clashtxt">Clash: ${staEsc(c)}</small>` : ''}</td>${td(row['Match Type'])}`
      + `<td class="num">${row['Bid'] != null ? staMoney(row['Bid']) + (x.bid && x.bid.from ? ` <small class="sta-s">was ${staMoney(x.bid.from)}</small>` : '') : row['Percentage'] != null ? staEsc(row['Percentage'] + '%' + (x.plc && x.plc.from != null ? ' (was ' + x.plc.from + '%)' : '')) : ''}</td>${td(row['State'])}</tr>`).join('')
    + wait.map(({ x, b }) => `<tr class="sta-wait"><td></td>${td(staBrandName(x.brand))}<td colspan="5">${staEsc(staKindName(x) + ' · ' + (x.term || x.target))}</td><td colspan="3">Waits: ${staEsc(b.skip)}</td></tr>`).join('')
    + '</tbody>';
  const note = $('stRlNote');
  note.classList.toggle('warn', ST_RL.where === 'local' || !!clash.length);
  note.innerHTML = (clash.length ? `<b>${clash.length} clashing change${clash.length === 1 ? '' : 's'}.</b> Go back and un-approve or remove one side of each before downloading. ` : '')
    + (ST_RL.where === 'local' ? '<b>This list is kept in this browser only</b> — nobody else has approved or seen it. ' : '')
    + 'Upload each file in its own brand\'s Ads console (Campaign manager → Bulk operations → Upload). Start with a small file and check its upload report; if Amazon rejects the headers, tell the team before uploading more. The file is kept: you can download it again or undo it from "Downloaded and done".';
  $('stRlSel').textContent = wait.length ? `${wait.length} approved change${wait.length === 1 ? '' : 's'} wait and stay approved.` : '';
  $('stRlDl').textContent = `Download ${brands.length > 1 ? brands.length + ' files' : 'file'} · ${ready.length} row${ready.length === 1 ? '' : 's'}`;
  $('stRlDl').disabled = !ready.length || !!clash.length;
}
// One .xlsx per brand from [{ x, row }], named for the day (and "UNDO" for a reverse file).
async function staBulkFiles(pairs, tag) {
  const day = new Date().toISOString().slice(0, 10);
  const brands = [...new Set(pairs.map(y => y.x.brand))];
  for (const b of brands) {
    const mine = pairs.filter(y => y.x.brand === b);
    const rows = [STA_BULK_COLS].concat(mine.map(y => STA_BULK_COLS.map(c => y.row[c] == null ? '' : y.row[c])));
    const blob = new Blob([staXlsx('Sponsored Products Campaigns', rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sellora-bulk-${tag ? tag + '-' : ''}${staBrandName(b).replace(/\s+/g, '-')}-${day}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (brands.length > 1) await new Promise(res => setTimeout(res, 700));
  }
  return brands.length;
}
// Download every approved item that can go into a file, one file per brand, kept as one batch (who, when, which items) so
// it can be downloaded again or undone; each item moves to "in bulk file" only if nobody else downloaded it meanwhile.
async function staDownload() {
  const ready = ST_RL.items.filter(x => x.status === 'approved').map(x => ({ x, b: staBulkRow(x) })).filter(y => !y.b.skip && !staClashOf(y.x));
  if (!ready.length) return;
  const me = String(ME.email || ''), batch = 'f' + Date.now().toString(36), at = Date.now();
  const mine = [], fails = [];
  for (const y of ready) {
    const why = await staRlMove(y.x, ['approved'], { status: 'exported', exportedAt: at, exportedBy: me, batch, batchAt: at, batchBy: me,
      bulk: STA_BULK_COLS.reduce((o, c) => { if (y.b.row[c] != null && y.b.row[c] !== '') o[c] = y.b.row[c]; return o; }, {}) });
    if (why) fails.push(`${y.x.term || y.x.target}: ${why}`); else mine.push({ x: y.x, row: y.b.row });
  }
  if (mine.length) await staBulkFiles(mine, '');
  ST_RL.preview = false;
  ST_RL.tab = 'done';
  STM = null;
  staRlDraw();
  if (fails.length) $('stRlSel').innerHTML = `<span style="color:var(--rev-ink)">${fails.length} left out — ${staEsc(fails.slice(0, 3).join('; '))}</span>`;
  renderSt();
}
// The same file again, from the rows kept with each item when it was downloaded.
async function staRedownload(batch) {
  const xs = ST_RL.items.filter(x => x.batch === batch);
  const pairs = xs.map(x => ({ x, row: x.bulk || (staBulkRow(x).row || null) })).filter(y => y.row);
  if (!pairs.length) return;
  await staBulkFiles(pairs, 'again');
}
// The reverse of one change as a bulk row, or { skip }: bid → the old bid; pause → enabled; placement → the old %; a
// negative → archived (by the ID Amazon's record shows for it); a new keyword or ASIN target → paused.
function staUndoRow(x) {
  const base = { 'Product': 'Sponsored Products', 'Campaign ID': x.cid };
  const E = staEnt(x.brand);
  if (x.kind === 'plc') {
    if (x.plc.from == null) return { skip: 'the old % is not on record' };
    return { row: Object.assign(base, { 'Entity': 'Bidding Adjustment', 'Operation': 'Update', 'Placement': x.plc.bulk, 'Percentage': x.plc.from },
      x.plc.strategy && STA_STRATEGY_BULK[x.plc.strategy] ? { 'Bidding Strategy': STA_STRATEGY_BULK[x.plc.strategy] } : {}) };
  }
  if (x.kind === 'bid' || x.kind === 'pause') {
    const hit = staEntOf(x.brand, x.ag, x.kw, x.mt) || (x.kid ? { id: x.kid, kind: staKwMt(x.mt) ? 'kw' : 'tg' } : null);
    if (!hit) return { skip: 'its ID is not in Amazon\'s record' };
    if (x.kind === 'bid' && !(x.bid && x.bid.from > 0)) return { skip: 'the old bid is not on record' };
    const kwRow = hit.kind === 'kw';
    return { row: Object.assign(base, { 'Entity': kwRow ? 'Keyword' : 'Product Targeting', 'Operation': 'Update', 'Ad Group ID': x.ag,
      [kwRow ? 'Keyword ID' : 'Product Targeting ID']: hit.id }, x.kind === 'pause' ? { 'State': 'enabled' } : { 'Bid': x.bid.from }) };
  }
  if (x.kind === 'neg') {
    const id = E && E.negId && E.negId.get((x.neg.level === 'cp' ? 'cp|' + x.cid : 'ag|' + x.ag) + '|' + staLow(x.neg.type === 'na' ? 'asin="' + x.term + '"' : x.term)
      + '|' + (x.neg.type === 'na' ? 'na' : x.neg.type === 'negativePhrase' ? 'np' : 'nx'));
    if (!id) return { skip: 'not in Amazon\'s record yet (its ID shows after the next read, twice a day)' };
    const cp = x.neg.level === 'cp';
    return { row: Object.assign(base, x.neg.type === 'na'
      ? { 'Entity': cp ? 'Campaign Negative Product Targeting' : 'Negative Product Targeting', 'Operation': 'Archive', 'Ad Group ID': cp ? '' : x.ag, 'Product Targeting ID': id }
      : { 'Entity': cp ? 'Campaign Negative Keyword' : 'Negative Keyword', 'Operation': 'Archive', 'Ad Group ID': cp ? '' : x.ag, 'Keyword ID': id }) };
  }
  if (x.kind === 'exact' || x.kind === 'asinT') {
    const d = x.dest || {};
    const hit = E && (x.kind === 'exact' ? E.kw.get(d.ag + '|' + staLow(x.term) + '|exact') : E.tg.get(d.ag + '|asin="' + staLow(x.term) + '"'));
    if (!hit) return { skip: 'not in Amazon\'s record yet (its ID shows after the next read)' };
    return { row: Object.assign(base, { 'Campaign ID': d.cid, 'Ad Group ID': d.ag, 'Operation': 'Update', 'State': 'paused' },
      x.kind === 'exact' ? { 'Entity': 'Keyword', 'Keyword ID': hit.id } : { 'Entity': 'Product Targeting', 'Product Targeting ID': hit.id }) };
  }
  return { skip: 'no undo for this kind' };
}
// "Undo this file": a bulk file that puts every change of one batch back; the items say so once downloaded. Changes not yet
// in Amazon's record (never uploaded) need no undo and are left out.
async function staUndoBatch(batch) {
  const xs = ST_RL.items.filter(x => (batch === 'old' ? !x.batch && x.status !== 'applied' : batch === 'applied' ? x.status === 'applied' : x.batch === batch)
    && (x.status === 'done' || x.status === 'exported' || x.status === 'applied'));
  const pairs = [], skip = [];
  xs.forEach(x => {
    if (x.status === 'exported') { skip.push(`${x.term || x.target}: not seen at Amazon, nothing to undo`); return; }
    const u = staUndoRow(x);
    if (u.skip) skip.push(`${x.term || x.target}: ${u.skip}`); else pairs.push({ x, row: u.row });
  });
  if (!pairs.length) { $('stRlSel').innerHTML = `<span style="color:var(--rev-ink)">Nothing to undo — ${staEsc(skip.slice(0, 3).join('; ') || 'no change in this file is at Amazon')}</span>`; return; }
  await staBulkFiles(pairs, 'UNDO');
  const me = String(ME.email || '');
  for (const p of pairs) await staRlMove(p.x, ['done', 'applied'], { status: 'undone', undoneAt: Date.now(), undoneBy: me });
  STM = null;
  staRlDraw();
  $('stRlSel').innerHTML = `Undo file downloaded: ${pairs.length} change${pairs.length === 1 ? '' : 's'}${skip.length ? ` · ${skip.length} left out (${staEsc(skip.slice(0, 2).join('; '))})` : ''}. Upload it in the Ads console like any bulk file.`;
  renderSt();
}

/* ================= APPLY AT AMAZON (ready, switched off) =================
 * One function for every "Apply": staApply(items). Each item's Amazon call is built at apply time from what is on record
 * then (staApiCall), with its reverse (staApiUndo) and the value Amazon must still have (expect), so the backend route
 * can refuse a change that is out of date. The switch is a Firestore document (config/adsApply { on, dryRun }) AND the
 * person's adsApply right — no new release to turn it on. Until the backend route exists every call answers
 * "not available yet". The backend contract (POST, ads: 'apply'): docs claude/backend-requests-19-nov.md. */
const ADS_CFG = { read: false, on: false, dryRun: true, at: 0 };
async function staApplyCfg() {
  if (ADS_CFG.read && Date.now() - ADS_CFG.at < 5 * 60000) return ADS_CFG;
  try {
    const s = await getDoc(doc(db, 'config', 'adsApply'));
    const v = s.exists() ? s.data() : {};
    ADS_CFG.on = v.on === true;
    ADS_CFG.dryRun = v.dryRun !== false;
    ADS_CFG.editor = v.editor === true;   // set by whoever confirms the Ads login's Editor role
    ADS_CFG.route = v.route === true;     // set by the Pricing-API team once ads:'apply' is live
  } catch (e) { ADS_CFG.on = false; }
  ADS_CFG.read = true;
  ADS_CFG.at = Date.now();
  ADS_APPLY.on = staApplyOn();
  if (!ADS_APPLY.on) ADS_APPLY.why = staApplyWhy();
  return ADS_CFG;
}
const staApplyOn = () => ADS_CFG.on && (ME.admin || ME.adsApply === true);
const staApplyWhy = () => { const left = staApplySteps().filter(s => !s.ok); return left.length ? 'Waiting for: ' + left.map(s => s.t + ' — ' + s.who).join('; ') : ''; };
// The Amazon Ads API call for one item (Sponsored Products v3), or null when an ID it needs is not on record.
function staApiCall(x) {
  const hit = x.kind === 'bid' || x.kind === 'pause' ? (staEntOf(x.brand, x.ag, x.kw, x.mt) || (x.kid ? { id: x.kid, kind: staKwMt(x.mt) ? 'kw' : 'tg' } : null)) : null;
  const kw = ct => 'application/vnd.' + ct + '.v3+json';
  if (x.kind === 'bid' || x.kind === 'pause') {
    if (!hit) return null;
    const isKw = hit.kind === 'kw', set = x.kind === 'pause' ? { state: 'PAUSED' } : { bid: x.bid.to };
    const was = x.kind === 'pause' ? { state: 'ENABLED' } : { bid: x.bid.from };
    const body = v => isKw ? { keywords: [Object.assign({ keywordId: hit.id }, v)] } : { targetingClauses: [Object.assign({ targetId: hit.id }, v)] };
    const c = { method: 'PUT', path: isKw ? '/sp/keywords' : '/sp/targets', ct: kw(isKw ? 'spKeyword' : 'spTargetingClause') };
    return Object.assign({}, c, { body: body(set), expect: { id: hit.id, kind: hit.kind, was }, undo: Object.assign({}, c, { body: body(was) }) });
  }
  if (x.kind === 'neg') {
    const cp = x.neg.level === 'cp';
    if (x.neg.type === 'na') return { method: 'POST', path: '/sp/negativeTargets', ct: kw('spNegativeTargetingClause'),
      body: { negativeTargetingClauses: [{ campaignId: x.cid, adGroupId: x.ag, expression: [{ type: 'ASIN_SAME_AS', value: String(x.term).toUpperCase() }], state: 'ENABLED' }] },
      undo: { method: 'POST', path: '/sp/negativeTargets/delete', ct: kw('spNegativeTargetingClause'), idFrom: 'negativeTargetingClauses' } };
    const mt = x.neg.type === 'negativePhrase' ? 'NEGATIVE_PHRASE' : 'NEGATIVE_EXACT';
    return cp ? { method: 'POST', path: '/sp/campaignNegativeKeywords', ct: kw('spCampaignNegativeKeyword'),
      body: { campaignNegativeKeywords: [{ campaignId: x.cid, keywordText: x.term, matchType: mt, state: 'ENABLED' }] },
      undo: { method: 'POST', path: '/sp/campaignNegativeKeywords/delete', ct: kw('spCampaignNegativeKeyword'), idFrom: 'campaignNegativeKeywords' } }
      : { method: 'POST', path: '/sp/negativeKeywords', ct: kw('spNegativeKeyword'),
        body: { negativeKeywords: [{ campaignId: x.cid, adGroupId: x.ag, keywordText: x.term, matchType: mt, state: 'ENABLED' }] },
        undo: { method: 'POST', path: '/sp/negativeKeywords/delete', ct: kw('spNegativeKeyword'), idFrom: 'negativeKeywords' } };
  }
  if (x.kind === 'exact' || x.kind === 'asinT') {
    const d = x.dest || {};
    if (!d.cid || !d.ag) return null;
    return x.kind === 'exact'
      ? { method: 'POST', path: '/sp/keywords', ct: kw('spKeyword'), body: { keywords: [{ campaignId: d.cid, adGroupId: d.ag, keywordText: x.term, matchType: 'EXACT', bid: x.newBid, state: 'ENABLED' }] },
        undo: { method: 'PUT', path: '/sp/keywords', ct: kw('spKeyword'), idFrom: 'keywords', set: { state: 'PAUSED' } } }
      : { method: 'POST', path: '/sp/targets', ct: kw('spTargetingClause'), body: { targetingClauses: [{ campaignId: d.cid, adGroupId: d.ag, expression: [{ type: 'ASIN_SAME_AS', value: String(x.term).toUpperCase() }], expressionType: 'MANUAL', bid: x.newBid, state: 'ENABLED' }] },
        undo: { method: 'PUT', path: '/sp/targets', ct: kw('spTargetingClause'), idFrom: 'targetingClauses', set: { state: 'PAUSED' } } };
  }
  return null;   // placements: staApiPlcFold, one call per campaign
}
// Placement changes for one campaign go out as ONE call with all three placements, re-read from Amazon's record now and
// with every approved change for that campaign folded in — so a second change can't put the first one back (19 Nov audit).
function staApiPlcFold(items) {
  const byCp = new Map();
  items.filter(x => x.kind === 'plc').forEach(x => { const k = x.brand + '|' + x.cid; (byCp.get(k) || byCp.set(k, []).get(k)).push(x); });
  const out = [];
  byCp.forEach(xs => {
    const f = xs[0], c = (ST.ent && ST.ent.d && ST.ent.d[f.brand] && ST.ent.d[f.brand].cp || {})[f.cid];
    if (!c) return;
    const now = { PLACEMENT_TOP: Number(c[4]) || 0, PLACEMENT_REST_OF_SEARCH: Number(c[5]) || 0, PLACEMENT_PRODUCT_PAGE: Number(c[6]) || 0 };
    const was = Object.assign({}, now);
    xs.forEach(x => { if (x.plc && x.plc.amz) now[x.plc.amz] = Number(x.plc.to); });
    const pb = o => Object.keys(o).map(k => ({ placement: k, percentage: o[k] }));
    const call = { method: 'PUT', path: '/sp/campaigns', ct: 'application/vnd.spCampaign.v3+json' };
    const st = c[3] ? { strategy: c[3] } : {};
    out.push({ ids: xs.map(x => x.id), brand: f.brand, call: Object.assign({}, call, { body: { campaigns: [{ campaignId: f.cid, dynamicBidding: Object.assign({}, st, { placementBidding: pb(now) }) }] },
      expect: { placements: was }, undo: Object.assign({}, call, { body: { campaigns: [{ campaignId: f.cid, dynamicBidding: Object.assign({}, st, { placementBidding: pb(was) }) }] } }) }) });
  });
  return out;
}
// One POST to the backend with the signed-in person's token (the same path image and fix writes use).
async function adsPost(body) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  let idToken = '';
  try { if (auth.currentUser) idToken = await auth.currentUser.getIdToken(); } catch (e) { /* the backend says so */ }
  const res = await fetch(API.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({ key: API.writeKey || API.key, idToken }, body)), redirect: 'follow' });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('The backend did not answer with data: ' + text.slice(0, 120)); }
}
// Apply approved items at Amazon: a dry run first when the switch says so; each item becomes applying → applied (or
// failed with Amazon's answer), keeping its reverse call for Undo. Returns a one-line summary.
async function staApply(items) {
  await staApplyCfg();
  if (!staApplyOn()) return 'Apply is not switched on yet — ' + staApplyWhy();
  const calls = [];
  const plc = staApiPlcFold(items);
  items.filter(x => x.kind !== 'plc').forEach(x => { const c = staApiCall(x); if (c) calls.push({ ids: [x.id], brand: x.brand, call: c }); });
  plc.forEach(p => calls.push(p));
  if (!calls.length) return 'Nothing to apply: the IDs these changes need are not in Amazon\'s record yet.';
  const me = String(ME.email || '');
  for (const c of calls) for (const id of c.ids) { const x = ST_RL.items.find(y => y.id === id); if (x) await staRlMove(x, ['approved'], { status: 'applying', applyBy: me, applyAt: Date.now() }); }
  let ans;
  try { ans = await adsPost({ ads: 'apply', dryRun: ADS_CFG.dryRun, calls: calls.map(c => ({ ids: c.ids, brand: c.brand, call: c.call })) }); }
  catch (e) { ans = { ok: false, error: e.message || String(e) }; }
  const res = (ans && ans.results) || [];
  let okN = 0, badN = 0;
  for (const c of calls) {
    const r = res.find(y => y.ids && y.ids[0] === c.ids[0]) || { ok: false, error: (ans && ans.error) || 'no answer for it' };
    for (const id of c.ids) {
      const x = ST_RL.items.find(y => y.id === id);
      if (!x) continue;
      if (r.ok && !ADS_CFG.dryRun) { okN++; await staRlMove(x, ['applying'], { status: 'applied', appliedAt: Date.now(), amz: r.amz || null, undoCall: c.call.undo || null }); }
      else if (r.ok) { okN++; await staRlMove(x, ['applying'], { status: 'approved', dryRunAt: Date.now(), dryRun: r.would || 'ok' }); }
      else { badN++; await staRlMove(x, ['applying'], { status: 'failed', err: String(r.error || 'failed').slice(0, 300) }); }
    }
  }
  STM = null;
  return `${ADS_CFG.dryRun ? 'Dry run: ' : ''}${okN} ${ADS_CFG.dryRun ? 'would apply' : 'applied'}${badN ? `, ${badN} failed (see Open)` : ''}.`;
}
// Undo an applied change at Amazon (the reverse call kept when it was applied; the backend refuses when Amazon's value is
// no longer what Sellora set).
async function staUnapply(x) {
  await staApplyCfg();
  if (!staApplyOn()) return 'Apply is not switched on yet — ' + staApplyWhy();
  if (!x.undoCall) return 'No undo on record for this change.';
  let ans;
  try { ans = await adsPost({ ads: 'undo', dryRun: ADS_CFG.dryRun, calls: [{ ids: [x.id], brand: x.brand, call: x.undoCall, amz: x.amz || null }] }); }
  catch (e) { return 'Could not undo: ' + (e.message || e); }
  const r = (ans && ans.results && ans.results[0]) || ans || {};
  if (!r.ok) return 'Could not undo: ' + (r.error || 'no answer');
  if (!ADS_CFG.dryRun) await staRlMove(x, ['applied'], { status: 'undone', undoneAt: Date.now(), undoneBy: String(ME.email || '') });
  return ADS_CFG.dryRun ? 'Dry run: the undo would go through.' : 'Undone at Amazon.';
}

/* ================= PLAN MY MOVES =================
 * One button: the 5–7 moves worth making first, each naming the rows it covers, and one click ticks those rows (the
 * selection bar then adds them to the review list with the usual checks). Sellora sends its own top ~50 suggestions —
 * never the whole table — and Claude (through the backend: POST ai: 'plan') groups and orders them, saying why in a line;
 * Claude can only point at rows Sellora already suggested, so it cannot invent a change. When Claude is not reachable
 * (no backend route yet, the month's limit, an error) the same plan comes from rules: the biggest money first. A plan is
 * kept for the day per brand (Plan again makes a new one). */
const STA_PLAN_LOCAL = 'staPlan';
let STA_PLAN = null;
// The candidate moves from rules, biggest money first. Each: { id, title, why, money, keys, kind }.
function staPlanRules(L) {
  const M = L.M, out = [];
  const ready = r => { try { return !!staQuick(r).items; } catch (e) { return false; } };
  // Biggest first, checking readiness only until 40 are found (20 Nov, speed: it checked every candidate).
  const pick = (rows, f, sort) => {
    const out = [];
    for (const r of rows.filter(f).sort(sort || ((a, z) => (z.stake || z.burned || 0) - (a.stake || a.burned || 0)))) { if (ready(r)) out.push(r); if (out.length >= 40) break; }
    return out;
  };
  const sum = rs => rs.reduce((t, r) => t + (r.stake || r.burned || 0), 0);
  const add = (id, rows, title, why, kind) => { if (rows.length) out.push({ id, kind, title: title(rows), why: why(rows), money: sum(rows), keys: rows.map(r => r.key) }); };
  const top = rs => rs.slice(0, 3).map(r => `"${r.term || r.target || r.gram}"`).join(', ');
  add('neg0', pick(L.burn, r => r.next === 'neg' && r.kind === 'none'),
    rs => `Stop paying for ${rs.length} search term${rs.length === 1 ? '' : 's'} with no orders`,
    rs => `${staMoney(sum(rs))} spent with no order, each past the evidence test — biggest: ${top(rs)}.`, 'neg');
  add('negL', pick(L.burn, r => r.next === 'neg' && r.kind !== 'none'),
    rs => `Negate ${rs.length} search term${rs.length === 1 ? '' : 's'} that sell at a loss`,
    rs => `Above break-even with ${STA.BE_ORDERS}+ orders and its keyword is fine without them — ${staMoney(sum(rs))} over break-even. Biggest: ${top(rs)}.`, 'neg');
  add('words', pick(L.words, r => r.act),
    rs => `Block ${rs.length} word${rs.length === 1 ? '' : 's'} that keep${rs.length === 1 ? 's' : ''} spending without selling`,
    rs => `Negative phrases across the campaigns they spend in — ${staMoney(sum(rs))} at stake: ${top(rs)}.`, 'word');
  add('cut', pick(L.burnTgt, g => g.next === 'reduce'),
    rs => `Lower the bid on ${rs.length} keyword${rs.length === 1 ? '' : 's'} / target${rs.length === 1 ? '' : 's'} losing money`,
    rs => `Each from its CPC or bid, rounded toward the current bid — ${staMoney(sum(rs))} over target or with no orders. Biggest: ${top(rs)}.`, 'bid');
  add('pause', pick(L.burnTgt, g => g.next === 'pause'),
    rs => `Pause ${rs.length} target${rs.length === 1 ? '' : 's'} with no orders`,
    rs => `Under 1% chance their 0 orders are bad luck — ${staMoney(sum(rs))} spent. ${top(rs)}.`, 'pause');
  add('exact', pick(L.scale, r => r.next === 'exact' || r.next === 'asinT', (a, z) => (z.s || 0) - (a.s || 0)),
    rs => `Give ${rs.length} selling search term${rs.length === 1 ? '' : 's'} ${rs.length === 1 ? 'its' : 'their'} own exact keyword`,
    rs => `${staMoney(rs.reduce((t, r) => t + (r.s || 0), 0))} in sales under target ACoS, still reached only through broad, phrase or auto: ${top(rs)}.`, 'exact');
  add('raise', pick((M.tgRows || []).concat(L.scale), g => g.next === 'raise', (a, z) => (z.s || 0) - (a.s || 0)),
    rs => `Raise the bid on ${rs.length} winner${rs.length === 1 ? '' : 's'}`,
    rs => `Well under target with enough orders and stock to sell more: ${top(rs)}.`, 'bid');
  add('iso', pick(L.all, r => r.next === 'iso'),
    rs => `Move ${rs.length} costly search term${rs.length === 1 ? '' : 's'} to ${rs.length === 1 ? 'its' : 'their'} own exact keyword at a lower bid`,
    rs => `The keyword sells; only this term loses — it keeps showing, for less: ${top(rs)}.`, 'iso');
  out.sort((a, z) => z.money - a.money);
  return out.slice(0, 7);
}
// The rows sent to Claude: the top ~50 suggestions with just the figures it needs (no names of people, no money totals
// beyond each row's own).
function staPlanRows(L) {
  const cand = [].concat(L.burn, L.burnTgt, L.words, L.scale).filter(r => r && r.next && r.act !== false);
  const uniq = new Map();
  cand.forEach(r => { if (!uniq.has(r.key)) uniq.set(r.key, r); });
  return [...uniq.values()].sort((a, z) => (z.stake || z.burned || z.s || 0) - (a.stake || a.burned || a.s || 0)).slice(0, 50).map(r => ({
    k: r.key, brand: r.brand, what: r.term || r.target || r.gram || '', type: r.type || 'term', next: r.next, kind: r.kind || '',
    c: r.c, sp: staR2(r.sp), o: r.o, s: staR2(r.s), acos: r.acos == null ? null : Math.round(r.acos), tgt: r.tgtUse == null ? null : Math.round(r.tgtUse),
    cp: r.cn || '', season: r.tagSet && r.tagSet.has('season') ? 1 : 0, brandTerm: r.brandTerm ? 1 : 0,
  }));
}
// Ask Claude through the backend; null when it can't answer (the rules plan is used then).
async function staPlanAi(L, rules) {
  const pick = $('stBrand').value;
  const rows = staPlanRows(L);
  if (rows.length < 3) return null;
  const ask = adsPost({ ai: 'plan', brand: pick, day: new Date().toISOString().slice(0, 10), rows,
    rules: rules.map(m => ({ id: m.id, title: m.title, keys: m.keys.slice(0, 40) })),
    want: 'Up to 7 moves, most money first. Each: title (under 12 words), why (one sentence, plain words, the numbers), keys (only from rows). Group by pattern (same word, same campaign, same season).' });
  // Sonnet (20 Nov: Plan my moves runs on Claude Sonnet 5.5) can take 20–40 s; Sellora's own plan shows meanwhile.
  const timeout = new Promise(res => setTimeout(() => res({ ok: false, error: 'took over a minute' }), 60000));
  let ans;
  try { ans = await Promise.race([ask, timeout]); } catch (e) { return { err: e.message || String(e) }; }
  if (!ans || !ans.ok || !Array.isArray(ans.moves)) return { err: (ans && ans.error) || 'no plan in the answer' };
  const known = new Set(rows.map(r => r.k));
  const moves = ans.moves.slice(0, 7).map((m, i) => {
    const keys = (m.keys || []).map(String).filter(k => known.has(k));
    const rs = keys.map(k => L.M.byKey.get(k)).filter(Boolean);
    return { id: 'ai' + i, kind: 'ai', title: String(m.title || '').slice(0, 90), why: String(m.why || '').slice(0, 300), keys,
      money: rs.reduce((t, r) => t + (r.stake || r.burned || 0), 0) };
  }).filter(m => m.title && m.keys.length);
  return moves.length ? { moves, model: ans.model || 'Claude' } : { err: 'the plan named no row Sellora suggested' };
}
async function staPlanMake(force) {
  const pick = $('stBrand').value, day = new Date().toISOString().slice(0, 10), ck = pick + '|' + day;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(STA_PLAN_LOCAL) || '{}')[ck];
      if (c && c.moves) { STA_PLAN = c; return; }
    } catch (e) { /* make a new one */ }
  }
  const L = staLists();
  const rules = staPlanRules(L);
  STA_PLAN = { at: Date.now(), src: 'rules', moves: rules, brand: pick, note: '' };
  staPlanDraw(true);
  const ai = await staPlanAi(L, rules);
  if (ai && ai.moves) STA_PLAN = { at: Date.now(), src: 'ai', model: ai.model, moves: ai.moves, brand: pick, note: '' };
  else STA_PLAN.note = ai && ai.err ? `Claude could not plan this time (${ai.err}), so these come from Sellora's rules.` : 'Too few suggestions for Claude to plan: from Sellora\'s rules.';
  try {
    const all = JSON.parse(localStorage.getItem(STA_PLAN_LOCAL) || '{}');
    Object.keys(all).forEach(k => { if (!k.endsWith(day)) delete all[k]; });
    all[ck] = STA_PLAN;
    localStorage.setItem(STA_PLAN_LOCAL, JSON.stringify(all));
  } catch (e) { /* kept for this visit */ }
}
// Draw the plan. Each move: what, why, the money, how many rows are still ready (others are in the review list already,
// or wait), and "Tick these" (the selection bar adds them, with the usual checks).
function staPlanDraw(busy) {
  const P = STA_PLAN;
  const M = staModel();
  $('stPlanSub').textContent = !P ? '' : `${P.src === 'ai' ? 'Planned by ' + (P.model || 'Claude') + ' from Sellora\'s top suggestions' : 'From Sellora\'s rules'} · ${new Date(P.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  const live = m => m.keys.map(k => M.byKey.get(k)).filter(r => { if (!r) return false; try { return !!staQuick(r).items; } catch (e) { return false; } });
  $('stPlanBody').innerHTML = (busy ? '<div class="sta-planbusy"><span class="sta-spin" aria-hidden="true"></span>Asking Claude to plan from Sellora\'s top suggestions (up to a minute)… Sellora\'s own plan below is ready now.</div>' : '')
    + (P && P.note ? `<div class="sta-plannote">${staEsc(P.note)}</div>` : '')
    + (!P || !P.moves.length ? '<p class="muted" style="padding:6px 2px">Nothing worth planning: no suggestion passes its checks right now.</p>'
      : '<ol class="sta-plan">' + P.moves.map((m, i) => {
        const rs = live(m);
        return `<li class="sta-move${rs.length ? '' : ' done'}"><span class="sta-moven">${i + 1}</span><div class="sta-movet"><b>${staEsc(m.title)}</b>
          <p>${staEsc(m.why)}</p><small class="sta-dash">${m.money > 0 ? staMoney0(m.money) + ' at stake · ' : ''}${rs.length ? `${rs.length} ready` : 'all already in the review list or waiting'}${rs.length < m.keys.length && rs.length ? ` · ${m.keys.length - rs.length} already handled` : ''}</small></div>
          ${rs.length ? `<button type="button" class="sta-btn sm" data-plantick="${i}">Tick ${rs.length}</button>` : staBadge('Done', 'ok')}</li>`;
      }).join('') + '</ol>');
  $('stPlanAgain').disabled = !!busy;
}
async function staPlanOpen() {
  $('stPlan').classList.remove('hide');
  if (!STA_PLAN || STA_PLAN.brand !== $('stBrand').value || new Date(STA_PLAN.at).toDateString() !== new Date().toDateString()) await staPlanMake(false);
  staPlanDraw(false);
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
    <input id="stSetTgt" type="number" min="1" max="100" step="1" value="${S.fallbackTgt || ''}" placeholder="Blank: from break-even">
    <small>What Sellora aims for. Blank with a break-even below: break-even minus overhead and salary (${(PF_MODEL.oh || 0) + (PF_MODEL.sal || 0)} points).</small></div>
    <div class="sta-f"><label for="stSetBe">Break-even ACoS for ${staEsc(staBrandName(b))} (%)</label>
    <input id="stSetBe" type="number" min="1" max="150" step="1" value="${S.fallbackBe || ''}" placeholder="Blank: target + ${(PF_MODEL.oh || 0) + (PF_MODEL.sal || 0)}">
    <small>Above this a sale loses money. "Above break-even" and placement Lower use it. Both blank: profit verdicts stay off for products without a unit cost.</small>
    <small id="stSetBeErr" class="sta-bad hide">Break-even must be above the target.</small></div></div>`;
  $('stSetNote').textContent = STS.where === 'local' ? 'Kept in this browser until the lists are switched on for everyone (adsSettings in firestore.rules).' : 'Shared with everyone who has this tab.';
}
async function staSetOk() {
  const lines = id => $(id).value.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  const tgt = Number($('stSetTgt').value), be = Number($('stSetBe').value);
  if (tgt > 0 && be > 0 && be <= tgt) { $('stSetBeErr').classList.remove('hide'); $('stSetBe').focus(); return; }
  try {
    await staSetSave(STS_B, { brandTerms: lines('stSetBrand'), productWords: lines('stSetProd'), blocked: lines('stSetBlock'),
    competitors: lines('stSetComp'), fallbackTgt: tgt > 0 ? tgt : null, fallbackBe: be > 0 ? be : null });
  } catch (e) {
    $('stSetNote').innerHTML = `<span class="sta-bad">Not saved: ${staEsc(String((e && (e.code || e.message)) || e))}. Nothing changed; try again, or tell Ravi if it keeps failing.</span>`;
    return;
  }
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
  ST_ACT = '';
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
  ST_ACT = '';
  ST_SORT = { k: '', d: -1 };
  ST_SEL.clear();
  renderSt();
});
// The next-step chips, and "Tick all" of the chip picked (every page).
$('stActBar').addEventListener('click', e => {
  const t = e.target.closest('[data-tickall]');
  if (t) {
    const M = staModel();
    const on = STA_ACTSHOWN.length && STA_ACTSHOWN.every(r => ST_SEL.has(r.key));
    STA_ACTSHOWN.forEach(r => { if (on) ST_SEL.delete(r.key); else ST_SEL.set(r.key, M.byKey.get(r.key) || r); });
    renderSt();
    return;
  }
  const c = e.target.closest('[data-a]');
  if (!c) return;
  ST_ACT = ST_ACT === c.dataset.a ? '' : c.dataset.a;
  ST_PG = 0;
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
// "Set a target ACoS" in the data line (no unit costs) opens Lists & settings.
$('stMsg').addEventListener('click', e => { if (e.target.closest('[data-settgt]')) staSetOpen(); });
// "Show them" under the strip: every brand leak, in All terms, through the Tag filter (so it can be cleared like any filter).
$('stSum').addEventListener('click', e => {
  if (!e.target.closest('[data-leaks]')) return;
  $('stFTag').value = 'leak';
  $('stMore').classList.remove('hide');
  $('stMoreBtn').setAttribute('aria-expanded', 'true');
  staSetView('all');
});
$('stSize').addEventListener('change', () => {
  ST_SIZE = Number($('stSize').value) || 100;
  ST_PG = 0;
  try { localStorage.setItem('stSize', String(ST_SIZE)); } catch (e) { /* no storage */ }
  renderSt();
});
// The table: next-step buttons, ticks, sortable headings, the group carets.
$('stTable').addEventListener('click', e => {
  const cp = e.target.closest('button[data-copy]');
  if (cp) { staCopyText(cp.dataset.copy, cp); return; }
  const b = e.target.closest('button[data-act]');
  if (b && (b.dataset.act === 'qx' || b.dataset.act === 'qp')) { staQuickNeg(b.dataset.k, b.dataset.act === 'qp', b); return; }
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
// Copy a name to the clipboard; the button shows a tick for a moment.
async function staCopyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (e2) { ok = false; }
  }
  if (btn) {
    btn.classList.add(ok ? 'done' : 'fail');
    btn.title = ok ? 'Copied: ' + text : 'Could not copy';
    setTimeout(() => { btn.classList.remove('done', 'fail'); }, 1400);
  }
  stFoot(ok ? `<span>Copied "${staEsc(text)}"</span>` : '<span>Could not copy: this browser blocked the clipboard.</span>', !ok);
}
// The selection bar: each ticked row's default change, after the same checks the dialog runs.
$('stSelAdd').addEventListener('click', async () => {
  const added = [];
  const skipped = [];
  $('stSelAdd').disabled = true;
  for (const r of [...ST_SEL.values()]) {
    const q = staQuick(r);
    if (q.skip) { skipped.push(`"${r.term}" (${q.skip})`); continue; }
    try {
      for (const it of q.items) { await staRlSave(it); added.push(it); }
    } catch (e) { skipped.push(`"${r.term}" (could not save: ${e.message || e})`); }
  }
  ST_SEL.clear();
  STM = null;
  $('stSelAdd').disabled = false;
  renderSt();
  const tail = skipped.length ? ` · left out ${skipped.length}: ${staEsc(skipped.slice(0, 4).join(', '))}${skipped.length > 4 ? '…' : ''}` : '';
  if (added.length) staAddedFoot(added, `Added ${added.length} change${added.length === 1 ? '' : 's'} to the review list${tail}.`);
  else stFoot(`<span>Nothing added${tail}.</span>`, true);
});
$('stSelClear').addEventListener('click', () => { ST_SEL.clear(); renderSt(); });
// The dialog.
$('stDlgBody').addEventListener('input', e => {
  if (e.target.id === 'stBidNew') e.target.dataset.touched = '1';
  staDlgCheck();
});
$('stDlgBody').addEventListener('change', staDlgCheck);
$('stDlgOk').addEventListener('click', staDlgOk);
$('stDlgApply').addEventListener('click', staDlgApply);
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
// Remove asks once more on the button itself (no pop-up): "Confirm remove 3" for 4 seconds.
$('stRlRemove').addEventListener('click', () => {
  const b = $('stRlRemove');
  if (!b.dataset.arm) {
    b.dataset.arm = '1';
    b.textContent = `Confirm remove ${ST_RL.sel.size}`;
    b.classList.add('sta-armed');
    setTimeout(() => { delete b.dataset.arm; b.classList.remove('sta-armed'); staRlSelTxt(); }, 4000);
    return;
  }
  delete b.dataset.arm;
  b.classList.remove('sta-armed');
  staRlSet('removed');
});
if ($('stRlUnapprove')) $('stRlUnapprove').addEventListener('click', () => staRlSet('review'));
if ($('stRlRestore')) $('stRlRestore').addEventListener('click', () => staRlSet('review'));
if ($('stRlCancel')) $('stRlCancel').addEventListener('click', () => staRlSet('cancel'));
if ($('stRlApply')) $('stRlApply').addEventListener('click', async () => {
  const xs = ST_RL.items.filter(x => x.status === 'approved' && !staClashOf(x));
  $('stRlApply').disabled = true;
  const msg = await staApply(xs);
  staRlDraw();
  $('stRlSel').textContent = msg;
  renderSt();
});
$('stRlTable').addEventListener('click', e => {
  const r = e.target.closest('[data-rlredl]'), u = e.target.closest('[data-rlundo]');
  if (r) staRedownload(r.dataset.rlredl);
  else if (u) staUndoBatch(u.dataset.rlundo);
});
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
  else ['stRl', 'stSet', 'stLegend', 'stPlan'].forEach(id => $(id).classList.add('hide'));
});
// Plan my moves.
$('stPlanBtn').addEventListener('click', () => { if (ST.loaded) staPlanOpen(); });
$('stPlanX').addEventListener('click', () => $('stPlan').classList.add('hide'));
$('stPlan').addEventListener('click', e => { if (e.target === $('stPlan')) $('stPlan').classList.add('hide'); });
$('stPlanAgain').addEventListener('click', async () => { await staPlanMake(true); staPlanDraw(false); });
$('stPlanBody').addEventListener('click', e => {
  const b = e.target.closest('[data-plantick]');
  if (!b || !STA_PLAN) return;
  const m = STA_PLAN.moves[Number(b.dataset.plantick)];
  const M = staModel();
  let n = 0;
  m.keys.forEach(k => {
    const r = M.byKey.get(k);
    if (!r) return;
    try { if (staQuick(r).items) { ST_SEL.set(k, r); n++; } } catch (x) { /* skipped */ }
  });
  $('stPlan').classList.add('hide');
  renderSt();
  stFoot(`<span>Ticked ${n} row${n === 1 ? '' : 's'} for "${staEsc(m.title)}". Check them in the bar below, then Add to the review list.</span>`);
  $('stSelBar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    pause: 'Pause', limit: 'Bid is not the limit', lowstock: 'Low stock: no raise', word: 'Negative phrase', iso: 'Own exact keyword at a lower bid' };
  const cols = ['Brand', 'View', 'Search term / target / word', 'Target', 'Match type', 'Campaign', 'Ad group', 'ASINs', 'Impressions',
    'Clicks', 'Spend', 'Orders', 'Sales', 'ACoS %', 'Target ACoS %', 'Break-even ACoS %', 'Verdict', 'Tags', 'Money at stake',
    'Next step', 'Suggested bid', 'Hold reason', 'Status', 'Evidence'];
  const lines = [cols.map(cell).join(',')];
  const rows = ST_VIEW === 'paths' ? ST_LAST.flatMap(g => g.shown) : ST_LAST;
  rows.forEach(r => lines.push([staBrandName(r.brand), ST_VIEW + (ST_VIEW === 'burn' ? ' by ' + ST_SUB : ''), r.term, r.type === 'word' ? '' : r.kw || '', r.mt || '',
    r.type === 'word' ? r.cps.map(c => c.cn).join(' | ') : r.cn, r.agn || '', (r.asins || []).join(' '), r.i || '', r.c, staR2(r.sp), r.o, staR2(r.s), pct(r.acos),
    pct(r.tgtUse), pct(r.beUse), (r.badges || []).map(x => x[0]).join('; ') || (r.kind === 'none' ? 'No sales' : r.kind === 'loss' ? 'Above 100% ACoS' : r.kind === 'be' ? 'Above break-even' : r.kind === 'poor' ? 'Converts poorly' : ''),
    (r.tags || []).map(t => t[1]).join('; '), r.stake || r.burned ? staR2(r.stake || r.burned) : '', NEXT[r.next] || '',
    (r.type === 'target' ? r.sugBid : r.next === 'iso' ? r.isoBid : r.tr && /reduce|raise/.test(r.next || '') ? r.tr.sugBid : r.sugBid) || '', strip(r.hold), r.status || '', strip(r.ev)].map(cell).join(',')));
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
