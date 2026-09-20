const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a handed line has no work outstanding on it',
   '    return Object.assign(l, { unrecorded: Math.max(0, l.qty - l.made),' + NL + '      pendingCut: 0, pendingMake: 0, madeToPress: 0 });',
   '    return Object.assign(l, { unrecorded: Math.max(0, l.qty - l.made) });'],
  ['…and what was never recorded is carried, not swept away',
   '    return Object.assign(l, { unrecorded: Math.max(0, l.qty - l.made),' + NL + '      pendingCut: 0, pendingMake: 0, madeToPress: 0 });',
   '    return Object.assign(l, { unrecorded: 0, pendingCut: 0, pendingMake: 0, madeToPress: 0 });'],
  /* THE ZEROING IS THE HANDOVER'S AND NOTHING ELSE'S — otherwise it is a way to make work vanish. */
  ['…and a line nobody handed over keeps all of it',
   "    if (!l.handedAt) return Object.assign(l, { unrecorded: 0 });",
   "    if (!l.handedAt) return Object.assign(l, { unrecorded: 0, pendingCut: 0, pendingMake: 0, madeToPress: 0 });"],
  ['…and a line that was entered properly reports no hole',
   '    return Object.assign(l, { unrecorded: Math.max(0, l.qty - l.made),',
   '    return Object.assign(l, { unrecorded: l.qty,'],
  /* the guards that stop this becoming a shortcut */
  ['nothing is handed over that was never received',
   "    if (!(recv > 0)) {" + NL + "      return 'Nothing has been received against this line yet, so there is nothing to hand over.';",
   '    if (false) {' + NL + "      return 'Nothing has been received against this line yet, so there is nothing to hand over.';"],
  ['…nor one whose pieces were never pressed',
   '    if (pressed < recv) {',
   '    if (false) {'],
  /* the screen */
  ['the row says the pieces were sent and never recorded',
   "        + (r.unrecorded ? `<div><span class=\"pill pill-low\" title=\"${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)",
   "        + (false ? `<div><span class=\"pill pill-low\" title=\"${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)"],
  ['the panel counts the hole in a tile of its own',
   "  unrecorded: { label: 'Sent, never recorded', of: r => r.unrecorded },",
   '  '],
  ['…and clicking it shows only those lines',
   "  unrecorded: { label: 'Sent, never recorded', of: r => r.unrecorded },",
   "  unrecorded: { label: 'Sent, never recorded', of: r => 1 },"],
  ['the order book says it as well',
   "      + (r.unrecorded ? `<div><span class=\"pill pill-low\" title=\"${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)" + NL
     + "        + ' piece(s) were handed to shipping with nothing in the registers to say they were made.')}\">${nf(r.unrecorded)} never recorded</span></div>` : '')",
   ''],
  ['the journey says it too',
   "  if (!r.open) return (r.handedAt ? 'Handed over' + (r.unrecorded ? ' · ' + nf(r.unrecorded) + ' never recorded' : '') : 'Complete') + tail;",
   "  if (!r.open) return (r.handedAt ? 'Handed over' : 'Complete') + tail;"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-140)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
