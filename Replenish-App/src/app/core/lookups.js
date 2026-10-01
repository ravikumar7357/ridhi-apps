/* ================= LOOKUPS THAT DO NOT WALK THE WHOLE LIST =================
 *
 * The app was scanning a 4,706-row master database once per row rendered, and the three production
 * registers once per order line. Measured on the live data, one pass over every screen took SIX
 * SECONDS on a fast machine — several times that on the laptops the floor actually uses, which is
 * what Ravi's team were sitting through.
 *
 * Nothing below changes a single figure. Every index is built from the same rows the scan walked,
 * and the functions that had extra rules keep them.
 *
 * INVALIDATION IS BY ARRAY IDENTITY, not by a flag somebody has to remember to set. Every place that
 * changes these lists REPLACES the array (PTG.mdb = PTG.mdb.map(…), = …concat(…), = …filter(…)) or
 * reloads it wholesale, so a different array object means the data moved and the index is rebuilt.
 * The length is checked too, which catches a push. A stale index here would be worse than a slow
 * one: it would answer confidently with yesterday's master row.
 */

/** SKU → its master row. Built once per version of the master list. */
let MDB_IX = { src: null, n: -1, map: null };
function mdbIndex() {
  const rows = PTG.mdb || [];
  if (MDB_IX.src === rows && MDB_IX.n === rows.length) return MDB_IX.map;
  const m = new Map();
  rows.forEach(r => { if (r && r.sku) { const k = obUC(r.sku); if (!m.has(k)) m.set(k, r); } });
  MDB_IX = { src: rows, n: rows.length, map: m };
  return m;
}
/** The master row for a SKU, or undefined. Replaces (PTG.mdb||[]).find(…) in the hot paths. */
const mdbOf = sku => mdbIndex().get(obUC(sku));
/**
 * A SKU this page's copy of the master does not have, asked of the database itself (2026-10-01). The copy is re-read
 * only every 30 minutes (PTG_MDB_STALE_MS), so a SKU added to the master a minute ago was refused as "not in the master
 * database" — Ravi added RCN148 and could not move a Job Work row onto it. pt_masterDB is indexed on sku, so this reads
 * one row, not 2 MB. A row found is added to the copy, so every screen knows it from then on. A failed read is null.
 */
async function mdbFetchSku(sku) {
  const want = String(sku || '').trim();
  if (!want) return null;
  const q = await ptAuthQuery();
  for (const v of [...new Set([want, obUC(want)])]) {
    let got = null;
    try {
      const r = await fetch(`${PT_URL}/pt_masterDB.json?orderBy=%22sku%22&equalTo=${encodeURIComponent(JSON.stringify(v))}` + (q ? '&' + q.slice(1) : ''));
      if (!r.ok) continue;
      got = await r.json();
    } catch (e) { continue; }
    const rows = Object.entries(got || {}).map(([k, x]) => (x && typeof x === 'object' ? Object.assign({ _key: k }, x) : null))
      .filter(x => x && x.sku && !x.mergedInto && obUC(x.sku) === obUC(want));
    if (!rows.length) continue;
    const rec = typeof mdbYnFix === 'function' ? mdbYnFix(rows[0]) : rows[0];
    if (!mdbOf(rec.sku)) {
      /* ONE ARRAY, TWO NAMES, as ensurePmdb and pmdbRefresh keep them. */
      const next = (PTG.mdb || []).concat([rec]);
      PTG.mdb = next; if (PT && PT.mdb) PT.mdb = next;
    }
    return mdbOf(rec.sku) || rec;
  }
  return null;
}

/* ---- the production registers, keyed by order and SKU ---- */
const obKeyOf = (orderNo, sku) => obUC(orderNo) + '|' + obUC(sku);

let CUT_IX = { src: null, n: -1, map: null };
function obCutIndex() {
  const rows = PT.cut || [];
  if (CUT_IX.src === rows && CUT_IX.n === rows.length) return CUT_IX.map;
  const m = new Map();
  rows.forEach(r => {
    if (!r) return;
    const k = obKeyOf(r.orderNo, r.sku);
    let e = m.get(k); if (!e) { e = { gross: 0, rej: 0 }; m.set(k, e); }
    e.gross += parseInt(r.pieces, 10) || 0;
    if (r.rejected === true) e.rej += parseInt(r.rejPieces, 10) || 0;
  });
  CUT_IX = { src: rows, n: rows.length, map: m };
  return m;
}

