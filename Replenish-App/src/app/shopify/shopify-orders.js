/* ================= SHOPIFY ORDERS & ADJUSTMENTS =================
 * Moved here from Sellora, where these screens used to live. Verbatim, apart from what the move
 * itself forced: the backend calls now go through prGet/PRAPI (config/api — the Price Research
 * script, which is the one that has Shopify and MCF in it, NOT this app's own config/replapi),
 * the multi-select widget is this app's copy rather than a second one, and the cross-project
 * production view is gone with the tracker it fed. */
/* ---- helpers this block calls, brought over from Sellora ---- */
/* Amazon reports and the Shopify store both run on Pacific time, so "today" here is the STORE's
 * today, not this browser's. A day-boundary bug is a whole day of orders missing or doubled. */
/* ONE FORMATTER, REUSED (2026-09-27): toLocaleString built a new one on every call, and it was called for every order on
 * every draw of the Shopify tab — a tenth of a second of 0.3. Same wall-clock answer. */
const SD_FMT = {};
function sdWall(ms, tz) {
  const f = SD_FMT[tz] || (SD_FMT[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = {}; f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}
const sdPT = ms => sdWall(ms, 'America/Los_Angeles');
function sdToday() { const d = sdPT(Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const sdShift = (iso, days) => new Date(new Date(iso + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);
/**
 * A timestamp in the MARKETPLACE's day, not UTC.
 *
 * Everything that filters by date here — sdToday, the week keys, the adjustment window — works in
 * PT. Stamping the records themselves with toISOString() put them in UTC, so a job raised in the
 * evening PT was stamped with tomorrow's date and then filtered out by a window ending "today".
 * That is how one adjustment showed as "0 shown of 1 ever raised".
 *
 * Same rule as the Amazon side and the Shopify side: pick ONE zone for a day and never mix.
 */
function soStamp() {
  const d = sdPT(Date.now());
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---- from Sellora: Shopify Orders, up to the production view ---- */
/* ============ Shopify Orders ============
 *
 * What has to go out of the door, whether Amazon can send it, and where each one stands.
 *
 * Orders are FETCHED, never cached in Firestore: an order's contents and address belong to Shopify
 * and go stale the moment somebody edits them there. Only what this app adds — the status, the note
 * and the shipment details — is stored, keyed by Shopify's order id.
 */
/* Its own escape helper. In the app this came from `esc` is a global; here it is declared inside
 * each render function, so the widget cannot borrow one — and a widget that depends on a name it
 * does not own breaks the moment it is moved. */
/* The multi-select widget is NOT repeated here. This app already declares msInit/msPaint/msVals
 * and the rest, and its copy is the newer one — it carries m.sig and msRefine, which Sellora's does
 * not. A second `const MS` in the same module is a SyntaxError, and a SyntaxError in a module stops
 * every tab in the app, not just this one. */

let SHOP = { orders: [], from: '', to: '', tz: '', at: '' };
/* Declared HERE, with the other Shopify state, and NOT down in the import block where it is filled.
 * `renderShop` and `ensureShop` both read it, and a `let` read before its own line is a
 * ReferenceError that kills the whole module — which is exactly what happened once already with
 * SO_CHANNELS. State that several functions share belongs at the top of the section, not beside the
 * one function that writes it. */
let SHOP_IMP = [], SHOP_IMP_AT = {}, SHOP_IMP_LOADED = false, SO_IMP_STAGED = null;

/** The imported orders that are NOT also here live. One order counted twice is one order too many.
 *  Worked out once per pair of lists — it is asked for on every row of every render otherwise. */
let SO_IMP_LIVE = { key: '', rows: [] };
function soImpLive() {
  if (!SHOP_IMP.length) return SHOP_IMP;
  const key = SHOP_IMP.length + '|' + SHOP.orders.length + '|' + (SHOP.at || '');
  if (SO_IMP_LIVE.key === key) return SO_IMP_LIVE.rows;
  const clean = o => (o.channel || '') + '|' + String(o.no || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  const live = new Set(SHOP.orders.map(clean));
  SO_IMP_LIVE = { key, rows: SHOP.orders.length ? SHOP_IMP.filter(o => !live.has(clean(o))) : SHOP_IMP };
  return SO_IMP_LIVE.rows;
}
let SHOP_META = {};          // orderId → { s, note, desc, wt, val, carrier, by, at }
let SHOP_STOCK = {};         // SKU IN UPPER CASE → FBA units available, both brands merged
/* AMAZON'S OWN SPELLING of every code it stocks, keyed by the upper-case form.
 *
 * Amazon SKUs are CASE-SENSITIVE. Matching has to ignore case (Shopify and the sheets disagree about
 * it constantly) but what we SEND back to Amazon, and what we print beside a line, must be spelled
 * the way Amazon spells it — `RCNBmix`, not `RCNBMIX`. Upper-casing everything was quietly changing
 * the identifier in the MCF payload. Ravi spotted it on the screen, 2026-08-25. */
let SHOP_STOCK_CASE = {};
/* Rescued from the dropped production span, where these two had merely been parked between the
 * publish functions. They are general SKU-casing helpers and the whole screen leans on them. */
const soAmzCase = code => SHOP_STOCK_CASE[String(code || '').trim().toUpperCase()] || String(code || '').trim();
const soAmzKey = sku => String(soAmzSku(sku) || '').trim().toUpperCase();
let SHOP_STOCK_LOADED = false;
/* THE SAME FIGURES, PER ACCOUNT. The merged map answers "does Amazon have it anywhere"; MCF ships
 * out of ONE account, and a SKU stocked only on CPC is unknown to Ridhi — Amazon refuses the whole
 * order for it. brand → SKU (upper case) → units, and Amazon's own spelling per account. */
let SHOP_STOCK_BY = { SP: {}, CPC: {} };
let SHOP_STOCK_CASE_BY = { SP: {}, CPC: {} };
let SHOP_EDIT = null;
let SHOP_SORT = { k: 'at', dir: -1 };

function soMsg(t, bad) { const m = $('soMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

async function loadShopMeta() {
  try {
    const s = await getDoc(doc(db, 'audit', 'shoporders'));
    SHOP_META = s.exists() ? (s.data().m || {}) : {};
  } catch (e) { /* nothing saved yet, or no read access */ }
}
async function saveShopMeta() {
  await setDoc(doc(db, 'audit', 'shoporders'),
    { m: SHOP_META, n: Object.keys(SHOP_META).length, by: ME.email, saved: serverTimestamp() });
}

/**
 * FBA stock by SKU, both brands in one map.
 *
 * Read from the shared `stock/{brand}` documents the Listing Health pull maintains, so this tab
 * costs nothing to answer "could Amazon ship it" — no report, no waiting. A SKU sold on both
 * accounts keeps the LARGER figure rather than whichever brand was read last.
 */
/* ---------- where a SKU sits on the shelf ----------
 *
 * Stored against the SKU, NOT against the order. A bin is a property of the product: RCNE521-12 is
 * in the same place next week as it is today, so typing it once has to be enough. Recording it per
 * order would mean the same SKU is asked for again on every order it appears in, and the answers
 * would drift apart until nobody trusts any of them.
 *
 * Shared through Firestore like every other list here, so the person picking and the person on the
 * bench see the same shelf.
 */
/* SKU → { loc, hs, gst, rate }. All four are facts about the PRODUCT, not about an order: the bin
 * it sits in, its HS code, the GST it attracts and what it invoices at. Typed once, then every
 * order carrying that SKU fills itself — which is the only way a customs line stays consistent
 * across the hundreds of invoices a courier will eventually compare. */
let SHOP_SKU = {};
const SO_LOC_OPTIONS = ['A.1', 'A.2', 'A.3', 'B.1', 'B.2', 'B.3', 'C.1', 'C.2', 'C.3', 'D.1', 'D.2', 'D.3',
  '3000', '4000', '5000'];

async function loadShopSku() {
  try {
    const s = await getDoc(doc(db, 'audit', 'skumeta'));
    if (s.exists()) { SHOP_SKU = s.data().m || {}; return; }
  } catch (e) { /* fall through to the older document */ }
  // The first version of this stored the bin on its own. Anything already typed is carried over
  // rather than asked for again.
  try {
    const old = await getDoc(doc(db, 'audit', 'skuloc'));
    if (old.exists()) {
      Object.entries(old.data().m || {}).forEach(([k, v]) => { SHOP_SKU[k] = { loc: v }; });
    }
  } catch (e) { /* nothing saved yet, or no read access */ }
}
async function saveShopSku() {
  await setDoc(doc(db, 'audit', 'skumeta'),
    { m: SHOP_SKU, n: Object.keys(SHOP_SKU).length, by: ME.email, saved: serverTimestamp() });
}
const soSku = sku => SHOP_SKU[String(sku || '').trim().toUpperCase()] || {};
const soLocOf = sku => soSku(sku).loc || '';
/* The Amazon SKU for a Shopify SKU, when the two are not the same text.
 *
 * Shopify and Seller Central are maintained by different people at different times, so a product can
 * carry one code on the store and another at Amazon. Everything that talks to AMAZON — the FBA stock
 * check and the MCF order itself — has to go through here, or the mismatched SKUs are exactly the
 * ones reported as "not in FBA" and refused a shipment they could have had.
 *
 * Everything that talks to SHOPIFY or to a person keeps the original: the picker looks for the code
 * printed on the order, and rewriting it on screen would make the two impossible to reconcile. */
/** The STORED answer only — what a person typed in the Amazon SKU box, or the code itself. */
const soAmzMapped = sku => {
  const raw = String(sku || '').trim();
  // Amazon's own spelling wins over both the typed mapping and the Shopify code — it is the one
  // spelling Amazon will accept. Neither is upper-cased any more.
  return soAmzCase(soSku(raw).amz || raw);
};

/* How many units are in ONE Amazon pack of this code.
 *
 * Never guessed. Two real sources, in this order: a figure typed against the SKU here, and the
 * `Pack` column of the warehouse workbook, which is already read live for the India figures. If
 * neither has it, the answer is "not recorded" — and nothing is converted, because a quantity
 * invented here becomes a real parcel with the wrong number of pieces in it.
 */
function soPackOf(amzSku, shopSku) {
  const k = String(amzSku || '').trim().toUpperCase();
  const typed = Number((SHOP_SKU[k] || {}).pack);
  if (typed > 1) return { n: typed, src: 'typed on this line' };
  const ind = SHOP_INDIA[k];
  const p = ind ? Number(ind[2]) : 0;
  if (p > 1) return { n: p, src: 'the warehouse workbook' };
  // The article's own set size. Last, so anything recorded about THIS SKU beats the general rule,
  // and first in practice, because it is the one that needs nobody to have filled anything in.
  const cat = soArticlePack(shopSku || amzSku);
  if (cat > 1) return { n: cat, src: 'the set size for this article' };
  return null;
}

/* WHICH ARTICLES A TRAILING "-N" MEANS A PIECE COUNT ON.
 *
 * NAPKINS ONLY, by Ravi's instruction (2026-08-21). On a tablecloth the identical-looking suffix is
 * a SIZE — RTC354-6060 is 60x60 inches, not 6,060 pieces, and RTC505-72140 is 72x140 — so a rule
 * that read every suffix as a count would convert quantities on exactly the products where being
 * wrong costs the most. The arithmetic guards below would catch most of those; this stops them ever
 * being asked the question.
 *
 * Read off the PRODUCT NAME Shopify sends, not off the SKU text. The codes are not guaranteed to be
 * named to a pattern, and a prefix rule would be a second guess stacked on the first.
 *
 * To widen this later, widen the pattern — it is the one place that decides.
 */
/* THE ARTICLE SETTLES THE PACK SIZE, not the SKU.
 *
 * Napkins go to Amazon in sets of FOUR — every napkin code, not a figure to be recorded one SKU at
 * a time. So `-4` is 1 pack, `-8` is 2 and `-12` is 3, on the whole category, from the first order
 * it is ever seen on. (Ravi, 2026-08-21.)
 *
 * ONE TABLE DRIVES BOTH QUESTIONS — which articles a trailing "-N" is a piece count on, and what it
 * divides by. Two lists would drift, and an article present in one and missing from the other either
 * converts with the wrong divisor or silently stops converting at all.
 *
 * To add an article, add a row. To correct ONE SKU inside an article, type its pack on the line —
 * that still wins, so a napkin genuinely sold in sixes is an edit and not an exception in here. */
const SO_ARTICLE_PACK = [
  [/napkin/i, 4],
];
function soArticlePack(sku) {
  const name = SO_SKU_NAME[String(sku || '').trim().toUpperCase()] || '';
  for (const [re, n] of SO_ARTICLE_PACK) if (re.test(name)) return n;
  return 0;
}

/* SKU — product name, off the orders themselves. soPackFit is handed a SKU and nothing else by nine
 * call sites, so the name it needs has to be findable from the code alone. */
let SO_SKU_NAME = {};
function soIndexNames() {
  SHOP.orders.concat(soImpLive()).forEach(o => (o.items || []).forEach(i => {
    const k = String(i.sku || '').trim().toUpperCase();
    if (k && i.name && !SO_SKU_NAME[k]) SO_SKU_NAME[k] = i.name;
  }));
}
const soIsPieceArticle = sku => soArticlePack(sku) > 0;

/* ONE SHOPIFY SET IS SEVERAL AMAZON PACKS.
 *
 * Shopify sells `RCNB355-12` — twelve napkins. Amazon stocks `RCNB355`, a pack of four. Filling that
 * order means three Amazon packs, and until now somebody typed the code and the 3 by hand on every
 * such line.
 *
 * THE SUFFIX IS NOT ALWAYS A PIECE COUNT, and that is the whole danger here. `RTC354-6060` ends in a
 * number too, and it is a SIZE (60x60). Three things keep the two apart, and all three must hold:
 *
 *   1. AN EXACT MATCH IS NEVER SECOND-GUESSED. If Amazon knows the code as it stands — which is true
 *      of RTC354-6060 — this returns nothing at all. Ravi's rule, and it alone settles most of them.
 *   2. The base must be a code Amazon actually stocks.
 *   3. The suffix must divide by the pack into a WHOLE, SMALL number of packs. 12 / 4 = 3 passes;
 *      6060 or 72140 against any pack does not, so a size can never be read as a piece count.
 *
 * When a split looks right but the pack size is not recorded, NOTHING is mapped and NOTHING is
 * converted — the line keeps saying "not in FBA" and the status says which figure is missing. A
 * half-applied guess (right code, wrong quantity) is the one outcome that ships wrong goods.
 */
function soPackFit(sku) {
  const raw = String(sku || '').trim();
  const shop = raw.toUpperCase();
  if (!shop) return null;
  // The article gate comes FIRST, so a tablecloth is never even measured against a pack.
  if (!soIsPieceArticle(shop)) return null;
  const mapped = soAmzMapped(raw);
  const m = shop.match(/^(.+?)-(\d{1,4})$/);
  // The SAME split, taken off the original text, so the base keeps the case it was written in.
  const mRaw = raw.match(/^(.+?)-(\d{1,4})$/);

  // Mapped by hand to a DIFFERENT Amazon code: their code is settled, only the count is open.
  // Compared without case — a mapping that only changes capitals is not a different code.
  if (mapped.toUpperCase() !== shop) return soPackFactor_(shop, mapped, m);
  // Amazon knows this exact code. Assume nothing.
  if (shop in SHOP_STOCK) return null;
  // It does not. If it reads as BASE-N and Amazon stocks BASE, that is the candidate — spelled the
  // way Amazon spells it if Amazon knows it, otherwise the way it was typed.
  if (m && (m[1] in SHOP_STOCK)) return soPackFactor_(shop, soAmzCase(mRaw ? mRaw[1] : m[1]), m);
  return null;
}

function soPackFactor_(shop, base, m) {
  if (!m || String(base).toUpperCase() === shop) return null;
  const n = Number(m[2]);
  const pack = soPackOf(base, shop);
  if (!pack) {
    return { ok: false, base, n,
      why: shop + ' is not stocked at Amazon but ' + base + ' is — and how many units are in one '
        + base + ' pack is not recorded anywhere, so neither the code nor the quantity is changed.'
        + ' Type the units per pack to turn this on.' };
  }
  const f = n / pack.n;
  if (!Number.isInteger(f) || f < 1 || f > 24) {
    return { ok: false, base, n, pack: pack.n,
      why: n + ' against a pack of ' + pack.n + ' for ' + base + ' is not a whole number of packs, so'
        + ' the "-' + n + '" is read as a SIZE rather than a piece count. Nothing changed.' };
  }
  return { ok: true, base, n, pack: pack.n, factor: f,
    why: n + ' units = ' + f + ' × ' + base + ' (pack of ' + pack.n + ', ' + pack.src + ')' };
}

/* The Amazon code this line actually goes to Amazon as.
 *
 * A typed mapping first, then a resolved pack split, then the code itself. Everything Amazon-facing
 * must come through here — the FBA check, the readiness tag and the MCF payload — or the split lines
 * are exactly the ones reported "not in FBA" and refused a shipment they could have had. */
const soAmzSku = sku => {
  const fit = soPackFit(sku);
  return (fit && fit.ok) ? fit.base : soAmzMapped(sku);
};

/** Amazon packs one Shopify unit becomes. 1 unless a split has fully resolved. */
const soPackFactorOf = sku => { const f = soPackFit(sku); return (f && f.ok) ? f.factor : 1; };
/* Units of a line that are still OURS TO SHIP: ordered, less anything refunded.
 *
 * Two signals, answering slightly different questions:
 *   `rq` — units given back, added up from the order's own refunds.
 *   `fq` — Shopify's fulfillable_quantity, which its admin shows as "Fulfilment not required".
 *
 * fq is only readable on a line that NEVER SHIPPED: it also falls to zero when a line is fulfilled,
 * so taken alone it would mark every despatched order as cancelled. On an unshipped line it catches
 * what the refund list cannot — a line removed by an order edit, a fulfilment order closed by hand.
 *
 * Imported orders carry neither field, so they simply keep the quantity that was ordered.
 */
function soLive(i) {
  const q = Number(i.qty) || 0;
  let live = Math.max(0, q - (Number(i.rq) || 0));
  // An order EDIT removes units WITHOUT refunding them, so nothing about it appears in the refunds.
  // Shopify keeps the ordered quantity and drops current_quantity; its admin lists those under
  // "Removed". Until this was read, a line the buyer had taken off still got picked and packed.
  if (i.cq != null) live = Math.min(live, Math.max(0, Number(i.cq) || 0));
  const shipped = /^(ful|partial)/i.test(String(i.ffl || ''));
  if (i.fq === 0 && !shipped) live = 0;
  return live;
}

/* Units taken off by an ORDER EDIT rather than given back by a refund.
 *
 * The two are different events with different words on them: money returned, versus the buyer saying
 * they no longer want it. current_quantity is what is left after BOTH, so what the refunds do not
 * account for is what the edit removed. Clamped at zero — a refund recorded before Shopify has
 * settled current_quantity would otherwise read as a negative removal. */
function soRemovedQty(i) {
  if (i.cq == null) return 0;
  const q = Number(i.qty) || 0, rq = Number(i.rq) || 0;
  return Math.max(0, q - rq - Math.max(0, Number(i.cq) || 0));
}

/* How many units of a line to actually send, for THIS order.
 *
 * Stored per order, not per SKU — unlike the Amazon SKU beside it, which is a fact about the product
 * and holds for every order. A quantity is a fact about one order, and a number that quietly applied
 * itself to every future order of the same SKU would ship the wrong count with nothing on screen to
 * show where it came from.
 *
 * Absent means "send what was ordered". Only a typed figure is stored, so the map holds decisions
 * rather than a copy of the order. */
function soSendQty(orderId, sku, ordered) {
  const q = ((SHOP_META[orderId] || {}).q || {})[String(sku || '').trim().toUpperCase()];
  if (q != null && isFinite(q)) return Number(q);
  // No typed figure: send what is owed, in AMAZON packs. The factor is 1 unless a pack split has
  // fully resolved, so this is the ordinary quantity for every line that is not one.
  return (Number(ordered) || 0) * soPackFactorOf(sku);
}
async function soSetQty(orderId, sku, value, ordered) {
  const k = String(sku || '').trim().toUpperCase(); if (!orderId || !k) return;
  const e = SHOP_META[orderId] || (SHOP_META[orderId] = {});
  const map = e.q || (e.q = {});
  // Blank, or the same as ordered, is not an override — it is the absence of one.
  if (value === '' || value == null || Number(value) === Number(ordered)) delete map[k];
  else map[k] = Math.max(0, Math.round(Number(value)));
  if (!Object.keys(map).length) delete e.q;
  await saveShopMeta();
}
/** One field of the SKU record, written and cleared in one place so an empty box means "not set". */
async function soSetSku(sku, field, value) {
  const k = String(sku || '').trim().toUpperCase();
  if (!k) return;
  const rec = SHOP_SKU[k] || (SHOP_SKU[k] = {});
  if (value === '' || value == null) delete rec[field]; else rec[field] = value;
  if (!Object.keys(rec).length) delete SHOP_SKU[k];
  await saveShopSku();
}

/* India stock, LIVE from the warehouse workbook.
 *
 * Not the Replenishment app's copy — that one is a CSV somebody uploads and it had gone stale, which
 * is what started this. One source, read on demand, so a figure here and a figure in the warehouse
 * cannot drift apart.
 *
 * Two quantities come back and they are not interchangeable: PIECES on the shelf, and how many
 * SELLABLE units that is once the pack size is applied. A Shopify customer buys a set, so an order
 * line is compared against the sellable figure; the pieces stay in the tooltip.
 */
let SHOP_INDIA = {}, SHOP_INDIA_AT = '', SHOP_INDIA_LOADED = false, SHOP_INDIA_ERR = '';
async function loadShopIndia() {
  if (SHOP_INDIA_LOADED) return;
  SHOP_INDIA_LOADED = true;                 // one attempt per session; a failure must not retry per render
  try {
    /* THE SAME CALL THE REPLENISHMENT TAB MAKES — one payload, one ten-second wait, not two. What
     * is NOT shared is the cache: this figure decides whether a Shopify line goes to production,
     * and that decision is never made from what was read yesterday.
     *
     * The sharing is opportunistic on purpose. indiaLive lives in the Replenishment part of this
     * page; this part is also read on its own, by the Shopify tests, where that name does not
     * exist. Sharing when it can, asking for itself when it cannot, keeps this screen standing on
     * its own feet. */
    let r;
    try { r = await indiaLive(); }
    catch (e) {
      if (!(e instanceof ReferenceError)) throw e;
      r = await prGet({ india: 'stock' });
    }
    SHOP_INDIA = r.d || {};
    SHOP_INDIA_AT = r.at || '';
  } catch (e) {
    // Left EMPTY, never zeroed. "We could not read India stock" and "there is none in India" are
    // different answers, and only one of them should stop somebody shipping.
    SHOP_INDIA = {};
    SHOP_INDIA_ERR = e.message || String(e);
  }
}
/** [sellable, pieces, pack, status] for a line — tried on the Shopify code AND the mapped Amazon one. */
function soIndiaOf(sku) {
  const shop = String(sku || '').trim().toUpperCase();
  const amz = soAmzKey(sku);
  return SHOP_INDIA[shop] || SHOP_INDIA[amz] || null;
}

/**
 * Write sku → quantity for a brand — and REFUSE to replace a real shelf with an empty one.
 *
 * `stock/{brand}` is read by Listing Health, Inventory Age, Parent Listing Review AND the Shopify
 * Orders MCF column. A report that comes back with no rows — Amazon still building it, a throttled
 * call, a bad window — used to be written straight over the top, and every one of those screens then
 * reported "Amazon has never seen this SKU" for the WHOLE catalogue. Nothing was wrong with the data
 * until the moment it was replaced.
 *
 * An empty report is not news about the shelf. It is news about the report, so the old figures stay
 * and the failure is said out loud instead. Found the hard way, 2026-09-01.
 */
async function saveStockDoc(brand, map) {
  const n = Object.keys(map || {}).length;
  if (!n) {
    throw new Error(`Amazon's stock report for ${BRAND_NAME[brand] || brand} came back with no rows, `
      + 'so nothing was saved — the quantities you already had are untouched. '
      + 'Amazon is usually still building the report; try again in a few minutes.');
  }
  await setDoc(doc(db, 'stock', brand), { m: map, n, at: serverTimestamp() });
  return n;
}

let SHOP_STOCK_DENIED = false;
async function loadShopStock() {
  SHOP_STOCK_DENIED = false;
  SHOP_STOCK = {}; SHOP_STOCK_CASE = {};
  SHOP_STOCK_BY = { SP: {}, CPC: {} }; SHOP_STOCK_CASE_BY = { SP: {}, CPC: {} };
  for (const b of ['SP', 'CPC']) {
    try {
      const s = await getDoc(doc(db, 'stock', b));
      if (!s.exists()) continue;
      Object.entries(s.data().m || {}).forEach(([sku, q]) => {
        const k = String(sku).trim().toUpperCase();
        SHOP_STOCK[k] = Math.max(SHOP_STOCK[k] || 0, Number(q) || 0);
        if (!SHOP_STOCK_CASE[k]) SHOP_STOCK_CASE[k] = String(sku).trim();
        SHOP_STOCK_BY[b][k] = Math.max(SHOP_STOCK_BY[b][k] || 0, Number(q) || 0);
        if (!SHOP_STOCK_CASE_BY[b][k]) SHOP_STOCK_CASE_BY[b][k] = String(sku).trim();
      });
    } catch (e) {
      /* NOT ALLOWED IS NOT "NO STOCK" (2026-09-26): an account without the Sellora Shopify tab is refused this read, and
       * every order then looked unreadable with no word why. Said once, by name. */
      if (/permission|insufficient/i.test(String((e && (e.code || e.message)) || ''))) SHOP_STOCK_DENIED = true;
    }
  }
  // Loaded means "we asked and got an answer", which is what lets the column say "not in Amazon"
  // instead of "SKU ?". An empty map is NOT an answer — it means nothing was read.
  SHOP_STOCK_LOADED = Object.keys(SHOP_STOCK).length > 0;
}


/* The cross-project production view USED to sit here: this app published a stripped copy of each
 * order into a second Firebase project so the production tracker could read it and comment back.
 * It was dropped when that tracker was replaced by the Replenishment tab you are reading now —
 * one app, one copy, nothing to publish. Nothing below depends on it. */

/** The account's name as people say it. */
const soAcctName = b => (b === 'CPC' ? 'CPC' : 'Ridhi');
/**
 * THE ORDER'S OWN AMAZON ACCOUNT (Ravi, 2026-09-24: "ridhi ke order me only ridhi dikhna chahiye and cpc
 * ke cpc"). A CPC shop order is judged, shown and shipped on CPC's FBA; every other order on Ridhi's.
 * The other account's stock is never offered — not in the route, not in the FBA column, not in the MCF.
 */
const soOrdBrand = o => (o && o.shopBrand === 'CPC' ? 'CPC' : 'SP');
/** FBA units of an Amazon SKU in THIS order's account; null when that account does not stock it. */
const soOrdFba = (o, key) => soFbaIn(soOrdBrand(o), key);
/** FBA units of an Amazon SKU in ONE account; null when that account does not stock it. Falls back to
 *  the merged figures when only those are known (an older stock read). */
function soFbaIn(brand, key) {
  const k = String(key || '').trim().toUpperCase(); if (!k) return null;
  const split = Object.keys(SHOP_STOCK_BY.SP || {}).length || Object.keys(SHOP_STOCK_BY.CPC || {}).length;
  if (!split) return k in SHOP_STOCK ? SHOP_STOCK[k] : null;
  const by = SHOP_STOCK_BY[brand] || {};
  return k in by ? by[k] : null;
}
/** Is this line part of a parcel already sent to Amazon? An order sent before mcfSkus existed went whole. */
function soMcfHas(orderId, sku) {
  const meta = SHOP_META[orderId] || {};
  if (!meta.mcfId) return false;
  if (!Array.isArray(meta.mcfSkus)) return true;
  return meta.mcfSkus.map(x => String(x).toUpperCase()).indexOf(String(sku || '').trim().toUpperCase()) >= 0;
}
/**
 * What ONE account can ship of this order, line by line.
 *
 * Ravi, 2026-09-24: an order of four lines with one of them in FBA should go to Amazon as ONE line,
 * and the other three should not be in it. Only lines the account holds enough of are sent; the
 * others are named with the reason and stay where they are — India, or production.
 */
function soMcfPlan(o, brand) {
  const acct = soAcctName(brand);
  const send = [], out = [];
  (o.items || []).forEach(i => {
    const live = soLive(i), need = soSendQty(o.id, i.sku, live);
    if (!live || !need) return;                                  // refunded, removed, or set to 0 on purpose
    const shop = String(i.sku || '').trim().toUpperCase();
    if (soMcfHas(o.id, i.sku)) return;                           // already with Amazon
    const label = i.sku || i.name;
    const key = soAmzKey(i.sku);
    if (!key) { out.push({ i, label, why: 'no SKU on Shopify' }); return; }
    const have = soFbaIn(brand, key);
    if (have == null) { out.push({ i, label, why: 'not in ' + acct + ' FBA' }); return; }
    if (have < need) { out.push({ i, label, why: 'only ' + have + ' in ' + acct + ' FBA, need ' + need }); return; }
    send.push({ i, label, shop, amz: (SHOP_STOCK_CASE_BY[brand] || {})[key] || soAmzSku(i.sku), qty: need, have });
  });
  return { acct, send, out };
}
/** The account that can ship the most lines; on a tie, the shop's own account. */
function soBestBrand(o) {
  const a = soMcfPlan(o, 'SP').send.length, b = soMcfPlan(o, 'CPC').send.length;
  if (a === b) return o.shopBrand === 'CPC' ? 'CPC' : (soGuessBrand(o) || 'SP');
  return b > a ? 'CPC' : 'SP';
}
/** The FBA figure for a line in THIS order's account only — one chip, never the other account's. */
function soFbaChips(key, need, brand) {
  const k = String(key || '').trim().toUpperCase();
  if (!k) return '<span class="muted">—</span>';
  const h = soFbaIn(brand || 'SP', k);
  if (h == null) return '<span class="muted">not in FBA</span>';
  return h >= need ? '<span class="st st-approved">' + h + '</span>' : '<span class="st st-rejected">only ' + h + '</span>';
}

/* ---- from Sellora: the rest of the orders screen ---- */
function soMcf(order) {
  // Refunded lines are OUT, not counted as a shortage. A line that came back is not something the
  // warehouse has to find — leaving it in kept whole orders sitting in "Need from production" for
  // goods nobody is owed.
  const lines = order.items.filter(i => soLive(i) > 0);
  if (!lines.length) {
    return order.items.length
      ? { v: 'none', why: 'Nothing left to send — every line is refunded or set to 0.' }
      : { v: 'unknown', why: 'No line items.' };
  }
  let ok = 0, short = 0, missing = 0;
  const detail = [];
  lines.forEach(i => {
    // Judged on the AMAZON sku, which is the Shopify one unless somebody has mapped it, and against
    // the quantity actually BEING SENT — not the ordered one, once those differ.
    const sku = soAmzSku(i.sku);                          // spelled Amazon's way, for people
    const key = soAmzKey(i.sku);                          // upper case, for looking up
    const shown = String(i.sku || '').trim().toUpperCase();
    const as = key !== shown ? ` (as ${sku})` : '';
    const need = soSendQty(order.id, i.sku, soLive(i));
    const live = soLive(i);
    const back = (Number(i.rq) || 0) ? `, ${i.rq} refunded` : '';
    const sending = need !== i.qty ? ` (sending ${need} of ${i.qty}${back})` : back;
    if (!need) return;                                   // set to 0 on purpose — not a shortage
    const have = key ? soOrdFba(order, key) : null;
    if (have == null) { missing++; detail.push(`${i.sku || i.name}${as}: not in ${soAcctName(soOrdBrand(order))} FBA`); return; }
    if (have >= need) { ok++; detail.push(`${shown}${as}: ${have} in FBA, need ${need}${sending}`); }
    else { short++; detail.push(`${shown}${as}: only ${have} in FBA, need ${need}${sending}`); }
  });
  const why = detail.join(' · ');
  if (missing === lines.length) return { v: 'unknown', why };
  if (ok === lines.length) return { v: 'yes', why };
  if (ok === 0 && short === 0) return { v: 'unknown', why };
  if (ok > 0) return { v: 'part', why };
  return { v: 'no', why };
}

/**
 * Can INDIA fulfil this order, and how completely? Same shape as soMcf so the two columns read the
 * same way — a person scanning the list is asking one question, "where can this ship from".
 *
 * Judged in SELLABLE units. The warehouse counts pieces and a pack of 2 is one orderable set, so a
 * line for ×1 needs 1 sellable unit, not 1 piece. Comparing an order line against pieces would call
 * a set-of-two "in stock" on a single loose piece.
 *
 * Quantities are the ones being SENT, so a line adjusted down asks India for less too.
 */

/* ---------- India stock, SHARED OUT ACROSS ORDERS ------------------------------------------
 *
 * THE BUG THIS EXISTS TO KILL (Ravi, 2026-09-01): five pieces in India and ten orders wanting one
 * each used to read "India ready" on all ten. Every order was compared against the whole shelf, so
 * the same five pieces were promised five times over — and the promise looked identical on every
 * row, which is what made it so hard to see.
 *
 * A shelf is not a per-order fact. It is one pile that runs out. So it is shared out ONCE, over all
 * the orders together, before a single verdict is drawn.
 *
 * WHO IS IN THE QUEUE, and why:
 *   · OLDEST FIRST. Whoever ordered first has the first claim — the same rule the warehouse would
 *     use, and the only one that does not need a person to arbitrate.
 *   · Cancelled orders take nothing.
 *   · An order already sent to Amazon takes nothing — it is coming out of Amazon's stock, not ours.
 *   · An order Amazon can fill COMPLETELY takes nothing either. soRoute prefers MCF over India, so
 *     reserving Indian stock for it would hold goods back for a parcel that is never going to use
 *     them. (That check reads FBA only, so it cannot loop back into this one.)
 *
 * What is deliberately NOT attempted: splitting a line between Amazon and India. An order Amazon can
 * only half fill asks India for the whole line. Modelling the split properly means deciding how a
 * part-shipment is actually picked and packed, and that is a decision about the warehouse, not a
 * calculation.
 */
let SO_INDIA_TAKEN = {};      // order id → { sku key → { stock, before, got, need } }

/** The key an India row was actually found under — the Shopify code or the Amazon one. */
function soIndiaKey(sku) {
  const shop = String(sku || '').trim().toUpperCase();
  if (SHOP_INDIA[shop]) return shop;
  const amz = soAmzKey(sku);
  if (SHOP_INDIA[amz]) return amz;
  return '';
}

function soAllocIndia(orders) {
  SO_INDIA_TAKEN = {};
  if (!SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return;   // nothing read, nothing to share out

  const left = {};                                    // sku key → units still unspoken for
  const queue = orders.slice().sort((a, b) =>
    String(a.at || '').localeCompare(String(b.at || '')) || String(a.no || '').localeCompare(String(b.no || '')));

  queue.forEach(o => {
    if (o.cancelled) return;
    const sm = SHOP_META[o.id] || {};
    if (sm.mcfId && !Array.isArray(sm.mcfSkus)) return; // the whole order went to Amazon
    /* A part-order: the lines Amazon did not take still need India, or production. */
    const lines = o.items.filter(i => soSendQty(o.id, i.sku, soLive(i)) > 0 && !soMcfHas(o.id, i.sku));
    if (!lines.length) return;
    if (soMcf(o).v === 'yes') return;                  // Amazon has it covered; leave India alone

    const take = {};
    lines.forEach(i => {
      const key = soIndiaKey(i.sku);
      if (!key) return;                                // not in the India list at all
      const row = SHOP_INDIA[key];
      const stock = Number(row[0]) || 0;
      if (left[key] == null) left[key] = stock;
      const need = soSendQty(o.id, i.sku, soLive(i));
      const got = Math.max(0, Math.min(need, left[key]));
      // `before` is what earlier orders already hold. It is the whole explanation for a row that
      // reads "No stock" while the warehouse column still shows a number, so it is carried through
      // rather than recomputed later from figures that will have moved on.
      take[key] = { stock: stock, before: stock - left[key], got: got, need: need };
      left[key] -= got;
    });
    SO_INDIA_TAKEN[o.id] = take;
  });
}

function soIndia(order) {
  // Still on its way, or it failed. Either way this is NOT a verdict about the warehouse — the
  // column now fills in a moment after the orders, so it is briefly unknown by design.
  if (!SHOP_INDIA_LOADED || SHOP_INDIA_ERR) {
    return { v: 'unknown', why: SHOP_INDIA_ERR
      ? 'India stock could not be read: ' + SHOP_INDIA_ERR
      : 'Still reading India stock from the warehouse workbook…' };
  }
  const lines = order.items.filter(i => soSendQty(order.id, i.sku, soLive(i)) > 0);
  if (!lines.length) return { v: 'none', why: 'Nothing left to send — every line is refunded or set to 0.' };
  let ok = 0, short = 0, missing = 0;
  const detail = [];
  const mine = SO_INDIA_TAKEN[order.id] || {};
  lines.forEach(i => {
    const need = soSendQty(order.id, i.sku, soLive(i));
    const row = soIndiaOf(i.sku);
    const shown = String(i.sku || '').trim().toUpperCase();
    if (!row) { missing++; detail.push(`${shown}: not in the India list`); return; }
    const pieces = row[1], pack = row[2];
    const asPieces = pack > 1 ? ` — ${pieces} pieces, pack of ${pack}` : '';
    // What this order was actually given, not what is on the shelf. An order that arrived after the
    // stock ran out gets 0 even though the warehouse column still shows a number, and the reason
    // says exactly that instead of leaving somebody to wonder.
    const a = mine[soIndiaKey(i.sku)] || { stock: Number(row[0]) || 0, before: 0, got: 0 };
    const spoken = a.before
      ? `${a.stock} in India, ${a.before} already promised to earlier orders, ${a.got} left for this one`
      : `${a.stock} in India`;
    if (a.got >= need) { ok++; detail.push(`${shown}: ${spoken}, need ${need}${asPieces}`); }
    else { short++; detail.push(`${shown}: ${spoken}, need ${need}${asPieces}`); }
  });
  const why = detail.join(' · ') + (SHOP_INDIA_AT ? ` · read ${SHOP_INDIA_AT}` : '');
  if (missing === lines.length) return { v: 'unknown', why };
  if (ok === lines.length) return { v: 'yes', why };
  if (ok === 0 && short === 0) return { v: 'unknown', why };
  if (ok > 0) return { v: 'part', why };
  return { v: 'no', why };
}

/* ONE LINE'S OWN ANSWER to "what happens to this piece".
 *
 * The order-level route is a summary of these, and a summary is exactly what somebody packing,
 * costing or chasing a single line cannot use: an order half in FBA and half still to be made reads
 * "Need from production" and says nothing at all about the half that could go today.
 *
 * The order of preference is soRoute's, deliberately — already sent, then cancelled, then nothing
 * owed, then FBA, then India, then production. A line and its order can then never disagree about
 * which source was picked.
 */
function soLineState(order, item) {
  const q = Number(item.qty) || 0;
  const rq = Number(item.rq) || 0;
  const live = soLive(item);
  const note = [];
  if (rq) note.push(`${rq} of ${q} refunded`);
  const goneNow = soRemovedQty(item);
  if (goneNow) note.push(`${goneNow} of ${q} removed by buyer`);
  // A pack split, resolved or not, is the thing that explains an unexpected quantity — or an
  // unexpected "not in FBA". It belongs wherever the line explains itself.
  const fit = soPackFit(item.sku);
  if (fit) note.push(fit.why);
  const back = note.length ? ' · ' + note.join(', ') : '';

  const sentId = (SHOP_META[order.id] || {}).mcfId || '';
  /* Only the lines that were IN the parcel. A part-order leaves the rest open, where they belong. */
  if (sentId && soMcfHas(order.id, item.sku)) return { v: 'sent', label: 'MCF done', why: `Sent to Amazon as ${sentId}` + back };

  const gone = soRemovedQty(item);
  if (q > 0 && live === 0) {
    // REMOVED IS NOT REFUNDED, and the picker needs the difference. One is the buyer changing the
    // order; the other is money going back. Reading both as "cancelled" loses the only fact that
    // explains why a paid-for line is not being sent.
    if (gone > 0 && gone >= rq) {
      return { v: 'removed', label: 'Not required',
        why: 'Removed by buyer' + (gone < q ? ` (${gone} of ${q})` : '') };
    }
    return {
      v: 'cancelled', label: 'Cancelled',
      why: rq >= q ? `Refunded on Shopify — all ${q}`
        : 'Shopify says fulfilment is not required for this line',
    };
  }

  const need = soSendQty(order.id, item.sku, live);
  if (!need) return { v: 'hold', label: 'Not being sent', why: 'send qty is set to 0 on this order' + back };

  /* MARKED OOS BY A PERSON. It outranks both stock maps — they are a file, this is somebody looking
   * at the shelf — but never outranks an order already sent to Amazon or a line nobody is sending,
   * which is why it sits below those two and above the rest. */
  if (soLineIsOos(order.id, item.sku)) {
    return { v: 'make', label: 'Out of stock — to make',
      why: `marked OOS on this line, so it is made rather than filled — need ${need}` + back };
  }

  const amz = soAmzSku(item.sku);
  const fbaKey = String(amz || '').toUpperCase();
  const fba = fbaKey ? soOrdFba(order, fbaKey) : null;
  if (fba != null && fba >= need) {
    return { v: 'fba', label: 'FBA ready', why: `${fba} in FBA, need ${need}` + back };
  }
  const ind = soIndiaOf(item.sku);
  // The SHARE this order holds, so a line can never claim stock the order-level column has already
  // given to somebody earlier. A line and its order disagreeing is worse than either being wrong.
  const iShare = (SO_INDIA_TAKEN[order.id] || {})[soIndiaKey(item.sku)];
  const iHave = iShare ? iShare.got : (ind ? Number(ind[0]) || 0 : 0);
  if (ind && iHave >= need) {
    return { v: 'india', label: 'India stock ready',
      why: `${iHave} sellable in India for this order, need ${need}` + back };
  }
  // Neither can cover it alone. Both figures go in the reason: "make 2" and "make 40" are different
  // conversations, and the difference is sitting in exactly these two numbers.
  const has = [fba == null ? 'not in FBA' : `${fba} in FBA`];
  has.push(ind
    ? (iShare && iShare.before
        ? `${iShare.stock} in India but ${iShare.before} promised to earlier orders, ${iHave} left here`
        : `${iHave} sellable in India`)
    : (SHOP_INDIA_LOADED && !SHOP_INDIA_ERR ? 'not in the India list' : 'India stock not read yet'));
  return { v: 'make', label: 'Required from production', why: `need ${need} — ${has.join(', ')}` + back };
}

/**
 * The same design in another size, where there is stock to be had.
 *
 * "Same design" is the master's own answer — brand, article, subtype and colour equal, size
 * different — so nothing is matched on a code that merely looks similar. Both stores are asked:
 * what Amazon holds for that size, and what the India store holds. Nothing is ever swapped: the
 * customer bought a size, and this is a suggestion to a person, not a decision.
 */
function soSizeAlternatives(sku, brand) {
  const m = mdbOf(sku);
  if (!m) return [];
  /* SUBTYPE IS NOT PART OF "same design". RTC327-6060 is a SQUARE tablecloth and RTC327-6090 a
   * RECTANGULAR one — the same print in the same colour, which is exactly the pair Ravi named. So
   * brand, article and colour decide, the subtype is shown where it differs, and a size of the same
   * subtype is offered first because it is the likelier swap. */
  /* THE DESIGN IS THE CODE BEFORE THE SIZE. RTC327-6060 and RTC327-6090 are one design in two
   * sizes; RTCRU327-5454 is the RUFFLE version — a different product that happens to share the
   * number, and offering it as "another size" would send the wrong thing to a customer. Colour is
   * checked too, because a code can be reused across colourways. */
  const stem = c => { const i = String(c || '').lastIndexOf('-'); return obUC(i > 0 ? String(c).slice(0, i) : c); };
  const mine = stem(sku);
  const same = r => r && r.sku && obUC(r.sku) !== obUC(sku)
    && stem(r.sku) === mine
    && obUC(r.color) === obUC(m.color)
    && obUC(r.size) !== obUC(m.size);
  const out = [];
  (PTG.mdb || []).filter(same).forEach(r => {
    const code = obUC(r.sku);
    const amzKey = String(soAmzSku(code) || '').toUpperCase();
    const fba = amzKey ? (brand ? Number(soFbaIn(brand, amzKey)) || 0 : (amzKey in SHOP_STOCK ? Number(SHOP_STOCK[amzKey]) || 0 : 0)) : 0;
    const ind = soIndiaOf(code);
    const india = ind ? Number(ind[0]) || 0 : 0;
    if (fba <= 0 && india <= 0) return;                 // no stock, no suggestion
    out.push({ sku: code, size: r.size || '', fba, india,
      /* Said only when it is not the same shape — "60X90" alone would hide that it is rectangular. */
      shape: obUC(r.subtype) === obUC(m.subtype) ? '' : (r.subtype || ''),
      sameShape: obUC(r.subtype) === obUC(m.subtype) });
  });
  return out.sort((a, b) => (b.sameShape - a.sameShape) || ((b.fba + b.india) - (a.fba + a.india))).slice(0, 4);
}

/* The India column's own words.
 *
 * It used to borrow SO_MCF_TAG, so an order India could fill printed "MCF ready" — Amazon's verdict,
 * in Amazon's words, sitting in the India column. On an order whose MCF cell said "SKU ?" that read
 * as a flat contradiction, and it is what sent Ravi hunting for a bug in the MCF logic (2026-08-25).
 * India can never be 'sent': only Amazon can be sent to, so that state is not in this map.
 */
const SO_INDIA_TAG = {
  yes:     '<span class="st st-approved">In stock</span>',
  part:    '<span class="st st-pending">Partly</span>',
  no:      '<span class="st st-rejected">No stock</span>',
  unknown: '<span class="st st-draft">SKU ?</span>',
  none:    '<span class="st st-draft">Nothing to send</span>',
};

const SO_LINE_TAG = {
  sent:      '<span class="st st-approved" style="font-weight:700">MCF done</span>',
  cancelled: '<span class="st st-rejected">Cancelled</span>',
  removed:   '<span class="st st-rejected">Not required</span>',
  hold:      '<span class="st st-draft">Not sent</span>',
  fba:       '<span class="st st-approved">FBA ready</span>',
  india:     '<span class="st st-approved">India ready</span>',
  make:      '<span class="st st-pending">To produce</span>',
};

/**
 * WHERE THIS ORDER CAN SHIP FROM — one verdict, worked out once.
 *
 * The MCF and India columns each answer half of it, and reading two columns to reach one decision is
 * how the same order gets judged differently by two people. This is that decision, and it is the same
 * string on screen, in the filter and in the export — so a routing call made in the app and one made
 * in a spreadsheet cannot disagree.
 *
 * PENDING is Ravi's definition: neither Amazon nor India can fill it, so something has to be MADE.
 * Partly-stocked counts as pending too — half an order shipped is not an order shipped, and the
 * missing half still has to come from somewhere.
 */
function soRoute(r) {
  if (r.mcf === 'sent') return 'MCF done';
  if (r.cancelled) return 'Cancelled';
  /* Somebody has written DONE on it. That is a decision, and it outranks what the stock maps say —
   * this is the same string the pending count, the filter and the export all read, so the screen
   * and the production order can never disagree about it. */
  if (r.handled) return 'Marked done';
  if (r.mcf === 'none') return 'Nothing to send';
  if (r.mcf === 'yes') return 'MCF ready';
  if (r.india === 'yes') return 'Ship from India';
  return 'Need from production';
}
const soIsPending = r => soRoute(r) === 'Need from production';
/** Orders with a line waiting in the production bucket, from the last draw. */
let SO_IN_BUCKET = new Set();
/** Production's status for the shipping team, above the route (2026-09-26). */
function soProdChip(r) {
  const p = soProdStatus(r);
  if (p) return `<div style="margin-bottom:3px"><span class="st ${p.tone === 'done' ? 'st-approved' : 'st-pending'}" title="From the Order Console">${esc(p.txt)}</span></div>`;
  return SO_IN_BUCKET.has(String(r && r.id)) ? '<div style="margin-bottom:3px"><span class="st st-draft" title="Needs production — open it from the Production bucket">In the production bucket</span></div>' : '';
}

/** The MCF cell. 'unknown' is drawn differently depending on whether we have Amazon's stock yet. */
const soMcfTag = v => SO_MCF_TAG[(v === 'unknown' && SHOP_STOCK_LOADED) ? 'notamz' : v] || SO_MCF_TAG.unknown;

const SO_MCF_TAG = {
  // Placed with Amazon. Deliberately the loudest thing in the column: this is the one state where
  // acting again costs a second parcel.
  sent:    '<span class="st st-approved" style="font-weight:700">MCF done</span>',
  yes:     '<span class="st st-approved">MCF ready</span>',
  part:    '<span class="st st-pending">Partly</span>',
  no:      '<span class="st st-rejected">No stock</span>',
  /* Two different facts used to wear the same label. "SKU ?" now means ONLY "Amazon's stock has not
   * been read yet"; once it has, a code Amazon does not carry is not a mystery — it is an answer,
   * and it says so. Ravi, 2026-08-25: an item that is on Shopify and in India but not on Amazon
   * should read "Not in Amazon", not a question mark. */
  unknown: '<span class="st st-draft">SKU ?</span>',
  notamz:  '<span class="st st-draft">Not in Amazon</span>',
  // Nothing is owed on this order any more. Not a stock verdict at all, which is why it is not
  // dressed as one.
  none:    '<span class="st st-draft">Nothing to send</span>',
};

/* Shopify's own fulfilment state. "partial" is kept as its own thing rather than being rounded to
 * shipped or not — a half-shipped order is the one that actually needs somebody to look at it. */
const SO_FF_TAG = {
  fulfilled:   '<span class="st st-approved">Shipped</span>',
  partial:     '<span class="st st-pending">Part shipped</span>',
  restocked:   '<span class="st st-rejected">Restocked</span>',
  unfulfilled: '<span class="st st-draft">Not shipped</span>',
};
const soFfTag = v => SO_FF_TAG[String(v || 'unfulfilled').toLowerCase()]
  || '<span class="st st-draft">' + String(v) + '</span>';

/* Three states that change what you do with an order, none of which Shopify hands over as a field.
 *
 * CANCELLED is the one solid fact: `cancelledAt` comes straight from Shopify. It matters because a
 * cancelled order arrives looking exactly like a live one — status=any returns it and its
 * fulfilment status stays null, i.e. indistinguishable from "nobody has packed it yet".
 *
 * CHARGEBACK is NOT in Shopify's order payload at all. The real source is the Shopify Payments
 * disputes endpoint, which needs a scope this token does not hold (see the Shopify token blocker).
 * So it is read from what is WRITTEN on the order — its tags, either note, or the status typed in
 * this app. That means it is only as good as the tagging; it will never invent one, and it will
 * miss a dispute nobody has written down.
 *
 * MCF DONE is our own convention: the words "MCF done" in a note. Read from BOTH notes and the
 * status box, because it gets written in whichever one is to hand.
 */
const SO_CB_RE = /charge\s*-?\s*back|dispute/i;
const SO_MCFDONE_RE = /mcf\s*-?\s*done/i;

/* WORDS THAT MEAN "THIS ONE IS DEALT WITH", written on the order.
 *
 * Ravi, 2026-09-07: an order whose Shopify note says DONE, READY or READY TO SHIP is already handled
 * and must not open a production order.
 *
 * MATCHED AS A WHOLE SEGMENT, NEVER AS A SUBSTRING. "done by Friday" and "ready when the fabric
 * arrives" mean the opposite of finished, and a loose match would quietly stop those being made —
 * a failure that shows up as goods nobody produced, weeks later, with nothing on any screen having
 * said so. So the text is split on line breaks, commas and semicolons, and a segment has to BE one
 * of the words, not contain it.
 *
 * Read from the same four places as the MCF-done convention: Shopify's own note, our note, the
 * status box and the tags — because it gets written in whichever one is to hand. */
const SO_HANDLED_RE = /^(done|ready|ready\s*to\s*ship)$/i;
function soHandledIn(txt) {
  return String(txt || '').split(/[\n\r,;§|]+/)
    .some(seg => SO_HANDLED_RE.test(seg.trim().replace(/^[\s"'“”\-–—:.]+|[\s"'“”\-–—:.!]+$/g, '')));
}
function soFlags(o, meta) {
  const written = [o.tags, o.note, meta.note, meta.s].filter(Boolean).join(' § ');
  const cbHit = written.match(SO_CB_RE);
  /* AN ORDER WHOSE EVERY LINE CAME BACK IS OVER, whatever Shopify calls it.
   *
   * Shopify only sets cancelled_at when somebody cancels the order itself. Refund every line instead
   * and the order stays "open" with fulfilment_status null — which is indistinguishable from
   * "nobody has packed it yet". It then sat in the pending list for ever, and an MCF parcel could
   * still be sent for goods that had already been paid back.
   *
   * Only when NOTHING SHIPPED. An order that went out and was refunded afterwards is a return, not a
   * cancellation, and calling it cancelled would hide a parcel that really did leave. */
  const owed = (o.items || []).filter(i => (Number(i.qty) || 0) > 0);
  const went = /^(ful|partial)/i.test(String(o.ff || ''));
  const allBack = !went && owed.length > 0 && owed.every(i => soLive(i) === 0);
  return {
    /* SHIPPED IS FULLY SHIPPED, at the ORDER level: "fulfilled" means the whole thing went. "partial"
     * is not read here — not because the payload cannot say which line, which was my mistake, but
     * because the LINE says it itself, in ffl, and shpNeeds asks it there. */
    shipped: /^ful/i.test(String(o.ff || '')),
    cancelled: !!o.cancelledAt || allBack,
    refundCancel: !o.cancelledAt && allBack,
    cancelReason: o.cancelReason || (allBack && !o.cancelledAt
      ? 'every line refunded on Shopify — fulfilment not required' : ''),
    chargeback: !!cbHit,
    cbWhy: cbHit ? `Read from the order text: “${String(written).slice(0, 120)}”` : '',
    mcfDone: SO_MCFDONE_RE.test(written),
    handled: soHandledIn(o.note) || soHandledIn(meta.note) || soHandledIn(meta.s) || soHandledIn(o.tags),
    handledWhy: [['the Shopify note', o.note], ['our note', meta.note], ['the status box', meta.s], ['the tags', o.tags]]
      .filter(([, v]) => soHandledIn(v)).map(([w, v]) => w + ' says “' + String(v).trim().slice(0, 40) + '”').join(', '),
  };
}

/** Tracking numbers as one cell — linked when Shopify gave a URL, plain when it did not. */
function soTrkCell(r, esc) {
  const list = r.trk || [];
  if (!list.length) return '<span class="muted">—</span>';
  const txt = esc(list.join(', '));
  const body = r.trkUrl
    ? '<a href="' + esc(r.trkUrl) + '" target="_blank" rel="noopener">' + txt + '</a>'
    : txt;
  return body + (r.trkCo ? '<div class="muted" style="font-size:10.5px">' + esc(r.trkCo) + '</div>' : '');
}

/* Today in the STORE's day, because that is the day every order date here is written in. Falling
 * back to PT is better than falling back to the viewer's clock — an evening in India is still the
 * previous day in any US store — but it can be a day out, so the strip says when it is guessing. */
function soStoreDay(offsetDays) {
  const tz = SHOP.tz;
  const now = tz ? sdWall(Date.now(), tz) : sdPT(Date.now());
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (offsetDays || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// A cancelled order is not a sale, so it is out of the count, the units and the money alike.
function soDayStats(iso) {
  /* THE SHOP CHOICE COUNTS HERE, nothing else in the toolbar does. Two stores sell on the same day,
   * and a day's takings belong to one of them. */
  const chans = msVals('soChan');
  const rows = SHOP.orders.concat(soImpLive()).filter(o => soInShop(o, chans));
  const live = rows.filter(o => o.at === iso && !o.cancelledAt);
  return {
    orders: live.length,
    units: live.reduce((s, o) => s + o.items.reduce((n, i) => n + (i.qty || 0), 0), 0),
    value: live.reduce((s, o) => s + (o.total || 0), 0),
    cancelled: rows.filter(o => o.at === iso && o.cancelledAt).length,
  };
}

/** Is this order in the shop(s) the toolbar is showing? Nothing chosen means all of them.
 *  The chosen list is read from the DOM, so it is read once and reused, not per order. */
function soInShop(o, chans) {
  const list = chans || msVals('soChan');
  return !list.length || list.includes(o.channel || 'Shopify');
}

/** The shops being counted, for the label — "" when it is all of them. */
function soShopLabel() {
  const chans = msVals('soChan');
  return chans.length ? chans.join(' + ') : '';
}

/** Orders older than this are re-fetched when the tab is opened again. */
const SHOP_STALE_MS = 2 * 60 * 1000;
let SHOP_FETCHED_AT = 0;

/* Wrapped, so a failure on the way IN is visible instead of silent.
 *
 * Anything that throws in here — a denied read, a bad cache, a name used before its line — leaves the
 * tab looking simply empty: no table, no summary, no error. Somebody then presses Fetch, which
 * cannot help, and concludes the app is broken rather than that one step failed. */
async function ensureShop() {
  try { await ensureShop_(); }
  catch (e) {
    console.error('[shop] ensureShop failed:', e);
    soMsg('This tab could not finish loading: ' + (e && e.message || e)
      + ' — the list below may be incomplete. Press F12 → Console for the full trace.', true);
    try { renderShop(); } catch (e2) { /* already reported */ }
  }
}
/**
 * The date of the oldest Shopify order still open in production, or '' when there is none.
 *
 * CAPPED, because one fetch has to come back. A year of orders would page for ever and the screen
 * would show nothing while it did; anything older than that is a question for a person, not for a
 * sweep that runs on the way into a tab.
 */
const SHP_REACH_MAX_DAYS = 150;
function shpOldestOpen() {
  let oldest = '';
  const older = d => {
    d = String(d || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (!oldest || d < oldest) oldest = d;
  };
  (PTG.ob || []).forEach(r => {
    if (!r || String(r.src || '') !== 'SHP') return;
    older(r.orderDate);
  });
  /* AND THE ORDERS THAT OWE A REPLACEMENT, which have no order-book row of their own until one is
   * raised. #2923 was placed on 28 July and carried an open adjustment; the reach stopped at 9
   * August, so the order was never seen and the adjustment was demanded again every run. */
  Object.keys(SHOP_META || {}).forEach(id => {
    const lines = (SHOP_META[id] || {}).lines || {};
    Object.keys(lines).forEach(k => {
      const ln = lines[k];
      if (ln && ln.adj && adjOpen(ln)) older(ln.adjOrderDate || ln.adjAt);
    });
  });
  if (!oldest) return '';
  const floor = sdShift(sdToday(), -SHP_REACH_MAX_DAYS);
  return oldest < floor ? floor : oldest;
}

async function ensureShop_() {
  if (!$('soFrom').value) {
    // The upper end is TOMORROW, not today. "Today" here is the marketplace's PT date, while the
    // Shopify store keeps its own — and an order placed this evening in the store's zone can
    // already be tomorrow by PT. Reaching a day further costs one page of orders and stops the
    // newest ones, which are the only ones anybody is waiting on, from falling off the end.
    $('soTo').value = sdShift(sdToday(), 1);
    /* AND THE LOWER END REACHES THE OLDEST UNFINISHED ORDER.
     *
     * It used to be a flat thirty days, on the reasoning that older orders have shipped. They have —
     * and that is exactly why their production rows needed judging, which only happens inside this
     * window. Six hundred of them sat open because the one thing that would have closed them was
     * never asked to look.
     *
     * So the window is not a guess any more: it starts where the unfinished work starts, and it
     * shrinks by itself as that work closes. */
    $('soFrom').value = shpOldestOpen() || sdShift(sdToday(), -30);
  }
  if (!Object.keys(SHOP_META).length) await loadShopMeta();
  if (!Object.keys(SHOP_SKU).length) await loadShopSku();
  if (!Object.keys(SHOP_STOCK).length) await loadShopStock();
  /* NOT AWAITED — and that is the point.
   *
   * India stock reads a 4,878-row workbook through Apps Script, which takes seconds. Waiting for it
   * before fetching the orders meant the tab sat empty with nothing happening, so people pressed
   * Fetch — the orders had not even been asked for yet. The orders ARE this tab; India stock and the
   * imported list are two columns on it.
   *
   * Each one re-renders when it lands, so the columns fill in a moment later rather than holding
   * everything else up. */
  /* India landing is one of the two moments the "has to be made" answer can change — before it,
   * every order reads as pending, which is exactly why the sync refuses to run until it is in. */
  loadShopIndia().then(() => { renderShop(); shpSyncSoon(); }).catch(() => {});
  loadShopImported().then(() => renderShop()).catch(() => {});
  // Re-fetched on the way back in, not only the first time. This is a queue of what has to ship
  // today: showing what Shopify said twenty minutes ago is the same as showing nothing.
  if (!SHOP.orders.length || Date.now() - SHOP_FETCHED_AT > SHOP_STALE_MS) await fetchShopOrders();
  else renderShop();
}

async function fetchShopOrders() {
  const btn = $('soGo');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>…';
  try {
    soMsg('Asking Shopify…');
    const win = { start: $('soFrom').value, end: $('soTo').value, open: $('soOpen').value };
    /* Two stores, asked at the same time. CPC's own failure must not cost us Ridhi's orders — this
     * screen is the shipping queue, and half of it is worth much more than none of it. */
    const [r, cpc] = await Promise.all([
      prGet({ shopify: 'orders', ...win }),
      prGet({ shopify: 'orders', shop: 'CPC', ...win }).catch(e => ({ _err: e.message || String(e) })),
    ]);
    const mine = (r.orders || []).map(o => Object.assign(o, { shopBrand: 'SP', channel: o.channel || 'Shopify' }));
    const theirs = (cpc.orders || []).map(o => Object.assign(o, { shopBrand: 'CPC', channel: 'CPC Shopify' }));
    SHOP = { orders: mine.concat(theirs), from: r.from, to: r.to, tz: r.tz || '', at: soStamp(),
      cpcErr: cpc._err || '' };
    // Stamped only on SUCCESS. A failed call that marked itself fresh would sit there for two
    // minutes showing nothing and claiming to be up to date.
    SHOP_FETCHED_AT = Date.now();
    soMsg([
      r.more || cpc.more ? `${SHOP.orders.length} orders — Shopify had more than one page could hold; narrow the dates to see the rest.` : '',
      cpc._err ? `CPC's orders could not be read: ${cpc._err}` : '',
    ].filter(Boolean).join(' · '), !!cpc._err);
  } catch (e) {
    soMsg('Could not reach Shopify: ' + (e.message || e), true);
  }
  btn.disabled = false; btn.textContent = 'Fetch orders';
  renderShop();
  // And after a fetch, which is the other moment. It does nothing until both stock maps are read.
  shpSyncSoon();
}

let SO_ALL_ROWS = [];      // every order mapped, before any filter — see the note below
let SO_ROWS_C = { sig: [], meta: '', rows: null };
function soRows() {
  soIndexNames();
  const q = $('soFilter').value.trim().toLowerCase();
  const mcfSel = soMcfPicked();
  /* FETCHED AND IMPORTED ORDERS ARE ONE LIST.
   *
   * Everything past this line — the columns, the MCF decision, the pick sheet, the export — treats
   * them the same, which is the whole point of importing them rather than keeping a second screen.
   * The only difference is where they came from, and that is a column, not a code path. */
  /* BUILT ONCE, FILTERED MANY TIMES (Ravi, 2026-09-27: "shopify wala order tab bahut lag ho rha h"). With two months
   * loaded (4,622 orders) every draw re-worked every order's stock, India and MCF verdict — 0.3 s in Node, a second
   * in the browser, on every search. The worked rows are kept until the orders, their notes, the stock, India or the
   * bins change; the search, the pickers and the sort only filter them. */
  const soSig = [SHOP.orders, SHOP.orders.length, SHOP.at, soImpLive(), SHOP_STOCK, SHOP_STOCK_LOADED, SHOP_INDIA, SHOP_INDIA_ERR, SHOP_SKU];
  const soMetaStr = JSON.stringify(SHOP_META) + '|' + JSON.stringify(SHOP_SKU);
  let rows;
  if (SO_ROWS_C.rows && SO_ROWS_C.sig.length === soSig.length && SO_ROWS_C.sig.every((x, i) => x === soSig[i]) && SO_ROWS_C.meta === soMetaStr) {
    rows = SO_ROWS_C.rows;
  } else {
  const ALL = SHOP.orders.concat(soImpLive());
  // Before a single verdict: one pile, shared out oldest-first. Doing this inside the map would put
  // every order in front of the full shelf again, which is the bug this replaces.
  soAllocIndia(ALL);
  rows = ALL.map(o => {
    const m = soMcf(o);
    const meta = SHOP_META[o.id] || {};
    const units = o.items.reduce((s, i) => s + i.qty, 0);
    // Ordered and SHIPPABLE are two different totals once a line is refunded, removed or set to 0.
    // FedEx has one commodity slot for the whole shipment, so it needs the second one.
    const shipUnits = o.items.reduce((s, i) => s + soShipQty(o.id, i), 0);
    const grams = o.items.reduce((s, i) => s + (i.grams || 0), 0);
    /* An MCF order ALREADY PLACED outranks anything the stock map has to say.
     *
     * soMcf() only ever answers "could Amazon fulfil this", so an order that has already been sent
     * kept showing "MCF ready" — an invitation to send it a second time, and a second real parcel
     * that cannot be cancelled from here. mcfId is set the moment Amazon accepts the order and is
     * saved with the rest of the meta, so it is the honest answer to "has this gone yet".
     *
     * Kept SEPARATE from the typed "MCF done" convention (flags.mcfDone, matched out of the notes).
     * That one is somebody's word; this one is Amazon's. */
    const sentId = meta.mcfId || '';
    const ind = soIndia(o);
    return {
      ...o, india: ind.v, indiaWhy: ind.why,
      mcf: sentId ? 'sent' : m.v, mcfSent: sentId,
      mcfWhy: sentId
        ? `Sent to Amazon as ${sentId}${Array.isArray(meta.mcfSkus) ? ' (' + meta.mcfSkus.length + ' of ' + o.items.filter(i => soLive(i) > 0).length + ' lines)' : ''}${meta.mcfAt ? ' on ' + meta.mcfAt : ''}`
          + `${meta.mcfSpeed ? ' (' + meta.mcfSpeed + ')' : ''}${meta.mcfStatus ? ' — ' + meta.mcfStatus : ''}`
        : m.why,
      units, shipUnits, kg: grams / 1000,
      // TWO different notes, and the spread above meant ours quietly replaced Shopify's. The
      // customer's instruction and our internal remark are not interchangeable — one changes what
      // goes in the box.
      shopNote: o.note || '',
      status: meta.s || '', note: meta.note || '', carrier: meta.carrier || '',
      skus: o.items.map(i => i.sku).filter(Boolean).join(' '),
      // Filled in below, once mcf/india/cancelled on this row are all settled.
      route: '',
      // 'Shopify' for anything fetched by API; the shop's name for anything imported.
      channel: o.channel || 'Shopify',
      // Sorting and filtering need one string; the cell still draws from the array, so an order
      // that shipped in three parcels keeps all three numbers.
      trk: o.trk || [], trkTxt: (o.trk || []).join(', '),
      // Every bin this order has to be picked from, deduped and in shelf order. One order that
      // spans A.1 and C.2 is a two-stop walk, and that is worth seeing before opening it.
      locTxt: [...new Set(o.items.map(i => soLocOf(i.sku)).filter(Boolean))].sort().join(', '),
      // Pieces this order is still waiting on from production, across all its lines.
      makeQty: Object.values(meta.lines || {}).reduce((s, l) => s + (Number(l && l.adjQty) || 0), 0),
      /* THE LINES PRODUCTION CANNOT BE ASKED FOR. Shopify allows a variant with no SKU; every
       * production row is keyed on one, so such a line can only be named and skipped. Carried here
       * by name so the row can say it, rather than reading "Need from production" and quietly
       * never opening. */
      /* Two lists, because they need different things done about them: one is a code the app
       * worked out from the title and somebody may want to check, the other is a line nobody can
       * order until the variant is given a SKU in Shopify. */
      ...(() => {
        const bare = (o.items || []).filter(i => {
          if (String((i && i.sku) || '').trim()) return false;
          let live = 0;
          try { live = Number(soLive(i)) || 0; } catch (e) { live = Number(i && i.qty) || 0; }
          return live > 0;
        });
        const named = i => String((i && i.name) || '').trim() || 'a line with no name';
        const found = [], lost = [];
        bare.forEach(i => {
          const m = shpSkuFromTitle(i && i.name, i && i.variant);
          if (m) found.push({ name: named(i) + (i.variant ? ' · ' + i.variant : ''), sku: String(m.sku) });
          else lost.push(named(i) + (i.variant ? ' · ' + i.variant : ''));
        });
        return { noSku: lost, titleSku: found };
      })(),
      ...soFlags(o, meta),
    };
  });
  /* Several states at once, OR'd. "Partly stocked OR not stocked" is one question, and asking it
   * used to mean looking twice and holding the answer in your head.
   *
   * The last two choices are not MCF states at all; they are the routing decision, and it takes both
   * columns to make. They live in this control because it is where somebody is already standing when
   * they ask "so where does this one ship from".
   *
   * An order ALREADY SENT to Amazon is excluded from both routing answers: it has shipped, and
   * putting it on a "ship from India" list would send a second parcel for goods already on their way.
   *
   * NOTHING TICKED MEANS ALL, so no caller has to special-case an empty filter. */
  /* WORKED OUT ON EVERY MAPPED ROW, BEFORE ANY FILTER, and the unfiltered set is kept — which is
   * what this has always said it does and, until now, did not.
   *
   * SO_ALL_ROWS is not only the pending count. shpPlanAll opens production orders from it, and the
   * Order Console's Shopify views read those production orders rather than the live feed. So a
   * filter left on this screen used to decide what production ever hears about: with "Shopify"
   * ticked in the shops picker, no CPC order could become a production order, and the Order Console
   * showed the team Ridhi and nothing else.
   *
   * Everything below narrows what is DRAWN. filter() returns a new array each time, so none of it
   * touches the set kept here. */
  rows.forEach(r => { r.route = soRoute(r); });
  SO_ROWS_C = { sig: soSig, meta: soMetaStr, rows };
  }
  SO_ALL_ROWS = rows;
  rows = rows.slice();          // the filters and the sort below work on a copy; the kept rows stay as built

  const chanSel = msVals('soChan');
  if (chanSel.length) rows = rows.filter(r => chanSel.includes(r.channel));

  /* WHICH DAY IT WAS PLACED, in the STORE's day — the same day every other figure on this tab is
   * counted in. Filters what is already loaded rather than re-fetching. */
  const daySel = $('soDay').value;
  if (daySel !== '') {
    const n = Number(daySel);
    if (n === -7) {
      const from = soStoreDay(-6);
      rows = rows.filter(r => r.at >= from);
    } else {
      const want = soStoreDay(n);
      rows = rows.filter(r => r.at === want);
    }
  }

  if (mcfSel.length) {
    // 'none' is out of BOTH routing answers. Nothing is owed on it, so it is neither a candidate
    // for India nor something production has to make — and it was landing in "Need from
    // production", which is the list people work from.
    const cannotMcf = r => r.mcf !== 'sent' && r.mcf !== 'yes' && r.mcf !== 'none';
    rows = rows.filter(r => mcfSel.some(v =>
      v === 'fromIndia' ? (cannotMcf(r) && r.india === 'yes')
      : v === 'needProd' ? (cannotMcf(r) && r.india !== 'yes')
      : r.mcf === v));
  }
  // The state filter. "Live" is the working queue — what is still actually owed to somebody — so it
  // drops all three of the states that mean "stop looking at this one".
  const stSel = $('soState').value;
  if (stSel === 'live') rows = rows.filter(r => !r.cancelled && !r.chargeback && !r.mcfDone && !r.handled);
  else if (stSel === 'handled') rows = rows.filter(r => r.handled);
  else if (stSel === 'cancel') rows = rows.filter(r => r.cancelled);
  else if (stSel === 'cb') rows = rows.filter(r => r.chargeback);
  else if (stSel === 'mcfdone') rows = rows.filter(r => r.mcfDone);

  /* "NOT YET SHIPPED" MEANS STILL OWED, NOT MERELY UNFULFILLED ON SHOPIFY (Ravi, 2026-09-03).
   *
   * The backend always asks Shopify for status=any and this picker only drops the FULFILLED ones —
   * so two kinds of finished order kept sitting in the working queue:
   *
   *   CANCELLED — never shipping at all.
   *   MCF DONE  — already handed to Amazon. Shopify still reads "Not shipped" until the tracking
   *               number comes back hours later, but there is nothing left for anybody to do.
   *
   * Both are dropped, UNLESS the state picker is asking for that very thing — then it is not a queue
   * any more, it is a deliberate look, and hiding what was just asked for is the worse surprise. */
  if ($('soOpen').value === '1') {
    if (stSel !== 'cancel') rows = rows.filter(r => !r.cancelled);
    if (stSel !== 'mcfdone') rows = rows.filter(r => !r.mcfDone);
  }
  if (q) rows = rows.filter(r =>
    (r.no + ' ' + r.skus + ' ' + (r.ship.name || '') + ' ' + (r.ship.country || '')
      + ' ' + r.shopNote + ' ' + r.note + ' ' + r.status + ' ' + r.trkTxt
      + ' ' + r.items.map(i => i.name).join(' ')).toLowerCase().includes(q));

  const k = SHOP_SORT.k, dir = SHOP_SORT.dir;
  rows.sort((a, b) => (typeof a[k] === 'string')
    ? String(a[k] || '').localeCompare(String(b[k] || '')) * dir
    : ((a[k] == null ? -Infinity : a[k]) - (b[k] == null ? -Infinity : b[k])) * dir);
  return rows;
}

let SO_DENSE_CAP = 200;
const soDense = () => { try { return localStorage.getItem('soDense') !== '0'; } catch (e) { return true; } };
/**
 * THE ONE-PAGE TABLE. Ten columns, each carrying what the wide table spread over two: the date under the order, the
 * country under the name, the weight under the value, MCF and India under Ship from, the tracking under Shopify's
 * word, the carrier under the status. Items wrap. Every cell is the same helper the wide table uses, so the two can
 * never say different things. Sorting goes by the column's first figure.
 */
/** Tag html → its word, in its colour, without the pill — for the quiet second line. */
const soWord = html => {
  const t = String(html || '').replace(/<[^>]+>/g, '').trim();
  if (!t) return '';
  const c = /st-approved/.test(html) ? 'var(--accent,#166534)' : /st-pending/.test(html) ? 'var(--warn-ink,#7f6000)' : /st-rejected/.test(html) ? 'var(--bad,#b91c1c)' : 'var(--muted)';
  return '<b style="color:' + c + ';font-weight:600">' + t + '</b>';
};
/**
 * THE SHIP-FROM CELL, CALM (Ravi, 2026-09-26: "data looking too messy"). ONE pill — what to do with the order — and
 * one plain line under it with the two stock facts, each only where it adds something: MCF is not repeated under
 * "MCF ready", India not under "Ship from India". Production's own word, when there is one, is the pill.
 */
function soShipFrom(r, esc) {
  const p = soProdStatus(r);
  const inBucket = !p && SO_IN_BUCKET.has(String(r && r.id));
  const route = r.route || '';
  const pill = p ? `<span class="st ${p.tone === 'done' ? 'st-approved' : 'st-pending'}" title="From the Order Console">${esc(p.txt)}</span>`
    : route === 'Need from production' ? `<span class="st st-rejected"${inBucket ? ' title="In the production bucket — open it from there"' : ''}>${inBucket ? 'Needs production · in bucket' : 'Needs production'}</span>`
    : route === 'Ship from India' ? '<span class="st st-pending">Ship from India</span>'
    : /MCF done/i.test(route) ? '<span class="st st-approved" style="font-weight:700">MCF done</span>'
    : /MCF ready/i.test(route) ? '<span class="st st-approved">MCF ready</span>'
    : `<span class="muted">${esc(route || '—')}</span>`;
  const bits = [];
  if (!/MCF/i.test(route)) { const w = soWord(soMcfTag(r.mcf)); if (w) bits.push('MCF ' + w); }
  if (route !== 'Ship from India') { const w = soWord(SO_INDIA_TAG[r.india] || SO_MCF_TAG[r.india]); if (w) bits.push('India ' + w); }
  const warn = (r.noSku || []).length ? `<span class="sub" style="color:var(--bad);font-weight:700">${nf(r.noSku.length)} line(s) have no SKU — cannot open</span>`
    : (r.titleSku || []).length ? `<span class="sub" style="color:var(--warn-ink)" title="${esc(r.titleSku.map(x => x.name + ' → ' + x.sku).join(' · '))}">SKU from the title: ${esc(r.titleSku.map(x => x.sku).join(', '))}</span>` : '';
  return pill + (bits.length ? `<span class="sub">${bits.join(' · ')}</span>` : '') + warn;
}
function renderShopDense(rows, COLS, arrow, money, esc) {
  const T = k => (COLS.find(c => c.k === k) || {}).tip || '';
  const DC = [
    { k: 'pick' }, { k: 'no', t: 'Order', frz: 1 }, { k: 'name', t: 'Ship to' }, { k: 'total', t: 'Value', num: 1 },
    { k: 'locTxt', t: 'Pick · make', tip: (T('locTxt') + ' Below it: pieces waiting on production.').trim() },
    { k: 'route', t: 'Ship from', tip: T('route') + ' MCF and India stock under it.' },
    { k: 'ff', t: 'Shopify', tip: T('ff') + ' Tracking under it.' }, { k: 'status', t: 'Status', tip: 'Your own status; the carrier under it.' },
    { k: 'channel', t: 'Shop', tip: T('channel') }, { k: 'items', t: 'Items' },
  ];
  const head = '<thead><tr>' + DC.map(c => c.k === 'pick'
      ? '<th style="width:28px"><input type="checkbox" id="soAll" title="Tick every order on screen"></th>'
      : '<th class="' + (c.num ? 'num' : '') + (c.frz ? ' frz' : '') + '" data-so-sort="' + c.k + '" style="cursor:pointer"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + c.t + arrow(c.k) + '</th>').join('') + '</tr></thead>';
  const sub = t => (t ? '<span class="sub">' + t + '</span>' : '');
  /* 200, and the rest by search or "Show more" — 400 rows of three lines each was 550 KB of table to lay out on every
   * draw, and nobody reads past the first screens without searching. */
  const SO_DRAW_CAP = SO_DENSE_CAP;
  const drawn = rows.slice(0, SO_DRAW_CAP);
  const body = drawn.map(r => '<tr data-so="' + esc(r.id) + '" style="cursor:pointer"'
    + ' class="' + [r.cancelled ? 'so-cancel' : '', r.chargeback ? 'so-cb' : ''].filter(Boolean).join(' ') + '"'
    + (r.cancelled ? ' title="Cancelled ' + esc(r.cancelledAt) + (r.cancelReason ? ' — ' + esc(r.cancelReason) : '') + '"' : '') + '>'
    + '<td><input type="checkbox" class="soPick" data-id="' + esc(r.id) + '"' + (SO_PICKED.has(r.id) ? ' checked' : '') + '></td>'
    + '<td class="frz tl" style="font-weight:600">' + esc(r.no) + (r.shopNote ? ' <span title="Shopify note: ' + esc(r.shopNote) + '" style="color:#854d0e">&#9998;</span>' : '') + sub(esc(r.at)) + '</td>'
    + '<td class="tl" title="' + esc([r.ship.a1, r.ship.a2, r.ship.city, r.ship.state, r.ship.zip].filter(Boolean).join(', ')) + '">' + esc(String(r.ship.name || '').slice(0, 24))
      + sub(esc([r.ship.state, r.ship.country].filter(Boolean).join(', ')) + (r.units ? ' · ' + r.units + ' unit' + (r.units > 1 ? 's' : '') : '')) + '</td>'
    + '<td class="num">' + money(r.total) + sub(r.kg ? r.kg.toFixed(2) + ' kg' : '') + '</td>'
    + '<td style="font-weight:600" title="' + esc(r.items.map(i => `${i.sku || i.name}: ${soLocOf(i.sku) || 'no bin set'}`).join(' · ')) + '">'
      + (r.locTxt ? esc(r.locTxt) : '<span class="muted">—</span>') + (r.makeQty ? sub('<span class="st st-pending">' + r.makeQty + ' to make</span>') : '') + '</td>'
    + '<td class="tl" title="' + esc(r.mcfWhy + (r.indiaWhy ? ' · ' + r.indiaWhy : '')) + '">' + soShipFrom(r, esc) + '</td>'
    + '<td class="tl"' + (r.shippedAt ? ' title="shipped ' + esc(r.shippedAt) + '"' : '') + '>' + soFfTag(r.ff)
      + '<span class="sub" style="max-width:170px;overflow:hidden;text-overflow:ellipsis">' + soTrkCell(r, esc) + '</span></td>'
    + '<td class="so-keep tl">'
      + (r.cancelled ? '<span class="st st-rejected" title="Cancelled in Shopify' + (r.cancelReason ? ': ' + esc(r.cancelReason) : '') + '">Cancelled</span> ' : '')
      + (r.chargeback ? '<span class="st st-rejected" title="' + esc(r.cbWhy) + '">Chargeback</span> ' : '')
      + (r.mcfDone ? '<span class="st st-approved" title="“MCF done” is written on this order.">Done</span> ' : '')
      + (r.status ? esc(r.status) : (r.cancelled || r.chargeback || r.mcfDone ? '' : '<span class="muted">—</span>'))
      + sub([r.carrier ? esc(r.carrier) : '', r.note ? esc(String(r.note).slice(0, 24)) : ''].filter(Boolean).join(' · ')) + '</td>'
    + '<td>' + (r.channel === 'Shopify' ? '<span class="muted">Shopify</span>' : '<span class="st st-draft">' + esc(r.channel) + '</span>') + '</td>'
    + '<td class="wrap" title="' + esc(r.items.map(i => `${i.sku || i.name} × ${i.qty}`).join(' · ')) + '">'
      + esc(r.items.slice(0, 4).map(i => `${i.sku || i.name} × ${i.qty}`).join(' · ')) + (r.items.length > 4 ? ' <span class="muted">+' + (r.items.length - 4) + ' more</span>' : '') + '</td>'
    + '</tr>').join('');
  const more = rows.length > drawn.length
    ? `<tr><td colspan="${DC.length}" style="padding:10px 14px;text-align:left"><span class="muted">Showing ${nf(drawn.length)} of ${nf(rows.length)} — search, or </span><button type="button" class="ghost" id="soMore" style="padding:4px 12px;font-size:12px">show ${nf(Math.min(200, rows.length - drawn.length))} more</button></td></tr>` : '';
  $('soTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="' + DC.length + '" class="muted" style="padding:14px">Nothing matches that filter.</td></tr>') + more + '</tbody>';
  if ($('soMore')) $('soMore').onclick = e => { e.stopPropagation(); SO_DENSE_CAP += 200; renderShop(); };
  if ($('soAll')) $('soAll').checked = drawn.length > 0 && drawn.every(r => SO_PICKED.has(r.id));
}
if ($('soDense')) $('soDense').onclick = () => { try { localStorage.setItem('soDense', soDense() ? '0' : '1'); } catch (e) { /* not remembered */ } renderShop(); };

function renderShop() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const rows = soRows();
  // Before the empty-list bail-out below, so the strip clears itself instead of keeping the previous
  // fetch's numbers on screen next to "no orders loaded".
  renderShopToday();

  /* Counted over BOTH sources. This used to test the fetched list alone, so a shop whose orders are
   * imported showed "no orders loaded" and made somebody press Fetch — which does nothing for a
   * channel that has no API key in the first place. */
  if (!SHOP.orders.length && !soImpLive().length) {
    $('soTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">'
      + 'No orders yet — pick a date range and hit “Fetch orders”, or bring some in with Import orders.</td></tr></tbody>';
    return;
  }

  const n = v => rows.filter(r => r.mcf === v).length;
  // Counted over EVERY loaded order, not the filtered rows — otherwise picking "Live only" would
  // report zero cancellations and read as "there are none".
  const all = SHOP.orders.concat(soImpLive()).map(o => soFlags(o, SHOP_META[o.id] || {}));
  const nAll = f => all.filter(x => x[f]).length;
  // SHOP.from/to are what the BACKEND says it used, echoed back — not what is typed in the boxes.
  // When they disagree, the boxes were changed and Fetch was never pressed, and the list on screen
  // is answering a question nobody is asking any more. Saying so beats letting somebody conclude
  // the date range is broken.
  const stale = ($('soFrom').value && $('soFrom').value !== SHOP.from)
    || ($('soTo').value && $('soTo').value !== SHOP.to);
  // The denominator has to be BOTH sources, or a screen full of imported orders reports "12 of 0".
  /* Over every loaded order, and split by day, because "still pending from yesterday" is the
   * question somebody actually walks in with. */
  const pend = SO_ALL_ROWS.filter(soIsPending);
  /* THE BUCKET'S COUNT ON ITS BUTTON (2026-09-26). */
  /* ONLY THE ORDERS WAITING ON PRODUCTION are looked at here — the stock-covered half of the bucket is worked out when
   * the bucket is opened, not on every draw of this tab (Ravi, 2026-09-26: "ye lagg ho rha h"). */
  const bucketMake = shpBucketMake();
  const inBucket = new Set(bucketMake.map(x => x.id));
  if ($('soBucket')) { const rd = typeof shpReadyLines === 'function' ? shpReadyLines().length : 0;
    $('soBucket').textContent = 'Production bucket' + (bucketMake.length ? ` (${nf(bucketMake.length)})` : '') + (rd ? ` · ${nf(rd)} ready to take` : ''); }
  SO_IN_BUCKET = inBucket;
  const y = soStoreDay(-1), t = soStoreDay(0);
  const yd = pend.filter(r => r.at === y).length, td = pend.filter(r => r.at === t).length;
  /* WHAT IS TRUE ON EVERY VISIT IS NOT NEWS. The window, the breakdown and the fetch time are here
   * for whoever wants them, and out of the way of everybody else. soMsg writes with textContent,
   * so this is plain text — a tag written here would print as a tag. */
  $('soMsg').title = [
    `${rows.length} of ${SHOP.orders.length + soImpLive().length} order(s) shown`
      + (rows.length > 400 ? ' · only the first 400 are drawn; Print and Export still use all of them' : ''),
    soImpLive().length ? `${nf(soImpLive().length)} imported` : '',
    `${SHOP.from} → ${SHOP.to}`,
    pend.length ? `${pend.length} waiting on production — neither Amazon nor India can fill them`
      + (yd ? ` · ${yd} from yesterday` : '') + (td ? ` · ${td} from today` : '') : '',
    n('sent') ? `${n('sent')} already sent to Amazon` : '',
    `${n('yes')} MCF ready, ${n('part')} partly, ${n('no')} not stocked`
      + (n('unknown') ? `, ${n('unknown')} with SKUs Amazon has never seen` : ''),
    nAll('cancelled') ? `${nAll('cancelled')} cancelled`
      + ($('soOpen').value === '1' && $('soState').value !== 'cancel' ? ' (hidden — pick "Cancelled" in the state box)' : '') : '',
    nAll('chargeback') ? `${nAll('chargeback')} chargeback` : '',
    nAll('mcfDone') ? `${nAll('mcfDone')} MCF done`
      + ($('soOpen').value === '1' && $('soState').value !== 'mcfdone' ? ' (hidden — already with Amazon; pick "MCF done" in the state box)' : '') : '',
    SHOP.at ? `fetched ${SHOP.at}` : '',
  ].filter(Boolean).join(' · ');
  /* On screen: how many, how many are waiting on production, and — only when it is about to
   * mislead somebody — that the date boxes no longer match what is drawn. */
  soMsg(`${nf(rows.length)} of ${nf(SHOP.orders.length + soImpLive().length)} orders`
    + (pend.length ? ` · ${nf(pend.length)} waiting on production` : '')
    + (stale ? ` — the boxes now say ${$('soFrom').value} → ${$('soTo').value}; press Fetch orders` : '')
    + (SHOP_STOCK_DENIED ? ' · ' + SHOP_STOCK_DENIED_TXT : ''),
    stale || SHOP_STOCK_DENIED);

  const COLS = [
    { k: 'pick', t: '', noSort: 1 },
    { k: 'no', t: 'Order', frz: 1 },
    { k: 'at', t: 'Date' },
    { k: 'name', t: 'Ship to' },
    { k: 'country', t: 'Country' },
    { k: 'units', t: 'Units', num: 1 },
    { k: 'kg', t: 'Weight kg', num: 1 },
    { k: 'total', t: 'Order value', num: 1 },
    { k: 'locTxt', t: 'Location', tip: 'Which shelf bins this order has to be picked from. Set it against the SKU inside the order — it then fills itself on every future order carrying that SKU.' },
    { k: 'makeQty', t: 'To make', num: 1, tip: 'Pieces this order is short and waiting on from production. Raised inside the order; printed from the Adjustments button.' },
    /* THE ORDER HERE MUST MATCH THE ORDER THE CELLS ARE WRITTEN IN, BELOW.
     *
     * It did not. The body wrote mcf · india · channel · route, this list said mcf · channel ·
     * route · india, and nothing anywhere compares the two — so every header from MCF onward sat
     * over the wrong column. On screen that made India's verdict appear under "Shop", the shop name
     * under "Ship from", and the route under "India"; clicking a header sorted by a different
     * column than the one you were pointing at. Found 2026-08-25 from an order reading "SKU ?" and
     * "MCF ready" side by side. Change one of these two lists and you must change the other. */
    { k: 'mcf', t: 'MCF', tip: 'Whether Amazon FBA holds enough stock for every line. Hover a cell for the per-SKU numbers.' },
    { k: 'india', t: 'India', tip: 'Whether the India warehouse holds enough for every line — read live from the Ready Goods workbook, in SELLABLE units (pieces ÷ pack), because that is what an order line is counted in. Hover a cell for the per-SKU numbers.' },
    { k: 'channel', t: 'Shop', tip: 'Which shop the order came from. "Shopify" is fetched live; the rest are imported, because this app has no API key for them.' },
    { k: 'route', t: 'Ship from', tip: 'One answer instead of two columns: MCF done · MCF ready · Ship from India · Need from production. "Need from production" means neither Amazon nor India can fill it — those are the pending ones.' },
    /* The Production column went with the production view — it was written by the other app,
       which is being switched off. Its cell below went in the same change: a header with no cell
       puts every column after it over the wrong data. */
    { k: 'ff', t: 'Shopify', tip: 'What Shopify itself says has shipped — separate from your own status below.' },
    { k: 'trkTxt', t: 'Tracking', tip: 'Every tracking number on the order, across all its parcels.' },
    { k: 'status', t: 'Status' },
    { k: 'carrier', t: 'Ship via' },
    { k: 'items', t: 'Items' },
  ];
  const arrow = k => (SHOP_SORT.k === k ? (SHOP_SORT.dir > 0 ? ' ↑' : ' ↓') : '');
  /* ONE PAGE OR EVERY COLUMN (Ravi, 2026-09-26: "this window looks very long — isko only 1 page par set karo").
   * The tight table is the default; the wide one is a click away and remembered per browser. */
  const dense = soDense();
  if ($('soTable')) $('soTable').classList.toggle('xl-dense', dense);
  if ($('soDense')) $('soDense').textContent = dense ? 'Full columns' : 'One page';
  /* The one-page table is wired exactly like the wide one — it used to return before the wiring, so clicking an
   * order opened nothing, the headings did not sort and a tick was never counted (Ravi, 2026-09-28). */
  if (dense) { renderShopDense(rows, COLS, arrow, money, esc); soWireTable(); return; }
  const head = '<thead><tr>' + COLS.map(c =>
    c.noSort
      ? '<th style="width:28px"><input type="checkbox" id="soAll" title="Tick every order on screen"></th>'
      : '<th class="' + (c.num ? 'num' : '') + (c.frz ? ' frz' : '') + '" data-so-sort="' + c.k + '"'
        + ' style="cursor:pointer"' + (c.tip ? ' title="' + c.tip + '"' : '')
        + '>' + c.t + arrow(c.k) + '</th>').join('') + '</tr></thead>';

  /* HOW MANY ROWS ARE WORTH DRAWING. Beyond this the browser is doing work for a screen nobody
   * scrolls to, and the tab stops answering. Everything else still counts every order. */
  const SO_DRAW_CAP = 400;
  const drawn = rows.slice(0, SO_DRAW_CAP);
  const body = drawn.map(r => '<tr data-so="' + esc(r.id) + '" style="cursor:pointer"'
    + ' class="' + [r.cancelled ? 'so-cancel' : '', r.chargeback ? 'so-cb' : ''].filter(Boolean).join(' ') + '"'
    + (r.cancelled ? ' title="Cancelled ' + esc(r.cancelledAt) + (r.cancelReason ? ' — ' + esc(r.cancelReason) : '') + '"' : '')
    + '>'
    // The tick lives in its own cell and swallows the click, so ticking an order does not also open it.
    + '<td><input type="checkbox" class="soPick" data-id="' + esc(r.id) + '"'
      + (SO_PICKED.has(r.id) ? ' checked' : '') + '></td>'
    // A Shopify note is flagged on the row itself, not left to be discovered by opening the order.
    + '<td class="frz" style="font-weight:600">' + esc(r.no)
      + (r.shopNote ? ' <span title="Shopify note: ' + esc(r.shopNote) + '" style="color:#854d0e">&#9998;</span>' : '')
    + '</td>'
    + '<td>' + esc(r.at) + '</td>'
    + '<td title="' + esc([r.ship.a1, r.ship.a2, r.ship.city, r.ship.state, r.ship.zip].filter(Boolean).join(', ')) + '">'
      + esc(String(r.ship.name || '').slice(0, 22)) + '</td>'
    + '<td>' + esc(r.ship.country) + '</td>'
    + '<td class="num">' + r.units + '</td>'
    + '<td class="num">' + (r.kg ? r.kg.toFixed(2) : '<span class="muted">—</span>') + '</td>'
    + '<td class="num">' + money(r.total) + '</td>'
    + '<td style="font-weight:600;white-space:nowrap"'
      + ' title="' + esc(r.items.map(i => `${i.sku || i.name}: ${soLocOf(i.sku) || 'no bin set'}`).join(' · ')) + '">'
      + (r.locTxt ? esc(r.locTxt) : '<span class="muted">—</span>') + '</td>'
    + '<td class="num">' + (r.makeQty
        ? '<span class="st st-pending">' + r.makeQty + '</span>' : '<span class="muted">—</span>') + '</td>'
    + '<td title="' + esc(r.mcfWhy) + '">' + soMcfTag(r.mcf) + '</td>'
    + '<td title="' + esc(r.indiaWhy) + '">' + (SO_INDIA_TAG[r.india] || SO_MCF_TAG[r.india]) + '</td>'
    + '<td>' + (r.channel === 'Shopify' ? '<span class="muted">Shopify</span>'
        : '<span class="st st-draft">' + esc(r.channel) + '</span>') + '</td>'
    + '<td>' + soProdChip(r) + (r.route === 'Need from production'
        ? '<span class="st st-rejected">' + esc(r.route) + '</span>'
          /* Named on the row, because this is the one case where "Need from production" will never
           * become a production order until somebody goes into Shopify and fixes the variant. */
          + ((r.noSku || []).length
            ? '<div style="font-size:10.5px;font-weight:700;color:var(--bad);white-space:normal;max-width:170px" title="'
              + esc((r.noSku || []).join(' · ') + ' — a production row is keyed on the SKU. The title did not match one product in the master database either, so this line cannot be ordered until the variant is given a SKU in Shopify.')
              + '">' + nf((r.noSku || []).length) + ' line(s) have no SKU — cannot open</div>'
            : '')
          /* Found by its title rather than sent by Shopify — said out loud, with the code, because
           * it is worth a glance the first time a product is sold without one. */
          + ((r.titleSku || []).length
            ? '<div style="font-size:10.5px;font-weight:700;color:var(--warn-ink);white-space:normal;max-width:170px" title="'
              + esc((r.titleSku || []).map(x => x.name + ' → ' + x.sku).join(' · ')
                + ' — the Shopify variant carries no SKU, so the code was worked out from the title: its colour and size matched one product in the master database.')
              + '">SKU from the title: ' + esc((r.titleSku || []).map(x => x.sku).join(', ')) + '</div>'
            : '')
        : r.route === 'Ship from India'
          ? '<span class="st st-pending">' + esc(r.route) + '</span>'
          : '<span class="muted">' + esc(r.route) + '</span>') + '</td>'
    + '<td' + (r.shippedAt ? ' title="shipped ' + esc(r.shippedAt) + '"' : '') + '>' + soFfTag(r.ff) + '</td>'
    + '<td style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + soTrkCell(r, esc) + '</td>'
    // Every state that is drawn on the row also says its name here — the strike and the red tint are
    // the second signal, never the only one.
    + '<td class="so-keep">'
      + (r.cancelled ? '<span class="st st-rejected" title="Cancelled in Shopify'
          + (r.cancelReason ? ': ' + esc(r.cancelReason) : '') + '">Cancelled</span> ' : '')
      + (r.chargeback ? '<span class="st st-rejected" title="' + esc(r.cbWhy) + '">Chargeback</span> ' : '')
      + (r.mcfDone ? '<span class="st st-approved" title="“MCF done” is written on this order.">Done</span> ' : '')
      + (r.status ? esc(r.status) : (r.cancelled || r.chargeback || r.mcfDone ? '' : '<span class="muted">—</span>'))
      + (r.note ? '<div class="muted" style="font-size:10.5px">' + esc(String(r.note).slice(0, 24)) + '</div>' : '') + '</td>'
    + '<td>' + (r.carrier ? esc(r.carrier) : '<span class="muted">—</span>') + '</td>'
    + '<td title="' + esc(r.items.map(i => `${i.sku || i.name} × ${i.qty}`).join(' · ')) + '"'
      + ' style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + esc(r.items.map(i => `${i.sku || i.name} × ${i.qty}`).join(' · ')) + '</td>'
    + '</tr>').join('');

  $('soTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="' + COLS.length + '" class="muted" style="padding:14px">Nothing matches that filter.</td></tr>')
    + '</tbody>';
  soWireTable();
}

/** Sort headings, a click on an order opens it, the ticks — for whichever table is on screen. */
function soWireTable() {
  $('soTable').querySelectorAll('[data-so-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.soSort;
    const text = !['units', 'kg', 'total', 'makeQty'].includes(k);
    SHOP_SORT = { k, dir: SHOP_SORT.k === k ? -SHOP_SORT.dir : (text ? 1 : -1) };
    renderShop();
  });
  $('soTable').querySelectorAll('[data-so]').forEach(tr => tr.onclick = () => openShopOrder(tr.dataset.so));
  // Bound AFTER the row handler and stopping propagation, or every tick would also open the order.
  $('soTable').querySelectorAll('.soPick').forEach(cb => {
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => {
      cb.checked ? SO_PICKED.add(cb.dataset.id) : SO_PICKED.delete(cb.dataset.id);
      soPickedMsg();
    };
  });
  const allBox = $('soAll');
  if (allBox) {
    allBox.onclick = e => e.stopPropagation();
    allBox.onchange = () => {
      $('soTable').querySelectorAll('.soPick').forEach(cb => {
        cb.checked = allBox.checked;
        allBox.checked ? SO_PICKED.add(cb.dataset.id) : SO_PICKED.delete(cb.dataset.id);
      });
      soPickedMsg();
    };
  }
  soPickedMsg();
}

/* Which orders are ticked. Kept as ids rather than rows, so a tick survives a re-render — sorting or
 * filtering must not quietly drop something somebody had already chosen to print. */
let SO_PICKED = new Set();
function soPickedMsg() {
  const el = $('soPickMsg');
  if (!el) return;
  // Counted against what is ON SCREEN. A tick on an order that has since been filtered away is still
  // held, but saying "12 ticked" while showing three of them would be a lie about what Print will do.
  const shown = [...$('soTable').querySelectorAll('.soPick')].filter(cb => cb.checked).length;
  el.title = 'Print and Export use what is ticked; with nothing ticked they use everything shown.';
  el.textContent = SO_PICKED.size
    ? `${shown} ticked${SO_PICKED.size !== shown ? ` on screen (${SO_PICKED.size} in total, the rest are filtered out)` : ''}`
    : '';
}

/* Today and yesterday, side by side. Not filtered by anything in the toolbar — "how are we doing
 * today" is a question about the shop, not about the rows somebody has narrowed to. */
function renderShopToday() {
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const today = soStoreDay(0), yday = soStoreDay(-1);
  const who = soShopLabel();
  const box = (label, iso, s) => `<div>`
    + `<div class="muted" style="font-size:11px">${label} · ${iso}${who ? ' · ' + esc(who) : ''}</div>`
    + `<div style="font-weight:700">${s.orders} order${s.orders === 1 ? '' : 's'}`
    + ` · ${s.units} unit${s.units === 1 ? '' : 's'} · ${money(s.value)}</div>`
    + (s.cancelled ? `<div class="muted" style="font-size:11px">${s.cancelled} cancelled, not counted</div>` : '')
    + `</div>`;
  // The window is the user's choice and can easily not reach today — saying so beats showing a
  // truthful zero that reads as "no sales today".
  const covers = d => (!SHOP.from || d >= SHOP.from) && (!SHOP.to || d <= SHOP.to);
  $('soToday').innerHTML = box('Today', today, soDayStats(today))
    + box('Yesterday', yday, soDayStats(yday))
    + (SHOP.tz ? '' : '<div class="muted" style="font-size:11px;align-self:center">'
        + 'Store timezone unknown — these two days are counted in PT and may be a day out. '
        + 'Press Fetch orders to pick it up.</div>')
    + (covers(today) && covers(yday) ? '' : '<div style="color:var(--warn);font-size:11.5px;align-self:center">'
        + 'The date range does not cover both days — widen it before reading these.</div>');
}

/* ---------- staged quantity, and what is short ----------
 *
 * Per ORDER LINE, unlike the shelf bin above. "One of the two is on the shelf" is a fact about this
 * order on this day; the bin is a fact about the product. Mixing the two would either wipe the
 * count every time the SKU sold again, or carry a stale count onto the next order.
 *
 * Every change is logged with the date and time rather than overwritten, because the question that
 * gets asked later is never "how many are there" — it is "when did that change, and who by".
 */
function soLine(orderId, sku) {
  const meta = SHOP_META[orderId] || {};
  return ((meta.lines || {})[sku]) || {};
}
function soLogText(ln) {
  const log = (ln && ln.log) || [];
  if (!log.length) return 'Nothing recorded yet.';
  return log.slice(-8).map(e => `${e.at} — ${e.q} pc${e.q === 1 ? '' : 's'}${e.by ? ' · ' + e.by : ''}`).join('\n');
}

/**
 * The adjustment id, built from the Shopify order number and the SKU.
 *
 * Derived, never generated: the same line always produces the same id, so re-entering a quantity
 * cannot raise a second production order for work already sent. It reads back to the Shopify order
 * without a lookup, which is the whole point of putting it on a printed sheet.
 */
function soAdjId(orderNo, sku) {
  return 'ADJ-' + String(orderNo || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase()
    + '-' + String(sku || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
}

/**
 * Copy onto the adjustment everything it needs to stand on its own.
 *
 * The Adjustments tab has to list a job raised six weeks ago without re-fetching that order from
 * Shopify — the window it lives in has long since scrolled past, and a job waiting on production is
 * exactly the one nobody is looking at any more. So the product name, the order number, the
 * customer and the picture are COPIED at the moment it is raised, not looked up later.
 */
function soAdjSnapshot(ln, o, item) {
  if (o) {
    ln.adjOrder = o.no;
    ln.adjOrderDate = o.at;
    ln.adjCustomer = (o.ship && o.ship.name) || '';
    ln.adjOrderId = o.id;
  }
  if (item) {
    ln.adjName = item.name || '';
    ln.adjOrdered = item.qty;
    if (!ln.adjImg && item.img) ln.adjImg = item.img;
  }
  ln.adjStaged = ln.q == null ? null : ln.q;
  ln.adjLoc = soLocOf(item && item.sku) || '';
  if (!ln.adjState) ln.adjState = 'raised';
}
function soAdjHtml(ln, item, esc) {
  const sku = String(item.sku || '').trim().toUpperCase();
  const btn = '<button class="ghost" data-adj="' + esc(sku) + '" style="padding:2px 8px;font-size:11px;margin-top:3px">'
    + (ln.adj ? 'Edit' : '+ Adjust') + '</button>';
  // A SHORT LINE AND A WRONG ONE ARE DIFFERENT PROBLEMS. The quantity can be complete — one ordered,
  // one in hand — and still be the wrong size, which is the case that has to go to production. So
  // the button is always there, not only when something is missing.
  if (!ln.adj) {
    const state = ln.q == null
      ? '<span class="muted" style="font-size:11.5px">enter a quantity</span>'
      : (Number(item.qty) - Number(ln.q) > 0
          ? '<span class="st st-pending">' + (item.qty - ln.q) + ' short</span>'
          : '<span class="st st-approved">complete</span>');
    return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' + state + btn.replace('margin-top:3px', 'margin-top:0') + '</div>';
  }
  return '<span class="st st-pending">' + (ln.adjQty || 0) + ' to make</span>'
    + (ln.adjReason ? ' <span class="muted" style="font-size:10.5px">' + esc(ln.adjReason) + '</span>' : '')
    + (ln.adjSend || ln.adjWant
        ? '<div style="font-size:10.5px;margin-top:2px">' + esc(ln.adjSend || '?') + ' &rarr; <b>' + esc(ln.adjWant || '?') + '</b></div>'
        : '')
    + '<div style="font-family:ui-monospace,monospace;font-size:10px;margin-top:2px">' + esc(ln.adj) + '</div>'
    + (ln.adjAt ? '<div class="muted" style="font-size:10px">' + esc(ln.adjAt) + '</div>' : '')
    + '<div>' + btn + '</div>';
}

/**
 * The customs line for every SKU on the order.
 *
 * One row per SKU, not per line item: two lines of the same SKU are one commodity to a customs
 * officer, and giving them two HS codes to disagree over helps nobody.
 *
 * Rates are held in the SKU record and shown in the order's chosen currency. Nothing is converted —
 * there is no exchange rate in this app, and inventing one would put a number on a customs
 * declaration that nobody could defend.
 */
function soRenderCustoms() {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const cur = $('soCur').value;
  const byS = new Map();
  o.items.forEach(i => {
    const k = String(i.sku || '').trim().toUpperCase();
    if (!k) return;
    if (!byS.has(k)) byS.set(k, { sku: k, name: i.name || '', qty: 0 });
    byS.get(k).qty += Number(i.qty) || 0;
  });
  const rows = [...byS.values()];
  let goods = 0, tax = 0;
  const body = rows.map(r => {
    const s = soSku(r.sku);
    const rate = Number(s.rate);
    const line = rate > 0 ? rate * r.qty : 0;
    const gst = Number(s.gst);
    goods += line;
    if (gst > 0) tax += line * gst / 100;
    return '<tr>'
      + '<td style="font-family:ui-monospace,monospace">' + esc(r.sku) + '</td>'
      + '<td title="' + esc(r.name) + '">' + esc(String(r.name).slice(0, 26)) + '</td>'
      + '<td class="num">' + r.qty + '</td>'
      + '<td><input class="soHs" data-sku="' + esc(r.sku) + '" maxlength="8" inputmode="numeric"'
        + ' placeholder="8 digits" value="' + esc(s.hs || '') + '" style="width:88px;text-align:center"></td>'
      + '<td><input class="soGst" data-sku="' + esc(r.sku) + '" type="number" min="0" max="28" step="0.5"'
        + ' placeholder="%" value="' + (s.gst == null ? '' : s.gst) + '" style="width:64px;text-align:center"></td>'
      + '<td><input class="soRate" data-sku="' + esc(r.sku) + '" type="number" min="0" step="0.01"'
        + ' placeholder="per unit" value="' + (s.rate == null ? '' : s.rate) + '" style="width:88px;text-align:right"></td>'
      + '<td class="num">' + (line ? line.toFixed(2) : '<span class="muted">—</span>') + '</td>'
      + '</tr>';
  }).join('');

  $('soCustoms').innerHTML = '<thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th>'
    + '<th>HS code</th><th>GST %</th><th>Rate/unit</th><th class="num">Line total</th></tr></thead>'
    + '<tbody>' + (body || '<tr><td colspan="7" class="muted" style="padding:10px">No SKU on this order.</td></tr>') + '</tbody>';

  const missing = rows.filter(r => !soSku(r.sku).hs).length;
  $('soInvTot').innerHTML = 'Goods <b>' + goods.toFixed(2) + ' ' + esc(cur) + '</b>'
    + ' · GST <b>' + tax.toFixed(2) + '</b> · total <b>' + (goods + tax).toFixed(2) + '</b>'
    + (missing ? ' <span class="fu fu-amber">· ' + missing + ' SKU(s) with no HS code — DHL rejects a line without one</span>' : '');

  const bind = (cls, field, cast) => $('soCustoms').querySelectorAll('.' + cls).forEach(el => {
    el.onchange = async () => {
      try { await soSetSku(el.dataset.sku, field, el.value.trim() === '' ? '' : cast(el.value)); soRenderCustoms(); }
      catch (err) { $('soErr').textContent = 'Could not save: ' + (err.message || err); $('soErr').classList.remove('hide'); }
    };
  });
  bind('soHs', 'hs', v => String(v).replace(/\D/g, '').slice(0, 8));
  bind('soGst', 'gst', v => Number(v));
  bind('soRate', 'rate', v => Number(v));
}
$('soCur').addEventListener('change', soRenderCustoms);

/* ---------- the adjustment dialog ---------- */
let ADJ_EDIT = null;                       // SKU being adjusted on the order that is open

function openAdj(sku) {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const item = o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku);
  if (!item) return;
  const ln = soLine(SHOP_EDIT, sku);
  ADJ_EDIT = sku;

  $('adjTitle').textContent = o.no + ' · ' + sku;
  $('adjSub').textContent = item.name + (item.variant ? ' · ' + item.variant : '')
    + ' · ' + item.qty + ' ordered' + (ln.q != null ? ', ' + ln.q + ' at location' : '');
  const img = ln.adjImg || item.img || '';
  $('adjImg').src = img;
  $('adjImg').style.visibility = img ? 'visible' : 'hidden';

  $('adjReason').value = ln.adjReason || (ln.q != null && item.qty - ln.q > 0 ? 'Short' : 'Wrong size');
  // The variant Shopify already knows is the best first guess at what was wanted — it is the size
  // the customer actually bought.
  $('adjSend').value = ln.adjSend || '';
  $('adjWant').value = ln.adjWant || item.variant || '';
  $('adjQty').value = ln.adjQty || Math.max(1, Number(item.qty) - Number(ln.q || 0)) || 1;
  $('adjNote').value = ln.adjNote || '';
  $('adjQty').max = item.qty;

  // Sizes already used anywhere, so the same size is not spelt three ways across three sheets.
  const sizes = new Set();
  Object.values(SHOP_META).forEach(m => Object.values((m && m.lines) || {}).forEach(l => {
    if (l.adjSend) sizes.add(l.adjSend);
    if (l.adjWant) sizes.add(l.adjWant);
  }));
  SHOP.orders.forEach(x => x.items.forEach(it => { if (it.variant) sizes.add(it.variant); }));
  $('adjSizeList').innerHTML = [...sizes].sort()
    .map(s => `<option value="${String(s).replace(/"/g, '&quot;')}">`).join('');

  $('adjErr').classList.add('hide');
  $('adjDelete').style.display = ln.adj ? '' : 'none';
  $('adjModal').classList.remove('hide');
  $('adjSend').focus();
}

async function saveAdj(remove) {
  if (!ADJ_EDIT || !SHOP_EDIT) return;
  const sku = ADJ_EDIT;
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  const item = o && o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku);
  const meta = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
  const lines = meta.lines || (meta.lines = {});
  const ln = lines[sku] || (lines[sku] = {});
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  if (remove) {
    Object.keys(ln).filter(k => k.indexOf('adj') === 0).forEach(k => delete ln[k]);
    if (ln.q == null && !(ln.log || []).length) delete lines[sku];
  } else {
    const q = Math.max(1, Math.round(Number($('adjQty').value) || 1));
    ln.adj = ln.adj || soAdjId(o ? o.no : SHOP_EDIT, sku);
    ln.adjQty = q;
    ln.adjReason = $('adjReason').value;
    ln.adjSend = $('adjSend').value.trim();
    ln.adjWant = $('adjWant').value.trim();
    ln.adjNote = $('adjNote').value.trim();
    // The picture is COPIED, not linked to the live order. A Shopify image that is swapped later
    // would otherwise change the sheet already on the production floor.
    if (!ln.adjAt) ln.adjAt = soStamp();
    soAdjSnapshot(ln, o, item);
    // Raised by hand, so the quantity box must stop managing it — a wrong-size adjustment is valid
    // even when the count is complete, and an auto-clear would delete a job already sent out.
    ln.adjManual = 1;
  }

  try {
    await saveShopMeta();
    $('adjModal').classList.add('hide');
    ADJ_EDIT = null;
    const cell = $('soItems').querySelector('.soAdjCell[data-sku="' + sku + '"]');
    if (cell && item) cell.innerHTML = soAdjHtml(lines[sku] || {}, item, esc);
    soBindAdjButtons();
    renderShop();

    /* The production order follows the adjustment — raised with it, re-sized with it, withdrawn
     * with it. It is worked out from the adjustments as they now stand, so this one call covers
     * all three cases and running it twice changes nothing. */
    let prod = null;
    /* INTO THE BUCKET (2026-09-26): an adjustment no longer opens production by itself; it completes nothing new either. */
    try { prod = await shpSyncOrder(o, { maintain: true }); }
    catch (e) { prod = { no: shpOrderNo(o && o.no), written: 0, removed: 0, kept: [], skipped: [], err: e.message || String(e) }; }
    // It is already IN the Adjustments tab — both read the same record, so there is nothing to
    // copy across and nothing that can fall out of step. What was missing is anybody being told,
    // so the message says where it went and offers to go there. Deliberately not an automatic
    // jump: that would throw away the order somebody is still working through.
    const pm = shpSyncMsg(prod);
    if (!remove && lines[sku] && lines[sku].adj) {
      soMsg('');
      const m = $('soMsg');
      m.className = prod && prod.err ? 'err' : 'muted';
      m.innerHTML = lines[sku].adj + ' is on the Adjustments tab, and in the <b>Production bucket</b> until somebody opens it · '
        + '<a href="#" id="soGoAdj">open it</a>'
        + (pm ? '<br>' + esc(pm) : '');
      const a = $('soGoAdj');
      if (a) a.onclick = (ev) => { ev.preventDefault(); $('soModal').classList.add('hide'); SHOP_EDIT = null; showTab('adj'); };
    } else if (pm) {
      /* Withdrawing one still has something to report — a line left standing because production has
       * already worked against it is the case somebody has to know about. */
      const m = $('soMsg');
      m.className = prod && (prod.err || prod.kept.length) ? 'err' : 'muted';
      m.textContent = pm;
    }
  } catch (err) {
    $('adjErr').textContent = 'Could not save: ' + (err.message || err);
    $('adjErr').classList.remove('hide');
  }
}

