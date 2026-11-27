/* ================= LISTING · CREATE LISTING & PRE-SUBMIT CHECK (roadmap #8, 20 Nov 2026) =================
 * Screen: Listing → 1 · Fix & improve → Create Listing (#paneCreate / #clPane, drawn whole here). Same cards and buttons as the
 *       other Listing pages. Nothing runs when the screen opens: every read, check and send is a person's click.
 * START — two ways:
 *   Clone an existing SKU (a new colour or size in a family): its product type, parent, variation theme and attributes from what
 *       Sellora already holds (the ListingMatch cache, lmGet) — "Read every attribute from Amazon" (?lfix=get) copies all of them.
 *       Pictures and the product identifier are never copied (pictures: the Image Manager after; a new listing needs its own UPC).
 *       The person types the new SKU, its colour / size and the price.
 *   From a Research product: Sellora keeps no saved research / costing record yet, so this is shown greyed out
 *       ("No research records yet") — never invented.
 * REQUIRED FIELDS — the product type's schema through the existing ?lfix=schema (its required list, then each one's shape), kept with the
 *       draft: required first, grouped Basics · Variation · Content · Offer · Shipping, each Filled / Missing; the rest folded under
 *       "Good to fill".
 * CONTENT — title, 5 bullets, description, search terms, judged by the SAME shared rules as every suggestion (listing-ai.js aiCheck:
 *       the title rules — template, 60–75, the 74–75 short forms — the protected words of the suggestion-words rule, IP & Trademark Guard,
 *       lrKwCheck's 249 bytes, our brand words); each problem with its priority chip (listing-priority.js).
 * ✨ AI write (hidden until AI is set up) — the shared aiAsk, with the APPROVED house style of the product type; a suggestion beside
 *       each field, usable only when it passes our rules.
 * PRE-SUBMIT CHECK — our checks (all must pass) + "Check with Amazon" (Amazon's VALIDATION_PREVIEW through the backend's
 *       lcreate=put, nothing created). The test site cannot ask Amazon: "Amazon check runs on live Sellora" — never a fake pass.
 * CREATE — only through THE ONE SEND PATH (listing-send-check.js): Amazon's check → the person approves → send → read again →
 *       Listing History "Created". A new SKU cannot be put back: "Close this listing" (quantity 0, the same send path) instead.
 *       Disabled on the test site and on a local copy ("Test site — not sent to Amazon"). After: "Add pictures in Image Manager".
 * DRAFT — kept in this browser (IndexedDB), so a refresh loses nothing; "Clear draft".
 * Backend: Pricing-API/ListingCreate.gs (lcreatePut_, one Code.gs doPost line). Main functions: clOpen, clDraw, clClone, clReadAll,
 *       clSchemaRead, clChecks, clPreSubmit, clAmazonCheck, clCreate, clClose, clAiWrite, clDraftSave, clDraftLoad, clDraftClear.
 *       Every name starts with cl / CL. */

const CL_GROUPS = ['Basics', 'Variation', 'Content', 'Offer', 'Shipping'];
const CL_CONTENT = ['item_name', 'bullet_point', 'product_description', 'generic_keyword'];
const CL_VARIATION = /^(parentage_level|child_parent_sku_relationship|variation_theme|color|color_name|size|size_name|style|style_name|pattern_name)$/;
const CL_OFFER = /^(purchasable_offer|list_price|condition_type|condition_note|fulfillment_availability|merchant_shipping_group|max_order_quantity|skip_offer|product_tax_code|offering_start_date|gift_options|item_package_quantity)$/;
const CL_SHIP = /^(item_package_dimensions|item_package_weight|item_dimensions|item_weight|item_length_width|number_of_boxes|batteries_required|batteries_included|supplier_declared_dg_hz_regulation|country_of_origin)$/;
const CL_NEVER_COPY = /image_locator|^externally_assigned_product_identifier$|^merchant_suggested_asin$/;   // pictures, another listing's product id
const CL_SKU_RE = /^[A-Za-z0-9._\-\/ ]{1,40}$/;
const CL_DB = 'sellora-create', CL_DB_STORE = 'draft', CL_DB_KEY = 'draft';
const CL_SCREEN = 'Create Listing';
let CL = clBlank();
let CL_STORE = null;              // the draft store (IndexedDB; tests give their own with clStoreUse)
let CL_SAVE_T = 0;

function clBlank() {
  return { brand: 'SP', src: '', srcTitle: '', pt: '', parentSku: '', parentAsin: '', theme: '', attrs: {}, readAll: false, srcColour: '', srcSize: '',
    sku: '', colour: '', size: '', price: '', title: '', bullets: ['', '', '', '', ''], desc: '', kw: '', fields: {},
    schema: null, msg: '', amz: null, sent: null, savedAt: 0, ai: {}, busy: '' };
}
const clEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
// The test site (its guard blocks every backend POST) and a copy run on this computer: never sent to Amazon from there.
const clTestSite = () => (typeof sqIsTest === 'function' && sqIsTest()) || (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|)$/.test(location.hostname || ''));
const clVal = v => (typeof sqValText === 'function' ? sqValText(v) : (v || []).map(x => (x && x.value != null ? x.value : '')).join(' · '));
// An attribute holds a value (any field besides the marketplace / language tags).
const clFilled = v => Array.isArray(v) && v.some(e => e && Object.keys(e).some(k => k !== 'marketplace_id' && k !== 'language_tag' && e[k] != null && e[k] !== '' && !(Array.isArray(e[k]) && !e[k].length)));
const clGroupOf = name => (CL_CONTENT.includes(name) ? 'Content' : CL_VARIATION.test(name) ? 'Variation' : CL_OFFER.test(name) ? 'Offer' : CL_SHIP.test(name) ? 'Shipping' : 'Basics');
const clOne = v => ({ value: v, language_tag: 'en_US' });

