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
function csvDownload(name, cols, rows) {
  const lines = [cols.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
// Header lookup for CSV import: first matching column name wins, -1 when absent.
const colIdx = (head, names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
const cellAt = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
function fillSel(id, vals, label) {
  const sel = $(id), cur = sel.value;
  const opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">${label}</option>` + opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = opts.includes(cur) ? cur : '';
}

