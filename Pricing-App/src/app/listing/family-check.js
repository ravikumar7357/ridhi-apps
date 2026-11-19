/* ================= LISTING · FAMILY & CATEGORY CHECK: children that left their family, and families that are built wrong (roadmap #4) =================
 * Screens: Listing → 2 · Check → Family & Category Check (tab 'fam', #paneFam, drawn whole into #fcPane). Two tabs: Families (this file)
 *       and Categories (category-check.js: fcDrawCat hands the tab to its ccDraw).
 * Who sees it: whoever has Listing Health (TAB_INHERIT fam: 'health' in core/nav.js); the saved marks are guarded by the listingrules rule
 *       (can('health') || can('lrules')), the same as the Listing Health data.
 * EVERY FLAG COMES FROM AMAZON'S OWN DATA — nothing is guessed:
 *   • Amazon's catalog, ?lfix=cat (Catalog Items, includedData=relationships,attributes; up to 20 ASINs a call): which parent ASIN Amazon
 *     shows for each child, the parent's variationTheme (the theme and its attribute names) and child ASINs, and each child's catalog value
 *     for every theme attribute. Read when a family is opened, for every family in the background after the page opens (2 calls at most,
 *     paused while a family is open), and again on "Read again"; kept in this browser (localStorage fcCat1, FC_CAT_DAYS).
 *   • Amazon's issues on each SKU (Listings API, in the Image Manager snapshot: IML[brand].items[].iss — code, message, attributes).
 * What Sellora's own data still does: which listings are live (RULE 1: status BUYABLE in the Image Manager snapshot AND stock > 0 in the
 *       Listing Health snapshot), how families are grouped on the page (our parent SKU / ASIN), and the SKU guess — shown ONLY as "Suggested
 *       family" (it picks which parentless listings to ask Amazon about; Amazon decides the flag).
 * FLAGS (live children only; anything Amazon has not answered yet is a grey "not read", never an error):
 *   Not in family (red) — Amazon's catalog shows NO parent for the child.
 *   Duplicate (red)     — an Amazon issue says duplicate variation, OR two live children of the same Amazon parent have equal catalog values on
 *                         ALL the theme's attributes.
 *   Missing value (red) — an Amazon issue says a variation value is missing, OR the catalog value of a theme attribute is empty.
 *   Different theme (yellow) — an Amazon issue about the variation theme.
 *   Each problem says where it came from and when: "Amazon catalog · read 10 min ago" / "Amazon issue 8541 · read 3 h ago".
 * Removed on purpose: the team's mark (reason, default "low rating"), saved with who / when / reason in listingrules/famok_<brand>; marked
 *       children never show as errors again; "N removed on purpose › Show" (with Undo). A rating below 4 (if Sellora ever holds ratings:
 *       fcRating) counts as removed on purpose by itself. A child Amazon shows in a family again, or one that stops being live, leaves every list.
 * Fixes go through THE ONE SEND PATH (sqSendWithCheck → Listing History): Link to family (parentage_level, child_parent_sku_relationship,
 *       variation_theme — the theme read from the parent listing) and Set colour/size (the brand catalogue's value, only for a missing colour /
 *       size). Anything else is "Fix by hand" with Open in Listing Errors.
 * The list: every family one closed line; ONE family open at a time (fcToggle — the clicked line stays put, Esc closes it), its children drawn
 *       only then; ticks + the bar (Removed on purpose · Link to family · Open in Listing Errors).
 * Console: fcFamilyReport('Desk Organizer') — one family as Amazon returned it (theme, attributes, each child's values) and the card counts.
 * Main functions: fcBuild, fcProblems, fcCatTake, fcReadCat, fcReadAllCat, fcIssueKind, fcDrawAll, fcToggle, fcLinkMany, fcSetValue, fcOkSetMany,
 *       fcOkUndo, fcCsv, fcFamilyReport, fcOpen. */

const FC_STEP = 60;                                  // family lines drawn at a time; more as the list scrolls
const FC_INFLIGHT = 2;                               // Amazon calls out at once
const FC_CAT_BATCH = 20;                             // ASINs per ?lfix=cat call (the backend's cap)
const FC_CAT_DAYS = 14;                              // a kept catalog read is used this long
const FC_CAT_STORE = 'fcCat1';                       // this browser's copy of the catalog reads (localStorage)
const FC_CAT_MAX = 15000;                            // catalog records kept at most
const FC_READ_DAYS = 14;                             // a kept ?lfix=get read (before a fix) is used this long
const FC_STORE = 'fcReads1';
const FC_STORE_MAX = 8000;
const FC_OK_COLL = 'listingrules';                   // where the "removed on purpose" marks are saved (existing collection, existing rule)
const FC_OK_DOC = brand => 'famok_' + brand;
const FC_REASON = 'low rating';
const FC_RESALE = /^amzn\.gr\./i;                    // Amazon's own resale SKUs (Amazon Resale / Warehouse): never judged, only named in their ASIN's row
const FC_KINDS = [
  { k: 'orphan', t: 'Not in family', sev: 'r', tip: 'Live children Amazon\'s catalog shows with no parent.' },
  { k: 'dup', t: 'Duplicate', sev: 'r', tip: 'Amazon says duplicate variation, or two live children of one Amazon parent have the same values on every theme attribute.' },
  { k: 'missing', t: 'Missing value', sev: 'r', tip: 'Amazon says a variation value is missing, or the catalog value of a theme attribute is empty.' },
  { k: 'theme', t: 'Different theme', sev: 'y', tip: 'An Amazon issue about the variation theme.' },
];
let FC = { tab: 'fam', brand: 'ALL', q: '', card: '', built: false, loading: false, loaded: false, err: '', msg: '',
  cat: {}, catLoaded: false,    // Amazon's catalog per "brand|ASIN": { at, pa, kids?, theme?, tattrs?, vals?, nf? }
  got: {}, gotLoaded: false,    // ?lfix=get reads made right before a fix (the listing's own values, for the popup and Put back)
  ok: { SP: {}, CPC: {} }, okLoaded: false, okNote: '', showOk: false, ask: '', busy: new Set(), note: {},
  open: '',                     // the ONE open family (fk); '' = all closed
  sel: new Set(), bulkAsk: false, bulkReason: '', bulkMsg: '',   // the ticked rows ("brand|sku") and the bar's reason box
  limit: FC_STEP, order: null, io: null,                         // family lines drawn so far; the order they were first drawn in
  relinked: new Map(),          // "brand|sku" → fk: children Amazon accepted a Link to family for, this visit (the picture's "Relinked ✓")
  failed: new Set(),            // families whose catalog read failed this visit (fk): counted as asked, not saved
  refresh: { on: false, step: '', done: 0, total: 0, left: new Map(), at: 0 },   // the Refresh button's run ("Families 40 / 91")
  newer: false, newT: 0,        // a newer saved snapshot exists ("New data available — Refresh"); the 5-minute check
  reading: new Map(), reads: { q: [], inflight: 0, bgIn: 0, fails: 0 }, view: null, drawT: 0 };   // reading: fk → catalog calls still out
const fcEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
// SMOOTH (18 Nov 2026): one number format made once — the same text as toLocaleString('en-US'), which makes a new one per number
const FC_NUM = new Intl.NumberFormat('en-US');
const fcNf = n => FC_NUM.format(Number(n || 0));
const fcKey = (brand, sku) => brand + '|' + sku;
const fcNorm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const fcBrandName = b => (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[b]) || b;
const fcIsTest = () => typeof window !== 'undefined' && !!window.__TEST_ERP;
const fcWho = () => (typeof ME !== 'undefined' && ME && ME.email) || '';
const fcName = email => (typeof sqName === 'function' ? sqName(email) : String(email || '').split('@')[0]);
const fcAgo = ms => { if (!ms) return 'never'; const m = (Date.now() - ms) / 6e4; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
const fcWhen = at => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fcIsAsin = a => /^[A-Z0-9]{10}$/.test(String(a || ''));

/* ----- small rules ----- */
/** The SKU's family stem: "RTC14-7" → "RTC14", "R-CP-351" → "R-CP", "ABC12" → "ABC". '' when there is no clear one. */
function fcStem(sku) {
  const s = String(sku || '').trim().toUpperCase();
  const m = s.match(/^(.*[A-Z0-9])[-_ .]+[A-Z0-9]+$/);
  if (m && m[1].length >= 2) return m[1];
  const d = s.match(/^(.*?[A-Z])\d{1,3}$/);
  return d && d[1].length >= 3 ? d[1] : '';
}
const FC_STOP = new Set(['and', 'the', 'for', 'with', 'set', 'pack', 'inch', 'inches', 'cotton', 'ridhi', 'cpc', 'of', 'in']);
const fcWords = t => new Set(String(t || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3 && !FC_STOP.has(w)));
/** How alike two titles are: shared words / all words (0…1); null when either is missing. */
function fcAlike(a, b) {
  const A = fcWords(a), B = fcWords(b);
  if (!A.size || !B.size) return null;
  let both = 0;
  A.forEach(w => { if (B.has(w)) both++; });
  return both / (A.size + B.size - both);
}
/** A rating and review count, if Sellora's data ever holds one for this listing (none of today's snapshots do): { rating, reviews } or null. */
function fcRating(item, row) {
  for (const src of [item, row]) {
    if (!src) continue;
    const r = [src.rating, src.stars, src.rt].find(v => v != null && v !== '' && !isNaN(Number(v)));
    const n = [src.reviews, src.reviewCount, src.ratings, src.rc].find(v => v != null && v !== '' && !isNaN(Number(v)));
    if (r != null || n != null) return { rating: r == null ? null : Number(r), reviews: n == null ? 0 : Number(n) };
  }
  return null;
}
// Rating below 4 with at least one review: treated as removed on purpose. No rating, 0 reviews or 4 and above: an error.
const fcLowRated = rt => !!(rt && rt.rating != null && rt.reviews > 0 && rt.rating < 4);
/** What an Amazon issue (Listings API: { s, c, m, a }) says about the family: 'dup' | 'missing' | 'theme' | '' (not about variations). */
function fcIssueKind(i) {
  if (!i || !/^[EW]/i.test(String(i.s || ''))) return '';
  const text = String(i.m || ''), attrs = (i.a || []).join(' ');
  if (!/variation|parentage|child_parent/i.test(text + ' ' + attrs)) return '';
  if (/duplicate|already (exists|used|assigned|has)|same (variation|combination|values)|identical/i.test(text)) return 'dup';
  if (/missing|requir|must (be|have|include|contain|provide)|not provided|is empty|blank/i.test(text)) return 'missing';
  if (/theme/i.test(text + ' ' + attrs)) return 'theme';
  return '';
}
/** One catalog attribute's value as plain text ('' when empty): { value } entries, or the first non-marketplace field of an object. */
function fcAttrVal(list) {
  const e = (Array.isArray(list) ? list : [list]).find(x => x != null && x !== '');
  if (e == null) return '';
  if (typeof e !== 'object') return String(e).trim();
  if (e.value != null) return typeof e.value === 'object' ? fcAttrVal(e.value) : String(e.value).trim();
  const k = Object.keys(e).find(key => key !== 'marketplace_id' && key !== 'language_tag' && e[key] != null && e[key] !== '');
  return k ? (typeof e[k] === 'object' ? fcAttrVal(e[k]) : String(e[k]).trim()) : '';
}

/* ----- Amazon's catalog (?lfix=cat), kept in this browser ----- */
function fcCatLoad() {
  if (FC.catLoaded) return;
  FC.catLoaded = true;
  try {
    const data = JSON.parse(localStorage.getItem(FC_CAT_STORE) || 'null');
    const cut = Date.now() - FC_CAT_DAYS * 864e5;
    if (data && data.cat) Object.entries(data.cat).forEach(([k, v]) => { if (v && v.at > cut) FC.cat[k] = v; });
  } catch (e) { /* no storage: the reads live for this visit only */ }
}
function fcCatSave() {
  try {
    const all = Object.entries(FC.cat).sort((a, b) => b[1].at - a[1].at).slice(0, FC_CAT_MAX);
    localStorage.setItem(FC_CAT_STORE, JSON.stringify({ v: 1, cat: Object.fromEntries(all) }));
  } catch (e) { /* quota: the copy in memory still works */ }
}
// The newer of this browser's ?lfix=cat answer and the ListingMatch cache's catalog record (listing-match.js lmFcCat, while it is usable).
const fcCatOf = (brand, asin) => {
  if (!asin) return null;
  const own = FC.cat[fcKey(brand, asin)] || null;
  const lm = typeof lmFcCat === 'function' ? lmFcCat(brand, asin) : null;
  return lm && !(own && own.at >= lm.at) ? lm : own;
};
/** One ?lfix=cat answer into FC.cat. A parent keeps its child ASINs, theme and theme attributes; a child its Amazon parent and its values for
 *  the theme's attributes (known from a parent in the same answer or one kept before). An ASIN asked but not returned: { nf: 1 }. */
function fcCatTake(brand, asked, items, hintPa) {
  const now = Date.now();
  const recs = (items || []).map(it => {
    const rels = [];
    (it.relationships || []).forEach(block => (block.relationships || []).forEach(r => rels.push(r)));
    const r = { asin: it.asin, pa: '', kids: null, theme: '', tattrs: null, attrs: it.attributes || {} };
    rels.forEach(rel => {
      if (!r.pa && (rel.parentAsins || []).length) r.pa = rel.parentAsins[0];
      if ((rel.childAsins || []).length) {
        r.kids = rel.childAsins.slice();
        if (rel.variationTheme) { r.theme = rel.variationTheme.theme || ''; r.tattrs = (rel.variationTheme.attributes || []).slice(); }
      }
    });
    return r;
  });
  const parentIn = new Map(recs.filter(r => r.kids).map(r => [r.asin, r]));
  recs.forEach(r => {
    const rec = { at: now, pa: r.pa };
    if (r.kids) Object.assign(rec, { kids: r.kids, theme: r.theme, tattrs: r.tattrs || [] });
    const pa = r.pa || (r.kids ? '' : hintPa || '');                       // a parentless listing asked with a family: that family's attributes
    const par = pa ? parentIn.get(pa) || fcCatOf(brand, pa) : null;
    if (par && par.tattrs) rec.vals = Object.fromEntries(par.tattrs.map(a => [a, fcAttrVal(r.attrs[a]).slice(0, 80)]));
    FC.cat[fcKey(brand, r.asin)] = rec;
  });
  const got = new Set(recs.map(r => r.asin));
  asked.forEach(a => { if (!got.has(a)) FC.cat[fcKey(brand, a)] = { at: now, nf: 1, pa: '' }; });
  return recs;
}
// Queue catalog calls (two at a time); `fk` is the family they are for (its line says "Reading from Amazon…" until the last lands).
// A person's reads go before the background ones; the background ones wait while a family is open.
function fcQueueCat(jobs, fk, bg, front) {
  const R = FC.reads;
  jobs.forEach(j => {
    const job = Object.assign({ fk: fk || '', bg: !!bg }, j);
    const at = front ? 0 : bg ? -1 : R.q.findIndex(x => x.bg);
    if (at < 0) R.q.push(job); else R.q.splice(at, 0, job);
  });
  if (jobs.length && fk) FC.reading.set(fk, (FC.reading.get(fk) || 0) + jobs.length);
  fcPump();
  return jobs.length;
}
function fcPump() {
  const R = FC.reads;
  while (R.inflight < FC_INFLIGHT && R.q.length) {
    if (R.q[0].bg && FC.open) break;                                       // the background reads pause while a family is open
    const job = R.q.shift();
    R.inflight++;
    if (job.bg) R.bgIn++;
    baCall({ lfix: 'cat', brand: job.brand, asins: job.asins.join(',') }).then(reply => {
      if (!reply || reply.ok === false) throw new Error((reply && reply.error) || 'no answer');
      const recs = fcCatTake(job.brand, job.asins, reply.items, job.pa);
      // children whose parent was not in this call (and is not kept): one more call with that parent, so their values can be read
      if (!job.follow) {
        const byPa = new Map();
        recs.forEach(r => { if (r.pa && !r.kids && !(FC.cat[fcKey(job.brand, r.asin)] || {}).vals) byPa.set(r.pa, (byPa.get(r.pa) || []).concat([r.asin])); });
        byPa.forEach((kids, pa) => {
          const more = fcChunks([pa], kids).map(asins => ({ brand: job.brand, asins, pa, follow: 1, ref: job.ref }));
          if (job.ref && FC.refresh.left.has(job.fk)) FC.refresh.left.set(job.fk, FC.refresh.left.get(job.fk) + more.length);
          fcQueueCat(more, job.fk, job.bg, !job.bg);
        });
      }
    }).catch(() => { R.fails++; if (job.fk) FC.failed.add(job.fk); }).then(() => {
      R.inflight--;
      if (job.bg) R.bgIn--;
      if (job.fk && FC.reading.has(job.fk)) {
        const left = FC.reading.get(job.fk) - 1;
        if (left > 0) FC.reading.set(job.fk, left);
        else FC.reading.delete(job.fk);
      }
      if (job.ref && FC.refresh.on && FC.refresh.left.has(job.fk)) {             // a Refresh read: the family is done when its last call lands
        const left = FC.refresh.left.get(job.fk) - 1;
        if (left > 0) FC.refresh.left.set(job.fk, left);
        else { FC.refresh.left.delete(job.fk); FC.refresh.done++; }
        if (!FC.refresh.left.size) fcRefreshDone();
      }
      if (!R.q.length && !R.inflight) fcCatSave();
      fcSchedule();
      fcPump();
    });
  }
}
// ASIN lists of FC_CAT_BATCH, the `first` ones (the parent) at the head of the first call.
function fcChunks(first, rest) {
  const all = [...new Set(first.concat(rest).filter(fcIsAsin))];
  const out = [];
  for (let i = 0; i < all.length; i += FC_CAT_BATCH) out.push(all.slice(i, i + FC_CAT_BATCH));
  return out;
}
// The ASINs one family's read asks Amazon about: its parent, its live children, and the parentless listings suggested to it.
function fcFamAsins(f, v) {
  const cands = (v.cands || []).filter(c => c.sug && c.sug.fk === f.fk).map(c => c.asin);
  return fcChunks(f.pa ? [f.pa] : [], f.live.map(c => c.asin).concat(cands));
}
/** Has Amazon answered for this family? Its parent (with its theme) and every live child (and suggested listing) are kept. */
function fcFamRead(f, v) {
  if (f.pa && !fcCatOf(f.brand, f.pa)) return false;                      // any answer for the parent counts (even "not a parent" / nothing)
  const cands = ((v || FC.view || {}).cands || []).filter(c => c.sug && c.sug.fk === f.fk);
  return f.live.concat(cands).every(c => !fcIsAsin(c.asin) || !!fcCatOf(c.brand, c.asin));
}
/** Read one family from Amazon (on open, or "Read again" with force). */
function fcReadCat(fk, force) {
  const v = FC.view || fcBuild();
  const f = v.families.find(x => x.fk === fk);
  if (!f || (!force && fcFamRead(f, v)) || FC.reading.has(fk)) return 0;
  FC.failed.delete(fk);
  return fcQueueCat(fcFamAsins(f, v).map(asins => ({ brand: f.brand, asins, pa: f.pa })), fk, false);
}
/** After the page opens: every family not read before, in the background — 2 calls at most, paused while a family is open. The saved copy
 *  keeps the answers, so this happens once (FC_CAT_DAYS). */
function fcReadAllCat() {
  const v = FC.view || fcBuild();
  let n = 0;
  v.families.forEach(f => {
    if (!f.live.length || fcFamRead(f, v) || FC.reading.has(f.fk)) return;
    if (typeof lmOk === 'function' && lmOk(f.brand)) return;              // the ListingMatch cache holds this brand: read only when a family it lacks is opened
    n += fcQueueCat(fcFamAsins(f, v).map(asins => ({ brand: f.brand, asins, pa: f.pa })), f.fk, true);
  });
  return n;
}
// "Reading Amazon… 120 of 416": the families with live children Amazon has answered for, while the background reads run.
function fcCatProgress(v) {
  const fams = v.families.filter(f => f.live.length);
  const busy = FC.reads.q.some(j => j.bg) || FC.reads.bgIn > 0;
  return { done: fams.filter(f => fcFamRead(f, v) || FC.failed.has(f.fk)).length, total: fams.length, busy };
}

/* ----- ?lfix=get reads (right before a fix), kept in this browser ----- */
function fcGotLoad() {
  if (FC.gotLoaded) return;
  FC.gotLoaded = true;
  try {
    const data = JSON.parse(localStorage.getItem(FC_STORE) || 'null');
    const cut = Date.now() - FC_READ_DAYS * 864e5;
    if (data && data.got) Object.entries(data.got).forEach(([k, v]) => { if (v && v.at > cut) FC.got[k] = v; });
  } catch (e) { /* no storage */ }
}
function fcGotSave() {
  try {
    const all = Object.entries(FC.got).sort((a, b) => b[1].at - a[1].at).slice(0, FC_STORE_MAX);
    localStorage.setItem(FC_STORE, JSON.stringify({ v: 1, got: Object.fromEntries(all) }));
  } catch (e) { /* quota */ }
}
/** One ?lfix=get answer → the listing's theme (as our listing holds it), colour, size, parent SKU, parentage, the product type. */
function fcFromReply(reply) {
  const at = (reply && reply.attributes) || {};
  const first = (name, f) => String(((at[name] || []).find(e => e && e[f || 'value'] != null && e[f || 'value'] !== '') || {})[f || 'value'] || '');
  const rel = (at.child_parent_sku_relationship || []).find(e => e && e.parent_sku) || null;
  return { at: Date.now(), theme: first('variation_theme', 'name') || first('variation_theme'), color: first('color').slice(0, 60), size: first('size').slice(0, 60),
    psku: rel ? String(rel.parent_sku) : '', lvl: first('parentage_level'), pt: String((reply && reply.productType) || '') };
}
async function fcReadOne(brand, sku) {
  const reply = await baCall({ lfix: 'get', brand, sku });
  if (!reply || reply.ok === false) throw new Error((reply && reply.error) || 'no answer');
  FC.got[fcKey(brand, sku)] = fcFromReply(reply);
  return reply;
}

/* ----- the removed-on-purpose marks (listingrules/famok_<brand>) ----- */
async function fcOkLoad() {
  if (FC.okLoaded) return;
  FC.okLoaded = true;
  for (const b of ['SP', 'CPC']) {
    try {
      const data = typeof lsGet === 'function' ? await lsGet(FC_OK_COLL, FC_OK_DOC(b)) : null;
      if (data && data.items) FC.ok[b] = Object.assign({}, data.items, FC.ok[b]);
    } catch (e) { FC.err = 'Could not read the "removed on purpose" marks: ' + ((e && e.message) || e); }
  }
}
const fcIsOk = (brand, sku) => !!(FC.ok[brand] && FC.ok[brand][sku] && FC.ok[brand][sku].on);
// Save marks for one brand (several at once, one write): the page shows them at once; the save follows.
async function fcOkWrite(brand, entries) {
  Object.assign(FC.ok[brand], entries);
  FC.okNote = '';
  fcDrawAll();
  try {
    const saved = typeof lsSave === 'function' ? await lsSave(FC_OK_COLL, FC_OK_DOC(brand), { kind: 'famok', items: entries }) : false;
    if (!saved) FC.okNote = fcIsTest() ? 'Test site — the mark is kept on this page only, not saved.' : 'Not saved — the mark is kept on this page only.';
  } catch (e) {
    FC.okNote = 'Could not save the mark (' + ((e && e.message) || e) + ') — it is kept on this page only and will show again after a reload.';
  }
  fcDrawAll();
  return entries;
}
/** Removed on purpose, for one or many "Not in family" children (keys "brand|sku"), one reason for all: they leave the red list at once and for
 *  good; who / when / reason are saved. */
async function fcOkSetMany(keys, reason) {
  const v = FC.view || fcBuild();
  const by = fcWho(), at = Date.now(), why = String(reason || '').trim().slice(0, 120) || FC_REASON;
  const per = {};
  keys.forEach(k => {
    const c = v.orphans.find(o => fcKey(o.brand, o.sku) === k);
    if (!c) return;
    (per[c.brand] = per[c.brand] || {})[c.sku] = { on: true, reason: why, by, name: fcName(by), at, fam: c.sug ? c.sug.psku || c.sug.pa || '' : '', asin: c.asin || '' };
    FC.sel.delete(k);
  });
  FC.ask = '';
  FC.bulkAsk = false;
  await Promise.all(Object.entries(per).map(([brand, entries]) => fcOkWrite(brand, entries)));
  return Object.values(per).reduce((n, e) => n + Object.keys(e).length, 0);
}
const fcOkSet = (brand, sku, reason) => fcOkSetMany([fcKey(brand, sku)], reason);
/** Undo (a mistake): the child is an error again; who undid it is kept beside the first mark. */
function fcOkUndo(brand, sku) {
  const old = (FC.ok[brand] || {})[sku] || {};
  const by = fcWho();
  return fcOkWrite(brand, { [sku]: Object.assign({}, old, { on: false, undoneBy: by, undoneName: fcName(by), undoneAt: Date.now() }) });
}

/* ----- building the picture ----- */
/** Everything the page shows, from the data in memory: { families, orphans (Amazon: no parent), cands (parentless listings with a suggested
 *  family), removed, live, all, notes, ratingFound, groups, counts } — live children only. */
function fcBuild() {
  fcCatLoad();
  fcGotLoad();
  const families = new Map();
  const loose = [];                                  // live listings our data gives no parent
  const stemFams = new Map();
  const notes = [];
  let live = 0, all = 0, ratingFound = 0;
  ['SP', 'CPC'].forEach(brand => {
    const snap = typeof IML !== 'undefined' ? IML[brand] : null;
    const items = (snap && snap.items) || [];
    const snapAt = snap && snap.at && snap.at.getTime ? snap.at.getTime() : 0;
    const hrows = (typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || [];
    if (!items.length) { notes.push(`${fcBrandName(brand)}: no Image Manager snapshot yet — open Image Manager once to read it.`); return; }
    if (!hrows.length) notes.push(`${fcBrandName(brand)}: no Listing Health snapshot — stock is unknown, so no child counts as live.`);
    const rowOf = new Map(hrows.map(r => [r.sku, r]));
    const parents = new Map(), parentByAsin = new Map();
    items.forEach(it => { if (/^parent$/i.test(it.lvl || '')) { parents.set(it.sku, it); if (it.asin) parentByAsin.set(it.asin, it.sku); } });
    const famOf = (fk, psku, pa) => {
      let f = families.get(fk);
      if (!f) {
        const p = psku ? parents.get(psku) : null;
        f = { fk, brand, psku: psku || '', pa: (p && p.asin) || pa || '', title: (p && p.t) || '', pt: '', kids: [], live: [], pts: {} };
        families.set(fk, f);
      }
      if (!f.pa && pa) f.pa = pa;
      return f;
    };
    // ONE ROW PER ASIN: our SKUs on the same ASIN are one child (several SKUs can sell one ASIN — that is no duplicate). Amazon's resale SKUs
    // ("amzn.gr.…") are left out of every flag and count; they are only named inside their ASIN's row.
    const resale = new Map();
    const byAsin = new Map();
    items.forEach(it => {
      if (/^parent$/i.test(it.lvl || '')) return;
      const row = rowOf.get(it.sku) || null;
      const asin = it.asin || (row && row.asin) || '';
      if (FC_RESALE.test(it.sku)) { if (asin) resale.set(asin, (resale.get(asin) || []).concat([it.sku])); return; }
      const stock = row && row.qty != null ? Number(row.qty) : null;
      const pa = it.pa || (row && row.parent && row.parent !== row.asin ? row.parent : '') || '';
      const psku = it.psku || (pa ? parentByAsin.get(pa) || '' : '');
      const m = { it, row, asin, stock, pa, psku, live: /BUYABLE/.test(String(it.st || '')) && stock != null && stock > 0 };
      const k = asin || 'sku:' + it.sku;
      byAsin.set(k, (byAsin.get(k) || []).concat([m]));
    });
    byAsin.forEach((ms, k) => {
      all++;
      const liveMs = ms.filter(m => m.live);
      const isLive = liveMs.length > 0;
      const use = (isLive ? liveMs : ms).slice().sort((a, b) => (b.psku ? 1 : 0) - (a.psku ? 1 : 0) || (b.pa ? 1 : 0) - (a.pa ? 1 : 0) || (b.stock || 0) - (a.stock || 0) || String(a.it.sku).localeCompare(String(b.it.sku)));
      const rep = use[0], it = rep.it, row = rep.row;
      const fk = rep.psku ? brand + '|S:' + rep.psku : rep.pa ? brand + '|A:' + rep.pa : '';
      const rt = use.map(m => fcRating(m.it, m.row)).find(Boolean) || null;
      if (rt) ratingFound++;
      const c = { brand, sku: it.sku, skus: use.map(m => m.it.sku), resale: rep.asin ? resale.get(rep.asin) || [] : [], asin: rep.asin, title: it.t || (row && row.title) || '', pt: it.pt || '',
        stock: isLive ? liveMs.reduce((n, m) => n + m.stock, 0) : rep.stock, live: isLive, fk, rt,
        iss: [].concat(...use.map(m => m.it.iss || [])), issAt: snapAt, stem: fcStem(it.sku), book: (typeof LR_CAT !== 'undefined' && LR_CAT[brand] && LR_CAT[brand][it.sku]) || null };
      if (fk) {
        const f = famOf(fk, rep.psku, rep.pa);
        f.kids.push(c);
        if (c.pt) f.pts[c.pt] = (f.pts[c.pt] || 0) + 1;
        if (!f.title && c.title) f.title = c.title;
        if (c.stem && isLive) {
          const sm = stemFams.get(brand + '|' + c.stem) || new Map();
          sm.set(fk, (sm.get(fk) || 0) + 1);
          stemFams.set(brand + '|' + c.stem, sm);
        }
        if (isLive) { f.live.push(c); live++; }
      } else if (isLive) {
        live++;
        loose.push(c);
      }
    });
  });
  families.forEach(f => {
    f.pt = Object.entries(f.pts).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
    f.name = (typeof parentName === 'function' && f.pa ? parentName(f.brand, f.pa, f.title) : '') || f.title || f.psku || f.pa;
  });
  // parentless listings our SKU guess puts next to a family: Amazon is asked about them with that family (the guess never decides a flag)
  const cands = [];
  loose.forEach(c => { c.sug = fcSuggest(c, families, stemFams); if (c.sug) cands.push(c); });
  // `loose`: every live listing our data gives no parent — read by the Categories tab only (a product of its own has a category too)
  const v = { families: [...families.values()], cands, loose, orphans: [], removed: [], live, all, notes, ratingFound, at: Date.now() };
  fcProblems(v);
  FC.view = v;
  return v;
}
/** The one family a parentless listing looks like it belongs to: { fk, psku, pa, name, why } or null. SKU stem first, then the title alone.
 *  Shown ONLY as "Suggested family" — Amazon's catalog decides whether it is "Not in family". */
function fcSuggest(c, families, stemFams) {
  let fam = null, why = [];
  const m = c.stem ? stemFams.get(c.brand + '|' + c.stem) : null;
  if (m) {
    const fks = [...m.entries()];
    if (fks.length === 1 && fks[0][1] >= 2) {
      fam = families.get(fks[0][0]);
      why.push(`SKU like ${fks[0][1]} children of this family (${c.stem}-…)`);
      const alike = fam ? Math.max(0, ...fam.kids.map(k => fcAlike(c.title, k.title) || 0)) : 0;
      if (fam && c.title && fam.kids.some(k => k.title) && alike < 0.3) fam = null;
      else if (alike >= 0.3) why.push('the title matches');
    }
  }
  if (!fam && c.title) {
    const scored = [];
    families.forEach(f => {
      if (f.brand !== c.brand) return;
      const best = Math.max(0, ...f.kids.map(k => fcAlike(c.title, k.title) || 0));
      if (best >= 0.6) scored.push([f, best]);
    });
    scored.sort((a, b) => b[1] - a[1]);
    if (scored.length && scored[0][1] >= 0.8 && (scored.length === 1 || scored[1][1] < 0.6)) { fam = scored[0][0]; why = ['the title is almost the same as this family\'s']; }
  }
  if (!fam) return null;
  if (c.pt && fam.pt && c.pt !== fam.pt) return null;
  if (c.pt && fam.pt) why.push('same product type');
  return { fk: fam.fk, psku: fam.psku, pa: fam.pa, name: fam.name, why: why.join(' · ') };
}
const fcSrcCat = rec => ({ src: 'Amazon catalog', at: rec.at });
const fcSrcIss = (c, i) => ({ src: 'Amazon issue' + (i.c ? ' ' + i.c : ''), at: c.issAt });
// The catalog values of a child, in the order of the theme's attributes: "color: Black · set_name: 3 Piece".
const fcValsText = (vals, tattrs) => (tattrs || []).map(a => `${a}: ${vals && vals[a] ? vals[a] : '—'}`).join(' · ');
// A brand-catalogue value for a missing colour / size (the only value a fix may send by itself).
function fcBookPlan(c, missing) {
  if (!c.book) return null;
  const set = {};
  missing.forEach(a => { if ((a === 'color' || a === 'size') && c.book[a]) set[a] = String(c.book[a]); });
  return Object.keys(set).length ? set : null;
}
/** Every live child's problems from Amazon's data, the family groups to draw and the card counts. */
function fcProblems(v) {
  const counts = { orphan: 0, dup: 0, missing: 0, theme: 0 };
  const groups = new Map();
  const group = f => groups.get(f.fk) || (groups.set(f.fk, { f, rows: [] }), groups.get(f.fk));
  const famByFk = new Map(v.families.map(f => [f.fk, f]));
  const orphanRow = (c, f, rec, why) => {
    if ((c.skus || [c.sku]).some(x => fcIsOk(c.brand, x))) { v.removed.push(Object.assign(c, { why: 'team' })); return; }
    if (fcLowRated(c.rt)) { v.removed.push(Object.assign(c, { why: 'rating' })); return; }
    v.orphans.push(c);
    counts.orphan++;
    const fix = !f.psku ? { kind: 'hand', text: 'The family\'s parent SKU is not known here' }
      : !c.pt ? { kind: 'hand', text: 'This listing\'s product type is not known here' }
        : { kind: 'link', text: `Link to ${f.psku}`, why };
    group(f).rows.unshift({ c, probs: [Object.assign({ k: 'orphan', sev: 'r', text: 'Not in family — Amazon\'s catalog shows no parent', fix, sug: `${f.name} (${why})` }, fcSrcCat(rec))] });
  };
  v.families.forEach(f => {
    const par = fcCatOf(f.brand, f.pa);
    f.amz = par && par.kids ? { theme: par.theme || '', tattrs: par.tattrs || [], kids: par.kids.length, at: par.at } : null;
    f.read = fcFamRead(f, v);
    const judged = [];
    f.live.forEach(c => {
      const rec = fcCatOf(c.brand, c.asin);
      c.amz = rec;
      if (rec && !rec.nf && !rec.pa) { c.tattrs = f.amz ? f.amz.tattrs : null; return orphanRow(c, f, rec, 'our listing names this family'); }   // Amazon: no parent
      judged.push(c);
    });
    // the children of each Amazon parent, judged on that parent's theme attributes
    const byPa = new Map();
    judged.forEach(c => { if (c.amz && c.amz.pa) byPa.set(c.amz.pa, (byPa.get(c.amz.pa) || []).concat([c])); });
    const sameAs = new Map();
    byPa.forEach((kids, pa) => {
      const p = fcCatOf(f.brand, pa);
      const tattrs = p && p.tattrs && p.tattrs.length ? p.tattrs : null;
      kids.forEach(c => { c.tattrs = tattrs; });
      if (!tattrs) return;
      const full = kids.filter(c => c.amz.vals && tattrs.every(a => c.amz.vals[a]));
      const byKey = new Map();
      full.forEach(c => { const k = tattrs.map(a => fcNorm(c.amz.vals[a])).join('|'); byKey.set(k, (byKey.get(k) || []).concat([c])); });
      byKey.forEach(list => { if (list.length > 1) list.forEach(c => sameAs.set(c, list.filter(o => o !== c))); });
    });
    judged.forEach(c => {
      const probs = [];
      const issues = (c.iss || []).map(i => [fcIssueKind(i), i]).filter(([k]) => k);
      const has = k => probs.some(p => p.k === k);
      issues.forEach(([k, i]) => {
        if (has(k)) return;
        probs.push(Object.assign({ k, sev: k === 'theme' ? 'y' : 'r', text: String(i.m || '').slice(0, 200),
          fix: { kind: 'hand', text: k === 'theme' ? 'Change the theme in Listing Errors' : 'Fix it in Listing Errors' } }, fcSrcIss(c, i)));
      });
      const rec = c.amz;
      if (rec && rec.vals && c.tattrs) {
        const missing = c.tattrs.filter(a => !rec.vals[a]);
        if (missing.length && !has('missing')) {
          const plan = fcBookPlan(c, missing);
          probs.push(Object.assign({ k: 'missing', sev: 'r', text: `No ${missing.join(', ')} on Amazon — the theme is ${(fcCatOf(f.brand, rec.pa) || {}).theme || '?'}`,
            fix: plan && Object.keys(plan).length === missing.length ? { kind: 'set', set: plan, text: 'Set ' + Object.entries(plan).map(([a, val]) => `${a === 'color' ? 'colour' : a} "${val}"`).join(' and ') + ' (from the catalogue)' }
              : { kind: 'hand', text: 'No certain value — add it in Listing Errors' } }, fcSrcCat(rec)));
        }
        const same = sameAs.get(c);
        if (same && !has('dup')) {
          probs.push(Object.assign({ k: 'dup', sev: 'r', text: `Same ${fcValsText(rec.vals, c.tattrs)} as ${same.map(o => o.sku).join(', ')}`,
            fix: { kind: 'hand', text: 'Decide which child keeps it, then change the other' } }, fcSrcCat(rec)));
        }
      }
      if (!probs.length) return;
      probs.forEach(p => { counts[p.k]++; });
      group(f).rows.push({ c, probs });
    });
  });
  // parentless listings next to a family (SKU guess): Amazon decides — no parent → Not in family; a parent → nothing; not read → grey
  v.cands.forEach(c => {
    const f = famByFk.get(c.sug.fk);
    if (!f) return;
    const rec = fcCatOf(c.brand, c.asin);
    c.amz = rec;
    c.tattrs = f.amz ? f.amz.tattrs : null;                                 // its values, on the family's theme attributes
    if (rec && !rec.nf && !rec.pa) return orphanRow(c, f, rec, c.sug.why);
    if (rec && !rec.nf) return;                                            // Amazon shows it in a family: nothing to do
    group(f).rows.push({ c, probs: [{ k: 'unread', sev: 'g', text: rec && rec.nf ? 'Amazon\'s catalog returned nothing for this ASIN' : 'Not read from Amazon yet',
      fix: { kind: 'none', text: '' }, sug: `${f.name} (${c.sug.why})` }] });
  });
  v.groups = [...groups.values()].sort((a, b) => {
    const red = g => g.rows.filter(r => r.probs.some(p => p.sev === 'r')).length;
    return red(b) - red(a) || String(a.f.name).localeCompare(String(b.f.name));
  });
  v.counts = counts;
  return v;
}

/* ----- the fixes (THE ONE SEND PATH) ----- */
const fcRow = (brand, sku) => {
  const v = FC.view || fcBuild();
  for (const g of v.groups) { const r = g.rows.find(x => x.c.brand === brand && x.c.sku === sku); if (r) return { g, r }; }
  return null;
};
const fcCopyEntry = (old, value) => { const e = Object.assign({}, (old && old[0]) || {}); delete e.marketplace_id; e.value = value; if (!e.language_tag) e.language_tag = 'en_US'; return [e]; };
const FC_READING = 'Reading the listing and its family…';
// The family a "Not in family" child would join (its row's group).
const fcOrphanFam = (c, v) => { const g = v.groups.find(x => x.rows.some(r => r.c === c)); return g ? g.f : null; };
/** Link to family, for one or many "Not in family" children (keys "brand|sku") — all of ONE family. The theme is read from the parent
 *  listing (?lfix=get: the value our listings carry); each child is read again (its current values, for the popup and Put back). A child that
 *  cannot be linked safely (no theme, already linked, Amazon's catalog values the same as a sibling's or another ticked child's on every theme
 *  attribute) is held back and named in the popup — Fix by hand. Then Amazon's check popup (sqSendWithCheck). */
async function fcLinkMany(keys) {
  const v = FC.view || fcBuild();
  const list = keys.map(k => v.orphans.find(o => fcKey(o.brand, o.sku) === k)).filter(Boolean);
  if (!list.length || typeof sqSendWithCheck !== 'function') return null;
  const why = fcLinkWhyNot(list, v);
  if (why) { FC.bulkMsg = why; fcDrawAll(); return null; }
  const f = fcOrphanFam(list[0], v);
  const mine = list.map(c => fcKey(c.brand, c.sku));
  if (mine.some(k => FC.busy.has(k))) return null;
  mine.forEach(k => { FC.busy.add(k); FC.note[k] = FC_READING; });
  FC.bulkMsg = '';
  fcDrawAll();
  try {
    let theme = '';
    try { await fcReadOne(f.brand, f.psku); theme = FC.got[fcKey(f.brand, f.psku)].theme || ''; } catch (e) { theme = ''; }
    const tattrs = f.amz ? f.amz.tattrs : [];
    const keyOf = rec => (rec && rec.vals && tattrs.length && tattrs.every(a => rec.vals[a]) ? tattrs.map(a => fcNorm(rec.vals[a])).join('|') : '');
    const used = new Map(f.live.filter(o => !list.includes(o)).map(o => [keyOf(o.amz), o.sku]).filter(([k]) => k));
    const jobs = [], held = [];
    for (const c of list) {
      const key = fcKey(c.brand, c.sku);
      let reply;
      try { reply = await fcReadOne(c.brand, c.sku); } catch (e) { held.push({ sku: c.sku, why: 'could not read it from Amazon' }); continue; }
      const at = (reply && reply.attributes) || {};
      const now = FC.got[key];
      const pt = now.pt || c.pt;
      if (now.psku) { held.push({ sku: c.sku, why: 'already linked to ' + now.psku + ' on Amazon' }); continue; }
      if (!theme) { held.push({ sku: c.sku, why: 'the family\'s variation theme could not be read' }); continue; }
      if (!pt) { held.push({ sku: c.sku, why: 'its product type is not known' }); continue; }
      const vk = keyOf(c.amz);
      if (vk && used.has(vk)) { held.push({ sku: c.sku, why: `Amazon shows the same ${fcValsText(c.amz.vals, tattrs)} as ${used.get(vk)}` }); continue; }
      if (vk) used.set(vk, c.sku);
      jobs.push({ brand: c.brand, sku: c.sku, asin: c.asin, label: c.title || c.sku,
        body: { lfix: 'patch', brand: c.brand, sku: c.sku, productType: pt, patches: [
          { op: 'replace', path: '/attributes/parentage_level', value: [{ value: 'child' }] },
          { op: 'replace', path: '/attributes/child_parent_sku_relationship', value: [{ child_relationship_type: 'variation', parent_sku: f.psku }] },
          { op: 'replace', path: '/attributes/variation_theme', value: [{ name: theme }] }] },
        changes: [
          { field: 'Parent (family)', old: sqValText(at.child_parent_sku_relationship) || '(none)', new: 'variation ' + f.psku, attr: 'child_parent_sku_relationship', oldV: JSON.parse(JSON.stringify(at.child_parent_sku_relationship || [])) },
          { field: 'Parentage', old: sqValText(at.parentage_level) || '(none)', new: 'child', attr: 'parentage_level', oldV: JSON.parse(JSON.stringify(at.parentage_level || [])) },
          { field: 'Variation theme', old: sqValText(at.variation_theme) || '(none)', new: theme, attr: 'variation_theme', oldV: JSON.parse(JSON.stringify(at.variation_theme || [])) }] });
    }
    mine.forEach(k => { if (FC.note[k] === FC_READING) FC.note[k] = ''; });
    held.forEach(h => { FC.note[fcKey(f.brand, h.sku)] = 'Fix by hand: ' + h.why + '.'; });
    if (!jobs.length) return null;
    return sqSendWithCheck(jobs, { screen: 'Family Check', held,
      title: jobs.length === 1 ? `Link ${jobs[0].sku} to ${f.name || f.psku}` : `Link ${jobs.length} children to ${f.name || f.psku}`,
      onDone: sum => fcAfterSend(sum, job => { const r = fcCatOf(job.brand, job.asin); if (r) Object.assign(r, { pa: f.pa || r.pa || 'linked', at: Date.now() }); FC.relinked.set(fcKey(job.brand, job.sku), f.fk); }) });
  } finally {
    mine.forEach(k => { FC.busy.delete(k); if (FC.note[k] === FC_READING) FC.note[k] = ''; });
    fcDrawAll();
  }
}
const fcLink = (brand, sku) => fcLinkMany([fcKey(brand, sku)]);
/** Why the ticked children cannot be linked in one go ('' when they can): they must all be in ONE family with a known parent SKU. */
function fcLinkWhyNot(list, v) {
  const fams = [...new Set(list.map(c => fcOrphanFam(c, v)))];
  if (fams.length > 1) return `Link to family links children of one family at a time — the ticked ones belong to ${fams.length} families.`;
  if (!fams[0] || !fams[0].psku) return 'The family\'s parent SKU is not known here — fix by hand.';
  return '';
}
/** Set colour / size: the brand catalogue's value (the only certain one) for a value Amazon's catalog has empty, after reading the listing. */
async function fcSetValue(brand, sku, kind) {
  const hit = fcRow(brand, sku);
  if (!hit || typeof sqSendWithCheck !== 'function') return null;
  const p = hit.r.probs.find(x => x.k === kind && x.fix.kind === 'set');
  if (!p) return null;
  const c = hit.r.c, key = fcKey(brand, sku);
  if (FC.busy.has(key)) return null;
  FC.busy.add(key);
  FC.note[key] = 'Reading the listing…';
  fcDrawAll();
  try {
    const reply = await fcReadOne(brand, sku);
    const at = (reply && reply.attributes) || {};
    const pt = FC.got[key].pt || c.pt;
    if (!pt) { FC.note[key] = 'Fix by hand: the product type is not known.'; return null; }
    const patches = [], changes = [];
    Object.entries(p.fix.set).forEach(([attr, val]) => {
      patches.push({ op: 'replace', path: '/attributes/' + attr, value: fcCopyEntry(at[attr], val) });
      changes.push({ field: attr === 'color' ? 'Colour' : attr === 'size' ? 'Size' : attr, old: sqValText(at[attr]) || '(none)', new: val, attr, oldV: JSON.parse(JSON.stringify(at[attr] || [])) });
    });
    FC.note[key] = '';
    return sqSendWithCheck([{ brand, sku, asin: c.asin, label: c.title || sku, body: { lfix: 'patch', brand, sku, productType: pt, patches }, changes }], {
      screen: 'Family Check', title: `Set ${changes.map(x => x.field.toLowerCase()).join(' and ')} on ${sku}`,
      onDone: sum => fcAfterSend(sum, job => { const r = fcCatOf(job.brand, job.asin); if (r && r.vals) Object.assign(r.vals, p.fix.set); }) });
  } catch (e) {
    FC.note[key] = 'Could not read the listing: ' + ((e && e.message) || e);
    return null;
  } finally {
    FC.busy.delete(key);
    if (FC.note[key] === 'Reading the listing…') FC.note[key] = '';
    fcDrawAll();
  }
}
// After the popup closed, per listing: what Amazon accepted is what this page now knows (`apply` updates the kept catalog record, so the child
// leaves the list and its tick goes); still working says so on its row. "Read again" asks Amazon's catalog itself.
function fcAfterSend(sum, apply) {
  ((sum && sum.jobs) || []).forEach(job => {
    const key = fcKey(job.brand, job.sku);
    if (job.state === 'accepted') {
      apply(job);
      FC.note[key] = '';
      FC.sel.delete(key);
    } else if (job.state === 'working' || job.state === 'sent') FC.note[key] = 'Sent — Amazon is still working on it (Listing History has it).';
    else if (sum.test) FC.note[key] = 'Test site — not sent to Amazon.';
  });
  fcCatSave();
  fcGotSave();
  fcDrawAll();
}
// Fix by hand: the listing(s) in Listing Errors (just those SKUs in its list). One brand at a time — Listing Errors shows one brand.
function fcOpenLerr(brand, skus) {
  const list = Array.isArray(skus) ? skus : [skus];
  if ($('leBrand')) $('leBrand').value = brand;
  if (typeof leOnly === 'function') leOnly(list, 'Family Check · ' + (list.length === 1 ? list[0] : list.length + ' listings'));
  showTab('lerr');
  if (typeof leShow === 'function') leShow(false);
  if (typeof leListEnsure === 'function') leListEnsure();
  if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
}

/* ----- the CSV: the red problems only ----- */
const FC_CSV_COLS = ['Brand', 'Family', 'Parent SKU', 'Parent ASIN', 'SKU', 'ASIN', 'Amazon values', 'Stock', 'Problem', 'Source', 'Read at', 'Suggested fix', 'Priority'];
function fcCsv(v) {
  const q = val => { const s = String(val == null ? '' : val); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const two = n => String(n).padStart(2, '0');
  const stamp = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
  const lines = [];
  fcGroups(v).forEach(g => g.rows.forEach(r => r.probs.filter(p => p.sev === 'r').forEach(p => {
    lines.push([fcBrandName(r.c.brand), g.f.name, g.f.psku, g.f.pa, (r.c.skus || [r.c.sku]).join(' / '), r.c.asin, r.c.amz && r.c.amz.vals ? fcValsText(r.c.amz.vals, r.c.tattrs) : '', r.c.stock, p.text, p.src || '', stamp(p.at),
      (p.fix.kind === 'hand' ? 'Fix by hand: ' : '') + p.fix.text, typeof prOf === 'function' ? prCsv(prFc(r)) : ''].map(q).join(','));
  })));
  return { n: lines.length, text: '﻿' + [FC_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function fcDownload() {
  const out = fcCsv(FC.view || fcBuild());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sellora-family-check-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}

/* ----- one family as Amazon returned it (the browser console) ----- */
/** fcFamilyReport('Desk Organizer'): reads the family from Amazon if it is not kept, then returns its theme, attribute names, each live child's
 *  catalog values and Amazon parent, its problems, and the card counts. */
async function fcFamilyReport(name, force) {
  const v0 = FC.view || fcBuild();
  const q = fcNorm(name);
  const f0 = v0.families.find(f => fcNorm(f.name).includes(q) || fcNorm(f.psku) === q || fcNorm(f.pa) === q);
  if (!f0) return { error: 'No family matches "' + name + '"' };
  if (force || !fcFamRead(f0, v0)) {
    fcReadCat(f0.fk, force);
    for (let i = 0; i < 600 && FC.reading.has(f0.fk); i++) await new Promise(r => setTimeout(r, 100));
  }
  const v = fcBuild();
  const f = v.families.find(x => x.fk === f0.fk);
  const g = v.groups.find(x => x.f.fk === f.fk);
  const out = {
    family: f.name, brand: fcBrandName(f.brand), parentSku: f.psku, parentAsin: f.pa,
    theme: f.amz ? f.amz.theme : '(not read)', attributes: f.amz ? f.amz.tattrs : [], amazonChildren: f.amz ? f.amz.kids : 0,
    readAt: f.amz ? fcWhen(f.amz.at) : '',
    children: f.live.map(c => ({ sku: c.sku, asin: c.asin, amazonParent: c.amz ? c.amz.pa || '(none)' : '(not read)',
      values: c.amz && c.amz.vals ? c.amz.vals : '(not read)', problems: ((g && g.rows.find(r => r.c === c)) || { probs: [] }).probs.map(p => `${p.k}: ${p.text} [${p.src || ''}]`) })),
    familyCounts: Object.fromEntries(FC_KINDS.map(k => [k.t, g ? g.rows.filter(r => r.probs.some(p => p.k === k.k)).length : 0])),
    cards: Object.fromEntries(FC_KINDS.map(k => [k.t, fcCount(v, k.k)])),
  };
  if (typeof console !== 'undefined' && console.table) console.table(out.children.map(c => Object.assign({ sku: c.sku, asin: c.asin, parent: c.amazonParent }, typeof c.values === 'object' ? c.values : { values: c.values })));
  return out;
}
if (typeof window !== 'undefined') window.fcFamilyReport = fcFamilyReport;

/* ----- Refresh: the latest saved data, and Amazon's catalog read again ----- */
// A time as people read it: "1:42 PM" today, "15 Nov, 6:02 PM" before.
function fcClock(ms) {
  const d = new Date(ms), now = new Date();
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + t;
}
/** [Refresh]: reload the LATEST SAVED snapshots from the places Image Manager and Listing Health read them (imgsnap / health — no new Amazon
 *  rebuild of either), then read every family's catalog from Amazon again, ignoring the saved copy (2 calls at a time; "Families 40 / 91").
 *  The open family stays open; the page does not move. */
async function fcRefresh() {
  if (FC.refresh.on) return null;
  FC.refresh = { on: true, step: 'saved', done: 0, total: 0, left: new Map(), at: FC.refresh.at };
  FC.newer = false;
  fcDrawAll();
  try {
    for (const b of ['SP', 'CPC']) if (typeof imListLoad === 'function') await imListLoad(b);   // Amazon errors + status: the saved Image Manager snapshot
    if (typeof loadHealthCache === 'function') await loadHealthCache();                         // stock: the saved Listing Health snapshot
  } catch (e) {
    FC.err = 'Could not reload the saved snapshots: ' + ((e && e.message) || e);
  }
  const v = fcBuild();
  // this run replaces the background reads still waiting
  const R = FC.reads;
  R.q = R.q.filter(j => {
    if (!j.bg) return true;
    if (j.fk && FC.reading.has(j.fk)) { const n = FC.reading.get(j.fk) - 1; if (n > 0) FC.reading.set(j.fk, n); else FC.reading.delete(j.fk); }
    return false;
  });
  const fams = v.families.filter(x => x.live.length);
  Object.assign(FC.refresh, { step: 'cat', total: fams.length });
  fams.forEach(x => {
    FC.failed.delete(x.fk);
    const jobs = fcFamAsins(x, v).map(asins => ({ brand: x.brand, asins, pa: x.pa, ref: 1 }));
    if (!jobs.length) { FC.refresh.done++; return; }
    FC.refresh.left.set(x.fk, jobs.length);
    fcQueueCat(jobs, x.fk, false);
  });
  if (!FC.refresh.left.size) fcRefreshDone();
  fcDrawAll();
  return FC.refresh.total;
}
function fcRefreshDone() {
  Object.assign(FC.refresh, { on: false, step: '', at: Date.now() });
  fcCatSave();
  fcSchedule();
}
/** Is a newer snapshot saved than the one on the page (after the 1 PM / 6 PM refresh, or someone's Refresh in Image Manager / Listing Health)?
 *  Reads only the two small meta documents per brand. */
async function fcCheckNewer() {
  if (typeof getDoc !== 'function' || typeof doc !== 'function' || FC.refresh.on) return FC.newer;
  const atOf = data => (data && data.at && data.at.toDate ? data.at.toDate().getTime() : 0);
  const have = (store, b) => (store && store[b] && store[b].at && store[b].at.getTime ? store[b].at.getTime() : 0);
  let newer = false;
  for (const b of ['SP', 'CPC']) {
    try {
      const [im, he] = await Promise.all([getDoc(doc(db, 'imgsnap', b)), getDoc(doc(db, 'health', b))]);
      const imAt = im && im.exists() ? atOf(im.data()) : 0, heAt = he && he.exists() ? atOf(he.data()) : 0;
      if (imAt > have(typeof IML !== 'undefined' ? IML : null, b) + 1000 || heAt > have(typeof HEALTH !== 'undefined' ? HEALTH : null, b) + 1000) newer = true;
    } catch (e) { /* no answer: ask again next time */ }
  }
  if (newer !== FC.newer) { FC.newer = newer; fcDrawAll(); }
  return newer;
}
// Every 5 minutes while the page is open.
function fcWatchNewer() {
  if (FC.newT || typeof setInterval !== 'function') return;
  FC.newT = setInterval(() => { if (fcPaneOn()) fcCheckNewer(); }, 5 * 60e3);
  if (FC.newT && FC.newT.unref) FC.newT.unref();
}

/* ----- drawing ----- */
// The groups the filters keep (brand, search, the card picked); a row keeps only the picked card's problem. The order stays the one the
// families were first drawn in, so a family never moves under the mouse when a read lands.
function fcGroups(v) {
  const q = fcNorm(FC.q);
  if (!FC.order) FC.order = new Map();
  v.groups.forEach(g => { if (!FC.order.has(g.f.fk)) FC.order.set(g.f.fk, FC.order.size); });
  return v.groups.filter(g => FC.brand === 'ALL' || g.f.brand === FC.brand).map(g => {
    const famHit = q && (fcNorm(g.f.name).includes(q) || fcNorm(g.f.psku).includes(q) || fcNorm(g.f.pa).includes(q));
    const rows = g.rows.filter(r => (!FC.card || r.probs.some(p => p.k === FC.card))
      && (!q || famHit || (r.c.skus || [r.c.sku]).some(x => fcNorm(x).includes(q)) || fcNorm(r.c.asin).includes(q) || fcNorm(r.c.title).includes(q)));
    return rows.length ? { f: g.f, rows } : null;
  }).filter(Boolean).sort((a, b) => FC.order.get(a.f.fk) - FC.order.get(b.f.fk));
}
function fcShell() {
  const box = $('fcPane');
  if (!box || FC.built) return;
  const seg = [['fam', 'Families'], ['cat', 'Categories']].map(([k, t]) => `<button type="button" class="segbtn${FC.tab === k ? ' on' : ''}" data-fc="tab" data-fc-v="${k}" aria-pressed="${FC.tab === k}">${t}</button>`).join('');
  box.innerHTML = `<div class="card fc-tb"><div class="toolbar"><div class="seg" role="group" aria-label="Which check">${seg}</div>`
    + `<span class="fc-famonly"><select data-fc-f="brand" aria-label="Brand"><option value="ALL">Both brands</option><option value="SP">Ridhi</option><option value="CPC">CPC</option></select></span>`
    + `<input type="search" class="fc-famonly" data-fc-f="q" placeholder="Search SKU, ASIN or family" aria-label="Search">`
    + `<span style="flex:1"></span><button type="button" class="ghost fc-famonly" id="fcRefresh" data-fc="refresh" title="Reload the latest saved Image Manager and Listing Health snapshots, and read every family from Amazon again">Refresh</button><button type="button" class="ghost fc-famonly" data-fc="csv">Export CSV</button></div><div class="fc-meta muted" id="fcMeta"></div></div><div id="fcBody"></div>`;
  FC.built = true;
}
function fcDrawAll() {
  if (!$('fcPane')) return;
  fcShell();
  if (FC.tab === 'cat') return fcDrawCat();
  if (FC.loading && !FC.loaded) { $('fcBody').innerHTML = '<div class="card fc-empty muted">Reading the Listing Health and Image Manager snapshots…</div>'; return; }
  const v = fcBuild();
  fcDrawTools(v);
  fcDrawBody(v);
}
function fcSchedule() { clearTimeout(FC.drawT); FC.drawT = setTimeout(fcDrawAll, 300); }
function fcDrawCat() {
  if (typeof ccDraw === 'function') return ccDraw();                     // the Categories tab: category-check.js
  document.querySelectorAll('#fcPane .fc-famonly').forEach(el => el.classList.add('hide'));
  if ($('fcMeta')) $('fcMeta').textContent = '';
  $('fcBody').innerHTML = '<div class="card fc-empty"><b>Categories</b><p class="muted">Coming with the automatic refresh — browse nodes.</p></div>';
}
function fcDrawTools(v) {
  document.querySelectorAll('#fcPane .fc-famonly').forEach(el => el.classList.remove('hide'));
  const meta = $('fcMeta');
  if (!meta) return;
  const at = (store, b) => (typeof store !== 'undefined' && store && store[b] && store[b].at && store[b].at.getTime ? store[b].at.getTime() : 0);
  const oldest = store => { const t = ['SP', 'CPC'].map(b => at(store, b)).filter(Boolean); return t.length ? Math.min(...t) : 0; };
  // the stock on the page: the ListingMatch cache's (its report time) for a brand whose newer report is in use, else the snapshot's own time
  const stockAt = () => { const t = ['SP', 'CPC'].map(b => (typeof lmStockAt === 'function' && lmStockAt(b)) || at(typeof HEALTH !== 'undefined' ? HEALTH : null, b)).filter(Boolean); return t.length ? Math.min(...t) : 0; };
  const parts = [`Live children only (buyable and in stock): ${fcNf(v.live)} of ${fcNf(v.all)} ASINs (our SKUs on one ASIN are one child; Amazon resale SKUs left out)`,
    'flags from Amazon\'s catalog and Amazon\'s issues only',
    v.ratingFound ? `ratings found for ${fcNf(v.ratingFound)} listings: below 4 ★ counts as removed on purpose` : 'ratings: none in Sellora\'s data — the team marks children removed for a low rating'];
  // when each part was saved / read: "Errors/status saved 1:42 PM · stock saved 1:42 PM · families read 12:50 PM" (yellow when older than 24 h)
  const famAt = v.families.filter(x => x.live.length && x.amz).map(x => x.amz.at);
  const when = (label, ms) => `<span class="${!ms || Date.now() - ms > 864e5 ? 'fc-old' : ''}">${fcEsc(label)} ${ms ? fcEsc(fcClock(ms)) : 'never'}</span>`;
  // the ListingMatch data fresh: its full refresh and last update instead of the snapshots' times (listing-match.js lmDataLabel,
  // every Listing screen's label); the old labels only when it is missing or older than 24 hours
  const lm = typeof lmDataLabel === 'function' ? lmDataLabel(['SP', 'CPC']) : null;
  const times = (lm ? [`<span>${fcEsc(lm.text)}</span>`] : [when('Errors/status saved', oldest(typeof IML !== 'undefined' ? IML : null)), when('stock saved', stockAt())])
    .concat(when('families read', famAt.length ? Math.min(...famAt) : 0)).join(' · ');
  const R = FC.refresh;
  const btn = $('fcRefresh');
  if (btn) {
    btn.disabled = R.on;
    btn.textContent = !R.on ? 'Refresh' : R.step === 'saved' ? 'Refreshing…' : `Refreshing… Families ${fcNf(R.done)} / ${fcNf(R.total)}`;
  }
  meta.innerHTML = `<div class="fc-times">${times}${R.on && R.step === 'cat' ? ` · <b>Families ${fcNf(R.done)} / ${fcNf(R.total)}</b>` : ''}</div>`
    + (FC.newer && !R.on ? '<div class="fc-newer">New data available — <button type="button" class="fc-b" data-fc="refresh">Refresh</button></div>' : '')
    + parts.map(fcEsc).join(' · ') + (FC.err ? `<div class="err">${fcEsc(FC.err)}</div>` : '') + (FC.msg ? `<div>${fcEsc(FC.msg)}</div>` : '')
    + v.notes.map(n => `<div>${fcEsc(n)}</div>`).join('') + (FC.okNote ? `<div class="fc-oknote">${fcEsc(FC.okNote)}</div>` : '');
}
const FC_COLS = 8;
// A row can be ticked when it is "Not in family" (Removed on purpose / Link to family) or a duplicate / missing value (Open in Listing Errors).
const fcTickKind = r => (r.probs.some(p => p.k === 'orphan') ? 'orphan' : r.probs.some(p => p.k === 'dup' || p.k === 'missing') ? 'fix' : '');
function fcFixHtml(r, p) {
  const key = fcKey(r.c.brand, r.c.sku);
  const busy = FC.busy.has(key);
  const a = `data-fc-b="${fcEsc(r.c.brand)}" data-fc-s="${fcEsc(r.c.sku)}"`;
  if (p.fix.kind === 'link') return `<button type="button" class="fc-b" data-fc="link" ${a}${busy ? ' disabled' : ''}>${busy ? 'Reading…' : 'Link to family'}</button>`;
  if (p.fix.kind === 'set') return `<button type="button" class="fc-b" data-fc="set" data-fc-k="${p.k}" ${a}${busy ? ' disabled' : ''}>${busy ? 'Reading…' : 'Set colour/size'}</button>`;
  if (p.fix.kind === 'none') return '';
  return `<button type="button" class="ghost fc-b" data-fc="lerr" ${a}>Open in Listing Errors</button>`;
}
// The source of a problem and when Amazon was read: "Amazon catalog · read 10 min ago".
const fcSrcHtml = p => (p.src ? `<small class="fc-src">${fcEsc(p.src)} · read ${fcEsc(fcAgo(p.at))}</small>` : '');
function fcRowHtml(r) {
  const c = r.c, key = fcKey(c.brand, c.sku);
  const a = `data-fc-b="${fcEsc(c.brand)}" data-fc-s="${fcEsc(c.sku)}"`;
  const probs = r.probs.filter(p => !FC.card || p.k === FC.card);
  const orphan = r.probs.some(p => p.k === 'orphan');
  const tick = fcTickKind(r) ? `<input type="checkbox" class="fc-tick" data-fc="tick" ${a}${FC.sel.has(key) ? ' checked' : ''} aria-label="Tick ${fcEsc(c.sku)}">` : '';
  const ask = FC.ask === key ? `<div class="fc-ask"><label>Reason <input type="text" data-fc-f="reason" value="${fcEsc(FC_REASON)}" maxlength="120"></label>`
    + `<button type="button" class="fc-b" data-fc="oksave" ${a}>Save</button><button type="button" class="ghost fc-b" data-fc="okcancel">Cancel</button></div>` : '';
  const btns = probs.map(p => fcFixHtml(r, p)).filter((h, i, all) => all.indexOf(h) === i).join('')
    + (orphan ? `<button type="button" class="ghost fc-b" data-fc="ok" ${a}>Removed on purpose</button>` : '');
  const amz = c.asin ? `<a href="https://www.amazon.com/dp/${fcEsc(c.asin)}" target="_blank" rel="noopener">${fcEsc(c.asin)}</a>` : '—';
  const vals = c.amz && c.amz.vals && c.tattrs ? fcEsc(fcValsText(c.amz.vals, c.tattrs)) : c.amz && !c.amz.nf ? '<span class="fc-none">—</span>' : '<span class="fc-none">not read</span>';
  const sug = probs.map(p => p.sug).filter(Boolean)[0];
  return `<tr class="fc-row${orphan ? ' is-orphan' : ''}${FC.sel.has(key) ? ' is-sel' : ''}"><td class="fc-tk">${tick}</td><td class="fc-sku"><b>${fcEsc(c.sku)}</b>${typeof prOf === 'function' && probs.length ? ' ' + prChipHtml(prFc(r), 'fc-chip') : ''}${typeof lmOldHtml === 'function' ? lmOldHtml(c.brand, c.sku) : ''}${fcSkusHtml(c)}<small>${fcEsc(String(c.title || '').slice(0, 70))}</small></td><td class="ui-mono">${amz}</td>`
    + `<td class="fc-vals">${vals}</td><td class="num">${fcNf(c.stock)}</td>`
    + `<td class="fc-prob">${probs.map(p => `<div class="fc-p is-${p.sev}">${fcEsc(p.text)}</div>${fcSrcHtml(p)}`).join('')}</td>`
    + `<td class="fc-fix">${sug ? `<div><b>Suggested family:</b> ${fcEsc(sug)}</div>` : ''}${probs.map(p => (p.fix.text ? `<div>${p.fix.kind === 'hand' ? '<b>Fix by hand:</b> ' : ''}${fcEsc(p.fix.text)}</div>` : '')).join('')}${FC.note[key] ? `<div class="fc-note">${fcEsc(FC.note[key])}</div>` : ''}</td>`
    + `<td class="fc-acts">${btns}${ask}</td></tr>`;
}
// The ASIN row's other SKUs: our own ("also RTC78-6060", and the grey "2 SKUs on one ASIN" — information, not an error, not counted) and
// Amazon's resale SKUs ("Amazon resale SKU: amzn.gr.…").
function fcSkusHtml(c) {
  const more = (c.skus || []).filter(x => x !== c.sku);
  return (more.length ? `<small class="fc-also">also ${more.map(fcEsc).join(', ')} <span class="fc-chip is-g">${fcNf(more.length + 1)} SKUs on one ASIN</span></small>` : '')
    + (c.resale || []).map(x => `<small class="fc-also">Amazon resale SKU: ${fcEsc(x)}</small>`).join('');
}
const FC_COLHEAD = '<tr class="fc-colh"><th class="fc-tk"></th><th>SKU</th><th>ASIN</th><th>Amazon values</th><th class="num">Stock</th><th>Problem</th><th>Suggested fix</th><th></th></tr>';
// One family: a single line while closed (chips from what is in memory); open, its column header and its children's rows.
function fcGroupHtml(g) {
  const f = g.f;
  const open = FC.open === f.fk;
  const n = k => g.rows.filter(r => r.probs.some(p => p.k === k)).length;
  const chips = FC_KINDS.map(k => (n(k.k) ? `<span class="fc-chip is-${k.sev}">${fcNf(n(k.k))} ${fcEsc(k.t.toLowerCase())}</span>` : '')).join('');
  const multi = f.live.filter(c => (c.skus || []).length > 1).length;
  const info = multi ? `<span class="fc-chip is-g">${multi === 1 ? fcNf(f.live.find(c => c.skus.length > 1).skus.length) + ' SKUs on one ASIN' : fcNf(multi) + ' ASINs with 2+ SKUs'}</span>` : '';
  const busy = FC.reading.has(f.fk);
  const state = busy ? ' <span class="fc-reading">Reading from Amazon…</span>'
    : FC.failed.has(f.fk) ? '<span class="fc-chip is-g">Amazon could not be read</span>' : !f.read ? '<span class="fc-chip is-g">not read</span>' : '';
  const orph = g.rows.filter(r => fcTickKind(r) === 'orphan').map(r => fcKey(r.c.brand, r.c.sku));
  const allOn = orph.length && orph.every(k => FC.sel.has(k));
  const selAll = open && orph.length ? ` <button type="button" class="ghost fc-b fc-selall" data-fc="selfam" data-fc-v="${fcEsc(f.fk)}">${allOn ? 'Clear this family' : 'Select all in this family'}</button>` : '';
  const again = open ? ` <button type="button" class="ghost fc-b fc-selall" data-fc="reread" data-fc-v="${fcEsc(f.fk)}"${busy ? ' disabled' : ''}>Read again</button>` : '';
  const theme = f.amz ? ` · theme ${f.amz.theme || '—'}${f.amz.tattrs.length ? ' (' + f.amz.tattrs.join(', ') + ')' : ''} · read ${fcAgo(f.amz.at)}` : '';
  return `<tbody class="fc-grp${open ? ' is-open' : ''}"><tr class="fc-head" data-fc="grp" data-fc-v="${fcEsc(f.fk)}" tabindex="0" aria-expanded="${open}"><td colspan="${FC_COLS}">`
    + `<button type="button" class="fc-arrow" data-fc="grp" data-fc-v="${fcEsc(f.fk)}" aria-label="${open ? 'Close' : 'Open'} ${fcEsc(f.name)}">${open ? '▾' : '▸'}</button>`
    + `<b>${fcEsc(f.name)}</b> <small class="muted">${fcEsc(fcBrandName(f.brand))} · parent SKU ${fcEsc(f.psku || '—')} · ${fcEsc(f.pa || '—')} · ${fcNf(f.live.length)} live children${fcEsc(theme)}</small> ${chips}${info}${state}${selAll}${again}</td></tr>`
    + (open ? fcMapHtml(g) + FC_COLHEAD + g.rows.map(fcRowHtml).join('') : '') + '</tbody>';
}
/** The open family as a small picture (roadmap #4): the parent box on top, one box per live child with its Amazon values and a status —
 *  Linked / Not in family / Duplicate / Relinked ✓ (after Amazon accepted a Link) / not read — and two numbers: the children Amazon shows under
 *  this parent of all live children, and the orphans found. Drawing only: the same data as the rows. Removed-on-purpose children stay hidden. */
function fcMapHtml(g) {
  const f = g.f, v = FC.view;
  const removed = new Set(v ? v.removed : []);
  const rowOf = new Map(g.rows.map(r => [r.c, r]));
  const kids = [];
  const add = c => { if (c && !removed.has(c) && !kids.includes(c)) kids.push(c); };
  f.live.forEach(add);
  g.rows.forEach(r => add(r.c));
  if (v) v.cands.forEach(c => { if (FC.relinked.get(fcKey(c.brand, c.sku)) === f.fk) add(c); });   // a linked parentless one leaves the rows
  const tattrs = f.amz && f.amz.tattrs ? f.amz.tattrs : [];
  const label = c => {
    const vals = c.amz && c.amz.vals;
    const t = (c.tattrs || tattrs).map(a => (vals && vals[a]) || '').filter(Boolean);
    return t.length ? t.join(' / ') : '';
  };
  const status = c => {
    const r = rowOf.get(c), has = k => !!(r && r.probs.some(p => p.k === k));
    if (FC.relinked.get(fcKey(c.brand, c.sku)) === f.fk) return ['ok', 'Relinked ✓'];
    if (has('orphan')) return ['r', 'Not in family'];
    if (has('dup')) return ['r', 'Duplicate'];
    if (c.amz && !c.amz.nf && c.amz.pa) return ['l', 'Linked'];
    return ['g', 'not read'];
  };
  const shown = c => !!(c.amz && !c.amz.nf && c.amz.pa && (!f.pa || c.amz.pa === f.pa));
  kids.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }) || String(a.sku).localeCompare(String(b.sku)));
  const visible = kids.filter(shown).length;
  const orphans = g.rows.filter(r => r.probs.some(p => p.k === 'orphan')).length;
  const rated = kids.filter(c => c.rt);
  const box = c => {
    const [k, t] = status(c), l = label(c);
    return `<div class="fc-kid is-${k}"><b>${l ? fcEsc(l) : '<span class="fc-none">—</span>'}</b><small>${fcEsc(c.sku)}</small>`
      + (c.rt ? `<small>${fcEsc(c.rt.rating)} ★ (${fcNf(c.rt.reviews)})</small>` : '') + `<span class="fc-chip is-${k === 'l' || k === 'ok' ? 'ok' : k}">${fcEsc(t)}</span></div>`;
  };
  return `<tr class="fc-mapr"><td colspan="${FC_COLS}"><div class="fc-map" role="group" aria-label="${fcEsc(f.name)} — family picture">`
    + `<div class="fc-par"><span>Parent</span><b>${fcEsc(f.psku || f.pa || '—')}</b><small>${fcEsc(f.pa || '—')}${f.amz && f.amz.theme ? ' · ' + fcEsc(f.amz.theme) : ''}</small></div>`
    + `<div class="fc-kids">${kids.map(box).join('') || '<span class="fc-none">no live children</span>'}</div>`
    + `<div class="fc-nums"><span><b>${fcNf(visible)} of ${fcNf(kids.length)}</b> sizes visible to shoppers</span><span><b>${fcNf(orphans)}</b> orphan${orphans === 1 ? '' : 's'} found</span>`
    + `<span class="fc-revs">${rated.length ? `reviews: from Sellora's data for ${fcNf(rated.length)} of ${fcNf(kids.length)}` : 'reviews: not available (Amazon doesn\'t provide them)'}</span></div>`
    + '</div></td></tr>';
}
/** What is ticked, as rows still on the page: { orphan: [c…], fix: [c…] } (a tick whose row has gone is dropped). */
function fcSelected(v) {
  const out = { orphan: [], fix: [] };
  const seen = new Set();
  v.groups.forEach(g => g.rows.forEach(r => {
    const key = fcKey(r.c.brand, r.c.sku), kind = fcTickKind(r);
    if (!kind || !FC.sel.has(key)) return;
    seen.add(key);
    out[kind].push(r.c);
  }));
  [...FC.sel].forEach(k => { if (!seen.has(k)) FC.sel.delete(k); });
  return out;
}
// The bar while something is ticked: "N selected · [Removed on purpose (N)] [Link to family (N)] [Open in Listing Errors (N)] [Clear]".
function fcBarHtml(v) {
  const s = fcSelected(v);
  const total = s.orphan.length + s.fix.length;
  if (!total) { FC.bulkAsk = false; return ''; }
  const linkWhy = s.orphan.length ? fcLinkWhyNot(s.orphan, v) : '';
  const brands = new Set(s.fix.map(c => c.brand));
  const lerrWhy = brands.size > 1 ? 'Listing Errors shows one brand at a time — tick one brand\'s listings.' : '';
  const busy = s.orphan.some(c => FC.busy.has(fcKey(c.brand, c.sku)));
  const btn = (act, text, why) => `<button type="button" class="fc-b${act === 'bclear' ? ' ghost' : ''}" data-fc="${act}"${why ? ` disabled title="${fcEsc(why)}"` : ''}${busy && act !== 'bclear' ? ' disabled' : ''}>${text}</button>`;
  const ask = FC.bulkAsk && s.orphan.length ? `<span class="fc-ask"><label>Reason for all ${fcNf(s.orphan.length)} <input type="text" data-fc-f="breason" value="${fcEsc(FC.bulkReason || FC_REASON)}" maxlength="120"></label>`
    + `<button type="button" class="fc-b" data-fc="boksave">Save</button><button type="button" class="ghost fc-b" data-fc="bokcancel">Cancel</button></span>` : '';
  const whys = [linkWhy, lerrWhy, FC.bulkMsg].filter(Boolean);
  return `<div class="fc-bar" role="region" aria-label="Ticked listings"><b>${fcNf(total)} selected</b>`
    + (s.orphan.length ? btn('bok', `Removed on purpose (${fcNf(s.orphan.length)})`) + btn('blink', `Link to family (${fcNf(s.orphan.length)})`, linkWhy) : '')
    + (s.fix.length ? btn('blerr', `Open in Listing Errors (${fcNf(s.fix.length)})`, lerrWhy) : '') + btn('bclear', 'Clear') + ask
    + (whys.length ? `<div class="fc-why">${whys.map(fcEsc).join(' ')}</div>` : '') + '</div>';
}
function fcDrawBody(v) {
  const body = $('fcBody');
  const prog = fcCatProgress(v);
  const cards = FC_KINDS.map(k => `<button type="button" class="fc-box is-${k.sev}${FC.card === k.k ? ' is-on' : ''}" data-fc="card" data-fc-v="${k.k}" aria-pressed="${FC.card === k.k}" title="${fcEsc(k.tip)}">`
    + `<span>${fcEsc(k.t)}</span><b>${fcNf(fcCount(v, k.k))}</b><small>${prog.busy ? `Reading Amazon… ${fcNf(prog.done)} of ${fcNf(prog.total)}` : k.sev === 'r' ? 'error' : 'check'}</small></button>`).join('');
  const groups = fcGroups(v);
  if (FC.open && !groups.some(g => g.f.fk === FC.open)) FC.open = '';
  const shown = groups.slice(0, FC.limit);
  const more = groups.length - shown.length;
  const table = groups.length ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl">${shown.map(fcGroupHtml).join('')}</table></div>`
    + (more ? `<div class="fc-more" id="fcMore"><button type="button" class="ghost" data-fc="more">Show more families (${fcNf(more)} left)</button></div>` : '')
    : `<div class="card fc-empty">${v.live ? '<b>No family problems</b> in the live children' + (FC.card || FC.q || FC.brand !== 'ALL' ? ' that match these filters.' : '.') : '<b>No live children to check</b> — the snapshots are empty or nothing is buyable and in stock.'}</div>`;
  const rem = fcRemoved(v);
  const removed = rem.length ? `<div class="fc-rem"><button type="button" class="fc-link" data-fc="showok" aria-expanded="${FC.showOk}">${fcNf(rem.length)} removed on purpose › ${FC.showOk ? 'Hide' : 'Show'}</button>`
    + (FC.showOk ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl"><thead><tr><th>SKU</th><th>ASIN</th><th>Family it would join</th><th>Reason</th><th>Who · when</th><th></th></tr></thead><tbody>${rem.map(c => {
      const e = (FC.ok[c.brand] || {})[c.sku] || {};
      const auto = c.why === 'rating';
      const fam = (FC.view && FC.view.families.find(f => f.fk === c.fk || (c.sug && f.fk === c.sug.fk))) || null;
      return `<tr><td><b>${fcEsc(c.sku)}</b></td><td class="ui-mono">${fcEsc(c.asin || '—')}</td><td>${fcEsc(fam ? fam.name : '')}</td><td>${auto ? `rating ${fcEsc(c.rt.rating)} ★ (${fcNf(c.rt.reviews)} reviews) — automatic` : fcEsc(e.reason || FC_REASON)}</td>`
        + `<td>${auto ? '—' : fcEsc(e.name || fcName(e.by)) + ' · ' + fcEsc(e.at ? fcWhen(e.at) : '')}</td><td>${auto ? '' : `<button type="button" class="ghost fc-b" data-fc="undo" data-fc-b="${fcEsc(c.brand)}" data-fc-s="${fcEsc(c.sku)}">Undo</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>` : '') + '</div>' : '';
  body.innerHTML = `<div class="fc-boxes">${cards}</div>${table}${fcBarHtml(v)}${removed}`;
  fcWatchMore();
}
// "Show more" comes in by itself when it scrolls near the screen.
function fcWatchMore() {
  if (typeof IntersectionObserver !== 'function') return;
  if (!FC.io) FC.io = new IntersectionObserver(seen => { if (seen.some(e => e.isIntersecting)) { FC.limit += FC_STEP; fcDrawAll(); } }, { rootMargin: '400px' });
  FC.io.disconnect();
  const more = $('fcMore');
  if (more) FC.io.observe(more);
}
// A card's number: the live children with that problem, within the brand and search filters (the card itself is not a filter on its own count).
function fcCount(v, k) {
  const card = FC.card;
  FC.card = '';
  const n = fcGroups(v).reduce((sum, g) => sum + g.rows.filter(r => r.probs.some(p => p.k === k)).length, 0);
  FC.card = card;
  return n;
}
// The removed-on-purpose children still to list: live, still without a parent on Amazon (a linked or no-longer-live child is simply not here).
const fcRemoved = v => v.removed.filter(c => FC.brand === 'ALL' || c.brand === FC.brand);

/* ----- open / close (one family at a time) ----- */
/** Open a family (closing the one open before) or close it. Opening reads it from Amazon (if not kept); the clicked line stays where it was. */
function fcToggle(fk, el) {
  const line = el && el.closest ? el.closest('.fc-head') || el : null;
  const top0 = line && line.getBoundingClientRect ? line.getBoundingClientRect().top : null;
  FC.open = FC.open === fk ? '' : fk;
  if (FC.open) fcReadCat(fk);
  else fcPump();                                                           // closed: the background reads go on
  fcDrawAll();
  if (top0 == null || typeof document === 'undefined' || !document.querySelector) return;
  const again = document.querySelector(`#fcBody .fc-head[data-fc-v="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(fk) : fk}"]`);
  if (again && again.getBoundingClientRect && typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, again.getBoundingClientRect().top - top0);
}

/* ----- events ----- */
function fcClick(el) {
  const act = el.dataset.fc, v = el.dataset.fcV, brand = el.dataset.fcB, sku = el.dataset.fcS;
  const view = () => FC.view || fcBuild();
  if (act === 'tab') { FC.tab = v; FC.built = false; return fcDrawAll(); }
  if (act === 'card') { FC.card = FC.card === v ? '' : v; FC.limit = FC_STEP; return fcDrawAll(); }
  if (act === 'grp') return fcToggle(v, el);
  if (act === 'reread') { fcReadCat(v, true); return fcDrawAll(); }
  if (act === 'refresh') return fcRefresh();
  if (act === 'more') { FC.limit += FC_STEP; return fcDrawAll(); }
  if (act === 'link') return fcLink(brand, sku);
  if (act === 'set') return fcSetValue(brand, sku, el.dataset.fcK);
  if (act === 'lerr') return fcOpenLerr(brand, sku);
  if (act === 'ok') { FC.ask = fcKey(brand, sku); return fcDrawAll(); }
  if (act === 'okcancel') { FC.ask = ''; return fcDrawAll(); }
  if (act === 'oksave') {
    const box = el.closest ? el.closest('.fc-ask') : null;
    const input = box && box.querySelector ? box.querySelector('input') : null;
    return fcOkSet(brand, sku, input ? input.value : FC_REASON);
  }
  if (act === 'undo') return fcOkUndo(brand, sku);
  if (act === 'showok') { FC.showOk = !FC.showOk; return fcDrawAll(); }
  if (act === 'csv') return fcDownload();
  // ticks and the bar
  if (act === 'tick') { const k = fcKey(brand, sku); if (FC.sel.has(k)) FC.sel.delete(k); else FC.sel.add(k); FC.bulkMsg = ''; return fcDrawAll(); }
  if (act === 'selfam') {
    const g = view().groups.find(x => x.f.fk === v);
    const keys = g ? g.rows.filter(r => fcTickKind(r) === 'orphan').map(r => fcKey(r.c.brand, r.c.sku)) : [];
    const allOn = keys.length && keys.every(k => FC.sel.has(k));
    keys.forEach(k => (allOn ? FC.sel.delete(k) : FC.sel.add(k)));
    FC.bulkMsg = '';
    return fcDrawAll();
  }
  if (act === 'bclear') { FC.sel.clear(); FC.bulkAsk = false; FC.bulkMsg = ''; return fcDrawAll(); }
  if (act === 'bok') { FC.bulkAsk = true; FC.bulkReason = FC_REASON; return fcDrawAll(); }
  if (act === 'bokcancel') { FC.bulkAsk = false; return fcDrawAll(); }
  if (act === 'boksave') return fcOkSetMany(fcSelected(view()).orphan.map(c => fcKey(c.brand, c.sku)), FC.bulkReason || FC_REASON);
  if (act === 'blink') return fcLinkMany(fcSelected(view()).orphan.map(c => fcKey(c.brand, c.sku)));
  if (act === 'blerr') {
    const list = fcSelected(view()).fix;
    if (!list.length || new Set(list.map(c => c.brand)).size > 1) return null;
    return fcOpenLerr(list[0].brand, list.map(c => c.sku));
  }
}
let FC_T = 0;
function fcFilter(el) {
  const k = el.dataset.fcF;
  if (k === 'reason') return;
  if (k === 'breason') { FC.bulkReason = el.value; return; }
  FC[k] = el.value;
  FC.limit = FC_STEP;
  clearTimeout(FC_T);
  if (k === 'q') FC_T = setTimeout(fcDrawAll, 200);
  else fcDrawAll();
}
/** Opening the page: the snapshots Sellora already holds (read once), the saved marks, then draw — every family closed — and Amazon's catalog
 *  for every family not read before, in the background. */
async function fcOpen() {
  fcShell();
  fcDrawAll();
  if (FC.loaded || FC.loading) return;
  FC.loading = true;
  try {
    if (typeof loadParentNames === 'function') await loadParentNames();
    if (typeof H_LOADED !== 'undefined' && !H_LOADED && typeof loadHealthCache === 'function') await loadHealthCache();
    for (const b of ['SP', 'CPC']) if (typeof IML !== 'undefined' && !(b in IML) && typeof imListLoad === 'function') await imListLoad(b);
    await fcOkLoad();
    if (typeof lrLoadCatalog === 'function' && typeof LR_CAT !== 'undefined' && (!LR_CAT.SP || !LR_CAT.CPC)) lrLoadCatalog().then(fcSchedule).catch(() => {});
  } catch (e) {
    FC.err = 'Could not read the snapshots: ' + ((e && e.message) || e);
  }
  FC.loading = false;
  FC.loaded = true;
  fcBuild();
  fcWatchNewer();
  fcReadAllCat();                                                          // queued first, so the cards say "Reading Amazon… 0 of N" at once
  fcDrawAll();
}
const fcPaneOn = () => { const pane = $('paneFam'); return !!(pane && !pane.classList.contains('hide')); };
if (typeof document !== 'undefined' && document.addEventListener && $('fcPane')) {
  $('fcPane').addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-fc]') : null;
    if (el && !el.disabled) fcClick(el);
  });
  $('fcPane').addEventListener('keydown', e => {
    const t = e.target && e.target.dataset ? e.target : null;
    if (t && (e.key === 'Enter' || e.key === ' ') && t.dataset.fc === 'grp' && t.tagName !== 'BUTTON') { e.preventDefault(); fcClick(t); }
    if (t && e.key === 'Enter' && (t.dataset.fcF === 'reason' || t.dataset.fcF === 'breason')) {
      e.preventDefault();
      const b = t.closest('.fc-ask').querySelector(t.dataset.fcF === 'reason' ? '[data-fc="oksave"]' : '[data-fc="boksave"]');
      if (b) fcClick(b);
    }
  });
  $('fcPane').addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.fcF) fcFilter(e.target); });
  $('fcPane').addEventListener('input', e => { if (e.target && e.target.dataset && (e.target.dataset.fcF === 'q' || e.target.dataset.fcF === 'breason')) fcFilter(e.target); });
  // Esc closes the open family (not while Amazon's check popup is open — Esc is that popup's)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !FC.open || !fcPaneOn() || (typeof sqIsOpen === 'function' && sqIsOpen())) return;
    FC.open = '';
    fcPump();
    fcDrawAll();
  });
  const pane = $('paneFam');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) fcOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
}
