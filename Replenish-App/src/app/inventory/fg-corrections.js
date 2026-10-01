/* ================= FINISHED GOODS: ASKING FOR A CORRECTION =================
 *
 * Ravi: "jo team stock issue rec. entry kre uske pas ek access hona chahiye ki is entry me mujhse entry
 * wrong ho gyi ya isme ye correction h to uska mere pas correction ke liye request aa jay".
 *
 * Somebody with "Can add stock entries" cannot edit or delete — on purpose. What they can now do is
 * ASK: on an entry they made themselves, "Request correction" says what should change (or that the
 * entry should go) and why. It lands with everybody who can edit finished goods, as a red count on the
 * sidebar and the "Correction requests" view. Approving applies exactly what was asked, through the
 * same rules an edit follows — below zero is refused, a receive still needs a real order, an FBA
 * dispatch the team has acted on keeps its pieces. Rejecting sends a note back, shown on the row.
 *
 * WHERE: pt_fgiCorrReqs/<movement id>. One request per movement; asking again after an answer reopens
 * the same record, and the earlier answer is kept on it (previous[]).
 *
 * WHAT IS STORED: the change as FIELDS, not as a copy of the row — { txnType, date (ISO), sku, qty, who,
 * orderNo, reason, remarks } with only the ones that differ — plus a snapshot of the row as it was when
 * asked. If the row has been changed since, the approver is told before anything is applied.
 */
let FGC = { rows: null };

const fgiCorrCanAsk = r => !!r && fgiCanEntry() && !fgiCanEdit()
  && String(r.createdBy || '').toLowerCase() === String(ME.email || '').toLowerCase()
  && !!FGI_KINDS[r.txnType];
const fgiCorrPending = () => Object.values(FGC.rows || {}).filter(q => q && q.status === 'pending');
const fgiCorrOf = id => (FGC.rows || {})[id] || null;

async function fgiCorrLoad() {
  try { const v = await ptGet('pt_fgiCorrReqs'); FGC.rows = v && typeof v === 'object' ? v : {}; }
  catch (e) { FGC.rows = FGC.rows || {}; }
  fgiCorrBadge();
}

