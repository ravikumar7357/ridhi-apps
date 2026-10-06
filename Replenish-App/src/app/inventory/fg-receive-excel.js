/* ================= RECEIVE FROM EXCEL =================
 *
 * The Stock entry form, one row at a time. Every row is checked exactly as the form checks it — the SKU
 * is in the master, the pieces are a whole number, somebody is named, and the order goes through
 * fgiRecvOrderCheck, the form's own check. Rows of the same order are added up as they go, so the
 * fifth row of an order sees the four before it.
 *
 * ALL OR NOTHING. A file with one bad row writes nothing: writing the good ones and asking for the rest
 * again invites the whole file back, and then the good ones are in twice.
 */
const FGI_XL_COLS = [
  ['date', 'Date', ['date', 'receive date', 'received on']],
  ['sku', 'SKU', ['sku']],
  ['pick', 'Order from', ['order from', 'order source', 'from order']],
  ['orderNo', 'Order No', ['order no', 'order no.', 'order number', 'order', 'order #']],
  ['qty', 'Pieces', ['pieces', 'pcs', 'qty', 'quantity']],
  ['who', 'Received from', ['received from', 'receive from', 'from']],
  ['reason', 'Reason', ['reason']],
  ['remarks', 'Note', ['note', 'remarks', 'remark']],
  ['extFrom', 'External customer / platform', ['external customer / platform', 'customer / platform', 'customer', 'platform', 'external from']],
  ['extQty', 'External order qty', ['external order qty', 'external qty', 'order qty']],
  ['over', 'Why more than the order', ['why more than the order', 'why more', 'over reason', 'extra reason']],
];

/** The issue sheet: no order, and "Issued to" in place of "Received from" — as the form has it. */
const FGI_XL_ISS_COLS = [
  ['date', 'Date', ['date', 'issue date', 'issued on']],
  ['sku', 'SKU', ['sku']],
  ['qty', 'Pieces', ['pieces', 'pcs', 'qty', 'quantity']],
  ['who', 'Issued to', ['issued to', 'issue to', 'to', 'issued for']],
  ['order', 'Order No', ['order no', 'order no.', 'order number', 'order', 'for order']],
  ['noOrderWhy', 'No order — why', ['no order — why', 'no order - why', 'no order why', 'why no order', 'not for an order']],
  ['inv', 'Invoice no', ['invoice no', 'invoice no.', 'invoice', 'invoice number', 'bill no']],
  ['trans', 'Transporter', ['transporter', 'courier', 'transporter / courier']],
  ['lr', 'LR / AWB no', ['lr / awb no', 'lr no', 'lr', 'awb', 'awb no', 'tracking no', 'tracking', 'docket']],
  ['reason', 'Reason', ['reason']],
  ['remarks', 'Note', ['note', 'remarks', 'remark']],
];
/** Which sheet: its columns, its needed columns, and the words it uses. */
const FGI_XL_KIND = {
  RECEIVE: { cols: () => FGI_XL_COLS, need: ['sku', 'orderNo', 'qty', 'who'], title: 'Receive from Excel', file: 'receive', verb: 'receipt',
    list: () => ({ name: 'OrderFrom', values: ['Order Console', 'External'], cols: [FGI_XL_COLS.findIndex(c => c[0] === 'pick')] }) },
  ISSUE: { cols: () => FGI_XL_ISS_COLS, need: ['sku', 'qty', 'who'], title: 'Issue from Excel', file: 'issue', verb: 'issue', list: () => null },
};

