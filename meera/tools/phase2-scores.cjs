/* Phase 2: every score with the "spell" switch off and on (Meera as her own file, meera.js), side by side. */
const { measure } = require('../tests/measure.cjs');
(async () => {
  const off = await measure({ bundle: true }), on = await measure({ bundle: true, switches: ['spell'] });
  const row = (name, a, b) => console.log(name.padEnd(34), ['right', 'offered', 'wrong', 'none'].map(k => `${k} ${a[k]}→${b[k]}`).join('   '), a.count ? ` (of ${a.count})` : '');
  for (const k of Object.keys(off.scores)) row(k, off.scores[k], on.scores[k]);
  row('spelling set 1 (tuned on)', off.typos, on.typos);
  for (const k of Object.keys(off.extra)) row(k === 'held' ? 'spelling set 2 (held back)' : 'Hindi-script spelling', off.extra[k], on.extra[k]);
  console.log('ms an answer', off.timing.msPerAnswer, '→', on.timing.msPerAnswer);
})();
