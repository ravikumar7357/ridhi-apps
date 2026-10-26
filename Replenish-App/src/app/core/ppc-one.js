/* ================= PPC — PLANNED BY SKU, KEPT AS A LEDGER (R-one add-on, 24 Oct) =================
 *
 * Ravi, 24 Oct: "I want a ledger like system like we had created in the greige inventory … we don't plan according to the
 * order, we plan according to the article or SKU" — and then: "add where it actually is, work in progress at which stage,
 * and worked by whom, like the greige … by whom and when … the complete journey of the product till it is sent from the
 * production … and a completed tab which tells which product was in production and when, and lets us analyse the
 * frequency of the product".
 *
 * PRODUCTION, SIMPLE (Ravi, 24 Oct: after a Greige-Inventory-style table, "not refined — easy to use, all information on
 * a page, less complex but still actionable"): one line per SKU — ordered, where its pieces are and who has them (with
 * days), due, and ONE next-step button; a stage filter across the top; a line opens the SKU's card (p1DrawInv). The
 * movement ledger is the second view, "PPC ledger".
 *
 * THE LEDGER (Ravi, 24 Oct, after a board was drawn: "I want ledger format only"; of the five-view page: "looks plain,
 * hard to act on, too confusing"). One page, like the Greige Desk's fabric ledger:
 *   - "Add a movement" — Plan, Fabric to printer, Printed back, Cut, Give to karigar, Back from karigar, QC check, Into
 *     Finished Goods — each filters the page to that step: what is waiting for it, each with the button that opens the real
 *     entry form (the PPC plan form, the fabric challan, Cutting Data, the Job Work issue and receipt, QC, Finished Goods),
 *     and under it the ledger of that step only;
 *   - every movement, newest first and grouped by day, with who and when, and the SKU's running balance;
 *   - click a SKU and its card opens right under that row (Ravi, 24 Oct: "open when I click on the sku but down there only"):
 *     its balance, where its pieces are, who has them and since when, and its next steps.
 * Planned by SKU: Plan and Fabric to printer take all of a SKU's waiting order lines together.
 * Where the steps come from: order book (order in), pt_ppc (planned, by whom), flow challans (fabric to the printer and
 * printed back), Cutting Data (cutDate · addedBy), Job Work (issueDate / receivingDate · the karigar · addedBy), QC
 * checks (date · checkedBy), press, Finished Goods ledger (createdAt · createdBy), the shipping hand-over register.
 * The old PPC link is off the menu (ppc-one.css); its screen and code stay — the Demand buttons here open it. */
const P1 = { shown: false, built: false, loading: false, q: '',
  f: { from: '', to: '', kind: '', sku: '', ord: '', party: '' }, lim: 300, at: '', openAt: -1, act: '', view: 'inv', inv: '', stage: '' };
const P1_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p1N = v => (Math.round(+v || 0)).toLocaleString('en-IN');
const p1Day = d => d ? (+String(d).slice(8, 10)) + ' ' + P1_MON[+String(d).slice(5, 7) - 1] + (String(d).slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + String(d).slice(2, 4) : '') : '—';
const p1Who = v => String(v || '').split('@')[0];
const p1Iso = v => String(ptIsoDate(v) || '').slice(0, 10);
const p1Days = d => d ? Math.max(0, Math.round((Date.now() - Date.parse(d + 'T00:00:00')) / 864e5)) : null;
const p1May = () => !!(ME && (ME.admin || (typeof flowScreenAllowed === 'function' && flowScreenAllowed().length)));
/* the movements of the ledger: label, colour class, which way the SKU's balance moves */
const P1_MV = { IN: ['Order in', 'mv-in'], PLAN: ['Planned', 'mv-plan'], BACK: ['Sent back to sales', 'mv-bad'], RFD: ['Fabric to printer', 'mv-mat'], PRN: ['Printed back', 'mv-mat'],
  CUT: ['Cut', 'mv-make'], ISS: ['Given to karigar', 'mv-make'], REC: ['Back from karigar', 'mv-make'], QC: ['QC passed', 'mv-qc'], REJ: ['QC rejected', 'mv-bad'],
  PRESS: ['Pressed', 'mv-qc'], FG: ['Into Finished Goods', 'mv-done'], FBA: ['Dispatched to FBA', 'mv-done'], SHIP: ['Handed to shipping', 'mv-done'] };
const P1_END = new Set(['FG', 'FBA', 'SHIP']);

/* ---------- reading the registers ---------- */

/** Every step on record, oldest first: { k, ms, day, orderNo, sku, pcs, unit, by, party, ref }. Cached on its sources. */
let P1_EV = { key: null, list: [], last: new Map() };
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
  /* the newest step of each kind for each line, looked up in one go (Ravi, 26 Oct: "really slow" — "since when" used to
   * search every movement again for every line) */
  const last = new Map(); out.forEach(e => last.set(e.k + '|' + e.orderNo + '|' + e.sku, e));
  P1_EV = { key: src, list: out, last };
  return out;
}

