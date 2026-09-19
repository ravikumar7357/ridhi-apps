/* Break each piece of the RFD feature on purpose and check the suite notices. Every break here is a
 * mistake somebody could plausibly make on this code — two of them are mistakes I made myself and
 * had to be shown. */
const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- the ceiling ---- */
  ['a cut line is turned into cloth, not counted as pieces',
   '  return { fabric, metres: (parseFloat(l.qty) || 0) * cons, how: \'pieces x consumption\' };',
   '  return { fabric, metres: (parseFloat(l.qty) || 0), how: \'pieces x consumption\' };'],

  /* The guard that is load-bearing. rfdOrderNeed has a second copy of this check and rfdOrderNeed
   * already drops what rfdLineNeed refuses, so removing THAT copy changes nothing — it is a redundant
   * line, not an untested rule. This is the one the rule actually lives on. */
  ['a cancelled line is left out of the ceiling',
   "  if (!o || !l || l.cancelled) return { fabric: '', metres: 0, how: 'cancelled' };",
   "  if (!o || !l) return { fabric: '', metres: 0, how: 'cancelled' };"],

  ['a line whose cloth cannot be worked out is reported',
   '  if (!(cons > 0)) return { fabric, metres: 0, how: \'the master database has no consumption for \' + (l.sku || \'?\') };',
   '  if (!(cons > 0)) return { fabric, metres: 0, how: \'cancelled\' };'],

  ['a running line uses its own metres',
   '    const m = parseFloat(l.meters) || 0;' + NL + '    if (!fabric) return { fabric: \'\', metres: 0, how: \'the line does not say which fabric\' };',
   '    const m = 0;' + NL + '    if (!fabric) return { fabric: \'\', metres: 0, how: \'the line does not say which fabric\' };'],

  /* ---- what counts against it ---- */
  ['what has already been asked comes off the ceiling',
   '  return { need: rfdRound(need), used: rfdRound(used), left: rfdRound(Math.max(0, need - used)) };',
   '  return { need: rfdRound(need), used: rfdRound(used), left: rfdRound(need) };'],

  ['a refused request gives its metres back',
   '    const d = rfdDecisionOf(r.id);' + NL + '    if (d && d.stage === \'rejected\') return a;',
   '    const d = rfdDecisionOf(r.id);'],

  /* THE ONE MY OWN TEST CAUGHT. Judging a request against every other one, including those raised
   * after it, quietly un-approves cloth that was already agreed. */
  ['a request is judged against what was asked BEFORE it, not after',
   '    if (cut && rfdSeq(r) >= cut) return a;' + NL,
   ''],

  ['…and the row on screen shows the same sum its stage was decided by',
   '    const cap = r._order ? rfdAllowed(r._order, r.fabric, r) : null;' + NL + '    const want = parseFloat(r.metres) || 0;',
   '    const cap = r._order ? rfdAllowed(r._order, r.fabric, r.id) : null;' + NL + '    const want = parseFloat(r.metres) || 0;'],

  /* ---- auto-approve, which is the whole feature ---- */
  ['inside the order is agreed without anybody touching it',
   '  return rfdAuto(r, o) ? \'approved\' : \'pending\';',
   '  return \'pending\';'],

  ['…and beyond it is not',
   '  return (parseFloat(r.metres) || 0) <= rfdAllowed(order, r.fabric, r).left;',
   '  return true;'],

  /* ---- where things are written ---- */
  ['the decision is kept where a printer cannot write it',
   "  try { await ptPut('pt_rfdDecisions/' + id, rec); }" + NL + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  RFD.decisions = Object.assign({}, RFD.decisions || {}, { [id]: rec });' + NL + '  await rfdMirror(r, rec);' + NL + '  return \'\';' + NL + '}' + NL + NL + '/** Hand cloth over',
   "  try { await ptPut('pt_vendorOrders/' + r.vendorCode + '/' + r.orderId + '/rfdReqs/' + id + '/decision', rec); }" + NL + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  RFD.decisions = Object.assign({}, RFD.decisions || {}, { [id]: rec });' + NL + '  await rfdMirror(r, rec);' + NL + '  return \'\';' + NL + '}' + NL + NL + '/** Hand cloth over'],

  ['…and a copy is left where the printer can read it',
   "  try { await ptPut('pt_vendorOrders/' + r.vendorCode + '/' + r.orderId + '/rfdReqs/' + r.id + '/shown', shown); }",
   '  try { await Promise.resolve(shown); }'],

  ['the printer writes their ask into their own branch',
   "  try { await ptPut('pt_vendorOrders/' + (VP.code || o.vendorCode) + '/' + o.id + '/rfdReqs/' + id, rec); }",
   "  try { await ptPut('pt_rfdReqs/' + id, rec); }"],

  /* A printer can write anything into their own branch, so nothing here may read a decision out of it. */
  ['a decision is never read out of the printer\'s own branch',
   'const rfdDecisionOf = id => ((RFD.decisions || {})[String(id)] || null);',
   'const rfdDecisionOf = id => { const d = (RFD.decisions || {})[String(id)]; if (d) return d; '
     + 'const r = ((VO.rows || []).flatMap(o => rfdReqsOf(o))).find(x => x.id === String(id)); '
     + 'return (r && (r.decision || (r.shown && { stage: r.shown.stage }))) || null; };'],

  /* ---- the checks on each write ---- */
  ['cloth cannot go out beyond what was asked for',
   "  if (q > left) return 'Only ' + nf(left) + ' m of this requirement is still to go out.';",
   '  if (false) return 0;'],

  ['…nor against one still waiting for approval',
   "  if (st === 'pending') return 'That one is still waiting for approval.';",
   '  if (false) return 0;'],

  ['…and a requirement cannot be refused after the cloth has gone',
   "  if (rfdSentQty(id) > 0 && stage === 'rejected')",
   '  if (false && stage === \'rejected\')'],

  ['a fabric the order does not use cannot be asked for',
   "  if (!(cap.need > 0)) return fab + ' is not on this order.';",
   '  if (false) return 0;'],

  ['the date is written day-first, the way the rest of the database keeps it',
   "  const date = m ? m[3] + '/' + m[2] + '/' + m[1] : (dateIso || voTodayDMY());",
   '  const date = dateIso || voTodayDMY();'],

  /* ---- who may do what ---- */
  ['answering asks for its own right',
   '  if (!rfdCanApprove()) return RFD_NO_APPROVE;',
   '  if (false) return RFD_NO_APPROVE;'],

  ['sending asks for a different one',
   '  if (!rfdCanSend()) return RFD_NO_SEND;',
   '  if (false) return RFD_NO_SEND;'],

  ['…and the approving right does not carry sending with it',
   'const rfdCanSend = () => !spIsVendor() && !!(ME.admin || ME.rfdSend);',
   'const rfdCanSend = () => rfdCanApprove();'],

  ['having the tab is not the same as being allowed to answer',
   'const rfdCanApprove = () => !spIsVendor() && !!(ME.admin || ME.rfdApprove);',
   "const rfdCanApprove = () => !spIsVendor() && !!(ME.admin || ME.rfdApprove || (ME.tabs || []).indexOf('rfd') >= 0);"],

  ['a printer is kept out of the answering side',
   'const rfdCanApprove = () => !spIsVendor() &&',
   'const rfdCanApprove = () => !false &&'],

  /* ---- the screen ---- */
  ['the queue is counted on the sidebar',
   "  const n = rfdCanApprove() ? rfdRows().filter(r => r.stage === 'pending').length : 0;",
   '  const n = rfdCanApprove() ? rfdRows().length : 0;'],

  ['somebody who may only look is offered no buttons',
   "  if (rfdCanApprove() && r.stage === 'pending')",
   "  if (r.stage === 'pending')"],

  ['the row says how far beyond the order it goes',
   "        + (over > 0 ? nf(over) + ' m beyond what this order covers' : 'inside what this order covers') + '</div>'",
   "        + 'inside what this order covers' + '</div>'"],

  ['the date range on this screen filters',
   '    if (!ptInRange(r.raisedAt, f.d1, f.d2)) return false;',
   '    if (false) return false;'],

  ['the fabric filter filters',
   '    if (f.fab && rfdKey(r.fabric) !== rfdKey(f.fab)) return false;',
   '    if (false) return false;'],

  ['the stage filter filters',
   '    if (f.st && r.stage !== f.st) return false;',
   '    if (false) return false;'],

  /* ---- the printer's own screen ---- */
  ['the portal works out for itself that an ask is already agreed',
   "    stage: (r.shown && r.shown.stage) || (rfdAuto(r, o) ? 'approved' : 'pending'),",
   "    stage: (r.shown && r.shown.stage) || 'pending',"],
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
