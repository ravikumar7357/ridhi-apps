/* A QUANTITY CHANGE NOW WAITS TO BE APPROVED, THE WAY A SALES ORDER DOES.
 *
 * Ravi: "window aise nahi dikhni chahiye — jese sale order approve hota h bese hi qty changed wala
 * approve ho." And he chose, when asked: the change SITS until somebody on the floor approves it, and
 * the Order Console holders are the ones who approve.
 *
 * WHAT CHANGES. Asking for a change no longer changes anything. The sales-order line stays where it
 * is, the order book stays where it is, and a request is written. Production approves it and BOTH
 * move, in one write. They can reject it with a reason instead. This is stronger than the "Seen"
 * link it replaces: "pata hi nahi chala" cannot happen when the number cannot move until somebody
 * acts on it.
 *
 * THE PLAN IS WORKED OUT AGAIN AT APPROVAL, not carried from when it was asked. Between the two,
 * pieces get cut and other changes land — so a request to drop a line to 20 that was fine on Monday
 * is refused on Wednesday if 40 have been made since. What was agreed to is the FIGURE, not the
 * arithmetic behind it.
 *
 * EVERY CHANGE ALREADY MADE COUNTS AS APPROVED. 57 went in this morning under the old rule, which
 * applied them on the spot. They did happen, so a record with no stage reads as applied — reading
 * them as pending would ask the floor to approve things that are already on machines.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. asking no longer changes anything ---- */
one(`  if (n === now) return { err: 'That is what it already says.' };`,
`  if (n === now) return { err: 'That is what it already says.' };
  /* ONE ASK AT A TIME PER LINE. Two requests waiting on the same SKU, one saying 80 and one saying
   * 120, is two different answers and whichever is approved second would quietly undo the first. */
  const waiting = Object.values(o.qtyAdjustments || {})
    .find(a => a && obUC(a.sku) === obUC(sku) && soQtyStage(a) === 'pending');
  if (waiting) return { err: 'A change to ' + nf(waiting.to) + ' is already waiting for production to approve. '
    + 'They have to answer that one first.' };`, 'one ask at a time');

one(`/**
 * MOVE A SKU'S QUANTITY ON AN ORDER THAT IS ALREADY OUT — the sales order and the order book together.`,
`/**
 * Where a change has got to. A record written before this existed applied on the spot, so it is
 * applied — reading those as pending would ask the floor to approve what is already on a machine.
 */
const soQtyStage = a => String((a && a.stage) || 'applied');

/**
 * MOVE A SKU'S QUANTITY ON AN ORDER THAT IS ALREADY OUT — the sales order and the order book together.`, 'the stage');

one(`async function soQtyRun(o, sku, want, why) {
  if (!soCanApprove()) return SO_NO_APPROVE;
  const plan = soQtyPlan(o, sku, want);
  if (plan.err) return plan.err;
  const reason = String(why || '').trim();
  /* A CHANGE WITH NO REASON IS THE ONE NOBODY CAN EXPLAIN LATER. */
  if (!reason) return 'Say why it is changing — it goes on the order beside the figure.';
  const now = new Date().toISOString();
  const patch = {};
  plan.moves.forEach(m => {
    patch['pt_salesOrders/' + o._id + '/lines/' + m.i + '/qty'] = m.to;
    patch['pt_salesOrders/' + o._id + '/lines/' + m.i + '/previousQty'] = m.from;
  });
  const logId = 'adj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const log = { id: logId, sku: plan.sku, from: plan.from, to: plan.to, why: reason,
    by: ME.email, at: now };
  patch['pt_salesOrders/' + o._id + '/qtyAdjustments/' + logId] = log;
  patch['pt_salesOrders/' + o._id + '/updatedAt'] = now;
  /* AND THE ORDER BOOK IN THE SAME WRITE. Two writes could leave the two disagreeing, which is the
   * whole thing this is here to prevent. A SKU the book never got is left alone and said out loud —
   * "Add the missing" is the button for that, and it builds the row from these same lines. */
  if (plan.book != null) patch['pt_orderBook/' + soBookId(o._id, sku) + '/qty'] = plan.to;
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  /* THE SCREEN IS BUILT FROM WHAT WAS WRITTEN, not from a second run of the same reasoning. Two
   * independent builds is exactly how a screen comes to show a change the database never took —
   * and how a test of the screen passes while the write is missing. */
  const base = 'pt_salesOrders/' + o._id + '/';
  const lines = soLines(o).map((l, i) => (patch[base + 'lines/' + i + '/qty'] === undefined ? l
    : Object.assign({}, l, { qty: patch[base + 'lines/' + i + '/qty'],
      previousQty: patch[base + 'lines/' + i + '/previousQty'] })));
  const adj = Object.assign({}, o.qtyAdjustments || {});
  Object.keys(patch).forEach(k => {
    const at = k.indexOf(base + 'qtyAdjustments/');
    if (at === 0) adj[k.slice((base + 'qtyAdjustments/').length)] = patch[k];
  });
  const next = Object.assign({}, o, { lines, qtyAdjustments: adj, updatedAt: patch[base + 'updatedAt'] || o.updatedAt });
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id ? next : x));
  const bookPath = 'pt_orderBook/' + soBookId(o._id, sku) + '/qty';
  if (patch[bookPath] !== undefined) PTG.ob = (PTG.ob || []).map(r =>
    (r && r.id === soBookId(o._id, sku) ? Object.assign({}, r, { qty: patch[bookPath] }) : r));
  return '';
}`,
`/**
 * ASK FOR A QUANTITY TO CHANGE. It does not change anything.
 *
 * The sales-order line and the order book both stay exactly where they are until somebody on the
 * floor approves it — the same way a sales order does nothing until it is approved. The plan is run
 * here only to refuse an ask that could never be granted, so nobody waits on an answer of no.
 */
async function soQtyRun(o, sku, want, why) {
  if (!soCanApprove()) return SO_NO_APPROVE;
  const plan = soQtyPlan(o, sku, want);
  if (plan.err) return plan.err;
  const reason = String(why || '').trim();
  /* A CHANGE WITH NO REASON IS THE ONE NOBODY CAN EXPLAIN LATER. */
  if (!reason) return 'Say why it is changing — it goes on the order beside the figure.';
  const now = new Date().toISOString();
  const logId = 'adj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const log = { id: logId, sku: plan.sku, from: plan.from, to: plan.to, why: reason,
    by: ME.email, at: now, stage: 'pending' };
  const base = 'pt_salesOrders/' + o._id + '/';
  const patch = { [base + 'qtyAdjustments/' + logId]: log, [base + 'updatedAt']: now };
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const adj = Object.assign({}, o.qtyAdjustments || {});
  adj[logId] = patch[base + 'qtyAdjustments/' + logId];
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id
    ? Object.assign({}, x, { qtyAdjustments: adj, updatedAt: patch[base + 'updatedAt'] }) : x));
  return '';
}`, 'asking only asks');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
