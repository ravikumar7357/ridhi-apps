/* ================= QUALITY CONTROL =================
 *
 * Two registers that only make sense together:
 *
 *   CHECKS    — pieces inspected. Each check splits into OK, "for alteration", and rejected.
 *               A piece can only be checked once it has been RECEIVED back in Base Data, so the
 *               ceiling is `received − already checked`. There is a deliberate escape ("any SKU"),
 *               because the old tool has one: some stock is inspected that never went out on a
 *               Base Data issue, and refusing to record that would just push it off the books.
 *
 *   ISSUANCE  — pieces handed to somebody to alter. The ceiling here is what QC actually flagged:
 *               `for alteration − already issued`. Issuing against a SKU nothing was flagged for is
 *               refused outright, because that number would come from nowhere.
 *
 * A SKU's description is read from the master database, falling back to Base Data — custom SKUs are
 * not in the master database and would otherwise be inspected as a blank row.
 */
let QC = { checks: null, issue: null, ret: null, err: '', busy: false, at: '' };

async function ensureQc() {
  if (QC.checks === null || !PTG.mdb) {
    QC.busy = true; renderQc();
    if (!PTG.mdb) await ptLoadGates();
    if (!PTE.emp) await ptLoadEmp();
    try {
      const [c, i, t] = await Promise.all([ptGet('pt_qcChecks'), ptGet('pt_qcIssuance'), ptGet('pt_qcReturns')]);
      QC.checks = ptList(c); QC.issue = ptList(i); QC.ret = ptList(t); QC.err = '';
    } catch (e) { QC.err = e.message || String(e); QC.checks = QC.checks || []; QC.issue = QC.issue || []; QC.ret = QC.ret || []; }
    QC.at = ptStamp(); QC.busy = false;
  }
  renderQc();
}

const qcNorm = v => String(v == null ? '' : v).trim().toUpperCase();

/** What a SKU is: the master database first, then Base Data — custom SKUs live only in the latter. */
function qcParts(sku) {
  const m = cutSkuOf(sku);
  if (m) return { at: m.articleType || '', sub: m.subtype || '', col: m.color || '', size: m.size || '', brand: m.brand || '' };
  const b = (PT.base || []).find(r => qcNorm(r.sku) === qcNorm(sku));
  return b ? { at: b.articleType || '', sub: b.articleSubtype || '', col: b.color || '', size: b.size || '', brand: '' }
           : { at: '', sub: '', col: '', size: '', brand: '' };
}

const qcReceived = sku => (PT.base || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.receivedPieces) : 0), 0);
const qcChecked = sku => (QC.checks || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.checked) : 0), 0);
const qcAvailToCheck = sku => qcReceived(sku) - qcChecked(sku);
const qcAltTotal = sku => (QC.checks || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.forAlteration) : 0), 0);
const qcIssuedTotal = sku => (QC.issue || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.pieces) : 0), 0);
const qcAvailToIssue = sku => qcAltTotal(sku) - qcIssuedTotal(sku);

/* ---- what has come back ----
 *
 * A return is booked against ONE issuance, not against a SKU: the question the floor asks is "has
 * Pradeep sent back the eleven he took", and a SKU total cannot answer it.
 */
const qcRetOf = id => (QC.ret || []).reduce((a, r) =>
  a + (String(r.issuanceId || '') === String(id) ? ptNum(r.received) : 0), 0);
/** Still with the person it was issued to. */
const qcPendingOf = r => Math.max(0, ptNum(r && r.pieces) - qcRetOf(r && r.id));
/** Every issuance with pieces still out, oldest first — the oldest is the one to chase. */
/** The three jobs on this screen, in the order the work moves. */
const QC_VIEWS = [
  ['inbox', 'Waiting for QC', 'qc'],
  ['dept', 'Spotting & touching', 'qc'],
  ['ledger', 'QC ledger (day-wise)', 'qc'],
  ['checks', 'Checks', 'qc'],
  ['issue', 'Issued for alteration', 'qcalt'],
  ['ret', 'Received back from alteration', 'qcret'],
];
/**
 * Which of them this account may open. An admin has all three; so does anybody whose access was
 * granted before the split, because the migration gave them the other two.
 */
const qcViewsAllowed = () => (ME.admin ? QC_VIEWS : QC_VIEWS.filter(v => (ME.tabs || []).includes(v[2])));
/** The view actually in force — never one the account has not been given. */
function qcView() {
  const allowed = qcViewsAllowed().map(v => v[0]);
  if (!allowed.length) return '';
  const want = ($('qcView') || {}).value || '';
  return allowed.includes(want) ? want : allowed[0];
}

const qcOutstanding = () => (QC.issue || []).filter(r => r && r.id && qcPendingOf(r) > 0)
  .sort((a, b) => (ptDtMs(a.date) - ptDtMs(b.date)) || String(a.id).localeCompare(String(b.id)));
/** Pieces mended and pieces still wrong, over everything that has come back. */
const qcRetOk = () => (QC.ret || []).reduce((a, r) => a + ptNum(r.reworkedOk), 0);
const qcRetBad = () => (QC.ret || []).reduce((a, r) => a + ptNum(r.stillRejected), 0);

