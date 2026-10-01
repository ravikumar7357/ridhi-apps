/* ==== LOOK-ALIKE SKUs (Ravi, 2026-09-28) ====
 * A SKU the master does not hold is read from the ones it does. A code is letters + colour code + the rest:
 * RTC150-60120 is RTC + 150 + -60120.
 *   article · subtype · size  ← master SKUs of the same letters and the same rest, any colour (RTC23-60120 …);
 *                               failing that, the same letters alone (every RCNB napkin is a 20x20 Border Napkin)
 *   colour                    ← master SKUs of the same letters and the same colour code (RTC150-60102 …);
 *                               failing that, the same colour code under any letters of the same family
 * A value is taken only when at least four in five of the SKUs asked agree, so a code two colours share gives no
 * colour rather than a wrong one. Custom SKUs never vote. */
const skuParts = s => { const m = obUC(s).match(/^([A-Z]+)(\d+)(.*)$/); return m ? { pre: m[1], code: m[2], rest: m[3] } : null; };
let SKU_LA_IX = { src: null, n: -1, ix: null };
function skuLaIndex() {
  const src = PTG.mdb || PT_NONE;
  if (SKU_LA_IX.ix && SKU_LA_IX.src === src && SKU_LA_IX.n === src.length) return SKU_LA_IX.ix;
  const ix = { shape: new Map(), pre: new Map(), preCode: new Map(), code: new Map() };
  const add = (map, k, v, sku) => {
    if (!v) return;
    let t = map.get(k); if (!t) map.set(k, t = new Map());
    const e = t.get(v) || { n: 0, eg: sku }; e.n++; t.set(v, e);
  };
  src.forEach(r => {
    if (!r || !r.sku || r.isCustom) return;
    const p = skuParts(r.sku); if (!p) return;
    const art = [r.articleType, r.subtype, r.size].map(x => String(x == null ? '' : x).trim());
    if (art[0] && art[2]) { add(ix.shape, p.pre + '#' + p.rest, JSON.stringify(art), obUC(r.sku)); add(ix.pre, p.pre, JSON.stringify(art), obUC(r.sku)); }
    const col = String(r.color || '').trim();
    add(ix.preCode, p.pre + '#' + p.code, col, obUC(r.sku));
    add(ix.code, p.pre[0] + '#' + p.code, col, obUC(r.sku));
  });
  SKU_LA_IX = { src, n: src.length, ix };
  return ix;
}
function skuLaWin(t) {
  if (!t || !t.size) return null;
  let tot = 0, best = null;
  t.forEach((e, v) => { tot += e.n; if (!best || e.n > best.e.n) best = { v, e }; });
  return best.e.n / tot >= 0.8 ? { v: best.v, eg: best.e.eg } : null;
}
/** { articleType, subtype, color, size, basis: 'RTC23-60120, RTC150-60102' } — blanks where nothing agrees; null when
 * nothing in the master looks like it. */
function skuLookalike(sku) {
  const p = skuParts(sku);
  if (!p) return null;
  const ix = skuLaIndex(), out = { articleType: '', subtype: '', color: '', size: '', basis: '' }, eg = [];
  const a = skuLaWin(ix.shape.get(p.pre + '#' + p.rest)) || skuLaWin(ix.pre.get(p.pre));
  if (a) { const v = JSON.parse(a.v); out.articleType = v[0]; out.subtype = v[1]; out.size = v[2]; eg.push(a.eg); }
  const c = skuLaWin(ix.preCode.get(p.pre + '#' + p.code)) || skuLaWin(ix.code.get(p.pre[0] + '#' + p.code));
  if (c) { out.color = c.v; if (eg.indexOf(c.eg) < 0) eg.push(c.eg); }
  out.basis = eg.join(', ');
  return eg.length ? out : null;
}

