/* ================= FABRIC FLOW — the whole journey in one window =================
 *
 * Ravi, 2026-09-26: "m pahle greige fabric purchase karta hu, then greige ko RFD par bhejta hu, RFD se receive hota h
 * then cut pcs / running me printers ko deta hu, then printer us RFD fabric ko print krke dete h … jo mene jaal buna h
 * usko 1 hi window se karne ka try karo."
 *
 * Five stages, each read off the register it has always lived in: greige and RFD off the fabric ledger, the processor
 * off ISSUE_TO_RFD − RECEIVE_RFD, the printers off the order-driven RFD ledger, what came back off the deliveries.
 * Nothing is stored here; every button opens the entry it always has. */
let FFLOW = { stage: 4, loaded: false, busy: false, err: [] };

async function ensureFabFlow() {
  if (FFLOW.busy) return;
  FFLOW.busy = true; FFLOW.err = [];
  /* DRAWN AS EACH REGISTER LANDS (Ravi, 2026-09-26: "iska lag issue dekho"). Measured: a draw is 40 ms and one open is
   * 17 reads with no storm — the wait was the 8 MB of registers, and the screen sat on "Reading…" until the last of
   * them. Now the fabric ledger's stages show at once and the rest fill in; a register that fails is named. */
  FFLOW.loaded = true; FFLOW.waiting = [];
  const take = async (name, f) => {
    FFLOW.waiting.push(name);
    try { await f(); } catch (e) { FFLOW.err.push(name); }
    FFLOW.waiting = FFLOW.waiting.filter(x => x !== name);
    renderFab();
  };
  await Promise.all([
    take('the master database', () => ptLoadGates()),
    take('the printers\' orders', async () => { if (VO.rows == null) await ensureVo(); }),
    take('the greige POs', async () => { if (GPO.rows == null) await ensureGpo(); }),
    take('the RFD counts', async () => { if (RFD.decisions == null) RFD.decisions = (await ptGet('pt_rfdDecisions')) || {}; if (!RFD.stock || !Object.keys(RFD.stock).length) RFD.stock = (await ptGet('pt_rfdStock')) || {}; }),
    /* The Job Work Register comes with the gates; asking for it here as well read 2.4 MB twice. */
    take('the store', async () => { if (STORE.rows == null) STORE.rows = ptList(await ptGet('pt_storeLedger')); await ptLoadGates(); if (!PT.base) PT.base = ptList(await ptGet('pt_baseData')); }),
  ]);
  FFLOW.busy = false;
  renderFab();
}

/** The figures, fabric by fabric and stage by stage, off what is loaded. */
function ffFacts() {
  const all = fabAll();
  const byFab = new Map();
  const F = name => { const u = String(name || '').trim(); const k = fabKey(u); if (!k) return null;
    if (!byFab.has(k)) byFab.set(k, { fabric: u, greige: 0, proc: 0, rfd: 0, need: 0, toSend: 0, onWay: 0, withP: 0, backPcs: 0, backM: 0 });
    return byFab.get(k); };
  Object.values(fabBalances(all)).forEach(b => { const e = F(b.fabricType); if (!e) return; if (b.state === 'GREIGE') e.greige += b.qty; else if (b.state === 'RFD') e.rfd += b.qty; });
  byFab.forEach(e => { e.proc = fabWithProcessor(e.fabric); });
  let rows = [];
  try { rows = rfdOrderRows(); } catch (e) { rows = []; }
  const sumU = (u, k) => rfdRound(rows.filter(x => x.unit === u).reduce((a, x) => a + (x[k] || 0), 0));
  rows.filter(x => x.unit === 'm').forEach(x => { const e = F(x.what); if (!e) return; e.need += x.need; e.toSend += x.toSend; e.onWay += x.onWay; });
  let withPcs = 0, withM = 0;
  try {
    [...new Set(rows.map(x => x.vendorCode))].forEach(c => rfdStoreOf(c).forEach(x => {
      if (x.unit === 'm') { withM += x.inHand; const e = F(x.what); if (e) e.withP += x.inHand; } else withPcs += x.inHand; }));
  } catch (e) { /* the counts are not readable to this account */ }
  /* what came back printed, last 30 days — running as metres of its cloth, pieces under the cloth their SKU is cut from */
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  let toAccept = 0, back30 = { pcs: 0, m: 0 };
  try {
    voLogRows().forEach(r => {
      if (!r.ok) toAccept++;
      const day = String(r.day || '').slice(0, 10);
      if (!day || day < since) return;
      const q = r.ok ? parseFloat(r.ok.qty) || 0 : r.qty;
      if (r.run) { back30.m += q; const e = F(r.fabric); if (e) e.backM += q; }
      else { back30.pcs += q; const m = mdbOf(r.sku); const e = m && m.fabric ? F(m.fabric) : null; if (e) e.backPcs += q; }
    });
  } catch (e) { /* no orders loaded */ }
  let storePcs = null;
  try { storePcs = Math.round(stBalances(stMoves()).filter(stFromPrinter).filter(b => b.unit === 'pcs').reduce((a, b) => a + b.qty, 0)); } catch (e) { storePcs = null; }
  const pos = (GPO.rows || []).filter(po => po && ['open', 'sent', 'part'].indexOf(gpoStatus(po)) >= 0);
  const poPending = Math.round(pos.reduce((a, po) => a + gpoProgress(po).pending, 0));
  const lots = fabLots(all);
  const r1 = v => Math.round(v * 10) / 10;
  const fabrics = [...byFab.values()].map(e => Object.assign(e, { greige: r1(e.greige), proc: r1(e.proc), rfd: r1(e.rfd), need: r1(e.need), toSend: r1(e.toSend),
      onWay: r1(e.onWay), withP: r1(e.withP), backM: r1(e.backM), short: r1(Math.max(0, e.toSend - e.rfd)) }))
    .filter(e => e.greige || e.proc || e.rfd || e.need || e.withP || e.backPcs || e.backM)
    .sort((a, b) => (b.short - a.short) || String(a.fabric).localeCompare(String(b.fabric), undefined, { numeric: true }));
  return { fabrics, rows, lots,
    greige: r1(fabrics.reduce((a, e) => a + e.greige, 0)), pos: pos.length, poPending,
    proc: r1(fabrics.reduce((a, e) => a + e.proc, 0)), procLots: lots.filter(g => g.withProcessor > 0.05).length,
    rfd: r1(fabrics.reduce((a, e) => a + e.rfd, 0)), needM: sumU('m', 'toSend'),
    toSend: { pcs: sumU('pcs', 'toSend'), m: sumU('m', 'toSend') }, onWay: { pcs: sumU('pcs', 'onWay'), m: sumU('m', 'onWay') }, withP: { pcs: r1(withPcs), m: r1(withM) },
    orders: new Set(rows.map(x => x.orderId)).size, toAccept, back30, storePcs };
}