/* ============================================================================================
 * 1. THE DRAFT (IndexedDB, this browser only)
 * ============================================================================================ */
function clIdb() {
  const open = () => new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
    const rq = indexedDB.open(CL_DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(CL_DB_STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => { const tx = db.transaction(CL_DB_STORE, mode); const st = tx.objectStore(CL_DB_STORE); const rq = fn(st); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }));
  return { get: () => run('readonly', st => st.get(CL_DB_KEY)), put: v => run('readwrite', st => st.put(v, CL_DB_KEY)), del: () => run('readwrite', st => st.delete(CL_DB_KEY)) };
}
const clStore = () => CL_STORE || (CL_STORE = clIdb());
function clStoreUse(store) { CL_STORE = store; }
// What a draft keeps: the form and what was read for it (not the answers of a run).
const clDraftOf = () => { const d = JSON.parse(JSON.stringify(CL)); delete d.busy; delete d.amz; delete d.msg; d.savedAt = Date.now(); return d; };
async function clDraftSave() {
  try { await clStore().put(clDraftOf()); CL.savedAt = Date.now(); } catch (e) { /* private window: the form stays on screen */ }
}
// Saved a moment after the last keystroke.
function clDraftSoon() { clearTimeout(CL_SAVE_T); CL_SAVE_T = setTimeout(clDraftSave, 600); }
async function clDraftLoad() {
  let d = null;
  try { d = await clStore().get(); } catch (e) { d = null; }
  if (d && typeof d === 'object') { CL = Object.assign(clBlank(), d, { busy: '', amz: null, msg: `Draft restored (saved ${new Date(d.savedAt || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}).` }); return true; }
  return false;
}
async function clDraftClear() {
  try { await clStore().del(); } catch (e) { /* nothing kept */ }
  const brand = CL.brand;
  CL = clBlank();
  CL.brand = brand;
  CL.msg = 'Draft cleared.';
  clDraw();
}

/* ============================================================================================
 * 2. START: clone a SKU (or a research record — none kept yet)
 * ============================================================================================ */
// The research / costing records Sellora keeps for new products (none yet: the option is greyed out, never invented).
const clResearch = () => (typeof RESEARCH_SAVED !== 'undefined' && Array.isArray(RESEARCH_SAVED) ? RESEARCH_SAVED : []);
/** Clone from the ListingMatch cache: product type, parent, theme, the variation and content values, the attributes it holds. */
function clClone(srcSku) {
  const b = CL.brand;
  const sku = String(srcSku || '').trim();
  const m = typeof lmGet === 'function' ? lmGet(sku, b) : null;
  if (!m) { CL.msg = `${sku || 'That SKU'} is not in the auto refresh data of ${b === 'CPC' ? 'CPC' : 'Ridhi'} — check the brand and the SKU.`; return false; }
  const va = m.va || {};
  const attrs = {};
  Object.keys(va).forEach(k => { if (va[k]) attrs[k] = [clOne(va[k])]; });
  if (m.itk) attrs.item_type_keyword = [clOne(m.itk)];
  Object.assign(CL, { src: sku, srcTitle: m.t || '', pt: m.pt || '', parentSku: m.psku || '', parentAsin: ((m.cat && m.cat.pa) || [])[0] || '', theme: m.theme || '', attrs, readAll: false,
    srcColour: va.color || '', srcSize: va.size || '', title: m.t || '', bullets: (m.bl || []).concat(['', '', '', '', '']).slice(0, Math.max(5, (m.bl || []).length)), desc: m.d || '', kw: m.kw || '',
    colour: '', size: '', sku: '', amz: null, sent: null, ai: {}, schema: CL.schema && CL.schema.pt === m.pt ? CL.schema : null,
    msg: `Copied from ${sku}: product type ${m.pt || '—'}${m.psku ? ', parent ' + m.psku : ''}${m.theme ? ', theme ' + m.theme : ''}. Type the new SKU, its colour / size and price — or read every attribute from Amazon.` });
  clDraftSoon();
  return true;
}
/** "Read every attribute from Amazon" (a click): the source listing's whole attribute set (?lfix=get) — not its pictures, not its product id. */
async function clReadAll() {
  if (!CL.src || typeof baCall !== 'function') return null;
  CL.busy = 'read';
  clDraw();
  try {
    const r = await baCall({ lfix: 'get', brand: CL.brand, sku: CL.src });
    const attrs = {};
    Object.keys(r.attributes || {}).forEach(k => { if (!CL_NEVER_COPY.test(k)) attrs[k] = JSON.parse(JSON.stringify(r.attributes[k])); });
    CL.attrs = attrs;
    CL.readAll = true;
    if (r.productType) CL.pt = r.productType;
    CL.msg = `Read ${Object.keys(attrs).length} attributes of ${CL.src} from Amazon (pictures and the product identifier are not copied).`;
  } catch (e) { CL.msg = 'Could not read it from Amazon: ' + String((e && e.message) || e); }
  CL.busy = '';
  clDraftSoon();
  clDraw();
  return CL.attrs;
}

/* ============================================================================================
 * 3. THE REQUIRED FIELDS (the existing ?lfix=schema: its required list, then each one's shape)
 * ============================================================================================ */
