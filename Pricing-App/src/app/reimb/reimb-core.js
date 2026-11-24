/* ================= REIMBURSEMENT · THE ENGINE: what Amazon owes us, what it paid, and what to claim (24 Nov 2026) =================
 * Pure functions only — no screen, no storage, no clock: "today" is always passed in, and nothing here reads Date.now().
 * Shared by the module's five pages (Overview and To Claim now; Paid, Cases and Fee Check later), and by tests/reimb-test.js.
 * SELLORA CHANGES NOTHING AT AMAZON. It finds the money, writes the case text, and keeps a record of each claim; the person
 * opens the case in Seller Central themselves.
 *
 * WHAT IS COUNTED TODAY (RB.LIVE_TYPES): inbound shortages, lost and damaged (or destroyed) in the warehouse, underpaid
 * reimbursements and reversals. Removals, disposals, returns and fee errors come later (RB.TYPES has their names and colours
 * already); the pages say so, so nobody reads the totals as complete.
 *
 * THE RULES (the numbers are in RB; the pages' "How Sellora counts" shows the same):
 *   VALUE        one order everywhere (rbValue): units × our SOURCING cost; else the LANDED cost, tagged "≈ landed" (landed
 *                includes freight, Amazon's sourcing cost does not); else AMAZON'S RATE, tagged "≈ Amazon's rate": the amount
 *                per unit of the latest payout that is not a reversal, in the last 12 months, for the same SKU, else the same
 *                ASIN, of the same brand (rbRates); else the units only, tagged "no cost", left out of every $ total.
 *                Amazon's-rate values count in the $ totals. UNDERPAID never uses Amazon's rate (it is judged against it).
 *   INBOUND      (shipped only from the backend cache reimbInbound: no report a person can download holds it)
 *                received: the cache's own; when it has none, the ledger's Receipts rows whose Reference ID is the
 *                shipment ID, summed per FNSKU (else SKU); neither → that SKU is not judged (never read as 0).
 *                start: deliveredAt, else closedAt, else the shipment's first ledger Receipt ("first check-in").
 *                missing per SKU = shipped − received − the units Amazon already paid for it: payouts whose reason matches
 *                RB.PAY_REASON.inbound, same FNSKU, dated on or after the start, given to that FNSKU's shipments oldest
 *                first. Nothing left on any SKU → "Paid"; some SKUs (or units) paid → "part paid". One shipment is one item
 *                (one shipment per case). "Wait" while the shipment is not CLOSED (when its status is known) or until
 *                RB.WAIT.inbound (15) days after the start; then "Claim now". Deadline RB.DEADLINE.inbound: 60 days after
 *                the start (not confirmed yet).
 *   LOST /       from the ledger's Adjustments and the payouts, per brand: one item per ledger event (its Reference ID, the
 *   DAMAGED      transaction ID), units = |quantity|. Lost: what is still open per FNSKU = lost − found − units paid with a
 *                reason matching RB.PAY_REASON.lost, the found / paid units covering the oldest event first (each only an
 *                event on or before its own date). Damaged and destroyed: the same with RB.PAY_REASON.damaged / .destroyed
 *                (no "found"). A row with an "Unreconciled Quantity" is Amazon's own view: that is its open units, and it
 *                wins. Fully covered by a payout → "Paid"; fully found again (nothing paid) → not an item. "Wait"
 *                RB.WAIT.warehouse (30) days after the event (Amazon usually pays these itself), then "Claim now"; deadline
 *                RB.DEADLINE.warehouse: 60 days after the event (not confirmed yet). Lost and damaged items of one brand
 *                and one type go in one case, at most RB.MAX_ITEMS (rbBatchCheck).
 *   PROOF        (inbound, on the case record: rbProofOf) invoice number, supplier, invoice link (http / https only:
 *                rbLinkOk), carrier, tracking numbers, delivered on, proof of delivery attached. "Needs proof"
 *                (rbNeedsProof): a Claim-now inbound item without (an invoice number or link) or without (tracking or
 *                a proof of delivery).
 *   UNDERPAID    a payout whose amount per unit is below our SOURCING cost (never landed). Gap = (cost − paid per unit) × units.
 *                Re-check window RB.DEADLINE.recheck: 90 days from the payout date (not confirmed yet). A later payout naming
 *                it as its original (Amazon's top-up) → "Paid".
 *   REVERSAL     a payout with a negative amount (Amazon took money back, saying the unit was found). Disputable only when the
 *                ledger shows no 'found' unit for that FNSKU within RB.FOUND_DAYS (30) days before or after it; with one, it is
 *                not an item at all. Window RB.DEADLINE.reversal: 90 days (not confirmed yet). A later payout naming it as its
 *                original → "Paid".
 *   STATUS       in this order: archived, paid, in a case (from the saved case records) win; else expired (past the deadline);
 *                else wait; else claim. The deadline day itself is still open ("0 days left"); the day after is expired.
 *   DUPLICATES   Amazon treats a second claim for the same thing as abuse: an item already in a case, already paid or
 *                archived can never get "Make case" (rbDupCheck says why).
 *   LIMITS       at most RB.MAX_ITEMS (10) items per case, and Amazon advises under RB.MAX_OPEN (10) open cases: a warning,
 *                never a block.
 *
 * THE DATA CONTRACT — what rbLoad (reimb-data.js) hands over: the backend caches, else the uploads, else nothing (the sample
 * with ?sample=1), always the same shape.
 *   { sample: true | false, asOf: ISO time,
 *     inbound: [{ brand: 'SP' | 'CPC', shipmentId, name, status: 'RECEIVING' | 'CLOSED' | … (or missing), createdAt,
 *                 deliveredAt, closedAt (either may be missing), carrier?, tracking?: ['…'],   // carrier / tracking prefill the proof
 *                 items: [{ sku, asin, fnsku, title, shipped, received (missing → the ledger's Receipts) }] }],
 *     payouts: [{ brand, date, reimbId, caseId | null, orderId | null, sku, asin, fnsku, title, reason, cashUnits, invUnits,
 *                 amount, original: { reimbId } | null }],          // amount < 0 with units = a reversal
 *     ledger:  [{ brand, date, fnsku, sku, asin, title, kind: 'lost' | 'found' | 'damaged' | 'destroyed' | 'receipt' | 'other',
 *                 units (≥ 0), qty? (signed), txnId (the Reference ID: a transaction ID, or a shipment ID on a Receipt),
 *                 reason? (the code), unrec? (Unreconciled Quantity, null when blank) }],
 *     costs:   { [asin]: { sourcing: number | null, landed: number | null } } }
 *   Dates are 'YYYY-MM-DD' or ISO times; each is read as its calendar day. Money is US dollars.
 *   have:    { inbound, payouts, ledger, ledgerBrands?, payoutBrands? }: which parts are there at all (rbLoad, reimb-data.js).
 *            A part that is missing is NOT read as zero: no reversal, lost or damaged item is judged without its brand's
 *            ledger, no lost or damaged item without its brand's payouts (what Amazon already paid), no inbound shortage
 *            without the shipments.
 * The backend caches (when the backend team writes them, read through ?cache=, as every Ads screen does):
 *   reimbPaid    { at, d: { SP: [payout rows], CPC: [...] } }     reimbLedger  { at, d: { SP: [ledger rows], … } }
 *   reimbInbound { at, d: { SP: [shipments], … } }                (rows in the shapes above; brand taken from the key)
 * Until then a person uploads Amazon's own reports (rbParseReport below; reimb-data.js keeps them).
 * COSTS ON SCREEN: Profit & Margin's unit cost is the LANDED cost, so values from it always show as "≈ landed"; nobody has
 * entered SOURCING costs yet, so Underpaid says it needs them (rbOverview: underpaid.sourcing) instead of a $ figure.
 * THE CASE RECORDS (Firestore reimbCases/{brand_type_itemKey}, saved by the page — never by this file):
 *   { brand, type, itemKey, status: 'draft' | 'in_case' | 'paid' | 'archived', caseId, estimate, checks: { key: true },
 *     proof: { invoiceNo, supplier, invoiceLink, carrier, tracking: ['…'], deliveredOn, podAttached } (inbound),
 *     batch: [keys] (a case of several lost / damaged items), note, reason, trail: [{ t, act, email, uid, person, dev }] }
 *   ('draft' = proof saved or ticked, no case yet: counts as none)
 *
 * Main functions: rbDay, rbValue, rbRates, rbDaysLeft, rbItems, rbStatus, rbDupCheck, rbProofOf, rbNeedsProof, rbLinkOk,
 * rbBatchCheck, rbPeriod, rbOverview, rbWeekList, rbChart, rbMostLost, rbCaseText, rbDaysPill, rbPctClass, rbCsvLines. */