let PRESS_IX = { src: null, n: -1, map: null };
function obPressIndex() {
  const rows = PTG.press || [];
  if (PRESS_IX.src === rows && PRESS_IX.n === rows.length) return PRESS_IX.map;
  const m = new Map();
  rows.forEach(r => {
    if (!r) return;
    const k = obKeyOf(r.orderNo, r.sku);
    m.set(k, (m.get(k) || 0) + (parseInt(r.pieces, 10) || 0));
  });
  PRESS_IX = { src: rows, n: rows.length, map: m };
  return m;
}

/** Issued and received per order and SKU, out of Base Data. */
let BASE_IX = { src: null, n: -1, map: null };
function obBaseIndex() {
  const rows = PT.base || [];
  if (BASE_IX.src === rows && BASE_IX.n === rows.length) return BASE_IX.map;
  const m = new Map();
  rows.forEach(r => {
    if (!r) return;
    const k = obKeyOf(r.orderNo, r.sku);
    let e = m.get(k); if (!e) { e = { issued: 0, received: 0 }; m.set(k, e); }
    e.issued += ptNum(r.issuePieces);
    e.received += ptNum(r.receivedPieces);
  });
  BASE_IX = { src: rows, n: rows.length, map: m };
  return m;
}


/**
 * How many pieces one unit of an order-book line is.
 *
 * A Shopify line carries the customer's quantity — packs, sets — and the factory cuts, issues and
 * pays by the piece. Everything else in the book is already in pieces, so it is 1.
 */
const obIsShop = r => !!r && (String(r.src || '') === 'SHP' || obUC(r.orderNo).indexOf('SHP-') === 0);
let OB_PACK_IX = { src: null, n: -1, sib: null };
/**
 * ONE empty list, shared by every index below that caches on the identity of its source.
 *
 * A fresh `[]` each call is a fresh identity each call, so a cache guarded by `src === IX.src` can
 * never hit while the real list is still null — and it rebuilds instead, once per row. That is what
 * made the Order Console take a second and a half to redraw before Finished Goods had loaded.
 * Frozen, so nothing can push into the stand-in for "not read yet".
 */
const PT_NONE = Object.freeze([]);

function obPackSiblings() {
  const src = PTG.mdb || PT_NONE;
  if (OB_PACK_IX.sib && OB_PACK_IX.src === src && OB_PACK_IX.n === src.length) return OB_PACK_IX.sib;
  /* Same product letters, same last segment (the size) — the other colours of one product. */
  const votes = new Map();
  src.forEach(m => {
    const p = parseInt(String((m && m.packOf) || '').replace(/[^0-9]/g, ''), 10);
    const k = obPackFamily(m && m.sku);
    if (!k || !(p > 0)) return;
    /* And every pillow cover of that size, whoever makes it: a 12x20 or 14x36 is a single lumbar
     * cover in every brand, a 16x16 a pair. */
    const keys = [k].concat(obIsPillowSku(m.sku) ? ['PC|' + k.split('|')[1]] : []);
    keys.forEach(key => {
      const v = votes.get(key) || new Map();
      v.set(p, (v.get(p) || 0) + 1);
      votes.set(key, v);
    });
  });
  const sib = new Map();
  votes.forEach((v, k) => sib.set(k, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]));
  OB_PACK_IX = { src, n: src.length, sib };
  return sib;
}
/* RPC… and CPCC… are pillow covers; RCN…, RCCN… and CPCN… napkins; RTME… table mats. */
const obIsPillowSku = sku => /^(RPC|CPCC)/.test(obUC(sku));
function obPackFamily(sku) {
  const s = obUC(sku);
  const m = s.match(/^([A-Z]+)[^-]*-(.+)$/);
  return m ? m[1] + '|' + m[2].split('-').pop() : '';
}
function obPcsPerPack(sku, articleType, articleSubtype) {
  const s = obUC(sku);
  const m = mdbOf(s);
  const p = m ? parseInt(String(m.packOf || '').replace(/[^0-9]/g, ''), 10) : 0;
  if (p > 0) return p;
  const hay = [articleType, articleSubtype].join(' ');
  /* A SET WRITES ITS SIZE INTO THE SKU. RCNB374-12 is twelve napkins; RTME-147-8 eight mats. */
  if (/napkin|placemat|place mat|table ?mat/i.test(hay) || /^(RCN|RCCN|CPCN|RTME)/.test(s)) {
    const n = s.match(/-(\d{1,2})$/);
    if (n && +n[1] >= 1 && +n[1] <= 48) return +n[1];
  }
  const fam = obPackFamily(s);
  const sib = obPackSiblings().get(fam);
  if (sib > 0) return sib;
  const pillow = /pillow/i.test(hay) || obIsPillowSku(s);
  const sameSize = pillow && fam ? obPackSiblings().get('PC|' + fam.split('|')[1]) : 0;
  if (sameSize > 0) return sameSize;
  if (pillow) return 2;
  return 1;
}
/** An order-book row's quantity in PIECES. */
function obPieces(r) {
  const q = parseInt(r && r.qty, 10) || 0;
  if (!obIsShop(r)) return q;
  /* THE SYNC SAYS HOW MANY PIECES IT MEANT. Its quantity can be in Amazon packs (a set of 8 napkins
   * sent as 2 packs of 4), which no rule reading the SKU can know. */
  const pcs = parseInt(r.pcs, 10);
  if (pcs > 0) return pcs;
  return q * obPcsPerPack(r.sku, r.articleType, r.articleSubtype);
}
/** How many sets or packs the customer ordered on a Shopify row. */
function obShopUnits(r) {
  const s = parseInt(r && r.shopQty, 10);
  return s > 0 ? s : (parseInt(r && r.qty, 10) || 0);
}

