/* ================= LISTING · FIX ALL TITLES: one new title per child that fixes every title problem at once =================
 * Screens: Listing Health → Workspace (a parent's title rows in the Fix all block, fix-all.js: "Fix all N children"; each child's own
 *          Fix), Listing Errors (a card above its list: per family, and Select all), and the Fix button of a title problem anywhere
 *          (Listing Health's Why column, the Workspace's child view: that one child). Same look and flow as Fix all search terms (kw-fix.js).
 * THE PROBLEMS, all fixed together in ONE new title per child (TT_DETS): Title doesn't follow template (title_template) · Size formatting
 *   inconsistent (size_format) · Dimension order inconsistent (dimension_order) · Title slightly under-optimized and Title too long
 *   (title_length) · Important title keyword missing (title_keyword).
 * HOW THE NEW TITLE IS MADE (ttBuild) — no AI, no invented fact:
 *   - the Listing Rules title template of the product, in its order (brand, product, shape, material, size, print, uses, colour…);
 *   - each part from the child's OWN Amazon facts (the ListingMatch cache, a live read, or a read made for this fix): colour, size, material,
 *     shape — the Listing Rules catalogue only where Amazon has none; brand (Amazon's, else the account's), product word and uses from
 *     Listing Rules. Material: when Amazon's material is the template's ("Cotton" in "100% Cotton") the template's words, else Amazon's own;
 *   - the size written the rule's way ("60 x 90 Inch", the size_format example), the smaller number first ("70 x 108");
 *   - the print ("Block Print") only when the rule asks for it (a sibling's title or the child's own bullets say it — lrBlockPrintProof),
 *     the child's title already says it, or Amazon's pattern attribute does — never on an embroidered piece;
 *   - never a season word (they are the Season planner's); within the title_length rule (75 at most, its minimum): the optional parts left
 *     out in the rule's order — uses, then the template's print written as the rule's own words ("Hand Block Print" → "Block Print"),
 *     then the print (unless the rule asks for it), then any other part the template does not require — never brand, product, size or
 *     colour (nor a part the template requires: then the child is held back, "even with only the parts the template requires…");
 *   - a fact Amazon does not hold is left out and the child is marked "check: material missing"; two sources that disagree (Amazon's colour
 *     vs the catalogue's, the size in the title vs Amazon's) hold the child back — nothing is guessed;
 *   - EVERY Listing Rules rule is run again on the new title (ttJudge — the siblings' new titles counted, so "siblings write their size
 *     differently" is judged on the family as it will be): no title rule may still fail and no other rule may start to fail; plus the send
 *     checks that matter (size numbers kept, colour, brand first, no banned symbol, no word three times, ≤ 200). Else held back with why.
 * PREVIEW (ttPreview, the existing #spModal): per child — SKU, colour · size, current → new title with the changes marked, characters,
 *   which problems it fixes, where each part came from; a tick per child, Select all, search, "Edit new title" (judged again live).
 *   Held-back children are listed with the reason (and "Edit by hand" in Listing Errors). Children whose Amazon facts or product type
 *   Sellora does not hold are read first (?lfix=get, one at a time, nothing changes on Amazon).
 * SEND: THE ONE SEND PATH (listing-send-check.js sqSendWithCheck: Amazon's check → Approve & send, one by one with progress → read again →
 *   "N accepted · M rejected (reason)"); Listing History screen "Titles · Fix all"; fix-all.js's change log (History, Put back); a sent
 *   child waits for Amazon to show its new title (FA_WAIT_DAYS), out of the rows. The test site sends nothing. No backend change.
 * Console: ttReport() — per brand, the children and families it would fix, held back by reason, and three examples before → after.
 * Main functions: ttBuild, ttPlans, ttRows, ttPlanOfKid / ttStartFamily (Workspace), ttLeCardHtml / ttLeStart (Listing Errors),
 *   ttStartOne (a Fix button), ttPreview, ttGo, ttReport. Every name starts with tt / TT.
 * Pricing-App/tests/title-fix-test.js runs it with the rules, the Workspace, Fix all and the send path in a stub page. */

const TT_DETS = ['title_template', 'size_format', 'dimension_order', 'title_length', 'title_keyword'];
const TT_SCREEN = 'Titles · Fix all';
const TT_ROW = 'ttl';                    // fix-all.js's row key of these changes (the change log, the "waiting for Amazon" list)
const TT_NAME = 'Title problems';
const TT_MAX = 75;                       // Amazon asks for 75 or less (Item Highlights); the house rule too
const TT_AMZ_MAX = 200;
// The Amazon attributes each part of a title is read from (ListingMatch keeps them per listing in `va`), first found wins.
const TT_ATTRS = { color: ['color', 'color_name'], size: ['size', 'size_name'], material: ['material'], shape: ['item_shape'], pattern: ['pattern', 'pattern_name'] };
const TT_PART_WORD = { brand: 'brand', product: 'product', shape: 'shape', material: 'material', size: 'size', color: 'colour', pattern: 'print', uses: 'uses' };
let TT = { run: null, read: new Map(), readV: 0, last: new Map(), memo: null, fam: new Map(), work: new Map(), rowsWork: {} };   // read: "brand|sku" → { va, pt, at } read for this

/* ----- small words ----- */
const ttEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const TT_NUM = new Intl.NumberFormat('en-US');
const ttNf = n => TT_NUM.format(Number(n || 0));
const ttKids = n => (n === 1 ? '1 child' : ttNf(n) + ' children');
const ttIsDet = det => TT_DETS.includes(det);
const ttParentOf = row => row.parent || row.asin || row.sku || '—';
// "blue sage" → "Blue Sage" when Amazon holds it all in small letters; a value written with capitals stays as it is.
const ttCase = v => { const s = String(v || '').replace(/\s+/g, ' ').trim(); return s && s === s.toLowerCase() ? s.replace(/\b[a-z]/g, ch => ch.toUpperCase()) : s; };
// The real words of a text, for comparing (three letters or more).
const ttWords = v => lrNorm(v).split(/[^a-z0-9%]+/).filter(word => word.length > 2);
// The numbers of a size, smaller first for two ("108 x 70" → [70, 108]); null when the text holds no W x H (or is in cm).
function ttSizeNums(text) {
  const s = String(text || '');
  if (/\bcm\b|centimet/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:"|”|″|in(?:ch(?:es)?)?\.?)?\s*(?:x|×|X|\*|by)\s*(\d+(?:\.\d+)?)(?:\s*(?:"|”|″|in(?:ch(?:es)?)?\.?)?\s*(?:x|×|X|\*|by)\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const nums = [+m[1], +m[2]].concat(m[3] ? [+m[3]] : []);
  return nums.length === 2 ? nums.sort((a, b) => a - b) : nums;
}
const ttSameNums = (a, b) => !!a && !!b && a.slice().sort((x, y) => x - y).join('x') === b.slice().sort((x, y) => x - y).join('x');
// The rules in force for these problems, and the length the title_length rule asks for (75 at most).
const ttRulesOf = cfg => (cfg.issues || []).filter(rule => rule.on !== false && LR_SEV[rule.sev] && ttIsDet(rule.detector));
function ttLimits(cfg) {
  const len = ttRulesOf(cfg).filter(rule => rule.detector === 'title_length');
  return { max: Math.min(TT_MAX, ...len.map(rule => +(rule.params || {}).max || 999)), min: Math.max(0, ...len.map(rule => +(rule.params || {}).min || 0)) };
}

