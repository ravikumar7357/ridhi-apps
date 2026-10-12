/* ================= SCAN TO PACK (2026-10-10) =================
 *
 * Ravi: "mujhe scanner se packing list banana h (abhi m mere mobile se hi scan karke packing list bana saku) and jab
 * product scan ho to detail aay jo packing list me aati h and additional mujhe product ki image bhi show ho (badi)
 * ... jisase mistake 0% rah jay". Any phone: "ek apana kuch system banao jisase dono phone se kam ho jay".
 *
 * HOW THIS FILE IS LAID OUT:
 *   1. State             — the list being packed, the box, the last scans (for Undo)
 *   2. What a code is    — FNSKU → SKU (pt_fnskuMap, the Finished Goods scanner's map), or a SKU itself
 *   3. Counting          — one scan = pieces-per-scan more of that SKU in the open box; saved as it goes
 *   4. The camera        — the phone's own barcode reader where it has one (Android Chrome), else ZXing
 *                          (public/vendor/zxing.min.js, loaded only here, from this site); a hand scanner or typing too
 *   5. The screen        — a full-screen overlay sized in vw, so it reads the same on any phone without changing the
 *                          app's desktop layout (Ravi chose that layout for phones on 22 Sep — no viewport meta)
 *
 * MISTAKES IT STOPS: a code nobody knows is NEVER counted (red screen, buzz); the same label held in front of the
 * camera counts ONCE — it counts again only after it has left the frame, i.e. the next piece; a read must agree on two
 * frames running; and every count shows the product's picture, large, with its SKU, size and what this box now holds.
 * The list is the same packlist/{id} document the Packing List tab prints, labels and sends to Amazon from.
 *
 * AGAINST THE ORDERS (2026-10-12, merged from the "Pack & verify" hand-over — rules in pack-core.js, shared with the
 * desktop Pack & verify button on Finished Goods): a list may name Order Console orders and/or a pasted Amazon shipment
 * plan. Then a known SKU on none of them is WRONG ARTICLE (red, buzz, listed, never counted), a line already packed or
 * with no pieces in the India Store is NOT COUNTED, and the screen shows what the orders still want. Finish offers
 * Pause (carry on later) or Done, which writes one Send to FBA row per SKU into Finished Goods (packLedgerWrite) so the
 * same pieces are never typed twice; the FBA Dispatch tab then has them. */

/* ============================================================================================
 * 1. STATE
 * ============================================================================================ */
const PKS = { p: null, box: 1, per: 1, hist: [], last: null, seen: null, stream: null, timer: 0, det: null, zx: null,
  saveT: 0, saving: false, dirty: false, err: '', busy: false, on: false };
const PKS_GAP_MS = 700;          // a label gone from the frame this long is the next piece
const PKS_AGREE = 2;             // frames that must read the same code before it counts

/* ============================================================================================
 * 2. WHAT A CODE IS
 * ============================================================================================ */
/** FNSKU first (it is what the labels carry), then a SKU this app knows. Never a guess. */
function pksResolve(code) {
  const c = obUC(code);
  if (!c) return { sku: '', how: '' };
  const byFn = (FN.map || new Map()).get(c);
  if (byFn) return { sku: obUC(byFn), how: 'fnsku' };
  const rmap = (typeof replRowMap === 'function') ? replRowMap() : {};
  if (rmap[c] || PK_META[c] || (PTG.mdb || []).some(r => r && obUC(r.sku) === c)) return { sku: c, how: 'sku' };
  return { sku: '', how: '' };
}
/** The biggest picture this app has for a SKU (Amazon's at 900 px; anything else as it is). */
function pksImg(sku) {
  const k = obUC(sku);
  let u = (typeof ptImgOf === 'function' ? ptImgOf(k) : '') || '';
  if (!u) { const r = (typeof replRowMap === 'function' ? replRowMap() : {})[k]; u = (r && r.image) || ''; }
  return /m\.media-amazon\.com\/images\/I\//.test(u) ? u.replace(/\._[A-Z0-9_,]+_\./, '.').replace(/\.(jpg|png)$/i, '._SL900_.$1') : u;
}

