/* ================= LISTING · LISTING ERRORS: what Amazon reports wrong on each listing, and the editor that fixes it from here =================
 * Screens: Listing Errors (tab 'lerr').
 * Does: lists every listing with an issue from the Image Manager's snapshot (IML), filtered by brand, kind, severity and search,
 *       50 a page; opens one listing in the fixer — Amazon's issues, an editor built from what Amazon allows for each named
 *       attribute, Check with Amazon (preview) and Apply (send) through imPost; hands image issues to the Image Manager.
 * Main functions: leKind, leRows, leRender, leOpen, leCard, leFixRender, leFixWire, leSend, plus leGet / leSet / leFields /
 *                 leNewEntry / lePatches that the editor is built on. Pricing-App/tests/listing-errors-test.js runs this file in a stub page. */
/* ================= LISTING ERRORS =================
 *
 * Sellora → Listing → Listing Errors (2026-10-09, Ravi: "amazon listing ... kya error h and mujhe app se hi thik krna h").
 *
 * HOW THIS FILE IS LAID OUT:
 *   1. State and kinds   — what an issue is (image / title / value / catalog / variation / other)
 *   2. The list          — every listing Amazon reports a problem on, from the Image Manager's snapshot
 *   3. The fixer         — one listing: Amazon's issues, the attributes they name, an editor built from what Amazon
 *                          allows (Product Type Definitions), Check with Amazon, Apply
 *   4. Event wiring
 *
 * Data: the list reads the same snapshot as the Image Manager (IML, imListLoad/imListBuild in image-manager.js), whose
 * rows carry every issue (`iss`). The fixer reads one listing live (?lfix=get), the allowed values (?lfix=schema), and
 * sends through POST lfix=patch (Pricing-API/ListingFix.gs), which ALWAYS asks Amazon first and sends only when Amazon
 * reports no error. Image issues are fixed in the Image Manager, which this screen opens. */

/* ============================================================================================
 * 1. STATE AND KINDS
 * ============================================================================================ */
