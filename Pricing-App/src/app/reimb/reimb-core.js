/* ================= REIMBURSEMENT · THE ENGINE: what Amazon owes us, what it paid, and what to claim (24 Nov 2026) =================
 * Pure functions only — no screen, no storage, no clock: "today" is always passed in, and nothing here reads Date.now().
 * Shared by the module's five pages (Overview now; Paid, To Claim, Cases and Fee Check later), and by tests/reimb-test.js.
 * SELLORA CHANGES NOTHING AT AMAZON. It finds the money, writes the case text, and keeps a record of each claim; the person
 * opens the case in Seller Central themselves.
 *
 * WHAT IS COUNTED TODAY (RB.LIVE_TYPES): inbound shortages, underpaid reimbursements and reversals. Lost & damaged in the
 * warehouse, removals, disposals, returns and fee errors come later (RB.TYPES has their names and colours already); the page
 * says so under its boxes, so nobody reads the totals as complete.
 *
 * THE RULES (the numbers are in RB; the page's "How Sellora counts" shows the same):
 *   VALUE        units × our SOURCING cost. Only a landed cost known: that, tagged "≈ landed" (landed includes freight,
 *                Amazon's sourcing cost does not). No cost at all: the units only, tagged "no cost", left out of every $ total.
 *   INBOUND      per SKU, missing = shipped − received, only when above 0. One shipment is one item (one shipment per case).
 *                "Wait" until the shipment is CLOSED and RB.WAIT_DAYS (15) days have passed since delivery — Amazon may still
 *                be counting; then "Claim now". Deadline RB.DEADLINE.inbound: 60 days after delivery (not confirmed yet).
 *                A SKU Amazon already paid for itself (an Inbound payout for the same FNSKU on or after delivery) is left out
 *                of the claim; every SKU paid → the shipment is "Paid".
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
 * THE DATA CONTRACT — what rbLoad (reimb-sample.js) hands over: the sample today, the backend caches later, the same shape.
 *   { sample: true | false, asOf: ISO time,
 *     inbound: [{ brand: 'SP' | 'CPC', shipmentId, name, status: 'RECEIVING' | 'CLOSED' | …, createdAt, deliveredAt, closedAt,
 *                 items: [{ sku, asin, fnsku, title, shipped, received }] }],
 *     payouts: [{ brand, date, reimbId, caseId | null, orderId | null, sku, asin, fnsku, title, reason, cashUnits, invUnits,
 *                 amount, original: { reimbId } | null }],          // amount < 0 with units = a reversal
 *     ledger:  [{ brand, date, fnsku, sku, asin, title, kind: 'lost' | 'found' | 'damaged' | 'destroyed', units, txnId }],
 *     costs:   { [asin]: { sourcing: number | null, landed: number | null } } }
 *   Dates are 'YYYY-MM-DD' or ISO times; each is read as its calendar day. Money is US dollars.
 *   have:    { inbound, payouts, ledger, ledgerBrands? }: which parts are there at all (rbLoad, reimb-data.js). A part that is
 *            missing is NOT read as zero: no reversal is judged without its brand's ledger, no inbound shortage without the
 *            shipments.
 * The backend caches (when the backend team writes them, read through ?cache=, as every Ads screen does):
 *   reimbPaid    { at, d: { SP: [payout rows], CPC: [...] } }     reimbLedger  { at, d: { SP: [ledger rows], … } }
 *   reimbInbound { at, d: { SP: [shipments], … } }                (rows in the shapes above; brand taken from the key)
 * Until then a person uploads Amazon's own reports (rbParseReport below; reimb-data.js keeps them).
 * COSTS ON SCREEN: Profit & Margin's unit cost is the LANDED cost, so values from it always show as "≈ landed"; nobody has
 * entered SOURCING costs yet, so Underpaid says it needs them (rbOverview: underpaid.sourcing) instead of a $ figure.
 * THE CASE RECORDS (Firestore reimbCases/{brand_type_itemKey}, saved by the page — never by this file):
 *   { brand, type, itemKey, status: 'draft' | 'in_case' | 'paid' | 'archived', caseId, estimate, checks: { key: true },
 *     note, reason, trail: [{ t, act, email, uid, person, dev }] }  ('draft' = proof ticked, no case yet: counts as none)
 *
 * Main functions: rbDay, rbValue, rbDaysLeft, rbItems, rbStatus, rbDupCheck, rbPeriod, rbOverview, rbWeekList, rbChart,
 * rbMostLost, rbCaseText, rbDaysPill, rbPctClass, rbCsvLines. */

