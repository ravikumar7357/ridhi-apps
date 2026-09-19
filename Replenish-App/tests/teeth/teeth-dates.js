/* Break each piece on purpose and make sure the suite notices. A test that passes either way is not
 * a test. Every break here is a mistake somebody could plausibly make on this code, not a random
 * mutilation — the whole-last-day one and the day-first one are mistakes that were actually made in
 * this app before. */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  ['the range is actually consulted',
   '  if (!d1 && !d2) return true;' + NL + '  const d = ptDate(when);',
   '  if (true) return true;' + NL + '  const d = ptDate(when);'],

  ['an undated row is kept out of a filtered list',
   '  const d = ptDate(when);' + NL + '  if (!d) return false;',
   '  const d = ptDate(when);' + NL + '  if (!d) return true;'],

  ['the closing date covers the whole of that day',
   "  if (d2 && d > new Date(d2 + 'T23:59:59')) return false;",
   "  if (d2 && d > new Date(d2 + 'T00:00:00')) return false;"],

  ['the opening date is a floor, not a ceiling',
   "  if (d1 && d < new Date(d1 + 'T00:00:00')) return false;",
   "  if (d1 && d > new Date(d1 + 'T00:00:00')) return false;"],

  ['dates are parsed day-first, not by the browser',
   '  const d = ptDate(when);',
   '  const d = new Date(String(when));'],

  ['Quality Control asks the range at all',
   "    .join(' ').toLowerCase().includes(q)) && ptInRange(r && r.date, d1, d2);",
   "    .join(' ').toLowerCase().includes(q));"],

  ['…and reads its own two boxes',
   "  const [d1, d2] = ptRangeOf('qcD1', 'qcD2');",
   "  const [d1, d2] = ['', ''];"],

  ['…and the search box still narrows alongside them',
   "  const hit = r => (!q || [r.sku, r.articleType, r.subtype, r.color, r.size, r.checkedBy, r.employee]",
   "  const hit = r => (true || [r.sku, r.articleType, r.subtype, r.color, r.size, r.checkedBy, r.employee]"],

  /* The wrong way to do this, and the tempting one: filter the returns at the top with everything
   * else. Then an alteration issued and returned in August reads as 4 pieces still out the moment
   * somebody looks at September — a piece reported missing from the factory that is on the shelf. */
  ['a return is counted against its issue whatever the window says',
   "  if (view === 'checks') {",
   "  QC.ret = (QC.ret || []).filter(hit);" + NL + "  if (view === 'checks') {"],

  ['the accessories ledger asks the range',
   '      .filter(r => ptInRange(r && r.date, acD1, acD2))' + NL,
   ''],

  ['…and the boxes come off the views where a balance is shown',
   "  const acDates = view === 'ledger';",
   '  const acDates = true;'],

  ['…and are on the one where they work',
   "  const acDates = view === 'ledger';",
   '  const acDates = false;'],

  ['Sales Orders asks the range',
   '    .filter(o => ptInRange(o && o.orderDate, sxD1, sxD2))' + NL,
   ''],

  ['…and reads its own two boxes',
   "  const [sxD1, sxD2] = ptRangeOf('sxD1', 'sxD2');",
   "  const [sxD1, sxD2] = ['', ''];"],

  ['the Order Console asks the range',
   '    if (!ptInRange(r && r.orderDate, f.d1, f.d2)) return false;',
   '    if (false) return false;'],

  ['…and keeps asking while a dropdown is filled',
   '    if (!ptInRange(r && r.orderDate, f.d1, f.d2)) return false;',
   "    if (skip === '' && !ptInRange(r && r.orderDate, f.d1, f.d2)) return false;"],

  ['…and the two boxes reach the filter',
   "    d1: v('odD1'), d2: v('odD2') };",
   "    d1: '', d2: '' };"],

  ['Clear on the Order Console lets go of Source and Brand',
   "['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odSrc', 'odBrand', 'odQ', 'odD1', 'odD2']",
   "['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ', 'odD1', 'odD2']"],

  ['…and of the dates',
   "['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odSrc', 'odBrand', 'odQ', 'odD1', 'odD2']",
   "['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odSrc', 'odBrand', 'odQ']"],

  ['Clear on Quality Control lets go of the dates',
   "$('qcClear').onclick = () => { ['qcQ', 'qcD1', 'qcD2'].forEach(id => $(id).value = ''); renderQc(); };",
   "$('qcClear').onclick = () => { ['qcQ'].forEach(id => $(id).value = ''); renderQc(); };"],

  ['Clear on Accessories lets go of the dates',
   "  ['acQ', 'acD1', 'acD2'].forEach(id => $(id).value = '');",
   "  ['acQ'].forEach(id => $(id).value = '');"],

  ['Clear on Sales Orders lets go of the dates',
   "  ['sxQ', 'sxD1', 'sxD2'].forEach(id => $(id).value = '');",
   "  ['sxQ'].forEach(id => $(id).value = '');"],
];

const BASE = 1;   // the Ready Goods fixture files are gone; that failure is there before I touch anything
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing or not unique: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'],
    { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > BASE : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