/** Every order line the gate recognises. Only the uploaded Order Book exists in this data today —
 *  the CX production/adjustment nodes the old tool also reads have never been written. */
/* Rebuilt on every call before — 2,019 rows, and obOrderedQty called it once per order line. */
let OBL_IX = { src: null, n: -1, rows: null, byKey: null };
/**
 * What a SKU is — article, subtype, colour, size — from the MASTER, which is where it is kept right.
 * An order line carries a copy made the day the order was placed; a rename in the master since (Ruffle
 * Tablecloth → Ruffle Square Tablecloth, and 262 more) left those copies behind, and the Order Console
 * showed the old name beside the right SKU. The copy is used only for a SKU the master does not have.
 */
/**
 * WHAT "Fill from look-alikes" WOULD WRITE — only into empty boxes, never over a value somebody typed.
 *   custom  — pt_customSkus/<key>/{articleType, subtype, color, size}
 *   lines   — pt_vendorOrders/<vendor>/<order>/lines/<k>/{articleType, articleSubtype, color, size}: a printer reads
 *             only their own orders, never the master, so the line has to carry it
 * Each written line also gets lookalikeFrom, so where the words came from stays on record.
 */
function skuFillPlan(custom, orders) {
  const out = { custom: [], lines: [], noGuess: new Set() };
  const fill = (have, g, map) => { const w = {}; Object.keys(map).forEach(f => { const v = g[map[f]]; if (!String(have[f] == null ? '' : have[f]).trim() && v) w[f] = v; }); return w; };
  (custom || []).forEach(r => {
    if (!r || !r.sku || (r.articleType && r.color && r.size)) return;
    const g = skuLookalike(r.sku);
    if (!g) { out.noGuess.add(obUC(r.sku)); return; }
    const w = fill(r, g, { articleType: 'articleType', subtype: 'subtype', color: 'color', size: 'size' });
    if (Object.keys(w).length) out.custom.push({ key: r._key || obUC(r.sku), sku: obUC(r.sku), w, from: g.basis });
  });
  (orders || []).forEach(o => {
    if (!o || !o.vendorCode || !o.id || voRunning(o)) return;
    const raw = o.lines;
    const ents = Array.isArray(raw) ? raw.map((l, i) => [i, l]) : Object.entries(raw || {});
    ents.forEach(([k, l]) => {
      if (!l || !l.sku || l.kind === 'running' || (l.articleType && l.color && l.size)) return;
      /* In the master: its own words (a line placed before the SKU was added carries none). Else its look-alikes. */
      const m = mdbOf(l.sku);
      const g = m ? { articleType: m.articleType || '', subtype: m.subtype || '', color: m.color || '', size: m.size || '', basis: 'master database' } : skuLookalike(l.sku);
      if (!g) { out.noGuess.add(obUC(l.sku)); return; }
      const w = fill(l, g, { articleType: 'articleType', articleSubtype: 'subtype', color: 'color', size: 'size' });
      if (Object.keys(w).length) out.lines.push({ path: 'pt_vendorOrders/' + o.vendorCode + '/' + o.id + '/lines/' + k, o, l, sku: obUC(l.sku), w, from: g.basis });
    });
  });
  return out;
}
function skuFillPatch(plan) {
  const upd = {};
  plan.custom.forEach(x => Object.keys(x.w).forEach(f => { upd['pt_customSkus/' + x.key + '/' + f] = x.w[f]; }));
  plan.lines.forEach(x => { Object.keys(x.w).forEach(f => { upd[x.path + '/' + f] = x.w[f]; }); upd[x.path + '/lookalikeFrom'] = x.from; });
  return upd;
}
async function skuFillOpen() {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the Custom SKUs and the vendor orders…';
  try {
    if (!PTG.mdb) await ptLoadGates();
    MDBX.custom = ptList(await ptGet('pt_customSkus'));
    VO.rows = null; await ensureVo();
  } catch (e) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read them: ' + (e.message || e); return; }
  $('ptmMsg').textContent = '';
  const plan = skuFillPlan(MDBX.custom, VO.rows);
  const n = plan.custom.length + plan.lines.length;
  const row = (sku, w, from, where) => `<tr><td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(sku)}</td>`
    + `<td style="text-align:left">${esc([w.articleType, w.subtype || w.articleSubtype, w.color, w.size].filter(Boolean).join(' · '))}</td>`
    + `<td style="text-align:left" class="muted">${esc(where)}</td><td style="text-align:left;font-size:11.5px" class="muted">${esc(from)}</td></tr>`;
  const shown = plan.lines.slice(0, 150).map(x => row(x.sku, x.w, x.from, voName(x.o.vendorCode) + ' · ' + (x.o.orderNo || x.o.id)))
    .concat(plan.custom.slice(0, 150).map(x => row(x.sku, x.w, x.from, 'Custom SKUs list')));
  ptOpenDialog({
    title: n ? 'Fill these from their look-alikes?' : 'Nothing to fill',
    subtitle: `${nf(plan.lines.length)} vendor-order line(s) · ${nf(plan.custom.length)} Custom SKU(s)`
      + (plan.noGuess.size ? ` · ${nf(plan.noGuess.size)} SKU(s) look like nothing in the master and stay as they are` : ''),
    note: 'Only empty boxes are filled — a value somebody typed is never replaced. Article and size come from the same code in '
      + 'other colours, the colour from the same colour code in other sizes, and only where four in five of them agree. '
      + 'Printers then see the article, size and colour, and the line joins its colour group.',
    html: n ? `<div class="xlwrap" style="max-height:46vh;border:1px solid var(--line);border-radius:10px"><table class="xl" style="font-size:12.5px">
      <thead><tr><th style="text-align:left">SKU</th><th style="text-align:left">Filled with</th><th style="text-align:left">Where</th><th style="text-align:left">Read from</th></tr></thead>
      <tbody>${shown.join('')}</tbody></table></div>` + (n > shown.length ? `<div class="muted" style="margin-top:6px;font-size:12px">…and ${nf(n - shown.length)} more.</div>` : '') : '',
    fields: [],
    saveLabel: n ? 'Fill ' + nf(n) : '',
    onSave: n ? async () => {
      const upd = skuFillPatch(plan);
      try { await ptPatch(upd); } catch (e) { return 'Not written: ' + (e.message || e) + ' — nothing changed.'; }
      plan.custom.forEach(x => { const r = (MDBX.custom || []).find(c => c && (c._key || obUC(c.sku)) === x.key); if (r) Object.assign(r, x.w); });
      plan.lines.forEach(x => { Object.assign(x.l, x.w, { lookalikeFrom: x.from }); });
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `Filled ${nf(plan.lines.length)} vendor-order line(s) and ${nf(plan.custom.length)} Custom SKU(s) from their look-alikes.`;
      return '';
    } : null,
  });
}
if ($('ptmLookalike')) $('ptmLookalike').onclick = () => skuFillOpen();

