const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['Fabric is a recipe field at all',
   "  ['fabric', 'Fabric', 'fab'],",
   ''],
  ['…and a picked one, not a typed one',
   "  ['fabric', 'Fabric', 'fab'],",
   "  ['fabric', 'Fabric', 'txt'],"],
  ['the ruffle cloth is picked too',
   "  ['ruffleFabric', 'Ruffle fabric', 'fab'],",
   "  ['ruffleFabric', 'Ruffle fabric', 'txt'],"],
  ['a fabric the master does not have is refused',
   '        const hit = cutFabrics().find(x => recNorm(x) === recNorm(raw));',
   '        const hit = String(raw).trim();'],
  ['…and the master spelling is what gets written',
   '        e.vals[f] = hit;                       // the master`s own spelling, not the sheet`s'
     .replace(/`/g, String.fromCharCode(39)),
   ''],
  ['a recipe stays a DEFAULT — a SKU that names its own cloth keeps it',
   '    if (recSaid(out[f])) return;                  // the row said something; leave it alone',
   '    if (false) return;'],
  ['…and recipeValue asks the SKU before the recipe',
   '  if (recSaid(m && m[field])) return m[field];',
   '  if (false) return m[field];'],
  ['a combination whose colours disagree is not decided for you',
   '      if (s.conflict) { skipped.push({ key: c.key, field: f, values: s.values, n: c.n }); return; }',
   '      if (s.conflict) { rec[f] = s.values[0].value; filled++; return; }'],
  ['…and the disagreement is put on the list to answer',
   '      if (s.conflict) { skipped.push({ key: c.key, field: f, values: s.values, n: c.n }); return; }',
   '      if (s.conflict) return;'],
  ['two different spellings count as a disagreement',
   "  return { values, said, blank, agreed: values.length === 1 ? values[0].value : null,",
   "  return { values, said, blank, agreed: values.length ? values[0].value : null,"],
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