const RB_DAY = 86400000;
const RB = {
  WAIT_DAYS: 15,      // days after delivery while Amazon may still be counting an inbound shipment
  FOUND_DAYS: 30,     // a reversal is disputable when no unit of its FNSKU was found this many days either side of it
  EXPIRING: 14,       // "Expiring in 14 days"
  UNDER_MIN: 0.01,    // paid per unit at least this far under our sourcing cost before it counts as underpaid ($)
  MAX_ITEMS: 10,      // items Amazon takes in one case
  MAX_OPEN: 10,       // open cases Amazon advises staying under (its own guidance; Sellerise shows the same)
  // The windows to claim in. None is confirmed yet: the page says "check the deadline in Seller Central" with each.
  DEADLINE: {
    inbound: { days: 60, from: 'delivery', confirmed: false, t: '60 days after delivery' },
    recheck: { days: 90, from: 'the payout date', confirmed: false, t: '90 days from the payout date' },
    reversal: { days: 90, from: 'the reversal date', confirmed: false, t: '90 days from the reversal date' },
  },
  // Every claim type, with its colour token (the page's dot) and how "Not counted yet" names it. live: counted today.
  TYPES: {
    inbound: { t: 'Inbound shortage', short: 'Inbound', c: '--brand', live: true },
    underpaid: { t: 'Underpaid', short: 'Underpaid', c: '--act', live: true },
    reversal: { t: 'Reversal', short: 'Reversal', c: '--bad', live: true },
    lost: { t: 'Lost in the warehouse', short: 'Lost', c: '--act-ink', later: 'lost & damaged' },
    damaged: { t: 'Damaged in the warehouse', short: 'Damaged', c: '--rev', later: 'lost & damaged' },
    removal: { t: 'Removal', short: 'Removal', c: '--violet-ink', later: 'removals' },
    disposal: { t: 'Disposal', short: 'Disposal', c: '--faint', later: 'disposals' },
    returns: { t: 'Customer returns', short: 'Returns', c: '--brand-ink', later: 'returns' },
    fee: { t: 'Fee error', short: 'Fee', c: '--accent-ink', later: 'fee errors' },
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
  // What to keep ready for each case (each a tick the page saves): [key, words].
  PROOF: {
    inbound: [['own', 'Proof of ownership (e.g. the supplier invoice)'], ['pod', 'Proof of delivery / bill of lading (BOL)'], ['track', 'Carrier tracking']],
    underpaid: [['inv', 'Supplier invoice showing our cost for this item']],
    reversal: [['ledger', 'The inventory ledger for this FNSKU around the date (no unit found)']],
  },
  // The Seller Central steps for each case.
  STEPS: {
    inbound: ['Shipping queue (Shipments) → open the shipment', 'Contents / Reconcile', '"Research missing units" for each SKU below',
      'Attach the proof ticked below', 'Paste the case text', 'Submit, then put the case ID here'],
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
// The value of units at our cost: { v ($, or null with no cost), per (the cost per unit used), basis, approx (landed only), noCost }.
function rbValue(units, cost) {
  const u = Number(units) || 0, c = cost || {};
  if (Number(c.sourcing) > 0) return { v: u * c.sourcing, per: Number(c.sourcing), basis: 'sourcing', approx: false, noCost: false };
  if (Number(c.landed) > 0) return { v: u * c.landed, per: Number(c.landed), basis: 'landed', approx: true, noCost: false };
  return { v: null, per: null, basis: '', approx: false, noCost: true };
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

/* ---------- the items: one per thing to claim ---------- */
// Every inbound shortage, underpaid payout and disputable reversal, each with its status, days left and what blocks a case.
// recs: the saved case records (a Map or an object by key 'brand_type_itemKey'). today: a day ('YYYY-MM-DD' or ms).
// Item: { key, brand, type, itemKey, title, sku, asin, fnsku, units, value (or null), approx, noCostUnits, event (day ms),
//   deadline, daysLeft, opensIn (wait: days until it opens; null while not closed), status, rec, block (why no case), … }
function rbItems(data, recs, today) {
  const t0 = rbDay(today);
  const costs = (data && data.costs) || {}, pays = (data && data.payouts) || [], led = (data && data.ledger) || [];
  const recOf = k => (!recs ? null : typeof recs.get === 'function' ? recs.get(k) || null : recs[k] || null);
  const out = [];
  const add = it => {
    it.key = rbKey(it.brand, it.type, it.itemKey);
    it.rec = recOf(it.key);
    it.daysLeft = rbDaysLeft(it.deadline, t0);
    it.status = rbStatus(it, it.rec, t0);
    it.block = rbDupCheck(it, it.rec);
    out.push(it);
  };
  // --- inbound shortages: one item per shipment ---
  (data && data.inbound || []).forEach(s => {
    const del = rbDay(s.deliveredAt);
    if (del == null) return;
    const skus = (s.items || []).map(x => {
      const missing = Math.max(0, (Number(x.shipped) || 0) - (Number(x.received) || 0));
      return Object.assign({}, x, { missing, val: rbValue(missing, costs[x.asin]) });
    }).filter(x => x.missing > 0);
    if (!skus.length) return;
    // A SKU Amazon already paid for by itself: an Inbound payout for the same FNSKU, on or after delivery.
    skus.forEach(x => {
      x.paidBy = pays.find(p => p.brand === s.brand && p.fnsku === x.fnsku && Number(p.amount) > 0 && rbReasonGroup(p.reason) === 'Inbound'
        && rbDay(p.date) >= del) || null;
    });
    const open = skus.filter(x => !x.paidBy);
    const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
    const known = open.filter(x => x.val.v != null);
    const first = skus[0];
    add({ brand: s.brand, type: 'inbound', itemKey: s.shipmentId, title: s.name || s.shipmentId, shipment: s, skus,
      sku: skus.length === 1 ? first.sku : `${skus.length} SKUs`, asin: skus.length === 1 ? first.asin : '', fnsku: skus.length === 1 ? first.fnsku : '',
      units: sum(open, x => x.missing), value: known.length ? sum(known, x => x.val.v) : null,
      approx: known.some(x => x.val.approx), noCostUnits: sum(open.filter(x => x.val.noCost), x => x.missing),
      paidAll: !open.length, paidBy: (skus.find(x => x.paidBy) || {}).paidBy || null, partPaid: open.length < skus.length && open.length > 0,
      event: del, deadline: del + RB.DEADLINE.inbound.days * RB_DAY, closed: /^CLOSED$/i.test(String(s.status || '')),
      opensIn: /^CLOSED$/i.test(String(s.status || '')) ? Math.max(0, RB.WAIT_DAYS - Math.round((t0 - del) / RB_DAY)) : null });
  });
  // --- underpaid payouts: one item per payout (our sourcing cost only) ---
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
  // (have.ledgerBrands: the brands whose ledger is there, when it is known per brand — an upload is one brand's)
  const H = (data && data.have) || null;
  const ledgerKnown = b => !H || (H.ledger !== false && (!H.ledgerBrands || H.ledgerBrands.includes(b)));
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
  if (item.type === 'inbound' && (!item.closed || t0 - item.event < RB.WAIT_DAYS * RB_DAY)) return 'wait';
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
    owed: { v: sumV(claim), n: claim.length, units: claim.reduce((t, i) => t + i.units, 0), noCost: claim.filter(i => i.value == null || i.noCostUnits > 0).length,
      approx: claim.some(i => i.approx) },
    expiring: { v: sumV(exp), n: exp.length },
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
  const costs = (data && data.costs) || {};
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
    const val = rbValue(units, costs[r.asin]);
    return Object.assign(r, { lostNet, units, value: val.v, approx: val.approx, noCost: val.noCost,
      pct: val.v > 0 ? Math.min(100, r.paid / val.v * 100) : null });
  }).filter(r => r.units > 0);
  out.sort((a, z) => ((z.value == null ? -1 : z.value) - (a.value == null ? -1 : a.value)) || (z.units - a.units));
  return out.slice(0, n || 10);
}

/* ---------- the case text, the pills, the CSV ---------- */
// The case text for an item, from its type's template: the facts, polite, no threats.
function rbCaseText(it) {
  const date = ms => rbDate(ms);
  if (it.type === 'inbound') {
    const s = it.shipment || {}, open = (it.skus || []).filter(x => !x.paidBy);
    return ['Hello,', '',
      `We are writing about inbound shipment ${it.itemKey}${s.name && s.name !== it.itemKey ? ` (${s.name})` : ''}, delivered on ${date(it.event)}${s.closedAt ? ` and closed on ${date(rbDay(s.closedAt))}` : ''}.`
        + ' Our records show fewer units received than we shipped:', '']
      .concat(open.map(x => `- ${x.sku} (FNSKU ${x.fnsku}, ASIN ${x.asin}): shipped ${x.shipped}, received ${x.received}, missing ${x.missing}`))
      .concat(['', `In all, ${it.units} unit${it.units === 1 ? '' : 's'} missing.`, '',
        'Could you please research the missing units and reconcile or reimburse them? Our proof of ownership (supplier invoice), the proof of delivery and the carrier tracking are attached.',
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
    i.value == null ? '' : i.value.toFixed(2), i.value == null ? 'no cost' : i.approx ? 'landed (approx.)' : i.type === 'inbound' ? 'sourcing' : 'amount',
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
        txnId: g(r, 'reference-id'), event: ev, reason: code, fc: g(r, 'fulfillment-center') };
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
