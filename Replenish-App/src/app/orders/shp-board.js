/* ================= SHP BOARD — Shopify orders, stage by stage (TEST WINDOW) =================
 *
 * Ravi, 28 Oct: "Ek test window banao for only SHP … sath sath me mention kar saku ki ye order kab ready hoga (live nahi karna
 * h, test window m rakhna h)". His sheet: Date · Order ID · Item · Pieces, then a column for each stage (cut · Issued · Received ·
 * Q.C Passed · Press) and "Handed to shipping", which belongs in the Complete tab, date wise. Same day, on the first version:
 * "Yaha indivisual line item dikhe with date bhi and printer karigar issue receive q.c pass press sab yanhi se manage kar
 * saku" — so ONE ROW PER ORDER LINE, and every step is done from the row, in a dialog, through the SAME forms and checks the
 * registers use (the cutting form, the Job Work issue form, Receive, Waiting for QC, the shipping hand-over, the PPC plan).
 *
 * Each stage cell says what reached that stage and how much of it has MOVED ON to the next one — "4 − (4 moved)" — and what
 * is still sitting there is the work to do, with the button for that work in the same cell:
 *   pieces → printing order · cut → cutting · issued / received → Job Work · QC passed → Quality Control · press → hand over.
 * Nothing is computed here that the Order Console does not already know: the figures are ordLines(), the hand-over is
 * shpReceive(). The one new thing is WHEN EACH ORDER WILL BE READY: a date per order line, typed here, kept on
 * pt_shpBoardTest/<order>__<sku> (a test node; nothing live reads it). Until one is typed the board shows the date PPC
 * planned (pt_ppc … dates.ready), else the make-to-order due date.
 *
 * TEST ONLY: the view is offered on a preview link (host name with "--") or where localStorage shpBoard = '1'. It is not on the
 * live app. */
const SHPB_ON = (() => { try { return /--/.test(location.hostname) || localStorage.getItem('shpBoard') === '1'; } catch (e) { return false; } })();
const SHPB_NODE = 'pt_shpBoardTest';
let SHPB = { tab: 'pending', stage: '', ready: {}, readyAt: 0, busy: false, err: '' };
const shpbKey = (orderNo, sku) => obUC(orderNo) + '__' + obUC(sku);
const shpbDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const shpbCanEdit = () => !!(ME.admin || (typeof ptCanEdit === 'function' && ptCanEdit()));

