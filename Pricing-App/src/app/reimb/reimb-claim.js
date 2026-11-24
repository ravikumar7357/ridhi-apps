/* ================= REIMBURSEMENT · TO CLAIM: every claim we can still make, its proof, and the case to open (24 Nov 2026) =================
 * Screen: Reimbursement › To Claim (tab 'rbclaim', pane paneRbclaim; core/nav.js calls ensureRbclaim when it opens). It comes
 * with the Reimbursement right (TAB_INHERIT rbclaim: 'reimb'): no Access box of its own. The local-test-copy menu rule in
 * core/access.js reads the group's tabs off the menu, so it covers this tab too.
 * Sellora is replacing Sellerise for reimbursements: this page finds every claim we can still make, holds its proof, and
 * hands it to Seller Central. SELLORA CHANGES NOTHING AT AMAZON: the person opens each case there; nothing here calls Amazon.
 *
 * REUSED, NOT COPIED: the engine (reimb-core.js: rbItems, rbBatchCheck, rbNeedsProof, the statuses, the value order); the data
 * and the case records (reimb-overview.js: RBD / rbLoadAll, RBC / rbCaseSave); the case dialog (rbOpen: per type, and a case
 * of several lost / damaged items), Archive / Restore, Upload Amazon reports and How Sellora counts — their dialogs sit in
 * #rbDialogs, shared by both pages; the pills, the value tags (rbValHtml), the days pill and the money format.
 *
 * Layout, top to bottom (Overview's and the Advertising pages' look: sta-scope, sta-barcard, sta-box, sta-tcard, sta-chip):
 *   the bar      brand · the type chips with counts (Inbound, Lost, Damaged, Reversals; Removals, Disposals, Returns greyed
 *                "coming soon") · the status chips (Claim now — the default —, Wait, Show expired, Show archived) · search
 *                (shipment, SKU, ASIN, FNSKU, title). Right: how new the data is, Upload Amazon reports, How Sellora counts,
 *                Export (the rows under the choices, as a CSV). Brand and chips are remembered on this device (rbClaimPrefs).
 *   four boxes   Can claim now, Expiring in 14 days, Waiting on Amazon, Needs proof (inbound only): today, the brand picked,
 *                every type. A click shows those rows (and picks a type that has them).
 *   one table    columns by type (rbqHead); Claim now first, the fewest days left, then the highest value; 50 rows, then
 *                "Show more". An inbound row opens to one line per SKU. Lost and Damaged rows are ticked together into one
 *                case (the selection bar: "N selected · $X · Make case (N)"); a tick that would break a case's rules
 *                (rbBatchCheck: one brand, one type, at most 10) is refused, and the bar says why.
 *   empty        per type, saying what is missing: the backend's shipment data, the Inventory Ledger, the Reimbursements
 *                report — else "Nothing to claim right now".
 * Main functions: ensureRbclaim, renderRbclaim, rbqRows, rbqGo, rbqTick, rbqCsv. */

const RBQ = { brand: 'ALL', type: 'inbound', st: 'claim', expired: false, arch: false, q: '', focus: '', shown: 50, sel: [], open: new Set(), why: '' };
const RBQ_PREFS = 'rbClaimPrefs';
const RBQ_STEP = 50;          // rows before "Show more", and how many more each time
let RBQ_ITEMS = [];           // the items of the last draw (ticks are checked against them)
const RBQ_TITLE = { inbound: 'Inbound shortages', lost: 'Lost in the warehouse', damaged: 'Damaged in the warehouse', reversal: 'Reversals' };
const RBQ_CHIP = { inbound: 'Inbound', lost: 'Lost', damaged: 'Damaged', reversal: 'Reversals', removal: 'Removals', disposal: 'Disposals', returns: 'Returns' };
const RBQ_SOON = { removal: 'removal order reports', disposal: 'disposal reports', returns: 'customer returns reports' };
const RBQ_FOCUS = { claim: 'Can claim now', exp: `Expiring in ${RB.EXPIRING} days`, wait: 'Waiting on Amazon', proof: 'Needs proof' };

/* ---------- this device's choices ---------- */
(function rbqPrefsLoad() {
  try {
    const p = JSON.parse(localStorage.getItem(RBQ_PREFS) || '{}') || {};
    if (p.brand in RB_BRANDS) RBQ.brand = p.brand;
    if (RB.CLAIM_TYPES.includes(p.type)) RBQ.type = p.type;
    if (p.st === 'claim' || p.st === 'wait') RBQ.st = p.st;
    RBQ.expired = p.expired === true;
    RBQ.arch = p.arch === true;
  } catch (e) { /* the defaults */ }
})();
function rbqPrefsSave() {
  try { localStorage.setItem(RBQ_PREFS, JSON.stringify({ brand: RBQ.brand, type: RBQ.type, st: RBQ.st, expired: RBQ.expired, arch: RBQ.arch })); } catch (e) { /* kept for this visit */ }
}

/* ---------- loading: the same data and case records as Overview ---------- */
async function ensureRbclaim() {
  if (!RBD) {
    renderRbclaim();
    try { await rbLoadAll(); } catch (e) { RB_ERR = String((e && e.message) || e); }
  }
  renderRbclaim();
}
RB_PAGES.push(() => renderRbclaim());