/* ----- the child's own Amazon facts ----- */
// One attribute's first value from a ?lfix=get answer (or a ListingMatch `va`).
const ttOne = (attrs, name) => { const v = attrs && attrs[name]; return v && v[0] && v[0].value != null ? String(v[0].value) : ''; };
/** What Amazon holds for this listing, freshest first: a read made for this fix, the ListingMatch cache, the Workspace's live read of its
 *  specs. { va: { color, size, material, item_shape, pattern, … }, pt, src } — or null when Sellora holds no Amazon read of its attributes. */
function ttAmazon(brand, sku) {
  const key = brand + '|' + sku;
  const r = TT.read.get(key);
  if (r) return { va: r.va, pt: r.pt, src: 'Amazon (read now)' };
  const m = typeof lmGet === 'function' ? lmGet(sku, brand) : null;
  if (m && m.va) return { va: m.va, pt: m.pt || '', src: 'Amazon (auto refresh)' };
  const v = typeof FA !== 'undefined' && FA.vals && FA.vals[brand] ? FA.vals[brand][sku] : null;
  if (v) {
    const va = {};
    Object.keys(v).forEach(name => { if (v[name] && v[name].text) va[name] = String(v[name].text).split(' · ')[0]; });
    const live = typeof LI_WS !== 'undefined' && LI_WS.live[brand] ? LI_WS.live[brand][sku] : null;
    return { va, pt: (live && live.pt) || '', src: 'Amazon (read)' };
  }
  return null;
}
// The first of these attributes Amazon holds a value for.
const ttFact = (va, part) => { for (const name of TT_ATTRS[part] || []) { const x = va && va[name]; if (x && String(x).trim()) return String(x).trim(); } return ''; };
// The product type the patch needs (Amazon's, from any read Sellora holds).
function ttPt(brand, sku, amz, kid) {
  const live = typeof LI_WS !== 'undefined' && LI_WS.live[brand] ? LI_WS.live[brand][sku] : null;
  return (kid && kid.lr && kid.lr.pt) || (amz && amz.pt) || (live && live.pt) || '';
}

/* ----- THE NEW TITLE ----- */
/** The parts of the template filled from the facts: { tpl, parts, src: { part: 'Amazon' | 'catalogue' | 'Listing Rules' }, need (the parts that
 *  must be there), drop (the order optional parts go), notes ["check: material missing"], clash ["colour — Amazon says …"] } — or { why }. */
function ttParts(brand, row, ctx, amz) {
  const cfg = ctx.cfg;
  const fresh = lrFresh(Object.assign({}, row, { brand }), ctx);
  const tpl = lrTemplateFor(fresh, cfg);
  if (!tpl) return { why: 'no title template for this product in Listing Rules' };
  const cat = lrCatOf(fresh) || {};
  const va = (amz && amz.va) || {};
  const title = hTitleText(fresh);
  const example = (((cfg.issues || []).find(issue => issue.detector === 'size_format') || {}).params || {}).example;
  const tokens = (String(tpl.template || '').match(/\{(\w+)\}/g) || []).map(token => token.slice(1, -1));
  const parts = {}, src = {}, notes = [], clash = [];
  // brand and product: Amazon's brand when Sellora has read it, else the account's; the product word is the template's
  parts.brand = lrBrandName(fresh, cfg); src.brand = fresh.amzBrand ? 'Amazon' : 'Listing Rules';
  parts.product = tpl.product || ''; src.product = 'Listing Rules';
  // colour: Amazon's, else the catalogue's — two that share no word: held back
  const aColor = ttFact(va, 'color'), cColor = cat.color || '';
  if (aColor && cColor && !ttWords(aColor).some(word => ttWords(cColor).includes(word))) clash.push(`colour — Amazon says “${aColor}”, the catalogue says “${cColor}”`);
  parts.color = ttCase(aColor || cColor); src.color = aColor ? 'Amazon' : cColor ? 'catalogue' : '';
  const dash = title.lastIndexOf(' - ');
  const tColor = dash >= 0 && title.length - dash <= 32 ? title.slice(dash + 3).trim() : '';
  if (parts.color && tColor && !ttWords(tColor).some(word => ttWords(parts.color).includes(word))) clash.push(`colour — the title says “${tColor}”, ${src.color === 'Amazon' ? 'Amazon' : 'the catalogue'} says “${parts.color}”`);
  // size: Amazon's, else the catalogue's — the rule's way, the smaller number first; a different size in the title: held back
  const aNums = ttSizeNums(ttFact(va, 'size')), cNums = ttSizeNums(cat.size);
  if (aNums && cNums && !ttSameNums(aNums, cNums)) clash.push(`size — Amazon says ${aNums.join(' x ')}, the catalogue says ${cNums.join(' x ')}`);
  const nums = aNums || cNums;
  parts.size = nums ? lrSizeText(nums.join('x'), example) : ''; src.size = aNums ? 'Amazon' : cNums ? 'catalogue' : '';
  const tSize = hTitleSizes(title)[0];
  if (nums && tSize && !ttSameNums([tSize.a, tSize.b].concat(tSize.c != null ? [tSize.c] : []), nums)) clash.push(`size — the title says “${tSize.text}”, ${src.size === 'Amazon' ? 'Amazon' : 'the catalogue'} says ${nums.join(' x ')}`);
  // shape: Amazon's item shape, else the catalogue sub-category's
  const norm = s => String(s || '').toLowerCase().replace(/rectangular/, 'rectangle');
  const aShape = lrShape(ttFact(va, 'shape')), cShape = lrShape(cat.subcat);
  if (aShape && cShape && norm(aShape) !== norm(cShape)) clash.push(`shape — Amazon says “${aShape}”, the catalogue says “${cShape}”`);
  parts.shape = ttCase(aShape || cShape); src.shape = aShape ? 'Amazon' : cShape ? 'catalogue' : '';
  // material: Amazon's only (the catalogue has none) — the template's words when it is the same material ("Cotton" → "100% Cotton")
  const aMat = ttFact(va, 'material');
  if (aMat) {
    const tplWords = ttWords(tpl.material || '');
    parts.material = tpl.material && ttWords(aMat).length && ttWords(aMat).every(word => tplWords.includes(word)) ? tpl.material : ttCase(aMat);
    src.material = 'Amazon';
  } else parts.material = '';
  // the title names a material Amazon's does not (the title says Linen, Amazon says Cotton): held back, nothing is guessed
  const tMats = (lrNorm(title).match(/cotton|linen|polyester|jute|velvet/g) || []).filter((m, i, all) => all.indexOf(m) === i);
  if (aMat && tMats.length && !tMats.some(m => lrNorm(aMat).includes(m))) clash.push(`material — the title says “${ttCase(tMats.join(', '))}”, Amazon says “${aMat}”`);
  // the print: only when the rule asks for it, the title already says it, or Amazon's pattern attribute does
  const kwRule = ttRulesOf(cfg).find(rule => rule.detector === 'title_keyword');
  const kwWords = kwRule ? lrWords((kwRule.params || {}).words) : [];
  const bp = kwWords.find(word => lrNorm(word) === 'block print');
  // asked = the rule would ask for it: a SIBLING's title or the child's own bullets say it (its own title saying it is no proof) —
  // the rule's own judging (lrBlockPrintProof) over the title without it and the family without this child's count
  let proofRow = fresh, proofCtx = ctx;
  const grp = fresh.parent ? ctx.parents.get(fresh.parent + '|' + brand) : null;
  if (bp && lrNorm(title).includes('block print')) {
    proofRow = Object.assign({}, fresh, { shownTitle: title.replace(/block\s+print/ig, ' ') });
    if (grp) proofCtx = Object.assign({}, ctx, { parents: new Map(ctx.parents).set(fresh.parent + '|' + brand, Object.assign({}, grp, { bp: Math.max(0, grp.bp - 1) })) });
  }
  const asked = !!bp && !!lrBlockPrintProof(proofRow, proofCtx);
  const has = kwWords.some(word => lrHas(title, word)) || kwWords.some(word => lrHas(ttFact(va, 'pattern'), word));
  const tplPrint = tpl.pattern && (!bp || lrHas(tpl.pattern, bp)) ? tpl.pattern : bp || '';
  parts.pattern = (asked || (has && bp)) && tokens.includes('pattern') ? tplPrint : '';
  if (parts.pattern) src.pattern = 'Listing Rules';
  if (asked && !tokens.includes('pattern')) notes.push(`check: the rule asks for “${bp}” and the template has no place for it`);
  parts.uses = tpl.uses || ''; if (parts.uses) src.uses = 'Listing Rules';
  parts.occasions = '';                                   // never a season word here (the Season planner's alone)
  // what must be there: the template's required parts (always brand, product, size, colour), and the print when the rule asks for it
  const need = [...new Set(['brand', 'product', 'size', 'color'].concat(lrWords(tpl.required || ''), asked ? ['pattern'] : []))].filter(key => tokens.includes(key));
  need.forEach(key => { if (!parts[key]) notes.push(`check: ${TT_PART_WORD[key] || key} missing`); });
  // the optional parts, in the order they go when the title is too long
  const drop = ['uses', 'pattern'].concat(tokens.filter(key => !['uses', 'pattern', 'occasions'].includes(key))).filter((key, i, all) => all.indexOf(key) === i && tokens.includes(key) && !need.includes(key));
  return { tpl, tokens, parts, src, need, drop, notes, clash, fresh, title, bp: bp || '' };
}
// The template filled, tidied the way the Listing Rules suggestion is (lrSuggest): spaces, and the " - " before an empty part.
const ttFill = (tpl, parts, out) => String(tpl.template || '').replace(/\{(\w+)\}/g, (_, key) => (out.includes(key) ? '' : (parts[key] || '')))
  .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
