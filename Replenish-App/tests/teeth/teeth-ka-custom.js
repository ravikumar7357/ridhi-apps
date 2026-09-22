const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['the To day is included', "  for (let t = a; t <= b; t = new Date(", "  for (let t = a; t < b; t = new Date("],
  ['Karigar study uses custom dates', "  if (grp === 'daily' || (grp === 'karigar' && custom)) return renderKaDaily();", "  if (grp === 'daily') return renderKaDaily();"],
  ['targets offer no custom dates', "      + (grp === 'daily' ? '<option value=\"custom\">Custom dates…</option>' : '');", "      + '<option value=\"custom\">Custom dates…</option>';"],
  ['a long range is refused', "    if (rg.days.length > KA_MAX_DAYS) {", "    if (false) {"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-150)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
