/* ================= LISTING · LISTING WORKSPACE: a ✓ / ✗ checklist for every listing from Amazon's latest data, rolled up per parent =================
 * Screens: Listing Health (tab 'health') — its third view, the "Workspace" button in the toolbar. It draws into #liWs and leaves
 *          the Parent / Child views and their table (listing-health-data.js) exactly as they are.
 * Does: like a market listing audit tool: every child listing gets a checklist built from AMAZON'S data — status, Amazon's own
 *       issues, pictures, title, template, bullets, description, A+, specs and search terms — rolled up per parent in words,
 *       and a detail per listing that says what is missing, where, and which source (and how fresh) each answer comes from.
 *       Only LIVE listings (Listing Health status active, with stock) count; inactive or out-of-stock ones are shown, never
 *       counted. Sources, newest first: a live read through the deployed backend (?lfix=content / get / schema, ?limg=get for
 *       the catalogue's pictures — what shoppers see — and ?lh=aplusasin for A+ on the parent and its children; read when a
 *       parent is opened, by Check now, by the sweep or by "Re-check all errors with Amazon", kept a day in memory and in
 *       localStorage), the Image Manager snapshot (IML) and the Listing Health snapshot (HEALTH). The judging itself is
 *       healthOf's (listing-rules.js), which reads the same live data through liWsLiveMap, so Parent ASINs / Child listings
 *       and the Workspace always agree. Nothing is written to Firestore and nothing is sent to Amazon.
 * Main functions: liWsLoad, liWsLiveMap (the live reads for healthOf), liWsChild (one listing's checks; liWsChildKept keeps
 *                 them until something they read changes), liWsParents (the roll-up; liWsAudit sums six audit steps per
 *                 parent), liWsOrder (the order showing; reads landing never reorder), liWsRender (the view), liWsDetail (one
 *                 listing's problems, each as what is wrong · how to fix · Fix, through lrProblemHtml in listing-rules.js — the
 *                 same look as Listing Health), liWsAuditBox, the read queue (liWsQueue / liWsPump / liWsJob, liWsReadParent,
 *                 liWsCheckNow, liWsSweep, liWsRecheck), liWsOn / liWsOff, liWsSchedule, and the listeners at the end. The Fix
 *                 buttons are lrFixOpen's. Every name starts with liWs / LI_WS. */
/* ---------- Listing Workspace ---------- */
const LI_WS_PAGE = 100;                 // parents put in the DOM at once; "Show 100 more" adds another page
const LI_WS_DAY = 86400000;             // one day in milliseconds
const LI_WS_NUM = new Intl.NumberFormat('en-US');   // one formatter for every number on the view (toLocaleString per number is slow)
const LI_WS_DRAW_MS = 1000;             // while reads land, the view is redrawn at most this often
const LI_WS_SCROLL_MS = 400;            // …and only once scrolling has stopped for this long
const LI_WS_INFLIGHT = 4;               // backend calls out at once
const LI_WS_BATCH = 20;                 // SKUs per ?lfix=content call — the backend's own cap
const LI_WS_STORE = 'selloraWsLive';    // localStorage key of the live reads
const LI_WS_STORE_V = 3;                // its record version: 3 = catalogue slots and A+ answers kept, search-term bytes counted the Amazon way
const LI_WS_APLUS_BATCH = 10;           // ASINs per ?lh=aplusasin call — the backend's own cap
const LI_WS_STORE_MAX = 1500000;        // characters kept there; past it the oldest reads go first
// The spec attributes a listing should carry; the product type's schema says which of them apply.
const LI_WS_SPECS = ['material', 'color', 'size', 'pattern', 'style', 'item_shape', 'number_of_items', 'theme', 'care_instructions',
  'special_feature', 'item_type_name', 'fabric_type'];
// The picture slots as the Listings API names them (the same table the backend's ListingImages.gs keeps).
const LI_WS_SLOT_ATTR = { MAIN: 'main_product_image_locator', PT01: 'other_product_image_locator_1', PT02: 'other_product_image_locator_2',
  PT03: 'other_product_image_locator_3', PT04: 'other_product_image_locator_4', PT05: 'other_product_image_locator_5',
  PT06: 'other_product_image_locator_6', PT07: 'other_product_image_locator_7', PT08: 'other_product_image_locator_8' };
// The eleven checks, in checklist order. `w`: the word under the Problems badge and on the chip. `fix`: where ✗ goes — the
// Image Manager or Listing Errors; A+ has no screen here. `extra`: from the live read only, never a Listing Rule, never counted.
// `tip`: the one-sentence tooltip on the checklist's header, in plain words. Whether a failure is an Error (red) or Needs
// attention (orange) is the rule's own level in Listing Rules — the chips and pills read it from there.
const LI_WS_CHECKS = [
  { k: 'amz', t: 'Amazon', w: 'Amazon error', fix: 'lerr', tip: 'Amazon reports no error on this listing, and it shows in search (not suppressed)' },
  { k: 'main', t: 'Main img', w: 'Main image', fix: 'img', tip: "Amazon's catalogue shows a main picture — what shoppers see, not our own MAIN slot (Listing Rules: Main image missing)" },
  { k: 'img', t: 'Images', w: 'Images', fix: 'img', tip: 'Enough gallery pictures in the catalogue (MAIN + PT01–PT08; the swatch is not a picture), by the Listing Rules for images — the same as Listing Health' },
  { k: 'title', t: 'Title', w: 'Title', fix: 'lerr', tip: 'The Listing Rules for the title: its length, required words and out-of-season words — the same as Listing Health' },
  { k: 'tpl', t: 'Template', w: 'Template', fix: 'lerr', tip: 'The title follows the word order set in Listing Rules' },
  { k: 'bul', t: 'Bullets', w: 'Bullets', fix: 'lerr', tip: 'Enough bullet points (Listing Rules: Missing bullet)' },
  { k: 'desc', t: 'Desc', w: 'Description', fix: 'lerr', tip: 'The description is long enough (Listing Rules: Description weak) — not judged when A+ is live, because Amazon shows the A+ instead' },
  { k: 'aplus', t: 'A+', w: 'A+', fix: '', tip: 'A+ Content is published on the listing or its parent ASIN (Listing Rules: A+ missing) — asked when the parent is opened and on “Refresh both brands”' },
  { k: 'other', t: 'Other', w: 'Other rules', fix: 'lerr', tip: 'Every other Listing Rule: size written the approved way, variation names, price, stock while inactive' },
  { k: 'spec', t: 'Specs', w: 'Specs', fix: 'lerr', extra: true, tip: 'Extra check from the live Amazon read (not a Listing Rule): every spec Amazon asks for on this product type is filled' },
  { k: 'kw', t: 'Search terms', w: 'Search terms', fix: 'lerr', tip: 'Search terms within the limit set in Listing Rules, counting the words only — spaces and ; , . do not count (from the live Amazon read)' },
];
const LI_WS_MODES = [['live', 'Live'], ['off', 'Not live / inbound'], ['all', 'All']];
let LI_WS = {
  on: false,                        // the Workspace is the view showing
  loading: false,                   // the first load is on its way
  stored: false,                    // localStorage was read once
  mode: 'live',                     // live | off | all — which children are listed and read
  chip: 'all',                      // all | problems | a check key
  sort: { k: 'priority', dir: -1 }, // 'priority' = serious problems first; otherwise a column key. dir 1 = ascending
  open: new Set(),                  // "brand|parent" of the parents whose checklist is open
  openSku: new Set(),               // "brand|sku" of the listings whose detail is open
  openPass: new Set(),              // "brand|sku" of the details showing their passed checks too
  showStep: new Map(),              // "brand|parent" → an audit step's key: the checklist shows only the children failing it
  card: '',                         // '' | err | chk | att | ok — the number card the list is filtered by (Not live is the mode 'off'); one filter at a time with the chips
  shown: LI_WS_PAGE,                // how many parents are in the DOM
  rows: [],                         // the last draw's parents after the filters (the sweep and Show more read these)
  byKey: new Map(),                 // "brand|parent" → the parent record of the last draw (▸ and Read again find kids here)
  live: { SP: {}, CPC: {} },        // brand → sku → the live read: { at, cAt, pt, title, titleLen, bul, desc, kw, kwBytes, words, gAt, st, iss, slots, specs, brand, color, iAt, cat, iErr, err, cErr }
  aplus: { SP: {}, CPC: {} },       // brand → ASIN (child or parent) → { v: true | false, at } from ?lh=aplusasin
  liveV: 0,                         // grows with every live answer that lands (a counter for anyone who wants to know; healthOf reads the live maps themselves)
  checking: new Map(),              // "brand|sku" → reads still out, for a listing a Check now button or the re-check is reading right now
  schema: { SP: {}, CPC: {} },      // brand → product type → { at, ok: [applicable spec names] } | { at, err } | { pending: true }
  iml: { SP: null, CPC: null },     // brand → { src: IML[brand] it was built from, map: sku → item }
  q: [],                            // the read queue: { t: 'content' | 'get' | 'schema', brand, … , pk: "brand|parent" }
  inflight: 0,                      // calls out right now
  prog: {},                         // "brand|parent" → { done, total, err }
  sweep: null,                      // { done, total } while "Check live listings on Amazon" runs
  timer: 0,                         // the one redraw timer every trigger shares
  filterT: 0,                       // the search box's own debounce
  saveT: 0,                         // the localStorage write debounce
  lastDraw: 0,                      // when the view was last drawn (reads redraw at most every LI_WS_DRAW_MS)
  scrollAt: 0,                      // when the table card was last scrolled (a redraw waits until scrolling has stopped)
  toTop: false,                     // the next draw starts the table card at the top (chip, mode, sort, search, brand)
  order: null,                      // the parent keys in the order the person last sorted; reads landing never reorder them
  resort: true,                     // the next draw sorts afresh and keeps that order
  stale: false,                     // a fresh sort would give another order than the one showing ("Sort again")
};
const LI_WS_KEPT = new WeakMap();   // Health row → { sig, kid }: a listing's checks, kept until something they read changes

/* ----- small helpers ----- */
// "just now", "7m", "7h", "3d": an age in milliseconds in its shortest honest unit.
function liWsAge(ms) {
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  if (ms < LI_WS_DAY) return Math.round(ms / 3600000) + 'h';
  return Math.round(ms / LI_WS_DAY) + 'd';
}
const liWsAgo = ms => (ms < 60000 ? 'just now' : liWsAge(ms) + ' ago');
// "just now", "4 min ago", "3 hours ago", "27 days ago": the same age in plain words, for the Last checked column.
function liWsAgoWords(ms) {
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.round(ms / 60000) + ' min ago';
  const count = (unit, word) => {
    const n = Math.round(ms / unit);
    return `${n} ${word}${n === 1 ? '' : 's'} ago`;
  };
  return ms < LI_WS_DAY ? count(3600000, 'hour') : count(LI_WS_DAY, 'day');
}
const liWsAgeCls = ms => (ms < LI_WS_DAY ? 'is-ok' : ms <= 7 * LI_WS_DAY ? 'is-warn' : 'is-bad');
const liWsDate = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const liWsCut = (str, n) => (String(str || '').length > n ? String(str).slice(0, n - 1) + '…' : String(str || ''));
const liWsNf = value => LI_WS_NUM.format(Number(value || 0));
// Live, from the Health row only: not Inactive, not out of stock, and Active or on FBA. qty null on an active listing is live.
function liWsIsLive(row) {
  const status = String(row.status || '');
  if (/inactive/i.test(status) || row.qty === 0) return false;
  return /active/i.test(status) || /amazon|afn/i.test(String(row.channel || ''));
}
// Where an answer came from, how old it is, and how to bring it up to date — the detail's Source · when column.
function liWsSrc(kind, at) {
  const now = Date.now();
  if (kind === 'live') return { s: 'Amazon Listings API', when: at ? 'read ' + liWsAgo(now - at) : 'not read yet', upd: 'update: “Read again from Amazon”' };
  if (kind === 'cat') return { s: "Amazon's catalogue (what shoppers see)", when: at ? 'read ' + liWsAgo(now - at) : 'not read yet', upd: 'update: “Read again from Amazon”' };
  if (kind === 'iml') return { s: 'Image Manager snapshot', when: at ? liWsAgo(now - at) : 'no snapshot', upd: 'update: Image Manager → refresh from Amazon' };
  if (kind === 'content') return { s: 'Listing Health snapshot', when: at ? 'content read ' + liWsAgo(now - at) : 'content not read yet', upd: 'update: “Refresh both brands”' };
  if (kind === 'health') return { s: 'Listing Health snapshot', when: at ? liWsAgo(now - at) : 'no snapshot', upd: 'update: “Refresh both brands”' };
  if (kind === 'aplus') return { s: "Amazon's A+ Content", when: at ? 'checked ' + liWsAgo(now - at) : 'not checked yet', upd: 'update: open the parent here, or “Refresh both brands”' };
  return { s: 'Listing Rules', when: LR_SAVED_AT ? 'saved ' + liWsDate(LR_SAVED_AT.getTime()) : 'built-in defaults', upd: 'update: Listing Rules → Save rules' };
}

