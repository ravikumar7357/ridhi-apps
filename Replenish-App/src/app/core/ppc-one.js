/* ================= PPC — PLANNED BY SKU, KEPT AS A LEDGER (R-one add-on, 24 Oct) =================
 *
 * Ravi, 24 Oct: "I want a ledger like system like we had created in the greige inventory … we don't plan according to the
 * order, we plan according to the article or SKU" — and then: "add where it actually is, work in progress at which stage,
 * and worked by whom, like the greige … by whom and when … the complete journey of the product till it is sent from the
 * production … and a completed tab which tells which product was in production and when, and lets us analyse the
 * frequency of the product".
 *
 * Five views, one page, nothing new stored — every figure is read from the registers the floor already fills:
 *   SKU plan     every open order of a SKU added up: ordered, not planned yet, finished goods in store, in production,
 *                made; "Plan" plans all the SKU's waiting lines together (the PPC plan form's own same-SKU plan).
 *   Where it is  every piece in production right now, with whom and since when: the printer (flow challans), the
 *                cutting table, each karigar (Job Work issues not yet received), QC, Finished Goods to accept, shipping.
 *   Journey      one SKU (or one order of it) from the order coming in to leaving production, each step with who and when.
 *   PPC ledger   every movement, newest first, with the SKU's running balance — like the Greige Desk's fabric ledger.
 *   Completed    what was made and when, SKU by SKU: how many times, how many pieces, how long it took, how often it comes.
 * Where the steps come from: order book (order in), pt_ppc (planned, by whom), flow challans (fabric to the printer and
 * printed back), Cutting Data (cutDate · addedBy), Job Work (issueDate / receivingDate · the karigar · addedBy), QC
 * checks (date · checkedBy), press, Finished Goods ledger (createdAt · createdBy), the shipping hand-over register.
 * The old PPC link is off the menu (ppc-one.css); its screen and code stay — the Demand buttons here open it. */
const P1 = { shown: false, built: false, loading: false, tab: 'sku', seg: 'all', open: '', q: '', jsku: '', jord: '', wseg: '',
  f: { from: '', to: '', kind: '', sku: '' }, lim: 300, cp: '90', copen: '', at: '' };
const P1_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p1N = v => (Math.round(+v || 0)).toLocaleString('en-IN');
const p1Day = d => d ? (+String(d).slice(8, 10)) + ' ' + P1_MON[+String(d).slice(5, 7) - 1] + (String(d).slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + String(d).slice(2, 4) : '') : '—';
const p1Who = v => String(v || '').split('@')[0];
const p1Iso = v => String(ptIsoDate(v) || '').slice(0, 10);
const p1Days = d => d ? Math.max(0, Math.round((Date.now() - Date.parse(d + 'T00:00:00')) / 864e5)) : null;
const p1May = () => !!(ME && (ME.admin || (typeof flowScreenAllowed === 'function' && flowScreenAllowed().length)));
const P1_OF = { ppc: 0, back: 0, demand: 1, vendor: 2, fabric: 2, emb: 2, cut: 2, raw: 2, wip: 2, out: 2, qcb: 3, ship: 4, fgin: 4 };
const P1_SAYS = { ppc: 'to plan', back: 'sent back to sales', demand: 'fabric / accessories to arrange', vendor: 'print order to give', fabric: 'with the printer',
  emb: 'at embroidery', cut: 'to cut', raw: 'cut, to give a karigar', wip: 'with karigars', out: 'made outside', qcb: 'with QC', ship: 'to hand to shipping', fgin: 'Finished Goods to accept', done: 'done' };
/* the movements of the ledger: label, colour class, which way the SKU's balance moves */
const P1_MV = { IN: ['Order in', 'mv-in'], PLAN: ['Planned', 'mv-plan'], BACK: ['Sent back to sales', 'mv-bad'], RFD: ['Fabric to printer', 'mv-mat'], PRN: ['Printed back', 'mv-mat'],
  CUT: ['Cut', 'mv-make'], ISS: ['Given to karigar', 'mv-make'], REC: ['Back from karigar', 'mv-make'], QC: ['QC passed', 'mv-qc'], REJ: ['QC rejected', 'mv-bad'],
  PRESS: ['Pressed', 'mv-qc'], FG: ['Into Finished Goods', 'mv-done'], FBA: ['Dispatched to FBA', 'mv-done'], SHIP: ['Handed to shipping', 'mv-done'] };
const P1_END = new Set(['FG', 'FBA', 'SHIP']);

/* ---------- reading the registers ---------- */