const RB_DAY = 86400000;
const RB = {
  WAIT_DAYS: 15,      // days after the start while Amazon may still be counting an inbound shipment (= WAIT.inbound)
  // Days to wait before claiming: inbound after the start; lost / damaged after the ledger event (Amazon usually pays those itself).
  WAIT: { inbound: 15, warehouse: 30 },
  FOUND_DAYS: 30,     // a reversal is disputable when no unit of its FNSKU was found this many days either side of it
  EXPIRING: 14,       // "Expiring in 14 days"
  UNDER_MIN: 0.01,    // paid per unit at least this far under our sourcing cost before it counts as underpaid ($)
  RATE_DAYS: 365,     // Amazon's rate: its latest payout for the product within this many days
  MAX_ITEMS: 10,      // items Amazon takes in one case
  MAX_OPEN: 10,       // open cases Amazon advises staying under (its own guidance; Sellerise shows the same)
  // The windows to claim in. None is confirmed yet: the page says "check the deadline in Seller Central" with each.
  DEADLINE: {
    inbound: { days: 60, from: 'the start', confirmed: false, t: '60 days after delivery (or the first check-in)' },
    warehouse: { days: 60, from: 'the ledger event', confirmed: false, t: '60 days after the ledger event' },
    recheck: { days: 90, from: 'the payout date', confirmed: false, t: '90 days from the payout date' },
    reversal: { days: 90, from: 'the reversal date', confirmed: false, t: '90 days from the reversal date' },
  },
  /* Which payouts pay for what, by their reason. NOT YET CHECKED AGAINST A REAL REIMBURSEMENTS FILE of ours (the reasons are
   * from Amazon's help pages: Lost_Inbound, Lost_Warehouse, Damaged_Warehouse, …): check them against the first real upload,
   * and widen a pattern if Amazon's own words differ. A payout matching none of them pays for nothing here. */
  PAY_REASON: {
    inbound: /inbound/i,
    lost: /lost.*warehouse|warehouse.*lost|misplaced/i,
    damaged: /damag.*warehouse|warehouse.*damag/i,
    destroyed: /destroy/i,
  },
  // Every claim type, with its colour token (the page's dot) and how "Not counted yet" names it. live: counted today.
  TYPES: {
    inbound: { t: 'Inbound shortage', short: 'Inbound', c: '--brand', live: true },
    lost: { t: 'Lost in the warehouse', short: 'Lost', c: '--act-ink', live: true },
    damaged: { t: 'Damaged in the warehouse', short: 'Damaged', c: '--rev', live: true },
    underpaid: { t: 'Underpaid', short: 'Underpaid', c: '--act', live: true },
    reversal: { t: 'Reversal', short: 'Reversal', c: '--bad', live: true },
    removal: { t: 'Removal', short: 'Removal', c: '--violet-ink', later: 'removals' },
    disposal: { t: 'Disposal', short: 'Disposal', c: '--faint', later: 'disposals' },
    returns: { t: 'Customer returns', short: 'Returns', c: '--brand-ink', later: 'returns' },
    fee: { t: 'Fee error', short: 'Fee', c: '--accent-ink', later: 'fee errors' },
  },
  // What happened in the warehouse (a lost / damaged item's event tag): words and the dot's colour token.
  KIND: {
    lost: { t: 'Lost', c: '--act-ink' },
    damaged: { t: 'Damaged', c: '--rev' },
    destroyed: { t: 'Destroyed', c: '--bad-ink' },
  },
  // The status pill: its words and its look (the page's rb-st-… class).
  STATUS: {
    claim: { t: 'Claim now', cls: 'claim' },
    wait: { t: 'Wait', cls: 'wait' },
    in_case: { t: 'In a case', cls: 'case' },
    paid: { t: 'Paid', cls: 'paid' },
    expired: { t: 'Expired', cls: 'expired' },
    archived: { t: 'Archived', cls: 'archived' },
  },
  // Why an item may be archived.
  ARCHIVE: ['Already paid', 'Not Amazon\'s error', 'Too small to claim', 'Other'],
  // The payout reasons as the chart groups them, with the type whose colour each takes.
  REASONS: [['Inbound', 'inbound'], ['Lost', 'lost'], ['Damaged', 'damaged'], ['Returns', 'returns'], ['Removal', 'removal'], ['Other', 'disposal']],
  // What to keep ready for each case (each a tick the page saves): [key, words]. Inbound has its own proof fields instead
  // (rbProofOf: the invoice, the tracking, the proof of delivery).
  PROOF: {
    lost: [['ledger', 'The inventory ledger rows for these FNSKUs (the lost adjustments)']],
    damaged: [['ledger', 'The inventory ledger rows for these transaction IDs (the damaged / destroyed adjustments)']],
    underpaid: [['inv', 'Supplier invoice showing our cost for this item']],
    reversal: [['ledger', 'The inventory ledger for this FNSKU around the date (no unit found)']],
  },
  // The Seller Central steps for each case. The lost and damaged ones are from Amazon's help pages: verify the menu names in
  // Seller Central the first time.
  STEPS: {
    inbound: ['Seller Central → Shipments (Shipping queue) → open the shipment', 'Track shipment / Reconcile',
      '"Research missing units" for each SKU below', 'Attach the invoice, the proof of delivery and the tracking (Proof, below)',
      'Paste the case text', 'Submit, then put the case ID here'],
    lost: ['Help → Get support → Selling on Amazon → Fulfillment by Amazon', 'Choose lost inventory in a fulfillment center ("lost in warehouse")',
      'Enter each FNSKU below with its units (the form takes the list)', 'Paste the case text', 'Submit, then put the case ID here'],
    damaged: ['Help → Get support → Selling on Amazon → Fulfillment by Amazon', 'Choose damaged inventory in a fulfillment center (the damaged-status tool)',
      'Enter each transaction ID below with its FNSKU and units', 'Paste the case text', 'Submit, then put the case ID here'],
    underpaid: ['Help → Get support → Selling on Amazon → Fulfillment by Amazon', 'Choose the reimbursement inquiry (FBA reimbursements)',
      'Give the reimbursement ID and the supplier invoice', 'Paste the case text', 'Submit, then put the case ID here'],
    reversal: ['Help → Get support → Selling on Amazon → Fulfillment by Amazon', 'Choose the reimbursement inquiry (a reversal)',
      'Give the reversal\'s reimbursement ID and the original one', 'Paste the case text', 'Submit, then put the case ID here'],
  },
  // How to set our sourcing cost at Amazon, so it pays the right amount next time (the page's "How to fix (2 steps)").
  FIX_STEPS: ['Seller Central → Inventory → Inventory Defect and Reimbursement → Manage Your Sourcing Cost',
    'Bulk upload → download the template → enter our costs in "Seller Cost - New" → upload it'],
};
// The live types, and the ones not counted yet as "Not counted yet" names them (each once).
RB.LIVE_TYPES = Object.keys(RB.TYPES).filter(k => RB.TYPES[k].live);
RB.LATER = [...new Set(Object.keys(RB.TYPES).filter(k => !RB.TYPES[k].live).map(k => RB.TYPES[k].later))];
// The types To Claim lists (underpaid is a re-check, on Overview), and the ones it shows greyed as "coming soon".
RB.CLAIM_TYPES = ['inbound', 'lost', 'damaged', 'reversal'];
RB.COMING = ['removal', 'disposal', 'returns'];
/* THE INVENTORY LEDGER'S REASON CODES → what happened to the units (Adjustments rows). Taken from Amazon's help pages on the
 * Inventory Ledger, NOT YET CHECKED AGAINST A REAL FILE of ours: check it against the first upload, and add any code that turns
 * up as "other". A code not listed is never dropped: it is kept as 'other' and counted ("N rows with other reason codes"). */
