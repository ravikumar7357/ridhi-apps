/* ================= LISTING · IMAGE QUALITY: one set of picture rules for Image Manager =================
 * Used on the list's tiles (a small size dot), in the editor (chips under each picture), on upload (a picture can be refused)
 * and in the paste preview (a picture that fails needs an extra tick). One function, imqCheck, says what is right and wrong.
 * Rules (company and Amazon):
 *   size   — 2000 × 2000 or more = green; 1000–1999 = yellow "below 2000 — company minimum"; under 1000 on the long side = red "no zoom".
 *   upload — under 2000 px on the shortest side is refused (company rule); over 10 MB is refused (Amazon); under 2 MB is a warning only;
 *            JPEG / PNG / TIFF / GIF only. The swatch is a small colour sample: the size, shape and 2000 rules do not apply to it.
 *   shape  — a warning when width / height is outside 0.9–1.1.
 *   MAIN   — on upload only, the local file is read in a canvas: the outer border white (every channel ≥ 250) or not, and how much of
 *            the picture the product fills (target about 85%). Amazon's own pictures are never read pixel by pixel (Picture check).
 *   twice  — the same picture in two slots of one stack is a warning.
 * Sizes of Amazon's pictures: from the Workspace's catalogue read (catPic) when known, else measured in the browser — only for tiles
 *   on screen, two at a time, and kept per picture id in this browser (a picture id never changes its size).
 * Main functions: imqSize, imqCheck, imqPixels, imqReadFile, imqDups, imqId, imqDims, imqWatch. State: IMQ.
 */
const IMQ_MIN = 2000;                        // company minimum, shortest side
const IMQ_ZOOM = 1000;                       // Amazon zoom, longest side
const IMQ_MAX_BYTES = 10 * 1024 * 1024;      // Amazon refuses bigger files
const IMQ_SMALL_BYTES = 2 * 1024 * 1024;     // under this a 2000 px picture is often soft
const IMQ_SQUARE = [0.9, 1.1];               // width / height
const IMQ_WHITE = 250;                       // every channel at least this = white
const IMQ_WHITE_SHARE = 0.99;                // share of border pixels that must be white (JPEG noise)
const IMQ_FILL = 0.85;                       // how much of the picture the product should fill
const IMQ_FILL_LOW = 0.75;                   // below this: a warning
const IMQ_TYPES = /^image\/(jpeg|png|tiff|gif)$/;
const IMQ_STORE = 'sellora.imgdims';         // localStorage: picture id → [w, h]
const IMQ_STORE_MAX = 20000;
const IMQ_WORDS = { g: '2000 × 2000 or more', y: 'below 2000 — company minimum', r: 'no zoom' };
const IMQ = { dims: null, seeded: {}, queue: [], busy: 0, seen: new Set(), obs: null, onSize: null, saveT: 0 };