/** Every step on record, oldest first: { k, ms, day, orderNo, sku, pcs, unit, by, party, ref }. Cached on its sources. */
let P1_EV = { key: null, list: [] };
function p1Events() {
  const src = [PTG.ob, PT.cut, PT.base, PTG.press, FLOW.ppc, FLOW.ch, typeof QC !== 'undefined' ? QC.checks : null, typeof FGI !== 'undefined' ? FGI.rows : null, PTG.shopProd];
  if (P1_EV.key && src.every((s, i) => s === P1_EV.key[i])) return P1_EV.list;
  const out = [], add = (k, at, r, pcs, by, party, ref, unit) => {
    const q = +pcs || 0; if (!(q > 0)) return;
    const ms = ptDtMs(at) || 0, day = p1Iso(at) || (ms ? new Date(ms).toISOString().slice(0, 10) : '');
    out.push({ k, ms: ms || (day ? Date.parse(day + 'T12:00:00') : 0), t: /\d:\d\d/.test(String(at || '')), day, orderNo: obUC(r.orderNo || ''), sku: obUC(r.sku || ''), pcs: q, unit: unit || 'pcs', by: p1Who(by), party: String(party || '').trim(), ref: ref || '' });
  };
  /* order in — one per order book row; sent back to sales */
  (PTG.ob || []).forEach(r => { if (!r) return; add('IN', r.openedAt || r.uploadedAt || r.orderDate, r, typeof obPieces === 'function' ? obPieces(r) : r.qty, r.uploadedBy || r.addedBy || '', r.buyerName || (r.src === 'SHP' ? 'Shopify' : r.src || ''), r.shopOrderNo ? 'Shopify ' + r.shopOrderNo : r.src === 'SHP' ? 'Shopify order' : 'Order book');
    if (r.ppcBack && r.ppcBack.at) add('BACK', r.ppcBack.at, r, typeof obPieces === 'function' ? obPieces(r) : r.qty, r.ppcBack.by, '', r.ppcBack.note ? '“' + r.ppcBack.note + '”' : 'sent back'); });
  /* planned — the plan record, keyed by line */
  const lineOf = new Map(); try { ordLines().forEach(l => lineOf.set(flowKey(l.orderNo, l.sku), l)); } catch (e) { /* no order book yet */ }
  Object.entries(FLOW.ppc || {}).forEach(([k, p]) => { const l = lineOf.get(k); if (!p || !l || !p.at) return;
    const rt = (FLOW_ROUTES.find(r => r[0] === flowRouteOf(p)) || [])[2] || '';
    add('PLAN', p.at, l, l.qty, p.by, p.printer || (p.emb && p.emb.name) || p.outVendor || '', 'Plan · ' + rt + (p.dates && p.dates.ready ? ' · ready by ' + p1Day(p.dates.ready) : '')); });
  /* fabric to the printer and printed back — the flow challans */
  Object.values(FLOW.ch || {}).forEach(c => { if (!c || c.cancelled) return;
    (c.lines || []).forEach(l => { if (l.ruffleOnly) return; const u = flowChUnit(l);
      add('RFD', c.at || c.date, { orderNo: l.orderNo || c.orderNo, sku: l.sku }, flowChSent(l), c.by, c.vendor && c.vendor.name, 'Challan ' + c.no + (u === 'm' && l.fabric ? ' · ' + l.fabric : ''), u); });
    Object.values(c.receipts || {}).forEach(rc => Object.entries((rc && rc.items) || {}).forEach(([key, q]) => { const l = (c.lines || []).find(x => x.key === key); if (!l || l.ruffleOnly) return;
      add('PRN', rc.at || rc.date, { orderNo: l.orderNo || c.orderNo, sku: l.sku }, q, rc.by, c.vendor && c.vendor.name, 'Challan ' + c.no + (rc.note ? ' · ' + rc.note : ''), flowChUnit(l)); })); });
  /* cutting, job work, press */
  (PT.cut || []).forEach(r => { if (!r) return; add('CUT', r.cutDate || r.addedAt, r, (parseInt(r.pieces, 10) || 0) - (r.rejected === true ? parseInt(r.rejPieces, 10) || 0 : 0), r.addedBy, 'Cutting', 'Cutting Data'); });
  (PT.base || []).forEach(r => { if (!r) return;
    add('ISS', r.issueDate || r.addedAt, r, ptNum(r.issuePieces), r.addedBy, r.empName, 'Job Work · issue');
    if (r.receivingDate) add('REC', r.receivingDate, r, ptNum(r.receivedPieces), r.recvBy || r.lastEditedBy || '', r.empName, 'Job Work · receipt' + (ptNum(r.rejectionPieces) ? ' · ' + p1N(r.rejectionPieces) + ' rejected' : '')); });
  (PTG.press || []).forEach(r => { if (r) add('PRESS', r.entryDate || r.addedAt, r, r.pieces, r.addedBy, 'Press', 'Press'); });
  /* QC */
  ((typeof QC !== 'undefined' && QC.checks) || PTG.qc || []).forEach(c => { if (!c || c.refId) return;
    add('QC', c.date || c.addedAt, c, c.ok, c.checkedBy || c.addedBy, c.checkedBy || '', 'QC check' + (+c.forAlteration ? ' · ' + p1N(c.forAlteration) + ' for alteration' : ''));
    add('REJ', c.date || c.addedAt, c, c.rejected, c.checkedBy || c.addedBy, '', 'QC check · back to the karigar'); });
  /* Finished Goods: received (from QC, a transfer counted in) and dispatched to FBA */
  ((typeof FGI !== 'undefined' && FGI.rows) || []).forEach(r => { if (!r || r.test) return; const t = r.txnType;
    if (t === 'RECEIVE' || (t === 'TRANSFER_IN' && r.confirmed === true && r.reversed !== true)) add('FG', r.createdAt || r.date, r, r.qty, r.createdBy, r.receivedFrom || '', 'Finished Goods ' + (r._id || ''));
    else if (t === 'FBA') add('FBA', r.createdAt || r.date, r, r.qty, r.createdBy, 'Amazon FBA', (r.shipmentId ? 'Shipment ' + r.shipmentId : 'FBA dispatch')); });
  /* hand-overs to the shipping team (made-to-order lines) */
  try { shpHandRegister().forEach(h => add('SHIP', h.at, h, h.pcs, h.acceptedBy || h.by, 'Shipping team', h.shop ? 'Shopify ' + h.shop : 'Hand-over')); } catch (e) { /* not loaded */ }
  out.sort((a, b) => a.ms - b.ms);
  P1_EV = { key: src, list: out };
  return out;
}

/** The open lines with their state, grouped by SKU. */
function p1Skus() {
  let rc = { line: {} }; try { rc = flowRfdCover(); } catch (e) { /* not loaded */ }
  const by = new Map();
  flowRows().forEach(x => {
    if (x.r.__t || x.s.bucket === 'done') return;
    const k = obUC(x.r.sku), q = +x.r.qty || 0;
    const e = by.get(k) || { sku: k, what: [x.r.articleSubtype || x.r.articleType || x.r.itemName, x.r.color, x.r.size].filter(Boolean).join(' · '), lines: [], orders: new Set(), ordered: 0, notPlanned: 0, inMake: 0, made: 0, short: false, due: '', isNew: false };
    e.lines.push(x); e.orders.add(x.r.orderNo); e.ordered += q;
    if (x.s.bucket === 'ppc' || x.s.bucket === 'back') e.notPlanned += q; else e.inMake += Math.max(0, q - x.s.qc);
    e.made += Math.min(q, x.s.qc || 0);
    if (rc.line[x.s.key] && rc.line[x.s.key].short > 0) e.short = true;
    if (x.s.bucket === 'ppc' && x.recent) e.isNew = true;
    const d = String((x.s.plan && x.s.plan.dates && x.s.plan.dates.ready) || x.r.mtoDue || ''); if (d && (!e.due || d < e.due)) e.due = d;
    by.set(k, e);
  });
  return [...by.values()].map(e => { const fg = typeof fgiOf === 'function' ? Math.max(0, fgiOf(e.sku).current || 0) : 0;
    return Object.assign(e, { fg, toMake: Math.max(0, e.notPlanned - fg), stage: Math.min(...e.lines.map(x => P1_OF[x.s.bucket] ?? 9)) }); })
    .sort((a, b) => (b.notPlanned > 0) - (a.notPlanned > 0) || b.notPlanned - a.notPlanned || b.inMake - a.inMake || a.sku.localeCompare(b.sku));
}

