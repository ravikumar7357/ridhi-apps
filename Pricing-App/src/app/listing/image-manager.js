/* ================= LISTING · IMAGE MANAGER: every listing's pictures — the list of the whole brand, and the editor for one stack =================
 * Screens: Image Manager (tab 'img'): the list (parent → child tiles with live pictures, swatch, chips and filters) and the
 *          editor (one listing's MAIN / PT01–PT08 / SWATCH: reorder, upload, paste, check and send to Amazon). Listing Errors
 *          and Listing Health read the saved list snapshot too (IML, imgsnap / imgrows).
 * Does: imListLoad / imListBuild keep the brand snapshot; imListGroups and the im* checks drive the chips; imListRender draws
 *       the page; imLoad / imRender / imSwap edit one stack; imUpload / imSend check and apply through imPost (the app's one
 *       POST to the backend); the clipboard copies one stack into one or many listings.
 * Main functions: imMsg, imEsc, imPost, imListEnsure, imListLoad, imListBuild, imListGroups, imKidRow, imTile, imListRender,
 *                 imLoad, imRender, imSwap, imUpload, imSend, imHistory, imClipTake, imClipSave, imPasteMany, imWire. */
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

let IM_CLIP = null;     // { brand, sku, asin, c, z, slots: {MAIN..PT08, SWCH}, n }
const IM_SEL = new Set();   // SKUs ticked in the list, for pasting into several at once
let IM_PASTE_MODE = 'replace';  // the clipboard bar's mode: 'replace' these slots | 'gaps' = only fill empty slots
let IM_PV = null;
/* FAMILIES OPEN / CLOSED. On load every family is closed (its header only). The person opens one (▸ or its header) and it shows ALL its
 * children, drawn IM_CHUNK rows at a time as they come near the screen (a block far away is emptied again, keeping its height, so the
 * page never moves). A search or a filter opens the families it matches — unless the person closed one of them. Kept while on the screen. */
