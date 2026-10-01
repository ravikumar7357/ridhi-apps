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
const soCount = x => (Array.isArray(x) ? x.length : Object.keys(x || {}).length);

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
  /* ON THE ORDER DATE, not on when the order was last touched — that is the date the row shows and
   * the date anybody asking for "September's orders" means. Sales orders carry it two ways, ISO from
   * the new-order form and day-first from the vendor side, which is why this goes through ptInRange
   * and not through a string compare. */
  const [sxD1, sxD2] = ptRangeOf('sxD1', 'sxD2');
  const rows = base
    .filter(o => !st || soStatus(o) === st)
    .filter(o => ptInRange(o && o.orderDate, sxD1, sxD2))
    .map(o => ({ o, s: soSummary(o, w) }))
    .filter(({ o, s }) => !q || [o._id, o.buyerName, o.buyerEmail, o.channel, soStatus(o)].join(' ').toLowerCase().includes(q)
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
      + `<td>${esc(o.orderDate)}</td><td>${esc(o.channel)}</td>`
      + `<td style="text-align:left">${esc(o.buyerName) || '<span class="muted">—</span>'}</td>`
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

function soOpen(id) {
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return;
  const s = soSummary(o, soWork());
  const shown = s.groups.slice(0, 400);
  /* WHO MAY MOVE A QUANTITY: whoever approved the order in the first place. */
  const mayQty = soCanApprove() && soStatus(o) === 'approved';
  const head = ['SKU', 'Image', 'Qty', 'Cut', 'Made', 'Owed', 'Delivery', 'Priority', 'In order book']
    .concat(mayQty ? [''] : [])
    .map((h, i) => `<th${i >= 2 && i <= 5 ? ' class="num"' : ''}>${h}</th>`).join('');
  const body = shown.map(g => {
    const owed = Math.max(0, g.qty - g.press);
    return `<tr${g.inBook ? '' : ' style="background:var(--bad-bg)"'}>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(g.sku)}`
      + `${g.lines > 1 ? ` <span class="muted" style="font-size:11px">${nf(g.lines)} lines</span>` : ''}`
      + `${g.adjusted ? ' <span class="pill pill-low">qty changed</span>' : ''}</td>`
      + ptImgCell(g.sku)
      + `<td class="num" style="font-weight:700">${nf(g.qty)}</td>`
      + `<td class="num" style="color:#7f6000">${nf(g.cut)}</td>`
      + `<td class="num" style="color:#166534">${nf(g.press)}</td>`
      + `<td class="num"${owed ? ' style="color:var(--bad);font-weight:700"' : ''}>${owed ? nf(owed) : '<span class="muted">—</span>'}</td>`
      + `<td>${esc(g.delivery) || '<span class="muted">—</span>'}</td>`
      + `<td>${esc(g.priority) || '<span class="muted">—</span>'}</td>`
      + `<td style="font-weight:700;color:${g.inBook ? 'var(--accent)' : 'var(--bad)'}">${g.inBook ? 'yes' : 'NO'}</td>`
      + (mayQty ? `<td><button class="ghost" data-so-qty="${esc(o._id)}|${esc(g.sku)}" style="padding:3px 9px;font-size:12px">Change qty</button></td>` : '')
      + '</tr>';
  }).join('');
  const removed = (Array.isArray(o.lineRemovals) ? o.lineRemovals : Object.values(o.lineRemovals || {}))
    .filter(Boolean).reduce((n, r) => n + (parseInt(r.count, 10) || soCount(r.lines)), 0);
  /* EVERY QUANTITY THAT MOVED, newest first. A figure that changed and cannot be explained three
   * weeks later is the reason this is kept at all. */
  const adj = Object.values(o.qtyAdjustments || {}).filter(Boolean)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  ptOpenDialog({
    title: 'Sales order ' + o._id,
    subtitle: `${o.channel || ''}${o.buyerName ? '  ·  ' + o.buyerName : ''}${o.buyerEmail ? '  ·  ' + o.buyerEmail : ''}`,
    note: `${nf(s.skus)} SKU(s) · ${nf(s.qty)} piece(s) · cut ${s.cutPct}% · made ${s.mfgPct}%.`
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
      + (s.groups.length > 400 ? `<div class="muted" style="margin-top:8px;font-size:12px">Showing the first 400 of ${nf(s.groups.length)} SKUs. Export gives you all of them.</div>` : '')
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
      $('sxMsg').textContent = sku + ' on ' + o._id + ' is now ' + nf(parseFloat(v.qty) || 0)
        + ' piece(s), and the order book says the same.';
      return '';
    },
  });
}

