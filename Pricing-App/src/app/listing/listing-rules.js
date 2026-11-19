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
 *                 lrSuggestWords + lrSwFacts (THE ONE SUGGESTION-WORDS RULE: which words every suggestion keeps, removes or adds),
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
  title_not_live: { label: 'The title Amazon shows is not the one we submitted (ours is not live)', params: [] },
  images_small: { label: 'A catalogue picture under PX pixels on its longest side (zoom does not work)', params: ['px'] },
  main_not_square: { label: 'The main picture is not square (more than PCT % longer one way)', params: ['pct'] },
  images_duplicate: { label: 'The same picture in two slots of the catalogue', params: [] },
  main_photo_check: { label: 'A person marked the main picture Not OK (Image Manager → Picture check)', params: [] },
  bullets_below: { label: 'Fewer bullets than N', params: ['n'] },
  desc_below: { label: 'Description shorter than N characters (not judged when A+ is live — Amazon shows the A+ instead)', params: ['n'] },
  keyword_bytes: { label: 'Search terms over MAX bytes, counting the words only (spaces and ; , . do not count)', params: ['max'] },
  title_length: { label: 'Title length outside MIN–MAX characters', params: ['min', 'max'] },
  size_format: { label: 'A size in the title not written like the approved example', params: ['example'] },
  dimension_order: { label: 'Larger dimension written first', params: [] },
  variation_naming: { label: 'Siblings write their size differently', params: [] },
  title_template: { label: 'A real mistake in the title: spelling, the shape against the size, a missing part (brand, colour, product, size, Inch), a repeated word — never its word order', params: [] },
  title_keyword: { label: 'Title missing a required word (comma-separated: any one is enough)', params: ['words'] },
  title_contains: { label: 'Title contains a word (comma-separated)', params: ['words'] },
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
    /* THE TITLE AMAZON SHOWS (12 Nov 2026): every title rule judges the title shoppers see (the catalogue's), not the one we
     * submitted; when ours differs, it is not live — one Needs attention problem says so, with both titles. */
    { id: 'title_not_live', name: 'Amazon shows a different title from yours — yours is not live', sev: 'action', area: 'Title', detector: 'title_not_live', desc: 'The title we submitted (item_name) is not the title Amazon shows on the product page' },
    /* PICTURE RULES (Rule Engine, 12 Nov 2026): judged on the catalogue's pictures — what shoppers see — from the live Amazon read
     * (sizes and which picture sits in which slot) or the Image Manager snapshot. No picture data: not judged ("Not checked").
     * "Main picture present" and "at least 6 pictures" are the two rules just below (main_image, img_secondary). */
    { id: 'img_small', name: 'Picture too small to zoom', sev: 'action', area: 'Images', detector: 'images_small', params: { px: 1000 }, desc: 'A catalogue picture under 1000 px on its longest side: shoppers cannot zoom in' },
    { id: 'main_square', name: 'Main picture not square', sev: 'review', area: 'Images', detector: 'main_not_square', params: { pct: 10 }, desc: 'The main picture is more than 10 % longer one way than the other; Amazon shows it best square' },
    { id: 'img_dup', name: 'Same picture used twice', sev: 'action', area: 'Images', detector: 'images_duplicate', desc: 'The same picture sits in two slots of the catalogue: one slot is wasted' },
    { id: 'main_check', name: 'Main picture marked Not OK', sev: 'action', area: 'Images', detector: 'main_photo_check', desc: 'A person marked the main picture Not OK in Image Manager → Picture check (background not pure white, or text / logo on it)' },
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
    { id: 'kw_bytes', name: 'Search terms over the limit', sev: 'action', area: 'Content', detector: 'keyword_bytes', params: { max: 249 }, desc: 'Over the limit Amazon may ignore all of the search terms; spaces and ; , . do not count toward it' },
    { id: 'img_type', name: 'Important image type missing', sev: 'action', area: 'Images', detector: 'manual', desc: 'No size infographic, lifestyle, detail image, etc.' },
    { id: 'title_template', name: 'Title mistake', sev: 'action', area: 'Title', detector: 'title_template', desc: 'A spelling mistake, a shape the size contradicts, a missing part (brand, colour, product, size, "Inch") or a word said twice — the title keeps its own format and word order' },
    { id: 'size_format', name: 'Size formatting inconsistent', sev: 'action', area: 'Size', detector: 'size_format', params: { example: '54x54 Inch' }, desc: '54×54, 60X90 Inches, etc. instead of our 54x54 Inch (or the family\'s 54 x 54 Inch)' },
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
      uses: 'Decorative Table Cover for Dining Kitchen Farmhouse Party Home', required: 'brand,color,product,size',
      pattern_: '', template: '{brand} {color} {pattern} {shape} {product} {size}',
      reference: 'Maison d\' Hermine Table Cloth Rectangle Table Reusable 100% Cotton 60"x90" Decorative for Dining Kitchen Room Farmhouse Party Home Hotel Washable Table Cover Thanksgiving Christmas - Equinoxe - Beige' },
    { brand: 'ALL', match: 'Runner', product: 'Table Runner', material: '100% Cotton', pattern: 'Hand Block Print',
      uses: 'for Dining Table Kitchen Farmhouse Party Home', required: 'brand,color,product,size',
      template: '{brand} {color} {pattern} {product} {size}', reference: '' },
    { brand: 'ALL', match: 'Pillow', product: 'Throw Pillow Cover', material: 'Cotton', pattern: 'Block Print',
      uses: 'for Couch Sofa Bed Living Room', required: 'brand,color,product,size',
      template: '{brand} {color} {pattern} {product} {size}', reference: '' },
    { brand: 'ALL', match: 'Napkin', product: 'Cloth Napkins', material: '100% Cotton', pattern: 'Block Print',
      uses: 'Reusable Dinner Napkins', required: 'brand,color,product,size',
      template: '{brand} {color} {pattern} {product} {size}', reference: '' },
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
   *   ourBrands         OUR BRAND WORDS (12 Nov 2026): one list for every listing of BOTH accounts — Ridhi, CPC and Whimsical Corner are
   *                     all ours. A title has its brand when it holds ANY of them as whole words (case, "the" / "my" / "by" and
   *                     punctuation ignored, so "My Whimsical Corner" counts and "Ridhima" does not). The brand Amazon shows for the
   *                     listing counts too when Sellora has read it. Empty and no Amazon brand = the brand is not judged.
   *   writeAs           per account, the brand a suggested title writes when Amazon's own is not known (not a setting).
   *   embroideryColors  pieces in these colours are embroidery, so "Block Print" is never asked of them.
   *   otherBrands       OTHER BRANDS' NAMES (IP & Trademark Guard, 18 Nov 2026): trademarks and licensed names that must not be in a
   *                     listing's title, bullets, description, search terms or Item Highlights — a starting list the team edits.
   *                     Read by listing/ip-guard.js (the Guard screen) and by Fix all search terms (it takes them out). NOT a Listing
   *                     Health rule: no finding, no count and no level in Listing Health or the Workspace comes from it.
   *   claims            RESTRICTED CLAIMS (the same Guard): words that need proof or a certificate. */
  allow: { shortFrom: 74, ourBrands: 'Ridhi, CPC, Whimsical Corner', writeAs: { SP: 'Ridhi', CPC: 'Whimsical Corner' }, embroideryColors: 'White, Off White',
    otherBrands: 'Pottery Barn, Williams Sonoma, Anthropologie, West Elm, Crate & Barrel, Laura Ashley, Martha Stewart, Ralph Lauren, Kate Spade, Hermes, Gucci, Chanel, Disney, Marvel, Harry Potter, Hello Kitty, Star Wars, Pokemon, Amazon Basics, Amazon\'s Choice',
    claims: 'antibacterial, antimicrobial, antiviral, organic, GOTS, OEKO-TEX, FDA approved, eco-friendly, sustainable, non-toxic, hypoallergenic, #1, best seller, top rated, guaranteed' },
};

let LR = null;             // the rules in force: saved config, or the defaults
let LR_SAVED_AT = null;    // when the saved config was written, or null while the defaults are in use
let LR_HISTORY = [];       // the last 20 saves, newest first: { at, by, who, changes: [words], prev: the rules as they were before it }
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
/** The date of an occasion in a given year (UTC midnight), or null when the rule cannot be read. Worked out every year by itself (fixed
 *  days, the n-th weekday, Easter by the computus); a date someone typed in the calendar for that year (ev.on["2027"] = "2027-03-28") wins. */
function lrEventDate(ev, year, events) {
  const typed = ev.on && ev.on[String(year)];
  if (typed && /^\d{4}-\d{2}-\d{2}$/.test(typed)) return new Date(Date.UTC(+typed.slice(0, 4), +typed.slice(5, 7) - 1, +typed.slice(8, 10)));
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
/** THE SEASON-DATE RULE every screen uses (13 Nov 2026) — the Season planner, the Listing Rules check of titles, Listing Content and the
 *  calendar, so they all agree. For one occasion on one day:
 *    active  = time to ADD it: from its lead days before the occasion up to the day itself;
 *    keep    = just past: the day after up to its "days after" (lag) — not added any more, not removed or flagged yet;
 *    expired = after its "days after" (until its next lead window opens): OK to remove, and a title naming it is flagged.
 *  { active, keep, expired, date (this occurrence while active / keep, else the next one), from (add from), until (flagged after) }.
 *  Looks at last year's, this year's and next year's date (a date typed in the calendar wins — lrEventDate). */
function lrSeasonState(ev, today, events) {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  let next = null;
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const date = lrEventDate(ev, year, events);
    if (!date) continue;
    const from = new Date(date.getTime() - (ev.lead || 0) * LR_DAY);
    const until = new Date(date.getTime() + (ev.lag || 0) * LR_DAY);
    if (t >= from.getTime() && t <= date.getTime()) return { active: true, keep: false, expired: false, date, from, until };
    if (t > date.getTime() && t <= until.getTime()) return { active: false, keep: true, expired: false, date, from, until };
    if (from.getTime() > t && (!next || from < next.from)) next = { date, from, until };
  }
  return Object.assign({ active: false, keep: false, expired: true, date: null, from: null, until: null }, next || {});
}
/** Where today stands against an occasion, in the older shape: { inSeason (active or keep: a title may name it), next, from, to }. */
function lrSeason(ev, today, events) {
  const st = lrSeasonState(ev, today, events);
  return { inSeason: st.active || st.keep, next: st.date, from: st.from, to: st.until };
}
// "a, b, c" → ['a', 'b', 'c'].
const lrWords = str => String(str || '').split(',').map(word => word.trim()).filter(Boolean);
/* ---- same meaning, different writing (Part A2) ---- */
/** One spelling for words that mean the same, so a word or a template part is found however a person wrote it: lower case;
 *  hyphens, commas and "|" as spaces; "&" = and, "w/" = with, Pc / Pcs = Pieces, "2 Pack" / "Pack of 2" / "2 Pcs" = Set of 2;
 *  Inches = Inch; Grey = Gray; Colour = Color; Table Cloth / Table-Cloth = Tablecloth; Cushion Cover = Pillow Cover;
 *  Block-Print / Blockprint / Block Printed / Hand Block Printed = Block Print; and a plural reads as its singular
 *  (Covers = Cover, Napkins = Napkin). Both sides of every comparison go through it, so what is compared is the meaning. */
