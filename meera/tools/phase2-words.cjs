/* Phase 2: every change she makes to the normal test questions, plus a few hand-made ones. */
const path = require('path'), fs = require('fs');
const { load } = require('../tests/harness.cjs');
const EV = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bank', 'evals', n + '.json'), 'utf8'));
(async () => {
  const on = await load({ root: path.join(__dirname, '..', '..'), bundle: true, switches: ['spell'] });
  const show = q => { const u = on.ctx.MEERA.understand(q); if (u.changes.length) console.log(u.changes.map(c => c.from + ' > ' + c.to).join(', '), '   |', q); };
  for (const n of ['eval', 'eval2', 'eval-parts']) for (const x of EV(n)) show(x.q);
  console.log('--- hand-made');
  for (const q of ['karigr ko kaam kaise de', 'maaal wapas kaise le', 'qualty chek kaha hota hai', 'scan ner kaam nahi kar raha', 'jobwork kaise kare',
    'jobworkissue kaise', 'pakking list kaha hai', 'dispach kaise kare', 'recieve kaise kare', 'kariger ka hisab', 'invetory report', 'Ramesh ko maal diya'])
    { const u = on.ctx.MEERA.understand(q); console.log(q, ' =>', u.text); }
})();