/** The date typed for a line, else the date PPC planned it ready, else its make-to-order due date. */
function shpbReadyOf(r) {
  const k = shpbKey(r.orderNo, r.sku), set = SHPB.ready[k];
  if (set && set.date) return { date: set.date, how: 'set', by: String(set.by || '').split('@')[0] };
  const plan = ((typeof FLOW !== 'undefined' && FLOW && FLOW.ppc) || {})[typeof flowKey === 'function' ? flowKey(r.orderNo, r.sku) : k];
  const pd = plan && plan.dates && plan.dates.ready;
  if (pd) return { date: String(pd).slice(0, 10), how: 'PPC plan' };
  if (r.mtoDue) return { date: r.mtoDue, how: '5 working days' };
  return { date: '', how: '' };
}
async function shpbLoad(force) {
  if (SHPB.busy || (!force && SHPB.readyAt && Date.now() - SHPB.readyAt < 60e3)) return;
  SHPB.busy = true;
  try { SHPB.ready = (await ptGet(SHPB_NODE)) || {}; SHPB.err = ''; }
  catch (e) { SHPB.err = 'The ready dates could not be read (' + (e.message || e) + ') — the board shows the planned dates only.'; }
  SHPB.busy = false; SHPB.readyAt = Date.now();
  if (typeof ordView === 'function' && ordView() === 'shpboard') renderShpBoard();
}
async function shpbSetReady(key, date) {
  const [orderNo, sku] = key.split('__');
  try {
    if (date) await ptPut(SHPB_NODE + '/' + key, { orderNo, sku, date, by: ME.email, at: new Date().toISOString() });
    else await ptDelete(SHPB_NODE + '/' + key);
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  SHPB.ready = Object.assign({}, SHPB.ready);
  if (date) SHPB.ready[key] = { orderNo, sku, date, by: ME.email, at: new Date().toISOString() }; else delete SHPB.ready[key];
  return '';
}

/** What the Production flow says of a line that goes to a printer: the printer, the pieces owed and the pieces back (the challan person's receipts). */
let SHPB_FM = { src: null, map: null };
function shpbFlowOf(r) {
  let rows; try { rows = typeof flowRows === 'function' ? flowRows() : null; } catch (e) { rows = null; }
  if (!rows) return null;
  if (SHPB_FM.src !== rows) SHPB_FM = { src: rows, map: new Map(rows.map(x => [x.r.orderNo + '|' + x.r.sku, x.s])) };
  const s = SHPB_FM.map.get(r.orderNo + '|' + r.sku);
  if (!s || !s.plan || !flowPrinted(s.route) || s.fromStock || flowInHand(s.plan)) return null;
  const q = +r.qty || 0;
  return { printer: (s.plan.printer && (s.plan.printer.code || s.plan.printer.name)) || '', back: Math.max(0, Math.min(q, +s.back || 0)) };
}
/** The stage figures of a set of lines. Each stage: what got there (x), what has moved on to the next stage (mv), what is waiting here (x − mv). */
function shpbStages(lines) {
  const s = { pcs: 0, cutX: 0, cutMv: 0, cutNone: 0, toCut: 0, issX: 0, issMv: 0, toIssue: 0, recX: 0, recMv: 0, qcX: 0, qcMv: 0, ready: 0,
    prcA: 0, prcW: 0, prcD: 0, cutA: 0, cutW: 0, cutD: 0, issA: 0, issW: 0, issD: 0, recA: 0, recW: 0, recD: 0, qcA: 0, qcW: 0, qcD: 0, handA: 0, handW: 0, handD: 0 };
  lines.forEach(r => {
    const q = +r.qty || 0, cap = n => Math.max(0, Math.min(q, +n || 0));
    const iss = cap(r.issued), rec = cap(r.received), qc = cap(r.pressed);
    const sp = (typeof spOf === 'function' ? spOf(r.orderNo, r.sku) : null) || {}, got = Math.min(q, Number(sp.handedQty) || 0);
    s.pcs += q;
    if (r.cutReq) { const c = cap(r.cut); s.cutX += c; s.cutMv += Math.min(c, iss); s.toCut += Math.max(0, q - c); s.toIssue += Math.max(0, c - iss); }
    else { s.cutNone += q; s.toIssue += Math.max(0, q - iss); }
    s.issX += iss; s.issMv += Math.min(iss, rec);
    s.recX += rec; s.recMv += Math.min(rec, qc);
    s.qcX += qc; s.qcMv += qc;                                  // a piece that passed QC is in Press, ready to hand over, by itself
    s.ready += Math.max(0, qc - got);
    /* arrived (A) / waiting here (W) / done and moved on (D) at each stage — what the cells and the buckets read */
    /* A line that goes to a printer can be cut / issued only as far as the printed cloth has come back (flowState does the same). */
    const fl = shpbFlowOf(r), base = fl ? fl.back : q;
    if (fl) { s.prcA += q; s.prcD += fl.back; s.prcW += q - fl.back; }
    const cutDone = r.cutReq ? cap(r.cut) : base;
    if (r.cutReq) { s.cutA += base; s.cutD += cap(r.cut); s.cutW += Math.max(0, base - cap(r.cut)); }
    s.issA += cutDone; s.issD += iss; s.issW += Math.max(0, cutDone - iss);
    s.recA += iss; s.recD += rec; s.recW += Math.max(0, iss - rec);
    s.qcA += rec; s.qcD += qc; s.qcW += Math.max(0, rec - qc);
    s.handA += qc; s.handD += got; s.handW += Math.max(0, qc - got);
  });
  return s;
}

const SHPB_STAGE_BG = 'background:#fdf0e8';
/* THE FIVE STAGES, in the order the work moves. `a` = what has ARRIVED at the stage (can be worked on), `d` = what the stage has
 * DONE and moved on, `w` = what still waits here. A cell reads "waiting − (done moved)": "1 − (0 moved)" until the work is
 * done, "0 − (1 moved)" once it is (Ravi, 28 Oct). */
const SHPB_STAGES = [['prcv', 'Printer receive', 'prcv', 'prcW', 'prcD', 'prcA'], ['cut', 'Cut', 'cut', 'cutW', 'cutD', 'cutA'], ['issue', 'Issue', 'issue', 'issW', 'issD', 'issA'], ['receive', 'Receive', 'receive', 'recW', 'recD', 'recA'],
  ['qc', 'QC pass', 'qc', 'qcW', 'qcD', 'qcA'], ['hand', 'Hand to shipping', 'hand', 'handW', 'handD', 'handA']];
/** One stage cell: "waiting − (done moved)", and the button for the work that is waiting. */
function shpbCell(a, w, d, act, label, key, title) {
  if (!a && !d) return '<td class="num" style="' + SHPB_STAGE_BG + '"><span class="muted">—</span></td>';
  return '<td class="num" style="' + SHPB_STAGE_BG + ';white-space:nowrap" title="' + esc(title || '') + '">'
    + (w ? '<b style="color:#b45309">' + nf(w) + '</b>' : '<b style="color:#166534">0</b>') + ' <span class="muted" style="font-size:11.5px">− (' + nf(d) + ' moved)</span>'
    + (w ? '<div><button type="button" class="ghost" data-shpb-act="' + act + '" data-key="' + esc(key) + '" style="width:auto;padding:1px 8px;font-size:11px;margin-top:2px">' + esc(label) + '</button></div>' : '') + '</td>';
}
const shpbLineOf = key => { const [o, k] = String(key).split('__'); return ordLines().find(r => r.orderNo === obUC(o) && r.sku === obUC(k)) || null; };
const shpbPlanOf = r => ((typeof FLOW !== 'undefined' && FLOW && FLOW.ppc) || {})[typeof flowKey === 'function' ? flowKey(r.orderNo, r.sku) : ''] || null;
const shpbPrinterOf = r => { const p = shpbPlanOf(r), pr = p && p.printer; return (pr && (pr.name || pr.code)) || r.printer || ''; };

/** One order line: date, order, ready date, item, pieces, printer, then the five stages. */
function shpbRow(r) {
  const k = shpbKey(r.orderNo, r.sku), s = shpbStages([r]), rd = shpbReadyOf(r), edit = shpbCanEdit(), late = rd.date && rd.date < dToday();
  const prn = shpbPrinterOf(r);
  const tips = { prcv: 'Owed by the printer − printed cloth received back on the challan', cut: 'Still to cut − cut so far', issue: 'Cut and not yet issued − issued to karigars', receive: 'Out with karigars − received back', qc: 'Received, not checked − passed QC', hand: 'Passed QC, not with shipping − handed over' };
  return '<tr><td class="frz" style="text-align:left;white-space:nowrap">' + esc(shpbDmy(ptIsoDate(r.orderDate))) + '</td>'
    + '<td style="text-align:left;white-space:nowrap"><a href="#" data-ordj="' + esc(r.orderNo) + '" style="color:inherit;text-decoration:underline dotted;font-weight:700">'
    + esc(String(r.shopOrderNo || r.orderNo).replace(/^#\s*/, '')) + '</a>'
    + '<div style="margin-top:3px">' + (edit ? '<input type="date" data-shpb-ready="' + esc(k) + '" value="' + esc(rd.date) + '" style="width:124px;padding:1px 3px;font-size:11.5px' + (late ? ';color:#b91c1c' : '') + '" title="When this order will be ready">'
      : '<span>' + esc(shpbDmy(rd.date) || '—') + '</span>')
    + (rd.how ? '<div class="muted" style="font-size:10.5px">' + (rd.how === 'set' ? 'set' + (rd.by ? ' · ' + esc(rd.by) : '') : esc(rd.how)) + '</div>' : '') + '</div></td>'
    + ordItemCell(r, null, '')
    + `<td class="num"><b>${nf(r.qty)}</b></td>`
    + `<td style="text-align:left;font-size:12px;white-space:nowrap">${prn ? '<b>' + esc(prn) + '</b>' : '<span class="muted">no printer</span>'}`
    + `<div><button type="button" class="ghost" data-shpb-act="print" data-key="${esc(k)}" style="width:auto;padding:1px 8px;font-size:11px;margin-top:2px" title="Printing order and printer — the PPC plan of this line">${prn ? 'Change' : 'Printing'}</button></div></td>`
    + shpbCell(s.prcA, s.prcW, s.prcD, 'prcv', 'Receive', k, tips.prcv)
    + (!r.cutReq ? `<td class="num" style="${SHPB_STAGE_BG}"><span class="muted" style="font-size:11.5px">not needed</span></td>` : shpbCell(s.cutA, s.cutW, s.cutD, 'cut', 'Cut', k, tips.cut))
    + shpbCell(s.issA, s.issW, s.issD, 'issue', 'Issue', k, tips.issue)
    + shpbCell(s.recA, s.recW, s.recD, 'receive', 'Receive', k, tips.receive)
    + shpbCell(s.qcA, s.qcW, s.qcD, 'qc', 'QC pass', k, tips.qc)
    + shpbCell(s.handA, s.handW, s.handD, 'hand', 'Hand to shipping', k, tips.hand) + '</tr>';
}

const shpbIsMine = r => { try { const m = typeof mdbOf === 'function' ? mdbOf(r.sku) : null; return !(m && typeof mdbIsReady === 'function' && mdbIsReady(m)); } catch (e) { return true; } };
/** What the board shows now: the filters of the bar, the tab, and the stage bucket picked. */
function shpbView() {
  /* ONLY WHAT RIDHI MAKES (Ravi, 28 Oct: "jinka manufacture ridhi h wo hi sirf yaha production me order open ho otherwise nahi"): a SKU whose master
   * names another manufacturer is a ready product — bought in, not made — and is not production's. */
  const f = ordFilters(), all = ordLines().filter(r => /^SHP-/.test(r.orderNo) && shpbIsMine(r)), shown = ordApply(all, f);
  const pend = shown.filter(r => r.open), done = shown.filter(r => !r.open);
  const stg = SHPB_STAGES.find(x => x[0] === SHPB.stage);
  const list = SHPB.tab === 'done' ? done : (stg ? pend.filter(r => shpbStages([r])[stg[3]] > 0) : pend);
  return { f, all, pend, done, list };
}

function renderShpBoard() {
  if (!$('odTable')) return;
  if (!SHPB.readyAt && !SHPB.busy) shpbLoad(true);
  const { f, all, pend, done, list } = shpbView(), tab = SHPB.tab;
  ptFill('odArt', ordApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('odSub', ordApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('odCol', ordApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('odSz', ordApply(all, f, 'sz').map(r => r.size), 'All sizes');
  const st = shpbStages(pend);
  const today = dToday(), withDate = pend.filter(r => shpbReadyOf(r).date).length, lateN = pend.filter(r => { const d = shpbReadyOf(r).date; return d && d < today; }).length;
  const tabBtn = (v, t) => `<button type="button" data-shpb-tab="${v}" style="height:38px;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
    + (tab === v ? 'background:#15803D;color:#fff;border:1px solid #15803D' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5') + `">${t}</button>`;
  /* THE BUCKETS: how many orders wait at each stage, and how many pieces. A click shows only those lines; click again for all. */
  const bucket = x => { const ls = pend.filter(r => shpbStages([r])[x[3]] > 0), pcs = ls.reduce((a, r) => a + shpbStages([r])[x[3]], 0), on = SHPB.stage === x[0] && tab === 'pending';
    return `<button type="button" data-shpb-stage="${x[0]}" title="Show only the lines waiting at ${esc(x[1])}" style="padding:8px 14px;border-radius:12px;font:inherit;cursor:pointer;box-shadow:none;transform:none;text-align:left;`
      + (on ? 'background:#b45309;color:#fff;border:1px solid #b45309' : 'background:#fdf0e8;color:#17202B;border:1px solid #f0cdb5') + `"><b>${esc(x[1])}</b> <span style="font-weight:700">(${nf(new Set(ls.map(r => r.orderNo)).size)})</span>`
      + `<div style="font-size:11px;opacity:.85">orders · ${nf(pcs)} pcs</div></button>`; };
  /* No title and no KPI cards here (Ravi, 28 Oct: "remove this for only this bucket") — the buckets are the summary. */
  $('odKpis').innerHTML = ''    + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 4px"><span class="muted" style="align-self:center;font-weight:700">Waiting at:</span>${SHPB_STAGES.map(bucket).join('')}</div>`
    + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">${tabBtn('pending', 'Order pending · ' + nf(pend.length))}${tabBtn('done', 'SHP order complete · ' + nf(done.length))}</div>`;
  $('odMsg').className = SHPB.err ? 'err' : 'muted';
  $('odMsg').textContent = SHPB.err || 'One row per order line. Each stage reads "waiting − (done moved)": "1 − (0 moved)" until the work is done, then "0 − (1 moved)". The button in a cell does that work, here. Export downloads what is shown.';

  if (tab === 'done') return renderShpBoardDone(list);
  if (!list.length) { ptEmpty('odTable', SHPB.stage ? 'No line is waiting at that stage.' : 'No Shopify order is pending.'); return; }
  const rows = ordNewest(list.slice().sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku)));
  const head = '<thead><tr><th class="frz" style="text-align:left">Date</th><th style="text-align:left">Order ID · ready on</th><th style="text-align:left">Item</th><th class="num">Pieces</th><th style="text-align:left">Printer</th>'
    + ['Printer receive', 'Cut', 'Issued', 'Received', 'QC passed', 'Press — ready to hand'].map(h => `<th class="num" style="${SHPB_STAGE_BG}">${h}</th>`).join('') + '</tr></thead>';
  $('odTable').innerHTML = head + '<tbody>' + rows.slice(0, 300).map(shpbRow).join('') + '</tbody>'
    + (rows.length > 300 ? '<tfoot><tr><td colspan="11" class="muted" style="padding:10px;text-align:left">Showing the first 300 of ' + nf(rows.length) + ' lines — search or filter to narrow them. Export has all of them.</td></tr></tfoot>' : '');
}

/** Export: every line shown (the bar's filters, the tab, the stage bucket) — one CSV row per order line, which Excel opens. */
function shpbExport() {
  const { list } = shpbView(); if (!list.length) return;
  const head = ['Order date', 'Order ID', 'Order', 'SKU', 'Article', 'Subtype', 'Colour', 'Size', 'Pieces', 'Ready on', 'Ready date from', 'Printer',
    'Printer receive: waiting', 'Printer receive: back', 'Cut: waiting', 'Cut: done', 'Issue: waiting', 'Issued: done', 'Receive: waiting', 'Received: done', 'QC: waiting', 'QC passed', 'Ready to hand over', 'Handed to shipping', 'Handed / closed on', 'Status'];
  const lines = [head.map(csvCell).join(',')];
  list.slice().sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo)).forEach(r => {
    const s = shpbStages([r]), rd = shpbReadyOf(r), at = ptIsoDate(r.handedAt || r.shopDoneAt) || '';
    lines.push([ptIsoDate(r.orderDate) || '', r.shopOrderNo || '', r.orderNo, r.sku, r.articleType || r.itemName || '', r.articleSubtype || '', r.color || '', r.size || '', r.qty, rd.date, rd.how === 'set' ? 'typed here' : rd.how, shpbPrinterOf(r),
      s.prcA ? s.prcW : '', s.prcA ? s.prcD : '', r.cutReq ? s.cutW : 'not needed', r.cutReq ? s.cutD : '', s.issW, s.issD, s.recW, s.recD, s.qcW, s.qcD, s.handW, s.handD, at,
      r.open ? 'Pending' : (r.handedAt ? 'Handed over' : (typeof SHP_DONE_TXT === 'function' ? SHP_DONE_TXT(r.shopDoneWhy) : 'Closed'))].map(csvCell).join(','));
  });
  ptDownload('shp-board-' + (SHPB.tab === 'done' ? 'complete' : (SHPB.stage ? 'waiting-' + SHPB.stage : 'pending')), lines);
}

/** SHP order complete: one line per hand-over, newest day first — "Handed to shipping" date wise. */
function renderShpBoardDone(done) {
  const rows = done.map(r => ({ r, at: String(r.handedAt || r.shopDoneAt || '') })).sort((a, b) => b.at.localeCompare(a.at) || a.r.orderNo.localeCompare(b.r.orderNo)).slice(0, 600);
  if (!rows.length) { ptEmpty('odTable', 'Nothing has been handed to shipping yet.'); return; }
  const head = '<thead><tr><th class="frz" style="text-align:left">Handed to shipping</th><th style="text-align:left">Order ID</th><th style="text-align:left">Item</th><th class="num">Pieces</th>'
    + ['Cut', 'Issued', 'Received', 'QC passed'].map(h => `<th class="num" style="${SHPB_STAGE_BG}">${h}</th>`).join('') + '<th style="text-align:left">How</th></tr></thead>';
  let prev = '';
  const body = rows.map(({ r, at }) => {
    const day = ptIsoDate(at) || '', first = day !== prev; prev = day;
    return (first ? `<tr><td colspan="9" style="text-align:left;background:#eef2f7;font-weight:700">${esc(shpbDmy(day) || 'no date')}</td></tr>` : '')
      + `<tr><td class="frz" style="text-align:left;white-space:nowrap">${esc(shpbDmy(day))}</td>`
      + `<td style="text-align:left"><a href="#" data-ordj="${esc(r.orderNo)}" style="color:inherit;text-decoration:underline dotted;font-weight:700">${esc(String(r.shopOrderNo || r.orderNo).replace(/^#\s*/, ''))}</a></td>`
      + ordItemCell(r, null, '') + `<td class="num">${nf(r.qty)}</td>`
      + `<td class="num" style="${SHPB_STAGE_BG}">${r.cutReq ? nf(r.cut) : '<span class="muted">n/a</span>'}</td><td class="num" style="${SHPB_STAGE_BG}">${nf(r.issued)}</td>`
      + `<td class="num" style="${SHPB_STAGE_BG}">${nf(r.received)}</td><td class="num" style="${SHPB_STAGE_BG}">${nf(r.pressed)}</td>`
      + `<td style="text-align:left;font-size:12px">${r.handedAt ? 'Handed over' + (r.handedBy ? ' · ' + esc(String(r.handedBy).split('@')[0]) : '') : esc(typeof SHP_DONE_TXT === 'function' ? SHP_DONE_TXT(r.shopDoneWhy) : 'Closed')}</td></tr>`;
  }).join('');
  $('odTable').innerHTML = head + '<tbody>' + body + '</tbody>';
}

/* ---- the work, done from the row ------------------------------------------------------------------------------------
 * Cutting and the Job Work issue are written by the same save buttons of their own forms (the form's boxes are filled and its
 * Save pressed), so every check they make — the order's cap, a month frozen, a zipper short, the same issue twice — answers
 * here too. A refusal is the form's own message. */
const shpbToday = () => (typeof dToday === 'function' ? dToday() : new Date().toISOString().slice(0, 10));
async function shpbDrive(set, saveId, msgId) {
  Object.entries(set).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
  await $(saveId).onclick();
  const m = $(msgId);
  return m && m.className === 'err' ? (m.textContent || 'Not saved.') : '';
}
async function shpbCutSave(r, v) {
  const pcs = parseInt(v.pcs, 10);
  if (!(pcs > 0)) return 'Type how many pieces were cut.';
  await ensureCutForm();
  $('cwSku').value = r.sku; $('cwSku').dataset.typed = '1'; renderCutPick(); renderCutForm();
  return shpbDrive({ cwOrd: r.orderNo, cwPcs: String(pcs), cwFabric: v.fabric || '', cwDate: v.date || shpbToday() }, 'cwSave', 'cwMsg');
}
async function shpbIssueSave(r, v) {
  const pcs = parseInt(v.pcs, 10), name = String(v.emp || '').trim();
  if (!name) return 'Pick the karigar.';
  if (!(pcs > 0)) return 'Type how many pieces are being issued.';
  const emp = (PTE.emp || []).find(e => String(e[1]).trim().toLowerCase() === name.toLowerCase());
  if (!emp) return `"${name}" is not on the employee list.`;
  await ensureBdForm();
  $('bwSku').value = r.sku; $('bwSku').dataset.typed = '1';
  $('bwType').value = String(emp[0] || '').trim(); renderBdForm(); bdSkuTyped();
  $('bwType').value = String(emp[0] || '').trim();
  $('bwEmp').value = String(emp[1]).trim();
  $('bwOrd').value = r.orderNo; $('bwPcs').value = String(pcs); $('bwDate').value = v.date || shpbToday(); $('bwDate').dataset.auto = '';
  if (typeof bdMatFill === 'function') bdMatFill();
  return shpbDrive({}, 'bwSave', 'bwMsg');
}
const shpbAfter = () => { try { renderOrd(); } catch (e) { /* the next draw shows it */ } };

function shpbDialog(act, key) {
  const r = shpbLineOf(key); if (!r) return;
  const s = shpbStages([r]), who = (r.shopOrderNo || r.orderNo) + ' · ' + r.sku;
  if (act === 'print') { if (typeof flowPpcOpen === 'function') flowPpcOpen(r.orderNo, r.sku); return; }
  if (act === 'hand') return shpbHandOpen(key);
  if (act === 'prcv') {
    const fl = shpbFlowOf(r);
    if (!fl || !fl.printer || typeof flowDueRecvOpen !== 'function') { $('odMsg').className = 'err'; $('odMsg').textContent = 'This line has no printer in the PPC plan.'; return; }
    return flowDueRecvOpen(fl.printer);   // the printer's open lines, with search — the same dialog as Printed fabric in
  }
  if (act === 'cut') {
    const planFab = (shpbPlanOf(r) || {}).fabric, fabs = typeof cutFabrics === 'function' ? cutFabrics() : [];
    const def = (planFab && fabs.find(x => String(x).toLowerCase() === String(planFab.name || '').toLowerCase())) || '';
    return ptOpenDialog({ title: 'Cut — ' + who, subtitle: nf(s.toCut) + ' still to cut of ' + nf(r.qty) + '. Saved in Cutting Data, against this order.',
      fields: [{ key: 'pcs', label: 'Pieces cut', type: 'number', min: 1, value: s.toCut || '' },
        { key: 'fabric', label: 'Fabric', type: 'select', options: [['', '— pick —']].concat(fabs.map(x => [x, x])), value: def },
        { key: 'date', label: 'Cutting date', type: 'date', value: shpbToday() }],
      saveLabel: 'Save cutting', onSave: async v => { const err = await shpbCutSave(r, v); if (!err) shpbAfter(); return err; } });
  }
  if (act === 'issue') {
    const go = () => ptOpenDialog({ title: 'Issue to a karigar — ' + who, subtitle: nf(s.toIssue) + ' can be issued now. Saved in the Job Work register, against this order.',
      fields: [{ key: 'emp', label: 'Karigar / contractor', list: (PTE.emp || []).map(e => String(e[1]).trim()).filter(Boolean), value: '' },
        { key: 'pcs', label: 'Pieces issued', type: 'number', min: 1, value: s.toIssue || '' }, { key: 'date', label: 'Issue date', type: 'date', value: shpbToday() }],
      saveLabel: 'Issue', onSave: async v => { const err = await shpbIssueSave(r, v); if (!err) shpbAfter(); return err; } });
    if (PTE.emp) return go();
    return ptLoadEmp().then(go).catch(e => { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not read the employee list: ' + (e.message || e); });
  }
  if (act === 'receive') {
    const open = (PT.base || []).filter(b => b && !b.frozen && obUC(b.orderNo) === r.orderNo && obUC(b.sku) === r.sku && ptNum(b.pendingPieces) > 0);
    return ptOpenDialog({ title: 'Receive from karigar — ' + who, subtitle: open.length ? 'Pick the entry the pieces came back on.' : 'Nothing is out with a karigar on this line.',
      html: open.map(b => `<div style="display:flex;align-items:center;gap:10px;margin:6px 0"><div style="flex:1"><b>${esc(b.empName)}</b> <span class="muted">· ${nf(ptNum(b.issuePieces))} issued ${esc(String(b.issueDate || '').slice(0, 10))} · ${nf(ptNum(b.receivedPieces))} back · <b>${nf(ptNum(b.pendingPieces))} out</b></span></div>`
        + `<button type="button" data-shpb-recv="${esc(b.id)}" style="width:auto">Receive</button></div>`).join('') });
  }
  if (act === 'qc') {
    return Promise.resolve(typeof ensureQc === 'function' ? ensureQc() : null).then(() => {
      const rows = qcInboxRows().filter(x => obUC(x.r.orderNo) === r.orderNo && obUC(x.r.sku) === r.sku);
      ptOpenDialog({ title: 'QC pass — ' + who, subtitle: rows.length ? 'Pieces received and waiting for QC. Type what passes now.' : 'Nothing is waiting for QC on this line.',
        fields: rows.map((x, i) => ({ key: 'q' + i, label: `${x.r.empName || ''} · ${nf(x.wait)} waiting`, type: 'number', min: 0, value: x.wait })),
        saveLabel: 'QC pass',
        onSave: rows.length ? async v => {
          let n = 0;
          for (let i = 0; i < rows.length; i++) { const q = parseInt(v['q' + i], 10) || 0; if (!(q > 0)) continue; const err = await qcInboxAccept(rows[i].r.id, q, ''); if (err) return err; n++; }
          if (!n) return 'Type how many pieces pass.'; shpbAfter(); return '';
        } : undefined });
    });
  }
}
function shpbHandOpen(key) {
  const r = shpbLineOf(key);
  if (!r || typeof shpReadyLines !== 'function' || !shpCanReceive()) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Handing over to shipping needs the Shopify tab.'; return; }
  const x = shpReadyLines().find(y => y.orderNo === r.orderNo && y.sku === r.sku);
  if (!x) return;
  ptOpenDialog({
    title: 'Hand to shipping — ' + (r.shopOrderNo || r.orderNo) + ' · ' + r.sku, subtitle: 'Passed QC and not with shipping yet: ' + nf(x.ready) + '. Type what shipping is taking now.',
    fields: [{ key: 'q', label: 'Pieces handed over', type: 'number', min: 1, value: x.ready }], saveLabel: 'Hand over',
    onSave: async v => { const q = Math.min(x.ready, Math.round(+v.q || 0)); if (!(q > 0)) return 'Type how many pieces shipping is taking.';
      const err = await shpReceive([{ orderNo: x.orderNo, sku: x.sku, qty: q }]); if (!err) shpbAfter(); return err; },
  });
}

if (SHPB_ON && $('odView') && $('odView').insertAdjacentHTML) $('odView').insertAdjacentHTML('beforeend', '<option value="shpboard">SHP board — test</option>');
if ($('odTable') && $('odTable').addEventListener) {
  $('odTable').addEventListener('click', e => {
    if (typeof ordView !== 'function' || ordView() !== 'shpboard') return;
    const a = e.target.closest && e.target.closest('[data-shpb-act]'); if (a) { e.preventDefault(); shpbDialog(a.dataset.shpbAct, a.dataset.key); }
  });
  $('odTable').addEventListener('change', async e => {
    const i = e.target.closest && e.target.closest('[data-shpb-ready]'); if (!i || ordView() !== 'shpboard') return;
    const err = await shpbSetReady(i.dataset.shpbReady, i.value);
    if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; } else renderShpBoard();
  });
}
if ($('ptDlgBody') && $('ptDlgBody').addEventListener) $('ptDlgBody').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-shpb-recv]'); if (b) { const id = b.dataset.shpbRecv; ptDlgClose(); jwRecvOpen(id); }
});
if ($('odKpis') && $('odKpis').addEventListener) $('odKpis').addEventListener('click', e => {
  if (ordView() !== 'shpboard') return;
  const t = e.target.closest && e.target.closest('[data-shpb-tab]'); if (t) { SHPB.tab = t.dataset.shpbTab; if (SHPB.tab === 'done') SHPB.stage = ''; renderShpBoard(); return; }
  const g = e.target.closest && e.target.closest('[data-shpb-stage]'); if (g) { SHPB.stage = SHPB.stage === g.dataset.shpbStage ? '' : g.dataset.shpbStage; SHPB.tab = 'pending'; renderShpBoard(); }
});
