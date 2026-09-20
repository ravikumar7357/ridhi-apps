const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['handed over is said by name, not as "Complete"', "  if (!r.open) return (r.handedAt ? 'Handed over' : 'Complete') + tail;", "  if (!r.open) return 'Complete' + tail;"],
  ['a made Shopify line is ready to hand over', "  return 'Ready to hand over to shipping' + tail;", "  return 'Store / dispatch';"],
  ['…and it says what it is waiting for', "  return 'Ready to hand over to shipping' + tail;", "  return 'Done' + tail;"],
  ['the Shopify table has Received', "'Size', 'Pieces', 'Printing', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'To make', 'Quilt team', 'Status', 'Entry'];", "'Size', 'Pieces', 'Printing', 'Cut', 'Issued', 'QC', 'Pressed', 'To make', 'Quilt team', 'Status', 'Entry'];"],
  ['…and QC', "'Size', 'Pieces', 'Printing', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'To make', 'Quilt team', 'Status', 'Entry'];", "'Size', 'Pieces', 'Printing', 'Cut', 'Issued', 'Received', 'Pressed', 'To make', 'Quilt team', 'Status', 'Entry'];"],
  ['…and its cells match its headings', "      + `<td class=\"num\"${r.overRecv ? ' style=\"color:#7f6000;font-weight:700\"' : ''}>${nf(r.received)}</td>`" + NL + "      + (q => `<td class=\"num\">` + (q", "      + (q => `<td class=\"num\">` + (q"],
  ['…and the numeric run reaches the last figure', '  const numFrom = bySku ? 6 : 9, numTo = bySku ? 12 : 16;', '  const numFrom = bySku ? 6 : 9, numTo = bySku ? 11 : 14;'],
  ['the by-SKU table has Received', "? ['SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Received', 'Pressed', 'To make', 'Shopify orders']", "? ['SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Pressed', 'To make', 'Shopify orders']"],
  ['the Printing cell knows what a vendor holds', "            : '<span class=\"muted\">not given to a vendor</span>'))(ordVendorOf(r.orderNo, r.sku))}</td>`" + NL + "      + `<td class=\"num\">${nf(r.cut)}</td><td class=\"num\">${nf(r.issued)}</td>`" + NL + "      + `<td class=\"num\"${r.overRecv", "            : '<span class=\"muted\">not given to a vendor</span>'))(null)}</td>`" + NL + "      + `<td class=\"num\">${nf(r.cut)}</td><td class=\"num\">${nf(r.issued)}</td>`" + NL + "      + `<td class=\"num\"${r.overRecv"],
  ['a Shopify order number opens that order', '      + `<td${spPick ? \'\' : \' class="frz"\'} style="text-align:left"><a href="#" data-ordj="${esc(r.orderNo)}"', '      + `<td${spPick ? \'\' : \' class="frz"\'} style="text-align:left"><span data-x="${esc(r.orderNo)}"'],
  ['…and so does each order chip', '      .map(o => `<a href="#" data-ordj="${esc(o.no)}"', '      .map(o => `<span data-x="${esc(o.no)}"'],
  ['the journey ends at the shipping table', "    .concat(shop ? [['Handed over', handed]] : []);", '    ;'],
  ['…and says how many have gone', "      + (shop ? `  ·  ${nf(rows.filter(r => r.handedAt).length)} of ${nf(rows.length)} handed to shipping` : ''),", '      ,'],
  ['…and shows no tiles for stages the order never had', "    .concat(shop && !sum('store') && !sum('fba') ? [] : [['In store', sum('store')], ['To FBA', sum('fba')]])", "    .concat([['In store', sum('store')], ['To FBA', sum('fba')]])"],
  ['…but shows them when it did pass through the store', "    .concat(shop && !sum('store') && !sum('fba') ? [] : [['In store', sum('store')], ['To FBA', sum('fba')]])", '    .concat(shop ? [] : [[\'In store\', sum(\'store\')], [\'To FBA\', sum(\'fba\')]])'],
  ['…and the handed-over column goes with the tile', "      + (!shop ? '' : `<td class=\"num\"${r.handedAt ? ` title=\"${esc(String(r.handedBy || '').split('@')[0] + ' · ' + (ptIsoDate(r.handedAt) || ''))}\"` : ''}>`" + NL + "          + (r.handedAt ? `<b style=\"color:#166534\">${nf(r.qty)}</b>` : '<span class=\"muted\">—</span>') + '</td>')", ''],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-140)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