async function clSchemaRead() {
  if (!CL.pt || typeof baCall !== 'function') return null;
  CL.busy = 'schema';
  clDraw();
  try {
    // a name never asked before makes the backend read the product type's schema once — its answer carries the required list
    const first = await baCall({ lfix: 'schema', brand: CL.brand, pt: CL.pt, attrs: 'zz_sellora_required_' + Date.now().toString(36) });
    const required = ((first.attrs || {})._required || []).filter(n => typeof n === 'string');
    const shapes = {};
    for (let i = 0; i < required.length; i += 20) {
      const r = await baCall({ lfix: 'schema', brand: CL.brand, pt: CL.pt, attrs: required.slice(i, i + 20).join(',') });
      Object.assign(shapes, r.attrs || {});
    }
    delete shapes._required;
    CL.schema = { pt: CL.pt, brand: CL.brand, required, shapes, at: Date.now() };
    CL.msg = required.length ? `Amazon asks ${required.length} fields for ${CL.pt}.` : `Amazon named no required field for ${CL.pt}.`;
  } catch (e) { CL.msg = 'Could not read the required fields: ' + String((e && e.message) || e); }
  CL.busy = '';
  clDraftSoon();
  clDraw();
  return CL.schema;
}
// A field with one simple value (text / a list of allowed values): typed here. Others keep the clone's value.
function clSimple(shape) {
  const f = ((shape && shape.fields) || []).filter(x => !/\./.test(x.field));
  return f.length === 1 && f[0].field === 'value' ? f[0] : null;
}
/** The attributes the new listing is sent with: the clone's, then the person's own values, the content, variation and offer. */
function clAttributes() {
  const a = JSON.parse(JSON.stringify(CL.attrs || {}));
  Object.keys(a).forEach(k => { if (CL_NEVER_COPY.test(k) && k !== 'externally_assigned_product_identifier') delete a[k]; });
  Object.entries(CL.fields || {}).forEach(([k, v]) => { if (String(v).trim()) a[k] = k === 'externally_assigned_product_identifier' ? [{ type: 'upc', value: String(v).trim() }] : [clOne(String(v).trim())]; });
  if (CL.title) a.item_name = [clOne(CL.title)];
  const bl = (CL.bullets || []).map(s => String(s).trim()).filter(Boolean);
  if (bl.length) a.bullet_point = bl.map(clOne);
  if (CL.desc) a.product_description = [clOne(CL.desc)];
  if (CL.kw) a.generic_keyword = [clOne(CL.kw)];
  if (CL.colour) a.color = [clOne(CL.colour)];
  if (CL.size) a.size = [clOne(CL.size)];
  if (CL.parentSku) {
    a.parentage_level = [{ value: 'child' }];
    a.child_parent_sku_relationship = [{ child_relationship_type: 'variation', parent_sku: CL.parentSku }];
    if (CL.theme) a.variation_theme = [{ name: CL.theme }];
  }
  const price = Number(CL.price);
  if (price > 0) a.purchasable_offer = [{ currency: 'USD', our_price: [{ schedule: [{ value_with_tax: Math.round(price * 100) / 100 }] }] }];
  if (!a.condition_type) a.condition_type = [{ value: 'new_new' }];
  return a;
}
// The required fields and where each one stands: [{ name, title, group, filled, simple }].
function clRequired() {
  if (!CL.schema) return [];
  const a = clAttributes();
  return CL.schema.required.map(name => {
    const shape = CL.schema.shapes[name] || {};
    return { name, title: shape.title || name, group: clGroupOf(name), filled: clFilled(a[name]), simple: clSimple(shape), shape };
  });
}

/* ============================================================================================
 * 4. OUR RULES ON THE CONTENT (the shared aiCheck — one place, no copies)
 * ============================================================================================ */
/** The rules' view of the new listing: judged as the listing it is cloned from, with its own SKU, title, colour and size. */
function clCtx() {
  const b = CL.brand, sku = CL.sku || 'NEW-SKU';
  const c = typeof aiCtx === 'function' ? aiCtx(b, CL.src || sku) : { brand: b, sku, cfg: (typeof LR !== 'undefined' && LR) || LR_DEFAULT, rows: false, facts: {}, now: {} };
  const srcRow = ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).find(r => r.sku === CL.src) || null;
  const row = Object.assign({}, srcRow || {}, { brand: b, sku, title: CL.title, shownTitle: CL.title, submittedTitle: CL.title, qty: null,
    content: Object.assign({}, (srcRow && srcRow.content) || {}, { title: CL.title, titleLen: CL.title.length }) });
  delete row._h;
  return Object.assign(c, { sku, row, fresh: row, rows: !!(c.rows && srcRow), pt: CL.pt, asin: '',
    now: { title: CL.title, bullets: CL.bullets.slice(), desc: CL.desc, kw: CL.kw, hl: [] },
    facts: Object.assign({}, c.facts || {}, CL.colour ? { colour: CL.colour } : {}, CL.size ? { size: CL.size } : {}) });
}
// The new listing in the catalogue while it is judged (the title template is matched by the catalogue's sub-category), then out again.
function clWithCat(fn) {
  const b = CL.brand, sku = CL.sku || 'NEW-SKU';
  const cats = typeof LR_CAT !== 'undefined' ? LR_CAT : null;
  const src = cats && cats[b] && cats[b][CL.src];
  if (!cats || !src) return fn();
  const had = Object.prototype.hasOwnProperty.call(cats[b], sku);
  const was = cats[b][sku];
  cats[b][sku] = Object.assign({}, src, CL.colour ? { color: CL.colour } : {}, CL.size ? { size: CL.size } : {});
  try { return fn(); } finally { if (had) cats[b][sku] = was; else delete cats[b][sku]; }
}
// The protected words a new title keeps: the clone's (its brand, product, shape, material, print) with the new colour and size.
function clKeep(c) {
  if (typeof aiProtected !== 'function') return [];
  const base = aiProtected(CL.srcTitle || '', 'title', c.facts).filter(p => p.cls !== 'colour' && p.cls !== 'size');
  if (CL.colour) base.push({ text: CL.colour, cls: 'colour', keys: CL.colour.split(/\s+/).map(w => (typeof lrSwKey === 'function' ? lrSwKey(w) : w.toLowerCase())).filter(Boolean) });
  if (CL.size) base.push({ text: CL.size, cls: 'size', keys: [] });
  return base;
}
const clTidy = list => list.map(f => String(f).replace(/^(still|would add): /, ''));
/** The four content fields judged: { title, bullets, desc, kw } — each { pass, fails, notes }. */
function clChecks() {
  if (typeof aiCheck !== 'function') return { title: { pass: false, fails: ['the rules are not loaded'], notes: [] }, bullets: { pass: true, fails: [], notes: [] }, desc: { pass: true, fails: [], notes: [] }, kw: { pass: true, fails: [], notes: [] } };
  return clWithCat(() => {
    const c = clCtx();
    const out = {
      title: aiCheck(c, 'title', CL.title, { keep: clKeep(c) }),
      bullets: aiCheck(c, 'bullets', CL.bullets.map(s => String(s).trim()).filter(Boolean)),
      desc: aiCheck(c, 'desc', CL.desc),
      kw: aiCheck(c, 'kw', CL.kw),
    };
    Object.values(out).forEach(x => { x.fails = clTidy(x.fails); });
    return out;
  });
}
// A failed check's priority (listing-priority.js), as if the listing were live: a trademark is Critical, a broken rule Important.
function clPrio(fails, field) {
  if (typeof prLevel !== 'function' || !fails.length) return '';
  const keys = [];
  if (fails.some(f => /another brand|risky word/i.test(f))) keys.push('tm');
  if (field === 'title') keys.push('title_template');
  if (field === 'kw' && fails.some(f => /bytes/.test(f))) keys.push('keyword_bytes');
  return typeof prChipHtml === 'function' ? prChipHtml(prLevel({ stock: null, live: true, problems: keys })) : '';
}