function fgiCorrBadge() {
  const el = $('fgiCorrBadge'); if (!el) return;
  const n = fgiCanEdit() ? fgiCorrPending().length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

/* ---- the one path every edit takes ----
 *
 * fgiEditSave reads the edit dialog; an approved correction hands in the values it carries. Both land
 * here, so an approval cannot do anything an edit would refuse.
 *   input = { txnType, date (ISO yyyy-mm-dd), sku, qty, who, orderNo, reason, remarks }
 *   A field left undefined is not changed.
 */
async function fgiEditApply(id, input) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return 'That movement is gone — somebody deleted it.';
  if (fgiIsMarker(r)) return 'That row is a marker for a transfer and cannot be edited.';
  /* An FBA dispatch is the one row somebody ELSE writes to — read it again, or an edit made on a
   * stale screen would change pieces the FBA team has just accepted. */
  if (r.txnType === 'FBA') {
    const fresh = await ptGet('pt_fgiLedger/' + id);
    if (!fresh || !fresh.txnType) return 'That dispatch is gone — somebody deleted it.';
    Object.assign(r, fresh);
  }
  const locked = fgiEditLocked(r);
  const has = k => input[k] !== undefined && input[k] !== null;
  /* A request asking to change what a locked row cannot change is refused with the reason, not half-applied. */
  if (locked && input._reqBy && ['txnType', 'sku', 'qty'].some(f => has(f) && String(f === 'sku' ? obUC(input[f]) : input[f])
    !== String(f === 'qty' ? fgiNum(r.qty) : (f === 'sku' ? obUC(r.sku) : r[f])))) return locked;
  const next = {};
  /* A row imported without a date shows its creation day; leaving that alone is not a change. */
  const isoWas = ptIsoDate(r.date) || String(r.createdAt || '').slice(0, 10);
  if (has('date') && input.date && input.date !== isoWas) next.date = fgiDmy(input.date);
  if (has('reason')) next.reason = String(input.reason).trim();
  if (has('remarks')) next.remarks = String(input.remarks).trim();
  if (!locked) {
    next.txnType = r.txnType === 'OPENING' ? 'OPENING' : (has('txnType') ? input.txnType : r.txnType);
    next.sku = obUC(has('sku') ? input.sku : r.sku);
    next.qty = has('qty') ? parseInt(input.qty, 10) : fgiNum(r.qty);
    if (!next.sku) return 'Put in the SKU.';
    if (next.txnType !== 'OPENING' && !FGI_KINDS[next.txnType]) return 'Pick what kind of movement this is.';
    if (next.sku !== obUC(r.sku) && !(PTG.mdb || []).some(x => x && obUC(x.sku) === next.sku))
      return `${next.sku} is not in the master database.`;
    if (!isFinite(next.qty) || (next.txnType === 'OPENING' ? next.qty === 0 : next.qty < 1))
      return next.txnType === 'OPENING' ? 'Put in the pieces — a correction may be negative, but not zero.' : 'Put in how many pieces.';
  }
  const kind = FGI_KINDS[next.txnType || r.txnType];
  if (kind) {
    const who = String(has('who') ? input.who : (r.issuedFor || r.receivedFrom || '')).trim();
    if (!who) return kind.dir < 0 ? 'Say who or what these are for.' : 'Say where these came from.';
    next[kind.dir < 0 ? 'issuedFor' : 'receivedFrom'] = who;
  }
  /* A receive belongs to an order — the same rule the entry form keeps. */
  if ((next.txnType || r.txnType) === 'RECEIVE') {
    const ord = obUC(has('orderNo') ? input.orderNo : (r.orderNo || ''));
    const sku = next.sku || obUC(r.sku);
    if (ord) {
      if (fgiOrdersFor(sku).some(o => o.orderNo === ord)) { next.orderNo = ord; next.orderSource = 'console'; }
      else if (fgiOrderKnown(ord)) return `${ord} is in the Order Console but has no line for ${sku}.`;
      else { next.orderNo = ord; next.orderSource = 'external'; }
    /* Old receipts from the Ready Goods sheet never had one; an edit that leaves the box empty does not make them invalid. */
    } else if ((has('orderNo') && r.txnType !== 'RECEIVE') || r.orderNo) return 'A receive needs the order it belongs to.';
  }

  /* The balance after, for every SKU the edit touches. */
  const after = Object.assign({}, r, next);
  const hit = new Map();
  hit.set(obUC(r.sku), -fgiEffect(r));
  hit.set(obUC(after.sku), (hit.get(obUC(after.sku)) || 0) + fgiEffect(after));
  for (const [sku, d] of hit) {
    const before = fgiOf(sku).current, then = before + d;
    if (then < 0 && then < before)
      return `You don't have enough stock — that would take ${sku} to ${nf(then)}, below zero.`
        + ` The India Store has ${nf(before)} piece(s) now.`;
  }

  const was = {}, updates = {};
  Object.keys(next).forEach(f => {
    const old = r[f] == null ? '' : r[f], nu = next[f];
    if (String(old) === String(nu)) return;
    was[f] = old; updates['pt_fgiLedger/' + id + '/' + f] = nu;
  });
  /* The type changed direction: the name moves to the field that direction reads, and the old one goes. */
  if (kind && updates['pt_fgiLedger/' + id + '/txnType'] !== undefined) {
    const other = kind.dir < 0 ? 'receivedFrom' : 'issuedFor';
    if (r[other] != null) { was[other] = r[other]; updates['pt_fgiLedger/' + id + '/' + other] = null; }
    if (next.txnType !== 'RECEIVE' && r.orderNo != null) {
      was.orderNo = r.orderNo; updates['pt_fgiLedger/' + id + '/orderNo'] = null; updates['pt_fgiLedger/' + id + '/orderSource'] = null;
    }
  }
  if (!Object.keys(was).length) return 'Nothing was changed.';
  const edits = (Array.isArray(r.edits) ? r.edits : []).concat(Object.assign({ at: new Date().toISOString(), by: ME.email, was },
    input._reqBy ? { requestedBy: input._reqBy } : {}));
  updates['pt_fgiLedger/' + id + '/edits'] = edits;
  if (input._extra) Object.assign(updates, input._extra);
  await ptPatch(updates);
  Object.keys(updates).forEach(p => {
    if (!/^pt_fgiLedger\//.test(p) || p.split('/')[1] !== id) return;
    const f = p.split('/').pop(); if (updates[p] === null) delete r[f]; else r[f] = updates[p];
  });
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `Changed: ${Object.keys(was).join(', ')} on ${obUC(r.sku)}`
    + ` · ${obUC(r.sku)} now reads ${nf(fgiOf(r.sku).current)}.`;
  return '';
}

async function fgiEditSave(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return 'That movement is gone — somebody deleted it.';
  const v = id2 => String((($(id2) || {}).value) == null ? '' : ($(id2) || {}).value);
  const input = { date: v('fgeDate'), reason: v('fgeReason'), remarks: v('fgeRemarks') };
  if (!fgiEditLocked(r)) Object.assign(input, { txnType: v('fgeType') || r.txnType, sku: v('fgeSku'), qty: v('fgeQty') });
  if (FGI_KINDS[input.txnType || r.txnType]) input.who = v('fgeWho');
  if ($('fgeOrd') && (input.txnType || r.txnType) === 'RECEIVE') input.orderNo = v('fgeOrd');
  return fgiEditApply(id, input);
}

/* ---- asking ---- */
function fgiCorrOpen(id) {
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return;
  if (!fgiCorrCanAsk(r)) { $('fgMsg').className = 'err'; $('fgMsg').textContent = 'You can ask for a correction only on an entry you made yourself.'; return; }
  const cur = fgiCorrOf(id);
  const k = FGI_KINDS[r.txnType];
  ptOpenDialog({
    title: 'Request a correction',
    subtitle: `${k.label} · ${obUC(r.sku)} · ${nf(fgiNum(r.qty))} piece(s) · ${r.date || String(r.createdAt || '').slice(0, 10)}`,
    note: 'Change what is wrong below, or ask for the entry to be removed, and say why. Nothing changes until '
      + 'somebody who can edit finished goods approves it.'
      + (cur && cur.status === 'rejected' ? ` Your last request was turned down: ${cur.note || 'no note'}.` : ''),
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label style="grid-column:1/-1">What should happen<select id="fgcKind">
          <option value="edit">Correct this entry</option><option value="delete">Remove this entry — it should not be there</option></select></label>
        <label>Type<select id="fgcType">${Object.keys(FGI_KINDS).map(t =>
          `<option value="${t}"${t === r.txnType ? ' selected' : ''}>${esc(FGI_KINDS[t].label)}</option>`).join('')}</select></label>
        <label>Date<input id="fgcDate" type="date" value="${esc(ptIsoDate(r.date) || String(r.createdAt || '').slice(0, 10))}"></label>
        <label style="grid-column:1/-1">SKU<input id="fgcSku" value="${esc(obUC(r.sku))}" style="font-family:ui-monospace,monospace;text-transform:uppercase"></label>
        <label>Pieces<input id="fgcQty" type="number" min="1" step="1" value="${esc(fgiNum(r.qty))}"></label>
        <label>${esc(k.who)}<input id="fgcWho" value="${esc(r.issuedFor || r.receivedFrom || '')}"></label>
        <label>Order No<input id="fgcOrd" value="${esc(r.orderNo || '')}" placeholder="receive only" style="font-family:ui-monospace,monospace;text-transform:uppercase"></label>
        <label>Reason on the entry<input id="fgcReason" value="${esc(r.reason || '')}"></label>
        <label style="grid-column:1/-1">Why is it wrong?<input id="fgcWhy" placeholder="e.g. typed 100 instead of 10, wrong SKU picked"></label>
      </div>`,
    onSave: () => fgiCorrSave(id),
    saveLabel: 'Send the request',
  });
}

async function fgiCorrSave(id) {
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return 'That entry is gone.';
  if (!fgiCorrCanAsk(r)) return 'You can ask for a correction only on an entry you made yourself.';
  const v = k => String((($(k) || {}).value) == null ? '' : ($(k) || {}).value).trim();
  const why = v('fgcWhy');
  if (!why) return 'Say why it is wrong — that is what the approver decides on.';
  await fgiCorrLoad();
  const cur = fgiCorrOf(id);
  if (cur && cur.status === 'pending') return 'A correction for this entry is already waiting.';
  const kind = v('fgcKind') === 'delete' ? 'delete' : 'edit';
  const change = {};
  if (kind === 'edit') {
    const was = { txnType: r.txnType, date: ptIsoDate(r.date) || String(r.createdAt || '').slice(0, 10), sku: obUC(r.sku),
      qty: String(fgiNum(r.qty)), who: r.issuedFor || r.receivedFrom || '', orderNo: r.orderNo || '', reason: r.reason || '' };
    const now = { txnType: v('fgcType') || r.txnType, date: v('fgcDate'), sku: obUC(v('fgcSku')), qty: v('fgcQty'), who: v('fgcWho'),
      orderNo: obUC(v('fgcOrd')), reason: v('fgcReason') };
    Object.keys(now).forEach(f => { if (String(now[f]) !== String(was[f])) change[f] = now[f]; });
    if (!Object.keys(change).length) return 'Nothing is different from the entry — change what is wrong, or choose "Remove this entry".';
    if (change.qty !== undefined && !(parseInt(change.qty, 10) >= 1)) return 'Pieces must be a whole number, 1 or more.';
  }
  const at = new Date().toISOString();
  const snap = Object.assign({}, r); delete snap._key; delete snap.edits;
  const rec = { id, status: 'pending', kind, change, why, by: ME.email, at, sku: obUC(r.sku), txnType: r.txnType, qty: fgiNum(r.qty), snapshot: snap };
  if (cur) rec.previous = (Array.isArray(cur.previous) ? cur.previous : []).concat({ status: cur.status, kind: cur.kind, why: cur.why || '',
    at: cur.at || '', answeredBy: cur.answeredBy || '', answeredAt: cur.answeredAt || '', note: cur.note || '' });
  await ptPut('pt_fgiCorrReqs/' + id, rec);
  FGC.rows = Object.assign({}, FGC.rows || {}, { [id]: rec });
  fgiCorrBadge();
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `Correction requested for ${obUC(r.sku)} — it is waiting for approval. The entry stays as it is until then.`;
  return '';
}

/** The cell a requester sees on their own entry: the button, or where their request stands. */
function fgiCorrCell(r) {
  if (!r || fgiIsMarker(r)) return '';
  const q = fgiCorrOf(fgiRowId(r));
  if (q && q.status === 'pending') return `<div><span class="pill pill-low" title="${esc(q.why || '')}">correction asked</span></div>`;
  let out = '';
  if (q && q.status === 'rejected')
    out += `<div class="muted" style="font-size:10.5px" title="${esc(q.note || '')}">correction rejected: ${esc(String(q.note || '').slice(0, 40))}</div>`;
  if (q && q.status === 'approved') out += '<div class="muted" style="font-size:10.5px">correction applied</div>';
  if (fgiCorrCanAsk(r))
    out += `<button class="ghost" data-fgcreq="${esc(fgiRowId(r))}" style="padding:2px 9px;font-size:12px">Request correction</button>`;
  return out;
}

/* ---- answering ---- */
const FGC_FIELD = { txnType: 'Type', date: 'Date', sku: 'SKU', qty: 'Pieces', who: 'From / for', orderNo: 'Order No', reason: 'Reason' };

function fgiRenderCorr() {
  const rows = fgiCorrPending().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  FGI.shown = rows;
  const can = fgiCanEdit();
  const head = '<thead><tr>' + ['Asked', 'Entry', 'SKU', 'What they want', 'Why', 'By', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(q => {
    const r = (FGI.rows || []).find(x => fgiRowId(x) === q.id);
    const want = q.kind === 'delete' ? '<b style="color:var(--bad)">Remove the entry</b>'
      : Object.entries(q.change || {}).map(([f, val]) => `${esc(FGC_FIELD[f] || f)}: <span class="muted">${esc(fgiCorrWas(q, f))}</span> → <b>${esc(val)}</b>`).join('<br>');
    return '<tr>'
      + `<td class="frz">${esc(String(q.at || '').slice(0, 16).replace('T', ' '))}</td>`
      + `<td>${esc(String(q.txnType || '').toLowerCase())} · ${nf(q.qty)}${r ? '' : '<div class="err" style="font-size:10.5px">entry already gone</div>'}</td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(q.sku)}</td>`
      + `<td style="text-align:left;font-size:12px">${want}</td>`
      + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(q.why)}</td>`
      + `<td>${esc(String(q.by || '').split('@')[0])}</td>`
      + `<td style="white-space:nowrap">${can ? `<button data-fgcok="${esc(q.id)}" style="padding:2px 9px;font-size:12px">Approve</button>`
        + ` <button class="ghost" data-fgcno="${esc(q.id)}" style="padding:2px 9px;font-size:12px;color:var(--bad)">Reject</button>` : ''}</td>`
      + '</tr>';
  }).join('') : '<tr><td colspan="7" class="muted" style="padding:16px">No correction is waiting.</td></tr>') + '</tbody>';
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(rows.length)} correction request(s) waiting · approving applies exactly what was asked, with the same checks an edit has`;
}

function fgiCorrWas(q, f) {
  const s = q.snapshot || {};
  if (f === 'who') return s.issuedFor || s.receivedFrom || '';
  if (f === 'date') return ptIsoDate(s.date) || String(s.createdAt || '').slice(0, 10);
  return s[f] == null ? '' : s[f];
}

async function fgiCorrApprove(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  await fgiCorrLoad();
  const q = fgiCorrOf(id);
  if (!q || q.status !== 'pending') return 'That request is no longer waiting.';
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id);
  const at = new Date().toISOString();
  const answer = { ['pt_fgiCorrReqs/' + id + '/status']: 'approved', ['pt_fgiCorrReqs/' + id + '/answeredBy']: ME.email,
    ['pt_fgiCorrReqs/' + id + '/answeredAt']: at };
  if (!r) {
    await ptPatch({ ['pt_fgiCorrReqs/' + id + '/status']: 'closed', ['pt_fgiCorrReqs/' + id + '/note']: 'the entry was already gone',
      ['pt_fgiCorrReqs/' + id + '/answeredBy']: ME.email, ['pt_fgiCorrReqs/' + id + '/answeredAt']: at });
    FGC.rows[id] = Object.assign({}, q, { status: 'closed' }); fgiCorrBadge(); renderFgi();
    return 'That entry has already been deleted — the request has been closed.';
  }
  /* Changed since it was asked? Then what the request says it "was" is no longer true. */
  const moved = ['txnType', 'sku', 'qty'].some(f => String((q.snapshot || {})[f]) !== String(r[f]));
  if (moved && !FGC._ok) { FGC._ok = true; return 'That entry has been changed since the request was made. Press Approve again to apply the request on top of it.'; }
  FGC._ok = false;
  if (q.kind === 'delete') {
    const plan = fgiDeletePlan([id]);
    if (!plan.gone.length) return 'It cannot be removed: ' + ((plan.refused[0] || {}).why || 'unknown') + '.';
    Object.assign(plan.updates, answer);
    const why = await fgiDeleteRun(plan);
    if (why) return why;
  } else {
    const c = q.change || {};
    const why = await fgiEditApply(id, Object.assign({}, c, { _reqBy: q.by, _extra: answer }));
    if (why) return why;
  }
  FGC.rows[id] = Object.assign({}, q, { status: 'approved', answeredBy: ME.email, answeredAt: at });
  fgiCorrBadge();
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `Correction approved for ${q.sku} (asked by ${String(q.by || '').split('@')[0]}) · ${q.sku} now reads ${nf(fgiOf(q.sku).current)}.`;
  return '';
}

function fgiCorrRejectOpen(id) {
  const q = fgiCorrOf(id); if (!q) return;
  ptOpenDialog({
    title: 'Reject the correction',
    subtitle: `${q.sku} · asked by ${String(q.by || '').split('@')[0]}`,
    note: 'The entry stays as it is. Your note is shown to them on the entry.',
    fields: [{ key: 'note', label: 'Why not', value: '', span: true }],
    onSave: v => fgiCorrReject(id, v.note),
    saveLabel: 'Reject',
  });
}

async function fgiCorrReject(id, note) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  if (!String(note || '').trim()) return 'Say why — they asked for a reason and get one back.';
  await fgiCorrLoad();
  const q = fgiCorrOf(id);
  if (!q || q.status !== 'pending') return 'That request is no longer waiting.';
  const at = new Date().toISOString();
  await ptPatch({ ['pt_fgiCorrReqs/' + id + '/status']: 'rejected', ['pt_fgiCorrReqs/' + id + '/note']: String(note).trim(),
    ['pt_fgiCorrReqs/' + id + '/answeredBy']: ME.email, ['pt_fgiCorrReqs/' + id + '/answeredAt']: at });
  FGC.rows[id] = Object.assign({}, q, { status: 'rejected', note: String(note).trim(), answeredBy: ME.email, answeredAt: at });
  fgiCorrBadge();
  renderFgi();
  return '';
}

