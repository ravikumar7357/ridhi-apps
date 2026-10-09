/* ================= IMAGE MANAGER =================
 *
 * One listing's image stack — MAIN, PT01..PT08 and the SWATCH — read from Amazon, rearranged here,
 * and sent back through the Listings Items API (backend: ListingImages.gs).
 *
 * Two rows on purpose. "Live on Amazon" is the catalogue, what shoppers see now. "Your stack" is
 * what will be sent. They can differ for hours after a change, because Amazon processes a listing
 * patch asynchronously: ACCEPTED means queued, not live.
 *
 * Every send is checked with Amazon first (VALIDATION_PREVIEW) and only goes for real when Amazon
 * reports no error. New pictures go to a public Drive folder, because Amazon takes an address and
 * fetches the picture itself.
 */
const IM_SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'];
let IM = null;          // what the backend answered
let IM_START = {};      // slot -> url the stack started from
let IM_NOW = {};        // slot -> url as edited (MAIN..PT08 + SWCH)
let IM_DIMS = {};       // url -> {w,h}, measured in the browser
let IM_DRAG = '';
let IM_RESULT = '';     // the last answer from Amazon, kept across redraws

function imMsg(t, bad) { const el = $('imMsg'); if (el) { el.textContent = t || ''; el.className = bad ? 'err' : 'muted'; } }
const imEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function ensureImg() { imListEnsure(); }

async function imPost(body) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  // text/plain keeps it a simple request: Apps Script cannot answer a CORS preflight.
  const r = await fetch(API.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({ key: API.key }, body)), redirect: 'follow' });
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('The backend did not answer with data: ' + text.slice(0, 120)); }
}

