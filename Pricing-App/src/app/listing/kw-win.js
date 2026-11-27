/* ================= LISTING · WINNING KEYWORDS: the searches other brands win, per product type — for every search-terms suggestion =================
 * Screen: Listing → Listing Rules, the "Winning keywords" card under the rules (kwPanelHtml): the upload; per product type the top
 *   searches, who wins them (brand), click / conversion share, and whether our listings already use their words; a brand filter
 *   (Angry Orange, Etopia, Maison and every brand the data names) and a CSV of what is on screen.
 * DATA (kwLoad) — never made up, never guessed:
 *   1. Brand Analytics → Top search terms, downloaded from Seller Central (search a product word — "tablecloth", "napkin"… — then
 *      Generate download → CSV): per search its Search Frequency Rank and its 3 most clicked products (ASIN, product title, brand when
 *      the file has the "Top Clicked Brand" columns, click share, conversion share). Kept in the shared history collection as
 *      history/kwwin_<n> (kind 'kwwin'), chunked like the Customer Returns uploads; a new upload replaces the searches it shares (a
 *      search is never counted twice). The whole-Amazon report Sellora can ask for by itself (Analytics → Top search terms) keeps
 *      only the 1,000 most searched terms of ALL Amazon (Pricing-API/BrandAnalytics.gs baShape_) — no tablecloth search is in it — so
 *      it is not used here.
 *   2. Brand Analytics → Search Query Performance (Brand view, CSV), per brand: OUR impressions / clicks / purchases per search —
 *      history/kwsqp_<brand>_<n> (kind 'kwsqp'). Shown in the panel ("we sold 4"); the suggestion does not need it.
 *   3. (28 Nov 2026) PROVEN IN OUR ADS — no upload needed: our own Sponsored Products customer search terms from the nightly caches
 *      (stD60 when the backend writes it, else srchTerm: 30 days) with adGroup (which ASINs each ad group advertises). Per listing
 *      FAMILY, the terms with ORDERS >= 2 and an ACoS not over its break-even (when known): their words are added FIRST, by orders,
 *      before the Brand Analytics words (kwWinFor). "PPC: 14 orders from 'farmhouse tablecloth' in 30 days". Panel tab "Proven in our ads".
 *   Nothing uploaded, or the newest week older than KW_OLD_DAYS: "No winning-keyword data (updated <date>)" — every suggestion then
 *   only applies our word rules and the 249-byte limit (listing-rules.js lrSuggestWords), no word is added.
 * A SEARCH OTHER BRANDS WIN: its top-3 products that are not ours hold a conversion share ≥ 3 % (or a click share ≥ 8 %). Its brand:
 *   the file's brand column, else a watched brand in the product title, else the title's first words before a product / colour / shape
 *   word (a guess — used only to name it and to never ADD it; only a real brand column or a watched brand is ever taken OUT).
 *   score = the competitors' conversion share ÷ the search frequency rank (best first).
 * A LISTING'S WINNING WORDS (kwWinFor): the winning searches of ITS product type (tablecloth, napkin, placemat, runner, pillow cover…);
 *   a search that names another shape, colour, size or material than the listing's, a pattern the listing does not say (buffalo plaid,
 *   gingham…), a season (the Season planner adds those, in their window) — or something our cloth is not (waterproof, vinyl,
 *   disposable, a napkin ring…) — is skipped whole; from the rest, every word that is not in the title or the search terms already,
 *   not a brand (ours or anyone's), not a joining / low-value word, not a restricted claim, not an ASIN or a number. (29 Nov 2026) An edge (scalloped, fringe, lace…), a pattern (plaid, striped, floral…), a season or
 *   (when the listing's is not known) a material is only added when its title, attributes or colour say the product is so — else
 *   the search is skipped and said: "skipped: not sure the product is scalloped". Each carries its reason: "wins for Maison on 'farmhouse tablecloth rectangle', search rank 12,400".
 * Used by: kw-fix.js (Fix all search terms: the Workspace row and the Listing Errors card), listing-content.js lcSuggestKeywords,
 *   listing-ai.js (✨ AI kw: the words are sent, its answer goes through the same rule), create-listing.js. The rule itself — the only
 *   place a word is added or taken out — is listing-rules.js lrSuggestWords.
 * WRITES only the uploaded rows (history/kwwin_*, history/kwsqp_*) — never on the test site (kept in that visit only).
 * Main functions: kwParse, kwParseTerms, kwParseSqp, kwUpload, kwLoad, kwEnsure, kwModel, kwTypeOf, kwTypeOfListing, kwWinFor, kwOthers,
 *   kwStatus, kwWhyLabel, kwPanelHtml, kwPanelDraw, kwCsv, kwReport (console). Names kw / KW. Tests: tests/kw-win-test.js. */

const KW_FOCUS = ['Angry Orange', 'Etopia', 'Maison'];       // the brands the team watches (Maison = Maison d' Hermine)
const KW_CHUNK = 700;                                        // searches per history/kwwin_<n> document
const KW_OLD_DAYS = 45;                                      // older than this: not used ("No winning-keyword data (updated …)")
const KW_MIN = { conv: 0.03, click: 0.08 };                  // a search other brands WIN: their conversion share ≥ 3 % or click share ≥ 8 %
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

const KW = { terms: null, sqp: { SP: null, CPC: null }, v: 0, loaded: false, busy: null, err: '', msg: '', upBrand: 'SP', type: '', brand: 'ALL', tab: '', ppcBrand: 'ALL', ppc: null, q: '', limit: KW_KEEP_ROWS,
  model: null, win: new Map(), others: null, ours: null };
const kwTest = () => typeof sqIsTest === 'function' && sqIsTest();
const kwEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const KW_NUM = new Intl.NumberFormat('en-US');
const kwNf = n => KW_NUM.format(Number(n || 0));
const kwPct = v => (v == null || !isFinite(v) ? '—' : (Math.round(v * 1000) / 10).toFixed(1) + '%');
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

/* ============================================================================================
 * 1. READING THE FILES (pure)
 * ============================================================================================ */
