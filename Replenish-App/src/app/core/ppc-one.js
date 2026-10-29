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
  f: { from: '', to: '', kind: '', lot: '', sku: '', ord: '', party: '' }, lim: 300, at: '', openAt: '', act: '', view: 'inv', inv: '', stage: '' };
const P1_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p1N = v => (Math.round(+v || 0)).toLocaleString('en-IN');
const p1Day = d => d ? (+String(d).slice(8, 10)) + ' ' + P1_MON[+String(d).slice(5, 7) - 1] + (String(d).slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + String(d).slice(2, 4) : '') : '—';
const p1Who = v => String(v || '').split('@')[0];
const p1Iso = v => String(ptIsoDate(v) || '').slice(0, 10);
const p1Days = d => d ? Math.max(0, Math.round((Date.now() - Date.parse(d + 'T00:00:00')) / 864e5)) : null;
/** A printer as the plan keeps it — { code, name } — or a plain name (review, 26 Oct: it showed as "[object Object]"). */
const p1Pr = v => (v && typeof v === 'object' ? (v.name || v.code || '') : String(v || '')).trim();
/** Today's date as the clock on the wall says it (toISOString is UTC: from midnight to 5:30 it said yesterday). */
const p1Local = (ms = Date.now()) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const p1May = () => !!(ME && (ME.admin || (typeof flowScreenAllowed === 'function' && flowScreenAllowed().length)));
/* the movements of the ledger: label, colour class, which way the SKU's balance moves */
const P1_MV = { IN: ['Order in', 'mv-in'], PLAN: ['Planned', 'mv-plan'], BACK: ['Sent back to sales', 'mv-bad'], RFD: ['Fabric to printer', 'mv-mat'], PRN: ['Printed back', 'mv-mat'],
  CUT: ['Cut', 'mv-make'], ISS: ['Given to karigar', 'mv-make'], REC: ['Back from karigar', 'mv-make'], QC: ['QC passed', 'mv-qc'], REJ: ['QC rejected', 'mv-bad'],
  PRESS: ['Pressed', 'mv-qc'], FG: ['Into Finished Goods', 'mv-done'], FBA: ['Dispatched to FBA', 'mv-done'], SHIP: ['Handed to shipping', 'mv-done'] };
/* leaving production: into Finished Goods, or handed to shipping. A dispatch to FBA leaves Finished Goods, not production —
 * counting it too took the same pieces off twice (review, 26 Oct). */
const P1_END = new Set(['FG', 'SHIP']);

/* ---------- reading the registers ---------- */

/* ---------- PRODUCTION LOTS (Ravi, 28 Oct: "from the month starting the list will start as 001, and if the product
 * article is to start from greige its production lot will be 001-GR, if planned from cutting 001-CT and so on") ----------
 * One lot = one SKU's plan as it was saved (the orders planned together for it). Numbered 001, 002… from the 1st of each
 * month, in the order the plans were first saved; the ending says where production starts: GR from greige (Printing,
 * Printing + Embroidery, Quilt), CT cutting, JW Job Work, OS outsourced. A plan keeps the time it was first saved (lotAt,
 * written by flow-ppc.js) so a re-plan keeps its number. Worked out from the plans, nothing else stored: a plan deleted
 * earlier in the same month moves the later numbers of that month down by one. */
const P1_LOT_END = { inhouse: 'GR', emb: 'GR', quilt: 'GR', stitch: 'CT', jobwork: 'JW', outsource: 'OS' };
const P1_LOT_FROM = { GR: 'Greige', CT: 'Cutting', JW: 'Job Work', OS: 'Outsourced' };
let P1_LOTC = { key: null, byLine: new Map(), list: [] };
function p1Lots() {
  const src = FLOW.ppc || {}, key = [src, Object.keys(src).length];
  if (P1_LOTC.key && P1_LOTC.key[0] === key[0] && P1_LOTC.key[1] === key[1]) return P1_LOTC;
  const g = new Map();
  Object.entries(src).forEach(([k, p]) => { if (!p || !p.at) return;
    const at = String(p.lotAt || p.at), ms = ptDtMs(at) || 0, day = p1Iso(at) || (ms ? p1Local(ms) : ''); if (!day) return;
    const sku = obUC(p.sku || String(k).split('__').slice(1).join('__')), gk = sku + '|' + (ms ? Math.floor(ms / 6e4) : at);
    const e = g.get(gk) || g.set(gk, { sku, ms, day, month: day.slice(0, 7), by: p1Who(p.by), route: flowRouteOf(p), plan: p, keys: [] }).get(gk);
    e.keys.push(k); });
  const list = [...g.values()].sort((a, b) => a.ms - b.ms || a.sku.localeCompare(b.sku)), seq = {}, byLine = new Map();
  list.forEach(l => { seq[l.month] = (seq[l.month] || 0) + 1; l.n = seq[l.month]; l.end = P1_LOT_END[l.route] || 'GR';
    l.no = String(l.n).padStart(3, '0') + '-' + l.end; l.id = l.month.slice(2, 4) + l.month.slice(5, 7) + '-' + l.no; l.mon = P1_MON[+l.month.slice(5, 7) - 1];
    l.keys.forEach(k => byLine.set(k, l)); });
  P1_LOTC = { key, byLine, list }; return P1_LOTC;
}
const p1LotOf = (orderNo, sku) => p1Lots().byLine.get(flowKey(orderNo, sku)) || null;
/** The lot as the floor says it — 001-GR; one from another month with its month in front (Sep 014-GR). */
const p1LotTxt = l => l ? (l.month === p1Local().slice(0, 7) ? l.no : l.mon + ' ' + l.no) : '';
/** Where each step is done — the ledger's Process column (the WIP sheet's PROCESS). */
const P1_PROC = { IN: 'Order', BACK: 'Order', PLAN: 'Planning', RFD: 'Printing', PRN: 'Printing', CUT: 'Cutting', ISS: 'Stitching', REC: 'Stitching', PRESS: 'Press', QC: 'QC', REJ: 'QC', FG: 'Finished Goods', FBA: 'Finished Goods', SHIP: 'Shipping' };
const p1Vr = r => String((r && (r.vrNo || r.challanNo || r.slipNo || r.entryNo || r.id || r._id || r.key)) || '');

