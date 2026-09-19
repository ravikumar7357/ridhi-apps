/* WHEN EVERY COLOUR BAND CHARGES THE SAME, THE COLOUR COUNT DOES NOT MATTER.
 *
 * A R Textile's rate card has two bands for every size — "1-4" and "5+" — and the same price in both,
 * sixteen times out of sixteen. None of the 2,647 tablecloth SKUs in the master carries a colour
 * count. So the app refused to price 516 received pieces for want of a number that could not have
 * changed the answer. Where the bands DISAGREE the refusal stands, and now says what they disagree by.
 *
 * Patches the app and ../prod-test.js by exact anchor.
 */
const fs = require('fs'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

one(`  const hits = (HR.prate || [])
    .filter(r => prApproved(r) && prLineMatches(r, o, l, vendorCode))
    /* A labelled rate is recorded, not matched: nothing on an order line says "Gadd", so picking one
     * here would be guessing with somebody's money. */
    .filter(r => !prColIsLabel(r))
    .filter(r => (cols ? prColCovers(r, cols) : !prColSpec(r.colours)))
    .sort((a, b) => prColWidth(a) - prColWidth(b));`,
`  const cand = (HR.prate || [])
    .filter(r => prApproved(r) && prLineMatches(r, o, l, vendorCode))
    /* A labelled rate is recorded, not matched: nothing on an order line says "Gadd", so picking one
     * here would be guessing with somebody's money. */
    .filter(r => !prColIsLabel(r));
  let hits = cand.filter(r => (cols ? prColCovers(r, cols) : !prColSpec(r.colours)))
    .sort((a, b) => prColWidth(a) - prColWidth(b));
  /* NO COLOUR COUNT, BUT EVERY BAND SAYS THE SAME PRICE — then there is nothing to choose, and the
   * missing number cannot change the answer. One printer's whole card is written that way, and not
   * one tablecloth in the master carries a count. Where the bands DISAGREE this does not apply: that
   * is a real choice, and it is refused below for want of the number that would make it. */
  if (!hits.length && !cols && cand.length
      && new Set(cand.map(r => String(parseFloat(r.rate) || 0))).size === 1
      && new Set(cand.map(r => prNameKey(r.filler))).size === 1)
    hits = [Object.assign({}, cand[0], { colours: '', anyBand: true })];`, 'same-price bands need no count');

one(`  if (n > 0) return 'the design has ' + n + ' colours and no approved rate covers that count';
  return 'no approved rate covers a design with no colour count written';`,
`  if (n > 0) return 'the design has ' + n + ' colours and no approved rate covers that count';
  const prices = [...new Set(ok.filter(r => !prColIsLabel(r)).map(r => 'Rs.' + (parseFloat(r.rate) || 0)))];
  if (prices.length > 1) return 'the colour bands charge different prices (' + prices.join(', ')
    + ') and this design has no colour count written — put one on the SKU in the master database';
  return 'no approved rate covers a design with no colour count written';`, 'the reason names the prices');

one(`const vpayRateNote = rw => (rw ? (rw.service || 'Block print')
  + (prCols(rw) ? ', ' + prCols(rw) + ' colours' : '')`,
`const vpayRateNote = rw => (rw ? (rw.service || 'Block print')
  + (rw.anyBand ? ', every colour band charges this' : '')
  + (prCols(rw) ? ', ' + prCols(rw) + ' colours' : '')`, 'the payout says why no count was needed');

fs.writeFileSync(P, s.split(LF).join(CR + LF));

let t = fs.readFileSync(T, 'utf8');
const two = (a, b, n) => {
  const crlf = x => x.split(LF).join(CR + LF);
  let A = crlf(a), B = crlf(b);
  if (t.split(A).length !== 2) { A = a; B = b; }
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};
two(`  /* ---- A-2: TWO FILLERS, AND THE ORDER SAYS WHICH ----`,
`  /* ---- WHEN EVERY COLOUR BAND CHARGES THE SAME, THE COUNT DOES NOT MATTER ----
   *
   * One printer's whole card is "1-4" and "5+" at the same price, sixteen sizes out of sixteen, and
   * not one of 2,647 tablecloth SKUs carries a colour count: 516 received pieces went unpriced for
   * want of a number that could not have changed the answer. */
  {
    const band = (colours, r) => A.prRec({ vendor: 'VND002', service: 'Block print', kind: 'cut',
      at: 'Tablecloth', sub: 'Square Tablecloth', size: '60X60', colours, rate: r });
    const o = { vendorCode: 'VND002', id: 'pb', orderNo: 'VPO-B', orderType: 'cut', status: 'Placed',
      lines: [{ kind: 'cut', sku: 'RTC-6060', qty: 20, deliveries: [del(10, '05/09/2026', { qty: 10 })] }] };   // no colour count anywhere
    A.setHR(Object.assign(A.HR(), { prate: [band('1-4', '125'), band('5+', '125')] }));
    ok('two bands at one price need no colour count', A.prRateFor('VND002', o, o.lines[0]) === 125,
       String(A.prRateFor('VND002', o, o.lines[0])));
    A.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: [o] });
    const row = A.vpayRows(2026, 9, 1)[0] || {};
    ok('…and the payout says that is why none was needed', /every colour band charges this/.test(row.rateNote || ''), row.rateNote);
    ok('…without claiming it was a 1-4 colour job', !/1-4/.test(row.rateNote || ''), row.rateNote);

    /* BUT BANDS THAT DISAGREE ARE A REAL CHOICE, and with no count there is nothing to make it with. */
    A.setHR(Object.assign(A.HR(), { prate: [band('1-4', '125'), band('5+', '180')] }));
    ok('two bands at two prices, and no count, is still no rate', A.prRateFor('VND002', o, o.lines[0]) === null);
    ok('…and the reason names both prices and where to put the count',
       /Rs\\.125/.test(A.prRateWhy('VND002', o, o.lines[0])) && /Rs\\.180/.test(A.prRateWhy('VND002', o, o.lines[0]))
       && /master database/.test(A.prRateWhy('VND002', o, o.lines[0])), A.prRateWhy('VND002', o, o.lines[0]));
    /* And a design that DOES say its count still gets its own band, same price or not. */
    const five = Object.assign({}, o, { lines: [Object.assign({}, o.lines[0], { colours: 6 })] });
    ok('…while a design that says six colours takes the 5+ band', A.prRateFor('VND002', five, five.lines[0]) === 180);
    /* A label is still not a band: "Gadd" at the same price does not make a labelled rate match. */
    A.setHR(Object.assign(A.HR(), { prate: [band('Gadd', '125')] }));
    ok('…and a labelled rate is still not reached this way', A.prRateFor('VND002', o, o.lines[0]) === null);
  }

  /* ---- A-2: TWO FILLERS, AND THE ORDER SAYS WHICH ----`, 'the tests');
fs.writeFileSync(T, t);
console.log('written');