const IM_OPEN = new Set();   // families the person opened (imGroupKey)
const IM_SHUT = new Set();   // families the person closed while a search / filter opens the matching ones (cleared when those change)
const IM_CHUNK = 25;         // rows drawn at a time inside an open family
const IM_CHUNK_H = new Map();// 'key|i' → measured height of a block of rows: a redraw keeps the page where it was
const IM_ROWS = new Map();   // family key → the rows it shows (the open families on screen)
let IM_CHUNK_OBS = null;
let IML_LOADING = false;    // the saved snapshot is being read (the list shows its skeleton)           // the paste preview while it is open: { skus, plan, inc: Set('sku|slot') of pictures failing the rules but ticked in }
let IM_ONLY = null;         // { skus: Set, label } — only these listings, picked in Listing Health's Fix all (fix-all.js), until "Show every listing"
// Show only these listings (ticked, page 1, no search), with a bar naming where they were picked; empty → every listing again.
function imOnly(skus, label) {
  IM_ONLY = skus && skus.length ? { skus: new Set(skus), label: label || '' } : null;
  IML_PAGE = 0;
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

/* ============================================================================================
 * 3. SWITCHING VIEWS — tab entry, list ⇄ editor
 */

// First visit to the tab (called from showTab).
function ensureImg() {
  imStick();
  imListEnsure();
  imStockEnsure();            // "Stock > 0 only": the stock is Listing Health's snapshot (read-only)
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

// One brand's list into IML[brand]: from the ListingMatch cache at once when it is usable (listing-match.js — the saved snapshot is read
// under it in the background), else the saved snapshot as before.
async function imListLoad(brand) {
  if (typeof lmEnsure === 'function') {
    await lmEnsure();                       // this browser's saved copy of the cache: never waits for the network
    if (lmImlFast(brand, () => imListLoadSnap(brand))) return;
  }
  return imListLoadSnap(brand);
}
// Read one brand's saved snapshot (imgsnap/{brand} + its imgrows chunks) into IML[brand], URLs unpacked.
async function imListLoadSnap(brand) {
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

/* WHAT AMAZON ACTUALLY SAYS ABOUT THIS LISTING.
 * BUYABLE WITHOUT DISCOVERABLE IS A SUPPRESSED LISTING — it can still be bought from a direct link
 * and cannot be found in search. RTC203-6060 sat like that under a green "Buyable" chip here while
 * Seller Central said "Search suppressed", because the chip only tested /BUYABLE/. */
// The status chip for one listing: { k: short key, label, fill, ink } — THE ONE RULE (lrShopOf, listing-rules.js) decides
// Suppressed / Not buyable / Not checked; stock comes from the Listing Health snapshot (lrQtyOf).
function imState(item, brand) {
  const b = brand || (typeof $ === 'function' && $('imBrand') ? $('imBrand').value : '');
  const shop = lrShopOf({ st: item.st, iss: item.iss, qty: lrQtyOf(b, item.sku), brand: b, sku: item.sku });
  if (shop.k === 'sup') return { k: 'sup', label: shop.how === 'a' ? 'Search suppressed' : 'Suppressed', why: shop.why, fill: 'var(--bad-bg)', ink: 'var(--bad-ink)' };
  if (shop.k === 'nobuy') return { k: 'nobuy', label: 'Not buyable', why: shop.why, fill: 'var(--bad-bg)', ink: 'var(--bad-ink)' };
  if (shop.k === 'unk') return { k: 'unk', label: 'Not checked', fill: 'var(--hover)', ink: 'var(--muted)' };
  if (shop.k === 'ok') return { k: 'ok', label: 'Buyable', fill: 'var(--accent-bg)', ink: 'var(--accent-ink)' };
  const status = String(item.st || '').toUpperCase();
  if (status.includes('DISCOVERABLE')) return { k: 'nooffer', label: 'No offer', fill: 'var(--hover)', ink: 'var(--muted)' };
  return { k: 'none', label: item.st || 'Not buyable', fill: 'var(--hover)', ink: 'var(--muted)' };
}

/* ============================================================================================
 * STOCK > 0 ONLY (24 Nov 2026, the MD's task #5) — the toolbar's checkbox #imStock (the same "Stock > 0 only" box as A+ Content and
 * IP & Trademark Guard). ON (the default; remembered in this browser, sellora.imgstock): only children with 1 or more FBA units are
 * listed. OFF: every child again — one without stock is listed plainly: no problem chip, no picture-error line, no order dot.
 * Either way the picture problems are marked and COUNTED (the cards, the filters, "N need pictures", the order dots) only on children
 * with stock. Stock = FBA units in Listing Health's snapshot (lrQtyOf — what the status chip already reads); while that snapshot is
 * not held nothing is hidden (it is read, then the list is drawn again). The Download errors sheet is unchanged (live with stock only).
 * ============================================================================================ */
const IM_STOCK_KEY = 'sellora.imgstock';
let IM_STOCK_ONLY = true;
try { IM_STOCK_ONLY = localStorage.getItem(IM_STOCK_KEY) !== '0'; } catch (e) { /* no storage: on */ }
let IM_STOCK_P = null;          // Listing Health's snapshot being read for the stock
const imBrandOf = brand => brand || (typeof $ === 'function' && $('imBrand') ? $('imBrand').value : '');
/** Is the brand's stock held (Listing Health's snapshot)? */
const imStockKnown = brand => typeof HEALTH !== 'undefined' && !!HEALTH[imBrandOf(brand)] && Array.isArray(HEALTH[imBrandOf(brand)].rows);
/** A listing's FBA units (null: not in the snapshot). */
const imStockOf = (item, brand) => (typeof lrQtyOf === 'function' ? lrQtyOf(imBrandOf(brand), item.sku) : null);
/** Does a child get its picture marks and counts? 1 or more FBA units — or the stock is not held yet (then nothing is hidden). */
const imStockOk = (item, brand) => !imStockKnown(brand) || (Number(imStockOf(item, brand)) || 0) >= 1;
/** The listing's problems as the LIST marks and counts them: imProblems for a child with stock, none for one without. */
const imMarks = (item, brand) => (imStockOk(item, brand) ? imProblems(item, brand) : []);
/** The checkbox: on / off, remembered, the list drawn again. */
function imStockSet(on) {
  IM_STOCK_ONLY = !!on;
  try { localStorage.setItem(IM_STOCK_KEY, IM_STOCK_ONLY ? '1' : '0'); } catch (e) { /* a private window: this visit only */ }
  if ($('imStock')) $('imStock').checked = IM_STOCK_ONLY;
  IM_CHUNK_H.clear();
  if (IML[$('imBrand').value]) imListAgain();
}
/** The stock comes from Listing Health's snapshot: read it (read-only) when it is not held yet, then draw the list again. */
function imStockEnsure() {
  if (IM_STOCK_P || typeof H_LOADED === 'undefined' || H_LOADED || typeof loadHealthCache !== 'function') return IM_STOCK_P;
  IM_STOCK_P = Promise.resolve().then(loadHealthCache).catch(() => {}).then(() => {
    IM_STOCK_P = null;
    if (IML[$('imBrand').value]) imListRender();
  });
  return IM_STOCK_P;
}

/* ============================================================================================
 * THE FAMILY'S PICTURE ORDER (24 Nov 2026, the MD's task #5): ONE small red dot under a child's picture that is not where its siblings
 * have it — nothing else (no chip, no count, no error list, nothing on the family).
 * SAME PICTURE = the same Amazon image id: the part after /images/I/ in the picture's link (imqId — "71abcXYZ" in
 *   …/images/I/71abcXYZ._SL1500_.jpg). Amazon gives every uploaded file its own id and serves it at any size under that id, so two
 *   children with the same id show the very same file; a link that is not Amazon's is compared whole. The same photo uploaded twice gets
 *   two ids and counts as two pictures — Sellora does not download the pixels to compare them.
 * WHICH PICTURE: each slot's picture as the tile shows it first — the one we sent, else what Amazon serves (MAIN, PT01–PT08; the swatch
 *   is not part of the order).
 * THE FAMILY'S ORDER, from its children with stock (2 or more; one child alone is never checked):
 *   - a SHARED picture (on 2+ children: a size chart, a care guide, a shared lifestyle photo) — its normal slot is the slot most of
 *     those children use it in;
 *   - each SLOT's normal content is what most children have there: that shared picture, an own photo (a picture only that child has:
 *     its colour / size photos), or nothing;
 *   - the child-specific photos follow the position pattern most siblings follow: the family's own-photo slots in order (e.g. MAIN,
 *     PT01, PT02) — a child's 1st own photo belongs in the 1st of them, its 2nd in the 2nd, and so on.
 *   "Most" is a clear majority: more children than any other answer, and at least 2. A tie decides nothing (no dot).
 * THE DOTS: (1) a shared picture in another slot than its normal one: "Out of sequence — siblings have this in PT02"; (2) an own photo
 *   in a slot that is not one of the family's own-photo slots, when its place in the pattern is another slot: "Out of sequence —
 *   siblings have this in PT01" (none for an extra photo after the pattern ends); (3) an empty slot whose normal content is a picture:
 *   "Siblings have an image here". The slot a moved shared picture belongs in is not marked again: its dot is on the moved picture.
 * ============================================================================================ */
const IM_SEQ = new Map();       // sku → { slot: the dot's words } — worked out with the list (imShownGroups)
const imSeqPic = (item, slot) => { const url = (item.img || {})[slot] || (item.live || {})[slot]; return url ? imqId(url) : ''; };
// The key with clearly the most (more than any other, and 2 or more); null for a tie or a single one.
function imSeqMost(counts) {
  let best = null;
  let most = 0;
  let tie = false;
  counts.forEach((n, key) => { if (n > most) { best = key; most = n; tie = false; } else if (n === most) tie = true; });
  return best !== null && !tie && most >= 2 ? best : null;
}
/** One family's dots: Map sku → { slot: words } for the children given (the ones with stock). */
/** The family's order from its children (2+): { pics (per child, per slot: the picture id), shared(id), home (shared picture → its
 *  normal slot), norm (per slot: 'S:<id>' | 'O' own photo | '' nothing | null no clear answer), ownSlots } — imSeqFamily (the dots) and
 *  imSeqTarget ("Match family order") both read it. */
function imSeqPattern(kids) {
  const pics = kids.map(kid => IM_SLOTS.map(slot => imSeqPic(kid, slot)));
  const holders = new Map();
  pics.forEach(row => new Set(row.filter(Boolean)).forEach(p => holders.set(p, (holders.get(p) || 0) + 1)));
  const shared = p => (holders.get(p) || 0) >= 2;
  const kind = p => (!p ? '' : shared(p) ? 'S:' + p : 'O');
  const bySlot = new Map();
  pics.forEach(row => row.forEach((p, i) => {
    if (!p || !shared(p)) return;
    const m = bySlot.get(p) || bySlot.set(p, new Map()).get(p);
    m.set(IM_SLOTS[i], (m.get(IM_SLOTS[i]) || 0) + 1);
  }));
  const home = new Map();
  bySlot.forEach((m, p) => home.set(p, imSeqMost(m)));
  const norm = IM_SLOTS.map((slot, i) => { const m = new Map(); pics.forEach(row => m.set(kind(row[i]), (m.get(kind(row[i])) || 0) + 1)); return imSeqMost(m); });
  return { pics, shared, home, norm, ownSlots: IM_SLOTS.filter((slot, i) => norm[i] === 'O') };
}
function imSeqFamily(kids) {
  const out = new Map();
  if (!kids || kids.length < 2) return out;
  // the family's order: each shared picture's normal slot, each slot's normal content, the own-photo slots in order (imSeqPattern)
  const { pics, shared, home, norm, ownSlots } = imSeqPattern(kids);
  kids.forEach((kid, k) => {
    const row = pics[k];
    const dots = {};
    // the normal slots of the shared pictures this child has somewhere else: not marked again (the moved picture carries the dot)
    const left = new Set();
    row.forEach((p, i) => { const h = p && shared(p) ? home.get(p) : null; if (h && h !== IM_SLOTS[i]) left.add(h); });
    let own = 0;
    row.forEach((p, i) => {
      const slot = IM_SLOTS[i];
      if (!p) {
        if (norm[i] && !left.has(slot)) dots[slot] = 'Siblings have an image here';
        return;
      }
      if (shared(p)) {
        const h = home.get(p);
        if (h && h !== slot) dots[slot] = 'Out of sequence — siblings have this in ' + h;
        return;
      }
      const want = ownSlots[own++];
      if (norm[i] === 'O' || left.has(slot)) return;
      if (want && want !== slot) dots[slot] = 'Out of sequence — siblings have this in ' + want;
    });
    if (Object.keys(dots).length) out.set(kid.sku, dots);
  });
  return out;
}

/* ============================================================================================
 * THE PICTURE CHECKS — ONE FUNCTION (17 Nov 2026, the accuracy pass): a listing is flagged only when it is really so on Amazon.
 *   imCheck(item, check, brand) → true (it is so) | false (it is not) | null (cannot be decided from the data held: "not checked",
 *   never a problem). The number cards, the filter picker, the row's chip and summary, "N need pictures", the Download errors sheet
 *   and imgAccuracyReport all ask it — nothing else decides a check.
 * What a listing's record holds:
 *   img  — the pictures OUR listing submitted (its own attributes, read with the listing). The swatch lives only here: Amazon's
 *          catalogue never returns one (0 of 4,258 listings, while 3,098 have one) — so no check reads the swatch.
 *   live — what Amazon serves to shoppers (the catalogue). KNOWN only when the catalogue was asked about this ASIN and answered
 *          (it has an ASIN and no liveErr): an empty map after a failed read is no answer, never "Amazon serves no picture".
 *   iss  — Amazon's own current issues on the listing (severity, code, message, the attributes it names); st — Amazon's status.
 * The checks (IM_CHECKS): nomain, pcbad, few, amzerr, sup (the cards) and nobuy, diff (the picker only). Each reads only
 * what Amazon really gives — our submitted pictures, the catalogue's pictures with their sizes, Amazon's issues, status and enforcement
 * actions — and the Picture check's marks (a person's judgement). imProblems(item) is the listing's problems: the cards, the filters,
 * the row's chips and the Download errors sheet all read it, so the screen and the sheet always agree.
 * REMOVED (17 Nov 2026): "Shows another SKU's pictures" (the company uses one picture on many SKUs on purpose), "No swatch"
 * (Amazon's catalogue returns no swatch, so "Amazon serves none" can never be known) and "Too small (under 2000)" (the company's
 * 1500 pictures are fine for Amazon). A picture's size is information only — the editor shows it, nothing counts it.
 * ============================================================================================ */
const IM_CHECKS = { nomain: 'No main at all', pcbad: 'Main not OK', few: 'Fewer than 7 pictures',
  amzerr: 'Amazon picture error', sup: 'Search suppressed', nobuy: 'Not buyable', diff: 'Live image differs from yours' };
// Our listing's own pictures were read / Amazon's catalogue answered for this ASIN.
const imMineKnown = item => !!(item && item.img && typeof item.img === 'object');
const imLiveKnown = item => !!(item && item.live && typeof item.live === 'object' && item.asin && !item.liveErr);
/** No main picture at all: none sent by us, none shown to shoppers. */
const imNoMain = item => imCheck(item, 'nomain') === true;

/* AMAZON'S PICTURE ISSUES (17 Nov 2026, the 14:50 sheet's 16 brought back). An issue of Amazon's is about pictures when ANY of:
 *   - it names a picture slot's attribute (main / other_product_image_locator_1–8 / swatch, in whatever form Amazon writes it);
 *   - it carries a picture code: 18320 (main image missing or incorrect), 100238 (an image violates Amazon's image standards),
 *     100560 (the MAIN image does not represent the product), 100581 (text / logo / watermark on an image), 20005 (images could not
 *     be associated with the SKU), 300403 (Amazon cannot access the media file);
 *   - Amazon's own message is about a picture or picture files: image(s), picture(s), photo(s), swatch, media — "Your image PT08
 *     violates…", "The SWCH image you submitted…", "We can't access your media…".
 * It counts even when Amazon adds "will not lead to ASIN suppression" or "No action is required": Amazon still does not show that
 * picture. Amazon sometimes names another attribute on such an issue (it did on RCN72's 100238 on PT08 — that is why the stricter rule
 * of aa468db lost 12 of the 16), so the attribute alone never rules a picture issue out. Only "Search suppressed" uses the suppression
 * rule (lrShopOf). Works on the list's issues ({ s, c, m, a }) and the editor's ({ severity, code, message, attrs }). */
const IM_PIC_ATTR = /^(main_product_image_locator|other_product_image_locator_[1-8]|swatch_product_image_locator)$/;
const IM_PIC_ATTR_ANY = /(^|_)(product_)?image(_locator|_url)?(_?\d)?(\b|_|\.|#|$)|swatch/i;     // other spellings Amazon uses for a picture attribute
const IM_PIC_CODES = ['18320', '100238', '100560', '100581', '20005', '300403'];
const IM_PIC_WORDS = /\b(image|images|picture|pictures|photo|photos|swatch|swatches|media)\b/i;
function imIsPicIssue(issue) {
  if (!issue) return false;
  const attrs = (issue.a || issue.attrs || issue.attributeNames || []).map(String).filter(Boolean);
  if (attrs.some(attr => IM_PIC_ATTR.test(attr) || IM_PIC_ATTR_ANY.test(attr))) return true;
  if (IM_PIC_CODES.includes(String(issue.c || issue.code || ''))) return true;
  return IM_PIC_WORDS.test(String(issue.m || issue.message || ''));
}
// The slot a picture attribute stands for: MAIN, PT01–PT08, SWCH ('' for any other attribute).
function imAttrSlot(attr) {
  const s = String(attr || '');
  if (/^main_product_image_locator\b/.test(s) || /^main_image_url\b/.test(s)) return 'MAIN';
  if (/^swatch_(product_)?image/.test(s)) return 'SWCH';
  const m = s.match(/^other_(?:product_)?image_(?:locator_|url_?)([1-8])\b/);
  return m ? 'PT0' + m[1] : '';
}
/** The slot an issue is about: the picture attribute Amazon names, else the slot its message names ("Your image PT08…", "The MAIN image
 *  you submitted…", "The SWCH image…"); '' when neither says. */
function imIssueSlot(issue) {
  if (!issue) return '';
  for (const attr of (issue.a || issue.attrs || issue.attributeNames || [])) { const slot = imAttrSlot(attr); if (slot) return slot; }
  const m = String(issue.m || issue.message || '').match(/\b(MAIN|PT0[1-8]|SWCH)\b/);
  return m ? m[1] : '';
}
/** One picture error in words, as every place shows it: "ERROR 100238 on PT08: Your image PT08 violates…". */
const imPicErrText = issue => `ERROR ${issue.c || issue.code || ''}${imIssueSlot(issue) ? ' on ' + imIssueSlot(issue) : ''}: ${String(issue.m || issue.message || '')}`.replace(/^ERROR  ?on /, 'ERROR on ').replace(/^ERROR : /, 'ERROR: ');
/** A listing's Amazon ERRORs about pictures (from its issues; a snapshot from before they were kept: the first error's words). */
function imPicErrs(item) {
  if (Array.isArray(item.iss)) return item.iss.filter(issue => issue && String(issue.s || issue.severity || '').charAt(0).toUpperCase() === 'E' && imIsPicIssue(issue));
  return item.ie && imIsPicIssue({ m: item.im }) ? [{ s: 'E', c: '', m: item.im || '', a: [] }] : [];
}
// The slots whose submitted picture Amazon rejected: an ERROR of Amazon's about that slot (named by its attribute or in its message).
function imRejected(item) {
  const out = new Set();
  imPicErrs(item).forEach(err => {
    (err.a || err.attrs || []).forEach(attr => { const slot = imAttrSlot(attr); if (slot) out.add(slot); });
    const slot = imIssueSlot(err);
    if (slot) out.add(slot);
  });
  return out;
}
/** The real pictures of a listing: MAIN + PT01–PT08 that exist — the ones we submitted (not a slot Amazon rejected) or the ones Amazon
 *  serves, whichever is more. The swatch and empty slots are not pictures. { n, ours, live } — ours / live null when that side is not known. */
function imPicCount(item) {
  const img = item.img || {};
  const live = item.live || {};
  const rej = imRejected(item);
  const ours = imMineKnown(item) ? IM_SLOTS.filter(slot => img[slot] && !rej.has(slot)).length : null;
  const shown = imLiveKnown(item) ? IM_SLOTS.filter(slot => live[slot]).length : null;
  return { ours, live: shown, n: Math.max(ours || 0, shown || 0) };
}
// The pictures Amazon SERVES (the catalogue: MAIN + PT01–PT08 — never the swatch), each picture once: [{ slot, url }]. Their sizes are
// Amazon's own (the catalogue gives each picture's width and height). A picture of ours Amazon does not serve has no size from Amazon.
function imServedPics(item) {
  const seen = new Set();
  const out = [];
  if (!imLiveKnown(item)) return out;
  IM_SLOTS.forEach(slot => {
    const url = (item.live || {})[slot];
    if (!url) return;
    const id = imqId(url);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ slot, url });
  });
  return out;
}
const imAmzPic = url => /\/images\/I\/[^./?]+/.test(String(url || ''));
/** Is the picture Amazon serves in a slot the one we sent? true | false | null. The same picture has the same id in its link whatever
 *  size Amazon serves it at; a picture of ours that is not on Amazon's servers (our own link, still being taken in) cannot be compared. */
function imSamePic(liveUrl, mineUrl) {
  if (!liveUrl || !mineUrl) return null;
  if (liveUrl === mineUrl) return true;
  if (!imAmzPic(liveUrl) || !imAmzPic(mineUrl)) return null;
  return imqId(liveUrl) === imqId(mineUrl);
}

/** THE ONE CHECK FUNCTION. → true | false | null (not checked). `brand`: the listing's brand (the picker's when not given). */
function imCheck(item, k, brand) {
  if (!item) return null;
  const img = item.img || {};
  const live = item.live || {};
  const mineOk = imMineKnown(item);
  const liveOk = imLiveKnown(item);
  const b = brand || (typeof $ === 'function' && $('imBrand') ? $('imBrand').value : '');
  if (k === 'nomain') {
    // none sent by us AND none served by Amazon — both sides must be known to say so
    if (img.MAIN || (liveOk && live.MAIN)) return false;
    return mineOk && liveOk ? true : null;
  }
  if (k === 'pcbad') {
    // a person marked the main picture shoppers see Not OK (the mark is kept per picture: a new main picture has no mark)
    const marks = typeof PC !== 'undefined' && PC.marks ? PC.marks[b] : null;
    // the marks not read yet (and none held): not checked
    if (!marks || (!PC.loaded && !Object.keys(marks).length) || !liveOk) return null;
    return !!live.MAIN && (marks[imqId(live.MAIN)] || {}).v === 'bad';
  }
  if (k === 'few') {
    const count = imPicCount(item);
    if (count.n >= 7) return false;
    return count.ours == null || count.live == null ? null : true;
  }
  if (k === 'amzerr') {
    if (Array.isArray(item.iss)) return imPicErrs(item).length > 0;
    if (item.ie === 0) return false;
    return item.ie && imIsPicIssue({ m: item.im }) ? true : null;   // an old snapshot keeps only the first error's words
  }
  if (k === 'sup' || k === 'nobuy') {
    const state = imState(item, b).k;      // THE ONE RULE (lrShopOf) — untouched
    return state === 'unk' ? null : state === k;
  }
  if (k === 'diff') {
    // a slot where Amazon serves another picture than the one we sent (by the picture, not by its link)
    let unknown = !mineOk || !liveOk;
    for (const slot of IM_SLOTS) {
      if (!img[slot] || !live[slot]) continue;
      const same = imSamePic(live[slot], img[slot]);
      if (same === false) return true;
      if (same === null) unknown = true;
    }
    return unknown ? null : false;
  }
  return null;
}
/** The facts a check was decided on, in a few words — what the accuracy report prints beside Sellora's answer and Amazon's. */
function imCheckWhy(item, k, brand) {
  const img = item.img || {};
  const live = item.live || {};
  const liveOk = imLiveKnown(item);
  const yn = v => (v ? 'yes' : 'no');
  const amz = v => (liveOk ? yn(v) : 'not known' + (item.liveErr ? ' (' + item.liveErr + ')' : ''));
  if (k === 'nomain') return `our main: ${yn(img.MAIN)} · Amazon serves a main: ${amz(live.MAIN)}`;
  if (k === 'pcbad') return liveOk && live.MAIN ? `main picture ${imqId(live.MAIN)}: ${((((typeof PC !== 'undefined' && PC.marks[brand]) || {})[imqId(live.MAIN)]) || {}).v || 'no mark'}` : 'Amazon serves a main: ' + amz(live.MAIN);
  if (k === 'few') { const c = imPicCount(item); return `pictures: ours ${c.ours == null ? 'not known' : c.ours}, Amazon serves ${c.live == null ? 'not known' : c.live}`; }
  if (k === 'amzerr') return Array.isArray(item.iss) ? (imPicErrs(item).map(e => imPicErrText(e).slice(0, 160)).join(' | ') || 'no picture error') : 'issues not read';
  if (k === 'sup' || k === 'nobuy') { const s = imState(item, brand); return `status ${item.st || 'not read'} → ${s.label}${s.why ? ' (' + s.why + ')' : ''}`; }
  if (k === 'diff') return IM_SLOTS.filter(slot => img[slot] && live[slot] && imSamePic(live[slot], img[slot]) === false).join(', ') || 'no slot differs';
  return '';
}
// The card checks that could not be decided for this listing (their short names) — shown as "not checked", never as a problem.
const IM_CHECK_SHORT = { nomain: 'main', pcbad: 'Main not OK', few: 'picture count', amzerr: 'Amazon errors', sup: 'status' };
const imUnchecked = (item, brand) => IM_CARDS.map(card => card.k).filter(k => imCheck(item, k, brand) === null).map(k => IM_CHECK_SHORT[k] || k)
  .filter((name, i, all) => all.indexOf(name) === i);

/** The main picture shoppers see was marked Not OK in the Picture check (picture-check.js keeps the marks per picture id). */
const imPcBad = (brand, item) => imCheck(item, 'pcbad', brand) === true;

/* THE NUMBER CARDS at the top of the list. Each is one of the filter picker's own filters (the picker stays and follows the card):
 * a click shows only those listings, a second click shows all again. Counted over every child listing of the brand; a listing a check
 * cannot be decided for is counted as "not checked" in the card's small line, never in its number. */
const IM_CARDS = [
  { k: 'nomain', t: 'No main at all', cls: 'is-err', tip: 'No main picture: none sent by us and none shown to shoppers' },
  { k: 'pcbad', t: 'Main not OK', note: 'Picture check', cls: 'is-err', tip: 'Main pictures a person marked Not OK in the Picture check' },
  { k: 'few', t: 'Fewer than 7', note: 'pictures', cls: 'is-att', tip: 'Fewer than 7 real pictures (MAIN + PT01–PT08): the ones we sent or the ones Amazon serves, whichever is more; the swatch is not counted' },
  { k: 'amzerr', t: 'Amazon picture error', cls: 'is-err', tip: 'Amazon reports an error about the pictures (other errors are in Listing Errors)' },
  { k: 'sup', t: 'Search suppressed', cls: 'is-err', tip: 'Buyable from a direct link, but taken out of search results' },
];
/** THE LISTING'S PROBLEMS — the one function the cards, the filters, the row's chips and the Download errors sheet all read: the card
 *  checks that are really so for it (imCheck true), in the cards' order. */
const IM_PROBLEM_KEYS = () => IM_CARDS.map(card => card.k);
function imProblems(item, brand) {
  return IM_PROBLEM_KEYS().filter(k => imCheck(item, k, brand) === true);
}
/** A critical picture problem — Amazon itself says shoppers cannot see the product right: no main picture at all, the main picture
 *  rejected by Amazon (an ERROR of Amazon's about the MAIN picture — RCST72's 100581, RTCR78-60's 100560 — or 18320 "The main image is
 *  missing or incorrect"), or Search suppressed. These are the rows the Download errors sheet checks live with Amazon before saving. */
function imMainRejected(item) {
  return imPicErrs(item).some(err => String(err.c || err.code || '') === '18320' || imIssueSlot(err) === 'MAIN');
}
function imCritical(item, brand) {
  const p = imProblems(item, brand);
  return p.includes('nomain') || p.includes('sup') || imMainRejected(item);
}
/** The cards' numbers: [{ k, t, note, cls, tip, n, u }] over every child listing in `items` — n flagged, u not checked. */
function imCardsData(items, brand) {
  const kids = items.filter(item => item.lvl !== 'parent' && imStockOk(item, brand));      // only children with stock are counted
  return IM_CARDS.map(card => {
    let n = 0;
    let u = 0;
    kids.forEach(kid => { if (imProblems(kid, brand).includes(card.k)) n++; else if (imCheck(kid, card.k, brand) === null) u++; });
    const note = [card.note || '', u ? `${u.toLocaleString('en-US')} not checked` : ''].filter(Boolean).join(' · ');
    return Object.assign({}, card, { n, u, note });
  });
}
function imCardsHtml(cards, filter) {
  return cards.map(card => `<button type="button" class="im-box ${card.cls}${card.n ? '' : ' is-zero'}${filter === card.k ? ' is-on' : ''}" data-im-card="${card.k}"`
    + ` aria-pressed="${filter === card.k}" title="${imEsc(card.tip)} — click to show only these; click again to show all">`
    + `<span class="im-box-l">${imEsc(card.t)}</span><b>${card.n.toLocaleString('en-US')}</b><small>${imEsc(card.note)}</small></button>`).join('');
}
// Sizes landed (tiles measured on screen): the cards follow, at most once a second, without redrawing the list.
let IM_CARDS_T = 0;
function imCardsSoon() {
  if (IM_CARDS_T) return;
  IM_CARDS_T = setTimeout(() => {
    IM_CARDS_T = 0;
    const box = $('imCards');
    const data = IML[$('imBrand').value];
    if (box && data && box.isConnected !== false) box.innerHTML = imCardsHtml(imCardsData(data.items), $('imFilter').value);
  }, 1000);
}

// Does one listing pass the filter picker (`filter`) and the search box (`search`, lower case)? A check filter shows only the listings
// it is really true for (imCheck) — one it cannot be decided for is not shown.
function imKidMatch(item, filter, search) {
  if (search) {
    const hay = [item.sku, item.asin, item.pa, item.psku, item.t, item.c, item.z].join(' ').toLowerCase();
    if (!search.split(/\s+/).every(word => hay.includes(word))) return false;
  }
  if (filter && filter !== 'all' && !imStockOk(item)) return false;                    // problems are marked on children with stock only
  if (IM_PROBLEM_KEYS().includes(filter)) return imProblems(item).includes(filter);   // a card's filter: the listing's problems
  return filter in IM_CHECKS ? imCheck(item, filter) === true : true;
}

/* ============================================================================================
 * 6. LIST: DRAWING — tiles, one row per child, the page
 */

// The key under the cards.
const IM_LEGEND = '<span class="im-bf-key">B<i class="fa-bfd is-g"></i> F<i class="fa-bfd is-r"></i></span> on a picture: B = the picture we sent,'
  + ' F = what shoppers see (green = that picture, red = shoppers see another, ○ = not live yet, – = none) · picture sizes: in the editor';

/** B / F of one slot, the same meaning as the Workspace's: B = what our listing sent (Seller Central), F = what shoppers see.
 *  { b, f } with g (that picture) / r (shoppers see another) / u (not live yet) / n (none); `differs` when F is not B's picture. */
function imBfOf(liveUrl, mineUrl) {
  const b = mineUrl ? 'g' : 'n';
  // the same picture at another size is the same picture; a picture of ours that cannot be compared (not on Amazon's servers yet) is 'u'
  const same = imSamePic(liveUrl, mineUrl);
  const f = !liveUrl ? (mineUrl ? 'u' : 'n') : (!mineUrl || same === true ? 'g' : same === false ? 'r' : 'u');
  return { b, f, differs: b + f !== 'gg' && b + f !== 'nn' };
}
const IM_BF_TIP = { gg: 'Shoppers see the picture we sent', gr: 'We sent a picture; shoppers see another one in this slot', gu: 'We sent this picture; it is not live yet',
  ng: 'Shoppers see a picture our listing did not send (from the family or another contributor)' };
const imBfDot = s => (s === 'n' ? '<span class="fa-bfn" aria-hidden="true">–</span>' : `<i class="fa-bfd is-${s}" aria-hidden="true"></i>`);

// One thumbnail in a listing's strip; `sw` marks the swatch tile. B / F shows when what shoppers see is not the picture we sent (the
// .im-diff class — the old orange ring — is still set underneath); hover offers "Copy this picture". No size dot: a picture's size is
// information only, shown in the editor.
// ext (a child's row only — the strip that can be rearranged, 6b): { changed (a draft slot), note (where its picture came from), paste (a
// picture is copied: "Paste here") } — the picture can be dragged, an empty slot is a place to drop.
function imTile(slot, liveUrl, mineUrl, sw, sku, seq, ext) {
  const tile = imTileA(slot, liveUrl, mineUrl, sw);
  const url = IML_VIEW === 'live' ? (liveUrl || mineUrl) : (mineUrl || liveUrl);
  // seq: the family-order dot's words (imSeqFamily) — one small red dot right under the tile, its words on hover
  const dot = seq ? `<i class="im-seq" role="img" aria-label="${imEsc(seq)}" title="${imEsc(seq)}"></i>` : '';
  const edit = !!(ext && sku && !sw);
  const chg = edit && ext.changed ? `<span class="im-tchg" title="${imEsc((ext.note || (url ? 'Changed' : 'Emptied')) + ' — not sent yet')}">changed</span>` : '';
  const paste = edit && ext.paste ? `<button type="button" class="im-tpaste" data-paste-one="${imEsc(sku)}" data-slot="${slot}" title="Put the copied picture in ${slot === 'MAIN' ? 'MAIN' : slot} (not sent until Send)">Paste here</button>` : '';
  const wcls = (edit && ext.changed ? ' is-chg' : '') + (edit && IM_KSEL && IM_KSEL.sku === sku && IM_KSEL.slot === slot ? ' is-ksel' : '');
  if (!url) {
    if (edit) return `<span class="im-tw is-empty${wcls}" data-sku="${imEsc(sku)}" data-slot="${slot}">${tile}${chg}${paste}${dot}</span>`;
    return dot ? `<span class="im-tw">${tile}${dot}</span>` : tile;
  }
  const bf = imBfOf(liveUrl, mineUrl);
  // The swatch has no B / F: Amazon's catalogue never returns a swatch, so F would read 'not live' on every one.
  const tag = sw ? '' : `<span class="im-bf${bf.differs ? ' is-diff' : ''}" title="${imEsc((IM_BF_TIP[bf.b + bf.f] || '') + ' · B = the picture we sent, F = what shoppers see')}">B${imBfDot(bf.b)}F${imBfDot(bf.f)}</span>`;
  const name = slot === 'SWCH' ? 'the swatch' : slot;
  const copy = sku ? `<button type="button" class="im-tcopy" data-copy1="${imEsc(sku)}" data-slot="${slot}" data-url="${imEsc(url)}" title="Copy this picture (${name}) to the clipboard">Copy</button>` : '';
  // Hover: View (the large viewer) · Copy · Replace (choose a file; the editor opens and uploads it into this slot, same picture rules).
  // Replace: a small menu (a picture from this listing / from a sibling / Upload from computer — the last exactly as before) — 6b
  const acts = sku ? `<span class="im-tact"><button type="button" class="im-tview" data-view="${imEsc(sku)}" data-slot="${slot}" title="See ${name} large">View</button>${copy}`
    + `<button type="button" class="im-trepl" data-repl="${imEsc(sku)}" data-slot="${slot}" aria-haspopup="menu" title="Replace ${name}: a picture from this listing, from a sibling, or upload one from your computer">Replace</button></span>` : '';
  return `<span class="im-tw${sw ? ' im-tw-sw' : ''}${wcls}"${sku ? ` data-sku="${imEsc(sku)}" data-slot="${slot}"` : ''}${edit ? ' data-drag="1"' : ''}>${tile}${tag}${acts}${chg}${paste}${dot}</span>`;
}
function imTileA(slot, liveUrl, mineUrl, sw) {
  /* THE TILE SHOWS YOUR OWN PICTURE BY DEFAULT. Amazon's catalogue often serves another child's
   * pictures on a listing that has no offer of its own, so a live-first strip drew green tablecloths
   * under a Pink Coral SKU. The orange ring still says the two disagree; the view picker swaps them. */
  const url = IML_VIEW === 'live' ? (liveUrl || mineUrl) : (mineUrl || liveUrl);
  const diff = imSamePic(liveUrl, mineUrl) === false;
  const label = slot === 'SWCH' ? 'SW' : slot === 'MAIN' ? 'M' : slot.slice(2);
  if (!url) return `<div class="im-th im-empty${sw ? ' im-sw' : ''}" title="${slot}: empty">${label}</div>`;
  const tip = sw ? (url ? 'Swatch — from your listing (Amazon\'s catalogue does not return swatches)' : 'Swatch: none in your listing') : slot + (diff ? ' — Amazon is serving a different picture in this slot' : '')
    + (!liveUrl && mineUrl ? ' — from your listing, not live yet' : '')
    + (liveUrl && !mineUrl ? ' — live on Amazon, not in your listing' : '');
  return `<a class="im-th${diff ? ' im-diff' : ''}${sw ? ' im-sw' : ''}" href="${imEsc(url)}" target="_blank" rel="noopener" draggable="false" title="${imEsc(tip)}">`
    + `<img src="${imEsc(imThumbL(url))}" loading="lazy" decoding="async" draggable="false" alt="${slot}">${sw ? '' : `<i>${label}</i>`}</a>`;
}

/** THE ROW'S CHIPS: one per problem (imProblems — the very list the cards count and the sheet writes), the worst first, and "Not buyable"
 *  when it is; a listing with none shows its Amazon status ("Buyable"). [{ k, t, cls, tip }] */
const IM_CHIP_ORDER = ['amzerr', 'sup', 'nobuy', 'nomain', 'pcbad', 'few'];
function imKidChips(item, brand) {
  if (!imStockOk(item, brand)) return [{ k: '', t: 'No stock', cls: '', tip: 'No FBA units — picture problems are shown for children with stock only' }];
  const state = imState(item, brand);
  const probs = imProblems(item, brand);
  const has = k => (k === 'nobuy' ? state.k === 'nobuy' : probs.includes(k));
  const chip = k => {
    if (k === 'amzerr') { const errs = imPicErrs(item); return { t: errs.length > 1 ? errs.length + ' Amazon picture errors' : 'Amazon picture error', cls: 'is-bad', tip: errs.map(imPicErrText).join(' · ') }; }
    if (k === 'sup') return { t: state.label, cls: 'is-bad', tip: state.why === 'buyable by direct link, not in search' ? 'Amazon still allows a direct-link sale but has taken this listing out of search results.' : 'Suppressed — ' + state.why };
    if (k === 'nobuy') return { t: 'Not buyable', cls: 'is-bad', tip: 'Not buyable — ' + state.why };
    if (k === 'nomain') return { t: 'No main at all', cls: 'is-bad', tip: 'No main picture: none sent by us and none shown to shoppers' };
    if (k === 'pcbad') return { t: 'Main not OK', cls: 'is-bad', tip: 'A person marked the main picture Not OK in the Picture check' };
    return { t: 'Fewer than 7', cls: 'is-att', tip: `${imPicCount(item).n} pictures (MAIN + PT01–PT08)` };
  };
  const out = IM_CHIP_ORDER.filter(has).map(k => Object.assign({ k }, chip(k)));
  return out.length ? out : [{ k: '', t: state.label, cls: state.k === 'ok' ? 'is-ok' : '', tip: '' }];
}
/** The row's first chip (the worst thing about it, else its Amazon status): { k, t, cls, tip }. */
const imKidChip = item => imKidChips(item)[0];
/** "9/9 pictures · not checked: picture count" — the pictures the tiles show (the view picker's choice; the swatch is not a picture),
 *  and the checks that cannot be decided for it. */
function imKidSummary(item) {
  const live = item.live || {};
  const img = item.img || {};
  const urls = IM_SLOTS.map(slot => (IML_VIEW === 'live' ? (live[slot] || img[slot]) : (img[slot] || live[slot]))).filter(Boolean);
  const nc = imStockOk(item) ? imUnchecked(item) : [];
  return `${urls.length}/9 pictures`
    + (nc.length ? ` · <span class="im-nc" title="These could not be decided from the data held, so they are not counted as a problem">not checked: ${imEsc(nc.join(', '))}</span>` : '');
}
/** Does this listing need picture work? (any card's problem but suppression, which is not a picture problem by itself) */
const IM_NEEDS = ['amzerr', 'nomain', 'pcbad', 'few'];
const imNeeds = item => imMarks(item).some(k => IM_NEEDS.includes(k));

// One child listing's row: tick · SKU · colour · size · one status chip · quality summary · actions, then the strip of tiles.
function imKidRow(item) {
  const live = item.live || {};
  const img = item.img || {};
  const draft = IM_DRAFT.get(item.sku) || null;     // moves / swaps / pastes not sent yet (6b)
  const seq = draft ? {} : (IM_SEQ.get(item.sku) || {});   // the family-order dots (children with stock only) — about what is saved, so not on a draft
  const paste = imOneFits(item);
  const tiles = IM_SLOTS.map(slot => (draft && (draft.now[slot] || '') !== (draft.base[slot] || '')
    ? imTile(slot, '', draft.now[slot] || '', false, item.sku, '', { changed: true, note: draft.note[slot], paste })
    : imTile(slot, live[slot], img[slot], false, item.sku, seq[slot], { paste }))).join('')
    + '<span class="im-strip-gap"></span>' + imTile('SWCH', live.SWCH, img.SWCH, true, item.sku);
  const nDraft = draft ? Object.keys(imDraftDiff(item.sku)).length : 0;
  const match = !draft && IM_SEQ.has(item.sku) && imSeqTarget(item);
  const chips = imKidChips(item);
  const errs = imStockOk(item) ? imPicErrs(item) : [];
  const open = IM && IM.sku === item.sku && $('imEditWrap') && !$('imEditWrap').classList.contains('hide');
  const qty = imStockKnown() ? imStockOf(item) : undefined;
  const stock = qty === undefined ? '' : `<span class="im-stock${qty > 0 ? '' : ' is-zero'}" title="FBA stock (units), from Listing Health's snapshot">${qty == null ? 'stock —' : Number(qty).toLocaleString('en-US') + ' unit' + (Number(qty) === 1 ? '' : 's')}</span>`;
  return `<div class="im-kid${open ? ' is-open' : ''}${Object.keys(seq).length ? ' has-seq' : ''}${draft ? ' has-draft' : ''}" data-sku="${imEsc(item.sku)}">
    <label class="im-kid-sel" title="Tick to paste into this listing (Shift+click ticks a range)"><input type="checkbox" class="im-sel" data-sku="${imEsc(item.sku)}" ${IM_SEL.has(item.sku) ? 'checked' : ''} aria-label="Tick ${imEsc(item.sku)}"></label>
    <div class="im-kid-info">
      <div class="im-kid-t"><b class="im-mono">${imEsc(item.sku)}</b>${item.lmStale && typeof lmOldHtml === 'function' ? lmOldHtml($('imBrand') ? $('imBrand').value : '', item.sku) : ''}<span class="muted">${imEsc(item.asin)}</span></div>
      <div class="im-kid-s">${imEsc([item.c, item.z].filter(Boolean).join(' · ') || String(item.t || '').slice(0, 60))}${stock}</div>
      <div class="im-kid-q">${typeof prOf === 'function' && imMarks(item).length ? prChipHtml(prIm($('imBrand') ? $('imBrand').value : '', item), 'im-chip') : ''}${chips.map(chip => `<span class="im-chip ${chip.cls}"${chip.k ? ` data-im-prob="${chip.k}"` : ''}${chip.tip ? ` title="${imEsc(chip.tip)}"` : ''}>${imEsc(chip.t)}</span>`).join('')}<span class="im-kid-sum">${imKidSummary(item)}</span></div>
      ${errs.length ? `<div class="im-kid-err" title="${imEsc(errs.map(imPicErrText).join(' · '))}">${imEsc(errs.map(imPicErrText).join(' · '))}</div>` : ''}
      <div class="im-kid-act">
        <button class="ghost im-b" data-edit="${imEsc(item.sku)}" title="Open the editor beside the list (E)">Edit</button>
        <button class="ghost im-b" data-copy="${imEsc(item.sku)}" title="Copy this listing's pictures (the ones we sent; a slot we never sent takes what shoppers see) (C)">Copy all</button>
        <button class="ghost im-b" data-copy="${imEsc(item.sku)}" data-copy-live="1" title="Copy what shoppers see on this listing (Amazon's catalogue), not the pictures we sent">Copy live</button>
        ${IM_CLIP ? `<button class="ghost im-b" data-paste1="${imEsc(item.sku)}" title="Paste the clipboard's ticked slots into this listing (a preview first)">Paste here</button>` : ''}
        ${match ? `<button class="ghost im-b im-match" data-match="${imEsc(item.sku)}" title="Put this listing's own pictures in the family's order (nothing deleted) — a before → after preview, then Send">Match family order</button>` : ''}</div>
      ${draft ? `<div class="im-draft" role="status"><b>${nDraft} change${nDraft === 1 ? '' : 's'}</b> — not sent
        <button type="button" class="ghost im-b" data-dr="undo" data-sku="${imEsc(item.sku)}" title="Undo the last move">Undo</button>
        <button type="button" class="ghost im-b" data-dr="discard" data-sku="${imEsc(item.sku)}" title="Back to the pictures as they are">Discard changes</button>
        <button type="button" class="im-b im-go" data-dr="send" data-sku="${imEsc(item.sku)}" title="A before → after preview, then Amazon checks it before anything is sent">Send…</button></div>` : ''}
    </div>
    <div class="im-strip">${tiles}</div>
  </div>`;
}

/* ============================================================================================
 * 6b. REARRANGING A LISTING'S PICTURES IN THE LIST (24 Nov 2026) — a DRAFT on screen; nothing reaches Amazon until the row's Send.
 *   - DRAG a picture onto another slot of the same listing (MAIN, 01–08): onto a picture → the two SWAP; onto an empty slot → it MOVES
 *     there and its old slot is emptied. The lifted picture follows the pointer, the slot under it says "Swap" / "Move here", Esc
 *     cancels. Mouse; touch (hold a moment, then drag — a quick swipe still scrolls); keys: Space on a picture picks it up, ← → move it,
 *     Space / Enter puts it down, Esc puts it back.
 *   - COPY (a picture's Copy, as before — it also goes into the clipboard) → each slot of that listing and of its siblings shows "Paste
 *     here"; the bar says "1 picture copied · Esc to cancel". A filled slot is replaced; its old picture stays in the draft's Undo.
 *   - REPLACE is a small menu: a picture from this listing, a picture from a sibling, or Upload from computer (imReplace, unchanged).
 *   - MATCH FAMILY ORDER (a child with order dots): its own pictures put in the family's order (imSeqTarget) — moved, never deleted —
 *     then the before → after preview.
 *   - SEND → the before → after preview of all nine slots → THE ONE SEND PATH (sqSendWithCheck: Amazon checks first, the person
 *     approves; each change logged in Listing History with the old picture and the slot it came from, so Put back can undo it; the
 *     test site / a local copy: "not sent").
 *   - MAIN must be this product's own photo on white: a picture that is not a main picture of the family (a size chart, care guide,
 *     lifestyle photo) is asked about before it goes into MAIN.
 * A slot's picture is ours, else what Amazon serves (as the tile shows it); the swatch is not moved. Drafts live while the page is open.
 * ============================================================================================ */
const IM_DRAFT = new Map();     // sku → { base: { slot: url } (the strip as it was), now, steps: [earlier { now, note }], note: { slot: where it came from } }
let IM_ONE = null;              // one copied picture (a tile's Copy): { sku, psku, slot, url }
let IM_LD = null;               // a drag going on: { sku, from, el, x0, y0, on, ghost, target, touch, timer }
let IM_LD_END = 0;              // when the last drag ended (its click must not open the viewer)
let IM_KSEL = null;             // a picture picked up with the keys: { sku, slot, start (the draft before) }
let IM_MENU = null;             // the open Replace menu: { sku, slot }
let IM_MAINQ = null;            // a change waiting for "Put it in MAIN anyway": { sku, next, notes }
let IM_DPV = null;              // the before → after preview open: { sku }
const imPicOf = (item, slot) => (item.img || {})[slot] || (item.live || {})[slot] || '';
const imDraftBase = item => Object.fromEntries(IM_SLOTS.map(slot => [slot, imPicOf(item, slot)]));
/** The listing's slots as the strip shows them now: its draft, else its pictures. */
const imNowOf = item => (IM_DRAFT.has(item.sku) ? IM_DRAFT.get(item.sku).now : imDraftBase(item));
/** The listing and its siblings (the children of its parent); a listing with no parent: itself. */
function imFamilyOf(item) {
  const items = (IML[$('imBrand').value] || { items: [] }).items || [];
  return item && item.psku ? items.filter(x => x && x.lvl !== 'parent' && x.psku === item.psku) : (item ? [item] : []);
}
/** The slots a listing's draft changes: { slot: the new picture, '' = emptied }. */
function imDraftDiff(sku) {
  const d = IM_DRAFT.get(sku);
  const out = {};
  if (d) IM_SLOTS.forEach(slot => { if ((d.now[slot] || '') !== (d.base[slot] || '')) out[slot] = d.now[slot] || ''; });
  return out;
}
/** One change to a listing's draft: `next` = { slot: picture } after it, `notes` = { slot: where its picture came from }. The step before
 *  is kept for Undo; a draft back to the pictures as they are is no draft. Only the strip is drawn again. */
function imDraftSet(sku, next, notes) {
  const item = imItem(sku);
  if (!item) return false;
  const d = IM_DRAFT.get(sku) || { base: imDraftBase(item), now: imDraftBase(item), steps: [], note: {} };
  d.steps.push({ now: Object.assign({}, d.now), note: Object.assign({}, d.note) });
  d.now = Object.assign({}, d.now, next);
  d.note = Object.assign({}, d.note, notes || {});
  IM_SLOTS.forEach(slot => { if ((d.now[slot] || '') === (d.base[slot] || '')) delete d.note[slot]; });
  IM_DRAFT.set(sku, d);
  if (!Object.keys(imDraftDiff(sku)).length) IM_DRAFT.delete(sku);
  imRowRedraw(sku);
  return true;
}
function imDraftUndo(sku) {
  const d = IM_DRAFT.get(sku);
  if (!d || !d.steps.length) return false;
  const step = d.steps.pop();
  d.now = step.now;
  d.note = step.note;
  if (!Object.keys(imDraftDiff(sku)).length) IM_DRAFT.delete(sku);
  imRowRedraw(sku);
  return true;
}
function imDraftDiscard(sku) {
  IM_DRAFT.delete(sku);
  imRowRedraw(sku);
}
/** Draw one child's row again (a draft changed): only that row, wired again; the list does not move. */
function imRowRedraw(sku) {
  const list = $('imList');
  const item = imItem(sku);
  const row = list && list.querySelector && item ? list.querySelector(`.im-kid[data-sku="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(sku) : sku}"]`) : null;
  if (!row || !row.replaceWith || typeof document === 'undefined' || !document.createElement) return;
  const box = document.createElement('div');
  box.innerHTML = imKidRow(item);
  const fresh = box.firstElementChild;
  row.replaceWith(fresh);
  imRowsWire(fresh);
  if (typeof imqWatch === 'function') imqWatch(fresh);
}
/** MAIN must be this product's own photo on a pure white background: '' when the picture is a main picture of the family already (this
 *  listing's or a sibling's), else the warning in words — where else it is, and on how many listings (a shared picture: a size chart,
 *  a care guide, a lifestyle photo). */
function imMainWarn(sku, url) {
  const item = imItem(sku);
  if (!item || !url) return '';
  const id = imqId(url);
  const fam = imFamilyOf(item);
  if (fam.some(kid => imSeqPic(kid, 'MAIN') === id) || imSeqPic(item, 'MAIN') === id) return '';
  const where = [];
  fam.forEach(kid => IM_SLOTS.forEach(slot => { if (imSeqPic(kid, slot) === id) where.push(kid.sku === sku ? slot : `${slot} of ${kid.sku}`); }));
  const n = fam.filter(kid => IM_SLOTS.some(slot => imSeqPic(kid, slot) === id)).length;
  return 'MAIN must be this product\'s own photo on a pure white background.'
    + (n >= 2 ? ` This picture is on ${n} listings of the family — a size chart, care guide or lifestyle photo?` : ' This picture is not a main picture.')
    + (where.length ? ` It is in ${where.slice(0, 3).join(', ')}${where.length > 3 ? '…' : ''} now.` : '');
}
const imMainHtml = (warn, url) => `<div class="im-pv im-mainq" role="alertdialog" aria-label="Put this picture in MAIN?"><div class="im-pv-top"><b>Put this picture in MAIN?</b>`
  + `<span class="muted">${imEsc(warn)}</span></div><div class="im-pv-list"><span class="im-pv-pic is-new"><img src="${imEsc(imThumb(url))}" alt=""></span></div>`
  + `<div class="im-pv-foot"><button class="ghost im-b" data-im-mainq="no">Cancel</button><button class="im-b im-go" data-im-mainq="yes">Put it in MAIN anyway</button></div></div>`;
/** Make a change, asking first when a picture that is not a main picture would go into MAIN. → true (made) | 'ask' (asked) | false. */
function imMainAsk(sku, next, notes, confirmed) {
  const warn = next.MAIN ? imMainWarn(sku, next.MAIN) : '';
  if (warn && !confirmed) {
    IM_MAINQ = { sku, next, notes };
    imModal(imMainHtml(warn, next.MAIN));
    return 'ask';
  }
  return imDraftSet(sku, next, notes);
}
/** Move the picture of slot `from` onto slot `to` of the same listing: a picture there → they swap; an empty slot → it moves (`from` is
 *  emptied). → true | 'ask' | false. */
function imMove(sku, from, to, confirmed) {
  if (!sku || from === to || !IM_SLOTS.includes(from) || !IM_SLOTS.includes(to)) return false;
  const item = imItem(sku);
  if (!item) return false;
  const now = imNowOf(item);
  const a = now[from] || '';
  const b = now[to] || '';
  if (!a) return false;
  const notes = { [to]: 'from ' + from };
  if (b) notes[from] = 'from ' + to;
  return imMainAsk(sku, { [to]: a, [from]: b }, notes, confirmed);
}
/* ----- one copied picture → "Paste here" ----- */
function imOneCopy(item, slot, url) {
  if (!item || !url || !IM_SLOTS.includes(slot)) return;
  IM_ONE = { sku: item.sku, psku: item.psku || '', slot, url };
}
/** Can this listing take the copied picture? The listing it came from, or a sibling (the same parent). */
const imOneFits = item => !!(IM_ONE && item && (item.sku === IM_ONE.sku || (IM_ONE.psku && item.psku === IM_ONE.psku)));
function imPasteOne(sku, slot, confirmed) {
  const item = imItem(sku);
  if (!item || !imOneFits(item) || !IM_SLOTS.includes(slot)) return false;
  if ((imNowOf(item)[slot] || '') === IM_ONE.url) return false;
  return imMainAsk(sku, { [slot]: IM_ONE.url }, { [slot]: 'copy of ' + IM_ONE.slot + (IM_ONE.sku === sku ? '' : ' of ' + IM_ONE.sku) }, confirmed);
}
function imOneClear() {
  if (!IM_ONE) return false;
  IM_ONE = null;
  imListRender();
  return true;
}
const imOneBarHtml = () => (IM_ONE ? `<div class="im-onebar" id="imOneBar" role="status"><span class="im-onebar-pic"><img src="${imEsc(imThumb(IM_ONE.url))}" alt=""></span>`
  + `<span><b>1 picture copied</b> · ${imEsc(IM_ONE.slot)} of <span class="im-mono">${imEsc(IM_ONE.sku)}</span> · “Paste here” on any slot of this listing or its siblings · Esc to cancel</span>`
  + `<button type="button" class="ghost im-b" data-one-clear="1">Cancel</button></div>` : '');
/* ----- Replace: the small menu ----- */
/** The menu's pictures: this listing's other slots (as the strip shows them now), and the siblings' pictures (each picture once). */
function imReplPicks(sku, slot) {
  const item = imItem(sku);
  if (!item) return { own: [], sib: [] };
  const now = imNowOf(item);
  const own = IM_SLOTS.filter(each => each !== slot && now[each]).map(each => ({ sku, slot: each, url: now[each], c: item.c }));
  const seen = new Set(own.map(p => imqId(p.url)).concat(now[slot] ? [imqId(now[slot])] : []));
  const sib = [];
  imFamilyOf(item).filter(kid => kid.sku !== sku).forEach(kid => IM_SLOTS.forEach(each => {
    const url = imPicOf(kid, each);
    if (!url || seen.has(imqId(url))) return;
    seen.add(imqId(url));
    sib.push({ sku: kid.sku, slot: each, url, c: kid.c });
  }));
  return { own, sib };
}
function imReplMenuHtml(sku, slot) {
  const { own, sib } = imReplPicks(sku, slot);
  const pick = p => `<button type="button" class="im-rm-pic" role="menuitem" data-rm-use="${imEsc(p.url)}" data-rm-note="${imEsc(p.sku === sku ? 'copy of ' + p.slot : p.slot + ' of ' + p.sku)}"`
    + ` title="${imEsc((p.sku === sku ? '' : p.sku + ' · ') + p.slot)}"><img src="${imEsc(imThumbL(p.url))}" alt="${imEsc(p.slot)}" loading="lazy" draggable="false"><small>${imEsc(p.sku === sku ? p.slot : (p.c || p.sku) + ' · ' + p.slot)}</small></button>`;
  return `<div class="im-rm" id="imRmenu" role="menu" aria-label="Replace ${imEsc(slot)}" data-sku="${imEsc(sku)}" data-slot="${slot}">`
    + `<div class="im-rm-h">Replace <b>${imEsc(slot)}</b> of <span class="im-mono">${imEsc(sku)}</span></div>`
    + `<details class="im-rm-sec" data-rm-sec="own"><summary>Use a picture from this listing <span class="muted">(${own.length})</span></summary><div class="im-rm-grid">${own.map(pick).join('') || '<span class="muted">No other picture on this listing.</span>'}</div></details>`
    + `<details class="im-rm-sec" data-rm-sec="sib"><summary>Use a picture from a sibling <span class="muted">(${sib.length})</span></summary><div class="im-rm-grid">${sib.map(pick).join('') || '<span class="muted">No sibling pictures.</span>'}</div></details>`
    + `<button type="button" class="im-rm-up" role="menuitem" data-rm-upload="1">Upload from computer…</button>`
    + '<div class="im-rm-note muted">Nothing is sent until Send.</div></div>';
}
function imReplMenuClose() {
  IM_MENU = null;
  const old = typeof document !== 'undefined' && document.getElementById ? document.getElementById('imRmenu') : null;
  if (old && old.remove) old.remove();
}
/** Open the Replace menu under a tile's Replace button (fixed on the page, kept inside the window). */
function imReplMenu(btn, sku, slot) {
  imReplMenuClose();
  IM_MENU = { sku, slot };
  if (typeof document === 'undefined' || !document.body || !document.body.insertAdjacentHTML) return;
  document.body.insertAdjacentHTML('beforeend', imReplMenuHtml(sku, slot));
  const menu = document.getElementById('imRmenu');
  const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 20, top: 60, bottom: 80 };
  // Below the button when it fits, else above it — always wholly inside the window (the menu is fixed: the page cannot scroll it into
  // view). A section opened or closed changes its height: placed again.
  const place = () => {
    const w = Math.min(320, window.innerWidth - 24);
    const h = menu.offsetHeight || 0;
    const below = r.bottom + 6, above = r.top - 6 - h;
    const top = below + h <= window.innerHeight - 12 ? below : above >= 12 ? above : Math.max(12, window.innerHeight - 12 - h);
    menu.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - 8)) + 'px';
    menu.style.top = Math.round(top) + 'px';
  };
  place();
  menu.addEventListener('toggle', place, true);
  const first = menu.querySelector('summary');
  if (first && first.focus) first.focus();
}
/** A choice in the Replace menu: a picture (url + where it came from) into the slot, or Upload from computer (today's Replace). */
function imReplPick(choice) {
  const m = IM_MENU;
  if (!m) return false;
  imReplMenuClose();
  if (choice.upload) return imReplace(m.sku, m.slot);                     // exactly as before: the file chooser, the editor, imUpload
  if (!choice.url) return false;
  return imMainAsk(m.sku, { [m.slot]: choice.url }, { [m.slot]: choice.note || 'replaced' });
}
/* ----- Match family order ----- */
/** A child's pictures in its family's order: shared pictures in their normal slot, its own photos in the family's own-photo slots in
 *  turn, anything else in its own slot when free, else the first free one — the same pictures, none deleted. { slot: url } or null (no
 *  family order: fewer than 2 children with stock). */