// A CSV / tab text → rows of cells (quotes as Excel writes them).
function kwTable(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const nl = s.search(/\r?\n/), first = nl < 0 ? s : s.slice(0, nl);
  const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  const endRow = () => { row.push(cell); cell = ''; if (row.some(c => String(c).trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') { cell += '"'; i++; }
      else q = false;
    } else if (ch === '"' && cell.trim() === '') { cell = ''; q = true; }
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows.map(r => r.map(c => String(c).trim()));
}
// "1,234" → 1234; "12.5%" → 12.5 (the % is remembered by the caller); '' → null.
const kwNum = v => { const s = String(v == null ? '' : v).replace(/[,%\s]/g, ''); if (!s || s === '-' || s === '—') return null; const n = Number(s); return isFinite(n) ? n : null; };
// The newest date written anywhere in a few cells ("Week 46 | 2026-11-08 - 2026-11-14"; "11/14/2026") → 'YYYY-MM-DD' or ''.
function kwLastDate(cells) {
  let best = '';
  (cells || []).forEach(c => {
    String(c || '').replace(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (m, y, mo, d, mo2, d2, y2) => {
      const k = y ? `${y}-${mo}-${d}` : `${y2}-${('0' + mo2).slice(-2)}-${('0' + d2).slice(-2)}`;
      if (k > best) best = k;
      return m;
    });
  });
  return best;
}
// The header row (within the first 5): the first one that holds every one of `need` (regexes). → { i, head } or null.
function kwHeadRow(rows, need) {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const head = rows[i].map(h => h.toLowerCase().replace(/\s+/g, ' '));
    if (need.every(re => head.some(h => re.test(h)))) return { i, head };
  }
  return null;
}
/** Brand Analytics → Top search terms (Seller Central download, the 2023+ layout with brands, or the older one): → { ok, kind: 'terms',
 *  rows: [{ q, r, d, p: [{ a, n, b, c, v }] }], to (the report's newest date), skipped } or { ok: false, err }. Shares as fractions. */
function kwParseTerms(text) {
  const rows = kwTable(text);
  const h = kwHeadRow(rows, [/search term/, /frequency rank/]);
  if (!h) return { ok: false, err: 'not the Top search terms report' };
  const col = { p: [{}, {}, {}] };
  h.head.forEach((c, i) => {
    if (/^search term$/.test(c)) col.q = i;
    else if (/search frequency rank|^frequency rank/.test(c)) col.r = i;
    else if (/department/.test(c)) col.d = i;
    else if (/reporting date|^date$/.test(c)) col.at = i;
    else {
      const m = c.match(/#\s*([123])\b/);
      if (!m) return;
      const p = col.p[+m[1] - 1];
      if (/asin/.test(c)) p.a = i;
      else if (/conversion share|conv\.? share/.test(c)) p.v = i;
      else if (/click share/.test(c)) p.c = i;
      else if (/product (title|name)|item name|title/.test(c)) p.n = i;
      else if (/brand/.test(c)) p.b = i;
    }
  });
  if (col.q == null || col.r == null || !(col.p[0].a != null || col.p[0].n != null) || !(col.p[0].c != null || col.p[0].v != null)) return { ok: false, err: 'not the Top search terms report (no clicked products or shares)' };
  const body = rows.slice(h.i + 1);
  // a share column in % (any value over 1, or written with %): the whole file is in %
  let pct = false;
  body.slice(0, 400).forEach(r => col.p.forEach(p => [p.c, p.v].forEach(i => { if (i != null) { const s = r[i] || ''; if (/%/.test(s) || (kwNum(s) || 0) > 1) pct = true; } })));
  const share = v => { const n = kwNum(v); return n == null ? 0 : pct ? n / 100 : n; };
  const out = new Map();
  let skipped = 0;
  body.forEach(r => {
    const q = String(r[col.q] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const rank = kwNum(r[col.r]);
    if (!q || !rank) { skipped++; return; }
    const p = col.p.map(c => ({ a: c.a != null ? String(r[c.a] || '').toUpperCase() : '', n: c.n != null ? String(r[c.n] || '').slice(0, 120) : '', b: c.b != null ? String(r[c.b] || '').slice(0, 60) : '',
      c: c.c != null ? share(r[c.c]) : 0, v: c.v != null ? share(r[c.v]) : 0 })).filter(x => x.a || x.n);
    if (!p.length) { skipped++; return; }
    const rec = { q, r: rank, d: col.d != null ? String(r[col.d] || '').slice(0, 40) : '', p };
    const was = out.get(q);
    if (!was || rank < was.r) out.set(q, rec);                // one search once (its best rank when a file holds it twice)
  });
  const to = kwLastDate([rows.slice(0, h.i).flat().join(' ')].concat(col.at != null ? body.slice(0, 50).map(r => r[col.at]) : []));
  return { ok: true, kind: 'terms', rows: [...out.values()], to, skipped };
}
/** Brand Analytics → Search Query Performance (Brand view or ASIN view CSV): → { ok, kind: 'sqp', rows: [{ q, vol, i, c, o, ct, ot }], to }. */
function kwParseSqp(text) {
  const rows = kwTable(text);
  const h = kwHeadRow(rows, [/^search query$/, /search query volume/]);
  if (!h) return { ok: false, err: 'not the Search Query Performance report' };
  const find = re => h.head.findIndex(c => re.test(c));
  const col = { q: find(/^search query$/), vol: find(/search query volume/), i: find(/^impressions: (brand|asin) count/), c: find(/^clicks: (brand|asin) count/),
    o: find(/^purchases: (brand|asin) count/), ct: find(/^clicks: total count/), ot: find(/^purchases: total count/), at: find(/reporting date/) };
  const body = rows.slice(h.i + 1);
  const n = (r, i) => (i >= 0 ? kwNum(r[i]) || 0 : 0);
  const out = new Map();
  body.forEach(r => {
    const q = String(r[col.q] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!q) return;
    const was = out.get(q) || { q, vol: 0, i: 0, c: 0, o: 0, ct: 0, ot: 0 };
    was.vol = Math.max(was.vol, n(r, col.vol));
    ['i', 'c', 'o', 'ct', 'ot'].forEach(k => { was[k] += n(r, col[k]); });
    out.set(q, was);
  });
  const to = kwLastDate([rows.slice(0, h.i).flat().join(' ')].concat(col.at >= 0 ? body.slice(0, 50).map(r => r[col.at]) : []));
  return { ok: true, kind: 'sqp', rows: [...out.values()], to };
}
/** Either file: → the parse that reads it, or { ok: false, err } naming both (never guessed). */
function kwParse(text) {
  const t = kwParseTerms(text);
  if (t.ok) return t;
  const s = kwParseSqp(text);
  if (s.ok) return s;
  return { ok: false, err: 'Not read: this file is neither Brand Analytics "Top search terms" (Search Term, Search Frequency Rank, the clicked products) nor "Search Query Performance" (Search Query, Search Query Volume). Download it again from Seller Central → Brands → Brand Analytics.' };
}
// A new upload over what is kept: a search in both is the new one (never twice).
function kwMerge(old, fresh) {
  const m = new Map((old || []).map(x => [x.q, x]));
  let replaced = 0;
  (fresh || []).forEach(x => { if (m.has(x.q)) replaced++; m.set(x.q, x); });
  return { rows: [...m.values()], added: (fresh || []).length - replaced, replaced };
}

/* ============================================================================================
 * 2. THE SHARED COPY: history/kwwin_<n> and history/kwsqp_<brand>_<n>
 * ============================================================================================ */
const kwDocName = (name, i) => `${name}_${i}`;
async function kwReadStore(kind) {
  const snap = await getDocs(query(collection(db, 'history'), where('kind', '==', kind)));
  const by = {};
  snap.forEach(d => { const v = d.data() || {}; const k = v.brand || '-'; (by[k] = by[k] || []).push(v); });
  const out = {};
  Object.keys(by).forEach(k => {
    const head = by[k].find(p => p.n === 0);
    if (!head) return;
    const parts = by[k].filter(p => p.uploadedAt === head.uploadedAt && p.n < head.of).sort((a, z) => a.n - z.n);
    if (parts.length !== head.of) return;                 // an upload still being written: the last whole one next time
    out[k] = { uploadedAt: head.uploadedAt, of: head.of, trail: head.trail || [], meta: head.meta || {}, rows: parts.flatMap(p => p.rows || []) };
  });
  return out;
}
/** Read both stores (once per visit unless forced). Never throws: a failure is said in the panel. */
async function kwLoad(force) {
  if (KW.busy) return KW.busy;
  if (KW.loaded && !force) return null;
  KW.busy = (async () => {
    try {
      if (typeof getDocs === 'function' && typeof db !== 'undefined') {
        const [t, s] = await Promise.all([kwReadStore('kwwin'), kwReadStore('kwsqp')]);
        if (!(KW.terms && KW.terms.mem)) KW.terms = t['-'] || null;
        ['SP', 'CPC'].forEach(b => { if (!(KW.sqp[b] && KW.sqp[b].mem)) KW.sqp[b] = s[b] || null; });
      }
      KW.err = '';
    } catch (e) { KW.err = 'The winning-keyword data could not be read (' + ((e && e.code) || (e && e.message) || 'no access') + ').'; }
    await kwPpcLoad();                                       // our own ads' search terms (never throws): works with no upload at all
    KW.loaded = true;
    kwChanged();
  })().finally(() => { KW.busy = null; });
  return KW.busy;
}
// Loaded already (true), or starting it (false) — for the screens that work out their words right away.
function kwEnsure() { if (!KW.loaded) { kwLoad(); return false; } return true; }
function kwChanged() {
  KW.v++;
  KW.model = null; KW.win.clear(); KW.others = null; KW.ours = null; KW.ppcM = null;
  if (typeof kwPanelDraw === 'function') kwPanelDraw();
}
/** FOR TESTS and the test site: the data as if uploaded — { terms: rows, to, sqp: { SP: rows } }. */
function kwUse(o) {
  o = o || {};
  const at = o.at || Date.now();
  KW.terms = o.terms ? { uploadedAt: at, of: 1, trail: [{ at, by: 'test', name: 'test' }], meta: { to: o.to || kwIso(at), file: 'test' }, rows: o.terms, mem: true } : null;
  KW.sqp = { SP: o.sqp && o.sqp.SP ? { uploadedAt: at, rows: o.sqp.SP, meta: { to: o.to || '' }, trail: [], mem: true } : null, CPC: o.sqp && o.sqp.CPC ? { uploadedAt: at, rows: o.sqp.CPC, meta: { to: o.to || '' }, trail: [], mem: true } : null };
  KW.loaded = true;
  kwChanged();
}
async function kwSave(name, kind, brand, rows, meta) {
  const prev = kind === 'kwwin' ? KW.terms : KW.sqp[brand];
  const at = Date.now(), me = (typeof ME !== 'undefined' && ME && ME.email) || '';
  const trail = ((prev && prev.trail) || []).concat([{ at, by: me, name: typeof sqName === 'function' ? sqName(me) : me, rows: rows.length, file: meta.file || '', added: meta.added, replaced: meta.replaced }]).slice(-20);
  const of = Math.max(1, Math.ceil(rows.length / KW_CHUNK));
  const m = { to: meta.to || '', file: meta.file || '' };
  const rec = { uploadedAt: at, of, trail, meta: m, rows, mem: kwTest() };
  if (!kwTest()) {
    for (let i = 0; i < of; i++) {
      await setDoc(doc(db, 'history', kwDocName(name, i)), Object.assign({ kind, n: i, of, uploadedAt: at, rows: rows.slice(i * KW_CHUNK, (i + 1) * KW_CHUNK) }, brand ? { brand } : {}, i === 0 ? { trail, meta: m } : {}));
    }
    for (let i = of; i < ((prev && prev.of) || 0); i++) { try { await deleteDoc(doc(db, 'history', kwDocName(name, i))); } catch (e) { /* chunk 0 says how many */ } }
  }
  if (kind === 'kwwin') KW.terms = rec; else KW.sqp[brand] = rec;
  kwChanged();
  return rec;
}
/** An upload: read → merge with what is kept → save. Returns the words for the panel. */
async function kwUpload(text, file, brand) {
  const p = kwParse(text);
  if (!p.ok) return p.err;
  if (!p.rows.length) return 'No searches read from this file.';
  if (p.kind === 'sqp' && brand !== 'SP' && brand !== 'CPC') return 'Pick the brand of the Search Query Performance file first.';
  const kept = p.kind === 'terms' ? ((KW.terms && KW.terms.rows) || []) : ((KW.sqp[brand] && KW.sqp[brand].rows) || []);
  const mg = kwMerge(kept, p.rows);
  const prevTo = p.kind === 'terms' ? KW.terms && KW.terms.meta && KW.terms.meta.to : KW.sqp[brand] && KW.sqp[brand].meta && KW.sqp[brand].meta.to;
  const to = [p.to, prevTo].filter(Boolean).sort().pop() || kwIso(Date.now());
  try {
    if (p.kind === 'terms') await kwSave('kwwin', 'kwwin', '', mg.rows, { file, added: mg.added, replaced: mg.replaced, to });
    else await kwSave('kwsqp_' + brand, 'kwsqp', brand, mg.rows, { file, added: mg.added, replaced: mg.replaced, to });
  } catch (e) { return 'Not saved: ' + ((e && (e.code || e.message)) || e); }
  const what = p.kind === 'terms' ? 'Top search terms' : `Search Query Performance (${({ SP: 'Ridhi', CPC: 'CPC' })[brand]})`;
  return `${what}: ${kwNf(p.rows.length)} searches read${p.to ? ` (up to ${kwDay(p.to)})` : ''} · ${kwNf(mg.added)} new, ${kwNf(mg.replaced)} already there${mg.replaced ? ' (replaced, not counted twice)' : ''}${p.skipped ? ` · ${kwNf(p.skipped)} rows without a search or rank skipped` : ''}${kwTest() ? ' · test site: kept in this visit only' : ''}.`;
}

/* ============================================================================================
 * 3. THE MODEL: per product type, the searches and who wins them
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
  return p || kwTypeOf(title);
}
const kwTypeName = t => (KW_TYPES.find(x => x[0] === t) || [t, t])[1];
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
const kwFocusOf = text => { const keys = kwKeys(text); return KW_FOCUS.find(b => kwHasSeq(keys, kwKeys(b))) || ''; };
// The brand of a clicked product: the file's brand column, else a watched brand in its title, else the title's first words (a guess).
function kwBrandOf(p) {
  if (p.b) return { b: String(p.b).trim(), sure: true };
  const focus = kwFocusOf(String(p.n || '').split(/\s+/).slice(0, 4).join(' '));
  if (focus) return { b: focus, sure: true };
  const vocab = kwVocab();
  const out = [];
  for (const w of String(p.n || '').split(/\s+/).slice(0, 4)) {
    const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
    const k = kwKey(clean.replace(/'/g, ''));
    if (!k || vocab.has(k) || /\d/.test(k)) break;
    out.push(clean);
    if (/[,:;|–—-]$/.test(w)) break;
  }
  return { b: out.slice(0, 3).join(' '), sure: false };
}
const kwIsOurs = (brand, title) => { const keys = kwKeys(brand || String(title || '').split(/\s+/).slice(0, 4).join(' ')); return kwOurPhrases().some(p => kwHasSeq(keys, p)); };
/** { v, types: Map type → [term], brands: Map brand → wins, all: [term] } — term = { q, r, type, words, keys, prods, comp, top, cv, cc, wins,
 *  score, ours, not, sqp }. Worked out once per data version. */
function kwModel() {
  if (KW.model && KW.model.v === KW.v) return KW.model;
  const types = new Map(), brands = new Map(), all = [];
  const sqpOf = {};
  ['SP', 'CPC'].forEach(b => { const s = KW.sqp[b]; if (s && s.rows) sqpOf[b] = new Map(s.rows.map(x => [x.q, x])); });
  ((KW.terms && KW.terms.rows) || []).forEach(r => {
    const ww = kwWords(r.q);
    const type = kwTypeOf(ww.keys);
    if (!type) return;
    const notP = KW_NOT_P.find(p => kwHasSeq(ww.keys, p));
    const prods = (r.p || []).map(p => { const br = kwBrandOf(p); return Object.assign({}, p, { brand: br.b, sure: br.sure, ours: kwIsOurs(p.b, p.n) }); });
    const comp = prods.filter(p => !p.ours);
    const cv = comp.reduce((s, p) => s + (p.v || 0), 0), cc = comp.reduce((s, p) => s + (p.c || 0), 0);
    const top = comp.slice().sort((a, b) => (b.v || 0) - (a.v || 0) || (b.c || 0) - (a.c || 0))[0] || null;
    const wins = !!top && (cv >= KW_MIN.conv || cc >= KW_MIN.click);
    const t = { q: r.q, r: r.r, d: r.d || '', type, words: ww.words, keys: ww.keys, prods, comp, top, cv, cc, wins, score: (cv || cc / 2) * 1e6 / Math.max(1, r.r),
      ours: prods.some(p => p.ours), not: notP ? notP.join(' ') : '', sqp: { SP: sqpOf.SP ? sqpOf.SP.get(r.q) || null : null, CPC: sqpOf.CPC ? sqpOf.CPC.get(r.q) || null : null } };
    if (!types.has(type)) types.set(type, []);
    types.get(type).push(t);
    all.push(t);
    if (wins && top.brand) brands.set(top.brand, (brands.get(top.brand) || 0) + 1);
  });
  types.forEach(list => list.sort((a, b) => b.score - a.score || a.r - b.r));
  KW.model = { v: KW.v, types, brands, all };
  return KW.model;
}
/** OTHER BRANDS' NAMES to take out of search terms (listing-rules.js lrSuggestWords `others`): the watched brands, Maison d' Hermine, and
 *  every brand the data's brand column names (one word only when it is not an ordinary word); with no IP & Trademark Guard, also
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
  kwModel().all.forEach(t => t.prods.forEach(p => { if (p.b && !p.ours) add(p.b, false); }));
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
// Every brand word (keys): the data's brands (guesses too), the watched ones, ours, Listing Rules' other brands.
function kwBrandKeys(cfg) {
  const key = KW.v + '|' + (cfg && cfg.allow ? String(cfg.allow.otherBrands || '') + '|' + String(cfg.allow.ourBrands || '') + '|' + String(cfg.allow.claims || '') + '|' + JSON.stringify(cfg.events || []) : '-');
  if (KW.bk && KW.bk.key === key) return KW.bk.s;
  const s = new Set();
  KW.bk = { key, s };
  const addText = t => kwKeys(t).forEach(k => s.add(k));
  kwModel().all.forEach(t => t.prods.forEach(p => { if (p.brand) addText(p.brand); }));
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
 * 4. ONE LISTING'S WINNING WORDS
 * ============================================================================================ */
/** Is the data there and fresh? { ok, none, old, to, at, text } — text: what every screen says about it. */
function kwStatus() {
  const t = KW.terms;
  if (!KW.loaded) return { ok: false, loading: true, text: 'Winning keywords: reading…' };
  if (!t || !(t.rows || []).length) return { ok: false, none: true, text: 'No winning-keyword data (nothing uploaded yet) — only our word rules and the limit' };
  const to = (t.meta && t.meta.to) || kwIso(t.uploadedAt || Date.now());
  const age = (Date.now() - Date.parse(to + 'T00:00:00Z')) / 864e5;
  const by = (t.trail[t.trail.length - 1] || {}).name || '';
  if (age > KW_OLD_DAYS) return { ok: false, old: true, to, text: `No winning-keyword data (updated ${kwDay(to)}) — older than ${KW_OLD_DAYS} days: only our word rules and the limit` };
  return { ok: true, to, at: t.uploadedAt, text: `Winning keywords: Brand Analytics up to ${kwDay(to)}${by ? ` (uploaded by ${by})` : ''}` };
}
// A winning word's reason, as every screen shows it.
const kwWhy = e => `wins for ${e.brand || 'another brand'} on '${e.term}', search rank ${kwNf(e.rank)}`;
/* ---- PROVEN IN OUR ADS (28 Nov 2026): the 2nd source — our own Sponsored Products customer search terms ----
 * Read-only from the nightly caches every Ads screen reads (no Amazon call, no backend change): stD60 (60 days, in stSettled's shape)
 * when the backend writes it, else srchTerm (the nightly 30-day window — the only window there is today), with adGroup (which ASINs
 * each ad group advertises). A search term belongs to a FAMILY when every ASIN its ad group advertises is in that one family (our
 * Listing Health rows: ASIN → parent); a single-ASIN group's terms are that ASIN's. "Proven" = ORDERS ≥ KW_PPC_MIN_ORDERS in the
 * window, and the ACoS not over the break-even ACoS (Search Terms' cpBreakEven) when that is known. Its words go through exactly the
 * same filters as the Brand Analytics words (kwWordFilter), and come FIRST, by orders: when space is short the Brand Analytics words
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
  const colour = new Set(kwKeys(f.colour));
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
  const colours = typeof LR_SW_COLOR_SET !== 'undefined' ? LR_SW_COLOR_SET : new Set();
  const plain = k => (typeof LR_SW_STOP_SET !== 'undefined' && LR_SW_STOP_SET.has(k)) || (typeof LR_SW_LOW_SET !== 'undefined' && LR_SW_LOW_SET.has(k));
  const risky = w => { try { return typeof ipgFind === 'function' && cfg ? ipgFind(w, cfg).length > 0 : false; } catch (e) { return false; } };
  return {
    term: (keys, q, words) => {
      const w = k => (words && words[keys.indexOf(k)]) || k;
      if (keys.some(k => shapeOf.has(k) && shapeOf.get(k) !== shape)) return 'shape';
      if (keys.some(k => colours.has(k) && !colour.has(k) && !sure.has(k))) return 'colour';
      if ((String(q).match(/\d+(?:\.\d+)?/g) || []).some(n => !nums.has(n))) return 'size';
      if (KW_NOT_P.some(p => kwHasSeq(keys, p))) return 'not our cloth';
      // a material: known and another one → not ours; not known → not sure
      const m = keys.find(k => KW_MAT_SET.has(k) && !sure.has(k));
      if (m) return mat.size ? 'material' : '?' + w(m);
      // an edge or a pattern the title, attributes and colour do not say
      const e = keys.find(k => (KW_EDGE_SET.has(k) || KW_PAT_SET.has(k)) && !sure.has(k));
      if (e) return '?' + w(e);
      // a season the product is not said to be for
      const s = season.find(p => kwHasSeq(keys, p) && !p.every(k => sure.has(k)));
      if (s) return '?' + s.join(' ');
      return '';
    },
    word: (k, w) => !(k.length < 3 || /\d/.test(k) || have.has(k) || blocked.has(k) || vocab.has(k) || plain(k) || /^b0[a-z0-9]{8}$/.test(k) || risky(w)),
  };
}
// A proven word's reason, as every screen shows it; and when it took the room of the listing's own unproven words, which ones.
const kwReplacesText = list => (list && list.length ? ` replaces ${list.join(', ')} (no orders)` : '');
const kwPpcWhy = e => `PPC: ${kwNf(e.orders)} order${e.orders === 1 ? '' : 's'} from '${e.term}' in ${e.days} days`;
/** item: { brand, sku, asin, parent, price, title, kw, facts (lrSwFacts), pt, cfg } → { status (Brand Analytics), ppc (its status), type,
 *  words: [{ w, k, why, src: 'ppc' | 'ba', … }] } — the words this listing may take, in the order they are added: the words PROVEN in our
 *  own ads first (by orders), then the Brand Analytics winning words (best first). Each source is skipped when its data is missing. */
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
  const unsure = (w, term, from) => { if (!skipped.has(w)) skipped.set(w, { w, term, from, why: `skipped: not sure the product is ${w}` }); };
  // PROOF (28 Nov 2026): the listing's own words that have evidence — a word of a search with an order in our ads, or of a search other
  // brands win (Brand Analytics). A proven word never pushes those out (listing-rules.js lrSuggestWords step 3c), only words without.
  const proof = new Set();
  // 1 PROVEN IN OUR ADS — by orders
  const proven = new Map();
  if (ppc.ok) {
    const terms = kwProvenTerms(item.brand, asin, fam, price);
    terms.forEach(t => { if (t.o >= 1) kwKeys(t.t).forEach(k => proof.add(k)); });
    terms.filter(t => t.ok).forEach(t => {
      const ww = kwWords(t.t);
      const no = flt.term(ww.keys, t.t, ww.words);
      if (no) { if (no[0] === '?') unsure(no.slice(1), t.t, `PPC: ${kwNf(t.o)} orders`); return; }
      ww.keys.forEach((k, j) => {
        if (proven.has(k) || !flt.word(k, ww.words[j])) return;
        proven.set(k, { w: ww.words[j], k, src: 'ppc', term: t.t, orders: t.o, clicks: t.c, acos: t.acos, days: KW.ppc.days });
      });
    });
  }
  // 2 BRAND ANALYTICS — the searches other brands win for its product type, best first
  const best = new Map();
  if (status.ok && type) {
    (kwModel().types.get(type) || []).forEach(t => {
      if (!t.wins || t.not) return;
      t.keys.forEach(k => proof.add(k));
      const no = flt.term(t.keys, t.q, t.words);
      if (no) { if (no[0] === '?') unsure(no.slice(1), t.q, `wins for ${t.top.brand || 'another brand'}`); return; }
      t.keys.forEach((k, j) => {
        if (proven.has(k) || (best.has(k) && best.get(k).score >= t.score) || !flt.word(k, t.words[j])) return;
        best.set(k, { w: t.words[j], k, src: 'ba', score: t.score, term: t.q, brand: t.top.brand, rank: t.r, conv: t.top.v || 0, click: t.top.c || 0 });
      });
    });
  }
  const pw = [...proven.values()].sort((a, z) => z.orders - a.orders).map(e => Object.assign(e, { why: kwPpcWhy(e), proven: true }));
  const bw = [...best.values()].sort((a, b) => b.score - a.score || a.rank - b.rank).map(e => Object.assign(e, { why: kwWhy(e) }));
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
 * 5. THE PANEL: Listing → Listing Rules, "Winning keywords"
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
// The searches on screen: type, brand filter, search box.
function kwShown() {
  const md = kwModel();
  const types = [...md.types.keys()];
  const type = KW.type && md.types.has(KW.type) ? KW.type : (types.sort((a, b) => md.types.get(b).length - md.types.get(a).length)[0] || '');
  let list = (md.types.get(type) || []).filter(t => t.wins);
  if (KW.brand !== 'ALL') list = list.filter(t => t.comp.some(p => kwKeys(p.brand).join(' ') === kwKeys(KW.brand).join(' ') || (KW_FOCUS.includes(KW.brand) && kwFocusOf(p.brand + ' ' + p.n) === KW.brand)));
  if (KW.q) list = list.filter(t => t.q.includes(KW.q));
  return { type, types, list };
}
// A word of a search that says something to use: not a joining word, not a number, not a brand's name (never "missing: etopia").
function kwPlainWord(k, brands) { return !(typeof LR_SW_STOP_SET !== 'undefined' && LR_SW_STOP_SET.has(k)) && !/^\d/.test(k) && !brands.has(k); }
// One search's words: which ones our listings of this type already use.
function kwUseOf(t, used) {
  if (!used) return { all: null, miss: [] };
  const brands = kwBrandKeys((typeof LR !== 'undefined' && LR) || null);
  const content = t.keys.map((k, j) => ({ k, w: t.words[j] })).filter(x => kwPlainWord(x.k, brands));
  const miss = content.filter(x => !used.has(x.k)).map(x => x.w);
  return { all: !miss.length, miss };
}
function kwSqpText(t) {
  const parts = ['SP', 'CPC'].filter(b => t.sqp[b]).map(b => `${({ SP: 'Ridhi', CPC: 'CPC' })[b]}: ${kwNf(t.sqp[b].c)} clicks · ${kwNf(t.sqp[b].o)} sold`);
  return parts.join(' · ');
}
function kwBaPanelHtml() {
  const st = kwStatus();
  const b = (v, t) => `<button type="button" data-kw-brand="${v}" aria-pressed="${KW.upBrand === v}">${t}</button>`;
  const trail = KW.terms && KW.terms.trail.length ? KW.terms.trail[KW.terms.trail.length - 1] : null;
  const sqpLine = ['SP', 'CPC'].map(x => `${({ SP: 'Ridhi', CPC: 'CPC' })[x]}: ${KW.sqp[x] ? `${kwNf(KW.sqp[x].rows.length)} searches, up to ${kwDay(KW.sqp[x].meta && KW.sqp[x].meta.to)}` : 'not uploaded'}`).join(' · ');
  const up = `<div class="kw-up"><div class="kw-up-t"><b>Upload Brand Analytics</b><span class="muted"> Seller Central → Brands → Brand Analytics → <b>Top search terms</b>: search a product word (tablecloth, napkin, placemat, table runner, pillow cover…) → Generate download → CSV. Optional: <b>Search Query Performance</b> (Brand view) per brand. A new file replaces the searches it shares — never counted twice.</span></div>`
    + `<div class="kw-up-r"><span class="kw-seg" role="group" aria-label="Brand of a Search Query Performance file">${b('SP', 'Ridhi')}${b('CPC', 'CPC')}</span>`
    + `<label class="ghost kw-file">Choose a file…<input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" data-kw-file hidden></label>`
    + `<span class="muted kw-asof">Top search terms: ${KW.terms ? `${kwNf(KW.terms.rows.length)} searches${trail ? ` · uploaded by ${kwEsc(trail.name || trail.by)} ${kwDay(kwIso(trail.at))}` : ''}` : 'not uploaded'} · SQP ${sqpLine}${kwTest() ? ' · test site: uploads stay in this visit only' : ''}</span></div>`
    + `${KW.msg ? `<p class="kw-msg" role="status">${kwEsc(KW.msg)}</p>` : ''}${KW.err ? `<p class="kw-msg err">${kwEsc(KW.err)}</p>` : ''}</div>`;
  const head = `<p class="muted kw-what">The searches other brands win (their products' conversion share ≥ ${Math.round(KW_MIN.conv * 100)} % or click share ≥ ${Math.round(KW_MIN.click * 100)} %), per product type, best first (competitor conversion share ÷ search rank). Fix all search terms, Listing Content, ✨ AI and Create Listing add their words to a listing's search terms when they fit — never another brand's name, never a word the title already says, never a search for another shape, colour, size or material.</p>`;
  if (!KW.terms || !(KW.terms.rows || []).length) return head + up;
  const sh = kwShown();
  const md = kwModel();
  const typeSel = `<select data-kw-f="type" aria-label="Product type">${sh.types.map(t => `<option value="${kwEsc(t)}"${t === sh.type ? ' selected' : ''}>${kwEsc(kwTypeName(t))} (${kwNf(md.types.get(t).filter(x => x.wins).length)})</option>`).join('')}</select>`;
  const others = [...md.brands.entries()].filter(([n]) => !KW_FOCUS.some(f => kwKeys(f).join(' ') === kwKeys(n).join(' '))).sort((a, z) => z[1] - a[1]).slice(0, 25);
  const brandSel = `<select data-kw-f="brand" aria-label="Brand that wins"><option value="ALL">All brands</option>${KW_FOCUS.map(f => `<option value="${kwEsc(f)}"${KW.brand === f ? ' selected' : ''}>${kwEsc(f)}</option>`).join('')}`
    + `${others.map(([n, c]) => `<option value="${kwEsc(n)}"${KW.brand === n ? ' selected' : ''}>${kwEsc(n)} (${kwNf(c)})</option>`).join('')}</select>`;
  const tools = `<div class="kw-tools">${typeSel}${brandSel}<input type="search" data-kw-f="q" placeholder="Search a word…" value="${kwEsc(KW.q)}" aria-label="Search the searches"><span style="flex:1"></span>`
    + `<button type="button" class="ghost" data-kw-act="csv">⬇ CSV (${kwNf(sh.list.length)})</button></div>`;
  const used = kwOurWords(sh.type);
  const brandKeys = kwBrandKeys((typeof LR !== 'undefined' && LR) || null);
  const rows = sh.list.slice(0, KW.limit).map(t => {
    const u = kwUseOf(t, used);
    const comp = t.comp.slice(0, 3).map(p => `<span class="kw-b${KW_FOCUS.includes(kwFocusOf(p.brand + ' ' + p.n)) ? ' is-focus' : ''}" title="${kwEsc(p.n)}${p.sure ? '' : ' (brand read from the product title)'}">${kwEsc(p.brand || 'unknown')}${p.sure ? '' : '?'}</span>`).join(' ');
    const words = t.words.map((w, j) => (used && !used.has(t.keys[j]) && kwPlainWord(t.keys[j], brandKeys) ? `<u title="none of our ${kwEsc(kwTypeName(sh.type).toLowerCase())} uses it">${kwEsc(w)}</u>` : kwEsc(w))).join(' ');
    return `<tr><td>${words}${t.not ? ` <small class="kw-not">not for our cloth (${kwEsc(t.not)})</small>` : ''}</td><td class="num">${kwNf(t.r)}</td><td>${comp}</td><td class="num">${kwPct(t.top ? t.top.c : 0)}</td><td class="num">${kwPct(t.top ? t.top.v : 0)}</td>`
      + `<td>${u.all == null ? '<span class="muted">—</span>' : u.all ? '<span class="kw-yes">✓ all words</span>' : `<span class="kw-no">missing: ${kwEsc(u.miss.slice(0, 4).join(', '))}</span>`}</td>`
      + `<td class="muted">${kwEsc(kwSqpText(t)) || '—'}</td></tr>`;
  }).join('');
  const more = sh.list.length > KW.limit ? `<button type="button" class="ghost" data-kw-act="more">Show more (${kwNf(sh.list.length - KW.limit)} left)</button>` : '';
  const table = `<div class="xlwrap kw-tw"><table class="xl kw-t"><thead><tr><th>Search</th><th class="num">Search rank</th><th>Who wins (top clicked)</th><th class="num">Click share</th><th class="num">Conv. share</th><th>We use the words</th><th>Ours (SQP)</th></tr></thead>`
    + `<tbody>${rows || `<tr><td colspan="7" class="ui-empty">No winning search for ${kwEsc(kwTypeName(sh.type).toLowerCase())}${KW.brand !== 'ALL' ? ' won by ' + kwEsc(KW.brand) : ''}.</td></tr>`}</tbody></table></div>`
    + `<p class="muted kw-foot">Showing ${kwNf(Math.min(KW.limit, sh.list.length))} of ${kwNf(sh.list.length)} · underlined: a word none of our ${kwEsc(kwTypeName(sh.type).toLowerCase())} uses yet${used ? '' : ' (open Listing Health to see which words we use)'} · ? = brand read from the product title ${more}</p>`;
  return head + up + tools + table;
}
/* ---- the panel's two tabs (28 Nov 2026): Brand Analytics (the uploads) · 📈 Proven in our ads (the nightly PPC search terms) ---- */
function kwPanelHtml() {
  const st = kwStatus(), pp = kwPpcStatus();
  const hasBa = !!(KW.terms && (KW.terms.rows || []).length);
  const tab = KW.tab || (hasBa || !pp.ok ? 'ba' : 'ppc');
  const baText = st.text.replace(/^Winning keywords: /, '');
  const head = `<div class="kw-h"><b>🏆 Winning keywords</b><span class="${st.ok ? 'muted' : 'kw-none'}">${kwEsc(baText)}</span><span class="${pp.ok ? 'muted' : 'kw-none'}">· 📈 ${kwEsc(pp.text)}</span></div>`;
  const b = (k, t) => `<button type="button" class="segbtn${tab === k ? ' on' : ''}" data-kw-tab="${k}" aria-pressed="${tab === k}">${t}</button>`;
  const tabs = `<div class="seg kw-tabs" role="group" aria-label="Which words">${b('ba', '🏆 Brand Analytics (uploads)')}${b('ppc', '📈 Proven in our ads')}</div>`;
  return head + tabs + (tab === 'ppc' ? kwPpcPanelHtml() : kwBaPanelHtml());
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
  const tools = `<p class="muted kw-what">Customer search terms from our own Sponsored Products ads, per listing family (an ad group's terms count for a family only when every product it advertises is in that family). Proven = ${KW_PPC_MIN_ORDERS}+ orders in ${pp.days} days and the ACoS not over the listing's break-even (when its cost is known). Their missing words are added to that family's search terms FIRST (by orders), before the Brand Analytics words — with the same rules.</p>`
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
const KW_CSV_COLS = ['Product type', 'Search', 'Search frequency rank', 'Wins (brand)', 'Brand from', 'Click share', 'Conversion share', 'Competitors conversion share',
  '#2 brand', '#3 brand', 'Winning ASIN', 'Winning product', 'We use all words', 'Words we do not use', 'Ridhi SQP clicks', 'Ridhi SQP sold', 'CPC SQP clicks', 'CPC SQP sold', 'Not for our cloth', 'Data up to'];
const kwCsvQ = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** The sheet: the searches on screen (type, brand, search box), Excel-ready (UTF-8 BOM, CRLF). */
function kwCsv() {
  const sh = kwShown();
  const used = kwOurWords(sh.type);
  const st = kwStatus();
  const lines = sh.list.map(t => {
    const u = kwUseOf(t, used);
    const top = t.top || {};
    return [kwTypeName(sh.type), t.q, t.r, top.brand || '', top.sure ? 'brand column / watched brand' : 'product title (guess)', kwPct(top.c), kwPct(top.v), kwPct(t.cv),
      (t.comp[1] || {}).brand || '', (t.comp[2] || {}).brand || '', top.a || '', top.n || '', u.all == null ? '' : u.all ? 'yes' : 'no', u.miss.join(' '),
      t.sqp.SP ? t.sqp.SP.c : '', t.sqp.SP ? t.sqp.SP.o : '', t.sqp.CPC ? t.sqp.CPC.c : '', t.sqp.CPC ? t.sqp.CPC.o : '', t.not, st.to || ''].map(kwCsvQ).join(',');
  });
  return { n: lines.length, text: '﻿' + [KW_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function kwDownload() {
  const ppc = KW.tab === 'ppc' || (!KW.tab && !(KW.terms && (KW.terms.rows || []).length) && kwPpcStatus().ok);
  const out = ppc ? kwPpcCsv() : kwCsv();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = ppc ? `Sellora-proven-in-our-ads-${kwIso(Date.now())}.csv` : `Sellora-winning-keywords-${kwShown().type || 'all'}-${kwIso(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('#kwWin [data-kw-act], #kwWin [data-kw-brand], #kwWin [data-kw-tab]') : null;
    if (!t) return;
    if (t.dataset.kwBrand) { KW.upBrand = t.dataset.kwBrand === 'CPC' ? 'CPC' : 'SP'; return kwPanelDraw(); }
    if (t.dataset.kwAct === 'csv') return kwDownload();
    if (t.dataset.kwTab) { KW.tab = t.dataset.kwTab === 'ppc' ? 'ppc' : 'ba'; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
    if (t.dataset.kwAct === 'more') { KW.limit += KW_KEEP_ROWS; return kwPanelDraw(); }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (!el || !el.closest || !el.closest('#kwWin')) return;
    if (el.dataset && el.dataset.kwF === 'type') { KW.type = el.value; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
    if (el.dataset && el.dataset.kwF === 'ppcBrand') { KW.ppcBrand = el.value || 'ALL'; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
    if (el.dataset && el.dataset.kwF === 'brand') { KW.brand = el.value || 'ALL'; KW.limit = KW_KEEP_ROWS; return kwPanelDraw(); }
    if (el.dataset && el.dataset.kwFile !== undefined && el.files && el.files[0]) {
      const file = el.files[0];
      KW.msg = 'Reading ' + file.name + '…';
      kwPanelDraw();
      try { KW.msg = await kwUpload(await file.text(), file.name, KW.upBrand); } catch (err) { KW.msg = 'Not read: ' + ((err && err.message) || err); }
      kwPanelDraw();
    }
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

/** CONSOLE: `kwReport()` — the data, its age, the product types and the searches per type; `kwReport('RTC14-1')` — that listing's
 *  winning words (Listing Health loaded) and its search terms before → after. */
function kwReport(sku) {
  const md = kwModel();
  const out = { status: kwStatus().text, ppc: kwPpcStatus().text, searches: (KW.terms && KW.terms.rows.length) || 0, types: {} };
  md.types.forEach((list, t) => { out.types[kwTypeName(t)] = { searches: list.length, won: list.filter(x => x.wins).length, top: list.filter(x => x.wins).slice(0, 3).map(x => `${x.q} (${x.top.brand || '?'}, rank ${x.r})`).join(' · ') }; });
  console.table(out.types);
  if (sku && typeof kfItemOf === 'function' && typeof hCtx === 'function') {
    const ctx = hCtx();
    for (const brand of ['SP', 'CPC']) {
      const row = ((typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || []).find(r => r.sku === sku);
      if (!row) continue;
      const it = kfItemOf(brand, row, ctx, null);
      const s = kfShorten(it.kw, { title: it.title, brands: it.brands, risk: it.risk, facts: it.facts, add: it.win.words, others: it.others });
      out.example = { sku, type: it.win.type, words: it.win.words.slice(0, 10).map(w => `${w.w} (${w.why})`), before: s.before, after: s.after, bytes: `${s.bytesBefore} → ${s.bytesAfter}`,
        added: s.added.map(a => a.w).join(' '), removed: s.removed.map(r => `${r.w} (${kwWhyLabel(r.why)})`).join(', ') };
      console.log(out.example);
      break;
    }
  }
  return out;
}
