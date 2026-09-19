/* Break the below-zero rule and the store name on purpose; the tests must notice. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['a delete may take the store below zero again',
    '  const short = (plan.skus || []).filter(x => x.after < 0 && x.after < x.before);',
    '  const short = [];'],
  ['the rule only looks at the first SKU of the delete',
    '  const short = (plan.skus || []).filter(x => x.after < 0 && x.after < x.before);',
    '  const short = (plan.skus || []).slice(1).filter(x => x.after < 0 && x.after < x.before);'],
  ['an edit may send out more than the store holds',
    '    if (then < 0 && then < before)',
    '    if (false)'],
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
