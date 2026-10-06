/* ================= TOP ASIN STATUS ================= */
// The SKUs that make up the top 60% of sales (revenue). Product columns auto-fetch from the loaded
// Replenishment rows; Production Status is editable (stored in repl/prodstatus — writable by canRepl);
// India Stock comes from a separate Firebase project (placeholder until its config is provided).
// PROD[sku] = [{d:"YYYY-MM-DD", note:"…"}, …] newest-first (log format, migrated from old string format)
let PROD = {}, REMARK = {}, DISC = {}, STATUS_OVR = {}, HIDDEN = {}, PRIO_OVR = {}, MOM = {};
let REQ_QTY = {};    // SKU → hand-typed units to send, overruling the projected requirement
let PROJ_OVR = {};   // "SKU|YYYY-MM" → manually-typed monthly projection (wins over the calculated one)
let PROD_LOADED = false, PROD_PROMISE = null;
const REPL_STOP_RE = /discontinu|use ?in ?mix/i;
const STATUS_OPTS = ['Listed', 'Need Listing', 'Discontinue', 'Use In Mix'];

function loadProd() {
  if (PROD_LOADED) return Promise.resolve();
  if (!PROD_PROMISE) PROD_PROMISE = fetchProd();
  return PROD_PROMISE;
}
async function fetchProd() {
  try {
    const d = await getDoc(doc(db, 'repl', 'prodstatus'));
    const x = d.exists() ? d.data() : {};
    // prodlog = new log format; map = old string format — migrate on load
    const raw = x.prodlog || {};
    const old = x.map || {};
    PROD = {};
    // Merge old string entries into log format (one-time migration, doesn't write back until next save)
    Object.keys(old).forEach(k => { if (!raw[k] && old[k]) raw[k] = [{ d: '—', note: old[k] }]; });
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      PROD[k] = Array.isArray(v) ? v : (v ? [{ d: '—', note: String(v) }] : []);
    });
    REMARK = x.remark || {}; DISC = x.disc || {}; STATUS_OVR = x.statusOverride || {};
    HIDDEN = x.hidden || {};
    PRIO_OVR = x.prioOverride || {};
    MOM = x.momlog || {};
    REQ_QTY = x.reqQty || {};
    // Projections live in their OWN doc so the rules can gate who may change them. Read that, layered
    // over the legacy prodstatus.projOverride field for anything written before the move.
    PROJ_OVR = x.projOverride || {};
    try {
      const pv = await getDoc(doc(db, 'repl', 'projoverride'));
      if (pv.exists()) PROJ_OVR = Object.assign({}, PROJ_OVR, pv.data().map || {});
    } catch (e) { /* no access / not created yet → the legacy field stands */ }
  } catch (e) { PROD = {}; REMARK = {}; DISC = {}; STATUS_OVR = {}; HIDDEN = {}; PRIO_OVR = {}; MOM = {}; PROJ_OVR = {}; REQ_QTY = {}; }
  PROD_LOADED = true;
}
// Latest prod note for a SKU (shown in cell)
const prodLatest = sku => { const log = PROD[String(sku).toUpperCase()] || []; return log.length ? log[0] : null; };
const isDisc = sku => !!DISC[String(sku).trim().toUpperCase()];
async function ensureTop() {
  if (!PROD_LOADED) { $('topMsg').textContent = 'Loading…'; await loadProd(); $('topMsg').textContent = ''; }
  if (!INDIA_LOADED) await loadIndiaStock();
  renderTop();
}

/*
 * INDIA STOCK = THIS APP'S FINISHED GOODS (2026-10-06, Ravi: "india stock ko apne app ke finish goods se dikhao sheet ka
 * data hata do"). The Ready Goods workbook is no longer read, nor the Firestore copy of it: one source, the same figure the
 * Finished Goods tab shows — what each SKU holds today (opening + received − issued − to FBA), in PIECES. Ravi chose the
 * switch with no opening entry from the sheet, so a SKU that was only on the sheet now reads 0.
 *
 * Counted in SELLABLE units for the screens, as before: pieces ÷ the pack (the master's packOf, else the app's own pack
 * rule, obPcsPerPack), rounded down. Pieces and the RECORDED pack ride along; nothing downstream has to know.
 * INDIA_STOCK is read by the forecast, the lane decision, Article Review, Create-PO and the Shopify India column.
 */
