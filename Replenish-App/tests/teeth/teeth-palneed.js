/* Teeth for the printer requirement. */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const breaks = [
  ['the split is proportional to what each delivers',
   'const share = rate > 0 ? (v.avg || 0) / rate : 0;',
   'const share = rate > 0 ? 1 / (hist.vendors || []).length : 0;'],
  ['a printer with no rate gets no share',
   'weeks: v.avg > 0 ? sqm / v.avg : null });',
   'weeks: sqm / (v.avg || 1) });'],
  ['it admits no order line names a printer',
   "if (!named) why.push('no open order line names a printer yet",
   "if (named) why.push('no open order line names a printer yet"],
  ['it admits no capacity has been fed',
   "if (!palPrinters().length) why.push('no printer has been fed a capacity",
   "if (palPrinters().length) why.push('no printer has been fed a capacity"],
  ['it admits the unpriced pieces are missing',
   'if (need.unknownPcs) why.push(nf(need.unknownPcs)',
   'if (false) why.push(nf(need.unknownPcs)'],
  ['unpriced pieces stay out of the m² total',
   '      unknownPcs += left;',
   '      unknownPcs += 0;'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, '\n');
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-220)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
