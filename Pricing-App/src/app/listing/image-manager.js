/* ================= LISTING · IMAGE MANAGER: every listing's pictures — the list of the whole brand, and the editor for one stack =================
 * Screens: Image Manager (tab 'img'), redesigned 14 Nov 2026: a sticky sidebar (search, brand, Show, the families) and the main
 *          area (one family or all: filter chips and a grid of picture cards, grouped by colour / family / none); the edit drawer
 *          on the right (one listing's MAIN / PT01–PT08 / SWATCH: reorder, upload, paste, check and send to Amazon); the
 *          clipboard bar (Copy all on a card, tick cards, Paste all into N selected). Listing Errors and Listing Health read the
 *          saved list snapshot too (IML, imgsnap / imgrows).
 * Does: imListLoad / imListBuild keep the brand snapshot; imListGroups and the im* checks drive the chips; imListRender draws
 *       the page; imLoad / imRender / imSwap edit one stack; imUpload / imSend check and apply through imPost (the app's one
 *       POST to the backend) and sqSendWithCheck; the clipboard copies one stack into one or many listings (imPastePlan →
 *       imPastePreview → imPasteMany → sqSendWithCheck).
 * Main functions: imMsg, imEsc, imPost, imListEnsure, imListLoad, imListBuild, imListGroups, imFamilies, imSideRender, imCardHtml,
 *                 imSections, imListRender, imClipBar, imCopyAll, imLoad, imRender, imSwap, imUpload, imSend, imHistory, imClipTake,
 *                 imPastePlan, imPasteMany, imWire. */
/* ================= IMAGE MANAGER =================
 *
 * Sellora → Listing → Image Manager. Two screens in one tab:
 *   1. THE LIST   — every listing of a brand, parent → child, with its live pictures and swatch.
 *   2. THE EDITOR — one listing's stack (MAIN, PT01..PT08, SWATCH): reorder, upload, paste, and send
 *                   to Amazon through the Listings Items API.
 * Backend: Pricing-API/ListingImages.gs (?limg=get|page|history, POST limg=patch|upload).
 * Saved list snapshot: Firestore imgsnap/{brand} + imgrows/{brand}_{i}.
 *
 * Every send is checked with Amazon first (VALIDATION_PREVIEW) and only goes for real when Amazon
 * reports no error. ACCEPTED means queued, not live. New pictures go to a public Drive folder,
 * because Amazon takes an address and fetches the picture itself.
 *
 * HOW THIS FILE IS LAID OUT (read top to bottom):
 *   1. State            — every variable the tab keeps, in one place
 *   2. Helpers          — escaping, messages, URL packing, the POST call
 *   3. Switching views  — tab entry, list ⇄ editor
 *   4. List: data       — read the saved snapshot, rebuild it from Amazon
 *   5. List: checks     — grouping and the rules behind every chip and filter
 *   6. List: drawing    — tiles, rows, the page
 *   7. Editor: stack    — load one listing, draw it, reorder/replace slots
 *   8. Editor: send     — upload a picture, check/apply with Amazon, history
 *   9. Copy & paste     — the stack clipboard, single and many listings
 *  10. Event wiring     — every toolbar button and box is connected here
 *
 * Naming: im* = the tab in general / the editor, imList* and IML* = the list, imClip* = clipboard.
 * The file is joined into the app by tests/assemble.js (src/app/ORDER); it is one module scope,
 * so functions here can call each other in any order, but STATE must be declared before section 10.
 */

/* ============================================================================================
 * 1. STATE — everything the tab remembers
 * Editor state first (one listing), then the list (whole brand), then the clipboard.
 */

const IM_SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'];
let IM = null;          // what the backend answered
let IM_START = {};      // slot -> url the stack started from
let IM_NOW = {};        // slot -> url as edited (MAIN..PT08 + SWCH)
let IM_DIMS = {};       // url -> {w,h}, measured in the browser
let IM_DRAG = '';       // the slot being dragged in the editor
let IM_RESULT = '';     // the last answer from Amazon, kept across redraws

let IM_SKU_CHOICES = null;   // the SKUs a typed search matched, while the person picks one

let IM_FILE_SLOT = '';  // the slot a chosen file goes into
const IM_QFILE = {};    // uploaded url -> what the local file showed (image-quality.js imqReadFile: w, h, bytes, white, fill)

const IML = {};                 // brand -> {at, items}
let IML_DIRTY = false;          // the snapshot changed since it was drawn
let IML_PAGE = 0;               // page of the list on screen (0-based)
let IML_BUSY = false;           // a rebuild from Amazon is running
let IML_PROG = null;            // { name, done, total } while it runs: the thin bar under the toolbar
const IML_PER = 40;             // listings per screen
const IML_CHUNK = 500;          // listings per Firestore chunk doc
let IML_VIEW = 'mine';          // which picture a tile shows first: ours, or what Amazon serves
let IM_OWNER = new Map();       // image file -> the listing of ours that submitted it

let IM_CLIP = null;     // { brand, sku, asin, c, z, slots: {MAIN..PT08, SWCH}, n }
const IM_SEL = new Set();   // SKUs ticked in the list, for pasting into several at once
let IM_PASTE_MODE = 'replace';  // the clipboard bar's mode: 'replace' these slots | 'gaps' = only fill empty slots
let IM_PV = null;
/* THE PAGE (redesign, 14 Nov 2026): a sticky sidebar (search, brand, Show, the FAMILIES) beside the main area — one family (or every
 * family) as a grid of picture cards, grouped by colour, by family or not at all. Cards are drawn IM_CHUNK at a time as they come near
 * the screen (a block far away is emptied again, keeping its height, so the page never moves). */
let IM_FAM = '';             // the family the main area shows (imGroupKey); '' = every family
let IM_SHOW = 'all';         // the sidebar's Show: 'all' | 'need' (needs fixing) | 'small' (below 2000 px) | 'good' (all good)
const IM_GROUP_KEY = 'sellora.imggroup';
let IM_GROUP = 'colour';     // cards grouped by 'colour' | 'family' | 'none' — remembered in this browser
try {
  const kept = localStorage.getItem(IM_GROUP_KEY);
  if (kept === 'family' || kept === 'none') IM_GROUP = kept;
} catch (e) { /* no storage: by colour */ }
const IM_CHUNK = 24;         // cards drawn at a time
const IM_CHUNK_H = new Map();// 'key|i' → measured height of a block of cards: a redraw keeps the page where it was
const IM_ROWS = new Map();   // block key → the cards it shows
let IM_CHUNK_OBS = null;
let IM_SHOWN = [];          // the SKUs of the cards on the page, in order (Select all, Shift+click ranges)
let IML_LOADING = false;    // the saved snapshot is being read (the page shows its skeleton)
let IM_ONLY = null;         // { skus: Set, label } — only these listings, picked in Listing Health's Fix all (fix-all.js), until "Show every listing"
// Show only these listings (ticked, page 1, no search), with a bar naming where they were picked; empty → every listing again.
function imOnly(skus, label) {
  IM_ONLY = skus && skus.length ? { skus: new Set(skus), label: label || '' } : null;
  IML_PAGE = 0;
  IM_FAM = '';
  IM_SHOW = 'all';
  $('imQ').value = '';
  $('imFilter').value = 'all';
  if (typeof imShowEditor === 'function') imShowEditor(false);
}
try {
  IM_CLIP = JSON.parse(localStorage.getItem('sellora.imgclip') || 'null');
} catch (e) {
  IM_CLIP = null;
}

/* ============================================================================================
 * 2. HELPERS — small functions used everywhere
 * imPost is the only POST to the backend (patch, upload). GETs go through baCall (brand-analytics.js).
 */

// Status line under the toolbar: red for an error, grey otherwise. Does nothing if the pane is not on the page.
function imMsg(text, bad) {
  const el = $('imMsg');
  if (el) {
    el.textContent = text || '';
    el.className = 'im-sr' + (bad ? ' err' : '');     // read out by screen readers; seen as a toast
  }
  imToast(text, bad);
}
/* MESSAGES AS TOASTS (bottom right), so nothing jumps inside the page. imMsg keeps one toast up to date: a message ending in "…" (work
 * going on) stays until the next one; others fade after 5 s (an error after 9 s); "✕" closes it; imMsg('') takes it away. */
let IM_TOAST = null;
function imToast(text, bad) {
  const box = $('imToasts');
  if (!box || !box.appendChild || typeof document === 'undefined' || !document.createElement) return;
  if (IM_TOAST) clearTimeout(IM_TOAST.t);
  if (!text) {
    if (IM_TOAST && IM_TOAST.el) IM_TOAST.el.remove();
    IM_TOAST = null;
    return;
  }
  if (!IM_TOAST || !IM_TOAST.el || !IM_TOAST.el.isConnected) {
    const el = document.createElement('div');
    el.className = 'im-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span></span><button type="button" aria-label="Close">✕</button>';
    el.querySelector('button').onclick = () => imToast('');
    box.appendChild(el);
    IM_TOAST = { el, t: 0 };
  }
  IM_TOAST.el.classList.toggle('is-bad', !!bad);
  IM_TOAST.el.querySelector('span').textContent = text;
  if (!/…$/.test(String(text).trim())) IM_TOAST.t = setTimeout(() => imToast(''), bad ? 9000 : 5000);
}
// HTML-escape for everything this tab prints.
const imEsc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

// POST to the backend: the write key and the signed-in person's token go with the body; the answer is parsed as JSON.
async function imPost(body) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  // text/plain keeps it a simple request: Apps Script cannot answer a CORS preflight.
  /* A write carries its own key (config/api writeKey, once set) and the signed-in person's token (2026-10-17). */
  let idToken = '';
  try {
    if (auth.currentUser) idToken = await auth.currentUser.getIdToken();
  } catch (e) { /* the backend says so if it needs it */ }
  const res = await fetch(API.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({ key: API.writeKey || API.key, idToken }, body)), redirect: 'follow' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('The backend did not answer with data: ' + text.slice(0, 120));
  }
}

const IM_PFX = 'https://m.media-amazon.com/images/I/';   // Amazon's image host; the snapshot stores only what follows it
// Store an Amazon image URL as just its file name; put the prefix back when reading.
const imPackUrl = url => !url ? '' : (url.startsWith(IM_PFX) ? url.slice(IM_PFX.length) : url);
const imUnUrl = url => !url ? '' : (/^https?:/.test(url) ? url : IM_PFX + url);
// The same for a whole { slot: url } map.
const imPackMap = map => {
  const out = {};
  Object.keys(map || {}).forEach(key => { out[key] = imPackUrl(map[key]); });
  return out;
};
const imUnMap = map => {
  const out = {};
  Object.keys(map || {}).forEach(key => { out[key] = imUnUrl(map[key]); });
  return out;
};
/* Amazon serves any size of its own pictures from the same name: `._SL120_` asks for 120px, which is
 * what a 58px tile needs — the full 2,000px file for thousands of tiles would stall the page. */
const imThumb = url => /m\.media-amazon\.com\/images\/I\/[^/]+\.(jpg|png)$/i.test(url) ? url.replace(/\.(jpg|png)$/i, '._SL120_.$1') : url;
// Image Manager's own tiles are bigger (76 px, sharp on a 2× screen): 160 px. imThumb above stays for Listing Errors and the Workspace.
const imThumbL = url => /m\.media-amazon\.com\/images\/I\/[^/]+\.(jpg|png)$/i.test(url) ? url.replace(/\.(jpg|png)$/i, '._SL160_.$1') : url;
// The big picture on a card: 400 px.
const imThumbXL = url => /m\.media-amazon\.com\/images\/I\/[^/]+\.(jpg|png)$/i.test(url) ? url.replace(/\.(jpg|png)$/i, '._SL400_.$1') : url;

/* ============================================================================================
 * 3. SWITCHING VIEWS — tab entry, list ⇄ editor
 */

// First visit to the tab (called from showTab).
function ensureImg() {
  imStick();
  imListEnsure();
}

// The thin progress bar under the toolbar while the brand is read from Amazon: "Reading Ridhi listings: 2,339 of 2,831".
function imProg() {
  const el = $('imProg');
  if (!el) return;
  if (!IML_PROG) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const { name, done, total } = IML_PROG;
  const pct = total ? Math.min(100, done * 100 / total) : 0;
  el.hidden = false;
  el.setAttribute('aria-valuenow', String(Math.round(pct)));
  el.innerHTML = `<span class="im-prog-bar"><i style="width:${pct.toFixed(1)}%"></i></span>`
    + `<span>Reading ${imEsc(name)} listings: ${done.toLocaleString('en-US')}${total ? ' of ' + total.toLocaleString('en-US') : ''}</span>`;
}
/* The toolbar sticks under Sellora's menu bar (like Listing Health's): the bar's height is measured, because it wraps onto a second
 * line on narrower screens and is a drawer (not sticky) on phones — then the offset is 0. */
function imStick() {
  try {
    const pane = $('paneImg');
    if (!pane || !pane.style || !pane.style.setProperty || typeof getComputedStyle !== 'function' || !document.querySelector) return;
    const side = document.querySelector('.side');
    const top = side && getComputedStyle(side).position === 'sticky' ? Math.round(side.getBoundingClientRect().height) : 0;
    pane.style.setProperty('--im-top', top + 'px');
  } catch (e) { /* no layout to measure (a test page) */ }
}

/* Show the editor (true) or close it (false). THE EDITOR IS A PANEL ON THE RIGHT: the list stays on screen, where it was (no scroll, no
 * redraw), so the next listing is one click away. The open listing's row is marked; the clipboard bar's quick picks learn "This listing". */
function imShowEditor(on) {
  $('imEditWrap').classList.toggle('hide', !on);
  $('imListWrap').classList.remove('hide');
  if (!on && document.querySelectorAll) document.querySelectorAll('#imList .im-kid.is-open').forEach(row => row.classList.remove('is-open'));
  imClipRefresh();
}

/* ============================================================================================
 * 4. LIST: DATA — read the saved snapshot, or rebuild it from Amazon
 */

/* ================= THE WHOLE CATALOGUE, PARENT → CHILD =================
 *
 * Every listing of the brand with its LIVE images (the catalogue, what shoppers see) and its swatch
 * (only the listing carries it — the catalogue never returns SWCH). Built by walking the Listings
 * API 20 at a time through the backend (`limg=page`), then saved to Firestore (`imgsnap/{brand}` +
 * `imgrows/{brand}_{i}`) so opening the tab is a read, not a two-minute walk.
 *
 * A thumbnail with an orange ring is a slot where the LIVE picture differs from the one this
 * listing submitted — another contributor won it, or a change is still processing. On the first
 * walk that was 77 of 800 Ridhi listings, so it is a filter of its own.
 */

// Make sure the brand's snapshot is loaded and drawn; rebuild it from Amazon when there is none or it is a day old.
async function imListEnsure() {
  const brand = $('imBrand').value;
  if (!(brand in IML)) {
    IML_LOADING = true;
    imListRender();          // the skeleton while the saved pictures are read
    await imListLoad(brand);
    IML_LOADING = false;
  }
  if (!IML[brand] || !IML[brand].items.length) {
    imListRender();
    if (!IML_BUSY) imListBuild(brand);
    return;
  }
  imListRender();
  const age = IML[brand].at ? Date.now() - IML[brand].at.getTime() : Infinity;
  if (age > 24 * 3600e3 && !IML_BUSY) imListBuild(brand);
}

// Read one brand's saved snapshot (imgsnap/{brand} + its imgrows chunks) into IML[brand], URLs unpacked.
async function imListLoad(brand) {
  try {
    const meta = await getDoc(doc(db, 'imgsnap', brand));
    if (!meta.exists()) {
      IML[brand] = null;
      return;
    }
    const data = meta.data();
    const nChunks = data.chunks || 0;
    const got = await Promise.all(Array.from({ length: nChunks }, (_, i) => getDoc(doc(db, 'imgrows', brand + '_' + i))));
    let items = [];
    got.forEach(chunk => {
      if (chunk.exists()) items = items.concat(chunk.data().r || []);
    });
    IML[brand] = { at: data.at && data.at.toDate ? data.at.toDate() : null,
      items: items.map(item => Object.assign({}, item, { live: imUnMap(item.live), img: imUnMap(item.img) })) };
  } catch (e) {
    IML[brand] = null;
    imMsg('Could not read the saved snapshot: ' + (e.message || e), true);
  }
}

