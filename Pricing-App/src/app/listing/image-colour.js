/* ================= LISTING · IMAGE MANAGER · BY COLOUR, COPY TO SIMILAR, GUIDED COPY =================
 * Screens: Image Manager (tab 'img'), next to its List view:
 *   1. BY COLOUR — inside each family, one row per colour: its sizes as chips (✓ same pictures as the colour, ≠ differs) and the
 *      COLOUR STACK (MAIN, 01–08, swatch = what most sizes of that colour have, slot by slot). Sync N sizes / Edit stack / Copy to
 *      another colour. "Per-size slots" (default 06 = size chart) are never part of the colour stack and never synced.
 *   2. COPY TO SIMILAR — a popup: the source (one listing, a colour stack or one picture) with tickable slots on the left, the
 *      suggested listings on the right (same colour, same size, whole family, no main, ticked, search), old → new per slot.
 *   3. GUIDED COPY — the same popup, one question per screen: from → which pictures → into → check & send.
 * Does: everything is worked out in memory from the saved list snapshot (IML); nothing is read from Amazon here. Every send goes
 *       through sqSendWithCheck (listing-send-check.js), the one send path: Amazon checks first, the person approves.
 * Uses from image-manager.js: IML, IM_SLOTS, IM_SEL, IM_CLIP, imListGroups, imGroupKey, imRowsHtml, imTileA, imBfOf, imBfDot,
 *       imPicErrs, imNoMain, imNoOwnMain, imState, imKidMatch, imEditOpen, imListRender, imModal, imMsg, imEsc, imThumbL.
 * Main functions: imcColours / imcStack / imcDiff (the colour view's sums), imcFamHtml / imcRowHtml (drawing), imcPlanRow / imcTargets /
 *                 imcJobs (the copy plan), imcCpOpen / imcCpHtml (the popup), imcSyncOpen, imcEditStack / imcEditSend (colour edit). */

/* ---------- state ---------- */
const IMC_ALL = [...IM_SLOTS, 'SWCH'];
const IMC_LAYOUT_KEY = 'sellora.imglayout';      // 'colour' (the default) | 'list', remembered in this browser
const IMC_PERSIZE_KEY = 'sellora.imgpersize';    // the per-size slots, remembered in this browser
let IMC_LAYOUT = 'colour';
let IMC_PERSIZE = ['PT06'];                      // 06 = the size chart: each size keeps its own
try {
  IMC_LAYOUT = localStorage.getItem(IMC_LAYOUT_KEY) === 'list' ? 'list' : 'colour';
  const kept = JSON.parse(localStorage.getItem(IMC_PERSIZE_KEY) || 'null');
  if (Array.isArray(kept)) IMC_PERSIZE = kept.filter(slot => IM_SLOTS.includes(slot) && slot !== 'MAIN');
} catch (e) { /* no storage: the defaults */ }
let IMC_CP = null;     // the copy popup while it is open (imcCpOpen)
let IMC_EDIT = null;   // { brand, sku, name, skus } while the editor edits a colour stack (imcEditStack)

/** Is the By colour view on? (image-manager.js asks, to draw a family's rows) */
const imcOn = () => IMC_LAYOUT === 'colour';
const imcSlotName = slot => (slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot.slice(2));

/* ---------- 1. the colour view's sums (pure: rows of the snapshot in, plain objects out) ---------- */
const imcColourKey = item => String((item && item.c) || '').trim().toLowerCase();
/** The picture a slot shows in the list (the one we sent, else what shoppers see) — what the colour stack is made of. */
const imcSlotVal = (item, slot) => (item.img || {})[slot] || (item.live || {})[slot] || '';
const imcPicCount = item => IM_SLOTS.filter(slot => imcSlotVal(item, slot)).length;
/** Sizes in tie-break order: Buyable first, then the most pictures, then by SKU. */
function imcRank(kids) {
  const buy = item => (imState(item).k === 'ok' ? 1 : 0);
  return kids.slice().sort((a, b) => (buy(b) - buy(a)) || (imcPicCount(b) - imcPicCount(a)) || String(a.sku).localeCompare(String(b.sku)));
}
/** THE COLOUR STACK: slot by slot, the picture most sizes show (an empty slot counts as a vote for empty); a tie goes to the picture of
 *  the first size in imcRank order that holds one of the tied pictures. { stack: { slot: url | '' }, lead: that first size }. */
function imcStack(kids) {
  const order = imcRank(kids);
  const stack = {};
  IMC_ALL.forEach(slot => {
    const votes = new Map();
    kids.forEach(kid => {
      const url = imcSlotVal(kid, slot);
      votes.set(url, (votes.get(url) || 0) + 1);
    });
    const top = Math.max(...votes.values());
    const tied = [...votes.keys()].filter(url => votes.get(url) === top);
    const lead = tied.length > 1 ? order.find(kid => tied.includes(imcSlotVal(kid, slot))) : null;
    stack[slot] = lead ? imcSlotVal(lead, slot) : tied[0];
  });
  return { stack, lead: order[0] };
}
/** The slots where one size differs from its colour stack: never a per-size slot, never a slot the stack leaves empty (Sync never removes). */
const imcDiff = (kid, stack, perSize) => IMC_ALL.filter(slot => !(perSize || []).includes(slot) && stack[slot] && imcSlotVal(kid, slot) !== stack[slot]);
/** A family's children grouped by colour (no colour → "No colour", last): [{ key, name, none, kids, stack, lead, sizes: [{ kid, diff }], nDiff }]. */
function imcColours(kids, perSize) {
  const by = new Map();
  kids.forEach(kid => {
    const key = imcColourKey(kid);
    if (!by.has(key)) by.set(key, { key, name: String(kid.c || '').trim() || 'No colour', none: !key, kids: [] });
    by.get(key).kids.push(kid);
  });
  const out = [...by.values()].map(colour => {
    const { stack, lead } = imcStack(colour.kids);
    const sizes = colour.kids.slice().sort((a, b) => String(a.z || a.sku).localeCompare(String(b.z || b.sku), 'en', { numeric: true }))
      .map(kid => ({ kid, diff: imcDiff(kid, stack, perSize) }));
    return Object.assign(colour, { stack, lead, sizes, nDiff: sizes.filter(size => size.diff.length).length, imcColour: true });
  });
  return out.sort((a, b) => (a.none - b.none) || a.name.localeCompare(b.name));
}

/* What is wrong with a size, worst first: r = an Amazon picture error, no main, shoppers see another picture in a slot; y = using the
 * family's main, a picture below 2000, not live yet. { lv: 'r' | 'y' | '', why: [text] } — the dot on its chip. */
