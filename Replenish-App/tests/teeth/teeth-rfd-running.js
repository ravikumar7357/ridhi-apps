const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a cloth and a size are kept in separate key spaces',
   "const rfdFabKey = f => 'M__' + rfdKeySafe(f);",
   'const rfdFabKey = f => rfdKeySafe(f);'],
  ['…and a size carries its own prefix',
   "const rfdStockKey = x => 'P__' + rfdKeySafe(rfdSizeKey(x));",
   'const rfdStockKey = x => rfdKeySafe(rfdSizeKey(x));'],
  ['the unit can be read off the key',
   "const rfdKeyUnit = k => (String(k || '').indexOf('M__') === 0 ? 'm' : 'pcs');",
   "const rfdKeyUnit = k => 'pcs';"],
  ['metres the printer has come off what is left to ask for',
   '  const stock = before ? 0 : rfdStockHere(o, rfdFabKey(fabric));',
   '  const stock = 0;'],
  ['…but never off a metre request already raised',
   '  const stock = before ? 0 : rfdStockHere(o, rfdFabKey(fabric));',
   '  const stock = rfdStockHere(o, rfdFabKey(fabric));'],
  ['a half metre is not rounded away',
   "  return rfdKeyUnit(stockKey) === 'm' ? rfdRound(n) : Math.round(n);",
   '  return Math.round(n);'],
  ['…while a half piece still is not a thing',
   "  if (unit === 'pcs' && isFinite(n) && Math.round(n) !== n) return 'Pieces have to be a whole number.';",
   ''],
  ['the room on a running order is what it still needs of that cloth',
   '  const f = rfdFabrics(o).find(x => rfdFabKey(x.fabric) === stockKey);' + NL
     + '  if (!f) return 0;' + NL + '  return Math.max(0, f.metres - rfdUsedM(o, f.fabric));',
   '  return 0;'],
  ['…less what has already been asked for on it',
   '  return Math.max(0, f.metres - rfdUsedM(o, f.fabric));',
   '  return f.metres;'],
  ['the running table gives the printer a box too',
   '      + `<input data-vprfd-stock="${esc(o.id)}|${esc(key)}" type="number" min="0" step="0.1"`',
   '      + `<span data-x="${esc(o.id)}|${esc(key)}"`'],
  ['…and it takes a fraction of a metre',
   '      + `<input data-vprfd-stock="${esc(o.id)}|${esc(key)}" type="number" min="0" step="0.1"`',
   '      + `<input data-vprfd-stock="${esc(o.id)}|${esc(key)}" type="number" min="0" step="1"`'],
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