// Rebuild one brand's snapshot from Amazon: count listings per created-date window, page through each, save in chunks.
async function imListBuild(brandKey) {
  if (IML_BUSY) return;
  IML_BUSY = true;
  $('imRefresh').disabled = true;
  const name = brandKey === 'CPC' ? 'CPC' : 'Ridhi';
  let items = [];
  try {
    // --- windows small enough for Amazon's 1,000 cap ---
    /* AMAZON STOPS ONE SEARCH AT 1,000 LISTINGS (both brands came back as exactly 1,000 on 9 Oct).
     * So the catalogue is read in created-date windows, halved until each holds fewer. */
    const iso = ms => new Date(ms).toISOString();
    const wins = [];
    let grand = 0;                 // listings in every window: the progress bar's "of N"
    const todo = [[Date.parse('2010-01-01T00:00:00Z'), Date.now() + 864e5]];
    imMsg('Counting ' + name + ' listings…');
    while (todo.length) {
      const [from, to] = todo.shift();
      const total = (await baCall({ limg: 'page', brand: brandKey, count: 1, after: iso(from), before: iso(to) })).total || 0;
      if (!total) continue;
      if (total > 990 && to - from > 60e3) {
        const mid = Math.floor((from + to) / 2);
        todo.unshift([from, mid], [mid, to]);
        continue;
      }
      wins.push([from, to]);
      grand += total;
    }
    // --- read every window, page by page ---
    for (const [from, to] of wins) {
      let token = '';
      do {
        IML_PROG = { name, done: items.length, total: grand };
        imProg();
        imMsg('');
        const reply = await baCall({ limg: 'page', brand: brandKey, token, pages: 40, after: iso(from), before: iso(to) });
        items = items.concat(reply.items || []);
        token = reply.next || '';
      } while (token);
    }
    // --- one entry per SKU, URLs packed, empty fields dropped, saved in chunks ---
    const seen = new Set();
    items = items.filter(item => !seen.has(item.sku) && seen.add(item.sku));
    const packed = items.map(item => {
      const copy = Object.assign({}, item, { live: imPackMap(item.live), img: imPackMap(item.img) });
      delete copy.main;
      Object.keys(copy).forEach(key => { if (copy[key] === undefined || copy[key] === '') delete copy[key]; });
      return copy;
    });
    const chunks = Math.ceil(packed.length / IML_CHUNK) || 1;
    for (let i = 0; i < chunks; i++) {
      await setDoc(doc(db, 'imgrows', brandKey + '_' + i), { r: packed.slice(i * IML_CHUNK, (i + 1) * IML_CHUNK) });
    }
    await setDoc(doc(db, 'imgsnap', brandKey), { chunks, n: packed.length, at: serverTimestamp(), by: ME.email });
    IML[brandKey] = { at: new Date(), items };
    imMsg('');
  } catch (e) {
    imMsg('Reading from Amazon stopped after ' + items.length + ' listings: ' + (e.message || e), true);
    if (items.length && !IML[brandKey]) IML[brandKey] = { at: new Date(), items };
  }
  IML_PROG = null;
  imProg();
  IML_BUSY = false;
  $('imRefresh').disabled = false;
  if ($('imBrand').value === brandKey) imListRender();
}

/* ============================================================================================
 * 5. LIST: CHECKS — grouping, and the rules behind each chip and filter
 * Pure functions of one listing row. Change a rule here and the chip, the filter and the counts
 * at the top of the list all follow, because they all call these.
 */

/** Parents with their children; a listing with no parent is a group of its own. */
// Returns [{ parent, kids, psku }], in the order the items came.
function imListGroups(items) {
  const bySku = new Map(items.map(item => [item.sku, item]));
  const groups = new Map();
  items.forEach(item => {
    if (item.lvl === 'parent') {
      if (!groups.has(item.sku)) groups.set(item.sku, { parent: item, kids: [], psku: item.sku });
      else groups.get(item.sku).parent = item;
      return;
    }
    const key = item.psku || ('solo:' + item.sku);
    if (!groups.has(key)) groups.set(key, { parent: item.psku ? (bySku.get(item.psku) || null) : null, kids: [], psku: item.psku || '' });
    groups.get(key).kids.push(item);
  });
  return [...groups.values()];
}

/** Every picture we submitted, and which listing submitted it — so a borrowed slot can be named. */
function imOwnerBuild(items) {
  IM_OWNER = new Map();
  items.forEach(item => IM_SLOTS.forEach(slot => {
    const url = (item.img || {})[slot];
    if (!url) return;
    if (!IM_OWNER.has(url)) IM_OWNER.set(url, []);
    IM_OWNER.get(url).push(item);
  }));
}

/** The listing whose MAIN picture Amazon serves on THIS one in place of its own, if any.
 *  Several listings often share one picture, so a sibling under the same parent is named first. */
function imHijack(item) {
  const live = item.live || {};
  const img = item.img || {};
  if (!live.MAIN || !img.MAIN || live.MAIN === img.MAIN) return null;
  const own = (IM_OWNER.get(live.MAIN) || []).filter(other => other.sku !== item.sku);
  if (!own.length) return null;
  return own.find(other => item.psku && other.psku === item.psku) || own[0];
}

/* WHAT AMAZON ACTUALLY SAYS ABOUT THIS LISTING.
 * BUYABLE WITHOUT DISCOVERABLE IS A SUPPRESSED LISTING — it can still be bought from a direct link
 * and cannot be found in search. RTC203-6060 sat like that under a green "Buyable" chip here while
 * Seller Central said "Search suppressed", because the chip only tested /BUYABLE/. */
// The status chip for one listing: { k: short key, label, fill, ink }.
function imState(item) {
  const status = String(item.st || '').toUpperCase();
  const buy = status.includes('BUYABLE');
  const disc = status.includes('DISCOVERABLE');
  if (buy && !disc) return { k: 'sup', label: 'Search suppressed', fill: 'var(--bad-bg)', ink: 'var(--bad-ink)' };
  if (buy && disc) return { k: 'ok', label: 'Buyable', fill: 'var(--accent-bg)', ink: 'var(--accent-ink)' };
  if (disc && !buy) return { k: 'nooffer', label: 'No offer', fill: 'var(--hover)', ink: 'var(--muted)' };
  return { k: 'none', label: item.st || 'Not buyable', fill: 'var(--hover)', ink: 'var(--muted)' };
}

/** True when the listing itself submitted no main image — what shows comes from the family. */
const imNoOwnMain = item => !(item.img || {}).MAIN && !!(item.live || {}).MAIN;
/** No main picture at all: none sent by us, none shown to shoppers. */
const imNoMain = item => !(item.img || {}).MAIN && !(item.live || {}).MAIN;

/* PICTURE PROBLEMS ONLY. Image Manager shows only Amazon's issues about pictures: the issue names a picture slot's attribute, carries a
 * picture error code, or its message is about an image / picture / photo / swatch. Everything else (ERROR 90244 Unit Count, specs, the
 * title…) belongs to Listing Errors and is hidden here. Works on the list's issues ({ s, c, m, a }) and the editor's
 * ({ severity, code, message, attrs }). */
const IM_PIC_ATTR = /^(main_product_image_locator|other_product_image_locator_[1-8]|swatch_product_image_locator)$/;
const IM_PIC_CODES = ['18320'];        // "The main image is missing or incorrect" (RTC203-6060, 9 Oct)
const IM_PIC_WORDS = /\b(image|images|picture|pictures|photo|photos|swatch)\b/i;
function imIsPicIssue(issue) {
  if (!issue) return false;
  const attrs = issue.a || issue.attrs || [];
  return attrs.some(attr => IM_PIC_ATTR.test(String(attr))) || IM_PIC_CODES.includes(String(issue.c || issue.code || ''))
    || IM_PIC_WORDS.test(String(issue.m || issue.message || ''));
}
/** A listing's Amazon ERRORs about pictures (from the snapshot's issues; a snapshot from before they were kept: the first error's words). */
function imPicErrs(item) {
  if (Array.isArray(item.iss)) return item.iss.filter(issue => issue && issue.s === 'E' && imIsPicIssue(issue));
  return item.ie && imIsPicIssue({ m: item.im }) ? [{ s: 'E', c: '', m: item.im || '', a: [] }] : [];
}

/** The main picture shoppers see was marked Not OK in the Picture check (picture-check.js keeps the marks per picture id). */
const imPcBad = (brand, item) => typeof PC !== 'undefined' && !!(item.live || {}).MAIN && ((PC.marks[brand] || {})[imqId(item.live.MAIN)] || {}).v === 'bad';
/** A picture of the stack (ours or what shoppers see; not the swatch) whose size is known and under 2000 on its shortest side. */
const imSmall = item => IM_SLOTS.some(slot => [(item.img || {})[slot], (item.live || {})[slot]].some(url => {
  const wh = imqDims(url);
  return !!wh && imqSize(wh[0], wh[1]) !== 'g';
}));
const imMeasured = item => IM_SLOTS.some(slot => !!imqDims((item.img || {})[slot] || (item.live || {})[slot]));

/* THE NUMBER CARDS at the top of the list. Each is one of the filter picker's own filters (the picker stays and follows the card):
 * a click shows only those listings, a second click shows all again. Counted over every child listing of the brand. */
const IM_CARDS = [
  { k: 'nomain', t: 'No main at all', cls: 'is-err', tip: 'No main picture: none sent by us and none shown to shoppers' },
  { k: 'noown', t: 'Using the family\'s main', cls: 'is-att', tip: 'Your listing sent no main picture of its own; shoppers see the family\'s, and Amazon can suppress it' },
  { k: 'pcbad', t: 'Main not OK', note: 'Picture check', cls: 'is-err', tip: 'Main pictures a person marked Not OK in the Picture check' },
  { k: 'small', t: 'Too small', note: 'under 2000', cls: 'is-att', tip: 'A picture under 2000 × 2000 (company minimum). Counted from the sizes known so far: the Workspace\'s catalogue reads and the tiles measured on screen' },
  { k: 'few', t: 'Fewer than 7', note: 'pictures', cls: 'is-att', tip: 'Fewer than 7 pictures in the stack' },
  { k: 'amzerr', t: 'Amazon picture error', cls: 'is-err', tip: 'Amazon reports an error about the pictures (other errors are in Listing Errors)' },
  { k: 'sup', t: 'Search suppressed', cls: 'is-err', tip: 'Buyable from a direct link, but taken out of search results' },
  { k: 'other', t: 'Shows another SKU\'s pictures', cls: 'is-act', tip: 'Amazon\'s catalogue serves another SKU\'s main picture on this ASIN' },
  { k: 'noswatch', t: 'No swatch', cls: 'is-att', tip: 'No swatch picture, ours or live' },
];
/** The cards' numbers: [{ k, t, note, cls, tip, n }] over every child listing in `items` (IM_OWNER must be built for them). */
function imCardsData(items) {
  const kids = items.filter(item => item.lvl !== 'parent');
  return IM_CARDS.map(card => {
    const n = kids.filter(kid => imKidMatch(kid, card.k, '')).length;
    const note = card.k === 'small' ? `under 2000 · ${kids.filter(imMeasured).length.toLocaleString('en-US')} of ${kids.length.toLocaleString('en-US')} measured` : card.note || '';
    return Object.assign({}, card, { n, note });
  });
}
// Sizes landed (pictures measured on screen): the strips' rings follow at once (imqPaint); the sidebar's counts here, at most once a
// second, without drawing the cards again.
let IM_CARDS_T = 0;
function imCardsSoon() {
  if (IM_CARDS_T) return;
  IM_CARDS_T = setTimeout(() => {
    IM_CARDS_T = 0;
    const data = IML[$('imBrand').value];
    if (!data) return;
    const search = ($('imQ').value || '').trim().toLowerCase();
    imSideRender(data.items, imFamilies(data.items, search), search);
  }, 1000);
}

// Does one listing pass the filter picker (`filter`) and the search box (`search`, lower case)?
function imKidMatch(item, filter, search) {
  const live = item.live || {};
  const img = item.img || {};
  if (search) {
    const hay = [item.sku, item.asin, item.pa, item.psku, item.t, item.c, item.z].join(' ').toLowerCase();
    if (!search.split(/\s+/).every(word => hay.includes(word))) return false;
  }
  if (filter === 'nomain') return imNoMain(item);
  if (filter === 'pcbad') return imPcBad($('imBrand').value, item);
  if (filter === 'small') return imSmall(item);
  if (filter === 'diff') return IM_SLOTS.some(slot => img[slot] && live[slot] && img[slot] !== live[slot]);
  if (filter === 'few') return IM_SLOTS.filter(slot => live[slot] || img[slot]).length < 7;
  if (filter === 'noswatch') return !img.SWCH && !live.SWCH;
  if (filter === 'other') return !!imHijack(item);
  if (filter === 'sup') return imState(item).k === 'sup';
  if (filter === 'amzerr') return imPicErrs(item).length > 0;
  if (filter === 'noown') return imNoOwnMain(item);
  if (filter === 'nobuy') return !/BUYABLE/.test(item.st || '');
  return true;
}

/* ============================================================================================
 * 6. LIST: DRAWING — tiles, one row per child, the page
 */

// The key under the cards.
const IM_LEGEND = '<span class="im-bf-key">B<i class="fa-bfd is-g"></i> F<i class="fa-bfd is-r"></i></span> on a picture: B = the picture we sent,'
  + ' F = what shoppers see (green = that picture, red = shoppers see another, ○ = not live yet, – = none) · dot = size: '
  + '<i class="imq-dot is-g"></i> 2000+ <i class="imq-dot is-y"></i> under 2000 <i class="imq-dot is-r"></i> no zoom';

/** B / F of one slot, the same meaning as the Workspace's: B = what our listing sent (Seller Central), F = what shoppers see.
 *  { b, f } with g (that picture) / r (shoppers see another) / u (not live yet) / n (none); `differs` when F is not B's picture. */
function imBfOf(liveUrl, mineUrl) {
  const b = mineUrl ? 'g' : 'n';
  const f = !liveUrl ? (mineUrl ? 'u' : 'n') : (mineUrl && liveUrl !== mineUrl ? 'r' : 'g');
  return { b, f, differs: b + f !== 'gg' && b + f !== 'nn' };
}
const IM_BF_TIP = { gg: 'Shoppers see the picture we sent', gr: 'We sent a picture; shoppers see another one in this slot', gu: 'We sent this picture; it is not live yet',
  ng: 'Shoppers see a picture our listing did not send (from the family or another contributor)' };
const imBfDot = s => (s === 'n' ? '<span class="fa-bfn" aria-hidden="true">–</span>' : `<i class="fa-bfd is-${s}" aria-hidden="true"></i>`);

// One thumbnail in a listing's strip; `sw` marks the swatch tile. B / F shows when what shoppers see is not the picture we sent (the
// .im-diff class — the old orange ring — is still set underneath); a dot gives the size; hover offers "Copy this picture".
function imTile(slot, liveUrl, mineUrl, sw, sku) {
  const tile = imTileA(slot, liveUrl, mineUrl, sw);
  const url = IML_VIEW === 'live' ? (liveUrl || mineUrl) : (mineUrl || liveUrl);
  if (!url) return tile;
  const bf = imBfOf(liveUrl, mineUrl);
  // The swatch has no B / F: Amazon's catalogue never returns a swatch, so F would read 'not live' on every one.
  const tag = sw ? '' : `<span class="im-bf${bf.differs ? ' is-diff' : ''}" title="${imEsc((IM_BF_TIP[bf.b + bf.f] || '') + ' · B = the picture we sent, F = what shoppers see')}">B${imBfDot(bf.b)}F${imBfDot(bf.f)}</span>`;
  let dot = '';
  if (!sw) {
    const wh = imqDims(url);
    const size = wh ? imqSize(wh[0], wh[1]) : '';
    dot = size ? `<i class="imq-dot is-${size}" data-imq="${imEsc(imqId(url))}" title="${wh[0]} × ${wh[1]} — ${imEsc(IMQ_WORDS[size])}"></i>`
      : `<i class="imq-dot" data-imq="${imEsc(imqId(url))}" data-imq-url="${imEsc(url)}" title="Size not known yet"></i>`;
  }
  const name = slot === 'SWCH' ? 'the swatch' : slot;
  const copy = sku ? `<button type="button" class="im-tcopy" data-copy1="${imEsc(sku)}" data-slot="${slot}" data-url="${imEsc(url)}" title="Copy this picture (${name}) to the clipboard">Copy</button>` : '';
  // Hover: View (the large viewer) · Copy · Replace (choose a file; the editor opens and uploads it into this slot, same picture rules).
  const acts = sku ? `<span class="im-tact"><button type="button" class="im-tview" data-view="${imEsc(sku)}" data-slot="${slot}" title="See ${name} large">View</button>${copy}`
    + `<button type="button" class="im-trepl" data-repl="${imEsc(sku)}" data-slot="${slot}" title="Replace ${name}: choose a file — the editor opens and uploads it here">Replace</button></span>` : '';
  return `<span class="im-tw${sw ? ' im-tw-sw' : ''}"${sku ? ` data-sku="${imEsc(sku)}" data-slot="${slot}"` : ''}>${tile}${tag}${dot}${acts}</span>`;
}
function imTileA(slot, liveUrl, mineUrl, sw) {
  /* THE TILE SHOWS YOUR OWN PICTURE BY DEFAULT. Amazon's catalogue often serves another child's
   * pictures on a listing that has no offer of its own, so a live-first strip drew green tablecloths
   * under a Pink Coral SKU. The orange ring still says the two disagree; the view picker swaps them. */
  const url = IML_VIEW === 'live' ? (liveUrl || mineUrl) : (mineUrl || liveUrl);
  const diff = !!(liveUrl && mineUrl && liveUrl !== mineUrl);
  const label = slot === 'SWCH' ? 'SW' : slot === 'MAIN' ? 'M' : slot.slice(2);
  if (!url) return `<div class="im-th im-empty${sw ? ' im-sw' : ''}" title="${slot}: empty">${label}</div>`;
  const tip = slot + (diff ? ' — Amazon is serving a different picture in this slot' : '')
    + (!liveUrl && mineUrl ? ' — from your listing, not live yet' : '')
    + (liveUrl && !mineUrl ? ' — live on Amazon, not in your listing' : '');
  return `<a class="im-th${diff ? ' im-diff' : ''}${sw ? ' im-sw' : ''}" href="${imEsc(url)}" target="_blank" rel="noopener" title="${imEsc(tip)}">`
    + `<img src="${imEsc(imThumbL(url))}" loading="lazy" decoding="async" alt="${slot}">${sw ? '' : `<i>${label}</i>`}</a>`;
}

