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
let LE_PAGE = 0, LE = null, LE_SCHEMA = {}, LE_EDIT = {}, LE_RESULT = '';
const LE_PER = 50;
const LE_KINDS = [
  ['image', 'Image'], ['title', 'Title too long'], ['value', 'Wrong / old value'],
  ['catalog', 'Differs from catalogue'], ['variation', 'Variation'], ['other', 'Other'],
];
/** What kind of problem an issue is — by Amazon's words and the attributes it names. */
function leKind(i) {
  const m = String(i.m || i.message || ''), a = (i.a || i.attrs || []).join(' ');
  if (/image_locator/.test(a) || /\b(image|MAIN|PT0\d|SWCH|media)\b/i.test(m)) return 'image';
  if (/Item Name that is \d+ characters or less/i.test(m) || (/item_name/.test(a) && /characters/i.test(m))) return 'title';
  if (/different from what's already in the Amazon catalog/i.test(m)) return 'catalog';
  if (/child ASIN|variation|parentage/i.test(m)) return 'variation';
  if (/not a valid value|approved value|enough values|does not belong|no longer applicable|invalid/i.test(m)) return 'value';
  return 'other';
}
const leEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const leNf = v => Math.round(v || 0).toLocaleString('en-US');
const leMsg = (t, bad) => { const el = $('leMsg'); if (el) { el.textContent = t || ''; el.className = bad ? 'err' : 'muted'; } };

/* ============================================================================================
 * 2. THE LIST
 * ============================================================================================ */
function ensureLerr() { leListEnsure(); }

async function leListEnsure() {
  const b = $('leBrand').value;
  if (!(b in IML)) { leMsg('Reading the saved snapshot…'); await imListLoad(b); leMsg(''); }
  leRender();
  if ((!IML[b] || !IML[b].items.length) && !IML_BUSY) { await imListBuild(b); leRender(); }
}

/** Listings with at least one issue of the chosen severity, each with its issues sorted error-first. */
function leRows() {
  const b = $('leBrand').value, data = IML[b];
  if (!data) return null;
  const warn = $('leSev').value === 'all', kind = $('leKind').value, q = ($('leQ').value || '').trim().toLowerCase();
  const out = [];
  data.items.forEach(x => {
    if (x.lvl === 'parent') return;
    let iss = (x.iss || []).filter(i => i.s === 'E' || (warn && i.s === 'W'));
    if (!iss.length && x.ie && !x.iss) iss = [{ s: 'E', m: x.im || '', a: [] }];       // a snapshot from before `iss`
    if (!iss.length) return;
    if (kind !== 'all' && !iss.some(i => leKind(i) === kind)) return;
    if (q && ![x.sku, x.asin, x.c, x.z, x.t].concat(iss.map(i => i.m)).join(' ').toLowerCase().includes(q)) return;
    out.push({ x, iss: iss.slice().sort((p, r) => (p.s === 'E' ? 0 : 1) - (r.s === 'E' ? 0 : 1)) });
  });
  return out;
}

function leRender() {
  const el = $('leList'); if (!el) return;
  const b = $('leBrand').value, data = IML[b];
  if (!data) { el.innerHTML = `<div class="card" style="padding:14px"><span class="muted">${IML_BUSY ? 'Reading every listing from Amazon — about two minutes.' : 'No snapshot yet. Press Refresh from Amazon.'}</span></div>`; return; }
  const rows = leRows();
  const old = !data.items.some(x => x.iss);
  /* The count per kind is over every listing with an ERROR, whatever the filters say. */
  const counts = {};
  data.items.forEach(x => { if (x.lvl === 'parent') return;
    const ks = new Set((x.iss || []).filter(i => i.s === 'E').map(leKind)); ks.forEach(k => counts[k] = (counts[k] || 0) + 1); });
  const pages = Math.max(1, Math.ceil(rows.length / LE_PER));
  if (LE_PAGE >= pages) LE_PAGE = 0;
  const slice = rows.slice(LE_PAGE * LE_PER, (LE_PAGE + 1) * LE_PER);
  const chip = (k, label) => `<button class="ghost im-b" data-kind="${k}" style="${$('leKind').value === k ? 'border-color:var(--accent);color:var(--accent)' : ''}">${leEsc(label)} <b>${leNf(counts[k] || 0)}</b></button>`;
  const pager = pages > 1 ? `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:6px 0">
      <button class="ghost im-b" data-lepg="-1" ${LE_PAGE ? '' : 'disabled'}>◀ Prev</button>
      <span class="muted" style="font-size:12px">Page ${LE_PAGE + 1} of ${pages}</span>
      <button class="ghost im-b" data-lepg="1" ${LE_PAGE < pages - 1 ? '' : 'disabled'}>Next ▶</button></div>` : '';
  el.innerHTML = `
    <div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="muted" style="font-size:12px">Listings with an error, by kind:</span>
        ${LE_KINDS.map(([k, l]) => chip(k, l)).join('')}
        <button class="ghost im-b" data-kind="all">All</button>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">${leNf(rows.length)} listing(s) shown · snapshot ${data.at ? data.at.toLocaleString() : '—'}${IML_BUSY ? ' · refreshing…' : ''}
        ${old ? ' · <b class="err">this snapshot keeps only the first error of each listing — press Refresh from Amazon for all of them</b>' : ''}</div>
    </div>
    ${pager}
    <div class="card" style="padding:0;overflow:auto"><table class="xl" style="width:100%">
      <thead><tr><th></th><th style="text-align:left">SKU</th><th style="text-align:left">Colour · size</th><th>Status</th><th style="text-align:left">What Amazon says</th><th></th></tr></thead>
      <tbody>${slice.map(({ x, iss }) => {
        const pic = (x.live || {}).MAIN || (x.img || {}).MAIN, st = imState(x);
        const hasImg = iss.some(i => leKind(i) === 'image'), hasOther = iss.some(i => leKind(i) !== 'image');
        return `<tr>
          <td style="width:52px">${pic ? `<img src="${leEsc(imThumb(pic))}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:4px">` : ''}</td>
          <td style="text-align:left;white-space:nowrap"><b style="font-family:ui-monospace,monospace">${leEsc(x.sku)}</b><div class="muted" style="font-size:11px">${leEsc(x.asin)} · ${leEsc(x.pt || '')}</div></td>
          <td style="text-align:left;font-size:12px">${leEsc([x.c, x.z].filter(Boolean).join(' · '))}</td>
          <td><span class="st" style="background:${st.fill};color:${st.ink}">${leEsc(st.label)}</span></td>
          <td style="text-align:left;white-space:normal;font-size:12px;max-width:620px">${iss.slice(0, 4).map(i => `<div style="margin:2px 0">
              <span class="st ${i.s === 'E' ? 'st-rejected' : 'st-draft'}" style="font-size:10px">${leEsc((LE_KINDS.find(k => k[0] === leKind(i)) || [, ''])[1])}</span>
              ${leEsc(String(i.m || '').slice(0, 200))}</div>`).join('')}${iss.length > 4 ? `<div class="muted">+${iss.length - 4} more</div>` : ''}</td>
          <td style="white-space:nowrap">${hasOther ? `<button class="im-b" data-fix="${leEsc(x.sku)}">Fix</button>` : ''}
            ${hasImg ? `<button class="ghost im-b" data-img="${leEsc(x.sku)}">Images</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="muted" style="padding:14px">Nothing to fix here.</td></tr>'}</tbody></table></div>
    ${pager}`;
  el.querySelectorAll('[data-kind]').forEach(bn => bn.onclick = () => { $('leKind').value = bn.dataset.kind; LE_PAGE = 0; leRender(); });
  el.querySelectorAll('[data-lepg]').forEach(bn => bn.onclick = () => { LE_PAGE += Number(bn.dataset.lepg); leRender(); window.scrollTo(0, 0); });
  el.querySelectorAll('[data-fix]').forEach(bn => bn.onclick = () => leOpen(bn.dataset.fix));
  el.querySelectorAll('[data-img]').forEach(bn => bn.onclick = () => {
    showTab('img'); $('imBrand').value = $('leBrand').value; $('imQ').value = bn.dataset.img; IM_SKU_CHOICES = null; imLoad(bn.dataset.img); window.scrollTo(0, 0);
  });
}

/* ============================================================================================
 * 3. THE FIXER — one listing
 * ============================================================================================ */
const leShow = on => { $('leFixWrap').classList.toggle('hide', !on); $('leListWrap').classList.toggle('hide', on); };

async function leOpen(sku) {
  leShow(true); window.scrollTo(0, 0);
  LE = null; LE_EDIT = {}; LE_RESULT = '';
  $('leFix').innerHTML = '<div class="card" style="padding:14px"><span class="muted">Reading ' + leEsc(sku) + ' from Amazon…</span></div>';
  try {
    const r = await baCall({ lfix: 'get', brand: $('leBrand').value, sku });
    LE = r;
    const names = [...new Set(r.issues.flatMap(i => i.attrs || []))].filter(a => !/image_locator/.test(a));
    if (names.length && r.productType) {
      const s = await baCall({ lfix: 'schema', brand: $('leBrand').value, pt: r.productType, attrs: names.join(',') });
      LE_SCHEMA = s.attrs || {};
    } else LE_SCHEMA = {};
    leFixRender();
  } catch (e) { $('leFix').innerHTML = `<div class="card err" style="padding:14px">${leEsc(e.message || e)}</div>`; }
}

/* A value is an array of entries; a field may be nested one level ('type.value'). */
const leGet = (e, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), e);
function leSet(e, f, v) { const ks = f.split('.'); let o = e; ks.slice(0, -1).forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); o[ks[ks.length - 1]] = v; }
/** The editable fields of an attribute: its own, minus marketplace and language, and minus an object holder whose
 *  inside is listed (unit_count.type is edited as type.value). */
