const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['THE BUG ITSELF: a codeless line goes back to being dropped silently',
   '    if (!s) {' + NL + "      /* `name` already reads \"Product · Variant\" — the caller builds it that way, which is exactly"
     + NL + '       * what somebody needs to find the thing in Shopify. */'
     + NL + '      if (noSku && qty > 0) noSku.push({ name: String(name || \'\').trim(), qty });'
     + NL + '      return;' + NL + '    }' + NL + '    if (!(qty > 0)) return;',
   '    if (!s || !(qty > 0)) return;'],
  ['a line owed nothing is still ignored',
   '    if (!(qty > 0)) return;',
   '    if (false) return;'],
  ['the plan reports them',
   '  noSku.forEach(n => out.skipped.push({ sku: \'(no code)\',',
   '  [].forEach(n => out.skipped.push({ sku: \'(no code)\','],
  ['…and names the product',
   "    why: `\"${n.name || 'a line with no product name'}\" has no SKU on its Shopify variant",
   '    why: `a line has no SKU on its Shopify variant'],
  ['the message counts them and says what to do',
   '    if (noCode.length) {',
   '    if (false) {'],
  ['…and still reports the ones refused for other reasons',
   '    if (rest.length) {',
   '    if (false) {'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['shop-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 0 : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
