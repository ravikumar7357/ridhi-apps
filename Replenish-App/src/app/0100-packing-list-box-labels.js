/* ============================================================================
   PACKING LIST + BOX LABELS

   The same shape as the Pillow Tracker's, deliberately: one list = a set of BOXES, a box = a set of
   ITEMS, and every weight is worked out rather than typed. Two people looking at the two apps should
   not have to learn two models, and a packing list moved between them should still add up.

     { id, date, invoice, title, account, status, pkgWt, volDiv,
       boxes: [ { n, L, W, H, grossWtOverride?, items: [ {desc, sku, material, size, qty, perPcsWt} ] } ] }

   What is different here: the boxes are IMPORTED from a file rather than typed box by box. That is
   the whole reason this exists, so the reader is the part that has to be careful \u2014 see pkMatch.
   ============================================================================ */
let PK = [], PK_LOADED = false, PK_EDIT = null, PK_STAGED = null, PK_LBL = null;
const PK_LS = 'repl.pk.label.v1';

const pkNum = v => { const n = Number(String(v == null ? '' : v).replace(/[, ]/g, '')); return isFinite(n) ? n : 0; };
const pkToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pkId = () => 'PK' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1e4).toString(36).toUpperCase();

/* Every figure on a box, from the two the person actually knows: how many, and what one piece weighs.
 * A typed GROSS wins where it exists \u2014 that one comes off a scale, and a scale beats arithmetic. */
function pkCalc(b, pkgWt, volDiv) {
  const qty = (b.items || []).reduce((s, it) => s + pkNum(it.qty), 0);
  const net = (b.items || []).reduce((s, it) => s + pkNum(it.qty) * pkNum(it.perPcsWt), 0);
  const autoGross = net + pkNum(pkgWt);
  const ov = b.grossWtOverride;
  const gross = (ov !== undefined && ov !== '' && ov !== null && pkNum(ov) > 0) ? pkNum(ov) : autoGross;
  const vol = (pkNum(b.L) * pkNum(b.W) * pkNum(b.H)) / (pkNum(volDiv) || 5000);
  const cbm = (pkNum(b.L) * pkNum(b.W) * pkNum(b.H)) / 1000000;
  return { qty, net, gross, autoGross, vol, cbm };
}
function pkTotals(p) {
  const t = { boxes: (p.boxes || []).length, qty: 0, net: 0, gross: 0, vol: 0, cbm: 0 };
  (p.boxes || []).forEach(b => {
    const c = pkCalc(b, p.pkgWt, p.volDiv);
    t.qty += c.qty; t.net += c.net; t.gross += c.gross; t.vol += c.vol; t.cbm += c.cbm;
  });
  return t;
}

/* Whose name goes on the sheet and on the stamp. The Pillow original hardcodes RIDHI; here there
 * are two brands, and a CPC consignment stamped RIDHI is a customs document with the wrong exporter
 * on it. Read off the list itself, and RIDHI when nothing says otherwise — which is the Pillow case. */
let PK_HOUSE = 'RIDHI';
const pkHouseOf = p => (/cpc/i.test(((p && p.account) || '') + ' ' + ((p && p.title) || '')) ? 'CPC' : 'RIDHI');

/* ---------- what a SKU brings with it ----------
 *
 * THE POINT OF THE WHOLE FEATURE: a file with a SKU, a box and a quantity in it, and nothing else
 * that a person has to type. Description, size and material are facts about the PRODUCT and this app
 * already holds them; asking for them per box is how a packing list ends up describing goods that
 * are not in the box.
 *
 * The description is built the Pillow way, word for word — "Cotton {sub-category} {size}" — so a
 * sheet out of either app reads the same on a customs desk.
 *
 * PER-PIECE WEIGHT IS THE ONE THING NEITHER APP CAN LOOK UP. It is not in the Catalog tab, not in
 * the FBA report, not in the snapshot. So it lives in its own small master here, typed once per SKU
 * and remembered — exactly what Pillow does with its inventory master's perPcsWt field.
 */
