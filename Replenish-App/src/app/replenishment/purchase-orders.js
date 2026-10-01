/* ================= PURCHASE ORDERS ================= */
function poMsg(t, bad) { const m = $('poMsg'); if (!m) return; m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }
let PO_LOADED = false;
// PO tab was removed — after a save/delete, reload and refresh the Ongoing PO view + badge.
async function ensurePo() {
  if (!PO_LOADED) { await loadPo(); PO_LOADED = true; }
  await loadReplCache(false);   // FBA stock column needs the Replenishment snapshot
  buildFbaMap(); CATALOG_SET = catalogSet();
  renderFollow(); updateFollowBadge();
  // India Stock column reads the uploaded list — lazy-load once, then re-render to fill it in.
  if (!INDIA_LOADED) loadIndiaStock().then(() => renderFollow()).catch(() => {});
}
async function loadPo() {
  PO = [];
  try {
    const snap = await getDocs(collection(db, 'po'));
    snap.forEach(d => PO.push({ id: d.id, ...d.data() }));
  } catch (e) { poMsg('Could not load POs: ' + (e.message || e), true); }
}

// A PO line's quantity split. Old lines carry only `qty`; new lines carry airQty + seaQty and
// qty = their sum (total). lTot falls back to the old `qty` when no air/sea split is present.
const lAir = l => Number(l.airQty) || 0;
const lSea = l => Number(l.seaQty) || 0;
const lTot = l => (l.airQty != null || l.seaQty != null) ? lAir(l) + lSea(l) : (Number(l.qty) || 0);
/**
 * India stock for a SKU. Zero for a SKU the warehouse list does not name — but only once that list
 * has actually been read: before then there is no answer, and answering 0 would overstate what is
 * still to arrange on every line of a table people raise purchase orders from.
 */
const indiaNum = sku => {
  if (!INDIA_LOADED) return null;
  const v = INDIA_STOCK[String(sku || '').toUpperCase()];
  return typeof v === 'number' ? v : 0;
};
// Still to arrange = Total Qty − everything you already hold for that SKU (FBA/AWD + India).
// Floored at 0: when stock already exceeds the order there is nothing pending, not a negative.
/* Still to arrange = Total − everything already held for that SKU. Null while India is still on its
 * way, so the cell shows a dash rather than a number that is too big. */
const lPend = l => { const i = indiaNum(l.sku); return i == null ? null : Math.max(0, lTot(l) - fbaNum(l.sku) - i); };
/* The same figure for anything that has to add it up. Nothing to add while India is still on its
 * way, which is the truth and not a nought. */
const lPendN = l => lPend(l) || 0;
const numCell = n => n > 0 ? nf(n) : '<span class="muted">—</span>';
// India Stock for a SKU (read-only, from the pillow-tracker project). "—" until loaded / if absent.
const indiaCell = sku => {
  if (!INDIA_LOADED) return '<span class="muted" title="The warehouse list is still being read.">…</span>';
  const v = INDIA_STOCK[String(sku || '').toUpperCase()];
  return v == null ? '<span class="muted">—</span>' : (typeof v === 'number' ? nf(v) : esc(String(v)));
};
// Total FBA stock for a SKU = Total Stock + AWD Available + AWD Transit (from the Replenishment snapshot).
// Lets the PO view show whether the ordered goods have actually reached FBA / AWD yet. "—" until the
// Replenishment snapshot is loaded / if the SKU isn't in it. buildFbaMap() fills FBA_STOCK from REPL.
function buildFbaMap() {
  FBA_STOCK = {};
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].rows) || []).forEach(r => {
    const k = String(r.sku || '').toUpperCase(); if (!k) return;
    FBA_STOCK[k] = (Number(r.totalStock) || 0) + (Number(r.awdAvail) || 0) + (Number(r.awdTransit) || 0);
  }));
}
const fbaNum = sku => { const v = FBA_STOCK[String(sku || '').toUpperCase()]; return typeof v === 'number' ? v : 0; };
const fbaCell = sku => { const v = FBA_STOCK[String(sku || '').toUpperCase()]; return v == null ? '<span class="muted">—</span>' : nf(v); };
// A SKU is "listed on Amazon" if it appears in the Replenishment snapshot (built from the Amazon
// Inventory sheet). Absent ⇒ not listed yet → needs a listing. Only meaningful once a snapshot exists.
const haveFbaSnap = () => Object.keys(FBA_STOCK).length > 0;
// "Listed" must mean listed on AMAZON, not "present in the FBA inventory report". That report drops a
// SKU once it has no inventory record, so checking FBA_STOCK alone flagged hundreds of perfectly live
// listings as "Not listed". The Catalog is the real list of what exists.
let CATALOG_SET = new Set();
const isListed = sku => {
  const k = String(sku || '').trim().toUpperCase();
  return FBA_STOCK[k] != null || CATALOG_SET.has(k);
};
function poUnits(p) { return (p.lines || []).reduce((s, l) => s + lTot(l), 0); }
const PO_STATUS = { draft: 'Draft', ordered: 'Ordered', transit: 'In transit', received: 'Received', cancelled: 'Cancelled' };
const PRIO = { high: ['High', '#fee2e2', '#b91c1c'], medium: ['Medium', '#fef9c3', '#854d0e'], low: ['Low', '#e2e8f0', '#475569'] };
const prioPill = p => { const x = PRIO[p] || PRIO.medium; return `<span class="fu" style="background:${x[1]};color:${x[2]}">${x[0]}</span>`; };
const prioW = p => ({ high: 0, medium: 1, low: 2 }[p] ?? 1);

