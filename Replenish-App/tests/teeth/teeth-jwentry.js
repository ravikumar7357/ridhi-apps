/* Teeth for the entry boxes. Six rules, each broken on purpose. */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const breaks = [
  ['a typed zipper count reaches the ledger',
   'const need = isFinite(said) && said >= 0 ? said : (parseInt(entry.issuePieces, 10) || 0) * mdbZipQty(m);',
   'const need = (parseInt(entry.issuePieces, 10) || 0) * mdbZipQty(m);'],
  ['nought means nought, not "nothing said"',
   'if (z !== null) out.zipsIssued = z;',
   'if (z) out.zipsIssued = z;'],
  ['an untouched box stays out of the entry',
   "if ($('bwZipWrap').classList.contains('hide') || !el.dataset.typed) return null;",
   "if ($('bwZipWrap').classList.contains('hide')) return null;"],
  ['a ruffle with no rule can be issued by hand',
   '  if (!r && !(isFinite(saidM) && saidM > 0 && saidF))',
   '  if (!r)'],
  ['the entered fabric is the one deducted',
   "txnType: 'ISSUE_TO_STITCHERS', fabricType: fab, colour: '',",
   "txnType: 'ISSUE_TO_STITCHERS', fabricType: r.fabric, colour: '',"],
  ['changing the SKU forgets the old material count',
   "  if (BD_MAT_SKU !== obUC(sku)) {",
   "  if (false) {"],
  ['the zipper gate asks about what is going out',
   "  const need = (zipsIssued === null || zipsIssued === undefined || !isFinite(zipsIssued))\n    ? (parseInt(qty, 10) || 0) * mdbZipQty(m) : zipsIssued;",
   "  const need = (parseInt(qty, 10) || 0) * mdbZipQty(m);"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, '\n');
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false;         /* 1 is the known Ready Goods fixture failure */
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-220)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