/* ============================================================================================
 * 5. THE PRE-SUBMIT CHECK — ours (all must pass) and Amazon's
 * ============================================================================================ */
function clPreSubmit() {
  const out = [];
  const add = (ok, t, why) => out.push({ ok: !!ok, t, why: why || '' });
  const all = ['SP', 'CPC'].flatMap(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).map(r => r.sku));
  const taken = CL.sku && (all.includes(CL.sku) || (typeof lmGet === 'function' && !!lmGet(CL.sku)));
  add(CL.sku && CL_SKU_RE.test(CL.sku) && !taken, 'A new SKU', !CL.sku ? 'type the new SKU' : !CL_SKU_RE.test(CL.sku) ? 'letters, numbers, . _ - / only, at most 40' : taken ? `${CL.sku} is already a listing of ours` : '');
  add(!!CL.pt, 'The product type', CL.pt ? '' : 'clone a SKU first');
  add(Number(CL.price) > 0, 'A price', Number(CL.price) > 0 ? '' : 'type the price in US dollars');
  if (CL.parentSku) {
    const sib = ['SP', 'CPC'].flatMap(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).filter(r => r.parent && r.parent === CL.parentAsin).map(r => lmGet && lmGet(r.sku, b)).filter(Boolean));
    const same = sib.find(m => String((m.va || {}).color || '').toLowerCase() === CL.colour.toLowerCase() && String((m.va || {}).size || '').toLowerCase() === CL.size.toLowerCase());
    add((CL.colour || CL.size) && !same, 'Its own colour / size in the family', !(CL.colour || CL.size) ? 'type the new colour or size' : same ? `${same.sku} already has this colour and size` : '');
  }
  const req = clRequired();
  const miss = req.filter(r => !r.filled);
  add(!!CL.schema && !miss.length, 'Every required field filled', !CL.schema ? 'read the required fields first' : miss.length ? `${miss.length} missing: ${miss.slice(0, 6).map(r => r.title).join(', ')}` : '');
  const chk = clChecks();
  [['title', 'The title passes our title rules'], ['bullets', 'The bullets pass'], ['desc', 'The description passes'], ['kw', 'The search terms pass']].forEach(([k, t]) => add(chk[k].pass, t, chk[k].fails.join(' · ')));
  return { checks: out, pass: out.every(x => x.ok), chk };
}
/** "Check with Amazon": Amazon's VALIDATION_PREVIEW of the whole new listing (nothing is created). The test site cannot ask. */
async function clAmazonCheck() {
  if (clTestSite()) { CL.amz = { test: true, text: 'Amazon check runs on live Sellora' }; clDraw(); return CL.amz; }
  if (typeof imPost !== 'function') return null;
  CL.busy = 'amz';
  clDraw();
  let r;
  try { r = await imPost({ lcreate: 'put', brand: CL.brand, sku: CL.sku, productType: CL.pt, attributes: clAttributes(), apply: false, by: (typeof ME !== 'undefined' && ME && ME.email) || '' }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
  if (r && /Unknown POST action/i.test(String(r.error || ''))) r.error = 'The backend has no Create Listing yet — ListingCreate.gs and its Code.gs line are not deployed';
  CL.amz = r && r.ok ? { ok: true, text: '✓ Amazon will accept it' + ((r.issues || []).length ? ` (${r.issues.length} warning${r.issues.length === 1 ? '' : 's'}: ${r.issues.map(i => i.message).slice(0, 3).join(' · ')})` : '') }
    : { ok: false, text: '✕ Amazon says no: ' + (typeof sqPlain === 'function' ? sqPlain(String((r && r.error) || 'no answer').replace(/^Amazon would reject this:\s*/i, '')) : String((r && r.error) || '')) };
  CL.busy = '';
  clDraw();
  return CL.amz;
}
/** Create: THE ONE SEND PATH — Amazon's check → the person approves → send → read again → Listing History "Created". */
function clCreate() {
  const pre = clPreSubmit();
  if (!pre.pass || clTestSite() || typeof sqSendWithCheck !== 'function') return null;
  const job = { brand: CL.brand, sku: CL.sku, asin: '', label: CL.title || CL.sku,
    body: { lcreate: 'put', brand: CL.brand, sku: CL.sku, productType: CL.pt, attributes: clAttributes() },
    changes: [{ field: 'Created', old: '', new: CL.title, attr: '' }] };
  if (typeof aiWasUsed === 'function' && CL.aiUsed && CL.aiUsed.length) CL.aiUsed.forEach(t => typeof aiMarkUsed === 'function' && aiMarkUsed(CL.brand, CL.sku, t));
  return sqSendWithCheck([job], { screen: CL_SCREEN, title: `${CL_SCREEN} · ${CL.sku}`, onDone: sum => {
    const j = (sum.jobs || [])[0] || {};
    CL.sent = { state: j.state || '', why: j.why || '', at: Date.now(), sku: CL.sku };
    clDraftSoon();
    clDraw();
  } });
}
/** A new SKU cannot be put back: "Close this listing" — quantity 0, through the same send path (Amazon's check first). */
function clClose() {
  if (!CL.sent || !CL.sent.sku || clTestSite() || typeof sqSendWithCheck !== 'function') return null;
  return sqSendWithCheck([{ brand: CL.brand, sku: CL.sent.sku, asin: '', label: CL.title || CL.sent.sku,
    body: { lfix: 'patch', brand: CL.brand, sku: CL.sent.sku, productType: CL.pt, patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 0 }] }] },
    changes: [{ field: 'Closed (quantity 0)', old: '', new: '0', attr: 'fulfillment_availability' }] }], { screen: CL_SCREEN, title: `Close · ${CL.sent.sku}` });
}

