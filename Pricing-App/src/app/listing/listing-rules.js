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
const H_BUCKETS = { critical: 'Critical', action: 'Attention', review: 'Review', monitor: 'Monitor', healthy: 'Healthy', unchecked: 'Not checked' };
const LR_SEV = { critical: { label: 'Critical', cls: 'sev-c', rank: 3 }, action: { label: 'Attention', cls: 'sev-a', rank: 2 }, review: { label: 'Review', cls: 'sev-r', rank: 1 } };
const LR_AREAS = ['Title', 'Size', 'Variation', 'Images', 'Content', 'Inventory', 'Price'];

/** What each detector means, and the settings it takes. */
const LR_DETECTORS = {
  manual: { label: 'Not detectable yet — needs data Amazon has not been asked for', params: [] },
  inactive_with_stock: { label: 'Stock at Amazon, but the listing is Inactive', params: [] },
  no_price: { label: 'Price is 0', params: [] },
  no_main_image: { label: 'No image at all', params: [] },
  variation_value_missing: { label: 'No size in the title while its siblings have one', params: [] },
  aplus_missing: { label: 'A+ checked, and missing', params: [] },
  images_below: { label: 'Fewer images than N', params: ['n'] },
  images_between: { label: 'Images from MIN to MAX', params: ['min', 'max'] },
  bullets_below: { label: 'Fewer bullets than N', params: ['n'] },
  desc_below: { label: 'Description shorter than N characters', params: ['n'] },
  title_length: { label: 'Title length outside MIN–MAX characters', params: ['min', 'max'] },
  size_format: { label: 'A size in the title not written like the approved example', params: ['example'] },
  dimension_order: { label: 'Larger dimension written first', params: [] },
  variation_naming: { label: 'Siblings write their size differently', params: [] },
  title_template: { label: 'Title missing parts of its template, or in another order', params: [] },
  title_keyword: { label: 'Title missing a required word (comma-separated: any one is enough)', params: ['words'] },
  title_contains: { label: 'Title contains a word (comma-separated)', params: ['words'] },
  seasonal_keyword: { label: 'Title names an occasion that is out of season (see the calendar)', params: [] },
};

const LR_DEFAULT = {
  issues: [
    /* Critical — the rows Ravi's screenshot showed, and a listing with no image at all. */
    { id: 'inv_mismatch', name: 'Inventory/content mismatch', sev: 'critical', area: 'Inventory', detector: 'inactive_with_stock', desc: 'Inventory has arrived and listing is fundamentally incomplete/unbuyable' },
    { id: 'price_error', name: 'Major price error', sev: 'critical', area: 'Price', detector: 'no_price', desc: 'Price substantially outside approved/master range — only "no price" can be checked today' },
    { id: 'var_value', name: 'Missing required variation value', sev: 'critical', area: 'Variation', detector: 'variation_value_missing', desc: 'Makes child unclear/wrong within parent' },
    { id: 'main_image', name: 'Main image missing', sev: 'critical', area: 'Images', detector: 'no_main_image', desc: 'No image at all — the listing cannot be bought' },
    /* Needs attention */
    { id: 'aplus_missing', name: 'A+ missing', sev: 'action', area: 'Content', detector: 'aplus_missing', desc: "Product is supposed to have A+ but doesn't" },
    { id: 'img_secondary', name: 'Secondary images missing', sev: 'action', area: 'Images', detector: 'images_below', params: { n: 6 }, desc: 'Below CPC required image count' },
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
    { id: 'title_opt', name: 'Title slightly under-optimized', sev: 'review', area: 'Title', detector: 'title_length', params: { min: 80, max: 200 }, desc: 'Correct and compliant but could contain better terminology' },
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
};

let LR = null;             // the rules in force: saved config, or the defaults
let LR_SAVED_AT = null;
let LR_CAT = { SP: null, CPC: null };

/* ---- the calendar ---- */
function lrEaster(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
/** The date of an occasion in a given year (UTC midnight), or null when the rule cannot be read. */
function lrEventDate(ev, y, events) {
  const w = ev.when || {};
  if (w.type === 'fixed') return new Date(Date.UTC(y, w.m - 1, w.d));
  if (w.type === 'easter') { const d = lrEaster(y); d.setUTCDate(d.getUTCDate() + (w.off || 0)); return d; }
  if (w.type === 'nth') {
    if (w.n > 0) {
      const first = new Date(Date.UTC(y, w.m - 1, 1));
      const add = (w.wd - first.getUTCDay() + 7) % 7 + (w.n - 1) * 7;
      return new Date(Date.UTC(y, w.m - 1, 1 + add));
    }
    const last = new Date(Date.UTC(y, w.m, 0));
    return new Date(Date.UTC(y, w.m - 1, last.getUTCDate() - ((last.getUTCDay() - w.wd + 7) % 7)));
  }
  if (w.type === 'after') {
    const base = (events || []).find(e => e.id === w.event);
    const d = base && base.when && base.when.type !== 'after' ? lrEventDate(base, y, events) : null;
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + (w.days || 0));
    return d;
  }
  return null;
}
const LR_DAY = 86400000;
/** Where today stands against an occasion: { inSeason, next (the date to talk about), from, to }. */
function lrSeason(ev, today, events) {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const y = today.getFullYear();
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const d = lrEventDate(ev, yy, events); if (!d) continue;
    const from = d.getTime() - (ev.lead || 0) * LR_DAY, to = d.getTime() + (ev.lag || 0) * LR_DAY;
    if (t >= from && t <= to) return { inSeason: true, next: d, from: new Date(from), to: new Date(to) };
    if (to >= t && (!best || d < best.next)) best = { inSeason: false, next: d, from: new Date(from), to: new Date(to) };
  }
  return best || { inSeason: false, next: null, from: null, to: null };
}
const lrWords = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const lrHas = (text, word) => new RegExp('(^|[^a-z0-9])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?=$|[^a-z0-9])', 'i').test(text);
const lrFmtDate = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';

