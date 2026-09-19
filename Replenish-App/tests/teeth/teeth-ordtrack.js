/* Break the order tracking on purpose; the tests must notice. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

/* The QC guard line is written three times in the file; the QC index is the one followed by its own
 * running total, so the anchor takes both lines. */
const QC_FROM = [
  '    if (!r || !r.orderNo) return;',
  '    const k = obKeyOf(r.orderNo, r.sku);',
  '    const e = map.get(k) || { checked: 0, ok: 0, rej: 0, alt: 0 };',
].join('\n');
const QC_TO = QC_FROM.replace('    if (!r || !r.orderNo) return;', '    if (!r) return;');

const breaks = [
  ['a QC check with no order is counted against an order anyway', QC_FROM, QC_TO],
  ['what LEAVES the store counts as arrived',
    "    if (!r || !r.orderNo || r.txnType !== 'RECEIVE') return;",
    '    if (!r || !r.orderNo) return;'],
  ['the source filter takes any prefix as valid',
    "  return p === 'AMZ' || p === 'SHP' || p === 'B2B' ? p : '';",
    '  return p;'],
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
