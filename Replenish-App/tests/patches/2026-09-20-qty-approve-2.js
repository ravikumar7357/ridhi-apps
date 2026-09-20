/* The answer half: production approves or rejects, and only an approval moves the figures. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- the bulk sheet asks, it does not change ---- */
one(`  const now = new Date().toISOString();
  const all = [];
  rows.forEach(r => {
    const base = 'pt_salesOrders/' + r.o._id + '/';
    const patch = {};
    r.moves.forEach(m => {
      patch[base + 'lines/' + m.i + '/qty'] = m.to;
      patch[base + 'lines/' + m.i + '/previousQty'] = m.from;
    });
    const logId = 'adj_' + Date.now() + '_' + String(all.length).padStart(4, '0') + '_' + Math.random().toString(36).slice(2, 6);
    patch[base + 'qtyAdjustments/' + logId] = { id: logId, sku: r.sku, from: r.from, to: r.to,
      why: r.why, by: ME.email, at: now, via: 'sheet' };
    patch[base + 'updatedAt'] = now;
    if (r.book != null) patch['pt_orderBook/' + soBookId(r.o._id, r.sku) + '/qty'] = r.to;
    all.push({ r, patch });
  });`,
`  const now = new Date().toISOString();
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
  });`, 'the sheet asks too');

one(`    /* THE SCREEN FROM WHAT WAS WRITTEN, one order at a time — the same rule as the single change. */
    batch.forEach(x => {
      const base = 'pt_salesOrders/' + x.r.o._id + '/';
      const o = (SOX.rows || []).find(y => y._id === x.r.o._id) || x.r.o;
      const lines = soLines(o).map((l, j) => (x.patch[base + 'lines/' + j + '/qty'] === undefined ? l
        : Object.assign({}, l, { qty: x.patch[base + 'lines/' + j + '/qty'],
          previousQty: x.patch[base + 'lines/' + j + '/previousQty'] })));
      const adj = Object.assign({}, o.qtyAdjustments || {});
      Object.keys(x.patch).forEach(k => {
        if (k.indexOf(base + 'qtyAdjustments/') === 0) adj[k.slice((base + 'qtyAdjustments/').length)] = x.patch[k];
      });
      const next = Object.assign({}, o, { lines, qtyAdjustments: adj, updatedAt: now });
      SOX.rows = (SOX.rows || []).map(y => (y._id === o._id ? next : y));
      const bp = 'pt_orderBook/' + soBookId(x.r.o._id, x.r.sku) + '/qty';
      if (x.patch[bp] !== undefined) PTG.ob = (PTG.ob || []).map(rr =>
        (rr && rr.id === soBookId(x.r.o._id, x.r.sku) ? Object.assign({}, rr, { qty: x.patch[bp] }) : rr));
      done++;
    });`,
`    /* THE SCREEN FROM WHAT WAS WRITTEN, one order at a time — the same rule as the single ask. */
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
    });`, 'and the sheet only records the asks');

