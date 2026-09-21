const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['columns by name', "  const iC = at(['code']), iN = at(['name', 'desc', 'description']);", "  const iC = 0, iN = 1;"],
  ['code kept as written', "{ code: r ? r.code : code, desc });", "{ code, desc });"],
  ['width checked', "      if (t && !(w > 0 && w <= 200)) { skip.push({ row: line, why: `${code}: width \"${t}\" is not inches between 1 and 200.` }); continue; }", ""],
  ['greige owner checked', "      if (owner && owner !== ck) { skip.push({ row: line, why: `${code}: greige \"${g}\" already belongs to ${owner.toUpperCase()}.` }); continue; }", ""],
  ['duplicate code refused', "    if (seen.has(ck)) { skip.push({ row: line, why: `code ${code} is also on row ${seen.get(ck)}.` }); continue; }", ""],
  ['unchanged rows skipped', "    if (r && !changes.length) continue;                      // says what the screen already says", ""],
  ['parent must exist', "      if (!p) { skip.push({ row: line, why: `${code}: \"${pc || 'nothing'}\" is not a ${mstDef(def[3])[1].toLowerCase()} in use.` }); continue; }", "      if (!p) continue;"],
  ['admin only', "async function mstSheetRun(key, plan) {" + NL + "  if (!ME.admin) return 'Only an admin can change a master list.';", "async function mstSheetRun(key, plan) {"],
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