function imSeqTarget(item) {
  const fam = imFamilyOf(item).filter(kid => imStockOk(kid));
  if (!fam.some(kid => kid.sku === item.sku)) return null;
  if (fam.length < 2) return null;
  const pat = imSeqPattern(fam);
  const now = imNowOf(item);
  const pics = IM_SLOTS.filter(slot => now[slot]).map(slot => ({ slot, url: now[slot], id: imqId(now[slot]) }));
  const out = {};
  const done = new Set();
  const free = slot => !out[slot];
  pics.forEach((p, i) => { const h = pat.shared(p.id) ? pat.home.get(p.id) : null; if (h && free(h)) { out[h] = p.url; done.add(i); } });
  let k = 0;
  pics.forEach((p, i) => {
    if (done.has(i) || pat.shared(p.id)) return;
    while (k < pat.ownSlots.length && !free(pat.ownSlots[k])) k++;
    if (k < pat.ownSlots.length) { out[pat.ownSlots[k++]] = p.url; done.add(i); }
  });
  pics.forEach((p, i) => { if (done.has(i)) return; out[free(p.slot) ? p.slot : IM_SLOTS.find(free)] = p.url; });
  const target = Object.fromEntries(IM_SLOTS.map(slot => [slot, out[slot] || '']));
  return IM_SLOTS.some(slot => (target[slot] || '') !== (now[slot] || '')) ? target : null;
}
/** "Match family order": the draft takes the family's order, then the before → after preview opens. */
function imMatchFamily(sku) {
  const item = imItem(sku);
  const target = item && imSeqTarget(item);
  if (!target) { imMsg('This listing already follows its family\'s order.'); return false; }
  const now = imNowOf(item);
  const next = {};
  const notes = {};
  IM_SLOTS.forEach(slot => {
    if ((target[slot] || '') === (now[slot] || '')) return;
    next[slot] = target[slot];
    const from = target[slot] ? IM_SLOTS.find(each => now[each] === target[slot]) : '';
    if (from) notes[slot] = 'from ' + from + ' (family order)';
  });
  imDraftSet(sku, next, notes);
  return imDraftPreview(sku);
}
/* ----- Send: the before → after preview, then THE ONE SEND PATH ----- */
/** The send of a listing's draft: only the slots that differ from what OUR listing holds (a picture only Amazon's catalogue shows is not
 *  ours to empty). Each change names the slot its picture came from (Listing History: old → new). null when nothing would change. */
