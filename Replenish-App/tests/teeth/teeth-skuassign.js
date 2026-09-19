const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- what a tick stands for ---- */
  ['a SKU tick stands for every line behind it',
   "const spSkuKeys = r => ((r && r.orders) || []).filter(o => o && o.open).map(o => o.no + '|' + r.sku);",
   "const spSkuKeys = r => (r ? [r.sku] : []);"],

  /* THE ONE THAT COSTS MONEY TO UNDO: sweeping finished orders to a printer. */
  ['…and a finished order is not swept in with them',
   '((r && r.orders) || []).filter(o => o && o.open)',
   '((r && r.orders) || []).filter(o => o)'],

  ['some ticked and some not is its own state',
   "  return on === 0 ? 'none' : (on === keys.length ? 'all' : 'some');",
   "  return on === 0 ? 'none' : 'all';"],

  ['…and none ticked is not mistaken for all',
   "  return on === 0 ? 'none' : (on === keys.length ? 'all' : 'some');",
   "  return keys.length ? 'all' : 'none';"],

  ['a SKU with nothing to give has no tick at all',
   "  if (!keys.length) return 'none';",
   "  if (!keys.length) return 'all';"],

  /* ---- ticking ---- */
  ['ticking a SKU adds its lines',
   '  if (state === \'all\') keys.forEach(k => ORD.pick.delete(k));' + NL + '  else keys.forEach(k => ORD.pick.add(k));',
   '  if (state === \'all\') keys.forEach(k => ORD.pick.delete(k));'],

  ['…and ticking it again lets them go',
   '  if (state === \'all\') keys.forEach(k => ORD.pick.delete(k));' + NL + '  else keys.forEach(k => ORD.pick.add(k));',
   '  keys.forEach(k => ORD.pick.add(k));'],

  /* A half-ticked box must fill up, not empty — somebody who chose two orders elsewhere and then
   * presses the SKU box wants the rest as well. */
  ['…and a half-ticked one fills up rather than emptying',
   "  if (state === 'all') keys.forEach(k => ORD.pick.delete(k));",
   "  if (state !== 'none') keys.forEach(k => ORD.pick.delete(k));"],

  /* DROPPED: "a SKU that is not on screen does nothing". The guard cannot be made to bite —
   * spSkuKeys answers an empty list for a made-up row, and the keys check below already returns.
   * It stays because it says what it means; it will not be claimed as tested. */
  /* ---- the screen ---- */
  ['the by-SKU screen offers tick boxes',
   '  const spPick = (ptCanEdit() || spCanAssign()) && (!bySku || spCanAssign());',
   '  const spPick = !bySku && (ptCanEdit() || spCanAssign());'],

  ['…and only to somebody who may assign',
   '  const spPick = (ptCanEdit() || spCanAssign()) && (!bySku || spCanAssign());',
   '  const spPick = (ptCanEdit() || spCanAssign());'],

  ['…and the SKU row draws one',
   '      + (spPick ? `<td class="frz">${skuKeys.length',
   '      + (false ? `<td class="frz">${skuKeys.length'],

  ['…and tick-them-all takes the lines, not the rows',
   '      else rows.slice(0, 600).forEach(x => (bySku ? spSkuKeys(x) : [x.orderNo + \'|\' + x.sku])' + NL
     + '        .forEach(k => ORD.pick.add(k)));',
   "      else rows.slice(0, 600).forEach(x => ORD.pick.add(x.orderNo + '|' + x.sku));"],

  ['…and the bar says a SKU tick takes every order behind it',
   "          bySku ? ' Ticking a SKU takes every open order behind it.' : ''}</span>`);",
   "          false ? '' : ''}</span>`);"],

  ['…and the count says lines',
   '        + (spCanAssign() ? `<button id="spAssignAll" class="ghost">Assign printer to ${nf(n)} line(s)</button>` : \'\')',
   '        + (spCanAssign() ? `<button id="spAssignAll" class="ghost">Assign printer to ${nf(n)}</button>` : \'\')'],

  ['…and how many SKUs they came from',
   "      ? `<span class=\"muted\" style=\"font-size:12.5px\"><b>${nf(n)}</b> line(s) ticked${" + NL
     + "          bySku ? ' across ' + nf(new Set([...(ORD.pick || new Set())].map(k => k.slice(k.indexOf('|') + 1))).size) + ' SKU(s)' : ''}</span>`",
   "      ? `<span class=\"muted\" style=\"font-size:12.5px\"><b>${nf(n)}</b> line(s) ticked</span>`"],

  /* HANDING OVER TO SHIPPING IS A DECISION PER ORDER, and a combined row hides which orders it is
   * made of — so it stays on the by-order view. */
  ['…and handing over to shipping stays off this view',
   "        + (!bySku && ptCanEdit() ? `<button id=\"spHandAll\">Hand ${nf(n)} over to shipping</button>` : '')",
   "        + (ptCanEdit() ? `<button id=\"spHandAll\">Hand ${nf(n)} over to shipping</button>` : '')"],

  /* ---- the click ---- */
  ['clicking a SKU box goes through spSkuToggle',
   "  const g = e.target.closest('[data-spskupick]');" + NL + "  if (g) return spSkuToggle(g.getAttribute('data-spskupick'));",
   ''],
];

const BASE = 1;
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
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
