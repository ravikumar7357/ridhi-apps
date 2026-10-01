/* ================= ARTICLE REVIEW =================
 *
 * One row per SKU, laid out like the sheet this replaces, so a listing can be reviewed article by
 * article: what is on the shelf, how long it lasts, and a Remark you can write straight into.
 *
 * The Remark is the SAME field the Top ASIN tab edits, in the same document. Two remark boxes with
 * two stores would drift apart within a week and neither would be believed.
 */
const AR_BANDS = [15, 30, 45, 60];

/* Discontinued and use-in-mix SKUs are LEFT OUT of Article Review (Ravi, 2026-08-24).
 *
 * This tab exists to decide what to DO about an article — a priority, a remark, a quantity to make.
 * A SKU nobody is selling any more has no decision left in it, and it was not merely sitting there:
 * it was counted in the cover bands and the priority buttons above the table, so every one of those
 * numbers was inflated by stock nobody will ever reorder.
 *
 * DROPPED FROM THIS TAB, NOT HIDDEN AWAY. The count is printed under the table, and every one of
 * them is still on the Replenishment grid, tagged "Stopped", with its Remark and MOM log untouched —
 * so nothing anybody typed becomes unreachable. `applyStatus` has to run FIRST: `stopped` is worked
 * out from the India listing status and the manual override, and neither is on the raw row. */
let AR_STOPPED = 0;
function articleRowsFull() {
  const pick = $('arBrand').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => REPL[b]);
  const rows = dropOutOfScope(brands.flatMap(b => (REPL[b].rows || []).map(r => ({ ...r, brand: b }))));
  rows.forEach(r => { applyStatus(r); r._state = stockState(r); });
  const live = rows.filter(r => !r.stopped);
  AR_STOPPED = rows.length - live.length;
  return live;
}