function imDraftJob(sku) {
  const item = imItem(sku);
  const d = IM_DRAFT.get(sku);
  if (!item || !d) return null;
  const img = item.img || {};
  const set = {};
  Object.entries(imDraftDiff(sku)).forEach(([slot, url]) => { if ((url || '') !== (img[slot] || '')) set[slot] = url || ''; });
  if (!Object.keys(set).length) return null;
  const brand = $('imBrand').value;
  return { brand, sku, asin: item.asin || '', label: [item.c, item.z].filter(Boolean).join(' · ') || sku, row: item,
    body: { limg: 'patch', brand, sku, productType: item.pt, set },
    changes: Object.keys(set).map(slot => ({ field: sqField(slot) + (d.note[slot] ? ' (' + d.note[slot] + ')' : ''), old: img[slot] || '(none)', new: set[slot] || '(removed)', pic: true, attr: slot, oldV: img[slot] || '' })) };
}
function imDraftPreviewHtml(sku) {
  const item = imItem(sku);
  const d = IM_DRAFT.get(sku);
  if (!item || !d) return '';
  const diff = imDraftDiff(sku);
  const job = imDraftJob(sku);
  const pic = (url, cls) => (url ? `<span class="im-pv-pic${cls || ''}"><img src="${imEsc(imThumb(url))}" alt="" loading="lazy"></span>` : '<span class="im-pv-pic is-none">empty</span>');
  const warnMain = 'MAIN' in diff ? imMainWarn(sku, diff.MAIN) : '';
  const rows = IM_SLOTS.map(slot => {
    const ch = slot in diff;
    const catalogOnly = ch && !d.now[slot] && !(item.img || {})[slot];
    return `<div class="im-pv-row${ch ? '' : ' is-same'}"><b class="im-pv-slot">${slot === 'MAIN' ? 'Main' : slot}</b>${pic(d.base[slot])}<span class="im-pv-arrow" aria-hidden="true">→</span>${pic(d.now[slot], ch ? ' is-new' : '')}`
      + `<span class="im-pv-q">${ch ? imEsc(d.note[slot] || (d.now[slot] ? 'replaced' : 'emptied')) : '<span class="muted">same</span>'}`
      + (slot === 'MAIN' && warnMain ? `<span class="err" style="display:block">${imEsc(warnMain)}</span>` : '')
      + (catalogOnly ? '<span class="muted" style="display:block">Shown from Amazon\'s catalogue, not your listing — emptying it here may not remove it.</span>' : '') + '</span></div>';
  }).join('');
  const n = job ? Object.keys(job.body.set).length : 0;
  return `<div class="im-pv" role="document"><div class="im-pv-top"><b>Before → after · <span class="im-mono">${imEsc(sku)}</span></b>`
    + `<span class="muted">${imEsc([item.c, item.z].filter(Boolean).join(' · '))} · ${n} slot${n === 1 ? '' : 's'} change. Nothing is sent yet: Amazon checks it first, then you approve.</span>`
    + (!item.pt ? '<div class="err" style="font-size:12px;margin-top:4px">No product type in the snapshot for this listing — open it in the editor (Edit) and send from there.</div>' : '') + '</div>'
    + `<div class="im-pv-list"><div class="im-pv-l"><div class="im-pv-rows">${rows}</div></div></div>`
    + `<div class="im-pv-foot"><button class="ghost im-b" data-im-dpv="cancel">Back to the list</button>`
    + `<button class="im-b im-go" data-im-dpv="go" ${n && item.pt ? '' : 'disabled'}>Continue to the Amazon check (${n})</button></div></div>`;
}
function imDraftPreview(sku) {
  if (!IM_DRAFT.has(sku)) return false;
  IM_DPV = { sku };
  imModal(imDraftPreviewHtml(sku));
  return true;
}
/** "Continue": THE ONE SEND PATH — Amazon checks, the person approves, it is sent (live only; the test site: not sent) and logged. */
function imDraftSend(sku) {
  IM_DPV = null;
  const job = imDraftJob(sku);
  if (!job || !job.row.pt || typeof sqSendWithCheck !== 'function') { imModal(''); return false; }
  return sqSendWithCheck([job], { screen: 'Image Manager', title: 'Image Manager · move pictures · ' + sku,
    onSent: sent => {
      const img = Object.assign({}, sent.row.img || {});
      Object.entries(sent.body.set).forEach(([slot, url]) => { if (url) img[slot] = url; else delete img[slot]; });
      sent.row.img = img;                                   // what was sent, so the strip shows it
      IM_DRAFT.delete(sent.sku);
      IML_DIRTY = true;
    },
    onDone: () => imListRender() });
}
/* ----- drag: mouse and touch (pointer events) ----- */
function imDragTarget(x, y) {
  if (!IM_LD || typeof document === 'undefined' || !document.elementFromPoint) return null;
  const el = document.elementFromPoint(x, y);
  const tw = el && el.closest ? el.closest('.im-tw[data-sku][data-slot]') : null;
  return tw && tw.dataset.sku === IM_LD.sku && IM_SLOTS.includes(tw.dataset.slot) && tw.dataset.slot !== IM_LD.from ? tw : null;
}
function imDragStart() {
  const d = IM_LD;
  d.on = true;
  d.el.classList.add('is-lift');
  const img = d.el.querySelector('img');
  d.ghost = document.createElement('div');
  d.ghost.className = 'im-ghost';
  d.ghost.setAttribute('aria-hidden', 'true');
  if (img) d.ghost.innerHTML = `<img src="${imEsc(img.getAttribute('src'))}" alt="">`;
  document.body.appendChild(d.ghost);
  document.body.classList.add('im-dragging');
  imMsg(`Moving ${d.from} of ${d.sku} — drop it on another slot (Esc cancels).`);
}
function imDragMove(e) {
  const d = IM_LD;
  if (!d) return;
  const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
  if (!d.on) {
    if (d.touch) { if (far > 10) imDragEnd(); return; }       // a swipe before the hold: the page scrolls
    if (far < 6) return;
    imDragStart();
  }
  d.ghost.style.left = e.clientX + 'px';
  d.ghost.style.top = e.clientY + 'px';
  const t = imDragTarget(e.clientX, e.clientY);
  if (t !== d.target) {
    if (d.target) { d.target.classList.remove('is-target'); delete d.target.dataset.dropLabel; }
    d.target = t;
    if (t) {
      const now = imNowOf(imItem(d.sku) || {});
      t.dataset.dropLabel = now[t.dataset.slot] ? 'Swap' : 'Move here';
      t.classList.add('is-target');
    }
  }
}
function imDragEnd(drop) {
  const d = IM_LD;
  if (!d) return;
  IM_LD = null;
  clearTimeout(d.timer);
  if (d.ghost && d.ghost.remove) d.ghost.remove();
  if (d.el && d.el.classList) d.el.classList.remove('is-lift');
  if (d.target) { d.target.classList.remove('is-target'); delete d.target.dataset.dropLabel; }
  if (typeof document !== 'undefined' && document.body) document.body.classList.remove('im-dragging');
  if (d.on) {
    IM_LD_END = Date.now();
    imMsg('');
    if (drop && d.target) imMove(d.sku, d.from, d.target.dataset.slot);
  }
}

/* ---------- families: a card per parent, foldable ---------- */
const imGroupKey = group => (group.parent ? group.parent.sku : group.psku || 'solo:' + group.kids[0].sku);
// The family's card header: fold ▾, its main picture, name, parent SKU / ASIN, "N children · N need pictures", Copy main / Select all children.
function imGroupHtml(group) {
  const key = imGroupKey(group);
  const parent = group.parent;
  const first = group.kids[0];
  const need = group.kids.filter(imNeeds).length;
  const folded = !imIsOpen(key);
  const title = parent ? parent.t : group.psku ? 'Parent ' + group.psku : first.t;
  const sub = parent ? `Parent <span class="im-mono">${imEsc(parent.sku)}</span> · ${imEsc(parent.asin)}`
    : group.psku ? `${imEsc(first.pa || '')} · the parent listing itself was not found` : 'No variation parent';
  const thumb = parent ? imTile('MAIN', (parent.live || {}).MAIN, (parent.img || {}).MAIN, false, parent.sku) : imTile('MAIN', (first.live || {}).MAIN, (first.img || {}).MAIN, false, first.sku);
  const famMain = parent && ((parent.img || {}).MAIN || (parent.live || {}).MAIN);
  const head = `<div class="im-grp-h">
      <button type="button" class="im-fold" data-fold="${imEsc(key)}" aria-expanded="${!folded}" title="${folded ? 'Open' : 'Close'} this family">${folded ? '▸' : '▾'}</button>
      ${thumb}
      <div class="im-grp-t"><b title="${imEsc(title)}">${imEsc(title)}</b>
        <span class="muted">${sub} · ${group.kids.length} child${group.kids.length === 1 ? '' : 'ren'}${need ? ` · <b class="is-need">${need} need pictures</b>` : ' · pictures fine'}</span></div>
      <div class="im-grp-act">${famMain ? `<button type="button" class="ghost im-b" data-fammain="${imEsc(key)}" title="Copy the parent's main picture into the clipboard's Main slot">Copy main of this family</button>` : ''}
        <button type="button" class="ghost im-b" data-famsel="${imEsc(key)}" title="Tick every child of this family">Select all children</button></div>
    </div>`;
  return `<div class="card im-grp${folded ? ' is-folded' : ''}" data-grp="${imEsc(key)}">${head}${folded ? '' : imRowsHtml(key, group.show)}</div>`;
}
/** Is this family open? Opened by the person, or matched by a search / filter (or the Listing Health pick) and not closed by the person. */
const imAutoOpen = () => ($('imFilter').value || 'all') !== 'all' || !!($('imQ').value || '').trim() || !!IM_ONLY;
const imIsOpen = key => IM_OPEN.has(key) || (imAutoOpen() && !IM_SHUT.has(key));
const imRowEst = () => (IM_DENSE === 'compact' ? 66 : 112);     // a row's height before it is drawn (then measured)
/* An open family's rows: every one of them, in blocks of IM_CHUNK. A block is an empty box of the right height until it comes near the
 * screen (imChunkFill); a page with no IntersectionObserver (a test page) gets every row at once. */
function imRowsHtml(key, rows) {
  IM_ROWS.set(key, rows);
  if (typeof IntersectionObserver === 'undefined') return rows.map(imKidRow).join('');
  let out = '';
  for (let i = 0; i * IM_CHUNK < rows.length; i++) {
    const n = Math.min(IM_CHUNK, rows.length - i * IM_CHUNK);
    out += `<div class="im-chunk" data-chunk="${imEsc(key)}" data-i="${i}" style="height:${IM_CHUNK_H.get(key + '|' + i) || n * imRowEst()}px"></div>`;
  }
  return out;
}
function imChunkFill(box) {
  const key = box.dataset.chunk;
  const i = Number(box.dataset.i);
  box.innerHTML = (IM_ROWS.get(key) || []).slice(i * IM_CHUNK, (i + 1) * IM_CHUNK).map(imKidRow).join('');
  box.style.height = '';
  box.dataset.on = '1';
  imRowsWire(box);
  imqWatch(box);
  IM_CHUNK_H.set(key + '|' + i, box.offsetHeight);
}
function imChunkEmpty(box) {
  const h = box.offsetHeight;
  IM_CHUNK_H.set(box.dataset.chunk + '|' + box.dataset.i, h);
  box.style.height = h + 'px';
  box.innerHTML = '';
  box.dataset.on = '';
}
// Blocks within 1,500 px of the screen are drawn; the ones that move further away are emptied (their height stays).
function imChunksWatch(root, keep) {
  if (!root || !root.querySelectorAll || typeof IntersectionObserver === 'undefined') return;
  if (!IM_CHUNK_OBS) {
    IM_CHUNK_OBS = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.on) imChunkFill(entry.target);
      else if (!entry.isIntersecting && entry.target.dataset.on) imChunkEmpty(entry.target);
    }), { rootMargin: '1500px 0px' });
  } else if (!keep) IM_CHUNK_OBS.disconnect();
  root.querySelectorAll('.im-chunk').forEach(box => IM_CHUNK_OBS.observe(box));
}
/** Open or close one family. Only its card is drawn again, and its header is kept where it was on the screen (no jump). */
function imFamToggle(key) {
  if (imIsOpen(key)) {
    IM_OPEN.delete(key);
    IM_SHUT.add(key);
  } else {
    IM_OPEN.add(key);
    IM_SHUT.delete(key);
  }
  return imFamRedraw(key);
}
function imFamRedraw(key) {
  const list = $('imList');
  const card = list && list.querySelector ? list.querySelector(`.im-grp[data-grp="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key}"]`) : null;
  const data = IML[$('imBrand').value];
  const group = data && imShownGroups(data.items, $('imFilter').value, ($('imQ').value || '').trim().toLowerCase()).find(each => imGroupKey(each) === key);
  if (!card || !group || !card.replaceWith || typeof document === 'undefined' || !document.createElement) return imListRender();
  const head = card.querySelector('.im-grp-h');
  const before = head && head.getBoundingClientRect ? head.getBoundingClientRect().top : null;
  const box = document.createElement('div');
  box.innerHTML = imGroupHtml(group);
  const fresh = box.firstElementChild;
  card.replaceWith(fresh);
  imRowsWire(fresh);
  imqWatch(fresh);
  imChunksWatch(fresh, true);
  const head2 = fresh.querySelector('.im-grp-h');
  const after = head2 && head2.getBoundingClientRect ? head2.getBoundingClientRect().top : null;
  if (before != null && after != null && Math.abs(after - before) > 0.5 && typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, after - before);
  return fresh;
}
// The list's shape while it is read: two families of grey rows.
function imSkeleton(text) {
  const tiles = Array.from({ length: 9 }, () => '<span class="im-th im-skel"></span>').join('');
  const row = `<div class="im-kid im-skel-row" aria-hidden="true"><span></span><div class="im-kid-info"><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span><span class="sp-skel is-s"></span></div><div class="im-strip">${tiles}</div></div>`;
  return `<div class="im-meta muted" role="status">${imEsc(text)}</div>` + [0, 1].map(() => `<div class="card im-grp"><div class="im-grp-h"><span class="im-th im-skel"></span>`
    + `<div class="im-grp-t"><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div></div>${row.repeat(3)}</div>`).join('');
}