$('sxTable').addEventListener('click', e => {
  const o = e.target.closest('[data-so-open]'); if (o) return soOpen(o.getAttribute('data-so-open'));
  const ed = e.target.closest('[data-so-edit]'); if (ed) return soFormOpen(ed.getAttribute('data-so-edit'));
  const rv = e.target.closest('[data-so-review]'); if (rv) return soReview(rv.getAttribute('data-so-review'));
});
$('sxStatus').addEventListener('change', renderSox);
if ($('sxChan')) $('sxChan').addEventListener('change', renderSox);
['sxD1', 'sxD2'].forEach(id => $(id).addEventListener('change', renderSox));
$('sxClear').onclick = () => {
  ['sxQ', 'sxD1', 'sxD2'].forEach(id => $(id).value = '');
  $('sxStatus').value = '';
  if ($('sxChan')) $('sxChan').value = '';
  renderSox();
};
ptDebounce('sxQ', renderSox);
$('sxGo').onclick = async () => { SOX.rows = null; await ensureSox(); };
/* ================= A SHEET OF QUANTITY CHANGES =================
 *
 * The columns, in the order they are written. Everything before "New qty" is there to decide with
 * and is read back for nothing: the order and the SKU are the key, the rest is context.
 */
const SO_QTY_COLS = ['Order', 'SKU', 'Article', 'Size', 'On the order', 'Cut', 'Received', 'Pressed',
  'Cannot go below', 'New qty', 'Why'];

/** What is on the screen right now, ready to be edited — approved orders only. */
function soQtyTemplate() {
  const rows = (SOX.shown || []).filter(x => x && soStatus(x.o) === 'approved');
  if (!rows.length) {
    $('sxMsg').className = 'err';
    $('sxMsg').textContent = 'Nothing approved is on the screen to change. Clear the filters, or pick the orders you mean first.';
    return;
  }
  const w = soWork();
  const lines = [SO_QTY_COLS.map(csvCell).join(',')];
  let n = 0;
  rows.forEach(({ o }) => soSkus(o, w).forEach(g => {
    const d = soDoneOn(o._id, g.sku);
    /* The article and the size off the master row — soSkus carries neither, and a sheet of bare codes
     * is one nobody can check by eye before they type into it. */
    const m = mdbOf(g.sku) || {};
    n++;
    lines.push([o._id, g.sku, [m.articleType, m.subtype].filter(Boolean).join(' · '), m.size || '',
      g.qty, d.cut, d.made, d.pressed, d.floor, '', ''].map(csvCell).join(','));
  }));
  ptDownload('order-quantities', lines);
  $('sxMsg').className = 'muted';
  $('sxMsg').textContent = `${nf(n)} line(s) written. Fill in "New qty" and "Why" on the ones you want to change and `
    + 'leave the rest empty — an empty New qty means "leave this one alone".';
}

/** Read a filled sheet back, by column name. */
function soQtySheetRead(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  /* Its own column finder, the way the recipe sheet has its own: colIdx and cellAt live outside the
   * block this file's tests cut out, and a figure that decides what the floor makes should not be
   * read by something no test can reach. */
  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iO = at(['order', 'order no', 'order number']);
  const iS = at(['sku']);
  const iQ = at(['new qty', 'new quantity', 'qty', 'quantity']);
  const iW = at(['why', 'reason', 'remark', 'remarks']);
  if (iO < 0 || iS < 0 || iQ < 0)
    return { err: 'The file needs Order, SKU and "New qty" columns. Download the template to see them.' };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = j => (j >= 0 && rows[i][j] != null ? String(rows[i][j]).trim() : '');
    const order = cell(iO), sku = cell(iS), qty = cell(iQ);
    if (!order && !sku) continue;
    /* AN EMPTY New qty MEANS "LEAVE THIS ONE ALONE". Most of a 2,800-row sheet comes back untouched,
     * and reading an empty box as zero would close every order somebody did not mean to touch. */
    if (qty === '') continue;
    out.push({ row: i + 1, order, sku, qty, why: cell(iW) });
  }
  return { entries: out };
}

