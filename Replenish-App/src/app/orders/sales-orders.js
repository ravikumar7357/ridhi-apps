/* ================= SALES ORDERS =================
 *
 * A customer's order and its life: draft → submitted → approved, or returned to the buyer.
 * Approving it is what writes its lines into the order book, and every cap in this app is measured
 * against those lines. So the question this screen answers is not "what was ordered" — it is
 * "did what was ordered actually reach production, and how far has it got".
 *
 * COUNTED BY ORDER, NOT BY LINE. One of these orders carries 1,216 lines; a flat list of 1,340 rows
 * buries the seven orders that matter. The lines are one click away.
 *
 * GROUPED BY SKU INSIDE THE ORDER. The same SKU appears twice on some orders (168 times in all), and
 * the order book merges them into one line whose quantity is the sum. Counting the app's lines
 * separately and capping each at its own quantity would let the same cut pieces be counted twice, so
 * the SKU is the unit here, exactly as it is in the order book.
 *
 * Progress is measured AGAINST THIS ORDER — the same figures obCutQty / obPressQty gate the Order
 * Console with — not against the SKU across the whole factory. Work booked to another order cannot
 * finish this one.
 */
const SO_STATUS = {
  draft: { label: 'Draft', cls: '' },
  submitted: { label: 'Awaiting approval', cls: 'pill-low' },
  returned: { label: 'Returned to buyer', cls: 'pill-out' },
  approved: { label: 'Approved', cls: 'pill-ok' },
};

let SOX = { rows: null, err: '', busy: false, at: '', shown: [] };

async function ensureSox() {
  if (SOX.rows === null) {
    SOX.busy = true; renderSox();
    if (!PTG.ob) await ptLoadGates();
    try { SOX.rows = ptList(await ptGet('pt_salesOrders')); SOX.err = ''; }
    catch (e) { SOX.err = e.message || String(e); SOX.rows = SOX.rows || []; }
    await odrLoad(true);
    SOX.at = ptStamp(); SOX.busy = false;
  }
  renderSox();
}

const soLines = o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).filter(Boolean);
const soStatus = o => o.status || 'draft';
/** AIR / SEA on an Amazon order: kept on it (shipMode), else read off the end of its number. '' for none. */
/* The number is what the factory reads, so its -AIR / -SEA wins over what is kept beside it (17 Oct). */
const soShipMode = o => String((typeof soModeOf === 'function' ? soModeOf(o && o._id) : '') || (o && o.shipMode) || '').toUpperCase();
const soCount = x => (Array.isArray(x) ? x.length : Object.keys(x || {}).length);
/* THE BUYER OF A B2B ORDER IS THE BRAND (Ravi, 27 Oct: "brand name under the buyer column instead of uploaded by whom",
 * B2B only). The Brand Name off the uploaded sheet, from the order's own lines — two named, the rest counted. buyerName
 * is who raised it: kept on the order, shown in the order itself and as the tip on the cell. */
function soBrandOf(o) {
  const seen = [];
  soLines(o).forEach(l => { const b = String((l && l.brand) || '').trim(); if (b && !seen.includes(b)) seen.push(b); });
  return seen.slice(0, 2).join(' / ') + (seen.length > 2 ? ' +' + (seen.length - 2) : '');
}
/** What the Buyer column says: the brand on a B2B order that carries one, else who raised it. */
const soBuyerTxt = o => (soIsB2B(o.channel) && soBrandOf(o)) || o.buyerName || '';

/** Order + SKU → net cut and pressed, built once. Per-SKU lookups would rescan 4,000 rows 1,200 times. */
function soWork() {
  const cut = new Map(), press = new Map();
  (PT.cut || []).forEach(r => {
    if (!r || !r.orderNo) return;
    const k = obUC(r.orderNo) + '|' + obUC(r.sku);
    // Net, as the gates count it: cut pieces less anything rejected after cutting.
    const net = (parseInt(r.pieces, 10) || 0) - (r.rejected === true ? (parseInt(r.rejPieces, 10) || 0) : 0);
    cut.set(k, (cut.get(k) || 0) + net);
  });
  (PTG.press || []).forEach(r => {
    if (!r || !r.orderNo) return;
    const k = obUC(r.orderNo) + '|' + obUC(r.sku);
    press.set(k, (press.get(k) || 0) + (parseInt(r.pieces, 10) || 0));
  });
  return { cut, press };
}