let PK_WT = {}, PK_META = {}, PK_WT_LOADED = false;
async function loadPkWt() {
  if (PK_WT_LOADED) return;
  PK_WT_LOADED = true;
  try {
    const d = await getDoc(doc(db, 'repl', 'packwt'));
    PK_WT = (d.exists() && d.data().m) || {};
    PK_META = (d.exists() && d.data().d) || {};
  } catch (e) { PK_WT = {}; PK_META = {}; }   // no master yet — weights read 0, and the editor says so
}
async function savePkWt(patchM, patchD) {
  if (patchM) Object.assign(PK_WT, patchM);
  if (patchD) Object.entries(patchD).forEach(([k, v]) => { PK_META[k] = { ...(PK_META[k] || {}), ...v }; });
  const body = { by: ME.email || '', at: serverTimestamp() };
  if (patchM) body.m = patchM;
  if (patchD) body.d = patchD;
  await setDoc(doc(db, 'repl', 'packwt'), body, { merge: true });
}
function pkLookupSku(sku) {
  const k = String(sku || '').trim().toUpperCase();
  if (!k) return null;
  const rmap = (typeof replRowMap === 'function') ? replRowMap() : {};
  const it = rmap[k];
  const mine = PK_META[k] || {};
  // TYPED WINS OVER THE CATALOGUE. A SKU the snapshot has never heard of otherwise describes itself
  // by its own code — and that code is what would go onto the packing list and the customs label.
  // Correcting it once here is the only way it gets fixed, so a correction must not be recomputed
  // away on the next import.
  const size = String(mine.size || (it ? it.size : '') || '').trim();
  const base = it ? String(it.subcat || '').trim() : '';
  let desc = String(mine.desc || '').trim();
  if (!desc && base) { desc = 'Cotton ' + base; if (size) desc += ' ' + size; }
  return { desc, size, material: '100% COTTON', perPcsWt: pkNum(PK_WT[k]), known: !!it || !!mine.desc };
}

/* ---------- reading the file ----------
 *
 * A .xlsx IS A ZIP OF XML, and the browser can already do both halves. Written out rather than
 * pulled from a CDN: this app loads no external scripts, and a whole spreadsheet library is a large
 * thing to inline for the one job of reading a sheet of rows. Only what is needed is here.
 */
const PK_TD = new TextDecoder();
async function pkInflate(buf) {
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer());
}
/* Reads the CENTRAL DIRECTORY, not the local headers: a local header may say "the sizes follow the
 * data" and then its own size fields read as zero, which produces an empty file and no error. */
async function pkUnzip(bytes, want) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('That does not look like a .xlsx file (no zip directory in it).');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = PK_TD.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!want(name)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = bytes.subarray(start, start + csize);
    out[name] = method === 0 ? raw : await pkInflate(raw);
  }
  return out;
}
const PK_TE = new TextEncoder();
/* Every entry in the file, with its compressed bytes kept as they are — so anything this app does
 * not change can be written back exactly as Amazon wrote it. */