/** The new title for one listing: { after, parts…, notes, clash, why } — the template filled, the optional parts left out one by one until
 *  it is within the rule's length. `why` when it cannot be made (no template, held facts, too long even when cut to the required parts). */
function ttBuild(brand, row, ctx, amz) {
  const p = ttParts(brand, row, ctx, amz);
  if (p.why) return p;
  const lim = ttLimits(ctx.cfg);
  const out = [];
  let after = ttFill(p.tpl, p.parts, out);
  // the steps when it is too long: the uses go; the template's print is written as the rule's own words ("Hand Block Print" →
  // "Block Print": the keyword rule is still met); the print goes when the rule does not ask for it; then the other optional parts
  const steps = p.drop.slice();
  // (as written, not lrNorm: the rules read "Hand Block Print" as "Block Print" — which is why the short one still meets the rule)
  if (p.parts.pattern && p.bp && p.bp.length < p.parts.pattern.length && lrHas(p.parts.pattern, p.bp)) steps.splice(steps[0] === 'uses' ? 1 : 0, 0, '~pattern');
  for (const key of steps) {
    if (after.length <= lim.max) break;
    if (key === '~pattern') { p.shortPrint = p.parts.pattern; p.parts.pattern = p.bp; } else out.push(key);
    after = ttFill(p.tpl, p.parts, out);
  }
  p.dropped = out;
  p.after = after;
  p.lim = lim;
  if (after.length > lim.max) p.why = `even with only the parts the template requires it is ${after.length} characters (over ${lim.max})`;
  return p;
}

/* ----- the check: every Listing Rules rule on the new title, the family as it will be ----- */
// Every rule over a listing: rule id → { name, detail, detector } (as healthOf runs them).
function ttJudge(row, ctx) {
  const out = new Map();
  (ctx.cfg.issues || []).forEach(rule => {
    if (rule.on === false || !LR_SEV[rule.sev]) return;
    const det = LR_DET[rule.detector];
    if (!det) return;
    let res = '';
    try { res = det(row, ctx, rule.params || {}) || ''; } catch (e) { res = ''; }
    if (res) out.set(rule.id, { name: rule.name, detail: res, detector: rule.detector });
  });
  return out;
}
// One family's picture for the rules that compare siblings (hCtx's per-parent group), from the titles it will have.
function ttGroupOf(titles) {
  const group = { sized: 0, bp: 0, shapes: new Map(), examples: new Map() };
  titles.forEach(title => {
    if (lrNorm(title).includes('block print')) group.bp++;
    const size = hTitleSizes(title)[0];
    if (!size) return;
    group.sized++;
    const shape = lrSizeShape(size.text);
    group.shapes.set(shape, (group.shapes.get(shape) || 0) + 1);
    if (!group.examples.has(shape)) group.examples.set(shape, size.text);
  });
  const top = [...group.shapes.entries()].sort((a, b) => b[1] - a[1])[0];
  group.common = top ? top[0] : '';
  group.commonExample = top ? group.examples.get(top[0]) : '';
  return group;
}
// The rules' context with these families as they will be: each changed child's new title in place of its old one.
function ttCtxWith(ctx, brand, changed) {
  const all = (HEALTH[brand] && HEALTH[brand].rows) || [];
  const fams = new Set();
  all.forEach(r => { if (r.parent && changed.has(r.sku)) fams.add(r.parent); });
  const over = new Map();
  if (fams.size) {
    const by = new Map();
    all.forEach(r => { if (r.parent && fams.has(r.parent)) { if (!by.has(r.parent)) by.set(r.parent, []); by.get(r.parent).push(changed.has(r.sku) ? changed.get(r.sku) : hTitleText(r)); } });
    by.forEach((titles, parent) => over.set(parent + '|' + brand, ttGroupOf(titles)));
  }
  const parents = { get: k => (over.has(k) ? over.get(k) : ctx.parents.get(k)) };
  return Object.assign({}, ctx, { parents });
}
// The send checks that matter for a rebuilt title (listing-send-check's own words): [reason] — empty when it may go.
function ttSafe(title) {
  const out = [];
  const t = String(title || '').trim();
  if (!t) return ['the title is empty'];
  if (t.length > TT_AMZ_MAX) out.push(`over Amazon's ${TT_AMZ_MAX}-character limit`);
  const sym = typeof SP_BANNED !== 'undefined' ? t.match(SP_BANNED) : null;
  if (sym) out.push(`“${sym[0]}” is not allowed in a title`);
  const n = {};
  t.toLowerCase().split(/[^a-z0-9%]+/).filter(word => word.length >= 3).forEach(word => { n[word] = (n[word] || 0) + 1; });
  const thrice = Object.keys(n).find(word => n[word] >= 3);
  if (thrice) out.push(`“${thrice}” would be used 3 times`);
  return out;
}
/** A title for a listing, judged: { pass, fails: ['still: Size formatting inconsistent — "60x90"', 'would add: …'], rules }. `ctx2`: the
 *  rules' context with the family as it will be. */
