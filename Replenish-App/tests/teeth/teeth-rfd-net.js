const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['oldest first', "    .sort((a, b) => (rfdSeq(a) < rfdSeq(b) ? -1 : rfdSeq(a) > rfdSeq(b) ? 1 : 0));",
   "    .sort((a, b) => (rfdSeq(a) < rfdSeq(b) ? 1 : rfdSeq(a) > rfdSeq(b) ? -1 : 0));"],
  ['refused takes none', "  const list = rfdReqsOf(order).filter(x => same(x) && !((d => d && d.stage === 'rejected')(rfdDecisionOf(x.id))))",
   "  const list = rfdReqsOf(order).filter(x => same(x))"],
  ['held in full is done', "    if (toSend < want && rfdSentQty(r.id) >= toSend) return 'sent';", ""],
  ['send is capped at what is not held', "  const left = rfdRound(Math.max(0, want - held - rfdSentQty(id)));",
   "  const left = rfdRound(Math.max(0, want - rfdSentQty(id)));"],
  ['the row shows to send', "          + `<div style=\"font-weight:700\">${nf(rfdRound(Math.max(0, want - held)))} ${u} to send</div></td>`",
   "          + `<div style=\"font-weight:700\">${nf(want)} ${u} to send</div></td>`"],
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
