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

