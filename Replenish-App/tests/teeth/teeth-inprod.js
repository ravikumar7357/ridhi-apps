const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39), BS = String.fromCharCode(92);
const breaks = [
  ['the Indian date shape is read at all',
   '  m = d.match(/^(' + BS + 'd{1,2})[-' + BS + '/.](' + BS + 'd{1,2})[-' + BS + '/.](' + BS + 'd{4})/);',
   '  m = null;'],
  ['…the right way round (day first, not month first)',
   "  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');",
   "  if (m) return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');"],
  ['…and a single digit is padded',
   "  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');",
   "  if (m) return m[3] + '-' + m[2] + '-' + m[1];"],
  ['something that is not a date is refused, not passed through',
   "  return '';" + NL + '}' + NL + NL + '/**' + NL + ' * Order + SKU -> the date that order promised',
   '  return d;' + NL + '}' + NL + NL + '/**' + NL + ' * Order + SKU -> the date that order promised'],
  ['the promise is read off the sales order',
   '      const d = pdIso(l.deliveryDate) || ord;',
   "      const d = '';"],
  ["…the line's own date beats the order's",
   '      const d = pdIso(l.deliveryDate) || ord;',
   '      const d = ord || pdIso(l.deliveryDate);'],
  ['…and the earliest of two promises wins',
   '      if (!cur || d < cur) m.set(k, d);',
   '      m.set(k, d);'],
  ['only OPEN lines are counted as being made',
   '    if (!r.open) return;',
   '    if (false) return;'],
  ['pressed pieces stop counting as in production',
   '    const left = Math.max(0, r.qty - r.pressed);',
   '    const left = r.qty;'],
  ['…and the figure can never go negative',
   '    const left = Math.max(0, r.qty - r.pressed);',
   '    const left = r.qty - r.pressed;'],
  ['a finished line drops out instead of sitting at zero',
   '    if (!left) return;' + NL + "    out.push({ sku: r.sku, qty: left, start: pdIso(r.orderDate),",
   "    out.push({ sku: r.sku, qty: left, start: pdIso(r.orderDate),"],
  ['the order number rides along with the quantity',
   '      supplier: r.orderNo, orderNo: r.orderNo,',
   "      supplier: '', orderNo: '',"],
  ['the stage is worked out from the line',
   "      stage: r.pendingCut > 0 ? 'to cut' : (r.pendingMake > 0 ? 'to make' : (r.madeToPress > 0 ? 'to press' : 'made')) });",
   "      stage: 'made' });"],
  ['the ready date reaches the row',
   "      ready: due.get(r.orderNo + '|' + r.sku) || '',",
   "      ready: '',"],
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