function leFields(def) {
  const fs = (def.fields || []).filter(f => !/(^|\.)(marketplace_id|language_tag)$/.test(f.field));
  return fs.filter(f => !(f.type === 'object' && fs.some(g => g.field.indexOf(f.field + '.') === 0)));
}

function leCard(name) {
  const def = LE_SCHEMA[name] || { missing: true }, cur = (LE.attributes || {})[name];
  const ed = LE_EDIT[name];
  const pretty = v => (v || []).map(e => leFields(def).map(f => leGet(e, f.field)).filter(x => x != null && x !== '').join(' ') || JSON.stringify(e).slice(0, 80)).join(' | ');
  if (def.missing) {
    return `<div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px">${leEsc(name)}</div>
      <div class="muted" style="font-size:12px;margin:4px 0">Amazon no longer uses this for ${leEsc(LE.productType)}. Now: <b>${leEsc(pretty(cur) || JSON.stringify(cur || '').slice(0, 120))}</b></div>
      ${ed && ed.del ? `<div style="color:var(--accent);font-size:12px">Will be removed. <button class="ghost im-b" data-undo="${leEsc(name)}">Undo</button></div>`
        : `<button class="ghost im-b" data-del="${leEsc(name)}">Remove this attribute</button>`}</div>`;
  }
  const vals = ed && ed.vals ? ed.vals : deltaCloneLe(cur || []);
  const fields = leFields(def);
  const isTitle = name === 'item_name';
  const rows = vals.map((e, i) => `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0">
      ${fields.map(f => {
        const v = leGet(e, f.field);
        const id = `le_${name}_${i}_${f.field}`;
        if (f.enum && f.enum.length) return `<label style="font-size:11.5px" class="muted">${leEsc(f.title)}
            <select data-le="${leEsc(name)}" data-i="${i}" data-f="${leEsc(f.field)}" id="${id}" style="width:auto;min-width:140px">
            ${f.enum.indexOf(v) < 0 && v != null ? `<option value="${leEsc(v)}" selected>${leEsc(v)} — not allowed</option>` : ''}
            ${f.enum.map((o, k) => `<option value="${leEsc(o)}" ${o === v ? 'selected' : ''}>${leEsc((f.enumNames || [])[k] || o)}</option>`).join('')}</select></label>`;
        if (isTitle && f.field === 'value') return `<div style="flex:1 1 100%"><textarea data-le="${leEsc(name)}" data-i="${i}" data-f="value" rows="2" style="width:100%">${leEsc(v || '')}</textarea>
            <div class="muted" style="font-size:11px"><span id="leTitleN" style="${String(v || '').length > 75 ? 'color:var(--bad);font-weight:600' : ''}">${String(v || '').length}</span> / 75 characters (Amazon's limit for using Item Highlights)
            <button class="ghost im-b" data-suggest="1">Suggest a 75-character title</button></div></div>`;
        return `<label style="font-size:11.5px" class="muted">${leEsc(f.title)}
            <input data-le="${leEsc(name)}" data-i="${i}" data-f="${leEsc(f.field)}" type="${f.type === 'number' || f.type === 'integer' ? 'number' : 'text'}" value="${leEsc(v == null ? '' : v)}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ''} style="width:auto;min-width:${f.type === 'number' ? 90 : 220}px"></label>`;
      }).join('')}
      ${vals.length > 1 ? `<button class="ghost im-b" data-rm="${leEsc(name)}" data-i="${i}" title="Remove this value">✕</button>` : ''}</div>`).join('');
  return `<div class="card" style="padding:10px 14px;margin-bottom:10px">
    <div style="font-weight:600;font-size:13px">${leEsc(def.title || name)} <span class="muted" style="font-weight:400;font-size:11.5px">${leEsc(name)}</span>${ed ? ' <span style="color:var(--accent);font-size:11.5px">· changed</span>' : ''}</div>
    ${def.description ? `<div class="muted" style="font-size:11.5px;margin:2px 0 4px">${leEsc(def.description.slice(0, 220))}</div>` : ''}
    ${rows || '<div class="muted" style="font-size:12px">No value yet.</div>'}
    <div style="margin-top:4px">${!def.maxItems || vals.length < def.maxItems ? `<button class="ghost im-b" data-add="${leEsc(name)}">+ Add a value</button>` : ''}
      ${ed ? `<button class="ghost im-b" data-undo="${leEsc(name)}">Undo changes</button>` : ''}</div></div>`;
}
const deltaCloneLe = v => JSON.parse(JSON.stringify(v));

function lePatches() {
  return Object.entries(LE_EDIT).map(([name, ed]) => ed.del ? { op: 'delete', path: '/attributes/' + name }
    : { op: 'replace', path: '/attributes/' + name, value: ed.vals });
}

function leFixRender() {
  const d = LE; if (!d) return;
  const names = [...new Set(d.issues.flatMap(i => i.attrs || []))].filter(a => !/image_locator/.test(a));
  const imgIssues = d.issues.filter(i => leKind(i) === 'image');
  const n = Object.keys(LE_EDIT).length;
  $('leFix').innerHTML = `
    <div class="card" style="padding:10px 14px;margin-bottom:10px;font-size:13px">
      <div style="font-weight:600">${leEsc(d.title)}</div>
      <div class="muted" style="font-size:12px;display:flex;gap:12px;flex-wrap:wrap">
        <span>SKU <b>${leEsc(d.sku)}</b></span><span>ASIN <b>${leEsc(d.asin)}</b></span><span>Type ${leEsc(d.productType)}</span><span>${leEsc((d.status || []).join(', '))}</span>
        <a href="https://www.amazon.com/dp/${leEsc(d.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a></div>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">What Amazon says now (${leNf(d.issues.length)})</div>
      ${d.issues.map(i => `<div style="font-size:12px;margin:3px 0"><span class="st ${i.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${leEsc(i.severity)}</span>
        ${leEsc(i.message)} ${(i.attrs || []).length ? `<span class="muted">· ${leEsc(i.attrs.join(', '))}</span>` : ''}</div>`).join('') || '<div class="muted" style="font-size:12px">No issues — Amazon reports nothing on this listing now.</div>'}
      ${imgIssues.length ? `<div style="margin-top:6px"><button class="ghost im-b" id="leToImg">Fix the images in the Image Manager</button></div>` : ''}
    </div>
    ${names.map(leCard).join('')}
    ${names.length ? `<div class="card" style="padding:10px 14px;margin-bottom:10px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="leCheck" class="ghost" style="width:auto;padding:6px 14px" ${n ? '' : 'disabled'}>Check with Amazon</button>
        <button id="leApply" style="width:auto;padding:6px 14px" ${n ? '' : 'disabled'}>Apply to Amazon${n ? ' (' + n + ')' : ''}</button>
        <span id="leSendMsg" class="muted" style="font-size:12px"></span></div>
      <div id="leResult">${LE_RESULT}</div></div>` : (d.issues.length && !imgIssues.length ? `<div class="card muted" style="padding:10px 14px;font-size:12px">Amazon names no attribute for these, so there is nothing to edit here — most often it needs Seller Central or Seller Support.</div>` : '')}`;
  leFixWire();
}

function leTouch(name) { if (!LE_EDIT[name]) LE_EDIT[name] = { vals: deltaCloneLe((LE.attributes || {})[name] || []) }; return LE_EDIT[name]; }
/** A new entry carries what the field list says it needs; language_tag is filled the way Amazon sent the others. */
function leNewEntry(name) {
  const def = LE_SCHEMA[name] || {}, e = {};
  const lang = ((LE.attributes || {})[name] || []).map(x => x.language_tag).find(Boolean) || ((def.fields || []).some(f => f.field === 'language_tag') ? 'en_US' : '');
  if (lang) e.language_tag = lang;
  leFields(def).forEach(f => { if (f.enum && f.enum.length === 1) leSet(e, f.field, f.enum[0]); });
  (def.fields || []).filter(f => /\.language_tag$/.test(f.field)).forEach(f => leSet(e, f.field, lang || 'en_US'));
  return e;
}

function leFixWire() {
  const root = $('leFix');
  root.querySelectorAll('[data-le]').forEach(inp => inp.oninput = inp.onchange = () => {
    const ed = leTouch(inp.dataset.le), f = inp.dataset.f, i = Number(inp.dataset.i);
    const def = (LE_SCHEMA[inp.dataset.le].fields || []).find(x => x.field === f) || {};
    let v = inp.value;
    if (def.type === 'number' || def.type === 'integer') v = v === '' ? null : Number(v);
    leSet(ed.vals[i], f, v);
    /* A nested holder needs its language when Amazon's schema has one (unit_count.type.language_tag). */
    if (f.indexOf('.') > 0) { const holder = f.split('.')[0]; if ((LE_SCHEMA[inp.dataset.le].fields || []).some(x => x.field === holder + '.language_tag') && !leGet(ed.vals[i], holder + '.language_tag')) leSet(ed.vals[i], holder + '.language_tag', 'en_US'); }
    if (inp.tagName === 'TEXTAREA' && $('leTitleN')) { $('leTitleN').textContent = v.length; $('leTitleN').style.color = v.length > 75 ? 'var(--bad)' : ''; }
    if (inp.tagName === 'SELECT') leFixRender();
    else { const n = Object.keys(LE_EDIT).length; if ($('leApply')) { $('leApply').disabled = $('leCheck').disabled = !n; $('leApply').textContent = 'Apply to Amazon' + (n ? ' (' + n + ')' : ''); } }
  });
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { LE_EDIT[b.dataset.del] = { del: true }; leFixRender(); });
  root.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { delete LE_EDIT[b.dataset.undo]; leFixRender(); });
  root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { leTouch(b.dataset.add).vals.push(leNewEntry(b.dataset.add)); leFixRender(); });
  root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { leTouch(b.dataset.rm).vals.splice(Number(b.dataset.i), 1); leFixRender(); });
  const sug = root.querySelector('[data-suggest]');
  if (sug) sug.onclick = async () => {
    sug.disabled = true; sug.textContent = 'Working it out…';
    try {
      const r = await baCall({ listing: 'review', asin: LE.asin, brand: $('leBrand').value, target: 75 });
      const s = r.suggestion;
      if (!s || !s.ok || !s.suggested) throw new Error('no suggestion for this listing');
      const ed = leTouch('item_name');
      if (!ed.vals.length) ed.vals.push(leNewEntry('item_name'));
      ed.vals[0].value = s.suggested;
      leFixRender();
      leMsg('Suggested title filled in (' + s.suggested.length + ' characters) — it only rearranges and trims what the listing already says. Read it before applying.');
    } catch (e) { sug.disabled = false; sug.textContent = 'Suggest a 75-character title'; leMsg('Could not suggest a title: ' + (e.message || e), true); }
  };
  if ($('leToImg')) $('leToImg').onclick = () => { showTab('img'); $('imBrand').value = $('leBrand').value; $('imQ').value = LE.sku; IM_SKU_CHOICES = null; imLoad(LE.sku); window.scrollTo(0, 0); };
  if ($('leCheck')) $('leCheck').onclick = () => leSend(false);
  if ($('leApply')) $('leApply').onclick = () => leSend(true);
}

async function leSend(apply) {
  const patches = lePatches();
  if (!patches.length) return;
  if (apply && !confirm('Send ' + patches.length + ' change(s) for ' + LE.sku + ' to Amazon?\n\n'
      + patches.map(p => (p.op === 'delete' ? 'remove ' : 'set ') + p.path.replace('/attributes/', '')).join('\n')
      + '\n\nAmazon checks it first; if it reports a problem nothing is sent.')) return;
  $('leCheck').disabled = $('leApply').disabled = true;
  $('leSendMsg').textContent = apply ? 'Sending to Amazon…' : 'Asking Amazon…';
  let r;
  try { r = await imPost({ lfix: 'patch', brand: $('leBrand').value, sku: LE.sku, productType: LE.productType, patches, apply, by: ME.email }); }
  catch (e) { r = { ok: false, error: String(e.message || e) }; }
  const iss = (r.issues || []).map(i => `<div style="font-size:12px;margin:3px 0"><span class="st ${i.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${leEsc(i.severity)}</span> ${leEsc(i.message)}</div>`).join('');
  const head = !r.ok ? `<div class="err" style="font-size:12.5px">${leEsc(r.error || 'Failed')}</div>`
    : r.previewOnly ? `<div style="font-size:12.5px;color:var(--accent)">Amazon has no objection. Press Apply to send it.</div>`
    : `<div style="font-size:12.5px;color:var(--accent)">Accepted by Amazon (submission ${leEsc(r.submissionId || '')}). Queued, not live yet: Amazon usually updates the listing and clears the issue within minutes to a few hours. Press Refresh from Amazon later to see it gone from the list.</div>`;
  LE_RESULT = `<div style="margin-top:8px">${head}${iss}</div>`;
  if ($('leResult')) $('leResult').innerHTML = LE_RESULT;
  $('leSendMsg').textContent = '';
  if (r.ok && !r.previewOnly) {
    /* What was sent is now what the listing holds, as far as this screen knows. */
    Object.entries(LE_EDIT).forEach(([k, ed]) => { if (ed.del) delete LE.attributes[k]; else LE.attributes[k] = ed.vals; });
    LE_EDIT = {};
    leFixRender();
  } else { $('leCheck').disabled = $('leApply').disabled = false; }
}

/* ============================================================================================
 * 4. EVENT WIRING
 * ============================================================================================ */
let LE_T = 0;
$('leBrand').onchange = () => { LE_PAGE = 0; leShow(false); leListEnsure(); };
$('leKind').onchange = $('leSev').onchange = () => { LE_PAGE = 0; leShow(false); leRender(); };
$('leQ').addEventListener('input', () => { clearTimeout(LE_T); LE_T = setTimeout(() => { LE_PAGE = 0; leShow(false); leRender(); }, 250); });
$('leRefresh').onclick = async () => { await imListBuild($('leBrand').value); leRender(); };
$('leBack').onclick = () => { leShow(false); leRender(); };