/** The order collapsed to one row per SKU — the shape the order book keeps it in. */
function soSkus(o, w) {
  const by = new Map();
  soLines(o).forEach(l => {
    const k = obUC(l.sku); if (!k) return;
    const cur = by.get(k) || { sku: k, qty: 0, lines: 0, delivery: l.deliveryDate, priority: l.priority, adjusted: 0 };
    cur.qty += parseInt(l.qty, 10) || 0;
    cur.lines++;
    if (l.previousQty != null) cur.adjusted++;
    by.set(k, cur);
  });
  const id = obUC(o._id);
  const inBook = new Set((PTG.ob || []).filter(r => r && obUC(r.orderNo) === id).map(r => obUC(r.sku)));
  return [...by.values()].map(g => {
    const key = id + '|' + g.sku;
    g.cut = Math.min(g.qty, Math.max(0, w.cut.get(key) || 0));
    g.press = Math.min(g.qty, Math.max(0, w.press.get(key) || 0));
    g.inBook = inBook.has(g.sku);
    return g;
  }).sort((a, b) => a.sku.localeCompare(b.sku));
}

function soSummary(o, w) {
  const gs = soSkus(o, w);
  const sum = f => gs.reduce((s, g) => s + f(g), 0);
  const qty = sum(g => g.qty), cut = sum(g => g.cut), press = sum(g => g.press);
  const missing = gs.filter(g => !g.inBook).length;
  return { groups: gs, skus: gs.length, lines: soLines(o).length, qty, cut, press, missing,
    cutPct: qty ? Math.round(cut / qty * 100) : 0, mfgPct: qty ? Math.round(press / qty * 100) : 0 };
}

