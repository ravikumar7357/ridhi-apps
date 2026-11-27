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
  /* All three lists, not only the checks (18 Nov 2026): Order Console and the flow view fill the checks for their own
   * use, and "Received back" / "Issued for alteration" then stayed empty here until F5. */
  if (QC.checks === null || QC.issue === null || QC.ret === null || ptLack(PTG_ALL, 'mdb')) {
    QC.busy = true; renderQc();
    /* The registers with the order book, not after it. The employee list waits for the order book (its masters give
     * the accessories). A refused read of it left this screen on "Loading…" for good; now it only leaves the names of
     * who may sign a check empty. */
    try {
      const [, [c, i, t]] = await Promise.all([
        ptNeed(PTG_ALL, { why: 'quality-control', has: 'mdb' }).then(() => (PTE.emp ? null : ptLoadEmpOrSkip('quality-control'))),
        Promise.all([ptGet('pt_qcChecks'), ptGet('pt_qcIssuance'), ptGet('pt_qcReturns')]),
      ]);
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
  const b = QC_IX ? qcIxOf(sku).base : (PT.base || []).find(r => qcNorm(r.sku) === qcNorm(sku));
  return b ? { at: b.articleType || '', sub: b.articleSubtype || '', col: b.color || '', size: b.size || '', brand: '' }
           : { at: '', sub: '', col: '', size: '', brand: '' };
}

/* ONE PASS PER DRAW. Every helper below walked a whole register for one SKU, and the forms ask them for every SKU —
 * thousands of full passes to draw a picker. While a draw runs (qcWithIx) they read one index made at its start;
 * outside a draw — a save checking its ceiling — they still walk the registers, so what a save checks is never older
 * than what is in memory. */
let QC_IX = null;
function qcWithIx(fn) {
  if (QC_IX) return fn();
  const m = new Map(), g = k => { let o = m.get(k); if (!o) m.set(k, o = { rec: 0, chk: 0, alt: 0, iss: 0, base: null }); return o; };
  (PT.base || []).forEach(r => { const o = g(qcNorm(r.sku)); o.rec += ptNum(r.receivedPieces); if (!o.base) o.base = r; });
  (QC.checks || []).forEach(r => { const o = g(qcNorm(r.sku)); o.chk += ptNum(r.checked); o.alt += ptNum(r.forAlteration); });
  (QC.issue || []).forEach(r => { g(qcNorm(r.sku)).iss += ptNum(r.pieces); });
  QC_IX = m;
  try { return fn(); } finally { QC_IX = null; }
}
const qcIxOf = sku => QC_IX.get(qcNorm(sku)) || { rec: 0, chk: 0, alt: 0, iss: 0, base: null };
const qcReceived = sku => (QC_IX ? qcIxOf(sku).rec : (PT.base || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.receivedPieces) : 0), 0));
const qcChecked = sku => (QC_IX ? qcIxOf(sku).chk : (QC.checks || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.checked) : 0), 0));
const qcAvailToCheck = sku => qcReceived(sku) - qcChecked(sku);
/* AN ORDER'S OWN PIECES (Ravi, 27 Oct: "jo order jiske ke liye aaya h wo usi order me jana chahiye"). The SKU total above let
 * a check name ANY order of the SKU: 166 RTBX72 were passed on AMZ-16092026-02, which had nothing back from a karigar, while
 * the pieces had been received on AMZ-25082026-01 — one line read made with nothing received, the other received with nothing
 * passed. 54 checks (3,128 pcs) went to an order that way. A check now names an order only for what came back ON it and is
 * not checked yet: the line's received (Job Work, or a quilt's old counters) plus pieces cut straight to QC (embroidery). */
function qcOrderRecv(orderNo, sku) {
  const o = obUC(orderNo), s = qcNorm(sku);
  const b = obBaseIndex().get(obKeyOf(o, s)), l = ordLines().find(x => x.orderNo === o && x.sku === s);
  let n = Math.max(b ? b.received : 0, l ? ptNum(l.received) : 0);
  (PT.cut || []).forEach(c => { if (c && c.qcDirect && obUC(c.orderNo) === o && qcNorm(c.sku) === s) n += ptNum(c.pieces); });
  return n;
}
const qcOrderChecked = (orderNo, sku) => { const o = obUC(orderNo), s = qcNorm(sku);
  return (QC.checks || []).reduce((a, r) => a + (r && obUC(r.orderNo) === o && qcNorm(r.sku) === s ? ptNum(r.checked) : 0), 0); };
const qcOrderAvail = (orderNo, sku) => Math.max(0, qcOrderRecv(orderNo, sku) - qcOrderChecked(orderNo, sku));
/** Pieces QC has already taken off one Job Work entry — that entry cannot go below it, or lose them by being deleted. */
const qcTookOf = baseId => ((typeof QC !== 'undefined' && QC.checks && QC.checks.length ? QC.checks : PTG.qc) || [])
  .reduce((a, c) => a + (c && !c.refId && String(c.baseId || '') === String(baseId) ? ptNum(c.checked) : 0), 0);
