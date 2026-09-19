/* Break the new scanning on purpose, three ways, and check the tests notice each one. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['the store is never checked on the way out',
    `    const have = fgiOf(sku).current;
    if (n > have) return stop(\``,
    `    const have = fgiOf(sku).current;
    if (false && n > have) return stop(\``],
  ['every scan makes its own row instead of adding to one',
    '  const old = r.id ? (FGI.rows || []).find(x => fgiRowId(x) === r.id) : null;',
    '  const old = null;'],
  ['pieces past the order go in without a reason',
    "      if (!String(r.over || '').trim()) return stop(`${nf(over)} piece(s) more than",
    "      if (false) return stop(`${nf(over)} piece(s) more than"],
];

let allBit = true;
for (const [what, from, to] of breaks) {
  let s = good.toString('utf8').replace(/\r\n/g, '\n');
  if (s.split(from).length !== 2) { console.log('SKIP (anchor) ' + what); allBit = false; continue; }
  fs.writeFileSync(P, s.replace(from, () => to).replace(/\n/g, '\r\n'));
  let out = '';
  try { out = execSync('node "' + TEST + '"', { encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const failed = m ? Number(m[2]) : -1;
  const bit = failed > 1;
  if (!bit) allBit = false;
  console.log((bit ? 'BIT  ' : 'MISS ') + what + '  (' + (m ? m[0] : 'no summary') + ')');
  if (bit) out.split('\n').filter(l => /FAIL/.test(l) && !/Ready Goods/.test(l)).slice(0, 3).forEach(l => console.log('      ' + l.trim()));
}
fs.writeFileSync(P, good);
console.log(allBit ? '\nall three bit — the file is back as it was' : '\nSOMETHING DID NOT BITE');