RB.REASON_MAP = { M: 'lost', 5: 'lost', F: 'found', 6: 'damaged', 7: 'damaged', E: 'damaged', H: 'damaged', K: 'damaged', U: 'damaged', D: 'destroyed' };
// The two reports a person can upload: where to find them, what each one unlocks, and their columns. need: refused without it;
// opt: read when there. Headers are matched ignoring case, spaces, underscores and hyphens (rbHead).
RB.REPORTS = {
  payouts: { t: 'Reimbursements report', where: 'Seller Central → Reports → Fulfillment → Reimbursements (tab- or comma-separated)',
    unlocks: 'Recovered, Payouts by month, reversals, and Underpaid once sourcing costs are in',
    need: ['approval-date', 'reimbursement-id', 'case-id', 'reason', 'sku', 'fnsku', 'asin', 'amount-total', 'quantity-reimbursed-cash',
      'quantity-reimbursed-inventory', 'original-reimbursement-id'],
    opt: ['amazon-order-id', 'product-name', 'condition', 'currency-unit', 'amount-per-unit', 'quantity-reimbursed-total', 'original-reimbursement-type'] },
  ledger: { t: 'Inventory Ledger, Detailed view', where: 'Seller Central → Reports → Fulfillment → Inventory → Inventory Ledger → Detailed view (CSV)',
    unlocks: 'Most-lost products, and the check that makes a reversal disputable',
    need: ['date', 'fnsku', 'asin', 'msku', 'title', 'event-type', 'reference-id', 'quantity', 'reason'],
    opt: ['fulfillment-center', 'disposition', 'reconciled-quantity', 'unreconciled-quantity'] },
};
// Seller Central's pages, in ONE place. US marketplace — verify each in Seller Central before relying on it.
const RB_LINKS = {
  cases: 'https://sellercentral.amazon.com/cu/case-dashboard',                    // verify in Seller Central: Case Log
  support: 'https://sellercentral.amazon.com/help/hub/support',                   // verify in Seller Central: Get support
  shipments: 'https://sellercentral.amazon.com/fba/inbound-queue',                // verify in Seller Central: Shipping queue
  sourcing: 'https://sellercentral.amazon.com/reportcentral/REIMBURSEMENTS/0',    // verify in Seller Central: Reimbursements
};
const RB_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------- days ---------- */
// A day as ms at 00:00 UTC: from 'YYYY-MM-DD', an ISO time (its date part) or ms; null when missing or unreadable.
function rbDay(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.floor(v / RB_DAY) * RB_DAY : null;
  const t = Date.parse(String(v).slice(0, 10) + 'T00:00:00Z');
  return isFinite(t) ? t : null;
}
const rbIso = ms => (ms == null ? '' : new Date(ms).toISOString().slice(0, 10));
// "24 Nov 2026".
const rbDate = ms => { if (ms == null) return ''; const d = new Date(ms); return `${d.getUTCDate()} ${RB_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// Whole days from today to a deadline: 0 on the deadline day, −1 the day after.
const rbDaysLeft = (deadline, today) => Math.round((deadline - rbDay(today)) / RB_DAY);
const rbMoney = v => (v == null ? '' : (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2));

/* ---------- value ---------- */
// The value of units: { v ($, or null with no cost), per (the $ per unit used), basis ('sourcing' | 'landed' | 'amazon' | ''),
// approx (landed only), noCost, by ('sku' | 'asin': which product Amazon's rate came from) }. One order everywhere: our
// sourcing cost, else the landed cost, else Amazon's rate (rate: what rbRates found), else none.
function rbValue(units, cost, rate) {
  const u = Number(units) || 0, c = cost || {};
  if (Number(c.sourcing) > 0) return { v: u * c.sourcing, per: Number(c.sourcing), basis: 'sourcing', approx: false, noCost: false };
  if (Number(c.landed) > 0) return { v: u * c.landed, per: Number(c.landed), basis: 'landed', approx: true, noCost: false };
  if (rate && Number(rate.per) > 0) return { v: u * rate.per, per: Number(rate.per), basis: 'amazon', approx: false, noCost: false, by: rate.by };
  return { v: null, per: null, basis: '', approx: false, noCost: true };
}
// Amazon's rate per product: the amount per unit of its latest payout in the last RB.RATE_DAYS days that is not a reversal
// (cash units only: an inventory reimbursement has no amount per unit), per brand. → look(brand, sku, asin): { per, by,
// payout } from the same SKU, else the same ASIN, or null.
function rbRates(pays, today) {
  const t0 = rbDay(today), from = t0 - RB.RATE_DAYS * RB_DAY;
  const bySku = new Map(), byAsin = new Map();
  (pays || []).forEach(p => {
    const a = Number(p.amount) || 0, u = Number(p.cashUnits) || 0, d = rbDay(p.date);
    if (!(a > 0) || !(u > 0) || d == null || d < from || d > t0 || rbReasonGroup(p.reason) === 'Reversal') return;
    const r = { per: a / u, payout: p, d };
    const put = (m, id) => {
      if (!id) return;
      const k = p.brand + '|' + id, o = m.get(k);
      if (!o || d > o.d || (d === o.d && String(p.reimbId) > String(o.payout.reimbId))) m.set(k, r);
    };
    put(bySku, p.sku);
    put(byAsin, p.asin);
  });
  return (brand, sku, asin) => {
    const s = sku && bySku.get(brand + '|' + sku);
    if (s) return { per: s.per, by: 'sku', payout: s.payout };
    const a = asin && byAsin.get(brand + '|' + asin);
    return a ? { per: a.per, by: 'asin', payout: a.payout } : null;
  };
}
// A payout reason as the chart groups it: Inbound, Lost, Damaged, Returns, Removal, Other — or Reversal.
function rbReasonGroup(reason) {
  const r = String(reason || '').toLowerCase();
  if (/revers/.test(r)) return 'Reversal';
  if (/inbound/.test(r)) return 'Inbound';
  if (/removal/.test(r)) return 'Removal';
  if (/return|customer/.test(r)) return 'Returns';
  if (/damag|destroy/.test(r)) return 'Damaged';
  if (/lost|missing/.test(r)) return 'Lost';
  return 'Other';
}
const rbUnits = p => Math.abs(Number(p.cashUnits) || 0) + Math.abs(Number(p.invUnits) || 0);
const rbWaitOf = type => (type === 'inbound' ? RB.WAIT.inbound : type === 'lost' || type === 'damaged' ? RB.WAIT.warehouse : 0);
const rbDeadlineOf = type => RB.DEADLINE[type === 'inbound' ? 'inbound' : type === 'lost' || type === 'damaged' ? 'warehouse' : type === 'underpaid' ? 'recheck' : 'reversal'];

/* ---------- the items: one per thing to claim ---------- */
// Every inbound shortage, lost / damaged event, underpaid payout and disputable reversal, each with its status, days left
// and what blocks a case. recs: the saved case records (a Map or an object by key 'brand_type_itemKey'). today: a day.
// Item: { key, brand, type, itemKey, title, sku, asin, fnsku, units (still owed), value (or null), approx, rate (valued at
//   Amazon's rate), noCostUnits, event (day ms), deadline, daysLeft, opensIn (wait: days until it opens; null while not
//   closed), status, rec, block (why no case), needsProof (inbound), … }
function rbItems(data, recs, today) {
  const t0 = rbDay(today);
  const costs = (data && data.costs) || {}, pays = (data && data.payouts) || [], led = (data && data.ledger) || [];
  const recOf = k => (!recs ? null : typeof recs.get === 'function' ? recs.get(k) || null : recs[k] || null);
  const rate = rbRates(pays, t0);
  const valOf = (units, x, brand) => rbValue(units, costs[x.asin], rate(brand, x.sku, x.asin));
  const H = (data && data.have) || null;
  // (have.ledgerBrands / payoutBrands: the brands whose report is there, when it is known per brand — an upload is one brand's)
  const ledgerKnown = b => !H || (H.ledger !== false && (!H.ledgerBrands || H.ledgerBrands.includes(b)));
  const paysKnown = b => !H || (H.payouts !== false && (!H.payoutBrands || H.payoutBrands.includes(b)));
  const out = [];
  const add = it => {
    it.key = rbKey(it.brand, it.type, it.itemKey);
    it.rec = recOf(it.key);
    it.daysLeft = rbDaysLeft(it.deadline, t0);
    it.status = rbStatus(it, it.rec, t0);
    it.block = rbDupCheck(it, it.rec);
    if (it.type === 'inbound') it.needsProof = rbNeedsProof(it, it.rec);
    out.push(it);
  };
  const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
  const group = (list, keyOf) => { const m = new Map(); list.forEach(x => { const k = keyOf(x); if (k) (m.get(k) || m.set(k, []).get(k)).push(x); }); return m; };
  // Units paid (or found) in date order, handed to the oldest claim first: each pot only to a claim dated on or before it.
  const pots = list => list.map(x => ({ x, d: x.d, left: x.u })).sort((a, z) => a.d - z.d);
  const take = (pot, from, need, onTake) => {
    for (const q of pot) {
      if (need <= 0) break;
      if (q.left <= 0 || q.d < from) continue;
      const n = Math.min(need, q.left);
      q.left -= n;
      need -= n;
      onTake(q.x, n);
    }
    return need;
  };

  // --- inbound shortages: one item per shipment ---
  const rcpt = group(led.filter(l => l.kind === 'receipt' && l.txnId), l => l.brand + '|' + l.txnId);
  const ships = ((data && data.inbound) || []).map(s => {
    const rr = rcpt.get(s.brand + '|' + s.shipmentId) || [];
    const ins = rr.map(l => rbDay(l.date)).filter(v => v != null);
    const firstIn = ins.length ? Math.min(...ins) : null;
    const del = rbDay(s.deliveredAt), clo = rbDay(s.closedAt);
    const start = del != null ? del : clo != null ? clo : firstIn;
    const startFrom = del != null ? 'delivered' : clo != null ? 'closed' : firstIn != null ? 'checkin' : '';
    const skus = (s.items || []).map(x => {
      let received = x.received == null || x.received === '' ? null : Number(x.received) || 0, recvFrom = received == null ? '' : 'amazon';
      if (received == null) {
        const mine = rr.filter(l => (x.fnsku ? l.fnsku === x.fnsku : !!x.sku && l.sku === x.sku));
        if (mine.length) { received = sum(mine, l => Number(l.qty != null ? l.qty : l.units) || 0); recvFrom = 'ledger'; }
      }
      const shipped = Number(x.shipped) || 0;
      return Object.assign({}, x, { shipped, received, recvFrom, gap: received == null ? 0 : Math.max(0, shipped - received), paid: 0, paidBy: [] });
    });
    return { s, start, startFrom, skus };
  });
  // Inbound payouts per brand + FNSKU, given to that FNSKU's shipments oldest first.
  const inPay = group(pays.filter(p => Number(p.amount) > 0 && RB.PAY_REASON.inbound.test(String(p.reason || '')) && p.fnsku),
    p => p.brand + '|' + p.fnsku);
  const inPot = new Map([...inPay].map(([k, l]) => [k, pots(l.map(p => ({ p, d: rbDay(p.date), u: rbUnits(p) })))]));
  ships.filter(x => x.start != null).sort((a, z) => (a.start - z.start) || (String(a.s.shipmentId) < String(z.s.shipmentId) ? -1 : 1)).forEach(x => {
    x.skus.forEach(k => {
      if (!(k.gap > 0)) return;
      take(inPot.get(x.s.brand + '|' + k.fnsku) || [], x.start, k.gap, (o, n) => { k.paid += n; k.paidBy.push(o.p); });
    });
  });
  ships.forEach(({ s, start, startFrom, skus: all }) => {
    if (start == null) return;
    all.forEach(k => {
      k.missing = Math.max(0, k.gap - k.paid);
      k.val = valOf(k.missing, k, s.brand);
    });
    const skus = all.filter(k => k.gap > 0);
    if (!skus.length) return;
    const open = skus.filter(k => k.missing > 0);
    const known = open.filter(k => k.val.v != null);
    const first = skus[0];
    const st = String(s.status || ''), stKnown = st !== '', closed = !stKnown || /^CLOSED$/i.test(st);
    const days = Math.round((t0 - start) / RB_DAY);
    add({ brand: s.brand, type: 'inbound', itemKey: s.shipmentId, title: s.name || s.shipmentId, shipment: s, skus, allSkus: all,
      sku: skus.length === 1 ? first.sku : `${skus.length} SKUs`, asin: skus.length === 1 ? first.asin : '', fnsku: skus.length === 1 ? first.fnsku : '',
      shipped: sum(all.filter(k => k.received != null), k => k.shipped), received: sum(all.filter(k => k.received != null), k => k.received),
      paidUnits: sum(skus, k => k.paid), recvFrom: [...new Set(all.map(k => k.recvFrom).filter(Boolean))], unknown: all.filter(k => k.received == null),
      units: sum(open, k => k.missing), value: known.length ? sum(known, k => k.val.v) : null,
      approx: known.some(k => k.val.approx), rate: known.some(k => k.val.basis === 'amazon'), noCostUnits: sum(open.filter(k => k.val.noCost), k => k.missing),
      paidAll: !open.length, paidBy: (skus.find(k => k.paidBy.length) || { paidBy: [] }).paidBy.slice(-1)[0] || null,
      partPaid: open.length > 0 && skus.some(k => k.paid > 0), startFrom,
      event: start, deadline: start + RB.DEADLINE.inbound.days * RB_DAY, closed, statusKnown: stKnown,
      opensIn: closed ? Math.max(0, RB.WAIT.inbound - days) : null });
  });

  // --- lost, damaged and destroyed in the warehouse: one item per ledger event ---
  const evs = led.filter(l => (l.kind === 'lost' || l.kind === 'damaged' || l.kind === 'destroyed') && l.fnsku && ledgerKnown(l.brand) && paysKnown(l.brand));
  const potOf = new Map();   // brand|fnsku|kind → the found / paid units that may cover its events
  const potFor = (b, f, kind) => {
    const k = b + '|' + f + '|' + kind;
    if (!potOf.has(k)) {
      const re = RB.PAY_REASON[kind];
      const paid = pays.filter(p => p.brand === b && p.fnsku === f && Number(p.amount) > 0 && re.test(String(p.reason || '')))
        .map(p => ({ src: 'paid', p, d: rbDay(p.date), u: rbUnits(p) }));
      const found = kind !== 'lost' ? [] : led.filter(l => l.brand === b && l.fnsku === f && l.kind === 'found')
        .map(l => ({ src: 'found', l, d: rbDay(l.date), u: Math.abs(Number(l.units) || 0) }));
      // Found units first on the same day (the unit came back before Amazon paid for it).
      potOf.set(k, pots(found.concat(paid)).sort((a, z) => (a.d - z.d) || (a.x.src === 'found' ? -1 : 1)));
    }
    return potOf.get(k);
  };
  const seen = new Set();
  evs.map(l => ({ l, d: rbDay(l.date) })).filter(e => e.d != null)
    .sort((a, z) => (a.d - z.d) || (String(a.l.txnId) < String(z.l.txnId) ? -1 : 1))
    .forEach(({ l, d }) => {
      const units = Math.abs(Number(l.units != null ? l.units : l.qty) || 0);
      if (!units) return;
      const pot = potFor(l.brand, l.fnsku, l.kind);
      let found = 0, paid = 0, lastPay = null;
      const onTake = (x, n) => { if (x.src === 'found') found += n; else { paid += n; lastPay = x.p; } };
      const unrec = l.unrec == null || l.unrec === '' ? null : Math.abs(Number(l.unrec) || 0);
      let open;
      if (unrec != null) {
        // Amazon's own view of what is still open wins; the units it says were reconciled use up found / paid units.
        open = Math.min(units, unrec);
        take(pot, d, units - open, onTake);
      } else open = take(pot, d, units, onTake);
      if (!open && !paid) return;   // all found again: nothing lost, nothing paid — not an item
      const type = l.kind === 'lost' ? 'lost' : 'damaged';
      let itemKey = String(l.txnId || `${rbIso(d)}-${l.fnsku}`);
      if (seen.has(l.brand + type + itemKey)) itemKey += '-' + l.fnsku;
      seen.add(l.brand + type + itemKey);
      const val = valOf(open, l, l.brand);
      const days = Math.round((t0 - d) / RB_DAY);
      add({ brand: l.brand, type, kind: l.kind, itemKey, title: l.title || l.sku, sku: l.sku, asin: l.asin, fnsku: l.fnsku, ledger: l,
        eventUnits: units, found, paid, unrec, code: l.reason || '', txnId: l.txnId || '',
        units: open, value: open ? val.v : null, approx: !!open && val.approx, rate: !!open && val.basis === 'amazon', noCostUnits: open && val.noCost ? open : 0,
        paidAll: !open, paidBy: lastPay,
        event: d, deadline: d + RB.DEADLINE.warehouse.days * RB_DAY, closed: true, opensIn: Math.max(0, RB.WAIT.warehouse - days) });
    });

  // --- underpaid payouts: one item per payout (our sourcing cost only: never landed, never Amazon's rate) ---
  pays.forEach(p => {
    const amount = Number(p.amount) || 0, units = Number(p.cashUnits) || 0;
    if (!(amount > 0) || !(units > 0)) return;
    const cost = Number((costs[p.asin] || {}).sourcing);
    if (!(cost > 0)) return;
    const per = amount / units;
    if (per > cost - RB.UNDER_MIN) return;
    const d = rbDay(p.date);
    const topUp = pays.find(o => o !== p && Number(o.amount) > 0 && o.original && o.original.reimbId === p.reimbId) || null;
    add({ brand: p.brand, type: 'underpaid', itemKey: p.reimbId, title: p.title || p.sku, sku: p.sku, asin: p.asin, fnsku: p.fnsku, payout: p,
      units, per, cost, value: (cost - per) * units, approx: false, noCostUnits: 0, paidAll: !!topUp, paidBy: topUp,
      event: d, deadline: d + RB.DEADLINE.recheck.days * RB_DAY, closed: true, opensIn: null });
  });
  // --- reversals: one item per reversal that the ledger does not explain (none without the ledger: it cannot be checked) ---
  pays.forEach(p => {
    const amount = Number(p.amount) || 0;
    if (!(amount < 0) || !ledgerKnown(p.brand)) return;
    const d = rbDay(p.date);
    const near = led.filter(l => l.brand === p.brand && l.fnsku === p.fnsku && l.kind === 'found' && Math.abs(rbDay(l.date) - d) <= RB.FOUND_DAYS * RB_DAY);
    if (near.reduce((t, l) => t + (Number(l.units) || 0), 0) > 0) return;   // Amazon did find units: not disputable
    const orig = (p.original && pays.find(o => o.reimbId === p.original.reimbId)) || null;
    const back = pays.find(o => o !== p && Number(o.amount) > 0 && o.original && o.original.reimbId === p.reimbId) || null;
    add({ brand: p.brand, type: 'reversal', itemKey: p.reimbId, title: p.title || p.sku, sku: p.sku, asin: p.asin, fnsku: p.fnsku, payout: p, original: orig,
      units: rbUnits(p), value: Math.abs(amount), approx: false, noCostUnits: 0, paidAll: !!back, paidBy: back,
      checkFrom: d - RB.FOUND_DAYS * RB_DAY, checkTo: d + RB.FOUND_DAYS * RB_DAY,
      event: d, deadline: d + RB.DEADLINE.reversal.days * RB_DAY, closed: true, opensIn: null });
  });
  return out;
}
// One item's record key: 'SP_inbound_FBA19SAMPLE01' (Firestore reimbCases/{key}; no slash can reach it).
const rbKey = (brand, type, itemKey) => [brand, type, String(itemKey || '').replace(/[\/\s]+/g, '-')].join('_');

// The status of one item: archived / paid / in a case win; else expired; else wait; else claim.
function rbStatus(item, rec, today) {
  const t0 = rbDay(today);
  if (rec && rec.status === 'archived') return 'archived';
  if ((rec && rec.status === 'paid') || item.paidAll) return 'paid';
  if (rec && rec.status === 'in_case') return 'in_case';
  if (rbDaysLeft(item.deadline, t0) < 0) return 'expired';
  if (item.type === 'inbound' && !item.closed) return 'wait';
  if (t0 - item.event < rbWaitOf(item.type) * RB_DAY) return 'wait';
  return 'claim';
}
// Why this item may never get "Make case" (Amazon reads a second claim as abuse), or '' when nothing stands in the way.
function rbDupCheck(item, rec) {
  if (rec && rec.status === 'in_case') return 'Already in case' + (rec.caseId ? ' ' + rec.caseId : '') + ': a second claim would be a duplicate';
  if ((rec && rec.status === 'paid') || item.paidAll) {
    const p = item.paidBy;
    return 'Already paid' + (p ? ` on ${rbDate(rbDay(p.date))} (reimbursement ${p.reimbId})` : '') + ': a claim now would be a duplicate';
  }
  if (rec && rec.status === 'archived') return 'Archived' + (rec.reason ? ` (${rec.reason})` : '') + ': restore it first';
  return '';
}

/* ---------- the proof of an inbound claim, and the cases of several items ---------- */
// A list of tracking numbers from what a person typed (commas, spaces or new lines between them), each once.
const rbTrackList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(s => String(s).trim()).filter(Boolean))].slice(0, 30);
// An invoice link: empty is fine; otherwise http:// or https:// only (never javascript:, data:, a file path…).
function rbLinkOk(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { ok: true, url: '' };
  if (!/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(s)) return { ok: false, url: '', err: 'The invoice link must start with http:// or https://' };
  return { ok: true, url: s };
}
// The proof of an inbound item: what the record saved, else what the shipment itself says (carrier, tracking, delivery day).
function rbProofOf(it, rec) {
  const s = (it && it.shipment) || {}, p = (rec && rec.proof) || {};
  const saved = rbTrackList(p.tracking);
  return { invoiceNo: String(p.invoiceNo || ''), supplier: String(p.supplier || ''), invoiceLink: rbLinkOk(p.invoiceLink).url,
    carrier: String(p.carrier || s.carrier || ''), tracking: saved.length ? saved : rbTrackList(s.tracking),
    deliveredOn: String(p.deliveredOn || (s.deliveredAt ? rbIso(rbDay(s.deliveredAt)) : '')), podAttached: !!p.podAttached,
    fromShipment: !saved.length && rbTrackList(s.tracking).length > 0 };
}
// What an inbound claim still lacks: [] when it has (an invoice number or link) and (tracking or a proof of delivery).
function rbProofMissing(it, rec) {
  const p = rbProofOf(it, rec), miss = [];
  if (!p.invoiceNo && !p.invoiceLink) miss.push('the invoice (its number or a link)');
  if (!p.tracking.length && !p.podAttached) miss.push('the tracking or a proof of delivery');
  return miss;
}
// "Needs proof": a Claim-now inbound item missing either half.
const rbNeedsProof = (it, rec) => !!it && it.type === 'inbound' && it.status === 'claim' && rbProofMissing(it, rec).length > 0;
// May these items go in ONE case? '' when they may, else why not. Lost and damaged: one brand, one type, at most
// RB.MAX_ITEMS. Inbound: one shipment per case; a reversal or an underpaid payout: one per case. Every item open to claim,
// and never one already in a case, paid or archived.
function rbBatchCheck(list) {
  list = list || [];
  if (!list.length) return 'Tick at least one item';
  const t = list[0].type;
  if (list.some(i => i.type !== t)) return `${RB.TYPES[t].short} and ${RB.TYPES[list.find(i => i.type !== t).type].short} items go in separate cases`;
  if (list.length > 1 && t === 'inbound') return 'One shipment per case: Amazon researches each shipment on its own';
  if (list.length > 1 && t !== 'lost' && t !== 'damaged') return `One ${RB.TYPES[t].short.toLowerCase()} per case`;
  if (list.some(i => i.brand !== list[0].brand)) return 'One brand per case: each brand is its own Seller Central account';
  if (list.length > RB.MAX_ITEMS) return `Amazon takes at most ${RB.MAX_ITEMS} items in one case`;
  const bad = list.find(i => i.block);
  if (bad) return `${bad.itemKey}: ${bad.block}`;
  const shut = list.find(i => i.status !== 'claim');
  if (shut) return `${shut.itemKey} is not open to claim (${RB.STATUS[shut.status].t})`;
  return '';
}

/* ---------- the period, and the six boxes ---------- */
// key '30' | '90' | '365' | 'custom' (from / to, either order) → { key, from, to, days, prevFrom, prevTo }: days inclusive; the
// previous period is the same length just before.
function rbPeriod(key, today, from, to) {
  const t0 = rbDay(today);
  let a, z;
  const f = rbDay(from), g = rbDay(to);
  if (key === 'custom' && f != null && g != null) { a = Math.min(f, g); z = Math.max(f, g); }
  else { const n = key === '90' ? 90 : key === '365' ? 365 : 30; z = t0; a = t0 - (n - 1) * RB_DAY; }
  const days = Math.round((z - a) / RB_DAY) + 1;
  return { key: key === 'custom' && f != null && g != null ? 'custom' : (['90', '365'].includes(key) ? key : '30'), from: a, to: z, days,
    prevFrom: a - days * RB_DAY, prevTo: a - RB_DAY };
}
const rbIn = (ms, a, z) => ms != null && ms >= a && ms <= z;
// A change: { now, was, pct (null when there was nothing before), dir: 'up' | 'down' | 'flat' }.
function rbDelta(now, was) {
  return { now, was, pct: was > 0 ? (now - was) / was * 100 : null, dir: Math.abs(now - was) < 0.005 ? 'flat' : now > was ? 'up' : 'down' };
}
// The six boxes. Owed now, Expiring, Underpaid and Open cases are TODAY; Recovered and Lost to deadlines are the period's,
// against the period before. brand: 'ALL' | 'SP' | 'CPC'.
function rbOverview(items, data, recs, period, today, brand) {
  const inB = x => brand === 'ALL' || !brand || x.brand === brand;
  const its = items.filter(inB);
  const sumV = list => list.reduce((t, i) => t + (i.value || 0), 0);
  const claim = its.filter(i => i.status === 'claim');
  const exp = claim.filter(i => i.daysLeft <= RB.EXPIRING);
  const under = its.filter(i => i.type === 'underpaid' && i.status === 'claim');
  const pays = ((data && data.payouts) || []).filter(inB).filter(p => Number(p.amount) > 0);
  const rec = (a, z) => {
    const inP = pays.filter(p => rbIn(rbDay(p.date), a, z));
    const viaCase = inP.filter(p => p.caseId), auto = inP.filter(p => !p.caseId);
    const s = list => list.reduce((t, p) => t + Number(p.amount), 0);
    return { all: s(inP), viaCase: s(viaCase), auto: s(auto), n: inP.length };
  };
  const now = rec(period.from, period.to), was = rec(period.prevFrom, period.prevTo);
  const lostIn = (a, z) => its.filter(i => i.status === 'expired' && rbIn(i.deadline, a, z));
  const lostNow = lostIn(period.from, period.to), lostWas = lostIn(period.prevFrom, period.prevTo);
  const recList = !recs ? [] : typeof recs.values === 'function' ? [...recs.values()] : Object.values(recs);
  const open = recList.filter(r => r && r.status === 'in_case' && inB(r));
  return {
    // rate: how many of the items are valued (in part) at Amazon's rate — counted in the $, said under the box.
    owed: { v: sumV(claim), n: claim.length, units: claim.reduce((t, i) => t + i.units, 0), noCost: claim.filter(i => i.value == null || i.noCostUnits > 0).length,
      approx: claim.some(i => i.approx), rate: claim.filter(i => i.rate).length },
    expiring: { v: sumV(exp), n: exp.length, rate: exp.filter(i => i.rate).length },
    recovered: Object.assign(now, { prev: was, delta: rbDelta(now.all, was.all), dCase: rbDelta(now.viaCase, was.viaCase), dAuto: rbDelta(now.auto, was.auto) }),
    // sourcing: is any sourcing cost known at all (without one nothing can be called underpaid — the page says so instead of
    // a $); belowLanded: payouts inside the re-check window paid below the LANDED cost — only "possible", never a $ figure.
    underpaid: { v: sumV(under), n: under.length, sourcing: rbHasSourcing(data && data.costs), belowLanded: rbBelowLanded(data, today, brand) },
    open: { n: open.length, v: open.reduce((t, r) => t + (Number(r.estimate) || 0), 0), many: open.length >= RB.MAX_OPEN, recs: open },
    lost: { v: sumV(lostNow), n: lostNow.length, prev: sumV(lostWas), delta: rbDelta(sumV(lostNow), sumV(lostWas)) },
  };
}

/* ---------- "Do this week": the action list ---------- */
// o: { brand, type ('' = every type), focus ('owed' | 'exp' | 'under' | ''), archived (also the archived), expired (also the
// expired) }. Paid items and those in a case are not on it (the Open cases box lists those). Order: Claim now (fewest days
// left, then highest value), Wait (soonest to open), Expired, Archived.
function rbWeekList(items, o) {
  o = o || {};
  const rank = { claim: 0, wait: 1, expired: 2, archived: 3 };
  let list = items.filter(i => (o.brand === 'ALL' || !o.brand || i.brand === o.brand) && i.status in rank);
  if (!o.archived) list = list.filter(i => i.status !== 'archived');
  if (!o.expired) list = list.filter(i => i.status !== 'expired');
  if (o.type) list = list.filter(i => i.type === o.type);
  if (o.focus === 'owed') list = list.filter(i => i.status === 'claim');
  if (o.focus === 'exp') list = list.filter(i => i.status === 'claim' && i.daysLeft <= RB.EXPIRING);
  if (o.focus === 'under') list = list.filter(i => i.type === 'underpaid' && i.status === 'claim');
  const val = i => (i.value == null ? -1 : i.value);
  return list.slice().sort((a, z) => (rank[a.status] - rank[z.status])
    || (a.status === 'claim' ? a.daysLeft - z.daysLeft : 0)
    || (a.status === 'wait' ? (a.opensIn == null ? 999 : a.opensIn) - (z.opensIn == null ? 999 : z.opensIn) : 0)
    || (a.status === 'expired' ? z.deadline - a.deadline : 0)
    || (val(z) - val(a)) || (a.key < z.key ? -1 : 1));
}

/* ---------- the chart: payouts by month, the last 12 months ---------- */
// { months: [{ key 'YYYY-MM', lab 'Nov 26', from, to, cases, auto, rev (≤ 0), units, reason: { Inbound, Lost, … } }] }, oldest
// first, the month of today last.
function rbChart(data, today, brand, n) {
  const t0 = rbDay(today), d = new Date(t0), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const months = [];
  for (let i = (n || 12) - 1; i >= 0; i--) {
    const from = Date.UTC(y, m - i, 1), to = Date.UTC(y, m - i + 1, 1) - RB_DAY, md = new Date(from);
    months.push({ key: rbIso(from).slice(0, 7), lab: RB_MON[md.getUTCMonth()] + ' ' + String(md.getUTCFullYear()).slice(2), from, to,
      cases: 0, auto: 0, rev: 0, units: 0, reason: Object.fromEntries(RB.REASONS.map(([r]) => [r, 0])) });
  }
  ((data && data.payouts) || []).forEach(p => {
    if (brand && brand !== 'ALL' && p.brand !== brand) return;
    const dd = rbDay(p.date), mo = months.find(x => dd >= x.from && dd <= x.to);
    if (!mo) return;
    const a = Number(p.amount) || 0;
    if (a < 0) { mo.rev += a; return; }
    if (p.caseId) mo.cases += a; else mo.auto += a;
    mo.units += rbUnits(p);
    const g = rbReasonGroup(p.reason);
    mo.reason[g in mo.reason ? g : 'Other'] += a;
  });
  return { months, any: months.some(x => x.cases || x.auto || x.rev) };
}

/* ---------- most-lost products, the last 12 months ---------- */
// Per product: units lost (net of units found), damaged (and destroyed), their value at our cost, what Amazon paid back for
// them (Lost and Damaged payouts of that FNSKU), and the share paid back. Top n by value (no-cost ones after, by units).
function rbMostLost(data, today, brand, n) {
  const t0 = rbDay(today), from = t0 - 364 * RB_DAY;
  const costs = (data && data.costs) || {}, rate = rbRates((data && data.payouts) || [], t0);
  const m = new Map();
  const row = x => {
    const k = x.brand + '|' + x.fnsku;
    return m.get(k) || m.set(k, { brand: x.brand, fnsku: x.fnsku, sku: x.sku, asin: x.asin, title: x.title, lost: 0, found: 0, damaged: 0, paid: 0 }).get(k);
  };
  const inB = x => !brand || brand === 'ALL' || x.brand === brand;
  ((data && data.ledger) || []).forEach(l => {
    if (!inB(l) || !rbIn(rbDay(l.date), from, t0)) return;
    const r = row(l), u = Math.abs(Number(l.units) || 0);
    if (l.kind === 'lost') r.lost += u;
    else if (l.kind === 'found') r.found += u;
    else if (l.kind === 'damaged' || l.kind === 'destroyed') r.damaged += u;
  });
  ((data && data.payouts) || []).forEach(p => {
    if (!inB(p) || !(Number(p.amount) > 0) || !rbIn(rbDay(p.date), from, t0)) return;
    const g = rbReasonGroup(p.reason);
    if (g !== 'Lost' && g !== 'Damaged') return;
    const k = p.brand + '|' + p.fnsku;
    if (m.has(k)) m.get(k).paid += Number(p.amount);
  });
  const out = [...m.values()].map(r => {
    const lostNet = Math.max(0, r.lost - r.found), units = lostNet + r.damaged;
    const val = rbValue(units, costs[r.asin], rate(r.brand, r.sku, r.asin));
    return Object.assign(r, { lostNet, units, value: val.v, approx: val.approx, rate: val.basis === 'amazon', noCost: val.noCost,
      pct: val.v > 0 ? Math.min(100, r.paid / val.v * 100) : null });
  }).filter(r => r.units > 0);
  out.sort((a, z) => ((z.value == null ? -1 : z.value) - (a.value == null ? -1 : a.value)) || (z.units - a.units));
  return out.slice(0, n || 10);
}

/* ---------- the case text, the pills, the CSV ---------- */
// The case text for an item, from its type's template: the facts, polite, no threats. A list of lost (or damaged) items of
// one brand makes one case's text; proof (inbound, rbProofOf): the invoice and the tracking, named when they are there.
function rbCaseText(it, proof) {
  const date = ms => rbDate(ms);
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (Array.isArray(it) || it.type === 'lost' || it.type === 'damaged') {
    const list = [].concat(it), lost = list[0].type === 'lost', all = list.reduce((t, i) => t + i.units, 0);
    return ['Hello,', '',
      (lost ? 'Our inventory ledger shows units of ours lost in your fulfillment centers that have not been found or reimbursed:'
        : 'Our inventory ledger shows units of ours damaged or destroyed in your fulfillment centers that have not been reimbursed:'), '']
      .concat(list.map(i => lost
        ? `- FNSKU ${i.fnsku} (${i.sku}, ASIN ${i.asin}): ${pl(i.units, 'unit')} lost on ${date(i.event)}${i.txnId ? ` (transaction ID ${i.txnId})` : ''}`
        : `- Transaction ID ${i.txnId || '—'}: FNSKU ${i.fnsku} (${i.sku}, ASIN ${i.asin}), ${pl(i.units, 'unit')} ${i.kind === 'destroyed' ? 'destroyed' : 'damaged'} on ${date(i.event)}`))
      .concat(['', `In all, ${pl(all, 'unit')}, each more than ${RB.WAIT.warehouse} days ago.`, '',
        lost ? 'Could you please research these units and reimburse the ones that cannot be found?' : 'Could you please review these units and reimburse them?',
        '', 'Thank you for your help.']).join('\n');
  }
  if (it.type === 'inbound') {
    const s = it.shipment || {}, open = (it.skus || []).filter(x => x.missing > 0), p = proof || {};
    const how = it.startFrom === 'checkin' ? `first checked in on ${date(it.event)}` : it.startFrom === 'closed' ? `closed on ${date(it.event)}` : `delivered on ${date(it.event)}`;
    const track = (p.tracking || []).length ? `${p.carrier ? p.carrier + ' ' : ''}tracking ${p.tracking.join(', ')}` : '';
    const facts = [p.invoiceNo ? `supplier invoice ${p.invoiceNo}${p.supplier ? ` from ${p.supplier}` : ''}` : '', track, p.podAttached ? 'the proof of delivery' : ''].filter(Boolean);
    return ['Hello,', '',
      `We are writing about inbound shipment ${it.itemKey}${s.name && s.name !== it.itemKey ? ` (${s.name})` : ''}, ${how}${it.startFrom === 'delivered' && s.closedAt ? ` and closed on ${date(rbDay(s.closedAt))}` : ''}.`
        + ' Our records show fewer units received than we shipped:', '']
      .concat(open.map(x => `- ${x.sku} (FNSKU ${x.fnsku}, ASIN ${x.asin}): shipped ${x.shipped}, received ${x.received}`
        + (x.paid ? `, ${x.paid} already reimbursed` : '') + `, missing ${x.missing}`))
      .concat(['', `In all, ${pl(it.units, 'unit')} missing.`, '',
        'Could you please research the missing units and reconcile or reimburse them? '
          + (facts.length ? `Attached: ${facts.join(', ')}.` : 'Our proof of ownership (supplier invoice), the proof of delivery and the carrier tracking are attached.'),
        '', 'Thank you for your help.']).join('\n');
  }
  if (it.type === 'underpaid') {
    const p = it.payout || {};
    return ['Hello,', '',
      `We are writing about reimbursement ${p.reimbId} dated ${date(rbDay(p.date))} for ${p.sku} (FNSKU ${p.fnsku}, ASIN ${p.asin}): ${it.units} unit${it.units === 1 ? '' : 's'} at ${rbMoney(it.per)} each, ${rbMoney(Number(p.amount))} in all.`,
      '', `Our sourcing cost for this item is ${rbMoney(it.cost)} per unit (the supplier invoice is attached), so this reimbursement is ${rbMoney(it.value)} below our cost. The cost excludes shipping, handling and duties.`,
      '', 'Could you please review the amount and reimburse the difference?', '', 'Thank you for your help.'].join('\n');
  }
  const p = it.payout || {}, o = it.original;
  return ['Hello,', '',
    `On ${date(it.event)}, reimbursement ${p.reimbId} took back ${rbMoney(Math.abs(Number(p.amount)))} for ${it.units} unit${it.units === 1 ? '' : 's'} of ${p.sku} (FNSKU ${p.fnsku}, ASIN ${p.asin}), as though the unit${it.units === 1 ? ' had' : 's had'} been found.`
      + (o ? ` The original reimbursement was ${o.reimbId} on ${date(rbDay(o.date))}.` : ''),
    '', `Our inventory ledger shows no unit of this FNSKU found between ${date(it.checkFrom)} and ${date(it.checkTo)}. Could you please check whether the units were found and returned to our sellable inventory, and if they were not, reverse this deduction?`,
    '', 'Thank you for your help.'].join('\n');
}
// The days-left pill: { t, cls } — cls 'bad' (7 or fewer), 'act' (8–14), 'rev' (15–30), 'n' (over 30), 'wait' (not open yet).
function rbDaysPill(it) {
  if (it.status === 'wait') return { t: it.opensIn == null ? 'opens when closed' : it.opensIn === 0 ? 'opens today' : `opens in ${it.opensIn} d`, cls: 'wait' };
  if (it.status === 'expired') return { t: `expired ${rbDate(it.deadline)}`, cls: 'bad' };
  const d = it.daysLeft;
  return { t: d === 0 ? 'last day' : `${d} day${d === 1 ? '' : 's'}`, cls: d <= 7 ? 'bad' : d <= 14 ? 'act' : d <= 30 ? 'rev' : 'n' };
}
// Money on screen, one format everywhere: cents under $100 ("$10.20"), whole dollars from $100 up ("$1,234"). (The case text
// keeps exact cents: it is what Amazon reads.)
function rbFmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−$' : '$';
  return s + (Math.round(a * 100) / 100 < 100 ? a.toFixed(2) : Math.round(a).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}
// Is any sourcing cost known?
const rbHasSourcing = costs => Object.values(costs || {}).some(c => c && Number(c.sourcing) > 0);
// Payouts inside the re-check window paid below the LANDED cost per unit: possibly underpaid (landed includes freight, so a
// payout below it may still be at or above the sourcing cost). A count, never a $.
function rbBelowLanded(data, today, brand) {
  const t0 = rbDay(today), costs = (data && data.costs) || {};
  return ((data && data.payouts) || []).filter(p => {
    if (brand && brand !== 'ALL' && p.brand !== brand) return false;
    const units = Number(p.cashUnits) || 0, amount = Number(p.amount) || 0, landed = Number((costs[p.asin] || {}).landed);
    const d = rbDay(p.date);
    return amount > 0 && units > 0 && landed > 0 && amount / units < landed - RB.UNDER_MIN && d != null && t0 - d <= RB.DEADLINE.recheck.days * RB_DAY;
  }).length;
}
// "% paid back": 90%+ good, 50–89% to review, under 50% bad.
const rbPctClass = p => (p == null ? '' : p >= 90 ? 'ok' : p >= 50 ? 'rev' : 'bad');
// The action list as CSV lines (the page's Export).
function rbCsvLines(list) {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Type', 'Brand', 'Item', 'Title', 'SKU', 'ASIN', 'FNSKU', 'Units', 'Value $', 'Value basis', 'Days left', 'Deadline', 'Status', 'Why no case'];
  return [head.map(cell).join(',')].concat(list.map(i => [RB.TYPES[i.type].short, i.brand, i.itemKey, i.title, i.sku, i.asin, i.fnsku, i.units,
    i.value == null ? '' : i.value.toFixed(2), i.value == null ? 'no cost' : i.approx ? 'landed (approx.)' : i.rate ? "Amazon's rate (approx.)"
      : i.type === 'inbound' || i.type === 'lost' || i.type === 'damaged' ? 'sourcing' : 'amount',
    i.status === 'wait' ? '' : i.daysLeft, rbIso(i.deadline), RB.STATUS[i.status].t, i.block].map(cell).join(',')));
}

/* ---------- reading Amazon's own reports (the upload): pure, so the tests read the same files the page does ---------- */
// A header as compared: no case, no spaces, underscores or hyphens ("Event Type" = "event-type" = "EVENT_TYPE").
const rbHead = h => String(h || '').toLowerCase().replace(/[\s_\-]+/g, '');
// A tab- or comma-separated file → { sep, head, rows }: quotes ("a, b", "say ""x""") and both line endings understood, blank
// lines skipped, a leading BOM dropped. The separator is the one the header line holds more of.
function rbParseTable(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const nl = s.search(/\r?\n/), first = nl < 0 ? s : s.slice(0, nl);
  const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  const endRow = () => { row.push(cell); cell = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') { cell += '"'; i++; }
      else q = false;
    } else if (ch === '"' && cell.trim() === '') { cell = ''; q = true; }
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return { sep, head: rows.length ? rows[0].map(h => h.trim()) : [], rows: rows.slice(1) };
}
// A report's date → 'YYYY-MM-DD': ISO ("2026-11-04T07:00:00+00:00"), US ("11/04/2026"), or anything Date.parse reads; '' if none.
function rbParseDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${('0' + m[1]).slice(-2)}-${('0' + m[2]).slice(-2)}`;
  const t = s ? Date.parse(s) : NaN;
  return isFinite(t) ? rbIso(rbDay(t)) : '';
}
// "$1,234.50", "(12.30)", " 7 " → a number (0 when blank or unreadable).
const rbNum = v => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isFinite(n) ? n : 0; };
// The key a row is kept under: a payout by reimbursement ID and SKU, a ledger row by date, FNSKU, event, reference ID,
// quantity and reason. Uploading again replaces rows with the same key, never adds them twice.
const rbRowKey = (kind, x) => (kind === 'payouts' ? x.reimbId + '|' + x.sku : [x.date, x.fnsku, x.event, x.txnId, x.qty, x.reason].join('|'));
/**
 * One uploaded report → { ok: true, rows (in the data contract's shape), kept, read, skipped, dupes, from, to, other,
 * otherCodes, notUsd, badDate, otherBrand } or { ok: false, err, missing }. kind 'payouts' (the Reimbursements report) or
 * 'ledger' (the Inventory Ledger, Detailed view: only its Adjustments and Receipts rows). A needed column missing: refused,
 * naming it — never guessed. known: what Sellora already knows of the brands (sku or asin → 'SP' | 'CPC'), for the warning
 * when most of the file belongs to the other brand.
 */
