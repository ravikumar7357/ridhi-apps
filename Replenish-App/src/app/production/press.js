/* ================= PRESS INVENTORY =================
 *
 * Finished pieces coming off the press, against an order. One gate rather than Base Data's three —
 * pressing is capped at what the order asked for, and nothing else. (Pressed pieces then count twice
 * over in Base Data: as allowance consumed, and as proof that a piece was cut. See obIssueUsed.)
 *
 * The register is PTG.press, the same array the gates read, so a new entry tightens the caps the
 * moment it is saved instead of after a reload.
 */
let PP = { err: '', busy: false, at: '', freeze: null };

async function ensurePpress() {
  if (!PTG.mdb) { PP.busy = true; renderPpress(); await ptLoadGates(); PP.busy = false; }
  if (PP.freeze === null) { try { PP.freeze = (await ptGet('pt_pressFreezes')) || {}; } catch (e) { PP.freeze = {}; } }
  PP.at = ptStamp();
  renderPpress();
}

const pressMonthFrozen = v => !!(PP.freeze && PP.freeze[ptMonthKey(v)]);

/** Pressing is capped at the order, and only at the order. */
function pressGuard(orderNo, sku, qty, exclId, allowExtra) {
  const ordered = obOrderedQty(orderNo, sku);
  if (!ordered) return `Order ${orderNo} has no line for SKU ${obUC(sku)} — pick the correct Order ID.`;
  if (allowExtra) return '';
  const used = obPressQty(orderNo, sku, exclId);
  const want = parseInt(qty, 10) || 0;
  if (used + want > ordered)
    return `Order ${orderNo} · ${obUC(sku)}: ordered ${ordered} pcs, already pressed ${used} pcs — `
      + `at most ${ordered - used} more allowed. Entry blocked.`;
  return '';
}

function pressOrdersFor(sku) {
  if (!sku) return [];
  const seen = new Set();
  return obLines().filter(l => l.sku === obUC(sku)).filter(l => {
    if (seen.has(l.orderNo)) return false; seen.add(l.orderNo); return true;
  }).map(l => {
    const ordered = obOrderedQty(l.orderNo, sku), used = obPressQty(l.orderNo, sku);
    return { orderNo: l.orderNo, ordered, used, left: Math.max(0, ordered - used) };
  }).sort((a, b) => (b.left - a.left) || a.orderNo.localeCompare(b.orderNo));
}

/* ---- filters + table ---- */

function ppFilters() {
  const v = id => ($(id) || {}).value || '';
  return { art: v('ppArt'), sub: v('ppSub'), col: v('ppCol'), sz: v('ppSz'),
    ord: v('ppOrd'), q: v('ppQ').trim().toLowerCase(), d1: v('ppD1'), d2: v('ppD2') };
}

function ppApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'ord' && f.ord && !ptCi(r.orderNo, f.ord)) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.articleSubtype, r.color, r.size, r.orderNo].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (skip !== 'date' && f.d1) { const d = ptDate(r.entryDate); if (!d || d < new Date(f.d1 + 'T00:00:00')) return false; }
    if (skip !== 'date' && f.d2) { const d = ptDate(r.entryDate); if (!d || d > new Date(f.d2 + 'T23:59:59')) return false; }
    return true;
  });
}

function renderPpress() {
  if (PP.busy) { $('ppMsg').className = 'muted'; $('ppMsg').textContent = 'Reading the production database…'; ptEmpty('ppTable', 'Loading…'); return; }
  if (PTG.err) { $('ppMsg').className = 'err'; $('ppMsg').textContent = 'Could not read it: ' + PTG.err; ptEmpty('ppTable', 'Nothing to show.'); $('ppKpis').innerHTML = ''; return; }
  const all = PTG.press || [];
  if (!all.length) { $('ppMsg').className = 'muted'; $('ppMsg').textContent = ''; $('ppKpis').innerHTML = ''; ptEmpty('ppTable', 'No press entries.'); return; }

  const f = ppFilters();
  ptFill('ppArt', ppApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('ppSub', ppApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('ppCol', ppApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('ppSz', ppApply(all, f, 'sz').map(r => r.size), 'All sizes');
  ptFill('ppOrd', ppApply(all, f, 'ord').map(r => r.orderNo), 'All orders');

  const rows = ppApply(all, f).sort((a, b) => {
    const d = ptDtMs(b.entryDate) - ptDtMs(a.entryDate);
    return d || String(b.id || '').localeCompare(String(a.id || ''));
  });
  PP.rows = rows;

  const pieces = rows.reduce((s, r) => s + ptNum(r.pieces), 0);
  $('ppKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Press Inventory</span>
      <span class="kpiwhen">read live${PP.at ? ' · ' + esc(PP.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Entries</div></div>
      <div class="metric"><div class="v">${nf(pieces)}</div><div class="l">Pieces pressed</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => obUC(r.sku)).filter(Boolean)).size)}</div><div class="l">SKUs</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.orderNo || '').trim()).filter(Boolean)).size)}</div><div class="l">Orders</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Entry Date', 'Order No', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Pieces', 'Remarks', 'Entered by', 'Edit']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 8 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const body = rows.slice(0, 600).map(r => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(r.entryDate)}</td>`
    + `<td style="text-align:left">${esc(r.orderNo) || '<span class="muted">—</span>'}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku)
    + `<td>${esc(r.articleType)}</td><td>${esc(r.articleSubtype)}</td><td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
    + `<td class="num" style="font-weight:700">${nf(ptNum(r.pieces))}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
    + whoCell(r)
    + `<td>${ptCanEdit() ? `<button class="ghost" data-press-edit="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button>`
      : '<span class="muted">—</span>'}</td></tr>`).join('');
  $('ppTable').innerHTML = head + '<tbody>' + body + '</tbody>';

  $('ppMsg').className = 'muted';
  $('ppMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} entr${all.length === 1 ? 'y' : 'ies'}`
    + (rows.length > 600 ? ' · showing the first 600 · Export covers all of them' : '');
  ptImgFill(rows.slice(0, 600).map(r => r.sku), false, ptIfTab('ppress', renderPpress));
}

