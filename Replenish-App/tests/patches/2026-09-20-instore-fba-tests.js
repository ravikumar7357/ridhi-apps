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

one('voStampOrders, ordBookCsv, qcOrdersFor, ordQcOf,', 'voStampOrders, ordBookCsv, qcOrdersFor, ordQcOf, ordFgAt, ordShareBySku, fbaState,', 'exports');

/* The two that measured "received" now measure what is THERE — the column's meaning changed. */
one(`  ok('receipts against the order add up', A.ordFgOf('AMZ-25082026-01', 'CPCN026') === 100);
  ok('what went OUT of the store is not counted as arrived', A.ordFgOf('AMZ-25082026-01', 'CPCN026') === 100);
  ok('another order keeps its own', A.ordFgOf('AMZ-10092026-02', 'CPCN026') === 11);
  ok('a line with nothing received reads zero', A.ordFgOf('SHP-3408', 'RTC327-6060') === 0);`,
`  /* "In store" USED TO MEAN "ever came in" — it read 25 for a line the Finished Goods screen showed as 0
   * in stock, because all 25 had gone to FBA. It now means what is there, and what came in is its own
   * figure beside it. */
  {
    const g = A.ordFgAt('AMZ-25082026-01', 'CPCN026');
    ok('receipts against the order add up', g.in === 100, JSON.stringify(g));
    ok('…and what went out is not counted as arrived', g.out === 90 && g.fba === 90);
    ok('…so what is IN STORE is the difference', g.store === 10 && A.ordFgOf('AMZ-25082026-01', 'CPCN026') === 10);
    ok('another order keeps its own', A.ordFgOf('AMZ-10092026-02', 'CPCN026') === 11);
    ok('a line with nothing received reads zero', A.ordFgOf('SHP-3408', 'RTC327-6060') === 0 && A.ordFgAt('SHP-3408', 'RTC327-6060') === null);
  }`, 'the two that changed meaning');