function rbParseReport(kind, text, brand, known) {
  const R = RB.REPORTS[kind];
  if (!R) return { ok: false, err: 'Not a report Sellora reads' };
  if (brand !== 'SP' && brand !== 'CPC') return { ok: false, err: 'Pick the brand first' };
  const T = rbParseTable(text);
  if (!T.head.length) return { ok: false, err: 'The file is empty' };
  const col = {};
  R.need.concat(R.opt).forEach(n => { const i = T.head.findIndex(h => rbHead(h) === rbHead(n)); if (i >= 0) col[n] = i; });
  const missing = R.need.filter(n => !(n in col));
  if (missing.length) {
    return { ok: false, missing, err: `Not read: this file has no ${missing.map(n => `"${n}"`).join(', ')} column${missing.length === 1 ? '' : 's'}, so it is not the ${R.t}. Download it again: ${R.where}.` };
  }
  const g = (r, n) => (n in col ? String(r[col[n]] == null ? '' : r[col[n]]).trim() : '');
  const out = new Map(), codes = new Map();
  let skipped = 0, other = 0, notUsd = 0, badDate = 0;
  T.rows.forEach(r => {
    const date = rbParseDate(g(r, kind === 'payouts' ? 'approval-date' : 'date'));
    if (!date) { badDate++; return; }
    let x;
    if (kind === 'payouts') {
      const id = g(r, 'reimbursement-id');
      if (!id) { skipped++; return; }
      const cur = g(r, 'currency-unit');
      if (cur && cur.toUpperCase() !== 'USD') notUsd++;
      const orig = g(r, 'original-reimbursement-id');
      x = { brand, date, reimbId: id, caseId: g(r, 'case-id') || null, orderId: g(r, 'amazon-order-id') || null, sku: g(r, 'sku'), asin: g(r, 'asin'),
        fnsku: g(r, 'fnsku'), title: g(r, 'product-name'), reason: g(r, 'reason'), cashUnits: rbNum(g(r, 'quantity-reimbursed-cash')),
        invUnits: rbNum(g(r, 'quantity-reimbursed-inventory')), amount: rbNum(g(r, 'amount-total')), original: orig ? { reimbId: orig } : null };
    } else {
      const ev = g(r, 'event-type');
      if (!/^(adjustments?|receipts?)$/i.test(ev)) { skipped++; return; }
      const qty = rbNum(g(r, 'quantity')), code = g(r, 'reason').toUpperCase();
      const k = /^receipt/i.test(ev) ? 'receipt' : RB.REASON_MAP[code] || 'other';
      if (k === 'other') { other++; codes.set(code || '(blank)', (codes.get(code || '(blank)') || 0) + 1); }
      x = { brand, date, fnsku: g(r, 'fnsku'), sku: g(r, 'msku'), asin: g(r, 'asin'), title: g(r, 'title'), kind: k, units: Math.abs(qty), qty,
        txnId: g(r, 'reference-id'), event: ev, reason: code, fc: g(r, 'fulfillment-center'),
        unrec: g(r, 'unreconciled-quantity') === '' ? null : rbNum(g(r, 'unreconciled-quantity')) };
    }
    out.set(rbRowKey(kind, x), x);
  });
  const rows = [...out.values()], dates = rows.map(x => x.date).sort();
  // Most of its SKUs known as the other brand's: say so before it is saved under this one.
  let otherBrand = null;
  if (known) {
    const look = k => (!k ? '' : typeof known.get === 'function' ? known.get(k) || '' : known[k] || '');
    const seen = new Map();
    rows.forEach(x => { const id = x.sku || x.asin; if (id && !seen.has(id)) seen.set(id, look(x.sku) || look(x.asin)); });
    const knownIds = [...seen.values()].filter(Boolean), theirs = knownIds.filter(b => b !== brand);
    if (knownIds.length && theirs.length / knownIds.length > 0.5) otherBrand = { n: theirs.length, of: knownIds.length, brand: theirs[0] };
  }
  return { ok: true, kind, brand, rows, kept: rows.length, read: T.rows.length, skipped, dupes: T.rows.length - skipped - badDate - rows.length,
    from: dates[0] || '', to: dates[dates.length - 1] || '', other, otherCodes: Object.fromEntries(codes), notUsd, badDate, otherBrand };
}
// The rows kept so far and a new upload of the same report and brand → { rows, added, replaced }: the same key is replaced.
function rbMerge(kind, old, fresh) {
  const m = new Map((old || []).map(x => [rbRowKey(kind, x), x]));
  let replaced = 0;
  (fresh || []).forEach(x => { const k = rbRowKey(kind, x); if (m.has(k)) replaced++; m.set(k, x); });
  return { rows: [...m.values()], added: (fresh || []).length - replaced, replaced };
}
