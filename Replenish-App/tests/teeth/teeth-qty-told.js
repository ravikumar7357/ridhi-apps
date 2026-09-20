const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  /* ---- asking must not change anything ---- */
  ['asking for a change does not change the sales order',
   "  const patch = { [base + 'qtyAdjustments/' + logId]: log, [base + 'updatedAt']: now };",
   "  const patch = { [base + 'qtyAdjustments/' + logId]: log, [base + 'updatedAt']: now };" + NL
     + "  plan.moves.forEach(m => { patch[base + 'lines/' + m.i + '/qty'] = m.to; });"],
  ['…and a sheet asks the same way, it does not change either',
   "      why: r.why, by: ME.email, at: now, via: 'sheet', stage: 'pending' };",
   "      why: r.why, by: ME.email, at: now, via: 'sheet', stage: 'applied' };"],
  ['one ask at a time on a line',
   "    .find(a => a && a.id !== exceptId && obUC(a.sku) === obUC(sku) && soQtyStage(a) === 'pending');",
   '    .find(a => false);'],
  ['…but the one being answered does not block itself',
   "    .find(a => a && a.id !== exceptId && obUC(a.sku) === obUC(sku) && soQtyStage(a) === 'pending');",
   "    .find(a => a && obUC(a.sku) === obUC(sku) && soQtyStage(a) === 'pending');"],
  /* ---- a change already made counts as approved ---- */
  ['a record written before this existed reads as applied',
   "const soQtyStage = a => String((a && a.stage) || 'applied');",
   "const soQtyStage = a => String((a && a.stage) || 'pending');"],
  /* ---- approving is what moves the figures ---- */
  ['approving moves the sales order',
   '  plan.moves.forEach(m => {' + NL + "    patch[base + 'lines/' + m.i + '/qty'] = m.to;" + NL
     + "    patch[base + 'lines/' + m.i + '/previousQty'] = m.from;" + NL + '  });' + NL
     + "  patch[base + 'qtyAdjustments/' + logId + '/stage'] = 'applied';",
   "  patch[base + 'qtyAdjustments/' + logId + '/stage'] = 'applied';"],
  ['…and the order book with it',
   "  if (plan.book != null) patch['pt_orderBook/' + soBookId(o._id, a.sku) + '/qty'] = plan.to;",
   ''],
  ['…and the plan is worked out again at that moment',
   '  const plan = soQtyPlan(o, a.sku, a.to, logId);' + NL + "  if (plan.err) return a.sku + ': ' + plan.err;",
   "  const plan = { err: '', from: a.from, to: a.to, moves: [], book: null };"],
  ['…in ONE write, so the two cannot drift apart',
   "  if (plan.book != null) patch['pt_orderBook/' + soBookId(o._id, a.sku) + '/qty'] = plan.to;" + NL
     + '  try { await ptPatch(patch); }' + NL
     + "  catch (e) { return 'Not saved: ' + (e.message || e); }",
   '  try { await ptPatch(patch); }' + NL
     + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  if (plan.book != null) {' + NL
     + "    try { await ptPut('pt_orderBook/' + soBookId(o._id, a.sku) + '/qty', plan.to); }" + NL
     + "    catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  }'],
  ['what the line used to say is kept',
   "    patch[base + 'lines/' + m.i + '/previousQty'] = m.from;",
   ''],
  ['and who asked, when and why is written down',
   '  const log = { id: logId, sku: plan.sku, from: plan.from, to: plan.to, why: reason,',
   '  const log = { id: logId, sku: plan.sku, from: plan.from, to: plan.to,'],
  ['…and it is stamped with who approved it',
   "  patch[base + 'qtyAdjustments/' + logId + '/decidedBy'] = ME.email;",
   ''],
  ['answering the same one twice is refused',
   "  if (soQtyStage(a) !== 'pending') return 'That one has already been answered.';" + NL
     + '  const plan = soQtyPlan(o, a.sku, a.to, logId);',
   '  const plan = soQtyPlan(o, a.sku, a.to, logId);'],
  /* ---- turning one down ---- */
  ['turning one down needs a reason',
   "  if (!note) return 'Say why it is being turned down — the sales team reads it on the order.';",
   ''],
  ['…and a rejected one is not applied',
   "  const patch = { [base + 'stage']: 'rejected', [base + 'decidedBy']: ME.email,",
   "  const patch = { [base + 'stage']: 'applied', [base + 'decidedBy']: ME.email,"],
  /* ---- who may ---- */
  ['answering needs the Order Console',
   "const ordQtyCanApprove = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).includes('ord'));",
   'const ordQtyCanApprove = () => true;'],
  ['…and a printer never may',
   "const ordQtyCanApprove = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).includes('ord'));",
   "const ordQtyCanApprove = () => !!(ME.admin || (ME.tabs || []).includes('ord'));"],
  /* ---- the screen ---- */
  ['one waiting is one waiting, not every one ever made',
   "const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => soQtyStage(a) === 'pending');",
   'const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku);'],
  ['the line says a change has been ASKED for while it waits',
   "          + (st === 'pending' ? 'qty asked ' : (st === 'rejected' ? 'qty refused ' : 'qty ')) + ordQtyPill(a) + '</span>'",
   "          + 'qty ' + ordQtyPill(a) + '</span>'"],
  ['…and offers a way to answer it',
   '          + (st === \'pending\' ? \' <a href="#" data-ordqtyopen style="font-size:10.5px">Answer</a>\' : \'\')',
   "          + ''"],
  ['the top of the screen offers the window',
   '    ? \'<button data-ordqtyopen style="padding:3px 10px;font-size:12px;margin-right:8px">\'',
   "    ? '<span>'"],
  ['…and the line count is not lost with it',
   '    + esc(`${nf(rows.length)} of ${nf(all.length)} line(s)`',
   '    + esc(``'],
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
