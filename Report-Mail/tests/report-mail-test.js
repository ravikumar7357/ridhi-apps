/* The ERP report mail's rules, on made-up orders. Run: node Report-Mail/tests/report-mail-test.js */
const assert = require('assert');
const { loadReportMail } = require('./load');
const rm = loadReportMail();

let failed = 0;
const test = (name, fn) => { try { fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
/* Lists made inside the loaded script belong to its own scope, so they are compared by value. */
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b === undefined ? null : b)), m);

/* ---- business helpers ---- */
const IST = (day, hm) => Date.parse(day + 'T' + (hm || '12:00') + ':00+05:30');
const MON_17_NOV = IST('2026-11-16', '09:05');                 // Monday 16 Nov 2026, 9:05 am
const THU_19_NOV = IST('2026-11-19', '09:05');                 // Thursday
const order = (orderNo, sku, qty, extra) => Object.assign({ orderNo, sku, qty, orderDate: '2026-11-01', uploadedAt: '2026-11-01T06:00:00Z' }, extra || {});
const cutting = (orderNo, sku, pieces, cutDate) => ({ orderNo, sku, pieces, cutDate });
const issueToKarigar = (orderNo, sku, n, issueDate, back, receivingDate) => ({ orderNo, sku, issuePieces: n, issueDate, receivedPieces: back || 0, receivingDate: receivingDate || '' });
const press = (orderNo, sku, pieces, entryDate) => ({ orderNo, sku, pieces, entryDate });
const salesOrder = (no, lines, deliveryDate) => ({ _id: no, deliveryDate: deliveryDate || '', lines });
const db = parts => Object.assign({ ob: {}, shopProd: {}, cut: {}, base: {}, press: {}, fgi: {}, so: {}, shop: { orders: [] }, meta: {} }, parts);
const line = (rep, list, no) => rep.prod[list].find(r => r.line.orderNo === no);

console.log('dates');
test('reads every date shape the registers write, as India time', () => {
  eq(rm.rmDayOf('17/11/2026, 14:10'), '2026-11-17');
  eq(rm.rmDayOf('17/11/2026'), '2026-11-17');
  eq(rm.rmDayOf('2026-11-17'), '2026-11-17');
  eq(rm.rmDayOf('2026-11-16T19:00:00.000Z'), '2026-11-17', 'after 6:30 pm UTC is the next India day');
  eq(rm.rmMs(''), 0); eq(rm.rmMs('not a date'), 0);
});
test('Monday mail covers Thursday to Sunday', () => eq(JSON.parse(JSON.stringify(rm.rmWindow(MON_17_NOV))), { fromDay: '2026-11-12', toDay: '2026-11-16', lastDay: '2026-11-15' }));
test('Thursday mail covers Monday to Wednesday', () => eq(JSON.parse(JSON.stringify(rm.rmWindow(THU_19_NOV))), { fromDay: '2026-11-16', toDay: '2026-11-19', lastDay: '2026-11-18' }));
test('a run by hand on Tuesday repeats Monday\'s window', () => eq(rm.rmWindow(IST('2026-11-17')).fromDay, '2026-11-12'));
test('a report by hand from Saturday counts Saturday to today, and says "Period"', () => {
  const tue = IST('2026-11-17', '15:00');
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-14T05:00:00Z' }), b: order('SHP-2', 'A', 1, { openedAt: '2026-11-17T05:00:00Z' }),
    c: order('SHP-3', 'A', 1, { openedAt: '2026-11-13T05:00:00Z' }) } }), tue, '2026-11-14');
  eq(rep.prod.came.map(r => r.line.orderNo).sort(), ['SHP-1', 'SHP-2'], 'Friday 13 is before the period; today counts');
  assert.ok(rm.rmMailHtml(rep, {}).includes('Period counted: <b>14 Nov – 17 Nov</b>'));
  assert.ok(rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), () => '').includes('14/11/2026 – 17/11/2026</td>'));
});
test('from Saturday by hand, every list keeps only what happened since Saturday', () => {
  const tue = IST('2026-11-17', '15:00');
  const rep = rm.rmReport(db({
    ob: { a: order('B2B-1', 'A', 5), b: order('B2B-2', 'A', 5), c: order('B2B-3', 'A', 5) },
    so: { a: salesOrder('B2B-1', [{ sku: 'A', deliveryDate: '2026-11-15' }]), b: salesOrder('B2B-2', [{ sku: 'A', deliveryDate: '2026-11-05' }]), c: salesOrder('B2B-3', [{ sku: 'A' }]) },
    cut: { x: cutting('B2B-1', 'A', 1, '15/11/2026'), y: cutting('B2B-2', 'A', 1, '10/11/2026'), z: cutting('B2B-3', 'A', 1, '01/11/2026') },
  }), tue, '2026-11-14');
  eq(rep.prod.started.map(r => r.line.orderNo), ['B2B-1'], 'B2B-2 and B2B-3 started before Saturday');
  eq(rep.prod.late.map(r => r.line.orderNo), ['B2B-1'], 'B2B-2 was already late before Saturday');
  eq(rep.prod.stuck.map(r => r.line.orderNo), ['B2B-2'], 'B2B-2 reached 5 days without work on 15 Nov; B2B-3 on 6 Nov');
  const timed = rm.rmReport(db({ ob: { b: order('B2B-2', 'A', 5) }, so: { b: salesOrder('B2B-2', [{ sku: 'A', deliveryDate: '2026-11-05' }]) } }), tue);
  eq(timed.prod.late.length, 1, 'the timed mail still shows every late line');
});
test('5 working days skip Sunday', () => {
  eq(rm.rmAddWorkDays('2026-11-12', 5), '2026-11-18');   // Thu → Fri Sat (Sun) Mon Tue Wed
  eq(rm.rmDaysBetween('2026-11-14', '2026-11-16'), 2, 'days late are calendar days, as the red strip counts them');
});

