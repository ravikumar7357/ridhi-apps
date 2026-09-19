const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['a "no printing" rule is obeyed',
   '  return !(r && r.print === false);',
   '  return true;'],
  ['a white colour is never printed',
   '  if (!ptColourPrints(m.color)) return false;',
   '  if (false) return false;'],
  ['an unruled article is still counted as printed',
   '  const r = ptPrintRuleOf(m);' + NL + '  return !(r && r.print === false);',
   '  const r = ptPrintRuleOf(m);' + NL + '  return !!r && r.print !== false;'],
  ['the pieces that are not printed leave the requirement',
   '    if (!ptPrintNeeded(m)) {' + NL + '      noPrintPcs += left;',
   '    if (false) {' + NL + '      noPrintPcs += left;'],
  ['…and are named rather than dropped',
   '      e.pcs += left; noPrint.set(k, e);',
   '      e.pcs += left;'],
  ['the rule’s cloth is the one measured',
   '    const fab = ptPrintFabric(m) || ' + "'—';",
   '    const fab = String(m.fabric || ' + "'—').trim();"],
  ['an unruled subtype is reported by name',
   '    if (!ptPrintRuleOf(m)) {',
   '    if (false) {'],
  ['the colour list is read fresh after a change',
   '  CPRINT_IX = { src: null, set: null };' + NL + '  renderMst();',
   '  renderMst();'],
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
