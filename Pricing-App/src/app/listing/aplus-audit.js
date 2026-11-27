/* ================= LISTING · A+ CONTENT — which products have A+, which do not, and what to do about each =================
 * Screens: Listing → 2 · Check → A+ Content (#paneAplus / #apcPane, drawn whole here). Same look as Family & Category Check: the same
 *       cards, chips, arrows, rows and buttons (fc-* / cc-* classes; styles.css gives them to both panes).
 * DATA — AMAZON'S A+ DOCUMENTS ONLY, NOTHING GUESSED: ListingMatch.gs reads every A+ document (name, status, type, last update, the
 *       ASINs it is attached to) once a day after the 13:00 refresh; this screen reads it through listing-match.js only (lmGetAplus,
 *       lmAplusDocs, lmAplusState) — the browser's saved copy first, so it opens with no network wait. THE SCREEN MAKES NO AMAZON CALL
 *       BY ITSELF. Only a click does: "Preview A+" reads that one document (?lh=aplusdoc), and aplusAccuracyReport() in the console.
 *       Which products exist, which are live (buyable AND stock > 0) and how they group into families is Family check's own answer
 *       (fcBuild: one row per ASIN). 30-day sales are Listing Audit's (audit/sales30), sessions the weekly store's — both read-only.
 * STATUSES (one per product = per ASIN):
 *   Live      an APPROVED document is attached to the ASIN (or, when it has none of its own, to its parent ASIN)        green
 *   Waiting   the best document on it is SUBMITTED — Amazon is reviewing; "Stuck" when unchanged for more than 7 days    blue / amber
 *   Draft     the best document on it is a DRAFT; "Forgotten draft" when not touched for 30 days                         amber
 *   Rejected  the best document on it is REJECTED (with Amazon's reason when Amazon sends one)                            red
 *   Missing   the A+ read is there and no document lists the ASIN or its parent                                           red
 *   Not checked  no A+ read for the brand, a document's ASIN list could not be read, or a publish record of the last 14 days says
 *             A+ IS on the page although no document lists the ASIN — grey, never an error, never in "Fix first"
 *   No A+ needed  the team's mark on a product that is not Live (one row, ticked rows, or a whole family): out of every error and
 *             count for good, with who and when (listingrules/aplusok_<brand>, kind 'aplusok', through lsGet / lsSave — the way
 *             "Removed on purpose" is kept). Undo puts it back.
 * WHAT TO DO — one plain line per product, from the family's own data (apcWhat).
 * TWO VIEWS: By product (families, closed, the most sales without A+ first; the chip "Fix first" is one ranked list) and By A+ document
 *       (each document: where it is, what is still to add, "Not on any live product").
 * SCREEN = DOWNLOAD: the table and the CSV are made from the same rows (apcRowView / apcDocView) for the view, toggle, brand, chip and
 *       search in use.
 * OUR LISTINGS ONLY (19 Nov 2026): a document's "on N products" counts only our listings (the listing cache's products of that brand,
 *       and ours it covers through their parent); the other ASINs it lists (parents, closed listings, ASINs not in our cache) are a muted
 *       line of their own, "+ X other ASINs (…)", opened to the list. Conversion is shown only with 30+ products AND 300+ sessions a side;
 *       sales pulled more than 7 days ago get an amber "old" warning.
 * MODULES + DESCRIPTION (2 Dec 2026, the MD task — ADDED; every status, box, chip and view above is as it was):
 *   MODULES of each document (Amazon's getContentDocument → contentModuleList, the read Preview A+ uses): the daily backend read
 *       (Pricing-API/AplusModules.gs, read by listing-match.js lmAplusMods — once deployed) and, until then, "Read modules now" (one read-only
 *       ?lh=aplusdoc per document, kept in this browser). The newer of the two counts; a document never read says "not read yet".
 *       Per product (its product A+ document) and per document: the count, the types, Basic / Premium, against the team's standard
 *       (⚙ A+ standard, shared in listingrules/aplusstd; the company's default since 3 Dec 2026: 5 modules incl. a header image —
 *       Premium's full-width / full-background / hero / banner / video-with-image modules are its header image): the count SHOWN is
 *       capped at the standard — "✅ 5 of 5" (5 or more with a header image), "⚠️ 3 of 5" (fewer), "⚠️ missing header image" (enough,
 *       but no header) — never "7 of 5"; Amazon's real count, raw module types and what is missing are in the tooltip. BRAND STORY documents (Amazon's sub-type or module type says
 *       so — never guessed from a name) are not product A+: "Only Brand Story — no product A+" (amber), counted apart; the Live bar's
 *       second line "with product A+: X of Y". Chips "Weak A+" (fewer modules than the standard) and "Only Brand Story", biggest sellers
 *       first. PRODUCT DETAILS (3 Dec 2026, in place of the description column): Amazon's "Product information" attributes as Sellora
 *       already holds them (the listing cache: which spec attributes are filled, their values where kept; the catalogue's brand; the
 *       product type; the Workspace's product-type schema says which attributes exist) — one short cell "✅ 12/12" / "⚠️ 9/12" /
 *       "❌ 4/12" (missing names in the tooltip); a click opens the right-side panel (Style · Measurements · Item details · Materials &
 *       care · Features & specs, Amazon's order; ✅ filled / ❌ missing / grey "not read" — never guessed); the list counted is in the
 *       ⚙ A+ standard box (shared). Chip "Missing product details", family "product details 86% filled" (each product's filled ÷ its own
 *       total, averaged; whole numbers only).
 *       All in the two CSVs. Nothing is sent to Amazon; no A+ is changed.
 * Console: aplusCounts() — per brand, each status, the sales without A+, and the documents' ASINs: ours and others apart; aplusAccuracyReport() — 10 products per status per brand
 *       against Amazon's A+ API now (publish records + the document's own status): MATCH / DIFFERENT.
 * Main functions: apcBuild, apcGroups, apcDraw, apcWhat, apcOkSetMany, apcOkUndo, apcCsv, apcDocsCsv, apcPreview, aplusCounts,
 *       aplusAccuracyReport. Every name starts with apc / APC (and the two console names). */

const APC_STEP = 60;                 // family lines drawn at a time; more as the list scrolls
const APC_STEP_OPEN = 15;            // …when families are open (their rows are drawn too)
const APC_FLAT_STEP = 100;           // "Fix first": rows drawn at a time
const APC_DOC_STEP = 30;             // document cards drawn at a time
const APC_ROWS_FIRST = 40;           // rows of an open family drawn at once; the rest follow in the next frames (a family can hold ~490)
const APC_ROWS_STEP = 80;            // …this many a frame
const APC_DAY = 86400000;
const APC_STUCK_DAYS = 7;            // Waiting for longer than this = Stuck
const APC_OLD_DRAFT_DAYS = 30;       // a Draft not touched for this long = Forgotten draft
const APC_PUB_DAYS = 14;             // a publish record this fresh that says "A+ is on the page" stops a product being called Missing
const APC_MIN_SESS = 300;            // sessions a side needs before a conversion rate is shown
const APC_MIN_CONV_N = 30;           // …and products a side (fewer = a rate that means nothing: the line is not shown at all)
const APC_SALES_OLD_DAYS = 7;        // 30-day sales pulled longer ago than this get an amber "old" warning beside them
const APC_OK_DOC = brand => 'aplusok_' + brand;
const APC_MANAGER = 'https://sellercentral.amazon.com/enhanced-content/content-manager';
const APC_PIC = 'https://m.media-amazon.com/images/S/';
// cls: the colour — ok green, b blue, y amber, r red, g grey
const APC_ST = {
  live: { t: 'Live', one: 'approved', cls: 'ok', tip: 'An approved A+ document is on the product (or on its parent ASIN): shoppers see it.' },
  waiting: { t: 'Waiting', one: 'reviewing', cls: 'b', tip: 'Submitted to Amazon and in review. Nothing to do — unless it has waited more than 7 days (Stuck).' },
  draft: { t: 'Draft', one: 'unsubmitted', cls: 'y', tip: 'An A+ document is on the product but was never submitted for approval.' },
  rejected: { t: 'Rejected', one: 'fix', cls: 'r', tip: 'Amazon rejected the A+ document on the product. Fix it and submit it again.' },
  missing: { t: 'Missing', one: 'none', cls: 'r', tip: 'No A+ document lists this product or its parent ASIN.' },
  none: { t: 'No A+ needed', one: 'hidden', cls: 'g', tip: 'Products the team marked as not needing A+: they never show as missing.' },
  unchecked: { t: 'Not checked', one: 'unknown', cls: 'g', tip: 'Amazon\'s A+ data could not be read for these: not an error, not counted.' },
};
const APC_CARDS = ['live', 'waiting', 'draft', 'rejected', 'missing', 'none'];
const APC_FIX = ['missing', 'rejected', 'draft'];                         // "Fix first" and the sales at risk
const APC_BAR = ['live', 'waiting', 'draft', 'rejected', 'missing', 'unchecked'];
const APC_DOC_CHIPS = [['', 'All'], ['add', 'Has ASINs to add'], ['live', 'Live'], ['waiting', 'Waiting'], ['stuck', 'Stuck'], ['draft', 'Draft'], ['rejected', 'Rejected'], ['unused', 'Not on any live product'],
  ['weak', 'Weak A+'], ['story', 'Brand Story']];                       // the last two: 2 Dec 2026 (modules)
const APC_COLS = 13;                 // + Modules, Product details (2–3 Dec 2026)
let APC = { view: 'prod', brand: 'ALL', stock: true, f: '', q: '', open: new Set(), sel: new Set(), limit: APC_STEP, flat: APC_FLAT_STEP, docs: APC_DOC_STEP,
  ok: { SP: {}, CPC: {} }, okLoaded: false, okLoading: null, okV: 0, okNote: '',
  built: false, loaded: false, loading: false, err: '', model: null, order: null, orderKey: '',
  prev: new Map(), prevOpen: '', copied: '', io: null, qT: 0, sideV: 0, fam: null, stickT: 0, later: new Map(), laterV: 0, need: '' };

/* ----- MODULES + DESCRIPTION (2 Dec 2026) — added on top; nothing above changes ----- */
const APC_MOD_KEEP = 'sellora.aplusMods.v1';         // this browser's module reads ("Read modules now", Preview A+)
const APC_STD_ID = 'aplusstd';                        // the team's standard (listingrules/aplusstd)
const APC_STD_DEF = { n: 5, must: ['header'] };       // the company standard (3 Dec 2026): 5 modules, a header image among them
// PRODUCT DETAILS (3 Dec 2026): Amazon's "Product information", in its order — [section, label, attribute, how Sellora knows it, value fields].
// how: 'sp' = the listing cache's filled spec attributes (+ the values it keeps in va), 'brand' = the catalogue, 'pt' = the product type,
// 'live' = only the live read has it. THE LIVE READ (4 Dec 2026): opening the panel reads that listing from Amazon (?lfix=get — Listings
// Items getListingsItem, every attribute; read-only, one call, kept for the session) — then every row has its real value or ❌ missing.
const APC_PD_ROWS = [
  ['style', 'Style', 'style', 'sp', ['style', 'style_name']], ['style', 'Pattern', 'pattern', 'sp', ['pattern', 'pattern_name']], ['style', 'Theme', 'theme', 'sp', []],
  ['style', 'Colour', 'color', 'sp', ['color', 'color_name']], ['style', 'Occasion', 'occasion_type', 'live', []], ['style', 'Seasons', 'seasons', 'live', []],
  ['meas', 'Item size', 'size', 'sp', ['size', 'size_name']], ['meas', 'Item dimensions', 'item_dimensions', 'live', []], ['meas', 'Item shape', 'item_shape', 'sp', ['item_shape']],
  ['meas', 'Item weight', 'item_weight', 'live', []],
  ['item', 'Brand', 'brand', 'brand', []], ['item', 'Number of items / unit count', 'number_of_items', 'sp', ['number_of_items', 'unit_count', 'item_package_quantity']],
  ['item', 'Included components', 'included_components', 'live', []], ['item', 'Item type name', 'item_type_name', 'sp', []], ['item', 'Product type', 'product_type', 'pt', []],
  ['care', 'Material', 'material', 'sp', ['material']], ['care', 'Fabric type', 'fabric_type', 'sp', []], ['care', 'Care instructions', 'care_instructions', 'sp', []],
  ['feat', 'Special features', 'special_feature', 'sp', []], ['feat', 'Room type', 'room_type', 'live', []]];
const APC_PD_SECT = [['style', 'Style'], ['meas', 'Measurements'], ['item', 'Item details'], ['care', 'Materials & care'], ['feat', 'Features & specs'], ['other', 'Other']];
const APC_PD_ALL = APC_PD_ROWS.map(r => r[2]);
const APC_PD_NEW = ['seasons', 'item_dimensions'];                 // added 4 Dec 2026: counted even in a list saved before them
// the same detail under Amazon's other attribute names (the live read)
const APC_PD_ALT = { number_of_items: ['unit_count', 'item_package_quantity'], item_dimensions: ['item_length_width', 'item_depth_width_height', 'item_length_width_height'],
  item_weight: ['item_display_weight'], size: ['size_name'], color: ['color_name'], style: ['style_name'], pattern: ['pattern_name'] };
// not product information (the content, pictures, offer, identifiers, family links): never in "Other"
const APC_PD_SKIP = /image_locator|^(item_name|bullet_point|product_description|generic_keyword|externally_assigned_product_identifier|merchant_suggested_asin|purchasable_offer|fulfillment_availability|list_price|condition_type|condition_note|merchant_shipping_group|skip_offer|max_order_quantity|child_parent_sku_relationship|parentage_level|variation_theme|merchant_release_date|product_tax_code|supplier_declared_has_product_identifier_exemption|product_site_launch_date|gift_options|offering_end_date|offering_start_date)$/;
const APC_PD_KNOWN = new Set([].concat(APC_PD_ALL, ...Object.values(APC_PD_ALT)));
const APC_MOD_FRESH = 86400000;                       // "Read modules now" reads again what is older than a day
// Amazon's module types (A+ Content API contentModuleType) in plain words, and the kind each one counts as for the standard
const APC_MOD_TYPES = { STANDARD_HEADER_IMAGE_TEXT: ['header image', 'header'], STANDARD_COMPANY_LOGO: ['logo', 'logo'], STANDARD_COMPARISON_TABLE: ['comparison chart', 'comparison'],
  STANDARD_FOUR_IMAGE_TEXT: ['4 images + text', 'imagetext'], STANDARD_FOUR_IMAGE_TEXT_QUADRANT: ['4 images + text', 'imagetext'], STANDARD_IMAGE_SIDEBAR: ['single image + sidebar', 'imagetext'],
  STANDARD_IMAGE_TEXT_OVERLAY: ['image + text overlay', 'imagetext'], STANDARD_MULTIPLE_IMAGE_TEXT: ['multiple images + text', 'imagetext'], STANDARD_PRODUCT_DESCRIPTION: ['text', 'text'],
  STANDARD_SINGLE_IMAGE_HIGHLIGHTS: ['image + highlights', 'imagetext'], STANDARD_SINGLE_IMAGE_SPECS_DETAIL: ['image + specs', 'imagetext'], STANDARD_SINGLE_SIDE_IMAGE: ['image + text', 'imagetext'],
  STANDARD_TECH_SPECS: ['tech specs', 'text'], STANDARD_TEXT: ['text', 'text'], STANDARD_THREE_IMAGE_TEXT: ['3 images + text', 'imagetext'] };
const APC_KINDS = [['header', 'header image'], ['comparison', 'comparison chart'], ['imagetext', 'image + text'], ['text', 'text'], ['logo', 'logo']];
const APC_KIND_NAME = Object.fromEntries(APC_KINDS);
const APC_NOAPLUS = ['missing', 'rejected', 'draft', 'waiting'];    // no A+ live for the shopper (Not checked and No A+ needed are not judged)
const APC_FLAT_F = ['fix', 'weak', 'story', 'pd'];                  // chips shown as one list, the biggest sellers first
const APC_DOC_RANK = { APPROVED: 4, SUBMITTED: 3, REJECTED: 2, DRAFT: 1 };
Object.assign(APC, { mods: new Map(), modsLoaded: false, daily: { SP: null, CPC: null }, modV: 0, std: { n: APC_STD_DEF.n, must: APC_STD_DEF.must.slice(), pd: APC_PD_ALL.slice() }, stdBy: null, stdV: 0,
  stdDraft: null, setOpen: false, stdNote: '', modRead: null, pd: '',
  pdLive: new Map(), pdV: 0 });       // (4 Dec 2026) 'brand|sku' → the panel's live read { st: 'reading' | 'ok' | 'err', at, attrs, pt, err } — this session only
