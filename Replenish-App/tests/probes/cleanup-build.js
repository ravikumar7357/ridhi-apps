/* Builds the clean-up as ONE multi-path update (written with `firebase database:update /`). Ravi, 15 Oct, chose:
 *   1. pending lines (open, nothing cut / issued / received / QC'd / pressed) → removed from pt_orderBook and their
 *      sales order (an order left with no line goes);
 *   2. an open line with work started but not all of it → its quantity cut to what was started (max of cut, issued,
 *      received, made, pressed) on its order-book row and its sales-order line — not Shopify / online lines (a customer's
 *      order is not split), which keep their quantity;
 *   3. every open vendor order → Cancelled; every pending vendor-order request → withdrawn.
 *   node probes/cleanup-build.js <fresh-backup.json> <patch-out.json> */
const fs = require('fs');
const { lines, B } = require('./cleanup-plan.js');
const U = s => String(s == null ? '' : s).trim().toUpperCase();
const now = new Date().toISOString(), WHO = 'ravi@thefabricrush.com (clean-up 15 Oct)';
const act = l => (+l.cut || 0) + (+l.issued || 0) + (+l.received || 0) + (+l.made || 0) + (+l.pressed || 0);
const patch = {}, sum = { delLines: 0, delPcs: 0, delObRows: 0, soEdited: 0, soDeleted: 0, cut: 0, cutPcs: 0, cutSkipped: [], shpKept: 0, vo: 0, vreq: 0 };
const obByLine = new Map();
Object.entries(B.pt_orderBook || {}).forEach(([k, r]) => { if (!r) return; const key = U(r.orderNo) + '|' + U(r.sku); (obByLine.get(key) || obByLine.set(key, []).get(key)).push([k, r]); });
const soEdits = new Map();   // orderNo -> { del:Set(sku), set:Map(sku, qty) }
const soEd = no => soEdits.get(no) || soEdits.set(no, { del: new Set(), set: new Map() }).get(no);
lines.forEach(l => {
  if (!l.open) return;
  const rows = obByLine.get(U(l.orderNo) + '|' + U(l.sku)) || [];
  if (act(l) <= 0) {
    rows.forEach(([k]) => { patch['pt_orderBook/' + k] = null; sum.delObRows++; });
    soEd(U(l.orderNo)).del.add(U(l.sku)); sum.delLines++; sum.delPcs += +l.qty || 0;
    return;
  }
  const started = Math.round(Math.max(+l.cut || 0, +l.issued || 0, +l.received || 0, +l.made || 0, +l.pressed || 0));
  if (!(started > 0 && started < (+l.qty || 0))) return;
  if (l.mto || /^(SHP|ONL)-/.test(U(l.orderNo))) { sum.shpKept++; return; }
  if (rows.length !== 1) { sum.cutSkipped.push(l.orderNo + ' ' + l.sku + ' (' + rows.length + ' rows)'); return; }
  patch['pt_orderBook/' + rows[0][0] + '/qty'] = started;
  patch['pt_orderBook/' + rows[0][0] + '/remarks'] = String(rows[0][1].remarks || '') + ` · qty ${l.qty} → ${started} (only what was started; clean-up 15 Oct)`;
  soEd(U(l.orderNo)).set.set(U(l.sku), started); sum.cut++; sum.cutPcs += (+l.qty || 0) - started;
});
const keepNos = new Set(lines.filter(l => !l.open || act(l) > 0).map(l => U(l.orderNo)));
sum.soEmptied = 0;
soEdits.forEach((e, no) => {
  const so = (B.pt_salesOrders || {})[no]; if (!so) return;
  const arr = Array.isArray(so.lines) ? so.lines : Object.values(so.lines || {});
  const kept = arr.filter(x => x && !e.del.has(U(x.sku))).map(x => (e.set.has(U(x.sku)) ? Object.assign({}, x, { qty: e.set.get(U(x.sku)) }) : x));
  /* An order that keeps a line on the book keeps its sales order, whatever its own lines say (a Shopify order's quilt can be on
   * the book and not on the sales order): only the pending lines leave it. */
  if (!kept.length && !keepNos.has(no)) { patch['pt_salesOrders/' + no] = null; sum.soDeleted++; return; }
  if (!kept.length) { patch['pt_salesOrders/' + no + '/lines'] = null; patch['pt_salesOrders/' + no + '/updatedAt'] = now; sum.soEmptied++; return; }
  if (kept.length === arr.filter(Boolean).length && !e.set.size) return;
  patch['pt_salesOrders/' + no + '/lines'] = kept; patch['pt_salesOrders/' + no + '/updatedAt'] = now; sum.soEdited++;
});
Object.entries(B.pt_vendorOrders || {}).forEach(([code, m]) => Object.entries(m || {}).forEach(([id, o]) => {
  if (!o || typeof o !== 'object' || !(o.lines || o.status)) return;
  if (['Received', 'Cancelled'].indexOf(o.status || 'Placed') >= 0) return;
  patch[`pt_vendorOrders/${code}/${id}/status`] = 'Cancelled';
  patch[`pt_vendorOrders/${code}/${id}/staffUpdatedAt`] = now;
  patch[`pt_vendorOrders/${code}/${id}/cancelNote`] = 'Cancelled in the clean-up of 15 Oct — orders go through the new PPC flow';
  sum.vo++;
}));
Object.entries(B.pt_vendorOrderReqs || {}).forEach(([id, r]) => {
  if (!r || r.status !== 'pending') return;
  patch['pt_vendorOrderReqs/' + id + '/status'] = 'withdrawn';
  patch['pt_vendorOrderReqs/' + id + '/withdrawnBy'] = WHO;
  patch['pt_vendorOrderReqs/' + id + '/withdrawnAt'] = now;
  patch['pt_vendorOrderReqs/' + id + '/log'] = (Array.isArray(r.log) ? r.log : []).concat([{ at: now, by: WHO, what: 'Withdrawn (clean-up 15 Oct)' }]);
  sum.vreq++;
});
fs.writeFileSync(process.argv[3], JSON.stringify(patch));
console.log(JSON.stringify(Object.assign({}, sum, { cutSkipped: sum.cutSkipped.length, cutSkippedList: sum.cutSkipped.slice(0, 10), paths: Object.keys(patch).length }), null, 1));
