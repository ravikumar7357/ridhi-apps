const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['the change is found from the line it happened to',
   '      const k = obKeyOf(o._id, a.sku);' + NL + '      if (!map.has(k)) map.set(k, []);',
   '      const k = obKeyOf(o._id, a.sku);' + NL + '      if (true) return;' + NL + '      if (!map.has(k)) map.set(k, []);'],
  ['…and the newest is the one at the front',
   "  map.forEach(l => l.sort((x, y) => String(y.at || '').localeCompare(String(x.at || ''))));",
   ''],
  ['one that nobody has seen is news',
   "const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => !a.seenAt);",
   'const ordQtyUnseen = (orderNo, sku) => [];'],
  ['…and one that somebody HAS seen is not',
   "const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => !a.seenAt);",
   'const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku);'],
  ['it is counted across the whole book',
   '  ordQtyAdjIndex().forEach(l => l.forEach(a => { if (!a.seenAt) out.push(a); }));',
   ''],
  ['the sidebar count says how many are waiting',
   "  const el = $('ordAdjBadge'); if (!el) return;" + NL + '  const n = ordQtyUnseenAll().length;',
   "  const el = $('ordAdjBadge'); if (!el) return;" + NL + '  const n = 0;'],
  ['saying you have seen it is actually written, not just shown',
   "  const patch = { [base + 'seenAt']: now, [base + 'seenBy']: ME.email };" + NL
     + '  try { await ptPatch(patch); }',
   "  const patch = { [base + 'seenAt']: now, [base + 'seenBy']: ME.email };" + NL
     + '  try { 0; }'],
  ['…with who said it, not just when',
   "  const patch = { [base + 'seenAt']: now, [base + 'seenBy']: ME.email };",
   "  const patch = { [base + 'seenAt']: now };"],
  /* "The screen is built from the patch, not from a second copy" has no break of its own: swapping
   * patch[base + 'seenAt'] for `now` is the same value by definition. The property is what makes the
   * break above bite — drop seenBy from the patch and the screen loses it too, which is exactly what
   * an independent copy would have hidden. */
  ['the line says the quantity moved',
   '      + ordQtyAdj(r.orderNo, r.sku).slice(0, 3).map(a => `<div><span class="pill"`',
   '      + [].slice(0, 3).map(a => `<div><span class="pill"`'],
  ['…and offers the chance to say it was seen',
   '        + (a.seenAt ? \'\' : ` <a href="#" data-ordseen="${esc(a.orderNo)}|${esc(a.id)}" style="font-size:10.5px">Seen</a>`)',
   "        + ''"],
  ['…but stops offering once it has been',
   '        + (a.seenAt ? \'\' : ` <a href="#" data-ordseen="${esc(a.orderNo)}|${esc(a.id)}" style="font-size:10.5px">Seen</a>`)',
   '        + ` <a href="#" data-ordseen="${esc(a.orderNo)}|${esc(a.id)}" style="font-size:10.5px">Seen</a>`'],
  ['the top of the screen says it, not only the row',
   "    ? '<b>' + nf(unseen.length) + ' quantit' + (unseen.length > 1 ? 'ies were' : 'y was')" + NL
     + "      + ' changed on an order, and nobody here has said they have seen it</b> — '",
   "    ? ''" + NL + "      + ''"],
  ['…and the line count is not lost with it',
   '    + esc(`${nf(rows.length)} of ${nf(all.length)} line(s)`',
   "    + esc(``"],
  ['it has a tile of its own',
   "  qtyChanged: { label: 'Quantity changed', of: r => ordQtyUnseen(r.orderNo, r.sku).length },",
   ''],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-150)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
