const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['Sunday is not a working day', "const kaWorkDay = ms => new Date(ms).getDay() !== 0;", "const kaWorkDay = ms => true;"],
  ['a team is its people times the target', "  return per ? per * paTeamSize(key, ms || Date.now()) : 0;", "  return per;"],
  ['a name\'s own target wins', "  if (own != null && own !== '' && isFinite(+own)) return +own;", ""],
  ['expected is the share of working days gone', "    const expected = total ? Math.round(target * gone / total) : 0;", "    const expected = target;"],
  ['behind vs far behind', "pace >= 0.8 ? 'behind' : 'far'", "pace >= 0.5 ? 'behind' : 'far'"],
  ['furthest behind first', "  rows.sort((a, b) => rank[a.status] - rank[b.status]", "  rows.sort((a, b) => rank[b.status] - rank[a.status]"],
  ['pieces land on their own day', "const dayIx = ms => { for (let i = days.length - 1; i >= 0; i--) if (ms >= days[i]) return i; return -1; };",
   "const dayIx = ms => 0;"],
  ['only an admin', "  if (!ME.admin) return 'Only an admin sets the targets.';", ""],
  ['salaried stitchers out', "[...roster.values()].filter(p => paIsKarigar(p.dept) && !paIsSalaried(p.type)).forEach(p => rowOf(paN(p.name), p.name));",
   "[...roster.values()].filter(p => paIsKarigar(p.dept)).forEach(p => rowOf(paN(p.name), p.name));"],
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
