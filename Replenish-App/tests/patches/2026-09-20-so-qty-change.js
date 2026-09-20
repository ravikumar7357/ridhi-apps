/* CHANGING THE QUANTITY ON AN ORDER THAT IS ALREADY OUT.
 *
 * "mujhe kisi order me qty increase krwani h ya decrease karwani h to uska flow set kro."
 *
 * THERE WAS NO FLOW, AND THE OBVIOUS ONE IS A TRAP. Editing an approved order and approving it again
 * does nothing to the figure production works to, because soApproveRun deliberately skips a SKU the
 * order book already has:
 *     if (qty <= 0 || have.has(s)) return;
 * That line is what stops a second approval duplicating every production row, and it is right — but
 * it also means a quantity changed afterwards reaches nobody. The sales order would say 120 and the
 * floor would go on making 100, with nothing anywhere to say the two disagree. Measured today: the
 * two agree on all 2,720 SKUs that reached the book, and that is worth keeping.
 *
 * SO ONE THING CHANGES BOTH, IN ONE WRITE. The sales-order lines and the order-book row move together
 * or neither moves, which is the only way they cannot drift.
 *
 * AND IT CANNOT GO BELOW WHAT HAS BEEN DONE. Of 2,860 approved (order, SKU) pairs, 343 are part made
 * and 469 are finished — 48,451 pieces have been cut, made, pressed or put into store. Cutting an
 * order below that does not un-make anything; it just makes the registers describe pieces that are
 * on the floor as pieces nobody ordered. The floor is the largest of what has been cut, received,
 * pressed and taken into store, and it is named in the refusal.
 *
 * WHERE THE CHANGE LANDS, when one SKU is on several lines of one order — 180 of the 2,860 are:
 * extra goes onto the LATEST promise, and a cut comes off the latest first, so the earliest delivery
 * date keeps its pieces. Anything else would quietly move work between two dates.
 *
 * IT IS WRITTEN DOWN. previousQty on the line (the SKU table has drawn a "qty changed" pill off it
 * since before anything could write one) and an entry in qtyAdjustments saying who, when, from what,
 * to what, and why. A quantity that changed with no reason recorded is the thing nobody can explain
 * three weeks later.
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

/* ---- 1. what has been done against one line, and what it may not go below ---- */
one(`function soCurrentNetQty(sku, typeKey) {`,
`/**
 * WHAT HAS ALREADY BEEN DONE against one order and one SKU, and the number the order may not go
 * below.
 *
 * The largest of the four, not the sum: they are four views of the same pieces walking through the
 * factory, and adding them would say 400 pieces exist where 100 do. Into-store is counted from the
 * finished-goods rows that name this order — the ones that do not are somebody else's problem and
 * must not hold a quantity up.
 */
function soDoneOn(orderNo, sku) {
  const k = obKeyOf(orderNo, sku);
  const cut = obCutQty(orderNo, sku);
  const b = obBaseIndex().get(k);
  const made = b ? b.received : 0;
  const pressed = obPressQty(orderNo, sku);
  const store = (FGI.rows || []).reduce((a, r) => (r && obUC(r.orderNo) === obUC(orderNo) && obUC(r.sku) === obUC(sku)
    && fgiNum(r.pieces) > 0 ? a + fgiNum(r.pieces) : a), 0);
  return { cut, made, pressed, store, floor: Math.max(cut, made, pressed, store) };
}

/** The lines of one order that carry one SKU, with where each sits in the stored array. */
const soLinesOf = (o, sku) => soLines(o)
  .map((l, i) => ({ l, i }))
  .filter(x => obUC(x.l.sku) === obUC(sku));

/** What this order says it wants of one SKU today. */
const soQtyOf = (o, sku) => soLinesOf(o, sku).reduce((a, x) => a + (parseFloat(x.l.qty) || 0), 0);

/** The order-book row an approved sales order writes for one SKU — the id soApproveRun uses. */
const soBookId = (orderNo, sku) => 'ob_so_' + obUC(orderNo) + '_' + obUC(sku);

function soCurrentNetQty(sku, typeKey) {`, 'what has been done, and the floor');

