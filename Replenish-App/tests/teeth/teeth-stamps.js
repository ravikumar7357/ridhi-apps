const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a stamp is honoured before anything is dealt',
   '      if (r && take > 0) give(r, c, take, true);',
   '      '],
  ['…and never gives out more than the line holds',
   "      const r = rows.find(x => x.orderNo === obUC(f.orderNo)), take = Math.min(parseFloat(f.qty) || 0, c.left);",
   "      const r = rows.find(x => x.orderNo === obUC(f.orderNo)), take = parseFloat(f.qty) || 0;"],
  ['what is stamped comes off what the dealing still owes that order',
   '      let need = r.qty - held(r);',
   '      let need = r.qty;'],
  ['a stamped share is not called shared',
   '      shared: rows.length > 1 && parts.some(p => !p.stamped) }));',
   '      shared: rows.length > 1 }));'],
  ['the pile carries the stamps',
   '        forOrders: Array.isArray(l.forOrders) ? l.forOrders : [],',
   '        forOrders: [],'],
  ['a new line is stamped oldest order first',
   '    ordLines().filter(r => r.sku === sku && r.open).sort((a, b) => when(a) - when(b)).forEach(r => {',
   '    ordLines().filter(r => r.sku === sku && r.open).sort((a, b) => when(b) - when(a)).forEach(r => {'],
  ['what vendors already hold comes off the need',
   '      const need = r.qty - (r.printer ? r.qty : (v ? v.given : 0)) - (taken.get(k) || 0);',
   '      const need = r.qty - (taken.get(k) || 0);'],
  ['two lines of one SKU in one order do not stamp the same order twice',
   '      const need = r.qty - (r.printer ? r.qty : (v ? v.given : 0)) - (taken.get(k) || 0);',
   '      const need = r.qty - (r.printer ? r.qty : (v ? v.given : 0));'],
  ['a line already stamped, metres, cancelled and console-assigned lines are left alone',
   "    if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || (Array.isArray(l.forOrders) && l.forOrders.length)) return l;",
   '    if (!l) return l;'],
  ['a SKU nobody ordered gets no stamp',
   '    return forOrders.length ? Object.assign({}, l, { forOrders }) : l;',
   '    return Object.assign({}, l, { forOrders });'],
  ['placing an order writes the stamp',
   '  try { if (!PTG.ob) await ptLoadGates(); order.lines = voStampOrders(order.lines); } catch (e) { /* placed unstamped */ }',
   ''],
  ['the screen says a share was placed for this order',
   "${v.shared ? ' · shared' : (v.parts.every(p => p.stamped) ? ' · for this order' : '')}</div></span>`",
   "${v.shared ? ' · shared' : ''}</div></span>`"],
  ['the export has the vendor columns',
   "    'Vendor', 'Given to vendor', 'Back from vendor', 'Not given', 'Vendor orders', 'Promised', 'How linked', 'Waiting at'].map(csvCell).join(',')];",
   "    ].map(csvCell).join(',')];"],
  ['…with the figures the screen shows',
   "    v ? Math.max(0, r.qty - v.given) : '', v ? [...new Set(v.parts.map(p => p.vpo))].join(' ') : '',",
   "    v ? r.qty : '', v ? [...new Set(v.parts.map(p => p.vpo))].join(' ') : '',"],
  ['…and how each was linked',
   "    v ? (v.shared ? 'shared by SKU' : (v.parts.every(p => p.stamped) ? 'placed for this order' : 'only order for this SKU')) : '',",
   "    v ? 'shared by SKU' : '',"],
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
