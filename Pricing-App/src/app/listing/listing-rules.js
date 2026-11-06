/* ================= LISTING · LISTING RULES: the rules themselves — defaults, calendar maths, detectors, and healthOf, the scorer =================
 * Screens: none of its own. Listing Health scores every listing with healthOf; the Listing Rules tab edits LR and reads the
 *          detector list; Listing Errors / Listing Content use the title rules (lrSuggest, lrSizeOk …). The two listing tests
 *          in Pricing-App/tests run this file in a stub page.
 * Does: holds the built-in rules (LR_DEFAULT: issues, title templates, season calendar) and the saved ones (LR); works out
 *       when each occasion falls and whether it is in season; reads sizes out of titles; builds the title a template would
 *       write (lrSuggest); one detector per rule (LR_DET); hCtx gathers what every listing is judged against (rules, today,
 *       each parent's children, Amazon's own status) and healthOf turns that into { score, bucket, grade, found … }.
 * Main functions: lrEaster, lrEventDate, lrSeason, lrNorm (same meaning, one spelling), lrAllow (what people may write),
 *                 hTitleSizes, hTitleText, lrKwBytes (search-term bytes the way Amazon counts them), lrTemplateFor, lrParts,
 *                 lrSuggest, LR_DET, amzEnsure, hCtx, lrFresh / lrFacts (the freshest data for one listing: a Workspace live
 *                 read, else the Image Manager snapshot, else the Health snapshot — lrPictures judges pictures by the catalogue,
 *                 lrAplus by the listing and its parent, lrAmz Amazon's own verdict), healthOf (each finding carries its
 *                 plain-words fix, LR_FIX_TEXT, the age of its data and `stale` = "Error? Check again"), lrLevel (the two words
 *                 every problem list uses), lrProblemHtml / lrProblemsHtml (the one look every screen gives a problem) and
 *                 lrFixOpen (the Fix button's hand-off), hAreaSev, lrLoad, lrLoadCatalog. */
/* ---------- LISTING RULES: the issues, the title templates, the season calendar (Ravi, 2026-09-15) ----------
 *
 * Ravi: "me tumko issue bucket bhej diya tha, tum unko apne app ke backend me save kar lena and ek tab
 * create kar lena jisme me aane wale issue feed kardu; yadi koi listing us criteria me aay to wo usi issue
 * ke liye flag ho (color se mark)". Plus a brand title to measure titles against, and occasions that are
 * out of season still sitting in a title.
 *
 * WHERE THE RULES LIVE: Firestore `listingrules/config` — { issues[], templates[], events[] }. The Listing
 * Rules tab edits it; Listing Health reads it. Until somebody saves, the defaults below are used, and they
 * are Ravi's own lists.
 *
 * AN ISSUE is { id, name, sev: critical|action|review, area, detector, params, desc, on }. The detector is
 * what the app can actually test with the data it holds. Issues Ravi listed that need data Amazon has not
 * been asked for (image types, bullet text, attributes, image text, video …) are saved with detector
 * 'manual': listed, visible, and never pretended to be checked.
 *
 * SEVERITY: Critical (red) · Attention (orange, = Needs Action) · Review (yellow). A listing takes its worst.
 * With no issue at all it is Healthy — or Monitor (grey) when it is out of stock or inactive, because
 * nothing about the listing needs doing but it is not selling either. No catalog content read yet and no
 * issue found: Not checked.
 *
 * Health = 100 − 40 per critical − 10 per attention − 3 per review, never below 0.
 */
// Bucket key → the grade shown on screen.
const H_BUCKETS = { critical: 'Critical', action: 'Attention', review: 'Review', monitor: 'Monitor', healthy: 'Healthy', unchecked: 'Not checked' };
// The three severities an issue can have: label, CSS class of its dot, and rank (higher = worse).
const LR_SEV = {
  critical: { label: 'Critical', cls: 'sev-c', rank: 3 },
  action: { label: 'Attention', cls: 'sev-a', rank: 2 },
  review: { label: 'Review', cls: 'sev-r', rank: 1 }
};
/* TWO WORDS ON EVERY PROBLEM LIST (Part B1, 6 Nov 2026): Critical = "Error: fix first" (red); Needs action and Needs review =
 * "Needs attention" (orange; action is listed before review). Listing Health's KPI cards and columns keep Ravi's three levels
 * (LR_SEV); the problem lists — Workspace rows and detail, Listing Health's Why, the audit — read LR_LEVEL. */
const LR_LEVEL = {
  critical: { word: 'Error: fix first', cls: 'sev-c', stale: 'Error? Check again' },
  action: { word: 'Needs attention', cls: 'sev-a' },
  review: { word: 'Needs attention', cls: 'sev-a' },
};
const lrLevel = sev => LR_LEVEL[sev] || LR_LEVEL.review;
/* FRESH DATA WINS, OLD DATA NEVER SHOUTS (Part A5). An Error that rests only on data older than LR_STALE_DAYS is shown as
 * "Error? Check again" with a Check now button, not as a plain Error. A "no A+" answer older than LR_APLUS_DAYS is asked
 * again before it is shown as an error (Part A2). */
const LR_STALE_DAYS = 7;
const LR_APLUS_DAYS = 14;
// The areas of a listing an issue can belong to (the columns of the Listing Health table).
const LR_AREAS = ['Amazon', 'Title', 'Size', 'Variation', 'Images', 'Content', 'Inventory', 'Price'];

/** What each detector means, and the settings it takes. */
const LR_DETECTORS = {
  manual: { label: 'Not detectable yet — needs data Amazon has not been asked for', params: [] },
  inactive_with_stock: { label: 'Stock at Amazon, but the listing is Inactive', params: [] },
  no_price: { label: 'Price is 0', params: [] },
  no_main_image: { label: "No main picture in Amazon's catalogue (what shoppers see)", params: [] },
  variation_value_missing: { label: 'No size in the title while its siblings have one', params: [] },
  aplus_missing: { label: 'A+ asked of the listing and its parent ASIN, and neither has it', params: [] },
  images_below: { label: 'Fewer gallery pictures than N in the catalogue (MAIN + PT01–PT08; the swatch is not a picture)', params: ['n'] },
  images_between: { label: 'Gallery pictures from MIN to MAX', params: ['min', 'max'] },
  bullets_below: { label: 'Fewer bullets than N', params: ['n'] },
  desc_below: { label: 'Description shorter than N characters (not judged when A+ is live — Amazon shows the A+ instead)', params: ['n'] },
  keyword_bytes: { label: 'Search terms over MAX bytes, counting the words only (spaces and ; , . do not count)', params: ['max'] },
  title_length: { label: 'Title length outside MIN–MAX characters', params: ['min', 'max'] },
  size_format: { label: 'A size in the title not written like the approved example', params: ['example'] },
  dimension_order: { label: 'Larger dimension written first', params: [] },
  variation_naming: { label: 'Siblings write their size differently', params: [] },
  title_template: { label: 'Title missing parts of its template, or in another order', params: [] },
  title_keyword: { label: 'Title missing a required word (comma-separated: any one is enough)', params: ['words'] },
  title_contains: { label: 'Title contains a word (comma-separated)', params: ['words'] },
  seasonal_keyword: { label: 'Title names an occasion that is out of season (see the calendar)', params: [] },
  amazon_suppressed: { label: 'Amazon has taken the listing out of search (buyable but not discoverable)', params: [] },
  amazon_error: { label: 'Amazon itself reports an error on the listing', params: [] },
};

