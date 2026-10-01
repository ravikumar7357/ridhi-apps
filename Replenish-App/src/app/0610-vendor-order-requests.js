/* ================= VENDOR ORDER REQUESTS =================
 *
 * Ravi, 2026-09-14: "meri team ko ek sales order jesa printing ke liye tab ... jisko printing order
 * dena chahte h wo de sake and assign bhi kar sake but pahle wo mere pas approval ke liye aay, then
 * wo vendor ko order send kar sake — just not printer, for all vendors like quilt, embroidery — and
 * wo related work ka view access bhi dekh sake."
 *
 * A REQUEST IS NOT AN ORDER. It lives in pt_vendorOrderReqs, which no vendor can read, so nothing
 * reaches a vendor's portal until somebody with the right says yes. Approving writes the real order
 * into pt_vendorOrders/<vendor> in exactly the shape "+ New vendor order" writes — so the portal, the
 * History, the rate list and the printer cap all treat it like any other order, because it is one.
 *
 * The request is built in the SAME form as a vendor order (voFormOpen in request mode), so every
 * check that form makes — the cut-fabric list, the printer cap, the file upload — applies to a
 * request too. The cap is checked again at approval: days can pass, and other orders go out.
 *
 * After approval the request keeps the order's number and reads its progress live from the order, so
 * the person who asked can see what the vendor has sent without being given the Vendor Orders tab.
 */
let VRQ = { rows: null, err: '', busy: false, at: '', shown: [] };
let VRQ_KPI = '';

/** May this account approve a request, and so send work to a vendor? */
const vrqCanApprove = () => !spIsVendor() && !!(ME.admin || ME.vreqApprove);
const VRQ_NO_APPROVE = 'Approving a vendor order request needs permission. Ask an admin to switch on '
  + '"Can approve vendor order requests" for your account.';

const vrqOf = id => (VRQ.rows || []).find(r => r && r.id === id) || null;
const vrqUnit = r => (r && r.orderType === 'running' ? 'm' : 'pcs');
const vrqTotal = r => voLines(r).filter(l => !l.cancelled).reduce((s, l) => s + voQty(r, l), 0);
/** What a line is, in words — the same words the order form's draft table uses. */
const vrqItem = l => (voKind(l) === 'running'
  ? [l.fabricType, l.color, l.printDirection ? 'print ' + l.printDirection : ''].filter(Boolean).join(' · ')
  : '[' + l.sku + '] ' + [l.articleType, l.articleSubtype, l.color, l.size].filter(Boolean).join(' · '));
/** The earliest date anybody asked for on it — what the approver is being asked to agree to. */
const vrqWanted = r => voLines(r).map(l => voWant(l)).filter(Boolean).sort()[0] || '';
const vrqWho = e => String(e || '').split('@')[0];

/** VRQ-YYMMDD-XXX, re-rolled if that number is somehow already taken. */
function vrqNewNo() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const pfx = 'VRQ-' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-';
  const taken = new Set((VRQ.rows || []).map(r => obUC(r.reqNo)));
  for (let i = 0; i < 50; i++) {
    const n = pfx + Math.random().toString(36).slice(2, 5).toUpperCase();
    if (!taken.has(n)) return n;
  }
  return pfx + Date.now().toString(36).slice(-3).toUpperCase();
}

/** The vendor order an approved request became, read live — '' when it has not become one. */
function vrqOrder(r) {
  if (!r || !r.vendorOrderId) return null;
  return (VO.rows || []).find(o => o && o.id === r.vendorOrderId
    && (!r.sentTo || String(o.vendorCode) === String(r.sentTo))) || null;
}

/**
 * Where a request stands, as one word the filters and tiles agree on.
 *   pending   waiting for an approver
 *   open      approved, and the vendor still owes some of it
 *   done      approved, and everything has come back (or the order was closed)
 *   rejected  refused, or taken back by whoever raised it
 */
function vrqStage(r) {
  if (!r) return '';
  if (r.status === 'pending') return 'pending';
  if (r.status === 'rejected' || r.status === 'withdrawn') return 'rejected';
  const o = vrqOrder(r);
  if (!o) return 'open';                         // approved, but the order is not loaded (or was removed)
  if (o.status === 'Cancelled' || o.status === 'Received') return 'done';
  return voSummary(o).owed > 0 ? 'open' : 'done';
}
const VRQ_STAGE = {
  pending: { label: 'Waiting for approval', pill: 'pill-low' },
  open: { label: 'With the vendor', pill: 'pill-ok' },
  done: { label: 'Completed', pill: 'pill-ok' },
  rejected: { label: 'Rejected / withdrawn', pill: 'pill-out' },
};