function fgiRecvXlTemplate() { return fgiXlTemplate('RECEIVE'); }
function fgiXlTemplate(kind) {
  const K = FGI_XL_KIND[kind] || FGI_XL_KIND.RECEIVE;
  const head = K.cols().map(c => c[1]);
  const opts = { name: kind === 'ISSUE' ? 'Issue' : 'Receive', freeze: 2, cols: {} };
  if (K.list()) opts.list = K.list();
  const bytes = recipeXlsx([head], opts);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `${K.file}-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
}

/** The sheet's rows, read into the form's own fields. Null header → { err }. */
function fgiRecvXlRead(rows) { return fgiXlRead(rows, 'RECEIVE'); }
function fgiXlRead(rows, kind) {
  const K = FGI_XL_KIND[kind] || FGI_XL_KIND.RECEIVE, COLS = K.cols();
  let h = -1;
  for (let i = 0; i < Math.min(15, (rows || []).length); i++) {
    const low = (rows[i] || []).map(x => String(x == null ? '' : x).trim().toLowerCase());
    if (low.indexOf('sku') >= 0 && (low.indexOf('pieces') >= 0 || low.indexOf('qty') >= 0 || low.indexOf('pcs') >= 0 || low.indexOf('quantity') >= 0)) { h = i; break; }
  }
  if (h < 0) return { err: 'No header row with SKU and Pieces — download the template and fill that.' };
  const low = rows[h].map(x => String(x == null ? '' : x).trim().toLowerCase());
  const ix = {};
  COLS.forEach(([k, , names]) => { ix[k] = -1; for (const n of names) { const i = low.indexOf(n); if (i >= 0) { ix[k] = i; break; } } });
  const missing = K.need.filter(k => ix[k] < 0).map(k => COLS.find(c => c[0] === k)[1]);
  if (missing.length) return { err: 'The sheet has no ' + missing.join(', ') + ' column — download the template and fill that.' };
  const cell = (r, k) => (ix[k] >= 0 ? String(r[ix[k]] == null ? '' : r[ix[k]]).trim() : '');
  const out = [];
  rows.slice(h + 1).forEach((r, i) => {
    if (!(r || []).some(x => String(x == null ? '' : x).trim())) return;      // an empty row is not a row
    const pickTxt = cell(r, 'pick').toLowerCase();
    out.push({ line: h + 2 + i, date: cell(r, 'date'), sku: obUC(cell(r, 'sku')),
      pick: /ext/.test(pickTxt) ? 'external' : (/console|order console/.test(pickTxt) ? 'console' : ''),
      orderNo: obUC(cell(r, 'orderNo')), qty: cell(r, 'qty'), who: cell(r, 'who'), reason: cell(r, 'reason'),
      remarks: cell(r, 'remarks'), extFrom: cell(r, 'extFrom'), extQty: cell(r, 'extQty'), over: cell(r, 'over') });
  });
  return { rows: out };
}

/** Every row checked as the form checks it; a record for each good one, the reason for each bad one. */
function fgiRecvXlPlan(list, fileName) {
  const known = new Set((PTG.mdb || []).map(r => r && obUC(r.sku)));
  const got = new Map();                                     // orderNo|sku → pieces earlier rows bring in
  const batch = (no, sku) => got.get(obUC(no) + '|' + obUC(sku)) || 0;
  const seenDay = [];
  const today = (() => { const d = dToday().split('-'); return d[2] + '/' + d[1] + '/' + d[0]; })();
  const now = new Date().toISOString();
  const items = (list || []).map(v => {
    const it = { v, err: '', warn: '' };
    const date = v.date ? fgsDate(v.date) : today;
    const qty = /^\d+$/.test(String(v.qty).replace(/\.0+$/, '')) ? parseInt(v.qty, 10) : NaN;
    if (!v.sku) it.err = 'Put in the SKU.';
    else if (!known.has(v.sku)) it.err = `${v.sku} is not in the master database.`;
    else if (!isFinite(qty) || qty < 1) it.err = 'Put in how many pieces — a whole number, 1 or more.';
    else if (!date) it.err = `"${v.date}" is not a date — write it as DD-MM-YYYY.`;
    else if (!String(v.who || '').trim()) it.err = 'Say where these came from.';
    if (it.err) return it;
    const o = fgiRecvOrderCheck(Object.assign({}, v, { qty }), batch);
    if (o.err) { it.err = o.err; return it; }
    got.set(o.orderNo + '|' + v.sku, batch(o.orderNo, v.sku) + qty);
    /* The form's two same-day warnings, said on the row. Saving the file is the second press. */
    const who = String(v.who).trim();
    const twin = (FGI.rows || []).concat(seenDay).find(r => r && r.date === date && obUC(r.sku) === v.sku && r.txnType === 'RECEIVE'
      && String(r.receivedFrom || '').trim().toLowerCase() === who.toLowerCase());
    const otherWay = (FGI.rows || []).find(r => r && r.date === date && obUC(r.sku) === v.sku && FGI_KINDS[r.txnType] && FGI_KINDS[r.txnType].dir < 0);
    if (twin) it.warn = `already received from "${who}" on ${date} (${nf(fgiNum(twin.qty))} pcs)`;
    else if (otherWay) it.warn = `already sent out on ${date} (${nf(fgiNum(otherWay.qty))} pcs)`;
    it.rec = { _id: fgiNewId('RCP'), txnType: 'RECEIVE', sku: v.sku, qty, date, reason: String(v.reason || '').trim(),
      orderNo: o.orderNo, orderSource: o.orderSource,
      ...(o.orderSource === 'external' ? { extOrderFrom: o.extFrom, ...(o.extQty ? { extOrderQty: o.extQty } : {}) } : {}),
      ...(o.overQty ? { overQty: o.overQty, overReason: o.overReason, overOrdered: o.overOrdered, overStatus: 'open' } : {}),
      receivedFrom: who, remarks: String(v.remarks || '').trim(), source: 'excel: ' + (fileName || 'sheet'),
      createdAt: now, createdBy: ME.email };
    seenDay.push(it.rec);
    return it;
  });
  return { items, bad: items.filter(x => x.err), good: items.filter(x => x.rec) };
}

/** Every issue row checked as the form checks an issue; the shelf goes down as the rows go. */
function fgiIssXlPlan(list, fileName) {
  const known = new Set((PTG.mdb || []).map(r => r && obUC(r.sku)));
  const took = new Map();                                    // SKU → pieces earlier rows take out
  const tookOrd = new Map();                                 // SKU → (order → pieces earlier rows take from it)
  const seenDay = [];
  const today = (() => { const d = dToday().split('-'); return d[2] + '/' + d[1] + '/' + d[0]; })();
  const now = new Date().toISOString();
  const items = (list || []).map(v => {
    const it = { v, err: '', warn: '' };
    const date = v.date ? fgsDate(v.date) : today;
    const qty = /^\d+$/.test(String(v.qty).replace(/\.0+$/, '')) ? parseInt(v.qty, 10) : NaN;
    const who = String(v.who || '').trim();
    if (!v.sku) it.err = 'Put in the SKU.';
    else if (!known.has(v.sku)) it.err = `${v.sku} is not in the master database.`;
    else if (!isFinite(qty) || qty < 1) it.err = 'Put in how many pieces — a whole number, 1 or more.';
    else if (!date) it.err = `"${v.date}" is not a date — write it as DD-MM-YYYY.`;
    else if (!who) it.err = 'Say who or what these are for — a movement with nobody on it cannot be traced.';
    else it.err = fgiOutCheck(v.sku, qty, 'ISSUE', took.get(v.sku) || 0);
    if (it.err) return it;
    /* THE FORM'S ORDER CHECK: a blank Order No is Auto; "No order — why" alone means it is for no order. */
    const tk = tookOrd.get(v.sku) || new Map();
    const oc = fgiOutOrderCheck({ sku: v.sku, qty, type: 'ISSUE', order: v.order, why: v.noOrderWhy, inv: v.inv, trans: v.trans, lr: v.lr }, tk);
    if (oc.err) { it.err = oc.err; return it; }
    (oc.fields.orders || []).forEach(p => tk.set(p.orderNo, (tk.get(p.orderNo) || 0) + p.qty));
    tookOrd.set(v.sku, tk);
    took.set(v.sku, (took.get(v.sku) || 0) + qty);
    /* The form's two same-day warnings. */
    const twin = (FGI.rows || []).concat(seenDay).find(r => r && r.date === date && obUC(r.sku) === v.sku && r.txnType === 'ISSUE'
      && String(r.issuedFor || '').trim().toLowerCase() === who.toLowerCase());
    const otherWay = (FGI.rows || []).find(r => r && r.date === date && obUC(r.sku) === v.sku && FGI_KINDS[r.txnType] && FGI_KINDS[r.txnType].dir > 0);
    if (twin) it.warn = `already issued to "${who}" on ${date} (${nf(fgiNum(twin.qty))} pcs)`;
    else if (otherWay) it.warn = `already received on ${date} (${nf(fgiNum(otherWay.qty))} pcs)`;
    it.rec = { _id: fgiNewId('ISS'), txnType: 'ISSUE', sku: v.sku, qty, date, reason: String(v.reason || '').trim(),
      ...oc.fields,
      issuedFor: who, remarks: String(v.remarks || '').trim(), source: 'excel: ' + (fileName || 'sheet'),
      createdAt: now, createdBy: ME.email };
    seenDay.push(it.rec);
    return it;
  });
  return { kind: 'ISSUE', items, bad: items.filter(x => x.err), good: items.filter(x => x.rec) };
}

let FGI_XL = null;
function fgiRecvXlOpen() { return fgiXlOpen('RECEIVE'); }
function fgiXlOpen(kind) {
  const K = FGI_XL_KIND[kind] || FGI_XL_KIND.RECEIVE;
  if (!fgiCanEntry()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = FGI_NO_ENTRY; return; }
  FGI_XL = null;
  ptOpenDialog({
    title: K.title,
    wide: true,
    note: kind === 'ISSUE'
      ? 'One row per issue, the same as "+ Stock entry" with Issue · out — every row is checked exactly as that form '
        + 'checks it: the SKU is in the master, somebody is named in "Issued to", and the store has the pieces. Rows of '
        + 'one SKU come off the shelf one after another, so two rows cannot both take the last piece. '
        + 'Nothing is written unless every row passes.'
      : 'One row per receipt, the same as "+ Stock entry" — every row is checked exactly as that form checks it: '
      + 'the SKU is in the master, the order is one of this SKU\'s Order Console orders (or an External order with '
      + 'its customer), and a row that takes an order past what it asked for needs "Why more than the order". '
      + 'Nothing is written unless every row passes.',
    html: `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" id="fgxTpl" class="ghost">Download template</button>
        <button type="button" id="fgxPick">Choose the filled sheet…</button>
        <input id="fgxFile" type="file" accept=".xlsx,.csv" style="display:none">
        <span class="muted" style="font-size:12px">Date as DD-MM-YYYY (blank = today)${kind === 'ISSUE' ? '' : ' · Order from: Order Console or External (blank = the order number decides)'}</span>
      </div>
      <div id="fgxOut" style="margin-top:12px"></div>`,
    onSave: () => fgiRecvXlSave(),
    saveLabel: kind === 'ISSUE' ? 'Issue them' : 'Save the entries',
  });
  $('fgxTpl').onclick = () => fgiXlTemplate(kind);
  $('fgxPick').onclick = () => $('fgxFile').click();
  $('fgxFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    let rows;
    try { rows = await pkReadFile(file); } catch (err) { ptDlgMsg('Could not read that file: ' + (err.message || err), true); return; }
    const read = fgiXlRead(rows, kind);
    if (read.err) { FGI_XL = null; $('fgxOut').innerHTML = ''; ptDlgMsg(read.err, true); return; }
    FGI_XL = kind === 'ISSUE' ? fgiIssXlPlan(read.rows, file.name) : fgiRecvXlPlan(read.rows, file.name);
    ptDlgMsg('');
    fgiRecvXlShow(file.name);
  };
}

function fgiRecvXlShow(name) {
  const p = FGI_XL; if (!p || !$('fgxOut')) return;
  const pcs = p.good.reduce((t, x) => t + x.rec.qty, 0);
  $('fgxOut').innerHTML = `<div style="margin-bottom:8px;font-size:13px"><b>${esc(name || '')}</b> · ${nf(p.items.length)} row(s) · `
    + `<span style="color:var(--accent);font-weight:700">${nf(p.good.length)} ready (${nf(pcs)} pcs)</span>`
    + (p.bad.length ? ` · <span style="color:var(--bad);font-weight:700">${nf(p.bad.length)} to fix — nothing is saved until they are</span>` : '')
    + '</div><div class="xlwrap" style="max-height:52vh;overflow:auto"><table class="xl" style="font-size:12px"><thead><tr>'
    + '<th class="num">Row</th><th>Date</th><th style="text-align:left">SKU</th><th style="text-align:left">Order</th><th class="num">Pieces</th><th style="text-align:left">' + (p.kind === 'ISSUE' ? 'To' : 'From') + '</th><th style="text-align:left">Result</th></tr></thead><tbody>'
    + p.items.map(x => { const r = x.rec, v = x.v;
      return '<tr><td class="num">' + x.v.line + '</td><td>' + esc(r ? r.date : v.date) + '</td>'
        + '<td style="text-align:left;font-family:ui-monospace,monospace">' + esc(v.sku) + '</td>'
        + '<td style="text-align:left">' + (p.kind === 'ISSUE' ? '<span class="muted">—</span>' : esc(r ? r.orderNo : v.orderNo) + (r && r.orderSource === 'external' ? ' <span class="pill">EXTERNAL</span>' : '')) + '</td>'
        + '<td class="num">' + esc(r ? nf(r.qty) : v.qty) + '</td><td style="text-align:left">' + esc(v.who) + '</td>'
        + '<td style="text-align:left;white-space:normal;max-width:420px">' + (x.err ? '<span style="color:var(--bad)">' + esc(x.err) + '</span>'
          : '<span style="color:var(--accent);font-weight:700">ok</span>'
            + (r.overQty ? ' <span class="pill pill-low">' + nf(r.overQty) + ' more than the order — flagged</span>' : '')
            + (x.warn ? ' <span class="muted">· ' + esc(x.warn) + '</span>' : '')) + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
}

async function fgiRecvXlSave() {
  if (!fgiCanEntry()) return FGI_NO_ENTRY;
  const p = FGI_XL;
  if (!p) return 'Choose the filled sheet first.';
  if (p.bad.length) return `${nf(p.bad.length)} row(s) need fixing — correct them in the sheet and choose it again. Nothing has been saved.`;
  if (!p.good.length) return p.kind === 'ISSUE' ? 'The sheet has no rows to issue.' : 'The sheet has no rows to receive.';
  /* The shelf is read again at save, as the form does: somebody may have issued from it since the preview. */
  if (p.kind === 'ISSUE') {
    const by = new Map(); p.good.forEach(x => by.set(x.rec.sku, (by.get(x.rec.sku) || 0) + x.rec.qty));
    for (const [sku, q] of by) { const short = fgiOutCheck(sku, q, 'ISSUE'); if (short) return short + ' Nothing has been saved — choose the sheet again.'; }
  }
  const recs = p.good.map(x => x.rec);
  for (let i = 0; i < recs.length; i += 400) {
    const chunk = {};
    recs.slice(i, i + 400).forEach(r => { chunk['pt_fgiLedger/' + r._id] = r; });
    await ptPatch(chunk);
  }
  FGI.rows = (FGI.rows || []).concat(recs);
  FGI_XL = null;
  renderFgi();
  const over = recs.filter(r => r.overQty);
  $('fgMsg').className = over.length ? 'err' : 'muted';
  const isIss = p.kind === 'ISSUE';
  $('fgMsg').textContent = `${nf(recs.length)} ${isIss ? 'issue' : 'receipt'}(s) saved from Excel — ${nf(recs.reduce((t, r) => t + r.qty, 0))} piece(s) of `
    + `${nf(new Set(recs.map(r => r.sku)).size)} SKU(s)${isIss ? ' taken out of the India Store' : ''}.`
    + (over.length ? ` ⚠ ${nf(over.length)} took an order past what it asked for — flagged for review.` : '');
  fbaBadge();
  fgiOverBadge();
  /* The same listing alert the form raises, once per SKU. */
  const bySku = new Map(); recs.forEach(r => bySku.set(r.sku, (bySku.get(r.sku) || 0) + r.qty));
  for (const [sku, q] of bySku) {
    const line = await lstAlertFor(sku, p.kind === 'ISSUE' ? 'ISSUE' : 'RECEIVE', q);
    if (line) { $('fgMsg').className = 'err'; $('fgMsg').textContent += line; }
  }
  return '';
}

/* ---- what each SKU is worth, and when to worry ----
 *
 * A re-order level and a listing tag are facts about how this store treats a SKU, not about the
 * product — so they live here, in pt_fgiSettings, and not in the production master database, which
 * the factory owns and this app only reads.
 */
async function fgiSetOpen(sku) {
  const s = obUC(sku), cur = (FGI.set || {})[s] || {};
  const m = fgiMaster(s);
  const price = parseFloat(m.inventoryValuationPrice);
  ptOpenDialog({
    title: 'Settings for ' + s,
    subtitle: [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · '),
    note: 'The re-order level is what turns the status amber. The tag is your own note about where '
      + 'this SKU stands. The valuation price is on the master database, not here — it belongs to '
      + 'the product.' + (isFinite(price) ? ` This one is ${nf(price)}.` : ' This one has none.'),
    fields: [
      { key: 'reorder', label: 'Re-order level', type: 'number', min: 0, step: 1, value: cur.reorder == null ? '' : cur.reorder },
      { key: 'remark', label: 'Tag', type: 'select', value: cur.remark || '',
        options: ['', 'Listed', 'Need listing', 'Discontinue', 'Etsy'] },
    ],
    onSave: async v => {
      if (!fgiCanEdit()) return FGI_NO_EDIT;
      const n = parseFloat(v.reorder);
      const row = { reorder: isFinite(n) && n > 0 ? n : null, remark: v.remark || '',
        at: new Date().toISOString(), by: ME.email };
      await ptPut('pt_fgiSettings/' + s, row);
      FGI.set = FGI.set || {}; FGI.set[s] = row;
      renderFgi();
      return '';
    },
  });
}

/** OUT when there is none, LOW when it is at or under the re-order level, otherwise OK. */
function fgiStatus(sku, current) {
  const r = parseFloat(((FGI.set || {})[obUC(sku)] || {}).reorder);
  if (current <= 0) return { cls: 'pill-out', txt: 'out' };
  if (isFinite(r) && r > 0 && current <= r) return { cls: 'pill-low', txt: 'low' };
  return { cls: 'pill-ok', txt: 'ok' };
}

/* ---- undoing a movement ---- */
async function fgiDelete(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const r = (FGI.rows || []).find(x => (x._id || x.id) === id); if (!r) return 'That movement is gone already.';
  /* A marker is not a movement — it is the record that a transfer was counted in, or sent back.
   * Deleting one on its own would leave the transfer saying something that never happened. */
  if (r.txnType === 'RECEIPT_CONFIRM' || r.txnType === 'RETURN_TO_PRESS')
    return 'That row is a marker for a transfer, not a movement of its own. Delete the transfer itself and this goes with it.';
  /* The rest is fgiDeletePlan — one set of rules whether it is one row or three hundred: a transfer
   * takes its markers and gives its pieces back to press, an FBA dispatch takes its returns. */
  const plan = fgiDeletePlan([id]);
  if (!plan.gone.length) return 'That movement cannot be deleted: ' + ((plan.refused[0] || {}).why || 'unknown') + '.';
  const note = (plan.pressBack.size ? ` ${nf(fgiNum(r.qty))} piece(s) are available on the press entry again.` : '')
    + (plan.notes.length ? ' ' + plan.notes.join(' ') : '')
    + (plan.gone.length > 1 && r.txnType === 'FBA' ? ` Its ${nf(plan.gone.length - 1)} return row(s) went with it.` : '');
  const why = await fgiDeleteRun(plan);
  if (why) return why;
  renderFgi();
  fbaBadge();
  const moved = plan.skus.find(s => s.sku === obUC(r.sku)) || { before: 0, after: 0 };
  const dir = moved.after < moved.before ? 'down' : (moved.after > moved.before ? 'up' : 'nowhere');
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `Deleted: ${String(r.txnType).replace(/_/g, ' ').toLowerCase()} of ${nf(fgiNum(r.qty))} `
    + `piece(s) of ${obUC(r.sku)}. Stock went ${dir} by ${nf(Math.abs(moved.after - moved.before))} — ${obUC(r.sku)} now reads `
    + `${nf(fgiOf(r.sku).current)}.` + note;
  return '';
}

function fgiDeleteAsk(id) {
  const r = (FGI.rows || []).find(x => (x._id || x.id) === id); if (!r) return;
  const plan = fgiDeletePlan([id]);
  const hit = plan.skus.find(s => s.sku === obUC(r.sku));
  const before = hit ? hit.before : fgiOf(r.sku).current;
  const after = hit ? hit.after : before;
  ptOpenDialog({
    title: 'Delete this movement',
    subtitle: `${String(r.txnType).replace(/_/g, ' ').toLowerCase()} · ${obUC(r.sku)} · ${nf(fgiNum(r.qty))} piece(s)`,
    /* The confirmation says what the number becomes, not "are you sure?" — that is the thing the
     * person actually needs to check before pressing it. */
    note: `${obUC(r.sku)} is at ${nf(before)} now and will read ${nf(after)} after this.`
      + (after < 0 ? ' That is BELOW ZERO — more would have gone out than ever came in, so this delete will be refused: '
        + 'take out the movement that sent those pieces away first.' : '')
      + (r.txnType === 'TRANSFER_IN' ? ' The pieces go back to the press entry they came from.' : '')
      + (plan.notes.length ? ' ' + plan.notes.join(' ') : '')
      + (plan.refused.length ? ' It cannot be deleted: ' + plan.refused[0].why + '.' : ''),
    html: `<div class="muted" style="font-size:12.5px">
        Recorded ${esc(String(r.createdAt || '').slice(0, 16).replace('T', ' '))}
        by ${esc(String(r.createdBy || '').split('@')[0])}${r.issuedFor ? ' · for ' + esc(r.issuedFor) : ''}${r.receivedFrom ? ' · from ' + esc(r.receivedFrom) : ''}${r.remarks ? ' · ' + esc(r.remarks) : ''}
      </div>`,
    onSave: () => fgiDelete(id),
    saveLabel: 'Delete it',
  });
}

/* ---- seeding the store with what is actually on the shelf ---- */
async function fgiSeedOpen() {
  if (!ME.admin) return;
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  /* India stock IS this store since 2026-10-06, so it cannot start it off — that option is gone. */
  const india = [];
  const press = [];
  const byPress = new Map();
  (PTG.press || []).forEach(r => { const left = fgiPressLeft(r); if (left > 0) byPress.set(obUC(r.sku), (byPress.get(obUC(r.sku)) || 0) + left); });
  byPress.forEach((qty, sku) => press.push({ sku, qty }));

  const say = list => {
    const ok = list.filter(r => known.has(r.sku)), no = list.filter(r => !known.has(r.sku));
    return `${nf(ok.length)} SKU(s) · ${nf(ok.reduce((s, r) => s + r.qty, 0))} piece(s)`
      + (no.length ? ` · ${nf(no.length)} SKU(s) are not in the production master database and would be left out` : '');
  };

  ptOpenDialog({
    title: 'Start the store off with what is on the shelf',
    subtitle: 'One opening entry per SKU. Meant to be done once.',
    note: 'This writes opening rows, and opening rows are stock. Doing it twice would double the '
      + 'store, so check the numbers below first — and if the store already has anything in it, this '
      + 'is almost certainly not what you want.',
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
        <label>Where to take the figures from<select id="fgsSrc">
          <option value="sheet">A file — the Ready Goods sheet's "Main" tab, saved as CSV</option>
          <option value="press">Press inventory — everything pressed and not yet sent to the store</option>
        </select></label>
        <label>Remarks<input id="fgsRemarks" type="text" value="Opening stock, ${esc(dToday())}"></label>
      </div>
      <div class="ptbox" style="margin-top:10px"><div class="ptbox-t">What each one would bring in</div>
        <div style="font-size:12.5px;line-height:1.7">
          <b>Press inventory</b> — ${press.length ? esc(say(press)) : 'nothing left to send'}
        </div>
        <div class="muted" style="font-size:11.5px;margin-top:8px">Press inventory is everything ever
          pressed less what has already been sent to this store. If pieces have left the factory without
          ever being recorded here, that figure is production to date, not what is on the shelf.</div>
      </div>
      <div id="fgsPick" class="toolbar" style="margin-top:10px">
        <button id="fgsBrowse" class="ghost">Add a file</button>
        <input id="fgsInput" type="file" accept=".csv,.xlsx,text/csv" multiple style="display:none">
        <span class="muted" style="font-size:11.5px;flex:1 1 200px">Three tabs, saved one at a time as
          CSV (File &rsaquo; Download &rsaquo; Comma-separated values, which saves the tab you are on):
          <b>Main</b>, <b>Movements</b> and <b>FBA</b>. Each is recognised by its own header, so the
          order does not matter. Main is the only one that must be there.</span>
      </div>
      <div id="fgsFile" class="muted" style="margin-top:8px;font-size:12.5px"></div>
      <div id="fgsInfo" class="muted" style="margin-top:8px;font-size:12.5px">
        ${(FGI.rows || []).length ? `<span class="err" style="display:block">The store already has ${nf((FGI.rows || []).length)} movement(s) in it.</span>` : ''}
      </div>`,
    onSave: () => fgiSeedSave(india, press, known),
    saveLabel: 'Write the opening stock',
  });
  FGF = { main: null, mov: null, fba: null, mainName: '', movName: '', fbaName: '', mainDup: [] };
  const showPick = () => $('fgsPick').classList.toggle('hide', $('fgsSrc').value !== 'sheet');
  $('fgsSrc').addEventListener('change', showPick);
  $('fgsBrowse').onclick = () => $('fgsInput').click();
  $('fgsInput').onchange = async e => {
    const fl = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of fl) await fgiSheetRead(f);       // one at a time, so each one's message is readable
  };
  showPick();
}

