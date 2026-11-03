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

const IML = {};                 // brand -> {at, items}
let IML_DIRTY = false;          // the snapshot changed since it was drawn
let IML_PAGE = 0;               // page of the list on screen (0-based)
let IML_BUSY = false;           // a rebuild from Amazon is running
const IML_PER = 40;             // listings per screen
const IML_CHUNK = 500;          // listings per Firestore chunk doc
let IML_VIEW = 'mine';          // which picture a tile shows first: ours, or what Amazon serves
let IM_OWNER = new Map();       // image file -> the listing of ours that submitted it

let IM_CLIP = null;     // { brand, sku, asin, c, z, slots: {MAIN..PT08, SWCH}, n }
const IM_SEL = new Set();   // SKUs ticked in the list, for pasting into several at once
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
    el.className = bad ? 'err' : 'muted';
  }
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

/* ============================================================================================
 * 3. SWITCHING VIEWS — tab entry, list ⇄ editor
 */

// First visit to the tab (called from showTab).
function ensureImg() { imListEnsure(); }

// Show the editor (true) or the list (false).
function imShowEditor(on) {
  $('imEditWrap').classList.toggle('hide', !on);
  $('imListWrap').classList.toggle('hide', on);
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
  if (!(brand in IML)) await imListLoad(brand);
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
    }
    // --- read every window, page by page ---
    for (const [from, to] of wins) {
      let token = '';
      do {
        imMsg('Reading ' + name + ' listings from Amazon… ' + items.length);
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

// Does one listing pass the filter picker (`filter`) and the search box (`search`, lower case)?
function imKidMatch(item, filter, search) {
  const live = item.live || {};
  const img = item.img || {};
  if (search) {
    const hay = [item.sku, item.asin, item.pa, item.psku, item.t, item.c, item.z].join(' ').toLowerCase();
    if (!search.split(/\s+/).every(word => hay.includes(word))) return false;
  }
  if (filter === 'diff') return IM_SLOTS.some(slot => img[slot] && live[slot] && img[slot] !== live[slot]);
  if (filter === 'few') return IM_SLOTS.filter(slot => live[slot] || img[slot]).length < 7;
  if (filter === 'noswatch') return !img.SWCH && !live.SWCH;
  if (filter === 'other') return !!imHijack(item);
  if (filter === 'sup') return imState(item).k === 'sup';
  if (filter === 'amzerr') return (item.ie || 0) > 0;
  if (filter === 'noown') return imNoOwnMain(item);
  if (filter === 'nobuy') return !/BUYABLE/.test(item.st || '');
  return true;
}

/* ============================================================================================
 * 6. LIST: DRAWING — tiles, one row per child, the page
 */

// One thumbnail in a listing's strip; `sw` marks the swatch tile. An orange ring = live and submitted pictures differ.
function imTile(slot, liveUrl, mineUrl, sw) {
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
    + `<img src="${imEsc(imThumb(url))}" loading="lazy" decoding="async" alt="${slot}">${sw ? '' : `<i>${label}</i>`}</a>`;
}

// One child listing's row: SKU / ASIN, colour · size, the status chip, Edit / Copy, the warnings, and the strip of tiles.
function imKidRow(item) {
  const live = item.live || {};
  const img = item.img || {};
  const tiles = IM_SLOTS.map(slot => imTile(slot, live[slot], img[slot])).join('')
    + '<span style="width:8px"></span>' + imTile('SWCH', live.SWCH, img.SWCH, true);
  const state = imState(item);
  const hijack = imHijack(item);
  const chip = (text, fill, ink, tip) => `<span class="st" style="background:${fill};color:${ink}"`
    + `${tip ? ` title="${imEsc(tip)}"` : ''}>${imEsc(text)}</span>`;
  return `<div class="im-kid">
    <div class="im-kid-info">
      <div><b style="font-family:ui-monospace,monospace">${imEsc(item.sku)}</b> <span class="muted">${imEsc(item.asin)}</span></div>
      <div class="muted">${imEsc([item.c, item.z].filter(Boolean).join(' · ') || String(item.t || '').slice(0, 60))}</div>
      <div style="margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="checkbox" class="im-sel" data-sku="${imEsc(item.sku)}" ${IM_SEL.has(item.sku) ? 'checked' : ''}
          title="Tick to paste the copied stack into this listing" style="width:auto;margin:0">
        ${chip(state.label, state.fill, state.ink, state.k === 'sup'
          ? 'Amazon still allows a direct-link sale but has taken this listing out of search results.' : '')}
        <button class="ghost im-b" data-edit="${imEsc(item.sku)}">Edit</button>
        <button class="ghost im-b" data-copy="${imEsc(item.sku)}" title="Copy this listing's pictures">Copy</button></div>
      ${item.ie ? `<div style="margin-top:3px">${chip('Amazon: ' + item.ie + ' error' + (item.ie > 1 ? 's' : ''), 'var(--bad-bg)', 'var(--bad-ink)', item.im || '')}</div>
        <div class="muted" style="font-size:10.5px;margin-top:2px">${imEsc(String(item.im || '').slice(0, 90))}${String(item.im || '').length > 90 ? '…' : ''}</div>` : ''}
      ${imNoOwnMain(item) ? `<div style="margin-top:3px">${chip('No image of your own', 'var(--act-bg)', 'var(--act-ink)',
        'Your listing submitted no main image. What shows on Amazon comes from the family, and Amazon can suppress a listing for it.')}</div>` : ''}
      ${hijack ? `<div style="margin-top:3px">${chip('Amazon shows ' + hijack.sku + (hijack.c ? ' · ' + hijack.c : ''), 'var(--act-bg)', 'var(--act-ink)',
        'Amazon catalogue serves ' + hijack.sku + ' pictures on this ASIN. The strip shows your own.')}</div>` : ''}
    </div>
    <div class="im-strip">${tiles}</div>
  </div>`;
}

// Draw the list: group by parent, apply the filter and the search, page by listing, then wire the buttons.
function imListRender() {
  const el = $('imList');
  if (!el) return;
  const brand = $('imBrand').value;
  const data = IML[brand];
  if (!data) {
    el.innerHTML = `<div class="card" style="padding:14px"><span class="muted">${IML_BUSY
      ? 'Reading every listing from Amazon for the first time — about two minutes.'
      : 'No snapshot yet. Press Refresh from Amazon.'}</span></div>`;
    return;
  }
  // --- which listings, in which groups ---
  const filter = $('imFilter').value;
  const search = ($('imQ').value || '').trim().toLowerCase();
  IML_VIEW = ($('imView') || {}).value || 'mine';
  imOwnerBuild(data.items);
  const groups = [];
  imListGroups(data.items).forEach(group => {
    let show = group.kids.filter(kid => imKidMatch(kid, filter, search));
    // A search that names the PARENT shows the whole family.
    if (!show.length && search && group.parent && imKidMatch(group.parent, 'all', search)) show = group.kids.filter(kid => imKidMatch(kid, filter, ''));
    if (show.length) groups.push(Object.assign({}, group, { show }));
  });
  groups.sort((a, b) => (b.kids.length - a.kids.length)
    || String((a.parent || a.kids[0]).t || '').localeCompare(String((b.parent || b.kids[0]).t || '')));
  const nKids = groups.reduce((sum, group) => sum + group.show.length, 0);
  // --- the page: IML_PER listings, a family may run over the page edge ---
  /* PAGED BY LISTING, not by parent: one Ridhi parent holds 455 children, and twenty groups a page
   * drew 6 MB of tiles. A family longer than a page carries on, its header repeated as "continued". */
  const pages = Math.max(1, Math.ceil(nKids / IML_PER));
  if (IML_PAGE >= pages) IML_PAGE = 0;
  const from = IML_PAGE * IML_PER;
  const to = from + IML_PER;
  const slice = [];
  let at = 0;
  groups.forEach(group => {
    const start = Math.max(from, at);
    const end = Math.min(to, at + group.show.length);
    if (start < end) slice.push(Object.assign({}, group, { show: group.show.slice(start - at, end - at), cont: start > at }));
    at += group.show.length;
  });
  const pager = pages > 1 ? `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:6px 0">
      <button class="ghost im-b" data-pg="-1" ${IML_PAGE ? '' : 'disabled'}>◀ Prev</button>
      <span class="muted" style="font-size:12px">Page ${IML_PAGE + 1} of ${pages}</span>
      <button class="ghost im-b" data-pg="1" ${IML_PAGE < pages - 1 ? '' : 'disabled'}>Next ▶</button></div>` : '';
  // --- the summary line, the clipboard bar, the groups ---
  const kids0 = data.items.filter(item => item.lvl !== 'parent');
  const nHijack = kids0.filter(imHijack).length;
  const nSup = kids0.filter(item => imState(item).k === 'sup').length;
  const nErr = kids0.filter(item => (item.ie || 0) > 0).length;
  el.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">${groups.length} group(s), ${nKids} listing(s) of ${data.items.length}
      · snapshot ${data.at ? data.at.toLocaleString() : '—'}${IML_BUSY ? ' · refreshing…' : ''}
      · showing <b>${IML_VIEW === 'live' ? 'what Amazon serves' : 'the pictures you submitted'}</b>
      · <span style="color:var(--act-ink)">orange ring</span> = Amazon serves a different picture in that slot
      ${nHijack ? `· <b style="color:var(--act-ink)">${nHijack}</b> carry another SKU's pictures` : ''}
      ${nSup ? `· <b style="color:var(--bad-ink)">${nSup}</b> suppressed from search` : ''}
      ${nErr ? `· <b style="color:var(--bad-ink)">${nErr}</b> with an error from Amazon` : ''}</div>
    ${imClipBar('list')}
    ${pager}
    ${slice.map(group => {
      const parent = group.parent;
      const head = parent
        ? `<div class="im-grp-h">${imTile('MAIN', (parent.live || {}).MAIN, (parent.img || {}).MAIN)}
            <div style="min-width:0;flex:1"><div style="font-weight:600">${imEsc(parent.t)}</div>
            <div class="muted" style="font-size:12px">Parent ${imEsc(parent.sku)} · ${imEsc(parent.asin)} · ${group.kids.length} child listing(s)`
            + `${group.show.length < group.kids.length ? ', ' + group.show.length + ' on this page' : ''}${group.cont ? ' · continued' : ''}</div></div></div>`
        : group.psku
          ? `<div class="im-grp-h"><div style="font-weight:600">Parent ${imEsc(group.psku)}</div>`
            + `<span class="muted" style="font-size:12px">${imEsc(group.kids[0].pa || '')} · ${group.kids.length} child listing(s) · the parent listing itself was not found${group.cont ? ' · continued' : ''}</span></div>`
          : `<div class="im-grp-h"><div style="font-weight:600">${imEsc(group.kids[0].t)}</div><span class="muted" style="font-size:12px">No variation parent</span></div>`;
      return `<div class="card im-grp">${head}${group.show.map(imKidRow).join('')}</div>`;
    }).join('')}
    ${pager}`;
  // --- the buttons in what was just drawn ---
  el.querySelectorAll('[data-copy]').forEach(btn => btn.onclick = () => {
    const item = (IML[$('imBrand').value] || { items: [] }).items.find(each => each.sku === btn.dataset.copy);
    if (!item) return;
    imClipTake({ brand: $('imBrand').value, sku: item.sku, asin: item.asin, c: item.c, z: item.z, own: item.img || {}, live: item.live || {} });
    imListRender();
    imMsg('Copied ' + IM_CLIP.n + ' picture(s) from ' + IM_CLIP.sku + '.');
  });
  el.querySelectorAll('.im-sel').forEach(cb => cb.onchange = () => {
    if (cb.checked) IM_SEL.add(cb.dataset.sku);
    else IM_SEL.delete(cb.dataset.sku);
    const pasteBtn = $('imPasteSel');
    if (pasteBtn) {
      pasteBtn.disabled = !IM_SEL.size;
      pasteBtn.textContent = 'Paste into ' + IM_SEL.size + ' ticked listing(s)';
    }
  });
  if ($('imClipClear')) $('imClipClear').onclick = () => {
    imClipClear();
    imListRender();
  };
  if ($('imPasteSel')) $('imPasteSel').onclick = () => imPasteMany([...IM_SEL]);
  el.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => {
    $('imQ').value = btn.dataset.edit;
    IM_SKU_CHOICES = null;
    imLoad(btn.dataset.edit);
    window.scrollTo(0, 0);
  });
  el.querySelectorAll('[data-pg]').forEach(btn => btn.onclick = () => {
    IML_PAGE += Number(btn.dataset.pg);
    imListRender();
    window.scrollTo(0, 0);
  });
}

/* ============================================================================================
 * 7. EDITOR: THE STACK — load one listing, draw it, reorder and replace slots
 */

// Open one listing in the editor: by the SKU picked from the choices, by ASIN, or by the SKU typed; then draw and load its history.
async function imLoad(skuPick) {
  const typed = ($('imQ').value || '').trim();
  if (!typed) {
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
      <div class="muted" style="font-size:10.5px${small ? ';color:var(--bad-ink)' : ''}">${dim || '&nbsp;'}${small ? ' · no zoom' : ''}</div>
      ${tools}
    </div>`;
}

// Draw the editor for the open listing: header, Amazon's issues, the live stack, your editable stack with Check / Apply, the history box.
function imRender() {
  const listing = IM;
  if (!listing) return;
  [...IM_SLOTS, 'SWCH'].forEach(slot => {
    if (IM_NOW[slot]) imMeasure(IM_NOW[slot]);
  });
  const cat = listing.catalog || {};
  const live = IM_SLOTS.map(slot => imCard(slot, cat[slot] && cat[slot].link, cat[slot] || {})).join('')
    + `<div class="im-sep"></div>` + imCard('SWCH', cat.SWCH && cat.SWCH.link, cat.SWCH || {});
  const mine = IM_SLOTS.map(slot => imCard(slot, IM_NOW[slot], { edit: true })).join('')
    + `<div class="im-sep"></div>` + imCard('SWCH', IM_NOW.SWCH, { edit: true });
  const changes = imChanges();
  const nChanges = Object.keys(changes).length;
  const choices = (listing.skuChoices && listing.skuChoices.length > 1)
    ? `<select id="imSku" style="width:auto;padding:3px 6px;font-size:12px">${listing.skuChoices.map(choice =>
        `<option value="${imEsc(choice.sku)}"${choice.sku === listing.sku ? ' selected' : ''}>${imEsc(choice.sku)}${
          choice.status ? ' · ' + imEsc(choice.status) : ''}</option>`).join('')}</select>`
    : `<b>${imEsc(listing.sku)}</b>`;
  const issues = (listing.issues || []).length
    ? `<div class="card" style="padding:10px 14px;margin-bottom:12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">Amazon's open issues on this listing</div>
        ${listing.issues.map(issue => `<div style="font-size:12px;margin:3px 0"><span class="st ${issue.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${
          imEsc(issue.severity)}</span> ${imEsc(issue.message)}</div>`).join('')}</div>` : '';
  const onlyCatalog = [...IM_SLOTS, 'SWCH'].filter(slot => !(listing.listing || {})[slot] && cat[slot]);
  /* The catalogue sometimes serves a sibling's whole stack on a listing of its own, most often one
   * with no offer. IM_OWNER, built for the list, can name that sibling. */
  const liveMain = cat.MAIN && cat.MAIN.link;
  const mineMain = (listing.listing || {}).MAIN;
  const hjOwn = liveMain && mineMain && liveMain !== mineMain ? IM_OWNER.get(liveMain) : null;
  const hjThis = hjOwn && hjOwn.sku !== listing.sku ? hjOwn : null;

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
      <div style="font-weight:600;font-size:13px">Live on Amazon now</div>
      <div class="muted" style="font-size:11.5px;margin-bottom:6px">What shoppers see. ${listing.catalogError ? imEsc(listing.catalogError) : ''}
        ${hjThis ? `<b style="color:var(--act-ink)">Amazon is serving ${imEsc(hjThis.sku)}${hjThis.c ? ' (' + imEsc(hjThis.c) + ')' : ''} pictures on this ASIN — your own stack, below, is the right one.</b>` : ''}</div>
      <div class="im-row">${live}</div>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-weight:600;font-size:13px">Your stack</div>
        <button class="ghost im-b" id="imCopy" title="Hold these pictures so they can be put on another listing">Copy this stack</button>
        ${IM_CLIP && IM_CLIP.sku !== listing.sku ? `<button class="ghost im-b" id="imPaste" title="Put ${imEsc(IM_CLIP.sku)}'s pictures in every slot">Paste ${imEsc(IM_CLIP.sku)}</button>
          <button class="ghost im-b" id="imPasteGaps" title="Only fill the slots that are empty">Fill the empty slots</button>
          <label class="muted" style="font-size:11.5px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="imPasteSw" style="width:auto"> with its swatch</label>` : ''}
        <span class="muted" style="font-size:11.5px">Drag to reorder. Nothing reaches Amazon until Apply.</span>
      </div>

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
    <div class="card" style="padding:10px 14px;margin-bottom:12px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">Changes sent for this SKU</div>
      <div id="imHist" class="muted" style="font-size:12px">…</div>
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
      // A dropped FILE goes into this slot; a dragged card moves here and the rest shift along.
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
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
  // --- Copy this stack / Paste / Fill the empty slots ---
  const copyBtn = $('imCopy');
  if (copyBtn) copyBtn.onclick = () => {
    const cat = (IM && IM.catalog) || {};
    const live = {};
    [...IM_SLOTS, 'SWCH'].forEach(slot => { if (cat[slot] && cat[slot].link) live[slot] = cat[slot].link; });
    imClipTake({ brand: IM.brand, sku: IM.sku, asin: IM.asin, c: IM.color, z: IM.size, own: IM_NOW, live });
    imRender();
    imMsg('Copied ' + IM_CLIP.n + ' picture(s) from ' + IM_CLIP.sku + '. Open another listing and press Paste.');
  };
  const paste = gapsOnly => {
    if (!IM_CLIP) return;
    const withSw = $('imPasteSw') && $('imPasteSw').checked;
    let nFilled = 0;
    IM_SLOTS.forEach(slot => {
      const url = IM_CLIP.slots[slot] || '';
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
  };
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
    IM_NOW[slot] = reply.url;
    imRender();
    imMsg('Uploaded into ' + slot + '. Not on Amazon yet — press Apply.');
  } catch (e) {
    imMsg(String(e.message || e), true);
  }
}

// Check (apply = false) or Apply (apply = true) the changed slots through imPost, and show what Amazon answered.
async function imSend(apply) {
  const set = imChanges();
  const nChanges = Object.keys(set).length;
  if (!nChanges) return;
  if (apply && !confirm('Send ' + nChanges + ' image change(s) for ' + IM.sku + ' to Amazon?\n\n'
      + Object.entries(set).map(([slot, url]) => slot + ': ' + (url ? 'new picture' : 'remove')).join('\n')
      + '\n\nAmazon checks it first; if it reports an error nothing is sent.')) return;
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
// src: { brand, sku, asin, c, z, own: { slot: url }, live: { slot: url } }.
function imClipTake(src) {
  const slots = {};
  [...IM_SLOTS, 'SWCH'].forEach(slot => {
    const url = src.own[slot] || src.live[slot] || '';
    if (url) slots[slot] = url;
  });
  IM_CLIP = { brand: src.brand, sku: src.sku, asin: src.asin || '', c: src.c || '', z: src.z || '',
    slots, n: IM_SLOTS.filter(slot => slots[slot]).length, at: Date.now() };
  imClipSave();
}

// Forget the copied stack.
function imClipClear() {
  IM_CLIP = null;
  imClipSave();
}

/** The banner that says what is held. Shown in both views so a copy is never invisible. */
// `where` is 'list' or 'editor': the list's banner also carries the swatch tick box and "Paste into N ticked listing(s)".
function imClipBar(where) {
  if (!IM_CLIP) return '';
  const clip = IM_CLIP;
  const main = clip.slots.MAIN || '';
  const sel = where === 'list' ? IM_SEL.size : 0;
  return `<div class="card" style="padding:8px 12px;margin-bottom:10px;border-color:var(--accent);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    ${main ? `<img src="${imEsc(imThumb(main))}" alt="" style="width:40px;height:40px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:4px">` : ''}
    <div style="min-width:0">
      <div style="font-size:12.5px"><b>Copied:</b> <span style="font-family:ui-monospace,monospace">${imEsc(clip.sku)}</span>
        ${clip.c ? '<span class="muted"> · ' + imEsc(clip.c) + '</span>' : ''}
        <span class="muted"> · ${clip.n} picture(s)${clip.slots.SWCH ? ' + swatch' : ''}</span></div>
      <div class="muted" style="font-size:11px">Nothing has been sent. Open a listing and paste, or tick listings below and paste into all of them.</div>
    </div>
    <span style="flex:1"></span>
    ${where === 'list' ? `<label class="muted" style="font-size:11.5px;display:flex;gap:4px;align-items:center">
        <input type="checkbox" id="imClipSw" style="width:auto"> also the swatch</label>
      <button class="ghost im-b" id="imPasteSel" ${sel ? '' : 'disabled'}>Paste into ${sel} ticked listing(s)</button>` : ''}
    <button class="ghost im-b" id="imClipClear">Forget it</button>
  </div>
  <div id="imBulk" class="muted" style="font-size:12px;margin-bottom:8px"></div>`;
}

/* PASTE INTO SEVERAL LISTINGS. One send per SKU, each previewed by Amazon first (the backend only
 * sends for real when the preview is clean), each reported on its own line. It stops after three
 * failures in a row, because the fourth will fail the same way and the rest can wait for a fix. */
// Paste the copied stack into every ticked SKU: one send each, applied straight away (the backend previews first), reported line by line.
async function imPasteMany(skus) {
  if (!IM_CLIP || !skus.length) return;
  const brandKey = $('imBrand').value;
  const items = (IML[brandKey] || { items: [] }).items;
  const by = new Map(items.map(item => [item.sku, item]));
  const withSw = $('imClipSw') && $('imClipSw').checked;
  // --- warn when the targets are a different colour from the copied listing ---
  const colours = [...new Set(skus.map(each => (by.get(each) || {}).c).filter(Boolean))];
  const warn = colours.filter(colour => colour && IM_CLIP.c && colour !== IM_CLIP.c);
  if (!confirm('Put ' + IM_CLIP.sku + "'s " + IM_CLIP.n + ' picture(s)' + (withSw ? ' and its swatch' : '')
      + ' on ' + skus.length + ' listing(s)?\n\n' + skus.slice(0, 12).join(', ') + (skus.length > 12 ? ' …' : '')
      + (warn.length ? '\n\nCAREFUL: ' + warn.length + ' of them are a different colour (' + warn.slice(0, 4).join(', ')
        + ') and ' + IM_CLIP.sku + ' is ' + IM_CLIP.c + '.' : '')
      + '\n\nAmazon checks each one first; any it objects to is skipped and named.')) return;
  // --- one send per SKU: only the slots that differ, stop after three refusals in a row ---
  const out = $('imBulk');
  $('imPasteSel').disabled = true;
  let done = 0;
  let failed = 0;
  let refusals = 0;     // refusals in a row
  const lines = [];
  for (const sku of skus) {
    const row = by.get(sku);
    if (!row) {
      lines.push(sku + ' — not in this snapshot');
      continue;
    }
    const set = {};
    IM_SLOTS.forEach(slot => {
      const url = IM_CLIP.slots[slot];
      if (url && (row.img || {})[slot] !== url) set[slot] = url;
    });
    if (withSw && IM_CLIP.slots.SWCH && (row.img || {}).SWCH !== IM_CLIP.slots.SWCH) set.SWCH = IM_CLIP.slots.SWCH;
    if (!Object.keys(set).length) {
      lines.push(sku + ' — already holds these');
      continue;
    }
    if (!row.pt) {
      lines.push(sku + ' — no product type in the snapshot; open it and paste there');
      continue;
    }
    out.innerHTML = 'Sending ' + (done + failed + 1) + ' of ' + skus.length + '…<br>' + lines.join('<br>');
    let reply;
    try {
      reply = await imPost({ limg: 'patch', brand: brandKey, sku, productType: row.pt, set, apply: true, by: ME.email });
    } catch (e) {
      reply = { ok: false, error: String(e.message || e) };
    }
    if (reply.ok && !reply.previewOnly) {
      done++;
      refusals = 0;
      row.img = Object.assign({}, row.img, set);        // what was sent, so the strip stops lying
      lines.push('<span style="color:var(--accent-ink)">' + sku + ' — accepted (' + Object.keys(set).length + ' slot(s))</span>');
    } else {
      failed++;
      refusals++;
      lines.push('<span class="err">' + sku + ' — ' + imEsc(reply.error || 'refused') + '</span>');
      if (refusals >= 3) {
        lines.push('<b>Stopped after three refusals in a row.</b>');
        break;
      }
    }
  }
  out.innerHTML = '<b>' + done + ' sent, ' + failed + ' refused.</b> Amazon processes them in the background; '
    + 'press Refresh from Amazon later to see what is live.<br>' + lines.join('<br>');
  IML_DIRTY = true;
  IM_SEL.clear();
  imListRender();
  $('imBulk').innerHTML = out.innerHTML;
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

// Back from the editor to the list, redrawing it if a send changed anything.
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
// Brand changed: page 1, nothing ticked, back to the list, that brand's snapshot.
$('imBrand').onchange = () => {
  IML_PAGE = 0;
  IM_SEL.clear();
  imShowEditor(false);
  imListEnsure();
};
// Refresh from Amazon: rebuild this brand's snapshot.
$('imRefresh').onclick = () => imListBuild($('imBrand').value);
