/* ===== ORDER-DRIVEN RFD (Ravi, 2026-09-26) =====
 *
 * "mene vendor ko order diya … uske basis par rfd department ke pas information pahuch jani chahiye … vendor apna
 * goods accept kar pay … unke window me unka ek rfd store bhi ban jay … rfd department puri tarah check kar pay ki
 * usne kitna mal bhej diya or kitna bhejna baki h."
 *
 * From RFD_TRACK_FROM the ORDER is the requirement. The store sends against what the order needs, size by size and
 * cloth by cloth, without waiting to be asked; the printer confirms each lot as it arrives; and what the printer holds
 * of the company's cloth is worked out — what they said they had, plus what they confirmed, less what they delivered
 * back (pieces of a size; or, for a piece sent back off running cloth, the recipe's metres a piece). Orders placed
 * before that date keep the ask-and-answer flow above: Ravi chose a clean start over counting every printer's floor.
 *
 * Nothing new is written anywhere new. A store send is an ordinary requirement (marked `office`) plus the same
 * Mark sent as before; a receipt sits inside the printer's own branch of the order, beside their asks, which is the
 * one place they may write. The store itself is read, never stored. */
const RFD_TRACK_FROM = '2026-09-26';
const rfdTracked = o => !!o && o.rfdTrack !== false
  && (o.rfdTrack === true || voWhenMs(o) >= Date.parse(RFD_TRACK_FROM + 'T00:00:00'));
/* A lot is known by the moment it was recorded — the mirror keeps the last ten sends, so an index would move. */
const rfdRecvKey = at => String(at || '').replace(/[^0-9A-Za-z]/g, '') || 'x';
const rfdRecvOf = r => Object.values((r && r.recv) || {}).filter(Boolean);
const rfdRecvQty = r => rfdRound(rfdRecvOf(r).reduce((a, x) => a + (parseFloat(x.qty) || 0), 0));
const rfdRecvLot = (r, at) => ((r && r.recv) || {})[rfdRecvKey(at)] || null;

/** One order, one row per size (pieces) or cloth (metres): what it needs, and where that stands. */
function rfdOrderLedger(o) {
  if (!o) return [];
  const rejected = r => { const d = rfdDecisionOf(r.id); return !!(d && d.stage === 'rejected'); };
  const reqs = rfdReqsOf(o).filter(r => !rejected(r));
  const out = [];
  rfdSizeRaw(o).forEach(g => out.push(rfdLedgerRow(o, { key: g.stockKey, unit: 'pcs', what: g.size || g.key, item: g.what, need: g.pieces,
    reqs: reqs.filter(r => rfdUnit(r) === 'pcs' && g.skus.some(x => obUC(x.sku) === obUC(r.sku))) })));
  rfdFabrics(o).forEach(f => {
    const key = rfdFabKey(f.fabric);
    out.push(rfdLedgerRow(o, { key, unit: 'm', what: f.fabric, item: 'Running cloth', need: f.metres,
      reqs: reqs.filter(r => rfdUnit(r) === 'm' && rfdFabKey(r.fabric) === key) }));
  });
  return out;
}
function rfdLedgerRow(o, x) {
  const withYou = rfdRound(rfdStockHere(o, x.key));
  /* Sent as each side can read it: the decision at the office, the mirror in the portal. */
  const sent = rfdRound(x.reqs.reduce((a, r) => a + rfdSentSeen(r), 0));
  const recv = rfdRound(x.reqs.reduce((a, r) => a + rfdRecvQty(r), 0));
  const asked = rfdRound(x.reqs.reduce((a, r) => a + rfdWant(r), 0));
  return Object.assign(x, { withYou, sent, recv, asked,
    toSend: rfdRound(Math.max(0, x.need - withYou - sent)), onWay: rfdRound(Math.max(0, sent - recv)) });
}

/** Cloth the printer has used up, read off the deliveries accepted back: pieces of a size, or metres of a cloth. */
function rfdOrderUsed(o) {
  const m = new Map();
  const add = (k, q) => { if (k && q > 0) m.set(k, rfdRound((m.get(k) || 0) + q)); };
  voLines(o || {}).forEach(l => {
    if (!l || l.cancelled) return;
    const got = voConfirmed(l);
    if (!(got > 0)) return;
    /* A running line: printed metres came back, and that is the cloth gone. */
    if (voKind(l) === 'running' || o.orderType === 'running') { add(rfdFabKey(String(l.fabricType || '').trim()), got); return; }
    /* Cut here and sent as pieces: a piece back is a piece used. */
    if (rfdIssueAs(o, l) === 'cut') { const p = rfdPieceOf(o, l.sku); add(p ? rfdStockKey(p) : '', got); return; }
    /* Handed running cloth, sends pieces back: the recipe says how much cloth each piece took. */
    const n = rfdLineNeed(o, l), qty = parseFloat(l.qty) || 0;
    if (n.fabric && n.metres > 0 && qty > 0) add(rfdFabKey(n.fabric), got * (n.metres / qty));
  });
  return m;
}

/** What one printer holds of the company's cloth on the orders tracked this way: had + received − used, per size or cloth. */
function rfdStoreOf(code, orders) {
  const src = orders || ((VP.code && obUC(VP.code) === obUC(code) && VP.rows) ? VP.rows : VO.rows);
  const list = (src || []).filter(o => o && obUC(o.vendorCode || VP.code) === obUC(code) && rfdTracked(o)
    && !o.cancelled && ['Cancelled', 'Draft'].indexOf(o.status || 'Placed') < 0);
  const by = new Map();
  const row = (key, what, item) => {
    if (!by.has(key)) by.set(key, { key, unit: rfdKeyUnit(key), what, item, had: 0, recv: 0, sent: 0, used: 0, orders: new Set() });
    return by.get(key);
  };
  list.forEach(o => {
    rfdOrderLedger(o).forEach(x => { const e = row(x.key, x.what, x.item); e.had += x.withYou; e.recv += x.recv; e.sent += x.sent; e.orders.add(o.id); });
    rfdOrderUsed(o).forEach((q, key) => { const e = row(key, key.replace(/^[PM]__/, '').replace(/_/g, ' '), ''); e.used += q; e.orders.add(o.id); });
  });
  return [...by.values()].map(e => Object.assign(e, { orders: e.orders.size, had: rfdRound(e.had), recv: rfdRound(e.recv),
    sent: rfdRound(e.sent), used: rfdRound(e.used), onWay: rfdRound(Math.max(0, e.sent - e.recv)), inHand: rfdRound(e.had + e.recv - e.used) }))
    .sort((a, b) => (a.unit === b.unit ? String(a.what).localeCompare(String(b.what), undefined, { numeric: true }) : (a.unit === 'pcs' ? -1 : 1)));
}

/**
 * The store sends against the ORDER: first onto what the printer already asked for and is still owed, then on a
 * requirement raised here for the rest. Never more than the order still needs — beyond that is the printer's ask
 * and an approval, as before.
 */