/** What the sheet would do, row by row, before anything is written. */
function soQtyBulkPlan(entries) {
  const ok = [], skip = [];
  const seen = new Map();
  (entries || []).forEach(e => {
    const key = obUC(e.order) + '|' + obUC(e.sku);
    /* THE SAME LINE TWICE IS TWO DIFFERENT ANSWERS, not a later one. */
    if (seen.has(key)) {
      skip.push({ row: e.row, key, why: 'the same order and SKU is on row ' + seen.get(key) + ' as well.' });
      return;
    }
    seen.set(key, e.row);
    const o = (SOX.rows || []).find(x => obUC(x._id) === obUC(e.order));
    if (!o) { skip.push({ row: e.row, key, why: 'there is no order called ' + (e.order || '(blank)') + '.' }); return; }
    if (!String(e.why || '').trim()) {
      skip.push({ row: e.row, key, why: 'say why it is changing — the Why column is empty.' });
      return;
    }
    const plan = soQtyPlan(o, e.sku, e.qty);
    if (plan.err) { skip.push({ row: e.row, key, why: plan.err }); return; }
    ok.push({ row: e.row, key, o, sku: plan.sku, from: plan.from, to: plan.to, delta: plan.delta,
      moves: plan.moves, book: plan.book, why: String(e.why).trim() });
  });
  return { ok, skip };
}

/**
 * Write what the plan showed, and nothing else.
 *
 * Built from the plan rather than worked out again, so what lands is what was agreed to. In batches,
 * because one sheet can carry hundreds of rows and a row-at-a-time write took minutes on the
 * approvals screen for the same reason.
 */
async function soQtyBulkRun(plan) {
  if (!soCanApprove()) return { err: SO_NO_APPROVE };
  const rows = (plan && plan.ok) || [];
  if (!rows.length) return { err: 'There is nothing to write.' };
  const now = new Date().toISOString();
  const all = [];
  rows.forEach(r => {
    /* A SHEET ASKS, LIKE THE BUTTON ASKS. Fifty rows that changed fifty figures the moment they were
     * uploaded is exactly what the floor was never told about. */
    const base = 'pt_salesOrders/' + r.o._id + '/';
    const logId = 'adj_' + Date.now() + '_' + String(all.length).padStart(4, '0') + '_' + Math.random().toString(36).slice(2, 6);
    const patch = {};
    patch[base + 'qtyAdjustments/' + logId] = { id: logId, sku: r.sku, from: r.from, to: r.to,
      why: r.why, by: ME.email, at: now, via: 'sheet', stage: 'pending' };
    patch[base + 'updatedAt'] = now;
    all.push({ r, patch });
  });
  let done = 0, stopped = null;
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const patch = {};
    batch.forEach(x => Object.assign(patch, x.patch));
    try { await ptPatch(patch); }
    catch (e) { stopped = e; break; }
    /* THE SCREEN FROM WHAT WAS WRITTEN, one order at a time — the same rule as the single ask. */
    batch.forEach(x => {
      const base = 'pt_salesOrders/' + x.r.o._id + '/';
      const o = (SOX.rows || []).find(y => y._id === x.r.o._id) || x.r.o;
      const adj = Object.assign({}, o.qtyAdjustments || {});
      Object.keys(x.patch).forEach(k => {
        if (k.indexOf(base + 'qtyAdjustments/') === 0) adj[k.slice((base + 'qtyAdjustments/').length)] = x.patch[k];
      });
      SOX.rows = (SOX.rows || []).map(y => (y._id === o._id
        ? Object.assign({}, o, { qtyAdjustments: adj, updatedAt: now }) : y));
      done++;
    });
    ptDlgMsg(`Writing… ${nf(done)} of ${nf(all.length)} line(s).`);
  }
  return { err: stopped ? 'Stopped after ' + nf(done) + ' of ' + nf(all.length) + ' line(s): '
    + (stopped.message || stopped) + ' The ones already written are done; upload the rest again.' : '', done };
}

$('sxExport').onclick = () => {
  const rows = SOX.shown || []; if (!rows.length) return;
  const w = soWork();
  const lines = [['Order', 'Date', 'Channel', 'Buyer', 'Status', 'SKU', 'Lines merged', 'Qty', 'Cut', 'Made', 'Owed', 'Delivery', 'Priority', 'In order book'].map(csvCell).join(',')];
  rows.forEach(({ o }) => soSkus(o, w).forEach(g => lines.push([o._id, o.orderDate, o.channel, o.buyerName, soStatus(o),
    g.sku, g.lines, g.qty, g.cut, g.press, Math.max(0, g.qty - g.press), g.delivery, g.priority,
    g.inBook ? 'yes' : 'no'].map(csvCell).join(','))));
  ptDownload('sales-orders', lines);
};