/** The ONE status chip of a row — the worst thing about its pictures first, else Amazon's status: { t, cls, tip }. */
function imKidChip(item) {
  const errs = imPicErrs(item);
  if (errs.length) return { t: errs.length > 1 ? errs.length + ' Amazon picture errors' : 'Amazon picture error', cls: 'is-bad', tip: errs.map(e => (e.c ? e.c + ': ' : '') + e.m).join(' · ') };
  const state = imState(item);
  if (state.k === 'sup') return { t: 'Search suppressed', cls: 'is-bad', tip: 'Amazon still allows a direct-link sale but has taken this listing out of search results.' };
  if (imNoMain(item)) return { t: 'No main at all', cls: 'is-bad', tip: 'No main picture: none sent by us and none shown to shoppers' };
  if (imNoOwnMain(item)) return { t: 'Using the family\'s main', cls: 'is-att', tip: 'Your listing submitted no main image. What shows on Amazon comes from the family, and Amazon can suppress a listing for it.' };
  const hijack = imHijack(item);
  if (hijack) return { t: 'Shows ' + hijack.sku + '\'s pictures', cls: 'is-att', tip: 'Amazon catalogue serves ' + hijack.sku + (hijack.c ? ' (' + hijack.c + ')' : '') + ' pictures on this ASIN. The strip shows your own.' };
  return { t: state.label, cls: state.k === 'ok' ? 'is-ok' : '', tip: '' };
}
/** "9/9 pictures · 2 below 2000 · no swatch" — the pictures the tiles show (the view picker's choice), sizes as far as known. */
function imKidSummary(item) {
  const live = item.live || {};
  const img = item.img || {};
  const urls = IM_SLOTS.map(slot => (IML_VIEW === 'live' ? (live[slot] || img[slot]) : (img[slot] || live[slot]))).filter(Boolean);
  const below = urls.filter(url => { const wh = imqDims(url); return wh && imqSize(wh[0], wh[1]) !== 'g'; }).length;
  return `${urls.length}/9 pictures${below ? ` · <b class="is-warn">${below} below 2000</b>` : ''}${!img.SWCH && !live.SWCH ? ' · no swatch' : ''}`;
}
/** Does this listing need picture work? (any card's problem but suppression, which is not a picture problem by itself) */
const IM_NEEDS = ['amzerr', 'nomain', 'noown', 'pcbad', 'small', 'few', 'other', 'noswatch'];
const imNeeds = item => IM_NEEDS.some(k => imKidMatch(item, k, ''));

/* ---------- families: the sidebar's list ---------- */
const imGroupKey = group => (group.parent ? group.parent.sku : group.psku || 'solo:' + group.kids[0].sku);
/** A family's name: the parent's title, else "Parent <SKU>", else its one listing's title. */
function imFamName(group) {
  if (group.parent) return group.parent.t || 'Parent ' + group.parent.sku;
  return group.psku ? 'Parent ' + group.psku : (group.kids[0].t || group.kids[0].sku);
}
/** The picture a listing shows first in a slot: ours, else what shoppers see (the "Show what Amazon serves" choice swaps them). */
const imVal = (item, slot) => (IML_VIEW === 'live' ? ((item.live || {})[slot] || (item.img || {})[slot]) : ((item.img || {})[slot] || (item.live || {})[slot])) || '';
/** The sidebar's Show: every listing, the ones needing picture work, the ones with a picture below 2000 px, the ones all good. */
const IM_SHOWS = [
  { k: 'all', t: 'All listings', f: () => true },
  { k: 'need', t: 'Needs fixing', f: item => imNeeds(item) },
  { k: 'small', t: 'Below 2000 px', f: item => imSmall(item) },
  { k: 'good', t: 'All good', f: item => !imNeeds(item) },
];
const imShowOk = (item, k) => (IM_SHOWS.find(show => show.k === (k || IM_SHOW)) || IM_SHOWS[0]).f(item);
/** The families on the page: [{ key, group, kids (the listings passing Show, the search and Listing Health's pick), need, lv }], the ones with
 *  the most listings to fix first. A search that names the PARENT keeps its whole family. lv: 'bad' (a red problem), 'att', 'ok'. */
function imFamilies(items, search, show) {
  const out = [];
  imListGroups(items).forEach(group => {
    const picked = kid => !IM_ONLY || IM_ONLY.skus.has(kid.sku);
    const parentHit = !!search && !!group.parent && imKidMatch(group.parent, 'all', search);
    const kids = group.kids.filter(kid => picked(kid) && imShowOk(kid, show) && (parentHit || imKidMatch(kid, 'all', search)));
    if (!kids.length) return;
    const need = kids.filter(imNeeds);
    const bad = need.some(kid => imKidChip(kid).cls === 'is-bad');
    out.push({ key: imGroupKey(group), group, kids, need: need.length, lv: !need.length ? 'ok' : bad ? 'bad' : 'att' });
  });
  return out.sort((a, b) => (b.need - a.need) || (b.kids.length - a.kids.length) || imFamName(a.group).localeCompare(imFamName(b.group)));
}
// The sidebar: Show (with counts) and the families (picture, name, N listings, the problem badge).
function imSideRender(items, fams, search) {
  const showBox = $('imShow');
  if (showBox) {
    const base = [].concat(...imFamilies(items, search, 'all').map(fam => fam.kids));
    showBox.innerHTML = IM_SHOWS.map(show => `<button type="button" class="imx-show-i${IM_SHOW === show.k ? ' is-on' : ''}" data-im-show="${show.k}" aria-pressed="${IM_SHOW === show.k}">`
      + `<span>${imEsc(show.t)}</span><b>${base.filter(item => imShowOk(item, show.k)).length.toLocaleString('en-US')}</b></button>`).join('');
  }
  const famBox = $('imFams');
  if (famBox) {
    const total = fams.reduce((sum, fam) => sum + fam.kids.length, 0);
    const row = (key, pic, name, n, badge, on) => `<button type="button" class="imx-fam${on ? ' is-on' : ''}" data-im-fam="${imEsc(key)}" aria-pressed="${on}" title="${imEsc(name)}">`
      + `<span class="imx-fam-pic">${pic ? `<img src="${imEsc(imThumb(pic))}" alt="" loading="lazy">` : ''}</span>`
      + `<span class="imx-fam-t"><b>${imEsc(name)}</b><small>${n.toLocaleString('en-US')} listing${n === 1 ? '' : 's'}</small></span>${badge}</button>`;
    const badge = fam => (fam.need ? `<span class="imx-badge is-${fam.lv}" title="${fam.need} listing(s) need picture work">${fam.need}</span>` : '<span class="imx-badge is-ok" title="Pictures fine">✓</span>');
    famBox.innerHTML = (fams.length ? row('', '', IM_ONLY ? 'Every picked listing' : 'All families', total, '', !IM_FAM) : '')
      + fams.map(fam => row(fam.key, imVal(fam.group.parent || fam.kids[0], 'MAIN'), imFamName(fam.group), fam.kids.length, badge(fam), IM_FAM === fam.key)).join('')
      || '<div class="imx-none">No family matches.</div>';
  }
  const brand = $('imBrand').value;
  document.querySelectorAll && document.querySelectorAll('[data-im-brand]').forEach(btn => {
    btn.classList.toggle('is-on', btn.dataset.imBrand === brand);
    btn.setAttribute('aria-pressed', String(btn.dataset.imBrand === brand));
  });
  const snap = $('imSnap');
  const data = IML[brand];
  if (snap) snap.textContent = data ? `Snapshot ${data.at ? data.at.toLocaleString() : '—'}${IML_BUSY ? ' · refreshing…' : ''}` : '';
}

/* ---------- the main area: title, buttons, filter chips ---------- */
const IM_CHIPS = [['all', 'All'], ['nomain', 'No main'], ['amzerr', 'Amazon picture error'], ['small', 'Below 2000'], ['few', 'Fewer than 7'], ['other', 'Shows another SKU\'s']];
function imHeadHtml(fams, kids) {
  const fam = IM_FAM ? fams.find(each => each.key === IM_FAM) : null;
  const p = fam && fam.group.parent;
  const title = fam ? imFamName(fam.group) : IM_ONLY ? 'Picked listings' : 'All families';
  const sub = fam ? (p ? `Parent <span class="im-mono">${imEsc(p.sku)}</span> · ${imEsc(p.asin || '')}` : fam.group.psku ? `Parent <span class="im-mono">${imEsc(fam.group.psku)}</span> · the parent listing itself was not found` : 'No variation parent')
    : `${fams.length.toLocaleString('en-US')} famil${fams.length === 1 ? 'y' : 'ies'}`;
  const seg = [['colour', 'Colour'], ['family', 'Family'], ['none', 'None']].map(([k, t]) => `<button type="button" data-im-group="${k}" class="${IM_GROUP === k ? 'is-on' : ''}" aria-pressed="${IM_GROUP === k}">${t}</button>`).join('');
  const allTicked = kids.length && kids.every(item => IM_SEL.has(item.sku));
  return `<div class="imx-head"><div class="imx-title"><h2>${imEsc(title)}</h2><span class="muted">${sub} · ${kids.length.toLocaleString('en-US')} listing${kids.length === 1 ? '' : 's'}</span></div>
    <div class="imx-head-act"><span class="imx-seg" role="group" aria-label="Group the cards"><span class="imx-seg-l">Group</span>${seg}</span>
      <button type="button" class="ghost imx-btn" id="imUpBtn" title="Choose picture files for the listing that is open or ticked: they fill its empty slots in order">Upload pictures</button>
      <button type="button" class="ghost imx-btn" data-im-selall="1" title="Tick every card on the page (again: untick)">${allTicked ? 'Untick all' : 'Select all'}</button></div></div>`;
}
function imChipsHtml(kids, filter) {
  const chips = IM_CHIPS.map(([k, t]) => {
    const n = k === 'all' ? kids.length : kids.filter(kid => imKidMatch(kid, k, '')).length;
    return `<button type="button" class="imx-chip${filter === k ? ' is-on' : ''}${k !== 'all' && !n ? ' is-zero' : ''}" data-im-chip="${k}" aria-pressed="${filter === k}">${imEsc(t)} <b>${n.toLocaleString('en-US')}</b></button>`;
  });
  // a filter picked elsewhere (Listing Health, the old filters): shown as one more chip, ✕ clears it
  if (filter !== 'all' && !IM_CHIPS.some(([k]) => k === filter)) {
    const name = (IM_CARDS.find(card => card.k === filter) || {}).t || filter;
    chips.push(`<button type="button" class="imx-chip is-on" data-im-chip="all" title="Show all again">${imEsc(name)} <b>${kids.filter(kid => imKidMatch(kid, filter, '')).length}</b> ✕</button>`);
  }
  return `<div class="imx-chips-row" role="group" aria-label="Filter the cards">${chips.join('')}</div>`;
}

/* ---------- one card ---------- */
// "60x90 · Rectangle" (grouped by colour) or "Blue · 60x90": what tells the cards of a group apart.
function imCardSub(item) {
  const shape = (String(item.t || '').match(/\b(rectangle|rectangular|round|square|oval|runner)\b/i) || [])[1] || '';
  const nice = shape ? shape[0].toUpperCase() + shape.slice(1).toLowerCase() : '';
  const parts = IM_GROUP === 'colour' ? [item.z, nice] : [item.c, item.z];
  return parts.filter(Boolean).join(' · ') || item.c || String(item.t || '').slice(0, 40);
}
/** What pasting the clipboard into this one listing would do: { t, cls } — "3 will change", "fills 3 empty", "already the same", a quality
 *  warning. The same plan as the paste (imPastePlan), nothing sent. */
function imCardPreview(item) {
  if (!IM_CLIP || IM_CLIP.sku === item.sku) return null;
  const plan = imPastePlan([item.sku], { withSw: imClipWithSw(), mode: IM_PASTE_MODE });
  if (!plan.jobs.length) {
    const why = (plan.held[0] || {}).why || '';
    return /already/.test(why) ? { t: 'already the same', cls: '' } : /no empty/.test(why) ? { t: 'no empty slot', cls: '' } : { t: 'open it to paste', cls: 'is-att', tip: why };
  }
  const n = Object.keys(plan.jobs[0].body.set).length;
  const fail = Object.values(plan.qual.get(item.sku) || {}).filter(q => q.fail).length;
  return { t: (IM_PASTE_MODE === 'gaps' ? `fills ${n} empty` : `${n} will change`) + (fail ? ` · ${fail} quality warning` : ''), cls: fail ? 'is-att' : 'is-go' };
}
const IM_ATTR_SLOT = { main_product_image_locator: 'MAIN', swatch_product_image_locator: 'SWCH' };
for (let i = 1; i <= 8; i++) IM_ATTR_SLOT['other_product_image_locator_' + i] = 'PT0' + i;
/** One listing's card: the big main picture (or a red "No main picture" box), tick, status, the 9-slot strip, SKU, chips; hover: Copy all,
 *  Paste all here, Edit. Click the card = Edit. */
