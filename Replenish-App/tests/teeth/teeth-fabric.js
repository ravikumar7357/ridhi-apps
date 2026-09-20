const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['the fabric is picked, not typed',
   "    { key: 'fabric', label: 'Fabric', type: 'select', value: m('fabric', ''),",
   "    { key: 'fabric', label: 'Fabric', value: m('fabric', ''),"],
  ['…from the Fabric Type master and not some other list',
   "      options: [''].concat(fabListOr(m('fabric', ''))) },",
   "      options: [''].concat(listOr('articleType', m('fabric', ''))) },"],
  ['…with the row\u2019s own spelling kept',
   'const fabListOr = cur => [...new Set([String(cur || \'\').trim()].filter(Boolean).concat(cutFabrics()))];',
   'const fabListOr = cur => cutFabrics();'],
  ['…and the switched-off fabrics left out',
   'const fabListOr = cur => [...new Set([String(cur || \'\').trim()].filter(Boolean).concat(cutFabrics()))];',
   "const fabListOr = cur => [...new Set([String(cur || '').trim()].filter(Boolean)"
     + ".concat(ptList((PTG.masters || {}).fabricType).map(f => String(f.desc || f.code || '').trim()).filter(Boolean)))];"],
  ['…and not offered twice',
   'const fabListOr = cur => [...new Set([String(cur || \'\').trim()].filter(Boolean).concat(cutFabrics()))];',
   "const fabListOr = cur => [String(cur || '').trim()].filter(Boolean).concat(cutFabrics());"],
  ['the ruffle cloth is picked too',
   "    { key: 'ruffleFabric', label: 'Ruffle fabric', type: 'select', value: m('ruffleFabric', ''),",
   "    { key: 'ruffleFabric', label: 'Ruffle fabric', value: m('ruffleFabric', ''),"],
  ['the form still has every field it had',
   "    { key: 'imageUrl', label: 'Image link', value: m('imageUrl', ''), span: true },",
   ''],
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
