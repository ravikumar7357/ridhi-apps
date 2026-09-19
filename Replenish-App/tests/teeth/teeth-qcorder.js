const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['unnamed checks are shared out by SKU at all',
   '    const p = loose.get(sku) || { checked: 0, ok: 0, rej: 0, alt: 0 };',
   '    return; const p = loose.get(sku) || { checked: 0, ok: 0, rej: 0, alt: 0 };'],
  ['…once, never more than was checked',
   '      add(k, take, Math.round(p.ok * f), Math.round(p.rej * f), Math.round(p.alt * f), true); left -= take;',
   '      add(k, take, Math.round(p.ok * f), Math.round(p.rej * f), Math.round(p.alt * f), true);'],
  ['…never beyond what the order received',
   "      const k = obKeyOf(r.orderNo, r.sku), room = r.received - ((map.get(k) || {}).checked || 0), take = Math.min(left, room);",
   "      const k = obKeyOf(r.orderNo, r.sku), room = r.qty, take = Math.min(left, room);"],
  ['…a named check comes off the room first',
   "      const k = obKeyOf(r.orderNo, r.sku), room = r.received - ((map.get(k) || {}).checked || 0), take = Math.min(left, room);",
   "      const k = obKeyOf(r.orderNo, r.sku), room = r.received, take = Math.min(left, room);"],
  ['…oldest order first',
   '    lines.filter(r => r.sku === sku && r.received > 0).sort((a, b) => when(a) - when(b)).forEach(r => {',
   '    lines.filter(r => r.sku === sku && r.received > 0).sort((a, b) => when(b) - when(a)).forEach(r => {'],
  ['…an order that received nothing gets none',
   '    lines.filter(r => r.sku === sku && r.received > 0).sort((a, b) => when(a) - when(b)).forEach(r => {',
   '    lines.filter(r => r.sku === sku).sort((a, b) => when(a) - when(b)).forEach(r => {' + NL + '      if (!(r.received > 0)) { add(obKeyOf(r.orderNo, r.sku), left, 0, 0, 0, true); left = 0; return; }'],
  ['…passed and rejected go with the pieces',
   '      add(k, take, Math.round(p.ok * f), Math.round(p.rej * f), Math.round(p.alt * f), true); left -= take;',
   '      add(k, take, 0, 0, 0, true); left -= take;'],
  ['…and the share is marked as worked out',
   "    e.checked += c; e.ok += ok; e.rej += rej; e.alt += alt; if (worked) e.worked += c; map.set(k, e); };",
   "    e.checked += c; e.ok += ok; e.rej += rej; e.alt += alt; map.set(k, e); };"],
  ['a named check is that order\'s and is not marked worked out',
   "    if (r.orderNo) return add(obKeyOf(r.orderNo, r.sku), ptNum(r.checked), ptNum(r.ok), ptNum(r.rejected), ptNum(r.forAlteration), false);",
   "    if (r.orderNo) return add(obKeyOf(r.orderNo, r.sku), ptNum(r.checked), ptNum(r.ok), ptNum(r.rejected), ptNum(r.forAlteration), true);"],
  ['the cell says the figure was shared out',
   "          ? ' title=\"' + nf(q.worked) + ' of these checks named no order, so they are shared out by SKU — never beyond what this order received, oldest order first.\"'",
   "          ? ''"],
  ['a check on a SKU that is on orders is refused without one',
   '  if (onOrders.length && !ordTyped) return qcCheckMsg(`${sku} is on ${nf(onOrders.length)} order(s) — pick which one these pieces are for.`, true);',
   ''],
  ['…and with an order the SKU is not on',
   '  if (ordTyped && onOrders.length && !onOrders.some(o => o.orderNo === ordTyped))',
   '  if (false)'],
  ['the orders offered put the one with pieces back first',
   '    .sort((a, b) => (b.received - a.received) || a.orderNo.localeCompare(b.orderNo));',
   '    .sort((a, b) => b.orderNo.localeCompare(a.orderNo));'],
  ['a SKU on one order fills the box in by itself',
   "      if (on.length === 1 && !String(box.value || '').trim()) box.value = on[0].orderNo;",
   ''],
  ['…and the box says it is required',
   "      box.placeholder = !sku0 ? 'Order No' : (on.length ? 'Order No *' : 'Order No — this SKU is on no order');",
   "      box.placeholder = 'Order No (optional)';"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
