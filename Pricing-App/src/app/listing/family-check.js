/* ================= LISTING · FAMILY & CATEGORY CHECK: children that left their family, and families that are built wrong (roadmap #4) =================
 * Screens: Listing → 2 · Check → Family & Category Check (tab 'fam', #paneFam, drawn whole into #fcPane). Two tabs: Families (this file)
 *       and Categories (a placeholder until the automatic refresh reads browse nodes).
 * Who sees it: whoever has Listing Health (TAB_INHERIT fam: 'health' in core/nav.js); the saved marks are guarded by the listingrules rule
 *       (can('health') || can('lrules')), the same as the Listing Health data.
 * Data (nothing new is read in bulk — only what Sellora already holds):
 *   • the Image Manager snapshot (IML[brand].items, imgsnap/imgrows): status (BUYABLE…), product type, title, parentage level, the parent SKU
 *     our listing names (psku), colour (c), size (z), and the parent ASIN the catalogue shows (pa);
 *   • the Listing Health snapshot (HEALTH[brand].rows): stock (qty) and the parent ASIN of the listings report;
 *   • the brand catalogue (LR_CAT, the workbook): the colour and size WE gave a SKU — the only value a fix may send by itself;
 *   • ?lfix=get, one listing at a time, only for the family being opened, and right before a fix: the variation theme, which no
 *     snapshot keeps, and the current values a fix replaces. Those reads are kept in this browser for 14 days (fresher than the snapshot only).
 * RULE 1 — only LIVE children: buyable (status has BUYABLE) AND stock > 0. Anything else is not shown and not counted, anywhere on this page.
 * RULE 2 — Not in family (red): a live child with no parent (no parent SKU on our listing, no parent ASIN in the catalogue or the report)
 *       whose SKU (RTC14-7 next to RTC14-1…6), product type and title clearly belong to ONE existing family. A rating below 4 (if Sellora ever
 *       holds ratings: fcRating) counts as removed on purpose by itself; no rating, 0 reviews or 4+ is an error.
 * RULE 3 — Removed on purpose: the team's mark (reason, default "low rating"), saved with who / when / reason in listingrules/famok_<brand>
 *       (the collection Sellora keeps listing data in: the catalogue, the season log). Marked children never show as errors again; the page
 *       shows only "N removed on purpose › Show" (with Undo). A child that is linked again or stops being live leaves every list by itself.
 * Other problems, live children only: Duplicate colour + size in one family (red) · Missing colour or size for the family's theme (red) ·
 *       Different variation theme than its siblings (yellow).
 * Fixes go through THE ONE SEND PATH (sqSendWithCheck: Amazon's check → Approve & send → read again → Listing History): Link to family
 *       (parentage_level, child_parent_sku_relationship, variation_theme) and Set colour/size (the catalogue's value). Only values that are
 *       certain; anything else is "Fix by hand" with Open in Listing Errors.
 * No backend change. No other screen's data or counts change: this file only reads HEALTH / IML / LR_CAT and keeps its own state in FC.
 * The list: every family one closed line (chips from what is in memory); ONE family open at a time (fcToggle — the clicked line stays put,
 *       Esc closes it), its children drawn only then and its theme read then (fcReadFamily). Ticks on "Not in family" and duplicate /
 *       missing rows; the bar: Removed on purpose (N, one reason) · Link to family (N, one family only) · Open in Listing Errors (N).
 * Main functions: fcBuild, fcSuggest, fcProblems, fcDrawAll, fcToggle, fcReadFamily, fcLinkMany, fcSetValue, fcOkSetMany, fcOkUndo, fcCsv, fcOpen. */