/** Employees whose department is Quality Control — who may sign a check. */
const qcDeptEmps = type => [...new Set((PTE.emp || [])
  .filter(e => String(e[2] || '').trim().toLowerCase() === 'quality control'
    && (!type || String(e[0] || '').trim() === String(type).trim()))
  .map(e => String(e[1]).trim()))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

/** SKUs with something still to inspect. */
const qcCheckable = () => [...new Set((PT.base || []).filter(r => ptNum(r.receivedPieces) > 0).map(r => qcNorm(r.sku)))]
  .filter(s => s && qcAvailToCheck(s) > 0).sort();
/** SKUs QC has flagged for alteration and not yet handed out. */
const qcIssuable = () => [...new Set((QC.checks || []).filter(r => ptNum(r.forAlteration) > 0).map(r => qcNorm(r.sku)))]
  .filter(s => s && qcAvailToIssue(s) > 0).sort();

/* ---- the two registers on screen ---- */

function renderQc() {
  /* THE PICKER HOLDS ONLY WHAT THIS ACCOUNT WAS GIVEN, and qcView() is the second lock: removing an
   * option is not the same as closing a door, and a value left over from a wider grant would
   * otherwise still open it. */
  const allowed = qcViewsAllowed();
  if ($('qcView')) {
    const want = qcView();
    const html = allowed.map(([v, label]) => `<option value="${v}"${v === want ? ' selected' : ''}>${esc(label)}</option>`).join('');
    if ($('qcView').innerHTML !== html) $('qcView').innerHTML = html;
    $('qcView').value = want;
    /* One job and one screen: a picker with nothing to pick is furniture. */
    $('qcView').classList.toggle('hide', allowed.length < 2);
  }
  if (!allowed.length) {
    $('qcMsg').className = 'err';
    $('qcMsg').textContent = 'This account has no Quality Control access.';
    ptEmpty('qcTable', 'Nothing to show.'); $('qcKpis').innerHTML = '';
    ['qcCheckBox', 'qcIssueBox', 'qcRetBox'].forEach(id => { if ($(id)) $(id).classList.add('hide'); });
    return;
  }
  const view = qcView();
  $('qcCheckBox').classList.toggle('hide', view !== 'checks');
  $('qcIssueBox').classList.toggle('hide', view !== 'issue');
  $('qcRetBox').classList.toggle('hide', view !== 'ret');

  if (QC.busy) { $('qcMsg').className = 'muted'; $('qcMsg').textContent = 'Reading the production database…'; ptEmpty('qcTable', 'Loading…'); return; }
  if (QC.err) { $('qcMsg').className = 'err'; $('qcMsg').textContent = 'Could not read it: ' + QC.err; ptEmpty('qcTable', 'Nothing to show.'); $('qcKpis').innerHTML = ''; return; }
  if (view === 'inbox') return renderQcInbox();
  if (view === 'dept') return renderQcDept();
  if (view === 'ledger') return renderQcLedger();

  const q = $('qcQ').value.trim().toLowerCase();
  /* ONE WINDOW ACROSS ALL THREE VIEWS. A check, the alteration it went out on and the return it came
   * back on are one story, and reading a week should not mean setting the dates three times.
   *
   * It narrows which ISSUANCES are listed; it does not narrow the returns counted against them. An
   * issue made last week that came back today is still fully back — "Still out" must stay the truth
   * about the piece, not an artefact of where the window was put. */
  const [d1, d2] = ptRangeOf('qcD1', 'qcD2');
  const hit = r => (!q || [r.sku, r.articleType, r.subtype, r.color, r.size, r.checkedBy, r.employee]
    .join(' ').toLowerCase().includes(q)) && ptInRange(r && r.date, d1, d2);

  if (view === 'checks') {
    const rows = (QC.checks || []).filter(hit)
      .sort((a, b) => (ptDtMs(b.date) - ptDtMs(a.date)) || String(b.id || '').localeCompare(String(a.id || '')));
    QC.rows = rows;
    const s = f => rows.reduce((a, r) => a + ptNum(r[f]), 0);
    $('qcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">Quality Control — checks</span>
        <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Checks</div></div>
        <div class="metric"><div class="v">${nf(s('checked'))}</div><div class="l">Pieces checked</div></div>
        <div class="metric"><div class="v" style="color:#166534">${nf(s('ok'))}</div><div class="l">Passed</div></div>
        <div class="metric"><div class="v" style="color:#7f6000">${nf(s('forAlteration'))}</div><div class="l">For alteration</div></div>
        <div class="metric"><div class="v" style="color:var(--bad)">${nf(s('rejected'))}</div><div class="l">Rejected</div></div>
      </div></div>`;
    const head = '<thead><tr>' + ['Date', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Checked', 'OK', 'For alteration', 'Rejected', 'Checked by', 'Remarks', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 7 && i <= 10 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('qcTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(r.date)}</td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
      + ptImgCell(r.sku)
      + `<td>${esc(r.articleType)}</td><td>${esc(r.subtype)}</td><td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
      + `<td class="num" style="font-weight:700">${nf(ptNum(r.checked))}</td>`
      + `<td class="num" style="color:#166534">${nf(ptNum(r.ok))}</td>`
      + `<td class="num"${ptNum(r.forAlteration) ? ' style="color:#7f6000;font-weight:700"' : ''}>${ptNum(r.forAlteration) ? nf(ptNum(r.forAlteration)) : '<span class="muted">—</span>'}</td>`
      + `<td class="num"${ptNum(r.rejected) ? ' style="color:var(--bad);font-weight:700"' : ''}>${ptNum(r.rejected) ? nf(ptNum(r.rejected)) : '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left">${esc(r.checkedBy)}</td>`
      + `<td style="text-align:left;white-space:normal;max-width:200px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
      + `<td><button class="ghost" data-qc-edit="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`).join('')
      + '</tbody>';
    $('qcMsg').className = 'muted';
    $('qcMsg').textContent = `${nf(rows.length)} of ${nf((QC.checks || []).length)} check(s)`;
  } else {
    const rows = (QC.issue || []).filter(hit)
      .sort((a, b) => (ptDtMs(b.date) - ptDtMs(a.date)) || String(b.id || '').localeCompare(String(a.id || '')));
    QC.rows = rows;
    const pieces = rows.reduce((a, r) => a + ptNum(r.pieces), 0);
    /* ISSUED IS NOT THE SAME AS OUT. Until this screen could book a return, the two were the same
     * number and the difference had nowhere to live. */
    const back = rows.reduce((a, r) => a + qcRetOf(r.id), 0);
    const out = rows.reduce((a, r) => a + qcPendingOf(r), 0);
    $('qcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">Quality Control — issued for alteration</span>
        <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Issuances</div></div>
        <div class="metric"><div class="v">${nf(pieces)}</div><div class="l">Pieces issued</div></div>
        <div class="metric"><div class="v" style="color:#166534">${nf(back)}</div><div class="l">Come back</div></div>
        <div class="metric"><div class="v"${out ? ' style="color:var(--bad)"' : ''}>${nf(out)}</div><div class="l">Still out</div></div>
        <div class="metric"><div class="v">${nf(new Set(rows.map(r => r.employee).filter(Boolean)).size)}</div><div class="l">People</div></div>
        <div class="metric"><div class="v">${nf(new Set(rows.map(r => qcNorm(r.sku)).filter(Boolean)).size)}</div><div class="l">SKUs</div></div>
      </div></div>`;
    const head = '<thead><tr>' + ['Date', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Pieces', 'Back', 'Still out', 'Employee', 'Type', 'Remarks', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 7 && i <= 9 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('qcTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(r.date)}</td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
      + ptImgCell(r.sku)
      + `<td>${esc(r.articleType)}</td><td>${esc(r.subtype)}</td><td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
      + `<td class="num" style="font-weight:700">${nf(ptNum(r.pieces))}</td>`
      + `<td class="num" style="color:#166534">${qcRetOf(r.id) ? nf(qcRetOf(r.id)) : '<span class="muted">—</span>'}</td>`
      + `<td class="num"${qcPendingOf(r) ? ' style="color:var(--bad);font-weight:700"' : ''}>${qcPendingOf(r) ? nf(qcPendingOf(r)) : '<span class="pill pill-ok">all back</span>'}</td>`
      + `<td style="text-align:left">${esc(r.employee)}</td><td>${esc(r.employmentType)}</td>`
      + `<td style="text-align:left;white-space:normal;max-width:200px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
      + `<td><button class="ghost" data-qci-edit="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`).join('')
      + '</tbody>';
    $('qcMsg').className = 'muted';
    $('qcMsg').textContent = `${nf(rows.length)} of ${nf((QC.issue || []).length)} issuance(s)`;
  }
  if (view === 'ret') {
    const rows = (QC.ret || []).filter(hit)
      .sort((a, b) => (ptDtMs(b.date) - ptDtMs(a.date)) || String(b.id || '').localeCompare(String(a.id || '')));
    QC.rows = rows;
    const s = f => rows.reduce((a, r) => a + ptNum(r[f]), 0);
    const stillOut = qcOutstanding().reduce((a, r) => a + qcPendingOf(r), 0);
    $('qcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">Quality Control — back from alteration</span>
        <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Receipts</div></div>
        <div class="metric"><div class="v">${nf(s('received'))}</div><div class="l">Pieces back</div></div>
        <div class="metric"><div class="v" style="color:#166534">${nf(s('reworkedOk'))}</div><div class="l">Mended</div></div>
        <div class="metric"><div class="v" style="color:var(--bad)">${nf(s('stillRejected'))}</div><div class="l">Still wrong</div></div>
        <div class="metric" title="Issued for alteration and not yet booked back."><div class="v"${stillOut ? ' style="color:var(--bad)"' : ''}>${nf(stillOut)}</div><div class="l">Still with the tailors</div></div>
      </div></div>`;
    const head = '<thead><tr>' + ['Date', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size',
      'Back', 'Mended', 'Still wrong', 'From', 'Received by', 'Remarks']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 7 && i <= 9 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('qcTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(r.date)}</td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
      + ptImgCell(r.sku)
      + `<td>${esc(r.articleType)}</td><td>${esc(r.subtype)}</td><td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
      + `<td class="num" style="font-weight:700">${nf(ptNum(r.received))}</td>`
      + `<td class="num" style="color:#166534">${ptNum(r.reworkedOk) ? nf(ptNum(r.reworkedOk)) : '<span class="muted">—</span>'}</td>`
      + `<td class="num"${ptNum(r.stillRejected) ? ' style="color:var(--bad);font-weight:700"' : ''}>${ptNum(r.stillRejected) ? nf(ptNum(r.stillRejected)) : '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left">${esc(r.employee)}</td>`
      + `<td style="text-align:left">${esc(r.receivedBy)}</td>`
      + `<td style="text-align:left;white-space:normal;max-width:200px">${esc(r.remarks) || '<span class="muted">—</span>'}</td></tr>`).join('')
      + '</tbody>';
    $('qcMsg').className = 'muted';
    $('qcMsg').textContent = `${nf(rows.length)} of ${nf((QC.ret || []).length)} receipt(s)`
      + (stillOut ? ` · ${nf(stillOut)} piece(s) still with the tailors` : '');
  }
  // Whichever view is showing, its rows are what need pictures.
  ptImgFill((QC.rows || []).slice(0, 600).map(r => r.sku), false, ptIfTab('qc', renderQc));
}

/* ---- receiving pieces back from alteration ---- */

function qcRetMsg(t, bad) { const m = $('qcrMsg'); if (m) { m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; } }

/** What is still out, as a list somebody can pick from — oldest first, with what is pending on it. */
function renderQcRetForm() {
  const cur = $('qcrPick').value;
  const out = qcOutstanding();
  $('qcrPick').innerHTML = '<option value="">— What is coming back —</option>'
    + out.map(r => `<option value="${esc(r.id)}">${esc(r.employee || '?')} · ${esc(r.sku)} — ${nf(qcPendingOf(r))} pending</option>`).join('');
  $('qcrPick').value = cur;
  if ($('qcrPick').value !== cur) $('qcrPick').value = '';
  /* Whoever may sign a QC check may sign for what comes back. */
  const by = $('qcrBy').value;
  $('qcrBy').innerHTML = '<option value="">— Received by —</option>'
    + qcDeptEmps('').map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('qcrBy').value = by;
  qcRetInfo();
}

/** The two ceilings, while typing: what is pending, and whether the split adds up. */
function qcRetInfo() {
  const r = (QC.issue || []).find(x => String(x.id) === $('qcrPick').value);
  const info = $('qcrInfo'); if (!info) return;
  if (!r) { info.textContent = ''; return; }
  const pend = qcPendingOf(r);
  const got = ptNum($('qcrPcs').value), ok = ptNum($('qcrOk').value), bad = ptNum($('qcrRej').value);
  const bits = [`${esc(r.employee || '?')} took ${nf(ptNum(r.pieces))} · ${nf(qcRetOf(r.id))} already back · `
    + `<b>${nf(pend)} pending</b>`];
  if (got > pend) bits.push(`<b style="color:var(--bad)">${nf(got)} is more than is out with them</b>`);
  if (got > 0 && (ok || bad) && ok + bad !== got)
    bits.push(`<b style="color:var(--bad)">mended + still wrong (${nf(ok + bad)}) must equal what came back (${nf(got)})</b>`);
  info.innerHTML = bits.join(' · ');
}

/**
 * Book pieces back from the person who altered them.
 *
 * Against ONE issuance, because that is the promise being settled — "Pradeep took eleven" is what the
 * floor asks about, and a SKU total cannot answer it.
 */
async function qcSaveReturn() {
  if (!ptCanEdit()) return qcRetMsg(PT_NO_EDIT, true);
  const r = (QC.issue || []).find(x => String(x.id) === $('qcrPick').value);
  if (!r) return qcRetMsg('Pick what is coming back.', true);
  const by = String($('qcrBy').value || '').trim();
  if (!by) return qcRetMsg('Say who received them.', true);
  const got = ptNum($('qcrPcs').value), ok = ptNum($('qcrOk').value), bad = ptNum($('qcrRej').value);
  if (!(got > 0)) return qcRetMsg('How many pieces came back?', true);
  const pend = qcPendingOf(r);
  if (got > pend) return qcRetMsg(`Only ${nf(pend)} piece(s) are still out with ${r.employee || 'them'} on this issue.`, true);
  if (ok < 0 || bad < 0) return qcRetMsg('Mended and still-wrong cannot be negative.', true);
  if ((ok || bad) && ok + bad !== got)
    return qcRetMsg(`Mended + still wrong (${nf(ok + bad)}) must equal what came back (${nf(got)}).`, true);

  const row = { id: 'qcr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: ptStampDate(), issuanceId: String(r.id), receivedBy: by,
    employee: r.employee || '', employmentType: r.employmentType || '',
    brand: r.brand || '', articleType: r.articleType || '', subtype: r.subtype || '',
    color: r.color || '', size: r.size || '', sku: r.sku || '',
    received: got, reworkedOk: ok, stillRejected: bad,
    remarks: String($('qcrRemarks').value || '').trim(),
    addedBy: ME.email, addedAt: new Date().toISOString() };
  try { await ptPut('pt_qcReturns/' + row.id, row); }
  catch (e) { return qcRetMsg('Not saved: ' + (e.message || e), true); }
  QC.ret = (QC.ret || []).concat([Object.assign({ _key: row.id }, row)]);
  ['qcrPcs', 'qcrOk', 'qcrRej', 'qcrRemarks'].forEach(id => { if ($(id)) $(id).value = ''; });
  renderQc(); renderQcRetForm();
  qcRetMsg(`${nf(got)} piece(s) of ${row.sku} back from ${row.employee}`
    + (ok || bad ? ` — ${nf(ok)} mended, ${nf(bad)} still wrong` : '')
    + `. ${nf(qcPendingOf(r))} still with them.`);
  return '';
}

$('qcrToggle').onclick = () => {
  const box = $('qcrBox');
  box.classList.toggle('hide');
  if (!box.classList.contains('hide')) renderQcRetForm();
};
['qcrPick', 'qcrPcs', 'qcrOk', 'qcrRej'].forEach(id => { if ($(id)) $(id).addEventListener('input', qcRetInfo); });
if ($('qcrPick')) $('qcrPick').addEventListener('change', qcRetInfo);
$('qcrSave').onclick = qcSaveReturn;

/* ---- recording a check ---- */

function qcCheckMsg(t, bad) { const m = $('qcwMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

function renderQcCheckForm() {
  const any = $('qcwSrc').value === 'any';
  const pool = any ? (PTG.mdb || []).map(r => qcNorm(r.sku)).filter(Boolean).slice(0, 6000) : qcCheckable();
  /* LIKE THE JOB WORK REGISTER. Ravi: "quality control ki entry 2 tarah se — SKU wise or article wise",
   * and then "like job register": the article, subtype, colour and size pickers, and an SKU box that
   * can be typed into or picked from. Choosing the item fills the SKU when exactly one matches; typing
   * a SKU fills the item back. Each picker only offers what the ones before it leave. */
  const parts = new Map(pool.map(s0 => [s0, qcParts(s0)]));
  const eq = (x, y) => String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase();
  const pick = () => ({ at: $('qcwAt').value, sub: $('qcwSub').value, col: $('qcwCol').value, size: $('qcwSz').value });
  const upTo = (p, keys) => pool.filter(s0 => keys.every(k => !p[k] || eq(parts.get(s0)[k], p[k])));
  let p0 = pick();
  bdFill('qcwAt', pool.map(s0 => parts.get(s0).at), '-- Article type --');
  p0 = pick();
  bdFill('qcwSub', upTo(p0, ['at']).map(s0 => parts.get(s0).sub), '-- Subtype --');
  p0 = pick();
  bdFill('qcwCol', upTo(p0, ['at', 'sub']).map(s0 => parts.get(s0).col), '-- Colour --');
  p0 = pick();
  bdFill('qcwSz', upTo(p0, ['at', 'sub', 'col']).map(s0 => parts.get(s0).size), '-- Size --');
  p0 = pick();
  const near = upTo(p0, ['at', 'sub', 'col', 'size']);
  $('qcwSkuList').innerHTML = near.slice(0, 3000).map(s0 => { const q0 = parts.get(s0);
    return `<option value="${esc(s0)}">${esc([q0.at, q0.sub, q0.col, q0.size].filter(Boolean).join(' · '))}${any ? '' : ' — ' + nf(qcAvailToCheck(s0)) + ' to check'}</option>`; }).join('');
  let skuNote = '';
  /* The orders this SKU is actually on, newest first — the same list the cutting form offers. */
  if ($('qcwOrdList')) {
    const sku0 = qcNorm(($('qcwSku') || {}).value);
    const on = sku0 ? qcOrdersFor(sku0) : [];
    $('qcwOrdList').innerHTML = on
      .map(o => `<option value="${esc(o.orderNo)}">${esc(o.date || '')} · ${nf(o.ordered)} ordered · ${nf(o.received)} received</option>`).join('');
    /* THE BOX SAYS WHETHER IT IS NEEDED, and fills itself in when there is only one answer — asking
     * somebody to type the one order a SKU is on is how a box comes to be left empty 245 times. */
    const box = $('qcwOrd');
    if (box) {
      box.placeholder = !sku0 ? 'Order No' : (on.length ? 'Order No *' : 'Order No — this SKU is on no order');
      if (on.length === 1 && !String(box.value || '').trim()) box.value = on[0].orderNo;
      if (on.length && String(box.value || '').trim() && !on.some(o => o.orderNo === obUC(box.value))) box.value = '';
    }
  }
  if (!$('qcwSku').dataset.typed) {
    const full = p0.at && p0.sub && p0.col && p0.size;
    $('qcwSku').value = full && near.length === 1 ? near[0] : '';
    if (full && near.length > 1) skuNote = `${nf(near.length)} SKUs share this description — pick the SKU in the SKU box.`;
  }

  const types = [...new Set(qcDeptEmps().map(n => (PTE.emp || []).find(e => String(e[1]).trim() === n))
    .filter(Boolean).map(e => String(e[0]).trim()))].sort();
  const curT = $('qcwType').value;
  $('qcwType').innerHTML = '<option value="">All types</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('qcwType').value = curT;
  const curB = $('qcwBy').value;
  $('qcwBy').innerHTML = '<option value="">— Checked by —</option>'
    + qcDeptEmps($('qcwType').value).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('qcwBy').value = curB;
  if ($('qcwBy').value !== curB) $('qcwBy').value = '';

  const sku = qcNorm($('qcwSku').value);
  const p = sku ? qcParts(sku) : null;
  const ch = parseInt($('qcwChecked').value, 10) || 0;
  const al = parseInt($('qcwAlt').value, 10) || 0;
  const rj = parseInt($('qcwRej').value, 10) || 0;
  $('qcwOk').value = ch > 0 ? String(ch - al - rj) : '';
  /* Both ceilings are shown while typing, so a refusal is never a surprise at the end. */
  let note = '';
  if (p) note = `${p.at || '—'} · ${p.sub || '—'} · ${p.col || '—'} · ${p.size || '—'}`
    + (any ? '  ·  free inspection — not measured against Job Work Register'
           : `  ·  received ${nf(qcReceived(sku))}, already checked ${nf(qcChecked(sku))}, ${nf(qcAvailToCheck(sku))} left to check`);
  let warn = '';
  if (sku && !parts.has(qcNorm(sku))) warn = any ? `${qcNorm(sku)} is not in the master database.` : `${qcNorm(sku)} has nothing received in Job Work waiting to be checked.`;
  else if (!any && sku && ch > qcAvailToCheck(sku)) warn = `Pieces checked (${ch}) is more than the ${nf(qcAvailToCheck(sku))} available.`;
  else if (ch > 0 && al + rj > ch) warn = `For alteration + rejected (${al + rj}) is more than the ${ch} checked.`;
  $('qcwInfo').textContent = warn || note || skuNote;
  $('qcwInfo').className = warn ? 'err' : 'muted';
}

/** A SKU typed or picked: the item fields follow it, and the form catches up once typing stops. */
let QC_FORM_T = null;
function qcSkuTyped() {
  const sku = qcNorm($('qcwSku').value);
  $('qcwSku').dataset.typed = sku ? '1' : '';
  const q0 = sku ? qcParts(sku) : null;
  if (q0 && (q0.at || q0.sub)) { $('qcwAt').value = q0.at; $('qcwSub').value = q0.sub; $('qcwCol').value = q0.col; $('qcwSz').value = q0.size; }
  clearTimeout(QC_FORM_T);
  QC_FORM_T = setTimeout(renderQcCheckForm, 180);
}

['qcwSrc', 'qcwType', 'qcwBy'].forEach(id => $(id).addEventListener('change', renderQcCheckForm));
/* Changing the item means a typed SKU no longer stands — the pickers take over again. */
['qcwAt', 'qcwSub', 'qcwCol', 'qcwSz'].forEach(id => $(id).addEventListener('change', () => { $('qcwSku').dataset.typed = ''; renderQcCheckForm(); }));
$('qcwSku').addEventListener('input', qcSkuTyped);
['qcwChecked', 'qcwAlt', 'qcwRej'].forEach(id => $(id).addEventListener('input', renderQcCheckForm));

$('qcwSave').onclick = async () => {
  const any = $('qcwSrc').value === 'any';
  const sku = qcNorm($('qcwSku').value);
  const by = $('qcwBy').value.trim();
  const checked = parseInt($('qcwChecked').value, 10);
  const alt = parseInt($('qcwAlt').value, 10) || 0;
  const rej = parseInt($('qcwRej').value, 10) || 0;

  if (!sku) return qcCheckMsg('Choose the item, or type the SKU being inspected.', true);
  if (any && !cutSkuOf(sku)) return qcCheckMsg(`${sku} is not in the master database.`, true);
  if (!by) return qcCheckMsg('Select who performed the check.', true);
  if (!isFinite(checked) || checked <= 0) return qcCheckMsg('Enter how many pieces were checked.', true);
  if (alt < 0 || rej < 0) return qcCheckMsg('For alteration and rejected cannot be negative.', true);
  if (alt + rej > checked) return qcCheckMsg(`For alteration + rejected (${alt + rej}) is more than the ${checked} checked.`, true);
  if (!any) {
    const avail = qcAvailToCheck(sku);
    if (checked > avail)
      return qcCheckMsg(`Only ${nf(avail)} piece(s) available to check for ${sku} — received ${nf(qcReceived(sku))}, `
        + `already checked ${nf(qcChecked(sku))}.`, true);
  }

  /* AN ORDER, WHEREVER THERE IS ONE TO NAME. Every other register is keyed by order, and the Order
   * Console shows this figure as an order's own QC — a check with no order is invisible there. */
  const onOrders = qcOrdersFor(sku), ordTyped = obUC(($('qcwOrd') || {}).value);
  if (onOrders.length && !ordTyped) return qcCheckMsg(`${sku} is on ${nf(onOrders.length)} order(s) — pick which one these pieces are for.`, true);
  if (ordTyped && onOrders.length && !onOrders.some(o => o.orderNo === ordTyped))
    return qcCheckMsg(`Order ${ordTyped} has no line for ${sku}. It is on: ${onOrders.slice(0, 4).map(o => o.orderNo).join(', ')}${onOrders.length > 4 ? '…' : ''}.`, true);

  const p = qcParts(sku);
  const rec = {
    id: 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: ptNow(), checkedBy: by, brand: p.brand, articleType: p.at, subtype: p.sub, color: p.col, size: p.size,
    sku, checked, forAlteration: alt, rejected: rej, ok: checked - alt - rej,
    /* Blank survives only for a SKU that is on no order at all — there is nothing to name, and a
     * number somebody made up would be worse than none. */
    ...(obUC(($('qcwOrd') || {}).value) ? { orderNo: obUC($('qcwOrd').value) } : {}),
    remarks: $('qcwRemarks').value.trim(), addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  $('qcwSave').disabled = true;
  qcCheckMsg('Saving…');
  try {
    await ptPut('pt_qcChecks/' + rec.id, rec);
    QC.checks = (QC.checks || []).concat(Object.assign({ _key: rec.id }, rec));
    ['qcwChecked', 'qcwAlt', 'qcwRej', 'qcwRemarks', 'qcwOrd'].forEach(id => { $(id).value = ''; });
    $('qcwSku').value = ''; $('qcwSz').value = ''; $('qcwSku').dataset.typed = '';
    renderQcCheckForm(); renderQc();
    qcCheckMsg(`Saved — ${nf(checked)} checked, ${nf(checked - alt - rej)} passed, ${nf(alt)} for alteration, ${nf(rej)} rejected.`);
  } catch (e) { qcCheckMsg('Not saved: ' + (e.message || e), true); }
  $('qcwSave').disabled = false;
};

/* ---- issuing for alteration ---- */

function qcIssueMsg(t, bad) { const m = $('qciMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

function renderQcIssueForm() {
  const cur = $('qciSku').value;
  $('qciSku').innerHTML = '<option value="">— Select a flagged article —</option>'
    + qcIssuable().map(s => `<option value="${esc(s)}">${esc(s)} — ${nf(qcAvailToIssue(s))} to issue</option>`).join('');
  $('qciSku').value = cur;
  if ($('qciSku').value !== cur) $('qciSku').value = '';

  bdFill('qciType', ptEmpTypes(), 'Employment type…');
  $('qciEmpList').innerHTML = ptEmpsOfType($('qciType').value).map(e => `<option value="${esc(e[1])}">`).join('');

  const sku = $('qciSku').value;
  $('qciInfo').textContent = sku
    ? `Identified for alteration ${nf(qcAltTotal(sku))} · already issued ${nf(qcIssuedTotal(sku))} · `
      + `${nf(qcAvailToIssue(sku))} available to issue`
    : '';
  $('qciInfo').className = (sku && qcAvailToIssue(sku) <= 0) ? 'err' : 'muted';
}
['qciSku', 'qciType'].forEach(id => $(id).addEventListener('change', renderQcIssueForm));

$('qciSave').onclick = async () => {
  const type = $('qciType').value.trim();
  const name = $('qciEmp').value.trim();
  const sku = $('qciSku').value.trim();
  const pcs = parseInt($('qciPcs').value, 10);

  if (!type) return qcIssueMsg('Select the employment type.', true);
  if (!name) return qcIssueMsg('Select the employee.', true);
  const emp = ptEmpsOfType(type).find(e => String(e[1]).trim().toLowerCase() === name.toLowerCase());
  if (!emp) return qcIssueMsg(`"${name}" is not on the ${type} list.`, true);
  if (!sku) return qcIssueMsg('Select a QC-flagged article.', true);
  if (!isFinite(pcs) || pcs <= 0) return qcIssueMsg('Enter how many pieces are being issued.', true);
  const alt = qcAltTotal(sku), iss = qcIssuedTotal(sku), avail = alt - iss;
  if (alt <= 0) return qcIssueMsg(`Nothing has been flagged for alteration on ${sku} — record a QC check first.`, true);
  if (pcs > avail) return qcIssueMsg(`Only ${nf(avail)} piece(s) available to issue for ${sku} — identified ${nf(alt)}, already issued ${nf(iss)}.`, true);

  const p = qcParts(sku);
  const rec = {
    id: 'qci_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: ptNow(), employee: emp[1], employmentType: type, brand: p.brand,
    articleType: p.at, subtype: p.sub, color: p.col, size: p.size, sku, pieces: pcs,
    remarks: $('qciRemarks').value.trim(), addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  $('qciSave').disabled = true;
  qcIssueMsg('Saving…');
  try {
    await ptPut('pt_qcIssuance/' + rec.id, rec);
    QC.issue = (QC.issue || []).concat(Object.assign({ _key: rec.id }, rec));
    ['qciPcs', 'qciRemarks'].forEach(id => { $(id).value = ''; });
    $('qciSku').value = '';
    renderQcIssueForm(); renderQc();
    qcIssueMsg(`Issued — ${nf(pcs)} piece(s) of ${sku} to ${emp[1]} for alteration.`);
  } catch (e) { qcIssueMsg('Not saved: ' + (e.message || e), true); }
  $('qciSave').disabled = false;
};

/* ---- edits, through the shared dialog ---- */

function qcEditCheck(id) {
  /* A QC figure decides what a karigar is paid, exactly as the Job Work, Cutting and Press registers
   * do — and changing one of those has needed perms.prodEdit all along. This was open. */
  if (!ptCanEdit()) { $('qcMsg').className = 'err'; $('qcMsg').textContent = PT_NO_EDIT; return; }
  const r = (QC.checks || []).find(x => x.id === id); if (!r) return;
  /* A send to spotting / touching, or a lot back from there, is one half of a pair — editing one half alone would
   * break the count of what is still out. */
  if (r.dept || r.refId) { $('qcMsg').className = 'err'; $('qcMsg').textContent = 'This one belongs to Spotting & touching — it cannot be edited here.'; return; }
  ptOpenDialog({
    title: 'Edit QC Check',
    subtitle: `SKU: ${r.sku || '—'}  ·  checked by ${r.checkedBy || '—'}`,
    note: 'Checked stays within what has been received and not yet checked; for-alteration plus rejected stay within checked.',
    msg: `${r.articleType || ''} · ${r.subtype || ''} · ${r.color || ''} · ${r.size || ''}`,
    fields: [
      { key: 'sku', label: 'SKU', value: r.sku, readonly: true },
      { key: 'checkedBy', label: 'Checked by', type: 'select', value: r.checkedBy,
        options: [...new Set([r.checkedBy].concat(qcDeptEmps()).filter(Boolean))] },
      { key: 'checked', label: 'Pieces checked', type: 'number', min: 1, step: 1, value: ptNum(r.checked) },
      { key: 'forAlteration', label: 'For alteration', type: 'number', min: 0, step: 1, value: ptNum(r.forAlteration) },
      { key: 'rejected', label: 'Rejected', type: 'number', min: 0, step: 1, value: ptNum(r.rejected) },
      { key: 'remarks', label: 'Remarks', value: r.remarks || '', span: true },
      { key: 'date', label: 'Check date', type: 'date', value: ptIsoDate(r.date), admin: true },
    ],
    deleteWhat: `a QC check of ${nf(ptNum(r.checked))} piece(s) of ${r.sku} on ${r.date}`,
    onSave: async v => {
      const ch = parseInt(v.checked, 10), al = parseInt(v.forAlteration, 10) || 0, rj = parseInt(v.rejected, 10) || 0;
      if (!isFinite(ch) || ch <= 0) return 'Pieces checked must be at least 1.';
      if (al < 0 || rj < 0) return 'For alteration and rejected cannot be negative.';
      if (al + rj > ch) return `For alteration + rejected (${al + rj}) is more than the ${ch} checked.`;
      /* This row's own pieces must come out of the ceiling, or it refuses to save what it holds. */
      const avail = qcAvailToCheck(r.sku) + ptNum(r.checked);
      if (ch > avail) return `Only ${nf(avail)} piece(s) available to check for ${r.sku}.`;
      /* Cutting a check below what has already gone out for alteration would leave issuance
       * standing on a number that no longer exists. */
      const issuedElsewhere = qcIssuedTotal(r.sku);
      const altAfter = qcAltTotal(r.sku) - ptNum(r.forAlteration) + al;
      if (altAfter < issuedElsewhere)
        return `${nf(issuedElsewhere)} piece(s) of ${r.sku} have already been issued for alteration — `
          + `for-alteration cannot drop to ${nf(altAfter)}.`;
      const next = Object.assign({}, r, {
        checkedBy: v.checkedBy || r.checkedBy, checked: ch, forAlteration: al, rejected: rj, ok: ch - al - rj,
        remarks: String(v.remarks || '').trim(),
        date: v.date ? ptStampFrom(r.date, v.date) : r.date,
        editedBy: ME.email, editedAt: new Date().toISOString(),
      });
      delete next._key;
      await ptPut('pt_qcChecks/' + r.id, next);
      QC.checks = (QC.checks || []).map(x => (x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
      renderQc();
      return '';
    },
    onDelete: async () => {
      const issued = qcIssuedTotal(r.sku);
      if (qcAltTotal(r.sku) - ptNum(r.forAlteration) < issued)
        return `${nf(issued)} piece(s) of ${r.sku} have already been issued for alteration — deleting this check would leave that standing on nothing.`;
      await ptDelete('pt_qcChecks/' + r.id);
      QC.checks = (QC.checks || []).filter(x => x.id !== r.id);
      renderQc();
      return '';
    },
  });
}

function qcEditIssue(id) {
  if (!ptCanEdit()) { $('qcMsg').className = 'err'; $('qcMsg').textContent = PT_NO_EDIT; return; }
  const r = (QC.issue || []).find(x => x.id === id); if (!r) return;
  ptOpenDialog({
    title: 'Edit Alteration Issuance',
    subtitle: `SKU: ${r.sku || '—'}  ·  ${r.employee || '—'}`,
    note: 'Pieces stay within what QC flagged for alteration and has not already been issued.',
    msg: `${r.articleType || ''} · ${r.subtype || ''} · ${r.color || ''} · ${r.size || ''}`,
    fields: [
      { key: 'sku', label: 'SKU', value: r.sku, readonly: true },
      { key: 'employee', label: 'Employee', value: r.employee || '' },
      { key: 'pieces', label: 'Pieces', type: 'number', min: 1, step: 1, value: ptNum(r.pieces) },
      { key: 'remarks', label: 'Remarks', value: r.remarks || '', span: true },
      { key: 'date', label: 'Issue date', type: 'date', value: ptIsoDate(r.date), admin: true },
    ],
    deleteWhat: `${nf(ptNum(r.pieces))} piece(s) of ${r.sku} issued to ${r.employee} for alteration on ${r.date}`,
    onSave: async v => {
      const pcs = parseInt(v.pieces, 10);
      if (!isFinite(pcs) || pcs <= 0) return 'Pieces must be at least 1.';
      if (!String(v.employee || '').trim()) return 'Enter the employee.';
      const avail = qcAvailToIssue(r.sku) + ptNum(r.pieces);
      if (pcs > avail) return `Only ${nf(avail)} piece(s) available to issue for ${r.sku} — `
        + `identified ${nf(qcAltTotal(r.sku))}, already issued elsewhere ${nf(qcIssuedTotal(r.sku) - ptNum(r.pieces))}.`;
      const next = Object.assign({}, r, {
        employee: String(v.employee).trim(), pieces: pcs, remarks: String(v.remarks || '').trim(),
        date: v.date ? ptStampFrom(r.date, v.date) : r.date,
        editedBy: ME.email, editedAt: new Date().toISOString(),
      });
      delete next._key;
      await ptPut('pt_qcIssuance/' + r.id, next);
      QC.issue = (QC.issue || []).map(x => (x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
      renderQc();
      return '';
    },
    onDelete: async () => {
      await ptDelete('pt_qcIssuance/' + r.id);
      QC.issue = (QC.issue || []).filter(x => x.id !== r.id);
      renderQc();
      return '';
    },
  });
}

/* ================= WAITING FOR QC =================
 *
 * Ravi, 2026-10-05: "jese hi jobwork wala banda receive kare wo auto move hona chahiye Q.C department me and Q.C wala banda
 * usko accept kare … accept partially bhi ho sakta h" — and no Return: "return hata do, partially ya not receive".
 *
 * Every Job Work row's pieces received back from QC_INBOX_FROM on (each receipt carries its own date since 2 Oct) are
 * waiting here, row by row, until QC accepts them. Accepting writes a QC check against that row (baseId), the order
 * and the SKU — checked = passed = the pieces accepted — so a QC pass is "made" on the Order Console the moment it is
 * saved. Accepting fewer leaves the rest waiting on the same row; nothing accepted is nothing written. The old Checks
 * form, alteration and rejection are untouched.
 */
const QC_INBOX_FROM = '2026-10-05';
const qcInboxFromMs = () => new Date(QC_INBOX_FROM + 'T00:00:00').getTime();
function qcInboxRows() {
  const from = qcInboxFromMs();
  const took = new Map();
  (QC.checks || []).forEach(c => { if (c && c.baseId) took.set(c.baseId, (took.get(c.baseId) || 0) + ptNum(c.checked)); });
  const out = [];
  (PT.base || []).forEach(r => {
    if (!r || !r.id) return;
    const rec = (Array.isArray(r.receipts) ? r.receipts : Object.values(r.receipts || {})).filter(Boolean);
    let since = 0, last = 0;
    rec.forEach(x => { const ms = ptDtMs(x.at); if (ms >= from) { since += ptNum(x.qty); if (ms > last) last = ms; } });
    /* Never more than the row says came back — a correction may have lowered it after the receipt was logged. */
    since = Math.min(since, ptNum(r.receivedPieces));
    const accepted = took.get(r.id) || 0, wait = since - accepted;
    if (!(wait > 0)) return;
    out.push({ r, since, accepted, wait, last });
  });
  return out.sort((a, b) => a.last - b.last);
}
function renderQcInbox() {
  const q = $('qcQ').value.trim().toLowerCase();
  const all = qcInboxRows();
  const rows = all.filter(x => !q || [x.r.sku, x.r.articleType, x.r.articleSubtype, x.r.color, x.r.size, x.r.empName, x.r.orderNo]
    .join(' ').toLowerCase().includes(q));
  QC.rows = rows.map(x => x.r); QC.inbox = rows;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const acceptedToday = (QC.checks || []).filter(c => c && c.baseId && ptDtMs(c.date) >= today.getTime()).reduce((a, c) => a + ptNum(c.ok), 0);
  const oldest = rows.length ? Math.floor((Date.now() - rows[0].last) / 3600000) : 0;
  $('qcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Waiting for QC — received from karigars since ${esc(QC_INBOX_FROM.split('-').reverse().join('/'))}</span>
      <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:#b45309">${nf(rows.reduce((a, x) => a + x.wait, 0))}</div><div class="l">Pieces waiting</div></div>
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Job Work entries</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(x => x.r.empName)).size)}</div><div class="l">Karigars</div></div>
      <div class="metric"><div class="v"${oldest >= 24 ? ' style="color:var(--bad)"' : ''}>${rows.length ? (oldest >= 24 ? nf(Math.floor(oldest / 24)) + ' day(s)' : nf(oldest) + ' h') : '—'}</div><div class="l">Oldest waiting</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(acceptedToday)}</div><div class="l">Passed today</div></div>
    </div></div>`;
  const head = '<thead><tr>' + ['Received', 'Karigar', 'SKU', 'Image', 'Item', 'Order', 'Received', 'Taken by QC', 'Waiting', 'Pieces', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([6, 7, 8].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const can = ptCanEdit() || ME.admin || (ME.tabs || []).includes('qc');
  $('qcTable').innerHTML = head + '<tbody>' + (rows.slice(0, 600).map(x => '<tr>'
    + (d => `<td class="frz" style="text-align:left">${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}<div class="muted" style="font-size:11px">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</div></td>`)(new Date(x.last))
    + `<td style="text-align:left">${esc(x.r.empName || '')}<div class="muted" style="font-size:11px">${esc(x.r.empType || '')}</div></td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(x.r.sku)}</td>`
    + ptImgCell(x.r.sku)
    + `<td style="text-align:left">${esc([x.r.articleSubtype || x.r.articleType, x.r.color, x.r.size].filter(Boolean).join(' · '))}</td>`
    + `<td style="text-align:left">${esc(x.r.orderNo || '') || '<span class="muted">—</span>'}</td>`
    + `<td class="num">${nf(x.since)}</td><td class="num" style="color:#166534">${x.accepted ? nf(x.accepted) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="font-weight:700;color:#b45309">${nf(x.wait)}</td>`
    + `<td>${can ? `<input type="number" min="1" max="${x.wait}" value="${x.wait}" data-qcin-qty="${esc(x.r.id)}" style="width:80px">` : ''}</td>`
    + `<td style="white-space:nowrap">${can ? ['', 'spotting', 'touching'].map(to => `<button data-qcin-go="${esc(x.r.id)}" data-to="${to}" class="${to ? 'ghost' : ''}" style="padding:3px 10px;font-size:12px;margin-right:4px" title="${to ? 'Send these pieces to ' + to + ' — they come back as a QC pass from the Spotting & touching tab' : 'Passed by QC'}">${to ? to[0].toUpperCase() + to.slice(1) : 'QC pass'}</button>`).join('') : '<span class="muted">—</span>'}</td>`
    + '</tr>').join('') || '<tr><td colspan="11" class="muted" style="padding:14px">Nothing waiting — everything received from karigars has been accepted.</td></tr>') + '</tbody>';
  $('qcMsg').className = 'muted';
  $('qcMsg').textContent = `${nf(rows.length)} entr${rows.length === 1 ? 'y' : 'ies'} waiting, oldest first · type the pieces, then QC pass, Spotting (a stain) or Touching (a missed print) — the rest stays waiting · a QC pass is made on the Order Console, ready for shipping on a Shopify order`;
}
/**
 * Take `qty` of one Job Work row's pieces out of Waiting for QC. '' or why not.
 * `to` = '' — passed by QC; 'spotting' — a stain, to be cleaned; 'touching' — a printed piece with a missed or broken print
 * (2026-10-06, Ravi). Sent pieces are taken (checked) but not passed (ok 0); they pass when they come back.
 */
const QC_DEPTS = { spotting: 'Spotting', touching: 'Touching' };
async function qcInboxAccept(baseId, qty, to) {
  const x = qcInboxRows().find(e => e.r.id === baseId);
  if (!x) return 'That entry is no longer waiting — press Refresh.';
  const q = parseInt(qty, 10);
  const dept = QC_DEPTS[to] ? to : '';
  if (!(q > 0)) return dept ? `Type how many pieces go to ${QC_DEPTS[dept].toLowerCase()}.` : 'Type how many pieces QC is accepting.';
  if (q > x.wait) return `Only ${nf(x.wait)} piece(s) of this entry are waiting.`;
  const r = x.r, p = qcParts(r.sku);
  const rec = {
    id: 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: ptNow(), checkedBy: String(ME.email || '').split('@')[0], brand: p.brand,
    articleType: p.at || r.articleType || '', subtype: p.sub || r.articleSubtype || '', color: p.col || r.color || '', size: p.size || r.size || '',
    sku: qcNorm(r.sku), checked: q, ok: dept ? 0 : q, forAlteration: 0, rejected: 0,
    ...(dept ? { dept, [dept]: q } : {}),
    ...(r.orderNo ? { orderNo: obUC(r.orderNo) } : {}),
    baseId: r.id, karigar: r.empName || '', from: 'waiting',
    remarks: dept ? 'Sent to ' + QC_DEPTS[dept].toLowerCase() + ' from Waiting for QC' : 'Accepted from Waiting for QC',
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  await ptPut('pt_qcChecks/' + rec.id, rec);
  QC.checks = (QC.checks || []).concat(Object.assign({ _key: rec.id }, rec));
  return '';
}

/* ================= SPOTTING & TOUCHING =================
 * What QC sent out of Waiting for QC to be cleaned (spotting) or to have a print finished (touching), and what is still
 * there. Coming back is a QC pass against the same order and SKU (refId = the send), part or all.
 */
function qcDeptRows() {
  const ok = new Map(), rej = new Map();
  (QC.checks || []).forEach(c => { if (c && c.refId) {
    ok.set(c.refId, (ok.get(c.refId) || 0) + ptNum(c.ok)); rej.set(c.refId, (rej.get(c.refId) || 0) + ptNum(c.rejected)); } });
  return (QC.checks || []).filter(c => c && QC_DEPTS[c.dept] && ptNum(c[c.dept]) > 0).map(c => {
    const sent = ptNum(c[c.dept]), pass = ok.get(c.id) || 0, bad = rej.get(c.id) || 0, got = Math.min(sent, pass + bad);
    return { c, dept: c.dept, sent, back: got, pass, rej: bad, left: sent - got, ms: ptDtMs(c.date) };
  });
}
/** `reject` (2026-10-06, Ravi: "spotting touching se reject bhi ho sakta h") — the pieces come back rejected, not passed. */
async function qcDeptBack(sendId, qty, reject) {
  const x = qcDeptRows().find(e => e.c.id === sendId);
  if (!x) return 'That entry is not there any more — press Refresh.';
  const q = parseInt(qty, 10);
  if (!(q > 0)) return reject ? 'Type how many pieces are rejected.' : 'Type how many pieces came back.';
  if (q > x.left) return `Only ${nf(x.left)} piece(s) of this are still in ${x.dept}.`;
  const c = x.c;
  const rec = {
    id: 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: ptNow(), checkedBy: String(ME.email || '').split('@')[0], brand: c.brand || '',
    articleType: c.articleType || '', subtype: c.subtype || '', color: c.color || '', size: c.size || '',
    sku: c.sku, checked: 0, ok: reject ? 0 : q, forAlteration: 0, rejected: reject ? q : 0,
    ...(c.orderNo ? { orderNo: c.orderNo } : {}),
    refId: c.id, dept: x.dept, from: x.dept, baseId: c.baseId || '', karigar: c.karigar || '',
    remarks: reject ? 'Rejected after ' + x.dept : 'Back from ' + x.dept + ' — passed by QC', addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  await ptPut('pt_qcChecks/' + rec.id, rec);
  QC.checks = (QC.checks || []).concat(Object.assign({ _key: rec.id }, rec));
  return '';
}
function renderQcDept() {
  const q = $('qcQ').value.trim().toLowerCase();
  const all = qcDeptRows();
  const open = all.filter(x => x.left > 0 && (!q || [x.c.sku, x.c.subtype, x.c.color, x.c.size, x.c.karigar, x.c.orderNo, x.dept].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => a.ms - b.ms);
  QC.rows = open.map(x => x.c); QC.dept = open;
  const sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const inD = d => sum(all.filter(x => x.dept === d), x => x.left);
  $('qcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Spotting &amp; touching — sent from QC, not back yet</span>
      <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:#b45309">${nf(inD('spotting'))}</div><div class="l">In spotting</div></div>
      <div class="metric"><div class="v" style="color:#b45309">${nf(inD('touching'))}</div><div class="l">In touching</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(sum(all, x => x.pass))}</div><div class="l">Back and passed</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(sum(all, x => x.rej))}</div><div class="l">Rejected</div></div>
      <div class="metric"><div class="v">${nf(sum(all, x => x.sent))}</div><div class="l">Sent in all</div></div>
    </div></div>`;
  const can = ptCanEdit() || ME.admin || (ME.tabs || []).includes('qc');
  const head = '<thead><tr>' + ['Sent', 'To', 'Karigar', 'SKU', 'Image', 'Item', 'Order', 'Sent', 'Passed', 'Rejected', 'Still there', 'Pieces', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([7, 8, 9, 10].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('qcTable').innerHTML = head + '<tbody>' + (open.slice(0, 600).map(x => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(x.c.date || '')}</td>`
    + `<td><span class="pill ${x.dept === 'spotting' ? 'pill-low' : 'pill-out'}">${esc(QC_DEPTS[x.dept])}</span></td>`
    + `<td style="text-align:left">${esc(x.c.karigar || '')}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(x.c.sku)}</td>`
    + ptImgCell(x.c.sku)
    + `<td style="text-align:left">${esc([x.c.subtype || x.c.articleType, x.c.color, x.c.size].filter(Boolean).join(' · '))}</td>`
    + `<td style="text-align:left">${esc(x.c.orderNo || '') || '<span class="muted">—</span>'}</td>`
    + `<td class="num">${nf(x.sent)}</td><td class="num" style="color:#166534">${x.pass ? nf(x.pass) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="color:var(--bad)">${x.rej ? nf(x.rej) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="font-weight:700;color:#b45309">${nf(x.left)}</td>`
    + `<td>${can ? `<input type="number" min="1" max="${x.left}" value="${x.left}" data-qcd-qty="${esc(x.c.id)}" style="width:80px">` : ''}</td>`
    + `<td style="white-space:nowrap">${can ? `<button data-qcd-go="${esc(x.c.id)}" style="padding:3px 10px;font-size:12px;margin-right:4px">Back — QC pass</button>`
      + `<button data-qcd-go="${esc(x.c.id)}" data-rej="1" class="ghost" style="padding:3px 10px;font-size:12px;color:var(--bad)">Reject</button>` : '<span class="muted">—</span>'}</td>`
    + '</tr>').join('') || '<tr><td colspan="13" class="muted" style="padding:14px">Nothing in spotting or touching.</td></tr>') + '</tbody>';
  $('qcMsg').className = 'muted';
  $('qcMsg').textContent = `${nf(open.length)} lot(s) still out, oldest first · type fewer for a part — the rest stays there · back is a QC pass for the order, or Reject`;
}

/* ================= QC LEDGER, DAY BY DAY =================
 * Ravi, 2026-10-06: "mujhe Q.C ka ladger banana h ki kya qc hua mera day wise". One row a day inside the date filter
 * (the last 30 days when none is set): what came back from karigars, what QC passed straight, what went to spotting
 * and touching and what came back from them passed, all passed, sent for alteration and rejected (the Checks form).
 */
function qcLedgerRows() {
  const [d1, d2] = ptRangeOf('qcD1', 'qcD2');
  const dayKey = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const lo = d1 ? new Date(d1 + 'T00:00:00').getTime() : Date.now() - 30 * 86400000;
  const hi = d2 ? new Date(d2 + 'T23:59:59').getTime() : Date.now();
  const days = new Map();
  const at = ms => { if (!ms || ms < lo || ms > hi) return null; const k = dayKey(ms); if (!days.has(k)) days.set(k, { day: k, recv: 0, pass: 0, toSpot: 0, toTouch: 0, spotBack: 0, touchBack: 0, deptRej: 0, alt: 0, rej: 0 }); return days.get(k); };
  (PT.base || []).forEach(r => {
    (Array.isArray(r && r.receipts) ? r.receipts : Object.values((r && r.receipts) || {})).forEach(x => { const e = x && at(ptDtMs(x.at)); if (e) e.recv += ptNum(x.qty); });
  });
  (QC.checks || []).forEach(c => {
    const e = c && at(ptDtMs(c.date)); if (!e) return;
    if (c.refId) { if (c.dept === 'spotting') e.spotBack += ptNum(c.ok); else e.touchBack += ptNum(c.ok); e.deptRej += ptNum(c.rejected); return; }
    e.pass += ptNum(c.ok);
    e.toSpot += ptNum(c.spotting); e.toTouch += ptNum(c.touching);
    e.alt += ptNum(c.forAlteration); e.rej += ptNum(c.rejected);
  });
  return [...days.values()].map(e => Object.assign(e, { allPass: e.pass + e.spotBack + e.touchBack })).sort((a, b) => b.day.localeCompare(a.day));
}
function renderQcLedger() {
  const rows = qcLedgerRows();
  QC.rows = []; QC.ledger = rows;
  const t = rows.reduce((a, e) => { Object.keys(e).forEach(k => { if (k !== 'day') a[k] = (a[k] || 0) + e[k]; }); return a; }, {});
  const waiting = qcInboxRows().reduce((a, x) => a + x.wait, 0), out = qcDeptRows();
  $('qcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">QC ledger — day by day</span>
      <span class="kpiwhen">${($('qcD1').value || $('qcD2').value) ? 'the dates picked' : 'the last 30 days'} · read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(t.recv || 0)}</div><div class="l">Back from karigars</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(t.allPass || 0)}</div><div class="l">Passed by QC</div></div>
      <div class="metric"><div class="v">${nf(t.toSpot || 0)} / ${nf(t.toTouch || 0)}</div><div class="l">To spotting / touching</div></div>
      <div class="metric"><div class="v" style="color:#b45309">${nf(waiting)}</div><div class="l">Waiting for QC now</div></div>
      <div class="metric"><div class="v" style="color:#b45309">${nf(out.reduce((a, x) => a + x.left, 0))}</div><div class="l">In spotting / touching now</div></div>
    </div></div>`;
  const cols = [['Day', 'day'], ['Back from karigars', 'recv'], ['QC pass', 'pass'], ['To spotting', 'toSpot'], ['To touching', 'toTouch'],
    ['Back from spotting (pass)', 'spotBack'], ['Back from touching (pass)', 'touchBack'], ['Rejected after spotting / touching', 'deptRej'], ['All passed', 'allPass'], ['For alteration', 'alt'], ['Rejected at QC', 'rej']];
  const z = v => (v ? nf(v) : '<span class="muted">—</span>');
  const head = '<thead><tr>' + cols.map((c, i) => `<th${i === 0 ? ' class="frz"' : ' class="num"'}>${c[0]}</th>`).join('') + '</tr></thead>';
  $('qcTable').innerHTML = head + '<tbody>' + (rows.map(e => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(e.day.split('-').reverse().join('/'))}</td>`
    + cols.slice(1).map(([, k]) => `<td class="num"${k === 'allPass' ? ' style="font-weight:700;color:#166534"' : ''}>${z(e[k])}</td>`).join('') + '</tr>').join('')
    || `<tr><td colspan="${cols.length}" class="muted" style="padding:14px">Nothing in these days.</td></tr>`) + '</tbody>'
    + (rows.length ? '<tfoot><tr><td class="frz">TOTAL</td>' + cols.slice(1).map(([, k]) => `<td class="num">${nf(t[k] || 0)}</td>`).join('') + '</tr></tfoot>' : '');
  $('qcMsg').className = 'muted';
  $('qcMsg').textContent = `${nf(rows.length)} day(s), newest first · "All passed" = QC pass + back from spotting and touching · use the dates above for another window`;
}

$('qcTable').addEventListener('click', async e => {
  const go = e.target.closest('[data-qcin-go]');
  if (go) {
    const id = go.getAttribute('data-qcin-go');
    const box = document.querySelector(`[data-qcin-qty="${CSS.escape(id)}"]`);
    go.disabled = true;
    let err = '';
    const to = go.getAttribute('data-to') || '';
    try { err = await qcInboxAccept(id, box ? box.value : '', to); } catch (er) { err = 'Not saved: ' + (er.message || er); }
    go.disabled = false;
    renderQc();
    $('qcMsg').className = err ? 'err' : 'muted';
    if (err) $('qcMsg').textContent = err; else $('qcMsg').textContent = (to ? 'Sent to ' + to + '. ' : 'Accepted into QC. ') + $('qcMsg').textContent;
    return;
  }
  const back = e.target.closest('[data-qcd-go]');
  if (back) {
    const id = back.getAttribute('data-qcd-go');
    const box = document.querySelector(`[data-qcd-qty="${CSS.escape(id)}"]`);
    back.disabled = true;
    let err = '';
    const rej = back.getAttribute('data-rej') === '1';
    try { err = await qcDeptBack(id, box ? box.value : '', rej); } catch (er) { err = 'Not saved: ' + (er.message || er); }
    back.disabled = false;
    renderQc();
    $('qcMsg').className = err ? 'err' : 'muted';
    if (err) $('qcMsg').textContent = err; else $('qcMsg').textContent = (rej ? 'Rejected. ' : 'Back and passed by QC. ') + $('qcMsg').textContent;
    return;
  }
});
$('qcTable').addEventListener('click', e => {
  const a = e.target.closest('[data-qc-edit]'); if (a) return qcEditCheck(a.getAttribute('data-qc-edit'));
  const b = e.target.closest('[data-qci-edit]'); if (b) return qcEditIssue(b.getAttribute('data-qci-edit'));
});
$('qcView').addEventListener('change', renderQc);
['qcD1', 'qcD2'].forEach(id => $(id).addEventListener('change', renderQc));
$('qcClear').onclick = () => { ['qcQ', 'qcD1', 'qcD2'].forEach(id => $(id).value = ''); renderQc(); };
ptDebounce('qcQ', renderQc);
$('qcGo').onclick = async () => { QC.checks = null; await ensureQc(); renderQcCheckForm(); renderQcIssueForm(); };
$('qcwToggle').onclick = () => {
  const open = $('qcwBox').classList.contains('hide');
  $('qcwBox').classList.toggle('hide', !open);
  $('qcwToggle').textContent = open ? 'Close' : '+ Record a check';
  if (open) renderQcCheckForm();
};
$('qciToggle').onclick = () => {
  const open = $('qciBox').classList.contains('hide');
  $('qciBox').classList.toggle('hide', !open);
  $('qciToggle').textContent = open ? 'Close' : '+ Issue for alteration';
  if (open) renderQcIssueForm();
};
$('qcExport').onclick = () => {
  const v = qcView();
  if (v === 'ledger') {
    const L = QC.ledger || []; if (!L.length) return;
    return ptDownload('qc-ledger', [['Day', 'Back from karigars', 'QC pass', 'To spotting', 'To touching', 'Back from spotting (pass)', 'Back from touching (pass)', 'Rejected after spotting / touching', 'All passed', 'For alteration', 'Rejected at QC'].map(csvCell).join(',')]
      .concat(L.map(e => [e.day.split('-').reverse().join('/'), e.recv, e.pass, e.toSpot, e.toTouch, e.spotBack, e.touchBack, e.deptRej, e.allPass, e.alt, e.rej].map(csvCell).join(','))));
  }
  if (v === 'dept') {
    const D = QC.dept || []; if (!D.length) return;
    return ptDownload('qc-spotting-touching', [['Sent', 'To', 'Karigar', 'SKU', 'Item', 'Order', 'Sent', 'Passed', 'Rejected', 'Still there'].map(csvCell).join(',')]
      .concat(D.map(x2 => [x2.c.date, QC_DEPTS[x2.dept], x2.c.karigar, x2.c.sku, [x2.c.subtype, x2.c.color, x2.c.size].filter(Boolean).join(' · '), x2.c.orderNo, x2.sent, x2.pass, x2.rej, x2.left].map(csvCell).join(','))));
  }
  if (v === 'inbox') {
    const I = QC.inbox || []; if (!I.length) return;
    return ptDownload('waiting-for-qc', [['Received', 'Karigar', 'SKU', 'Item', 'Order', 'Received', 'Taken by QC', 'Waiting'].map(csvCell).join(',')]
      .concat(I.map(x2 => [new Date(x2.last).toLocaleString('en-GB'), x2.r.empName, x2.r.sku, [x2.r.articleSubtype, x2.r.color, x2.r.size].filter(Boolean).join(' · '), x2.r.orderNo, x2.since, x2.accepted, x2.wait].map(csvCell).join(','))));
  }
  const rows = QC.rows || []; if (!rows.length) return;
  const checks = qcView() === 'checks';
  const head = checks
    ? ['Date', 'SKU', 'Article', 'Subtype', 'Color', 'Size', 'Checked', 'OK', 'For alteration', 'Rejected', 'Checked by', 'Remarks']
    : ['Date', 'SKU', 'Article', 'Subtype', 'Color', 'Size', 'Pieces', 'Employee', 'Type', 'Remarks'];
  const lines = [head.map(csvCell).join(',')];
  rows.forEach(r => lines.push((checks
    ? [r.date, r.sku, r.articleType, r.subtype, r.color, r.size, ptNum(r.checked), ptNum(r.ok), ptNum(r.forAlteration), ptNum(r.rejected), r.checkedBy, r.remarks]
    : [r.date, r.sku, r.articleType, r.subtype, r.color, r.size, ptNum(r.pieces), r.employee, r.employmentType, r.remarks]
  ).map(csvCell).join(',')));
  ptDownload(checks ? 'qc-checks' : 'qc-alteration-issuance', lines);
};