/* ---- the answer ---- */
one(`/**
 * SOMEBODY ON THE FLOOR SAYS THEY HAVE SEEN IT.
 *
 * Stamped onto the adjustment itself, where whoever changed the quantity reads it back — a message
 * that is delivered and a message that is read are different things, and the person who changed a
 * figure needs to know which one this was.
 */
async function ordQtySeen(orderNo, logId) {
  const o = (SOX.rows || []).find(x => x && obUC(x._id) === obUC(orderNo));
  if (!o) return 'That order is gone.';
  const a = (o.qtyAdjustments || {})[logId];
  if (!a) return 'That change is gone.';
  if (a.seenAt) return '';
  const now = new Date().toISOString();
  const base = 'pt_salesOrders/' + o._id + '/qtyAdjustments/' + logId + '/';
  const patch = { [base + 'seenAt']: now, [base + 'seenBy']: ME.email };
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  /* FROM WHAT WAS WRITTEN, not from a second copy of the same reasoning — the same rule as the
   * change itself. Otherwise the screen says "seen" for a write that never left. */
  const adj = Object.assign({}, o.qtyAdjustments);
  adj[logId] = Object.assign({}, a, { seenAt: patch[base + 'seenAt'], seenBy: patch[base + 'seenBy'] });
  /* A NEW ARRAY, which is what the index invalidates on — it holds the one it was built from and
   * compares by identity, so there is nothing else to clear. */
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id ? Object.assign({}, x, { qtyAdjustments: adj }) : x));
  ordQtyBadge();
  return '';
}`,
`/** Who answers a quantity change: the people doing the work, and the admins. */
const ordQtyCanApprove = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).includes('ord'));

/**
 * APPROVE A CHANGE — and this is the moment the figures move.
 *
 * THE PLAN IS WORKED OUT AGAIN, not carried from when it was asked. Pieces get cut between the two,
 * and other changes land, so a request to drop a line to 20 that was fine on Monday is refused on
 * Wednesday if 40 have been made since. What was agreed to is the FIGURE; the arithmetic behind it
 * belongs to the moment it is applied.
 *
 * The sales-order lines and the order book move in ONE write with the stamp that says it was
 * approved, so there is no instant where one of the three disagrees with the others.
 */
async function ordQtyApprove(orderNo, logId) {
  if (!ordQtyCanApprove()) return 'Approving a quantity change needs the Order Console.';
  const o = (SOX.rows || []).find(x => x && obUC(x._id) === obUC(orderNo));
  if (!o) return 'That order is gone.';
  const a = (o.qtyAdjustments || {})[logId];
  if (!a) return 'That request is gone.';
  if (soQtyStage(a) !== 'pending') return 'That one has already been answered.';
  const plan = soQtyPlan(o, a.sku, a.to);
  if (plan.err) return a.sku + ': ' + plan.err;
  const now = new Date().toISOString();
  const base = 'pt_salesOrders/' + o._id + '/';
  const patch = {};
  plan.moves.forEach(m => {
    patch[base + 'lines/' + m.i + '/qty'] = m.to;
    patch[base + 'lines/' + m.i + '/previousQty'] = m.from;
  });
  patch[base + 'qtyAdjustments/' + logId + '/stage'] = 'applied';
  patch[base + 'qtyAdjustments/' + logId + '/decidedBy'] = ME.email;
  patch[base + 'qtyAdjustments/' + logId + '/decidedAt'] = now;
  /* WHAT IT ACTUALLY MOVED FROM, which is not always what the ask said: the line may have moved in
   * between, and the record should say what happened rather than what was expected. */
  patch[base + 'qtyAdjustments/' + logId + '/appliedFrom'] = plan.from;
  patch[base + 'updatedAt'] = now;
  if (plan.book != null) patch['pt_orderBook/' + soBookId(o._id, a.sku) + '/qty'] = plan.to;
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  /* THE SCREEN FROM WHAT WAS WRITTEN, never from a second run of the same reasoning. */
  const lines = soLines(o).map((l, i) => (patch[base + 'lines/' + i + '/qty'] === undefined ? l
    : Object.assign({}, l, { qty: patch[base + 'lines/' + i + '/qty'],
      previousQty: patch[base + 'lines/' + i + '/previousQty'] })));
  const adj = Object.assign({}, o.qtyAdjustments);
  adj[logId] = Object.assign({}, a, { stage: patch[base + 'qtyAdjustments/' + logId + '/stage'],
    decidedBy: patch[base + 'qtyAdjustments/' + logId + '/decidedBy'],
    decidedAt: patch[base + 'qtyAdjustments/' + logId + '/decidedAt'],
    appliedFrom: patch[base + 'qtyAdjustments/' + logId + '/appliedFrom'] });
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id
    ? Object.assign({}, o, { lines, qtyAdjustments: adj, updatedAt: now }) : x));
  const bp = 'pt_orderBook/' + soBookId(o._id, a.sku) + '/qty';
  if (patch[bp] !== undefined) PTG.ob = (PTG.ob || []).map(r =>
    (r && r.id === soBookId(o._id, a.sku) ? Object.assign({}, r, { qty: patch[bp] }) : r));
  ordQtyBadge();
  return '';
}

/** Say no, with a reason — which is the part the person who asked has to read. */
async function ordQtyReject(orderNo, logId, why) {
  if (!ordQtyCanApprove()) return 'Answering a quantity change needs the Order Console.';
  const o = (SOX.rows || []).find(x => x && obUC(x._id) === obUC(orderNo));
  if (!o) return 'That order is gone.';
  const a = (o.qtyAdjustments || {})[logId];
  if (!a) return 'That request is gone.';
  if (soQtyStage(a) !== 'pending') return 'That one has already been answered.';
  const note = String(why || '').trim();
  if (!note) return 'Say why it is being turned down — the sales team reads it on the order.';
  const now = new Date().toISOString();
  const base = 'pt_salesOrders/' + o._id + '/qtyAdjustments/' + logId + '/';
  const patch = { [base + 'stage']: 'rejected', [base + 'decidedBy']: ME.email,
    [base + 'decidedAt']: now, [base + 'decidedWhy']: note };
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const adj = Object.assign({}, o.qtyAdjustments);
  adj[logId] = Object.assign({}, a, { stage: patch[base + 'stage'], decidedBy: patch[base + 'decidedBy'],
    decidedAt: patch[base + 'decidedAt'], decidedWhy: patch[base + 'decidedWhy'] });
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id ? Object.assign({}, x, { qtyAdjustments: adj }) : x));
  ordQtyBadge();
  return '';
}

/** Answer a list of them in one go, and say what happened to each. */
async function ordQtyAnswerRun(ids, reject, why) {
  const list = (ids || []).map(k => { const [orderNo, logId] = String(k).split('|'); return { orderNo, logId }; });
  if (!list.length) return 'Tick the ones you are answering first.';
  const bad = [];
  let done = 0;
  for (const x of list) {
    const err = reject ? await ordQtyReject(x.orderNo, x.logId, why) : await ordQtyApprove(x.orderNo, x.logId);
    if (err) bad.push(x.orderNo + ': ' + err); else done++;
  }
  renderOrd();
  if (!bad.length) return '';
  /* PART DONE IS PART DONE. Saying "failed" when eleven of twelve went through sends somebody to
   * approve them all again. */
  return nf(done) + ' answered. ' + nf(bad.length) + ' could not be: ' + bad.slice(0, 4).join(' · ')
    + (bad.length > 4 ? ' and ' + nf(bad.length - 4) + ' more.' : '');
}`, 'approve, reject, and both at once');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