function imcKidMark(kid) {
  const why = [];
  let lv = '';
  const add = (l, text) => {
    if (l === 'r' || !lv) lv = l === 'r' ? 'r' : lv || l;
    why.push(text);
  };
  const errs = imPicErrs(kid);
  if (errs.length) add('r', 'Amazon picture error: ' + errs[0].m);
  if (imNoMain(kid)) add('r', 'No main at all');
  else if (imNoOwnMain(kid)) add('y', 'Using the family\'s main');
  const bf = IM_SLOTS.map(slot => [slot, imBfOf((kid.live || {})[slot], (kid.img || {})[slot])]);
  const other = bf.filter(([, x]) => x.f === 'r').map(([slot]) => imcSlotName(slot));
  if (other.length) add('r', 'Shoppers see another picture in ' + other.join(', '));
  const notLive = bf.filter(([, x]) => x.f === 'u').map(([slot]) => imcSlotName(slot));
  if (notLive.length) add('y', 'Not live yet: ' + notLive.join(', '));
  const small = IM_SLOTS.filter(slot => { const wh = imqDims(imcSlotVal(kid, slot)); return wh && imqSize(wh[0], wh[1]) !== 'g'; });
  if (small.length) add('y', 'Below 2000: ' + small.map(imcSlotName).join(', '));
  return { lv, why };
}
const IMC_ATTR = slot => (slot === 'MAIN' ? 'main_product_image_locator' : slot === 'SWCH' ? 'swatch_product_image_locator' : 'other_product_image_locator_' + Number(slot.slice(2)));
const IMC_F_RANK = { g: 0, n: 1, u: 2, r: 3 };
/** One stack slot over the sizes of a colour: the worst B / F, Amazon errors naming that slot. { b, f, err: [sku] } */
function imcSlotMark(kids, slot) {
  let b = 'g';
  let f = 'g';
  const err = [];
  kids.forEach(kid => {
    const x = imBfOf((kid.live || {})[slot], (kid.img || {})[slot]);
    if (x.b === 'n') b = 'n';
    if (IMC_F_RANK[x.f] > IMC_F_RANK[f]) f = x.f;
    if (imPicErrs(kid).some(e => (e.a || []).includes(IMC_ATTR(slot)) || (slot === 'MAIN' && String(e.c) === '18320'))) err.push(kid.sku);
  });
  return { b, f, err };
}

/* ---------- 2. drawing the By colour view ---------- */
/** An open family in the By colour view: the family bar, then one row per colour (drawn in blocks as they come near, like the List's rows).
 *  Colours are worked out over EVERY child of the family; a filter or a search shows the colours that hold a matching size. */