function renderFabFlowOne() {
  if (!FFLOW.loaded) { if (!FFLOW.busy) ensureFabFlow(); $('fbMsg').className = 'muted'; $('fbMsg').textContent = 'Reading the registers…'; $('fbKpis').innerHTML = ''; ptEmpty('fbTable', 'Loading…'); return; }
  const X = ffFacts();
  const q = (($('fbQ') || {}).value || '').trim().toLowerCase();
  const two = v => [v.pcs ? nf(v.pcs) + ' pcs' : '', v.m ? nf(v.m) + ' m' : ''].filter(Boolean).join(' · ') || '—';
  const edit = ptCanEdit();
  /* ONE SLIM ROW, NOT A BANNER (Ravi, 2026-09-27: "remove this banner"). The five stages are tabs with their figure
   * in them; the chosen stage's buttons sit at the right; its list is below the fabric table, as before. */
  const tab = (n, label, v) => `<button type="button" class="segbtn${FFLOW.stage === n ? ' on' : ''}" data-ff-stage="${n}">${esc(label)} <b style="font-weight:700">${v}</b></button>`;
  const btn = (act, label, primary) => `<button type="button" class="${primary ? '' : 'ghost'}" data-ff-act="${act}" style="padding:6px 12px;font-size:12.5px">${esc(label)}</button>`;
  const acts = { 1: edit ? btn('po', '+ Greige PO', true) + btn('recv-greige', 'Receive greige') : '',
    2: edit ? btn('to-rfd', 'Send to RFD', true) + btn('rfd-in', 'RFD received') : '',
    3: edit ? btn('cut', 'RFD → cutting', true) + btn('buy', '+ RFD bought') : '',
    4: btn('byprinter', 'By printer'),
    5: btn('accept', 'Accept delivery', true) + btn('store', 'Store') }[FFLOW.stage] || '';
  $('fbKpis').innerHTML = '<div style="flex-basis:100%">'
    + `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><div class="seg" role="tablist">`
    + tab(1, 'Greige', nf(X.greige) + ' m') + tab(2, 'At processor', nf(X.proc) + ' m') + tab(3, 'RFD', nf(X.rfd) + ' m')
    + tab(4, 'Printers', two(X.toSend) + ' to send') + tab(5, 'To accept', nf(X.toAccept))
    + `</div><span style="flex:1"></span>${acts}</div>`
    + '<div class="ff-cap">Every fabric, start to finish. Red: the orders need more RFD than the shelf holds.</div>'
    + '<div class="ff-grid"><table class="xl"><thead><tr>' + ['Fabric', 'Greige stock', 'At processor', 'RFD stock', 'Orders need (RFD)', 'Short', 'With printers', 'Printed back · 30 d', ''].map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + (X.fabrics.filter(e => !q || e.fabric.toLowerCase().indexOf(q) >= 0).map(e => {
        const z = v => (v ? nf(v) : '<span class="muted">—</span>');
        const tag = e.short > 0 ? (e.greige || e.proc ? '<span class="pill pill-low">RFD short — ' + (e.proc ? 'ask the processor' : 'send greige to RFD') + '</span>' : '<span class="pill pill-out">RFD short — no greige either</span>')
          : (e.need ? '<span class="pill pill-ok">covered</span>' : '');
        return '<tr>'
          + `<td style="text-align:left"><b>${esc(e.fabric)}</b></td>`
          + `<td class="num">${z(e.greige)}</td><td class="num" style="color:#7f6000">${z(e.proc)}</td><td class="num" style="font-weight:700">${z(e.rfd)}</td>`
          + `<td class="num">${z(e.toSend)}${e.need && e.need !== e.toSend ? '<div class="muted" style="font-size:10.5px">of ' + nf(e.need) + '</div>' : ''}</td>`
          + `<td class="num" style="color:var(--bad);font-weight:700">${e.short ? nf(e.short) : '<span class="muted">—</span>'}</td>`
          + `<td class="num">${z(e.withP)}${e.onWay ? '<div class="muted" style="font-size:10.5px">' + nf(e.onWay) + ' on the way</div>' : ''}</td>`
          + `<td class="num" style="color:#166534">${[e.backPcs ? nf(e.backPcs) + ' pcs' : '', e.backM ? nf(e.backM) + ' m' : ''].filter(Boolean).join(' · ') || '<span class="muted">—</span>'}</td>`
          + `<td>${tag}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted" style="padding:12px">Nothing in the fabric ledger yet.</td></tr>')
    + '</tbody></table></div></div>';

  /* the chosen stage's worklist */
  const st = FFLOW.stage;
  let head = [], body = '', cap = '';
  const th = (list, nums) => '<thead><tr>' + list.map((h, i) => `<th${i === 0 ? ' class="frz"' : (nums.indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  if (st === 1) {
    const pos = (GPO.rows || []).filter(po => po && ['open', 'sent', 'part'].indexOf(gpoStatus(po)) >= 0);
    cap = 'Greige POs still open — what the mill owes.';
    head = th(['PO', 'Mill', 'Date', 'Ordered', 'Received', 'Pending', 'Status'], [3, 4, 5]);
    body = pos.map(po => { const p = gpoProgress(po), s = GPO_STATUS[gpoStatus(po)] || ['', '']; return '<tr>'
      + `<td class="frz" style="text-align:left"><b>${esc(po.poNo || po.id)}</b></td><td style="text-align:left">${esc(po.mill || '')}</td><td>${esc(po.date || '')}</td>`
      + `<td class="num">${nf(Math.round(p.ordered))} m</td><td class="num" style="color:#166534">${nf(Math.round(p.received))} m</td><td class="num" style="color:var(--bad);font-weight:700">${nf(Math.round(p.pending))} m</td>`
      + `<td><span class="pill ${s[1]}">${esc(s[0])}</span></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted" style="padding:12px">No greige PO open.</td></tr>';
  } else if (st === 2) {
    const lots = X.lots.filter(g => g.withProcessor > 0.05);
    cap = 'Lots with the processor — sent as greige, not yet back as RFD.';
    head = th(['Lot', 'Fabric', 'Processor', 'Sent', 'Sent to RFD', 'Back as RFD', 'Still there'], [4, 5, 6]);
    body = lots.map(g => '<tr>'
      + `<td class="frz" style="text-align:left"><b>${esc(g.lot)}</b></td><td style="text-align:left">${esc(g.fabricType)}</td><td style="text-align:left">${esc(g.processor || '—')}</td><td>${esc(g.date || '')}</td>`
      + `<td class="num">${nf(Math.round(g.toRfd * 10) / 10)} m</td><td class="num" style="color:#166534">${nf(Math.round(g.rfdIn * 10) / 10)} m</td><td class="num" style="color:#7f6000;font-weight:700">${nf(Math.round(g.withProcessor * 10) / 10)} m</td></tr>`).join('')
      || '<tr><td colspan="7" class="muted" style="padding:12px">Nothing with a processor.</td></tr>';
  } else if (st === 3) {
    const lots = X.lots.filter(g => g.rfdLeft > 0.05);
    cap = 'RFD on the shelf, lot by lot — what cutting and the printers draw from.';
    head = th(['Lot', 'RFD fabric', 'Date', 'RFD in', 'To cutting', 'Left'], [3, 4, 5]);
    body = lots.map(g => '<tr>'
      + `<td class="frz" style="text-align:left"><b>${esc(g.lot)}</b></td><td style="text-align:left">${esc(g.rfdFabric || g.fabricType)}</td><td>${esc(g.date || '')}</td>`
      + `<td class="num">${nf(Math.round((g.rfdIn + g.rfdOpen) * 10) / 10)} m</td><td class="num">${nf(Math.round(g.rfdOut * 10) / 10)} m</td><td class="num" style="font-weight:700">${nf(Math.round(g.rfdLeft * 10) / 10)} m</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted" style="padding:12px">No RFD on the shelf.</td></tr>';
  } else if (st === 4) {
    cap = 'The printers\' orders from ' + RFD_TRACK_FROM + ' — what each needs, what went, what they confirmed, what is still to send. RFD in store is the shelf for that cloth.';
    head = th(['Order', 'Printer', 'Accepted', 'What', 'Needs', 'With them', 'Sent', 'Received', 'To send', 'RFD in store', ''], [4, 5, 6, 7, 8, 9]);
    const shelf = name => { const e = X.fabrics.find(f => fabKey(f.fabric) === fabKey(name)); return e ? e.rfd : 0; };
    const z = (n, u) => (n ? nf(n) + ' ' + u : '<span class="muted">—</span>');
    body = X.rows.map(x => { const a = voAckOf(x._order), sh = x.unit === 'm' ? shelf(x.what) : null; return '<tr>'
      + `<td class="frz" style="text-align:left"><b>${esc(x.orderNo)}</b></td><td style="text-align:left">${esc(x.vendorName)}</td>`
      + `<td>${a ? '<span class="pill pill-ok">✓ ' + esc(ptIsoDate(a.at) || a.status) + '</span>' : '<span class="pill pill-low">not yet</span>'}</td>`
      + `<td style="text-align:left"><b>${esc(x.what)}</b><div class="muted" style="font-size:10.5px">${esc(x.item)}</div></td>`
      + `<td class="num" style="font-weight:700">${nf(x.need)} ${x.unit}</td><td class="num" style="color:#7f6000">${z(x.withYou, x.unit)}</td><td class="num" style="color:#166534">${z(x.sent, x.unit)}</td><td class="num">${z(x.recv, x.unit)}</td>`
      + `<td class="num" style="font-weight:700;color:${x.toSend ? 'var(--bad)' : '#166534'}">${x.toSend ? nf(x.toSend) + ' ' + x.unit : 'done'}</td>`
      + `<td class="num"${sh != null && sh < x.toSend ? ' style="color:var(--bad);font-weight:700" title="Less RFD on the shelf than this needs"' : ''}>${sh == null ? '<span class="muted">pcs</span>' : nf(sh) + ' m'}</td>`
      + `<td style="white-space:nowrap">${x.toSend > 0 && rfdCanSend() ? `<button class="jw-btn jw-primary" data-ff-send="${esc(x.orderId)}|${esc(x.key)}" style="padding:4px 10px;font-size:12px">Send ${nf(x.toSend)} ${x.unit}</button>` : ''}</td></tr>`; }).join('')
      || `<tr><td colspan="11" class="muted" style="padding:12px">No printer order from ${RFD_TRACK_FROM} yet.</td></tr>`;
  } else {
    let dels = [];
    try { dels = voLogRows().filter(r => !r.ok).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))); } catch (e) { dels = []; }
    cap = 'Printed goods the printers say they sent, not yet accepted — accept them in History and they land in the store.';
    head = th(['Sent on', 'Printer', 'Order', 'What', 'Qty', ''], [4]);
    body = dels.slice(0, 300).map(r => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(r.day || r.raw || '')}</td><td style="text-align:left">${esc(r.vendor)}</td><td style="text-align:left">${esc(r.orderNo)}</td><td style="text-align:left">${esc(r.what)}${r.sku ? ' <span class="muted">' + esc(r.sku) + '</span>' : ''}</td>`
      + `<td class="num" style="font-weight:700">${nf(r.qty)} ${r.unit}</td><td><button type="button" class="ghost" data-ff-act="accept" style="padding:3px 10px;font-size:12px">Accept in History</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="muted" style="padding:12px">Nothing waiting to be accepted.</td></tr>';
  }
  $('fbTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  FAB.shown = [];
  $('fbMsg').className = FFLOW.err.length ? 'err' : 'muted';
  $('fbMsg').textContent = cap + ((FFLOW.waiting || []).length ? ' · still reading ' + FFLOW.waiting.join(', ') + '…' : '')
    + (FFLOW.err.length ? ' · could not read ' + FFLOW.err.join(', ') : '');
}

/* the stages and their buttons */
$('fbKpis').addEventListener('click', e => {
  const act = e.target.closest('[data-ff-act]');
  if (act) { e.stopPropagation(); return ffAct(act.getAttribute('data-ff-act')); }
  const st = e.target.closest('[data-ff-stage]');
  if (st) { FFLOW.stage = parseInt(st.getAttribute('data-ff-stage'), 10) || 4; renderFab(); }
});
$('fbTable').addEventListener('click', e => {
  const sd = e.target.closest('[data-ff-send]');
  if (sd) { const [oid, key] = sd.getAttribute('data-ff-send').split('|'); return rfdOfficeSendOpen(oid, key, () => { FFLOW.loaded = false; ensureFabFlow(); }); }
  const act = e.target.closest('[data-ff-act]');
  if (act) return ffAct(act.getAttribute('data-ff-act'));
});
function ffAct(act) {
  if (act === 'po') { if ($('fbPoNew')) $('fbPoNew').onclick(); return; }
  if (act === 'recv-greige') return fabEntryOpen({ kind: 'RECEIVE_GREIGE' });
  if (act === 'to-rfd') return fabEntryOpen({ kind: 'ISSUE_TO_RFD' });
  if (act === 'rfd-in') return fabEntryOpen({ kind: 'RECEIVE_RFD' });
  if (act === 'cut') return fabEntryOpen({ kind: 'ISSUE_TO_CUTTING' });
  if (act === 'buy') return fabEntryOpen({ kind: 'PURCHASE_RFD' });
  if (act === 'send') { FFLOW.stage = 4; return renderFab(); }
  if (act === 'byprinter') { showTab('rfd'); if ($('rfdView')) { $('rfdView').value = 'printer'; renderRfd(); } return; }
  if (act === 'accept') return showTab('vlog');
  if (act === 'store') { $('fbView').value = 'store'; return renderFab(); }
}
$('fbGo').addEventListener('click', () => { FFLOW.loaded = false; });

function renderFab() {
  /* ONLY WHERE SOMEBODY IS LOOKING. ensureFab ends here, and other screens call ensureFab for the
   * ledger alone — the Order Console's Demand view does. The Fabric tab opens on the store, so that
   * one read used to set off the whole store in the background: three more database reads, a
   * thousand-row table and a minute of picture lookups, on a pane nobody could see. Opening the tab
   * draws it; that is the moment it is wanted. */
  if (typeof TAB_NOW !== 'undefined' && TAB_NOW && TAB_NOW !== 'fab') return;
  if (FAB.busy) { $('fbMsg').className = 'muted'; $('fbMsg').textContent = 'Reading the fabric ledger…'; ptEmpty('fbTable', 'Loading…'); return; }
  if (FAB.err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = 'Could not read it: ' + FAB.err; ptEmpty('fbTable', 'Nothing to show.'); $('fbKpis').innerHTML = ''; return; }
  /* THE PO VIEW has its own buttons and its own table; the ledger's filters do not apply to it. */
  const view0 = ($('fbView') || {}).value || 'flow';
  fabTools(view0);
  if (view0 === 'flow') return renderFabFlowOne();
  if (view0 === 'store' || view0 === 'storemov') return renderStore(view0);
  const isPo = view0 === 'po';
  if ($('fbPoNew')) $('fbPoNew').classList.toggle('hide', !isPo || !ptCanEdit());
  if ($('fbPoSet')) $('fbPoSet').classList.toggle('hide', !isPo || !ME.admin);
  if (isPo) return renderGpo();
  const all = fabAll();
  if (!all.length) { $('fbMsg').className = 'muted'; $('fbMsg').textContent = ''; $('fbKpis').innerHTML = ''; ptEmpty('fbTable', 'The fabric ledger is empty.'); return; }

  const f = fabFilters();
  const txns = [...new Set(all.map(r => r.txnType).filter(Boolean))].sort();
  const curT = $('fbTxn').value;
  $('fbTxn').innerHTML = '<option value="">All movements</option>'
    + txns.map(x => `<option value="${esc(x)}">${esc(FAB_LABEL[x] || x)}</option>`).join('');
  $('fbTxn').value = curT;
  ptFill('fbFab', fabApply(all, f, 'fab').map(r => r.fabricType), 'All fabrics');
  ptFill('fbCol', fabApply(all, f, 'col').map(r => r.colour), 'All colours');
  ptFill('fbCp', fabApply(all, f, 'cp').map(r => r.counterpartyName || r.counterparty), 'All counterparties');
  if ($('fbView').value === 'rfd') return renderFabFlow(all);
  if ($('fbView').value === 'lots') return renderFabLots(all);

  const rows = fabApply(all, f);
  const bal = fabBalances(rows);
  const view = $('fbView').value;
  FAB.shown = view === 'stock' ? bal : rows.slice().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) || String(b._id || '').localeCompare(String(a._id || '')));

  const inQty = bal.reduce((s, x) => s + x.inQty, 0), outQty = bal.reduce((s, x) => s + x.outQty, 0);
  const unknown = rows.filter(r => !fabKnown(r.txnType)).length;
  $('fbKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Fabric inventory</span>
      <span class="kpiwhen">read live${FAB.at ? ' · ' + esc(FAB.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Movements</div></div>
      <div class="metric"><div class="v">${nf(bal.length)}</div><div class="l">Fabric &amp; colour</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(inQty)}</div><div class="l">In</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(outQty)}</div><div class="l">Out</div></div>
      <div class="metric"><div class="v">${nf(inQty - outQty)}</div><div class="l">Balance</div></div>
    </div></div>`;

  if (view === 'stock') {
    const head = '<thead><tr>' + ['Fabric', 'Colour', 'In', 'Out', 'Balance', 'Movements']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 2 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('fbTable').innerHTML = head + '<tbody>' + bal.map(b => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(b.fabricType)}</td>`
      + `<td style="text-align:left">${esc(b.colour) || '<span class="muted">—</span>'}</td>`
      + `<td class="num" style="color:#166534">${nf(b.inQty)}</td>`
      + `<td class="num" style="color:var(--bad)">${nf(b.outQty)}</td>`
      /* A negative balance is not hidden: it means the ledger says more went out than ever came in,
       * and that is a thing somebody has to look at, not round away. */
      + `<td class="num" style="font-weight:700${b.qty < 0 ? ';color:var(--bad)' : ''}">${nf(b.qty)}</td>`
      + `<td class="num muted">${nf(b.n)}${b.unknown ? ` <span style="color:var(--bad)">(${nf(b.unknown)} unknown)</span>` : ''}</td></tr>`).join('')
      + '</tbody>';
  } else {
    const head = '<thead><tr>' + ['Date', 'Movement', 'Lot', 'Fabric', 'Colour', 'Qty', 'Effect', 'Counterparty', 'Order', 'Remarks', 'Entered by']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 5 || i === 6 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('fbTable').innerHTML = head + '<tbody>' + FAB.shown.slice(0, 600).map(r => {
      const m = fabMove(r), known = fabKnown(r.txnType);
      return '<tr>'
        + `<td class="frz" style="text-align:left">${esc(r.date)}</td>`
        + `<td>${esc(FAB_LABEL[r.txnType] || r.txnType)}${known ? '' : ' <span class="pill pill-out">unknown</span>'}</td>`
        + `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:11px">${esc(fabLotOf(r)) || '<span class="muted">—</span>'}</td>`
        + `<td>${esc(r.fabricType)}</td><td>${esc(r.colour)}</td>`
        + `<td class="num">${nf(fabQty(r))}</td>`
        + `<td class="num" style="font-weight:700;color:${m > 0 ? '#166534' : (m < 0 ? 'var(--bad)' : 'var(--muted)')}">`
        + `${m > 0 ? '+' : ''}${nf(m)}</td>`
        + `<td style="text-align:left">${esc(r.counterpartyName || r.counterparty) || '<span class="muted">—</span>'}</td>`
        + `<td style="text-align:left">${esc(r.orderNo) || '<span class="muted">—</span>'}</td>`
        + `<td style="text-align:left;white-space:normal;max-width:200px">${esc([r.size ? r.size + ' × ' + nf(r.pieces || 0) + ' pcs' : '', r.remarks].filter(Boolean).join(' · ')) || '<span class="muted">—</span>'}</td>`
        + `<td style="text-align:left">${esc(String(r.createdBy || '').split('@')[0])}</td></tr>`;
    }).join('') + '</tbody>';
  }

  $('fbMsg').className = unknown ? 'err' : 'muted';
  $('fbMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} movement(s)`
    + (view === 'ledger' && rows.length > 600 ? ' · showing the first 600 · Export covers all of them' : '')
    + (unknown ? ` · ${nf(unknown)} row(s) of an unknown kind` : '');
  $('fbMsg').title = 'The balance is the sum of the ledger, never a stored figure.'
    + (unknown ? ` ${nf(unknown)} row(s) have a movement type this app does not know, and are counted as moving nothing.` : '');
}

['fbView', 'fbTxn', 'fbFab', 'fbCol', 'fbCp', 'fbD1', 'fbD2'].forEach(id => $(id).addEventListener('change', renderFab));
ptDebounce('fbQ', renderFab);
$('fbClear').onclick = () => { ['fbTxn', 'fbFab', 'fbCol', 'fbCp', 'fbQ', 'fbD1', 'fbD2'].forEach(id => $(id).value = ''); renderFab(); };
$('fbGo').onclick = async () => {
  FAB.rows = null; PT.cut = null; STORE.rows = null;
  if (typeof RFD !== 'undefined') RFD.decisions = null;
  await ensureFab();
  await ensureStore(true);
};
/* A number in To cutting or To printers opens the entries behind it. */
$('fbTable').addEventListener('click', e => {
  const a = e.target.closest('[data-fbauto]');
  if (!a) return;
  e.preventDefault();
  $('fbView').value = 'ledger';
  renderFab();
  $('fbTxn').value = a.getAttribute('data-fbauto');
  $('fbFab').value = a.getAttribute('data-fbfab');
  renderFab();
});
$('fbExport').onclick = () => {
  const v = ($('fbView') || {}).value;
  if (v === 'store' || v === 'storemov') {
    const rows = FAB.shown || []; if (!rows.length) return;
    const head = v === 'store' ? ['Item', 'Kind', 'SKU', 'Fabric', 'Colour', 'In', 'Out', 'Balance', 'Movements', 'Last']
      : ['Date', 'What', 'Item', 'Kind', 'SKU', 'Fabric', 'Colour', 'In', 'Out', 'Who', 'Cross-checked', 'Remark'];
    const body = v === 'store'
      ? rows.map(b => [b.name, ST_UNITS[b.unit], b.sku, b.fabric, b.colour, b.inQty, b.outQty, b.qty, b.n, ptIsoDate(b.last) || ''])
      : rows.slice().reverse().map(mv => [mv.date, mv.what, stName(mv), ST_UNITS[mv.unit], mv.sku, mv.fabric, mv.colour,
        mv.qty > 0 ? Math.round(mv.qty * 100) / 100 : '', mv.qty < 0 ? Math.round(-mv.qty * 100) / 100 : '', mv.who,
        mv.src === 'printer' ? (stChecked(mv.checkKey) ? 'Yes' : 'No') : '', mv.remark]);
    return ptDownload(v === 'store' ? 'store-stock' : 'store-movements',
      [head.map(csvCell).join(',')].concat(body.map(r => r.map(csvCell).join(','))));
  }
  const stock = v === 'stock';
  const rows = FAB.shown || []; if (!rows.length) return;
  if ($('fbView').value === 'rfd') {
    const cols = [['Fabric', 'fabricType'], ['Greige in', 'greigeIn'], ['Sent for RFD', 'toRfd'], ['Greige left', 'greigeLeft'],
      ['With processor', 'withProcessor'], ['RFD back', 'rfdIn'], ['Loss %', 'lossPct'], ['RFD opening', 'rfdOpen'], ['RFD bought', 'rfdBuy'],
      ['To cutting', 'rfdOut'], ['To printers', 'toPrinter'], ['RFD left', 'rfdLeft']];
    return ptDownload('rfd-stock', [cols.map(c => csvCell(c[0])).join(',')]
      .concat(rows.map(g => cols.map(c => csvCell(typeof g[c[1]] === 'number' ? Math.round(g[c[1]] * 100) / 100 : (g[c[1]] == null ? '' : g[c[1]]))).join(','))));
  }
  const head = stock ? ['Fabric', 'Colour', 'In', 'Out', 'Balance', 'Movements']
    : ['Date', 'Movement', 'Fabric', 'Colour', 'Qty', 'Effect', 'Counterparty', 'Order', 'Remarks', 'Entered by'];
  const body = stock
    ? rows.map(b => [b.fabricType, b.colour, b.inQty, b.outQty, b.qty, b.n])
    : rows.map(r => [r.date, FAB_LABEL[r.txnType] || r.txnType, r.fabricType, r.colour, fabQty(r),
        fabMove(r), r.counterpartyName || r.counterparty, r.orderNo, r.remarks, r.createdBy]);
  ptDownload(stock ? 'fabric-stock' : 'fabric-ledger',
    [head.map(csvCell).join(',')].concat(body.map(b => b.map(csvCell).join(','))));
};

/* ---- entering a fabric movement ----
 *
 * One dialog for all of them, because they are the same act with a different sign: cloth arrives, or
 * cloth goes somewhere. What changes is which ceiling applies.
 */
const FAB_ENTRY_KINDS = [
  ['RECEIVE_GREIGE', 'Greige received from the mill'],
  ['ISSUE_TO_RFD', 'Greige sent for RFD processing'],
  ['RECEIVE_RFD', 'RFD received back'],
  ['OPENING_RFD', 'RFD opening stock (already on the floor)'],
  ['PURCHASE_RFD', 'RFD received — bought ready from a vendor'],
  ['ISSUE_TO_CUTTING', 'RFD to cutting'],
  ['ADJUST', 'Correction'],
];

/* ---- lots ----
 *
 * A lot is one delivery of one fabric: the unit that is tracked from the mill to the cutting table.
 * Rows written before lots existed carry none, and are gathered under "(no lot)" rather than being
 * given one that nobody ever wrote on a bale.
 */
const fabLotOf = r => String((r && r.lot) || '').trim().toUpperCase();
const FAB_NO_LOT = '(no lot)';

/** A lot number nobody has used, built from the fabric and the day: CAMBRIC-260912-01. */
function fabNextLot(fabric, day) {
  const d = String(day || attToday()).replace(/-/g, '').slice(2);
  const base = String(fabric || 'FAB').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const taken = new Set((FAB.rows || []).map(fabLotOf));
  for (let i = 1; i < 100; i++) {
    const id = base + '-' + d + '-' + String(i).padStart(2, '0');
    if (!taken.has(id)) return id;
  }
  return base + '-' + d + '-' + Date.now().toString(36).slice(-3).toUpperCase();
}

/**
 * Every lot, and where its cloth has got to.
 *
 * Received from the mill, out at the processor, back as RFD, gone to cutting — per lot, so a bale can
 * be followed rather than a fabric name. The loss is the lot's own: it is the number that says which
 * mill lot or which processor is costing metres.
 */
function fabLots(rows) {
  const by = new Map();
  (rows || FAB.rows || []).forEach(r => {
    if (r && r.auto) return;          // cut or handed over: taken from the fabric, not from a named bale
    const lot = fabLotOf(r) || FAB_NO_LOT;
    let g = by.get(lot);
    if (!g) {
      g = { lot, fabricType: r.fabricType || '', rfdFabric: '', bill: '', mill: '', processor: '', date: r.date || '',
        greigeIn: 0, toRfd: 0, rfdIn: 0, rfdOpen: 0, rfdOut: 0, rate: '', n: 0 };
      by.set(lot, g);
    }
    g.n++;
    const q = fabQty(r);
    if (r.txnType === 'RECEIVE_GREIGE') {
      g.greigeIn += q;
      g.date = g.date || r.date || '';
      g.bill = g.bill || String(r.vendorChallan || r.billNo || '').trim();
      g.mill = g.mill || String(r.counterpartyName || r.counterparty || '').trim();
      if (g.rate === '' && r.rate !== '' && r.rate != null) g.rate = r.rate;
      if (!g.fabricType) g.fabricType = r.fabricType || '';
    } else if (r.txnType === 'ISSUE_TO_RFD') {
      g.toRfd += q;
      g.processor = String(r.counterpartyName || r.counterparty || '').trim() || g.processor;
    } else if (r.txnType === 'RECEIVE_RFD') { g.rfdIn += q; g.rfdFabric = g.rfdFabric || String(r.fabricType || '').trim(); }
    else if (r.txnType === 'OPENING_RFD' || r.txnType === 'PURCHASE_RFD') { g.rfdOpen += q; g.rfdFabric = g.rfdFabric || String(r.fabricType || '').trim(); g.date = g.date || r.date || '';
      if (r.txnType === 'PURCHASE_RFD') { g.bill = g.bill || String(r.vendorChallan || '').trim(); g.mill = g.mill || String(r.counterpartyName || '').trim(); } }
    else if (r.txnType === 'ISSUE_TO_CUTTING') g.rfdOut += q;
  });
  return [...by.values()].map(g => Object.assign(g, {
    greigeLeft: g.greigeIn - g.toRfd,
    withProcessor: g.toRfd - g.rfdIn,
    rfdLeft: g.rfdOpen + g.rfdIn - g.rfdOut,
    lossPct: g.rfdIn > 0 && g.toRfd > 0 ? Math.round(((g.toRfd - g.rfdIn) / g.toRfd) * 1000) / 10 : null,
  })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.lot.localeCompare(b.lot));
}
/**
 * The lots of ONE fabric, newest first — which is the list somebody is actually choosing from.
 *
 * A fabric arrives in as many lots as there are deliveries; four lots of CAMBRIC on the floor at once
 * is ordinary. `want` narrows to the lots that still hold something of the kind being moved, so a
 * lot with nothing left in it is not offered as a source.
 */
function fabLotsOfFabric(fabric, want) {
  const f = String(fabric || '').trim().toUpperCase();
  return fabLots().filter(g => {
    if (g.lot === FAB_NO_LOT) return false;
    /* A lot answers to its greige name, the RFD name it came back as, and the one Masters says it becomes. */
    if (f && ![g.fabricType, g.rfdFabric, fabRfdOfGreige(g.fabricType)]
      .some(n => String(n || '').trim().toUpperCase() === f)) return false;
    if (want === 'greige') return g.greigeLeft > 1e-9;
    if (want === 'out') return g.withProcessor > 1e-9;
    if (want === 'rfd') return g.rfdLeft > 1e-9;
    return true;
  });
}

/** What a movement of this kind needs to find in a lot. */
const FAB_KIND_WANT = { ISSUE_TO_RFD: 'greige', RECEIVE_RFD: 'out', ISSUE_TO_CUTTING: 'rfd' };

/** One lot, by number. */
const fabLot = lot => fabLots().find(g => g.lot === String(lot || '').trim().toUpperCase()) || null;
/** Lots with greige still to send, and lots still out at a processor — the two pickers. */
const fabLotsWithGreige = () => fabLots().filter(g => g.lot !== FAB_NO_LOT && g.greigeLeft > 1e-9);
const fabLotsOut = () => fabLots().filter(g => g.lot !== FAB_NO_LOT && g.withProcessor > 1e-9);
const fabLotsWithRfd = () => fabLots().filter(g => g.rfdLeft > 1e-9);

/** What is in stock of one fabric, in one state — the ceiling an issue is measured against. */
function fabStockOf(fabricType, state) {
  const k = String(fabricType || '').trim().toUpperCase();
  return fabAll().reduce((a, r) => {
    if (String(r.fabricType || '').trim().toUpperCase() !== k) return a;
    if (fabState(r) !== String(state).toUpperCase()) return a;
    return a + (fabKnown(r.txnType) ? fabMove(r) : 0);
  }, 0);
}
/** Sent for processing and not yet back, for one fabric. */
function fabWithProcessor(fabricType) {
  const k = String(fabricType || '').trim().toUpperCase();
  let out = 0, back = 0;
  (FAB.rows || []).forEach(r => {
    if (String(r.fabricType || '').trim().toUpperCase() !== k) return;
    if (r.txnType === 'ISSUE_TO_RFD') out += fabQty(r);
    if (r.txnType === 'RECEIVE_RFD') back += fabQty(r);
  });
  return out - back;
}

/**
 * Write one movement.
 *
 * THE CEILINGS ARE THE POINT. Cloth that is not there cannot be sent anywhere, and cloth cannot come
 * back from the processor that was never sent — a receipt bigger than what is out with them is either
 * somebody else's cloth or a typo, and both are worth stopping at the keyboard.
 */
async function fabSave(rec) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const kind = String(rec.txnType || '').trim();
  if (!FAB_ENTRY_KINDS.some(k => k[0] === kind)) return 'Pick what kind of movement this is.';
  let fabric = String(rec.fabricType || '').trim();
  if (!fabric) return 'Which fabric?';
  const qty = parseFloat(rec.qty);
  if (!isFinite(qty) || (kind !== 'ADJUST' && qty <= 0)) return 'How many metres?';
  if (kind === 'ADJUST' && qty === 0) return 'A correction of nothing is not a correction.';

  /* THE LOT IS WHAT MOVES. A metre is not interchangeable with another metre once you care which
   * mill lot it came off — and everybody cares the day the cloth comes out narrow. */
  let lot = String(rec.lot || '').trim().toUpperCase();

  /* AGAINST A GREIGE PO: it has to be one, still open, and for this cloth. */
  const poNo = String(rec.orderNo || '').trim().toUpperCase();
  if (kind === 'RECEIVE_GREIGE' && poNo && GPO.rows) {
    const po = GPO.rows.find(r => String(r.poNo || '').toUpperCase() === poNo);
    if (!po) return `There is no greige PO ${poNo}.`;
    if (po.status === 'cancelled') return `${poNo} was cancelled.`;
    const names = (po.lines || []).map(l => String(l.greige || '').trim());
    if (!names.some(n => n.toLowerCase() === fabric.toLowerCase()))
      return `${poNo} is for ${names.join(', ')} — not ${fabric}.`;
  }

  if (kind === 'PURCHASE_RFD' && !String(rec.counterpartyName || '').trim()) return 'Who was it bought from?';
  if (kind === 'OPENING_RFD' || kind === 'PURCHASE_RFD') {
    /* OPENING STOCK OPENS A LOT OF ITS OWN, so cutting can be issued from it by lot like any other. */
    lot = lot || fabNextLot(fabric, rec.date);
    const already = fabLot(lot);
    if (already && already.n > 0)
      return `Lot ${lot} already has entries. Leave the lot empty and one will be made, or use a new number.`;
  }

  if (kind === 'RECEIVE_GREIGE') {
    /* A delivery opens a lot. If nobody types the mill's own number, one is made. */
    lot = lot || fabNextLot(fabric, rec.date);
    const already = fabLot(lot);
    if (already && already.greigeIn > 0)
      return `Lot ${lot} already has ${nf(Math.round(already.greigeIn))} m against it. `
        + 'Use a different lot number, or add to that lot with a correction.';
  }

  if (kind === 'ISSUE_TO_RFD') {
    if (!lot) return 'Which lot is going for processing?';
    const g = fabLot(lot);
    if (!g || g.greigeIn <= 0) return `Lot ${lot} has no greige against it.`;
    /* The lot is still greige, so it goes out under its greige name — typing the RFD name it will
     * become is not a mistake worth stopping anybody for. */
    if (g.fabricType && fabric && String(g.fabricType).toUpperCase() !== fabric.toUpperCase()
      && fabRfdOfGreige(g.fabricType).toUpperCase() !== fabric.toUpperCase())
      return `Lot ${lot} is ${g.fabricType}, not ${fabric}.`;
    fabric = g.fabricType || fabric;
    if (qty > g.greigeLeft + 1e-9)
      return `Only ${nf(Math.round(g.greigeLeft))} m is left in lot ${lot} `
        + `(${nf(Math.round(g.greigeIn))} received, ${nf(Math.round(g.toRfd))} already sent).`;
    if (!String(rec.counterpartyName || '').trim()) return 'Who is processing it?';
  }

  if (kind === 'RECEIVE_RFD') {
    if (!lot) return 'Which lot is coming back?';
    const g = fabLot(lot);
    if (!g || g.toRfd <= 0) return `Lot ${lot} was never sent for processing, so nothing can come back from it.`;
    if (qty > g.withProcessor + 1e-9)
      return `Only ${nf(Math.round(g.withProcessor))} m of lot ${lot} is still with ${g.processor || 'the processor'} `
        + `(${nf(Math.round(g.toRfd))} sent, ${nf(Math.round(g.rfdIn))} already back).`;
    /* GREIGE COMES BACK AS THE RFD FABRIC IT WAS BOUGHT FOR — Greige Sheeting 67 back as Sheeting 62.
     * Only when Masters says so; a greige with no RFD fabric named keeps whatever was typed. */
    const becomes = fabRfdOfGreige(g.fabricType);
    if (becomes) fabric = becomes;
  }

  if (kind === 'ISSUE_TO_CUTTING' && !rec.legacy) {
    if (!String(rec.size || '').trim()) return 'Which size is being cut?';
    const pc = Number(rec.pieces);
    if (!(pc > 0) || Math.round(pc) !== pc) return 'How many pieces? A whole number.';
  }
  if (kind === 'ISSUE_TO_CUTTING') {
    const st = String(rec.state || 'RFD').toUpperCase();
    if (lot) {
      const g = fabLot(lot);
      if (!g) return `There is no lot ${lot}.`;
      if (qty > g.rfdLeft + 1e-9)
        return `Only ${nf(Math.round(g.rfdLeft))} m of RFD is left in lot ${lot}.`;
    } else {
      /* Cloth that predates lots still has to come from somewhere. */
      const have = fabStockOf(fabric, st);
      if (qty > have + 1e-9) return `Only ${nf(Math.round(have))} m of ${FAB_STATE_LABEL[st] || st} ${fabric} is in stock.`;
    }
  }

  const now = new Date().toISOString();
  const id = 'fab_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = {
    _id: id, id, date: String(rec.date || '').trim() || ptIsoDate(now) || now.slice(0, 10),
    txnType: kind, fabricType: fabric, colour: String(rec.colour || '').trim(),
    qty, form: 'RUNNING', state: FAB_TXN_STATE[kind] || String(rec.state || 'RFD').toUpperCase(),
    /* WHICH BALE THIS IS, AND WHAT IT ARRIVED ON. The lot travels with every movement; the bill is
     * written on the delivery that opened the lot and read back from there. */
    lot,
    counterparty: String(rec.counterparty || '').trim(),
    counterpartyName: String(rec.counterpartyName || '').trim(),
    orderNo: String(rec.orderNo || '').trim(), vendorChallan: String(rec.challan || '').trim(),
    rate: rec.rate === '' || rec.rate == null ? '' : (parseFloat(rec.rate) || 0),
    remarks: String(rec.remarks || '').trim(), status: 'CLOSED',
    createdBy: ME.email, createdAt: now,
  };
  if (row.rate !== '' && qty) row.amount = Math.round(row.rate * qty * 100) / 100;
  if (kind === 'ISSUE_TO_CUTTING' && String(rec.size || '').trim()) { row.size = String(rec.size).trim(); row.pieces = Number(rec.pieces) || 0; }
  try { await ptPut('pt_fabInvLedger/' + id, row); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  FAB.rows = (FAB.rows || []).concat([Object.assign({ _key: id }, row)]);
  renderFab();
  return '';
}

/** The dialog. The fabric list is the ledger's own — the factory buys what it buys. */
function fabEntryOpen(pre) {
  /* Opened from the toolbar it is handed a click; opened from a PO it is handed what to fill in. */
  pre = pre && typeof pre === 'object' && !pre.target ? pre : {};
  /* The lots a movement can come out of are listed with what is left in each, so the person entering
   * it does not have to remember which bale still has cloth on it. */
  const fabrics = [...new Set((FAB.rows || []).map(r => String(r.fabricType || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const vendors = voAllVendors();
  ptOpenDialog({
    title: 'Fabric entry',
    subtitle: 'Greige in · out for RFD · RFD back · out to cutting',
    note: 'Greige comes in from the mill, goes out to be processed and comes back as RFD, which is what '
      + 'the cutting table is issued. Metres out can never be more than metres in, and RFD coming back '
      + 'can never be more than what is out with that processor.',
    html: `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
      <label>What happened
        <select id="fbeKind">${FAB_ENTRY_KINDS.map(k => `<option value="${esc(k[0])}">${esc(k[1])}</option>`).join('')}</select></label>
      <label>Date <input id="fbeDate" type="date" value="${esc(attToday())}"></label>
      <label>Fabric <input id="fbeFab" list="fbeFabList" placeholder="e.g. CAMBRIC">
        <datalist id="fbeFabList">${fabrics.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <!-- THE LOT IS THE THING THAT TRAVELS. On a delivery it is the mill's own number, or blank to
           have one made; after that it is picked from the lots that still hold cloth. -->
      <label>Lot <input id="fbeLot" list="fbeLotList" placeholder="Mill's lot no, or leave blank on a delivery">
        <datalist id="fbeLotList"></datalist>
        <div id="fbeLotInfo" class="muted" style="font-size:11.5px;margin-top:3px"></div></label>
      <label data-fbe="cut">Size <input id="fbeSize" list="fbeSizeList" placeholder="e.g. 60x90">
        <datalist id="fbeSizeList">${fabSizes().map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label data-fbe="cut">Pcs <input id="fbePcs" type="number" step="1" min="1" placeholder="0"></label>
      <label><span id="fbeQtyLab">Metres</span> <input id="fbeQty" type="number" step="0.01" min="0" placeholder="0">
        <div id="fbeCons" class="muted" style="font-size:11.5px;margin-top:3px"></div></label>
      <label data-fbe="nocut">Who — mill, processor or department
        <input id="fbeCp" list="fbeCpList" placeholder="Name">
        <datalist id="fbeCpList">${vendors.map(v => `<option value="${esc(v.name || v.code)}">`).join('')}</datalist></label>
      <label data-fbe="nocut">Colour (RFD and printed only) <input id="fbeCol" placeholder="—"></label>
      <label data-fbe="nocut">Bill / challan <input id="fbeChallan" placeholder="Optional"></label>
      <label data-fbe="nocut">Against greige PO <input id="fbeOrd" placeholder="Optional — GPO-…"></label>
      <label data-fbe="nocut">Rate per metre <input id="fbeRate" type="number" step="0.01" min="0" placeholder="Optional"></label>
      <label style="grid-column:span 2">Remarks <input id="fbeRemarks" placeholder="Optional"></label>
    </div>`,
    saveLabel: 'Save entry',
    onSave: async () => {
      const v = {};
      ['fbeKind', 'fbeDate', 'fbeFab', 'fbeQty', 'fbeLot', 'fbeCp', 'fbeCol', 'fbeChallan', 'fbeRate', 'fbeRemarks', 'fbeOrd', 'fbeSize', 'fbePcs']
        .forEach(id => { const el = $(id); v[id] = el ? el.value : ''; });
      const cutting = v.fbeKind === 'ISSUE_TO_CUTTING';
      const err = await fabSave({ size: cutting ? v.fbeSize : '', pieces: cutting ? v.fbePcs : '', txnType: v.fbeKind, date: v.fbeDate, fabricType: v.fbeFab, qty: v.fbeQty,
        lot: v.fbeLot, counterpartyName: v.fbeCp, colour: v.fbeCol, challan: v.fbeChallan, rate: v.fbeRate,
        remarks: v.fbeRemarks, orderNo: v.fbeOrd, state: v.fbeKind === 'ISSUE_TO_CUTTING' ? 'RFD' : '' });
      if (!err && $('fbView').value === 'po') renderGpo();
      return err;
    },
  });
  const put = (id, v) => { const el = $(id); if (el && v != null && v !== '') el.value = v; };
  put('fbeKind', pre.kind); put('fbeFab', pre.fabric); put('fbeQty', pre.qty); put('fbeCp', pre.cp); put('fbeOrd', pre.orderNo);
  /* The lots on offer follow what is being done and to which cloth. */
  ['fbeFab', 'fbeKind'].forEach(id => {
    const el = $(id);
    if (el) { el.addEventListener('input', fabEntryLots); el.addEventListener('change', fabEntryLots); }
  });
  /* RFD TO CUTTING: the metres follow the fabric, size and pieces until somebody types their own. */
  ['fbeFab', 'fbeKind', 'fbeSize', 'fbePcs'].forEach(id => {
    const el = $(id);
    if (el) { el.addEventListener('input', fabEntryCut); el.addEventListener('change', fabEntryCut); }
  });
  const q = $('fbeQty');
  if (q) q.addEventListener('input', () => { q.dataset.typed = q.value ? '1' : ''; fabEntryCut(); });
  fabEntryLots();
  fabEntryCut();
}

/**
 * Offer the lots of the fabric that has been typed, for the movement that has been chosen.
 *
 * The whole list of lots is useless once a factory has thirty of them; the four that belong to this
 * cloth, with what is left in each, is the question being answered.
 */
function fabEntryLots() {
  const fab = ($('fbeFab') || {}).value || '';
  const kind = ($('fbeKind') || {}).value || '';
  const want = FAB_KIND_WANT[kind] || '';
  const lots = fabLotsOfFabric(fab, want);
  const dl = $('fbeLotList');
  if (dl) dl.innerHTML = lots.map(g => `<option value="${esc(g.lot)}">${
    esc(g.bill ? 'bill ' + g.bill + ' · ' : '')}${nf(Math.round(
      want === 'out' ? g.withProcessor : want === 'rfd' ? g.rfdLeft : g.greigeLeft))} m left</option>`).join('');
  const info = $('fbeLotInfo');
  if (!info) return;
  if (kind === 'PURCHASE_RFD' || kind === 'OPENING_RFD') {
    info.textContent = 'This opens a lot of its own. Leave it blank and one will be numbered.';
    return;
  }
  if (kind === 'RECEIVE_GREIGE') {
    const all = fabLotsOfFabric(fab, '');
    info.textContent = !fab ? 'A delivery opens a new lot. Leave this blank and one will be numbered.'
      : `${esc(fab)} already has ${nf(all.length)} lot(s). This delivery opens another.`;
    return;
  }
  if (kind === 'ISSUE_TO_CUTTING' && fab && !lots.length) {
    info.textContent = 'Optional — leave it blank and it comes off ' + fab + '\'s RFD stock.';
    return;
  }
  info.textContent = !fab ? 'Type the fabric first, and its lots will be offered here.'
    : (lots.length ? `${nf(lots.length)} lot(s) of ${esc(fab)} to choose from.`
      : `No lot of ${esc(fab)} has anything to ${kind === 'RECEIVE_RFD' ? 'come back' : 'give'}.`);
}

/** Every size in the master database, smallest first, for the RFD-to-cutting box. */
function fabSizes() {
  const seen = new Map();
  (PTG.mdb || []).forEach(m => { const z = String((m && m.size) || '').trim(); if (z && !seen.has(z.toLowerCase())) seen.set(z.toLowerCase(), z); });
  const n = z => (String(z).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  return [...seen.values()].sort((a, b) => { const x = n(a), y = n(b); return (x[0] || 0) - (y[0] || 0) || (x[1] || 0) - (y[1] || 0) || a.localeCompare(b); });
}

/** Show only what "RFD to cutting" asks for, and work its metres out. */
function fabEntryCut() {
  const cutting = (($('fbeKind') || {}).value || '') === 'ISSUE_TO_CUTTING';
  document.querySelectorAll('[data-fbe]').forEach(el => el.classList.toggle('hide', el.getAttribute('data-fbe') === (cutting ? 'nocut' : 'cut')));
  const lab = $('fbeQtyLab'); if (lab) lab.textContent = cutting ? 'Mtr consumption' : 'Metres';
  const info = $('fbeCons'); if (!info) return;
  if (!cutting) { info.textContent = ''; return; }
  const fab = (($('fbeFab') || {}).value || '').trim(), size = (($('fbeSize') || {}).value || '').trim();
  const pcs = parseInt(($('fbePcs') || {}).value, 10) || 0;
  if (!fab || !size) { info.textContent = 'Pick the fabric and the size — the metres are worked out from them.'; return; }
  const p = fabCutPerPiece(fab, size);
  if (p.why) { info.className = 'err'; info.textContent = 'Cannot work it out: ' + p.why + '. Type the metres.'; return; }
  info.className = 'muted';
  const should = Math.round(p.metres * pcs * 100) / 100;
  const q = $('fbeQty');
  if (q && !q.dataset.typed) q.value = pcs > 0 ? should : '';
  const typed = parseFloat(q && q.value);
  info.textContent = `${p.metres} m a piece (${size} + 2", ${p.across} across ${p.widthIn}" cloth)`
    + (pcs > 0 ? ` × ${nf(pcs)} = ${nf(should)} m` : '')
    + (pcs > 0 && isFinite(typed) && Math.abs(typed - should) > 0.005 ? ` · typed ${nf(typed)} m` : '');
}

$('fbEntry').onclick = fabEntryOpen;
/* THE GUIDE lives beside the app (/guide/), in English and Hindi, opened at the part this screen is about. */
$('fbGuide').onclick = () => window.open('/guide/#' + ($('fbView').value === 'po' ? 'po' : 'fab'), '_blank');
/* A VENDOR GETS THE VENDOR GUIDE (Ravi, 2026-09-26: "vendor ko bhi guide me sare action dikh rahe h"). The browser is
 * marked either way, so the full guide sends a vendor on to theirs and lets staff stay. */
$('guideBtn').onclick = () => {
  const v = spIsVendor();
  try { localStorage.setItem('guideRole', v ? 'vendor' : 'staff'); } catch (e) { /* the guide still opens */ }
  window.open(v ? '/guide/vendor/' : '/guide/' + (TAB_NOW ? '#' + TAB_NOW : ''), '_blank');
};

