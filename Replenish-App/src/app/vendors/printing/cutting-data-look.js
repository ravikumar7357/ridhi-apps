/* ================= CUTTING DATA, IN THE CUTTING DESK'S LOOK =================
 * Ravi, 25 Nov: "refine the cutting data page according to the cutting desk page", and "yes, build it" on the picture.
 *
 * WHAT IT IS: the same cutting entries, with the same filters, the same Edit and the same Excel, laid out like the Cutting
 * Desk: four tiles (pieces cut, still to issue, cloth used, waste), All / Unused / Partly used / Used as buttons with their
 * counts, and a list of 7 columns in place of 18 — picture, SKU, article,
 * colour, size and fabric in one Item cell; cloth used, waste, its width and its share in one cell — 50 entries a page.
 * The "Cut, not yet issued" view, the "+ New cutting entry" form and the Filters button with its pick-lists are as they were.
 *
 * NOTHING IS STORED OR READ DIFFERENTLY. renderPcut still reads, filters and sorts the entries; this only draws them.
 *
 * WHEN SOMETHING GOES WRONG: nothing here saves, so nothing fails loudly. The switch falls back quietly to the old list
 * and leaves a console line saying why.
 *
 * BEHIND THE CUTTING DESK'S SWITCH (cdkSwitchOn, flow-cutting-desk.js): off for everybody, on for a branch's test link, the
 * TEST ERP and localhost. The way back is localStorage cuttingDesk = '0' on one PC. */
const PCD_PAGE = 50;
const PCD_USES = [['', 'All'], ['unused', 'Unused'], ['part', 'Partly used'], ['used', 'Used']];
const PCD = { page: 0, picked: '', ready: false };

/** Is the new look on for this PC? It follows the Cutting Desk's switch; if that cannot be asked, the old list stays. */
function pcdOn() {
  try { return typeof cdkSwitchOn === 'function' && cdkSwitchOn(); }
  catch (e) { console.warn('Cutting Data: the Cutting Desk switch could not be read, so the old list is shown.', e); return false; }
}

/* ---- the figures ---- */
/** The four tiles, over the entries the filters leave. issued and left are null until the Job Work Register is read.
 *  Cloth and waste are counted over the entries that carry a measured figure, as the old cards did. */
function pcdTotals(rows, useOf) {
  const t = { entries: rows.length, pieces: 0, issued: null, left: null, measured: 0, used: 0, waste: 0, pct: 0 };
  rows.forEach(r => {
    t.pieces += ptNum(r.pieces);
    const u = useOf ? useOf(r) : null;
    if (u) { t.issued = (t.issued || 0) + u.used; t.left = (t.left || 0) + Math.max(0, u.net - u.used); }
    if (ptNum(r.fabricUsed) > 0) { t.measured++; t.used += ptNum(r.fabricUsed); t.waste += ptNum(r.fabricWaste); }
  });
  t.pct = t.used > 0 ? (t.waste / t.used) * 100 : 0;
  return t;
}
/** How many entries are unused, partly used and used; null until the Job Work Register is read. */
function pcdUseCounts(rows, kindOf) {
  if (!kindOf) return null;
  const n = { '': rows.length, unused: 0, part: 0, used: 0 };
  rows.forEach(r => { const k = kindOf(r); if (k) n[k]++; });
  return n;
}
/** One page of the list; a page past the end falls back to the last one. */
function pcdPageOf(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / PCD_PAGE)), at = Math.min(Math.max(0, page | 0), pages - 1);
  return { at, pages, from: at * PCD_PAGE, rows: rows.slice(at * PCD_PAGE, (at + 1) * PCD_PAGE) };
}

