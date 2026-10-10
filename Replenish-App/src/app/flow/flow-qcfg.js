/* ================= PRODUCTION FLOW · QC, AND THE HAND-OVER TO FINISHED GOODS =================
 * Ravi, 10 Oct: "Q.C ke sare action yahin se ho and history bhi yahin check kar pau, and yahin se move ho India store me —
 * Finish Goods team ke pas sirf goods accept karne ka option ho ya reject karne ka".
 *
 *   QC bucket      the pieces back from the karigar and not yet checked, and pieces out for alteration. Here: the QC check
 *                  (checked = passed + alteration + rejected, who checked — written to pt_qcChecks exactly as Quality
 *                  Control writes it), "Alteration back" (those pieces back as passed / rejected — a pt_qcChecks row with
 *                  checked 0, the way spotting and touching come back, so they count as passed for the order: Quality
 *                  Control's own alteration return never did), and the line's whole QC history.
 *   Ready          what passed and is not yet with Finished Goods: "Send to Finished Goods" (pt_flowFgSend).
 *   FG · accept    the Finished Goods team sees only what was sent, and only Accept or Reject. Accept writes the RECEIVE row
 *                  into pt_fgiLedger — the India store — the way the Stock entry does (Received from: QC). Reject takes the
 *                  pass back (a pt_qcChecks row with checked and ok negative, saying why) and the pieces are in QC again.
 * A test order's QC rows go to Quality Control as TEST rows (removed with the test); its Finished Goods stay on the test
 * order — a test must never put stock into India stock, which Replenishment reads. */

/* ---- what the QC register says about one line ---- */
function flowQcLine(r) {
  const out = { checked: 0, ok: 0, alt: 0, altBack: 0, rej: 0, rows: [] };
  (typeof QC !== 'undefined' && QC.checks || []).forEach(c => {
    if (!c || obUC(c.orderNo) !== obUC(r.orderNo) || obUC(c.sku) !== obUC(r.sku)) return;
    out.rows.push(c); out.checked += +c.checked || 0; out.ok += +c.ok || 0; out.rej += +c.rejected || 0;
    out.alt += +c.forAlteration || 0; out.altBack += +c.altBack || 0;
  });
  out.altOpen = Math.max(0, out.alt - out.altBack);
  return out;
}
/** Pieces back from the karigar and not yet checked, for a line. */
const flowQcWaiting = (r, s) => Math.max(0, (s.received || 0) - (r.__t ? (+r.__t.qcChecked || 0) : flowQcLine(r).checked));
const flowQcAltOpen = r => (r.__t ? Math.max(0, (+r.__t.qcAlt || 0) - (+r.__t.qcAltBack || 0)) : flowQcLine(r).altOpen);
const flowMayQc = () => !!(ME.admin || ['qc', 'flqc'].some(t => (ME.tabs || []).includes(t)));
const flowMayFg = () => !!(ME.admin || ['fgi', 'flfg'].some(t => (ME.tabs || []).includes(t)));

/** Write a QC row (and, on a test line, its test figures) — one place for check, alteration back and FG reject. */
async function flowQcWrite(x, rec, testSet, said) {
  const p0 = (() => { try { return qcParts(x.r.sku) || {}; } catch (e) { return {}; } })();
  const row = Object.assign({ id: 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: ptNow(), brand: p0.brand || '',
    articleType: p0.at || '', subtype: p0.sub || '', color: p0.col || '', size: p0.size || '', sku: obUC(x.r.sku), checked: 0, forAlteration: 0,
    rejected: 0, ok: 0, orderNo: x.r.orderNo, addedBy: ME.email || '', addedAt: new Date().toISOString() }, rec, x.r.__t ? { test: true, remarks: ('[TEST] ' + (rec.remarks || '')).trim() } : {});
  const patch = { ['pt_qcChecks/' + row.id]: row };
  if (x.r.__t && testSet) Object.entries(testSet).forEach(([k, v]) => { patch[`pt_flowTest/${x.r.orderNo}/lines/${obUC(x.r.sku)}/${k}`] = v; });
  if (x.r.__t) patch[`pt_flowTest/${x.r.orderNo}/lines/${obUC(x.r.sku)}/qcLog/${row.id}`] = { checked: row.checked, ok: row.ok, alt: row.forAlteration, rej: row.rejected, by: row.checkedBy || '', at: row.addedAt, reg: row.id };
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  if (typeof QC !== 'undefined') QC.checks = (QC.checks || []).concat([Object.assign({ _key: row.id }, row)]);
  if (x.r.__t && testSet) {
    const o = FLOW.test[x.r.orderNo], sku = obUC(x.r.sku), t = Object.assign({}, o.lines[sku], testSet);
    FLOW.test = Object.assign({}, FLOW.test, { [x.r.orderNo]: Object.assign({}, o, { lines: Object.assign({}, o.lines, { [sku]: t }) }) });
  }
  renderFlow(); flowSay(said);
  return '';
}

