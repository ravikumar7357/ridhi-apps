/* UNDO ORDERS OPENED FROM THE SHOPIFY PRODUCTION BUCKET BY MISTAKE (Ravi, 15 Oct: "production bucket me se kuch order
 * upload kiye h by mistake mujhe delete krne h" — all 61 opened that day). Builds the update, writes nothing.
 *   node probes/bucket-undo.js <backup.json> <day YYYY-MM-DD> <patch-out.json> [--keep-busy]
 * Removes the order-book rows opened from the bucket that day, and the order's sales order when nothing else of the order
 * is on the book (else only those lines leave it). Refuses a line with any production on it. Custom SKUs stay. */
const fs = require('fs');
const { lines, B } = require('./cleanup-plan.js');
const day = process.argv[3], out = process.argv[4];
const U = s => String(s == null ? '' : s).trim().toUpperCase();
const ob = Object.entries(B.pt_orderBook || {}).filter(([, r]) => r);
let opened = ob.filter(([, r]) => r.openedFrom === 'bucket' && String(r.openedAt || '').slice(0, 10) === day);
const orders = new Set(opened.map(([, r]) => U(r.orderNo)));
const act = l => (+l.cut || 0) + (+l.issued || 0) + (+l.received || 0) + (+l.made || 0) + (+l.pressed || 0) + (l.handedAt ? 1 : 0);
const busy = lines.filter(l => orders.has(U(l.orderNo)) && act(l) > 0);
if (busy.length && !process.argv.includes('--keep-busy')) { console.log('REFUSED — production on:', busy.map(l => l.orderNo + ' ' + l.sku).join(', ')); process.exit(1); }
// --keep-busy: an order with any production on it stays whole (rows and sales order); the rest go.
const kept = new Set(busy.map(l => U(l.orderNo)));
kept.forEach(no => orders.delete(no));
opened = opened.filter(([, r]) => orders.has(U(r.orderNo)));
if (kept.size) console.log('kept (production on them):', [...kept].join(', '));
const flow = Object.keys(B.pt_ppc || {}).filter(k => orders.has(U(k.split('__')[0])));
if (flow.length) { console.log('REFUSED — PPC plans on:', flow.join(', ')); process.exit(1); }
const patch = {}; let soDel = 0, soEdit = 0;
opened.forEach(([k]) => { patch['pt_orderBook/' + k] = null; });
orders.forEach(no => {
  const rest = ob.filter(([k, r]) => U(r.orderNo) === no && !(('pt_orderBook/' + k) in patch));
  const so = (B.pt_salesOrders || {})[no]; if (!so) return;
  if (!rest.length) { patch['pt_salesOrders/' + no] = null; soDel++; return; }
  const gone = new Set(opened.filter(([, r]) => U(r.orderNo) === no).map(([, r]) => U(r.sku)));
  const arr = (Array.isArray(so.lines) ? so.lines : Object.values(so.lines || {})).filter(Boolean);
  patch['pt_salesOrders/' + no + '/lines'] = arr.filter(x => !gone.has(U(x.sku))); patch['pt_salesOrders/' + no + '/updatedAt'] = new Date().toISOString(); soEdit++;
});
fs.writeFileSync(out, JSON.stringify(patch));
console.log(JSON.stringify({ orders: orders.size, rows: opened.length, salesOrdersDeleted: soDel, salesOrdersEdited: soEdit, paths: Object.keys(patch).length }));
