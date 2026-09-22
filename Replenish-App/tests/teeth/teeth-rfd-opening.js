const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['opening is not counted as RFD back', "    else if (r.txnType === 'OPENING_RFD') g.rfdOpen += q;", "    else if (r.txnType === 'OPENING_RFD') g.rfdIn += q;"],
  ['the lot holds the opening stock', "    rfdLeft: g.rfdOpen + g.rfdIn - g.rfdOut," + NL + "    lossPct: g.rfdIn > 0 && g.toRfd > 0", "    rfdLeft: g.rfdIn - g.rfdOut," + NL + "    lossPct: g.rfdIn > 0 && g.toRfd > 0"],
  ['opening opens its own lot', "    lot = lot || fabNextLot(fabric, rec.date);" + NL + "    const already = fabLot(lot);" + NL + "    if (already && already.n > 0)", "    const already = fabLot(lot);" + NL + "    if (already && already.n > 0)"],
  ['the sheet knows the word', "'RFD OPENING STOCK': 'OPENING_RFD', ", ""],
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