function imCardHtml(item) {
  const sku = imEsc(item.sku);
  const main = imVal(item, 'MAIN');
  const st = imState(item);
  const pill = st.k === 'ok' ? ['Buyable', 'is-ok'] : st.k === 'sup' ? ['Suppressed', 'is-bad'] : st.k === 'nooffer' ? ['No offer', 'is-mute'] : ['Not buyable', 'is-mute'];
  const errs = imPicErrs(item);
  const errSlots = new Set([].concat(...errs.map(e => (e.a || []).map(a => IM_ATTR_SLOT[a]).filter(Boolean))).concat(errs.some(e => String(e.c) === '18320') ? ['MAIN'] : []));
  let filled = 0;
  let below = 0;
  const strip = IM_SLOTS.map(slot => {
    const url = imVal(item, slot);
    const name = slot === 'MAIN' ? 'Main' : slot.slice(2);
    if (!url) return `<span class="imx-ms is-empty${errSlots.has(slot) ? ' is-err' : ''}" title="${name}: empty"></span>`;
    filled++;
    const wh = imqDims(url);
    const size = wh ? imqSize(wh[0], wh[1]) : '';
    if (size && size !== 'g') below++;
    return `<span class="imx-ms${errSlots.has(slot) ? ' is-err' : ''}" data-view="${sku}" data-slot="${slot}" title="${name}${wh ? ` · ${wh[0]} × ${wh[1]}` : ''}${errSlots.has(slot) ? ' · Amazon picture error' : ''}">`
      + `<img src="${imEsc(imThumb(url))}" alt="" loading="lazy" decoding="async"><i class="imq-dot${size ? ' is-' + size : ''}" data-imq="${imEsc(imqId(url))}"${wh ? '' : ` data-imq-url="${imEsc(url)}"`}></i></span>`;
  }).join('');
  const chips = [`<span class="imx-c">${filled}/9</span>`];
  if (below) chips.push(`<span class="imx-c is-att">${below} below 2000</span>`);
  if (imNoMain(item)) chips.push('<span class="imx-c is-bad">No main</span>');
  else if (imNoOwnMain(item)) chips.push('<span class="imx-c is-att" title="Your listing sent no main picture; shoppers see the family\'s">Family\'s main</span>');
  if (errs.length) chips.push(`<span class="imx-c is-bad" title="${imEsc(errs.map(e => (e.c ? e.c + ': ' : '') + e.m).join(' · '))}">picture error</span>`);
  const hijack = imHijack(item);
  if (hijack) chips.push(`<span class="imx-c is-att" title="Amazon serves ${imEsc(hijack.sku)}'s main picture on this ASIN">shows ${imEsc(hijack.sku)}'s</span>`);
  const sel = IM_SEL.has(item.sku);
  const pv = sel ? imCardPreview(item) : null;
  if (pv) chips.push(`<span class="imx-c imx-pv ${pv.cls}"${pv.tip ? ` title="${imEsc(pv.tip)}"` : ''}>${imEsc(pv.t)}</span>`);
  const copied = !!IM_CLIP && IM_CLIP.sku === item.sku && IM_CLIP.brand === $('imBrand').value;
  const open = IM && IM.sku === item.sku && $('imEditWrap') && !$('imEditWrap').classList.contains('hide');
  const bf = main ? imBfOf((item.live || {}).MAIN, (item.img || {}).MAIN) : null;
  return `<div class="imx-card${sel ? ' is-sel' : ''}${copied ? ' is-copied' : ''}${open ? ' is-open' : ''}" data-sku="${sku}" tabindex="0" aria-label="${sku}: open to edit">
    <div class="imx-pic">${main ? `<img src="${imEsc(imThumbXL(main))}" alt="Main picture of ${sku}" loading="lazy" decoding="async">`
      : `<div class="imx-nomain"><b>No main picture</b><span>${imNoMain(item) ? 'none sent, none shown to shoppers' : ''}</span></div>`}
      <label class="imx-tick" title="Tick to paste into it (Shift+click ticks a range)"><input type="checkbox" class="im-sel" data-sku="${sku}"${sel ? ' checked' : ''} aria-label="Tick ${sku}"></label>
      <span class="imx-pill ${pill[1]}"${st.k === 'sup' ? ' title="Buyable from a direct link, taken out of search results"' : ''}>${pill[0]}</span>
      ${bf && bf.differs ? `<span class="im-bf is-diff imx-bf" title="${imEsc(IM_BF_TIP[bf.b + bf.f] || '')} · B = the picture we sent, F = what shoppers see">B${imBfDot(bf.b)}F${imBfDot(bf.f)}</span>` : ''}
      ${copied ? '<span class="imx-copied">COPIED ✓</span>' : ''}
      <div class="imx-acts"><button type="button" data-copy="${sku}" title="Copy all its pictures (and the swatch)">Copy all</button>`
      + `${IM_CLIP && !copied ? `<button type="button" data-paste1="${sku}" title="Paste the clipboard into this listing only (a preview first)">Paste all here</button>` : ''}`
      + `<button type="button" data-edit="${sku}" title="Open the editor (E)">Edit</button></div>
    </div>
    <div class="imx-strip">${strip}</div>
    <div class="imx-meta"><b class="im-mono">${sku}</b><span>${imEsc(imCardSub(item))}</span></div>
    <div class="imx-chips">${chips.join('')}</div>
  </div>`;
}
// Draw one card again where it is (a tick changed: its preview chip follows).
function imCardRedraw(sku) {
  const list = $('imList');
  const card = list && list.querySelector ? list.querySelector(`.imx-card[data-sku="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(sku) : sku}"]`) : null;
  const item = imItem(sku);
  if (!card || !item || !card.replaceWith || typeof document === 'undefined' || !document.createElement) return;
  const box = document.createElement('div');
  box.innerHTML = imCardHtml(item);
  if (box.firstElementChild) card.replaceWith(box.firstElementChild);
}

/* ---------- the cards in groups ---------- */
const imNum = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true });
/** The cards in their groups: [{ key, title, items }]. Colour: one group per colour ("Goldenrod Yellow · 6 sizes"), no colour last; Family:
 *  one per family; None: one group, no heading. */
function imSections(fams, items) {
  const bySize = (a, b) => imNum(a.z, b.z) || imNum(a.sku, b.sku);
  if (IM_GROUP === 'none') return [{ key: 'all', title: '', items: items.slice().sort((a, b) => imNum(a.c, b.c) || bySize(a, b)) }];
  if (IM_GROUP === 'family') {
    const famOf = new Map();
    fams.forEach(fam => fam.kids.forEach(kid => famOf.set(kid.sku, fam)));
    return fams.map(fam => ({ key: 'f:' + fam.key, title: `${imFamName(fam.group)} · ${fam.kids.length} listing${fam.kids.length === 1 ? '' : 's'}`,
      items: items.filter(item => famOf.get(item.sku) === fam).sort((a, b) => imNum(a.c, b.c) || bySize(a, b)) })).filter(sec => sec.items.length);
  }
  const by = new Map();
  items.forEach(item => {
    const key = String(item.c || '').trim().toLowerCase();
    if (!by.has(key)) by.set(key, { key: 'c:' + key, name: String(item.c || '').trim() || 'No colour', none: !key, items: [] });
    by.get(key).items.push(item);
  });
  return [...by.values()].sort((a, b) => (a.none - b.none) || a.name.localeCompare(b.name))
    .map(sec => ({ key: sec.key, title: `${sec.name} · ${sec.items.length} ${sec.items.length === 1 ? 'listing' : (IM_FAM ? 'sizes' : 'listings')}`, items: sec.items.sort(bySize) }));
}
const imCardEst = n => Math.ceil(n / 4) * 330;      // a block's height before it is drawn (then measured)
/* A group's cards in blocks of IM_CHUNK: a block is an empty box of the right height until it comes near the screen (imChunkFill); a page
 * with no IntersectionObserver (a test page) gets every card at once. */
function imRowsHtml(key, items) {
  IM_ROWS.set(key, items);
  if (typeof IntersectionObserver === 'undefined') return `<div class="imx-grid">${items.map(imCardHtml).join('')}</div>`;
  let out = '';
  for (let i = 0; i * IM_CHUNK < items.length; i++) {
    const n = Math.min(IM_CHUNK, items.length - i * IM_CHUNK);
    out += `<div class="imx-grid im-chunk" data-chunk="${imEsc(key)}" data-i="${i}" style="min-height:${IM_CHUNK_H.get(key + '|' + i) || imCardEst(n)}px"></div>`;
  }
  return out;
}
function imChunkFill(box) {
  const key = box.dataset.chunk;
  const i = Number(box.dataset.i);
  box.innerHTML = (IM_ROWS.get(key) || []).slice(i * IM_CHUNK, (i + 1) * IM_CHUNK).map(imCardHtml).join('');
  box.style.minHeight = '';
  box.dataset.on = '1';
  imqWatch(box);
  IM_CHUNK_H.set(key + '|' + i, box.offsetHeight);
}
function imChunkEmpty(box) {
  const h = box.offsetHeight;
  IM_CHUNK_H.set(box.dataset.chunk + '|' + box.dataset.i, h);
  box.style.minHeight = h + 'px';
  box.innerHTML = '';
  box.dataset.on = '';
}
// Blocks within 1,500 px of the screen are drawn; the ones that move further away are emptied (their height stays).
function imChunksWatch(root) {
  if (!root || !root.querySelectorAll || typeof IntersectionObserver === 'undefined') return;
  if (!IM_CHUNK_OBS) {
    IM_CHUNK_OBS = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.on) imChunkFill(entry.target);
      else if (!entry.isIntersecting && entry.target.dataset.on) imChunkEmpty(entry.target);
    }), { rootMargin: '1500px 0px' });
  } else IM_CHUNK_OBS.disconnect();
  root.querySelectorAll('.im-chunk').forEach(box => IM_CHUNK_OBS.observe(box));
}
// The page's shape while it is read: grey cards.
function imSkeleton(text) {
  const card = '<div class="imx-card imx-skel-card" aria-hidden="true"><div class="imx-pic im-skel"></div><div class="imx-strip">'
    + '<span class="imx-ms im-skel"></span>'.repeat(9) + '</div><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div>';
  return `<div class="imx-head"><div class="imx-title"><h2>Image Manager</h2><span class="muted" role="status">${imEsc(text)}</span></div></div><div class="imx-grid">${card.repeat(8)}</div>`;
}
/** Group the cards by 'colour' | 'family' | 'none' (remembered in this browser). */
function imGroupSet(k, keep) {
  IM_GROUP = k === 'family' || k === 'none' ? k : 'colour';
  if (keep) return;
  try { localStorage.setItem(IM_GROUP_KEY, IM_GROUP); } catch (e) { /* this visit only */ }
  IM_CHUNK_H.clear();
  imListRender();
}

/* ---------- ticking cards: Shift+click ticks a range ---------- */
let IM_LAST_SEL = '';       // the SKU ticked last (the start of a Shift+click range)
/** Shift+click: every SKU from the one ticked last to this one, in the order on screen (just this one when the last is not on screen). */
function imRangeSel(order, last, cur) {
  const i = order.indexOf(last);
  const j = order.indexOf(cur);
  if (i < 0 || j < 0) return [cur];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}
// The ticks changed: those cards (their preview chip), the clipboard bar's button and the Select all button follow — nothing else moves.
function imSelUpdate(skus) {
  (skus || []).forEach(imCardRedraw);
  imClipRefresh();
  const all = document.querySelector ? $('imList').querySelector('[data-im-selall]') : null;
  if (all) all.textContent = IM_SHOWN.length && IM_SHOWN.every(sku => IM_SEL.has(sku)) ? 'Untick all' : 'Select all';
}

/* ---------- the picture viewer (lightbox) ---------- */
let IM_VW = null;           // { sku, slot, both } while the viewer is open; both = ours and what shoppers see side by side
const imItem = sku => ((IML[$('imBrand').value] || { items: [] }).items || []).find(item => item.sku === sku) || null;
/** The slots of a listing that hold a picture (ours or live), in order MAIN … PT08, swatch — what ← → walk through. */
const imViewSlots = item => [...IM_SLOTS, 'SWCH'].filter(slot => (item.img || {})[slot] || (item.live || {})[slot]);
function imViewOpen(sku, slot) {
  const item = imItem(sku);
  if (!item) return;
  const slots = imViewSlots(item);
  IM_VW = { sku, slot: slots.includes(slot) ? slot : slots[0] || 'MAIN', both: false };
  imViewDraw();
}
function imViewMove(step) {
  const item = IM_VW && imItem(IM_VW.sku);
  if (!item) return;
  const slots = imViewSlots(item);
  if (!slots.length) return;
  const i = slots.indexOf(IM_VW.slot);
  IM_VW.slot = slots[((i < 0 ? 0 : i) + step + slots.length) % slots.length];
  imViewDraw();
}
function imViewClose() {
  IM_VW = null;
  const box = $('imViewer');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
}
// One picture in the viewer: big, its size (measured when it loads), file size when known, the picture rules.
function imViewFig(url, slot, stack, cap) {
  const wh = imqDims(url);
  const q = imqCheck({ slot, w: wh ? wh[0] : 0, h: wh ? wh[1] : 0, dup: imqDups(stack)[slot] });
  const bytes = (IM_QFILE[url] || {}).bytes;
  return `<figure class="im-vw-fig"><div class="im-vw-pic"><img src="${imEsc(url)}" data-vw-url="${imEsc(url)}" alt="${imEsc(cap || slot)}"></div>`
    + `<figcaption>${cap ? `<b>${imEsc(cap)}</b>` : ''}<span>${wh ? `${wh[0]} × ${wh[1]} px` : 'Size: measuring…'}${bytes ? ' · ' + imqMb(bytes) : ''}</span>`
    + `<span class="imq-chips">${imqChipsHtml(q.chips.filter(chip => !wh || chip.t !== `${wh[0]} × ${wh[1]}`))}</span></figcaption></figure>`;
}
function imViewHtml(item, slot, both) {
  const live = item.live || {};
  const img = item.img || {};
  const ours = img[slot] || '';
  const shop = live[slot] || '';
  const shown = IML_VIEW === 'live' ? (shop || ours) : (ours || shop);
  const differ = !!(ours && shop && ours !== shop);
  const slots = imViewSlots(item);
  const name = slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot;
  const bf = imBfOf(shop, ours);
  const body = both && differ
    ? imViewFig(ours, slot, img, 'Ours — the picture we sent (B)') + imViewFig(shop, slot, live, 'What shoppers see (F)')
    : imViewFig(shown, slot, shown === ours ? img : live, shown === ours ? 'Ours — the picture we sent' : 'What shoppers see');
  return `<div class="im-vw-box" role="dialog" aria-modal="true" aria-label="${imEsc(name + ' of ' + item.sku)}" tabindex="-1">
    <div class="im-vw-h"><b class="im-mono">${imEsc(item.sku)}</b><span class="muted">${imEsc([item.c, item.z].filter(Boolean).join(' · '))}</span>
      <span class="im-vw-slot">${imEsc(name)} <span class="muted">(${slots.indexOf(slot) + 1} of ${slots.length})</span></span>
      ${slot === 'SWCH' ? '' : `<span class="im-bf is-diff" title="${imEsc(IM_BF_TIP[bf.b + bf.f] || '')}">B${imBfDot(bf.b)}F${imBfDot(bf.f)}</span>`}
      <span style="flex:1"></span><button type="button" class="ghost im-b" data-vw="close" title="Close (Esc)">✕</button></div>
    <div class="im-vw-body${both && differ ? ' is-both' : ''}">
      <button type="button" class="im-vw-nav is-prev" data-vw="prev" title="Previous picture (←)" aria-label="Previous picture">‹</button>
      ${body}
      <button type="button" class="im-vw-nav is-next" data-vw="next" title="Next picture (→)" aria-label="Next picture">›</button></div>
    <div class="im-vw-foot">
      ${differ ? `<button type="button" class="ghost im-b" data-vw="both" aria-pressed="${!!both}">${both ? 'Show one picture' : 'Ours vs What shoppers see'}</button>` : '<span class="muted">Ours and what shoppers see are the same picture.</span>'}
      <span style="flex:1"></span>
      <button type="button" class="ghost im-b" data-vw="copy" title="Copy this picture to the clipboard (C)">Copy</button>
      <button type="button" class="ghost im-b" data-vw="repl" title="Choose a file: the editor opens and uploads it into ${imEsc(name)}">Replace in editor</button>
      <a class="ghost im-b" href="https://www.amazon.com/dp/${imEsc(item.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a></div>
  </div>`;
}
function imViewDraw() {
  const box = $('imViewer');
  const item = IM_VW && imItem(IM_VW.sku);
  if (!box || !item) return;
  box.innerHTML = imViewHtml(item, IM_VW.slot, IM_VW.both);
  box.hidden = false;
  // A size not known yet is read from the picture once it has loaded (kept per picture id, like the tiles').
  if (box.querySelectorAll) box.querySelectorAll('img[data-vw-url]').forEach(pic => {
    pic.onload = () => {
      const url = pic.dataset.vwUrl;
      if (!pic.naturalWidth || imqDims(url)) return;
      IMQ.dims.set(imqId(url), [pic.naturalWidth, pic.naturalHeight]);
      imqStoreSave();
      if (IM_VW) imViewDraw();
    };
  });
  const dialog = box.querySelector && box.querySelector('.im-vw-box');
  if (dialog && dialog.focus) dialog.focus({ preventScroll: true });
}
// The viewer's buttons.
function imViewAct(act) {
  const item = IM_VW && imItem(IM_VW.sku);
  if (!item) return;
  const slot = IM_VW.slot;
  if (act === 'close') return imViewClose();
  if (act === 'prev') return imViewMove(-1);
  if (act === 'next') return imViewMove(1);
  if (act === 'both') {
    IM_VW.both = !IM_VW.both;
    return imViewDraw();
  }
  if (act === 'copy') {
    const url = IML_VIEW === 'live' ? ((item.live || {})[slot] || (item.img || {})[slot]) : ((item.img || {})[slot] || (item.live || {})[slot]);
    imClipCopyOne({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, slot, url });
    imListRender();
    return imMsg('Copied ' + (slot === 'SWCH' ? 'the swatch' : slot) + ' of ' + item.sku + ' to the clipboard. Tick the cards to paste into.');
  }
  if (act === 'repl') {
    imViewClose();
    return imReplace(item.sku, slot);
  }
}

/* ---------- Edit / Replace ---------- */
// Open one listing in the editor panel and mark its row (the list does not move).
function imEditOpen(sku) {
  IM_SKU_CHOICES = null;
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll('#imList .im-kid.is-open').forEach(row => row.classList.remove('is-open'));
    document.querySelectorAll('#imList .im-kid').forEach(row => { if (row.dataset && row.dataset.sku === sku) row.classList.add('is-open'); });
  }
  return imLoad(sku);
}
/* REPLACE ONE PICTURE: the file chooser opens at once (a browser only opens it straight from a click), the editor opens beside the list
 * meanwhile; the chosen file is uploaded into that slot through imUpload — the same picture rules as any upload. */