/* ----- the snapshots and the live cache ----- */
// First time on: the health snapshot and the rules, then both brands' Image Manager snapshots — through their own loaders.
async function liWsLoad() {
  if (LI_WS.loading) return;
  if (H_LOADED && LR && ('SP' in IML) && ('CPC' in IML)) return liWsDraw();
  LI_WS.loading = true;
  liWsDraw();
  try {
    if (!H_LOADED || !LR) await ensureHealth();
    for (const brand of ['SP', 'CPC']) if (!(brand in IML)) await imListLoad(brand);
  } catch (e) {
    LI_WS.loading = false;
    if (LI_WS.on) $('liWs').innerHTML = `<div class="card xlwrap"><div class="ui-error">Could not load: ${lrEsc((e && e.message) || e)}</div></div>`;
    return;
  }
  LI_WS.loading = false;
  liWsDraw();
}
// The Image Manager items of one brand by SKU (parents left out), rebuilt only when IML[brand] is a new object.
function liWsImlIndex(brand) {
  const src = IML[brand] || null;
  const have = LI_WS.iml[brand];
  if (have && have.src === src) return have.map;
  const map = new Map();
  ((src && src.items) || []).forEach(item => { if (item && item.sku && item.lvl !== 'parent') map.set(item.sku, item); });
  LI_WS.iml[brand] = { src, map };
  return map;
}
// The live reads kept from the last day (localStorage, read once). Anything older, or broken, is simply not loaded.
function liWsStoreLoad() {
  LI_WS.stored = true;
  try {
    const data = JSON.parse(localStorage.getItem(LI_WS_STORE) || 'null');
    if (!data || !data.live) return;
    const cut = Date.now() - LI_WS_DAY;
    const old = (data.v || 0) < LI_WS_STORE_V;   // an older record counted search-term bytes with the spaces: the count is dropped and worked out again from the text
    ['SP', 'CPC'].forEach(brand => {
      Object.entries((data.live && data.live[brand]) || {}).forEach(([sku, entry]) => {
        if (!entry || !(entry.at > cut)) return;
        if (old) {
          delete entry.kwBytes;
          if (entry.kw && entry.kw.length >= 300) delete entry.cAt;   // the kept text was cut at 300 characters: counted again it would read short, so the content is read again instead
        }
        LI_WS.live[brand][sku] = entry;
      });
      Object.entries((data.schema && data.schema[brand]) || {}).forEach(([pt, entry]) => { if (entry && entry.at > cut && entry.ok) LI_WS.schema[brand][pt] = entry; });
      // A+ answers are kept LR_APLUS_DAYS: a "has A+" answer is good news that keeps, a "no A+" one is asked again after that anyway.
      const apCut = Date.now() - LR_APLUS_DAYS * LI_WS_DAY;
      Object.entries((data.aplus && data.aplus[brand]) || {}).forEach(([asin, entry]) => { if (entry && entry.at > apCut && typeof entry.v === 'boolean') LI_WS.aplus[brand][asin] = entry; });
    });
    LI_WS.liveV++;
  } catch (e) { /* no storage, or a record this version does not read: start empty */ }
}
/** The live reads and A+ answers for healthOf (listing-rules.js reads them through hCtx), loading the stored ones first. */
function liWsLiveMap() {
  if (!LI_WS.stored) liWsStoreLoad();
  return { live: LI_WS.live, aplus: LI_WS.aplus, v: LI_WS.liveV };
}
// Write the live reads back, newest first, within the size cap. Only answers are kept — never an error on its own.
function liWsStoreSave() {
  clearTimeout(LI_WS.saveT);
  LI_WS.saveT = setTimeout(() => {
    try {
      const all = [];
      ['SP', 'CPC'].forEach(brand => Object.entries(LI_WS.live[brand]).forEach(([sku, entry]) => { if (entry.cAt || entry.gAt || entry.iAt) all.push({ brand, sku, entry, size: JSON.stringify(entry).length + sku.length + 8 }); }));
      all.sort((a, b) => b.entry.at - a.entry.at);
      const live = { SP: {}, CPC: {} };
      let size = 0;
      all.forEach(item => {
        if (size + item.size > LI_WS_STORE_MAX) return;
        size += item.size;
        live[item.brand][item.sku] = item.entry;
      });
      const schema = { SP: {}, CPC: {} };
      ['SP', 'CPC'].forEach(brand => Object.entries(LI_WS.schema[brand]).forEach(([pt, entry]) => { if (entry.ok) schema[brand][pt] = entry; }));
      localStorage.setItem(LI_WS_STORE, JSON.stringify({ v: LI_WS_STORE_V, at: Date.now(), live, schema, aplus: LI_WS.aplus }));
    } catch (e) { /* quota or no storage: the copy in memory still works for this visit */ }
  }, 1000);
}
const liWsEntry = (brand, sku) => LI_WS.live[brand][sku] || (LI_WS.live[brand][sku] = { at: 0 });

/* ----- one listing: the sources merged, newest first, into the checks ----- */
/**
 * Returns the listing with `c`: one record per check { pass: true | false | null, cell, found, need, miss, src, bang } — `cell`
 * is the word in the ✗ pill, `bang` the read error when the only source for the cell failed — plus live, why, fails, red, unknown.
 */
function liWsChild(row, brand, hc, imlMap, now) {
  const lr = LI_WS.live[brand][row.sku] || null;
  const live = liWsIsLive(row);
  const why = live ? 'Live' : (row.qty === 0 ? 'No stock' : 'Inactive');
  const rules = LR || LR_DEFAULT;
  const healthAt = HEALTH[brand] && HEALTH[brand].at ? HEALTH[brand].at.getTime() : 0;
  const readErr = lr && lr.err ? lr.err : '';
  const contentErr = lr ? (lr.cErr || lr.err || '') : '';   // the content read's own error survives a later successful ?lfix=get
  const c = {};
  // --- Listing Rules: the very same healthOf as Listing Health, over the same freshest data (healthOf merges the live read
  //     itself — lrFresh / lrFacts in listing-rules.js — so a listing not read here gets exactly the Parent ASINs answer and a
  //     read one gets it on fresher data: the catalogue's pictures, A+ on the parent, the live content) ---
  const scored = Object.assign({}, row, { brand });
  const h = healthOf(scored, hc);
  const fresh = h.fresh;
  const content = fresh.content || null;
  const hasLive = fresh.contentSrc === 'live';
  const contentSrc = hasLive ? liWsSrc('live', fresh.contentAt) : liWsSrc('content', row.checked);
  const pics = h.pics;
  const picSrc = pics ? liWsSrc(pics.src === 'live' ? 'cat' : pics.src === 'iml' ? 'iml' : 'content', pics.at) : liWsSrc('cat', lr && lr.iAt ? lr.iAt : 0);
  const found = h.found.map(hit => Object.assign({}, hit));
  const idx = liWsRuleIndex(rules);

  // --- Status and Stock: information, never counted ---
  c.status = { info: true, pass: live ? true : null, found: why + (live ? '' : ' — problems are not counted'),
    need: 'Active at Amazon, with stock (FBA)', miss: '', src: liWsSrc('health', healthAt) };
  c.stock = { info: true, pass: row.qty == null ? null : row.qty > 0, found: row.qty == null ? 'Unknown' : liWsNf(row.qty) + ' units',
    need: 'In stock', miss: row.qty === 0 ? 'Out of stock' : '', src: liWsSrc('health', healthAt) };

  // --- Amazon: the live read answers for itself (healthOf's Amazon rules read it through lrAmz); otherwise the rules' answer
  //     from the Amazon status map, exactly as Listing Health has it ---
  const amzNeed = 'No ERROR from Amazon, and in search (BUYABLE and DISCOVERABLE)';
  const amz = h.amz;
  const amzHits = found.filter(hit => liWsColOf(hit) === 'amz');
  if (amz && amz.src === 'live') {
    const st = String(amz.st || '').toUpperCase();
    const errs = amz.errs || [];
    const sup = st.includes('BUYABLE') && !st.includes('DISCOVERABLE');
    const fields = [...new Set(errs.flatMap(issue => issue.a || []))];
    const worst = amzHits.slice().sort((a, b) => LR_SEV[b.sev].rank - LR_SEV[a.sev].rank)[0];
    c.amz = { pass: !amzHits.length, hits: amzHits, sev: worst ? worst.sev : '',
      cell: errs.length ? 'Error' : 'Suppressed', need: amzNeed, src: liWsSrc('live', amz.at),
      found: errs.length ? amz.im : sup ? 'Suppressed from search (BUYABLE, not DISCOVERABLE)' : (st ? 'Status ' + st.split(',').join(', ') : 'No status from Amazon'),
      miss: errs.length ? (fields.length ? 'Fields Amazon names: ' + fields.join(', ') : "See Amazon's message") : sup ? 'Suppressed from search' : '' };
  } else {
    c.amz = liWsRuleCell(amzHits, { known: !!AMZ.map, need: amzNeed, src: liWsSrc('iml', amz ? amz.at : (AMZ.snapAt[brand] || AMZ.at)),
      value: 'Nothing reported', unknown: 'No Amazon status yet', bang: readErr });
  }

  // --- the content columns, each from the Listing Rules that belong to it ---
  const ruleCol = (k, opts) => liWsRuleCell(found.filter(hit => liWsColOf(hit) === k), Object.assign({ need: idx.need[k] }, opts));
  const noContent = { known: false, unknown: 'Content not read yet', bang: contentErr };
  // Pictures are the catalogue's — what shoppers see (Listing Rules, Part A1): the live read's catalogue slots, else the Image
  // Manager snapshot, else the Health snapshot's count. No picture data anywhere: not judged.
  const picWords = pics ? (pics.src === 'health' ? `${pics.n} picture${pics.n === 1 ? '' : 's'} (the snapshot's count — it cannot tell the swatch apart)`
    : `${pics.n} gallery picture${pics.n === 1 ? '' : 's'} in the catalogue${pics.own && !pics.own.includes('MAIN') && pics.main ? ' (our own MAIN slot is empty; Amazon shows one from the catalogue)' : ''}`) : '';
  const picErr = lr && lr.iErr ? lr.iErr : '';
  c.main = ruleCol('main', pics ? { known: true, src: picSrc, value: (pics.main ? 'Main picture in the catalogue · ' : '') + picWords }
    : Object.assign({ src: picSrc }, noContent, { unknown: 'No picture data yet', bang: picErr || contentErr }));
  c.img = ruleCol('img', pics ? { known: true, src: picSrc, value: picWords }
    : Object.assign({ src: picSrc }, noContent, { unknown: 'No picture data yet', bang: picErr || contentErr }));
  // The title rules read the title the way Listing Health does: the content read's, else the listings report's own title.
  const titleText = hTitleText(scored);
  c.title = ruleCol('title', (content || titleText) ? { known: true, src: content ? contentSrc : liWsSrc('health', healthAt),
    value: content ? `${content.titleLen} characters: “${liWsCut(content.title || titleText, 90)}”` : `“${liWsCut(titleText, 90)}” (the listings report's title; content not read yet)` }
    : Object.assign({ src: contentSrc }, noContent));
  c.bul = ruleCol('bul', content ? { known: true, src: contentSrc, value: `${content.bullets} bullets` } : Object.assign({ src: contentSrc }, noContent));
  // The description is not judged while A+ is live on the listing or its parent — Amazon shows the A+ instead (Part A3).
  const ap = h.aplus;
  c.desc = ruleCol('desc', content ? { known: true, src: contentSrc,
    value: (content.descLen ? `${content.descLen} characters` : 'Empty') + (ap.v === true ? ' — not judged: A+ is live, so Amazon shows the A+ instead' : '') } : Object.assign({ src: contentSrc }, noContent));
  // A+ is the listing's or its parent ASIN's (Part A2); never asked, the parent not asked yet, or a "no A+" answer older than
  // 14 days (asked again first): not judged.
  c.aplus = ruleCol('aplus', { known: ap.v === true || (ap.v === false && !ap.stale), src: liWsSrc('aplus', ap.at),
    value: ap.v === true ? `A+ published on the ${ap.src}` : '', unknown: ap.why ? 'Not judged: ' + ap.why : 'Not checked yet' });
  c.other = ruleCol('other', { known: true, src: liWsSrc('rules'), value: 'No other rule fails' });

  // --- Template: its own column, worded by what is missing. It does not apply (`na`: shown as —, counted as fine) when the rule
  //     is off or this product has no template; until the brand catalogue is read it is unknown, not na ---
  const tplRule = (rules.issues || []).find(issue => issue.detector === 'title_template');
  const tplOn = !!tplRule && tplRule.on !== false;
  const catRead = !!LR_CAT[brand];
  const tpl = tplOn && catRead ? lrTemplateFor(scored, rules) : null;
  const tplNa = () => (tplOn && !catRead
    ? { pass: null, hits: [], need: '', miss: '', src: liWsSrc('rules'), found: 'The brand catalogue is not read yet, so the template for this product is not known' }
    : { pass: null, na: true, hits: [], need: '', miss: '', src: liWsSrc('rules'),
      found: (tplOn ? 'No title template for this product in Listing Rules' : 'The template rule is switched off in Listing Rules') + ' — this check does not apply' });
  if (!tpl) c.tpl = tplNa();
  else if (!titleText) c.tpl = { pass: null, hits: [], need: String(tpl.template || ''), found: 'Content not read yet', miss: '', src: liWsSrc('rules'), bang: contentErr };
  else {
    const hit = found.find(one => one.detector === 'title_template');
    const tplSrc = liWsSrc('rules');
    tplSrc.when += ' · title ' + (content ? contentSrc.when : "from the listings report");
    // The pill says WHAT is missing: "No material", "Missing 2" for two or more parts, "· order" when the order is wrong too.
    const detail = hit ? hit.detail : '';
    const parts = ((detail.match(/missing ([^·]+)/) || [])[1] || '').split(',').map(part => part.trim()).filter(Boolean);
    const wrongOrder = /different order/.test(detail);
    const word = parts.length === 1 ? 'No ' + parts[0] : (parts.length ? 'Missing ' + parts.length : '');
    c.tpl = { pass: !hit, hits: hit ? [hit] : [], sev: hit ? hit.sev : '', cell: hit ? (word ? word + (wrongOrder ? ' · order' : '') : 'Order') : '',
      found: hit ? detail : 'The title follows its template', need: String(tpl.template || ''), miss: hit ? detail : '', src: tplSrc };
  }

  // --- specs: the live read's attributes against the product type's schema ---
  if (!lr || !lr.gAt || !lr.specs) c.spec = { pass: null, hits: [], found: 'Not read from Amazon yet', need: LI_WS_SPECS.join(', '), miss: '', src: liWsSrc('live', 0), bang: readErr };
  else {
    const pt = lr.pt || '';
    const sch = pt ? LI_WS.schema[brand][pt] : null;
    if (pt && (!sch || sch.pending)) c.spec = { pass: null, hits: [], found: "Waiting for the product type's schema", need: LI_WS_SPECS.join(', '), miss: '', src: liWsSrc('live', lr.gAt) };
    else {
      const applicable = sch && sch.ok ? sch.ok : LI_WS_SPECS.slice();
      const filled = applicable.filter(name => lr.specs[name]);
      const empty = applicable.filter(name => !lr.specs[name]);
      const words = empty.map(name => name.replace(/_/g, ' ')).join(', ');   // the spec names in words, never as field codes
      c.spec = { pass: !empty.length, hits: [], sev: 'action', cell: `${filled.length}/${applicable.length}`, need: applicable.join(', ') || 'none apply', attrs: empty,
        found: `${filled.length} of ${applicable.length} filled (product type ${pt || 'unknown'})${sch && sch.err ? ' — the schema could not be read, so all ' + LI_WS_SPECS.length + ' count' : ''}`,
        miss: empty.length ? 'Empty: ' + words : '', src: liWsSrc('live', lr.gAt) };
      // An extra from the live read (not a Listing Rule, not counted), worded like every other problem.
      if (empty.length) c.spec.hits = [{ sev: 'action', name: 'Specs', detector: 'spec', what: `Specs empty: ${words} (product type ${pt || 'unknown'})`,
        fix: `Fill the empty specs in Listing Errors: ${words}.`, tag: 'Amazon', kind: 'lerr' }];
    }
  }

  // --- search terms: the Listing Rules byte rule over the live read's generic_keyword (Part A4) — the bytes of the words only ---
  const kwRule = (rules.issues || []).find(issue => issue.detector === 'keyword_bytes' && issue.on !== false);
  const kwMax = kwRule ? (+(kwRule.params || {}).max || 249) : 249;
  const kwNeed = idx.need.kw || `Search terms up to ${kwMax} bytes of words`;
  if (fresh.kw == null) c.kw = { pass: null, hits: [], found: 'Not read from Amazon yet', need: kwNeed, miss: '', src: liWsSrc('live', 0), bang: contentErr };
  else c.kw = ruleCol('kw', { known: true, src: liWsSrc('live', fresh.contentAt), need: kwNeed,
    value: fresh.kw ? `Search terms: ${fresh.kwBytes} of ${kwMax} bytes — “${liWsCut(fresh.kw, 120)}”` : 'No search terms — nothing to count (adding some helps search)' });

  // --- which listings count, and how: the Listing Health level from every Listing Rules finding (the live Amazon answer
  //     included) — healthOf's own bucket; Specs are an extra from the live read and never change that level ---
  const bucket = h.bucket;
  const fails = LI_WS_CHECKS.filter(check => c[check.k].pass === false).map(check => check.k);
  // unknown: a counted check with no answer yet (not read, A+ not checked, schema on its way) — a check that does not apply is not unknown.
  // Which number cards this listing counts in (live listings only; one listing can be in more than one): a confirmed Error, only
  // "Error? Check again", any Needs action / Needs review problem (also beside an Error), or no problem at all. Read from the
  // findings above — no rule of its own.
  const cards = { err: live && bucket === 'critical' && !h.stale, chk: live && bucket === 'critical' && !!h.stale,
    att: live && found.some(hit => hit.sev === 'action' || hit.sev === 'review'), ok: live && bucket === 'healthy' };
  return { sku: row.sku, asin: row.asin || '', brand, row, lr, live, why, c, fails, found, bucket, notes: h.notes, stale: h.stale, cards,
    problem: bucket === 'critical' || bucket === 'action' || bucket === 'review',
    red: bucket === 'critical', unknown: LI_WS_CHECKS.some(check => c[check.k].pass === null && !c[check.k].na) };
}