console.log('production');
test('a Shopify line opened in the window came in; one opened before did not', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-13T05:00:00Z' }), b: order('SHP-2', 'A', 1, { openedAt: '2026-11-11T05:00:00Z' }) } }), MON_17_NOV);
  eq(rep.prod.came.map(r => r.line.orderNo), ['SHP-1']);
});
test('a line opened on the Monday morning of the mail waits for Thursday\'s mail', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-16T02:00:00Z' }) } }), MON_17_NOV);
  eq(rep.prod.came.length, 0);
});
test('started = cutting, karigar issue or a printer is recorded; nothing recorded is not started', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('SHP-1', 'A', 2), b: order('SHP-2', 'A', 2), c: order('SHP-3', 'A', 2), d: order('SHP-4', 'A', 2) },
    cut: { x: cutting('SHP-1', 'A', 1, '14/11/2026, 10:00') },
    base: { x: issueToKarigar('SHP-2', 'A', 2, '14/11/2026, 10:00') },
    shopProd: { x: { orderNo: 'SHP-3', sku: 'A', printer: 'VND002', assignedAt: '2026-11-14T05:00:00Z' } },
  }), MON_17_NOV);
  eq(rep.prod.started.map(r => r.line.orderNo).sort(), ['SHP-1', 'SHP-2', 'SHP-3']);
});
test('rejected cut pieces do not count as cut', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 2) }, cut: { x: Object.assign(cutting('SHP-1', 'A', 2, '14/11/2026'), { rejected: true, rejPieces: 2 }) } }), MON_17_NOV);
  eq(rep.prod.started.length, 0);
});
test('a Shopify line is due 5 working days after it opened, and late after that', () => {
  // opened Mon 9 Nov → due Sat 14 Nov → on Mon 16 Nov it is 1 working day late
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-09T05:00:00Z' }), b: order('SHP-2', 'A', 1, { openedAt: '2026-11-10T05:00:00Z' }) } }), MON_17_NOV);
  const l = line(rep, 'late', 'SHP-1').line;
  eq([l.due, l.lateDays], ['2026-11-14', 2]);
  eq(line(rep, 'late', 'SHP-2'), undefined, 'due Mon 16 Nov is not late on Mon 16 Nov');
});
test('a sales order line is late after its delivery date, with its priority', () => {
  const rep = rm.rmReport(db({ ob: { a: order('B2B-1', 'A', 10, { src: 'SO' }) }, so: { s: salesOrder('B2B-1', [{ sku: 'A', qty: 10, priority: 'P2', deliveryDate: '2026-11-13' }]) } }), MON_17_NOV);
  const l = line(rep, 'late', 'B2B-1').line;
  eq([l.due, l.lateDays, l.priority], ['2026-11-13', 3, 'P2']);
});
test('a Shopify line on a sales order takes the sales order\'s date, as the red strip does', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-9', 'A', 1, { openedAt: '2026-11-13T05:00:00Z' }) },
    so: { s: salesOrder('SHP-9', [{ sku: 'A', deliveryDate: '2026-11-14' }]) } }), MON_17_NOV);
  eq(line(rep, 'late', 'SHP-9').line.due, '2026-11-14');
});
test('a legacy line past its date counts as late, as the red strip counts it, but never as started or stuck', () => {
  const rep = rm.rmReport(db({ ob: { a: order('LEG-17102026-01', 'A', 5) }, so: { s: salesOrder('LEG-17102026-01', [{ sku: 'A', deliveryDate: '2026-11-01' }]) },
    cut: { x: cutting('LEG-17102026-01', 'A', 1, '01/11/2026') } }), MON_17_NOV);
  eq([rep.prod.late.length, rep.prod.started.length, rep.prod.stuck.length], [1, 0, 0]);
});
test('a sales order line with no delivery date is never called late', () => {
  const rep = rm.rmReport(db({ ob: { a: order('B2B-1', 'A', 10) }, so: { s: salesOrder('B2B-1', [{ sku: 'A', qty: 10 }]) } }), MON_17_NOV);
  eq(rep.prod.late.length, 0);
});
test('stuck from the 5th day without work, not the 4th', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('SHP-1', 'A', 3), b: order('SHP-2', 'A', 3) },
    cut: { x: cutting('SHP-1', 'A', 1, '11/11/2026, 09:00'), y: cutting('SHP-2', 'A', 1, '12/11/2026, 09:00') },
  }), MON_17_NOV);
  eq(rep.prod.stuck.map(r => [r.line.orderNo, r.line.idleDays]), [['SHP-1', 5]], 'SHP-2 has gone 4 days without work');
});
test('a line never started is not stuck, however long it waits — it shows as late instead', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-10-20T05:00:00Z' }) } }), MON_17_NOV);
  eq([rep.prod.stuck.length, rep.prod.late.length], [0, 1]);
});
test('a handed-over Shopify line and a pressed-in-full sales order line are closed: not late, not stuck', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-10-01T05:00:00Z' }), b: order('AMZ-1', 'B', 2) },
    shopProd: { x: { orderNo: 'SHP-1', sku: 'A', handedAt: '2026-10-05T05:00:00Z' } },
    press: { y: press('AMZ-1', 'B', 2, '05/10/2026') },
    so: { s: salesOrder('AMZ-1', [{ sku: 'B', deliveryDate: '2026-10-10' }]) },
  }), MON_17_NOV);
  eq([rep.prod.late.length, rep.prod.stuck.length, rep.prod.started.length], [0, 0, 0]);
});
test('a line closed by shipping is not open', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { shopDoneAt: '2026-11-02T00:00:00Z', shopDoneWhy: 'cancelled' }) } }), MON_17_NOV);
  eq(rep.prod.stuck.length, 0);
});
test('the legacy order is never started or stuck', () => {
  const rep = rm.rmReport(db({ ob: { a: order('LEG-17102026-01', 'A', 5) }, cut: { x: cutting('LEG-17102026-01', 'A', 1, '01/11/2026') } }), MON_17_NOV);
  eq([rep.prod.started.length, rep.prod.stuck.length], [0, 0]);
});
test('into finished goods: each shipping receipt on its own day, the rest on the hand-over day, store receipts by order', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('SHP-1', 'A', 5), b: order('SHP-2', 'A', 2), c: order('AMZ-1', 'B', 10) },
    shopProd: {
      x: { orderNo: 'SHP-1', sku: 'A', handLog: [{ qty: 2, at: '2026-11-10T05:00:00Z' }, { qty: 3, at: '2026-11-13T05:00:00Z' }], handedAt: '2026-11-13T05:00:00Z' },
      y: { orderNo: 'SHP-2', sku: 'A', handedAt: '2026-11-14T05:00:00Z' },
    },
    fgi: { r: { txnType: 'RECEIVE', sku: 'B', qty: 4, orderNo: 'AMZ-1', createdAt: '2026-11-15T05:00:00Z' },
      old: { txnType: 'RECEIVE', sku: 'B', qty: 6, orderNo: 'AMZ-1', createdAt: '2026-11-01T05:00:00Z' } },
  }), MON_17_NOV);
  eq(rep.prod.finished.map(r => [r.line.orderNo, r.qty, r.day]).sort(), [['AMZ-1', 4, '2026-11-15'], ['SHP-1', 3, '2026-11-13'], ['SHP-2', 2, '2026-11-14']]);
});
test('lists put P1 first, then the most late', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('B2B-1', 'A', 1), b: order('B2B-2', 'A', 1), c: order('B2B-3', 'A', 1) },
    so: { a: salesOrder('B2B-1', [{ sku: 'A', priority: 'P3', deliveryDate: '2026-11-01' }]), b: salesOrder('B2B-2', [{ sku: 'A', priority: 'P1', deliveryDate: '2026-11-12' }]),
      c: salesOrder('B2B-3', [{ sku: 'A', priority: 'P1', deliveryDate: '2026-11-02' }]) },
  }), MON_17_NOV);
  eq(rep.prod.late.map(r => r.line.orderNo), ['B2B-3', 'B2B-2', 'B2B-1']);
});