async function imLoad(skuPick) {
  const q = ($('imQ').value || '').trim();
  if (!q) { imMsg('Type a SKU or an ASIN.', true); return; }
  const isAsin = /^B0[A-Z0-9]{8}$/i.test(q) && !skuPick;
  imShowEditor(true);
  $('imGo').disabled = true;
  imMsg('Reading the listing from Amazon…');
  try {
    const p = { limg: 'get', brand: $('imBrand').value };
    if (skuPick) p.sku = skuPick; else if (isAsin) p.asin = q.toUpperCase(); else p.sku = q;
    const r = await baCall(p);
    IM = r;
    if (skuPick && IM_SKU_CHOICES) IM.skuChoices = IM_SKU_CHOICES;
    IM_SKU_CHOICES = r.skuChoices || IM_SKU_CHOICES;
    IM_START = {};
    [...IM_SLOTS, 'SWCH'].forEach(s => {
      IM_START[s] = (r.listing && r.listing[s]) || (r.catalog && r.catalog[s] && r.catalog[s].link) || '';
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
let IM_SKU_CHOICES = null;

$('imGo').onclick = () => { IM_SKU_CHOICES = null; imLoad(); };
function imShowEditor(on) {
  $('imEditWrap').classList.toggle('hide', !on);
  $('imListWrap').classList.toggle('hide', on);
}
$('imBack').onclick = () => { imShowEditor(false); if (IML_DIRTY) { IML_DIRTY = false; imListRender(); } };

/** Slots whose address differs from where the stack started. '' = removed. */
function imChanges() {
  const set = {};
  [...IM_SLOTS, 'SWCH'].forEach(s => { if ((IM_NOW[s] || '') !== (IM_START[s] || '')) set[s] = IM_NOW[s] || ''; });
  return set;
}

function imMeasure(url) {
  if (!url || IM_DIMS[url]) return;
  IM_DIMS[url] = { w: 0, h: 0 };
  const i = new Image();
  i.onload = () => { IM_DIMS[url] = { w: i.naturalWidth, h: i.naturalHeight }; imRender(); };
  i.src = url;
}

function imCard(slot, url, opts) {
  const o = opts || {};
  const changed = o.edit && (IM_NOW[slot] || '') !== (IM_START[slot] || '');
  let dim = '';
  if (o.w) dim = o.w + '×' + o.h;
  else if (url && IM_DIMS[url] && IM_DIMS[url].w) dim = IM_DIMS[url].w + '×' + IM_DIMS[url].h;
  const dW = o.w || (IM_DIMS[url] && IM_DIMS[url].w) || 0, dH = o.h || (IM_DIMS[url] && IM_DIMS[url].h) || 0;
  const small = slot !== 'SWCH' && dW && Math.max(dW, dH) < 1000;
  const label = slot === 'SWCH' ? 'Swatch' : slot === 'MAIN' ? 'Main' : slot;
  const pic = url
    ? `<img src="${imEsc(url)}" alt="${label}" loading="lazy" draggable="false"
         style="width:100%;height:100%;object-fit:contain;background:#fff">`
    : `<div class="muted" style="font-size:11px">empty</div>`;
  const tools = o.edit ? `<div style="display:flex;gap:4px;justify-content:center;margin-top:4px;flex-wrap:wrap">
      ${slot !== 'SWCH' && slot !== 'MAIN' ? `<button class="ghost im-b" data-act="left" data-slot="${slot}" title="Move left">◀</button>` : ''}
      ${slot !== 'SWCH' && slot !== 'PT08' ? `<button class="ghost im-b" data-act="right" data-slot="${slot}" title="Move right">▶</button>` : ''}
      <button class="ghost im-b" data-act="file" data-slot="${slot}" title="Upload a picture into this slot">Upload</button>
      <button class="ghost im-b" data-act="url" data-slot="${slot}" title="Paste an image address">URL</button>
      ${url && slot !== 'MAIN' ? `<button class="ghost im-b" data-act="del" data-slot="${slot}" title="Empty this slot">✕</button>` : ''}
      ${changed ? `<button class="ghost im-b" data-act="undo" data-slot="${slot}" title="Back to how it was">↺</button>` : ''}
    </div>` : '';
  return `<div class="im-card${changed ? ' im-chg' : ''}" data-slot="${slot}" ${o.edit && slot !== 'SWCH' ? 'draggable="true"' : ''}>
      <div class="im-pic">${url ? `<a href="${imEsc(url)}" target="_blank" rel="noopener" draggable="false">${pic}</a>` : pic}</div>
      <div style="font-size:11px;font-weight:600;margin-top:3px">${label}${changed ? ' · changed' : ''}</div>
      <div class="muted" style="font-size:10.5px${small ? ';color:var(--bad)' : ''}">${dim || '&nbsp;'}${small ? ' · no zoom' : ''}</div>
      ${tools}
    </div>`;
}

function imRender() {
  const d = IM; if (!d) return;
  [...IM_SLOTS, 'SWCH'].forEach(s => { if (IM_NOW[s]) imMeasure(IM_NOW[s]); });
  const cat = d.catalog || {};
  const live = IM_SLOTS.map(s => imCard(s, cat[s] && cat[s].link, cat[s] || {})).join('')
    + `<div class="im-sep"></div>` + imCard('SWCH', cat.SWCH && cat.SWCH.link, cat.SWCH || {});
  const mine = IM_SLOTS.map(s => imCard(s, IM_NOW[s], { edit: true })).join('')
    + `<div class="im-sep"></div>` + imCard('SWCH', IM_NOW.SWCH, { edit: true });
  const ch = imChanges(), n = Object.keys(ch).length;
  const choices = (d.skuChoices && d.skuChoices.length > 1)
    ? `<select id="imSku" style="width:auto;padding:3px 6px;font-size:12px">${d.skuChoices.map(c =>
        `<option value="${imEsc(c.sku)}"${c.sku === d.sku ? ' selected' : ''}>${imEsc(c.sku)}${c.status ? ' · ' + imEsc(c.status) : ''}</option>`).join('')}</select>`
    : `<b>${imEsc(d.sku)}</b>`;
  const issues = (d.issues || []).length
    ? `<div class="card" style="padding:10px 14px;margin-bottom:12px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">Amazon's open issues on this listing</div>
        ${d.issues.map(i => `<div style="font-size:12px;margin:3px 0"><span class="st ${i.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${imEsc(i.severity)}</span> ${imEsc(i.message)}</div>`).join('')}</div>` : '';
  const onlyCatalog = [...IM_SLOTS, 'SWCH'].filter(s => !(d.listing || {})[s] && cat[s]);

  $('imBody').innerHTML = `
    <div class="card" style="padding:10px 14px;margin-bottom:12px;font-size:13px">
      <div style="font-weight:600;margin-bottom:4px">${imEsc(d.title)}</div>
      <div class="muted" style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;align-items:center">
        <span>SKU ${choices}</span><span>ASIN <b>${imEsc(d.asin)}</b></span>
        ${d.parent ? `<span>Parent ${imEsc(d.parent)}</span>` : ''}
        ${d.color ? `<span>Colour ${imEsc(d.color)}</span>` : ''}${d.size ? `<span>Size ${imEsc(d.size)}</span>` : ''}
        <span>Type ${imEsc(d.productType)}</span><span>${imEsc((d.status || []).join(', '))}</span>
        <a href="https://www.amazon.com/dp/${imEsc(d.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a>
      </div>
    </div>
    ${issues}
    <div class="card" style="padding:10px 14px;margin-bottom:12px">
      <div style="font-weight:600;font-size:13px">Live on Amazon now</div>
      <div class="muted" style="font-size:11.5px;margin-bottom:6px">What shoppers see. ${d.catalogError ? imEsc(d.catalogError) : ''}</div>
      <div class="im-row">${live}</div>
    </div>
    <div class="card" style="padding:10px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:600;font-size:13px">Your stack</div>
        <span class="muted" style="font-size:11.5px">Drag to reorder. Upload or paste an address into any slot. The swatch is the small colour tile shoppers click between variations.</span>
      </div>
      <div class="im-row" id="imMine" style="margin-top:8px">${mine}</div>
      ${onlyCatalog.length ? `<div class="muted" style="font-size:11.5px;margin-top:6px">${onlyCatalog.join(', ')} come from the catalogue, not from your listing. Emptying one of those here may not remove it from Amazon if another contributor supplied it.</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
        <button id="imCheck" class="ghost" style="width:auto;padding:6px 14px" ${n ? '' : 'disabled'}>Check with Amazon</button>
        <button id="imApply" style="width:auto;padding:6px 14px" ${n ? '' : 'disabled'}>Apply to Amazon${n ? ' (' + n + ')' : ''}</button>
        <button id="imReset" class="ghost" style="width:auto;padding:6px 14px" ${n ? '' : 'disabled'}>Discard changes</button>
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

function imSwap(a, b) { const t = IM_NOW[a]; IM_NOW[a] = IM_NOW[b]; IM_NOW[b] = t; imRender(); }

let IM_FILE_SLOT = '';
function imWire() {
  const sel = $('imSku'); if (sel) sel.onchange = () => imLoad(sel.value);
  document.querySelectorAll('#imMine .im-b').forEach(b => b.onclick = () => {
    const s = b.dataset.slot, i = IM_SLOTS.indexOf(s);
    if (b.dataset.act === 'left') imSwap(s, IM_SLOTS[i - 1]);
    else if (b.dataset.act === 'right') imSwap(s, IM_SLOTS[i + 1]);
    else if (b.dataset.act === 'del') { IM_NOW[s] = ''; imRender(); }
    else if (b.dataset.act === 'undo') { IM_NOW[s] = IM_START[s]; imRender(); }
    else if (b.dataset.act === 'url') {
      const u = prompt('Image address for ' + s + ' (https://…, JPEG/PNG):', IM_NOW[s] || '');
      if (u == null) return;
      if (u && !/^https:\/\//i.test(u.trim())) { alert('It must start with https://'); return; }
      IM_NOW[s] = u.trim(); imRender();
    } else if (b.dataset.act === 'file') { IM_FILE_SLOT = s; $('imFile').value = ''; $('imFile').click(); }
  });
  $('imFile').onchange = () => { const f = $('imFile').files[0]; if (f) imUpload(IM_FILE_SLOT, f); };
  document.querySelectorAll('#imMine .im-card[draggable]').forEach(c => {
    c.ondragstart = e => { IM_DRAG = c.dataset.slot; e.dataTransfer.effectAllowed = 'move'; };
    c.ondragover = e => { e.preventDefault(); c.classList.add('im-over'); };
    c.ondragleave = () => c.classList.remove('im-over');
    c.ondrop = e => {
      e.preventDefault(); c.classList.remove('im-over');
      // A dropped FILE goes into this slot; a dragged card moves here and the rest shift along.
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { imUpload(c.dataset.slot, f); return; }
      const from = IM_SLOTS.indexOf(IM_DRAG), to = IM_SLOTS.indexOf(c.dataset.slot);
      if (from < 0 || to < 0 || from === to) return;
      const list = IM_SLOTS.map(s => IM_NOW[s]);
      const [m] = list.splice(from, 1); list.splice(to, 0, m);
      IM_SLOTS.forEach((s, k) => IM_NOW[s] = list[k]);
      imRender();
    };
  });
  const sw = document.querySelector('#imMine .im-card[data-slot="SWCH"]');
  if (sw) {
    sw.ondragover = e => e.preventDefault();
    sw.ondrop = e => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) imUpload('SWCH', f);
      else if (IM_DRAG) { IM_NOW.SWCH = IM_NOW[IM_DRAG]; imRender(); }   // a stack picture used as the swatch
    };
  }
  $('imCheck').onclick = () => imSend(false);
  $('imApply').onclick = () => imSend(true);
  $('imReset').onclick = () => { IM_NOW = Object.assign({}, IM_START); imRender(); };
}

async function imUpload(slot, file) {
  if (!/^image\/(jpeg|png|tiff|gif)$/.test(file.type)) { imMsg('Amazon takes JPEG, PNG, TIFF or GIF.', true); return; }
  if (file.size > 10 * 1024 * 1024) { imMsg('Amazon refuses images over 10 MB.', true); return; }
  imMsg('Uploading ' + file.name + '…');
  try {
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(new Error('Could not read the file'));
      fr.readAsDataURL(file);
    });
    const r = await imPost({ limg: 'upload', name: (IM && IM.sku ? IM.sku + '_' + slot + '_' : '') + file.name, mime: file.type, b64 });
    if (!r.ok) throw new Error(r.error || 'Upload failed');
    // Measured from the local file: the Drive address can take a moment to serve.
    const local = URL.createObjectURL(file), i = new Image();
    i.onload = () => { IM_DIMS[r.url] = { w: i.naturalWidth, h: i.naturalHeight }; imRender(); };
    i.src = local;
    IM_NOW[slot] = r.url;
    imRender();
    imMsg('Uploaded into ' + slot + '. Not on Amazon yet — press Apply.');
  } catch (e) { imMsg(String(e.message || e), true); }
}

async function imSend(apply) {
  const set = imChanges(), n = Object.keys(set).length;
  if (!n) return;
  if (apply && !confirm('Send ' + n + ' image change(s) for ' + IM.sku + ' to Amazon?\n\n'
      + Object.entries(set).map(([s, u]) => s + ': ' + (u ? 'new picture' : 'remove')).join('\n')
      + '\n\nAmazon checks it first; if it reports an error nothing is sent.')) return;
  $('imCheck').disabled = $('imApply').disabled = true;
  $('imSendMsg').textContent = apply ? 'Sending to Amazon…' : 'Asking Amazon…';
  let r;
  try {
    r = await imPost({ limg: 'patch', brand: IM.brand, sku: IM.sku, productType: IM.productType, set, apply, by: ME.email });
  } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  const iss = (r.issues || []).map(i => `<div style="font-size:12px;margin:3px 0"><span class="st ${i.severity === 'ERROR' ? 'st-rejected' : 'st-draft'}">${imEsc(i.severity)}</span> ${imEsc(i.message)}</div>`).join('');
  let head;
  if (!r.ok) head = `<div class="err" style="font-size:12.5px">${imEsc(r.error || 'Failed')}</div>`;
  else if (r.previewOnly) head = `<div style="font-size:12.5px;color:var(--accent)">Amazon has no objection. Press Apply to send it.</div>`;
  else head = `<div style="font-size:12.5px;color:var(--accent)">Accepted by Amazon (submission ${imEsc(r.submissionId || '')}). It is queued, not live: the page usually changes within 15 minutes to a few hours. Reload this listing later to confirm.</div>`;
  IM_RESULT = `<div style="margin-top:8px">${head}${iss}</div>`;
  $('imResult').innerHTML = IM_RESULT;
  $('imSendMsg').textContent = '';
  if (r.ok && !r.previewOnly) {
    IM_START = Object.assign({}, IM_NOW);     // what we sent is now the baseline
    IML_DIRTY = true;
    imRender();
    imHistory();
  } else {
    $('imCheck').disabled = $('imApply').disabled = false;
  }
}

async function imHistory() {
  const el = $('imHist'); if (!el || !IM) return;
  try {
    const r = await baCall({ limg: 'history', sku: IM.sku });
    const rows = r.rows || [];
    el.innerHTML = rows.length ? rows.slice(0, 20).map(x => `<div style="margin:2px 0">${imEsc(new Date(x.at).toLocaleString())} · ${imEsc(x.by || '?')} · ${imEsc(Object.entries(x.set || {}).map(([s, u]) => s + (u ? ' replaced' : ' removed')).join(', '))} · <b>${imEsc(x.status)}</b></div>`).join('')
      : 'None sent from Sellora yet.';
  } catch (e) { el.textContent = 'Could not read the log: ' + (e.message || e); }
}

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
const IML = {};                 // brand -> {at, items}
let IML_DIRTY = false, IML_PAGE = 0, IML_BUSY = false;
const IML_PER = 40;             // listings per screen
const IML_CHUNK = 500;
const IM_PFX = 'https://m.media-amazon.com/images/I/';
const imPackUrl = u => !u ? '' : (u.startsWith(IM_PFX) ? u.slice(IM_PFX.length) : u);
const imUnUrl = u => !u ? '' : (/^https?:/.test(u) ? u : IM_PFX + u);
const imPackMap = m => { const o = {}; Object.keys(m || {}).forEach(k => { o[k] = imPackUrl(m[k]); }); return o; };
const imUnMap = m => { const o = {}; Object.keys(m || {}).forEach(k => { o[k] = imUnUrl(m[k]); }); return o; };
/* Amazon serves any size of its own pictures from the same name: `._SL120_` asks for 120px, which is
 * what a 58px tile needs — the full 2,000px file for thousands of tiles would stall the page. */
const imThumb = u => /m\.media-amazon\.com\/images\/I\/[^/]+\.(jpg|png)$/i.test(u) ? u.replace(/\.(jpg|png)$/i, '._SL120_.$1') : u;

async function imListEnsure() {
  const b = $('imBrand').value;
  if (!(b in IML)) await imListLoad(b);
  if (!IML[b] || !IML[b].items.length) { imListRender(); if (!IML_BUSY) imListBuild(b); return; }
  imListRender();
  const age = IML[b].at ? Date.now() - IML[b].at.getTime() : Infinity;
  if (age > 24 * 3600e3 && !IML_BUSY) imListBuild(b);
}

async function imListLoad(b) {
  try {
    const m = await getDoc(doc(db, 'imgsnap', b));
    if (!m.exists()) { IML[b] = null; return; }
    const d = m.data(), n = d.chunks || 0;
    const got = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(db, 'imgrows', b + '_' + i))));
    let items = [];
    got.forEach(g => { if (g.exists()) items = items.concat(g.data().r || []); });
    IML[b] = { at: d.at && d.at.toDate ? d.at.toDate() : null,
      items: items.map(x => Object.assign({}, x, { live: imUnMap(x.live), img: imUnMap(x.img) })) };
  } catch (e) {
    IML[b] = null;
    imMsg('Could not read the saved snapshot: ' + (e.message || e), true);
  }
}

