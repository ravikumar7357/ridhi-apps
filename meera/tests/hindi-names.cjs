/* SWITCH "hindinames" BEFORE → AFTER (2 Nov 2026): every test set with the switch off and on, plus 30 button and column
 * names typed in Hindi letters (bank/evals/names-hi.json, spelt by hand — the right answer is the part itself).
 *   node meera/tests/hindi-names.cjs [--list] */
const fs = require('fs'), path = require('path');
const { load } = require('./harness.cjs');
const { classify, typoSet } = require('./measure.cjs');
const frozen = require('./typo-sets.cjs');
const ROOT = path.join(__dirname, '..', '..');
const ev = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bank', 'evals', n + '.json'), 'utf8'));
const sets = { eval: ev('eval'), eval2: ev('eval2'), parts: ev('eval-parts'), typos: typoSet(), ...frozen.load(), screens: ev('screens'), 'names-hi': ev('names-hi') };
(async () => {
  const run = async switches => {
    const M = await load({ root: ROOT, switches });
    const res = {};
    for (const [k, list] of Object.entries(sets)) {
      const per = list.map(x => { const h = M.find(x.q, x.tab || 'shop'); return { x, k: classify(h, x), top: h[0] && h[0].id }; });
      res[k] = { per, n: c => per.filter(p => p.k === c).length };
    }
    return res;
  };
  const off = await run([]), on = await run(['hindinames']);
  console.log('set        questions   right       offered     wrong       not sure');
  for (const k of Object.keys(sets)) {
    const f = c => `${off[k].n(c)}→${on[k].n(c)}`.padEnd(12);
    console.log(`${k.padEnd(10)} ${String(sets[k].length).padEnd(11)} ${f('right')}${f('offered')}${f('wrong')}${f('none')}`);
  }
  if (process.argv.includes('--list')) for (const k of Object.keys(sets)) off[k].per.forEach((p, i) => {
    const q = on[k].per[i];
    if (p.k !== q.k || (k === 'names-hi' && q.k !== 'right')) console.log(`  ${k} [${p.x.tab || 'shop'}] ${p.x.q} — want ${p.x.id}: ${p.k} (${p.top}) → ${q.k} (${q.top})`);
  });
})();
