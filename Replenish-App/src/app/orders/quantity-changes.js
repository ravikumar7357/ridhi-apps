/* ================= A QUANTITY THAT MOVED, CARRIED TO THE PEOPLE MAKING IT =================
 *
 * The record lives on the sales order because that is where the decision was taken. Nobody on the
 * floor opens a sales order, so it is indexed here by the line it happened to and shown where the
 * work is.
 */
let ORD_ADJ_IX = { src: null, n: -1, map: null };
function ordQtyAdjIndex() {
  const src = SOX.rows || PT_NONE;
  if (ORD_ADJ_IX.map && ORD_ADJ_IX.src === src && ORD_ADJ_IX.n === src.length) return ORD_ADJ_IX.map;
  const map = new Map();
  src.forEach(o => {
    if (!o) return;
    Object.values(o.qtyAdjustments || {}).forEach(a => {
      if (!a || !a.sku) return;
      const k = obKeyOf(o._id, a.sku);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(Object.assign({ orderNo: o._id }, a));
    });
  });
  /* Newest first — the last thing that happened to a line is the thing somebody needs to read. The
   * id breaks a tie, because a sheet writes every one of its asks in the same millisecond. */
  map.forEach(l => l.sort((x, y) => String(y.at || '').localeCompare(String(x.at || ''))
    || String(y.id || '').localeCompare(String(x.id || ''))));
  ORD_ADJ_IX = { src, n: src.length, map };
  return map;
}
const ordQtyAdj = (orderNo, sku) => ordQtyAdjIndex().get(obKeyOf(orderNo, sku)) || [];
/** The ones waiting for an answer on this line. */
const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => soQtyStage(a) === 'pending');
/** Every one waiting across the whole book, oldest first — the order they should be answered in. */
const ordQtyUnseenAll = () => {
  const out = [];
  ordQtyAdjIndex().forEach(l => l.forEach(a => { if (soQtyStage(a) === 'pending') out.push(a); }));
  return out.sort((x, y) => String(x.at || '').localeCompare(String(y.at || ''))
    || String(x.id || '').localeCompare(String(y.id || '')));
};

/** Who answers a quantity change: the people doing the work, and the admins. */
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
  const plan = soQtyPlan(o, a.sku, a.to, logId);
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
}

/** The count on the sidebar, so it does not need the tab open to be noticed. */
function ordQtyBadge() {
  const el = $('ordAdjBadge'); if (!el) return;
  const n = ordQtyUnseenAll().length;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

/** How one change reads on a line: "was 100, now 150". */
const ordQtyPill = a => nf(a.from) + ' → ' + nf(a.to);

