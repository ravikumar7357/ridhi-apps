/* What production is on the bucket-opened lines that bucket-undo refuses (read-only).
 *   node probes/bucket-busy.js <backup.json> <day YYYY-MM-DD> */
const { lines, B } = require('./cleanup-plan.js');
const day = process.argv[3];
const U = s => String(s == null ? '' : s).trim().toUpperCase();
const L = o => (Array.isArray(o) ? o : Object.values(o || {})).filter(Boolean);
const orders = new Set(Object.values(B.pt_orderBook || {}).filter(r => r && r.openedFrom === 'bucket' && String(r.openedAt || '').slice(0, 10) === day).map(r => U(r.orderNo)));
const act = l => (+l.cut || 0) + (+l.issued || 0) + (+l.received || 0) + (+l.made || 0) + (+l.pressed || 0) + (l.handedAt ? 1 : 0);
const busy = lines.filter(l => orders.has(U(l.orderNo)) && act(l) > 0);
const keys = new Set(busy.map(l => U(l.orderNo) + '|' + U(l.sku)));
busy.forEach(l => console.log(l.orderNo, l.sku, 'qty', l.qty, 'cut', l.cut, 'issued', l.issued, 'received', l.received, 'made', l.made, 'pressed', l.pressed, 'handed', l.handedAt || ''));
const k = r => U(r.orderNo || r.orderId) + '|' + U(r.sku);
Object.keys(B).filter(n => /^pt_/.test(n)).forEach(n => {
  const hits = L(B[n]).filter(r => typeof r === 'object' && keys.has(k(r)));
  hits.forEach(r => console.log(' ', n, k(r), JSON.stringify(r).slice(0, 260)));
});