/* ----- Listing Rules → checklist columns ----- */
// Which column a Listing Rules finding belongs to: by what it detects first, then by its area. Anything else (Size,
// Variation, Price, Inventory, a rule the team adds later) goes to "Other", so every finding shows somewhere.
const LI_WS_COL_DET = { amazon_error: 'amz', amazon_suppressed: 'amz', no_main_image: 'main', title_template: 'tpl', bullets_below: 'bul',
  desc_below: 'desc', aplus_missing: 'aplus', keyword_bytes: 'kw' };
const LI_WS_COL_AREA = { Amazon: 'amz', Images: 'img', Title: 'title' };
const liWsColOf = hit => LI_WS_COL_DET[hit.detector] || LI_WS_COL_AREA[hit.area] || 'other';
// The short word in a ✗ pill, per kind of finding.
const LI_WS_SHORT = { amazon_error: 'Error', amazon_suppressed: 'Suppressed', no_main_image: 'None', aplus_missing: 'None',
  title_keyword: 'Keyword', seasonal_keyword: 'Season', title_contains: 'Word', size_format: 'Size', dimension_order: 'Size order',
  variation_value_missing: 'No size', variation_naming: 'Naming', inactive_with_stock: 'Inactive', no_price: 'No price' };
function liWsShort(hit) {
  if (LI_WS_SHORT[hit.detector]) return LI_WS_SHORT[hit.detector];
  const num = (String(hit.detail).match(/^\d[\d,]*/) || [])[0];   // "134 characters", "4 of 6", "3 of 5": the number
  if (num) return num;
  if (hit.detector === 'desc_below') return 'Empty';
  return liWsCut(hit.name, 14);
}
// One checklist cell from the findings of its column: ✓ when none, else the worst one's level and its short word (+N more).
// The findings themselves stay on the cell (`hits`): the detail draws each as what is wrong · how to fix · Fix.
function liWsRuleCell(hits, opts) {
  if (!opts.known) return { pass: null, hits: [], found: opts.unknown || 'Not read yet', need: opts.need || '', miss: '', src: opts.src, bang: opts.bang || '' };
  if (!hits.length) return { pass: true, hits: [], found: opts.value || 'Passes', need: opts.need || '', miss: '', src: opts.src };
  const worst = hits.slice().sort((a, b) => LR_SEV[b.sev].rank - LR_SEV[a.sev].rank)[0];
  return { pass: false, hits, sev: worst.sev, cell: liWsShort(worst) + (hits.length > 1 ? ' +' + (hits.length - 1) : ''),
    found: hits.map(hit => `${hit.name} — ${hit.detail}`).join(' · ') + (opts.value ? ' · ' + opts.value : ''),
    need: opts.need || '', miss: hits.map(hit => hit.detail).join(' · '), src: opts.src };
}
// Per column, the Listing Rules that can fire there (switched on, and not checked by hand), for the Needed text and the
// header's ⓘ. Worked out once per rules object.
const LI_WS_RULE_IDX = new WeakMap();
function liWsRuleIndex(rules) {
  if (LI_WS_RULE_IDX.has(rules)) return LI_WS_RULE_IDX.get(rules);
  const by = {};
  (rules.issues || []).filter(rule => rule.on !== false && LR_SEV[rule.sev] && rule.detector && rule.detector !== 'manual' && LR_DET[rule.detector])
    .forEach(rule => { const k = liWsColOf(rule); (by[k] = by[k] || []).push(rule); });
  const need = {};
  Object.keys(by).forEach(k => { need[k] = 'Listing Rules: ' + by[k].map(rule => rule.name).join(' · '); });
  const out = { by, need };
  LI_WS_RULE_IDX.set(rules, out);
  return out;
}

/* Everything liWsChild reads, as a list compared item by item: the rules context (hCtx gives the same object until the rules,
 * the snapshot or Amazon's status map change), the Image Manager snapshot, the saved rules' date, the live read and its error,
 * the product type's schema record, the row's own snapshot fields, and the minute (the ages in the text). */
function liWsChildSig(row, brand, hc, imlMap, now) {
  const lr = LI_WS.live[brand][row.sku] || null;
  const sch = lr && lr.pt ? LI_WS.schema[brand][lr.pt] || null : null;
  const ap = LI_WS.aplus[brand];
  return [hc, IML[brand] || null, imlMap.get(row.sku) || null, LR_SAVED_AT, LR_CAT[brand] || null, lr, lr ? lr.at : 0, lr ? lr.cAt : 0, lr ? lr.gAt : 0,
    lr ? lr.iAt : 0, lr ? lr.cat : null, lr ? lr.iErr : '', lr ? lr.err : '', lr ? lr.cErr : '', lr ? lr.brand : '', lr ? lr.color : '', lr ? lr.words : null, sch,
    ap[row.asin] || null, row.parent ? ap[row.parent] || null : null,
    row.content, row.checked, row.aplus, row.aplusAt, row.qty, row.status, row.channel, Math.floor(now / 60000)];
}
// liWsChild, but only when something it reads has changed since the last draw; otherwise the listing's last checks.
function liWsChildKept(row, brand, hc, imlMap, now) {
  const sig = liWsChildSig(row, brand, hc, imlMap, now);
  const kept = LI_WS_KEPT.get(row);
  if (kept && kept.sig.length === sig.length && kept.sig.every((part, i) => part === sig[i])) return kept.kid;
  const kid = liWsChild(row, brand, hc, imlMap, now);
  LI_WS_KEPT.set(row, { sig, kid });
  return kid;
}

/* ----- the automatic audit: six steps per parent, summed up from the checks the children already have ----- */
// `checks`: the child checks a step reads — a child passes the step when every one of them is ✓ (or doesn't apply), fails it
// when one is ✗, and has no answer yet otherwise. A step without checks is not judged yet; its `tip` says what it waits for.
// The audit only sums up; it never changes a check, a count or a number, and it is not a problem anywhere.
// `need`: what a step with no answer yet is waiting for, in words.
const LI_WS_AUDIT = [
  { k: 'spec', t: 'Spec sheet', checks: ['spec'], tip: 'Every spec Amazon asks for on the product type is filled (from the live Amazon read)',
    need: 'the Amazon read of each listing — open the parent, or “Read again from Amazon”' },
  { k: 'tpl', t: 'Template', checks: ['tpl'], tip: 'The title follows the Listing Rules template; a product with no template counts as fine',
    need: 'the brand catalogue and the title — “Refresh both brands”, or open the parent' },
  { k: 'fmt', t: 'Standard format', checks: ['bul', 'desc', 'other'], tip: 'Bullets, description and the other Listing Rules pass',
    need: 'the content read — “Refresh both brands”, or open the parent' },
  { k: 'img', t: 'Images', checks: ['main', 'img'], tip: 'The main picture is filled and there are enough pictures',
    need: 'the picture count — “Refresh both brands”, or open the parent' },
  { k: 'kwr', t: 'Keyword research', checks: null, tip: 'Needs keyword data (DataDive). Comes in a later step.', need: 'keyword data (DataDive); comes in a later step' },
  { k: 'kwi', t: 'Keyword indexing', checks: null, tip: 'Needs the Search Query Performance report. Comes in a later step.', need: 'the Search Query Performance report; comes in a later step' },
];
// The six steps over the children the row counts, in ONE pass over them: { steps: [{ k, t, state: 'pass'|'fail'|'unknown',
// failN, sev, what, fix, fixMore, need, tip }], n, pass, fail, unknown } — the last three count steps. Null when there is no
// child to judge. A failing step says what is wrong (the findings' names, most common first), how to fix it (the most common
// fix sentence; fixMore = how many other fixes the listings need) and the worst level among them.
function liWsAudit(scope) {
  if (!scope.length) return null;
  const failN = {};
  const unkN = {};
  const whats = {};
  const fixes = {};
  const worst = {};
  const fresh = {};   // a step holds at least one Error that does NOT rest on old data
  LI_WS_AUDIT.forEach(step => { failN[step.k] = 0; unkN[step.k] = 0; whats[step.k] = new Map(); fixes[step.k] = new Map(); worst[step.k] = 0; fresh[step.k] = false; });
  const bump = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
  scope.forEach(kid => LI_WS_AUDIT.forEach(step => {
    if (!step.checks) return;
    let fail = false;
    let unknown = false;
    step.checks.forEach(k => {
      const c = kid.c[k];
      if (c.pass === false) {
        fail = true;
        (c.hits || []).forEach(hit => {
          bump(whats[step.k], hit.name);
          bump(fixes[step.k], hit.fix);
          worst[step.k] = Math.max(worst[step.k], (LR_SEV[hit.sev] || {}).rank || 0);
          if (hit.sev === 'critical' && !hit.stale) fresh[step.k] = true;
        });
      } else if (c.pass === null && !c.na) unknown = true;
    });
    if (fail) failN[step.k]++;
    else if (unknown) unkN[step.k]++;
  }));
  const n = scope.length;
  const listings = count => `${liWsNf(count)} of ${liWsNf(n)}`;
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]);
  const steps = LI_WS_AUDIT.map(step => {
    if (!step.checks) return { k: step.k, t: step.t, state: 'unknown', failN: 0, need: step.need, tip: step.tip };
    const state = failN[step.k] ? 'fail' : unkN[step.k] ? 'unknown' : 'pass';
    const how = state === 'fail' ? `${listings(failN[step.k])} ${failN[step.k] === 1 ? 'listing fails' : 'listings fail'}` + (unkN[step.k] ? ` · ${liWsNf(unkN[step.k])} not checked yet` : '')
      : state === 'unknown' ? `${listings(unkN[step.k])} not checked yet` : (n === 1 ? 'the listing passes' : `all ${liWsNf(n)} listings pass`);
    const fixList = top(fixes[step.k]);
    return { k: step.k, t: step.t, state, failN: failN[step.k], need: step.need, tip: `${step.tip} — ${how}`,
      sev: worst[step.k] >= 3 ? 'critical' : 'action', stale: worst[step.k] >= 3 && !fresh[step.k],   // every Error in it rests on old data: "Error? Check again"
      what: top(whats[step.k]).map(([name, count]) => `${name} (${liWsNf(count)})`).join(' · '),
      fix: fixList.length ? fixList[0][0] : '', fixMore: Math.max(0, fixList.length - 1) };
  });
  const count = state => steps.filter(step => step.state === state).length;
  return { steps, n, pass: count('pass'), fail: count('fail'), unknown: count('unknown') };
}

