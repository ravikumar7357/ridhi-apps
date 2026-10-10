/* ================= PRODUCTION FLOW · QC, AND FINISHED GOODS ACCEPTING =================
 * Ravi, 10 Oct (second word): "Q.C wala part abhi ke Q.C me flow kare (yahan se remove) and ready to India stock wala
 * Finish Goods me show ho for accept".
 *
 *   QC             is done on the Quality Control screen, as today — Waiting for QC (QC pass / spotting / touching), the
 *                  Checks form, Spotting & touching. The flow only READS pt_qcChecks for the line (order no + SKU): what
 *                  came back from the karigar and is not checked yet, what is in spotting / touching / alteration, what
 *                  passed, what was rejected. The QC bucket is a view of that, with a button to the Quality Control screen.
 *                  Rejected pieces go back to Raw cutting in store to be issued again (flow-core.js).
 *   Finished Goods the pieces QC passed and not yet in India stock are listed on the Finished Goods screen ("From QC — to
 *                  accept"). The team has only Accept or Reject there. Accept writes the RECEIVE row into pt_fgiLedger —
 *                  the India store — the way the Stock entry does (Received from: QC). Reject takes the pass back (rows in
 *                  pt_qcChecks with checked and ok negative, on the karigar's Job Work entry, saying why) so the pieces are
 *                  in Waiting for QC again. Each accept / reject is logged in pt_flowFgSend.
 * A test order's QC rows are the ones the Quality Control screen writes for its TEST Job Work entries (removed with the
 * test). Its accept is a RECEIVE row in the India store too (Ravi, 10 Oct: "India stock me received from QC kiya but entry
 * kahan gayi, wo in store dikhani chahiye") — test: true, remarks "[TEST] …" — and counts in India stock until "delete
 * test" takes it out again. Everything on the Finished Goods screen is switched on with the flow (FLOW_ON) only. */

/* ---- what the QC register says about one line (indexed once per read of the register) ---- */
const FLOW_QC_NONE = Object.freeze([]);
let FLOW_QCIX = { src: null, n: -1, map: null };
function flowQcIndex() {
  const src = (typeof QC !== 'undefined' && QC.checks) || FLOW_QC_NONE;
  if (FLOW_QCIX.map && FLOW_QCIX.src === src && FLOW_QCIX.n === src.length) return FLOW_QCIX.map;
  const map = new Map();
  src.forEach(c => {
    if (!c || !c.orderNo) return;
    const k = obUC(c.orderNo) + '|' + obUC(c.sku);
    const e = map.get(k) || { checked: 0, ok: 0, alt: 0, altBack: 0, rej: 0, dept: 0, rows: [] };
    e.rows.push(c); e.checked += +c.checked || 0; e.ok += +c.ok || 0; e.rej += +c.rejected || 0;
    e.alt += +c.forAlteration || 0; e.altBack += +c.altBack || 0;
    /* Sent to spotting or touching from Waiting for QC and not back yet — checked, not passed (as ordQcIndex counts it). */
    e.dept += c.refId ? -((+c.ok || 0) + (+c.rejected || 0)) : (c.dept === 'spotting' || c.dept === 'touching') ? (+c[c.dept] || 0) : 0;
    map.set(k, e);
  });
  FLOW_QCIX = { src, n: src.length, map };
  return map;
}
function flowQcLine(r) {
  const e = flowQcIndex().get(obUC(r.orderNo) + '|' + obUC(r.sku)) || { checked: 0, ok: 0, alt: 0, altBack: 0, rej: 0, dept: 0, rows: [] };
  return Object.assign({}, e, { altOpen: Math.max(0, e.alt - e.altBack), deptOpen: Math.max(0, e.dept) });
}
/** Pieces back from the karigar and not yet checked, for a line. */
const flowQcWaiting = (r, s) => Math.max(0, (s.receivedAll != null ? s.receivedAll : (s.received || 0)) - flowQcLine(r).checked);
const flowQcAltOpen = r => flowQcLine(r).altOpen;
/** Is anything of the line still with QC — waiting, in spotting / touching, or out for alteration? */
const flowQcOpen = (r, s) => { const q = flowQcLine(r); return flowQcWaiting(r, s) > 0 || q.altOpen > 0 || q.deptOpen > 0; };
const flowMayFg = () => !!(ME.admin || (ME.tabs || []).includes('fgi'));