/** Every piece in production right now: { stage, sku, orderNo, pcs, unit, who, since, ref }. */
let P1_WIPC = { key: null, out: [] }, P1_INVC = { key: null, out: [] };
/** What both lists are worked out from: when none of it changes, neither does the answer. */
const p1SrcKey = () => [flowRows(), p1Events(), PT.base, typeof QC !== 'undefined' ? QC.checks : null, typeof FGI !== 'undefined' ? FGI.rows : null, FLOW.ch];
const p1Same = (a, b) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
function p1Wip() {
  const key = p1SrcKey(); if (p1Same(P1_WIPC.key, key)) return P1_WIPC.out;
  const res = p1WipBuild(); P1_WIPC = { key, out: res }; return res;
}
function p1WipBuild() {
  const out = [], rows = flowRows().filter(x => !x.r.__t && x.s.bucket !== 'done'), open = new Set(rows.map(x => obUC(x.r.orderNo) + '|' + obUC(x.r.sku)));
  p1Events(); const lastOf = (k, o, s) => P1_EV.last.get(k + '|' + o + '|' + s) || null;
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

/* ---------- the views ---------- */

/* ---------- the page: the ledger, and only the ledger (Ravi, 24 Oct: "I want ledger format only") ----------
 * Like the Greige Desk's fabric ledger: "Add a movement" buttons across the top (each opens the real entry form for a
 * line that is waiting for that step), a filter card, then every movement grouped by day with the SKU's running balance.
 * Pick a SKU (click it anywhere) and a card above the ledger shows its balance, where its pieces are and who has them. */
const p1Mv = e => `<span class="pl ${P1_MV[e.k][1]}">${P1_MV[e.k][0]}</span>`;
const P1_ADD = [
  ['PLAN', 'Plan', 'flppc', x => x.s.bucket === 'ppc'],
  ['RFD', 'Fabric to printer', 'fldem', x => x.s.needFab && x.s.route !== 'stitch'],
  ['PRN', 'Printed back', 'flchl', x => x.s.printed && x.s.given > 0 && x.s.back < (+x.r.qty || 0)],
  ['CUT', 'Cut', 'pcut', x => x.s.canCut > 0 && ['cut', 'fabric', 'emb'].includes(x.s.bucket)],
  ['ISS', 'Give to karigar', 'pbase', x => typeof flowIssuable === 'function' && flowIssuable(x.r, x.s) > 0 && !['ppc', 'back', 'demand', 'vendor'].includes(x.s.bucket)],
  ['REC', 'Back from karigar', 'pbase', x => p1OpenIss(x.r).length > 0],
  ['QC', 'QC check', 'qc', x => { try { return flowQcWaiting(x.r, x.s) > 0; } catch (e) { return false; } }],
  ['FG', 'Into Finished Goods', 'fgi', x => x.s.bucket === 'fgin']];
/** The Job Work issues still out with a karigar, per order line — indexed once (flowOpenIssues walks the whole register
 *  for every line, which on the real register made the page crawl). */
let P1_ISS = { src: null, n: -1, map: new Map() };
function p1OpenIss(r) {
  const src = PT.base || [];
  if (P1_ISS.src !== src || P1_ISS.n !== src.length) {
    const map = new Map();
    src.forEach(b => { if (!b || b.frozen || !(ptNum(b.issuePieces) - ptNum(b.receivedPieces) - ptNum(b.rejectionPieces) > 0)) return;
      const k = obUC(b.orderNo) + '|' + obUC(b.sku); (map.get(k) || map.set(k, []).get(k)).push(b); });
    P1_ISS = { src, n: src.length, map };
  }
  return P1_ISS.map.get(obUC(r.orderNo) + '|' + obUC(r.sku)) || [];
}
const p1MayTab = t => !!(ME && (ME.admin || (ME.tabs || []).includes(t)));
function p1Waiting(k) { const a = P1_ADD.find(x => x[0] === k); return a ? flowRows().filter(x => !x.r.__t && x.s.bucket !== 'done' && a[3](x)) : []; }

/** "Add a movement" (Ravi, 24 Oct: "instead of showing me this [a list in a box] filter out the list and only show what I
 *  am clicking at"): a button filters the page to that step — what is waiting for it, each with the button that opens
 *  its real entry form, and below, the ledger of that step only. Plan and fabric go SKU by SKU; the rest line by line. */
function p1Groups(k, sku) {
  const ws = p1Waiting(k).filter(x => !sku || obUC(x.r.sku) === sku);
  return k === 'PLAN' || k === 'RFD' ? [...ws.reduce((m, x) => { const s = obUC(x.r.sku); (m.get(s) || m.set(s, []).get(s)).push(x); return m; }, new Map())] : ws.map(x => [obUC(x.r.sku), [x]]);
}
function p1Pcs(k, x) {
  if (k === 'CUT') return x.s.canCut;
  if (k === 'ISS') return flowIssuable(x.r, x.s);
  if (k === 'REC') return p1OpenIss(x.r).reduce((t, b) => t + ptNum(b.issuePieces) - ptNum(b.receivedPieces) - ptNum(b.rejectionPieces), 0);
  if (k === 'QC') { try { return flowQcWaiting(x.r, x.s); } catch (e) { return 0; } }
  if (k === 'PRN') return Math.max(0, (+x.r.qty || 0) - x.s.back);
  if (k === 'FG') return Math.max(0, x.s.made - x.s.india);
  return +x.r.qty || 0;
}
const P1_DO = { PLAN: 'Plan', RFD: 'Make challan', PRN: 'Receive', CUT: 'Enter cutting', ISS: 'Issue', REC: 'Receive', QC: 'Check in QC', FG: 'Accept' };
/** The real entry form for one waiting group. */
function p1Do(k, xs) {
  const x = xs[0], leave = fn => { p1Hide(); setTimeout(fn, 30); };
  if (k === 'PLAN') flowPpcOpen(null, null, xs.map(y => y.s.key));
  else if (k === 'RFD') flowChallanForKeys(xs.map(y => y.s.key));
  else if (k === 'CUT') leave(() => flowCutEntry(x.r, x.s));
  else if (k === 'ISS') leave(() => flowIssueEntry(x.r, x.s));
  else if (k === 'REC') flowRecvEntry(x.r);
  else if (k === 'QC') leave(() => showTab('qc'));
  else if (k === 'FG') leave(() => { if (typeof frFgView === 'function') frFgView('pending'); else showTab('fgi'); });
  else if (k === 'PRN') leave(() => { FLOW_VIEW = 'dhist'; showTab('flow'); });
}
/** What is waiting for the chosen step, on the page itself. */
function p1WaitCard(k) {
  const a = P1_ADD.find(x => x[0] === k), q = P1.q.trim().toUpperCase();
  const gs = P1.groups = p1Groups(k, P1.f.sku).filter(([s, xs]) => !q || (s + ' ' + xs.map(x => x.r.orderNo).join(' ')).toUpperCase().includes(q));
  const who = xs => k === 'REC' ? p1OpenIss(xs[0].r).map(b => b.empName).join(', ') : (xs[0].s.plan && xs[0].s.plan.printer) || '';
  const tot = gs.reduce((t, [, xs]) => t + xs.reduce((u, x) => u + p1Pcs(k, x), 0), 0);
  return `<div class="lg-card lg-wait"><div class="lg-cap lg-waith"><span class="pl ${P1_MV[k][1]}">${esc(a[1])}</span><b>${p1N(gs.length)}</b> ${k === 'PLAN' || k === 'RFD' ? 'SKUs' : 'lines'} waiting · <b>${p1N(tot)}</b> pcs${P1.f.sku ? ' · ' + esc(P1.f.sku) : ''}
      <span style="margin-left:auto;color:var(--muted)">Below: the ledger of this step only</span><button type="button" class="lg-go sm" data-p1act-off>× Show everything</button></div>
    <div class="lg-scroll" style="max-height:46vh"><table class="lg-t"><thead><tr><th>SKU</th><th>Orders</th><th>${k === 'REC' ? 'Karigar' : 'Printer'}</th><th class="num">Pcs</th><th></th></tr></thead><tbody>
    ${gs.slice(0, 400).map(([s, xs], i) => `<tr><td><b>${esc(s)}</b><div class="sub">${esc([xs[0].r.articleSubtype || xs[0].r.articleType || xs[0].r.itemName, xs[0].r.color, xs[0].r.size].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(xs.map(x => x.r.orderNo).join(', '))}</td><td>${esc(who(xs)) || '<span class="muted">—</span>'}</td><td class="num"><b>${p1N(xs.reduce((u, x) => u + p1Pcs(k, x), 0))}</b></td>
      <td style="text-align:right">${p1MayTab(a[2]) ? `<button type="button" class="lg-yes" data-p1do="${i}">${P1_DO[k]}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">Nothing is waiting for ${esc(a[1].toLowerCase())}${P1.f.sku ? ' on ' + esc(P1.f.sku) : ''}.</td></tr>`}
    </tbody></table></div></div>`;
}

/** The SKU's card above the ledger: its balance, where its pieces are and who has them, and its next steps. */
function p1SkuCard(sku, ev) {
  const mine = ev.filter(e => e.sku === sku && e.unit !== 'm'), sum = ks => mine.filter(e => ks.includes(e.k)).reduce((t, e) => t + e.pcs, 0);
  const rows = flowRows().filter(x => !x.r.__t && obUC(x.r.sku) === sku && x.s.bucket !== 'done');
  const np = rows.filter(x => x.s.bucket === 'ppc' || x.s.bucket === 'back').reduce((t, x) => t + (+x.r.qty || 0), 0);
  const mk = rows.filter(x => !['ppc', 'back'].includes(x.s.bucket)).reduce((t, x) => t + Math.max(0, (+x.r.qty || 0) - x.s.qc), 0);
  const rd = rows.reduce((t, x) => t + Math.max(0, Math.min(+x.r.qty || 0, x.s.qc) - x.s.india), 0);
  const wip = p1Wip().filter(w => w.sku === sku), what = rows[0] ? [rows[0].r.articleSubtype || rows[0].r.articleType || rows[0].r.itemName, rows[0].r.color, rows[0].r.size].filter(Boolean).join(' · ') : '';
  const fg = typeof fgiOf === 'function' ? Math.max(0, fgiOf(sku).current || 0) : 0;
  const acts = P1_ADD.filter(a => p1MayTab(a[2]) && rows.some(x => a[3](x)));
  return `<div class="lg-card lg-skucard"><div class="sk-h"><div><div class="sk-crumb">SKU</div><h2>${esc(sku)}</h2><div class="muted">${esc(what)}${rows.length ? ' · ' + new Set(rows.map(x => x.r.orderNo)).size + ' open order(s)' : ''}</div></div>
      <span style="display:flex;gap:8px">${P1.f.sku === sku ? '' : `<button type="button" class="lg-go" data-p1only="${esc(sku)}">Only this SKU in the ledger</button>`}<button type="button" class="lg-go" data-p1close>× Close</button></span></div>
    <div class="sk-tiles">${[['Ordered (all time)', sum(['IN']), ''], ['Not planned', np, 'var(--bad)'], ['In production', mk, ''], ['Passed QC, not in FG', rd, 'var(--accent)'], ['Finished Goods in store', fg, ''], ['Sent from production', sum(['FBA', 'SHIP']), 'var(--accent)']]
      .map(t => `<div><b style="${t[2] ? 'color:' + t[2] : ''}">${p1N(t[1])}</b><span>${t[0]}</span></div>`).join('')}</div>
    <div class="sk-row"><div class="sk-where"><div class="lg-h">Where it is now — and who has it</div>${wip.map(w => { const d = p1Days(w.since);
        return `<div class="lg-mv"><span class="pl mv-make">${esc(w.stage)}</span><b>${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</b><span>${esc(w.who)}</span><span class="muted">${esc(w.orderNo)}</span><span class="muted" style="margin-left:auto${d != null && d > 7 ? ';color:var(--bad);font-weight:700' : ''}">${w.since ? p1Day(w.since) + ' · ' + d + ' d' : ''}</span></div>`; }).join('') || '<div class="muted">Nothing of it is in production now.</div>'}</div>
      ${acts.length ? `<div class="sk-acts"><div class="lg-h">Next for this SKU</div>${acts.map(a => `<button type="button" class="lg-yes" data-p1add="${a[0]}" data-p1add-sku="${esc(sku)}">${esc(a[1])}</button>`).join('')}</div>` : ''}</div></div>`;
}

/* ---------- PRODUCTION: the open lines, SKU by SKU ---------- */
const p1Art = r => String(r.articleType || String(r.articleSubtype || r.itemName || '').split(/\s+/)[0] || 'Other').trim() || 'Other';
/** The open lines, SKU by SKU, with what sits in each column. */
function p1Inv() {
  const key = p1SrcKey(); if (p1Same(P1_INVC.key, key)) return P1_INVC.out;
  const res = p1InvBuild(); P1_INVC = { key, out: res }; return res;
}
function p1InvBuild() {
  let rc = { line: {} }; try { rc = flowRfdCover(); } catch (e) { /* not loaded */ }
  const by = new Map();
  flowRows().forEach(x => {
    if (x.r.__t || x.s.bucket === 'done') return;
    const k = obUC(x.r.sku), q = +x.r.qty || 0, s = x.s;
    const e = by.get(k) || { sku: k, art: p1Art(x.r), what: [x.r.articleSubtype || x.r.articleType || x.r.itemName, x.r.color, x.r.size].filter(Boolean).join(' · '), lines: [], orders: new Set(),
      ordered: 0, notPlanned: 0, short: 0, fab: 0, fabM: 0, cut: 0, raw: 0, kar: 0, qc: 0, ready: 0, isNew: false };
    e.lines.push(x); e.orders.add(x.r.orderNo); e.ordered += q;
    if (s.bucket === 'ppc' || s.bucket === 'back') e.notPlanned += q;
    if (s.bucket === 'ppc' && x.recent) e.isNew = true;
    const f = rc.line[s.key]; if (f && f.short > 0) e.short += f.short;
    if (s.needFab || s.bucket === 'vendor' || (s.printed && s.given > 0 && s.back < q)) e.fab += s.needFab || s.bucket === 'vendor' ? q : Math.max(0, q - s.back);
    if (s.canCut > 0 && ['cut', 'fabric', 'emb'].includes(s.bucket)) e.cut += s.canCut;
    if (typeof flowIssuable === 'function' && !['ppc', 'back', 'demand', 'vendor'].includes(s.bucket)) e.raw += flowIssuable(x.r, s);
    try { e.qc += flowQcWaiting(x.r, s) + flowQcLine(x.r).altOpen + flowQcLine(x.r).deptOpen; } catch (err) { /* QC not read */ }
    if (s.bucket === 'fgin') e.ready += Math.max(0, s.made - s.india); else if (s.bucket === 'ship') e.ready += q;
    by.set(k, e);
  });
  (PT.base || []).forEach(b => { if (!b || b.frozen) return; const e = by.get(obUC(b.sku)); if (!e || !e.orders.has(obUC(b.orderNo))) return;
    e.kar += Math.max(0, ptNum(b.issuePieces) - ptNum(b.receivedPieces) - ptNum(b.rejectionPieces)); });
  /* Finished Goods stock: the whole ledger added up once, not once per SKU (fgiOf re-adds all of it every call) */
  let fgs = null; try { fgs = typeof fgiStock === 'function' ? fgiStock() : null; } catch (err) { fgs = null; }
  return [...by.values()].map(e => Object.assign(e, { fg: fgs && fgs.get(e.sku) ? Math.max(0, fgs.get(e.sku).current || 0) : 0, tot: e.fab + e.cut + e.raw + e.kar + e.qc + e.ready }))
    .sort((a, b) => (b.notPlanned > 0) - (a.notPlanned > 0) || b.tot - a.tot || b.ordered - a.ordered || a.sku.localeCompare(b.sku));
}
/* ---------- PRODUCTION, SIMPLE (Ravi, 24 Oct: "it's not refined — make it refined, easy to use, with all information on
 * a page, and less complex but still actionable") ----------
 * One line per SKU and four things on it: what is ordered, where its pieces are right now and who has them (with days),
 * when it is due, and ONE button — its next step. A filter of stages across the top. Click a line for the SKU's card
 * (its figures, every place it is, every next step) under it. */
const P1_STEPS = [['plan', 'To plan', 'PLAN'], ['fab', 'Fabric & printer', 'RFD'], ['cut', 'Cutting', 'CUT'], ['kar', 'With karigars', 'REC'], ['qc', 'QC', 'QC'], ['ready', 'Ready', 'FG']];
const P1_STAGE_OF = { Printer: 'fab', Embroidery: 'fab', Cutting: 'cut', 'Raw cutting in store': 'cut', 'With karigar': 'kar', QC: 'qc', 'Finished Goods to accept': 'ready', 'To hand to shipping': 'ready' };
const P1_STAGE_INK = { fab: ['#EEEAFB', '#5B3FD0'], cut: ['#FFF3D6', '#8A5A12'], kar: ['#FDECE2', '#9A4B16'], qc: ['#E3F4F1', '#1F6F5C'], ready: ['#EDF0E7', '#4A5A3C'] };
/** The one next step of a SKU: the first that is waiting, in the order the work goes — [movement, label, lines]. */
function p1NextOf(r) {
  const n = k => { const a = P1_ADD.find(x => x[0] === k); return a && p1MayTab(a[2]) ? r.lines.filter(x => a[3](x)) : []; };
  for (const [k, label] of [['PLAN', 'Plan'], ['RFD', 'Make challan'], ['PRN', 'Receive printed'], ['CUT', 'Enter cutting'], ['ISS', 'Give to karigar'], ['REC', 'Receive from karigar'], ['QC', 'Check in QC'], ['FG', 'Accept in FG']]) {
    const ls = n(k); if (ls.length) return [k, label, ls];
  }
  return null;
}
function p1DrawInv() {
  const el = $('p1Home');
  let all = [], wip = [];
  try { all = p1Inv(); wip = p1Wip(); } catch (e) { el.innerHTML = `<div class="p1-head"><h1 class="lm-h">PPC</h1></div><div class="card"><div class="empty" style="color:var(--bad)">Could not read the lines: ${esc(e.message || e)}</div></div>`; return; }
  const holds = new Map(); wip.forEach(w => { (holds.get(w.sku) || holds.set(w.sku, []).get(w.sku)).push(w); });
  all.forEach(r => { r.holds = (holds.get(r.sku) || []).sort((a, b) => String(a.since || '9').localeCompare(String(b.since || '9')));
    r.stages = new Set(r.holds.map(w => P1_STAGE_OF[w.stage]).filter(Boolean)); if (r.notPlanned) r.stages.add('plan');
    r.next = p1NextOf(r); r.late = r.holds.some(w => (p1Days(w.since) || 0) > 7);
    r.due = r.lines.map(x => String((x.s.plan && x.s.plan.dates && x.s.plan.dates.ready) || x.r.mtoDue || '')).filter(Boolean).sort()[0] || ''; });
  const q = P1.q.trim().toUpperCase();
  const rows = all.filter(r => (!P1.stage || r.stages.has(P1.stage)) && (!q || (r.sku + ' ' + r.what + ' ' + [...r.orders].join(' ') + ' ' + r.holds.map(w => w.who).join(' ')).toUpperCase().includes(q)))
    .sort((a, b) => (b.late - a.late) || String(a.due || '9').localeCompare(String(b.due || '9')) || b.ordered - a.ordered);
  const shown = rows.slice(0, P1.lim), today = new Date().toISOString().slice(0, 10), ev = p1Events();
  const chip = w => { const st = P1_STAGE_OF[w.stage] || 'cut', c = P1_STAGE_INK[st], d = p1Days(w.since);
    return `<span class="hold${d != null && d > 7 ? ' late' : ''}" style="background:${c[0]};color:${c[1]}"><b>${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</b> ${esc(w.stage === 'With karigar' ? w.who : w.stage === 'Printer' ? w.who : w.stage)}${d != null ? ` · ${d}d` : ''}</span>`; };
  el.innerHTML = `<div class="p1-head"><h1 class="lm-h">PPC</h1>${p1ViewSeg()}<input type="search" class="p1-q" id="p1Q" placeholder="Search SKU, order, karigar, printer…" value="${esc(P1.q)}"></div>
    <div class="p1-stages"><button type="button" class="st${!P1.stage ? ' on' : ''}" data-p1st=""><b>${p1N(all.length)}</b><span>All SKUs</span></button>${P1_STEPS.map(s => { const n = all.filter(r => r.stages.has(s[0])).length;
      return `<button type="button" class="st${P1.stage === s[0] ? ' on' : ''}" data-p1st="${s[0]}"><b>${p1N(n)}</b><span>${esc(s[1])}</span></button>`; }).join('')}
      <span class="p1-read">${P1.loading ? 'Reading…' : 'Read ' + (P1.at || '—')} · <a data-p1r>↻ Refresh</a></span></div>
    <div class="card p1-list"><table class="p1t"><thead><tr><th>SKU</th><th>Orders</th><th>Where it is now — and who has it</th><th>Due</th><th>Next step</th></tr></thead><tbody>
    ${shown.map(r => { const open = P1.inv === r.sku, nx = r.next, more = r.holds.length - 4;
      return `<tr class="p1r${open ? ' open' : ''}${r.late ? ' late' : ''}" data-p1row="${esc(r.sku)}">
        <td><b class="sku">${esc(r.sku)}</b>${r.isNew ? ' <span class="pill-new">NEW</span>' : ''}<div class="muted sm">${esc(r.what)}</div></td>
        <td class="ord"><b>${p1N(r.ordered)}</b> pcs · ${r.orders.size} order${r.orders.size > 1 ? 's' : ''}<div class="sm">${r.notPlanned ? `<span style="color:var(--bad);font-weight:700">${p1N(r.notPlanned)} not planned</span>` : '<span style="color:var(--accent)">all planned</span>'}${r.fg ? ` · <span class="muted">${p1N(r.fg)} in FG</span>` : ''}</div></td>
        <td class="where">${r.holds.slice(0, 4).map(chip).join('')}${more > 0 ? `<span class="muted sm">+${more} more</span>` : ''}${!r.holds.length ? `<span class="muted sm">${r.notPlanned ? 'not started' : '—'}</span>` : ''}</td>
        <td class="due${r.due && r.due < today ? ' over' : ''}">${r.due ? p1Day(r.due) : '<span class="muted">—</span>'}</td>
        <td class="nx">${nx ? `<button type="button" class="p1-go" data-p1next="${esc(r.sku)}">${esc(nx[1])}${nx[0] === 'PLAN' ? ' · ' + p1N(nx[2].reduce((t, x) => t + (+x.r.qty || 0), 0)) : ''}</button>` : '<span class="muted sm">nothing waiting</span>'}</td></tr>
        ${open ? `<tr class="p1x"><td colspan="5">${p1SkuCard(r.sku, ev)}</td></tr>` : ''}`; }).join('') || `<tr><td colspan="5" class="empty">Nothing here.</td></tr>`}
    </tbody></table>${rows.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show all ${p1N(rows.length)} SKUs</button>` : ''}</div>`;
  const on = (sel, fn, ev2 = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev2] = e => fn(b, e); });
  const R = sku => all.find(r => r.sku === sku);
  on('[data-p1st]', b => { P1.stage = b.dataset.p1st; P1.inv = ''; P1.lim = 300; p1Draw(); });
  on('[data-p1row]', (b, e) => { if (e.target.closest('button')) return; P1.inv = P1.inv === b.dataset.p1row ? '' : b.dataset.p1row; p1Draw(); });
  on('[data-p1next]', b => { const r = R(b.dataset.p1next), nx = r && r.next; if (!nx) return;
    if (nx[0] === 'PLAN' || nx[0] === 'RFD' || nx[2].length === 1 || ['QC', 'FG', 'PRN'].includes(nx[0])) return p1Do(nx[0], nx[2]);
    P1.inv = r.sku; p1Draw(); });                                    // several lines for one step: the SKU's card, each line there
  /* the SKU card's own buttons */
  on('[data-p1add]', b => { const k = b.dataset.p1add, sku = b.dataset.p1addSku || '', gs = p1Groups(k, sku);
    if (gs.length) p1Do(k, k === 'PLAN' || k === 'RFD' ? gs.reduce((a, g) => a.concat(g[1]), []) : gs[0][1]); });
  on('[data-p1close]', () => { P1.inv = ''; p1Draw(); });
  on('[data-p1only]', b => { P1.view = 'ledger'; P1.f.sku = b.dataset.p1only; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1view]', b => { P1.view = b.dataset.p1view; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1lim]', () => { P1.lim += 700; p1Draw(); });
  on('[data-p1r]', (b, e) => { e.preventDefault(); p1Load(true); });
  const qi = el.querySelector('#p1Q'); if (qi) qi.oninput = () => { P1.q = qi.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { P1.lim = 300; p1Draw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
}

const p1ViewSeg = () => `<div class="seg p1-views">${[['inv', 'Production'], ['ledger', 'PPC ledger']].map(v => `<button type="button" class="segbtn${P1.view === v[0] ? ' on' : ''}" data-p1view="${v[0]}">${v[1]}</button>`).join('')}</div>`;

function p1Draw() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="p1-head"><h1 class="lm-h">PPC</h1><span class="muted">Reading the order book, plans and registers…</span></div>'; return; }
  if (P1.view === 'ledger') p1DrawLedger(); else p1DrawInv();
}
function p1DrawLedger() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="lg-top"><h1>PPC ledger</h1><span class="lg-note">Reading the order book, plans and registers…</span></div>'; return; }
  let ev = [];
  try { ev = p1Events(); } catch (e) { el.innerHTML = `<div class="lg-top"><h1>PPC ledger</h1></div><div class="lg-card"><div class="empty" style="color:var(--bad)">Could not read the registers: ${esc(e.message || e)}</div></div>`; return; }
  const f = P1.f, q = P1.q.trim().toUpperCase();
  /* the SKU's balance after each step: not planned (ordered, no plan yet), in production (planned, not passed QC), ready (passed, not gone) */
  const bal = {}, after = new Array(ev.length);
  ev.forEach((e, i) => { if (e.unit === 'm') { after[i] = null; return; } const b = bal[e.sku] || (bal[e.sku] = { np: 0, mk: 0, rd: 0 });
    if (e.k === 'IN') b.np += e.pcs; else if (e.k === 'BACK') b.np -= e.pcs; else if (e.k === 'PLAN') { b.np -= e.pcs; b.mk += e.pcs; }
    else if (e.k === 'QC') { b.mk -= e.pcs; b.rd += e.pcs; } else if (P1_END.has(e.k)) b.rd -= e.pcs;
    after[i] = { np: Math.max(0, b.np), mk: Math.max(0, b.mk), rd: Math.max(0, b.rd) }; });
  const idx = [];
  for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i];
    if ((f.kind && e.k !== f.kind) || (f.sku && e.sku !== f.sku) || (f.ord && e.orderNo !== f.ord) || (f.from && e.day < f.from) || (f.to && e.day > f.to)) continue;
    if (f.party && !(e.party + ' ' + e.by).toUpperCase().includes(f.party.toUpperCase())) continue;
    if (q && !(e.sku + ' ' + e.orderNo + ' ' + e.party + ' ' + e.by + ' ' + e.ref).toUpperCase().includes(q)) continue;
    idx.push(i); }
  const inP = idx.reduce((a, i) => a + (ev[i].k === 'IN' ? ev[i].pcs : 0), 0), outP = idx.reduce((a, i) => a + (P1_END.has(ev[i].k) ? ev[i].pcs : 0), 0);
  const shown = idx.slice(0, P1.lim);
  const perDay = new Map(); idx.forEach(j => perDay.set(ev[j].day, (perDay.get(ev[j].day) || 0) + 1));
  let lastDay = '', body = '';
  shown.forEach(i => { const e = ev[i], b = after[i], sign = e.k === 'IN' ? '+' : P1_END.has(e.k) || e.k === 'BACK' ? '−' : '';
    if (e.day !== lastDay) { lastDay = e.day; const dayN = perDay.get(e.day) || 0;
      body += `<tr class="lg-day"><td colspan="11"><b>${e.day ? new Date(e.day + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'No date'}</b><span>${dayN} movement${dayN > 1 ? 's' : ''}</span></td></tr>`; }
    body += `<tr><td class="nw muted">${e.t ? new Date(e.ms).toTimeString().slice(0, 5) : ''}</td><td><a class="lg-sku${P1.openAt === i ? ' on' : ''}" data-p1sku="${esc(e.sku)}" data-p1at="${i}">${esc(e.sku)}</a></td><td>${e.orderNo ? `<a class="lg-ord" data-p1ord="${esc(e.orderNo)}">${esc(e.orderNo)}</a>` : '<span class="muted">—</span>'}</td><td>${p1Mv(e)}</td>
      <td class="num"><b class="${sign === '+' ? 'q-in' : sign === '−' ? 'q-out' : ''}">${sign}${p1N(e.pcs)}</b>${e.unit === 'm' ? ' m' : ''}</td><td>${e.party ? esc(e.party) : '<span class="muted">—</span>'}</td><td class="muted">${esc(e.ref)}</td><td>${e.by ? `<span class="av">${esc(e.by.slice(0, 2).toUpperCase())}</span> ${esc(e.by)}` : '<span class="muted">—</span>'}</td>
      ${b ? `<td class="num bal">${p1N(b.np)}</td><td class="num bal">${p1N(b.mk)}</td><td class="num bal">${p1N(b.rd)}</td>` : '<td class="bal" colspan="3"></td>'}</tr>`;
    if (P1.openAt === i) body += `<tr class="lg-exp"><td colspan="11">${p1SkuCard(e.sku, ev)}</td></tr>`; });
  const skus = [...new Set(ev.map(e => e.sku))].sort(), today = new Date().toISOString().slice(0, 10), ago = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const range = [['Today', today, today], ['7 days', ago(7), ''], ['30 days', ago(30), ''], ['All', '', '']];
  el.innerHTML = `<div class="lg-top">${p1ViewSeg()}<div><h1>PPC ledger</h1><div class="lg-note" style="margin:2px 0 0">Every step of every SKU — from the order coming in to leaving production — with who did it and when.</div></div>
      <input class="lg-q" id="p1Q" placeholder="Search SKU, order, karigar, printer, person…" value="${esc(P1.q)}"><span class="lg-when">${P1.loading ? 'Reading…' : 'Read ' + (P1.at || '—')} · <a data-p1r>↻ Refresh</a></span></div>
    <div class="lg-addrow"><span class="lg-note" style="margin:0">Add a movement:</span>${P1_ADD.filter(a => p1MayTab(a[2])).map(a => { const n = ['QC', 'FG', 'PRN'].includes(a[0]) ? p1Waiting(a[0]).length : new Set(p1Waiting(a[0]).map(x => a[0] === 'PLAN' || a[0] === 'RFD' ? obUC(x.r.sku) : x.s.key)).size;
      return `<button type="button" class="lg-add${P1.act === a[0] ? ' on' : ''}" data-p1add="${a[0]}"><span class="pl ${P1_MV[a[0]][1]}" style="padding:0 6px">+</span>${esc(a[1])}${n ? ` <i>${p1N(n)}</i>` : ''}</button>`; }).join('')}</div>
    ${P1.act ? p1WaitCard(P1.act) : ''}
    <div class="lg-card lg-filt"><div class="lg-range">${range.map(r => `<button type="button" class="${f.from === r[1] && f.to === r[2] ? 'on' : ''}" data-p1rg="${r[1]}|${r[2]}">${r[0]}</button>`).join('')}</div>
      <label>From<input type="date" data-p1f="from" value="${f.from}"></label><label>To<input type="date" data-p1f="to" value="${f.to}"></label>
      <label>Movement<select data-p1f="kind"><option value="">All</option>${Object.entries(P1_MV).map(([k, v]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <label>SKU<input list="p1Skl2" data-p1f="sku" value="${esc(f.sku)}" placeholder="All" style="width:170px"></label><datalist id="p1Skl2">${skus.slice(0, 3000).map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Order<input data-p1f="ord" value="${esc(f.ord || '')}" placeholder="All" style="width:130px"></label>
      <label>Karigar / printer / person<input data-p1f="party" value="${esc(f.party || '')}" placeholder="All" style="width:150px"></label>
      ${f.from || f.to || f.kind || f.sku || f.ord || f.party ? '<button type="button" class="lg-go" data-p1fclr>Clear the filter</button>' : ''}</div>
    <div class="lg-card"><div class="lg-cap"><b>${p1N(idx.length)}</b> of ${p1N(ev.length)} movements · <b class="q-in">+${p1N(inP)}</b> pcs ordered in · <b class="q-out">−${p1N(outP)}</b> pcs sent from production.
      The three right-hand columns are the SKU's balance after each step. Nothing here is a stored total — every figure is read from the registers.</div>
    <div class="lg-scroll"><table class="lg-t"><thead><tr><th>Time</th><th>SKU</th><th>Order</th><th>Movement</th><th class="num">Qty</th><th>Party</th><th>Reference</th><th>By</th><th class="num">Not planned</th><th class="num">In production</th><th class="num">Ready</th></tr></thead><tbody>
    ${body || '<tr><td colspan="11" class="empty">No movement matches the filter.</td></tr>'}</tbody></table></div>
    ${idx.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show ${p1N(Math.min(idx.length, P1.lim + 700) - P1.lim)} more</button>` : ''}</div>`;
  p1Wire(el);
}
function p1Wire(el) {
  const on = (sel, fn, ev = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev] = e => fn(b, e); });
  const redraw = () => { P1.lim = 300; P1.openAt = -1; p1Draw(); };
  on('[data-p1view]', b => { P1.view = b.dataset.p1view; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1add]', b => { const k = b.dataset.p1add, sku = b.dataset.p1addSku || '';
    if (sku) { const gs = p1Groups(k, sku); if (gs.length === 1) return p1Do(k, gs[0][1]); P1.f.sku = sku; P1.act = k; }   // the SKU card: straight to the form when there is one line
    else P1.act = P1.act === k ? '' : k;
    P1.f.kind = P1.act; P1.lim = 300; P1.openAt = -1; p1Draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  on('[data-p1act-off]', () => { P1.act = ''; P1.f.kind = ''; redraw(); });
  on('[data-p1do]', b => { const g = (P1.groups || [])[+b.dataset.p1do]; if (g) p1Do(P1.act, g[1]); });
  on('[data-p1sku]', b => { const i = +b.dataset.p1at; P1.openAt = P1.openAt === i ? -1 : i; p1Draw(); });   // the card opens under this row; the ledger stays as it is
  on('[data-p1ord]', b => { P1.f.ord = b.dataset.p1ord; redraw(); });
  on('[data-p1close]', () => { P1.openAt = -1; p1Draw(); });
  on('[data-p1only]', b => { P1.f.sku = b.dataset.p1only; P1.openAt = -1; redraw(); });
  on('[data-p1rg]', b => { const [a, z] = b.dataset.p1rg.split('|'); P1.f.from = a; P1.f.to = z; redraw(); });
  on('[data-p1f]', b => { const k = b.dataset.p1f; P1.f[k] = k === 'sku' || k === 'ord' ? obUC(b.value) : b.value; redraw(); }, 'onchange');
  on('[data-p1fclr]', () => { P1.f = { from: '', to: '', kind: '', sku: '', ord: '', party: '' }; P1.act = ''; redraw(); });
  on('[data-p1lim]', () => { P1.lim += 700; p1Draw(); });
  on('[data-p1r]', (b, e) => { e.preventDefault(); p1Load(true); });
  const q = el.querySelector('#p1Q'); if (q) q.oninput = () => { P1.q = q.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { redraw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
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
  /* a form opened from here (plan, challan, receipt) saved: the ledger reads the registers again */
  const dlg = $('ptDlg'); if (dlg && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (P1.shown && dlg.classList.contains('hide')) setTimeout(p1Draw, 300); }).observe(dlg, { attributes: true, attributeFilter: ['class'] });
  const may = () => { a.style.display = p1May() ? '' : 'none'; };
  const t = setInterval(() => { if (ME && ME.email) { may(); clearInterval(t); } }, 1000);
}
(function p1Start(n) { if (document.querySelector('main.main') && typeof $ === 'function' && $('tabFlow')) p1Build(); else if (n > 0) setTimeout(() => p1Start(n - 1), 300); })(60);
