const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['two bands at one price need no colour count',
   '  if (!hits.length && !cols && cand.length' + NL + "      && new Set(cand.map(r => String(parseFloat(r.rate) || 0))).size === 1",
   '  if (false && cand.length' + NL + "      && new Set(cand.map(r => String(parseFloat(r.rate) || 0))).size === 1"],
  /* THE DANGEROUS DIRECTION: bands that disagree must stay a refusal. */
  ['…but bands at two prices are still no rate',
   "      && new Set(cand.map(r => String(parseFloat(r.rate) || 0))).size === 1" + NL + "      && new Set(cand.map(r => prNameKey(r.filler))).size === 1)",
   "      && new Set(cand.map(r => prNameKey(r.filler))).size === 1)"],
  ['…and a design that says its count keeps its own band',
   '  if (!hits.length && !cols && cand.length',
   '  if (!hits.length && cand.length'],
  ['a labelled rate is still not reached this way',
   '    .filter(r => !prColIsLabel(r));' + NL + '  let hits = cand.filter(',
   '    ;' + NL + '  let hits = cand.filter('],
  ['the payout does not claim a colour band it never used',
   "    hits = [Object.assign({}, cand[0], { colours: '', anyBand: true })];",
   '    hits = [cand[0]];'],
  ['…and says why no count was needed',
   "  + (rw.anyBand ? ', every colour band charges this' : '')",
   ''],
  ['the reason names the prices the bands disagree by',
   "  if (prices.length > 1) return 'the colour bands charge different prices (' + prices.join(', ')",
   "  if (false) return 'the colour bands charge different prices (' + prices.join(', ')"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
