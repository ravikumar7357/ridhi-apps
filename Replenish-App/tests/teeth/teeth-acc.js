const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['a return puts stock back',
   'const ACC_SIGN = { OPENING: 1, IN: 1, OUT: -1, RETURN: 1, ADJUST: 1 };',
   'const ACC_SIGN = { OPENING: 1, IN: 1, OUT: -1, ADJUST: 1 };'],
  ['only issues and returns count as held',
   "    if (r.txnType !== 'OUT' && r.txnType !== 'RETURN') return;",
   "    if (r.txnType === 'IN') return;"],
  ['a return is subtracted from what somebody holds',
   "    if (r.txnType === 'OUT') e.out += accQty(r); else e.back += accQty(r);",
   '    e.out += accQty(r);'],
  ['an issue with nobody named is still shown',
   "    const who = accWho(r) || '(nobody named)';",
   '    const who = accWho(r); if (!who) return;'],
  ['a tool is expected back, thread is not',
   "const accReturnable = it => (it && it.returnable !== undefined) ? it.returnable === true : accCat(it) === 'Tool';",
   'const accReturnable = it => false;'],
  ['…and an item may say otherwise',
   '(it && it.returnable !== undefined) ? it.returnable === true :',
   'false ? it.returnable === true :'],
  ['an issue must name somebody',
   "  if ((v.txnType === 'OUT' || v.txnType === 'RETURN') && !String(v.issuedTo || '').trim())",
   '  if (false)'],
  ['the file refuses a movement it does not know',
   "    if (kindRaw && !txnType) { bad.push(`Line ${line}: \"${get('Movement')}\" is not one of ${ACC_TYPES.join(', ')}.`); return; }",
   '    if (false) { return; }'],
  ['the file refuses an issue with nobody named',
   "    if ((txnType === 'OUT' || txnType === 'RETURN') && !who) { bad.push(`Line ${line}: an ${txnType} needs a name in \"Issued to\".`); return; }",
   '    if (false) { return; }'],
  ['a blank column leaves an existing item alone',
   "      name: r.name || (was && was.name) || '',",
   "      name: r.name || '',"],
  ['a numeric code is taken for a zipper',
   "(/^\\d+$/.test(String(r.code).trim()) ? 'Zipper' : 'Other')",
   "'Other'"],
  ['the automatic zipper row carries the karigar',
   "    issuedTo: String(entry.empName || '').trim()," + NL + "    ref: 'AUTO · ' + entry.sku,",
   "    ref: 'AUTO · ' + entry.sku,"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-180)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
