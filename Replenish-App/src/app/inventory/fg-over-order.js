/* ================= FINISHED GOODS: MORE CAME IN THAN THE ORDER ASKED FOR =================
 *
 * A receipt against an Order Console order that takes the order past what it asked for is saved with
 * overQty (the extra pieces), overOrdered, overReason (required at entry) and overStatus 'open'. It
 * shows in "Received more than ordered", and as a purple count in the sidebar, for anybody who can edit
 * finished goods — until one of them marks it reviewed. The pieces stay in stock either way: extra is
 * real stock, the flag is about knowing why it exists.
 */
const fgiOverOpen = () => (FGI.rows || []).filter(r => r && r.txnType === 'RECEIVE' && fgiNum(r.overQty) > 0 && r.overStatus === 'open');

function fgiOverBadge() {
  const el = $('fgiOverBadge'); if (!el) return;
  const n = fgiCanEdit() ? fgiOverOpen().length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

function fgiRenderOver() {
  const all = (FGI.rows || []).filter(r => r && r.txnType === 'RECEIVE' && fgiNum(r.overQty) > 0)
    .sort((a, b) => (a.overStatus === 'open' ? 0 : 1) - (b.overStatus === 'open' ? 0 : 1) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  FGI.shown = all;
  const can = fgiCanEdit();
  const head = '<thead><tr>' + ['When', 'SKU', 'Image', 'Order', 'Ordered', 'This receipt', 'Extra', 'Why', 'By', 'Status', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 4 && i <= 6 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + (all.length ? all.map(r => '<tr>'
    + `<td class="frz">${esc(String(r.createdAt || '').slice(0, 16).replace('T', ' '))}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(obUC(r.sku))}</td>`
    + ptImgCell(r.sku)
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.orderNo || '')}</td>`
    + `<td class="num">${nf(fgiNum(r.overOrdered))}</td>`
    + `<td class="num">${nf(fgiNum(r.qty))}</td>`
    + `<td class="num" style="font-weight:700;color:var(--bad)">${nf(fgiNum(r.overQty))}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:260px">${esc(r.overReason || '')}</td>`
    + `<td>${esc(String(r.createdBy || '').split('@')[0])}</td>`
    + `<td>${r.overStatus === 'open' ? '<span class="pill pill-out">to review</span>'
      : `<span class="pill pill-ok">reviewed</span><div class="muted" style="font-size:10.5px">${esc(String(r.overReviewedBy || '').split('@')[0])}</div>`}</td>`
    + `<td>${can && r.overStatus === 'open' ? `<button class="ghost" data-fgoverok="${esc(fgiRowId(r))}" style="padding:2px 9px;font-size:12px">Mark reviewed</button>` : ''}</td>`
    + '</tr>').join('') : '<tr><td colspan="11" class="muted" style="padding:16px">Nothing has come in above its order.</td></tr>') + '</tbody>';
  const open = all.filter(r => r.overStatus === 'open');
  $('fgMsg').className = open.length ? 'err' : 'muted';
  $('fgMsg').textContent = `${nf(open.length)} receipt(s) above their order waiting for review · ${nf(open.reduce((t, r) => t + fgiNum(r.overQty), 0))} extra piece(s)`
    + ` · ${nf(all.length - open.length)} already reviewed · the extra pieces are in stock either way`;
  ptImgFill(all.map(r => r.sku), false, ptImgPatch);
}

async function fgiOverReview(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return 'That receipt is gone.';
  if (r.overStatus !== 'open') return 'That one is already reviewed.';
  const at = new Date().toISOString();
  await ptPatch({ ['pt_fgiLedger/' + id + '/overStatus']: 'reviewed', ['pt_fgiLedger/' + id + '/overReviewedBy']: ME.email,
    ['pt_fgiLedger/' + id + '/overReviewedAt']: at });
  Object.assign(r, { overStatus: 'reviewed', overReviewedBy: ME.email, overReviewedAt: at });
  fgiOverBadge();
  renderFgi();
  return '';
}