console.log('shipping');
const shopOrder = (id, extra) => Object.assign({ id, no: '#' + id, at: '2026-11-10', ff: 'unfulfilled', shippedAt: '', cancelledAt: '', trkCo: '', shopBrand: 'SP',
  items: [{ sku: 'A', name: 'Tablecloth', variant: '60x90', qty: 1, fq: 1, ffl: '' }] }, extra || {});
const shipped = (id, day, co, extra) => shopOrder(id, Object.assign({ ff: 'fulfilled', shippedAt: day, trkCo: co, items: [{ sku: 'A', qty: 1, fq: 0, ffl: 'fulfilled' }] }, extra || {}));
test('shipped in the window, with MCF by carrier or by the MCF id the ERP kept', () => {
  const rep = rm.rmReport(db({ shop: { orders: [shipped('1', '2026-11-13', 'FedEx'), shipped('2', '2026-11-14', 'Amazon Logistics'), shipped('3', '2026-11-15', ''), shipped('4', '2026-11-11', 'DHL')] },
    meta: { 3: { mcfId: 'MCF-3' } } }), MON_17_NOV);
  eq(rep.ship.shop.shipped.map(s => [s.order.id, s.via]), [['1', 'FedEx'], ['2', 'MCF'], ['3', 'MCF']]);
  eq(rep.ship.shop.mcf.length, 2);
});
test('pending = not cancelled, not fully sent, something left; ready = pending and all its production handed over', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('SHP-10', 'A', 1, { shopOrderId: '10' }), b: order('SHP-11', 'A', 1, { shopOrderId: '11' }) },
    shopProd: { x: { orderNo: 'SHP-10', sku: 'A', handedAt: '2026-11-12T05:00:00Z' } },
    shop: { orders: [shopOrder('10'), shopOrder('11'), shopOrder('12', { cancelledAt: '2026-11-11' }), shopOrder('13', { items: [{ sku: 'A', qty: 1, fq: 0, rq: 1 }] }), shopOrder('14')] },
  }), MON_17_NOV);
  eq(rep.ship.shop.pending.map(s => s.order.id), ['10', '11', '14']);
  eq(rep.ship.shop.ready.map(s => s.order.id), ['10'], 'order 14 has no production line, so the ERP cannot say it is ready');
});
test('Amazon: shipped to FBA in the window, with the FBA team, and pieces of Amazon orders not sent yet', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('AMZ-1', 'A', 10) },
    fgi: { s: { _id: 's', txnType: 'FBA', sku: 'A', qty: 4, orderNo: 'AMZ-1', fbaShippedAt: '2026-11-13T05:00:00Z', fbaShipment: 'FBA1', createdAt: '2026-11-12T05:00:00Z' },
      w: { _id: 'w', txnType: 'FBA', sku: 'A', qty: 3, orderNo: 'AMZ-1', createdAt: '2026-11-14T05:00:00Z' } },
  }), MON_17_NOV);
  eq([rep.ship.amazon.shipped.length, rep.ship.amazon.ready.length, rep.ship.amazon.pending[0].qty], [1, 1, 3]);
  eq(rep.ship.amazon.lastShippedDay, '2026-11-13');
  assert.ok(!rm.rmMailHtml(rep).includes('no shipment has been marked'), 'a shipment marked in the window needs no warning');
});
test('the mail warns when the FBA team has marked no shipment since before the window', () => {
  const rep = rm.rmReport(db({ fgi: { s: { _id: 's', txnType: 'FBA', sku: 'A', qty: 4, fbaShippedAt: '2026-11-04T05:00:00Z', fbaShipment: 'FBA1' } } }), MON_17_NOV);
  assert.ok(rm.rmMailHtml(rep).includes('no shipment has been marked shipped since 04/11/2026'));
});
test('B2B: received into the store is ready, issued out in the window is shipped, the rest is pending', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('B2B-1', 'A', 10) },
    fgi: { r: { txnType: 'RECEIVE', sku: 'A', qty: 8, orderNo: 'B2B-1', createdAt: '2026-11-10T05:00:00Z' },
      i: { txnType: 'ISSUE', sku: 'A', qty: 5, orders: [{ orderNo: 'B2B-1', qty: 5 }], createdAt: '2026-11-14T05:00:00Z' } },
  }), MON_17_NOV);
  const o = rep.ship.other;
  eq([o.shipped[0].qty, o.ready[0].qty, o.pending[0].qty], [5, 3, 5]);
});

test('old FBA rows copied from the sheet and entries given back are neither ready nor sent', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('AMZ-1', 'A', 10) },
    fgi: { sheet: { txnType: 'FBA', sku: 'A', qty: 5, orderNo: 'AMZ-1', source: 'sheet import', createdAt: '2026-09-01T05:00:00Z' },
      back: { txnType: 'FBA', sku: 'A', qty: 4, orderNo: 'AMZ-1', fbaReturned: 4, fbaAcceptedAt: '2026-11-10T05:00:00Z', createdAt: '2026-11-09T05:00:00Z' },
      part: { txnType: 'FBA', sku: 'A', qty: 3, orderNo: 'AMZ-1', fbaReturned: 1, createdAt: '2026-11-09T05:00:00Z' } },
  }), MON_17_NOV);
  eq(rep.ship.amazon.ready.map(r => r.qty), [2], 'only the part entry, less the piece given back');
  eq(rep.ship.amazon.pending[0].qty, 8, '10 ordered, 2 really with FBA');
});
test('Amazon ready to dispatch is what waits for the FBA team to accept, as the ERP counts it — accepted entries are left out', () => {
  const rep = rm.rmReport(db({ fgi: {
    w: { txnType: 'FBA', sku: 'A', qty: 3, createdAt: '2026-11-14T05:00:00Z' },
    a: { txnType: 'FBA', sku: 'B', qty: 5, fbaAcceptedAt: '2026-11-14T06:00:00Z', createdAt: '2026-11-14T05:00:00Z' } } }), MON_17_NOV);
  eq(rep.ship.amazon.ready.map(r => r.sku), ['A']);
});
test('Shopify MCF typed in the app as "mcf" counts as MCF when Shopify names no carrier', () => {
  const rep = rm.rmReport(db({ shop: { orders: [shipped('5', '2026-11-13', '')] }, meta: { 5: { carrier: 'mcf' } } }), MON_17_NOV);
  eq(rep.ship.shop.mcf.length, 1);
  eq(rm.rmShipVia({ trkCo: 'Blue Dart' }, {}), 'Other');
});

