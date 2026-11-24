/* ================= REIMBURSEMENT · THE SAMPLE: made-up data for the tests, and for ?sample=1 only (24 Nov 2026) =================
 * Never on screen by default: the page shows real data (reimb-data.js, rbLoad — the backend caches, else the reports a person
 * uploaded, else "Connect Amazon's data"). This sample is what tests/reimb-test.js runs on, and what the page shows when its
 * address carries ?sample=1 — always with the yellow "Sample data" banner. Same shape as THE DATA CONTRACT in reimb-core.js.
 *
 * The sample is made up: ASINs B0SAMPLE01…, FNSKUs X0SAMPLE01…, shipments FBA19SAMPLE01…, reimbursements RBSAMPLE0001…,
 * both brands, tablecloths, runners, napkins and pillow covers. Every date is worked out from one fixed day,
 * RB_SAMPLE_TODAY (never the clock), so the sample says the same thing whenever it is opened:
 *   12 inbound shipments: 3 still Wait (one not closed, one 10 and one 14 days after delivery), 5 Claim now with 3 / 9 / 20 /
 *   40 / 45 days left (45 is the most a Claim-now shipment can have: 60 − 15), 1 already in a case, 1 expired, 1 with no cost
 *   on one SKU, 1 with a landed cost only; one SKU of one shipment was already paid by Amazon itself.
 *   45 payouts over 12 months, 13 of them through a case; 3 underpaid (one archived as too small to claim); 1 reversal with no
 *   unit found near it. Ledger rows for 12 products. 1 open case record and 1 archived one (sampleCases: the page's case
 *   records come from Firestore reimbCases once the data is real; with the sample they stay in this browser). */