function renderArticle() {
  const all = articleRowsFull();
  if (!all.length) {
    $('arTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">'
      + (ACCESS_ERR ? esc(ACCESS_ERR)
        // "No snapshot yet" would be a lie when the snapshot is fine and every SKU in it is stopped.
        : AR_STOPPED ? `Every SKU here is discontinued or use-in-mix (${nf(AR_STOPPED)}), so there is nothing to review. They are still on the Replenishment grid, tagged “Stopped”.`
        : 'No snapshot yet — open Replenishment and hit “Refresh from sheet”.') + '</td></tr></tbody>';
    $('arMsg').textContent = '';
    return;
  }
  msFill('arSub', all.map(r => r.subcat));

  const sold90 = r => (Number(r.last90) || 0) > 0;
  // Counted over everything on this tab, before the band is applied, so each button says what it
  // would give. Same single-bucket rule as the Replenishment grid — no SKU in two places.
  const counts = {};
  const coverBase = all.filter(r => msHas('arSub', r.subcat));
  coverBase.forEach(r => { const k = coverBucket(r, sold90); counts[k] = (counts[k] || 0) + 1; });
  const LABEL = { '': 'All', outsell: 'Out · sold in 90d', outdead: 'Out · no sale 90d',
    '15': '1–15 d', '30': '16–30 d', '45': '31–45 d', '60': '46–60 d', ok: '60 d+' };
  $('arCoverSeg').querySelectorAll('[data-cover]').forEach(b => {
    const k = b.dataset.cover;
    b.textContent = `${LABEL[k]} · ${nf(k === '' ? coverBase.length : (counts[k] || 0))}`;
    b.classList.toggle('on', k === AR_COVER);
  });

  const q = $('arFilter').value.trim().toLowerCase();
  // The BASE both button rows count over: the article and text filters applied, the two band rows
  // not. So picking "Round Tablecloth" makes every button show that article's own numbers, while
  // the two rows stay independent of each other and cannot chase each other's counts around.
  const base = all.filter(r => msHas('arSub', r.subcat)
    && (!q || ((r.sku || '') + ' ' + (r.asin || '') + ' ' + (r.parent || '')
      + ' ' + (r.color || '') + ' ' + (r.size || '') + ' ' + (r.subcat || '')).toLowerCase().includes(q)));

  const prioCounts = {};
  base.forEach(r => { const p = priorityOf(r).p; prioCounts[p] = (prioCounts[p] || 0) + 1; });
  $('arPrioSeg').querySelectorAll('[data-prio]').forEach(b => {
    const k = b.dataset.prio;
    const label = k === '' ? 'All' : k === '—' ? 'None' : k;
    b.textContent = `${label} · ${nf(k === '' ? base.length : (prioCounts[k] || 0))}`;
    b.classList.toggle('on', k === AR_PRIO);
  });

  let rows = base;
  if (AR_COVER) rows = rows.filter(r => coverBucket(r, sold90) === AR_COVER);
  if (AR_PRIO) rows = rows.filter(r => priorityOf(r).p === AR_PRIO);

  // Article first, then the emptiest inside it — reviewing a range means walking it in order, with
  // the ones that need a decision at the top of each group.
  // Article first, then the most urgent inside it. Priority rather than raw cover, so a SKU with a
  // container behind it does not sit above one with nothing coming.
  const prank = r => { const p = priorityOf(r).p; const i = PRIO_ORDER.indexOf(p); return i < 0 ? (p === 'Excess' ? 5 : 6) : i; };
  rows.sort((a, b) => String(a.subcat || '').localeCompare(String(b.subcat || ''))
    || prank(a) - prank(b)
    || (a.coverDos == null ? 1e9 : a.coverDos) - (b.coverDos == null ? 1e9 : b.coverDos)
    || String(a.sku).localeCompare(String(b.sku)));

  AR_LAST = rows;
  const CAP = 300;
  const shown = rows.slice(0, CAP);

  const head = '<thead><tr>'
    + '<th title="P1 under 20 days of cover · P2 20-40 · P3 40-60 · P4 over 60 · Excess over 120. '
      + 'Stock already on the way moves it one step down for every 30 days it covers. Hover a cell for its own reasoning.">Priority</th>'
    + '<th class="frz">SKU</th><th>Image</th><th>ASIN</th><th>Parent ASIN</th>'
    + '<th>Color</th><th>Size</th><th>Sub-Category</th>'
    + '<th class="num">Total Stock</th><th class="num">Warehouse</th><th class="num">Fulfillable</th>'
    + '<th class="num" title="Available at AWD">AWD</th><th class="num" title="In transit to AWD">AWD in transit</th>'
    + '<th class="num" title="Full-pipeline days of cover ÷ run rate.">Cover (d)</th>'
    + '<th class="num">L30</th><th class="num">L90</th>'
    + '<th class="num" title="Units held in India stock.">India</th>'
    + '<th class="num" title="Units to send. The greyed number is the projected requirement — air + sea + AWD '
      + 'top-up, already net of everything on the way. Type over it to set your own; blank goes back to the projection.">Req. Qty</th>'
    + '<th title="Minutes of meeting. Every note is kept with its date and who wrote it — nothing is overwritten.">MOM</th>'
    + '<th>Remark</th></tr></thead>';

  const num = v => (v == null || v === '' ? '<span class="muted">—</span>' : nf(v));
  const body = shown.map(r => {
    const iv = INDIA_STOCK[String(r.sku).toUpperCase()];
    const cov = r.coverDos;
    const pr = priorityOf(r);
    const rq = reqSuggest(r);
    return `<tr${r.stopped ? ' style="opacity:.55"' : ''}>`
      // The worked-out priority is shown as a pill, with a small box beside it to overrule it.
      // Overruling is a judgement the numbers cannot make — a launch, a promotion, a promise to a
      // customer — so it is left in, and it says which one is which rather than quietly replacing it.
      + `<td style="white-space:nowrap">${prioPillHtml(pr, esc)}`
        + `<input class="arPr" list="arPrList" data-sku="${esc(r.sku)}" maxlength="8"`
        + ` title="Type to overrule. Blank = the worked-out one." placeholder="auto"`
        + ` value="${esc(PRIO_OVR[skuKey(r.sku)] || '')}"`
        + ` style="width:52px;margin-left:6px;text-align:center"></td>`
      + `<td class="frz" style="font-weight:600">${esc(r.sku)}</td>`
      + `<td>${r.image ? `<img class="thumb" src="${esc(thumbUrl(r.image))}" loading="lazy" decoding="async">` : '<span class="muted">—</span>'}</td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(r.asin || '—')}</td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(r.parent || '—')}</td>`
      + `<td>${esc(r.color || '—')}</td><td>${esc(r.size || '—')}</td><td>${esc(r.subcat || '—')}</td>`
      + `<td class="num">${num(r.totalStock)}</td>`
      + `<td class="num">${num(r.warehouse)}</td>`
      + `<td class="num"${!(r.fulfillable > 0) ? ' style="color:var(--bad);font-weight:700"' : ''}>${num(r.fulfillable)}</td>`
      + `<td class="num">${num(r.awdAvail)}</td><td class="num">${num(r.awdTransit)}</td>`
      + `<td class="num">${cov == null ? '<span class="muted">—</span>'
          : (cov < 30 ? `<span style="color:var(--bad);font-weight:700">${nf(cov)}</span>` : nf(cov))}</td>`
      + `<td class="num">${num(r.last30)}</td><td class="num">${num(r.last90)}</td>`
      + `<td class="num">${iv == null ? '<span class="muted">—</span>' : (typeof iv === 'number' ? nf(iv) : esc(String(iv)))}</td>`
      // Same idea as the Remark box: the projection stands in the placeholder, so an empty cell still
      // shows what the app would send, and a typed number is visibly a decision rather than a default.
      + `<td class="num"><input class="arRq" type="number" min="0" step="1" inputmode="numeric"`
        + ` data-sku="${esc(r.sku)}" placeholder="${rq.tot}"`
        + ` title="${esc(rq.split ? `Projected: ${rq.split}` : 'Nothing projected for this SKU.')}"`
        + ` value="${REQ_QTY[skuKey(r.sku)] ?? ''}"></td>`
      // Always a dropdown here, not a pill you have to click first. This tab exists to review and
      // decide, so the decision should be one click, not two.
      // Latest note plus a button for the rest. The whole history in a grid cell would bury the row;
      // the last thing said is what you need at a glance, and the modal holds the trail.
      + `<td class="mom-cell" data-sku="${esc(r.sku)}">${momCellHtml(r.sku, esc)}</td>`
      // The placeholder is the app's own suggested remark, so an empty box still tells you what it
      // would have said — and typing over it is an explicit choice, not a blank page.
      + `<td class="rmk-cell"><textarea class="rmkbox" data-sku="${esc(r.sku)}" rows="2" placeholder="${esc(suggestRemark(r))}">${esc(REMARK[r.sku] || '')}</textarea></td>`
      + '</tr>';
  }).join('');

  $('arTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="20" class="muted" style="padding:14px">Nothing matches these filters.</td></tr>') + '</tbody>';

  const empties = rows.filter(r => !(r.fulfillable > 0)).length;
  /* The count, and the one figure that asks for a decision. Everything else is in the tooltip. */
  $('arMsg').title = `${nf(rows.length)} SKU(s) shown`
    + (rows.length > CAP ? ` · only the first ${CAP} are drawn — narrow the filters to see the rest` : '')
    + (US_HIDDEN ? ` · ${nf(US_HIDDEN)} non-US SKU(s) hidden` : '')
    + (AR_STOPPED ? ` · ${nf(AR_STOPPED)} discontinued SKU(s) left out — there is no decision left to make on them; they are still on the Replenishment grid, tagged Stopped` : '')
    + ' · remarks and Req. Qty save as you leave the box, and are the same remarks the Top ASIN tab shows';
  $('arMsg').innerHTML = `${nf(rows.length)} SKU(s) · <b>${nf(empties)} with nothing fulfillable</b>`
    + (rows.length > CAP ? ` · first ${CAP}` : '')
    + (usNote() ? ' · ' + usNote() : '')
;
}

/* Remark: an always-editable textarea saved on blur. Deliberately no re-render on save — redrawing
 * the table under somebody's cursor throws away what they are typing in the next box. */
$('arTable').addEventListener('change', async e => {
  // Status first — same override the Replenishment grid writes, same document, so a SKU stopped
  // here is stopped there. PROJ_VER is bumped because "stopped" feeds the forecast cache.
  const pr = e.target.closest('.arPr');
  if (pr) {
    const skuU = skuKey(pr.dataset.sku);
    const val = pr.value.trim().toUpperCase().replace(/^P?([1-4])$/, 'P$1');
    if (val && !['P1', 'P2', 'P3', 'P4', 'EXCESS'].includes(val)) {
      $('arMsg').textContent = `"${pr.value}" is not a priority — use P1…P4 or Excess, or leave it blank.`;
      pr.value = PRIO_OVR[skuU] || '';
      return;
    }
    const clean = val === 'EXCESS' ? 'Excess' : val;
    if (clean) PRIO_OVR[skuU] = clean; else delete PRIO_OVR[skuU];
    R_VER++;                                   // priority feeds applyStatus, so the walk must run again
    try { await setDoc(doc(db, 'repl', 'prodstatus'), { prioOverride: { [skuU]: clean || null } }, { merge: true }); renderArticle(); }
    catch (err) { $('arMsg').textContent = 'Could not save priority: ' + (err.message || err); }
    return;
  }
  // Req. Qty — whole units only. A typed figure becomes a shipping instruction, so a stray "12.5" or
  // a minus sign is refused outright rather than rounded into something nobody chose.
  const rq = e.target.closest('.arRq');
  if (rq) {
    const skuU = skuKey(rq.dataset.sku);
    const raw = rq.value.trim();
    if (raw !== '' && !/^\d+$/.test(raw)) {
      $('arMsg').textContent = `"${rq.value}" is not a quantity — whole units only, or leave it blank for the projection.`;
      rq.value = REQ_QTY[skuU] ?? '';
      return;
    }
    const n = raw === '' ? null : Number(raw);
    if (n == null) delete REQ_QTY[skuU]; else REQ_QTY[skuU] = n;
    R_VER++;                                   // a typed quantity replaces the projection in the walk
    try { await setDoc(doc(db, 'repl', 'prodstatus'), { reqQty: { [skuU]: n } }, { merge: true }); }
    catch (err) { $('arMsg').textContent = 'Could not save Req. Qty: ' + (err.message || err); }
    return;
  }
  const box = e.target.closest('.rmkbox'); if (!box) return;
  const sku = box.dataset.sku, val = box.value.trim().slice(0, 400);
  if (val) REMARK[sku] = val; else delete REMARK[sku];
  try { await setDoc(doc(db, 'repl', 'prodstatus'), { remark: { [sku]: val || null } }, { merge: true }); }
  catch (err) { $('arMsg').textContent = 'Save failed: ' + (err.message || err); }
});

$('arPrioSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-prio]');
  if (!b) return;
  // Clicking the one that is already on turns it off, same as the band above — otherwise the only
  // way back is the All button and somebody filtered to P1 wonders where the rest went.
  AR_PRIO = (b.dataset.prio === AR_PRIO) ? '' : b.dataset.prio;
  renderArticle();
});
$('arCoverSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-cover]');
  if (!b) return;
  AR_COVER = (b.dataset.cover === AR_COVER) ? '' : b.dataset.cover;
  renderArticle();
});
$('arBrand').addEventListener('change', renderArticle);
let AR_FT = null;
$('arFilter').addEventListener('input', () => { clearTimeout(AR_FT); AR_FT = setTimeout(renderArticle, 250); });