function imcFamHtml(group) {
  const key = imGroupKey(group);
  const colours = imcColours(group.kids, IMC_PERSIZE);
  const shown = new Set(group.show.map(kid => kid.sku));
  const part = shown.size < group.kids.length;
  const rows = colours.filter(colour => colour.kids.some(kid => shown.has(kid.sku))).map(colour => Object.assign(colour, { fam: key, hit: part ? shown : null }));
  const bad = colours.filter(colour => colour.nDiff).length;
  const pick = `<select data-imc-slotpick="${imEsc(key)}" aria-label="Which slot">${IM_SLOTS.filter(slot => !IMC_PERSIZE.includes(slot)).map(slot =>
    `<option value="${slot}"${slot === 'PT03' ? ' selected' : ''}>${slot === 'MAIN' ? 'Main' : slot.slice(2)}</option>`).join('')}</select>`;
  const bar = `<div class="imc-fambar">${bad ? `<span class="im-chip is-att">${bad} colour${bad === 1 ? ' has' : 's have'} sizes that don't match</span>`
      : '<span class="im-chip is-ok">Every colour\'s sizes match</span>'}
    <span class="muted">${colours.length} colour${colours.length === 1 ? '' : 's'} · per size: ${IMC_PERSIZE.length ? IMC_PERSIZE.map(imcSlotName).join(', ') : 'none'}</span>
    <span style="flex:1"></span>
    ${colours.length > 1 ? `<span class="imc-setall">Set slot ${pick} <button type="button" class="ghost im-b" data-imc-setall="${imEsc(key)}" title="One picture in that slot for every colour (a shared picture, e.g. the hands photo) — the copy popup opens first">for all colours…</button></span>` : ''}</div>`;
  return bar + imRowsHtml(key, rows);
}
/** One colour's row: name, sizes as chips, the three buttons; on the right its stack. */
function imcRowHtml(colour) {
  const famKey = colour.fam;
  const data = `data-imc-fam="${imEsc(famKey)}" data-imc-col="${imEsc(colour.key)}"`;
  const chips = colour.sizes.map(({ kid, diff }) => {
    const mark = imcKidMark(kid);
    const hit = colour.hit && colour.hit.has(kid.sku) ? ' is-hit' : '';
    const tip = (diff.length ? 'Differs from the colour stack in: ' + diff.map(imcSlotName).join(', ') : 'Same pictures as the colour stack')
      + (mark.why.length ? ' · ' + mark.why.join(' · ') : '') + ' — click to edit ' + kid.sku;
    return `<button type="button" class="imc-sz ${diff.length ? 'is-diff' : 'is-same'}${hit}" data-imc-size="${imEsc(kid.sku)}" title="${imEsc(tip)}">`
      + `<span aria-hidden="true">${diff.length ? '≠' : '✓'}</span>${imEsc(kid.z || kid.sku)}${mark.lv ? `<i class="imc-mk is-${mark.lv}" aria-label="${mark.lv === 'r' ? 'problem' : 'check'}"></i>` : ''}</button>`;
  }).join('');
  const tiles = IMC_ALL.map(slot => imcStackTile(colour, slot)).join('');
  const n = colour.nDiff;
  return `<div class="imc-row" ${data}>
    <div class="imc-info">
      <div class="imc-name"><b>${imEsc(colour.name)}</b><span class="muted">${colour.kids.length} size${colour.kids.length === 1 ? '' : 's'}</span></div>
      <div class="imc-sizes">${chips}</div>
      <div class="imc-act">
        <button type="button" class="ghost im-b${n ? ' im-go' : ''}" data-imc-sync="1" ${n ? '' : 'disabled'} title="${n ? `Give the ${n} differing size(s) the colour stack (per-size slots kept) — a check popup first` : 'Every size already has the colour stack'}">${n ? `Sync ${n} size${n === 1 ? '' : 's'}` : 'All sizes match'}</button>
        <button type="button" class="ghost im-b" data-imc-edit="1" title="Open the editor: a change goes to every size of ${imEsc(colour.name)} (per-size slots excluded)">Edit stack</button>
        <button type="button" class="ghost im-b" data-imc-copy="1" title="Copy this colour's stack to other colours or listings">Copy to another colour</button>
      </div>
    </div>
    <div class="im-strip imc-stack">${tiles}</div>
  </div>`;
}
/** One tile of a colour stack: the picture, the worst B / F over its sizes, the size dot, a red mark for an Amazon error on that slot.
 *  Hover: View (the picture on a size that holds it) and Copy (that picture → the copy popup). A per-size slot says so instead. */
function imcStackTile(colour, slot) {
  const sw = slot === 'SWCH';
  const gap = sw ? '<span class="im-strip-gap"></span>' : '';
  if (IMC_PERSIZE.includes(slot)) {
    return gap + `<span class="im-tw imc-ps"><div class="im-th im-empty" title="${imEsc(imcSlotName(slot))}: per size — each size keeps its own; Sync and Edit stack never change it">${imEsc(imcSlotName(slot))}<small>per size</small></div></span>`;
  }
  const url = colour.stack[slot];
  const holder = (colour.kids.find(kid => url && imcSlotVal(kid, slot) === url) || colour.lead).sku;
  const tile = imTileA(slot, url, url, sw);
  if (!url) return gap + `<span class="im-tw${sw ? ' im-tw-sw' : ''}">${tile}</span>`;
  const mark = imcSlotMark(colour.kids, slot);
  const tag = sw ? '' : `<span class="im-bf${mark.b + mark.f !== 'gg' ? ' is-diff' : ''}" title="Worst over the ${colour.kids.length} size(s): B = the picture we sent, F = what shoppers see">B${imBfDot(mark.b)}F${imBfDot(mark.f)}</span>`;
  let dot = '';
  if (!sw) {
    const wh = imqDims(url);
    const size = wh ? imqSize(wh[0], wh[1]) : '';
    dot = size ? `<i class="imq-dot is-${size}" data-imq="${imEsc(imqId(url))}" title="${wh[0]} × ${wh[1]} — ${imEsc(IMQ_WORDS[size])}"></i>`
      : `<i class="imq-dot" data-imq="${imEsc(imqId(url))}" data-imq-url="${imEsc(url)}" title="Size not known yet"></i>`;
  }
  const err = mark.err.length ? `<i class="imc-err" title="Amazon picture error on ${imEsc(mark.err.join(', '))}">!</i>` : '';
  const acts = `<span class="im-tact"><button type="button" class="im-tview" data-view="${imEsc(holder)}" data-slot="${slot}" title="See it large">View</button>`
    + `<button type="button" class="im-tcopy" data-copy1="${imEsc(holder)}" data-slot="${slot}" data-url="${imEsc(url)}" title="Copy this picture to other listings">Copy</button></span>`;
  return gap + `<span class="im-tw${sw ? ' im-tw-sw' : ''}" data-sku="${imEsc(holder)}" data-slot="${slot}">${tile}${tag}${dot}${err}${acts}</span>`;
}
/** A colour of a family on screen, worked out again from the snapshot. */
function imcFind(famKey, colKey) {
  const data = IML[$('imBrand').value];
  if (!data) return null;
  const group = imListGroups(data.items).find(each => imGroupKey(each) === famKey);
  if (!group) return null;
  const colour = imcColours(group.kids, IMC_PERSIZE).find(each => each.key === colKey);
  return colour ? Object.assign(colour, { fam: famKey, group }) : null;
}

/* ---------- 3. the copy plan (pure) ---------- */
/** A source made from one listing (what Copy all copies: ours, else what shoppers see). Per-size slots start unticked. */
function imcSrcListing(item, brand, only) {
  const slots = {};
  IMC_ALL.forEach(slot => { const url = imcSlotVal(item, slot); if (url) slots[slot] = url; });
  return imcSrcTicks({ kind: 'listing', brand, sku: item.sku, asin: item.asin || '', c: item.c || '', z: item.z || '', psku: item.psku || '', pt: item.pt || '', slots,
    label: item.sku }, only);
}
/** The default ticks: one picture → only that slot; otherwise every slot with a picture, but not the swatch nor a per-size slot. */
function imcSrcTicks(src, only) {
  src.tick = {};
  Object.keys(src.slots).forEach(slot => {
    src.tick[slot] = only ? slot === only : slot !== 'SWCH' && !IMC_PERSIZE.includes(slot);
  });
  src.withSw = only === 'SWCH';
  return src;
}
/** A source made from a colour stack: its slots minus the per-size ones (never copied from a colour). */
function imcSrcColour(colour, brand) {
  const slots = {};
  IMC_ALL.forEach(slot => { if (!IMC_PERSIZE.includes(slot) && colour.stack[slot]) slots[slot] = colour.stack[slot]; });
  const parent = colour.group && colour.group.parent;
  return imcSrcTicks({ kind: 'colour', brand, sku: '', c: colour.none ? '' : colour.name, z: '', psku: (colour.group && colour.group.psku) || (parent && parent.sku) || '',
    pt: colour.kids[0].pt || '', fam: colour.fam, colKey: colour.key, slots, skus: colour.kids.map(kid => kid.sku), lead: colour.lead.sku,
    label: `${colour.name} — the colour stack (${colour.kids.length} size${colour.kids.length === 1 ? '' : 's'})` });
}
const imcSameColour = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
/** The pictures a paste puts in: the ticked slots of the source (the swatch only "with swatch"). */
function imcWant(src) {
  const out = {};
  Object.keys(src.slots).forEach(slot => {
    if (slot === 'SWCH' ? src.withSw : src.tick[slot]) out[slot] = src.slots[slot];
  });
  return out;
}
/** What the paste would do to ONE listing: { sku, row, set, state: 'change' | 'same' | 'nogap' | 'nopt', per: { slot: { q, wh, fail } },
 *  fixesMain, warn }. A colour stack into a size of the SAME colour gives only the slots that differ from it (what the chips show);
 *  anything else replaces a ticked slot when our listing holds another picture (as today's paste). mode 'gaps' leaves a filled slot. */
function imcPlanRow(src, row, mode) {
  const img = row.img || {};
  const live = row.live || {};
  const want = imcWant(src);
  const sync = src.kind === 'colour' && imcSameColour(row.c, src.c);
  const set = {};
  let filled = 0;
  Object.keys(want).forEach(slot => {
    if (sync && IMC_PERSIZE.includes(slot)) return;          // never a per-size slot of a size of the colour
    if (mode === 'gaps' && (img[slot] || live[slot])) { filled++; return; }
    const cur = sync ? imcSlotVal(row, slot) : img[slot] || '';
    if (cur !== want[slot]) set[slot] = want[slot];
  });
  const out = { sku: row.sku, row, set, per: {}, fixesMain: false, warn: false, state: 'change' };
  if (!Object.keys(set).length) return Object.assign(out, { state: filled ? 'nogap' : 'same' });
  if (!row.pt) return Object.assign(out, { state: 'nopt' });
  // --- the picture rules on each picture that would go in, in the stack it lands in (as the preview) ---
  const dups = imqDups(Object.assign({}, live, img, set));
  Object.keys(set).forEach(slot => {
    const wh = imqDims(set[slot]);
    const q = imqCheck({ slot, w: wh ? wh[0] : 0, h: wh ? wh[1] : 0, dup: dups[slot] });
    out.per[slot] = { q, wh, fail: q.level !== 'ok' };
  });
  out.warn = Object.values(out.per).some(p => p.fail);
  out.fixesMain = !!set.MAIN && (imNoMain(row) || imNoOwnMain(row));
  return out;
}
const IMC_TABS = [
  { k: 'colour', t: 'Same colour (other sizes)' },
  { k: 'size', t: 'Same size (other colours)' },
  { k: 'family', t: 'Whole family' },
  { k: 'nomain', t: 'Listings with no main' },
  { k: 'ticked', t: 'Ticked in the list' },
  { k: 'search', t: 'Search' },
];
const imcTabName = (src, k) => (k === 'size' && src.kind !== 'listing' ? 'Other colours' : (IMC_TABS.find(tab => tab.k === k) || {}).t || k);
/** The suggested listings, per tab: { colour, size, family, nomain, ticked, search } → [listing row]. Inside the source's family (its parent,
 *  else its product type — today's rule), except Search (the whole brand) and the ticks the person made. The source listing is never offered. */
function imcTargets(src, items, ticked, q) {
  const kids = items.filter(item => item.lvl !== 'parent' && item.sku !== src.sku);
  const family = kids.filter(item => (src.psku ? item.psku === src.psku : !!src.pt && item.pt === src.pt));
  const query = String(q || '').trim().toLowerCase();
  const out = {
    colour: family.filter(item => imcSameColour(item.c, src.c)),
    size: src.kind === 'listing' ? family.filter(item => src.z && item.z === src.z && !imcSameColour(item.c, src.c))
      : src.kind === 'colour' ? family.filter(item => !imcSameColour(item.c, src.c)) : [],
    family,
    nomain: family.filter(item => imNoMain(item) || imNoOwnMain(item)),
    ticked: kids.filter(item => ticked.has(item.sku)),
    search: query.length >= 2 ? kids.filter(item => imKidMatch(item, 'all', query)).slice(0, 60) : [],
  };
  if (src.kind === 'slot') out.colour = [];
  return out;
}
/** The plans of one tab, the ones that change first. */
const imcTabPlans = (cp, rows) => rows.map(row => imcPlanRow(cp.src, row, cp.mode))
  .sort((a, b) => ((a.state === 'change' ? 0 : 1) - (b.state === 'change' ? 0 : 1)) || String(a.row.c || '').localeCompare(String(b.row.c || '')) || String(a.row.z || a.sku).localeCompare(String(b.row.z || b.sku), 'en', { numeric: true }));
/** The ticked listings → the sends: a picture failing the rules is left out unless "Include anyway" is ticked. { jobs, held, pics } */
function imcJobs(cp, plans) {
  const jobs = [];
  const held = [];
  let pics = 0;
  plans.forEach(plan => {
    if (plan.state !== 'change' || !cp.picked.has(plan.sku)) return;
    const keep = Object.keys(plan.set).filter(slot => !(plan.per[slot] && plan.per[slot].fail) || cp.inc.has(plan.sku + '|' + slot));
    if (!keep.length) { held.push({ sku: plan.sku, why: 'every picture was left out (picture rules) — tick "Include anyway" to send it' }); return; }
    pics += keep.length;
    const row = plan.row;
    const img = row.img || {};
    const set = Object.fromEntries(keep.map(slot => [slot, plan.set[slot]]));
    jobs.push({ brand: cp.src.brand, sku: row.sku, asin: row.asin || '', label: [row.c, row.z].filter(Boolean).join(' · ') || row.sku, row,
      body: { limg: 'patch', brand: cp.src.brand, sku: row.sku, productType: row.pt, set },
      changes: keep.map(slot => ({ field: sqField(slot), old: img[slot] || '(none)', new: set[slot], pic: true, attr: slot, oldV: img[slot] || '' })) });
  });
  return { jobs, held, pics };
}

/* ---------- 4. the copy popup (and guided copy: the same popup, one step at a time) ---------- */
function imcItems() {
  return ((IML[$('imBrand').value] || { items: [] }).items || []);
}
/** Open the popup on a source. tab: the first tab shown (else the best one for that source); picked: the listings ticked to start with. */
function imcCpOpen(src, opts) {
  const o = opts || {};
  IMC_CP = { src, mode: 'replace', tab: '', q: '', inc: new Set(), picked: new Set(), all: false, guided: o.guided ? (src ? 2 : 1) : 0, gq: '' };
  if (src) imcTab(o.tab || imcBestTab(src), o.picked);
  imcDraw();
}
function imcBestTab(src) {
  if (src.kind === 'slot') return 'family';
  if (src.kind === 'colour') return 'size';
  const t = imcTargets(src, imcItems(), IM_SEL, '');
  return t.colour.length ? 'colour' : t.size.length ? 'size' : 'family';
}
/** Show a tab: its listings that would change are ticked (or exactly `picked`). */
function imcTab(k, picked) {
  const cp = IMC_CP;
  cp.tab = k;
  cp.all = false;
  const plans = imcTabPlans(cp, imcTargets(cp.src, imcItems(), IM_SEL, cp.q)[k] || []);
  cp.picked = new Set(plans.filter(plan => plan.state === 'change' && (!picked || picked.includes(plan.sku))).map(plan => plan.sku));
}
const imcPic = (url, cls) => (url ? `<span class="im-pv-pic${cls || ''}"><img src="${imEsc(imThumbL(url))}" alt="" loading="lazy"></span>` : `<span class="im-pv-pic is-none${cls || ''}">none</span>`);
// The left side: the source, its big main, a tick per slot, the quick picks, the mode.
function imcSrcHtml(cp) {
  const src = cp.src;
  const big = src.slots.MAIN || Object.values(src.slots)[0] || '';
  const cells = IM_SLOTS.map(slot => {
    const url = src.slots[slot];
    if (!url) {
      const why = src.kind === 'colour' && IMC_PERSIZE.includes(slot) ? 'per size' : 'empty';
      return `<span class="imc-cs is-empty" title="${imEsc(imcSlotName(slot))}: ${why}"><span class="im-cs-pic"></span><span>${imEsc(imcSlotName(slot))}</span><small>${why}</small></span>`;
    }
    return `<label class="imc-cs${src.tick[slot] ? ' is-on' : ''}" title="${imEsc(imcSlotName(slot))} — ticked = pasted"><span class="im-cs-pic"><img src="${imEsc(imThumbL(url))}" alt="" loading="lazy"></span>`
      + `<span><input type="checkbox" data-imc-tick="${slot}"${src.tick[slot] ? ' checked' : ''}> ${imEsc(imcSlotName(slot))}</span></label>`;
  }).join('');
  const has = slots => slots.some(slot => src.slots[slot]);
  const qp = (k, t, slots) => `<button type="button" class="ghost im-b" data-imc-qp="${k}" ${has(slots) ? '' : 'disabled'}>${t}</button>`;
  return `<div class="imc-src">
    <div class="imc-src-h"><span class="muted">Copy from</span> <b${src.kind === 'listing' ? ' class="im-mono"' : ''}>${imEsc(src.label)}</b>
      ${src.kind === 'listing' && (src.c || src.z) ? `<span class="muted">${imEsc([src.c, src.z].filter(Boolean).join(' · '))}</span>` : ''}</div>
    <div class="imc-big">${big ? `<img src="${imEsc(imThumbL(big).replace('._SL160_.', '._SL500_.'))}" alt="Main picture of the source">` : '<span class="muted">No picture</span>'}</div>
    <div class="imc-cs-list">${cells}</div>
    <div class="imc-qp"><span class="muted">Quick picks</span>${qp('all', 'All', IM_SLOTS)}${qp('main', 'Only main', ['MAIN'])}${qp('life', 'Lifestyle (01–05)', ['PT01', 'PT02', 'PT03', 'PT04', 'PT05'])}${qp('chart', 'Size chart (06)', ['PT06'])}</div>
    <div class="imc-mode im-seg" role="group" aria-label="How to paste">
      <label><input type="radio" name="imcMode" data-imc-mode="replace"${cp.mode === 'gaps' ? '' : ' checked'}> Replace ticked slots</label>
      <label><input type="radio" name="imcMode" data-imc-mode="gaps"${cp.mode === 'gaps' ? ' checked' : ''}> Only fill empty slots</label>
      <label title="${src.slots.SWCH ? 'Also the swatch picture' : 'The source has no swatch'}"><input type="checkbox" data-imc-sw="1"${src.withSw ? ' checked' : ''}${src.slots.SWCH ? '' : ' disabled'}> with swatch</label></div>
  </div>`;
}
// One suggested listing: tick, SKU, colour · size, old → new per changed slot, its chip.
function imcTargetHtml(cp, plan) {
  const row = plan.row;
  const on = plan.state === 'change' && cp.picked.has(plan.sku);
  const chip = plan.state === 'same' ? '<span class="im-chip">already the same (skipped)</span>'
    : plan.state === 'nogap' ? '<span class="im-chip">no empty slot to fill (skipped)</span>'
      : plan.state === 'nopt' ? '<span class="im-chip is-att">no product type in the snapshot — open it in the editor</span>'
        : `<span class="im-chip is-ok">${Object.keys(plan.set).length} change</span>${plan.fixesMain ? '<span class="im-chip is-ok">fixes No main</span>' : ''}${plan.warn ? '<span class="im-chip is-bad">quality warning</span>' : ''}`;
  const lines = plan.state !== 'change' ? '' : Object.keys(plan.set).map(slot => {
    const info = plan.per[slot] || { q: { chips: [] } };
    const key = plan.sku + '|' + slot;
    const inc = !info.fail || cp.inc.has(key);
    return `<span class="imc-ch${info.fail ? ' is-fail' : ''}${inc ? '' : ' is-out'}"><b>${imEsc(imcSlotName(slot))}</b>${imcPic((row.img || {})[slot] || (row.live || {})[slot])}<span class="im-pv-arrow" aria-hidden="true">→</span>${imcPic(plan.set[slot], ' is-new')}`
      + (info.fail ? `<span class="imc-ch-q">${imqChipsHtml(info.q.chips.filter(c => c.lv !== 'ok').slice(0, 2))}<label class="im-pv-inc"><input type="checkbox" data-imc-inc="${imEsc(key)}"${cp.inc.has(key) ? ' checked' : ''}> Include anyway</label></span>` : '')
      + '</span>';
  }).join('');
  return `<div class="imc-t${plan.state === 'change' ? '' : ' is-skip'}${on ? ' is-on' : ''}">
    <label class="imc-t-sel"><input type="checkbox" data-imc-pick="${imEsc(plan.sku)}"${on ? ' checked' : ''}${plan.state === 'change' ? '' : ' disabled'} aria-label="Tick ${imEsc(plan.sku)}"></label>
    <div class="imc-t-id"><b class="im-mono">${imEsc(plan.sku)}</b><span class="muted">${imEsc([row.c, row.z].filter(Boolean).join(' · ') || String(row.t || '').slice(0, 40))}</span><span class="imc-t-chips">${chip}</span></div>
    <div class="imc-t-ch">${lines}</div></div>`;
}
const IMC_SHOW = 60;     // listings drawn at once in a tab; "Show all N" draws the rest
// The right side: the tabs with their counts, the search box, the listings.
function imcTargetsHtml(cp, targets, plans) {
  const tabs = IMC_TABS.filter(tab => tab.k !== 'size' || cp.src.kind !== 'slot').filter(tab => tab.k !== 'colour' || cp.src.kind !== 'slot').map(tab => {
    const n = tab.k === 'search' && !cp.q ? '' : (targets[tab.k] || []).length;
    return `<button type="button" role="tab" class="imc-tab${cp.tab === tab.k ? ' is-on' : ''}" data-imc-tab="${tab.k}" aria-selected="${cp.tab === tab.k}">${imEsc(imcTabName(cp.src, tab.k))}${n === '' ? '' : ` <span>${n}</span>`}</button>`;
  }).join('');
  const search = cp.tab === 'search' ? `<label class="im-search imc-q"><input data-imc-q="1" value="${imEsc(cp.q)}" placeholder="Search SKU, ASIN, title, colour — the whole brand" aria-label="Search listings"></label>` : '';
  const nChange = plans.filter(plan => plan.state === 'change').length;
  const shown = cp.all ? plans : plans.slice(0, IMC_SHOW);
  const note = cp.tab === 'size' ? `<div class="imc-note">These are other colours — check each picture suits them.</div>` : cp.tab === 'search' ? '<div class="imc-note">Search reaches the whole brand, outside this family.</div>' : '';
  const list = plans.length ? shown.map(plan => imcTargetHtml(cp, plan)).join('')
    + (plans.length > shown.length ? `<button type="button" class="ghost im-b imc-more" data-imc-more="1">Show all ${plans.length}</button>` : '')
    : `<div class="imc-none muted">${cp.tab === 'search' ? (cp.q.length < 2 ? 'Type at least 2 letters.' : 'No listing matches.') : cp.tab === 'ticked' ? 'No listing is ticked in the list.' : 'No listing here.'}</div>`;
  return `<div class="imc-tabs" role="tablist">${tabs}</div>${search}${note}
    ${plans.length ? `<div class="imc-tbar muted">${nChange} of ${plans.length} would change · <button type="button" class="ghost im-b imc-lk" data-imc-all="1">Tick all that change</button> · <button type="button" class="ghost im-b imc-lk" data-imc-all="0">Untick all</button></div>` : ''}
    <div class="imc-tlist">${list}</div>`;
}
/** The popup's whole page, for the open state. */
function imcCpHtml(cp) {
  const g = cp.guided;
  const head = g ? `<b>Guided copy</b><ol class="imc-steps">${['Copy from', 'Which pictures', 'Paste into', 'Check & send'].map((t, i) =>
    `<li class="${i + 1 === g ? 'is-on' : i + 1 < g ? 'is-done' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>`
    : '<b>Copy to similar listings</b><span class="muted">Tick the pictures on the left and the listings on the right. Nothing is sent until Amazon has checked it and you approve.</span>';
  let body = '';
  let plans = [];
  let targets = null;
  if (cp.src) {
    targets = imcTargets(cp.src, imcItems(), IM_SEL, cp.q);
    plans = imcTabPlans(cp, targets[cp.tab] || []);
  }
  const { jobs, pics } = cp.src ? imcJobs(cp, plans) : { jobs: [], pics: 0 };
  if (!g) body = `<div class="imc-cp-body"><div class="imc-cp-l">${imcSrcHtml(cp)}</div><div class="imc-cp-r">${imcTargetsHtml(cp, targets, plans)}</div></div>`;
  else if (g === 1) body = `<div class="imc-cp-one">${imcStep1Html(cp)}</div>`;
  else if (g === 2) body = `<div class="imc-cp-one">${imcSrcHtml(cp)}</div>`;
  else if (g === 3) body = `<div class="imc-cp-one">${imcStep3Html(cp, targets)}</div>`;
  else body = `<div class="imc-cp-one imc-cp-r">${imcTargetsHtml(cp, targets, plans)}</div>`;
  const sum = `<span class="imc-sum"><b>${jobs.length}</b> listing${jobs.length === 1 ? '' : 's'} will change · <b>${pics}</b> picture${pics === 1 ? '' : 's'}</span>`;
  const send = `<button type="button" class="im-b im-go" data-imc="send" ${jobs.length ? '' : 'disabled'}>Check with Amazon (${jobs.length})</button>`;
  const foot = !g ? `${sum}<span style="flex:1"></span><button type="button" class="ghost im-b" data-imc="close">Cancel</button>${send}`
    : `${g === 4 ? sum : ''}<span style="flex:1"></span><button type="button" class="ghost im-b" data-imc="close">Cancel</button>`
      + (g > 1 ? '<button type="button" class="ghost im-b" data-imc="back">Back</button>' : '')
      + (g < 4 ? `<button type="button" class="im-b im-go" data-imc="next" ${(g === 1 && !cp.src) || (g === 2 && !Object.keys(imcWant(cp.src)).length) ? 'disabled' : ''}>Next</button>` : send);
  return `<div class="im-pv im-cp" role="document"><div class="im-pv-top">${head}</div>${body}<div class="im-pv-foot imc-cp-foot">${foot}</div></div>`;
}
// Guided step 1: pick the listing to copy from (or the clipboard).
function imcStep1Html(cp) {
  const q = cp.gq.trim().toLowerCase();
  const kids = imcItems().filter(item => item.lvl !== 'parent');
  const hits = q.length >= 2 ? kids.filter(item => imKidMatch(item, 'all', q)).slice(0, 30) : [];
  const clip = IM_CLIP && IM_CLIP.brand === $('imBrand').value ? kids.find(item => item.sku === IM_CLIP.sku) : null;
  const line = item => `<div class="imc-pick${cp.src && cp.src.sku === item.sku ? ' is-on' : ''}">${imcPic(imcSlotVal(item, 'MAIN'))}<b class="im-mono">${imEsc(item.sku)}</b>`
    + `<span class="muted">${imEsc([item.c, item.z].filter(Boolean).join(' · '))} · ${imcPicCount(item)}/9 pictures</span><span style="flex:1"></span>`
    + `<button type="button" class="ghost im-b" data-imc-from="${imEsc(item.sku)}">${cp.src && cp.src.sku === item.sku ? 'Chosen ✓' : 'Copy from this'}</button></div>`;
  return `<p class="imc-q-l"><b>Which listing has the right pictures?</b></p>
    <label class="im-search imc-q"><input data-imc-gq="1" value="${imEsc(cp.gq)}" placeholder="Search SKU, ASIN, title, colour" aria-label="Search the listing to copy from"></label>
    ${clip ? `<div class="imc-note">In the clipboard now:</div>${line(clip)}` : ''}
    <div class="imc-tlist">${hits.map(line).join('') || `<div class="imc-none muted">${q.length < 2 ? 'Type at least 2 letters of a SKU, colour or title.' : 'No listing matches.'}</div>`}</div>`;
}
// Guided step 3: the suggested groups as cards; "Recommended" on Same colour.
function imcStep3Html(cp, targets) {
  const cards = IMC_TABS.filter(tab => tab.k !== 'search').map(tab => {
    const plans = imcTabPlans(cp, targets[tab.k] || []);
    const n = plans.filter(plan => plan.state === 'change').length;
    return `<button type="button" class="imc-gcard${tab.k === 'colour' ? ' is-rec' : ''}" data-imc-gtab="${tab.k}" ${plans.length ? '' : 'disabled'}>`
      + `${tab.k === 'colour' ? '<span class="imc-rec">Recommended</span>' : ''}<b>${imEsc(imcTabName(cp.src, tab.k))}</b>`
      + `<span><b>${n}</b> of ${plans.length} listing${plans.length === 1 ? '' : 's'} would change</span></button>`;
  }).join('') + '<button type="button" class="imc-gcard" data-imc-gtab="search"><b>Search</b><span>Any listing of the brand</span></button>';
  return `<p class="imc-q-l"><b>Paste into which listings?</b> <span class="muted">You can untick single listings on the next screen.</span></p><div class="imc-gcards">${cards}</div>`;
}
/** Draw the popup again (keeping where its lists were scrolled, and the cursor in a search box). */
function imcDraw() {
  const cp = IMC_CP;
  if (!cp) return imModal('');
  const box = $('spModalBox');
  const lists = box && box.querySelectorAll ? [...box.querySelectorAll('.imc-tlist,.imc-cp-l,.imc-cp-one')].map(el => el.scrollTop) : [];
  const act = typeof document !== 'undefined' ? document.activeElement : null;
  const focus = act && act.dataset && (act.dataset.imcQ ? '[data-imc-q]' : act.dataset.imcGq ? '[data-imc-gq]' : '');
  const caret = focus ? act.selectionStart : 0;
  imModal(imcCpHtml(cp));
  if (box && box.querySelectorAll) [...box.querySelectorAll('.imc-tlist,.imc-cp-l,.imc-cp-one')].forEach((el, i) => { if (lists[i]) el.scrollTop = lists[i]; });
  if (focus && box && box.querySelector) {
    const input = box.querySelector(focus);
    if (input) {
      input.focus();
      if (input.setSelectionRange) input.setSelectionRange(caret, caret);
    }
  }
}
function imcClose() {
  IMC_CP = null;
  imModal('');
}
/** "Check with Amazon (N)": the ticked listings go to the one send path (#10) — the Amazon check popup takes the frame over. */
function imcSend() {
  const cp = IMC_CP;
  if (!cp || !cp.src) return;
  const plans = imcTabPlans(cp, imcTargets(cp.src, imcItems(), IM_SEL, cp.q)[cp.tab] || []);
  const { jobs, held } = imcJobs(cp, plans);
  if (!jobs.length) return;
  IMC_CP = null;
  const title = cp.src.kind === 'colour' ? `Copy ${cp.src.label}` : cp.src.kind === 'slot' ? cp.src.label : `Copy ${cp.src.sku}'s pictures`;
  return imcSendJobs(jobs, held, title);
}
function imcSendJobs(jobs, held, title, more) {
  return sqSendWithCheck(jobs, Object.assign({
    screen: 'Image Manager · copy', title, held,
    onSent: job => { job.row.img = Object.assign({}, job.row.img, job.body.set); },   // what was sent, so the rows stop lying
    onDone: () => {
      IML_DIRTY = true;
      imListRender();
    } }, more || {}));
}

/* ---------- 5. the colour row's buttons ---------- */
/** Sync N sizes: the popup on the colour stack, "Same colour" tab, the differing sizes ticked — only the slots that differ go in. */
function imcSyncOpen(famKey, colKey) {
  const colour = imcFind(famKey, colKey);
  if (!colour) return;
  const src = imcSrcColour(colour, $('imBrand').value);
  Object.keys(src.slots).forEach(slot => { src.tick[slot] = true; });
  src.withSw = !!src.slots.SWCH;
  imcCpOpen(src, { tab: 'colour', picked: colour.sizes.filter(size => size.diff.length).map(size => size.kid.sku) });
}
/** Copy to another colour: the popup on the colour stack, "Other colours" tab. */
function imcCopyColour(famKey, colKey) {
  const colour = imcFind(famKey, colKey);
  if (colour) imcCpOpen(imcSrcColour(colour, $('imBrand').value), { tab: 'size' });
}
/** Set slot XX for all colours: the family's most common picture in that slot → every listing of the family (the popup first). */
function imcSetAll(famKey, slot) {
  const data = IML[$('imBrand').value];
  const group = data && imListGroups(data.items).find(each => imGroupKey(each) === famKey);
  if (!group) return;
  const votes = new Map();
  group.kids.forEach(kid => { const url = imcSlotVal(kid, slot); if (url) votes.set(url, (votes.get(url) || 0) + 1); });
  const url = [...votes.keys()].sort((a, b) => votes.get(b) - votes.get(a))[0];
  if (!url) return imMsg(`No picture in slot ${imcSlotName(slot)} anywhere in this family yet — copy one from a listing first.`, true);
  const first = group.kids[0];
  imcCpOpen({ kind: 'slot', brand: $('imBrand').value, sku: '', c: '', z: '', psku: group.psku || (group.parent && group.parent.sku) || '', pt: first.pt || '',
    slots: { [slot]: url }, tick: { [slot]: true }, withSw: false, label: `Slot ${imcSlotName(slot)} for every colour (the picture ${votes.get(url)} of ${group.kids.length} listings have)` }, { tab: 'family' });
}
/** A Copy all / Copy (one picture) button anywhere: the clipboard has it (as always); the copy popup opens on it. */
function imcFromClip(only) {
  if (!IM_CLIP) return;
  const item = imcItems().find(each => each.sku === IM_CLIP.sku) || { sku: IM_CLIP.sku, asin: IM_CLIP.asin, c: IM_CLIP.c, z: IM_CLIP.z, psku: IM_CLIP.psku };
  const src = { kind: 'listing', brand: IM_CLIP.brand, sku: IM_CLIP.sku, asin: IM_CLIP.asin || '', c: IM_CLIP.c || '', z: IM_CLIP.z || '', psku: IM_CLIP.psku || item.psku || '', pt: item.pt || '',
    slots: Object.assign({}, IM_CLIP.slots), label: IM_CLIP.sku };
  imcSrcTicks(src, only);
  if (!only && IM_CLIP.tick) Object.keys(src.slots).forEach(slot => { if (slot !== 'SWCH' && IM_CLIP.tick[slot] === false) src.tick[slot] = false; });
  imcCpOpen(src);
}

/* EDIT STACK: the existing editor opens on the size that best matches the colour stack; a banner says Apply sends the changed slots to
 * EVERY size of the colour (a per-size slot changed goes to this size only). Opening any other listing ends it. */
function imcEditStack(famKey, colKey) {
  const colour = imcFind(famKey, colKey);
  if (!colour) return;
  const lead = imcRank(colour.kids).find(kid => !imcDiff(kid, colour.stack, IMC_PERSIZE).length) || colour.lead;
  const load = imEditOpen(lead.sku);
  IMC_EDIT = { brand: $('imBrand').value, sku: lead.sku, name: colour.name, skus: colour.kids.map(kid => kid.sku), fam: famKey, colKey };
  return load;
}
const imcEditOff = () => { IMC_EDIT = null; };
/** The editor's banner while it edits a colour stack. */
function imcEditBanner() {
  if (!IMC_EDIT || !IM || IM.sku !== IMC_EDIT.sku) return '';
  const n = IMC_EDIT.skus.length;
  return `<div class="card imc-banner"><b>Editing the colour stack of ${imEsc(IMC_EDIT.name)}</b>
    <span>Apply sends the changed slots to all ${n} size${n === 1 ? '' : 's'} of ${imEsc(IMC_EDIT.name)}${IMC_PERSIZE.length ? ` — ${imEsc(IMC_PERSIZE.map(imcSlotName).join(', '))} stay per size (a change there goes to ${imEsc(IM.sku)} only)` : ''}.</span>
    <button type="button" class="ghost im-b" data-imc-editoff="1">Edit only ${imEsc(IM.sku)}</button></div>`;
}
/** The sends for a colour edit: the open size gets every changed slot; each other size of the colour gets the changed slots that are not
 *  per size, where its own picture differs (a slot emptied here is emptied there only where it held the same picture). Pure. */
function imcEditJobs(edit, im, start, set, items) {
  const by = new Map(items.map(item => [item.sku, item]));
  const jobs = [{ brand: im.brand, sku: im.sku, asin: im.asin || '', label: im.title || im.sku, body: { limg: 'patch', brand: im.brand, sku: im.sku, productType: im.productType, set },
    changes: Object.keys(set).map(slot => ({ field: sqField(slot), old: start[slot] || '(none)', new: set[slot] || '(removed)', pic: true, attr: slot, oldV: start[slot] || '' })) }];
  const held = [];
  edit.skus.filter(sku => sku !== im.sku).forEach(sku => {
    const row = by.get(sku);
    if (!row) { held.push({ sku, why: 'not in this snapshot' }); return; }
    const img = row.img || {};
    const mine = {};
    Object.keys(set).forEach(slot => {
      if (IMC_PERSIZE.includes(slot)) return;
      if (set[slot]) { if (img[slot] !== set[slot]) mine[slot] = set[slot]; } else if (img[slot] && img[slot] === start[slot]) mine[slot] = '';
    });
    if (!Object.keys(mine).length) return;
    if (!row.pt) { held.push({ sku, why: 'no product type in the snapshot — open it in the editor' }); return; }
    jobs.push({ brand: im.brand, sku, asin: row.asin || '', label: [row.c, row.z].filter(Boolean).join(' · ') || sku, row, body: { limg: 'patch', brand: im.brand, sku, productType: row.pt, set: mine },
      changes: Object.keys(mine).map(slot => ({ field: sqField(slot), old: img[slot] || '(none)', new: mine[slot] || '(removed)', pic: true, attr: slot, oldV: img[slot] || '' })) });
  });
  return { jobs, held };
}
/** imSend(true) asks first: while a colour stack is edited, Apply sends to every size (one Amazon check popup). Null = not a colour edit. */
function imcEditSend(set) {
  if (!IMC_EDIT || !IM || IM.sku !== IMC_EDIT.sku) return null;
  const im = IM;
  const start = Object.assign({}, IM_START);
  const { jobs, held } = imcEditJobs(IMC_EDIT, im, start, set, imcItems());
  return sqSendWithCheck(jobs, {
    screen: 'Image Manager · colour', title: `Colour stack · ${IMC_EDIT.name} (${IMC_EDIT.skus.length} size${IMC_EDIT.skus.length === 1 ? '' : 's'})`, held,
    onSent: job => {
      if (job.sku === im.sku) { if (IM === im) IM_START = Object.assign({}, IM_NOW); } else if (job.row) job.row.img = Object.assign({}, job.row.img, job.body.set);
      IML_DIRTY = true;
    },
    onEdit: () => {},
    onDone: sum => {
      if (IM !== im) return;
      const text = sqSummaryText(sum);
      if (text) IM_RESULT = `<div style="margin-top:8px;font-size:12.5px" class="${/rejected|says no/i.test(text) && !/✅/.test(text) ? 'err' : ''}">${imEsc(text)}</div>`;
      imRender();
      imHistory();
    } }) || true;
}

/* ---------- 6. the toolbar: view switch, per-size slots, guided copy ---------- */
function imcLayout(v, keep) {
  IMC_LAYOUT = v === 'list' ? 'list' : 'colour';
  if (!keep) {
    try { localStorage.setItem(IMC_LAYOUT_KEY, IMC_LAYOUT); } catch (e) { /* a private window: this visit only */ }
    IM_CHUNK_H.clear();              // rows change shape: the blocks are measured again
    if (IML[$('imBrand').value]) imListRender();
  }
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll('[data-imc-layout]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.imcLayout === IMC_LAYOUT);
      btn.setAttribute('aria-pressed', String(btn.dataset.imcLayout === IMC_LAYOUT));
    });
  }
  const ps = $('imcPerSize');
  if (ps && ps.classList) ps.classList.toggle('hide', IMC_LAYOUT !== 'colour');
}
function imcPerSize(slots, keep) {
  IMC_PERSIZE = IM_SLOTS.filter(slot => slot !== 'MAIN' && slots.includes(slot));
  if (!keep) {
    try { localStorage.setItem(IMC_PERSIZE_KEY, JSON.stringify(IMC_PERSIZE)); } catch (e) { /* this visit only */ }
    IM_CHUNK_H.clear();
    if (IML[$('imBrand').value]) imListRender();
  }
  const txt = $('imcPerSizeTxt');
  if (txt) txt.textContent = IMC_PERSIZE.length ? IMC_PERSIZE.map(imcSlotName).join(', ') : 'none';
  if (typeof document !== 'undefined' && document.querySelectorAll) document.querySelectorAll('[data-imc-ps]').forEach(cb => { cb.checked = IMC_PERSIZE.includes(cb.dataset.imcPs); });
}