const RB_SAMPLE_TODAY = '2026-11-24';
// The made-up catalogue: [key, brand, asin, sku, fnsku, title, sourcing, landed].
const RB_SAMPLE_PRODUCTS = [
  ['P1', 'SP', 'B0SAMPLE01', 'RH-TC-6084-NVY', 'X0SAMPLE01', 'Cotton Tablecloth 60x84 – Navy', 6.40, 8.10],
  ['P2', 'SP', 'B0SAMPLE02', 'RH-TC-60120-IVY', 'X0SAMPLE02', 'Cotton Tablecloth 60x120 – Ivory', 7.90, 9.80],
  ['P3', 'SP', 'B0SAMPLE03', 'RH-RN-1472-SAG', 'X0SAMPLE03', 'Table Runner 14x72 – Sage', 3.10, 4.05],
  ['P4', 'SP', 'B0SAMPLE04', 'RH-RN-14108-TER', 'X0SAMPLE04', 'Table Runner 14x108 – Terracotta', 3.80, 4.90],
  ['P5', 'SP', 'B0SAMPLE05', 'RH-NP-6PK-WHT', 'X0SAMPLE05', 'Cloth Napkins Set of 6 – White', 4.60, 5.70],
  ['P6', 'SP', 'B0SAMPLE06', 'RH-PC-1818-MUS', 'X0SAMPLE06', 'Pillow Cover 18x18 – Mustard', 2.20, 2.95],
  ['P7', 'SP', 'B0SAMPLE07', 'RH-TC-70RD-GRY', 'X0SAMPLE07', 'Round Tablecloth 70in – Grey', null, 8.60],
  ['P8', 'SP', 'B0SAMPLE08', 'RH-PC-2020-BLU', 'X0SAMPLE08', 'Pillow Cover 20x20 – Blue Stripe', null, null],
  ['P9', 'CPC', 'B0SAMPLE09', 'CP-TC-6090-FLR', 'X0SAMPLE09', 'Floral Print Tablecloth 60x90', 6.90, 8.70],
  ['P10', 'CPC', 'B0SAMPLE10', 'CP-NP-4PK-GNG', 'X0SAMPLE10', 'Gingham Napkins Set of 4 – Red', 3.40, 4.30],
  ['P11', 'CPC', 'B0SAMPLE11', 'CP-RN-1490-IND', 'X0SAMPLE11', 'Block Print Runner 14x90 – Indigo', 3.60, 4.60],
  ['P12', 'CPC', 'B0SAMPLE12', 'CP-PC-1818-PSL', 'X0SAMPLE12', 'Paisley Pillow Cover 18x18', 2.40, 3.10],
];
// Inbound shipments: [n, brand, status, days since delivery, [[product, shipped, received], …]].
const RB_SAMPLE_SHIP = [
  [1, 'SP', 'CLOSED', 57, [['P1', 120, 112], ['P3', 60, 60]]],      // Claim now, 3 days left
  [2, 'SP', 'CLOSED', 51, [['P5', 80, 74], ['P6', 100, 96]]],       // Claim now, 9 days left (P5 already paid by Amazon itself)
  [3, 'CPC', 'CLOSED', 40, [['P9', 90, 84]]],                       // Claim now, 20 days left
  [4, 'SP', 'CLOSED', 20, [['P2', 60, 57], ['P4', 50, 50]]],        // Claim now, 40 days left
  [5, 'CPC', 'CLOSED', 15, [['P11', 70, 66], ['P12', 120, 117]]],   // Claim now, 45 days left (opened today)
  [6, 'SP', 'CLOSED', 30, [['P8', 40, 37], ['P6', 60, 58]]],        // Claim now; P8 has no cost
  [7, 'SP', 'CLOSED', 35, [['P7', 30, 27]]],                        // Claim now; landed cost only
  [8, 'SP', 'CLOSED', 45, [['P1', 100, 90]]],                       // already in a case
  [9, 'CPC', 'CLOSED', 70, [['P10', 80, 72]]],                      // expired 10 days ago
  [10, 'SP', 'RECEIVING', 20, [['P3', 90, 80]]],                    // Wait: not closed yet
  [11, 'CPC', 'CLOSED', 10, [['P9', 60, 55]]],                      // Wait: opens in 5 days
  [12, 'SP', 'CLOSED', 14, [['P5', 50, 47]]],                       // Wait: opens tomorrow
];
// Payouts: [n, days ago, product, reason, units, paid per unit, through a case]. Reversal: n 46, below.
const RB_SAMPLE_PAY = [
  [1, 8, 'P2', 'Lost_Warehouse', 2, 11.20], [2, 12, 'P9', 'Damaged_Warehouse', 1, 10.40],
  [3, 20, 'P1', 'Lost_Warehouse', 3, 4.10],                          // underpaid: our cost is $6.40
  [4, 22, 'P4', 'CustomerReturn', 2, 6.10, 1], [5, 27, 'P5', 'Lost_Inbound', 4, 7.20],
  [6, 33, 'P11', 'Lost_Warehouse', 3, 6.20], [7, 38, 'P6', 'Damaged_Warehouse', 5, 3.90], [8, 44, 'P12', 'CustomerServiceIssue', 2, 4.40],
  [9, 48, 'P9', 'Lost_Warehouse', 2, 5.25],                          // underpaid: our cost is $6.90
  [10, 52, 'P2', 'Lost_Inbound', 6, 11.00, 1], [11, 57, 'P3', 'Lost_Warehouse', 2, 3.70], [12, 61, 'P10', 'Damaged_Warehouse', 3, 5.10],
  [13, 66, 'P1', 'Removal_Order_Lost', 2, 9.50],
  [14, 70, 'P5', 'Lost_Warehouse', 4, 2.80],                         // underpaid: our cost is $4.60 (archived: too small to claim)
  [15, 75, 'P4', 'Lost_Inbound', 5, 5.90, 1], [16, 83, 'P9', 'CustomerReturn', 1, 9.90], [17, 90, 'P11', 'Damaged_Warehouse', 2, 5.80],
  [18, 97, 'P6', 'Lost_Warehouse', 6, 3.60], [19, 104, 'P2', 'Damaged_Warehouse', 1, 12.10, 1], [20, 112, 'P12', 'Lost_Inbound', 8, 4.20, 1],
  [21, 119, 'P1', 'Lost_Warehouse', 3, 9.20], [22, 126, 'P3', 'CustomerReturn', 2, 5.10], [23, 134, 'P10', 'Lost_Warehouse', 4, 5.30],
  [24, 141, 'P5', 'Damaged_Warehouse', 2, 7.40, 1], [25, 149, 'P9', 'Lost_Inbound', 5, 10.20, 1], [26, 156, 'P4', 'Lost_Warehouse', 3, 6.00],
  [27, 164, 'P6', 'Removal_Order_Damaged', 4, 3.80], [28, 171, 'P11', 'Lost_Warehouse', 2, 6.30], [29, 179, 'P2', 'CustomerReturn', 1, 11.80],
  [30, 187, 'P1', 'Lost_Inbound', 7, 9.40, 1], [31, 196, 'P12', 'Damaged_Warehouse', 3, 4.50], [32, 204, 'P3', 'Lost_Warehouse', 4, 4.90],
  [33, 213, 'P10', 'Lost_Inbound', 6, 5.40, 1], [34, 222, 'P5', 'Lost_Warehouse', 3, 7.10], [35, 231, 'P9', 'Damaged_Warehouse', 2, 10.60],
  [36, 240, 'P4', 'Lost_Inbound', 4, 6.20, 1], [37, 252, 'P6', 'CustomerReturn', 3, 3.70], [38, 263, 'P11', 'Lost_Warehouse', 5, 6.00],
  [39, 275, 'P2', 'Lost_Warehouse', 2, 12.00], [40, 288, 'P1', 'Damaged_Warehouse', 2, 9.10, 1], [41, 300, 'P12', 'Lost_Warehouse', 6, 4.30],
  [42, 314, 'P3', 'Lost_Inbound', 5, 5.00, 1], [43, 329, 'P10', 'Damaged_Warehouse', 2, 5.20], [44, 345, 'P5', 'Lost_Warehouse', 3, 7.30, 1],
  [45, 358, 'P9', 'Removal_Order_Lost', 1, 10.00],
];
// Ledger: [days ago, product, kind, units].
const RB_SAMPLE_LEDGER = [
  [300, 'P1', 'lost', 5], [190, 'P1', 'lost', 4], [185, 'P1', 'found', 1], [120, 'P1', 'damaged', 2],
  [280, 'P2', 'lost', 3], [100, 'P2', 'damaged', 2], [15, 'P2', 'lost', 2],
  [210, 'P3', 'lost', 6], [130, 'P3', 'damaged', 3], [120, 'P3', 'found', 1], [60, 'P3', 'lost', 2],
  [160, 'P4', 'lost', 4], [80, 'P4', 'lost', 3],
  [350, 'P5', 'lost', 3], [140, 'P5', 'damaged', 4], [72, 'P5', 'lost', 5],
  [165, 'P6', 'damaged', 7], [100, 'P6', 'lost', 6], [40, 'P6', 'destroyed', 5],
  [55, 'P7', 'damaged', 2], [70, 'P8', 'lost', 3],
  [360, 'P9', 'lost', 2], [235, 'P9', 'damaged', 3], [50, 'P9', 'lost', 2], [14, 'P9', 'damaged', 1],
  [216, 'P10', 'lost', 5], [65, 'P10', 'damaged', 3],
  [265, 'P11', 'lost', 5], [92, 'P11', 'damaged', 2], [35, 'P11', 'lost', 3],
  [305, 'P12', 'lost', 6], [198, 'P12', 'damaged', 3], [45, 'P12', 'lost', 2],
];