function obWhat(r) {
  const m = typeof mdbOf === 'function' ? mdbOf(r && r.sku) : null;
  const pick = (a, b) => (String(a == null ? '' : a).trim() ? String(a).trim() : (b || ''));
  if (m) return { articleType: pick(m.articleType, r.articleType), articleSubtype: pick(m.subtype, r.articleSubtype),
    color: pick(m.color, r.color), size: pick(m.size, r.size) };
  /* Not in the master: what the row carries, and its look-alikes for whatever it does not. */
  const g = (!r.articleType || !r.color || !r.size) ? skuLookalike(r && r.sku) : null;
  return { articleType: r.articleType || (g && g.articleType) || '', articleSubtype: r.articleSubtype || (g && g.subtype) || '',
    color: r.color || (g && g.color) || '', size: r.size || (g && g.size) || '' };
}

function obLines() {
  const src = PTG.ob || PT_NONE;
  /* The pack size comes from the master, so a master that has only just loaded rebuilds this. */
  const mdbSrc = PTG.mdb || [];
  if (OBL_IX.rows && OBL_IX.src === src && OBL_IX.n === src.length
      && OBL_IX.mdb === mdbSrc && OBL_IX.mdbN === mdbSrc.length) return OBL_IX.rows;
  const rows = src.filter(Boolean).map(r => Object.assign({
    orderNo: obUC(r.orderNo), sku: obUC(r.sku), qty: obPieces(r), date: r.orderDate || '',
  }, obWhat(r)));
  const byKey = new Map();
  rows.forEach(l => { const k = l.orderNo + '|' + l.sku; byKey.set(k, (byKey.get(k) || 0) + l.qty); });
  OBL_IX = { src, n: src.length, rows, byKey, mdb: mdbSrc, mdbN: mdbSrc.length };
  return rows;
}
/** How many of a SKU an order asks for. Was a rebuild-and-filter of the whole order book. */
function obOrderedIndex() { obLines(); return OBL_IX.byKey; }

const obOrderedQty = (orderNo, sku) => obOrderedIndex().get(obKeyOf(orderNo, sku)) || 0;

/** NET good cut against an order line: cut minus anything rejected after cutting. */
function obCutQty(orderNo, sku, exclId) {
  /* The ordinary case — no row being excluded — is answered from the index. The excluding case
   * keeps the original walk: it is used once, while editing one row, and is not worth an index
   * that would have to know about it. */
  if (!exclId) {
    const e = obCutIndex().get(obKeyOf(orderNo, sku));
    return e ? Math.max(0, e.gross - e.rej) : 0;
  }
  const o = obUC(orderNo), s = obUC(sku);
  let gross = 0, rej = 0;
  (PT.cut || []).forEach(r => {
    if (!r || obUC(r.orderNo) !== o || obUC(r.sku) !== s) return;
    if (exclId && r.id === exclId) return;      // the row being edited does not count against itself
    gross += parseInt(r.pieces, 10) || 0;
    if (r.rejected === true) rej += parseInt(r.rejPieces, 10) || 0;
  });
  return Math.max(0, gross - rej);
}

/** The tool's own guard, for kind 'cut'. Same numbers, same wording. */
function cutGuard(orderNo, sku, qty, exclId, allowExtra) {
  const ordered = obOrderedQty(orderNo, sku);
  if (!ordered) return `Order ${orderNo} has no line for SKU ${obUC(sku)} — pick the correct Order ID.`;
  /* Extra, with a reason recorded on the row: the ordered cap is the thing being knowingly passed. */
  if (allowExtra) return '';
  const used = obCutQty(orderNo, sku, exclId);
  const want = parseInt(qty, 10) || 0;
  if (used + want > ordered)
    return `Order ${orderNo} · ${obUC(sku)}: ordered ${ordered} pcs, already cut ${used} pcs — `
      + `at most ${ordered - used} more allowed. Entry blocked.`;
  return '';
}

