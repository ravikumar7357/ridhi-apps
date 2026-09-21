const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['greige comes back as RFD', "    if (becomes) fabric = becomes;", ""],
  ['goes out under its greige name', "    fabric = g.fabricType || fabric;", ""],
  ['receipt checked against the PO', "    if (!po) return `There is no greige PO ${poNo}.`;", "    if (!po) return '';"],
  ['received is counted by PO number', "    if (r.txnType !== 'RECEIVE_GREIGE' || String(r.orderNo || '').trim().toUpperCase() !== no) return;",
   "    if (r.txnType !== 'RECEIVE_GREIGE') return;"],
  ['GST on the line', "  const gst = gpoR2(amount * (parseFloat(l.gstPct) || 0) / 100);", "  const gst = 0;"],
  ['no fabric without a greige name', "    if (!f) return { err: `Line ${i + 1}: ${rfd || 'no fabric'} has no greige name. Add one in Masters → Fabric type.` };",
   "    if (!f) continue;"],
  ['one greige, one fabric', "  if (clash) return `${txt} is already the greige of ${clash.desc || clash.code}. One greige name, one fabric.`;", ""],
  ['addresses checked', "  if (bad) return `\"${bad}\" is not an email address.`;", ""],
  ['sent is recorded', "  po.sent = Object.assign({}, po.sent || {}, { [k]: log });", ""],
  ['cannot cancel what came in', "  if (gpoProgress(po).received > 0) return 'Cloth has already come in against this PO, so it cannot be cancelled.';", ""],
  ['settings are admin only', "  if (!ME.admin) return 'Only an admin can change what every PO says about the company.';", ""],
  ['lot found by RFD name', "    if (f && ![g.fabricType, g.rfdFabric, fabRfdOfGreige(g.fabricType)]", "    if (f && ![g.fabricType]"],
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