function renderPo() {
  let list = PO.slice();
  const b = $('poBrand').value; if (b !== 'ALL') list = list.filter(p => p.brand === b);
  const st = $('poStatus').value; if (st !== 'ALL') list = list.filter(p => (p.status || 'draft') === st);
  const q = $('poFilter').value.trim().toLowerCase();
  if (q) list = list.filter(p => ((p.supplier || '') + ' ' + (p.id || '') + ' ' + (p.lines || []).map(l => l.sku).join(' ')).toLowerCase().includes(q));
  list.sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')));

  // FLAT view: one row per SKU line, with the PO's Supplier/Brand/Mode/dates/Priority repeated.
  const head = '<thead><tr>' + ['Supplier', 'Brand', 'SKU', 'Sub-Category', 'Color Name', 'Size', 'Air Qty', 'Sea Qty', 'Total Qty', 'India Stock', 'Mode', 'Order Date', 'Delivery Date', 'Priority', ''].map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
  const body = list.map(p => (p.lines || []).map(l => `<tr>
      <td class="frz">${esc(p.supplier || '(no supplier)')}</td>
      <td>${BRAND_NAME[p.brand] || p.brand || ''}</td>
      <td style="font-family:ui-monospace,monospace">${esc(l.sku || '')}</td>
      <td>${esc(l.subcat || '—')}</td>
      <td>${esc(l.color || '—')}</td>
      <td>${esc(l.size || '—')}</td>
      <td class="num">${numCell(lAir(l))}</td>
      <td class="num">${numCell(lSea(l))}</td>
      <td class="num">${nf(lTot(l))}</td>
      <td class="num">${indiaCell(l.sku)}</td>
      <td>${p.mode === 'air' ? '<span class="pill pill-air">Air</span>' : '<span class="pill pill-sea">Sea</span>'}</td>
      <td>${esc(p.orderDate || '')}</td>
      <td>${esc(p.eta || '')}</td>
      <td>${prioPill(p.priority)}</td>
      <td><button class="xbtn" data-po="${esc(p.id)}">Open</button></td>
    </tr>`).join('')).join('');
  $('poTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="15" class="muted">No purchase orders yet. Create one with “+ New PO”, or from the Replenishment view.</td></tr>`) + '</tbody>';
  $('poTable').querySelectorAll('[data-po]').forEach(bn => bn.onclick = () => openPoEditor(PO.find(x => x.id === bn.dataset.po), null));

  const open = list.filter(p => ['ordered', 'transit'].includes(p.status)).length;
  const units = list.reduce((s, p) => s + poUnits(p), 0);
  $('poKpis').innerHTML = `<div class="kpi"><div class="kpihead"><span class="kpiname">Purchase orders</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(list.length)}</div><div class="l">POs</div></div>
      <div class="metric"><div class="v" style="color:#1e40af">${nf(open)}</div><div class="l">Ordered / in transit</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${nf(units)}</div><div class="l">Total units</div></div>
    </div></div>`;
}

/* ----- PO editor ----- */
let PO_EDIT = null, PM_LINES = [];
function openPoEditor(existing, seed) {
  PO_EDIT = existing || null;
  const p = existing || seed || {};
  $('poModalTitle').textContent = existing ? 'Purchase order' : 'New purchase order';
  $('pmBrand').value = p.brand || 'SP';
  $('pmSupplier').value = p.supplier || '';
  $('pmMode').value = p.mode || 'sea';
  $('pmOrderDate').value = p.orderDate || dToday();   // local day: toISOString() is UTC, yesterday until 05:30 IST
  $('pmEta').value = p.eta || '';
  $('pmPriority').value = p.priority || 'medium';
  $('pmStatus').value = p.status || 'draft';
  $('pmNote').value = p.note || '';
  PM_LINES = (p.lines || []).map(l => ({ ...l }));
  $('pmDelete').classList.toggle('hide', !existing);
  $('pmErr').classList.add('hide');
  renderPmLines();
  $('poModal').classList.remove('hide');
}
function renderPmLines() {
  $('pmLines').innerHTML = PM_LINES.length ? PM_LINES.map((l, i) => `<tr>
      <td style="font-family:ui-monospace,monospace">${esc(l.sku)}
        ${l.note ? `<div class="muted" style="font-family:inherit;font-size:10.5px">− ${esc(l.note)}</div>` : ''}</td>
      <td>${esc(l.subcat || '—')}</td>
      <td>${esc(l.color || '—')}</td>
      <td>${esc(l.size || '—')}</td>
      <td class="num">${numCell(lAir(l))}</td>
      <td class="num">${numCell(lSea(l))}</td>
      <td class="num">${nf(lTot(l))}</td>
      <td class="num">${indiaCell(l.sku)}</td>
      <td><button class="xbtn" data-rm="${i}">✕</button></td></tr>`).join('')
    : '<tr><td colspan="9" class="muted">No lines yet.</td></tr>';
  $('pmLines').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { PM_LINES.splice(+b.dataset.rm, 1); renderPmLines(); });
}
// Sub-category / Color / Size for a SKU, from the loaded replenishment rows of that brand (if refreshed).
function skuInfo(sku, brand) {
  const rows = (REPL[brand] && REPL[brand].rows) || [];
  const r = rows.find(x => String(x.sku).toUpperCase() === String(sku).toUpperCase());
  return r ? { subcat: r.subcat || '', color: r.color || '', size: r.size || '' } : { subcat: '', color: '', size: '' };
}
$('pmAddLine').onclick = () => {
  const sku = $('pmAddSku').value.trim();
  const air = Number($('pmAddAir').value) || 0, sea = Number($('pmAddSea').value) || 0;
  if (!sku || !((air + sea) > 0)) return;
  PM_LINES.push({ sku, ...skuInfo(sku, $('pmBrand').value), airQty: air, seaQty: sea, qty: air + sea });
  $('pmAddSku').value = ''; $('pmAddAir').value = ''; $('pmAddSea').value = ''; renderPmLines();
};
$('pmCancel').onclick = () => $('poModal').classList.add('hide');
$('poModal').onclick = e => { if (e.target === $('poModal')) $('poModal').classList.add('hide'); };