/* ============================================================================================
 * 3. COUNTING
 * ============================================================================================ */
function pksBoxOf(p, n) {
  let b = (p.boxes || []).find(x => +x.n === +n);
  if (!b) { b = { n: +n, L: '', W: '', H: '', items: [] }; p.boxes = (p.boxes || []).concat([b]).sort((a, c) => a.n - c.n); }
  return b;
}
/** A camera read: counts only when it is a NEW piece (see PKS_GAP_MS / PKS_AGREE). Returns true when it counted. */
function pksFrame(code, t, st) {
  st = st || PKS;
  const s = st.seen;
  if (!s || s.code !== code || t - s.last > PKS_GAP_MS) st.seen = { code, last: t, hits: 1, counted: false };
  else { s.last = t; s.hits++; }
  if (!st.seen.counted && st.seen.hits >= PKS_AGREE) { st.seen.counted = true; return true; }
  return false;
}
/** The order lines this list packs against (none for a plain list). */
const pksOrderLines = () => packOrderLines(PKS.p && PKS.p.scan);
/** One scan into the open box. { ok, sku, how, item, box, n, short, left } or { ok:false, kind, code, sku, why }.
 *  kind: unknown (not a code we know) · wrong (known SKU, on none of the list's orders) · full (orders want no more). */
function pksCount(code, via) {
  const p = PKS.p; if (!p) return { ok: false, kind: 'none', code, why: 'No packing list open.' };
  const r = pksResolve(code);
  if (!r.sku) return { ok: false, kind: 'unknown', code: obUC(code), why: 'This code is not in the FNSKU list and is not a SKU this app knows.' };
  /* AGAINST THE ORDERS: a list that names orders counts only what they still want (PACK_CORE.apply, pack-core.js). */
  let n = PKS.per, parts = null, left = null;
  if (packGuarded(p)) {
    const a = PACK_CORE.apply(r, pksOrderLines(), p.scan.packed, PKS.per);
    if (a.kind === 'wrong') {
      p.scan.wrong.push({ at: new Date().toISOString(), code: obUC(code), sku: r.sku, by: ME.email || '' });
      pksSaveSoon();
      return { ok: false, kind: 'wrong', code: obUC(code), sku: r.sku, why: r.sku + ' is not on any order of this list. Keep it aside.' };
    }
    if (a.kind === 'full') return { ok: false, kind: 'full', code: obUC(code), sku: r.sku, why: a.why === 'store'
      ? 'The India Store holds no more ' + r.sku + ' for these orders — receive it in Finished Goods first.'
      : 'Every order line for ' + r.sku + ' is already packed.' };
    n = a.taken; parts = a.parts; left = a.left;
  }
  const b = pksBoxOf(p, PKS.box);
  const it = PACK_CORE.addToBox(b, r.sku, n, pkLookupSku(r.sku) || {});
  PKS.hist.push({ box: b.n, sku: r.sku, n, parts, code: obUC(code), at: Date.now(), via: via || 'camera' });
  PKS.last = { sku: r.sku, how: r.how, code: obUC(code), left };
  pksSaveSoon();
  return { ok: true, sku: r.sku, how: r.how, item: it, box: b, n, short: n < PKS.per, left };
}
function pksUndo() {
  const h = PKS.hist.pop(); if (!h || !PKS.p) return null;
  const b = pksBoxOf(PKS.p, h.box);
  PACK_CORE.takeFromBox(b, h.sku, h.n);
  if (h.parts && PKS.p.scan) PACK_CORE.untake(PKS.p.scan.packed, h.sku, h.parts);
  PKS.last = PKS.hist.length ? { sku: PKS.hist[PKS.hist.length - 1].sku } : null;
  pksSaveSoon(0);
  return h;
}
function pksNextBox(dims) {
  const b = pksBoxOf(PKS.p, PKS.box);
  if (dims) ['L', 'W', 'H'].forEach(k => { if (dims[k] !== undefined && dims[k] !== '') b[k] = pkNum(dims[k]); });
  if (dims && pkNum(dims.gross) > 0) b.grossWtOverride = pkNum(dims.gross);
  PKS.box = Math.max(...(PKS.p.boxes || []).map(x => +x.n), PKS.box) + 1;
  pksBoxOf(PKS.p, PKS.box);
  PKS.seen = null;
  pksSaveSoon(0);
}
/* Saved as it goes: 0.7 s after the last scan, at once on Undo / next box / finish. A failed save keeps the list on the
 * phone, says so in red, and tries again on the next change — a lost box is the worst thing this screen could do. */