/* ----- the parents: every child's checks rolled up ----- */
// One record per parent of the given brands, from the Health rows grouped by parent ASIN (a listing with no parent is its own).
function liWsParents(brands, hc, now) {
  const out = [];
  brands.forEach(brand => {
    const imlMap = liWsImlIndex(brand);
    const byKey = {};
    ((HEALTH[brand] && HEALTH[brand].rows) || []).forEach(row => {
      const id = row.parent || row.asin || row.sku;
      if (!id) return;
      const group = byKey[id] || (byKey[id] = { key: brand + '|' + id, brand, parent: id, kids: [], childTitle: '' });
      group.kids.push(liWsChildKept(row, brand, hc, imlMap, now));
      if (!group.childTitle && row.title) group.childTitle = row.title;
    });
    Object.values(byKey).forEach(group => {
      group.name = parentName(brand, group.parent, group.childTitle);
      const live = group.kids.filter(kid => kid.live);
      const off = group.kids.filter(kid => !kid.live);
      group.liveN = live.length;
      group.offN = off.length;
      group.offWhy = { Inactive: off.filter(kid => kid.why === 'Inactive').length, 'No stock': off.filter(kid => kid.why === 'No stock').length };
      // What the row counts: the live children, or every child in "All" — as Parent ASINs counts them. A problem is a Listing
      // Rules finding, so Critical / Needs action / Needs review are Listing Health's own numbers for the same data.
      const scope = LI_WS.mode === 'all' ? group.kids : live;
      group.scopeN = scope.length;
      group.audit = liWsAudit(scope);   // the six audit steps over the same children (a summary; counted nowhere)
      group.failN = {};
      LI_WS_CHECKS.forEach(check => { group.failN[check.k] = scope.filter(kid => kid.fails.includes(check.k)).length; });
      group.critN = scope.filter(kid => kid.bucket === 'critical').length;
      group.actN = scope.filter(kid => kid.bucket === 'action').length;
      group.revN = scope.filter(kid => kid.bucket === 'review').length;
      group.probN = group.critN + group.actN + group.revN;
      group.attN = group.actN + group.revN;                                      // "Needs attention" = Needs action + Needs review
      group.staleN = scope.filter(kid => kid.bucket === 'critical' && kid.stale).length;   // Errors resting only on old data: "Error? Check again"
      group.redN = group.critN;
      group.liveProbN = live.filter(kid => kid.problem).length;
      // The number cards: how many live children count in each (a child can count in more than one).
      group.cardN = { err: 0, chk: 0, att: 0, ok: 0 };
      live.forEach(kid => Object.keys(group.cardN).forEach(k => { if (kid.cards[k]) group.cardN[k]++; }));
      group.unknownN = live.filter(kid => kid.bucket === 'unchecked').length;   // content not read yet: the content rules cannot run
      group.passN = live.filter(kid => kid.bucket === 'healthy').length;        // no Listing Rules problem: Listing Health's "Healthy"
      group.inMode = LI_WS.mode === 'live' ? live : (LI_WS.mode === 'off' ? off : group.kids);
      group.rank = group.redN ? 2 : (group.probN ? 1 : 0);
      // --- last checked: the live reads of the live children (all children when none is live), and the Health snapshot ---
      // state: reading (done of total calls) | live (every one read; age = the oldest read) | part (read of n) | never.
      // snapAge: the last "Refresh both brands". why: in words, why a child was not read, or the last read error.
      const prog = LI_WS.prog[group.key] || null;
      const pool = live.length ? live : group.kids;
      const readAts = pool.map(kid => (kid.lr && kid.lr.cAt ? kid.lr.cAt : 0)).filter(Boolean);
      const healthAt = HEALTH[brand] && HEALTH[brand].at ? HEALTH[brand].at.getTime() : 0;
      // why a child has no content read (its own content error first), or what its last read error was
      const errs = {};
      pool.forEach(kid => {
        const why = kid.lr && (kid.lr.cAt ? kid.lr.err : (kid.lr.cErr || kid.lr.err));
        if (why) errs[why] = (errs[why] || 0) + 1;
      });
      const d = { n: pool.length, read: readAts.length, snapAge: healthAt ? now - healthAt : -1, why: '' };
      if (prog && prog.done < prog.total) Object.assign(d, { state: 'reading', done: prog.done, total: prog.total, rank: -1 });
      else if (readAts.length) Object.assign(d, { state: readAts.length === pool.length ? 'live' : 'part', age: now - Math.min(...readAts) });
      else Object.assign(d, { state: 'never', rank: Number.MAX_SAFE_INTEGER });
      if (d.rank === undefined) d.rank = d.age;
      const whys = Object.entries(errs).map(([why, count]) => `${liWsNf(count)} ${/not found/.test(why) ? why : 'could not be read: ' + why}`);
      d.why = whys.length ? whys.join(' · ') : (prog && prog.err && d.state !== 'reading' ? prog.err : '');
      group.data = d;
      out.push(group);
    });
  });
  return out;
}
// The parents a number card shows: at least one live child counting in that card — except No problem, which shows only fully
// clean parents (every live child with no problem at all). `t` is the card's words for the "Showing:" bar.
const LI_WS_CARD = {
  err: { t: 'Error: fix first', keep: p => p.cardN.err > 0 },
  chk: { t: 'Error? Check again', keep: p => p.cardN.chk > 0 },
  att: { t: 'Needs attention', keep: p => p.cardN.att > 0 },
  ok: { t: 'No problem', keep: p => p.liveN > 0 && p.cardN.ok === p.liveN },
};
// Priority: serious problems (Amazon error, main image) first, then other problems, then the most problem children, then name.
function liWsPriority(a, b) {
  return (b.rank - a.rank) || (b.probN - a.probN) || (b.redN - a.redN) || (a.name || a.parent).localeCompare(b.name || b.parent);
}
const LI_WS_SORT_VAL = {
  name: p => (p.name || p.parent).toLowerCase(),
  brand: p => BRAND_NAME[p.brand] || p.brand,
  kids: p => p.liveN,
  amz: p => p.probN,
  audit: p => (p.audit ? p.audit.pass * 10 - p.audit.fail : -1),
  data: p => p.data.rank,
};
function liWsSort(rows) {
  const { k, dir } = LI_WS.sort;
  const val = LI_WS_SORT_VAL[k];
  rows.sort((a, b) => {
    if (!val) return liWsPriority(a, b) * -dir;
    // Last checked: by the Amazon age; the parents never read come last whichever way the column is sorted.
    if (k === 'data' && (a.data.state === 'never') !== (b.data.state === 'never')) return a.data.state === 'never' ? 1 : -1;
    const x = val(a);
    const y = val(b);
    const cmp = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return cmp ? cmp * dir : liWsPriority(a, b);
  });
}
/* The rows in the order showing. The person's own actions (chip, mode, sort, search, brand, Sort again) sort afresh and keep
 * that order; while reads land, the parents stay where they are and new ones join at the end — LI_WS.stale says whether a
 * fresh sort would differ, which shows the "Sort again" button. */
function liWsOrder(rows) {
  const fresh = rows.slice();
  liWsSort(fresh);
  const freshKeys = fresh.map(p => p.key);
  if (LI_WS.resort || !LI_WS.order) {
    LI_WS.resort = false;
    LI_WS.stale = false;
    LI_WS.order = freshKeys;
    return fresh;
  }
  const pos = new Map(LI_WS.order.map((key, i) => [key, i]));
  const kept = rows.filter(p => pos.has(p.key)).sort((a, b) => pos.get(a.key) - pos.get(b.key));
  const added = fresh.filter(p => !pos.has(p.key));
  if (added.length) LI_WS.order = LI_WS.order.concat(added.map(p => p.key));   // they keep this place on the next draws too
  const out = kept.concat(added);
  LI_WS.stale = out.some((p, i) => p.key !== freshKeys[i]);
  return out;
}
// The search box (Listing Health's own): the parent ASIN, the name, or any child's SKU / ASIN / title.
function liWsSearch(rows) {
  const q = $('hFilter').value.trim().toLowerCase();
  if (!q) return rows;
  const kidText = kid => ((kid.sku || '') + ' ' + (kid.asin || '') + ' ' + (kid.row.title || '')).toLowerCase();
  return rows.filter(p => p.parent.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q) || p.kids.some(kid => kidText(kid).includes(q)));
}