const FC_STEP = 60;                                  // family lines drawn at a time; more as the list scrolls
const FC_INFLIGHT = 2;                               // ?lfix=get reads out at once
const FC_READ_DAYS = 14;                             // a kept read is used this long (and only when newer than the snapshot)
const FC_STORE = 'fcReads1';                         // this browser's copy of the reads (localStorage)
const FC_STORE_MAX = 8000;                           // reads kept at most
const FC_OK_COLL = 'listingrules';                   // where the "removed on purpose" marks are saved (existing collection, existing rule)
const FC_OK_DOC = brand => 'famok_' + brand;
const FC_REASON = 'low rating';
const FC_KINDS = [
  { k: 'orphan', t: 'Not in family', sev: 'r', tip: 'Live children with no parent that clearly belong to a family.' },
  { k: 'dup', t: 'Duplicate colour/size', sev: 'r', tip: 'Two live children of one family with the same colour and size.' },
  { k: 'missing', t: 'Missing value', sev: 'r', tip: 'A live child without the colour or size its family varies by.' },
  { k: 'theme', t: 'Different theme', sev: 'y', tip: 'A live child whose variation theme is not the one its siblings use.' },
];
let FC = { tab: 'fam', brand: 'ALL', q: '', card: '', built: false, loading: false, loaded: false, err: '', msg: '',
  got: {}, gotLoaded: false, ok: { SP: {}, CPC: {} }, okLoaded: false, okNote: '', showOk: false, ask: '', busy: new Set(), note: {},
  open: '',                     // the ONE open family (fk); '' = all closed
  sel: new Set(), bulkAsk: false, bulkReason: '', bulkMsg: '',   // the ticked rows ("brand|sku") and the bar's reason box
  limit: FC_STEP, order: null, io: null,                         // family lines drawn so far; the order they were first drawn in
  reading: new Map(), reads: { q: [], inflight: 0, fails: 0 }, view: null, drawT: 0 };   // reading: fk → theme reads still out
const fcEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const fcNf = n => Number(n || 0).toLocaleString('en-US');
const fcKey = (brand, sku) => brand + '|' + sku;
const fcNorm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const fcBrandName = b => (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[b]) || b;
const fcIsTest = () => typeof window !== 'undefined' && !!window.__TEST_ERP;
const fcWho = () => (typeof ME !== 'undefined' && ME && ME.email) || '';
const fcName = email => (typeof sqName === 'function' ? sqName(email) : String(email || '').split('@')[0]);
const fcAgo = ms => { if (!ms) return 'never'; const h = (Date.now() - ms) / 36e5; return h < 1 ? 'under an hour ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago'; };
const fcWhen = at => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ----- small rules ----- */
/** A variation theme as a comparable key: "SIZE/COLOR", "SizeName-ColorName", "color_size" → "COLOR+SIZE". '' when none. */
function fcTheme(name) {
  const words = String(name || '').toUpperCase().replace(/COLOUR/g, 'COLOR').split(/[^A-Z]+/).filter(Boolean)
    .map(w => (w.length > 4 ? w.replace(/NAME$/, '') : w)).filter(Boolean);
  return [...new Set(words)].sort().join('+');
}
const fcThemeDims = key => ({ c: /(^|\+)COLOR(\+|$)/.test(key), s: /(^|\+)SIZE(\+|$)/.test(key) });
/** A theme made only of colour and/or size: the values Sellora holds can judge it. Any other part (SET_NAME, STYLE, PATTERN…) needs Amazon's
 *  own theme attributes (?lfix=cat, not live yet) — until then such a family gets no Duplicate / Missing value, only "Waiting for Amazon theme data". */
const fcCsOnly = key => /^(COLOR|SIZE|COLOR\+SIZE)$/.test(key);
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

/* ----- the reads (?lfix=get), kept in this browser ----- */
function fcGotLoad() {
  if (FC.gotLoaded) return;
  FC.gotLoaded = true;
  try {
    const data = JSON.parse(localStorage.getItem(FC_STORE) || 'null');
    const cut = Date.now() - FC_READ_DAYS * 864e5;
    if (data && data.got) Object.entries(data.got).forEach(([k, v]) => { if (v && v.at > cut) FC.got[k] = v; });
  } catch (e) { /* no storage: reads live for this visit only */ }
}
function fcGotSave() {
  try {
    const all = Object.entries(FC.got).sort((a, b) => b[1].at - a[1].at).slice(0, FC_STORE_MAX);
    localStorage.setItem(FC_STORE, JSON.stringify({ v: 1, got: Object.fromEntries(all) }));
  } catch (e) { /* quota: the copy in memory still works */ }
}
/** One ?lfix=get answer → what this page keeps: the theme (as Amazon wrote it), colour, size, parent SKU, parentage, the product type. */
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
// The read used for a SKU: only when it is newer than the Image Manager snapshot it would replace.
function fcRead(brand, sku) {
  const r = FC.got[fcKey(brand, sku)];
  if (!r) return null;
  const snapAt = typeof IML !== 'undefined' && IML[brand] && IML[brand].at ? IML[brand].at.getTime() : 0;
  return r.at > snapAt ? r : null;
}
// Queue reads (two at a time); `fk` is the family they are for (its header says "Reading theme…" until the last lands).
function fcQueueReads(list, fk) {
  const R = FC.reads;
  const have = new Set(R.q.map(j => fcKey(j.brand, j.sku)));
  let n = 0;
  list.forEach(j => { const k = fcKey(j.brand, j.sku); if (!have.has(k)) { have.add(k); R.q.push(Object.assign({ fk: fk || '' }, j)); n++; } });
  if (n && fk) FC.reading.set(fk, (FC.reading.get(fk) || 0) + n);
  fcPump();
  return n;
}
function fcPump() {
  const R = FC.reads;
  while (R.inflight < FC_INFLIGHT && R.q.length) {
    const job = R.q.shift();
    R.inflight++;
    fcReadOne(job.brand, job.sku).catch(() => { R.fails++; }).then(() => {
      R.inflight--;
      if (job.fk && FC.reading.has(job.fk)) {
        const left = FC.reading.get(job.fk) - 1;
        if (left > 0) FC.reading.set(job.fk, left);
        else FC.reading.delete(job.fk);
      }
      if (!R.q.length && !R.inflight) fcGotSave();
      fcSchedule();
      fcPump();
    });
  }
}
/** A family was opened: read its variation theme — its parent, and its live children (for "Different theme") — only the ones this
 *  session or the saved copy (this browser, FC_READ_DAYS) does not hold yet. Nothing is read for a closed family. */