async function ensureVrq(force) {
  if (VRQ.rows === null || force) {
    VRQ.busy = true; renderVrq();
    try {
      VRQ.rows = ptList(await ptGet('pt_vendorOrderReqs')).filter(r => r && r.id);
      VRQ.err = '';
    } catch (e) { VRQ.err = e.message || String(e); VRQ.rows = VRQ.rows || []; }
    /* The progress column reads the orders the requests became, and the vendor names come from the
     * master — both are needed before the table can say anything true. */
    if (VO.rows === null || force) { VO.rows = null; try { await ensureVo(); } catch (e) { /* progress shows as unknown */ } }
    if (!PTG.mdb) { try { await ptLoadGates(); } catch (e) { /* codes show instead of names */ } }
    VRQ.at = ptStamp(); VRQ.busy = false;
  }
  renderVrq();
}

/** The red count on the sidebar — only for somebody who can do something about it. */
function vrqBadge() {
  const el = $('vreqBadge'); if (!el) return;
  const n = vrqCanApprove() ? (VRQ.rows || []).filter(r => r && r.status === 'pending').length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

/* ---- raising one ---- */

/**
 * Save what the order form holds as a request. Called by voPlace when the form is in request mode, so
 * it has already been through every check an order goes through.
 */
async function vrqSubmit(d) {
  if (spIsVendor()) return 'A vendor cannot raise an order.';
  const now = new Date().toISOString();
  const id = 'vrq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const rec = {
    id, reqNo: vrqNewNo(), status: 'pending',
    vendorCode: d.code, vendorName: d.vend.desc || d.vend.name || d.code, category: String(d.vend.category || ''),
    service: d.service, orderType: d.kind,
    ...(d.channel ? { channel: String(d.channel) } : {}),
    ...(d.filler ? { filler: String(d.filler) } : {}),
    notes: d.notes, why: d.why,
    lines: d.lines.map(l => Object.assign({}, l)),
    requestedBy: ME.email, requestedAt: now,
    log: [{ at: now, by: ME.email, what: 'Raised for ' + (d.vend.desc || d.vend.name || d.code) }],
  };
  await ptPut('pt_vendorOrderReqs/' + id, rec);
  VRQ.rows = (VRQ.rows || []).filter(r => r.id !== id).concat([rec]);
  renderVrq();
  const say = `${rec.reqNo} sent for approval · ${rec.vendorName} · ${nf(rec.lines.length)} line(s), `
    + `${nf(vrqTotal(rec))} ${vrqUnit(rec)}. The vendor sees nothing until it is approved.`;
  [$('vrqMsg'), $('voMsg')].forEach(el => { if (el) { el.className = 'muted'; el.textContent = say; } });
  return '';
}

/* ---- answering one ---- */

/**
 * Approve, and send the order to the vendor.
 *
 * THE VENDOR CAN BE CHANGED HERE. Whoever raised it chose a vendor; the approver may know that one is
 * full this week. The change is written into the request's log with both names.
 *
 * THE ORDER ID COMES FROM THE REQUEST, so approving twice — a double click, or a retry after the
 * request itself failed to save — lands on the same order instead of sending the work out twice.
 */