/* ----- the live reads: a queue with LI_WS_INFLIGHT calls out at once ----- */
function liWsQueue(job) {
  LI_WS.q.push(job);
  liWsPump();
}
function liWsPump() {
  while (LI_WS.inflight < LI_WS_INFLIGHT && LI_WS.q.length) {
    const job = LI_WS.q.shift();
    LI_WS.inflight++;
    liWsJob(job).catch(() => {}).then(() => {
      LI_WS.inflight--;
      LI_WS.liveV++;
      const prog = LI_WS.prog[job.pk];
      if (prog) prog.done += job.units;
      const sweep = LI_WS.sweep;
      if (sweep && job.sweep) {
        // "Re-check all errors" counts LISTINGS: one is done when every read queued for it has landed.
        if (sweep.left && job.mark) job.mark.forEach(key => {
          const left = (sweep.left.get(key) || 1) - 1;
          sweep.left.set(key, left);
          if (!left) sweep.done++;
        });
        else sweep.done += job.units;
      }
      if (LI_WS.sweep && !LI_WS.inflight && !LI_WS.q.some(next => next.sweep)) LI_WS.sweep = null;
      (job.mark || []).forEach(key => {                              // one of the listing's reads landed; the mark goes with the last
        const left = (LI_WS.checking.get(key) || 1) - 1;
        if (left > 0) LI_WS.checking.set(key, left);
        else LI_WS.checking.delete(key);
      });
      liWsStoreSave();
      liWsAfterRead();
      liWsPump();
    });
  }
}
// An answer landed: the Workspace redraws (at most once a second); Listing Health's own table, when it is the view showing,
// redraws too, because it judges the same live data (a Check now button pressed there).
function liWsAfterRead() {
  if (LI_WS.on) return liWsSchedule();
  if (LI_WS.inflight || LI_WS.q.length) return;                 // once the last answer is in
  if (typeof renderHealth !== 'function' || !H_LOADED) return;
  const pane = $('paneHealth');
  if (pane && pane.classList && pane.classList.contains('hide')) return;
  clearTimeout(LI_WS.timer);
  LI_WS.timer = setTimeout(renderHealth, 60);
}
// One backend call. Content fills title / bullets / description / search terms (and queues the product type's schema once);
// get fills status, issues, our own picture slots and specs; limg fills the catalogue's picture slots (what shoppers see);
// aplus answers A+ for up to ten ASINs (parent and children); schema says which spec attributes apply to a product type.
async function liWsJob(job) {
  const brand = job.brand;
  const now = Date.now();
  try {
    if (job.t === 'content') {
      const reply = await baCall({ lfix: 'content', brand, skus: job.skus.join(',') });
      const items = reply.items || {};
      job.skus.forEach(sku => {
        const entry = liWsEntry(brand, sku);
        const item = items[sku];
        if (!item) {
          entry.err = entry.cErr = 'not found on Amazon by SKU';   // cErr: the content read's own error, which a later ?lfix=get must not clear
          return;
        }
        const values = key => (item[key] || []).map(v => (v && v.value != null ? String(v.value) : '')).filter(Boolean);
        const title = values('item_name')[0] || '';
        const kw = values('generic_keyword').join(' ');
        const text = lrNorm([title].concat(values('bullet_point'), values('product_description')).join(' '));
        Object.assign(entry, { at: now, cAt: now, pt: item.productType || entry.pt || '', title: title.slice(0, 220), titleLen: title.length,
          bul: values('bullet_point').length, desc: values('product_description').join(' ').length, kw: kw.slice(0, 300), kwBytes: lrKwBytes(kw), err: '', cErr: '',
          words: { emb: /embroider/.test(text), bp: text.includes('block print') } });   // only WHICH rule words were found, never the text; kwBytes the way Amazon counts (no spaces, no ; , .)
        if (values('brand')[0]) entry.brand = values('brand')[0].slice(0, 60);
        if (entry.pt && !job.sweep) liWsNeedSchema(brand, entry.pt, job.pk);
      });
    } else if (job.t === 'get') {
      const reply = await baCall({ lfix: 'get', brand, sku: job.sku });
      const at = reply.attributes || {};
      const filled = name => (at[name] || []).some(e => e && Object.keys(e).some(key => key !== 'marketplace_id' && key !== 'language_tag' && e[key] != null && e[key] !== ''));
      const first = name => String(((at[name] || []).find(e => e && e.value != null && e.value !== '') || {}).value || '');
      const entry = liWsEntry(brand, job.sku);
      // Amazon's own brand and colour for the listing, as short strings: the brand and the Block Print rules read them.
      Object.assign(entry, { at: now, gAt: now, pt: reply.productType || entry.pt || '', st: reply.status || [], brand: first('brand').slice(0, 60) || entry.brand || '',
        color: first('color').slice(0, 40) || entry.color || '',
        iss: (reply.issues || []).slice(0, 8).map(issue => ({ s: String(issue.severity || '').charAt(0), c: String(issue.code || ''), m: String(issue.message || '').slice(0, 220), a: (issue.attrs || []).slice(0, 4) })),
        slots: IM_SLOTS.filter(slot => (at[LI_WS_SLOT_ATTR[slot]] || []).some(e => e && e.media_location)),
        specs: Object.fromEntries(LI_WS_SPECS.map(name => [name, filled(name)])), err: '' });
      if (entry.pt) liWsNeedSchema(brand, entry.pt, job.pk);
    } else if (job.t === 'limg') {
      // The catalogue's picture slots — what shoppers see. The reply also carries our own listing's slots and the open issues,
      // but ?lfix=get stays the source for status, issues and specs. No catalogue answer: the pictures stay not judged.
      const reply = await baCall({ limg: 'get', brand, sku: job.sku });
      if (reply.ok === false) throw new Error(reply.error || 'no answer');
      const entry = liWsEntry(brand, job.sku);
      const cat = reply.catalog && typeof reply.catalog === 'object' ? reply.catalog : null;
      const slots = cat ? Object.keys(cat).filter(slot => cat[slot] && cat[slot].link) : [];
      if (cat && (slots.length || !reply.catalogError)) Object.assign(entry, { at: now, iAt: now, cat: slots, iErr: '' });
      else Object.assign(entry, { at: now, iErr: String(reply.catalogError || 'no catalogue answer').slice(0, 160) });   // an answer without the catalogue leaves the pictures unknown, never "none"
    } else if (job.t === 'aplus') {
      const reply = await baCall({ lh: 'aplusasin', brand, asins: job.asins.join(',') });
      if (reply.ok === false) throw new Error(reply.error || 'no answer');
      // An ASIN the lookup could not answer is left out of the map (never hardened into "missing"); the role missing is an error.
      if (reply.roleMissing && !Object.keys(reply.map || {}).length) throw new Error('the SP-API app does not have the A+ Content role');
      Object.entries(reply.map || {}).forEach(([asin, has]) => { LI_WS.aplus[brand][asin] = { v: !!has, at: now }; });
    } else if (job.t === 'schema') {
      const reply = await baCall({ lfix: 'schema', brand, pt: job.pt, attrs: LI_WS_SPECS.join(',') });
      const attrs = reply.attrs || {};
      LI_WS.schema[brand][job.pt] = { at: now, ok: LI_WS_SPECS.filter(name => attrs[name] && !attrs[name].missing) };
    }
  } catch (e) {
    const why = String((e && e.message) || e);
    if (job.t === 'content') job.skus.forEach(sku => { const entry = liWsEntry(brand, sku); entry.err = entry.cErr = why; });
    else if (job.t === 'get') liWsEntry(brand, job.sku).err = why;
    else if (job.t === 'limg') liWsEntry(brand, job.sku).iErr = why;
    else if (job.t === 'aplus') { /* the A+ answers stay as they were: "could not tell" is never "missing" */ }
    else LI_WS.schema[brand][job.pt] = { at: now, err: why };
    const prog = LI_WS.prog[job.pk];
    if (prog) prog.err = (job.t === 'schema' ? 'Schema ' + job.pt : job.t === 'aplus' ? 'A+ ' + job.asins.join(', ') : job.t === 'get' || job.t === 'limg' ? job.sku : job.skus.join(', ')) + ': ' + why;
  }
}
// The A+ reads a set of listings needs: the parent ASIN and every child's ASIN whose answer is missing, older than a day, or a
// "no A+" older than LR_APLUS_DAYS (asked again before it counts) — unless `force`. Ten ASINs a call. Returns the jobs' units.
function liWsAplusJobs(brand, parent, kids, pk, force, extra) {
  const cut = Date.now() - LI_WS_DAY;
  const apCut = Date.now() - LR_APLUS_DAYS * LI_WS_DAY;
  const map = LI_WS.aplus[brand];
  const want = asin => {
    const have = map[asin];
    return force || !have || !(have.at > cut) || (have.v === false && !(have.at > apCut));
  };
  const asins = [...new Set([parent].concat(kids.map(kid => kid.asin)).filter(asin => /^[A-Z0-9]{10}$/.test(String(asin || '')) && want(asin)))];
  for (let i = 0; i < asins.length; i += LI_WS_APLUS_BATCH) {
    const chunk = asins.slice(i, i + LI_WS_APLUS_BATCH);
    liWsQueue(Object.assign({ t: 'aplus', brand, asins: chunk, pk, units: chunk.length }, extra || {}));
  }
  return asins.length;
}
// Queue one schema read per brand and product type, the first time that type is met.
function liWsNeedSchema(brand, pt, pk) {
  if (LI_WS.schema[brand][pt]) return;
  LI_WS.schema[brand][pt] = { pending: true };
  const prog = LI_WS.prog[pk];
  if (prog) prog.total += 1;
  liWsQueue({ t: 'schema', brand, pt, pk, units: 1 });
}
// Read one parent's listed children from Amazon: content in batches, then each listing (status / issues / specs, and the
// catalogue's pictures), A+ for the parent ASIN and its children, then the schemas. Reads from the last day are skipped unless
// `force` (Read again). Children showing an Error from old data are among them, so opening a parent re-checks them.
function liWsReadParent(p, force) {
  // A read of this parent is still on its way (▸ closed and opened again): its calls are out, so nothing is queued twice.
  const cur = LI_WS.prog[p.key];
  if (!force && cur && cur.done < cur.total) return;
  const cut = Date.now() - LI_WS_DAY;
  const kids = p.inMode;
  const needC = kids.filter(kid => force || !(kid.lr && kid.lr.cAt > cut)).map(kid => kid.sku);
  const needG = kids.filter(kid => force || !(kid.lr && kid.lr.gAt > cut)).map(kid => kid.sku);
  const needI = kids.filter(kid => force || !(kid.lr && kid.lr.iAt > cut)).map(kid => kid.sku);
  const nA = liWsAplusJobs(p.brand, p.parent, kids, p.key, force);   // queues only: its answers land after this function has returned
  if (!needC.length && !needG.length && !needI.length && !nA) return;   // nothing to read: the finished record, with its last error, stays
  LI_WS.prog[p.key] = { done: 0, total: needC.length + needG.length + needI.length + nA, err: '' };
  // Read again: the product types' schemas are read afresh too — queued here, so a failed content/get read cannot leave a type without one.
  if (force) [...new Set(kids.map(kid => kid.lr && kid.lr.pt).filter(Boolean))].forEach(pt => {
    delete LI_WS.schema[p.brand][pt];
    liWsNeedSchema(p.brand, pt, p.key);
  });
  for (let i = 0; i < needC.length; i += LI_WS_BATCH) {
    const skus = needC.slice(i, i + LI_WS_BATCH);
    liWsQueue({ t: 'content', brand: p.brand, skus, pk: p.key, units: skus.length });
  }
  needG.forEach(sku => liWsQueue({ t: 'get', brand: p.brand, sku, pk: p.key, units: 1 }));
  needI.forEach(sku => liWsQueue({ t: 'limg', brand: p.brand, sku, pk: p.key, units: 1 }));
  liWsSchedule();
}
// The reads one listing needs for a fresh verdict, as sweep jobs marked with its key: content, status / issues / specs, the
// catalogue's pictures, and A+ for it and its parent. Returns how many jobs were queued.
function liWsReadOne(brand, row, extra) {
  const key = brand + '|' + row.sku;
  const mark = [key];
  const base = Object.assign({ brand, pk: '', mark }, extra || {});
  liWsQueue(Object.assign({ t: 'content', skus: [row.sku], units: 1 }, base));
  liWsQueue(Object.assign({ t: 'get', sku: row.sku, units: 1 }, base));
  liWsQueue(Object.assign({ t: 'limg', sku: row.sku, units: 1 }, base));
  const nA = liWsAplusJobs(brand, row.parent || '', [row], '', true, base);
  return 3 + (nA ? 1 : 0);
}
/** Check now (an "Error? Check again" problem, on any screen): read that one listing from Amazon; the screen redraws when the
 *  answers land. `btn` — the button pressed — reads "Checking…" meanwhile. */
function liWsCheckNow(brand, sku, btn) {
  const row = ((HEALTH[brand] && HEALTH[brand].rows) || []).find(each => each.sku === sku);
  if (!row) return;
  const key = brand + '|' + sku;
  if (LI_WS.checking.has(key)) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking…';
  }
  if (!LI_WS.stored) liWsStoreLoad();
  LI_WS.checking.set(key, liWsReadOne(brand, row));
  if (LI_WS.on) liWsDraw();
}
/** "Re-check all errors with Amazon": every child in view that shows an Error is read again — content, status, the catalogue's
 *  pictures and A+ — through the same queue, with the progress "Re-checking 12 of 418" (listings, not calls). */