async function rfdOfficeSend(o, key, qty, dateIso, note) {
  if (!rfdCanSend()) return RFD_NO_SEND;
  if (!o) return 'That order is no longer here.';
  const row = rfdOrderLedger(o).find(x => x.key === key);
  if (!row) return 'That size or cloth is not on this order.';
  const q = parseFloat(qty) || 0;
  if (!(q > 0)) return row.unit === 'pcs' ? 'How many pieces are going out?' : 'How many metres are going out?';
  if (row.unit === 'pcs' && Math.round(q) !== q) return 'Pieces have to be a whole number.';
  if (q > row.toSend) return 'Only ' + nf(row.toSend) + ' ' + row.unit + ' of ' + row.what + ' is still to go out on ' + (o.orderNo || o.id)
    + (row.withYou ? ' — ' + nf(row.withYou) + ' ' + row.unit + ' is already with them.' : '.');
  let left = q;
  const plan = [];
  row.reqs.filter(r => rfdStage(r, o) !== 'pending')
    .map(r => ({ id: r.id, room: rfdRound(Math.max(0, rfdToSend(r, o) - rfdSentQty(r.id))) }))
    .filter(x => x.room > 0)
    .forEach(x => { if (left <= 0) return; const take = rfdRound(Math.min(left, x.room)); plan.push({ id: x.id, qty: take }); left = rfdRound(left - take); });
  if (left > 0) {
    const asks = row.unit === 'pcs' ? rfdSizePlan(o, key, left).asks : [{ unit: 'm', fabric: row.what, metres: left }];
    if (!asks.length) return 'Could not share ' + nf(left) + ' ' + row.unit + ' over the colours of this size.';
    const why = String(note || '').trim() || 'Sent by the store against the order';
    const recs = asks.map((a, i) => Object.assign(rfdRecord(o, a, why, i + 1),
      { office: true, vendorCode: o.vendorCode || VP.code || '', vendorName: voName(o.vendorCode) || '' }));
    const base = 'pt_vendorOrders/' + (o.vendorCode || VP.code) + '/' + o.id + '/rfdReqs/';
    const patch = {};
    recs.forEach(r => { patch[base + r.id] = r; });
    try { await ptPatch(patch); } catch (e) { return 'Not saved: ' + (e.message || e); }
    rfdKeep(o, recs);
    recs.forEach(r => plan.push({ id: r.id, qty: rfdWant(r) }));
  }
  let done = 0;
  for (const p of plan) {
    const err = await rfdMarkSent(p.id, p.qty, dateIso, note);
    if (err) return (done ? nf(done) + ' ' + row.unit + ' recorded, then stopped: ' : '') + err;
    done = rfdRound(done + p.qty);
  }
  return '';
}

/** The store's Send dialog against an order — the RFD screen and Fabric flow open the same one. */
function rfdOfficeSendOpen(oid, key, after) {
  const o = (VO.rows || []).find(x => x && x.id === oid); if (!o) return;
  const x = rfdOrderLedger(o).find(r => r.key === key); if (!x) return;
  /* RFD ON THE SHELF, said before the cloth is promised (Fabric flow, 2026-09-26): short is a warning, not a stop. */
  let shelf = null;
  try { if (x.unit === 'm' && FAB.rows) shelf = Math.round(Object.values(fabBalances(fabAll())).filter(b => b.state === 'RFD' && fabKey(b.fabricType) === fabKey(x.what)).reduce((a, b) => a + b.qty, 0) * 10) / 10; } catch (e) { shelf = null; }
  return ptOpenDialog({
    title: 'Send ' + x.what + ' to ' + (voName(o.vendorCode) || o.vendorCode),
    subtitle: nf(x.toSend) + ' ' + x.unit + ' still to go out against ' + (o.orderNo || o.id)
      + (x.withYou ? ' · ' + nf(x.withYou) + ' ' + x.unit + ' already with them' : '')
      + (shelf != null ? ' · ' + nf(shelf) + ' m of RFD on the shelf' : ''),
    note: (shelf != null && shelf < x.toSend ? 'ONLY ' + nf(shelf) + ' m OF RFD IS ON THE SHELF against ' + nf(x.toSend) + ' m to send — check the processor or the greige first. ' : '')
      + 'Recorded against the order itself — no ask needed. The printer sees the lot in their portal and confirms it when it arrives.',
    fields: [{ key: 'qty', label: (x.unit === 'pcs' ? 'Pieces' : 'Metres') + ' going out', type: 'number', min: 0, step: x.unit === 'pcs' ? '1' : '0.1', value: x.toSend },
             { key: 'date', label: 'Date it goes out', type: 'date', value: ptIsoDate(new Date().toISOString()) },
             { key: 'note', label: 'Remarks', span: true, value: '' }],
    saveLabel: 'Record it',
    onSave: async v => { const err = await rfdOfficeSend(o, key, v.qty, v.date, v.note); if (!err && after) after(); return err; },
  });
}

