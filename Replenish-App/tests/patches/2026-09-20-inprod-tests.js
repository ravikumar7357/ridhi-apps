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

one('recipeUploadPlan, recipeUploadRun, mdbFields, fabListOr,',
  'recipeUploadPlan, recipeUploadRun, mdbFields, fabListOr, pdIso, ordDueIndex, ordProdRows, SOX:()=>SOX, setSOX_:v=>{SOX=v},', 'exports');

one(`  const list = A.cutFabrics();`,
`  /* ================= WHAT IS BEING MADE, READ OFF THE ORDER CONSOLE =================
   *
   * The In Production column used to be a workbook uploaded by hand; the live one was 22 days old
   * and every one of its dates was being thrown away. The whole replenishment plan rests on this
   * figure: too low and somebody starts a second run of goods already on a machine. */
  {
    /* ---- THE DATE READER. "29-09-2026" is a date. new Date('29-09-2026T00:00:00') is not, and that
     * one line marked 234,847 live units "no date" while every row had one. ---- */
    ok('a date written the Indian way is read', A.pdIso('29-09-2026') === '2026-09-29', A.pdIso('29-09-2026'));
    ok('…with slashes too', A.pdIso('9/3/2026') === '2026-03-09', A.pdIso('9/3/2026'));
    ok('…and a single-digit day and month are padded', A.pdIso('5-7-2026') === '2026-07-05', A.pdIso('5-7-2026'));
    ok('an ISO date is left as it is', A.pdIso('2026-09-29') === '2026-09-29', A.pdIso('2026-09-29'));
    ok('…even with a time on the end', A.pdIso('2026-09-29T11:00:00Z') === '2026-09-29', A.pdIso('2026-09-29T11:00:00Z'));
    ok('a blank is a blank, not today', A.pdIso('') === '' && A.pdIso(null) === '' && A.pdIso(undefined) === '');
    ok('and something that is not a date at all is refused', A.pdIso('soon') === '' && A.pdIso('29-09') === '',
       JSON.stringify([A.pdIso('soon'), A.pdIso('29-09')]));

    const wasOb = A.PTG().ob, wasPress = A.PTG().press, wasSP2 = A.PTG().shopProd, wasSox = A.SOX();
    const wasBase2 = A.PT().base, wasCut2 = A.PT().cut, wasMdb = A.PTG().mdb;
    A.setPTG(Object.assign({}, A.PTG(), { mdb: [{ sku: 'IP-A', articleType: 'Quilt', subtype: 'Queen Quilt',
      size: '90X96', color: 'Blue', packOf: 1, cuttingRequired: true }] }));
    A.setPT(Object.assign({}, A.PT(), { base: [], cut: [] }));
    A.setPTG(Object.assign({}, A.PTG(), { press: [], shopProd: {},
      ob: [{ orderNo: 'AMZ-9001', sku: 'IP-A', qty: 100, orderDate: '2026-09-01', src: 'SO' }] }));
    A.setSOX_(Object.assign({}, A.SOX(), { rows: [{ _id: 'AMZ-9001', deliveryDate: '',
      lines: [{ sku: 'IP-A', qty: 100, deliveryDate: '2026-10-15' }] }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });

    /* ---- THE PROMISE COMES OFF THE SALES ORDER ---- */
    ok('the delivery date the order promised is found', A.ordDueIndex().get('AMZ-9001|IP-A') === '2026-10-15',
       String(A.ordDueIndex().get('AMZ-9001|IP-A')));

    let rows = A.ordProdRows();
    ok('an open line is being made', rows.length === 1 && rows[0].sku === 'IP-A', JSON.stringify(rows));
    ok('…for every piece nobody has pressed', rows[0].qty === 100, String(rows[0].qty));
    ok('…ready when the order said', rows[0].ready === '2026-10-15', rows[0].ready);
    ok('…against the order it is on', rows[0].supplier === 'AMZ-9001' && rows[0].orderNo === 'AMZ-9001', rows[0].supplier);
    ok('…and it says which stage it is at', rows[0].stage === 'to cut', rows[0].stage);

    /* ---- PRESSED PIECES ARE NOT IN PRODUCTION. They are finished; counting them would tell the
     * plan that goods already made are still to come. ---- */
    A.setPTG(Object.assign({}, A.PTG(), { press: [{ id: 'ip1', orderNo: 'AMZ-9001', sku: 'IP-A', pieces: 40 }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    rows = A.ordProdRows();
    ok('what has been through the press stops counting as in production', rows[0].qty === 60, String(rows[0].qty));
    /* ---- AND A FINISHED LINE DROPS OUT ALTOGETHER ---- */
    A.setPTG(Object.assign({}, A.PTG(), { press: [{ id: 'ip1', orderNo: 'AMZ-9001', sku: 'IP-A', pieces: 100 }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    ok('a line that is fully pressed is not being made at all', A.ordProdRows().length === 0,
       JSON.stringify(A.ordProdRows()));
    /* …and over-pressing cannot turn it negative. */
    A.setPTG(Object.assign({}, A.PTG(), { press: [{ id: 'ip1', orderNo: 'AMZ-9001', sku: 'IP-A', pieces: 140 }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    ok('…and more pressed than ordered never makes a negative figure', A.ordProdRows().length === 0,
       JSON.stringify(A.ordProdRows()));

    /* ---- AN ORDER THAT PROMISED NOTHING IS SHOWN AS UNDATED, NOT GUESSED HERE ---- */
    A.setPTG(Object.assign({}, A.PTG(), { press: [] }));
    A.setSOX_(Object.assign({}, A.SOX(), { rows: [{ _id: 'AMZ-9001', deliveryDate: '',
      lines: [{ sku: 'IP-A', qty: 100, deliveryDate: '' }] }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    ok('a line whose order promised no date carries no date', A.ordProdRows()[0].ready === '',
       JSON.stringify(A.ordProdRows()[0]));
    /* …and the order's own date stands in for a line that has none. */
    A.setSOX_(Object.assign({}, A.SOX(), { rows: [{ _id: 'AMZ-9001', deliveryDate: '30-11-2026',
      lines: [{ sku: 'IP-A', qty: 100, deliveryDate: '' }] }] }));
    ok('…unless the order itself named one', A.ordDueIndex().get('AMZ-9001|IP-A') === '2026-11-30',
       String(A.ordDueIndex().get('AMZ-9001|IP-A')));
    /* …and the EARLIEST promise wins when an order names two for the same SKU. */
    A.setSOX_(Object.assign({}, A.SOX(), { rows: [{ _id: 'AMZ-9001', deliveryDate: '',
      lines: [{ sku: 'IP-A', qty: 60, deliveryDate: '2026-10-15' }, { sku: 'IP-A', qty: 40, deliveryDate: '2026-09-25' }] }] }));
    ok('…and the earliest of two promises is the one that counts',
       A.ordDueIndex().get('AMZ-9001|IP-A') === '2026-09-25', String(A.ordDueIndex().get('AMZ-9001|IP-A')));

    /* ---- A SHOPIFY LINE THE SHIPPING TEAM HAS TAKEN IS NOT IN PRODUCTION ---- */
    A.setPTG(Object.assign({}, A.PTG(), {
      ob: [{ orderNo: 'SHP-9001', sku: 'IP-A', qty: 4, pcs: 4, orderDate: '2026-09-02', src: 'SHP' }],
      shopProd: { 'SHP-9001__IP-A': { orderNo: 'SHP-9001', sku: 'IP-A', handedAt: '2026-09-12T05:00:00Z' } } }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    ok('a Shopify line already handed to shipping is not being made', A.ordProdRows().length === 0,
       JSON.stringify(A.ordProdRows()));
    A.setPTG(Object.assign({}, A.PTG(), { shopProd: {} }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    ok('…but one nobody has taken still is', A.ordProdRows().length === 1 && A.ordProdRows()[0].qty === 4,
       JSON.stringify(A.ordProdRows()));

    A.setPTG(Object.assign({}, A.PTG(), { ob: wasOb, press: wasPress, shopProd: wasSP2, mdb: wasMdb }));
    A.setPT(Object.assign({}, A.PT(), { base: wasBase2, cut: wasCut2 }));
    A.setSOX_(wasSox);
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
  }

  const list = A.cutFabrics();`, 'the In Production tests');

fs.writeFileSync(T, t);
console.log('written');
