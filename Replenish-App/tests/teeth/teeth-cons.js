const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['the two-inch margin is really added',
   'const PT_MARGIN_IN = 2;',
   'const PT_MARGIN_IN = 0;'],
  ['a round is cut from the square it fits in',
   '  if (nums.length === 1) return { w: nums[0] + PT_MARGIN_IN, l: nums[0] + PT_MARGIN_IN, round: true };',
   '  if (nums.length === 1) return { why: 1 };'],
  ['a box is refused rather than guessed at',
   '  return { why: `size "${raw}" is not a single rectangle',
   '  return { w: nums[0] + PT_MARGIN_IN, l: nums[1] + PT_MARGIN_IN, why0: `size "${raw}" is not a single rectangle'],
  ['how many fit across the roll',
   '    const across = Math.floor(widthIn / cw);',
   '    const across = 1;'],
  ['the piece may be turned',
   '  const both = [[cut.w, cut.l, false], [cut.l, cut.w, true]];',
   '  const both = [[cut.w, cut.l, false]];'],
  ['the least cloth wins',
   '  return tries.sort((a, b) => a.metres - b.metres || (a.turned ? 1 : 0) - (b.turned ? 1 : 0))[0];',
   '  return tries[0];'],
  ['the roll that wastes least is the one chosen',
   '  const best = all.slice().sort((a, b) => a.waste - b.waste',
   '  const best = all.slice().sort((a, b) => b.waste - a.waste'],
  /* Dropped: the across-rolls tie-break is now the narrower roll alone, and it decides every
   * case the catalogue can produce. */
  ['a ruled fabric beats the search',
   '  const chosen = onNamed || best;',
   '  const chosen = best;'],
  ['panels multiply the cloth',
   '    metres: Math.round(chosen.metres * panels * 1000) / 1000,',
   '    metres: Math.round(chosen.metres * 1000) / 1000,'],
  ['a retired fabric is left out',
   '  return cutFabrics()',
   "  return ptList((PTG.masters || {}).fabricType).map(f => String(f.desc || f.code || '').trim())"],
  /* Dropped: a roll of width 0 fits nothing across it, so ptLayOn drops it whether the filter
   * is there or not. Nothing could tell the difference. */
  ['the lay rule is read at all',
   '  const lay = ptLayOf(m);',
   "  const lay = '';"],
  ['"never turned" really removes the turned option',
   "  const allowed = lay === 'width' ? both.slice(0, 1) : lay === 'length' ? both.slice(1) : both;",
   '  const allowed = both;'],
  /* Dropped: a value that is neither falls through to "either way" in ptLayOn regardless, so the
   * whitelist changes nothing anything can observe. It stays as a statement of intent. */
  ['cloth too narrow to lay is called out',
   '    namedUnfit: !!(named && !onNamed),',
   '    namedUnfit: false,'],
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
