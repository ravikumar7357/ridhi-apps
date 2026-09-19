const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['a grant is really checked',
   "const qcViewsAllowed = () => (ME.admin ? QC_VIEWS : QC_VIEWS.filter(v => (ME.tabs || []).includes(v[2])));",
   'const qcViewsAllowed = () => QC_VIEWS;'],
  ['an admin still has all three',
   '(ME.admin ? QC_VIEWS : QC_VIEWS.filter',
   '(false ? QC_VIEWS : QC_VIEWS.filter'],
  ['a stale picker value cannot open an ungranted view',
   '  return allowed.includes(want) ? want : allowed[0];',
   '  return want || allowed[0];'],
  ['no grant means no view, and it says so',
   '  if (!allowed.length) {',
   '  if (false) {'],
  ['the cut’s cloth is worked out from the size',
   '  return { pcs, plan: p, should: Math.round(p.metres * pcs * 100) / 100 };',
   '  return { pcs, plan: p, should: Math.round(p.metres * 100) / 100 };'],
  ['the used box is filled in',
   "  if (!$('cwUsed').dataset.typed) $('cwUsed').value = f.should;",
   "  if (false) $('cwUsed').value = f.should;"],
  ['…and a typed figure is left alone',
   "  if (!$('cwUsed').dataset.typed) $('cwUsed').value = f.should;",
   "  $('cwUsed').value = f.should;"],
  ['a size nobody can measure is refused rather than guessed',
   '  if (p.why) return { why: p.why, pcs };',
   '  if (p.why) return { pcs, plan: { metres: 1, fabric: "?", across: 1, waste: 0, panels: 1 }, should: pcs };'],
  ['waste is measured against what went in',
   '    bits.push(`waste ${nf(waste)} m = ${((waste / used) * 100).toFixed(1)}% of what went in`);',
   '    bits.push(`waste ${nf(waste)} m = ${((waste / f.pcs) * 100).toFixed(1)}% of what went in`);'],
  /* Dropped: mdbNum('') is null and Number.isFinite(null) is false, so an empty box is left out
   * whether the early return is there or not. It stays for readability; nothing can observe it. */
  ['a box of nonsense is not written as a null reading',
   '    if (Number.isFinite(n) && n >= 0) out[key] = n;',
   '    if (isFinite(n) && n >= 0) out[key] = n;'],
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