function renderSox() {
  if (SOX.busy) { $('sxMsg').className = 'muted'; $('sxMsg').textContent = 'Reading the sales orders…'; ptEmpty('sxTable', 'Loading…'); return; }
  if (SOX.err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = 'Could not read it: ' + SOX.err; ptEmpty('sxTable', 'Nothing to show.'); $('sxKpis').innerHTML = ''; return; }
  /* SENT BACK BY PPC (flow/flow-back.js), above everything: lines PPC cannot plan until this team puts them right. */
  if ($('sxBack')) { try { $('sxBack').innerHTML = typeof flowBackCard === 'function' ? flowBackCard() : ''; } catch (e) { $('sxBack').innerHTML = ''; } }
  const all = SOX.rows || [];
  if (!all.length) { $('sxMsg').className = 'muted'; $('sxMsg').textContent = ''; $('sxKpis').innerHTML = ''; ptEmpty('sxTable', 'No sales orders.'); return; }

  const w = soWork();
  /* BY CHANNEL (Ravi, 2026-09-25). The list is the channels the orders actually carry, named from the channel
   * master where it knows them; the choice survives a redraw. The cards count the channel picked. */
  const chOf = o => String((o && o.channel) || '').trim().toUpperCase();
  const names = new Map(soChannels().map(c => [c.code, c.name]));
  const chans = [...new Set(all.map(chOf).filter(Boolean))].sort();
  const chSel = $('sxChan');
  if (chSel) {
    const was = chSel.value;
    chSel.innerHTML = '<option value="">All channels</option>' + chans.map(c => `<option value="${esc(c)}">${esc(c)}${names.get(c) && names.get(c).toUpperCase() !== c ? ' — ' + esc(names.get(c)) : ''} (${nf(all.filter(o => chOf(o) === c).length)})</option>`).join('');
    chSel.value = chans.indexOf(was) >= 0 ? was : '';
  }
  const ch = (chSel && chSel.value) || '';
  const base = ch ? all.filter(o => chOf(o) === ch) : all;
  const st = $('sxStatus').value, q = $('sxQ').value.trim().toLowerCase();
  /* AIR OR SEA (Ravi, 16 Oct: "sales order list me AIR / SEA filter bhi add karo"): the mode kept on the order, else the end of its number. */
  const md = String(($('sxMode') || {}).value || '');
  const smo = String(($('sxSMonth') || {}).value || '');   // the sale month an order is for (18 Oct)
  /* ON THE ORDER DATE, not on when the order was last touched — that is the date the row shows and
   * the date anybody asking for "September's orders" means. Sales orders carry it two ways, ISO from
   * the new-order form and day-first from the vendor side, which is why this goes through ptInRange
   * and not through a string compare. */
  const [sxD1, sxD2] = ptRangeOf('sxD1', 'sxD2');
  const rows = base
    .filter(o => !st || soStatus(o) === st)
    .filter(o => !md || soShipMode(o) === md)
    .filter(o => !smo || o.saleMonth === smo)
    .filter(o => ptInRange(o && o.orderDate, sxD1, sxD2))
    .map(o => ({ o, s: soSummary(o, w) }))
    .filter(({ o, s }) => !q || [o._id, o.buyerName, o.buyerEmail, o.channel, soStatus(o), soBrandOf(o)].join(' ').toLowerCase().includes(q)
      || s.groups.some(g => g.sku.toLowerCase().includes(q)))
    .sort((a, b) => String(b.o.orderDate || '').localeCompare(String(a.o.orderDate || ''))
      || String(b.o._id || '').localeCompare(String(a.o._id || '')));
  SOX.shown = rows;

  const c = s => base.filter(o => soStatus(o) === s).length;
  const missing = rows.reduce((n, x) => n + (soStatus(x.o) === 'approved' ? x.s.missing : 0), 0);
  $('sxKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Sales orders${ch ? ' · ' + esc(ch) + (names.get(ch) && names.get(ch).toUpperCase() !== ch ? ' — ' + esc(names.get(ch)) : '') : ''}</span>
      <span class="kpiwhen">read live${SOX.at ? ' · ' + esc(SOX.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(base.length)}</div><div class="l">Orders</div></div>
      <div class="metric"><div class="v" style="color:#7f6000">${nf(c('submitted'))}</div><div class="l">Awaiting approval</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(c('approved'))}</div><div class="l">Approved</div></div>
      <div class="metric"><div class="v">${nf(rows.reduce((s, x) => s + x.s.qty, 0))}</div><div class="l">Pieces ordered</div></div>
      <div class="metric"><div class="v"${missing ? ' style="color:var(--bad)"' : ''}>${nf(missing)}</div><div class="l">Approved SKUs missing from the order book</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Order', 'Date', 'Channel', 'Buyer', 'Status', 'SKUs', 'Pieces', 'Cut', 'Made', 'In order book', 'Delivery', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 5 && i <= 8 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('sxTable').innerHTML = head + '<tbody>' + rows.map(({ o, s }) => {
    const sd = SO_STATUS[soStatus(o)] || SO_STATUS.draft;
    const bar = (pct, col) => `<div style="font-weight:700;color:${col}">${pct}%</div>`
      + `<div style="height:4px;background:var(--line);border-radius:3px;margin-top:3px">`
      + `<div style="height:4px;width:${Math.min(100, pct)}%;background:${col};border-radius:3px"></div></div>`;
    const done = soStatus(o) === 'approved';
    return '<tr>'
      + `<td class="frz" style="text-align:left;font-weight:600">${esc(o._id)}</td>`
      + `<td>${esc(o.orderDate)}${o.saleMonth ? `<div class="muted" style="font-size:11px">for ${esc(soMonthTxt(o.saleMonth))}</div>` : ''}</td><td>${esc(o.channel)}${soShipMode(o) ? ` <span class="pill" style="font-size:11px">${esc(soShipMode(o))}</span>` : ''}</td>`
      + `<td style="text-align:left${soIsB2B(o.channel) && soBrandOf(o) ? ';font-weight:600' : ''}"${soIsB2B(o.channel) && soBrandOf(o) && o.buyerName ? ` title="Raised by ${esc(o.buyerName)}"` : ''}>${esc(soBuyerTxt(o)) || '<span class="muted">—</span>'}</td>`
      + `<td><span class="pill ${sd.cls}">${esc(sd.label)}</span></td>`
      + `<td class="num">${nf(s.skus)}${s.skus !== s.lines ? ` <span class="muted" style="font-size:11px">of ${nf(s.lines)}</span>` : ''}</td>`
      + `<td class="num" style="font-weight:700">${nf(s.qty)}</td>`
      + `<td class="num">${done ? bar(s.cutPct, '#7f6000') : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${done ? bar(s.mfgPct, '#166534') : '<span class="muted">—</span>'}</td>`
      /* An approved SKU that never reached the order book is work production was never told about. */
      + `<td>${!done ? '<span class="muted">not yet</span>'
        : (s.missing ? `<span class="pill pill-out">${nf(s.missing)} missing</span>`
                     : `<span class="pill pill-ok">all ${nf(s.skus)}</span>`)}</td>`
      + `<td>${o.deliveryMode === 'complete' ? (esc(o.deliveryDate) || 'one date') : 'per line'}</td>`
      + `<td style="white-space:nowrap">`
      + `<button class="ghost" data-so-open="${esc(o._id)}" style="padding:3px 9px;font-size:12px">Open</button>`
      + `${soCanEdit(o) ? ` <button class="ghost" data-so-edit="${esc(o._id)}" style="padding:3px 9px;font-size:12px">Edit</button>` : ''}`
      + `${ME.admin && (soStatus(o) === 'submitted' || soStatus(o) === 'returned') ? ` <button data-so-review="${esc(o._id)}" style="padding:3px 9px;font-size:12px">Review</button>` : ''}`
      + `${ME.admin && done && s.missing ? ` <button data-so-review="${esc(o._id)}" style="padding:3px 9px;font-size:12px">Add the ${nf(s.missing)} missing</button>` : ''}`
      + `</td></tr>`;
  }).join('') + '</tbody>';

  $('sxMsg').className = missing ? 'err' : 'muted';
  $('sxMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} order(s)`
    + (missing ? ` · ${nf(missing)} approved SKU(s) not in the order book` : '');
  $('sxMsg').title = 'Cut and made are counted against this order only, so work booked to another order cannot finish it.'
    + (missing ? ` ${nf(missing)} approved SKU(s) never reached the order book, so nothing can be cut or pressed against them.` : '');
}