function fcReadFamily(fk) {
  const v = FC.view || fcBuild();
  const f = v.families.find(x => x.fk === fk);
  if (!f) return 0;
  const jobs = [];
  if (f.psku && !fcRead(f.brand, f.psku)) jobs.push({ brand: f.brand, sku: f.psku });
  f.live.forEach(c => { if (!fcRead(c.brand, c.sku)) jobs.push({ brand: c.brand, sku: c.sku }); });
  return fcQueueReads(jobs, fk);
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
/** Removed on purpose, for one or many children (keys "brand|sku"), one reason for all: they leave the red list at once and for good;
 *  who / when / reason are saved. */
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

/* ----- building the picture: families, live children, the orphans and their suggested family ----- */
/** Everything the page shows, from the data in memory. { families, orphans, removed, kids, counts, notes, rating } — live children only. */
function fcBuild() {
  fcGotLoad();
  const families = new Map();                       // fk → family
  const orphans = [];
  const removed = [];
  const stemFams = new Map();                        // stem → Map(fk → children with that stem)
  const notes = [];
  let live = 0, all = 0, ratingFound = 0;
  ['SP', 'CPC'].forEach(brand => {
    const snap = typeof IML !== 'undefined' ? IML[brand] : null;
    const items = (snap && snap.items) || [];
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
    items.forEach(it => {
      if (/^parent$/i.test(it.lvl || '')) return;
      all++;
      const row = rowOf.get(it.sku) || null;
      const read = fcRead(brand, it.sku);
      const stock = row && row.qty != null ? Number(row.qty) : null;
      const isLive = /BUYABLE/.test(String(it.st || '')) && stock != null && stock > 0;
      const pa = it.pa || (row && row.parent && row.parent !== row.asin ? row.parent : '') || '';
      const psku = (read ? read.psku : it.psku) || (pa ? parentByAsin.get(pa) || '' : '');   // a fresh read wins over the snapshot's parent SKU
      const fk = psku ? brand + '|S:' + psku : pa ? brand + '|A:' + pa : '';
      const rt = fcRating(it, row);
      if (rt) ratingFound++;
      const c = { brand, sku: it.sku, asin: it.asin || (row && row.asin) || '', title: it.t || (row && row.title) || '', pt: (read && read.pt) || it.pt || '',
        color: read ? read.color : it.c || '', size: read ? read.size : it.z || '', theme: read ? read.theme : null, stock, live: isLive, fk, rt,
        stem: fcStem(it.sku), cat: (typeof LR_CAT !== 'undefined' && LR_CAT[brand] && LR_CAT[brand][it.sku]) || null };
      if (fk) {
        const f = famOf(fk, psku, pa);
        f.kids.push(c);
        if (c.pt) f.pts[c.pt] = (f.pts[c.pt] || 0) + 1;
        if (!f.title && c.title) f.title = c.title;
        if (c.stem && isLive) {                                                 // the evidence counts live children only (rule 1)
          const m = stemFams.get(brand + '|' + c.stem) || new Map();
          m.set(fk, (m.get(fk) || 0) + 1);
          stemFams.set(brand + '|' + c.stem, m);
        }
        if (isLive) { f.live.push(c); live++; }
      } else if (isLive) {
        live++;
        orphans.push(c);
      }
    });
  });
  families.forEach(f => {
    f.pt = Object.entries(f.pts).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
    f.name = (typeof parentName === 'function' && f.pa ? parentName(f.brand, f.pa, f.title) : '') || f.title || f.psku || f.pa;
  });
  // the orphans: which family each clearly belongs to (or none — a product of its own)
  const kept = [];
  orphans.forEach(c => {
    c.sug = fcSuggest(c, families, stemFams);
    if (!c.sug) return;                                                     // a product of its own: not an error
    if (fcIsOk(c.brand, c.sku)) { removed.push(Object.assign(c, { why: 'team' })); return; }
    if (fcLowRated(c.rt)) { removed.push(Object.assign(c, { why: 'rating' })); return; }
    kept.push(c);
  });
  const v = { families: [...families.values()], orphans: kept, removed, live, all, notes, ratingFound, at: Date.now() };
  fcProblems(v);
  FC.view = v;
  return v;
}
/** The one family a child with no parent clearly belongs to: { fk, psku, pa, name, why } or null. SKU stem first, then the title alone. */
function fcSuggest(c, families, stemFams) {
  let fam = null, why = [];
  const m = c.stem ? stemFams.get(c.brand + '|' + c.stem) : null;
  if (m) {
    const fks = [...m.entries()].filter(([, n]) => n >= 1);
    if (fks.length === 1 && fks[0][1] >= 2) {                                // the stem is ONE family's, with at least two children
      fam = families.get(fks[0][0]);
      why.push(`SKU like ${fks[0][1]} children of this family (${c.stem}-…)`);
      const alike = fam ? Math.max(0, ...fam.kids.map(k => fcAlike(c.title, k.title) || 0)) : 0;
      if (fam && c.title && fam.kids.some(k => k.title) && alike < 0.3) fam = null;   // a different product with a reused SKU stem: not clear
      else if (alike >= 0.3) why.push('the title matches');
    }
  }
  if (!fam && c.title) {                                                    // no SKU clue: a title nearly the same as one family's (and no other)
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
  if (c.pt && fam.pt && c.pt !== fam.pt) return null;                        // another product type: not the same family
  if (c.pt && fam.pt) why.push('same product type');
  return { fk: fam.fk, psku: fam.psku, pa: fam.pa, name: fam.name, why: why.join(' · ') };
}
/** The family's theme: the parent's read, else what most read children say. { key, raw, src: 'parent' | 'children' | '' }. */
function fcFamTheme(f) {
  const p = f.psku ? fcRead(f.brand, f.psku) : null;
  if (p && p.theme) return { key: fcTheme(p.theme), raw: p.theme, src: 'parent' };
  const counts = {};
  const raws = {};
  f.live.forEach(c => { if (c.theme) { const k = fcTheme(c.theme); counts[k] = (counts[k] || 0) + 1; raws[k] = raws[k] || c.theme; } });
  const read = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2 && top[1] > read / 2) return { key: top[0], raw: raws[top[0]], src: 'children' };
  return { key: '', raw: '', src: '' };
}
/** What the family varies by: from its theme when read, else from what most of its live children carry. */
function fcDims(f, theme) {
  if (theme.key) return Object.assign(fcThemeDims(theme.key), { src: 'theme' });
  const n = f.live.length;
  if (n < 2) return { c: false, s: false, src: '' };
  const has = k => f.live.filter(c => c[k]).length;
  return { c: has('color') / n >= 2 / 3, s: has('size') / n >= 2 / 3, src: 'children' };
}
const fcValKey = (c, d) => (d.c ? fcNorm(c.color) : '') + '|' + (d.s ? fcNorm(c.size) : '');
// The colour/size a child would carry after a catalogue fix (only the missing or clashing parts change).
function fcCatPlan(c, d, need) {
  if (!c.cat) return null;
  const set = {};
  if (d.c && need.c && c.cat.color && fcNorm(c.cat.color) !== fcNorm(c.color)) set.color = String(c.cat.color);
  if (d.s && need.s && c.cat.size && fcNorm(c.cat.size) !== fcNorm(c.size)) set.size = String(c.cat.size);
  return Object.keys(set).length ? set : null;
}
/** Every live child's problems, the family groups to draw and the card counts. */
function fcProblems(v) {
  const counts = { orphan: 0, dup: 0, missing: 0, theme: 0, wait: 0 };
  const groups = new Map();
  const group = f => groups.get(f.fk) || (groups.set(f.fk, { f, rows: [] }), groups.get(f.fk));
  const famByFk = new Map(v.families.map(f => [f.fk, f]));
  v.families.forEach(f => {
    const theme = fcFamTheme(f);
    const d = fcDims(f, theme);
    f.theme = theme;
    f.dims = d;
    f.wait = !!theme.key && !fcCsOnly(theme.key);         // e.g. COLOR/SET_NAME: colour + size alone cannot tell these children apart
    const byVal = new Map();
    if (d.c || d.s) f.live.forEach(c => {
      if ((d.c && !c.color) || (d.s && !c.size)) return;
      const k = fcValKey(c, d);
      byVal.set(k, (byVal.get(k) || []).concat([c]));
    });
    f.live.forEach(c => {
      const probs = [];
      const miss = { c: d.c && !c.color, s: d.s && !c.size };
      const same = (d.c || d.s) && !miss.c && !miss.s ? (byVal.get(fcValKey(c, d)) || []).filter(o => o !== c) : [];
      if (f.wait && (miss.c || miss.s || same.length)) probs.push({ k: 'wait', sev: 'g', text: `Waiting for Amazon theme data — the theme is ${theme.raw}`, fix: { kind: 'none', text: '' } });
      if (!f.wait && (miss.c || miss.s)) {
        const what = miss.c && miss.s ? 'colour and size' : miss.c ? 'colour' : 'size';
        const plan = fcCatPlan(c, d, miss);
        const after = plan ? Object.assign({}, c, plan) : null;
        const clash = after && (!d.c || after.color) && (!d.s || after.size) && (byVal.get(fcValKey(after, d)) || []).length > 0;
        probs.push({ k: 'missing', sev: 'r', text: `No ${what}` + (d.src === 'children' ? ' — most children of this family have one (theme not read yet)' : ` — the theme is ${theme.raw}`),
          fix: plan && !clash ? { kind: 'set', set: plan, text: 'Set ' + Object.entries(plan).map(([k, val]) => `${k === 'color' ? 'colour' : 'size'} "${val}"`).join(' and ') + ' (from the catalogue)' }
            : { kind: 'hand', text: plan ? 'The catalogue\'s value is already used by another child' : 'No certain value — the catalogue has none for this SKU' } });
      }
      if (!f.wait && same.length) {
        const plan = fcCatPlan(c, d, { c: true, s: true });
        const after = plan ? Object.assign({}, c, plan) : null;
        const free = after && !(byVal.get(fcValKey(after, d)) || []).some(o => o !== c);
        probs.push({ k: 'dup', sev: 'r', text: `Same ${[d.c ? 'colour' : '', d.s ? 'size' : ''].filter(Boolean).join(' + ')} as ${same.map(o => o.sku).join(', ')}`,
          fix: plan && free ? { kind: 'set', set: plan, text: 'Set ' + Object.entries(plan).map(([k, val]) => `${k === 'color' ? 'colour' : 'size'} "${val}"`).join(' and ') + ' (from the catalogue)' }
            : { kind: 'hand', text: 'Decide which child keeps it, then change the other' } });
      }
      if (theme.key && c.theme && fcTheme(c.theme) !== theme.key) {
        probs.push({ k: 'theme', sev: 'y', text: `Theme ${c.theme}; the family uses ${theme.raw}`, fix: { kind: 'hand', text: 'Change the theme in Listing Errors' } });
      }
      if (!probs.length) return;
      probs.forEach(p => { counts[p.k]++; });
      group(f).rows.push({ c, probs });
    });
  });
  v.orphans.forEach(c => {
    const f = famByFk.get(c.sug.fk);
    if (!f) return;
    const d = f.dims || { c: false, s: false };
    const lacks = (d.c && !c.color) || (d.s && !c.size);
    const clash = !lacks && !f.wait && (d.c || d.s) && f.live.some(o => fcValKey(o, d) === fcValKey(c, d));
    const fix = !f.psku ? { kind: 'hand', text: 'The family\'s parent SKU is not known here' }
      : !c.pt ? { kind: 'hand', text: 'This listing\'s product type is not known here' }
        : lacks ? { kind: 'hand', text: `It has no ${d.c && !c.color ? 'colour' : 'size'} — add it first` }
          : clash ? { kind: 'hand', text: 'Its colour + size is already used by a child of this family' }
            : { kind: 'link', text: `Link to ${f.psku}`, why: c.sug.why };
    counts.orphan++;
    group(f).rows.unshift({ c, probs: [{ k: 'orphan', sev: 'r', text: 'Not in family — ' + c.sug.why, fix }] });
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
/** Link to family, for one or many "Not in family" children (keys "brand|sku") — all of ONE suggested family. The family's theme is read
 *  from its parent; each child is read again (its current values, for the popup and Put back). A child that cannot be linked safely
 *  (no theme, no colour/size the theme needs, the same colour + size as a sibling or another ticked child, already linked) is held back
 *  and named in the popup — Fix by hand. Then Amazon's check popup (sqSendWithCheck). */
async function fcLinkMany(keys) {
  const v = FC.view || fcBuild();
  const list = keys.map(k => v.orphans.find(o => fcKey(o.brand, o.sku) === k)).filter(Boolean);
  if (!list.length || typeof sqSendWithCheck !== 'function') return null;
  const why = fcLinkWhyNot(list, v);
  if (why) { FC.bulkMsg = why; fcDrawAll(); return null; }
  const f = v.families.find(x => x.fk === list[0].sug.fk);
  const mine = list.map(c => fcKey(c.brand, c.sku));
  if (mine.some(k => FC.busy.has(k))) return null;
  mine.forEach(k => { FC.busy.add(k); FC.note[k] = FC_READING; });
  FC.bulkMsg = '';
  fcDrawAll();
  try {
    let theme = '';
    try { await fcReadOne(f.brand, f.psku); theme = FC.got[fcKey(f.brand, f.psku)].theme || ''; } catch (e) { theme = ''; }   // the parent's own theme first
    if (!theme) theme = fcFamTheme(f).raw || '';                                                                      // else what most children say
    const d = fcThemeDims(fcTheme(theme));
    const used = new Map(f.live.map(o => [fcValKey(o, d), o.sku]));
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
      if ((d.c && !now.color) || (d.s && !now.size)) { held.push({ sku: c.sku, why: `the family varies by ${theme} and it has no ${d.c && !now.color ? 'colour' : 'size'}` }); continue; }
      if (!pt) { held.push({ sku: c.sku, why: 'its product type is not known' }); continue; }
      const vk = fcValKey(now, d);
      if ((d.c || d.s) && fcCsOnly(fcTheme(theme)) && used.has(vk)) { held.push({ sku: c.sku, why: `its colour + size is already used by ${used.get(vk)}` }); continue; }
      used.set(vk, c.sku);
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
      onDone: sum => fcAfterSend(sum, () => ({ psku: f.psku, theme, lvl: 'child' })) });
  } finally {
    mine.forEach(k => { FC.busy.delete(k); if (FC.note[k] === FC_READING) FC.note[k] = ''; });
    fcDrawAll();
  }
}
const fcLink = (brand, sku) => fcLinkMany([fcKey(brand, sku)]);
/** Why the ticked children cannot be linked in one go ('' when they can): they must share ONE suggested family with a known parent SKU. */
function fcLinkWhyNot(list, v) {
  const fks = [...new Set(list.map(c => c.sug && c.sug.fk))];
  if (fks.length > 1) return `Link to family links children of one family at a time — the ticked ones belong to ${fks.length} families.`;
  const f = v.families.find(x => x.fk === fks[0]);
  if (!f || !f.psku) return 'The family\'s parent SKU is not known here — fix by hand.';
  return '';
}
/** Set colour / size: the catalogue's value (the only certain one), after reading what the listing holds now. */
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
      changes.push({ field: attr === 'color' ? 'Colour' : 'Size', old: sqValText(at[attr]) || '(none)', new: val, attr, oldV: JSON.parse(JSON.stringify(at[attr] || [])) });
    });
    FC.note[key] = '';
    return sqSendWithCheck([{ brand, sku, asin: c.asin, label: c.title || sku, body: { lfix: 'patch', brand, sku, productType: pt, patches }, changes }], {
      screen: 'Family Check', title: `Set ${changes.map(x => x.field.toLowerCase()).join(' and ')} on ${sku}`,
      onDone: sum => fcAfterSend(sum, () => p.fix.set) });
  } catch (e) {
    FC.note[key] = 'Could not read the listing: ' + ((e && e.message) || e);
    return null;
  } finally {
    FC.busy.delete(key);
    if (FC.note[key] === 'Reading the listing…') FC.note[key] = '';
    fcDrawAll();
  }
}
// After the popup closed, per listing: what Amazon accepted is what this page now knows (the child leaves the list, its tick goes);
// still working says so on its row.
function fcAfterSend(sum, valuesFor) {
  ((sum && sum.jobs) || []).forEach(job => {
    const key = fcKey(job.brand, job.sku);
    if (job.state === 'accepted') {
      FC.got[key] = Object.assign({}, FC.got[key] || {}, valuesFor(job), { at: Date.now() });
      FC.note[key] = '';
      FC.sel.delete(key);
    } else if (job.state === 'working' || job.state === 'sent') FC.note[key] = 'Sent — Amazon is still working on it (Listing History has it).';
    else if (sum.test) FC.note[key] = 'Test site — not sent to Amazon.';
  });
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
const FC_CSV_COLS = ['Brand', 'Family', 'Parent SKU', 'Parent ASIN', 'SKU', 'ASIN', 'Colour', 'Size', 'Stock', 'Problem', 'Suggested fix'];
function fcCsv(v) {
  const q = val => { const s = String(val == null ? '' : val); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [];
  fcGroups(v).forEach(g => g.rows.forEach(r => r.probs.filter(p => p.sev === 'r').forEach(p => {
    lines.push([fcBrandName(r.c.brand), g.f.name, g.f.psku, g.f.pa, r.c.sku, r.c.asin, r.c.color, r.c.size, r.c.stock, p.text, (p.fix.kind === 'hand' ? 'Fix by hand: ' : '') + p.fix.text].map(q).join(','));
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

/* ----- drawing ----- */
// The groups the filters keep (brand, search, the card picked); a row keeps only the picked card's problem. The order stays the one the
// families were first drawn in, so a family never moves under the mouse when a theme read lands.
function fcGroups(v) {
  const q = fcNorm(FC.q);
  if (!FC.order) FC.order = new Map();
  v.groups.forEach(g => { if (!FC.order.has(g.f.fk)) FC.order.set(g.f.fk, FC.order.size); });
  return v.groups.filter(g => FC.brand === 'ALL' || g.f.brand === FC.brand).map(g => {
    const famHit = q && (fcNorm(g.f.name).includes(q) || fcNorm(g.f.psku).includes(q) || fcNorm(g.f.pa).includes(q));
    const rows = g.rows.filter(r => (!FC.card || r.probs.some(p => p.k === FC.card))
      && (!q || famHit || fcNorm(r.c.sku).includes(q) || fcNorm(r.c.asin).includes(q) || fcNorm(r.c.title).includes(q)));
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
    + `<span style="flex:1"></span><button type="button" class="ghost fc-famonly" data-fc="csv">Export CSV</button></div><div class="fc-meta muted" id="fcMeta"></div></div><div id="fcBody"></div>`;
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
  const parts = [`Live children only (buyable and in stock): ${fcNf(v.live)} of ${fcNf(v.all)}`,
    `Image Manager snapshot ${fcAgo(oldest(typeof IML !== 'undefined' ? IML : null))}`,
    `stock from Listing Health ${fcAgo(oldest(typeof HEALTH !== 'undefined' ? HEALTH : null))}`,
    v.ratingFound ? `ratings found for ${fcNf(v.ratingFound)} listings: below 4 ★ counts as removed on purpose` : 'ratings: none in Sellora\'s data — the team marks children removed for a low rating'];
  meta.innerHTML = parts.map(fcEsc).join(' · ') + (FC.err ? `<div class="err">${fcEsc(FC.err)}</div>` : '') + (FC.msg ? `<div>${fcEsc(FC.msg)}</div>` : '')
    + v.notes.map(n => `<div>${fcEsc(n)}</div>`).join('') + (FC.okNote ? `<div class="fc-oknote">${fcEsc(FC.okNote)}</div>` : '');
}
const FC_COLS = 9;
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
  return `<tr class="fc-row${orphan ? ' is-orphan' : ''}${FC.sel.has(key) ? ' is-sel' : ''}"><td class="fc-tk">${tick}</td><td class="fc-sku"><b>${fcEsc(c.sku)}</b><small>${fcEsc(String(c.title || '').slice(0, 70))}</small></td><td class="ui-mono">${amz}</td>`
    + `<td>${c.color ? fcEsc(c.color) : '<span class="fc-none">none</span>'}</td><td>${c.size ? fcEsc(c.size) : '<span class="fc-none">none</span>'}</td><td class="num">${fcNf(c.stock)}</td>`
    + `<td class="fc-prob">${probs.map(p => `<div class="fc-p is-${p.sev}">${fcEsc(p.text)}</div>`).join('')}</td>`
    + `<td class="fc-fix">${probs.map(p => `<div>${p.fix.kind === 'hand' ? '<b>Fix by hand:</b> ' : ''}${fcEsc(p.fix.text)}</div>`).join('')}${FC.note[key] ? `<div class="fc-note">${fcEsc(FC.note[key])}</div>` : ''}</td>`
    + `<td class="fc-acts">${btns}${ask}</td></tr>`;
}
const FC_COLHEAD = '<tr class="fc-colh"><th class="fc-tk"></th><th>SKU</th><th>ASIN</th><th>Colour</th><th>Size</th><th class="num">Stock</th><th>Problem</th><th>Suggested fix</th><th></th></tr>';
// One family: a single line while closed (chips from what is in memory); open, its column header and its children's rows.
function fcGroupHtml(g) {
  const f = g.f;
  const open = FC.open === f.fk;
  const n = k => g.rows.filter(r => r.probs.some(p => p.k === k)).length;
  const chips = FC_KINDS.map(k => (n(k.k) ? `<span class="fc-chip is-${k.sev}">${fcNf(n(k.k))} ${fcEsc(k.t.toLowerCase())}</span>` : '')).join('');
  const waiting = n('wait') ? '<span class="fc-chip is-g">Waiting for Amazon theme data</span>' : '';
  const reading = FC.reading.has(f.fk) ? ' <span class="fc-reading">Reading theme…</span>' : '';
  const orph = g.rows.filter(r => fcTickKind(r) === 'orphan').map(r => fcKey(r.c.brand, r.c.sku));
  const allOn = orph.length && orph.every(k => FC.sel.has(k));
  const selAll = open && orph.length ? ` <button type="button" class="ghost fc-b fc-selall" data-fc="selfam" data-fc-v="${fcEsc(f.fk)}">${allOn ? 'Clear this family' : 'Select all in this family'}</button>` : '';
  const theme = f.theme && f.theme.raw ? ' · theme ' + f.theme.raw : '';
  return `<tbody class="fc-grp${open ? ' is-open' : ''}"><tr class="fc-head" data-fc="grp" data-fc-v="${fcEsc(f.fk)}" tabindex="0" aria-expanded="${open}"><td colspan="${FC_COLS}">`
    + `<button type="button" class="fc-arrow" data-fc="grp" data-fc-v="${fcEsc(f.fk)}" aria-label="${open ? 'Close' : 'Open'} ${fcEsc(f.name)}">${open ? '▾' : '▸'}</button>`
    + `<b>${fcEsc(f.name)}</b> <small class="muted">${fcEsc(fcBrandName(f.brand))} · parent SKU ${fcEsc(f.psku || '—')} · ${fcEsc(f.pa || '—')} · ${fcNf(f.live.length)} live children${fcEsc(theme)}</small> ${chips}${waiting}${reading}${selAll}</td></tr>`
    + (open ? FC_COLHEAD + g.rows.map(fcRowHtml).join('') : '') + '</tbody>';
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
  const cards = FC_KINDS.map(k => `<button type="button" class="fc-box is-${k.sev}${FC.card === k.k ? ' is-on' : ''}" data-fc="card" data-fc-v="${k.k}" aria-pressed="${FC.card === k.k}" title="${fcEsc(k.tip)}">`
    + `<span>${fcEsc(k.t)}</span><b>${fcNf(fcCount(v, k.k))}</b><small>${k.sev === 'r' ? 'error' : 'check'}</small></button>`).join('');
  const groups = fcGroups(v);
  if (FC.open && !groups.some(g => g.f.fk === FC.open)) FC.open = '';
  // only the first FC.limit family lines are drawn; more as the list scrolls (or "Show more")
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
      return `<tr><td><b>${fcEsc(c.sku)}</b></td><td class="ui-mono">${fcEsc(c.asin || '—')}</td><td>${fcEsc(c.sug ? c.sug.name : '')}</td><td>${auto ? `rating ${fcEsc(c.rt.rating)} ★ (${fcNf(c.rt.reviews)} reviews) — automatic` : fcEsc(e.reason || FC_REASON)}</td>`
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
// The removed-on-purpose children still to list: live, still without a parent (a linked or no-longer-live child is simply not here).
const fcRemoved = v => v.removed.filter(c => FC.brand === 'ALL' || c.brand === FC.brand);

/* ----- open / close (one family at a time) ----- */
/** Open a family (closing the one open before) or close it. Opening reads its theme; the clicked line stays where it was on the screen. */
function fcToggle(fk, el) {
  const line = el && el.closest ? el.closest('.fc-head') || el : null;
  const top0 = line && line.getBoundingClientRect ? line.getBoundingClientRect().top : null;
  FC.open = FC.open === fk ? '' : fk;
  if (FC.open) fcReadFamily(fk);
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
  if (k === 'q') FC_T = setTimeout(fcDrawAll, 250);
  else fcDrawAll();
}
/** Opening the page: the snapshots Sellora already holds (read once), the saved marks, then draw — every family closed. */
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
    fcDrawAll();
  });
  const pane = $('paneFam');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) fcOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
}