/** One module type in words: { name, kind }. */
function apcModType(t) {
  const k = String(t || '').toUpperCase(), e = APC_MOD_TYPES[k];
  if (e) return { name: e[0], kind: e[1] };
  if (/BRAND.?STORY/.test(k)) return { name: 'brand story', kind: 'story' };
  // PREMIUM A+ (3 Dec 2026) has its own module types: a full-width / full-background / hero / banner image (or a video with an image) is
  // the header image; its comparison table the comparison chart; its image + text and text modules the same as Basic's
  if (/^PREMIUM/.test(k)) {
    if (/FULL.?WIDTH|FULL.?BACKGROUND|FULL.?IMAGE|HERO|BANNER|VIDEO.*IMAGE|IMAGE.*VIDEO/.test(k)) return { name: 'header image', kind: 'header' };
    if (/COMPARISON/.test(k)) return { name: 'comparison chart', kind: 'comparison' };
    if (/IMAGE|CAROUSEL|HOTSPOT|GALLERY/.test(k)) return { name: 'image + text', kind: 'imagetext' };
    if (/TEXT|Q.?A|QUESTION/.test(k)) return { name: 'text', kind: 'text' };
  }
  if (/COMPARISON/.test(k)) return { name: 'comparison chart', kind: 'comparison' };
  if (/HEADER/.test(k)) return { name: 'header image', kind: 'header' };
  return { name: k.replace(/^(STANDARD|PREMIUM)_/, '').replace(/_/g, ' ').toLowerCase() || 'module', kind: /IMAGE/.test(k) ? 'imagetext' : /TEXT/.test(k) ? 'text' : 'other' };
}
// This browser's module reads: kept between visits (a reload keeps them); every read and write wrapped (no storage = this visit only).
function apcModKeepLoad() {
  if (APC.modsLoaded) return;
  APC.modsLoaded = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(APC_MOD_KEEP) : null;
    const o = raw ? JSON.parse(raw) : null;
    if (o && typeof o === 'object') Object.keys(o).forEach(k => { const m = o[k]; if (m && Array.isArray(m.ty)) APC.mods.set(k, m); });
  } catch (e) { /* nothing kept */ }
  APC.modV++;
}
function apcModKeepSave() { try { if (typeof localStorage !== 'undefined') localStorage.setItem(APC_MOD_KEEP, JSON.stringify(Object.fromEntries(APC.mods))); } catch (e) { /* this visit only */ } }
/** One document's modules from an answer of ?lh=aplusdoc (getContentDocument): { n, ty (Amazon's types), sub, ct, at, src }. */
function apcModFrom(r) {
  const list = Array.isArray(r.modules) ? r.modules : [];
  return { n: r.moduleCount != null ? Number(r.moduleCount) || 0 : list.length, ty: list.map(m => String(m.type || '')), sub: String(r.subType || ''), ct: String(r.contentType || ''),
    at: Number(r.readAt) || Date.now(), src: 'browser' };
}
function apcModPut(pk, r) { APC.mods.set(pk, apcModFrom(r)); APC.modV++; apcModKeepSave(); }
/** The backend's daily module read, through listing-match.js (lmAplusModsRead / lmAplusMods): none until AplusModules.gs is deployed. */
async function apcModsDailyLoad() {
  if (typeof lmAplusModsRead === 'function') await lmAplusModsRead();
  ['SP', 'CPC'].forEach(b => { APC.daily[b] = typeof lmAplusMods === 'function' ? lmAplusMods(b) : null; });
  APC.modV++;
}
/** The modules of one document: the newer of the daily read and this browser's read; null when never read (never guessed). */
function apcModsOf(d) {
  if (!d) return null;
  const held = APC.daily[d.brand], day = held && held.docs ? held.docs[d.k] : null;
  const a = day && Array.isArray(day.ty) ? { n: Number(day.n) || day.ty.length, ty: day.ty.map(String), sub: String(day.sub || ''), ct: String(day.ct || ''), at: Number(day.at) || held.at || 0, src: 'daily' } : null;
  const b = APC.mods.get(d.brand + '|' + d.k) || null;
  return !a ? b : !b ? a : (b.at > a.at ? b : a);
}
/** A Brand Story: Amazon's sub-type, content type or a module type says so. */
const apcIsStory = m => !!m && (/BRAND.?STORY/i.test(m.sub) || /BRAND.?STORY/i.test(m.ct) || (m.ty || []).some(t => /BRAND.?STORY/i.test(t)));
/** "header image · image + text ×2 · comparison chart · text" */
function apcModsText(m) {
  const seen = new Map();
  (m.ty || []).forEach(t => { const n = apcModType(t).name; seen.set(n, (seen.get(n) || 0) + 1); });
  return [...seen].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ');
}
/** Against the standard (3 Dec 2026: the count SHOWN is capped at the standard — never "7 of 5"):
 *  { n (Amazon's real count), shown (capped), of, complete, weak, missing: [words], text ("✅ 5 of 5" / "⚠️ 3 of 5" / "⚠️ missing header
 *  image"), plain (the same without the mark — the sheet), tip (Amazon's real count and raw module types, and what is missing) }.
 *  Fewer modules than the standard: "⚠️ N of 5"; enough but a must-have missing: "⚠️ missing <it>"; both weak. */
function apcVsStd(m) {
  const std = APC.std, kinds = (m.ty || []).map(t => apcModType(t).kind);
  const miss = std.must.filter(k => !kinds.includes(k)).map(k => APC_KIND_NAME[k] || k);
  const more = Math.max(0, std.n - m.n);
  const missing = miss.concat(more ? [`${more} more module${more === 1 ? '' : 's'}`] : []);
  const shown = Math.min(m.n, std.n);
  const complete = m.n >= std.n && !miss.length;
  const plain = complete ? `${std.n} of ${std.n}` : m.n < std.n ? `${shown} of ${std.n}` : `missing ${miss.join(', ')}`;
  const tip = `${m.n} module${m.n === 1 ? '' : 's'} on Amazon: ${(m.ty || []).join(', ') || 'none'}` + (missing.length ? ` — missing: ${missing.join(', ')}` : '');
  return { n: m.n, shown, of: std.n, complete, weak: !complete, missing, text: (complete ? '✅ ' : '⚠️ ') + plain, plain, tip };
}
/** PRODUCT DETAILS of one product (3 Dec 2026), from what Sellora already holds — never a new Amazon call, never guessed:
 *  { known (the listing cache holds its spec attributes — without them the cell says "not read"), rows: [{ sec, label, key,
 *  st: 'ok' | 'miss' | 'unread' | 'na' (not for its product type), value,
 *  counted }], n (filled), of (counted), miss (labels), pt, at }. The listing cache (lmGet: `sp` = the spec attributes filled, `va` = the
 *  values it keeps); the Workspace's live read when it is newer; the product type's schema (which attributes exist) when the Workspace
 *  has read it; the catalogue's brand. */
function apcPd(c) {
  const none = { known: false, rows: [], n: 0, of: 0, miss: [], pt: '', at: 0 };
  const sku0 = typeof lmGet === 'function' ? (c.skus || [c.sku]).find(s => lmGet(s, c.brand)) : '';
  const m = sku0 ? lmGet(sku0, c.brand) : null;
  const full = APC.pdLive.get(c.brand + '|' + c.sku);
  if (full && full.st === 'ok') return apcPdFull(c, full, m);              // (4 Dec 2026) the panel read the listing from Amazon: every value
  if (!m) return none;
  const sku = sku0;
  const ws = typeof LI_WS !== 'undefined' && LI_WS ? LI_WS : null;
  const live = ws && ws.live && ws.live[c.brand] ? ws.live[c.brand][sku] : null;
  const fresh = live && live.specs && (live.gAt || 0) > (m.readAt || 0);
  const specs = fresh ? live.specs : Array.isArray(m.sp) ? Object.fromEntries(m.sp.map(k => [k, true])) : null;    // null = not read
  const pt = String(m.pt || (fresh && live.pt) || '');
  const exists = apcPdExists(c.brand, pt);
  const va = m.va || {};
  const cat = c.asin && typeof lmGetAsin === 'function' ? lmGetAsin(c.asin, c.brand) : null;
  const count = new Set(APC.std.pd || APC_PD_ALL);
  const rows = APC_PD_ROWS.map(([sec, label, key, how, vals]) => {
    let st = 'unread', value = '';
    // product type and brand: an empty one is "not read" (a listing always has both on Amazon — empty means Sellora's copy lacks it)
    if (how === 'pt') { if (pt) { value = pt.replace(/_/g, ' ').toLowerCase(); st = 'ok'; } }
    else if (how === 'brand') { if (cat && cat.brand) { value = String(cat.brand); st = 'ok'; } }
    else if (how === 'sp' && specs) {
      if (!exists(key)) st = 'na';
      else { value = vals.map(v => va[v]).find(Boolean) || ''; st = specs[key] || value ? 'ok' : 'miss'; }
    }
    return { sec, label, key, st, value: String(value).slice(0, 120), counted: (st === 'ok' || st === 'miss') && count.has(key) };
  });
  const counted = rows.filter(r => r.counted);
  return { known: !!specs, rows, n: counted.filter(r => r.st === 'ok').length, of: counted.length, miss: counted.filter(r => r.st === 'miss').map(r => r.label), pt, at: fresh ? live.gAt : m.readAt || 0, sku };
}
// Does this attribute exist for the product type? Only the Workspace's product-type check (its spec attributes) can say no.
function apcPdExists(brand, pt) {
  const ws = typeof LI_WS !== 'undefined' && LI_WS ? LI_WS : null;
  const sch = ws && ws.schema && ws.schema[brand] && pt ? ws.schema[brand][pt] : null;
  return k => !(sch && Array.isArray(sch.ok) && (typeof LI_WS_SPECS === 'undefined' || LI_WS_SPECS.includes(k)) && !sch.ok.includes(k));
}
/** One attribute as Amazon's listing holds it ([{ value, unit, language_tag, marketplace_id }, …] or nested, e.g. item_dimensions'
 *  { length: { value, unit }, width: … }) → plain words: "Cotton", "1.2 pounds", "length: 70 inches, width: 118 inches"; '' = no value. */
function apcPdVal(arr) {
  const one = v => (v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v !== 'object' ? String(v)
    : 'value' in v ? [one(v.value), v.unit ? String(v.unit).replace(/_/g, ' ') : ''].filter(Boolean).join(' ')
      : (() => { const ks = Object.keys(v).filter(k => !/^(marketplace_id|language_tag)$/.test(k));
        return ks.map(k => { const t = one(v[k]); return t && ks.length > 1 ? k.replace(/_/g, ' ') + ': ' + t : t; }).filter(Boolean).join(', '); })());
  return Array.isArray(arr) ? [...new Set(arr.map(e => one(e).trim()).filter(Boolean))].join(', ').slice(0, 300) : '';
}
const apcPdLabel = k => { const s = String(k).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
/** The product details from the live read: every row has its real value (✅) or none on our listing (❌ — or "not for this product type"
 *  when the Workspace's product-type check says it does not exist); "Other": every further attribute the listing has, with its value. */
function apcPdFull(c, full, m) {
  const A = full.attrs || {}, pt = full.pt || (m && m.pt) || '';
  const exists = apcPdExists(c.brand, pt);
  const count = new Set(APC.std.pd || APC_PD_ALL);
  const rows = APC_PD_ROWS.map(([sec, label, key, how]) => {
    const value = how === 'pt' ? pt.replace(/_/g, ' ').toLowerCase() : [key].concat(APC_PD_ALT[key] || []).map(k => apcPdVal(A[k])).find(Boolean) || '';
    const st = value ? 'ok' : exists(key) ? 'miss' : 'na';
    return { sec, label, key, st, value, counted: st !== 'na' && count.has(key) };
  });
  Object.keys(A).filter(k => !APC_PD_KNOWN.has(k) && !APC_PD_SKIP.test(k)).sort().forEach(k => {
    const value = apcPdVal(A[k]);
    if (value) rows.push({ sec: 'other', label: apcPdLabel(k), key: k, st: 'ok', value, counted: false });
  });
  const counted = rows.filter(r => r.counted);
  return { known: true, live: true, rows, n: counted.filter(r => r.st === 'ok').length, of: counted.length, miss: counted.filter(r => r.st === 'miss').map(r => r.label), pt, at: full.at, sku: c.sku };
}
/** THE LIVE READ (4 Dec 2026): that one listing from Amazon (?lfix=get — read-only), once per session; a failed read is never ❌. */
function apcPdRead(brand, sku) {
  const k = brand + '|' + sku, cur = APC.pdLive.get(k);
  if (cur && cur.st === 'reading') return cur.p;
  const e = { st: 'reading', at: 0 };
  APC.pdLive.set(k, e);
  e.p = (async () => {
    try {
      const r = typeof baCall === 'function' ? await baCall({ lfix: 'get', brand, sku }) : null;
      if (!r || r.ok === false || !r.attributes || typeof r.attributes !== 'object') throw new Error((r && r.error) || 'no answer');
      APC.pdLive.set(k, { st: 'ok', at: Date.now(), attrs: r.attributes, pt: String(r.productType || '') });
    } catch (err) { APC.pdLive.set(k, { st: 'err', at: Date.now(), err: String((err && err.message) || err).slice(0, 200) }); }
    APC.pdV++;
    apcSideDraw();
    if (apcPaneOn()) apcDrawKeep();                                     // the table's badge, recounted
    return APC.pdLive.get(k);
  })();
  apcSideDraw();
  return e.p;
}
// Open the panel on a product: its live read starts unless this session already has it.
function apcPdOpen(key) {
  APC.pd = APC.pd === key ? '' : key;
  apcSideDraw();
  const p = APC.pd ? apcBuild().rows.find(r => r.key === APC.pd) : null;
  if (!p) return null;
  const cur = APC.pdLive.get(p.c.brand + '|' + p.c.sku);
  return cur && cur.st !== 'err' ? cur.p || null : apcPdRead(p.c.brand, p.c.sku);
}
// "✅ 12/12" (all filled) · "⚠️ 9/12" (at least half) · "❌ 4/12" (fewer than half); '' when nothing is counted.
const apcPdMark = pd => (!pd.of ? '' : pd.n === pd.of ? '✅' : pd.n * 2 >= pd.of ? '⚠️' : '❌');
/** What apcBuild adds to each product: p.make { d (its product A+ document), m (its modules, null = not read), vs, story, unknown },
 *  p.storyOnly (its only A+ is a Brand Story), p.weak, p.pd (its product details — apcPd). */
function apcExtra(p) {
  const docs = (p.docs || []).map(d => ({ d, m: apcModsOf(d) }));
  const story = docs.length > 0 && docs.every(x => x.m && apcIsStory(x.m));
  const prod = docs.filter(x => x.m && !apcIsStory(x.m)).sort((a, b) => (APC_DOC_RANK[b.d.s] || 0) - (APC_DOC_RANK[a.d.s] || 0) || b.m.n - a.m.n)[0] || null;
  p.make = docs.length ? { d: prod ? prod.d : null, m: prod ? prod.m : null, vs: prod ? apcVsStd(prod.m) : null, story, unknown: docs.some(x => !x.m) } : null;
  p.storyOnly = story;
  p.weak = !!(p.make && p.make.vs && p.make.vs.weak);
  p.pd = apcPd(p.c);
}
/** The standard, shared with the team (listingrules/aplusstd through lsGet / lsSave, like the marks). */
async function apcStdLoad() {
  try {
    const data = typeof lsGet === 'function' ? await lsGet(FC_OK_COLL, APC_STD_ID) : null;
    const s = data && data.items && data.items.std;
    if (s && +s.n > 0) {
      APC.std = { n: Math.min(12, Math.max(1, Math.round(+s.n))), must: (s.must || []).filter(k => APC_KIND_NAME[k]),
        // a standard saved before 3 Dec: every attribute; one saved before 4 Dec: + the attributes added then
        pd: Array.isArray(s.pd) ? APC_PD_ALL.filter(k => s.pd.includes(k) || (!(s.pdv >= 2) && APC_PD_NEW.includes(k))) : APC_PD_ALL.slice() };
      APC.stdBy = { by: s.by, name: s.name, at: s.at }; APC.stdV++;
    }
  } catch (e) { APC.stdNote = 'Could not read the A+ standard: ' + ((e && e.message) || e); }
}
async function apcStdSave(v) {
  const n = Math.min(12, Math.max(1, Math.round(+(v && v.n) || APC_STD_DEF.n)));
  const must = [...new Set(((v && v.must) || []).filter(k => APC_KIND_NAME[k]))];
  const pd = Array.isArray(v && v.pd) ? APC_PD_ALL.filter(k => v.pd.includes(k)) : (APC.std.pd || APC_PD_ALL).slice();
  const by = fcWho(), rec = { n, must, pd, pdv: 2, by, name: fcName(by), at: Date.now() };
  APC.std = { n, must, pd }; APC.stdBy = rec; APC.stdV++; APC.stdDraft = null; APC.stdNote = '';
  apcDrawKeep();
  try {
    const saved = typeof lsSave === 'function' ? await lsSave(FC_OK_COLL, APC_STD_ID, { kind: APC_STD_ID, items: { std: rec } }) : false;
    if (!saved) APC.stdNote = fcIsTest() ? 'Test site — the standard is kept on this page only, not saved.' : 'Not saved — the standard is kept on this page only.';
  } catch (e) { APC.stdNote = 'Could not save the standard (' + ((e && e.message) || e) + ') — it is kept on this page only.'; }
  if (APC.stdNote) apcDrawKeep();
  return rec;
}
function apcStdInput(el) {
  const d = APC.stdDraft || (APC.stdDraft = { n: APC.std.n, must: APC.std.must.slice(), pd: (APC.std.pd || APC_PD_ALL).slice() });
  if (el.dataset.apcStd === 'n') d.n = Number(el.value);
  else if (el.dataset.apcStd === 'pd') { d.pd = d.pd.filter(x => x !== el.value); if (el.checked) d.pd.push(el.value); }
  else { d.must = d.must.filter(x => x !== el.value); if (el.checked) d.must.push(el.value); }
}
/** "Read modules now": every document of the brand(s) in view whose modules this page does not have (or has from over a day ago) — one
 *  read-only getContentDocument each (?lh=aplusdoc, the read Preview A+ makes), one at a time, kept in this browser. Stop ends it after
 *  the current one; three failures in a row end it too. Nothing is sent, nothing changed. */
async function apcReadMods() {
  if (APC.modRead && APC.modRead.busy) return APC.modRead;
  const brands = APC.brand === 'ALL' ? ['SP', 'CPC'] : [APC.brand];
  const now = Date.now();
  const todo = brands.flatMap(b => lmAplusDocs(b)).filter(d => { const m = apcModsOf(d); return !m || now - m.at > APC_MOD_FRESH; });
  const run = APC.modRead = { busy: true, done: 0, total: todo.length, fail: 0, stop: false, err: '' };
  apcDrawKeep();
  let inRow = 0;
  for (const d of todo) {
    if (run.stop) break;
    try {
      const r = await baCall({ lh: 'aplusdoc', brand: d.brand, doc: d.k });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'no answer');
      APC.mods.set(d.brand + '|' + d.k, apcModFrom(r));
      inRow = 0;
    } catch (e) {
      run.fail++; inRow++;
      run.err = String((e && e.message) || e).slice(0, 160);
      if (inRow >= 3) { run.stop = true; run.err = 'stopped after 3 failed reads in a row — ' + run.err; }
    }
    run.done++;
    if (run.done % 5 === 0) { APC.modV++; apcModKeepSave(); apcDrawKeep(); }
  }
  run.busy = false;
  APC.modV++;
  apcModKeepSave();
  apcDrawKeep();
  return run;
}