/** QC check: checked = passed + alteration + rejected, who checked — against what came back and is not checked yet. */
async function flowQcCheckOpen(x) {
  if (!flowMayQc()) return flowSay('QC is not open to this account.', true);
  try { if (typeof ptLoadEmp === 'function') await ptLoadEmp(); } catch (e) { /* typed then */ }
  const can = flowQcWaiting(x.r, x.s);
  if (!can) return flowSay('Nothing back from the karigar is waiting for QC on this line.', true);
  let names = []; try { names = (PTE.emp || []).map(e => e[1]); } catch (e) { names = []; }
  ptOpenDialog({
    title: `QC check — ${x.r.orderNo} · ${obUC(x.r.sku)}${x.r.__t ? ' (TEST)' : ''}`,
    subtitle: `${nf(can)} back from the karigar and not yet checked. Saved in Quality Control${x.r.__t ? ' as a TEST entry' : ''}.`,
    html: `<div class="ptgrid" style="grid-template-columns:repeat(4,1fr)">
      <label>Checked<input id="flqC" type="number" min="1" value="${can}"></label><label>Passed<input id="flqO" type="number" min="0" value="${can}"></label>
      <label>Alteration<input id="flqA" type="number" min="0" value="0"></label><label>Rejected<input id="flqR" type="number" min="0" value="0"></label>
      <label style="grid-column:1/3">Checked by<input id="flqB" list="flqBL" value="${esc(String(ME.email || '').split('@')[0])}"><datalist id="flqBL">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
      <label style="grid-column:3/5">Remarks<input id="flqM"></label></div>`,
    saveLabel: 'Save the check',
    onSave: async () => {
      const c = Math.round(+$('flqC').value || 0), ok = Math.round(+$('flqO').value || 0), alt = Math.round(+$('flqA').value || 0), rej = Math.round(+$('flqR').value || 0), by = $('flqB').value.trim();
      if (!(c > 0)) return 'How many were checked?';
      if (c > can) return `Only ${nf(can)} are waiting for QC.`;
      if (ok < 0 || alt < 0 || rej < 0) return 'Nothing below zero.';
      if (ok + alt + rej !== c) return `Passed + alteration + rejected must make the ${nf(c)} checked.`;
      if (!by) return 'Who checked them?';
      const t = x.r.__t || {};
      return flowQcWrite(x, { checked: c, ok, forAlteration: alt, rejected: rej, checkedBy: by, remarks: $('flqM').value.trim() },
        { qc: (+t.qc || 0) + ok, qcChecked: (+t.qcChecked || 0) + c, qcAlt: (+t.qcAlt || 0) + alt },
        `${nf(c)} checked: ${nf(ok)} passed${alt ? `, ${nf(alt)} to alteration` : ''}${rej ? `, ${nf(rej)} rejected` : ''} — in Quality Control.`);
    },
  });
}
/** Alteration back: pieces sent to alteration come back passed or rejected — counted for the order this time. */
function flowAltBackOpen(x) {
  if (!flowMayQc()) return flowSay('QC is not open to this account.', true);
  const open = flowQcAltOpen(x.r);
  if (!open) return flowSay('Nothing of this line is out for alteration.', true);
  ptOpenDialog({
    title: `Alteration back — ${x.r.orderNo} · ${obUC(x.r.sku)}${x.r.__t ? ' (TEST)' : ''}`, subtitle: `${nf(open)} out for alteration.`,
    html: `<div class="ptgrid" style="grid-template-columns:repeat(3,1fr)">
      <label>Back — passed<input id="flaO" type="number" min="0" value="${open}"></label><label>Back — rejected<input id="flaR" type="number" min="0" value="0"></label>
      <label>Checked by<input id="flaB" value="${esc(String(ME.email || '').split('@')[0])}"></label></div>`,
    saveLabel: 'Save',
    onSave: async () => {
      const ok = Math.round(+$('flaO').value || 0), rej = Math.round(+$('flaR').value || 0), by = $('flaB').value.trim();
      if (!(ok + rej > 0)) return 'How many came back?';
      if (ok + rej > open) return `Only ${nf(open)} are out for alteration.`;
      if (!by) return 'Who checked them?';
      const t = x.r.__t || {};
      return flowQcWrite(x, { checked: 0, ok, rejected: rej, altBack: ok + rej, checkedBy: by, remarks: 'Back from alteration' },
        { qc: (+t.qc || 0) + ok, qcAltBack: (+t.qcAltBack || 0) + ok + rej }, `${nf(ok)} back from alteration and passed${rej ? `, ${nf(rej)} rejected` : ''}.`);
    },
  });
}
/** The line's QC history, newest first. */
function flowQcHistory(r) {
  const rows = flowQcLine(r).rows.slice().sort((a, b) => String(b.addedAt || b.date || '').localeCompare(String(a.addedAt || a.date || '')));
  if (!rows.length) return '';
  return `<details style="margin-top:3px"><summary class="muted" style="font-size:10.5px;cursor:pointer">QC history (${rows.length})</summary><div style="font-size:10.5px;line-height:1.5">`
    + rows.map(c => `${esc(String(c.addedAt || c.date || '').slice(0, 10))} · ${esc(c.checkedBy || String(c.addedBy || '').split('@')[0])}: `
      + (+c.fgReject ? `<b style="color:#b91c1c">${nf(c.fgReject)} rejected by Finished Goods</b> — ${esc(c.remarks || '')}`
        : +c.altBack ? `${nf(c.altBack)} back from alteration — ${nf(c.ok)} passed${+c.rejected ? `, ${nf(c.rejected)} rejected` : ''}`
        : +c.dept ? `${esc(c.dept)}` : `${nf(c.checked)} checked — ${nf(c.ok)} passed${+c.forAlteration ? `, ${nf(c.forAlteration)} alteration` : ''}${+c.rejected ? `, ${nf(c.rejected)} rejected` : ''}`)
      + (c.test ? ' <span style="color:#7c3aed">TEST</span>' : '')).join('<br>') + '</div></details>';
}