/* ---------- ticking listings: Shift+click ticks a range, "N selected" ---------- */
let IM_LAST_SEL = '';       // the SKU ticked last (the start of a Shift+click range)
/** Shift+click: every SKU from the one ticked last to this one, in the order on screen (just this one when the last is not on screen). */
function imRangeSel(order, last, cur) {
  const i = order.indexOf(last);
  const j = order.indexOf(cur);
  if (i < 0 || j < 0) return [cur];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}
const imSelBarHtml = () => `<b>${IM_SEL.size.toLocaleString('en-US')}</b> selected · copy a listing or a picture to paste into them`
  + ` <button type="button" class="ghost im-b" data-selclear="1">Clear</button>`;
// The ticks changed: the "N selected" bar, the paste button and the quick picks' first line follow (no redraw).
function imSelUpdate() {
  const bar = $('imSelBar');
  if (bar) {
    bar.innerHTML = imSelBarHtml();
    bar.hidden = !IM_SEL.size || !!IM_CLIP;
  }
  const pasteBtn = $('imPasteSel');
  if (pasteBtn) {
    pasteBtn.disabled = !IM_SEL.size;
    pasteBtn.textContent = 'Preview · paste into ' + IM_SEL.size + ' ticked listing(s)';
  }
  const pickBox = $('imPick');
  if (pickBox && pickBox.options && pickBox.options[0]) pickBox.options[0].textContent = 'Ticked listings (' + IM_SEL.size + ')';
}

/* ---------- density: Comfortable / Compact, remembered in this browser ---------- */
const IM_DENSE_KEY = 'sellora.imgdensity';
let IM_DENSE = 'comfortable';
try { IM_DENSE = localStorage.getItem(IM_DENSE_KEY) === 'compact' ? 'compact' : 'comfortable'; } catch (e) { /* no storage */ }
function imDensity(v, keep) {
  IM_DENSE = v === 'compact' ? 'compact' : 'comfortable';
  if (!keep) {
    try { localStorage.setItem(IM_DENSE_KEY, IM_DENSE); } catch (e) { /* a private window: this visit only */ }
  }
  const pane = $('paneImg');
  if (pane && pane.classList) pane.classList.toggle('im-compact', IM_DENSE === 'compact');
  if (!keep) {
    IM_CHUNK_H.clear();                // rows change height: the blocks are measured again
    if (IML[$('imBrand').value]) imListRender();
  }
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll('[data-im-dense]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.imDense === IM_DENSE);
      btn.setAttribute('aria-pressed', String(btn.dataset.imDense === IM_DENSE));
    });
  }
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
  const differ = imSamePic(shop, ours) === false;
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
    return imMsg('Copied ' + (slot === 'SWCH' ? 'the swatch' : slot) + ' of ' + item.sku + ' to the clipboard.');
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
// "Stock > 0 only" on: a family is its children with stock (its header counts those). The family-order dots are worked out here, per
// family, from its children with stock — whatever the filter or the search shows.
function imShownGroups(items, filter, search) {
  const groups = [];
  IM_SEQ.clear();
  imListGroups(items).forEach(group => {
    const stocked = group.kids.filter(kid => imStockOk(kid));
    imSeqFamily(stocked).forEach((dots, sku) => IM_SEQ.set(sku, dots));
    const pool = IM_STOCK_ONLY ? stocked : group.kids;
    const picked = kid => !IM_ONLY || IM_ONLY.skus.has(kid.sku);
    let show = pool.filter(kid => picked(kid) && imKidMatch(kid, filter, search));
    // A search that names the PARENT shows the whole family.
    if (!show.length && search && group.parent && imKidMatch(group.parent, 'all', search)) show = pool.filter(kid => picked(kid) && imKidMatch(kid, filter, ''));
    if (show.length) groups.push(Object.assign({}, group, { kids: pool, show }));
  });
  return groups;
}

// The clipboard bar's controls (imClipBar): Forget it, Preview, a tick per slot, the swatch tick, the quick picks, the mode.
function imClipWire(el) {
  if (!el) return;
  if ($('imClipClear')) $('imClipClear').onclick = () => {
    imClipClear();
    imListRender();
  };
  if ($('imPasteSel')) $('imPasteSel').onclick = () => imPasteGo([...IM_SEL]);
  // --- the clipboard bar: a tick per slot, the swatch tick, the quick picks, the mode ---
  el.querySelectorAll('[data-clip-tick]').forEach(cb => cb.onchange = () => {
    IM_CLIP.tick = Object.assign({}, IM_CLIP.tick || {}, { [cb.dataset.clipTick]: cb.checked });
    imClipSave();
    cb.closest('.im-cs').classList.toggle('is-on', cb.checked);
  });
  if ($('imClipSw')) $('imClipSw').onchange = () => {
    IM_CLIP.tick = Object.assign({}, IM_CLIP.tick || {}, { SWCH: $('imClipSw').checked });
    imClipSave();
    $('imClipSw').closest('.im-cs').classList.toggle('is-on', $('imClipSw').checked);
  };
  if ($('imPick')) $('imPick').onchange = () => {
    const pick = imPicks().find(p => p.k === $('imPick').value);
    if (!pick) return;
    IM_SEL.clear();
    pick.skus.forEach(sku => IM_SEL.add(sku));
    imListRender();
    imMsg(`Ticked ${pick.skus.length} listing(s): ${pick.label}. Check the ticks, then press Preview.`);
  };
  el.querySelectorAll('input[name="imMode"]').forEach(radio => radio.onchange = () => { if (radio.checked) IM_PASTE_MODE = radio.value; });
}
// Draw the list's clipboard bar again on its own (the editor panel opened or closed: "This listing" comes and goes).
function imClipRefresh() {
  const old = $('imClipBar');
  if (!old || !old.parentNode || typeof document === 'undefined' || !document.createElement) return;
  const box = document.createElement('div');
  box.innerHTML = imClipBar('list');
  if (box.firstElementChild) old.replaceWith(box.firstElementChild);
  imClipWire($('imList'));
}

// Draw the list: group by parent, apply the filter and the search, page by listing, then wire the buttons.
function imListRender() {
  const el = $('imList');
  if (!el) return;
  const brand = $('imBrand').value;
  const data = IML[brand];
  if (!data) {
    // Reading: skeleton families in the shape of the list; nothing yet: one line and the button that fixes it.
    el.innerHTML = IML_BUSY || IML_LOADING ? imSkeleton(IML_BUSY ? 'Reading every listing from Amazon for the first time — about two minutes.' : 'Reading the saved pictures…')
      : `<div class="card im-empty"><b>No pictures saved for this brand yet.</b><span>Press <b>Refresh from Amazon</b> to read every listing (about two minutes).</span></div>`;
    return;
  }
  // --- which listings, in which groups ---
  const filter = $('imFilter').value;
  const search = ($('imQ').value || '').trim().toLowerCase();
  IML_VIEW = ($('imView') || {}).value || 'mine';
  const groups = imShownGroups(data.items, filter, search);
  groups.sort((a, b) => (b.kids.length - a.kids.length)
    || String((a.parent || a.kids[0]).t || '').localeCompare(String((b.parent || b.kids[0]).t || '')));
  const nKids = groups.reduce((sum, group) => sum + group.show.length, 0);
  /* NO PAGES: every family's header is drawn (one small picture each); an open family draws its rows in blocks as they come near the
   * screen (imRowsHtml / imChunksWatch). One Ridhi parent holds 455 children: never cut at a page edge. */
  IM_ROWS.clear();
  const firstN = imFirstGroups(el, groups.length);   // SMOOTH: the families that fill the screen now, the rest in the next frames (imLaterGroups)
  // --- the number cards (they replace the old grey summary line), the clipboard bar, the groups ---
  imqSeed(brand);
  const cards = `<div id="imCards" class="im-boxes" role="group" aria-label="Filter the listings">${imCardsHtml(imCardsData(data.items), filter)}</div>`;
  const only = IM_ONLY ? `<div class="card" style="padding:8px 14px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px">`
    + `<span>Showing the <b>${IM_ONLY.skus.size}</b> listing(s) picked in Listing Health${IM_ONLY.label ? ': ' + imEsc(IM_ONLY.label) : ''} — ticked.</span>`
    + `<button class="ghost im-b" id="imOnlyOff">Show every listing</button></div>` : '';
  const filterName = (IM_CARDS.find(card => card.k === filter) || {}).t || (filter !== 'all' && $('imFilter').options ? ([...$('imFilter').options].find(o => o.value === filter) || {}).textContent : '');
  const empty = !nKids ? `<div class="card im-empty"><b>No listings match ${filter !== 'all' ? `“${imEsc(filterName || filter)}”` : ''}${filter !== 'all' && search ? ' and ' : ''}${search ? `the search “${imEsc(search)}”` : filter === 'all' ? 'this view' : ''}.</b>`
    + `<span>${filter !== 'all' || search ? '<button class="ghost im-b" id="imClearFilter">Clear filter</button>' : ''}</span></div>` : '';
  el.innerHTML = only + cards + `<div class="im-meta muted"><span>${nKids.toLocaleString('en-US')} listing(s) in ${groups.length.toLocaleString('en-US')} famil${groups.length === 1 ? 'y' : 'ies'} of ${data.items.length.toLocaleString('en-US')}
      · ${(typeof lmDataLabel === 'function' && lmDataLabel([brand])) ? imEsc(lmDataLabel([brand]).text) : 'snapshot ' + (data.at ? data.at.toLocaleString() : '—')}${IML_BUSY ? ' · refreshing…' : ''}
      · tiles show <b>${IML_VIEW === 'live' ? 'what Amazon serves' : 'the pictures you submitted'}</b>${imStockKnown(brand) ? (IM_STOCK_ONLY ? ' · <b>stock &gt; 0 only</b>' : ' · every child (problems marked on those with stock)') : ' · stock not loaded yet'}</span>
      <span class="im-seq-key"><i class="im-seq" aria-hidden="true"></i> red dot = image out of family order</span>
      ${groups.length ? '<span class="im-meta-act"><button class="ghost im-b" data-foldall="0" title="Open every family">Open all</button><button class="ghost im-b" data-foldall="1" title="Close every family">Close all</button></span>' : ''}
      <details class="im-key"><summary>Key</summary>${IM_LEGEND}</details></div>
    ${IM_CLIP ? '<div id="imBulk" class="muted" style="font-size:12px;margin-bottom:8px"></div>' : ''}
    ${empty}
    ${IM_CLIP ? '' : imOneBarHtml()}
    ${groups.slice(0, firstN).map(group => imGroupHtml(group)).join('')}
    <div id="imSelBar" class="im-selbar" role="status"${IM_SEL.size && !IM_CLIP ? '' : ' hidden'}>${imSelBarHtml()}</div>
    ${imClipBar('list')}`;
  // --- the buttons in what was just drawn (rows drawn later, in blocks, are wired when drawn) ---
  imRowsWire(el);
  imClipWire(el);
  if ($('imOnlyOff')) $('imOnlyOff').onclick = () => {
    imOnly(null);
    imListRender();
  };
  // --- tiles whose size is not known yet are measured when they come on screen (image-quality.js); rows drawn as they come near ---
  imqWatch(el);
  imChunksWatch(el);
  imLaterGroups(el, groups.slice(firstN));
}
/* SMOOTH (18 Nov 2026): A LONG LIST OF FAMILIES IS DRAWN A SCREENFUL FIRST. Every family card is still drawn — the ones that fill the
 * screen (and a margin; as far down as the person has scrolled) at once, the others IM_LATER_STEP at a time in the next frames, each
 * part wired like the first (imRowsWire / imClipWire / imqWatch / imChunksWatch). A new draw of the list cancels the parts still to come.
 * Without a browser (the tests) every family is drawn at once, as before. */
const IM_FIRST = 25;             // families drawn at once at least
const IM_LATER_STEP = 30;        // families per later frame
let IM_LATER = 0;                // the draw the parts still to come belong to
const imProgressive = el => typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !!document.body && !!el && typeof el.insertAdjacentHTML === 'function';
function imFirstGroups(el, n) {
  if (!imProgressive(el) || !el.querySelectorAll) return n;
  const bottom = (window.innerHeight || 900) + 1200;
  let shown = 0;
  for (const card of el.querySelectorAll('.im-grp')) { if (card.getBoundingClientRect().top < bottom) shown++; else break; }
  return Math.min(n, Math.max(IM_FIRST, shown + 5));
}
function imLaterGroups(el, rest) {
  const mine = ++IM_LATER;
  if (!rest.length || !imProgressive(el)) return;
  const step = () => {
    if (mine !== IM_LATER) return;                                 // the list was drawn again since
    const drawn = el.querySelectorAll(':scope > .im-grp');          // after the last family drawn, exactly where the whole list puts them
    const last = drawn[drawn.length - 1];
    if (!last) return;
    last.insertAdjacentHTML('afterend', rest.splice(0, IM_LATER_STEP).map(group => imGroupHtml(group)).join(''));
    imRowsWire(el);
    imClipWire(el);
    imqWatch(el);
    imChunksWatch(el);
    if (rest.length) requestAnimationFrame(() => setTimeout(step, 0));
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}
// The buttons of the rows in `root` (the list, a family card, a block of rows): Copy all / live, a tile's Copy, Paste here, ticks, Edit.
function imRowsWire(root) {
  if (!root || !root.querySelectorAll) return;
  const el = root;
  el.querySelectorAll('[data-copy]').forEach(btn => btn.onclick = () => {
    const item = (IML[$('imBrand').value] || { items: [] }).items.find(each => each.sku === btn.dataset.copy);
    if (!item) return;
    const shop = !!btn.dataset.copyLive;
    imClipTake({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, own: item.img || {}, live: item.live || {}, prefer: shop ? 'live' : '' });
    imListRender();
    imMsg('Copied ' + IM_CLIP.n + ' picture(s) from ' + IM_CLIP.sku + (shop ? ' — what shoppers see' : '') + '.');
  });
  // --- one picture (the hover button on a tile) / paste into one listing ---
  el.querySelectorAll('[data-copy1]').forEach(btn => btn.onclick = e => {
    e.preventDefault();
    const item = (IML[$('imBrand').value] || { items: [] }).items.find(each => each.sku === btn.dataset.copy1);
    if (!item) return;
    imClipCopyOne({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, slot: btn.dataset.slot, url: btn.dataset.url });
    imOneCopy(item, btn.dataset.slot, btn.dataset.url);      // and "Paste here" on this listing and its siblings (6b)
    imListRender();
    imMsg('Copied ' + (btn.dataset.slot === 'SWCH' ? 'the swatch' : btn.dataset.slot) + ' of ' + item.sku + ' to the clipboard.');
  });
  el.querySelectorAll('[data-paste1]').forEach(btn => btn.onclick = () => imPasteGo([btn.dataset.paste1]));
  el.querySelectorAll('.im-sel').forEach(cb => cb.onchange = () => {
    if (cb.checked) IM_SEL.add(cb.dataset.sku);
    else IM_SEL.delete(cb.dataset.sku);
    imSelUpdate();
  });
  // Edit: the editor opens in the side panel; the search box and the scroll stay as they are.
  el.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => imEditOpen(btn.dataset.edit));
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
    // a live read of this listing: newer than the ListingMatch cache's record, so the list shows it until a newer pass (listing-match.js)
    if (typeof lmNoteLive === 'function' && (reply.sku || params.sku)) lmNoteLive(params.brand, reply.sku || params.sku, 'limg', reply);
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
  img.src = typeof imqBase === 'function' ? imqBase(url) : url;
}

// One slot's card: the picture, its label and size, and — in the editable stack — the move / upload / URL / empty / undo buttons.
function imCard(slot, url, opts) {
  const opt = opts || {};
  const changed = opt.edit && (IM_NOW[slot] || '') !== (IM_START[slot] || '');
  let dim = '';
  if (opt.w) dim = opt.w + '×' + opt.h;
  else if (url && IM_DIMS[url] && IM_DIMS[url].w) dim = IM_DIMS[url].w + '×' + IM_DIMS[url].h;
  const dW = opt.w || (IM_DIMS[url] && IM_DIMS[url].w) || 0;
  const dH = opt.h || (IM_DIMS[url] && IM_DIMS[url].h) || 0;
  const small = slot !== 'SWCH' && dW && Math.max(dW, dH) < 1000;
  const label = slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot;
  const pic = url
    ? `<img src="${imEsc(url)}" alt="${label}" loading="lazy" draggable="false"
         style="width:100%;height:100%;object-fit:contain;background:#fff">`
    : `<div class="muted" style="font-size:11px">empty</div>`;
  const tools = opt.edit ? `<div style="display:flex;gap:4px;justify-content:center;margin-top:4px;flex-wrap:wrap">
      ${slot !== 'SWCH' && slot !== 'MAIN' ? `<button class="ghost im-b" data-act="left" data-slot="${slot}" title="Move left">◀</button>` : ''}
      ${slot !== 'SWCH' && slot !== 'PT08' ? `<button class="ghost im-b" data-act="right" data-slot="${slot}" title="Move right">▶</button>` : ''}
      <button class="ghost im-b" data-act="file" data-slot="${slot}" title="Upload a picture into this slot">Upload</button>
      <button class="ghost im-b" data-act="url" data-slot="${slot}" title="Paste an image address">URL</button>
      ${url && slot !== 'MAIN' ? `<button class="ghost im-b" data-act="del" data-slot="${slot}" title="Empty this slot">✕</button>` : ''}
      ${changed ? `<button class="ghost im-b" data-act="undo" data-slot="${slot}" title="Back to how it was">↺</button>` : ''}
    </div>` : '';
  return `<div class="im-card${changed ? ' im-chg' : ''}" data-slot="${slot}" ${opt.edit && slot !== 'SWCH' ? 'draggable="true"' : ''}>
      <div class="im-pic">${url ? `<a href="${imEsc(url)}" target="_blank" rel="noopener" draggable="false">${pic}</a>` : pic}</div>
      <div style="font-size:11px;font-weight:600;margin-top:3px">${label}${changed ? ' · changed' : ''}</div>
      ${opt.note ? `<div class="muted" style="font-size:10.5px">${imEsc(opt.note)}</div>` : ''}
      <div class="muted" style="font-size:10.5px${small ? ';color:var(--bad-ink)' : ''}">${dim || '&nbsp;'}${small ? ' · no zoom' : ''}</div>
      ${url ? imCardChips(slot, url, dW, dH, opt.dup) : ''}
      ${tools}
    </div>`;
}

// The picture rules (image-quality.js) under one card: size words, shape, the same picture twice, and for a file uploaded here its
// white border and fill. The size line above already gives "2400×2400" (and "no zoom" under 1000), so no chip repeats the size.
function imCardChips(slot, url, w, h, dup) {
  const q = imqCheck(Object.assign({ slot, w, h, dup }, IM_QFILE[url] ? { white: IM_QFILE[url].white, fill: IM_QFILE[url].fill } : {}));
  const sized = `${w} × ${h}`;
  const chips = q.chips.filter(chip => !chip.t.startsWith(sized));
  return chips.length ? `<div class="imq-chips">${imqChipsHtml(chips)}</div>` : '';
}

