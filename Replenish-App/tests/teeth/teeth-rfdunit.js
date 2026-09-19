const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- which unit a line is in ---- */
  ['the printing rule decides how a line goes out',
   "  const rule = ptPrintIssueAs(mdbOf(l.sku));",
   "  const rule = ptPrintIssueAs(mdbOf(l.sku)) === 'cut' ? 'running' : 'cut';"],

  ['a running line is cloth whatever any rule says',
   "  if (voKind(l) === 'running' || (o && o.orderType === 'running')) return 'running';" + NL + "  const rule = ptPrintIssueAs(mdbOf(l.sku));",
   "  const rule = ptPrintIssueAs(mdbOf(l.sku));"],

  ['a line with no rule is treated as cut pieces',
   "  if (rule === 'cut' || rule === 'running') return rule;" + NL + "  return 'cut';",
   "  if (rule === 'cut' || rule === 'running') return rule;" + NL + "  return 'running';"],

  /* ---- the two pools ---- */
  ['a size that goes out cut puts no cloth in the fabric pool',
   "    if (rfdIssueAs(o, l) === 'cut') return;" + NL + '    const n = rfdLineNeed(o, l);',
   '    const n = rfdLineNeed(o, l);'],

  ['…and cloth that goes out running is not offered as a size',
   "    if (rfdIssueAs(o, l) !== 'cut') return;",
   '    if (false) return;'],

  ['a cancelled line is not offered as a size',
   '    if (l.cancelled) return;' + NL + "    const sku = String(l.sku || '').trim();",
   "    const sku = String(l.sku || '').trim();"],

  ['a size with no cloth figure is still offered',
   '    const pieces = parseFloat(l.qty) || 0;' + NL + '    if (!(pieces > 0)) return;',
   '    const pieces = parseFloat(l.qty) || 0;' + NL + '    if (!(pieces > 0)) return;' + NL
     + '    if (!(rfdLineNeed(o, l).metres > 0)) return;'],

  /* ---- the unit itself ---- */
  ['a piece requirement is counted in pieces, not in the metres behind it',
   "const rfdWant = r => rfdRound(rfdUnit(r) === 'pcs' ? (r && r.pieces) : (r && r.metres));",
   'const rfdWant = r => rfdRound(r && r.metres);'],

  ['…and it is marked as being in pieces when it is raised',
   "  return rfdWrite(o, { unit: 'pcs', pieces: want, sku: line.sku, size: line.size,",
   '  return rfdWrite(o, { pieces: want, sku: line.sku, size: line.size,'],

  ['…and half a piece cannot be asked for',
   "  if (Math.round(want) !== want) return 'Pieces have to be a whole number.';",
   '  if (false) return 0;'],

  ['…nor sent',
   "  if (unit === 'pcs' && Math.round(q) !== q) return 'Pieces have to be a whole number.';",
   '  if (false) return 0;'],

  /* ---- the ceilings, each in its own unit ---- */
  ['a piece requirement is judged against its size, not against cloth',
   "  return rfdUnit(r) === 'pcs'" + NL + '    ? rfdWant(r) <= rfdPcsAllowed(order, r.sku, r).left' + NL
     + '    : rfdWant(r) <= rfdAllowed(order, r.fabric, r).left;',
   '  return rfdWant(r) <= rfdAllowed(order, r.fabric, r).left;'],

  ['…and a metre requirement against cloth',
   "  return rfdUnit(r) === 'pcs'" + NL + '    ? rfdWant(r) <= rfdPcsAllowed(order, r.sku, r).left' + NL
     + '    : rfdWant(r) <= rfdAllowed(order, r.fabric, r).left;',
   '  return rfdWant(r) <= rfdPcsAllowed(order, r.sku, r).left;'],

  ['the cloth pool counts only metre requirements',
   "    if (rfdUnit(r) !== 'm') return a;",
   '    if (false) return a;'],

  /* DROPPED: "the size pool counts only piece requirements" cannot be made to bite. A metre ask
   * never carries a SKU, so the SKU comparison beside it already answers. The guard stays because
   * it says what it means; it will not be presented as tested. */
  /* ---- sending ---- */
  ['what is left to send is counted in the requirement\'s own unit',
   '  const left = rfdRound(want - rfdSentQty(id));',
   '  const left = rfdRound((parseFloat(r.metres) || 0) - rfdSentQty(id));'],

  ['…and the refusal says which unit',
   "  if (q > left) return 'Only ' + nf(left) + ' ' + unit + ' of this requirement is still to go out.';",
   "  if (q > left) return 'Only ' + nf(left) + ' m of this requirement is still to go out.';"],

  ['…and a requirement is finished when the whole of what was asked has gone',
   '  const want = rfdWant(r);' + NL + "  if (want > 0 && rfdSentQty(r.id) >= want) return 'sent';",
   '  const want = parseFloat(r.metres) || 0;' + NL + "  if (want > 0 && rfdSentQty(r.id) >= want) return 'sent';"],

  ['pieces that reached a printer are counted against the size',
   "    (rfdUnit(r) === 'pcs' && obUC(r.sku) === obUC(sku) ? a + rfdSentSeen(r) : a), 0));",
   '    (a), 0));'],

  ['…and metres against the fabric, not mixed together',
   "    (rfdUnit(r) === 'm' && rfdKey(r.fabric) === rfdKey(fabric) ? a + rfdSentSeen(r) : a), 0));",
   '    (rfdKey(r.fabric) === rfdKey(fabric) ? a + rfdSentSeen(r) : a), 0));'],

  /* ---- the screens ---- */
  ['the printer is shown what has already reached them, per size',
   '      const got = rfdSentPcsFor(o, x.sku);',
   '      const got = 0;'],

  ['the metre box is not drawn when nothing goes out as cloth',
   '      ${fabs ? `<div class="toolbar" style="margin-bottom:6px">',
   '      ${true ? `<div class="toolbar" style="margin-bottom:6px">'],

  ['a size with no printing rule is flagged',
   '      ${unruled.length ? `<div class="muted" style="font-size:12px;margin-bottom:8px">',
   '      ${false ? `<div class="muted" style="font-size:12px;margin-bottom:8px">'],

  ['an order made only of sizes is still an order to ask against',
   '  && (rfdFabrics(o).length > 0 || rfdPieceLines(o).length > 0));',
   '  && (rfdFabrics(o).length > 0));'],
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