/* ---- B2B: SIZE, COLOUR, QUALITY AND DELIVERY ON A LINE (Ravi, 27 Oct) ----
 * What the buyer's sheet said can be put right on the order itself, one SKU at a time, without raising it again.
 * Quality is the sheet's Material column (Sheeting, Cambric). No reason is asked — Ravi took that box out — but every
 * change is kept on the order beside who made it and when. */
const SO_DETAIL = [
  { k: 'size', t: 'Size' }, { k: 'color', t: 'Colour' }, { k: 'material', t: 'Quality' }, { k: 'deliveryDate', t: 'Delivery' },
];
let SOD = { id: '', sku: '' };   // the one line open for editing in the order dialog

/** May this person change a B2B line? Whoever may edit the order while it is theirs, and whoever approves orders after. */
const soDetailMay = o => !!o && soIsB2B(o.channel) && (soCanEdit(o) || soCanApprove());

/** A SKU's own description on this order — the first line of it speaks for all, as it does in the order book. */
function soDetailOf(o, sku) {
  const ls = soLinesOf(o, sku), l = (ls[0] || {}).l || {};
  return { itemName: l.itemName || '', size: l.size || '', color: l.color || '', material: l.material || '',
    deliveryDate: l.deliveryDate || (o.deliveryMode === 'complete' ? o.deliveryDate || '' : '') };
}

/** One SKU's row in the order dialog: as it reads, or open for editing. */
function soDlgRow(o, g, opt) {
  const owed = Math.max(0, g.qty - g.press);
  const b2b = soIsB2B(o.channel), d = b2b ? soDetailOf(o, g.sku) : null;
  const editing = b2b && opt.mayEdit && SOD.id === o._id && SOD.sku === g.sku;
  /* CUT PIECES ARE CUT. Once anything is cut, received or pressed against the line, its size, colour and quality stay —
   * changing them would leave pieces on the floor that match no order. The delivery date can still move. */
  const done = b2b && opt.mayEdit ? soDoneOn(o._id, g.sku) : null;
  const locked = !!(done && done.floor);
  const changed = b2b && Object.values(o.detailChanges || {}).some(c => c && obUC(c.sku) === g.sku);
  const box = (k, type) => `<input data-sod="${k}" data-was="${esc(d[k])}"${type ? ` type="${type}"` : ''} value="${esc(d[k])}"`
    + `${k === 'material' ? ' list="sodQual"' : ''} style="height:30px;font-size:12.5px;padding:0 8px;width:100%;min-width:${type ? 130 : 90}px">`
    + `<div class="muted sod-was" style="font-size:11px;margin-top:2px;text-align:left"></div>`;
  const cell = k => (editing && !(locked && k !== 'deliveryDate')) ? `<td>${box(k, k === 'deliveryDate' ? 'date' : '')}</td>`
    : `<td${k === 'color' ? ' style="text-align:left"' : ''}>${esc(d[k]) || '<span class="muted">—</span>'}</td>`;
  const act = [];
  if (editing) act.push(`<button data-sod-save="${esc(g.sku)}" style="padding:3px 11px;font-size:12px">Save</button>`,
    `<button class="ghost" data-sod-cancel="1" style="padding:3px 9px;font-size:12px">Cancel</button>`);
  else {
    if (b2b && opt.mayEdit) act.push(locked
      ? `<span class="muted" style="font-size:11px">${nf(done.floor)} cut · </span><button class="ghost" data-sod-edit="${esc(g.sku)}" style="padding:3px 9px;font-size:12px" title="Size, colour and quality are fixed once pieces are cut">Edit date</button>`
      : `<button class="ghost" data-sod-edit="${esc(g.sku)}" style="padding:3px 9px;font-size:12px">Edit</button>`);
    if (opt.mayQty) act.push(`<button class="ghost" data-so-qty="${esc(o._id)}|${esc(g.sku)}" style="padding:3px 9px;font-size:12px">Change qty</button>`);
  }
  return `<tr data-sod-row="${esc(g.sku)}"${editing ? ' style="background:#eff6ff"' : (g.inBook ? '' : ' style="background:var(--bad-bg)"')}>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(g.sku)}`
    + `${g.lines > 1 ? ` <span class="muted" style="font-size:11px">${nf(g.lines)} lines</span>` : ''}`
    + `${g.adjusted ? ' <span class="pill pill-low">qty changed</span>' : ''}`
    + `${changed ? ' <span class="pill pill-low">changed</span>' : ''}</td>`
    + ptImgCell(g.sku)
    + (b2b ? `<td style="text-align:left">${esc(d.itemName) || '<span class="muted">—</span>'}</td>` + cell('size') + cell('color') + cell('material') : '')
    + `<td class="num" style="font-weight:700">${nf(g.qty)}</td>`
    + `<td class="num" style="color:#7f6000">${nf(g.cut)}</td>`
    + `<td class="num" style="color:#166534">${nf(g.press)}</td>`
    /* A B2B order leaves out Owed and Priority (its lines carry no priority) so the size, colour and quality fit
     * beside the figures, with Save in sight. */
    + (b2b ? cell('deliveryDate') : `<td class="num"${owed ? ' style="color:var(--bad);font-weight:700"' : ''}>${owed ? nf(owed) : '<span class="muted">—</span>'}</td>`
      + `<td>${esc(g.delivery) || '<span class="muted">—</span>'}</td><td>${esc(g.priority) || '<span class="muted">—</span>'}</td>`)
    + `<td style="font-weight:700;color:${g.inBook ? 'var(--accent)' : 'var(--bad)'}">${g.inBook ? 'yes' : 'NO'}</td>`
    /* The buttons stay pinned to the right edge, so Save is in sight however wide the order runs. */
    + (opt.mayEdit || opt.mayQty ? `<td style="white-space:nowrap${b2b ? ';position:sticky;right:0;background:' + (editing ? '#eff6ff' : 'var(--card)') + ';box-shadow:-6px 0 6px -6px rgba(15,23,42,.25)' : ''}">${act.join(' ')}</td>` : '')
    + '</tr>';
}