/* ----- small words ----- */
const apcId = c => c.asin || 'sku:' + c.sku;                                // a product's id for marks and ticks: its ASIN (one row per ASIN)
const APC_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });   // made once (a new one per date is slow)
const apcDate = ms => (ms ? APC_DATE.format(new Date(ms)) : '');
const apcMoney = v => (v == null ? '—' : '$' + fcNf(Math.round(v)));
const apcDays = (ms, now) => Math.floor(((now || Date.now()) - ms) / APC_DAY);
const apcStatusOf = s => ({ APPROVED: 'live', SUBMITTED: 'waiting', DRAFT: 'draft', REJECTED: 'rejected' }[s] || 'unchecked');
const apcChip = (k, text) => `<span class="fc-chip apc-c is-${APC_ST[k].cls}">${fcEsc(text || APC_ST[k].t)}</span>`;

/* ----- the marks (listingrules/aplusok_<brand>) ----- */
function apcOkLoad() {
  if (APC.okLoaded || APC.okLoading) return APC.okLoading;
  APC.okLoading = (async () => {
    for (const b of ['SP', 'CPC']) {
      try {
        const data = typeof lsGet === 'function' ? await lsGet(FC_OK_COLL, APC_OK_DOC(b)) : null;
        if (data && data.items) APC.ok[b] = Object.assign({}, data.items, APC.ok[b]);
      } catch (e) { APC.okNote = 'Could not read the "No A+ needed" marks: ' + ((e && e.message) || e); }
    }
    APC.okLoaded = true;
    APC.okLoading = null;
    APC.okV++;
    apcDraw();
  })();
  return APC.okLoading;
}
// Save marks for one brand (several at once, one write): the page shows them at once; the save follows.
async function apcOkWrite(brand, entries) {
  Object.assign(APC.ok[brand], entries);
  APC.okV++;
  APC.okNote = '';
  apcDrawKeep();
  try {
    const saved = typeof lsSave === 'function' ? await lsSave(FC_OK_COLL, APC_OK_DOC(brand), { kind: 'aplusok', items: entries }) : false;
    if (!saved) APC.okNote = fcIsTest() ? 'Test site — the mark is kept on this page only, not saved.' : 'Not saved — the mark is kept on this page only.';
  } catch (e) {
    APC.okNote = 'Could not save the mark (' + ((e && e.message) || e) + ') — it is kept on this page only and will show again after a reload.';
  }
  if (APC.okNote) apcDrawKeep();
  return entries;
}
/** No A+ needed, for one or many products (keys "brand|id"): they leave Missing / Rejected / Draft / Waiting at once and for good. */
async function apcOkSetMany(keys) {
  const model = apcBuild();
  const by = fcWho(), at = Date.now();
  const per = {};
  model.rows.forEach(p => {
    if (!keys.includes(p.key) || p.st === 'live' || p.bucket === 'none') return;
    (per[p.c.brand] = per[p.c.brand] || {})[apcId(p.c)] = { on: true, by, name: fcName(by), at, sku: p.c.sku, asin: p.c.asin || '', st: p.st, fam: String(p.g.f.name || '').slice(0, 80) };
    APC.sel.delete(p.key);
  });
  await Promise.all(Object.entries(per).map(([brand, entries]) => apcOkWrite(brand, entries)));
  return Object.values(per).reduce((n, e) => n + Object.keys(e).length, 0);
}
/** Undo: the product counts again; who undid it is kept beside the first mark. */
function apcOkUndo(brand, id) {
  const old = (APC.ok[brand] || {})[id] || {};
  const by = fcWho();
  return apcOkWrite(brand, { [id]: Object.assign({}, old, { on: false, undoneBy: by, undoneName: fcName(by), undoneAt: Date.now() }) });
}

/* ----- sales (30 days) and sessions: what Sellora already holds ----- */
// 30-day sales of one ASIN: Listing Audit's figure (audit/sales30 — [units, $]); null when no sales were ever pulled.
function apcSales(asin) {
  if (typeof SALES30 === 'undefined' || !SALES30 || !SALES30.at || !asin) return null;
  const s = SALES30.asins[String(asin).toUpperCase()];
  return s ? Number(s[1]) || 0 : 0;
}
const apcSalesAt = () => (typeof SALES30 !== 'undefined' && SALES30 && SALES30.at ? String(SALES30.at) : '');
/** When the 30-day sales were pulled longer ago than APC_SALES_OLD_DAYS: that day in words ('6 Aug 2026'); else '' (fresh, or none). */
function apcSalesOld(now) {
  const at = apcSalesAt();
  if (!at) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(at);
  const ms = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(at);
  if (!ms || isNaN(ms)) return '';
  return (now || Date.now()) - ms > APC_SALES_OLD_DAYS * APC_DAY ? apcDate(ms) : '';
}
// The weekly store's last 4 weeks of one ASIN: { u (units), s (sessions) } — null when the store is not loaded or has no sessions for it.
function apcTraffic(asin) {
  if (typeof WEEKLY === 'undefined' || !WEEKLY || !WEEKLY.rows || !asin) return null;
  const row = WEEKLY.rows[String(asin).toUpperCase()] || WEEKLY.rows[asin];
  if (!row || !row.weeks) return null;
  const weeks = Object.keys(row.weeks).sort().slice(-4);
  let u = 0, s = 0, any = false;
  weeks.forEach(w => { const c = row.weeks[w]; if (c && c.sessions != null) { any = true; s += Number(c.sessions) || 0; u += Number(c.u) || 0; } });
  return any ? { u, s } : null;
}
/** "Products with A+ convert X% vs Y% without", per brand, from the weekly store's sessions and units (the last 4 weeks) — only when
 *  both sides have at least APC_MIN_CONV_N products AND at least APC_MIN_SESS sessions; else null (never invented, nothing shown). */
function apcConv(rows, brand) {
  const side = { yes: { u: 0, s: 0, n: 0 }, no: { u: 0, s: 0, n: 0 } };
  rows.forEach(p => {
    if (p.c.brand !== brand || (p.bucket !== 'live' && !APC_FIX.includes(p.bucket))) return;
    const t = apcTraffic(p.c.asin);
    if (!t) return;
    const into = p.bucket === 'live' ? side.yes : side.no;
    into.u += t.u; into.s += t.s; into.n++;
  });
  if (side.yes.n < APC_MIN_CONV_N || side.no.n < APC_MIN_CONV_N || side.yes.s < APC_MIN_SESS || side.no.s < APC_MIN_SESS) return null;
  return { brand, yes: side.yes.u / side.yes.s, no: side.no.u / side.no.s, nYes: side.yes.n, nNo: side.no.n };
}

/* ----- one product's A+ ----- */
// A publish record Sellora read lately (Listing Health's own A+ reads) that says A+ IS on this product's page: its time, else 0.
function apcPubLive(c, pa, rowsOf, now) {
  const fresh = at => at > 0 && now - at <= APC_PUB_DAYS * APC_DAY;
  let best = 0;
  const take = e => { if (e && e.v === true && fresh(e.at || 0)) best = Math.max(best, e.at); };
  const ws = typeof LI_WS !== 'undefined' && LI_WS.aplus && LI_WS.aplus[c.brand] ? LI_WS.aplus[c.brand] : {};
  take(ws[c.asin]);
  if (pa) take(ws[pa]);
  (rowsOf.get(c.asin) || []).forEach(r => take({ v: r.aplus, at: r.aplusAt || 0 }));
  const saved = typeof HEALTH !== 'undefined' && HEALTH[c.brand] && HEALTH[c.brand].parentAplus ? HEALTH[c.brand].parentAplus : {};
  if (pa) take(saved[pa]);
  return best;
}
/** One product (a child of fcBuild) as this screen shows it: { c, key, g, st (Amazon's answer), bucket (st, or 'none' when marked), doc,
 *  docs, via, stuck, oldDraft, reasons, why (for Not checked), sales, mark, what }. */
function apcProduct(c, g, ctx) {
  const a = c.asin && typeof lmGetAplus === 'function' ? lmGetAplus(c.asin, c.brand, g.f.pa || '') : null;
  const p = { c, key: fcKey(c.brand, apcId(c)), g, st: 'unchecked', bucket: 'unchecked', doc: null, docs: [], via: '', stuck: false, oldDraft: false, reasons: [], why: '',
    sales: apcSales(c.asin), mark: null, what: '', at: a ? a.at : 0 };
  if (!a) p.why = ctx.state[c.brand].why || 'A+ has not been read for this brand';
  else if (a.status === 'UNKNOWN') p.why = a.main ? `Amazon gave a status Sellora does not know (${a.main.s || 'none'})` : `${ctx.state[c.brand].partial} A+ document(s) could not say which products they are on`;
  else if (a.status === 'NONE') {
    const pub = apcPubLive(c, g.f.pa || '', ctx.rowsOf[c.brand], ctx.now);
    if (pub) p.why = `Amazon's publish record of ${apcDate(pub)} says A+ is on the page, but no A+ document lists this ASIN — check it in A+ Content Manager`;
    else p.st = 'missing';
  } else {
    p.st = apcStatusOf(a.status);
    p.doc = a.main; p.docs = a.docs; p.via = a.via;
    p.reasons = a.main.rr || [];
    p.stuck = p.st === 'waiting' && a.main.u > 0 && ctx.now - a.main.u > APC_STUCK_DAYS * APC_DAY;
    p.oldDraft = p.st === 'draft' && a.main.u > 0 && ctx.now - a.main.u > APC_OLD_DRAFT_DAYS * APC_DAY;
  }
  const mark = (APC.ok[c.brand] || {})[apcId(c)];
  p.mark = mark && mark.on ? mark : null;
  p.bucket = p.mark && p.st !== 'live' ? 'none' : p.st;
  return p;
}
// A product's place inside its family: to fix first, then stuck, waiting, not checked, live, no A+ needed.
const apcRank = p => (APC_FIX.includes(p.bucket) ? 0 : p.bucket === 'waiting' ? (p.stuck ? 1 : 2) : p.bucket === 'unchecked' ? 3 : p.bucket === 'live' ? 4 : 5);
// A long list of ASINs on the screen: the first few and how many more (Copy ASIN list always takes them all).
const apcAsinsHtml = list => list.slice(0, 12).map(fcEsc).join(' ') + (list.length > 12 ? ` <span class="muted">… +${fcNf(list.length - 12)} more (Copy takes all ${fcNf(list.length)})</span>` : '');
/** THE ONE "WHAT TO DO" LINE, in plain words, from the family's real data. */
function apcWhat(p) {
  const g = p.g, d = p.doc, name = d ? `“${d.n || 'unnamed document'}”` : '';
  if (p.bucket === 'none') return `No A+ needed — marked by ${p.mark.name || fcName(p.mark.by)}${p.mark.at ? ' on ' + apcDate(p.mark.at) : ''}`;
  if (p.st === 'live') return 'Nothing to do — A+ is live';
  if (p.st === 'unchecked') return 'Not checked — ' + p.why;
  if (p.st === 'waiting') return p.stuck ? `Stuck in review since ${apcDate(d.u)} — contact Seller Support` : 'Nothing to do — Amazon reviewing';
  if (p.st === 'draft') return p.oldDraft ? `Forgotten draft (not touched since ${apcDate(d.u)}) — submit ${name} for approval, or delete it` : `Submit ${name} for approval`;
  if (p.st === 'rejected') return p.reasons.length ? `Fix: ${p.reasons.join('; ')}, then resubmit` : `Fix what Amazon rejected, then resubmit ${name} (Amazon's reason is in A+ Content Manager and in its e-mail)`;
  // Missing: a sibling's live document first, then a sibling's document on its way, else a new one for the family
  if (g.liveDoc) return `Add this ASIN to “${g.liveDoc.n || 'unnamed document'}” in A+ Content Manager (2 minutes)`;
  if (g.nextDoc) return `Add this ASIN to “${g.nextDoc.n || 'unnamed document'}” (${g.nextDoc.s === 'SUBMITTED' ? 'in review' : g.nextDoc.s === 'DRAFT' ? 'a draft' : 'rejected'}) so it goes live with its family`;
  return g.f.solo ? 'Create A+ for this product' : `Create A+ for this family (one document can cover all ${fcNf(g.rows.length)} products)`;
}

/* ----- building the picture ----- */
/** { groups: [{ f, rows, risk, n: { bucket: count }, liveDoc, nextDoc, gap }], rows (every product), all (ASIN → { c, live }, toggle or
 *  not), state: { brand: lmAplusState }, salesAt }. Families: Family check's (fcBuild); a product with no family is a line of its own. */
