/* SWITCH "screenfirst" BEFORE → AFTER (2 Nov 2026): every test set scored with the switch off and on, plus the set of
 * questions asked from different screens (bank/evals/screens.json, made by meera/tools/make-screens-set.cjs).
 *   node meera/tests/screen-first.cjs [--list]      --list: the screens-set questions that changed */
const fs = require('fs'), path = require('path');
const { load } = require('./harness.cjs');
const { classify, typoSet } = require('./measure.cjs');
const frozen = require('./typo-sets.cjs');
const ROOT = path.join(__dirname, '..', '..');
const ev = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bank', 'evals', n + '.json'), 'utf8'));
const half = (process.argv.find(a => a.startsWith('--half=')) || '').slice(7);   // tune: the even questions of the screens set, score: the odd ones (never tuned on)
const sets = { eval: ev('eval'), eval2: ev('eval2'), parts: ev('eval-parts'), typos: typoSet(), ...frozen.load(), screens: ev('screens').filter((x, i) => !half || (half === 'tune' ? i % 2 === 0 : i % 2 === 1)) };
(async () => {
  const run = async switches => {
    const M = await load({ root: ROOT, switches });
    const mg = (process.argv.find(a => a.startsWith('--margin=')) || '').slice(9);
    if (mg) M.run('GA_SF_MARGIN = ' + Number(mg));   // trying another limit (tests only)
    const nm = (process.argv.find(a => a.startsWith('--named=')) || '').slice(8);
    if (nm) M.run('GA_SF_NAMED = ' + Number(nm));
    const res = {};
    for (const [k, list] of Object.entries(sets)) {
      const per = list.map(x => { const h = M.find(x.q, x.tab || 'shop'); return { x, k: classify(h, x), top: h[0] && h[0].id }; });
      res[k] = { per, n: c => per.filter(p => p.k === c).length };
    }
    return res;
  };
  const off = await run([]), on = await run(['screenfirst']);
  console.log('set        questions   right       offered     wrong       not sure');
  for (const k of Object.keys(sets)) {
    const f = c => `${off[k].n(c)}→${on[k].n(c)}`.padEnd(12);
    console.log(`${k.padEnd(10)} ${String(sets[k].length).padEnd(11)} ${f('right')}${f('offered')}${f('wrong')}${f('none')}`);
  }
  for (const kind of ['part', 'other', 'named']) {
    const idx = sets.screens.map((x, i) => (x.kind === kind ? i : -1)).filter(i => i >= 0);
    const c = (r, w) => idx.filter(i => r.screens.per[i].k === w).length;
    console.log(`  screens · ${kind.padEnd(6)} ${String(idx.length).padEnd(4)} right ${c(off, 'right')}→${c(on, 'right')}, offered ${c(off, 'offered')}→${c(on, 'offered')}, wrong ${c(off, 'wrong')}→${c(on, 'wrong')}, not sure ${c(off, 'none')}→${c(on, 'none')}`);
  }
  if (process.argv.includes('--list')) for (const k of Object.keys(sets)) off[k].per.forEach((p, i) => {
    const q = on[k].per[i];
    if (p.k !== q.k) console.log(`  ${k} [${p.x.tab || 'shop'}] ${p.x.q} — want ${p.x.id}: ${p.k} (${p.top}) → ${q.k} (${q.top})`);
  });
})();