// The sample in the data contract's shape, built from the tables above and RB_SAMPLE_TODAY.
function rbSampleData() {
  const t0 = rbDay(RB_SAMPLE_TODAY);
  const ago = n => rbIso(t0 - n * RB_DAY);
  const P = Object.fromEntries(RB_SAMPLE_PRODUCTS.map(([k, brand, asin, sku, fnsku, title]) => [k, { brand, asin, sku, fnsku, title }]));
  const n2 = n => (n < 10 ? '0' : '') + n, n4 = n => ('000' + n).slice(-4);
  const inbound = RB_SAMPLE_SHIP.map(([n, brand, status, d, items]) => ({
    brand, shipmentId: 'FBA19SAMPLE' + n2(n), name: `${brand === 'SP' ? 'Ridhi' : 'CPC'} restock ${n2(n)}`, status,
    createdAt: ago(d + 12), deliveredAt: ago(d), closedAt: status === 'CLOSED' ? ago(Math.max(0, d - 6)) : null,
    items: items.map(([k, shipped, received]) => ({ sku: P[k].sku, asin: P[k].asin, fnsku: P[k].fnsku, title: P[k].title, shipped, received })),
  }));
  const pay = ([n, d, k, reason, units, per, viaCase]) => ({ brand: P[k].brand, date: ago(d), reimbId: 'RBSAMPLE' + n4(n), caseId: viaCase ? 'SAMPLE-CASE-' + n4(n) : null,
    orderId: /Return|Customer/.test(reason) ? '111-SAMPLE-' + n4(n) : null, sku: P[k].sku, asin: P[k].asin, fnsku: P[k].fnsku, title: P[k].title,
    reason, cashUnits: units, invUnits: 0, amount: Math.round(units * per * 100) / 100, original: null });
  const payouts = RB_SAMPLE_PAY.map(pay);
  // The reversal: Amazon took back 2 runners it said were found (the original is payout 11); no unit of it found near the date.
  payouts.push(Object.assign(pay([46, 25, 'P3', 'Reimbursement_Reversal', -2, 3.70]), { original: { reimbId: 'RBSAMPLE0011' } }));
  const ledger = RB_SAMPLE_LEDGER.map(([d, k, kind, units], i) => ({ brand: P[k].brand, date: ago(d), fnsku: P[k].fnsku, sku: P[k].sku, asin: P[k].asin,
    title: P[k].title, kind, units, txnId: 'LEDSAMPLE' + n4(i + 1) }));
  const costs = Object.fromEntries(RB_SAMPLE_PRODUCTS.map(([, , asin, , , , sourcing, landed]) => [asin, { sourcing, landed }]));
  // The two case records of the sample (a person's own records come from reimbCases once the data is real).
  const step = (d, act, extra) => Object.assign({ t: t0 - d * RB_DAY + 10 * 3600000, act, email: 'sample@example.com', uid: '', person: 'Sample',
    dev: { id: '', label: 'sample data', name: '' } }, extra || {});
  const sampleCases = [
    { id: rbKey('SP', 'inbound', 'FBA19SAMPLE08'), brand: 'SP', type: 'inbound', itemKey: 'FBA19SAMPLE08', status: 'in_case', caseId: 'SAMPLE-0001',
      estimate: 64, checks: { own: true, pod: true, track: true }, note: '', reason: '', trail: [step(6, 'case-created', { caseId: 'SAMPLE-0001' })] },
    { id: rbKey('SP', 'underpaid', 'RBSAMPLE0014'), brand: 'SP', type: 'underpaid', itemKey: 'RBSAMPLE0014', status: 'archived', caseId: '',
      estimate: 7.2, checks: {}, note: '', reason: 'Too small to claim', trail: [step(40, 'archived', { reason: 'Too small to claim' })] },
  ];
  return { sample: true, source: 'sample', asOf: RB_SAMPLE_TODAY + 'T00:40:00Z', inbound, payouts, ledger, costs, sampleCases,
    have: { inbound: true, payouts: true, ledger: true } };
}
