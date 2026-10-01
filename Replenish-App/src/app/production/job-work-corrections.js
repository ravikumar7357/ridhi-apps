/* ================= JOB WORK CORRECTION REQUESTS =================
 *
 * Ravi, 2026-09-22: "same correction request jo job work me entry karne wala h uska bhi ho" — the
 * Finished Goods pattern, for the Job Work Register. Somebody who may ENTER job work but not change an
 * entry asks; somebody who may change entries ("Can edit production entries") answers.
 *
 * THE SAME RULES AS THE EDIT BOX, because an approved request IS an edit: issued at least 1, received
 * and rejected not more than issued, the order's cap, and a SKU that exists. A SKU or a date is an
 * admin's to change there, so a request that changes one is an admin's to approve here.
 *
 * APPROVAL READS THE ROW AS IT IS NOW, not as it was when somebody asked — it may have been corrected
 * in the meantime, and the request is re-checked against that.
 */
let JWC = { rows: null };                       // null = never read
const JWC_FIELDS = [['empName', 'Karigar'], ['issuePieces', 'Issued'], ['receivedPieces', 'Received'],
  ['rejectionPieces', 'Rejected'], ['remarks', 'Remarks'], ['sku', 'SKU'], ['issueDate', 'Issue date'], ['receivingDate', 'Receiving date']];
const JWC_ADMIN_ONLY = ['sku', 'issueDate', 'receivingDate'];

async function jwCorrLoad() {
  try { const v = await ptGet('pt_jwCorrReqs'); JWC.rows = v && typeof v === 'object' ? v : {}; }
  catch (e) { JWC.rows = JWC.rows || {}; }
  jwCorrBadge();
}
const jwCorrPending = () => Object.values(JWC.rows || {}).filter(q => q && q.status === 'pending');
const jwCorrOfRow = rowId => jwCorrPending().find(q => q.rowId === rowId) || null;
/* Everybody on the Job Work Register except an admin may ASK — an editor too, for what the Edit box does not let them
 * change (a SKU, a date, a completed row). An admin just edits. */
const jwCanAsk = () => (ME.tabs || []).includes('pbase') && !ME.admin;

/** What a row would become with these changes, checked the way the Edit box checks it. { err } or { next }. */
function jwCorrPlan(r, change) {
  const c = change || {};
  const has = k => c[k] !== undefined && c[k] !== null && String(c[k]).trim() !== '';
  const name = has('empName') ? String(c.empName).trim() : (r.empName || '');
  const issued = has('issuePieces') ? parseInt(c.issuePieces, 10) : ptNum(r.issuePieces);
  const recv = has('receivedPieces') ? parseInt(c.receivedPieces, 10) : ptNum(r.receivedPieces);
  const rej = has('rejectionPieces') ? parseInt(c.rejectionPieces, 10) : ptNum(r.rejectionPieces);
  const sku = has('sku') ? obUC(c.sku) : obUC(r.sku || '');
  if (!name) return { err: 'Enter the karigar\'s name.' };
  if (!isFinite(issued) || issued < 1) return { err: 'Issued pieces must be at least 1.' };
  if (!isFinite(recv) || recv < 0) return { err: 'Received pieces cannot be negative.' };
  if (!isFinite(rej) || rej < 0) return { err: 'Rejected pieces cannot be negative.' };
  if (recv + rej > issued) return { err: `Received ${recv} plus rejected ${rej} is more than the ${issued} issued.` };
  let at = r.articleType, sub = r.articleSubtype, col = r.color, sz = r.size;
  if (sku !== obUC(r.sku || '')) {
    const m = cutSkuOf(sku);
    if (!m) return { err: `SKU ${sku} is not in the master database.` };
    at = m.articleType || ''; sub = m.subtype || ''; col = m.color || ''; sz = m.size || '';
  }
  if (r.orderNo && issued !== ptNum(r.issuePieces)) {
    const gErr = bdGuard(r.orderNo, sku, issued, r.id);
    if (gErr) return { err: gErr };
  }
  const pending = Math.max(0, issued - recv - rej);
  const next = Object.assign({}, r, {
    empName: name, sku, articleType: at, articleSubtype: sub, color: col, size: sz,
    issuePieces: issued, receivedPieces: recv, rejectionPieces: rej, pendingPieces: pending, frozen: pending <= 0,
    remarks: c.remarks !== undefined ? String(c.remarks || '').trim() : (r.remarks || ''),
  });
  if (has('issueDate')) next.issueDate = ptStampFrom(r.issueDate, c.issueDate);
  if (c.receivingDate !== undefined) next.receivingDate = String(c.receivingDate || '').trim() ? ptStampFrom(r.receivingDate, c.receivingDate) : '';
  if (next.frozen && !next.receivingDate) next.receivingDate = ptNow();
  delete next._key;
  return { next };
}

