const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- the gate at the Job Work form ---- */
  ['an issue beyond the zipper stock is refused',
   '  if (bal - need < 0)' + NL + '    return `Cannot issue ${nf(need)} zipper(s)',
   '  if (false)' + NL + '    return `Cannot issue ${nf(need)} zipper(s)'],

  /* The OLD behaviour, put back: an unlisted zipper waved through. Turning the refusal into `if
   * (false)` left `item` undefined and threw two lines later, which is a typo, not a regression
   * anybody would write. */
  ['…and a zipper nobody has stocked is refused, not waved through',
   '  const item = accListNow().find(it => String(it.code || \'\').trim().toUpperCase() === code.toUpperCase());'
     + NL + '  if (!item)' + NL + "    return `Zipper \"${code}\" is not on the accessories list, so there is no stock to issue ${nf(need)} from. `"
     + NL + '      + `Add it in Accessories and enter what is on the shelf, then make this entry.`;',
   '  const item = accListNow().find(it => String(it.code || \'\').trim().toUpperCase() === code.toUpperCase());'
     + NL + "  if (!item) return '';"],

  ['…and nought zippers are not refused for no reason',
   "  if (need <= 0) return '';                   // nought zippers cannot overdraw anything",
   '  if (false) return 0;'],

  ['…and the typed figure is what is checked when there is one',
   '  const need = (zipsIssued === null || zipsIssued === undefined || !isFinite(zipsIssued))' + NL
     + '    ? (parseInt(qty, 10) || 0) * mdbZipQty(m) : zipsIssued;',
   '  const need = (parseInt(qty, 10) || 0) * mdbZipQty(m);'],

  /* THE BUG ITSELF: a guard that cannot see its data and answers yes. */
  ['the list is found even when the session copy of it is empty',
   '  if (PTE.acc && PTE.acc.length) return PTE.acc;' + NL + '  return ptList((PTG.masters || {}).accessories);',
   '  return PTE.acc || [];'],

  ['…and so is the ledger',
   '  if (a && a.length) return a;' + NL + '  return PTE.accLedger || [];',
   '  return a || [];'],

  /* ---- the deduction, which is what actually wrote the 150 ---- */
  ['the deduction refuses to overdraw whoever calls it',
   '  if (ptAccBalance(item.code) - need < 0)' + NL + '    throw new Error(`Zipper "${item.code}" has ',
   '  if (false)' + NL + '    throw new Error(`Zipper "${item.code}" has '],

  ['…and refuses a length nobody has stocked',
   '  if (!item)' + NL + '    throw new Error(`Zipper "${chain}" is not on the accessories list.',
   '  if (false)' + NL + '    throw new Error(`Zipper "${chain}" is not on the accessories list.'],

  /* ---- the movement anybody can type ---- */
  ['an issue typed on the Accessories screen cannot overdraw',
   '    if (bal + move < 0)',
   '    if (false)'],

  /* DROPPED: 'only movements that take stock away are asked about'. Widening the condition to every
   * movement changes nothing — an IN or a RETURN adds, so bal + move is never below nought and the
   * refusal never fires. It reads as intent and is not load-bearing; it will not be claimed as
   * tested. */
  ['…and an adjustment cannot be used to go round it',
   "  const move = accMove({ txnType: v.txnType, qty: q });" + NL + '  if (move < 0) {',
   "  const move = v.txnType === 'ADJUST' ? 0 : accMove({ txnType: v.txnType, qty: q });" + NL + '  if (move < 0) {'],

  ['…and the row being edited does not count against itself',
   '    if (exceptId && r._id === exceptId) return b;',
   ''],

  ['…and the edit passes its own id',
   "      const err = accTxnCheck(v, r._id); if (err) return err;",
   '      const err = accTxnCheck(v); if (err) return err;'],

  /* A return and an opening are not issues. */
  ['a return adds to the shelf rather than being checked against it',
   "    if (r.txnType === 'OPENING' || r.txnType === 'IN' || r.txnType === 'RETURN') return b + q;",
   "    if (r.txnType === 'OPENING' || r.txnType === 'IN') return b + q;"],
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
