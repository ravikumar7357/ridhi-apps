/* ================= REPLENISHMENT ================= */
function rMsg(t, bad) { const m = $('rMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

// Rows are stored across CHUNK docs, not one document. Ridhi alone is 3,000+ SKUs and, with the
// long Amazon image URLs, a single doc blew past Firestore's 1 MB limit. Each chunk holds 700 rows
// (~250 KB), and repl/{brand} keeps only the metadata + chunk count.
const REPL_CHUNK = 700;
// Both brands are fetched TOGETHER. Sequentially it was meta(SP) → chunks(SP) → meta(CPC) → chunks(CPC)
// = four round-trips to Firestore before the first paint; in parallel it is two. Nothing here reads what
// the other brand wrote (REPL[b] and the ACCESS_ERR `||` guard are both per-brand), so order is free.
/* ================= WHO SEES THE FULL SNAPSHOT =================
 *
 * Ravi, 2026-09-21: the full Replenishment data — sales, revenue, reorder advice, 43 columns a SKU —
 * was readable by every account holding ANY planning or Shopify screen, because those screens are
 * built on it. The screens that only need to know what a SKU is and how much FBA holds now read a
 * SLIM copy (8 columns) written beside the full one; the full one is for admins and the planning
 * screens. The database rules say the same (firestore.rules → canReplFull), so the app is not the
 * only thing standing in the way.
 */
const REPL_FULL_TABS = ['repl', 'article', 'target', 'top', 'prod', 'follow', 'india'];
/* What the production screens read from a row: what a SKU is, what FBA holds, what it sold (Printer Allocation), and its
 * Amazon ids (Master DB). The full copy is 45 fields and six times the bytes; nothing outside Replenishment needs it. */
const REPL_SLIM_FIELDS = ['sku', 'category', 'subcat', 'color', 'size', 'totalStock', 'awdAvail', 'awdTransit', 'last90', 'last30', 'asin', 'parent'];
const REPL_SLIM_CHUNK = 2500;
const replFull = () => !!(ME.admin || (ME.tabs || []).some(t => REPL_FULL_TABS.includes(t)));
const replSlimRow = r => { const o = {}; REPL_SLIM_FIELDS.forEach(k => { if (r && r[k] != null) o[k] = r[k]; }); return o; };

/* WHICH COPY IS IN HAND: '' (none), 'slim' or 'full'. The slim one is read at sign-in by everybody; the full one — 8 MB
 * against 1.4 (26 Sep) — only when a Replenishment screen opens, and only for an account that may see it. A second call
 * for the same or a lesser copy costs nothing; a call in flight is shared. */
let REPL_MODE = '', REPL_LOADING = null;
async function loadReplCache(wantFull) {
  const full = !!wantFull && replFull();
  if (REPL_MODE === 'full' || (REPL_MODE === 'slim' && !full)) return;
  if (REPL_LOADING && (REPL_LOADING.full || !full)) return REPL_LOADING.p;
  /* A SLIM READ STILL IN FLIGHT FINISHES FIRST. Starting the full read beside it let the slim rows land last and
   * overwrite the full ones (Ravi, 2026-09-26: "replenish tab ka sara data kharab ho gya — image bhi nahi, status
   * bhi nahi") — the table then drew a snapshot with no image, status or warehouse figures. */
  if (REPL_LOADING) { try { await REPL_LOADING.p; } catch (e) { /* the full read below stands on its own */ } }
  if (REPL_MODE === 'full') return;
  const p = loadReplCacheRun(full).then(() => { REPL_MODE = full ? 'full' : 'slim'; }).finally(() => { if (REPL_LOADING && REPL_LOADING.p === p) REPL_LOADING = null; });
  REPL_LOADING = { full, p };
  return p;
}
async function loadReplCacheRun(full) {
  await Promise.all(['SP', 'CPC'].map(async b => {
    try {
      const meta = await getDoc(doc(db, full ? 'repl' : 'replslim', b));
      if (!meta.exists()) return;
      const d = meta.data();
      let rows = [];
      if (d.chunks) {
        const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, full ? 'replrows' : 'replslimrows', `${b}_${i}`))));
        got.forEach(s => { if (s.exists()) rows = rows.concat(s.data().r || []); });
      } else {
        rows = d.rows || [];                          // docs written before chunking
      }
      /* WHICH COPY THESE ROWS ARE. The rows cache keys on count and time, and the slim and full copies share both —
       * a table built from slim rows stayed on screen after the full ones arrived. */
      REPL[b] = { at: d.at && d.at.toDate ? d.at.toDate() : null, rows, recCols: d.recCols || [], catalogSkus: d.catalogSkus || [], mode: full ? 'full' : 'slim' };
    } catch (e) {
      // A DENIED read must not look like "there is simply no snapshot" — that sent us hunting in the
      // wrong place. Record it so renderRepl can say what actually happened.
      if (/permission|insufficient/i.test(e.code || e.message || '')) {
        ACCESS_ERR = ACCESS_ERR || `Firestore denied this account (${ME.email}) when reading the saved snapshot. Every read needs perms.repl = true (or admin) — the tabs alone are not enough. Ask an admin to re-save your access in Sellora → Settings → Access.`;
      }
    }
  }));
}
async function saveReplCache(brand, rows, recCols, catalogSkus) {
  const chunks = Math.ceil(rows.length / REPL_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    await setDoc(doc(db, 'replrows', `${brand}_${i}`), { r: rows.slice(i * REPL_CHUNK, (i + 1) * REPL_CHUNK) });
  }
  await setDoc(doc(db, 'repl', brand), { chunks, n: rows.length, recCols: recCols || [], catalogSkus: catalogSkus || [], rows: null, at: serverTimestamp() });
  await saveReplSlim(brand, rows, catalogSkus);
}
/** The slim copy, written every time the full one is: what a SKU is and what FBA holds, nothing else. */
async function saveReplSlim(brand, rows, catalogSkus) {
  const slim = (rows || []).map(replSlimRow);
  const chunks = Math.ceil(slim.length / REPL_SLIM_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    await setDoc(doc(db, 'replslimrows', `${brand}_${i}`), { r: slim.slice(i * REPL_SLIM_CHUNK, (i + 1) * REPL_SLIM_CHUNK) });
  }
  await setDoc(doc(db, 'replslim', brand), { chunks, n: slim.length, catalogSkus: catalogSkus || [], at: serverTimestamp() });
}
let REPL_LOADED = false;
// The snapshot and the three side-lists (India stock · status/projection overrides · In Production) are
// independent Firestore reads, so they all go out at once. Waiting for the set means ONE render on first
// paint: before this, renderRepl painted the entire 4,777-row grid, then the side-lists landed and it
// painted the whole thing a second time. The extra wait is nil — they run alongside the snapshot, which
// is the slowest of the four anyway. (Each loader is idempotent, so the lazy path in renderRepl and the
// other tabs' ensure* still work unchanged.)
/* AT SIGN-IN (Ravi, 2026-09-26: "data bahut heavy ho gya h"): the slim snapshot and the production notes, nothing more.
 * The production screens read a SKU's colour, size and FBA stock from it and assume it is there; the full copy and the
 * health read used to be awaited here too, 10.8 MB before the first screen for an admin who then opened Cutting. */