one(`  A.setFGI(wasFGI); A.setQC(wasQC); A.setPTG(wasPTG);
  ME.admin = was.admin; ME.prodEdit = was.prodEdit;
}`,
`  /* ================= WHAT WENT OUT NAMES NO ORDER ================= */
  {
    /* Two orders of one SKU, and a dispatch to FBA that says only the SKU — which is every one of the 363
     * FBA rows in the live ledger, because the store keeps stock by SKU. */
    A.setPTG(Object.assign(A.PTG(), { ob: [
      { id: 'f1', orderNo: 'FG-1', sku: 'FG-SKU', qty: 30, orderDate: '2026-09-01' },
      { id: 'f2', orderNo: 'FG-2', sku: 'FG-SKU', qty: 30, orderDate: '2026-09-05' }] }));
    A.setPT(Object.assign(A.PT(), { base: [], cut: [] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [] });
    const fgi = rows => A.setFGI(Object.assign({}, A.FGI(), { rows }));
    const at = (no, sku) => A.ordFgAt(no, sku || 'FG-SKU') || { in: 0, out: 0, fba: 0, fbaOpen: 0, store: 0, worked: 0, none: true };

    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 20, orderNo: 'FG-1' },
         { _id: 'b', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-2' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 25 }]);
    ok('a dispatch that names no order is shared among that SKU\\'s orders, oldest first',
       at('FG-1').fba === 20 && at('FG-2').fba === 5, at('FG-1').fba + ' / ' + at('FG-2').fba);
    ok('…once: the shares add up to what left, never more', at('FG-1').fba + at('FG-2').fba === 25);
    ok('…never beyond what that order took in — nothing leaves a store it never entered',
       at('FG-1').out === 20 && at('FG-1').in === 20);
    ok('…so what is in store is what is left', at('FG-1').store === 0 && at('FG-2').store === 25);
    ok('…and the share is marked as worked out', at('FG-1').worked === 20 && at('FG-2').worked === 5);

    /* A dispatch that DOES name its order is that order's, and comes off the room before anything is shared. */
    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 20, orderNo: 'FG-1' },
         { _id: 'b', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-2' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 15, orderNo: 'FG-2' },
         { _id: 'd', txnType: 'FBA', sku: 'FG-SKU', qty: 25 }]);
    ok('a dispatch that names its order is that order\\'s', at('FG-2').fba === 15 + 10, JSON.stringify(at('FG-2')));
    ok('…and what it took is not shared in again', at('FG-1').out === 20 && at('FG-1').store === 0);
    ok('…with only the shared part marked as worked out', at('FG-2').worked === 10);

    /* WAITING FOR AMAZON is still the factory's. All 363 live rows are in that state. */
    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-1' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 30 }]);
    ok('a dispatch nobody has shipped yet is counted as still held', at('FG-1').fbaOpen === 30 && at('FG-1').store === 0);
    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-1' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 30, fbaAcceptedAt: 'x', fbaShippedAt: 'y' }]);
    ok('…and one that HAS shipped is not', at('FG-1').fbaOpen === 0 && at('FG-1').fba === 30);
    /* A return from FBA puts the pieces back on the shelf. */
    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-1' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 30, fbaReturned: 30 },
         { _id: 'd', txnType: 'FBA_RETURN', sku: 'FG-SKU', qty: 30 }]);
    ok('pieces the FBA team sent back are in store again', at('FG-1').store === 30 && at('FG-1').fba === 0, JSON.stringify(at('FG-1')));
    /* Opening stock belongs to no order, and a transfer from the press only counts once confirmed. */
    fgi([{ _id: 'o', txnType: 'OPENING', sku: 'FG-SKU', qty: 99, orderNo: 'FG-1' },
         { _id: 'p', txnType: 'TRANSFER_IN', sku: 'FG-SKU', qty: 10, orderNo: 'FG-1' },
         { _id: 'q', txnType: 'TRANSFER_IN', sku: 'FG-SKU', qty: 5, orderNo: 'FG-1', confirmed: true }]);
    ok('opening stock is nobody\\'s order, and an unconfirmed transfer is not in store yet',
       at('FG-1').in === 5 && at('FG-1').store === 5, JSON.stringify(at('FG-1')));

    /* ---- the screen ---- */
    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-1' },
         { _id: 'b', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-2' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 25 }]);
    ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ'].forEach(i => { els[i].value = ''; });
    A.renderOrd();
    const h = els.odTable.innerHTML;
    ok('the table has an In store column and a To FBA column beside it',
       /<th[^>]*>In store<\\/th><th[^>]*>To FBA<\\/th>/.test(h), (h.match(/<th[^>]*>[^<]*<\\/th>/g) || []).join('').slice(0, 400));
    /* A HEADING AND ITS CELLS THAT DISAGREE BY ONE PUTS EVERY COLUMN AFTER IT OVER THE WRONG DATA. */
    {
      const heads = (h.match(/<th[^>]*>.*?<\\/th>/g) || []).length;
      const firstRow = (h.match(/<tbody><tr>([\\s\\S]*?)<\\/tr>/) || [])[1] || '';
      const cells = (firstRow.match(/<td/g) || []).length;
      ok('…and every row has exactly as many cells as there are headings', heads === cells, heads + ' headings vs ' + cells + ' cells');
    }
    ok('a line whose stock all went to FBA shows nothing in store and the dispatch beside it',
       /<div class="muted" style="font-size:10.5px">20 waiting<\\/div>/.test(h), h.slice(0, 200));
    ok('…and says the dispatch was shared out by SKU', /shared out by SKU/.test(h));
    ok('the pieces still held for FBA are named on the In store cell', /held for FBA/.test(h));

    /* ---- the journey, and where the line is waiting ---- */
    const row = no => A.ordLines().find(r => r.orderNo === no);
    ok('a line whose pieces are waiting to ship says so', /^FBA —/.test(A.ordWaitingAt(row('FG-1'))), A.ordWaitingAt(row('FG-1')));
    ok('…and one with stock on the shelf says it is ready to dispatch',
       /^Store — 25 ready/.test(A.ordWaitingAt(row('FG-2'))), A.ordWaitingAt(row('FG-2')));
    A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
    try { A.ordJourney('FG-1'); } catch (e) { /* the empty dialog fails the next line */ }
    ok('the journey ends at FBA', /To FBA/.test((A.PTD_() || {}).html || ''), String((A.PTD_() || {}).html).slice(0, 300));

    /* ---- the export ---- */
    {
      const csv = A.ordBookCsv(A.ordLines()), head = csv[0].split(',');
      ok('the export carries the last leg too',
         ['Into store', 'In store now', 'To FBA', 'FBA not yet shipped'].every(n => head.indexOf(n) >= 0), csv[0]);
      ok('…and every row is as wide as the header', csv.every(x => x.split(',').length === head.length),
         csv.map(x => x.split(',').length).join(' '));
    }
  }

  A.setFGI(wasFGI); A.setQC(wasQC); A.setPTG(wasPTG);
  ME.admin = was.admin; ME.prodEdit = was.prodEdit;
}`, 'the new tests');

fs.writeFileSync(T, t);
console.log('written');