/* ---- the entry form: Order ID first, same as Base Data ---- */

function pressFormMsg(t, bad) { const m = $('pwMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/** Orders with press still owing. */
function pressOpenOrders() {
  const m = {};
  obLines().forEach(l => { (m[l.orderNo] = m[l.orderNo] || { skus: new Set(), date: l.date }).skus.add(l.sku); });
  return Object.keys(m).map(no => {
    const bal = [...m[no].skus].reduce((a, s) => a + Math.max(0, obOrderedQty(no, s) - obPressQty(no, s)), 0);
    return { orderNo: no, bal, date: m[no].date };
  }).filter(o => o.bal > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.orderNo.localeCompare(b.orderNo));
}

function pressScope() {
  const all = PTG.mdb || [];
  const o = obUC($('pwOrd').value);
  if (!o) return all;
  const open = new Set(obLines().filter(l => l.orderNo === o).map(l => l.sku));
  return all.filter(r => open.has(obUC(r.sku)));
}

function renderPressForm() {
  const cur = $('pwOrd').value;
  $('pwOrd').innerHTML = '<option value="">— Select Order ID —</option>'
    + pressOpenOrders().map(o => `<option value="${esc(o.orderNo)}">${esc(o.orderNo)} — ${nf(o.bal)} pcs open</option>`).join('');
  $('pwOrd').value = cur;
  if ($('pwOrd').value !== cur) $('pwOrd').value = '';

  const scope = pressScope();
  const at = $('pwAt').value, sub = $('pwSub').value, col = $('pwCol').value, sz = $('pwSz').value;
  bdFill('pwAt', scope.map(r => r.articleType), '-- Article type --');
  bdFill('pwSub', scope.filter(r => !at || ptNorm(r.articleType) === ptNorm(at)).map(r => r.subtype), '-- Subtype --');
  bdFill('pwCol', scope.filter(r => (!at || ptNorm(r.articleType) === ptNorm(at))
    && (!sub || ptNorm(r.subtype) === ptNorm(sub))).map(r => r.color), '-- Colour --');
  bdFill('pwSz', scope.filter(r => (!at || ptNorm(r.articleType) === ptNorm(at))
    && (!sub || ptNorm(r.subtype) === ptNorm(sub))
    && (!col || ptNorm(r.color) === ptNorm(col))).map(r => r.size), '-- Size --');

  if (!$('pwSku').dataset.typed) {
    const hit = scope.filter(r => ptNorm(r.articleType) === ptNorm(at) && ptNorm(r.subtype) === ptNorm(sub)
      && ptNorm(r.color) === ptNorm(col) && ptNorm(r.size) === ptNorm(sz));
    $('pwSku').value = (at && sub && col && sz && hit.length === 1) ? hit[0].sku : '';
  }

  const sku = $('pwSku').value.trim();
  const o = sku ? pressOrdersFor(sku).find(x => x.orderNo === obUC($('pwOrd').value)) : null;
  $('pwLeft').textContent = o
    ? `${nf(o.left)} piece(s) may still be pressed — ${nf(o.ordered)} ordered, ${nf(o.used)} already pressed.`
    : (sku && !pressOrdersFor(sku).length ? 'No order in the Order Book carries this SKU.' : '');
  $('pwLeft').className = (o && o.left <= 0) ? 'err' : 'muted';
}

function pressSkuTyped() {
  const sku = $('pwSku').value.trim();
  $('pwSku').dataset.typed = sku ? '1' : '';
  const m = cutSkuOf(sku);
  if (m) {
    $('pwAt').value = m.articleType || ''; $('pwSub').value = m.subtype || '';
    $('pwCol').value = m.color || ''; $('pwSz').value = m.size || '';
  }
  renderPressForm();
}

function pressClearForm() {
  ['pwSku', 'pwPcs', 'pwRemarks'].forEach(id => { $(id).value = ''; });
  ['pwOrd', 'pwAt', 'pwSub', 'pwCol', 'pwSz'].forEach(id => { $(id).value = ''; });
  $('pwSku').dataset.typed = '';
  $('pwDate').value = dToday();
  renderPressForm();
  pressFormMsg('');
}

$('pwToggle').onclick = async () => {
  const box = $('pwBox');
  const open = box.classList.contains('hide');
  box.classList.toggle('hide', !open);
  $('pwToggle').textContent = open ? 'Close' : '+ New press entry';
  if (open) {
    if (!PTG.mdb) { pressFormMsg('Reading the master database and the order book…'); await ptLoadGates(); }
    await ptEnsureCustom();
    if (!$('pwDate').value) $('pwDate').value = dToday();
    pressFormMsg('');
    renderPressForm();
  }
};
['pwOrd', 'pwAt', 'pwSub', 'pwCol', 'pwSz'].forEach(id => {
  const reset = () => { $('pwSku').dataset.typed = ''; renderPressForm(); };
  $(id).addEventListener('change', reset);
});
$('pwSku').addEventListener('input', pressSkuTyped);

$('pwSave').onclick = async () => {
  const sku = $('pwSku').value.trim();
  const m = cutSkuOf(sku);
  const orderNo = $('pwOrd').value.trim();
  const pcs = parseInt($('pwPcs').value, 10);
  const date = $('pwDate').value;
  const at = $('pwAt').value, sub = $('pwSub').value, col = $('pwCol').value, sz = $('pwSz').value;

  if (!m) return pressFormMsg(sku ? `SKU ${sku} is not in the master database, nor on the Custom SKUs list.` : 'Pick the item, or type the SKU.', true);
  if (!pcs || pcs < 1) return pressFormMsg('Enter how many pieces were pressed.', true);
  if (!date) return pressFormMsg('Enter the entry date.', true);
  const mErr = m._custom ? [] : validateAgainstMasters(at || m.articleType, sub || m.subtype, col || m.color, sz || m.size);
  if (mErr.length) return pressFormMsg(mErr[0], true);
  if (!orderNo) return pressFormMsg('Select an Order ID — every press entry is recorded against an order.', true);
  const gErr = pressGuard(orderNo, sku, pcs);
  if (gErr) return pressFormMsg(gErr, true);
  if (pressMonthFrozen(date)) return pressFormMsg(`${ptMonthKey(date)} is frozen — press entries for that month are locked.`, true);

  const entry = {
    id: 'press_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    sku: obUC(sku),
    articleType: at || m.articleType || '', articleSubtype: sub || m.subtype || '',
    color: col || m.color || '', size: sz || m.size || '',
    pieces: pcs,
    entryDate: ptStampDate(date),
    orderNo,
    remarks: $('pwRemarks').value.trim(),
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };

  $('pwSave').disabled = true;
  pressFormMsg('Saving…');
  try {
    await ptPut('pt_pressInventory/' + entry.id, entry);
    PTG.press = (PTG.press || []).concat(Object.assign({ _key: entry.id }, entry));
    pressClearForm();
    renderPpress();
    pressFormMsg(`Saved — ${nf(pcs)} piece(s) of ${obUC(sku)} against ${orderNo}.`);
  } catch (e) {
    pressFormMsg('Not saved: ' + (e.message || e), true);
  }
  $('pwSave').disabled = false;
};

['ppArt', 'ppSub', 'ppCol', 'ppSz', 'ppOrd', 'ppD1', 'ppD2'].forEach(id => $(id).addEventListener('change', renderPpress));
ptDebounce('ppQ', renderPpress);
$('ppClear').onclick = () => { ['ppArt', 'ppSub', 'ppCol', 'ppSz', 'ppOrd', 'ppQ', 'ppD1', 'ppD2'].forEach(id => $(id).value = ''); renderPpress(); };
$('ppGo').onclick = async () => { await ptLoadGates(true); PP.freeze = null; await ensurePpress(); };
$('ppTable').addEventListener('click', e => {
  const b = e.target.closest('[data-press-edit]'); if (!b) return;
  pressEdit(b.getAttribute('data-press-edit'));
});
$('ppExport').onclick = () => {
  const rows = PP.rows || []; if (!rows.length) return;
  const lines = [['Entry Date', 'Order No', 'SKU', 'Article', 'Subtype', 'Color', 'Size', 'Pieces', 'Remarks', 'Entered by'].map(csvCell).join(',')];
  rows.forEach(r => lines.push([r.entryDate, r.orderNo, r.sku, r.articleType, r.articleSubtype, r.color, r.size,
    ptNum(r.pieces), r.remarks, r.addedBy].map(csvCell).join(',')));
  ptDownload('press-inventory', lines);
};

