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

one('soQtySheetRead, soQtyBulkPlan,', 'soQtySheetRead, soQtyBulkPlan, ordQtyAdj, ordQtyUnseen, ordQtyUnseenAll, ordQtySeen, ordQtyBadge, ordQtyPill,', 'exports');

one(`  ME.admin = wasME2.admin; ME.soApprove = wasME2.soApprove;
  A.setSOX(wasSOX); A.setPTG(wasPTG2); A.setPT(wasPT2);`,
`  /* ================= AND THE FLOOR IS TOLD =================
   *
   * Ravi, straight after the first upload: "mene jese hi adjustment qty upload kiya direct change ho
   * gya production team ko pata hi nahi chala." The change WAS written down — on the sales order,
   * which nobody on the floor opens. A figure that moves silently is worse than one that is wrong. */
  {
    reset();
    await A.soQtyRun(ord(), 'QTY-A', 150, 'buyer added 50');
    const logId = Object.keys(ord().qtyAdjustments || {})[0];

    ok('the change is found from the line it happened to, not from the sales order',
       A.ordQtyAdj('AMZ-Q1', 'QTY-A').length === 1, JSON.stringify(A.ordQtyAdj('AMZ-Q1', 'QTY-A')));
    ok('…carrying what it was, what it is and why',
       (a => a.from === 100 && a.to === 150 && a.why === 'buyer added 50')(A.ordQtyAdj('AMZ-Q1', 'QTY-A')[0]),
       JSON.stringify(A.ordQtyAdj('AMZ-Q1', 'QTY-A')[0]));
    ok('…and it reads as what it was and what it is', A.ordQtyPill({ from: 100, to: 150 }) === '100 → 150',
       A.ordQtyPill({ from: 100, to: 150 }));
    ok('a line nothing happened to has nothing on it', A.ordQtyAdj('AMZ-Q1', 'QTY-B').length === 0);

    /* ---- UNTIL SOMEBODY SAYS THEY SAW IT, IT IS NEWS ---- */
    ok('nobody has seen it yet', A.ordQtyUnseen('AMZ-Q1', 'QTY-A').length === 1);
    ok('…and it is counted across the whole book', A.ordQtyUnseenAll().length === 1,
       String(A.ordQtyUnseenAll().length));
    ok('…and on the sidebar, so the tab does not have to be open',
       (A.ordQtyBadge(), els.ordAdjBadge.textContent === '1' && !/hide/.test(els.ordAdjBadge.className)),
       els.ordAdjBadge.textContent + ' / ' + els.ordAdjBadge.className);

    /* ---- THE SCREEN ---- */
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    els.odView.value = 'book';
    ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ'].forEach(i => { els[i].value = ''; });
    A.setORD_KPI(''); A.renderOrd();
    ok('the line says the quantity moved', /qty 100 → 150/.test(els.odTable.innerHTML),
       els.odTable.innerHTML.slice(0, 400));
    ok('…and offers somebody the chance to say they have seen it',
       /data-ordseen=/.test(els.odTable.innerHTML));
    ok('the top of the screen says it too, not only the row',
       /nobody here has said they have seen it/.test(els.odMsg.innerHTML), els.odMsg.innerHTML.slice(0, 300));
    ok('…and names the order and the SKU', /AMZ-Q1 QTY-A 100 → 150/.test(els.odMsg.innerHTML),
       els.odMsg.innerHTML.slice(0, 400));
    ok('…and the line count is still there with it', /line\\(s\\)/.test(els.odMsg.innerHTML),
       els.odMsg.innerHTML.slice(-200));
    ok('the panel counts it in a tile of its own', /Quantity changed/.test(els.odKpis.innerHTML),
       els.odKpis.innerHTML.slice(0, 300));
    ok('…and it is one of the tiles you can click', !!A.ORD_KPI_FIELDS.qtyChanged,
       Object.keys(A.ORD_KPI_FIELDS).join(','));
    const bodyRows = html => ((html.match(/<tbody>([\\s\\S]*)<\\/tbody>/) || [])[1] || '').match(/<tr/g) || [];
    A.setORD_KPI('qtyChanged'); A.renderOrd();
    ok('…and clicking it shows only the lines whose quantity moved',
       bodyRows(els.odTable.innerHTML).length === 1, bodyRows(els.odTable.innerHTML).length + ' row(s)');
    A.setORD_KPI(''); A.renderOrd();

    /* ---- SOMEBODY SAYS THEY SAW IT, AND THE LOOP CLOSES AT BOTH ENDS ---- */
    const err = await A.ordQtySeen('AMZ-Q1', logId);
    ok('somebody on the floor can say they have seen it', err === '', err);
    ok('…and it stops being news', A.ordQtyUnseen('AMZ-Q1', 'QTY-A').length === 0
       && A.ordQtyUnseenAll().length === 0, JSON.stringify(A.ordQtyUnseenAll()));
    ok('…and the sidebar count clears', (A.ordQtyBadge(), els.ordAdjBadge.textContent === ''),
       els.ordAdjBadge.textContent);
    /* THE PERSON WHO CHANGED IT READS THAT BACK. Delivered and read are different things. */
    ok('…and who saw it, and when, is on the change itself',
       (a => a.seenBy && a.seenAt)((ord().qtyAdjustments || {})[logId]),
       JSON.stringify((ord().qtyAdjustments || {})[logId]));
    /* AND THE CHANGE ITSELF IS STILL THERE — seen is not deleted, it is history. */
    A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
    A.renderOrd();
    ok('the line still says what happened to it', /qty 100 → 150/.test(els.odTable.innerHTML));
    ok('…without asking to be seen again', !/data-ordseen=/.test(els.odTable.innerHTML));
    ok('…and the red line at the top is gone', !/nobody here has said/.test(els.odMsg.innerHTML),
       els.odMsg.innerHTML.slice(0, 200));

    ok('saying it twice is not an error', (await A.ordQtySeen('AMZ-Q1', logId)) === '');
    ok('a change that is not there is said so', /that change is gone/i.test(await A.ordQtySeen('AMZ-Q1', 'nope')),
       await A.ordQtySeen('AMZ-Q1', 'nope'));
    ok('…and so is an order that is not there', /that order is gone/i.test(await A.ordQtySeen('NOPE', logId)),
       await A.ordQtySeen('NOPE', logId));

    /* ---- NOTHING HERE CAN CHANGE A QUANTITY ---- */
    ok('saying you have seen it does not touch the figure',
       A.soQtyOf(ord(), 'QTY-A') === 150 && (A.PTG().ob.find(r => r.id === 'ob_so_AMZ-Q1_QTY-A') || {}).qty === 150,
       String(A.soQtyOf(ord(), 'QTY-A')));
  }

  ME.admin = wasME2.admin; ME.soApprove = wasME2.soApprove;
  A.setSOX(wasSOX); A.setPTG(wasPTG2); A.setPT(wasPT2);`, 'the told-the-floor tests');

fs.writeFileSync(T, t);
console.log('written');