function apcBuild() {
  const lmV = typeof lmVersion === 'function' ? lmVersion() : 0;
  const src = [typeof HEALTH !== 'undefined' ? HEALTH.SP : null, typeof HEALTH !== 'undefined' ? HEALTH.CPC : null, typeof IML !== 'undefined' ? IML.SP : null, typeof IML !== 'undefined' ? IML.CPC : null,
    typeof SALES30 !== 'undefined' ? SALES30 : null, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0];
  const key = [lmV, APC.okV, APC.stock, APC.sideV, APC.modV, APC.stdV, APC.pdV, typeof LI_WS !== 'undefined' && LI_WS ? LI_WS.liveV || 0 : 0].join('|');   // + the Workspace's live reads (product details)
  const m = APC.model;
  if (m && m.key === key && m.src.length === src.length && m.src.every((x, i) => x === src[i])) return m;
  // Family check's picture of the families (fcBuild: one row per ASIN, who is live) — worked out once while the data is the same
  if (!APC.fam || APC.fam.lmV !== lmV || APC.fam.src.length !== src.length || !APC.fam.src.every((x, i) => x === src[i])) APC.fam = { lmV, src, v: fcBuild() };
  const v = APC.fam.v;
  const now = Date.now();
  const ctx = { now, state: { SP: lmAplusState('SP'), CPC: lmAplusState('CPC') }, rowsOf: { SP: new Map(), CPC: new Map() } };
  ['SP', 'CPC'].forEach(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).forEach(r => {
    if (!r.asin) return;
    if (!ctx.rowsOf[b].has(r.asin)) ctx.rowsOf[b].set(r.asin, []);
    ctx.rowsOf[b].get(r.asin).push(r);
  }));
  const all = new Map();                               // "brand|ASIN" → every product of ours, in stock or not (the document view's "live")
  const fams = v.families.map(f => ({ f: { fk: f.fk, brand: f.brand, name: f.name, psku: f.psku, pa: f.pa, solo: false }, kids: APC.stock ? f.live : f.kids, every: f.kids }))
    .concat((v.loose || []).map(c => ({ f: { fk: c.brand + '|L:' + apcId(c), brand: c.brand, name: c.title || c.sku, psku: '', pa: '', solo: true }, kids: [c], every: [c] })));
  fams.forEach(x => x.every.forEach(c => { if (c.asin) all.set(fcKey(c.brand, c.asin), { c, fk: x.f.fk, pa: x.f.pa || '' }); }));
  // OUR listings per brand — the listing cache's products (never a parent ASIN): the only ASINs a document's "on N products" counts.
  // Everything else a document lists (parents, closed listings, ASINs not in our cache) is shown apart as "other ASINs".
  const ours = { SP: new Set(), CPC: new Set() }, parentAsins = { SP: new Set(), CPC: new Set() };
  ['SP', 'CPC'].forEach(b => {
    const list = typeof LM !== 'undefined' && LM.list ? LM.list[b] : null;
    if (list && list.forEach) list.forEach(raw => { if (raw && raw.asin) (raw.lvl === 'parent' ? parentAsins[b] : ours[b]).add(String(raw.asin)); });
  });
  all.forEach(x => { if (ours[x.c.brand]) ours[x.c.brand].add(x.c.asin); });
  fams.forEach(x => { if (x.f.pa && parentAsins[x.f.brand]) parentAsins[x.f.brand].add(x.f.pa); });
  ['SP', 'CPC'].forEach(b => parentAsins[b].forEach(a => ours[b].delete(a)));
  const rows = [];
  const groups = fams.filter(x => x.kids.length).map(x => {
    const g = { f: x.f, rows: [], risk: 0, n: {}, liveDoc: null, nextDoc: null, gap: null };
    g.rows = x.kids.map(c => apcProduct(c, g, ctx));
    g.f.n = g.rows.length;
    // the family's live document: the approved one most of its products are on (then the newest); else the document on its way
    const tally = new Map();
    x.every.forEach(c => {
      const a = c.asin ? lmGetAplus(c.asin, c.brand, x.f.pa || '') : null;
      if (a && a.main) { const t = tally.get(a.main.k) || { d: a.main, n: 0 }; t.n++; tally.set(a.main.k, t); }
    });
    const best = s => [...tally.values()].filter(t => t.d.s === s).sort((p, q) => q.n - p.n || q.d.u - p.d.u || String(p.d.n).localeCompare(String(q.d.n)))[0];
    g.liveDoc = (best('APPROVED') || {}).d || null;
    g.nextDoc = g.liveDoc ? null : ((best('SUBMITTED') || best('DRAFT') || best('REJECTED') || {}).d || null);
    g.rows.sort((a, b) => apcRank(a) - apcRank(b) || (b.sales || 0) - (a.sales || 0) || String(a.c.sku).localeCompare(String(b.c.sku), undefined, { numeric: true }));
    g.rows.forEach(p => {
      p.what = apcWhat(p);
      g.n[p.bucket] = (g.n[p.bucket] || 0) + 1;
      if (APC_FIX.includes(p.bucket)) g.risk += p.sales || 0;
      rows.push(p);
    });
    // a family gap: some of its products have A+, others have none — the exact ASINs to add to the family's live document
    const miss = g.rows.filter(p => p.bucket === 'missing' && p.c.asin);
    if (g.liveDoc && miss.length && !x.f.solo) g.gap = { doc: g.liveDoc, asins: miss.map(p => p.c.asin), risk: miss.reduce((s, p) => s + (p.sales || 0), 0) };
    return g;
  });
  // the most sales without A+ first, then the most to fix, then by name — kept while the data is the same, so a mark never moves a line
  const fixN = g => APC_FIX.reduce((s, k) => s + (g.n[k] || 0), 0);
  const orderKey = [lmV, APC.stock, groups.length, apcSalesAt()].join('|');
  if (!APC.order || APC.orderKey !== orderKey) {
    APC.order = new Map(groups.slice().sort((a, b) => b.risk - a.risk || fixN(b) - fixN(a) || String(a.f.name).localeCompare(String(b.f.name)) || a.f.fk.localeCompare(b.f.fk)).map((g, i) => [g.f.fk, i]));
    APC.orderKey = orderKey;
  }
  groups.sort((a, b) => (APC.order.has(a.f.fk) ? APC.order.get(a.f.fk) : 1e9) - (APC.order.has(b.f.fk) ? APC.order.get(b.f.fk) : 1e9));
  rows.forEach(apcExtra);                              // modules, Brand Story (2 Dec 2026), product details (3 Dec 2026)
  APC.model = { key, src, groups, rows, all, ours, parentAsins, state: ctx.state, salesAt: apcSalesAt(), notes: v.notes || [], now };
  return APC.model;
}
// Does this product belong under the chip? '' = every product; 'fix' = Missing / Rejected / Draft; 'stuck'; else its own status.
const apcRowIn = (p, f) => (!f ? true : f === 'fix' ? APC_FIX.includes(p.bucket) : f === 'stuck' ? p.stuck && p.bucket === 'waiting'
  : f === 'weak' ? !!p.weak : f === 'story' ? !!p.storyOnly : f === 'pd' ? !!(p.pd && p.pd.miss.length) : p.bucket === f);
const apcHit = (p, q) => (p.c.skus || [p.c.sku]).some(x => fcNorm(x).includes(q)) || fcNorm(p.c.asin).includes(q) || (p.doc && fcNorm(p.doc.n).includes(q)) || fcNorm(p.c.title).includes(q);
/** The families the brand, the search and the chip keep, each with the rows they keep ('all' = every row of the family in view). */
function apcGroups(model, f) {
  const q = fcNorm(APC.q);
  const filter = f === undefined ? APC.f : f;
  return model.groups.filter(g => APC.brand === 'ALL' || g.f.brand === APC.brand).map(g => {
    const famHit = q && (fcNorm(g.f.name).includes(q) || fcNorm(g.f.psku).includes(q) || fcNorm(g.f.pa).includes(q));
    const rows = g.rows.filter(p => apcRowIn(p, filter) && (!q || famHit || apcHit(p, q)) && (f !== undefined || !(typeof prOf === 'function') || prKeep('apc', prApc(p))));
    return rows.length ? { f: g.f, g, all: g.rows, rows } : null;
  }).filter(Boolean);
}
const apcCount = (model, k) => apcGroups(model, k).reduce((sum, x) => sum + x.rows.length, 0);
/** "Fix first": Missing / Rejected / Draft as ONE list, the biggest 30-day sales first. */
function apcFixList(model) {
  const idx = new Map(model.groups.map((g, i) => [g.f.fk, i]));
  return apcGroups(model, 'fix').flatMap(x => x.rows).sort((a, b) => (b.sales || 0) - (a.sales || 0) || idx.get(a.g.f.fk) - idx.get(b.g.f.fk) || String(a.c.sku).localeCompare(String(b.c.sku)));
}
/** "Weak A+", "Only Brand Story", "Missing product details" (and "Fix first"): one list, the biggest 30-day sales first. */
function apcFlatList(model, f) {
  if (f === 'fix') return apcFixList(model);
  const idx = new Map(model.groups.map((g, i) => [g.f.fk, i]));
  return apcGroups(model, f).flatMap(x => x.rows).sort((a, b) => (b.sales || 0) - (a.sales || 0) || idx.get(a.g.f.fk) - idx.get(b.g.f.fk) || String(a.c.sku).localeCompare(String(b.c.sku)));
}
/** The rows the By-product screen shows now, in its order — the download's rows too. */
function apcShownRows(model) {
  return APC_FLAT_F.includes(APC.f) ? apcFlatList(model, APC.f) : apcGroups(model).flatMap(x => x.rows);
}
/** The numbers of the top summary, for the brand, the toggle and the search in use. */
function apcSummary(model) {
  const rows = apcGroups(model, '').flatMap(x => x.rows);
  const n = {};
  rows.forEach(p => { n[p.bucket] = (n[p.bucket] || 0) + 1; });
  const counted = rows.length - (n.none || 0);
  const risk = rows.filter(p => APC_FIX.includes(p.bucket)).reduce((s, p) => s + (p.sales || 0), 0);
  const stuck = rows.filter(p => p.stuck && p.bucket === 'waiting').length;
  const brands = APC.brand === 'ALL' ? ['SP', 'CPC'] : [APC.brand];
  // (2 Dec 2026) live WITH PRODUCT A+: a live product whose product A+ document's modules are read and it is not only a Brand Story
  const prodLive = rows.filter(p => p.bucket === 'live' && p.make && p.make.m).length;
  const prodUnknown = rows.filter(p => p.bucket === 'live' && p.make && !p.make.m && !p.storyOnly).length;
  const storyDocs = brands.flatMap(b => lmAplusDocs(b)).filter(d => apcIsStory(apcModsOf(d))).length;
  return { rows, n, total: rows.length, counted, live: n.live || 0, pct: counted ? Math.round((n.live || 0) / counted * 100) : 0, risk, stuck, salesKnown: !!model.salesAt,
    conv: brands.map(b => apcConv(rows, b)).filter(Boolean), brands, prodLive, prodUnknown, storyDocs };
}

/* ----- the documents (By A+ document) ----- */
/** Every A+ document of the brand in view: { d, st, stuck, oldDraft, on (attached ASINs; null = unknown), ours (our products on it), liveN,
 *  unused (on no live product of ours), add (ASINs of its families still without A+), addRisk, fams }. */
function apcDocs(model) {
  const now = model.now;
  const byDoc = new Map();
  model.all.forEach(x => {
    const a = lmGetAplus(x.c.asin, x.c.brand, x.pa);
    if (!a) return;
    a.docs.forEach(d => { if (!byDoc.has(d.k)) byDoc.set(d.k, []); byDoc.get(d.k).push(x.c); });
  });
  const gapOf = new Map();
  model.groups.forEach(g => { if (g.gap) { const k = g.gap.doc.brand + '|' + g.gap.doc.k; if (!gapOf.has(k)) gapOf.set(k, []); gapOf.get(k).push(g); } });
  const q = fcNorm(APC.q);
  return lmAplusDocs(APC.brand === 'ALL' ? undefined : APC.brand).map(d => {
    const st = apcStatusOf(d.s), ours = byDoc.get(d.k) || [], gaps = gapOf.get(d.brand + '|' + d.k) || [];
    const add = gaps.flatMap(g => g.gap.asins);
    // "on N products": our listings only — the ASINs on it that are ours, and our products it covers through their parent ASIN
    const mine = model.ours[d.brand] || new Set(), pas = model.parentAsins[d.brand] || new Set();
    const onOurs = d.a === null ? null : [...new Set(d.a.filter(a => mine.has(a)).concat(ours.map(c => c.asin)))];
    const extra = d.a === null ? [] : [...new Set(d.a.filter(a => !mine.has(a)))].map(a => ({ asin: a, parent: pas.has(a) }));
    const m = apcModsOf(d), story = apcIsStory(m);                    // its modules (2 Dec 2026): null = not read yet
    return { d, st, stuck: st === 'waiting' && d.u > 0 && now - d.u > APC_STUCK_DAYS * APC_DAY, oldDraft: st === 'draft' && d.u > 0 && now - d.u > APC_OLD_DRAFT_DAYS * APC_DAY,
      on: d.a, onOurs, extra, ours, liveN: ours.filter(c => c.live).length, unused: !ours.some(c => c.live), add, addRisk: gaps.reduce((s, g) => s + g.gap.risk, 0), fams: gaps.map(g => g.f.name),
      m, story, vs: m && !story ? apcVsStd(m) : null };
  }).filter(x => !q || fcNorm(x.d.n).includes(q) || (x.d.a || []).some(a => fcNorm(a).includes(q)) || x.ours.some(c => fcNorm(c.sku).includes(q)))
    .sort((a, b) => b.addRisk - a.addRisk || b.add.length - a.add.length || b.liveN - a.liveN || String(a.d.n).localeCompare(String(b.d.n)) || a.d.k.localeCompare(b.d.k));
}
const apcDocIn = (x, f) => (!f ? true : f === 'add' ? x.add.length > 0 : f === 'unused' ? x.unused : f === 'stuck' ? x.stuck
  : f === 'weak' ? !!(x.vs && x.vs.weak) : f === 'story' ? !!x.story : x.st === f);
const apcDocNote = x => [x.unused ? 'Not on any live product' : '', x.stuck ? `Stuck in review since ${apcDate(x.d.u)} — contact Seller Support` : '', x.oldDraft ? `Forgotten draft (not touched since ${apcDate(x.d.u)})` : '',
  x.on === null ? 'Its product list could not be read' : x.d.as ? 'Its product list is from an older read' : ''].filter(Boolean).join(' · ');

/* ----- SCREEN = DOWNLOAD: one row's words, used by the table and by the CSV ----- */
const apcTime = brand => { const st = lmAplusState(brand); return st.atText ? st.atText + (st.old || st.stale ? ' (old)' : '') : 'not read'; };
/** One product row in words: what the screen shows and the sheet holds. */
function apcRowView(p) {
  const c = p.c, d = p.doc;
  const status = p.bucket === 'waiting' && p.stuck ? 'Stuck' : APC_ST[p.bucket].t;
  return { brand: fcBrandName(c.brand), family: p.g.f.solo ? '' : String(p.g.f.name || ''), sku: (c.skus || [c.sku]).join(' / '), asin: c.asin || '', stock: c.stock == null ? '' : c.stock,
    sales: p.sales, status, doc: d ? d.n || 'unnamed document' : '', type: d ? d.t || '' : '', updated: d && d.u ? apcDate(d.u) : '', reason: p.reasons.join('; '),
    what: p.what, link: c.asin ? 'https://www.amazon.com/dp/' + c.asin : '', time: apcTime(c.brand),
    // (2 Dec 2026) modules; (3 Dec 2026) product details
    mods: !p.make ? '' : p.storyOnly ? 'Only Brand Story — no product A+' : p.make.m ? p.make.vs.plain : 'not read yet', modTypes: p.make && p.make.m ? p.make.vs.tip : '',
    plan: p.make && p.make.d ? p.make.d.t || '' : '', story: p.storyOnly ? 'yes' : '', modAt: p.make && p.make.m ? apcDate(p.make.m.at) + (p.make.m.src === 'daily' ? ' (daily read)' : ' (this browser)') : '',
    pd: !p.pd || !p.pd.known ? 'not read' : `${p.pd.n} of ${p.pd.of}`, pdMiss: p.pd && p.pd.known ? p.pd.miss.join(', ') : '' };
}
// (2–3 Dec 2026) the modules and product-details columns go before Priority: every earlier column stays where it was, Priority stays last
const APC_CSV_COLS = ['Brand', 'Family', 'SKU', 'ASIN', 'Stock', '30-day sales', 'A+ status', 'Document name', 'Type', 'Last updated', "Amazon's reason", 'What to do', 'Amazon link', 'Data time',
  'Modules', 'Module types', 'Basic / Premium', 'Only Brand Story', 'Modules read', 'Product details filled', 'Missing attributes', 'Priority'];
