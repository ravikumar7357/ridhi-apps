const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a reason is required', "  if (!String(why || '').trim()) return 'Say what is wrong — the person approving it has to know.';", ""],
  ['one waiting per entry', "  if (jwCorrOfRow(rowId)) return 'A change to this entry is already waiting for approval.';", ""],
  ['impossible asks refused', "  const plan = jwCorrPlan(r, clean);" + NL + "  if (plan.err) return plan.err;", "  const plan = jwCorrPlan(r, clean);"],
  ['only an editor approves', "async function jwCorrApprove(id) {" + NL + "  if (!ptCanEdit()) return PT_NO_EDIT;", "async function jwCorrApprove(id) {"],
  ['SKU and dates need an admin', "  if (Object.keys(q.change || {}).some(k => JWC_ADMIN_ONLY.indexOf(k) >= 0) && !ME.admin)", "  if (false)"],
  ['re-checked against the row now', "  if (plan.err) return 'Cannot be applied as it stands now: ' + plan.err;", ""],
  ['entry and request in one write', "  try { await ptPatch({ ['pt_baseData/' + r.id]: next, ['pt_jwCorrReqs/' + id]: done }); }", "  try { await ptPut('pt_baseData/' + r.id, next); }"],
  ['reject needs a reason', "  if (!String(note || '').trim()) return 'Say why it is refused — the person who asked will see it.';", ""],
  ['only what changes is sent', "    if (!same) out.push([k, now, to]);", "    out.push([k, now, to]);"],
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