let LE_PAGE = 0;        // page of the list on screen (0-based)
let LE = null;          // the listing open in the fixer (the ?lfix=get reply), or null
let LE_SCHEMA = {};     // attribute name → what Amazon allows for it (the ?lfix=schema reply)
let LE_EDIT = {};       // attribute name → { vals } edited so far, or { del: true }
let LE_RESULT = '';     // HTML of the last Check / Apply result, kept across redraws
let LE_EXTRA = [];      // attribute names the caller asked to edit as well (the Workspace's empty specs), beside the ones Amazon names
let LE_ONLY = null;     // { skus: Set, label } — only these listings, picked in Listing Health's Fix all (fix-all.js), until "Show every listing"
// Show only these listings — with or without an issue in the snapshot — every kind, no search, page 1; empty → every listing again.
function leOnly(skus, label) {
  LE_ONLY = skus && skus.length ? { skus: new Set(skus), label: label || '' } : null;
  LE_PAGE = 0;
  $('leKind').value = 'all';
  $('leQ').value = '';
}
const LE_PER = 50;      // listings per page
const LE_KINDS = [
  ['image', 'Image'], ['title', 'Title too long'], ['value', 'Wrong / old value'],
  ['catalog', 'Differs from catalogue'], ['variation', 'Variation'], ['other', 'Other'],
];
/** What kind of problem an issue is — by Amazon's words and the attributes it names. */
// Returns one of the LE_KINDS keys: image / title / catalog / variation / value / other.
function leKind(issue) {
  const msg = String(issue.m || issue.message || '');
  const attrs = (issue.a || issue.attrs || []).join(' ');
  if (/image_locator/.test(attrs) || /\b(image|MAIN|PT0\d|SWCH|media)\b/i.test(msg)) return 'image';
  if (/Item Name that is \d+ characters or less/i.test(msg) || (/item_name/.test(attrs) && /characters/i.test(msg))) return 'title';
  if (/different from what's already in the Amazon catalog/i.test(msg)) return 'catalog';
  if (/child ASIN|variation|parentage/i.test(msg)) return 'variation';
  if (/not a valid value|approved value|enough values|does not belong|no longer applicable|invalid/i.test(msg)) return 'value';
  return 'other';
}
// HTML-escape for everything this screen prints.
const leEsc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
// Whole number with thousands separators.
const leNf = value => Math.round(value || 0).toLocaleString('en-US');
// Status line under the toolbar: red for an error, grey otherwise. Does nothing if the pane is not on the page.
const leMsg = (text, bad) => {
  const el = $('leMsg');
  if (el) {
    el.textContent = text || '';
    el.className = bad ? 'err' : 'muted';
  }
};

/* ============================================================================================
 * 2. THE LIST
 * ============================================================================================ */
// First visit to the tab (called from showTab).
function ensureLerr() { leListEnsure(); }

// Make sure the brand's snapshot is loaded, draw the list, and build the snapshot from Amazon if there is none yet.
async function leListEnsure() {
  const brand = $('leBrand').value;
  if (!(brand in IML)) {
    leMsg('Reading the saved snapshot…');
    await imListLoad(brand);
    leMsg('');
  }
  leRender();
  if ((!IML[brand] || !IML[brand].items.length) && !IML_BUSY) {
    await imListBuild(brand);
    leRender();
  }
}

/** Listings with at least one issue of the chosen severity, each with its issues sorted error-first. */
// Returns [{ x: snapshot item, iss: its issues }] after the brand / severity / kind / search filters, or null without a snapshot.
function leRows() {
  const brand = $('leBrand').value;
  const data = IML[brand];
  if (!data) return null;
  const sev = $('leSev').value;
  const warn = sev !== 'err';
  const kind = $('leKind').value;
  const search = ($('leQ').value || '').trim().toLowerCase();
  const out = [];
  data.items.forEach(x => {
    if (x.lvl === 'parent') return;
    if (LE_ONLY && !LE_ONLY.skus.has(x.sku)) return;
    let iss = (x.iss || []).filter(issue => issue.s === 'E' || (warn && issue.s === 'W'));
    if (!iss.length && x.ie && !x.iss) iss = [{ s: 'E', m: x.im || '', a: [] }];       // a snapshot from before `iss`
    if (!iss.length && sev !== 'any' && !LE_ONLY) return;          // "Every listing": its content can be edited with no issue at all
    if (kind !== 'all' && !iss.some(issue => leKind(issue) === kind)) return;
    if (search && ![x.sku, x.asin, x.c, x.z, x.t].concat(iss.map(issue => issue.m)).join(' ').toLowerCase().includes(search)) return;
    out.push({ x, iss: iss.slice().sort((p, r) => (p.s === 'E' ? 0 : 1) - (r.s === 'E' ? 0 : 1)) });
  });
  return out;
}

// Draw the list: the count chips per kind, the pager, one row per listing with its issues and a Fix / Content button.
function leRender() {
  const el = $('leList');
  if (!el) return;
  const brand = $('leBrand').value;
  const data = IML[brand];
  if (!data) {
    el.innerHTML = `<div class="card" style="padding:14px"><span class="muted">${IML_BUSY
      ? 'Reading every listing from Amazon — about two minutes.'
      : 'No snapshot yet. Press Refresh from Amazon.'}</span></div>`;
    return;
  }
  const rows = leRows();
  const old = !data.items.some(x => x.iss);
  // --- the count per kind ---
  /* The count per kind is over every listing with an ERROR, whatever the filters say. */
  const counts = {};
  data.items.forEach(x => {
    if (x.lvl === 'parent') return;
    const kinds = new Set((x.iss || []).filter(issue => issue.s === 'E').map(leKind));
    kinds.forEach(kind => counts[kind] = (counts[kind] || 0) + 1);
  });
  // --- paging ---
  const pages = Math.max(1, Math.ceil(rows.length / LE_PER));
  if (LE_PAGE >= pages) LE_PAGE = 0;
  const slice = rows.slice(LE_PAGE * LE_PER, (LE_PAGE + 1) * LE_PER);
  // --- the HTML ---
  const chip = (kind, label) => `<button class="ghost im-b" data-kind="${kind}"`
    + ` style="${$('leKind').value === kind ? 'border-color:var(--accent);color:var(--accent-ink)' : ''}">`
    + `${leEsc(label)} <b>${leNf(counts[kind] || 0)}</b></button>`;
  const pager = pages > 1 ? `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:6px 0">
      <button class="ghost im-b" data-lepg="-1" ${LE_PAGE ? '' : 'disabled'}>◀ Prev</button>
      <span class="muted" style="font-size:12px">Page ${LE_PAGE + 1} of ${pages}</span>
      <button class="ghost im-b" data-lepg="1" ${LE_PAGE < pages - 1 ? '' : 'disabled'}>Next ▶</button></div>` : '';
  const only = LE_ONLY ? `<div class="card" style="padding:8px 14px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px">`
    + `<span>Showing the <b>${leNf(LE_ONLY.skus.size)}</b> listing(s) picked in Listing Health${LE_ONLY.label ? ': ' + leEsc(LE_ONLY.label) : ''}.</span>`
    + '<button class="ghost im-b" data-leonly="off">Show every listing</button></div>' : '';
  el.innerHTML = only + `
    <div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="muted" style="font-size:12px">Listings with an error, by kind:</span>
        ${LE_KINDS.map(([kind, label]) => chip(kind, label)).join('')}
        <button class="ghost im-b" data-kind="all">All</button>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">${leNf(rows.length)} listing(s) shown · snapshot ${data.at ? data.at.toLocaleString() : '—'}${IML_BUSY ? ' · refreshing…' : ''}
        ${old ? ' · <b class="err">this snapshot keeps only the first error of each listing — press Refresh from Amazon for all of them</b>' : ''}</div>
    </div>
    ${pager}
    <div class="card" style="padding:0;overflow:auto"><table class="xl" style="width:100%">
      <thead><tr><th></th><th style="text-align:left">SKU</th><th style="text-align:left">Colour · size</th>`
      + `<th>Status</th><th style="text-align:left">What Amazon says</th><th></th></tr></thead>
      <tbody>${slice.map(({ x, iss }) => {
        const pic = (x.live || {}).MAIN || (x.img || {}).MAIN;
        const state = imState(x);
        const hasImg = iss.some(issue => leKind(issue) === 'image');
        const hasOther = iss.some(issue => leKind(issue) !== 'image');
        return `<tr>
          <td style="width:52px">${pic
            ? `<img src="${leEsc(imThumb(pic))}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:4px">`
            : ''}</td>
          <td style="text-align:left;white-space:nowrap"><b style="font-family:ui-monospace,monospace">${leEsc(x.sku)}</b>`
            + `<div class="muted" style="font-size:11px">${leEsc(x.asin)} · ${leEsc(x.pt || '')}</div></td>
          <td style="text-align:left;font-size:12px">${leEsc([x.c, x.z].filter(Boolean).join(' · '))}</td>
          <td><span class="st" style="background:${state.fill};color:${state.ink}">${leEsc(state.label)}</span></td>
          <td style="text-align:left;white-space:normal;font-size:12px;max-width:620px">${iss.slice(0, 4).map(issue => `<div style="margin:2px 0">
              <span class="st ${issue.s === 'E' ? 'st-rejected' : 'st-draft'}" style="font-size:10px">${
                leEsc((LE_KINDS.find(pair => pair[0] === leKind(issue)) || [, ''])[1])}</span>
              ${leEsc(String(issue.m || '').slice(0, 200))}</div>`).join('')}${iss.length > 4 ? `<div class="muted">+${iss.length - 4} more</div>` : ''}</td>
          <td style="white-space:nowrap"><button class="im-b" data-fix="${leEsc(x.sku)}">${hasOther ? 'Fix' : 'Content'}</button>
            ${hasImg ? `<button class="ghost im-b" data-img="${leEsc(x.sku)}">Images</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted" style="padding:14px">Nothing to fix here.</td></tr>'}</tbody></table></div>
    ${pager}`;
  // --- the buttons in what was just drawn ---
  el.querySelectorAll('[data-kind]').forEach(btn => btn.onclick = () => {
    $('leKind').value = btn.dataset.kind;
    LE_PAGE = 0;
    leRender();
  });
  el.querySelectorAll('[data-lepg]').forEach(btn => btn.onclick = () => {
    LE_PAGE += Number(btn.dataset.lepg);
    leRender();
    window.scrollTo(0, 0);
  });
  el.querySelectorAll('[data-fix]').forEach(btn => btn.onclick = () => leOpen(btn.dataset.fix));
  el.querySelectorAll('[data-leonly]').forEach(btn => btn.onclick = () => {
    leOnly(null);
    leRender();
  });
  el.querySelectorAll('[data-img]').forEach(btn => btn.onclick = () => {
    showTab('img');
    $('imBrand').value = $('leBrand').value;
    $('imQ').value = btn.dataset.img;
    IM_SKU_CHOICES = null;
    imLoad(btn.dataset.img);
    window.scrollTo(0, 0);
  });
}

/* ============================================================================================
 * 3. THE FIXER — one listing
 * ============================================================================================ */
// Show the fixer (true) or the list (false).
const leShow = on => {
  $('leFixWrap').classList.toggle('hide', !on);
  $('leListWrap').classList.toggle('hide', on);
};

// Open one listing in the fixer: read it live from Amazon, then what Amazon allows for the attributes its issues name —
// and for `extraAttrs`, when the caller (the Workspace's Specs fix) names attributes that are simply empty.
async function leOpen(sku, extraAttrs = []) {
  leShow(true);
  window.scrollTo(0, 0);
  LE = null;
  LE_EDIT = {};
  LE_RESULT = '';
  LE_EXTRA = Array.isArray(extraAttrs) ? extraAttrs.map(String).filter(Boolean) : [];
  $('leFix').innerHTML = '<div class="card" style="padding:14px"><span class="muted">Reading ' + leEsc(sku) + ' from Amazon…</span></div>';
  try {
    // --- the listing ---
    const reply = await baCall({ lfix: 'get', brand: $('leBrand').value, sku });
    LE = reply;
    await lcEnsureRules();
    // --- the schema for the attributes Amazon names (images and the content fields are handled elsewhere) ---
    const names = leAttrNames(reply);
    if (names.length && reply.productType) {
      const schemaReply = await baCall({ lfix: 'schema', brand: $('leBrand').value, pt: reply.productType, attrs: names.join(',') });
      LE_SCHEMA = schemaReply.attrs || {};
    } else LE_SCHEMA = {};
    leFixRender();
  } catch (e) {
    $('leFix').innerHTML = `<div class="card err" style="padding:14px">${leEsc(e.message || e)}</div>`;
  }
}

// The attributes the fixer edits: the ones Amazon's issues name, then the extra ones asked for — without image slots and
// the four content fields, which have their own screens.
const leAttrNames = listing => [...new Set(listing.issues.flatMap(issue => issue.attrs || []).concat(LE_EXTRA))]
  .filter(attr => !/image_locator/.test(attr) && !LC_FIELDS.includes(attr));

/* A value is an array of entries; a field may be nested one level ('type.value'). */
// Read a (possibly dotted) field from one entry.
const leGet = (entry, field) => field.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), entry);
// Write a (possibly dotted) field on one entry, creating the holder object on the way.
function leSet(entry, field, value) {
  const keys = field.split('.');
  let obj = entry;
  keys.slice(0, -1).forEach(key => {
    if (!obj[key] || typeof obj[key] !== 'object') obj[key] = {};
    obj = obj[key];
  });
  obj[keys[keys.length - 1]] = value;
}
/** The editable fields of an attribute: its own, minus marketplace and language, and minus an object holder whose
 *  inside is listed (unit_count.type is edited as type.value). */