/* ---------- which rows ---------- */
// What a search looks through: the shipment, every SKU / ASIN / FNSKU / title in it, the transaction or reimbursement ID.
function rbqHay(i) {
  const bits = [i.itemKey, i.title, i.sku, i.asin, i.fnsku, i.txnId, i.shipment && i.shipment.name];
  (i.allSkus || []).forEach(x => bits.push(x.sku, x.asin, x.fnsku, x.title));
  return bits.filter(Boolean).join(' ').toLowerCase();
}
// The rows of one type under the choices (o overrides any of them), sorted: Claim now (the fewest days left, then the highest
// value), Wait (the soonest to open), Expired, Archived.
function rbqRows(items, o) {
  o = Object.assign({ brand: RBQ.brand, type: RBQ.type, st: RBQ.st, expired: RBQ.expired, arch: RBQ.arch, focus: RBQ.focus, q: RBQ.q }, o || {});
  const rank = { claim: 0, wait: 1, expired: 2, archived: 3 };
  const q = String(o.q || '').trim().toLowerCase();
  let list = items.filter(i => i.type === o.type && (o.brand === 'ALL' || !o.brand || i.brand === o.brand)
    && (i.status === o.st || (o.expired && i.status === 'expired') || (o.arch && i.status === 'archived')));
  if (o.focus === 'exp') list = list.filter(i => i.status === 'claim' && i.daysLeft <= RB.EXPIRING);
  if (o.focus === 'proof') list = list.filter(i => i.needsProof);
  if (q) list = list.filter(i => rbqHay(i).includes(q));
  const val = i => (i.value == null ? -1 : i.value);
  return list.sort((a, z) => (rank[a.status] - rank[z.status])
    || (a.status === 'claim' ? a.daysLeft - z.daysLeft : 0)
    || (a.status === 'wait' ? (a.opensIn == null ? 999 : a.opensIn) - (z.opensIn == null ? 999 : z.opensIn) : 0)
    || (a.status === 'expired' ? z.deadline - a.deadline : 0)
    || (val(z) - val(a)) || (a.key < z.key ? -1 : 1));
}
// Every item To Claim lists, of the brand picked (the boxes count these).
const rbqMine = items => items.filter(i => RB.CLAIM_TYPES.includes(i.type) && (RBQ.brand === 'ALL' || i.brand === RBQ.brand));
// Is a report there for the brand picked (an upload is one brand's)?
function rbqHave(k) {
  const H = (RBD && RBD.have) || {}, list = H[k === 'ledger' ? 'ledgerBrands' : 'payoutBrands'];
  if (!H[k]) return false;
  return !list || (RBQ.brand === 'ALL' ? list.length > 0 : list.includes(RBQ.brand));
}

