/* ================= FINISHED GOODS: EXTERNAL ORDERS =================
 *
 * Ravi: "abhi bhi external order ke liye koi identifier nahi h". A receive now says where its order came
 * from — Order Console or External — as a choice on the form, and an external order carries its own
 * identity: the number (the customer's or platform's, or one made here as EXT-DDMMYYYY-NN), who placed it
 * (extOrderFrom), and, if known, how many pieces it asked for (extOrderQty). With a quantity, receiving
 * past it needs a reason and is flagged exactly like an Order Console order.
 */

/** An external order as the store knows it: the quantity typed now, else the one saved with an earlier receipt. */
function fgiExtOrder(orderNo, sku, typedQty) {
  const no = obUC(orderNo); if (!no) return null;
  const rows = (FGI.rows || []).filter(r => r && r.txnType === 'RECEIVE' && obUC(r.orderNo) === no && obUC(r.sku) === obUC(sku));
  const saved = rows.map(r => parseInt(r.extOrderQty, 10)).find(n => n >= 1) || 0;
  const qty = parseInt(typedQty, 10) >= 1 ? parseInt(typedQty, 10) : saved;
  const got = rows.reduce((t, r) => t + fgiNum(r.qty), 0);
  return { orderNo: no, qty, got, left: qty ? Math.max(0, qty - got) : 0, from: (rows.find(r => r.extOrderFrom) || {}).extOrderFrom || '' };
}

/** A number for an external order that came without one: EXT-DDMMYYYY-NN, the next free for that day. */
function fgiExtNewNo(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const p = n => String(n).padStart(2, '0');
  const base = `EXT-${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}-`;
  const used = new Set((FGI.rows || []).map(r => obUC(r && r.orderNo)).filter(n => n.startsWith(base)));
  let i = 1;
  while (used.has(base + p(i))) i++;
  return base + p(i);
}