let IM_REPL = null;         // { sku, slot, load } while the file chooser is open
function imReplace(sku, slot) {
  const input = $('imFile2');
  if (!input) return;
  IM_REPL = { sku, slot, load: imEditOpen(sku) };
  input.value = '';
  input.click();
}
async function imReplaceFile(file) {
  const job = IM_REPL;
  IM_REPL = null;
  if (!file || !job) return;
  await job.load;
  if (IM && IM.sku === job.sku) return imUpload(job.slot, file);
}

// The groups the list shows for this filter and search (and the listings picked in Listing Health, IM_ONLY): [{ parent, kids, psku, show }].
function imShownGroups(items, filter, search) {
  const groups = [];
  imListGroups(items).forEach(group => {
    const picked = kid => !IM_ONLY || IM_ONLY.skus.has(kid.sku);
    let show = group.kids.filter(kid => picked(kid) && imKidMatch(kid, filter, search));
    // A search that names the PARENT shows the whole family.
    if (!show.length && search && group.parent && imKidMatch(group.parent, 'all', search)) show = group.kids.filter(kid => picked(kid) && imKidMatch(kid, filter, ''));
    if (show.length) groups.push(Object.assign({}, group, { show }));
  });
  return groups;
}

// The clipboard bar's controls (imClipBar): a picture (left out / in again), the mode, Clear, Paste all into N selected.
function imClipWire(el) {
  if (!el || !el.querySelectorAll) return;
  if ($('imClipClear')) $('imClipClear').onclick = () => {
    imClipClear();
    imListRender();
  };
  if ($('imPasteSel')) $('imPasteSel').onclick = () => imPasteGo([...IM_SEL]);
  if ($('imClipMode')) $('imClipMode').onchange = () => {
    IM_PASTE_MODE = $('imClipMode').value === 'gaps' ? 'gaps' : 'replace';
    imListRender();               // the ticked cards' "will change" chips follow
  };
  el.querySelectorAll('[data-clip-slot]').forEach(btn => btn.onclick = () => {
    const slot = btn.dataset.clipSlot;
    const on = slot === 'SWCH' ? !!(IM_CLIP.tick && IM_CLIP.tick.SWCH) : !IM_CLIP.tick || IM_CLIP.tick[slot] !== false;
    IM_CLIP.tick = Object.assign({}, IM_CLIP.tick || {}, { [slot]: !on });
    imClipSave();
    imListRender();
  });
}
// Draw the clipboard bar again on its own (the ticks changed).
function imClipRefresh() {
  const old = $('imClipBar');
  if (!old || !old.parentNode || typeof document === 'undefined' || !document.createElement) return;
  const box = document.createElement('div');
  box.innerHTML = imClipBar();
  if (box.firstElementChild) {
    old.replaceWith(box.firstElementChild);
    imClipWire($('imClipBar'));
  }
}

/* Draw the page: the sidebar (Show, families), then the main area — the family's title and buttons, the filter chips, the cards in their
 * groups (drawn in blocks as they come near), the clipboard bar. */
function imListRender() {
  const el = $('imList');
  if (!el) return;
  const brand = $('imBrand').value;
  const data = IML[brand];
  IML_VIEW = ($('imView') || {}).value || 'mine';
  if (!data) {
    imSideRender([], [], '');
    el.innerHTML = IML_BUSY || IML_LOADING ? imSkeleton(IML_BUSY ? 'Reading every listing from Amazon for the first time — about two minutes.' : 'Reading the saved pictures…')
      : `<div class="card im-empty"><b>No pictures saved for this brand yet.</b><span>Press <b>Refresh</b> (in the sidebar) to read every listing (about two minutes).</span></div>`;
    return;
  }
  // --- which families and listings ---
  const filter = $('imFilter').value || 'all';
  const search = ($('imQ').value || '').trim().toLowerCase();
  imOwnerBuild(data.items);
  imqSeed(brand);
  const fams = imFamilies(data.items, search);
  if (IM_FAM && !fams.some(fam => fam.key === IM_FAM)) IM_FAM = '';      // the family has no listing left on this view: every family
  imSideRender(data.items, fams, search);
  const shownFams = IM_FAM ? fams.filter(fam => fam.key === IM_FAM) : fams;
  const kids = [].concat(...shownFams.map(fam => fam.kids));
  const cards = kids.filter(kid => imKidMatch(kid, filter, ''));
  const sections = imSections(shownFams, cards);
  IM_SHOWN = [].concat(...sections.map(sec => sec.items.map(item => item.sku)));
  IM_ROWS.clear();
  // --- the page ---
  const only = IM_ONLY ? `<div class="imx-only"><span>Showing the <b>${IM_ONLY.skus.size}</b> listing(s) picked in ${IM_ONLY.label ? imEsc(IM_ONLY.label) : 'Listing Health'}.</span>`
    + '<button type="button" class="ghost imx-btn" id="imOnlyOff">Show every listing</button></div>' : '';
  const filterName = (IM_CHIPS.find(([k]) => k === filter) || [])[1] || (IM_CARDS.find(card => card.k === filter) || {}).t || filter;
  const empty = !cards.length ? `<div class="card im-empty"><b>No listings match${filter !== 'all' ? ` “${imEsc(filterName)}”` : ''}${search ? ` the search “${imEsc(search)}”` : ''}${IM_SHOW !== 'all' ? ` in “${imEsc(IM_SHOWS.find(s => s.k === IM_SHOW).t)}”` : ''}.</b>`
    + `<span>${filter !== 'all' || search || IM_SHOW !== 'all' ? '<button type="button" class="ghost imx-btn" id="imClearFilter">Show everything</button>' : ''}</span></div>` : '';
  el.innerHTML = only + imHeadHtml(shownFams, kids) + imChipsHtml(kids, filter) + empty
    + sections.map(sec => `<section class="imx-sec">${sec.title ? `<h3 class="imx-sec-h">${imEsc(sec.title)}</h3>` : ''}${imRowsHtml(sec.key, sec.items)}</section>`).join('')
    + imClipBar();
  imClipWire(el);
  if ($('imOnlyOff')) $('imOnlyOff').onclick = () => {
    imOnly(null);
    imListRender();
  };
  // --- tiles whose size is not known yet are measured when they come on screen (image-quality.js); cards drawn as they come near ---
  imqWatch(el);
  imChunksWatch(el);
}
/** Copy all of one listing (a card's button, C over a card): every picture and the swatch go to the clipboard; the card says COPIED. */
function imCopyAll(sku, shop) {
  const item = imItem(sku);
  if (!item) return;
  imClipTake({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, own: item.img || {}, live: item.live || {}, prefer: shop ? 'live' : '' });
  if (IM_CLIP.slots.SWCH) {
    IM_CLIP.tick = Object.assign({}, IM_CLIP.tick, { SWCH: true });    // "Copy all" = the 9 pictures and the swatch
    imClipSave();
  }
  imListRender();
  imMsg(`Copied ${IM_CLIP.n} picture(s)${IM_CLIP.slots.SWCH ? ' and the swatch' : ''} from ${IM_CLIP.sku}. Tick the cards to paste into.`);
}

/* ============================================================================================
 * 7. EDITOR: THE STACK — load one listing, draw it, reorder and replace slots
 */

// Open one listing in the editor: by the SKU picked from the choices, by ASIN, or by the SKU typed; then draw and load its history.
async function imLoad(skuPick) {
  const typed = ($('imQ').value || '').trim();
  if (!typed && !skuPick) {
    imMsg('Type a SKU or an ASIN.', true);
    return;
  }
  const isAsin = /^B0[A-Z0-9]{8}$/i.test(typed) && !skuPick;
  imShowEditor(true);
  $('imGo').disabled = true;
  imMsg('Reading the listing from Amazon…');
  try {
    const params = { limg: 'get', brand: $('imBrand').value };
    if (skuPick) params.sku = skuPick;
    else if (isAsin) params.asin = typed.toUpperCase();
    else params.sku = typed;
    const reply = await baCall(params);
    IM = reply;
    if (skuPick && IM_SKU_CHOICES) IM.skuChoices = IM_SKU_CHOICES;
    IM_SKU_CHOICES = reply.skuChoices || IM_SKU_CHOICES;
    // --- the stack as it stands: the listing's own picture, else the catalogue's ---
    IM_START = {};
    [...IM_SLOTS, 'SWCH'].forEach(slot => {
      IM_START[slot] = (reply.listing && reply.listing[slot]) || (reply.catalog && reply.catalog[slot] && reply.catalog[slot].link) || '';
    });
    IM_NOW = Object.assign({}, IM_START);
    IM_RESULT = '';
    imRender();
    imMsg('');
    imHistory();
    imClipRefresh();         // the quick picks' "This listing" names the listing now open
  } catch (e) {
    IM = null;
    $('imBody').innerHTML = '';
    imMsg(String(e.message || e), true);
  }
  $('imGo').disabled = false;
}

/** Slots whose address differs from where the stack started. '' = removed. */
function imChanges() {
  const set = {};
  [...IM_SLOTS, 'SWCH'].forEach(slot => {
    if ((IM_NOW[slot] || '') !== (IM_START[slot] || '')) set[slot] = IM_NOW[slot] || '';
  });
  return set;
}

// Measure a picture once in the browser (IM_DIMS), then redraw so the size and "no zoom" show.
function imMeasure(url) {
  if (!url || IM_DIMS[url]) return;
  IM_DIMS[url] = { w: 0, h: 0 };
  const img = new Image();
  img.onload = () => {
    IM_DIMS[url] = { w: img.naturalWidth, h: img.naturalHeight };
    imRender();
  };
  img.src = url;
}

// One slot's tile in the edit drawer: the picture (or "drop file"), its name, a size chip, B / F, and — in your stack — the ⋯ menu
// (view big, replace with a file, an image address, remove, move left / right, undo). The rules' warnings show under it.
function imCard(slot, url, opts) {
  const opt = opts || {};
  const changed = opt.edit && (IM_NOW[slot] || '') !== (IM_START[slot] || '');
  const dW = opt.w || (IM_DIMS[url] && IM_DIMS[url].w) || 0;
  const dH = opt.h || (IM_DIMS[url] && IM_DIMS[url].h) || 0;
  const label = slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot.slice(2);
  const size = slot !== 'SWCH' && dW ? imqSize(dW, dH) : '';
  const sizeChip = !url ? '' : dW ? `<span class="imx-sz${size ? ' is-' + size : ''}" title="${dW} × ${dH}${size ? ' — ' + imEsc(IMQ_WORDS[size]) : ''}">${dW}×${dH}</span>` : '<span class="imx-sz">size…</span>';
  const bf = slot !== 'SWCH' && opt.edit && url ? imBfOf(opt.live, opt.sent) : null;
  const tag = bf && bf.differs ? `<span class="im-bf is-diff imx-bf" title="${imEsc(IM_BF_TIP[bf.b + bf.f] || '')} · B = the picture we sent, F = what shoppers see">B${imBfDot(bf.b)}F${imBfDot(bf.f)}</span>` : '';
  const item = (on, act, text) => (on ? `<button type="button" class="im-b" data-act="${act}" data-slot="${slot}">${text}</button>` : '');
  const menu = opt.edit ? `<details class="imx-menu"><summary aria-label="More for ${label}" title="More">⋯</summary><div class="imx-menu-pop">`
    + item(!!url, 'view', 'View big') + item(true, 'file', url ? 'Replace with a file…' : 'Upload a file…') + item(true, 'url', 'Use an image address…')
    + item(!!url && slot !== 'MAIN', 'del', 'Remove') + item(slot !== 'SWCH' && slot !== 'MAIN', 'left', '◀ Move left') + item(slot !== 'SWCH' && slot !== 'PT08', 'right', 'Move right ▶')
    + item(changed, 'undo', '↺ Back to how it was') + '</div></details>' : '';
  const pic = url ? `<img src="${imEsc(url)}" alt="${label}" loading="lazy" draggable="false">` : `<span class="imx-drop-t">${opt.edit ? 'drop file' : 'empty'}</span>`;
  return `<div class="im-card imx-slot${changed ? ' im-chg' : ''}${url ? '' : ' is-empty'}${slot === 'SWCH' ? ' is-sw' : ''}" data-slot="${slot}" ${opt.edit && slot !== 'SWCH' ? 'draggable="true"' : ''}>
      <div class="imx-slot-h"><b>${label}</b>${changed ? '<span class="imx-chg">changed</span>' : ''}<span style="flex:1"></span>${menu}</div>
      <div class="im-pic">${url ? `<a href="${imEsc(url)}" target="_blank" rel="noopener" draggable="false">${pic}</a>` : pic}${tag}</div>
      <div class="imx-slot-f">${sizeChip}</div>
      ${url ? imCardChips(slot, url, dW, dH, opt.dup) : ''}
    </div>`;
}

// The picture rules (image-quality.js) under one card: size words, shape, the same picture twice, and for a file uploaded here its
// white border and fill. The size line above already gives "2400×2400" and "no zoom", so the size chip keeps only "below 2000 — company minimum".
function imCardChips(slot, url, w, h, dup) {
  const q = imqCheck(Object.assign({ slot, w, h, dup }, IM_QFILE[url] ? { white: IM_QFILE[url].white, fill: IM_QFILE[url].fill } : {}));
  const sized = `${w} × ${h}`;
  const chips = q.chips.filter(chip => !chip.t.startsWith(sized) || q.size === 'y')
    .map(chip => (chip.t.startsWith(sized) ? Object.assign({}, chip, { t: IMQ_WORDS.y }) : chip));
  return chips.length ? `<div class="imq-chips">${imqChipsHtml(chips)}</div>` : '';
}

