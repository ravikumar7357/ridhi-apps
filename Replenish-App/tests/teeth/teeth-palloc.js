/* Break the allocation on purpose and check the tests notice. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['capacity is ignored — one printer takes the lot',
    '        const take = Math.min(can, left);',
    '        const take = left;'],
  ['the printer who already prints the colour gets no preference',
    "const palScore = (p, g) => (g.now.has(p.name) ? 4 : 0) + (palGroupBlocks(p.key, g).have > 0 ? 2 : 0);",
    'const palScore = () => 0;'],
  ['a decided group is ignored and the guess wins',
    '  if (saved != null && String(saved).trim()) return String(saved).trim();',
    '  if (false) return String(saved).trim();'],
  ['blocks a printer holds are not counted',
    '  group.designs.forEach(d => { have += palBlocksHave(printerKey, d.key); });',
    '  group.designs.forEach(d => { have += 0 * palBlocksHave(printerKey, d.key); });'],
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
