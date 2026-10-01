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
const SO_LOC_OPTIONS = ['A.1', 'A.2', 'A.3', 'B.1', 'B.2', 'B.3', 'C.1', 'C.2', 'C.3', 'D.1', 'D.2', 'D.3'];

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
  SHOP.orders.concat(SHOP_IMP).forEach(o => (o.items || []).forEach(i => {
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
    const r = await baCall({ india: 'stock' });
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

async function loadShopStock() {
  SHOP_STOCK = {}; SHOP_STOCK_CASE = {};
  for (const b of ['SP', 'CPC']) {
    try {
      const s = await getDoc(doc(db, 'stock', b));
      if (!s.exists()) continue;
      Object.entries(s.data().m || {}).forEach(([sku, q]) => {
        const k = String(sku).trim().toUpperCase();
        SHOP_STOCK[k] = Math.max(SHOP_STOCK[k] || 0, Number(q) || 0);
        if (!SHOP_STOCK_CASE[k]) SHOP_STOCK_CASE[k] = String(sku).trim();
      });
    } catch (e) { /* no stock doc for that brand */ }
  }
  // Loaded means "we asked and got an answer", which is what lets the column say "not in Amazon"
  // instead of "SKU ?". An empty map is NOT an answer — it means nothing was read.
  SHOP_STOCK_LOADED = Object.keys(SHOP_STOCK).length > 0;
}