$('arCsv').onclick = () => {
  if (!AR_LAST.length) return;
  const cols = ['Priority', 'SKU', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category', 'Total Stock',
    'Warehouse', 'Fulfillable', 'AWD', 'AWD in transit', 'Cover (d)', 'Transit days', 'L30', 'L90',
    'India', 'Req. Qty', 'Req. Qty (projected)', 'MOM (latest)', 'MOM (all notes)', 'Remark'];
  const lines = [cols.map(csvCell).join(',')];
  AR_LAST.forEach(r => {
    const iv = INDIA_STOCK[String(r.sku).toUpperCase()];
    const pr = priorityOf(r);
    // Both numbers go out: the one to act on, and the projection it was judged against. A single
    // column would not say whether a figure was typed or calculated.
    const rqs = reqSuggest(r), rqv = REQ_QTY[skuKey(r.sku)];
    lines.push([pr.p, r.sku, r.asin || '', r.parent || '', r.color || '', r.size || '', r.subcat || '',
      r.totalStock ?? '', r.warehouse ?? '', r.fulfillable ?? '', r.awdAvail ?? '', r.awdTransit ?? '',
      r.coverDos == null ? '' : r.coverDos, pr.transitDays ?? '', r.last30 ?? '', r.last90 ?? '',
      iv == null ? '' : iv,
      rqv ?? rqs.tot, rqs.tot,
      (momLatest(r.sku) || {}).note || '',
      momLog(r.sku).map(e => `${e.d}: ${e.note}`).join(' | '),
      // Exports what the screen shows: the typed remark, or the suggestion standing in for it.
      REMARK[r.sku] || suggestRemark(r) || ''].map(csvCell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const bits = ['article-review'];
  const subs = msVals('arSub');
  if (subs.length === 1) bits.push(subs[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  else if (subs.length) bits.push(subs.length + '-articles');
  if (AR_PRIO) bits.push(AR_PRIO === '—' ? 'no-priority' : AR_PRIO.toLowerCase());
  if (AR_COVER) bits.push(AR_COVER === 'ok' ? 'over-60d' : AR_COVER);
  bits.push(new Date().toISOString().slice(0, 10));
  a.download = bits.join('-').replace(/-+/g, '-') + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
};