/* ---- 2. the change itself ---- */
one(`/* ---- B2B ---- */
const soIsB2B = ch => String(ch || '').trim().toUpperCase() === 'B2B';`,
`/**
 * MOVE A SKU'S QUANTITY ON AN ORDER THAT IS ALREADY OUT — the sales order and the order book together.
 *
 * Returns a plan rather than writing, so the dialog can show exactly what would happen before it
 * happens: which lines move, what the book row becomes, and why it is refused when it is.
 */
function soQtyPlan(o, sku, want) {
  if (!o) return { err: 'That order is gone.' };
  if (soStatus(o) !== 'approved') return { err: 'Only an approved order has anything in the order book to change. Edit a draft on the order itself.' };
  const mine = soLinesOf(o, sku);
  if (!mine.length) return { err: 'That SKU is not on this order.' };
  const now = soQtyOf(o, sku);
  const n = parseFloat(want);
  if (!isFinite(n) || n < 0) return { err: 'What should the new quantity be?' };
  if (Math.round(n) !== n) return { err: 'Pieces have to be a whole number.' };
  if (n === now) return { err: 'That is what it already says.' };
  const done = soDoneOn(o._id, sku);
  /* THE FLOOR. Reducing below what is already made does not un-make it — it leaves the registers
   * describing pieces on the floor as pieces nobody ordered. */
  if (n < done.floor) {
    const which = [done.cut === done.floor && 'cut', done.made === done.floor && 'received',
      done.pressed === done.floor && 'pressed', done.store === done.floor && 'taken into store']
      .filter(Boolean).join(' / ');
    return { err: nf(done.floor) + ' piece(s) have already been ' + which + ' against this order, so it '
      + 'cannot go below ' + nf(done.floor) + '. Set it to ' + nf(done.floor) + ' to close it at what was made.' };
  }
  /* WHERE IT LANDS. Extra onto the latest promise; a cut off the latest first, so the earliest
   * delivery date keeps its pieces. */
  const order = mine.slice().sort((a, b) =>
    String(a.l.deliveryDate || '').localeCompare(String(b.l.deliveryDate || '')) || a.i - b.i);
  const moves = [];
  let delta = n - now;
  if (delta > 0) {
    const last = order[order.length - 1];
    moves.push({ i: last.i, from: parseFloat(last.l.qty) || 0, to: (parseFloat(last.l.qty) || 0) + delta });
  } else {
    let cut = -delta;
    for (let j = order.length - 1; j >= 0 && cut > 0; j--) {
      const q = parseFloat(order[j].l.qty) || 0;
      const take = Math.min(q, cut);
      if (!take) continue;
      cut -= take;
      moves.push({ i: order[j].i, from: q, to: q - take });
    }
  }
  const book = (PTG.ob || []).find(r => r && r.id === soBookId(o._id, sku));
  return { err: '', sku: obUC(sku), from: now, to: n, delta: n - now, done, moves,
    book: book ? (parseFloat(book.qty) || 0) : null };
}

async function soQtyRun(o, sku, want, why) {
  if (!soCanApprove()) return SO_NO_APPROVE;
  const plan = soQtyPlan(o, sku, want);
  if (plan.err) return plan.err;
  const reason = String(why || '').trim();
  /* A CHANGE WITH NO REASON IS THE ONE NOBODY CAN EXPLAIN LATER. */
  if (!reason) return 'Say why it is changing — it goes on the order beside the figure.';
  const now = new Date().toISOString();
  const lines = soLines(o).slice();
  const patch = {};
  plan.moves.forEach(m => {
    patch['pt_salesOrders/' + o._id + '/lines/' + m.i + '/qty'] = m.to;
    patch['pt_salesOrders/' + o._id + '/lines/' + m.i + '/previousQty'] = m.from;
    lines[m.i] = Object.assign({}, lines[m.i], { qty: m.to, previousQty: m.from });
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
  const adj = Object.assign({}, o.qtyAdjustments || {}); adj[logId] = log;
  const next = Object.assign({}, o, { lines, qtyAdjustments: adj, updatedAt: now });
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id ? next : x));
  if (plan.book != null) PTG.ob = (PTG.ob || []).map(r =>
    (r && r.id === soBookId(o._id, sku) ? Object.assign({}, r, { qty: plan.to }) : r));
  return '';
}

/* ---- B2B ---- */
const soIsB2B = ch => String(ch || '').trim().toUpperCase() === 'B2B';`, 'the plan and the write');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