// Draw the editor for the open listing: header, Amazon's issues, the live stack, your editable stack with Check / Apply, the history box.
function imRender() {
  const listing = IM;
  if (!listing) return;
  [...IM_SLOTS, 'SWCH'].forEach(slot => {
    if (IM_NOW[slot]) imMeasure(IM_NOW[slot]);
  });
  const cat = listing.catalog || {};
  const dupLive = imqDups(Object.fromEntries([...IM_SLOTS, 'SWCH'].map(slot => [slot, cat[slot] && cat[slot].link])));
  const dupMine = imqDups(IM_NOW);
  // the swatch: Amazon's catalogue does not return one — ours is shown, marked "from your listing"; no swatch of ours: no tile at all
  const ourSw = (listing.listing || {}).SWCH;
  const liveSw = cat.SWCH && cat.SWCH.link ? imCard('SWCH', cat.SWCH.link, cat.SWCH) : ourSw ? imCard('SWCH', ourSw, { note: 'from your listing' }) : '';
  const live = IM_SLOTS.map(slot => imCard(slot, cat[slot] && cat[slot].link, Object.assign({ dup: dupLive[slot] }, cat[slot] || {}))).join('')
    + (liveSw ? `<div class="im-sep"></div>` + liveSw : '');
  const mine = IM_SLOTS.map(slot => imCard(slot, IM_NOW[slot], { edit: true, dup: dupMine[slot] })).join('')
    + `<div class="im-sep"></div>` + imCard('SWCH', IM_NOW.SWCH, { edit: true, dup: dupMine.SWCH });
  const changes = imChanges();
  const nChanges = Object.keys(changes).length;
  const choices = (listing.skuChoices && listing.skuChoices.length > 1)
    ? `<select id="imSku" style="width:auto;padding:3px 6px;font-size:12px">${listing.skuChoices.map(choice =>
        `<option value="${imEsc(choice.sku)}"${choice.sku === listing.sku ? ' selected' : ''}>${imEsc(choice.sku)}${
          choice.status ? ' · ' + imEsc(choice.status) : ''}</option>`).join('')}</select>`
    : `<b>${imEsc(listing.sku)}</b>`;
  const picIssues = (listing.issues || []).filter(imIsPicIssue);       // picture problems only; the rest is Listing Errors' work
  const issues = picIssues.length
    ? `<div class="card" style="padding:10px 14px;margin-bottom:12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">Amazon's open picture issues on this listing</div>
        ${picIssues.map(issue => `<div style="font-size:12px;margin:3px 0"><span class="st ${issue.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${
          imEsc(issue.severity)}</span> ${imIssueSlot(issue) ? `<b>${imEsc(imIssueSlot(issue))}</b> · ` : ''}${issue.code ? imEsc(issue.code) + ': ' : ''}${imEsc(issue.message)}</div>`).join('')}</div>` : '';
  const onlyCatalog = [...IM_SLOTS, 'SWCH'].filter(slot => !(listing.listing || {})[slot] && cat[slot]);

  $('imBody').innerHTML = `
    <div class="card" style="padding:10px 14px;margin-bottom:12px;font-size:13px">
      <div style="font-weight:600;margin-bottom:4px">${imEsc(listing.title)}</div>
      <div class="muted" style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;align-items:center">
        <span>SKU ${choices}</span><span>ASIN <b>${imEsc(listing.asin)}</b></span>
        ${listing.parent ? `<span>Parent ${imEsc(listing.parent)}</span>` : ''}
        ${listing.color ? `<span>Colour ${imEsc(listing.color)}</span>` : ''}${listing.size ? `<span>Size ${imEsc(listing.size)}</span>` : ''}
        <span>Type ${imEsc(listing.productType)}</span><span>${imEsc((listing.status || []).join(', '))}</span>
        <a href="https://www.amazon.com/dp/${imEsc(listing.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a>
      </div>
    </div>
    ${issues}
    <div class="card" style="padding:10px 14px;margin-bottom:12px">
      <div style="font-weight:600;font-size:13px">Live on Amazon now${typeof aiOn === 'function' && aiOn() ? ' ' + aiBtnHtml('image_check', $('imBrand').value, listing.sku, { use: 'read', label: 'Check main photo' }) : ''}</div>
      <div class="muted" style="font-size:11.5px;margin-bottom:6px">What shoppers see. ${listing.catalogError ? imEsc(listing.catalogError) : ''}</div>
      <div class="im-row">${live}</div>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-weight:600;font-size:13px">Your stack</div>
        <button class="ghost im-b" id="imCopy" title="Hold these pictures so they can be put on another listing">Copy this stack</button>
        ${IM_CLIP && IM_CLIP.sku !== listing.sku ? `<button class="ghost im-b" id="imPaste" title="Put ${imEsc(IM_CLIP.sku)}'s pictures in every slot">Paste ${imEsc(IM_CLIP.sku)}</button>
          <button class="ghost im-b" id="imPasteGaps" title="Only fill the slots that are empty">Fill the empty slots</button>
          <label class="muted" style="font-size:11.5px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="imPasteSw" style="width:auto"> with its swatch</label>` : ''}
        <span class="muted" style="font-size:11.5px">Drag to reorder. Drop files from your computer: one on a slot replaces it, several fill the empty slots in order. Nothing reaches Amazon until Apply.</span>
      </div>

      ${imRulesHtml()}
      <div class="im-row" id="imMine" style="margin-top:8px">${mine}</div>
      ${onlyCatalog.length ? `<div class="muted" style="font-size:11.5px;margin-top:6px">${onlyCatalog.join(', ')} come from the catalogue, not from your listing. Emptying one of those here may not remove it from Amazon if another contributor supplied it.</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <button id="imCheck" class="ghost" style="width:auto;padding:6px 14px" ${nChanges ? '' : 'disabled'}>Check with Amazon</button>
        <button id="imApply" style="width:auto;padding:6px 14px" ${nChanges ? '' : 'disabled'}>Apply to Amazon${nChanges ? ' (' + nChanges + ')' : ''}</button>
        <button id="imReset" class="ghost" style="width:auto;padding:6px 14px" ${nChanges ? '' : 'disabled'}>Discard changes</button>
        <span id="imSendMsg" class="muted" style="font-size:12px"></span>
      </div>
      <div id="imResult">${IM_RESULT}</div>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-weight:600;font-size:13px">Changes sent for this SKU</div>
      <button class="ghost im-b" id="imHistLink" type="button" title="Every change sent for ${imEsc(listing.sku)}, from every screen: when, who, old → new, Amazon's answer">See them in Listing History →</button>
    </div>
    <input type="file" id="imFile" accept="image/jpeg,image/png,image/tiff,image/gif" class="hide">`;
  imWire();
}

// Swap the pictures of two slots in the editable stack and redraw.
function imSwap(a, b) {
  const tmp = IM_NOW[a];
  IM_NOW[a] = IM_NOW[b];
  IM_NOW[b] = tmp;
  imRender();
}