console.log("the ERP's own list of open lines");
const erpList = (entries, at) => ({ v: 1, at: at || MON_17_NOV - 600e3, l: Object.fromEntries(entries.map(e => [e.no + '__' + e.sku, e])) });
const erpEntry = (no, sku, extra) => Object.assign({ no, sku, ch: no.split('-')[0], what: 'Tablecloth', qty: 10, pr: 0, fs: 0, due: '', st: 'cut' }, extra || {});
test('open and late come from the ERP\'s list: its due date, its pieces, and only the lines it lists', () => {
  const rep = rm.rmReport(db({
    ob: { a: order('AMZ-1', 'A', 10), b: order('AMZ-2', 'A', 10) },
    so: { s: salesOrder('AMZ-2', [{ sku: 'A', deliveryDate: '2026-11-01' }]) },
    alerts: erpList([erpEntry('AMZ-1', 'A', { due: '2026-11-10', qty: 12, pr: 2 })]),
  }), MON_17_NOV);
  eq(rep.prod.late.map(r => [r.line.orderNo, r.line.due, r.line.qty, r.line.pressed]), [['AMZ-1', '2026-11-10', 12, 2]], 'AMZ-2 is not in the ERP list, so it is closed');
  eq(rep.erpList.used, true);
  assert.ok(!rm.rmMailHtml(rep, {}).includes('worked out by this report'));
});
test('a line only the ERP lists still counts', () => {
  const rep = rm.rmReport(db({ alerts: erpList([erpEntry('B2B-5', 'Z', { due: '2026-11-02' })]) }), MON_17_NOV);
  eq(rep.prod.late.map(r => r.line.orderNo), ['B2B-5']);
});
test('an ERP list older than a day is not trusted: the report works lines out and the mail says so', () => {
  const rep = rm.rmReport(db({ ob: { a: order('AMZ-1', 'A', 10) }, so: { s: salesOrder('AMZ-1', [{ sku: 'A', deliveryDate: '2026-11-01' }]) },
    alerts: erpList([], MON_17_NOV - 3 * 864e5) }), MON_17_NOV);
  eq([rep.erpList.used, rep.prod.late.length], [false, 1]);
  assert.ok(rm.rmMailHtml(rep, {}).includes("The ERP&#39;s open-order list was last checked on 13/11/2026"));
});

console.log('records as the database keeps them');
test('a sales order known only by its key, with lines kept as an object, still gives priority and the earliest date', () => {
  const rep = rm.rmReport(db({ ob: { a: order('B2B-7', 'A', 10) },
    so: { 'B2B-7': { deliveryDate: '2026-11-20', lines: { x: { sku: 'A', priority: 'P1', deliveryDate: '2026-11-12' }, y: { sku: 'A', deliveryDate: '2026-11-14' } } } } }), MON_17_NOV);
  const l = line(rep, 'late', 'B2B-7').line;
  eq([l.priority, l.due], ['P1', '2026-11-12']);
});
test('a hand-over kept only under its ORDER__SKU key closes the Shopify line', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-10-01T05:00:00Z' }) },
    shopProd: { 'SHP-1__A': { handedAt: '2026-10-05T05:00:00Z' } } }), MON_17_NOV);
  eq(rep.prod.late.length, 0);
});
test('a Shopify row marked SHP counts its pieces, not its packs', () => {
  const rep = rm.rmReport(db({ ob: { a: order('X-1', 'A', 2, { src: 'SHP', pcs: 8, openedAt: '2026-11-13T05:00:00Z' }) } }), MON_17_NOV);
  eq(rep.prod.came[0].qty, 8);
});
test('the printer\'s print entry is work: a line printed 2 days ago is not stuck', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1) },
    shopProd: { x: { orderNo: 'SHP-1', sku: 'A', printer: 'VND001', assignedAt: '2026-11-01T05:00:00Z', printedAt: '2026-11-14T05:00:00Z' } } }), MON_17_NOV);
  eq([rep.prod.started.length, rep.prod.stuck.length], [1, 0]);
});
test('the data handed in is not changed', () => {
  const data = db({ ob: { a: order('SHP-1', 'A', 1) } });
  const before = JSON.stringify(data);
  rm.rmReport(data, MON_17_NOV);
  eq(JSON.stringify(data), before);
});

