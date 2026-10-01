/* ================= FINISHED GOODS: ENTRY-ONLY ACCESS, AND THE ORDER A RECEIPT BELONGS TO =================
 *
 * Ravi: "meri team member ko only stock add (issue, receive, fba sent) — 3 action perform kar sake wo
 * access dena … jab bhi goods received ho uske liye hamesha 1 order number hona chahiye which is came
 * from order console (auto aana chahiye); yadi koi order external aaya h then wo uska order number
 * manually enter kar sake".
 *
 * TWO RIGHTS NOW, not one:
 *   perms.fgiEntry  "Can add stock entries" — Receive, Issue, Send to FBA. Nothing else: no edit, no
 *                   delete, no opening stock, no count correction, no ticking in bulk.
 *   perms.fgiEdit   "Can edit finished goods" — everything, and it includes entering.
 *
 * EVERY RECEIVE CARRIES AN ORDER NUMBER. It is offered from the Order Console: the orders that have a
 * line for this SKU, the ones still short of pieces first, oldest first — and the first of those is
 * filled in by itself. A different one can be picked, or an order the Order Console has never seen
 * (an outside order) typed in; that is saved with orderSource 'external' so the two are never confused.
 *
 * AN ORDER NUMBER THAT IS IN THE ORDER CONSOLE BUT HAS NO LINE FOR THIS SKU IS REFUSED. That is almost
 * always the wrong order picked, and calling it "external" would hide the mistake for ever.
 *
 * RECEIVING MORE THAN THE ORDER ASKED FOR WARNS ONCE and then lets it through — a real over-delivery has
 * to be recordable, and the warning is what makes it a decision rather than a typo.
 */
const fgiCanEntry = () => !spIsVendor() && !!(ME.admin || ME.fgiEdit || ME.fgiEntry);
const FGI_NO_ENTRY = 'Only somebody with "Can add stock entries" or "Can edit finished goods" (or an admin) can enter stock. '
  + 'Ask an admin to tick it in Sellora → Settings → Access.';

/** Pieces already received into the store against one order and SKU. */
const fgiRecvOnOrder = (orderNo, sku) => (FGI.rows || [])
  .filter(r => r && r.txnType === 'RECEIVE' && obUC(r.orderNo) === obUC(orderNo) && obUC(r.sku) === obUC(sku))
  .reduce((t, r) => t + fgiNum(r.qty), 0);

/** The Order Console's orders for a SKU: still short first, then oldest first. */
function fgiOrdersFor(sku) {
  const s = obUC(sku); if (!s) return [];
  let lines = [];
  try { lines = ordLines(); } catch (e) { lines = []; }
  return lines.filter(l => l.sku === s).map(l => {
    const got = fgiRecvOnOrder(l.orderNo, s);
    return { orderNo: l.orderNo, date: l.orderDate || '', qty: l.qty, got, left: Math.max(0, l.qty - got) };
  }).sort((a, b) => (b.left > 0) - (a.left > 0) || String(a.date).localeCompare(String(b.date)) || a.orderNo.localeCompare(b.orderNo));
}

/** Is this order number known to the Order Console at all, for any SKU? */
function fgiOrderKnown(orderNo) {
  const o = obUC(orderNo); if (!o) return false;
  try { return ordLines().some(l => l.orderNo === o); } catch (e) { return false; }
}

/** Fill the order box and its list for the SKU typed. Only replaces a value this function put there. */
function fgiOrdFill(sku) {
  const box = $('fgmOrd'), list = $('fgmOrdList');
  if (!box) return [];
  const ords = fgiOrdersFor(sku);
  const srcEl = $('fgmOrdSrc');
  /* Nobody has chosen yet: a SKU with Order Console orders starts on the console, one without on external. */
  if (srcEl && !(srcEl.dataset && srcEl.dataset.touched === '1')) srcEl.value = ords.length || !obUC(sku) ? 'console' : 'external';
  if (srcEl && srcEl.value === 'external') {
    const past = [...new Set((FGI.rows || []).filter(r => r && r.orderSource === 'external' && obUC(r.sku) === obUC(sku)).map(r => r.orderNo))];
    if (list) list.innerHTML = past.map(n => `<option value="${esc(n)}">external · received before</option>`).join('');
    if (box.dataset && box.dataset.auto === '1') { box.value = ''; box.dataset.auto = ''; }
    return ords;
  }
  if (list) list.innerHTML = ords.map(o => `<option value="${esc(o.orderNo)}">${esc(
    `${o.date ? o.date + ' · ' : ''}ordered ${nf(o.qty)} · ${nf(o.got)} received${o.left ? ' · ' + nf(o.left) + ' still to come' : ' · complete'}`)}</option>`).join('');
  const auto = box.dataset && box.dataset.auto === '1';
  if (!String(box.value || '').trim() || auto) {
    box.value = ords.length ? ords[0].orderNo : '';
    if (box.dataset) box.dataset.auto = ords.length ? '1' : '';
  }
  return ords;
}