async function pkZipEntries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('That does not look like a .xlsx file (no zip directory in it).');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const attrIn = dv.getUint16(p + 36, true), attrEx = dv.getUint32(p + 38, true);
    const lho = dv.getUint32(p + 42, true);
    const name = PK_TD.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    out.push({ name, flags, method, time, date, crc, csize, usize, attrIn, attrEx,
      data: bytes.subarray(start, start + csize) });
  }
  return out;
}
/* CRC-32, the one thing a zip cannot be written without. */
let PK_CRC_T = null;
function pkCrc32(buf) {
  if (!PK_CRC_T) {
    PK_CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      PK_CRC_T[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = PK_CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function pkDeflate(buf) {
  const cs = new CompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(cs)).arrayBuffer());
}
/** The same file back, with ONE entry's contents replaced and every other byte as it was. */
async function pkZipReplace(bytes, name, text) {
  const entries = await pkZipEntries(bytes);
  const hit = entries.find(e => e.name === name);
  if (!hit) throw new Error('That template has no ' + name + ' in it.');
  const raw = PK_TE.encode(text);
  hit.data = await pkDeflate(raw);
  hit.method = 8; hit.crc = pkCrc32(raw); hit.csize = hit.data.length; hit.usize = raw.length;
  /* A data descriptor after the data would contradict the sizes we have just written. */
  hit.flags &= ~0x08;

  const parts = [], dir = [];
  let at = 0;
  entries.forEach(e => {
    const nameB = PK_TE.encode(e.name);
    const lh = new Uint8Array(30 + nameB.length);
    const d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, e.flags, true);
    d.setUint16(8, e.method, true); d.setUint16(10, e.time, true); d.setUint16(12, e.date, true);
    d.setUint32(14, e.crc, true); d.setUint32(18, e.csize, true); d.setUint32(22, e.usize, true);
    d.setUint16(26, nameB.length, true); d.setUint16(28, 0, true);
    lh.set(nameB, 30);
    parts.push(lh, e.data);
    const ch = new Uint8Array(46 + nameB.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, e.flags, true); c.setUint16(10, e.method, true);
    c.setUint16(12, e.time, true); c.setUint16(14, e.date, true);
    c.setUint32(16, e.crc, true); c.setUint32(20, e.csize, true); c.setUint32(24, e.usize, true);
    c.setUint16(28, nameB.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
    c.setUint16(34, 0, true); c.setUint16(36, e.attrIn, true); c.setUint32(38, e.attrEx, true);
    c.setUint32(42, at, true);
    ch.set(nameB, 46);
    dir.push(ch);
    at += lh.length + e.data.length;
  });
  const dirAt = at;
  let dirLen = 0;
  dir.forEach(b => { parts.push(b); dirLen += b.length; });
  const eocd = new Uint8Array(22), ed = new DataView(eocd.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, entries.length, true); ed.setUint16(10, entries.length, true);
  ed.setUint32(12, dirLen, true); ed.setUint32(16, dirAt, true);
  parts.push(eocd);
  return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const pkUnesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
/** Column letters to a 0-based index. AA is 26, which a plain character sum gets wrong. */
function pkColIx(ref) {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}
async function pkReadXlsx(bytes) {
  const files = await pkUnzip(bytes, n =>
    n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sx = files['xl/sharedStrings.xml'] ? PK_TD.decode(files['xl/sharedStrings.xml']) : '';
  // One <si> can hold several <t> runs where the cell is part bold, part not. They join into one value.
  const shared = sx.split('<si>').slice(1).map(si => {
    let s = ''; for (const m of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += m[1];
    return pkUnesc(s);
  });
  const sheet = Object.keys(files).filter(n => n.startsWith('xl/worksheets/')).sort()[0];
  if (!sheet) throw new Error('That .xlsx has no worksheet in it.');
  const xml = PK_TD.decode(files[sheet]);
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cm[1] ?? cm[3] ?? '', body = cm[2] ?? '';
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let v = '';
      if (type === 'inlineStr') { for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) v += t[1]; v = pkUnesc(v); }
      else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        v = vm ? pkUnesc(vm[1]) : '';
        if (type === 's') v = shared[Number(v)] ?? '';
      }
      // Blank cells are simply absent from the XML, so the position has to come from the reference
      // or every row after a gap shifts left by one.
      const at = ref ? pkColIx(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = v;
    }
    rows.push(cells);
  }
  return rows;
}
async function pkReadFile(file) {
  if (/\.xlsx$/i.test(file.name)) return pkReadXlsx(new Uint8Array(await file.arrayBuffer()));
  return parseCsv(await file.text());
}

/* ---------- matching the columns ----------
 *
 * BY NAME, with the names people actually use, and the header row is FOUND rather than assumed to be
 * row 1 \u2014 a workbook usually opens with a title, a logo row or a totals strip.
 *
 * This is the whole failure mode of the feature: a column that does not match produces no error, it
 * produces a packing list with a figure missing. So nothing is silent here. The preview names every
 * column it matched, every one it could not, and every row it had to drop.
 */
const PK_COLS = [
  ['box',   false, ['box', 'box no', 'box number', 'box #', 'carton', 'carton no', 'ctn', 'ctn no', 'case', 'case no']],
  ['sku',   true,  ['sku', 'msku', 'seller sku', 'item code', 'style', 'item', 'code', 'article code']],
  ['qty',   true,  ['qty', 'quantity', 'units', 'pcs', 'pieces', 'no of pieces', 'qty per box']],
  ['desc',  false, ['description', 'description of goods', 'product', 'title', 'name', 'article', 'item description']],
  ['size',  false, ['size', 'dimension', 'item size']],
  ['mat',   false, ['material', 'composition', 'fabric']],
  ['wt',    false, ['per pcs wt', 'per pc wt', 'unit weight', 'weight per piece', 'pcs wt', 'net wt per pc']],
  // The LINE's total net weight. Most packing sheets carry this rather than a per-piece figure — it
  // is what a scale gives you — so it is read, and the per-piece weight is worked back out of it.
  ['net',   false, ['net wt', 'net weight', 'item net weight', 'item net wt', 'line net', 'net', 'net kg', 'net wt (kg)']],
  ['L',     false, ['l', 'length', 'box length', 'l (cm)', 'length cm']],
  ['W',     false, ['w', 'width', 'box width', 'w (cm)', 'width cm']],
  ['H',     false, ['h', 'height', 'box height', 'h (cm)', 'height cm']],
  ['gross', false, ['gross wt', 'gross weight', 'gross', 'gw', 'gross wt (kg)']],
];
const pkNorm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/[._]/g, ' ')
  .replace(/\s+/g, ' ').replace(/\((kg|cm|kgs|cms)\)$/, '').trim();