async function fgiSeedSave(india, press, known) {
  const src = $('fgsSrc').value;
  /* The sheet brings its movements with it, so it has its own writer rather than being squeezed
   * into the one-opening-per-SKU shape the other two sources use. */
  if (src === 'sheet') return fgiSheetImport();
  const added = 0;
  const list = (src === 'press' ? press : india).filter(r => known.has(r.sku));
  if (!list.length) return 'There is nothing to bring in from there.';
  const remarks = String(($('fgsRemarks') || {}).value || '').trim();
  const now = new Date().toISOString();
  const updates = {}, recs = [];
  list.forEach(r => {
    const rec = { _id: fgiNewId('OPN'), txnType: 'OPENING', sku: r.sku, qty: r.qty,
      remarks, source: src, createdAt: now, createdBy: ME.email };
    updates['pt_fgiLedger/' + rec._id] = rec; recs.push(rec);
  });
  /* Taken from press means those press rows have given their pieces up. Not marking them would let
   * the very same pieces be sent to the store a second time. */
  if (src === 'press') {
    (PTG.press || []).forEach(p => {
      const left = fgiPressLeft(p);
      if (left > 0 && known.has(obUC(p.sku)))
        updates['pt_pressInventory/' + (p.id || p._key) + '/transferredQty'] = fgiNum(p.transferredQty) + left;
    });
  }
  await ptPatch(updates);
  if (src === 'press') (PTG.press || []).forEach(p => {
    const left = fgiPressLeft(p);
    if (left > 0 && known.has(obUC(p.sku))) p.transferredQty = fgiNum(p.transferredQty) + left;
  });
  FGI.rows = (FGI.rows || []).concat(recs);
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(recs.length)} SKU(s) brought in, ${nf(list.reduce((s, r) => s + r.qty, 0))} piece(s), `
    + `from ${src === 'press' ? 'press inventory' : 'India stock'}.`
    + (added ? ` ${nf(added)} SKU(s) were added to the master database first.` : '')
    + (src === 'press' ? ' Those press entries are now marked as sent, so they cannot come in twice.' : '')
    + ' Every movement from here on is entered on this screen.';
  return '';
}


/* ---- bringing the WHOLE sheet in: the movements, not just the balance ----
 *
 * Three tabs, in any order, each recognised by its own header:
 *   Main       one row per SKU — the balance
 *   Movements  Date | Time | SKU | Type | Qty | Reason From/Issued | Remark
 *   FBA        Date | Time | SKU | account | Sent | Shipped | …
 *
 * THE OPENING IS WORKED BACKWARDS, and that is the whole trick. Every movement is imported exactly
 * as the sheet has it, and then one opening row per SKU is written for whatever is left over:
 *     opening = India Stock − (received − issued − sent to FBA)
 * So the history is real AND the closing balance lands exactly on the sheet, without having to trust
 * that the movement tabs reproduce the sheet's own Received and Issued columns. They nearly do —
 * 3,865 of 3,924 SKUs — and the opening quietly carries the rest, which is what an opening balance
 * IS: everything that happened before the log starts.
 *
 * The SKU column on the Movements tab is a formula that does not survive an export, so the literal
 * in the last column is used when it is empty. Without that, four rows in five are lost.
 */
let FGF = { main: null, mov: null, fba: null, mainName: '', movName: '', fbaName: '', mainDup: [] };

const FGS_SHAPES = {
  main: r => r.indexOf('sku') >= 0 && (r.indexOf('india stock') >= 0 || r.indexOf('current stock') >= 0),
  mov: r => r.indexOf('type') >= 0 && r.indexOf('qty') >= 0 && r.indexOf('date') >= 0,
  fba: r => r.indexOf('sent') >= 0 && r.indexOf('date') >= 0,
};

/** Excel keeps a date as days since 1899-12-30; a sheet saved as CSV may keep the text instead. */
function fgsDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const n = parseFloat(s);
  if (isFinite(n) && n > 20000 && n < 80000 && !/[/-]/.test(s)) {
    const d = new Date(Math.round((n - 25569) * 86400000)), p = x => String(x).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return String(+m[1]).padStart(2, '0') + '/' + String(+m[2]).padStart(2, '0') + '/' + m[3];
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[3] + '/' + iso[2] + '/' + iso[1] : '';
}

async function fgiSheetRead(file) {
  ptDlgMsg('Reading ' + file.name + '…');
  let rows;
  try { rows = await pkReadFile(file); }
  catch (e) { ptDlgMsg('Could not read that file: ' + (e.message || e), true); return; }
  /* A real sheet opens with a title or a totals row, so the header is found, not assumed. */
  let h = -1, kind = '';
  for (let i = 0; i < Math.min(15, rows.length) && !kind; i++) {
    const low = (rows[i] || []).map(x => String(x || '').trim().toLowerCase());
    for (const k of ['main', 'mov', 'fba']) if (FGS_SHAPES[k](low)) { h = i; kind = k; break; }
  }
  if (!kind) { ptDlgMsg('That file is none of the three: a Main tab (SKU and India Stock), a Movements '
    + 'tab (Date, Type, Qty) or an FBA tab (Date, SKU, Sent).', true); return; }
  const low = rows[h].map(x => String(x || '').trim().toLowerCase());
  const at = names => { for (const n of names) { const i = low.indexOf(n); if (i >= 0) return i; } return -1; };
  const N = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return isFinite(n) ? n : 0; };
  const body = rows.slice(h + 1);

  if (kind === 'main') {
    const c = { sku: at(['sku']), qty: at(['india stock', 'current stock']), brand: at(['brand']),
      art: at(['article', 'sub acticle', 'sub article']), col: at(['color', 'colour']),
      size: at(['size']), pack: at(['pack']),
      open: at(['opening (wh+fba)', 'oppning stock', 'opening stock']), rec: at(['received', 'receive qty']) };
    const by = new Map();
    body.forEach(r => {
      const sku = obUC(r[c.sku]); if (!sku) return;
      const qty = Math.round(N(r[c.qty]));
      const g = by.get(sku);
      /* A SKU listed twice with the SAME figure is one shelf written down twice, not two lots.
       * Different figures really are two figures, so those are added. */
      if (!g) by.set(sku, { sku, qty, brand: String(r[c.brand] || '').trim(), article: String(r[c.art] || '').trim(),
        color: String(r[c.col] || '').trim(), size: String(r[c.size] || '').trim(),
        pack: String(r[c.pack] || '').trim(), ever: N(r[c.open]) + N(r[c.rec]), n: 1 });
      else { g.n++; if (g.qty !== qty) g.qty += qty; }
    });
    FGF.main = [...by.values()];
    FGF.mainDup = FGF.main.filter(r => r.n > 1);
    FGF.mainName = file.name;
  } else if (kind === 'mov') {
    const c = { date: at(['date']), sku: at(['sku']), type: at(['type']), qty: at(['qty']),
      who: at(['reason from/issued', 'issue to', 'receive from', 'from/issued to']),
      remark: at(['remark']) };
    FGF.mov = body.map(r => {
      /* The SKU column is a formula on this tab; the literal sits in the last column. */
      const sku = obUC(r[c.sku]) || obUC(r[r.length - 1]);
      const qty = N(r[c.qty]);
      if (!sku || !qty) return null;
      const t = String(r[c.type] || '').trim().toUpperCase();
      const type = /RECEIVE/.test(t) ? 'RECEIVE' : (/ISSUE/.test(t) ? 'ISSUE' : '');
      if (!type) return null;
      return { sku, qty, type, date: fgsDate(r[c.date]), who: String(r[c.who] || '').trim(),
        remark: String(r[c.remark] || '').trim() };
    }).filter(Boolean);
    FGF.movName = file.name;
  } else {
    const c = { date: at(['date']), sku: at(['sku']), sent: at(['sent']), by: at(['issued to']) };
    FGF.fba = body.map(r => {
      const sku = obUC(r[c.sku]), qty = N(r[c.sent]);
      if (!sku || !qty) return null;
      return { sku, qty, date: fgsDate(r[c.date]),
        who: String(r[c.sku + 1] || '').trim() || 'FBA', by: String(r[c.by] || '').trim() };
    }).filter(Boolean);
    FGF.fbaName = file.name;
  }
  fgiSheetShow();
}

/** Everything the three files would produce, worked out before a single row is written. */
function fgiSheetPlan() {
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  const sum = list => { const m = new Map(); (list || []).forEach(r => m.set(r.sku, (m.get(r.sku) || 0) + r.qty)); return m; };
  const rec = sum((FGF.mov || []).filter(r => r.type === 'RECEIVE'));
  const iss = sum((FGF.mov || []).filter(r => r.type === 'ISSUE'));
  const fba = sum(FGF.fba);

  /* One opening per SKU for whatever the movements do not account for. */
  const open = [];
  (FGF.main || []).forEach(r => {
    const q = r.qty - ((rec.get(r.sku) || 0) - (iss.get(r.sku) || 0) - (fba.get(r.sku) || 0));
    if (q) open.push({ sku: r.sku, qty: Math.round(q), brand: r.brand, article: r.article,
      color: r.color, size: r.size, pack: r.pack });
  });
  /* A SKU that only ever appears in a movement still needs a home. */
  const mainSkus = new Set((FGF.main || []).map(r => r.sku));
  const strays = [...new Set((FGF.mov || []).concat(FGF.fba || []).map(r => r.sku))].filter(s => !mainSkus.has(s));

  const all = [...new Set(open.map(r => r.sku).concat((FGF.mov || []).map(r => r.sku), (FGF.fba || []).map(r => r.sku)))];
  const unknown = all.filter(s => !known.has(s));
  const negOpen = open.filter(r => r.qty < 0);
  /* A single movement bigger than everything that SKU ever had — its own opening plus everything
   * ever received, as the sheet itself records them — is a typo, not a movement. */
  const byMain = new Map((FGF.main || []).map(r => [r.sku, r]));
  const wild = (FGF.mov || []).filter(r => { const m = byMain.get(r.sku);
    return m && isFinite(m.ever) && r.qty > m.ever + 1; });
  /* Main's own total, PLUS the SKUs that only appear in a movement — they have no opening to work
   * back from, so whatever their movements come to is what lands in the store. Promising Main's
   * figure and delivering more is the kind of small lie that costs a whole reconciliation. */
  const strayNet = strays.reduce((s, k) => s + (rec.get(k) || 0) - (iss.get(k) || 0) - (fba.get(k) || 0), 0);
  const final = (FGF.main || []).reduce((s, r) => s + r.qty, 0) + strayNet;
  return { open, rec, iss, fba, unknown, negOpen, wild, strays, known, final };
}

function fgiSheetShow() {
  const el = $('fgsFile'); if (!el) return;
  const p = fgiSheetPlan();
  const t = a => (a || []).reduce((s, r) => s + r.qty, 0);
  const line = (name, n, extra) => n ? `<div><b>${esc(name)}</b> · ${nf(n)} ${extra}</div>` : '';
  el.className = 'muted';
  el.innerHTML = (!FGF.main && !FGF.mov && !FGF.fba) ? ''
    : line(FGF.mainName || 'Main', (FGF.main || []).length, 'SKU(s), ' + nf(t(FGF.main)) + ' piece(s) — the balance')
      + line(FGF.movName || 'Movements', (FGF.mov || []).length,
        'movement(s) — ' + nf((FGF.mov || []).filter(r => r.type === 'RECEIVE').length) + ' receive, '
        + nf((FGF.mov || []).filter(r => r.type === 'ISSUE').length) + ' issue')
      + line(FGF.fbaName || 'FBA', (FGF.fba || []).length, 'dispatch(es), ' + nf(t(FGF.fba)) + ' piece(s)')
      + (!FGF.main ? '<div class="err" style="margin-top:6px">The Main tab is needed — it is what the '
        + 'opening balance is worked back from.</div>' : `<div style="margin-top:8px">This writes
        <b>${nf(p.open.length + (FGF.mov || []).length + (FGF.fba || []).length)}</b> row(s) and leaves the store
        at <b>${nf(p.final)}</b> piece(s), which is what the Main tab says.</div>`)
      + (FGF.mainDup && FGF.mainDup.length ? `<div class="err" style="margin-top:6px">${nf(FGF.mainDup.length)}
        SKU(s) are listed more than once on Main; where the figure repeats it is counted once.</div>` : '')
      + (p.unknown.length ? `<div class="err" style="margin-top:6px">${nf(p.unknown.length)} SKU(s) are not in the
        production master database and would be left out.
        <label style="display:flex;align-items:center;gap:6px;margin-top:4px">
        <input id="fgsAdd" type="checkbox" style="width:auto"> add them first, from the sheet's own columns</label></div>` : '')
      + (p.negOpen.length ? `<div class="err" style="margin-top:6px">${nf(p.negOpen.length)} SKU(s) work out to a
        NEGATIVE opening (${nf(t(p.negOpen))} piece(s)) — the movements record more going out than the balance
        allows for. They are written as they are; hiding them would leave a store nobody can reconcile.</div>` : '')
      + (p.wild.length ? `<div class="err" style="margin-top:6px">${nf(p.wild.length)} movement(s) are larger than
        everything that SKU ever had: ${esc(p.wild.slice(0, 3).map(r => r.sku + ' ' + r.type.toLowerCase() + ' ' + nf(r.qty) + ' on ' + r.date).join('; '))}.
        They are imported as the sheet has them — delete them here afterwards and the stock moves back.</div>` : '')
      + (p.strays.length ? `<div style="margin-top:6px" class="muted">${nf(p.strays.length)} SKU(s) appear in a
        movement but not on Main; they get their movements and no opening.</div>` : '');
}

