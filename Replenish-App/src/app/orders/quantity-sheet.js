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

/* The export's columns, each with the list column (page part) that shows it. Order is always written. A column the person's
 * list does not show is left out too (Buyer shows the person who raised a B2B order, so it needs Buyer AND Raised by), so the file matches the screen. That is tidiness, not security: the data is still in the browser. */
const SO_EXPORT_COLS = [
  { head: 'Order', value: o => o._id },
  { head: 'Date', part: 'so.col.date', value: o => o.orderDate },
  { head: 'Sale month', part: 'so.col.date', value: o => o.saleMonth || '' },
  { head: 'Channel', part: 'so.col.channel', value: o => o.channel },
  { head: 'Buyer', parts: ['so.col.buyer', 'so.col.raisedBy'], value: o => o.buyerName },
  { head: 'Status', part: 'so.col.status', value: o => soStatus(o) },
  { head: 'SKU', part: 'so.col.skus', value: (o, g) => g.sku },
  { head: 'Lines merged', part: 'so.col.skus', value: (o, g) => g.lines },
  { head: 'Qty', part: 'so.col.pieces', value: (o, g) => g.qty },
  { head: 'Cut', part: 'so.col.cut', value: (o, g) => g.cut },
  { head: 'Made', part: 'so.col.made', value: (o, g) => g.press },
  { head: 'Owed', part: 'so.col.made', value: (o, g) => Math.max(0, g.qty - g.press) },
  { head: 'Delivery', part: 'so.col.delivery', value: (o, g) => g.delivery },
  { head: 'Priority', part: 'so.col.delivery', value: (o, g) => g.priority },
  { head: 'In order book', part: 'so.col.inBook', value: (o, g) => (g.inBook ? 'yes' : 'no') },
];
const soExportCols = () => SO_EXPORT_COLS.filter(c => (c.parts || [c.part]).filter(Boolean).every(apxOn));

$('sxExport').onclick = () => {
  const rows = SOX.shown || []; if (!rows.length) return;
  const w = soWork();
  const cols = soExportCols();
  const lines = [cols.map(c => csvCell(c.head)).join(',')];
  rows.forEach(({ o }) => soSkus(o, w).forEach(g => lines.push(cols.map(c => csvCell(c.value(o, g))).join(','))));
  ptDownload('sales-orders', lines);
};