async function vrqApprove(id, opts) {
  if (!vrqCanApprove()) return VRQ_NO_APPROVE;
  const r = vrqOf(id);
  if (!r) return 'That request is gone — press Refresh.';
  if (r.status !== 'pending') return `${r.reqNo || id} is not waiting for approval any more (${r.status}).`;
  const code = String((opts && opts.vendor) || r.vendorCode || '').trim();
  const vend = voAllVendors().find(v => String(v.code) === code);
  if (!vend) return 'That vendor is not active in the vendor master any more. Pick another one.';
  const lines = voLines(r).filter(l => !l.cancelled);
  if (!lines.length) return 'This request has no lines to send.';

  if (VO.rows === null) await ensureVo();
  if (SOX.rows === null) { try { SOX.rows = ptList(await ptGet('pt_salesOrders')); } catch (e) { SOX.rows = SOX.rows || []; } }

  const oid = 'vpo_' + id;
  /* THE CAP AGAIN, as it stands now. Checked when the request was raised; other printing orders may
   * have gone out since. */
  if (r.orderType !== 'running' && voIsPrinting(r)) {
    const bad = voValidateCut(lines.filter(l => voKind(l) === 'cut').map(l => ({ sku: l.sku, qty: l.qty })), oid);
    if (bad.length) return 'Over the printer cap now, so it cannot go out as it is: '
      + bad.slice(0, 3).map(voCapMsg).join(' ') + (bad.length > 3 ? ` And ${nf(bad.length - 3)} more SKU(s).` : '')
      + ' Reject it with a note saying how much can go.';
  }

  const now = new Date().toISOString();
  const note = String((opts && opts.note) || '').trim();
  const vname = vend.desc || vend.name || code;
  const have = (VO.rows || []).find(o => o && o.id === oid && String(o.vendorCode) === code);
  const order = have ? Object.assign({}, have) : {
    id: oid,
    orderNo: voNewOrderNo(),
    vendorCode: code, vendorName: vname,
    service: voServiceOf(r),
    ...(r.channel ? { channel: String(r.channel) } : {}),
    orderType: r.orderType === 'running' ? 'running' : 'cut',
    ...(r.filler ? { filler: String(r.filler) } : {}),
    orderDate: voTodayDMY(),
    status: 'Placed',
    notes: String(r.notes || ''),
    lines: (() => { try { return voStampOrders(lines.map(l => Object.assign({}, l)), r.channel || ''); } catch (e) { return lines.map(l => Object.assign({}, l)); } })(),
    /* Raised by the person who asked; the approval is recorded beside it, not over it. */
    createdBy: r.requestedBy || ME.email, createdAt: now,
    approvedBy: ME.email, approvedAt: now,
    requestId: id, requestNo: r.reqNo || '',
  };
  if (!have && order.orderType === 'cut') order.demandSource = 'bulk';
  if (!have) {
    const put = Object.assign({}, order); delete put._key;
    try { await ptPut('pt_vendorOrders/' + code + '/' + oid, put); }
    catch (e) { return 'Not sent: ' + (e.message || e); }
    if (vend.email && VO.map) {
      try { await ptPut('pt_vendorMap/' + code, { email: String(vend.email).toLowerCase(), name: vend.name || code });
        VO.map[code] = { email: String(vend.email).toLowerCase(), name: vend.name || code }; } catch (e) { /* the order is placed regardless */ }
    }
    VO.rows = (VO.rows || []).concat([Object.assign({ vendorCode: code }, put)]);
  }

  const moved = String(r.vendorCode || '') !== code;
  const next = Object.assign({}, r, {
    status: 'approved', approvedBy: ME.email, approvedAt: now, approveNote: note,
    sentTo: code, sentToName: vname, vendorOrderId: oid, vendorOrderNo: order.orderNo,
    log: (Array.isArray(r.log) ? r.log : []).concat([{ at: now, by: ME.email,
      what: 'Approved and sent to ' + vname + ' as ' + order.orderNo
        + (moved ? ' (asked for ' + (r.vendorName || voName(r.vendorCode)) + ')' : '') + (note ? ' — ' + note : '') }]),
  });
  delete next._key;
  try { await ptPut('pt_vendorOrderReqs/' + id, next); }
  catch (e) {
    return `${order.orderNo} is with ${vname}, but the request could not be marked approved (${e.message || e}). `
      + 'Press Approve again — it will not send the order twice.';
  }
  VRQ.rows = (VRQ.rows || []).map(x => (x.id === id ? next : x));
  renderVrq();
  if ($('vrqMsg')) { $('vrqMsg').className = 'muted';
    $('vrqMsg').textContent = `${r.reqNo} approved — ${order.orderNo} is on ${vname}'s portal now.`; }
  return '';
}

/** Refuse it. The reason is required: the person who asked has to know what to change. */
async function vrqReject(id, reason) {
  if (!vrqCanApprove()) return VRQ_NO_APPROVE;
  const r = vrqOf(id);
  if (!r) return 'That request is gone — press Refresh.';
  if (r.status !== 'pending') return `${r.reqNo || id} is not waiting for approval any more (${r.status}).`;
  const why = String(reason || '').trim();
  if (!why) return 'Say why it is rejected, so whoever raised it knows what to change.';
  const now = new Date().toISOString();
  const next = Object.assign({}, r, { status: 'rejected', rejectedBy: ME.email, rejectedAt: now, rejectReason: why,
    log: (Array.isArray(r.log) ? r.log : []).concat([{ at: now, by: ME.email, what: 'Rejected — ' + why }]) });
  delete next._key;
  try { await ptPut('pt_vendorOrderReqs/' + id, next); } catch (e) { return 'Not saved: ' + (e.message || e); }
  VRQ.rows = (VRQ.rows || []).map(x => (x.id === id ? next : x));
  renderVrq();
  return '';
}

