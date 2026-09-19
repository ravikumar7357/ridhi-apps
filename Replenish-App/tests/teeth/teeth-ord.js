const fs = require('fs');
const { execFileSync } = require('child_process');
const F = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const T = require('path').join(__dirname, '..', 'prod-test.js');
const orig = fs.readFileSync(F);
const breaks = [
 [
  "entry right opens edit",
  "const fgiCanEdit = () => !spIsVendor() && !!(ME.admin || ME.fgiEdit);",
  "const fgiCanEdit = () => !spIsVendor() && !!(ME.admin || ME.fgiEdit || ME.fgiEntry);"
 ],
 [
  "receive without order",
  "    if (!orderNo) return 'Put in the order",
  "    if (false) return 'Put in the order"
 ],
 [
  "wrong console order passes as external",
  "    else if (fgiOrderKnown(orderNo)) return",
  "    else if (false) return"
 ],
 [
  "typed order overwritten",
  "  if (!String(box.value || '').trim() || auto) {",
  "  if (true) {"
 ]
];
let bad = 0;
for (const [name, a, b] of breaks) {
  const s = orig.toString('utf8');
  if (s.split(a).length !== 2) { console.log('ANCHOR ' + name); bad++; continue; }
  fs.writeFileSync(F, s.replace(a, b));
  let out = '';
  try { out = execFileSync(process.execPath, [T], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (e) { out = String(e.stdout || ''); }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bites = !m || +m[2] > 1;
  console.log((bites ? '  bites  ' : '  TOOTHLESS  ') + name + ' → ' + (m ? m[0] : 'crashed'));
  if (!bites) bad++;
  fs.writeFileSync(F, orig);
}
fs.writeFileSync(F, orig);
console.log(Buffer.compare(fs.readFileSync(F), orig) === 0 ? 'restored' : 'NOT RESTORED');
