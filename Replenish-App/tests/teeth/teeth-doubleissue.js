const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['an identical issue a moment ago is noticed', '    && now - (Date.parse(r.addedAt || \'\') || 0) < 120000) || null;', '    && false) || null;'],
  ['…but only inside two minutes', '    && now - (Date.parse(r.addedAt || \'\') || 0) < 120000) || null;', '    ) || null;'],
  ['…and only for the same pieces', '    && String(r.orderNo || \'\') === String(entry.orderNo || \'\') && ptNum(r.issuePieces) === ptNum(entry.issuePieces)', '    && String(r.orderNo || \'\') === String(entry.orderNo || \'\')'],
  ['…the same order', '    && String(r.orderNo || \'\') === String(entry.orderNo || \'\') && ptNum(r.issuePieces) === ptNum(entry.issuePieces)', '    && ptNum(r.issuePieces) === ptNum(entry.issuePieces)'],
  ['…the same karigar and SKU', '  return (PT.base || []).find(r => r && r.empName === entry.empName && obUC(r.sku) === obUC(entry.sku)', '  return (PT.base || []).find(r => r'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
