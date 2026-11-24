/* Reimbursement (src/app/reimb/): the engine (reimb-core.js) over small hand-made accounts and over the sample (reimb-sample.js),
 * and the wiring around the Overview page (the pane's ids, ORDER, the tab, the Access card, the Firestore rule).
 *   node tests/reimb-test.js
 * Covers: the status at every edge (14 / 15 days after delivery, the deadline day, the day after, not closed); Owed now leaves
 * out wait / in a case / expired / archived; the 14-day boundary of Expiring; Recovered split by case ID with the arrow against
 * the period before; Lost to deadlines in the period; the value with a sourcing cost, a landed cost only and no cost (never in
 * the $); underpaid on the sourcing cost only; a reversal with and without a 'found' near it; the duplicate guard (in a case,
 * paid, archived); the order of the action list; the brand; the chart's month sums against Recovered for the same months; the
 * sample's own story; the CSV; the case text; and that the engine and the sample never read the clock. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); } };
const APP = path.join(__dirname, '..', 'src', 'app');
const read = p => fs.readFileSync(path.join(APP, p), 'utf8');
const CORE = read('reimb/reimb-core.js'), SAMPLE = read('reimb/reimb-sample.js'), DATA = read('reimb/reimb-data.js'), PAGE = read('reimb/reimb-overview.js');
const C = new Function(CORE + '\n' + SAMPLE + '\nreturn { RB, RB_DAY, RB_LINKS, rbDay, rbIso, rbValue, rbDaysLeft, rbItems, rbStatus, rbDupCheck, rbPeriod, rbOverview,'
  + ' rbWeekList, rbChart, rbMostLost, rbCaseText, rbDaysPill, rbPctClass, rbCsvLines, rbKey, rbSampleData, RB_SAMPLE_TODAY,'
  + ' rbFmt, rbParseReport, rbParseTable, rbParseDate, rbMerge, rbRowKey, rbHead, rbBelowLanded, rbHasSourcing };')();
const D = C.RB_DAY, TODAY = '2026-11-24', t0 = C.rbDay(TODAY);
const ago = n => C.rbIso(t0 - n * D);

// A small account: shipments [id, brand, status, days since delivery, [[asin, shipped, received], …]], payouts, ledger, costs.
const COSTS = { A1: { sourcing: 5, landed: 7 }, A2: { sourcing: null, landed: 8 }, A3: { sourcing: null, landed: null }, A4: { sourcing: 10, landed: 12 } };
const fn = a => 'F' + a, sku = a => 'S-' + a;
const ship = (id, brand, status, d, items) => ({ brand, shipmentId: id, name: id, status, deliveredAt: ago(d), closedAt: status === 'CLOSED' ? ago(d) : null,
  items: items.map(([a, s, r]) => ({ sku: sku(a), asin: a, fnsku: fn(a), title: 'Title ' + a, shipped: s, received: r })) });
const pay = (id, brand, d, a, reason, units, amount, caseId, orig) => ({ brand, date: ago(d), reimbId: id, caseId: caseId || null, orderId: null, sku: sku(a), asin: a,
  fnsku: fn(a), title: 'Title ' + a, reason, cashUnits: units, invUnits: 0, amount, original: orig ? { reimbId: orig } : null });
const acct = o => Object.assign({ sample: false, asOf: TODAY, inbound: [], payouts: [], ledger: [], costs: COSTS }, o);
const byKey = (items, k) => items.find(i => i.itemKey === k);

console.log('== the status at every edge ==');
{
  const d = acct({ inbound: [ship('W14', 'SP', 'CLOSED', 14, [['A1', 10, 8]]), ship('C15', 'SP', 'CLOSED', 15, [['A1', 10, 8]]),
    ship('L60', 'SP', 'CLOSED', 60, [['A1', 10, 8]]), ship('E61', 'SP', 'CLOSED', 61, [['A1', 10, 8]]), ship('R20', 'SP', 'RECEIVING', 20, [['A1', 10, 8]]),
    ship('R70', 'SP', 'RECEIVING', 70, [['A1', 10, 8]]), ship('FULL', 'SP', 'CLOSED', 30, [['A1', 10, 10]])] });
  const it = C.rbItems(d, null, TODAY);
  ok('day 14 after delivery: Wait (Amazon may still be counting)', byKey(it, 'W14').status === 'wait' && byKey(it, 'W14').opensIn === 1);
  ok('day 15: Claim now', byKey(it, 'C15').status === 'claim' && byKey(it, 'C15').daysLeft === 45);
  ok('the deadline day itself (60 days after delivery): still Claim now, 0 days left, "last day"', byKey(it, 'L60').status === 'claim' && byKey(it, 'L60').daysLeft === 0
    && C.rbDaysPill(byKey(it, 'L60')).t === 'last day');
  ok('one day after the deadline: Expired', byKey(it, 'E61').status === 'expired' && byKey(it, 'E61').daysLeft === -1);
  ok('not closed: Wait, "opens when closed"', byKey(it, 'R20').status === 'wait' && C.rbDaysPill(byKey(it, 'R20')).t === 'opens when closed');
  ok('not closed but past the deadline: Expired wins over Wait', byKey(it, 'R70').status === 'expired');
  ok('nothing missing: no item at all', !byKey(it, 'FULL'));
  const u = C.rbItems(acct({ payouts: [pay('P90', 'SP', 90, 'A1', 'Lost_Warehouse', 2, 6), pay('P91', 'SP', 91, 'A1', 'Lost_Warehouse', 2, 6)] }), null, TODAY);
  ok('underpaid: the re-check window\'s last day is open (90 days), the day after expired', byKey(u, 'P90').status === 'claim' && byKey(u, 'P90').daysLeft === 0 && byKey(u, 'P91').status === 'expired');
}

console.log('== the boxes ==');
{
  const d = acct({ inbound: [ship('CL', 'SP', 'CLOSED', 50, [['A1', 10, 6]]), ship('WT', 'SP', 'CLOSED', 5, [['A1', 10, 6]]), ship('IC', 'SP', 'CLOSED', 40, [['A1', 10, 6]]),
    ship('EX', 'SP', 'CLOSED', 65, [['A1', 10, 6]]), ship('AR', 'SP', 'CLOSED', 30, [['A1', 10, 6]]), ship('CPC1', 'CPC', 'CLOSED', 30, [['A4', 3, 1]])] });
  const recs = new Map([[C.rbKey('SP', 'inbound', 'IC'), { status: 'in_case', caseId: '111', estimate: 20, brand: 'SP' }],
    [C.rbKey('SP', 'inbound', 'AR'), { status: 'archived', reason: 'Too small to claim', brand: 'SP' }]]);
  const it = C.rbItems(d, recs, TODAY);
  const P = C.rbPeriod('30', TODAY);
  const o = C.rbOverview(it, d, recs, P, TODAY, 'SP');
  ok('Owed now: only Claim now (wait, in a case, expired and archived left out)', o.owed.n === 1 && o.owed.v === 20, JSON.stringify(o.owed));
  ok('…the brand filter: Cotton Print Club alone', C.rbOverview(it, d, recs, P, TODAY, 'CPC').owed.v === 20 && C.rbOverview(it, d, recs, P, TODAY, 'ALL').owed.n === 2);
  ok('Open cases: the in-case record, with its estimate', o.open.n === 1 && o.open.v === 20 && !o.open.many);
  const e = C.rbItems(acct({ inbound: [ship('L14', 'SP', 'CLOSED', 46, [['A1', 2, 1]]), ship('L15', 'SP', 'CLOSED', 45, [['A1', 2, 1]])] }), null, TODAY);
  const oe = C.rbOverview(e, acct({}), null, P, TODAY, 'ALL');
  ok('Expiring in 14 days: 14 days left is in, 15 is not', byKey(e, 'L14').daysLeft === 14 && byKey(e, 'L15').daysLeft === 15 && oe.expiring.n === 1 && oe.expiring.v === 5);
  // Recovered: in the period (with / without a case ID) and in the period before; a reversal is not recovered money.
  const r = acct({ payouts: [pay('R1', 'SP', 3, 'A1', 'Lost_Warehouse', 2, 30, 'CASE-1'), pay('R2', 'SP', 10, 'A1', 'Lost_Warehouse', 1, 20), pay('R3', 'SP', 29, 'A1', 'CustomerReturn', 1, 10),
    pay('R4', 'SP', 30, 'A1', 'Lost_Warehouse', 1, 40, 'CASE-2'), pay('R5', 'SP', 45, 'A1', 'Lost_Warehouse', 1, 15), pay('R6', 'SP', 5, 'A1', 'Reimbursement_Reversal', -1, -9),
    pay('R7', 'CPC', 5, 'A4', 'Lost_Warehouse', 1, 100)] });
  const or = C.rbOverview([], r, null, P, TODAY, 'SP');
  ok('Recovered: through our cases (a case ID) and paid by Amazon itself, in the 30 days', or.recovered.viaCase === 30 && or.recovered.auto === 30 && or.recovered.all === 60, JSON.stringify(or.recovered));
  ok('…the period before (31–60 days ago), same length', or.recovered.prev.viaCase === 40 && or.recovered.prev.auto === 15);
  ok('…its arrows: cases ▼ 25%, automatic ▲ 100%, all ▲ about 9%', or.recovered.dCase.dir === 'down' && Math.round(or.recovered.dCase.pct) === -25
    && or.recovered.dAuto.dir === 'up' && Math.round(or.recovered.dAuto.pct) === 100 && or.recovered.delta.dir === 'up');
  ok('…nothing before: no % ("new")', C.rbOverview([], acct({ payouts: [pay('N1', 'SP', 2, 'A1', 'Lost_Warehouse', 1, 5)] }), null, P, TODAY, 'SP').recovered.delta.pct === null);
  // Lost to deadlines: expired items whose deadline fell in the period.
  const l = acct({ inbound: [ship('X1', 'SP', 'CLOSED', 70, [['A1', 4, 2]]), ship('X2', 'SP', 'CLOSED', 100, [['A1', 6, 2]]), ship('X3', 'SP', 'CLOSED', 200, [['A1', 6, 2]])] });
  const ol = C.rbOverview(C.rbItems(l, null, TODAY), l, null, P, TODAY, 'SP');
  ok('Lost to deadlines: the 30 days (deadline 10 days ago), against the period before (40 days ago)', ol.lost.v === 10 && ol.lost.n === 1 && ol.lost.prev === 20 && ol.lost.delta.dir === 'down');
  const p90 = C.rbPeriod('90', TODAY), pc = C.rbPeriod('custom', TODAY, '2026-11-10', '2026-11-01');
  ok('periods: 90 days and a custom one (either order), each with the same-length period before', p90.days === 90 && p90.prevTo === p90.from - D
    && pc.key === 'custom' && pc.days === 10 && C.rbIso(pc.from) === '2026-11-01' && C.rbIso(pc.prevFrom) === '2026-10-22');
}

console.log('== the value ==');
{
  ok('sourcing cost: units × sourcing', JSON.stringify(C.rbValue(3, COSTS.A1)) === JSON.stringify({ v: 15, per: 5, basis: 'sourcing', approx: false, noCost: false }));
  ok('landed only: used, tagged approximate', C.rbValue(2, COSTS.A2).v === 16 && C.rbValue(2, COSTS.A2).approx === true);
  ok('no cost: no value, "no cost"', C.rbValue(2, COSTS.A3).v === null && C.rbValue(2, COSTS.A3).noCost === true && C.rbValue(2, undefined).noCost);
  const d = acct({ inbound: [ship('MIX', 'SP', 'CLOSED', 30, [['A1', 10, 8], ['A3', 5, 2]]), ship('NOC', 'SP', 'CLOSED', 30, [['A3', 5, 4]]), ship('LND', 'SP', 'CLOSED', 30, [['A2', 5, 4]])] });
  const it = C.rbItems(d, null, TODAY);
  ok('a shipment with one SKU of no cost: the $ is the SKUs with a cost, the rest counted as units', byKey(it, 'MIX').value === 10 && byKey(it, 'MIX').units === 5 && byKey(it, 'MIX').noCostUnits === 3);
  ok('a shipment with no cost at all: no value', byKey(it, 'NOC').value === null && byKey(it, 'NOC').noCostUnits === 1);
  ok('landed only: ≈ landed', byKey(it, 'LND').value === 8 && byKey(it, 'LND').approx);
  const o = C.rbOverview(it, d, null, C.rbPeriod('30', TODAY), TODAY, 'ALL');
  ok('Owed now: no-cost units never in the $ (10 + 8), and counted apart', o.owed.v === 18 && o.owed.n === 3 && o.owed.noCost === 2, JSON.stringify(o.owed));
}

console.log('== underpaid and reversals ==');
{
  const d = acct({ payouts: [pay('U1', 'SP', 10, 'A1', 'Lost_Warehouse', 4, 12), pay('U2', 'SP', 10, 'A2', 'Lost_Warehouse', 2, 4), pay('U3', 'SP', 10, 'A1', 'Lost_Warehouse', 2, 10),
    pay('U4', 'SP', 10, 'A4', 'Lost_Warehouse', 1, 11)] });
  const it = C.rbItems(d, null, TODAY);
  ok('underpaid: below our sourcing cost ($3 a unit against $5): gap (5 − 3) × 4 = $8', byKey(it, 'U1') && byKey(it, 'U1').type === 'underpaid' && byKey(it, 'U1').value === 8);
  ok('…a landed cost alone never makes a payout underpaid', !byKey(it, 'U2'));
  ok('…paid at the cost, or above (landed 12 > 11 paid, sourcing 10 < 11): not underpaid', !byKey(it, 'U3') && !byKey(it, 'U4'));
  const topUp = C.rbItems(acct({ payouts: d.payouts.concat(pay('U1b', 'SP', 5, 'A1', 'Lost_Warehouse', 0, 8, null, 'U1')) }), null, TODAY);
  ok('…a top-up naming it as its original: Paid, and the duplicate guard says so', byKey(topUp, 'U1').status === 'paid' && /Already paid/.test(byKey(topUp, 'U1').block));
  const led = (d2, kind) => ({ brand: 'SP', date: ago(d2), fnsku: fn('A1'), sku: sku('A1'), asin: 'A1', title: 'Title A1', kind, units: 1, txnId: 'T' + d2 });
  const rev = [pay('O1', 'SP', 60, 'A1', 'Lost_Warehouse', 2, 12), pay('V1', 'SP', 20, 'A1', 'Reimbursement_Reversal', -2, -12, null, 'O1')];
  const none = C.rbItems(acct({ payouts: rev }), null, TODAY);
  ok('reversal, no unit found near it: disputable, with its original payout', byKey(none, 'V1') && byKey(none, 'V1').type === 'reversal' && byKey(none, 'V1').value === 12 && byKey(none, 'V1').original.reimbId === 'O1');
  ok('reversal with a unit found 30 days before it: not disputable', !byKey(C.rbItems(acct({ payouts: rev, ledger: [led(50, 'found')] }), null, TODAY), 'V1'));
  ok('…found 25 days after it: not disputable either', !byKey(C.rbItems(acct({ payouts: rev, ledger: [led(-5, 'found')] }), null, TODAY), 'V1'));
  ok('…found 31 days away, or a unit "lost" near it: still disputable', !!byKey(C.rbItems(acct({ payouts: rev, ledger: [led(51, 'found'), led(20, 'lost')] }), null, TODAY), 'V1'));
}

console.log('== the duplicate guard ==');
{
  const d = acct({ inbound: [ship('S1', 'SP', 'CLOSED', 30, [['A2', 10, 8]]), ship('S2', 'SP', 'CLOSED', 30, [['A1', 10, 8], ['A4', 4, 3]]), ship('S3', 'SP', 'CLOSED', 30, [['A2', 10, 8]]),
    ship('S4', 'SP', 'CLOSED', 30, [['A4', 3, 2]])],
    payouts: [pay('PI', 'SP', 10, 'A1', 'Lost_Inbound', 2, 12), pay('PB', 'SP', 40, 'A4', 'Lost_Inbound', 1, 11)] });
  const recs = { [C.rbKey('SP', 'inbound', 'S1')]: { status: 'in_case', caseId: '9988776655' }, [C.rbKey('SP', 'inbound', 'S3')]: { status: 'archived', reason: 'Not Amazon\'s error' } };
  const it = C.rbItems(d, recs, TODAY);
  ok('in a case: no new case, and it says which', byKey(it, 'S1').status === 'in_case' && /Already in case 9988776655/.test(byKey(it, 'S1').block));
  ok('archived: no case until restored, with its reason', byKey(it, 'S3').status === 'archived' && /Archived \(Not Amazon's error\): restore it first/.test(byKey(it, 'S3').block));
  ok('one SKU already paid by Amazon itself (an Inbound payout after delivery): left out, the rest claimed', byKey(it, 'S2').status === 'claim' && byKey(it, 'S2').partPaid
    && byKey(it, 'S2').units === 1 && byKey(it, 'S2').value === 10);
  const allPaid = C.rbItems(acct({ inbound: [ship('S5', 'SP', 'CLOSED', 30, [['A1', 10, 8]])], payouts: d.payouts }), null, TODAY)[0];
  ok('every SKU paid: Paid, "Already paid on … (reimbursement …)"', allPaid.status === 'paid' && /Already paid on 14 Nov 2026 \(reimbursement PI\)/.test(allPaid.block), allPaid.block);
  ok('a payout from before the delivery is not this shipment\'s', byKey(it, 'S4').status === 'claim' && !byKey(it, 'S4').block);
  ok('a draft record (proof ticked, no case yet) counts as none', C.rbStatus(byKey(it, 'S4'), { status: 'draft' }, TODAY) === 'claim');
}

console.log('== the action list ==');
{
  const d = acct({ inbound: [ship('A', 'SP', 'CLOSED', 50, [['A1', 10, 8]]), ship('B', 'SP', 'CLOSED', 50, [['A1', 10, 4]]), ship('C', 'SP', 'CLOSED', 20, [['A1', 10, 0]]),
    ship('W1', 'SP', 'CLOSED', 3, [['A1', 10, 9]]), ship('W2', 'SP', 'CLOSED', 12, [['A1', 10, 9]]), ship('E', 'SP', 'CLOSED', 80, [['A1', 10, 9]]), ship('K', 'CPC', 'CLOSED', 55, [['A4', 9, 8]])] });
  const it = C.rbItems(d, null, TODAY);
  const keys = o => C.rbWeekList(it, o).map(i => i.itemKey).join(',');
  ok('Claim now first — fewest days left, then highest value — then Wait (soonest to open); expired hidden', keys({ brand: 'ALL' }) === 'K,B,A,C,W2,W1', keys({ brand: 'ALL' }));
  ok('the Expired chip shows the expired after them', keys({ brand: 'ALL', expired: true }) === 'K,B,A,C,W2,W1,E');
  ok('the brand', keys({ brand: 'SP' }) === 'B,A,C,W2,W1' && keys({ brand: 'CPC' }) === 'K');
  ok('a box as a filter: Expiring in 14 days, Owed now', keys({ brand: 'ALL', focus: 'exp' }) === 'K,B,A' && keys({ brand: 'ALL', focus: 'owed' }) === 'K,B,A,C');
  const lines = C.rbCsvLines(C.rbWeekList(it, { brand: 'ALL' }));
  ok('the CSV: a heading and one line per row', lines.length === 7 && /^Type,Brand,Item,Title,SKU,ASIN,FNSKU,Units,Value \$/.test(lines[0]) && /^Inbound,CPC,K,/.test(lines[1]));
  const p = n => C.rbDaysPill({ status: 'claim', daysLeft: n }).cls;
  ok('the days pill: 7 red, 8 and 14 orange, 15 and 30 yellow, 31 neutral', p(7) === 'bad' && p(8) === 'act' && p(14) === 'act' && p(15) === 'rev' && p(30) === 'rev' && p(31) === 'n');
  ok('% paid back: 90 green, 89 and 50 yellow, 49 red', C.rbPctClass(90) === 'ok' && C.rbPctClass(89) === 'rev' && C.rbPctClass(50) === 'rev' && C.rbPctClass(49) === 'bad');
}

console.log('== the sample ==');
(async () => {
  const S = C.rbSampleData();
  const again = C.rbSampleData();
  ok('the sample is marked sample: true, a fresh copy each time, with every part there', S.sample === true && S !== again && JSON.stringify(S) === JSON.stringify(again)
    && C.rbIso(C.rbDay(S.asOf)) === C.RB_SAMPLE_TODAY && S.have.inbound && S.have.payouts && S.have.ledger);
  ok('the data contract: inbound, payouts, ledger, costs', Array.isArray(S.inbound) && Array.isArray(S.payouts) && Array.isArray(S.ledger) && typeof S.costs === 'object'
    && ['brand', 'shipmentId', 'name', 'status', 'createdAt', 'deliveredAt', 'closedAt', 'items'].every(k => k in S.inbound[0])
    && ['brand', 'date', 'reimbId', 'caseId', 'orderId', 'sku', 'asin', 'fnsku', 'title', 'reason', 'cashUnits', 'invUnits', 'amount', 'original'].every(k => k in S.payouts[0])
    && ['brand', 'date', 'fnsku', 'sku', 'asin', 'title', 'kind', 'units', 'txnId'].every(k => k in S.ledger[0]));
  const recs = new Map(S.sampleCases.map(r => [r.id, r]));
  const today = C.rbDay(S.asOf);
  const it = C.rbItems(S, recs, today);
  const inb = it.filter(i => i.type === 'inbound'), st = s => inb.filter(i => i.status === s);
  ok('12 inbound shipments: 3 Wait, 7 Claim now, 1 in a case, 1 expired', S.inbound.length === 12 && inb.length === 12 && st('wait').length === 3 && st('claim').length === 7
    && st('in_case').length === 1 && st('expired').length === 1, ['wait', 'claim', 'in_case', 'expired'].map(s => s + ' ' + st(s).length).join(', '));
  ok('…Claim now with 3 / 9 / 20 / 40 / 45 days left among them', [3, 9, 20, 40, 45].every(n => st('claim').some(i => i.daysLeft === n)));
  ok('…one with no cost on one SKU, one with a landed cost only, one SKU already paid by Amazon itself', inb.some(i => i.noCostUnits > 0 && i.value > 0) && inb.some(i => i.approx) && inb.some(i => i.partPaid));
  const pos = S.payouts.filter(p => p.amount > 0);
  ok('45 payouts over 12 months, about 70% with no case ID; 1 reversal', pos.length === 45 && Math.round(pos.filter(p => !p.caseId).length / 45 * 100) === 71
    && S.payouts.filter(p => p.amount < 0).length === 1 && pos.every(p => C.rbDay(p.date) > today - 365 * D));
  const und = it.filter(i => i.type === 'underpaid');
  ok('3 underpaid payouts, one of them archived (too small to claim)', und.length === 3 && und.filter(i => i.status === 'archived').length === 1 && und.filter(i => i.status === 'claim').length === 2);
  ok('the reversal is disputable (no unit found near it)', it.filter(i => i.type === 'reversal').length === 1 && it.find(i => i.type === 'reversal').status === 'claim');
  ok('the sample case list: 1 open case, 1 archived', S.sampleCases.filter(r => r.status === 'in_case').length === 1 && S.sampleCases.filter(r => r.status === 'archived').length === 1
    && S.sampleCases.every(r => Array.isArray(r.trail) && r.trail.length && r.trail.every(e => e.t && e.act && 'email' in e && 'uid' in e && 'person' in e && e.dev)));
  const ml = C.rbMostLost(S, today, 'ALL', 10);
  ok('most-lost: 8+ products, by value, with what was paid back', ml.length >= 8 && ml.every((r, i) => i === 0 || (ml[i - 1].value == null ? -1 : ml[i - 1].value) >= (r.value == null ? -1 : r.value))
    && ml.some(r => r.paid > 0 && r.pct != null));
  ok('…lost is net of the units found again', (() => { const r = C.rbMostLost(S, today, 'SP', 20).find(x => x.asin === 'B0SAMPLE01'); return r && r.lost === 9 && r.found === 1 && r.lostNet === 8; })());
  // The chart against the Recovered box, month by month and over the 12 months.
  const ch = C.rbChart(S, today, 'ALL', 12);
  const month = ch.months[ch.months.length - 3];
  const pm = C.rbPeriod('custom', today, C.rbIso(month.from), C.rbIso(month.to));
  const om = C.rbOverview(it, S, recs, pm, today, 'ALL');
  ok('a month of the chart: through our cases + paid by Amazon itself = Recovered for the same days', Math.abs(month.cases - om.recovered.viaCase) < 0.005 && Math.abs(month.auto - om.recovered.auto) < 0.005
    && month.cases + month.auto > 0, `${month.key}: ${month.cases}+${month.auto} vs ${om.recovered.viaCase}+${om.recovered.auto}`);
  const all12 = C.rbOverview(it, S, recs, C.rbPeriod('custom', today, C.rbIso(ch.months[0].from), C.rbIso(today)), today, 'ALL');
  const sum = ch.months.reduce((t, m) => t + m.cases + m.auto, 0);
  ok('the 12 months together equal Recovered over the same days', Math.abs(sum - all12.recovered.all) < 0.005, sum + ' vs ' + all12.recovered.all);
  ok('by reason adds up to the same, and the reversal sits below zero', ch.months.every(m => Math.abs(Object.values(m.reason).reduce((t, v) => t + v, 0) - m.cases - m.auto) < 0.005)
    && ch.months.some(m => m.rev < 0) && ch.months.length === 12 && ch.months[11].key === '2026-11');
  ok('the brand: the two brands\' charts add up to both', ch.months.every((m, i) => Math.abs(C.rbChart(S, today, 'SP').months[i].auto + C.rbChart(S, today, 'CPC').months[i].auto - m.auto) < 0.005));
  const oS = C.rbOverview(it, S, recs, C.rbPeriod('30', today), today, 'ALL');
  ok('the sample\'s boxes: something owed, expiring, underpaid, 1 open case and money lost to a deadline in the 30 days', oS.owed.v > 0 && oS.expiring.n >= 2 && oS.underpaid.n === 2
    && oS.open.n === 1 && oS.lost.n === 1, JSON.stringify({ owed: oS.owed, exp: oS.expiring, under: oS.underpaid, open: oS.open.n, lost: oS.lost.n }));
  const t1 = C.rbCaseText(st('claim').find(i => i.itemKey === 'FBA19SAMPLE01'));
  ok('the inbound case text: the shipment, each SKU shipped / received / missing, polite', /inbound shipment FBA19SAMPLE01/.test(t1) && /RH-TC-6084-NVY \(FNSKU X0SAMPLE01, ASIN B0SAMPLE01\): shipped 120, received 112, missing 8/.test(t1)
    && /Thank you/.test(t1) && !/RH-RN-1472-SAG/.test(t1));
  const t2 = C.rbCaseText(und.find(i => i.status === 'claim')), t3 = C.rbCaseText(it.find(i => i.type === 'reversal'));
  ok('the re-check and dispute texts: the reimbursement, our cost, the ledger check', /below our cost/.test(t2) && /excludes shipping, handling and duties/.test(t2)
    && /RBSAMPLE0046/.test(t3) && /original reimbursement was RBSAMPLE0011/.test(t3) && /no unit of this FNSKU found between/.test(t3));

  console.log('== never the clock, and the wiring ==');
  const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('the engine and the sample never read the clock (no Date.now(), no new Date() without a day)', ![CORE, SAMPLE].some(s => /Date\.now\s*\(|new Date\(\s*\)/.test(code(s))));
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const ids = [...new Set([...PAGE.matchAll(/\$\('([A-Za-z0-9]+)'\)/g)].map(m => m[1]))];
  const missing = ids.filter(id => !html.includes(`id="${id}"`) && !PAGE.includes(`id="${id}"`));
  ok('every element the page reaches for is in src/index.html (or drawn by the page itself, inside a dialog)', ids.length > 30 && !missing.length, missing.join(', '));
  const iInv = html.indexOf('id="grpInv"'), iR = html.indexOf('id="grpReimb"'), iSoc = html.indexOf('id="grpSocial"');
  ok('the menu group after Inventory and before Social, its Overview button, the pane in the sta-scope look',
    iInv > 0 && iR > iInv && iSoc > iR && /data-grp="reimb" data-tabs="reimb"/.test(html) && /<button id="tabReimb" class="nav">Overview<\/button>/.test(html)
    && /<div id="paneReimb" class="hide sta-scope rb-scope">/.test(html) && /data-accg="reimb"/.test(html));
  const order = read('ORDER').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const oi = f => order.indexOf(f);
  const four = ['reimb/reimb-core.js', 'reimb/reimb-sample.js', 'reimb/reimb-data.js', 'reimb/reimb-overview.js'];
  ok('ORDER: core, sample, data, overview, each once, in that order', four.every(f => order.filter(x => x === f).length === 1)
    && four.every((f, i) => !i || oi(four[i - 1]) < oi(f)));
  const nav = read('core/nav.js');
  ok('nav: \'reimb\' after \'age\', its title, its loader, and not inherited', /'age', 'reimb'/.test(nav) && /reimb: 'Reimbursement · Overview'/.test(nav)
    && /if \(which === 'reimb'\) ensureReimb\(\);/.test(nav) && !/TAB_INHERIT = \{[^}]*reimb/.test(nav));
  ok('the Access page: a Reimbursement card holding the reimb box', /\{ key: 'reimb', sellora: \['reimb'\] \}/.test(read('core/admin-access.js')));
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  ok('firestore.rules: reimbCases written like adsActions (read, create, update with the right; never delete)',
    /match \/reimbCases\/\{id\} \{\s*allow read, create, update: if can\('reimb'\) \|\| can\('audit'\);\s*allow delete: if false;\s*\}/.test(rules));
  ok('firestore.rules: reimbData (the uploads) read and written with the right', /match \/reimbData\/\{id\} \{\s*allow read, write: if can\('reimb'\) \|\| can\('audit'\);\s*\}/.test(rules));
  ok('the Seller Central links live in one constant', Object.keys(C.RB_LINKS).length >= 3 && Object.values(C.RB_LINKS).every(u => /^https:\/\/sellercentral\.amazon\.com\//.test(u)));
  ok('not counted yet, from the types: lost & damaged, removals, disposals, returns, fee errors', C.RB.LATER.join(', ') === 'lost & damaged, removals, disposals, returns, fee errors', C.RB.LATER.join(', '));

  console.log('== reading Amazon\'s reports (the upload) ==');
  {
    const TSV = ['approval-date\treimbursement-id\tcase-id\tamazon-order-id\treason\tsku\tfnsku\tasin\tproduct-name\tcondition\tcurrency-unit\tamount-per-unit\tamount-total'
      + '\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\tquantity-reimbursed-total\toriginal-reimbursement-id\toriginal-reimbursement-type',
    '2026-11-04T07:00:00+00:00\t111\t\t\tLost_Warehouse\tRH-1\tX1\tB01\tTablecloth navy\tNew\tUSD\t4.10\t12.30\t3\t0\t3\t\t',
    '2026-11-05T07:00:00+00:00\t112\t9000\t\tReimbursement_Reversal\tRH-1\tX1\tB01\tTablecloth navy\tNew\tUSD\t-3.70\t-7.40\t-2\t0\t-2\t111\tLost_Warehouse',
    '2026-11-04T07:00:00+00:00\t111\t\t\tLost_Warehouse\tRH-1\tX1\tB01\tTablecloth navy\tNew\tUSD\t4.10\t12.30\t3\t0\t3\t\t', ''].join('\r\n');
    const a = C.rbParseReport('payouts', TSV, 'SP');
    ok('Reimbursements report, tab-separated with Amazon\'s hyphen headers: every row in the contract\'s shape', a.ok && a.kept === 2 && a.dupes === 1
      && JSON.stringify(a.rows[0]) === JSON.stringify({ brand: 'SP', date: '2026-11-04', reimbId: '111', caseId: null, orderId: null, sku: 'RH-1', asin: 'B01', fnsku: 'X1',
        title: 'Tablecloth navy', reason: 'Lost_Warehouse', cashUnits: 3, invUnits: 0, amount: 12.3, original: null })
      && a.rows[1].amount === -7.4 && a.rows[1].original.reimbId === '111' && a.rows[1].caseId === '9000' && a.from === '2026-11-04' && a.to === '2026-11-05', JSON.stringify(a).slice(0, 300));
    const CSV = ['"Approval Date","Reimbursement_ID","CASE ID","Amazon Order Id","Reason","SKU","FNSKU","ASIN","Product Name","Amount Total","Quantity Reimbursed Cash",'
      + '"Quantity_Reimbursed_Inventory","Original Reimbursement ID","Currency Unit"',
    '11/06/2026,113,,,"Damaged_Warehouse",RH-2,X2,B02,"Runner, sage 14x72","$1,204.50",2,0,,USD',
    '11/07/2026,114,,111-222,CustomerReturn,RH-3,X3,B03,"Napkins ""white""",9.90,1,0,,CAD'].join('\n');
    const b = C.rbParseReport('payouts', CSV, 'SP');
    ok('…and comma-separated with spaced, underscored, mixed-case headers, quotes, US dates, "$1,204.50"', b.ok && b.kept === 2 && b.rows[0].date === '2026-11-06'
      && b.rows[0].title === 'Runner, sage 14x72' && b.rows[0].amount === 1204.5 && b.rows[1].title === 'Napkins "white"' && b.rows[1].orderId === '111-222' && b.notUsd === 1, JSON.stringify(b).slice(0, 300));
    const noCase = C.rbParseReport('payouts', TSV.replace('case-id', 'case-number'), 'SP');
    ok('a needed column missing: refused, naming it — never guessed', !noCase.ok && noCase.missing.join() === 'case-id' && /no "case-id" column/.test(noCase.err) && /Reports → Fulfillment → Reimbursements/.test(noCase.err));
    ok('the brand first', !C.rbParseReport('payouts', TSV, '').ok && /brand/.test(C.rbParseReport('payouts', TSV, '').err));
    ok('an empty file, or the ledger offered as the reimbursements report: refused', !C.rbParseReport('payouts', '', 'SP').ok && !C.rbParseReport('payouts', 'Date,FNSKU\n2026-11-01,X1', 'SP').ok);
    const m1 = C.rbMerge('payouts', a.rows, b.rows), m2 = C.rbMerge('payouts', m1.rows, a.rows);
    ok('uploading again replaces, never duplicates (keyed by reimbursement ID + SKU)', m1.rows.length === 4 && m1.added === 2 && m2.rows.length === 4 && m2.replaced === 2 && m2.added === 0);
    const fixed = a.rows.map(x => Object.assign({}, x, x.reimbId === '111' ? { amount: 15 } : {}));
    ok('…a corrected row replaces the old one', C.rbMerge('payouts', m2.rows, fixed).rows.find(x => x.reimbId === '111').amount === 15);
    const LED = ['Date,FNSKU,ASIN,MSKU,Title,Event Type,Reference ID,Quantity,Fulfillment Center,Disposition,Reason,Reconciled Quantity,Unreconciled Quantity',
      '11/01/2026,X1,B01,RH-1,Tablecloth,Adjustments,R1,-2,PHX7,SELLABLE,M,0,-2',
      '11/02/2026,X1,B01,RH-1,Tablecloth,Adjustments,R2,1,PHX7,SELLABLE,F,1,0',
      '11/03/2026,X1,B01,RH-1,Tablecloth,Adjustments,R3,-1,PHX7,DEFECTIVE,6,,',
      '11/03/2026,X2,B02,RH-2,Runner,Adjustments,R4,-1,PHX7,DEFECTIVE,E,,',
      '11/04/2026,X2,B02,RH-2,Runner,Adjustments,R5,-1,PHX7,SELLABLE,D,,',
      '11/04/2026,X2,B02,RH-2,Runner,Adjustments,R6,-3,PHX7,SELLABLE,5,,',
      '11/05/2026,X2,B02,RH-2,Runner,Adjustments,R7,-1,PHX7,SELLABLE,Q,,',
      '11/05/2026,X2,B02,RH-2,Runner,Receipts,R8,10,PHX7,SELLABLE,,,',
      '11/06/2026,X2,B02,RH-2,Runner,Shipments,R9,-3,PHX7,SELLABLE,,,',
      '11/06/2026,X2,B02,RH-2,Runner,CustomerReturns,R10,1,PHX7,SELLABLE,,,'].join('\n');
    const l = C.rbParseReport('ledger', LED, 'SP');
    const kind = id => (l.rows.find(x => x.txnId === id) || {}).kind;
    ok('Inventory Ledger: only Adjustments and Receipts kept (Shipments, Customer returns left out)', l.ok && l.kept === 8 && l.skipped === 2);
    ok('reason codes: M and 5 lost, F found, 6 and E damaged, D destroyed, a receipt a receipt', kind('R1') === 'lost' && kind('R6') === 'lost' && kind('R2') === 'found'
      && kind('R3') === 'damaged' && kind('R4') === 'damaged' && kind('R5') === 'destroyed' && kind('R8') === 'receipt');
    ok('…a code not in the map is kept as "other" and counted, never dropped', kind('R7') === 'other' && l.other === 1 && JSON.stringify(l.otherCodes) === '{"Q":1}');
    ok('…units as a count, the quantity kept with its sign', l.rows.find(x => x.txnId === 'R1').units === 2 && l.rows.find(x => x.txnId === 'R1').qty === -2);
    ok('…re-uploaded: keyed by date + FNSKU + event + reference + quantity + reason, never twice', C.rbMerge('ledger', l.rows, l.rows).rows.length === 8);
    ok('RB.REASON_MAP: the codes asked for', ['M', '5'].every(c => C.RB.REASON_MAP[c] === 'lost') && C.RB.REASON_MAP.F === 'found' && C.RB.REASON_MAP.D === 'destroyed'
      && ['6', '7', 'E', 'H', 'K', 'U'].every(c => C.RB.REASON_MAP[c] === 'damaged'));
    const known = new Map([['RH-1', 'SP'], ['RH-2', 'SP'], ['RH-3', 'CPC']]);
    const wrong = C.rbParseReport('payouts', TSV, 'CPC', known);
    ok('most SKUs known as the other brand: a warning before saving', wrong.ok && JSON.stringify(wrong.otherBrand) === JSON.stringify({ n: 1, of: 1, brand: 'SP' }), JSON.stringify(wrong.otherBrand));
    ok('…half or fewer: no warning (one of two)', !C.rbParseReport('payouts', CSV, 'CPC', known).otherBrand);
    ok('…and none when they are the brand picked, or nothing is known', !C.rbParseReport('payouts', TSV, 'SP', known).otherBrand && !C.rbParseReport('payouts', TSV, 'CPC', new Map()).otherBrand);
  }

  console.log('== money, costs, and the parts not there ==');
  {
    ok('one money format: cents under $100, whole dollars from $100', C.rbFmt(10.2) === '$10.20' && C.rbFmt(99.994) === '$99.99' && C.rbFmt(99.996) === '$100'
      && C.rbFmt(150.4) === '$150' && C.rbFmt(1234.5) === '$1,235' && C.rbFmt(-7.4) === '−$7.40' && C.rbFmt(null) === '—');
    ok('the page uses it everywhere (no other money format left in it)', /const rbM0 = v => rbFmt\(v\)/.test(PAGE) && /const rbM2 = v => rbFmt\(v\)/.test(PAGE) && !/staMoney0?\(/.test(PAGE));
    // Real data: Profit & Margin's landed cost only.
    const d = acct({ costs: { A1: { sourcing: null, landed: 7 }, A4: { sourcing: null, landed: 12 } },
      payouts: [pay('L1', 'SP', 10, 'A1', 'Lost_Warehouse', 2, 10), pay('L2', 'SP', 10, 'A4', 'Lost_Warehouse', 1, 12), pay('L3', 'SP', 120, 'A1', 'Lost_Warehouse', 2, 8)] });
    const it = C.rbItems(d, null, TODAY), o = C.rbOverview(it, d, null, C.rbPeriod('30', TODAY), TODAY, 'ALL');
    ok('landed cost only: nothing called underpaid, the box says it needs sourcing costs', !it.some(i => i.type === 'underpaid') && o.underpaid.sourcing === false && o.underpaid.v === 0);
    ok('…"N payouts are below landed cost (possible)": inside the re-check window only', o.underpaid.belowLanded === 1 && C.rbBelowLanded(d, TODAY, 'CPC') === 0);
    ok('…and the page shows no $ there', /Needs sourcing costs/.test(PAGE) && /below landed cost \(possible\)/.test(PAGE) && /Costs need the Profit &amp; Margin right|costNote/.test(PAGE));
    ok('with a sourcing cost, the box is the $ gap as before', C.rbOverview(C.rbItems(acct({ payouts: [pay('U9', 'SP', 5, 'A1', 'Lost_Warehouse', 2, 6)] }), null, TODAY),
      acct({ payouts: [pay('U9', 'SP', 5, 'A1', 'Lost_Warehouse', 2, 6)] }), null, C.rbPeriod('30', TODAY), TODAY, 'ALL').underpaid.sourcing === true);
    const rev = [pay('O1', 'SP', 60, 'A1', 'Lost_Warehouse', 2, 12), pay('V1', 'SP', 20, 'A1', 'Reimbursement_Reversal', -2, -12, null, 'O1'),
      pay('O2', 'CPC', 60, 'A4', 'Lost_Warehouse', 1, 12), pay('V2', 'CPC', 20, 'A4', 'Reimbursement_Reversal', -1, -12, null, 'O2')];
    ok('no ledger: no reversal is judged (it cannot be checked)', !C.rbItems(acct({ payouts: rev, have: { payouts: true, ledger: false, inbound: false } }), null, TODAY).some(i => i.type === 'reversal'));
    ok('…one brand\'s ledger uploaded: only that brand\'s reversals are judged', C.rbItems(acct({ payouts: rev, have: { payouts: true, ledger: true, ledgerBrands: ['SP'], inbound: false } }), null, TODAY)
      .filter(i => i.type === 'reversal').map(i => i.itemKey).join() === 'V1');
  }

  console.log('== rbLoad: the backend, else the uploads, else nothing — the sample only with ?sample=1 ==');
  {
    // core + sample + data in a stub page: the backend, Firestore and this browser's storage as each test needs them.
    const page = o => {
      const calls = { set: [], del: [] };
      const ctx = Object.assign({
        location: { search: '' }, ME: { admin: false, tabs: ['reimb'], email: 'asha@example.com' }, db: {}, COST: {}, ST: { ag: {} }, WEEKLY: { rows: {} },
        baCall: async () => { throw new Error('nothing cached for "x" yet'); },
        getDocs: async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); },
        collection: (d, c) => ({ c }), doc: (d, c, id) => ({ c, id }),
        setDoc: async (ref, v) => { calls.set.push([ref.id, v]); }, deleteDoc: async ref => { calls.del.push(ref.id); },
        loadCosts: async () => {}, ppchNeedPerson: async () => {}, ppchEvent: (act, x) => Object.assign({ t: 1, act, email: 'asha@example.com', uid: '', person: 'Asha', dev: {} }, x),
      }, o || {});
      const C2 = new Function(...Object.keys(ctx), CORE + '\n' + SAMPLE + '\n' + DATA + '\nreturn { rbLoad, rbUploadSave, rbUploadsLoad, RBX, rbKnownBrands, rbDataNote };')(...Object.values(ctx));
      return { C2, calls };
    };
    const s = await page({ location: { search: '?sample=1' } }).C2.rbLoad();
    ok('?sample=1: the sample, marked as such', s.sample === true && s.source === 'sample');
    const none = await page().C2.rbLoad();
    ok('nothing at all: source "none", no rows — and nothing made up', none.sample === false && none.source === 'none' && !none.payouts.length && !none.ledger.length && !none.inbound.length
      && !none.have.payouts && !none.have.inbound);
    ok('…no Profit & Margin right: no costs, "Costs need the Profit & Margin right"', none.costNote === 'Costs need the Profit & Margin right' && !Object.keys(none.costs).length);
    const withCosts = await page({ ME: { admin: false, tabs: ['reimb', 'profit'] }, COST: { B0A: { c: 8.4 }, B0B: { c: 0 } } }).C2.rbLoad();
    ok('…with it: Profit & Margin\'s costs, as LANDED costs, never sourcing', JSON.stringify(withCosts.costs) === JSON.stringify({ B0A: { sourcing: null, landed: 8.4 } }) && !withCosts.costNote);
    const be = await page({ baCall: async q => (q.cache === 'reimbPaid' ? { data: { at: '2026-11-24 06:00', d: { SP: [{ date: '2026-11-20', reimbId: 'R1', sku: 'S', amount: 5, cashUnits: 1 }], CPC: [] } } }
      : (() => { throw new Error('nothing cached'); })()) }).C2.rbLoad();
    ok('the backend cache first: reimbPaid read, its brand from the key; no inbound without reimbInbound', be.source === 'backend' && be.payouts.length === 1 && be.payouts[0].brand === 'SP'
      && be.have.payouts && !be.have.inbound && !be.have.ledger && be.asOf === '2026-11-20');
    // Uploads in the shared copy: the newest upload's chunks in order; a half-written newer one is skipped.
    const docs = [
      { brand: 'SP', report: 'payouts', n: 1, of: 2, uploadedAt: 5, rows: [{ reimbId: 'B', sku: 'S', date: '2026-11-02' }] },
      { brand: 'SP', report: 'payouts', n: 0, of: 2, uploadedAt: 5, trail: [], rows: [{ reimbId: 'A', sku: 'S', date: '2026-11-01' }] },
      { brand: 'CPC', report: 'ledger', n: 0, of: 2, uploadedAt: 9, rows: [{ date: '2026-11-03' }] },
    ].map(v => ({ data: () => v }));
    const P = page({ getDocs: async () => ({ docs }) });
    const up = await P.C2.rbLoad();
    ok('then the uploads (Firestore reimbData): chunks joined in order; a half-written upload is not read', up.source === 'upload' && up.payouts.map(x => x.reimbId).join() === 'A,B'
      && !up.have.ledger && P.C2.RBX.where === 'fs' && P.C2.rbDataNote() === '');
    // Saving: chunks of 1500, chunk 0 with the trail; a longer earlier upload's extra chunk removed.
    P.C2.RBX.uploads.SP_payouts.of = 3;
    const rows = Array.from({ length: 1600 }, (_, i) => ({ reimbId: 'R' + i, sku: 'S', date: '2026-11-01' }));
    await P.C2.rbUploadSave('SP', 'payouts', rows, { from: '2026-11-01', to: '2026-11-01' });
    const ids = P.calls.set.map(c => c[0]);
    ok('saving: reimbData/SP_payouts_0 and _1 (1,500 rows each at most), who and when on chunk 0, the left-over _2 removed',
      ids.join() === 'SP_payouts_0,SP_payouts_1' && P.calls.set[0][1].rows.length === 1500 && P.calls.set[1][1].rows.length === 100 && P.calls.set[0][1].of === 2
      && P.calls.set[0][1].trail.slice(-1)[0].act === 'uploaded' && P.calls.set[0][1].trail.slice(-1)[0].rows === 1600 && !P.calls.set[1][1].trail
      && P.calls.del.join() === 'SP_payouts_2');
    const L = page();
    await L.C2.rbLoad();
    ok('rule not deployed and no browser storage: kept for this visit, and the page says so', L.C2.RBX.where === 'mem'
      && (await L.C2.rbUploadSave('CPC', 'ledger', [{ date: '2026-11-01', fnsku: 'X' }]), /this visit only/.test(L.C2.rbDataNote())) && !L.calls.set.length);
    ok('…and a later read keeps them (not lost when the page reads again)', (await L.C2.rbLoad()).have.ledger === true);
    ok('what Sellora knows of the brands, for the warning: the uploads, the ad groups, Product Performance', (() => {
      const K = page({ ST: { ag: { CPC: { rows: [{ sku: 'CP-1', a: 'B0C' }] } } }, WEEKLY: { rows: { B0W: { brand: 'SP' } } } }).C2;
      const m = K.rbKnownBrands();
      return m.get('CP-1') === 'CPC' && m.get('B0C') === 'CPC' && m.get('B0W') === 'SP';
    })());
  }

  console.log('== the local test copy: the Reimbursement menu without the right (core/access.js) ==');
  {
    // The real applyPerms and its local-host helpers, cut out of access.js and run against a stub page; syncNavGroups hands
    // over the allowed(t) the menu is built with.
    const acc = read('core/access.js');
    const from = acc.indexOf('/* THE REIMBURSEMENT MENU ON A LOCAL TEST COPY ONLY');
    const at = acc.indexOf('function applyPerms()', from), end = acc.slice(at).search(/\r?\n\}\r?\n/);
    ok('the local-host rule and applyPerms found in access.js', from > 0 && at > from && end > 0);
    const slice = acc.slice(from, at + end) + '\n}\n';
    const TABS_T = ['dash', 'age', 'reimb', 'health', 'st', 'ngram', 'plc', 'sales', 'reimbpaid'];
    const run = (host, me, groups) => {
      const out = {};
      const f = new Function('location', 'ME', 'NAV_GROUPS', 'out', `
        const TABS = ${JSON.stringify(TABS_T)}, HIDDEN_TABS = [], TAB_INHERIT = { ngram: 'st' };
        const el = () => ({ classList: { toggle() {}, add() {}, remove() {} }, textContent: '' });
        const $ = () => el(), capId = s => s, applyBrandPicker = () => {}, tabFromHash = () => '', LH_LISTING_TABS = [];
        const syncNavGroups = a => { out.allowed = a; }, showTab = t => { out.opened = t; };
        let TAB_OK = null, TAB_HASH = '';
        ${slice}
        applyPerms();
        return out;`);
      return f({ hostname: host }, Object.assign({ admin: false, tabs: [] }, me), groups, out);
    };
    const others = TABS_T.filter(t => t !== 'reimb' && t !== 'reimbpaid' && t !== 'dash');
    const local = run('localhost', {});
    ok('localhost, no rights at all: Reimbursement › Overview is allowed, and opens', local.allowed('reimb') === true && local.opened === 'dash' && local.allowed('dash'));
    ok('…127.0.0.1, 0.0.0.0 and an empty host (a file) too', ['127.0.0.1', '0.0.0.0', ''].every(h => run(h, {}).allowed('reimb') === true));
    ok('…and nothing else: every other tab stays shut', others.every(t => local.allowed(t) === false), others.filter(t => local.allowed(t)).join(', '));
    ['sellora-dev.web.app', 'ridhi-sellora.web.app', 'localhost.example.com', '192.168.1.20'].forEach(h => {
      const r = run(h, {});
      ok(`another host (${h}): not allowed without the right`, r.allowed('reimb') === false && !r.opened);
    });
    ok('another host with the right ticked: allowed, as before', run('sellora-dev.web.app', { tabs: ['reimb'] }).allowed('reimb') === true);
    const me = { tabs: ['st', 'health'] };
    const l2 = run('localhost', me), r2 = run('ridhi-sellora.web.app', me);
    ok('other tabs never change with the host (an account with Search Term Analysis and Listing Health)', others.every(t => l2.allowed(t) === r2.allowed(t))
      && l2.allowed('ngram') && !l2.allowed('age') && !r2.allowed('reimb') && l2.allowed('reimb'));
    ok('every tab of the Reimbursement menu group, read off the menu (a later page too), and only on the local host',
      run('localhost', {}, [{ key: 'reimb', tabs: ['reimb', 'reimbpaid'] }, { key: 'inv', tabs: ['age'] }]).allowed('reimbpaid') === true
      && run('sellora-dev.web.app', {}, [{ key: 'reimb', tabs: ['reimb', 'reimbpaid'] }]).allowed('reimbpaid') === false
      && run('localhost', {}, [{ key: 'reimb', tabs: ['reimb', 'reimbpaid'] }, { key: 'inv', tabs: ['age'] }]).allowed('age') === false);
    ok('an admin: everything, on any host (unchanged)', ['localhost', 'sellora-dev.web.app'].every(h => TABS_T.every(t => run(h, { admin: true }).allowed(t))));
    ok('the data still follows firestore.rules: the rule is not loosened for a local host', !/localhost/.test(fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
