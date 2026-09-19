/* Break the tiles on purpose; the tests must notice. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['"Came in" counts what went out instead',
    "        ['received', nf(tot(b => b.received)), 'Came in, all time', ''],",
    "        ['received', nf(tot(b => b.issued)), 'Came in, all time', ''],"],
  ['a tile no longer filters the movements',
    '    .filter(r => !kpi || kpi.is(r))',
    '    .filter(r => true)'],
  ['"Of that, to FBA" opens the issues as well',
    "  fba: { label: 'what went to FBA', is: r => r.txnType === 'FBA' || r.txnType === 'FBA_RETURN' },",
    "  fba: { label: 'what went to FBA', is: r => r.txnType === 'FBA' || r.txnType === 'ISSUE' },"],
  ['a tile stays lit on a list it is not filtering',
    "  if (FGI_KPI_ON && (litOk === false || (litOk === undefined && FGI_KPI !== FGI_KPI_ON))) FGI_KPI_ON = '';",
    '  if (false) FGI_KPI_ON = \'\';'],
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
  const bit = m ? Number(m[2]) > 1 : false;
  if (!bit) allBit = false;
  console.log((bit ? 'BIT  ' : 'MISS ') + what + '  (' + (m ? m[0] : 'no summary') + ')');
  out.split('\n').filter(l => /FAIL/.test(l) && !/Ready Goods/.test(l)).slice(0, 3).forEach(l => console.log('      ' + l.trim()));
}
fs.writeFileSync(P, good);
console.log(allBit ? '\nall bit — the file is back as it was' : '\nSOMETHING DID NOT BITE');
