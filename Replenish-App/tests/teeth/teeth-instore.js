const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  /* ---- what came in ---- */
  ['a receipt counts as into the store', "      if (r.orderNo) get(obKeyOf(r.orderNo, sku)).in += q;", '      '],
  ['…and an unconfirmed transfer from the press does not', "    if (r.txnType === 'RECEIVE' || (r.txnType === 'TRANSFER_IN' && r.confirmed === true && r.reversed !== true)) {", "    if (r.txnType === 'RECEIVE' || r.txnType === 'TRANSFER_IN') {"],
  ['…nor does opening stock belong to an order', "    if (r.txnType !== 'ISSUE' && r.txnType !== 'FBA' && r.txnType !== 'FBA_RETURN') return;   // OPENING and the markers", "    if (r.txnType === 'OPENING') { if (r.orderNo) get(obKeyOf(r.orderNo, sku)).in += q; return; }" + NL + "    if (r.txnType !== 'ISSUE' && r.txnType !== 'FBA' && r.txnType !== 'FBA_RETURN') return;"],
  /* ---- what went out ---- */
  ['what went out is taken off the stock', '    e.store = Math.max(0, e.in - e.out); });', '    e.store = e.in; });'],
  ['…and the stock never goes below nothing', '    e.store = Math.max(0, e.in - e.out); });', '    e.store = e.in - e.out; });'],

  ['a dispatch that names no order is shared by SKU', '  ordShareBySku(whole, lines,' + NL + '    r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in - e.out : 0; },', '  ordShareBySku(new Map(), lines,' + NL + '    r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in - e.out : 0; },'],
  ['…never beyond what that order took in', '    r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in - e.out : 0; },', '    r => r.qty,'],
  ['…and a named dispatch comes off the room first', '    r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in - e.out : 0; },', '    r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in : 0; },'],
  ['…and the share is marked as worked out', "      e.out += take; e.fba += p.fba * f; e.fbaOpen += p.fbaOpen * f; e.worked += take; });", "      e.out += take; e.fba += p.fba * f; e.fbaOpen += p.fbaOpen * f; });"],
  ['a return from FBA puts the pieces back', "    const sign = r.txnType === 'FBA_RETURN' ? -1 : 1;", '    const sign = 1;'],
  ['pieces not yet shipped are still the factory\'s', "    const shipped = st && st.st === 'shipped';", '    const shipped = true;'],
  /* ---- the sharing rule itself ---- */
  ['the loose pieces go to the OLDEST order first', '    (bySku.get(sku) || []).slice().sort((a, b) => when(a) - when(b)).forEach(r => {', '    (bySku.get(sku) || []).slice().sort((a, b) => when(b) - when(a)).forEach(r => {'],
  ['…once, never twice', '      give(r, take, take / whole);' + NL + '      left -= take;', '      give(r, take, take / whole);'],
  /* ---- the screen ---- */
  ['the In store cell shows what is there, not what came in', "          + (g && g.store ? `<b>${nf(g.store)}</b>` : '<span class=\"muted\">—</span>')", "          + (g && g.in ? `<b>${nf(g.in)}</b>` : '<span class=\"muted\">—</span>')"],
  ['…and names the pieces held for FBA', '          + (g && g.fbaOpen ? `<div class="muted" style="font-size:10.5px">+${nf(g.fbaOpen)} held for FBA</div>` : \'\')', ''],
  ['there is a To FBA column', "'QC', 'Pressed', 'In store', 'To FBA', 'To cut', 'To make', 'Status'", "'QC', 'Pressed', 'In store', 'To cut', 'To make', 'Status'"],
  ['…and the numeric run covers it', "(i >= 9 && i <= 18 ? ' class=\"num\"' : '')", "(i >= 9 && i <= 17 ? ' class=\"num\"' : '')"],
  ['…and it says how many are waiting to ship', "              + (g.fbaOpen ? `<div class=\"muted\" style=\"font-size:10.5px\">${nf(g.fbaOpen)} waiting</div>` : '')", ''],
  ['a finished line says where its pieces are', "  if (!r.open) return 'Complete' + tail;", "  if (!r.open) return 'Complete';"],
  ['…and an unfinished one still answers about its stage', "  const tail = fin.fbaOpen ? ' · ' + nf(fin.fbaOpen) + ' waiting to ship to FBA'" + NL + "    : (fin.store ? ' · ' + nf(fin.store) + ' in store' : '');", "  const tail = '';" + NL + "  if (fin.store || fin.fbaOpen) return 'Store';"],
  ['the journey shows the last leg', "    ['In store', sum('store')], ['To FBA', sum('fba')]];", "    ['In store', sum('store')]];"],
  ['the export carries it', "    'Into store', 'In store now', 'To FBA', 'FBA not yet shipped', 'Waiting at'].map(csvCell).join(',')];", "    'Waiting at'].map(csvCell).join(',')];"],
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
