/* Phase 2: which questions change with the "spell" switch on, and what she changed in them. */
const path = require('path');
const { load } = require('../tests/harness.cjs');
const { classify, typoSet } = require('../tests/measure.cjs');
const fs = require('fs');
const EV = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bank', 'evals', n + '.json'), 'utf8'));
(async () => {
  const ROOT = path.join(__dirname, '..', '..');
  const off = await load({ root: ROOT, bundle: true }), on = await load({ root: ROOT, bundle: true, switches: ['spell'] });
  const sets = { eval: EV('eval'), eval2: EV('eval2'), parts: EV('eval-parts'), typos: typoSet() };
  const only = process.argv[2];
  for (const [k, list] of Object.entries(sets)) {
    if (only && k !== only) continue;
    let fixes = 0;
    for (const x of list) {
      const a = classify(off.find(x.q, x.tab || 'shop'), x), b = classify(on.find(x.q, x.tab || 'shop'), x);
      const u = on.ctx.MEERA.understand(x.q);
      if (u.changes.length) fixes++;
      if (a !== b) console.log(k, a, '->', b, '|', x.q, '|', u.changes.map(c => c.from + '>' + c.to).join(', '), x.from ? '| was: ' + x.from : '');
    }
    console.log(k, 'questions changed by spelling:', fixes, 'of', list.length);
  }
})();
