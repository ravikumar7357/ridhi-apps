const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['the fed width is read at all',
   '  const fed = fabWidthIn(fabric);' + NL + '  if (fed > 0) return fed * 0.0254;',
   '  const fed = 0;' + NL + '  if (fed > 0) return fed * 0.0254;'],
  ['the fed width beats the name',
   '  if (fed > 0) return fed * 0.0254;' + NL + '  const m = String(fabric',
   '  const m = String(fabric'],
  /* Dropped: `fed > 0` in voFabWidthM already gates it, so a nought, a negative and a NaN all fall
   * through to the name whether the guard inside fabWidthMap is there or not. Nothing could tell. */
  ['the code matches as well as the name',
   '    [r.desc, r.code].forEach(x =>',
   '    [r.desc].forEach(x =>'],
  ['case and spaces do not hide it',
   "const fabWidthIn = fabric => fabWidthMap().get(String(fabric || '').trim().toLowerCase()) || 0;",
   "const fabWidthIn = fabric => fabWidthMap().get(String(fabric || '')) || 0;"],
  /* The save mutates the very object the memo is keyed on, so dropping the reset leaves a width that
   * is saved but not yet in use — the sort of fault that only shows up after a reload. */
  ['the memo is thrown away when a width is saved',
   '  PTG.masters.fabricType[rkey] = row;' + NL + '  FABW_IX = { src: null, map: null };',
   '  PTG.masters.fabricType[rkey] = row;'],
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
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