/** The fields a request would actually change, as [field, from, to]. */
function jwCorrDiff(r, change) {
  const out = [];
  JWC_FIELDS.forEach(([k]) => {
    if (!change || change[k] === undefined) return;
    const now = ['issueDate', 'receivingDate'].indexOf(k) >= 0 ? ptIsoDate(r[k]) : String(r[k] == null ? '' : r[k]);
    const to = String(change[k] == null ? '' : change[k]).trim();
    const same = ['issuePieces', 'receivedPieces', 'rejectionPieces'].indexOf(k) >= 0 ? ptNum(now) === ptNum(to)
      : k === 'sku' ? obUC(now) === obUC(to) : String(now).trim() === to;
    if (!same) out.push([k, now, to]);
  });
  return out;
}

async function jwCorrAsk(rowId, change, why) {
  if (!(ME.tabs || []).includes('pbase')) return 'This screen is not open to your account.';
  const r = (PT.base || []).find(x => x && x.id === rowId);
  if (!r) return 'That entry is gone — press Refresh.';
  if (!String(why || '').trim()) return 'Say what is wrong — the person approving it has to know.';
  if (jwCorrOfRow(rowId)) return 'A change to this entry is already waiting for approval.';
  const diff = jwCorrDiff(r, change);
  if (!diff.length) return 'Nothing is different from what the entry already says.';
  const clean = {}; diff.forEach(([k, , to]) => { clean[k] = to; });
  const plan = jwCorrPlan(r, clean);
  if (plan.err) return plan.err;
  const now = new Date().toISOString();
  const id = 'jwc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rec = { id, rowId, sku: r.sku || '', empName: r.empName || '', orderNo: r.orderNo || '',
    snapshot: Object.assign({}, r, { _key: undefined }), change: clean, why: String(why).trim(),
    by: ME.email, at: now, status: 'pending' };
  delete rec.snapshot._key;
  try { await ptPut('pt_jwCorrReqs/' + id, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  JWC.rows = Object.assign({}, JWC.rows || {}, { [id]: rec });
  jwCorrBadge();
  return '';
}

/** Approve: the row is changed and the request closed in ONE write. */
async function jwCorrApprove(id) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const q = (JWC.rows || {})[id];
  if (!q || q.status !== 'pending') return 'That request has already been answered.';
  /* Nobody approves their own request, or asking would be a way round the Edit box's limits. */
  if (q.by === ME.email && !ME.admin) return 'You asked for this change — somebody else has to approve it.';
  if (Object.keys(q.change || {}).some(k => JWC_ADMIN_ONLY.indexOf(k) >= 0) && !ME.admin)
    return 'It changes the SKU or a date, which only an admin may change — an admin has to approve it.';
  const r = (PT.base || []).find(x => x && x.id === q.rowId);
  if (!r) return 'The entry it is about has been deleted — reject the request.';
  const plan = jwCorrPlan(r, q.change);
  if (plan.err) return 'Cannot be applied as it stands now: ' + plan.err;
  const now = new Date().toISOString();
  const next = Object.assign(plan.next, { editedBy: ME.email, editedAt: now, correctedBy: q.by, correctionId: id });
  const done = Object.assign({}, q, { status: 'approved', answeredBy: ME.email, answeredAt: now });
  try { await ptPatch({ ['pt_baseData/' + r.id]: next, ['pt_jwCorrReqs/' + id]: done }); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PT.base = (PT.base || []).map(x => (x && x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
  JWC.rows = Object.assign({}, JWC.rows, { [id]: done });
  jwCorrBadge();
  return '';
}

async function jwCorrReject(id, note) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const q = (JWC.rows || {})[id];
  if (!q || q.status !== 'pending') return 'That request has already been answered.';
  if (!String(note || '').trim()) return 'Say why it is refused — the person who asked will see it.';
  const done = Object.assign({}, q, { status: 'rejected', answeredBy: ME.email, answeredAt: new Date().toISOString(), answerNote: String(note).trim() });
  try { await ptPut('pt_jwCorrReqs/' + id, done); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  JWC.rows = Object.assign({}, JWC.rows, { [id]: done });
  jwCorrBadge();
  return '';
}

function jwCorrBadge() {
  const n = ptCanEdit() ? jwCorrPending().length : 0;
  const el = $('jwCorrBadge');
  if (el) { el.textContent = n ? String(n) : ''; el.classList.toggle('hide', !n); }
  const b = $('pbCorr');
  if (b) { b.classList.toggle('hide', !n); b.textContent = n === 1 ? '1 correction request' : nf(n) + ' correction requests'; }
}

function jwCorrAskOpen(rowId) {
  const r = (PT.base || []).find(x => x && x.id === rowId); if (!r) return;
  ptOpenDialog({
    title: 'Ask to change this entry',
    subtitle: `${r.empName || ''} · ${r.sku || ''} · issued ${r.issueDate || ''}`,
    note: 'Change only what is wrong and say why. Wrong size or colour? Type the SKU of the right item — the article, colour '
      + 'and size come from it. Somebody who may edit production entries approves it; a change of SKU or date needs an admin.',
    fields: [
      { key: 'empName', label: 'Karigar', value: r.empName || '' },
      { key: 'issuePieces', label: 'Issued', type: 'number', value: ptNum(r.issuePieces) },
      { key: 'receivedPieces', label: 'Received', type: 'number', value: ptNum(r.receivedPieces) },
      { key: 'rejectionPieces', label: 'Rejected', type: 'number', value: ptNum(r.rejectionPieces) },
      { key: 'sku', label: 'SKU', value: r.sku || '' },
      { key: 'issueDate', label: 'Issue date', type: 'date', value: ptIsoDate(r.issueDate) },
      { key: 'receivingDate', label: 'Receiving date', type: 'date', value: ptIsoDate(r.receivingDate) },
      { key: 'remarks', label: 'Remarks', span: true, value: r.remarks || '' },
      { key: 'why', label: 'What is wrong (required)', span: true, value: '' },
    ],
    saveLabel: 'Send for approval',
    onSave: async v => {
      const change = {}; JWC_FIELDS.forEach(([k]) => { if (v[k] !== undefined) change[k] = v[k]; });
      const err = await jwCorrAsk(rowId, change, v.why);
      if (!err) { renderPbase(); $('pbMsg').className = 'muted'; $('pbMsg').textContent = 'Sent for approval. The entry changes once it is approved.'; }
      return err;
    },
  });
}

function jwCorrListOpen() {
  const list = jwCorrPending().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const label = k => (JWC_FIELDS.find(f => f[0] === k) || [k, k])[1];
  const body = list.map(q => {
    const live = (PT.base || []).find(x => x && x.id === q.rowId);
    const diff = live ? jwCorrDiff(live, q.change) : Object.entries(q.change || {}).map(([k, v]) => [k, '', v]);
    const adminOnly = Object.keys(q.change || {}).some(k => JWC_ADMIN_ONLY.indexOf(k) >= 0);
    return `<tr><td style="text-align:left">${esc(ptIsoDate(q.at) || '')}<div class="muted" style="font-size:11px">${esc(String(q.by || '').split('@')[0])}</div></td>`
      + `<td style="text-align:left;font-size:12px">${esc(q.empName)}<div class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${esc(q.sku)}</div></td>`
      + `<td style="text-align:left;font-size:12px;white-space:normal">${diff.length ? diff.map(([k, a, b]) => `${esc(label(k))}: ${esc(a || '—')} → <b>${esc(b || '—')}</b>`).join('<br>') : '<span class="muted">already as asked</span>'}`
      + (adminOnly ? '<div class="muted" style="font-size:11px">needs an admin</div>' : '') + (live ? '' : '<div class="err" style="font-size:11px">entry deleted</div>') + '</td>'
      + `<td style="text-align:left;font-size:12px;white-space:normal;max-width:220px">${esc(q.why || '')}</td>`
      + `<td style="white-space:nowrap"><button data-jwy="${esc(q.id)}" style="padding:2px 9px;font-size:12px"${(adminOnly || q.by === ME.email) && !ME.admin ? ' disabled' : ''}>Approve</button> `
      + `<button class="ghost" data-jwn="${esc(q.id)}" style="padding:2px 9px;font-size:12px">Reject</button></td></tr>`;
  }).join('');
  ptOpenDialog({
    title: 'Correction requests',
    subtitle: list.length ? `${nf(list.length)} waiting` : 'Nothing waiting',
    note: 'Approving changes the entry exactly as shown — and with it the order balance, the weekly report and the karigar\'s pay.',
    html: list.length ? `<div class="xlwrap" style="max-height:56vh;border:1px solid var(--line);border-radius:10px"><table class="xl"><thead><tr>`
      + ['Asked', 'Karigar / SKU', 'Change', 'Why', ''].map(h => `<th>${h}</th>`).join('') + `</tr></thead><tbody>${body}</tbody></table></div>`
      : '<div class="muted" style="padding:22px;text-align:center">Nothing is waiting to be answered.</div>',
    saveLabel: '',
  });
  const again = async (fn) => { const err = await fn(); if (err) return ptDlgMsg(err, true); ptDlgClose(); renderPbase(); jwCorrListOpen(); };
  $('ptDlgBody').querySelectorAll('[data-jwy]').forEach(b => { b.onclick = () => again(() => jwCorrApprove(b.getAttribute('data-jwy'))); });
  $('ptDlgBody').querySelectorAll('[data-jwn]').forEach(b => { b.onclick = () => {
    const note = prompt('Why is it refused? The person who asked will see this.');
    if (note === null) return;
    again(() => jwCorrReject(b.getAttribute('data-jwn'), note));
  }; });
}
$('pbCorr').onclick = jwCorrListOpen;


/**
 * Put the waiting count on the button, and take the button away when nothing is waiting.
 *
 * A queue somebody has to remember to open is a queue that fills up: eight requests sat unanswered
 * for a week in the tool this replaces, and nothing on any screen said so.
 */
function apvPaint() {
  const b = $('pbApv'); if (!b) return;
  const n = ME.admin ? apvOpen().length : 0;
  b.classList.toggle('hide', !n);
  if (n) {
    b.textContent = n === 1 ? '1 deletion request' : nf(n) + ' deletion requests';
    b.style.color = 'var(--bad)';
    b.style.fontWeight = '600';
  }
}

$('bdmClose').onclick = bdModalClose;
$('bdmCancel').onclick = bdModalClose;
$('bdModal').addEventListener('click', e => { if (e.target === $('bdModal')) bdModalClose(); });

$('bdmSave').onclick = async () => {
  const r = BD_M; if (!r) return;
  /* A page left open while the right is withdrawn still has the dialog on it. The lock is here. */
  if (!ptCanEdit()) return bdModalMsg(PT_NO_EDIT, true);
  const admin = !!ME.admin;
  const name = $('bdmName').value.trim();
  const type = $('bdmType').value.trim();
  const issued = parseInt($('bdmIssue').value, 10);
  const recv = parseInt($('bdmRecv').value, 10);
  const rej = parseInt($('bdmRej').value, 10);
  const sku = admin ? $('bdmSku').value.trim() : (r.sku || '');

  if (!name) return bdModalMsg('Enter the employee name.', true);
  if (!type) return bdModalMsg('Select the employment type.', true);
  if (!isFinite(issued) || issued < 1) return bdModalMsg('Issue pieces must be at least 1.', true);
  if (!isFinite(recv) || recv < 0) return bdModalMsg('Received pieces cannot be negative.', true);
  if (!isFinite(rej) || rej < 0) return bdModalMsg('Rejection pieces cannot be negative.', true);
  if (recv + rej > issued)
    return bdModalMsg(`Received ${recv} plus rejected ${rej} is more than the ${issued} issued.`, true);

  /* A changed SKU re-derives the item from the master database, exactly as the dialog promises.
   * A custom SKU that is not in the master database is left alone — it never was in there. */
  let at = r.articleType, sub = r.articleSubtype, col = r.color, sz = r.size;
  if (admin && obUC(sku) !== obUC(r.sku)) {
    let m = cutSkuOf(sku);
    /* Not in this page's copy: ask the database before refusing — it may have been added since the copy was read. */
    if (!m) { bdModalMsg('Checking the master database…'); m = await mdbFetchSku(sku); }
    if (!m) return bdModalMsg(`SKU ${sku} is not in the master database — it cannot be changed to one that does not exist.`, true);
    at = m.articleType || ''; sub = m.subtype || ''; col = m.color || ''; sz = m.size || '';
  }

  /* The order cap still applies to a changed issue quantity — with this row excluded, or it would
   * refuse to save the number it is already holding. Custom entries have no order to check against. */
  if (r.orderNo && issued !== ptNum(r.issuePieces)) {
    const gErr = bdGuard(r.orderNo, sku, issued, r.id);
    if (gErr) return bdModalMsg(gErr, true);
  }

  const pending = Math.max(0, issued - recv - rej);
  const next = Object.assign({}, r, {
    empName: name, empType: type, sku: obUC(sku),
    articleType: at, articleSubtype: sub, color: col, size: sz,
    issuePieces: issued, receivedPieces: recv, rejectionPieces: rej,
    pendingPieces: pending, frozen: pending <= 0,
    remarks: $('bdmRemarks').value.trim(),
    editedBy: ME.email, editedAt: new Date().toISOString(),
  });
  if (admin) {
    if ($('bdmIssueDate').value) next.issueDate = ptStampFrom(r.issueDate, $('bdmIssueDate').value);
    next.receivingDate = $('bdmRecvDate').value ? ptStampFrom(r.receivingDate, $('bdmRecvDate').value) : '';
  }
  // Completing the row here still has to stamp a receiving date, or a finished row has no date at all.
  if (next.frozen && !next.receivingDate) next.receivingDate = ptNow();
  if (!next.frozen && pending > 0 && !recv && !rej) next.receivingDate = next.receivingDate || '';
  delete next._key;

  $('bdmSave').disabled = true;
  bdModalMsg('Saving…');
  try {
    await ptPut('pt_baseData/' + next.id, next);
    PT.base = (PT.base || []).map(x => (x.id === next.id ? Object.assign({ _key: next.id }, next) : x));
    bdModalClose();
    renderPbase();
    $('pbMsg').className = 'muted';
    $('pbMsg').textContent = `Updated ${obUC(next.sku)} · ${next.empName} — `
      + (next.frozen ? 'complete, nothing pending.' : `${nf(pending)} still pending.`);
  } catch (e) {
    bdModalMsg('Not saved: ' + (e.message || e), true);
  }
  $('bdmSave').disabled = false;
};

/** Keep the time of day that was already on the record; only the day changes. */
function ptStampFrom(existing, yyyymmdd) {
  const [y, mo, d] = String(yyyymmdd).split('-').map(Number);
  const old = ptDtMs(existing);
  const t = old ? new Date(old) : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d || 1)}/${p(mo || 1)}/${y}, ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/* ---- asking for a deletion, and answering it ----
 *
 * Deleting a production row moves the order balance, the cutting cap, the weekly report and a
 * worker's pay at once, so it stays admin-only. What was missing is the other half: somebody who may
 * correct a row but not delete it had no way to ASK. In the old tool they could, and eight requests
 * are sitting in pt_approvals unanswered — the oldest from 4 September.
 *
 * Stored where the old tool stored them, in the same shape, so the eight already waiting are read as
 * they stand and nothing anybody asked for is lost.
 */
let APV = null;                         // null = never read

async function apvLoad(force) {
  if (APV && !force) return APV;
  try { APV = ptList(await ptGet('pt_approvals')); } catch (e) { APV = APV || []; }
  return APV;
}
/** Open requests, newest first — an answered one is deleted, so everything here is waiting. */
const apvOpen = () => (APV || []).filter(r => r && r.id && r.type === 'del_entry');

/**
 * Where a request is STORED, which is not always the id of the row it is about.
 *
 * Of the eight waiting when this was built, one is filed under a key ending "_dup1": the old tool met
 * a second request for a row somebody had already asked about and parked it beside the first. An
 * answer addressed to the row id would clear the wrong one and leave that dup waiting for ever.
 */
const apvKey = r => String((r && (r._key || r.id)) || '');

/**
 * Ask for a Base Data row to be deleted.
 *
 * THE ROW ITSELF TRAVELS WITH THE REQUEST. An admin answering it a week later needs to see what they
 * are agreeing to, and by then the row may have been edited — or the person who asked may have
 * forgotten why. The old tool carried the whole row alongside the request for the same reason, so this keeps it.
 */
async function apvAsk(r, why) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  if (!r || !r.id) return 'That entry is gone.';
  if (ME.admin) return 'You can delete it yourself — there is nobody to ask.';
  await apvLoad();
  if (apvOpen().some(x => x.id === r.id)) return 'Somebody has already asked for this one.';
  const rec = { id: r.id, type: 'del_entry', at: new Date().toISOString(), by: ME.email,
    why: String(why || '').trim(),
    label: `Delete Job Work Register entry — ${r.empName || '?'} / ${r.sku || '?'}`,
    data: Object.assign({}, r) };
  delete rec.data._key;
  try { await ptPut('pt_approvals/' + r.id, rec); }
  catch (e) { return 'Not sent: ' + (e.message || e); }
  /* Filed under the row id, so a second ask for the same row replaces the first rather than
   * doubling it — which is how the old tool ended up with a dup. */
  APV = (APV || []).filter(x => x && x.id !== r.id).concat([Object.assign({ _key: r.id }, rec)]);
  return '';
}

/**
 * Answer one. Approving DELETES the row it is about; refusing only closes the request.
 *
 * The row is re-read at the moment of approval rather than taken from the request's snapshot: a week
 * is long enough for somebody to have corrected it instead, and deleting what the snapshot said
 * would throw away work nobody asked to lose.
 */
async function apvAnswer(key, approve, note) {
  if (!ME.admin) return 'Only an admin can answer a deletion request.';
  await apvLoad();
  const req = apvOpen().find(x => apvKey(x) === key);
  if (!req) return 'That request is no longer waiting.';
  const id = req.id;                       // the row it is about, not where the request is filed
  if (approve) {
    const live = (PT.base || []).find(x => x && x.id === id);
    if (!live) { await apvDrop(key); return 'That entry is already gone. The request has been cleared.'; }
    try { await ptDelete('pt_baseData/' + id); }
    catch (e) { return 'Not deleted: ' + (e.message || e); }
    PT.base = (PT.base || []).filter(x => x && x.id !== id);
  }
  await apvDrop(key);
  renderPbase();
  return '';
}

/** An answered request is removed: the queue is what is still waiting, and nothing else. */
async function apvDrop(key) {
  try { await ptDelete('pt_approvals/' + key); } catch (e) { /* it may already be gone */ }
  APV = (APV || []).filter(x => apvKey(x) !== key);
}

$('bdmAsk').onclick = async () => {
  const r = BD_M; if (!r) return;
  const why = prompt(`Ask for this entry to be deleted?\n\n${nf(ptNum(r.issuePieces))} piece(s) of ${r.sku} `
    + `issued to ${r.empName} on ${r.issueDate}.\n\nSay why, so whoever answers knows what happened.`, '');
  if (why === null) return;                        // Cancel is not a request
  $('bdmAsk').disabled = true;
  const err = await apvAsk(r, why);
  bdModalMsg(err || 'Asked. It is waiting for an admin, and stays in the register until one answers.', !!err);
  $('bdmAsk').disabled = false;
};

$('bdmDelete').onclick = async () => {
  const r = BD_M; if (!r || !ME.admin) return;
  /* Deleting a production record removes pieces from every count built on it — payroll included —
   * so the confirmation says exactly what is going, not "are you sure?". */
  const what = `${nf(ptNum(r.issuePieces))} piece(s) of ${r.sku} issued to ${r.empName}`
    + (r.orderNo ? ` against ${r.orderNo}` : '') + ` on ${r.issueDate}`;
  if (!confirm(`Delete this entry?\n\n${what}\n\nThis cannot be undone, and every figure counted off `
    + 'this row changes with it.')) return;
  $('bdmDelete').disabled = true;
  bdModalMsg('Deleting…');
  try {
    await ptDelete('pt_baseData/' + r.id);
    // Its zipper consumption goes with it, or the stock stays spent on an entry that no longer exists.
    await ptUnconsumeZippers(r.id);
    await ptUnconsumeRuffle(r.id);
    PT.base = (PT.base || []).filter(x => x.id !== r.id);
    bdModalClose();
    renderPbase();
    $('pbMsg').className = 'muted';
    $('pbMsg').textContent = `Deleted — ${what}.`;
  } catch (e) {
    bdModalMsg('Not deleted: ' + (e.message || e), true);
  }
  $('bdmDelete').disabled = false;
};

