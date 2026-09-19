/* Tests for the vendor payout's freeze, its refresh and the correction trail. Run once; it patches
 * ../prod-test.js by exact anchor and refuses to run twice. */
const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const one = (a, b, n) => {
  const crlf = x => x.split(LF).join(CR + LF);
  let A = crlf(a), B = crlf(b);
  if (t.split(A).length !== 2) { A = a; B = b; }
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};

one('prRateWhy, prLineFiller, PR_COL_ANY, voIsFilling,',
  'prRateWhy, prLineFiller, PR_COL_ANY, voIsFilling, vpayLive, vpaySetFreeze, VPAY_TYPE, payFreezeKey,', 'exports');

/* The two tests that said "there is no freeze" — true then, and the reason is kept. */
one(`    ok('…and so does the line under the table',
       /nothing here is settled/i.test(els.hrMsg.textContent), els.hrMsg.textContent);`,
`    ok('…and so does the line under the table',
       /not frozen, so a rate change will still move/i.test(els.hrMsg.textContent), els.hrMsg.textContent);`, 'the live wording');

one(`    /* AND NO FREEZE, because there is nothing on this screen that means settled and a button saying
     * otherwise would be a lie about the state of the money. */
    ok('…and no Freeze button, because nothing here can be settled yet',
       els.hrFreeze.classList.contains('hide'));`,
`    /* THE FREEZE IS OFFERED NOW. It was held back while there was nothing behind it — a button that
     * locked nothing would have said there was — and it names the fortnight it would lock. */
    ok('…and a Freeze button that names the fortnight',
       !els.hrFreeze.classList.contains('hide') && /Freeze 1st/.test(els.hrFreeze.textContent), els.hrFreeze.textContent);
    els.hrPeriod.value = '3'; A.renderHr();
    ok('…which is switched off on the whole month, because the halves are settled apart', els.hrFreeze.disabled === true);
    els.hrPeriod.value = '1'; A.renderHr();`, 'the freeze button');

