const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['the order book moves with the sales order',
   "  if (plan.book != null) patch['pt_orderBook/' + soBookId(o._id, sku) + '/qty'] = plan.to;",
   ''],
  /* Split into two writes. Valid JS, and exactly the regression that matters: the sales order moves,
   * the order book moves separately, and between them is a window where they disagree. */
  ['…in ONE write, so the two cannot drift apart',
   "  if (plan.book != null) patch['pt_orderBook/' + soBookId(o._id, sku) + '/qty'] = plan.to;" + NL
     + '  try { await ptPatch(patch); }' + NL
     + "  catch (e) { return 'Not saved: ' + (e.message || e); }",
   '  try { await ptPatch(patch); }' + NL
     + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  if (plan.book != null) {' + NL
     + "    try { await ptPut('pt_orderBook/' + soBookId(o._id, sku) + '/qty', plan.to); }" + NL
     + "    catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  }'],
  ['it cannot go below what has been made',
   '  if (n < done.floor) {',
   '  if (false) {'],
  ['…and what has been cut counts',
   '  const cut = obCutQty(orderNo, sku);',
   '  const cut = 0;'],
  ['…and what came back counts',
   '  const made = b ? b.received : 0;',
   '  const made = 0;'],
  ['…and what has been pressed counts',
   '  const pressed = obPressQty(orderNo, sku);',
   '  const pressed = 0;'],
  ['the floor is the largest of the three, not their sum',
   '  return { cut, made, pressed, floor: Math.max(cut, made, pressed) };',
   '  return { cut, made, pressed, floor: cut + made + pressed };'],
  ['a change needs a reason',
   "  if (!reason) return 'Say why it is changing — it goes on the order beside the figure.';",
   ''],
  ['…and the right to approve the order',
   '  if (!soCanApprove()) return SO_NO_APPROVE;' + NL + '  const plan = soQtyPlan(o, sku, want);',
   '  const plan = soQtyPlan(o, sku, want);'],
  ['a draft is sent back to the ordinary edit',
   "  if (soStatus(o) !== 'approved') return { err: 'Only an approved order has anything in the order book to change. Edit a draft on the order itself.' };",
   ''],
  ['half a piece is refused',
   "  if (Math.round(n) !== n) return { err: 'Pieces have to be a whole number.' };",
   ''],
  ['the same number is not logged as a change',
   "  if (n === now) return { err: 'That is what it already says.' };",
   ''],
  ['extra goes on the latest delivery date',
   '    const last = order[order.length - 1];',
   '    const last = order[0];'],
  ['…and a cut comes off the latest first',
   '    for (let j = order.length - 1; j >= 0 && cut > 0; j--) {',
   '    for (let j = 0; j < order.length && cut > 0; j++) {'],
  ['what the line used to say is kept',
   "    patch['pt_salesOrders/' + o._id + '/lines/' + m.i + '/previousQty'] = m.from;",
   ''],
  ['and who changed it, when and why is written down',
   "  patch['pt_salesOrders/' + o._id + '/qtyAdjustments/' + logId] = log;",
   ''],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-150)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