function pkMatch(rows) {
  const scan = Math.min(rows.length, 12);
  let best = null;
  for (let r = 0; r < scan; r++) {
    const head = (rows[r] || []).map(pkNorm);
    const idx = {}, seen = {};
    PK_COLS.forEach(([key, , names]) => {
      for (const n of names) {
        const at = head.indexOf(n);
        if (at >= 0 && !seen[at]) { idx[key] = at; seen[at] = 1; return; }
      }
    });
    const need = PK_COLS.filter(([k, req]) => req && idx[k] == null).map(([k]) => k);
    const score = Object.keys(idx).length - need.length * 5;
    if (!best || score > best.score) best = { row: r, idx, need, score, head: rows[r] || [] };
  }
  return best || { row: 0, idx: {}, need: ['box', 'sku', 'qty'], head: [] };
}

/* File rows into BOXES. The file is one row per (box, sku) \u2014 the shape every packing sheet already
 * has \u2014 so the grouping is the box number and nothing else needs a rule.
 *
 * Box DIMENSIONS and a typed GROSS belong to the box, not the line, so they are taken from the FIRST
 * row of each box that carries one. Repeating them on every row of a box is how most people fill
 * these in, and disagreeing rows would otherwise silently take whichever came last. */
function pkBuild(rows, m, defaults) {
  const get = (row, key) => (m.idx[key] == null ? '' : String(row[m.idx[key]] == null ? '' : row[m.idx[key]]).trim());
  const boxes = [], byNo = new Map();
  let dropped = 0, unknown = new Set();
  // Weights the FILE supplied, kept apart from those that came out of the master. Only these are
  // worth writing back — storing the master's own values again would be a no-op that still counts
  // as an edit.
  const fileWt = {};
  for (let r = m.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const sku = get(row, 'sku').toUpperCase();
    const qty = pkNum(get(row, 'qty'));
    const boxNo = get(row, 'box');
    // A row with no SKU or nothing in it is a spacer, a subtotal or a stray note. Counted, not kept.
    if (!sku || !qty) { if (row.some(c => String(c || '').trim())) dropped++; continue; }
    const key = boxNo || '1';
    if (!byNo.has(key)) {
      byNo.set(key, { n: byNo.size + 1, label: key, items: [],
        L: defaults.L, W: defaults.W, H: defaults.H });
      boxes.push(byNo.get(key));
    }
    const b = byNo.get(key);
    const L = pkNum(get(row, 'L')), W = pkNum(get(row, 'W')), H = pkNum(get(row, 'H'));
    if (L) b.L = L; if (W) b.W = W; if (H) b.H = H;
    const g = pkNum(get(row, 'gross')); if (g && !b.grossWtOverride) b.grossWtOverride = g;
    // FILLED IN FROM THE APP'S OWN SNAPSHOT where the file did not say. The description, the size and
    // the material are facts about the product; asking somebody to retype them per box is how a
    // packing list ends up describing the wrong goods.
    const info = pkLookupSku(sku) || {};
    if (!info.known) unknown.add(sku);
    // The FILE wins where it actually said something — somebody who typed a description into their
    // own sheet meant it. Everything left blank comes from this app, which is the ordinary case.
    b.items.push({
      sku,
      desc: get(row, 'desc') || info.desc || sku,
      size: get(row, 'size') || info.size || '',
      material: get(row, 'mat') || info.material || defaults.material,
      qty,
      // Per-piece first, then the line net divided by the quantity, then the master. Whichever the
      // sheet actually carried — and the two are never added, they are the same fact twice.
      perPcsWt: (function () {
        const w = pkNum(get(row, 'wt')) || (qty ? pkNum(get(row, 'net')) / qty : 0);
        if (w) { fileWt[sku] = w; return w; }
        return pkNum(info.perPcsWt);
      })(),
    });
  }
  return { boxes, dropped, unknown: [...unknown], fileWt };
}