const apcCsvQ = val => { const s = String(val == null ? '' : val); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** The products' sheet: the rows on the screen (view, toggle, brand, chip, search), Excel-ready (UTF-8 BOM, CRLF). */
function apcCsv(model) {
  const shown = apcShownRows(model || apcBuild());
  const rows = shown.map(apcRowView);
  const lines = rows.map((r, i) => [r.brand, r.family, r.sku, r.asin, r.stock, r.sales == null ? '' : (Math.round(r.sales * 100) / 100).toFixed(2), r.status, r.doc, r.type, r.updated, r.reason, r.what, r.link, r.time,
    r.mods, r.modTypes, r.plan, r.story, r.modAt, r.pd, r.pdMiss, typeof prOf === 'function' && PR_APC[shown[i].bucket] ? prCsv(prApc(shown[i])) : ''].map(apcCsvQ).join(','));
  return { n: lines.length, rows, text: '﻿' + [APC_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
/** One document card in words. */
function apcDocView(x) {
  const d = x.d;
  return { brand: fcBrandName(d.brand), name: d.n || 'unnamed document', status: x.stuck ? 'Stuck' : APC_ST[x.st].t + (x.st === 'unchecked' && d.s ? ' (' + d.s + ')' : ''), type: d.t || '', updated: d.u ? apcDate(d.u) : '',
    on: x.onOurs === null ? '' : x.onOurs.length, extra: x.on === null ? '' : x.extra.length, liveN: x.liveN, add: x.add.join(' '), note: apcDocNote(x), reason: (d.rr || []).join('; '), time: apcTime(d.brand),
    // (2 Dec 2026) its modules
    mods: x.m ? (x.vs ? x.vs.plain : apcModsText(x.m)) : 'not read yet', modTypes: x.m ? (x.vs ? x.vs.tip : `${x.m.n} on Amazon: ${(x.m.ty || []).join(', ')}`) : '', vs: x.story ? 'Brand Story (not product A+)' : x.vs ? x.vs.plain : '', story: x.story ? 'yes' : '',
    modAt: x.m ? apcDate(x.m.at) + (x.m.src === 'daily' ? ' (daily read)' : ' (this browser)') : '' };
}
const APC_DOC_COLS = ['Brand', 'Document', 'Status', 'Type', 'Last updated', 'Products on it', 'Other ASINs on it (parents / closed / not in our listings)', 'Live products on it', 'ASINs to add', 'Note', "Amazon's reason", 'Data time',
  'Modules', 'Module types', 'Against the standard', 'Brand Story', 'Modules read'];
const apcDocsShown = model => apcDocs(model).filter(x => apcDocIn(x, APC.f));
function apcDocsCsv(model) {
  const rows = apcDocsShown(model || apcBuild()).map(apcDocView);
  const lines = rows.map(r => [r.brand, r.name, r.status, r.type, r.updated, r.on, r.extra, r.liveN, r.add, r.note, r.reason, r.time, r.mods, r.modTypes, r.vs, r.story, r.modAt].map(apcCsvQ).join(','));
  return { n: lines.length, rows, text: '﻿' + [APC_DOC_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function apcDownload(docs) {
  const out = docs ? apcDocsCsv() : apcCsv();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sellora-aplus-${docs ? 'documents' : 'products'}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}

/* ----- drawing ----- */
function apcShell() {
  const box = $('apcPane');
  if (!box || APC.built) return;
  const seg = [['prod', 'By product'], ['doc', 'By A+ document']].map(([k, t]) => `<button type="button" class="segbtn${APC.view === k ? ' on' : ''}" data-apc="view" data-apc-v="${k}" aria-pressed="${APC.view === k}">${t}</button>`).join('');
  box.innerHTML = `<div class="card fc-tb apc-tb" id="apcTb"><div class="toolbar"><div class="seg" role="group" aria-label="Which view">${seg}</div>`
    + `<select data-apc-f="brand" aria-label="Brand"><option value="ALL">Both brands</option><option value="SP">${fcEsc(fcBrandName('SP'))}</option><option value="CPC">${fcEsc(fcBrandName('CPC'))}</option></select>`
    + `<label class="apc-tog" title="On: only products that are buyable and have stock. Off: every product of the families, in stock or not."><input type="checkbox" data-apc-f="stock"${APC.stock ? ' checked' : ''}> Stock &gt; 0 only</label>`
    + `<input type="search" class="cc-q" data-apc-f="q" placeholder="Search SKU, ASIN, family or document" aria-label="Search" value="${fcEsc(APC.q)}">`
    + `<span style="flex:1"></span><span id="apcTools"></span>`
    + `<a class="ghost apc-link" href="${APC_MANAGER}" target="_blank" rel="noopener" title="Seller Central's A+ Content Manager, in a new tab">Open A+ Content Manager ↗</a></div>`
    + `</div><div class="fc-meta muted apc-meta" id="apcMeta"></div><div id="apcBody"></div><div id="apcSide"></div>`;
  const sel = box.querySelector ? box.querySelector('[data-apc-f="brand"]') : null;
  if (sel) sel.value = APC.brand;
  APC.built = true;
}
// The buttons that belong to the view: Open all / Close all and the download.
function apcToolsHtml() {
  // (2 Dec 2026) the modules: read them now (read-only), and the standard they are judged against
  const run = APC.modRead;
  const mods = (run && run.busy ? `<button type="button" class="ghost" data-apc="modstop">Stop reading modules (${fcNf(run.done)} of ${fcNf(run.total)})</button>`
    : '<button type="button" class="ghost" data-apc="modread" title="Reads each A+ document\'s modules from Amazon now — read-only, the same read as Preview A+ — and keeps them in this browser">Read modules now</button>')
    + `<button type="button" class="ghost" data-apc="stdopen" aria-pressed="${APC.setOpen}" title="How many modules a complete product A+ has, and which ones (shared with the team)">⚙ A+ standard</button>`;
  return mods + (APC.view === 'doc' ? '<button type="button" class="ghost" data-apc="csvdocs" title="The document cards in view, as a sheet">⬇ Download documents</button>'
    : (APC_FLAT_F.includes(APC.f) ? '' : '<button type="button" class="ghost" data-apc="openall">Open all</button><button type="button" class="ghost" data-apc="closeall">Close all</button>')
      + '<button type="button" class="ghost" data-apc="csv" title="The rows in view (toggle, brand, chip and search), as a sheet">⬇ Download</button>');
}
// The modules' line of the meta: when they were read and for how many documents — or "not read yet" (never guessed).
function apcModMetaHtml(brands) {
  const parts = brands.map(b => {
    const docs = lmAplusDocs(b);
    if (!docs.length) return '';
    const ms = docs.map(apcModsOf).filter(Boolean);
    const name = fcEsc(fcBrandName(b));
    if (!ms.length) return `<span class="fc-old">${name}: modules not read yet</span>`;
    const daily = ms.some(m => m.src === 'daily'), browser = ms.some(m => m.src === 'browser');
    return `<span>${name}: modules read ${fcEsc(apcDate(Math.max(...ms.map(m => m.at))))} for ${fcNf(ms.length)} of ${fcNf(docs.length)} documents`
      + ` (${[daily ? 'daily read' : '', browser ? 'this browser' : ''].filter(Boolean).join(' + ')})</span>`;
  }).filter(Boolean);
  const run = APC.modRead;
  const prog = run && run.busy ? ` · reading modules… ${fcNf(run.done)} of ${fcNf(run.total)}` : run && run.total ? ` · last “Read modules now”: ${fcNf(run.done - run.fail)} read${run.fail ? `, ${fcNf(run.fail)} failed (${fcEsc(run.err)})` : ''}` : run ? ' · every document\'s modules were read in the last day' : '';
  return parts.length || prog ? `<div>A+ modules: ${parts.join(' · ')}${prog}</div>` : '';
}
function apcMetaHtml(model) {
  const label = typeof lmDataLabel === 'function' ? lmDataLabel(APC.brand === 'ALL' ? ['SP', 'CPC'] : [APC.brand]) : null;
  const brands = APC.brand === 'ALL' ? ['SP', 'CPC'] : [APC.brand];
  const ap = brands.map(b => {
    const st = model.state[b];
    if (!st.has) return `<span class="fc-old">${fcEsc(fcBrandName(b))}: A+ not checked — ${fcEsc(st.why)}</span>`;
    const old = st.old || st.stale;
    return `<span${old ? ' class="fc-old"' : ''}>${fcEsc(fcBrandName(b))}: A+ read ${fcEsc(st.atText)} (${fcNf(st.docs)} documents)`
      + (old ? ` — old data${st.err ? ': the last read failed (' + fcEsc(st.err) + ')' : ''}; the last good read is shown` : '') + (st.partial ? ` · ${fcNf(st.partial)} document(s) without a product list` : '') + '</span>';
  }).join(' · ');
  return `<div>Amazon data: ${label ? fcEsc(label.text) : 'this screen reads the saved copy only'} · ${ap} · A+ is read once a day after the ${typeof lmHour === 'function' ? lmHour(LM_APLUS_AT) : '13:00'} refresh</div>`
    + (model.salesAt ? `<div>30-day sales as at ${fcEsc(model.salesAt)} (Listing Audit → Pull sales)</div>` : '<div class="fc-old">30-day sales not pulled yet — Listing Audit → Pull sales. Products are still listed; the money columns stay empty.</div>')
    + apcModMetaHtml(brands)
    + model.notes.map(n => `<div>${fcEsc(n)}</div>`).join('') + (APC.okNote ? `<div class="fc-oknote">${fcEsc(APC.okNote)}</div>` : '') + (APC.err ? `<div class="fc-oknote">${fcEsc(APC.err)}</div>` : '');
}
/** The one-glance summary: the coverage bar, the sales without A+, and (when the data has it) how A+ converts. */
function apcSummaryHtml(s) {
  const seg = APC_BAR.map(k => { const n = s.n[k] || 0; return n ? `<i class="is-${APC_ST[k].cls} k-${k}" style="flex:${n} 1 0" title="${fcEsc(APC_ST[k].t)}: ${fcNf(n)}"></i>` : ''; }).join('');
  const key = APC_BAR.filter(k => s.n[k]).map(k => `<span><i class="is-${APC_ST[k].cls} k-${k}"></i>${fcEsc(APC_ST[k].t)} ${fcNf(s.n[k])}</span>`).join('');
  // (2 Dec 2026) the second line: live with PRODUCT A+ (a Brand Story alone is not product A+), and what is not known yet
  const cov2 = `<div class="apc-cov2">with product A+: <b>${fcNf(s.prodLive)} of ${fcNf(s.counted)}</b>`
    + (s.prodUnknown ? ` <span class="muted">· ${fcNf(s.prodUnknown)} not known yet (modules not read)</span>` : '')
    + (s.storyDocs ? ` <span class="muted">· ${fcNf(s.storyDocs)} Brand Story document${s.storyDocs === 1 ? '' : 's'}, counted apart</span>` : '') + '</div>';
  const cover = `<div class="apc-cov"><b>Live on ${fcNf(s.live)} of ${fcNf(s.counted)} products (${s.pct}%)</b>${cov2}`
    + `<div class="apc-bar" role="img" aria-label="A+ coverage: ${APC_BAR.map(k => APC_ST[k].t + ' ' + (s.n[k] || 0)).join(', ')}">${seg || '<i class="is-g" style="flex:1"></i>'}</div><div class="apc-key">${key}`
    + `${s.n.none ? `<span class="muted">${fcNf(s.n.none)} marked “No A+ needed” (not counted)</span>` : ''}</div></div>`;
  const old = s.salesKnown ? apcSalesOld() : '';
  const risk = `<div class="apc-risk" title="The 30-day sales of the products that are Missing, Rejected or Draft — the money that sells without A+."><span>Sales without A+ (30 days)</span>`
    + (old ? `<em class="apc-sold">Sales from ${fcEsc(old)} — old. Press Listing Audit → Pull sales</em>` : '')
    + `<b>${s.salesKnown ? apcMoney(s.risk) : '—'}</b><small>${s.salesKnown ? `${fcNf(APC_FIX.reduce((n, k) => n + (s.n[k] || 0), 0))} products: Missing + Rejected + Draft` : 'sales not pulled yet'}</small></div>`;
  const conv = s.conv.map(c => `<div class="apc-conv" title="Units ÷ sessions over the last 4 weeks of the weekly store, for ${fcNf(c.nYes)} products with A+ and ${fcNf(c.nNo)} without.">${fcEsc(fcBrandName(c.brand))}: products with A+ convert <b>${(c.yes * 100).toFixed(1)}%</b> vs <b>${(c.no * 100).toFixed(1)}%</b> without</div>`).join('');
  return `<div class="card apc-sum">${cover}${risk}${conv ? `<div class="apc-convs">${conv}</div>` : ''}</div>`;
}
function apcCardsHtml(model, s) {
  const box = k => { const st = APC_ST[k]; const n = apcCount(model, k); return `<button type="button" class="fc-box apc-box is-${st.cls}${APC.f === k ? ' is-on' : ''}" data-apc="f" data-apc-v="${k}" aria-pressed="${APC.f === k}" title="${fcEsc(st.tip)}">`
    + `<span>${fcEsc(st.t)}</span><b>${fcNf(n)}</b><small>${fcEsc(st.one)}</small></button>`; };
  const chip = (k, t, n) => `<button type="button" class="cc-fchip${APC.f === k ? ' is-on' : ''}" data-apc="chip" data-apc-v="${k}" aria-pressed="${APC.f === k}">${fcEsc(t)}${n == null ? '' : ` <b>${fcNf(n)}</b>`}</button>`;
  const chips = [chip('', 'All'), chip('fix', 'Fix first', apcCount(model, 'fix'))].concat(['missing', 'rejected', 'draft', 'waiting'].map(k => chip(k, APC_ST[k].t, apcCount(model, k))),
    [chip('stuck', 'Stuck', apcCount(model, 'stuck')), chip('live', 'Live', apcCount(model, 'live')), chip('none', 'No A+ needed', apcCount(model, 'none'))],
    s.n.unchecked || APC.f === 'unchecked' ? [chip('unchecked', 'Not checked', apcCount(model, 'unchecked'))] : []).join('')
    + [chip('weak', 'Weak A+', apcCount(model, 'weak')), chip('story', 'Only Brand Story', apcCount(model, 'story')), chip('pd', 'Missing product details', apcCount(model, 'pd'))].join('')
    + (typeof prOf === 'function' ? prFilterHtml('apc', (k, label, on) => `<button type="button" class="cc-fchip${on ? ' is-on' : ''}" data-apc="prf" data-apc-v="${k}" aria-pressed="${on}">${label}</button>`) : '');
  return `<div class="fc-boxes">${APC_CARDS.map(box).join('')}</div><div class="cc-chips" role="group" aria-label="Show">${chips}</div>`;
}
function apcPicHtml(c) {
  const rec = c.asin && typeof lmGetAsin === 'function' ? lmGetAsin(c.asin, c.brand) : null;
  const u = rec && rec.img && rec.img.MAIN && rec.img.MAIN.u ? String(rec.img.MAIN.u) : '';
  const url = u ? (typeof imThumb === 'function' ? imThumb(u) : u) : '';
  return url ? `<img class="cc-pic" src="${fcEsc(url)}" alt="" loading="lazy" decoding="async" width="36" height="36">` : '<span class="cc-pic is-none" aria-hidden="true"></span>';
}
// The status chip of a row (with "Stuck" / "Forgotten draft" beside it when they apply).
function apcStatusHtml(p) {
  if (p.bucket === 'none') return apcChip('none') + (p.st !== 'unchecked' ? ` <small class="muted">was ${fcEsc(APC_ST[p.st].t)}</small>` : '');
  return apcChip(p.bucket, p.bucket === 'live' ? '✓ Live' : undefined) + (p.stuck ? ' <span class="fc-chip is-y">Stuck</span>' : '') + (p.oldDraft ? ' <span class="fc-chip is-y">Forgotten draft</span>' : '')
    + (p.via === 'parent' ? ' <small class="muted" title="The document is attached to the parent ASIN, which covers its children">via parent</small>' : '')
    + (p.storyOnly ? ' <span class="fc-chip is-y apc-storyc" title="Its only A+ is a Brand Story: the product\'s own A+ section is empty">Only Brand Story — no product A+</span>' : '');
}
// (2 Dec 2026) the Modules cell: "2 of 5 · missing: …" / "5 of 5 · complete", Basic / Premium — or "not read yet"
function apcModCellHtml(p) {
  const mk = p.make;
  if (!mk) return '<span class="fc-none">—</span>';
  if (p.storyOnly) return '<span class="muted">Brand Story only</span>';
  if (!mk.m) return '<span class="fc-none" title="Press “Read modules now” (top right)">not read yet</span>';
  return `<span class="apc-mc ${mk.vs.complete ? 'is-ok' : 'is-y'}" title="${fcEsc(mk.vs.tip)}">${fcEsc(mk.vs.text)}</span>${mk.d && mk.d.t ? ` <small class="muted">${fcEsc(mk.d.t)}</small>` : ''}`;
}
// (3 Dec 2026) the Product details cell: ONE short line "✅ 12/12" / "⚠️ 9/12" / "❌ 4/12" — the missing names in the tooltip; a click opens the panel
function apcPdHtml(p) {
  const pd = p.pd;
  if (!pd || !pd.known) return `<button type="button" class="apc-pdb is-g" data-apc="pd" data-apc-v="${fcEsc(p.key)}" title="Its attributes are not in the listing cache yet — click to read them from Amazon">not read</button>`;
  if (!pd.of) return `<button type="button" class="apc-pdb is-g" data-apc="pd" data-apc-v="${fcEsc(p.key)}" title="No attribute Sellora reads for it is counted — open to see">—</button>`;
  const tip = pd.miss.length ? 'Missing: ' + pd.miss.join(', ') : 'Every product detail counted is filled';
  return `<button type="button" class="apc-pdb is-${pd.n === pd.of ? 'ok' : pd.n * 2 >= pd.of ? 'y' : 'r'}" data-apc="pd" data-apc-v="${fcEsc(p.key)}" title="${fcEsc(tip)}${pd.live ? ' (read from Amazon this session)' : ''} — click for the details">${apcPdMark(pd)} ${pd.n}/${pd.of}</button>`;
}
/** THE PRODUCT DETAILS PANEL (3 Dec 2026): on the right (a bottom sheet on a phone), the Listing Workspace panel's look; Esc / ✕ close it.
 *  Its header (SKU, title, "⚠️ 9 of 12 filled · 3 missing", Open in Listing Workspace) and Amazon's Product information sections, each a
 *  table: the attribute, its value as Sellora holds it, ✅ filled / ❌ missing / not read / not for this product type. */
function apcSideHtml(model) {
  if (!APC.pd) return '';
  const p = model.rows.find(r => r.key === APC.pd);
  if (!p) { APC.pd = ''; return ''; }
  const pd = p.pd, c = p.c;
  const head = `<div class="apc-side-h"><div class="apc-side-t"><b title="${fcEsc(c.title || '')}">${fcEsc((c.skus || [c.sku]).join(' / '))}</b><span>${fcEsc(String(c.title || '').slice(0, 140))}</span></div>`
    + '<button type="button" class="apc-x" data-apc="pdclose" aria-label="Close">×</button></div>';
  // (4 Dec 2026) the panel shows the live read only: reading → "Reading from Amazon…"; failed → "Couldn't read from Amazon — try again" (no ❌)
  const lv = APC.pdLive.get(c.brand + '|' + c.sku) || { st: 'reading' };
  const sum = lv.st === 'reading' ? '<span class="apc-pdmsg" role="status">Reading from Amazon…</span>'
    : lv.st === 'err' ? `<span class="apc-pdmsg is-r" role="alert" title="${fcEsc(lv.err || '')}">Couldn't read from Amazon — <button type="button" class="linkbtn apc-pdretry" data-apc="pdread" data-apc-v="${fcEsc(p.key)}">try again</button></span>`
      : `<b class="apc-pds is-${!pd.of ? 'g' : pd.n === pd.of ? 'ok' : pd.n * 2 >= pd.of ? 'y' : 'r'}">${apcPdMark(pd)} ${pd.n} of ${pd.of} filled${pd.miss.length ? ` · ${pd.miss.length} missing` : ''}</b>`;
  const acts = `<div class="apc-side-a">${sum}<button type="button" class="ghost fc-b" data-apc="pdws" data-apc-b="${fcEsc(c.brand)}" data-apc-v="${fcEsc(p.g.f.pa || c.asin || '')}" title="Opens Listing Health's Workspace on this family">Open in Listing Workspace ↗</button></div>`;
  const stWord = { ok: '<span class="apc-pdok">✅ filled</span>', miss: '<span class="apc-pdno">❌ missing</span>', na: '<span class="fc-none">not for this product type</span>' };
  const live = lv.st === 'ok' && pd.live;
  const secs = live ? APC_PD_SECT.filter(([k]) => pd.rows.some(r => r.sec === k)).map(([k, t]) => `<section class="apc-pdsec" data-apc-sec="${k}"><h4>${fcEsc(t)}</h4><table class="apc-pdt"><tbody>`
    + pd.rows.filter(r => r.sec === k).map(r => `<tr class="is-${r.st}${r.counted || r.sec === 'other' ? '' : ' is-off'}"><th scope="row">${fcEsc(r.label)}</th><td>${r.value ? fcEsc(r.value) : '<span class="fc-none">—</span>'}</td><td>${stWord[r.st]}</td></tr>`).join('')
    + '</tbody></table></section>').join('') : '';
  const at = live && pd.at ? new Date(pd.at) : null;
  const foot = live ? `<p class="muted apc-side-f">Read live from Amazon${at ? ' at ' + fcEsc(at.toTimeString().slice(0, 5)) : ''} (kept for this session)${pd.pt ? ' · product type ' + fcEsc(pd.pt) : ''}. ❌ = our listing has no value. Counted: the attributes ticked in ⚙ A+ standard that exist for this product type; "Other" is shown, not counted. <button type="button" class="linkbtn" data-apc="pdread" data-apc-v="${fcEsc(p.key)}">Read again</button></p>` : '';
  return `<aside class="apc-side" role="dialog" aria-label="Product details of ${fcEsc(c.sku)}">${head}${acts}<div class="apc-side-b">${secs}${foot}</div></aside>`;
}
function apcSideDraw() {
  const box = typeof $ === 'function' ? $('apcSide') : null;
  if (box) box.innerHTML = apcSideHtml(apcBuild());
}
/** Esc closes the panel (a key the page passes here). */
function apcKey(e) {
  if (!APC.pd || !e || e.key !== 'Escape') return false;
  if (typeof sqIsOpen === 'function' && sqIsOpen()) return false;
  APC.pd = '';
  apcSideDraw();
  return true;
}
// "Open in Listing Workspace ↗": Listing Health's Workspace on this family (as the BSR Audit opens it).
function apcOpenWs(brand, parent) {
  if (typeof showTab === 'function') showTab('health');
  if (typeof liWsOn === 'function' && typeof LI_WS !== 'undefined' && !LI_WS.on) liWsOn();
  setTimeout(() => {
    if (typeof liWsPanelOpen === 'function' && typeof LI_WS !== 'undefined' && LI_WS.byKey && LI_WS.byKey.has(brand + '|' + parent)) liWsPanelOpen(brand + '|' + parent);
    else if (typeof hFocusOpen === 'function') hFocusOpen(brand, parent);
  }, 400);
}
/** One product row. `flat`: the "Fix first" list (rank and family shown, no tick column difference). */
function apcRowHtml(p, flat, rank) {
  const c = p.c, r = apcRowView(p);
  const a = `data-apc-b="${fcEsc(c.brand)}" data-apc-s="${fcEsc(apcId(c))}"`;
  const canMark = p.bucket !== 'live' && p.bucket !== 'none';
  const tick = canMark ? `<input type="checkbox" class="fc-tick" data-apc="tick" ${a}${APC.sel.has(p.key) ? ' checked' : ''} aria-label="Tick ${fcEsc(c.sku)}">` : '';
  const amz = c.asin ? `<a href="${fcEsc(r.link)}" target="_blank" rel="noopener" title="Open on Amazon in a new tab">${fcEsc(c.asin)}</a>` : '—';
  const pk = p.doc ? fcKey(c.brand, p.doc.k) : '';
  const acts = (canMark ? `<button type="button" class="ghost fc-b" data-apc="ok" ${a} title="This product does not need A+: it leaves the errors for good (Undo brings it back)">No A+ needed</button>` : '')
    + (p.bucket === 'none' ? `<button type="button" class="ghost fc-b" data-apc="undo" ${a}>Undo</button>` : '')
    + (p.doc ? `<button type="button" class="ghost fc-b" data-apc="prev" data-apc-v="${fcEsc(pk)}" data-apc-at="${fcEsc(p.key)}" title="Reads this one document from Amazon now and shows what is in it">Preview A+</button>` : '')
    + ((p.bucket === 'missing' || p.bucket === 'draft') && typeof aiOn === 'function' && aiOn() ? aiBtnHtml('aplus_text', c.brand, c.sku, { use: 'copy', place: 'row', asin: c.asin || '', label: 'Draft A+ text' }) : '');
  const side = APC_ST[p.bucket].cls === 'r' ? ' is-orphan' : APC_ST[p.bucket].cls === 'y' || p.stuck ? ' cc-chk' : '';
  const more = p.docs.length > 1 ? ` <small class="muted" title="${fcEsc(p.docs.map(d => (d.n || 'unnamed') + ' — ' + d.s).join('\n'))}">+${p.docs.length - 1} more</small>` : '';
  const row = `<tr class="fc-row apc-row${side}${APC.sel.has(p.key) ? ' is-sel' : ''}" data-apc-row="${fcEsc(p.key)}"><td class="fc-tk">${flat ? `<small class="muted apc-rank">${rank}</small>` : ''}${tick}</td><td class="cc-pc">${apcPicHtml(c)}</td>`
    + `<td class="fc-sku"><b>${fcEsc(r.sku)}</b>${typeof lmOldHtml === 'function' ? lmOldHtml(c.brand, c.sku) : ''}<small>${fcEsc(flat ? (r.family || String(c.title || '')).slice(0, 70) : String(c.title || '').slice(0, 70))}</small></td>`
    + `<td class="ui-mono">${amz}</td><td class="apc-st">${apcStatusHtml(p)}${typeof prOf === 'function' && PR_APC[p.bucket] ? ' ' + prChipHtml(prApc(p), 'fc-chip') : ''}</td>`
    + `<td class="apc-doc">${p.doc ? fcEsc(r.doc) + more : '<span class="fc-none">—</span>'}</td><td>${r.type ? fcEsc(r.type) : '<span class="fc-none">—</span>'}</td><td class="apc-upd">${r.updated ? fcEsc(r.updated) : '<span class="fc-none">—</span>'}</td>`
    + `<td class="apc-modc">${apcModCellHtml(p)}</td><td class="apc-pdc">${apcPdHtml(p)}</td>`
    + `<td class="num">${p.sales == null ? '<span class="fc-none">—</span>' : apcMoney(p.sales)}</td>`
    + `<td class="fc-prob apc-what"><div class="apc-do is-${APC_ST[p.bucket].cls}">${fcEsc(r.what)}</div></td>`
    + `<td class="fc-acts">${acts}</td></tr>`;
  return row + (APC.prevOpen === p.key && p.doc ? `<tr class="apc-prevr"><td colspan="${APC_COLS}">${apcPrevHtml(pk)}</td></tr>` : '');
}
const APC_COLHEAD = '<tr class="fc-colh"><th class="fc-tk"></th><th></th><th>SKU</th><th>ASIN</th><th>A+ status</th><th>Document</th><th>Type</th><th>Last updated</th><th>Modules</th><th>Product details</th><th class="num">30-day sales</th><th>What to do</th><th></th></tr>';
/** One family: a single line while closed (its coverage and its badges); open, the column header and its products. */
function apcGroupHtml(x) {
  const g = x.g, f = g.f, open = APC.open.has(f.fk);
  const live = g.n.live || 0, counted = g.rows.length - (g.n.none || 0);
  const badge = (k, word) => (g.n[k] ? `<span class="fc-chip is-${APC_ST[k].cls}">${fcNf(g.n[k])} ${word}</span>` : '');
  const stuck = g.rows.filter(p => p.stuck && p.bucket === 'waiting').length;
  const badges = badge('missing', 'missing') + badge('rejected', 'rejected') + badge('draft', 'draft') + badge('waiting', 'waiting') + (stuck ? `<span class="fc-chip is-y">${fcNf(stuck)} stuck</span>` : '')
    + badge('unchecked', 'not checked') + (g.n.none ? `<span class="fc-chip is-g">${fcNf(g.n.none)} no A+ needed</span>` : '') + (g.gap ? '<span class="fc-chip is-r apc-gapc" title="Some products of this family have A+ and others have none">Family gap</span>' : '');
  const mods = g.rows.filter(p => p.make && p.make.m);                          // (2 Dec 2026) the family's modules on average
  // capped at the standard like each product (3 Dec 2026): 7 modules count as 5
  const avg = mods.length ? `<span class="apc-avg" title="The product A+ of ${fcNf(mods.length)} of its products, modules read (each counted up to ${fcNf(APC.std.n)})">avg ${(mods.reduce((s, p) => s + p.make.vs.shown, 0) / mods.length).toFixed(1).replace(/\.0$/, '')} of ${fcNf(APC.std.n)} modules</span>` : '';
  // (3 Dec 2026) the family's product details: "product details 86% filled" — each product's filled ÷ its OWN total, averaged, a whole
  // number (never a decimal denominator: products read live count 20 attributes, the others 14); 100% only when every one is complete
  const pds = g.rows.filter(p => p.pd && p.pd.known && p.pd.of);
  const pdAvg = pds.length ? (() => { const r = pds.reduce((s, p) => s + p.pd.n / p.pd.of, 0) / pds.length, all = pds.every(p => p.pd.n === p.pd.of);
    const pct = all ? 100 : Math.min(99, Math.round(r * 100));
    return `<span class="apc-avg" title="Product details filled: each product's filled ÷ its own total, averaged over ${fcNf(pds.length)} of its products">product details ${pct}% filled</span>`; })() : '';
  const mini = `<span class="apc-mini" title="${fcNf(live)} of ${fcNf(counted)} have A+ live"><span class="apc-minib"><i style="width:${counted ? Math.round(live / counted * 100) : 0}%"></i></span>${fcNf(live)} of ${fcNf(counted)} have A+</span>${avg}${pdAvg}`;
  const markable = x.rows.filter(p => p.bucket !== 'live' && p.bucket !== 'none').map(p => p.key);
  const allOn = markable.length && markable.every(k => APC.sel.has(k));
  const selAll = open && markable.length ? ` <button type="button" class="ghost fc-b fc-selall" data-apc="selfam" data-apc-v="${fcEsc(f.fk)}">${allOn ? 'Clear this family' : 'Select all in family'}</button>` : '';
  const gap = open && g.gap ? `<tr class="apc-gapr"><td colspan="${APC_COLS}"><div class="apc-gap"><b>Family gap:</b> ${fcNf(g.gap.asins.length)} product${g.gap.asins.length === 1 ? '' : 's'} of this family ${g.gap.asins.length === 1 ? 'has' : 'have'} no A+ while the others are on “${fcEsc(g.gap.doc.n || 'unnamed document')}”. `
    + `Add ${g.gap.asins.length === 1 ? 'this ASIN' : 'these ASINs'} to that document: <span class="ui-mono">${apcAsinsHtml(g.gap.asins)}</span> `
    + `<button type="button" class="ghost fc-b" data-apc="copy" data-apc-v="${fcEsc(g.gap.asins.join(' '))}" data-apc-id="gap:${fcEsc(f.fk)}">${APC.copied === 'gap:' + f.fk ? 'Copied ✓' : 'Copy ASIN list'}</button></div></td></tr>` : '';
  return `<tbody class="fc-grp${open ? ' is-open' : ''}"><tr class="fc-head" data-apc="grp" data-apc-v="${fcEsc(f.fk)}" data-apc-k="${fcEsc(f.fk)}" tabindex="0" aria-expanded="${open}"><td colspan="${APC_COLS}">`
    + `<button type="button" class="fc-arrow" data-apc="grp" data-apc-v="${fcEsc(f.fk)}" aria-label="${open ? 'Close' : 'Open'} ${fcEsc(f.name)}">${open ? '▾' : '▸'}</button>`
    + `<b>${fcEsc(f.name)}</b> <small class="muted">${fcEsc(fcBrandName(f.brand))} · ${f.solo ? '1 product, no family' : fcNf(g.rows.length) + (APC.stock ? ' live child' : ' child') + (g.rows.length === 1 ? '' : 'ren')}</small> ${mini}${badges}`
    + (g.risk > 0 ? `<span class="apc-riskc" title="30-day sales of its Missing, Rejected and Draft products">${apcMoney(g.risk)} without A+</span>` : '') + selAll + '</td></tr>'
    + (open ? gap + APC_COLHEAD + apcFamRowsHtml(f.fk, x.rows) : '') + '</tbody>';
}
/* A BIG FAMILY IS DRAWN A SCREENFUL FIRST: its first APC_ROWS_FIRST rows at once (and as far as the row the person is at — APC.need),
 * the others APC_ROWS_STEP a frame after the draw (apcLaterRows) — the same rows in the same order; the click never waits for ~490
 * rows to be laid out. Without a browser (the tests, the download) every row is drawn at once. */
const apcProgressive = () => typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !!document.body;
function apcFamRowsHtml(fk, rows) {
  let first = rows.length;
  if (apcProgressive() && rows.length > APC_ROWS_FIRST + 10) {
    const at = APC.need ? rows.findIndex(p => p.key === APC.need) : -1;
    first = Math.min(rows.length, Math.max(APC_ROWS_FIRST, at + 20));
  }
  if (first < rows.length) APC.later.set(fk, rows.slice(first));
  return rows.slice(0, first).map(p => apcRowHtml(p)).join('')
    + (first < rows.length ? `<tr class="apc-laterr" data-apc-later="${fcEsc(fk)}"><td colspan="${APC_COLS}" class="muted">… ${fcNf(rows.length - first)} more rows</td></tr>` : '');
}
function apcLaterRows() {
  const mine = ++APC.laterV;
  if (!APC.later.size || !apcProgressive()) return;
  const step = () => {
    if (mine !== APC.laterV) return;                               // the page was drawn again since
    const next = APC.later.entries().next().value;
    if (!next) return;
    const [fk, rest] = next;
    const mark = [...$('apcBody').querySelectorAll('tr.apc-laterr')].find(tr => tr.dataset.apcLater === fk);
    if (!mark) { APC.later.delete(fk); }
    else {
      mark.insertAdjacentHTML('beforebegin', rest.splice(0, APC_ROWS_STEP).map(p => apcRowHtml(p)).join(''));
      if (!rest.length) { mark.remove(); APC.later.delete(fk); }
      else mark.firstChild.textContent = '… ' + fcNf(rest.length) + ' more rows';
    }
    if (APC.later.size) requestAnimationFrame(() => setTimeout(step, 0));
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}
/** What one "Preview A+" shows: the document as Amazon holds it now — its modules, their texts cut short, their pictures small. */
function apcPrevHtml(pk) {
  const pv = APC.prev.get(pk);
  if (!pv || pv.state === 'loading') return '<div class="apc-prev muted"><span class="spin"></span> Reading this document from Amazon…</div>';
  if (pv.state === 'err') return `<div class="apc-prev"><span class="fc-oknote">Could not read this document: ${fcEsc(pv.err)}</span> <button type="button" class="ghost fc-b" data-apc="prevagain" data-apc-v="${fcEsc(pk)}">Try again</button></div>`;
  const d = pv.data;
  const mods = (d.modules || []).map(m => `<div class="apc-mod"><span class="apc-modt">${fcEsc(String(m.type || 'module').replace(/_/g, ' ').toLowerCase())}</span>`
    + `<div class="apc-modi">${(m.imgs || []).map(i => `<img class="apc-pimg" src="${fcEsc(APC_PIC + i.id)}" alt="${fcEsc(i.alt || '')}" loading="lazy" decoding="async" width="96" height="60">`).join('')}</div>`
    + (m.texts || []).map(t => `<p>${fcEsc(t)}</p>`).join('') + '</div>').join('');
  return `<div class="apc-prev"><div class="apc-prevh"><b>${fcEsc(d.name || 'A+ document')}</b> ${apcChip(apcStatusOf(d.status), d.status === 'APPROVED' ? '✓ Live' : undefined)} <small class="muted">${fcEsc([d.type, d.updated ? 'updated ' + apcDate(Date.parse(d.updated)) : '',
    (d.modules || []).length + ' module' + ((d.modules || []).length === 1 ? '' : 's'), 'read from Amazon just now'].filter(Boolean).join(' · '))}</small>`
    + `<button type="button" class="ghost fc-b" data-apc="prevclose">Close</button></div>`
    + ((d.reasons || []).length ? `<div class="fc-oknote"><b>Amazon's reason:</b> ${fcEsc(d.reasons.join('; '))}</div>` : '')
    + (mods ? `<div class="apc-mods">${mods}</div>` : '<div class="muted">Amazon sent no modules for this document.</div>') + '</div>';
}
function apcDocCardHtml(x) {
  const d = x.d, r = apcDocView(x), pk = fcKey(d.brand, d.k);
  const st = x.st === 'unchecked' ? `<span class="fc-chip is-g">${fcEsc(d.s || 'status not given')}</span>` : apcChip(x.st, x.st === 'live' ? '✓ Live' : undefined);
  const flags = (x.stuck ? ' <span class="fc-chip is-y">Stuck</span>' : '') + (x.oldDraft ? ' <span class="fc-chip is-y">Forgotten draft</span>' : '') + (x.unused ? ' <span class="fc-chip is-g">Not on any live product</span>' : '')
    + (x.story ? ' <span class="fc-chip is-b apc-story" title="A Brand Story: not the products\' own A+">Brand Story</span>' : '');
  // (2 Dec 2026) its modules: "5 modules: header image · image + text ×2 · comparison chart · text", against the standard
  // (3 Dec 2026) the count shown is capped at the standard; Amazon's real count and raw types are in the tooltip
  const modLine = x.m ? `<div class="apc-dmod" title="${fcEsc(x.vs ? x.vs.tip : `${x.m.n} module${x.m.n === 1 ? '' : 's'} on Amazon: ${(x.m.ty || []).join(', ') || 'none'}`)}"><b>Modules:</b> `
    + (x.vs ? `<span class="apc-mc ${x.vs.complete ? 'is-ok' : 'is-y'}">${fcEsc(x.vs.text)}</span> ` : '') + `${fcEsc(apcModsText(x.m) || '—')} <small class="muted">read ${fcEsc(apcDate(x.m.at))}${x.m.src === 'daily' ? ' (daily read)' : ' (this browser)'}</small></div>`
    : '<div class="apc-dmod muted">Modules not read yet — “Read modules now” reads them (read-only)</div>';
  const on = x.on === null ? 'its product list could not be read' : `on ${fcNf(x.onOurs.length)} product${x.onOurs.length === 1 ? '' : 's'} at Amazon · ${fcNf(x.liveN)} live in Sellora`;
  // the ASINs on it that are not our listings: one small muted line, the list when it is opened
  const extra = x.extra.length ? `<details class="apc-dx muted"><summary>+ ${fcNf(x.extra.length)} other ASIN${x.extra.length === 1 ? '' : 's'} (parents / closed / not in our listings)</summary>`
    + `<span class="ui-mono">${x.extra.map(e => fcEsc(e.asin) + (e.parent ? ' <small>(parent)</small>' : '')).join(' ')}</span></details>` : '';
  const add = x.add.length ? `<div class="apc-gap"><b>Add ${x.add.length === 1 ? 'this ASIN' : 'these ' + fcNf(x.add.length) + ' ASINs'} to this document</b>${x.addRisk > 0 ? ` (${apcMoney(x.addRisk)} of 30-day sales without A+)` : ''} — `
    + `live family members that have no A+ yet${x.fams.length ? ' (' + x.fams.slice(0, 3).map(fcEsc).join(', ') + (x.fams.length > 3 ? '…' : '') + ')' : ''}: <span class="ui-mono">${apcAsinsHtml(x.add)}</span> `
    + `<button type="button" class="ghost fc-b" data-apc="copy" data-apc-v="${fcEsc(x.add.join(' '))}" data-apc-id="add:${fcEsc(pk)}">${APC.copied === 'add:' + pk ? 'Copied ✓' : 'Copy ASIN list'}</button></div>` : '';
  const notes = [x.stuck ? `Stuck in review since ${apcDate(d.u)} — contact Seller Support.` : '', x.oldDraft ? `Not touched since ${apcDate(d.u)} — submit it for approval, or delete it.` : '',
    x.st === 'rejected' ? ((d.rr || []).length ? `Amazon's reason: ${d.rr.join('; ')}` : 'Rejected — Amazon\'s reason is in A+ Content Manager and in its e-mail.') : '',
    x.unused ? 'It is attached to no product that is buyable and in stock.' : '', d.as ? 'Its product list is from an older read (today\'s read of it failed).' : ''].filter(Boolean);
  return `<div class="card apc-dcard" data-apc-k="${fcEsc(pk)}"><div class="apc-dh"><b title="${fcEsc(r.name)}">${fcEsc(r.name)}</b> ${st}${flags}</div>`
    + `<div class="apc-dm muted">${fcEsc([fcBrandName(d.brand), r.type || 'type not given', r.updated ? 'updated ' + r.updated : 'no update date', on].join(' · '))}</div>` + modLine + extra
    + notes.map(n => `<div class="apc-dn">${fcEsc(n)}</div>`).join('') + add
    + `<div class="apc-da"><button type="button" class="ghost fc-b" data-apc="prev" data-apc-v="${fcEsc(pk)}" data-apc-at="doc:${fcEsc(pk)}" title="Reads this one document from Amazon now and shows what is in it">Preview A+</button>`
    + (x.on && x.on.length ? `<button type="button" class="ghost fc-b" data-apc="copy" data-apc-v="${fcEsc(x.on.join(' '))}" data-apc-id="all:${fcEsc(pk)}" title="Every ASIN this document is attached to">${APC.copied === 'all:' + pk ? 'Copied ✓' : 'Copy its ' + fcNf(x.on.length) + ' ASINs'}</button>` : '')
    + `<a class="ghost fc-b apc-link" href="${APC_MANAGER}" target="_blank" rel="noopener">Open A+ Content Manager ↗</a></div>`
    + (APC.prevOpen === 'doc:' + pk ? apcPrevHtml(pk) : '') + '</div>';
}
// The bar while something is ticked: "N selected · [No A+ needed (N)] [Clear]".
function apcBarHtml(model) {
  const can = new Set(model.rows.filter(p => p.bucket !== 'live' && p.bucket !== 'none').map(p => p.key));
  [...APC.sel].forEach(k => { if (!can.has(k)) APC.sel.delete(k); });
  if (!APC.sel.size) return '';
  return `<div class="fc-bar" role="region" aria-label="Ticked products"><b>${fcNf(APC.sel.size)} selected</b>`
    + `<button type="button" class="fc-b" data-apc="bok">No A+ needed (${fcNf(APC.sel.size)})</button><button type="button" class="fc-b ghost" data-apc="bclear">Clear</button></div>`;
}
function apcSkeleton() {
  const line = '<div class="apc-skel"><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div>';
  return `<div class="card apc-sum"><div class="apc-cov"><span class="sp-skel is-w"></span><div class="apc-bar"><i class="is-g" style="flex:1"></i></div></div></div><div class="card fc-wrap">${line.repeat(7)}</div>`;
}
function apcBodyHtml(model) {
  const s = apcSummary(model);
  const top = apcSummaryHtml(s) + apcCardsHtml(model, s);
  const noData = s.brands.every(b => !model.state[b].has);
  if (APC.view === 'doc') {
    const all = apcDocs(model);
    const chips = `<div class="cc-chips" role="group" aria-label="Show">${APC_DOC_CHIPS.map(([k, t]) => `<button type="button" class="cc-fchip${APC.f === k ? ' is-on' : ''}" data-apc="chip" data-apc-v="${k}" aria-pressed="${APC.f === k}">${fcEsc(t)}${k ? ` <b>${fcNf(all.filter(x => apcDocIn(x, k)).length)}</b>` : ` <b>${fcNf(all.length)}</b>`}</button>`).join('')}</div>`;
    const list = all.filter(x => apcDocIn(x, APC.f));
    const shown = list.slice(0, APC.docs);
    const note = !all.length ? `<div class="card fc-empty"><b>${noData ? 'A+ not checked yet' : 'No A+ document matches'}</b><p class="muted">${noData ? fcEsc(s.brands.map(b => fcBrandName(b) + ': ' + model.state[b].why).join(' · ')) : 'Clear the search to see every document.'}</p></div>`
      : !list.length ? '<div class="card fc-empty"><b>No document under this chip</b></div>' : '';
    return apcStdHtml() + apcSummaryHtml(s) + chips + note + `<div class="apc-docs">${shown.map(apcDocCardHtml).join('')}</div>`
      + (list.length > shown.length ? `<div class="fc-more" id="apcMore"><button type="button" class="ghost" data-apc="more">Show more documents (${fcNf(list.length - shown.length)} left)</button></div>` : '');
  }
  let note = '';
  if (!s.total) note = `<div class="card fc-empty"><b>${APC.q ? 'Nothing matches the search' : 'No products to check'}</b>${APC.q ? '' : ' — the snapshots are empty, or nothing is buyable and in stock. Switch “Stock &gt; 0 only” off to see every product.'}</div>`;
  else if (noData) note = `<div class="card fc-empty"><b>A+ not checked yet</b><p class="muted">${fcEsc(s.brands.map(b => fcBrandName(b) + ': ' + model.state[b].why).join(' · '))}. Nothing is flagged; the list below shows the products.</p></div>`;
  else if (s.counted && s.live === s.counted && !APC.f && !APC.q) note = '<div class="card fc-empty cc-allok"><b>Every live product has A+ ✓</b></div>';
  let table = '', more = '';
  if (APC_FLAT_F.includes(APC.f)) {
    const list = apcFlatList(model, APC.f), shown = list.slice(0, APC.flat);
    if (!list.length && s.total && !noData) {
      note += APC.f === 'fix' ? '<div class="card fc-empty cc-allok"><b>Nothing to fix first ✓</b> — no product is Missing, Rejected or Draft.</div>'
        : `<div class="card fc-empty"><b>${{ weak: 'No weak A+', story: 'No product has only a Brand Story', pd: 'Every product detail counted is filled' }[APC.f]}</b>${APC.f !== 'pd' ? ' — among the documents whose modules are read' : ' — of the attributes Sellora reads'}</div>`;
    }
    table = list.length ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl cc-tbl apc-tbl"><tbody class="fc-grp is-open">${APC_COLHEAD}${shown.map((p, i) => apcRowHtml(p, true, i + 1)).join('')}</tbody></table></div>` : '';
    more = list.length > shown.length ? `<div class="fc-more" id="apcMore"><button type="button" class="ghost" data-apc="more">Show more (${fcNf(list.length - shown.length)} left)</button></div>` : '';
  } else {
    const groups = apcGroups(model);
    const shown = groups.slice(0, APC.limit);
    if (!groups.length && s.total) note += `<div class="card fc-empty"><b>${APC.f ? 'No product is ' + fcEsc(APC.f === 'stuck' ? 'Stuck' : (APC_ST[APC.f] || {}).t || APC.f) : 'Nothing matches'}</b></div>`;
    table = groups.length ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl cc-tbl apc-tbl">${shown.map(apcGroupHtml).join('')}</table></div>` : '';
    more = groups.length > shown.length ? `<div class="fc-more" id="apcMore"><button type="button" class="ghost" data-apc="more">Show more families (${fcNf(groups.length - shown.length)} left)</button></div>` : '';
  }
  return apcStdHtml() + top + note + table + more + apcBarHtml(model);
}
// (2 Dec 2026) ⚙ A+ standard: the number of modules and the ones a complete product A+ must have — shared with the team
function apcStdHtml() {
  if (!APC.setOpen) return '';
  const std = APC.stdDraft || APC.std;
  const box = ([k, t]) => `<label class="apc-setk"><input type="checkbox" data-apc-std="must" value="${k}"${std.must.includes(k) ? ' checked' : ''}> ${fcEsc(t)}</label>`;
  return `<div class="card apc-set" role="group" aria-label="A+ standard"><div><b>A+ standard</b> <span class="muted">— what a complete product A+ has; one standard for the whole team</span></div>`
    + `<div class="apc-setr"><label class="apc-setk">Modules <input type="number" min="1" max="12" data-apc-std="n" value="${fcEsc(std.n)}" aria-label="Modules"></label><span class="muted">must include:</span>${APC_KINDS.slice(0, 4).map(box).join('')}</div>`
    // (3 Dec 2026) the product details counted ("N of M filled"); the ones Sellora does not read are never counted
    + `<div class="apc-setr"><span class="muted">Product details counted:</span>${APC_PD_ROWS.map(([, label, key]) => `<label class="apc-setk"><input type="checkbox" data-apc-std="pd" value="${key}"${(std.pd || APC_PD_ALL).includes(key) ? ' checked' : ''}> ${fcEsc(label)}</label>`).join('')}</div>`
    + `<div class="apc-setr"><button type="button" class="fc-b" data-apc="stdsave">Save standard</button><button type="button" class="ghost fc-b" data-apc="stdclose">Close</button>`
    + `<span class="muted">${APC.stdBy ? fcEsc(`Saved by ${APC.stdBy.name || APC.stdBy.by || 'someone'}${APC.stdBy.at ? ' on ' + apcDate(APC.stdBy.at) : ''}`) : 'The company standard: 5 modules incl. a header image'}</span>`
    + `${APC.stdNote ? ` <span class="fc-oknote">${fcEsc(APC.stdNote)}</span>` : ''}</div></div>`;
}
/** Draw the screen. Everything comes from memory: no network wait, no Amazon call. */
function apcDraw() {
  if (!$('apcPane')) return;
  apcShell();
  const body = $('apcBody');
  if (!body) return;
  if (APC.loading && !APC.loaded) { body.innerHTML = apcSkeleton(); if ($('apcMeta')) $('apcMeta').textContent = 'Reading the saved listings…'; return; }
  const model = apcBuild();
  if ($('apcTools')) $('apcTools').innerHTML = apcToolsHtml();
  if ($('apcMeta')) $('apcMeta').innerHTML = apcMetaHtml(model);
  APC.later.clear();
  body.innerHTML = apcBodyHtml(model);
  if ($('apcSide')) $('apcSide').innerHTML = apcSideHtml(model);          // the product details panel (3 Dec 2026)
  apcLaterRows();
  apcWatchMore();
  apcStick();
}
/** Draw again and keep the person's place: the line (family, product or document) at the top of the screen stays where it was. */
function apcDrawKeep() {
  const body = $('apcBody');
  const find = () => (body && body.querySelectorAll ? [...body.querySelectorAll('[data-apc-k],[data-apc-row]')] : []);
  const idOf = el => el.dataset.apcK || el.dataset.apcRow;
  let key = '', top = 0;
  if (typeof window !== 'undefined' && body && body.querySelectorAll) {
    const edge = ($('apcTb') && $('apcTb').getBoundingClientRect ? $('apcTb').getBoundingClientRect().bottom : 0) + 1;
    const el = find().find(x => x.getBoundingClientRect().bottom > edge);
    if (el) { key = idOf(el); top = el.getBoundingClientRect().top; }
  }
  APC.need = key;
  try { apcDraw(); } finally { APC.need = ''; }
  if (!key || typeof window === 'undefined' || !window.scrollBy) return;
  const again = find().find(x => idOf(x) === key);
  if (again) window.scrollBy(0, again.getBoundingClientRect().top - top);
}
// Family lines drawn at a time: fewer while many families are open (their rows are drawn too).
const apcStep = () => (APC.open.size > 3 ? APC_STEP_OPEN : APC_STEP);
// "Show more" comes in by itself when it scrolls near the screen.
function apcWatchMore() {
  if (typeof IntersectionObserver !== 'function') return;
  if (!APC.io) APC.io = new IntersectionObserver(seen => { if (apcPaneOn() && seen.some(e => e.isIntersecting)) apcMore(); }, { rootMargin: '400px' });
  APC.io.disconnect();
  const more = $('apcMore');
  if (more) APC.io.observe(more);
}
function apcMore() {
  if (APC.view === 'doc') APC.docs += APC_DOC_STEP;
  else if (APC_FLAT_F.includes(APC.f)) APC.flat += APC_FLAT_STEP;
  else APC.limit += apcStep();
  apcDraw();
}
// The toolbar sticks under Sellora's menu bar (the bar's height is measured, like Listing Health's).
function apcStick() {
  if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined' || !document.body) return apcStickNow();
  if (!APC.stickT) APC.stickT = requestAnimationFrame(() => { APC.stickT = 0; apcStickNow(); });
}
function apcStickNow() {
  try {
    const pane = $('paneAplus');
    if (!pane || !pane.style || !pane.style.setProperty || typeof getComputedStyle !== 'function' || typeof document === 'undefined' || !document.querySelector) return;
    const side = document.querySelector('.side');
    pane.style.setProperty('--apc-top', (side && getComputedStyle(side).position === 'sticky' ? Math.round(side.getBoundingClientRect().height) : 0) + 'px');
  } catch (e) { /* no layout to measure (a test page) */ }
}
/** A tick changes only what a tick changes: the boxes, their rows' look, the family buttons and the bar (not the whole table). */
function apcSelPaint() {
  const body = $('apcBody');
  if (!body || !body.querySelectorAll || !body.querySelector('.apc-tbl')) return apcDraw();
  const model = apcBuild();
  body.querySelectorAll('input.fc-tick[data-apc="tick"]').forEach(box => {
    const on = APC.sel.has(fcKey(box.dataset.apcB, box.dataset.apcS));
    box.checked = on;
    const tr = box.closest ? box.closest('tr') : null;
    if (tr) tr.classList.toggle('is-sel', on);
  });
  const groups = apcGroups(model);
  body.querySelectorAll('[data-apc="selfam"]').forEach(btn => {
    const x = groups.find(y => y.f.fk === btn.dataset.apcV);
    const keys = x ? x.rows.filter(p => p.bucket !== 'live' && p.bucket !== 'none').map(p => p.key) : [];
    btn.textContent = keys.length && keys.every(k => APC.sel.has(k)) ? 'Clear this family' : 'Select all in family';
  });
  const old = body.querySelector('.fc-bar');
  const html = apcBarHtml(model);
  if (old) old.outerHTML = html;
  else if (html) body.insertAdjacentHTML('beforeend', html);
}
/** Open or close one family; the clicked line stays where it was on the screen. */
function apcToggle(fk, el) {
  const line = el && el.closest ? el.closest('.fc-head') || el : null;
  const top0 = line && line.getBoundingClientRect ? line.getBoundingClientRect().top : null;
  if (APC.open.has(fk)) APC.open.delete(fk);
  else APC.open.add(fk);
  apcDraw();
  if (top0 == null || typeof document === 'undefined' || !document.querySelector) return;
  const again = document.querySelector(`#apcBody .fc-head[data-apc-v="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(fk) : fk}"]`);
  if (again && again.getBoundingClientRect && typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, again.getBoundingClientRect().top - top0);
}

/* ----- on a click only: one document read from Amazon ----- */
/** "Preview A+": reads that one document (?lh=aplusdoc → getContentDocument) and shows its modules small. `at`: where it opens. */
async function apcPreview(pk, at, again) {
  if (APC.prevOpen === at && !again) { APC.prevOpen = ''; return apcDrawKeep(); }
  APC.prevOpen = at;
  const have = APC.prev.get(pk);
  if (have && have.state !== 'err' && !again) return apcDrawKeep();
  APC.prev.set(pk, { state: 'loading' });
  apcDrawKeep();
  const cut = pk.indexOf('|');
  try {
    const r = await baCall({ lh: 'aplusdoc', brand: pk.slice(0, cut), doc: pk.slice(cut + 1) });
    if (!r || r.ok === false) throw new Error((r && r.error) || 'no answer');
    APC.prev.set(pk, { state: 'ok', data: r });
    apcModPut(pk, r);                                    // its modules count too (2 Dec 2026)
  } catch (e) {
    APC.prev.set(pk, { state: 'err', err: String((e && e.message) || e).slice(0, 240) });
  }
  apcDrawKeep();
}
async function apcCopy(text, id) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else throw new Error('no clipboard');
    APC.copied = id;
  } catch (e) {
    APC.copied = '';
    if (typeof window !== 'undefined' && window.prompt) window.prompt('Copy these ASINs (Ctrl+C):', text);
  }
  apcDrawKeep();
  setTimeout(() => { if (APC.copied === id) { APC.copied = ''; apcDrawKeep(); } }, 2500);
}

/* ----- events ----- */
function apcClick(el) {
  const act = el.dataset.apc, v = el.dataset.apcV, brand = el.dataset.apcB, id = el.dataset.apcS;
  if (act === 'view') { if (APC.view === v) return null; APC.view = v; APC.f = ''; APC.prevOpen = ''; APC.built = false; return apcDraw(); }
  if (act === 'f') { APC.f = APC.f === v ? '' : v; APC.limit = APC_STEP; APC.flat = APC_FLAT_STEP; return apcDraw(); }      // a card: press again to clear it
  if (act === 'chip') { APC.f = v || ''; APC.limit = APC_STEP; APC.flat = APC_FLAT_STEP; APC.docs = APC_DOC_STEP; return apcDraw(); }
  if (act === 'prf') { prToggle('apc', v); APC.limit = APC_STEP; APC.flat = APC_FLAT_STEP; return apcDraw(); }      // 🔴 / 🟠 / ⚪ (listing-priority.js)
  if (act === 'grp') return apcToggle(v, el);
  if (act === 'openall') { apcGroups(apcBuild()).forEach(x => APC.open.add(x.f.fk)); APC.limit = APC_STEP_OPEN; return apcDraw(); }
  if (act === 'closeall') { APC.open.clear(); APC.limit = APC_STEP; return apcDraw(); }
  if (act === 'more') return apcMore();
  if (act === 'csv') return apcDownload(false);
  if (act === 'csvdocs') return apcDownload(true);
  if (act === 'ok') return apcOkSetMany([fcKey(brand, id)]);
  if (act === 'undo') return apcOkUndo(brand, id);
  if (act === 'tick') { const k = fcKey(brand, id); if (APC.sel.has(k)) APC.sel.delete(k); else APC.sel.add(k); return apcSelPaint(); }
  if (act === 'selfam') {
    const x = apcGroups(apcBuild()).find(y => y.f.fk === v);
    const keys = x ? x.rows.filter(p => p.bucket !== 'live' && p.bucket !== 'none').map(p => p.key) : [];
    const allOn = keys.length && keys.every(k => APC.sel.has(k));
    keys.forEach(k => (allOn ? APC.sel.delete(k) : APC.sel.add(k)));
    return apcSelPaint();
  }
  if (act === 'bclear') { APC.sel.clear(); return apcSelPaint(); }
  if (act === 'bok') return apcOkSetMany([...APC.sel]);
  if (act === 'prev') return apcPreview(v, el.dataset.apcAt);
  if (act === 'prevagain') return apcPreview(v, APC.prevOpen, true);
  if (act === 'prevclose') { APC.prevOpen = ''; return apcDrawKeep(); }
  if (act === 'copy') return apcCopy(v, el.dataset.apcId);
  // (2 Dec 2026) modules and the standard
  if (act === 'modread') { apcReadMods(); return null; }
  if (act === 'modstop') { if (APC.modRead) APC.modRead.stop = true; return null; }
  if (act === 'stdopen') { APC.setOpen = !APC.setOpen; APC.stdDraft = null; return apcDraw(); }
  if (act === 'stdclose') { APC.setOpen = false; APC.stdDraft = null; return apcDraw(); }
  if (act === 'stdsave') return apcStdSave(APC.stdDraft || APC.std);
  // (3 Dec 2026) the product details panel
  if (act === 'pd') return apcPdOpen(v);                                // opens it and reads that listing from Amazon (4 Dec 2026)
  if (act === 'pdread') { const p = apcBuild().rows.find(r => r.key === v); if (!p) return null; APC.pdLive.delete(p.c.brand + '|' + p.c.sku); return apcPdRead(p.c.brand, p.c.sku); }
  if (act === 'pdclose') { APC.pd = ''; return apcSideDraw(); }
  if (act === 'pdws') { APC.pd = ''; apcSideDraw(); return apcOpenWs(brand, v); }
  return null;
}
function apcFilter(el) {
  const k = el.dataset.apcF;
  if (k === 'stock') { APC.stock = !!el.checked; APC.sel.clear(); }
  else APC[k] = el.value;
  APC.limit = apcStep();
  APC.flat = APC_FLAT_STEP;
  APC.docs = APC_DOC_STEP;
  clearTimeout(APC.qT);
  if (k === 'q') APC.qT = setTimeout(apcDraw, 200);
  else apcDraw();
}
/** Opening the page: the saved snapshots (read once), the marks, then draw. Nothing is asked of Amazon. */
async function apcOpen() {
  apcShell();
  apcDraw();
  if (APC.loaded || APC.loading) return;
  APC.loading = true;
  apcDraw();
  try {
    if (typeof lmEnsure === 'function') await lmEnsure();
    if (typeof loadParentNames === 'function') await loadParentNames();
    if (typeof H_LOADED !== 'undefined' && !H_LOADED && typeof loadHealthCache === 'function') await loadHealthCache();
    for (const b of ['SP', 'CPC']) if (typeof IML !== 'undefined' && !(b in IML) && typeof imListLoad === 'function') await imListLoad(b);
    apcOkLoad();
    // (2 Dec 2026) the modules this browser read, the team's standard, the backend's daily module read (none until it is deployed)
    apcModKeepLoad();
    apcStdLoad().then(() => apcDrawKeep()).catch(() => {});
    apcModsDailyLoad().then(() => apcDrawKeep()).catch(() => {});
    // sales and sessions Sellora already keeps (saved documents, never Amazon): they land when read and the page draws again
    const side = () => { APC.sideV++; if (apcPaneOn()) apcDrawKeep(); };
    if (typeof SALES30 !== 'undefined' && !SALES30.at && typeof loadSales30 === 'function') loadSales30().then(side).catch(() => {});
    if (typeof WEEKLY !== 'undefined' && !Object.keys(WEEKLY.rows || {}).length && typeof loadWeekly === 'function') loadWeekly().then(side).catch(() => {});
  } catch (e) {
    APC.err = 'Could not read the snapshots: ' + ((e && e.message) || e);
  }
  APC.loading = false;
  APC.loaded = true;
  apcDraw();
}
const apcPaneOn = () => { const pane = $('paneAplus'); return !!(pane && !pane.classList.contains('hide')); };
if (typeof document !== 'undefined' && document.addEventListener && $('apcPane')) {
  $('apcPane').addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-apc]') : null;
    if (el && !el.disabled && !(el.tagName === 'TR' && e.target.closest('a,button,input'))) apcClick(el);
  });
  document.addEventListener('keydown', e => { if (apcPaneOn() && apcKey(e)) e.preventDefault(); });   // Esc closes the panel
  $('apcPane').addEventListener('keydown', e => {
    const t = e.target && e.target.dataset ? e.target : null;
    if (t && (e.key === 'Enter' || e.key === ' ') && t.dataset.apc === 'grp' && t.tagName !== 'BUTTON') { e.preventDefault(); apcClick(t); }
  });
  $('apcPane').addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.apcF && e.target.dataset.apcF !== 'q') apcFilter(e.target); });
  $('apcPane').addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.apcStd) apcStdInput(e.target); });     // ⚙ A+ standard (2 Dec 2026)
  $('apcPane').addEventListener('input', e => { if (e.target && e.target.dataset && e.target.dataset.apcF === 'q') apcFilter(e.target); });
  // a preview picture Amazon does not serve under that address is simply not shown
  $('apcPane').addEventListener('error', e => { if (e.target && e.target.classList && e.target.classList.contains('apc-pimg')) e.target.style.display = 'none'; }, true);
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { if (apcPaneOn()) apcStick(); });
  const pane = $('paneAplus');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) apcOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
}