// SMOOTH (17 Nov 2026): the same text is read the same way thousands of times a draw (every rule, every listing): the answer is kept
// per text (a pure function — the same text always gives the same answer), at most LR_NORM_MAX texts, then the store starts again.
const LR_NORM_KEEP = new Map();
const LR_NORM_MAX = 50000;
function lrNorm(text) {
  const key = String(text || '');
  const kept = LR_NORM_KEEP.get(key);
  if (kept !== undefined) return kept;
  if (LR_NORM_KEEP.size >= LR_NORM_MAX) LR_NORM_KEEP.clear();
  const out = lrNormNow(key);
  LR_NORM_KEEP.set(key, out);
  return out;
}
function lrNormNow(text) {
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
// The allowances in force: { shortFrom, ourBrands, writeAs: { SP, CPC }, embroideryColors, otherBrands, claims } — the saved values over the defaults. A
// config saved before 12 Nov kept one brand list per account (brandWords): its words join the shared list, so nothing typed is lost.
function lrAllow(cfg) {
  const base = LR_DEFAULT.allow;
  const own = (cfg && cfg.allow) || {};
  let ours = own.ourBrands != null ? String(own.ourBrands) : base.ourBrands;
  if (own.ourBrands == null && own.brandWords && typeof own.brandWords === 'object') {
    const seen = new Set();
    ours = lrWords(ours).concat(Object.values(own.brandWords).flatMap(lrWords))
      .filter(word => { const k = lrNorm(word); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(', ');
  }
  return { shortFrom: +own.shortFrom > 0 ? +own.shortFrom : base.shortFrom, ourBrands: ours, writeAs: Object.assign({}, base.writeAs),
    embroideryColors: own.embroideryColors != null ? String(own.embroideryColors) : base.embroideryColors,
    // the IP & Trademark Guard's two lists (a rules document saved before 18 Nov 2026 has neither: the starting lists)
    otherBrands: own.otherBrands != null ? String(own.otherBrands) : base.otherBrands, claims: own.claims != null ? String(own.claims) : base.claims };
}
// True when a title sits in the band where the short forms are allowed: from "Short forms allowed from" up to 75 characters.
const lrNear = (title, cfg) => String(title || '').length >= lrAllow(cfg).shortFrom && String(title || '').length <= 75;
// The phrases that mean OUR brand in a title, for every listing of both accounts: the "Our brand words" list, plus the brand Amazon shows
// for this listing when Sellora has read it. Each phrase read the same way as titles (lrNorm), with "the", "my", "by" and punctuation
// left out ("The Whimsical Corner" → "whimsical corner"); a phrase is found only as whole words (lrFind), so "Ridhi" is not in "Ridhima".
// [] when nothing is known — then the brand is not judged.
const LR_BRAND_SKIP = ['the', 'my', 'by'];
function lrBrandWords(row, cfg) {
  const phrases = lrWords(lrAllow(cfg).ourBrands).concat(row.amzBrand ? [String(row.amzBrand)] : []);
  const out = phrases.map(text => lrNorm(text).split(/[^a-z0-9]+/).filter(word => word && !LR_BRAND_SKIP.includes(word)).join(' '))
    .filter(phrase => phrase.length > 1);
  return [...new Set(out)];
}
// The brand as a suggested title should write it: Amazon's own for the listing, else the account's (Ridhi / Whimsical Corner).
const lrBrandName = (row, cfg) => String(row.amzBrand || lrAllow(cfg).writeAs[row.brand] || BRAND_NAME[row.brand] || row.brand || '');
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
// A listing judged through lrFresh carries `shownTitle`: the title Amazon SHOWS (the catalogue's), freshest first — see lrFresh.
const hTitleText = row => row.shownTitle || (row.content && row.content.title) || ((row.titleFull || String(row.title || '').length !== 60) ? (row.title || '') : '');
// Two titles are the same title when they read the same: case, spaces and "&amp;" aside; a title kept cut (the snapshot keeps 200
// characters, the live read 220) is the same when the other one starts with it.
function lrSameTitle(a, b) {
  const norm = s => String(s || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase();
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 200 && long.startsWith(short);
}
/** Search-term bytes the way Amazon counts them (Part A4): the UTF-8 bytes of the words only — spaces and the punctuation
 *  ; , . do not count toward the limit. */
const LR_ASCII = /^[\x00-\x7f]*$/;
function lrKwBytes(text) {
  const words = String(text || '').replace(/[\s;,.]+/g, '');
  if (LR_ASCII.test(words)) return words.length;          // plain letters and digits: one byte each (the same count, without encoding)
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(words).length : Buffer.byteLength(words, 'utf8');
}
/* THE ONE SEARCH-TERMS RULE — Listing Health's keyword_bytes check and the Listing Optimiser's review both judge with lrKwCheck.
 * Amazon's limit is "less than 250" bytes: 249 at most (the keyword_bytes rule's max), spaces and ; , . not counted. OVER IT,
 * AMAZON MAY IGNORE ALL OF THE SEARCH TERMS, not only the part past the limit. */
const LR_KW_MAX = 249;
const LR_KW_OVER = 'Over Amazon\'s limit — Amazon may ignore all of these search terms.';
/** The limit in force: the keyword_bytes rule's max in the rules given (the saved rules, else the defaults), else 249. */
function lrKwMax(cfg) {
  const rule = (((cfg || (typeof LR !== 'undefined' && LR) || LR_DEFAULT) || {}).issues || []).find(issue => issue.detector === 'keyword_bytes');
  return (rule && +(rule.params || {}).max) || LR_KW_MAX;
}
/** { bytes, max, over, cut, cutAt }: the bytes as Amazon counts them, over = more than max, cut = bytes to remove, and cutAt = the
 *  character where byte max+1 begins (the text's length when within) — what to cut. `bytes`, when known (a whole read whose text was
 *  shortened for keeping), wins over counting the text. */
function lrKwCheck(text, max, bytes) {
  const s = String(text || '');
  max = +max || LR_KW_MAX;
  const n = bytes != null ? +bytes : lrKwBytes(s);
  let used = 0, cutAt = s.length;
  if (n > max) {
    let i = 0;
    for (const ch of s) {             // by character, not UTF-16 unit: an emoji is 4 bytes, not two halves
      if (!/[\s;,.]/.test(ch)) {
        used += lrKwBytes(ch);
        if (used > max) { cutAt = i; break; }
      }
      i += ch.length;
    }
  }
  return { bytes: n, max, over: n > max, cut: Math.max(0, n - max), cutAt };
}

/* ---- THE SUGGESTION WORDS (19 Nov 2026): which words a suggestion KEEPS, REMOVES or may ADD — one rule for every screen ----
 * Used by Fix all search terms (kw-fix.js kfShorten), Fix all titles (title-fix.js ttBuild), the title template suggestion (lrSuggest),
 * Fix all's short title (fix-all.js faShortTitle), Listing Content's 75-character cut and search-terms suggestion (listing-content.js),
 * the Listing Optimiser's suggested title (listing-optimiser.js, filtered here — the backend is not changed) and the Season planner's trim
 * of Item Highlights and the search words (season-planner.js spTrim). It decides WORDS only: no error, count or chip comes from it.
 * RULE 1 — PROTECTED, never removed the FIRST time they appear: who we are (hand, block print, hand block print, blockprint, hand printed,
 *   handmade); the listing's product type (tablecloth / table cloth, napkin, placemat, runner…); its REAL shape (from its size: 118 x 70 =
 *   rectangle, 54 x 54 = square — else its shape attribute: round, oval); its material (cotton, 100% cotton, linen); its OWN colour (every
 *   word of the colour attribute: "Turquoise Moss Green", "Light Blue"); its size; use / special-feature words (kitchen, dining,
 *   housewarming, wrinkle free, washable, reusable…). In a title (and Item Highlights) our brand too. In a TITLE (RULE 3) the use words
 *   are not locked: a 75-character title keeps brand, product, shape, material, size, the print ("Hand" too) and colour — the uses may go.
 * RULE 2 — what may go, in this order, stopping as soon as the text fits (`fits`): 0 always: other brands' names and restricted claims
 *   (IP & Trademark Guard's lists, `risk`) — and in search terms our own brand names, ASINs and bare punctuation; 1 a word said again (the
 *   2nd, 3rd… time — a protected word too; the first stays); 2 a shape that is NOT the product's, a colour that is NOT its colour; 3
 *   low-value words (gift, Indian, colorful, light when not part of its colour, cute, neutral, decorative… and the joining words a, and,
 *   the, for…); 4 any other word that is not protected — in search terms the ones the title already says first, then from the end.
 *   A protected word on its first appearance never goes: when only those are left and it still does not fit, everything is kept and
 *   `important` says so ("Only important words left — edit by hand").
 * RULE 3 — titles: the words stay in the template's order; only which words are kept changes ("Hand" of "Hand Block Print" stays).
 * SHORT FORMS (19 Nov 2026) — a title that still does not fit with only its important words left, before it is held: the short forms the
 *   house rule allows in a title of shortFrom–75 characters (Listing Rules "Short forms allowed from", 74) — the size without spaces
 *   ("54x54 Inch"), no " - " before the colour, "&" for "and", "2 Pack" for "Set of 2", "Pcs" for "Pieces", "In" or " for "Inch" — added
 *   one at a time in that order until it fits (else the fewest that fit), and only when the title then has shortFrom–75 characters
 *   (below that the strict style stays).
 *   Every word is kept; the title checks run on it as on any new title. */
const LR_SW_IMPORTANT = 'Only important words left — edit by hand';
const LR_SW_IDENTITY = ['hand block print', 'hand block printed', 'handblockprint', 'handblockprinted', 'block print', 'block printed', 'blockprint', 'blockprinted',
  'hand printed', 'handprinted', 'hand print', 'handmade', 'hand made', 'hand', 'block'];
const LR_SW_PRODUCTS = ['tablecloth', 'table cloth', 'table cover', 'napkin', 'cloth napkin', 'dinner napkin', 'placemat', 'place mat', 'table mat', 'table runner', 'runner',
  'apron', 'cushion cover', 'cushion', 'pillow cover', 'throw pillow cover', 'pillow', 'pillowcase', 'sham', 'coaster', 'tea towel', 'kitchen towel', 'dish towel', 'towel',
  'bedspread', 'bed cover', 'quilt', 'duvet cover', 'duvet', 'comforter', 'sheet', 'curtain', 'throw', 'blanket', 'pot holder', 'oven mitt', 'tea cosy', 'bread basket',
  'tote bag', 'bag', 'pouch', 'scarf', 'dress', 'kaftan', 'robe'];
const LR_SW_SHAPES = { rectangle: ['rectangle', 'rectangular', 'oblong'], square: ['square'], round: ['round', 'circle', 'circular'], oval: ['oval'] };
const LR_SW_MATERIAL_DEFAULT = ['cotton', '100%', 'linen'];
const LR_SW_USES = ['kitchen', 'dining', 'dining table', 'dinner', 'housewarming', 'house warming', 'wrinkle free', 'wrinkle resistant', 'washable', 'machine washable',
  'reusable', 'stain resistant', 'everyday', 'eco friendly'];
const LR_SW_COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'black', 'gray', 'brown', 'beige', 'cream', 'ivory', 'navy', 'teal', 'turquoise',
  'aqua', 'mint', 'sage', 'olive', 'mustard', 'gold', 'golden', 'silver', 'maroon', 'burgundy', 'wine', 'rust', 'coral', 'peach', 'lavender', 'lilac', 'violet', 'indigo',
  'magenta', 'fuchsia', 'charcoal', 'tan', 'khaki', 'taupe', 'mauve', 'plum', 'crimson', 'scarlet', 'emerald', 'jade', 'lime', 'cobalt', 'sapphire', 'ochre', 'saffron',
  'terracotta', 'copper', 'bronze', 'blush', 'offwhite', 'multicolor', 'multicolored', 'moss', 'harbor', 'denim'];
const LR_SW_LOW = ['gift', 'gifting', 'indian', 'india', 'colorful', 'colourful', 'colorfull', 'light', 'cute', 'neutral', 'decorative', 'beautiful', 'elegant', 'stylish',
  'perfect', 'unique', 'lovely', 'pretty', 'nice', 'best', 'great', 'amazing', 'awesome', 'fancy', 'trendy', 'attractive', 'gorgeous', 'idea', 'ideas'];
const LR_SW_STOP = ['a', 'an', 'and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'or', 'by', '&', '+'];
const LR_SW_UNIT = ['x', 'inch', 'in', 'cm', 'ft', 'feet', 'mm', 'by', '"', '”', '″'];
const LR_SW_ASIN = /^b0[a-z0-9]{8}$/;
const LR_SW_SEP = /^[-–—|,;:·/]+$/;
/** One word as it is compared: lower case, letters, digits and % only; Grey = Gray, Colour = Color, Inches = Inch; a plural as its singular. */
function lrSwKey(word) {
  let k = String(word || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}%"”″]+/gu, '');
  if (k === 'grey') k = 'gray';
  else if (k === 'colour') k = 'color';
  else if (k === 'inches') k = 'inch';
  else if (k === 'offwhite' || k === 'multicolour') k = k === 'offwhite' ? 'offwhite' : 'multicolor';
  if (/^[a-z]{4,}s$/.test(k) && !/ss$/.test(k)) k = k.slice(0, -1);
  return k;
}
// A phrase as the keys of its words, and written as one word ("table cloth" → [table, cloth] and [tablecloth]).
function lrSwPhrases(list) {
  const out = [];
  (list || []).forEach(p => {
    const keys = String(p || '').split(/[\s-]+/).map(lrSwKey).filter(Boolean);
    if (!keys.length) return;
    out.push(keys);
    if (keys.length > 1) out.push([lrSwKey(keys.join(''))]);
  });
  return out.sort((a, b) => b.length - a.length);
}
const LR_SW_P = { identity: lrSwPhrases(LR_SW_IDENTITY), uses: lrSwPhrases(LR_SW_USES), products: lrSwPhrases(LR_SW_PRODUCTS) };
const LR_SW_COLOR_SET = new Set(LR_SW_COLORS.map(lrSwKey));
const LR_SW_LOW_SET = new Set(LR_SW_LOW.map(lrSwKey));
const LR_SW_STOP_SET = new Set(LR_SW_STOP.map(lrSwKey).concat(['&', '+']));
const LR_SW_SHAPE_OF = new Map(Object.entries(LR_SW_SHAPES).flatMap(([shape, words]) => words.map(w => [lrSwKey(w), shape])));
// "Rectangular" → 'rectangle', "Round" → 'round'; '' when it names no shape.
const lrSwShapeWord = text => { for (const w of String(text || '').split(/[^A-Za-z]+/)) { const s = LR_SW_SHAPE_OF.get(lrSwKey(w)); if (s) return s; } return ''; };
/** The product's REAL shape: round / oval when its shape says so; else from its size (two numbers: equal = square, else rectangle); else
 *  what its shape attribute or catalogue sub-category says; '' when nothing tells. */
function lrSwShapeOf(size, shapeText) {
  const named = lrSwShapeWord(shapeText);
  if (named === 'round' || named === 'oval') return named;
  const nums = (String(size || '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length === 2) return nums[0] === nums[1] ? 'square' : 'rectangle';
  return named;
}
const LR_SW_PROD_KEEP = new Map();
/** What RULE 1 protects for one listing: { colour, shape, material, size, product (phrases), brands } — from its own facts: Amazon's
 *  attributes (`va`: a read made for this, else the ListingMatch cache), the catalogue, the Listing Rules template, its product type. */
function lrSwFacts(row, cfg, va, o) {
  row = row || {};
  o = o || {};
  cfg = cfg || (typeof LR !== 'undefined' && LR) || LR_DEFAULT;
  if (!va && row.sku && typeof lmGet === 'function') { const m = lmGet(row.sku, row.brand); va = m && m.va; }
  va = va || {};
  const one = names => {
    for (const n of names) {
      const v = va[n];
      const s = Array.isArray(v) ? (v[0] && v[0].value != null ? v[0].value : '') : v;
      if (s != null && String(s).trim()) return String(s).trim();
    }
    return '';
  };
  const cat = (row.brand && row.sku && LR_CAT[row.brand] && LR_CAT[row.brand][row.sku]) || {};
  const tpl = row.brand && row.sku && cfg && cat.subcat != null ? lrTemplateFor(row, cfg) : null;
  const title = o.title != null ? String(o.title) : hTitleText(row);
  const colour = one(['color', 'color_name']) || String(row.amzColor || '') || String(cat.color || '') || lrColorOf(row);
  let size = one(['size', 'size_name']) || String(cat.size || '');
  if (!size) { const t = hTitleSizes(title)[0]; if (t) size = t.a + 'x' + t.b; }
  const shape = lrSwShapeOf(size, [one(['item_shape']), lrShape(cat.subcat)].filter(Boolean).join(' '));
  const material = one(['material']) || (tpl && tpl.material) || String(cat.material || '');
  const pt = String(o.pt || row.pt || '').replace(/_/g, ' ');
  const src = [tpl && tpl.product, cat.subcat, pt].filter(Boolean).join(' | ');
  const product = [];
  // the template's product as written, and each of its words ("Cloth Napkins": "cloth" alone is its product word too)
  if (tpl && tpl.product) product.push(String(tpl.product), ...String(tpl.product).split(/\s+/).filter(w => w.length > 2));
  const within = src || title;
  // the product words its sub-category / product type name (kept per text: the same few texts for thousands of listings)
  let found = LR_SW_PROD_KEEP.get(within);
  if (!found) { if (LR_SW_PROD_KEEP.size > 2000) LR_SW_PROD_KEEP.clear(); found = LR_SW_PRODUCTS.filter(p => lrHas(within, p)); LR_SW_PROD_KEEP.set(within, found); }
  product.push(...found);
  return { colour, shape, material, size, product, brands: lrBrandWords(row, cfg) };
}
// The short forms, mildest first: added one at a time in this order; when that overshoots, the fewest that fit (ties: the earlier ones).
const LR_SW_SHORT = [
  ['size without spaces', t => t.replace(/(\d+(?:\.\d+)?)\s+[x×X]\s+(\d+(?:\.\d+)?)(?:\s+[x×X]\s+(\d+(?:\.\d+)?))?/g, (m, a, b, c) => (c ? `${a}x${b}x${c}` : `${a}x${b}`))],
  ['no " - " before the colour', t => t.replace(/\s+[-–—]\s+/g, ' ')],
  ['"&" for "and"', t => t.replace(/\s+and\s+/gi, ' & ')],
  ['"N Pack" for "Set of N"', t => t.replace(/\bset of (\d+)\b/gi, '$1 Pack')],
  ['"Pcs" for "Pieces"', t => t.replace(/\bpieces\b/gi, 'Pcs')],
  ['"In" for "Inch"', t => t.replace(/(\d(?:x\d+)*)\s+inch(?:es)?\b/gi, '$1 In')],
  ['" for "Inch"', t => t.replace(/(\d(?:x\d+)*)\s+in(?:ch(?:es)?)?\b/gi, '$1"')],
];
/** A title with only important words left that is still too long, in the short forms the house rule allows: { text, forms } — the fewest
 *  forms that make `fits` true with a length of `from`–75 (lrNear: where the short forms are not errors), or null. */
function lrSwShortForms(text, fits, from) {
  const n = LR_SW_SHORT.length;
  const okLen = t => t.length >= from && t.length <= 75 && fits(t);
  // 1 the forms added one at a time, mildest first ("54x54 Inch", then no " - "…)
  let cur = text;
  const used = [];
  for (const [name, form] of LR_SW_SHORT) {
    const next = form(cur).replace(/\s{2,}/g, ' ').trim();
    if (next === cur) continue;
    cur = next;
    used.push(name);
    if (okLen(cur)) return { text: cur, forms: used.slice() };
    if (fits(cur)) break;                                     // fits but shorter than shortFrom: the strict style would be broken
  }
  // 2 else the fewest forms that fit within shortFrom–75
  const masks = Array.from({ length: (1 << n) - 1 }, (_, i) => i + 1)
    .map(m => ({ m, k: m.toString(2).split('1').length - 1, order: [...Array(n).keys()].filter(i => m & (1 << i)).map(i => String.fromCharCode(97 + i)).join('') }))
    .sort((a, b) => a.k - b.k || (a.order < b.order ? -1 : 1));
  for (const { m } of masks) {
    let t = text;
    const forms = [];
    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      const next = LR_SW_SHORT[i][1](t).replace(/\s{2,}/g, ' ').trim();
      if (next === t) { t = null; break; }                    // a form that changes nothing here is not one of the fewest
      t = next;
      forms.push(LR_SW_SHORT[i][0]);
    }
    if (t && okLen(t)) return { text: t, forms };
  }
  return null;
}
/** THE ONE RULE. text → { before, after, removed: [{ w, why, i, risk }], toks, risky, fits, important (only protected words left and it
 *  still does not fit), cut (rule 2 step 4 used) }. o: { mode: 'kw' (search terms) | 'title' | 'hl' (Item Highlights), facts (lrSwFacts),
 *  fits(text) → true when it fits (none: only the "always" words go), title (search terms: the title, for step 4's order), brands (our
 *  brand phrases: removed from search terms, protected elsewhere), risk(text) → [{ s, e, why }], riskOnly (only the risky words go),
 *  keep: more words never to remove (the seasons on now), shortFrom (a title: where the short forms are allowed — Listing Rules' 74;
 *  short: false = never use them), cutEnd: false — stop before "any other word from the end" (the Season planner:
 *  it never cuts an ordinary word of the customer's own, only the ones this rule names) }. Never adds a word. */
function lrSuggestWords(text, o) {
  o = o || {};
  const mode = o.mode || 'kw';
  const f = o.facts || {};
  const before = String(text == null ? '' : text);
  const toks = [...before.matchAll(mode === 'kw' ? /[^\s,;|]+/g : /\S+/g)].map((m, i) => {
    const raw = m[0];
    const w = raw.replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%"”″]+$/gu, '');
    return { raw, w, k: lrSwKey(w), at: m.index, i, out: '', cls: '', risk: false };
  });
  // RULE 1: mark the protected words (each phrase matched as consecutive words)
  const mark = (cls, phrases) => {
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i].k) continue;
      for (const p of phrases) {
        if (i + p.length > toks.length || !p.every((k, j) => toks[i + j].k === k)) continue;
        for (let j = 0; j < p.length; j++) if (!toks[i + j].cls) toks[i + j].cls = cls;
        i += p.length - 1;
        break;
      }
    }
  };
  const brandPhrases = lrSwPhrases(o.brands || f.brands || []);
  if (mode !== 'kw') mark('brand', brandPhrases);
  const colourKeys = new Set(String(f.colour || '').split(/[\s,&/+-]+/).map(lrSwKey).filter(k => k && !LR_SW_STOP_SET.has(k)));
  if (f.colour) mark('colour', lrSwPhrases([String(f.colour)]));       // the whole colour as written ("Indigo Blue and Rust Orange" keeps its "and")
  mark('colour', [...colourKeys].map(k => [k]));
  mark('identity', LR_SW_P.identity);
  mark('product', lrSwPhrases(f.product || []));
  if (f.shape) mark('shape', LR_SW_SHAPES[f.shape].map(w => [lrSwKey(w)]));
  const mats = f.material ? String(f.material).split(/[\s,&/+-]+/).filter(Boolean) : LR_SW_MATERIAL_DEFAULT;
  mark('material', mats.map(w => [lrSwKey(w)]).filter(p => p[0] && !LR_SW_STOP_SET.has(p[0])));
  if (mode !== 'title') mark('uses', LR_SW_P.uses);         // a title keeps its brand, product, shape, material, size, print and colour (RULE 3)
  if (o.keep) mark('keep', lrSwPhrases([...o.keep]));
  // a size: a number, "54x54", "18in", "100%" — not a word that holds a digit ("word035", an ASIN)
  const digit = t => !!t && /^\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?){0,2}(?:inch|in|cm|ft|mm|%|"|”|″)?$/.test(t.k);
  toks.forEach((t, i) => { if (!t.cls && (digit(t) || (LR_SW_UNIT.includes(t.k) && (digit(toks[i - 1]) || digit(toks[i + 1]) || (t.k !== 'x' && t.k !== 'by' && digit(toks[i - 2])))))) t.cls = 'size'; });
  // the text as it would be now
  const live = () => toks.filter(t => !t.out);
  const tidy = s => s.replace(/\s+([,;:])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1').replace(/(\s[-–—|·])(?:\s+[-–—|·])+/g, '$1')
    .replace(/^(?:[\s,;:\-–—|·]|(?:and|&|for|with|or|of)\s)+/i, '').replace(/(?:[\s,;:\-–—|·]|\s(?:and|&|for|with|or|of))+$/i, '')
    .replace(/\s(?:and|&|for|with|or|of)(?=\s[-–—|·]\s)/gi, '').replace(/[,;:](?=\s[-–—|·]\s)/g, '').replace(/\s{2,}/g, ' ').trim();
  let shortText = null, shortForms = [];
  const now = () => (shortText != null ? shortText : mode === 'kw' ? live().map(t => t.w).filter(Boolean).join(' ') : tidy(live().map(t => t.raw).join(' ')));
  const fits = () => (typeof o.fits === 'function' ? !!o.fits(now()) : true);
  let seq = 0;                                       // the order the words went in (removed[].n)
  const drop = (t, why) => { t.out = why; t.n = ++seq; };
  // 0 always: the risky words (another brand's name, a restricted claim) — quietly, nothing is said about them here
  const spans = typeof o.risk === 'function' ? o.risk(before) || [] : [];
  if (spans.length) toks.forEach(t => { const hit = spans.find(sp => t.at < sp.e && t.at + t.raw.length > sp.s); if (hit) { t.out = hit.why; t.risk = true; } });
  let cut = false;
  const done = () => ({ before, after: mode !== 'kw' && !toks.some(t => t.out) && shortText == null ? before : now(), short: shortForms, removed: toks.filter(t => t.out).map(t => ({ w: t.raw, why: t.out, i: t.i, risk: t.risk, n: t.n || 0 })), toks, risky: toks.filter(t => t.risk).length,
    fits: fits(), important: !fits(), cut });
  if (o.riskOnly) return done();
  if (mode === 'kw') {
    // …and in search terms: our own brand names (Amazon reads the brand field), ASINs and bare punctuation
    for (let i = 0; i < toks.length; i++) {
      const l = toks;
      const p = brandPhrases.find(ph => i + ph.length <= l.length && ph.every((k, j) => l[i + j].k === k && !l[i + j].out));
      if (p) { for (let j = 0; j < p.length; j++) drop(l[i + j], 'brand name'); i += p.length - 1; }
    }
    toks.forEach(t => { if (t.out) return; if (!t.k) drop(t, 'punctuation'); else if (LR_SW_ASIN.test(t.k)) drop(t, 'ASIN'); });
  }
  if (fits()) return done();
  // the steps of RULE 2, each one word at a time from the end, stopping the moment the text fits
  const step = (test, why) => {
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      if (t.out || !t.k) continue;
      const w = test(t, i);
      if (!w) continue;
      drop(t, typeof w === 'string' ? w : why);
      if (fits()) return true;
    }
    return false;
  };
  const isProt = t => !!t.cls;
  const unit = t => t.cls === 'size' && !/[a-z]/.test(t.k.replace(/x/g, ''));         // a number or a unit of a size: never a "repeat"
  // 1 said again (the first one stays — a protected word too)
  if (step((t, i) => !unit(t) && toks.slice(0, i).some(x => !x.out && x.k === t.k), 'repeated')) return done();
  // 2 a shape that is not the product's, a colour that is not its colour
  if (step(t => {
    if (isProt(t)) return false;
    if (f.shape && LR_SW_SHAPE_OF.has(t.k) && LR_SW_SHAPE_OF.get(t.k) !== f.shape) return 'wrong shape';
    if (colourKeys.size && LR_SW_COLOR_SET.has(t.k) && !colourKeys.has(t.k)) return 'not its colour';
    return false;
  })) return done();
  // 3 low-value words and joining words
  if (step(t => (isProt(t) ? false : LR_SW_LOW_SET.has(t.k) ? 'low-value word' : LR_SW_STOP_SET.has(t.k) ? 'stop word' : false))) return done();
  // 4 any other word that is not protected: in search terms what the title already says first; then from the end
  cut = true;
  if (mode === 'kw' && o.title) {
    const inTitle = new Set(String(o.title).split(/[^\p{L}\p{N}%]+/u).map(lrSwKey).filter(Boolean));
    if (step(t => !isProt(t) && inTitle.has(t.k), 'in the title')) return done();
  }
  if (o.cutEnd !== false) step(t => !isProt(t), 'cut to fit');
  // a title with only important words left, still too long: the short forms the house rule allows at shortFrom–75 characters
  if (mode === 'title' && o.short !== false && !fits()) {
    const from = +o.shortFrom || lrAllow((typeof LR !== 'undefined' && LR) || LR_DEFAULT).shortFrom;
    const sh = lrSwShortForms(now(), text2 => (typeof o.fits === 'function' ? !!o.fits(text2) : true), from);
    if (sh) { shortText = sh.text; shortForms = sh.forms; }
  }
  return done();
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
/** Occasions to ADD today (lrSeasonState active), in the order they fall. */
// SMOOTH (17 Nov 2026): the same for every listing on one day — kept per day and calendar (the calendar's own words are the key, so an
// edit in Listing Rules is seen at once); a fresh copy each time.
const LR_OCC_KEEP = new Map();
function lrOccasionsNow(cfg, today) {
  const key = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) + '|' + JSON.stringify(cfg.events || []);
  let kept = LR_OCC_KEEP.get(key);
  if (!kept) {
    if (LR_OCC_KEEP.size > 40) LR_OCC_KEEP.clear();
    kept = lrOccasionsNowCalc(cfg, today);
    LR_OCC_KEEP.set(key, kept);
  }
  return kept.slice();
}
function lrOccasionsNowCalc(cfg, today) {
  return (cfg.events || []).map(e => ({ e, s: lrSeason(e, today, cfg.events), st: lrSeasonState(e, today, cfg.events) })).filter(each => each.st.active)
    .sort((a, b) => a.s.next - b.s.next).map(each => each.e.name.replace(/'s$/, "'s"));
}
/** The parts a template asks for, filled from what this SKU is. */
// SMOOTH (17 Nov 2026): one judging pass (one hCtx — rebuilt after every Listing Rules edit) asks for today's occasions once, not once
// per listing: kept on the context with the rules and the day it was worked out for.
function lrCtxOcc(ctx) {
  const k = ctx._occ;
  if (k && k.cfg === ctx.cfg && k.today === ctx.today) return k.list;
  ctx._occ = { cfg: ctx.cfg, today: ctx.today, list: lrOccasionsNow(ctx.cfg, ctx.today) };
  return ctx._occ.list;
}
function lrParts(row, tpl, cfg, today, occ) {
  const cat = lrCatOf(row) || {};
  const example = ((cfg.issues || []).find(issue => issue.detector === 'size_format') || {}).params;   // the size_format rule's settings
  return {
    brand: lrBrandName(row, cfg), product: tpl.product || '', shape: lrShape(cat.subcat),
    material: tpl.material || '', size: lrSizeText(cat.size, example && example.example), pattern: tpl.pattern || '',
    uses: tpl.uses || '', occasions: (occ || lrOccasionsNow(cfg, today)).join(' '), color: cat.color || '',
  };
}
/** The title the template would write for this listing. */
// Fills the template's tokens from lrParts, tidies the spaces and dashes; over Amazon's 200 the occasions go, then the words THE ONE
// SUGGESTION-WORDS RULE (lrSuggestWords) lets go — never brand, product, shape, material, size, the print or the colour.
function lrSuggest(row, cfg, today) {
  cfg = cfg || LR || LR_DEFAULT;
  today = today || new Date();
  const tpl = lrTemplateFor(row, cfg);
  if (!tpl) return '';
  const parts = lrParts(row, tpl, cfg, today);
  const fill = drop => String(tpl.template || '').replace(/\{(\w+)\}/g, (_, key) => (drop.includes(key) ? '' : (parts[key] || '')))
    .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
  let out = fill([]);
  // Amazon's hard limit is 200 characters: occasions go first, then the words the one rule lets go
  if (out.length > 200) out = fill(['occasions']);
  if (out.length > 200) out = lrSuggestWords(out, { mode: 'title', facts: lrSwFacts(row, cfg, null, { title: hTitleText(row) }), fits: text => text.length <= 200 }).after;
  return out.slice(0, 200);
}

/* ---- the detectors: each answers '' (fine) or what it found ---- */
// Each detector is (row, ctx, params) → '' or the detail text; ctx is what hCtx built, params the rule's settings.
const LR_DET = {
  inactive_with_stock: row => (/inactive/i.test(row.status || '') && row.qty > 0) ? `${row.qty} in stock but the listing is Inactive` : '',
  no_price: row => row.price === 0 ? 'no price' : '',
  // Amazon's own verdict: the Workspace's live read of the listing first, else the Image Manager snapshot (lrAmz).
  // Suppressed only by THE ONE RULE (lrShopOf): an ERROR issue alone is never a suppression.
  amazon_suppressed: (row, ctx) => {
    const amz = lrFactsOf(row, ctx).amz;
    if (!amz) return '';
    const shop = lrShopOfAmz(amz, row);
    return shop.k === 'sup' ? shop.why : '';
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
  // A gallery picture under PX on its longest side: zoom does not work. Judged only on sizes the live read brought back.
  images_small: (row, ctx, params) => {
    const pics = lrFactsOf(row, ctx).pics;
    const min = +params.px || 1000;
    if (!pics || !pics.px) return '';
    const small = Object.entries(pics.px).filter(([, wh]) => Math.max(wh[0], wh[1]) < min);
    return small.length ? `${small.length} picture${small.length === 1 ? '' : 's'} under ${min} px: ${small.map(([slot, wh]) => `${slot} (${Math.max(wh[0], wh[1])} px)`).join(', ')}` : '';
  },
  // The main picture more than PCT % longer one way than the other.
  main_not_square: (row, ctx, params) => {
    const pics = lrFactsOf(row, ctx).pics;
    const wh = pics && pics.px && pics.px.MAIN;
    if (!wh) return '';
    const ratio = Math.max(wh[0], wh[1]) / Math.min(wh[0], wh[1]);
    return ratio > 1 + (+params.pct || 10) / 100 ? `${wh[0]} × ${wh[1]} px` : '';
  },
  // The same picture in two gallery slots (by the picture's id in its link).
  images_duplicate: (row, ctx) => {
    const pics = lrFactsOf(row, ctx).pics;
    if (!pics || !pics.ids) return '';
    const first = {};
    for (const [slot, id] of Object.entries(pics.ids)) {
      if (!id) continue;
      if (first[id]) return `${slot} is the same picture as ${first[id]}`;
      first[id] = slot;
    }
    return '';
  },
  // A person looked at the main picture in Image Manager → Picture check and marked it Not OK. Not looked at yet: no problem here —
  // the check line says "◐ A person needs to look" instead (lrLooks), and it is counted nowhere.
  main_photo_check: (row, ctx) => {
    const mark = lrPcMark(row, ctx);
    return mark && mark.v === 'bad' ? `marked Not OK by ${mark.name || mark.by || 'someone'} on ${lrFmtDate(new Date(mark.at))}${mark.note ? ': ' + mark.note : ''}` : '';
  },
  bullets_below: (row, ctx, params) => (row.content && row.content.bullets < (+params.n || 5))
    ? `${row.content.bullets} of ${+params.n || 5}` : '',
  // When A+ is live on the listing or its parent, Amazon shows the A+ instead of the description (Part A3): not judged.
  desc_below: (row, ctx, params) => (row.content && row.content.descLen < (+params.n || 200) && lrFactsOf(row, ctx).aplus.v !== true)
    ? (row.content.descLen ? `${row.content.descLen} characters` : 'none') : '',
  // Search terms from the live Amazon read only (Part A4); "Search terms: 233 of 249 bytes" when fine, what to cut when over.
  keyword_bytes: (row, ctx, params) => {
    if (row.kw == null) return '';
    const k = lrKwCheck(row.kw, params.max, row.kwBytes);       // the one rule (the Optimiser's review judges with it too)
    return k.over ? `${k.bytes} of ${k.max} bytes — cut ${k.cut}; over the limit Amazon may ignore all of them` : '';
  },
  // Our submitted title (the live read's item_name) is not the title Amazon shows: ours is not live. Both titles are named.
  title_not_live: row => (row.shownTitle && row.submittedTitle && !lrSameTitle(row.shownTitle, row.submittedTitle)
    ? `Amazon shows: "${row.shownTitle}" · Yours: "${row.submittedTitle}"` : ''),
  title_length: (row, ctx, params) => (row.content && (row.content.titleLen < (+params.min || 0) || row.content.titleLen > (+params.max || 999)))
    ? `${row.content.titleLen} characters` : '',
  // OUR TITLE FORMAT (20 Nov 2026): "54x54 Inch" or "54 x 54 Inch" (the family's way), the rule's example, the 74–75 short forms; a size
  // with no unit at all is title_template's "Missing Inch" (never two findings for one mistake)
  size_format: (row, ctx, params) => {
    const title = hTitleText(row);
    const bad = hTitleSizes(title).find(size => LR_UNIT_RE.test(size.text) && (!lrSizeOurs(size.text, ctx.cfg, title, params.example) || lrSizeOffFamily(size, row, ctx, title)));
    if (bad && lrSizeOurs(bad.text, ctx.cfg, title, params.example)) return `"${bad.text}" — the family writes "${lrSizeWant(bad, row, ctx, title)}"`;
    return bad ? `"${bad.text}"` : '';               // the heading reads: Size not in our format: "60×60 Inches" (LR_WHAT_TEXT)
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
  // OUR TITLE FORMAT (20 Nov 2026): only real mistakes — never the word order (lrTitleProblems); no template needed (CPC as Ridhi)
  title_template: (row, ctx) => lrTitleProblems(row, ctx).map(p => p.what).join(' · '),
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

/* ---- OUR TITLE FORMAT (20 Nov 2026, the manager's decision) ----
 * Our real titles: "Ridhi Amber Marigold Hand Block Print Square Tablecloth 54x54 Inch" = Brand · Colour · Hand Block Print · Shape ·
 * Product · Size · Inch. A listing KEEPS ITS OWN format and word order: nothing is ever put in another order, and a title in our format
 * is never an error. Only real mistakes are errors, each fixed with the smallest change, every other word kept word-for-word
 * (lrTitleFix — the one function every title suggestion uses: Fix all titles, Listing Errors' content, the Listing Optimiser, Create
 * Listing; the AI is told the same):
 *   spelling   a word 1–2 letters from a word many of our titles use, itself in very few ("Rectange" → "Rectangle") — never a colour
 *              name (the listing's colour attribute, any catalogue colour) and never our brand words
 *   shape      the size contradicts it ("Square" on 60x90 → "Rectangle", "Rectangle" on 54x54 → "Square")
 *   missing    no brand · no colour · no product · no size · no "Inch" after the size → only that part, in its place in our order
 *   repeated   a word said twice ("Tablecloth … Tablecloth") → the second goes
 *   size       written another way than ours ("54×54", "60X90 Inches") → the family's own way ("54x54 Inch" or "54 x 54 Inch"); "Inch"
 *              is never removed
 *   and the existing title rules: the smaller number first, "Block Print", the length limit (the 74–75 short forms), another brand's name.
 * Main functions: lrTitleProblems (what is wrong — the title_template finding), lrTitleFix (the smallest change), lrSizeOurs, lrSpellDict. */
const LR_TITLE_FORMAT = '{brand} {color} {pattern} {shape} {product} {size}';
const LR_SPELL_MANY = 10;              // a word this many of our titles use is one we write
const LR_SPELL_FEW = 2;                // …and a word in this few, 1–2 letters from one of those, is a likely mistake
const LR_SHAPE_RE = /\b(square|rectangle|rectangular|round|oval)\b/i;
const LR_UNIT_RE = /(inch(?:es)?|inc\.?|\bin\.?|"|”|″|\bcm)\s*$/i;
const lrRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Words every listing may write that are not mistakes of another word (the suggestion-words rule's own vocabulary).
let LR_SPELL_KNOWN = null;
function lrSpellKnown(k) {
  if (!LR_SPELL_KNOWN) {
    LR_SPELL_KNOWN = new Set();
    [LR_SW_PRODUCTS, LR_SW_USES, LR_SW_COLORS, LR_SW_LOW, LR_SW_STOP, Object.values(LR_SW_SHAPES).flat()].forEach(list => list.forEach(p => String(p).toLowerCase().split(/[^a-z]+/).forEach(w => w && LR_SPELL_KNOWN.add(w))));
  }
  return LR_SPELL_KNOWN.has(k);
}
// The words of our own titles — how many titles use each; colours (catalogue, listings) — kept with the rules' context.
function lrSpellDict(ctx) {
  if (ctx && ctx._spell) return ctx._spell;
  const n = new Map(), cased = new Map(), colours = new Set();
  const rows = (ctx && ctx.rows) || [];
  rows.forEach(row => {
    const words = hTitleText(row).match(/[A-Za-z]{4,}/g) || [];
    new Set(words.map(w => w.toLowerCase())).forEach(w => n.set(w, (n.get(w) || 0) + 1));
    words.forEach(w => { const k = w.toLowerCase(); if (!cased.has(k)) cased.set(k, w); });
    String(lrColorOf(row) || '').toLowerCase().split(/[^a-z]+/).forEach(w => w && colours.add(w));
  });
  ['SP', 'CPC'].forEach(b => Object.values((typeof LR_CAT !== 'undefined' && LR_CAT[b]) || {}).forEach(c => String((c && c.color) || '').toLowerCase().split(/[^a-z]+/).forEach(w => w && colours.add(w))));
  const d = { n, cased, colours, many: [...n.entries()].filter(([, c]) => c >= LR_SPELL_MANY).map(([w]) => w) };
  if (ctx) ctx._spell = d;
  return d;
}
// Letters apart (adjacent letters swapped count as one), stopping past `max`.
function lrEdit(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let low = Infinity;
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      low = Math.min(low, d[i][j]);
    }
    if (low > max) return max + 1;
  }
  return d[a.length][b.length];
}
/** A likely spelling mistake: the word our titles mean, or null. Never a colour, our brand words, a word our vocabulary knows, a word
 *  many of our titles use, or a plural / singular of a word we use. */
function lrSpellOf(word, ctx, protect) {
  const d = lrSpellDict(ctx);
  const k = String(word).toLowerCase();
  if (k.length < 4 || (d.n.get(k) || 0) > LR_SPELL_FEW || d.colours.has(k) || (protect && protect.has(k)) || lrSpellKnown(k)) return null;
  const max = k.length >= 7 ? 2 : 1;
  let best = null;
  d.many.forEach(v => {
    if (v === k || v[0] !== k[0] || Math.abs(v.length - k.length) > max) return;
    if (v === k + 's' || k === v + 's' || v === k + 'es' || k === v + 'es') return;
    const e = lrEdit(k, v, max);
    if (e <= max && (!best || e < best.e || (e === best.e && d.n.get(v) > d.n.get(best.v)))) best = { v, e };
  });
  if (!best) return null;
  const to = d.cased.get(best.v) || best.v;
  return word[0] === word[0].toUpperCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to.toLowerCase();
}
/** A size written our way: "54x54 Inch" or "54 x 54 Inch" (and W x H x D), the rule's own example, or — at 74–75 characters — a short form. */
const LR_SIZE_OURS_RE = /^\d+(?:\.\d+)?(?: x |x)\d+(?:\.\d+)?(?:(?: x |x)\d+(?:\.\d+)?)? Inch$/;
function lrSizeOurs(text, cfg, title, example) {
  const t = String(text);
  if (LR_SIZE_OURS_RE.test(t)) return true;
  if (example && lrSizeOk(t, example)) return true;
  return lrNear(title, cfg) && lrSizeLoose(t);
}
// The family's sizes in our format ("54x54 Inch" / "54 x 54 Inch" — a size written wrong does not vote): how many write 'x' and how
// many ' x ', counted once per family (ctx._sep).
function lrSizeFam(row, ctx) {
  if (!row.parent || !ctx || !ctx.rows) return { tight: 0, spaced: 0 };
  const key = row.brand + '|' + row.parent;
  ctx._sep = ctx._sep || new Map();
  if (ctx._sep.has(key)) return ctx._sep.get(key);
  const fam = { tight: 0, spaced: 0 };
  ctx.rows.forEach(r => {
    if (r.parent !== row.parent || (r.brand || row.brand) !== row.brand) return;
    hTitleSizes(hTitleText(r)).forEach(s => { if (!LR_SIZE_OURS_RE.test(s.text)) return; if (/\d x \d/.test(s.text)) fam.spaced++; else fam.tight++; });
  });
  ctx._sep.set(key, fam);
  return fam;
}
// The family's own way to write a size: what most of its children write; a tie or no family: the listing's own way (own), else "54x54".
function lrSizeSep(row, ctx, own) {
  const fam = lrSizeFam(row, ctx);
  if (fam.spaced > fam.tight) return ' x ';
  if (fam.tight > fam.spaced) return 'x';
  return own && /\d x \d/.test(own) ? ' x ' : 'x';
}
// A size in our format ("54x54 Inch" / "54 x 54 Inch") written the other way from most of its family → the family's way (rule e).
// Not at 74–75 when the family's way is longer (the short form was chosen to fit).
function lrSizeOffFamily(size, row, ctx, title) {
  const t = String(size.text);
  if (!LR_SIZE_OURS_RE.test(t)) return false;
  const fam = lrSizeFam(row, ctx), spaced = /\d x \d/.test(t);
  if (spaced) return fam.tight > fam.spaced;
  return fam.spaced > fam.tight && !lrNear(title, ctx.cfg);
}
// A size in our format, the family's way, the smaller number first; a short unit ("In", ") kept at 74–75, else "Inch".
function lrSizeWant(size, row, ctx, title) {
  const nums = size.c === null ? [Math.min(size.a, size.b), Math.max(size.a, size.b)] : [size.a, size.b, size.c];
  const unit = (String(size.text).match(LR_UNIT_RE) || [])[1] || '';
  const keep = /^(in\.?|"|”|″)$/i.test(unit) && lrNear(title, ctx.cfg) ? (unit === 'in' || unit === 'in.' ? 'In' : unit) : 'Inch';
  return nums.join(lrSizeSep(row, ctx, size.text)) + (/^["”″]$/.test(keep) ? keep : ' ' + keep);
}
/** What is wrong with a title (never its word order): [{ k: spell | shape | missing | repeat, what (the heading), from, to, part }]. */
function lrTitleProblems(row, ctx) {
  const title = hTitleText(row);
  if (!title) return [];
  const cfg = ctx.cfg;
  const f = lrSwFacts(row, cfg, null, { title });
  const out = [];
  const brands = lrBrandWords(row, cfg);
  const protect = new Set(brands.flatMap(w => lrNorm(w).split(/[^a-z]+/)).concat(String(f.colour || '').toLowerCase().split(/[^a-z]+/)).filter(Boolean));
  // spelling
  const said = new Set();
  (title.match(/[A-Za-z]{4,}/g) || []).forEach(w => {
    if (said.has(w)) return;
    const to = lrSpellOf(w, ctx, protect);
    if (to) { said.add(w); out.push({ k: 'spell', what: `Spelling: ${w} → ${to}`, from: w, to }); }
  });
  // the shape the size says
  const size = hTitleSizes(title)[0];
  const sm = title.match(LR_SHAPE_RE);
  if (sm && size && size.c === null) {
    const s = sm[1].toLowerCase();
    if ((s === 'square' && size.a !== size.b) || ((s === 'rectangle' || s === 'rectangular') && size.a === size.b)) {
      const to = size.a === size.b ? 'Square' : 'Rectangle';
      out.push({ k: 'shape', what: `Shape doesn't match size: ${sm[1]} → ${to}`, from: sm[1], to });
    }
  }
  // a missing part — judged on the title with its misspellings corrected ("Tablcloth" is a spelling, not a missing product)
  const fixedT = out.reduce((t, p) => t.replace(new RegExp(`\\b${lrRx(p.from)}\\b`), p.to), title);
  if (brands.length && !brands.some(w => lrFind(lrNorm(fixedT), w) >= 0)) out.push({ k: 'missing', part: 'brand', what: 'Missing brand' });
  const cw = String(f.colour || '').split(/[^A-Za-z]+/).filter(w => w.length > 2 && !LR_SW_STOP_SET.has(w.toLowerCase()));
  if (cw.length && !cw.some(w => lrHas(fixedT, w))) out.push({ k: 'missing', part: 'color', what: 'Missing colour', value: f.colour });
  const prods = (f.product || []).filter(Boolean);
  if (prods.length && !prods.some(p => lrHas(fixedT, p))) out.push({ k: 'missing', part: 'product', what: 'Missing product', value: prods[0] });
  if (!size) {
    const group = row.parent ? ctx.parents.get(row.parent + '|' + row.brand) : null;
    if (f.size && !(group && group.sized > 0)) out.push({ k: 'missing', part: 'size', what: 'Missing size', value: f.size });   // a family that names sizes: its own rule
  } else if (!LR_UNIT_RE.test(size.text)) out.push({ k: 'missing', part: 'inch', what: 'Missing "Inch" after the size' });
  // a word that is pure waste: right after itself ("Tablecloth Tablecloth"), or the product / shape / colour word three times — not
  // ordinary English ("Table Runner for Dining Table") and not the old template's "Cloth Napkins … Dinner Napkins" (said twice)
  const toks = fixedT.match(/[A-Za-z]{3,}/g) || [];
  const own = new Set((f.product || []).filter(p => /\s/.test(String(p).trim()) || LR_SW_PRODUCTS.includes(String(p).toLowerCase())).map(p => String(p).trim().split(/\s+/).pop()).concat(LR_SW_PRODUCTS.filter(p => !/\s/.test(p)), String(f.colour || '').split(/[^A-Za-z]+/))
    .map(lrSwKey).filter(k => k && k.length > 2 && !LR_SW_STOP_SET.has(k)));
  const cnt = new Map();
  toks.forEach((w, i) => { const k = lrSwKey(w); if (!cnt.has(k)) cnt.set(k, { n: 0, w, next: false }); const c = cnt.get(k); c.n++; if (i && lrSwKey(toks[i - 1]) === k) c.next = true; });
  cnt.forEach((v, k) => { if (k !== 'inch' && (v.next || (v.n >= 3 && (own.has(k) || LR_SW_SHAPE_OF.has(k))))) out.push({ k: 'repeat', what: `Repeated word: ${v.w}`, key: k }); });
  return out;
}
/** THE SMALLEST FIX of a title: { before, after, fixes: [what], held } — the listing's own words, in its own order, with only its real
 *  mistakes corrected (lrTitleProblems), the size our way, "Block Print" where the rule asks for it, another brand's name out (o.risk),
 *  and over the length limit the suggestion-words rule (the 74–75 short forms). o: { title, va (Amazon's facts), risk, max }. */
function lrTitleFix(row, ctx, o) {
  o = o || {};
  const before = o.title != null ? String(o.title) : hTitleText(row);
  const fixes = [];
  if (!before) return { before, after: before, fixes, held: 'no title' };
  const cfg = ctx.cfg;
  const r = Object.assign({}, row, { shownTitle: before });
  const f = lrSwFacts(r, cfg, o.va || null, { title: before });
  let t = before;
  const probs = lrTitleProblems(r, ctx);
  // 1 a misspelt word, a shape the size contradicts: that word only
  probs.filter(p => p.k === 'spell' || p.k === 'shape').forEach(p => { t = t.replace(new RegExp(`\\b${lrRx(p.from)}\\b`), p.to); fixes.push(p.what); });
  // 2 the size: our format, the family's way, the smaller number first, "Inch" after it
  const size = hTitleSizes(t)[0];
  if (size) {
    const ex = ((cfg.issues || []).find(i => i.detector === 'size_format') || {}).params || {};
    const wrong = !lrSizeOurs(size.text, cfg, t, ex.example) || lrSizeOffFamily(size, r, ctx, t) || (size.c === null && size.a > size.b) || !LR_UNIT_RE.test(size.text);
    if (wrong) {
      const want = lrSizeWant(size, r, ctx, t);
      if (want !== size.text) { t = t.replace(size.text, want); fixes.push(LR_UNIT_RE.test(size.text) ? `Size: ${size.text} → ${want}` : 'Missing "Inch" after the size'); }
    }
  }
  // 3 a missing part, only that part, in its place in our order (Brand · Colour · Print · Shape · Product · Size)
  const has = w => lrHas(t, w);
  probs.filter(p => p.k === 'missing').forEach(p => {
    if (p.part === 'brand') { const b = lrBrandName(r, cfg); if (b) { t = b + ' ' + t; fixes.push('Missing brand'); } }
    else if (p.part === 'color' && p.value && !String(p.value).split(/\s+/).some(has)) {
      const b = lrBrandWords(r, cfg).map(w => { const m = t.match(new RegExp(`\\b${lrRx(w)}\\b`, 'i')); return m ? m.index + m[0].length : -1; }).filter(i => i >= 0)[0];
      t = b != null ? t.slice(0, b) + ' ' + lrCaps(p.value) + t.slice(b) : lrCaps(p.value) + ' ' + t;
      fixes.push('Missing colour');
    } else if (p.part === 'product' && p.value) {
      const s = hTitleSizes(t)[0];
      const at = s ? t.indexOf(s.text) : -1;
      t = at >= 0 ? t.slice(0, at) + lrCaps(p.value) + ' ' + t.slice(at) : t + ' ' + lrCaps(p.value);
      fixes.push('Missing product');
    } else if (p.part === 'size' && p.value) {
      const nums = String(p.value).match(/\d+(?:\.\d+)?/g) || [];
      if (nums.length >= 2) {
        const sz = nums.slice(0, 3).map(Number);
        const txt = (sz.length === 2 ? [Math.min(sz[0], sz[1]), Math.max(sz[0], sz[1])] : sz).join(lrSizeSep(r, ctx)) + ' Inch';
        const prod = (f.product || []).map(pw => { const m = t.match(new RegExp(`\\b${lrRx(pw)}\\b`, 'i')); return m ? m.index + m[0].length : -1; }).filter(i => i >= 0).sort((a, b) => b - a)[0];
        t = prod != null ? t.slice(0, prod) + ' ' + txt + t.slice(prod) : t + ' ' + txt;
        fixes.push('Missing size');
      }
    }
  });
  // 4 "Block Print" where the rule asks for it (a sibling's title or its own bullets say it): before the shape / the product
  const kw = (cfg.issues || []).find(i => i.detector === 'title_keyword' && i.on !== false);
  const kwWords = kw ? lrWords((kw.params || {}).words) : [];
  if (kwWords.length && !kwWords.some(has) && kwWords.some(w => lrNorm(w) === 'block print') && lrBlockPrintProof(Object.assign({}, r, { shownTitle: t }), ctx)) {
    const print = lrSiblingsSay(r, ctx, 'hand block print') ? 'Hand Block Print' : 'Block Print';
    const sm = t.match(LR_SHAPE_RE);
    const pm = sm ? null : (f.product || []).map(pw => t.match(new RegExp(`\\b${lrRx(pw)}\\b`, 'i'))).filter(Boolean)[0];
    const bEnd = lrBrandWords(r, cfg).map(w => { const m = t.match(new RegExp(`\\b${lrRx(w)}\\b`, 'i')); return m ? m.index + m[0].length + 1 : -1; }).filter(i => i >= 0)[0] || 0;
    const at = Math.max(sm ? sm.index : pm ? pm.index : -1, bEnd);
    t = at > 0 ? t.slice(0, at) + print + ' ' + t.slice(at) : at === 0 && !bEnd ? print + ' ' + t : t + ' ' + print;
    fixes.push(`Missing "${print}"`);
  }
  // 5 a word said twice: the second goes
  probs.filter(p => p.k === 'repeat').forEach(p => {
    let n = 0;
    t = t.replace(/\s*\b[A-Za-z]{3,}\b/g, m => (lrSwKey(m.trim()) === p.key && ++n === 2 ? '' : m));
    if (n > 1) fixes.push(p.what);
  });
  // 6 another brand's name or a restricted claim (IP & Trademark Guard): out
  const spans = typeof o.risk === 'function' ? o.risk(t) || [] : [];
  if (spans.length) { spans.slice().sort((a, b) => b.s - a.s).forEach(sp => { t = t.slice(0, sp.s) + t.slice(sp.e); }); fixes.push('Another brand\'s name taken out'); }
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  // 7 over the length limit: the suggestion-words rule (its order kept; the 74–75 short forms; "Inch" never goes)
  const lenRule = (cfg.issues || []).find(i => i.detector === 'title_length' && i.on !== false);
  const max = Math.min(+o.max || 75, lenRule && +(lenRule.params || {}).max ? +lenRule.params.max : 75);
  let held = '';
  if (t.length > max) {
    const own = lrSwFacts(r, cfg, null, { title: t }).colour;
    const fl = Object.assign({}, f, { colour: [f.colour, own].find(c => c && String(c).split(/\s+/).some(w => w.length > 2 && lrHas(t, w))) || f.colour });
    let s = lrSuggestWords(t, { mode: 'title', facts: fl, fits: x => x.length <= max, shortFrom: lrAllow(cfg).shortFrom });
    if (/\bInch\b/.test(t) && !/\bInch\b/.test(s.after)) s = lrSuggestWords(t, { mode: 'title', facts: fl, fits: x => x.length <= max, short: false });   // "Inch" never goes
    if (s.after !== t) fixes.push(`Shortened to ${s.after.length} characters`);
    t = s.after;
    if (!s.fits) held = `${LR_SW_IMPORTANT} (${t.length} characters, over ${max})`;
  }
  return { before, after: t, fixes, held, probs };
}
// "amber marigold" → "Amber Marigold" (a value from an attribute put into a title).
const lrCaps = v => String(v || '').replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, ch => ch.toUpperCase());
// Do most of this listing's siblings say these words in their titles?
function lrSiblingsSay(row, ctx, words) {
  if (!row.parent || !ctx.rows) return false;
  const sib = ctx.rows.filter(r => r.parent === row.parent && r.sku !== row.sku && (r.brand || row.brand) === row.brand);
  return sib.length > 0 && sib.filter(r => hTitleText(r).toLowerCase().replace(/[s-]+/g, ' ').includes(words)).length * 2 >= sib.length;   // as written (lrNorm reads Hand Block Print as Block Print)
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
    // the ListingMatch cache answers for the brands it holds (listing-match.js, read from this browser's copy — no wait for the network)
    const lmB = typeof lmEnsure === 'function' ? (await lmEnsure(), lmAmzBrands()) : [];
    for (const brand of ['SP', 'CPC']) {
      if (lmB.includes(brand)) continue;
      const head = await getDoc(doc(db, 'imgsnap', brand));
      if (!head.exists()) continue;
      const nChunks = head.data().chunks || 0;
      AMZ.snapAt[brand] = head.data().at && head.data().at.toDate ? head.data().at.toDate().getTime() : 0;
      const got = await Promise.all(Array.from({ length: nChunks }, (_, i) => getDoc(doc(db, 'imgrows', brand + '_' + i))));
      got.forEach(chunk => {
        if (!chunk.exists()) return;
        (chunk.data().r || []).forEach(item => {
          // `im` is Amazon's first error cut at 140 characters; the issue list (`iss`) keeps each message to 220, so the errors come from there.
          if (item && item.sku) map.set(brand + '|' + item.sku, { st: item.st || '', ie: item.ie || 0, iw: item.iw || 0, im: item.im || '', iss: item.iss || [],
            em: (item.iss || []).filter(issue => issue && issue.s === 'E').map(issue => (issue.c ? `ERROR ${issue.c}: ` : '') + lrWholeCut(String(issue.m || ''), 220)) });
        });
      });
    }
    if (lmB.length) lmAmzApply(map);
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
// The live read of one listing, or null — with the ListingMatch cache's record under it (listing-match.js lmLiveOf: the newer of the two,
// part by part) while that cache is usable.
const lrLiveOf = (row, ctx) => {
  const ws = ((ctx.wsLive && ctx.wsLive[row.brand]) || {})[row.sku] || null;
  return ctx.lm ? lmLiveOf(row.brand, row.sku, ws) : ws;
};
// The Image Manager snapshot's item for one listing, or null.
const lrImlOf = (row, ctx) => (ctx.iml && ctx.iml[row.brand] ? ctx.iml[row.brand].get(row.sku) : null) || null;
// The gallery slots of a slot → url map or a slot list: MAIN + PT01–PT08, in order; the swatch (SWCH) is not a picture.
const lrGallery = slots => (Array.isArray(slots) ? slots : Object.keys(slots || {}).filter(slot => slots[slot]))
  .filter(slot => slot !== 'SWCH' && /^(MAIN|PT0[1-8])$/.test(slot));
/** The pictures shoppers see: { n, main, at, src: 'live' | 'iml' | 'health', own } — the catalogue slots of the Workspace's live
 *  read, else the Image Manager snapshot's live slots when newer than the listing's content read, else the Health snapshot's
 *  count (which cannot tell the swatch apart). `own`: our listing's own gallery slots when known (the live read). Null = unknown. */
// A catalogue picture's id — the part of its link that names the picture ("…/images/I/71Q1abcL.jpg" → "71Q1abcL"): the same picture has
// the same id whatever size Amazon serves, so two slots with one id show one picture, and a new id means the picture changed.
const lrPicId = url => { const m = String(url || '').match(/\/images\/I\/([^./?]+)/); return m ? m[1] : String(url || ''); };
// Which picture is in which gallery slot ({ MAIN: id, PT01: id … }), from a slot → link map or the live read's [id, w, h] map; null for none.
const lrPicIds = (map, packed) => (map ? Object.fromEntries(lrGallery(map).map(slot => [slot, packed ? map[slot][0] : lrPicId(map[slot])])) : null);
// Each gallery picture's size in pixels ({ MAIN: [w, h] … }) from the live read; null when the sizes were not read.
const lrPicPx = map => (map ? Object.fromEntries(lrGallery(map).filter(slot => map[slot][1] > 0 && map[slot][2] > 0).map(slot => [slot, [map[slot][1], map[slot][2]]])) : null);
function lrPictures(row, ctx) {
  const live = lrLiveOf(row, ctx);
  const iml = lrImlOf(row, ctx);
  const imlAt = (ctx.imlAt && ctx.imlAt[row.brand]) || 0;
  // The snapshot's catalogue answer counts only for an item the catalogue was asked about (one with an ASIN) and answered: an
  // empty live map on an item without an ASIN, or one marked liveErr, is no answer — never "no picture in the catalogue".
  const imlOk = iml && iml.live && iml.asin && !iml.liveErr && imlAt;
  if (live && live.iAt && Array.isArray(live.cat)) {
    const g = lrGallery(live.cat);
    const pic = live.catPic && typeof live.catPic === 'object' ? live.catPic : null;   // { slot: [id, w, h] } — reads before 12 Nov have none
    const ids = pic ? lrPicIds(pic, true) : imlOk ? lrPicIds(iml.live) : null;
    return { n: g.length, main: g.includes('MAIN'), at: live.iAt, src: 'live', own: live.gAt && Array.isArray(live.slots) ? lrGallery(live.slots) : null,
      ids, px: pic ? lrPicPx(pic) : null, mainId: (ids && ids.MAIN) || (live.catMain ? lrPicId(live.catMain) : '') };
  }
  const checked = row.checked || 0;
  const fromIml = () => {
    const g = lrGallery(iml.live);
    const ids = lrPicIds(iml.live);
    return { n: g.length, main: g.includes('MAIN'), at: imlAt, src: 'iml', own: iml.img ? lrGallery(iml.img) : null, ids, px: null, mainId: (ids && ids.MAIN) || '' };
  };
  if (imlOk && imlAt > checked) return fromIml();
  if (row.content && row.content.images != null) {
    const n = Number(row.content.images) || 0;
    return { n, main: n > 0, at: checked, src: 'health', own: null, ids: null, px: null, mainId: '' };
  }
  return imlOk ? fromIml() : null;
}
/** A+ for one listing (Part A2): { v: true | false | undefined, at, stale, src, why }. A child has A+ when it or its parent ASIN has a
 *  publish record (the Workspace's answers first, then the Health snapshot's: the row's own and HEALTH[brand].parentAplus). Never
 *  asked, or the parent not asked yet: not judged. A "missing" answer older than LR_APLUS_DAYS is `stale` and asked again first. */
function lrAplus(row, ctx) {
  const pub = lrAplusPub(row, ctx);
  /* THE A+ DOCUMENTS FIRST (18 Nov 2026): ListingMatch reads every A+ document and its ASINs once a day (listing-match.js lmAplusOf).
   * While that read is fresh and can say for this ASIN, it is the answer — an approved document on the listing or its parent = A+,
   * none approved = no A+ — and nothing is read one by one. Missing, old (over 30 h) or unsure: the publish records below, as before.
   * One guard: the documents say "none live" but a publish record read in the last LR_APLUS_DAYS days says A+ is on the page — the page
   * wins until that record is old (`until`: the moment the answer changes; the kept checks are judged again then). */
  const doc = typeof lmAplusOf === 'function' ? lmAplusOf(row.brand, row.asin, row.parent) : null;
  if (!doc) return pub;
  if (doc.v === true) return doc;
  if (pub.v === true && pub.at > 0 && Date.now() - pub.at <= LR_APLUS_DAYS * LR_DAY) return Object.assign({}, pub, { until: pub.at + LR_APLUS_DAYS * LR_DAY + 1 });
  return doc;
}
// A+ from the publish records Sellora read one ASIN at a time (?lh=aplusasin): the answer before the daily A+ read, and its fallback.
function lrAplusPub(row, ctx) {
  const ws = (ctx.wsAplus && ctx.wsAplus[row.brand]) || {};
  const saved = (ctx.parentAplus && ctx.parentAplus[row.brand]) || {};
  const newer = (a, b) => (a && b ? ((a.at || 0) >= (b.at || 0) ? a : b) : a || b || null);
  const child = newer(ws[row.asin], row.aplus === undefined ? null : { v: row.aplus, at: row.aplusAt || 0 });
  const parent = row.parent ? newer(ws[row.parent], saved[row.parent]) : null;
  if (child && child.v === true) return { v: true, at: child.at || 0, src: 'listing' };
  if (parent && parent.v === true) return { v: true, at: parent.at || 0, src: 'parent' };
  if (!child || child.v !== false) return { v: undefined, at: 0, why: 'A+ not checked yet' };
  if (row.parent && (!parent || parent.v !== false)) return { v: undefined, at: child.at || 0, note: true, why: "the listing has none, and its parent ASIN's A+ was not asked yet" };
  const at = Math.min(child.at || 0, parent ? parent.at || 0 : child.at || 0);
  const stale = !(at > 0) || Date.now() - at > LR_APLUS_DAYS * LR_DAY;
  return { v: false, at, stale, src: row.parent ? 'listing and parent' : 'listing', why: stale ? `the "no A+" answer is ${at > 0 ? Math.round((Date.now() - at) / LR_DAY) + ' days' : 'too'} old — asked again before it counts` : '' };
}
/** A message a source kept only `max` characters of (the snapshot: 140, its issue list: 220): at that length or longer it was cut, so
 *  it ends on the last whole word with "…" — never mid-word ("resu"). Shorter text is returned as it is. */
function lrWholeCut(text, max) {
  const str = String(text == null ? '' : text);
  if (str.length < max || str.endsWith('…')) return str;
  const head = str.slice(0, max);
  const space = head.search(/\s\S*$/);
  return (space > max / 2 ? head.slice(0, space) : head).replace(/[\s,;:.\-–—]+$/, '') + '…';
}
/** Amazon's own verdict on one listing: { st, ie, im, errs, at, src: 'live' | 'iml' } — the live read first, else the snapshot. Null = none. */
function lrAmz(row, ctx) {
  const live = lrLiveOf(row, ctx);
  if (live && live.gAt) {
    const errs = (live.iss || []).filter(issue => issue.s === 'E');
    return { st: (live.st || []).join(','), ie: errs.length, im: errs.map(issue => `ERROR ${issue.c}: ${issue.m}`).join(' · '), errs, iss: live.iss || [], at: live.gAt, src: 'live' };
  }
  const amz = ctx.amz && ctx.amz.get(row.brand + '|' + row.sku);
  return amz ? { st: amz.st, ie: amz.ie, im: amz.em && amz.em.length ? amz.em.join(' · ') : lrWholeCut(amz.im, 140), errs: null, iss: amz.iss || [], at: (ctx.amzAt && ctx.amzAt[row.brand]) || 0, src: 'iml' } : null;
}

/* ================= SUPPRESSED · NOT BUYABLE · NOT CHECKED — THE ONE RULE (16 Nov 2026) =================
 * CPCLS-CO-007 (BUYABLE + DISCOVERABLE, one ERROR about its colour swatch) showed "Suppressed": an ERROR was read as a suppression
 * (a list of codes, and the word "suppress" in Amazon's message). Every screen now asks lrShopOf, and nothing else decides it:
 *   'unk'   no status from Amazon (the read failed, or it was never read) → "Not checked" — never Suppressed
 *   'sup'   a) the status has BUYABLE but not DISCOVERABLE (hidden from search), or
 *           b) an Amazon issue's enforcement action is SEARCH_SUPPRESSED or LISTING_SUPPRESSED, or
 *           c) the SKU is in Amazon's Suppressed listings report (LR_FYP — when Sellora has that report)
 *   'nobuy' no BUYABLE, and live: stock > 0 and not closed on purpose → "Not buyable", apart from Suppressed
 *   'off'   no BUYABLE, and not live (no stock, stock not known, or closed) — nothing shoppers miss
 *   'ok'    buyable and in search. An ERROR issue alone stays 'ok' here: it is an error at its own severity (the Listing Rules
 *           rule "Amazon reports an error"), never a suppression.
 * Shoppers are affected — the F dot red — only for 'sup' and 'nobuy' (lrShopF). */
const LR_SUPPRESS_ACTS = ['SEARCH_SUPPRESSED', 'LISTING_SUPPRESSED'];
const LR_SHOP_WORD = { sup: 'Suppressed', nobuy: 'Not buyable', ok: 'Buyable', off: 'Not buyable (no stock)', unk: 'Not checked' };
// Amazon's Suppressed listings report, per brand: Map sku → Amazon's reason. Empty until Sellora reads that report.
const LR_FYP = { SP: null, CPC: null };
// An issue's enforcement actions, as Amazon names them (['SEARCH_SUPPRESSED', …]) — from whichever shape the read kept.
function lrIssueActs(issue) {
  if (!issue) return [];
  const list = issue.acts || issue.e || (issue.enforcements && issue.enforcements.actions) || [];
  return (Array.isArray(list) ? list : []).map(act => String((act && act.action) || act || '').toUpperCase()).filter(Boolean);
}
/** THE ONE RULE. x = { st: Amazon's status ('BUYABLE,DISCOVERABLE' or an array; null / '' = not read), iss: Amazon's issues,
 *  qty: stock (null = not known), closed: closed on purpose, brand, sku, fyp: the Suppressed report's reason (else LR_FYP) }
 *  → { k: 'sup' | 'nobuy' | 'ok' | 'off' | 'unk', why, how: 'a' | 'b' | 'c' | '' }. */
function lrShopOf(x) {
  x = x || {};
  const raw = x.st == null ? '' : Array.isArray(x.st) ? x.st.join(',') : String(x.st);
  const st = raw.toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!st.length) return { k: 'unk', why: "Not checked — Amazon's status was not read", how: '' };
  const buy = st.includes('BUYABLE'), disc = st.includes('DISCOVERABLE');
  if (buy && !disc) return { k: 'sup', why: 'buyable by direct link, not in search', how: 'a' };
  const hit = (x.iss || []).find(issue => lrIssueActs(issue).some(act => LR_SUPPRESS_ACTS.includes(act)));
  if (hit) {
    const act = lrIssueActs(hit).find(a => LR_SUPPRESS_ACTS.includes(a));
    return { k: 'sup', why: `Amazon: ${act}${hit.c || hit.code ? ' (' + (hit.c || hit.code) + ')' : ''}${hit.m || hit.message ? ' — ' + lrWholeCut(String(hit.m || hit.message), 140) : ''}`, how: 'b' };
  }
  const fyp = x.fyp != null ? x.fyp : (x.brand && x.sku && LR_FYP[x.brand] ? LR_FYP[x.brand].get(x.sku) : null);
  if (fyp) return { k: 'sup', why: "in Amazon's Suppressed listings report" + (typeof fyp === 'string' ? ': ' + fyp : ''), how: 'c' };
  if (!buy) {
    const live = x.qty != null && Number(x.qty) > 0 && !x.closed;
    return live ? { k: 'nobuy', why: `not buyable on Amazon (status ${st.join(', ')}) with ${Number(x.qty)} in stock`, how: '' }
      : { k: 'off', why: `not buyable on Amazon (status ${st.join(', ')})${x.qty == null ? ', stock not known' : x.closed ? ', closed' : ', no stock'}`, how: '' };
  }
  return { k: 'ok', why: 'buyable and in search', how: '' };
}
// The same, for one listing's Amazon facts (lrAmz) and its row (stock, the report's status).
const lrShopOfAmz = (amz, row) => lrShopOf({ st: amz ? amz.st : null, iss: amz ? amz.iss || amz.errs || [] : [], qty: row ? row.qty : null,
  closed: !!(row && /closed/i.test(row.status || '')), brand: row && row.brand, sku: row && row.sku });
// What shoppers get (the F dot): 'r' suppressed or not buyable, 'u' not checked, 'g' otherwise (an ERROR alone keeps it green).
const lrShopF = shop => (shop.k === 'sup' || shop.k === 'nobuy' ? 'r' : shop.k === 'unk' ? 'u' : 'g');
/** CONSOLE ONLY (16 Nov 2026): what THE ONE RULE changes, over the saved snapshots — the Image Manager snapshot (status, issues) and
 *  Listing Health's (stock). `await lrShopReport()` in a signed-in Sellora tab. The old checks are copied here only to compare. */
async function lrShopReport() {
  const oldF = it => {                                   // the F dot before 16 Nov (bfShop with its code list and "suppress" words)
    const st = String(it.st || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (!st.length) return 'u';
    if (!st.includes('BUYABLE') || !st.includes('DISCOVERABLE')) return 'r';
    const said = (it.iss || []).filter(i => i.s === 'E').map(i => i.c + ' ' + i.m).join(' ') + ' ' + (it.im || '');
    return /18320/.test(said) || /suppress/i.test(said) ? 'r' : 'g';
  };
  // the saved snapshots: loaded only when this page does not hold them yet
  if (typeof loadHealthCache === 'function' && typeof HEALTH !== 'undefined' && !(HEALTH.SP && HEALTH.SP.rows) && !(HEALTH.CPC && HEALTH.CPC.rows)) await loadHealthCache();
  const out = {};
  for (const brand of ['SP', 'CPC']) {
    if (typeof imListLoad === 'function' && !(typeof IML !== 'undefined' && IML[brand] && (IML[brand].items || []).length)) await imListLoad(brand);
    const items = ((typeof IML !== 'undefined' && IML[brand] && IML[brand].items) || []).filter(it => it.lvl !== 'parent');
    const r = { listings: items.length, supBefore: 0, supNow: 0, fRedBefore: 0, fRedNow: 0, errorOnlyNowGreen: [], noStockNowGreen: 0, notBuyableNow: 0,
      notCheckedNow: 0, nobuyFilterBefore: 0, nobuyFilterNow: 0 };
    items.forEach(it => {
      const shop = lrShopOf({ st: it.st || null, iss: it.iss, qty: lrQtyOf(brand, it.sku), brand, sku: it.sku });
      const st = String(it.st || '').toUpperCase();
      const was = oldF(it), now = lrShopF(shop);
      if (st.includes('BUYABLE') && !st.includes('DISCOVERABLE')) r.supBefore++;
      if (shop.k === 'sup') r.supNow++;
      if (was === 'r') r.fRedBefore++;
      if (now === 'r') r.fRedNow++;
      if (was === 'r' && now === 'g' && shop.k === 'ok') r.errorOnlyNowGreen.push(it.sku);
      if (was === 'r' && now !== 'r' && shop.k === 'off') r.noStockNowGreen++;
      if (shop.k === 'nobuy') r.notBuyableNow++;
      if (shop.k === 'unk') r.notCheckedNow++;
      if (!/BUYABLE/.test(it.st || '')) r.nobuyFilterBefore++;
      if (shop.k === 'nobuy') r.nobuyFilterNow++;
    });
    out[brand] = r;
    console.log(`${brand}: ${r.listings} listings · Suppressed ${r.supBefore} → ${r.supNow} · shoppers-affected (F red) ${r.fRedBefore} → ${r.fRedNow}`
      + ` · an ERROR alone, now F green: ${r.errorOnlyNowGreen.length}${r.errorOnlyNowGreen.length ? ' (' + r.errorOnlyNowGreen.slice(0, 15).join(', ') + (r.errorOnlyNowGreen.length > 15 ? ', …' : '') + ')' : ''}`
      + ` · not buyable with no stock, now F green: ${r.noStockNowGreen} · Not buyable (live) ${r.notBuyableNow} · Not checked ${r.notCheckedNow}`
      + ` · Image Manager "Not buyable" filter ${r.nobuyFilterBefore} → ${r.nobuyFilterNow}`);
  }
  return out;
}
if (typeof window !== 'undefined') window.lrShopReport = lrShopReport;
// One listing's stock from the Listing Health snapshot (null = not known) — for screens that hold no stock of their own.
const LR_QTY_IX = new WeakMap();
function lrQtyOf(brand, sku) {
  const rows = typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows;
  if (!rows) return null;
  let ix = LR_QTY_IX.get(rows);
  if (!ix) { ix = new Map(rows.map(row => [row.sku, row.qty == null ? null : Number(row.qty)])); LR_QTY_IX.set(rows, ix); }
  return ix.has(sku) ? ix.get(sku) : null;
}
/** The listing with the freshest content on it: the live read's title / bullets / description / search terms, brand, colour and
 *  rule words (lrFresh), else exactly the Health row. `contentAt` says when that content was read; `kw` is only ever live. */
/* THE TITLE AMAZON SHOWS (12 Nov 2026): every title rule judges the title shoppers see, freshest first — the catalogue's title from a
 * live read (?limg=get / ?lfix=get, `catTitle`), else the one in the latest full refresh (the Health snapshot's catalogue title). Our
 * submitted item_name (the live content read's `title`) is used only when neither exists; when both exist and differ, ours is not live
 * (title_not_live). RTC14 / B09M3JRNF8: the live read's 68-character item_name had been judged, while amazon.com shows ~150 characters. */
function lrFresh(row, ctx) {
  const live = lrLiveOf(row, ctx);
  const r = Object.assign({}, row);
  const shownLive = live && live.catTitle ? String(live.catTitle) : '';
  const shownSnap = row.content && row.content.title ? String(row.content.title) : '';
  const submitted = live && live.cAt && live.title ? String(live.title) : '';
  const shown = shownLive || shownSnap;
  r.shownTitle = shown || submitted || '';
  r.submittedTitle = submitted;
  r.titleSrc = shownLive ? 'live' : shownSnap ? 'snapshot' : submitted ? 'submitted' : 'report';
  const shownLen = shownLive ? shownLive.length : shownSnap ? (row.content.titleLen || shownSnap.length) : submitted ? (live.titleLen || submitted.length) : 0;
  if (live && live.cAt) {
    r.content = { title: r.shownTitle, titleLen: shownLen, bullets: live.bul || 0, descLen: live.desc || 0, images: row.content ? row.content.images : null };
    r.contentAt = live.cAt;
    r.contentSrc = 'live';
    // The search terms only when the content read brought them (a string, '' when empty on Amazon); a record without them is "not read".
    r.kw = typeof live.kw === 'string' ? live.kw : null;
    // Counted from the text itself whenever the text is whole (the live read keeps up to 300 characters of it); the stored count
    // is used only for a longer text — so a count stored the old way (with the spaces) can never make a listing look over.
    r.kwBytes = r.kw == null ? null : r.kw.length >= 300 && live.kwBytes != null ? live.kwBytes : lrKwBytes(r.kw);
  } else {
    r.contentAt = row.checked || 0;
    r.contentSrc = row.content ? 'health' : '';
    if (shownLive && row.content) r.content = Object.assign({}, row.content, { title: shownLive, titleLen: shownLive.length });
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
  images_small: 'pics', main_not_square: 'pics', images_duplicate: 'pics', main_photo_check: 'pics', title_not_live: 'content',
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
  const pcV = typeof PC !== 'undefined' ? PC.v : 0;          // the Picture check marks (picture-check.js): a new mark judges again
  const lmV = typeof lmVersion === 'function' ? lmVersion() + ':' + (lmOk('SP') ? 1 : 0) + (lmOk('CPC') ? 1 : 0)
    + (typeof lmAplusFresh === 'function' ? ':' + (lmAplusFresh('SP') ? 1 : 0) + (lmAplusFresh('CPC') ? 1 : 0) : '') : '';   // the ListingMatch cache (listing-match.js), and its daily A+ read
  const key = [rows.length, withContent, LR_CAT.SP ? 1 : 0, LR_CAT.CPC ? 1 : 0, AMZ.at, ws ? 1 : 0, pcV, lmV,
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
  H_CTX = { cfg, today: new Date(), parents, rows, amz: AMZ.map, amzAt: AMZ.snapAt, sp: HEALTH.SP, cpc: HEALTH.CPC, key, day: new Date().toDateString(),
    wsLive: ws ? ws.live : null, wsAplus: ws ? ws.aplus : null, lm: typeof lmLiveOf === 'function' && lmOk(), healthAt, parentAplus, imlAt, iml, imlSP: imlOf('SP'), imlCPC: imlOf('CPC'),
    pc: typeof PC !== 'undefined' ? PC.marks : null };
  return H_CTX;
}
// The Picture check mark on this listing's main picture ({ v: 'ok' | 'bad', by, name, at, note }), or null when nobody looked at
// this picture yet. Marks are kept per picture, so a new main picture has none.
function lrPcMark(row, ctx) {
  const pics = lrFactsOf(row, ctx).pics;
  const id = pics && pics.mainId;
  return id && ctx.pc && ctx.pc[row.brand] ? ctx.pc[row.brand][id] || null : null;
}
// What a person needs to look at (◐): the main picture — pure white background, no text or logo — while nobody has marked it. Never
// an error, never in a count; the check line says so and links to Image Manager. [] when the rule is off or there is no picture to see.
function lrLooks(row, ctx) {
  const rule = (ctx.cfg.issues || []).find(issue => issue.detector === 'main_photo_check');
  if (!rule || rule.on === false) return [];
  const pics = lrFactsOf(row, ctx).pics;
  if (!pics || !pics.main || !pics.mainId || lrPcMark(row, ctx)) return [];
  return [{ k: 'main', area: 'Images', what: 'is the background of the main picture pure white, with no text or logo on it?', picId: pics.mainId }];
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
    if (LR_WHAT_TEXT[hit.detector]) hit.what = LR_WHAT_TEXT[hit.detector](hit);   // a heading in its own words (else "name — detail")
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
  const looks = lrLooks(row, ctx);                      // ◐ what a person needs to look at — never a problem, counted nowhere
  return { score, bucket, grade: H_BUCKETS[bucket], critical, action, review, found, looks,
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
/** The heading a problem shows when "rule name — detail" would read badly. (hit) → text. */
const LR_WHAT_TEXT = {
  size_format: hit => (/ — the family writes /.test(hit.detail) ? 'Size written differently from the family: ' : 'Size not in our format: ') + hit.detail,
  title_template: hit => hit.detail,                // "Spelling: Rectange → Rectangle", "Shape doesn't match size: …", "Missing size"
};
/** One sentence per detector: what to do, with the listing's own values. (hit, row, ctx, params) → text. Plain words for a
 *  seller — never a detector id, a field code or a list of rules. */
const LR_FIX_TEXT = {
  inactive_with_stock: () => 'It has stock but is Inactive. Open Listing Errors to see why.',
  no_price: () => 'Add a price in Seller Central.',
  amazon_suppressed: () => 'Fix the issue in Listing Errors so it shows in Amazon search again.',
  amazon_error: () => 'Open Listing Errors and do what Amazon asks.',   // Amazon's message is the heading already: once, not twice
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
    const k = lrKwCheck(row.kw, params.max, row.kwBytes);
    return `Cut ${lrN(k.cut, 'byte')} from the search terms in Listing Errors (${k.bytes} of ${k.max}); over the limit Amazon may ignore all of them.`;
  },
  bullets_below: (hit, row, ctx, params) => `Add bullets until there are ${+params.n || 5} (it has ${row.content ? row.content.bullets || 0 : 0}).`,
  desc_below: (hit, row, ctx, params) => `Write a description of ${+params.n || 200}+ characters (it has ${row.content && row.content.descLen ? row.content.descLen : 'none'}).`,
  title_length: (hit, row, ctx, params) => `Make the title ${+params.min || 0} to ${+params.max || 999} characters (now ${row.content ? row.content.titleLen : hTitleText(row).length}).`,
  title_not_live: () => 'Check Listing Errors for why Amazon has not accepted it; resubmit if needed.',
  images_small: (hit, row, ctx, params) => `Upload a bigger version of ${String(hit.detail).replace(/^.*?:\s*/, '').replace(/\s*\(\d+ px\)/g, '')} in Image Manager — at least ${+params.px || 1000} px on the long side, so shoppers can zoom.`,
  main_not_square: () => 'Use a square main picture in Image Manager (for example 2000 × 2000 px).',
  images_duplicate: hit => `Put a different picture in ${String(hit.detail).split(' ')[0]} in Image Manager — it repeats another slot.`,
  main_photo_check: () => 'Replace the main picture in Image Manager: pure white background, no text or logo on it.',
  size_format: (hit, row, ctx, params) => {
    const title = hTitleText(row);
    const bad = hTitleSizes(title).find(size => LR_UNIT_RE.test(size.text) && (!lrSizeOurs(size.text, ctx.cfg, title, params.example) || lrSizeOffFamily(size, row, ctx, title)));
    return bad ? `Write the size as "${lrSizeWant(bad, row, ctx, title)}" (the family's own way). It says "${bad.text}".` : 'Write the size like "54x54 Inch".';
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
    const fx = lrTitleFix(row, ctx);
    return fx.after && fx.after !== fx.before ? `Change only that — the title keeps its own words and order: "${fx.after}".` : 'Correct it in the title; every other word stays as it is.';
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
const LR_FIX_TAG = { amazon_suppressed: 'Amazon', amazon_error: 'Amazon', no_main_image: 'Amazon', inactive_with_stock: 'Amazon', no_price: 'Amazon', keyword_bytes: 'Amazon limit',
  images_small: 'Amazon', main_photo_check: 'Amazon', title_not_live: 'Amazon' };
const LR_TAG_TIP = { Amazon: 'Amazon itself reports this.', 'Amazon limit': "One of Amazon's own limits.", 'Company rule': 'Your own rule. Amazon does not check this.' };
function lrFixTag(hit, row) {
  if (LR_FIX_TAG[hit.detector]) return LR_FIX_TAG[hit.detector];
  const params = hit.params || {};
  if (hit.detector === 'title_length' && +params.max >= 75 && row.content && row.content.titleLen > +params.max) return 'Amazon limit';
  return 'Company rule';
}
// The Image Manager for pictures, nothing for A+ (no screen here), Listing Errors for everything else.
const LR_FIX_IMG = ['no_main_image', 'images_below', 'images_between', 'images_small', 'main_not_square', 'images_duplicate', 'main_photo_check'];
const lrFixKind = detector => (LR_FIX_IMG.includes(detector) ? 'img' : detector === 'aplus_missing' ? '' : 'lerr');

// A title problem's Fix (title-fix.js, 18 Nov 2026): the new-title preview for that one listing — every title problem fixed in one new
// title; Listing Errors when there is nothing to fix there. The button says which rule it is for; its kind stays 'lerr'.
const lrFixIsTitle = (kind, detector) => kind === 'lerr' && typeof ttIsDet === 'function' && ttIsDet(detector);
const lrFixDet = (kind, detector) => (lrFixIsTitle(kind, detector) ? ` data-lr-det="${detector}"` : '');
const lrFixTip = (kind, detector) => (kind === 'img' ? 'Opens the Image Manager' : lrFixIsTitle(kind, detector) ? 'Shows the new title for this listing first (Fix all titles)' : 'Opens Listing Errors');
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
    + (where.attrs && where.attrs.length ? ` data-lr-attrs="${esc(where.attrs.join(','))}"` : '') + lrFixDet(kind, hit.detector)
    + ` title="${lrFixTip(kind, hit.detector)}">Fix</button>` : '';
  // Price, stock and status come from the listings report, which only "Refresh both brands" renews — so no Check now for those.
  const fromReport = hit.src === 'report';
  const check = stale && where && !fromReport ? `<button type="button" class="ghost lr-checkbtn" data-lr-check="${esc(where.brand)}|${esc(where.sku)}"`
    + ` title="Reads this listing from Amazon now">Check now</button>` : '';
  const age = hit.at > 0 ? Math.round((Date.now() - hit.at) / LR_DAY) : 0;
  const ageWords = age ? age + ' days old' : 'with no date';
  const staleWhy = stale ? (fromReport ? ` (from the listings report ${ageWords} — press “Refresh both brands”)` : ` (from data ${ageWords})`) : '';
  return `<div class="lr-prob${stale ? ' is-stale' : ''}"><span class="sev ${stale ? 'sev-s' : level.cls}" title="${esc(stale ? level.stale : level.word)}"></span><div class="lr-prob-body">`
    + `<div class="lr-prob-what"><span class="lr-lvl ${stale ? 'is-s' : hit.sev === 'critical' ? 'is-c' : 'is-a'}">${esc(stale ? level.stale : '✕ ' + level.word)}</span>${esc(hit.what || (hit.name + ' — ' + hit.detail))}${esc(staleWhy)}</div>`
    + `<div class="lr-prob-how">${esc(hit.fix || '')}</div>${note ? `<div class="lr-prob-src">${esc(note)}</div>` : ''}</div>`
    + `<span class="lr-tag${tag === 'Company rule' ? ' is-own' : ''}" title="${esc(LR_TAG_TIP[tag] || '')}">${esc(tag)}</span>${check}${fix}</div>`;
}
/* ---- a problem as one ROW (the Listing Health look, 6 Nov 2026), like the Ad Console's recommendation rows: a dot through the
 *      level's colour · the level word and the name, a grey subtitle · how to fix · a tag · Fix. The Workspace side panel and the
 *      children dialog draw with it; lrProblemHtml above stays the block every other screen uses. ---- */
// `rec`: { sev, stale, name, sub, fix, tag, kind, detector, attrs, fill, bare } — `fill` marks a "Good to fill" gap (not an error: no level
// word, a blue dot); `bare` leaves the level word out where a group heading already says it (the child sidebar), except "Error? Check
// again", which says more than its heading. `where`: { brand, sku } for the Fix button, or null for none.
function lrRecHtml(rec, where) {
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const stale = rec.sev === 'critical' && !!rec.stale;
  const cls = rec.fill ? 'is-fill' : rec.sev === 'critical' ? (stale ? 'is-chk' : 'is-err') : 'is-att';
  const level = lrLevel(rec.sev);
  const word = rec.fill ? 'Good to fill' : stale ? level.stale : '✕ ' + level.word;   // ✕ Fix: the problem's own answer, icon + word
  const tag = rec.fill ? 'Good to fill' : (rec.tag || 'Company rule');
  const kind = rec.kind == null ? lrFixKind(rec.detector) : rec.kind;
  const fix = where && kind ? `<button type="button" class="ghost lr-fixbtn" data-lr-fix="${esc(kind)}|${esc(where.brand)}|${esc(where.sku)}"`
    + (rec.attrs && rec.attrs.length ? ` data-lr-attrs="${esc(rec.attrs.join(','))}"` : '') + lrFixDet(kind, rec.detector)
    + ` title="${lrFixTip(kind, rec.detector)}">Fix</button>` : '';
  return `<div class="ls-rec ${cls}"><span class="ls-dot" aria-hidden="true"></span><div class="ls-rec-t">`
    + `<b>${rec.bare && !stale ? '' : `<span class="lr-lvl ${rec.fill ? 'is-f' : stale ? 'is-s' : rec.sev === 'critical' ? 'is-c' : 'is-a'}">${esc(word)}</span>`}${esc(rec.name)}${rec.bfHtml || ''}</b>`
    + (rec.sub ? `<small title="${esc(rec.sub)}">${esc(rec.sub)}</small>` : '') + '</div>'
    + `<div class="ls-rec-a"><span class="lr-tag${tag === 'Company rule' ? ' is-own' : ''}${rec.fill ? ' is-fill' : ''}" title="${esc(LR_TAG_TIP[tag] || (rec.fill ? 'Not an error: a gap worth filling.' : ''))}">${esc(tag)}</span>${fix}</div>`
    + (rec.fix ? `<div class="ls-rec-how">${esc(rec.fix)}</div>` : '') + '</div>';
}
/* ---- the FOUR ANSWERS a check line gives (Rule Engine, 12 Nov 2026), on every Listing Health screen: ✓ Pass · ✕ Fix (the problem
 *      rows above, with their level word) · ○ Not checked (with the plain reason — never an error) · ◐ A person needs to look (with a
 *      link to Image Manager — never an error, counted nowhere). Existing classes only: li-ws-ok, li-ws-na, ui-error, ls-more. ---- */
// One check's answer: 'pass' | 'fix' | 'unk' | 'look'. `c`: a check record { pass: true | false | null, na, look }.
const lrAnswer = c => (c.pass === false ? 'fix' : c.pass === true ? (c.look ? 'look' : 'pass') : 'unk');
// The answer's icon and word, for a cell's tooltip or a line.
const LR_ANSWER = { pass: { i: '✓', w: 'Pass', cls: 'li-ws-ok' }, fix: { i: '✕', w: 'Fix', cls: 'ui-error' }, unk: { i: '○', w: 'Not checked', cls: 'li-ws-na' },
  look: { i: '◐', w: 'A person needs to look', cls: 'li-ws-na' } };
// One check as a line: icon, the check's name, the answer in words and why; ◐ carries "Open in Image Manager" (picture-check.js opens
// that listing's main picture there). `where`: { brand, sku }; `src`: the grey "source · when" text, or ''.
function lrAnswerHtml(name, c, where, src) {
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const a = lrAnswer(c);
  const icon = `<span class="${LR_ANSWER[a].cls}" aria-hidden="true">${LR_ANSWER[a].i}</span>`;
  const tail = src ? ` · ${esc(src)}` : '';
  if (a === 'look') return `<div>${icon} <b>${esc(name)}</b> — ${LR_ANSWER.look.w}: ${esc(c.look)} <button type="button" class="ls-more" data-pc-open="${esc(where.brand)}|${esc(where.sku)}">Open in Image Manager</button></div>`;
  if (a === 'pass') return `<div>${icon} <b>${esc(name)}</b> — Pass${c.found ? ' · ' + esc(c.found) : ''}${tail}</div>`;
  if (a === 'fix') return `<div>${icon} <b>${esc(name)}</b> — Fix: ${esc(c.miss || c.found || '')}</div>`;
  const why = c.na ? 'doesn’t apply to this listing' : c.bang ? 'could not read it from Amazon (' + c.bang + ')' : (c.found || 'not known yet');
  return `<div>${icon} <b>${esc(name)}</b> — Not checked: ${esc(why)} — not an error</div>`;
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
  // a title problem: the new title for this one listing first (title-fix.js), when there is one to make
  if (btn.dataset.lrDet && typeof ttStartOne === 'function' && ttStartOne(btn.dataset.lrFix.slice(first + 1, last), btn.dataset.lrFix.slice(last + 1))) return;
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
      /* NO SEASON RULE (14 Nov 2026): season words are the Season planner's alone (Listing Optimiser), never a Listing Health /
       * Workspace problem. The retired out-of-season rule is dropped from a saved list, so it can neither run nor be saved back. */
      const saved = (data.issues || LR_DEFAULT.issues).filter(issue => issue.detector !== 'seasonal_keyword');
      const have = new Set(saved.map(issue => issue.id));
      const added = LR_DEFAULT.issues.filter(issue => !have.has(issue.id));
      LR = { issues: added.concat(saved), templates: data.templates || LR_DEFAULT.templates, events: data.events || LR_DEFAULT.events,
        allow: lrAllow({ allow: data.allow }) };        // what people may write: the saved values over the defaults
      LR_SAVED_AT = data.at && data.at.toDate ? data.at.toDate() : null;
      LR_HISTORY = Array.isArray(data.history) ? data.history : [];
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