const LR_DEFAULT = {
  issues: [
    /* AMAZON'S OWN VERDICT COMES FIRST (9 Oct 2026). RTC203-6060 was suppressed from search with
     * ERROR 18320 "The main image is missing or incorrect" and this screen said nothing: the catalogue
     * had images, because the family supplies them, and no rule had ever asked Amazon what IT thought. */
    { id: 'amz_suppressed', name: 'Suppressed from search by Amazon', sev: 'critical', area: 'Amazon', detector: 'amazon_suppressed', desc: 'Buyable from a direct link but removed from search results' },
    { id: 'amz_error', name: 'Amazon reports an error', sev: 'critical', area: 'Amazon', detector: 'amazon_error', desc: "Amazon's own issue list for this listing holds at least one ERROR" },
    /* Critical — the rows Ravi's screenshot showed, and a listing with no image at all. */
    { id: 'inv_mismatch', name: 'Inventory/content mismatch', sev: 'critical', area: 'Inventory', detector: 'inactive_with_stock', desc: 'Inventory has arrived and listing is fundamentally incomplete/unbuyable' },
    { id: 'price_error', name: 'Major price error', sev: 'critical', area: 'Price', detector: 'no_price', desc: 'Price substantially outside approved/master range — only "no price" can be checked today' },
    { id: 'main_image', name: 'Main image missing', sev: 'critical', area: 'Images', detector: 'no_main_image', desc: "Amazon's catalogue shows no main picture — the listing cannot be bought" },
    /* THE RECOMMENDED LEVELS (Part B2, 6 Nov 2026). Error (critical): Amazon reports an error · Suppressed from search · Stock but
     * Inactive · No price · Main image missing · Secondary images missing (fewer than 6 pictures) · A+ missing. Everything else is
     * Needs attention — Missing required variation value was critical and is now action. A saved config keeps its own levels; the
     * "Use recommended levels" button on the Listing Rules tab fills these into the form, and the person presses Save. */
    { id: 'aplus_missing', name: 'A+ missing', sev: 'critical', area: 'Content', detector: 'aplus_missing', desc: 'Neither the listing nor its parent ASIN has A+ published' },
    { id: 'img_secondary', name: 'Secondary images missing', sev: 'critical', area: 'Images', detector: 'images_below', params: { n: 6 }, desc: 'Fewer than 6 gallery pictures in the catalogue' },
    /* Needs attention */
    { id: 'var_value', name: 'Missing required variation value', sev: 'action', area: 'Variation', detector: 'variation_value_missing', desc: 'Makes child unclear/wrong within parent' },
    { id: 'kw_bytes', name: 'Search terms over the limit', sev: 'action', area: 'Content', detector: 'keyword_bytes', params: { max: 249 }, desc: 'Over the limit Amazon ignores all of the search terms; spaces and ; , . do not count toward it' },
    { id: 'img_type', name: 'Important image type missing', sev: 'action', area: 'Images', detector: 'manual', desc: 'No size infographic, lifestyle, detail image, etc.' },
    { id: 'title_template', name: "Title doesn't follow template", sev: 'action', area: 'Title', detector: 'title_template', desc: 'Information is correct but title structure is wrong' },
    { id: 'size_format', name: 'Size formatting inconsistent', sev: 'action', area: 'Size', detector: 'size_format', params: { example: '14 x 36 Inch' }, desc: '14x36, 14 x 36 inch, etc. instead of approved 14 x 36 Inch' },
    { id: 'dim_order', name: 'Dimension order inconsistent', sev: 'action', area: 'Size', detector: 'dimension_order', desc: '36 x 14 instead of CPC-approved 14 x 36, where both describe same item' },
    { id: 'title_keyword', name: 'Important title keyword missing', sev: 'action', area: 'Title', detector: 'title_keyword', params: { words: 'Block Print' }, desc: 'e.g. Hand Block Print omitted when required by template' },
    { id: 'bullet_missing', name: 'Missing bullet', sev: 'action', area: 'Content', detector: 'bullets_below', params: { n: 5 }, desc: 'Fewer than required number' },
    { id: 'bullet_structure', name: 'Bullet structure incorrect', sev: 'action', area: 'Content', detector: 'manual', desc: "Doesn't follow CPC standard" },
    { id: 'bullet_dup', name: 'Duplicate bullet content', sev: 'action', area: 'Content', detector: 'manual', desc: 'Same benefit repeated' },
    { id: 'attr_missing', name: 'Important attribute missing', sev: 'action', area: 'Content', detector: 'manual', desc: 'Pattern, material, shape, closure, etc.' },
    { id: 'var_naming', name: 'Variation naming inconsistent', sev: 'action', area: 'Variation', detector: 'variation_naming', desc: '60x90 on one child vs 60 x 90 Inch on another' },
    { id: 'siblings', name: 'Parent siblings inconsistent', sev: 'action', area: 'Variation', detector: 'manual', desc: 'Some children use old naming/template' },
    { id: 'img_text', name: 'Image text inconsistent with listing', sev: 'action', area: 'Images', detector: 'manual', desc: "Same product but formatting/naming doesn't match" },
    { id: 'aplus_old', name: 'A+ incorrect/outdated', sev: 'action', area: 'Content', detector: 'manual', desc: 'A+ exists but wrong/old content assigned' },
    { id: 'backend_field', name: 'Backend/catalog field incomplete', sev: 'action', area: 'Content', detector: 'manual', desc: "Important searchable attribute isn't populated" },
    { id: 'season', name: 'Out-of-season occasion in title', sev: 'action', area: 'Title', detector: 'seasonal_keyword', desc: 'e.g. the title still says Thanksgiving when Thanksgiving is months away' },
    /* Needs review */
    { id: 'style_attr', name: 'Style attribute questionable', sev: 'review', area: 'Title', detector: 'title_contains', params: { words: 'Rustic' }, desc: '“Rustic” when CPC primarily calls it Cottagecore' },
    { id: 'img_low', name: 'Low image count but minimum met', sev: 'review', area: 'Images', detector: 'images_between', params: { min: 6, max: 7 }, desc: '6 images when ideal is 8' },
    { id: 'no_video', name: 'No video', sev: 'review', area: 'Images', detector: 'manual', desc: 'Video recommended but not mandatory' },
    { id: 'title_opt', name: 'Title slightly under-optimized', sev: 'review', area: 'Title', detector: 'title_length', params: { min: 60, max: 75 }, desc: 'Outside 60–75 characters. Amazon asks for 75 or less to use Item Highlights (from 27 Jul 2026); under 60 usually leaves useful words out.' },
    { id: 'bullet_short', name: 'Bullet unusually short', sev: 'review', area: 'Content', detector: 'manual', desc: 'Technically complete but weaker than CPC standard' },
    { id: 'desc_weak', name: 'Description weak', sev: 'review', area: 'Content', detector: 'desc_below', params: { n: 200 }, desc: 'Exists but could improve' },
    { id: 'attr_optional', name: 'Optional attribute missing', sev: 'review', area: 'Content', detector: 'manual', desc: 'Non-essential field' },
    { id: 'search_term', name: 'Search-term anomaly', sev: 'review', area: 'Title', detector: 'manual', desc: '14 × 36 product indexing for 12 × 24' },
    { id: 'old_content', name: 'Old content suspected', sev: 'review', area: 'Content', detector: 'manual', desc: "Content doesn't match latest preferred version but isn't incorrect" },
    { id: 'naming_var', name: 'Naming variation', sev: 'review', area: 'Title', detector: 'manual', desc: "Minor wording differences that don't affect understanding" },
    { id: 'dup_content', name: 'Potential duplicate content', sev: 'review', area: 'Content', detector: 'manual', desc: 'Needs human determination' },
    { id: 'img_quality', name: 'Image quality concern', sev: 'review', area: 'Images', detector: 'manual', desc: 'Images exist but may be outdated/weak' },
    { id: 'seo', name: 'SEO opportunity', sev: 'review', area: 'Title', detector: 'manual', desc: 'Missing secondary keyword with no accuracy problem' },
    { id: 'low_score', name: 'Low content score', sev: 'review', area: 'Content', detector: 'manual', desc: 'No specific major error, but listing falls below quality threshold' },
  ],
  /* A TITLE TEMPLATE, per brand and product. The first whose `match` is found in the catalog sub-category
   * wins ('' matches anything). Tokens: {brand} {product} {shape} {material} {size} {pattern} {uses}
   * {occasions} {color}. {occasions} is filled only with the occasions in season today. The reference
   * title is kept for the person reading the template. */
  templates: [
    { brand: 'ALL', match: 'Tablecloth', product: 'Tablecloth', material: '100% Cotton', pattern: 'Hand Block Print',
      uses: 'Decorative Table Cover for Dining Kitchen Farmhouse Party Home', required: 'brand,product,shape,material,size,color',
      pattern_: '', template: '{brand} {product} {shape} {material} {size} {pattern} {uses} {occasions} - {color}',
      reference: 'Maison d\' Hermine Table Cloth Rectangle Table Reusable 100% Cotton 60"x90" Decorative for Dining Kitchen Room Farmhouse Party Home Hotel Washable Table Cover Thanksgiving Christmas - Equinoxe - Beige' },
    { brand: 'ALL', match: 'Runner', product: 'Table Runner', material: '100% Cotton', pattern: 'Hand Block Print',
      uses: 'for Dining Table Kitchen Farmhouse Party Home', required: 'brand,product,material,size,color',
      template: '{brand} {product} {material} {size} {pattern} {uses} {occasions} - {color}', reference: '' },
    { brand: 'ALL', match: 'Pillow', product: 'Throw Pillow Cover', material: 'Cotton', pattern: 'Block Print',
      uses: 'for Couch Sofa Bed Living Room', required: 'brand,product,size,color',
      template: '{brand} {color} {pattern} {product} {size} {uses} {occasions}', reference: '' },
    { brand: 'ALL', match: 'Napkin', product: 'Cloth Napkins', material: '100% Cotton', pattern: 'Block Print',
      uses: 'Reusable Dinner Napkins', required: 'brand,product,material,size,color',
      template: '{brand} {product} {material} {size} {pattern} {uses} {occasions} - {color}', reference: '' },
  ],
  /* THE SEASON CALENDAR. A title may name an occasion from `lead` days before it to `lag` days after it.
   * when: fixed {m,d} · nth weekday {m, wd (0=Sun), n (−1 = last)} · easter {off} · after {event, days}.
   * `except`: words that, found in the SKU's sub-category or colour, mean the product IS the occasion
   * (a Christmas tree skirt) and its title may always say so. */
  events: [
    { id: 'newyear', name: "New Year's", words: "New Year", when: { type: 'fixed', m: 1, d: 1 }, lead: 30, lag: 7 },
    { id: 'valentine', name: "Valentine's Day", words: 'Valentine', when: { type: 'fixed', m: 2, d: 14 }, lead: 45, lag: 3 },
    { id: 'patrick', name: "St. Patrick's Day", words: "St Patrick, St. Patrick, Patrick's Day", when: { type: 'fixed', m: 3, d: 17 }, lead: 30, lag: 3 },
    { id: 'easter', name: 'Easter', words: 'Easter', when: { type: 'easter', off: 0 }, lead: 45, lag: 3 },
    { id: 'mother', name: "Mother's Day", words: "Mother's Day, Mothers Day, Mother’s Day", when: { type: 'nth', m: 5, wd: 0, n: 2 }, lead: 45, lag: 3 },
    { id: 'memorial', name: 'Memorial Day', words: 'Memorial Day', when: { type: 'nth', m: 5, wd: 1, n: -1 }, lead: 30, lag: 2 },
    { id: 'father', name: "Father's Day", words: "Father's Day, Fathers Day, Father’s Day", when: { type: 'nth', m: 6, wd: 0, n: 3 }, lead: 30, lag: 3 },
    { id: 'july4', name: '4th of July', words: '4th of July, Fourth of July, Independence Day', when: { type: 'fixed', m: 7, d: 4 }, lead: 30, lag: 3 },
    { id: 'labor', name: 'Labor Day', words: 'Labor Day', when: { type: 'nth', m: 9, wd: 1, n: 1 }, lead: 21, lag: 2 },
    { id: 'halloween', name: 'Halloween', words: 'Halloween', when: { type: 'fixed', m: 10, d: 31 }, lead: 60, lag: 3, except: 'Halloween' },
    { id: 'thanksgiving', name: 'Thanksgiving', words: 'Thanksgiving', when: { type: 'nth', m: 11, wd: 4, n: 4 }, lead: 45, lag: 3 },
    { id: 'blackfriday', name: 'Black Friday', words: 'Black Friday', when: { type: 'after', event: 'thanksgiving', days: 1 }, lead: 30, lag: 1 },
    { id: 'cybermonday', name: 'Cyber Monday', words: 'Cyber Monday', when: { type: 'after', event: 'thanksgiving', days: 4 }, lead: 30, lag: 1 },
    { id: 'christmas', name: 'Christmas', words: 'Christmas, Xmas', when: { type: 'fixed', m: 12, d: 25 }, lead: 75, lag: 7, except: 'Christmas, Tree Skirt' },
  ],
  /* WHAT PEOPLE MAY WRITE (Part A, 5 Nov 2026): things a person writes on purpose are not errors. Saved in the same document.
   *   shortFrom         a title of this many characters up to 75 was shortened on purpose to fit Amazon's 75: the short forms of
   *                     a size ("18x18 Inc", "18×18", the unit left out) are then fine in size_format and variation_naming.
   *   brandWords        per brand, the words that mean "our brand" in a title when Amazon's own brand for the listing is not
   *                     known yet; any one of them, in any case, is the brand. Empty = the brand is not judged.
   *   embroideryColors  pieces in these colours are embroidery, so "Block Print" is never asked of them. */
  allow: { shortFrom: 74, brandWords: { SP: 'Ridhi', CPC: 'Whimsical Corner' }, embroideryColors: 'White, Off White' },
};

