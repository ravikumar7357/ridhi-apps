/* Teeth: break each rule on purpose and confirm the tests bite. A test that passes either way is
 * decoration, and the shelf bug got in precisely because nothing was watching that line. */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const breaks = [
  ['zippers counted per piece', 'qty: n * per,', 'qty: per,'],
  ['the missing chain length is named', "out.push({ kind: 'zip', why: 'this is a zip SKU but its master row has no chain length",
                                        "out.push({ kind: 'zip', why: 'something is off"],
  ['the ruffle rule is used', 'qty: Math.round(n * r.meters * 100) / 100', 'qty: Math.round(n * 100) / 100'],
  ['the shelf is read off the list', '(accBalances() || []).find(x => accCode(x.code) === accCode(chain))',
                                    '(accBalances() || []).find(x => false)'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  if (good.split(from).length !== 2) { console.log('  ?? anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, good.replace(from, to));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const failed = m ? +m[2] : -1;
  const bit = failed > 1;                      /* 1 is the known Ready Goods fixture failure */
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\nSOME TESTS DO NOT BITE' : '\nall four bite; file restored');