async function ensureReplSlim() {
  await Promise.all([loadReplCache(false), loadProd()]);
}
/* The snapshot as this account may see it — full for those allowed — for the Replenishment screens that read the
 * full fields (Target, Follow-up, India, In Production). Not the table itself. */
async function ensureReplData() {
  if (REPL_LOADED) return;
  await Promise.all([loadReplCache(true), loadProd()]);
  REPL_LOADED = true;
}
async function ensureRepl() {
  if (!REPL_LOADED) {
    rMsg('Loading last snapshot…');
    /* SAID ON THE SCREEN, not only in the small line: since sign-in stopped waiting for the full snapshot (26 Sep) the
     * table is empty for the seconds it takes to read, and an empty tab reads as a broken one. */
    if ($('rKpis') && !$('rKpis').innerHTML) $('rKpis').innerHTML = '<div class="kpi"><div class="kpiname"><span class="spin"></span> Reading the full snapshot…</div>'
      + '<div class="muted" style="margin-top:6px">Images, status, stock and forecasts — a few seconds. The table draws by itself when it lands.</div></div>';
    /* INDIA STOCK IS NOT WAITED FOR. It is a Google Apps Script call — 50 seconds cold, 5 to 7 warm,
     * for 124 KB — while the 8 MB snapshot beside it takes 3. Waiting on it held the whole tab shut
     * for the slowest thing on the list, and it feeds columns rather than the table's existence.
     *
     * Kicked off here so it is already in flight, and the table is redrawn when it lands. */
    loadIndiaStock().then(() => { if (REPL_LOADED) renderRepl(); }).catch(() => {});
    /* IN PRODUCTION IS NOT LOADED HERE ANY MORE. The figure comes out of the order book; renderRepl, the
     * India projection and the In Production tab each load it themselves when they are opened. */
    /* The US-listing set (2.6 MB) is not waited for: renderRepl reads it lazily and redraws when it lands. */
    await Promise.all([loadReplCache(true), loadProd()]);
    REPL_LOADED = true; rMsg('');
  }
  renderRepl();
}