async function imListBuild(b) {
  if (IML_BUSY) return;
  IML_BUSY = true; $('imRefresh').disabled = true;
  const name = b === 'CPC' ? 'CPC' : 'Ridhi';
  let items = [];
  try {
    /* AMAZON STOPS ONE SEARCH AT 1,000 LISTINGS (both brands came back as exactly 1,000 on 9 Oct).
     * So the catalogue is read in created-date windows, halved until each holds fewer. */
    const iso = t => new Date(t).toISOString();
    const wins = [], todo = [[Date.parse('2010-01-01T00:00:00Z'), Date.now() + 864e5]];
    imMsg('Counting ' + name + ' listings…');
    while (todo.length) {
      const [a, z] = todo.shift();
      const n = (await baCall({ limg: 'page', brand: b, count: 1, after: iso(a), before: iso(z) })).total || 0;
      if (!n) continue;
      if (n > 990 && z - a > 60e3) { const m = Math.floor((a + z) / 2); todo.unshift([a, m], [m, z]); continue; }
      wins.push([a, z]);
    }
    for (const [a, z] of wins) {
      let token = '';
      do {
        imMsg('Reading ' + name + ' listings from Amazon… ' + items.length);
        const r = await baCall({ limg: 'page', brand: b, token, pages: 40, after: iso(a), before: iso(z) });
        items = items.concat(r.items || []);
        token = r.next || '';
      } while (token);
    }
    const seen = new Set();
    items = items.filter(x => !seen.has(x.sku) && seen.add(x.sku));
    const packed = items.map(x => {
      const o = Object.assign({}, x, { live: imPackMap(x.live), img: imPackMap(x.img) });
      delete o.main;
      Object.keys(o).forEach(k => { if (o[k] === undefined || o[k] === '') delete o[k]; });
      return o;
    });
    const chunks = Math.ceil(packed.length / IML_CHUNK) || 1;
    for (let i = 0; i < chunks; i++) await setDoc(doc(db, 'imgrows', b + '_' + i), { r: packed.slice(i * IML_CHUNK, (i + 1) * IML_CHUNK) });
    await setDoc(doc(db, 'imgsnap', b), { chunks, n: packed.length, at: serverTimestamp(), by: ME.email });
    IML[b] = { at: new Date(), items };
    imMsg('');
  } catch (e) {
    imMsg('Reading from Amazon stopped after ' + items.length + ' listings: ' + (e.message || e), true);
    if (items.length && !IML[b]) IML[b] = { at: new Date(), items };
  }
  IML_BUSY = false; $('imRefresh').disabled = false;
  if ($('imBrand').value === b) imListRender();
}

