/* ================= MANAGEMENT DASHBOARD =================
 *
 * Ravi, 2026-09-26: "ek jagah KPI dashboard nahi — make this."
 *
 * One screen of the figures management asks for first: what is on the book, what the factory made this week against
 * the 20,000 target, what the printers owe and hold, what is on the shelf and waiting for FBA, who came in today.
 * NOTHING HERE IS STORED OR RECOUNTED: every number comes from the same function its own screen draws from
 * (ordLines, paWeekFacts, rfdOrderRows, fgiStock, fabBalances…), so the dashboard and the screen can never disagree.
 * Each tile is a door into that screen. Admins only — the reads behind it span every register, and that is what the
 * database rules let an admin read. */
let DASH = { busy: false, at: '', err: [] };

async function ensureDash() {
  if (!$('dashBody')) return;
  if (!ME.admin) { $('dashMsg').textContent = 'The dashboard is for admins — it reads every register at once.'; $('dashBody').innerHTML = ''; return; }
  if (DASH.busy) return;
  DASH.busy = true; DASH.err = [];
  $('dashMsg').textContent = 'Reading the registers…';
  /* Every register at once; one that cannot be read leaves its tiles blank and is named, not fatal. */
  const take = async (name, f) => { try { await f(); } catch (e) { DASH.err.push(name + ': ' + (e.message || e)); } };
  await Promise.all([
    take('order book', () => ptLoadGates()),
    take('vendor orders', async () => { if (VO.rows == null) await ensureVo(); }),
    take('finished goods', async () => { if (FGI.rows == null) await fgiLoad(); }),
    take('sales orders', async () => { if (SOX.rows == null) SOX.rows = ptList(await ptGet('pt_salesOrders')); }),
    take('attendance', async () => { if (ATT.rows == null) ATT.rows = ptList(await ptGet('pt_attend')); }),
    take('accessories', async () => { await ptLoadGates(); if (ACC.ledger == null) { ACC.items = ptList((PTG.masters || {}).accessories); ACC.ledger = ptList(await ptGet('pt_accLedger')); } }),
    take('fabric', async () => { if (FAB.rows == null) FAB.rows = ptList(await ptGet('pt_fabInvLedger')); }),
    take('RFD', async () => { if (!RFD.decisions) { const [d, st] = await Promise.all([ptGet('pt_rfdDecisions'), ptGet('pt_rfdStock')]); RFD.decisions = d || {}; RFD.stock = st || {}; } }),
    take('vendor requests', async () => { if (VRQ.rows == null) VRQ.rows = ptList(await ptGet('pt_vendorOrderReqs')).filter(r => r && r.id); }),
    take('employees', async () => { if (!PTE.emp) await ptLoadEmp(); }),     // the roster the attendance tile counts against
  ]);
  DASH.busy = false; DASH.at = ptStamp();
  renderDash();
}