/* ---- the hand-over to Finished Goods ----
 *   pt_flowFgSend/<id> = { orderNo, sku, pcs, at, by, status: 'sent' | 'accepted' | 'rejected', fgId?, why?, doneAt?, doneBy? } */
const flowFgOf = r => Object.values(FLOW.fg || {}).filter(h => h && obUC(h.orderNo) === obUC(r.orderNo) && obUC(h.sku) === obUC(r.sku));
const flowFgSent = r => flowFgOf(r).filter(h => h.status !== 'rejected').reduce((a, h) => a + (+h.pcs || 0), 0);
const flowFgWaiting = r => flowFgOf(r).filter(h => h.status === 'sent');
/** QC passed and not yet sent to Finished Goods. */
const flowFgToSend = (r, s) => Math.max(0, (s.made || 0) - flowFgSent(r));

function flowFgSendOpen(x) {
  if (!flowMayQc()) return flowSay('Sending to Finished Goods is QC\'s — this account has no QC right.', true);
  const can = flowFgToSend(x.r, x.s);
  if (!can) return flowSay('Nothing passed QC that is not already with Finished Goods.', true);
  ptOpenDialog({
    title: `Send to Finished Goods — ${x.r.orderNo} · ${obUC(x.r.sku)}${x.r.__t ? ' (TEST)' : ''}`,
    subtitle: `${nf(can)} passed QC. The Finished Goods team accepts or rejects them; accepted they are in India stock.`,
    html: `<label>Pieces<input id="flfP" type="number" min="1" value="${can}"></label><label>Note<input id="flfN"></label>`,
    saveLabel: 'Send',
    onSave: async () => {
      const n = Math.round(+$('flfP').value || 0); if (!(n > 0)) return 'How many?'; if (n > can) return `Only ${nf(can)} passed and not sent.`;
      const id = 'fgs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const rec = { orderNo: x.r.orderNo, sku: obUC(x.r.sku), pcs: n, note: $('flfN').value.trim(), at: new Date().toISOString(), by: ME.email || '', status: 'sent', ...(x.r.__t ? { test: true } : {}) };
      try { await ptPatch({ ['pt_flowFgSend/' + id]: rec }); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.fg = Object.assign({}, FLOW.fg, { [id]: rec }); renderFlow(); flowSay(`${nf(n)} sent to Finished Goods — waiting for them to accept.`);
      return '';
    },
  });
}
/** Finished Goods: Accept — the RECEIVE row in the India store (a test order's stays on the test order). */
async function flowFgAccept(id) {
  if (!flowMayFg()) return flowSay('Accepting is the Finished Goods team\'s — this account has no Finished Goods right.', true);
  const h = (FLOW.fg || {})[id]; if (!h || h.status !== 'sent') return flowSay('That hand-over is not waiting any more — press Refresh.', true);
  const now = new Date().toISOString(), patch = {}, d = new Date(), p2 = n => String(n).padStart(2, '0');
  let fgRow = null;
  if (!h.test) {
    if (typeof FGI !== 'undefined' && FGI.rows == null && typeof fgiLoad === 'function') { try { await fgiLoad(); } catch (e) { /* refused below */ } }
    let chk = {}; try { chk = fgiRecvOrderCheck({ sku: h.sku, qty: h.pcs, orderNo: h.orderNo, pick: 'console' }) || {}; } catch (e) { chk = {}; }
    if (chk.err && !chk.needOver) return flowSay('Not accepted: ' + chk.err, true);
    const over = chk.needOver ? { overQty: chk.overQty, overReason: 'sent from QC (Production flow)', overOrdered: chk.overOrdered, overStatus: 'open' } : {};
    fgRow = { _id: fgiNewId('RCP'), txnType: 'RECEIVE', sku: h.sku, qty: h.pcs, date: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`, reason: '',
      orderNo: h.orderNo, orderSource: 'console', ...over, receivedFrom: 'QC (Production flow)', remarks: `Accepted from QC hand-over ${id}`, createdAt: now, createdBy: ME.email || '' };
    patch['pt_fgiLedger/' + fgRow._id] = fgRow;
  } else {
    const o = FLOW.test[h.orderNo], t = o && o.lines[h.sku];
    if (t) patch[`pt_flowTest/${h.orderNo}/lines/${h.sku}/fgIn`] = (+t.fgIn || 0) + h.pcs;
  }
  const nh = Object.assign({}, h, { status: 'accepted', doneAt: now, doneBy: ME.email || '', ...(fgRow ? { fgId: fgRow._id } : {}) });
  patch['pt_flowFgSend/' + id] = nh;
  try { await ptPatch(patch); } catch (e) { return flowSay('Could not save: ' + (e.message || e), true); }
  if (fgRow && typeof FGI !== 'undefined') FGI.rows = (FGI.rows || []).concat([fgRow]);
  if (h.test) { const o = FLOW.test[h.orderNo]; const t = Object.assign({}, o.lines[h.sku], { fgIn: patch[`pt_flowTest/${h.orderNo}/lines/${h.sku}/fgIn`] });
    FLOW.test = Object.assign({}, FLOW.test, { [h.orderNo]: Object.assign({}, o, { lines: Object.assign({}, o.lines, { [h.sku]: t }) }) }); }
  FLOW.fg = Object.assign({}, FLOW.fg, { [id]: nh });
  renderFlow(); flowSay(`${nf(h.pcs)} of ${h.sku} accepted into ${h.test ? 'Finished Goods (TEST — not in India stock)' : 'Finished Goods — India stock'}.`);
}
/** Finished Goods: Reject — with why; the QC pass is taken back and the pieces are in QC again. */
function flowFgRejectOpen(id) {
  if (!flowMayFg()) return flowSay('Rejecting is the Finished Goods team\'s — this account has no Finished Goods right.', true);
  const h = (FLOW.fg || {})[id]; if (!h || h.status !== 'sent') return flowSay('That hand-over is not waiting any more — press Refresh.', true);
  ptOpenDialog({
    title: `Reject — ${h.orderNo} · ${h.sku} · ${nf(h.pcs)} pcs`, subtitle: 'They go back to QC to be checked again.',
    html: '<label>Why (stain, wrong size, stitching, packing…)<input id="flfrW"></label>', saveLabel: 'Reject',
    onSave: async () => {
      const why = $('flfrW').value.trim(); if (!why) return 'Say why they are rejected.';
      const x = flowRows().find(y => obUC(y.r.orderNo) === obUC(h.orderNo) && obUC(y.r.sku) === h.sku) || { r: { orderNo: h.orderNo, sku: h.sku } };
      const nh = Object.assign({}, h, { status: 'rejected', why, doneAt: new Date().toISOString(), doneBy: ME.email || '' });
      try { await ptPatch({ ['pt_flowFgSend/' + id]: nh }); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.fg = Object.assign({}, FLOW.fg, { [id]: nh });
      const t = (x.r.__t || {});
      return flowQcWrite(x, { checked: -h.pcs, ok: -h.pcs, fgReject: h.pcs, checkedBy: 'Finished Goods', remarks: 'Rejected by Finished Goods: ' + why },
        { qc: (+t.qc || 0) - h.pcs, qcChecked: (+t.qcChecked || 0) - h.pcs }, `${nf(h.pcs)} rejected by Finished Goods (${why}) — back in QC.`);
    },
  });
}