/** Quality Control → Waiting for QC, narrowed to the line's order — the check is made there. */
async function flowQcEntry(r) {
  if (!flowMay('qc')) return flowSay('Quality Control is not open to this account.', true);
  try {
    showTab('qc');
    if ($('qcView') && [...($('qcView').options || [])].some(o => o.value === 'inbox')) $('qcView').value = 'inbox';
    if ($('qcQ')) $('qcQ').value = r.orderNo;
    if (typeof ensureQc === 'function') await ensureQc(); else if (typeof renderQc === 'function') renderQc();
  } catch (e) { flowSay('Quality Control is open — look for ' + r.orderNo + ' under Waiting for QC.', true); }
}

/* ---- Finished Goods: what QC passed and India stock does not have yet ----
 *   pt_flowFgSend/<id> = { orderNo, sku, pcs, at, by, status: 'accepted' | 'rejected', fgId?, why?, test? } — the log. */
const flowFgOf = r => Object.values(FLOW.fg || {}).filter(h => h && obUC(h.orderNo) === obUC(r.orderNo) && obUC(h.sku) === obUC(r.sku));
/** Passed QC and not in India stock yet. */
const flowFgToAccept = (r, s) => Math.max(0, (s.made || 0) - (s.india || 0));
/** The planned lines with something for the Finished Goods team to accept. A make-to-order line is handed to shipping
 * on the Order Console instead; an outsourced one is received from its vendor, as before. */