function pksSaveSoon(ms) {
  PKS.dirty = true;
  clearTimeout(PKS.saveT);
  PKS.saveT = setTimeout(pksSaveNow, ms == null ? 700 : ms);
}
async function pksSaveNow() {
  if (!PKS.p || PKS.saving || !PKS.dirty) return;
  PKS.saving = true; PKS.dirty = false;
  /* An empty box at the end (made by "next box") is not a box: it is not saved, so a printed list never shows it. */
  const p = Object.assign({}, PKS.p, { boxes: (PKS.p.boxes || []).filter(b => (b.items || []).length || +b.n < PKS.box) });
  try { await savePkOne(p); PKS.err = ''; }
  catch (e) { PKS.err = 'Not saved — ' + (e.message || e) + '. It is kept on this phone and saved with the next scan.'; PKS.dirty = true; }
  PKS.saving = false;
  if (PKS.dirty && !PKS.err) pksSaveSoon();
  pksDraw();
}

/* ============================================================================================
 * 4. THE CAMERA
 * ============================================================================================ */
async function pksCamStart() {
  const v = $('pksVid'); if (!v) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { pksSay('This browser cannot open the camera here — use a hand scanner or type the code below.', true); return; }
  try {
    PKS.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) { pksSay('The camera did not open (' + (e.name || e.message || e) + '). Allow the camera for this site, or use a hand scanner / type the code.', true); return; }
  v.srcObject = PKS.stream; v.setAttribute('playsinline', ''); v.muted = true;
  try { await v.play(); } catch (e) { /* iOS starts it on the next tap */ }
  /* The phone's own reader where there is one; otherwise ZXing, from this site. */
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('code_128'))
      PKS.det = new BarcodeDetector({ formats: ['code_128', 'ean_13', 'code_39', 'upc_a'] });
  } catch (e) { PKS.det = null; }
  if (!PKS.det) {
    try { await pksZxLoad(); } catch (e) { pksSay('The barcode reader did not load — use a hand scanner or type the code.', true); return; }
  }
  const track = PKS.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $('pksTorch').classList.toggle('hide', !caps.torch);
  pksSay(PKS.det ? 'Point at the FNSKU label' : 'Point at the FNSKU label (reader: ZXing)');
  pksLoop();
}
function pksZxLoad() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/zxing.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
/** One frame through ZXing: the middle band of the picture, where the guide box is — faster, and fewer stray reads. */
function pksZxRead(v) {
  const W = v.videoWidth, H = v.videoHeight; if (!W || !H) return null;
  const c = PKS.cv || (PKS.cv = document.createElement('canvas'));
  const cw = Math.min(1280, W), ch = Math.round(H * 0.45), sy = Math.round((H - ch) / 2);
  c.width = cw; c.height = ch;
  c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, sy, W, ch, 0, 0, cw, ch);
  if (!PKS.zx) PKS.zx = new ZXing.Code128Reader();
  try { return PKS.zx.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)))).getText(); }
  catch (e) { return null; }
}
async function pksLoop() {
  if (!PKS.on || !PKS.stream) return;
  const v = $('pksVid');
  let code = null;
  try {
    if (PKS.det) { const got = await PKS.det.detect(v); code = got && got[0] ? got[0].rawValue : null; }
    else code = pksZxRead(v);
  } catch (e) { code = null; }
  if (code && pksFrame(obUC(code), Date.now())) pksHit(code, 'camera');
  PKS.timer = setTimeout(pksLoop, PKS.det ? 90 : 140);
}
function pksCamStop() {
  clearTimeout(PKS.timer);
  if (PKS.stream) PKS.stream.getTracks().forEach(t => t.stop());
  PKS.stream = null;
}

