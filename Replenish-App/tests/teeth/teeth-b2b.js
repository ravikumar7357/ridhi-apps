const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['the custom list is read at all',
   "  const b = obUC((mdbOf(sku) || {}).brand) || ordCustomBrands().get(obUC(sku)) || '';",
   "  const b = obUC((mdbOf(sku) || {}).brand) || '';"],
  ['the catalogue wins where a code is in both',
   "  const b = obUC((mdbOf(sku) || {}).brand) || ordCustomBrands().get(obUC(sku)) || '';",
   "  const b = ordCustomBrands().get(obUC(sku)) || obUC((mdbOf(sku) || {}).brand) || '';"],
  ['Ridhi is still RBP',
   "  return String(b).replace('RIDHI', 'RBP');",
   '  return String(b);'],
  ['the brand list is rebuilt when it changes',
   '  if (ORDBRAND_IX.src === src && ORDBRAND_IX.map) return ORDBRAND_IX.map;',
   '  if (ORDBRAND_IX.map) return ORDBRAND_IX.map;'],
  ['the order book has its own assign grant',
   'const bkCanAssign = () => !spIsVendor() && !!(ME.admin || ME.b2bAssign);',
   'const bkCanAssign = () => spCanAssign();'],
  ['…and the grant follows the order, not the screen',
   "const spCanAssignOrder = orderNo => (obUC(orderNo).indexOf('SHP-') === 0 ? spCanAssign() : bkCanAssign());",
   'const spCanAssignOrder = () => spCanAssign();'],
  ['a vendor may assign nothing',
   'const bkCanAssign = () => !spIsVendor() &&',
   'const bkCanAssign = () => !false &&'],
  ['the refusal names the right grant',
   "const spNoAssignFor = orderNo => (obUC(orderNo).indexOf('SHP-') === 0 ? SP_NO_ASSIGN : BK_NO_ASSIGN);",
   'const spNoAssignFor = () => SP_NO_ASSIGN;'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-180)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