/* ---------- drawing ---------- */
function renderRbclaim() {
  if (!$('paneRbclaim') || $('paneRbclaim').classList.contains('hide')) return;
  rbCard('rbqBarInfo', rbqDrawBar);
  if (!RBD) {
    $('rbqTypes').innerHTML = '';
    $('rbqSt').innerHTML = '';
    if (RB_ERR) {
      $('rbqMsg').innerHTML = `<span class="sta-bad">✗ The reimbursement data could not be read: ${rbEsc(RB_ERR)}</span> <button type="button" class="sta-btn sm" data-rbqretry="1">Try again</button>`;
      $('rbqBoxes').innerHTML = '';
    } else {
      $('rbqBoxes').innerHTML = Array.from({ length: 4 }, () => '<div class="adx-box rb-box rb-skel" aria-hidden="true"><div class="ui-loading rb-sk1"></div><div class="ui-loading rb-sk2"></div><div class="ui-loading rb-sk3"></div></div>').join('');
      $('rbqTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">Loading the claims…</td></tr></tbody>';
    }
    return;
  }
  const items = rbItems(RBD, RBC.recs, rbToday());
  RBQ_ITEMS = items;
  $('rbqSampleNote').classList.toggle('hide', !RBD.sample);
  const notes = [rbDataNote(), rbStoreNote(), RBD.costNote ? `<span class="sta-dash">${rbEsc(RBD.costNote)}: values at Amazon's rate where it paid for the product, else units only.</span>` : ''].filter(Boolean);
  $('rbqMsg').innerHTML = notes.join(' ') + (RB_NOTE ? ` <span class="rb-saved">${RB_NOTE}</span>` : '');
  rbCard('rbqBoxes', () => rbqDrawBoxes(items));
  rbCard('rbqLater', () => rbqDrawLater(items));
  rbCard('rbqTypes', () => rbqDrawChips(items));
  rbCard('rbqBody', () => rbqDrawTable(items));
  rbCard('rbqSel', () => rbqDrawSel());
}
function rbqDrawBar() {
  $('rbqBrand').value = RBQ.brand;
  if ($('rbqQ').value !== RBQ.q) $('rbqQ').value = RBQ.q;
  const at = RBD && Date.parse(RBD.asOf);
  $('rbqAsOf').textContent = !RBD ? 'Loading…' : RBD.sample ? (at ? 'Amazon data as of ' + RB_ASOF.format(at) : '')
    : RBD.source === 'none' ? 'No Amazon data yet'
      : `Amazon data as of ${rbDate(rbDay(RBD.asOf))} · ${RBD.source === 'backend' ? 'read by the backend' : 'from uploaded reports'}`;
  $('rbqSampleBadge').classList.toggle('hide', !(RBD && RBD.sample));
  $('rbqUpBtn').classList.toggle('hide', !!(RBD && RBD.sample));
}
const RBQ_IC = {
  claim: RB_IC.owed, exp: RB_IC.exp,
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  proof: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h3"/>',
  inv: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h3"/>',
  trk: '<path d="M2 6h12v10H2z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
};
// "3 inbound · 2 lost": a box's items by type.
function rbqByType(list) {
  const n = t => list.filter(i => i.type === t).length;
  return RB.CLAIM_TYPES.filter(n).map(t => `${staInt(n(t))} ${RBQ_CHIP[t].toLowerCase()}`).join(' · ');
}
function rbqDrawBoxes(items) {
  const mine = rbqMine(items);
  const claim = mine.filter(i => i.status === 'claim'), exp = claim.filter(i => i.daysLeft <= RB.EXPIRING);
  const wait = mine.filter(i => i.status === 'wait'), proof = mine.filter(i => i.needsProof);
  const sumV = l => l.reduce((t, i) => t + (i.value || 0), 0);
  const tags = l => [l.filter(i => i.rate).length ? `${staInt(l.filter(i => i.rate).length)} at Amazon's rate` : '', l.filter(i => i.noCostUnits > 0).length ? `${staInt(l.filter(i => i.noCostUnits > 0).length)} with no cost (units only)` : ''].filter(Boolean);
  const soon = wait.map(i => i.opensIn).filter(v => v != null);
  const first = soon.length ? Math.min(...soon) : null;
  const box = (k, c, label, tip, big, q, n, extra) => `
    <button type="button" class="adx-box sta-box rb-box${RBQ.focus === k ? ' on' : ''}${extra || ''}" data-qbox="${k}" style="--c:var(${c})" aria-pressed="${RBQ.focus === k}" aria-label="${rbEsc(label + ': ' + String(big).replace(/<[^>]+>/g, '') + '. ' + tip)}">
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${RBQ_IC[k]}</svg></span>${label}<span class="rb-i" title="${rbEsc(tip)}" aria-hidden="true">ⓘ</span></div>
      <div class="sta-big"><b>${big}</b></div>
      <div class="sta-q">${q}</div>
      ${n ? `<div class="sta-go"><span>${RBQ.focus === k ? 'Showing them' : 'Show them'} →</span></div>` : ''}
    </button>`;
  const sub = (l, lead) => [lead, rbqByType(l)].concat(tags(l)).filter(Boolean).join(' · ');
  $('rbqBoxes').innerHTML =
    box('claim', '--brand', 'Can claim now', 'Items open to claim today, every type, for the brand picked. Valued at our cost, else ≈ landed, else ≈ Amazon\'s rate (they count in the $); items with no cost show their units.',
      rbM0(sumV(claim)), sub(claim, `${staInt(claim.length)} item${claim.length === 1 ? '' : 's'}`), claim.length)
    + box('exp', '--bad', `Expiring in ${RB.EXPIRING} days`, `Claim-now items with ${RB.EXPIRING} days or fewer before the deadline (not confirmed yet: check it in Seller Central).`,
      rbM0(sumV(exp)), sub(exp, `${staInt(exp.length)} item${exp.length === 1 ? '' : 's'}`), exp.length)
    + box('wait', '--faint', 'Waiting on Amazon', `Not open yet: an inbound shipment Amazon has not closed or is still counting (${RB.WAIT.inbound} days after the start), or a lost / damaged unit Amazon usually pays by itself (${RB.WAIT.warehouse} days after the event).`,
      rbM0(sumV(wait)), sub(wait, `${staInt(wait.length)} item${wait.length === 1 ? '' : 's'}${first != null ? ` · earliest opens ${first === 0 ? 'today' : `in ${staInt(first)} day${first === 1 ? '' : 's'}`}` : wait.length ? ' · open when the shipments close' : ''}`), wait.length, ' rb-box-n')
    + box('proof', '--act', 'Needs proof', 'Inbound shipments open to claim without (an invoice number or link) or without (tracking or a proof of delivery). Lost, damaged and reversals need no proof of ours.',
      staInt(proof.length), `shipment${proof.length === 1 ? '' : 's'} · ${rbM0(sumV(proof))} waiting on it${proof.length ? '' : ' · every one has its proof'}`, proof.length);
}
// Under the boxes: what this page does not list (underpaid: re-checked on Overview), and the types not counted yet.
function rbqDrawLater(items) {
  const und = items.filter(i => i.type === 'underpaid' && i.status === 'claim' && (RBQ.brand === 'ALL' || i.brand === RBQ.brand));
  const H = RBD.have || {}, bits = [];
  if (und.length) bits.push(`${staInt(und.length)} underpaid payout${und.length === 1 ? '' : 's'} (${rbM0(und.reduce((t, i) => t + i.value, 0))}) are re-checked from Overview, not listed here`);
  if (!H.inbound) bits.push('inbound shortages need Amazon\'s shipment data from the backend');
  bits.push(`Not counted yet: ${RB.LATER.join(', ')}`);
  $('rbqLater').textContent = bits.join(' · ') + '.';
}
function rbqDrawChips(items) {
  const chip = (attr, on, t, n, cls, extra) => `<button type="button" class="sta-chip${on ? ' on' : ''}${cls ? ' ' + cls : ''}" ${attr} aria-pressed="${on}"${extra || ''}>${t}${n == null ? '' : `<span>${staInt(n)}</span>`}</button>`;
  const cnt = t => rbqRows(items, { type: t, focus: RBQ.focus === 'proof' && t !== 'inbound' ? '' : RBQ.focus }).length;
  $('rbqTypes').innerHTML = RB.CLAIM_TYPES.map(t => chip(`data-qtype="${t}" style="--d:var(${RB.TYPES[t].c})"`, RBQ.type === t, rbEsc(RBQ_CHIP[t]), cnt(t), 'rb-tc')).join('')
    + '<span class="rb-sep" aria-hidden="true"></span>'
    + RB.COMING.map(t => chip(`data-qsoon="${t}" style="--d:var(${RB.TYPES[t].c})"`, false, `${rbEsc(RBQ_CHIP[t])}<small>coming soon</small>`, null, 'rb-tc rbq-soon',
      ` disabled aria-disabled="true" title="${rbEsc(`Coming soon: needs Amazon's ${RBQ_SOON[t]}`)}"`)).join('');
  const base = { focus: '', st: 'claim', expired: false, arch: false };
  const n = o => rbqRows(items, Object.assign({}, base, o)).length;
  $('rbqSt').innerHTML = chip('data-qst="claim"', RBQ.st === 'claim', 'Claim now', n({}), 'rbq-st')
    + chip('data-qst="wait"', RBQ.st === 'wait', 'Wait', n({ st: 'wait' }), 'rbq-st')
    + '<span class="rb-sep" aria-hidden="true"></span>'
    + chip('data-qexp="1"', RBQ.expired, 'Show expired', rbqRows(items, { st: '', expired: true, arch: false, focus: '' }).length, 'rb-tc rb-tc-exp')
    + chip('data-qarch="1"', RBQ.arch, 'Show archived', rbqRows(items, { st: '', expired: false, arch: true, focus: '' }).length, 'rbq-st');
}

/* ---------- the table, by type ---------- */
const rbqTh = (t, tip, cls) => `<th${cls ? ` class="${cls}"` : ''}${tip ? ` title="${rbEsc(tip)}"` : ''}>${t}</th>`;
function rbqHead(type) {
  const ck = '<th class="rbq-ck"><span class="rbq-sr">Tick</span></th>';
  const tail = rbqTh('Days left', 'Days to the deadline (not confirmed yet: check it in Seller Central). Red 7 or fewer, orange 8–14, yellow 15–30.')
    + rbqTh('Status', 'Claim now, Wait (not open yet), Expired or Archived') + '<th>Action</th>';
  const val = rbqTh('Value', 'Still owed × our sourcing cost; else ≈ landed; else ≈ Amazon\'s rate (what Amazon last paid per unit for this product); else the units only', 'num');
  if (type === 'inbound') {
    return ck + rbqTh('Shipment', 'The shipment ID, its brand and name; ▸ opens one line per SKU') + rbqTh('Start date', 'The delivery date, else the close date, else the first check-in in the Inventory Ledger')
      + rbqTh('Shipped', 'Units shipped, every SKU with a received count', 'num') + rbqTh('Received', 'Units Amazon received: its shipment data, else the Inventory Ledger\'s Receipts', 'num')
      + rbqTh('Missing', 'Shipped − received − units Amazon already paid for by itself', 'num') + val + tail.replace('<th>Action</th>', '')
      + rbqTh('Proof', 'The invoice (a number or a link) and the tracking (or a proof of delivery): green when there, orange when missing') + '<th>Action</th>';
  }
  if (type === 'lost' || type === 'damaged') {
    return ck + rbqTh('Date', 'The day of the ledger event') + rbqTh('Product', 'Title, SKU and FNSKU')
      + rbqTh('Event', 'Lost, Damaged or Destroyed, the ledger\'s reason code and the transaction ID (its Reference ID)')
      + rbqTh('Units', 'Units in the ledger event', 'num')
      + rbqTh(type === 'lost' ? 'Found / paid' : 'Paid', type === 'lost' ? 'Units found again, and units Amazon paid as lost in the warehouse, covering the oldest event first' : 'Units Amazon paid as damaged (or destroyed) in the warehouse, covering the oldest event first', 'num')
      + rbqTh('Still owed', 'Units − found − paid; or Amazon\'s own Unreconciled Quantity when the ledger has it', 'num') + val + tail;
  }
  return rbqTh('Date', 'The day Amazon took the money back') + rbqTh('Product', 'Title, SKU and FNSKU') + rbqTh('Taken back', 'The reversal\'s amount and units', 'num')
    + rbqTh('Original payout', 'The reimbursement it reverses', 'num') + rbqTh('Ledger check', `No unit of the FNSKU found within ${RB.FOUND_DAYS} days either side (that is what makes it disputable)`) + tail;
}
// The Action cell: Make case / Dispute, why not, Restore; the ⋯ menu's Archive (Overview's data-rbarch / data-rbrestore).
function rbqAction(it) {
  const more = it.status === 'archived' ? '' : `<details class="rb-more"><summary title="More" aria-label="More for ${rbEsc(it.itemKey)}">⋯</summary><div class="rb-menu" role="menu"><button type="button" role="menuitem" class="ghost" data-rbarch="${rbEsc(it.key)}">Archive…</button></div></details>`;
  if (it.status === 'archived') return `<div class="rb-why is-bad">${rbEsc(it.block)}</div><button type="button" class="sta-btn dim" data-rbrestore="${rbEsc(it.key)}">Restore</button>`;
  if (it.block) return `<div class="rb-why is-bad">${rbEsc(it.block)}</div>`;
  if (it.status === 'claim') return `<div class="rb-acts"><button type="button" class="rb-go" data-rbqcase="${rbEsc(it.key)}">${RB_VERB[it.type]}</button>${more}</div>`;
  if (it.status === 'wait') return `<div class="rb-acts"><span class="rb-why">${rbEsc(rbWaitWhy(it))}</span>${more}</div>`;
  return `<div class="rb-acts"><span class="rb-why is-bad">Past the deadline</span>${more}</div>`;
}
// The tick: only a Claim-now item with nothing in the way.
function rbqCk(it) {
  const can = it.status === 'claim' && !it.block, on = RBQ.sel.includes(it.key);
  const tip = can ? (it.type === 'inbound' ? 'Tick to make its case (one shipment per case)' : `Tick to put it in one case with others (one brand, at most ${RB.MAX_ITEMS})`)
    : it.block || `Not open to claim (${RB.STATUS[it.status].t})`;
  return `<td class="rbq-ck"><input type="checkbox" class="sta-cb" data-rbqsel="${rbEsc(it.key)}"${on ? ' checked' : ''}${can ? '' : ' disabled'} aria-label="Tick ${rbEsc(it.itemKey)}" title="${rbEsc(tip)}"></td>`;
}
const rbqBrandChip = it => (RBQ.brand === 'ALL' ? ' ' + staBadge(RB_BRANDS[it.brand], 'brand-' + it.brand) : '');
const rbqProduct = it => `<td class="rb-item"><div class="rb-ttl" title="${rbEsc(it.title)}"><b>${rbEsc(it.title)}</b>${rbqBrandChip(it)}</div><small class="sta-s">${rbEsc(it.sku)} · ${rbEsc(it.fnsku)}</small></td>`;
// The two proof marks of an inbound row: the invoice, the tracking (or proof of delivery).
function rbqProofCell(it) {
  const p = rbProofOf(it, it.rec);
  const inv = !!(p.invoiceNo || p.invoiceLink), trk = !!(p.tracking.length || p.podAttached);
  const mark = (ok, ic, yes, no) => `<span class="rbq-pi ${ok ? 'is-ok' : 'is-no'}" title="${rbEsc(ok ? yes : no)}"><svg viewBox="0 0 24 24" aria-hidden="true">${RBQ_IC[ic]}</svg><b aria-hidden="true">${ok ? '✓' : '✗'}</b><span class="rbq-sr">${rbEsc(ok ? yes : no)}</span></span>`;
  return `<td><span class="rbq-pf">${mark(inv, 'inv', `Invoice: ${p.invoiceNo || 'a link'}`, 'Missing: the invoice (its number or a link)')}`
    + `${mark(trk, 'trk', p.tracking.length ? `Tracking: ${p.tracking.join(', ')}${p.fromShipment ? ' (from the shipment)' : ''}` : 'Proof of delivery attached', 'Missing: the tracking or a proof of delivery')}</span></td>`;
}
const RBQ_FROM = { delivered: ['delivered', 'The delivery date in Amazon\'s shipment data'], closed: ['closed', 'The delivery date isn\'t in the reports: the day Amazon closed the shipment'],
  checkin: ['first check-in', 'The delivery date isn\'t in the reports: the first Receipt of this shipment in the Inventory Ledger'] };
function rbqRow(it) {
  const st = `<td>${rbDaysHtml(it)}</td><td>${rbStatusPill(it.status)}</td>`;
  const act = `<td class="rb-actcell">${rbqAction(it)}</td>`;
  const sel = RBQ.sel.includes(it.key) ? ' sel' : '';
  if (it.type === 'inbound') {
    const from = RBQ_FROM[it.startFrom] || RBQ_FROM.delivered, open = RBQ.open.has(it.key);
    const src = it.recvFrom.includes('ledger') ? (it.recvFrom.includes('amazon') ? 'Some SKUs from Amazon\'s shipment data, some from the Inventory Ledger\'s Receipts' : 'From the Inventory Ledger\'s Receipts for this shipment (the shipment data has no received count)') : 'From Amazon\'s shipment data';
    const part = it.partPaid ? `<div class="rb-tags"><span class="rb-tag" title="Amazon already paid ${staInt(it.paidUnits)} of the missing units by itself: left out of this claim">part paid</span></div>` : '';
    const unk = it.unknown.length ? `<div class="rb-tags"><span class="rb-tag" title="${rbEsc(rbRecvTip({}))}">${staInt(it.unknown.length)} SKU${it.unknown.length === 1 ? '' : 's'} not known</span></div>` : '';
    const row = `<tr class="rb-row is-${it.status}${sel}">${rbqCk(it)}
      <td class="rb-item"><div class="rbq-ship"><button type="button" class="rbq-tog" data-rbqopen="${rbEsc(it.key)}" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} the SKUs" aria-label="${open ? 'Hide' : 'Show'} the SKUs of ${rbEsc(it.itemKey)}">${open ? '▾' : '▸'}</button>`
        + `<div><div class="sta-term">${rbEsc(it.itemKey)}${rbqBrandChip(it)}</div><small class="sta-s">${rbEsc(it.title)} · ${staInt((it.allSkus || []).length)} SKU${(it.allSkus || []).length === 1 ? '' : 's'}</small></div></div></td>
      <td><div>${rbDate(it.event)}</div><small class="sta-s" title="${rbEsc(from[1])}">${rbEsc(from[0])}</small></td>
      <td class="num">${staInt(it.shipped)}</td><td class="num" title="${rbEsc(src)}">${staInt(it.received)}${it.recvFrom.includes('ledger') ? '<div class="rb-tags"><span class="rb-tag">ledger</span></div>' : ''}${unk}</td>
      <td class="num"><b>${staInt(it.units)}</b>${part}</td><td class="num">${rbValHtml(it.value, it.approx, it.noCostUnits, it.rate)}</td>${st}${rbqProofCell(it)}${act}</tr>`;
    if (!open) return row;
    const sub = '<table class="xl rbq-skus"><thead><tr><th>SKU</th><th>FNSKU</th><th class="num">Shipped</th><th class="num">Received</th><th class="num">Paid by Amazon</th><th class="num">Missing</th><th class="num">Value</th></tr></thead><tbody>'
      + it.allSkus.map(x => `<tr${x.missing > 0 ? '' : ' class="is-off"'}><td><div class="sta-dcn">${rbEsc(x.sku)}</div><small>${rbEsc(x.title)}</small></td><td>${rbEsc(x.fnsku)}<small>${rbEsc(x.asin)}</small></td>`
        + `<td class="num">${staInt(x.shipped)}</td><td class="num" title="${rbEsc(rbRecvTip(x))}">${x.received == null ? '<span class="sta-dash">not known</span>' : staInt(x.received)}</td>`
        + `<td class="num">${x.paid ? staInt(x.paid) : '<span class="sta-dash">—</span>'}</td><td class="num"><b>${staInt(x.missing || 0)}</b></td>`
        + `<td class="num">${x.missing > 0 ? rbValHtml(x.val.v, x.val.approx, x.val.noCost ? x.missing : 0, x.val.basis === 'amazon') : '<span class="sta-dash">—</span>'}</td></tr>`).join('')
      + '</tbody></table>';
    return row + `<tr class="rbq-sub"><td></td><td colspan="10">${sub}</td></tr>`;
  }
  if (it.type === 'lost' || it.type === 'damaged') {
    const fp = it.type === 'lost' ? (it.found || it.paid ? `${it.found ? `${staInt(it.found)} found` : ''}${it.found && it.paid ? ' · ' : ''}${it.paid ? `${staInt(it.paid)} paid` : ''}` : '<span class="sta-dash">—</span>')
      : (it.paid ? `${staInt(it.paid)} paid` : '<span class="sta-dash">—</span>');
    const own = it.unrec != null ? '<div class="rb-tags"><span class="rb-tag" title="Amazon\'s own Unreconciled Quantity in the ledger: what it says is still open">Amazon\'s count</span></div>' : '';
    return `<tr class="rb-row is-${it.status}${sel}">${rbqCk(it)}<td>${rbDate(it.event)}</td>${rbqProduct(it)}
      <td>${rbKindTag(it.kind)}<small class="sta-s rbq-ev">${it.code ? `code ${rbEsc(it.code)} · ` : ''}${rbEsc(it.txnId || '—')}</small></td>
      <td class="num">${staInt(it.eventUnits)}</td><td class="num">${fp}</td><td class="num"><b>${staInt(it.units)}</b>${own}</td>
      <td class="num">${rbValHtml(it.value, it.approx, it.noCostUnits, it.rate)}</td>${st}${act}</tr>`;
  }
  const p = it.payout, o = it.original;
  return `<tr class="rb-row is-${it.status}">${'<td>' + rbDate(it.event) + '</td>'}${rbqProduct(it)}
    <td class="num"><b>${rbM2(Number(p.amount))}</b><small class="sta-s">${staInt(it.units)} unit${it.units === 1 ? '' : 's'} · ${rbEsc(p.reimbId)}</small></td>
    <td class="num">${o ? `${rbM2(Number(o.amount))}<small class="sta-s">${rbEsc(o.reimbId)} · ${rbDate(rbDay(o.date))}</small>` : '<span class="sta-dash">—</span>'}</td>
    <td><span class="rbq-ok" title="${rbEsc(`No unit of ${it.fnsku} found between ${rbDate(it.checkFrom)} and ${rbDate(it.checkTo)}`)}">✓ no unit found</span><small class="sta-s">±${RB.FOUND_DAYS} days</small></td>${st}${act}</tr>`;
}
// The empty table: what is missing for this type, else nothing to claim.
function rbqEmptyHtml(items) {
  const t = RBQ.type, H = RBD.have || {};
  const up = (what, why) => `<b>Upload the ${what}.</b> ${why} <button type="button" class="sta-btn sm" data-rbqup="1">Upload Amazon reports</button>`;
  if (t === 'inbound' && !H.inbound) return '<b>Needs Amazon\'s shipment data from the backend (reimbInbound).</b> No report you can download holds the units shipped per shipment, so there is no upload for it.';
  if ((t === 'lost' || t === 'damaged') && !rbqHave('ledger')) return up('Inventory Ledger', `Lost and damaged units are read from its Adjustments${RBQ.brand !== 'ALL' ? ` for ${rbEsc(RB_BRANDS[RBQ.brand])}` : ''}.`);
  if (!rbqHave('payouts')) return up('Reimbursements report', t === 'reversal' ? 'Reversals are payouts with a negative amount.' : 'Without it Sellora cannot tell what Amazon already paid for.');
  if (t === 'reversal' && !rbqHave('ledger')) return up('Inventory Ledger', 'A reversal is judged only against the ledger (was the unit really found?).');
  if (RBQ.q || RBQ.focus === 'exp' || RBQ.focus === 'proof') return 'Nothing here with these choices.';
  if (RBQ.st === 'wait') return '<b>Nothing waiting on Amazon.</b>';
  const w = rbqRows(items, { st: 'wait', focus: '', q: '' }).length;
  return `<span class="rb-tick" aria-hidden="true">✓</span><b>Nothing to claim right now.</b>${w ? ` ${staInt(w)} waiting on Amazon (the Wait chip).` : ''}`;
}
function rbqDrawTable(items) {
  const rows = rbqRows(items);
  const shown = rows.slice(0, RBQ.shown);
  const cols = { inbound: 11, lost: 11, damaged: 11, reversal: 8 }[RBQ.type];
  $('rbqTitle').textContent = RBQ_TITLE[RBQ.type];
  $('rbqN').textContent = staInt(rows.length);
  $('rbqSub').textContent = (RBQ.st === 'wait' ? 'Not open yet: the soonest to open first.' : 'Claim now first, the fewest days left first, then the biggest.')
    + (RBQ.type === 'lost' || RBQ.type === 'damaged' ? ` Tick several of one brand to make one case (up to ${RB.MAX_ITEMS}).` : RBQ.type === 'inbound' ? ' One shipment per case; ▸ shows its SKUs.' : ' One reversal per case.');
  $('rbqFocus').innerHTML = RBQ.focus ? `<span class="rb-focus">Showing: <b>${rbEsc(RBQ_FOCUS[RBQ.focus])}</b><button type="button" class="sta-fx" data-qfocusx="1" title="Show every row" aria-label="Show every row">✕</button></span>` : '';
  $('rbqTable').innerHTML = `<thead><tr>${rbqHead(RBQ.type)}</tr></thead><tbody>`
    + (shown.map(rbqRow).join('') || `<tr><td colspan="${cols}" class="rb-empty">${rbqEmptyHtml(items)}</td></tr>`) + '</tbody>';
  $('rbqFoot').innerHTML = rows.length > shown.length
    ? `<span>${staInt(shown.length)} of ${staInt(rows.length)} rows</span><button type="button" class="ghost" data-rbqmore="1">Show more (${staInt(Math.min(RBQ_STEP, rows.length - shown.length))})</button>`
    : rows.length ? `<span>${staInt(rows.length)} row${rows.length === 1 ? '' : 's'}</span>` : '';
}

/* ---------- ticking items into one case ---------- */
// The selection bar: "N selected · $X · Make case (N)", and why the last tick was refused.
function rbqDrawSel() {
  const map = new Map(RBQ_ITEMS.map(i => [i.key, i]));
  RBQ.sel = RBQ.sel.filter(k => map.has(k) && map.get(k).status === 'claim' && !map.get(k).block);
  const el = $('rbqSel');
  if (!RBQ.sel.length && !RBQ.why) { el.classList.add('hide'); el.innerHTML = ''; return; }
  const list = RBQ.sel.map(k => map.get(k)), v = list.reduce((t, i) => t + (i.value || 0), 0), n = list.length;
  el.classList.remove('hide');
  el.innerHTML = `<span><b>${staInt(n)} selected</b> · ${list.some(i => i.approx || i.rate) ? '≈ ' : ''}${rbM2(v)}</span>`
    + (RBQ.why ? `<span class="rbq-why" role="alert">${rbEsc(RBQ.why)}</span>` : '')
    + `<button type="button" data-rbqmake="1"${n ? '' : ' disabled'}>Make case (${staInt(n)})</button><button type="button" class="ghost" data-rbqclear="1">Clear</button>`;
}
// A tick: kept only when the ticked items may still be one case (rbBatchCheck); otherwise refused, saying why.
function rbqTick(key, on, box) {
  RBQ.why = '';
  if (!on) RBQ.sel = RBQ.sel.filter(k => k !== key);
  else if (!RBQ.sel.includes(key)) {
    const map = new Map(RBQ_ITEMS.map(i => [i.key, i]));
    const why = rbBatchCheck(RBQ.sel.concat(key).map(k => map.get(k)).filter(Boolean));
    if (why) { if (box) box.checked = false; RBQ.why = `Not added: ${why}.`; }
    else RBQ.sel.push(key);
  }
  const tr = box && box.closest('tr');
  if (tr) tr.classList.toggle('sel', RBQ.sel.includes(key));
  rbqDrawSel();
}
// After "I've created the case" (rbCaseDone): the ticks of those items go.
function rbqCaseMade(keys) {
  RBQ.sel = RBQ.sel.filter(k => !keys.includes(k));
  RBQ.why = '';
}

/* ---------- from Overview: its boxes and "See all in To Claim" ---------- */
// o: { brand, focus ('' | 'exp') }. Opens To Claim on Claim now with that filter, on a type that has rows for it.
function rbqGo(o) {
  o = o || {};
  if (o.brand in RB_BRANDS) RBQ.brand = o.brand;
  RBQ.focus = o.focus || '';
  RBQ.st = 'claim';
  RBQ.q = '';
  RBQ.shown = RBQ_STEP;
  RBQ.sel = [];
  RBQ.why = '';
  if (RBD) {
    const items = rbItems(RBD, RBC.recs, rbToday());
    const has = t => rbqRows(items, { type: t }).length > 0;
    if (!has(RBQ.type)) RBQ.type = RB.CLAIM_TYPES.find(has) || RBQ.type;
  }
  rbqPrefsSave();
  showTab('rbclaim');
}

/* ---------- Export: the rows under the choices ---------- */
function rbqCsv() {
  if (!RBD) return;
  const rows = rbqRows(rbItems(RBD, RBC.recs, rbToday()));
  const blob = new Blob(['﻿' + rbCsvLines(rows).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reimbursement-to-claim-${RBQ.type}-${RBQ.brand}${RBD.sample ? '-SAMPLE' : ''}-${rbIso(rbToday())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- wiring ---------- */
const rbqRedraw = () => renderRbclaim();
// A new view: back to the first 50 rows, no ticks carried over (a case is one brand, one type).
const rbqReset = () => { RBQ.shown = RBQ_STEP; RBQ.sel = []; RBQ.why = ''; RBQ.open = new Set(); };
$('rbqBrand').addEventListener('change', () => { RBQ.brand = $('rbqBrand').value in RB_BRANDS ? $('rbqBrand').value : 'ALL'; rbqReset(); rbqPrefsSave(); rbqRedraw(); });
$('rbqTypes').addEventListener('click', e => {
  const b = e.target.closest('[data-qtype]');
  if (!b || b.dataset.qtype === RBQ.type) return;
  RBQ.type = b.dataset.qtype;
  if (RBQ.focus === 'proof' && RBQ.type !== 'inbound') RBQ.focus = '';
  rbqReset();
  rbqPrefsSave();
  rbqRedraw();
});
$('rbqSt').addEventListener('click', e => {
  const s = e.target.closest('[data-qst]'), x = e.target.closest('[data-qexp]'), a = e.target.closest('[data-qarch]');
  if (s) { RBQ.st = s.dataset.qst; RBQ.focus = ''; }
  else if (x) RBQ.expired = !RBQ.expired;
  else if (a) RBQ.arch = !RBQ.arch;
  else return;
  RBQ.shown = RBQ_STEP;
  rbqPrefsSave();
  rbqRedraw();
});
{
  let t = 0;
  $('rbqQ').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { RBQ.q = $('rbqQ').value; RBQ.shown = RBQ_STEP; rbqRedraw(); }, 150); });
}
$('rbqBoxes').addEventListener('click', e => {
  const b = e.target.closest('[data-qbox]');
  if (!b || !RBD) return;
  const k = b.dataset.qbox;
  if (RBQ.focus === k) { RBQ.focus = ''; RBQ.st = 'claim'; }
  else {
    RBQ.focus = k;
    RBQ.st = k === 'wait' ? 'wait' : 'claim';
    if (k === 'proof') RBQ.type = 'inbound';
    else {
      const has = t => rbqRows(RBQ_ITEMS, { type: t }).length > 0;
      if (!has(RBQ.type)) RBQ.type = RB.CLAIM_TYPES.find(has) || RBQ.type;
    }
  }
  rbqReset();
  rbqPrefsSave();
  rbqRedraw();
});
$('rbqFocus').addEventListener('click', e => { if (e.target.closest('[data-qfocusx]')) { RBQ.focus = ''; RBQ.shown = RBQ_STEP; rbqRedraw(); } });
$('rbqTable').addEventListener('click', e => {
  const o = e.target.closest('[data-rbqopen]'), c = e.target.closest('[data-rbqcase]'), a = e.target.closest('[data-rbarch]'), r = e.target.closest('[data-rbrestore]');
  const u = e.target.closest('[data-rbqup]');
  if (o) { const k = o.dataset.rbqopen; if (RBQ.open.has(k)) RBQ.open.delete(k); else RBQ.open.add(k); rbCard('rbqBody', () => rbqDrawTable(RBQ_ITEMS)); }
  else if (c) { const why = rbOpen(c.dataset.rbqcase); if (why) { RBQ.why = why; rbqDrawSel(); } }
  else if (a) { const d = a.closest('details'); if (d) d.open = false; rbArchOpen(a.dataset.rbarch); }
  else if (r) rbRestore(r.dataset.rbrestore);
  else if (u) rbUpOpen(RBQ.brand);
});
$('rbqTable').addEventListener('change', e => { const b = e.target.closest('[data-rbqsel]'); if (b) rbqTick(b.dataset.rbqsel, b.checked, b); });
// One ⋯ menu open at a time.
$('rbqTable').addEventListener('toggle', e => {
  if (e.target.tagName === 'DETAILS' && e.target.open) $('rbqTable').querySelectorAll('details.rb-more[open]').forEach(d => { if (d !== e.target) d.open = false; });
}, true);
$('rbqFoot').addEventListener('click', e => { if (e.target.closest('[data-rbqmore]')) { RBQ.shown += RBQ_STEP; rbCard('rbqBody', () => rbqDrawTable(RBQ_ITEMS)); } });
$('rbqSel').addEventListener('click', e => {
  if (e.target.closest('[data-rbqclear]')) { RBQ.sel = []; RBQ.why = ''; rbqRedraw(); return; }
  if (e.target.closest('[data-rbqmake]')) { const why = rbOpen(RBQ.sel); RBQ.why = why ? `Not one case: ${why}.` : ''; rbqDrawSel(); }
});
$('rbqMsg').addEventListener('click', e => { if (e.target.closest('[data-rbqretry]')) { RB_ERR = ''; ensureRbclaim(); } });
$('rbqUpBtn').addEventListener('click', () => rbUpOpen(RBQ.brand));
$('rbqLegendBtn').addEventListener('click', () => { $('rbLegendBody').innerHTML = rbLegendHtml(); $('rbLegend').classList.remove('hide'); });
$('rbqCsv').addEventListener('click', rbqCsv);
