/* ================= PRODUCTION FLOW · FILLING — the khol out to a filling vendor, filled pieces back =================
 * Ravi, 22 Oct: "filling vendor ki own bucket diffrent hoti printer se … unko ham khali khol dete h wo sirf usme cotton fill
 * karte h same seat pad chair cushion ke liye". His answers: print → cut → the karigar stitches the khol → filling vendor
 * (the vendor puts in the cotton) → QC; the order to the vendor goes by Vendor Order Request (Filling vendors only), and the
 * vendor only looks, as a printer does.
 *
 *   Which lines  a Seat Pad / Chair Cushion (ptIsFillSku), planned, not outsourced.
 *   The khol     a karigar's Job Work issue of such a SKU is marked fillNeed (job-work-entry.js, order-console-table.js);
 *                what the karigar sends back on it is khol, not finished — Quality Control does not see it yet.
 *   Filling      Demand → Filling (bucket 'dfill', the fabric team's right flchl): the khol goes out on a filling challan,
 *                  pt_flowChallans/FIL-YYYYMM-NNN = { no, kind: 'fill', date, orderNo, vendor:{code, name},
 *                    lines:[{ key, sku, item, pcs }], receipts:{ <id>: { at, date, by, items:{ <key>: pcs } } }, closed, cancelled }
 *                and the filled pieces are received against it. Kept beside the RFD challans and split off as read
 *                (flowEmbSplit), so no RFD list sees one.
 *   QC           a receipt writes fillIn on the karigar's Job Work rows the khol came from (oldest first):
 *                  pt_baseData/<id>/fillIn/<receipt id> = { at, qty, ch, vendor }
 *                and Waiting for QC lists a fillNeed row only up to what has been filled (quality-control.js). The QC
 *                check stays on the karigar's entry, so his work is still his. */