/* ============================================================================================
 * 5. THE SCREEN
 * ============================================================================================ */
let PKS_AC = null;
function pksBeep(good) {
  try {
    PKS_AC = PKS_AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = PKS_AC.createOscillator(), g = PKS_AC.createGain();
    o.type = good ? 'sine' : 'square'; o.frequency.value = good ? 1320 : 180;
    g.gain.value = good ? 0.12 : 0.2; o.connect(g); g.connect(PKS_AC.destination);
    o.start(); o.stop(PKS_AC.currentTime + (good ? 0.09 : 0.45));
  } catch (e) { /* no sound: the colour still says it */ }
  try { if (navigator.vibrate) navigator.vibrate(good ? 60 : [200, 80, 200]); } catch (e) { /* iPhone: no vibration from a web page */ }
}
function pksFlash(good) {
  const ov = $('pksOv'); if (!ov) return;
  ov.classList.remove('pks-ok', 'pks-bad'); void ov.offsetWidth; ov.classList.add(good ? 'pks-ok' : 'pks-bad');
}
const pksSay = (t, bad) => { const el = $('pksSay'); if (el) { el.textContent = t || ''; el.style.color = bad ? '#fecaca' : '#e5e7eb'; } };

function pksHit(code, via) {
  const r = pksCount(code, via);
  if (!r.ok) { PKS.bad = r; pksBeep(false); pksFlash(false); pksSay((r.kind === 'wrong' ? 'WRONG ARTICLE — ' : 'NOT COUNTED — ') + r.code + ': ' + r.why, true); pksDraw(); return; }
  PKS.bad = null;
  pksBeep(true); pksFlash(true);
  pksSay(`+${r.n} ${r.sku}${r.how === 'fnsku' ? ' (from FNSKU ' + obUC(code) + ')' : ''}${r.short ? ` — only ${r.n} of ${PKS.per}: the orders want no more` : ''}${r.left != null ? ` · ${r.left} left on the orders` : ''}`);
  pksDraw();
}