/** Take back a request that nobody has answered yet — whoever raised it, or an approver. */
async function vrqWithdraw(id) {
  const r = vrqOf(id);
  if (!r) return 'That request is gone — press Refresh.';
  if (r.status !== 'pending') return `${r.reqNo || id} has already been answered, so it cannot be withdrawn.`;
  if (!vrqCanApprove() && String(r.requestedBy || '').toLowerCase() !== String(ME.email || '').toLowerCase()) {
    return 'Only the person who raised it can withdraw it.';
  }
  const now = new Date().toISOString();
  const next = Object.assign({}, r, { status: 'withdrawn', withdrawnBy: ME.email, withdrawnAt: now,
    log: (Array.isArray(r.log) ? r.log : []).concat([{ at: now, by: ME.email, what: 'Withdrawn' }]) });
  delete next._key;
  try { await ptPut('pt_vendorOrderReqs/' + id, next); } catch (e) { return 'Not saved: ' + (e.message || e); }
  VRQ.rows = (VRQ.rows || []).map(x => (x.id === id ? next : x));
  renderVrq();
  return '';
}

/** A rejected or withdrawn request, back in the form to fix and send again. */
async function vrqCopy(id) {
  const r = vrqOf(id); if (!r) return;
  await voFormOpen('request');
  if ($('vof_vendor')) $('vof_vendor').value = r.vendorCode || '';
  if ($('vof_service')) { $('vof_service').value = voServiceOf(r); voOnServicePick(); }
  if ($('vof_channel')) $('vof_channel').value = String(r.channel || '');
  VOF.service = voServiceOf(r);
  if ($('vof_filler')) $('vof_filler').value = String(r.filler || '');
  voSetKind(r.orderType === 'running' ? 'running' : 'cut');
  VOF.lines = voLines(r).filter(l => !l.cancelled).map((l, i) => Object.assign({}, l, {
    lineId: 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + i, dispatchedQty: 0 }));
  voDraft();
  if ($('vof_notes')) $('vof_notes').value = r.notes || '';
  if ($('vof_why')) $('vof_why').value = r.why || '';
  ptDlgMsg(`Copied from ${r.reqNo}${r.rejectReason ? ' — rejected: ' + r.rejectReason : ''}. Change what is needed, then send it again.`);
}

/* ---- the dialogs ---- */