/** Per line: khol sent to filling, filled pieces back, the vendor, the challans. */
let FLOW_FILLX = { src: null, map: {} };
function flowFillIndex() {
  if (FLOW_FILLX.src === FLOW.fill && FLOW_FILLX.src) return FLOW_FILLX.map;
  const map = {};
  Object.values(FLOW.fill || {}).forEach(c => {
    if (!c || c.cancelled) return;
    const back = flowEmbRecv(c);
    (c.lines || []).forEach(l => {
      const e = map[l.key] || (map[l.key] = { sent: 0, back: 0, nos: [], to: '' });
      e.sent += +l.pcs || 0; e.back += back[l.key] || 0; e.nos.push(c.no); e.to = (c.vendor && c.vendor.name) || e.to;
    });
  });
  FLOW_FILLX = { src: FLOW.fill, map };
  return map;
}
/** The karigars' Job Work rows of a line whose khol is to be filled. */
const flowKholRows = r => (typeof PT !== 'undefined' && PT.base || []).filter(b => b && b.fillNeed && obUC(b.orderNo) === obUC(r.orderNo) && obUC(b.sku) === obUC(r.sku));
const flowFillInOf = b => Object.values((b && b.fillIn) || {}).reduce((a, x) => a + (+(x && x.qty) || 0), 0);
/** Khol back from the karigars on rows marked for filling. */
const flowKholIn = r => flowKholRows(r).reduce((a, b) => a + Math.max(0, +b.receivedPieces || 0), 0);
/** The filling vendors (category Filling); every vendor when none is marked so. */
function flowFillVendors() {
  let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const fv = all.filter(v => /fill/i.test(String(v.category || '')));
  return fv.length ? fv : all;
}
function flowFillNo(date, taken) {
  const pre = 'FIL-' + String(date || dToday()).slice(0, 7).replace('-', '') + '-';
  const used = Object.keys(FLOW.fill || {}).concat(taken || []).filter(k => k.startsWith(pre)).map(k => +k.slice(-3) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}

/* ---- Demand → Filling, one row a line ---- */
function flowFillCells(x, first) {
  const s = x.s, q = +x.r.qty || 0, td = 'text-align:left;font-size:13px;line-height:1.55;white-space:normal;vertical-align:top';
  const open = (s.fillNos || []).filter(no => { const c = (FLOW.fill || {})[no]; return c && !c.closed && !c.cancelled; });
  return `<td style="${td};min-width:170px"><div>Khol back from karigars: <b>${nf(s.kholIn || 0)} / ${nf(q)}</b></div>`
      + (s.fillCanSend > 0 ? `<div class="muted" style="font-size:12px">${nf(s.fillCanSend)} pcs to send for filling</div>` : '') + '</td>'
    + `<td style="${td};min-width:230px"><div>${s.fillTo ? `To: <b>${esc(s.fillTo)}</b>` : '<span class="muted">not sent yet</span>'}</div>`
      + `<div>Sent: <b>${nf(s.fillSent || 0)} pcs</b> · filled back: <b>${nf(s.fillBack || 0)} pcs</b></div>`
      + open.map(no => `<div style="font-size:12px;margin-top:2px"><a href="#" data-flfilp="${esc(no)}">${esc(no)}</a> · <a href="#" data-flfilrx="${esc(no)}">Receive filled</a>`
        + (Object.keys(((FLOW.fill || {})[no] || {}).receipts || {}).length ? '' : ` · <a href="#" data-flfilx="${esc(no)}" style="color:#b91c1c">cancel</a>`) + '</div>').join('') + '</td>'
    + `<td style="white-space:nowrap;vertical-align:top">${first && flowMay('flchl') ? `<button data-flfils="${esc(x.r.orderNo)}" style="width:auto;padding:3px 10px;font-size:12px">Send to filling</button>` : ''}</td>`;
}

/* ---- sending the khol: one PO, one filling vendor ---- */
function flowFillSendOpen(orderNo) {
  if (!flowMay('flchl')) return flowSay('Filling is the fabric team\'s — this account has no "Printed fabric in" right.', true);
  const rows = flowRows().filter(x => obUC(x.r.orderNo) === obUC(orderNo) && x.s.fill && x.s.fillCanSend > 0);
  if (!rows.length) return flowSay(`Nothing of ${orderNo} is waiting to go for filling — no khol is back from the karigars yet, or it went already.`, true);
  const vens = flowFillVendors(), last = rows.map(x => x.s.fillTo).find(Boolean);
  const lineHtml = rows.map((x, i) => `<tr><td><input type="checkbox" data-flk="${i}" checked style="width:auto"></td>
      <td style="text-align:left;white-space:normal"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b><div class="muted" style="font-size:11px">${esc(flowChItem(x.r))}</div></td>
      <td class="num">${nf(x.s.kholIn)} / ${nf(x.r.qty)}</td>
      <td class="num"><input data-flp="${i}" type="number" step="1" min="0" value="${esc(x.s.fillCanSend)}" style="width:72px;padding:3px 6px;font-size:12px"></td></tr>`).join('');
  ptOpenDialog({
    title: `Filling challan — ${orderNo}`,
    subtitle: 'The empty khol of this order to the filling vendor — they put in the cotton. Saving numbers the challan and opens it to print; the filled pieces are received against it.',
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Filling vendor<select id="flfVen"><option value="">— pick —</option>${vens.map(v => `<option value="${esc(v.code)}"${(v.desc || v.name) === last ? ' selected' : ''}>${esc((v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('')}</select></label>
        <label>Date<input id="flfDate" type="date" value="${esc(dToday())}"></label></div>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th></th><th style="text-align:left">Item</th><th>Khol back</th><th>Pieces to fill</th></tr></thead><tbody>${lineHtml}</tbody></table>
      <label style="display:block;margin-top:8px">Note (who carried it…)<input id="flfNote"></label>`,
    saveLabel: 'Make the challan',
    onSave: async () => {
      const v = vens.find(y => String(y.code) === String($('flfVen').value)); if (!v) return 'Which filling vendor? Pick one.';
      const date = $('flfDate').value || dToday();
      const picked = rows.map((x, i) => ({ x, on: !!(document.querySelector(`[data-flk="${i}"]`) || {}).checked, pc: +((document.querySelector(`[data-flp="${i}"]`) || {}).value || 0) })).filter(y => y.on);
      if (!picked.length) return 'Tick at least one line.';
      const bad = picked.filter(y => !(y.pc >= 1 && y.pc === Math.round(y.pc) && y.pc <= y.x.s.fillCanSend));
      if (bad.length) return bad.map(y => `${obUC(y.x.r.sku)}: pieces are whole, at least 1 and at most the ${nf(y.x.s.fillCanSend)} khol back and not sent`).join(' · ');
      const now = new Date().toISOString();
      let no = flowFillNo(date);
      const ch = { no, kind: 'fill', date, orderNo: obUC(orderNo), vendor: { code: String(v.code), name: v.desc || v.name || v.code }, note: $('flfNote').value.trim(), at: now, by: ME.email || '',
        lines: picked.map(({ x, pc }) => ({ key: x.s.key, sku: obUC(x.r.sku), item: flowChItem(x.r), pcs: pc })) };
      for (let k = 0, taken = []; ; k++) {
        let er = ''; try { er = await flowClaim('pt_flowChallans/' + no, ch); } catch (e) { return 'Could not save: ' + (e.message || e); }
        if (!er) break;
        if (k >= 15) return 'Could not get a free challan number — press Refresh and try again.';
        taken.push(no); no = flowFillNo(date, taken); ch.no = no;
      }
      if (typeof ptCas !== 'function') { try { await ptPatch({ ['pt_flowChallans/' + no]: ch }); } catch (e) { return 'Could not save: ' + (e.message || e); } }
      FLOW.fill = Object.assign({}, FLOW.fill, { [no]: ch });
      renderFlow();
      const er = flowFillPrint(no); if (er) flowSay(`Challan ${no} saved. ${er}`, true);
      return '';
    },
  });
}

/** The receipt's writes onto the karigars' rows the khol came from, oldest first: { patch, rows } or { err }. */
function flowFillAlloc(r, qty, rid, at, ch, vendor) {
  const ms = b => ptDtMs(b.issueDate) || ptDtMs(b.addedAt) || 0;
  const rows = flowKholRows(r).slice().sort((a, b) => ms(a) - ms(b));
  const room = rows.reduce((a, b) => a + Math.max(0, (+b.receivedPieces || 0) - flowFillInOf(b)), 0);
  if (qty > room) return { err: `${obUC(r.sku)}: only ${nf(room)} khol of ${r.orderNo} are back from the karigars and not filled yet — receive the karigar's entry first.` };
  const patch = {}, touched = new Map(); let left = qty;
  rows.forEach(b => { if (left <= 0) return; const id = b.id || b._key, take = Math.min(left, Math.max(0, (+b.receivedPieces || 0) - flowFillInOf(b))); if (!take || !id) return;
    const rec = { at, qty: take, ch, vendor }; patch[`pt_baseData/${id}/fillIn/${rid}`] = rec; touched.set(b, rec); left -= take; });
  return { patch, touched };
}
function flowFillRecvOpen(no) {
  if (!flowMay('flchl')) return flowSay('Filling is the fabric team\'s — this account has no "Printed fabric in" right.', true);
  const c = (FLOW.fill || {})[no]; if (!c || c.cancelled) return flowSay('That filling challan is not here — press Refresh.', true);
  const got = flowEmbRecv(c), lines = c.lines || [], left = l => Math.max(0, (+l.pcs || 0) - (got[l.key] || 0));
  ptOpenDialog({
    title: `Receive filled pieces — ${no}`,
    subtitle: `${c.vendor && c.vendor.name ? c.vendor.name + ' · ' : ''}${c.orderNo}. Type the filled pieces that came back; they go to Quality Control. The rest stays open on the challan.`,
    html: `<label style="display:block;max-width:220px">Date<input id="flfrDate" type="date" value="${esc(dToday())}"></label>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th style="text-align:left">Item</th><th>Sent</th><th>Back already</th><th>Back today</th></tr></thead><tbody>${lines.map((l, i) =>
        `<tr><td style="text-align:left"><b style="font-family:ui-monospace,monospace">${esc(l.sku)}</b><div class="muted" style="font-size:11px">${esc(l.item || '')}</div></td>
          <td class="num">${nf(l.pcs)}</td><td class="num">${nf(got[l.key] || 0)}</td>
          <td class="num"><input data-flr="${i}" type="number" min="0" step="1" value="0" title="still to come: ${nf(left(l))} pcs" onfocus="this.select()" ${left(l) ? '' : 'disabled'} style="width:72px;padding:3px 6px;font-size:12px"></td></tr>`).join('')}</tbody></table>
      <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="flfrClose" type="checkbox" style="width:auto"> Nothing more is coming on this challan — close it</label>`,
    saveLabel: 'Receive',
    onSave: async () => {
      const items = {};
      lines.forEach((l, i) => { const n = Math.round(+((document.querySelector(`[data-flr="${i}"]`) || {}).value || 0)); if (n > 0) items[l.key] = (items[l.key] || 0) + n; });
      const closeIt = !!($('flfrClose') && $('flfrClose').checked);
      if (!Object.keys(items).length && !closeIt) return 'Type the filled pieces that came back.';
      const over = lines.filter(l => (items[l.key] || 0) > left(l)).map(l => l.sku);
      if (over.length) return `More came back than was sent for ${over.join(', ')} — check the figure.`;
      const date = $('flfrDate').value || dToday(), now = new Date().toISOString(), rid = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), patch = {}, touched = [];
      for (const [key, n] of Object.entries(items)) {
        const x = flowRows().find(y => y.s.key === key); if (!x) return 'A line of this challan is no longer on the order book — press Refresh.';
        const al = flowFillAlloc(x.r, n, rid, now, no, (c.vendor && c.vendor.name) || ''); if (al.err) return al.err;
        Object.assign(patch, al.patch); touched.push(...al.touched);
      }
      if (Object.keys(items).length) patch[`pt_flowChallans/${no}/receipts/${rid}`] = { at: now, date, by: ME.email || '', items };
      const after = Object.assign({}, got); Object.entries(items).forEach(([k, n]) => { after[k] = (after[k] || 0) + n; });
      const full = lines.every(l => (after[l.key] || 0) >= (+l.pcs || 0));
      if (full || closeIt) patch[`pt_flowChallans/${no}/closed`] = { at: now, by: ME.email || '', short: !full };
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      if (touched.length) PT.base = (PT.base || []).map(b => { const t = touched.find(([bb]) => bb === b); return t ? Object.assign({}, b, { fillIn: Object.assign({}, b.fillIn, { [rid]: t[1] }) }) : b; });
      const nc = Object.assign({}, c, { receipts: Object.assign({}, c.receipts) });
      if (patch[`pt_flowChallans/${no}/receipts/${rid}`]) nc.receipts[rid] = patch[`pt_flowChallans/${no}/receipts/${rid}`];
      if (patch[`pt_flowChallans/${no}/closed`]) nc.closed = patch[`pt_flowChallans/${no}/closed`];
      FLOW.fill = Object.assign({}, FLOW.fill, { [no]: nc });
      renderFlow();
      flowSay(`${no}: ${nf(Object.values(items).reduce((a, n) => a + n, 0))} filled pcs received${nc.closed ? ' · challan closed' : ''} — they are in Quality Control → Waiting for QC.`);
      return '';
    },
  });
}
async function flowFillCancel(no) {
  const c = (FLOW.fill || {})[no]; if (!c || c.cancelled) return;
  if (Object.keys(c.receipts || {}).length) return flowSay(`${no} has pieces received on it — it cannot be cancelled.`, true);
  if (!confirm(`Cancel filling challan ${no}? The khol on it counts as not sent again.`)) return;
  const v = { at: new Date().toISOString(), by: ME.email || '' };
  try { await ptPatch({ [`pt_flowChallans/${no}/cancelled`]: v }); } catch (e) { return flowSay('Could not cancel: ' + (e.message || e), true); }
  FLOW.fill = Object.assign({}, FLOW.fill, { [no]: Object.assign({}, c, { cancelled: v }) });
  renderFlow();
}
function flowFillHtml(c) {
  let st = {}; try { st = (GPO && GPO.settings) || {}; } catch (e) { st = {}; }
  const e = v => esc(v == null ? '' : String(v)), cell = 'border:1px solid #999;padding:6px 8px;font-size:12px';
  const dmy = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  const lines = c.lines || [], tp = lines.reduce((a, l) => a + (+l.pcs || 0), 0);
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(c.no) + '</title></head><body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top"><div style="font-size:18px;font-weight:bold">${e(st.company || FLOW_COMPANY)}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(st.address)}</div>${st.gstin ? `<div style="font-size:11px">GSTIN: ${e(st.gstin)}</div>` : ''}</td>`
    + `<td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">FILLING CHALLAN</div><div style="font-size:11px">Khol (empty covers) for filling job work — not for sale</div>`
    + `<div style="font-size:12px;margin-top:4px">Challan No: <b>${e(c.no)}</b></div><div style="font-size:12px">Order: <b>${e(c.orderNo)}</b></div></td></tr></table>`
    + `<table style="width:100%;border-collapse:collapse;margin:16px 0 10px"><tr><td style="border:2px solid #111;padding:8px 12px;width:70%"><div style="font-size:11px;color:#555">Filling vendor (To)</div>`
    + `<div style="font-size:17px;font-weight:bold">${e(c.vendor && c.vendor.name)}</div></td><td style="border:2px solid #111;border-left:0;padding:8px 12px"><div style="font-size:11px;color:#555">Date</div><div style="font-size:17px;font-weight:bold">${e(dmy(c.date))}</div></td></tr></table>`
    + `<table style="width:100%;border-collapse:collapse"><thead><tr>${['#', 'SKU', 'Item', 'Khol to fill (pcs)'].map(h => `<th style="${cell};background:#eee;text-align:left">${h}</th>`).join('')}</tr></thead><tbody>`
    + lines.map((l, i) => `<tr><td style="${cell}">${i + 1}</td><td style="${cell}"><b>${e(l.sku)}</b></td><td style="${cell}">${e(l.item)}</td><td style="${cell};text-align:right">${e(nf(l.pcs))}</td></tr>`).join('')
    + `<tr><td style="${cell}" colspan="3"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(tp))} pcs</b></td></tr></tbody></table>`
    + (c.note ? `<div style="margin-top:10px;font-size:11px"><b>Note:</b> ${e(c.note)}</div>` : '')
    + `<table style="width:100%;margin-top:50px;font-size:11px"><tr><td>Issued by<br><br><br>${e(String(c.by || '').split('@')[0])}</td>`
    + `<td style="text-align:right">Received by (${e(c.vendor && c.vendor.name)})<br><br><br>Signature &amp; date</td></tr></table></body></html>`;
}
function flowFillPrint(no) {
  const c = (FLOW.fill || {})[no]; if (!c) return 'That challan is not here — press Refresh.';
  const html = flowFillHtml(c);
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press the challan number again.';
  w.document.open();
  w.document.write(html.replace('</body>', '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div><style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
  return '';
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target; if (!t || !t.closest) return;
  const s = t.closest('[data-flfils]'), rx = t.closest('[data-flfilrx]'), pr = t.closest('[data-flfilp]'), cx = t.closest('[data-flfilx]');
  if (!s && !rx && !pr && !cx) return;
  e.preventDefault();
  if (s) return flowFillSendOpen(s.dataset.flfils);
  if (rx) return flowFillRecvOpen(rx.dataset.flfilrx);
  if (cx) return flowFillCancel(cx.dataset.flfilx);
  const er = flowFillPrint(pr.dataset.flfilp); if (er) flowSay(er, true);
});
