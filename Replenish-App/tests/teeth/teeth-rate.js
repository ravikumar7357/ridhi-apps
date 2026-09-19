const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['a label is part of what the rate IS',
   '  if (!sp) return hrN(prColLabel(r && r.colours));',
   "  if (!sp) return '';"],
  /* One line now answers both: a label has no digits, and therefore no number is ever taken for one. */
  ['a label has no digits in it, so no number is ever taken for one',
   "  return (!t || /\\d/.test(t)) ? '' : t;",
   '  return t;'],
  ['a labelled rate answers no colour count',
   '  if (prColIsLabel(r)) return false;',
   '  if (false) return false;'],
  ['…and is never reached by the pricing',
   '    .filter(r => !prColIsLabel(r))',
   '    .filter(r => true)'],
  ['two different labels are two rates, not a clash',
   '  if (la || lb) return hrN(la) === hrN(lb);',
   '  if (la || lb) return true;'],
  ['a count written wrong is still refused',
   '  if (String(v.colours || \'\').trim() && !prColSpec(v.colours) && !prColLabel(v.colours))',
   '  if (false)'],
  ['THE SAME rate twice loads instead of refusing',
   '      if (!same) {',
   '      if (true) {'],
  ['…and TWO DIFFERENT rates are still refused',
   '      const same = (parseFloat(had.rate) || 0) === (parseFloat(v.rate) || 0);',
   '      const same = true;'],
  ['…and the repetition is reported, not hidden',
   '      warns.push(`Row ${v.row} repeats row ${had.row} — same rate, ${nf(v.rate)}. Taken once.`);',
   '      ;'],
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
