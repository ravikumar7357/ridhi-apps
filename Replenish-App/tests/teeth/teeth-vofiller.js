const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a filling firm\'s order is filling work though it never said so',
   "const voIsFilling = o => !!o && prLineServices(o.vendorCode, o).some(k => { const x = prSvc(k); return !!(x && x.fill); })",
   "const voIsFilling = o => !!o && !!o.service && prLineServices(o.vendorCode, o).some(k => { const x = prSvc(k); return !!(x && x.fill); })"],
  ['…and a printing order is not',
   "const voIsFilling = o => !!o && prLineServices(o.vendorCode, o).some(k => { const x = prSvc(k); return !!(x && x.fill); })",
   'const voIsFilling = o => !!o'],
  ['the dialog offers a filler on a filling order',
   "    fields: editable ? (voIsFilling(o) ? [{ key: 'filler',",
   "    fields: editable ? (false ? [{ key: 'filler',"],
  ['…and says plainly when none is set',
   "label: o.filler ? 'Filler' : 'Filler — NOT SET, so these lines are priced by nothing',",
   "label: 'Filler',"],
  ['…offering the fillers the rate list knows',
   "      value: o.filler || '', list: prKnown('filler') }] : [])",
   "      value: o.filler || '' }] : [])"],
  ['saving sets it on the order',
   '    if (f) next.filler = f; else delete next.filler;',
   '    '],
  ['…and clearing the box clears it',
   '    if (f) next.filler = f; else delete next.filler;',
   '    if (f) next.filler = f;'],
  ['…and a printing order never gains one',
   '  if (voIsFilling(o)) {' + NL + "    const f = String(($('ptf_filler') || {}).value || '').trim();",
   '  if (true) {' + NL + "    const f = String(($('ptf_filler') || {}).value || '').trim();"],
  ['the reason says where to go and fix it',
   " — and neither the order nor the line says which one this is. Open the order in Vendor Orders '" + NL + "    + 'and set its filler';",
   " — and neither the order nor the line says which one this is';"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
