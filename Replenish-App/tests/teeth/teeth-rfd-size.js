const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['the rows are grouped by size at all',
   "const rfdSizeKey = x => [String((x && x.what) || ''), String((x && x.size) || '')]" + NL
     + "  .map(v => v.trim().toLowerCase()).join(' | ');",
   "const rfdSizeKey = x => String((x && x.sku) || '').trim().toLowerCase();"],
  ['…and the subtype is part of the group, not just the number',
   "const rfdSizeKey = x => [String((x && x.what) || ''), String((x && x.size) || '')]" + NL
     + "  .map(v => v.trim().toLowerCase()).join(' | ');",
   "const rfdSizeKey = x => String((x && x.size) || '').trim().toLowerCase();"],
  ['the key a database gets has nothing in it to choke on',
   "const rfdStockKey = x => rfdSizeKey(x).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';",
   'const rfdStockKey = x => rfdSizeKey(x);'],
  ['every colour of a size is counted into it',
   '    g.skus.push(x); g.pieces += x.pieces;',
   '    g.skus.push(x); g.pieces = x.pieces;'],
  ['…and every cloth behind it is named',
   '    if (x.fabric && g.fabrics.indexOf(x.fabric) < 0) g.fabrics.push(x.fabric);',
   ''],
  ['…and every colour is named',
   '    if (x.colour && g.colours.indexOf(x.colour) < 0) g.colours.push(x.colour);',
   ''],
  ['what has been asked for comes off the size',
   '      left: rfdRound(Math.max(0, g.pieces - g.used - stock)) });',
   '      left: rfdRound(Math.max(0, g.pieces - stock)) });'],
  ['…and so does what the printer says is with them',
   '      left: rfdRound(Math.max(0, g.pieces - g.used - stock)) });',
   '      left: rfdRound(Math.max(0, g.pieces - g.used)) });'],
  ['the pile comes off the ceiling for a new request',
   '  const stock = before ? 0 : rfdStockForSku(o, sku);',
   '  const stock = 0;'],
  ['…but never off one that was already raised',
   '  const stock = before ? 0 : rfdStockForSku(o, sku);',
   '  const stock = rfdStockForSku(o, sku);'],
  ['one pile is shared between orders, not counted twice',
   '    const take = Math.min(pool, Math.max(0, g.pieces - g.used));' + NL + '    pool -= take;',
   '    const take = Math.min(pool, Math.max(0, g.pieces - g.used));'],
  ['…oldest order first',
   "    .slice().sort((a, b) => String(a.orderNo || a.id).localeCompare(String(b.orderNo || b.id)));",
   "    .slice().sort((a, b) => String(b.orderNo || b.id).localeCompare(String(a.orderNo || a.id)));"],
  ['a spread adds up to exactly what was asked for',
   '    .forEach(x => { if (left > 0) { out[x.i]++; left--; } });',
   ''],
  ['…in proportion to the weights',
   '  const exact = w.map(x => (x / sum) * t);',
   '  const exact = w.map(() => t / w.length);'],
  ['asking for a size writes one request per colour',
   '    asks.push({ unit: \'pcs\', pieces: share[i], sku: x.sku, size: x.size, what: x.what,',
   '    if (i) return;' + NL + '    asks.push({ unit: \'pcs\', pieces: share[i], sku: x.sku, size: x.size, what: x.what,'],
  ['…each keeping its own colour and cloth',
   "      colour: x.colour, fabric: x.fabric, metres: x.per ? rfdRound(share[i] * x.per) : 0 });",
   "      colour: '', fabric: '', metres: x.per ? rfdRound(share[i] * x.per) : 0 });"],
  ['the screen gives the printer a box to fill in',
   '      + `<input data-vprfd-stock="${esc(o.id)}|${esc(g.stockKey)}" type="number" min="0" step="1"`',
   '      + `<span data-x="${esc(o.id)}|${esc(g.stockKey)}"`'],
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