function liWsRecheck() {
  const kids = [];
  LI_WS.rows.forEach(p => p.inMode.forEach(kid => { if (kid.red) kids.push(kid); }));
  if (!kids.length) {
    LI_WS.sweep = { done: 0, total: 0, note: 'No listing in view shows an Error.' };
    liWsDraw();
    return;
  }
  const left = new Map();
  LI_WS.sweep = { done: 0, total: kids.length, kind: 'errors', left };
  kids.forEach(kid => {
    const key = kid.brand + '|' + kid.sku;
    const n = liWsReadOne(kid.brand, kid.row, { sweep: true });
    LI_WS.checking.set(key, n);
    left.set(key, n);
  });
  liWsDraw();
}
// "Check live listings on Amazon": content only, for every live child of the parents in view, skipping the last day's reads.
function liWsSweep() {
  const cut = Date.now() - LI_WS_DAY;
  const byBrand = { SP: [], CPC: [] };
  LI_WS.rows.forEach(p => p.kids.forEach(kid => { if (kid.live && !(kid.lr && kid.lr.cAt > cut)) byBrand[p.brand].push(kid.sku); }));
  const total = byBrand.SP.length + byBrand.CPC.length;
  if (!total) {
    LI_WS.sweep = { done: 0, total: 0, note: 'Every live listing in view was read from Amazon within a day.' };
    liWsDraw();
    return;
  }
  LI_WS.sweep = { done: 0, total };
  ['SP', 'CPC'].forEach(brand => {
    for (let i = 0; i < byBrand[brand].length; i += LI_WS_BATCH) {
      const skus = byBrand[brand].slice(i, i + LI_WS_BATCH);
      liWsQueue({ t: 'content', brand, skus, pk: '', units: skus.length, sweep: true });
    }
  });
  liWsDraw();
}
// Stop: the sweep's queued calls are dropped; the ones already out finish and keep their answers.
function liWsStop() {
  LI_WS.q.forEach(job => { if (job.sweep) (job.mark || []).forEach(key => LI_WS.checking.delete(key)); });
  LI_WS.q = LI_WS.q.filter(job => !job.sweep);
  LI_WS.sweep = null;
  liWsDraw();
}
/* ----- drawing ----- */
// One checklist cell: ✓, a ✗ pill that opens the fix, "!" when the source could not be read, or — when not known yet.
// While the parent is being read from Amazon every cell is a grey placeholder: the marks appear once every read is in.
function liWsCell(kid, check, reading) {
  if (reading) return '<span class="li-ws-ph" aria-label="Reading from Amazon"></span>';
  const c = kid.c[check.k];
  if (c.pass === true) return `<span class="li-ws-ok" title="${lrEsc(c.found)}">✓</span>`;
  if (c.pass === false) {
    const word = lrEsc(c.cell || '✗');
    const fixes = (c.hits || []).map(hit => hit.fix).filter(Boolean).join(' ');
    const tip = lrEsc((fixes || c.miss || c.found) + (check.fix === 'img' ? ' — opens the Image Manager' : check.fix ? ' — opens Listing Errors' : ''));
    // An Error resting only on old data is "Error? Check again": a grey-red dashed pill (Listing Rules, Part A5).
    const stale = c.sev === 'critical' && (c.hits || []).length && c.hits.every(hit => hit.stale);
    const cls = 'li-ws-x' + (kid.live ? (stale ? ' is-s' : liWsSevCls(c.sev)) : ' is-dim');
    const word2 = stale ? word + '?' : word;
    if (!check.fix) return `<span class="${cls}" title="${tip}">${word2}</span>`;
    return `<button type="button" class="${cls}" data-lr-fix="${check.fix}|${lrEsc(kid.brand)}|${lrEsc(kid.sku)}"${liWsAttrs(c)} title="${tip}">${word2}</button>`;
  }
  if (c.na) return '<span class="li-ws-na" title="Doesn’t apply to this listing">—</span>';
  if (c.bang) return `<span class="li-ws-bang" title="${lrEsc('Could not read from Amazon: ' + c.bang)}">!</span>`;
  return `<span class="li-ws-na" title="${lrEsc(c.found || 'Not known yet')}">—</span>`;
}
// The pill's colour from the finding's level: red "Error: fix first" (the default), orange "Needs attention" (action and review alike).
const liWsSevCls = sev => (sev === 'action' || sev === 'review' ? ' is-a' : '');
// The attribute names a fix should open boxes for (the empty specs), carried on the ✗ pill (lrProblemHtml carries them on Fix).
const liWsAttrs = c => (c.attrs && c.attrs.length ? ` data-lr-attrs="${lrEsc(c.attrs.join(','))}"` : '');
// The detail under a listing: only its problems, each as what is wrong · how to fix · Fix (lrProblemHtml — the same look as
// Listing Health's Why), worst first, with the source and when it was read in a grey line under it; then one line for what is
// not checked yet; the passed checks stay behind "Show passed checks (N)". Specs and Search terms from the live read are among
// the problems (they are not counted anywhere above).
function liWsDetail(kid, span) {
  const names = { amz: 'Amazon', main: 'Main image', img: 'Images', title: 'Title', tpl: 'Template', bul: 'Bullets', desc: 'Description', aplus: 'A+', other: 'Other rules', spec: 'Specs', kw: 'Search terms' };
  const key = kid.brand + '|' + kid.sku;
  const srcOf = c => [c.src && c.src.s, c.src && c.src.when].filter(Boolean).join(' · ');
  const checks = LI_WS_CHECKS.map(check => Object.assign({ k: check.k, t: names[check.k] }, kid.c[check.k]));
  // --- the problems, worst first ---
  const probs = [];
  checks.filter(c => c.pass === false).forEach(c => (c.hits || []).forEach(hit => probs.push({ hit, c })));
  probs.sort((a, b) => ((LR_SEV[b.hit.sev] || {}).rank || 0) - ((LR_SEV[a.hit.sev] || {}).rank || 0));
  const problems = probs.map(({ hit, c }) => lrProblemHtml(hit, { brand: kid.brand, sku: kid.sku, attrs: c.attrs }, srcOf(c))).join('')
    + lrNotesHtml(kid.notes);
  // --- the listing itself, what is not checked yet, what could not be read ---
  const checking = LI_WS.checking.has(key) ? ' · reading from Amazon now…' : '';
  const info = `<div class="li-ws-dinfo">${lrEsc(kid.why)}${kid.row.qty == null ? '' : ' · ' + liWsNf(kid.row.qty) + ' units'}`
    + `${kid.live ? '' : ' — this listing is not live, so its problems are not counted anywhere above'}${checking}</div>`;
  const unknown = checks.filter(c => c.pass === null && !c.na);
  const unkLine = unknown.length ? `<div class="li-ws-dunk">Not checked yet: ${unknown.map(c => `${lrEsc(c.t)} — ${lrEsc(c.found || 'not known')}`).join(' · ')}</div>` : '';
  const bangs = [...new Set(checks.map(c => c.bang).filter(Boolean))];
  const bangLine = bangs.length ? `<div class="li-ws-dbang">Could not read from Amazon: ${bangs.map(lrEsc).join(' · ')}</div>` : '';
  const none = !probs.length && !unknown.length ? '<div class="li-ws-dunk">No problem on this listing.</div>' : '';
  // --- the passed checks (and the ones that do not apply), behind a button ---
  const passed = checks.filter(c => c.pass === true || c.na);
  const open = LI_WS.openPass.has(key);
  const passBtn = passed.length ? `<button type="button" class="ghost li-ws-pass" data-li-ws-pass="${lrEsc(key)}" aria-expanded="${open}">${open ? 'Hide' : 'Show'} passed checks (${liWsNf(passed.length)})</button>` : '';
  const passList = open ? `<div class="li-ws-passed">${passed.map(c => `<div>${c.na ? '<span class="li-ws-na">—</span>' : '<span class="li-ws-ok">✓</span>'} ${lrEsc(c.t)} — ${lrEsc(c.found || '')}${srcOf(c) ? ' · ' + lrEsc(srcOf(c)) : ''}</div>`).join('')}</div>` : '';
  return `<tr class="li-ws-detail"><td colspan="${span}"><div class="li-ws-dbox">${info}${problems}${none}${unkLine}${bangLine}${passBtn}${passList}</div></td></tr>`;
}
// The opened parent: the note, Read again, and the checklist — one row per listed child, worst first.
function liWsKidTable(p, span) {
  const stepK = LI_WS.showStep.get(p.key) || '';
  const step = stepK ? LI_WS_AUDIT.find(each => each.k === stepK) : null;
  const inStep = kid => !!(step && step.checks && step.checks.some(k => kid.c[k].pass === false));
  // With a number card on, the listings that count in it come first and are marked; the others follow, faded, under "Other listings".
  const cardK = LI_WS.mode !== 'off' && LI_WS_CARD[LI_WS.card] ? LI_WS.card : '';
  const inCard = kid => !!(cardK && kid.cards && kid.cards[cardK]);
  const kids = p.inMode.filter(kid => !step || inStep(kid)).sort((a, b) => (Number(inCard(b)) - Number(inCard(a))) || (Number(b.live) - Number(a.live)) || (Number(b.red) - Number(a.red)) || (b.fails.length - a.fails.length)
    || String(a.sku).localeCompare(String(b.sku)));
  const firstOther = cardK ? kids.findIndex(kid => !inCard(kid)) : -1;
  const reading = p.data.state === 'reading';
  const when = reading ? `Reading ${liWsNf(kids.length)} listing${kids.length === 1 ? '' : 's'} from Amazon… ${liWsNf(p.data.done)} of ${liWsNf(p.data.total)}`
    : p.data.state === 'live' ? 'Read from Amazon ' + liWsAgoWords(p.data.age)
      : p.data.state === 'part' ? `${liWsNf(p.data.read)} of ${liWsNf(p.data.n)} read from Amazon ${liWsAgoWords(p.data.age)}` : 'Not read from Amazon yet';
  const pbar = reading ? `<div class="li-ws-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.data.total}" aria-valuenow="${p.data.done}">`
    + `<div class="li-ws-pfill" style="width:${p.data.total ? Math.round(p.data.done * 100 / p.data.total) : 0}%"></div></div>` : '';
  const showing = step ? ` Showing the ${liWsNf(kids.length)} listing${kids.length === 1 ? '' : 's'} that fail${kids.length === 1 ? 's' : ''} “${lrEsc(step.t)}”.` : '';
  const note = `<div class="li-ws-note"><span>${lrEsc(when)}: status, Amazon's issues, the catalogue's pictures, title, bullets, description, search terms, specs, and A+ for the parent and its children. `
    + `Stock comes from the last “Refresh both brands”. Click a SKU for what is wrong and how to fix it.${showing}${pbar}</span>`
    + `<button type="button" class="ghost li-ws-again" data-li-ws-again="${lrEsc(p.key)}"${reading ? ' disabled' : ''}>Read again from Amazon</button></div>`;
  const info = tip => `<th title="${lrEsc(tip)}">`;
  const head = '<thead><tr><th>SKU / ASIN</th>' + info('Live = active at Amazon with stock; the others are shown, never counted') + 'Status</th>'
    + `<th class="num" title="Units in stock at the last full refresh">Stock</th>`
    + LI_WS_CHECKS.map(check => `${info(check.tip)}${check.t}</th>`).join('') + '</tr></thead>';   // table.xl draws ⓘ after a th with a title
  const body = kids.map((kid, i) => {
    const key = kid.brand + '|' + kid.sku;
    const open = LI_WS.openSku.has(key);
    const mark = cardK ? (inCard(kid) ? ` is-match is-m-${cardK}` : ' is-other') : '';
    const other = i === firstOther && i > 0 ? `<tr class="li-ws-otherhead"><td colspan="${LI_WS_CHECKS.length + 3}">Other listings</td></tr>` : '';
    return `${other}<tr class="li-ws-kid${kid.live ? '' : ' is-off'}${mark}"><td><button type="button" class="li-ws-sku" data-li-ws-sku="${lrEsc(key)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${lrEsc(kid.sku)}</button>`
      + `<div class="li-ws-asin">${lrEsc(kid.asin)}</div></td><td>${lrEsc(kid.why)}</td><td class="num">${kid.row.qty == null ? '<span class="li-ws-na">—</span>' : liWsNf(kid.row.qty)}</td>`
      + LI_WS_CHECKS.map(check => `<td>${liWsCell(kid, check, reading)}</td>`).join('') + '</tr>' + (open ? liWsDetail(kid, LI_WS_CHECKS.length + 3) : '');
  }).join('') || `<tr><td colspan="${LI_WS_CHECKS.length + 3}" class="li-ws-na">${step ? 'No listing fails this step now.' : `No ${LI_WS.mode === 'live' ? 'live' : LI_WS.mode === 'off' ? 'not-live' : ''} children.`}</td></tr>`;
  return `<tr class="li-ws-kids"><td colspan="${span}">${note}${liWsAuditBox(p)}<div class="li-ws-kidbox"><table class="li-ws-kidtable">${head}<tbody>${body}</tbody></table></div></td></tr>`;
}
// The Problems cell: how many children have a Listing Rules problem, the three levels as Parent ASINs shows them, which columns,
// and the extras from the live Amazon read on their own line (they never change the counts).
function liWsProblems(p) {
  const offWords = ['Inactive', 'No stock'].filter(why => p.offWhy[why]).map(why => `${why} ${liWsNf(p.offWhy[why])}`).join(' · ');
  if (LI_WS.mode === 'off') return `<span class="ui-badge">${liWsNf(p.offN)} of ${liWsNf(p.kids.length)} not live</span>`
    + (offWords ? `<div class="li-ws-sub">${lrEsc(offWords)} — not counted as problems</div>` : '');
  if (!p.scopeN) return '<span class="ui-badge">Not live</span>' + (offWords ? `<div class="li-ws-sub">${lrEsc(offWords)}</div>` : '');
  const words = LI_WS_CHECKS.filter(check => !check.extra && p.failN[check.k]).map(check => `${check.w} ${liWsNf(p.failN[check.k])}`).join(' · ');
  const extras = LI_WS_CHECKS.filter(check => check.extra && p.failN[check.k]).map(check => `${check.w} ${liWsNf(p.failN[check.k])}`).join(' · ');
  const extraLine = extras ? `<div class="li-ws-sub li-ws-extra">Also from Amazon: ${lrEsc(extras)}</div>` : '';
  const scopeWord = LI_WS.mode === 'all' ? '' : ' live';
  if (p.probN) {
    // The two words (Listing Rules, Part B1): Error: fix first (Critical) and Needs attention (Needs action + Needs review);
    // an Error resting only on old data is counted with the Errors and named "to check again".
    const levels = [['critN', 'sev-c', 'Error: fix first'], ['attN', 'sev-a', 'Needs attention']]
      .filter(([k]) => p[k]).map(([k, cls, t]) => `<span class="li-ws-lvl"><span class="sev ${cls}"></span>${t} ${liWsNf(p[k])}${k === 'critN' && p.staleN ? ` <span class="li-ws-na">(${liWsNf(p.staleN)} to check again)</span>` : ''}</span>`).join('');
    return `<span class="ui-badge ${p.critN ? 'is-bad' : 'is-warn'}">${liWsNf(p.probN)} of ${liWsNf(p.scopeN)}${scopeWord} with a problem</span>`
      + `<div class="li-ws-levels">${levels}</div><div class="li-ws-sub">${lrEsc(words)}</div>${extraLine}`;
  }
  if (p.unknownN && LI_WS.mode !== 'all') return `<span class="ui-badge">No problem found</span><div class="li-ws-sub">${liWsNf(p.unknownN)} not checked yet</div>${extraLine}`;
  return `<span class="ui-badge is-ok">No Listing Rules problem</span>${extraLine}`;
}
// The Audit cell: "Audit 3/6" (green when every step passes), and under it what is left to fix or to check. "—" when the
// parent has no child to judge, and in "Not live / inbound" mode (the audit judges the children the row counts, the live ones).
function liWsAuditCell(p) {
  const a = p.audit;
  if (LI_WS.mode === 'off' || !a) return '<span class="li-ws-na">—</span>';
  const left = [a.fail ? `${liWsNf(a.fail)} to fix` : '', a.unknown ? `${liWsNf(a.unknown)} not checked yet` : ''].filter(Boolean).join(' · ');
  return `<span class="ui-badge${a.pass === LI_WS_AUDIT.length ? ' is-ok' : ''}" title="${a.pass} of ${LI_WS_AUDIT.length} audit steps pass">Audit ${a.pass}/${LI_WS_AUDIT.length}</span>`
    + (left ? `<div class="li-ws-sub">${lrEsc(left)}</div>` : '');
}
// The audit inside an opened parent (Part C): each failing step as a block — what is wrong, how many listings, how to fix it,
// and "Show these listings" (the checklist then shows only them); the steps with no answer yet in one grey line that says what
// each waits for (never a red ✗); the passing steps folded into one line.
function liWsAuditBox(p) {
  const a = p.audit;
  if (LI_WS.mode === 'off' || !a) return '';
  const showing = LI_WS.showStep.get(p.key) || '';
  const fails = a.steps.filter(step => step.state === 'fail').map(step => {
    const on = showing === step.k;
    // The step's level in the two words every problem list uses (Listing Rules, Part B1): the worst finding's, hollow when every
    // Error in the step rests on old data.
    const level = lrLevel(step.sev);
    const word = step.stale ? level.stale : level.word;
    return `<div class="li-ws-astep is-fail${step.sev === 'critical' ? '' : ' is-a'}" title="${lrEsc(step.tip)}"><span class="sev ${step.stale ? 'sev-s' : level.cls}"></span><div class="li-ws-astep-body">`
      + `<div class="li-ws-astep-t"><span class="lr-lvl ${step.stale ? 'is-s' : step.sev === 'critical' ? 'is-c' : 'is-a'}">${lrEsc(word)}</span>✗ ${lrEsc(step.t)} — ${liWsNf(step.failN)} of ${liWsNf(a.n)} listing${a.n === 1 ? '' : 's'} fail${step.failN === 1 ? 's' : ''}${step.what ? ': ' + lrEsc(step.what) : ''}</div>`
      + (step.fix ? `<div class="li-ws-astep-how">${lrEsc(step.fix)}${step.fixMore ? ` <span class="li-ws-na">· and ${liWsNf(step.fixMore)} other fix${step.fixMore === 1 ? '' : 'es'} — open the listings</span>` : ''}</div>` : '')
      + `</div><button type="button" class="ghost li-ws-ashow" data-li-ws-show="${lrEsc(p.key)}|${step.k}" aria-pressed="${on}">${on ? 'Show all listings' : 'Show these listings'}</button></div>`;
  }).join('');
  const unknown = a.steps.filter(step => step.state === 'unknown');
  const unkLine = unknown.length ? `<div class="li-ws-astep is-unknown"><span class="li-ws-na">—</span><div class="li-ws-astep-body">Not checked yet: `
    + unknown.map(step => `${lrEsc(step.t)} (needs ${lrEsc(step.need)})`).join(' · ') + '</div></div>' : '';
  const pass = a.steps.filter(step => step.state === 'pass');
  const passLine = pass.length ? `<div class="li-ws-astep is-pass"><span class="li-ws-ok">✓</span><div class="li-ws-astep-body">${liWsNf(pass.length)} step${pass.length === 1 ? ' passes' : 's pass'}: ${pass.map(step => lrEsc(step.t)).join(', ')}</div></div>` : '';
  return `<div class="li-ws-audit">${fails}${unkLine}${passLine}</div>`;
}
// The Last checked cell, two dates one under the other: when Sellora last read these listings from Amazon (a dot in the age's
// colour), when the Listing Health snapshot was last refreshed (muted), and in red why a child was not read, if one was not.
function liWsData(p) {
  const d = p.data;
  const dot = cls => `<span class="li-ws-ldot${cls ? ' ' + cls : ''}"></span>`;
  const amazon = d.state === 'reading' ? dot('is-live') + `Amazon: reading ${liWsNf(d.done)} of ${liWsNf(d.total)}…`
    : d.state === 'live' ? dot(liWsAgeCls(d.age)) + 'Amazon: ' + liWsAgoWords(d.age)
      : d.state === 'part' ? dot(liWsAgeCls(d.age)) + `Amazon: ${liWsNf(d.read)} of ${liWsNf(d.n)} · ${liWsAgoWords(d.age)}`
        : dot('') + 'Amazon: not checked yet';
  const refresh = 'Full refresh: ' + (d.snapAge >= 0 ? liWsAgoWords(d.snapAge) : 'none yet');
  return `<div class="li-ws-when" title="When Sellora last read these listings from Amazon, on this screen">${amazon}</div>`
    + `<div class="li-ws-when2" title="${lrEsc("Stock, A+ and Live / Not live come from the last 'Refresh both brands' on live Sellora.")}">${lrEsc(refresh)}</div>`
    + (d.why ? `<div class="li-ws-err">${lrEsc(liWsCut(d.why, 160))}</div>` : '');
}

