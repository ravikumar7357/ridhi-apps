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

function ensureImg() { /* nothing to load until a listing is asked for */ }

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
$('imQ').addEventListener('keydown', e => { if (e.key === 'Enter') $('imGo').click(); });

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