const flowFgLines = () => flowRows().filter(x => x.s.plan && x.s.route !== 'outsource' && (x.r.__t || !ordIsMto(x.r.orderNo)) && flowFgToAccept(x.r, x.s) > 0);
const flowFgSay = (t, bad) => { if ($('fgMsg')) { $('fgMsg').className = bad ? 'err' : 'muted'; $('fgMsg').textContent = t; } };
const flowFgFind = key => flowRows().find(y => y.s.key === key);
const flowFgLog = (x, rec) => { const id = 'fgs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return [id, Object.assign({ orderNo: x.r.orderNo, sku: obUC(x.r.sku), at: new Date().toISOString(), by: ME.email || '', ...(x.r.__t ? { test: true } : {}) }, rec)]; };
const flowFgAfter = () => { try { flowFgBadge(); } catch (e) { /* the badge waits */ } if (typeof renderFgi === 'function') renderFgi(); };

/** Accept: the RECEIVE row in the India store (a test order's stays on the test order). */
function flowFgAcceptOpen(key) {
  if (!flowMayFg()) return flowFgSay('Accepting is the Finished Goods team\'s — this account has no Finished Goods right.', true);
  const x = flowFgFind(key); const can = x ? flowFgToAccept(x.r, x.s) : 0;
  if (!can) return flowFgSay('Nothing of that line is waiting any more — press Refresh.', true);
  ptOpenDialog({
    title: `Accept into Finished Goods — ${x.r.orderNo} · ${obUC(x.r.sku)}${x.r.__t ? ' (TEST)' : ''}`,
    subtitle: `${nf(can)} passed QC and are not in India stock yet.${x.r.__t ? ' TEST order: it goes into the India store as a TEST entry, and "delete test" takes it out again.' : ''}`,
    html: `<div class="ptgrid" style="grid-template-columns:1fr 2fr"><label>Pieces counted in<input id="flfP" type="number" min="1" value="${can}"></label><label>Note<input id="flfN"></label></div>`,
    saveLabel: 'Accept',
    onSave: async () => {
      const n = Math.round(+$('flfP').value || 0);
      if (!(n > 0)) return 'How many were counted in?';
      if (n > can) return `Only ${nf(can)} passed QC and are not in India stock.`;
      return flowFgAccept(x, n, $('flfN').value.trim());
    },
  });
}
async function flowFgAccept(x, n, note) {
  const now = new Date().toISOString(), patch = {}, d = new Date(), p2 = v => String(v).padStart(2, '0'), sku = obUC(x.r.sku);
  let over = {};
  if (typeof FGI !== 'undefined' && FGI.rows == null && typeof fgiLoad === 'function') { try { await fgiLoad(); } catch (e) { /* refused below */ } }
  if (!x.r.__t) {   // a test order is on no order book: the order check has nothing to check it against
    let chk = {}; try { chk = fgiRecvOrderCheck({ sku, qty: n, orderNo: x.r.orderNo, pick: 'console' }) || {}; } catch (e) { chk = {}; }
    if (chk.err && !chk.needOver) return 'Not accepted: ' + chk.err;
    if (chk.needOver) over = { overQty: chk.overQty, overReason: 'passed QC (Production flow)', overOrdered: chk.overOrdered, overStatus: 'open' };
  }
  const fgRow = { _id: fgiNewId('RCP'), txnType: 'RECEIVE', sku, qty: n, date: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`, reason: '',
    orderNo: x.r.orderNo, orderSource: 'console', ...over, receivedFrom: 'QC (Production flow)', remarks: ((x.r.__t ? '[TEST] ' : '') + 'Accepted from QC' + (note ? ' — ' + note : '')),
    createdAt: now, createdBy: ME.email || '', ...(x.r.__t ? { test: true } : {}) };
  patch['pt_fgiLedger/' + fgRow._id] = fgRow;
  if (x.r.__t) patch[`pt_flowTest/${x.r.orderNo}/lines/${sku}/fgIn`] = (+x.r.__t.fgIn || 0) + n;
  const [id, log] = flowFgLog(x, { pcs: n, status: 'accepted', note: note || '', fgId: fgRow._id });
  patch['pt_flowFgSend/' + id] = log;
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  if (typeof FGI !== 'undefined') FGI.rows = (FGI.rows || []).concat([fgRow]);
  if (x.r.__t) { const o = FLOW.test[x.r.orderNo]; const t = Object.assign({}, o.lines[sku], { fgIn: patch[`pt_flowTest/${x.r.orderNo}/lines/${sku}/fgIn`] });
    FLOW.test = Object.assign({}, FLOW.test, { [x.r.orderNo]: Object.assign({}, o, { lines: Object.assign({}, o.lines, { [sku]: t }) }) }); }
  FLOW.fg = Object.assign({}, FLOW.fg, { [id]: log });
  flowFgAfter(); flowFgSay(`${nf(n)} of ${sku} (${x.r.orderNo}) accepted into Finished Goods — India stock${x.r.__t ? ' (TEST entry: Every movement shows it, Received from QC (Production flow); delete test takes it out)' : ''}.`);
  return '';
}
/** Reject — with why. The QC pass is taken back on the karigar's Job Work entries it was given on, newest first, so the
 * pieces are in Quality Control's Waiting for QC again. */
function flowFgRejectOpen(key) {
  if (!flowMayFg()) return flowFgSay('Rejecting is the Finished Goods team\'s — this account has no Finished Goods right.', true);
  const x = flowFgFind(key); const can = x ? flowFgToAccept(x.r, x.s) : 0;
  if (!can) return flowFgSay('Nothing of that line is waiting any more — press Refresh.', true);
  ptOpenDialog({
    title: `Reject — ${x.r.orderNo} · ${obUC(x.r.sku)}${x.r.__t ? ' (TEST)' : ''}`, subtitle: `${nf(can)} waiting. Rejected pieces go back to Quality Control (Waiting for QC) to be checked again.`,
    html: `<div class="ptgrid" style="grid-template-columns:1fr 2fr"><label>Pieces<input id="flfrP" type="number" min="1" value="${can}"></label><label>Why (stain, wrong size, stitching, packing…)<input id="flfrW"></label></div>`,
    saveLabel: 'Reject',
    onSave: async () => {
      const n = Math.round(+$('flfrP').value || 0), why = $('flfrW').value.trim();
      if (!(n > 0)) return 'How many are rejected?';
      if (n > can) return `Only ${nf(can)} are waiting.`;
      if (!why) return 'Say why they are rejected.';
      return flowFgReject(x, n, why);
    },
  });
}
async function flowFgReject(x, n, why) {
  const q = flowQcLine(x.r), net = new Map(), last = new Map();
  q.rows.forEach(c => { const b = c.baseId || ''; net.set(b, (net.get(b) || 0) + (+c.ok || 0)); const at = String(c.addedAt || c.date || ''); if (at > (last.get(b) || '')) last.set(b, at); });
  const order = [...net.keys()].filter(b => b && net.get(b) > 0).sort((a, b) => String(last.get(b)).localeCompare(String(last.get(a))));
  let left = n; const parts = [];
  order.forEach(b => { if (left <= 0) return; const k = Math.min(left, net.get(b)); parts.push([b, k]); left -= k; });
  if (left > 0) parts.push(['', left]);
  let p0 = {}; try { p0 = qcParts(x.r.sku) || {}; } catch (e) { p0 = {}; }
  const now = new Date().toISOString(), patch = {}, rows = [];
  parts.forEach(([b, k], i) => {
    const id = 'qc_' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6);
    const row = { id, date: ptNow(), checkedBy: 'Finished Goods', brand: p0.brand || '', articleType: p0.at || '', subtype: p0.sub || '', color: p0.col || '', size: p0.size || '',
      sku: obUC(x.r.sku), checked: -k, ok: -k, forAlteration: 0, rejected: 0, fgReject: k, orderNo: x.r.orderNo, ...(b ? { baseId: b } : {}),
      remarks: (x.r.__t ? '[TEST] ' : '') + 'Rejected by Finished Goods: ' + why, addedBy: ME.email || '', addedAt: now, ...(x.r.__t ? { test: true } : {}) };
    rows.push(row); patch['pt_qcChecks/' + id] = row;
  });
  const [lid, log] = flowFgLog(x, { pcs: n, status: 'rejected', why });
  patch['pt_flowFgSend/' + lid] = log;
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  if (typeof QC !== 'undefined') QC.checks = (QC.checks || []).concat(rows.map(r => Object.assign({ _key: r.id }, r)));
  FLOW.fg = Object.assign({}, FLOW.fg, { [lid]: log });
  flowFgAfter(); flowFgSay(`${nf(n)} of ${obUC(x.r.sku)} (${x.r.orderNo}) rejected (${why}) — back in Quality Control, Waiting for QC.`);
  return '';
}

/* ---- on the Finished Goods screen ---- */
let FLOW_FG_LOADING = null;
/** Read what the list needs (the flow's nodes, the QC register, the order book) without drawing the flow screen. */
function flowFgEnsure() {
  if (FLOW_FG_LOADING) return FLOW_FG_LOADING;
  const ready = FLOW.ppc && typeof QC !== 'undefined' && QC.checks != null;
  if (ready) return null;
  FLOW_FG_LOADING = (async () => { try { await flowEnsureData(); } catch (e) { /* the list says so */ } FLOW_FG_LOADING = null; })();
  return FLOW_FG_LOADING;
}
function flowFgRender() {
  const wait = flowFgEnsure();
  if (wait) { flowFgSay('Reading what passed QC…'); ptEmpty('fgTable', 'Loading…'); wait.then(() => { if ($('fgView').value === 'flow') renderFgi(); flowFgBadge(); }); return; }
  const q = String(($('fgQ') || {}).value || '').trim().toLowerCase();
  const all = flowFgLines(), rows = all.filter(x => !q || [x.r.orderNo, x.r.sku, x.r.color, x.r.size, x.r.subtype].join(' ').toLowerCase().includes(q));
  const may = flowMayFg(), pcs = rows.reduce((a, x) => a + flowFgToAccept(x.r, x.s), 0);
  const pic = sku => { const u = typeof ptImgOf === 'function' ? ptImgOf(sku) : ''; return u ? `<img src="${esc(ptImgSrc(u, 34))}" alt="" style="width:34px;height:34px;object-fit:contain;background:#fff;border-radius:5px">` : ''; };
  const head = ['Order', 'SKU', 'Image', 'Qty', 'QC passed', 'In India stock', 'To accept', 'Earlier', ''];
  $('fgTable').innerHTML = '<thead><tr>' + head.map((h, i) => `<th${i === 0 ? ' class="frz"' : i >= 3 && i <= 6 ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + (rows.map(x => { const n = flowFgToAccept(x.r, x.s), log = flowFgOf(x.r).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      return `<tr><td class="frz" style="text-align:left"><b>${esc(x.r.orderNo)}</b>${x.r.__t ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}</td>
        <td style="text-align:left;font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}<div class="muted" style="font-family:inherit;font-size:11px">${esc([x.r.subtype, x.r.color, x.r.size].filter(Boolean).join(' · '))}</div></td>
        <td>${pic(x.r.sku)}</td><td class="num">${nf(+x.r.qty || 0)}</td><td class="num">${nf(x.s.made)}</td><td class="num">${nf(x.s.india)}</td>
        <td class="num" style="font-weight:700;color:#166534">${nf(n)}</td>
        <td style="text-align:left;font-size:11px;white-space:normal;max-width:240px">${log.slice(0, 4).map(h => h.status === 'rejected'
          ? `<div style="color:#b91c1c">${esc(String(h.at || '').slice(0, 10))} · ${nf(h.pcs)} rejected — ${esc(h.why || '')}</div>`
          : `<div class="muted">${esc(String(h.at || '').slice(0, 10))} · ${nf(h.pcs)} accepted${h.by ? ' · ' + esc(String(h.by).split('@')[0]) : ''}</div>`).join('') || '<span class="muted">—</span>'}</td>
        <td style="white-space:nowrap">${may ? `<button data-flfga="${esc(x.s.key)}" style="padding:3px 12px;font-size:12px">Accept</button>
          <button class="ghost" data-flfgr="${esc(x.s.key)}" style="padding:3px 10px;font-size:12px;color:#b91c1c">Reject</button>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')
      || `<tr><td colspan="${head.length}" class="muted" style="padding:14px">Nothing from QC waiting to be accepted.</td></tr>`) + '</tbody>';
  flowFgSay(`${nf(rows.length)} line(s), ${nf(pcs)} piece(s) passed QC and not in India stock yet — Accept counts them into the India store, Reject sends them back to Quality Control · TEST VIEW, not on the live app`);
}
/** The count on the Finished Goods screen — only where the flow is switched on. */
function flowFgBadge() {
  const el = $('flFgBadge'); if (!el) return;
  if (!FLOW_ON || !FLOW.ppc || typeof QC === 'undefined' || QC.checks == null) { el.classList.add('hide'); return; }
  let n = 0; try { n = flowFgLines().length; } catch (e) { n = 0; }
  el.textContent = n ? String(n) : ''; el.classList.toggle('hide', !n);
}
/** Read the flow's data for the badge (Finished Goods screen, flow switched on, an account that may accept). */
function flowFgBadgeLoad() {
  if (!FLOW_ON || !flowMayFg()) return;
  const w = flowFgEnsure(); if (w) w.then(flowFgBadge); else flowFgBadge();
}
/* Switched on with the flow only: the view in the picker, the badge, the buttons. The live app's screen is untouched. */
if (FLOW_ON && $('fgView') && $('fgView').insertAdjacentHTML) {
  const opt = [...($('fgView').options || [])].find(o => o.value === 'pending');
  if (opt && opt.insertAdjacentHTML) opt.insertAdjacentHTML('afterend', '<option value="flow">From QC — to accept</option>');
  if ($('fgAlerts') && $('fgAlerts').insertAdjacentHTML) $('fgAlerts').insertAdjacentHTML('afterbegin', '<button type="button" id="flFgBadge" class="navbadge hide" data-fgview="flow" data-what="from QC to accept" title="Passed QC, not in India stock yet — accept or reject them" style="background:#166534"></button>');
  if ($('fgTable') && $('fgTable').addEventListener) $('fgTable').addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-flfga]'); if (a) { flowFgAcceptOpen(a.dataset.flfga); return; }
    const r = e.target.closest && e.target.closest('[data-flfgr]'); if (r) flowFgRejectOpen(r.dataset.flfgr);
  });
}