let IM_EDV = 'ours';    // the drawer shows 'ours' (your stack, editable) or 'shop' (what shoppers see, Amazon's catalogue)
/** "N changes ready": per changed slot where its new picture came from — [{ slot, url, from }] ("RTC14-1", "moved from 03", "a file"). */
function imChangeLines() {
  const set = imChanges();
  const name = slot => (slot === 'SWCH' ? 'swatch' : slot === 'MAIN' ? 'Main' : slot.slice(2));
  return Object.keys(set).map(slot => {
    const url = set[slot];
    let from = 'a new picture';
    const clipSlot = IM_CLIP && url ? Object.keys(IM_CLIP.slots).find(s => IM_CLIP.slots[s] === url) : '';
    const moved = url ? [...IM_SLOTS, 'SWCH'].find(s => s !== slot && IM_START[s] === url) : '';
    if (!url) from = 'emptied';
    else if (moved) from = 'moved from ' + name(moved);
    else if (clipSlot) from = (IM_CLIP.from && IM_CLIP.from[clipSlot]) || IM_CLIP.sku;
    else if (IM_QFILE[url]) from = 'an uploaded file';
    return { slot, url, from };
  });
}
// Draw the edit drawer for the open listing: header and buttons, Amazon's picture issues, the 10 slots, the drop zone, the changes ready,
// and the footer (Discard · History · Check with Amazon).
function imRender() {
  const listing = IM;
  if (!listing) return;
  [...IM_SLOTS, 'SWCH'].forEach(slot => {
    if (IM_NOW[slot]) imMeasure(IM_NOW[slot]);
  });
  const cat = listing.catalog || {};
  const liveOf = slot => (cat[slot] && cat[slot].link) || '';
  const ours = IM_EDV !== 'shop';
  const dup = ours ? imqDups(IM_NOW) : imqDups(Object.fromEntries([...IM_SLOTS, 'SWCH'].map(slot => [slot, liveOf(slot)])));
  const tiles = [...IM_SLOTS, 'SWCH'].map(slot => (ours ? imCard(slot, IM_NOW[slot], { edit: true, dup: dup[slot], live: liveOf(slot), sent: (listing.listing || {})[slot] })
    : imCard(slot, liveOf(slot), Object.assign({ dup: dup[slot] }, cat[slot] || {})))).join('');
  const lines = imChangeLines();
  const n = lines.length;
  const choices = (listing.skuChoices && listing.skuChoices.length > 1)
    ? `<select id="imSku" aria-label="Which SKU">${listing.skuChoices.map(choice =>
        `<option value="${imEsc(choice.sku)}"${choice.sku === listing.sku ? ' selected' : ''}>${imEsc(choice.sku)}${choice.status ? ' · ' + imEsc(choice.status) : ''}</option>`).join('')}</select>`
    : `<b class="im-mono">${imEsc(listing.sku)}</b>`;
  const picIssues = (listing.issues || []).filter(imIsPicIssue);       // picture problems only; the rest is Listing Errors' work
  const issues = picIssues.length ? `<div class="imx-box is-bad"><b>Amazon's open picture issues</b>${picIssues.map(issue => `<div><span class="st ${issue.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${
    imEsc(issue.severity)}</span> ${imEsc(issue.message)}</div>`).join('')}</div>` : '';
  const onlyCatalog = [...IM_SLOTS, 'SWCH'].filter(slot => !(listing.listing || {})[slot] && cat[slot]);
  /* The catalogue sometimes serves a sibling's whole stack on a listing of its own, most often one with no offer. IM_OWNER names it. */
  const liveMain = liveOf('MAIN');
  const mineMain = (listing.listing || {}).MAIN;
  const hjOwn = liveMain && mineMain && liveMain !== mineMain ? IM_OWNER.get(liveMain) : null;
  const hjThis = hjOwn && hjOwn.sku !== listing.sku ? hjOwn : null;
  const thumb = IM_NOW.MAIN || liveMain;
  const canPaste = IM_CLIP && IM_CLIP.sku !== listing.sku;
  // a ⋯ menu open while the drawer is drawn again (a picture's size landed) stays open
  const openMenu = typeof document !== 'undefined' && document.querySelector ? document.querySelector('#imMine .imx-menu[open]') : null;
  const openSlot = openMenu && openMenu.closest ? (openMenu.closest('.imx-slot') || { dataset: {} }).dataset.slot : '';
  $('imBody').innerHTML = `
    <div class="imx-dr-head">
      <span class="imx-dr-pic">${thumb ? `<img src="${imEsc(imThumbL(thumb))}" alt="">` : ''}</span>
      <div class="imx-dr-t"><div>${choices}<span class="muted">${imEsc([listing.color, listing.size].filter(Boolean).join(' · '))}</span></div>
        <div class="muted">ASIN <b>${imEsc(listing.asin)}</b>${listing.parent ? ' · parent ' + imEsc(listing.parent) : ''} · ${imEsc((listing.status || []).join(', ') || listing.productType || '')}
          · <a href="https://www.amazon.com/dp/${imEsc(listing.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a></div>
        <div class="imx-dr-name" title="${imEsc(listing.title)}">${imEsc(listing.title)}</div></div>
    </div>
    <div class="imx-dr-btns">
      <button type="button" class="ghost imx-btn" id="imCopy" title="Copy all its pictures (and the swatch) to paste into other listings">Copy all</button>
      ${canPaste ? `<button type="button" class="ghost imx-btn" id="imPaste" title="Put the clipboard's pictures in every slot it holds">Paste all (${imEsc(IM_CLIP.sku)})</button>
      <button type="button" class="ghost imx-btn" id="imPasteGaps" title="Only fill the slots that are empty">Fill empty only</button>` : ''}
      <span style="flex:1"></span>
      <span class="imx-seg" role="group" aria-label="Which pictures"><button type="button" data-edv="ours" class="${ours ? 'is-on' : ''}" aria-pressed="${ours}">Ours</button><button type="button" data-edv="shop" class="${ours ? '' : 'is-on'}" aria-pressed="${!ours}" title="What shoppers see: Amazon's catalogue">Shoppers see</button></span>
    </div>
    ${issues}
    ${hjThis ? `<div class="imx-box is-att">Amazon is serving <b>${imEsc(hjThis.sku)}</b>${hjThis.c ? ' (' + imEsc(hjThis.c) + ')' : ''} pictures on this ASIN — your own stack is the right one.</div>` : ''}
    ${ours ? imRulesHtml() : `<div class="imx-note">What shoppers see now (read only). ${listing.catalogError ? imEsc(listing.catalogError) : ''}</div>`}
    <div class="imx-slots" id="imMine">${tiles}</div>
    ${ours ? `<div class="imx-dropzone" id="imDrop"><b>Drop pictures here</b><span>several fill the empty slots in order — one on a slot replaces it</span>
      <button type="button" class="ghost imx-btn" id="imDropPick">or choose files</button></div>` : ''}
    ${ours && onlyCatalog.length ? `<div class="imx-note">${onlyCatalog.join(', ')} come from the catalogue, not from your listing. Emptying one of those here may not remove it from Amazon if another contributor supplied it.</div>` : ''}
    <div class="imx-ready"><b>${n ? `${n} change${n === 1 ? '' : 's'} ready` : 'No changes yet'}</b>${n ? `<ul>${lines.map(line => `<li><b>${line.slot === 'SWCH' ? 'Swatch' : line.slot}</b> ← ${imEsc(line.from)}</li>`).join('')}</ul>` : '<span class="muted">Drag, drop, paste or use ⋯ on a slot. Nothing reaches Amazon until you check and approve it.</span>'}</div>
    <div id="imResult">${IM_RESULT}</div>
    <div class="imx-dr-foot">
      <button type="button" id="imReset" class="ghost imx-btn" ${n ? '' : 'disabled'}>Discard</button>
      <button type="button" class="ghost imx-btn" id="imHistLink" title="Every change sent for ${imEsc(listing.sku)}, from every screen: when, who, old → new, Amazon's answer">History</button>
      <span style="flex:1"></span>
      <button type="button" id="imApply" class="imx-btn imx-go" ${n ? '' : 'disabled'}>Check with Amazon${n ? ` (${n} change${n === 1 ? '' : 's'})` : ''}</button>
    </div>
    <input type="file" id="imFile" accept="image/jpeg,image/png,image/tiff,image/gif" class="hide">
    <input type="file" id="imFiles" accept="image/jpeg,image/png,image/tiff,image/gif" multiple class="hide">`;
  if (openSlot) {
    const again = document.querySelector(`#imMine .imx-slot[data-slot="${openSlot}"] .imx-menu`);
    if (again) again.open = true;
  }
  imWire();
}

// Swap the pictures of two slots in the editable stack and redraw.
function imSwap(a, b) {
  const tmp = IM_NOW[a];
  IM_NOW[a] = IM_NOW[b];
  IM_NOW[b] = tmp;
  imRender();
}

// Wire the drawer imRender just drew: the SKU picker, the ⋯ menus, drag and drop, the drop zone, Copy / Paste, Ours ⇄ Shoppers see,
// Discard / History / Check with Amazon.
function imWire() {
  const sel = $('imSku');
  if (sel) sel.onchange = () => imLoad(sel.value);
  // --- the ⋯ menu of each slot ---
  document.querySelectorAll('#imMine .im-b').forEach(btn => btn.onclick = () => {
    const slot = btn.dataset.slot;
    const idx = IM_SLOTS.indexOf(slot);
    const menu = btn.closest && btn.closest('details');
    if (menu) menu.open = false;
    if (btn.dataset.act === 'left') imSwap(slot, IM_SLOTS[idx - 1]);
    else if (btn.dataset.act === 'right') imSwap(slot, IM_SLOTS[idx + 1]);
    else if (btn.dataset.act === 'view') {
      if (IM_NOW[slot] && typeof window !== 'undefined' && window.open) window.open(IM_NOW[slot], '_blank', 'noopener');
    } else if (btn.dataset.act === 'del') {
      IM_NOW[slot] = '';
      imRender();
    } else if (btn.dataset.act === 'undo') {
      IM_NOW[slot] = IM_START[slot];
      imRender();
    } else if (btn.dataset.act === 'url') {
      const url = prompt('Image address for ' + slot + ' (https://…, JPEG/PNG):', IM_NOW[slot] || '');
      if (url == null) return;
      if (url && !/^https:\/\//i.test(url.trim())) {
        alert('It must start with https://');
        return;
      }
      IM_NOW[slot] = url.trim();
      imRender();
    } else if (btn.dataset.act === 'file') {
      IM_FILE_SLOT = slot;
      $('imFile').value = '';
      $('imFile').click();
    }
  });
  if ($('imFile')) $('imFile').onchange = () => {
    const file = $('imFile').files[0];
    if (file) imUpload(IM_FILE_SLOT, file);
  };
  // --- drag a tile to reorder, or drop a file on it ---
  document.querySelectorAll('#imMine .im-card[draggable]').forEach(card => {
    card.ondragstart = e => {
      IM_DRAG = card.dataset.slot;
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragover = e => {
      e.preventDefault();
      card.classList.add('im-over');
    };
    card.ondragleave = () => card.classList.remove('im-over');
    card.ondrop = e => {
      e.preventDefault();
      card.classList.remove('im-over');
      // A dropped FILE goes into this slot (SEVERAL files: the empty slots in order); a dragged tile moves here and the rest shift along.
      const files = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
      if (files.length > 1) {
        imUploadMany(files);
        return;
      }
      const file = files[0];
      if (file) {
        imUpload(card.dataset.slot, file);
        return;
      }
      const from = IM_SLOTS.indexOf(IM_DRAG);
      const to = IM_SLOTS.indexOf(card.dataset.slot);
      if (from < 0 || to < 0 || from === to) return;
      const list = IM_SLOTS.map(slot => IM_NOW[slot]);
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      IM_SLOTS.forEach((slot, k) => IM_NOW[slot] = list[k]);
      imRender();
    };
  });
  const sw = document.querySelector('#imMine .im-card[data-slot="SWCH"]');
  if (sw) {
    sw.ondragover = e => e.preventDefault();
    sw.ondrop = e => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) imUpload('SWCH', file);
      else if (IM_DRAG) {                            // a stack picture used as the swatch
        IM_NOW.SWCH = IM_NOW[IM_DRAG];
        imRender();
      }
    };
  }
  // --- the big drop zone (and "or choose files"): files fill the empty slots in order, each through the picture rules ---
  const zone = $('imDrop');
  if (zone) {
    zone.ondragover = e => {
      e.preventDefault();
      zone.classList.add('is-over');
    };
    zone.ondragleave = () => zone.classList.remove('is-over');
    zone.ondrop = e => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
      if (files.length) imUploadMany(files);
    };
  }
  if ($('imDropPick')) $('imDropPick').onclick = () => {
    $('imFiles').value = '';
    $('imFiles').click();
  };
  if ($('imFiles')) $('imFiles').onchange = () => {
    const files = $('imFiles').files ? [...$('imFiles').files] : [];
    if (files.length) imUploadMany(files);
  };
  // --- Copy all / Paste all / Fill empty only ---
  if ($('imCopy')) $('imCopy').onclick = () => {
    const cat = (IM && IM.catalog) || {};
    const live = {};
    [...IM_SLOTS, 'SWCH'].forEach(slot => { if (cat[slot] && cat[slot].link) live[slot] = cat[slot].link; });
    imClipTake({ brand: IM.brand, sku: IM.sku, asin: IM.asin, c: IM.color, z: IM.size, psku: IM.parent || '', own: IM_NOW, live });
    if (IM_CLIP.slots.SWCH) IM_CLIP.tick = Object.assign({}, IM_CLIP.tick, { SWCH: true });
    imClipSave();
    imRender();
    imListRender();          // the cards behind the drawer: COPIED, the clipboard bar
    imMsg('Copied ' + IM_CLIP.n + ' picture(s) from ' + IM_CLIP.sku + '. Tick the cards to paste into, or open another listing and press Paste all.');
  };
  const paste = gapsOnly => {
    if (!IM_CLIP) return;
    let nFilled = 0;
    const ticked = imClipSlots(imClipWithSw());     // only the slots ticked in the clipboard bar
    Object.keys(ticked).forEach(slot => {
      const url = ticked[slot] || '';
      if (!url || (gapsOnly && IM_NOW[slot])) return;           // never empties a slot; "Fill empty only" leaves a filled one alone
      if (IM_NOW[slot] !== url) {
        IM_NOW[slot] = url;
        nFilled++;
      }
    });
    imRender();
    imMsg(nFilled ? nFilled + ' slot(s) filled from ' + IM_CLIP.sku + '. Check them, then press Check with Amazon.'
      : 'Nothing to change — this listing already holds those pictures.');
  };
  if ($('imPaste')) $('imPaste').onclick = () => paste(false);
  if ($('imPasteGaps')) $('imPasteGaps').onclick = () => paste(true);
  document.querySelectorAll('[data-edv]').forEach(btn => btn.onclick = () => {
    IM_EDV = btn.dataset.edv === 'shop' ? 'shop' : 'ours';
    imRender();
  });
  if ($('imHistLink')) $('imHistLink').onclick = () => imHistLink(IM.sku);
  // --- Discard / Check with Amazon (the Amazon check popup: Amazon checks, you approve, it is sent) ---
  if ($('imApply')) $('imApply').onclick = () => imSend(true);
  if ($('imReset')) $('imReset').onclick = () => {
    IM_NOW = Object.assign({}, IM_START);
    imRender();
  };
}

/* ============================================================================================
 * 8. EDITOR: SENDING — upload a picture, check / apply with Amazon, history
 */

// Upload a picture for one slot: read it as base64, send it to the backend (which puts it on Drive), and point the slot at it.
async function imUpload(slot, file) {
  if (!/^image\/(jpeg|png|tiff|gif)$/.test(file.type)) {
    imMsg('Amazon takes JPEG, PNG, TIFF or GIF.', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    imMsg('Amazon refuses images over 10 MB.', true);
    return;
  }
  // --- the picture rules (image-quality.js): read the file here first; refused = never uploaded ---
  const info = await imqReadFile(file, slot);
  const qual = imqCheck(Object.assign({ slot, upload: true }, info));
  if (qual.block) {
    imMsg(slot + ': ' + qual.block, true);
    return;
  }
  const warns = qual.chips.filter(chip => chip.lv !== 'ok').map(chip => chip.t);
  imMsg('Uploading ' + file.name + '…');
  try {
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.readAsDataURL(file);
    });
    const reply = await imPost({ limg: 'upload', name: (IM && IM.sku ? IM.sku + '_' + slot + '_' : '') + file.name, mime: file.type, b64 });
    if (!reply.ok) throw new Error(reply.error || 'Upload failed');
    // Measured from the local file: the Drive address can take a moment to serve.
    const local = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      IM_DIMS[reply.url] = { w: img.naturalWidth, h: img.naturalHeight };
      imRender();
    };
    img.src = local;
    IM_QFILE[reply.url] = info;          // the chips under this picture in the editor (white border, fill, file size)
    if (info.w) IM_DIMS[reply.url] = { w: info.w, h: info.h };
    IM_NOW[slot] = reply.url;
    imRender();
    imMsg('Uploaded into ' + slot + '. Not on Amazon yet — press Apply.' + (warns.length ? ' Check: ' + warns.join(' · ') + '.' : ''), warns.length > 0 && qual.level === 'bad');
  } catch (e) {
    imMsg(String(e.message || e), true);
  }
}

/** The empty slots of the stack (MAIN … PT08, not the swatch), in order: where dropped files go. */
const imDropSlots = (n, now) => IM_SLOTS.filter(slot => !(now || {})[slot]).slice(0, n);
/* SEVERAL FILES DROPPED: each goes into the next empty slot, one after another, through imUpload — the same picture rules as any upload
 * (a refused file leaves its slot empty for the next file). Files with no empty slot left are named, not uploaded. */
async function imUploadMany(files) {
  const list = [...(files || [])];
  let done = 0;
  for (let i = 0; i < list.length; i++) {
    const slot = imDropSlots(1, IM_NOW)[0];
    if (!slot) {
      imMsg(`No empty slot left: ${list.length - i} file(s) not uploaded (${list.slice(i).map(f => f.name).join(', ')}). Empty a slot or drop a file on the one to replace.`, true);
      return done;
    }
    await imUpload(slot, list[i]);
    if (IM_NOW[slot]) done++;
  }
  return done;
}
// The one-line picture rules over the stack; "more" opens the whole list (the rules image-quality.js checks).
function imRulesHtml() {
  return `<details class="im-rules"><summary><b>Picture rules:</b> Main pure white, product fills ~85%, at least 2000 × 2000, JPEG/PNG, 2–10 MB</summary>
    <ul><li>Size: 2000 × 2000 or more (company rule — smaller files are refused on upload). Under 1000 px on the long side Amazon cannot zoom.</li>
      <li>File: JPEG, PNG, TIFF or GIF; over 10 MB Amazon refuses it; under 2 MB is allowed but often soft — check it is sharp.</li>
      <li>Main: pure white background (255, 255, 255), the product fills about 85% of the picture, no text, logo or extra items (the Picture check asks a person).</li>
      <li>Shape: square, or close to it (width ÷ height 0.9–1.1). The same picture twice in one stack is a warning.</li>
      <li>Swatch: a small colour sample — the size and shape rules do not apply.</li></ul></details>`;
}

