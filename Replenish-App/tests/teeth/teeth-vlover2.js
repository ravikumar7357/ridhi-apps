/* The three breaks the first run got wrong, rewritten.
 *
 *  · "allowed at all" produced invalid JavaScript and crashed the suite, which is not a break, it is
 *    a typo. The old wall is put back properly instead.
 *  · "nothing is written while it is asking" was a no-op twin of itself. A real mistake somebody
 *    could make is doing the write first and asking afterwards, so that is the break now.
 *  · "a delivery nobody accepted is not over" is dropped with the reason recorded below.
 */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const GUARD = [
  "      const over = q + rj - claimed;",
  "      if (over > 0 && !note) return `${nf(q + rj)} ${r.unit} is ${nf(over)} more than the ${nf(claimed)} `",
  "        + `the printer recorded. That is allowed — ${r.vendor} gets credited for it — but write the `",
  "        + 'challan number or the reason in the note first.';",
  "      const err = await vlAcceptWrite([r], () => q, note, () => rj);",
].join(NL);

const breaks = [
  /* The wall this change pulled down, put back exactly as it stood. */
  ['taking in more than the challan is allowed at all',
   GUARD,
   [
     "      const over = q + rj - claimed;",
     "      if (over > 0) return `${nf(q)} kept and ${nf(rj)} returned is ${nf(q + rj)} ${r.unit}, `",
     "        + `but the printer only recorded ${nf(claimed)}.`;",
     "      const err = await vlAcceptWrite([r], () => q, note, () => rj);",
   ].join(NL)],

  /* Asking afterwards is not asking. The write has already gone to the database by then, and the
   * refusal on screen is about something that has already happened. */
  ['…and it asks BEFORE it writes, not after',
   GUARD,
   [
     "      const over = q + rj - claimed;",
     "      const err = await vlAcceptWrite([r], () => q, note, () => rj);",
     "      if (over > 0 && !note) return `${nf(q + rj)} ${r.unit} is ${nf(over)} more than the ${nf(claimed)} `",
     "        + `the printer recorded. That is allowed — ${r.vendor} gets credited for it — but write the `",
     "        + 'challan number or the reason in the note first.';",
   ].join(NL)],

  /* THE FIGURE, not a note beside it. This is the one my first colour test let through. */
  ['an over-receipt figure is not painted like a clean one',
   "        ? `<span style=\"font-weight:700;color:${over > 0 ? '#7f6000' : (okQty + rej < r.qty ? 'var(--bad)' : '#166534')}\">${nf(okQty)}</span>`",
   "        ? `<span style=\"font-weight:700;color:${okQty + rej < r.qty ? 'var(--bad)' : '#166534'}\">${nf(okQty)}</span>`"],
];

/* DROPPED, with the reason: `const k = vlOk(d); if (!k) return 0;` in vlOver cannot be shown to do
 * anything, because the Math.max below it already answers 0 for a delivery nobody accepted — got is
 * nought and the claim cannot be negative. It is kept in the code because it says what it means, but
 * a teeth check that cannot bite is not evidence and will not be pretended to be one. */

const BASE = 1;
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing or not unique: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'],
    { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > BASE : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