/* ---- sizes ---- */
/** The approved way to write a size, taken from the example the rule carries ("14 x 36 Inch"). */
function lrSizeOk(text, example) {
  const shape = String(example || '14 x 36 Inch').replace(/\d+(?:\.\d+)?/g, 'N');
  return String(text).replace(/\d+(?:\.\d+)?/g, 'N') === shape || String(text).replace(/\d+(?:\.\d+)?/g, 'N') === shape.replace('N x N', 'N x N x N');
}
/** Every W x H (or W x H x D) written in a title, exactly as written, with the unit that follows it. */
function hTitleSizes(t) {
  const out = [];
  const u = '(?:"|”|″|in\\.?(?![a-z])|inch(?:es)?(?![a-z])|cm(?![a-z]))';
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${u}?\\s*[x×X*]\\s*(\\d+(?:\\.\\d+)?)(?:\\s*${u}?\\s*[x×X*]\\s*(\\d+(?:\\.\\d+)?))?(\\s*${u})?`, 'gi');
  let m;
  while ((m = re.exec(String(t || '')))) out.push({ text: m[0].trim(), a: +m[1], b: +m[2], c: m[3] ? +m[3] : null });
  return out;
}
/** A size's written shape — "60x90" and "60 x 90 Inch" are different shapes of the same size. */
const lrSizeShape = s => String(s).replace(/\d+(?:\.\d+)?/g, 'N').replace(/\s+/g, ' ').toLowerCase();
/**
 * The title text to judge — the catalog's full title first, else the listings report's. A title cached
 * before 15 Sept was cut at 60 characters; one of exactly 60 that is not marked full is not judged.
 */
const hTitleText = r => (r.content && r.content.title) || ((r.titleFull || String(r.title || '').length !== 60) ? (r.title || '') : '');

/* ---- the template ---- */
function lrTemplateFor(r, cfg) {
  const cat = lrCatOf(r);
  if (!cat) return null;
  return (cfg.templates || []).find(t => (t.brand === 'ALL' || t.brand === r.brand)
    && (!t.match || String(cat.subcat || '').toLowerCase().includes(String(t.match).toLowerCase()))) || null;
}
const lrCatOf = r => (LR_CAT[r.brand] && LR_CAT[r.brand][r.sku]) || null;
const lrShape = sub => (String(sub || '').match(/\b(Rectangle|Rectangular|Round|Square|Oval)\b/i) || [])[1] || '';
/** "60x90" from the catalog, written the approved way. */
const lrSizeText = (size, example) => {
  const nums = String(size || '').match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2 || nums.length > 3) return '';
  return nums.join(' x ') + ' ' + (String(example || '14 x 36 Inch').replace(/^[\d.\sx]+/i, '') || 'Inch');
};
/** Occasions in season today, in the order they fall. */
function lrOccasionsNow(cfg, today) {
  return (cfg.events || []).map(e => ({ e, s: lrSeason(e, today, cfg.events) })).filter(x => x.s.inSeason)
    .sort((a, b) => a.s.next - b.s.next).map(x => x.e.name.replace(/'s$/, "'s"));
}
/** The parts a template asks for, filled from what this SKU is. */
function lrParts(r, t, cfg, today) {
  const cat = lrCatOf(r) || {};
  const example = ((cfg.issues || []).find(i => i.detector === 'size_format') || {}).params;
  return {
    brand: BRAND_NAME[r.brand] || r.brand, product: t.product || '', shape: lrShape(cat.subcat),
    material: t.material || '', size: lrSizeText(cat.size, example && example.example), pattern: t.pattern || '',
    uses: t.uses || '', occasions: lrOccasionsNow(cfg, today).join(' '), color: cat.color || '',
  };
}
/** The title the template would write for this listing. */
function lrSuggest(r, cfg, today) {
  cfg = cfg || LR || LR_DEFAULT; today = today || new Date();
  const t = lrTemplateFor(r, cfg); if (!t) return '';
  const p = lrParts(r, t, cfg, today);
  const fill = drop => String(t.template || '').replace(/\{(\w+)\}/g, (_, k) => (drop.includes(k) ? '' : (p[k] || '')))
    .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
  let out = fill([]);
  // Amazon's hard limit is 200 characters: occasions go first, then the uses phrase.
  if (out.length > 200) out = fill(['occasions']);
  if (out.length > 200) out = fill(['occasions', 'uses']);
  return out.slice(0, 200);
}

/* ---- the detectors: each answers '' (fine) or what it found ---- */
const LR_DET = {
  inactive_with_stock: r => (/inactive/i.test(r.status || '') && r.qty > 0) ? `${r.qty} in stock but the listing is Inactive` : '',
  no_price: r => r.price === 0 ? 'no price' : '',
  no_main_image: r => (r.content && !r.content.images) ? 'no image' : '',
  aplus_missing: r => r.aplus === false ? 'no A+ published' : '',
  images_below: (r, c, p) => (r.content && r.content.images && r.content.images < (+p.n || 6)) ? `${r.content.images} of ${+p.n || 6}` : '',
  images_between: (r, c, p) => (r.content && r.content.images >= (+p.min || 0) && r.content.images <= (+p.max || 0)) ? `${r.content.images} images` : '',
  bullets_below: (r, c, p) => (r.content && r.content.bullets < (+p.n || 5)) ? `${r.content.bullets} of ${+p.n || 5}` : '',
  desc_below: (r, c, p) => (r.content && r.content.descLen < (+p.n || 200)) ? (r.content.descLen ? `${r.content.descLen} characters` : 'none') : '',
  title_length: (r, c, p) => (r.content && (r.content.titleLen < (+p.min || 0) || r.content.titleLen > (+p.max || 999))) ? `${r.content.titleLen} characters` : '',
  size_format: (r, c, p) => { const s = hTitleSizes(hTitleText(r)).find(x => !lrSizeOk(x.text, p.example)); return s ? `"${s.text}", approved is "${p.example || '14 x 36 Inch'}"` : ''; },
  dimension_order: r => { const s = hTitleSizes(hTitleText(r)).find(x => x.c === null && x.a > x.b); return s ? `${s.a} x ${s.b} should be ${s.b} x ${s.a}` : ''; },
  variation_value_missing: (r, c) => {
    const t = hTitleText(r); if (!t || !r.parent) return '';
    const g = c.parents.get(r.parent + '|' + r.brand);
    return g && g.sized > 0 && !hTitleSizes(t).length ? `no size in the title; ${g.sized} sibling(s) name theirs` : '';
  },
  variation_naming: (r, c) => {
    const s = hTitleSizes(hTitleText(r))[0]; if (!s || !r.parent) return '';
    const g = c.parents.get(r.parent + '|' + r.brand); if (!g || g.shapes.size < 2) return '';
    const mine = lrSizeShape(s.text);
    return mine !== g.common ? `"${s.text}" while most siblings write "${g.commonExample}"` : '';
  },
  title_keyword: (r, c, p) => { const t = hTitleText(r); const w = lrWords(p.words); return (t && w.length && !w.some(x => lrHas(t, x))) ? `no "${w.join('" or "')}"` : ''; },
  title_contains: (r, c, p) => { const t = hTitleText(r); const hit = t ? lrWords(p.words).find(x => lrHas(t, x)) : null; return hit ? `says "${hit}"` : ''; },
  title_template: (r, c) => {
    const title = hTitleText(r); const t = lrTemplateFor(r, c.cfg); if (!title || !t) return '';
    const low = title.toLowerCase().replace(/table\s+cloth/g, 'tablecloth');
    const parts = lrParts(r, t, c.cfg, c.today);
    const need = lrWords(t.required || 'brand,product,size,color');
    const where = k => {
      const v = parts[k]; if (!v) return -2;                          // nothing to look for: not judged
      if (k === 'size') { const s = hTitleSizes(title)[0]; return s ? title.indexOf(s.text) : -1; }   // how it is written is size_format's job
      if (k === 'material') return low.search(/cotton|linen|polyester|jute|velvet/);
      if (k === 'product') {
        const words = String(v).toLowerCase().replace(/table\s+cloth/g, 'tablecloth').split(/\s+/).filter(w => w.length > 3).map(w => w.replace(/s$/, ''));
        const at = words.map(w => low.indexOf(w)).filter(i => i >= 0);
        return at.length ? Math.min(...at) : -1;
      }
      if (k === 'color') {
        /* A colour is found when any real word of it is in the title — the catalog says Neutral Ivory Grey, the title says Grey. */
        const at = String(v).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2).map(w => low.search(new RegExp('\\b' + w + '\\b'))).filter(i => i >= 0);
        return at.length ? Math.min(...at) : -1;
      }
      return low.indexOf(String(v).toLowerCase());
    };
    const order = String(t.template).match(/\{(\w+)\}/g).map(x => x.slice(1, -1)).filter(k => need.includes(k));
    const pos = order.map(k => [k, where(k)]).filter(([, i]) => i !== -2);
    const missing = pos.filter(([, i]) => i < 0).map(([k]) => k);
    const found = pos.filter(([, i]) => i >= 0).map(([, i]) => i);
    const outOfOrder = found.some((v, i) => i && v < found[i - 1]);
    if (!missing.length && !outOfOrder) return '';
    return [missing.length ? 'missing ' + missing.join(', ') : '', outOfOrder ? 'parts in a different order' : ''].filter(Boolean).join(' · ');
  },
  seasonal_keyword: (r, c) => {
    const title = hTitleText(r); if (!title) return '';
    const cat = lrCatOf(r) || {};
    for (const ev of (c.cfg.events || [])) {
      const w = lrWords(ev.words).find(x => lrHas(title, x)); if (!w) continue;
      if (lrWords(ev.except).some(x => lrHas(String(cat.subcat || '') + ' ' + String(cat.color || ''), x))) continue;
      const s = lrSeason(ev, c.today, c.cfg.events);
      if (s.inSeason) continue;
      return `"${w}" — ${ev.name} is ${s.next ? lrFmtDate(s.next) : 'not dated'}; it belongs in the title from ${s.from ? lrFmtDate(s.from) : '—'}`;
    }
    return '';
  },
};

/** What every listing is judged against at once: the rules, today, and what each parent's children look like. */
let H_CTX = null;
function hCtx(rowsAll) {
  const cfg = LR || LR_DEFAULT;
  const rows = rowsAll || ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || []).map(r => (r.brand ? r : Object.assign({ brand: b }, r))));
  const withContent = rows.reduce((n, r) => n + (r.content ? 1 : 0), 0);
  const key = [rows.length, withContent, LR_CAT.SP ? 1 : 0, LR_CAT.CPC ? 1 : 0].join('|');
  if (H_CTX && H_CTX.cfg === cfg && H_CTX.sp === HEALTH.SP && H_CTX.cpc === HEALTH.CPC && H_CTX.key === key
      && H_CTX.day === new Date().toDateString()) return H_CTX;
  const parents = new Map();
  rows.forEach(r => {
    if (!r.parent) return;
    const k = r.parent + '|' + r.brand;
    const g = parents.get(k) || { sized: 0, shapes: new Map(), examples: new Map() };
    const s = hTitleSizes(hTitleText(r))[0];
    if (s) { g.sized++; const sh = lrSizeShape(s.text); g.shapes.set(sh, (g.shapes.get(sh) || 0) + 1); if (!g.examples.has(sh)) g.examples.set(sh, s.text); }
    parents.set(k, g);
  });
  parents.forEach(g => {
    const top = [...g.shapes.entries()].sort((a, b) => b[1] - a[1])[0];
    g.common = top ? top[0] : ''; g.commonExample = top ? g.examples.get(top[0]) : '';
  });
  H_CTX = { cfg, today: new Date(), parents, sp: HEALTH.SP, cpc: HEALTH.CPC, key, day: new Date().toDateString() };
  return H_CTX;
}

function healthOf(r, ctx) {
  ctx = ctx || hCtx();
  const found = [];
  (ctx.cfg.issues || []).forEach(rule => {
    if (rule.on === false || !LR_SEV[rule.sev]) return;
    const det = LR_DET[rule.detector]; if (!det) return;
    let d = '';
    try { d = det(r, ctx, rule.params || {}) || ''; } catch (e) { d = ''; }
    if (d) found.push({ id: rule.id, name: rule.name, sev: rule.sev, area: rule.area, detail: d, detector: rule.detector });
  });
  /* NOTHING IN STOCK IS NEVER CRITICAL (Ravi, 15 Sept). A listing with 0 units is not losing sales today,
   * so what would be critical waits one step down, as Attention, and says why. Unknown stock (null) is
   * not zero and changes nothing. */
  /* EXCEPT NO IMAGE AT ALL (Ravi, 5 Oct 2026: "OOS me bhi no image ko laal dikhao") — that stays Critical with no stock too. */
  if (r.qty === 0) found.forEach(f => { if (f.sev === 'critical' && f.detector !== 'no_main_image') { f.sev = 'action'; f.detail += ' (0 in stock, so not critical)'; } });
  const list = s => found.filter(f => f.sev === s).map(f => f.name + ' — ' + f.detail);
  const critical = list('critical'), action = list('action'), review = list('review');
  const notSelling = r.qty === 0 || /inactive/i.test(r.status || '');
  const bucket = critical.length ? 'critical' : action.length ? 'action' : review.length ? 'review'
    : (notSelling ? 'monitor' : (r.content ? 'healthy' : 'unchecked'));
  const score = Math.max(0, Math.min(100, 100 - critical.length * 40 - action.length * 10 - review.length * 3));
  return { score, bucket, grade: H_BUCKETS[bucket], critical, action, review, found, blocking: critical, content: action.concat(review) };
}

/** The worst severity found in one area of a listing: 'critical' | 'action' | 'review' | '' (none). */
const hAreaSev = (h, area) => h.found.filter(f => f.area === area).sort((a, b) => LR_SEV[b.sev].rank - LR_SEV[a.sev].rank)[0] || null;

async function lrLoad() {
  try {
    const s = await getDoc(doc(db, 'listingrules', 'config'));
    if (s.exists()) {
      const d = s.data();
      LR = { issues: d.issues || LR_DEFAULT.issues, templates: d.templates || LR_DEFAULT.templates, events: d.events || LR_DEFAULT.events };
      LR_SAVED_AT = d.at && d.at.toDate ? d.at.toDate() : null;
    } else LR = JSON.parse(JSON.stringify(LR_DEFAULT));
  } catch (e) { LR = LR || JSON.parse(JSON.stringify(LR_DEFAULT)); }
  H_CTX = null;
}

/** The brand catalog (colour, size, sub-category per SKU), kept a day in Firestore — reading the workbook is slow. */
async function lrLoadCatalog(force) {
  for (const b of ['SP', 'CPC']) {
    if (LR_CAT[b] && !force) continue;
    try {
      const s = await getDoc(doc(db, 'listingrules', 'catalog_' + b));
      const d = s.exists() ? s.data() : null;
      const fresh = d && d.at && d.at.toDate && Date.now() - d.at.toDate().getTime() < 24 * 3600 * 1000;
      if (d && d.map && (fresh || !force)) { LR_CAT[b] = d.map; if (fresh) continue; }
      const got = await baCall({ sales: 'cat', brand: b });
      if (got && got.map) {
        const map = {};
        Object.entries(got.map).forEach(([sku, v]) => { map[sku] = { color: v.color || '', size: v.size || '', subcat: v.subcat || '' }; });
        LR_CAT[b] = map;
        try { await setDoc(doc(db, 'listingrules', 'catalog_' + b), { map, at: serverTimestamp() }); } catch (e) { /* cached next time */ }
      }
    } catch (e) { /* no catalog: templates and occasions are simply not judged */ }
  }
  H_CTX = null;
}