// Check (apply = false): ask Amazon about the changed slots and show its answer here. Apply (apply = true): THE ONE SEND PATH (#10,
// listing-send-check.js) — the Amazon check popup (the picture preview stays here): Amazon checks, the person approves, it is sent and
// the listing read again; the answer shows here after.
async function imSend(apply) {
  const set = imChanges();
  const nChanges = Object.keys(set).length;
  if (!nChanges) return;
  if (apply) {
    const im = IM;
    const start = Object.assign({}, IM_START);
    return sqSendWithCheck([{ brand: im.brand, sku: im.sku, asin: im.asin || '', label: im.title || im.sku, body: { limg: 'patch', brand: im.brand, sku: im.sku, productType: im.productType, set },
      changes: Object.keys(set).map(slot => ({ field: sqField(slot), old: start[slot] || '(none)', new: set[slot] || '(removed)', pic: true, attr: slot, oldV: start[slot] || '' })) }], {
      screen: 'Image Manager', title: 'Image Manager · ' + im.sku,
      onSent: () => { if (IM === im) IM_START = Object.assign({}, IM_NOW); IML_DIRTY = true; },   // what we sent is now the baseline
      onEdit: () => {},                                   // the picture stack is right here, as it was
      onDone: sum => {
        if (IM !== im) return;
        const text = sqSummaryText(sum);
        if (text) IM_RESULT = `<div style="margin-top:8px;font-size:12.5px" class="${/rejected|says no/i.test(text) && !/✅/.test(text) ? 'err' : ''}">${imEsc(text)}</div>`;
        imRender();
        imHistory();
      } });
  }
  const off = v => ['imCheck', 'imApply'].forEach(id => { if ($(id)) $(id).disabled = v; });
  off(true);
  if ($('imSendMsg')) $('imSendMsg').textContent = apply ? 'Sending to Amazon…' : 'Asking Amazon…';
  // --- send ---
  let reply;
  try {
    reply = await imPost({ limg: 'patch', brand: IM.brand, sku: IM.sku, productType: IM.productType, set, apply, by: ME.email });
  } catch (e) {
    reply = { ok: false, error: String(e.message || e) };
  }
  // --- show the answer ---
  const issuesHtml = (reply.issues || []).map(issue => `<div style="font-size:12px;margin:3px 0">`
    + `<span class="st ${issue.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${imEsc(issue.severity)}</span> ${imEsc(issue.message)}</div>`).join('');
  let head;
  if (!reply.ok) head = `<div class="err" style="font-size:12.5px">${imEsc(reply.error || 'Failed')}</div>`;
  else if (reply.previewOnly) head = `<div style="font-size:12.5px;color:var(--accent-ink)">Amazon has no objection. Press Apply to send it.</div>`;
  else head = `<div style="font-size:12.5px;color:var(--accent-ink)">Accepted by Amazon (submission ${imEsc(reply.submissionId || '')}). `
    + `It is queued, not live: the page usually changes within 15 minutes to a few hours. Reload this listing later to confirm.</div>`;
  IM_RESULT = `<div style="margin-top:8px">${head}${issuesHtml}</div>`;
  if ($('imResult')) $('imResult').innerHTML = IM_RESULT;
  if ($('imSendMsg')) $('imSendMsg').textContent = '';
  if (reply.ok && !reply.previewOnly) {
    IM_START = Object.assign({}, IM_NOW);     // what we sent is now the baseline
    IML_DIRTY = true;
    imRender();
    imHistory();
  } else off(false);
}

/** "See them in Listing History →": the Listing History page, every date, searched for this SKU. */
function imHistLink(sku) {
  if (typeof LH !== 'undefined' && LH && LH.f) {
    LH.f = Object.assign({}, LH.f, { range: 'all', q: sku });
    LH.page = 0;
    LH.built = false;        // its toolbar is drawn again with the search filled in
  }
  if (typeof showTab === 'function') showTab('lhist');
}
// The "Changes sent for this SKU" box: the last 20 sends from Sellora, from the backend's log.
async function imHistory() {
  const el = $('imHist');
  if (!el || !IM) return;
  try {
    const reply = await baCall({ limg: 'history', sku: IM.sku });
    const rows = reply.rows || [];
    el.innerHTML = rows.length ? rows.slice(0, 20).map(entry => `<div style="margin:2px 0">${imEsc(new Date(entry.at).toLocaleString())} · ${imEsc(entry.by || '?')} · ${
        imEsc(Object.entries(entry.set || {}).map(([slot, url]) => slot + (url ? ' replaced' : ' removed')).join(', '))} · <b>${imEsc(entry.status)}</b></div>`).join('')
      : 'None sent from Sellora yet.';
  } catch (e) {
    el.textContent = 'Could not read the log: ' + (e.message || e);
  }
}

/* ============================================================================================
 * 9. COPY & PASTE — the stack clipboard
 * One listing's pictures, held so they can be put on another. It survives a reload because the
 * usual job is "this one is right, now do the other eleven", and that is not one sitting.
 * Nothing is sent by copying or pasting: a paste fills the editor, and the usual Apply (preview
 * first, then the real send) is still what reaches Amazon. imPasteMany sends to ticked listings.
 */

// Keep the clipboard in localStorage so it outlives a reload.
function imClipSave() {
  try {
    if (IM_CLIP) localStorage.setItem('sellora.imgclip', JSON.stringify(IM_CLIP));
    else localStorage.removeItem('sellora.imgclip');
  } catch (e) { /* a private window: the clipboard just does not outlive the page */ }
}

/** Copy a stack. `own` first, because what WE submitted is the thing worth copying; the catalogue
 *  fills a slot we never sent, which is usually the family's picture and still better than nothing. */
// src: { brand, sku, asin, c, z, psku, own: { slot: url }, live: { slot: url }, prefer: 'live' = what shoppers see first }.
// Every slot copied is ticked (`tick`), and `from` names the listing each came from (one picture can be added from another: imClipCopyOne).
function imClipTake(src) {
  const slots = {};
  [...IM_SLOTS, 'SWCH'].forEach(slot => {
    const url = src.prefer === 'live' ? (src.live[slot] || src.own[slot] || '') : (src.own[slot] || src.live[slot] || '');
    if (url) slots[slot] = url;
  });
  IM_CLIP = { brand: src.brand, sku: src.sku, asin: src.asin || '', c: src.c || '', z: src.z || '', psku: src.psku || '', shop: src.prefer === 'live',
    slots, n: IM_SLOTS.filter(slot => slots[slot]).length, at: Date.now(),
    from: Object.fromEntries(Object.keys(slots).map(slot => [slot, src.sku])), tick: Object.fromEntries(Object.keys(slots).map(slot => [slot, slot !== 'SWCH'])) };
  imClipSave();
}
/** Copy ONE picture (a tile's "Copy"): it goes into the clipboard at its own slot, ticked. A clipboard of the same brand keeps its other
 *  slots (so a stack can be put together from several listings); another brand's is replaced. one: { brand, sku, asin, c, z, psku, slot, url }. */
function imClipCopyOne(one) {
  if (!one || !one.url || ![...IM_SLOTS, 'SWCH'].includes(one.slot)) return;
  if (!IM_CLIP || IM_CLIP.brand !== one.brand) {
    IM_CLIP = { brand: one.brand, sku: one.sku, asin: one.asin || '', c: one.c || '', z: one.z || '', psku: one.psku || '', slots: {}, from: {}, tick: {}, n: 0 };
  }
  IM_CLIP.slots = Object.assign({}, IM_CLIP.slots, { [one.slot]: one.url });
  IM_CLIP.from = Object.assign({}, IM_CLIP.from || {}, { [one.slot]: one.sku });
  IM_CLIP.tick = Object.assign({}, IM_CLIP.tick || {}, { [one.slot]: true });
  IM_CLIP.n = IM_SLOTS.filter(slot => IM_CLIP.slots[slot]).length;
  IM_CLIP.at = Date.now();
  imClipSave();
}
/** The slots a paste puts in: the copied ones that are ticked (a clipboard from before ticks existed: every slot), the swatch only with
 *  `withSw`. { slot: url }. */
function imClipSlots(withSw) {
  const out = {};
  if (!IM_CLIP) return out;
  IM_SLOTS.forEach(slot => {
    if (IM_CLIP.slots[slot] && (!IM_CLIP.tick || IM_CLIP.tick[slot] !== false)) out[slot] = IM_CLIP.slots[slot];
  });
  if (withSw && IM_CLIP.slots.SWCH) out.SWCH = IM_CLIP.slots.SWCH;
  return out;
}
// Paste into these listings from the list (a row's "Paste here", the clip bar's button): the preview first.
function imPasteGo(skus) {
  return imPastePreview(skus);
}

// Forget the copied stack.
function imClipClear() {
  IM_CLIP = null;
  imClipSave();
}

/** Does a paste put the swatch in too? (the swatch picture is ticked in the clipboard bar) */
const imClipWithSw = () => !!(IM_CLIP && IM_CLIP.slots.SWCH && IM_CLIP.tick && IM_CLIP.tick.SWCH);
/* THE CLIPBOARD BAR slides up at the bottom while something is copied: "Copied all 9 pictures from RTC14-1", the pictures (click one to
 * leave it out of the paste), the mode (Replace all / Only empty slots), Clear, and "Paste all into N selected →" (the preview first). */
function imClipBar() {
  if (!IM_CLIP) return '';
  const clip = IM_CLIP;
  const on = slot => (slot === 'SWCH' ? !!(clip.tick && clip.tick.SWCH) : !clip.tick || clip.tick[slot] !== false);
  const have = IM_SLOTS.filter(slot => clip.slots[slot]);
  const nOn = have.filter(on).length;
  const pics = [...IM_SLOTS, 'SWCH'].map(slot => {
    const url = clip.slots[slot];
    const name = slot === 'SWCH' ? 'SW' : slot === 'MAIN' ? 'M' : slot.slice(2);
    if (!url) return `<span class="imx-cp is-none" title="${name}: nothing copied">${name}</span>`;
    const from = clip.from && clip.from[slot] && clip.from[slot] !== clip.sku ? ' — from ' + clip.from[slot] : '';
    return `<button type="button" class="imx-cp${on(slot) ? '' : ' is-off'}${slot === 'SWCH' ? ' is-sw' : ''}" data-clip-slot="${slot}" aria-pressed="${on(slot)}" title="${imEsc((slot === 'SWCH' ? 'Swatch' : name) + from)} — ${on(slot) ? 'pasted; click to leave it out' : 'left out; click to paste it'}">`
      + `<img src="${imEsc(imThumb(url))}" alt="" loading="lazy"><i>${name}</i></button>`;
  }).join('');
  const n = IM_SEL.size;
  const what = nOn === have.length && have.length ? `all ${have.length} picture${have.length === 1 ? '' : 's'}` : `${nOn} of ${have.length} picture${have.length === 1 ? '' : 's'}`;
  return `<div class="imx-clip" id="imClipBar" role="region" aria-label="Clipboard">
    <div class="imx-clip-t"><b>Copied ${what}${on('SWCH') && clip.slots.SWCH ? ' + swatch' : ''} from <span class="im-mono">${imEsc(clip.sku)}</span></b>
      <span>${n ? `Tick more cards, or paste into the ${n} ticked.` : 'Tick the cards to paste into — each shows what will change.'} Nothing is sent before Amazon checks it.</span></div>
    <div class="imx-clip-pics">${pics}</div>
    <select id="imClipMode" aria-label="How to paste"><option value="replace"${IM_PASTE_MODE === 'gaps' ? '' : ' selected'}>Replace all</option><option value="gaps"${IM_PASTE_MODE === 'gaps' ? ' selected' : ''}>Only empty slots</option></select>
    <button type="button" class="ghost imx-btn" id="imClipClear">Clear</button>
    <button type="button" class="imx-btn imx-go" id="imPasteSel" ${n ? '' : 'disabled'}>Paste all into ${n} selected →</button>
  </div>`;
}

/* PASTE INTO SEVERAL LISTINGS. One send per SKU, each previewed by Amazon first (the backend only
 * sends for real when the preview is clean), each reported on its own line. It stops after three
 * failures in a row, because the fourth will fail the same way and the rest can wait for a fix. */
// Paste the copied stack into every ticked SKU: one send each, applied straight away (the backend previews first), reported line by line.
/** What a paste would do, per listing, without sending: { jobs, held, careful, qual }. Only the clipboard's ticked slots (the swatch with
 *  `withSw`); mode 'gaps' leaves a slot that already holds a picture (ours or live) alone. `qual`: sku → slot → { q (imqCheck), wh, fail }:
 *  a picture fails when the rules say anything but OK (under 2000, no zoom, not square, the same picture twice in the stack it lands in). */
function imPastePlan(skus, opts) {
  const o = opts || {};
  const brandKey = $('imBrand').value;
  const items = (IML[brandKey] || { items: [] }).items;
  const by = new Map(items.map(item => [item.sku, item]));
  // --- warn when the targets are a different colour from the copied listing ---
  const colours = [...new Set(skus.map(each => (by.get(each) || {}).c).filter(Boolean))];
  const warn = colours.filter(colour => colour && IM_CLIP.c && colour !== IM_CLIP.c);
  const careful = warn.length ? `CAREFUL: ${warn.length} of them are a different colour (${warn.slice(0, 4).join(', ')}) and ${IM_CLIP.sku} is ${IM_CLIP.c}.` : '';
  const want = imClipSlots(o.withSw);
  const jobs = [];
  const held = [];
  const qual = new Map();
  for (const sku of skus) {
    const row = by.get(sku);
    if (!row) { held.push({ sku, why: 'not in this snapshot' }); continue; }
    const img = row.img || {};
    const set = {};
    let filled = 0;
    Object.keys(want).forEach(slot => {
      if (o.mode === 'gaps' && (img[slot] || (row.live || {})[slot])) { filled++; return; }
      if (img[slot] !== want[slot]) set[slot] = want[slot];
    });
    if (!Object.keys(set).length) { held.push({ sku, why: filled ? 'no empty slot to fill' : 'already holds these pictures' }); continue; }
    if (!row.pt) { held.push({ sku, why: 'no product type in the snapshot — open it and paste there' }); continue; }
    // --- the picture rules on each picture that would go in, in the stack it lands in ---
    const after = Object.assign({}, row.live || {}, img, set);
    const dups = imqDups(after);
    const per = {};
    Object.keys(set).forEach(slot => {
      const wh = imqDims(set[slot]);
      const q = imqCheck({ slot, w: wh ? wh[0] : 0, h: wh ? wh[1] : 0, dup: dups[slot] });
      per[slot] = { q, wh, fail: q.level !== 'ok' };
    });
    qual.set(sku, per);
    jobs.push({ brand: brandKey, sku, asin: row.asin || '', label: [row.c, row.z].filter(Boolean).join(' · ') || sku, row, body: { limg: 'patch', brand: brandKey, sku, productType: row.pt, set },
      changes: Object.keys(set).map(slot => ({ field: sqField(slot), old: img[slot] || '(none)', new: set[slot], pic: true, attr: slot, oldV: img[slot] || '' })) });
  }
  return { jobs, held, careful, qual };
}

/* THE PREVIEW before anything goes to Amazon: per listing, which slots change (old → new picture) and what the picture rules say about
 * each new one. A picture that fails the rules is left out unless its own "Include anyway" box is ticked. "Continue" goes on to the usual
 * Amazon check popup (#10) and Listing History — the same send as always. */
