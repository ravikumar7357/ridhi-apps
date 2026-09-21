const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a tick box only where Refuse would work',
   "const rfdRefusable = r => !!r && rfdCanApprove() && r.stage !== 'rejected' && !(r.sent > 0);",
   "const rfdRefusable = r => !!r && rfdCanApprove() && r.stage !== 'rejected';"],
  ['…and only for somebody who may refuse',
   "const rfdRefusable = r => !!r && rfdCanApprove() && r.stage !== 'rejected' && !(r.sent > 0);",
   "const rfdRefusable = r => !!r && r.stage !== 'rejected' && !(r.sent > 0);"],
  ['tick-all takes only what is on screen',
   "  (RFD.shown || []).filter(rfdRefusable).forEach(r => { if (on) RFD_PICK.add(r.id); else RFD_PICK.delete(r.id); });",
   "  rfdRows().filter(rfdRefusable).forEach(r => { if (on) RFD_PICK.add(r.id); else RFD_PICK.delete(r.id); });"],
  ['hidden ticks are let go on draw',
   "  RFD.shown = rows;" + NL + "  rfdPickPrune();",
   "  RFD.shown = rows;"],
  ['the write checks the right itself',
   "  if (!rfdCanApprove()) return { err: RFD_NO_APPROVE };" + NL + "  const why",
   "  const why"],
  ['a reason is required',
   "  if (!why) return { err: 'Give a reason — every printer sees it on their own screen.' };",
   ''],
  ['one failure does not stop the rest',
   "    if (err) failed.push({ id, err }); else { done++; RFD_PICK.delete(id); }",
   "    if (err) { failed.push({ id, err }); break; } else { done++; RFD_PICK.delete(id); }"],
  ['what went is untick',
   "    if (err) failed.push({ id, err }); else { done++; RFD_PICK.delete(id); }",
   "    if (err) failed.push({ id, err }); else { done++; }"],
  ['each goes as a refusal with the reason',
   "    const err = await rfdDecide(id, 'rejected', why);",
   "    const err = await rfdDecide(id, 'rejected', '');"],
  ['the button shows the count',
   "    b.textContent = 'Refuse ticked (' + nf(RFD_PICK.size) + ')';",
   "    b.textContent = 'Refuse ticked';"],
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