const ptMonthKey = v => {
  const ms = ptDtMs(v); if (!ms) return '';
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
const cutMonthFrozen = v => !!(PTG.freeze && PTG.freeze[ptMonthKey(v)]);

/** Article / subtype / colour / size must be known — to the attribute masters OR to the master
 *  database itself, which is the real source of truth. Skipped for a master that holds nothing,
 *  exactly as the old tool skips it, so an unconfigured master cannot block the floor. */
function validateAgainstMasters(at, sub, col, sz) {
  const errors = [];
  const ci = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const m = PTG.masters || {};
  const listOf = k => ptList(m[k]);
  const inMaster = (list, val) => list.find(x => ci(x.code, val) || ci(x.desc, val));
  const mdb = PTG.mdb || [];
  const inDB = (field, val) => mdb.some(r => ci(r[field], val));
  const check = (masterKey, field, val, label) => {
    const list = listOf(masterKey);
    if (list.length && val && !inMaster(list, val) && !inDB(field, val))
      errors.push(`${label} "${val}" is not in the masters`);
  };
  check('articleType', 'articleType', at, 'Article type');
  check('articleSubtype', 'subtype', sub, 'Article subtype');
  check('colour', 'color', col, 'Colour');
  check('size', 'size', sz, 'Size');
  return errors;
}

/* ---- the form ---- */

function cutFormMsg(t, bad) { const m = $('cwMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/* A SKU ON THE CUSTOM SKUs LIST counts for the entry forms too (Ravi, 2026-09-30) — a B2B item is put there when its
 * order is saved and is not in the master. What the list leaves blank (a wholesale file often has no article type) is
 * read from the master SKUs it looks like. The record says _custom, so the forms skip the master-list checks for it. */
let CUST_IX = { src: null, map: null };
function ptCustomOf(sku) {
  const list = (typeof MDBX !== 'undefined' && MDBX.custom) || (typeof PTE !== 'undefined' && PTE.custom) || null;
  if (!list || !sku) return null;
  if (CUST_IX.src !== list || !CUST_IX.map) CUST_IX = { src: list, map: new Map(list.filter(r => r && r.sku).map(r => [obUC(r.sku), r])) };
  const r = CUST_IX.map.get(obUC(sku));
  if (!r) return null;
  const g = (!r.articleType || !r.subtype || !r.color) && typeof skuLookalike === 'function' ? skuLookalike(sku) : null;
  /* The look-alikes agree on a whole article-and-size; a B2B size ("40*40 cm") often matches none, so the article and
   * subtype alone are also read from the master SKUs with the same letters in front (RPCRU → Ruffle Pillow Cover). */
  const pa = (!r.articleType || !r.subtype) && !(g && g.articleType) ? ptCustomPrefixArt(sku) : null;
  const pick = (a, b) => String(a == null ? '' : a).trim() || (b || '');
  return Object.assign({}, r, { _custom: true,
    articleType: pick(r.articleType, (g && g.articleType) || (pa && pa.articleType)), subtype: pick(r.subtype, (g && g.subtype) || (pa && pa.subtype)),
    color: pick(r.color, g && g.color), size: pick(r.size, g && g.size) });
}
/** { articleType, subtype } that 80% or more of the master SKUs with the same letters in front agree on, else null. */
let CUST_PRE = { src: null, map: null };
function ptCustomPrefixArt(sku) {
  const src = PTG.mdb || PT_NONE;
  const preOf = x => (String(x || '').toUpperCase().match(/^[A-Z]+/) || [''])[0];
  if (CUST_PRE.src !== src || !CUST_PRE.map) {
    const map = new Map();
    src.forEach(m => { if (!m || !m.sku || !m.articleType) return; const k = preOf(m.sku); if (!k) return;
      const t = map.get(k) || new Map(), v = m.articleType + '|' + (m.subtype || ''); t.set(v, (t.get(v) || 0) + 1); map.set(k, t); });
    CUST_PRE = { src, map };
  }
  const t = CUST_PRE.map.get(preOf(sku));
  if (!t) return null;
  let tot = 0, best = null;
  t.forEach((n, v) => { tot += n; if (!best || n > best[1]) best = [v, n]; });
  if (!best || best[1] / tot < 0.8) return null;
  const [articleType, subtype] = best[0].split('|');
  return { articleType, subtype };
}
/** Read the Custom SKUs list once, for the entry forms. */
async function ptEnsureCustom() {
  if (MDBX.custom !== null) return;
  try { MDBX.custom = ptList(await ptGet('pt_customSkus')); } catch (e) { /* the master alone, as before */ }
}
const cutSkuOf = sku => mdbOf(sku) || ptCustomOf(sku) || null;

/** Orders that actually have a line for this SKU, with what is left on each. */
function cutOrdersFor(sku) {
  if (!sku) return [];
  const seen = new Set();
  return obLines().filter(l => l.sku === obUC(sku)).filter(l => {
    if (seen.has(l.orderNo)) return false; seen.add(l.orderNo); return true;
  }).map(l => {
    const ordered = obOrderedQty(l.orderNo, sku), used = obCutQty(l.orderNo, sku);
    return { orderNo: l.orderNo, ordered, used, left: Math.max(0, ordered - used), date: l.date };
  }).sort((a, b) => (b.left - a.left) || a.orderNo.localeCompare(b.orderNo));
}

/**
 * The orders a SKU is on, for the QC form — the ones with pieces back and not yet checked FIRST, because
 * that is the order the inspector is holding. Received comes from the Job Work Register.
 */
function qcOrdersFor(sku) {
  return cutOrdersFor(sku).map(o => { const b = obBaseIndex().get(obKeyOf(o.orderNo, sku));
    return Object.assign({}, o, { received: b ? b.received : 0 }); })
    .sort((a, b) => (b.received - a.received) || a.orderNo.localeCompare(b.orderNo));
}

/** What may be picked for cutting: master rows whose SKU is on at least one order. */
let CUT_PICK_IX = { ob: null, n: -1, mdb: null, m: -1, rows: null };
function cutPickScope() {
  const ob = PTG.ob || [], mdb = PTG.mdb || [];
  if (CUT_PICK_IX.rows && CUT_PICK_IX.ob === ob && CUT_PICK_IX.n === ob.length
      && CUT_PICK_IX.mdb === mdb && CUT_PICK_IX.m === mdb.length) return CUT_PICK_IX.rows;
  const onBook = new Set(obLines().map(l => l.sku));
  const rows = mdb.filter(r => r && r.sku && onBook.has(obUC(r.sku)));
  CUT_PICK_IX = { ob, n: ob.length, mdb, m: mdb.length, rows };
  return rows;
}

/**
 * Article → subtype → colour → size, each list narrowed by the ones before it, and the SKU they land
 * on. A SKU somebody typed is left alone.
 */
function renderCutPick() {
  const scope = cutPickScope();
  const same = (a, b) => ptNorm(a) === ptNorm(b);
  /* A box with exactly one possible answer, once the box before it is chosen, is chosen for them. */
  const fill = (id, rows, field, label, parentChosen) => {
    bdFill(id, rows.map(r => r[field]), label);
    const opts = [...new Set(rows.map(r => String(r[field] == null ? '' : r[field]).trim()).filter(Boolean))];
    if (!$(id).value && parentChosen && opts.length === 1) $(id).value = opts[0];
    return $(id).value;
  };
  const at = fill('cwAt', scope, 'articleType', '-- Article type --', false);
  const r1 = scope.filter(r => !at || same(r.articleType, at));
  const sb = fill('cwSub', r1, 'subtype', '-- Subtype --', !!at);
  const r2 = r1.filter(r => !sb || same(r.subtype, sb));
  const col = fill('cwCol', r2, 'color', '-- Colour --', !!sb);
  const r3 = r2.filter(r => !col || same(r.color, col));
  const sz = fill('cwSz', r3, 'size', '-- Size --', !!col);

  if (!$('cwSku').dataset.typed) {
    const hit = (at && sb && col && sz) ? r3.filter(r => same(r.size, sz)) : [];
    $('cwSku').value = hit.length === 1 ? hit[0].sku : '';
    $('cwSkuNote').textContent = hit.length > 1
      ? `${hit.length} SKUs share this description (${hit.slice(0, 4).map(r => r.sku).join(', ')}${hit.length > 4 ? '…' : ''}) — type the SKU directly.`
      : '';
  } else {
    $('cwSkuNote').textContent = '';
  }
}

/** A SKU typed by hand wins, and fills the four boxes backwards from the master row. */
function cutSkuTyped() {
  const sku = $('cwSku').value.trim();
  $('cwSku').dataset.typed = sku ? '1' : '';
  const m = cutSkuOf(sku);
  if (m) {
    $('cwAt').value = m.articleType || '';
    renderCutPick();
    $('cwSub').value = m.subtype || ''; renderCutPick();
    $('cwCol').value = m.color || ''; renderCutPick();
    $('cwSz').value = m.size || ''; renderCutPick();
  }
}

function renderCutForm() {
  const skuBox = $('cwSku');
  const sku = skuBox.value.trim();
  const m = cutSkuOf(sku);

  $('cwWho').textContent = m
    ? `${m.articleType || '—'} · ${m.subtype || '—'} · ${m.color || '—'} · ${m.size || '—'}`
      + (m.brand ? '  ·  ' + m.brand : '')
    : (sku ? 'Not in the master database.' : '');
  $('cwWho').className = m ? 'muted' : (sku ? 'err' : 'muted');

  const orders = m ? cutOrdersFor(sku) : [];
  const cur = $('cwOrd').value;
  $('cwOrd').innerHTML = '<option value="">Select an Order ID…</option>'
    + orders.map(o => `<option value="${esc(o.orderNo)}">${esc(o.orderNo)} — ${nf(o.left)} of ${nf(o.ordered)} left</option>`).join('');
  $('cwOrd').value = cur;
  if ($('cwOrd').value !== cur) $('cwOrd').value = '';

  const o = orders.find(x => x.orderNo === $('cwOrd').value);
  $('cwLeft').textContent = o
    ? `${nf(o.left)} piece(s) may still be cut on this order — ${nf(o.ordered)} ordered, ${nf(o.used)} already cut.`
    : (m && !orders.length ? 'No order in the Order Book carries this SKU, so nothing may be cut against it.' : '');
  $('cwLeft').className = (o && o.left <= 0) ? 'err' : 'muted';
  renderCutFab();
}

/**
 * The fabrics a cutting entry may name: the Fabric Type master, active entries only, by description.
 *
 * Exactly the production tracker's rule — description before code, duplicates that differ only in
 * case folded into the first spelling seen — so the two lists never disagree about what a fabric is
 * called.
 */
function cutFabrics() {
  const seen = new Set(), out = [];
  ptList((PTG.masters || {}).fabricType).forEach(f => {
    if (!f || f.active === false) return;
    const name = String(f.desc || f.code || '').trim();
    const k = name.toLowerCase();
    if (!name || seen.has(k)) return;
    seen.add(k); out.push(name);
  });
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Fill the dropdown, keeping whatever was already chosen. */
function cutFillFabrics() {
  const el = $('cwFabric'); if (!el) return;
  const keep = el.value;
  const list = cutFabrics();
  el.innerHTML = '<option value="">— Fabric —</option>'
    + list.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  el.value = list.indexOf(keep) >= 0 ? keep : '';
}

async function ensureCutForm() {
  if (!PTG.mdb) { cutFormMsg('Reading the master database and the order book…'); await ptLoadGates(); }
  await ptEnsureCustom();
  if (PTG.err) { cutFormMsg('Could not read what the checks need: ' + PTG.err, true); return; }
  cutFormMsg('');
  cutFillFabrics();
  // Datalist of every SKU, so the box completes instead of demanding a perfect memory.
  $('cwSkuList').innerHTML = (PTG.mdb || []).slice(0, 6000)
    .map(r => `<option value="${esc(r.sku)}">`).join('');
  if (!$('cwDate').value) $('cwDate').value = dToday();
  renderCutPick();
  renderCutForm();
}

$('cwToggle').onclick = async () => {
  const box = $('cwBox');
  const open = box.classList.contains('hide');
  box.classList.toggle('hide', !open);
  $('cwToggle').textContent = open ? 'Close' : '+ New cutting entry';
  if (open) await ensureCutForm();
};

$('cwSku').addEventListener('input', cutSkuTyped);
['cwSku', 'cwOrd'].forEach(id => $(id).addEventListener('input', renderCutForm));
/* Changing the item means a typed SKU no longer stands; each box clears the ones after it. */
[['cwAt', ['cwSub', 'cwCol', 'cwSz']], ['cwSub', ['cwCol', 'cwSz']], ['cwCol', ['cwSz']], ['cwSz', []]].forEach(([id, after]) => {
  $(id).addEventListener('change', () => {
    $('cwSku').dataset.typed = '';
    after.forEach(x => { $(x).value = ''; });
    renderCutPick();
    renderCutForm();
  });
});
$('cwOrd').addEventListener('change', renderCutForm);

$('cwSave').onclick = async () => {
  const sku = $('cwSku').value.trim();
  const m = cutSkuOf(sku);
  const orderNo = $('cwOrd').value.trim();
  const pcs = parseInt($('cwPcs').value, 10);
  const fabric = $('cwFabric').value.trim();
  const date = $('cwDate').value;

  /* Every refusal names the number that caused it. "Invalid entry" tells the floor nothing. */
  if (!m) return cutFormMsg(sku ? `SKU ${sku} is not in the master database.`
    : ($('cwSkuNote').textContent ? 'That item fits more than one SKU — type the SKU.' : 'Pick the article, subtype, colour and size — or type the SKU.'), true);
  if (!pcs || pcs < 1) return cutFormMsg('Enter how many pieces were cut.', true);
  if (!fabric) return cutFormMsg('Pick the fabric.', true);
  /* From the master and nowhere else — a spelling the master does not have is a new fabric nobody
   * has agreed exists. */
  if (cutFabrics().indexOf(fabric) < 0)
    return cutFormMsg(`"${fabric}" is not in the Fabric Type master. Add it there first.`, true);
  if (!date) return cutFormMsg('Enter the cutting date.', true);

  const at = m.articleType || '', sub = m.subtype || '', col = m.color || '', sz = m.size || '';
  const mErr = m._custom ? [] : validateAgainstMasters(at, sub, col, sz);
  if (mErr.length) return cutFormMsg(mErr[0], true);

  if (!orderNo) return cutFormMsg('Select an Order ID — every cutting entry is recorded against an order.', true);
  const gErr = cutGuard(orderNo, sku, pcs);
  if (gErr) return cutFormMsg(gErr, true);

  if (cutMonthFrozen(date)) return cutFormMsg(`${ptMonthKey(date)} is frozen — cutting entries for that month are locked.`, true);

  const entry = {
    id: 'cut_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    sku: obUC(sku),
    articleType: at, articleSubtype: sub, color: col, size: sz,
    pieces: pcs,
    cutDate: ptStampDate(date),
    fabricWidth: fabric,
    ...cutFabFields(),
    orderNo,
    remarks: $('cwRemarks').value.trim(),
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };

  $('cwSave').disabled = true;
  cutFormMsg('Saving…');
  try {
    await ptPut('pt_cuttingData/' + entry.id, entry);
    PT.cut = (PT.cut || []).concat(Object.assign({ _key: entry.id }, entry));
    renderPcut();
    ['cwSku', 'cwPcs', 'cwFabric', 'cwRemarks', 'cwAt', 'cwSub', 'cwCol', 'cwSz', 'cwUsed', 'cwWaste', 'cwWasteW'].forEach(id => { $(id).value = ''; });
    $('cwSku').dataset.typed = '';
    $('cwUsed').dataset.typed = '';
    $('cwOrd').value = '';
    renderCutPick();
    renderCutForm();
    cutFormMsg(`Saved — ${nf(pcs)} piece(s) of ${obUC(sku)} against ${orderNo}.`);
  } catch (e) {
    cutFormMsg('Not saved: ' + (e.message || e), true);
  }
  $('cwSave').disabled = false;
};

/**
 * THE CLOTH THIS CUT COST, as fields on the entry — only where somebody typed a figure.
 *
 * A box left empty adds no field at all. A missing measurement and a measured nought are different
 * facts, and writing the first as the second would quietly pull every waste average towards zero on
 * the strength of entries nobody measured.
 */
function cutFabFields() {
  const out = {};
  [['cwUsed', 'fabricUsed'], ['cwWaste', 'fabricWaste'], ['cwWasteW', 'fabricWasteWidth']].forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    const txt = String(el.value == null ? '' : el.value).trim();
    if (txt === '') return;
    const n = mdbNum(txt);
    /* Number.isFinite, not isFinite: the bare one coerces, and isFinite(null) is true, so "abc" —
     * which mdbNum answers as null — was being written as a null metre reading. */
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  });
  return out;
}

/**
 * What this cut should take, and what has been typed against it.
 *
 * The worked-out figure comes from the same calculator the Master Database uses — size plus two
 * inches, laid on the roll that wastes least — so a cutting entry and the master row can never
 * disagree about what a piece costs.
 */
function cutFabPlan() {
  const sku = ($('cwSku').value || '').trim();
  const pcs = parseInt($('cwPcs').value, 10) || 0;
  const m = cutSkuOf(sku);
  if (!m || pcs <= 0) return null;
  const p = ptConsPlan(m);
  if (p.why) return { why: p.why, pcs };
  return { pcs, plan: p, should: Math.round(p.metres * pcs * 100) / 100 };
}

/**
 * Fill the used box and say what the figures mean. Cheap: it runs on every keystroke in the pieces
 * box, so it must not rebuild the form.
 */
function renderCutFab() {
  const el = $('cwFab');
  if (!el) return;
  const f = cutFabPlan();
  if (!f) { el.classList.add('hide'); el.textContent = ''; return; }
  el.classList.remove('hide');
  if (f.why) {
    $('cwUsed').placeholder = 'Fabric used (m)';
    el.className = 'muted';
    el.textContent = 'The cloth for this cut cannot be worked out — ' + f.why + '. Type what was used.';
    return;
  }
  /* Filled in, until somebody types over it. */
  if (!$('cwUsed').dataset.typed) $('cwUsed').value = f.should;
  const used = parseFloat($('cwUsed').value);
  const waste = parseFloat($('cwWaste').value);
  const p = f.plan;
  const bits = [`Worked out: ${nf(f.pcs)} × ${p.metres} m = ${nf(f.should)} m of ${p.fabric}`
    + ` (${p.across} across, ${Math.round(p.waste * 100)}% lost across the roll${p.panels > 1 ? `, ×${p.panels} panels` : ''})`];
  if (isFinite(used) && Math.abs(used - f.should) > 0.005) {
    const d = Math.round((used - f.should) * 100) / 100;
    bits.push(`typed ${nf(used)} m — ${d > 0 ? nf(d) + ' m MORE' : nf(-d) + ' m less'} than worked out`);
  }
  if (isFinite(waste) && waste > 0 && isFinite(used) && used > 0) {
    const ww = parseFloat(($('cwWasteW') || {}).value);
    bits.push(`waste ${nf(waste)} m${isFinite(ww) && ww > 0 ? ' × ' + nf(ww) + '"' : ''} = ${((waste / used) * 100).toFixed(1)}% of what went in`);
  }
  el.className = (isFinite(used) && used > f.should * 1.15) ? 'err' : 'muted';
  el.textContent = bits.join('  ·  ');
}

/* The old tool writes the date as "26/08/2026, 15:20" — day first, with the time of the entry. Every
 * reader in both tools parses that shape, so a new entry has to be written in it and not in the
 * date input's own YYYY-MM-DD. */
function ptStampDate(yyyymmdd) {
  const [y, mo, d] = String(yyyymmdd).split('-').map(Number);
  const now = new Date();
  const dt = new Date(y, (mo || 1) - 1, d || 1, now.getHours(), now.getMinutes());
  const p = n => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}, ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