/** The figures, worked out from what is loaded — a register that is not there shows a dash, never a zero. */
function dashFacts() {
  const two = (p, m) => [p ? nf(p) + ' pcs' : '', m ? nf(m) + ' m' : ''].filter(Boolean).join(' · ') || '—';
  const F = {};
  /* orders on the book */
  try {
    const lines = ordLines(), open = lines.filter(l => ptNum(l.pendingMake) > 0);
    const bySrc = {};
    open.forEach(l => { const k = String(l.src || ordSrcOf(l.orderNo) || '?').toUpperCase(); bySrc[k] = (bySrc[k] || 0) + ptNum(l.pendingMake); });
    F.orders = { open: new Set(open.map(l => l.orderNo)).size, lines: open.length,
      toMake: open.reduce((a, l) => a + ptNum(l.pendingMake), 0), bySrc };
  } catch (e) { F.orders = null; }
  try {
    const so = (SOX.rows || []).filter(o => o && !o.deleted);
    F.sales = { n: so.length, waiting: so.filter(o => soStatus(o) === 'submitted').length, drafts: so.filter(o => soStatus(o) === 'draft' || soStatus(o) === 'returned').length };
  } catch (e) { F.sales = null; }
  /* the factory this week, against the target */
  try {
    const wk = paWeekStart(Date.now()).getTime();
    const f = paWeekFacts(paDayIso(wk)), g = paWeekFacts(paDayIso(wk - 7 * 86400000));
    F.week = { received: f.received || 0, issued: f.issued || 0, cut: f.cut || 0, pressed: f.pressed || 0, rejected: f.rejected || 0,
      last: g.received || 0, target: paTarget() };
  } catch (e) { F.week = null; }
  /* the printers */
  try {
    const vo = (VO.rows || []).filter(o => o && !o.cancelled && ['Received', 'Cancelled', 'Draft'].indexOf(o.status || 'Placed') < 0);
    let pcs = 0, m = 0, late = 0, lateDays = 0;
    vo.forEach(o => voLines(o).forEach(l => {
      if (!l || l.cancelled) return;
      const owed = Math.max(0, voQty(o, l) - (parseFloat(voDone(l)) || 0));
      if (voUnit(o) === 'm') m += owed; else pcs += owed;
      const d = voLateBy(o, l); if (d != null) { late++; lateDays = Math.max(lateDays, d); }
    }));
    F.printers = { orders: vo.length, printers: new Set(vo.map(o => o.vendorCode)).size, owed: two(Math.round(pcs), Math.round(m)), late, lateDays };
  } catch (e) { F.printers = null; }
  try {
    const rr = rfdOrderRows();
    const sum = (u, k) => rfdRound(rr.filter(x => x.unit === u).reduce((a, x) => a + (x[k] || 0), 0));
    const codes = [...new Set(rr.map(x => x.vendorCode))];
    let hp = 0, hm = 0;
    codes.forEach(c => rfdStoreOf(c).forEach(x => { if (x.unit === 'm') hm += x.inHand; else hp += x.inHand; }));
    F.rfd = { toSend: two(sum('pcs', 'toSend'), sum('m', 'toSend')), onWay: two(sum('pcs', 'onWay'), sum('m', 'onWay')),
      withPrinters: two(rfdRound(hp), rfdRound(hm)), orders: new Set(rr.map(x => x.orderId)).size,
      pending: rfdRows().filter(r => r.stage === 'pending').length };
  } catch (e) { F.rfd = null; }
  try {
    F.approvals = { vreq: (VRQ.rows || []).filter(r => r && r.status === 'pending').length,
      qty: (typeof ordQtyUnseenAll === 'function' ? ordQtyUnseenAll().length : 0) };
  } catch (e) { F.approvals = null; }
  /* stock */
  try {
    let pcs = 0, skus = 0;
    fgiStock().forEach(b => { if (b.current > 0) { pcs += b.current; skus++; } });
    const fba = fbaAll().map(fbaState);
    const waiting = fba.filter(x => x.st === 'waiting'), accepted = fba.filter(x => x.st === 'accepted');
    F.fg = { pcs, skus, pending: fgiPending().length,
      fbaWaiting: waiting.reduce((a, x) => a + (x.open || 0), 0), fbaWaitingN: waiting.length,
      fbaAccepted: accepted.reduce((a, x) => a + (x.open || 0), 0), fbaAcceptedN: accepted.length };
  } catch (e) { F.fg = null; }
  try {
    const st = {};
    Object.values(fabBalances(fabAll())).forEach(b => { st[b.state] = (st[b.state] || 0) + b.qty; });
    F.fabric = { rfd: Math.round(st.RFD || 0), greige: Math.round(st.GREIGE || 0), states: st };
  } catch (e) { F.fabric = null; }
  try {
    const ab = Object.values(accBalances());
    F.acc = { items: ab.length, low: ab.filter(x => x.qty < accLow(x)).map(x => x.name || x.code) };
  } catch (e) { F.acc = null; }
  /* people */
  try {
    const att = attOfDay(dToday());
    let present = 0, absent = 0;
    att.forEach(r => { const s = attState(r); if (s === 'in' || s === 'out') present++; else if (s === 'absent') absent++; });
    F.people = { present, absent, roster: attPeople().length };
  } catch (e) { F.people = null; }
  return F;
}