$('pmSave').onclick = async () => {
  const supplier = $('pmSupplier').value.trim();
  if (!supplier) { $('pmErr').textContent = 'Enter a supplier.'; $('pmErr').classList.remove('hide'); return; }
  if (!PM_LINES.length) { $('pmErr').textContent = 'Add at least one line.'; $('pmErr').classList.remove('hide'); return; }
  const rec = {
    brand: $('pmBrand').value, supplier, mode: $('pmMode').value,
    orderDate: $('pmOrderDate').value, eta: $('pmEta').value,
    priority: $('pmPriority').value, status: $('pmStatus').value,
    note: $('pmNote').value.trim().slice(0, 500),
    lines: PM_LINES.map(l => ({ sku: l.sku, subcat: (l.subcat || '').slice(0, 40), color: (l.color || '').slice(0, 40), size: (l.size || '').slice(0, 30), airQty: lAir(l), seaQty: lSea(l), qty: lTot(l) })),
    followups: (PO_EDIT && PO_EDIT.followups) || [],   // full overwrite below — keep the follow-up log
    by: ME.email, at: serverTimestamp(),
  };
  try {
    if (PO_EDIT) { await setDoc(doc(db, 'po', PO_EDIT.id), rec); }
    else { await addDoc(collection(db, 'po'), rec); }
    $('poModal').classList.add('hide');
    PO_LOADED = false; await ensurePo();
    poMsg('Saved.'); setTimeout(() => poMsg(''), 1500);
  } catch (e) { $('pmErr').textContent = 'Could not save: ' + (e.message || e); $('pmErr').classList.remove('hide'); }
};
$('pmDelete').onclick = async () => {
  if (!PO_EDIT || !confirm('Delete this purchase order?')) return;
  try {
    await deleteDoc(doc(db, 'po', PO_EDIT.id));
    $('poModal').classList.add('hide');
    PO_LOADED = false; await ensurePo();
  } catch (e) { $('pmErr').textContent = 'Could not delete: ' + (e.message || e); $('pmErr').classList.remove('hide'); }
};

