/* Teeth, and one of them matters more than the rest: putting the filters BACK in front of
 * SO_ALL_ROWS must fail the new tests. If it does not, the tests do not describe the bug Ravi hit
 * and the fix is unproven.
 */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['THE BUG ITSELF: the shops filter runs before the set is kept',
   '  rows.forEach(r => { r.route = soRoute(r); });' + NL + '  SO_ALL_ROWS = rows;' + NL + NL
     + "  const chanSel = msVals('soChan');" + NL
     + '  if (chanSel.length) rows = rows.filter(r => chanSel.includes(r.channel));',
   "  const chanSel = msVals('soChan');" + NL
     + '  if (chanSel.length) rows = rows.filter(r => chanSel.includes(r.channel));' + NL
     + '  rows.forEach(r => { r.route = soRoute(r); });' + NL + '  SO_ALL_ROWS = rows;'],
  ['the day filter runs after it too',
   "  const daySel = $('soDay').value;" + NL + "  if (daySel !== '') {",
   "  const daySel = $('soDay').value;" + NL + '  SO_ALL_ROWS = rows;' + NL + "  if (daySel !== '') {"],
  ['the sync reads the whole set',
   '  (SO_ALL_ROWS || []).forEach(r => { if (r && r.id) { seen.add(r.id); jobs.push({ o: r, full: true }); } });',
   '  (SO_ALL_ROWS || []).slice(0, 1).forEach(r => { if (r && r.id) { seen.add(r.id); jobs.push({ o: r, full: true }); } });'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['shop-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 0 : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
