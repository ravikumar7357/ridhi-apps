const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* THREE BREAKS REMOVED, with the reasons.
   *  · the cancelled-line and refused-requirement guards were duplicates/dead branches and have been
   *    taken out of the code rather than left with a check that cannot bite;
   *  · "only piece asks count against a size" cannot be made to bite: a metre ask never carries a
   *    SKU, so the SKU comparison beside it already answers. The guard stays because it says what it
   *    means, but it will not be presented as tested. */
  /* ---- the sizes ---- */
  ['the same size named twice is one row, not two ceilings',
   "    const k = obUC(sku);" + NL + "    if (!by.has(k)) by.set(k,",
   "    const k = obUC(sku) + l.lineId;" + NL + "    if (!by.has(k)) by.set(k,"],

  ['a running line is not offered as a size',
   "    if (voKind(l) === 'running' || (o && o.orderType === 'running')) return;",
   '    if (false) return;'],

  ['a size whose cloth cannot be worked out is not offered',
   '    if (!n.fabric || !(n.metres > 0)) return;',
   '    if (!n.fabric) return;'],

  ['what one piece takes is the order\'s own arithmetic',
   '    metres: rfdRound(e.metres), per: e.pieces ? e.metres / e.pieces : 0 }))',
   '    metres: rfdRound(e.metres), per: 1 }))'],

  /* ---- asking by the piece ---- */
  ['a piece ask is turned into metres',
   '  const metres = rfdRound(want * line.per);',
   '  const metres = rfdRound(want);'],

  ['…and the pieces are kept as well as the metres',
   "  return rfdWrite(o, { fabric: line.fabric, metres, pieces: want, sku: line.sku,",
   "  return rfdWrite(o, { fabric: line.fabric, metres, sku: line.sku,"],

  ['…and the size travels with it',
   "    size: line.size, what: line.what, colour: line.colour }, note);",
   "    what: line.what, colour: line.colour }, note);"],

  ['…and it goes against the cloth that size is printed on',
   "  return rfdWrite(o, { fabric: line.fabric, metres,",
   "  return rfdWrite(o, { fabric: '', metres,"],

  ['a size that is not on the order is refused',
   "  if (!line) return 'Pick which size you need cloth for.';",
   '  if (!line) return 0;'],

  ['no pieces is refused',
   "  if (!(want > 0)) return 'How many pieces do you need cloth for?';",
   '  if (!(want > 0)) return 0;'],

  /* ---- the second ceiling ---- */
  ['a piece ask has to clear the size as well as the cloth',
   '  const pcs = parseFloat(r.pieces) || 0;' + NL + '  if (pcs > 0 && pcs > rfdPcsAllowed(order, r.sku, r).left) return false;',
   ''],

  ['…and what has already been asked for that size counts against it',
   '  return { need: rfdRound(need), used: rfdRound(used), left: rfdRound(Math.max(0, need - used)) };' + NL + '}' + NL + NL + '/* ---- the decision, which a printer cannot write ---- */',
   '  return { need: rfdRound(need), used: 0, left: rfdRound(need) };' + NL + '}' + NL + NL + '/* ---- the decision, which a printer cannot write ---- */'],

  ['…and the metres still count against the cloth',
   '  if ((parseFloat(r.metres) || 0) > rfdAllowed(order, r.fabric, r).left) return false;',
   ''],

  /* ---- what has reached them ---- */
  ['what has gone out is counted against the fabric',
   'a + rfdSentSeen(r) : a), 0));',
   'a + 0 : a), 0));'],

  ['the office reads its own record of what went out',
   '  const d = rfdDecisionOf(r && r.id);' + NL + '  if (d) return rfdSends(d).reduce((a, x) => a + (parseFloat(x.qty) || 0), 0);',
   '',],

  ['…and the printer falls back to the copy left for them',
   "  return Math.max(0, parseFloat(r && r.shown && r.shown.sent) || 0);",
   '  return 0;'],

  /* AGREED IS NOT ARRIVED — the distinction the whole column exists for. */
  ['an approved requirement still in the store has not arrived',
   'a + rfdSentSeen(r) : a), 0));',
   'a + (parseFloat(r.metres) || 0) : a), 0));'],

  /* ---- the screen ---- */
  ['the printer is shown the sizes',
   '    const rowsP = pcsLines.map(x => {',
   '    const rowsP = [].map(x => {'],

  ['…and a way to ask by the piece',
   '        <button data-vprfd-askp="${esc(o.id)}">Ask by the piece</button>',
   '        <button>Ask by the piece</button>'],

  ['…and what has already reached them',
   '<th class="num" title="Cloth already sent to you against this order.">Already with you</th>',
   '<th class="num">x</th>'],

  ['…and what is still to come',
   '<th class="num">Still to come</th>',
   '<th class="num">y</th>'],

  ['the strip counts orders that cannot be started',
   '    <span class="muted">Orders still short of cloth</span>',
   '    <span class="muted">z</span>'],

  ['the piece button actually raises one',
   "    const err = await rfdSubmitPcs(o, (g('sku') || {}).value, (g('p') || {}).value, (g('pn') || {}).value);",
   "    const err = '';"],
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
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
