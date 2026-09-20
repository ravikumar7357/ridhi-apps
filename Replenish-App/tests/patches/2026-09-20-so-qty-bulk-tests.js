const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const one = (a, b, n) => {
  const A = a.split(LF).join(NL), B = b.split(LF).join(NL);
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};

one('soQtyPlan, soQtyRun, soDoneOn,', 'soQtyPlan, soQtyRun, soDoneOn, soQtySheetRead, soQtyBulkPlan, soQtyBulkRun, soQtyTemplate, SO_QTY_COLS,', 'exports');

one(`  ME.admin = wasME2.admin; ME.soApprove = wasME2.soApprove;
  A.setSOX(wasSOX); A.setPTG(wasPTG2); A.setPT(wasPT2);`,
`  /* ================= AND THE SAME THING A SHEET AT A TIME =================
   *
   * One SKU at a time is right for one change and useless for fifty. The sheet must not be able to do
   * anything the button cannot — it goes through the same soQtyPlan — and a bad row must stop itself
   * rather than the file. */
  {
    A.setSOX(Object.assign({}, A.SOX(), { rows: [order()], shown: [] }));
    A.setPTG(Object.assign({}, A.PTG(), { ob: book() }));
    A.setPT(Object.assign({}, A.PT(), { base: [], cut: [], mdb: A.PTG().mdb }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    const sheet = rows => A.soQtySheetRead([A.SO_QTY_COLS].concat(rows));

    ok('the sheet is read by column name, not by position',
       (r => r.entries && r.entries.length === 1 && r.entries[0].sku === 'QTY-A' && r.entries[0].qty === '150')(
         A.soQtySheetRead([['SKU', 'Order', 'Why', 'New qty'], ['QTY-A', 'AMZ-Q1', 'more', '150']])),
       JSON.stringify(A.soQtySheetRead([['SKU', 'Order', 'Why', 'New qty'], ['QTY-A', 'AMZ-Q1', 'more', '150']])));
    ok('a file without the columns it needs is refused',
       /needs Order, SKU/.test(A.soQtySheetRead([['a', 'b'], ['1', '2']]).err),
       A.soQtySheetRead([['a', 'b'], ['1', '2']]).err);
    /* AN EMPTY New qty MEANS "LEAVE THIS ONE ALONE" — most of a 2,800-row sheet comes back untouched,
     * and reading it as zero would close every order nobody meant to touch. */
    ok('a row with no new quantity is left alone, not read as zero',
       sheet([['AMZ-Q1', 'QTY-A', '', '', '', '', '', '', '', '', '']]).entries.length === 0,
       JSON.stringify(sheet([['AMZ-Q1', 'QTY-A', '', '', '', '', '', '', '', '', '']]).entries));

    const row = (o2, sku, qty, why) => [o2, sku, '', '', '', '', '', '', '', qty, why];
    let bp = A.soQtyBulkPlan(sheet([row('AMZ-Q1', 'QTY-A', '150', 'buyer added'),
      row('AMZ-Q1', 'QTY-B', '10', 'buyer cut')]).entries);
    ok('a sheet plans every row it can', bp.ok.length === 2 && !bp.skip.length,
       JSON.stringify({ ok: bp.ok.length, skip: bp.skip }));
    ok('…knowing which way each one goes',
       bp.ok[0].delta === 50 && bp.ok[1].delta === -30, JSON.stringify(bp.ok.map(x => x.delta)));
    let out = await A.soQtyBulkRun(bp);
    ok('…and writes them', out.err === '' && out.done === 2, out.err || String(out.done));
    ok('…on the sales order', A.soQtyOf(ord(), 'QTY-A') === 150 && A.soQtyOf(ord(), 'QTY-B') === 10,
       JSON.stringify([A.soQtyOf(ord(), 'QTY-A'), A.soQtyOf(ord(), 'QTY-B')]));
    ok('…and in the order book, which is what the floor works to',
       (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty === 150
       && (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-B') || {}).qty === 10,
       JSON.stringify(A.PTG().ob.map(r => r.id + ':' + r.qty)));
    ok('…with a reason on each one', Object.values(ord().qtyAdjustments || {}).length === 2
       && Object.values(ord().qtyAdjustments).every(a => a.why && a.by), JSON.stringify(ord().qtyAdjustments));
    ok('…marked as having come from a sheet',
       Object.values(ord().qtyAdjustments).every(a => a.via === 'sheet'), JSON.stringify(ord().qtyAdjustments));

    /* ---- A BAD ROW STOPS ITSELF, NOT THE FILE ---- */
    reset();
    A.setPT(Object.assign({}, A.PT(), { cut: [{ id: 'c9', orderNo: 'AMZ-Q1', sku: 'QTY-A', pieces: 80 }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    bp = A.soQtyBulkPlan(sheet([
      row('AMZ-Q1', 'QTY-A', '20', 'too low'),
      row('AMZ-Q1', 'QTY-B', '55', 'fine'),
      row('NOPE-1', 'QTY-A', '10', 'no such order'),
      row('AMZ-Q1', 'NOT-A-SKU', '10', 'not on it'),
      row('AMZ-Q1', 'QTY-B', '60', 'twice'),
      row('AMZ-Q1', 'QTY-A', '90', ''),
    ]).entries);
    ok('the good row is planned and the bad ones are not',
       bp.ok.length === 1 && bp.ok[0].sku === 'QTY-B' && bp.skip.length === 5,
       JSON.stringify({ ok: bp.ok.map(x => x.sku), skip: bp.skip.map(x => x.row + ':' + x.why) }));
    ok('…and each refusal says why, by row number',
       /cannot go below 80/.test((bp.skip.find(x => x.row === 2) || {}).why || '')
       && /no order called NOPE-1/.test((bp.skip.find(x => x.row === 4) || {}).why || '')
       && /not on this order/.test((bp.skip.find(x => x.row === 5) || {}).why || ''),
       JSON.stringify(bp.skip));
    /* THE SAME LINE TWICE IS TWO DIFFERENT ANSWERS, not a later one. */
    ok('…and the same order and SKU twice is refused rather than resolved',
       /row 3 as well/.test((bp.skip.find(x => x.row === 6) || {}).why || ''), JSON.stringify(bp.skip));
    ok('…and a change with no reason is refused here too',
       /Why column is empty/.test((bp.skip.find(x => x.row === 7) || {}).why || ''), JSON.stringify(bp.skip));
    out = await A.soQtyBulkRun(bp);
    ok('writing the sheet writes only the good row',
       out.err === '' && out.done === 1 && A.soQtyOf(ord(), 'QTY-B') === 55, out.err || String(A.soQtyOf(ord(), 'QTY-B')));
    ok('…and the refused one is exactly as it was',
       A.soQtyOf(ord(), 'QTY-A') === 100 && (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty === 100,
       String(A.soQtyOf(ord(), 'QTY-A')));

    /* ---- AND IT NEEDS THE RIGHT ---- */
    reset();
    bp = A.soQtyBulkPlan(sheet([row('AMZ-Q1', 'QTY-A', '150', 'x')]).entries);
    ME.admin = false; ME.soApprove = false;
    out = await A.soQtyBulkRun(bp);
    ok('a sheet from somebody who cannot approve an order writes nothing',
       out.err === A.SO_NO_APPROVE_() && A.soQtyOf(ord(), 'QTY-A') === 100, out.err);
    ME.admin = true; ME.soApprove = true;

    /* ---- THE TEMPLATE ---- */
    A.setSOX(Object.assign({}, A.SOX(), { shown: [{ o: ord(), s: null }] }));
    NET.calls.length = 0;
    A.soQtyTemplate();
    ok('the sheet it hands you has the columns it reads back',
       A.SO_QTY_COLS.indexOf('New qty') > 0 && A.SO_QTY_COLS.indexOf('Why') > 0
       && A.SO_QTY_COLS.indexOf('Cannot go below') > 0, A.SO_QTY_COLS.join(' | '));
    ok('…and says what it wrote', /New qty/.test(els.sxMsg.textContent), els.sxMsg.textContent);
    A.setSOX(Object.assign({}, A.SOX(), { shown: [] }));
    A.soQtyTemplate();
    ok('…and refuses to hand you an empty one', /Nothing approved/.test(els.sxMsg.textContent), els.sxMsg.textContent);
  }

  ME.admin = wasME2.admin; ME.soApprove = wasME2.soApprove;
  A.setSOX(wasSOX); A.setPTG(wasPTG2); A.setPT(wasPT2);`, 'the bulk tests');

fs.writeFileSync(T, t);
console.log('written');