function leFields(def) {
  const fields = (def.fields || []).filter(field => !/(^|\.)(marketplace_id|language_tag)$/.test(field.field));
  return fields.filter(field => !(field.type === 'object' && fields.some(other => other.field.indexOf(field.field + '.') === 0)));
}

// One attribute's card in the fixer: its current values as inputs / selects (or the title textarea), Add / Remove / Undo.
function leCard(name) {
  const def = LE_SCHEMA[name] || { missing: true };
  const current = (LE.attributes || {})[name];
  const edit = LE_EDIT[name];
  // One line of text for the current values, for the "no longer used" card.
  const pretty = values => (values || []).map(entry => leFields(def).map(field => leGet(entry, field.field))
    .filter(part => part != null && part !== '').join(' ') || JSON.stringify(entry).slice(0, 80)).join(' | ');
  // --- an attribute Amazon no longer uses for this product type: offer to remove it ---
  if (def.missing) {
    return `<div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px">${leEsc(name)}</div>
      <div class="muted" style="font-size:12px;margin:4px 0">Amazon no longer uses this for ${leEsc(LE.productType)}. Now: <b>${
        leEsc(pretty(current) || JSON.stringify(current || '').slice(0, 120))}</b></div>
      ${edit && edit.del ? `<div style="color:var(--accent-ink);font-size:12px">Will be removed. <button class="ghost im-b" data-undo="${leEsc(name)}">Undo</button></div>`
        : `<button class="ghost im-b" data-del="${leEsc(name)}">Remove this attribute</button>`}</div>`;
  }
  // --- the editor: one row per value, one control per field ---
  const vals = edit && edit.vals ? edit.vals : deltaCloneLe(current || []);
  const fields = leFields(def);
  const isTitle = name === 'item_name';
  const rows = vals.map((entry, i) => `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0">
      ${fields.map(field => {
        const value = leGet(entry, field.field);
        const id = `le_${name}_${i}_${field.field}`;
        if (field.enum && field.enum.length) return `<label style="font-size:11.5px" class="muted">${leEsc(field.title)}
            <select data-le="${leEsc(name)}" data-i="${i}" data-f="${leEsc(field.field)}" id="${id}" style="width:auto;min-width:140px">
            ${field.enum.indexOf(value) < 0 && value != null ? `<option value="${leEsc(value)}" selected>${leEsc(value)} — not allowed</option>` : ''}
            ${field.enum.map((opt, idx) => `<option value="${leEsc(opt)}" ${opt === value ? 'selected' : ''}>`
              + `${leEsc((field.enumNames || [])[idx] || opt)}</option>`).join('')}</select></label>`;
        if (isTitle && field.field === 'value') return `<div style="flex:1 1 100%">`
            + `<textarea data-le="${leEsc(name)}" data-i="${i}" data-f="value" rows="2" style="width:100%">${leEsc(value || '')}</textarea>
            <div class="muted" style="font-size:11px"><span id="leTitleN" style="${String(value || '').length > 75 ? 'color:var(--bad-ink);font-weight:600' : ''}">`
            + `${String(value || '').length}</span> / 75 characters (Amazon's limit for using Item Highlights)
            <button class="ghost im-b" data-suggest="1">Suggest a 75-character title</button></div></div>`;
        return `<label style="font-size:11.5px" class="muted">${leEsc(field.title)}
            <input data-le="${leEsc(name)}" data-i="${i}" data-f="${leEsc(field.field)}"`
            + ` type="${field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}" value="${leEsc(value == null ? '' : value)}"`
            + ` ${field.maxLength ? `maxlength="${field.maxLength}"` : ''} style="width:auto;min-width:${field.type === 'number' ? 90 : 220}px"></label>`;
      }).join('')}
      ${vals.length > 1 ? `<button class="ghost im-b" data-rm="${leEsc(name)}" data-i="${i}" title="Remove this value">✕</button>` : ''}</div>`).join('');
  return `<div class="card" style="padding:10px 14px;margin-bottom:10px">
    <div style="font-weight:600;font-size:13px">${leEsc(def.title || name)} <span class="muted" style="font-weight:400;font-size:11.5px">${leEsc(name)}</span>`
    + `${edit ? ' <span style="color:var(--accent-ink);font-size:11.5px">· changed</span>' : ''}</div>
    ${def.description ? `<div class="muted" style="font-size:11.5px;margin:2px 0 4px">${leEsc(def.description.slice(0, 220))}</div>` : ''}
    ${rows || '<div class="muted" style="font-size:12px">No value yet.</div>'}
    <div style="margin-top:4px">${!def.maxItems || vals.length < def.maxItems
      ? `<button class="ghost im-b" data-add="${leEsc(name)}">+ Add a value</button>` : ''}
      ${edit ? `<button class="ghost im-b" data-undo="${leEsc(name)}">Undo changes</button>` : ''}</div></div>`;
}
// Deep copy, so editing never touches what Amazon sent.
const deltaCloneLe = value => JSON.parse(JSON.stringify(value));

// The JSON patches for everything edited: a delete, or a replace with the edited values.
function lePatches() {
  return Object.entries(LE_EDIT).map(([name, edit]) => edit.del ? { op: 'delete', path: '/attributes/' + name }
    : { op: 'replace', path: '/attributes/' + name, value: edit.vals });
}

// Draw the fixer for the open listing: its header, what Amazon says, the content section, one card per attribute, Check / Apply.
function leFixRender() {
  const listing = LE;
  if (!listing) return;
  const names = leAttrNames(listing);
  const imgIssues = listing.issues.filter(issue => leKind(issue) === 'image');
  const nChanges = Object.keys(LE_EDIT).length;
  $('leFix').innerHTML = `
    <div class="card" style="padding:10px 14px;margin-bottom:10px;font-size:13px">
      <div style="font-weight:600">${leEsc(listing.title)}</div>
      <div class="muted" style="font-size:12px;display:flex;gap:12px;flex-wrap:wrap">
        <span>SKU <b>${leEsc(listing.sku)}</b></span><span>ASIN <b>${leEsc(listing.asin)}</b></span>`
        + `<span>Type ${leEsc(listing.productType)}</span><span>${leEsc((listing.status || []).join(', '))}</span>
        <a href="https://www.amazon.com/dp/${leEsc(listing.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a></div>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">What Amazon says now (${leNf(listing.issues.length)})</div>
      ${listing.issues.map(issue => `<div style="font-size:12px;margin:3px 0"><span class="st ${issue.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${leEsc(issue.severity)}</span>
        ${leEsc(issue.message)} ${(issue.attrs || []).length ? `<span class="muted">· ${leEsc(issue.attrs.join(', '))}</span>` : ''}</div>`).join('')
        || '<div class="muted" style="font-size:12px">No issues — Amazon reports nothing on this listing now.</div>'}
      ${imgIssues.length ? `<div style="margin-top:6px"><button class="ghost im-b" id="leToImg">Fix the images in the Image Manager</button></div>` : ''}
    </div>
    ${lcSectionHtml()}
    ${names.map(leCard).join('')}
    ${true ? `<div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="leCheck" class="ghost" style="width:auto;padding:6px 14px" ${nChanges ? '' : 'disabled'}>Check with Amazon</button>
        <button id="leApply" style="width:auto;padding:6px 14px" ${nChanges ? '' : 'disabled'}>Apply to Amazon${nChanges ? ' (' + nChanges + ')' : ''}</button>
        <span id="leSendMsg" class="muted" style="font-size:12px"></span></div>
      <div id="leResult">${LE_RESULT}</div></div>`
      : (listing.issues.length && !imgIssues.length
        ? `<div class="card muted" style="padding:10px 14px;font-size:12px">Amazon names no attribute for these, so there is nothing to edit here — `
          + `most often it needs Seller Central or Seller Support.</div>`
        : '')}`;
  leFixWire();
}

// The edit record for one attribute, started from the listing's current values the first time it is touched.
function leTouch(name) {
  if (!LE_EDIT[name]) LE_EDIT[name] = { vals: deltaCloneLe((LE.attributes || {})[name] || []) };
  return LE_EDIT[name];
}
/** A new entry carries what the field list says it needs; language_tag is filled the way Amazon sent the others. */
function leNewEntry(name) {
  const def = LE_SCHEMA[name] || {};
  const entry = {};
  const lang = ((LE.attributes || {})[name] || []).map(existing => existing.language_tag).find(Boolean)
    || ((def.fields || []).some(field => field.field === 'language_tag') ? 'en_US' : '');
  if (lang) entry.language_tag = lang;
  leFields(def).forEach(field => {
    if (field.enum && field.enum.length === 1) leSet(entry, field.field, field.enum[0]);
  });
  (def.fields || []).filter(field => /\.language_tag$/.test(field.field)).forEach(field => leSet(entry, field.field, lang || 'en_US'));
  return entry;
}

// Wire the fixer that leFixRender just drew: every input, the card buttons, Suggest a title, Check and Apply.
function leFixWire() {
  const root = $('leFix');
  // --- typing or picking in a field: write it into the edit record ---
  root.querySelectorAll('[data-le]').forEach(inp => inp.oninput = inp.onchange = () => {
    const edit = leTouch(inp.dataset.le);
    const field = inp.dataset.f;
    const i = Number(inp.dataset.i);
    const def = (LE_SCHEMA[inp.dataset.le].fields || []).find(each => each.field === field) || {};
    let value = inp.value;
    if (def.type === 'number' || def.type === 'integer') value = value === '' ? null : Number(value);
    leSet(edit.vals[i], field, value);
    /* A nested holder needs its language when Amazon's schema has one (unit_count.type.language_tag). */
    if (field.indexOf('.') > 0) {
      const holder = field.split('.')[0];
      if ((LE_SCHEMA[inp.dataset.le].fields || []).some(each => each.field === holder + '.language_tag')
          && !leGet(edit.vals[i], holder + '.language_tag')) leSet(edit.vals[i], holder + '.language_tag', 'en_US');
    }
    if (inp.tagName === 'TEXTAREA' && $('leTitleN')) {
      $('leTitleN').textContent = value.length;
      $('leTitleN').style.color = value.length > 75 ? 'var(--bad-ink)' : '';
    }
    if (inp.tagName === 'SELECT') leFixRender();
    else {
      const nChanges = Object.keys(LE_EDIT).length;
      if ($('leApply')) {
        $('leApply').disabled = $('leCheck').disabled = !nChanges;
        $('leApply').textContent = 'Apply to Amazon' + (nChanges ? ' (' + nChanges + ')' : '');
      }
    }
  });
  // --- the card buttons: remove an attribute, undo, add a value, remove a value ---
  root.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
    LE_EDIT[btn.dataset.del] = { del: true };
    leFixRender();
  });
  root.querySelectorAll('[data-undo]').forEach(btn => btn.onclick = () => {
    delete LE_EDIT[btn.dataset.undo];
    leFixRender();
  });
  root.querySelectorAll('[data-add]').forEach(btn => btn.onclick = () => {
    leTouch(btn.dataset.add).vals.push(leNewEntry(btn.dataset.add));
    leFixRender();
  });
  root.querySelectorAll('[data-rm]').forEach(btn => btn.onclick = () => {
    leTouch(btn.dataset.rm).vals.splice(Number(btn.dataset.i), 1);
    leFixRender();
  });
  // --- Suggest a 75-character title: ask the backend, fill it in as an edit ---
  const sug = root.querySelector('[data-suggest]');
  if (sug) sug.onclick = async () => {
    sug.disabled = true;
    sug.textContent = 'Working it out…';
    try {
      const reply = await baCall({ listing: 'review', asin: LE.asin, brand: $('leBrand').value, target: 75 });
      const suggestion = reply.suggestion;
      if (!suggestion || !suggestion.ok || !suggestion.suggested) throw new Error('no suggestion for this listing');
      const edit = leTouch('item_name');
      if (!edit.vals.length) edit.vals.push(leNewEntry('item_name'));
      edit.vals[0].value = suggestion.suggested;
      leFixRender();
      leMsg('Suggested title filled in (' + suggestion.suggested.length + ' characters) — it only rearranges and trims what the listing already says. Read it before applying.');
    } catch (e) {
      sug.disabled = false;
      sug.textContent = 'Suggest a 75-character title';
      leMsg('Could not suggest a title: ' + (e.message || e), true);
    }
  };
  // --- the content section's own controls, the Image Manager hand-off, Check and Apply ---
  lcWire(leFixRender);
  if ($('leToImg')) $('leToImg').onclick = () => {
    showTab('img');
    $('imBrand').value = $('leBrand').value;
    $('imQ').value = LE.sku;
    IM_SKU_CHOICES = null;
    imLoad(LE.sku);
    window.scrollTo(0, 0);
  };
  if ($('leCheck')) $('leCheck').onclick = () => leSend(false);
  if ($('leApply')) $('leApply').onclick = () => leSend(true);
}