let LR = null;             // the rules in force: saved config, or the defaults
let LR_SAVED_AT = null;    // when the saved config was written, or null while the defaults are in use
let LR_CAT = { SP: null, CPC: null };   // brand → { sku: { color, size, subcat } } from the brand catalogue, once read

/* ---- the calendar ---- */
// Easter Sunday of a year (UTC midnight). The anonymous Gregorian algorithm; the single letters are its own names.
function lrEaster(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
/** The date of an occasion in a given year (UTC midnight), or null when the rule cannot be read. */
function lrEventDate(ev, year, events) {
  const when = ev.when || {};
  if (when.type === 'fixed') return new Date(Date.UTC(year, when.m - 1, when.d));
  if (when.type === 'easter') {
    const date = lrEaster(year);
    date.setUTCDate(date.getUTCDate() + (when.off || 0));
    return date;
  }
  if (when.type === 'nth') {
    // --- the n-th weekday of the month, or the last one when n is -1 ---
    if (when.n > 0) {
      const first = new Date(Date.UTC(year, when.m - 1, 1));
      const add = (when.wd - first.getUTCDay() + 7) % 7 + (when.n - 1) * 7;
      return new Date(Date.UTC(year, when.m - 1, 1 + add));
    }
    const last = new Date(Date.UTC(year, when.m, 0));
    return new Date(Date.UTC(year, when.m - 1, last.getUTCDate() - ((last.getUTCDay() - when.wd + 7) % 7)));
  }
  if (when.type === 'after') {
    // --- so many days after another occasion (which must not itself be an 'after') ---
    const base = (events || []).find(other => other.id === when.event);
    const date = base && base.when && base.when.type !== 'after' ? lrEventDate(base, year, events) : null;
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + (when.days || 0));
    return date;
  }
  return null;
}
const LR_DAY = 86400000;   // one day in milliseconds
/** Where today stands against an occasion: { inSeason, next (the date to talk about), from, to }. */
// Looks at last year's, this year's and next year's date; the first window that holds today wins, else the nearest coming one.
function lrSeason(ev, today, events) {
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const year = today.getFullYear();
  let best = null;
  for (const eachYear of [year - 1, year, year + 1]) {
    const date = lrEventDate(ev, eachYear, events);
    if (!date) continue;
    const from = date.getTime() - (ev.lead || 0) * LR_DAY;
    const to = date.getTime() + (ev.lag || 0) * LR_DAY;
    if (todayMs >= from && todayMs <= to) return { inSeason: true, next: date, from: new Date(from), to: new Date(to) };
    if (to >= todayMs && (!best || date < best.next)) best = { inSeason: false, next: date, from: new Date(from), to: new Date(to) };
  }
  return best || { inSeason: false, next: null, from: null, to: null };
}
// "a, b, c" → ['a', 'b', 'c'].
const lrWords = str => String(str || '').split(',').map(word => word.trim()).filter(Boolean);
/* ---- same meaning, different writing (Part A2) ---- */
/** One spelling for words that mean the same, so a word or a template part is found however a person wrote it: lower case;
 *  hyphens, commas and "|" as spaces; "&" = and, "w/" = with, Pc / Pcs = Pieces, "2 Pack" / "Pack of 2" / "2 Pcs" = Set of 2;
 *  Inches = Inch; Grey = Gray; Colour = Color; Table Cloth / Table-Cloth = Tablecloth; Cushion Cover = Pillow Cover;
 *  Block-Print / Blockprint / Block Printed / Hand Block Printed = Block Print; and a plural reads as its singular
 *  (Covers = Cover, Napkins = Napkin). Both sides of every comparison go through it, so what is compared is the meaning. */