/** The lines of a request, with what the vendor has sent against each once it is an order. */
function vrqLinesHtml(r) {
  const o = vrqOrder(r), unit = vrqUnit(r);
  const live = id => o ? voLines(o).find(x => x && x.lineId === id) : null;
  return `<div class="xlwrap" style="max-height:34vh;border:1px solid var(--line);border-radius:10px">
    <table class="xl"><thead><tr><th>Item</th><th class="num">Qty</th><th>Wanted by</th><th>Priority</th>`
    + (o ? '<th class="num">Sent</th><th class="num">Balance</th><th>Vendor’s date</th>' : '')
    + '<th>Notes</th></tr></thead><tbody>'
    + voLines(r).map(l => {
      const x = live(l.lineId);
      const q = voQty(r, l), sent = x ? voDone(x) : 0;
      return `<tr${l.cancelled || (x && x.cancelled) ? ' style="opacity:.5"' : ''}>`
        + `<td style="text-align:left">${esc(vrqItem(l))}</td>`
        + `<td class="num" style="font-weight:700">${nf(q)} <span class="muted" style="font-size:11px">${unit}</span></td>`
        + `<td>${esc(dShow(voWant(l))) || '<span class="muted">—</span>'}</td>`
        + `<td>${esc(l.priority) || '<span class="muted">—</span>'}</td>`
        + (o ? `<td class="num">${nf(sent)}</td><td class="num"${q - sent > 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>${nf(Math.max(0, q - sent))}</td>`
          + `<td>${x && voProm(x) ? esc(dShow(voProm(x))) : '<span class="muted">not given</span>'}</td>` : '')
        + `<td style="text-align:left;font-size:11.5px" class="muted">${esc(l.notes)}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}

function vrqHead(r) {
  return `<div class="muted" style="font-size:12.5px;margin-bottom:8px;line-height:1.6">
      <b>${esc(r.service || 'Block print')}</b> · ${esc(r.orderType === 'running' ? 'running fabric, metres' : 'pieces')}
      · asked of <b>${esc(r.vendorName || voName(r.vendorCode))}</b>${r.category ? ' (' + esc(r.category) + ')' : ''}
      · raised by ${esc(vrqWho(r.requestedBy))} on ${esc(ptIsoDate(r.requestedAt) || '')}
      ${r.why ? `<br>Why: <span style="color:var(--ink,inherit)">${esc(r.why)}</span>` : ''}
      ${r.notes ? `<br>Notes for the vendor: ${esc(r.notes)}` : ''}
    </div>`;
}

function vrqView(id) {
  const r = vrqOf(id); if (!r) return;
  const o = vrqOrder(r), st = vrqStage(r);
  const log = (Array.isArray(r.log) ? r.log : []).map(x =>
    `<div>${esc(ptIsoDate(x.at) || '')} · ${esc(vrqWho(x.by))} — ${esc(x.what)}</div>`).join('');
  ptOpenDialog({
    title: `${r.reqNo || id} — ${VRQ_STAGE[st] ? VRQ_STAGE[st].label : r.status}`,
    subtitle: o ? `${o.orderNo} with ${voName(o.vendorCode)} · vendor status ${o.status || 'Placed'}` : '',
    html: vrqHead(r) + vrqLinesHtml(r)
      + (r.rejectReason ? `<div class="err" style="margin-top:10px">Rejected: ${esc(r.rejectReason)}</div>` : '')
      + (log ? `<div class="muted" style="font-size:12px;margin-top:12px;line-height:1.6"><b>What happened</b>${log}</div>` : ''),
  });
}

function vrqAnswerOpen(id) {
  const r = vrqOf(id); if (!r) return;
  if (!vrqCanApprove()) { $('vrqMsg').className = 'err'; $('vrqMsg').textContent = VRQ_NO_APPROVE; return; }
  const vends = voAllVendors();
  ptOpenDialog({
    title: `Approve ${r.reqNo}?`,
    subtitle: `${nf(voLines(r).length)} line(s) · ${nf(vrqTotal(r))} ${vrqUnit(r)} · ${r.service || 'Block print'}`,
    note: 'Approving places the order with the vendor at once — it appears on their portal. To refuse, '
      + 'write the reason in the note and press Reject.',
    html: vrqHead(r) + vrqLinesHtml(r),
    fields: [
      { key: 'vendor', label: 'Send to', type: 'select', value: r.vendorCode || '',
        options: [['', '— pick a vendor —']].concat(vends.map(v => [v.code, (v.desc || v.name || v.code) + ' (' + (v.category || 'vendor') + ')'])) },
      { key: 'note', label: 'Note (a reason is required to reject)', span: true, value: '' },
    ],
    onSave: v => vrqApprove(id, { vendor: v.vendor, note: v.note }),
    saveLabel: 'Approve & send to vendor',
    alt: { label: 'Reject', run: v => vrqReject(id, v.note) },
  });
}

/* ---- SKU-WISE ----
 * Ravi, 2026-09-28: "sku wise data download nahi kar sakta ki kis sku me mene kitna mal de diya printing par".
 * Every request line, read against the order it became: the quantity is the ORDER's (an approver may have changed
 * it), what came back is the vendor's deliveries on that line (voDone — the same figure as "Sent" in View), and a
 * cancelled line or a closed order (Cancelled / Received) has nothing left to come. */
function vrqSkuLines(rows) {
  const out = [];
  (rows || []).forEach(r => {
    const o = vrqOrder(r), st = vrqStage(r), unit = vrqUnit(r);
    const closed = !!(o && (o.status === 'Cancelled' || o.status === 'Received'));
    voLines(r).forEach(l => {
      const x = o ? voLines(o).find(y => y && y.lineId === l.lineId) || null : null;
      const cancelled = !!(l.cancelled || (x && x.cancelled) || (o && o.status === 'Cancelled'));
      const qty = x ? voQty(o, x) : voQty(r, l), sent = x ? voDone(x) : 0;
      out.push({ r, l, o, st, unit, cancelled, qty, sent,
        bal: cancelled || closed ? 0 : Math.max(0, qty - sent),
        sku: voKind(l) === 'running' ? '' : String(l.sku || '').trim(), item: vrqItem(l),
        work: voServiceOf(r), vendor: r.sentToName || r.vendorName || voName(r.sentTo || r.vendorCode),
        vendorDate: x ? voProm(x) : '' });
    });
  });
  return out;
}
/** One row per work + SKU (running cloth: per work + fabric/colour). Refused and cancelled lines count nowhere;
 * a request still waiting for approval is counted apart — nothing has gone to the vendor yet. */
function vrqSkuTotals(lines) {
  const m = new Map();
  (lines || []).forEach(x => {
    if (x.cancelled || x.st === 'rejected') return;
    const key = x.work + '|' + (x.sku ? 'S|' + obUC(x.sku) : 'R|' + x.item) + '|' + x.unit;
    let t = m.get(key);
    if (!t) m.set(key, t = { work: x.work, sku: x.sku, item: x.item, unit: x.unit, l: x.l,
      given: 0, sent: 0, bal: 0, asked: 0, reqs: new Set(), vend: new Set() });
    if (x.st === 'pending') t.asked += x.qty;
    else { t.given += x.qty; t.sent += x.sent; t.bal += x.bal; }
    t.reqs.add(x.r.reqNo || x.r.id); if (x.vendor) t.vend.add(x.vendor);
  });
  return [...m.values()].sort((a, b) => a.work.localeCompare(b.work) || b.given - a.given || a.item.localeCompare(b.item));
}
const VRQ_SKU_TOT_COLS = ['Work', 'SKU', 'Item', 'Article', 'Subtype', 'Colour', 'Size', 'Unit', 'Given to vendors',
  'Came back', 'Balance with vendors', 'Waiting for approval', 'Requests', 'Vendors'];
const vrqSkuTotRows = lines => vrqSkuTotals(lines).map(t => [t.work, t.sku, t.item, t.l.articleType || t.l.fabricType || '',
  t.l.articleSubtype || '', t.l.color || '', t.l.size || '', t.unit, t.given, t.sent, t.bal, t.asked,
  [...t.reqs].join(' '), [...t.vend].join(', ')]);
const VRQ_SKU_LINE_COLS = ['Request', 'Raised', 'Raised by', 'Vendor', 'Work', 'Status', 'Vendor order', 'SKU', 'Item',
  'Article', 'Subtype', 'Colour', 'Size', 'Qty', 'Unit', 'Came back', 'Balance', 'Wanted by', 'Vendor’s date', 'Line'];
const vrqSkuLineRows = lines => lines.map(x => [x.r.reqNo || x.r.id, ptIsoDate(x.r.requestedAt) || '', x.r.requestedBy || '',
  x.vendor, x.work, x.r.status === 'withdrawn' ? 'Withdrawn' : (VRQ_STAGE[x.st] || {}).label || x.r.status,
  (x.o && x.o.orderNo) || x.r.vendorOrderNo || '', x.sku, x.item, x.l.articleType || x.l.fabricType || '',
  x.l.articleSubtype || '', x.l.color || '', x.l.size || '', x.qty, x.unit, x.sent, x.bal, voWant(x.l), x.vendorDate,
  x.cancelled ? 'Cancelled' : '']);

/* ---- the screen ---- */

function vrqFiltered() {
  const all = (VRQ.rows || []).slice();
  const f = {
    st: ($('vrqStatus') || {}).value || '', work: ($('vrqWork') || {}).value || '',
    vend: ($('vrqVendor') || {}).value || '', who: ($('vrqWho') || {}).value || '',
    q: String(($('vrqQ') || {}).value || '').trim().toLowerCase(),
  };
  const me = String(ME.email || '').toLowerCase();
  const base = all.filter(r => (!f.work || voServiceOf(r) === f.work)
    && (!f.vend || String(r.sentTo || r.vendorCode) === f.vend)
    && (f.who !== 'me' || String(r.requestedBy || '').toLowerCase() === me)
    && (!f.q || [r.reqNo, r.vendorOrderNo, r.vendorName, r.sentToName, voName(r.vendorCode), r.service, r.requestedBy, r.why, r.notes].join(' ').toLowerCase().includes(f.q)
      || voLines(r).some(l => [l.sku, l.fabricType, l.color, l.articleType, l.articleSubtype].join(' ').toLowerCase().includes(f.q))));
  const rows = base.filter(r => (!f.st || vrqStage(r) === f.st) && (!VRQ_KPI || vrqStage(r) === VRQ_KPI))
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)
      || String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
  return { all, base, rows };
}

function renderVrq() {
  vrqBadge();
  const nb = $('vrqNew'); if (nb) nb.classList.toggle('hide', spIsVendor());
  if (VRQ.busy) { $('vrqMsg').className = 'muted'; $('vrqMsg').textContent = 'Reading the requests…'; ptEmpty('vrqTable', 'Loading…'); return; }
  if (VRQ.err) { $('vrqMsg').className = 'err'; $('vrqMsg').textContent = 'Could not read them: ' + VRQ.err; ptEmpty('vrqTable', 'Nothing to show.'); $('vrqKpis').innerHTML = ''; return; }

  const { all, base, rows } = vrqFiltered();
  VRQ.shown = rows;
  ptFillSelect('vrqWork', [...new Set(PR_SERVICES.map(s => s.key).concat(all.map(voServiceOf)))].map(s => [s, s]), 'All work');
  ptFillSelect('vrqVendor', [...new Set(all.map(r => String(r.sentTo || r.vendorCode || '')).filter(Boolean))]
    .map(c => [c, voName(c)]).sort((a, b) => a[1].localeCompare(b[1])), 'All vendors');

  const count = k => base.filter(r => vrqStage(r) === k).length;
  $('vrqKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Vendor order requests</span>
      <span class="kpiwhen">read live${VRQ.at ? ' · ' + esc(VRQ.at) : ''}</span></div>
    <div class="metrics">${Object.keys(VRQ_STAGE).map(k => {
      const on = VRQ_KPI === k;
      return `<div class="metric pt-kpi${on ? ' pt-kpi-on' : ''}" data-vrqkpi="${k}" role="button" tabindex="0" title="${
        on ? 'Showing only these. Click again to show all.' : 'Show only: ' + VRQ_STAGE[k].label.toLowerCase()}">`
        + `<div class="v"${k === 'pending' && count(k) ? ' style="color:#854d0e"' : ''}>${nf(count(k))}</div><div class="l">${VRQ_STAGE[k].label}</div></div>`;
    }).join('')}</div></div>`;

  if (!all.length) {
    $('vrqMsg').className = 'muted';
    $('vrqMsg').textContent = 'No requests yet. "+ New request" raises one — it waits for approval before any vendor sees it.';
    ptEmpty('vrqTable', 'No vendor order requests.');
    return;
  }

  const canOk = vrqCanApprove(), me = String(ME.email || '').toLowerCase();
  const head = ['Request', 'Raised', 'By', 'Vendor', 'Work', 'Lines', 'Qty', 'Wanted by', 'Status', 'Vendor order', ''];
  const body = rows.slice(0, 500).map(r => {
    const st = vrqStage(r), s = VRQ_STAGE[st] || { label: r.status, pill: '' };
    const o = vrqOrder(r), unit = vrqUnit(r);
    const who = r.sentTo && String(r.sentTo) !== String(r.vendorCode)
      ? `${esc(r.sentToName || voName(r.sentTo))}<div class="muted" style="font-size:11px">asked: ${esc(r.vendorName || voName(r.vendorCode))}</div>`
      : esc(r.vendorName || voName(r.vendorCode));
    let prog = '<span class="muted">—</span>';
    if (r.status === 'approved') {
      if (o) {
        const sm = voSummary(o);
        prog = `<b>${esc(o.orderNo)}</b> <span class="muted" style="font-size:11px">${esc(o.status || 'Placed')}</span>`
          + `<div style="font-size:11.5px">${nf(sm.done)} of ${nf(sm.ordered)} ${unit} sent`
          + (sm.owed ? ` · <span style="color:var(--bad);font-weight:700">${nf(sm.owed)} to come</span>` : ' · all in') + '</div>'
          + `<div style="height:4px;background:var(--line);border-radius:3px;margin-top:3px;max-width:160px"><div style="height:4px;width:${Math.min(100, sm.pct)}%;background:#16a34a;border-radius:3px"></div></div>`;
      } else {
        prog = `<b>${esc(r.vendorOrderNo || '')}</b><div class="muted" style="font-size:11px">not found in vendor orders — refresh, or it was removed</div>`;
      }
    } else if (r.status === 'rejected') {
      prog = `<span class="err" style="font-size:11.5px">${esc(r.rejectReason || '')}</span>`;
    }
    const k = esc(r.id);
    const btn = (attr, label, extra) => `<button class="ghost" ${attr}="${k}" style="padding:2px 9px;font-size:12px${extra || ''}">${label}</button>`;
    const acts = [btn('data-vrqview', 'View')];
    if (r.status === 'pending' && canOk) acts.push(btn('data-vrqok', 'Approve / reject', ';color:#166534'));
    if (r.status === 'pending' && (canOk || String(r.requestedBy || '').toLowerCase() === me)) acts.push(btn('data-vrqwd', 'Withdraw'));
    if (r.status === 'rejected' || r.status === 'withdrawn') acts.push(btn('data-vrqcopy', 'Raise again'));
    return '<tr>'
      + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(r.reqNo || r.id)}</td>`
      + `<td>${esc(ptIsoDate(r.requestedAt) || '')}</td>`
      + `<td style="text-align:left">${esc(vrqWho(r.requestedBy))}</td>`
      + `<td style="text-align:left">${who}</td>`
      + `<td style="text-align:left">${esc(voServiceOf(r))}</td>`
      + `<td class="num">${nf(voLines(r).length)}</td>`
      + `<td class="num" style="font-weight:700">${nf(vrqTotal(r))} <span class="muted" style="font-size:11px">${unit}</span></td>`
      + `<td>${esc(dShow(vrqWanted(r))) || '<span class="muted">—</span>'}</td>`
      + `<td><span class="pill ${s.pill}"${r.status === 'withdrawn' ? ' title="Withdrawn by ' + esc(vrqWho(r.withdrawnBy)) + '"' : ''}>${esc(r.status === 'withdrawn' ? 'Withdrawn' : s.label)}</span></td>`
      + `<td style="text-align:left">${prog}</td>`
      + `<td style="white-space:nowrap">${acts.join(' ')}</td></tr>`;
  }).join('');
  $('vrqTable').innerHTML = '<thead><tr>' + head.map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 5 || i === 6 ? ' class="num"' : '')}>${h}</th>`).join('')
    + '</tr></thead><tbody>' + (body || `<tr><td colspan="${head.length}" class="muted" style="padding:14px;text-align:left">Nothing matches.</td></tr>`) + '</tbody>';

  const pend = base.filter(r => r.status === 'pending').length;
  $('vrqMsg').className = 'muted';
  $('vrqMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} request(s)`
    + (VRQ_KPI ? ` · only "${VRQ_STAGE[VRQ_KPI].label}" — click the tile again to show all` : '')
    + (pend ? ` · ${nf(pend)} waiting for ${canOk ? 'you' : 'approval'}` : '')
    + (rows.length > 500 ? ' · showing the first 500' : '');
}

