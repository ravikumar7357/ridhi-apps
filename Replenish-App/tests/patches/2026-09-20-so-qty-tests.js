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

one('soLines, soStatus, soWork,', 'soLines, soStatus, soWork, soQtyPlan, soQtyRun, soDoneOn, soQtyOf, soLinesOf, soBookId, soQtyOpen,', 'exports');

one(`console.log('\\n== nothing leaves a shelf that has nothing on it ==');`,
`/* ================= MOVING A QUANTITY ON AN ORDER THAT IS ALREADY OUT =================
 *
 * Editing an approved order and approving it again changes nothing in the order book — soApproveRun
 * skips a SKU the book already has, which is what stops a second approval duplicating every
 * production row. So the sales order would say 120 and the floor would go on making 100. */
console.log('\\n== a quantity changed after approval reaches the floor, or it is refused ==');
{
  const wasME2 = { admin: ME.admin, soApprove: ME.soApprove };
  const wasSOX = A.SOX(), wasPTG2 = A.PTG(), wasPT2 = A.PT();
  const wasNet2 = NET.on; NET.on = true; NET.store = {}; NET.calls.length = 0;
  ME.admin = true; ME.soApprove = true;

  const order = () => ({ _id: 'AMZ-Q1', _key: 'AMZ-Q1', channel: 'AMZ', status: 'approved',
    orderDate: '2026-09-01', buyerName: 'Ravi', deliveryMode: 'partial', lines: [
      { sku: 'QTY-A', qty: 100, deliveryDate: '2026-09-20', orderTypeKey: 'regular' },
      { sku: 'QTY-B', qty: 40, deliveryDate: '2026-09-20', orderTypeKey: 'regular' },
    ] });
  const book = () => [
    { id: 'ob_so_AMZ-Q1_QTY-A', orderNo: 'AMZ-Q1', sku: 'QTY-A', qty: 100, src: 'SO', orderDate: '2026-09-01' },
    { id: 'ob_so_AMZ-Q1_QTY-B', orderNo: 'AMZ-Q1', sku: 'QTY-B', qty: 40, src: 'SO', orderDate: '2026-09-01' },
  ];
  const reset = (extra) => {
    A.setSOX(Object.assign({}, A.SOX(), { rows: [order()], err: '', busy: false, at: '', shown: [] }));
    A.setPTG(Object.assign({}, A.PTG(), { ob: book(),
      mdb: [{ sku: 'QTY-A', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60X60', packOf: 1 },
        { sku: 'QTY-B', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '72X72', packOf: 1 }],
      press: (extra && extra.press) || [] }));
    A.setPT(Object.assign({}, A.PT(), { base: (extra && extra.base) || [], cut: (extra && extra.cut) || [] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
  };
  const ord = () => (A.SOX().rows || [])[0];
  reset();

  ok('the order says what it says to start with', A.soQtyOf(ord(), 'QTY-A') === 100, String(A.soQtyOf(ord(), 'QTY-A')));
  ok('…and the order book says the same', A.soBookId('AMZ-Q1', 'QTY-A') === 'ob_so_AMZ-Q1_QTY-A', A.soBookId('AMZ-Q1', 'QTY-A'));

  /* ---- GOING UP ---- */
  let err = await A.soQtyRun(ord(), 'QTY-A', 150, 'buyer added 50');
  ok('a quantity can be increased', err === '', err);
  ok('…on the sales order', A.soQtyOf(ord(), 'QTY-A') === 150, String(A.soQtyOf(ord(), 'QTY-A')));
  /* THE WHOLE POINT. The floor works to the order book, not to the sales order. */
  ok('…AND in the order book, which is what the floor works to',
     (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty === 150,
     JSON.stringify(A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A')));
  ok('…and the other SKU on the order is untouched',
     A.soQtyOf(ord(), 'QTY-B') === 40 && (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-B') || {}).qty === 40);
  ok('…and what it used to say is kept on the line',
     A.soLinesOf(ord(), 'QTY-A')[0].l.previousQty === 100, JSON.stringify(A.soLinesOf(ord(), 'QTY-A')[0].l));
  ok('…with who changed it, when, and why',
     (l => l && l.from === 100 && l.to === 150 && l.why === 'buyer added 50' && l.by)(Object.values(ord().qtyAdjustments || {})[0]),
     JSON.stringify(ord().qtyAdjustments));

  /* ---- GOING DOWN ---- */
  reset();
  err = await A.soQtyRun(ord(), 'QTY-A', 60, 'buyer cut it');
  ok('a quantity can be decreased', err === '' && A.soQtyOf(ord(), 'QTY-A') === 60, err || String(A.soQtyOf(ord(), 'QTY-A')));
  ok('…and the order book comes down with it',
     (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty === 60,
     String((A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty));

  /* ---- AND IT CANNOT GO BELOW WHAT HAS BEEN MADE ----
   *
   * 343 live lines are part made and 469 are finished; 48,451 pieces have been cut, made or pressed.
   * Cutting an order below that does not un-make anything — it leaves the registers describing
   * pieces on the floor as pieces nobody ordered. */
  reset({ cut: [{ id: 'c1', orderNo: 'AMZ-Q1', sku: 'QTY-A', pieces: 70 }] });
  ok('what has been done against the line is read off the registers',
     A.soDoneOn('AMZ-Q1', 'QTY-A').cut === 70, JSON.stringify(A.soDoneOn('AMZ-Q1', 'QTY-A')));
  err = await A.soQtyRun(ord(), 'QTY-A', 50, 'buyer cut it');
  ok('it cannot be cut below what has already been cut', /cannot go below 70/.test(err), err);
  ok('…and nothing moved', A.soQtyOf(ord(), 'QTY-A') === 100 && (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty === 100);
  ok('…but it can be closed at exactly what was made',
     (await A.soQtyRun(ord(), 'QTY-A', 70, 'closing at what was cut')) === '' && A.soQtyOf(ord(), 'QTY-A') === 70,
     String(A.soQtyOf(ord(), 'QTY-A')));

  reset({ base: [{ id: 'b1', orderNo: 'AMZ-Q1', sku: 'QTY-A', issuePieces: 90, receivedPieces: 85 }] });
  ok('received pieces hold it up too', /cannot go below 85/.test(await A.soQtyRun(ord(), 'QTY-A', 10, 'x')),
     await A.soQtyRun(ord(), 'QTY-A', 10, 'x'));
  reset({ press: [{ id: 'p1', orderNo: 'AMZ-Q1', sku: 'QTY-A', pieces: 95 }] });
  ok('…and so do pressed ones', /cannot go below 95/.test(await A.soQtyRun(ord(), 'QTY-A', 10, 'x')),
     await A.soQtyRun(ord(), 'QTY-A', 10, 'x'));
  /* THE LARGEST OF THE THREE, NOT THE SUM — they are three views of the same pieces. */
  reset({ cut: [{ id: 'c1', orderNo: 'AMZ-Q1', sku: 'QTY-A', pieces: 70 }],
    base: [{ id: 'b1', orderNo: 'AMZ-Q1', sku: 'QTY-A', issuePieces: 70, receivedPieces: 60 }],
    press: [{ id: 'p1', orderNo: 'AMZ-Q1', sku: 'QTY-A', pieces: 50 }] });
  ok('the floor is the largest of the three, not their sum',
     A.soDoneOn('AMZ-Q1', 'QTY-A').floor === 70, JSON.stringify(A.soDoneOn('AMZ-Q1', 'QTY-A')));

  /* ---- WHAT IS REFUSED ---- */
  reset();
  ok('a change with no reason is refused', /why it is changing/i.test(await A.soQtyRun(ord(), 'QTY-A', 120, '  ')),
     await A.soQtyRun(ord(), 'QTY-A', 120, '  '));
  ok('half a piece is refused', /whole number/.test(await A.soQtyRun(ord(), 'QTY-A', 10.5, 'x')),
     await A.soQtyRun(ord(), 'QTY-A', 10.5, 'x'));
  ok('a negative is refused', /new quantity/i.test(await A.soQtyRun(ord(), 'QTY-A', -5, 'x')),
     await A.soQtyRun(ord(), 'QTY-A', -5, 'x'));
  ok('the same number is refused rather than logged as a change',
     /already says/.test(await A.soQtyRun(ord(), 'QTY-A', 100, 'x')), await A.soQtyRun(ord(), 'QTY-A', 100, 'x'));
  ok('a SKU that is not on the order is refused',
     /not on this order/.test(await A.soQtyRun(ord(), 'NOPE', 5, 'x')), await A.soQtyRun(ord(), 'NOPE', 5, 'x'));
  /* A DRAFT IS EDITED, NOT ADJUSTED. It has nothing in the order book to keep in step. */
  A.setSOX(Object.assign({}, A.SOX(), { rows: [Object.assign(order(), { status: 'draft' })] }));
  ok('a draft is sent back to the ordinary edit',
     /Only an approved order/.test(await A.soQtyRun(ord(), 'QTY-A', 120, 'x')), await A.soQtyRun(ord(), 'QTY-A', 120, 'x'));
  /* AND IT NEEDS THE RIGHT. */
  reset(); ME.admin = false; ME.soApprove = false;
  ok('somebody who cannot approve an order cannot move its quantity either',
     (await A.soQtyRun(ord(), 'QTY-A', 120, 'x')) === A.SO_NO_APPROVE_(), await A.soQtyRun(ord(), 'QTY-A', 120, 'x'));
  ok('…and nothing moved', A.soQtyOf(ord(), 'QTY-A') === 100);
  ME.admin = true; ME.soApprove = true;

  /* ---- ONE SKU ON SEVERAL LINES — 180 of the 2,860 live pairs ---- */
  const twoLines = () => ({ _id: 'AMZ-Q2', _key: 'AMZ-Q2', channel: 'AMZ', status: 'approved',
    orderDate: '2026-09-01', deliveryMode: 'partial', lines: [
      { sku: 'QTY-A', qty: 30, deliveryDate: '2026-09-10', orderTypeKey: 'regular' },
      { sku: 'QTY-A', qty: 20, deliveryDate: '2026-09-25', orderTypeKey: 'regular' },
    ] });
  const two = () => (A.SOX().rows || []).find(x => x._id === 'AMZ-Q2');
  A.setSOX(Object.assign({}, A.SOX(), { rows: [twoLines()] }));
  A.setPTG(Object.assign({}, A.PTG(), { ob: [{ id: 'ob_so_AMZ-Q2_QTY-A', orderNo: 'AMZ-Q2', sku: 'QTY-A', qty: 50, src: 'SO' }] }));
  ok('a SKU on two lines is one quantity to the order book', A.soQtyOf(two(), 'QTY-A') === 50, String(A.soQtyOf(two(), 'QTY-A')));
  await A.soQtyRun(two(), 'QTY-A', 70, 'more');
  ok('extra goes on the latest delivery date',
     A.soLines(two()).map(l => l.qty).join(',') === '30,40', A.soLines(two()).map(l => l.qty + '@' + l.deliveryDate).join(' '));
  await A.soQtyRun(two(), 'QTY-A', 20, 'less');
  ok('…and a cut comes off the latest first, so the earliest date keeps its pieces',
     A.soLines(two()).map(l => l.qty).join(',') === '20,0', A.soLines(two()).map(l => l.qty + '@' + l.deliveryDate).join(' '));
  ok('…and the order book follows the total, not one line',
     (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q2_QTY-A') || {}).qty === 20,
     String((A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q2_QTY-A') || {}).qty));

  /* ---- A SKU THE ORDER BOOK NEVER GOT — 140 of them today ---- */
  A.setSOX(Object.assign({}, A.SOX(), { rows: [order()] }));
  A.setPTG(Object.assign({}, A.PTG(), { ob: [] }));
  ok('a SKU the book never got can still be changed on the order',
     (await A.soQtyRun(ord(), 'QTY-A', 120, 'fix')) === '' && A.soQtyOf(ord(), 'QTY-A') === 120,
     String(A.soQtyOf(ord(), 'QTY-A')));
  ok('…and no order-book row is invented for it',
     !(A.PTG().ob || []).some(r => r && r.id === 'ob_so_AMZ-Q1_QTY-A'), JSON.stringify(A.PTG().ob));

  ME.admin = wasME2.admin; ME.soApprove = wasME2.soApprove;
  A.setSOX(wasSOX); A.setPTG(wasPTG2); A.setPT(wasPT2);
  NET.on = wasNet2; NET.store = {}; NET.calls.length = 0;
}

console.log('\\n== nothing leaves a shelf that has nothing on it ==');`, 'the quantity-change tests');

fs.writeFileSync(T, t);
console.log('written');