function lrNorm(text) {
  return String(text || '').toLowerCase()
    .replace(/[-,|]+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\bw\//g, ' with ')
    .replace(/\bpack of (\d+)\b/g, 'set of $1')
    .replace(/\b(\d+)\s*(?:pack|pieces|pcs?)\b/g, 'set of $1')
    .replace(/\bpcs?\b/g, 'pieces')
    .replace(/\binches\b/g, 'inch')
    .replace(/\bgrey\b/g, 'gray')
    .replace(/\bcolour/g, 'color')
    .replace(/\btable\s*cloths?\b/g, 'tablecloth')
    .replace(/\bcushion\s+covers?\b/g, 'pillow cover')
    .replace(/\b(?:hand\s+)?block\s*print(?:ed|s)?\b/g, 'block print')
    .replace(/\b([a-z]{4,})s\b/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
// Where a word (or phrase) sits in a text, both read the same way (lrNorm); -1 when it is not there. Whole words only.
function lrFind(text, word) {
  const low = lrNorm(text);
  const want = lrNorm(word);
  if (!want) return -1;
  const m = new RegExp('(^|[^a-z0-9])' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?=$|[^a-z0-9])').exec(low);
  return m ? m.index + m[1].length : -1;
}
// Whole-word test for a word (or phrase) in a text — however either is written (case, plural, Grey/Gray, Table Cloth …).
const lrHas = (text, word) => lrFind(text, word) >= 0;

/* ---- what people may write (Part A): the settings, with the defaults behind whatever was saved ---- */
// The allowances in force: { shortFrom, brandWords: { SP, CPC }, embroideryColors } — the saved values over the defaults.
function lrAllow(cfg) {
  const base = LR_DEFAULT.allow;
  const own = (cfg && cfg.allow) || {};
  return { shortFrom: +own.shortFrom > 0 ? +own.shortFrom : base.shortFrom,
    brandWords: Object.assign({}, base.brandWords, own.brandWords || {}),
    embroideryColors: own.embroideryColors != null ? String(own.embroideryColors) : base.embroideryColors };
}
// True when a title sits in the band where the short forms are allowed: from "Short forms allowed from" up to 75 characters.
const lrNear = (title, cfg) => String(title || '').length >= lrAllow(cfg).shortFrom && String(title || '').length <= 75;
// The words that mean this listing's own brand (Part A3): Amazon's brand for it when Sellora has read it, else the "Brand
// words" setting; "the", "my", "by" and punctuation do not count. [] when nothing is known — then the brand is not judged.
const LR_BRAND_SKIP = ['the', 'my', 'by', 'and', 'of'];
function lrBrandWords(row, cfg) {
  const text = row.amzBrand || lrAllow(cfg).brandWords[row.brand] || '';
  return lrNorm(text).split(/[^a-z0-9]+/).filter(word => word.length > 1 && !LR_BRAND_SKIP.includes(word));
}
// The brand as a title should write it: Amazon's own for the listing, else the setting's first phrase, else the brand's name.
const lrBrandName = (row, cfg) => String(row.amzBrand || lrWords(lrAllow(cfg).brandWords[row.brand])[0] || BRAND_NAME[row.brand] || row.brand || '');
// This listing's colour: Amazon's colour attribute when read, else the catalogue's, else the colour part of its title (after
// the last " - ", where the templates put it), else ''.
function lrColorOf(row) {
  if (row.amzColor) return String(row.amzColor);
  const cat = lrCatOf(row);
  if (cat && cat.color) return String(cat.color);
  const title = hTitleText(row);
  const dash = title.lastIndexOf(' - ');
  return dash >= 0 && title.length - dash <= 32 ? title.slice(dash + 3).trim() : '';
}
// True when every word of a colour is one of the embroidery colours' words ("Off White" is; "Blue & White" is not).
function lrIsEmbroideryColor(color, cfg) {
  const words = lrNorm(color).split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return false;
  const emb = new Set(lrWords(lrAllow(cfg).embroideryColors).flatMap(each => lrNorm(each).split(/[^a-z]+/)).filter(Boolean));
  return words.every(word => emb.has(word));
}
// "25 Dec 2026", or — for no date.
const lrFmtDate = date => date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

/* ---- sizes ---- */
/** The approved way to write a size, taken from the example the rule carries ("14 x 36 Inch"). */
function lrSizeOk(text, example) {
  const shape = String(example || '14 x 36 Inch').replace(/\d+(?:\.\d+)?/g, 'N');
  return String(text).replace(/\d+(?:\.\d+)?/g, 'N') === shape || String(text).replace(/\d+(?:\.\d+)?/g, 'N') === shape.replace('N x N', 'N x N x N');
}
/** The short forms a person uses to fit 75 characters (Part A1): the unit as Inc, In, In., in, " ″ ” or left out, Inches as
 *  Inch / In, Centimeter as cm, and no spaces around x, X or × — "18x18", "18X18 Inc", "18×18", "18 x 18 In". */
function lrSizeLoose(text) {
  return /^N\s*[x×X]\s*N(?:\s*[x×X]\s*N)?\s*(?:inches|inch|inc\.?|in\.?|"|”|″|cm)?$/i.test(String(text).replace(/\d+(?:\.\d+)?/g, 'N'));
}
/** Every W x H (or W x H x D) written in a title, exactly as written, with the unit that follows it. */
// Returns [{ text, a, b, c }]: the text as written, the two or three numbers (c is null for W x H). Inc, In and In. read as inch.
function hTitleSizes(title) {
  const out = [];
  const unit = '(?:"|”|″|inc\\.?(?![a-z])|in\\.?(?![a-z])|inch(?:es)?(?![a-z])|cm(?![a-z]))';
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}?\\s*[x×X*]\\s*(\\d+(?:\\.\\d+)?)(?:\\s*${unit}?\\s*[x×X*]\\s*(\\d+(?:\\.\\d+)?))?(\\s*${unit})?`, 'gi');
  let match;
  while ((match = re.exec(String(title || '')))) {
    out.push({ text: match[0].trim(), a: +match[1], b: +match[2], c: match[3] ? +match[3] : null });
  }
  return out;
}
/** A size's written shape, read by meaning (Part A2): "18x18" = "18 x 18" = "18×18", and "18x18 Inc" = "18 x 18 Inch" — but a
 *  size with a unit and one without are still two shapes, as are two and three numbers. */
const lrSizeShape = str => String(str).replace(/\d+(?:\.\d+)?/g, 'N').toLowerCase()
  .replace(/(inches|inch|inc\.?|in\.?|"|”|″)(?![a-z])/g, ' inch ').replace(/\bcm\b/g, ' cm ')
  .replace(/\s*[x×*]\s*/g, 'x').replace(/\s+/g, ' ').trim();
/**
 * The title text to judge — the catalog's full title first, else the listings report's. A title cached
 * before 15 Sept was cut at 60 characters; one of exactly 60 that is not marked full is not judged.
 */
const hTitleText = row => (row.content && row.content.title) || ((row.titleFull || String(row.title || '').length !== 60) ? (row.title || '') : '');
/** Search-term bytes the way Amazon counts them (Part A4): the UTF-8 bytes of the words only — spaces and the punctuation
 *  ; , . do not count toward the limit. */
function lrKwBytes(text) {
  const words = String(text || '').replace(/[\s;,.]+/g, '');
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(words).length : Buffer.byteLength(words, 'utf8');
}

/* ---- the template ---- */
// The first template for this listing's brand whose `match` is in its catalogue sub-category ('' matches anything), or null.
function lrTemplateFor(row, cfg) {
  const cat = lrCatOf(row);
  if (!cat) return null;
  return (cfg.templates || []).find(tpl => (tpl.brand === 'ALL' || tpl.brand === row.brand)
    && (!tpl.match || String(cat.subcat || '').toLowerCase().includes(String(tpl.match).toLowerCase()))) || null;
}
// This listing's catalogue row { color, size, subcat }, or null.
const lrCatOf = row => (LR_CAT[row.brand] && LR_CAT[row.brand][row.sku]) || null;
// The shape word in a sub-category ("Rectangle Tablecloth" → "Rectangle"), or ''.
const lrShape = sub => (String(sub || '').match(/\b(Rectangle|Rectangular|Round|Square|Oval)\b/i) || [])[1] || '';
/** "60x90" from the catalog, written the approved way. */
const lrSizeText = (size, example) => {
  const nums = String(size || '').match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2 || nums.length > 3) return '';
  return nums.join(' x ') + ' ' + (String(example || '14 x 36 Inch').replace(/^[\d.\sx]+/i, '') || 'Inch');
};
/** Occasions in season today, in the order they fall. */
function lrOccasionsNow(cfg, today) {
  return (cfg.events || []).map(e => ({ e, s: lrSeason(e, today, cfg.events) })).filter(each => each.s.inSeason)
    .sort((a, b) => a.s.next - b.s.next).map(each => each.e.name.replace(/'s$/, "'s"));
}
/** The parts a template asks for, filled from what this SKU is. */
function lrParts(row, tpl, cfg, today) {
  const cat = lrCatOf(row) || {};
  const example = ((cfg.issues || []).find(issue => issue.detector === 'size_format') || {}).params;   // the size_format rule's settings
  return {
    brand: lrBrandName(row, cfg), product: tpl.product || '', shape: lrShape(cat.subcat),
    material: tpl.material || '', size: lrSizeText(cat.size, example && example.example), pattern: tpl.pattern || '',
    uses: tpl.uses || '', occasions: lrOccasionsNow(cfg, today).join(' '), color: cat.color || '',
  };
}
/** The title the template would write for this listing. */
// Fills the template's tokens from lrParts, tidies the spaces and dashes, and drops occasions, then uses, to fit 200 characters.
function lrSuggest(row, cfg, today) {
  cfg = cfg || LR || LR_DEFAULT;
  today = today || new Date();
  const tpl = lrTemplateFor(row, cfg);
  if (!tpl) return '';
  const parts = lrParts(row, tpl, cfg, today);
  const fill = drop => String(tpl.template || '').replace(/\{(\w+)\}/g, (_, key) => (drop.includes(key) ? '' : (parts[key] || '')))
    .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
  let out = fill([]);
  // Amazon's hard limit is 200 characters: occasions go first, then the uses phrase.
  if (out.length > 200) out = fill(['occasions']);
  if (out.length > 200) out = fill(['occasions', 'uses']);
  return out.slice(0, 200);
}

/* ---- the detectors: each answers '' (fine) or what it found ---- */
// Each detector is (row, ctx, params) → '' or the detail text; ctx is what hCtx built, params the rule's settings.
const LR_DET = {
  inactive_with_stock: row => (/inactive/i.test(row.status || '') && row.qty > 0) ? `${row.qty} in stock but the listing is Inactive` : '',
  no_price: row => row.price === 0 ? 'no price' : '',
  // Amazon's own verdict: the Workspace's live read of the listing first, else the Image Manager snapshot (lrAmz).
  amazon_suppressed: (row, ctx) => {
    const amz = lrFactsOf(row, ctx).amz;
    if (!amz || !amz.st) return '';
    const status = String(amz.st).toUpperCase();
    return status.includes('BUYABLE') && !status.includes('DISCOVERABLE') ? 'buyable by direct link, not in search' : '';
  },
  amazon_error: (row, ctx) => {
    const amz = lrFactsOf(row, ctx).amz;
    return amz && amz.ie ? (amz.im || amz.ie + ' error(s) reported by Amazon') : '';
  },
  /* PICTURES ARE JUDGED BY THE CATALOGUE (Part A1): what shoppers see, not what our listing's attributes hold. A listing whose
   * own MAIN slot is empty while the catalogue shows one has no error (a note says so). No picture data anywhere: not judged. */
  no_main_image: (row, ctx) => {
    const pics = lrFactsOf(row, ctx).pics;
    if (!pics || pics.main) return '';
    return pics.n ? `no main picture in the catalogue (${pics.n} other picture${pics.n === 1 ? '' : 's'})` : 'no picture in the catalogue';
  },
  aplus_missing: (row, ctx) => {
    const aplus = lrFactsOf(row, ctx).aplus;
    return aplus.v === false && !aplus.stale ? (row.parent ? 'no A+ published on the listing or its parent' : 'no A+ published') : '';
  },
  images_below: (row, ctx, params) => {
    const pics = lrFactsOf(row, ctx).pics;
    return pics && pics.main && pics.n < (+params.n || 6) ? `${pics.n} of ${+params.n || 6}` : '';
  },
  images_between: (row, ctx, params) => {
    const pics = lrFactsOf(row, ctx).pics;
    return pics && pics.main && pics.n >= (+params.min || 0) && pics.n <= (+params.max || 0) ? `${pics.n} pictures` : '';
  },
  bullets_below: (row, ctx, params) => (row.content && row.content.bullets < (+params.n || 5))
    ? `${row.content.bullets} of ${+params.n || 5}` : '',
  // When A+ is live on the listing or its parent, Amazon shows the A+ instead of the description (Part A3): not judged.
  desc_below: (row, ctx, params) => (row.content && row.content.descLen < (+params.n || 200) && lrFactsOf(row, ctx).aplus.v !== true)
    ? (row.content.descLen ? `${row.content.descLen} characters` : 'none') : '',
  // Search terms from the live Amazon read only (Part A4); "Search terms: 233 of 249 bytes" when fine, what to cut when over.
  keyword_bytes: (row, ctx, params) => {
    if (row.kw == null) return '';
    const max = +params.max || 249;
    const bytes = row.kwBytes != null ? row.kwBytes : lrKwBytes(row.kw);
    return bytes > max ? `${bytes} of ${max} bytes — cut ${bytes - max}; over the limit Amazon ignores all of them` : '';
  },
  title_length: (row, ctx, params) => (row.content && (row.content.titleLen < (+params.min || 0) || row.content.titleLen > (+params.max || 999)))
    ? `${row.content.titleLen} characters` : '',
  size_format: (row, ctx, params) => {
    const title = hTitleText(row);
    const near = lrNear(title, ctx.cfg);          // 74–75 characters: shortened on purpose to fit, so the short forms are fine (Part A1)
    const bad = hTitleSizes(title).find(size => !lrSizeOk(size.text, params.example) && !(near && lrSizeLoose(size.text)));
    return bad ? `"${bad.text}", approved is "${params.example || '14 x 36 Inch'}"` : '';
  },
  dimension_order: row => {
    const wrong = hTitleSizes(hTitleText(row)).find(size => size.c === null && size.a > size.b);
    return wrong ? `${wrong.a} x ${wrong.b} should be ${wrong.b} x ${wrong.a}` : '';
  },
  variation_value_missing: (row, ctx) => {
    const title = hTitleText(row);
    if (!title || !row.parent) return '';
    const group = ctx.parents.get(row.parent + '|' + row.brand);
    return group && group.sized > 0 && !hTitleSizes(title).length ? `no size in the title; ${group.sized} sibling(s) name theirs` : '';
  },
  variation_naming: (row, ctx) => {
    const title = hTitleText(row);
    const size = hTitleSizes(title)[0];
    if (!size || !row.parent) return '';
    if (lrNear(title, ctx.cfg)) return '';        // 74–75 characters: the short form was chosen to fit (Part A1)
    const group = ctx.parents.get(row.parent + '|' + row.brand);
    if (!group || group.shapes.size < 2) return '';
    const mine = lrSizeShape(size.text);
    return mine !== group.common ? `"${size.text}" while most siblings write "${group.commonExample}"` : '';
  },
  title_keyword: (row, ctx, params) => {
    const title = hTitleText(row);
    const words = lrWords(params.words);
    if (!title || !words.length || words.some(word => lrHas(title, word))) return '';
    /* BLOCK PRINT vs EMBROIDERY (Part A4): a white piece is embroidery and an embroidered piece is not block print, so neither
     * is asked for "Block Print"; any other piece is asked only with proof that it IS block print — a sibling's title under the
     * same parent, or its own bullets / description on Amazon say so. The message says which. */
    const bp = words.find(word => lrNorm(word) === 'block print');
    if (bp) {
      const proof = lrBlockPrintProof(row, ctx);
      return proof ? `no "${bp}" in the title, but ${proof}` : '';
    }
    return `no "${words.join('" or "')}"`;
  },
  title_contains: (row, ctx, params) => {
    const title = hTitleText(row);
    const hit = title ? lrWords(params.words).find(word => lrHas(title, word)) : null;
    return hit ? `says "${hit}"` : '';
  },
  title_template: (row, ctx) => {
    const title = hTitleText(row);
    const tpl = lrTemplateFor(row, ctx.cfg);
    if (!title || !tpl) return '';
    const low = lrNorm(title);                      // the title and every part read the same way (Part A2)
    const parts = lrParts(row, tpl, ctx.cfg, ctx.today);
    const need = lrWords(tpl.required || 'brand,product,size,color');
    // --- where each required part sits in the title: -2 nothing to look for, -1 missing, else its position ---
    const where = key => {
      if (key === 'brand') {                          // any of the brand's words is the brand (Part A3); none known: not judged
        const words = lrBrandWords(row, ctx.cfg);
        if (!words.length) return -2;
        const at = words.map(word => lrFind(low, word)).filter(idx => idx >= 0);
        return at.length ? Math.min(...at) : -1;
      }
      const value = parts[key];
      if (!value) return -2;                          // nothing to look for: not judged
      if (key === 'size') {                           // how it is written is size_format's job
        const size = hTitleSizes(title)[0];
        if (!size) return -1;
        const at = low.indexOf(lrNorm(size.text));
        return at >= 0 ? at : title.indexOf(size.text);
      }
      if (key === 'material') return low.search(/cotton|linen|polyester|jute|velvet/);
      if (key === 'product') {
        const words = lrNorm(value).split(/\s+/).filter(word => word.length > 3);
        const at = words.map(word => low.indexOf(word)).filter(idx => idx >= 0);
        return at.length ? Math.min(...at) : -1;
      }
      if (key === 'color') {
        /* A colour is found when any real word of it is in the title — the catalog says Neutral Ivory Grey, the title says Grey. */
        const at = lrNorm(value).split(/[^a-z]+/).filter(word => word.length > 2)
          .map(word => lrFind(low, word)).filter(idx => idx >= 0);
        return at.length ? Math.min(...at) : -1;
      }
      return low.indexOf(lrNorm(value));
    };
    // --- the required parts in template order: which are missing, and are the found ones in that order ---
    const order = String(tpl.template).match(/\{(\w+)\}/g).map(token => token.slice(1, -1)).filter(key => need.includes(key));
    const pos = order.map(key => [key, where(key)]).filter(([, idx]) => idx !== -2);
    const missing = pos.filter(([, idx]) => idx < 0).map(([key]) => key);
    const found = pos.filter(([, idx]) => idx >= 0).map(([, idx]) => idx);
    const outOfOrder = found.some((position, idx) => idx && position < found[idx - 1]);
    if (!missing.length && !outOfOrder) return '';
    return [missing.length ? 'missing ' + missing.join(', ') : '', outOfOrder ? 'parts in a different order' : ''].filter(Boolean).join(' · ');
  },
  seasonal_keyword: (row, ctx) => {
    const title = hTitleText(row);
    if (!title) return '';
    const cat = lrCatOf(row) || {};
    for (const ev of (ctx.cfg.events || [])) {
      const word = lrWords(ev.words).find(each => lrHas(title, each));
      if (!word) continue;
      if (lrWords(ev.except).some(each => lrHas(String(cat.subcat || '') + ' ' + String(cat.color || ''), each))) continue;
      const season = lrSeason(ev, ctx.today, ctx.cfg.events);
      if (season.inSeason) continue;
      return `"${word}" — ${ev.name} is ${season.next ? lrFmtDate(season.next) : 'not dated'}; it belongs in the title from ${season.from ? lrFmtDate(season.from) : '—'}`;
    }
    return '';
  },
};

/** Why a listing should say "Block Print" (Part A4), in words — or null when it should not be asked: its colour is an embroidery
 *  colour, it says Embroidered / Embroidery itself, or nothing proves it is block print (no sibling's title, no own bullets). */
function lrBlockPrintProof(row, ctx) {
  if (lrIsEmbroideryColor(lrColorOf(row), ctx.cfg)) return null;
  const words = row.amzWords || {};                 // from the live Amazon read: which rule words its bullets / description hold
  if (/embroider/.test(lrNorm(hTitleText(row))) || words.emb) return null;
  const group = row.parent ? ctx.parents.get(row.parent + '|' + row.brand) : null;
  const sib = group ? group.bp : 0;                 // this title has no Block Print, so every one counted is a sibling's
  if (!sib && !words.bp) return null;
  const parts = [];
  if (sib) parts.push(`${sib} of its siblings`);
  if (words.bp) parts.push('its bullets');
  return parts.join(' and ') + (sib === 1 && !words.bp ? ' says it' : ' say it');
}

/** What every listing is judged against at once: the rules, today, and what each parent's children look like. */
let H_CTX = null;

/* WHAT AMAZON SAYS ABOUT EACH LISTING, read from the Image Manager's snapshot (imgsnap + imgrows).
 * Status and Amazon's own issue list come back free on a call that walk already makes, so Listing
 * Health reads that snapshot rather than asking Amazon about 3,653 listings a second time.
 * Key is "<brand>|<sku>". Without a snapshot the two Amazon rules simply find nothing. */
const AMZ = { map: null, at: 0, busy: false, snapAt: { SP: 0, CPC: 0 } };   // map: "<brand>|<sku>" → { st, ie, iw, im }; at: when it was read; snapAt: the snapshot's own date per brand
// Read the Image Manager's snapshot chunks for both brands into AMZ.map, once.
async function amzEnsure() {
  if (AMZ.busy || AMZ.map) return;
  AMZ.busy = true;
  const map = new Map();
  try {
    for (const brand of ['SP', 'CPC']) {
      const head = await getDoc(doc(db, 'imgsnap', brand));
      if (!head.exists()) continue;
      const nChunks = head.data().chunks || 0;
      AMZ.snapAt[brand] = head.data().at && head.data().at.toDate ? head.data().at.toDate().getTime() : 0;
      const got = await Promise.all(Array.from({ length: nChunks }, (_, i) => getDoc(doc(db, 'imgrows', brand + '_' + i))));
      got.forEach(chunk => {
        if (!chunk.exists()) return;
        (chunk.data().r || []).forEach(item => {
          if (item && item.sku) map.set(brand + '|' + item.sku, { st: item.st || '', ie: item.ie || 0, iw: item.iw || 0, im: item.im || '' });
        });
      });
    }
    AMZ.map = map.size ? map : null;
    AMZ.at = Date.now();
    H_CTX = null;
  } catch (e) {
    AMZ.map = null;
  }
  AMZ.busy = false;
}
/* ---- the freshest data for one listing (Part A5): a Workspace live read, else the Image Manager snapshot, else the Health snapshot ---- */
// The Workspace's live reads and A+ answers (selloraWsLive), when that module is present: { live: { SP: { sku: entry } }, aplus:
// { SP: { asin: { v, at } } } } — the live maps themselves, read at judging time, so a landed answer needs no new context. hCtx
// hands them to every screen, so Parent ASINs,
// Child listings and the Workspace judge the same freshest data.
const lrWsLive = () => (typeof liWsLiveMap === 'function' ? liWsLiveMap() : null);
// The live read of one listing, or null.
const lrLiveOf = (row, ctx) => ((ctx.wsLive && ctx.wsLive[row.brand]) || {})[row.sku] || null;
// The Image Manager snapshot's item for one listing, or null.
const lrImlOf = (row, ctx) => (ctx.iml && ctx.iml[row.brand] ? ctx.iml[row.brand].get(row.sku) : null) || null;
// The gallery slots of a slot → url map or a slot list: MAIN + PT01–PT08, in order; the swatch (SWCH) is not a picture.
const lrGallery = slots => (Array.isArray(slots) ? slots : Object.keys(slots || {}).filter(slot => slots[slot]))
  .filter(slot => slot !== 'SWCH' && /^(MAIN|PT0[1-8])$/.test(slot));
/** The pictures shoppers see: { n, main, at, src: 'live' | 'iml' | 'health', own } — the catalogue slots of the Workspace's live
 *  read, else the Image Manager snapshot's live slots when newer than the listing's content read, else the Health snapshot's
 *  count (which cannot tell the swatch apart). `own`: our listing's own gallery slots when known (the live read). Null = unknown. */
function lrPictures(row, ctx) {
  const live = lrLiveOf(row, ctx);
  if (live && live.iAt && Array.isArray(live.cat)) {
    const g = lrGallery(live.cat);
    return { n: g.length, main: g.includes('MAIN'), at: live.iAt, src: 'live', own: live.gAt && Array.isArray(live.slots) ? lrGallery(live.slots) : null };
  }
  const iml = lrImlOf(row, ctx);
  const imlAt = (ctx.imlAt && ctx.imlAt[row.brand]) || 0;
  // The snapshot's catalogue answer counts only for an item the catalogue was asked about (one with an ASIN) and answered: an
  // empty live map on an item without an ASIN, or one marked liveErr, is no answer — never "no picture in the catalogue".
  const imlOk = iml && iml.live && iml.asin && !iml.liveErr && imlAt;
  const checked = row.checked || 0;
  const fromIml = () => {
    const g = lrGallery(iml.live);
    return { n: g.length, main: g.includes('MAIN'), at: imlAt, src: 'iml', own: iml.img ? lrGallery(iml.img) : null };
  };
  if (imlOk && imlAt > checked) return fromIml();
  if (row.content && row.content.images != null) {
    const n = Number(row.content.images) || 0;
    return { n, main: n > 0, at: checked, src: 'health', own: null };
  }
  return imlOk ? fromIml() : null;
}
/** A+ for one listing (Part A2): { v: true | false | undefined, at, stale, src, why }. A child has A+ when it or its parent ASIN has a
 *  publish record (the Workspace's answers first, then the Health snapshot's: the row's own and HEALTH[brand].parentAplus). Never
 *  asked, or the parent not asked yet: not judged. A "missing" answer older than LR_APLUS_DAYS is `stale` and asked again first. */
function lrAplus(row, ctx) {
  const ws = (ctx.wsAplus && ctx.wsAplus[row.brand]) || {};
  const saved = (ctx.parentAplus && ctx.parentAplus[row.brand]) || {};
  const newer = (a, b) => (a && b ? ((a.at || 0) >= (b.at || 0) ? a : b) : a || b || null);
  const child = newer(ws[row.asin], row.aplus === undefined ? null : { v: row.aplus, at: row.aplusAt || 0 });
  const parent = row.parent ? newer(ws[row.parent], saved[row.parent]) : null;
  if (child && child.v === true) return { v: true, at: child.at || 0, src: 'listing' };
  if (parent && parent.v === true) return { v: true, at: parent.at || 0, src: 'parent' };
  if (!child || child.v !== false) return { v: undefined, at: 0, why: 'A+ not asked yet' };
  if (row.parent && (!parent || parent.v !== false)) return { v: undefined, at: child.at || 0, note: true, why: "the listing has none, and its parent ASIN's A+ was not asked yet" };
  const at = Math.min(child.at || 0, parent ? parent.at || 0 : child.at || 0);
  const stale = !(at > 0) || Date.now() - at > LR_APLUS_DAYS * LR_DAY;
  return { v: false, at, stale, src: row.parent ? 'listing and parent' : 'listing', why: stale ? `the "no A+" answer is ${at > 0 ? Math.round((Date.now() - at) / LR_DAY) + ' days' : 'too'} old — asked again before it counts` : '' };
}
/** Amazon's own verdict on one listing: { st, ie, im, errs, at, src: 'live' | 'iml' } — the live read first, else the snapshot. Null = none. */
function lrAmz(row, ctx) {
  const live = lrLiveOf(row, ctx);
  if (live && live.gAt) {
    const errs = (live.iss || []).filter(issue => issue.s === 'E');
    return { st: (live.st || []).join(','), ie: errs.length, im: errs.map(issue => `ERROR ${issue.c}: ${issue.m}`).join(' · '), errs, at: live.gAt, src: 'live' };
  }
  const amz = ctx.amz && ctx.amz.get(row.brand + '|' + row.sku);
  return amz ? { st: amz.st, ie: amz.ie, im: amz.im, errs: null, at: (ctx.amzAt && ctx.amzAt[row.brand]) || 0, src: 'iml' } : null;
}
/** The listing with the freshest content on it: the live read's title / bullets / description / search terms, brand, colour and
 *  rule words (lrFresh), else exactly the Health row. `contentAt` says when that content was read; `kw` is only ever live. */
function lrFresh(row, ctx) {
  const live = lrLiveOf(row, ctx);
  const r = Object.assign({}, row);
  if (live && live.cAt) {
    r.content = { title: live.title || '', titleLen: live.titleLen || 0, bullets: live.bul || 0, descLen: live.desc || 0, images: row.content ? row.content.images : null };
    r.contentAt = live.cAt;
    r.contentSrc = 'live';
    r.kw = live.kw || '';
    // Counted from the text itself whenever the text is whole (the live read keeps up to 300 characters of it); the stored count
    // is used only for a longer text — so a count stored the old way (with the spaces) can never make a listing look over.
    r.kwBytes = r.kw.length >= 300 && live.kwBytes != null ? live.kwBytes : lrKwBytes(r.kw);
  } else {
    r.contentAt = row.checked || 0;
    r.contentSrc = row.content ? 'health' : '';
  }
  if (live && live.brand) r.amzBrand = live.brand;
  if (live && live.color) r.amzColor = live.color;
  if (live && live.words) r.amzWords = live.words;
  return r;
}
// The facts the detectors read, worked out once per listing: { pics, aplus, amz, live }.
const lrFacts = (row, ctx) => ({ pics: lrPictures(row, ctx), aplus: lrAplus(row, ctx), amz: lrAmz(row, ctx), live: lrLiveOf(row, ctx) });
const lrFactsOf = (row, ctx) => row._f || (row._f = lrFacts(row, ctx));
// What each detector's answer rests on, for the age of the data behind a finding (Part A5).
const LR_DET_SRC = { inactive_with_stock: 'report', no_price: 'report', amazon_suppressed: 'amz', amazon_error: 'amz', no_main_image: 'pics',
  images_below: 'pics', images_between: 'pics', aplus_missing: 'aplus', bullets_below: 'content', desc_below: 'content', title_length: 'content',
  keyword_bytes: 'content' };
// When the data behind one finding was read (ms), 0 when not known: title rules read the content title when there is one, else the report.
function lrDataAt(hit, row, ctx) {
  const kind = LR_DET_SRC[hit.detector] || (row.content ? 'content' : 'report');
  const facts = lrFactsOf(row, ctx);
  if (kind === 'report') return (ctx.healthAt && ctx.healthAt[row.brand]) || 0;
  if (kind === 'amz') return facts.amz ? facts.amz.at : 0;
  if (kind === 'pics') return facts.pics ? facts.pics.at : 0;
  if (kind === 'aplus') return facts.aplus.at || 0;
  return row.contentAt || 0;
}

// Build (or reuse) the context every detector reads: the rules, today, each parent's children's sizes, Amazon's status map, the
// snapshots' dates, the Image Manager snapshot by SKU and the Workspace's live reads.
function hCtx(rowsAll) {
  const cfg = LR || LR_DEFAULT;
  const rows = rowsAll || ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || [])
    .map(row => (row.brand ? row : Object.assign({ brand: b }, row))));
  const ws = lrWsLive();
  const imlOf = b => (typeof IML !== 'undefined' && IML && IML[b]) || null;
  // --- reuse the last context while nothing it depends on has changed ---
  const withContent = rows.reduce((count, row) => count + (row.content ? 1 : 0), 0);
  const key = [rows.length, withContent, LR_CAT.SP ? 1 : 0, LR_CAT.CPC ? 1 : 0, AMZ.at, ws ? 1 : 0,
    ['SP', 'CPC'].map(b => (HEALTH[b] && HEALTH[b].parentAplusAt) || 0).join(',')].join('|');
  if (H_CTX && H_CTX.cfg === cfg && H_CTX.sp === HEALTH.SP && H_CTX.cpc === HEALTH.CPC && H_CTX.key === key
      && H_CTX.imlSP === imlOf('SP') && H_CTX.imlCPC === imlOf('CPC') && H_CTX.day === new Date().toDateString()) return H_CTX;
  // --- per parent: how many children name a size, and how they write it ---
  const parents = new Map();
  rows.forEach(row => {
    if (!row.parent) return;
    const parentKey = row.parent + '|' + row.brand;
    const group = parents.get(parentKey) || { sized: 0, bp: 0, shapes: new Map(), examples: new Map() };
    const title = hTitleText(row);
    if (lrNorm(title).includes('block print')) group.bp++;   // how many children say Block Print (the Block Print rule's proof)
    const size = hTitleSizes(title)[0];
    if (size) {
      group.sized++;
      const shape = lrSizeShape(size.text);
      group.shapes.set(shape, (group.shapes.get(shape) || 0) + 1);
      if (!group.examples.has(shape)) group.examples.set(shape, size.text);
    }
    parents.set(parentKey, group);
  });
  parents.forEach(group => {
    const top = [...group.shapes.entries()].sort((a, b) => b[1] - a[1])[0];
    group.common = top ? top[0] : '';
    group.commonExample = top ? group.examples.get(top[0]) : '';
  });
  // --- the sources' dates and indexes: the Health snapshot per brand, the Image Manager snapshot by SKU, the parents' A+ ---
  const healthAt = {};
  const parentAplus = {};
  const imlAt = {};
  const iml = {};
  ['SP', 'CPC'].forEach(b => {
    healthAt[b] = HEALTH[b] && HEALTH[b].at ? HEALTH[b].at.getTime() : 0;
    parentAplus[b] = (HEALTH[b] && HEALTH[b].parentAplus) || {};
    const snap = imlOf(b);
    imlAt[b] = snap && snap.at ? snap.at.getTime() : 0;
    const map = new Map();
    ((snap && snap.items) || []).forEach(item => { if (item && item.sku && item.lvl !== 'parent') map.set(item.sku, item); });
    iml[b] = map;
  });
  H_CTX = { cfg, today: new Date(), parents, amz: AMZ.map, amzAt: AMZ.snapAt, sp: HEALTH.SP, cpc: HEALTH.CPC, key, day: new Date().toDateString(),
    wsLive: ws ? ws.live : null, wsAplus: ws ? ws.aplus : null, healthAt, parentAplus, imlAt, iml, imlSP: imlOf('SP'), imlCPC: imlOf('CPC') };
  return H_CTX;
}

// Score one listing: run every rule that is on over its freshest data (lrFresh), then { score, bucket, grade, critical[], action[],
// review[], found[], blocking[], content[], fresh, pics, aplus, amz, notes[] }. Each finding carries fix, tag, kind, at (when its data
// was read) and stale (an Error resting only on data older than LR_STALE_DAYS: "Error? Check again").
function healthOf(rowIn, ctx) {
  ctx = ctx || hCtx();
  const row = lrFresh(rowIn, ctx);
  const facts = lrFactsOf(row, ctx);
  // --- run the detectors ---
  const found = [];
  (ctx.cfg.issues || []).forEach(rule => {
    if (rule.on === false || !LR_SEV[rule.sev]) return;
    const det = LR_DET[rule.detector];
    if (!det) return;
    let result = '';
    try {
      result = det(row, ctx, rule.params || {}) || '';
    } catch (e) {
      result = '';
    }
    if (result) found.push({ id: rule.id, name: rule.name, sev: rule.sev, area: rule.area, detail: result, detector: rule.detector, params: rule.params || {} });
  });
  // --- out of stock softens Critical to Attention, except the HARD list ---
  /* NOTHING IN STOCK IS NEVER CRITICAL (Ravi, 15 Sept). A listing with 0 units is not losing sales today,
   * so what would be critical waits one step down, as Attention, and says why. Unknown stock (null) is
   * not zero and changes nothing. */
  /* EXCEPT NO IMAGE AT ALL (Ravi, 5 Oct 2026: "OOS me bhi no image ko laal dikhao") — that stays Critical with no stock too. */
  /* AND NOT WHAT AMAZON ITSELF REPORTS (9 Oct 2026): a suppression or an Amazon ERROR is a fault in
   * the listing, not a sale being missed today — it survives the restock, so it stays red. */
  const HARD = ['no_main_image', 'amazon_suppressed', 'amazon_error'];
  if (row.qty === 0) found.forEach(hit => {
    if (hit.sev === 'critical' && HARD.indexOf(hit.detector) < 0) {
      hit.sev = 'action';
      hit.detail += ' (0 in stock, so not critical)';
    }
  });
  // --- how to fix each one, in plain words, whose rule it is, where its Fix button goes (Part B), and how old its data is (A5) ---
  const now = Date.now();
  found.forEach(hit => {
    hit.fix = lrFixText(hit, row, ctx);
    hit.tag = lrFixTag(hit, row);
    hit.kind = lrFixKind(hit.detector);
    hit.src = LR_DET_SRC[hit.detector] || (row.content ? 'content' : 'report');   // what its data is: report | amz | pics | aplus | content
    hit.at = lrDataAt(hit, row, ctx);
    // An Error rests on old data when its data is older than LR_STALE_DAYS; undated data counts as old, except the listings
    // report (no date = no snapshot date kept, not an old one).
    hit.stale = hit.sev === 'critical' && (hit.at > 0 ? now - hit.at > LR_STALE_DAYS * LR_DAY : hit.src !== 'report');
  });
  // --- notes: things that are not errors but a person would want to know (grey, never counted) ---
  const notes = [];
  if (facts.pics && facts.pics.own && !facts.pics.own.includes('MAIN') && facts.pics.main) notes.push('Amazon shows a main picture from the catalogue (our own MAIN slot is empty)');
  if (facts.aplus.v === undefined && facts.aplus.note) notes.push('A+ not judged: ' + facts.aplus.why);
  if (facts.aplus.v === false && facts.aplus.stale) notes.push('A+ not judged yet: ' + facts.aplus.why);
  // --- bucket, grade and score ---
  const list = sev => found.filter(hit => hit.sev === sev).map(hit => hit.name + ' — ' + hit.detail);
  const critical = list('critical');
  const action = list('action');
  const review = list('review');
  const notSelling = row.qty === 0 || /inactive/i.test(row.status || '');
  const bucket = critical.length ? 'critical' : action.length ? 'action' : review.length ? 'review'
    : (notSelling ? 'monitor' : (row.content ? 'healthy' : 'unchecked'));
  const score = Math.max(0, Math.min(100, 100 - critical.length * 40 - action.length * 10 - review.length * 3));
  return { score, bucket, grade: H_BUCKETS[bucket], critical, action, review, found,
    blocking: critical, content: action.concat(review), fresh: row, pics: facts.pics, aplus: facts.aplus, amz: facts.amz, notes,
    stale: bucket === 'critical' && found.filter(hit => hit.sev === 'critical').every(hit => hit.stale) };
}

/** The worst severity found in one area of a listing: 'critical' | 'action' | 'review' | '' (none). */
const hAreaSev = (health, area) => health.found.filter(hit => hit.area === area).sort((a, b) => LR_SEV[b.sev].rank - LR_SEV[a.sev].rank)[0] || null;

/* ---- how to fix, in plain words (Part B1) ---- */
// "2 more pictures", "1 more picture".
const lrN = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// The gallery picture count the catalogue shows for a listing (the same count the picture rules judged).
const lrImages = (row, ctx) => { const pics = ctx ? lrFactsOf(row, ctx).pics : null; return pics ? pics.n : (row.content ? Number(row.content.images) || 0 : 0); };
// The template's parts in words a seller uses, with the listing's own values.
function lrPartWords(key, parts) {
  const value = parts[key] || '';
  const names = { brand: 'the brand', product: 'the product', shape: 'the shape', material: 'the material', size: 'the size', color: 'the colour', pattern: 'the print', uses: 'the uses' };
  return (names[key] || key) + (value ? ` "${value}"` : '');
}
/** One sentence per detector: what to do, with the listing's own values. (hit, row, ctx, params) → text. Plain words for a
 *  seller — never a detector id, a field code or a list of rules. */
const LR_FIX_TEXT = {
  inactive_with_stock: () => 'It has stock but is Inactive. Open Listing Errors to see why.',
  no_price: () => 'Add a price in Seller Central.',
  amazon_suppressed: () => 'Fix the issue in Listing Errors so it shows in Amazon search again.',
  amazon_error: hit => 'Open Listing Errors and do what Amazon asks: ' + String(hit.detail).replace(/\.?\s*$/, '.'),
  no_main_image: () => 'Add a main picture in Image Manager — the catalogue shows none, so shoppers see no picture.',
  aplus_missing: (hit, row) => (row.parent ? 'Publish A+ content on the listing or its parent ASIN.' : 'Publish A+ content.'),
  images_below: (hit, row, ctx, params) => {
    const have = lrImages(row, ctx);
    const need = +params.n || 6;
    return `Add ${lrN(need - have, 'more picture')} in Image Manager (the catalogue shows ${have}, needs ${need}).`;
  },
  images_between: (hit, row, ctx, params) => {
    const have = lrImages(row, ctx);
    const ideal = (+params.max || 7) + 1;
    return `Add ${lrN(ideal - have, 'more picture')} in Image Manager to reach ${ideal} (the catalogue shows ${have}).`;
  },
  keyword_bytes: (hit, row, ctx, params) => {
    const max = +params.max || 249;
    const bytes = row.kwBytes != null ? row.kwBytes : lrKwBytes(row.kw);
    return `Cut ${lrN(bytes - max, 'byte')} from the search terms in Listing Errors (${bytes} of ${max}); over the limit Amazon ignores all of them.`;
  },
  bullets_below: (hit, row, ctx, params) => `Add bullets until there are ${+params.n || 5} (it has ${row.content ? row.content.bullets || 0 : 0}).`,
  desc_below: (hit, row, ctx, params) => `Write a description of ${+params.n || 200}+ characters (it has ${row.content && row.content.descLen ? row.content.descLen : 'none'}).`,
  title_length: (hit, row, ctx, params) => `Make the title ${+params.min || 0} to ${+params.max || 999} characters (now ${row.content ? row.content.titleLen : hTitleText(row).length}).`,
  size_format: (hit, row, ctx, params) => {
    const title = hTitleText(row);
    const near = lrNear(title, ctx.cfg);
    const bad = hTitleSizes(title).find(size => !lrSizeOk(size.text, params.example) && !(near && lrSizeLoose(size.text)));
    const example = params.example || '14 x 36 Inch';
    if (!bad) return `Write the size as "${example}".`;
    const want = lrSizeText([bad.a, bad.b].concat(bad.c === null ? [] : [bad.c]).join('x'), example) || example;
    const from = lrAllow(ctx.cfg).shortFrom;
    const why = title.length < from ? ` and the title is only ${title.length} characters (short forms are allowed from ${from})`
      : title.length > 75 ? ` and the title is ${title.length} characters, over 75, so a short form does not help` : '';
    return `Write the size as "${want}". It says "${bad.text}"${why}.`;
  },
  dimension_order: (hit, row) => {
    const wrong = hTitleSizes(hTitleText(row)).find(size => size.c === null && size.a > size.b);
    return wrong ? `Put the smaller number first: "${wrong.b} x ${wrong.a}".` : 'Put the smaller number first.';
  },
  variation_value_missing: (hit, row, ctx) => {
    const group = ctx.parents.get(row.parent + '|' + row.brand);
    return `Add the size to the title${group && group.commonExample ? `, as its siblings do ("${group.commonExample}")` : ''}.`;
  },
  variation_naming: (hit, row, ctx) => {
    const group = ctx.parents.get(row.parent + '|' + row.brand);
    const size = hTitleSizes(hTitleText(row))[0];
    return `Write the size like its siblings: "${group ? group.commonExample : ''}"${size ? ` (it says "${size.text}")` : ''}.`;
  },
  title_keyword: (hit, row, ctx, params) => {
    const word = lrWords(params.words)[0] || '';
    const why = (String(hit.detail).match(/, but (.+)$/) || [])[1];
    return `Add "${word}" to the title${why ? ', because ' + why : ''}.`;
  },
  title_contains: hit => {
    const word = (String(hit.detail).match(/"([^"]+)"/) || [])[1];
    return word ? `Take "${word}" out of the title.` : 'Take the word out of the title.';
  },
  title_template: (hit, row, ctx) => {
    const tpl = lrTemplateFor(row, ctx.cfg);
    if (!tpl) return 'Write the title the way its template says.';
    const parts = lrParts(row, tpl, ctx.cfg, ctx.today);
    const need = lrWords(tpl.required || 'brand,product,size,color');
    const order = String(tpl.template).match(/\{(\w+)\}/g).map(token => token.slice(1, -1)).filter(key => need.includes(key));
    const orderWords = order.map(key => lrPartWords(key, {}).replace(/^the /, '')).join(', ');
    const missing = ((String(hit.detail).match(/missing ([^·]+)/) || [])[1] || '').split(',').map(part => part.trim()).filter(Boolean);
    const wrongOrder = /different order/.test(hit.detail);
    if (missing.length === 1 && missing[0] === 'brand') return `Put the brand in the title: "${parts.brand} …".${wrongOrder ? ` Keep the template's order: ${orderWords}.` : ''}`;
    if (!missing.length) return `Put the title's parts in the template's order: ${orderWords}.`;
    return `Add ${missing.map(key => lrPartWords(key, parts)).join(', ')} to the title${wrongOrder ? `, in the template's order: ${orderWords}` : ''}.`;
  },
  seasonal_keyword: hit => {
    const m = String(hit.detail).match(/^"([^"]+)" — .+; it belongs in the title from (.+)$/);
    return m ? `Remove "${m[1]}" from the title until its season (from ${m[2]}).` : 'Remove the occasion from the title until its season.';
  },
};
// The fix sentence of one finding; a detector without one, or one that fails, falls back to naming the rule.
function lrFixText(hit, row, ctx) {
  const fn = LR_FIX_TEXT[hit.detector];
  const clean = Object.assign({}, hit, { detail: String(hit.detail).replace(/ \(0 in stock, so not critical\)$/, '') });   // the stock note is not part of the finding
  try {
    return (fn && fn(clean, row, ctx, hit.params || {})) || `See the rule "${hit.name}" in Listing Rules.`;
  } catch (e) {
    return `See the rule "${hit.name}" in Listing Rules.`;
  }
}
/* ---- whose rule it is, and where the Fix button goes ---- */
// "Amazon": Amazon itself reports or demands it. "Amazon limit": one of Amazon's own limits. Everything else: "Company rule".
const LR_FIX_TAG = { amazon_suppressed: 'Amazon', amazon_error: 'Amazon', no_main_image: 'Amazon', inactive_with_stock: 'Amazon', no_price: 'Amazon', keyword_bytes: 'Amazon limit' };
const LR_TAG_TIP = { Amazon: 'Amazon itself reports this.', 'Amazon limit': "One of Amazon's own limits.", 'Company rule': 'Your own rule. Amazon does not check this.' };
function lrFixTag(hit, row) {
  if (LR_FIX_TAG[hit.detector]) return LR_FIX_TAG[hit.detector];
  const params = hit.params || {};
  if (hit.detector === 'title_length' && +params.max >= 75 && row.content && row.content.titleLen > +params.max) return 'Amazon limit';
  return 'Company rule';
}
// The Image Manager for pictures, nothing for A+ (no screen here), Listing Errors for everything else.
const LR_FIX_IMG = ['no_main_image', 'images_below', 'images_between'];
const lrFixKind = detector => (LR_FIX_IMG.includes(detector) ? 'img' : detector === 'aplus_missing' ? '' : 'lerr');

/* ---- one look for every problem, on every screen (Part B2): dot · level word · what is wrong · how to fix · tag · Fix ---- */
// `where`: { brand, sku, attrs } — the listing the Fix button opens (attrs: attribute names Listing Errors should show boxes
// for even when no Amazon issue names them); null for no button. `note`: a short grey line under it (source · when), or ''.
// The level word is one of two (Part B1): "Error: fix first" or "Needs attention"; an Error whose data is older than
// LR_STALE_DAYS reads "Error? Check again" and carries a Check now button that reads the listing from Amazon (Part A5).
function lrProblemHtml(hit, where, note) {
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const level = lrLevel(hit.sev);
  const stale = hit.sev === 'critical' && !!hit.stale;
  const tag = hit.tag || 'Company rule';
  const kind = hit.kind == null ? lrFixKind(hit.detector) : hit.kind;
  const fix = where && kind ? `<button type="button" class="ghost lr-fixbtn" data-lr-fix="${esc(kind)}|${esc(where.brand)}|${esc(where.sku)}"`
    + (where.attrs && where.attrs.length ? ` data-lr-attrs="${esc(where.attrs.join(','))}"` : '')
    + ` title="${kind === 'img' ? 'Opens the Image Manager' : 'Opens Listing Errors'}">Fix</button>` : '';
  // Price, stock and status come from the listings report, which only "Refresh both brands" renews — so no Check now for those.
  const fromReport = hit.src === 'report';
  const check = stale && where && !fromReport ? `<button type="button" class="ghost lr-checkbtn" data-lr-check="${esc(where.brand)}|${esc(where.sku)}"`
    + ` title="Reads this listing from Amazon now">Check now</button>` : '';
  const age = hit.at > 0 ? Math.round((Date.now() - hit.at) / LR_DAY) : 0;
  const ageWords = age ? age + ' days old' : 'with no date';
  const staleWhy = stale ? (fromReport ? ` (from the listings report ${ageWords} — press “Refresh both brands”)` : ` (from data ${ageWords})`) : '';
  return `<div class="lr-prob${stale ? ' is-stale' : ''}"><span class="sev ${stale ? 'sev-s' : level.cls}" title="${esc(stale ? level.stale : level.word)}"></span><div class="lr-prob-body">`
    + `<div class="lr-prob-what"><span class="lr-lvl ${stale ? 'is-s' : hit.sev === 'critical' ? 'is-c' : 'is-a'}">${esc(stale ? level.stale : level.word)}</span>${esc(hit.what || (hit.name + ' — ' + hit.detail))}${esc(staleWhy)}</div>`
    + `<div class="lr-prob-how">${esc(hit.fix || '')}</div>${note ? `<div class="lr-prob-src">${esc(note)}</div>` : ''}</div>`
    + `<span class="lr-tag${tag === 'Company rule' ? ' is-own' : ''}" title="${esc(LR_TAG_TIP[tag] || '')}">${esc(tag)}</span>${check}${fix}</div>`;
}
/* ---- a problem as one ROW (the Listing Health look, 6 Nov 2026), like the Ad Console's recommendation rows: a dot through the
 *      level's colour · the level word and the name, a grey subtitle · how to fix · a tag · Fix. The Workspace side panel and the
 *      children dialog draw with it; lrProblemHtml above stays the block every other screen uses. ---- */
// `rec`: { sev, stale, name, sub, fix, tag, kind, detector, attrs, fill } — `fill` marks a "Good to fill" gap (not an error: no level
// word, a blue dot). `where`: { brand, sku } for the Fix button, or null for none.
function lrRecHtml(rec, where) {
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const stale = rec.sev === 'critical' && !!rec.stale;
  const cls = rec.fill ? 'is-fill' : rec.sev === 'critical' ? (stale ? 'is-chk' : 'is-err') : 'is-att';
  const level = lrLevel(rec.sev);
  const word = rec.fill ? 'Good to fill' : stale ? level.stale : level.word;
  const tag = rec.fill ? 'Good to fill' : (rec.tag || 'Company rule');
  const kind = rec.kind == null ? lrFixKind(rec.detector) : rec.kind;
  const fix = where && kind ? `<button type="button" class="ghost lr-fixbtn" data-lr-fix="${esc(kind)}|${esc(where.brand)}|${esc(where.sku)}"`
    + (rec.attrs && rec.attrs.length ? ` data-lr-attrs="${esc(rec.attrs.join(','))}"` : '')
    + ` title="${kind === 'img' ? 'Opens the Image Manager' : 'Opens Listing Errors'}">Fix</button>` : '';
  return `<div class="ls-rec ${cls}"><span class="ls-dot" aria-hidden="true"></span><div class="ls-rec-t">`
    + `<b><span class="lr-lvl ${rec.fill ? 'is-f' : stale ? 'is-s' : rec.sev === 'critical' ? 'is-c' : 'is-a'}">${esc(word)}</span>${esc(rec.name)}</b>`
    + (rec.sub ? `<small title="${esc(rec.sub)}">${esc(rec.sub)}</small>` : '') + '</div>'
    + `<div class="ls-rec-a"><span class="lr-tag${tag === 'Company rule' ? ' is-own' : ''}${rec.fill ? ' is-fill' : ''}" title="${esc(LR_TAG_TIP[tag] || (rec.fill ? 'Not an error: a gap worth filling.' : ''))}">${esc(tag)}</span>${fix}</div>`
    + (rec.fix ? `<div class="ls-rec-how">${esc(rec.fix)}</div>` : '') + '</div>';
}
// One finding of healthOf as that row.
const lrHitRec = (hit, where) => lrRecHtml({ sev: hit.sev, stale: hit.stale, name: hit.name, sub: hit.detail, fix: hit.fix, tag: hit.tag, kind: hit.kind, detector: hit.detector }, where);
// Errors first, then Needs attention (action before review).
const lrProblemsSort = hits => hits.slice().sort((a, b) => ((LR_SEV[b.sev] || {}).rank || 0) - ((LR_SEV[a.sev] || {}).rank || 0));
// Several problems as one list; noteOf(hit), when given, gives each its grey line.
const lrProblemsHtml = (hits, where, noteOf) => lrProblemsSort(hits).map(hit => lrProblemHtml(hit, where, noteOf ? noteOf(hit) : '')).join('');
// The grey notes of one listing (healthOf's `notes`) as lines under its problems, or ''.
const lrNotesHtml = notes => (notes && notes.length ? `<div class="lr-notes">${notes.map(note => `<div class="lr-note">${String(note).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]))}</div>`).join('')}</div>` : '');
// The Fix button's hand-off, the same from every screen: the Image Manager for pictures, Listing Errors for everything else.
function lrFixOpen(kind, brand, sku, attrs) {
  if (kind === 'img') {
    $('imBrand').value = brand;
    showTab('img');
    $('imQ').value = sku;
    IM_SKU_CHOICES = null;
    imLoad(sku);
  } else {
    $('leBrand').value = brand;
    showTab('lerr');
    leOpen(sku, attrs || []);
  }
  window.scrollTo(0, 0);
}
// One listener for every Fix and Check now button on every screen (the test pages have no document to listen on). Check now
// reads that one listing from Amazon through the Workspace's queue (liWsCheckNow), and the screen redraws when the answers land.
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const check = e.target && e.target.closest ? e.target.closest('[data-lr-check]') : null;
  if (check) {
    const sep = check.dataset.lrCheck.indexOf('|');               // "brand|sku"
    if (typeof liWsCheckNow === 'function') liWsCheckNow(check.dataset.lrCheck.slice(0, sep), check.dataset.lrCheck.slice(sep + 1), check);
    return;
  }
  const btn = e.target && e.target.closest ? e.target.closest('[data-lr-fix]') : null;
  if (!btn) return;
  const first = btn.dataset.lrFix.indexOf('|');                 // "img|brand|sku" or "lerr|brand|sku"
  const last = btn.dataset.lrFix.lastIndexOf('|');
  lrFixOpen(btn.dataset.lrFix.slice(0, first), btn.dataset.lrFix.slice(first + 1, last), btn.dataset.lrFix.slice(last + 1), (btn.dataset.lrAttrs || '').split(',').filter(Boolean));
});

// Read the saved rules from Firestore into LR (or the defaults when there are none), adding any default rule saved before it existed.
async function lrLoad() {
  try {
    const snap = await getDoc(doc(db, 'listingrules', 'config'));
    if (snap.exists()) {
      const data = snap.data();
      /* A RULE ADDED AFTER THE LAST SAVE MUST STILL RUN. The saved document holds the whole list, so a
       * new default would otherwise stay invisible until somebody pressed Save in the Rules tab. */
      const saved = data.issues || LR_DEFAULT.issues;
      const have = new Set(saved.map(issue => issue.id));
      const added = LR_DEFAULT.issues.filter(issue => !have.has(issue.id));
      LR = { issues: added.concat(saved), templates: data.templates || LR_DEFAULT.templates, events: data.events || LR_DEFAULT.events,
        allow: lrAllow({ allow: data.allow }) };        // what people may write: the saved values over the defaults
      LR_SAVED_AT = data.at && data.at.toDate ? data.at.toDate() : null;
    } else LR = JSON.parse(JSON.stringify(LR_DEFAULT));
  } catch (e) {
    LR = LR || JSON.parse(JSON.stringify(LR_DEFAULT));
  }
  H_CTX = null;
}

/** The brand catalog (colour, size, sub-category per SKU), kept a day in Firestore — reading the workbook is slow. */
// Fill LR_CAT for both brands: the day-old Firestore copy if fresh, else the backend (and cache it); `force` re-reads.
async function lrLoadCatalog(force) {
  for (const b of ['SP', 'CPC']) {
    if (LR_CAT[b] && !force) continue;
    try {
      const snap = await getDoc(doc(db, 'listingrules', 'catalog_' + b));
      const data = snap.exists() ? snap.data() : null;
      const fresh = data && data.at && data.at.toDate && Date.now() - data.at.toDate().getTime() < 24 * 3600 * 1000;
      if (data && data.map && (fresh || !force)) {
        LR_CAT[b] = data.map;
        if (fresh) continue;
      }
      const got = await baCall({ sales: 'cat', brand: b });
      if (got && got.map) {
        const map = {};
        Object.entries(got.map).forEach(([sku, entry]) => {
          map[sku] = { color: entry.color || '', size: entry.size || '', subcat: entry.subcat || '' };
        });
        LR_CAT[b] = map;
        try {
          await setDoc(doc(db, 'listingrules', 'catalog_' + b), { map, at: serverTimestamp() });
        } catch (e) { /* cached next time */ }
      }
    } catch (e) { /* no catalog: templates and occasions are simply not judged */ }
  }
  H_CTX = null;
}