/* ---------- 7. wiring ---------- */
if (typeof document !== 'undefined' && document.querySelectorAll) {
  document.querySelectorAll('[data-imc-layout]').forEach(btn => btn.addEventListener('click', () => imcLayout(btn.dataset.imcLayout)));
  document.querySelectorAll('[data-imc-ps]').forEach(cb => cb.addEventListener('change', () =>
    imcPerSize([...document.querySelectorAll('[data-imc-ps]')].filter(each => each.checked).map(each => each.dataset.imcPs))));
}
imcLayout(IMC_LAYOUT, true);
imcPerSize(IMC_PERSIZE, true);
if ($('imcGuided')) $('imcGuided').onclick = () => imcCpOpen(null, { guided: true });
// The colour rows' buttons and size chips, and the family bar's "for all colours…".
$('imList').addEventListener('click', e => {
  const t = e.target;
  const on = sel => (t && t.closest ? t.closest(sel) : null);
  const size = on('[data-imc-size]');
  if (size) return imEditOpen(size.dataset.imcSize);
  const setAll = on('[data-imc-setall]');
  if (setAll) {
    const pick = setAll.parentNode && setAll.parentNode.querySelector ? setAll.parentNode.querySelector('[data-imc-slotpick]') : null;
    return imcSetAll(setAll.dataset.imcSetall, (pick && pick.value) || 'PT03');
  }
  const btn = on('[data-imc-sync],[data-imc-edit],[data-imc-copy]');
  const row = btn && btn.closest('.imc-row');
  if (!row) return;
  if (btn.dataset.imcSync) return imcSyncOpen(row.dataset.imcFam, row.dataset.imcCol);
  if (btn.dataset.imcEdit) return imcEditStack(row.dataset.imcFam, row.dataset.imcCol);
  return imcCopyColour(row.dataset.imcFam, row.dataset.imcCol);
});
// The popup: its buttons, ticks, tabs, quick picks, mode, search boxes.
function imcClick(e) {
  const cp = IMC_CP;
  const t = e.target;
  const on = sel => (t && t.closest ? t.closest(sel) : null);
  if (on('[data-imc-editoff]')) {
    IMC_EDIT = null;
    return imRender();
  }
  if (!cp || !on('.im-cp')) return;
  const act = on('[data-imc]');
  if (act) {
    const a = act.dataset.imc;
    if (a === 'close') return imcClose();
    if (a === 'send') return imcSend();
    if (a === 'back') cp.guided = Math.max(1, cp.guided - 1);
    if (a === 'next') {
      cp.guided = Math.min(4, cp.guided + 1);
      if (cp.guided === 3 && !cp.tab) imcTab(imcBestTab(cp.src));
    }
    return imcDraw();
  }
  const tab = on('[data-imc-tab]');
  if (tab) { imcTab(tab.dataset.imcTab); return imcDraw(); }
  const gtab = on('[data-imc-gtab]');
  if (gtab) { imcTab(gtab.dataset.imcGtab); cp.guided = 4; return imcDraw(); }
  const from = on('[data-imc-from]');
  if (from) {
    const item = imcItems().find(each => each.sku === from.dataset.imcFrom);
    if (item) { cp.src = imcSrcListing(item, $('imBrand').value); cp.tab = ''; cp.guided = 2; }
    return imcDraw();
  }
  const qp = on('[data-imc-qp]');
  if (qp) {
    const pick = { all: IM_SLOTS, main: ['MAIN'], life: ['PT01', 'PT02', 'PT03', 'PT04', 'PT05'], chart: ['PT06'] }[qp.dataset.imcQp] || [];
    Object.keys(cp.src.slots).forEach(slot => { if (slot !== 'SWCH') cp.src.tick[slot] = pick.includes(slot); });
    if (cp.tab) imcTab(cp.tab);
    return imcDraw();
  }
  if (on('[data-imc-more]')) { cp.all = true; return imcDraw(); }
  const all = on('[data-imc-all]');
  if (all) {
    if (all.dataset.imcAll === '1') imcTab(cp.tab);
    else cp.picked.clear();
    return imcDraw();
  }
}
function imcChange(e) {
  const cp = IMC_CP;
  const t = e.target;
  if (!cp || !t || !t.dataset || !(t.closest && t.closest('.im-cp'))) return;
  if (t.dataset.imcTick) {
    cp.src.tick[t.dataset.imcTick] = t.checked;
    if (cp.tab) imcTab(cp.tab);
  } else if (t.dataset.imcSw) {
    cp.src.withSw = t.checked;
    if (cp.tab) imcTab(cp.tab);
  } else if (t.dataset.imcMode) {
    cp.mode = t.dataset.imcMode;
    if (cp.tab) imcTab(cp.tab);
  } else if (t.dataset.imcPick) {
    if (t.checked) cp.picked.add(t.dataset.imcPick);
    else cp.picked.delete(t.dataset.imcPick);
  } else if (t.dataset.imcInc) {
    if (t.checked) cp.inc.add(t.dataset.imcInc);
    else cp.inc.delete(t.dataset.imcInc);
  } else return;
  imcDraw();
}
let IMC_QT = 0;
function imcInput(e) {
  const cp = IMC_CP;
  const t = e.target;
  if (!cp || !t || !t.dataset || !(t.dataset.imcQ || t.dataset.imcGq)) return;
  clearTimeout(IMC_QT);
  IMC_QT = setTimeout(() => {
    if (IMC_CP !== cp) return;
    if (t.dataset.imcQ) {
      cp.q = t.value;
      imcTab('search');
    } else cp.gq = t.value;
    imcDraw();
  }, 200);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', imcClick);
  document.addEventListener('change', imcChange);
  document.addEventListener('input', imcInput);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && IMC_CP && $('spModal') && !$('spModal').classList.contains('hide')) imcClose();
  });
}
