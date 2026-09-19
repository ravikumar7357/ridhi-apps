const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a frozen fortnight is read from its snapshot',
   '  const held = payFrozenRows(VPAY_TYPE, yr, mo, period);',
   '  const held = null;'],
  ['the month adds its halves, never re-multiplies',
   "      ['qty', 'over', 'rej', 'gone', 'amount'].forEach(f => { t[f] = (t[f] || 0) + (x[f] || 0); });",
   "      ['qty', 'over', 'rej', 'gone'].forEach(f => { t[f] = (t[f] || 0) + (x[f] || 0); });"],
  ['the month is each half as it stands, not one live sum',
   '    [1, 2].forEach(p => vpayRows(yr, mo, p).forEach(x => {',
   '    [1, 2].forEach(p => vpayLive(yr, mo, p).forEach(x => {'],
  ['work with no rate cannot be frozen',
   '    if (bare.length) return say(`${nf(bare.length)} line(s) in this period have NO approved rate — `',
   '    if (false) return say(`${nf(bare.length)} line(s) in this period have NO approved rate — `'],
  ['only an admin freezes',
   "  if (!ME.admin) return say('Only an admin can freeze or re-open a period.', true);" + NL + '  const { yr, mo } = payParts(), per = payPeriod();' + NL + "  if (per === 3) return say('Freeze a fortnight",
   '  const { yr, mo } = payParts(), per = payPeriod();' + NL + "  if (per === 3) return say('Freeze a fortnight"],
  ['the snapshot is the LIVE calculation, not what a search left on screen',
   '    const live = vpayLive(yr, mo, per);' + NL + "    if (!live.length) return say('Nothing to freeze in this period.', true);",
   '    const live = (HR.rows || []);' + NL + "    if (!live.length) return say('Nothing to freeze in this period.', true);"],
  ['the freeze keeps the deliveries behind each row',
   '      gone: r.gone, amount: r.amount, dels: r.dels }));',
   '      gone: r.gone, amount: r.amount }));'],
  ['…and who froze it',
   '    rec.meta[per] = { by: ME.email, at: new Date().toISOString(), lines: live.length, amount: amt };' + NL + '  } else {' + NL + '    if (!confirm(`Re-open ${PER_LBL[per]} of ${payYM()} for vendors?',
   '    rec.meta[per] = { lines: live.length, amount: amt };' + NL + '  } else {' + NL + '    if (!confirm(`Re-open ${PER_LBL[per]} of ${payYM()} for vendors?'],
  ['it is filed under the vendor type',
   '  const key = payFreezeKey(VPAY_TYPE, yr, mo), rec = payFreezeRec(VPAY_TYPE, yr, mo);',
   "  const key = payFreezeKey('x', yr, mo), rec = payFreezeRec(VPAY_TYPE, yr, mo);"],
  ['the panel says frozen or live',
   "${frozen ? 'frozen — settled figures' : 'live — not settled yet'}</span></div>" + NL + '    <div class="metrics">' + NL + '      <div class="metric"><div class="v">${nf(vendors)}</div>',
   "live — not settled yet</span></div>" + NL + '    <div class="metrics">' + NL + '      <div class="metric"><div class="v">${nf(vendors)}</div>'],
  ['the button names the fortnight and offers to re-open',
   "  $('hrFreeze').textContent = per === 3 ? 'Freeze a fortnight' : (frozen ? `Re-open ${PER_LBL[per]}` : `Freeze ${PER_LBL[per]}`);" + NL + "  $('hrFreeze').disabled = per === 3 || !ME.admin;" + NL + "  $('hrFreeze').title = per === 3 ? 'The two halves",
   "  $('hrFreeze').textContent = 'Freeze';" + NL + "  $('hrFreeze').disabled = per === 3 || !ME.admin;" + NL + "  $('hrFreeze').title = per === 3 ? 'The two halves"],
  ['the freeze button is offered on this view',
   "  $('hrFreeze').classList.toggle('hide', !(payView || view === 'vpay'));",
   "  $('hrFreeze').classList.toggle('hide', !payView);"],
  ['a frozen figure still names its rate',
   "          run, unit: run ? 'm' : 'pcs', what, rate, rateNote: vpayRateNote(row), why,",
   "          run, unit: run ? 'm' : 'pcs', what, rate, why,"],
  ['…and says it is frozen',
   "      + (r.frozen ? ' FROZEN — this is the settled figure, at the rate that applied when it was frozen.' : '')",
   "      + ''"],
  ['a corrected receipt shows what it said before',
   "          was: (Array.isArray(ok.was) ? ok.was : []).map(x => parseFloat(x && x.qty) || 0) });",
   '          was: [] });'],
  ['Refresh reads the vendor orders too',
   "$('hrGo').onclick = async () => { HR.emp = null; if (!hrEmpOnly()) { VO.rows = null; VO.err = ''; } await ensureHr(); };",
   "$('hrGo').onclick = async () => { HR.emp = null; await ensureHr(); };"],
  ['a failed read of the orders is not an empty month',
   '  if (VO.err) {' + NL + "    $('hrKpis').innerHTML = ''; ptEmpty('hrTable', 'Nothing to show.');",
   '  if (false) {' + NL + "    $('hrKpis').innerHTML = ''; ptEmpty('hrTable', 'Nothing to show.');"],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