async function pksOpen() {
  if (PKS.on) return;
  await Promise.all([loadPkWt(), PK_LOADED ? null : loadPk().catch(() => {}), fnLoad(), (typeof ptImgShared === 'function' ? ptImgShared().catch(() => {}) : null)]);
  const open = PK.filter(p => p.status !== 'done');
  ptOpenDialog({
    title: 'Scan to pack',
    subtitle: 'Scan each piece\'s FNSKU label with this phone\'s camera, a hand scanner, or type it.',
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
      <label>Packing list<select id="pksPick">
        <option value="">+ A new packing list</option>
        ${open.map(p => `<option value="${esc(p.id)}">${esc((p.title || '(untitled)') + ' · ' + (p.date || '') + ' · ' + pkTotals(p).boxes + ' box(es)')}</option>`).join('')}
      </select></label>
      <label>Title (a new list)<input id="pksTitle" value="Scan ${esc(pkToday())}"></label>
      <label>FBA account (a new list)<input id="pksAcc" list="pksAccs" placeholder="${esc(FGI_FBA_ACCOUNTS.join(' / '))}"><datalist id="pksAccs">${[...new Set(FGI_FBA_ACCOUNTS.concat(PK.map(p => p.account).filter(Boolean)))].map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>
      <label>Pack against orders (optional, a new list)<input id="pksOrds" placeholder="Order Console order numbers, comma separated"></label>
      <label>Amazon shipment plan (optional, a new list)<textarea id="pksPlan" rows="3" placeholder="Paste the Send to Amazon list — a SKU column and a Quantity column"></textarea></label>
      <div class="muted" style="font-size:12px">With orders or a plan, a wrong article is blocked and only what they still want counts; without them every known label counts.
        FNSKU list: ${(FN.map || new Map()).size.toLocaleString('en-US')} codes. A label not on it is never counted — refresh it in Finished Goods → FNSKU list.</div>
    </div>`,
    saveLabel: 'Start scanning',
    onSave: async () => {
      const id = $('pksPick').value;
      if (id) {
        PKS.p = JSON.parse(JSON.stringify(PK.find(p => p.id === id)));
        if (packGuarded(PKS.p)) { const why = await packDataReady(); if (why) return 'This list packs against orders, and the orders could not be read: ' + why; }
      } else {
        /* ORDERS OR A PLAN make a guarded list (pack-core.js): the orders must be in the Order Console, the plan's SKUs known. */
        const ords = ($('pksOrds') ? $('pksOrds').value : '').split(/[,;\s]+/).map(obUC).filter(Boolean);
        const planTxt = ($('pksPlan') ? $('pksPlan').value : '').trim();
        let scan = null;
        if (ords.length || planTxt) {
          const why = await packDataReady(); if (why) return 'Could not read the orders and the Finished Goods ledger: ' + why;
          const bad = packOrdersUnknown(ords); if (bad.length) return 'Not in the Order Console: ' + bad.join(', ');
          let plan = [], planNo = '';
          if (planTxt) {
            const pp = PACK_CORE.planParse(planTxt); if (!pp.lines.length) return pp.why;
            const unk = pp.lines.filter(l => !pksResolve(l.sku).sku).map(l => l.sku); if (unk.length) return 'Not a SKU this app knows: ' + unk.join(', ');
            plan = pp.lines; planNo = 'FBA-PLAN-' + Date.now().toString(36).toUpperCase();
          }
          scan = packScanNew(ords, plan, planNo, '');
        }
        PKS.p = Object.assign({ id: pkId(), date: pkToday(), invoice: '', title: ($('pksTitle').value || '').trim() || 'Scan ' + pkToday(),
          account: ($('pksAcc').value || '').trim(), status: 'progress', pkgWt: 0.5, volDiv: 5000, boxes: [], by: ME.email || '', src: 'scan' }, scan ? { scan } : {});
        try { await savePkOne(PKS.p); } catch (e) { return 'Could not create the list: ' + (e.message || e); }
      }
      /* Carry on in the last box that has something in it — that is where the packer stopped. */
      const used = (PKS.p.boxes || []).filter(b => (b.items || []).length).map(b => +b.n);
      PKS.box = used.length ? Math.max(...used) : 1;
      PKS.hist = []; PKS.last = null; PKS.seen = null; PKS.bad = null; PKS.err = '';
      setTimeout(pksShow, 0);
      return '';
    },
  });
}

function pksShow() {
  let ov = $('pksOv');
  if (!ov) { ov = document.createElement('div'); ov.id = 'pksOv'; document.body.appendChild(ov); }
  ov.className = 'pks';
  ov.innerHTML = `
    <div class="pks-top"><div><b id="pksHead"></b><div id="pksSub" class="pks-sub"></div></div>
      <button class="pks-x" id="pksClose">Finish</button></div>
    <div class="pks-cam"><video id="pksVid" playsinline muted></video><div class="pks-guide"></div>
      <button id="pksTorch" class="pks-mini hide">💡</button></div>
    <div id="pksSay" class="pks-say">Opening the camera…</div>
    <div id="pksErr" class="pks-err hide"></div>
    <div id="pksCard"></div>
    <div class="pks-ctl">
      <button id="pksUndo">↶ Undo</button>
      <label>Pcs / scan <select id="pksPer">${[1, 2, 3, 4, 5, 6, 10, 12, 20, 24].map(n => `<option${n === PKS.per ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <button id="pksNext">Box done → next</button></div>
    <div class="pks-type"><input id="pksCode" placeholder="Hand scanner / type the FNSKU and press Enter" autocomplete="off" autocapitalize="characters"><button id="pksGo">Add</button></div>
    <div id="pksBox"></div>`;
  PKS.on = true;
  $('pksClose').onclick = pksFinishAsk;
  $('pksUndo').onclick = () => { const h = pksUndo(); pksSay(h ? `Undone: −${h.n} ${h.sku} (box ${h.box})` : 'Nothing to undo.'); pksDraw(); };
  $('pksPer').onchange = () => { PKS.per = Math.max(1, +$('pksPer').value || 1); };
  $('pksNext').onclick = pksNextAsk;
  const go = () => { const c = $('pksCode').value.trim(); if (c) { PKS.seen = null; pksHit(c, 'typed'); } $('pksCode').value = ''; };
  $('pksGo').onclick = go;
  $('pksCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  $('pksTorch').onclick = async () => { try { const t = PKS.stream.getVideoTracks()[0]; PKS.torch = !PKS.torch; await t.applyConstraints({ advanced: [{ torch: PKS.torch }] }); } catch (e) { /* not this phone */ } };
  pksDraw();
  pksCamStart();
}

function pksNextAsk() {
  const b = pksBoxOf(PKS.p, PKS.box), q = (b.items || []).reduce((s, x) => s + pkNum(x.qty), 0);
  if (!q) { pksSay('This box is empty — scan something into it first.', true); return; }
  const card = $('pksCard');
  card.innerHTML = `<div class="pks-dims"><div class="pks-big">Box ${b.n} done — ${q} pcs</div>
    <div class="pks-sub">Size and weight now (optional — they can be filled in on the computer later)</div>
    <div class="pks-dimrow"><input id="pksL" inputmode="decimal" placeholder="L cm" value="${esc(b.L || '')}"><input id="pksW" inputmode="decimal" placeholder="W cm" value="${esc(b.W || '')}">
      <input id="pksH" inputmode="decimal" placeholder="H cm" value="${esc(b.H || '')}"><input id="pksG" inputmode="decimal" placeholder="Gross kg" value="${esc(b.grossWtOverride || '')}"></div>
    <div class="pks-dimrow"><button id="pksDimOk">Start box ${PKS.box + 1}</button><button id="pksDimNo" class="pks-ghost">Back to box ${b.n}</button></div></div>`;
  $('pksDimOk').onclick = () => { pksNextBox({ L: $('pksL').value, W: $('pksW').value, H: $('pksH').value, gross: $('pksG').value }); pksSay(`Box ${PKS.box} open — scan its first piece`); PKS.last = null; pksDraw(); };
  $('pksDimNo').onclick = () => pksDraw();
}

function pksDraw() {
  if (!PKS.on || !PKS.p) return;
  const p = PKS.p, b = pksBoxOf(p, PKS.box), t = pkTotals(Object.assign({}, p, { boxes: (p.boxes || []).filter(x => (x.items || []).length) }));
  const boxQty = (b.items || []).reduce((s, x) => s + pkNum(x.qty), 0);
  $('pksHead').textContent = `BOX ${b.n} · ${boxQty} pcs`;
  $('pksSub').textContent = `${p.title || ''} · ${t.boxes} box(es) · ${t.qty} pcs in all`;
  const er = $('pksErr'); er.classList.toggle('hide', !PKS.err); er.textContent = PKS.err;
  const card = $('pksCard');
  if (PKS.bad) {
    const k = PKS.bad.kind, title = k === 'wrong' ? '✕ WRONG ARTICLE' : (k === 'full' ? '■ NOT COUNTED — ORDERS WANT NO MORE' : '✕ NOT COUNTED');
    const img = k === 'wrong' || k === 'full' ? pksImg(PKS.bad.sku) : '';
    card.innerHTML = `<div class="pks-badcard${k === 'full' ? ' pks-fullcard' : ''}"><div class="pks-big">${title}</div><div class="pks-code">${esc(PKS.bad.sku || PKS.bad.code)}</div>
      ${img ? `<img class="pks-img pks-img-sm" src="${esc(img)}" alt="">` : ''}
      <div class="pks-sub">${esc(PKS.bad.why)}${k === 'unknown' ? ' Keep this piece aside and check its label.' : ''}</div></div>`;
  } else if (PKS.last) {
    const sku = PKS.last.sku, it = (b.items || []).find(x => obUC(x.sku) === sku) || {}, info = pkLookupSku(sku) || {}, img = pksImg(sku);
    card.innerHTML = `<div class="pks-prod">
      ${img ? `<img class="pks-img" src="${esc(img)}" alt="">` : '<div class="pks-noimg">No picture for this SKU — check the product by its label</div>'}
      <div class="pks-sku">${esc(sku)}</div>
      <div class="pks-desc">${esc(it.desc || info.desc || '')}</div>
      <div class="pks-facts"><span>Size <b>${esc(it.size || info.size || '—')}</b></span><span>${esc(it.material || info.material || '')}</span>
        <span>${pkNum(it.perPcsWt) ? pkNum(it.perPcsWt).toFixed(2) + ' kg/pc' : '<b style="color:#fca5a5">no weight</b>'}</span></div>
      <div class="pks-count">${pkNum(it.qty)} <small>in box ${b.n}</small></div>
      ${PKS.last.left != null ? `<div class="pks-facts"><span>The orders still want <b>${nf(PKS.last.left)}</b> of this SKU</span></div>` : ''}</div>`;
  } else card.innerHTML = `<div class="pks-empty">Box ${b.n} is open. Scan the first piece.</div>`;
  $('pksBox').innerHTML = `<div class="pks-list-h">In box ${b.n}</div>` + ((b.items || []).slice().reverse().map(x => {
    const u = pksImg(x.sku);
    return `<div class="pks-row">${u ? `<img src="${esc(u)}" alt="">` : '<span class="pks-ph"></span>'}<div><b>${esc(x.sku)}</b><div class="pks-sub">${esc(x.desc || '')}</div></div><div class="pks-q">${pkNum(x.qty)}</div></div>`;
  }).join('') || '<div class="pks-sub">Nothing yet.</div>') + pksOrdersHtml(p);
}
/** What the list's orders still want, per SKU, and what was blocked — only for a list that names orders. */
function pksOrdersHtml(p) {
  if (!packGuarded(p)) return '';
  const rows = PACK_CORE.leftBySku(pksOrderLines(), p.scan.packed);
  const wrong = (p.scan.wrong || []).length;
  return `<div class="pks-list-h">Orders ${esc((p.scan.orders || []).join(', '))}${p.scan.planNo ? (p.scan.orders.length ? ' + ' : '') + 'Amazon plan' : ''} — left to pack${wrong ? ` · <span style="color:#fca5a5">${nf(wrong)} wrong article scan(s)</span>` : ''}</div>`
    + (rows.length ? rows.map(r => `<div class="pks-row pks-row-ord${r.left ? '' : ' pks-row-done'}"><div><b>${esc(r.sku)}</b><div class="pks-sub">packed ${nf(r.got)} of ${nf(r.qty)}</div></div><div class="pks-q">${r.left ? nf(r.left) : '✓'}</div></div>`).join('')
      : '<div class="pks-sub">The orders have no pieces of their SKUs in the India Store — receive them in Finished Goods first.</div>');
}

/* FINISH: Pause keeps the list for later (as before). DONE writes the Send to FBA rows — once — through packLedgerWrite,
 * the same checks a typed dispatch runs, then saves and closes. A list with no orders is dealt to open orders the Auto way. */
function pksFinishAsk() {
  const p = PKS.p, card = $('pksCard'); if (!p || !card) return;
  const t = pkTotals(Object.assign({}, p, { boxes: (p.boxes || []).filter(x => (x.items || []).length) }));
  const done = !!(p.scan && (p.scan.ledgerIds || []).length), accOk = FGI_FBA_ACCOUNTS.indexOf(p.account) >= 0;
  card.innerHTML = `<div class="pks-dims"><div class="pks-big">Finish — ${nf(t.qty)} pcs in ${nf(t.boxes)} box(es)</div>
    ${done ? `<div class="pks-sub">The Send to FBA rows for this list are already written (${nf(p.scan.ledgerIds.length)}). Pause just closes.</div>`
      : `<div class="pks-sub">Done writes one Send to FBA row per SKU into Finished Goods, so nothing is typed twice; the FBA Dispatch tab then has them. Pause keeps the list to carry on later.</div>
    ${accOk ? '' : `<div class="pks-dimrow"><select id="pksDoneAcc"><option value="">FBA account…</option>${FGI_FBA_ACCOUNTS.map(a => `<option${a === p.account ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div>`}
    <div class="pks-dimrow"><input id="pksDoneHand" placeholder="Handed over to (optional)" value="${esc((p.scan && p.scan.handoverTo) || '')}"></div>`}
    <div class="pks-dimrow"><button id="pksPause">Pause — carry on later</button>${done ? '' : '<button id="pksDoneBtn">Done — write Send to FBA</button>'}<button id="pksFinNo" class="pks-ghost">Back</button></div></div>`;
  $('pksPause').onclick = () => pksClose();
  $('pksFinNo').onclick = () => pksDraw();
  if (!done) $('pksDoneBtn').onclick = () => pksDone();
}
async function pksDone() {
  const p = PKS.p; if (!p) return;
  const acc = $('pksDoneAcc') ? $('pksDoneAcc').value : p.account;
  if (FGI_FBA_ACCOUNTS.indexOf(acc) < 0) { pksSay('Pick the FBA account — ' + FGI_FBA_ACCOUNTS.join(' or ') + '.', true); return; }
  p.account = acc;
  const hand = $('pksDoneHand') ? $('pksDoneHand').value : '';
  pksSay('Writing the Send to FBA rows…');
  let res;
  try { res = await packLedgerWrite(p, hand); } catch (e) { res = { err: e.message || String(e) }; }
  if (res.err) { pksSay('Not done — ' + res.err, true); return; }
  PKS.dirty = true; clearTimeout(PKS.saveT); await pksSaveNow();
  if (PKS.err) { pksSay('The rows are written, but the list did not save — ' + PKS.err + ' Press Finish → Done again: nothing is written twice.', true); return; }
  pksCamStop();
  PKS.on = false;
  const ov = $('pksOv'); if (ov) ov.remove();
  if (typeof renderPack === 'function' && PK_LOADED) renderPack();
  if (typeof renderFgi === 'function' && FGI.rows) { try { renderFgi(); } catch (e) { /* not on that tab */ } }
  pkMsg(res.already ? `${p.title}: the Send to FBA rows were already written — list saved.`
    : `${nf(res.rows.length)} Send to FBA row(s) written for ${p.title} (pack ${p.id}) — the FBA Dispatch tab has them. Open the list for sizes and weights, then Packing list / Labels / FBA file as usual.`);
}

async function pksClose() {
  if (PKS.dirty || PKS.saving) { pksSay('Saving…'); clearTimeout(PKS.saveT); await pksSaveNow(); }
  if (PKS.err) { if (!confirm(PKS.err + '\n\nClose anyway? What has not been saved is lost.')) return; }
  pksCamStop();
  PKS.on = false;
  const ov = $('pksOv'); if (ov) ov.remove();
  if (typeof renderPack === 'function' && PK_LOADED) renderPack();
  pkMsg(`Scanned list saved: ${PKS.p.title} — open it to add sizes and weights, then Packing list / Labels / FBA file as usual.`);
}

/* The button on the Packing List toolbar. */
$('pkScanBtn').onclick = () => pksOpen().catch(e => pkMsg('Scan to pack could not start: ' + (e.message || e), true));