function ttCheck(brand, row, title, ctx, ctx2) {
  const was = lrFresh(Object.assign({}, row, { brand }), ctx);
  const now = Object.assign({}, was, { shownTitle: title, submittedTitle: title, content: Object.assign({}, was.content || {}, { title, titleLen: title.length }) });
  delete now._f;
  const a = ttJudge(was, ctx);
  const b = ttJudge(now, ctx2 || ctx);
  const fails = [];
  b.forEach((hit, id) => {
    if (ttIsDet(hit.detector)) fails.push(`still: ${hit.name} — ${hit.detail}`);
    else if (!a.has(id)) fails.push(`would add: ${hit.name} — ${hit.detail}`);
  });
  const brands = lrBrandWords(was, ctx.cfg);
  if (brands.length && !brands.some(word => lrFind(title, word) === 0)) fails.push('the brand is not at the start');
  return { pass: !fails.length && !ttSafe(title).length, fails: fails.concat(ttSafe(title)) };
}

/* ----- the children with a title problem ----- */
// Which of the six problems a listing has now (Listing Health's own judging): [{ id, name, detail, detector }].
function ttProblems(brand, row, ctx, now) {
  const scored = Object.assign({}, row, { brand });
  const h = typeof hHealthKept === 'function' ? hHealthKept(row, scored, ctx, now || Date.now()) : healthOf(scored, ctx);
  return h.found.filter(hit => ttIsDet(hit.detector));
}
// A change sent lately that is still waiting for Amazon (fix-all.js's log), for this listing's title: this fix's, or the older
// "Title too long" fix's.
function ttWaiting(brand, sku, sent) {
  return sent.get(brand + '|' + sku + '|' + TT_ROW) || sent.get(brand + '|' + sku + '|title') || null;
}
/** Every listing of a brand with a title problem, not waiting for Amazon: [{ row, hits }] — kept until what they are judged on changes. */
const ttRowsSig = (brand, ctx) => [ctx, brand, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0, (typeof FA !== 'undefined' && FA.log) ? FA.log.length : -1, HEALTH[brand].rows.length];
const ttRowsKept = (brand, sig) => { const memo = TT.memo && TT.memo[brand]; return memo && memo.sig.every((x, i) => x === sig[i]) ? memo.rows : null; };
// These listings' title problems: [{ row, hits }], the ones waiting for Amazon left out.
function ttRowsOf(brand, rows, ctx) {
  const sent = typeof faSentMap === 'function' ? faSentMap(brand) : new Map();
  const now = Date.now();
  const out = [];
  rows.forEach(row => {
    const hits = ttProblems(brand, row, ctx, now);
    if (hits.length && !ttWaiting(brand, row.sku, sent)) out.push({ row, hits });
  });
  return out;
}
function ttRows(brand) {
  if (typeof HEALTH === 'undefined' || !HEALTH[brand] || !(HEALTH[brand].rows || []).length) return [];
  const ctx = hCtx();
  const sig = ttRowsSig(brand, ctx);
  const kept = ttRowsKept(brand, sig);
  if (kept) return kept;
  const rows = ttRowsOf(brand, HEALTH[brand].rows, ctx);
  TT.memo = Object.assign({}, TT.memo || {}, { [brand]: { sig, rows } });
  return rows;
}
// One family's (the Workspace's block): the brand's list when it is current, else only this family's listings judged.
function ttFamilyRows(brand, parent) {
  if (typeof HEALTH === 'undefined' || !HEALTH[brand] || !(HEALTH[brand].rows || []).length) return [];
  const ctx = hCtx();
  const kept = ttRowsKept(brand, ttRowsSig(brand, ctx));
  if (kept) return kept.filter(r => ttParentOf(r.row) === parent);
  return ttRowsOf(brand, HEALTH[brand].rows.filter(row => ttParentOf(row) === parent), ctx);
}

/* ----- the plans ----- */
// A child as a seller knows it: colour · size (the facts the new title uses), else its SKU.
const ttLabel = p => [p.parts && p.parts.color, p.parts && p.parts.size].filter(Boolean).join(' · ');
/** Every plan for these listings, sent together: Map sku → { key, brand, sku, asin, parent, label, ok, wait, why, before, oldTitle, after,
 *  fixes [names], notes, src, dropped, pt, patches, sent }. The family rules judge each new title with the others' new titles in place. */
function ttPlans(brand, items, ctx) {
  const plans = new Map();
  const drafts = [];
  items.forEach(item => { const p = ttDraft(brand, item, ctx); plans.set(p.sku, p); if (p.draft) drafts.push(p); });
  // the family as it will be: every draft's new title in place, then each draft judged
  const ctx2 = ttCtxWith(ctx, brand, new Map(drafts.map(p => [p.sku, p.after])));
  drafts.forEach(p => ttJudgeDraft(brand, p, ctx, ctx2));
  return plans;
}
// One listing's plan before the family check: the new title built from its facts; `draft` true when it goes on to the check.
function ttDraft(brand, { row, hits, kid }, ctx) {
  {
    const amz = ttAmazon(brand, row.sku);
    const fresh = lrFresh(Object.assign({}, row, { brand }), ctx);
    const before = hTitleText(fresh);
    const p = { key: brand + '|' + row.sku, brand, sku: row.sku, asin: row.asin || '', parent: ttParentOf(row), kind: 'ttl', row: TT_ROW, ok: false, wait: false, why: '',
      before, oldTitle: fresh.submittedTitle || before, fixes: [...new Set((hits || []).map(hit => hit.name))], notes: [], src: {}, pt: ttPt(brand, row.sku, amz, kid) };
    Object.defineProperty(p, 'srcRow', { value: row, enumerable: false });
    if (!amz) return Object.assign(p, { wait: true, why: 'reading its attributes from Amazon first', label: row.sku });
    const b = ttBuild(brand, row, ctx, amz);
    Object.assign(p, { parts: b.parts || {}, src: b.src || {}, notes: (b.notes || []).slice(), dropped: b.dropped || [], lim: b.lim, amzSrc: amz.src });
    p.label = ttLabel(p) || row.sku;
    p.after = b.after;
    if (b.why) return Object.assign(p, { why: b.why });
    // a fact missing (left out, never guessed) or two that disagree: held back with what to check
    if (b.clash.length || b.notes.length) return Object.assign(p, { why: b.notes.concat(b.clash.map(c => 'check: ' + c)).join('; ') });
    return Object.assign(p, { draft: true });
  }
}
// One draft judged: every rule on its new title, `ctx2` the family with every draft's new title in place.
function ttJudgeDraft(brand, p, ctx, ctx2) {
  delete p.draft;
  const chk = ttCheck(brand, p.srcRow, p.after, ctx, ctx2);
  p.ctx2 = ctx2;
  p.fails = chk.fails;
  if (!chk.pass) return Object.assign(p, { why: p.notes.concat(chk.fails).join('; ') });
  if (p.after === p.before) return Object.assign(p, { why: 'the template already gives this very title' });
  if (!p.pt) return Object.assign(p, { wait: true, why: 'reading its product type from Amazon first' });
  return Object.assign(p, { ok: true, what: `New title, ${p.after.length} characters`, patches: ttPatches(p.after), sent: { title: p.after } });
}
const ttPatches = title => [{ op: 'replace', path: '/attributes/item_name', value: [{ value: title, language_tag: 'en_US' }] }];
/** One family's plans (the Workspace's Fix all block reads them per child): kept until what they rest on changes. */
function ttFamily(brand, parent) {
  if (typeof HEALTH === 'undefined' || !HEALTH[brand]) return new Map();
  for (let n = 0; !ttFamilyStep(brand, parent) && n < 1e6; n++) { /* the same steps, run to the end */ }
  const f = TT.fam.get(brand + '|' + parent);
  return f ? f.plans : new Map();
}
/* A STEP AT A TIME (18 Nov 2026): one family's plans — and the brand's list — are worked out in small steps (one listing judged, built or
 * checked per step), so the Workspace works out the open parent first, in slices, and the rest of the brand in the background
 * (fix-all.js faWork). ttFamily / ttRows run the very same steps to the end: the same plans either way. */
