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

one(`  A.setFGI(wasFGI); A.setQC(wasQC); A.setPTG(wasPTG);
  ME.admin = was.admin; ME.prodEdit = was.prodEdit;
}`,
`  /* ================= THE SAME END TO END, FOR A SHOPIFY ORDER =================
   *
   * Its end is a different one: a Shopify line is handed to SHIPPING, not sent to Amazon, and it does not
   * normally pass through the finished-goods store — 26 of its 432 SKUs ever reached one. */
  {
    const wasSP = A.PTG().shopProd, wasVO2 = Object.assign({}, A.VO());
    A.setPTG(Object.assign(A.PTG(), {
      ob: [{ id: 's1', orderNo: 'SHP-9100', sku: 'SH-A', qty: 4, orderDate: '2026-09-02', src: 'SHP', shopOrderNo: '#9100',
             articleType: 'Pillow Cover', articleSubtype: 'Plain', color: 'Blue', size: '18x18' },
           { id: 's2', orderNo: 'SHP-9200', sku: 'SH-A', qty: 6, orderDate: '2026-09-06', src: 'SHP', shopOrderNo: '#9200',
             articleType: 'Pillow Cover', articleSubtype: 'Plain', color: 'Blue', size: '18x18' }],
      mdb: [{ sku: 'SH-A', articleType: 'Pillow Cover', subtype: 'Plain', color: 'Blue', size: '18x18', cuttingRequired: false }],
      press: [{ id: 'sp1', orderNo: 'SHP-9100', sku: 'SH-A', pieces: 4 }],
      masters: Object.assign({}, A.PTG().masters, { vendor: [{ code: 'VND001', desc: 'RBP-Bagru', category: 'Printer', active: true }] }),
      shopProd: { 'SHP-9100|SH-A': { orderNo: 'SHP-9100', sku: 'SH-A', handedAt: '2026-09-12T05:00:00Z', handedBy: 'ship@x' } },
    }));
    A.setPT(Object.assign(A.PT(), { base: [{ id: 'sb1', orderNo: 'SHP-9100', sku: 'SH-A', issuePieces: 4, receivedPieces: 4 }], cut: [] }));
    A.setFGI(Object.assign({}, A.FGI(), { rows: [] }));
    A.setQC(Object.assign({}, A.QC(), { checks: [], issue: [], ret: [] }));
    /* A vendor holds the pieces of the second order — the Shopify view used to say "not printed" for this. */
    A.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: [
      { vendorCode: 'VND001', id: 'sv1', orderNo: 'VPO-S1', orderType: 'cut', orderDate: '01/09/2026', status: 'Placed',
        lines: [{ kind: 'cut', sku: 'SH-A', qty: 6, deliveries: [] }] }] });
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    const row = no => A.ordLines().find(r => r.orderNo === no);

    /* ---- where a Shopify line is waiting ---- */
    ok('a line the shipping team has taken says so by name, not just "Complete"',
       A.ordWaitingAt(row('SHP-9100')) === 'Handed over', A.ordWaitingAt(row('SHP-9100')));
    /* AND THE BRANCH I CALLED UNREACHABLE IS REACHED HERE. A Shopify line stays open until shipping takes
     * it, so one that is made and pressed and NOT handed over arrives past every stage check. */
    A.setPTG(Object.assign(A.PTG(), { press: (A.PTG().press || []).concat([{ id: 'sp2', orderNo: 'SHP-9200', sku: 'SH-A', pieces: 6 }]) }));
    A.setPT(Object.assign(A.PT(), { base: A.PT().base.concat([{ id: 'sb2', orderNo: 'SHP-9200', sku: 'SH-A', issuePieces: 6, receivedPieces: 6 }]) }));
    A.setPTG(Object.assign(A.PTG(), { shopProd: Object.assign({}, A.PTG().shopProd, { 'SHP-9200|SH-A': { orderNo: 'SHP-9200', sku: 'SH-A' } }) }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    ok('…and one made but not yet taken is ready to hand over',
       A.ordWaitingAt(row('SHP-9200')) === 'Ready to hand over to shipping', A.ordWaitingAt(row('SHP-9200')));

    /* ---- the by-order table ---- */
    els.odView.value = 'shoporder';
    ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ'].forEach(i => { els[i].value = ''; });
    A.renderOrd();
    const h = els.odTable.innerHTML;
    ok('the Shopify table carries Received and QC, which it never had',
       /<th[^>]*>Received<\\/th><th[^>]*>QC<\\/th>/.test(h), (h.match(/<th[^>]*>[A-Za-z ]+<\\/th>/g) || []).join('').slice(0, 400));
    {
      const heads = (h.match(/<th[^>]*>.*?<\\/th>/g) || []);
      const firstRow = (h.match(/<tbody><tr>([\\s\\S]*?)<\\/tr>/) || [])[1] || '';
      ok('…and every row has exactly as many cells as there are headings',
         heads.length === (firstRow.match(/<td/g) || []).length, heads.length + ' vs ' + (firstRow.match(/<td/g) || []).length);
      const numOf = name => (heads.find(x => x.indexOf('>' + name + '<') >= 0) || '').indexOf('class="num"') >= 0;
      ok('…and the numeric run reaches the last figure', ['Pieces', 'Received', 'QC', 'Pressed', 'To make'].every(numOf),
         ['Pieces', 'Received', 'QC', 'Pressed', 'To make'].map(n => n + ':' + numOf(n)).join(' '));
    }
    /* THE SAME FAULT THE ORDER BOOK HAD. */
    ok('the Printing cell knows what a vendor holds, instead of saying "not printed"',
       /back of 6/.test(h) && /RBP-Bagru/.test(h) && !/not printed/.test(h), h.slice(0, 600));
    ok('…and says so plainly where no vendor holds anything', /not given to a vendor/.test(h));
    ok('every Shopify order number opens that order', /data-ordj="SHP-9100"/.test(h) && /data-ordj="SHP-9200"/.test(h));

    /* ---- the by-SKU table ---- */
    els.odView.value = 'shopsku'; A.renderOrd();
    const hs = els.odTable.innerHTML;
    ok('the by-SKU table carries Received too', /<th[^>]*>Received<\\/th>/.test(hs));
    {
      const heads = (hs.match(/<th[^>]*>.*?<\\/th>/g) || []);
      const firstRow = (hs.match(/<tbody><tr>([\\s\\S]*?)<\\/tr>/) || [])[1] || '';
      ok('…and its rows are as wide as its headings too',
         heads.length === (firstRow.match(/<td/g) || []).length, heads.length + ' vs ' + (firstRow.match(/<td/g) || []).length);
    }
    ok('…and each order chip opens that order', /data-ordj="SHP-9100"/.test(hs) && /data-ordj="SHP-9200"/.test(hs));

    /* ---- the journey ---- */
    A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
    try { A.ordJourney('SHP-9100'); } catch (e) { /* the empty dialog fails the lines below */ }
    const d = A.PTD_() || {};
    ok('a Shopify order opens start to finish', /SHP-9100/.test(d.title || ''), String(d.title));
    ok('…ending at the shipping table, not at Amazon', /font-size:11px">Handed over<\\/div>/.test(d.html || ''), String(d.html).slice(0, 400));
    ok('…and the subtitle says how many have gone', /1 of 1 handed to shipping/.test(d.subtitle || ''), String(d.subtitle));
    /* THE STORE AND FBA TILES ARE NOT SHOWN when a Shopify order never went near them — a tile of zero on
     * a stage the order does not have is noise on the one screen meant to answer "where is it". */
    ok('…and it is not given tiles for stages it never had',
       !/font-size:11px">In store<\\/div>/.test(d.html || '') && !/font-size:11px">To FBA<\\/div>/.test(d.html || ''), String(d.html).slice(0, 700));
    /* …but they come back the moment there IS something in the store. */
    A.setFGI(Object.assign({}, A.FGI(), { rows: [{ _id: 'fs1', txnType: 'RECEIVE', sku: 'SH-A', qty: 4, orderNo: 'SHP-9100' }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
    try { A.ordJourney('SHP-9100'); } catch (e) { /* fails below */ }
    ok('…and it does get them when its pieces did pass through the store',
       /font-size:11px">In store<\\/div>/.test((A.PTD_() || {}).html || ''), String((A.PTD_() || {}).html).slice(0, 700));

    /* ---- the export ---- */
    els.odView.value = 'shoporder'; A.renderOrd();
    DOWNLOADS = [];
    els.odExport.onclick();
    ok('the Shopify export still downloads', DOWNLOADS.length === 1 && /shopify-production-by-order/.test(DOWNLOADS[0]), DOWNLOADS.join());

    A.setPTG(Object.assign(A.PTG(), { shopProd: wasSP })); A.setVO(wasVO2);
    els.odView.value = 'book';
  }

  A.setFGI(wasFGI); A.setQC(wasQC); A.setPTG(wasPTG);
  ME.admin = was.admin; ME.prodEdit = was.prodEdit;
}`, 'the Shopify tests');

fs.writeFileSync(T, t);
console.log('written');