console.log('reading (Apps Script services faked)');
const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const withServices = answer => {
  const calls = [];
  const svc = loadReportMail(undefined, {
    UrlFetchApp: { fetchAll: reqs => { calls.push(reqs.map(r => r.url)); return reqs.map((r, i) => answer(r.url, calls.length, i)); } },
    Utilities: { sleep: () => {} },
    ScriptApp: { getOAuthToken: () => 'token' },
  });
  return { svc, calls };
};
test('the database is read node by node, a busy answer retried', () => {
  const { svc, calls } = withServices((url, round) => (round === 1 && /pt_cuttingData/.test(url) ? reply(503, 'busy') : reply(200, { k: { orderNo: 'X' } })));
  const d = svc.rmReadDatabase_();
  eq([Object.keys(d).length, calls.length, calls[1].length], [8, 2, 1], 'second round asks only for the busy node');
});
test('a refused database read stops the report, naming the node', () => {
  const { svc } = withServices(url => (/pt_orderBook/.test(url) ? reply(401, 'Permission denied') : reply(200, {})));
  assert.throws(() => svc.rmReadDatabase_(), /pt_orderBook answered 401/);
});
test('a network failure is tried again, and thrown after the last try', () => {
  let n = 0;
  const svc = loadReportMail(undefined, {
    UrlFetchApp: { fetchAll: () => { n++; throw new Error('DNS error'); } }, Utilities: { sleep: () => {} }, ScriptApp: { getOAuthToken: () => 't' },
  });
  assert.throws(() => svc.rmReadDatabase_(), /DNS error/);
  eq(n, 3);
});
/** A script whose Firestore holds `config` as config/api, and whose Pricing script answers every ask with one open order. */
const withPricing = config => {
  const asked = [];
  const firestore = url => (/config\/api$/.test(url) && config ? reply(200, { fields: config }) : reply(404, 'not found'));
  const svc = loadReportMail(undefined, {
    UrlFetchApp: { fetch: firestore, fetchAll: reqs => reqs.map(r => { asked.push(r.url); return reply(200, { orders: [{ id: '7', ff: 'unfulfilled' }] }); }) },
    Utilities: { sleep: () => {} }, ScriptApp: { getOAuthToken: () => 'token' }, console: { log() {}, warn() {} },
  });
  return { svc, asked };
};
test('only real web addresses are asked for as photos — "#VALUE!" from an Excel sheet is left out', () => {
  eq(['https://x/cdn/shop/a.jpg', 'http://x/b.png', '#VALUE!', 'http://#VALUE!', '', 'x/c.jpg'].map(rm.rmIsPhotoUrl), [true, true, false, false, false, false]);
});
test('Shopify is read like the Reports tab: the Pricing address and key come from Firestore config/api, nobody types them', () => {
  const { svc, asked } = withPricing({ url: { stringValue: 'https://pricing.example/exec' }, key: { stringValue: 'k1' } });
  const shop = svc.rmReadShopify_(MON_17_NOV, '2026-11-12');
  eq([shop.err, shop.orders.length, asked.length], ['', 2, 4], 'both stores, open and since the first day');
  assert.ok(asked.every(u => u.startsWith('https://pricing.example/exec?key=k1&shopify=orders&nophoto=1')));
  assert.ok(asked.some(u => u.includes('&shop=CPC')));
});
test('when config/api cannot be read, the mail says Shopify is missing and asks the Pricing script nothing', () => {
  const none = withPricing(null);
  const shop = none.svc.rmReadShopify_(MON_17_NOV, '2026-11-12');
  assert.ok(/Reports tab's Shopify address could not be read \(config\/api answered 404\)/.test(shop.err), shop.err);
  eq(none.asked.length, 0);
  const noKey = withPricing({ url: { stringValue: 'https://pricing.example/exec' } }).svc.rmReadShopify_(MON_17_NOV, '2026-11-12');
  assert.ok(/config\/api has no key/.test(noKey.err), noKey.err);
});
test('Shopify answers are merged per store, a web page is named, voided orders dropped', () => {
  const { svc } = withServices(() => reply(200, {}));
  const m = svc.rmMergeShopify([
    { brand: 'SP', text: JSON.stringify({ orders: [{ id: '1', ff: 'unfulfilled' }] }) },
    { brand: 'SP', text: JSON.stringify({ orders: [{ id: '1', ff: 'fulfilled' }, { id: '2', gone: 'voided' }] }) },
    { brand: 'CPC', text: '<html>Sign in</html>' },
  ]);
  eq([m.orders.length, m.orders[0].ff, m.orders[0].shopBrand], [1, 'fulfilled', 'SP']);
  assert.ok(/Shopify CPC: answered with a web page/.test(m.err));
});

console.log('mail and PDFs');
test('counts are orders, split by channel', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-13T05:00:00Z' }), b: order('SHP-1', 'B', 2, { openedAt: '2026-11-13T05:00:00Z' }),
    c: order('B2B-9', 'A', 3, { uploadedAt: '2026-11-14T05:00:00Z' }) } }), MON_17_NOV);
  const c = rm.rmCount(rep.prod.came, rm.rmLineChannel);
  eq([c.orders, c.lines, c.pcs], [2, 3, 6]);
  eq(c.byChannel.map(b => b.channel + ' ' + b.orders), ['B2B 1', 'Shopify 1'], 'most orders first, then by name');
});
test('"No" in personalization is shown blank, a real request is kept', () => {
  eq([rm.rmPersonal('No'), rm.rmPersonal('NO'), rm.rmPersonal(''), rm.rmPersonal('Embroidery - THE GEES')], ['', '', '', 'Embroidery - THE GEES']);
});
test('text typed by people goes into the PDF as text, never as HTML', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { color: '<b>Red</b>', customization: '<script>x</script>' }) } }), MON_17_NOV);
  const html = rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), () => '');
  assert.ok(html.includes('&lt;b&gt;Red&lt;/b&gt;') && !html.includes('<script>x'));
});
test('the PDF has Ravi\'s columns, a late row in red and a section count', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-02T05:00:00Z', shopImg: 'https://x/cdn/shop/a.jpg' }) } }), MON_17_NOV);
  const html = rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), u => u + '#small');
  ['Colour name', 'Personalization', 'Dispatch date', 'Production status', 'Priority', '<b>Late</b><span>1 SKUs · 1 items</span>', '#fde2e1', 'a.jpg#small'].forEach(t => assert.ok(html.includes(t), 'missing ' + t));
});
test('complete lines are green in the PDF: handed over, and shipped', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-2', 'A', 2) }, shopProd: { y: { orderNo: 'SHP-2', sku: 'A', handedAt: '2026-11-14T05:00:00Z' } },
    shop: { orders: [shipped('1', '2026-11-13', 'FedEx')] } }), MON_17_NOV);
  eq(rm.rmProductionSections(rep)[4].rows.map(r => r.tone), ['done']);
  eq(rm.rmShippingSections(rep)[0].rows.map(r => r.tone), ['done']);
  assert.ok(rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), () => '').includes('background:#e3f4e4'));
});
test('the PDF cover sums each section by channel and SKUs, and each SKU is one row with its total and every order', () => {
  const rep = rm.rmReport(db({ ob: { a: order('B2B-1', 'A', 1), b: order('AMZ-1', 'A', 1), c: order('AMZ-2', 'A', 1) },
    so: { a: salesOrder('B2B-1', [{ sku: 'A', deliveryDate: '2026-11-01' }]), b: salesOrder('AMZ-1', [{ sku: 'A', deliveryDate: '2026-11-01' }]), c: salesOrder('AMZ-2', [{ sku: 'A', deliveryDate: '2026-11-01' }]) } }), MON_17_NOV);
  const html = rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), () => '');
  ['<div class="cap">Summary</div>', '<td><a href="#s2">Late</a></td><td>2</td><td>1</td><td class="tot">1</td><td class="tot">3</td>', '<th>Amazon</th><th>B2B</th><th>SKUs</th>', '<td><b>A</b></td>', '<td class="num">3</td>', '<td>3: <a href=', '<div class="sec" id="s2">', 'Production Report', 'Colour key']
    .forEach(t => assert.ok(html.includes(t), 'missing ' + t));
});
test('each order number opens that order in the ERP; a Shopify order production never made has no link', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-7', 'A', 1, { shopOrderId: '7', shopOrderNo: '#7441', openedAt: '2026-11-13T05:00:00Z' }) },
    shop: { orders: [shopOrder('7', { no: '#7441' }), shopOrder('8', { no: '#7442' })] } }), MON_17_NOV);
  const prod = rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), () => '');
  assert.ok(prod.includes('<a href="https://fabricrush-replenish.web.app/#ord?q=SHP-7">Shopify · #7441</a>'));
  const ship = rm.rmPdfHtml('Shipping', rep, rm.rmShippingSections(rep), () => '');
  assert.ok(ship.includes('#ord?q=SHP-7"') && !ship.includes('#ord?q=%237442') && ship.includes(', Shopify Ridhi · #7442</td>'));
});
test('one row per SKU takes the most urgent colour and priority, the earliest dates, and counts the stages', () => {
  const g = rm.rmSkuGroups([
    { sku: 'A', tone: 'done', pcs: 2, order: 'B2B-1', cells: ['Red', '60x60', '2', '', null, 'A', 'In 15/11/2026', 'B2B · B2B-1', '10/11/2026', '20/11/2026', 'Handed to shipping', 'P3'] },
    { sku: 'A', tone: 'late', pcs: 3, order: 'B2B-2', cells: ['Red', '60x60', '3', 'Monogram', null, 'A', 'Late 4 days', 'B2B · B2B-2', '01/11/2026', '13/11/2026', 'Not started', 'P1'] },
    { sku: 'A', tone: '', pcs: 1, order: '', cells: ['Red', '60x60', '1', '', null, 'A', 'Pending', 'Shop · #9', '05/11/2026', '', 'Not started', ''] },
  ])[0];
  const row = rm.rmPdfSkuRow(g, () => '');
  ['background:#fde2e1', '<td class="num">6</td>', '<td>Monogram</td>', '<td>3: ', '#ord?q=B2B-2', 'Shop · #9</td>', '<td>01/11/2026</td><td>13/11/2026</td>', '<td>Not started 2, Handed to shipping 1</td><td>P1</td>']
    .forEach(t => assert.ok(row.includes(t), 'missing ' + t));
  assert.ok(rm.rmPdfSkuRow(Object.assign({}, g, { rows: [g.rows[0]] }), () => '').includes('background:#e3f4e4'), 'green only when every line is complete');
});
test('a SKU shows its photo once, on its heading row, not on every line', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-1', 'A', 1, { openedAt: '2026-11-13T05:00:00Z', shopImg: 'https://x/a.jpg' }), b: order('SHP-2', 'A', 1, { openedAt: '2026-11-13T05:00:00Z', shopImg: 'https://x/a.jpg' }) } }), MON_17_NOV);
  const html = rm.rmPdfHtml('Production', rep, [rm.rmProductionSections(rep)[0]], u => u);
  eq(html.split('src="https://x/a.jpg"').length - 1, 1);
});
test('Shipping PDF: a pending Shopify order is red when its production line is late, plain when production has none', () => {
  const rep = rm.rmReport(db({ ob: { a: order('SHP-7', 'A', 1, { shopOrderId: '7', openedAt: '2026-11-02T05:00:00Z' }) },
    shop: { orders: [shopOrder('7'), shopOrder('8')] } }), MON_17_NOV);
  const pending = rm.rmShippingSections(rep)[2];
  eq(pending.rows.map(r => [r.group, r.tone]), [['Shopify Ridhi', 'late'], ['Shopify Ridhi', '']]);
  const html = rm.rmPdfHtml('Shipping', rep, rm.rmShippingSections(rep), () => '');
  ['<div class="cap">Summary</div>', '<td><a href="#s2">Pending</a></td>', '<td><b>A</b></td>', '<td class="num">2</td>', '#ord?q=SHP-7'].forEach(t => assert.ok(html.includes(t), 'missing ' + t));
});
test('the mail links both PDFs in Drive, and says when one was not saved', () => {
  const rep = rm.rmReport(db({}), MON_17_NOV);
  const html = rm.rmMailHtml(rep, { Production: 'https://drive.google.com/file/d/P/view' });
  assert.ok(/<a href="https:\/\/drive\.google\.com\/file\/d\/P\/view"[^>]*>Production PDF<\/a>/.test(html));
  assert.ok(html.includes('<b>Shipping PDF</b> (not saved)'));
});
/** The text of each cell of one table row, tags taken out: ['Late (past the decided date)', '1', …]. */
const cellsOf = rowHtml => rowHtml.split('</td>').slice(0, -1).map(c => c.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').trim());
test('the mail looks like the Printer Delay Notice: navy heading, the day and period, a table per section, the sign-off', () => {
  const rep = rm.rmReport(db({}), MON_17_NOV);
  const html = rm.rmMailHtml(rep, {});
  ['FABRICRUSH · RIDHI HOME &amp; LIVING', 'Company Report', 'background:#1f3b63', 'as of Monday 16 Nov 2026', 'Counted since the last report: <b>12 Nov – 15 Nov</b>',
    '>Production</td>', '>Shipping</td>', '>Heading</th>', '>Orders</th>', '>Items</th>', '>By channel</th>', 'Regards,', 'sent every Monday and Thursday']
    .forEach(t => assert.ok(html.includes(t), 'missing ' + t));
  eq(rm.rmMailSubject(rep), 'Company report · Monday 16 Nov 2026');
});
test('a heading row gives orders, lines, pieces, the channels and how it is counted; late is in red', () => {
  const rep = rm.rmReport(db({ ob: { a: order('B2B-1', 'A', 7) }, so: { s: salesOrder('B2B-1', [{ sku: 'A', deliveryDate: '2026-11-02' }]) } }), MON_17_NOV);
  const row = rm.rmMailRow(rm.rmMailHeadings(rep).prod[2]);
  eq(cellsOf(row), ['Late (past the decided date)', '1', '1', '7', 'B2B 1', 'today']);
  assert.ok(row.includes('color:#b3261e'));
});
test('when Shopify was not read, MCF has no number and the other shipping rows say Shopify is missing — never a bare 0', () => {
  const rep = rm.rmReport(db({ shop: { orders: [], err: 'timeout' } }), MON_17_NOV);
  const h = rm.rmMailHeadings(rep).ship;
  eq(h.map(x => x.missing), ['part', 'all', 'all', 'part', 'part']);
  eq(cellsOf(rm.rmMailRow(h[1])), ['Shipped by MCF', '–', '–', '–', 'not known: Shopify could not be read', 'since last report']);
  assert.ok(cellsOf(rm.rmMailRow(h[0]))[4].endsWith('+ Shopify not read'));
  const ok = rm.rmReport(db({ shop: { orders: [shipped('1', '2026-11-13', 'FedEx')] } }), MON_17_NOV);
  eq(rm.rmMailHeadings(ok).ship.map(x => x.missing), ['', '', '', '', '']);
});
test('late also says how many lines are due today or tomorrow, like the red strip', () => {
  const rep = rm.rmReport(db({ alerts: erpList([erpEntry('B2B-1', 'A', { due: '2026-11-10' }), erpEntry('B2B-2', 'A', { due: '2026-11-16' }), erpEntry('B2B-3', 'A', { due: '2026-11-17' }), erpEntry('B2B-4', 'A', { due: '2026-11-18' })]) }), MON_17_NOV);
  eq(cellsOf(rm.rmMailRow(rm.rmMailHeadings(rep).prod[2]))[0], 'Late (past the decided date) + 2 items due today / tomorrow');
});
test('still in production gives the open lines and the pieces they still owe, like the red strip', () => {
  const rep = rm.rmReport(db({ alerts: erpList([erpEntry('AMZ-1', 'A', { qty: 10, pr: 4 }), erpEntry('SHP-2', 'B', { qty: 1 })]) }), MON_17_NOV);
  eq(cellsOf(rm.rmMailRow(rm.rmMailHeadings(rep).prod[5])), ['Still in production', '–', '2', '7', 'Amazon 1 · Shopify 1', 'today']);
});
test('the carriers other than MCF are named in one row', () => {
  const rep = rm.rmReport(db({ shop: { orders: [shipped('1', '2026-11-13', 'FedEx'), shipped('2', '2026-11-13', 'DHL Express'), shipped('3', '2026-11-14', 'DHL'), shipped('4', '2026-11-14', 'Amazon')] } }), MON_17_NOV);
  eq(cellsOf(rm.rmMailRow(rm.rmMailHeadings(rep).ship[2]))[4], 'DHL 2 · FedEx 1');
});
test('with nothing to flag there are no notes; a PDF not shared is flagged', () => {
  const rep = rm.rmReport(db({ fgi: { s: { txnType: 'FBA', sku: 'A', qty: 1, fbaShippedAt: '2026-11-13T05:00:00Z' } }, alerts: erpList([]) }), MON_17_NOV);
  eq(rm.rmMailNotes(rep, {}), []);
  assert.ok(!rm.rmMailHtml(rep, {}).includes('Please note'));
  assert.ok(rm.rmMailNotes(rep, { err: 'Could not share the reports folder with x@y.com' })[0].includes('x@y.com'));
});
test('the mail says when Shopify could not be read', () => {
  const rep = rm.rmReport(db({ shop: { orders: [], err: 'Shopify Ridhi: timeout' } }), MON_17_NOV);
  assert.ok(rm.rmMailHtml(rep).includes('Shopify could not be read: Shopify Ridhi: timeout'));
});

console.log('printer late alert');
const TODAY = '2026-11-17';
const printLine = (extra) => Object.assign({ sku: 'RTC1-6060', color: 'Red', articleSubtype: 'Square Tablecloth', qty: 10 }, extra || {});
const vendorOrder = (lines, extra) => Object.assign({ orderNo: 'VO-1', status: 'Placed', lines }, extra || {});
const lateOf = vo => rm.plLateLines(vo, TODAY);
test('a printer line 5 days late is listed; 4 days late is not yet (the groups start at 5–7 days)', () => {
  const vo = { VND001: { a: vendorOrder([printLine({ deliveryDate: '2026-11-12' }), printLine({ sku: 'B', deliveryDate: '2026-11-13' })]) } };
  eq(lateOf(vo).map(l => [l.sku, l.days, l.withPrinter]), [['RTC1-6060', 5, 10]]);
});
test('the printer\'s own promised date wins over the date we asked for', () => {
  eq(lateOf({ V: { a: vendorOrder([printLine({ deliveryDate: '2026-11-01', vendorDate: '2026-11-16' })]) } }).length, 0);
});
test('what came back is taken off; a line fully delivered is not late', () => {
  const vo = { V: { a: vendorOrder([
    printLine({ deliveryDate: '2026-11-10', deliveries: [{ qty: 4 }, { qty: 9, ok: { qty: 3 } }, { qty: 5, no: 'never came' }] }),
    printLine({ sku: 'D', deliveryDate: '2026-11-10', deliveries: [{ qty: 10, ok: { qty: 10 } }] })]) } };
  eq(lateOf(vo).map(l => [l.sku, l.withPrinter]), [['RTC1-6060', 3]], '10 − 4 claimed − 3 accepted (the 9 claimed counts as 3) − 0 never came');
});
test('a PPC line whose cloth we have not given is waiting for us, not late; given cloth is with the printer', () => {
  const flow = (given, back) => ({ flowProg: { given, back, items: { PO1: { given, back } } } });
  eq(lateOf({ V: { a: vendorOrder([printLine({ deliveryDate: '2026-11-01', parts: ['PO1'] })], flow(0, 0)) } }).length, 0);
  eq(lateOf({ V: { a: vendorOrder([printLine({ deliveryDate: '2026-11-01', parts: ['PO1'] })], flow(8, 2)) } }).map(l => l.withPrinter), [6]);
});
test('received, cancelled and draft orders, and cancelled lines, are left out', () => {
  const late = printLine({ deliveryDate: '2026-11-01' });
  const vo = { V: { a: vendorOrder([late], { status: 'Received' }), b: vendorOrder([late], { status: 'Draft' }), c: vendorOrder([late], { cancelled: true }),
    d: vendorOrder([Object.assign({}, late, { cancelled: true })]) } };
  eq(lateOf(vo).length, 0);
});
test('a running order counts metres', () => {
  eq(lateOf({ V: { a: vendorOrder([{ fabricType: 'Cambric', meters: 120, deliveryDate: '2026-11-01' }], { orderType: 'running' }) } }).map(l => [l.withPrinter, l.unit, l.what]), [[120, 'm', 'Cambric']]);
});
test('one mail for all printers, named from the vendor master, with cloth, designs and since when, no line list', () => {
  const vo = { VND001: { a: vendorOrder([printLine({ deliveryDate: '2026-11-01' })]) }, VND002: { b: vendorOrder([printLine({ deliveryDate: '2026-11-01' }), printLine({ sku: 'X', deliveryDate: '2026-11-05' })], { orderNo: 'VO-9' }) } };
  const groups = rm.plByPrinter(lateOf(vo), rm.plNames({ a: { code: 'VND002', desc: 'Bagru Prints' } }, { VND001: { name: 'Old Name' } }));
  eq(groups.map(g => [g.name, g.lines.length]), [['Bagru Prints', 2], ['Old Name', 1]]);
  eq(rm.plMailSubject(groups, TODAY), 'Printer delays: 2 printers 5+ days late · 17 Nov');
  const html = rm.plMailHtml(groups, TODAY);
  ['Printer Delay Notice', '2 printers holding cloth 5 or more days', 'Bagru Prints</a>', 'VND002', 'Summary</th>', '15–21 days late</td>', 'Red<br><b>10 pcs</b>', 'Regards,']
    .forEach(t => assert.ok(html.includes(t), 'missing ' + t));
  assert.ok(!html.includes('RTC1-6060') && !html.includes('VO-9'), 'no line list in the mail');
});
test('the designs pending are named, the one with most cloth first, the rest counted', () => {
  const lines = ['Azure', 'Jade', 'Poppy', 'Coral', 'Sand', 'Mint', 'Plum', 'Rust'].map((c, i) => ({ code: 'V', orderNo: 'VO-1', color: c, withPrinter: 10 - i, unit: 'pcs', due: '2026-11-01', days: 16 }));
  lines.push({ code: 'V', orderNo: 'VO-1', color: '', what: 'Cambric', withPrinter: 1, unit: 'm', due: '2026-11-01', days: 16 });
  const d = rm.plDesigns({ lines });
  eq([d.total, rm.plDesignsTxt(d)], [9, 'Azure, Jade, Poppy, Coral, Sand, Mint and 3 more']);
});
test('pieces and metres are given apart, never added together', () => {
  const vo = { V: { a: vendorOrder([printLine({ deliveryDate: '2026-11-10', qty: 5 })], { orderNo: 'VO-1' }),
    b: vendorOrder([{ fabricType: 'Cambric', meters: 175.5, deliveryDate: '2026-11-01' }], { orderType: 'running', orderNo: 'VO-2' }) } };
  const g = rm.plByPrinter(lateOf(vo), {})[0];
  const h = rm.plMailHtml([g], TODAY);
  assert.ok(h.includes('Red<br><b>5 pcs</b>') && h.includes('Cambric<br><b>175.5 m</b>'), 'each in its own delay group, pcs and m apart');
  eq(rm.plPending(g).since, '2026-11-01');
  assert.ok(h.includes('1 printer holding') && rm.plMailSubject([g], TODAY) === 'Printer delays: 1 printer 5+ days late · 17 Nov');
});
test('each printer\'s name links to its late orders on the Vendor Portal', () => {
  const a = { code: 'VND004', name: 'A R', lines: [{ orderNo: '1', color: 'Red', withPrinter: 9, unit: 'pcs', due: '2026-11-10', days: 7 }] };
  const h = rm.plMailHtml([a], TODAY);
  assert.ok(h.includes('<a href="https://fabricrush-replenish.web.app/#vend?printer=VND004&amp;late=1"'), 'link to the printer portal, late only');
  assert.ok(h.includes('Click a printer'));
});
test('the delay groups: 5–7, 8–14, 15–21 (day 21 too), 22 and over; under 5 days is none', () => {
  eq([4, 5, 7, 8, 14, 15, 21, 22, 90].map(d => (rm.plGroupOf(d) || { label: '-' }).label), ['-', '5–7 days', '5–7 days', '8–14 days', '8–14 days', '15–21 days', '15–21 days', '22+ days', '22+ days']);
});
test('each printer row puts its designs under how late they are, with a dash where it has none', () => {
  const g = { code: 'V', name: 'Vee', lines: [
    { orderNo: '1', color: 'Azure', withPrinter: 10, unit: 'pcs', due: '2026-11-11', days: 6 },
    { orderNo: '2', color: 'Jade', withPrinter: 4, unit: 'pcs', due: '2026-10-20', days: 28 },
    { orderNo: '3', color: 'Poppy', withPrinter: 2, unit: 'pcs', due: '2026-10-21', days: 27 }] };
  const cells = rm.plByGroup(g).map(x => rm.plGroupCell(x));
  eq(cells.map(c => c.includes('–</td>')), [false, true, true, false]);
  assert.ok(cells[0].includes('Azure<br><b>10 pcs</b>') && cells[3].includes('Jade, Poppy<br><b>6 pcs</b>'));
});
test('the summary counts printers, designs and cloth in each delay group', () => {
  const a = { code: 'A', name: 'A', lines: [{ orderNo: '1', color: 'Red', withPrinter: 5, unit: 'pcs', due: '', days: 6 }, { orderNo: '1', color: 'Jade', withPrinter: 2, unit: 'm', due: '', days: 30 }] };
  const b = { code: 'B', name: 'B', lines: [{ orderNo: '2', color: 'Red', withPrinter: 1, unit: 'pcs', due: '', days: 7 }] };
  eq(rm.plSummary([a, b]).map(s => [s.group.label, s.printers, s.designs, rm.plCloth(s.cloth)]),
    [['5–7 days', 2, 2, '6 pcs'], ['8–14 days', 0, 0, ''], ['15–21 days', 0, 0, ''], ['22+ days', 1, 1, '2 m']]);
});
test('the worst delays come first, in the summary and in the printer table', () => {
  const g = { code: 'V', name: 'Vee', phone: '', lines: [{ orderNo: '1', color: 'Azure', withPrinter: 10, unit: 'pcs', due: '', days: 6 }, { orderNo: '2', color: 'Jade', withPrinter: 4, unit: 'pcs', due: '', days: 28 }] };
  const h = rm.plMailHtml([g], TODAY);
  const at = t => h.indexOf(t);
  assert.ok(at('22+ days late</td>') < at('15–21 days late</td>') && at('8–14 days late</td>') < at('5–7 days late</td>'), 'summary worst first');
  assert.ok(at('>22+ days</th>') < at('>15–21 days</th>') && at('>8–14 days</th>') < at('>5–7 days</th>'), 'printer table worst first');
  assert.ok(at('Jade<br>') < at('Azure<br>'), 'the 22+ designs before the 5–7 ones');
});
test('each printer shows its total — oldest delay and all its late cloth — and its phone when the vendor list has one', () => {
  const g = { code: 'V', name: 'Vee', phone: '9800000001', lines: [{ orderNo: '1', color: 'Azure', withPrinter: 10, unit: 'pcs', due: '', days: 6 }, { orderNo: '2', color: 'Jade', withPrinter: 40, unit: 'm', due: '', days: 28 }] };
  const h = rm.plMailHtml([g], TODAY);
  assert.ok(h.includes('>28 days</b> oldest<br><b>10 pcs + 40 m</b>') && h.includes('>Phone 9800000001</span>'));
  assert.ok(!rm.plMailHtml([Object.assign({}, g, { phone: '' })], TODAY).includes('Phone '), 'no phone line without a phone');
  eq(rm.plPhones({ a: { code: 'V', phone: '9800000001' } }, { V: { phone: '9811111111' }, W: { phone: '9822222222' } }), { V: '9800000001', W: '9822222222' });
  eq(rm.plByPrinter([{ code: 'V', orderNo: '1', days: 6 }], { V: 'Vee' }, { V: '98' })[0].phone, '98');
});test('the most late printer is the first row', () => {
  const a = { code: 'A', name: 'Alpha', lines: [{ orderNo: '1', color: 'Red', withPrinter: 9, unit: 'pcs', due: '2026-11-10', days: 7 }] };
  const b = { code: 'B', name: 'Beta', lines: [{ orderNo: '2', color: 'Jade', withPrinter: 1, unit: 'pcs', due: '2026-11-01', days: 16 }] };
  const h = rm.plMailHtml([a, b], TODAY);
  assert.ok(h.indexOf('Beta') < h.indexOf('Alpha'));
});

test('the printer notice timer is Tuesday and Friday at 10 am only, and the old daily timer goes', () => {
  const made = [], removed = [];
  const builder = { handler: '', days: [], timeBased() { return this; }, onWeekDay(d) { this.days.push(d); return this; },
    everyDays() { this.days.push('EVERY DAY'); return this; }, atHour(h) { this.hour = h; return this; }, nearMinute() { return this; },
    inTimezone(z) { this.zone = z; return this; }, create() { made.push({ day: this.days.pop(), hour: this.hour, zone: this.zone }); } };
  const oldDaily = { getHandlerFunction: () => 'sendPrinterAlerts' }, report = { getHandlerFunction: () => 'sendErpReport' };
  const ScriptApp = { WeekDay: { TUESDAY: 'TUE', THURSDAY: 'THU', FRIDAY: 'FRI' }, getProjectTriggers: () => [oldDaily, report],
    deleteTrigger: t => removed.push(t), newTrigger: () => builder };
  const m = loadReportMail(null, { ScriptApp, console: { log() {} } });
  m.installPrinterAlertTimer();
  eq(made, [{ day: 'TUE', hour: 10, zone: 'Asia/Kolkata' }, { day: 'FRI', hour: 10, zone: 'Asia/Kolkata' }]);
  assert.ok(removed.length === 1 && removed[0] === oldDaily, 'only the printer timer is removed, not the report timer');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
