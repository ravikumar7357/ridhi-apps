/* Break the cloth arithmetic on purpose — a fabric order is placed on these numbers. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['cloth forgets the fabric width', '    const s = left * cons * w;', '    const s = left * cons;'],
  ['a SKU with no consumption is counted as zero cloth instead of being named',
    '    if (!cons || !w) {', '    if (false) {'],
  ['a printer is averaged over the window, not the weeks worked',
    '    const avg = ran.length ? v.total / ran.length : 0;', '    const avg = v.total / keys.length;'],
  ['a delivery nobody can price is counted as cloth',
    '    if (s == null) { v.unpriced += r.qty; unpriced += r.qty; }',
    '    if (s == null) { v.weeks.set(wk, (v.weeks.get(wk) || 0) + r.qty); v.total += r.qty; }'],
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
  out.split('\n').filter(l => /FAIL/.test(l) && !/Ready Goods/.test(l)).slice(0, 2).forEach(l => console.log('      ' + l.trim()));
}
fs.writeFileSync(P, good);
console.log(allBit ? '\nall bit — the file is back as it was' : '\nSOMETHING DID NOT BITE');