/** Every piece in production right now: { stage, sku, orderNo, pcs, unit, who, since, ref }. */
function p1Wip() {
  const out = [], rows = flowRows().filter(x => !x.r.__t && x.s.bucket !== 'done'), open = new Set(rows.map(x => obUC(x.r.orderNo) + '|' + obUC(x.r.sku)));
  const lastOf = (k, o, s) => { const ev = p1Events(); for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i]; if (e.k === k && e.orderNo === o && e.sku === s) return e; } return null; };
  /* with the printer: what each open challan has sent and not had back */
  Object.values(FLOW.ch || {}).forEach(c => { if (!c || c.cancelled || c.closed) return; const recv = flowChRecv(c);
    (c.lines || []).forEach(l => { if (l.ruffleOnly || flowChMoved(c, l)) return; const left = flowR2(flowChSent(l) - (recv[l.key] || 0));
      if (left > 0.01) out.push({ stage: 'Printer', sku: obUC(l.sku), orderNo: obUC(l.orderNo || c.orderNo), pcs: left, unit: flowChUnit(l), who: (c.vendor && c.vendor.name) || '—', since: p1Iso(c.at || c.date), ref: 'Challan ' + c.no }); }); });
  rows.forEach(x => { const s = x.s, r = x.r, q = +r.qty || 0, o = obUC(r.orderNo), k = obUC(r.sku);
    if (s.bucket === 'vendor') { const p = lastOf('PLAN', o, k); out.push({ stage: 'Printer', sku: k, orderNo: o, pcs: q, unit: 'pcs', who: (s.plan && s.plan.printer) || 'printer not given yet', since: p ? p.day : '', ref: 'print order to give' }); }
    if (s.bucket === 'emb') out.push({ stage: 'Embroidery', sku: k, orderNo: o, pcs: Math.max(0, q - (s.embOk || 0)), unit: 'pcs', who: s.embTo || (s.plan && s.plan.emb && s.plan.emb.name) || 'Embroidery', since: '', ref: '' });
    if (s.canCut > 0 && (s.bucket === 'cut' || s.bucket === 'fabric')) { const p = lastOf('PRN', o, k); out.push({ stage: 'Cutting', sku: k, orderNo: o, pcs: s.canCut, unit: 'pcs', who: 'Cutting department', since: p ? p.day : '', ref: 'to cut' }); }
    if (s.canIssue > 0 && ['raw', 'cut', 'wip', 'qcb'].includes(s.bucket)) { const p = lastOf('CUT', o, k); out.push({ stage: 'Raw cutting in store', sku: k, orderNo: o, pcs: s.canIssue, unit: 'pcs', who: 'Store — to give a karigar', since: p ? p.day : '', ref: '' }); }
    let qcw = 0; try { qcw = flowQcWaiting(r, s) + flowQcLine(r).altOpen + flowQcLine(r).deptOpen; } catch (e) { qcw = 0; }
    if (qcw > 0) { const p = lastOf('REC', o, k); out.push({ stage: 'QC', sku: k, orderNo: o, pcs: qcw, unit: 'pcs', who: 'Quality Control', since: p ? p.day : '', ref: 'to check / alteration' }); }
    if (s.bucket === 'fgin') { const p = lastOf('QC', o, k); out.push({ stage: 'Finished Goods to accept', sku: k, orderNo: o, pcs: Math.max(0, s.made - s.india), unit: 'pcs', who: 'Finished Goods team', since: p ? p.day : '', ref: 'passed QC' }); }
    if (s.bucket === 'ship') { const p = lastOf('QC', o, k); out.push({ stage: 'To hand to shipping', sku: k, orderNo: o, pcs: q, unit: 'pcs', who: 'Shipping team', since: p ? p.day : '', ref: 'made, to hand over' }); }
  });
  /* with each karigar: Job Work issues of open lines not yet fully received */
  (PT.base || []).forEach(b => { if (!b) return; const o = obUC(b.orderNo), k = obUC(b.sku); if (!open.has(o + '|' + k)) return;
    const left = ptNum(b.issuePieces) - ptNum(b.receivedPieces) - ptNum(b.rejectionPieces);
    if (left > 0 && !b.frozen) out.push({ stage: 'With karigar', sku: k, orderNo: o, pcs: left, unit: 'pcs', who: b.empName || '—', since: p1Iso(b.issueDate || b.addedAt), ref: 'issued by ' + p1Who(b.addedBy) }); });
  return out.filter(w => w.pcs > 0);
}
const P1_WSTAGES = ['Printer', 'Embroidery', 'Cutting', 'Raw cutting in store', 'With karigar', 'QC', 'Finished Goods to accept', 'To hand to shipping'];

/* ---------- the views ---------- */