/* ----- the rules ----- */
// 'g' | 'y' | 'r' for a picture of w × h; '' when the size is not known.
function imqSize(w, h) {
  w = Number(w) || 0;
  h = Number(h) || 0;
  if (!w || !h) return '';
  if (Math.min(w, h) >= IMQ_MIN) return 'g';
  if (Math.max(w, h) < IMQ_ZOOM) return 'r';
  return 'y';
}
const imqMb = bytes => (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
/** Everything known about one picture → { size, level: ok | warn | bad, block: '' | why it is refused, chips: [{ lv, t, tip }] }.
 *  info: { slot, w, h, bytes, type, upload (a file being uploaded), white (true | false | undefined), fill (0–1), dup (the other slot) }. */
function imqCheck(info) {
  const q = info || {};
  const sw = q.slot === 'SWCH';
  const chips = [];
  let block = '';
  const w = Number(q.w) || 0;
  const h = Number(q.h) || 0;
  const size = sw ? '' : imqSize(w, h);
  if (q.upload) {
    if (q.type != null && !IMQ_TYPES.test(q.type)) block = 'Amazon takes JPEG, PNG, TIFF or GIF.';
    else if (q.bytes > IMQ_MAX_BYTES) block = `Over 10 MB (${imqMb(q.bytes)}) — Amazon refuses it.`;
    else if (!sw && w && Math.min(w, h) < IMQ_MIN) block = `Company rule: at least 2000 × 2000 (this one is ${w} × ${h}).`;
  }
  if (size === 'g') chips.push({ lv: 'ok', t: `${w} × ${h}`, tip: IMQ_WORDS.g });
  else if (size === 'y') chips.push({ lv: 'warn', t: `${w} × ${h} · ${IMQ_WORDS.y}`, tip: 'The company minimum is 2000 × 2000' });
  else if (size === 'r') chips.push({ lv: 'bad', t: `${w} × ${h} · ${IMQ_WORDS.r}`, tip: 'Under 1000 px on the long side: shoppers cannot zoom in' });
  if (!sw && w && h && (w / h < IMQ_SQUARE[0] || w / h > IMQ_SQUARE[1])) chips.push({ lv: 'warn', t: 'Not square', tip: `${w} × ${h} — a square picture fills Amazon's frame` });
  if (q.upload && q.bytes && q.bytes < IMQ_SMALL_BYTES && q.bytes <= IMQ_MAX_BYTES) chips.push({ lv: 'warn', t: 'Small file — check it is sharp', tip: imqMb(q.bytes) });
  if (q.slot === 'MAIN' && q.white === true) chips.push({ lv: 'ok', t: 'Background looks white ✓', tip: 'The outer border of the picture is white' });
  if (q.slot === 'MAIN' && q.white === false) chips.push({ lv: 'bad', t: 'Background not pure white ✗ — Amazon may suppress', tip: 'Amazon wants a pure white background (255, 255, 255) on the main picture' });
  if (q.slot === 'MAIN' && typeof q.fill === 'number') {
    const pct = Math.round(q.fill * 100);
    chips.push(q.fill < IMQ_FILL_LOW ? { lv: 'warn', t: `Product fills about ${pct}% — aim for about 85%`, tip: 'Amazon wants the product to fill about 85% of the picture' }
      : { lv: 'ok', t: `Product fills about ${pct}%`, tip: 'Target about 85%' });
  }
  if (q.dup) chips.push({ lv: 'warn', t: `Same picture as ${q.dup === 'SWCH' ? 'the swatch' : q.dup === 'MAIN' ? 'Main' : q.dup}`, tip: 'The same picture twice in one stack' });
  if (block) chips.unshift({ lv: 'bad', t: block, tip: '' });
  const level = block || chips.some(c => c.lv === 'bad') ? 'bad' : chips.some(c => c.lv === 'warn') ? 'warn' : 'ok';
  return { size, level, block, chips };
}
// The chips as HTML (the editor, the paste preview, the upload message).
const imqChipsHtml = chips => (chips || []).map(c => `<span class="imq-chip is-${c.lv}"${c.tip ? ` title="${imEsc(c.tip)}"` : ''}>${imEsc(c.t)}</span>`).join('');

/** A picture's id: Amazon's file name without the size part (abc._SL120_.jpg → abc), else the whole address. Same as lrPicId. */
const imqId = url => { const m = String(url || '').match(/\/images\/I\/([^./?]+)/); return m ? m[1] : String(url || ''); };
/** Slots holding the same picture as an earlier slot: { slot: the earlier slot }. The swatch is left out: a stack picture used as the
 *  swatch is something the editor offers on purpose (drag a card onto the swatch). */
function imqDups(slots) {
  const first = new Map();
  const out = {};
  ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'].forEach(slot => {
    const url = (slots || {})[slot];
    if (!url) return;
    const id = imqId(url);
    if (first.has(id)) out[slot] = first.get(id);
    else first.set(id, slot);
  });
  return out;
}

/* ----- reading a local file (upload only) ----- */
/** The border and the product of an RGBA picture W × H: { white, fill }. White = at least 99% of the 2-pixel outer ring has every channel
 *  ≥ 250. Fill = the product's box (pixels with a channel under 240) on its longer side, as a share of the picture. */
function imqPixels(data, W, H) {
  const px = (x, y) => { const i = (y * W + x) * 4; return Math.min(data[i], data[i + 1], data[i + 2]); };
  const ring = Math.max(1, Math.min(2, Math.floor(Math.min(W, H) / 4)));
  let n = 0;
  let white = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= ring && x < W - ring && y >= ring && y < H - ring) { if (x === ring) x = W - ring - 1; continue; }
      n++;
      if (px(x, y) >= IMQ_WHITE) white++;
    }
  }
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px(x, y) < 240) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const fill = x1 < 0 ? 0 : Math.max((x1 - x0 + 1) / W, (y1 - y0 + 1) / H);
  return { white: n > 0 && white / n >= IMQ_WHITE_SHARE, fill: Math.round(fill * 100) / 100 };
}
/** A file chosen for upload → { w, h, bytes, type, white?, fill? } (white and fill for MAIN only). The picture is drawn on a white canvas
 *  of at most 400 px, so a see-through background counts as white. Never throws: what could not be read is left out. */