/* ============================================================================================
 * 6. ✨ AI WRITE — the shared aiAsk, the approved house style (hidden until AI is set up)
 * ============================================================================================ */
async function clAiWrite() {
  if (typeof aiAsk !== 'function' || typeof aiOn !== 'function' || !aiOn() || !CL.src) return null;
  CL.busy = 'ai';
  clDraw();
  const c = clWithCat(() => clCtx());
  const words = clKeep(c).map(p => p.text);
  const avoid = typeof aiAvoid === 'function' ? aiAvoid(c) : [];
  const style = typeof aiStyleParam === 'function' ? aiStyleParam(CL.pt) : '';
  const base = { words, avoid, style, newsku: CL.sku || 'NEW', colour: CL.colour, size: CL.size };
  let tpl = '';
  try { const t = typeof lrTemplateFor === 'function' ? lrTemplateFor(Object.assign({}, c.row, { sku: CL.src }), c.cfg) : null; tpl = t && t.template ? t.template : ''; } catch (e) { tpl = ''; }
  CL.ai = {};
  for (const [task, field] of [['title', 'title'], ['bullets', 'bullets'], ['description', 'desc'], ['kw', 'kw']]) {
    // search terms: the winning words of its product type go with the question (kw-win.js — none without fresh Brand Analytics data)
    if (task === 'kw' && typeof kwLoad === 'function' && typeof KW !== 'undefined' && !KW.loaded) { try { await kwLoad(); } catch (e) { /* asked without them */ } }
    const extra = task === 'title' ? { max: 75, tpl } : task === 'kw' ? { max: typeof lrKwMax === 'function' ? lrKwMax(c.cfg) : 249, win: typeof aiWinWords === 'function' ? aiWinWords(c, CL.kw).slice(0, 25).map(e => e.w) : [] } : {};
    const r = await aiAsk(task, CL.brand, CL.src, Object.assign({}, base, extra));
    if (!r.ok) { CL.ai[field] = { err: r.reason }; if (/not set up|limit reached/i.test(r.reason || '')) break; continue; }
    const v = r.result || {};
    // search terms: our one rule runs on the answer first (repeats, other brands, title words it added, the limit) — listing-ai.js aiKwClean
    const kwClean = task === 'kw' && typeof aiKwClean === 'function' ? aiKwClean(c, v.kw, CL.kw) : null;
    CL.ai[field] = { text: task === 'title' ? v.title : task === 'bullets' ? (v.bullets || []) : task === 'description' ? v.description : kwClean ? kwClean.text : v.kw, style: r.style || null, cost: r.costUsd,
      cleaned: kwClean ? kwClean.removed : [], putBack: kwClean ? kwClean.putBack || [] : [] };
  }
  CL.busy = '';
  clDraw();
  return CL.ai;
}
// A suggestion judged by the same rules as the field (it can be used only when it passes).
function clAiCheck(field) {
  const s = CL.ai[field];
  if (!s || s.err) return null;
  const was = { title: CL.title, bullets: CL.bullets, desc: CL.desc, kw: CL.kw };
  Object.assign(CL, { [field === 'title' ? 'title' : field === 'bullets' ? 'bullets' : field === 'desc' ? 'desc' : 'kw']: field === 'bullets' ? (s.text || []).concat(['', '', '', '', '']).slice(0, 5) : s.text });
  const r = clChecks()[field];
  Object.assign(CL, was);
  return r;
}
function clAiUse(field) {
  const s = CL.ai[field];
  const chk = clAiCheck(field);
  if (!s || !chk || !chk.pass) return null;
  if (field === 'bullets') CL.bullets = (s.text || []).concat(['', '', '', '', '']).slice(0, Math.max(5, (s.text || []).length));
  else CL[field] = s.text;
  CL.aiUsed = (CL.aiUsed || []).concat([Array.isArray(s.text) ? s.text.join(' · ') : s.text]);
  clDraftSoon();
  clDraw();
  return true;
}

/* ============================================================================================
 * 7. THE SCREEN
 * ============================================================================================ */
const clChip = (ok, t) => `<span class="cl-st ${ok ? 'is-ok' : 'is-no'}">${ok ? '✓' : '✕'} ${clEsc(t)}</span>`;
const clChkHtml = (r, field) => (r ? (r.pass ? '<div class="tt-chk">✓ Passes every rule we check</div>' : `<div class="tt-chk is-bad">${clPrio(r.fails, field)} ✕ ${clEsc(r.fails.join(' · '))}</div>`)
  + (r.notes && r.notes.length ? `<div class="ai-note">• ${clEsc(r.notes.join(' · '))}</div>` : '') : '');
