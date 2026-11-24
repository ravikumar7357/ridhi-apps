/* ================= REIMBURSEMENT · OVERVIEW: what Amazon owes us, what to claim this week, and what it paid (24 Nov 2026) =================
 * Screen: Reimbursement › Overview (tab 'reimb', pane paneReimb; core/nav.js calls ensureReimb when it opens). Its own right
 * ('reimb' on the Access page, not inherited from another tab). The numbers come from reimb-core.js (the engine) over what
 * rbLoad (reimb-data.js) hands over: REAL DATA — the backend caches once they exist, else the reports a person uploads here
 * (Upload Amazon reports), else "Connect Amazon's data" with nothing made up. The sample only with ?sample=1, with its yellow
 * banner. It reads (never writes) the backend's caches, and nothing here changes anything at Amazon.
 *
 * Layout, top to bottom (Search Term Analysis's and N-Gram Analysis's classes — sta-scope, sta-barcard, sta-box, sta-tcard,
 * sta-modal — with rb- adding only what they lack):
 *   the bar      brand, period (30 days · 90 days · 12 months · Custom), how new the data is and where it came from, Upload
 *                Amazon reports, How Sellora counts, Export (the action list as CSV). Brand and period are remembered on this
 *                device (rbPrefs).
 *   banner       sample data (yellow), only with ?sample=1. With nothing read yet, "Connect Amazon's data" (rbDrawConnect)
 *                stands in for everything below.
 *   six boxes    Owed now, Expiring in 14 days, Recovered (the period, through our cases / paid by Amazon itself, against the
 *                period before), Underpaid, Open cases, Lost to deadlines (the period). Owed, Expiring and Underpaid filter
 *                the action list; Open cases lists the cases; Recovered and Lost scroll to the chart. Under them: what is not
 *                counted yet (RB.LATER).
 *   fix banner   (orange) Amazon paid below our cost: how to set our sourcing cost at Amazon (2 steps).
 *   Do this week the action list (rbWeekList): type chips, Expired, Show archived; Make case / Re-check / Dispute, ⋯ Archive;
 *                10 rows, then Show all.
 *   chart        payouts by month, the last 12 months: through our cases vs paid by Amazon itself, or by reason; reversals
 *                below zero. The Ad Console's chart look (adx-plot, adx-tip, adx-legend).
 *   most-lost    the products that lost most in the last 12 months, and how much of it Amazon paid back.
 * Each card draws inside its own try: one failing never blanks the page.
 * SHARED WITH TO CLAIM (reimb-claim.js): the data (RBD, rbLoadAll), the case records (RBC, rbCaseSave), the case dialog
 * (rbOpen: one item, or a case of several lost / damaged items), Archive / Restore, Upload Amazon reports and How Sellora
 * counts. Their dialogs sit in #rbDialogs, outside both panes, so either page can open them; after a change every page of
 * the module redraws (rbRedrawAll, RB_PAGES). Owed now and Expiring open To Claim with the same filter (rbqGo).
 *
 * SAVING. One record per item in Firestore reimbCases/{brand_type_itemKey}: { brand, type, itemKey, status, caseId, estimate,
 * checks, note, reason, trail }. Every change appends one trail step, the same as PPC History's (ppchEvent: who, which
 * device, when). Never deleted. Until the rule is deployed (firestore.rules) a read is refused, and the records are kept in
 * this browser with the same note as Search Term Analysis's review list. With the SAMPLE data the records always stay in this
 * browser (reimbCasesSample): sample shipments must never reach the shared list.
 * Main functions: ensureReimb, renderReimb, rbRedrawAll, rbCasesLoad, rbCaseSave, rbOpen, rbDlgHtml, rbProofSave, rbArchOpen,
 * rbCasesOpen, rbFixOpen, rbLegendHtml, rbChartPlot, rbCsv. */

// The screen's choices: brand, period (and the custom days), the type chip, the box that filters the list, Expired, Show
// archived, Show all, the chart's view and the parts its legend switched off.
const RBS = { brand: 'ALL', period: '30', from: '', to: '', type: '', focus: '', expired: false, arch: false, all: false, chart: 'cases', off: {} };
const RB_PREFS = 'rbPrefs';
const RB_SHOWN = 10;   // rows of the action list before "Show all"
let RBD = null, RB_ERR = '', RB_LOADING = null, RB_DLG = null, RB_CH = null, RB_NOTE = '';
// The case records: key → record; where they are kept ('fs' the shared list, 'local' this browser until the rule is deployed,
// 'sample' this browser because the data is the sample).
const RBC = { recs: new Map(), where: '', err: '' };
const RB_LOCAL = 'reimbCases', RB_LOCAL_SAMPLE = 'reimbCasesSample';
const RB_ASOF = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const RB_BRANDS = { ALL: 'Both brands', SP: 'Ridhi', CPC: 'Cotton Print Club' };
// Every page of the module redraws after a change (a case made, an item archived, an upload): Overview, and each page that
// adds its own draw here (To Claim: renderRbclaim). Each draws only while its pane is on screen.
const RB_PAGES = [];
function rbRedrawAll() {
  renderReimb();
  RB_PAGES.forEach(f => { try { f(); } catch (e) { try { console.error(e); } catch (x) { /* no console */ } } });
}

/* ---------- this device's choices ---------- */
(function rbPrefsLoad() {
  try {
    const p = JSON.parse(localStorage.getItem(RB_PREFS) || '{}') || {};
    if (p.brand in RB_BRANDS) RBS.brand = p.brand;
    if (['30', '90', '365', 'custom'].includes(p.period)) RBS.period = p.period;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.from || '')) RBS.from = p.from;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.to || '')) RBS.to = p.to;
  } catch (e) { /* the defaults */ }
})();
function rbPrefsSave() {
  try { localStorage.setItem(RB_PREFS, JSON.stringify({ brand: RBS.brand, period: RBS.period, from: RBS.from, to: RBS.to })); } catch (e) { /* kept for this visit */ }
}

/* ---------- loading ---------- */
// Called when the tab opens: the data and the case records once (a skeleton meanwhile), then the page.
async function ensureReimb() {
  if (!RBD) {
    renderReimb();
    try { await rbLoadAll(); } catch (e) { RB_ERR = String((e && e.message) || e); }
  }
  renderReimb();
}
function rbLoadAll() {
  if (!RB_LOADING) {
    RB_LOADING = (async () => {
      const d = await rbLoad();
      await rbCasesLoad(d);
      RBD = d;
      RB_ERR = '';
    })().finally(() => { RB_LOADING = null; });
  }
  return RB_LOADING;
}
// Today: the sample's own day (so its numbers never move), else this computer's calendar day.
function rbToday() {
  if (RBD && RBD.sample) return rbDay(RBD.asOf);
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ---------- the case records ---------- */
async function rbCasesLoad(d) {
  RBC.recs = new Map();
  if (d.sample) {
    RBC.where = 'sample';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RB_LOCAL_SAMPLE) || 'null'); } catch (e) { saved = null; }
    (Array.isArray(saved) ? saved : d.sampleCases || []).forEach(r => RBC.recs.set(r.id, r));
    return;
  }
  try {
    const s = await getDocs(collection(db, 'reimbCases'));
    s.docs.forEach(x => RBC.recs.set(x.id, Object.assign({}, x.data(), { id: x.id })));
    RBC.where = 'fs';
    RBC.err = '';
  } catch (e) {
    RBC.where = 'local';
    RBC.err = String((e && (e.code || e.message)) || e);
    try { (JSON.parse(localStorage.getItem(RB_LOCAL) || '[]') || []).forEach(r => RBC.recs.set(r.id, r)); } catch (x) { /* none kept */ }
  }
}
// The record of an item, or a new draft one (not saved until something changes).
function rbRecOf(it) {
  return RBC.recs.get(it.key) || { id: it.key, brand: it.brand, type: it.type, itemKey: it.itemKey, status: 'draft', caseId: '',
    estimate: it.value || 0, checks: {}, note: '', reason: '', trail: [] };
}
// Save a change to a record: the patch, one trail step (who, which device, when — PPC History's ppchEvent), then the shared
// list or this browser. On a shared login the person is named first. A failed save changes nothing here and says why.
async function rbCaseSave(rec, patch, act, extra) {
  await ppchNeedPerson();
  const next = Object.assign({}, rec, patch, { checks: Object.assign({}, rec.checks, patch.checks || {}) });
  next.trail = (rec.trail || []).concat(ppchEvent(act, extra));
  ppchStampPerson(next);
  next.up = Date.now();
  if (RBC.where === 'fs') {
    const clean = JSON.parse(JSON.stringify(next));
    delete clean.id;
    await setDoc(doc(db, 'reimbCases', next.id), clean);
  }
  RBC.recs.set(next.id, next);
  if (RBC.where !== 'fs') {
    try { localStorage.setItem(RBC.where === 'sample' ? RB_LOCAL_SAMPLE : RB_LOCAL, JSON.stringify([...RBC.recs.values()])); } catch (e) { throw new Error('this browser would not store it'); }
  }
  return next;
}
// Where the records are kept, in the bar's small line.
function rbStoreNote() {
  if (RBC.where === 'sample') return '<span class="sta-dash">Sample data: case records made here are kept in this browser only and never reach the shared list.</span>';
  if (RBC.where === 'local') return '<span class="sta-bad">Kept in this browser only.</span> <span>The shared case list needs its database rule (Ravi: reimbCases in firestore.rules). Until then nobody else sees these, and clearing the browser loses them.</span>';
  return '';
}

