/* ---------- completed deals ============================================================
 *
 * Nothing here is a new store. Every plan ever typed is ALREADY in `D_PLAN`, keyed by the week it
 * starts in, and `saveDeals` has always written the whole map — so no history was ever lost. What
 * was missing is a way to SEE it: `dPlanWeeks()` starts at the current week, so the moment a deal's
 * week passes it falls off the left edge of the grid, out of the KPIs and out of the export.
 *
 * "Completed" means the run has ENDED — span.end is before today. A deal that started last month
 * and is still live is deliberately NOT here; it is still on the planner, where it belongs.
 */

/** parent ASIN → brand, from Listing Health first and the latest BSR snapshot second. */
function dBrandOf() {
  const m = new Map();
  myBrands().forEach(b => {
    (HEALTH[b]?.rows || []).forEach(r => {
      const p = String(r.parent || r.asin || '').trim().toUpperCase();
      if (p && !m.has(p)) m.set(p, b);
    });
    const weeks = Object.keys(BSR[b] || {}).sort();
    Object.keys((BSR[b] || {})[weeks[weeks.length - 1]] || {}).forEach(p => {
      const k = String(p).trim().toUpperCase();
      if (k && !m.has(k)) m.set(k, b);
    });
  });
  return m;
}

function dDoneRows() {
  const today = sdToday();
  const brand = $('dBrand').value, q = $('dFilter').value.trim().toLowerCase();
  const back = Number($('dDoneWeeks').value) || 0;          // 0 = no cut-off, show everything
  const from = back ? sdShift(dSunday(Date.now()), -back * 7) : '';
  const bmap = dBrandOf();
  const out = [];
  Object.entries(D_PLAN).forEach(([k, p]) => {
    if (!p || !p.t) return;
    // Parent ASINs contain no "|", but split from the RIGHT anyway so the week is always the tail.
    const i = k.lastIndexOf('|');
    if (i < 0) return;
    const parent = k.slice(0, i), week = k.slice(i + 1);
    const span = dPlanSpan(week, p);
    if (span.end >= today) return;                          // still running, or yet to start
    if (from && span.end < from) return;
    // A parent that has since left the catalogue has no brand. It is kept under "Both brands" —
    // the deal was still run — but a brand filter cannot honestly claim it.
    const b = bmap.get(parent) || '';
    if (brand !== 'ALL' && b !== brand) return;
    const name = (b && parentName(b, parent, '')) || '';
    if (q && !(parent + ' ' + name).toLowerCase().includes(q)) return;
    out.push({ key: k, parent, week, brand: b, name, p, span });
  });
  // Most recently finished first — that is what somebody looking back wants at the top.
  out.sort((a, b2) => b2.span.end.localeCompare(a.span.end) || a.parent.localeCompare(b2.parent));
  return out;
}

function renderDoneKpis(rows) {
  const nf = v => Math.round(v || 0).toLocaleString('en-US');
  const byType = {}; const parents = new Set();
  let discSum = 0, discN = 0;
  rows.forEach(r => {
    byType[r.p.t] = (byType[r.p.t] || 0) + 1;
    parents.add(r.parent);
    if (r.p.v) { discSum += Number(r.p.v); discN++; }
  });
  const days = rows.reduce((s, r) => s + r.span.days, 0);
  const tile = (label, val, colour) => `<div class="metric"><div class="v"${colour ? ` style="color:${colour}"` : ''}>${val}</div><div class="l">${label}</div></div>`;
  const window = Number($('dDoneWeeks').value) ? `last ${$('dDoneWeeks').value} weeks` : 'everything ever run';
  $('dDoneKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Completed deals — ${window}</span>
      <span class="kpiwhen">${rows.length ? rows[0].span.end + ' back to ' + rows[rows.length - 1].span.end : 'nothing finished yet'}</span></div>
    <div class="metrics">
      ${tile('Deals finished', nf(rows.length))}
      ${tile('Parents involved', nf(parents.size))}
      ${tile('Days of discount', nf(days))}
      ${tile('Average discount', discN ? Math.round(discSum / discN) + '%' : '—')}
      ${tile('PED', nf(byType.PED || 0), '#1e40af')}
      ${tile('COUPON', nf(byType.COUPON || 0), '#166534')}
      ${tile('DEAL', nf((byType.DEAL || 0) + (byType['BEST DEAL'] || 0) + (byType.LIGHTNING || 0)), '#92400e')}
      ${tile('Price disc.', nf(byType['PRICE DISC'] || 0), '#5b21b6')}
    </div></div>`;
}

function renderDone() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const rows = dDoneRows();
  renderDoneKpis(rows);
  const head = '<thead><tr><th>Ran</th><th class="num">Days</th><th>Parent ASIN</th><th>Image</th>'
    + '<th>Product</th><th>Brand</th><th>Type</th><th class="num">Disc %</th><th>Run by</th></tr></thead>';
  const body = rows.slice(0, 400).map(r => {
    const [bg, fg] = (D_PLAN_COLOUR[r.p.t] || '#f1f5f9|#334155').split('|');
    const img = D_IMG[r.parent];
    return `<tr data-dd="${esc(r.key)}" style="cursor:pointer" title="Click to open this deal — the same box as the planner, so a wrong entry can still be corrected.">`
      + `<td style="white-space:nowrap">${esc(r.span.start)} → ${esc(r.span.end)}</td>`
      + `<td class="num">${r.span.days}</td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(r.parent)}</td>`
      + `<td style="padding:2px 6px">${img
          ? `<img src="${esc(dThumb(img))}" loading="lazy" decoding="async" style="width:30px;height:30px;object-fit:cover;border-radius:5px;background:#f1f5f9" alt="">`
          : '<span class="muted" style="font-size:11px">—</span>'}</td>`
      + `<td title="${esc(r.name)}">${esc(String(r.name).slice(0, 40)) || '<span class="muted">—</span>'}</td>`
      + `<td>${r.brand ? esc(BRAND_NAME[r.brand] || r.brand) : '<span class="muted">—</span>'}</td>`
      + `<td><span style="background:${bg};color:${fg};font-weight:700;font-size:11.5px;padding:2px 7px;border-radius:5px">${esc(r.p.t)}</span></td>`
      + `<td class="num">${r.p.v ? r.p.v + '%' : '<span class="muted">—</span>'}</td>`
      + `<td>${r.p.by ? esc(r.p.by) : '<span class="muted">nobody recorded</span>'}</td></tr>`;
  }).join('');
  $('dDoneTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="9" class="muted" style="padding:14px">Nothing has finished in this window yet. Plans are kept forever — widen the range, or clear the brand and text filters.</td></tr>')
    + '</tbody>';
  dMsg(rows.length > 400
    ? `${rows.length} finished deal(s) · showing the 400 most recent · Export covers all of them.`
    : `${rows.length} finished deal(s) · click a row to open it.`);
}

$('dDoneTable').addEventListener('click', e => {
  const tr = e.target.closest('[data-dd]'); if (!tr) return;
  dPlanOpen(tr.dataset.dd);
});
$('dDoneWeeks').addEventListener('change', renderDone);