const qcAltTotal = sku => (QC_IX ? qcIxOf(sku).alt : (QC.checks || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.forAlteration) : 0), 0));
const qcIssuedTotal = sku => (QC_IX ? qcIxOf(sku).iss : (QC.issue || []).reduce((a, r) => a + (qcNorm(r.sku) === qcNorm(sku) ? ptNum(r.pieces) : 0), 0));
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
  ['passed', 'QC passed', 'qc'],
  ['dept', 'Spotting & touching', 'qc'],
  ['ledger', 'QC ledger (day-wise)', 'qc'],
  /* 'Checks' left the picker on 20 Nov (Ravi: "remove qc check screen") — checks are made from Waiting for QC, and who made
   * one is changed with Edit on QC passed; an admin corrects the rest through QC pass. */
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
  if (!QC_IX) return qcWithIx(renderQc);
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
  if (view === 'inbox' || view === 'passed') return renderQcInbox(view);
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
  frmWire('qcReturn', $('qcrBox'));   // my previous alteration receipt in grey, Tab fills (core/form-memory.js)
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
  rejWhyBoxes('qcr', ptNum($('qcrRej').value));
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
  /* ONE NUMBER RULE (fix 6, 26 Nov; switch lineHold): part pieces were taken as they were typed. Whole pieces only. */
  if (lineHoldOn()) {
    const numErr = ptNumErr($('qcrPcs').value, 'Pieces back', 'pcs') || ptNumErr($('qcrOk').value, 'Mended', 'pcs', true)
      || ptNumErr($('qcrRej').value, 'Still wrong', 'pcs', true);
    if (numErr) return qcRetMsg(numErr, true);
  }
  const got = ptNum($('qcrPcs').value), ok = ptNum($('qcrOk').value), bad = ptNum($('qcrRej').value);
  if (!(got > 0)) return qcRetMsg('How many pieces came back?', true);
  const pend = qcPendingOf(r);
  if (got > pend) return qcRetMsg(`Only ${nf(pend)} piece(s) are still out with ${r.employee || 'them'} on this issue.`, true);
  if (ok < 0 || bad < 0) return qcRetMsg('Mended and still-wrong cannot be negative.', true);
  if ((ok || bad) && ok + bad !== got)
    return qcRetMsg(`Mended + still wrong (${nf(ok + bad)}) must equal what came back (${nf(got)}).`, true);
  const reason = rejWhyTyped('qcr'), whyErr = rejWhyErr(bad, reason) || (rejWhyNeeded(bad) ? qcScrapNotReady() : '');
  if (whyErr) return qcRetMsg(whyErr, true);

  const fields = { date: ptStampDate(), issuanceId: String(r.id), receivedBy: by,
    employee: r.employee || '', employmentType: r.employmentType || '',
    brand: r.brand || '', articleType: r.articleType || '', subtype: r.subtype || '',
    color: r.color || '', size: r.size || '', sku: r.sku || '',
    received: got, reworkedOk: ok, stillRejected: bad,
    remarks: String($('qcrRemarks').value || '').trim(),
    addedBy: ME.email, addedAt: new Date().toISOString() };
  const row = Object.assign({ id: qcDraftId('qcr_', Object.assign({}, fields, reason),
    () => 'qcr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) }, fields);
  const scrapped = qcAltScrapChecks(row, reason);
  $('qcrSave').disabled = true;
  try { await qcWriteReturn(row, scrapped); }
  catch (e) { return qcRetMsg('Not saved: ' + (e.message || e), true); } finally { $('qcrSave').disabled = false; }
  frmRemember('qcReturn', $('qcrBox'));
  lineHoldDraftDone(QC_DRAFTS, row.id);
  QC.ret = (QC.ret || []).filter(x => !(x && x.id === row.id)).concat([Object.assign({ _key: row.id }, row)]);
  if (scrapped.length) QC.checks = (QC.checks || []).filter(c => !(c && c.id === scrapped[0].id)).concat(scrapped.map(c => Object.assign({ _key: c.id }, c)));
  ['qcrPcs', 'qcrOk', 'qcrRej', 'qcrRemarks'].forEach(id => { if ($(id)) $(id).value = ''; });
  rejWhyClear('qcr');
  renderQc(); renderQcRetForm();
  qcRetMsg(`${nf(got)} piece(s) of ${row.sku} back from ${row.employee}`
    + (ok || bad ? ` — ${nf(ok)} mended, ${nf(bad)} still wrong` : '')
    + `. ${nf(qcPendingOf(r))} still with them.` + (rejWhyNeeded(bad) ? qcScrapNote(row.sku, scrapped) : ''));
  return '';
}

/* PIECES STILL WRONG AFTER ALTERATION, SPOTTING OR TOUCHING ARE SCRAPPED (Ravi, 27 Nov; switch lineHold), so a new one is
 * cut. QC records the rejection with its reason on an order: spotting and touching know theirs; alteration goes out and comes
 * back by SKU, so it is the SKU's oldest unfinished order. */
/** The orders still owing pieces of a SKU: open, and not yet made in full (passed by QC, pressed or filled from stock). */
const qcUnfinishedOrders = sku => new Set(ordLines().filter(l => l.sku === qcNorm(sku) && l.open && l.pressed < l.qty).map(l => l.orderNo));
/** The oldest of them; '' when none is unfinished. */
function qcScrapOrderOf(sku) {
  const owing = qcUnfinishedOrders(sku);
  return (cutOrdersFor(sku).filter(o => owing.has(o.orderNo))
    .sort((a, b) => (ptDtMs(a.date) - ptDtMs(b.date)) || a.orderNo.localeCompare(b.orderNo))[0] || {}).orderNo || '';
}
/** The oldest order cannot be told from a half-read order book (page registers). */
const qcScrapNotReady = () => (prOn() && !ptHas(PTG_ALL) ? ptStillReading() : '');
/** The QC rejection for the still-wrong pieces of one alteration return: none when nothing is scrapped or no order of the SKU
 *  is unfinished. Checked and passed stay 0, as these pieces were counted when first checked. */
function qcAltScrapChecks(ret, reason) {
  const orderNo = rejWhyNeeded(ret.stillRejected) ? qcScrapOrderOf(ret.sku) : '';
  if (!orderNo) return [];
  return [Object.assign({ id: 'qc_' + ret.id, date: ptNow(), checkedBy: ret.receivedBy, brand: ret.brand, articleType: ret.articleType,
    subtype: ret.subtype, color: ret.color, size: ret.size, sku: ret.sku, orderNo, checked: 0, ok: 0, forAlteration: 0,
    rejected: ret.stillRejected, altReturnId: ret.id, from: 'alteration', remarks: 'Still wrong after alteration — scrapped',
    addedBy: ret.addedBy, addedAt: ret.addedAt }, rejWhySaved(ret.stillRejected, reason))];
}
/** The return and its QC rejection are written together, all or none. */
function qcWriteReturn(ret, scrapped) {
  if (!scrapped.length) return ptPut('pt_qcReturns/' + ret.id, ret);
  return ptPatch(Object.assign({ ['pt_qcReturns/' + ret.id]: ret }, ...scrapped.map(c => ({ ['pt_qcChecks/' + c.id]: c }))));
}
const qcScrapNote = (sku, scrapped) => (scrapped.length
  ? ` ${nf(scrapped[0].rejected)} scrapped on ${scrapped[0].orderNo}.` : ` No order of ${sku} is unfinished, so nothing is cut again.`);

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
  if (!QC_IX) return qcWithIx(renderQcCheckForm);
  frmWire('qcCheck', $('qcwBox'));   // my previous check in grey, Tab fills (core/form-memory.js)
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
    /* What is waiting on each order first — that is the order the inspector is holding. */
    const on = (sku0 ? qcOrdersFor(sku0) : []).map(o => Object.assign({}, o, { wait: qcOrderAvail(o.orderNo, sku0) }))
      .sort((a, b) => (b.wait - a.wait) || (b.received - a.received) || a.orderNo.localeCompare(b.orderNo));
    $('qcwOrdList').innerHTML = on
      .map(o => `<option value="${esc(o.orderNo)}">${esc(o.date || '')} · ${nf(o.ordered)} ordered · ${nf(o.received)} received · ${nf(o.wait)} waiting for QC</option>`).join('');
    /* THE BOX SAYS WHETHER IT IS NEEDED, and fills itself in when there is only one answer — asking
     * somebody to type the one order a SKU is on is how a box comes to be left empty 245 times. */
    const box = $('qcwOrd');
    if (box) {
      box.placeholder = !sku0 ? 'Order No' : (on.length ? 'Order No *' : 'Order No — this SKU is on no order');
      const waiting = on.filter(o => o.wait > 0);
      if (!String(box.value || '').trim() && (on.length === 1 || waiting.length === 1)) box.value = (waiting[0] || on[0]).orderNo;
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
  rejWhyBoxes('qcw', rj);
  /* Both ceilings are shown while typing, so a refusal is never a surprise at the end. */
  let note = '';
  if (p) note = `${p.at || '—'} · ${p.sub || '—'} · ${p.col || '—'} · ${p.size || '—'}`
    + (any ? '  ·  free inspection — not measured against Job Work Register'
           : `  ·  received ${nf(qcReceived(sku))}, already checked ${nf(qcChecked(sku))}, ${nf(qcAvailToCheck(sku))} left to check`);
  let warn = '';
  if (sku && !parts.has(qcNorm(sku))) warn = any ? `${qcNorm(sku)} is not in the master database.` : `${qcNorm(sku)} has nothing received in Job Work waiting to be checked.`;
  else if (!any && sku && ch > qcAvailToCheck(sku)) warn = `Pieces checked (${ch}) is more than the ${nf(qcAvailToCheck(sku))} available.`;
  else if (sku && ch > 0 && obUC(($('qcwOrd') || {}).value) && qcOrdersFor(sku).length
      && ch > qcOrderAvail(obUC($('qcwOrd').value), sku))
    warn = `Order ${obUC($('qcwOrd').value)} has only ${nf(qcOrderAvail(obUC($('qcwOrd').value), sku))} piece(s) received and not checked yet.`;
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

/* ==== QC: ONE SAVE AT A TIME PER SKU ====
 * (Ravi, 26 Nov, after the PPC test run: two screens passed the same pieces.) Behind the switch lineHold. Every QC save that takes
 * pieces — a check, a pass from Waiting for QC, an alteration issue, a return from spotting or touching — holds the SKU, reads
 * this SKU's checks and alteration issues from the database, asks its own question again on them, then writes. The whole SKU
 * is held, not one order, because what may still be checked or issued for alteration is counted across the SKU.
 * Save pressed again for the same figures within 10 minutes writes the same records (core/line-hold.js lineHoldDraftId).
 * Fails loudly: if the SKU cannot be held or read, nothing is saved and the screen says why. Switch off: as before. */
const QC_DRAFTS = new Map();   // unsaved QC figures → the id they are written under
/** The id for a new QC record: kept for the same figures while the switch is on, a new one as before while it is off. */
const qcDraftId = (prefix, fields, make) => (lineHoldOn() ? lineHoldDraftId(QC_DRAFTS, prefix, Object.assign({}, fields, { date: '' })) : make());
/** This SKU's checks and alteration issues, from the database, laid over the screen's copy. */
async function qcFreshSku(sku) {
  const [c, i] = await Promise.all([ptGetFreshWhere('pt_qcChecks', 'sku', sku), ptGetFreshWhere('pt_qcIssuance', 'sku', sku)]);
  const swap = (rows, raw) => { const f = ptList(raw), ids = new Set(f.map(r => r.id)); return (rows || []).filter(r => !(r && ids.has(r.id))).concat(f); };
  QC.checks = swap(QC.checks, c); QC.issue = swap(QC.issue, i);
}
/** o: { sku, draft: the id the figures were given, ids: the records' ids, saved: () => the list they land in,
 *  recheck: () => '' or why not, on what the database holds, write: () => the save }. '' when saved, else the sentence. */
async function qcSaveHeld(o) {
  if (!lineHoldOn()) { await o.write(); return ''; }
  const why = await lineHoldRun({ register: 'qc', orderNo: '', sku: o.sku, form: o.draft }, async () => {
    try { await qcFreshSku(o.sku); } catch (e) {
      console.warn('[line hold] could not read the QC of ' + o.sku + ' before saving:', e);
      return 'Nothing was saved — the QC already recorded on ' + o.sku + ' could not be checked (' + (e.message || e) + '). Check the connection and save again.';
    }
    if (o.saved().some(r => r && o.ids.includes(r.id))) return '';   // an earlier press of Save reached the database
    const left = o.recheck();
    if (left) return 'Not saved — ' + left;
    await o.write();
    return '';
  });
  if (!why) lineHoldDraftDone(QC_DRAFTS, o.draft);
  return why;
}
/** What a check may still take, asked again just before it is written. */
function qcCheckLeft(sku, checked, any, ord) {
  if (ord && checked > qcOrderAvail(ord, sku))
    return `only ${nf(qcOrderAvail(ord, sku))} piece(s) of ${sku} on ${ord} are received and not checked yet — somebody else has just checked some.`;
  if (!any && checked > qcAvailToCheck(sku))
    return `only ${nf(Math.max(0, qcAvailToCheck(sku)))} piece(s) of ${sku} are waiting to be checked — somebody else has just checked some.`;
  return '';
}
/* ==== END QC ONE SAVE AT A TIME ==== */

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
  /* ONE NUMBER RULE (fix 6, 26 Nov; switch lineHold): 2.5 pieces was saved as 2. Checked is above 0; alteration and rejected may be 0. */
  if (lineHoldOn()) {
    const numErr = ptNumErr($('qcwChecked').value, 'Pieces checked', 'pcs') || ptNumErr($('qcwAlt').value, 'For alteration', 'pcs', true)
      || ptNumErr($('qcwRej').value, 'Rejected', 'pcs', true);
    if (numErr) return qcCheckMsg(numErr, true);
  }
  if (!isFinite(checked) || checked <= 0) return qcCheckMsg('Enter how many pieces were checked.', true);
  if (alt < 0 || rej < 0) return qcCheckMsg('For alteration and rejected cannot be negative.', true);
  if (alt + rej > checked) return qcCheckMsg(`For alteration + rejected (${alt + rej}) is more than the ${checked} checked.`, true);
  const reason = rejWhyTyped('qcw'), whyErr = rejWhyErr(rej, reason);
  if (whyErr) return qcCheckMsg(whyErr, true);
  if (!any) {
    const avail = qcAvailToCheck(sku);
    if (checked > avail)
      return qcCheckMsg(`Only ${nf(avail)} piece(s) available to check for ${sku} — received ${nf(qcReceived(sku))}, `
        + `already checked ${nf(qcChecked(sku))}.`, true);
  }

  /* AN ORDER, WHEREVER THERE IS ONE TO NAME. Every other register is keyed by order, and the Order
   * Console shows this figure as an order's own QC — a check with no order is invisible there. */
  /* Page registers: a QC check is never saved against a half-read order book (switch on only; never reached with it off). */
  if (prOn() && !ptHas(PTG_ALL)) return qcCheckMsg(ptStillReading(), true);
  const onOrders = qcOrdersFor(sku), ordTyped = obUC(($('qcwOrd') || {}).value);
  const waitOn = onOrders.filter(o => qcOrderAvail(o.orderNo, sku) > 0);
  /* A free inspection of pieces no order has received (the "any" source) may go on no order — it is shared out by SKU on the
   * console, never past what an order received. Anything else names its order. */
  if (onOrders.length && !ordTyped && !(any && !waitOn.length))
    return qcCheckMsg(`${sku} is on ${nf(onOrders.length)} order(s) — pick which one these pieces are for.`, true);
  if (ordTyped && onOrders.length && !onOrders.some(o => o.orderNo === ordTyped))
    return qcCheckMsg(`Order ${ordTyped} has no line for ${sku}. It is on: ${onOrders.slice(0, 4).map(o => o.orderNo).join(', ')}${onOrders.length > 4 ? '…' : ''}.`, true);
  if (ordTyped && onOrders.length && checked > qcOrderAvail(ordTyped, sku)) {
    const others = waitOn.filter(o => o.orderNo !== ordTyped);
    return qcCheckMsg(`Order ${ordTyped} has only ${nf(qcOrderAvail(ordTyped, sku))} piece(s) of ${sku} received and not checked yet `
      + `(received ${nf(qcOrderRecv(ordTyped, sku))}, already checked ${nf(qcOrderChecked(ordTyped, sku))}). `
      + (others.length ? `Pieces are waiting on ${others.slice(0, 4).map(o => o.orderNo + ' (' + nf(qcOrderAvail(o.orderNo, sku)) + ')').join(', ')} — pick that order.`
        : 'Receive them in Job Work against this order first.'), true);
  }

  const p = qcParts(sku);
  const fields = {
    date: ptNow(), checkedBy: by, brand: p.brand, articleType: p.at, subtype: p.sub, color: p.col, size: p.size,
    sku, checked, forAlteration: alt, rejected: rej, ok: checked - alt - rej, ...rejWhySaved(rej, reason),
    /* Blank survives only for a SKU that is on no order at all — there is nothing to name, and a
     * number somebody made up would be worse than none. */
    ...(obUC(($('qcwOrd') || {}).value) ? { orderNo: obUC($('qcwOrd').value) } : {}),
    remarks: $('qcwRemarks').value.trim(), addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  const rec = Object.assign({ id: qcDraftId('qc_', fields, qcNewCheckId) }, fields), ord = ordTyped && onOrders.length ? ordTyped : '';
  $('qcwSave').disabled = true;
  qcCheckMsg('Saving…');
  try {
    const why = await qcSaveHeld({ sku, draft: rec.id, ids: [rec.id], saved: () => QC.checks,
      recheck: () => qcCheckLeft(sku, checked, any, ord), write: () => ptPut('pt_qcChecks/' + rec.id, rec) });
    if (why) { qcCheckMsg(why, true); $('qcwSave').disabled = false; return; }
    frmRemember('qcCheck', $('qcwBox'));
    QC.checks = (QC.checks || []).filter(r => !(r && r.id === rec.id)).concat(Object.assign({ _key: rec.id }, rec));
    ['qcwChecked', 'qcwAlt', 'qcwRej', 'qcwRemarks', 'qcwOrd'].forEach(id => { $(id).value = ''; });
    $('qcwSku').value = ''; $('qcwSz').value = ''; $('qcwSku').dataset.typed = '';
    rejWhyClear('qcw');
    renderQcCheckForm(); renderQc();
    qcCheckMsg(`Saved — ${nf(checked)} checked, ${nf(checked - alt - rej)} passed, ${nf(alt)} for alteration, ${nf(rej)} rejected.`);
  } catch (e) { qcCheckMsg('Not saved: ' + (e.message || e), true); }
  $('qcwSave').disabled = false;
};

/* ---- issuing for alteration ---- */

function qcIssueMsg(t, bad) { const m = $('qciMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

function renderQcIssueForm() {
  if (!QC_IX) return qcWithIx(renderQcIssueForm);
  frmWire('qcIssue', $('qciBox'));   // my previous alteration issue in grey, Tab fills (core/form-memory.js)
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
  const fields = {
    date: ptNow(), employee: emp[1], employmentType: type, brand: p.brand,
    articleType: p.at, subtype: p.sub, color: p.col, size: p.size, sku, pieces: pcs,
    remarks: $('qciRemarks').value.trim(), addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  const rec = Object.assign({ id: qcDraftId('qci_', fields, () => 'qci_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) }, fields);
  $('qciSave').disabled = true;
  qcIssueMsg('Saving…');
  try {
    const why = await qcSaveHeld({ sku, draft: rec.id, ids: [rec.id], saved: () => QC.issue,
      recheck: () => (pcs > qcAvailToIssue(sku) ? `only ${nf(Math.max(0, qcAvailToIssue(sku)))} piece(s) of ${sku} are left to issue for alteration — somebody else has just issued some.` : ''),
      write: () => ptPut('pt_qcIssuance/' + rec.id, rec) });
    if (why) { qcIssueMsg(why, true); $('qciSave').disabled = false; return; }
    frmRemember('qcIssue', $('qciBox'));
    QC.issue = (QC.issue || []).filter(r => !(r && r.id === rec.id)).concat(Object.assign({ _key: rec.id }, rec));
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
  if (r.altReturnId) { $('qcMsg').className = 'err'; $('qcMsg').textContent = 'These pieces were scrapped when they came back from alteration — this one cannot be edited here.'; return; }
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
      ...(rejWasOld(r) ? [] : rejWhyFields(r)),
      { key: 'remarks', label: 'Remarks', value: r.remarks || '', span: true },
      { key: 'date', label: 'Check date', type: 'date', value: ptIsoDate(r.date), admin: true },
    ],
    deleteWhat: `a QC check of ${nf(ptNum(r.checked))} piece(s) of ${r.sku} on ${r.date}`,
    onSave: async v => {
      const ch = parseInt(v.checked, 10), al = parseInt(v.forAlteration, 10) || 0, rj = parseInt(v.rejected, 10) || 0;
      if (!isFinite(ch) || ch <= 0) return 'Pieces checked must be at least 1.';
      if (al < 0 || rj < 0) return 'For alteration and rejected cannot be negative.';
      if (al + rj > ch) return `For alteration + rejected (${al + rj}) is more than the ${ch} checked.`;
      const reason = rejWhyOf(v), whyErr = rejOldErr(r, rj, reason) || rejWhyErr(rejEditPcs(r, rj, reason), reason);
      if (whyErr) return whyErr;
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
      const next = rejWhyOnEdit(Object.assign({}, r, {
        checkedBy: v.checkedBy || r.checkedBy, checked: ch, forAlteration: al, rejected: rj, ok: ch - al - rj,
        remarks: String(v.remarks || '').trim(),
        date: v.date ? ptStampFrom(r.date, v.date) : r.date,
        editedBy: ME.email, editedAt: new Date().toISOString(),
      }), reason);
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
/** What is still waiting for QC, row by row, oldest first. */
const qcInboxRows = () => qcInboxEntries().filter(x => x.wait > 0);
/** Every Job Work row that came back for QC — waiting, part accepted or all accepted — oldest first. */
function qcInboxEntries() {
  const from = qcInboxFromMs();
  const took = new Map();
  (QC.checks || []).forEach(c => { if (c && c.baseId) took.set(c.baseId, (took.get(c.baseId) || 0) + ptNum(c.checked)); });
  const out = [];
  (PT.base || []).forEach(r => {
    if (!r || !r.id) return;
    /* EVERY RECEIVED PIECE, dated the way the Reports date it (repRecvParts): each receipt on its own day, and what the
     * receipts do not cover on the receiving date. Pieces received through Edit carried no receipt and never showed
     * here (2026-10-08, Ravi: "5 OCT KE BAD WALI ENTRY ABHI DIRECT WAITING FOR QC ME SHOW NAHI HO RHA H") — 70 entries. */
    let since = 0, last = 0;
    /* THE LEGACY ORDER'S PIECES WAIT TOO (Ravi, 24 Oct: "Legacy order ki 88 lines (1,423 pcs) pending show nhi ho rhi h"):
     * LEG-… holds the pieces made on the floor before the app had orders for them; 1,207 of them came back 1–4 Oct, before QC
     * began, so the date line kept them out of here for good and their lines open for ever. Every receipt of theirs counts. */
    const legacy = /^LEG-/i.test(String(r.orderNo || ''));
    repRecvParts(r).forEach(p => { if (legacy || p.ms >= from) { since += p.pcs; if (p.ms > last) last = p.ms; } });
    /* Never more than the row says came back — a correction may have lowered it after the receipt was logged. */
    since = Math.min(since, ptNum(r.receivedPieces));
    const accepted = took.get(r.id) || 0, wait = Math.max(0, since - accepted);
    if (!(since > 0)) return;
    out.push({ r, since, accepted, wait, last });
  });
  /* EMBROIDERED, CUT, STRAIGHT TO QC (Ravi, 21 Oct): a Production flow line on Printing + Embroidery has no karigar, so its
   * pieces come here from the cutting entry (marked qcDirect) — one row per entry, taken off it the way a karigar's are. */
  (PT.cut || []).forEach(c => {
    const id = c && (c.id || c._key); if (!id || !c.qcDirect || !c.orderNo) return;
    const ms = ptDtMs(c.cutDate) || ptDtMs(c.addedAt) || 0; if (ms && ms < from) return;
    const pcs = ptNum(c.pieces), accepted = took.get(id) || 0, wait = Math.max(0, pcs - accepted);
    if (!(pcs > 0)) return;
    out.push({ r: { id, sku: c.sku, orderNo: c.orderNo, articleType: c.articleType || '', articleSubtype: c.articleSubtype || '', color: c.color || '', size: c.size || '',
      empName: 'Cut after embroidery', empType: 'no karigar — straight to QC', receivedPieces: pcs, fromCut: true,
      qcReceivedAt: c.qcReceivedAt || '', qcReceivedBy: c.qcReceivedBy || '', qcReceivedOn: c.qcReceivedOn || '', qcReceivedPcs: c.qcReceivedPcs || 0 },
      since: pcs, accepted, wait, last: ms || Date.now() });
  });
  out.sort((a, b) => a.last - b.last);
  /* CHECKED ON THE OLD FORM: a check that names the order and SKU but no Job Work entry (the Checks form) has already
   * looked at pieces of that order — from QC_INBOX_FROM on, they come off its waiting entries, oldest first. Without this
   * the 661 pieces checked that way on 5–8 Oct would have waited a second time. */
  const free = new Map();
  (QC.checks || []).forEach(c => { if (!c || c.baseId || !c.orderNo || ptDtMs(c.date) < from) return;
    const k = obUC(c.orderNo) + '|' + qcNorm(c.sku); free.set(k, (free.get(k) || 0) + ptNum(c.checked)); });
  if (free.size) out.forEach(x => { const k = obUC(x.r.orderNo) + '|' + qcNorm(x.r.sku), f = free.get(k) || 0; if (!f) return;
    const take = Math.min(f, x.wait); x.wait -= take; x.accepted += take; free.set(k, f - take); });
  return out;
}

/*
 * WHERE EACH ROW'S PIECES ARE NOW (Ravi, 19 Nov: "it should show that given to karigar, touching, spotting and other
 * columns, and if the article has passed qc completely then it shows in a list qc passed, not here").
 * Waiting for QC keeps a row, in its own place, while any of its pieces is still waiting, at spotting, at touching or with a
 * karigar for alteration; once QC Accept is pressed it is a grey button with the date. When nothing is left anywhere —
 * rejected pieces do not hold a row back — the row moves to QC passed, newest first.
 * Alteration is issued and received back by SKU, not by row, so what came back for a SKU is set against its rows'
 * alteration pieces oldest first: mended counts as passed, still wrong as rejected.
 */
const QC_LISTS = {
  inbox: { keep: x => !x.done, dated: x => x.last, newestFirst: false,
    empty: 'Nothing waiting — every piece received from karigars has passed QC or been rejected.' },
  passed: { keep: x => x.done, dated: x => x.ms || x.last, newestFirst: true,
    empty: 'Nothing has finished QC in these dates.' },
};

/** Where one row's pieces are, from its own QC checks and what came back from spotting and touching. */
function qcPiecesOf(x) {
  const mine = (QC.checks || []).filter(c => c && c.baseId === x.r.id);
  const takes = mine.filter(c => !c.refId), backs = mine.filter(c => c.refId);
  const sum = (list, f) => list.reduce((a, c) => a + ptNum(f(c)), 0);
  const backOf = send => sum(backs.filter(b => b.refId === send.id), b => ptNum(b.ok) + ptNum(b.rejected));
  const outAt = dept => takes.filter(c => c.dept === dept).reduce((a, c) => a + Math.max(0, ptNum(c[dept]) - backOf(c)), 0);
  const latest = list => list.reduce((a, c) => (ptDtMs(c.date) >= ptDtMs(a && a.date) ? c : a), null);
  const last = latest(takes);
  /* Received by QC: the QC Accept press, kept on the Job Work entry itself — or, for rows QC worked on before 19 Nov, when
   * there was no such press, its first check. */
  const first = takes.reduce((a, c) => (!a || ptDtMs(c.date) < ptDtMs(a.date) ? c : a), null);
  const receipt = x.r.qcReceivedAt ? { date: x.r.qcReceivedAt, checkedBy: x.r.qcReceivedBy } : first;
  /* Pieces of this order taken on the old Checks form (no row named) are counted as passed: that form passed or flagged
   * them by SKU, not by row. */
  const oldForm = Math.max(0, x.accepted - sum(takes, c => c.checked));
  return {
    passed: sum(takes, c => (c.dept ? 0 : c.ok)) + sum(backs, c => c.ok) + oldForm,
    alteration: sum(takes, c => c.forAlteration), rejected: sum(takes, c => c.rejected) + sum(backs, c => c.rejected),
    spotting: outAt('spotting'), touching: outAt('touching'),
    by: last ? last.checkedBy || '' : '', ms: last ? ptDtMs(last.date) : 0, remarks: last ? last.remarks || '' : '',
    received: !!receipt || x.accepted > 0, receivedBy: receipt ? receipt.checkedBy || '' : '', receivedMs: receipt ? ptDtMs(receipt.date) : 0,
    passOpensAt: qcPassOpensAt(x.r),
  };
}
/*
 * QC PASS WAITS 30 SECONDS AFTER QC ACCEPT (27 Nov, asked for the Quality Control screen; it replaces the 19 Nov rule of a
 * minute for every piece received). The same wait whatever the pieces; rows accepted before 19 Nov have no wait.
 */
const QC_PASS_WAIT_MS = 30 * 1000;
function qcPassOpensAt(row) {
  const on = Date.parse((row && row.qcReceivedOn) || '');
  return isFinite(on) ? on + QC_PASS_WAIT_MS : 0;
}
/** "4:05" or "1:02:30" — time left, rounded up to the second. */
function qcTimeLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}
/** The locked QC pass button, counting down; qcPassTick wakes it when its time is up. */
function qcPassLockedBtn(x) {
  return `<button class="qc-closed" disabled data-qc-unlock="${x.passOpensAt}" title="QC pass opens 30 seconds after QC Accept">`
    + `QC pass · ${qcTimeLeft(x.passOpensAt - Date.now())}</button>`;
}
/* One timer for the whole list, every second: it rewrites the countdowns and, when one runs out, redraws the list so that
 * QC pass turns blue. It stops itself when no countdown is left on the page (another view, or all open). */
let QC_PASS_TIMER = null;
function qcPassTick() {
  const locked = [...document.querySelectorAll('[data-qc-unlock]')];
  if (!locked.length) { clearInterval(QC_PASS_TIMER); QC_PASS_TIMER = null; return; }
  if (locked.some(b => Number(b.getAttribute('data-qc-unlock')) <= Date.now())) return renderQc();
  locked.forEach(b => { b.textContent = 'QC pass · ' + qcTimeLeft(Number(b.getAttribute('data-qc-unlock')) - Date.now()); });
}
function qcPassTimerStart() { if (!QC_PASS_TIMER) QC_PASS_TIMER = setInterval(qcPassTick, 1000); }
/** Pieces of each SKU back from alteration: mended and still wrong. A return booked without the split counts as mended. */
function qcAltBackBySku() {
  const back = new Map();
  (QC.ret || []).forEach(r => {
    if (!r) return;
    const k = qcNorm(r.sku), e = back.get(k) || { ok: 0, bad: 0 }, bad = ptNum(r.stillRejected);
    const got = Math.max(ptNum(r.received), ptNum(r.reworkedOk) + bad);
    back.set(k, { ok: e.ok + got - bad, bad: e.bad + bad });
  });
  return back;
}
/** Every row that came back for QC, oldest received first, with where its pieces are now and whether it is done. */
function qcInboxStatuses() {
  const altBack = qcAltBackBySku();
  return qcInboxEntries().map(x => {
    const s = qcPiecesOf(x), k = qcNorm(x.r.sku), back = altBack.get(k) || { ok: 0, bad: 0 };
    const ok = Math.min(back.ok, s.alteration), bad = Math.min(back.bad, s.alteration - ok);
    altBack.set(k, { ok: back.ok - ok, bad: back.bad - bad });
    const now = Object.assign({}, x, s, { passed: s.passed + ok, rejected: s.rejected + bad, alteration: s.alteration - ok - bad });
    return Object.assign(now, { done: now.wait === 0 && !now.alteration && !now.spotting && !now.touching });
  });
}
/** "✓ Accepted 19/11 12:30 · Sunita" — a grey button's words: what happened, when, and who. */
function qcStamp(word, ms, by) {
  const p = n => String(n).padStart(2, '0'), d = new Date(ms);
  const when = ms ? `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}` : '';
  return ['✓ ' + word + (when ? ' ' + when : ''), by].filter(Boolean).join(' · ');
}
/* The Dated range, as [from, to] in ms, or nulls (2026-10-07, Ravi: "filter range not working here"). */
function qcRangeMs() {
  const [d1, d2] = ptRangeOf('qcD1', 'qcD2');
  return [d1 ? new Date(d1 + 'T00:00:00').getTime() : null, d2 ? new Date(d2 + 'T23:59:59').getTime() : null];
}
const qcInRangeMs = (ms, r) => (r[0] == null || ms >= r[0]) && (r[1] == null || ms <= r[1]);
/** The rows one list shows: its own rule, the search, and the Dated range (received on Waiting, finished on QC passed). */
function qcListRows(view) {
  const list = QC_LISTS[view], q = $('qcQ').value.trim().toLowerCase(), rng = qcRangeMs();
  const rows = qcInboxStatuses().filter(x => list.keep(x) && qcInRangeMs(list.dated(x), rng)
    && (!q || [x.r.sku, x.r.articleType, x.r.articleSubtype, x.r.color, x.r.size, x.r.empName, x.r.orderNo].join(' ').toLowerCase().includes(q)));
  return list.newestFirst ? rows.sort((a, b) => list.dated(b) - list.dated(a)) : rows;
}
const QC_INBOX_COLS = ['Received', 'Karigar', 'SKU', 'Image', 'Item', 'Order', 'Received', 'Passed', 'Given to karigar', 'Spotting', 'Touching', 'Rejected', 'Waiting', ''];

/** Waiting for QC, or QC passed: the same columns, the list's own rows. */
function renderQcInbox(view) {
  const rows = qcListRows(view);
  QC.rows = rows.map(x => x.r); QC.inbox = rows;
  $('qcKpis').innerHTML = view === 'passed' ? qcPassedKpis(rows) : qcWaitingKpis(rows);
  const head = '<thead><tr>' + QC_INBOX_COLS.map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 6 && i <= 12 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const can = ptCanEdit() || ME.admin || (ME.tabs || []).includes('qc');
  const num = (v, color) => `<td class="num"${v && color ? ` style="color:${color}"` : ''}>${v ? nf(v) : '<span class="muted">—</span>'}</td>`;
  $('qcTable').innerHTML = head + '<tbody>' + (rows.slice(0, 600).map(x => '<tr>'
    + (d => `<td class="frz" style="text-align:left">${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}<div class="muted" style="font-size:11px">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</div></td>`)(new Date(x.last))
    + `<td style="text-align:left">${esc(x.r.empName || '')}<div class="muted" style="font-size:11px">${esc(x.r.empType || '')}</div></td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(x.r.sku)}</td>`
    + ptImgCell(x.r.sku)
    + `<td class="qc-wrap" style="text-align:left">${esc([x.r.articleSubtype || x.r.articleType, x.r.color, x.r.size].filter(Boolean).join(' · '))}</td>`
    + `<td class="qc-wrap" style="text-align:left">${esc(x.r.orderNo || '') || '<span class="muted">—</span>'}</td>`
    + num(x.since) + num(x.passed, '#166534') + num(x.alteration, '#b45309') + num(x.spotting, '#b45309') + num(x.touching, '#b45309')
    + num(x.rejected, 'var(--bad)') + `<td class="num" style="font-weight:700;color:#b45309">${x.wait > 0 ? nf(x.wait) : '<span class="muted">—</span>'}</td>`
    + `<td style="white-space:nowrap;text-align:left">${view === 'passed' ? qcClosedBtn(qcStamp('QC passed', x.ms, x.by))
      + (ptCanEdit() || ME.admin ? `<button data-qcp-edit="${esc(x.r.id)}" class="ghost qc-act" title="Change who checked these pieces">Edit</button>` : '')
      : qcInboxActions(x, can)}</td>`
    + '</tr>').join('') || `<tr><td colspan="${QC_INBOX_COLS.length}" class="muted" style="padding:14px">${QC_LISTS[view].empty}</td></tr>`) + '</tbody>';
  if (rows.some(x => x.passOpensAt > Date.now())) qcPassTimerStart();
  $('qcMsg').className = 'muted';
  $('qcMsg').textContent = (view === 'passed'
    ? `${nf(rows.length)} entr${rows.length === 1 ? 'y' : 'ies'} finished QC, newest first · every piece passed or rejected, nothing left at spotting, touching or with a karigar`
    : `${nf(rows.length)} entr${rows.length === 1 ? 'y' : 'ies'}, oldest first · QC Accept = QC has received the pieces; then QC pass checks them (passed, alteration, rejected, spotting, touching) · a row stays here until nothing is left waiting, at spotting, at touching or with a karigar, then moves to QC passed`)
    + (rows.length > 600 ? ' · showing the first 600 — narrow the dates or search' : '');
}
/* Ravi, 19 Nov: "when I do qc Accept it should show me qc accept to get grey but qc pass to stay untouched by system and
 * only work when the user clicks on it" — QC Accept, once pressed, is a grey closed button saying when and by whom; QC pass
 * is grey until then (QC Accept comes first), open after, and grey again only when no piece is left waiting. */
const qcClosedBtn = (label, title) => `<button class="qc-closed" disabled${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
function qcInboxActions(x, can) {
  const acceptedSign = qcClosedBtn(qcStamp('Accepted', x.receivedMs, x.receivedBy), 'QC has received these pieces');
  if (!can) return x.received ? acceptedSign : '<span class="muted">—</span>';
  const accept = x.received ? acceptedSign
    : `<button data-qcin-accept="${esc(x.r.id)}" class="qc-act" title="QC has received these ${nf(x.wait)} piece(s) — then QC pass to check them">QC Accept</button>`;
  if (!x.received) return accept + qcClosedBtn('QC pass', 'Press QC Accept first');
  if (x.passOpensAt > Date.now()) return accept + qcPassLockedBtn(x);
  /* Ravi, 19 Nov: "when qc is accepted the qc pass should be blue … from which the user can click qc pass" — blue and
   * open on every accepted row; with nothing left waiting, a click says what QC already did instead of opening a window. */
  return accept + `<button data-qcin-check="${esc(x.r.id)}" class="qc-act" title="Open the QC Check window: passed, alteration, rejected, spotting, touching">QC pass</button>`;
}
function qcWaitingKpis(rows) {
  const waiting = rows.filter(x => x.wait > 0), sum = f => rows.reduce((a, x) => a + f(x), 0);
  const oldest = waiting.length ? Math.floor((Date.now() - Math.min(...waiting.map(x => x.last))) / 3600000) : 0;
  return `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Waiting for QC — received from karigars since ${esc(QC_INBOX_FROM.split('-').reverse().join('/'))}</span>
      <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:#b45309">${nf(sum(x => x.wait))}</div><div class="l">Pieces waiting</div></div>
      <div class="metric"><div class="v">${nf(waiting.length)}</div><div class="l">Job Work entries waiting</div></div>
      <div class="metric"><div class="v">${nf(sum(x => x.alteration))}</div><div class="l">With a karigar</div></div>
      <div class="metric"><div class="v">${nf(sum(x => x.spotting + x.touching))}</div><div class="l">At spotting / touching</div></div>
      <div class="metric"><div class="v"${oldest >= 24 ? ' style="color:var(--bad)"' : ''}>${waiting.length ? (oldest >= 24 ? nf(Math.floor(oldest / 24)) + ' day(s)' : nf(oldest) + ' h') : '—'}</div><div class="l">Oldest waiting</div></div>
    </div></div>`;
}
function qcPassedKpis(rows) {
  const sum = f => rows.reduce((a, x) => a + f(x), 0);
  return `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">QC passed — nothing left waiting, at spotting, at touching or with a karigar</span>
      <span class="kpiwhen">read live${QC.at ? ' · ' + esc(QC.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Job Work entries</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(sum(x => x.passed))}</div><div class="l">Pieces passed</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(sum(x => x.rejected))}</div><div class="l">Pieces rejected</div></div>
    </div></div>`;
}
/*
 * Two buttons on each Waiting for QC row (Ravi, 18–19 Nov):
 *   QC Accept — "QC has received these pieces": the date and who, kept on the Job Work entry; nothing checked or passed.
 *               It comes first; QC pass opens only after it.
 *   QC pass   — the QC Check window, BEFORE anything is saved: how many pieces passed, went for alteration, were rejected,
 *               went to spotting (a stain, 2026-10-06) or to touching (a missed or broken print). Together they are what
 *               QC checked; the rest stays waiting. Cancel writes nothing. (No back-by day — Ravi, 19 Nov: not needed.)
 * Sent pieces are taken (checked) but not passed (ok 0); they pass when they come back from the Spotting & touching tab.
 * Errors: a refused or failed save stays in the window with the reason (pieces are stock); nothing here fails quietly.
 * One check can write up to three records (the pass, a spotting send, a touching send) — in one update, all or none.
 */
const QC_DEPTS = { spotting: 'Spotting', touching: 'Touching' };
const qcMyName = () => String(ME.email || '').split('@')[0];
const qcSendRemark = dept => 'Sent to ' + QC_DEPTS[dept].toLowerCase() + ' from Waiting for QC';
const qcNewCheckId = () => 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const qcPcs = v => parseInt(v, 10) || 0;

/** `qty` of one Job Work row passed straight. '' or why not. The Order Console's batch pass. */
async function qcInboxAccept(baseId, qty) {
  return qcInboxSave(baseId, { passed: qty });
}
/*
 * QC Accept: record that QC has received this row's waiting pieces. '' or why not. Pressing it twice writes once.
 * It is kept on the Job Work entry (or the cutting entry, for pieces cut after embroidery) as two fields, not as a QC check:
 * every report, chart, Meera answer and the Order Console's QC column counts QC checks, and a receipt is not one.
 */
async function qcInboxReceive(baseId) {
  const x = qcInboxStatuses().find(e => e.r.id === baseId && e.wait > 0);
  if (!x) return 'That entry is no longer waiting — press Refresh.';
  if (x.received) return '';
  const node = x.r.fromCut ? 'pt_cuttingData' : 'pt_baseData';
  /* qcReceivedOn (world time, to the second) starts QC pass's 30-second wait; qcReceivedPcs records what was received. */
  const stamp = { qcReceivedAt: ptNow(), qcReceivedBy: qcMyName(), qcReceivedOn: new Date().toISOString(), qcReceivedPcs: x.wait };
  await ptPatch(Object.fromEntries(Object.entries(stamp).map(([k, v]) => [`${node}/${baseId}/${k}`, v])));
  const withStamp = list => (list || []).map(r => (r && (r.id || r._key) === baseId ? Object.assign({}, r, stamp) : r));
  PT = Object.assign({}, PT, x.r.fromCut ? { cut: withStamp(PT.cut) } : { base: withStamp(PT.base) });
  return '';
}

const QC_SPLIT = ['passed', 'forAlteration', 'rejected', 'spotting', 'touching'];
/** How many pieces QC checked: everything the split names. */
const qcCheckedOf = e => QC_SPLIT.reduce((a, k) => a + qcPcs(e[k]), 0);

/** Why this split of the pieces cannot be saved, or ''. */
function qcInboxRefusal(x, e) {
  if (QC_SPLIT.some(k => qcPcs(e[k]) < 0)) return 'Passed, alteration, rejected, spotting and touching cannot be negative.';
  const q = qcCheckedOf(e);
  if (!(q > 0)) return 'Type how many pieces passed, or went for alteration, rejected, spotting or touching.';
  if (q > x.wait) return `Passed + alteration + rejected + spotting + touching is ${nf(q)} — only ${nf(x.wait)} piece(s) of this entry are waiting.`;
  return rejWhyErr(qcPcs(e.rejected), rejWhyOf(e));
}

/** The records one QC Check window writes for a row: the check (passed, alteration, rejected) and a send per spotting/touching. */
function qcCheckRecords(r, entry, date, id) {
  const p = qcParts(r.sku);
  const common = {
    date, checkedBy: String(entry.checkedBy || '').trim() || qcMyName(), brand: p.brand,
    articleType: p.at || r.articleType || '', subtype: p.sub || r.articleSubtype || '', color: p.col || r.color || '', size: p.size || r.size || '',
    sku: qcNorm(r.sku), ...(r.orderNo ? { orderNo: obUC(r.orderNo) } : {}),
    baseId: r.id, karigar: r.empName || '', from: 'waiting', ...(r.test ? { test: true } : {}),
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  const ok = qcPcs(entry.passed), al = qcPcs(entry.forAlteration), rj = qcPcs(entry.rejected), kept = ok + al + rj;
  const recs = [];
  if (kept > 0) recs.push(Object.assign({ id: id || qcNewCheckId() }, common, { checked: kept, ok, forAlteration: al, rejected: rj,
    remarks: String(entry.remarks || '').trim() || 'Accepted from Waiting for QC' }, rejWhySaved(rj, rejWhyOf(entry))));
  Object.keys(QC_DEPTS).filter(d => qcPcs(entry[d]) > 0).forEach(d => recs.push(Object.assign({ id: (id || qcNewCheckId()) + d[0] }, common, {
    checked: qcPcs(entry[d]), ok: 0, forAlteration: 0, rejected: 0, dept: d, [d]: qcPcs(entry[d]), remarks: qcSendRemark(d) })));
  return recs;
}

/**
 * Write one QC check out of Waiting for QC. '' or why not.
 * `entry` = { passed, forAlteration, rejected, spotting, touching, checkedBy, remarks, date } — any may be left out.
 */
async function qcInboxSave(baseId, entry) {
  const x = qcInboxRows().find(e => e.r.id === baseId);
  if (!x) return 'That entry is no longer waiting — press Refresh.';
  const why = qcInboxRefusal(x, entry); if (why) return why;
  const now = ptNow();
  const draft = qcDraftId('qc_', { baseId, entry }, qcNewCheckId);
  const recs = qcCheckRecords(x.r, entry, entry.date ? ptStampFrom(now, entry.date) : now, lineHoldOn() ? draft : '');
  const ids = recs.map(c => c.id);
  const held = await qcSaveHeld({ sku: qcNorm(x.r.sku), draft, ids, saved: () => QC.checks,
    recheck: () => { const y = qcInboxRows().find(e => e.r.id === baseId); return y ? qcInboxRefusal(y, entry) : 'that entry is no longer waiting — somebody else has just checked it.'; },
    write: () => ptPatch(Object.fromEntries(recs.map(c => ['pt_qcChecks/' + c.id, c]))) });
  if (held) return held;
  QC.checks = (QC.checks || []).filter(c => !(c && ids.includes(c.id))).concat(recs.map(c => Object.assign({ _key: c.id }, c)));
  return '';
}

/*
 * The QC Check window's boxes, one design for both uses (Ravi, 19 Nov, pointing at it: "image 2 is the screen which we
 * have decided is the design which should pop up when we click on the qc pass button"): filled in to be typed into while
 * pieces wait, or filled with where the pieces are now and locked when none do.
 */
function qcCheckFields(x, v, locked) {
  const num = (key, label) => ({ key, label, type: 'number', min: 0, step: 1, value: v[key], readonly: locked });
  return [
    { key: 'sku', label: 'SKU', value: x.r.sku, readonly: true },
    locked ? { key: 'checkedBy', label: 'Checked by', value: v.checkedBy, readonly: true }
      : { key: 'checkedBy', label: 'Checked by', type: 'select', value: v.checkedBy, options: [...new Set([v.checkedBy].concat(qcDeptEmps()).filter(Boolean))] },
    num('passed', 'Passed — pieces'), num('forAlteration', 'For alteration — pieces'),
    num('rejected', 'Rejected — pieces'), ...(locked ? [] : rejWhyFields(v)), num('spotting', 'Spotting — pieces (a stain)'),
    num('touching', 'Touching — pieces (a missed print)'),
    { key: 'remarks', label: 'Remarks', value: v.remarks, span: true, readonly: locked },
    ...(locked ? [] : [{ key: 'date', label: 'Check date', type: 'date', value: ptIsoDate(v.date || ptNow()), admin: true }]),
  ];
}
const qcCheckSubtitle = r => `SKU: ${r.sku || '—'}  ·  ${r.empName || '—'}  ·  ${r.orderNo || 'no order'}`;
const qcCheckItem = r => [r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · ');
/*
 * QC pass on a row with nothing left waiting (Ravi, 20 Nov: "they can only enter the new entries; the already filled ones can
 * only be accessed from the qc pass button of admin or Ravi"): the same window. An admin may correct the split and save; for
 * everybody else it shows where the pieces are now, locked.
 */
/** The QC Pass window's number boxes, empty, for the user to type into. */
const QC_EMPTY_SPLIT = { passed: '', forAlteration: '', rejected: '', spotting: '', touching: '' };
/** "8 passed, 2 for alteration" — a split in words, for the window's note. */
function qcRecordedText(v) {
  return [[v.passed, 'passed'], [v.forAlteration, 'for alteration'], [v.rejected, 'rejected'], [v.spotting, 'to spotting'], [v.touching, 'to touching']]
    .filter(([n]) => ptNum(n) > 0).map(([n, t]) => nf(ptNum(n)) + ' ' + t).join(', ') || 'nothing';
}
function qcInboxDoneWindow(x) {
  const fix = qcCorrectable(x), admin = !!ME.admin;
  ptOpenDialog({
    title: 'QC Pass', subtitle: qcCheckSubtitle(x.r), msg: qcCheckItem(x.r),
    note: `Nothing is left waiting on this entry — all ${nf(x.since)} piece(s) received have been through QC. `
      + (admin ? `QC recorded ${qcRecordedText(fix.values)}. As admin you can type the corrected numbers and Save; pieces you leave out go back to waiting.`
        + (fix.fixed ? ` ${nf(fix.fixed)} piece(s) already back from spotting or touching, or taken on the old Checks form, stay as they are.` : '')
        : 'This is what QC recorded. Only an admin can correct it.'),
    /* Ravi, 20 Nov, pointing at the window with its number boxes empty: "when I click on qc pass button it should look like
     * this" — the admin types the numbers; what QC recorded is in the note above them. */
    fields: qcCheckFields(x, admin ? Object.assign({}, fix.values, QC_EMPTY_SPLIT) : { checkedBy: x.by || x.receivedBy || '', passed: x.passed, forAlteration: x.alteration, rejected: x.rejected,
      spotting: x.spotting, touching: x.touching, remarks: x.remarks || '' }, !admin),
    ...(admin ? { onSave: async v => {
      const err = await qcInboxCorrect(x.r.id, v);
      if (err) return err;
      renderQc();
      $('qcMsg').className = 'muted';
      $('qcMsg').textContent = `Corrected the QC check on ${x.r.sku}. ` + $('qcMsg').textContent;
      return '';
    } } : {}),
  });
}
/*
 * What an admin may correct on a row: every check of it except sends already (partly) back from spotting or touching —
 * those have a return hanging on them. Returns the checks to replace, the pieces that stay fixed, and the window's values.
 */
function qcCorrectable(x) {
  const takes = (QC.checks || []).filter(c => c && c.baseId === x.r.id && !c.refId);
  const backFor = new Set((QC.checks || []).filter(c => c && c.refId).map(c => c.refId));
  const replace = takes.filter(c => !backFor.has(c.id)), sum = f => replace.reduce((a, c) => a + ptNum(f(c)), 0);
  const fixed = x.accepted - sum(c => c.checked);
  const first = replace.reduce((a, c) => (!a || ptDtMs(c.date) < ptDtMs(a.date) ? c : a), null);
  const main = replace.find(c => !c.dept) || first || {};
  /* One merged check holds one reason, so it takes one only when every rejection in it has one; some with and some without
   * ("mixed") cannot be merged without turning old rejections into scrap. */
  const rejects = replace.filter(c => ptNum(c.rejected) > 0), reasoned = rejects.filter(c => c.rejWhy);
  const mixed = reasoned.length > 0 && reasoned.length < rejects.length;
  const reason = rejWhyOf(mixed ? null : reasoned[0]);
  return { replace, fixed, mixed, room: x.since - fixed, date: first ? first.date : ptNow(), values: {
    date: first ? first.date : '', checkedBy: main.checkedBy || x.receivedBy || qcMyName(), passed: sum(c => (c.dept ? 0 : c.ok)), forAlteration: sum(c => c.forAlteration),
    rejected: sum(c => c.rejected), rejWhy: reason.why, rejNote: reason.note, spotting: sum(c => c.spotting), touching: sum(c => c.touching), remarks: main.remarks || '' } };
}
/*
 * EDIT ON QC PASSED (Ravi, 20 Nov: "the only button that can be changed in qc passed screen is the who entered the value,
 * not anything else"): the same window, everything locked but Checked by. Saving puts that name on every check of the row.
 */
function qcPassedEdit(baseId) {
  if (!(ptCanEdit() || ME.admin)) { $('qcMsg').className = 'err'; $('qcMsg').textContent = PT_NO_EDIT; return; }
  const x = qcInboxStatuses().find(e => e.r.id === baseId);
  if (!x) { $('qcMsg').className = 'err'; $('qcMsg').textContent = 'That entry is no longer on the list — press Refresh.'; return; }
  const by = x.by || x.receivedBy || '';
  const fields = qcCheckFields(x, { checkedBy: by, passed: x.passed, forAlteration: x.alteration, rejected: x.rejected,
    spotting: x.spotting, touching: x.touching, remarks: x.remarks || '' }, true)
    .map(f => (f.key === 'checkedBy' ? { key: 'checkedBy', label: 'Checked by', type: 'select', value: by, options: [...new Set([by].concat(qcDeptEmps()).filter(Boolean))] } : f));
  ptOpenDialog({
    title: 'QC Pass', subtitle: qcCheckSubtitle(x.r), msg: qcCheckItem(x.r),
    note: 'Only Checked by — who entered this QC check — can be changed here.',
    fields,
    onSave: async v => {
      const err = await qcSetCheckedBy(x.r.id, v.checkedBy);
      if (err) return err;
      renderQc();
      return '';
    },
  });
}
/** Put `name` as Checked by on every QC check of one row. '' or why not. */
async function qcSetCheckedBy(baseId, name) {
  const who = String(name || '').trim();
  if (!who) return 'Pick who checked these pieces.';
  const mine = (QC.checks || []).filter(c => c && c.baseId === baseId && !c.refId);
  if (!mine.length) return 'This entry has no QC check of its own to change.';
  const at = new Date().toISOString();
  await ptPatch(Object.assign({}, ...mine.map(c => ({ [`pt_qcChecks/${c.id}/checkedBy`]: who, [`pt_qcChecks/${c.id}/editedBy`]: ME.email, [`pt_qcChecks/${c.id}/editedAt`]: at }))));
  const ids = new Set(mine.map(c => c.id));
  QC.checks = (QC.checks || []).map(c => (c && ids.has(c.id) ? Object.assign({}, c, { checkedBy: who, editedBy: ME.email, editedAt: at }) : c));
  return '';
}
/** An admin's correction of a row's QC checks: the old ones go, the new split is written, in one update. '' or why not. */
async function qcInboxCorrect(baseId, entry) {
  if (!ME.admin) return 'Only an admin can correct a QC check that is already filled in.';
  const x = qcInboxStatuses().find(e => e.r.id === baseId);
  if (!x) return 'That entry is no longer on the list — press Refresh.';
  if (QC_SPLIT.some(k => qcPcs(entry[k]) < 0)) return 'Passed, alteration, rejected, spotting and touching cannot be negative.';
  const fix = qcCorrectable(x), total = qcCheckedOf(entry);
  if (lineHoldOn() && fix.mixed)
    return 'Some of this entry\'s rejected pieces were recorded before reasons were asked — it cannot be corrected as one check. Ask Ravi.';
  if (total > fix.room) return `Passed + alteration + rejected + spotting + touching is ${nf(total)} — only ${nf(fix.room)} piece(s) can be set here.`;
  /* Cutting alteration below what has already gone to the tailors would leave that issue standing on nothing. */
  const altAfter = qcAltTotal(x.r.sku) - fix.values.forAlteration + qcPcs(entry.forAlteration), issued = qcIssuedTotal(x.r.sku);
  if (altAfter < issued) return `${nf(issued)} piece(s) of ${x.r.sku} have already been issued for alteration — for-alteration cannot drop that far.`;
  /* The reason QC gave stays unless the admin picks another; with the switch off there are no reason boxes, so it is kept. */
  const split = Object.assign({ rejWhy: fix.values.rejWhy, rejNote: fix.values.rejNote }, entry), reason = rejWhyOf(split);
  const rejected = qcPcs(split.rejected);
  const whyErr = rejOldErr(fix.values, rejected, reason) || rejWhyErr(rejEditPcs(fix.values, rejected, reason), reason);
  if (whyErr) return whyErr;
  /* The correction keeps the day the pieces were first checked, unless the admin picked another in the date box. */
  const recs = qcCheckRecords(x.r, split, split.date ? ptStampFrom(fix.date, split.date) : fix.date).map(c => Object.assign(c, { editedBy: ME.email, editedAt: new Date().toISOString() }));
  const gone = new Set(fix.replace.map(c => c.id));
  await ptPatch(Object.assign(Object.fromEntries(fix.replace.map(c => ['pt_qcChecks/' + c.id, null])),
    Object.fromEntries(recs.map(c => ['pt_qcChecks/' + c.id, c]))));
  QC.checks = (QC.checks || []).filter(c => !gone.has(c && c.id)).concat(recs.map(c => Object.assign({ _key: c.id }, c)));
  return '';
}
/** QC pass: the QC Check window for one waiting row — all its waiting pieces filled in as passed, to be split. */
function qcInboxOpen(baseId) {
  const x = qcInboxStatuses().find(e => e.r.id === baseId);
  if (!x) { $('qcMsg').className = 'err'; $('qcMsg').textContent = 'That entry is no longer on the list — press Refresh.'; return; }
  if (!(x.wait > 0)) return qcInboxDoneWindow(x);
  if (!x.received) { $('qcMsg').className = 'err'; $('qcMsg').textContent = `Press QC Accept first on ${x.r.sku} — QC pass opens once QC has received the pieces.`; return; }
  if (x.passOpensAt > Date.now()) {
    $('qcMsg').className = 'err';
    $('qcMsg').textContent = `QC pass on ${x.r.sku} opens in ${qcTimeLeft(x.passOpensAt - Date.now())} — 30 seconds after QC Accept.`;
    return;
  }
  ptOpenDialog({
    title: 'QC Pass', subtitle: qcCheckSubtitle(x.r), msg: qcCheckItem(x.r),
    note: `${nf(x.wait)} piece(s) of this entry are waiting. Type how many passed, went for alteration, were rejected, or went to `
      + 'spotting or touching — what you leave out stays waiting. Nothing is saved until you press Save.',
    fields: qcCheckFields(x, Object.assign({ checkedBy: qcMyName(), remarks: 'Accepted from Waiting for QC' }, QC_EMPTY_SPLIT), false),
    onSave: async v => {
      const err = await qcInboxSave(baseId, v);
      if (err) return err;
      renderQc();
      $('qcMsg').className = 'muted';
      $('qcMsg').textContent = 'Saved the QC check. ' + $('qcMsg').textContent;
      return '';
    },
  });
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
/** `reject` (2026-10-06, Ravi: "spotting touching se reject bhi ho sakta h") — the pieces come back rejected, not passed.
 *  Rejected pieces need a reason (Ravi, 27 Nov): they are scrapped. */
async function qcDeptBack(sendId, qty, reject, reason = rejWhyOf(null)) {
  const x = qcDeptRows().find(e => e.c.id === sendId);
  if (!x) return 'That entry is not there any more — press Refresh.';
  const q = parseInt(qty, 10);
  if (!(q > 0)) return reject ? 'Type how many pieces are rejected.' : 'Type how many pieces came back.';
  if (q > x.left) return `Only ${nf(x.left)} piece(s) of this are still in ${x.dept}.`;
  const c = x.c, rejected = reject ? q : 0;
  const whyErr = rejWhyErr(rejected, reason) || (rejWhyNeeded(rejected) && !c.orderNo ? qcScrapNotReady() : '');
  if (whyErr) return whyErr;
  const orderNo = c.orderNo || (rejWhyNeeded(rejected) ? qcScrapOrderOf(c.sku) : '');
  const fields = {
    date: ptNow(), checkedBy: String(ME.email || '').split('@')[0], brand: c.brand || '',
    articleType: c.articleType || '', subtype: c.subtype || '', color: c.color || '', size: c.size || '',
    sku: c.sku, checked: 0, ok: reject ? 0 : q, forAlteration: 0, rejected, ...rejWhySaved(rejected, reason),
    ...(orderNo ? { orderNo } : {}),
    refId: c.id, dept: x.dept, from: x.dept, baseId: c.baseId || '', karigar: c.karigar || '', ...(c.test ? { test: true } : {}),
    remarks: reject ? 'Rejected after ' + x.dept : 'Back from ' + x.dept + ' — passed by QC', addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  const rec = Object.assign({ id: qcDraftId('qc_', fields, qcNewCheckId) }, fields);
  const held = await qcSaveHeld({ sku: qcNorm(c.sku), draft: rec.id, ids: [rec.id], saved: () => QC.checks,
    recheck: () => { const y = qcDeptRows().find(e => e.c.id === sendId); return y && q <= y.left ? '' : `only ${nf(y ? y.left : 0)} piece(s) of this are still in ${x.dept} — somebody else has just recorded some.`; },
    write: () => ptPut('pt_qcChecks/' + rec.id, rec) });
  if (held) return held;
  QC.checks = (QC.checks || []).filter(r => !(r && r.id === rec.id)).concat(Object.assign({ _key: rec.id }, rec));
  return '';
}
/** Reject on Spotting & touching with the switch on: why is asked first (Ravi, 27 Nov). */
function qcDeptRejectOpen(sendId, qty) {
  const x = qcDeptRows().find(e => e.c.id === sendId);
  ptOpenDialog({
    title: 'Reject — spotting & touching', subtitle: x ? `SKU: ${x.c.sku} · ${x.c.orderNo || 'no order'}` : '',
    note: `${nf(ptNum(qty))} piece(s) will be rejected and scrapped.`,
    fields: rejWhyFields(), saveLabel: 'Reject',
    onSave: async v => {
      const err = await qcDeptBack(sendId, qty, true, rejWhyOf(v));
      if (err) return err;
      renderQc();
      $('qcMsg').className = 'muted';
      $('qcMsg').textContent = 'Rejected. ' + $('qcMsg').textContent;
      return '';
    },
  });
}
function renderQcDept() {
  const q = $('qcQ').value.trim().toLowerCase();
  const all = qcDeptRows();
  const rng = qcRangeMs();
  const open = all.filter(x => x.left > 0 && qcInRangeMs(x.ms, rng) && (!q || [x.c.sku, x.c.subtype, x.c.color, x.c.size, x.c.karigar, x.c.orderNo, x.dept].join(' ').toLowerCase().includes(q)))
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
    + `<td class="frz" style="text-align:left"><button class="ghost qc-act" data-qcl-day="${esc(e.day)}" title="See this day SKU by SKU: opening, what moved, closing">${esc(e.day.split('-').reverse().join('/'))}</button></td>`
    + cols.slice(1).map(([, k]) => `<td class="num"${k === 'allPass' ? ' style="font-weight:700;color:#166534"' : ''}>${z(e[k])}</td>`).join('') + '</tr>').join('')
    || `<tr><td colspan="${cols.length}" class="muted" style="padding:14px">Nothing in these days.</td></tr>`) + '</tbody>'
    + (rows.length ? '<tfoot><tr><td class="frz">TOTAL</td>' + cols.slice(1).map(([, k]) => `<td class="num">${nf(t[k] || 0)}</td>`).join('') + '</tr></tfoot>' : '');
  $('qcMsg').className = 'muted';
  $('qcMsg').textContent = `${nf(rows.length)} day(s), newest first · click a day to see it SKU by SKU · "All passed" = QC pass + back from spotting and touching · use the dates above for another window`;
}

/*
 * ONE LEDGER DAY, SKU BY SKU (Ravi, 20 Nov: "when I click on its date it should give me a pop up card grouped by skus";
 * "opening should show what is the QC passed previously before today's entry and closing should show the total pieces
 * passed at the end of the day"). One line per SKU that moved that day: back from karigars, and what QC did — every QC
 * check of the SKU that day, the old Checks form's too — then passed before the day and passed by the end of it.
 */
function qcLedgerDay(day) {
  const start = new Date(day + 'T00:00:00').getTime(), end = start + 86400000, from = qcInboxFromMs(), bySku = new Map();
  const line = sku => { if (!bySku.has(sku)) bySku.set(sku, { sku, recv: 0, pass: 0, alt: 0, rej: 0, spot: 0, touch: 0, before: 0 }); return bySku.get(sku); };
  const inDay = ms => ms >= start && ms < end;
  qcInboxEntries().forEach(x => {
    const parts = x.r.fromCut ? [{ ms: x.last, pcs: x.since }] : repRecvParts(x.r).filter(p => /^LEG-/i.test(String(x.r.orderNo || '')) || p.ms >= from);
    const recv = parts.filter(p => inDay(p.ms)).reduce((a, p) => a + p.pcs, 0);
    if (recv) line(qcNorm(x.r.sku)).recv += recv;
  });
  (QC.checks || []).forEach(c => {
    const ms = c && ptDtMs(c.date); if (!ms || !inDay(ms)) return;
    const e = line(qcNorm(c.sku));
    e.pass += ptNum(c.ok); e.rej += ptNum(c.rejected);
    if (!c.refId) { e.alt += ptNum(c.forAlteration); e.spot += ptNum(c.spotting); e.touch += ptNum(c.touching); }
  });
  /* Passed before the day, for the SKUs that moved — the card's Opening; Closing adds the day's passes. */
  (QC.checks || []).forEach(c => { const ms = c && ptDtMs(c.date), e = ms && ms < start && bySku.get(qcNorm(c.sku)); if (e) e.before += ptNum(c.ok); });
  return [...bySku.values()].map(e => Object.assign(e, { after: e.before + e.pass })).sort((a, b) => a.sku.localeCompare(b.sku));
}
/* Opening and Closing sit side by side at the end (Ravi, 20 Nov: "put opening and closing columns back on the card instead
 * of buttons … held adjacent at the last of all columns"). */
const QC_LEDGER_DAY_COLS = [['SKU', 'sku'], ['Received', 'recv'], ['Passed', 'pass'], ['Alteration', 'alt'], ['Rejected', 'rej'], ['Spotting', 'spot'], ['Touching', 'touch'],
  ['Opening', 'before'], ['Closing', 'after']];
function qcLedgerDayCard(day) {
  const lines = qcLedgerDay(day), dmy = day.split('-').reverse().join('/'), sum = k => lines.reduce((a, e) => a + e[k], 0);
  const z = v => (v ? nf(v) : '<span class="muted">—</span>');
  const strong = { pass: ' style="color:#166534;font-weight:700"', before: ' style="font-weight:700"', after: ' style="font-weight:700"' };
  const row = e => `<tr><td style="font-family:ui-monospace,monospace;text-align:left">${esc(e.sku)}</td>`
    + QC_LEDGER_DAY_COLS.slice(1).map(([, k]) => `<td class="num"${strong[k] || ''}>${z(e[k])}</td>`).join('') + '</tr>';
  ptOpenDialog({
    title: 'QC ledger — ' + dmy, wide: true,
    note: `SKU by SKU: Received = back from karigars that day · Passed, Alteration, Rejected, Spotting, Touching = what QC did that day · `
      + `Opening = pieces of the SKU passed before ${dmy} · Closing = passed by the end of ${dmy}.`,
    html: `<div class="xlwrap" style="max-height:60vh;overflow:auto"><table class="xl"><thead><tr>${QC_LEDGER_DAY_COLS.map(([h], i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>`
      + `<tbody>${lines.map(row).join('') || `<tr><td colspan="${QC_LEDGER_DAY_COLS.length}" class="muted" style="padding:14px">Nothing moved this day.</td></tr>`}</tbody>`
      + (lines.length ? `<tfoot><tr><td>TOTAL · ${nf(lines.length)} SKU(s)</td>${QC_LEDGER_DAY_COLS.slice(1).map(([, k]) => `<td class="num">${nf(sum(k))}</td>`).join('')}</tr></tfoot>` : '')
      + '</table></div>',
  });
}

$('qcTable').addEventListener('click', async e => {
  const check = e.target.closest('[data-qcin-check]');
  if (check) return qcInboxOpen(check.getAttribute('data-qcin-check'));
  const passedEdit = e.target.closest('[data-qcp-edit]');
  if (passedEdit) return qcPassedEdit(passedEdit.getAttribute('data-qcp-edit'));
  const ledgerDay = e.target.closest('[data-qcl-day]');
  if (ledgerDay) return qcLedgerDayCard(ledgerDay.getAttribute('data-qcl-day'));
  const go = e.target.closest('[data-qcin-accept]');
  if (go) {
    const id = go.getAttribute('data-qcin-accept');
    go.disabled = true;
    let err = '';
    try { err = await qcInboxReceive(id); } catch (er) { err = 'Not saved: ' + (er.message || er); }
    go.disabled = false;
    renderQc();
    $('qcMsg').className = err ? 'err' : 'muted';
    $('qcMsg').textContent = err || 'Received by QC — now QC pass to check them. ' + $('qcMsg').textContent;
    return;
  }
  const back = e.target.closest('[data-qcd-go]');
  if (back) {
    const id = back.getAttribute('data-qcd-go');
    const box = document.querySelector(`[data-qcd-qty="${CSS.escape(id)}"]`);
    const rej = back.getAttribute('data-rej') === '1';
    if (rej && lineHoldOn()) return qcDeptRejectOpen(id, box ? box.value : '');
    back.disabled = true;
    let err = '';
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
/** Refresh: the QC lists, and Job Work again, because "Waiting for QC" is built from it. Before 18 Nov 2026 pieces
 *  received on another PC reached that list only after F5. Job Work comes from its live copy (nothing downloaded);
 *  if it cannot be read, the QC lists still refresh. */
async function qcRefresh() {
  QC.checks = null;
  try { await ptReadReg('base'); } catch (e) { console.warn('[quality-control] Job Work not read again:', e); }
  await ensureQc(); renderQcCheckForm(); renderQcIssueForm();
}
$('qcGo').onclick = () => ptRefreshButton($('qcGo'), qcRefresh);
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
  if (v === 'inbox' || v === 'passed') {
    const I = QC.inbox || []; if (!I.length) return;
    return ptDownload(v === 'passed' ? 'qc-passed' : 'waiting-for-qc', [QC_INBOX_COLS.filter(h => h && h !== 'Image').map(csvCell).join(',')]
      .concat(I.map(x2 => [new Date(x2.last).toLocaleString('en-GB'), x2.r.empName, x2.r.sku, [x2.r.articleSubtype, x2.r.color, x2.r.size].filter(Boolean).join(' · '), x2.r.orderNo,
        x2.since, x2.passed, x2.alteration, x2.spotting, x2.touching, x2.rejected, x2.wait].map(csvCell).join(','))));
  }
  const rows = QC.rows || []; if (!rows.length) return;
  /* Pieces back from alteration have their own columns: what came back, what was mended, what is still wrong. */
  if (v === 'ret') {
    return ptDownload('qc-back-from-alteration', [['Date', 'SKU', 'Article', 'Subtype', 'Color', 'Size', 'Back', 'Mended', 'Still wrong', 'From', 'Received by', 'Remarks'].map(csvCell).join(',')]
      .concat(rows.map(r => [r.date, r.sku, r.articleType, r.subtype, r.color, r.size, ptNum(r.received), ptNum(r.reworkedOk), ptNum(r.stillRejected), r.employee, r.receivedBy, r.remarks].map(csvCell).join(','))));
  }
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