let INDIA_PROMISE = null;
function loadIndiaStock() {   // idempotent: shared promise, INDIA_LOADED set only AFTER the read
  if (INDIA_LOADED) return Promise.resolve();
  if (!INDIA_PROMISE) INDIA_PROMISE = fetchIndiaStock().finally(() => { INDIA_LOADED = true; });
  return INDIA_PROMISE;
}
let INDIA_META = {};                       // sku → [sellable, pieces, recorded pack, status]
/* ONE READ FOR THE SESSION — Replenishment and Shopify Orders ask for the same thing. A failure is not kept. */
let INDIA_LIVE = null;
const indiaLive = () => (INDIA_LIVE || (INDIA_LIVE = indiaFromFg().catch(e => { INDIA_LIVE = null; throw e; })));
/** The rows in the shapes the screens read them in. */
function indiaApply(rows, at, cached) {
  INDIA_ROWS = rows;
  INDIA_AT = at || null;
  INDIA_CACHED = !!cached;
  INDIA_META = {};
  rows.forEach(r => {
    const k = String(r && r.sku || '').trim().toUpperCase();
    if (k) INDIA_META[k] = [r.qty, r.pieces, r.pack, r.status];
  });
  buildIndiaMap();
}
async function fetchIndiaStock() {
  INDIA_STOCK = {}; INDIA_ROWS = []; INDIA_AT = null; INDIA_META = {}; INDIA_CACHED = false;
  try {
    const r = await indiaLive();
    const d = r.d || {};
    indiaApply(Object.keys(d).map(k => ({ sku: k, qty: d[k][0], pieces: d[k][1], pack: d[k][2], status: d[k][3] })), r.at || null, false);
  } catch (e) {
    // Left EMPTY, never zeroed — "could not read" and "there is nothing in India" are different answers, and the
    // second one starts production runs.
    INDIA_STOCK = {}; INDIA_ROWS = []; INDIA_META = {};
    rMsg('India stock could not be read from Finished Goods: ' + (e.message || e), true);
  }
}
function buildIndiaMap() {
  INDIA_STOCK = {};
  INDIA_ROWS.forEach(r => { const k = String(r.sku || '').trim().toUpperCase(); if (k) INDIA_STOCK[k] = Number(r.qty) || 0; });
}
async function saveIndiaStock(rows) {
  const chunks = Math.ceil(rows.length / INDIA_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) await setDoc(doc(db, 'repl_india', String(i)), { r: rows.slice(i * INDIA_CHUNK, (i + 1) * INDIA_CHUNK) });
  await setDoc(doc(db, 'repl', 'indiastock'), { chunks, n: rows.length, rows: null, by: ME.email, at: serverTimestamp() });
}
$('topBrand').addEventListener('change', renderTop);

// A ready-made Remark suggestion from the row's situation (used as the input's placeholder): what's
// already on the way (AWD transit / Rec.), or that fresh stock needs to be sent.
function suggestRemark(r) {
  const inf = r.inflow || {};
  if (inf.awd > 0) return `~${nf(inf.awd)} units in AWD transit, arriving in ~${inf.awdDay != null ? inf.awdDay : '?'} days`;
  if ((inf.fut || []).length) { const f = inf.fut[0]; return `${nf(f.q)} units arriving in ${f.l}`; }
  if (inf.m > 0) return `${nf(inf.m)} units being received into FBA this month`;
  const air = r.airReq || 0, sea = r.seaReq || 0;
  if (air || sea) return `No stock on the way — need to send${air ? ` ${nf(air)} by air` : ''}${air && sea ? ' +' : ''}${sea ? ` ${nf(sea)} by sea` : ''}`;
  return 'e.g. India stock reaches FBA in 10 days';
}