// What a family's plans rest on: the rules' context, the listings, the change log, the reads — kept while it is the same.
const ttFamSig = (brand, ctx) => ttRowsSig(brand, ctx).concat([TT.readV, typeof FA !== 'undefined' ? FA.valsV : 0]);
const ttSameSig = (a, b) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
/** One step of one family's plans; true when they are ready (kept in TT.fam). */
function ttFamilyStep(brand, parent) {
  if (typeof HEALTH === 'undefined' || !HEALTH[brand]) return true;
  const ctx = hCtx();
  const sig = ttFamSig(brand, ctx);
  const key = brand + '|' + parent;
  if (ttSameSig((TT.fam.get(key) || {}).sig, sig)) return true;
  let w = TT.work.get(key);
  if (!w || !ttSameSig(w.sig, sig)) {
    // the brand's list when it is current (only this family's from it), else this family's listings judged one by one
    const kept = ttRowsKept(brand, ttRowsSig(brand, ctx));
    w = { sig, ctx, ph: kept ? 'draft' : 'rows', i: 0, items: kept ? kept.filter(r => ttParentOf(r.row) === parent) : [],
      src: kept ? null : HEALTH[brand].rows.filter(row => ttParentOf(row) === parent), sent: kept ? null : (typeof faSentMap === 'function' ? faSentMap(brand) : new Map()),
      now: Date.now(), plans: new Map(), drafts: [], ctx2: null };
    TT.work.set(key, w);
    return false;
  }
  if (w.ph === 'rows') {
    if (w.i < w.src.length) {
      const row = w.src[w.i++];
      const hits = ttProblems(brand, row, w.ctx, w.now);
      if (hits.length && !ttWaiting(brand, row.sku, w.sent)) w.items.push({ row, hits });
      return false;
    }
    w.ph = 'draft';
    w.i = 0;
    return false;
  }
  if (w.ph === 'draft') {
    if (w.i < w.items.length) {
      const p = ttDraft(brand, w.items[w.i++], w.ctx);
      w.plans.set(p.sku, p);
      if (p.draft) w.drafts.push(p);
      return false;
    }
    w.ctx2 = ttCtxWith(w.ctx, brand, new Map(w.drafts.map(p => [p.sku, p.after])));
    w.ph = 'check';
    w.i = 0;
    return false;
  }
  if (w.i < w.drafts.length) { ttJudgeDraft(brand, w.drafts[w.i++], w.ctx, w.ctx2); return false; }
  TT.work.delete(key);
  if (TT.fam.size > 4000) TT.fam.clear();
  TT.fam.set(key, { sig, plans: w.plans });
  return true;
}
/** One step of the brand's list of listings with a title problem (ttRows); true when it is ready. */
function ttRowsStep(brand) {
  if (typeof HEALTH === 'undefined' || !HEALTH[brand] || !(HEALTH[brand].rows || []).length) return true;
  const ctx = hCtx();
  const sig = ttRowsSig(brand, ctx);
  if (ttRowsKept(brand, sig)) return true;
  let w = TT.rowsWork[brand];
  if (!w || !ttSameSig(w.sig, sig)) {
    TT.rowsWork[brand] = { sig, ctx, i: 0, rows: [], sent: typeof faSentMap === 'function' ? faSentMap(brand) : new Map(), now: Date.now() };
    return false;
  }
  const src = HEALTH[brand].rows;
  if (w.i < src.length) {
    const row = src[w.i++];
    const hits = ttProblems(brand, row, w.ctx, w.now);
    if (hits.length && !ttWaiting(brand, row.sku, w.sent)) w.rows.push({ row, hits });
    return false;
  }
  TT.memo = Object.assign({}, TT.memo || {}, { [brand]: { sig, rows: w.rows } });
  TT.rowsWork[brand] = null;
  return true;
}

/* ----- the Workspace: the title rows of fix-all.js ----- */
// A Workspace child → its plan (fix-all.js faPlan calls this for the rows of kind 'ttl'): the family's plan for it.
function ttPlanOfKid(kid, ctx) {
  const plan = ttFamily(kid.brand, ttParentOf(kid.row)).get(kid.sku);
  return plan ? Object.assign({}, plan) : { key: kid.brand + '|' + kid.sku, sku: kid.sku, ok: false, wait: false, why: 'sent lately — waiting for Amazon to show the new title', before: hTitleText(kid.row) };
}
// How many children of a family the button sends (ready now, or read first in the popup).
const ttFamilyN = (brand, parent) => [...ttFamily(brand, parent).values()].filter(p => p.ok || p.wait).length;
/** Fix all on a title row (or one child of it): the preview popup over the family's children with a title problem. */
function ttStartFamily(brand, parent, onlySku) {
  const rows = ttRows(brand).filter(r => ttParentOf(r.row) === parent && (!onlySku || r.row.sku === onlySku));
  const name = typeof faWhoName === 'function' ? faWhoName(brand, parent) : parent;
  return ttPreview(brand, rows, { title: typeof faCut === 'function' ? faCut(name, 60) : name, parent });
}
/** The Fix button of one title problem (Listing Health's Why column, the Workspace's child view): that one child in the same popup. */
function ttStartOne(brand, sku) {
  const rows = ttRows(brand).filter(r => r.row.sku === sku);
  if (!rows.length) return null;
  return ttPreview(brand, rows, { title: sku, parent: ttParentOf(rows[0].row) });
}