function clAiHtml(field) {
  const s = CL.ai[field];
  if (!s) return '';
  if (s.err) return `<div class="ai-quiet">✨ ${clEsc(s.err)}</div>`;
  const chk = clAiCheck(field);
  const text = Array.isArray(s.text) ? s.text.map((b, i) => `${i + 1}. ${b}`).join('\n') : s.text;
  const line = typeof aiStyleLine === 'function' ? aiStyleLine({ reply: { style: s.style } }) : '';
  return `<div class="ai-card cl-ai"><div class="ai-h"><b>✨ AI suggestion</b></div><div class="tt-new ai-txt">${clEsc(text)}</div>${clChkHtml(chk, field)}`
    + `<div class="ai-a"><button type="button" class="sp-main" data-cl="aiuse" data-cl-f="${field}"${chk && chk.pass ? '' : ' disabled'}>Use it</button></div><div class="ai-foot muted">${clEsc(line)}</div></div>`;
}
function clDraw() {
  const box = typeof $ === 'function' ? $('clPane') : null;
  if (!box) return;
  const test = clTestSite();
  const pre = clPreSubmit();
  const chk = pre.chk;
  const req = clRequired();
  const research = clResearch();
  const brandSel = `<select data-cl-in="brand" aria-label="Brand">${['SP', 'CPC'].map(b => `<option value="${b}"${CL.brand === b ? ' selected' : ''}>${b === 'CPC' ? 'CPC' : 'Ridhi'}</option>`).join('')}</select>`;
  const input = (key, val, ph, w) => `<input data-cl-in="${key}" value="${clEsc(val)}" placeholder="${clEsc(ph || '')}" style="width:${w || 180}px">`;
  const card = (title, body, sub) => `<div class="card cl-card" style="padding:10px 14px;margin-bottom:10px"><div style="font-weight:600;font-size:13px;margin-bottom:6px">${title}${sub ? ` <span class="muted" style="font-weight:400;font-size:11.5px">${sub}</span>` : ''}</div>${body}</div>`;
  // --- the top line ---
  const head = `<div class="card cl-card" style="padding:10px 14px;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">`
    + `<b style="font-size:14px">Create Listing</b><span class="muted" style="font-size:12px">A new SKU on Amazon — checked by our rules and by Amazon first; nothing is sent until you approve it.</span>`
    + `<span style="margin-left:auto;display:flex;gap:8px;align-items:center">${brandSel}<button type="button" class="ghost im-b" data-cl="clear">Clear draft</button></span>`
    + (CL.msg ? `<div class="muted" style="flex-basis:100%;font-size:12px">${clEsc(CL.msg)}</div>` : '') + '</div>';
  // --- start ---
  const start = card('1 · Start', `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">`
    + `<div><div style="font-size:12.5px;font-weight:600">Clone an existing SKU</div><div class="muted" style="font-size:11.5px;margin-bottom:4px">A new colour or size in a family: copies its product type, parent, theme and attributes.</div>`
    + `${input('src', CL.src, 'SKU to copy, e.g. RTC14-1')} <button type="button" class="ghost im-b" data-cl="clone">Copy from this SKU</button>`
    + (CL.src && CL.pt ? ` <button type="button" class="ghost im-b" data-cl="readall"${CL.busy === 'read' ? ' disabled' : ''}>${CL.busy === 'read' ? 'Reading…' : CL.readAll ? 'Read again from Amazon' : 'Read every attribute from Amazon'}</button>` : '') + '</div>'
    + `<div><div style="font-size:12.5px;font-weight:600">From a Research product</div>`
    + (research.length ? `<select data-cl-in="research">${research.map((r, i) => `<option value="${i}">${clEsc(r.name || r.title || 'Research ' + (i + 1))}</option>`).join('')}</select>`
      : '<button type="button" class="ghost im-b" disabled title="Sellora keeps no saved research or costing record yet">No research records yet</button>') + '</div></div>');
  // --- the new listing ---
  const newer = card('2 · The new listing', `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;font-size:12.5px">`
    + `<label>New SKU<br>${input('sku', CL.sku, 'e.g. RTC14-9')}</label><label>Colour<br>${input('colour', CL.colour, CL.srcColour ? 'was ' + CL.srcColour : 'colour', 160)}</label>`
    + `<label>Size<br>${input('size', CL.size, CL.srcSize ? 'was ' + CL.srcSize : 'size', 120)}</label><label>Price (US $)<br>${input('price', CL.price, '0.00', 90)}</label></div>`
    + `<div class="muted" style="font-size:11.5px;margin-top:6px">Product type <b>${clEsc(CL.pt || '—')}</b> · parent <b>${clEsc(CL.parentSku || '—')}</b>${CL.parentAsin ? ' (' + clEsc(CL.parentAsin) + ')' : ''} · theme <b>${clEsc(CL.theme || '—')}</b>${CL.src ? ' · cloned from ' + clEsc(CL.src) : ''}</div>`);
  // --- the required fields ---
  const groups = CL_GROUPS.map(g => {
    const list = req.filter(r => r.group === g);
    if (!list.length) return '';
    return `<div class="cl-g"><div class="cl-gh">${g} <span class="muted">${list.filter(r => r.filled).length} of ${list.length} filled</span></div>`
      + list.map(r => `<div class="cl-f">${clChip(r.filled, r.filled ? 'Filled' : 'Missing')} <b>${clEsc(r.title)}</b> <span class="muted ui-mono">${clEsc(r.name)}</span>`
        + (r.simple && !CL_CONTENT.includes(r.name) && !['color', 'size'].includes(r.name) ? ' ' + (r.simple.enum ? `<select data-cl-field="${clEsc(r.name)}"><option value="">—</option>${r.simple.enum.slice(0, 200).map((v, i) => `<option value="${clEsc(v)}"${String(CL.fields[r.name] || clVal((CL.attrs || {})[r.name])) === String(v) ? ' selected' : ''}>${clEsc((r.simple.enumNames || [])[i] || v)}</option>`).join('')}</select>`
          : `<input data-cl-field="${clEsc(r.name)}" value="${clEsc(CL.fields[r.name] != null ? CL.fields[r.name] : clVal((CL.attrs || {})[r.name]))}" style="width:220px">`)
          : r.name === 'externally_assigned_product_identifier' ? ` <input data-cl-field="${clEsc(r.name)}" value="${clEsc(CL.fields[r.name] || '')}" placeholder="the new listing's own UPC" style="width:160px">`
            : r.filled ? ` <span class="muted">${clEsc(clVal(clAttributes()[r.name]).slice(0, 80))}</span>` : ' <span class="muted">— from the clone, Amazon\'s read, or the content below</span>') + '</div>').join('') + '</div>';
  }).join('');
  const reqNames = new Set((CL.schema && CL.schema.required) || []);
  const extra = Object.keys(clAttributes()).filter(n => !reqNames.has(n));
  const reqCard = card('3 · Required fields', CL.schema
    ? groups + (extra.length ? `<details class="cl-more"><summary>Good to fill (${extra.length})</summary><div class="muted" style="font-size:12px">${extra.map(n => clEsc(n)).join(', ')}</div></details>` : '')
    : `<button type="button" class="ghost im-b" data-cl="schema"${CL.pt && CL.busy !== 'schema' ? '' : ' disabled'}>${CL.busy === 'schema' ? 'Reading…' : 'Read the required fields'}</button> <span class="muted" style="font-size:12px">${CL.pt ? 'From Amazon\'s schema for ' + clEsc(CL.pt) + ' (kept with the draft).' : 'Clone a SKU first.'}</span>`,
    CL.schema ? `${req.filter(r => r.filled).length} of ${req.length} filled` : '');
  // --- the content ---
  const aiBtn = typeof aiOn === 'function' && aiOn() && CL.src ? ` <button type="button" class="ghost im-b ai-btn" data-cl="ai"${CL.busy === 'ai' ? ' disabled' : ''}>${CL.busy === 'ai' ? '✨ Writing…' : '✨ AI write'}</button>` : '';
  const content = card('4 · Content' + aiBtn,
    `<div class="cl-c"><b>Title</b> <span class="muted">${CL.title.length} characters</span><textarea data-cl-in="title" rows="2" style="width:100%">${clEsc(CL.title)}</textarea>${clChkHtml(chk.title, 'title')}${clAiHtml('title')}</div>`
    + `<div class="cl-c"><b>Bullet points</b>${CL.bullets.map((b, i) => `<textarea data-cl-in="bullet" data-cl-i="${i}" rows="2" style="width:100%">${clEsc(b)}</textarea>`).join('')}${clChkHtml(chk.bullets, 'bullets')}${clAiHtml('bullets')}</div>`
    + `<div class="cl-c"><b>Description</b> <span class="muted">${CL.desc.length} characters</span><textarea data-cl-in="desc" rows="4" style="width:100%">${clEsc(CL.desc)}</textarea>${clChkHtml(chk.desc, 'desc')}${clAiHtml('desc')}</div>`
    + `<div class="cl-c"><b>Search terms</b> <span class="muted">${typeof lrKwBytes === 'function' ? lrKwBytes(CL.kw) : CL.kw.length} bytes of words</span> <button type="button" class="ghost im-b" data-cl="kwsug" title="Our word rules on the text in the box, and the winning words of its product type added when they fit">Suggest search terms</button><textarea data-cl-in="kw" rows="2" style="width:100%">${clEsc(CL.kw)}</textarea>${clKwNoteHtml()}${clChkHtml(chk.kw, 'kw')}${clAiHtml('kw')}</div>`,
    'checked by the same rules as every suggestion');
  // --- the pre-submit check and Create ---
  const amz = CL.amz ? `<div class="cl-amz ${CL.amz.test ? 'muted' : CL.amz.ok ? 'is-ok' : 'err'}">${clEsc(CL.amz.text)}</div>` : '';
  const checks = card('5 · Pre-submit check', `<ul class="cl-checks">${pre.checks.map(x => `<li>${clChip(x.ok, x.t)}${x.why ? ` <span class="muted">— ${clEsc(x.why)}</span>` : ''}</li>`).join('')}</ul>`
    + `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><button type="button" class="ghost im-b" data-cl="amz"${pre.pass && CL.busy !== 'amz' ? '' : ' disabled'}>${CL.busy === 'amz' ? 'Checking…' : 'Check with Amazon'}</button>${amz}</div>`,
    pre.pass ? 'all our checks pass' : 'every one must pass');
  const after = CL.sent ? `<div style="margin-top:8px;font-size:12.5px">${CL.sent.state === 'accepted' ? '✅ Created on Amazon' : CL.sent.state === 'working' ? '⏳ Amazon is still working on it' : '✕ ' + clEsc(CL.sent.why || CL.sent.state)} — ${clEsc(CL.sent.sku)}</div>`
    + (CL.sent.state === 'accepted' || CL.sent.state === 'working' ? `<div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="ghost im-b" data-cl="pics">Add pictures in Image Manager</button><button type="button" class="ghost im-b" data-cl="close" title="A new SKU cannot be put back: this sets its quantity to 0, through Amazon's check">Close this listing</button></div>` : '') : '';
  const create = card('6 · Create', `<button type="button" data-cl="create" style="width:auto;padding:6px 14px"${pre.pass && !test ? '' : ' disabled'}>Create on Amazon</button> `
    + `<span class="muted" style="font-size:12px">${test ? 'Test site — not sent to Amazon. Creating runs on live Sellora only.' : 'Amazon checks it first; you see it and approve; then it is created and read again. Listing History keeps it ("Created").'}</span>${after}`);
  box.innerHTML = `<div class="cl-wrap">${head}${start}${newer}${reqCard}${content}${checks}${create}</div>`;
}

