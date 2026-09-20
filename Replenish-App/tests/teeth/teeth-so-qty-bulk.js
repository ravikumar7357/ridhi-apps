const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a sheet row goes through the same rules as the button',
   '    const plan = soQtyPlan(o, e.sku, e.qty);' + NL
     + "    if (plan.err) { skip.push({ row: e.row, key, why: plan.err }); return; }",
   '    const plan = { err: \'\', sku: obUC(e.sku), from: 0, to: parseFloat(e.qty) || 0, delta: 0, moves: [], book: null };'],
  ['an empty New qty is left alone, not read as zero',
   "    if (qty === '') continue;",
   ''],
  ['the same order and SKU twice is refused',
   "      skip.push({ row: e.row, key, why: 'the same order and SKU is on row ' + seen.get(key) + ' as well.' });" + NL
     + '      return;',
   "      skip.push({ row: e.row, key, why: 'the same order and SKU is on row ' + seen.get(key) + ' as well.' });"],
  ['an order that does not exist is refused',
   "    if (!o) { skip.push({ row: e.row, key, why: 'there is no order called ' + (e.order || '(blank)') + '.' }); return; }",
   '    if (!o) return;'],
  ['a row with no reason is refused',
   "    if (!String(e.why || '').trim()) {",
   '    if (false) {'],
  ['the sheet needs the columns it reads back',
   "  if (iO < 0 || iS < 0 || iQ < 0)" + NL
     + "    return { err: 'The file needs Order, SKU and \"New qty\" columns. Download the template to see them.' };",
   '  if (false) return { err: 0 };'],
  ['…found by name, whatever order they are in',
   '  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };',
   '  const at = names => [\'order\', \'sku\', \'article\', \'size\', \'on the order\', \'cut\', \'received\', \'pressed\', \'cannot go below\', \'new qty\', \'why\'].indexOf(names[0]);'],
  ['the order book moves with the sheet too',
   "    if (r.book != null) patch['pt_orderBook/' + soBookId(r.o._id, r.sku) + '/qty'] = r.to;",
   ''],
  ['every change from a sheet is written down',
   "    patch[base + 'qtyAdjustments/' + logId] = { id: logId, sku: r.sku, from: r.from, to: r.to,",
   "    if (0) patch[base + 'qtyAdjustments/' + logId] = { id: logId, sku: r.sku, from: r.from, to: r.to,"],
  ['…and says it came from a sheet',
   "      why: r.why, by: ME.email, at: now, via: 'sheet' };",
   '      why: r.why, by: ME.email, at: now };'],
  ['a sheet needs the right to approve an order',
   '  if (!soCanApprove()) return { err: SO_NO_APPROVE };',
   ''],
  ['the template refuses to hand you an empty sheet',
   "    $('sxMsg').textContent = 'Nothing approved is on the screen to change. Clear the filters, or pick the orders you mean first.';" + NL
     + '    return;',
   "    $('sxMsg').textContent = 'Nothing approved is on the screen to change. Clear the filters, or pick the orders you mean first.';"],
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