/* ----- Listing Errors: the card above its list ----- */
function ttLeCardHtml(brand, only) {
  if (typeof HEALTH === 'undefined' || !(typeof H_LOADED !== 'undefined' && H_LOADED)) return '';      // kw-fix.js's card loads Listing Health
  const rows = ttRows(brand).filter(r => !only || only.has(r.row.sku));
  const last = TT.last.get(brand);
  if (!rows.length) return last ? `<div class="card kf-le tt-le"><span class="kf-le-t">Titles · Fix all: ${ttEsc(last)}</span></div>` : '';
  const fams = new Map();
  rows.forEach(r => { const p = ttParentOf(r.row); if (!fams.has(p)) fams.set(p, []); fams.get(p).push(r); });
  const busy = typeof sqIsOpen === 'function' && sqIsOpen();
  const name = p => (typeof parentName === 'function' ? parentName(brand, p, '') : '') || p;
  const kinds = rs => { const n = new Map(); rs.forEach(r => r.hits.forEach(hit => n.set(hit.name, (n.get(hit.name) || 0) + 1))); return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${ttNf(v)}`).join(' · '); };
  const list = [...fams.entries()].sort((a, b) => b[1].length - a[1].length || String(name(a[0])).localeCompare(String(name(b[0]))))
    .map(([p, rs]) => `<div class="kf-le-fam"><b>${ttEsc(String(name(p)).slice(0, 80))}</b><small>${ttEsc(p)} · ${ttKids(rs.length)} · ${ttEsc(kinds(rs))}</small>`
      + `<button type="button" class="fa-btn" data-tt-le="fam" data-tt-brand="${ttEsc(brand)}" data-tt-parent="${ttEsc(p)}"${busy ? ' disabled' : ''}>Fix all ${ttKids(rs.length)}</button></div>`).join('');
  return `<div class="card kf-le tt-le"><div class="kf-le-h"><span class="kf-le-t"><b>Title problems:</b> ${ttNf(rows.length)} listing${rows.length === 1 ? '' : 's'} in ${ttNf(fams.size)} famil${fams.size === 1 ? 'y' : 'ies'}`
    + ` <span class="muted">— one new title each from the title template and the listing's own Amazon facts</span>${last ? ` <span class="muted">· last Fix all: ${ttEsc(last)}</span>` : ''}</span>`
    + `<button type="button" class="fa-btn fa-main" data-tt-le="all" data-tt-brand="${ttEsc(brand)}"${busy ? ' disabled' : ''}>Select all · Fix all ${ttNf(rows.length)}</button></div>`
    + `<details class="kf-le-list"><summary>› Show the ${ttNf(fams.size)} famil${fams.size === 1 ? 'y' : 'ies'}</summary>${list}</details></div>`;
}
function ttLeStart(brand, parent, only) {
  const rows = ttRows(brand).filter(r => (!only || only.has(r.row.sku)) && (!parent || ttParentOf(r.row) === parent));
  if (!rows.length) return null;
  const name = parent ? ((typeof parentName === 'function' ? parentName(brand, parent, '') : '') || parent) : `every ${(typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand} listing with a title problem`;
  return ttPreview(brand, rows, { title: String(name).slice(0, 60), parent: parent || '' });
}

/* ----- the preview: one popup ----- */
// The attributes of these listings from Amazon (?lfix=get), one at a time: what a new title needs when Sellora holds no read of them.
async function ttRead(brand, rows, onStep) {
  for (const r of rows) {
    try {
      const reply = await baCall({ lfix: 'get', brand, sku: r.row.sku });
      const at = (reply && reply.attributes) || {};
      const va = {};
      Object.values(TT_ATTRS).flat().forEach(name => { const v = ttOne(at, name); if (v) va[name] = v.slice(0, 120); });
      TT.read.set(brand + '|' + r.row.sku, { va, pt: (reply && reply.productType) || '', at: Date.now() });
      TT.readV++;
      if (typeof lmNoteLive === 'function') lmNoteLive(brand, r.row.sku, 'get', reply);
    } catch (e) { /* stays "reading": named in the popup with its reason */ }
    if (onStep) onStep();
  }
}
/** rows: ttRows records of one brand; o: { title, parent }. Reads what Sellora does not hold, then shows the popup. A promise of the send's
 *  summary (or null when cancelled). */
async function ttPreview(brand, rows, o) {
  if (typeof sqIsOpen === 'function' && sqIsOpen()) return null;
  // a preview left open (closed with Escape or a click beside it, which the popup frame does on its own): this one takes its place
  if (TT.run && !TT.run.closed) { TT.run.closed = true; TT.run.resolve(null); }
  const run ={ brand, rows, o: o || {}, plans: [], sel: new Set(), edit: new Map(), chk: new Map(), q: '', reading: 0, total: 0, closed: false };
  TT.run = run;
  run.promise = new Promise(resolve => { run.resolve = resolve; });
  let ctx = hCtx();
  let plans = ttPlans(brand, rows, ctx);
  const need = rows.filter(r => { const p = plans.get(r.row.sku); return p && p.wait; });
  if (need.length) {
    run.total = need.length;
    ttDraw();
    await ttRead(brand, need, () => { run.reading++; ttDraw(); });
    if (run.closed) return run.promise;
    ctx = hCtx();
    plans = ttPlans(brand, rows, ctx);
  }
  run.ctx = ctx;
  run.plans = [...plans.values()];
  // still not known after the read (Amazon did not answer): named with its reason, never sent
  run.plans.forEach(p => { if (p.wait) Object.assign(p, { wait: false, why: p.why.replace(/^reading (.*) from Amazon first$/, 'its $1 could not be read from Amazon — try again') }); });
  run.plans.forEach(p => { if (p.ok) run.sel.add(p.key); });
  run.total = 0;
  ttDraw();
  return run.promise;
}
// The new title of a child: the person's edit, else the plan's.
const ttText = (run, p) => (run.edit.has(p.key) ? run.edit.get(p.key) : p.after);
// The check of a child's title as it stands in the popup (the plan's own passed already; an edit is judged again).
function ttRunCheck(run, p) {
  if (!run.edit.has(p.key)) return { pass: true, fails: [] };
  const text = run.edit.get(p.key);
  const kept = run.chk.get(p.key);
  if (kept && kept.text === text) return kept.chk;
  const row = ((HEALTH[p.brand] && HEALTH[p.brand].rows) || []).find(r => r.sku === p.sku) || { sku: p.sku };
  const chk = ttCheck(p.brand, row, text, run.ctx, ttCtxWith(run.ctx, p.brand, new Map(run.plans.filter(x => x.ok).map(x => [x.sku, ttText(run, x)]))));
  if (text.length > (p.lim ? p.lim.max : TT_MAX)) chk.fails.unshift(`${text.length} characters, over ${p.lim ? p.lim.max : TT_MAX}`), chk.pass = false;
  run.chk.set(p.key, { text, chk });
  return chk;
}
// A title with some of its words marked (the words that go, or come in) — each word as often as the diff names it.
function ttMark(text, words, cls) {
  const left = new Map();
  words.forEach(w => { const k = w.toLowerCase(); left.set(k, (left.get(k) || 0) + 1); });
  return String(text || '').split(/(\s+)/).map(part => {
    const k = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'%]+$/gu, '').toLowerCase();
    if (k && left.get(k)) { left.set(k, left.get(k) - 1); return `<span class="${cls}">${ttEsc(part)}</span>`; }
    return ttEsc(part);
  }).join('');
}
function ttChosen(run) {
  return run.plans.filter(p => p.ok && run.sel.has(p.key)).map(p => ({ p, text: ttText(run, p), chk: ttRunCheck(run, p) }));
}
function ttSumText(run) {
  const ok = run.plans.filter(p => p.ok);
  const chosen = ttChosen(run);
  const bad = chosen.filter(c => !c.chk.pass).length;
  return `${ttKids(ok.length)} · ${bad ? `${ttNf(chosen.length - bad)} pass every title rule · ${ttNf(bad)} edited and failing a rule` : 'every new title passes every title rule'}`
    + (chosen.length !== ok.length ? ` · ${ttNf(chosen.length)} ticked` : '') + (run.plans.length > ok.length ? ` · ${ttNf(run.plans.length - ok.length)} held back` : '');
}
const ttGoText = run => `Check with Amazon &amp; send ${ttNf(ttChosen(run).filter(c => c.chk.pass).length)}`;
// Where the parts came from, in a line: "from Amazon: colour, size, material · Listing Rules: product, print".
function ttSrcLine(p) {
  const by = new Map();
  Object.entries(p.src || {}).forEach(([key, from]) => {
    if (!from || (p.dropped || []).includes(key) || !(p.parts || {})[key]) return;
    const k = from === 'Amazon' ? 'from Amazon' : from === 'catalogue' ? 'from the catalogue' : 'Listing Rules';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(TT_PART_WORD[key] || key);
  });
  return [...by.entries()].map(([k, list]) => `${k}: ${list.join(', ')}`).join(' · ');
}
function ttRowHtml(run, p) {
  const find = ttEsc([p.sku, p.label, p.asin].join(' ').toLowerCase());
  const hide = run.q && !find.includes(run.q) ? ' hide' : '';
  if (!p.ok) {
    return `<div class="sp-m-row sq-row kf-row tt-row is-held${hide}" data-kf-find="${find}"><div class="kf-top"><b>${ttEsc(p.sku)}</b><small>${ttEsc(p.label && p.label !== p.sku ? p.label : '')}</small></div>`
      + `<div class="tt-old">${ttEsc(p.before)}</div>${p.after && p.after !== p.before ? `<div class="tt-new">${ttEsc(p.after)}</div>` : ''}`
      + `<div class="sq-st">⚠ Held back: ${ttEsc(p.why)}</div>`
      + `<button type="button" class="sp-btn sp-small" data-tt="hand" data-tt-sku="${ttEsc(p.sku)}">Edit by hand in Listing Errors</button></div>`;
  }
  const text = ttText(run, p);
  const chk = ttRunCheck(run, p);
  const d = typeof sqWordDiff === 'function' ? sqWordDiff(p.before, text) : { added: [], removed: [] };
  const on = run.sel.has(p.key);
  return `<div class="sp-m-row sq-row kf-row tt-row${hide}" data-kf-find="${find}" data-tt-key="${ttEsc(p.key)}">`
    + `<label class="kf-tick"><input type="checkbox" data-tt-tick="${ttEsc(p.key)}"${on ? ' checked' : ''} aria-label="Send ${ttEsc(p.sku)}"></label>`
    + `<div class="kf-body"><div class="kf-top"><b>${ttEsc(p.sku)}</b><small>${ttEsc(p.label && p.label !== p.sku ? p.label : '')}</small>`
    + `<span class="kf-bytes"><span class="${p.before.length > TT_MAX ? 'err' : ''}">${ttNf(p.before.length)}</span> → <span class="${chk.pass ? 'ok' : 'err'}" data-tt-n="${ttEsc(p.key)}">${ttNf(text.length)}</span> characters</span></div>`
    + `<div class="tt-old"><small>Now</small> ${ttMark(p.before, d.removed || [], 'kf-cut')}</div>`
    + `<div class="tt-new"><small>New</small> <span data-tt-new="${ttEsc(p.key)}">${ttMark(text, d.added || [], 'tt-add')}</span></div>`
    + `<div class="tt-fix">Fixes: ${ttEsc(p.fixes.join(' · '))}${ttSrcLine(p) ? ` <span class="muted">· ${ttEsc(ttSrcLine(p))}</span>` : ''}${p.notes.length ? ` <span class="tt-note">· ${ttEsc(p.notes.join(' · '))}</span>` : ''}</div>`
    + `<div class="tt-chk${chk.pass ? '' : ' is-bad'}" data-tt-chk="${ttEsc(p.key)}">${chk.pass ? '✓ Passes every title rule' : '✕ ' + ttEsc(chk.fails.join(' · '))}</div>`
    + `<details class="kf-ed"${run.edit.has(p.key) ? ' open' : ''}><summary>Edit new title</summary><textarea data-tt-edit="${ttEsc(p.key)}" rows="2" spellcheck="false">${ttEsc(text)}</textarea></details></div></div>`;
}
function ttDraw() {
  const run = TT.run;
  if (!run || run.closed || typeof spModal !== 'function') return;
  if (run.total) {
    const pct = Math.round(run.reading * 100 / run.total);
    spModal(`<div class="sq-pop kf-pop tt-pop"><div class="sp-m-h"><b>Reading the listings' attributes from Amazon… ${ttNf(run.reading)} of ${ttNf(run.total)}</b>`
      + '<p>A new title is made only from what Amazon holds for each listing. Nothing changes on Amazon.</p></div>'
      + `<div class="sp-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${run.total}" aria-valuenow="${run.reading}"><span style="width:${pct}%"></span></div>`
      + '<div class="sp-m-a"><button type="button" class="sp-btn" data-tt="cancel">Cancel</button></div></div>', true);
    return;
  }
  const ok = run.plans.filter(p => p.ok);
  const order = run.plans.slice().sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? -1 : 1));
  const all = ok.length && ok.every(p => run.sel.has(p.key));
  spModal(`<div class="sq-pop kf-pop tt-pop"><div class="sp-m-h sq-top"><b>Fix all titles — ${ttEsc(run.o.title || '')}</b>`
    + `<p class="sq-sum" data-tt-sum>${ttEsc(ttSumText(run))}</p>`
    + `<p>One new title per child, made with the Listing Rules title template from the child's own Amazon facts — the size the rule's way, the smaller number first, within ${ttNf(ttLimits(run.ctx.cfg).max)} characters. Every title rule is checked again on it.</p>`
    + `<div class="kf-tools"><input type="search" data-tt-q placeholder="Search SKU, colour, size…" value="${ttEsc(run.q)}" aria-label="Search the children">`
    + `<label class="kf-all"><input type="checkbox" data-tt-all${all ? ' checked' : ''}> Select all</label></div></div>`
    + `<div class="sp-m-list">${order.map(p => ttRowHtml(run, p)).join('') || '<div class="sp-m-row sq-none">Nothing to fix.</div>'}</div>`
    + `<div class="sp-m-a"><button type="button" class="sp-main" data-tt="go"${ok.length ? '' : ' disabled'}>${ttGoText(run)}</button><button type="button" class="sp-btn" data-tt="cancel">Cancel</button></div></div>`, true);
}
// A tick or an edit changes only its own row's words, the sum and the button (the box being typed in keeps its place).
function ttRefresh(key) {
  const run = TT.run;
  const box = typeof $ === 'function' ? $('spModalBox') : null;
  if (!run || !box || !box.querySelector) return ttDraw();
  const sum = box.querySelector('[data-tt-sum]');
  const go = box.querySelector('[data-tt="go"]');
  if (!sum || !go) return ttDraw();
  sum.textContent = ttSumText(run);
  go.innerHTML = ttGoText(run);
  const all = box.querySelector('[data-tt-all]');
  if (all) all.checked = run.plans.filter(p => p.ok).every(p => run.sel.has(p.key));
  const p = key ? run.plans.find(x => x.key === key) : null;
  if (!p) return null;
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key;
  const text = ttText(run, p);
  const chk = ttRunCheck(run, p);
  const d = typeof sqWordDiff === 'function' ? sqWordDiff(p.before, text) : { added: [] };
  const n = box.querySelector(`[data-tt-n="${esc}"]`);
  if (n) { n.textContent = ttNf(text.length); n.className = chk.pass ? 'ok' : 'err'; }
  const nw = box.querySelector(`[data-tt-new="${esc}"]`);
  if (nw) nw.innerHTML = ttMark(text, d.added || [], 'tt-add');
  const c = box.querySelector(`[data-tt-chk="${esc}"]`);
  if (c) { c.textContent = chk.pass ? '✓ Passes every title rule' : '✕ ' + chk.fails.join(' · '); c.className = 'tt-chk' + (chk.pass ? '' : ' is-bad'); }
  return null;
}
function ttClose(summary) {
  const run = TT.run;
  if (!run || run.closed) return;
  run.closed = true;
  if (!summary && typeof spModal === 'function') spModal('', true);
  run.resolve(summary || null);
}
/** Check with Amazon & send: the ticked children's new titles through THE ONE SEND PATH. An edited title failing a rule is held back with its
 *  reason. Each one sent is kept with its OLD title (fix-all.js's log: History and Put back) and every screen follows. */