$('rGo').onclick = async () => {
  const btn = $('rGo'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>…';
  const failed = [], statusNote = [];
  for (const b of ['SP', 'CPC']) {
    try {
      rMsg(`${BRAND_NAME[b]}: reading the Inventory sheet…`);
      const say = t => rMsg(`${BRAND_NAME[b]}: ${t}`);
      let d;
      try { d = await replPull(b, say); }
      catch (e) {
        /* The backend could not keep the read in its cache (it says so by name). Then — and only
         * then — the old one-piece read is tried. */
        if (!(e.data && e.data.cacheFull)) throw e;
        say('reading the sheet in one piece…');
        d = await apiGetRetry({ repl: 'list', brand: b }, 3,
          (n, of) => say(`Google lost the answer — asking again (${n} of ${of})…`), 150000);
      }
      REPL[b] = { at: new Date(), rows: d.rows || [], recCols: d.recCols || [], catalogSkus: d.catalogSkus || [] };
      console.info(`[repl] ${b}: ${(d.rows || []).length} rows · status filled ${d.statusN ?? '?'} · stopped ${d.stoppedN ?? '?'}`);
      statusNote.push(`${BRAND_NAME[b]} status ${d.statusN ?? '?'}/${(d.rows || []).length}`);
      /* The year sales history feeds the out-of-stock rate. When it stops short of today, say so here —
       * on 15 Sep it had silently been six weeks old. */
      const hd = d.histDiag || {};
      if (hd.histCurrent === false) {
        failed.push(`${BRAND_NAME[b]}: the year sales history ends ${hd.histEnd ? hd.histEnd.slice(0, 10) : '(unknown)'}, so out-of-stock SKUs are rated on old sales. Rebuild it from the Amazon Report menu (“Rebuild sales-history cache”).`);
      }
      renderRepl();                                   // show immediately, then cache in chunks
      await saveReplCache(b, d.rows || [], d.recCols || [], d.catalogSkus || []);
    } catch (e) { failed.push(`${BRAND_NAME[b]}: ${e.message || e}`); }
  }
  REPL_LOADED = true; REPL_MODE = 'full';
  rMsg(failed.length ? failed.join('  ·  ') : `Updated from the sheet. (${statusNote.join(' · ')})`, failed.length > 0);
  btn.disabled = false; btn.textContent = 'Refresh from sheet';
};

// Typing in a filter box fires per keystroke, and every render walks the whole snapshot — so the SKU
// boxes on all four tabs go through this. 200ms is below the "did it hear me" threshold and collapses
// a burst of typing into ONE render instead of one per letter.
const debounced = (fn, ms = 200) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
$('rFilter').addEventListener('input', debounced(renderRepl));
$('rBrand').addEventListener('change', renderRepl);
$('rNeed').addEventListener('change', renderRepl);
$('rSupply').addEventListener('change', renderRepl);   // the five filters signal through msChanged

let AR_COVER = '';                // Article Review's own cover band
let AR_PRIO = '';                 // and its priority band
let AR_LAST = [];                 // the rows it last drew, for Export
let R_COVER = '';                 // '' or one bucket key
let R_TOP_ONLY = false;           // narrows whatever bucket is chosen to the top sellers
let R_ALL_ROWS = [];              // this render's rows before any filter
$('rTopOnly').onclick = () => { R_TOP_ONLY = !R_TOP_ONLY; renderRepl(); };
$('rCoverSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-cover]');
  if (!b) return;
  // Clicking the button that is already on turns it OFF. Otherwise the only way back to the full
  // list is the All button, and somebody filtered down to 15 days wonders where everything went.
  R_COVER = (b.dataset.cover === R_COVER) ? '' : b.dataset.cover;
  $('rCoverSeg').querySelectorAll('[data-cover]')
    .forEach(x => x.classList.toggle('on', x.dataset.cover === R_COVER));
  renderRepl();
});
// Lead times (production / air / sea days) — remembered per browser; they drive the SEA/AIR/LATE tags.
loadLead();
['prod', 'disp', 'air', 'sea'].forEach(k => {
  const el = $('rLead' + k.charAt(0).toUpperCase() + k.slice(1));
  el.value = LEAD[k];
  el.addEventListener('change', () => {
    const n = Math.max(0, Math.round(Number(el.value)));
    LEAD[k] = isFinite(n) ? n : LEAD[k];
    el.value = LEAD[k];
    try { localStorage.setItem('repl_lead', JSON.stringify(LEAD)); } catch (e) {}
    renderRepl();                      // lanes are recomputed each render, so no cache to clear
  });
});
// Forecast horizon — remembered per browser so it survives a reload.
try { const h = localStorage.getItem('repl_horizon'); if (h) $('rHorizon').value = h; } catch (e) {}
$('rHorizon').addEventListener('change', () => {
  try { localStorage.setItem('repl_horizon', $('rHorizon').value); } catch (e) {}
  renderRepl();
});
// Manual Status override (delegated — the table body is rebuilt each render). The cell shows a pill;
// clicking its ▾ swaps that one cell to a dropdown, and a pick saves the override + re-renders.
let STSEL_SAVING = false;
$('rTable').addEventListener('click', e => {
  const btn = e.target.closest('.stedit'); if (!btn) return;
  const td = btn.closest('td'); if (!td) return;
  const cur = STATUS_OVR[String(btn.dataset.sku).trim().toUpperCase()] || '';
  td.innerHTML = `<select class="stsel" data-sku="${esc(btn.dataset.sku)}" style="font-size:12px;padding:3px 5px;border-radius:6px">` +
    `<option value="">Auto (India status)</option>` +
    STATUS_OPTS.map(o => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select>';
  const sel = td.querySelector('select'); sel.focus();
  if (sel.showPicker) { try { sel.showPicker(); } catch (_) {} }
});
$('rTable').addEventListener('change', async e => {
  const sel = e.target.closest('.stsel'); if (!sel) return;
  STSEL_SAVING = true;
  const skuU = String(sel.dataset.sku).trim().toUpperCase(), val = sel.value;
  if (val) STATUS_OVR[skuU] = val; else delete STATUS_OVR[skuU];
  PROJ_VER++;                                            // stopped feeds the forecast too → drop its cache
  renderRepl();                                          // status change flips stopped → Req columns + subtotals
  try { await setDoc(doc(db, 'repl', 'prodstatus'), { statusOverride: { [skuU]: val || null } }, { merge: true }); }
  catch (err) { rMsg('Could not save status: ' + (err.message || err), true); }
});
$('rTable').addEventListener('focusout', e => {                 // opened but clicked away with no change → back to the pill
  if (!e.target.closest('.stsel')) return;
  if (STSEL_SAVING) { STSEL_SAVING = false; return; }
  renderRepl();
});
// ---- Manual monthly projection override (delegated; the body is rebuilt on every render) ----
// Click a Proj cell → it becomes a number box. Enter or clicking away saves; Escape cancels; an EMPTY
// box clears the override and the month goes back to the calculated figure. The value is stored per
// SKU per month in repl/prodstatus.projOverride, so it is NOT touched by "Refresh from sheet" — it
// stays exactly as typed until the user changes it.
async function saveProjOvr(inp) {
  if (inp._done) return; inp._done = true;               // Enter + the follow-up focusout must not double-save
  if (!ME.projEdit) { renderRepl(); return; }            // belt and braces — the rules are the real gate
  const key = String(inp.dataset.sku).trim().toUpperCase() + '|' + inp.dataset.mk;
  const raw = String(inp.value).trim();
  const n = Number(raw);
  const val = (raw === '' || !isFinite(n)) ? null : Math.max(0, Math.round(n));
  if (val == null) delete PROJ_OVR[key]; else PROJ_OVR[key] = val;
  PROJ_VER++;                                            // a manual Proj changes the forecast → drop its cache
  renderRepl();                                          // Excess + every later month carry from this
  try { await setDoc(doc(db, 'repl', 'projoverride'), { map: { [key]: val }, by: ME.email, at: serverTimestamp() }, { merge: true }); }
  catch (err) { rMsg('Could not save the projection: ' + (err.message || err), true); }
}
$('rTable').addEventListener('click', e => {
  const cell = e.target.closest('.projcell'); if (!cell) return;
  if (!ME.projEdit) { rMsg('You do not have permission to change projections — ask an admin for “Edit projections”.', true); return; }
  const td = cell.closest('td'); if (!td || td.querySelector('.projin')) return;
  const key = String(cell.dataset.sku).trim().toUpperCase() + '|' + cell.dataset.mk;
  const cur = PROJ_OVR[key];
  td.innerHTML = `<input class="projin" type="number" min="0" step="1" data-sku="${esc(cell.dataset.sku)}"`
    + ` data-mk="${esc(cell.dataset.mk)}" value="${cur == null ? '' : esc(String(cur))}"`
    + ` placeholder="${esc(String(cell.dataset.auto))}" title="Type a number, or leave empty to go back to the calculated projection">`;
  const inp = td.querySelector('.projin'); inp.focus(); inp.select();
});
$('rTable').addEventListener('keydown', e => {
  const inp = e.target.closest('.projin'); if (!inp) return;
  if (e.key === 'Enter') { e.preventDefault(); saveProjOvr(inp); }
  else if (e.key === 'Escape') { inp._done = true; renderRepl(); }
});
$('rTable').addEventListener('focusout', e => {
  const inp = e.target.closest('.projin'); if (inp) saveProjOvr(inp);
});

// ---- Upload a whole month's projection from Excel (SKU + QTY) ----
// Each uploaded row lands in exactly the same place a typed cell does (projOverride["SKU|YYYY-MM"]),
// so an imported month shows the same yellow "manual" highlight and is just as permanent.
const pjErr = t => { const e = $('pjErr'); e.textContent = t || ''; e.classList.toggle('hide', !t); };
function pjFillMonths() {
  if (!FC_PLAN.length) FC_PLAN = buildFcPlan([]);
  const sel = $('pjMonth'), cur = sel.value;
  sel.innerHTML = FC_PLAN.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  if (cur && FC_PLAN.some(p => p.key === cur)) sel.value = cur;
  pjHave();
}
function pjKeysFor(mk) { return Object.keys(PROJ_OVR).filter(k => k.endsWith('|' + mk) && PROJ_OVR[k] != null); }
function pjHave() {
  const mk = $('pjMonth').value, n = pjKeysFor(mk).length;
  const p = FC_PLAN.find(x => x.key === mk);
  $('pjHave').textContent = n
    ? `${nf(n)} SKU(s) already have a manual projection for ${p ? p.label : mk}.`
    : `No manual projections set for ${p ? p.label : mk} yet — every SKU is on the calculated figure.`;
}
$('rProj').onclick = () => { pjErr(''); pjFillMonths(); $('projModal').classList.remove('hide'); };
$('pjCancel').onclick = () => $('projModal').classList.add('hide');
$('projModal').onclick = e => { if (e.target === $('projModal')) $('projModal').classList.add('hide'); };
$('pjMonth').addEventListener('change', pjHave);
$('pjTemplate').onclick = () => csvDownload('projection-template', ['SKU', 'QTY'], [['ABC-123', '120'], ['XYZ-456', '80']]);
$('pjImport').onclick = () => $('pjFile').click();
$('pjFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const mk = $('pjMonth').value, mLabel = (FC_PLAN.find(x => x.key === mk) || {}).label || mk;
  try {
    pjErr('');
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { pjErr('That file has no rows.'); return; }
    const head = rows[0].map(h => h.trim().toLowerCase());
    const iSku = colIdx(head, ['sku']);
    const iQty = colIdx(head, ['qty', 'quantity', 'projection', 'proj', 'units', 'forecast']);
    if (iSku < 0 || iQty < 0) { pjErr('The file needs a "SKU" column and a "QTY" column.'); return; }
    const patch = {}; let n = 0, bad = 0;
    for (let i = 1; i < rows.length; i++) {
      const sku = cellAt(rows[i], iSku); if (!sku) continue;
      const raw = String(cellAt(rows[i], iQty)).replace(/[, ]/g, '');
      const q = Number(raw);
      if (raw === '' || !isFinite(q)) { bad++; continue; }
      patch[sku.trim().toUpperCase() + '|' + mk] = Math.max(0, Math.round(q));
      n++;
    }
    if (!n) { pjErr('No usable SKU/QTY rows found.'); return; }
    if (!confirm(`Set the ${mLabel} projection for ${n} SKU(s)?${bad ? `\n(${bad} row(s) had no usable QTY and will be skipped.)` : ''}\n\nSKUs not in this file keep whatever they already have.`)) return;
    Object.assign(PROJ_OVR, patch); PROJ_VER++;
    renderRepl();
    await setDoc(doc(db, 'repl', 'projoverride'), { map: patch, by: ME.email, at: serverTimestamp() }, { merge: true });
    pjHave();
    rMsg(`${mLabel} projection set for ${nf(n)} SKU(s).`);
    $('projModal').classList.add('hide');
  } catch (err) { pjErr('Import failed: ' + (err.message || err)); }
};
$('pjClear').onclick = async () => {
  const mk = $('pjMonth').value, mLabel = (FC_PLAN.find(x => x.key === mk) || {}).label || mk;
  const keys = pjKeysFor(mk);
  if (!keys.length) { pjErr(`Nothing to clear for ${mLabel}.`); return; }
  if (!confirm(`Remove the manual projection for ${keys.length} SKU(s) in ${mLabel}?\nThose months go back to the calculated figure.`)) return;
  const patch = {};
  keys.forEach(k => { patch[k] = null; delete PROJ_OVR[k]; }); PROJ_VER++;
  renderRepl();
  try {
    await setDoc(doc(db, 'repl', 'projoverride'), { map: patch, by: ME.email, at: serverTimestamp() }, { merge: true });
    pjHave(); pjErr('');
    rMsg(`Cleared ${keys.length} manual projection(s) for ${mLabel}.`);
  } catch (err) { pjErr('Could not clear: ' + (err.message || err)); }
};

$('rClear').addEventListener('click', () => {
  $('rNeed').value = 'ALL';
  msClearAll();
  $('rFilter').value = '';
  // The cover buttons are a filter like any other, so Clear has to release them too — otherwise
  // the list stays narrowed and nothing on screen looks like it is still filtering.
  R_COVER = '';
  R_TOP_ONLY = false;
  $('rCoverSeg').querySelectorAll('[data-cover]')
    .forEach(x => x.classList.toggle('on', x.dataset.cover === ''));
  renderRepl();
});

// Excel-style comment popup for the Remark note markers — one shared tooltip, follows the cursor,
// stays inside the viewport (position:fixed avoids the scrollable table clipping it).
document.addEventListener('mouseover', e => {
  const n = e.target.closest && e.target.closest('.note'); if (!n) return;
  const t = $('rmkTip'); if (!t) return;
  const row = R_RENDER.rows.find(r => String(r.sku) === n.dataset.sku);   // compute the narrative lazily, cache on the row
  t.textContent = row ? (row._rmk || (row._rmk = replRemark(row).s)) : '';
  t.style.display = 'block';
});
document.addEventListener('mouseout', e => {
  const n = e.target.closest && e.target.closest('.note'); if (!n) return;
  const t = $('rmkTip'); if (t) t.style.display = 'none';
});
document.addEventListener('mousemove', e => {
  const t = $('rmkTip'); if (!t || t.style.display !== 'block') return;
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
});

let R_SORT = { k: 'avgSale', dir: -1 }, R_RENDER = { rows: [], defs: [] };

// Amazon media images accept an inline size token — request a small thumbnail so 200 rows stay light
// (full-res product images are 500–1500px each; downloading 200 of them is what makes the grid lag).
// 160px, not 320: .thumb paints at 64 CSS px, so 160 already covers a 2× screen with room to spare,
// and the decode work Chrome does WHILE YOU SCROLL drops ~4× versus 320.
// Any existing size token is replaced; non-Amazon URLs are returned unchanged.
function thumbUrl(u) {
  u = String(u || '');
  const m = u.match(/^(https?:\/\/[^?#]*\/images\/[A-Za-z]\/[^./]+)(\._[A-Za-z0-9,_-]+_)?(\.(?:jpg|jpeg|png|gif|webp))(\?[^#]*)?$/i);
  return m ? `${m[1]}._SL160_${m[3]}${m[4] || ''}` : u;
}

// Sea Qty already accounts for the whole pipeline; Air Qty is only the shortfall that must fly. The
// suggested MODE is Air when Air Qty > 0, else Sea when Sea Qty > 0, else none.
function replMode(r) { return r.airQty > 0 ? 'air' : r.seaQty > 0 ? 'sea' : ''; }
function stockState(r) {
  if (!(r.totalStock > 0) && !(r.awdAvail > 0)) return 'out';
  // Air needed = the sheet's own signal that stock runs out within 90 days despite timed arrivals.
  if (r.airQty > 0) return 'low';
  // Then a short days-of-cover. Only POSITIVE DoS is a constraint — a 0/blank DoS means "no data
  // from that lane", NOT zero cover (0 would be falsy and silently read as infinite otherwise).
  const dos = [r.airDos, r.seaDos].filter(d => d > 0);
  if (dos.length && Math.min(...dos) <= 30) return 'low';
  return 'ok';
}

// Apply the manual Status override (Settings → the ▾ in the Status column) / the legacy Top-ASIN
// discontinue flag onto a snapshot row. Shared by the Replenishment grid and the Action Plan so both
// agree on which SKUs are stopped (a stopped SKU is never re-ordered and never "needs" production).
function applyStatus(r) {
  r._autoStatus = (r.status || '').trim();                // the India/backend status, before any override
  const skuU = String(r.sku).trim().toUpperCase();
  const ovr = STATUS_OVR[skuU];
  if (ovr) {
    r.status = ovr; r._statusManual = true;
    r.stopped = REPL_STOP_RE.test(ovr);
    r.stopReason = r.stopped ? `Manually set to "${ovr}"` : '';
  } else if (isDisc(r.sku)) {
    r.stopped = true; r.stopReason = 'Manually discontinued';
  }
  return r;
}

// Required units per lane come straight from the backend's 90-day KEEP-LEVEL projection (replReadInv_):
// Air fills to 90, Sea adds one month to 120, AWD tops up to 150 — and every lane already has incoming
// stock (this month's Rec., future Rec. months at their arrival day, AWD transit) NETTED OUT by a
// forward projection, so nothing already on the way is re-ordered. The app just displays those numbers.
function replReq(r) {
  if (r.stopped) return { air: 0, sea: 0, awd: 0 };   // Discontinued / Use In Mix — never reorder.
  return { air: r.airReq || 0, sea: r.seaReq || 0, awd: r.awdReq || 0 };
}

// How much of the requirement can ship FROM India stock (the sheet's ←India logic): AIR takes its
// share first (only if air-eligible), then SEA gets the leftover India stock. Nothing under MIN_SHIP (5)
// actually ships — a sub-5 allocation drops to 0. Returns the units to send from India per lane.
const MIN_SHIP = 5;
function replIndiaAlloc(r) {
  const india = Number(INDIA_STOCK[String(r.sku).toUpperCase()]) || 0;
  const req = r._req || { air: 0, sea: 0 };
  let airInd = (req.air > 0 && !r.airExcluded) ? Math.min(req.air, india) : 0;
  if (airInd < MIN_SHIP) airInd = 0;
  let seaInd = Math.min(req.sea || 0, Math.max(0, india - airInd));
  if (seaInd < MIN_SHIP) seaInd = 0;
  return { india, airInd, seaInd };
}

// Human-readable Remark: a proper-English narrative — current days of cover, what stock is arriving
// (this month's Rec., AWD transit with its ETA, future Rec. months), and the resulting recommendation.
// Wording lives here (frontend) so it can be tuned without a backend redeploy; the numbers/timing come
// from the backend's `inflow` summary and the airReq/seaReq/awdReq lanes.
function replRemark(r) {
  if (r.stopped) return { s: `${r.stopReason || `India listing status is "${r.status || 'Discontinued'}"`} — this SKU is stopped, so no further stock is projected for it.`, muted: 1 };
  const avg = r.avgSale || 0;
  if (!(avg > 0)) return { s: 'No sales run-rate yet, so nothing can be projected.', muted: 1 };
  const cover = r.coverDos, air = r.airReq || 0, sea = r.seaReq || 0, awd = r.awdReq || 0, tot = air + sea + awd;
  const inf = r.inflow || { m: 0, awd: 0, awdDay: null, fut: [] };
  const perDay = Math.round(avg * 10) / 10;
  const parts = [`Current cover is about ${cover == null ? '—' : cover} days at ~${perDay} units/day.`];

  const inc = [];
  if (inf.m > 0) inc.push(`${nf(inf.m)} units are being received into FBA this month`);
  if (inf.awd > 0) inc.push(`${nf(inf.awd)} units are inbound from AWD${inf.awdDay != null ? ` (arriving in ~${inf.awdDay} days)` : ''}`);
  (inf.fut || []).forEach(f => inc.push(`${nf(f.q)} units arrive in ${f.l}`));
  parts.push(inc.length ? `Incoming: ${inc.join('; ')}.` : 'No further stock is on the way.');

  if (r.awdTransfer) parts.push(`FBA stock is running low while ${nf(r.awdAvail || 0)} units sit in AWD — move those to FBA first.`);

  if (!tot) {
    parts.push(cover != null && cover >= 150
      ? 'You already hold 5+ months of cover, so nothing needs to be sent.'
      : 'The incoming stock already covers you to the target, so nothing needs to be sent right now.');
    return { s: parts.join(' '), muted: !r.awdTransfer };
  }
  if (air && sea) parts.push(`Even so, at this pace you end up about ${nf(air)} units short of the 90-day level, so send ${nf(air)} by air now, and ${nf(sea)} more by sea to build up to about 120 days.`);
  else if (air) parts.push(`Send ${nf(air)} units by air to bring cover back to the 90-day level.`);
  else if (sea) parts.push(r.airExcluded && cover != null && cover < 90
    ? `This sub-category can't ship by air, so send ${nf(sea)} units by sea to build back up to about 120 days.`
    : `Send ${nf(sea)} units by sea to top up to about 120 days.`);
  else if (awd) parts.push(`Move ${nf(awd)} units via AWD to top up to about 150 days.`);
  return { s: parts.join(' ') };
}

// Populate the Sub-Category / Color / Status dropdowns from the loaded rows of the picked brands,
// keeping the user's current pick if it still exists. Cat/Send are fixed sets, so they live in the HTML.
let FILTERS_SIG = '';