function imPastePreview(skus) {
  if (!IM_CLIP || !skus.length) return;
  const plan = imPastePlan(skus, { withSw: imClipWithSw(), mode: IM_PASTE_MODE });
  IM_PV = { skus, plan, inc: new Set() };
  imModal(imPreviewHtml(plan, IM_PV.inc));
}
function imPreviewHtml(plan, inc) {
  const clip = IM_CLIP;
  const pic = (url, cls) => (url ? `<span class="im-pv-pic${cls || ''}"><img src="${imEsc(imThumb(url))}" alt="" loading="lazy"></span>` : '<span class="im-pv-pic is-none">none</span>');
  let nIn = 0;
  let nOut = 0;
  const blocks = plan.jobs.map(job => {
    const per = plan.qual.get(job.sku) || {};
    const lines = Object.keys(job.body.set).map(slot => {
      const info = per[slot] || { q: { chips: [] } };
      const key = job.sku + '|' + slot;
      const on = !info.fail || inc.has(key);
      if (on) nIn++;
      else nOut++;
      const chips = info.wh ? info.q.chips : [{ lv: 'na', t: 'Size not known', tip: 'Not measured yet: open the listing, or let its tiles show on screen' }].concat(info.q.chips);
      return `<div class="im-pv-row${info.fail ? ' is-fail' : ''}${on ? '' : ' is-out'}"><b class="im-pv-slot">${slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot}</b>`
        + `${pic((job.row.img || {})[slot])}<span class="im-pv-arrow" aria-hidden="true">→</span>${pic(job.body.set[slot], ' is-new')}`
        + `<span class="im-pv-q">${imqChipsHtml(chips)}${info.fail ? `<label class="im-pv-inc"><input type="checkbox" data-pv-inc="${imEsc(key)}"${on ? ' checked' : ''}> Include anyway</label>` : ''}</span></div>`;
    }).join('');
    return `<div class="im-pv-l"><div class="im-pv-h"><b class="im-mono">${imEsc(job.sku)}</b> <span class="muted">${imEsc(job.label)} · ${Object.keys(job.body.set).length} slot(s) change</span></div><div class="im-pv-rows">${lines}</div></div>`;
  }).join('');
  const held = plan.held.length ? `<div class="im-pv-held"><b>Not changed (${plan.held.length})</b>${plan.held.map(h => `<div><span class="im-mono">${imEsc(h.sku)}</span> — ${imEsc(h.why)}</div>`).join('')}</div>` : '';
  return `<div class="im-pv" role="document">
    <div class="im-pv-top"><b>Preview — paste ${imEsc(clip.sku)}'s pictures</b>
      <span class="muted">${plan.jobs.length} listing(s) change · ${nIn} picture(s) go in${nOut ? ` · <span class="im-pv-outn">${nOut} left out (they fail the picture rules — tick “Include anyway” to send them)</span>` : ''}
      · ${IM_PASTE_MODE === 'gaps' ? 'only empty slots are filled' : 'the ticked slots are replaced'}. Nothing is sent yet.</span>
      ${plan.careful ? `<div class="err" style="font-size:12px;margin-top:4px">${imEsc(plan.careful)}</div>` : ''}</div>
    <div class="im-pv-list">${blocks || '<div class="muted">Nothing would change.</div>'}${held}</div>
    <div class="im-pv-foot"><button class="ghost im-b" data-im-pv="cancel">Cancel</button>
      <button class="im-b im-go" data-im-pv="go" ${nIn ? '' : 'disabled'}>Continue to the Amazon check (${nIn} picture(s))</button></div>
  </div>`;
}
/** "Continue": the preview's choices → the send. Failing pictures not ticked in are dropped; a listing left with nothing is named in "held". */
function imPreviewGo() {
  if (!IM_PV) return;
  const { skus, plan, inc } = IM_PV;
  const jobs = [];
  const held = plan.held.slice();
  plan.jobs.forEach(job => {
    const per = plan.qual.get(job.sku) || {};
    const keep = Object.keys(job.body.set).filter(slot => !(per[slot] && per[slot].fail) || inc.has(job.sku + '|' + slot));
    if (!keep.length) { held.push({ sku: job.sku, why: 'every picture was left out in the preview (picture rules)' }); return; }
    const set = Object.fromEntries(keep.map(slot => [slot, job.body.set[slot]]));
    jobs.push(Object.assign({}, job, { body: Object.assign({}, job.body, { set }), changes: job.changes.filter(change => keep.includes(change.attr)) }));
  });
  IM_PV = null;
  return imPasteMany(skus, { jobs, held, careful: plan.careful });
}
// The popup frame the Season planner and the Amazon check use (#spModal); the preview shows in it, then the check takes it over.
function imModal(html) {
  if (typeof spModal === 'function') return spModal(html);
  const modal = $('spModal');
  if (!modal) return;
  $('spModalBox').innerHTML = html || '';
  modal.classList.toggle('hide', !html);
}

/** Paste into several listings. `pre` = the plan the preview approved; without it the plan is made here (every ticked slot). */
async function imPasteMany(skus, pre) {
  if (!IM_CLIP || !skus.length) return;
  const plan = pre || imPastePlan(skus, { withSw: imClipWithSw(), mode: IM_PASTE_MODE });
  const { jobs, held, careful } = plan;
  // --- one change per SKU (only the slots that differ) through THE ONE SEND PATH (#10): the Amazon check popup — Amazon checks each,
  //     the person approves, each is sent and read again; the ones that cannot be sent are named there ---
  const out = $('imBulk');
  if ($('imPasteSel')) $('imPasteSel').disabled = true;
  return sqSendWithCheck(jobs, {
    screen: 'Image Manager · paste', title: `Paste ${IM_CLIP.sku}'s pictures${careful ? ' — ' + careful : ''}`, held,
    onSent: job => { job.row.img = Object.assign({}, job.row.img, job.body.set); },   // what was sent, so the strip stops lying
    onDone: sum => {
      IML_DIRTY = true;
      IM_SEL.clear();
      imListRender();
      const lines = sum.jobs.map(job => job.sku + ' — ' + (job.state === 'accepted' ? 'accepted' : job.state === 'working' ? 'sent, Amazon is still working' : job.state === 'notsent' ? 'test site — not sent'
        : job.why ? (job.state === 'no' ? 'Amazon says no: ' : 'Amazon rejected: ') + job.why : 'not sent')).concat(held.map(h => h.sku + ' — ' + h.why));
      if ($('imBulk')) $('imBulk').innerHTML = '<b>' + imEsc(sqSummaryText(sum) || 'Nothing sent.') + '</b><br>' + lines.map(imEsc).join('<br>');
    } });
}

/* ============================================================================================
 * 10. EVENT WIRING — the sidebar, the main area, the drawer's close, the keys
 * Buttons drawn inside the drawer are wired where they are drawn (imWire); the cards and the sidebar have one listener each.
 */

// Open the editor for exactly the SKU or ASIN typed in the search (Picture check listens to this button too).
$('imGo').onclick = () => {
  IM_SKU_CHOICES = null;
  imLoad();
};

// Close the drawer, drawing the cards again if a send changed anything.
$('imBack').onclick = () => {
  imShowEditor(false);
  if (IML_DIRTY) {
    IML_DIRTY = false;
    imListRender();
  }
};

let IML_T = 0;          // debounce timer for the search box
// Draw again for a new search, filter or Show (the drawer closes).
const imListAgain = () => {
  IML_PAGE = 0;
  imShowEditor(false);
  imListRender();
};
$('imQ').addEventListener('input', () => {
  clearTimeout(IML_T);
  IML_T = setTimeout(imListAgain, 250);
});
$('imQ').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(IML_T);
    imListAgain();
  }
});
$('imFilter').onchange = imListAgain;
$('imView').onchange = imListAgain;
// Brand changed: nothing ticked, every family, that brand's snapshot.
$('imBrand').onchange = () => {
  IML_PAGE = 0;
  IM_SEL.clear();
  IM_ONLY = null;
  IM_FAM = '';
  imShowEditor(false);
  imListEnsure();
};
// Refresh from Amazon: rebuild this brand's snapshot.
$('imRefresh').onclick = () => imListBuild($('imBrand').value);

/* "Upload pictures": files for the listing open in the drawer, else the one ticked card — they fill its empty slots in order, through the
 * picture rules (imUploadMany). */
let IM_UPJOB = null;
function imUploadPick() {
  const open = IM && $('imEditWrap') && !$('imEditWrap').classList.contains('hide') ? IM.sku : '';
  const sku = open || (IM_SEL.size === 1 ? [...IM_SEL][0] : '');
  if (!sku) return imMsg('Tick one card (or open one), then press Upload pictures.', true);
  IM_UPJOB = { sku, load: open ? Promise.resolve() : imEditOpen(sku) };
  const input = $('imFiles2');
  if (!input) return;
  input.value = '';
  input.click();
}
$('imFiles2').addEventListener('change', async () => {
  const job = IM_UPJOB;
  IM_UPJOB = null;
  const files = $('imFiles2').files ? [...$('imFiles2').files] : [];
  if (!job || !files.length) return;
  await job.load;
  if (IM && IM.sku === job.sku) imUploadMany(files);
});

// The sidebar: brand, Show, a family.
$('imSide').addEventListener('click', e => {
  const t = e.target;
  const on = sel => (t && t.closest ? t.closest(sel) : null);
  const brand = on('[data-im-brand]');
  if (brand) {
    if ($('imBrand').value === brand.dataset.imBrand) return;
    $('imBrand').value = brand.dataset.imBrand;
    return $('imBrand').onchange();
  }
  const show = on('[data-im-show]');
  if (show) {
    IM_SHOW = show.dataset.imShow;
    return imListAgain();
  }
  const fam = on('[data-im-fam]');
  if (fam) {
    IM_FAM = fam.dataset.imFam;
    imListAgain();
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
  }
});

/* One listener for the main area: a filter chip, Group, Select all, Upload pictures, a card's tick (Shift+click: a range), Copy all, Paste
 * all here, Edit, a picture of the strip (the viewer), the card itself (Edit), Show everything. */
$('imList').addEventListener('click', e => {
  const t = e.target;
  const on = sel => (t && t.closest ? t.closest(sel) : null);
  const chip = on('[data-im-chip]');
  if (chip) {
    $('imFilter').value = chip.dataset.imChip === $('imFilter').value ? 'all' : chip.dataset.imChip;
    return imListAgain();
  }
  const group = on('[data-im-group]');
  if (group) return imGroupSet(group.dataset.imGroup);
  if (on('[data-im-selall]')) {
    const all = IM_SHOWN.length && IM_SHOWN.every(sku => IM_SEL.has(sku));
    IM_SHOWN.forEach(sku => (all ? IM_SEL.delete(sku) : IM_SEL.add(sku)));
    imListRender();
    return imMsg(all ? 'Nothing ticked.' : `Ticked ${IM_SHOWN.length} card(s).`);
  }
  if (on('#imUpBtn')) return imUploadPick();
  if (on('#imClearFilter')) {
    $('imFilter').value = 'all';
    $('imQ').value = '';
    IM_SHOW = 'all';
    return imListAgain();
  }
  const tick = on('input.im-sel');
  if (tick) {
    const sku = tick.dataset.sku;
    let changed = [sku];
    if (tick.checked) IM_SEL.add(sku);
    else IM_SEL.delete(sku);
    if (e.shiftKey && IM_LAST_SEL && IM_LAST_SEL !== sku) {
      changed = imRangeSel(IM_SHOWN, IM_LAST_SEL, sku);
      changed.forEach(each => (tick.checked ? IM_SEL.add(each) : IM_SEL.delete(each)));
    }
    IM_LAST_SEL = sku;
    return imSelUpdate(changed);
  }
  if (on('.imx-tick')) return;                     // the label around the tick box: its input handles it
  const copy = on('[data-copy]');
  if (copy) return imCopyAll(copy.dataset.copy);
  const paste = on('[data-paste1]');
  if (paste) return imPasteGo([paste.dataset.paste1]);
  const edit = on('[data-edit]');
  if (edit) return imEditOpen(edit.dataset.edit);
  const view = on('.imx-ms[data-view]');
  if (view) return imViewOpen(view.dataset.view, view.dataset.slot);
  const card = on('.imx-card');
  if (card && card.dataset.sku && !on('button,a,input,label,select')) return imEditOpen(card.dataset.sku);
});
// Enter on a card opens it, like a click.
$('imList').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target || !e.target.classList || !e.target.classList.contains('imx-card')) return;
  imEditOpen(e.target.dataset.sku);
});
// The viewer's buttons; a click on the dark backdrop closes it.
$('imViewer').addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-vw]') : null;
  if (btn) return imViewAct(btn.dataset.vw);
  if (e.target === $('imViewer')) imViewClose();
});
// Replace: the file chosen goes into that slot once the editor has the listing.
$('imFile2').addEventListener('change', () => imReplaceFile($('imFile2').files && $('imFile2').files[0]));
// Esc closes the drawer (a popup open on top closes first, by its own Esc).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || IM_VW || !$('imEditWrap') || $('imEditWrap').classList.contains('hide')) return;
    if ($('spModal') && !$('spModal').classList.contains('hide')) return;
    $('imBack').onclick();
  });
}
/* KEYBOARD (the "?" popup lists it): / search · Esc close · ← → in the viewer · E edit · C copy all · V paste preview · ? help.
 * E and C act on the card under the mouse (or the viewer's picture). Never while typing. */
let IM_HOVER = { sku: '', slot: '' };
let IM_HELP = false;
const IM_KEYS = [['/', 'Search'], ['Esc', 'Close the viewer, the drawer or a popup'], ['← →', 'Previous / next picture in the viewer'],
  ['E', 'Edit the card under the mouse (or the viewer\'s listing)'], ['C', 'Copy all the pictures of the card under the mouse — over one picture of its strip: just that one'],
  ['V', 'Preview pasting the clipboard into the ticked cards'], ['?', 'This help']];
function imHelpHtml() {
  return `<div class="im-pv im-help" role="document"><div class="im-pv-top"><b>Image Manager — keys and tips</b></div><div class="im-pv-list">`
    + `<table class="im-keys">${IM_KEYS.map(([k, t]) => `<tr><td><kbd>${imEsc(k)}</kbd></td><td>${imEsc(t)}</td></tr>`).join('')}</table>`
    + '<p class="muted">Click a card to edit it. Click a small picture to see it large. Shift+click a tick to tick every card in between. Copy all on one card, tick others, then Paste all into the selected.</p></div>'
    + '<div class="im-pv-foot"><button type="button" class="im-b im-go" data-im-help="close">Close</button></div></div>';
}
function imHelp(on) {
  IM_HELP = !!on;
  imModal(on ? imHelpHtml() : '');
}
/** One key press on the Image Manager page; true = it was ours (the page then keeps the browser from acting on it too). */
function imKey(e) {
  const pane = $('paneImg');
  if (!pane || (pane.classList && pane.classList.contains('hide'))) return false;
  const tag = String((e.target && e.target.tagName) || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || !!(e.target && e.target.isContentEditable);
  const key = String(e.key || '');
  const k = key.toLowerCase();
  if (IM_HELP && key === 'Escape') { imHelp(false); return true; }
  if (IM_VW) {
    if (key === 'Escape') { imViewClose(); return true; }
    if (key === 'ArrowLeft') { imViewMove(-1); return true; }
    if (key === 'ArrowRight') { imViewMove(1); return true; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k === 'c') { imViewAct('copy'); return true; }
    if (k === 'e') { const sku = IM_VW.sku; imViewClose(); imEditOpen(sku); return true; }
    return false;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return false;
  if ($('spModal') && $('spModal').classList && !$('spModal').classList.contains('hide')) return false;    // a popup is open
  if (key === '/') { $('imQ').focus(); if ($('imQ').select) $('imQ').select(); return true; }
  if (key === '?') { imHelp(true); return true; }
  if (k === 'e' && IM_HOVER.sku) { imEditOpen(IM_HOVER.sku); return true; }
  if (k === 'c' && IM_HOVER.sku) {
    const item = imItem(IM_HOVER.sku);
    if (!item) return false;
    if (IM_HOVER.slot) {
      const slot = IM_HOVER.slot;
      const url = imVal(item, slot);
      if (!url) return false;
      imClipCopyOne({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, slot, url });
      imListRender();
      imMsg('Copied ' + (slot === 'SWCH' ? 'the swatch' : slot) + ' of ' + item.sku + ' to the clipboard.');
    } else imCopyAll(item.sku);
    return true;
  }
  if (k === 'v') {
    if (IM_CLIP && IM_SEL.size) imPastePreview([...IM_SEL]);
    else imMsg(IM_CLIP ? 'Tick the cards to paste into, then press V.' : 'Copy a card first (C), tick cards, then press V.');
    return true;
  }
  return false;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', e => { if (imKey(e) && e.preventDefault) e.preventDefault(); });
  document.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-im-help]') : null;
    if (btn) imHelp(btn.dataset.imHelp === 'open');
  });
}
$('imList').addEventListener('mouseover', e => {
  const pic = e.target && e.target.closest ? e.target.closest('.imx-ms[data-slot]') : null;
  const card = e.target && e.target.closest ? e.target.closest('.imx-card') : null;
  IM_HOVER = { sku: (card && card.dataset.sku) || '', slot: (pic && pic.dataset.slot) || '' };
});
$('imList').addEventListener('mouseleave', () => { IM_HOVER = { sku: '', slot: '' }; });
// The paste preview (in the #spModal frame): Cancel / Continue, and the "Include anyway" box of a picture that fails the rules.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-im-pv]') : null;
    if (!btn || !IM_PV) return;
    if (btn.dataset.imPv === 'cancel') {
      IM_PV = null;
      imModal('');
    } else if (btn.dataset.imPv === 'go') imPreviewGo();
  });
  document.addEventListener('change', e => {
    const cb = e.target;
    if (!cb || !cb.dataset || cb.dataset.pvInc == null || !IM_PV) return;
    if (cb.checked) IM_PV.inc.add(cb.dataset.pvInc);
    else IM_PV.inc.delete(cb.dataset.pvInc);
    const list = $('spModalBox') && $('spModalBox').querySelector('.im-pv-list');
    const keep = list ? list.scrollTop : 0;
    imModal(imPreviewHtml(IM_PV.plan, IM_PV.inc));
    const again = $('spModalBox') && $('spModalBox').querySelector('.im-pv-list');
    if (again) again.scrollTop = keep;
  });
}
// Sizes measured on screen (image-quality.js): the strips' rings follow at once (imqPaint); the sidebar's counts at most once a second.
IMQ.onSize = imCardsSoon;
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', imStick);