one(`  /* Searching narrows it, the way every other view here does. */`,
`  /* ================= FREEZING A FORTNIGHT =================
   *
   * Until this, every figure was today's data at today's rate: change a rate and last month moved. */
  {
    const wasFreezes = A.HR().freezes, wasConfirm = CONFIRM; CONFIRM = true; NET.on = true;
    const freezeKey = A.payFreezeKey(A.VPAY_TYPE, 2026, 9);
    els.hrView.value = 'vpay'; els.hrMonth.value = '2026-09'; els.hrPeriod.value = '1'; els.hrQ.value = '';
    A.setHR(Object.assign(A.HR(), { freezes: {} }));

    /* WORK WITH NO RATE CANNOT BE FROZEN. It would be settled at nothing, where no later rate could
     * reach it. The fixture has one such line on purpose. */
    let at = NET.calls.length;
    await A.vpaySetFreeze(true);
    ok('a fortnight holding unpriced work refuses to freeze',
       /NO approved rate/.test(els.hrMsg.textContent) && /Rectangular/.test(els.hrMsg.textContent), els.hrMsg.textContent);
    ok('…and nothing is written', !NET.calls.slice(at).some(c => c.method === 'PUT'));

    /* Price it, and it freezes. */
    A.setHR(Object.assign(A.HR(), { prate: A.HR().prate.concat([
      rate({ vendor: 'VND002', at: 'Tablecloth', sub: 'Rectangular Tablecloth', size: '70X108', rate: '50' })]) }));
    const liveBefore = A.vpayRows(2026, 9, 1), sumBefore = liveBefore.reduce((x, r) => x + r.amount, 0);
    ME.admin = false;
    await A.vpaySetFreeze(true);
    ok('only an admin freezes', /Only an admin/.test(els.hrMsg.textContent), els.hrMsg.textContent);
    ME.admin = true;
    at = NET.calls.length;
    await A.vpaySetFreeze(true);
    const put = NET.calls.slice(at).find(c => c.method === 'PUT' && /pt_payoutFreezes/.test(c.url));
    ok('freezing writes the fortnight under the vendor type', !!put && /Vendor/.test(decodeURIComponent(put.url)), put && put.url);
    ok('…with every row, its rate, and the deliveries behind it',
       !!put && put.body.periods[1].length === liveBefore.length && put.body.periods[1].every(r => r.rate != null && (r.dels || []).length),
       JSON.stringify(put && put.body.periods[1].map(r => [r.rate, (r.dels || []).length])));
    ok('…and who froze it, and when', !!put && put.body.meta[1].by === ME.email && !!put.body.meta[1].at);
    ok('the panel now says the figures are settled', /frozen — settled/.test(els.hrKpis.innerHTML), els.hrKpis.innerHTML.slice(0, 300));
    ok('…and the button offers to re-open', /Re-open/.test(els.hrFreeze.textContent), els.hrFreeze.textContent);

    /* THE POINT OF IT: a rate change no longer reaches this fortnight. */
    A.setHR(Object.assign(A.HR(), { prate: A.HR().prate.map(r => Object.assign({}, r, { rate: 999 })) }));
    const after = A.vpayRows(2026, 9, 1);
    ok('a rate changed afterwards does not move a frozen fortnight',
       after.reduce((x, r) => x + r.amount, 0) === sumBefore, after.reduce((x, r) => x + r.amount, 0) + ' vs ' + sumBefore);
    ok('…while the live calculation beside it has moved', A.vpayLive(2026, 9, 1).reduce((x, r) => x + r.amount, 0) !== sumBefore);
    /* A frozen row can still say which rate it was paid at — the words were frozen with it. */
    A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
    try { A.vpayShowDrill(after[0].key); } catch (e) { /* the empty dialog fails the next line */ }
    ok('a frozen figure still names its rate, and says it is frozen',
       /FROZEN/.test((A.PTD_() || {}).note || '') && /Block print/.test((A.PTD_() || {}).note || ''), String((A.PTD_() || {}).note));

    /* THE MONTH IS THE TWO HALVES, EACH AS IT STANDS — amounts added, never re-multiplied. */
    const second = { vendorCode: 'VND002', id: 'p6', orderNo: 'VPO-P6', orderType: 'cut', status: 'Placed',
      lines: [{ kind: 'cut', sku: 'RTC-6060', qty: 100, deliveries: [del(10, '20/09/2026', { qty: 10 })] }] };
    A.setVO(Object.assign(A.VO(), { rows: A.VO().rows.concat([second]) }));
    const month = A.vpayRows(2026, 9, 3), sq = month.find(r => /Square/.test(r.what));
    ok('the month adds the frozen half to the live one',
       !!sq && sq.qty === 20 && sq.amount === 220 + 10 * 999, JSON.stringify(sq && [sq.qty, sq.amount]));

    /* Re-opening puts it back to live. */
    await A.vpaySetFreeze(false);
    ok('re-opening makes the fortnight live again',
       A.vpayRows(2026, 9, 1).reduce((x, r) => x + r.amount, 0) !== sumBefore && !/frozen — settled/.test(els.hrKpis.innerHTML));
    A.setVO(Object.assign(A.VO(), { rows: A.VO().rows.filter(o => o.id !== 'p6') }));
    A.setHR(Object.assign(A.HR(), { freezes: wasFreezes, prate: [
      rate({ vendor: 'VND002', at: 'Tablecloth', sub: 'Square Tablecloth', size: '60X60', rate: '22' })] }));
    CONFIRM = wasConfirm; NET.on = false;
  }

  /* ---- A CORRECTED RECEIPT SHOWS WHAT IT SAID BEFORE ---- */
  {
    const keepRows = A.VO().rows;
    A.setVO(Object.assign(A.VO(), { rows: [{ vendorCode: 'VND002', id: 'p7', orderNo: 'VPO-P7', orderType: 'cut', status: 'Placed',
      lines: [{ kind: 'cut', sku: 'RTC-6060', qty: 100,
        deliveries: [del(12, '05/09/2026', { qty: 8, was: [{ qty: 12, by: 'a@x', at: '2026-09-05T00:00:00Z' }] })] }] }] }));
    const r = A.vpayRows(2026, 9, 1)[0];
    A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
    try { if (r) A.vpayShowDrill(r.key); } catch (e) { /* fails below */ }
    ok('a receipt corrected from 12 to 8 says so where the 8 is shown',
       /was 12/.test((A.PTD_() || {}).html || ''), String((A.PTD_() || {}).html).slice(0, 500));
    A.setVO(Object.assign(A.VO(), { rows: keepRows }));
  }

  /* ---- REFRESH READS THE VENDOR ORDERS TOO ---- */
  {
    const keepVO = A.VO(), keepStore = NET.store; NET.on = true;
    NET.store = { pt_vendorOrders: { VND002: { p8: { orderNo: 'VPO-P8', orderType: 'cut', status: 'Placed',
      lines: [{ kind: 'cut', sku: 'RTC-6060', qty: 5, deliveries: [del(5, '06/09/2026', { qty: 5 })] }] } } } };
    await els.hrGo.onclick();
    ok('Refresh brings in a delivery accepted since the page was opened',
       (A.VO().rows || []).some(o => o.id === 'p8'), JSON.stringify((A.VO().rows || []).map(o => o.id)));
    /* AND A FAILED READ IS NOT AN EMPTY MONTH. */
    A.setVO(Object.assign(A.VO(), { rows: [], err: 'the line went down' }));
    els.hrView.value = 'vpay'; A.renderHr();
    ok('a failed read of the orders says so, instead of showing nothing owed',
       /could not be read/.test(els.hrMsg.textContent) && /line went down/.test(els.hrMsg.textContent), els.hrMsg.textContent);
    NET.store = keepStore; NET.on = false; A.setVO(keepVO);
  }

  /* Searching narrows it, the way every other view here does. */`, 'freeze, trail and refresh tests');

fs.writeFileSync(T, t);
console.log('written');
