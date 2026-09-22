const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['received orders are not counted', "    if (!o || !voRunning(o) || ['Received', 'Cancelled'].indexOf(o.status || 'Placed') >= 0) return;", "    if (!o || !voRunning(o)) return;"],
  ['delivered lines are not counted', "      if (left > 0) out.push(", "      if (true) out.push("],
  ['Cancel keeps the line off', "      if (!voDupAsk(col, VOF.lines)) return say(", "      if (!voDupAsk(col, VOF.lines) && false) return say("],
  ['asked once per colour', "  if (!k || VOF.dupOk[k]) return true;", "  if (!k) return true;"],
  ['uploaded lines asked at placing', "    for (const c of cols) if (!voDupAsk(c, [])) return", "    for (const c of []) if (!voDupAsk(c, [])) return"],
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