/* ---------- drawing ---------- */
const rbEsc = s => staEsc(s);
// Money on screen: one format everywhere (rbFmt, reimb-core.js) — cents under $100, whole dollars from $100 up.
const rbM0 = v => rbFmt(v);
const rbM2 = v => rbFmt(v);
const rbTypePill = t => `<span class="rb-type" style="--d:var(${RB.TYPES[t].c})">${rbEsc(RB.TYPES[t].short)}</span>`;
const rbStatusPill = s => `<span class="rb-st rb-st-${RB.STATUS[s].cls}">${rbEsc(RB.STATUS[s].t)}</span>`;
const rbDaysHtml = it => { const p = rbDaysPill(it); return `<span class="rb-days rb-d-${p.cls}">${rbEsc(p.t)}</span>`; };
// A value with its tags: "≈ landed" (landed cost only), "≈ Amazon's rate" (no cost at all: what Amazon last paid per unit),
// "N no cost" (units with no cost, left out of the $).
const RB_RATE_TIP = 'No unit cost in Profit & Margin — valued at what Amazon last paid per unit for this product';
function rbValHtml(v, approx, noCostUnits, rate) {
  const tags = (approx ? '<span class="rb-tag" title="Only the landed cost is known: it includes freight, which Amazon\'s sourcing cost does not">≈ landed</span>' : '')
    + (rate ? `<span class="rb-tag rb-tag-rate" title="${rbEsc(RB_RATE_TIP)}">≈ Amazon's rate</span>` : '')
    + (noCostUnits ? `<span class="rb-tag" title="No cost for these units: left out of every $ total">${staInt(noCostUnits)} no cost</span>` : '');
  return `${v == null ? '<span class="sta-dash">—</span>' : rbM2(v)}${tags ? '<div class="rb-tags">' + tags + '</div>' : ''}`;
}
// One card, drawn inside its own try: when it fails, it says so and the rest of the page stays.
function rbCard(id, fn) {
  try { fn(); } catch (e) {
    const el = $(id);
    if (el) el.innerHTML = `<div class="rb-fail">This part could not be drawn: ${rbEsc((e && e.message) || e)}</div>`;
    try { console.error(e); } catch (x) { /* no console */ }
  }
}
function renderReimb() {
  if (!$('paneReimb') || $('paneReimb').classList.contains('hide')) return;
  rbCard('rbBarInfo', rbDrawBar);
  if (!RBD) {
    if (RB_ERR) {
      $('rbMsg').innerHTML = `<span class="sta-bad">✗ The reimbursement data could not be read: ${rbEsc(RB_ERR)}</span> <button type="button" class="sta-btn sm" data-rbretry="1">Try again</button>`;
      $('rbBoxes').innerHTML = '';
    } else {
      $('rbBoxes').innerHTML = Array.from({ length: 6 }, () => '<div class="adx-box rb-box rb-skel" aria-hidden="true"><div class="ui-loading rb-sk1"></div><div class="ui-loading rb-sk2"></div><div class="ui-loading rb-sk3"></div></div>').join('');
      $('rbTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">Loading the reimbursements…</td></tr></tbody>';
    }
    return;
  }
  const today = rbToday();
  const items = rbItems(RBD, RBC.recs, today);
  const P = rbPeriod(RBS.period, today, RBS.from, RBS.to);
  $('rbSampleNote').classList.toggle('hide', !RBD.sample);
  const notes = [rbDataNote(), rbStoreNote(), RBD.costNote ? `<span class="sta-dash">${rbEsc(RBD.costNote)}: values show as units only.</span>` : ''].filter(Boolean);
  $('rbMsg').innerHTML = notes.join(' ') + (RB_NOTE ? ` <span class="rb-saved">${RB_NOTE}</span>` : '');
  // Nothing read at all: "Connect Amazon's data" instead of six empty boxes.
  const none = !RBD.sample && RBD.source === 'none';
  $('rbConnect').classList.toggle('hide', !none);
  $('rbMain').classList.toggle('hide', none);
  if (none) { rbCard('rbConnect', rbDrawConnect); return; }
  rbCard('rbBoxes', () => rbDrawBoxes(rbOverview(items, RBD, RBC.recs, P, today, RBS.brand), P));
  rbCard('rbLater', () => {
    const H = RBD.have || {}, extra = [];
    if (!H.inbound) extra.push('inbound shortages — needs Amazon\'s shipment data from the backend');
    if (!H.ledger) extra.push('lost and damaged in the warehouse, reversal checks and most-lost products — need the Inventory Ledger (Upload Amazon reports)');
    else if (!H.payouts) extra.push('lost and damaged in the warehouse — need the Reimbursements report too (what Amazon already paid)');
    $('rbLater').textContent = 'Not counted yet: ' + extra.concat(RB.LATER.join(', ')).join(' · ') + '.';
  });
  rbCard('rbFix', () => rbDrawFix(items));
  rbCard('rbWeekBody', () => rbDrawWeek(items));
  rbCard('rbChartBody', () => rbDrawChart(today));
  rbCard('rbLostBody', () => rbDrawLost(today));
  rbCard('rbWeekGo', () => { $('rbWeekGo').innerHTML = `<button type="button" class="sta-linkbtn rb-golink" data-rbgo="1">See all in To Claim →</button>`; });
}
// The bar: the chosen brand and period, the data's day, Sample data.
function rbDrawBar() {
  $('rbBrand').value = RBS.brand;
  $('rbPeriod').querySelectorAll('[data-p]').forEach(b => { const on = b.dataset.p === RBS.period; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  $('rbDates').classList.toggle('hide', RBS.period !== 'custom');
  $('rbFrom').value = RBS.from;
  $('rbTo').value = RBS.to;
  const at = RBD && Date.parse(RBD.asOf);
  $('rbAsOf').textContent = !RBD ? 'Loading…' : RBD.sample ? (at ? 'Amazon data as of ' + RB_ASOF.format(at) : '')
    : RBD.source === 'none' ? 'No Amazon data yet'
      : `Amazon data up to ${rbDate(rbDay(RBD.asOf))} · ${RBD.source === 'backend' ? 'read by the backend' : 'from uploaded reports'}`;
  $('rbSampleBadge').classList.toggle('hide', !(RBD && RBD.sample));
  $('rbUpBtn').classList.toggle('hide', !!(RBD && RBD.sample));
}
// ▲ 12% / ▼ 5% / new / —: green when the move is good (upGood: up is good; Lost: up is bad).
function rbArrow(d, upGood) {
  if (!d || d.dir === 'flat') return '<span class="rb-dl">— same as before</span>';
  const good = (d.dir === 'up') === upGood;
  const pct = d.pct == null ? 'new' : `${Math.round(Math.abs(d.pct))}%`;
  return `<span class="rb-dl ${good ? 'is-good' : 'is-bad'}" title="Against the ${d.was != null ? rbM0(d.was) : '—'} of the period before, the same length">${d.dir === 'up' ? '▲' : '▼'} ${pct}</span>`;
}
const RB_IC = {
  owed: '<path d="M12 3v18"/><path d="M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>',
  exp: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/>',
  rec: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  under: '<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  cases: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  lost: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
};
// " · 2 at Amazon's rate": how many of a box's items are valued at what Amazon last paid (they count in its $).
const rbRateNote = n => (n ? ` · <span title="${rbEsc(RB_RATE_TIP)}">${staInt(n)} at Amazon's rate</span>` : '');
function rbDrawBoxes(o, P) {
  const per = P.key === 'custom' ? `${rbDate(P.from)} – ${rbDate(P.to)}` : P.key === '365' ? 'the last 12 months' : `the last ${P.days} days`;
  const box = (k, c, label, tip, big, q, go, extra) => `
    <button type="button" class="adx-box sta-box rb-box${RBS.focus === k ? ' on' : ''}${extra || ''}" data-box="${k}" style="--c:var(${c})" aria-label="${rbEsc(label + ': ' + big.replace(/<[^>]+>/g, '') + '. ' + tip)}">
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${RB_IC[k]}</svg></span>${label}<span class="rb-i" title="${rbEsc(tip)}" aria-hidden="true">ⓘ</span></div>
      <div class="sta-big"><b${k === 'lost' ? ' class="rb-red"' : ''}>${big}</b></div>
      <div class="sta-q">${q}</div>
      ${go ? `<div class="sta-go"><span>${go} →</span></div>` : ''}
    </button>`;
  const r = o.recovered;
  $('rbBoxes').innerHTML =
    box('owed', '--brand', 'Owed now', 'Items you can claim today (status Claim now), at our cost. Items with no cost show their units and are left out of the $.',
      rbM0(o.owed.v), `${staInt(o.owed.n)} item${o.owed.n === 1 ? '' : 's'} to claim today${rbRateNote(o.owed.rate)}${o.owed.noCost ? ` · ${staInt(o.owed.noCost)} ${o.owed.noCost === 1 ? 'has' : 'have'} no cost (units only)` : ''}`, o.owed.n ? 'Open in To Claim' : '')
    + box('exp', '--bad', `Expiring in ${RB.EXPIRING} days`, `Claim-now items with ${RB.EXPIRING} days or fewer left before the deadline.`,
      rbM0(o.expiring.v), `${staInt(o.expiring.n)} item${o.expiring.n === 1 ? '' : 's'} with ${RB.EXPIRING} days or fewer left${rbRateNote(o.expiring.rate)}`, o.expiring.n ? 'Open in To Claim' : '')
    + box('rec', '--accent', 'Recovered', `What Amazon paid in ${per}, in two parts: through our cases (payouts with a case ID) and paid by Amazon itself (no case ID); each against the period before, the same length.`,
      rbM0(r.all), `<span class="rb-part"><span>Through our cases</span><span><b>${rbM0(r.viaCase)}</b> ${rbArrow(r.dCase, true)}</span></span>`
        + `<span class="rb-part"><span>Paid by Amazon itself</span><span><b>${rbM0(r.auto)}</b> ${rbArrow(r.dAuto, true)}</span></span>`, 'See by month')
    // No sourcing cost entered anywhere yet: say what it needs, never a $ (Profit & Margin's landed cost is not the one Amazon
    // pays against). The payouts below the landed cost are a hint only: they may still be at or above the sourcing cost.
    + (o.underpaid.sourcing
      ? box('under', '--act', 'Underpaid', `Payouts below our sourcing cost per unit, still inside the ${RB.DEADLINE.recheck.days}-day re-check window: the gap is (cost − paid per unit) × units.`,
        rbM0(o.underpaid.v), `${staInt(o.underpaid.n)} payout${o.underpaid.n === 1 ? '' : 's'} below our cost, still open to re-check`, o.underpaid.n ? 'Show them' : '')
      : box('under', '--act', 'Underpaid', 'Underpaid is judged against our SOURCING cost (what the supplier is paid for one unit). Nobody has entered it yet; Profit & Margin holds the landed cost, which includes freight.',
        '<span class="rb-na">Needs sourcing costs</span>', 'Added with the Paid page'
          + (RBD.costNote ? `<span class="rb-hint">${rbEsc(RBD.costNote)}</span>`
            : o.underpaid.belowLanded ? `<span class="rb-hint">${staInt(o.underpaid.belowLanded)} payout${o.underpaid.belowLanded === 1 ? ' is' : 's are'} below landed cost (possible)</span>` : ''),
        '', ' rb-box-na'))
    + box('cases', o.open.many ? '--act' : '--violet-ink', 'Open cases', `Cases opened from Sellora and not paid yet, with the value we estimated for each. Amazon advises under ${RB.MAX_OPEN} open cases at a time.`,
      staInt(o.open.n), `≈ ${rbM0(o.open.v)} estimated${o.open.many ? ` · <b class="rb-warnw">Amazon advises under ${RB.MAX_OPEN} open</b>` : ''}`, o.open.n ? 'List them' : '')
    + box('lost', '--faint', 'Lost to deadlines', `Money that passed its deadline unclaimed in ${per}, against the period before (up is bad).`,
      rbM0(o.lost.v), `${staInt(o.lost.n)} item${o.lost.n === 1 ? '' : 's'} expired unclaimed ${rbArrow(o.lost.delta, false)}`, 'See by month', ' rb-box-n');
}
// The orange banner: Amazon paid below our cost (underpaid items open to re-check).
function rbDrawFix(items) {
  const u = items.filter(i => i.type === 'underpaid' && i.status === 'claim' && (RBS.brand === 'ALL' || i.brand === RBS.brand));
  const el = $('rbFix');
  el.classList.toggle('hide', !u.length);
  if (!u.length) { el.innerHTML = ''; return; }
  const n = new Set(u.map(i => i.brand + '|' + i.asin)).size, v = u.reduce((t, i) => t + i.value, 0);
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${RB_IC.under}</svg><div><b>Amazon paid below our cost for ${staInt(n)} product${n === 1 ? '' : 's'} (${rbM2(v)}).</b> `
    + 'Telling Amazon our sourcing cost makes the next payouts right; the ones below can be re-checked in the action list.</div>'
    + '<button type="button" class="sta-btn" data-rbfix="1">How to fix (2 steps)</button>';
}

/* ---------- Do this week ---------- */
const RB_VERB = { inbound: 'Make case', lost: 'Make case', damaged: 'Make case', underpaid: 'Re-check', reversal: 'Dispute' };
// Why a Wait item is not open yet, in the row.
const rbWaitWhy = it => (it.type === 'inbound' ? (it.closed ? 'Amazon is still counting' : 'Not closed yet')
  : `Amazon usually pays these itself within ${RB.WAIT.warehouse} days`);
function rbWeekRows(items) {
  return rbWeekList(items, { brand: RBS.brand, type: RBS.type, focus: RBS.focus, expired: RBS.expired, archived: RBS.arch });
}
function rbDrawWeek(items) {
  const base = rbWeekList(items, { brand: RBS.brand, expired: true, archived: true });
  const rows = rbWeekRows(items);
  // --- the chips: every type present, Expired, and the box that filters the list ---
  const types = RB.LIVE_TYPES.filter(t => base.some(i => i.type === t && i.status !== 'archived' && i.status !== 'expired'));
  if (RBS.type && !types.includes(RBS.type)) RBS.type = '';
  const count = t => base.filter(i => i.type === t && i.status !== 'archived' && i.status !== 'expired').length;
  const nExp = base.filter(i => i.status === 'expired' && (!RBS.type || i.type === RBS.type)).length;
  const chip = (attr, on, t, n, cls) => `<button type="button" class="sta-chip${on ? ' on' : ''}${cls ? ' ' + cls : ''}" ${attr} aria-pressed="${on}">${t}<span>${staInt(n)}</span></button>`;
  const FOCUS = { owed: 'Owed now', exp: `Expiring in ${RB.EXPIRING} days`, under: 'Underpaid' };
  $('rbChips').innerHTML = '<span class="sta-actl">Type</span>'
    + chip('data-type=""', !RBS.type, 'All', types.reduce((t, k) => t + count(k), 0))
    + types.map(t => chip(`data-type="${t}"`, RBS.type === t, rbEsc(RB.TYPES[t].short), count(t), 'rb-tc') .replace('class="sta-chip', `style="--d:var(${RB.TYPES[t].c})" class="sta-chip`)).join('')
    + `<span class="rb-sep"></span>${chip('data-exp="1"', RBS.expired, 'Expired', nExp, 'rb-tc rb-tc-exp')}`
    + (RBS.focus ? `<span class="rb-focus">Showing: <b>${FOCUS[RBS.focus]}</b><button type="button" class="sta-fx" data-focusx="1" title="Show every row" aria-label="Show every row">✕</button></span>` : '');
  $('rbArch').checked = RBS.arch;
  $('rbWeekN').textContent = staInt(rows.length);
  $('rbWeekSub').textContent = 'Claim now first, the fewest days left first, then the biggest. Wait rows open once Amazon has finished counting.'
    + (RBS.arch ? ' Archived rows are shown at the end.' : '');
  // --- the table ---
  const shown = RBS.all ? rows : rows.slice(0, RB_SHOWN);
  const action = it => {
    const more = it.status === 'archived' ? '' : `<details class="rb-more"><summary title="More" aria-label="More for ${rbEsc(it.itemKey)}">⋯</summary><div class="rb-menu" role="menu"><button type="button" role="menuitem" class="ghost" data-rbarch="${rbEsc(it.key)}">Archive…</button></div></details>`;
    if (it.status === 'archived') return `<div class="rb-why is-bad">${rbEsc(it.block)}</div><button type="button" class="sta-btn dim" data-rbrestore="${rbEsc(it.key)}">Restore</button>`;
    if (it.block) return `<div class="rb-why is-bad">${rbEsc(it.block)}</div>`;
    if (it.status === 'claim') return `<div class="rb-acts"><button type="button" class="rb-go" data-rbopen="${rbEsc(it.key)}">${RB_VERB[it.type]}</button>${more}</div>`;
    if (it.status === 'wait') return `<div class="rb-acts"><span class="rb-why">${rbEsc(rbWaitWhy(it))}</span>${more}</div>`;
    return `<div class="rb-acts"><span class="rb-why is-bad">Past the deadline</span>${more}</div>`;
  };
  const body = shown.map(it => {
    const isIn = it.type === 'inbound';
    const sub = isIn ? (it.skus.length === 1 ? `${it.skus[0].asin} · ${it.skus[0].fnsku}` : it.skus.map(x => x.sku).join(', ')) : `${it.asin} · ${it.fnsku}`;
    const title = isIn ? (it.skus.length === 1 ? it.skus[0].title : `${it.skus.length} SKUs · ${it.skus[0].title}…`) : it.title;
    const part = it.partPaid || (it.paid > 0 && it.units > 0) ? '<span class="rb-tag" title="Amazon already paid for some units by itself: they are left out of this claim">part paid</span>' : '';
    return `<tr class="rb-row is-${it.status}">
      <td>${rbTypePill(it.type)}</td>
      <td class="rb-item"><div class="sta-term">${rbEsc(isIn ? it.itemKey : it.sku)}${RBS.brand === 'ALL' ? ` ${staBadge(RB_BRANDS[it.brand], 'brand-' + it.brand)}` : ''}</div>
        <div class="rb-ttl" title="${rbEsc(title)}">${rbEsc(title)}</div><small class="sta-s">${rbEsc(isIn ? sub : (it.type === 'underpaid' ? 'Payout ' : it.type === 'reversal' ? 'Reversal ' : RB.KIND[it.kind].t + ' · ') + it.itemKey + ' · ' + sub)}</small></td>
      <td class="num">${staInt(it.units)}</td>
      <td class="num">${rbValHtml(it.value, it.approx, it.noCostUnits, it.rate)}${part ? '<div class="rb-tags">' + part + '</div>' : ''}</td>
      <td>${rbDaysHtml(it)}</td>
      <td>${rbStatusPill(it.status)}</td>
      <td class="rb-actcell">${action(it)}</td></tr>`;
  }).join('');
  const empty = !rows.length ? `<tr><td colspan="7" class="rb-empty">${RBS.focus || RBS.type || RBS.expired
    ? 'Nothing here with these choices.'
    : '<span class="rb-tick" aria-hidden="true">✓</span><b>No claims right now.</b> Nothing Amazon owes us is waiting for a case.'}</td></tr>` : '';
  $('rbTable').innerHTML = '<thead><tr><th title="What kind of claim">Type</th><th title="The shipment, or the SKU of a payout; the product; its ASIN and FNSKU">Item</th>'
    + '<th class="num" title="Units missing, lost, damaged, underpaid or taken back (still owed)">Units</th><th class="num" title="At our sourcing cost, else ≈ landed, else ≈ Amazon\'s rate (what Amazon last paid per unit); for an underpaid payout the gap, for a reversal the amount taken back">Value</th>'
    + `<th title="Days to the deadline (not confirmed yet: check it in Seller Central). Red 7 or fewer, orange 8–14, yellow 15–30">Days left</th><th title="Claim now, Wait (Amazon still counting), Expired or Archived">Status</th><th>Action</th></tr></thead>`
    + `<tbody>${body}${empty}</tbody>`;
  $('rbFoot').innerHTML = rows.length > RB_SHOWN
    ? `<span>${RBS.all ? `All ${staInt(rows.length)} rows` : `${RB_SHOWN} of ${staInt(rows.length)} rows`}</span><button type="button" class="ghost" data-rball="1">${RBS.all ? 'Show the first ' + RB_SHOWN : `Show all (${staInt(rows.length)})`}</button>`
    : rows.length ? `<span>${staInt(rows.length)} row${rows.length === 1 ? '' : 's'}</span>` : '';
}

/* ---------- the chart: payouts by month ---------- */
// An axis step: "$1.5K", "$250", "$12.5" (a quarter of a small top is not always whole).
const rbK = v => { const a = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'K' : Number.isInteger(a) ? a : a.toFixed(1)); };
function rbNice(v) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
// The parts of the view picked: through our cases vs paid by Amazon itself, or by reason (the type colours).
function rbParts() {
  if (RBS.chart === 'reason') return RB.REASONS.map(([r, t]) => ({ k: r, t: r, c: RB.TYPES[t].c, get: m => m.reason[r] }));
  return [{ k: 'cases', t: 'Through our cases', c: '--accent', get: m => m.cases }, { k: 'auto', t: 'Paid by Amazon itself', c: '--brand', get: m => m.auto }];
}
function rbDrawChart(today) {
  RB_CH = rbChart(RBD, today, RBS.brand, 12);
  const parts = rbParts();
  $('rbChartSeg').querySelectorAll('[data-cm]').forEach(b => { const on = b.dataset.cm === RBS.chart; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const key = (k, t, c) => `<button type="button" class="adx-lg${RBS.off[k] ? ' off' : ''}" data-part="${k}" aria-pressed="${!RBS.off[k]}" title="Show or hide ${rbEsc(t)}"><i class="adx-sq" style="--c:var(${c})"></i>${rbEsc(t)}</button>`;
  $('rbChartLegend').innerHTML = parts.map(p => key(p.k, p.t, p.c)).join('') + (RB_CH.months.some(m => m.rev < 0) ? key('rev', 'Reversals (below zero)', '--bad') : '');
  $('rbChartEmpty').classList.toggle('hide', RB_CH.any);
  $('rbPlot').classList.toggle('hide', !RB_CH.any);
  $('rbChartLegend').classList.toggle('hide', !RB_CH.any);
  if (RB_CH.any) rbChartPlot();
}
// Stacked bars per month on a $ axis, reversals as a thin red bar below zero; hover snaps to a month and names its parts.
function rbChartPlot() {
  const el = $('rbPlot'), C = RB_CH;
  if (!el || !C) return;
  const W = Math.round(el.clientWidth);
  if (!(W >= 160)) return;                      // hidden, or not laid out yet: the ResizeObserver draws it once it has a width
  const parts = rbParts(), on = parts.filter(p => !RBS.off[p.k]), seeRev = !RBS.off.rev;
  const M = C.months, n = M.length;
  const H = W < 520 ? 230 : 270, L = W < 520 ? 48 : 58, R = 12, T = 14, B = 28;
  const tot = M.map(m => on.reduce((t, p) => t + p.get(m), 0));
  const top = rbNice(Math.max(1, ...tot) * 1.08);
  const minRev = seeRev ? Math.min(0, ...M.map(m => m.rev)) : 0;
  // Below zero: room for the reversals, never less than an eighth of the height (so its label stays clear of $0).
  const low = minRev < 0 ? -rbNice(Math.max(-minRev * 1.25, top / 8)) : 0;
  const y = v => T + (top - v) / (top - low) * (H - T - B);
  const slot = (W - L - R) / n, bw = Math.max(6, Math.min(30, slot * 0.56));
  const x = i => L + i * slot + (slot - bw) / 2;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = top * i / 4, yy = y(v);
    g += `<line class="adx-gl" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/><text x="${L - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${rbK(v)}</text>`;
  }
  if (low < 0) g += `<line class="adx-gl" x1="${L}" x2="${W - R}" y1="${y(low).toFixed(1)}" y2="${y(low).toFixed(1)}"/><text x="${L - 8}" y="${(y(low) + 3.5).toFixed(1)}" text-anchor="end">${rbK(low)}</text>`;
  M.forEach((m, i) => {
    let acc = 0;
    on.forEach(p => {
      const v = p.get(m);
      if (!(v > 0)) return;
      g += `<rect class="rb-bar" style="--c:var(${p.c})" x="${x(i).toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y(acc) - y(acc + v)).toFixed(1)}"/>`;
      acc += v;
    });
    if (seeRev && m.rev < 0) g += `<rect class="rb-bar rb-rev" style="--c:var(--bad)" x="${(x(i) + bw * 0.3).toFixed(1)}" y="${y(0).toFixed(1)}" width="${(bw * 0.4).toFixed(1)}" height="${Math.max(1, y(m.rev) - y(0)).toFixed(1)}"/>`;
  });
  g += `<line class="rb-zero" x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  const every = slot >= 44 ? 1 : 2;
  M.forEach((m, i) => { if (!(i % every) || i === n - 1) g += `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle">${rbEsc(m.lab)}</text>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${rbEsc(`Payouts by month, ${M[0].lab} to ${M[n - 1].lab}`)}">`
    + `<rect class="adx-band hide" y="${T}" height="${H - T - B}" width="${slot.toFixed(1)}"/>${g}<rect class="adx-hit" x="${L}" y="0" width="${Math.max(0, W - L - R)}" height="${H}"/></svg><div class="adx-tip hide"></div>`;
  const svg = el.firstChild, tip = el.lastChild, band = svg.querySelector('.adx-band');
  svg.addEventListener('pointermove', ev => {
    const box = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - box.left) * W / box.width - L) / slot)));
    const m = M[i];
    band.setAttribute('x', (L + i * slot).toFixed(1));
    band.classList.remove('hide');
    tip.innerHTML = `<div class="adx-tip-h">${rbEsc(m.lab)}</div>`
      + parts.map(p => `<div><i class="adx-sq" style="--c:var(${p.c})"></i>${rbEsc(p.t)}: <b>${rbM2(p.get(m))}</b></div>`).join('')
      + (m.rev < 0 ? `<div><i class="adx-sq" style="--c:var(--bad)"></i>Reversals: <b>${rbM2(m.rev)}</b></div>` : '')
      + `<div>Units paid for: <b>${staInt(m.units)}</b></div>`;
    tip.classList.remove('hide');
    const at = (x(i) + bw / 2) * box.width / W;
    tip.style.left = Math.round(at > box.width / 2 ? at - tip.offsetWidth - 14 : at + 14) + 'px';
  });
  svg.addEventListener('pointerleave', () => { band.classList.add('hide'); tip.classList.add('hide'); });
}

/* ---------- most-lost products ---------- */
function rbDrawLost(today) {
  const rows = rbMostLost(RBD, today, RBS.brand, 10);
  const pct = r => (r.pct == null ? '<span class="sta-dash">—</span>' : `<span class="rb-pct rb-pct-${rbPctClass(r.pct)}">${Math.round(r.pct)}%</span>`);
  $('rbLost').innerHTML = '<thead><tr><th>Product</th><th class="num" title="Units lost, less the units found again">Units lost</th><th class="num" title="Units damaged or destroyed">Units damaged</th>'
    + '<th class="num" title="Lost and damaged units at our sourcing cost (≈ landed when only that is known)">Value</th><th class="num" title="Lost and damaged payouts for this product in the same 12 months">Paid back</th>'
    + '<th class="num" title="Paid back ÷ value: green 90%+, yellow 50–89%, red under 50%">% paid back</th></tr></thead><tbody>'
    + (rows.map(r => `<tr><td class="rb-item"><div class="rb-ttl"><b>${rbEsc(r.title)}</b>${RBS.brand === 'ALL' ? ' ' + staBadge(RB_BRANDS[r.brand], 'brand-' + r.brand) : ''}</div><small class="sta-s">${rbEsc(r.sku)} · ${rbEsc(r.asin)}</small></td>`
      + `<td class="num">${staInt(r.lostNet)}</td><td class="num">${staInt(r.damaged)}</td><td class="num">${rbValHtml(r.value, r.approx, r.noCost ? r.units : 0, r.rate)}</td>`
      + `<td class="num">${rbM2(r.paid)}</td><td class="num">${pct(r)}</td></tr>`).join('')
      || (RBD.have && !RBD.have.ledger
        ? '<tr><td colspan="6" class="rb-empty"><b>Needs the Inventory Ledger.</b> Upload it with "Upload Amazon reports" (Detailed view, CSV).</td></tr>'
        : '<tr><td colspan="6" class="rb-empty"><span class="rb-tick" aria-hidden="true">✓</span>Nothing lost or damaged in the last 12 months.</td></tr>'))
    + '</tbody>';
  $('rbLostSub').textContent = 'The last 12 months, from the inventory ledger and the payouts · the top 10 by value'
    + (RBD.costNote ? ` · ${RBD.costNote}: units only` : RBD.sample ? '' : ' · values at Profit & Margin\'s landed cost (≈)');
}

/* ---------- "Connect Amazon's data": nothing read yet ---------- */
function rbDrawConnect() {
  const row = (n, t, where, unlocks, state) => `<li><span class="rb-cn">${n}</span><div><b>${t}</b><small>${rbEsc(where)}</small><small>Unlocks: ${rbEsc(unlocks)}</small></div>${state}</li>`;
  const P = RB.REPORTS.payouts, L = RB.REPORTS.ledger;
  $('rbConnect').innerHTML = '<div class="adx-ch-head"><div class="adx-ch-tt"><h3 class="ui-card-title">Connect Amazon\'s data</h3>'
    + '<div class="ui-note">Sellora shows no made-up numbers. Upload two of Amazon\'s reports (a few minutes in Seller Central), or wait for the backend to read them every night.</div></div>'
    + '<button type="button" data-rbup="1">Upload Amazon reports</button></div>'
    + '<ol class="rb-conn">'
    + row(1, rbEsc(P.t), P.where, P.unlocks, '<span class="rb-st rb-st-wait">Not uploaded</span>')
    + row(2, rbEsc(L.t), L.where, L.unlocks, '<span class="rb-st rb-st-wait">Not uploaded</span>')
    + row(3, 'Inbound shipments', 'From the backend: no report you can download holds the units shipped per shipment', 'Inbound shortages', '<span class="rb-st rb-st-archived">Needs the backend</span>')
    + '</ol>'
    + `<p class="rb-muted">${RBD.costNote ? rbEsc(RBD.costNote) + ': the values will show as units only. ' : ''}Want to see the page first? <a href="?sample=1#reimb">Open it with sample data</a>.</p>`;
}

/* ---------- Upload Amazon reports ---------- */
// The dialog: the brand first, then each report — read in this browser, checked, summed up, and saved only on "Save".
const RB_UP = { brand: '', res: {} };
// brand: the brand of the page it was opened from ('ALL' leaves the choice to the person).
function rbUpOpen(brand) {
  const b = typeof brand === 'string' ? brand : RBS.brand;
  if (!RB_UP.brand && b !== 'ALL') RB_UP.brand = b;
  RB_UP.res = {};
  rbUpDraw();
  $('rbUpDlg').classList.remove('hide');
}
function rbUpDraw() {
  $('rbUpBrand').querySelectorAll('[data-b]').forEach(b => { const on = b.dataset.b === RB_UP.brand; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const b = RB_UP.brand;
  $('rbUpBody').innerHTML = ['payouts', 'ledger'].map((k, i) => {
    const R = RB.REPORTS[k], up = b && RBX.uploads[b + '_' + k], r = RB_UP.res[k];
    const last = up ? `Kept now: ${staInt((up.rows || []).length)} rows${up.meta && up.meta.from ? `, ${rbDate(rbDay(up.meta.from))} – ${rbDate(rbDay(up.meta.to))}` : ''}`
      + `, uploaded ${RB_ASOF.format(up.uploadedAt)}${(up.trail || []).length ? ' by ' + rbEsc(up.trail[up.trail.length - 1].person || up.trail[up.trail.length - 1].email || '') : ''}.` : 'Nothing uploaded yet for this brand.';
    let res = '';
    if (r && r.err) res = `<div class="rb-note is-bad">${rbEsc(r.err)}</div>`;
    else if (r && r.saved) res = `<div class="rb-note is-ok">Saved ✓ ${rbEsc(r.saved)}</div>`;
    else if (r && r.ok) {
      const warn = [];
      if (r.otherBrand) warn.push(`<b>Most of its SKUs belong to ${rbEsc(RB_BRANDS[r.otherBrand.brand])}</b> (${staInt(r.otherBrand.n)} of the ${staInt(r.otherBrand.of)} Sellora knows). Check the brand above before saving.`);
      if (r.other) warn.push(`${staInt(r.other)} row${r.other === 1 ? '' : 's'} with other reason codes (${rbEsc(Object.keys(r.otherCodes).join(', '))}): kept as "other", not counted as lost, found or damaged.`);
      if (r.notUsd) warn.push(`${staInt(r.notUsd)} row${r.notUsd === 1 ? ' is' : 's are'} not in US dollars: shown as they are.`);
      if (r.badDate) warn.push(`${staInt(r.badDate)} row${r.badDate === 1 ? '' : 's'} without a readable date left out.`);
      const m = rbMerge(k, up ? up.rows : [], r.rows);
      res = `<div class="rb-note">Read <b>${staInt(r.kept)} rows</b>, ${rbDate(rbDay(r.from))} – ${rbDate(rbDay(r.to))}, for <b>${rbEsc(RB_BRANDS[b])}</b>`
        + (k === 'ledger' && r.skipped ? ` · ${staInt(r.skipped)} row${r.skipped === 1 ? '' : 's'} of other event types left out (only Adjustments and Receipts are used)` : '')
        + (r.dupes > 0 ? ` · ${staInt(r.dupes)} repeated in the file, kept once` : '')
        + `. Saving ${up ? `replaces ${staInt(m.replaced)} and adds ${staInt(m.added)}` : `adds ${staInt(m.added)}`}.</div>`
        + warn.map(w => `<div class="rb-note is-act">${w}</div>`).join('')
        + `<div class="rb-row2"><button type="button" data-upsave="${k}">Save ${rbEsc(R.t)}</button></div>`;
    }
    return `<section class="rb-upsec"><h4 class="rb-h4">${i + 1}. ${rbEsc(R.t)}</h4><p class="rb-muted">${rbEsc(R.where)}.<br>Unlocks: ${rbEsc(R.unlocks)}.</p>`
      + `<p class="rb-muted">${last}</p>`
      + `<label class="sta-btn dim rb-file${b ? '' : ' is-off'}"><input type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" data-upk="${k}"${b ? '' : ' disabled'}> Choose the file…</label>${res}</section>`;
  }).join('') + '<p class="rb-muted">Inbound shortages need the units shipped per shipment, which no report holds: they come from the backend.</p>';
  $('rbUpNote').innerHTML = !b ? '<b>Pick the brand first.</b>' : RBX.where === 'fs' ? 'Saved to the shared copy, with who and when.' : 'Kept in this browser only until the shared copy is switched on (reimbData in firestore.rules).';
}
async function rbUpFile(k, file) {
  if (!file || !RB_UP.brand) return;
  let text = '';
  try { text = await file.text(); } catch (e) { RB_UP.res[k] = { err: 'This browser could not read the file.' }; rbUpDraw(); return; }
  const r = rbParseReport(k, text, RB_UP.brand, rbKnownBrands());
  r.file = file.name;
  RB_UP.res[k] = r;
  rbUpDraw();
}
async function rbUpSave(k) {
  const r = RB_UP.res[k], b = RB_UP.brand;
  if (!r || !r.ok || !b) return;
  const up = RBX.uploads[b + '_' + k], m = rbMerge(k, up ? up.rows : [], r.rows);
  const dates = m.rows.map(x => x.date).sort();
  try { await rbUploadSave(b, k, m.rows, { from: dates[0] || '', to: dates[dates.length - 1] || '', file: r.file || '', kept: r.kept }); }
  catch (e) { RB_UP.res[k] = { err: 'Not saved: ' + (e.message || e) }; rbUpDraw(); return; }
  RB_UP.res[k] = { saved: `${staInt(m.rows.length)} rows kept for ${RB_BRANDS[b]} (${staInt(m.replaced)} replaced, ${staInt(m.added)} added).` };
  RBD = null;
  try { await rbLoadAll(); } catch (e) { RB_ERR = String((e && e.message) || e); }
  rbUpDraw();
  rbRedrawAll();
}

/* ---------- the case dialog: Make case / Re-check / Dispute ---------- */
// One item, or a case of several lost (or damaged) items of one brand (rbBatchCheck says when they may go together).
const rbItemNow = key => rbItems(RBD, RBC.recs, rbToday()).find(i => i.key === key) || null;
const rbDlgItems = () => {
  if (!RB_DLG) return [];
  const all = new Map(rbItems(RBD, RBC.recs, rbToday()).map(i => [i.key, i]));
  return RB_DLG.keys.map(k => all.get(k)).filter(Boolean);
};
// keys: one item's key, or a list of them. A list that may not be one case is refused, saying why (the page's own note).
function rbOpen(keys) {
  const all = new Map(rbItems(RBD, RBC.recs, rbToday()).map(i => [i.key, i]));
  const list = [].concat(keys).map(k => all.get(k)).filter(Boolean);
  if (!list.length) return '';
  const why = list.length > 1 ? rbBatchCheck(list) : '';
  if (why) return why;
  const it = list[0], many = list.length > 1;
  RB_DLG = { key: it.key, keys: list.map(i => i.key), copied: false };
  const rec = rbRecOf(it);
  const first = list.reduce((a, i) => (i.deadline < a.deadline ? i : a), it);
  $('rbDlgTitle').textContent = `${RB_VERB[it.type]} · ${many ? `${list.length} ${RB.TYPES[it.type].short.toLowerCase()} items` : it.type === 'inbound' ? it.itemKey : it.sku}`;
  const dl = rbDeadlineOf(it.type);
  const when = it.type === 'inbound' ? ({ delivered: 'delivered', closed: 'closed', checkin: 'first checked in' }[it.startFrom] || 'delivered') : it.type === 'lost' || it.type === 'damaged' ? 'event' : 'dated';
  $('rbDlgSub').innerHTML = `${rbEsc(RB_BRANDS[it.brand])} · ${rbEsc(RB.TYPES[it.type].t)} · ${many ? 'the earliest' : when} ${rbDate(first.event)}`
    + ` · deadline <b>${rbDate(first.deadline)}</b> (${first.daysLeft === 0 ? 'the last day' : staInt(first.daysLeft) + ' days left'})`;
  $('rbDlgBody').innerHTML = rbDlgHtml(list, rec, dl);
  $('rbDlgNote').innerHTML = RBC.where === 'fs' ? 'Saved to the shared case list, with who and when.' : RBC.where === 'sample' ? 'Sample data: kept in this browser only.' : 'Kept in this browser only until the shared case list is switched on.';
  $('rbDlg').classList.remove('hide');
  setTimeout(() => { try { $('rbCaseId').focus(); } catch (e) { /* not on screen */ } }, 0);
  return '';
}
// The proof section of an inbound case: the fields saved on its record (rbProofOf prefills the carrier, the tracking and the
// delivery day from the shipment), and what is still missing.
function rbProofHtml(it, rec) {
  const p = rbProofOf(it, rec), miss = rbProofMissing(it, rec);
  return `<section class="rb-proof"><h4 class="rb-h4">Proof <small>saved on the case record, with who and when</small></h4>`
    + (miss.length ? `<div class="rb-note is-act"><b>Needs proof:</b> ${rbEsc(miss.join(' and '))}.</div>` : '<div class="rb-note is-ok"><b>Proof complete:</b> the invoice, and the tracking or proof of delivery.</div>')
    + '<div class="rb-pfgrid">'
    + `<label class="sta-f rb-pf" for="rbPfInv"><span class="rb-lab">Invoice number</span><input id="rbPfInv" maxlength="60" autocomplete="off" value="${rbEsc(p.invoiceNo)}"></label>`
    + `<label class="sta-f rb-pf" for="rbPfSup"><span class="rb-lab">Supplier</span><input id="rbPfSup" maxlength="80" autocomplete="off" value="${rbEsc(p.supplier)}"></label>`
    + `<label class="sta-f rb-pf rb-pf-wide" for="rbPfLink"><span class="rb-lab">Invoice link <small>http:// or https:// only</small></span><span class="rb-pfrow"><input id="rbPfLink" maxlength="500" autocomplete="off" inputmode="url" placeholder="https://…" value="${rbEsc(p.invoiceLink)}">`
      + (p.invoiceLink ? `<a class="sta-btn dim rb-link" id="rbPfOpen" href="${rbEsc(p.invoiceLink)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '') + '</span></label>'
    + `<label class="sta-f rb-pf" for="rbPfCar"><span class="rb-lab">Carrier</span><input id="rbPfCar" maxlength="40" autocomplete="off" value="${rbEsc(p.carrier)}"></label>`
    + `<label class="sta-f rb-pf" for="rbPfTrk"><span class="rb-lab">Tracking <small>${p.fromShipment ? 'from the shipment' : 'commas between them'}</small></span><input id="rbPfTrk" maxlength="600" autocomplete="off" value="${rbEsc(p.tracking.join(', '))}"></label>`
    + `<label class="sta-f rb-pf" for="rbPfDel"><span class="rb-lab">Delivered on</span><input id="rbPfDel" type="date" value="${rbEsc(p.deliveredOn)}"></label>`
    + `<label class="rb-check rb-pfpod"><input type="checkbox" class="sta-cb" id="rbPfPod"${p.podAttached ? ' checked' : ''}> <span>Proof of delivery / bill of lading (POD, BOL) attached</span></label>`
    + '</div>'
    + `<div class="rb-row2"><button type="button" class="sta-btn" id="rbPfSave" data-rbproof="1">Save the proof</button><small id="rbPfMsg" class="rb-pfmsg"></small></div></section>`;
}
function rbDlgHtml(list, rec, dl) {
  list = [].concat(list);
  const it = list[0];
  const fig = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
  const open = RBC.recs.size ? [...RBC.recs.values()].filter(r => r.status === 'in_case').length : 0;
  const warn = [];
  const where = it.type === 'inbound' ? 'shipment' : it.type === 'lost' || it.type === 'damaged' ? 'claim form' : 'reimbursement';
  if (!dl.confirmed) warn.push(`<div class="rb-note">Deadline: ${rbEsc(dl.t)}. <b>Not confirmed yet</b> — check the deadline on the ${where} in Seller Central.</div>`);
  if (open >= RB.MAX_OPEN) warn.push(`<div class="rb-note is-act">You have ${staInt(open)} open cases; Amazon advises under ${RB.MAX_OPEN} at a time. You can still go on.</div>`);
  const sumL = f => list.reduce((t, i) => t + f(i), 0);
  const valOf = sumL(i => i.value || 0);
  let figs = '', table = '', proof = '', listBtn = '';
  if (it.type === 'inbound') {
    const skus = it.allSkus || it.skus, open2 = it.skus.filter(x => x.missing > 0);
    if (open2.length > RB.MAX_ITEMS) warn.push(`<div class="rb-note is-act">${staInt(open2.length)} SKUs: Amazon takes at most ${RB.MAX_ITEMS} items in one case — split them over two cases.</div>`);
    figs = fig('Shipment', rbEsc(it.itemKey)) + fig('Shipped', staInt(it.shipped)) + fig('Received', staInt(it.received))
      + (it.paidUnits ? fig('Paid by Amazon', staInt(it.paidUnits)) : '')
      + fig('Missing', staInt(it.units)) + fig('Value', it.value == null ? '—' : (it.approx || it.rate ? '≈ ' : '') + rbM2(it.value)) + fig('Days left', staInt(it.daysLeft));
    table = '<table class="xl"><thead><tr><th>SKU</th><th>FNSKU · ASIN</th><th class="num">Shipped</th><th class="num">Received</th><th class="num">Paid by Amazon</th><th class="num">Missing</th><th class="num">Value</th></tr></thead><tbody>'
      + skus.map(x => `<tr${!(x.missing > 0) ? ' class="is-off"' : ''}><td><div class="sta-dcn">${rbEsc(x.sku)}</div><small>${rbEsc(x.title)}</small></td><td>${rbEsc(x.fnsku)}<small>${rbEsc(x.asin)}</small></td>`
        + `<td class="num">${staInt(x.shipped)}</td><td class="num" title="${rbEsc(rbRecvTip(x))}">${x.received == null ? '<span class="sta-dash">not known</span>' : staInt(x.received)}</td>`
        + `<td class="num">${x.paid ? staInt(x.paid) : '<span class="sta-dash">—</span>'}</td><td class="num"><b>${staInt(x.missing || 0)}</b></td>`
        + `<td class="num">${x.missing > 0 ? rbValHtml(x.val.v, x.val.approx, x.val.noCost ? x.missing : 0, x.val.basis === 'amazon') : x.paid ? '<small>paid by Amazon</small>' : '<span class="sta-dash">—</span>'}</td></tr>`).join('')
      + '</tbody></table>';
    proof = rbProofHtml(it, rec);
  } else if (it.type === 'lost' || it.type === 'damaged') {
    const lost = it.type === 'lost';
    figs = fig('Items', staInt(list.length)) + fig(lost ? 'Units lost' : 'Units damaged', staInt(sumL(i => i.eventUnits)))
      + fig(lost ? 'Found / paid' : 'Paid', staInt(sumL(i => i.found + i.paid))) + fig('Still owed', staInt(sumL(i => i.units)))
      + fig('Value', list.some(i => i.value != null) ? (list.some(i => i.approx || i.rate) ? '≈ ' : '') + rbM2(valOf) : '—') + fig('Days left', staInt(Math.min(...list.map(i => i.daysLeft))));
    // The list Amazon's form takes: FNSKU | units | date (lost), transaction ID | FNSKU | units | date (damaged).
    table = `<table class="xl"><thead><tr>${lost ? '' : '<th>Transaction ID</th>'}<th>FNSKU</th><th class="num">Units</th><th>Date</th><th>Product</th>${lost ? '<th>Transaction ID</th>' : '<th>Event</th>'}</tr></thead><tbody>`
      + list.map(i => `<tr>${lost ? '' : `<td><div class="sta-dcn">${rbEsc(i.txnId || '—')}</div></td>`}<td><div class="sta-dcn">${rbEsc(i.fnsku)}</div></td><td class="num"><b>${staInt(i.units)}</b></td>`
        + `<td>${rbDate(i.event)}</td><td><small>${rbEsc(i.sku)} · ${rbEsc(i.title)}</small></td><td>${lost ? `<small>${rbEsc(i.txnId || '—')}</small>` : rbKindTag(i.kind)}</td></tr>`).join('')
      + '</tbody></table>';
    listBtn = `<button type="button" class="sta-btn dim" data-rbcopylist="1" title="${lost ? 'FNSKU, units and date' : 'Transaction ID, FNSKU, units and date'}, one row each, tab-separated">Copy the list</button>`;
    if (list.some(i => i.unrec != null)) warn.push('<div class="rb-note">Units marked by Amazon as still unreconciled (its own "Unreconciled Quantity" in the ledger) are counted as Amazon says.</div>');
  } else if (it.type === 'underpaid') {
    const p = it.payout;
    figs = fig('Units', staInt(it.units)) + fig('Paid per unit', rbM2(it.per)) + fig('Our sourcing cost', rbM2(it.cost)) + fig('Gap', rbM2(it.value)) + fig('Paid', rbM2(Number(p.amount))) + fig('Days left', staInt(it.daysLeft));
    table = '<table class="xl"><thead><tr><th>Reimbursement ID</th><th>Date</th><th>Reason</th><th class="num">Units</th><th class="num">Paid / unit</th><th class="num">Our cost</th><th class="num">Gap</th></tr></thead><tbody>'
      + `<tr><td><div class="sta-dcn">${rbEsc(p.reimbId)}</div><small>${rbEsc(p.sku)} · ${rbEsc(p.fnsku)}</small></td><td>${rbDate(rbDay(p.date))}</td><td>${rbEsc(p.reason)}</td>`
      + `<td class="num">${staInt(it.units)}</td><td class="num">${rbM2(it.per)}</td><td class="num">${rbM2(it.cost)}</td><td class="num"><b>${rbM2(it.value)}</b></td></tr></tbody></table>`
      + '<div class="rb-note">Our sourcing cost only (never the landed cost, never Amazon\'s own rate): it excludes shipping, handling and duties.</div>';
  } else {
    const p = it.payout, o = it.original;
    figs = fig('Units', staInt(it.units)) + fig('Taken back', rbM2(Number(p.amount))) + fig('Original payout', o ? rbM2(Number(o.amount)) : '—') + fig('Days left', staInt(it.daysLeft));
    const tr = (x, what) => `<tr><td><div class="sta-dcn">${rbEsc(x.reimbId)}</div><small>${what}</small></td><td>${rbDate(rbDay(x.date))}</td><td>${rbEsc(x.reason)}</td><td class="num">${staInt(rbUnits(x))}</td><td class="num"><b>${rbM2(Number(x.amount))}</b></td></tr>`;
    table = '<table class="xl"><thead><tr><th>Reimbursement ID</th><th>Date</th><th>Reason</th><th class="num">Units</th><th class="num">Amount</th></tr></thead><tbody>'
      + tr(p, 'the reversal') + (o ? tr(o, 'the original payout') : '') + '</tbody></table>'
      + `<div class="sta-checks"><div class="ck-ok"><i>✓</i><span>The ledger check: no unit of ${rbEsc(p.fnsku)} found between ${rbDate(it.checkFrom)} and ${rbDate(it.checkTo)} (${RB.FOUND_DAYS} days either side).</span></div></div>`;
  }
  const steps = '<ol class="rb-steps">' + RB.STEPS[it.type].map(s => `<li>${rbEsc(s)}</li>`).join('') + '</ol>';
  const ticks = (RB.PROOF[it.type] || []).map(([k, t]) => `<label class="rb-check"><input type="checkbox" class="sta-cb" data-rbcheck="${k}"${rec.checks && rec.checks[k] ? ' checked' : ''}> <span>${rbEsc(t)}</span></label>`).join('');
  const link = it.type === 'inbound' ? RB_LINKS.shipments : RB_LINKS.support;
  const text = it.type === 'lost' || it.type === 'damaged' ? rbCaseText(list) : rbCaseText(it, it.type === 'inbound' ? rbProofOf(it, rec) : null);
  return warn.join('') + `<div class="sta-figs rb-figs">${figs}</div>`
    + `<div class="sta-dcp rb-dtable">${table}</div>`
    + (listBtn ? `<div class="rb-row2">${listBtn}</div>` : '')
    + `<div class="rb-cols${ticks ? '' : ' rb-cols-1'}"><section><h4 class="rb-h4">In Seller Central</h4>${steps}</section>`
    + (ticks ? `<section><h4 class="rb-h4">Proof to attach <small>ticks are saved</small></h4><div class="rb-checks">${ticks}</div></section>` : '') + '</div>'
    + proof
    + `<h4 class="rb-h4">The case text <small>edit it if you like, then copy</small></h4>`
    + `<textarea id="rbText" class="rb-text" rows="11" spellcheck="true" aria-label="The case text">${rbEsc(text)}</textarea>`
    + `<div class="rb-row2"><button type="button" class="sta-btn" data-rbcopy="1">Copy the text</button><a class="sta-btn dim rb-link" href="${rbEsc(link)}" target="_blank" rel="noopener">Open Seller Central ↗</a></div>`
    + `<div class="rb-caseid"><label class="sta-f" for="rbCaseId"><span class="rb-lab">Case ID</span><input id="rbCaseId" maxlength="40" autocomplete="off" placeholder="The case ID Amazon gave" value="${rbEsc(rec.caseId || '')}"></label>`
    + `<button type="button" data-rbdone="1">I've created the case${list.length > 1 ? ` (${list.length} items)` : ''}</button></div>`;
}
// Where an inbound SKU's received count came from (the row's tooltip).
const rbRecvTip = x => (x.recvFrom === 'ledger' ? 'Received: from the Inventory Ledger\'s Receipts for this shipment (the shipment data has no received count)'
  : x.recvFrom === 'amazon' ? 'Received: from Amazon\'s shipment data' : 'Received: not in the shipment data, and no ledger Receipts for it — this SKU is not judged');
// The event tag of a lost / damaged item: Lost / Damaged / Destroyed with its dot.
const rbKindTag = k => `<span class="rb-type" style="--d:var(${RB.KIND[k].c})">${rbEsc(RB.KIND[k].t)}</span>`;
// The list for Amazon's form, tab-separated (what "Copy the list" copies).
function rbFormList(list) {
  const lost = list[0].type === 'lost';
  return [lost ? 'FNSKU\tUnits\tDate' : 'Transaction ID\tFNSKU\tUnits\tDate'].concat(list.map(i => (lost ? [i.fnsku, i.units, rbIso(i.event)] : [i.txnId, i.fnsku, i.units, rbIso(i.event)]).join('\t'))).join('\n');
}
// Closing the dialog: after Copy and with no case ID, ask whether the case was made.
function rbDlgTryClose() {
  if (!RB_DLG) { $('rbDlg').classList.add('hide'); return; }
  if (RB_DLG.copied && !String($('rbCaseId').value || '').trim()) { $('rbAsk').classList.remove('hide'); setTimeout(() => { try { $('rbAskYes').focus(); } catch (e) { /* */ } }, 0); return; }
  rbDlgClose();
}
function rbDlgClose() {
  RB_DLG = null;
  $('rbAsk').classList.add('hide');
  $('rbDlg').classList.add('hide');
}
// "I've created the case": every item of the dialog goes in that case (one record each, the same case ID; a batch names
// all its items), so none of them is ever suggested again.
async function rbCaseDone() {
  const list = rbDlgItems();
  const id = String($('rbCaseId').value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!list.length) return;
  if (!id) { $('rbDlgNote').innerHTML = '<span class="sta-bad">Put the case ID Amazon gave, so Sellora never suggests a second claim for it.</span>'; $('rbCaseId').focus(); return; }
  const batch = list.length > 1 ? list.map(i => i.key) : null;
  try {
    for (const it of list) {
      await rbCaseSave(rbRecOf(it), Object.assign({ status: 'in_case', caseId: id, estimate: Math.round((it.value || 0) * 100) / 100 }, batch ? { batch } : {}),
        'case-created', Object.assign({ caseId: id }, batch ? { items: batch.length } : {}));
    }
  } catch (e) { $('rbDlgNote').innerHTML = `<span class="sta-bad">Not saved: ${rbEsc(e.message || e)}</span>`; return; }
  rbDlgClose();
  RB_NOTE = list.length > 1 ? `Saved: ${list.length} items are in case ${rbEsc(id)}.` : `Saved: ${rbEsc(list[0].itemKey)} is in case ${rbEsc(id)}.`;
  if (typeof rbqCaseMade === 'function') rbqCaseMade(list.map(i => i.key));
  rbRedrawAll();
}
async function rbCheck(k, on) {
  const list = rbDlgItems();
  if (!list.length) return;
  try { for (const it of list) await rbCaseSave(rbRecOf(it), { checks: { [k]: on } }, on ? 'proof-ticked' : 'proof-unticked', { check: k }); }
  catch (e) { $('rbDlgNote').innerHTML = `<span class="sta-bad">The tick was not saved: ${rbEsc(e.message || e)}</span>`; }
}
// Save the inbound proof (the fields of rbProofHtml) on the item's record, with one trail step; the case text follows it.
async function rbProofSave() {
  const it = rbDlgItems()[0];
  if (!it || it.type !== 'inbound') return;
  const v = id => String($(id).value || '').trim();
  const link = rbLinkOk(v('rbPfLink'));
  if (!link.ok) { $('rbPfMsg').innerHTML = `<span class="sta-bad">Not saved: ${rbEsc(link.err)}.</span>`; $('rbPfLink').focus(); return; }
  const proof = { invoiceNo: v('rbPfInv').slice(0, 60), supplier: v('rbPfSup').slice(0, 80), invoiceLink: link.url, carrier: v('rbPfCar').slice(0, 40),
    tracking: rbTrackList(v('rbPfTrk')), deliveredOn: /^\d{4}-\d{2}-\d{2}$/.test(v('rbPfDel')) ? v('rbPfDel') : '', podAttached: !!$('rbPfPod').checked };
  try { await rbCaseSave(rbRecOf(it), { proof }, 'proof-saved', { fields: Object.keys(proof).filter(k => (Array.isArray(proof[k]) ? proof[k].length : proof[k])) }); }
  catch (e) { $('rbPfMsg').innerHTML = `<span class="sta-bad">Not saved: ${rbEsc(e.message || e)}</span>`; return; }
  // Redraw the dialog with the saved proof (the case text names it), keeping the case ID typed so far.
  const typed = $('rbCaseId').value, copied = RB_DLG.copied;
  rbOpen(it.key);
  RB_DLG.copied = copied;
  $('rbCaseId').value = typed;
  $('rbPfMsg').innerHTML = '<span class="rb-saved">Saved ✓</span>';
  rbRedrawAll();
}

/* ---------- Archive, Restore ---------- */
let RB_ARCH = null;
function rbArchOpen(key) {
  const it = rbItemNow(key);
  if (!it) return;
  RB_ARCH = key;
  $('rbArchSub').textContent = `${RB.TYPES[it.type].short} · ${it.type === 'inbound' ? it.itemKey : it.sku + ' · ' + it.itemKey}. It leaves the list and never gets a case; Restore brings it back.`;
  $('rbArchBody').innerHTML = RB.ARCHIVE.map((r, i) => `<label class="rb-check"><input type="radio" name="rbArchWhy" value="${rbEsc(r)}"${i ? '' : ' checked'}> <span>${rbEsc(r)}</span></label>`).join('')
    + '<label class="sta-f rb-archnote" for="rbArchNote"><span class="rb-lab">Note <small>(needed with Other)</small></span><input id="rbArchNote" maxlength="200" autocomplete="off"></label>';
  $('rbArchMsg').textContent = '';
  $('rbArchDlg').classList.remove('hide');
}
async function rbArchDo() {
  const it = RB_ARCH && rbItemNow(RB_ARCH);
  if (!it) return;
  const why = (document.querySelector('input[name="rbArchWhy"]:checked') || {}).value || RB.ARCHIVE[0];
  const note = String($('rbArchNote').value || '').trim().slice(0, 200);
  if (why === 'Other' && !note) { $('rbArchMsg').innerHTML = '<span class="sta-bad">Say why in the note.</span>'; $('rbArchNote').focus(); return; }
  try { await rbCaseSave(rbRecOf(it), { status: 'archived', reason: why, note }, 'archived', { reason: why, note }); }
  catch (e) { $('rbArchMsg').innerHTML = `<span class="sta-bad">Not saved: ${rbEsc(e.message || e)}</span>`; return; }
  $('rbArchDlg').classList.add('hide');
  RB_ARCH = null;
  RB_NOTE = `Archived: ${rbEsc(it.itemKey)} (${rbEsc(why)}). "Show archived" lists it, with Restore.`;
  rbRedrawAll();
}
async function rbRestore(key) {
  const it = rbItemNow(key);
  if (!it) return;
  try { await rbCaseSave(rbRecOf(it), { status: 'draft', reason: '', note: '' }, 'restored'); }
  catch (e) { RB_NOTE = `<span class="sta-bad">Not restored: ${rbEsc(e.message || e)}</span>`; rbRedrawAll(); return; }
  RB_NOTE = `Restored: ${rbEsc(it.itemKey)} is back on the list.`;
  rbRedrawAll();
}

/* ---------- the small dialogs: open cases, how to fix, how Sellora counts ---------- */
function rbCasesOpen() {
  const items = new Map(rbItems(RBD, RBC.recs, rbToday()).map(i => [i.key, i]));
  const recs = [...RBC.recs.values()].filter(r => r.status === 'in_case' && (RBS.brand === 'ALL' || r.brand === RBS.brand))
    .sort((a, z) => ((z.trail || [])[0] || {}).t - ((a.trail || [])[0] || {}).t);
  const first = r => (r.trail || []).find(e => e.act === 'case-created') || (r.trail || [])[0] || {};
  $('rbCasesSub').textContent = `${staInt(recs.length)} open · ≈ ${rbM0(recs.reduce((t, r) => t + (Number(r.estimate) || 0), 0))} estimated` + (recs.length >= RB.MAX_OPEN ? ` · Amazon advises under ${RB.MAX_OPEN} open` : '');
  $('rbCasesBody').innerHTML = recs.length ? '<div class="sta-dcp"><table class="xl"><thead><tr><th>Type</th><th>Item</th><th>Case ID</th><th>Opened</th><th>By</th><th class="num">Estimate</th></tr></thead><tbody>'
    + recs.map(r => { const it = items.get(r.id), e = first(r);
      return `<tr><td>${rbTypePill(r.type)}</td><td><div class="sta-dcn">${rbEsc(r.itemKey)}</div><small>${rbEsc(it ? it.title : '')}</small></td><td><b>${rbEsc(r.caseId)}</b></td>`
        + `<td>${e.t ? rbDate(rbDay(e.t)) : '—'}</td><td>${rbEsc(e.person || e.email || '—')}<small>${rbEsc(e.dev ? e.dev.name || e.dev.label || '' : '')}</small></td><td class="num">${rbM2(Number(r.estimate) || 0)}</td></tr>`; }).join('')
    + '</tbody></table></div>' : '<p class="rb-empty"><span class="rb-tick" aria-hidden="true">✓</span>No open cases.</p>';
  $('rbCasesDlg').classList.remove('hide');
}
function rbFixOpen() {
  const u = rbItems(RBD, RBC.recs, rbToday()).filter(i => i.type === 'underpaid' && i.status === 'claim' && (RBS.brand === 'ALL' || i.brand === RBS.brand));
  const seen = new Map();
  u.forEach(i => { if (!seen.has(i.brand + '|' + i.asin)) seen.set(i.brand + '|' + i.asin, i); });
  $('rbFixBody').innerHTML = '<ol class="rb-steps rb-steps-big">' + RB.FIX_STEPS.map(s => `<li>${rbEsc(s)}</li>`).join('') + '</ol>'
    + '<div class="rb-note">Our sourcing cost is what we paid the supplier for one unit. It excludes shipping, handling and duties.</div>'
    + '<h4 class="rb-h4">The costs to enter</h4><div class="sta-dcp"><table class="xl"><thead><tr><th>SKU</th><th>ASIN</th><th class="num">Seller Cost - New</th><th class="num">Amazon paid per unit</th></tr></thead><tbody>'
    + [...seen.values()].map(i => `<tr><td><div class="sta-dcn">${rbEsc(i.sku)}</div><small>${rbEsc(i.title)}</small></td><td>${rbEsc(i.asin)}</td><td class="num"><b>${rbM2(i.cost)}</b></td><td class="num">${rbM2(i.per)}</td></tr>`).join('')
    + '</tbody></table></div>'
    + `<div class="rb-row2"><a class="sta-btn dim rb-link" href="${rbEsc(RB_LINKS.sourcing)}" target="_blank" rel="noopener">Open Seller Central ↗</a></div>`
    + '<p class="rb-muted">Sellora will fill this file for you when the Paid page is built.</p>';
  $('rbFixDlg').classList.remove('hide');
}
function rbLegendHtml() {
  const dl = k => `${RB.DEADLINE[k].t} <span class="rb-tag">not confirmed yet — check in Seller Central</span>`;
  return '<h4>What is counted</h4><ul>'
    + `<li><b>Inbound shortage</b> (shipped comes only from Amazon's shipment data, read by the backend: <i>reimbInbound</i>). Per SKU, missing = shipped − received − the units Amazon already paid for it by itself (Inbound payouts of that FNSKU dated on or after the start, given to its shipments oldest first). Received: Amazon's shipment data; without it, the Inventory Ledger's Receipts for that shipment (the row's tooltip says which); without either, the SKU is not judged. The start: the delivery date, else the close date, else the first check-in in the ledger. One shipment is one case. <b>Wait</b> while the shipment is not closed and until ${RB.WAIT.inbound} days after the start (Amazon may still be counting); then <b>Claim now</b>. Deadline: ${dl('inbound')}.</li>`
    + `<li><b>Lost in the warehouse</b>: one item per ledger event (its transaction ID), units = |quantity|. Still owed per FNSKU = lost − found again − units Amazon paid as lost in the warehouse, those covering the oldest event first (each only an event on or before its own date). When the ledger row has Amazon's own <b>Unreconciled Quantity</b>, that is what is still owed. <b>Wait</b> ${RB.WAIT.warehouse} days after the event (Amazon usually pays these itself), then <b>Claim now</b>. Deadline: ${dl('warehouse')}.</li>`
    + `<li><b>Damaged / destroyed in the warehouse</b>: the same, covered by Amazon's damaged (or destroyed) payouts of that FNSKU, with the same wait and deadline.</li>`
    + `<li><b>Underpaid</b>: a payout below our <b>sourcing</b> cost per unit (never the landed cost, never Amazon's own rate). Gap = (cost − paid per unit) × units. Re-check window: ${dl('recheck')}. Re-checked from Overview.</li>`
    + `<li><b>Reversal</b>: Amazon took money back saying the unit was found. Disputable only when the inventory ledger shows no unit of that FNSKU found within ${RB.FOUND_DAYS} days before or after it. Window: ${dl('reversal')}.</li>`
    + `<li><b>Not counted yet</b>: ${rbEsc(RB.LATER.join(', '))}. They come once Amazon's other reports are connected.</li>`
    + '<li>Which payout pays for what is read from its reason (Lost_Inbound, Lost_Warehouse, Damaged_Warehouse…): <span class="rb-tag">to check against the first real Reimbursements file</span></li></ul>'
    + '<h4>The value, in this order</h4><ul><li>Units × our <b>sourcing</b> cost.</li><li>Else the landed cost, tagged <span class="rb-tag">≈ landed</span> — landed includes freight, Amazon\'s sourcing cost does not.</li>'
    + `<li>Else <b>Amazon's rate</b>, tagged <span class="rb-tag">≈ Amazon's rate</span>: what Amazon paid per unit in its latest payout for the same SKU (else the same ASIN) in the last 12 months, reversals left out. It counts in the $ totals; the boxes say how many items use it.</li>`
    + '<li>Else the units, tagged <span class="rb-tag">no cost</span>, and left out of every $ total.</li></ul>'
    + '<h4>The status, in this order</h4><ul><li><b>Archived</b>, <b>Paid</b> and <b>In a case</b> (from the case records) win.</li><li>Else <b>Expired</b>: past the deadline (the deadline day itself is still open).</li>'
    + '<li>Else <b>Wait</b>; else <b>Claim now</b>.</li></ul>'
    + '<h4>Proof (inbound)</h4><ul><li>Kept on the case record: invoice number, supplier, invoice link (http or https only), carrier, tracking, delivered on, and the proof of delivery tick. The carrier and tracking come from Amazon\'s shipment data when it has them.</li>'
    + '<li><b>Needs proof</b>: a Claim-now shipment without (an invoice number or link) or without (tracking or a proof of delivery).</li></ul>'
    + '<h4>Never a duplicate</h4><ul><li>Amazon treats a second claim for the same thing as abuse: an item already in a case, already paid, or archived never gets "Make case" — the row says why, in red.</li>'
    + `<li>One case: one shipment; one reversal; or up to ${RB.MAX_ITEMS} lost (or damaged) items of one brand, ticked together. Anything else is refused, saying why. Amazon advises under ${RB.MAX_OPEN} open cases: Sellora warns, it does not block.</li></ul>`
    + '<h4>The boxes</h4><ul><li>Overview: Owed now, Expiring, Underpaid and Open cases are <b>today</b>. Recovered and Lost to deadlines follow the period, with the change against the period before (the same length). Recovered: through our cases = payouts with a case ID; paid by Amazon itself = without one.</li>'
    + `<li>To Claim: Can claim now, Expiring in ${RB.EXPIRING} days, Waiting on Amazon and Needs proof, today, for the brand picked, over every type; a click shows those rows.</li></ul>`
    + (RBD && RBD.sample ? '<p class="rb-note">These numbers are sample data: Amazon\'s reimbursement reports are not connected yet.</p>' : '');
}

/* ---------- Export ---------- */
function rbCsv() {
  if (!RBD) return;
  const rows = rbWeekRows(rbItems(RBD, RBC.recs, rbToday()));
  const blob = new Blob(['﻿' + rbCsvLines(rows).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reimbursement-do-this-week-${RBS.brand}${RBD.sample ? '-SAMPLE' : ''}-${rbIso(rbToday())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- wiring ---------- */
const rbRedraw = () => renderReimb();
const rbScrollTo = id => { try { $(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* */ } };
$('rbBrand').addEventListener('change', () => { RBS.brand = $('rbBrand').value in RB_BRANDS ? $('rbBrand').value : 'ALL'; RBS.all = false; rbPrefsSave(); rbRedraw(); });
$('rbPeriod').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (!b) return;
  RBS.period = b.dataset.p;
  if (RBS.period === 'custom' && (!RBS.from || !RBS.to)) { const t = rbToday(); RBS.from = rbIso(t - 29 * RB_DAY); RBS.to = rbIso(t); }
  rbPrefsSave();
  rbRedraw();
});
['rbFrom', 'rbTo'].forEach(id => $(id).addEventListener('change', () => {
  RBS.from = $('rbFrom').value || RBS.from;
  RBS.to = $('rbTo').value || RBS.to;
  rbPrefsSave();
  rbRedraw();
}));
$('rbCsv').addEventListener('click', rbCsv);
$('rbLegendBtn').addEventListener('click', () => { $('rbLegendBody').innerHTML = rbLegendHtml(); $('rbLegend').classList.remove('hide'); });
$('rbMsg').addEventListener('click', e => { if (e.target.closest('[data-rbretry]')) { RB_ERR = ''; ensureReimb(); } });
$('rbBoxes').addEventListener('click', e => {
  const b = e.target.closest('[data-box]');
  if (!b || !RBD) return;
  const k = b.dataset.box;
  if (b.classList.contains('rb-box-na')) return;   // Underpaid without sourcing costs: nothing to list
  // Owed now and Expiring: To Claim, with the same filter (underpaid payouts are re-checks: they stay on this page).
  if ((k === 'owed' || k === 'exp') && typeof rbqGo === 'function') { rbqGo({ brand: RBS.brand, focus: k === 'exp' ? 'exp' : '' }); return; }
  if (k === 'owed' || k === 'exp' || k === 'under') {
    RBS.focus = RBS.focus === k ? '' : k;
    RBS.type = '';
    RBS.all = false;
    rbRedraw();
    if (RBS.focus) rbScrollTo('rbWeekCard');
  } else if (k === 'cases') rbCasesOpen();
  else rbScrollTo('rbChartCard');
});
$('rbFix').addEventListener('click', e => { if (e.target.closest('[data-rbfix]')) rbFixOpen(); });
$('rbChips').addEventListener('click', e => {
  const t = e.target.closest('[data-type]'), x = e.target.closest('[data-exp]'), f = e.target.closest('[data-focusx]');
  if (t) RBS.type = t.dataset.type;
  else if (x) RBS.expired = !RBS.expired;
  else if (f) RBS.focus = '';
  else return;
  RBS.all = false;
  rbRedraw();
});
$('rbArch').addEventListener('change', () => { RBS.arch = $('rbArch').checked; rbRedraw(); });
$('rbFoot').addEventListener('click', e => { if (e.target.closest('[data-rball]')) { RBS.all = !RBS.all; rbRedraw(); } });
$('rbWeekGo').addEventListener('click', e => { if (e.target.closest('[data-rbgo]') && typeof rbqGo === 'function') rbqGo({ brand: RBS.brand, focus: '' }); });
$('rbTable').addEventListener('click', e => {
  const o = e.target.closest('[data-rbopen]'), a = e.target.closest('[data-rbarch]'), r = e.target.closest('[data-rbrestore]');
  if (o) { const why = rbOpen(o.dataset.rbopen); if (why) { RB_NOTE = `<span class="sta-bad">${rbEsc(why)}</span>`; renderReimb(); } }
  else if (a) { const d = a.closest('details'); if (d) d.open = false; rbArchOpen(a.dataset.rbarch); }
  else if (r) rbRestore(r.dataset.rbrestore);
});
// One ⋯ menu open at a time.
$('rbTable').addEventListener('toggle', e => {
  if (e.target.tagName === 'DETAILS' && e.target.open) $('rbTable').querySelectorAll('details.rb-more[open]').forEach(d => { if (d !== e.target) d.open = false; });
}, true);
$('rbChartSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-cm]');
  if (!b || b.dataset.cm === RBS.chart) return;
  RBS.chart = b.dataset.cm;
  RBS.off = {};
  rbCard('rbChartBody', () => rbDrawChart(rbToday()));
});
$('rbChartLegend').addEventListener('click', e => {
  const b = e.target.closest('[data-part]');
  if (!b) return;
  const k = b.dataset.part;
  const vis = rbParts().filter(p => !RBS.off[p.k]);
  if (!RBS.off[k] && vis.length === 1 && vis[0].k === k) return;   // never the last part showing
  RBS.off[k] = !RBS.off[k];
  rbCard('rbChartBody', () => rbDrawChart(rbToday()));
});
// The chart redraws when its width changes (a window resized, the menu shown or hidden), at most once a frame.
(() => {
  if (typeof ResizeObserver !== 'function') return;
  let w = 0, raf = 0;
  new ResizeObserver(() => {
    const nw = $('rbPlot').clientWidth;
    if (!nw || nw === w) return;
    w = nw;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (RB_CH && RB_CH.any) rbCard('rbChartBody', rbChartPlot); });
  }).observe($('rbPlot'));
})();
// The case dialog.
$('rbDlg').addEventListener('click', async e => {
  if (e.target === $('rbDlg')) { rbDlgTryClose(); return; }
  const c = e.target.closest('[data-rbcopy]');
  if (c) { await staCopyText($('rbText').value, c); if (RB_DLG) RB_DLG.copied = true; c.textContent = 'Copied ✓'; setTimeout(() => { c.textContent = 'Copy the text'; }, 1600); return; }
  const l = e.target.closest('[data-rbcopylist]');
  if (l) { await staCopyText(rbFormList(rbDlgItems()), l); l.textContent = 'Copied ✓'; setTimeout(() => { l.textContent = 'Copy the list'; }, 1600); return; }
  if (e.target.closest('[data-rbproof]')) { rbProofSave(); return; }
  if (e.target.closest('[data-rbdone]')) rbCaseDone();
});
$('rbDlg').addEventListener('change', e => { const k = e.target.closest('[data-rbcheck]'); if (k) rbCheck(k.dataset.rbcheck, k.checked); });
// The invoice link: refused as it is typed when it is not http / https (it is only saved by "Save the proof").
$('rbDlg').addEventListener('input', e => {
  if (e.target.id !== 'rbPfLink') return;
  const r = rbLinkOk(e.target.value);
  e.target.classList.toggle('rb-bad', !r.ok);
  $('rbPfMsg').innerHTML = r.ok ? '' : `<span class="sta-bad">${rbEsc(r.err)}.</span>`;
});
$('rbDlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); rbDlgTryClose(); } else if (e.key === 'Enter' && e.target.id === 'rbCaseId') rbCaseDone(); });
$('rbDlgX').addEventListener('click', rbDlgTryClose);
$('rbDlgClose').addEventListener('click', rbDlgTryClose);
$('rbAskYes').addEventListener('click', () => { $('rbAsk').classList.add('hide'); $('rbDlgNote').innerHTML = '<b>Put the case ID in, then "I\'ve created the case".</b>'; $('rbCaseId').focus(); });
$('rbAskNo').addEventListener('click', rbDlgClose);
$('rbAsk').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); $('rbAsk').classList.add('hide'); } });
// The other dialogs: their ✕, a click on the shade, Escape.
[['rbArchDlg', 'rbArchX'], ['rbCasesDlg', 'rbCasesX'], ['rbFixDlg', 'rbFixX'], ['rbLegend', 'rbLegendX'], ['rbUpDlg', 'rbUpX']].forEach(([m, x]) => {
  $(x).addEventListener('click', () => $(m).classList.add('hide'));
  $(m).addEventListener('click', e => { if (e.target === $(m)) $(m).classList.add('hide'); });
  $(m).addEventListener('keydown', e => { if (e.key === 'Escape') $(m).classList.add('hide'); });
});
// Upload Amazon reports: from the bar and from "Connect Amazon's data".
$('rbUpBtn').addEventListener('click', () => rbUpOpen(RBS.brand));
$('rbConnect').addEventListener('click', e => { if (e.target.closest('[data-rbup]')) rbUpOpen(RBS.brand); });
$('rbUpBrand').addEventListener('click', e => {
  const b = e.target.closest('[data-b]');
  if (!b || b.dataset.b === RB_UP.brand) return;
  RB_UP.brand = b.dataset.b;
  RB_UP.res = {};
  rbUpDraw();
});
$('rbUpBody').addEventListener('change', e => { const f = e.target.closest('input[data-upk]'); if (f && f.files && f.files[0]) rbUpFile(f.dataset.upk, f.files[0]); });
$('rbUpBody').addEventListener('click', e => { const s = e.target.closest('[data-upsave]'); if (s) { s.disabled = true; rbUpSave(s.dataset.upsave); } });
$('rbUpClose').addEventListener('click', () => $('rbUpDlg').classList.add('hide'));
$('rbArchCancel').addEventListener('click', () => $('rbArchDlg').classList.add('hide'));
$('rbArchOk').addEventListener('click', rbArchDo);