// Check (apply = false) or Apply (apply = true): send the patches through imPost and show what Amazon answered.
async function leSend(apply) {
  const patches = lePatches();
  if (!patches.length) return;
  if (apply && !confirm('Send ' + patches.length + ' change(s) for ' + LE.sku + ' to Amazon?\n\n'
      + patches.map(patch => (patch.op === 'delete' ? 'remove ' : 'set ') + patch.path.replace('/attributes/', '')).join('\n')
      + '\n\nAmazon checks it first; if it reports a problem nothing is sent.')) return;
  $('leCheck').disabled = $('leApply').disabled = true;
  $('leSendMsg').textContent = apply ? 'Sending to Amazon…' : 'Asking Amazon…';
  // --- send ---
  let reply;
  try {
    reply = await imPost({ lfix: 'patch', brand: $('leBrand').value, sku: LE.sku, productType: LE.productType, patches, apply, by: ME.email });
  } catch (e) {
    reply = { ok: false, error: String(e.message || e) };
  }
  // --- show the answer ---
  const issuesHtml = (reply.issues || []).map(issue => `<div style="font-size:12px;margin:3px 0">`
    + `<span class="st ${issue.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${leEsc(issue.severity)}</span> ${leEsc(issue.message)}</div>`).join('');
  const head = !reply.ok ? `<div class="err" style="font-size:12.5px">${leEsc(reply.error || 'Failed')}</div>`
    : reply.previewOnly ? `<div style="font-size:12.5px;color:var(--accent-ink)">Amazon has no objection. Press Apply to send it.</div>`
    : `<div style="font-size:12.5px;color:var(--accent-ink)">Accepted by Amazon (submission ${leEsc(reply.submissionId || '')}). `
      + `Queued, not live yet: Amazon usually updates the listing and clears the issue within minutes to a few hours. `
      + `Press Refresh from Amazon later to see it gone from the list.</div>`;
  LE_RESULT = `<div style="margin-top:8px">${head}${issuesHtml}</div>`;
  if ($('leResult')) $('leResult').innerHTML = LE_RESULT;
  $('leSendMsg').textContent = '';
  if (reply.ok && !reply.previewOnly) {
    /* What was sent is now what the listing holds, as far as this screen knows. */
    Object.entries(LE_EDIT).forEach(([name, edit]) => {
      if (edit.del) delete LE.attributes[name];
      else LE.attributes[name] = edit.vals;
    });
    LE_EDIT = {};
    leFixRender();
  } else {
    $('leCheck').disabled = $('leApply').disabled = false;
  }
}