/* ----- the numbers, and THE PROOF (the browser console) ----- */
/** aplusCounts(): per brand — products, each status, stuck, the sales without A+, the documents, when A+ was read and with how many
 *  calls — on the data this page holds, with "Stock > 0 only" as it is set. Open A+ Content once first (it reads the snapshots). */
function aplusCounts() {
  const model = apcBuild();
  const out = {};
  ['SP', 'CPC'].forEach(b => {
    const rows = model.rows.filter(p => p.c.brand === b);
    const n = k => rows.filter(p => p.bucket === k).length;
    const st = model.state[b];
    // the documents' ASINs, each once: ours (our listings) and the others (parents / closed / not in our listings) — never added together
    const onDocs = new Set();
    lmAplusDocs(b).forEach(d => (d.a || []).forEach(a => onDocs.add(a)));
    const mine = model.ours[b];
    const docAsinsOurs = [...onDocs].filter(a => mine.has(a)).length;
    out[fcBrandName(b)] = { products: rows.length, live: n('live'), withProductAplus: rows.filter(p => p.bucket === 'live' && p.make && p.make.m).length, weakAplus: rows.filter(p => p.weak).length,
      onlyBrandStory: rows.filter(p => p.storyOnly).length, missingProductDetails: rows.filter(p => p.pd && p.pd.miss.length).length,
      waiting: n('waiting'), stuck: rows.filter(p => p.stuck && p.bucket === 'waiting').length, draft: n('draft'), rejected: n('rejected'), missing: n('missing'),
      noAplusNeeded: n('none'), notChecked: n('unchecked'), salesWithoutAplus30d: model.salesAt ? Math.round(rows.filter(p => APC_FIX.includes(p.bucket)).reduce((s, p) => s + (p.sales || 0), 0)) : 'sales not pulled',
      documents: st.docs, docAsinsOurs, docAsinsOther: onDocs.size - docAsinsOurs, ourListings: mine.size, aplusRead: st.atText || 'not read', oldData: st.old || st.stale, callsOfThatRead: st.calls, stockOnly: APC.stock };
  });
  if (typeof console !== 'undefined' && console.table) console.table(out);
  return out;
}
/** aplusAccuracyReport({ n: 10 }): up to n products per status per brand, the biggest sellers first, checked against Amazon's A+ API NOW —
 *  the publish record of the ASIN (and of its parent) and, for a product with a document, that document's own status and ASIN list.
 *  Prints SKU · Sellora says · Amazon says · MATCH / DIFFERENT and returns { rows, match, different, unread }. It reads Amazon (a person
 *  starts it): about n ASINs + their documents per status per brand. */