/**
 * SAVE A B2B LINE'S DETAILS — every line of the SKU on the order, and the order-book row with it, in one write, so
 * production never reads a size the order no longer says. Returns '' or why not.
 */
async function soDetailRun(o, sku, want) {
  if (!soDetailMay(o)) return 'This order is not yours to change.';
  const ls = soLinesOf(o, sku);
  if (!ls.length) return 'That SKU is not on this order.';
  const was = soDetailOf(o, sku);
  const moved = SO_DETAIL.filter(f => want[f.k] != null && String(want[f.k]).trim() !== String(was[f.k] || '').trim());
  if (!moved.length) return 'Nothing was changed.';
  const done = soDoneOn(o._id, sku);
  if (done.floor && moved.some(f => f.k !== 'deliveryDate'))
    return nf(done.floor) + ' piece(s) are already cut against this line, so its size, colour and quality stay. The date can still move.';
  if (moved.some(f => f.k === 'deliveryDate') && !String(want.deliveryDate || '').trim()) return 'Pick the delivery date.';
  const now = new Date().toISOString(), base = 'pt_salesOrders/' + o._id + '/', patch = {};
  moved.forEach(f => ls.forEach(x => { patch[base + 'lines/' + x.i + '/' + f.k] = String(want[f.k]).trim(); }));
  /* ONE DATE FOR THE WHOLE ORDER, AND NOW ONE LINE DIFFERS. The order turns per-line, and every line that leaned on the
   * order's date is given it, so no line is left with no date to be made by. */
  if (moved.some(f => f.k === 'deliveryDate') && o.deliveryMode === 'complete') {
    patch[base + 'deliveryMode'] = soStatus(o) === 'approved' ? 'partial' : 'lines';
    if (o.deliveryDate) soLines(o).forEach((l, i) => { if (!l.deliveryDate && patch[base + 'lines/' + i + '/deliveryDate'] === undefined) patch[base + 'lines/' + i + '/deliveryDate'] = o.deliveryDate; });
  }
  moved.forEach((f, n) => {
    const id = 'det_' + Date.now() + '_' + n + '_' + Math.random().toString(36).slice(2, 6);
    patch[base + 'detailChanges/' + id] = { id, sku: obUC(sku), field: f.k, from: String(was[f.k] || ''), to: String(want[f.k]).trim(), by: ME.email, at: now };
  });
  patch[base + 'updatedAt'] = now;
  const bookId = soBookId(o._id, sku), book = (PTG.ob || []).find(r => r && r.id === bookId);
  if (book) moved.filter(f => f.k !== 'deliveryDate').forEach(f => { patch['pt_orderBook/' + bookId + '/' + f.k] = String(want[f.k]).trim(); });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  /* THE SCREEN FROM WHAT WAS WRITTEN. */
  const lines = soLines(o).map((l, i) => {
    const set = {};
    SO_DETAIL.forEach(f => { const v = patch[base + 'lines/' + i + '/' + f.k]; if (v !== undefined) set[f.k] = v; });
    return Object.keys(set).length ? Object.assign({}, l, set) : l;
  });
  const det = Object.assign({}, o.detailChanges || {});
  Object.keys(patch).filter(k => k.startsWith(base + 'detailChanges/')).forEach(k => { det[k.slice((base + 'detailChanges/').length)] = patch[k]; });
  const next = Object.assign({}, o, { lines, detailChanges: det, updatedAt: now },
    patch[base + 'deliveryMode'] ? { deliveryMode: patch[base + 'deliveryMode'] } : {});
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id ? next : x));
  if (book) PTG.ob = (PTG.ob || []).map(r => {
    if (!r || r.id !== bookId) return r;
    const set = {}; ['size', 'color', 'material'].forEach(k => { const v = patch['pt_orderBook/' + bookId + '/' + k]; if (v !== undefined) set[k] = v; });
    return Object.assign({}, r, set);
  });
  return '';
}

