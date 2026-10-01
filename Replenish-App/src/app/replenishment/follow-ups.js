/* ================= FOLLOW-UPS (ongoing POs, auto-scheduled every 7 days) ================= */
const FU_EVERY = 7;                                    // days between follow-ups

// A PO is "ongoing" while ordered / in transit. Follow-up is due FU_EVERY days after the order (or the
// last follow-up); it becomes overdue (red) once the delivery date (ETA) has passed and it's not received.
function poFollow(p) {
  const ongoing = ['ordered', 'transit'].includes(p.status);
  const fus = (p.followups || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = fus.length ? fus[fus.length - 1].date : null;
  const base = last || p.orderDate || null;
  const next = base ? dAdd(base, FU_EVERY) : null;
  const td = dToday();
  const overdue = ongoing && dValid(p.eta) && p.eta < td;
  const dueNow = ongoing && (!next || next <= td);
  const etaDays = dValid(p.eta) ? dDiff(td, p.eta) : null;   // +future / −overdue; null (→ "—") if no/bad date
  return { ongoing, last, next, overdue, dueNow, count: fus.length, etaDays };
}
function updateFollowBadge() {
  const n = PO.filter(p => { const f = poFollow(p); return f.ongoing && (f.dueNow || f.overdue); }).length;
  const el = $('followBadge');
  if (n > 0) { el.textContent = n; el.classList.remove('hide'); } else el.classList.add('hide');
}

async function ensureFollow() {
  if (!PO_LOADED) { $('fuMsg').textContent = 'Loading…'; await loadPo(); PO_LOADED = true; $('fuMsg').textContent = ''; }
  await ensureReplData();   // FBA stock column needs the Replenishment snapshot
  buildFbaMap(); CATALOG_SET = catalogSet();
  renderFollow(); updateFollowBadge();
}
$('fuBrand').addEventListener('change', renderFollow);
$('fuNew').onclick = () => openPoEditor(null, null);

// Keep the Supplier / Sub-Category / Color filter option lists in sync with the ongoing POs.
function fillFollowFilters(list) {
  const lines = list.flatMap(p => p.lines || []);
  const fill = (id, vals, label) => {
    const sel = $(id), cur = sel.value;
    const opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">All ${label}</option>` + opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = opts.includes(cur) ? cur : '';
  };
  fill('fuSupplier', list.map(p => p.supplier), 'suppliers');
  fill('fuPoId', list.map(p => p.id), 'PO IDs');
  fill('fuColor', lines.map(l => l.color), 'colors');
  fill('fuSubcat', lines.map(l => l.subcat), 'sub-categories');
}

function renderFollow() {
  const b = $('fuBrand').value;
  let list = PO.filter(p => ['ordered', 'transit'].includes(p.status));
  if (b !== 'ALL') list = list.filter(p => p.brand === b);
  fillFollowFilters(list);
  const fSup = $('fuSupplier').value, fPo = $('fuPoId').value, fSub = $('fuSubcat').value, fCol = $('fuColor').value, fLst = $('fuListed').value, fSku = $('fuSku').value.trim().toLowerCase();
  if (fSup) list = list.filter(p => (p.supplier || '') === fSup);
  if (fPo) list = list.filter(p => (p.id || '') === fPo);
  // Listing filter only applies once a Replenishment snapshot is loaded (else we can't tell listed from not).
  const lstMatch = l => !fLst || !haveFbaSnap() || (fLst === 'no' ? !isListed(l.sku) : isListed(l.sku));
  const lineMatch = l => (!fSub || (l.subcat || '') === fSub) && (!fCol || (l.color || '') === fCol) && lstMatch(l) && (!fSku || String(l.sku || '').toLowerCase().includes(fSku));

  const enr = list.map(p => ({ p, f: poFollow(p) })).filter(x => (x.p.lines || []).some(lineMatch));
  const rank = x => x.f.overdue ? 0 : x.f.dueNow ? 1 : 2;
  enr.sort((a, b) => rank(a) - rank(b) || prioW(a.p.priority) - prioW(b.p.priority) || String(a.p.eta || '9999-12-31').localeCompare(String(b.p.eta || '9999-12-31')));

  const overdue = enr.filter(x => x.f.overdue).length;
  const due = enr.filter(x => x.f.dueNow && !x.f.overdue).length;
  const ok = enr.length - overdue - due;
  // Order-quantity KPIs over the shown lines (respects the filters, same set as the subtotal row).
  const kLines = enr.flatMap(({ p }) => (p.lines || []).filter(lineMatch));
  const totOrder = kLines.reduce((s, l) => s + lTot(l), 0);      // total pcs on order
  const totPend = kLines.reduce((s, l) => s + lPendN(l), 0);      // pcs still pending (Total − India)
  const pendBySku = new Map();                                    // SKU → summed pending qty
  kLines.forEach(l => { const k = String(l.sku || '').toUpperCase(); if (!k) return; pendBySku.set(k, (pendBySku.get(k) || 0) + lPendN(l)); });
  let skuOpen = 0, skuDone = 0;
  pendBySku.forEach(pend => { if (pend > 0) skuOpen++; else skuDone++; });
  const snap = haveFbaSnap();                                    // Replenishment snapshot loaded? (else can't judge listing)
  let skuNotListed = 0;                                          // distinct SKUs on these POs not found on Amazon
  if (snap) pendBySku.forEach((_, k) => { if (FBA_STOCK[k] == null) skuNotListed++; });
  $('fuKpis').innerHTML = `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname">Follow-ups</span><span class="kpiwhen">${nf(enr.length)} ongoing POs</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(enr.length)}</div><div class="l">Total POs</div></div>
      <div class="metric"><div class="v">${nf(totOrder)}</div><div class="l">Total order (pcs)</div></div>
      <div class="metric"><div class="v" style="color:${totPend > 0 ? 'var(--bad)' : '#166534'}">${nf(totPend)}</div><div class="l">Pending (pcs)</div></div>
      <div class="metric"><div class="v" style="color:#92400e">${nf(skuOpen)}</div><div class="l">SKUs order open</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(skuDone)}</div><div class="l">SKUs completed</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${snap ? nf(skuNotListed) : '—'}</div><div class="l">SKUs not listed</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(overdue)}</div><div class="l">Overdue (past ETA)</div></div>
      <div class="metric"><div class="v" style="color:#92400e">${nf(due)}</div><div class="l">Follow-up due</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(ok)}</div><div class="l">On track</div></div>
    </div></div>`;

  // FLAT per-line. Supplier + PO ID are frozen (frz / frz2). Pending = Total Qty − Total FBA Stock − India Stock.
  const cols = ['Supplier', 'PO ID', 'Brand', 'SKU', 'Sub-Category', 'Color Name', 'Size', 'Air Qty', 'Sea Qty', 'Total Qty', 'Total FBA Stock', 'India Stock', 'Pending Qty', 'Mode', 'Order Date', 'Delivery Date', 'Priority', 'ETA in', 'Status', 'Next follow-up', ''];
  const head = '<thead><tr>' + cols.map((h, i) => `<th${i === 0 ? ' class="frz"' : i === 1 ? ' class="frz2"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const body = enr.map(({ p, f }) => {
    const pill = f.overdue ? '<span class="fu fu-red">Overdue</span>' : f.dueNow ? '<span class="fu fu-amber">Due</span>' : '<span class="fu fu-ok">On track</span>';
    const etaTxt = f.etaDays == null ? '<span class="muted">—</span>' : f.etaDays < 0 ? `<span style="color:var(--bad)">${nf(-f.etaDays)}d ago</span>` : `${nf(f.etaDays)}d`;
    const nextTxt = f.next ? `<span${(f.dueNow || f.overdue) ? ' style="color:#92400e;font-weight:700"' : ''}>${esc(f.next)}</span>` : '—';
    return (p.lines || []).map((l, li) => !lineMatch(l) ? '' : `<tr>
      <td class="frz">${esc(p.supplier || '(no supplier)')}</td>
      <td class="frz2" style="font-family:ui-monospace,monospace;font-size:11px" title="${esc(p.id || '')}">${esc(p.id || '—')}</td>
      <td>${BRAND_NAME[p.brand] || p.brand || ''}</td>
      <td style="font-family:ui-monospace,monospace">${esc(l.sku || '')}${(snap && l.sku && !isListed(l.sku)) ? '<br><span class="fu fu-red" title="Not found on Amazon (not in the Replenishment snapshot) — needs a listing">Not listed</span>' : ''}</td>
      <td>${esc(l.subcat || '—')}</td>
      <td>${esc(l.color || '—')}</td>
      <td>${esc(l.size || '—')}</td>
      <td class="num">${numCell(lAir(l))}</td>
      <td class="num">${numCell(lSea(l))}</td>
      <td class="num">${nf(lTot(l))}</td>
      <td class="num" title="Total Stock + AWD Available + AWD Transit (from Replenishment) — how much of this SKU is already at FBA/AWD">${fbaCell(l.sku)}</td>
      <td class="num">${indiaCell(l.sku)}</td>
      <td class="num"${lPend(l) > 0 ? ' style="font-weight:700"' : ' style="color:#166534"'} title="${lPend(l) == null
        ? 'India stock is still being read, so this cannot be worked out yet.'
        : `Total Qty ${nf(lTot(l))} − FBA ${nf(fbaNum(l.sku))} − India ${nf(indiaNum(l.sku))}`}">${
        lPend(l) == null ? '<span class="muted">…</span>' : nf(lPend(l))}</td>
      <td>${p.mode === 'air' ? '<span class="pill pill-air">Air</span>' : '<span class="pill pill-sea">Sea</span>'}</td>
      <td>${esc(p.orderDate || '—')}</td>
      <td>${esc(p.eta || '—')}</td>
      <td>${prioPill(p.priority)}</td>
      <td class="num">${etaTxt}</td>
      <td>${pill}</td>
      <td>${nextTxt}</td>
      <td><button class="xbtn" data-fu="${esc(p.id)}">Log</button> <button class="xbtn" data-open="${esc(p.id)}">Open</button></td>
    </tr>`).join('');
  }).join('');
  // Subtotal row (tinted, pinned at the top of the body) — sums the numeric columns over the shown lines.
  const shown = enr.flatMap(({ p }) => (p.lines || []).filter(lineMatch));
  const sum = fn => shown.reduce((s, l) => s + fn(l), 0);
  const subVals = { 0: 'SUBTOTAL · ' + nf(shown.length), 7: numCell(sum(lAir)), 8: numCell(sum(lSea)), 9: nf(sum(lTot)), 10: nf(sum(l => fbaNum(l.sku))), 11: nf(sum(l => indiaNum(l.sku))), 12: nf(sum(lPend)) };
  const numCols = new Set([7, 8, 9, 10, 11, 12]);
  const subRow = shown.length ? '<tr style="font-weight:700">' + cols.map((h, i) => {
    const cls = (i === 0 ? 'frz ' : i === 1 ? 'frz2 ' : '') + (numCols.has(i) ? 'num' : '');
    return `<td${cls.trim() ? ` class="${cls.trim()}"` : ''} style="background:#eef2ff">${subVals[i] || ''}</td>`;
  }).join('') + '</tr>' : '';
  $('fuTable').innerHTML = head + '<tbody>' + (subRow + body || `<tr><td colspan="${cols.length}" class="muted">No ongoing purchase orders match.</td></tr>`) + '</tbody>';
  setFollowFrz();
  requestAnimationFrame(setFollowFrz);
  $('fuTable').querySelectorAll('[data-fu]').forEach(bn => bn.onclick = () => openFu(bn.dataset.fu));
  $('fuTable').querySelectorAll('[data-open]').forEach(bn => bn.onclick = () => openPoEditor(PO.find(x => x.id === bn.dataset.open), null));
}
// Pin the 2nd frozen column (PO ID) flush against the 1st (Supplier).
function setFollowFrz() {
  const c1 = $('fuTable').querySelector('thead th.frz');
  const w = c1 ? c1.getBoundingClientRect().width : 0;
  if (w) $('fuTable').querySelectorAll('.frz2').forEach(el => { el.style.left = w + 'px'; });
}
['fuSupplier', 'fuPoId', 'fuSubcat', 'fuColor', 'fuListed'].forEach(id => $(id).addEventListener('change', renderFollow));
$('fuSku').addEventListener('input', debounced(renderFollow));

/* ----- follow-up logger ----- */
let FU_PO = null;
function fuErr(t) { const e = $('fuErr'); e.textContent = t || ''; e.classList.toggle('hide', !t); }
function openFu(poId) {
  FU_PO = PO.find(p => p.id === poId); if (!FU_PO) return;
  $('fuPoName').textContent = `${FU_PO.supplier || '(no supplier)'} · ${BRAND_NAME[FU_PO.brand] || FU_PO.brand} · ETA ${FU_PO.eta || '—'}`;
  $('fuDate').value = dToday();
  $('fuNext').value = dAdd(dToday(), FU_EVERY) + `  (in ${FU_EVERY} days)`;
  $('fuNote').value = '';
  fuErr('');
  const fus = (FU_PO.followups || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $('fuHist').innerHTML = fus.length ? '<div class="sec">History</div>' + fus.map(f =>
    `<div style="font-size:12px;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--line)"><b>${esc(f.date)}</b> ${esc(f.note || '')} <span class="muted">${esc(f.by || '')}</span></div>`).join('') : '';
  $('fuModal').classList.remove('hide');
}
$('fuDate').addEventListener('change', () => { const d = $('fuDate').value; $('fuNext').value = d ? dAdd(d, FU_EVERY) + `  (in ${FU_EVERY} days)` : ''; });
$('fuCancel').onclick = () => $('fuModal').classList.add('hide');
$('fuModal').onclick = e => { if (e.target === $('fuModal')) $('fuModal').classList.add('hide'); };
$('fuSaveBtn').onclick = async () => {
  if (!FU_PO) return;
  const date = $('fuDate').value;
  if (!date) { fuErr('Pick a follow-up date.'); return; }
  const entry = { date, note: $('fuNote').value.trim().slice(0, 300), by: ME.email };
  const followups = [...(FU_PO.followups || []), entry];
  try {
    await setDoc(doc(db, 'po', FU_PO.id), { followups }, { merge: true });
    FU_PO.followups = followups;                         // keep the local copy in sync
    $('fuModal').classList.add('hide');
    renderFollow(); updateFollowBadge();
    $('fuMsg').textContent = 'Follow-up saved.'; setTimeout(() => { $('fuMsg').textContent = ''; }, 1500);
  } catch (e) { fuErr('Could not save: ' + (e.message || e)); }
};

/* ----- CSV import / export (Excel-friendly) ----- */
const PO_COLS = ['PO ID', 'Supplier', 'Brand', 'SKU', 'Sub-Category', 'Color', 'Size', 'Air Qty', 'Sea Qty', 'Total Qty', 'Total FBA Stock', 'India Stock', 'Pending Qty', 'Mode', 'Order Date', 'Delivery Date', 'Priority', 'Status', 'Listing'];
/**
 * Which character actually separates the fields.
 *
 * Not always a comma, even in a file named .csv. Excel writes the LIST SEPARATOR from the machine's
 * regional settings — a semicolon wherever the decimal mark is a comma — and "Save As -> Text (Tab
 * delimited)" leaves tabs inside a name that still ends in .csv. Guess wrong and every line becomes
 * ONE field: the header matches nothing, every row is dropped for having no key column, and the
 * screen blames the file's column names while those names were perfectly correct.
 *
 * That is exactly what happened when a colleague could not upload this app's OWN template back into
 * it (2026-08-24) — the packing list said "Matched: nothing" against a header that plainly read
 * Box, SKU, Qty. His copy had been re-saved tab-delimited.
 *
 * Counted OUTSIDE quotes, over the first few lines only, so one product name with a comma in it
 * cannot out-vote the real separator. A tie goes to the comma: that is what every file these apps
 * write uses, so nothing changes for a file that was always fine.
 */
function csvDelimiter(text) {
  const n = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false, lines = 0;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') i++; else inQ = false; } continue; }
    if (c === '"') { inQ = true; continue; }
    if (c === '\n') { lines++; continue; }
    if (n[c] != null) n[c]++;
  }
  let best = ',';
  [';', '\t'].forEach(d => { if (n[d] > n[best]) best = d; });
  return best;
}
function parseCsv(text, delim) {
  const rows = []; let row = [], field = '', inQ = false;
  // The byte-order mark Excel puts at the front lands inside the FIRST header cell, where it
  // stops "Box" being "Box". Every reader here trims, which hides it — dropped once, here.
  text = String(text).replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const D = delim || csvDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === D) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
$('fuExport').onclick = () => {
  const lines = [PO_COLS.map(csvCell).join(',')];
  PO.forEach(p => {
    const bn = BRAND_NAME[p.brand] || p.brand || '', st = PO_STATUS[p.status || 'draft'] || (p.status || '');
    const iv = l => { const v = INDIA_STOCK[String(l.sku || '').toUpperCase()]; return v == null ? '' : v; };
    const fv = l => { const v = FBA_STOCK[String(l.sku || '').toUpperCase()]; return v == null ? '' : v; };
    const lst = l => haveFbaSnap() ? (isListed(l.sku) ? 'Listed' : 'Not listed') : '';
    const emit = l => lines.push([p.id, p.supplier || '', bn, l.sku || '', l.subcat || '', l.color || '', l.size || '', lAir(l), lSea(l), lTot(l), fv(l), iv(l), lPendN(l), p.mode || '', p.orderDate || '', p.eta || '', p.priority || '', st, lst(l)].map(csvCell).join(','));
    if ((p.lines || []).length) p.lines.forEach(emit); else emit({});
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
};
$('fuImport').onclick = () => $('fuFile').click();
$('fuFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { $('fuMsg').textContent = 'File is empty.'; return; }
    const head = rows[0].map(h => h.trim().toLowerCase());
    const gi = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
    const c = { id: gi(['po id']), sup: gi(['supplier']), brand: gi(['brand']), sku: gi(['sku']), sub: gi(['sub-category', 'sub-cat', 'sub category']), color: gi(['color', 'color name']), size: gi(['size']), air: gi(['air qty', 'air']), sea: gi(['sea qty', 'sea']), qty: gi(['total qty', 'qty', 'quantity']), mode: gi(['mode']), od: gi(['order date']), dd: gi(['delivery date', 'eta']), prio: gi(['priority']), st: gi(['status']) };
    if (c.sup < 0 || c.sku < 0) { $('fuMsg').textContent = 'CSV needs at least "Supplier" and "SKU" columns.'; return; }
    const at = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
    const brandCode = bn => { const s = bn.toLowerCase(); return (s === 'ridhi' || s === 'sp') ? 'SP' : (s === 'cpc') ? 'CPC' : (bn || 'SP'); };
    const statusCode = s => { s = s.toLowerCase(); for (const k in PO_STATUS) if (k === s || PO_STATUS[k].toLowerCase() === s) return k; return 'ordered'; };
    const groups = new Map();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]; if (!row.some(x => (x || '').trim())) continue;
      const id = at(row, c.id), sup = at(row, c.sup);
      const od = at(row, c.od), dd = at(row, c.dd);
      const mode = /air/i.test(at(row, c.mode)) ? 'air' : 'sea';
      const prio = (at(row, c.prio) || 'medium').toLowerCase();
      const status = statusCode(at(row, c.st) || 'ordered');
      const key = id || `${sup}|${od}|${dd}|${mode}|${prio}|${status}`;
      if (!groups.has(key)) groups.set(key, { id: id || null, brand: brandCode(at(row, c.brand) || 'SP'), supplier: sup, mode, orderDate: od, eta: dd, priority: prio, status, lines: [] });
      const sku = at(row, c.sku);
      if (sku) {
        const air = Number(at(row, c.air)) || 0, sea = Number(at(row, c.sea)) || 0;
        const qty = (air + sea) > 0 ? air + sea : (Number(at(row, c.qty)) || 0);   // air+sea wins; else the Total column
        groups.get(key).lines.push({ sku, subcat: at(row, c.sub).slice(0, 40), color: at(row, c.color).slice(0, 40), size: at(row, c.size).slice(0, 30), airQty: air, seaQty: sea, qty });
      }
    }
    const list = [...groups.values()].filter(g => g.supplier && g.lines.length);
    if (!list.length) { $('fuMsg').textContent = 'No valid rows found.'; return; }
    const nNew = list.filter(g => !g.id).length, nUpd = list.length - nNew;
    if (!confirm(`Import ${list.length} purchase order(s)? ${nUpd} update existing (matched by PO ID), ${nNew} new. Existing lines are replaced.`)) return;
    $('fuMsg').textContent = 'Importing…';
    for (const g of list) {
      const rec = { brand: g.brand, supplier: g.supplier, mode: g.mode, orderDate: g.orderDate, eta: g.eta, priority: g.priority, status: g.status, lines: g.lines, by: ME.email, at: serverTimestamp() };
      if (g.id) { const ex = PO.find(p => p.id === g.id); rec.followups = (ex && ex.followups) || []; await setDoc(doc(db, 'po', g.id), rec); }
      else { rec.followups = []; await addDoc(collection(db, 'po'), rec); }
    }
    PO_LOADED = false; await loadPo(); PO_LOADED = true; renderFollow(); updateFollowBadge();
    $('fuMsg').textContent = `Imported ${list.length} PO(s).`; setTimeout(() => { $('fuMsg').textContent = ''; }, 2500);
  } catch (err) { $('fuMsg').textContent = 'Import failed: ' + (err.message || err); }
};