const p1Mv = e => `<span class="pl ${P1_MV[e.k][1]}">${P1_MV[e.k][0]}</span>`;
function p1SkuTab(skus) {
  const segs = [['all', 'All', () => true], ['plan', 'To plan', s => s.notPlanned > 0], ['make', 'In production', s => s.inMake > 0], ['short', 'RFD short', s => s.short]];
  const q = P1.q.trim().toUpperCase(), seg = segs.find(x => x[0] === P1.seg) || segs[0];
  const rows = skus.filter(s => seg[2](s) && (!q || (s.sku + ' ' + s.what + ' ' + [...s.orders].join(' ')).toUpperCase().includes(q)));
  const tot = k => rows.reduce((a, s) => a + s[k], 0);
  return `<div class="lg-seg">${segs.map(x => `<button type="button" class="${P1.seg === x[0] ? 'on' : ''}" data-p1seg="${x[0]}">${x[1]} <span>${p1N(skus.filter(x[2]).length)}</span></button>`).join('')}
      <span class="lg-note">Planned by SKU — every open order of the SKU added together.</span></div>
    <div class="lg-card"><div class="lg-cap">${p1N(rows.length)} SKUs · <b>${p1N(tot('ordered'))}</b> pcs on open orders · <b style="color:var(--bad)">${p1N(tot('notPlanned'))}</b> not planned · <b>${p1N(tot('inMake'))}</b> in production · <b>${p1N(tot('made'))}</b> made. Every figure is worked out from the registers.</div>
    <div class="lg-scroll"><table class="lg-t"><thead><tr><th>SKU · article</th><th>Open orders</th><th class="num">Ordered</th><th class="num">Not planned</th><th class="num" title="Finished Goods stock of this SKU in the store now">FG in store</th><th class="num">In production</th><th class="num">Made</th><th>Where</th><th></th></tr></thead><tbody>
    ${rows.slice(0, P1.lim).map(s => { const open = P1.open === s.sku, words = [...new Set(s.lines.map(x => P1_SAYS[x.s.bucket] || x.s.bucket))].join(', ');
      return `<tr class="${open ? 'on' : ''}" data-p1open="${esc(s.sku)}"><td><b>${esc(s.sku)}</b>${s.isNew ? ' <span class="pl mv-in">NEW</span>' : ''}${s.short ? ' <span class="pl pl-bad">RFD short</span>' : ''}<div class="sub">${esc(s.what)}</div></td>
        <td>${s.orders.size} <span class="sub" style="display:inline">${esc([...s.orders].slice(0, 2).join(', '))}${s.orders.size > 2 ? '…' : ''}</span></td>
        <td class="num">${p1N(s.ordered)}</td><td class="num"><b style="color:${s.notPlanned ? 'var(--bad)' : 'var(--accent)'}">${s.notPlanned ? p1N(s.notPlanned) : '✓ 0'}</b></td>
        <td class="num">${s.fg ? p1N(s.fg) : '<span class="muted">—</span>'}</td><td class="num">${s.inMake ? p1N(s.inMake) : '<span class="muted">—</span>'}</td><td class="num">${s.made ? p1N(s.made) : '<span class="muted">—</span>'}</td>
        <td><span class="sub" style="margin:0">${esc(words)}</span></td>
        <td style="white-space:nowrap">${s.notPlanned && flowCanBack() && s.lines.some(x => x.s.bucket === 'ppc') ? `<button type="button" class="lg-yes" data-p1plan="${esc(s.sku)}">Plan ${p1N(s.notPlanned)} pcs</button>` : ''} <button type="button" class="lg-go" data-p1jour="${esc(s.sku)}">Journey</button></td></tr>
        ${open ? `<tr class="lg-exp"><td colspan="9">${p1SkuMore(s)}</td></tr>` : ''}`; }).join('') || '<tr><td colspan="9" class="empty">Nothing here.</td></tr>'}
    </tbody></table></div>${rows.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show all ${p1N(rows.length)}</button>` : ''}</div>`;
}
function p1SkuMore(s) {
  const wip = p1Wip().filter(w => w.sku === s.sku), ev = p1Events().filter(e => e.sku === s.sku).slice(-6).reverse();
  return `<div class="lg-two"><div><div class="lg-h">Orders that make up the ${p1N(s.ordered)} pcs</div>
      <table class="lg-t lg-in"><tr><th>Order</th><th class="num">Pcs</th><th>Where</th><th>Planned</th><th>Ready by</th><th></th></tr>${s.lines.map(x => `<tr><td><b>${esc(x.r.orderNo)}</b></td><td class="num">${p1N(x.r.qty)}</td>
        <td>${esc(P1_SAYS[x.s.bucket] || x.s.bucket)}</td><td>${x.s.plan && x.s.plan.at ? esc(p1Who(x.s.plan.by)) + ' · ' + p1Day(p1Iso(x.s.plan.at)) : '<span class="muted">—</span>'}</td>
        <td>${p1Day((x.s.plan && x.s.plan.dates && x.s.plan.dates.ready) || x.r.mtoDue || '')}</td><td>${x.s.plan && flowCanBack() ? `<button type="button" class="lg-go sm" data-p1edit="${esc(x.r.orderNo)}|${esc(x.r.sku)}">Edit plan</button>` : ''}</td></tr>`).join('')}</table>
      <div class="lg-sum">Ordered <b>${p1N(s.ordered)}</b> · not planned <b style="color:var(--bad)">${p1N(s.notPlanned)}</b> · Finished Goods in store <b>${p1N(s.fg)}</b>${s.notPlanned ? ` · to make after stock <b>${p1N(s.toMake)}</b>` : ''}</div></div>
    <div><div class="lg-h">Where it is now</div>${wip.map(w => `<div class="lg-mv"><span class="pl mv-make">${esc(w.stage)}</span><b>${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</b><span>${esc(w.who)}</span><span class="muted" style="margin-left:auto">${esc(w.orderNo)}${w.since ? ' · since ' + p1Day(w.since) : ''}</span></div>`).join('') || '<div class="muted">Nothing is in production yet.</div>'}
      <div class="lg-h" style="margin-top:12px">Latest steps</div>${ev.map(e => `<div class="lg-mv">${p1Mv(e)}<b>${p1N(e.pcs)}${e.unit === 'm' ? ' m' : ''}</b><span class="muted">${esc(e.orderNo)}${e.party ? ' · ' + esc(e.party) : ''}${e.by ? ' · by ' + esc(e.by) : ''}</span><span class="muted" style="margin-left:auto">${p1Day(e.day)}</span></div>`).join('') || '<div class="muted">No step yet.</div>'}
      <button type="button" class="lg-go" style="margin-top:8px" data-p1jour="${esc(s.sku)}">Whole journey ›</button></div></div>`;
}
function p1WipTab() {
  const all = p1Wip(), q = P1.q.trim().toUpperCase(), rows = all.filter(w => (!P1.wseg || w.stage === P1.wseg) && (!q || (w.sku + ' ' + w.orderNo + ' ' + w.who).toUpperCase().includes(q)));
  const st = P1_WSTAGES.filter(s => all.some(w => w.stage === s));
  return `<div class="lg-seg"><button type="button" class="${!P1.wseg ? 'on' : ''}" data-p1w="">All <span>${p1N(all.length)}</span></button>${st.map(s => `<button type="button" class="${P1.wseg === s ? 'on' : ''}" data-p1w="${esc(s)}">${esc(s)} <span>${p1N(all.filter(w => w.stage === s).reduce((a, w) => a + (w.unit === 'm' ? 0 : w.pcs), 0))}</span></button>`).join('')}</div>
    <div class="lg-info">Every piece in production right now and who has it — the printer from its challan, each karigar from the Job Work issues not yet received, QC from what came back and is not checked.</div>
    ${(P1.wseg ? [P1.wseg] : st).map(s => { const rs = rows.filter(w => w.stage === s).sort((a, b) => String(a.since || '9').localeCompare(String(b.since || '9'))); if (!rs.length) return '';
      return `<div class="lg-card"><div class="lg-cap"><b>${esc(s)}</b> · ${p1N(rs.length)} line(s) · ${p1N(rs.filter(w => w.unit !== 'm').reduce((a, w) => a + w.pcs, 0))} pcs${rs.some(w => w.unit === 'm') ? ' · ' + p1N(rs.filter(w => w.unit === 'm').reduce((a, w) => a + w.pcs, 0)) + ' m of cloth' : ''}</div>
        <div class="lg-scroll"><table class="lg-t"><thead><tr><th>With whom</th><th>SKU</th><th>Order</th><th class="num">Pcs</th><th>Since</th><th class="num">Days</th><th>Reference</th><th></th></tr></thead><tbody>
        ${rs.slice(0, 400).map(w => { const d = p1Days(w.since); return `<tr><td><b>${esc(w.who)}</b></td><td>${esc(w.sku)}</td><td>${esc(w.orderNo)}</td><td class="num"><b>${p1N(w.pcs)}</b>${w.unit === 'm' ? ' m' : ''}</td><td>${p1Day(w.since)}</td>
          <td class="num"${d != null && d > 7 ? ' style="color:var(--bad);font-weight:700"' : ''}>${d == null ? '—' : d}</td><td class="muted">${esc(w.ref)}</td><td><button type="button" class="lg-go sm" data-p1jour="${esc(w.sku)}" data-p1jo="${esc(w.orderNo)}">Journey</button></td></tr>`; }).join('')}</tbody></table></div></div>`; }).join('') || '<div class="lg-card"><div class="empty">Nothing is in production.</div></div>'}`;
}
function p1JourTab() {
  const ev = p1Events(), skus = [...new Set(ev.map(e => e.sku))].sort();
  if (!P1.jsku) return `<div class="lg-card lg-filt"><label>SKU<input list="p1Skl" data-p1js placeholder="Type a SKU" style="width:260px"></label><datalist id="p1Skl">${skus.slice(0, 3000).map(s => `<option value="${esc(s)}">`).join('')}</datalist></div><div class="lg-card"><div class="empty">Pick a SKU to see its whole journey — or press <b>Journey</b> on any row.</div></div>`;
  const mine = ev.filter(e => e.sku === P1.jsku && (!P1.jord || e.orderNo === P1.jord || e.orderNo.split(/ \+ /).includes(P1.jord)));
  const orders = [...new Set(ev.filter(e => e.sku === P1.jsku).map(e => e.orderNo).filter(Boolean))];
  const wip = p1Wip().filter(w => w.sku === P1.jsku && (!P1.jord || w.orderNo === P1.jord));
  const sum = k => mine.filter(e => e.k === k && e.unit !== 'm').reduce((a, e) => a + e.pcs, 0);
  const tiles = [['Ordered', sum('IN')], ['Planned', sum('PLAN')], ['Cut', sum('CUT')], ['Given to karigars', sum('ISS')], ['Back', sum('REC')], ['QC passed', sum('QC')], ['Into FG', sum('FG')], ['Sent from production', sum('FBA') + sum('SHIP')]];
  return `<div class="lg-card lg-filt"><label>SKU<input list="p1Skl" data-p1js value="${esc(P1.jsku)}" style="width:240px"></label><datalist id="p1Skl">${skus.slice(0, 3000).map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Order<select data-p1jo2><option value="">All orders</option>${orders.map(o => `<option${o === P1.jord ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <button type="button" class="lg-go" data-p1ledg="${esc(P1.jsku)}">See it in the ledger</button></div>
    <div class="lg-tiles">${tiles.map(([l, v], i) => `<div><b${i && v < tiles[0][1] ? '' : ' style="color:var(--accent)"'}>${p1N(v)}</b><span>${l}</span></div>`).join('<i>›</i>')}</div>
    <div class="lg-two"><div class="lg-card" style="padding:14px 16px"><div class="lg-h">The journey · oldest first</div>
      <div class="tl">${mine.map(e => `<div class="tl-i${P1_END.has(e.k) ? ' end' : ''}"><span class="tl-d"></span><div class="tl-b"><div>${p1Mv(e)} <b>${p1N(e.pcs)}${e.unit === 'm' ? ' m' : ''}</b>${e.party ? ' · ' + esc(e.party) : ''}</div>
        <div class="sub">${p1Day(e.day)}${e.t ? ' ' + new Date(e.ms).toTimeString().slice(0, 5) : ''}${e.by ? ' · by <b>' + esc(e.by) + '</b>' : ''} · ${esc(e.orderNo || '—')}${e.ref ? ' · ' + esc(e.ref) : ''}</div></div></div>`).join('') || '<div class="muted">Nothing on record for this SKU yet.</div>'}</div></div>
      <div class="lg-card" style="padding:14px 16px;align-self:start"><div class="lg-h">Where it is now</div>${wip.map(w => `<div class="lg-mv"><span class="pl mv-make">${esc(w.stage)}</span><b>${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</b><span>${esc(w.who)}</span><span class="muted" style="margin-left:auto">${w.since ? 'since ' + p1Day(w.since) : ''}</span></div>`).join('') || '<div class="muted">Nothing of it is in production now.</div>'}</div></div>`;
}
function p1LedgerTab() {
  const ev = p1Events(), f = P1.f, q = P1.q.trim().toUpperCase();
  /* the SKU's balance after each step: not planned (ordered, no plan yet), in production (planned, not passed QC), ready (passed, not gone) */
  const bal = {}, after = new Array(ev.length);
  ev.forEach((e, i) => { if (e.unit === 'm') { after[i] = null; return; } const b = bal[e.sku] || (bal[e.sku] = { np: 0, mk: 0, rd: 0 });
    if (e.k === 'IN') b.np += e.pcs; else if (e.k === 'BACK') b.np -= e.pcs; else if (e.k === 'PLAN') { b.np -= e.pcs; b.mk += e.pcs; }
    else if (e.k === 'QC') { b.mk -= e.pcs; b.rd += e.pcs; } else if (P1_END.has(e.k)) b.rd -= e.pcs;
    after[i] = { np: Math.max(0, b.np), mk: Math.max(0, b.mk), rd: Math.max(0, b.rd) }; });
  const idx = []; for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i];
    if ((f.kind && e.k !== f.kind) || (f.sku && e.sku !== f.sku) || (f.from && e.day < f.from) || (f.to && e.day > f.to)) continue;
    if (q && !(e.sku + ' ' + e.orderNo + ' ' + e.party + ' ' + e.by + ' ' + e.ref).toUpperCase().includes(q)) continue; idx.push(i); }
  const inP = idx.reduce((a, i) => a + (ev[i].k === 'IN' ? ev[i].pcs : 0), 0), outP = idx.reduce((a, i) => a + (P1_END.has(ev[i].k) ? ev[i].pcs : 0), 0);
  return `<div class="lg-info">Every step of every SKU, newest first. The steps are entered on their own screens (order book, PPC, Demand, Cutting Data, Job Work, QC, Finished Goods) — this ledger reads them all.</div>
    <div class="lg-card lg-filt"><label>From<input type="date" data-p1f="from" value="${f.from}"></label><label>To<input type="date" data-p1f="to" value="${f.to}"></label>
      <label>Movement<select data-p1f="kind"><option value="">All</option>${Object.entries(P1_MV).map(([k, v]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <label>SKU<input list="p1Skl2" data-p1f="sku" value="${esc(f.sku)}" placeholder="All" style="width:200px"></label><datalist id="p1Skl2">${[...new Set(ev.map(e => e.sku))].sort().slice(0, 3000).map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      ${f.from || f.to || f.kind || f.sku ? '<button type="button" class="lg-go" data-p1fclr>Clear the filter</button>' : ''}</div>
    <div class="lg-card"><div class="lg-cap"><b>${p1N(idx.length)}</b> of ${p1N(ev.length)} movements · <b style="color:var(--brand-ink)">${p1N(inP)}</b> pcs ordered in · <b style="color:var(--accent)">${p1N(outP)}</b> pcs sent from production. The three right-hand columns are the SKU's balance after each step.</div>
    <div class="lg-scroll"><table class="lg-t"><thead><tr><th>Date</th><th>SKU</th><th>Order</th><th>Movement</th><th class="num">Qty</th><th>Party</th><th>Reference</th><th>By</th><th class="num">Not planned</th><th class="num">In production</th><th class="num">Ready</th></tr></thead><tbody>
    ${idx.slice(0, P1.lim).map(i => { const e = ev[i], b = after[i], sign = e.k === 'IN' ? '+' : P1_END.has(e.k) || e.k === 'BACK' ? '−' : '';
      return `<tr><td class="nw">${p1Day(e.day)} <span class="muted">${e.t ? new Date(e.ms).toTimeString().slice(0, 5) : ''}</span></td><td><b>${esc(e.sku)}</b></td><td>${esc(e.orderNo || '—')}</td><td>${p1Mv(e)}</td>
        <td class="num"><b>${sign}${p1N(e.pcs)}</b>${e.unit === 'm' ? ' m' : ''}</td><td>${e.party ? esc(e.party) : '<span class="muted">—</span>'}</td><td class="muted">${esc(e.ref)}</td><td>${e.by ? esc(e.by) : '<span class="muted">—</span>'}</td>
        ${b ? `<td class="num bal">${p1N(b.np)}</td><td class="num bal">${p1N(b.mk)}</td><td class="num bal">${p1N(b.rd)}</td>` : '<td class="bal" colspan="3"></td>'}</tr>`; }).join('') || '<tr><td colspan="11" class="empty">No movement matches the filter.</td></tr>'}
    </tbody></table></div>${idx.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show ${p1N(Math.min(idx.length, P1.lim + 700) - P1.lim)} more</button>` : ''}</div>`;
}
/** Completed: the order lines that left production, SKU by SKU — when, how long, how often. */
function p1DoneTab() {
  const ev = p1Events(), since = P1.cp === 'all' ? '' : new Date(Date.now() - (+P1.cp) * 864e5).toISOString().slice(0, 10);
  const first = new Map(), last = new Map();
  ev.forEach(e => { const k = e.orderNo + '|' + e.sku; if (e.k === 'IN' && !first.has(k)) first.set(k, e.day); if (P1_END.has(e.k)) last.set(k, e); });
  let lines = []; try { lines = ordLines(); } catch (e) { lines = []; }
  const done = [];
  lines.forEach(l => { const k = l.orderNo + '|' + l.sku, end = last.get(k); if (l.open && !end) return;
    const day = end ? end.day : p1Iso(l.handedAt || l.shopDoneAt); if (!day || (since && day < since)) return; if (l.open && (!end || end.pcs < l.qty * 0.5)) return;
    const start = first.get(k) || p1Iso(l.openIso || l.orderDate);
    done.push({ sku: l.sku, orderNo: l.orderNo, pcs: l.qty, what: [l.articleSubtype || l.articleType || l.itemName, l.color, l.size].filter(Boolean).join(' · '), start, day, how: end ? P1_MV[end.k][0] : (l.handedAt ? 'Handed over' : 'Closed'),
      lead: start && day ? Math.max(0, Math.round((Date.parse(day) - Date.parse(start)) / 864e5)) : null }); });
  const by = new Map();
  done.forEach(d => { const e = by.get(d.sku) || { sku: d.sku, what: d.what, list: [] }; e.list.push(d); by.set(d.sku, e); });
  const q = P1.q.trim().toUpperCase();
  const skus = [...by.values()].filter(e => !q || (e.sku + ' ' + e.what).toUpperCase().includes(q)).map(e => {
    const ds = e.list.map(d => d.day).sort(), gaps = []; for (let i = 1; i < ds.length; i++) gaps.push((Date.parse(ds[i]) - Date.parse(ds[i - 1])) / 864e5);
    const leads = e.list.map(d => d.lead).filter(v => v != null), span = ds.length > 1 ? Math.max(1, (Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / 864e5) : 0;
    return Object.assign(e, { times: e.list.length, orders: new Set(e.list.map(d => d.orderNo)).size, pcs: e.list.reduce((a, d) => a + d.pcs, 0), first: ds[0], last: ds[ds.length - 1],
      lead: leads.length ? Math.round(leads.reduce((a, v) => a + v, 0) / leads.length) : null, every: gaps.length ? Math.round(gaps.reduce((a, v) => a + v, 0) / gaps.length) : null,
      perMonth: span ? +(e.list.length / span * 30).toFixed(1) : null }); })
    .sort((a, b) => b.times - a.times || b.pcs - a.pcs);
  const tot = done.reduce((a, d) => a + d.pcs, 0), leads = done.map(d => d.lead).filter(v => v != null);
  return `<div class="lg-seg">${[['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last year'], ['all', 'All']].map(x => `<button type="button" class="${P1.cp === x[0] ? 'on' : ''}" data-p1cp="${x[0]}">${x[1]}</button>`).join('')}
      <span class="lg-note">${p1N(done.length)} order lines left production · ${p1N(tot)} pcs · ${p1N(skus.length)} SKUs${leads.length ? ' · ' + Math.round(leads.reduce((a, v) => a + v, 0) / leads.length) + ' days order-to-done on average' : ''}</span></div>
    <div class="lg-card"><div class="lg-cap">Made, SKU by SKU — <b>how many times</b> it was made, how many pieces, how long it took from the order coming in, and <b>how often</b> it comes back. Most-made first.</div>
    <div class="lg-scroll"><table class="lg-t"><thead><tr><th>SKU · article</th><th class="num">Times made</th><th class="num">Orders</th><th class="num">Pcs</th><th>First</th><th>Last</th><th class="num">Avg days to make</th><th class="num">Comes every</th><th class="num">Per month</th><th></th></tr></thead><tbody>
    ${skus.slice(0, P1.lim).map(s => { const open = P1.copen === s.sku;
      return `<tr class="${open ? 'on' : ''}" data-p1copen="${esc(s.sku)}"><td><b>${esc(s.sku)}</b><div class="sub">${esc(s.what)}</div></td><td class="num"><b>${s.times}</b></td><td class="num">${s.orders}</td><td class="num">${p1N(s.pcs)}</td>
        <td>${p1Day(s.first)}</td><td>${p1Day(s.last)}</td><td class="num">${s.lead == null ? '—' : s.lead + ' d'}</td><td class="num">${s.every == null ? '<span class="muted">once</span>' : s.every + ' days'}</td><td class="num">${s.perMonth == null ? '—' : s.perMonth}</td>
        <td><button type="button" class="lg-go sm" data-p1jour="${esc(s.sku)}">Journey</button></td></tr>
        ${open ? `<tr class="lg-exp"><td colspan="10"><table class="lg-t lg-in"><tr><th>Order</th><th class="num">Pcs</th><th>Order in</th><th>Left production</th><th>How</th><th class="num">Days</th></tr>${s.list.sort((a, b) => b.day.localeCompare(a.day)).map(d => `<tr><td><b>${esc(d.orderNo)}</b></td><td class="num">${p1N(d.pcs)}</td><td>${p1Day(d.start)}</td><td>${p1Day(d.day)}</td><td>${esc(d.how)}</td><td class="num">${d.lead == null ? '—' : d.lead}</td></tr>`).join('')}</table></td></tr>` : ''}`; }).join('') || '<tr><td colspan="10" class="empty">Nothing completed in this period.</td></tr>'}
    </tbody></table></div>${skus.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show all ${p1N(skus.length)}</button>` : ''}</div>`;
}

function p1Draw() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="lg-top"><h1>PPC</h1><span class="lg-note">Reading the order book, plans and registers…</span></div>'; return; }
  let skus = [], body = '';
  try {
    skus = p1Skus();
    body = P1.tab === 'wip' ? p1WipTab() : P1.tab === 'jour' ? p1JourTab() : P1.tab === 'ledger' ? p1LedgerTab() : P1.tab === 'done' ? p1DoneTab() : p1SkuTab(skus);
  } catch (e) { body = `<div class="lg-card"><div class="empty" style="color:var(--bad)">Could not read the registers: ${esc(e.message || e)}</div></div>`; }
  const T = [['sku', 'SKU plan'], ['wip', 'Where it is'], ['jour', 'Journey'], ['ledger', 'PPC ledger'], ['done', 'Completed']];
  const tp = skus.reduce((a, s) => a + s.notPlanned, 0), mk = skus.reduce((a, s) => a + s.inMake, 0);
  el.innerHTML = `<div class="lg-top"><h1>PPC</h1><div class="lg-tabs">${T.map(t => `<button type="button" class="${P1.tab === t[0] ? 'on' : ''}" data-p1tab="${t[0]}">${t[1]}</button>`).join('')}</div>
      <input class="lg-q" id="p1Q" placeholder="Search SKU, article, order, karigar…" value="${esc(P1.q)}"><span class="lg-when">${P1.loading ? 'Reading…' : 'Read ' + (P1.at || '—')} · <a data-p1r>↻ Refresh</a></span></div>
    <div class="lg-kpi"><div data-p1k="plan"><small>Not planned</small><b style="color:var(--bad)">${p1N(tp)} pcs</b><span>${p1N(skus.filter(s => s.notPlanned).length)} SKUs</span></div>
      <div data-p1k="make"><small>In production</small><b>${p1N(mk)} pcs</b><span>${p1N(skus.filter(s => s.inMake).length)} SKUs</span></div>
      <div data-p1k="short"><small>RFD fabric short</small><b style="color:var(--warn-ink)">${p1N(skus.filter(s => s.short).length)} SKUs</b><span>after earlier plans</span></div>
      <div data-p1k="new"><small>New this week</small><b style="color:var(--brand-ink)">${p1N(skus.filter(s => s.isNew).length)} SKUs</b><span>with a new order</span></div></div>
    ${body}`;
  p1Wire(el, skus);
}
function p1Wire(el, skus) {
  const on = (sel, fn, ev = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev] = e => fn(b, e); });
  const go = (tab, extra) => { P1.tab = tab; P1.lim = 300; Object.assign(P1, extra || {}); p1Draw(); window.scrollTo(0, 0); };
  on('[data-p1tab]', b => go(b.dataset.p1tab));
  on('[data-p1k]', b => go('sku', { seg: b.dataset.p1k === 'new' ? 'all' : b.dataset.p1k }));
  on('[data-p1seg]', b => { P1.seg = b.dataset.p1seg; P1.lim = 300; p1Draw(); });
  on('[data-p1open]', (b, e) => { if (e.target.closest('button')) return; P1.open = P1.open === b.dataset.p1open ? '' : b.dataset.p1open; p1Draw(); });
  on('[data-p1copen]', (b, e) => { if (e.target.closest('button')) return; P1.copen = P1.copen === b.dataset.p1copen ? '' : b.dataset.p1copen; p1Draw(); });
  on('[data-p1lim]', () => { P1.lim += 700; p1Draw(); });
  on('[data-p1plan]', b => { const s = skus.find(x => x.sku === b.dataset.p1plan); if (!s) return;
    const keys = s.lines.filter(x => x.s.bucket === 'ppc').map(x => x.s.key); if (keys.length) flowPpcOpen(null, null, keys); });
  on('[data-p1edit]', b => { const [o, k] = b.dataset.p1edit.split('|'); flowPpcOpen(o, k); });
  on('[data-p1jour]', b => go('jour', { jsku: b.dataset.p1jour, jord: b.dataset.p1jo || '' }));
  on('[data-p1ledg]', b => go('ledger', { f: Object.assign({}, P1.f, { sku: b.dataset.p1ledg }) }));
  on('[data-p1w]', b => { P1.wseg = b.dataset.p1w; p1Draw(); });
  on('[data-p1cp]', b => { P1.cp = b.dataset.p1cp; p1Draw(); });
  on('[data-p1js]', b => { P1.jsku = obUC(b.value); P1.jord = ''; p1Draw(); }, 'onchange');
  on('[data-p1jo2]', b => { P1.jord = b.value; p1Draw(); }, 'onchange');
  on('[data-p1f]', b => { P1.f[b.dataset.p1f] = b.dataset.p1f === 'sku' ? obUC(b.value) : b.value; P1.lim = 300; p1Draw(); }, 'onchange');
  on('[data-p1fclr]', () => { P1.f = { from: '', to: '', kind: '', sku: '' }; p1Draw(); });
  on('[data-p1r]', (b, e) => { e.preventDefault(); p1Load(true); });
  const q = el.querySelector('#p1Q'); if (q) q.oninput = () => { P1.q = q.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { P1.lim = 300; p1Draw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
}
async function p1Load(force) {
  if (P1.loading) return;
  P1.loading = true; p1Draw();
  try { if (force && typeof flowLoad === 'function') await flowLoad(true); await flowEnsureData(); if (typeof QC !== 'undefined' && QC.checks == null && typeof ensureQc === 'function') await ensureQc();
    P1.built = true; P1.at = new Date().toTimeString().slice(0, 5); }
  catch (e) { P1.err = e.message || String(e); }
  finally { P1.loading = false; p1Draw(); }
}
function p1Show() {
  if (!p1May()) return;
  if (typeof frHomeHide === 'function') frHomeHide();
  const main = document.querySelector('main.main'); if (!main) return;
  main.classList.add('p1-on'); P1.shown = true;
  if ($('pageTitle')) $('pageTitle').textContent = 'PPC';
  document.querySelectorAll('.side a.nav.on').forEach(a => a.classList.remove('on'));
  if ($('tabP1')) $('tabP1').classList.add('on');
  window.scrollTo(0, 0);
  p1Draw();
  if (!P1.built) p1Load(false);
}
function p1Hide() {
  if (!P1.shown) return;
  P1.shown = false;
  const main = document.querySelector('main.main'); if (main) main.classList.remove('p1-on');
  if ($('tabP1')) $('tabP1').classList.remove('on');
}
function p1Build() {
  if (P1.wired || !document.querySelector('main.main') || !$('tabFlow')) return;
  P1.wired = true;
  const home = document.createElement('section'); home.id = 'p1Home';
  const top = document.querySelector('main.main > .topbar'); top.parentNode.insertBefore(home, top.nextSibling);
  /* the menu: in place of today's PPC link, for whoever may open the flow (no address of its own, so the browser's Back
   * and the app's hash routing never meet it) */
  const a = document.createElement('a');
  a.id = 'tabP1'; a.className = 'nav'; a.setAttribute('role', 'button'); a.style.display = 'none'; a.style.cursor = 'pointer';
  a.innerHTML = '<span class="nav-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg></span><span class="nav-t">PPC</span>';
  $('tabFlow').parentNode.insertBefore(a, $('tabFlow').nextSibling);
  a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); p1Show(); });
  /* every other screen goes through showTab: leaving this page */
  const appShowTab = showTab;
  showTab = function () { p1Hide(); return appShowTab.apply(this, arguments); };
  document.addEventListener('click', e => { const n = P1.shown && e.target.closest && e.target.closest('.side a.nav[href^="#"], #frHomeNav'); if (n) p1Hide(); }, true);
  /* My work today shown from anywhere else (the bell, a pop-up): this page steps aside */
  if (typeof frHomeShow === 'function') { const fh = frHomeShow; frHomeShow = function () { p1Hide(); return fh.apply(this, arguments); }; }
  const may = () => { a.style.display = p1May() ? '' : 'none'; };
  const t = setInterval(() => { if (ME && ME.email) { may(); clearInterval(t); } }, 1000);
}
(function p1Start(n) { if (document.querySelector('main.main') && typeof $ === 'function' && $('tabFlow')) p1Build(); else if (n > 0) setTimeout(() => p1Start(n - 1), 300); })(60);
