const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['saved against the order', "  const key = stockKey + '@' + o.id;", "  const key = stockKey;"],
  ['the row carries its order', "  row.orderId = o.id;", "  row.orderId = '';"],
  ['the old untagged count is replaced', "  old.forEach(k => { patch['pt_rfdStock/' + code + '/' + k] = null; });", ""],
  ['own count counts here', "  let mine = ownTake(o);", "  let mine = 0;"],
  ['own count is capped by need', "  const ownTake = x => Math.min(rfdStockOwn(x, stockKey), rfdRoomFor(x, stockKey));",
   "  const ownTake = x => rfdStockOwn(x, stockKey);"],
  ['another order does not use it', "  .filter(e => e.oid === o.id).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0));",
   "  .reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0));"],
  ['over-asked uses the real count', "    const counted = g.own ? Math.min(g.pool, g.pieces) : g.stock;", "    const counted = g.stock;"],
  ['no elsewhere for an own count', '    const elsewhere = g.own ? 0 : rfdRound', '    const elsewhere = 0 ? 0 : rfdRound'],
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