/* ---------- storing ---------- */
const PK_STATUS = { draft: 'Draft', progress: 'In progress', done: 'Completed' };
function pkMsg(t, bad) { const el = $('pkMsg'); if (el) { el.textContent = t || ''; el.className = bad ? 'err' : 'muted'; } }

async function loadPk() {
  PK = [];
  const snap = await getDocs(collection(db, 'packlist'));
  snap.forEach(d => PK.push({ id: d.id, ...d.data() }));
  PK.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
  PK_LOADED = true;
}
async function savePkOne(p) {
  p.updatedAt = pkToday() + ' ' + new Date().toTimeString().slice(0, 5);
  p.updatedBy = ME.email || '';
  await setDoc(doc(db, 'packlist', p.id), p);
  const at = PK.findIndex(x => x.id === p.id);
  if (at >= 0) PK[at] = p; else PK.unshift(p);
}

async function ensurePack() {
  await loadPkWt();
  if (PK_LOADED) { renderPack(); return; }
  pkMsg('Loading\u2026');
  try { await loadPk(); pkMsg(''); }
  catch (e) { pkMsg('Could not read the saved packing lists: ' + (e.message || e), true); }
  renderPack();
}

function pkFiltered() {
  const q = ($('pkSearch').value || '').trim().toLowerCase();
  const acc = $('pkAccount').value, from = $('pkFrom').value, to = $('pkTo').value;
  const st = $('pkStatus').value;
  return PK.filter(p => {
    if (st === 'open' && p.status === 'done') return false;
    if (st === 'done' && p.status !== 'done') return false;
    if (acc && (p.account || '') !== acc) return false;
    if (from && String(p.date || '') < from) return false;
    if (to && String(p.date || '') > to) return false;
    if (q && !((p.title || '') + ' ' + (p.invoice || '') + ' ' + (p.account || '')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderPack() {
  // The account list is built from what has actually been saved, so it can never offer a filter that
  // matches nothing.
  const accs = [...new Set(PK.map(p => p.account).filter(Boolean))].sort();
  const sel = $('pkAccount'), keep = sel.value;
  sel.innerHTML = '<option value="">All FBA accounts</option>'
    + accs.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  sel.value = accs.includes(keep) ? keep : '';

  const rows = pkFiltered();
  const head = '<thead><tr><th>Date</th><th>Invoice #</th><th>Title</th><th>FBA account</th>'
    + '<th>Status</th><th class="num">Boxes</th><th class="num">Total qty</th>'
    + '<th class="num">Net wt (kg)</th><th>By</th><th></th></tr></thead>';
  if (!rows.length) {
    $('pkTable').innerHTML = head + `<tbody><tr><td colspan="10" class="muted" style="padding:14px">`
      + (PK.length ? 'No packing list matches these filters.'
        : 'Nothing saved yet \u2014 press \u201cNew from file\u201d and pick your packing sheet (.xlsx or .csv).')
      + '</td></tr></tbody>';
    return;
  }
  $('pkTable').innerHTML = head + '<tbody>' + rows.map(p => {
    const t = pkTotals(p);
    const box = (f, v, w, ph) => `<input class="pkCell" data-id="${esc(p.id)}" data-f="${f}"`
      + ` value="${esc(v || '')}" placeholder="${ph || '\u2014'}" style="width:${w};padding:3px 6px;font-size:12px">`;
    return `<tr>
      <td style="padding:2px 4px"><input class="pkCell" data-id="${esc(p.id)}" data-f="date" type="date"
        value="${esc(p.date || '')}" style="width:130px;padding:3px 6px;font-size:12px"></td>
      <td style="padding:2px 4px">${box('invoice', p.invoice, '108px')}</td>
      <td style="padding:2px 4px">${box('title', p.title, '210px', '(untitled)')}
        <div class="muted" style="font-size:11px">${esc(p.updatedBy || p.by || '')}</div></td>
      <td style="padding:2px 4px">${box('account', p.account, '150px')}</td>
      <td style="padding:2px 4px"><select class="pkCell" data-id="${esc(p.id)}" data-f="status"
        style="width:118px;padding:3px 6px;font-size:12px">`
        + Object.entries(PK_STATUS).map(([k, lbl]) =>
            `<option value="${k}"${(p.status || 'progress') === k ? ' selected' : ''}>${lbl}</option>`).join('')
        + `</select></td>
      <td class="num">${t.boxes}</td>
      <td class="num">${t.qty.toLocaleString('en-US')}</td>
      <td class="num">${t.net.toFixed(2)}</td>
      <td>${esc((p.by || '').split('@')[0])}</td>
      <td style="white-space:nowrap">
        <button class="ghost pkOpen"  data-id="${esc(p.id)}" style="width:auto;padding:2px 8px;font-size:11.5px">Open</button>
        <button class="ghost pkPrint" data-id="${esc(p.id)}" style="width:auto;padding:2px 8px;font-size:11.5px">Packing list</button>
        <button class="ghost pkLbl"   data-id="${esc(p.id)}" style="width:auto;padding:2px 8px;font-size:11.5px">Labels</button>
        <button class="ghost pkAmz"   data-id="${esc(p.id)}" style="width:auto;padding:2px 8px;font-size:11.5px"
                title="Fill Amazon's box-content template from this list — pick the .xlsx Amazon gave you and it comes back with the quantities, weights and sizes in it">FBA file</button>
        <button class="ghost pkDel"   data-id="${esc(p.id)}" style="width:auto;padding:2px 8px;font-size:11.5px">Delete</button>
      </td></tr>`;
  }).join('') + '</tbody>';

  /* EDITED WHERE IT IS READ. Opening a whole editor to fix a mistyped title is a lot of doors for a
   * small mistake, and the mistakes that survive are exactly the small ones. Saved as it is typed,
   * so no half-changed row sits waiting on a button nobody pressed. */
  $('pkTable').querySelectorAll('.pkCell').forEach(el => {
    el.onchange = async () => {
      const p = PK.find(x => x.id === el.dataset.id); if (!p) return;
      const f = el.dataset.f, was = p[f];
      p[f] = (f === 'status') ? el.value : el.value.trim();
      try { await savePkOne(p); renderPack(); pkMsg('Saved.'); }
      catch (e) { p[f] = was; renderPack(); pkMsg('Could not save that: ' + (e.message || e), true); }
    };
  });
  $('pkTable').querySelectorAll('.pkOpen').forEach(b => b.onclick = () => pkOpen(b.dataset.id));
  $('pkTable').querySelectorAll('.pkPrint').forEach(b => b.onclick = () => pkPrintList(PK.find(x => x.id === b.dataset.id)));
  $('pkTable').querySelectorAll('.pkLbl').forEach(b => b.onclick = () => pkLabelsAsk(PK.find(x => x.id === b.dataset.id)));
  $('pkTable').querySelectorAll('.pkAmz').forEach(b => b.onclick = () => pkAmzAsk(b.dataset.id));
  $('pkTable').querySelectorAll('.pkDel').forEach(b => b.onclick = () => pkDelete(b.dataset.id));

  const t = rows.reduce((a, p) => { const x = pkTotals(p); a.b += x.boxes; a.q += x.qty; a.n += x.net; return a; }, { b: 0, q: 0, n: 0 });
  pkMsg(`${rows.length} list(s) of ${PK.length} \u00b7 ${t.b} boxes \u00b7 ${t.q.toLocaleString('en-US')} pcs \u00b7 ${t.n.toFixed(2)} kg net`);
}

