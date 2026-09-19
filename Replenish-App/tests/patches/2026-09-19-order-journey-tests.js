/* Tests for what the vendors hold order by order, and for an order read start to finish. */
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

one('vpayLive, vpaySetFreeze, VPAY_TYPE, payFreezeKey,',
  'vpayLive, vpaySetFreeze, VPAY_TYPE, payFreezeKey, ordVendorAlloc, ordVendorOf, ordWaitingAt, ordJourney, ensureOrd,', 'exports');

one(`console.log('\\n== cutting required, and the override that can flip it ==');`,
`console.log('\\n== Order Console: what the vendors hold, order by order ==');
{
  /* THE PRINTING COLUMN KNEW ONLY A PRINTER PUT ON A LINE FROM THAT SCREEN. 489 live vendor-order lines
   * were invisible to it, so it said "not printed" on cloth that had been at the printer for a week. A
   * vendor line names a SKU and never a sales order — 0 of 489 do — so the link is by SKU, and where
   * several orders want the SKU the printer's pieces are dealt out between them ONCE. */
  const wasPTG = A.PTG(), wasPT = A.PT(), wasVO = A.VO(), wasORD = A.ORD(), wasAdmin = ME.admin;
  ME.admin = true;
  const day = (qty, okq) => Object.assign({ qty, date: '10/09/2026', by: 'p@x', at: '2026-09-10T04:00:00Z' },
    okq == null ? {} : { ok: { qty: okq, by: 'me@x', at: '2026-09-10T05:00:00Z' } });
  const book = extra => A.setPTG(Object.assign(A.PTG(), {
    ob: [{ id: 'a1', orderNo: 'O-1', sku: 'S-A', qty: 30, orderDate: '2026-09-01', articleType: 'Tablecloth', articleSubtype: 'Square Tablecloth', color: 'Blue', size: '60X60' },
         { id: 'a2', orderNo: 'O-2', sku: 'S-A', qty: 30, orderDate: '2026-09-05', articleType: 'Tablecloth', articleSubtype: 'Square Tablecloth', color: 'Blue', size: '60X60' },
         { id: 'b1', orderNo: 'O-3', sku: 'S-B', qty: 10, orderDate: '2026-09-02' },
         { id: 'c1', orderNo: 'O-4', sku: 'S-C', qty: 5, orderDate: '2026-09-03' }],
    press: (extra && extra.press) || [],
    mdb: ['S-A', 'S-B', 'S-C'].map(sku => ({ sku, articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60X60', cuttingRequired: true })),
    masters: Object.assign({}, A.PTG().masters, { vendor: [
      { code: 'VND001', desc: 'RBP-Bagru', category: 'Printer', active: true },
      { code: 'VND002', desc: 'Choudhary Hand Block', category: 'Printer', active: true }] }) }));
  book();
  A.setPT(Object.assign(A.PT(), { base: [], cut: [] }));
  A.setORD({ req: {}, busy: false, at: '', rows: [] });
  const orders = () => [
    { vendorCode: 'VND001', id: 'v1', orderNo: 'VPO-1', orderType: 'cut', orderDate: '02/09/2026', status: 'Placed',
      lines: [{ kind: 'cut', sku: 'S-A', qty: 40, vendorDate: '22/09/2026', deliveries: [day(10, 10)] },
              { kind: 'cut', sku: 'S-A', qty: 500, cancelled: true },                                   // a cancelled line holds nothing
              { kind: 'cut', sku: 'S-A', qty: 50, shopKey: 'O-9|S-A', shopOrderNo: '#9' },             // put on a line from the console: not in the pile
              { kind: 'running', fabricType: 'Voil 92', meters: 900 }] },                              // metres are nobody's pieces
    { vendorCode: 'VND002', id: 'v2', orderNo: 'VPO-2', orderType: 'cut', orderDate: '03/09/2026', status: 'Placed',
      lines: [{ kind: 'cut', sku: 'S-B', qty: 10, deliveries: [day(4)] }] },                          // claimed, not accepted: not back
    { vendorCode: 'VND002', id: 'v3', orderNo: 'VPO-3', orderType: 'cut', orderDate: '01/09/2026', status: 'Cancelled',
      lines: [{ kind: 'cut', sku: 'S-A', qty: 999 }] }];
  A.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: orders() });

  const of = (no, sku) => A.ordVendorOf(no, sku) || { given: 0, back: 0, parts: [], shared: false, none: true };
  ok('an order that alone wants a SKU holds all the vendor has of it', of('O-3', 'S-B').given === 10 && of('O-3', 'S-B').shared === false, JSON.stringify(of('O-3', 'S-B')));
  ok('…and a delivery nobody has accepted is not back yet', of('O-3', 'S-B').back === 0);
  ok('an order no vendor holds anything for says so', !!of('O-4', 'S-C').none);

  /* DEALT OUT ONCE. 40 pieces, two orders of 30: the older takes its 30, the newer the 10 that are left.
   * Judging each against the whole pile would say 30 and 30 — 60 pieces at a printer holding 40. */
  ok('two orders wanting one SKU share the vendor\\'s pieces, oldest first',
     of('O-1', 'S-A').given === 30 && of('O-2', 'S-A').given === 10, of('O-1', 'S-A').given + ' / ' + of('O-2', 'S-A').given);
  ok('…so that what they hold adds up to what the vendor holds, never more',
     of('O-1', 'S-A').given + of('O-2', 'S-A').given === 40);
  ok('…and both are marked as sharing', of('O-1', 'S-A').shared === true && of('O-2', 'S-A').shared === true);
  ok('what came back goes to the order served first', of('O-1', 'S-A').back === 10 && of('O-2', 'S-A').back === 0);
  ok('a cancelled line, a cancelled order, a console-assigned line and metres are not in the pile',
     of('O-1', 'S-A').given + of('O-2', 'S-A').given === 40);
  ok('each share names the vendor order and the date the vendor promised',
     of('O-1', 'S-A').parts[0].vpo === 'VPO-1' && of('O-1', 'S-A').parts[0].due === '22/09/2026', JSON.stringify(of('O-1', 'S-A').parts));

  /* OPEN ORDERS FIRST. The older order is finished; the cloth at the printer is for the one that is not. */
  book({ press: [{ id: 'p1', orderNo: 'O-1', sku: 'S-A', pieces: 30 }] });
  ok('a finished order does not swallow cloth an open one is waiting for',
     of('O-2', 'S-A').given === 30 && of('O-1', 'S-A').given === 10, of('O-2', 'S-A').given + ' / ' + of('O-1', 'S-A').given);
  book();

  /* ---- where a line is waiting ---- */
  const row = (no, sku) => A.ordLines().find(r => r.orderNo === no && r.sku === sku);
  ok('a line whose cloth is still at the printer is waiting on the vendor', /^Vendor/.test(A.ordWaitingAt(row('O-1', 'S-A'))), A.ordWaitingAt(row('O-1', 'S-A')));
  ok('…and one nobody has given out is waiting to be cut', /^Cutting/.test(A.ordWaitingAt(row('O-4', 'S-C'))), A.ordWaitingAt(row('O-4', 'S-C')));
  book({ press: [{ id: 'p1', orderNo: 'O-4', sku: 'S-C', pieces: 5 }] });
  ok('…and a finished one is complete', A.ordWaitingAt(row('O-4', 'S-C')) === 'Complete');
  book();

  /* ---- the screen ---- */
  ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ'].forEach(i => { els[i].value = ''; });
  A.renderOrd();
  const h = els.odTable.innerHTML;
  ok('the Printing cell says what the vendor holds, not "not printed"', /back of 30 given/.test(h) && !/not printed/.test(h), h.slice(0, 900));
  ok('…and who holds it', /RBP-Bagru/.test(h));
  ok('…and how much of the line nobody has given out', /20 not given/.test(h), (h.match(/\\d+ not given/g) || []).join(','));
  ok('…and says so when nothing is with any vendor', /not given to a vendor/.test(h));
  ok('…and that a share is shared', /shared/.test(h));
  ok('every order number opens that order', (h.match(/data-ordj="O-1"/g) || []).length === 1 && /data-ordj="O-4"/.test(h));

  /* ---- one order, start to finish ---- */
  A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
  try { A.ordJourney('O-1'); } catch (e) { /* the empty dialog fails the lines below */ }
  const d = A.PTD_() || {};
  ok('an order opens start to finish', /O-1/.test(d.title || '') && /start to finish/.test(d.title || ''), d.title);
  ok('…with every stage across the top', ['Ordered', 'With vendor', 'Back from vendor', 'Cut', 'Issued', 'Received', 'QC passed', 'Pressed', 'In store']
     .every(x => (d.html || '').indexOf(x) >= 0), String(d.html).slice(0, 300));
  ok('…and the vendor order behind each line, with its promise', /VPO-1/.test(d.html || '') && /promised 22\\/09\\/2026/.test(d.html || ''), String(d.html).slice(0, 1200));
  ok('…and where the line is waiting', /Vendor —/.test(d.html || ''));
  ok('…and says the share is shared, and how', /shared with other orders/.test(d.html || '') && /open orders first/.test(d.note || ''));
  A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
  try { A.ordJourney('NO-SUCH-ORDER'); } catch (e) { /* must not throw */ }
  ok('an order that is not in the book opens nothing', (A.PTD_() || {}).title === 'cleared');

  /* ---- the console reads the vendor orders when it opens ---- */
  {
    const keepStore = NET.store, keepNet = NET.on; NET.on = true;
    NET.store = { pt_vendorOrders: { VND001: { v9: { id: 'v9', orderNo: 'VPO-9', orderType: 'cut', status: 'Placed', lines: [{ kind: 'cut', sku: 'S-C', qty: 5 }] } } } };
    A.setVO({ rows: null, map: null, err: '', busy: false, at: '', shown: [], pick: {} });
    try { await A.ensureOrd(); } catch (e) { /* fails below */ }
    ok('opening the console reads the vendor orders', (A.VO().rows || []).some(o => o.id === 'v9'), JSON.stringify((A.VO().rows || []).map(o => o.id)));
    ok('…and the line nobody held a moment ago now shows its vendor', (A.ordVendorOf('O-4', 'S-C') || {}).given === 5);
    NET.store = keepStore; NET.on = keepNet;
  }

  ME.admin = wasAdmin; A.setVO(wasVO); A.setPTG(wasPTG); A.setPT(wasPT); A.setORD(wasORD);
}

console.log('\\n== cutting required, and the override that can flip it ==');`, 'the tests');

fs.writeFileSync(T, t);
console.log('written');