/** Every step on record, oldest first: { k, ms, day, orderNo, sku, pcs, unit, by, party, ref }. Cached on its sources. */
let P1_EV = { key: null, list: [], last: new Map() };
function p1Events() {
  const src = [PTG.ob, PT.cut, PT.base, PTG.press, FLOW.ppc, FLOW.ch, typeof QC !== 'undefined' ? QC.checks : null, typeof FGI !== 'undefined' ? FGI.rows : null, PTG.shopProd];
  /* the lengths too: the order book and the registers get rows pushed in place, keeping the same array (review, 26 Oct) */
  src.push(...src.slice().map(x => Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0));
  if (P1_EV.key && src.length === P1_EV.key.length && src.every((s, i) => s === P1_EV.key[i])) return P1_EV.list;
  const out = [], add = (k, at, r, pcs, by, party, ref, unit, vr) => {
    const q = +pcs || 0; if (!(q > 0)) return;
    const ms = ptDtMs(at) || 0, day = p1Iso(at) || (ms ? p1Local(ms) : '');
    out.push({ k, ms: ms || (day ? Date.parse(day + 'T12:00:00') : 0), t: /\d:\d\d/.test(String(at || '')), day, orderNo: obUC(r.orderNo || ''), sku: obUC(r.sku || ''), pcs: q, unit: unit || 'pcs', by: p1Who(by), party: String(party || '').trim(), ref: ref || '', vr: vr == null ? '' : String(vr) });
  };
  /* order in — one per order book row; sent back to sales */
  (PTG.ob || []).forEach(r => { if (!r) return; add('IN', r.openedAt || r.uploadedAt || r.orderDate, r, typeof obPieces === 'function' ? obPieces(r) : r.qty, r.uploadedBy || r.addedBy || '', r.buyerName || (r.src === 'SHP' ? 'Shopify' : r.src || ''), r.shopOrderNo ? 'Shopify ' + r.shopOrderNo : r.src === 'SHP' ? 'Shopify order' : 'Order book');
    if (r.ppcBack && r.ppcBack.at) add('BACK', r.ppcBack.at, r, typeof obPieces === 'function' ? obPieces(r) : r.qty, r.ppcBack.by, '', r.ppcBack.note ? '“' + r.ppcBack.note + '”' : 'sent back'); });
  /* planned — the plan record, keyed by line */
  const lineOf = new Map(); try { ordLines().forEach(l => lineOf.set(flowKey(l.orderNo, l.sku), l)); } catch (e) { /* no order book yet */ }
  Object.entries(FLOW.ppc || {}).forEach(([k, p]) => { const l = lineOf.get(k); if (!p || !l || !p.at) return;
    const rt = (FLOW_ROUTES.find(r => r[0] === flowRouteOf(p)) || [])[2] || '';
    add('PLAN', p.at, l, l.qty, p.by, p1Pr(p.printer) || p1Pr(p.emb) || p1Pr(p.outVendor), 'Plan · ' + rt + (p.dates && p.dates.ready ? ' · ready by ' + p1Day(p.dates.ready) : '')); });
  /* fabric to the printer and printed back — the flow challans */
  Object.values(FLOW.ch || {}).forEach(c => { if (!c || c.cancelled) return;
    (c.lines || []).forEach(l => { if (l.ruffleOnly) return; const u = flowChUnit(l);
      add('RFD', c.at || c.date, { orderNo: l.orderNo || c.orderNo, sku: l.sku }, flowChSent(l), c.by, c.vendor && c.vendor.name, 'Challan ' + c.no + (u === 'm' && l.fabric ? ' · ' + l.fabric : ''), u, c.no); });
    Object.values(c.receipts || {}).forEach(rc => Object.entries((rc && rc.items) || {}).forEach(([key, q]) => { const l = (c.lines || []).find(x => x.key === key); if (!l || l.ruffleOnly) return;
      add('PRN', rc.at || rc.date, { orderNo: l.orderNo || c.orderNo, sku: l.sku }, q, rc.by, c.vendor && c.vendor.name, 'Challan ' + c.no + (rc.note ? ' · ' + rc.note : ''), flowChUnit(l), c.no); })); });
  /* cutting, job work, press */
  (PT.cut || []).forEach(r => { if (!r) return; add('CUT', r.cutDate || r.addedAt, r, (parseInt(r.pieces, 10) || 0) - (r.rejected === true ? parseInt(r.rejPieces, 10) || 0 : 0), r.addedBy, 'Cutting', 'Cutting Data', '', p1Vr(r)); });
  (PT.base || []).forEach(r => { if (!r) return;
    add('ISS', r.issueDate || r.addedAt, r, ptNum(r.issuePieces), r.addedBy, r.empName, 'Job Work · issue', '', p1Vr(r));
    /* every receipt on its own date (receipts[], whatsapp.js); a row from before receipts were kept: its receiving date */
    const rc = (Array.isArray(r.receipts) ? r.receipts : Object.values(r.receipts || {})).filter(x => x && +x.qty > 0);
    if (rc.length) rc.forEach(x => add('REC', x.at, r, x.qty, x.by || r.recvBy || '', r.empName, 'Job Work · receipt', '', p1Vr(r)));
    else if (r.receivingDate) add('REC', r.receivingDate, r, ptNum(r.receivedPieces), r.recvBy || r.lastEditedBy || '', r.empName, 'Job Work · receipt' + (ptNum(r.rejectionPieces) ? ' · ' + p1N(r.rejectionPieces) + ' rejected' : ''), '', p1Vr(r)); });
  (PTG.press || []).forEach(r => { if (r) add('PRESS', r.entryDate || r.addedAt, r, r.pieces, r.addedBy, 'Press', 'Press'); });
  /* QC */
  ((typeof QC !== 'undefined' && QC.checks) || PTG.qc || []).forEach(c => { if (!c || c.refId) return;
    add('QC', c.date || c.addedAt, c, c.ok, c.checkedBy || c.addedBy, c.checkedBy || '', 'QC check' + (+c.forAlteration ? ' · ' + p1N(c.forAlteration) + ' for alteration' : ''), '', p1Vr(c));
    add('REJ', c.date || c.addedAt, c, c.rejected, c.checkedBy || c.addedBy, '', 'QC check · back to the karigar'); });
  /* Finished Goods: received (from QC, a transfer counted in) and dispatched to FBA */
  ((typeof FGI !== 'undefined' && FGI.rows) || []).forEach(r => { if (!r || r.test) return; const t = r.txnType;
    if (t === 'RECEIVE' || (t === 'TRANSFER_IN' && r.confirmed === true && r.reversed !== true)) add('FG', r.createdAt || r.date, r, r.qty, r.createdBy, r.receivedFrom || '', 'Finished Goods ' + (r._id || ''), '', r._id || '');
    else if (t === 'FBA') add('FBA', r.createdAt || r.date, r, r.qty, r.createdBy, 'Amazon FBA', (r.shipmentId ? 'Shipment ' + r.shipmentId : 'FBA dispatch'), '', r.shipmentId || r._id || ''); });
  /* hand-overs to the shipping team (made-to-order lines) */
  try { shpHandRegister().forEach(h => add('SHIP', h.at, h, h.pcs, h.acceptedBy || h.by, 'Shipping team', h.shop ? 'Shopify ' + h.shop : 'Hand-over')); } catch (e) { /* not loaded */ }
  /* the WIP sheet's columns (Ravi, 28 Oct): the lot, what the SKU is (item, family, pattern), the order's date; a plan's
   * voucher is its lot number */
  const rowOf = new Map(); try { flowRows().forEach(x => rowOf.set(x.s.key, x.r)); } catch (e) { /* not read yet */ }
  out.forEach(e => { const l = lineOf.get(flowKey(e.orderNo, e.sku)) || rowOf.get(flowKey(e.orderNo, e.sku)), lot = p1Lots().byLine.get(flowKey(e.orderNo, e.sku));
    e.lot = lot ? lot.no : ''; e.lotMon = lot ? lot.mon : ''; e.lotId = lot ? lot.id : ''; if (e.k === 'PLAN' && lot && !e.vr) e.vr = lot.no;
    e.item = l ? String(l.articleType || l.itemName || '') : ''; e.fam = l ? String(l.articleSubtype || '') : ''; e.pat = l ? [l.color, l.size].filter(Boolean).join(' · ') : '';
    e.odate = l ? (p1Iso(l.orderDate) || l.openIso || '') : ''; });
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
const p1SrcKey = () => [flowRows(), p1Events(), PT.base, (PT.base || []).length, typeof QC !== 'undefined' ? QC.checks : null, typeof FGI !== 'undefined' ? FGI.rows : null, FLOW.ch];
const p1Same = (a, b) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
function p1Wip() {
  const key = p1SrcKey(); if (p1Same(P1_WIPC.key, key)) return P1_WIPC.out;
  const res = p1WipBuild(); P1_WIPC = { key, out: res }; return res;
}
function p1WipBuild() {
  const out = [], rows = flowRows().filter(x => !x.r.__t && x.s.bucket !== 'done' && x.s.bucket !== 'board'), open = new Set(rows.map(x => obUC(x.r.orderNo) + '|' + obUC(x.r.sku)));
  p1Events(); const lastOf = (k, o, s) => P1_EV.last.get(k + '|' + o + '|' + s) || null;
  /* with the printer: what each open challan has sent and not had back */
  Object.values(FLOW.ch || {}).forEach(c => { if (!c || c.cancelled || c.closed) return; const recv = flowChRecv(c);
    (c.lines || []).forEach(l => { if (l.ruffleOnly || flowChMoved(c, l)) return; const left = flowR2(flowChSent(l) - (recv[l.key] || 0));
      if (left > 0.01) out.push({ stage: 'Printer', sku: obUC(l.sku), orderNo: obUC(l.orderNo || c.orderNo), pcs: left, unit: flowChUnit(l), who: (c.vendor && c.vendor.name) || '—', since: p1Iso(c.at || c.date), ref: 'Challan ' + c.no }); }); });
  rows.forEach(x => { const s = x.s, r = x.r, q = +r.qty || 0, o = obUC(r.orderNo), k = obUC(r.sku);
    if (s.bucket === 'vendor') { const p = lastOf('PLAN', o, k); out.push({ stage: 'Printer', sku: k, orderNo: o, pcs: q, unit: 'pcs', who: p1Pr(s.plan && s.plan.printer) || 'printer not given yet', since: p ? p.day : '', ref: 'print order to give' }); }
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
/** A movement's own name — the same after the list is read again, where its place in the list is not. */
const p1EvId = e => [e.k, e.ms, e.orderNo, e.sku, e.pcs, e.ref].join('|');
const p1Mv = e => `<span class="pl ${P1_MV[e.k][1]}">${P1_MV[e.k][0]}</span>`;
const P1_ADD = [
  ['PLAN', 'Plan', 'flppc', x => x.s.bucket === 'ppc'],
  /* only a line still waiting for its cloth (Demand) — a line already made from cloth given earlier is not asked for a challan */
  ['RFD', 'Fabric to printer', 'fldem', x => x.s.bucket === 'demand' && x.s.needFab && x.s.route !== 'stitch'],
  ['PRN', 'Printed back', 'flchl', x => x.s.printed && x.s.given > 0 && x.s.back < (+x.r.qty || 0)],
  ['CUT', 'Cut', 'pcut', x => x.s.canCut > 0 && ['cut', 'fabric', 'emb'].includes(x.s.bucket)],
  ['ISS', 'Give to karigar', 'pbase', x => typeof flowIssuable === 'function' && flowIssuable(x.r, x.s) > 0 && !['ppc', 'back', 'demand', 'vendor'].includes(x.s.bucket)],
  ['REC', 'Back from karigar', 'pbase', x => p1OpenIss(x.r).length > 0],
  ['QC', 'QC check', 'qc', x => { try { return flowQcWaiting(x.r, x.s) > 0; } catch (e) { return false; } }],
  ['FG', 'Into Finished Goods', 'fgi', x => x.s.bucket === 'fgin'],
  ['SHIP', 'Hand to shipping', 'ord', x => x.s.bucket === 'ship']];
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
  if (k === 'SHIP') return +x.r.qty || 0;
  return +x.r.qty || 0;
}
const P1_DO = { PLAN: 'Plan', RFD: 'Make challan', PRN: 'Receive', CUT: 'Enter cutting', ISS: 'Issue', REC: 'Receive', QC: 'Check in QC', FG: 'Accept', SHIP: 'Hand over' };
/** The real entry form for one waiting group. */
function p1Do(k, xs) {
  const x = xs[0], leave = fn => { p1Hide(); setTimeout(fn, 30); };
  /* the plan form and the challan return without a word when the lines no longer qualify: say so here (review, 26 Oct) */
  const said = what => setTimeout(() => { const d = $('ptDlg'); if ((!d || d.classList.contains('hide')) && typeof frToast === 'function') frToast(what, null, 6000); }, 400);
  if (k === 'PLAN') { flowPpcOpen(null, null, xs.map(y => y.s.key)); said('Nothing of this is waiting for a plan any more — press ↻ Refresh.'); }
  else if (k === 'RFD') { flowChallanForKeys(xs.map(y => y.s.key)); said('No challan to make for these lines — their cloth is not owed any more, or they need a printer on the plan first. Open Demand → RFD to check.'); }
  else if (k === 'CUT') leave(() => flowCutEntry(x.r, x.s));
  else if (k === 'ISS') leave(() => flowIssueEntry(x.r, x.s));
  else if (k === 'REC') flowRecvEntry(x.r);
  else if (k === 'QC') leave(() => showTab('qc'));
  else if (k === 'FG') leave(() => { if (typeof frFgView === 'function') frFgView('pending'); else showTab('fgi'); });
  else if (k === 'PRN') leave(() => { FLOW_VIEW = 'dhist'; showTab('flow'); });
  else if (k === 'SHIP') leave(() => showTab('ord'));   // the Order Console's Production to shipping, where the shipping team takes it
}
/** The ledger's list of what waits for one step of one SKU — every line, each with its own button. */
function p1WaitFor(k, sku) { P1.view = 'ledger'; P1.act = k; P1.f = Object.assign({}, P1.f, { kind: k, sku }); P1.lim = 300; P1.openAt = ''; p1Draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
/** What is waiting for the chosen step, on the page itself. */
function p1WaitCard(k) {
  const a = P1_ADD.find(x => x[0] === k), q = P1.q.trim().toUpperCase();
  const gs = P1.groups = p1Groups(k, P1.f.sku).filter(([s, xs]) => !q || (s + ' ' + xs.map(x => x.r.orderNo).join(' ')).toUpperCase().includes(q));
  const who = xs => k === 'REC' ? p1OpenIss(xs[0].r).map(b => b.empName).join(', ') : p1Pr(xs[0].s.plan && xs[0].s.plan.printer);
  const tot = gs.reduce((t, [, xs]) => t + xs.reduce((u, x) => u + p1Pcs(k, x), 0), 0);
  return `<div class="lg-card lg-wait"><div class="lg-cap lg-waith"><span class="pl ${P1_MV[k][1]}">${esc(a[1])}</span><b>${p1N(gs.length)}</b> ${k === 'PLAN' || k === 'RFD' ? 'SKUs' : 'lines'} waiting · <b>${p1N(tot)}</b> pcs${P1.f.sku ? ' · ' + esc(P1.f.sku) : ''}
      <span style="margin-left:auto;color:var(--muted)">Below: the ledger of this step only</span><button type="button" class="lg-go sm" data-p1act-off>× Show everything</button></div>
    <div class="lg-scroll" style="max-height:46vh"><table class="lg-t"><thead><tr><th>SKU</th><th>Orders</th><th>${k === 'REC' ? 'Karigar' : 'Printer'}</th><th class="num">Pcs</th><th></th></tr></thead><tbody>
    ${gs.slice(0, 400).map(([s, xs], i) => `<tr><td><b>${esc(s)}</b><div class="sub">${esc([xs[0].r.articleSubtype || xs[0].r.articleType || xs[0].r.itemName, xs[0].r.color, xs[0].r.size].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(xs.map(x => x.r.orderNo).join(', '))}</td><td>${esc(who(xs)) || '<span class="muted">—</span>'}</td><td class="num"><b>${p1N(xs.reduce((u, x) => u + p1Pcs(k, x), 0))}</b></td>
      <td style="text-align:right">${p1MayTab(a[2]) ? `<button type="button" class="lg-yes" data-p1do="${i}">${P1_DO[k]}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">Nothing is waiting for ${esc(a[1].toLowerCase())}${P1.f.sku ? ' on ' + esc(P1.f.sku) : ''}.</td></tr>`}
    </tbody></table></div></div>`;
}

/** The SKU card's places, the same place twice made one (Ravi, 26 Oct: "isn't this looking messy"): one challan's lines
 *  for the same orders came out as two identical rows. */
function p1WipRows(wip) {
  const m = new Map();
  wip.forEach(w => { const k = [w.stage, w.who, w.orderNo, w.since, w.unit].join('|'), e = m.get(k); if (e) e.pcs += w.pcs; else m.set(k, Object.assign({}, w)); });
  return [...m.values()];
}
/** A list of orders: the first two, and "+N more" that opens the rest in place. */
function p1Ords(list) {
  const os = String(list || '').split(/\s*[,+]\s*/).map(x => x.trim()).filter(Boolean);
  if (os.length <= 2) return `<span class="muted ords">${esc(os.join(', '))}</span>`;
  return `<span class="muted ords">${esc(os.slice(0, 2).join(', '))} <details class="more-ords"><summary>+${os.length - 2} more</summary><span>${esc(os.slice(2).join(', '))}</span></details></span>`;
}
/** The SKU's card above the ledger: its balance, where its pieces are and who has them, and its next steps. */
function p1SkuCard(sku, ev) {
  const mine = ev.filter(e => e.sku === sku && e.unit !== 'm'), sum = ks => mine.filter(e => ks.includes(e.k)).reduce((t, e) => t + e.pcs, 0);
  const rows = flowRows().filter(x => !x.r.__t && obUC(x.r.sku) === sku && x.s.bucket !== 'done' && x.s.bucket !== 'board');
  const np = rows.filter(x => x.s.bucket === 'ppc' || x.s.bucket === 'back').reduce((t, x) => t + (+x.r.qty || 0), 0);
  const mk = rows.filter(x => !['ppc', 'back'].includes(x.s.bucket)).reduce((t, x) => t + Math.max(0, (+x.r.qty || 0) - x.s.qc), 0);
  const rd = rows.reduce((t, x) => t + Math.max(0, Math.min(+x.r.qty || 0, x.s.qc) - x.s.india), 0);
  const wip = p1Wip().filter(w => w.sku === sku), what = rows[0] ? [rows[0].r.articleSubtype || rows[0].r.articleType || rows[0].r.itemName, rows[0].r.color, rows[0].r.size].filter(Boolean).join(' · ') : '';
  const fg = typeof fgiOf === 'function' ? Math.max(0, fgiOf(sku).current || 0) : 0;
  const acts = P1_ADD.filter(a => p1MayTab(a[2]) && rows.some(x => a[3](x)));
  return `<div class="lg-card lg-skucard"><div class="sk-h"><div><div class="sk-crumb">SKU</div><h2>${esc(sku)}</h2><div class="muted">${esc(what)}${rows.length ? ' · ' + new Set(rows.map(x => x.r.orderNo)).size + ' open order(s)' : ''}</div></div>
      <span style="display:flex;gap:8px">${P1.f.sku === sku ? '' : `<button type="button" class="lg-go" data-p1only="${esc(sku)}">Only this SKU in the ledger</button>`}<button type="button" class="lg-go" data-p1close>× Close</button></span></div>
    <div class="sk-tiles">${[['Ordered (all time)', sum(['IN']), ''], ['Not planned', np, 'var(--bad)'], ['In production', mk, ''], ['Passed QC, not in FG', rd, 'var(--accent)'], ['Finished Goods in store', fg, ''], ['Sent from production', sum(['FG', 'SHIP']), 'var(--accent)']]
      .map(t => `<div><b style="${t[2] ? 'color:' + t[2] : ''}">${p1N(t[1])}</b><span>${t[0]}</span></div>`).join('')}</div>
    <div class="sk-row"><div class="sk-where"><div class="lg-h">Where it is now — and who has it</div>${p1WipRows(wip).map(w => { const d = p1Days(w.since);
        return `<div class="lg-mv"><span class="pl mv-make">${esc(w.stage)}</span><b>${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</b><span class="who">${esc(w.who)}</span>${p1Ords(w.orderNo)}<span class="muted" style="margin-left:auto;white-space:nowrap${d != null && d > 7 ? ';color:var(--bad);font-weight:700' : ''}">${w.since ? p1Day(w.since) + ' · ' + d + ' d' : ''}</span></div>`; }).join('') || '<div class="muted">Nothing of it is in production now.</div>'}</div>
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
  /* ONE LINE PER LOT (Ravi, 28 Oct): the open lines of each plan together; a SKU not planned yet is one line of its own */
  const by = new Map(), lineG = new Map(), L = p1Lots();
  const wipOf = new Map(); p1Wip().forEach(h => { const k = h.orderNo + '|' + h.sku; (wipOf.get(k) || wipOf.set(k, []).get(k)).push(h); });
  flowRows().forEach(x => {
    if (x.r.__t || x.s.bucket === 'done' || x.s.bucket === 'board') return;   // 'board': a new Shopify order the SHP board plans (live, 28 Oct)
    const k = obUC(x.r.sku), q = +x.r.qty || 0, s = x.s, lot = L.byLine.get(s.key) || null, gk = lot ? lot.id : 'NEW|' + k;
    const e = by.get(gk) || { gk, lot, sku: k, art: p1Art(x.r), fam: String(x.r.articleSubtype || ''), wl: [], what: [x.r.articleSubtype || x.r.articleType || x.r.itemName, x.r.color, x.r.size].filter(Boolean).join(' · '), lines: [], orders: new Set(),
      ordered: 0, notPlanned: 0, short: 0, fab: 0, fabM: 0, cut: 0, raw: 0, kar: 0, qc: 0, ready: 0, isNew: false };
    e.lines.push(x); e.wl.push(p1WipLine(x, wipOf)); lineG.set(s.key, e); e.orders.add(x.r.orderNo); e.ordered += q;
    if (s.bucket === 'ppc' || s.bucket === 'back') e.notPlanned += q;
    if (s.bucket === 'ppc' && x.recent) e.isNew = true;
    const f = rc.line[s.key]; if (f && f.short > 0) e.short += f.short;
    if (s.needFab || s.bucket === 'vendor' || (s.printed && s.given > 0 && s.back < q)) e.fab += s.needFab || s.bucket === 'vendor' ? q : Math.max(0, q - s.back);
    if (s.canCut > 0 && ['cut', 'fabric', 'emb'].includes(s.bucket)) e.cut += s.canCut;
    if (typeof flowIssuable === 'function' && !['ppc', 'back', 'demand', 'vendor'].includes(s.bucket)) e.raw += flowIssuable(x.r, s);
    try { e.qc += flowQcWaiting(x.r, s) + flowQcLine(x.r).altOpen + flowQcLine(x.r).deptOpen; } catch (err) { /* QC not read */ }
    if (s.bucket === 'fgin') e.ready += Math.max(0, s.made - s.india); else if (s.bucket === 'ship') e.ready += q;
    by.set(gk, e);
  });
  (PT.base || []).forEach(b => { if (!b || b.frozen) return; const e = lineG.get(flowKey(b.orderNo, b.sku)); if (!e) return;
    e.kar += Math.max(0, ptNum(b.issuePieces) - ptNum(b.receivedPieces) - ptNum(b.rejectionPieces)); });
  /* Finished Goods stock: the whole ledger added up once, not once per SKU (fgiOf re-adds all of it every call) */
  let fgs = null; try { fgs = typeof fgiStock === 'function' ? fgiStock() : null; } catch (err) { fgs = null; }
  return [...by.values()].map(e => Object.assign(e, { fg: fgs && fgs.get(e.sku) ? Math.max(0, fgs.get(e.sku).current || 0) : 0, tot: e.fab + e.cut + e.raw + e.kar + e.qc + e.ready }))
    .sort((a, b) => !!a.lot - !!b.lot || String(a.lot ? a.lot.id : '').localeCompare(String(b.lot ? b.lot.id : '')) || a.sku.localeCompare(b.sku));
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
/* The steps of each stage box: with a stage picked, a line's button is that stage's step (Ravi, 26 Oct: "if they are in
 * ready stage then why are they showing Make challan, Plan 125") — not the earliest step of some other order of the SKU. */
const P1_STAGE_STEPS = { plan: ['PLAN'], fab: ['RFD', 'PRN'], cut: ['CUT', 'ISS'], kar: ['REC', 'ISS'], qc: ['QC'], ready: ['FG', 'SHIP'] };
const P1_LABEL = { PLAN: 'Plan', RFD: 'Make challan', PRN: 'Receive printed', CUT: 'Enter cutting', ISS: 'Give to karigar', REC: 'Receive from karigar', QC: 'Check in QC', FG: 'Accept in FG', SHIP: 'Hand to shipping' };
function p1NextOf(r, stage) {
  const n = k => { const a = P1_ADD.find(x => x[0] === k); return a && p1MayTab(a[2]) ? r.lines.filter(x => a[3](x)) : []; };
  for (const k of stage && P1_STAGE_STEPS[stage] ? P1_STAGE_STEPS[stage] : ['PLAN', 'RFD', 'PRN', 'CUT', 'ISS', 'REC', 'QC', 'FG', 'SHIP']) {
    const ls = n(k); if (ls.length) return [k, P1_LABEL[k], ls];
  }
  return null;
}
function p1DrawInv() {
  const el = $('p1Home');
  let all = [], wip = [];
  try { all = p1Inv(); wip = p1Wip(); } catch (e) { el.innerHTML = `<div class="p1-head"><h1 class="lm-h">PPC</h1></div><div class="card"><div class="empty" style="color:var(--bad)">Could not read the lines: ${esc(e.message || e)}</div></div>`; return; }
  const grpOf = new Map(); all.forEach(r => r.lines.forEach(x => grpOf.set(x.s.key, r.gk)));
  const holds = new Map(); wip.forEach(w => { const g = grpOf.get(flowKey(w.orderNo, w.sku)); if (g) (holds.get(g) || holds.set(g, []).get(g)).push(w); });
  all.forEach(r => { r.holds = p1WipRows(holds.get(r.gk) || []).sort((a, b) => String(a.since || '9').localeCompare(String(b.since || '9')));
    r.stages = new Set(r.holds.map(w => P1_STAGE_OF[w.stage]).filter(Boolean)); if (r.notPlanned) r.stages.add('plan');
    r.next = p1NextOf(r, P1.stage); r.late = r.holds.some(w => (p1Days(w.since) || 0) > 7);
    r.due = r.lines.map(x => String((x.s.plan && x.s.plan.dates && x.s.plan.dates.ready) || x.r.mtoDue || '')).filter(Boolean).sort()[0] || ''; });
  const q = P1.q.trim().toUpperCase();
  const rows = all.filter(r => (!P1.stage || r.stages.has(P1.stage)) && (!q || ((r.lot ? r.lot.no + ' ' + r.lot.id + ' ' : '') + r.sku + ' ' + r.what + ' ' + [...r.orders].join(' ') + ' ' + r.holds.map(w => w.who).join(' ')).toUpperCase().includes(q)))
    /* in lot order (Ravi, 28 Oct: the serial number first): what is still to plan on top, then 001, 002… month by month */
    .sort((a, b) => !!a.lot - !!b.lot || String(a.lot ? a.lot.id : '').localeCompare(String(b.lot ? b.lot.id : '')) || a.sku.localeCompare(b.sku));
  const shown = rows.slice(0, P1.lim), today = p1Local(), ev = p1Events();
  /* LATE AND STUCK, FIRST (Ravi, 29 Oct: what a PPC manager sees first) — a plain list of the lots to chase today: past the
   * due date, or pieces held at one place for more than 7 days. One line a lot, the worst first: where it is held, with whom,
   * how many pieces, for how many days, the due date and by how much it is late, and its next step. */
  const att = all.map(r => { const late = r.due && r.due < today ? p1Days(r.due) : 0, held = r.holds.filter(w => (p1Days(w.since) || 0) > 7)
      .sort((x, y) => (p1Days(y.since) || 0) - (p1Days(x.since) || 0)), at = held[0] || r.holds[0] || null;
    return late || held.length ? { r, late, at, days: at ? p1Days(at.since) : null, nx: (at && p1NextOf(r, P1_STAGE_OF[at.stage])) || r.next } : null; }).filter(Boolean)
    .sort((x, y) => y.late - x.late || (y.days || 0) - (x.days || 0));
  const attShown = P1.attAll ? att : att.slice(0, 8);
  const attRow = ({ r, late, at, days, nx }) => `<tr class="p1a" data-p1go="${esc(r.gk)}"><td><b class="p1-lotno sm${r.lot ? '' : ' new'}">${r.lot ? esc(p1LotTxt(r.lot)) : 'To plan'}</b></td>
      <td><b>${esc(r.sku)}</b><div class="muted sm">${esc(r.what)}</div></td><td>${at ? esc(at.stage) : '<span class="muted">—</span>'}</td><td>${at ? esc(at.who) : ''}</td>
      <td class="num">${at ? p1N(at.pcs) + (at.unit === 'm' ? ' m' : '') : ''}</td><td class="num${(days || 0) > 7 ? ' bad' : ''}">${days != null ? days + ' d' : '—'}</td>
      <td>${r.due ? p1Day(r.due) : '<span class="muted">—</span>'}</td><td class="num${late ? ' bad' : ''}">${late ? late + ' d' : '<span class="muted">—</span>'}</td>
      <td class="nx">${nx ? `<button type="button" class="p1-go" data-p1att-do="${esc(r.gk)}" data-p1att-st="${esc(at ? P1_STAGE_OF[at.stage] || '' : '')}">${esc(nx[1])}</button>` : ''}</td></tr>`;   /* the step of the place it is held: a karigar's lot says Receive */
  const attCard = att.length ? `<div class="card p1-att"><div class="p1-att-h"><b>Late and stuck</b><span class="muted"> · ${p1N(att.filter(x => x.late).length)} past the due date · ${p1N(att.filter(x => (x.days || 0) > 7).length)} held more than 7 days at one place</span></div>
    <table class="p1t p1at"><thead><tr><th>Lot</th><th>SKU</th><th>Held at</th><th>With</th><th class="num">Pcs</th><th class="num">Days there</th><th>Due</th><th class="num">Late by</th><th></th></tr></thead>
    <tbody>${attShown.map(attRow).join('')}</tbody></table>${att.length > attShown.length ? `<button type="button" class="lg-more" data-p1att>Show all ${p1N(att.length)}</button>` : ''}</div>`
    : '<div class="card p1-att p1-att-ok"><b>Nothing is late or stuck.</b> <span class="muted">Every lot is within its due date and no place has held pieces for more than 7 days.</span></div>';
  const chip = w => { const st = P1_STAGE_OF[w.stage] || 'cut', c = P1_STAGE_INK[st], d = p1Days(w.since);
    return `<span class="hold${d != null && d > 7 ? ' late' : ''}" style="background:${c[0]};color:${c[1]}"><b>${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</b> ${esc(w.stage === 'With karigar' ? w.who : w.stage === 'Printer' ? w.who : w.stage)}${d != null ? ` · ${d}d` : ''}</span>`; };
  el.innerHTML = `<div class="p1-head"><h1 class="lm-h">PPC</h1>${p1ViewSeg()}<input type="search" class="p1-q" id="p1Q" placeholder="Search lot, SKU, order, karigar, printer…" value="${esc(P1.q)}"></div>
    <div class="p1-stages"><button type="button" class="st${!P1.stage ? ' on' : ''}" data-p1st=""><b>${p1N(all.length)}</b><span>All lots</span></button>${P1_STEPS.map(s => { const n = all.filter(r => r.stages.has(s[0])).length;
      return `<button type="button" class="st${P1.stage === s[0] ? ' on' : ''}" data-p1st="${s[0]}"><b>${p1N(n)}</b><span>${esc(s[1])}</span></button>`; }).join('')}
      <span class="p1-read">${P1.err ? `<b style="color:var(--bad)">Could not read everything: ${esc(P1.err)}</b> · ` : ''}${P1.loading ? 'Reading…' : 'Read ' + (P1.at || '—')} · <a data-p1r>↻ Refresh</a></span></div>
    ${attCard}
    <div class="card p1-list"><table class="p1t"><thead><tr><th>Lot</th><th>SKU</th><th>Orders</th><th>Where it is now — and who has it</th><th>Due</th><th>Next step</th></tr></thead><tbody>
    ${shown.map(r => { const open = P1.inv === r.gk, nx = r.next, more = r.holds.length - 4;
      return `<tr class="p1r${open ? ' open' : ''}${r.late ? ' late' : ''}" data-p1row="${esc(r.gk)}">
        <td class="lot"><b class="p1-lotno${r.lot ? '' : ' new'}">${r.lot ? esc(p1LotTxt(r.lot)) : 'To plan'}</b> <span class="caret">${open ? '▴' : '▾'}</span>${r.lot ? `<div class="muted sm">from ${esc(P1_LOT_FROM[r.lot.end] || '')}</div>` : ''}</td>
        <td><b class="sku">${esc(r.sku)}</b>${r.isNew ? ' <span class="pill-new">NEW</span>' : ''}<div class="muted sm">${esc(r.what)}</div></td>
        <td class="ord"><b>${p1N(r.ordered)}</b> pcs · ${r.orders.size} order${r.orders.size > 1 ? 's' : ''}<div class="sm">${r.notPlanned ? `<span style="color:var(--bad);font-weight:700">${p1N(r.notPlanned)} not planned</span>` : '<span style="color:var(--accent)">all planned</span>'}${r.fg ? ` · <span class="muted">${p1N(r.fg)} in FG</span>` : ''}</div></td>
        <td class="where">${r.holds.slice(0, 4).map(chip).join('')}${more > 0 ? `<span class="muted sm">+${more} more</span>` : ''}${!r.holds.length ? `<span class="muted sm">${r.notPlanned ? 'not started' : '—'}</span>` : ''}</td>
        <td class="due${r.due && r.due < today ? ' over' : ''}">${r.due ? p1Day(r.due) : '<span class="muted">—</span>'}</td>
        <td class="nx">${nx ? `<button type="button" class="p1-go" data-p1next="${esc(r.gk)}">${esc(nx[1])}${nx[0] === 'PLAN' ? ' · ' + p1N(nx[2].reduce((t, x) => t + (+x.r.qty || 0), 0)) : ''}</button>` : '<span class="muted sm">nothing waiting</span>'}</td></tr>
        ${open ? `<tr class="p1x"><td colspan="6">${p1LotDrop(r, ev)}</td></tr>` : ''}`; }).join('') || `<tr><td colspan="6" class="empty">Nothing here.</td></tr>`}
    </tbody></table>${rows.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show all ${p1N(rows.length)} lots</button>` : ''}</div>`;
  const on = (sel, fn, ev2 = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev2] = e => fn(b, e); });
  const R = gk => all.find(r => r.gk === gk);
  on('[data-p1st]', b => { P1.stage = b.dataset.p1st; P1.inv = ''; P1.lim = 300; p1Draw(); });
  on('[data-p1att]', () => { P1.attAll = true; p1Draw(); });
  on('[data-p1att-do]', b => { const r = all.find(x => x.gk === b.dataset.p1attDo), nx = r && (p1NextOf(r, b.dataset.p1attSt) || r.next); if (!nx) return;
    if (nx[0] === 'PLAN' || nx[0] === 'RFD' || nx[2].length === 1 || ['QC', 'FG', 'PRN', 'SHIP'].includes(nx[0])) return p1Do(nx[0], nx[2]);
    p1WaitFor(nx[0], r.sku); });
  on('[data-p1go]', (b, e) => { if (e.target.closest('button')) return; P1.inv = b.dataset.p1go; P1.stage = ''; p1Draw();   // the lot, opened in the list below
    const t = el.querySelector(`tr[data-p1row="${CSS.escape(b.dataset.p1go)}"]`); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  on('[data-p1row]', (b, e) => { if (e.target.closest('button')) return; P1.inv = P1.inv === b.dataset.p1row ? '' : b.dataset.p1row; p1Draw(); });
  on('[data-p1next]', b => { const r = R(b.dataset.p1next), nx = r && r.next; if (!nx) return;
    if (nx[0] === 'PLAN' || nx[0] === 'RFD' || nx[2].length === 1 || ['QC', 'FG', 'PRN', 'SHIP'].includes(nx[0])) return p1Do(nx[0], nx[2]);
    p1WaitFor(nx[0], r.sku); });                                     // several lines for one step: every one of them, each with its button
  /* the SKU card's own buttons */
  on('[data-p1add]', b => { const k = b.dataset.p1add, sku = b.dataset.p1addSku || '', gs = p1Groups(k, sku);
    if (!gs.length) return;
    if (k === 'PLAN' || k === 'RFD' || gs.length === 1) return p1Do(k, gs.reduce((a, g) => a.concat(g[1]), []));
    p1WaitFor(k, sku); });   /* several lines: the list of every one (only the first could be reached before — review, 26 Oct) */
  on('[data-p1close]', () => { P1.inv = ''; p1Draw(); });
  on('[data-p1only]', b => { P1.view = 'ledger'; P1.f.sku = b.dataset.p1only; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1view]', b => { P1.view = b.dataset.p1view; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1lim]', () => { P1.lim += 700; p1Draw(); });
  on('[data-p1r]', (b, e) => { e.preventDefault(); p1Load(true); });
  const qi = el.querySelector('#p1Q'); if (qi) qi.oninput = () => { P1.q = qi.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { P1.lim = 300; p1Draw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
}

/* ---------- WHERE A LOT IS — Ravi's WIP sheet (WIP.xlsx, 28 Oct): the order, what is done, the balance, then every place
 * the pieces are, the total in process and what is not started yet; one row per order line of the lot. ---------- */
const P1_WCOLS = [['grg', 'Greige / to print'], ['prn', 'At printer'], ['emb', 'Embroidery'], ['cut', 'To cut'], ['raw', 'Cut, in store'], ['kar', 'With karigar'], ['qc', 'QC'], ['rdy', 'Ready']];
const P1_WOF = { Embroidery: 'emb', Cutting: 'cut', 'Raw cutting in store': 'raw', 'With karigar': 'kar', QC: 'qc', 'Finished Goods to accept': 'rdy', 'To hand to shipping': 'rdy' };
function p1WipLine(x, wipOf) {
  const r = x.r, s = x.s, q = +r.qty || 0, o = obUC(r.orderNo), k = obUC(r.sku);
  const w = { orderNo: o, sku: k, q, done: Math.min(q, s.bucket === 'done' ? q : (+s.india || 0)), m: 0, who: [], planned: !(s.bucket === 'ppc' || s.bucket === 'back') };
  P1_WCOLS.forEach(c => { w[c[0]] = 0; });
  if (s.bucket === 'demand') w.grg = q;
  (wipOf.get(o + '|' + k) || []).forEach(h => {
    if (h.stage === 'Printer') { if (h.ref === 'print order to give') w.grg += h.pcs; else { if (h.unit === 'm') w.m += h.pcs; else w.prn += h.pcs; w.who.push(h.who); } return; }
    const c = P1_WOF[h.stage]; if (c) w[c] += h.pcs; if (h.stage === 'With karigar') w.who.push(h.who); });
  w.bal = Math.max(0, q - w.done);
  w.inp = w.prn + w.emb + w.cut + w.raw + w.kar + w.qc + w.rdy;   // pieces only: cloth at the printer in metres is not pieces yet
  w.todo = !w.planned ? w.bal : w.m > 0 ? 0 : Math.max(0, w.bal - w.inp - w.grg);
  return w;
}
const P1_WSUM = ['q', 'done', 'bal', 'grg', 'prn', 'm', 'emb', 'cut', 'raw', 'kar', 'qc', 'rdy', 'inp', 'todo'];
const p1WipTotal = ws => { const t = { who: [] }; P1_WSUM.forEach(f => { t[f] = ws.reduce((a, w) => a + (w[f] || 0), 0); }); ws.forEach(w => t.who.push(...w.who)); t.who = [...new Set(t.who)]; return t; };
/** The WIP table — the lines of one lot, or one row per lot (the report). */
function p1WipTable(rows, opts) {
  const O = opts || {}, z = v => v ? p1N(v) : '<span class="muted">·</span>', tot = p1WipTotal(rows.map(r => r.w));
  const prnTxt = w => w.prn || w.m ? [w.prn ? p1N(w.prn) : '', w.m ? p1N(w.m) + ' m' : ''].filter(Boolean).join(' + ') : '<span class="muted">·</span>';
  const cells = w => `<td class="num">${p1N(w.q)}</td><td class="num">${z(w.done)}</td><td class="num"><b>${p1N(w.bal)}</b></td>`
    + `<td class="num">${z(w.grg)}</td><td class="num">${prnTxt(w)}</td>` + ['emb', 'cut', 'raw', 'kar', 'qc', 'rdy'].map(f => `<td class="num">${z(w[f])}</td>`).join('')
    + `<td class="num"><b>${z(w.inp)}</b></td><td class="num"${w.todo ? ' style="color:var(--bad);font-weight:700"' : ''}>${z(w.todo)}</td>`;
  const head = O.lead.map(h => `<th${h[1] ? ' style="text-align:left"' : ''}>${h[0]}</th>`).join('');
  return `<div class="ff-grid p1-wip" style="max-height:${O.max || 'none'}"><table class="xl"><thead><tr>${head}<th>Ordered</th><th>Done</th><th>Balance</th>${P1_WCOLS.map(c => `<th>${c[1]}</th>`).join('')}<th>In process</th><th>Not started</th></tr></thead><tbody>
    ${rows.map(r => `<tr${r.attr || ''}>${r.lead.map((c, i) => `<td${O.lead[i] && O.lead[i][1] ? ' style="text-align:left"' : ''}${i === 0 ? ' class="frz"' : ''}>${c}</td>`).join('')}${cells(r.w)}</tr>`).join('') || `<tr><td colspan="${O.lead.length + 13}" class="empty">Nothing in production.</td></tr>`}
    ${rows.length > 1 ? `<tr class="p1-wtot"><td class="frz" style="text-align:left"><b>Total</b></td>${O.lead.slice(1).map(() => '<td></td>').join('')}${cells(tot)}</tr>` : ''}
    </tbody></table></div>`;
}
const p1AccCode = c => (typeof accCode === 'function' ? accCode(c) : String(c || '').toUpperCase());
/** The parts of a lot as planned — the cloth, the ruffle, extra fabric, embroidery, filling, who makes it, accessories. */
function p1LotParts(l, lines) {
  const p = l ? l.plan : null, parts = []; if (!p) return parts;
  const fab = p.fabric || {}; if (fab.name || +fab.metres) parts.push(['Body fabric', [fab.name, +fab.metres ? p1N(fab.metres) + ' m' : '', p1Pr(p.printer) ? 'printer ' + p1Pr(p.printer) : ''].filter(Boolean).join(' · ')]);
  if (p.rufflePrinter) parts.push(['Ruffle', 'printer ' + p1Pr(p.rufflePrinter)]);
  (p.extra || []).forEach(x => { if (x && (x.name || x.fabric)) parts.push([x.part || 'Extra fabric', [x.name || x.fabric, +x.metres ? p1N(x.metres) + ' m' : ''].filter(Boolean).join(' · ')]); });
  if (p.emb && p1Pr(p.emb)) parts.push(['Embroidery', p1Pr(p.emb)]);
  if (p.quilt && p1Pr(p.quilt)) parts.push(['Filling', [p1Pr(p.quilt), p.quilt.filler, p.quilt.kg ? p.quilt.kg + ' kg a piece' : ''].filter(Boolean).join(' · ')]);
  if (p.outVendor && p1Pr(p.outVendor)) parts.push(['Made by', p1Pr(p.outVendor)]);
  const acc = {}; (lines || []).forEach(x => { const res = (FLOW.res || {})[x.s.key]; Object.entries((res && res.items) || {}).forEach(([c, n]) => { acc[c] = (acc[c] || 0) + (+n || 0); }); });
  const held = new Set(Object.keys(acc));
  (p.acc || []).forEach(a => { if (a && a.code && !held.has(p1AccCode(a.code))) parts.push(['Accessory', `${p1AccCode(a.code)} · ${p1N(a.qty)} a line · not reserved yet`]); });
  Object.entries(acc).forEach(([c, n]) => parts.push(['Accessory', `${c} · ${p1N(n)} reserved`]));
  return parts;
}
/** The lot opened on Production: what it is, its parts, the WIP table of its order lines, then the SKU's card. */
function p1LotDrop(r, ev) {
  const l = r.lot, p = l ? l.plan : null, rt = p ? (FLOW_ROUTES.find(x => x[0] === flowRouteOf(p)) || [])[2] || '' : '', parts = p1LotParts(l, r.lines);
  const rows = r.wl.map(w => ({ lead: [esc(w.orderNo), esc(w.who.join(', ') || '—')], w }));
  return `<div class="p1-lot"><div class="p1-lot-h"><b class="p1-lotno">${l ? esc(l.no) : 'To plan'}</b>
      <span>${l ? `${esc(l.mon)} ${esc(l.month.slice(0, 4))} · starts at <b>${esc(P1_LOT_FROM[l.end] || '')}</b>${rt ? ' (' + esc(rt) + ')' : ''} · planned ${p1Day(l.day)}${l.by ? ' by ' + esc(l.by) : ''}` : 'not planned yet — it gets its lot number when it is planned'}</span>
      <span class="muted">${esc(r.sku)} · ${esc(r.what)}</span><button type="button" class="ghost" data-p1close style="margin-left:auto">Close</button></div>
    ${parts.length ? `<div class="p1-parts">${parts.map(x => `<span><i>${esc(x[0])}</i>${esc(x[1])}</span>`).join('')}</div>` : ''}
    ${p1WipTable(rows, { lead: [['Order', 1], ['Printer / karigar', 1]] })}
    <details class="p1-journey"><summary>Journey of ${esc(r.sku)} and its next steps</summary>${p1SkuCard(r.sku, ev)}</details></div>`;
}

/* ---------- THE WIP REPORT (Ravi, 28 Oct: "add the reports page which can generate this file and generate a page") ----------
 * The same figures as Production, one row per lot, on the page; "Download WIP (Excel)" writes his WIP.xlsx shape — WIP by
 * lot, WIP by order line, by SKU, the ledger of the period (his Sheet3 columns) and what is not started yet; "Open as a page"
 * opens it as a plain page to print or save. */
const P1_WXL = ['Ordered', 'Done', 'Balance', 'Greige / to print', 'At printer (pcs)', 'At printer (m)', 'Embroidery', 'To cut', 'Cut, in store', 'With karigar', 'QC', 'Ready', 'In process', 'Not started'];
const p1WxlVals = w => [w.q, w.done, w.bal, w.grg, w.prn, w.m, w.emb, w.cut, w.raw, w.kar, w.qc, w.rdy, w.inp, w.todo].map(v => Math.round((+v || 0) * 100) / 100);
const P1_LXL = ['Date', 'Vr no', 'Type', 'Process', 'Particulars', 'Lot no', 'SKU', 'Item', 'Family', 'Pattern', 'Pcs', 'Metres', 'Order no', 'Order date', 'Ref no', 'Entered by'];
const p1LedgerVals = e => [e.day, e.vr, P1_MV[e.k] ? P1_MV[e.k][0] : e.k, P1_PROC[e.k] || '', e.party, e.lot ? e.lotMon + ' ' + e.lot : '', e.sku, e.item, e.fam, e.pat, e.unit === 'm' ? '' : e.pcs, e.unit === 'm' ? e.pcs : '', e.orderNo, e.odate, e.ref, e.by];
/** Everything the WIP report shows, worked out once: the lots, their lines, the SKUs, the ledger of the period. */
function p1WipData() {
  const lots = p1Inv(), [from, to] = p1RangeDates(), today = p1Local();
  const lotRow = r => ({ r, w: p1WipTotal(r.wl) });
  const rows = lots.map(lotRow), lines = [];
  lots.forEach(r => r.wl.forEach(w => { const x = r.lines.find(y => obUC(y.r.orderNo) === w.orderNo); lines.push({ r, w, odate: x ? (p1Iso(x.r.orderDate) || x.r.openIso || String(x.r.orderDate || '')) : '' }); }));
  const sku = new Map(); lines.forEach(({ r, w }) => { const e = sku.get(w.sku) || sku.set(w.sku, { sku: w.sku, item: r.art, ws: [] }).get(w.sku); e.ws.push(w); });
  const skus = [...sku.values()].map(e => Object.assign(e, { w: p1WipTotal(e.ws) })).sort((a, b) => b.w.todo - a.w.todo || b.w.bal - a.w.bal);
  const ev = p1Events().filter(e => (!from || e.day >= from) && (!to || e.day <= to)).slice().reverse();
  return { rows, lines, skus, ev, from, to, today };
}
/** A .xlsx of several sheets, each a heading row and its rows, the heading frozen — written here (soZip stores the files). */
function p1Xlsx(sheets) {
  const cell = (v, ref, head) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${head ? ' s="1"' : ''}><v>${v}</v></c>`;
    const t = String(v == null ? '' : v); if (t === '') return '';
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`; };
  const ws = sh => {
    const all = [sh.head].concat(sh.rows), wid = sh.head.map((h, i) => Math.min(48, Math.max(8, ...all.slice(0, 400).map(r => String(r[i] == null ? '' : r[i]).length + 2))));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + `<cols>${wid.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`
      + all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, soColName(ci) + (ri + 1), ri === 0)).join('')}</row>`).join('')
      + `</sheetData><autoFilter ref="A1:${soColName(sh.head.length - 1)}${Math.max(1, all.length)}"/></worksheet>`; };
  const nm = s => soXml(String(s).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31));
  const files = [['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((s, i) => `<sheet name="${nm(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
      + `<definedNames>${sheets.map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${nm(s.name)}'!$A$1:$${soColName(s.head.length - 1)}$${s.rows.length + 1}</definedName>`).join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF0E7"/><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']];
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, ws(s)]));
  return soZip(files);
}
function p1WipSheets(D) {
  const lotTxt = r => r.lot ? r.lot.mon + ' ' + r.lot.no : 'To plan';
  return [
    { name: 'WIP', head: ['Lot no', 'Lot', 'Starts at', 'SKU', 'Item', 'Family', 'Orders'].concat(P1_WXL, ['Printer / karigar', 'Due']),
      rows: D.rows.map(({ r, w }) => [lotTxt(r), r.lot ? r.lot.id : '', r.lot ? P1_LOT_FROM[r.lot.end] || '' : '', r.sku, r.art, r.fam || '', [...r.orders].join(', ')].concat(p1WxlVals(w), [w.who.join(', '), r.due || ''])) },
    { name: 'WIP by line', head: ['Lot no', 'SKU', 'Order no', 'Order date'].concat(P1_WXL, ['Printer / karigar']),
      rows: D.lines.map(({ r, w, odate }) => [lotTxt(r), w.sku, w.orderNo, odate].concat(p1WxlVals(w), [w.who.join(', ')])) },
    { name: 'By SKU', head: ['SKU', 'Item'].concat(P1_WXL), rows: D.skus.map(e => [e.sku, e.item].concat(p1WxlVals(e.w))) },
    { name: 'Ledger', head: P1_LXL, rows: D.ev.map(p1LedgerVals) },
    { name: 'Not started', head: ['SKU', 'Not started (pcs)'], rows: D.skus.filter(e => e.w.todo > 0).map(e => [e.sku, e.w.todo]) }];
}
function p1WipExcel() {
  const D = p1WipData(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([p1Xlsx(p1WipSheets(D))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `PPC WIP ${D.today}.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
/** The WIP report as a page of its own — every sheet a table, to read, print or save. */
function p1WipPage() {
  const D = p1WipData(), sh = p1WipSheets(D), h = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const per = D.from || D.to ? `${D.from ? p1Day(D.from) : 'the start'} – ${D.to ? p1Day(D.to) : 'today'}` : 'all time';
  const tbl = s => `<h2>${h(s.name)} <small>${p1N(s.rows.length)} rows${s.name === 'Ledger' ? ' · ' + h(per) : ''}</small></h2><div class="w"><table><thead><tr>${s.head.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>`
    + s.rows.map(r => `<tr>${r.map(v => `<td${typeof v === 'number' ? ' class="n"' : ''}>${typeof v === 'number' ? (v ? p1N(v) : '') : h(v)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PPC WIP ${h(D.today)}</title><style>
    body{font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#14181F;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px}h2 small{color:#5A6472;font-weight:400;font-size:12px}
    .w{overflow:auto;border:1px solid #E8EDF3;border-radius:8px}table{border-collapse:collapse;width:100%}th{background:#EDF0E7;text-align:left;font-weight:600;position:sticky;top:0}
    th,td{padding:5px 8px;border-bottom:1px solid #E8EDF3;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}.top{display:flex;gap:10px;align-items:center}
    button{border:1px solid #CBD2DA;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}@media print{.top button{display:none}.w{overflow:visible;border:0}th{position:static}}</style></head><body>
    <div class="top"><div><h1>PPC — work in progress</h1><div style="color:#5A6472">R-one · made ${h(new Date().toLocaleString('en-IN'))} · ${p1N(D.rows.length)} lots in production</div></div><span style="flex:1"></span><button onclick="print()">Print</button></div>
    ${sh.map(tbl).join('')}</body></html>`;
  const u = URL.createObjectURL(new Blob([html], { type: 'text/html' })), w = window.open(u, '_blank');
  if (!w && typeof frToast === 'function') frToast('The browser blocked the new page — allow pop-ups for this site and press it again.', null, 6000);
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
/** The WIP card at the top of the Report view. */
function p1WipCard() {
  let D; try { D = p1WipData(); } catch (e) { return `<div class="card"><div class="empty" style="color:var(--bad)">Could not work out the WIP: ${esc(e.message || e)}</div></div>`; }
  const q = P1.q.trim().toUpperCase();
  const rows = D.rows.filter(({ r }) => !q || (r.sku + ' ' + (r.lot ? r.lot.no : '') + ' ' + [...r.orders].join(' ')).toUpperCase().includes(q))
    .map(({ r, w }) => ({ lead: [`<b class="p1-lotno sm${r.lot ? '' : ' new'}">${r.lot ? esc(p1LotTxt(r.lot)) : 'To plan'}</b>`, `<b>${esc(r.sku)}</b>`, esc(r.art), p1Ords([...r.orders])], w }));
  return `<div class="card" style="padding:0;overflow:hidden"><div class="rp-cap"><b>Work in progress — lot by lot</b><span class="muted"> · today, whatever the period; the ledger sheet of the file is the period</span>
      <span style="flex:1"></span><button type="button" class="ghost" data-p1wpage>Open as a page</button><button type="button" class="p1-go" data-p1wxl style="margin-left:6px">Download WIP (Excel)</button></div>
    ${p1WipTable(rows, { lead: [['Lot', 1], ['SKU', 1], ['Item', 1], ['Orders', 1]], max: '520px' })}</div>`;
}

/* ---------- PPC REPORT (Ravi, 26 Oct: "create a report page for ppc too where I can check what is the work I have given
 * and all") ----------
 * For a period: what was planned, sent out and came back — tiles for each step; the work given out by party (each printer,
 * each karigar, cutting) with what went, what came back and what is still out now, oldest first; who entered what; and the
 * day-by-day. Every figure is read from the same movements as the PPC ledger. Download gives the tables as a CSV file. */
const P1_RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['all', 'All'], ['custom', 'Pick dates']];
function p1RangeDates() {
  const iso = d => p1Local(d.getTime()), now = new Date(), r = P1.rr || '7';
  if (r === 'today') return [iso(now), iso(now)];
  if (r === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1, 12)), iso(now)];
  if (r === 'all') return ['', ''];
  if (r === 'custom') return [P1.rf || '', P1.rt || ''];
  return [iso(new Date(Date.now() - (+r - 1) * 864e5)), iso(now)];
}
/** The report's figures for the period: tiles, parties, people, days. */
function p1Report() {
  const [from, to] = p1RangeDates(), ev = p1Events().filter(e => (!from || e.day >= from) && (!to || e.day <= to));
  const pcs = k => ev.filter(e => e.k === k && e.unit !== 'm').reduce((t, e) => t + e.pcs, 0), mtr = k => ev.filter(e => e.k === k && e.unit === 'm').reduce((t, e) => t + e.pcs, 0);
  const tiles = [['IN', 'Orders in', pcs('IN')], ['PLAN', 'Planned', pcs('PLAN')], ['RFD', 'Fabric to printers', pcs('RFD'), mtr('RFD')], ['PRN', 'Printed back', pcs('PRN'), mtr('PRN')],
    ['CUT', 'Cut', pcs('CUT')], ['ISS', 'Given to karigars', pcs('ISS')], ['REC', 'Back from karigars', pcs('REC')], ['QC', 'QC passed', pcs('QC')], ['REJ', 'QC rejected', pcs('REJ')],
    ['FG', 'Into Finished Goods', pcs('FG')], ['SHIP', 'Handed to shipping', pcs('SHIP')], ['FBA', 'Dispatched to FBA', pcs('FBA')]];
  /* the parties: printers (fabric out → printed back), karigars (issued → received), cutting */
  const parties = new Map(), P = (kind, name) => { const k = kind + '|' + (name || '—'); return parties.get(k) || parties.set(k, { kind, name: name || '—', given: 0, back: 0, gm: 0, bm: 0, lines: new Set(), skus: new Set() }).get(k); };
  ev.forEach(e => {
    if (e.k === 'RFD') { const p = P('Printer', e.party); if (e.unit === 'm') p.gm += e.pcs; else p.given += e.pcs; p.lines.add(e.orderNo + '|' + e.sku); p.skus.add(e.sku); }
    else if (e.k === 'PRN') { const p = P('Printer', e.party); if (e.unit === 'm') p.bm += e.pcs; else p.back += e.pcs; }
    else if (e.k === 'ISS') { const p = P('Karigar', e.party); p.given += e.pcs; p.lines.add(e.orderNo + '|' + e.sku); p.skus.add(e.sku); }
    else if (e.k === 'REC') { const p = P('Karigar', e.party); p.back += e.pcs; }
    else if (e.k === 'CUT') { const p = P('Cutting', 'Cutting department'); p.given += e.pcs; p.lines.add(e.orderNo + '|' + e.sku); p.skus.add(e.sku); }
  });
  /* still out now (whatever the period): from where the pieces are today */
  const out = new Map();
  /* metres and pieces are kept apart (review, 26 Oct: they were added together); a print order not yet given is not with anyone */
  p1Wip().forEach(w => { const kind = w.stage === 'Printer' ? 'Printer' : w.stage === 'With karigar' ? 'Karigar' : null; if (!kind || w.ref === 'print order to give') return;
    const k = kind + '|' + (w.who || '—'), o = out.get(k) || out.set(k, { pcs: 0, m: 0, oldest: '', items: [] }).get(k);
    if (w.unit === 'm') o.m += w.pcs; else o.pcs += w.pcs; o.items.push(w); if (w.since && (!o.oldest || w.since < o.oldest)) o.oldest = w.since;
    if (!parties.has(k)) P(kind, w.who); });
  const rows = [...parties.values()].map(p => Object.assign(p, { out: out.get(p.kind + '|' + p.name) || { pcs: 0, m: 0, oldest: '', items: [] } }))
    .sort((a, b) => ['Printer', 'Karigar', 'Cutting'].indexOf(a.kind) - ['Printer', 'Karigar', 'Cutting'].indexOf(b.kind) || (b.out.pcs + b.out.m - a.out.pcs - a.out.m) || (b.given + b.gm - a.given - a.gm));
  /* who entered what */
  const people = new Map(), KS = ['PLAN', 'RFD', 'PRN', 'CUT', 'ISS', 'REC', 'QC', 'FG'];
  ev.forEach(e => { if (!e.by || !KS.includes(e.k)) return; const p = people.get(e.by) || people.set(e.by, { by: e.by, n: 0 }).get(e.by); p[e.k] = (p[e.k] || 0) + 1; p.n++; });
  /* day by day */
  const days = new Map(); ev.forEach(e => { if (!['PLAN', 'CUT', 'ISS', 'REC', 'QC', 'FG'].includes(e.k) || e.unit === 'm') return; const d = days.get(e.day) || days.set(e.day, { day: e.day }).get(e.day); d[e.k] = (d[e.k] || 0) + e.pcs; });
  return { from, to, n: ev.length, tiles, rows, people: [...people.values()].sort((a, b) => b.n - a.n), KS, days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)) };
}
function p1DrawReport() {
  const el = $('p1Home');
  let R; try { R = p1Report(); } catch (e) { el.innerHTML = `<div class="p1-head"><h1 class="lm-h">PPC</h1>${p1ViewSeg()}</div><div class="card"><div class="empty" style="color:var(--bad)">Could not read the registers: ${esc(e.message || e)}</div></div>`; return; }
  const q = P1.q.trim().toUpperCase(), kinds = ['Printer', 'Karigar', 'Cutting'];
  const rows = R.rows.filter(p => (!P1.rk || p.kind === P1.rk) && (!q || p.name.toUpperCase().includes(q) || [...p.skus].some(s => s.includes(q))));
  const qm = (n, m) => n || m ? [n ? p1N(n) + (m ? ' pcs' : '') : '', m ? p1N(m) + ' m' : ''].filter(Boolean).join(' · ') : '—';   // pieces and metres side by side, never added
  const per = R.from || R.to ? `${R.from ? p1Day(R.from) : 'the start'} – ${R.to ? p1Day(R.to) : 'today'}` : 'all time';
  el.innerHTML = `<div class="p1-head"><h1 class="lm-h">PPC</h1>${p1ViewSeg()}<input type="search" class="p1-q" id="p1Q" placeholder="Search a lot, printer, karigar or SKU…" value="${esc(P1.q)}"></div>
    <div class="p1-segrow" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="seg">${P1_RANGES.map(r => `<button type="button" class="segbtn${(P1.rr || '7') === r[0] ? ' on' : ''}" data-p1rr="${r[0]}">${r[1]}</button>`).join('')}</div>
      ${(P1.rr || '7') === 'custom' ? `<label class="rp-date">From <input type="date" data-p1rd="rf" value="${esc(P1.rf || '')}"></label><label class="rp-date">To <input type="date" data-p1rd="rt" value="${esc(P1.rt || '')}"></label>` : ''}
      <span class="muted" style="font-size:12.5px">${esc(per)} · ${p1N(R.n)} movements</span><span style="flex:1"></span><button type="button" class="ghost" data-p1csv>Download (CSV)</button></div>
    <div class="rp-tiles">${R.tiles.map(t => `<div><b>${t[3] && !t[2] ? p1N(t[3]) + '<small> m</small>' : p1N(t[2]) + (t[3] ? `<small> pcs · ${p1N(t[3])} m</small>` : '')}</b><span>${esc(t[1])}</span></div>`).join('')}</div>
    ${p1WipCard()}
    <div class="card" style="padding:0;overflow:hidden"><div class="rp-cap"><b>Work given out — and what came back</b><span class="muted"> · given and back in the period; still out is today</span>
      <span style="flex:1"></span><div class="seg">${[['', 'All'], ['Printer', 'Printers'], ['Karigar', 'Karigars'], ['Cutting', 'Cutting']].map(k => `<button type="button" class="segbtn${(P1.rk || '') === k[0] ? ' on' : ''}" data-p1rk="${k[0]}">${k[1]} <span class="n">${R.rows.filter(p => !k[0] || p.kind === k[0]).length}</span></button>`).join('')}</div></div>
    <div class="ff-grid" style="max-height:none"><table class="xl"><thead><tr><th class="frz" style="text-align:left">Given to</th><th>Type</th><th>Given</th><th>Back</th><th>Still out now</th><th>Oldest out</th><th>SKUs</th><th></th></tr></thead><tbody>
    ${rows.map((p, i) => { const open = P1.rexp === p.kind + '|' + p.name, d = p1Days(p.out.oldest);
      return `<tr><td class="frz" style="text-align:left"><b>${esc(p.name)}</b></td><td><span class="pl ${p.kind === 'Printer' ? 'mv-mat' : p.kind === 'Karigar' ? 'mv-make' : 'mv-plan'}">${p.kind}</span></td>
        <td class="num">${qm(p.given, p.gm)}</td><td class="num">${qm(p.back, p.bm)}</td>
        <td class="num"><b${p.out.pcs || p.out.m ? ' style="color:var(--bad)"' : ''}>${qm(p.out.pcs, p.out.m)}</b></td>
        <td class="num">${p.out.oldest ? `${p1Day(p.out.oldest)} · <b${d > 7 ? ' style="color:var(--bad)"' : ''}>${d} d</b>` : '—'}</td><td class="num">${p.skus.size || p.out.items.length ? p1N(new Set([...p.skus, ...p.out.items.map(w => w.sku)]).size) : '—'}</td>
        <td>${p.out.items.length ? `<button type="button" class="cellbtn${open ? ' on' : ''}" data-p1rexp="${esc(p.kind + '|' + p.name)}">${open ? 'Hide' : 'What is out'} <span class="caret">${open ? '▴' : '▾'}</span></button>` : ''}</td></tr>
        ${open ? `<tr class="invdet"><td colspan="8"><div class="invdrop"><div class="sect">Still out with ${esc(p.name)}</div><div class="box scroll"><table class="ct li"><thead><tr><th>SKU</th><th>Order</th><th class="num">Pcs</th><th>Since</th><th class="num">Days</th><th>Reference</th></tr></thead><tbody>
          ${p.out.items.sort((a, b) => String(a.since || '9').localeCompare(String(b.since || '9'))).map(w => { const dd = p1Days(w.since); return `<tr><td class="b">${esc(w.sku)}</td><td>${p1Ords(w.orderNo)}</td><td class="num b">${p1N(w.pcs)}${w.unit === 'm' ? ' m' : ''}</td><td>${p1Day(w.since)}</td><td class="num"${dd > 7 ? ' style="color:var(--bad);font-weight:700"' : ''}>${dd == null ? '—' : dd}</td><td class="muted">${esc(w.ref || '')}</td></tr>`; }).join('')}
          </tbody></table></div></div></td></tr>` : ''}`; }).join('') || '<tr><td colspan="8" class="empty">No work given out in this period.</td></tr>'}
    </tbody></table></div></div>
    <div class="rp-two"><div class="card" style="padding:0;overflow:hidden"><div class="rp-cap"><b>Who entered what</b><span class="muted"> · entries in the period</span></div>
      <div class="ff-grid" style="max-height:420px"><table class="xl"><thead><tr><th class="frz" style="text-align:left">Person</th>${R.KS.map(k => `<th>${esc(P1_MV[k][0])}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${R.people.map(p => `<tr><td class="frz" style="text-align:left"><b>${esc(p.by)}</b></td>${R.KS.map(k => `<td class="num">${p[k] ? p1N(p[k]) : '<span class="muted">—</span>'}</td>`).join('')}<td class="num"><b>${p1N(p.n)}</b></td></tr>`).join('') || `<tr><td colspan="${R.KS.length + 2}" class="empty">Nobody entered anything in this period.</td></tr>`}</tbody></table></div></div>
    <div class="card" style="padding:0;overflow:hidden"><div class="rp-cap"><b>Day by day</b><span class="muted"> · pieces</span></div>
      <div class="ff-grid" style="max-height:420px"><table class="xl"><thead><tr><th class="frz" style="text-align:left">Day</th><th>Planned</th><th>Cut</th><th>To karigars</th><th>Back</th><th>QC passed</th><th>Into FG</th></tr></thead><tbody>
      ${R.days.map(d => `<tr><td class="frz" style="text-align:left">${p1Day(d.day)}</td>${['PLAN', 'CUT', 'ISS', 'REC', 'QC', 'FG'].map(k => `<td class="num">${d[k] ? p1N(d[k]) : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing in this period.</td></tr>'}</tbody></table></div></div></div>`;
  const on = (sel, fn, ev2 = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev2] = e => fn(b, e); });
  on('[data-p1view]', b => { P1.view = b.dataset.p1view; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1rr]', b => { P1.rr = b.dataset.p1rr; P1.rexp = ''; p1Draw(); });
  on('[data-p1rd]', b => { P1[b.dataset.p1rd] = b.value; p1Draw(); }, 'onchange');
  on('[data-p1rk]', b => { P1.rk = b.dataset.p1rk; P1.rexp = ''; p1Draw(); });
  on('[data-p1rexp]', b => { P1.rexp = P1.rexp === b.dataset.p1rexp ? '' : b.dataset.p1rexp; p1Draw(); });
  on('[data-p1csv]', () => p1ReportCsv(R));
  on('[data-p1wxl]', () => p1WipExcel());
  on('[data-p1wpage]', () => p1WipPage());
  const qi = el.querySelector('#p1Q'); if (qi) qi.oninput = () => { P1.q = qi.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { p1Draw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
}
/** The report as a CSV file: the work given out, then who entered what, then day by day. */
function p1ReportCsv(R) {
  const c = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }, L = [];
  L.push(['PPC report', R.from || 'start', R.to || 'today'].map(c).join(','), '');
  L.push(['Given to', 'Type', 'Given (pcs)', 'Given (m)', 'Back (pcs)', 'Back (m)', 'Still out (pcs)', 'Still out (m)', 'Oldest out', 'Days', 'SKUs'].map(c).join(','));
  R.rows.forEach(p => L.push([p.name, p.kind, p.given, p.gm, p.back, p.bm, p.out.pcs, p.out.m, p.out.oldest, p1Days(p.out.oldest) ?? '', new Set([...p.skus, ...p.out.items.map(w => w.sku)]).size].map(c).join(',')));
  L.push('', ['Person'].concat(R.KS.map(k => P1_MV[k][0]), ['Total']).map(c).join(','));
  R.people.forEach(p => L.push([p.by].concat(R.KS.map(k => p[k] || 0), [p.n]).map(c).join(',')));
  L.push('', ['Day', 'Planned', 'Cut', 'To karigars', 'Back', 'QC passed', 'Into FG'].map(c).join(','));
  R.days.forEach(d => L.push([d.day].concat(['PLAN', 'CUT', 'ISS', 'REC', 'QC', 'FG'].map(k => d[k] || 0)).map(c).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv' }));
  a.download = `PPC report ${R.from || 'start'} to ${R.to || p1Local()}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const p1ViewSeg = () => `<div class="seg p1-views">${[['inv', 'Production'], ['ledger', 'PPC ledger'], ['report', 'Report']].map(v => `<button type="button" class="segbtn${P1.view === v[0] ? ' on' : ''}" data-p1view="${v[0]}">${v[1]}</button>`).join('')}</div>`;

function p1Draw() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="p1-head"><h1 class="lm-h">PPC</h1><span class="muted">Reading the order book, plans and registers…</span></div>'; return; }
  if (P1.view === 'ledger') p1DrawLedger(); else if (P1.view === 'report') p1DrawReport(); else p1DrawInv();
  if (P1.built) p1MeeraFirst();
}
function p1DrawLedger() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="lg-top"><h1>PPC ledger</h1><span class="lg-note">Reading the order book, plans and registers…</span></div>'; return; }
  let ev = [];
  try { ev = p1Events(); } catch (e) { el.innerHTML = `<div class="lg-top"><h1>PPC ledger</h1></div><div class="lg-card"><div class="empty" style="color:var(--bad)">Could not read the registers: ${esc(e.message || e)}</div></div>`; return; }
  const f = P1.f, q = P1.q.trim().toUpperCase();
  const idx = [];
  for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i];
    if ((f.kind && e.k !== f.kind) || (f.lot && ![e.lot, e.lotId, e.lotMon + ' ' + e.lot].some(v => String(v).toUpperCase() === f.lot)) || (f.sku && e.sku !== f.sku) || (f.ord && e.orderNo !== f.ord) || (f.from && e.day < f.from) || (f.to && e.day > f.to)) continue;
    if (f.party && !(e.party + ' ' + e.by).toUpperCase().includes(f.party.toUpperCase())) continue;
    if (q && !(e.sku + ' ' + e.orderNo + ' ' + e.party + ' ' + e.by + ' ' + e.ref + ' ' + e.lot + ' ' + e.vr + ' ' + e.item + ' ' + e.fam).toUpperCase().includes(q)) continue;
    idx.push(i); }
  const inP = idx.reduce((a, i) => a + (ev[i].k === 'IN' ? ev[i].pcs : 0), 0), outP = idx.reduce((a, i) => a + (P1_END.has(ev[i].k) ? ev[i].pcs : 0), 0);
  const shown = idx.slice(0, P1.lim);
  /* THE WIP SHEET'S LEDGER (Ravi, 28 Oct, WIP.xlsx Sheet3): date, voucher, type, process, particulars, lot, SKU, item,
   * family, pieces, metres, order and its date, reference — one movement a line, newest first */
  let body = '';
  const thisMon = p1Local().slice(2, 4) + p1Local().slice(5, 7);   // a lot of this month is just 001-GR, as on Production
  shown.forEach(i => { const e = ev[i], sign = e.k === 'IN' ? '+' : P1_END.has(e.k) || e.k === 'BACK' ? '−' : '';
    body += `<tr><td class="nw">${e.day ? p1Day(e.day) : '<span class="muted">—</span>'}${e.t ? ` <span class="muted">${new Date(e.ms).toTimeString().slice(0, 5)}</span>` : ''}</td><td class="muted nw">${esc(e.vr || '')}</td><td>${p1Mv(e)}</td><td class="nw">${esc(P1_PROC[e.k] || '')}</td>
      <td>${e.party ? esc(e.party) : '<span class="muted">—</span>'}</td><td class="nw">${e.lot ? `<a class="lg-lot" data-p1lot="${esc(e.lotId)}" title="Every movement of this lot">${esc(String(e.lotId).slice(0, 4) === thisMon ? e.lot : e.lotMon + ' ' + e.lot)}</a>` : '<span class="muted">—</span>'}</td>
      <td><a class="lg-sku${P1.openAt === p1EvId(e) ? ' on' : ''}" data-p1sku="${esc(e.sku)}" data-p1at="${esc(p1EvId(e))}">${esc(e.sku)}</a></td><td class="nw">${esc(e.item)}</td><td class="muted nw">${esc(e.fam)}</td>
      <td class="num">${e.unit === 'm' ? '' : `<b class="${sign === '+' ? 'q-in' : sign === '−' ? 'q-out' : ''}">${sign}${p1N(e.pcs)}</b>`}</td><td class="num">${e.unit === 'm' ? `<b>${p1N(e.pcs)}</b>` : ''}</td>
      <td class="nw">${e.orderNo ? `<a class="lg-ord" data-p1ord="${esc(e.orderNo)}">${esc(e.orderNo)}</a>` : '<span class="muted">—</span>'}</td><td class="nw muted">${e.odate ? p1Day(e.odate) : ''}</td><td class="muted ref">${esc(e.ref)}</td>
      <td class="nw">${e.by ? `<span class="av">${esc(e.by.slice(0, 2).toUpperCase())}</span> ${esc(e.by)}` : '<span class="muted">—</span>'}</td></tr>`;
    if (P1.openAt === p1EvId(e)) body += `<tr class="lg-exp"><td colspan="15">${p1SkuCard(e.sku, ev)}</td></tr>`; });
  const skus = [...new Set(ev.map(e => e.sku))].sort(), today = p1Local(), ago = d => p1Local(Date.now() - d * 864e5);
  const range = [['Today', today, today], ['7 days', ago(6), ''], ['30 days', ago(29), ''], ['All', '', '']];
  el.innerHTML = `<div class="lg-top">${p1ViewSeg()}<div><h1>PPC ledger</h1><div class="lg-note" style="margin:2px 0 0">Every step of every SKU — from the order coming in to leaving production — with who did it and when.</div></div>
      <input class="lg-q" id="p1Q" placeholder="Search SKU, order, karigar, printer, person…" value="${esc(P1.q)}"><span class="lg-when">${P1.err ? `<b style="color:var(--bad)">Could not read everything: ${esc(P1.err)}</b> · ` : ''}${P1.loading ? 'Reading…' : 'Read ' + (P1.at || '—')} · <a data-p1r>↻ Refresh</a></span></div>
    <div class="lg-addrow"><span class="lg-note" style="margin:0">Add a movement:</span>${P1_ADD.filter(a => p1MayTab(a[2])).map(a => { const n = ['QC', 'FG', 'PRN', 'SHIP'].includes(a[0]) ? p1Waiting(a[0]).length : new Set(p1Waiting(a[0]).map(x => a[0] === 'PLAN' || a[0] === 'RFD' ? obUC(x.r.sku) : x.s.key)).size;
      return `<button type="button" class="lg-add${P1.act === a[0] ? ' on' : ''}" data-p1add="${a[0]}"><span class="pl ${P1_MV[a[0]][1]}" style="padding:0 6px">+</span>${esc(a[1])}${n ? ` <i>${p1N(n)}</i>` : ''}</button>`; }).join('')}</div>
    ${P1.act ? p1WaitCard(P1.act) : ''}
    <div class="lg-card lg-filt"><div class="lg-range">${range.map(r => `<button type="button" class="${f.from === r[1] && f.to === r[2] ? 'on' : ''}" data-p1rg="${r[1]}|${r[2]}">${r[0]}</button>`).join('')}</div>
      <label>From<input type="date" data-p1f="from" value="${f.from}"></label><label>To<input type="date" data-p1f="to" value="${f.to}"></label>
      <label>Movement<select data-p1f="kind"><option value="">All</option>${Object.entries(P1_MV).map(([k, v]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <label>Lot<input data-p1f="lot" value="${esc(f.lot || '')}" placeholder="All" style="width:110px"></label>
      <label>SKU<input list="p1Skl2" data-p1f="sku" value="${esc(f.sku)}" placeholder="All" style="width:170px"></label><datalist id="p1Skl2">${skus.slice(0, 3000).map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Order<input data-p1f="ord" value="${esc(f.ord || '')}" placeholder="All" style="width:130px"></label>
      <label>Karigar / printer / person<input data-p1f="party" value="${esc(f.party || '')}" placeholder="All" style="width:150px"></label>
      ${f.from || f.to || f.kind || f.lot || f.sku || f.ord || f.party ? '<button type="button" class="lg-go" data-p1fclr>Clear the filter</button>' : ''}</div>
    <div class="lg-card"><div class="lg-cap"><b>${p1N(idx.length)}</b> of ${p1N(ev.length)} movements · <b class="q-in">+${p1N(inP)}</b> pcs ordered in · <b class="q-out">−${p1N(outP)}</b> pcs sent from production.
      Click a lot for every movement of that lot, a SKU for its card. Nothing here is a stored total — every figure is read from the registers.</div>
    <div class="lg-scroll"><table class="lg-t"><thead><tr><th>Date</th><th>Vr no</th><th>Type</th><th>Process</th><th>Particulars</th><th>Lot no</th><th>SKU</th><th>Item</th><th>Family</th><th class="num">Pcs</th><th class="num">Metres</th><th>Order no</th><th>Order date</th><th>Ref no</th><th>Entered by</th></tr></thead><tbody>
    ${body || '<tr><td colspan="15" class="empty">No movement matches the filter.</td></tr>'}</tbody></table></div>
    ${idx.length > P1.lim ? `<button type="button" class="lg-more" data-p1lim>Show ${p1N(Math.min(idx.length, P1.lim + 700) - P1.lim)} more</button>` : ''}</div>`;
  p1Wire(el);
}
function p1Wire(el) {
  const on = (sel, fn, ev = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev] = e => fn(b, e); });
  const redraw = () => { P1.lim = 300; P1.openAt = ''; p1Draw(); };
  on('[data-p1view]', b => { P1.view = b.dataset.p1view; P1.lim = 300; p1Draw(); window.scrollTo(0, 0); });
  on('[data-p1add]', b => { const k = b.dataset.p1add, sku = b.dataset.p1addSku || '';
    if (sku) { const gs = p1Groups(k, sku); if (gs.length === 1) return p1Do(k, gs[0][1]); P1.f.sku = sku; P1.act = k; }   // the SKU card: straight to the form when there is one line
    else P1.act = P1.act === k ? '' : k;
    P1.f.kind = P1.act; P1.lim = 300; P1.openAt = ''; p1Draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  on('[data-p1act-off]', () => { P1.act = ''; P1.f.kind = ''; redraw(); });
  on('[data-p1do]', b => { const g = (P1.groups || [])[+b.dataset.p1do]; if (g) p1Do(P1.act, g[1]); });
  on('[data-p1sku]', b => { const id = b.dataset.p1at; P1.openAt = P1.openAt === id ? '' : id; p1Draw(); });   // the card opens under this row; the ledger stays as it is
  on('[data-p1ord]', b => { P1.f.ord = b.dataset.p1ord; redraw(); });
  on('[data-p1lot]', b => { P1.f.lot = String(b.dataset.p1lot).toUpperCase(); redraw(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  on('[data-p1close]', () => { P1.openAt = ''; p1Draw(); });
  on('[data-p1only]', b => { P1.f.sku = b.dataset.p1only; P1.openAt = ''; redraw(); });
  on('[data-p1rg]', b => { const [a, z] = b.dataset.p1rg.split('|'); P1.f.from = a; P1.f.to = z; redraw(); });
  on('[data-p1f]', b => { const k = b.dataset.p1f; P1.f[k] = k === 'sku' || k === 'ord' || k === 'lot' ? obUC(b.value) : b.value; redraw(); }, 'onchange');
  on('[data-p1fclr]', () => { P1.f = { from: '', to: '', kind: '', lot: '', sku: '', ord: '', party: '' }; P1.act = ''; redraw(); });
  on('[data-p1lim]', () => { P1.lim += 700; p1Draw(); });
  on('[data-p1r]', (b, e) => { e.preventDefault(); p1Load(true); });
  const q = el.querySelector('#p1Q'); if (q) q.oninput = () => { P1.q = q.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { redraw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
}
/* ---------- Meera on this page (Ravi, 26 Oct: "design meera for this page too") ----------
 * Her walk-rounds of both views (guide.js reads GUIDE_TOURS by name), the first one on a person's first visit while the
 * helper is on; and she knows this page is the one in front — "ye screen kya hai", Show me and her buttons all mean PPC
 * here (gaHere / gaGo / gaTabName / guideMayOpen are wrapped, Meera's own files are not changed). Her written answers
 * about this page are in meera-ppc.js, merged into her answer bank. */
if (typeof GUIDE_TOURS !== 'undefined') {
  GUIDE_TOURS.ppc = [
    { en: 'This is <b>PPC</b> — every production lot on one page. A lot is one SKU’s plan: the orders planned together for it.', hi: 'यह <b>PPC</b> है — हर प्रोडक्शन लॉट एक ही पेज पर। लॉट मतलब एक SKU का प्लान: उसके साथ प्लान हुए ऑर्डर।' },
    { sel: '#p1Home tr.p1r td.lot', en: '<b>Lot</b> — 001, 002… from the 1st of each month. The ending says where it starts: <b>GR</b> greige, <b>CT</b> cutting, <b>JW</b> Job Work, <b>OS</b> outsourced. Click it to see where every piece and part of the lot is.', hi: '<b>Lot</b> — हर महीने की 1 तारीख़ से 001, 002…। आख़िर के अक्षर बताते हैं कहाँ से शुरू: <b>GR</b> ग्रेज, <b>CT</b> कटिंग, <b>JW</b> जॉब वर्क, <b>OS</b> बाहर से। क्लिक करें तो लॉट का हर पीस और हिस्सा कहाँ है, दिखेगा।' },
    { sel: '#p1Home .p1-att', en: '<b>Late and stuck</b> comes first: the lots past their due date, and the lots whose pieces have sat at one place for more than 7 days — where they are held, with whom, for how many days and by how much they are late, worst first. Click a line to open that lot below; the button is its next step.', hi: '<b>Late and stuck</b> सबसे ऊपर: जिन लॉट की तारीख़ निकल गई, और जिनके पीस किसी एक जगह 7 दिन से ज़्यादा रुके हैं — कहाँ रुके, किसके पास, कितने दिन से और कितने दिन लेट, सबसे बुरे पहले। लाइन पर क्लिक करें तो वह लॉट नीचे खुलेगा; बटन उसका अगला काम है।' },
    { sel: '#p1Home .p1-stages', en: 'These boxes count the SKUs at each stage — to plan, fabric & printer, cutting, with karigars, QC, ready. Click one to see only those.', hi: 'ये बॉक्स हर स्टेज के SKU गिनते हैं — प्लान, फ़ैब्रिक और प्रिंटर, कटिंग, कारीगर, QC, तैयार। किसी पर क्लिक करें तो सिर्फ़ वही दिखेंगे।' },
    { sel: '#p1Home tr.p1r td.ord', en: '<b>Orders</b>: how many pieces are ordered, on how many orders, and how many are <b>not planned</b> yet (in red).', hi: '<b>Orders</b>: कितने पीस ऑर्डर हैं, कितने ऑर्डर में, और कितने अभी <b>प्लान नहीं</b> हुए (लाल में)।' },
    { sel: '#p1Home tr.p1r td.where', en: '<b>Where it is now — and who has it</b>: the printer, cutting, each karigar by name, QC — with how many days it has been there. Red means more than 7 days.', hi: '<b>अभी कहाँ है — और किसके पास</b>: प्रिंटर, कटिंग, हर कारीगर का नाम, QC — और कितने दिन से वहाँ है। लाल मतलब 7 दिन से ज़्यादा।' },
    { sel: '#p1Home tr.p1r td.due', en: '<b>Due</b> is the ready date from the plan. Late SKUs come first, with a red edge on the left.', hi: '<b>Due</b> प्लान की तैयार होने की तारीख़ है। देर वाले SKU सबसे ऊपर आते हैं, बाईं तरफ़ लाल पट्टी के साथ।' },
    { sel: '#p1Home .p1-go', en: 'One button per SKU — its <b>next step</b>: Plan, Make challan, Receive printed, Enter cutting, Give to karigar, Receive, Check in QC or Accept. It opens the real form, filled in.', hi: 'हर SKU का एक बटन — उसका <b>अगला काम</b>: Plan, Make challan, Receive printed, Enter cutting, Give to karigar, Receive, Check in QC या Accept। असली फ़ॉर्म भरा हुआ खुलता है।' },
    { sel: '#p1Home tr.p1r', en: 'Click a line to open the lot under it: its parts (fabric, ruffle, accessories), then each order with ordered, done, balance, greige, printer, cutting, karigar, QC, ready — like the WIP sheet.', hi: 'किसी लाइन पर क्लिक करें तो उसके नीचे लॉट खुलता है: उसके हिस्से (फ़ैब्रिक, रफ़ल, एक्सेसरी), फिर हर ऑर्डर — ऑर्डर, बना, बाकी, ग्रेज, प्रिंटर, कटिंग, कारीगर, QC, तैयार — WIP शीट की तरह।' },
    { sel: '#p1Q', en: 'Search finds a SKU, an order, a karigar or a printer.', hi: 'सर्च में SKU, ऑर्डर, कारीगर या प्रिंटर का नाम लिखें।' },
    { sel: '#p1Home .p1-views', en: '<b>PPC ledger</b> shows every step of every SKU — who did what, and when. Ask me anything about this page with my round button.', hi: '<b>PPC ledger</b> में हर SKU का हर कदम है — किसने क्या किया, कब। इस पेज के बारे में कुछ भी पूछना हो तो मेरे गोल बटन से पूछें।' }];
  GUIDE_TOURS.ppcreport = [
    { en: 'This is the <b>PPC report</b> — the work given out in a period, and what came back.', hi: 'यह <b>PPC report</b> है — किसी समय में दिया गया काम, और क्या वापस आया।' },
    { sel: '#p1Home .p1-segrow', en: 'Pick the period — today, 7 days, 30 days, this month, all, or your own dates. <b>Download</b> saves the tables as a CSV file.', hi: 'समय चुनें — आज, 7 दिन, 30 दिन, इस महीने, सब, या अपनी तारीखें। <b>Download</b> से टेबल CSV फ़ाइल में सेव होती है।' },
    { sel: '#p1Home .p1-wip', en: '<b>Work in progress — lot by lot</b>: where every lot is today. <b>Download WIP (Excel)</b> gives the WIP file (by lot, by order line, by SKU, the ledger, not started); <b>Open as a page</b> opens it to print.', hi: '<b>Work in progress — lot by lot</b>: आज हर लॉट कहाँ है। <b>Download WIP (Excel)</b> से WIP फ़ाइल मिलती है (लॉट, ऑर्डर लाइन, SKU, लेजर, शुरू नहीं हुआ); <b>Open as a page</b> से प्रिंट के लिए पेज खुलता है।' },
    { sel: '#p1Home .rp-tiles', en: 'Each box counts one step in the period: orders in, planned, fabric to printers, printed back, cut, to karigars, back, QC, into Finished Goods, handed over.', hi: 'हर बॉक्स उस समय का एक कदम गिनता है: ऑर्डर आए, प्लान, प्रिंटर को फ़ैब्रिक, प्रिंट होकर वापस, कटिंग, कारीगर को, वापस, QC, Finished Goods में, सौंपे गए।' },
    { sel: '#p1Home .rp-cap', en: '<b>Work given out</b>: each printer, each karigar and cutting — what was given and what came back in the period, and what is <b>still out today</b> with the oldest date. <b>What is out</b> lists it line by line.', hi: '<b>Work given out</b>: हर प्रिंटर, हर कारीगर और कटिंग — उस समय में कितना दिया और कितना वापस आया, और <b>आज कितना बाहर है</b> सबसे पुरानी तारीख़ के साथ। <b>What is out</b> लाइन-दर-लाइन दिखाता है।' },
    { sel: '#p1Home .rp-two', en: '<b>Who entered what</b> counts each person’s entries; <b>Day by day</b> shows the pieces each day.', hi: '<b>Who entered what</b> हर व्यक्ति की एंट्री गिनता है; <b>Day by day</b> हर दिन के पीस दिखाता है।' }];
  GUIDE_TOURS.ppcledger = [
    { en: 'This is the <b>PPC ledger</b> — every step of every SKU, newest first, like the Greige Desk\'s fabric ledger.', hi: 'यह <b>PPC ledger</b> है — हर SKU का हर कदम, नया सबसे ऊपर, ग्रेज डेस्क के फ़ैब्रिक लेजर की तरह।' },
    { sel: '#p1Home .lg-addrow', en: '<b>Add a movement</b>: press a step to see only what is waiting for it, each with the button that opens its form.', hi: '<b>Add a movement</b>: किसी कदम पर दबाएँ तो सिर्फ़ उसका बाकी काम दिखेगा, हर एक के साथ उसका फ़ॉर्म खोलने वाला बटन।' },
    { sel: '#p1Home .lg-filt', en: 'Filter by day, movement, SKU, order or person — Today, 7 days and 30 days are one click.', hi: 'दिन, कदम, SKU, ऑर्डर या व्यक्ति से छाँटें — Today, 7 days, 30 days एक क्लिक में।' },
    { sel: '#p1Home .lg-t', en: 'Each line, like the WIP sheet: date, voucher no, type, process, particulars (printer or karigar), <b>lot no</b>, SKU, item, family, pieces or metres, order and its date, reference, and <b>who entered it</b>.', hi: 'हर लाइन, WIP शीट की तरह: तारीख़, वाउचर नंबर, टाइप, प्रोसेस, पार्टी (प्रिंटर या कारीगर), <b>लॉट नंबर</b>, SKU, आइटम, फ़ैमिली, पीस या मीटर, ऑर्डर और उसकी तारीख़, रेफ़रेंस, और <b>किसने डाला</b>।' },
    { sel: '#p1Home .lg-lot', en: 'Click a lot number to see every movement of that lot.', hi: 'लॉट नंबर पर क्लिक करें तो उस लॉट का हर कदम दिखेगा।' },
    { sel: '#p1Home .lg-sku', en: 'Click a SKU to open its card right under that line.', hi: 'किसी SKU पर क्लिक करें तो उसी लाइन के नीचे उसका कार्ड खुलता है।' }];
}
(function p1Meera(n) {
  if (typeof gaHere !== 'function' || typeof guideStart !== 'function') { if (n > 0) setTimeout(() => p1Meera(n - 1), 500); return; }
  const here = gaHere; gaHere = function () { return P1.shown ? (P1.view === 'ledger' ? 'ppcledger' : P1.view === 'report' ? 'ppcreport' : 'ppc') : here.apply(this, arguments); };
  if (typeof gaGo === 'function') { const go = gaGo; gaGo = function (tab) { if (tab === 'ppc' || tab === 'ppcledger' || tab === 'ppcreport') { P1.view = tab === 'ppcledger' ? 'ledger' : tab === 'ppcreport' ? 'report' : 'inv'; return p1Show(); } return go.apply(this, arguments); }; }
  if (typeof gaTabName === 'function') { const nm = gaTabName; gaTabName = function (tab) { return tab === 'ppc' ? 'PPC' : tab === 'ppcledger' ? 'PPC ledger' : tab === 'ppcreport' ? 'PPC report' : nm.apply(this, arguments); }; }
  if (typeof guideMayOpen === 'function') { const may = guideMayOpen; guideMayOpen = function (tab) { return tab === 'ppc' || tab === 'ppcledger' || tab === 'ppcreport' ? p1May() : may.apply(this, arguments); }; }
})(40);
/** Her walk-round, the first time a person opens a view (while the helper is on), once the lines are on the page. */
function p1MeeraFirst() {
  if (typeof guideIsOn !== 'function' || !guideIsOn() || typeof guideSeen !== 'function') return;
  const name = P1.view === 'ledger' ? 'ppcledger' : P1.view === 'report' ? 'ppcreport' : 'ppc';
  if (guideSeen().includes(name) || P1.meeraQ === name) return;
  P1.meeraQ = name;
  setTimeout(() => { P1.meeraQ = ''; if (P1.shown && P1.built && !(typeof GUIDE !== 'undefined' && GUIDE.tour) && (({ ledger: 'ppcledger', report: 'ppcreport' })[P1.view] || 'ppc') === name) { guideMarkSeen(name); guideStart(name, false); } }, 1500);
}
async function p1Load(force) {
  if (P1.loading) return;
  P1.loading = true; p1Draw();
  try {
    /* ↻ Refresh reads every register again — the order book, cutting, Job Work and press (ptLoadGates), QC and Finished
     * Goods too, not only the plans and challans (review, 26 Oct: other people's entries never appeared) */
    if (force) { if (typeof ptLoadGates === 'function') await ptLoadGates(true); if (typeof QC !== 'undefined') QC.checks = null; if (typeof FGI !== 'undefined') FGI.rows = null; if (typeof flowLoad === 'function') await flowLoad(true); }
    await flowEnsureData(); if (typeof QC !== 'undefined' && QC.checks == null && typeof ensureQc === 'function') await ensureQc();
    P1.err = '';
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
  /* THE MENU ITEM FOLLOWS THE PERSON'S ACCESS (Ravi, 26 Oct: "app pe PPC kabhi dikh nahi raha"): it was decided once, the
   * first second a person was known — often before their screens had arrived, so it stayed hidden. Now it is decided
   * again whenever the menu is (syncNavGroups), and every 2 s for the first minute. */
  const may = () => { a.style.display = p1May() ? '' : 'none'; };
  if (typeof syncNavGroups === 'function') { const sync = syncNavGroups; syncNavGroups = function () { const r = sync.apply(this, arguments); may(); return r; }; }
  let tries = 0; const t = setInterval(() => { if (ME && ME.email) may(); if (++tries > 30) clearInterval(t); }, 2000);
}
(function p1Start(n) { if (document.querySelector('main.main') && typeof $ === 'function' && $('tabFlow')) p1Build(); else if (n > 0) setTimeout(() => p1Start(n - 1), 300); })(60);