async function imqReadFile(file, slot) {
  const out = { bytes: file.size, type: file.type };
  if (typeof URL === 'undefined' || typeof Image === 'undefined') return out;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('not a picture the browser can read'));
      el.src = url;
    });
    out.w = img.naturalWidth;
    out.h = img.naturalHeight;
    if (slot === 'MAIN' && typeof document !== 'undefined' && document.createElement) {
      const k = Math.min(1, 400 / Math.max(out.w, out.h));
      const W = Math.max(1, Math.round(out.w * k));
      const H = Math.max(1, Math.round(out.h * k));
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      Object.assign(out, imqPixels(g.getImageData(0, 0, W, H).data, W, H));
    }
  } catch (e) { /* the size and the pixels stay unknown; the backend still checks the type */ }
  URL.revokeObjectURL(url);
  return out;
}

/* ----- sizes of Amazon's pictures ----- */
function imqStoreLoad() {
  if (IMQ.dims) return;
  IMQ.dims = new Map();
  try { Object.entries(JSON.parse(localStorage.getItem(IMQ_STORE) || '{}') || {}).forEach(([id, wh]) => { if (Array.isArray(wh)) IMQ.dims.set(id, wh); }); } catch (e) { /* no storage */ }
}
function imqStoreSave() {
  clearTimeout(IMQ.saveT);
  IMQ.saveT = setTimeout(() => {
    try {
      const all = [...IMQ.dims.entries()].slice(-IMQ_STORE_MAX);
      localStorage.setItem(IMQ_STORE, JSON.stringify(Object.fromEntries(all)));
    } catch (e) { /* quota or no storage: kept for this visit */ }
  }, 1500);
}
// The Workspace's catalogue reads (catPic: { slot: [id, w, h] }) give sizes for free; taken once per brand per change of its live map.
function imqSeed(brand) {
  imqStoreLoad();
  if (typeof liWsLiveMap !== 'function') return;
  let map;
  try { map = liWsLiveMap(); } catch (e) { return; }
  const key = brand + '|' + (map && map.v);
  if (IMQ.seeded[brand] === key) return;
  IMQ.seeded[brand] = key;
  Object.values((map && map.live && map.live[brand]) || {}).forEach(entry => {
    Object.values((entry && entry.catPic) || {}).forEach(p => { if (Array.isArray(p) && p[1] && p[2]) IMQ.dims.set(String(p[0]), [p[1], p[2]]); });
  });
}
/** [w, h] of a picture when known (the editor's own measure, the catalogue, or a tile measured before), else null. */
function imqDims(url) {
  if (!url) return null;
  if (typeof IM_DIMS !== 'undefined' && IM_DIMS[url] && IM_DIMS[url].w) return [IM_DIMS[url].w, IM_DIMS[url].h];
  imqStoreLoad();
  return IMQ.dims.get(imqId(url)) || null;
}
// Measure the next queued pictures, two at a time; each answer updates the tiles of that picture and tells the page (IMQ.onSize).
function imqPump() {
  while (IMQ.busy < 2 && IMQ.queue.length) {
    const url = IMQ.queue.shift();
    IMQ.busy++;
    const img = new Image();
    const done = ok => {
      IMQ.busy--;
      if (ok && img.naturalWidth) {
        IMQ.dims.set(imqId(url), [img.naturalWidth, img.naturalHeight]);
        imqStoreSave();
        imqPaint(imqId(url));
        if (typeof IMQ.onSize === 'function') IMQ.onSize(url);
      }
      imqPump();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  }
}
// Every tile of one picture gets its dot.
function imqPaint(id) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  const wh = IMQ.dims.get(id);
  if (!wh) return;
  const s = imqSize(wh[0], wh[1]);
  document.querySelectorAll(`.imq-dot[data-imq="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`).forEach(dot => {
    dot.className = 'imq-dot is-' + s;
    dot.title = `${wh[0]} × ${wh[1]} — ${IMQ_WORDS[s] || ''}`;
    dot.removeAttribute('data-imq-url');
  });
}
/** Watch the tiles just drawn in `root`: a tile whose size is unknown is measured when it comes on screen. */
function imqWatch(root) {
  if (!root || !root.querySelectorAll || typeof IntersectionObserver === 'undefined') return;
  if (!IMQ.obs) {
    IMQ.obs = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      IMQ.obs.unobserve(entry.target);
      const url = entry.target.dataset.imqUrl;
      if (!url || IMQ.seen.has(url)) return;
      IMQ.seen.add(url);
      IMQ.queue.push(url);
      imqPump();
    }), { rootMargin: '100px' });
  }
  root.querySelectorAll('.imq-dot[data-imq-url]').forEach(dot => IMQ.obs.observe(dot));
}
