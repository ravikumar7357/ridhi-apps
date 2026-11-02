/* Phase 2: the "clearly sure after a correction" bar, tried on spelling set 1 and the normal test sets ONLY — the
 * held-back sets are never looked at here. Usage: node meera/tools/phase2-tune.cjs 0.85 0.08 (rebuilds meera.js). */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { load } = require('../tests/harness.cjs');
const { classify, typoSet } = require('../tests/measure.cjs');
const ROOT = path.join(__dirname, '..', '..');
const EV = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bank', 'evals', n + '.json'), 'utf8'));
const [sure, gap] = process.argv.slice(2).map(Number);
const f = path.join(__dirname, '..', 'client', 'src', 'legacy', 'guide-ask.js');
let s = fs.readFileSync(f, 'utf8');
s = s.replace(/let GA_SPELL_FIXED = false, GA_SPELL_SURE = [\d.]+, GA_SPELL_GAP = [\d.]+;/, `let GA_SPELL_FIXED = false, GA_SPELL_SURE = ${sure}, GA_SPELL_GAP = ${gap};`);
fs.writeFileSync(f, s);
cp.execSync('node meera/client/build.cjs', { cwd: ROOT });
(async () => {
  const on = await load({ root: ROOT, bundle: true, switches: ['spell'] });
  const sets = { eval: EV('eval'), eval2: EV('eval2'), parts: EV('eval-parts'), set1: typoSet() };
  const out = [];
  for (const [k, list] of Object.entries(sets)) {
    const r = { right: 0, offered: 0, wrong: 0, none: 0 };
    for (const x of list) r[classify(on.find(x.q, x.tab || 'shop'), x)]++;
    out.push(`${k} ${r.right}/${r.offered}/${r.wrong}/${r.none}`);
  }
  console.log(`sure ${sure} gap ${gap}: ` + out.join('  '));
})();