$('vrqTable').addEventListener('click', async e => {
  const hit = a => e.target.closest('[' + a + ']');
  const v = hit('data-vrqview'); if (v) return vrqView(v.getAttribute('data-vrqview'));
  const ok = hit('data-vrqok'); if (ok) return vrqAnswerOpen(ok.getAttribute('data-vrqok'));
  const cp = hit('data-vrqcopy'); if (cp) return vrqCopy(cp.getAttribute('data-vrqcopy'));
  const wd = hit('data-vrqwd');
  if (wd) {
    const r = vrqOf(wd.getAttribute('data-vrqwd'));
    if (!r || !confirm(`Withdraw ${r.reqNo}?\n\nIt will not go to the vendor. It stays on the list as withdrawn, and can be raised again.`)) return;
    const err = await vrqWithdraw(r.id);
    if (err) { $('vrqMsg').className = 'err'; $('vrqMsg').textContent = err; }
  }
});
function vrqKpiClick(e) {
  const t = e.target.closest('[data-vrqkpi]');
  if (!t) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  if (e.type === 'keydown') e.preventDefault();
  const key = t.getAttribute('data-vrqkpi');
  VRQ_KPI = VRQ_KPI === key ? '' : key;
  renderVrq();
}
$('vrqKpis').addEventListener('click', vrqKpiClick);
$('vrqKpis').addEventListener('keydown', vrqKpiClick);
['vrqStatus', 'vrqWork', 'vrqVendor', 'vrqWho'].forEach(id => $(id).addEventListener('change', renderVrq));
ptDebounce('vrqQ', renderVrq);
$('vrqGo').onclick = () => ensureVrq(true);
$('vrqNew').onclick = async () => { if (VRQ.rows === null) await ensureVrq(); voFormOpen('request'); };
$('vrqExport').onclick = () => {
  const rows = VRQ.shown || []; if (!rows.length) return;
  const out = [['Request', 'Raised', 'Raised by', 'Asked of', 'Sent to', 'Work', 'Type', 'Priority', 'Lines', 'Qty', 'Unit', 'Wanted by',
    'Status', 'Vendor order', 'Sent', 'Balance', 'Why', 'Reject reason'].map(csvCell).join(',')];
  rows.forEach(r => {
    const o = vrqOrder(r), sm = o ? voSummary(o) : null;
    out.push([r.reqNo, ptIsoDate(r.requestedAt) || '', r.requestedBy, r.vendorName || voName(r.vendorCode), r.sentToName || '',
      voServiceOf(r), r.orderType, voOrderPri(r), voLines(r).length, vrqTotal(r), vrqUnit(r), vrqWanted(r),
      r.status === 'withdrawn' ? 'Withdrawn' : (VRQ_STAGE[vrqStage(r)] || {}).label, r.vendorOrderNo || '',
      sm ? sm.done : '', sm ? sm.owed : '', r.why || '', r.rejectReason || ''].map(csvCell).join(','));
  });
  ptDownload('vendor-order-requests', out);
};
[['vrqSkuTot', 'vendor-requests-sku-totals', VRQ_SKU_TOT_COLS, vrqSkuTotRows],
 ['vrqSkuLines', 'vendor-requests-sku-lines', VRQ_SKU_LINE_COLS, vrqSkuLineRows]].forEach(([id, name, cols, rowsOf]) => {
  $(id).onclick = () => {
    const rows = rowsOf(vrqSkuLines(VRQ.shown || []));
    if (!rows.length) { $('vrqMsg').className = 'err'; $('vrqMsg').textContent = 'Nothing to download — no request lines match the filters.'; return; }
    ptDownload(name, [cols.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(','))));
  };
});