function ttGo() {
  const run = TT.run;
  if (!run || run.closed) return null;
  const chosen = ttChosen(run);
  const good = chosen.filter(c => c.chk.pass);
  const held = chosen.filter(c => !c.chk.pass).map(c => ({ sku: c.p.sku, label: c.p.label, why: 'the edited title fails: ' + c.chk.fails.join('; ') }))
    .concat(run.plans.filter(p => !p.ok).map(p => ({ sku: p.sku, label: p.label, why: p.why })));
  if (!good.length) return null;
  const o = run.o;
  const now = Date.now();
  const records = [];
  run.closed = true;          // the send path's popup takes the window over
  const jobs = good.map(c => {
    const p = Object.assign({}, c.p, { after: c.text, sent: { title: c.text }, patches: ttPatches(c.text) });
    return { brand: p.brand, sku: p.sku, asin: p.asin, label: p.label, plan: p,
      body: { lfix: 'patch', brand: p.brand, sku: p.sku, productType: p.pt, patches: p.patches },
      changes: [{ field: 'Title', old: p.oldTitle, new: c.text, max: TT_MAX, unit: 'letters', attr: 'item_name', oldV: [{ value: p.oldTitle, language_tag: 'en_US' }] }] };
  });
  const sent = sqSendWithCheck(jobs, {
    screen: TT_SCREEN, title: `Fix all titles — ${o.title || ''}`, held,
    onSent: job => {
      const it = Object.assign(job.plan, { sub: job.sub });
      const r = typeof faRecord === 'function' ? faRecord(it, { brand: it.brand, parent: it.parent || o.parent, row: TT_ROW, name: TT_NAME, attr: '' }, now, job.sub) : null;
      if (r) { job.rec = r; records.push(r); }
      if (typeof faLiveAfterSend === 'function') faLiveAfterSend(it, now);
    },
    onEdit: job => { if (typeof faOpenKid === 'function') faOpenKid(null, job.brand + '|' + job.sku); },
    onDone: async sum => {
      sum.jobs.forEach(job => { if (job.rec) { job.rec.state = job.state; job.rec.why = job.why || ''; } });
      if (records.length && typeof faLogAdd === 'function') await faLogAdd(records);
      TT.last.set(run.brand, typeof sqSummaryText === 'function' ? sqSummaryText(sum) : '');
      TT.memo = null;
      TT.fam.clear();
      if (typeof faRedraw === 'function') faRedraw();
      if (typeof leRender === 'function' && typeof $ === 'function' && $('leList')) { try { leRender(); } catch (e) { /* not on the page */ } }
    } });
  Promise.resolve(sent).then(sum => run.resolve(sum));
  return sent;
}
function ttClick(btn) {
  const act = btn.dataset.tt;
  if (act === 'cancel') return ttClose();
  if (act === 'go') return ttGo();
  if (act === 'hand') {
    const brand = TT.run ? TT.run.brand : '';
    ttClose();
    if (typeof lrFixOpen === 'function') lrFixOpen('lerr', brand, btn.dataset.ttSku, []);
  }
  return null;
}
// The popup's ticks, search box and edits.
function ttInput(el) {
  const run = TT.run;
  if (!run || run.closed) return null;
  const box = typeof $ === 'function' ? $('spModalBox') : null;
  if (el.dataset.ttQ !== undefined) {
    run.q = String(el.value || '').trim().toLowerCase();
    if (box && box.querySelectorAll) box.querySelectorAll('.tt-row').forEach(row => row.classList.toggle('hide', !!run.q && !String(row.dataset.kfFind || '').includes(run.q)));
    return null;
  }
  if (el.dataset.ttTick !== undefined) {
    if (el.checked) run.sel.add(el.dataset.ttTick); else run.sel.delete(el.dataset.ttTick);
    return ttRefresh();
  }
  if (el.dataset.ttAll !== undefined) {
    // Select all: every child still shown by the search (all of them with no search)
    const shown = new Set([...((box && box.querySelectorAll) ? box.querySelectorAll('.tt-row:not(.hide)') : [])].map(row => row.dataset.ttKey).filter(Boolean));
    run.plans.filter(p => p.ok && (!run.q || shown.has(p.key))).forEach(p => { if (el.checked) run.sel.add(p.key); else run.sel.delete(p.key); });
    if (box && box.querySelectorAll) box.querySelectorAll('[data-tt-tick]').forEach(t => { t.checked = run.sel.has(t.dataset.ttTick); });
    return ttRefresh();
  }
  if (el.dataset.ttEdit !== undefined) {
    const key = el.dataset.ttEdit;
    if (!run.plans.some(x => x.key === key)) return null;
    run.edit.set(key, String(el.value || '').replace(/\s+/g, ' ').trim());
    return ttRefresh(key);
  }
  return null;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-tt],[data-tt-le]') : null;
    if (!btn || btn.disabled) return;
    if (btn.dataset.tt) return ttClick(btn);
    const only = typeof LE_ONLY !== 'undefined' && LE_ONLY ? LE_ONLY.skus : null;
    ttLeStart(btn.dataset.ttBrand, btn.dataset.ttLe === 'fam' ? btn.dataset.ttParent : '', only);
  });
  document.addEventListener('input', e => { if (e.target && e.target.dataset && (e.target.dataset.ttQ !== undefined || e.target.dataset.ttEdit !== undefined)) ttInput(e.target); });
  document.addEventListener('change', e => { if (e.target && e.target.dataset && (e.target.dataset.ttTick !== undefined || e.target.dataset.ttAll !== undefined)) ttInput(e.target); });
}