/* ----- the screen's typing and clicks ----- */
function clInput(el) {
  const k = el.dataset.clIn;
  if (k === 'brand') { CL.brand = el.value === 'CPC' ? 'CPC' : 'SP'; CL.schema = null; clDraftSoon(); return clDraw(); }
  if (k === 'bullet') CL.bullets[Number(el.dataset.clI) || 0] = el.value;
  else if (k) CL[k] = el.value;
  if (k === 'kw') CL.kwNote = null;          // the suggestion's note was about the text before this edit
  if (el.dataset.clField) CL.fields[el.dataset.clField] = el.value;
  clDraftSoon();
  // the checks follow at once; the box being typed in keeps its place (drawn again only when typing stops)
  clearTimeout(clInput.t);
  clInput.t = setTimeout(() => { const a = typeof document !== 'undefined' ? document.activeElement : null; const sel = a && a.dataset ? (a.dataset.clIn ? `[data-cl-in="${a.dataset.clIn}"]${a.dataset.clI ? `[data-cl-i="${a.dataset.clI}"]` : ''}` : a.dataset.clField ? `[data-cl-field="${a.dataset.clField}"]` : '') : ''; const pos = a && a.selectionStart; clDraw(); if (sel && document.querySelector) { const n = document.querySelector(sel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ } } } }, 500);
  return null;
}
/** SEARCH TERMS SUGGESTED (27 Nov 2026): THE ONE SUGGESTION-WORDS RULE (listing-rules.js lrSuggestWords) on the search terms in the box —
 *  our brands and important words kept once, every repeat and other brands' names out, the winning words of its product type added
 *  (kw-win.js: Brand Analytics, never a title word, never another brand), the 249-byte limit. Put in the box; the checks run on it. */