function soOpen(id, msg) {
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return;
  if (SOD.id !== id) SOD = { id: '', sku: '' };
  const s = soSummary(o, soWork());
  const shown = s.groups.slice(0, 400);
  const b2b = soIsB2B(o.channel);
  /* WHO MAY MOVE A QUANTITY: whoever approved the order in the first place. */
  const mayQty = soCanApprove() && soStatus(o) === 'approved';
  const mayEdit = soDetailMay(o);
  const cols = ['SKU', 'Image'].concat(b2b ? ['Article', 'Size', 'Colour', 'Quality'] : [])
    .concat(b2b ? ['Qty', 'Cut', 'Made', 'Delivery', 'In order book'] : ['Qty', 'Cut', 'Made', 'Owed', 'Delivery', 'Priority', 'In order book']).concat(mayQty || mayEdit ? [''] : []);
  const head = cols.map((h, i) => `<th${['Qty', 'Cut', 'Made', 'Owed'].includes(h) ? ' class="num"' : ''}${b2b && !h && i === cols.length - 1 ? ' style="position:sticky;right:0;z-index:2"' : ''}>${h}</th>`).join('');
  const body = shown.map(g => soDlgRow(o, g, { mayQty, mayEdit })).join('');
  /* Every quality the order already uses, offered first; anything else can still be typed. */
  const quals = [...new Set(['Sheeting', 'Cambric'].concat(soLines(o).map(l => String((l && l.material) || '').trim())).filter(Boolean))];
  const removed = (Array.isArray(o.lineRemovals) ? o.lineRemovals : Object.values(o.lineRemovals || {}))
    .filter(Boolean).reduce((n, r) => n + (parseInt(r.count, 10) || soCount(r.lines)), 0);
  /* EVERY QUANTITY THAT MOVED, newest first. A figure that changed and cannot be explained three
   * weeks later is the reason this is kept at all. */
  const adj = Object.values(o.qtyAdjustments || {}).filter(Boolean)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const det = Object.values(o.detailChanges || {}).filter(Boolean)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const fieldTxt = k => (SO_DETAIL.find(f => f.k === k) || { t: k }).t;
  const brand = b2b ? soBrandOf(o) : '';
  ptOpenDialog({
    title: 'Sales order ' + o._id,
    wide: b2b,
    subtitle: brand ? `${o.channel || ''}  ·  ${brand}${o.buyerName ? '  ·  raised by ' + o.buyerName : ''}`
      : `${o.channel || ''}${o.buyerName ? '  ·  ' + o.buyerName : ''}${o.buyerEmail ? '  ·  ' + o.buyerEmail : ''}`,
    /* What was just saved goes first, where it is seen — the line below the table can be scrolled out of sight. */
    note: (msg ? msg + ' ' : '') + `${nf(s.skus)} SKU(s) · ${nf(s.qty)} piece(s) · cut ${s.cutPct}% · made ${s.mfgPct}%.`
      + (soStatus(o) === 'approved'
        ? (s.missing ? ` ${nf(s.missing)} SKU(s) are NOT in the order book, so nothing can be booked against them.`
                     : ' Every SKU reached the order book.')
        : ` Status ${soStatus(o)}, so nothing is in the order book yet.`)
      + (o.approvedBy ? ` Approved by ${String(o.approvedBy).split('@')[0]}.` : '')
      + (removed ? ` ${nf(removed)} line(s) were removed from this order after it was raised.` : '')
      + (adj.length ? ` ${nf(adj.length)} quantit${adj.length > 1 ? 'ies were' : 'y was'} changed after approval.` : '')
      + (o.saRemarks ? ` Remarks: ${o.saRemarks}` : ''),
    html: `<div class="xlwrap" style="max-height:52vh;border:1px solid var(--line);border-radius:10px">`
      + `<table class="xl" id="sxDlgTable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      + (b2b ? `<datalist id="sodQual">${quals.map(q => `<option value="${esc(q)}">`).join('')}</datalist>` : '')
      + (s.groups.length > 400 ? `<div class="muted" style="margin-top:8px;font-size:12px">Showing the first 400 of ${nf(s.groups.length)} SKUs. Export gives you all of them.</div>` : '')
      + (det.length ? '<div style="margin-top:10px;font-weight:600;font-size:13px">Details changed on this order</div>'
        + '<table class="xl" style="margin-top:4px"><thead><tr><th>When</th><th>SKU</th><th>What</th><th>From</th><th>To</th><th>By</th></tr></thead><tbody>'
        + det.slice(0, 40).map(c => `<tr><td style="text-align:left">${esc(ptIsoDate(c.at) || '')}</td>`
          + `<td style="text-align:left;font-family:ui-monospace,monospace">${esc(c.sku)}</td>`
          + `<td>${esc(fieldTxt(c.field))}</td><td>${esc(c.from) || '<span class="muted">—</span>'}</td>`
          + `<td style="font-weight:700;color:#166534">${esc(c.to)}</td>`
          + `<td>${esc(String(c.by || '').split('@')[0])}</td></tr>`).join('')
        + '</tbody></table>' : '')
      + (adj.length ? '<div style="margin-top:10px;font-weight:600;font-size:13px">Quantities changed after approval</div>'
        + '<table class="xl" style="margin-top:4px"><thead><tr><th>When</th><th>SKU</th><th class="num">From</th><th class="num">To</th><th>Why</th><th>By</th></tr></thead><tbody>'
        + adj.slice(0, 40).map(a => `<tr><td style="text-align:left">${esc(ptIsoDate(a.at) || '')}</td>`
          + `<td style="text-align:left;font-family:ui-monospace,monospace">${esc(a.sku)}</td>`
          + `<td class="num">${nf(a.from)}</td>`
          + `<td class="num" style="font-weight:700;color:${a.to > a.from ? '#166534' : 'var(--bad)'}">${nf(a.to)}</td>`
          + `<td style="text-align:left">${esc(a.why || '')}</td>`
          + `<td>${esc(String(a.by || '').split('@')[0])}</td></tr>`).join('')
        + '</tbody></table>' : ''),
  });
  ptImgFill(shown.map(g => g.sku), false, ptImgPatch);
  const box = $('sxDlgTable');
  if (!box || !b2b || !mayEdit) return;
  /* Only the row clicked opens or closes — the rest of the order, and where it is scrolled to, stay put. */
  const redraw = sku => {
    const g = s.groups.find(x => x.sku === sku), tr = box.querySelector(`tr[data-sod-row="${CSS.escape(sku)}"]`);
    if (g && tr) { tr.outerHTML = soDlgRow(o, g, { mayQty, mayEdit }); ptImgFill([sku], false, ptImgPatch); }
  };
  box.onclick = async e => {
    const ed = e.target.closest('[data-sod-edit]');
    if (ed) { const was = SOD.sku; SOD = { id: o._id, sku: ed.getAttribute('data-sod-edit') }; if (was) redraw(was); redraw(SOD.sku); ptDlgMsg(''); return; }
    if (e.target.closest('[data-sod-cancel]')) { const was = SOD.sku; SOD = { id: '', sku: '' }; redraw(was); ptDlgMsg(''); return; }
    const sv = e.target.closest('[data-sod-save]'); if (!sv) return;
    const sku = sv.getAttribute('data-sod-save'), tr = sv.closest('tr'), want = {};
    tr.querySelectorAll('[data-sod]').forEach(i => { want[i.getAttribute('data-sod')] = i.value; });
    sv.disabled = true; ptDlgMsg('Saving…');
    const err = await soDetailRun((SOX.rows || []).find(x => x._id === o._id) || o, sku, want);
    if (err) { sv.disabled = false; ptDlgMsg(err, true); return; }
    const was = soDetailOf(o, sku), is = soDetailOf((SOX.rows || []).find(x => x._id === o._id) || o, sku);
    const said = SO_DETAIL.filter(f => String(was[f.k] || '') !== String(is[f.k] || ''))
      .map(f => `${f.t.toLowerCase()} ${was[f.k] || '—'} → ${is[f.k]}`).join(', ');
    SOD = { id: '', sku: '' };
    renderSox();
    soOpen(o._id, 'Saved · ' + sku + (said ? ': ' + said : '') + '.');
  };
  /* A box that no longer says what it did turns blue and says what it was. */
  box.oninput = e => {
    const i = e.target.closest('[data-sod]'); if (!i) return;
    const was = i.getAttribute('data-was') || '', moved = i.value.trim() !== was.trim();
    i.style.border = moved ? '1.5px solid #2563eb' : '';
    const w = i.parentNode.querySelector('.sod-was'); if (w) w.textContent = moved ? 'was ' + (was || '—') : '';
  };
}

/**
 * THE DIALOG. Everything the decision needs is on it before the number is typed: what the order says
 * now, what the factory has already done against it, what the order book carries, and the figure it
 * cannot go below.
 */
function soQtyOpen(id, sku) {
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return;
  const now = soQtyOf(o, sku);
  const done = soDoneOn(o._id, sku);
  const book = (PTG.ob || []).find(r => r && r.id === soBookId(o._id, sku));
  const lines = soLinesOf(o, sku);
  ptOpenDialog({
    title: 'Change the quantity — ' + sku,
    subtitle: 'Sales order ' + o._id + (o.buyerName ? '  ·  ' + o.buyerName : ''),
    note: `On the order now: ${nf(now)} piece(s)${lines.length > 1 ? ' over ' + nf(lines.length) + ' lines' : ''}. `
      + `Already cut ${nf(done.cut)}, received ${nf(done.made)}, pressed ${nf(done.pressed)}. `
      + (done.floor ? `It cannot go below ${nf(done.floor)} — those pieces exist. ` : 'Nothing has been made yet, so it can go to zero. ')
      + (book ? `The order book carries ${nf(parseFloat(book.qty) || 0)} and moves with it.`
        : 'This SKU never reached the order book, so only the sales order changes — use "Add the missing" to put it there.')
      + (lines.length > 1 ? ' Extra goes on the latest delivery date; a cut comes off the latest first.' : ''),
    fields: [
      { key: 'qty', label: 'New quantity', type: 'number', step: '1', min: done.floor, value: now },
      { key: 'why', label: 'Why it is changing', value: '', span: true },
    ],
    saveLabel: 'Change it',
    onSave: async v => {
      const err = await soQtyRun(o, sku, v.qty, v.why);
      if (err) return err;
      renderSox();
      $('sxMsg').className = 'muted';
      /* ASKED, NOT CHANGED. soQtyRun only writes the request; the order and the order book stay
       * where they are until it is approved in the Order Console. Saying "is now" here sent people
       * to the floor with a figure nobody had agreed to yet. */
      $('sxMsg').textContent = 'Asked: ' + sku + ' on ' + o._id + ' from ' + nf(now) + ' to '
        + nf(parseFloat(v.qty) || 0) + ' piece(s). The order and the order book stay at ' + nf(now)
        + ' until it is approved in the Order Console.';
      return '';
    },
  });
}

$('sxTable').addEventListener('click', e => {
  const o = e.target.closest('[data-so-open]'); if (o) return soOpen(o.getAttribute('data-so-open'));
  const ed = e.target.closest('[data-so-edit]'); if (ed) return soFormOpen(ed.getAttribute('data-so-edit'));
  const rv = e.target.closest('[data-so-review]'); if (rv) return soReview(rv.getAttribute('data-so-review'));
});
if ($('sxBack')) $('sxBack').addEventListener('click', e => {
  const o = e.target.closest('[data-so-open]'); if (o) return soOpen(o.getAttribute('data-so-open'));
});
$('sxStatus').addEventListener('change', renderSox);
if ($('sxChan')) $('sxChan').addEventListener('change', renderSox);
if ($('sxMode')) $('sxMode').addEventListener('change', renderSox);
if ($('sxSMonth')) $('sxSMonth').addEventListener('change', renderSox);
['sxD1', 'sxD2'].forEach(id => $(id).addEventListener('change', renderSox));
$('sxClear').onclick = () => {
  ['sxQ', 'sxD1', 'sxD2'].forEach(id => $(id).value = '');
  $('sxStatus').value = '';
  if ($('sxChan')) $('sxChan').value = '';
  if ($('sxMode')) $('sxMode').value = '';
  if ($('sxSMonth')) $('sxSMonth').value = '';
  renderSox();
};
ptDebounce('sxQ', renderSox);
$('sxGo').onclick = async () => { SOX.rows = null; await ensureSox(); };
