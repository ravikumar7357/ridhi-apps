/* ================= SHARED LOOKUPS (India Stock + In Production tabs) ================= */
// Product details (brand / sub-cat / colour / size) + the backend's Air/Sea/AWD requirement for a SKU,
// taken from the Replenishment snapshot. Built on demand — the snapshot is already loaded by then.
function replRowMap() {
  const m = {};
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].rows) || []).forEach(r => {
    const k = String(r.sku || '').trim().toUpperCase();
    if (k && !m[k]) m[k] = { ...r, brand: b };
  }));
  return m;
}
// EVERY SKU that exists as a listing, from the backend's Catalog tab. The snapshot itself is built from
// Amazon's FBA inventory report, which DROPS a SKU that currently has no inventory record — so "missing
// from the snapshot" never meant "not on Amazon". A SKU here but not in the snapshot is simply listed
// with no FBA stock, which is exactly the case worth reordering.
function catalogSet() {
  const s = new Set();
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].catalogSkus) || []).forEach(k => {
    const u = String(k || '').trim().toUpperCase(); if (u) s.add(u);
  }));
  return s;
}
const onAmazon = (key, rmap, cat) => !!rmap[key] || cat.has(key);
// Units of a SKU sitting on ONGOING purchase orders (ordered / in transit).
function poQtyMap() {
  const m = {};
  PO.filter(p => ['ordered', 'transit'].includes(p.status)).forEach(p => (p.lines || []).forEach(l => {
    const k = String(l.sku || '').trim().toUpperCase(); if (!k) return;
    m[k] = (m[k] || 0) + lTot(l);
  }));
  return m;
}
function fillSel(id, vals, label) {
  const sel = $(id), cur = sel.value;
  const opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">${label}</option>` + opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = opts.includes(cur) ? cur : '';
}