// The projected units to send, as ONE number plus the lane split behind it. The lanes are already
// net of everything on the way (see replReq), so adding them is the whole requirement, not a
// double-count. A stopped SKU asks for nothing.
function reqSuggest(r) {
  const q = replReq(r);
  const tot = (q.air || 0) + (q.sea || 0) + (q.awd || 0);
  const bits = [];
  if (q.air) bits.push(`${nf(q.air)} by air`);
  if (q.sea) bits.push(`${nf(q.sea)} by sea`);
  if (q.awd) bits.push(`${nf(q.awd)} to AWD`);
  return { tot, split: bits.join(' + ') };
}

function topAsinRows(brandPick) {
  const brands = (brandPick === 'ALL' ? ['SP', 'CPC'] : [brandPick]).filter(b => REPL[b]);
  const rows = brands.flatMap(b => (REPL[b].rows || []).map(r => ({ ...r, brand: b })));
  const ranked = rows.slice().sort((x, y) => (y.monthlyAmt || 0) - (x.monthlyAmt || 0));
  const total = ranked.reduce((s, r) => s + (r.monthlyAmt || 0), 0);
  const set = [];
  if (total > 0) { let cum = 0; for (const r of ranked) { set.push(r); cum += (r.monthlyAmt || 0); if (cum >= total * 0.6) break; } }
  return set;
}

// Which attention bucket a top-60% SKU falls in.
const topBucket = r => !(r.fulfillable > 0) ? 'out' : (r.coverDos != null && r.coverDos < 30) ? 'low' : 'ok';
let TOP_LAST = [];   // rows currently shown (for CSV export)