/* ---- the page ---- */
function pcdTopHtml(t, counts, picked) {
  const tile = (name, big, small, red) => `<div class="card" style="flex:1 1 180px;padding:10px 14px;margin:0"><div class="muted" style="font-size:12px">${name}</div>`
    + `<div style="font-size:22px;font-weight:700${red ? ';color:var(--bad)' : ''}">${big}</div><div class="muted" style="font-size:12px">${small}</div></div>`;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;width:100%">`
    + tile('Pieces cut', nf(t.pieces), 'in ' + nf(t.entries) + ' entr' + (t.entries === 1 ? 'y' : 'ies'))
    + tile('Still to issue', t.left == null ? '—' : nf(t.left) + ' pcs', t.issued == null ? 'reading the Job Work Register…' : nf(t.issued) + ' issued')
    + tile('Cloth used', t.used ? nf(Math.round(t.used)) + ' m' : '—', nf(t.measured) + ' of ' + nf(t.entries) + ' measured')
    + tile('Waste', t.waste ? nf(Math.round(t.waste * 10) / 10) + ' m' : '—', t.used ? t.pct.toFixed(1) + '% of cloth used' : 'nothing measured', t.pct > 10) + '</div>'
    + `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px;width:100%">`
    + PCD_USES.map(([k, l]) => `<button type="button" data-pcduse="${k}" class="${k === picked ? '' : 'ghost'}" style="width:auto;padding:5px 14px;font-size:13px">${l}`
      + (counts ? ` <b style="margin-left:4px">${nf(counts[k])}</b>` : '') + '</button>').join('') + '</div>';
}
/** Picture, SKU, then article · colour · size, the fabric, and the remarks where there are any — in one cell. */
function pcdItemHtml(r) {
  const under = [[r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · '), r.fabricWidth].filter(Boolean);
  return `<div style="display:flex;gap:10px;align-items:center">${typeof ptImgSpan === 'function' ? ptImgSpan(r.sku, 40) : ''}<div style="line-height:1.5;white-space:normal">`
    + `<b style="font-family:ui-monospace,monospace">${esc(r.sku)}</b>${under.map(t => `<div class="muted" style="font-size:12px">${esc(t)}</div>`).join('')}`
    + (r.remarks ? `<div style="font-size:12px;font-style:italic">${esc(r.remarks)}</div>` : '') + '</div></div>';
}
/** Cloth used, and under it the waste, its width and its share. An entry nobody measured says so; it is never a nought. */
function pcdClothHtml(r) {
  const used = ptNum(r.fabricUsed), waste = ptNum(r.fabricWaste), wide = ptNum(r.fabricWasteWidth);
  if (!(used > 0) && !(waste > 0)) return '<span class="muted">not measured</span>';
  const share = used > 0 && waste > 0 ? waste / used : 0;
  const second = waste > 0 ? [nf(waste) + ' m waste', wide > 0 ? nf(wide) + '"' : '', share ? (share * 100).toFixed(1) + '%' : ''].filter(Boolean).join(' · ') : 'no waste entered';
  return (used > 0 ? nf(used) + ' m used' : '<span class="muted">cloth not measured</span>')
    + `<div style="font-size:12px${share > 0.1 ? ';color:var(--bad)' : ''}" class="${share > 0.1 ? '' : 'muted'}">${second}</div>`;
}
function pcdTableHtml(rows, pillOf, mayEdit) {
  const head = '<thead><tr>' + ['Cut date', 'Item', 'Pieces', 'Issued', 'Cloth and waste', 'Cut by', ''].map((h, i) => `<th${i === 2 ? ' class="num"' : ' style="text-align:left"'}>${h}</th>`).join('') + '</tr></thead>';
  if (!rows.length) return head + '<tbody><tr><td colspan="7" class="muted" style="padding:16px">No cutting entry fits these filters.</td></tr></tbody>';
  return head + '<tbody>' + rows.map(r => `<tr><td style="text-align:left">${esc(String(r.cutDate || '').split(',')[0])}`
    + `<div class="muted" style="font-size:12px">${esc(r.orderNo) || 'no order'}</div></td>`
    + `<td style="text-align:left">${pcdItemHtml(r)}</td><td class="num" style="font-weight:700">${nf(ptNum(r.pieces))}</td>`
    + `<td style="text-align:left">${pillOf(r) || '<span class="muted">—</span>'}</td><td style="text-align:left">${pcdClothHtml(r)}</td>${whoCell(r)}`
    + `<td>${mayEdit ? `<button class="ghost" data-cut-edit="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button>` : ''}</td></tr>`).join('') + '</tbody>';
}
function pcdPagerHtml(pg, total) {
  const shown = total ? `Showing ${nf(pg.from + 1)} to ${nf(pg.from + pg.rows.length)} of ${nf(total)}, newest first · Export covers all of them` : '';
  const btn = (step, label, off) => `<button type="button" class="ghost" data-pcdpage="${step}" style="width:auto;padding:5px 14px;font-size:13px"${off ? ' disabled' : ''}>${label}</button>`;
  return `<div style="display:flex;gap:8px;align-items:center;margin-top:10px"><span class="muted" style="font-size:12.5px">${shown}</span><span style="flex:1"></span>`
    + (pg.pages > 1 ? btn(-1, 'Previous', pg.at === 0) + btn(1, 'Next', pg.at >= pg.pages - 1) : '') + '</div>';
}

/** Once, the first time the list is drawn: the place for the pages, and the clicks. */
function pcdSetup() {
  if (PCD.ready) return;
  PCD.ready = true;
  $('pcUse').style.display = 'none';   // its four choices are the buttons under the tiles
  $('pcTable').parentElement.insertAdjacentHTML('afterend', '<div id="pcdPager"></div>');
  /* If the Cutting Desk tab is already open, the list is set aside (fl-embhide): the pages go with it, not under the desk. */
  $('pcdPager').classList.toggle('fl-embhide', $('pcTable').parentElement.classList.contains('fl-embhide'));
  $('pcKpis').addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-pcduse]'); if (!b) return; $('pcUse').value = b.dataset.pcduse; renderPcut(); });
  $('pcdPager').addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-pcdpage]'); if (!b) return; PCD.page += +b.dataset.pcdpage; renderPcut(); });
}

/** Draws Cutting Data's entries in the new look. rows: what every filter leaves; beforeUse: the same before the
 *  Unused / Partly / Used pick, for the counts on its buttons; total: every entry read. */
function pcdRender(rows, beforeUse, total) {
  pcdSetup();
  const useOn = !!pcutUseMap(), useSel = $('pcUse').value || '';
  const picked = JSON.stringify([pcutFilters(), useSel]);
  if (picked !== PCD.picked) { PCD.picked = picked; PCD.page = 0; }   // a changed filter starts again from the first page
  const pg = pcdPageOf(rows, PCD.page);
  PCD.page = pg.at;
  $('pcKpis').innerHTML = pcdTopHtml(pcdTotals(rows, useOn ? pcutUseOf : null), pcdUseCounts(beforeUse, useOn ? r => pcutUseKind(pcutUseOf(r)) : null), useSel);
  $('pcTable').innerHTML = pcdTableHtml(pg.rows, pcutUsePill, ptCanEdit());
  $('pcdPager').innerHTML = pcdPagerHtml(pg, rows.length);
  $('pcMsg').className = 'muted';
  $('pcMsg').textContent = `${nf(rows.length)} of ${nf(total)} cut entr${total === 1 ? 'y' : 'ies'}`;
  ptImgFill(pg.rows.map(r => r.sku), false, ptIfTab('pcut', ptImgPatch));
}
