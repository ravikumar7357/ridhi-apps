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

one('ordVendorAlloc, ordVendorOf, ordWaitingAt, ordJourney, ensureOrd,',
  'ordVendorAlloc, ordVendorOf, ordWaitingAt, ordJourney, ensureOrd, voStampOrders, ordBookCsv,', 'exports');

one(`  ME.admin = wasAdmin; A.setVO(wasVO); A.setPTG(wasPTG); A.setPT(wasPT); A.setORD(wasORD);`,
`  /* ================= A NEW VENDOR LINE SAYS WHICH ORDERS IT IS FOR =================
   *
   * The 489 lines already placed name no sales order, so their link is worked out. From now on it is
   * written down as the order is placed, and a written link is not moved by any rule. */
  book(); A.setPT(Object.assign(A.PT(), { base: [], cut: [] }));
  const vo = rows => A.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  const stamp = lines => A.voStampOrders(lines).map(l => (l.forOrders || []).map(f => f.orderNo + ':' + f.qty).join(' '));

  vo([]);
  ok('a new line is stamped with the open orders wanting it, oldest first',
     stamp([{ kind: 'cut', sku: 'S-A', qty: 40 }])[0] === 'O-1:30 O-2:10', stamp([{ kind: 'cut', sku: 'S-A', qty: 40 }])[0]);
  ok('two lines of one SKU in the same order do not stamp the same order twice',
     stamp([{ kind: 'cut', sku: 'S-A', qty: 30 }, { kind: 'cut', sku: 'S-A', qty: 30 }]).join(' | ') === 'O-1:30 | O-2:30',
     stamp([{ kind: 'cut', sku: 'S-A', qty: 30 }, { kind: 'cut', sku: 'S-A', qty: 30 }]).join(' | '));
  ok('pieces no open order wants are left unstamped, not invented an order for',
     stamp([{ kind: 'cut', sku: 'S-B', qty: 25 }])[0] === 'O-3:10', stamp([{ kind: 'cut', sku: 'S-B', qty: 25 }])[0]);
  ok('…and a SKU nobody ordered gets no stamp at all', !('forOrders' in A.voStampOrders([{ kind: 'cut', sku: 'S-NOBODY', qty: 5 }])[0]));
  ok('metres, a cancelled line and a console-assigned line are left as they are',
     A.voStampOrders([{ kind: 'running', fabricType: 'Voil 92', meters: 50 }, { kind: 'cut', sku: 'S-A', qty: 9, cancelled: true },
       { kind: 'cut', sku: 'S-A', qty: 9, shopKey: 'O-1|S-A' }]).every(l => !('forOrders' in l)));
  ok('a line already stamped is not stamped again',
     stamp([{ kind: 'cut', sku: 'S-A', qty: 40, forOrders: [{ orderNo: 'O-2', qty: 40 }] }])[0] === 'O-2:40');
  /* WHAT VENDORS ALREADY HOLD COMES OFF THE NEED FIRST — a second order for the SKU stamps the NEXT order. */
  vo([{ vendorCode: 'VND001', id: 'w1', orderNo: 'VPO-W1', orderType: 'cut', orderDate: '02/09/2026', status: 'Placed', lines: [{ kind: 'cut', sku: 'S-A', qty: 40 }] }]);
  ok('a second order for the SKU stamps what the first left uncovered',
     stamp([{ kind: 'cut', sku: 'S-A', qty: 25 }])[0] === 'O-2:20', stamp([{ kind: 'cut', sku: 'S-A', qty: 25 }])[0]);

  /* ---- and the allocation honours what was written ---- */
  vo([{ vendorCode: 'VND001', id: 'w2', orderNo: 'VPO-W2', orderType: 'cut', orderDate: '02/09/2026', status: 'Placed',
    lines: [{ kind: 'cut', sku: 'S-A', qty: 20, forOrders: [{ orderNo: 'O-2', qty: 20 }], deliveries: [day(5, 5)] }] }]);
  ok('a stamp beats the sharing rule: the older order gets nothing of a line placed for the newer',
     of('O-2', 'S-A').given === 20 && !!of('O-1', 'S-A').none, JSON.stringify([of('O-2', 'S-A').given, of('O-1', 'S-A').given]));
  ok('…and what came back on it is that order\\'s', of('O-2', 'S-A').back === 5);
  ok('…and it is not called shared, because nothing about it was worked out',
     of('O-2', 'S-A').shared === false && of('O-2', 'S-A').parts[0].stamped === true);
  A.renderOrd();
  ok('the screen says it was placed for this order', /for this order/.test(els.odTable.innerHTML));
  vo([{ vendorCode: 'VND001', id: 'w3', orderNo: 'VPO-W3', orderType: 'cut', orderDate: '02/09/2026', status: 'Placed',
    lines: [{ kind: 'cut', sku: 'S-A', qty: 20, forOrders: [{ orderNo: 'GONE-FROM-THE-BOOK', qty: 20 }] }] }]);
  ok('a stamp for an order that has left the book goes back to be shared, not lost',
     of('O-1', 'S-A').given === 20, String(of('O-1', 'S-A').given));
  vo([{ vendorCode: 'VND001', id: 'w4', orderNo: 'VPO-W4', orderType: 'cut', orderDate: '02/09/2026', status: 'Placed',
    lines: [{ kind: 'cut', sku: 'S-A', qty: 8, forOrders: [{ orderNo: 'O-2', qty: 500 }] }] }]);
  ok('a stamp can never give out more than the line holds', of('O-2', 'S-A').given === 8, String(of('O-2', 'S-A').given));

  /* ---- placing an order writes the stamp ---- */
  {
    const keepNet = NET.on, keepStore = NET.store, keepSOX = Object.assign({}, A.SOX()); NET.on = true; NET.store = {};
    A.setSOX(Object.assign({}, A.SOX(), { rows: [{ id: 'so1', status: 'approved', lines: [{ sku: 'S-A', qty: 100 }] }] }));
    vo([]);
    await A.voFormOpen();
    els.vof_service.value = 'Block print'; A.voOnServicePick();
    els.vof_vendor.value = 'VND001';
    A.setVOF(Object.assign(A.VOF(), { kind: 'cut', service: 'Block print', lines: [{ kind: 'cut', sku: 'S-A', qty: 40 }] }));
    let said = ''; try { said = String(await A.voPlace() || ''); } catch (e) { said = 'threw: ' + (e.message || e); }
    ok('the order is placed', said === '', said);
    const put = NET.calls.filter(c => c.method === 'PUT' && /pt_vendorOrders\\/VND001\\//.test(c.url)).pop();
    ok('…and each line is written with the orders it is for',
       !!put && JSON.stringify((put.body.lines[0] || {}).forOrders) === JSON.stringify([{ orderNo: 'O-1', qty: 30 }, { orderNo: 'O-2', qty: 10 }]),
       JSON.stringify(put && put.body.lines[0]));
    A.setVOF({ kind: 'running', lines: [] }); A.setSOX(keepSOX); NET.on = keepNet; NET.store = keepStore;
  }

  /* ---- the export carries what the screen shows ---- */
  vo(orders());
  {
    const csv = A.ordBookCsv(A.ordLines()), head = csv[0].split(',');
    const col = n => head.indexOf(n), rowOf = no => (csv.find(x => x.indexOf(no + ',') === 0) || '').split(',');
    ok('the export has the vendor columns', ['Vendor', 'Given to vendor', 'Back from vendor', 'Not given', 'Vendor orders', 'Promised', 'How linked', 'Waiting at']
       .every(n => col(n) >= 0), csv[0]);
    ok('…with the same figures the screen shows', rowOf('O-1')[col('Given to vendor')] === '30' && rowOf('O-1')[col('Back from vendor')] === '10'
       && rowOf('O-2')[col('Not given')] === '20', JSON.stringify([rowOf('O-1')[col('Given to vendor')], rowOf('O-2')[col('Not given')]]));
    ok('…and how each was linked', rowOf('O-1')[col('How linked')] === 'shared by SKU' && rowOf('O-3')[col('How linked')] === 'only order for this SKU',
       rowOf('O-1')[col('How linked')] + ' / ' + rowOf('O-3')[col('How linked')]);
    ok('…and where each is waiting', /^Vendor/.test(rowOf('O-1')[col('Waiting at')]), rowOf('O-1')[col('Waiting at')]);
    ok('…and a header and a row that are the same length', csv.every(x => x.split(',').length === head.length),
       csv.map(x => x.split(',').length).join(' '));
  }

  ME.admin = wasAdmin; A.setVO(wasVO); A.setPTG(wasPTG); A.setPT(wasPT); A.setORD(wasORD);`, 'the tests');

fs.writeFileSync(T, t);
console.log('written');