/* ============================================================================================
 * 4. EVENT WIRING
 * ============================================================================================ */
let LE_T = 0;     // debounce timer for the search box
// Brand changed: back to the list, page 1, and that brand's snapshot.
$('leBrand').onchange = () => {
  LE_PAGE = 0;
  LE_ONLY = null;
  leShow(false);
  leListEnsure();
};
// Kind or severity changed: redraw the list from page 1.
$('leKind').onchange = $('leSev').onchange = () => {
  LE_PAGE = 0;
  leShow(false);
  leRender();
};
// Search box: redraw a quarter of a second after typing stops.
$('leQ').addEventListener('input', () => {
  clearTimeout(LE_T);
  LE_T = setTimeout(() => {
    LE_PAGE = 0;
    leShow(false);
    leRender();
  }, 250);
});
// Refresh from Amazon: rebuild this brand's snapshot, then redraw.
$('leRefresh').onclick = async () => {
  await imListBuild($('leBrand').value);
  leRender();
};
// Back from the fixer to the list.
$('leBack').onclick = () => {
  leShow(false);
  leRender();
};
// Download / upload the content sheet (listing-content.js).
$('leDown').onclick = () => lcDownload();
$('leUpBtn').onclick = () => {
  $('leUpFile').value = '';
  $('leUpFile').click();
};
$('leUpFile').onchange = () => {
  const file = $('leUpFile').files[0];
  if (file) lcUpload(file);
};