/** CONSOLE: `ttReport()` in a signed-in Sellora tab, Listing Health loaded: per brand, the children and families "Fix all titles" would fix
 *  now, the ones it holds back (by reason), the ones whose attributes it would read from Amazon first, and three examples before → after.
 *  It reads nothing from Amazon. */
function ttReport() {
  const ctx = hCtx();
  const out = {};
  const examples = [];
  const reasons = {};
  ['SP', 'CPC'].forEach(brand => {
    const rows = ttRows(brand);
    const plans = [...ttPlans(brand, rows, ctx).values()];
    const ready = plans.filter(p => p.ok);
    out[(typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand] = { childrenWithATitleProblem: rows.length, families: new Set(rows.map(r => ttParentOf(r.row))).size,
      fixedNow: ready.length, familiesFixed: new Set(ready.map(p => p.parent)).size, readFirst: plans.filter(p => p.wait).length, heldBack: plans.filter(p => !p.ok && !p.wait).length };
    plans.filter(p => !p.ok && !p.wait).forEach(p => { const k = String(p.why).split(';')[0].replace(/“[^”]*”/g, '“…”').replace(/\d+/g, 'N').slice(0, 90); reasons[k] = (reasons[k] || 0) + 1; });
    // three examples: the families with the most children fixed, one child each
    const byFam = new Map();
    ready.forEach(p => { if (!byFam.has(p.parent)) byFam.set(p.parent, []); byFam.get(p.parent).push(p); });
    const ex = p => ({ brand, sku: p.sku, fixes: p.fixes.join(' · '), before: p.before, after: p.after });
    [...byFam.values()].sort((a, b) => b.length - a.length).forEach(list => { if (examples.length < 3) examples.push(ex(list[0])); });
    // fewer families than three: more children of them, the ones fixing the most problems first
    ready.filter(p => !examples.some(x => x.brand === brand && x.sku === p.sku)).sort((a, b) => b.fixes.length - a.fixes.length).forEach(p => { if (examples.length < 3) examples.push(ex(p)); });
  });
  if (typeof console !== 'undefined') {
    if (console.table) { console.table(out); console.table(reasons); }
    examples.forEach(x => console.log(`${x.sku} (${x.fixes})\n  before: ${x.before}\n  after:  ${x.after}`));
  }
  return { counts: out, heldBackBy: reasons, examples };
}
if (typeof window !== 'undefined') window.ttReport = ttReport;