// Keep the Sub-Category / Color option lists in sync with the top-60% set; preserve the pick if valid.
function fillTopFilters(all) {
  [['topSubcat', 'subcat', 'All sub-categories'], ['topColor', 'color', 'All colors']].forEach(([id, key, allLbl]) => {
    const sel = $(id), cur = sel.value;
    const vals = [...new Set(all.map(r => (r[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">${allLbl}</option>` + vals.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
    if (cur && !vals.includes(cur)) sel.value = '';
  });
  // Production Status: the notes are free text, so the list is built from the LATEST note of each SKU,
  // plus two catch-all buckets for "has any note" / "nothing logged yet".
  const sel = $('topProd'), cur = sel.value;
  const notes = [...new Set(all.map(r => { const e = prodLatest(r.sku); return e ? String(e.note || '').trim() : ''; }).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All production status</option>'
    + '<option value="__any">✎ Has a note</option><option value="__none">— No note yet</option>'
    + notes.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = (cur === '__any' || cur === '__none' || notes.includes(cur)) ? cur : '';
}

function renderTop() {
  const b = $('topBrand').value;
  const loaded = ['SP', 'CPC'].some(x => REPL[x]);
  if (!loaded) {
    $('topKpis').innerHTML = '';
    $('topTable').innerHTML = `<tbody><tr><td class="muted" style="padding:14px">Open the Replenishment tab and hit “Refresh from sheet” first — this list is built from that data.</td></tr></tbody>`;
    return;
  }
  const all = topAsinRows(b);
  fillTopFilters(all);
  // Break-up is over the brand + sub-category + color view (not the "Show" bucket you drill into).
  const fSub = $('topSubcat').value, fColor = $('topColor').value, fProd = $('topProd').value;
  const prodMatch = r => {
    if (!fProd) return true;
    const e = prodLatest(r.sku), note = e ? String(e.note || '').trim() : '';
    if (fProd === '__any') return !!note;
    if (fProd === '__none') return !note;
    return note === fProd;
  };
  const base = all.filter(r => (!fSub || (r.subcat || '') === fSub) && (!fColor || (r.color || '') === fColor) && prodMatch(r));
  const out = base.filter(r => topBucket(r) === 'out').length;
  const low = base.filter(r => topBucket(r) === 'low').length;
  const ok = base.length - out - low, concerning = out + low;

  $('topKpis').innerHTML = `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname">Top 60% sellers — break-up</span><span class="kpiwhen">${nf(base.length)} SKUs make up the top 60% of revenue</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(out)}</div><div class="l">Out of stock (gone)</div></div>
      <div class="metric"><div class="v" style="color:#92400e">${nf(low)}</div><div class="l">Under 1 month — work on these</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(ok)}</div><div class="l">Healthy (≥1 month)</div></div>
      <div class="metric"><div class="v">${nf(concerning)}</div><div class="l">Need attention</div></div>
    </div></div>`;

  // The table shows the bucket picked in "Show" (default = anything needing attention).
  const show = $('topShow').value;
  const rows = base.filter(r => { const bk = topBucket(r);
    return show === 'all' ? true : show === 'attn' ? bk !== 'ok' : show === bk; });
  TOP_LAST = rows;

  const cols = [['Image', 'frz'], ['SKU', 'frz2'], ['ASIN', ''], ['Brand', ''], ['Sub-Category', ''], ['Color Name', ''], ['Size', ''], ['Fulfillable', 'num'], ['Cover (d)', 'num'], ['Remark', ''], ['Production Status', ''], ['India Stock', 'num']];
  const head = '<thead><tr>' + cols.map(([t, c]) => `<th${c ? ` class="${c}"` : ''}>${t}</th>`).join('') + '</tr></thead>';
  const indiaNum = sku => { const v = INDIA_STOCK[String(sku).toUpperCase()]; return typeof v === 'number' ? v : 0; };
  const totFul = rows.reduce((s, r) => s + (Number(r.fulfillable) || 0), 0);
  const totInd = rows.reduce((s, r) => s + indiaNum(r.sku), 0);
  const subRow = rows.length ? `<tr style="font-weight:700">
      <td class="frz" style="background:#eef2ff"></td><td class="frz2" style="background:#eef2ff">SUBTOTAL · ${nf(rows.length)}</td>
      <td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td>
      <td class="num" style="background:#eef2ff">${nf(totFul)}</td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td style="background:#eef2ff"></td><td class="num" style="background:#eef2ff">${nf(totInd)}</td></tr>` : '';
  const body = rows.map(r => {
    const iv = INDIA_STOCK[String(r.sku).toUpperCase()];
    return `<tr${isDisc(r.sku) ? ' style="opacity:.55"' : ''}>
      <td class="frz">${r.image ? `<img class="thumb" src="${esc(thumbUrl(r.image))}" loading="lazy" decoding="async">` : ''}</td>
      <td class="frz2">${esc(r.sku)}</td>
      <td style="font-family:ui-monospace,monospace">${esc(r.asin || '—')}</td>
      <td>${BRAND_NAME[r.brand] || r.brand || ''}</td>
      <td>${esc(r.subcat || '—')}</td>
      <td>${esc(r.color || '—')}</td>
      <td>${esc(r.size || '—')}</td>
      <td class="num">${nf(r.fulfillable || 0)}</td>
      <td class="num">${r.coverDos == null ? '<span class="muted">—</span>' : (r.coverDos < 30 ? `<span style="color:var(--bad);font-weight:700">${nf(r.coverDos)}</span>` : nf(r.coverDos))}</td>
      <td class="rmk-cell"><textarea class="rmkbox" data-sku="${esc(r.sku)}" rows="3" placeholder="${esc(suggestRemark(r))}">${esc(REMARK[r.sku] || '')}</textarea></td>
      <td class="prodlog-cell" data-sku="${esc(r.sku)}">${(() => { const e = prodLatest(r.sku); return e ? `<div class="prodlog-date">${esc(e.d)}</div><div class="prodlog-latest">${esc(e.note)}</div>` : '<span class="muted" style="font-size:12px">—</span>'; })()}<br><button class="prodlog-add" data-sku="${esc(r.sku)}">+ Log</button></td>
      <td class="num">${iv == null ? '<span class="muted">—</span>' : (typeof iv === 'number' ? nf(iv) : esc(String(iv)))}</td>
    </tr>`;
  }).join('');
  $('topTable').innerHTML = head + '<tbody>' + (subRow + body || `<tr><td colspan="12" class="muted">Nothing in this view. 🎉</td></tr>`) + '</tbody>';
  $('topMsg').textContent = `${nf(rows.length)} shown`;
  setTopFrz();
  requestAnimationFrame(setTopFrz);   // re-measure once layout settles (first paint can report 0)
}
// The 2nd frozen column (SKU) must sit exactly at the 1st frozen column (Image) width.
function setTopFrz() {
  const img = $('topTable').querySelector('thead th.frz');
  const w = img ? img.getBoundingClientRect().width : 0;
  if (!w) return;
  $('topTable').querySelectorAll('.frz2').forEach(el => { el.style.left = w + 'px'; });
}
['topSubcat', 'topColor', 'topShow', 'topProd'].forEach(id => $(id).addEventListener('change', renderTop));
$('topExport').onclick = () => {
  if (!TOP_LAST.length) return;
  const cols = ['SKU', 'ASIN', 'Brand', 'Sub-Category', 'Color', 'Size', 'Fulfillable', 'Cover (d)', 'Remark', 'Production Status', 'India Stock'];
  const lines = [cols.map(csvCell).join(',')];
  TOP_LAST.forEach(r => { const iv = INDIA_STOCK[String(r.sku).toUpperCase()];
    lines.push([r.sku, r.asin || '', BRAND_NAME[r.brand] || r.brand || '', r.subcat || '', r.color || '', r.size || '',
      // Export what the screen shows: the typed remark, or the auto-suggestion standing in for it.
      r.fulfillable || 0, r.coverDos == null ? '' : r.coverDos, REMARK[r.sku] || suggestRemark(r) || '',
      (PROD[String(r.sku).toUpperCase()] || []).map(e => `${e.d}: ${e.note}`).join(' | '),
      iv == null ? '' : iv].map(csvCell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `top-asin-status-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
};
// ── Remark: always-editable textarea, saved on blur/change (no re-render, so focus isn't lost) ──
$('topTable').addEventListener('change', async e => {
  const box = e.target.closest('.rmkbox'); if (!box) return;
  const sku = box.dataset.sku, val = box.value.trim().slice(0, 400);
  if (val) REMARK[sku] = val; else delete REMARK[sku];
  try { await setDoc(doc(db, 'repl', 'prodstatus'), { remark: { [sku]: val || null } }, { merge: true }); }
  catch (err) { $('topMsg').textContent = 'Save failed: ' + (err.message || err); }
});

// ── Production Status log modal ──
let PROD_MODAL_SKU = null;
function openProdModal(sku) {
  PROD_MODAL_SKU = String(sku).toUpperCase();
  $('prodModalSku').textContent = sku;
  $('prodLogInput').value = '';
  renderProdLog();
  $('prodModal').classList.remove('hide');
  $('prodLogInput').focus();
}
function renderProdLog() {
  const log = PROD[PROD_MODAL_SKU] || [];
  $('prodLogList').innerHTML = log.length
    ? log.map(e => `<div class="log-entry"><div class="ld">${esc(e.d)}</div>${esc(e.note)}</div>`).join('')
    : '<div class="muted" style="font-size:13px;padding:4px">No entries yet.</div>';
}
function closeProdModal() { $('prodModal').classList.add('hide'); PROD_MODAL_SKU = null; }
$('prodLogCancel').onclick = closeProdModal;
$('prodModal').addEventListener('click', e => { if (e.target === $('prodModal')) closeProdModal(); });
$('prodLogSave').onclick = async () => {
  const note = $('prodLogInput').value.trim().slice(0, 400); if (!note) return;
  const sku = PROD_MODAL_SKU;
  const today = new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD local
  const entry = { d: today, note };
  if (!PROD[sku]) PROD[sku] = [];
  PROD[sku].unshift(entry);   // newest first
  $('prodLogInput').value = '';
  renderProdLog();
  // Update the cell in the table without full re-render
  const cell = $('topTable').querySelector(`.prodlog-cell[data-sku="${CSS.escape(sku)}"]`);
  if (cell) cell.innerHTML = `<div class="prodlog-date">${esc(today)}</div><div class="prodlog-latest">${esc(note)}</div><br><button class="prodlog-add" data-sku="${esc(sku)}">+ Log</button>`;
  try { await setDoc(doc(db,'repl','prodstatus'), { prodlog: { [sku]: PROD[sku] } }, { merge: true }); }
  catch (err) { $('topMsg').textContent = 'Save failed: ' + (err.message || err); }
};
$('topTable').addEventListener('click', e => {
  const btn = e.target.closest('.prodlog-add'); if (!btn) return;
  openProdModal(btn.dataset.sku);
});