function renderDash() {
  const body = $('dashBody'); if (!body) return;
  const F = dashFacts();
  /* THE JOB WORK REGISTER'S CARDS (Ravi, 2026-09-22: "this interface is very good do like this"; 2026-09-26: "dashboard
   * thoda professional lagna chahiye"): the same card, icon and tone as every other screen, in the same grid. Each card
   * is a door into its own screen. */
  const card = (v, label, icon, tone, tab, sub, colour) => `<div data-dash-go="${tab}" role="button" tabindex="0" title="Open ${esc(tab)}" style="display:contents">`
    + ordKpiCard(v, label, icon, tone, sub || '', { colour }) + '</div>';
  const sec = (name, note, cards) => `<div class="jw-kpiname" style="display:flex;align-items:baseline;gap:12px;margin-top:6px">${esc(name)}<span class="muted" style="font-size:12px;font-weight:400;margin-left:auto;text-transform:none;letter-spacing:0">${esc(note || '')}</span></div><div class="jw-kpis">${cards}</div>`;
  const dash = '<span class="muted">—</span>';
  const o = F.orders, s = F.sales, w = F.week, p = F.printers, r = F.rfd, a = F.approvals, g = F.fg, fb = F.fabric, ac = F.acc, pe = F.people;
  const pct = w && w.target ? Math.round(w.received / w.target * 100) : 0;
  const tone = (ok, warn) => (ok ? 'green' : (warn ? 'amber' : 'red'));
  body.innerHTML = '<div class="dash">' + sec('Orders on the book', 'open lines from the order book', (o
      ? card(nf(o.open), 'Open orders', 'list', 'blue', 'ord', nf(o.lines) + ' line(s)')
        + card(nf(o.toMake), 'Pieces still to make', 'cut', 'red', 'ord', Object.entries(o.bySrc).sort((x, y) => y[1] - x[1]).map(([k, v]) => esc(k) + ' ' + nf(v)).join(' · '))
      : card(dash, 'Open orders', 'list', 'blue', 'ord'))
      + (s ? card(nf(s.waiting), 'Sales orders awaiting approval', 'doc', s.waiting ? 'amber' : 'green', 'so', nf(s.n) + ' on record' + (s.drafts ? ' · ' + nf(s.drafts) + ' draft / returned' : ''))
           : card(dash, 'Sales orders', 'doc', 'blue', 'so')))
    + sec('The factory this week', 'Monday to today, from the registers', (w
      ? card(nf(w.received), 'Pieces received from karigars', 'ok', tone(pct >= 100, pct >= 60), 'pa', nf(pct) + '% of the ' + nf(w.target) + ' target · last week ' + nf(w.last))
        + card(nf(w.issued), 'Issued to karigars', 'open', 'blue', 'pbase', w.rejected ? nf(w.rejected) + ' rejected' : 'nothing rejected')
        + card(nf(w.cut), 'Cut', 'cut', 'blue', 'pcut', 'pieces cut this week')
        + card(nf(w.pressed), 'Pressed', 'press', 'blue', 'ppress', 'pieces pressed this week')
      : card(dash, 'Pieces received from karigars', 'ok', 'blue', 'pa')))
    + sec('Printers', 'vendor orders open now', (p
      ? card(nf(p.orders), 'Open vendor orders', 'box', 'blue', 'vord', nf(p.printers) + ' printer(s)')
        + card(p.owed, 'Still owed by printers', 'clock', 'blue', 'vord', 'ordered, not yet delivered')
        + card(nf(p.late), 'Late lines', 'alert', p.late ? 'red' : 'green', 'vord', p.late ? 'the latest ' + nf(p.lateDays) + ' day(s) over' : 'nothing overdue')
      : card(dash, 'Open vendor orders', 'box', 'blue', 'vord'))
      + (r ? card(r.toSend, 'RFD cloth still to send', 'up', r.toSend !== '—' ? 'red' : 'green', 'rfd', nf(r.orders) + ' order(s) from ' + RFD_TRACK_FROM)
          + card(r.onWay, 'Sent, not yet confirmed', 'clock', r.onWay !== '—' ? 'amber' : 'blue', 'rfd', 'the printer confirms in their portal')
          + card(r.withPrinters, 'Company cloth with printers', 'box', 'blue', 'rfd', 'had + received − delivered back')
          + card(nf(r.pending), 'RFD asks waiting for approval', 'doc', r.pending ? 'red' : 'green', 'rfd', r.pending ? 'beyond what the order covers' : 'nothing waiting')
        : card(dash, 'RFD cloth still to send', 'up', 'blue', 'rfd'))
      + (a ? card(nf(a.vreq + a.qty), 'Approvals waiting', 'tick', (a.vreq + a.qty) ? 'amber' : 'green', 'vreq', [a.vreq ? nf(a.vreq) + ' vendor order request(s)' : '', a.qty ? nf(a.qty) + ' quantity change(s)' : ''].filter(Boolean).join(' · ') || 'nothing waiting') : ''))
    + sec('Stock', 'finished goods, FBA queue, cloth, accessories', (g
      ? card(nf(g.pcs), 'Finished pieces in the store', 'box', 'blue', 'fgi', nf(g.skus) + ' SKU(s)' + (g.pending ? ' · ' + nf(g.pending) + ' transfer(s) to confirm' : ''))
        + card(nf(g.fbaWaiting), 'Waiting for the FBA team', 'up', g.fbaWaiting ? 'amber' : 'green', 'fba', nf(g.fbaWaitingN) + ' issue(s)')
        + card(nf(g.fbaAccepted), 'Accepted, not yet shipped', 'ok', 'blue', 'fba', nf(g.fbaAcceptedN) + ' issue(s)')
      : card(dash, 'Finished pieces in the store', 'box', 'blue', 'fgi'))
      + (fb ? card(nf(fb.rfd) + ' m', 'RFD cloth in the store', 'list', 'blue', 'fab', 'ready for cutting and the printers') + card(nf(fb.greige) + ' m', 'Greige in the store', 'list', 'blue', 'fab', 'not yet sent to RFD')
            : card(dash, 'RFD cloth in the store', 'list', 'blue', 'fab'))
      + (ac ? card(nf(ac.low.length), 'Accessories below reorder level', 'alert', ac.low.length ? 'red' : 'green', 'acc', ac.low.slice(0, 4).map(esc).join(', ') + (ac.low.length > 4 ? ' …' : '') || 'all above the line')
            : card(dash, 'Accessories below reorder level', 'alert', 'blue', 'acc')))
    + sec('People', 'attendance today', (pe
      ? card(nf(pe.present), 'Present today', 'ok', pe.present ? 'green' : 'blue', 'att', 'of ' + nf(pe.roster) + ' on the roster')
        + card(nf(pe.absent), 'Marked absent', 'x', pe.absent ? 'red' : 'blue', 'att', pe.absent ? 'marked by hand' : 'nobody marked absent')
      : card(dash, 'Present today', 'ok', 'blue', 'att'))) + '</div>';
  $('dashMsg').className = DASH.err.length ? 'err' : 'muted';
  $('dashMsg').textContent = (DASH.at ? 'Read ' + DASH.at + ' · ' : '') + 'every figure is the same one its own screen shows — click a card to open that screen'
    + (DASH.err.length ? ' · could not read: ' + DASH.err.join(' · ') : '');
}
$('dashBody').addEventListener('click', e => { const t = e.target.closest('[data-dash-go]'); if (t) showTab(t.getAttribute('data-dash-go')); });
$('dashBody').addEventListener('keydown', e => { const t = e.target.closest('[data-dash-go]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showTab(t.getAttribute('data-dash-go')); } });
$('dashGo').onclick = () => {
  /* Read again, every register — the tiles are only as fresh as the registers behind them. */
  VO.rows = null; FGI.rows = null; SOX.rows = null; ATT.rows = null; FAB.rows = null; RFD.decisions = null; VRQ.rows = null; ACC.ledger = null;
  ptGatesFresh().then(ensureDash);
};

/* ================= FINANCE & HR =================
 *
 * Three lists that payroll is built out of, so the checks here are about not corrupting a payout:
 *
 *   EMPLOYEE LIST — [employment type, name, department, phone]. Deleting somebody who appears in
 *   Base Data or in extra hours is refused: those rows would name a person the list no longer has,
 *   and the payout that reads them would simply skip them.
 *
 *   RATE LIST — [article type, subtype, size, applicable for, rate, commission]. One rate per
 *   article+subtype+size+employment-type; a second is refused rather than silently shadowed, because
 *   `rateFor` picks the FIRST match and the loser would be invisible.
 *
 *   EXTRA HOURS — logged by anyone, AUTHORISED by an admin, and that separation is the point. Hours
 *   are computed from the two times (overnight allowed, capped at 24), the same person cannot be
 *   logged twice on one date, and a frozen month refuses everything.
 *
 * These are arrays in the database, not keyed records, so a change rewrites the whole list — which
 * is also why each write is preceded by the checks rather than followed by them.
 */
let HR = { emp: null, rate: null, eh: null, freeze: null, freezes: null, adv: null, err: '', busy: false, at: '', rows: [] };

/* ---- four lists, one array each, and a save that replaces the lot ----
 *
 * These nodes are stored as a single array, so writing one row means writing all of them. The page
 * reads each list once and every save sends the whole thing back, which means a save is only ever
 * correct while the stored list is still what this page read. It very often is not: nothing here
 * auto-refreshes, so a list read at ten in the morning is what gets written at six in the evening,
 * over the top of everything anybody else did in between.
 *
 * HR_SEEN holds what the database had at the moment we read it. A save checks that first.
 *
 * The real answer is one write per row, which needs these nodes keyed rather than positional — and
 * that has to wait, because Vimal's tool still reads pt_empList and pt_rateList by position and the
 * whole production register still runs through it.
 */
let HR_SEEN = {};

/** Stable text for a value, so two reads of the same data always compare equal. */
const hrCanon = v => JSON.stringify(v === undefined ? null : v, (k, x) =>
  (x && typeof x === 'object' && !Array.isArray(x))
    ? Object.fromEntries(Object.keys(x).sort().map(k2 => [k2, x[k2]]))
    : x);

/**
 * Write one of the four whole-list nodes — but only if nobody has touched it since this page read it.
 *
 * On a clash NOTHING is written. The list is reloaded from the database so the next attempt starts
 * from the truth, and the caller is told, by a throw: every one of these saves already runs inside
 * something that turns a throw into a message on screen.
 */
async function hrPutList(node, value) {
  const stored = await ptGet(node);
  if (HR_SEEN[node] !== undefined && hrCanon(stored) !== HR_SEEN[node]) {
    HR.emp = null;                       // the read guard — this forces every list to be re-read
    try { await ensureHr(); } catch (e) { /* the reload reports itself through HR.err */ }
    renderHr();
    throw new Error('Somebody else changed this list while you had it open, so nothing was saved — '
      + 'saving yours would have deleted theirs. The list has been reloaded from the database. '
      + 'Check it, then make your change again.');
  }
  await ptPut(node, value);
  HR_SEEN[node] = hrCanon(value);
}

/** An array node can come back as an array or, if it ever goes sparse, as keyed values. */
const hrRow = r => (Array.isArray(r) ? r : (r && Array.isArray(r.value) ? r.value : []));

async function ensureHr() {
  if (HR.emp === null) {
    HR.busy = true; renderHr();
    try {
      /* Seven reads, seven names. One short here would hand every later list the value of the one
       * before it, and nothing on screen would look wrong until a payout did. */
      /* An employee-list-only account needs the list, and extra hours to count where a name is used.
       * Rates, freezes and advances are not read for it at all. */
      const only = hrEmpOnly(), skip = node => (only ? Promise.resolve(null) : ptGet(node));
      const [e, r, pr, h, f, pf, ad] = await Promise.all([
        ptGet('pt_empList'), skip('pt_rateList'), skip('pt_printerRates'), ptGet('pt_extraHours'), skip('pt_ehFreezes'),
        skip('pt_payoutFreezes'), skip('pt_advances')]);
      /* What the DATABASE held, before any filtering — a save is compared against this, and it has
       * to be what was actually stored rather than what we chose to keep of it. */
      HR_SEEN = { pt_empList: hrCanon(e), pt_rateList: hrCanon(r), pt_printerRates: hrCanon(pr),
        pt_advances: hrCanon(ad) };
      HR.emp = ptList(e).map(hrRow).filter(x => x.length && x[1]);
      HR.rate = ptList(r).map(hrRow).filter(x => x.length && x[1]);
      /* Objects, not positional rows — this node is new and holds two different shapes of rate. */
      HR.prate = prRowsOf(pr);
      prSnapTake(HR.prate);
      HR.eh = ptList(h);
      HR.freeze = f || {};
      HR.freezes = pf || {};   // payout freezes — a paid fortnight must not move
      HR.adv = ptList(ad);
      HR.err = '';
    } catch (err) { HR.err = err.message || String(err); HR.emp = HR.emp || []; HR.rate = HR.rate || []; HR.prate = HR.prate || []; HR.eh = HR.eh || []; HR.freeze = {}; HR.freezes = HR.freezes || {}; HR.adv = HR.adv || [];
      /* A read that failed saw nothing, so it may not vouch for anything. Without this, a save after
       * a failed refresh would compare against a stale snapshot and pass. */
      HR_SEEN = {}; }
    HR.at = ptStamp(); HR.busy = false;
    if (!PT.base) { try { PT.base = ptList(await ptGet('pt_baseData')); } catch (e) { PT.base = PT.base || []; } }
    /* The printer rates are read against the vendor orders — the usage count and the pickers are
     * both built from them, and without them every rate would read as matching nothing. */
    if (VO.rows === null && !hrEmpOnly()) { try { await ensureVo(); } catch (e) { /* the rates still list */ } }
    if (!PTG.mdb) { try { await ptLoadGates(); } catch (e) { /* a cut rate falls back to the line */ } }
  }
  renderHr();
}

const hrN = s => String(s == null ? '' : s).trim().toLowerCase();
const ehMonthKey = d => String(d || '').slice(0, 7);
const ehFrozen = d => !!(HR.freeze && HR.freeze[ehMonthKey(d)]);

/** Hours between two clock times. Overnight is real work, so it counts rather than going negative. */
function ehHours(from, to) {
  const m = s => { const p = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return p ? (+p[1]) * 60 + (+p[2]) : null; };
  const a = m(from), b = m(to);
  if (a == null || b == null) return null;
  let d = b - a;
  if (d <= 0) d += 24 * 60;
  return Math.round((d / 60) * 100) / 100;
}

/** The old tool's rate lookup, fallbacks and all — exact, then without the article, then without size. */
function rateFor(at, sub, size, applicableFor) {
  const L = HR.rate || [];
  let r = L.find(x => hrN(x[0]) === hrN(at) && hrN(x[1]) === hrN(sub) && hrN(x[2]) === hrN(size) && hrN(x[3]) === hrN(applicableFor));
  if (!r) r = L.find(x => hrN(x[1]) === hrN(sub) && hrN(x[2]) === hrN(size) && hrN(x[3]) === hrN(applicableFor));
  if (!r) r = L.find(x => hrN(x[1]) === hrN(sub) && hrN(x[3]) === hrN(applicableFor));
  return r ? (parseFloat(r[4]) || 0) : 0;
}

/* WHO MAY DELETE AN EMPLOYEE. Adding and editing stay open to everyone who reaches the list, as they
 * always were. Deleting was admin-only; now it is also perms.empEdit ("Can add and delete employees").
 * That right on its own opens ONLY the employee list — ME.hrEmpOnly — so the person who keeps the
 * list is not also shown everybody's pay. */
const hrCanEmpDelete = () => !spIsVendor() && !!(ME.admin || ME.empEdit);
const hrEmpOnly = () => !!(ME.hrEmpOnly && !ME.admin);

/** Where a person's name appears, so a deletion cannot orphan their work. */
function hrEmpUsage(name) {
  const n = hrN(name);
  return {
    base: (PT.base || []).filter(r => hrN(r.empName) === n).length,
    hours: (HR.eh || []).filter(r => hrN(r.empName) === n).length,
    qc: (QC.issue || []).filter(r => hrN(r.employee) === n).length,
  };
}

/* ---- the screen ---- */

function renderHr() {
  if (hrEmpOnly()) $('hrView').value = 'emp';
  $('hrView').classList.toggle('hide', hrEmpOnly());
  const view = $('hrView').value;
  ['hrEmpAdd', 'hrRateAdd', 'hrEhAdd', 'hrPrAdd'].forEach((id, i) =>
    $(id).classList.toggle('hide', view !== ['emp', 'rate', 'eh', 'prate'][i]));
  /* The approval picker and the bulk button belong to the rate list, and the bulk button belongs to
   * somebody who can actually approve — a button that does nothing reads as a broken app. */
  $('hrPrStatus').classList.toggle('hide', view !== 'prate');
  $('hrPrOkAll').classList.toggle('hide', !(view === 'prate' && prCanApprove()));
  const money = ['cc', 'ec', 'adv', 'slip', 'vpay'].includes(view);
  $('hrMonth').classList.toggle('hide', !money);
  const payView = view === 'cc' || view === 'ec';
  /* The vendor payout is read by fortnight like the others, but it has no freeze — there is nothing
   * on it that means settled, and a Freeze button that locked nothing would say there were. */
  $('hrPeriod').classList.toggle('hide', !(payView || view === 'vpay'));
  $('hrPayEmp').classList.toggle('hide', view !== 'cc');   // an EC line is the firm's, not a person's
  $('hrFreeze').classList.toggle('hide', !(payView || view === 'vpay'));
  $('hrSlipEmp').classList.toggle('hide', view !== 'slip');
  $('hrSlipPrint').classList.toggle('hide', view !== 'slip');
  $('hrEhStatus').classList.toggle('hide', view !== 'eh');
  $('hrSlip').classList.toggle('hide', view !== 'slip');
  if (money && !$('hrMonth').value) $('hrMonth').value = dToday().slice(0, 7);   // local month, not UTC (last month until 05:30 IST on the 1st)

  if (HR.busy) { $('hrMsg').className = 'muted'; $('hrMsg').textContent = 'Reading the production database…'; ptEmpty('hrTable', 'Loading…'); return; }
  if (HR.err) { $('hrMsg').className = 'err'; $('hrMsg').textContent = 'Could not read it: ' + HR.err; ptEmpty('hrTable', 'Nothing to show.'); $('hrKpis').innerHTML = ''; return; }

  if (view === 'cc' || view === 'ec') return renderPayout(view);
  if (view === 'vpay') return renderVpay();
  if (view === 'adv') return renderAdvance();
  if (view === 'slip') return renderSlip();

  const q = $('hrQ').value.trim().toLowerCase();
  const kpi = (name, metrics) => `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">${esc(name)}</span>
      <span class="kpiwhen">read live${HR.at ? ' · ' + esc(HR.at) : ''}</span></div>
    <div class="metrics">${metrics}</div></div>`;
  const met = (v, l, col) => `<div class="metric"><div class="v"${col ? ` style="color:${col}"` : ''}>${v}</div><div class="l">${esc(l)}</div></div>`;

  if (view === 'emp') {
    const rows = (HR.emp || []).filter(e => !q || [e[0], e[1], e[2], e[3]].join(' ').toLowerCase().includes(q))
      .map((e, i) => ({ e, i: (HR.emp || []).indexOf(e) }));
    HR.rows = rows;
    const depts = new Set((HR.emp || []).map(e => String(e[2] || '').trim()).filter(Boolean));
    $('hrKpis').innerHTML = kpi('Employee list',
      met(nf(rows.length), 'People') + met(nf(depts.size), 'Departments')
      + met(nf(new Set((HR.emp || []).map(e => String(e[0] || '').trim()).filter(Boolean)).size), 'Employment types')
      + met(nf((HR.emp || []).filter(e => !String(e[3] || '').trim()).length), 'No phone number'));
    const head = '<thead><tr>' + ['Name', 'Employment type', 'Department', 'Phone', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';
    $('hrTable').innerHTML = head + '<tbody>' + rows.map(({ e, i }) => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(e[1])}</td>`
      + `<td>${esc(e[0])}</td><td>${esc(e[2])}</td>`
      + `<td style="text-align:left">${esc(e[3]) || '<span class="muted">—</span>'}</td>`
      + `<td><button class="ghost" data-hr-emp="${i}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`).join('')
      + '</tbody>';
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = `${nf(rows.length)} of ${nf((HR.emp || []).length)} employee(s)`
      + (hrCanEmpDelete() ? '' : ' · removing an employee needs "Can add and delete employees"');
    return;
  }

  if (view === 'rate') {
    const rows = (HR.rate || []).filter(r => !q || [r[0], r[1], r[2], r[3]].join(' ').toLowerCase().includes(q))
      .map(r => ({ r, i: (HR.rate || []).indexOf(r) }));
    HR.rows = rows;
    const vals = rows.map(({ r }) => parseFloat(r[4]) || 0);
    $('hrKpis').innerHTML = kpi('Rate list',
      met(nf(rows.length), 'Rates') + met(nf(new Set(rows.map(({ r }) => r[1]).filter(Boolean)).size), 'Subtypes')
      + met('Rs.' + (vals.length ? nf(Math.min(...vals)) : 0), 'Lowest')
      + met('Rs.' + (vals.length ? nf(Math.max(...vals)) : 0), 'Highest'));
    const head = '<thead><tr>' + ['Article type', 'Subtype', 'Size', 'Applicable for', 'Rate', 'Commission', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 4 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('hrTable').innerHTML = head + '<tbody>' + rows.map(({ r, i }) => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(r[0])}</td>`
      + `<td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td>`
      + `<td class="num" style="font-weight:700">Rs.${nf(parseFloat(r[4]) || 0)}</td>`
      + `<td>${String(r[5]) === 'NA' || !r[5] ? '<span class="muted">—</span>' : esc(r[5])}</td>`
      + `<td><button class="ghost" data-hr-rate="${i}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`).join('')
      + '</tbody>';
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = `${nf(rows.length)} of ${nf((HR.rate || []).length)} rate(s)`;
    return;
  }

  if (view === 'prate') {
    const all = HR.prate || [];
    const sf = $('hrPrStatus').value;
    const rows = all.map((r, i) => ({ r, i }))
      .filter(({ r }) => !sf || prStatus(r) === sf)
      .filter(({ r }) => !q || [voName(r.vendor), r.vendor, r.service, prWhat(r), r.notes].join(' ').toLowerCase().includes(q));
    HR.rows = rows;
    /* Lowest and highest are what the factory PAYS, so they are read off the approved rates only —
     * a proposal of Rs.9,000 is not the highest rate in the list, it is a proposal. */
    const vals = rows.filter(({ r }) => prApproved(r)).map(({ r }) => parseFloat(r.rate) || 0);
    const unreached = rows.filter(({ r }) => prUsage(r) === 0).length;
    const waiting = all.filter(r => prStatus(r) === 'Pending').length;
    $('hrKpis').innerHTML = kpi('Vendor rate list',
      met(nf(rows.length), 'Rates') + met(nf(new Set(rows.map(({ r }) => r.vendor)).size), 'Vendors')
      + met('Rs.' + (vals.length ? nf(Math.min(...vals)) : 0), 'Lowest approved')
      + met('Rs.' + (vals.length ? nf(Math.max(...vals)) : 0), 'Highest approved')
      + (waiting ? met(nf(waiting), 'Waiting for approval', '#7f6000') : '')
      + (unreached ? met(nf(unreached), 'Matching no live line', '#7f6000') : ''));

    if (!rows.length) {
      ptEmpty('hrTable', all.length ? (sf ? `No rate is ${sf.toLowerCase()}${q ? ' and matches that search' : ''}.` : 'No rate matches that search.')
        : 'No vendor rates yet. "+ New rate" adds the first one, or upload a file.');
      $('hrMsg').className = 'muted';
      $('hrMsg').textContent = all.length ? ''
        : 'Printing is priced by the metre; embroidery, cutting, stitching and filling by the piece. '
          + 'A filling rate also carries the filler and its weight, because the same quilt costs '
          + 'differently in surgical cotton and in cotton.';
      return;
    }

    /* VENDOR NAME WISE, which is how Ravi asked for it and how a rate is argued about: one printer at
     * a time, everything they charge under their own name. */
    const byV = new Map();
    rows.forEach(x => { if (!byV.has(x.r.vendor)) byV.set(x.r.vendor, []); byV.get(x.r.vendor).push(x); });
    const vendors = [...byV.keys()].sort((a, b) => voName(a).toLowerCase().localeCompare(voName(b).toLowerCase()));
    const head = '<thead><tr>' + ['Vendor', 'Work', 'What', 'Rate', 'Unit', 'Approval', 'On live orders', 'Notes', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 3 || i === 6 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    const body = vendors.map(vc => {
      const list = byV.get(vc).slice().sort((a, b) => (a.r.kind || '').localeCompare(b.r.kind || '')
        || prWhat(a.r).toLowerCase().localeCompare(prWhat(b.r).toLowerCase()));
      const bar = '<tr style="background:var(--hover,#f1f5f9)">'
        + `<td class="frz" style="text-align:left;font-weight:700;background:var(--hover,#f1f5f9)">${esc(voName(vc))}`
        + `${voKnown(vc) ? '' : ' <span class="pill pill-out">unknown code</span>'}</td>`
        + `<td colspan="8" class="muted" style="text-align:left">${voCatOf(vc) ? esc(voCatOf(vc)) + ' · ' : ''}${nf(list.length)} rate(s)</td></tr>`;
      return bar + list.map(({ r, i }) => {
        const used = prUsage(r);
        return '<tr>'
          + '<td class="frz"></td>'
          + `<td style="text-align:left">${esc(r.service || (r.kind === 'running' ? 'Block print' : 'Block print'))}</td>`
          + `<td style="text-align:left">${esc(prWhat(r))}</td>`
          + `<td class="num" style="font-weight:700">Rs.${nf(parseFloat(r.rate) || 0)}</td>`
          + `<td class="muted">${esc(prUnit(r))}</td>`
          + `<td>${prRateCell(r, i)}</td>`
          /* A rate nothing matches is not wrong, but it will never be reached — and there is no way
           * to tell that by looking at the number. */
          + `<td class="num"${used ? '' : ' style="color:#7f6000"'} title="${used
            ? (prApproved(r) ? 'Live order lines this rate prices.' : 'Live order lines this rate WOULD price, once it is approved. Today they are priced by nothing.')
            : 'No live order line matches this rate, so it would never be used. Check the size or the subtype.'}">`
          + `${used ? nf(used) : 'none'}</td>`
          + `<td style="text-align:left;font-size:12px" class="muted">${esc(r.notes) || ''}</td>`
          + `<td>${(prCanApprove() || prStatus(r) === 'Pending')
            ? `<button class="ghost" data-hr-prate="${i}" style="padding:3px 10px;font-size:12px">Edit</button>`
            : '<span class="muted" title="An approved rate is what the factory pays. Changing one is granted separately.">—</span>'}</td>`
          + '</tr>';
      }).join('');
    }).join('');
    $('hrTable').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('hrMsg').className = 'muted';
    $('hrMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} rate(s) across ${nf(vendors.length)} printer(s)`
      + (unreached ? ` · ${nf(unreached)} match no live order line` : '');
    return;
  }

  const st = $('hrEhStatus').value;
  const rows = (HR.eh || [])
    .filter(r => !st || (r.status || 'pending') === st)
    .filter(r => !q || [r.empName, r.department, r.remarks].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id || '').localeCompare(String(a.id || '')));
  HR.rows = rows;
  const hrs = s => rows.filter(r => (r.status || 'pending') === s).reduce((a, r) => a + ptNum(r.hours), 0);
  $('hrKpis').innerHTML = kpi('Extra hours',
    met(nf(rows.length), 'Entries') + met(nf(rows.reduce((a, r) => a + ptNum(r.hours), 0)), 'Hours')
    + met(nf(hrs('pending')), 'Hours awaiting authorisation', '#7f6000')
    + met(nf(hrs('authorized')), 'Hours authorised', '#166534')
    + met(nf(new Set(rows.map(r => r.empName).filter(Boolean)).size), 'People'));
  const head = '<thead><tr>' + ['Date', 'Employee', 'Department', 'From', 'To', 'Hours', 'Status', 'Authorise', 'Entered by', 'Remarks', 'Edit']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 5 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('hrTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => {
    const s = r.status || 'pending';
    const pill = s === 'authorized' ? '<span class="pill pill-ok">Authorised</span>' : '<span class="pill pill-low">Pending</span>';
    return '<tr>'
      + `<td class="frz" style="text-align:left">${esc(r.date)}</td>`
      + `<td style="text-align:left">${esc(r.empName)}</td><td>${esc(r.department)}</td>`
      + `<td>${esc(r.fromTime)}</td><td>${esc(r.toTime)}</td>`
      + `<td class="num" style="font-weight:700">${esc(r.hours)}</td>`
      + `<td>${pill}</td>`
      /* The action lives where the status is, not inside an edit dialog — that is where it was, and
       * nobody found it. Frozen months say so instead of offering a button that refuses. */
      + `<td>${!ME.admin ? '<span class="muted">—</span>'
        : ehFrozen(r.date) ? '<span class="muted">frozen</span>'
        : s === 'authorized'
          ? `<button class="ghost" data-eh-auth="${esc(r.id)}" data-on="0" style="padding:3px 10px;font-size:12px">Undo</button>`
          : `<button data-eh-auth="${esc(r.id)}" data-on="1" style="padding:3px 12px;font-size:12px">Authorise</button>`}</td>`
      + `<td style="text-align:left">${esc(String(r.enteredByName || r.enteredBy || '').split('@')[0])}</td>`
      + `<td style="text-align:left;white-space:normal;max-width:200px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
      + `<td><button class="ghost" data-hr-eh="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`;
  }).join('') + '</tbody>';
  $('hrMsg').className = 'muted';
  $('hrMsg').textContent = `${nf(rows.length)} of ${nf((HR.eh || []).length)} entr${(HR.eh || []).length === 1 ? 'y' : 'ies'}`
    + (rows.length > 600 ? ' · showing the first 600' : '');
}

/* ---- writing ---- */

const hrSaveEmp = () => hrPutList('pt_empList', HR.emp);
const hrSaveRate = () => hrPutList('pt_rateList', HR.rate);