// Wire the editor imRender just drew: the SKU picker, the card buttons, drag and drop, Copy / Paste, Check / Apply / Discard.
function imWire() {
  const sel = $('imSku');
  if (sel) sel.onchange = () => imLoad(sel.value);
  // --- the buttons under each card of your stack ---
  document.querySelectorAll('#imMine .im-b').forEach(btn => btn.onclick = () => {
    const slot = btn.dataset.slot;
    const idx = IM_SLOTS.indexOf(slot);
    if (btn.dataset.act === 'left') imSwap(slot, IM_SLOTS[idx - 1]);
    else if (btn.dataset.act === 'right') imSwap(slot, IM_SLOTS[idx + 1]);
    else if (btn.dataset.act === 'del') {
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
  $('imFile').onchange = () => {
    const file = $('imFile').files[0];
    if (file) imUpload(IM_FILE_SLOT, file);
  };
  // --- drag a card to reorder, or drop a file on it ---
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
      // A dropped FILE goes into this slot (SEVERAL files: the empty slots in order); a dragged card moves here and the rest shift along.
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
  // --- files dropped between the cards: into the empty slots in order ---
  const mineRow = $('imMine');
  if (mineRow) {
    mineRow.ondragover = e => {
      if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) {
        e.preventDefault();
        mineRow.classList.add('im-drop');
      }
    };
    mineRow.ondragleave = e => { if (e.target === mineRow) mineRow.classList.remove('im-drop'); };
    mineRow.ondrop = e => {
      mineRow.classList.remove('im-drop');
      if (e.target && e.target.closest && e.target.closest('.im-card')) return;     // a card's own drop handles it
      const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
      if (!files.length) return;
      e.preventDefault();
      imUploadMany(files);
    };
  }
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
  // --- Copy this stack / Paste / Fill the empty slots ---
  const copyBtn = $('imCopy');
  if (copyBtn) copyBtn.onclick = () => {
    const cat = (IM && IM.catalog) || {};
    const live = {};
    [...IM_SLOTS, 'SWCH'].forEach(slot => { if (cat[slot] && cat[slot].link) live[slot] = cat[slot].link; });
    imClipTake({ brand: IM.brand, sku: IM.sku, asin: IM.asin, c: IM.color, z: IM.size, psku: IM.parent || '', own: IM_NOW, live });
    imRender();
    imListRender();          // the list beside the panel shows the clipboard bar
    imMsg('Copied ' + IM_CLIP.n + ' picture(s) from ' + IM_CLIP.sku + '. Open another listing and press Paste.');
  };
  const paste = gapsOnly => {
    if (!IM_CLIP) return;
    const withSw = $('imPasteSw') && $('imPasteSw').checked;
    let nFilled = 0;
    const ticked = imClipSlots(false);     // only the slots ticked in the clipboard bar
    IM_SLOTS.forEach(slot => {
      const url = ticked[slot] || '';
      if (!url || (gapsOnly && IM_NOW[slot])) return;
      if (IM_NOW[slot] !== url) {
        IM_NOW[slot] = url;
        nFilled++;
      }
    });
    if (withSw && IM_CLIP.slots.SWCH && IM_NOW.SWCH !== IM_CLIP.slots.SWCH) {
      IM_NOW.SWCH = IM_CLIP.slots.SWCH;
      nFilled++;
    }
    imRender();
    imMsg(nFilled ? nFilled + ' slot(s) filled from ' + IM_CLIP.sku + '. Check them, then press Apply to Amazon.'
            : 'Nothing to change — this listing already holds those pictures.');
  };
  if ($('imPaste')) $('imPaste').onclick = () => paste(false);
  if ($('imPasteGaps')) $('imPasteGaps').onclick = () => paste(true);
  if ($('imClipClear')) $('imClipClear').onclick = () => {
    imClipClear();
    imRender();
    imListRender();
  };
  if ($('imHistLink')) $('imHistLink').onclick = () => imHistLink(IM.sku);
  // --- Check / Apply / Discard ---
  $('imCheck').onclick = () => imSend(false);
  $('imApply').onclick = () => imSend(true);
  $('imReset').onclick = () => {
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
  $('imCheck').disabled = $('imApply').disabled = true;
  $('imSendMsg').textContent = apply ? 'Sending to Amazon…' : 'Asking Amazon…';
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
  $('imResult').innerHTML = IM_RESULT;
  $('imSendMsg').textContent = '';
  if (reply.ok && !reply.previewOnly) {
    IM_START = Object.assign({}, IM_NOW);     // what we sent is now the baseline
    IML_DIRTY = true;
    imRender();
    imHistory();
  } else {
    $('imCheck').disabled = $('imApply').disabled = false;
  }
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

/** The banner that says what is held. Shown in both views so a copy is never invisible. */
// `where` is 'list' or 'editor': the list's banner also carries the swatch tick box and "Paste into N ticked listing(s)".
/* THE CLIPBOARD BAR sticks to the bottom of the list: the copied pictures one by one (MAIN, 01–08, swatch) with a tick each — a paste
 * puts in only the ticked slots —, where each came from, the "Paste into…" quick picks, the mode, and the button that opens the preview.
 * The swatch tick is today's "also the swatch" (#imClipSw), off until ticked. */
function imClipBar(where) {
  if (!IM_CLIP) return '';
  const clip = IM_CLIP;
  const sel = where === 'list' ? IM_SEL.size : 0;
  const tick = slot => (slot === 'SWCH' ? !!(clip.tick && clip.tick.SWCH) : !clip.tick || clip.tick[slot] !== false);
  const cells = [...IM_SLOTS, 'SWCH'].map(slot => {
    const url = clip.slots[slot];
    const name = slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot.slice(2);
    if (!url) return `<span class="im-cs is-empty" title="${name}: nothing copied"><span class="im-cs-pic"></span><span class="im-cs-n">${name}</span></span>`;
    const from = clip.from && clip.from[slot] && clip.from[slot] !== clip.sku ? clip.from[slot] : '';
    return `<label class="im-cs${tick(slot) ? ' is-on' : ''}" title="${imEsc(name + (from ? ' — from ' + from : ' — from ' + clip.sku) + '. Ticked = pasted.')}">`
      + `<span class="im-cs-pic"><img src="${imEsc(imThumb(url))}" alt="" loading="lazy"></span>`
      + `<span class="im-cs-n"><input type="checkbox" ${slot === 'SWCH' ? 'id="imClipSw"' : `data-clip-tick="${slot}"`}${tick(slot) ? ' checked' : ''}> ${name}</span>`
      + (from ? `<small class="im-cs-from">${imEsc(from)}</small>` : '') + '</label>';
  }).join('');
  const picks = where === 'list' ? imPicks() : [];
  const pickSel = picks.length ? `<label class="im-clip-l">Paste into <select id="imPick" aria-label="Paste into">`
    + `<option value="">Ticked listings (${sel})</option>${picks.map(p => `<option value="${p.k}">${imEsc(p.label)} (${p.skus.length})</option>`).join('')}</select></label>` : '';
  const mode = `<span class="im-seg" role="group" aria-label="How to paste">`
    + `<label><input type="radio" name="imMode" value="replace"${IM_PASTE_MODE === 'gaps' ? '' : ' checked'}> Replace these slots</label>`
    + `<label><input type="radio" name="imMode" value="gaps"${IM_PASTE_MODE === 'gaps' ? ' checked' : ''}> Only fill empty slots</label></span>`;
  return `<div class="im-clip" id="imClipBar" role="region" aria-label="Clipboard">${where === 'list' ? imOneBarHtml() : ''}
    <div class="im-clip-h"><b>Clipboard</b><span class="muted">from <span class="im-mono">${imEsc(clip.sku)}</span>${clip.c || clip.z ? ' · ' + imEsc([clip.c, clip.z].filter(Boolean).join(' · ')) : ''}`
    + `${clip.shop ? ' · what shoppers see' : ''} · ${clip.n} picture(s)${clip.slots.SWCH ? ' + swatch' : ''} · nothing sent yet — only the ticked slots are pasted</span>
      <span style="flex:1"></span><button class="ghost im-b" id="imClipClear">Forget it</button></div>
    <div class="im-clip-row"><div class="im-cs-list">${cells}</div>
    ${where === 'list' ? `<div class="im-clip-go">${pickSel}${mode}
      <button class="im-b im-go" id="imPasteSel" ${sel ? '' : 'disabled'}>Preview · paste into ${sel} ticked listing(s)</button></div>` : ''}</div>
  </div>`;
}

/* "PASTE INTO…" QUICK PICKS. Each ticks a set of listings (the row ticks show them), then the usual button pastes into the ticked ones.
 * Colour and size stay inside the copied listing's family (its parent, else its product type): a blue tablecloth's pictures are never
 * offered to every blue napkin. The source listing itself is never picked. Returns [{ k, label, skus }], only picks with listings. */
function imPicks() {
  const data = IML[$('imBrand').value];
  if (!IM_CLIP || !data) return [];
  const clip = IM_CLIP;
  const kids = data.items.filter(item => item.lvl !== 'parent' && item.sku !== clip.sku);
  const src = data.items.find(item => item.sku === clip.sku) || {};
  const psku = clip.psku || src.psku || '';
  const family = kids.filter(item => (psku ? item.psku === psku : !!src.pt && item.pt === src.pt));
  const famWord = psku ? 'in this parent' : 'of this product type';
  const out = [];
  if (IM && $('imEditWrap') && !$('imEditWrap').classList.contains('hide') && IM.sku !== clip.sku) out.push({ k: 'this', label: 'This listing: ' + IM.sku, skus: [IM.sku] });
  if (psku) out.push({ k: 'kids', label: 'All children of ' + psku, skus: family.map(item => item.sku) });
  if (clip.c) out.push({ k: 'colour', label: `Same colour (${clip.c}) ${famWord}`, skus: family.filter(item => item.c === clip.c).map(item => item.sku) });
  if (clip.z) out.push({ k: 'size', label: `Same size (${clip.z}) ${famWord}`, skus: family.filter(item => item.z === clip.z).map(item => item.sku) });
  const shown = imShownGroups(data.items, $('imFilter').value, ($('imQ').value || '').trim().toLowerCase());
  out.push({ k: 'filter', label: 'Everything in the current filter', skus: [].concat(...shown.map(group => group.show.map(item => item.sku))).filter(sku => sku !== clip.sku) });
  return out.filter(p => p.skus.length);
}

/* PASTE INTO SEVERAL LISTINGS. One send per SKU, each previewed by Amazon first (the backend only
 * sends for real when the preview is clean), each reported on its own line. It stops after three
 * failures in a row, because the fourth will fail the same way and the rest can wait for a fix. */
// Paste the copied stack into every ticked SKU: one send each, applied straight away (the backend previews first), reported line by line.
/** What a paste would do, per listing, without sending: { jobs, held, careful, qual }. Only the clipboard's ticked slots (the swatch with
 *  `withSw`); mode 'gaps' leaves a slot that already holds a picture (ours or live) alone. `qual`: sku → slot → { q (imqCheck), wh, fail }:
 *  a picture fails when the rules say anything but OK (no zoom, not square, the same picture twice in the stack it lands in). */
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
  const withSw = !!($('imClipSw') && $('imClipSw').checked);
  const plan = imPastePlan(skus, { withSw, mode: IM_PASTE_MODE });
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
  const withSw = $('imClipSw') && $('imClipSw').checked;
  const plan = pre || imPastePlan(skus, { withSw, mode: IM_PASTE_MODE });
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
 * 10. EVENT WIRING — every toolbar control is connected here
 * Buttons drawn inside the list or the editor are wired where they are drawn (imListRender, imWire).
 */

// Open: the typed SKU or ASIN in the editor.
$('imGo').onclick = () => {
  IM_SKU_CHOICES = null;
  imLoad();
};

// Close the editor panel, redrawing the list if a send changed anything.
$('imBack').onclick = () => {
  imShowEditor(false);
  if (IML_DIRTY) {
    IML_DIRTY = false;
    imListRender();
  }
};

let IML_T = 0;          // debounce timer for the search box
// Redraw the list from page 1 (search, filter and view changes).
const imListAgain = () => {
  IML_PAGE = 0;
  IM_SHUT.clear();
  imShowEditor(false);
  imListRender();
};
$('imQ').addEventListener('input', () => {
  clearTimeout(IML_T);
  IML_T = setTimeout(imListAgain, 200);
});
$('imQ').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(IML_T);
    imListAgain();
  }
});
$('imFilter').onchange = imListAgain;
if ($('imStock')) {
  $('imStock').checked = IM_STOCK_ONLY;
  $('imStock').onchange = () => imStockSet($('imStock').checked);
}
$('imView').onchange = imListAgain;
// Brand changed: page 1, nothing ticked, back to the list, that brand's snapshot.
$('imBrand').onchange = () => {
  IML_PAGE = 0;
  IM_SEL.clear();
  IM_ONLY = null;
  imShowEditor(false);
  imListEnsure();
};
// Refresh from Amazon: rebuild this brand's snapshot.
$('imRefresh').onclick = () => imListBuild($('imBrand').value);

/* ============================================================================================
 * ⬇ DOWNLOAD ERRORS (17 Nov 2026): a sheet for Excel — one row per LIVE listing (stock > 0, buyable) with at least one picture problem
 * ============================================================================================
 * The problems are the listing's own (imProblems — what the cards count and the row's chips show), so the file's "Yes" counts are the cards' numbers for the
 * listings with stock. Stock and status are what the screen reads: lrQtyOf (Listing Health's rows, which follow ListingMatch) and imState
 * (THE ONE RULE, lrShopOf): buyable = Buyable or Search suppressed (still sold by a direct link).
 * FAST: built from the data the screen already shows (the ListingMatch auto refresh — "Data time" says when it was read). Only the
 * CRITICAL rows (No main picture, Main rejected by Amazon, Search suppressed) are read again live before saving; "Verified at" says when.
 * The screen follows those reads and the sheet is made from the screen's data, so the cards and the file agree. Nothing is sent to Amazon. */
// The checks in the file's column order: the card key, the column (also the problem in plain words) and what to do in one short line.
const IM_DL_CHECKS = [
  { k: 'nomain', col: 'No main picture', todo: 'Upload a main picture (none sent, none shown)' },
  { k: 'pcbad', col: 'Main not OK', todo: 'Replace the main picture: pure white background, no text or logo' },
  { k: 'few', col: 'Fewer than 7 pictures', todo: 'Add pictures until there are at least 7' },
  { k: 'amzerr', col: 'Amazon picture error', todo: "Fix what Amazon's picture error says, in the Image Manager editor" },
  { k: 'sup', col: 'Search suppressed', todo: 'Open it in Listing Errors and fix why Amazon took it out of search' },
];
const IM_DL_COLS = ['Brand', 'Family name', 'Parent ASIN', 'SKU', 'ASIN', 'Colour', 'Size', 'Stock (units)', 'Amazon link', 'Problems', 'What to do']
  .concat(IM_DL_CHECKS.map(c => c.col), ['Number of pictures', 'Smallest picture size', "Amazon's picture error message", 'Data time', 'Verified at', 'Priority']);
const IM_LIVE_PAR = 4;            // listings read live from Amazon at once (each is two calls)
let IM_DL_RUN = null;             // { stop, done, total } while the download checks its rows with Amazon
// One problem of one listing of `brand` (the listing's problems: imProblems).
const imDlHas = (item, k, brand) => imProblems(item, brand).includes(k);
// Live on Amazon with stock: more than 0 units and buyable (Buyable, or Search suppressed — still sold by a direct link).
function imDlLive(item, brand) {
  const qty = lrQtyOf(brand, item.sku);
  return qty != null && qty > 0 && ['ok', 'sup'].includes(imState(item, brand).k);
}
// The age of what the screen shows: ListingMatch's label while its data is fresh, else the snapshot's own time.
function imDlTime(brand) {
  const lm = typeof lmDataLabel === 'function' ? lmDataLabel([brand]) : null;
  if (lm) return lm.text;
  const at = IML[brand] && IML[brand].at;
  return at && at.toLocaleString ? 'Snapshot ' + at.toLocaleString('en-GB') : '';
}
// '17 Nov 14:09' (this computer's time).
function imDlClock(ms) {
  const d = new Date(ms);
  const p2 = n => String(n).padStart(2, '0');
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** One listing's row, or null when it has no picture problem (or not the one asked for: `only` = a card key). `bySku`: the brand's
 *  list by SKU (the family's name); `when`: the data time; `verified`: when Amazon was read live for it ('' = not yet). */
function imDlRow(item, brand, bySku, only, when, verified) {
  const probs = imProblems(item, brand);                       // THE listing's problems: the cards and the chips read the same list
  const has = IM_DL_CHECKS.filter(c => probs.includes(c.k));
  if (!has.length || (only && !has.some(c => c.k === only))) return null;
  const parent = item.psku ? bySku.get(item.psku) || null : null;
  const fam = parent ? String(parent.t || '') || 'Parent ' + parent.sku : item.psku ? 'Parent ' + item.psku : 'No variation parent';
  const sizes = imServedPics(item).map(pic => imqDims(pic.url)).filter(Boolean)
    .sort((a, b) => Math.min(a[0], a[1]) - Math.min(b[0], b[1]) || a[0] * a[1] - b[0] * b[1]);
  const errs = imPicErrs(item).map(imPicErrText).join(' | ');
  return { brand, item, fam, famKey: brand + '|' + (item.psku || 'solo:' + item.sku), sku: String(item.sku), n: has.length, cells: [
    (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand, fam, item.pa || (parent && parent.asin) || '', item.sku, item.asin || '', item.c || '', item.z || '',
    lrQtyOf(brand, item.sku), item.asin ? 'https://www.amazon.com/dp/' + item.asin : '', has.map(c => c.col).join(' | '), has.map(c => c.todo).join(' | '),
  ].concat(IM_DL_CHECKS.map(c => (has.includes(c) ? 'Yes' : '')), [imPicCount(item).n, sizes[0] ? `${sizes[0][0]}×${sizes[0][1]}` : '', errs, when, verified || '', typeof prOf === 'function' ? prCsv(prIm(brand, item)) : '']) };
}
// By family (the family's problems added up, most first; then its name), then SKU.
function imDlSort(rows) {
  const famN = new Map();
  rows.forEach(r => famN.set(r.famKey, (famN.get(r.famKey) || 0) + r.n));
  return rows.sort((a, b) => famN.get(b.famKey) - famN.get(a.famKey) || a.fam.localeCompare(b.fam) || a.famKey.localeCompare(b.famKey) || a.sku.localeCompare(b.sku));
}
/** The rows from what the screen holds: [{ brand, item, fam, famKey, sku, n (problems), cells }] for these brands; `only` = a card key
 *  (that filter only) or '' (every picture problem); `verified`: Map "brand|sku" → its "Verified at" (the rows read live). Live
 *  listings with stock only. */
function imDlRows(brands, only, verified) {
  const out = [];
  brands.forEach(brand => {
    const data = IML[brand];
    if (!data || !data.items) return;
    if (typeof imqSeed === 'function') imqSeed(brand); // the picture sizes the cards know (the cache's catalogue reads)
    const bySku = new Map(data.items.map(item => [item.sku, item]));
    const when = imDlTime(brand);
    data.items.forEach(item => {
      if (!item || item.lvl === 'parent' || !imDlLive(item, brand)) return;
      const row = imDlRow(item, brand, bySku, only, when, (verified && verified.get(brand + '|' + item.sku)) || '');
      if (row) out.push(row);
    });
  });
  return imDlSort(out);
}
/** The sheet: { name, text, rows } — UTF-8 with a BOM (Excel reads Hindi and ₹ right), the headers on row 1, every text quoted ("" for a
 *  quote), numbers plain, Windows line ends. name: image-errors_<Ridhi|CPC|Both>_<YYYY-MM-DD>_<HHMM>.csv */
function imDlCsv(rows, who, now) {
  const q = v => (typeof v === 'number' ? String(v) : `"${String(v == null ? '' : v).replace(/"/g, '""')}"`);
  const text = '﻿' + [IM_DL_COLS.map(q).join(',')].concat(rows.map(r => r.cells.map(q).join(','))).join('\r\n') + '\r\n';
  const d = now || new Date();
  const p2 = n => String(n).padStart(2, '0');
  const name = `image-errors_${String(who).replace(/[^\w-]+/g, '')}_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.csv`;
  return { name, text, rows: rows.length };
}

/* ----- one listing as Amazon has it NOW (the download's check before saving, and imgAccuracyReport) ----- */
/** ?limg=get — our listing's pictures, what Amazon serves (with each picture's size), the status, the issues — and ?lfix=get — the
 *  issues with their enforcement actions, which the Suppressed rule reads — as a list record the checks can judge: { item, at }.
 *  `base`: the list's record (its family, colour, size carry over); `liveRead` marks it. Suppressed is THE ONE RULE as everywhere
 *  (its status and enforcement actions now, and the Suppressed listings report). Throws when Amazon could not be read. The screen follows the read (listing-match.js lmNoteLive), so the cards agree with it. */
async function imLiveRead(brand, sku, base) {
  const [pics, fix] = await Promise.all([baCall({ limg: 'get', brand, sku }), baCall({ lfix: 'get', brand, sku }).catch(() => null)]);
  const at = Date.now();
  const src = fix && fix.issues ? fix : pics;       // the issues with enforcement actions when that read answered
  const item = Object.assign({}, base || {}, { sku: pics.sku || sku, asin: pics.asin || (base && base.asin) || '', st: ((src.status || pics.status) || []).join(','),
    img: Object.fromEntries(Object.entries(pics.listing || {}).filter(([, url]) => url)), liveRead: true,
    iss: (src.issues || []).map(issue => {
      const one = { s: String(issue.severity || '').charAt(0).toUpperCase(), c: String(issue.code || ''), m: String(issue.message || ''), a: (issue.attrs || issue.attributeNames || []).slice() };
      const acts = typeof lrIssueActs === 'function' ? lrIssueActs(issue) : [];
      if (acts.length) one.e = acts;
      return one;
    }) });
  item.ie = item.iss.filter(issue => issue.s === 'E').length;
  item.im = (item.iss.find(issue => issue.s === 'E') || {}).m || '';
  if (pics.catalogError || !pics.catalog || typeof pics.catalog !== 'object') {
    delete item.live;                                 // Amazon's catalogue did not answer: what it serves is NOT KNOWN
    item.liveErr = pics.catalogError || 'catalogue not read';
  } else {
    item.live = Object.fromEntries(Object.entries(pics.catalog).filter(([, v]) => v && v.link).map(([slot, v]) => [slot, v.link]));
    delete item.liveErr;
    if (pics.parent) item.pa = pics.parent;
    // each served picture's real size, as Amazon gives it
    imqStoreLoad();
    Object.values(pics.catalog).forEach(v => { if (v && v.link && Number(v.w) > 0 && Number(v.h) > 0) IMQ.dims.set(imqId(v.link), [Number(v.w), Number(v.h)]); });
    imqStoreSave();
  }
  // the screen follows: the ListingMatch overlay (what every Listing screen shows until a newer pass), else the saved list's own record
  if (typeof lmNoteLive === 'function') {
    lmNoteLive(brand, item.sku, 'limg', pics);
    if (fix && fix.issues) lmNoteLive(brand, item.sku, 'get', fix);
  }
  const data = IML[brand];
  if (data && !data.lm && data.items) {
    const i = data.items.findIndex(each => each && each.sku === item.sku);
    if (i >= 0) data.items[i] = item;
  }
  return { item, at };
}
/** These listings read live, IM_LIVE_PAR at a time (one more try for a failed read): Map "brand|sku" → { item, at } or { err }.
 *  onStep(done, total) after each; stop() true ends it early (the rest stay unread). */
async function imLiveReadMany(list, onStep, stop) {
  const out = new Map();
  let next = 0;
  let done = 0;
  const one = async () => {
    while (next < list.length && !(stop && stop())) {
      const job = list[next++];
      const key = job.brand + '|' + job.sku;
      let got = null;
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        try { got = await imLiveRead(job.brand, job.sku, job.base); } catch (e) { if (attempt) got = { err: String((e && e.message) || e) }; }
      }
      out.set(key, got);
      done++;
      if (onStep) onStep(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(IM_LIVE_PAR, list.length) }, one));
  return out;
}
// The button while the download checks its rows with Amazon: "Stop · checking with Amazon 12 of 85".
function imDlBtn() {
  const btn = $('imDl');
  if (!btn) return;
  btn.textContent = IM_DL_RUN ? `Stop · checking with Amazon ${IM_DL_RUN.done.toLocaleString('en-US')} of ${IM_DL_RUN.total.toLocaleString('en-US')}` : '⬇ Download errors';
}
/** Download: these brands (both, or the picker's), every picture problem or only the card's filter `only`. FAST: the sheet is built
 *  from the very data the screen shows (the ListingMatch auto refresh; "Data time" says when it was read) — no live read per row. Only
 *  the CRITICAL rows (No main picture, Main rejected by Amazon, Search suppressed — imCritical) are read again live from Amazon before
 *  saving (Stop on the button); the screen follows those reads, and the sheet is then made from the screen's data again, so the two are
 *  always the same. Returns the sheet ({ ms, liveMs, critical, fixed, unread }), or null when stopped. */
async function imDlDownload(both, only) {
  if (IM_DL_RUN) return null;
  const t0 = Date.now();
  const brands = both ? ['SP', 'CPC'] : [$('imBrand').value];
  if (typeof H_LOADED !== 'undefined' && !H_LOADED && typeof loadHealthCache === 'function') {
    imMsg('Reading the stock…');
    await loadHealthCache();
    if (typeof imListRender === 'function' && IML[$('imBrand').value]) imListRender();   // the screen follows the same stock
  }
  for (const brand of brands) {
    if (!(brand in IML)) { imMsg(`Reading ${(typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand} listings…`); await imListLoad(brand); }
  }
  if (typeof pcLoad === 'function') { try { await pcLoad(); } catch (e) { /* "Main not OK" stays not checked */ } }
  const card = IM_DL_CHECKS.some(c => c.k === only) ? only : '';
  // --- the critical rows only, live from Amazon ---
  const crit = imDlRows(brands, card).filter(r => imCritical(r.item, r.brand));
  const run = IM_DL_RUN = { stop: false, done: 0, total: crit.length };
  const t1 = Date.now();
  let got = new Map();
  if (crit.length) {
    imDlBtn();
    imMsg(`Checking the ${crit.length.toLocaleString('en-US')} critical listing${crit.length === 1 ? '' : 's'} live with Amazon before saving…`);
    try {
      got = await imLiveReadMany(crit.map(r => ({ brand: r.brand, sku: r.sku, base: r.item })), (done, total) => { run.done = done; run.total = total; imDlBtn(); }, () => run.stop);
    } finally {
      IM_DL_RUN = null;
      imDlBtn();
    }
    if (typeof imListRender === 'function' && IML[$('imBrand').value]) imListRender();     // the cards follow what Amazon said
  } else IM_DL_RUN = null;
  const liveMs = Date.now() - t1;
  if (run.stop) { imMsg('Stopped — no file was saved.'); return null; }
  // --- the sheet from the screen's data (the critical rows now as Amazon answered them) ---
  const verified = new Map();
  let unread = 0;
  crit.forEach(r => {
    const live = got.get(r.brand + '|' + r.sku);
    if (live && !live.err) verified.set(r.brand + '|' + r.sku, imDlClock(live.at));
    else { unread++; verified.set(r.brand + '|' + r.sku, 'not confirmed: Amazon could not be read'); }
  });
  const rows = imDlRows(brands, card, verified);
  const still = new Set(rows.map(r => r.brand + '|' + r.sku));
  const fixed = crit.filter(r => still.has(r.brand + '|' + r.sku) ? !imCritical(rows.find(x => x.brand === r.brand && x.sku === r.sku).item, r.brand) : true).length;
  const sheet = imDlCsv(rows, both ? 'Both' : (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brands[0]]) || brands[0], new Date());
  Object.assign(sheet, { ms: Date.now() - t0, liveMs, critical: crit.length, fixed, unread });
  if (typeof document !== 'undefined' && document.createElement && typeof Blob !== 'undefined') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([sheet.text], { type: 'text/csv;charset=utf-8' }));
    a.download = sheet.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const missing = brands.filter(brand => !IML[brand]);
  imMsg(`Downloaded ${sheet.rows.toLocaleString('en-US')} listing${sheet.rows === 1 ? '' : 's'} with picture problems (stock > 0)`
    + (card ? ` — only “${IM_DL_CHECKS.find(c => c.k === card).col}”` : '')
    + (crit.length ? ` · ${crit.length.toLocaleString('en-US')} critical checked live with Amazon${fixed ? ` (${fixed.toLocaleString('en-US')} no longer critical)` : ''}${unread ? ` (${unread.toLocaleString('en-US')} could not be read)` : ''}` : '')
    + ` · the rest from the auto refresh`
    + (missing.length ? ` · no list yet for ${missing.map(b => BRAND_NAME[b] || b).join(', ')}` : ''));
  return sheet;
}

/* ----- PROOF (the console): imgCounts() and imgAccuracyReport() ----- */
// The checks as they were BEFORE 17 Nov 2026 — kept ONLY for the "old count" column of imgCounts; nothing on the screen reads them.
function imOldCheck(item, k, brand, owner) {
  const img = item.img || {};
  const live = item.live || {};
  if (k === 'nomain') return !img.MAIN && !live.MAIN;
  if (k === 'pcbad') return typeof PC !== 'undefined' && !!live.MAIN && ((PC.marks[brand] || {})[imqId(live.MAIN)] || {}).v === 'bad';
  if (k === 'small') return IM_SLOTS.some(slot => [img[slot], live[slot]].some(url => { const wh = imqDims(url); return !!wh && imqSize(wh[0], wh[1]) !== 'g'; }));
  if (k === 'few') return IM_SLOTS.filter(slot => live[slot] || img[slot]).length < 7;
  if (k === 'amzerr') {
    const pic = issue => (issue.a || []).some(attr => IM_PIC_ATTR.test(String(attr))) || IM_PIC_CODES.includes(String(issue.c || '')) || IM_PIC_WORDS.test(String(issue.m || ''));
    return Array.isArray(item.iss) ? item.iss.some(issue => issue && issue.s === 'E' && pic(issue)) : !!(item.ie && pic({ m: item.im }));
  }
  if (k === 'sup' || k === 'nobuy') return imState(item, brand).k === k;
  if (k === 'noswatch') return !img.SWCH && !live.SWCH;
  if (k === 'diff') return IM_SLOTS.some(slot => img[slot] && live[slot] && img[slot] !== live[slot]);
  if (k === 'other') {
    if (!live.MAIN || !img.MAIN || live.MAIN === img.MAIN) return false;
    return (owner.get(live.MAIN) || []).some(other => other.sku !== item.sku);
  }
  return false;
}
// What the report needs loaded, exactly as the screen loads it: the stock, both brands' lists, the Picture check marks, the sizes.
async function imProofLoad() {
  if (typeof H_LOADED !== 'undefined' && !H_LOADED && typeof loadHealthCache === 'function') await loadHealthCache();
  for (const brand of ['SP', 'CPC']) {
    if (!(brand in IML)) await imListLoad(brand);
    if (typeof imqSeed === 'function') imqSeed(brand);
  }
  if (typeof pcLoad === 'function') { try { await pcLoad(); } catch (e) { /* stays not checked */ } }
}
/** CONSOLE: `await imgCounts()` — per brand and check: the old count → the count now, and how many are "not checked" now.
 *  Reads nothing from Amazon (only what the screen holds). */
async function imgCounts() {
  await imProofLoad();
  const rows = [];
  ['SP', 'CPC'].forEach(brand => {
    const kids = ((IML[brand] && IML[brand].items) || []).filter(item => item && item.lvl !== 'parent');
    const owner = new Map();
    kids.concat(((IML[brand] && IML[brand].items) || []).filter(item => item && item.lvl === 'parent')).forEach(item => IM_SLOTS.forEach(slot => {
      const url = (item.img || {})[slot];
      if (url) owner.set(url, (owner.get(url) || []).concat([item]));
    }));
    Object.keys(IM_CHECKS).forEach(k => {
      let now = 0;
      let unk = 0;
      kids.forEach(kid => { const v = imCheck(kid, k, brand); if (v === true) now++; else if (v === null) unk++; });
      rows.push({ brand: (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand, check: IM_CHECKS[k], listings: kids.length, old: kids.filter(kid => imOldCheck(kid, k, brand, owner)).length, now, notChecked: unk });
    });
    rows.push({ brand: (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand, check: "Shows another SKU's pictures", listings: kids.length, old: kids.filter(kid => imOldCheck(kid, 'other', brand, owner)).length, now: 'removed', notChecked: '' });
    rows.push({ brand: (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand, check: 'No swatch', listings: kids.length, old: kids.filter(kid => imOldCheck(kid, 'noswatch', brand, owner)).length, now: 'removed', notChecked: '' });
    rows.push({ brand: (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand, check: 'Too small (under 2000)', listings: kids.length, old: kids.filter(kid => imOldCheck(kid, 'small', brand, owner)).length, now: 'removed', notChecked: '' });
  });
  if (typeof console !== 'undefined' && console.table) console.table(rows);
  return rows;
}
/** CONSOLE: `await imgAccuracyReport()` in a signed-in Sellora tab — for EACH check, up to n (10) flagged listings per brand are read
 *  again live from Amazon and judged by the same check. Options: `imgAccuracyReport(20)` (n), `imgAccuracyReport({ check: 'amzerr',
 *  n: 50 })` (one check), `imgAccuracyReport({ check: 'amzerr', skus: ['RCN72', 'RCST72'] })` (these listings, flagged or not — a
 *  problem Sellora MISSED shows as DIFFERENT too). Each row: SKU · check · what Sellora says · what Amazon has now · MATCH (both say
 *  the same) / DIFFERENT / NOT CHECKED (one side cannot decide) / NOT READ (Amazon could not be read); then a summary per check.
 *  Returns { rows, summary, different }. A listing read here also updates the screen. Nothing is sent to Amazon. */
async function imgAccuracyReport(opts) {
  const o = typeof opts === 'number' ? { n: opts } : (opts || {});
  const max = Number(o.n) > 0 ? Number(o.n) : 10;
  const keys = o.check ? [].concat(o.check).filter(k => k in IM_CHECKS) : Object.keys(IM_CHECKS);
  const want = o.skus ? new Set([].concat(o.skus).map(String)) : null;
  await imProofLoad();
  const picks = [];
  const yn = v => (v === true ? 'YES — ' : v === false ? 'NO — ' : 'NOT KNOWN — ');
  ['SP', 'CPC'].forEach(brand => {
    const kids = ((IML[brand] && IML[brand].items) || []).filter(item => item && item.lvl !== 'parent');
    keys.forEach(k => {
      (want ? kids.filter(kid => want.has(kid.sku)) : kids.filter(kid => imCheck(kid, k, brand) === true).slice(0, max))
        .forEach(kid => { const v = imCheck(kid, k, brand); picks.push({ brand, sku: kid.sku, k, base: kid, v, says: yn(v) + imCheckWhy(kid, k, brand) }); });   // what Sellora says, BEFORE the live read
    });
  });
  const found = new Set(picks.map(p => p.sku));
  const missing = want ? [...want].filter(sku => !found.has(sku)) : [];
  const uniq = [...new Map(picks.map(p => [p.brand + '|' + p.sku, { brand: p.brand, sku: p.sku, base: p.base }])).values()];
  if (typeof console !== 'undefined') console.log(`imgAccuracyReport: reading ${uniq.length} listings live from Amazon (${picks.length} checks)…${missing.length ? ' Not in either brand\'s list: ' + missing.join(', ') : ''}`);
  const got = await imLiveReadMany(uniq, (done, total) => { if (done % 20 === 0 && typeof console !== 'undefined') console.log(`  ${done} of ${total}`); });
  const rows = picks.map(p => {
    const live = got.get(p.brand + '|' + p.sku);
    const brandName = (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[p.brand]) || p.brand;
    if (!live || live.err) return { brand: brandName, sku: p.sku, check: IM_CHECKS[p.k], sellora: p.says, amazonNow: 'could not be read' + (live && live.err ? ': ' + live.err : ''), result: 'NOT READ' };
    const v = imCheck(live.item, p.k, p.brand);
    return { brand: brandName, sku: p.sku, check: IM_CHECKS[p.k], sellora: p.says, amazonNow: yn(v) + imCheckWhy(live.item, p.k, p.brand),
      result: v === null || p.v === null ? 'NOT CHECKED' : v === p.v ? 'MATCH' : 'DIFFERENT' };
  });
  const summary = keys.map(k => IM_CHECKS[k]).map(name => {
    const mine = rows.filter(r => r.check === name);
    return { check: name, read: mine.length, match: mine.filter(r => r.result === 'MATCH').length, different: mine.filter(r => r.result === 'DIFFERENT').length, notChecked: mine.filter(r => r.result === 'NOT CHECKED').length, notRead: mine.filter(r => r.result === 'NOT READ').length };
  });
  if (typeof console !== 'undefined' && console.table) { console.table(rows); console.table(summary); }
  if (typeof imListRender === 'function' && IML[$('imBrand').value]) imListRender();
  return { rows, summary, different: rows.filter(r => r.result === 'DIFFERENT'), missing };
}
if (typeof window !== 'undefined') { window.imgAccuracyReport = imgAccuracyReport; window.imgCounts = imgCounts; }
// The button's small menu: the brand (this one / both) and — when a card's filter is on — that filter only or every picture problem.
function imDlMenuHtml() {
  const brand = $('imBrand').value;
  const f = $('imFilter').value;
  const card = IM_DL_CHECKS.find(c => c.k === f);
  return '<div class="im-dlm-b" role="group" aria-label="Download picture errors"><b>Download picture errors</b>'
    + '<small>Live listings only (stock &gt; 0), each with at least one picture problem — a sheet for Excel.</small>'
    + `<fieldset><legend>Brand</legend><label><input type="radio" name="imDlB" value="one" checked> This brand (${imEsc((typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand)})</label>`
    + '<label><input type="radio" name="imDlB" value="both"> Both brands</label></fieldset>'
    + (card ? `<fieldset><legend>Rows</legend><label><input type="radio" name="imDlF" value="filter" checked> Only this filter: ${imEsc(card.col)}</label>`
      + '<label><input type="radio" name="imDlF" value="all"> All picture problems</label></fieldset>' : '')
    + '<div class="im-dlm-a"><button type="button" class="im-b" data-imdl="go">Download</button><button type="button" class="ghost im-b" data-imdl="x">Cancel</button></div></div>';
}
function imDlMenu(open) {
  const m = $('imDlMenu');
  if (!m) return;
  const on = open == null ? m.hidden : !!open;
  if (on) m.innerHTML = imDlMenuHtml();
  m.hidden = !on;
  if ($('imDl') && $('imDl').setAttribute) $('imDl').setAttribute('aria-expanded', String(on));
}
// The menu's buttons: Download with what is picked, or Cancel.
function imDlClick(act) {
  const m = $('imDlMenu');
  if (act === 'x') return imDlMenu(false);
  if (act !== 'go' || !m) return null;
  const pick = name => { const r = m.querySelector ? m.querySelector(`input[name="${name}"]:checked`) : null; return r ? r.value : ''; };
  const both = pick('imDlB') === 'both';
  const only = pick('imDlF') === 'filter' ? $('imFilter').value : '';
  imDlMenu(false);
  return imDlDownload(both, only).catch(e => imMsg('Could not make the sheet: ' + ((e && e.message) || e), true));
}
if ($('imDl')) $('imDl').onclick = () => { if (IM_DL_RUN) { IM_DL_RUN.stop = true; return; } imDlMenu(); };
if ($('imDlMenu') && $('imDlMenu').addEventListener) $('imDlMenu').addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-imdl]') : null;
  if (btn) imDlClick(btn.dataset.imdl);
});
if (typeof document !== 'undefined' && document.addEventListener) {
  // a click outside the menu, or Esc, closes it
  document.addEventListener('click', e => {
    const m = $('imDlMenu');
    if (!m || m.hidden || !e.target || !e.target.closest) return;
    if (!e.target.closest('#imDlMenu') && !e.target.closest('#imDl')) imDlMenu(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('imDlMenu') && !$('imDlMenu').hidden) imDlMenu(false); });
}
// One listener for the list: a number card (that filter; again = all), a tile (the viewer), its View / Replace, folding a family, its
// Copy main / Select all children, Expand / Collapse all, Clear filter, the "N selected" Clear, and Shift+click on a tick (a range).
$('imList').addEventListener('click', e => {
  const t = e.target;
  const on = sel => (t && t.closest ? t.closest(sel) : null);
  // a drag just ended on this tile: its click does not open the viewer
  if (Date.now() - IM_LD_END < 400 && on('.im-tw')) { if (e.preventDefault) e.preventDefault(); return; }
  // rearranging a listing (6b): Paste here, the draft's Undo / Discard changes / Send…, Match family order
  const one = on('[data-paste-one]');
  if (one) return imPasteOne(one.dataset.pasteOne, one.dataset.slot);
  const dr = on('[data-dr]');
  if (dr) {
    if (dr.dataset.dr === 'undo') return imDraftUndo(dr.dataset.sku);
    if (dr.dataset.dr === 'discard') return imDraftDiscard(dr.dataset.sku);
    return imDraftPreview(dr.dataset.sku);
  }
  const mt = on('[data-match]');
  if (mt) return imMatchFamily(mt.dataset.match);
  if (on('[data-one-clear]')) return imOneClear();
  const card = on('[data-im-card]');
  if (card) {
    $('imFilter').value = $('imFilter').value === card.dataset.imCard ? 'all' : card.dataset.imCard;
    return imListAgain();
  }
  const tick = on('input.im-sel');
  if (tick) {
    const sku = tick.dataset.sku;
    if (e.shiftKey && IM_LAST_SEL && IM_LAST_SEL !== sku) {
      const order = [...$('imList').querySelectorAll('input.im-sel')].map(box => box.dataset.sku);
      imRangeSel(order, IM_LAST_SEL, sku).forEach(each => {
        if (tick.checked) IM_SEL.add(each);
        else IM_SEL.delete(each);
        const box = $('imList').querySelector(`input.im-sel[data-sku="${CSS.escape(each)}"]`);
        if (box) box.checked = tick.checked;
      });
      imSelUpdate();
    }
    IM_LAST_SEL = sku;
    return;
  }
  const tileLink = on('a.im-th');
  if (tileLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.button) {
    const wrap = tileLink.closest('.im-tw');
    if (wrap && wrap.dataset.sku) {
      e.preventDefault();           // Ctrl / ⌘ + click still opens the picture in a new tab
      return imViewOpen(wrap.dataset.sku, wrap.dataset.slot);
    }
  }
  const view = on('[data-view]');
  if (view) return imViewOpen(view.dataset.view, view.dataset.slot);
  const repl = on('[data-repl]');
  if (repl) return imReplMenu(repl, repl.dataset.repl, repl.dataset.slot);
  const fold = on('[data-fold]');
  if (fold) return imFamToggle(fold.dataset.fold);
  const all = on('[data-foldall]');
  if (all) {
    const keys = imListGroups((IML[$('imBrand').value] || { items: [] }).items).map(imGroupKey);
    IM_OPEN.clear();
    IM_SHUT.clear();
    keys.forEach(key => (all.dataset.foldall === '1' ? IM_SHUT : IM_OPEN).add(key));
    return imListRender();
  }
  const fam = on('[data-fammain],[data-famsel]');
  if (fam) {
    const key = fam.dataset.fammain || fam.dataset.famsel;
    const group = imListGroups((IML[$('imBrand').value] || { items: [] }).items).find(each => imGroupKey(each) === key);
    if (!group) return;
    if (fam.dataset.famsel) {
      const kids = IM_STOCK_ONLY ? group.kids.filter(kid => imStockOk(kid)) : group.kids;
      kids.forEach(kid => IM_SEL.add(kid.sku));
      imListRender();
      return imMsg(`Ticked all ${kids.length} children of ${key}${IM_STOCK_ONLY && kids.length < group.kids.length ? ' with stock' : ''}.`);
    }
    const p = group.parent;
    imClipCopyOne({ brand: $('imBrand').value, sku: p.sku, asin: p.asin, c: '', z: '', psku: p.sku, slot: 'MAIN', url: (p.img || {}).MAIN || (p.live || {}).MAIN });
    imListRender();
    return imMsg(`Copied the main picture of ${p.sku} into the clipboard's Main slot.`);
  }
  // A click on a family's header (not on its buttons or picture) opens / closes it, like ▸.
  const head = on('.im-grp-h');
  if (head && !on('button,a,input,label,.im-tw')) {
    const card = head.closest('.im-grp');
    if (card && card.dataset.grp) return imFamToggle(card.dataset.grp);
  }
  if (on('#imClearFilter')) {
    $('imFilter').value = 'all';
    $('imQ').value = '';
    return imListAgain();
  }
  if (on('[data-selclear]')) {
    IM_SEL.clear();
    return imListRender();
  }
});
// The viewer's buttons; a click on the dark backdrop closes it.
$('imViewer').addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-vw]') : null;
  if (btn) return imViewAct(btn.dataset.vw);
  if (e.target === $('imViewer')) imViewClose();
});
// Replace: the file chosen goes into that slot once the editor has the listing.
$('imFile2').addEventListener('change', () => imReplaceFile($('imFile2').files && $('imFile2').files[0]));
// Comfortable / Compact.
document.querySelectorAll('[data-im-dense]').forEach(btn => btn.addEventListener('click', () => imDensity(btn.dataset.imDense)));
imDensity(IM_DENSE, true);
// Esc closes the editor panel (a popup open on top closes first, by its own Esc).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || IM_VW || !$('imEditWrap') || $('imEditWrap').classList.contains('hide')) return;
    if ($('spModal') && !$('spModal').classList.contains('hide')) return;
    $('imBack').onclick();
  });
}
/* KEYBOARD (the "?" popup lists it): / search · Esc close · ← → in the viewer · E edit · C copy · V paste preview · ? help.
 * E and C act on what the mouse is over (a tile: that picture; a row: the listing) or on the viewer's picture. Never while typing. */