/** The rows to add to the master database, built from whichever file carries the details. */
function fgiSheetNewMasters() {
  const p = fgiSheetPlan();
  const detail = new Map((FGF.main || []).map(r => [r.sku, r]));
  const now = new Date().toISOString();
  return p.unknown.map(sku => {
    const d = detail.get(sku) || {};
    return { sku, articleType: d.article || '', subtype: d.article || '', color: d.color || '',
      size: d.size || '', brand: d.brand || '', packOf: d.pack || '1', fabric: '',
      /* Nothing on the sheet says whether these need cutting, and guessing wrong would change what
       * the gates allow — so they get the app's own default. */
      cuttingRequired: true, consumption: 0, isZip: false, isRuffle: false, fillerFabricRequired: false,
      addedFrom: 'Ready Goods sheet', addedAt: now, addedBy: ME.email };
  });
}

/** Movements, FBA dispatches and the opening balance, written in chunks. */
async function fgiSheetImport() {
  if (!ME.admin) return 'Only an admin can bring stock in.';
  if (!FGF.main) return 'The Main tab is needed — it is what the opening balance is worked back from.';
  let p = fgiSheetPlan();
  const remarks = String(($('fgsRemarks') || {}).value || '').trim();
  const now = new Date().toISOString();

  let added = 0;
  if ($('fgsAdd') && $('fgsAdd').checked && p.unknown.length) {
    const news = fgiSheetNewMasters();
    const upd = {}; news.forEach(r => { upd['pt_masterDB/mdb_' + r.sku] = r; });
    await ptPatch(upd);
    PTG.mdb = (PTG.mdb || []).concat(news.map(r => Object.assign({ _key: 'mdb_' + r.sku }, r)));
    PT.mdb = PTG.mdb; added = news.length;
    p = fgiSheetPlan();
  }
  const known = p.known;

  const recs = [];
  /* The movements first, in the order the sheet has them, each keeping its own date and who. */
  (FGF.mov || []).filter(r => known.has(r.sku)).forEach(r => recs.push({
    _id: fgiNewId(r.type === 'RECEIVE' ? 'RCP' : 'ISS'), txnType: r.type, sku: r.sku, qty: r.qty,
    date: r.date, [r.type === 'RECEIVE' ? 'receivedFrom' : 'issuedFor']: r.who || '(not recorded)',
    reason: r.remark || '', remarks, source: 'sheet: ' + (FGF.movName || 'Movements'),
    createdAt: now, createdBy: ME.email }));
  (FGF.fba || []).filter(r => known.has(r.sku)).forEach(r => recs.push({
    _id: fgiNewId('FBA'), txnType: 'FBA', sku: r.sku, qty: r.qty, date: r.date,
    issuedFor: r.who || 'FBA', reason: r.by || '', remarks, source: 'sheet: ' + (FGF.fbaName || 'FBA'),
    createdAt: now, createdBy: ME.email }));
  /* Then the opening: whatever the movements do not account for. */
  p.open.filter(r => known.has(r.sku)).forEach(r => recs.push({
    _id: fgiNewId('OPN'), txnType: 'OPENING', sku: r.sku, qty: r.qty,
    remarks: remarks || 'everything before the movement log starts',
    source: 'sheet: ' + (FGF.mainName || 'Main'), createdAt: now, createdBy: ME.email }));

  if (!recs.length) return 'There is nothing to bring in.';
  let done = 0;
  for (let i = 0; i < recs.length; i += 400) {
    const chunk = {};
    recs.slice(i, i + 400).forEach(r => { chunk['pt_fgiLedger/' + r._id] = r; });
    await ptPatch(chunk);
    done += Object.keys(chunk).length;
    ptDlgMsg(`Writing… ${nf(done)} of ${nf(recs.length)} row(s).`);
  }
  FGI.rows = (FGI.rows || []).concat(recs);
  renderFgi();
  const total = [...fgiStock().values()].reduce((s, b) => s + b.current, 0);
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(recs.length)} row(s) written — `
    + `${nf(recs.filter(r => r.txnType === 'RECEIVE').length)} receive, `
    + `${nf(recs.filter(r => r.txnType === 'ISSUE').length)} issue, `
    + `${nf(recs.filter(r => r.txnType === 'FBA').length)} to FBA, `
    + `${nf(recs.filter(r => r.txnType === 'OPENING').length)} opening. `
    + (added ? `${nf(added)} SKU(s) were added to the master database first. ` : '')
    + `The store is at ${nf(total)} piece(s). Every movement is in "Every movement", with its own date.`;
  return '';
}

/* ---- emptying the store and starting again ----
 *
 * Two things have to go, not one. The ledger is obvious. The other is not: bringing stock in FROM
 * PRESS marks each press row's `transferredQty`, and a press row marked as sent can never be sent
 * again. Deleting only the ledger would leave those pieces locked out of both places — gone from the
 * store, and still counted as gone from press. So they are unmarked in the SAME write.
 *
 * Only what THIS store put there is unmarked: a press row is reset by exactly the pieces its own
 * transfer rows account for, never blindly to zero, because somebody may have sent some of it by
 * hand afterwards.
 */
async function fgiWipeOpen() {
  if (!ME.admin) return;
  if (FGI.rows === null) await ensureFgi();
  if (!PTG.press) await ptLoadGates();
  const rows = FGI.rows || [];
  const byType = {}, bySrc = {};
  rows.forEach(r => { byType[r.txnType] = (byType[r.txnType] || 0) + 1;
    if (r.source) bySrc[r.source] = (bySrc[r.source] || 0) + 1; });
  const stock = fgiStock();
  const pieces = [...stock.values()].reduce((s, b) => s + b.current, 0);
  const marked = (PTG.press || []).filter(r => fgiNum(r.transferredQty) > 0);

  ptOpenDialog({
    title: 'Empty the store and start again',
    subtitle: `${nf(rows.length)} movement(s) · ${nf(stock.size)} SKU(s) · ${nf(pieces)} piece(s) in stock`,
    note: 'Everything in Finished Goods is deleted. Nothing else is touched — no order, no press '
      + 'entry, no master row is removed. Press entries that this store marked as sent are unmarked, '
      + 'so their pieces can be sent again.',
    html: `<div class="ptbox"><div class="ptbox-t">What goes</div>
        <div style="font-size:12.5px;line-height:1.8">
          ${Object.keys(byType).map(k => `<b>${nf(byType[k])}</b> ${esc(String(k).replace(/_/g, ' ').toLowerCase())} row(s)`).join('<br>')}
          ${Object.keys(bySrc).length ? `<br><span class="muted">brought in from: ${esc(Object.keys(bySrc).map(k => k + ' (' + nf(bySrc[k]) + ')').join(', '))}</span>` : ''}
        </div></div>
      ${marked.length ? `<div class="ptbox" style="margin-top:10px"><div class="ptbox-t">What is given back</div>
        <div style="font-size:12.5px">${nf(marked.length)} press entr${marked.length === 1 ? 'y is' : 'ies are'}
        marked as sent to this store, holding ${nf(marked.reduce((s, r) => s + fgiNum(r.transferredQty), 0))}
        piece(s). Those marks are removed, so the pieces are available in Press Inventory again.</div></div>` : ''}
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px">
        <input id="fgwOk" type="checkbox" style="width:auto"> I want all of it deleted</label>`,
    onSave: fgiWipeRun,
    saveLabel: 'Delete it all',
  });
}

async function fgiWipeRun() {
  if (!ME.admin) return 'Only an admin can empty the store.';
  if (!$('fgwOk').checked) return 'Tick the box to confirm.';
  const rows = FGI.rows || [];
  if (!rows.length) return 'There is nothing in the store to delete.';

  /* How much of each press row THIS store is holding, so the right amount is handed back. */
  const back = new Map();
  rows.forEach(r => {
    if (r.txnType !== 'TRANSFER_IN' || r.reversed === true || !r.fromPress) return;
    back.set(r.fromPress, (back.get(r.fromPress) || 0) + fgiNum(r.qty));
  });
  /* An opening row taken from press carries no fromPress — it swallowed whole press rows. Those are
   * the ones this store marked with everything the row had left, so they go back to nothing. */
  const fromPressSeed = rows.some(r => r.txnType === 'OPENING' && r.source === 'press');

  const updates = { 'pt_fgiLedger': null };
  let given = 0;
  (PTG.press || []).forEach(p => {
    const had = fgiNum(p.transferredQty);
    if (!had) return;
    const mine = back.get(p.id || p._key) || 0;
    const next = fromPressSeed && !mine ? 0 : Math.max(0, had - mine);
    if (next !== had) { updates['pt_pressInventory/' + (p.id || p._key) + '/transferredQty'] = next; given += had - next; }
  });

  await ptPatch(updates);
  FGI.rows = [];
  (PTG.press || []).forEach(p => {
    const k = 'pt_pressInventory/' + (p.id || p._key) + '/transferredQty';
    if (updates[k] !== undefined) p.transferredQty = updates[k];
  });
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(rows.length)} movement(s) deleted — the store is empty.`
    + (given ? ` ${nf(given)} piece(s) are available in Press Inventory again.` : '')
    + ' Now bring the stock in once, with "Fetch live stock".';
  return '';
}