async function aplusAccuracyReport(opts) {
  opts = opts || {};
  const per = Number(opts.n) || 10;
  const model = apcBuild();
  const out = [];
  for (const b of ['SP', 'CPC']) {
    if (opts.brand && opts.brand !== b) continue;
    const picks = [];
    ['live', 'waiting', 'draft', 'rejected', 'missing'].forEach(st => {
      model.rows.filter(p => p.c.brand === b && p.st === st && p.c.asin).sort((x, y) => (y.sales || 0) - (x.sales || 0)).slice(0, per).forEach(p => picks.push(p));
    });
    // the publish records: 10 ASINs a call, each product's own ASIN and its parent's
    const pub = {};
    const asins = [...new Set(picks.flatMap(p => [p.c.asin, p.g.f.pa].filter(a => /^[A-Z0-9]{10}$/.test(String(a || '')))))];
    for (let i = 0; i < asins.length; i += 10) {
      try { const r = await baCall({ lh: 'aplusasin', brand: b, asins: asins.slice(i, i + 10).join(',') }); Object.assign(pub, (r && r.map) || {}); } catch (e) { /* those stay unread */ }
    }
    const docs = new Map();
    for (const p of picks) {
      let d = null;
      if (p.doc) {
        if (!docs.has(p.doc.k)) { try { docs.set(p.doc.k, await baCall({ lh: 'aplusdoc', brand: b, doc: p.doc.k, asins: 1 })); } catch (e) { docs.set(p.doc.k, { ok: false, error: String((e && e.message) || e) }); } }
        d = docs.get(p.doc.k);
      }
      const own = pub[p.c.asin], par = p.g.f.pa ? pub[p.g.f.pa] : undefined;
      const page = own === true || par === true ? true : own === false && (par === false || !p.g.f.pa) ? false : null;      // A+ on the page: yes / no / could not tell
      const dSt = d && d.ok !== false ? apcStatusOf(d.status) : '';
      const on = d && d.ok !== false && Array.isArray(d.asins) ? d.asins.includes(p.c.asin) || (!!p.g.f.pa && d.asins.includes(p.g.f.pa)) : null;
      let verdict, amazon;
      if (p.st === 'missing') { amazon = page === null ? 'publish record could not be read' : page ? 'A+ published on the page' : 'no A+ published'; verdict = page === null ? 'NOT READ' : page ? 'DIFFERENT' : 'MATCH'; }
      else {
        amazon = (d && d.ok !== false ? `document ${d.status}${on === null ? '' : on ? ', this ASIN on it' : ', this ASIN NOT on it'}` : 'document could not be read') + (page === null ? '' : page ? ' · A+ published on the page' : ' · no A+ published');
        if (!d || d.ok === false) verdict = 'NOT READ';
        else if (dSt !== p.st || on === false) verdict = 'DIFFERENT';
        else if (p.st === 'live' && page === false) verdict = 'DIFFERENT';
        else verdict = 'MATCH';
      }
      out.push({ brand: fcBrandName(b), SKU: p.c.sku, ASIN: p.c.asin, 'Sellora says': APC_ST[p.st].t + (p.doc ? ` — “${p.doc.n}”` : ''), 'Amazon says': amazon, result: verdict });
    }
  }
  const sum = { rows: out, match: out.filter(r => r.result === 'MATCH').length, different: out.filter(r => r.result === 'DIFFERENT').length, unread: out.filter(r => r.result === 'NOT READ').length };
  if (typeof console !== 'undefined') {
    if (console.table) console.table(out);
    console.log(`A+ accuracy: ${sum.match} MATCH · ${sum.different} DIFFERENT · ${sum.unread} not read — of ${out.length} products (A+ read ${['SP', 'CPC'].map(b => fcBrandName(b) + ' ' + (model.state[b].atText || 'never')).join(', ')})`);
  }
  return sum;
}
if (typeof window !== 'undefined') { window.aplusCounts = aplusCounts; window.aplusAccuracyReport = aplusAccuracyReport; }