function clKwSuggest() {
  if (typeof lrSuggestWords !== 'function') return null;
  const r = clWithCat(() => {
    const c = clCtx();
    const max = typeof lrKwMax === 'function' ? lrKwMax(c.cfg) : 249;
    return lrSuggestWords(CL.kw, { mode: 'kw', facts: c.facts, title: CL.title, brands: typeof lrBrandWords === 'function' ? lrBrandWords(c.fresh, c.cfg) : [],
      others: typeof kwOthers === 'function' ? kwOthers(c.cfg) : [], add: typeof aiWinAll === 'function' ? aiWinAll(c, CL.kw).words : null, proof: typeof aiWinAll === 'function' ? aiWinAll(c, CL.kw).proof : null,
      risk: typeof ipgKwRisk === 'function' && CL.src ? ipgKwRisk(CL.brand, CL.src, c.fresh, c.cfg) : null, fits: t => !lrKwCheck(t, max).over });
  });
  if (!r.important) CL.kw = r.after;
  const why = w => (typeof kwWhyLabel === 'function' ? kwWhyLabel(w) : w);
  CL.kwNote = { added: r.added || [], removed: r.removed.map(x => ({ w: x.w, why: why(x.why) })), important: !!r.important, status: typeof kwStatus === 'function' ? kwStatus().text : '' };
  return r;
}
function clKwNoteHtml() {
  const n = CL.kwNote;
  if (!n) return '';
  const add = n.added.map(a => `<ins class="kf-add" title="${clEsc(a.why + (a.replaces && a.replaces.length ? ' — replaces ' + a.replaces.join(', ') + ' (no orders)' : ''))}">+ ${clEsc(a.w)}</ins>`).join(' ');
  const cut = n.removed.slice(0, 12).map(x => `<s>${clEsc(x.w)}</s> (${clEsc(x.why)})`).join(', ');
  return `<div class="cl-kwnote muted">${n.important ? clEsc(typeof LR_SW_IMPORTANT === 'string' ? LR_SW_IMPORTANT : 'Only important words left — edit by hand') + ' · ' : ''}${add ? 'Added: ' + add + ' · ' : ''}${cut ? 'Taken out: ' + cut + ' · ' : ''}🏆 ${clEsc(n.status)}</div>`;
}
function clClick(el) {
  const act = el.dataset.cl;
  if (act === 'kwsug') {
    return (async () => {
      if (typeof kwLoad === 'function' && typeof KW !== 'undefined' && !KW.loaded) { try { await kwLoad(); } catch (e) { /* the rule alone */ } }
      clKwSuggest();
      clDraw();
    })();
  }
  if (act === 'clone') { const v = (typeof document !== 'undefined' && document.querySelector && document.querySelector('[data-cl-in="src"]')) ? document.querySelector('[data-cl-in="src"]').value : CL.src; clClone(v); return clDraw(); }
  if (act === 'readall') return clReadAll();
  if (act === 'schema') return clSchemaRead();
  if (act === 'amz') return clAmazonCheck();
  if (act === 'create') return clCreate();
  if (act === 'close') return clClose();
  if (act === 'pics') return typeof lrFixOpen === 'function' && CL.sent ? lrFixOpen('img', CL.brand, CL.sent.sku, []) : null;
  if (act === 'clear') return clDraftClear();
  if (act === 'ai') return clAiWrite();
  if (act === 'aiuse') return clAiUse(el.dataset.clF);
  return null;
}
/** Opening the screen: the draft kept in this browser comes back; nothing is read from Amazon or asked of the AI. */
async function clOpen() {
  if (!clOpen.done) { clOpen.done = true; await clDraftLoad(); }
  clDraw();
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => { const el = e.target && e.target.closest ? e.target.closest('[data-cl]') : null; if (el && !el.disabled) clClick(el); });
  document.addEventListener('input', e => { if (e.target && e.target.dataset && (e.target.dataset.clIn !== undefined || e.target.dataset.clField !== undefined)) clInput(e.target); });
  document.addEventListener('change', e => { if (e.target && e.target.dataset && (e.target.dataset.clIn === 'brand' || e.target.dataset.clField !== undefined)) clInput(e.target); });
  const pane = typeof $ === 'function' ? $('paneCreate') : null;
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) clOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
}