// Draw the whole view into #liWs: the banner, the card, the bar, the chips, the table (the first LI_WS.shown parents) and the foot.
function liWsRender() {
  const box = $('liWs');
  if (!LI_WS.on) return;
  LI_WS.lastDraw = Date.now();
  if (LI_WS.loading) {
    box.innerHTML = '<div class="card xlwrap"><div class="ui-loading">Loading the Listing Health and Image Manager snapshots…</div></div>';
    return;
  }
  const now = Date.now();
  const pick = $('hBrandView').value;
  const brands = pick === 'ALL' ? ['SP', 'CPC'] : [pick];
  const multi = brands.length > 1;
  const nf = liWsNf;
  const all = liWsParents(brands, hCtx(), now);
  LI_WS.byKey = new Map(all.map(p => [p.key, p]));
  const scoped = liWsSearch(all);                       // brand + search: what the card and the chips count
  // The chips: all, problems, and one per check with a parent failing it. A chip whose parents are all fixed goes, and the
  // list falls back to All parents — decided before the rows are filtered, so the table never shows empty under "All parents".
  const idx = liWsRuleIndex(LR || LR_DEFAULT);
  const redK = k => k === 'amz' || (idx.by[k] || []).some(rule => rule.sev === 'critical');   // a column whose rules can be an Error
  const chipDefs = [{ k: 'all', t: 'All parents', dot: 'brand', n: scoped.length }, { k: 'problems', t: 'Has problems', dot: 'bad', n: scoped.filter(p => p.probN > 0).length }]
    .concat(LI_WS_CHECKS.map(check => ({ k: check.k, t: check.w, dot: redK(check.k) ? 'bad' : 'act', n: scoped.filter(p => p.failN[check.k] > 0).length })).filter(chip => chip.n > 0));
  if (!chipDefs.some(chip => chip.k === LI_WS.chip)) LI_WS.chip = 'all';
  const keep = LI_WS.chip === 'all' ? () => true : LI_WS.chip === 'problems' ? p => p.probN > 0 : p => p.failN[LI_WS.chip] > 0;
  const cardOn = LI_WS.mode !== 'off' && LI_WS_CARD[LI_WS.card] ? LI_WS_CARD[LI_WS.card] : null;
  const keepCard = cardOn ? cardOn.keep : () => true;
  const rows = liWsOrder(scoped.filter(p => (LI_WS.mode !== 'off' || p.offN > 0) && keep(p) && keepCard(p)));
  LI_WS.rows = rows;
  const shown = rows.slice(0, LI_WS.shown);

  // --- the banner: the snapshot is old ---
  const ats = brands.map(b => (HEALTH[b] && HEALTH[b].at ? HEALTH[b].at.getTime() : 0)).filter(Boolean);
  const oldest = ats.length ? Math.min(...ats) : 0;
  const banner = oldest && now - oldest > 2 * LI_WS_DAY ? `<div class="li-ws-banner">Amazon data is ${liWsAge(now - oldest)} old (snapshot ${liWsDate(oldest)}). `
    + 'Press “Refresh both brands” on live Sellora to bring it up to date — on the test site nothing is saved. Opening a parent here reads its status, '
    + "Amazon's issues, pictures, title, bullets, description, search terms and specs from Amazon right now.</div>" : '';

  // --- the number cards: live listings per card (one listing can be in more than one), and P = the parents a click shows ---
  const liveN = scoped.reduce((sum, p) => sum + p.liveN, 0);
  const offN = scoped.reduce((sum, p) => sum + p.offN, 0);
  const passN = scoped.reduce((sum, p) => sum + p.passN, 0);
  const unknownN = scoped.reduce((sum, p) => sum + p.unknownN, 0);
  const probN = scoped.reduce((sum, p) => sum + p.liveProbN, 0);
  const cardN = k => scoped.reduce((sum, p) => sum + p.cardN[k], 0);
  const cardP = k => scoped.filter(LI_WS_CARD[k].keep).length;
  const lvErrN = cardN('err');
  const lvChkN = cardN('chk');
  const lvAttN = cardN('att');
  // A full refresh older than a week shows in amber; the dates are each brand's last "Refresh both brands".
  const fmtDay = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fresh = brands.map(b => BRAND_NAME[b] + ' ' + (HEALTH[b] && HEALTH[b].at ? fmtDay(HEALTH[b].at.getTime()) : 'never')).join(' · ');
  const oldDays = oldest ? Math.floor((now - oldest) / LI_WS_DAY) : -1;
  const freshLine = `<div class="li-ws-fresh${!oldest || oldDays > 7 ? ' is-old' : ''}" title="Stock, price, status and the content snapshot come from the last “Refresh both brands”">`
    + `Full refresh: ${lrEsc(fresh)}${oldest ? ` (${oldDays === 0 ? 'today' : oldDays === 1 ? '1 day ago' : oldDays + ' days ago'})` : ''}</div>`;
  const offOn = LI_WS.mode === 'off';
  const pw = n => `${nf(n)} parent${n === 1 ? '' : 's'}`;
  // A clickable card: the big button (number, label, hint, the "in P parents" line) and, after it, an optional link of its own.
  const cardBtn = (k, ic, cls, v, label, hint, sub, tip, link) => {
    const on = k === 'off' ? offOn : !offOn && LI_WS.card === k;
    return `<div class="li-ws-card ${cls}${on ? ' is-on' : ''}"><button type="button" class="li-ws-card-main" data-li-ws-card="${k}" aria-pressed="${on}" title="${lrEsc(tip)}">`
      + `<span class="li-ws-card-v"><span class="li-ws-card-ic" aria-hidden="true">${ic}</span>${nf(v)}</span><span class="li-ws-card-l">${label}</span>`
      + `<span class="li-ws-card-h">${hint}</span>${sub ? `<span class="li-ws-card-s">${sub}</span>` : ''}</button>${link || ''}</div>`;
  };
  const cardBox = (cls, v, label, hint, tip) => `<div class="li-ws-card ${cls}" title="${lrEsc(tip)}"><span class="li-ws-card-v">${nf(v)}</span>`
    + `<span class="li-ws-card-l">${label}</span><span class="li-ws-card-h">${hint}</span></div>`;
  const chkOn = !offOn && LI_WS.card === 'chk';
  const chkLink = lvChkN ? `<span class="li-ws-card-s li-ws-card-more">+ <button type="button" class="li-ws-card-link" data-li-ws-card="chk" aria-pressed="${chkOn}"`
    + ` title="Show only the parents with a listing whose Error rests on old data (Error? Check again)">${nf(lvChkN)} to check again</button></span>` : '';
  const card = freshLine + '<div class="li-ws-cards" role="group" aria-label="Filter the parents by level">'
    + cardBox('is-plain', scoped.length, 'Parents', 'In view', 'Parents in view (brand and search)')
    + cardBox('is-plain', liveN, 'Live listings', 'Active, with stock', 'Live = active at Amazon with stock; only these are counted')
    + cardBtn('err', '●', 'is-err' + (chkOn ? ' is-on' : ''), lvErrN, 'Error: fix first', 'Fix these first', `in ${pw(cardP('err'))}`,
      'Live listings with at least one confirmed Error. Click to show only their parents; click again to show all.', chkLink)
    + cardBtn('att', '▲', 'is-att', lvAttN, 'Needs attention', 'Not urgent, worth fixing', `in ${pw(cardP('att'))}`,
      'Live listings with at least one Needs action or Needs review problem — also when the same listing has an Error. Click to show only their parents; click again to show all.')
    + cardBtn('ok', '✓', 'is-ok', passN, 'No problem', `Nothing to fix · ${liveN ? Math.round(passN * 100 / liveN) : 0}% of live`,
      `${pw(cardP('ok'))} fully clean${unknownN ? ` · ${nf(unknownN)} not checked yet` : ''}`,
      'Live listings with no Listing Rules problem: Listing Health calls them Healthy. A click shows only the parents whose every live listing has no problem. Specs are an extra from the live Amazon read and do not count here.')
    + cardBtn('off', '○', 'is-off', offN, 'Not live / inbound', 'Shown, not counted', '', 'Inactive or out-of-stock listings. Click to list them; click again to go back to the live ones.')
    + '</div>'
    + `<div class="li-ws-cardnote">${nf(probN)} live listing${probN === 1 ? ' has' : 's have'} a problem · a listing with an Error and other problems is in both cards.</div>`;
  // --- the "Showing:" bar while a number card filters the list ---
  const showBar = cardOn ? `<div class="li-ws-showing" role="status"><span>Showing: <b>${lrEsc(cardOn.t)}</b> · ${pw(rows.length)}</span>`
    + '<button type="button" class="ghost li-ws-showall" data-li-ws-cardclear="1">Show all ✕</button></div>' : '';
  // --- the bar: the mode, and the sweep or the re-check with its progress ---
  const sweeping = LI_WS.sweep && LI_WS.sweep.total > 0;
  const rechecking = sweeping && LI_WS.sweep.kind === 'errors';
  const progText = sweeping ? `${rechecking ? 'Re-checking' : 'Reading'} ${nf(LI_WS.sweep.done)} of ${nf(LI_WS.sweep.total)}…` : (LI_WS.sweep && LI_WS.sweep.note ? LI_WS.sweep.note : '');
  const errN = rows.reduce((sum, p) => sum + p.inMode.filter(kid => kid.red).length, 0);   // over the rows the re-check reads: brand, search, chip and mode
  const bar = '<div class="li-ws-bar"><div class="seg" role="group" aria-label="Which listings">' + LI_WS_MODES.map(([k, t]) =>
    `<button type="button" class="segbtn${LI_WS.mode === k ? ' on' : ''}" data-li-ws-mode="${k}" aria-pressed="${LI_WS.mode === k}">${t}</button>`).join('') + '</div>'
    + `<div class="li-ws-barr"><span class="li-ws-prog">${lrEsc(progText)}</span>`
    + (LI_WS.stale ? '<button type="button" class="ghost li-ws-resort" data-li-ws-resort="1" title="New answers from Amazon would put the parents in another order; the list keeps its order until you press this">Sort again</button>' : '')
    + `<button type="button" class="ghost li-ws-recheck" data-li-ws-recheck="${rechecking ? 'stop' : 'go'}"${!rechecking && (sweeping || !errN) ? ' disabled' : ''}`
    + ` title="Reads only the listings in view that show an Error — status, Amazon's issues, the catalogue's pictures, content and A+ — so an Error from old data is confirmed or cleared">${rechecking ? 'Stop' : `Re-check all errors with Amazon${errN ? ' (' + nf(errN) + ')' : ''}`}</button>`
    + `<button type="button" class="ghost li-ws-sweep" data-li-ws-sweep="${sweeping && !rechecking ? 'stop' : 'go'}"${rechecking ? ' disabled' : ''}`
    + ` title="Reads title, bullets, description and search terms of every live listing in view from Amazon, 20 at a time; listings read within a day are skipped">${sweeping && !rechecking ? 'Stop' : 'Check live listings on Amazon'}</button></div></div>`;
  // --- the chips (decided above) ---
  const chips = '<div class="li-ws-chips" role="group" aria-label="Show the parents with">' + chipDefs.map(chip =>
    `<button type="button" class="li-ws-chip" data-li-ws-chip="${chip.k}" aria-pressed="${LI_WS.chip === chip.k}"><span class="li-ws-dot li-ws-dot-${chip.dot}"></span>${chip.t}<span class="li-ws-n">${nf(chip.n)}</span></button>`).join('') + '</div>'
    // --- the legend: what the marks in the checklist mean (the two words of Listing Rules, Part B1) ---
    + '<div class="li-ws-legend"><span class="li-ws-ok">✓</span> passes · <span class="sev sev-c"></span> Error: fix first · <span class="sev sev-a"></span> Needs attention (the same Listing Rules as Parent ASINs; click a pill to open the fix) · '
    + `<span class="sev sev-s"></span> Error? Check again (the Error rests on data older than ${LR_STALE_DAYS} days — open the listing and press Check now) · <span class="li-ws-na">—</span> doesn’t apply or not checked yet · `
    + '<span class="li-ws-bang">!</span> couldn’t read from Amazon</div>';
  // --- the table ---
  const cols = [
    { k: 'priority', t: 'Priority', cls: 'li-ws-c-tog', tip: 'The default order: parents with a child showing an Error first, then other problems, then the most problem children. ▸ opens the checklist.' },
    { k: 'name', t: 'Parent', cls: 'li-ws-c-name' },
    multi ? { k: 'brand', t: 'Brand', cls: 'li-ws-c-brand' } : null,
    { k: 'kids', t: 'Live', cls: 'li-ws-c-kids num', tip: 'Live children of all children. Live = active at Amazon with stock; the others are shown but never counted.' },
    { k: 'amz', t: 'Problems', cls: 'li-ws-c-amz', tip: 'Children with a Listing Rules problem, counted exactly as Parent ASINs counts them (Error: fix first = Critical; Needs attention = Needs action + Needs review), and which columns. Specs are an extra from the live Amazon read and are not counted.' },
    { k: 'audit', t: 'Audit', cls: 'li-ws-c-audit', tip: 'Six listing checks summed up per parent, worked out automatically from the checklist (nothing to upload). Not counted as problems.' },
    { k: 'data', t: 'Last checked', cls: 'li-ws-c-data', tip: 'Amazon = when Sellora last read these listings from Amazon. Full refresh = the Listing Health snapshot. Neither is the date the listing was changed on Amazon.' },
    { k: '', t: 'Open', cls: 'li-ws-c-open' },
  ].filter(Boolean);
  const th = col => {
    if (!col.k) return `<th class="${col.cls}">${col.t}</th>`;
    const active = LI_WS.sort.k === col.k;
    const sort = active ? (LI_WS.sort.dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th class="${col.cls}" aria-sort="${sort}"${col.tip ? ` title="${lrEsc(col.tip)}"` : ''}>`
      + `<button type="button" class="li-ws-th" data-li-ws-sort="${col.k}">${col.t}${active ? (LI_WS.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;   // table.xl draws ⓘ after a th with a title
  };
  const tr = p => {
    const open = LI_WS.open.has(p.key);
    return `<tr class="li-ws-row"><td class="li-ws-c-tog"><button type="button" class="li-ws-tog" data-li-ws-tog="${lrEsc(p.key)}" aria-expanded="${open}"`
      + ` aria-label="${open ? 'Hide' : 'Show'} the checklist of ${lrEsc(p.parent)}">${open ? '▾' : '▸'}</button></td>`
      + `<td class="li-ws-c-name"><span class="ui-name" title="${lrEsc(p.name || p.parent)}">${lrEsc(p.name) || '<span class="ui-dim">—</span>'}</span><span class="ui-mono li-ws-asin">${lrEsc(p.parent)}</span></td>`
      + (multi ? `<td class="li-ws-c-brand">${lrEsc(BRAND_NAME[p.brand] || p.brand)}</td>` : '')
      + `<td class="li-ws-c-kids num">${nf(p.liveN)} / ${nf(p.kids.length)}</td>`
      + `<td class="li-ws-c-amz">${liWsProblems(p)}</td><td class="li-ws-c-audit">${liWsAuditCell(p)}</td><td class="li-ws-c-data">${liWsData(p)}</td>`
      + `<td class="li-ws-c-open"><button type="button" class="ghost li-ws-open" data-li-ws-open="${lrEsc(p.key)}" title="Open this parent's children in Listing Health">Open</button></td></tr>`
      + (open ? liWsKidTable(p, cols.length) : '');
  };
  let table;
  if (!all.length) table = '<div class="card xlwrap"><div class="ui-empty">No listings yet. Press “Refresh both brands” here on Listing Health first.</div></div>';
  else if (!rows.length) table = `<div class="card xlwrap"><div class="ui-empty">${scoped.length ? 'No parent in this group.' : 'No parent matches the search.'}</div></div>`;
  else table = `<div class="card xlwrap"><table class="xl li-ws-tbl"><thead><tr>${cols.map(th).join('')}</tr></thead><tbody>${shown.map(tr).join('')}</tbody></table></div>`;
  const foot = rows.length ? `<div class="li-ws-foot"><span class="muted">${nf(shown.length)} of ${nf(rows.length)} parents</span>`
    + (rows.length > shown.length ? `<button type="button" class="ghost li-ws-more" data-li-ws-more="1">Show ${LI_WS_PAGE} more</button>` : '') + '</div>' : '';
  // The table card keeps its scroll position across a redraw; only the person's own actions start it at the top.
  const wrap = box.querySelector('.xlwrap');
  const scroll = wrap && !LI_WS.toTop ? { top: wrap.scrollTop, left: wrap.scrollLeft } : null;
  LI_WS.toTop = false;
  box.innerHTML = banner + card + bar + chips + showBar + table + foot;
  const wrapNow = scroll && box.querySelector('.xlwrap');
  if (wrapNow) {
    wrapNow.scrollTop = scroll.top;
    wrapNow.scrollLeft = scroll.left;
  }
}

// Draw, and say so on the page if the draw itself fails — a blank box would read as "no data".
function liWsDraw() {
  try {
    liWsRender();
  } catch (e) {
    $('liWs').innerHTML = `<div class="card xlwrap"><div class="ui-error">Could not draw the workspace: ${lrEsc((e && e.message) || e)}</div></div>`;
  }
}
// Every trigger shares ONE timer: a keystroke draws once; while reads are landing the view is drawn at most once a second,
// and never while the person is scrolling the table (the timer waits until the last scroll is LI_WS_SCROLL_MS old).
function liWsSchedule() {
  if (!LI_WS.on) return;
  const now = Date.now();
  const busy = LI_WS.inflight || LI_WS.q.length;
  let wait = busy ? Math.max(60, LI_WS_DRAW_MS - (now - LI_WS.lastDraw)) : 60;
  if (now - LI_WS.scrollAt < LI_WS_SCROLL_MS) wait = Math.max(wait, LI_WS_SCROLL_MS - (now - LI_WS.scrollAt));
  clearTimeout(LI_WS.timer);
  LI_WS.timer = setTimeout(liWsTick, wait);
}
// The timer fired: draw, unless the person scrolled since it was set — then wait for the scrolling to stop.
function liWsTick() {
  if (Date.now() - LI_WS.scrollAt < LI_WS_SCROLL_MS) return liWsSchedule();
  liWsDraw();
}
// Workspace on: mark the pane and the button, show the box, load, draw. Listing Health's own table stays drawn underneath,
// hidden by CSS, so the other two views come back exactly as they were.
function liWsOn() {
  LI_WS.on = true;
  if (!LI_WS.stored) liWsStoreLoad();
  $('paneHealth').classList.add('li-ws-on');
  $('hViewWs').classList.add('on');
  $('hViewWs').setAttribute('aria-pressed', 'true');
  $('liWs').classList.remove('hide');
  liWsLoad();
}
// Workspace off (Parent / Child clicked, or Open): the other views' own handlers then draw their table. Reads already queued go on.
function liWsOff() {
  if (!LI_WS.on) return;
  LI_WS.on = false;
  clearTimeout(LI_WS.timer);
  $('paneHealth').classList.remove('li-ws-on');
  $('hViewWs').classList.remove('on');
  $('hViewWs').setAttribute('aria-pressed', 'false');
  $('liWs').classList.add('hide');
}

/* ----- wiring: listeners are ADDED beside Listing Health's own handlers, never in their place ----- */
$('hViewWs').addEventListener('click', () => (LI_WS.on ? liWsSchedule() : liWsOn()));
$('hViewParent').addEventListener('click', liWsOff);
$('hViewChild').addEventListener('click', liWsOff);
// The person changed what the list shows: a fresh sort, the first page, and the table card back at the top.
function liWsReset() {
  LI_WS.shown = LI_WS_PAGE;
  LI_WS.resort = true;
  LI_WS.toTop = true;
}
$('hBrandView').addEventListener('change', () => {
  liWsReset();
  liWsSchedule();
});
$('hFilter').addEventListener('input', () => {
  if (!LI_WS.on) return;
  clearTimeout(LI_WS.filterT);
  LI_WS.filterT = setTimeout(() => {
    liWsReset();
    liWsSchedule();
  }, 250);
});
// Listing Health rewrote its table — a refresh finished, the catalogue or Amazon's status arrived — so the listings may have changed.
new MutationObserver(liWsSchedule).observe($('hTable'), { childList: true });
// The table scrolls inside its card (.xlwrap), not the window: the scroll event does not bubble, so it is caught on the way down.
// On a phone the card does not scroll and the window does, so that scroll counts too.
$('liWs').addEventListener('scroll', () => { LI_WS.scrollAt = Date.now(); }, { capture: true, passive: true });
window.addEventListener('scroll', () => { if (LI_WS.on) LI_WS.scrollAt = Date.now(); }, { passive: true });
// One click listener for the whole view: chips, headers, the mode, ▸, Open, Read again, the SKU toggles, Show passed checks,
// Show these listings, the sweep, Sort again, Show more. (✗ and Fix are data-lr-fix buttons: listing-rules.js opens the fix.)
$('liWs').addEventListener('click', e => {
  const el = e.target.closest('[data-li-ws-card],[data-li-ws-cardclear],[data-li-ws-chip],[data-li-ws-sort],[data-li-ws-mode],[data-li-ws-tog],[data-li-ws-open],[data-li-ws-again],[data-li-ws-sku],[data-li-ws-pass],[data-li-ws-show],[data-li-ws-sweep],[data-li-ws-recheck],[data-li-ws-resort],[data-li-ws-more]');
  if (!el) return;
  const d = el.dataset;
  // The view is redrawn, so the pressed button is a new element: put the keyboard back on it, without scrolling to it.
  const refocus = selector => {
    const again = $('liWs').querySelector(selector);
    if (again) again.focus({ preventScroll: true });
  };
  if (d.liWsCard) {
    // A number card filters the list to its group; the same card again clears it. "Not live" is the mode of that name.
    const k = d.liWsCard;
    if (k === 'off') {
      LI_WS.mode = LI_WS.mode === 'off' ? 'live' : 'off';
      LI_WS.card = '';
    } else {
      LI_WS.card = LI_WS.card === k && LI_WS.mode !== 'off' ? '' : k;
      if (LI_WS.mode === 'off') LI_WS.mode = 'live';
    }
    LI_WS.chip = 'all';                                      // one filter at a time: a card clears the chip
    liWsReset();
    liWsDraw();
    return refocus(`[data-li-ws-card="${k}"]`);
  }
  if (d.liWsCardclear) {
    LI_WS.card = '';
    liWsReset();
    liWsDraw();
    return refocus('.li-ws-sweep');
  }
  if (d.liWsChip) {
    LI_WS.chip = d.liWsChip;
    LI_WS.card = '';                                         // …and a chip clears the card
    liWsReset();
    liWsDraw();
    return refocus(`[data-li-ws-chip="${d.liWsChip}"]`);
  }
  if (d.liWsMode) {
    LI_WS.mode = d.liWsMode;
    liWsReset();
    liWsDraw();
    return refocus(`[data-li-ws-mode="${d.liWsMode}"]`);
  }
  if (d.liWsSort) {
    const k = d.liWsSort;
    // Parent and Brand read A to Z first; every other column leads with the worst.
    LI_WS.sort = { k, dir: LI_WS.sort.k === k ? -LI_WS.sort.dir : (k === 'name' || k === 'brand' ? 1 : -1) };
    liWsReset();
    liWsDraw();
    return refocus(`[data-li-ws-sort="${k}"]`);
  }
  if (d.liWsResort) {
    LI_WS.resort = true;
    liWsDraw();
    return refocus('.li-ws-sweep');
  }
  if (d.liWsTog) {
    const p = LI_WS.byKey.get(d.liWsTog);
    if (LI_WS.open.has(d.liWsTog)) LI_WS.open.delete(d.liWsTog);
    else {
      LI_WS.open.add(d.liWsTog);
      if (p) liWsReadParent(p, false);
    }
    liWsDraw();
    return refocus(`[data-li-ws-tog="${CSS.escape(d.liWsTog)}"]`);
  }
  if (d.liWsAgain) {
    const p = LI_WS.byKey.get(d.liWsAgain);
    if (p) liWsReadParent(p, true);
    liWsDraw();
    return refocus(`[data-li-ws-again="${CSS.escape(d.liWsAgain)}"]`);
  }
  if (d.liWsSku) {
    if (LI_WS.openSku.has(d.liWsSku)) LI_WS.openSku.delete(d.liWsSku);
    else LI_WS.openSku.add(d.liWsSku);
    liWsDraw();
    return refocus(`[data-li-ws-sku="${CSS.escape(d.liWsSku)}"]`);
  }
  if (d.liWsPass) {
    if (LI_WS.openPass.has(d.liWsPass)) LI_WS.openPass.delete(d.liWsPass);
    else LI_WS.openPass.add(d.liWsPass);
    liWsDraw();
    return refocus(`[data-li-ws-pass="${CSS.escape(d.liWsPass)}"]`);
  }
  if (d.liWsShow) {
    const sep = d.liWsShow.lastIndexOf('|');           // "brand|parent|step"
    const key = d.liWsShow.slice(0, sep);
    const step = d.liWsShow.slice(sep + 1);
    if (LI_WS.showStep.get(key) === step) LI_WS.showStep.delete(key);
    else LI_WS.showStep.set(key, step);
    liWsDraw();
    return refocus(`[data-li-ws-show="${CSS.escape(d.liWsShow)}"]`);
  }
  if (d.liWsOpen) {
    const sep = d.liWsOpen.indexOf('|');               // "brand|parent"
    liWsOff();
    return hFocusOpen(d.liWsOpen.slice(0, sep), d.liWsOpen.slice(sep + 1));
  }
  if (d.liWsSweep) return d.liWsSweep === 'stop' ? liWsStop() : liWsSweep();
  if (d.liWsRecheck) return d.liWsRecheck === 'stop' ? liWsStop() : liWsRecheck();
  if (d.liWsMore) {
    LI_WS.shown += LI_WS_PAGE;
    liWsDraw();
  }
});
