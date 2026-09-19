/* Break the register view on purpose; the tests must notice. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['SKUs with nothing left are hidden again',
    '    .filter(r => !onlyStock || r.current !== 0 || r.pending > 0)',
    '    .filter(r => r.current !== 0 || r.pending > 0)'],
  ['the tick stops narrowing the list',
    '    .filter(r => !onlyStock || r.current !== 0 || r.pending > 0)',
    '    .filter(r => true || !onlyStock)'],
  ['the code no longer opens its movements',
    "    $('fgQ').value = mv.getAttribute('data-fgmoves');",
    "    $('fgQ').value = '';"],
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
  out.split('\n').filter(l => /FAIL/.test(l) && !/Ready Goods/.test(l)).slice(0, 3).forEach(l => console.log('      ' + l.trim()));
}
fs.writeFileSync(P, good);
console.log(allBit ? '\nall bit — the file is back as it was' : '\nSOMETHING DID NOT BITE');