/** Parents with their children; a listing with no parent is a group of its own. */
function imListGroups(items) {
  const bySku = new Map(items.map(x => [x.sku, x]));
  const groups = new Map();
  items.forEach(x => {
    if (x.lvl === 'parent') {
      if (!groups.has(x.sku)) groups.set(x.sku, { parent: x, kids: [], psku: x.sku });
      else groups.get(x.sku).parent = x;
      return;
    }
    const key = x.psku || ('solo:' + x.sku);
    if (!groups.has(key)) groups.set(key, { parent: x.psku ? (bySku.get(x.psku) || null) : null, kids: [], psku: x.psku || '' });
    groups.get(key).kids.push(x);
  });
  return [...groups.values()];
}

function imKidMatch(x, f, q) {
  const live = x.live || {}, img = x.img || {};
  if (q) {
    const hay = [x.sku, x.asin, x.pa, x.psku, x.t, x.c, x.z].join(' ').toLowerCase();
    if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  if (f === 'diff') return IM_SLOTS.some(s => img[s] && live[s] && img[s] !== live[s]);
  if (f === 'few') return IM_SLOTS.filter(s => live[s] || img[s]).length < 7;
  if (f === 'noswatch') return !img.SWCH && !live.SWCH;
  if (f === 'nobuy') return !/BUYABLE/.test(x.st || '');
  return true;
}

function imTile(slot, liveUrl, mineUrl, sw) {
  const u = liveUrl || mineUrl;
  const diff = !!(liveUrl && mineUrl && liveUrl !== mineUrl);
  const lab = slot === 'SWCH' ? 'SW' : slot === 'MAIN' ? 'M' : slot.slice(2);
  if (!u) return `<div class="im-th im-empty${sw ? ' im-sw' : ''}" title="${slot}: empty">${lab}</div>`;
  const tip = slot + (diff ? ' — the live picture differs from what this listing submitted' : '')
    + (!liveUrl && mineUrl ? ' — from your listing' : '');
  return `<a class="im-th${diff ? ' im-diff' : ''}${sw ? ' im-sw' : ''}" href="${imEsc(u)}" target="_blank" rel="noopener" title="${imEsc(tip)}"><img src="${imEsc(imThumb(u))}" loading="lazy" decoding="async" alt="${slot}">${sw ? '' : `<i>${lab}</i>`}</a>`;
}

function imKidRow(x) {
  const live = x.live || {}, img = x.img || {};
  const tiles = IM_SLOTS.map(s => imTile(s, live[s], img[s])).join('')
    + '<span style="width:8px"></span>' + imTile('SWCH', live.SWCH, img.SWCH, true);
  const buy = /BUYABLE/.test(x.st || '');
  return `<div class="im-kid">
    <div class="im-kid-info">
      <div><b style="font-family:ui-monospace,monospace">${imEsc(x.sku)}</b> <span class="muted">${imEsc(x.asin)}</span></div>
      <div class="muted">${imEsc([x.c, x.z].filter(Boolean).join(' · ') || String(x.t || '').slice(0, 60))}</div>
      <div style="margin-top:3px;display:flex;gap:6px;align-items:center">
        <span class="st ${buy ? 'st-approved' : 'st-draft'}" style="font-size:10px">${buy ? 'Buyable' : imEsc(x.st || 'Not buyable')}</span>
        <button class="ghost im-b" data-edit="${imEsc(x.sku)}">Edit</button></div>
    </div>
    <div class="im-strip">${tiles}</div>
  </div>`;
}

function imListRender() {
  const el = $('imList'); if (!el) return;
  const b = $('imBrand').value, data = IML[b];
  if (!data) {
    el.innerHTML = `<div class="card" style="padding:14px"><span class="muted">${IML_BUSY ? 'Reading every listing from Amazon for the first time — about two minutes.' : 'No snapshot yet. Press Refresh from Amazon.'}</span></div>`;
    return;
  }
  const f = $('imFilter').value, q = ($('imQ').value || '').trim().toLowerCase();
  const groups = [];
  imListGroups(data.items).forEach(g => {
    let show = g.kids.filter(k => imKidMatch(k, f, q));
    // A search that names the PARENT shows the whole family.
    if (!show.length && q && g.parent && imKidMatch(g.parent, 'all', q)) show = g.kids.filter(k => imKidMatch(k, f, ''));
    if (show.length) groups.push(Object.assign({}, g, { show }));
  });
  groups.sort((a, b) => (b.kids.length - a.kids.length)
    || String((a.parent || a.kids[0]).t || '').localeCompare(String((b.parent || b.kids[0]).t || '')));
  const nKids = groups.reduce((n, g) => n + g.show.length, 0);
  /* PAGED BY LISTING, not by parent: one Ridhi parent holds 455 children, and twenty groups a page
   * drew 6 MB of tiles. A family longer than a page carries on, its header repeated as "continued". */
  const pages = Math.max(1, Math.ceil(nKids / IML_PER));
  if (IML_PAGE >= pages) IML_PAGE = 0;
  const from = IML_PAGE * IML_PER, to = from + IML_PER;
  const slice = [];
  let at = 0;
  groups.forEach(g => {
    const a = Math.max(from, at), b = Math.min(to, at + g.show.length);
    if (a < b) slice.push(Object.assign({}, g, { show: g.show.slice(a - at, b - at), cont: a > at }));
    at += g.show.length;
  });
  const pager = pages > 1 ? `<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;margin:6px 0">
      <button class="ghost im-b" data-pg="-1" ${IML_PAGE ? '' : 'disabled'}>◀ Prev</button>
      <span class="muted" style="font-size:12px">Page ${IML_PAGE + 1} of ${pages}</span>
      <button class="ghost im-b" data-pg="1" ${IML_PAGE < pages - 1 ? '' : 'disabled'}>Next ▶</button></div>` : '';
  el.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">${groups.length} group(s), ${nKids} listing(s) of ${data.items.length}
      · snapshot ${data.at ? data.at.toLocaleString() : '—'}${IML_BUSY ? ' · refreshing…' : ''}
      · <span style="color:#d97706">orange ring</span> = the live picture differs from what the listing submitted</div>
    ${pager}
    ${slice.map(g => {
      const p = g.parent;
      const head = p
        ? `<div class="im-grp-h">${imTile('MAIN', (p.live || {}).MAIN, (p.img || {}).MAIN)}
            <div style="min-width:0;flex:1"><div style="font-weight:600">${imEsc(p.t)}</div>
            <div class="muted" style="font-size:12px">Parent ${imEsc(p.sku)} · ${imEsc(p.asin)} · ${g.kids.length} child listing(s)${g.show.length < g.kids.length ? ', ' + g.show.length + ' on this page' : ''}${g.cont ? ' · continued' : ''}</div></div></div>`
        : g.psku
          ? `<div class="im-grp-h"><div style="font-weight:600">Parent ${imEsc(g.psku)}</div><span class="muted" style="font-size:12px">${imEsc(g.kids[0].pa || '')} · ${g.kids.length} child listing(s) · the parent listing itself was not found${g.cont ? ' · continued' : ''}</span></div>`
          : `<div class="im-grp-h"><div style="font-weight:600">${imEsc(g.kids[0].t)}</div><span class="muted" style="font-size:12px">No variation parent</span></div>`;
      return `<div class="card im-grp">${head}${g.show.map(imKidRow).join('')}</div>`;
    }).join('')}
    ${pager}`;
  el.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => {
    $('imQ').value = btn.dataset.edit; IM_SKU_CHOICES = null; imLoad(btn.dataset.edit); window.scrollTo(0, 0);
  });
  el.querySelectorAll('[data-pg]').forEach(btn => btn.onclick = () => { IML_PAGE += Number(btn.dataset.pg); imListRender(); window.scrollTo(0, 0); });
}

let IML_T = 0;
const imListAgain = () => { IML_PAGE = 0; imShowEditor(false); imListRender(); };
$('imQ').addEventListener('input', () => { clearTimeout(IML_T); IML_T = setTimeout(imListAgain, 250); });
$('imQ').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(IML_T); imListAgain(); } });
$('imFilter').onchange = imListAgain;
$('imBrand').onchange = () => { IML_PAGE = 0; imShowEditor(false); imListEnsure(); };
$('imRefresh').onclick = () => imListBuild($('imBrand').value);
