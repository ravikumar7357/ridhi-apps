
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
const jwCanAsk = () => ME.tabs.includes('pbase') && !ptCanEdit();

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
  if (!ME.tabs.includes('pbase')) return 'This screen is not open to your account.';
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
    note: 'Change only what is wrong and say why. Somebody who may edit production entries approves it; '
      + 'a change of SKU or date needs an admin.',
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
      + `<td style="white-space:nowrap"><button data-jwy="${esc(q.id)}" style="padding:2px 9px;font-size:12px"${adminOnly && !ME.admin ? ' disabled' : ''}>Approve</button> `
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
