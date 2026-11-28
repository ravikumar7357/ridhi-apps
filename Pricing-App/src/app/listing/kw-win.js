/* ================= LISTING · WINNING KEYWORDS: the words that sell, per product type — for every search-terms suggestion =================
 * Screen: Listing → Listing Rules, the "Winning keywords" card under the rules (kwPanelHtml), two tabs: "📈 Proven in our ads" (our own
 *   Sponsored Products search terms with orders, per listing family) and "🔎 Bestseller words" (per product type: the words and phrases
 *   the top bestsellers use, how many of them, whether we use them, the last run, ↻ Run now). A CSV of each.
 * DATA — never made up, never guessed. Two sources, in this order:
 *   1. PROVEN IN OUR ADS (28 Nov 2026) — our own Sponsored Products customer search terms from the nightly caches (stD60 when the backend
 *      writes it, else srchTerm: 30 days) with adGroup (which ASINs each ad group advertises). Per listing FAMILY, the terms with ORDERS
 *      >= 2 and an ACoS not over its break-even (when known): their words are added FIRST, by orders, and may take the room of the
 *      listing's own words with no proof (listing-rules.js lrSuggestWords step 3c). "PPC: 14 orders from 'farmhouse tablecloth' in 30 days".
 *   2. BESTSELLER WORDS (28 Nov 2026, in place of the Brand Analytics uploads, which are no longer read — what was uploaded stays stored,
 *      unused) — the Bestseller keyword scout (Pricing-API/KeywordScout.gs): once a week, and on "Run now", the backend searches Amazon's
 *      catalogue for each of our product types (tablecloth, napkin, placemat, table runner, pillow cover + any other product type of our
 *      listings), takes the top 25 results by Best Seller Rank that are not ours, and counts the words and 2–3 word phrases of their
 *      titles and bullet points (brand names, ASINs, numbers, joining words out). Sellora reads it with ?cache=kwScout. A word used by
 *      >= KW_SCOUT_MIN (30 %) of them, not a brand's name (any bestseller's, ours, the IP & Trademark Guard's, Listing Rules' other brands),
 *      is offered — only into the ROOM LEFT OVER: it never pushes out the listing's own words (lrSuggestWords step 3b drops it first).
 *      "used by 14 of the top 20 bestsellers".
 *   A source with no data is skipped and said: "Bestseller scout hasn't run yet — skipped", "No PPC search-term data … — skipped". With
 *   neither, every suggestion only applies our word rules and the 249-byte limit (listing-rules.js lrSuggestWords), no word is added.
 * A LISTING'S WINNING WORDS (kwWinFor): a search term or bestseller phrase that names another shape, colour, size or material than the
 *   listing's, a pattern the listing does not say (buffalo plaid, gingham…), a season (the Season planner adds those, in their window) —
 *   or something our cloth is not (waterproof, vinyl, disposable, a napkin ring…) — is skipped whole; from the rest, every word that is
 *   not in the title or the search terms already, not a brand (ours or anyone's), not a joining / low-value word, not a restricted claim,
 *   not an ASIN or a number. (29 Nov 2026) An edge (scalloped, fringe, lace…), a pattern (plaid, striped, floral…), a season or (when the
 *   listing's is not known) a material is only added when its title, attributes or colour say the product is so — else it is skipped
 *   and said: "skipped: not sure the product is scalloped".
 * Used by: kw-fix.js (Fix all search terms: the Workspace row and the Listing Errors card), listing-content.js lcSuggestKeywords,
 *   listing-ai.js (✨ AI kw: the words are sent, its answer goes through the same rule), create-listing.js. The rule itself — the only
 *   place a word is added or taken out — is listing-rules.js lrSuggestWords.
 * WRITES nothing. Backend calls: cache reads (?cache=kwScout / stD60 / srchTerm / adGroup) and, on "Run now", ?kwscout=run (asks the
 *   backend's scout to run — read-only catalogue searches on Amazon) then ?kwscout=status until it is done.
 * Main functions: kwLoad, kwEnsure, kwScoutRead, kwScoutWords, kwScoutRun, kwStatus, kwTypeOf, kwTypeOfListing, kwWinFor, kwOthers,
 *   kwWhyLabel, kwPanelHtml, kwPanelDraw, kwScoutCsv, kwPpcCsv, kwReport (console). Names kw / KW. Tests: tests/kw-win-test.js,
 *   tests/kw-scout-test.js. */

const KW_FOCUS = ['Angry Orange', 'Etopia', 'Maison'];       // the brands the team watches (Maison = Maison d' Hermine)
const KW_OLD_DAYS = 45;                                      // a scout run older than this: not used ("Bestseller scout last ran …")
const KW_MAX_WORDS = 40;                                     // winning words offered per listing, best first
const KW_TYPES = [
  ['tablecloth', 'Tablecloths', ['tablecloth', 'table cloth', 'table cover']],
  ['napkin', 'Napkins', ['napkin', 'cloth napkin', 'dinner napkin', 'serviette']],
  ['placemat', 'Placemats', ['placemat', 'place mat', 'table mat']],
  ['runner', 'Table runners', ['table runner', 'runner']],
  ['pillow', 'Pillow covers', ['pillow cover', 'throw pillow cover', 'cushion cover', 'pillowcase', 'pillow case', 'pillow sham', 'sham', 'cushion', 'pillow']],
  ['coaster', 'Coasters', ['coaster']],
  ['apron', 'Aprons', ['apron']],
  ['towel', 'Kitchen towels', ['tea towel', 'kitchen towel', 'dish towel']],
  ['quilt', 'Quilts', ['quilt', 'bedspread', 'coverlet', 'bed cover']],
  ['duvet', 'Duvet covers', ['duvet cover', 'duvet', 'comforter cover']],
  ['curtain', 'Curtains', ['curtain', 'drape']],
  ['bag', 'Bags', ['tote bag', 'tote', 'pouch']],
  ['dress', 'Dresses', ['dress', 'kaftan', 'caftan']],
];
// Amazon's product types → ours.
const KW_PT = { TABLECLOTH: 'tablecloth', TABLE_CLOTH: 'tablecloth', NAPKIN: 'napkin', TABLE_NAPKIN: 'napkin', PLACEMAT: 'placemat', PLACE_MAT: 'placemat',
  TABLE_RUNNER: 'runner', PILLOW: 'pillow', PILLOWCASE: 'pillow', THROW_PILLOW_COVER: 'pillow', CUSHION_COVER: 'pillow', PILLOW_COVER: 'pillow', COASTER: 'coaster',
  APRON: 'apron', DISH_TOWEL: 'towel', KITCHEN_TOWEL: 'towel', TOWEL: 'towel', QUILT: 'quilt', BEDSPREAD: 'quilt', DUVET_COVER: 'duvet', CURTAIN: 'curtain',
  WINDOW_CURTAIN: 'curtain', TOTE_BAG: 'bag', HANDBAG: 'bag', DRESS: 'dress' };
// A search for something our product is not (or a claim it cannot make): skipped whole.
const KW_NOT = ['waterproof', 'water proof', 'water resistant', 'water repellent', 'spill proof', 'spillproof', 'wipeable', 'wipe clean', 'oilcloth', 'oil cloth',
  'vinyl', 'plastic', 'pvc', 'disposable', 'paper', 'fitted', 'elastic', 'ring', 'holder', 'clip', 'weight', 'insert', 'rug', 'hallway', 'stair', 'carpet',
  'stain resistant', 'stain proof', 'heat resistant', 'fire retardant', 'flame retardant', 'sewing', 'crochet', 'knit', 'kit'];
const KW_MATERIALS = ['cotton', 'linen', 'polyester', 'vinyl', 'plastic', 'lace', 'burlap', 'jute', 'silk', 'satin', 'velvet', 'wool', 'felt', 'microfiber',
  'flannel', 'canvas', 'bamboo', 'leather', 'sequin', 'chenille', 'rayon', 'muslin', 'organza', 'tulle', 'polycotton'];
// A pattern a search may name: a search naming one the listing does not say (in its title or search terms) is about another product.
const KW_PATTERNS = ['plaid', 'buffalo', 'gingham', 'check', 'checked', 'checkered', 'chequered', 'stripe', 'striped', 'polka', 'dot', 'dots', 'tartan', 'chevron',
  'herringbone', 'damask', 'paisley', 'floral', 'geometric', 'solid', 'toile', 'ikat', 'leopard', 'camo', 'embroidered', 'crochet', 'lace'];
// Season words: a search naming a season is skipped whole (the Season planner adds the seasons, in their window) — with the Season
// calendar's own words.
const KW_SEASON = ['christmas', 'xmas', 'halloween', 'thanksgiving', 'easter', 'valentine', 'valentines', 'hanukkah', 'diwali', 'eid', 'ramadan', 'passover',
  'fall', 'autumn', 'spring', 'summer', 'winter', 'holiday', 'holidays', 'patrick', 'patricks', 'july', '4th', 'independence', 'mothers', 'fathers', 'newyear'];
