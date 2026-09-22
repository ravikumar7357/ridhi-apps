const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['the size letters', "const FS_VOIL = [['92', 'Horizontal', 'T'], ['92', 'Vertical', 'Q'], ['112', 'Horizontal', 'K']];",
   "const FS_VOIL = [['92', 'Horizontal', 'T'], ['92', 'Vertical', 'T'], ['112', 'Horizontal', 'K']];"],
  ['CPC has its own prefix', "CPC: { voil: 'CPCQ', canvas: 'CPC-CANVAS-' } };", "CPC: { voil: 'CQL', canvas: 'CPC-CANVAS-' } };"],
  ['no invented voil', "    return q && v && sd ? q.voil + code + '-' + v[2] + '-' + sd : '';",
   "    return q ? q.voil + code + '-' + (v ? v[2] : 'X') + '-' + (sd || 'Front') : '';"],
  ['canvas SKU', "  if (/^CANVAS$/i.test(String(fabric).trim())) return q ? q.canvas + code : '';",
   "  if (/^CANVAS$/i.test(String(fabric).trim())) return q ? 'RBPCANVAS' + code : '';"],
  ['case-free lookup', "  return fsRows({ q: want.toLowerCase() }).find(r => r.sku.toUpperCase() === want) || null;",
   "  return fsRows({ q: want.toLowerCase() }).find(r => r.sku === want) || null;"],
  ['order form case-free', "  if (!VOF.fs) VOF.fs = new Map(fsRows({}).map(r => [r.sku.toUpperCase(), r]));",
   "  if (!VOF.fs) VOF.fs = new Map(fsRows({}).map(r => [r.sku, r]));"],
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