let IM_HOVER = { sku: '', slot: '' };
let IM_HELP = false;
const IM_KEYS = [['/', 'Search'], ['Esc', 'Close the viewer, the editor or a popup'], ['← →', 'Previous / next picture in the viewer'],
  ['E', 'Edit the listing under the mouse (or in the viewer)'], ['C', 'Copy the picture under the mouse — over a row\'s text: all its pictures'],
  ['V', 'Preview pasting the clipboard into the ticked listings'],
  ['Space', 'On a picture: pick it up — ← → move it inside its listing, Space puts it down, Esc puts it back (a draft: nothing is sent until Send)'],
  ['Esc', 'Cancel a drag, close the Replace menu, or forget "1 picture copied"'], ['?', 'This help']];
function imHelpHtml() {
  return `<div class="im-pv im-help" role="document"><div class="im-pv-top"><b>Image Manager — keys and tips</b></div><div class="im-pv-list">`
    + `<table class="im-keys">${IM_KEYS.map(([k, t]) => `<tr><td><kbd>${imEsc(k)}</kbd></td><td>${imEsc(t)}</td></tr>`).join('')}</table>`
    + '<p class="muted">Click a picture to see it large. Shift+click a tick to tick every listing in between. Ctrl / ⌘ + click a picture opens it in a new tab.</p></div>'
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
  // rearranging (6b): Esc cancels a drag / closes the Replace menu; a picture picked up with Space moves with ← →
  if (IM_LD && key === 'Escape') { imDragEnd(false); return true; }
  if (IM_MENU && key === 'Escape') { imReplMenuClose(); return true; }
  if (IM_KSEL) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const to = IM_SLOTS[IM_SLOTS.indexOf(IM_KSEL.slot) + (key === 'ArrowLeft' ? -1 : 1)];
      if (to && imMove(IM_KSEL.sku, IM_KSEL.slot, to) === true) { IM_KSEL.slot = to; imKselFocus(); }
      return true;
    }
    if (key === ' ' || key === 'Enter') { const was = IM_KSEL; IM_KSEL = null; imRowRedraw(was.sku); imKselFocus(was); imMsg(`Put down in ${was.slot}. Nothing is sent until Send.`); return true; }
    if (key === 'Escape') {
      const was = IM_KSEL;
      IM_KSEL = null;
      if (was.start) IM_DRAFT.set(was.sku, was.start); else IM_DRAFT.delete(was.sku);
      imRowRedraw(was.sku);
      imMsg('Put back where it was.');
      return true;
    }
  }
  const pickTile = !IM_VW && key === ' ' && e.target && e.target.closest ? e.target.closest('.im-tw[data-drag]') : null;
  if (pickTile) {
    const d = IM_DRAFT.get(pickTile.dataset.sku);
    IM_KSEL = { sku: pickTile.dataset.sku, slot: pickTile.dataset.slot, start: d ? JSON.parse(JSON.stringify(d)) : null };
    imRowRedraw(IM_KSEL.sku);
    imKselFocus();
    imMsg(`Picked up ${IM_KSEL.slot} — ← → to move it, Space to put it down, Esc to cancel.`);
    return true;
  }
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
  if (key === 'Escape' && IM_ONE) return imOneClear();                 // "1 picture copied · Esc to cancel"
  if (key === '/') { $('imQ').focus(); if ($('imQ').select) $('imQ').select(); return true; }
  if (key === '?') { imHelp(true); return true; }
  if (k === 'e' && IM_HOVER.sku) { imEditOpen(IM_HOVER.sku); return true; }
  if (k === 'c' && IM_HOVER.sku) {
    const item = imItem(IM_HOVER.sku);
    if (!item) return false;
    if (IM_HOVER.slot) {
      const slot = IM_HOVER.slot;
      const url = IML_VIEW === 'live' ? ((item.live || {})[slot] || (item.img || {})[slot]) : ((item.img || {})[slot] || (item.live || {})[slot]);
      if (!url) return false;
      imClipCopyOne({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, slot, url });
      imOneCopy(item, slot, url);
      imMsg('Copied ' + (slot === 'SWCH' ? 'the swatch' : slot) + ' of ' + item.sku + ' to the clipboard.');
    } else {
      imClipTake({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, own: item.img || {}, live: item.live || {} });
      imMsg('Copied ' + IM_CLIP.n + ' picture(s) from ' + item.sku + '.');
    }
    imListRender();
    return true;
  }
  if (k === 'v') {
    if (IM_CLIP && IM_SEL.size) imPastePreview([...IM_SEL]);
    else imMsg(IM_CLIP ? 'Tick the listings to paste into, then press V.' : 'Copy a listing or a picture first (C), tick listings, then press V.');
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
  const tile = e.target && e.target.closest ? e.target.closest('.im-tw') : null;
  const row = e.target && e.target.closest ? e.target.closest('.im-kid') : null;
  IM_HOVER = { sku: (tile && tile.dataset.sku) || (row && row.dataset.sku) || '', slot: (tile && tile.dataset.slot) || '' };
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
/* ----- rearranging (6b): the MAIN question, the before → after preview, the Replace menu, dragging ----- */
// The keys' picked-up picture: focus its tile again after the row is drawn again.
function imKselFocus(was) {
  const k = was || IM_KSEL;
  if (!k || typeof document === 'undefined' || !document.querySelector) return;
  const tw = document.querySelector(`#imList .im-tw[data-sku="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(k.sku) : k.sku}"][data-slot="${k.slot}"]`);
  const link = tw && tw.querySelector ? tw.querySelector('a.im-th') : null;
  if (link && link.focus) link.focus({ preventScroll: true });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const on = sel => (e.target && e.target.closest ? e.target.closest(sel) : null);
    const q = on('[data-im-mainq]');
    if (q && IM_MAINQ) {
      const job = IM_MAINQ;
      IM_MAINQ = null;
      imModal('');
      if (q.dataset.imMainq === 'yes') imDraftSet(job.sku, job.next, job.notes);
      return;
    }
    const pv = on('[data-im-dpv]');
    if (pv && IM_DPV) {
      if (pv.dataset.imDpv === 'go') return imDraftSend(IM_DPV.sku);
      IM_DPV = null;
      return imModal('');
    }
    if (!IM_MENU) return;
    const use = on('[data-rm-use]');
    if (use) return imReplPick({ url: use.dataset.rmUse, note: use.dataset.rmNote });
    if (on('[data-rm-upload]')) return imReplPick({ upload: true });
    if (!on('#imRmenu') && !on('[data-repl]')) imReplMenuClose();
  });
  // the list moves under an open menu: it closes
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('scroll', () => { if (IM_MENU) imReplMenuClose(); }, { passive: true });
  // dragging a picture (mouse at once; touch after holding it a moment, so a swipe still scrolls the page)
  $('imList').addEventListener('pointerdown', e => {
    if (IM_LD || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const tw = e.target && e.target.closest ? e.target.closest('.im-tw[data-drag]') : null;
    if (!tw || e.target.closest('button')) return;
    IM_LD = { sku: tw.dataset.sku, from: tw.dataset.slot, el: tw, x0: e.clientX, y0: e.clientY, on: false, ghost: null, target: null, touch: e.pointerType === 'touch', timer: 0 };
    if (IM_LD.touch) IM_LD.timer = setTimeout(() => { if (IM_LD && !IM_LD.on) { imDragStart(); imDragMove({ clientX: IM_LD.x0, clientY: IM_LD.y0 }); } }, 300);
  });
  document.addEventListener('pointermove', e => { if (IM_LD) imDragMove(e); });
  document.addEventListener('pointerup', () => { if (IM_LD) imDragEnd(true); });
  document.addEventListener('pointercancel', () => { if (IM_LD) imDragEnd(false); });
  document.addEventListener('touchmove', e => { if (IM_LD && IM_LD.on && e.cancelable) e.preventDefault(); }, { passive: false });
}
// Sizes measured on screen (image-quality.js) move the "Too small" card.
IMQ.onSize = imCardsSoon;
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', imStick);