// Words that describe, not name — never read as a brand when guessing one from a product title.
const KW_PLAIN = ['set', 'pack', 'piece', 'pieces', 'pcs', 'premium', 'luxury', 'home', 'decor', 'farmhouse', 'rustic', 'boho', 'modern', 'vintage', 'floral', 'print',
  'printed', 'embroidered', 'solid', 'stripe', 'striped', 'plaid', 'check', 'checkered', 'buffalo', 'gingham', 'wedding', 'party', 'table', 'large', 'small', 'extra',
  'heavy', 'duty', 'soft', 'natural', 'classic', 'french', 'country', 'outdoor', 'indoor', 'kids', 'baby', 'new', 'quality', 'pure', 'handmade', 'woven', 'cloth'];
const KW_KEEP_ROWS = 60;                                    // rows the panel shows at once (Show more adds as many)

const KW = { scout: null, v: 0, loaded: false, busy: null, err: '', type: '', stype: '', tab: '', ppcBrand: 'ALL', ppc: null, q: '', limit: KW_KEEP_ROWS,
  win: new Map(), others: null, ours: null, running: false, runMsg: '', runErr: false, runPrev: 0, pollT: null };
const kwEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const KW_NUM = new Intl.NumberFormat('en-US');
const kwNf = n => KW_NUM.format(Number(n || 0));
const KW_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const kwDay = k => (k && /^\d{4}-\d{2}-\d{2}/.test(k) ? `${+k.slice(8, 10)} ${KW_MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : '—');
const kwIso = t => new Date(t).toISOString().slice(0, 10);
// A word as compared: the suggestion-words rule's own key (lower case, plural as its singular, Grey = Gray).
const kwKey = w => (typeof lrSwKey === 'function' ? lrSwKey(w) : String(w || '').toLowerCase().replace(/[^a-z0-9%]+/g, ''));
// A text as its words and their keys, side by side (the words as written, for showing).
function kwWords(text) {
  const words = String(text || '').split(/[^\p{L}\p{N}%']+/u).filter(Boolean);
  const out = { words: [], keys: [] };
  words.forEach(w => { const k = kwKey(w.replace(/'/g, '')); if (k) { out.words.push(w.replace(/'/g, '').toLowerCase()); out.keys.push(k); } });
  return out;
}
const kwKeys = text => kwWords(text).keys;
const kwPhrases = list => (typeof lrSwPhrases === 'function' ? lrSwPhrases(list) : list.map(p => String(p).split(/\s+/).map(kwKey)));
const kwHasSeq = (keys, p) => { for (let i = 0; i + p.length <= keys.length; i++) if (p.every((k, j) => keys[i + j] === k)) return true; return false; };
const KW_TYPE_P = KW_TYPES.map(([type, , phrases]) => [type, kwPhrases(phrases)]);
const KW_NOT_P = kwPhrases(KW_NOT);
const KW_MAT_SET = new Set(KW_MATERIALS.map(kwKey));
const KW_PAT_SET = new Set(KW_PATTERNS.map(kwKey));
// An EDGE a search may name (29 Nov 2026): only added when the listing's title / attributes say it is made so.
const KW_EDGE = ['scalloped', 'scallop', 'fringe', 'fringed', 'tassel', 'tasseled', 'lace', 'ruffle', 'ruffled', 'pompom', 'pom', 'hemstitch', 'hemstitched', 'trimmed', 'piped', 'piping', 'frilled', 'frill', 'beaded', 'sequined'];
const KW_EDGE_SET = new Set(KW_EDGE.map(kwKey));
// FIT (30 Nov 2026): a search for another kind of table, user or size than the product — only when its title / attributes say it is so.
// [phrase, what the product would have to be]; the longer phrases first.
const KW_FIT = [['card table', 'for a card table'], ['coffee table', 'for a coffee table'], ['side table', 'for a side table'], ['end table', 'for an end table'],
  ['cocktail table', 'for a cocktail table'], ['high top', 'for a high top table'], ['bar table', 'for a bar table'], ['picnic table', 'for a picnic table'],
  ['folding table', 'for a folding table'], ['patio table', 'for a patio table'], ['kitchen island', 'for a kitchen island'], ['nightstand', 'for a nightstand'],
  ['card', 'for a card table'], ['kids', 'for kids'], ['kid', 'for kids'], ['children', 'for kids'], ['toddler', 'for kids'], ['baby', 'for a baby'],
  ['extra large', 'extra large'], ['oversized', 'oversized'], ['small', 'small'], ['large', 'large'], ['mini', 'mini'], ['xl', 'XL'], ['king', 'king size'],
  ['queen', 'queen size'], ['twin', 'twin size'], ['full size', 'full size'], ['bistro table', 'for a bistro table']];
const KW_FIT_P = KW_FIT.map(([p, what]) => [kwPhrases([p])[0], what]);

/* ============================================================================================
 * 1. THE BESTSELLER SCOUT'S DATA: ?cache=kwScout (Pricing-API/KeywordScout.gs — weekly, and on Run now)
 * ============================================================================================ */
const KW_SCOUT_TAB = 'kwScout';
const KW_SCOUT_MIN = 0.3;            // a bestseller word is used when at least 30 % of the top bestsellers use it
const KW_SCOUT_POLL_MS = 60000;      // after Run now: the backend is asked where it is every minute…
const KW_SCOUT_POLL_MAX = 20;        // …at most 20 times (a run takes a few minutes)
// The search the scout makes for each of our product types (the backend's own list starts with the first five).
const KW_SCOUT_Q = { tablecloth: 'tablecloth', napkin: 'cloth napkins', placemat: 'placemats', runner: 'table runner', pillow: 'pillow cover', coaster: 'coasters',
  apron: 'apron', towel: 'kitchen towels', quilt: 'quilt', duvet: 'duvet cover', curtain: 'curtains', bag: 'tote bag', dress: 'dress' };
// Amazon product types too wide to search by their name.
const KW_SCOUT_SKIP = new Set(['PRODUCT', 'HOME', 'HOME_BED_AND_BATH', 'HOME_FURNITURE_AND_DECOR', 'KITCHEN', 'ACCESSORY', 'ABIS_HOME', 'ABIS_KITCHEN', 'TEXTILE']);
// The backend GET, kept per visit (baCall: the browser's copy first) — or, `fresh` (after Run now), straight from the backend.
const kwNet = () => (typeof baCallNet === 'function' ? baCallNet : baCall);
async function kwCacheGet(name, fresh) {
  try { const r = fresh ? await kwNet()({ cache: name }) : typeof baCall === 'function' ? await baCall({ cache: name }) : null; return (r && r.data) || null; } catch (e) { return null; }
}
/** The scout's tab ({ at, ms, top, min, types: { type: { q, pt, n, items, words, err } } }) — null when it has not run (never guessed). */
async function kwScoutRead(fresh) {
  const d = await kwCacheGet(KW_SCOUT_TAB, fresh);
  return d && d.types && typeof d.types === 'object' && Object.keys(d.types).length ? d : null;
}
/** Read both sources (once per visit unless forced). Never throws: a missing source is said in the panel. */
async function kwLoad(force) {
  if (KW.busy) return KW.busy;
  if (KW.loaded && !force) return null;
  KW.busy = (async () => {
    const [sc] = await Promise.all([kwScoutRead(!!force), kwPpcLoad()]);   // our own ads' search terms (never throws) too
    if (sc) KW.scout = sc;
    KW.loaded = true;
    kwChanged();
  })().finally(() => { KW.busy = null; });
  return KW.busy;
}
// Loaded already (true), or starting it (false) — for the screens that work out their words right away.
function kwEnsure() { if (!KW.loaded) { kwLoad(); return false; } return true; }
function kwChanged() {
  KW.v++;
  KW.win.clear(); KW.others = null; KW.ours = null; KW.ppcM = null; KW.sw = null; KW.sb = null;
  if (typeof kwPanelDraw === 'function') kwPanelDraw();
}
/** FOR TESTS and the test site: the scout's tab as the backend writes it — { scout } — or {} for none. */
function kwUse(o) {
  o = o || {};
  KW.scout = o.scout && o.scout.types ? o.scout : null;
  KW.loaded = true;
  kwChanged();
}
/** Our listings' product types, for Run now: [[type, search, Amazon's product type]] — Listing Health's rows, their product type from the
 *  listing cache. A type of ours (KW_PT) is searched by its word ("cloth napkins"); another one by its own name ("BLANKET" → "blanket"). */
function kwScoutTypeList() {
  const seen = new Map();
  ['SP', 'CPC'].forEach(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).forEach(r => {
    let m = null;
    try { m = typeof lmGet === 'function' ? lmGet(r.sku, b) : null; } catch (e) { m = null; }
    const pt = String((m && m.pt) || r.pt || '').toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (!pt || KW_SCOUT_SKIP.has(pt)) return;
    const t = KW_PT[pt] || pt.toLowerCase();
    if (!seen.has(t)) seen.set(t, [t, KW_SCOUT_Q[t] || pt.toLowerCase().replace(/_/g, ' '), pt]);
  }));
  return [...seen.values()].slice(0, 12);
}
/** ↻ Run now: ask the backend's scout to run (it reads Amazon's catalogue — nothing is sent), then ask where it is every minute until done. */
async function kwScoutRun() {
  if (KW.running) return null;
  KW.running = true; KW.runErr = false; KW.runMsg = 'Asking the scout to run…';
  kwPanelDraw();
  let r = null;
  try { r = await kwNet()({ kwscout: 'run', types: kwScoutTypeList().map(x => x.join('~')).join(',') }); }
  catch (e) {
    const m = String((e && e.message) || e);
    KW.running = false; KW.runErr = true;
    KW.runMsg = /not data|did not return|Unknown|kwsAsk_/i.test(m) ? 'Run now did not start: the backend does not have the scout yet (KeywordScout.gs is waiting to be deployed).' : 'Run now did not start: ' + m;
    kwPanelDraw();
    return null;
  }
  KW.runPrev = (r && r.last && r.last.ms) || 0;
  KW.runMsg = 'Running: the scout is reading the top bestsellers of each product type on Amazon (catalogue search only — nothing is sent). It takes a few minutes; this panel updates by itself.';
  kwPanelDraw();
  clearTimeout(KW.pollT);
  KW.pollT = setTimeout(() => kwScoutPoll(0), KW_SCOUT_POLL_MS);
  return r;
}
/** One look at the backend after Run now: done → the new words are read (fresh) and every screen works them out again. */
async function kwScoutPoll(n) {
  let st = null;
  try { st = await kwNet()({ kwscout: 'status' }); } catch (e) { st = null; }
  if (st && !st.running && st.last && st.last.ms > KW.runPrev) {
    const sc = await kwScoutRead(true);
    if (sc) KW.scout = sc;
    KW.running = false;
    KW.runMsg = `Done: ${kwNf(st.last.types || 0)} product types read${st.last.fail ? ` · ${kwNf(st.last.fail)} could not be read (their last words kept)` : ''}.`;
    kwChanged();
    return true;
  }
  if (st && st.progress) KW.runMsg = `Running: ${kwNf(st.progress.done)} of ${kwNf(st.progress.of)} product types read${st.progress.note ? ' — ' + st.progress.note : ''}…`;
  if (n + 1 >= KW_SCOUT_POLL_MAX) {
    KW.running = false;
    KW.runMsg = 'Still running on the backend — the new words show the next time this page is opened.';
    kwPanelDraw();
    return false;
  }
  kwPanelDraw();
  KW.pollT = setTimeout(() => kwScoutPoll(n + 1), KW_SCOUT_POLL_MS);
  return false;
}

/* ============================================================================================
 * 2. PRODUCT TYPES AND BRANDS
 * ============================================================================================ */
/** The product type a text names: 'tablecloth', 'napkin'… — '' when none, or more than one ("tablecloth and napkin set"). */
function kwTypeOf(text) {
  const keys = Array.isArray(text) ? text : kwKeys(text);
  const hits = KW_TYPE_P.filter(([, ps]) => ps.some(p => kwHasSeq(keys, p))).map(([t]) => t);
  return hits.length === 1 ? hits[0] : '';
}
/** A listing's type: its product words (the suggestion-words rule's facts), else Amazon's product type, else its title. */
function kwTypeOfListing(facts, pt, title) {
  const f = facts || {};
  const fromProduct = kwTypeOf((f.product || []).join(' | '));
  if (fromProduct) return fromProduct;
  const p = KW_PT[String(pt || '').toUpperCase().replace(/[\s-]+/g, '_')];
  return p || kwTypeOf(title) || kwPtType(pt);
}
// A product type's name: ours ('Tablecloths'), else an Amazon product type the scout read under its own name ('blanket' → 'Blanket').
const kwTypeName = t => (KW_TYPES.find(x => x[0] === t) || [t, String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1).replace(/_/g, ' ')])[1];
// Every word a brand guess stops at: product, shape, colour, material, use, joining, low-value and plain describing words.
let KW_VOCAB = null;
function kwVocab() {
  if (KW_VOCAB) return KW_VOCAB;
  const s = new Set();
  const add = list => (list || []).forEach(p => String(p).split(/[\s-]+/).forEach(w => { const k = kwKey(w); if (k) s.add(k); }));
  KW_TYPES.forEach(t => add(t[2]));
  add(KW_NOT); add(KW_MATERIALS); add(KW_SEASON); add(KW_PLAIN);
  if (typeof LR_SW_PRODUCTS !== 'undefined') { add(LR_SW_PRODUCTS); add(LR_SW_USES); add(LR_SW_COLORS); add(LR_SW_LOW); add(LR_SW_STOP); add(LR_SW_IDENTITY); add(Object.values(LR_SW_SHAPES).flat()); }
  KW_VOCAB = s;
  return s;
}
// Our brands' phrases (as keys): the four of the word rules, Listing Rules' "Our brand words".
function kwOurPhrases() {
  const cfg = (typeof LR !== 'undefined' && LR) || (typeof LR_DEFAULT !== 'undefined' ? LR_DEFAULT : null);
  const mine = cfg && typeof lrAllow === 'function' ? String(lrAllow(cfg).ourBrands || '') : '';
  if (KW.ours && KW.ours.key === mine) return KW.ours.list;      // kept until "Our brand words" change
  const list = (typeof LR_KW_OURS !== 'undefined' ? LR_KW_OURS : ['Ridhi', 'Whimsical Corner', 'CPC', 'Cotton Print Club'])
    .concat(typeof lrWords === 'function' ? lrWords(mine) : []);
  KW.ours = { key: mine, list: kwPhrases(list) };
  return KW.ours.list;
}
// An Amazon product type of ours the scout read under its own name ("BLANKET" → 'blanket'), else ''.
function kwPtType(pt) {
  const k = String(pt || '').toLowerCase().replace(/[\s-]+/g, '_');
  return k && KW.scout && KW.scout.types && KW.scout.types[k] ? k : '';
}
// The brands of the bestsellers the scout read (every product type) — never ours (the scout leaves our items out).
function kwScoutBrands() {
  if (KW.sb && KW.sb.v === KW.v) return KW.sb.list;
  const m = new Map();
  Object.values((KW.scout && KW.scout.types) || {}).forEach(t => (t.items || []).forEach(it => { const b = String(it.b || '').trim(); if (b) m.set(kwKeys(b).join(' '), b); }));
  m.delete('');
  KW.sb = { v: KW.v, list: [...m.values()] };
  return KW.sb.list;
}
/** OTHER BRANDS' NAMES to take out of search terms (listing-rules.js lrSuggestWords `others`): the watched brands, Maison d' Hermine, and
 *  every brand of the bestsellers the scout read (one word only when it is not an ordinary word); with no IP & Trademark Guard, also
 *  Listing Rules' "Other brands' names". A guessed brand is never taken out. Never one of ours. */
function kwOthers(cfg) {
  const ipg = typeof ipgKwRisk === 'function';
  const key = KW.v + '|' + ipg + '|' + (cfg && cfg.allow ? String(cfg.allow.otherBrands || '') : '');
  if (KW.others && KW.others.key === key) return KW.others.list;
  const vocab = kwVocab(), ours = kwOurPhrases();
  const out = new Map();
  const add = (name, sure) => {
    const keys = kwKeys(name);
    if (!keys.length || ours.some(p => p.length === keys.length && p.every((k, j) => keys[j] === k))) return;
    if (keys.length === 1 && (vocab.has(keys[0]) || keys[0].length < 4) && !sure) return;
    out.set(keys.join(' '), name);
  };
  KW_FOCUS.forEach(b => add(b, true));
  add("Maison d' Hermine", true);
  kwScoutBrands().forEach(b => add(b, false));
  if (!ipg && cfg && typeof lrAllow === 'function' && typeof lrWords === 'function') lrWords(lrAllow(cfg).otherBrands).forEach(b => add(b, true));
  const list = [...out.values()];
  KW.others = { key, list };
  return list;
}
// The season phrases (as keys): ours, and the Season calendar's names and words, each one WHOLE ("black friday", never "black" alone).
function kwSeasonPhrases(cfg) {
  const list = KW_SEASON.slice();
  ((cfg && cfg.events) || []).forEach(ev => { list.push(String(ev.name || '')); String(ev.words || '').split(',').forEach(w => list.push(w)); });
  return kwPhrases(list.map(s => s.trim()).filter(Boolean));
}
// Every brand word (keys): the scout's bestseller brands, the watched ones, ours, Listing Rules' other brands.
function kwBrandKeys(cfg) {
  const key = KW.v + '|' + (cfg && cfg.allow ? String(cfg.allow.otherBrands || '') + '|' + String(cfg.allow.ourBrands || '') + '|' + String(cfg.allow.claims || '') + '|' + JSON.stringify(cfg.events || []) : '-');
  if (KW.bk && KW.bk.key === key) return KW.bk.s;
  const s = new Set();
  KW.bk = { key, s };
  const addText = t => kwKeys(t).forEach(k => s.add(k));
  kwScoutBrands().forEach(addText);
  KW_FOCUS.forEach(addText);
  addText("Maison d' Hermine");
  kwOurPhrases().forEach(p => p.forEach(k => s.add(k)));
  if (cfg && typeof lrAllow === 'function') addText(lrAllow(cfg).otherBrands);
  return s;
}
// Words never ADDED from the data: every brand word, Listing Rules' restricted claims, the season words.
function kwBlocked(cfg) {
  const bk = kwBrandKeys(cfg);
  if (KW.bl && KW.bl.of === KW.bk) return KW.bl.s;       // the same data and the same rules: the same words
  const s = new Set(bk);
  KW.bl = { of: KW.bk, s };
  const addText = t => kwKeys(t).forEach(k => s.add(k));
  if (cfg && typeof lrAllow === 'function') addText(lrAllow(cfg).claims);
  KW_SEASON.forEach(addText);
  ((cfg && cfg.events) || []).forEach(ev => { addText(ev.name); addText(ev.words); });
  // a brand word that is also an ordinary word of ours (a brand "Home Linen": "home") is still never added — only a word to describe
  return s;
}

/* ============================================================================================
 * 3. ONE LISTING'S WINNING WORDS
 * ============================================================================================ */
/** Is the scout's data there and fresh? { ok, none, old, to, at, text } — text: what every screen says about it. */
function kwStatus() {
  const s = KW.scout;
  if (!KW.loaded) return { ok: false, loading: true, text: 'Bestseller words: reading…' };
  const types = s && s.types ? Object.values(s.types) : [];
  const ms = (s && s.ms) || Math.max(0, ...types.map(t => t.ms || 0));
  if (!types.length || !ms) return { ok: false, none: true, text: "Bestseller scout hasn't run yet — skipped" };
  const to = kwIso(ms);
  if ((Date.now() - ms) / 864e5 > KW_OLD_DAYS) return { ok: false, old: true, to, at: ms, text: `Bestseller scout last ran ${kwDay(to)} — older than ${KW_OLD_DAYS} days: skipped` };
  return { ok: true, to, at: ms, text: `Bestseller words: the top ${(s && s.top) || 25} by Best Seller Rank per product type, scout of ${kwDay(to)}` };
}
// The brand names a bestseller word may not hold (as key lists): the bestsellers' brands, ours, the watched ones and Listing Rules' other brands.
function kwScoutBrandP(cfg) {
  const vocab = kwVocab();
  const list = kwScoutBrands().concat(kwOthers(cfg));
  return kwPhrases(list).filter(p => p.length && !(p.length === 1 && (vocab.has(p[0]) || p[0].length < 4))).concat(kwOurPhrases());
}
/** A product type's bestseller words: [{ w, keys, words, n, of, share, r }] — used by ≥ KW_SCOUT_MIN of its counted bestsellers, never a
 *  brand's name (kwScoutBrandP) nor a word the IP & Trademark Guard flags; most used first (then the shorter, then the best rank). */
function kwScoutWords(type, cfg) {
  const t = KW.scout && KW.scout.types && KW.scout.types[type];
  if (!t || !t.n || !(t.words || []).length) return [];
  if (!KW.sw || KW.sw.v !== KW.v) KW.sw = { v: KW.v, m: new Map() };
  if (KW.sw.m.has(type)) return KW.sw.m.get(type);
  cfg = cfg || (typeof LR !== 'undefined' && LR) || (typeof LR_DEFAULT !== 'undefined' ? LR_DEFAULT : null);
  const brandP = kwScoutBrandP(cfg);
  // the IP & Trademark Guard's words (other brands' names, restricted claims): every word of one found in any of them is out for this
  // type — "pottery barn style" takes "pottery" and "barn" out on their own too
  const ban = new Set();
  if (typeof ipgFind === 'function' && cfg) t.words.forEach(x => { try { ipgFind(String(x.w), cfg).forEach(h => kwKeys(h.word || h.text).forEach(k => ban.add(k))); } catch (e) { /* the Guard is optional */ } });
  const min = Math.max(KW_SCOUT_MIN, +KW.scout.min || 0);
  const out = [];
  t.words.forEach(x => {
    const ww = kwWords(x.w);
    const share = (+x.n || 0) / t.n;
    if (!ww.keys.length || share + 1e-9 < min || ww.keys.some(k => /\d/.test(k))) return;
    if (brandP.some(p => kwHasSeq(ww.keys, p)) || ww.keys.some(k => ban.has(k))) return;
    out.push({ w: ww.words.join(' '), keys: ww.keys, words: ww.words, n: +x.n, of: t.n, share, r: +x.r || 0 });
  });
  out.sort((a, z) => z.n - a.n || a.keys.length - z.keys.length || (a.r || 9e9) - (z.r || 9e9));
  KW.sw.m.set(type, out);
  return out;
}
// A bestseller word's reason, as every screen shows it.
const kwScoutWhy = e => `${e.phrase ? `'${e.term}' ` : ''}used by ${kwNf(e.n)} of the top ${kwNf(e.of)} bestsellers`;
/* ---- PROVEN IN OUR ADS (28 Nov 2026): the 2nd source — our own Sponsored Products customer search terms ----
 * Read-only from the nightly caches every Ads screen reads (no Amazon call, no backend change): stD60 (60 days, in stSettled's shape)
 * when the backend writes it, else srchTerm (the nightly 30-day window — the only window there is today), with adGroup (which ASINs
 * each ad group advertises). A search term belongs to a FAMILY when every ASIN its ad group advertises is in that one family (our
 * Listing Health rows: ASIN → parent); a single-ASIN group's terms are that ASIN's. "Proven" = ORDERS ≥ KW_PPC_MIN_ORDERS in the
 * window, and the ACoS not over the break-even ACoS (Search Terms' cpBreakEven) when that is known. Its words go through exactly the
 * same filters as the bestseller words (kwWordFilter), and come FIRST, by orders: when space is short the bestseller words
 * (added after them) are the first to go. Reason: "PPC: 14 orders from 'farmhouse tablecloth' in 30 days". */
const KW_PPC_MIN_ORDERS = 2;
const KW_PPC_SRC = [['stD60', 60], ['srchTerm', 30]];      // the longest window the backend has written wins
/** FOR TESTS: the PPC data as if read — { terms: { SP: { rows, from, to } }, groups: { SP: { groups } }, days, src, at }. */
function kwUsePpc(o) {
  KW.ppc = o ? { terms: o.terms || {}, groups: o.groups || {}, days: o.days || 30, src: o.src || 'srchTerm', at: o.at || '', loaded: true } : { terms: {}, groups: {}, days: 0, src: '', loaded: true };
  kwChanged();
}
/** Read the nightly search-term caches (once per visit; baCall keeps a copy). Never throws: no data = no proven words. */
async function kwPpcLoad() {
  if (KW.ppc && KW.ppc.loaded) return KW.ppc;
  const grab = async name => { try { const r = typeof baCall === 'function' ? await baCall({ cache: name }) : null; return (r && r.data) || null; } catch (e) { return null; } };
  let terms = null, src = '', days = 0, at = '';
  for (const [name, d] of KW_PPC_SRC) {
    const c = await grab(name);
    if (c && c.d && Object.values(c.d).some(p => p && (p.rows || []).length)) { terms = c.d; src = name; days = d; at = c.at || ''; break; }
  }
  const ag = terms ? await grab('adGroup') : null;
  KW.ppc = { terms: terms || {}, groups: (ag && ag.d) || {}, days, src, at, loaded: true };
  return KW.ppc;
}
// Where a listing's family is: Listing Health's rows (ASIN → { parent, sku, price }), per brand.
function kwFamOf(brand) {
  const rows = (typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || [];
  if (KW.fam && KW.fam[brand] && KW.fam[brand].src === rows && KW.fam[brand].n === rows.length) return KW.fam[brand].m;
  const m = new Map();
  rows.forEach(r => { if (r.asin && !m.has(String(r.asin).toUpperCase())) m.set(String(r.asin).toUpperCase(), { fam: String(r.parent || r.asin), sku: r.sku, price: r.price }); });
  KW.fam = Object.assign(KW.fam || {}, { [brand]: { src: rows, n: rows.length, m } });
  return m;
}
/** { v, by: Map family → Map term → { t, c, sp, o, s, i, groups } } per brand — the PPC terms attributed to one family each. */
function kwPpcModel(brand) {
  const p = KW.ppc;
  if (!p || !p.src) return null;
  const fam = kwFamOf(brand);
  const key = KW.v + '|' + fam.size;
  KW.ppcM = KW.ppcM || {};
  if (KW.ppcM[brand] && KW.ppcM[brand].key === key) return KW.ppcM[brand];
  const groups = ((p.groups[brand] || {}).groups) || {};
  const by = new Map();
  (((p.terms[brand] || {}).rows) || []).forEach(r => {
    const t = String(r.t || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t || /^b0[a-z0-9]{8}$/.test(t) || /^asin="/.test(t)) return;           // a product it was shown on, not a customer's words
    const asins = ((groups[r.ag] || {}).a || []).map(a => String(a).toUpperCase());
    const fams = new Set(asins.map(a => (fam.get(a) || {}).fam || '').filter(Boolean));
    if (!asins.length || fams.size !== 1 || asins.some(a => !fam.has(a))) return;   // a group across families (or unknown ASINs): not one listing's
    const f = [...fams][0];
    if (!by.has(f)) by.set(f, new Map());
    const m = by.get(f);
    const b = m.get(t) || { t, i: 0, c: 0, sp: 0, o: 0, s: 0, asins: new Set() };
    b.i += +r.i || 0; b.c += +r.c || 0; b.sp += +r.sp || 0; b.o += +r.o || 0; b.s += +r.s || 0;
    asins.forEach(a => b.asins.add(a));
    m.set(t, b);
  });
  KW.ppcM[brand] = { key, by };
  return KW.ppcM[brand];
}
/** Is the PPC data there? { ok, days, text }. */
function kwPpcStatus() {
  const p = KW.ppc;
  if (!p || !p.loaded) return { ok: false, loading: true, text: 'Proven in our ads: reading…' };
  if (!p.src) return { ok: false, none: true, text: 'No PPC search-term data (the nightly cache is not there) — skipped' };
  const to = ['SP', 'CPC'].map(b => (p.terms[b] || {}).to).filter(Boolean).sort().pop() || '';
  return { ok: true, days: p.days, text: `Proven in our ads: Sponsored Products search terms, ${p.days} days${to ? ` up to ${kwDay(to)}` : ''} (nightly)` };
}
// The break-even ACoS of a listing (%), or null when its cost or price is not known (then any ACoS is fine).
function kwBreakEven(asin, price) {
  try { const v = typeof cpBreakEven === 'function' && asin && price > 0 ? cpBreakEven(asin, price) : null; return typeof v === 'number' && isFinite(v) ? v : null; } catch (e) { return null; }
}
/** The proven search terms of a listing's family: [{ t, c, o, sp, s, acos, ok, why }] by orders (every one with orders, ok = proven). */
function kwProvenTerms(brand, asin, fam, price) {
  const md = kwPpcModel(brand);
  if (!md || !fam) return [];
  const be = kwBreakEven(asin, price);
  return [...((md.by.get(fam) || new Map()).values())].map(b => {
    const acos = b.s > 0 ? b.sp / b.s * 100 : null;
    const why = b.o < KW_PPC_MIN_ORDERS ? `${b.o} order${b.o === 1 ? '' : 's'} (fewer than ${KW_PPC_MIN_ORDERS})` : be != null && acos != null && acos > be ? `ACoS ${Math.round(acos)}% over break-even ${Math.round(be)}%` : '';
    return Object.assign({}, b, { acos, ok: !why, why, be });
  }).sort((a, z) => z.o - a.o || z.c - a.c);
}
// The listing's own attribute words (Amazon's attributes: pattern, style, edge, material, theme, design, fabric, colour) — given (item.va),
// else the ListingMatch cache's copy of them; '' when none is known.
function kwAttrText(item) {
  let va = item.va;
  if (!va && item.sku && typeof lmGet === 'function') { try { const m = lmGet(item.sku, item.brand); va = m && m.va; } catch (e) { va = null; } }
  if (!va || typeof va !== 'object') return '';
  const val = v => (Array.isArray(v) ? v.map(x => (x && typeof x === 'object' ? x.value : x)).join(' ') : v && typeof v === 'object' ? v.value : v);
  return Object.keys(va).filter(k => /pattern|style|edge|material|theme|design|fabric|colou?r/i.test(k)).map(k => String(val(va[k]) == null ? '' : val(va[k]))).join(' ');
}
/** THE FILTERS both sources share, for one listing: term(keys, q) → '' when the search may give words; a word = skipped silently (it is
 *  about another shape, colour, size, a material the listing is NOT, something our cloth is not); '?word' = skipped because Sellora is
 *  not sure the product is that (29 Nov 2026: an edge — scalloped, fringe, lace…; a pattern — plaid, striped, floral…; a season; a
 *  material when the listing's is not known) — checked against the listing's title, attributes and colour, never guessed.
 *  word(k, w) → false when the word may not be added (in the title or the search terms already, a brand — ours or anyone's — a product,
 *  joining or low-value word, a claim, an ASIN or a number). */
function kwWordFilter(item, cfg) {
  const f = item.facts || {};
  const shape = f.shape || '';
  // its own colour with its close shades (listing-rules.js lrKwOwnColours: a Turquoise cloth may be teal or aqua)
  const colour = typeof lrKwOwnColours === 'function' ? lrKwOwnColours(f.colour) : new Set(kwKeys(f.colour));
  const mat = new Set(kwKeys(f.material));
  const nums = new Set(String(f.size || '').match(/\d+(?:\.\d+)?/g) || []);
  const have = new Set(kwKeys(item.title).concat(kwKeys(item.kw)));
  // what the product is said to BE: its title, its attributes, its colour, its material — never its search terms
  const sure = new Set(kwKeys(item.title).concat(kwKeys(kwAttrText(item)), [...colour], [...mat]));
  const blocked = kwBlocked(cfg);
  const season = kwSeasonPhrases(cfg);
  const vocab = new Set();
  KW_TYPE_P.forEach(([, ps]) => ps.forEach(p => p.forEach(k => vocab.add(k))));     // product words: the title has its own
  const shapeOf = typeof LR_SW_SHAPE_OF !== 'undefined' ? LR_SW_SHAPE_OF : new Map();
  // every colour word, shades too; the longer low-value list of search terms (30 Nov 2026)
  const colours = typeof LR_KW_COLOR_SET !== 'undefined' ? LR_KW_COLOR_SET : typeof LR_SW_COLOR_SET !== 'undefined' ? LR_SW_COLOR_SET : new Set();
  const low = typeof LR_KW_LOW_SET !== 'undefined' ? LR_KW_LOW_SET : typeof LR_SW_LOW_SET !== 'undefined' ? LR_SW_LOW_SET : new Set();
  const plain = k => (typeof LR_SW_STOP_SET !== 'undefined' && LR_SW_STOP_SET.has(k)) || low.has(k);
  // brand words to never add, a typing slip off too ("rhidi" — ours, two slips —, "anthropology")
  const ours = kwOurPhrases().filter(p => p.length === 1 && p[0].length >= 5).map(p => p[0]);
  const slip = [...kwBrandKeys(cfg)].filter(k => k.length >= 5).concat(kwOthers(cfg).map(b => kwKey(b)), cfg && typeof lrAllow === 'function' && typeof lrWords === 'function' ? lrWords(lrAllow(cfg).otherBrands).map(b => kwKey(b)) : []);
  const risky = w => { try { return typeof ipgFind === 'function' && cfg ? ipgFind(w, cfg).length > 0 : false; } catch (e) { return false; } };
  return {
    term: (keys, q, words) => {
      // '' = fine; '!what' = skipped, it is not this product ("not its colour (salmon)"); '?what' = skipped, not sure the product is so
      const w = k => (words && words[keys.indexOf(k)]) || k;
      const sh = keys.find(k => shapeOf.has(k) && shapeOf.get(k) !== shape && !sure.has(k));
      if (sh) return shape ? '!not its shape (' + w(sh) + ')' : '?' + w(sh);
      const co = keys.find(k => colours.has(k) && !colour.has(k) && !sure.has(k));
      if (co) return colour.size ? '!not its colour (' + w(co) + ')' : '?' + w(co);
      const size = (String(q).match(/\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)*/g) || []).find(s => (s.match(/\d+(?:\.\d+)?/g) || []).some(n => !nums.has(n)));
      if (size) return '!not its size (' + size.replace(/\s+/g, '') + ')';
      const nt = KW_NOT_P.find(p => kwHasSeq(keys, p));
      if (nt) return '!not for our cloth (' + nt.join(' ') + ')';
      // another table, user or size: card table, kids, small, king…
      const fit = KW_FIT_P.find(([p]) => kwHasSeq(keys, p) && !p.every(k => sure.has(k)));
      if (fit) return '?' + fit[1];
      // a material: known and another one → not ours; not known → not sure
      const m = keys.find(k => KW_MAT_SET.has(k) && !sure.has(k));
      if (m) return mat.size ? '!not its material (' + w(m) + ')' : '?' + w(m);
      // an edge or a pattern the title, attributes and colour do not say
      const e = keys.find(k => (KW_EDGE_SET.has(k) || KW_PAT_SET.has(k)) && !sure.has(k));
      if (e) return '?' + w(e);
      // a season the product is not said to be for
      const s = season.find(p => kwHasSeq(keys, p) && !p.every(k => sure.has(k)));
      if (s) {                                         // said as written ("christmas"), not as compared ("christma")
        const at = keys.findIndex((k, i) => s.every((x, j) => keys[i + j] === x));
        return '?' + (words && at >= 0 ? words.slice(at, at + s.length).map(x => String(x).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).join(' ') : s.join(' '));
      }
      return '';
    },
    word: (k, w) => !(k.length < 3 || /\d/.test(k) || have.has(k) || blocked.has(k) || vocab.has(k) || plain(k) || /^b0[a-z0-9]{8}$/.test(k) || risky(w)
      || (colours.has(k) && !colour.has(k)) || (typeof lrKwBrandSlip === 'function' && (!!lrKwBrandSlip(k, slip) || !!lrKwBrandSlip(k, ours, 2)))),
  };
}
/** FOR THE ✨ AI ANSWER (2 Dec 2026): the words the AI ADDED (not in the search terms before) that are not this product, by the same
 *  checks as the words Sellora adds (kwWordFilter.term, one word — or two together: "card table", "black friday"): another shape or
 *  colour, something our cloth is not, a fit, a season / pattern / edge / material the listing does not say. Words with digits are
 *  left to the size rule. item: { brand, sku, title, kw (before), facts, cfg, va }; words: the answer's words as written.
 *  → Map index → reason ("skipped: not sure the product is christmas", "skipped: not its shape (round)"). */
function kwAiNotThis(item, words) {
  const out = new Map();
  const cfg = item.cfg || (typeof LR !== 'undefined' && LR) || (typeof LR_DEFAULT !== 'undefined' ? LR_DEFAULT : null);
  const flt = kwWordFilter(item, cfg);
  const had = new Set(kwKeys(item.kw));
  const keys = words.map(w => kwKey(String(w).replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, '')));
  const say = code => (code[0] === '?' ? `skipped: not sure the product is ${code.slice(1)}` : `skipped: ${code.slice(1)}`);
  const plainW = (i, j) => keys.slice(i, j + 1).every(k => k && !had.has(k) && !/\d/.test(k));
  for (let i = 0; i < keys.length; i++) {
    if (!plainW(i, i)) continue;
    const one = flt.term([keys[i]], words[i], [words[i]]);
    if (one && (one[0] === '?' || one[0] === '!')) { out.set(i, say(one)); continue; }
    if (i + 1 < keys.length && plainW(i + 1, i + 1)) {
      const two = flt.term([keys[i], keys[i + 1]], words[i] + ' ' + words[i + 1], [words[i], words[i + 1]]);
      if (two && (two[0] === '?' || two[0] === '!') && !flt.term([keys[i + 1]], words[i + 1], [words[i + 1]])) { out.set(i, say(two)); out.set(i + 1, say(two)); i++; }
    }
  }
  return out;
}
// A proven word's reason, as every screen shows it; and when it took the room of the listing's own unproven words, which ones.
const kwReplacesText = list => (list && list.length ? ` replaces ${list.join(', ')} (no orders)` : '');
const kwPpcWhy = e => `PPC: ${kwNf(e.orders)} order${e.orders === 1 ? '' : 's'} from '${e.term}' in ${e.days} days`;
/** item: { brand, sku, asin, parent, price, title, kw, facts (lrSwFacts), pt, cfg } → { status (the scout), ppc (its status), type,
 *  words: [{ w, k, why, src: 'ppc' | 'scout', … }] } — the words this listing may take, in the order they are added: the words PROVEN in
 *  our own ads first (by orders), then the bestseller words of its product type (most used first). Each source is skipped when its data
 *  is missing. */
function kwWinFor(item) {
  item = item || {};
  const status = kwStatus(), ppc = kwPpcStatus();
  const out = { status, ppc, type: '', words: [], proven: 0, proof: [], skipped: [] };
  const f = item.facts || {};
  const type = kwTypeOfListing(f, item.pt, item.title);
  out.type = type;
  if (!status.ok && !ppc.ok) return out;
  // its ASIN, family and price: given, else its Listing Health row
  let asin = String(item.asin || '').toUpperCase(), fam = item.parent || '', price = item.price;
  if ((!asin || !fam) && item.sku) {
    const row = ((typeof HEALTH !== 'undefined' && HEALTH[item.brand] && HEALTH[item.brand].rows) || []).find(r => r.sku === item.sku);
    if (row) { asin = asin || String(row.asin || '').toUpperCase(); fam = fam || row.parent || ''; price = price != null ? price : row.price; }
  }
  if (!fam && asin) fam = (kwFamOf(item.brand).get(asin) || {}).fam || asin;
  const memoKey = [KW.v, type, item.brand, fam, asin, price, f.shape, f.colour, f.material, f.size, item.title, item.kw, kwAttrText(item)].join('\u0001');
  if (KW.win.has(memoKey)) { const m = KW.win.get(memoKey); return Object.assign(out, { words: m.words, proven: m.proven, proof: m.proof, skipped: m.skipped }); }
  const cfg = item.cfg || (typeof LR !== 'undefined' && LR) || (typeof LR_DEFAULT !== 'undefined' ? LR_DEFAULT : null);
  const flt = kwWordFilter(item, cfg);
  // SKIPPED — words of a search Sellora is not sure describe this product: "skipped: not sure the product is scalloped" (once per word)
  const skipped = new Map();
  // code: '?what' (not sure the product is so) or '!what' (it is not: "not its colour (salmon)") — each once
  const unsure = (code, term, from) => { if (skipped.has(code)) return; const w = code.slice(1); skipped.set(code, { w, term, from, sure: code[0] === '!', why: code[0] === '?' ? `skipped: not sure the product is ${w}` : `skipped: ${w}` }); };
  // PROOF (28 Nov 2026): the listing's own words that have evidence — a word of a search with an order in our ads, or a word the top
  // bestsellers of its type use (the scout). A proven word never pushes those out (listing-rules.js lrSuggestWords step 3c), only words without.
  const proof = new Set();
  // 1 PROVEN IN OUR ADS — by orders
  const proven = new Map();
  if (ppc.ok) {
    const terms = kwProvenTerms(item.brand, asin, fam, price);
    terms.forEach(t => { if (t.o >= 1) kwKeys(t.t).forEach(k => proof.add(k)); });
    terms.filter(t => t.ok).forEach(t => {
      const ww = kwWords(t.t);
      const no = flt.term(ww.keys, t.t, ww.words);
      if (no) { if (no[0] === '?' || no[0] === '!') unsure(no, t.t, `PPC: ${kwNf(t.o)} orders`); return; }
      ww.keys.forEach((k, j) => {
        if (proven.has(k) || !flt.word(k, ww.words[j])) return;
        proven.set(k, { w: ww.words[j], k, src: 'ppc', term: t.t, orders: t.o, clicks: t.c, acos: t.acos, days: KW.ppc.days });
      });
    });
  }
  // 2 BESTSELLER WORDS — the words the top bestsellers of its product type use (the scout), most used first. They only take the room
  // left over: listing-rules.js drops them before any of the listing's own words (step 3b), and they never replace one.
  const best = new Map();
  if (status.ok && type) {
    const sw = kwScoutWords(type, cfg);
    // a word of a phrase only when the scout kept it on its own too ("style look": never "look" — a low-value word)
    const alone = new Set(sw.filter(e => e.keys.length === 1).map(e => e.keys[0]));
    sw.forEach(e => {
      e.keys.forEach(k => proof.add(k));
      const no = flt.term(e.keys, e.w, e.words);
      if (no) { if (no[0] === '?' || no[0] === '!') unsure(no, e.w, `Bestseller scout: ${kwNf(e.n)} of the top ${kwNf(e.of)}`); return; }
      e.keys.forEach((k, j) => {
        if (proven.has(k) || best.has(k) || !alone.has(k) || !flt.word(k, e.words[j])) return;
        best.set(k, { w: e.words[j], k, src: 'scout', term: e.w, n: e.n, of: e.of, share: e.share, rank: e.r, phrase: e.keys.length > 1 });
      });
    });
  }
  const pw = [...proven.values()].sort((a, z) => z.orders - a.orders).map(e => Object.assign(e, { why: kwPpcWhy(e), proven: true }));
  const bw = [...best.values()].map(e => Object.assign(e, { why: kwScoutWhy(e) }));        // most used first, as the scout listed them
  const words = pw.concat(bw).slice(0, KW_MAX_WORDS);
  if (KW.win.size > 3000) KW.win.clear();
  const pf = [...proof];
  const sk = [...skipped.values()].filter(x => !words.some(w => w.k === kwKey(x.w)));
  KW.win.set(memoKey, { words, proven: Math.min(pw.length, KW_MAX_WORDS), proof: pf, skipped: sk });
  return Object.assign(out, { words, proven: Math.min(pw.length, KW_MAX_WORDS), proof: pf, skipped: sk });
}
/** A reason as the preview shows it: duplicate · other brand · low value · limit (the rule's own words otherwise). */
function kwWhyLabel(why) {
  const w = String(why || '');
  if (w === 'repeated') return 'duplicate';
  if (/another brand|other brand/.test(w)) return 'other brand';
  if (/restricted claim/.test(w)) return 'restricted claim';
  if (w === 'low-value word' || w === 'stop word') return 'low value';
  if (w === 'cut to fit' || w === 'limit') return 'limit';
  if (w === 'in the title') return 'limit — the title already says it';
  if (w === 'replaced') return 'replaced (no orders)';
  return w;
}
// The protected class of a kept word, said plainly (the 🔒 tip).
const KW_LOCK = { brand: 'our brand', identity: 'hand block print', product: 'its product', shape: 'its shape', material: 'its material', colour: 'its colour', size: 'its size', uses: 'a use word', keep: 'a season on now' };

/* ============================================================================================
 * 4. THE PANEL: Listing → Listing Rules, "Winning keywords"
 * ============================================================================================ */
// The words our listings of a type already use (titles and search terms of both brands, Listing Health's rows): Set of keys, or null.
function kwOurWords(type) {
  const rows = ['SP', 'CPC'].flatMap(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).map(r => ({ b, r })));
  if (!rows.length) return null;
  const key = KW.v + '|' + rows.length;
  if (!KW.used || KW.used.key !== key) KW.used = { key, m: new Map() };
  if (KW.used.m.has(type)) return KW.used.m.get(type);
  const s = new Set();
  rows.forEach(({ b, r }) => {
    const title = typeof hTitleText === 'function' ? hTitleText(r) : (r.title || '');
    const m = typeof lmGet === 'function' ? lmGet(r.sku, b) : null;
    if (kwTypeOfListing(null, (m && m.pt) || r.pt, title) !== type) return;
    kwKeys(title + ' ' + ((m && m.kw) || '')).forEach(k => s.add(k));
  });
  KW.used.m.set(type, s);
  return s;
}
// A word of a search that says something to use: not a joining word, not a number, not a brand's name (never "missing: etopia").
function kwPlainWord(k, brands) { return !(typeof LR_SW_STOP_SET !== 'undefined' && LR_SW_STOP_SET.has(k)) && !/^\d/.test(k) && !brands.has(k); }
// The product types the scout read, ours first (in KW_TYPES' order).
function kwScoutTypes() {
  const ty = (KW.scout && KW.scout.types) || {};
  const order = KW_TYPES.map(x => x[0]);
  const at = t => (order.indexOf(t) + 1) || 99;
  return Object.keys(ty).sort((a, z) => at(a) - at(z) || (a < z ? -1 : 1));
}
// One type's words with "we use it?" (every word of it in our titles / search terms of that type; null when Listing Health is not open).
function kwScoutRows(type) {
  const used = kwOurWords(type);
  return kwScoutWords(type).filter(e => !KW.q || e.w.includes(KW.q)).map(e => Object.assign({}, e, { use: used ? e.keys.every(k => used.has(k)) : null }));
}
function kwScoutRunHtml() {
  const s = KW.scout;
  const at = s && (s.at || (s.ms ? kwIso(s.ms) : ''));
  const last = at ? `Last run: ${kwDay(at)}${/\d\d:\d\d/.test(at) ? ' ' + at.slice(11, 16) : ''}${s.by ? ` (${kwEsc(s.by)})` : ''}${s.ms ? ` · next weekly run about ${kwDay(kwIso(s.ms + 7 * 864e5))}` : ''}` : "The scout hasn't run yet";
  return `<div class="kw-run"><span class="muted">${last}</span><button type="button" class="ghost" data-kw-act="run"${KW.running ? ' disabled' : ''}>${KW.running ? '⏳ Running…' : '↻ Run now'}</button>`
    + `${KW.runMsg ? `<span class="kw-msg${KW.runErr ? ' kw-none' : ''}" role="status">${kwEsc(KW.runMsg)}</span>` : ''}</div>`;
}
function kwScoutPanelHtml() {
  const st = kwStatus();
  const s = KW.scout || {};
  const pct = Math.round(Math.max(KW_SCOUT_MIN, +s.min || 0) * 100);
  const what = `<p class="muted kw-what">Each week Sellora searches Amazon's catalogue for each of our product types and reads the titles and bullet points of the top ${kwNf(s.top || 25)} results by Best Seller Rank that are not ours. A word or 2–3 word phrase that ${pct}% or more of them use is shown here — never a brand's name (theirs, ours, the IP &amp; Trademark Guard's), an ASIN, a number or a joining word. Fix all search terms, Listing Errors, Listing Content, ✨ AI and Create Listing add the missing ones to a listing's search terms only in the room left over — after the words proven in our ads, never pushing out the listing's own words, with every word rule.</p>`;
  const run = kwScoutRunHtml();
  const types = kwScoutTypes();
  if (!types.length) return what + run + `<p class="kw-msg kw-none">${kwEsc(st.text)}</p>`;
  const type = KW.stype && types.includes(KW.stype) ? KW.stype : types[0];
  const t = s.types[type];
  const name = kwTypeName(type).toLowerCase();
  const rows = kwScoutRows(type);
  const used = kwOurWords(type);
  const sel = `<select data-kw-f="stype" aria-label="Product type">${types.map(x => `<option value="${kwEsc(x)}"${x === type ? ' selected' : ''}>${kwEsc(kwTypeName(x))} (${kwNf(kwScoutWords(x).length)})</option>`).join('')}</select>`;
  const tools = `<div class="kw-tools">${sel}<input type="search" data-kw-f="q" placeholder="Search a word…" value="${kwEsc(KW.q)}" aria-label="Search the bestseller words"><span style="flex:1"></span>`
    + `<button type="button" class="ghost" data-kw-act="csv">⬇ CSV (${kwNf(kwScoutCsvRows().length)})</button></div>`;
  const body = rows.slice(0, KW.limit).map(e => `<tr><td>${kwEsc(e.w)}</td><td class="num"><b>${Math.round(e.share * 100)}%</b> <small class="muted">${kwNf(e.n)} of ${kwNf(e.of)}</small></td>`
    + `<td class="num">${e.r ? '#' + kwNf(e.r) : '—'}</td><td>${e.use == null ? '<span class="muted">—</span>' : e.use ? '<span class="kw-yes">✓ yes</span>' : '<span class="kw-no">no</span>'}</td>`
    + `<td class="muted">${kwEsc(kwDay(t.at || (t.ms ? kwIso(t.ms) : '')))}</td></tr>`).join('');
  const more = rows.length > KW.limit ? `<button type="button" class="ghost" data-kw-act="more">Show more (${kwNf(rows.length - KW.limit)} left)</button>` : '';
  const empty = t.err && !t.n ? kwEsc(t.err) : `No word that ${pct}% of the top ${name} bestsellers use${KW.q ? ` with "${kwEsc(KW.q)}"` : ''}.`;
  const table = `<div class="xlwrap kw-tw"><table class="xl kw-t kw-st"><thead><tr><th>Word / phrase</th><th class="num">Bestsellers using it</th><th class="num">Best rank seen</th><th>We use it?</th><th>Last run</th></tr></thead>`
    + `<tbody>${body || `<tr><td colspan="5" class="ui-empty">${empty}</td></tr>`}</tbody></table></div>`;
  const items = (t.items || []).slice(0, 30).map(it => `<li><b>${kwEsc(it.b || '—')}</b> <span class="muted">#${kwNf(it.r)} · ${kwEsc(it.a)}</span> ${kwEsc(it.t)}</li>`).join('');
  const foot = `<p class="muted kw-foot">"${kwEsc(t.q || name)}": the top ${kwNf(t.n || 0)} bestsellers of ${kwNf(t.scanned || 0)} results${t.ours ? ` · ${kwNf(t.ours)} of ours left out` : ''}${t.other ? ` · ${kwNf(t.other)} of another product type left out` : ''}`
    + ` · "We use it?" = every word of it is in the titles or search terms of our ${kwEsc(name)}${used ? '' : ' (open Listing Health to see which words we use)'}${t.err && t.n ? ' · ' + kwEsc(t.err) : ''} ${more}</p>`
    + (items ? `<details class="kw-bs"><summary>The ${kwNf((t.items || []).length)} bestsellers read</summary><ol>${items}</ol></details>` : '');
  return what + run + (st.ok ? '' : `<p class="kw-msg kw-none">${kwEsc(st.text)}</p>`) + tools + table + foot;
}
/* ---- the panel's two tabs: 📈 Proven in our ads (the nightly PPC search terms) · 🔎 Bestseller words (the scout) ---- */
function kwPanelHtml() {
  const st = kwStatus(), pp = kwPpcStatus();
  const tab = KW.tab === 'scout' || KW.tab === 'ppc' ? KW.tab : (pp.ok ? 'ppc' : 'scout');
  const head = `<div class="kw-h"><b>🏆 Winning keywords</b><span class="${pp.ok ? 'muted' : 'kw-none'}">📈 ${kwEsc(pp.text)}</span><span class="${st.ok ? 'muted' : 'kw-none'}">· 🔎 ${kwEsc(st.text)}</span></div>`;
  const b = (k, t) => `<button type="button" class="segbtn${tab === k ? ' on' : ''}" data-kw-tab="${k}" aria-pressed="${tab === k}">${t}</button>`;
  const tabs = `<div class="seg kw-tabs" role="group" aria-label="Which words">${b('ppc', '📈 Proven in our ads')}${b('scout', '🔎 Bestseller words')}</div>`;
  return head + tabs + (tab === 'ppc' ? kwPpcPanelHtml() : kwScoutPanelHtml());
}
// One family of ours: { name, asin, price, words (Set of the keys of its titles and search terms) } — from Listing Health's rows.
function kwFamInfo(brand, fam) {
  const rows = ((typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || []).filter(r => String(r.parent || r.asin) === String(fam));
  const key = KW.v + '|' + brand + '|' + fam + '|' + rows.length;
  KW.famInfo = KW.famInfo || new Map();
  if (KW.famInfo.has(key)) return KW.famInfo.get(key);
  const words = new Set();
  rows.forEach(r => {
    const title = typeof hTitleText === 'function' ? hTitleText(r) : (r.title || '');
    const m = typeof lmGet === 'function' ? lmGet(r.sku, brand) : null;
    const live = typeof LI_WS !== 'undefined' && LI_WS.live && LI_WS.live[brand] ? LI_WS.live[brand][r.sku] : null;
    kwKeys(title + ' ' + ((live && live.kw) || (m && m.kw) || '')).forEach(k => words.add(k));
  });
  const name = (typeof parentName === 'function' ? parentName(brand, fam, '') : '') || (rows[0] ? (typeof hTitleText === 'function' ? hTitleText(rows[0]) : rows[0].title) : '') || fam;
  const out = { name, asin: rows[0] ? String(rows[0].asin || '').toUpperCase() : '', price: rows[0] ? rows[0].price : null, words, n: rows.length };
  if (KW.famInfo.size > 5000) KW.famInfo.clear();
  KW.famInfo.set(key, out);
  return out;
}
/** Every search term with an order, per family, the brand filter and the search box applied: by orders. */
function kwPpcRows() {
  const out = [];
  const brands = new Set(kwBrandKeys((typeof LR !== 'undefined' && LR) || null));
  ['SP', 'CPC'].filter(b => KW.ppcBrand === 'ALL' || KW.ppcBrand === b).forEach(b => {
    const md = kwPpcModel(b);
    if (!md) return;
    md.by.forEach((m, fam) => {
      const fi = kwFamInfo(b, fam);
      kwProvenTerms(b, fi.asin, fam, fi.price).forEach(t => {
        if (!(t.o >= 1) || (KW.q && !t.t.includes(KW.q))) return;
        const ww = kwWords(t.t);
        const miss = ww.keys.map((k, j) => ({ k, w: ww.words[j] })).filter(x => kwPlainWord(x.k, brands) && !fi.words.has(x.k)).map(x => x.w);
        out.push(Object.assign({}, t, { brand: b, fam, name: fi.name, miss, inKw: !miss.length }));
      });
    });
  });
  return out.sort((a, z) => z.o - a.o || z.c - a.c);
}
function kwPpcPanelHtml() {
  const pp = kwPpcStatus();
  if (!pp.ok) return `<p class="kw-msg kw-none">${kwEsc(pp.text)}</p>`;
  const list = kwPpcRows();
  const sel = `<select data-kw-f="ppcBrand" aria-label="Brand">${[['ALL', 'Both brands'], ['SP', 'Ridhi'], ['CPC', 'CPC']].map(([v, t]) => `<option value="${v}"${KW.ppcBrand === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const tools = `<p class="muted kw-what">Customer search terms from our own Sponsored Products ads, per listing family (an ad group's terms count for a family only when every product it advertises is in that family). Proven = ${KW_PPC_MIN_ORDERS}+ orders in ${pp.days} days and the ACoS not over the listing's break-even (when its cost is known). Their missing words are added to that family's search terms FIRST (by orders), before the bestseller words — with the same rules.</p>`
    + `<div class="kw-tools">${sel}<input type="search" data-kw-f="q" placeholder="Search a word…" value="${kwEsc(KW.q)}" aria-label="Search the search terms"><span style="flex:1"></span><button type="button" class="ghost" data-kw-act="csv">⬇ CSV (${kwNf(list.length)})</button></div>`;
  const rows = list.slice(0, KW.limit).map(t => `<tr><td>${kwEsc(t.t)}</td><td><span class="kw-fam" title="${kwEsc(t.fam)}">${kwEsc(String(t.name).slice(0, 60))}</span> <small class="muted">${t.brand === 'CPC' ? 'CPC' : 'Ridhi'}</small></td>`
    + `<td class="num">${kwNf(t.c)}</td><td class="num">${kwNf(t.o)}</td><td class="num">${t.acos == null ? '—' : Math.round(t.acos) + '%'}</td>`
    + `<td>${t.ok ? '<span class="kw-yes">✓ proven</span>' : `<span class="muted">${kwEsc(t.why)}</span>`}</td>`
    + `<td>${t.inKw ? '<span class="kw-yes">✓ yes</span>' : `<span class="kw-no">missing: ${kwEsc(t.miss.slice(0, 4).join(', '))}</span>`}</td></tr>`).join('');
  const more = list.length > KW.limit ? `<button type="button" class="ghost" data-kw-act="more">Show more (${kwNf(list.length - KW.limit)} left)</button>` : '';
  return tools + `<div class="xlwrap kw-tw"><table class="xl kw-t kw-pt"><thead><tr><th>Search term</th><th>Listing family</th><th class="num">Clicks</th><th class="num">Orders</th><th class="num">ACoS</th><th>Proven?</th><th>Already in keywords?</th></tr></thead>`
    + `<tbody>${rows || '<tr><td colspan="7" class="ui-empty">No search term with an order for this brand.</td></tr>'}</tbody></table></div>`
    + `<p class="muted kw-foot">Showing ${kwNf(Math.min(KW.limit, list.length))} of ${kwNf(list.length)} search terms with an order · words of the family's titles and search terms count as "in keywords" ${more}</p>`;
}
const KW_PPC_CSV_COLS = ['Brand', 'Listing family', 'Family name', 'Search term', 'Clicks', 'Orders', 'Spend', 'Sales', 'ACoS', 'Break-even ACoS', 'Proven', 'Why not', 'Already in keywords', 'Missing words', 'Window (days)'];
function kwPpcCsv() {
  const list = kwPpcRows();
  const lines = list.map(t => [t.brand === 'CPC' ? 'CPC' : 'Ridhi', t.fam, t.name, t.t, t.c, t.o, Math.round(t.sp * 100) / 100, Math.round(t.s * 100) / 100, t.acos == null ? '' : Math.round(t.acos) + '%',
    t.be == null ? '' : Math.round(t.be) + '%', t.ok ? 'yes' : 'no', t.why, t.inKw ? 'yes' : 'no', t.miss.join(' '), (KW.ppc && KW.ppc.days) || ''].map(kwCsvQ).join(','));
  return { n: lines.length, text: '﻿' + [KW_PPC_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function kwPanelDraw() {
  const box = typeof $ === 'function' ? $('kwWin') : null;
  if (!box) return;
  if (!KW.loaded) kwLoad();
  box.innerHTML = kwPanelHtml();
}
const kwCsvQ = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
// Every product type's bestseller words (the search box applied): [type, entry].
function kwScoutCsvRows() { return kwScoutTypes().flatMap(t => kwScoutRows(t).map(e => [t, e])); }
const KW_SCOUT_CSV_COLS = ['Product type', 'Search', 'Word / phrase', 'Bestsellers using it', 'Of the top', 'Share', 'Best rank seen', 'We use it', 'Last run'];
/** The sheet: every product type's bestseller words, Excel-ready (UTF-8 BOM, CRLF). */
function kwScoutCsv() {
  const lines = kwScoutCsvRows().map(([t, e]) => {
    const x = KW.scout.types[t];
    return [kwTypeName(t), x.q || '', e.w, e.n, e.of, Math.round(e.share * 100) + '%', e.r || '', e.use == null ? '' : e.use ? 'yes' : 'no', x.at || (x.ms ? kwIso(x.ms) : '')].map(kwCsvQ).join(',');
  });
  return { n: lines.length, text: '\uFEFF' + [KW_SCOUT_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function kwDownload() {
  const ppc = KW.tab === 'ppc' || (!KW.tab && kwPpcStatus().ok);
  const out = ppc ? kwPpcCsv() : kwScoutCsv();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = ppc ? `Sellora-proven-in-our-ads-${kwIso(Date.now())}.csv` : `Sellora-bestseller-words-${kwIso(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('#kwWin [data-kw-act], #kwWin [data-kw-tab]') : null;
    if (!t) return;
    if (t.dataset.kwAct === 'csv') return kwDownload();
    if (t.dataset.kwAct === 'run') return kwScoutRun();
    if (t.dataset.kwTab) { KW.tab = t.dataset.kwTab === 'ppc' ? 'ppc' : 'scout'; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
    if (t.dataset.kwAct === 'more') { KW.limit += KW_KEEP_ROWS; return kwPanelDraw(); }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (!el || !el.closest || !el.closest('#kwWin')) return;
    if (el.dataset && el.dataset.kwF === 'stype') { KW.stype = el.value; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
    if (el.dataset && el.dataset.kwF === 'ppcBrand') { KW.ppcBrand = el.value || 'ALL'; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el || !el.dataset || el.dataset.kwF !== 'q' || !el.closest || !el.closest('#kwWin')) return;
    KW.q = String(el.value || '').trim().toLowerCase();
    KW.limit = KW_KEEP_ROWS;
    clearTimeout(KW.qt);
    KW.qt = setTimeout(() => { kwPanelDraw(); const box = $('kwWin'); const q = box && box.querySelector('[data-kw-f="q"]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250);
  });
}
/** CONSOLE: `kwReport()` — both sources and, per product type, the bestseller words; `kwReport('RTC14-1')` — that listing's winning
 *  words (Listing Health loaded) and its search terms before → after. */
function kwReport(sku) {
  const out = { status: kwStatus().text, ppc: kwPpcStatus().text, types: {} };
  kwScoutTypes().forEach(t => {
    const x = KW.scout.types[t], w = kwScoutWords(t);
    out.types[kwTypeName(t)] = { search: x.q, bestsellers: x.n, words: w.length, top: w.slice(0, 6).map(e => `${e.w} ${Math.round(e.share * 100)}%`).join(' · '), err: x.err || '' };
  });
  console.table(out.types);
  if (sku && typeof kfItemOf === 'function' && typeof hCtx === 'function') {
    const ctx = hCtx();
    for (const brand of ['SP', 'CPC']) {
      const row = ((typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || []).find(r => r.sku === sku);
      if (!row) continue;
      const it = kfItemOf(brand, row, ctx, null);
      const s = kfShorten(it.kw, { title: it.title, brands: it.brands, risk: it.risk, facts: it.facts, add: it.win.words, proof: it.win.proof, others: it.others });
      out.example = { sku, type: it.win.type, words: it.win.words.slice(0, 10).map(w => `${w.w} (${w.why})`), before: s.before, after: s.after, bytes: `${s.bytesBefore} → ${s.bytesAfter}`,
        added: s.added.map(a => a.w).join(' '), removed: s.removed.map(r => `${r.w} (${kwWhyLabel(r.why)})`).join(', ') };
      console.log(out.example);
      break;
    }
  }
  return out;
}