/** The printer confirms a lot arrived. Their own branch of the order; the office reads it from there. */
async function rfdRecvSave(o, reqId, at, qty, dateIso) {
  if (!o) return 'That order is no longer here.';
  const r = (o.rfdReqs || {})[reqId];
  if (!r) return 'That requirement is gone — press Refresh.';
  const lot = ((r.shown && Array.isArray(r.shown.sends)) ? r.shown.sends : []).find(x => x && x.at === at)
    || rfdSends(rfdDecisionOf(reqId)).find(x => x && x.at === at);
  if (!lot) return 'That lot is not on the list any more — press Refresh.';
  if (rfdRecvLot(r, at)) return 'That lot is already confirmed.';
  const u = rfdUnit(r), q = parseFloat(qty) || 0;
  if (!(q > 0)) return 'How much of it arrived?';
  if (u === 'pcs' && Math.round(q) !== q) return 'Pieces have to be a whole number.';
  if (q > (parseFloat(lot.qty) || 0) + 1e-9) return 'That lot was ' + nf(rfdRound(lot.qty)) + ' ' + u + ' — more than was sent cannot have arrived.';
  const m = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? m[3] + '/' + m[2] + '/' + m[1] : (dateIso || voTodayDMY());
  const rec = { qty: u === 'pcs' ? Math.round(q) : rfdRound(q), sent: rfdRound(lot.qty), date, at: new Date().toISOString(), by: ME.email, lotAt: at };
  const code = o.vendorCode || VP.code;
  try { await ptPut('pt_vendorOrders/' + code + '/' + o.id + '/rfdReqs/' + reqId + '/recv/' + rfdRecvKey(at), rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const next = Object.assign({}, r, { recv: Object.assign({}, r.recv || {}, { [rfdRecvKey(at)]: rec }) });
  o.rfdReqs = Object.assign({}, o.rfdReqs, { [reqId]: next });
  VP.rows = (VP.rows || []).map(x => (x && x.id === o.id ? o : x));
  return '';
}

/* CLOTH GOES TO PRINTERS. A filling house or an embroiderer is sent finished covers; their orders carry SKUs with a
 * consumption too, and on 26 Sep a filler's order came up wanting 160 m of Voil. Their orders keep the ask flow. */
const rfdVendorPrints = code => /print/i.test(voCatOf(code));
/** Every tracked, open order of every printer, one row per size or cloth — the store's worklist. */
function rfdOrderRows() {
  const out = [];
  (VO.rows || []).filter(o => o && rfdTracked(o) && rfdVendorPrints(o.vendorCode) && !o.cancelled && ['Received', 'Cancelled', 'Draft'].indexOf(o.status || 'Placed') < 0)
    .forEach(o => rfdOrderLedger(o).forEach(x => out.push(Object.assign(x, { _order: o, orderId: o.id, orderNo: o.orderNo || o.id,
      vendorCode: o.vendorCode, vendorName: voName(o.vendorCode), placed: voWhenMs(o) }))));
  return out.sort((a, b) => (b.placed - a.placed) || String(a.orderNo).localeCompare(String(b.orderNo))
    || (a.unit === b.unit ? 0 : (a.unit === 'pcs' ? -1 : 1)));
}

/* "vendor ko order mil gya" — Ravi, 2026-09-26: "pahle acknowledge button tha". It still is: the printer's Orders tab
 * moves the order Placed → Acknowledged → In Production (vpFlow). The worklist reads THAT, not a second button. */
const voAckOf = o => (o && o.status && ['Placed', 'Draft'].indexOf(o.status) < 0
  ? { at: o.vendorUpdatedAt || o.staffUpdatedAt || '', status: o.status } : null);

/** The two order-driven readings of the office screen: by order (the worklist) and by printer (the store). */
function renderRfdLedger(view) {
  const f = rfdFilters(), q = f.q;
  const vendors = [...new Set((VO.rows || []).filter(o => o && rfdTracked(o)).map(o => o.vendorCode).filter(c => c && rfdVendorPrints(c)))];
  ptFillSelect('rfdVendor', vendors.map(c => [c, voName(c) || c]), 'All printers');
  const z = (n, u) => (n ? nf(n) + ' ' + u : '<span class="muted">—</span>');
  const two = (list, k) => {
    const p = rfdRound(list.filter(x => x.unit === 'pcs').reduce((a, x) => a + (x[k] || 0), 0));
    const m = rfdRound(list.filter(x => x.unit === 'm').reduce((a, x) => a + (x[k] || 0), 0));
    return [p ? nf(p) + ' pcs' : '', m ? nf(m) + ' m' : ''].filter(Boolean).join(' · ') || '—';
  };
  const kpi = (name, tiles) => `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname">${name}</span>
    <span class="kpiwhen">orders from ${esc(RFD_TRACK_FROM)} · read live${RFD.at ? ' · ' + esc(RFD.at) : ''}</span></div><div class="metrics">${tiles}</div></div>`;
  const tile = (v, l, c) => `<div class="metric"><div class="v"${c ? ' style="color:' + c + '"' : ''}>${v}</div><div class="l">${l}</div></div>`;

  if (view === 'order') {
    const all = rfdOrderRows();
    const rows = all.filter(x => (!f.vend || String(x.vendorCode) === f.vend)
      && (!q || [x.orderNo, x.vendorName, x.vendorCode, x.what, x.item].join(' ').toLowerCase().indexOf(q) >= 0));
    RFD.shown = rows;
    $('rfdKpis').innerHTML = kpi('RFD by order', tile(nf(new Set(all.map(x => x.orderId)).size), 'Orders')
      + tile(two(all, 'need'), 'The orders need') + tile(two(all, 'withYou'), 'Already with the printers', '#7f6000')
      + tile(two(all, 'sent'), 'Sent', '#166534') + tile(two(all, 'recv'), 'Confirmed received')
      + tile(two(all, 'toSend'), 'Still to send', 'var(--bad)'));
    const head = '<thead><tr>' + ['Order', 'Printer', 'Placed', 'Accepted', 'What', 'Item', 'Needs', 'With them', 'Sent', 'Received', 'On the way', 'To send', '']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 6 && i <= 11 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('rfdTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(x => '<tr>'
      + `<td class="frz" style="text-align:left"><b>${esc(x.orderNo)}</b></td>`
      + `<td style="text-align:left">${esc(x.vendorName)}<div class="muted" style="font-size:10.5px">${esc(x.vendorCode)}</div></td>`
      + `<td>${x.placed ? esc(new Date(x.placed).toISOString().slice(0, 10)) : '<span class="muted">—</span>'}</td>`
      + `<td>${(a => a ? '<span class="pill pill-ok" title="' + esc(a.status) + '">✓ ' + esc(ptIsoDate(a.at) || a.status) + '</span>' : '<span class="pill pill-low" title="The printer has not pressed Acknowledge on this order in their portal yet">not yet</span>')(voAckOf(x._order))}</td>`
      + `<td style="text-align:left"><b>${esc(x.what)}</b></td><td style="text-align:left">${esc(x.item)}</td>`
      + `<td class="num" style="font-weight:700">${nf(x.need)} ${x.unit}</td>`
      + `<td class="num" style="color:#7f6000">${z(x.withYou, x.unit)}</td>`
      + `<td class="num" style="color:#166534">${z(x.sent, x.unit)}</td>`
      + `<td class="num">${z(x.recv, x.unit)}</td>`
      + `<td class="num" style="color:#7f6000">${z(x.onWay, x.unit)}</td>`
      + `<td class="num" style="font-weight:700;color:${x.toSend ? 'var(--bad)' : '#166534'}">${x.toSend ? nf(x.toSend) + ' ' + x.unit : 'done'}</td>`
      + `<td style="white-space:nowrap">${x.toSend > 0 && rfdCanSend()
        ? `<button class="jw-btn jw-primary" data-rfd-osend="${esc(x.orderId)}|${esc(x.key)}" style="padding:4px 10px;font-size:12px">Send ${nf(x.toSend)} ${x.unit}</button>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="13" class="muted" style="padding:16px">${all.length ? 'No order matches.'
        : 'No vendor order placed on or after ' + RFD_TRACK_FROM + ' yet. Orders from before keep the ask-and-answer flow — see Requirements raised.'}</td></tr>`) + '</tbody>';
    $('rfdMsg').className = 'muted';
    $('rfdMsg').textContent = nf(rows.length) + ' line(s) on ' + nf(new Set(rows.map(x => x.orderId)).size) + ' order(s)'
      + ' · what an order needs comes from its own lines · With them is the printer\'s own count · Received is what the printer confirmed'
      + (rfdCanSend() ? '' : ' · you may look, not send');
    return;
  }

  const store = [];
  vendors.filter(c => !f.vend || String(c) === f.vend)
    .forEach(c => rfdStoreOf(c).forEach(x => store.push(Object.assign(x, { vendorCode: c, vendorName: voName(c) || c }))));
  const rows = store.filter(x => !q || [x.vendorName, x.vendorCode, x.what, x.item].join(' ').toLowerCase().indexOf(q) >= 0);
  RFD.shown = rows;
  $('rfdKpis').innerHTML = kpi('Company cloth with the printers', tile(nf(new Set(store.map(x => x.vendorCode)).size), 'Printers')
    + tile(two(store, 'recv'), 'Confirmed received', '#166534') + tile(two(store, 'onWay'), 'On the way', '#7f6000')
    + tile(two(store, 'used'), 'Delivered back') + tile(two(store, 'inHand'), 'With them now'));
  const head = '<thead><tr>' + ['Printer', 'What', 'Item', 'Orders', 'Had', 'Received', 'On the way', 'Delivered back', 'With them now']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 3 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('rfdTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(x => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(x.vendorName)}<div class="muted" style="font-size:10.5px">${esc(x.vendorCode)}</div></td>`
    + `<td style="text-align:left"><b>${esc(x.what)}</b></td><td style="text-align:left">${esc(x.item || (x.unit === 'm' ? 'Running cloth' : ''))}</td>`
    + `<td class="num">${nf(x.orders)}</td><td class="num">${z(x.had, x.unit)}</td>`
    + `<td class="num" style="color:#166534">${z(x.recv, x.unit)}</td><td class="num" style="color:#7f6000">${z(x.onWay, x.unit)}</td>`
    + `<td class="num">${z(x.used, x.unit)}</td>`
    + `<td class="num" style="font-weight:700${x.inHand < 0 ? ';color:var(--bad)' : ''}" title="${x.inHand < 0 ? 'More came back than went out — a send was not recorded, or the count is short' : ''}">${nf(x.inHand)} ${x.unit}</td></tr>`).join('')
    : '<tr><td colspan="9" class="muted" style="padding:16px">Nothing tracked yet — the store starts with orders placed on or after ' + RFD_TRACK_FROM + '.</td></tr>') + '</tbody>';
  $('rfdMsg').className = 'muted';
  $('rfdMsg').textContent = nf(rows.length) + ' line(s) · Had is the printer\'s own count · Received is what they confirmed · Delivered back is read off the deliveries accepted (a piece sent back off running cloth counts the recipe\'s metres a piece)';
}

function rfdStage(r, o) {
  if (!r) return '';
  const d = rfdDecisionOf(r.id);
  if (d && d.stage === 'rejected') return 'rejected';
  const want = rfdWant(r);
  if (want > 0 && rfdSentQty(r.id) >= want) return 'sent';
  /* HELD IN FULL, or sent up to what was not held: nothing more is to go out. */
  if (want > 0 && (d ? d.stage !== 'pending' : true)) {
    const toSend = rfdToSend(r, o);
    if (toSend < want && rfdSentQty(r.id) >= toSend) return 'sent';
  }
  if (d && d.stage === 'approved') return 'approved';
  if (d && d.stage === 'pending') return 'pending';
  return rfdAuto(r, o) ? 'approved' : 'pending';
}
/** Is this one covered by its own order — that is, did nobody have to agree to it? */
function rfdAuto(r, o) {
  if (!r) return false;
  const d = rfdDecisionOf(r.id);
  /* RAISED BY THE STORE ITSELF, against the order, for what it is about to send — nobody has to agree to it, and the
   * decision record its own Mark sent leaves behind does not make it somebody's answer. */
  if (r.office === true) return !(d && d.stage === 'rejected');
  if (d && (d.stage === 'approved' || d.stage === 'rejected')) return false;   // a person answered it
  const order = o || rfdOrderOf(r);
  if (!order) return false;                    // no order to measure against is not a yes
  /* Measured against what was left WHEN IT WAS RAISED, not against what is left now — and against
   * the ceiling kept in ITS OWN UNIT. Pieces of a size and metres of a fabric are separate pools
   * since the cloth behind a cut piece stopped being counted as cloth as well. */
  return rfdUnit(r) === 'pcs'
    ? rfdWant(r) <= rfdPcsAllowed(order, r.sku, r).left
    : rfdWant(r) <= rfdAllowed(order, r.fabric, r).left;
}
const RFD_STAGE = {
  pending: { label: 'Waiting for approval', pill: 'pill-low' },
  approved: { label: 'Approved', pill: 'pill-ok' },
  sent: { label: 'Fabric sent', pill: 'pill-ok' },
  rejected: { label: 'Refused', pill: 'pill-out' },
};

/** The vendor order a request was raised against, from whichever list this screen has loaded. */
function rfdOrderOf(r) {
  if (!r) return null;
  const mine = (VP.rows || []).find(o => o && o.id === r.orderId);
  if (mine) return mine;
  return (VO.rows || []).find(o => o && o.id === r.orderId
    && (!r.vendorCode || String(o.vendorCode) === String(r.vendorCode))) || null;
}

/* ---- raising one (the printer) ---- */

async function rfdSubmit(o, fabric, metres, note) {
  if (!o) return 'That order is no longer here.';
  const fab = String(fabric || '').trim();
  if (!fab) return 'Pick which fabric you need.';
  const want = parseFloat(metres) || 0;
  if (!(want > 0)) return 'How many metres do you need?';
  const cap = rfdAllowed(o, fab);
  if (!(cap.need > 0)) return fab + ' is not sent to you as cloth on this order.';
  return rfdWrite(o, { unit: 'm', fabric: fab, metres: want }, note);
}

/**
 * The same requirement, asked the way a cut order is actually worked: so many pieces of a size.
 *
 * The pieces are converted here and BOTH are stored — the pieces as asked, the metres they come to.
 * Metres are the currency every ceiling is counted in and the unit the store issues in, so there is
 * one number underneath; the pieces ride along so that every screen afterwards can say "39 pcs of
 * 60X60" instead of a bare 62.4 that the printer then has to translate back.
 */
async function rfdSubmitPcs(o, sku, pieces, note) {
  if (!o) return 'That order is no longer here.';
  const line = rfdPieceOf(o, sku);
  if (!line) return 'Pick which size you need.';
  const want = parseFloat(pieces) || 0;
  if (!(want > 0)) return 'How many pieces do you need?';
  /* Half a tablecloth is not a thing anybody can cut or send. */
  if (Math.round(want) !== want) return 'Pieces have to be a whole number.';
  /* THE PIECES ARE THE REQUIREMENT. The metres ride along as an estimate of what will have to be cut
   * to make them, because the store still needs cloth to cut from — but nothing counts, checks or
   * issues in metres for one of these. */
  return rfdWrite(o, { unit: 'pcs', pieces: want, sku: line.sku, size: line.size,
    what: line.what, colour: line.colour, fabric: line.fabric,
    metres: line.per ? rfdRound(want * line.per) : 0 }, note);
}

/**
 * One record, built the same way whether it is asked for on its own or as part of a whole order.
 *
 * The sequence number is in the id because a whole-order ask builds a hundred of these inside one
 * millisecond, and Date.now() plus five random characters is a coincidence waiting to happen when
 * they arrive in a batch.
 */
function rfdRecord(o, ask, note, seq) {
  const now = new Date().toISOString();
  /* STRICTLY AFTER EVERYTHING THE ORDER ALREADY HOLDS, and padded so it sorts as a number. Two asks
   * in one millisecond used to tie on raisedAt and on this, and the five random characters decided
   * which was first — and so which one the ceiling covered. The suite caught it one run in two. */
  const n = Object.keys(o.rfdReqs || {}).length + (seq || 0);
  const id = 'rfd_' + Date.now() + '_' + String(n).padStart(4, '0') + '_' + Math.random().toString(36).slice(2, 7);
  return Object.assign({ id, orderId: o.id, orderNo: o.orderNo || o.id,
    vendorCode: VP.code || o.vendorCode || '', vendorName: VP.name || '',
    note: String(note || '').trim(), raisedBy: ME.email, raisedAt: now }, ask);
}

/** Put requirements on the order in memory, so the screen can answer without another read. */
function rfdKeep(o, recs) {
  const add = {};
  recs.forEach(r => { add[r.id] = r; });
  o.rfdReqs = Object.assign({}, o.rfdReqs || {}, add);
  VP.rows = (VP.rows || []).map(x => (x && x.id === o.id ? o : x));
}

/** One writer for both, so a metre ask and a piece ask cannot land in different shapes. */
async function rfdWrite(o, ask, note) {
  const rec = rfdRecord(o, ask, note, 0);
  try { await ptPut('pt_vendorOrders/' + (VP.code || o.vendorCode) + '/' + o.id + '/rfdReqs/' + rec.id, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  rfdKeep(o, [rec]);
  return '';
}

/**
 * Everything this order still needs, asked for in one go.
 *
 * This is the button a printer presses. Asking size by size down a list of 113 is not a workflow,
 * it is a punishment — and every one of those numbers is already known, because the order says what
 * it wants and the screen already shows what is left.
 *
 * WHAT IS LEFT, not what the order holds: a size already asked for is not asked for again, so
 * pressing it twice does nothing the second time rather than doubling the order. Each ask is for the
 * amount still uncovered, which means every one of them is inside its own ceiling and agreed on the
 * spot — a whole-order ask should not create an approval queue out of nothing.
 *
 * ONE WRITE. A hundred separate saves is a hundred round trips and a hundred chances to stop
 * halfway, leaving a printer with no way to tell what was asked and what was not.
 */
async function rfdSubmitOrder(o, note) {
  if (!o) return { err: 'That order is no longer here.' };
  const asks = [];
  rfdPieceLines(o).forEach(x => {
    const left = rfdPcsAllowed(o, x.sku).left;
    if (left > 0) asks.push({ unit: 'pcs', pieces: left, sku: x.sku, size: x.size,
      what: x.what, colour: x.colour, fabric: x.fabric,
      metres: x.per ? rfdRound(left * x.per) : 0 });
  });
  rfdFabrics(o).forEach(x => {
    const left = rfdAllowed(o, x.fabric).left;
    if (left > 0) asks.push({ unit: 'm', fabric: x.fabric, metres: left });
  });
  if (!asks.length) return { err: 'Everything this order needs has already been asked for.' };
  const recs = asks.map((a, i) => rfdRecord(o, a, note, i + 1));
  const base = 'pt_vendorOrders/' + (VP.code || o.vendorCode) + '/' + o.id + '/rfdReqs/';
  const patch = {};
  recs.forEach(r => { patch[base + r.id] = r; });
  try { await ptPatch(patch); }
  catch (e) { return { err: 'Not saved: ' + (e.message || e) }; }
  rfdKeep(o, recs);
  const pcs = rfdRound(recs.filter(r => rfdUnit(r) === 'pcs').reduce((a, r) => a + rfdWant(r), 0));
  const mtr = rfdRound(recs.filter(r => rfdUnit(r) === 'm').reduce((a, r) => a + rfdWant(r), 0));
  return { err: '', n: recs.length, pcs, mtr };
}

/** Take back one that has not been answered. A printer may only withdraw their own. */
async function rfdWithdraw(o, id) {
  if (!o) return 'That order is no longer here.';
  const r = rfdReqsOf(o).find(x => x.id === id);
  if (!r) return 'That requirement is gone.';
  if (rfdDecisionOf(id)) return 'That one has already been answered.';
  try { await ptPut('pt_vendorOrders/' + (VP.code || o.vendorCode) + '/' + o.id + '/rfdReqs/' + id, null); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const next = Object.assign({}, o.rfdReqs || {}); delete next[id];
  o.rfdReqs = next;
  VP.rows = (VP.rows || []).map(x => (x && x.id === o.id ? o : x));
  return '';
}

/* ---- answering one (staff) ---- */

/**
 * Write the decision, and mirror it where the printer can see it.
 *
 * The decision goes to pt_rfdDecisions, which a vendor cannot write. The mirror goes into their own
 * branch so the outcome shows up on their screen; it is never read back by this end, so a printer
 * rewriting it changes only what they themselves see.
 *
 * A FAILED MIRROR IS NOT A FAILED DECISION. The answer is recorded either way — the worst case is a
 * printer who has to be told on the phone, not a yes that never happened.
 */
async function rfdDecide(id, stage, note) {
  if (!rfdCanApprove()) return RFD_NO_APPROVE;
  const r = rfdFind(id);
  if (!r) return 'That requirement is gone — press Refresh.';
  if (stage !== 'approved' && stage !== 'rejected') return 'Approve it or refuse it.';
  const prev = rfdDecisionOf(id) || {};
  if (prev.stage === 'rejected' && stage === 'rejected') return 'That one is already refused.';
  if (rfdSentQty(id) > 0 && stage === 'rejected')
    return 'Fabric has already gone out against this one. Refusing it now would not bring the cloth back.';
  const now = new Date().toISOString();
  const rec = Object.assign({}, prev, {
    id, stage, note: String(note || '').trim(),
    by: ME.email, at: now,
    /* A snapshot, so the queue can be read and exported without loading every vendor's orders — and
     * so a request the printer later deletes still has its answer on record. */
    orderId: r.orderId, orderNo: r.orderNo, vendorCode: r.vendorCode, vendorName: r.vendorName,
    fabric: r.fabric, unit: rfdUnit(r), metres: parseFloat(r.metres) || 0,
    pieces: parseFloat(r.pieces) || 0, want: rfdWant(r), sku: r.sku || '', size: r.size || '',
    log: (prev.log || []).concat([{ at: now, by: ME.email, what: stage + (note ? ' — ' + note : '') }]),
  });
  try { await ptPut('pt_rfdDecisions/' + id, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  RFD.decisions = Object.assign({}, RFD.decisions || {}, { [id]: rec });
  await rfdMirror(r, rec);
  return '';
}

/** Hand cloth over, in metres, possibly in more than one go. */
async function rfdMarkSent(id, qty, dateIso, note) {
  if (!rfdCanSend()) return RFD_NO_SEND;
  const r = rfdFind(id);
  if (!r) return 'That requirement is gone — press Refresh.';
  const q = parseFloat(qty) || 0;
  if (!(q > 0)) return 'How many metres are going out?';
  const st = rfdStage(r);
  if (st === 'rejected') return 'That one was refused.';
  if (st === 'pending') return 'That one is still waiting for approval.';
  const want = rfdWant(r);
  const unit = rfdUnit(r);
  const held = rfdWithPrinter(r);
  const left = rfdRound(Math.max(0, want - held - rfdSentQty(id)));
  if (unit === 'pcs' && Math.round(q) !== q) return 'Pieces have to be a whole number.';
  if (q > left) return 'Only ' + nf(left) + ' ' + unit + ' of this requirement is still to go out'
    + (held ? ' — ' + nf(held) + ' ' + unit + ' of it is already with them.' : '.');
  // This database keeps dates day-first; writing the input's YYYY-MM-DD would break every reader.
  const m = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? m[3] + '/' + m[2] + '/' + m[1] : (dateIso || voTodayDMY());
  const now = new Date().toISOString();
  const prev = rfdDecisionOf(id) || {};
  const rec = Object.assign({}, prev, {
    id, stage: prev.stage || 'approved',
    orderId: r.orderId, orderNo: r.orderNo, vendorCode: r.vendorCode, vendorName: r.vendorName,
    fabric: r.fabric, unit, metres: r.metres || 0, pieces: r.pieces || 0, want, sku: r.sku || '', size: r.size || '',
    sends: rfdSends(prev).concat([{ qty: q, date, by: ME.email, at: now, note: String(note || '').trim() }]),
    log: (prev.log || []).concat([{ at: now, by: ME.email, what: 'sent ' + q + ' ' + unit + ' on ' + date }]),
  });
  try { await ptPut('pt_rfdDecisions/' + id, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  RFD.decisions = Object.assign({}, RFD.decisions || {}, { [id]: rec });
  await rfdMirror(r, rec);
  return '';
}

/** The copy a printer can read. Display only — nothing at this end ever reads it back. */
async function rfdMirror(r, rec) {
  if (!r || !r.vendorCode || !r.orderId || !r.id) return;
  /* THE LOTS, not only the total. "Do I have it" and "when did it come" are different questions, and
   * a printer being told 25 without being told when has to ring up to find out. Last ten only — a
   * receipt, not an archive. */
  const shown = { stage: rfdStage(r), note: rec.note || '', by: rec.by || '', at: rec.at || '',
    sent: rfdSentQty(r.id),
    sends: rfdSends(rec).slice(-10).map(x => ({ qty: parseFloat(x.qty) || 0, date: x.date || '', at: x.at || '' })) };
  try { await ptPut('pt_vendorOrders/' + r.vendorCode + '/' + r.orderId + '/rfdReqs/' + r.id + '/shown', shown); }
  catch (e) { /* the answer is recorded; only the printer's copy of it failed */ }
}

/* ---- reading them all (staff) ---- */

/** Every request on every order this account can see, newest first. */
function rfdRows() {
  const out = [];
  (VO.rows || []).forEach(o => rfdReqsOf(o).forEach(r => out.push(Object.assign({}, r, {
    orderId: r.orderId || o.id, orderNo: r.orderNo || o.orderNo || o.id,
    vendorCode: r.vendorCode || o.vendorCode, vendorName: r.vendorName || voName(o.vendorCode),
    _order: o, stage: rfdStage(r, o), auto: rfdAuto(r, o), sent: rfdSentQty(r.id),
    pcsTxt: rfdPcsTxt(r),
    /* What to call it on screen, worked out once here so the table, the dialogs and the export
     * cannot each decide differently. */
    unitTxt: rfdUnit(r) === 'pcs' ? (r.size || r.sku || 'cut pieces') : (r.fabric || 'cloth'),
    subTxt: rfdUnit(r) === 'pcs'
      ? ['cut pieces', r.what, r.colour, r.fabric ? 'from ' + r.fabric : ''].filter(Boolean).join(' · ')
      : 'running cloth',
  }))));
  return out.sort((a, b) => String(b.raisedAt || '').localeCompare(String(a.raisedAt || '')));
}
const rfdFind = id => rfdRows().find(r => r.id === id) || null;

async function ensureRfd(force) {
  /* LOADED MEANS THE SCREEN'S OWN LOAD RAN, not that the decisions are here. The sidebar badge reads
   * the decisions on the way in, and keying this on them left the screen with no orders and no
   * stock - "0 requirements" until somebody pressed Refresh. */
  if (!RFD.loaded || force) {
    RFD.busy = true; renderRfd();
    try { RFD.decisions = (await ptGet('pt_rfdDecisions')) || {}; RFD.err = ''; }
    catch (e) { RFD.err = e.message || String(e); RFD.decisions = RFD.decisions || {}; }
    /* AND WHAT EVERY PRINTER SAYS IS ON THEIR FLOOR. The office has to see it: it is a claim, it
     * comes off what gets sent, and it is stamped with who said it and when. */
    try { RFD.stock = (await ptGet('pt_rfdStock')) || {}; }
    catch (e) { RFD.stock = RFD.stock || {}; }
    /* The requirements themselves live inside the vendor orders, so there is nothing to show until
     * those are loaded. */
    if (VO.rows === null || force) { VO.rows = null; try { await ensureVo(); } catch (e) { /* shown as none */ } }
    if (!PTG.mdb) { try { await ptLoadGates(); } catch (e) { /* ceilings show as unknown */ } }
    RFD.at = ptStamp(); RFD.busy = false; RFD.loaded = true;
  }
  renderRfd();
}

/** The red count on the sidebar — only for somebody who can do something about it. */
function rfdBadge() {
  const el = $('rfdBadge'); if (!el) return;
  const n = rfdCanApprove() ? rfdRows().filter(r => r.stage === 'pending').length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}


/* ---- the screen ---- */

let RFD_KPI = '';

function rfdFilters() {
  const v = id => (($(id) || {}).value || '');
  return { st: v('rfdStage'), vend: v('rfdVendor'), fab: v('rfdFab'), q: v('rfdQ').trim().toLowerCase(),
    d1: v('rfdD1'), d2: v('rfdD2') };
}
function rfdApply(rows, f) {
  return rows.filter(r => {
    if (f.st && r.stage !== f.st) return false;
    if (RFD_KPI && r.stage !== RFD_KPI) return false;
    if (f.vend && String(r.vendorCode) !== f.vend) return false;
    if (f.fab && rfdKey(r.fabric) !== rfdKey(f.fab)) return false;
    if (!ptInRange(r.raisedAt, f.d1, f.d2)) return false;
    if (f.q && [r.orderNo, r.vendorName, r.vendorCode, r.fabric, r.note, r.raisedBy]
      .join(' ').toLowerCase().indexOf(f.q) < 0) return false;
    return true;
  });
}

const rfdWho = e => String(e || '').split('@')[0];

/**
 * One row, and the one thing it is really asking: is this inside the order or beyond it?
 *
 * The ceiling is spelled out on every row — needed, already asked, left — because "approve or not"
 * is not a judgement anybody can make from a number of metres alone. A row that asks for more than
 * the order covers says by how much, in the same cell.
 */
function rfdTable(rows) {
  /* The tick-all box sits in the first header, and only for somebody who can refuse. */
  const picking = rfdCanApprove() && rows.some(rfdRefusable);
  const head = '<thead><tr>'
    /* THE TICK BOX HAS ITS OWN COLUMN. Put inside the frozen Raised cell it pushed the date across
     * into the Printer column. */
    + (picking ? '<th style="width:34px;text-align:center"><input type="checkbox" id="rfdPickAll" title="Tick every requirement shown that can still be refused"></th>' : '')
    + ['Raised', 'Printer', 'Order', 'What they need', 'How much',
    'What the order covers', 'Stage', 'Sent', 'Note', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([4, 7].indexOf(i) >= 0 ? ' class="num"' : '')}>`
      + `${esc(h)}</th>`).join('') + '</tr></thead>';
  return head + '<tbody>' + rows.map(r => {
    const st = RFD_STAGE[r.stage] || { label: r.stage, pill: 'pill-low' };
    /* THE SAME SUM THE STAGE WAS DECIDED BY — what was left when this one was raised. Showing the
     * ceiling as it stands now would put "400 m beyond" against a row the app itself had approved. */
    /* Measured in the requirement's own unit — a size's ceiling is pieces of that size, a fabric's
     * is metres of that cloth. Reading a piece requirement against the cloth pool would find nothing
     * there, because a cut-issue line's cloth was never put in it. */
    const cap = r._order
      ? (rfdUnit(r) === 'pcs' ? rfdPcsAllowed(r._order, r.sku, r) : rfdAllowed(r._order, r.fabric, r))
      : null;
    const want = rfdWant(r);
    const held = r._order ? rfdWithPrinter(r, r._order) : 0;
    const over = cap ? rfdRound(want - cap.left) : 0;
    const u = rfdUnit(r);
    const unknown = r._order ? rfdOrderNeed(r._order).unknown.length : 0;
    return '<tr>'
      + (picking ? '<td style="text-align:center">' + (rfdRefusable(r) ? `<input type="checkbox" data-rfd-pick="${esc(r.id)}"${RFD_PICK.has(r.id) ? ' checked' : ''}>` : '') + '</td>' : '')
      + `<td class="frz" style="text-align:left">${esc(ptIsoDate(r.raisedAt) || '')}`
      + `<div class="muted" style="font-size:10.5px">${esc(rfdWho(r.raisedBy))}</div></td>`
      + `<td style="text-align:left">${esc(r.vendorName || voName(r.vendorCode))}`
      + `<div class="muted" style="font-size:10.5px">${esc(r.vendorCode)}</div></td>`
      + `<td style="text-align:left">${esc(r.orderNo)}</td>`
      /* WHAT THEY NEED, in the words they need it in: a size when it goes out cut, a fabric when it
       * goes out as cloth. A Tablecloth printer asked for thirty 60x60 pieces; answering that with
       * "48 m of Sheeting 62" makes the office translate it back before it can do anything. */
      + `<td style="text-align:left">${esc(r.unitTxt)}`
      + (r.subTxt ? `<div class="muted" style="font-size:10.5px">${esc(r.subTxt)}</div>` : '')
      + '</td>'
      /* ASKED, WITH THEM, TO SEND. The ask stays as they raised it; the office works from the last. */
      + (held > 0
        ? `<td class="num"><div class="muted" style="font-size:11px">${esc(rfdQtyTxt(r))} asked</div>`
          + `<div style="font-size:11px;color:#7f6000">− ${nf(held)} ${u} with them</div>`
          + `<div style="font-weight:700">${nf(rfdRound(Math.max(0, want - held)))} ${u} to send</div></td>`
        : `<td class="num" style="font-weight:700">${esc(rfdQtyTxt(r))}</td>`)
      /* THE WHOLE DECISION, IN ONE CELL. Not a tooltip: the person answering this is deciding
       * whether to give away cloth, and the sum behind the answer belongs on the row. */
      /* TWO SHORT LINES, NOT FOUR: the figures on one, the verdict under it, both small. */
      + `<td style="text-align:left;white-space:normal;min-width:190px;max-width:240px;font-size:12.5px;line-height:1.35">${cap
        ? `<span class="muted">needs</span> <b>${nf(cap.need)}</b> · <span class="muted">asked before</span> <b>${nf(cap.used)}</b> ${u}`
          + `<div${over > 0 ? ' style="color:var(--bad);font-weight:600"' : ' style="color:#166534"'}>`
          + (over > 0 ? nf(over) + ' ' + u + ' beyond what this order covers' : 'inside what this order covers') + '</div>'
          + (unknown ? `<div class="muted" style="font-size:10.5px">${nf(unknown)} line(s) on this order could not be worked out</div>` : '')
        : '<span class="muted">the order is not loaded</span>'}</td>`
      + `<td><span class="pill ${st.pill}">${esc(st.label)}</span>`
      + (r.auto ? '<div class="muted" style="font-size:10.5px">nobody had to agree</div>' : '') + '</td>'
      + `<td class="num">${r.sent ? nf(rfdRound(r.sent)) + ' ' + u : '<span class="muted">&mdash;</span>'}</td>`
      + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.note) || '<span class="muted">&mdash;</span>'}`
      + (rfdDecisionOf(r.id) && rfdDecisionOf(r.id).note
        ? `<div class="muted" style="font-size:10.5px">${esc(rfdWho(rfdDecisionOf(r.id).by))}: ${esc(rfdDecisionOf(r.id).note)}</div>` : '')
      + '</td>'
      + `<td style="white-space:nowrap">${rfdButtons(r)}</td></tr>`;
  }).join('') + '</tbody>';
}

/* ---- ticking several ---- */

let RFD_PICK = new Set();

/** The same test the row's own Refuse button uses — a tick box must not offer what the write refuses. */
const rfdRefusable = r => !!r && rfdCanApprove() && r.stage !== 'rejected' && !(r.sent > 0);

function rfdPickToggle(id, on) { if (on) RFD_PICK.add(id); else RFD_PICK.delete(id); rfdPickShow(); }

/** Tick, or untick, every refusable row on screen — never one a filter is hiding. */
function rfdPickAll(on) {
  (RFD.shown || []).filter(rfdRefusable).forEach(r => { if (on) RFD_PICK.add(r.id); else RFD_PICK.delete(r.id); });
  rfdPickShow();
}

/** Let go of any tick on a row that is no longer on screen or no longer refusable. */
function rfdPickPrune() {
  const ok = new Set((RFD.shown || []).filter(rfdRefusable).map(r => r.id));
  RFD_PICK = new Set([...RFD_PICK].filter(id => ok.has(id)));
}

function rfdPickShow() {
  const b = $('rfdRefuseSel');
  if (b) {
    b.classList.toggle('hide', !RFD_PICK.size);
    b.textContent = 'Refuse ticked (' + nf(RFD_PICK.size) + ')';
  }
  const all = $('rfdPickAll');
  if (all) {
    const can = (RFD.shown || []).filter(rfdRefusable);
    all.checked = can.length > 0 && can.every(r => RFD_PICK.has(r.id));
  }
}

/**
 * Refuse several, one at a time, through the same write the single button uses.
 * Returns { done, failed: [{ id, err }] } or { err } when nothing was tried.
 */
async function rfdRefuseMany(ids, note) {
  if (!rfdCanApprove()) return { err: RFD_NO_APPROVE };
  const why = String(note || '').trim();
  if (!why) return { err: 'Give a reason — every printer sees it on their own screen.' };
  const list = [...new Set(ids || [])];
  if (!list.length) return { err: 'Nothing is ticked.' };
  let done = 0; const failed = [];
  for (const id of list) {
    const err = await rfdDecide(id, 'rejected', why);
    if (err) failed.push({ id, err }); else { done++; RFD_PICK.delete(id); }
  }
  return { done, failed };
}

/** Only what this account may actually do, and only what makes sense at this stage. */
function rfdButtons(r) {
  const b = [];
  const sm = 'padding:3px 10px;font-size:12px';
  if (rfdCanApprove() && r.stage === 'pending')
    b.push(`<button data-rfd-ok="${esc(r.id)}" style="${sm}">Approve</button>`);
  if (rfdCanApprove() && r.stage !== 'rejected' && r.sent <= 0)
    b.push(`<button class="ghost" data-rfd-no="${esc(r.id)}" style="${sm}">Refuse</button>`);
  if (rfdCanSend() && (r.stage === 'approved' || r.stage === 'sent') && r.sent < rfdToSend(r, r._order))
    b.push(`<button class="ghost" data-rfd-send="${esc(r.id)}" style="${sm}">Mark sent</button>`);
  return b.join(' ') || '<span class="muted">&mdash;</span>';
}

function renderRfd() {
  rfdBadge();
  if (!$('rfdTable')) return;
  if (RFD.busy) { $('rfdMsg').className = 'muted'; $('rfdMsg').textContent = 'Reading the requirements…'; ptEmpty('rfdTable', 'Loading…'); return; }
  if (!rfdCanSee()) { $('rfdMsg').className = 'err'; $('rfdMsg').textContent = 'This screen is not open to your account.'; ptEmpty('rfdTable', 'Nothing to show.'); $('rfdKpis').innerHTML = ''; return; }
  if (RFD.err) { $('rfdMsg').className = 'err'; $('rfdMsg').textContent = 'Could not read them: ' + RFD.err; ptEmpty('rfdTable', 'Nothing to show.'); $('rfdKpis').innerHTML = ''; return; }

  /* BY ORDER or BY PRINTER (2026-09-26): the stage, cloth and date filters belong to the requirements list alone. */
  const view = ($('rfdView') || {}).value || 'req';
  ['rfdStage', 'rfdFab', 'rfdD1', 'rfdD2'].forEach(id => { const el = $(id); if (el) el.classList.toggle('hide', view !== 'req'); });
  if (view !== 'req') { RFD_PICK.clear(); rfdPickShow(); return renderRfdLedger(view); }

  const all = rfdRows();
  ptFillSelect('rfdVendor', [...new Set(all.map(r => r.vendorCode).filter(Boolean))]
    .map(c => [c, voName(c) || c]), 'All printers');
  ptFillSelect('rfdFab', [...new Set(all.map(r => r.fabric).filter(Boolean))].sort(), 'All fabrics');
  const rows = rfdApply(all, rfdFilters());
  RFD.shown = rows;
  rfdPickPrune();

  const n = st => all.filter(r => r.stage === st).length;
  /* Two figures, never one. Pieces and metres added together would be a number with no unit — the
   * same rule the delivery log has always followed about cut and running. */
  const m = st => {
    const rows = all.filter(r => r.stage === st);
    const p = rfdRound(rows.filter(r => rfdUnit(r) === 'pcs').reduce((a, r) => a + rfdWant(r), 0));
    const mt = rfdRound(rows.filter(r => rfdUnit(r) === 'm').reduce((a, r) => a + rfdWant(r), 0));
    return [p ? nf(p) + ' pcs' : '', mt ? nf(mt) + ' m' : ''].filter(Boolean).join(' · ');
  };
  const tile = (key, label, value, sub, colour) => `<div class="metric pt-kpi${RFD_KPI === key ? ' pt-kpi-on' : ''}" data-rfdkpi="${key}" tabindex="0" role="button">`
    + `<div class="v"${colour ? ` style="color:${colour}"` : ''}>${value}</div><div class="l">${label}</div>`
    + (sub ? `<div class="l muted">${sub}</div>` : '') + '</div>';
  $('rfdKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">RFD requirements</span>
      <span class="kpiwhen">read live${RFD.at ? ' · ' + esc(RFD.at) : ''}</span></div>
    <div class="metrics">
      ${tile('', 'Requirements', nf(all.length), [
        (p => p ? nf(p) + ' pcs' : '')(rfdRound(all.filter(r => rfdUnit(r) === 'pcs').reduce((a, r) => a + rfdWant(r), 0))),
        (v => v ? nf(v) + ' m' : '')(rfdRound(all.filter(r => rfdUnit(r) === 'm').reduce((a, r) => a + rfdWant(r), 0))),
      ].filter(Boolean).join(' · ') + ' asked')}
      ${tile('pending', 'Waiting for approval', nf(n('pending')), m('pending'), n('pending') ? 'var(--bad)' : '')}
      ${tile('approved', 'Approved, not yet sent', nf(n('approved')), m('approved'), '#7f6000')}
      ${tile('sent', 'Sent to the printer', nf(n('sent')), m('sent'), '#166534')}
      ${tile('rejected', 'Refused', nf(n('rejected')), m('rejected'))}
    </div></div>`;

  $('rfdTable').innerHTML = rows.length ? rfdTable(rows)
    : '<tbody><tr><td class="muted" style="padding:16px">' + (all.length
      ? 'No requirement matches those filters.'
      : 'No printer has asked for cloth yet. They raise these in their own portal, against an order they are printing.')
    + '</td></tr></tbody>';
  $('rfdMsg').className = 'muted';
  $('rfdMsg').textContent = (rows.length === all.length ? nf(all.length) + ' requirement(s)'
    : nf(rows.length) + ' of ' + nf(all.length) + ' requirement(s)')
    + ' · what an order covers is worked out from its own lines, never stored'
    + (rfdCanApprove() ? '' : ' · you may look, not answer');
  rfdPickShow();
}

/* ---- the buttons ---- */

$('rfdTable').addEventListener('click', async e => {
  const say = (t, bad) => { $('rfdMsg').className = bad ? 'err' : 'muted'; $('rfdMsg').textContent = t; };
  /* SEND AGAINST THE ORDER (2026-09-26): the store's own button on the By-order reading. */
  const os = e.target.closest('[data-rfd-osend]');
  if (os) { const [oid, key] = os.getAttribute('data-rfd-osend').split('|'); return rfdOfficeSendOpen(oid, key, renderRfd); }
  const ok = e.target.closest('[data-rfd-ok]');
  if (ok) {
    const r = rfdFind(ok.getAttribute('data-rfd-ok')); if (!r) return;
    return ptOpenDialog({
      title: 'Approve ' + r.fabric + ' for ' + (r.vendorName || r.vendorCode),
      subtitle: rfdQtyTxt(r) + ' of ' + r.unitTxt + ' against ' + r.orderNo,
      note: 'This asks for more than the order covers. Approving it hands out cloth the order does not account for.',
      fields: [{ key: 'note', label: 'Why you are allowing it', span: true, value: '' }],
      saveLabel: 'Approve',
      onSave: async v => { const err = await rfdDecide(r.id, 'approved', v.note); if (!err) renderRfd(); return err; },
    });
  }
  const no = e.target.closest('[data-rfd-no]');
  if (no) {
    const r = rfdFind(no.getAttribute('data-rfd-no')); if (!r) return;
    return ptOpenDialog({
      title: 'Refuse ' + r.fabric + ' for ' + (r.vendorName || r.vendorCode),
      subtitle: rfdQtyTxt(r) + ' of ' + r.unitTxt + ' against ' + r.orderNo,
      note: 'The printer sees the reason on their own screen. Say something they can act on.',
      fields: [{ key: 'note', label: 'Reason', span: true, value: '' }],
      saveLabel: 'Refuse',
      onSave: async v => { const err = await rfdDecide(r.id, 'rejected', v.note); if (!err) renderRfd(); return err; },
    });
  }
  const sd = e.target.closest('[data-rfd-send]');
  if (sd) {
    const r = rfdFind(sd.getAttribute('data-rfd-send')); if (!r) return;
    const left = rfdRound(Math.max(0, rfdToSend(r, r._order) - r.sent));
    const u = rfdUnit(r);
    return ptOpenDialog({
      title: 'Send ' + r.unitTxt + ' to ' + (r.vendorName || r.vendorCode),
      subtitle: nf(left) + ' ' + u + ' still to go out against ' + r.orderNo,
      fields: [{ key: 'qty', label: (u === 'pcs' ? 'Pieces' : 'Metres') + ' going out', type: 'number',
                 min: 0, step: u === 'pcs' ? '1' : '0.1', value: left },
               { key: 'date', label: 'Date it goes out', type: 'date', value: ptIsoDate(new Date().toISOString()) },
               { key: 'note', label: 'Remarks', span: true, value: '' }],
      saveLabel: 'Record it',
      onSave: async v => { const err = await rfdMarkSent(r.id, v.qty, v.date, v.note); if (!err) renderRfd(); return err; },
    });
  }
  if (e.target.closest('[data-rfd-ok],[data-rfd-no],[data-rfd-send]')) say('');
});

$('rfdTable').addEventListener('change', e => {
  const t = e.target;
  if (!t || !t.getAttribute) return;
  if (t.id === 'rfdPickAll') { rfdPickAll(!!t.checked); renderRfd(); return; }
  const id = t.getAttribute('data-rfd-pick');
  if (id) rfdPickToggle(id, !!t.checked);
});

$('rfdRefuseSel').onclick = () => {
  rfdPickPrune();
  const picked = (RFD.shown || []).filter(r => RFD_PICK.has(r.id));
  if (!picked.length) { rfdPickShow(); return; }
  const printers = [...new Set(picked.map(r => r.vendorName || r.vendorCode))];
  ptOpenDialog({
    title: 'Refuse ' + nf(picked.length) + ' requirement(s)',
    subtitle: printers.slice(0, 4).join(', ') + (printers.length > 4 ? ' and ' + nf(printers.length - 4) + ' more' : ''),
    note: 'Every printer sees this reason on their own screen. Say something they can act on.',
    html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
      + picked.slice(0, 12).map(r => esc(r.orderNo + ' · ' + (r.vendorName || r.vendorCode) + ' · ' + r.unitTxt + ' · ' + rfdQtyTxt(r))).join('<br>')
      + (picked.length > 12 ? '<br>…and ' + nf(picked.length - 12) + ' more.' : '') + '</div>',
    fields: [{ key: 'note', label: 'Reason', span: true, value: '' }],
    saveLabel: 'Refuse ' + nf(picked.length),
    onSave: async v => {
      const res = await rfdRefuseMany(picked.map(r => r.id), v.note);
      if (res.err) return res.err;
      renderRfd();
      $('rfdMsg').className = res.failed.length ? 'err' : 'muted';
      $('rfdMsg').textContent = nf(res.done) + ' refused.'
        + (res.failed.length ? ' ' + nf(res.failed.length) + ' were not: '
          + res.failed.slice(0, 3).map(x => { const r = rfdFind(x.id); return (r ? r.orderNo : x.id) + ' — ' + x.err; }).join(' · ') : '');
      return '';
    },
  });
};

function rfdKpiClick(e) {
  const t = e.target.closest('[data-rfdkpi]');
  if (!t) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  if (e.type === 'keydown') e.preventDefault();
  const key = t.getAttribute('data-rfdkpi');
  RFD_KPI = RFD_KPI === key ? '' : key;
  renderRfd();
}
$('rfdKpis').addEventListener('click', rfdKpiClick);
$('rfdKpis').addEventListener('keydown', rfdKpiClick);
['rfdView', 'rfdStage', 'rfdVendor', 'rfdFab', 'rfdD1', 'rfdD2'].forEach(id => $(id).addEventListener('change', renderRfd));
ptDebounce('rfdQ', renderRfd);
$('rfdClear').onclick = () => {
  ['rfdStage', 'rfdVendor', 'rfdFab', 'rfdQ', 'rfdD1', 'rfdD2'].forEach(id => { if ($(id)) $(id).value = ''; });
  RFD_KPI = ''; renderRfd();
};
$('rfdGo').onclick = () => ensureRfd(true);
$('rfdGuide').onclick = () => window.open('/guide/#rfd', '_blank');
$('rfdExport').onclick = () => {
  const rows = RFD.shown || []; if (!rows.length) return;
  const view = ($('rfdView') || {}).value || 'req';
  if (view === 'order') {
    return ptDownload('rfd-by-order', [['Order', 'Printer', 'Printer code', 'Placed', 'Accepted', 'What', 'Item', 'Unit', 'Needs', 'With them', 'Sent', 'Received', 'On the way', 'To send'].map(csvCell).join(',')]
      .concat(rows.map(x => [x.orderNo, x.vendorName, x.vendorCode, x.placed ? new Date(x.placed).toISOString().slice(0, 10) : '', (a => a ? ptIsoDate(a.at) || '' : '')(voAckOf(x._order)), x.what, x.item, x.unit,
        x.need, x.withYou, x.sent, x.recv, x.onWay, x.toSend].map(csvCell).join(','))));
  }
  if (view === 'printer') {
    return ptDownload('rfd-with-printers', [['Printer', 'Printer code', 'What', 'Item', 'Unit', 'Orders', 'Had', 'Received', 'On the way', 'Delivered back', 'With them now'].map(csvCell).join(',')]
      .concat(rows.map(x => [x.vendorName, x.vendorCode, x.what, x.item, x.unit, x.orders, x.had, x.recv, x.onWay, x.used, x.inHand].map(csvCell).join(','))));
  }
  const out = [['Raised', 'Raised by', 'Printer', 'Printer code', 'Order', 'What they need', 'Unit',
    'How much', 'Fabric', 'Size', 'Metres it takes to cut', 'Order needs', 'Already asked', 'Still covered',
    'Beyond the order', 'Stage', 'Automatic', 'Sent', 'Note', 'Answered by', 'Answer note'].map(csvCell).join(',')];
  rows.forEach(r => {
    const cap = r._order
      ? (rfdUnit(r) === 'pcs' ? rfdPcsAllowed(r._order, r.sku, r) : rfdAllowed(r._order, r.fabric, r))
      : null;
    const d = rfdDecisionOf(r.id) || {};
    const over = cap ? rfdRound(rfdWant(r) - cap.left) : '';
    out.push([ptIsoDate(r.raisedAt) || '', r.raisedBy, r.vendorName || voName(r.vendorCode), r.vendorCode,
      r.orderNo, r.unitTxt, rfdUnit(r), rfdWant(r), r.fabric || '', r.size || '',
      rfdUnit(r) === 'pcs' ? rfdRound(r.metres) : '',
      cap ? cap.need : '', cap ? cap.used : '', cap ? cap.left : '',
      over > 0 ? over : 0, (RFD_STAGE[r.stage] || {}).label || r.stage, r.auto ? 'yes' : 'no',
      rfdRound(r.sent), r.note || '', d.by || '', d.note || ''].map(csvCell).join(','));
  });
  ptDownload('rfd-requirements', out);
};

