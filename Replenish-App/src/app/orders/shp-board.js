/* ================= SHP BOARD — Shopify orders, stage by stage (TEST WINDOW) =================
 *
 * Ravi, 28 Oct: "Ek test window banao for only SHP … sath sath me mention kar saku ki ye order kab ready hoga (live nahi karna
 * h, test window m rakhna h)". His sheet: one row per SKU — Date · Order ID · Item · Orders · Pieces, then a column for each
 * stage (cut · Issued · Received · Q.C Passed · Press) and "Handed to shipping", which belongs in the Complete tab, date wise.
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
let SHPB = { tab: 'pending', ready: {}, readyAt: 0, busy: false, err: '', open: new Set() };
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

/** The stage figures of a set of lines. Each stage: what got there (x), what has moved on to the next stage (mv), what is waiting here (x − mv). */
function shpbStages(lines) {
  const s = { pcs: 0, cutX: 0, cutMv: 0, cutNone: 0, toCut: 0, issX: 0, issMv: 0, toIssue: 0, recX: 0, recMv: 0, qcX: 0, qcMv: 0, ready: 0 };
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
  });
  return s;
}

const SHPB_STAGE_BG = 'background:#fdf0e8';
/** One stage cell: what is here, what moved on, and the button for the work that is waiting. */
function shpbCell(x, mv, waiting, act, label, sku, title) {
  if (!x && !waiting) return '<td class="num" style="' + SHPB_STAGE_BG + '"><span class="muted">—</span></td>';
  const here = Math.max(0, x - mv);
  return '<td class="num" style="' + SHPB_STAGE_BG + ';white-space:nowrap" title="' + esc(title || '') + '"><b>' + nf(x) + '</b>'
    + (x ? ' <span class="muted" style="font-size:11.5px">− (' + nf(mv) + ' moved)</span>' : '')
    + (here ? '<div style="font-size:11px;color:#b45309;font-weight:700">' + nf(here) + ' here</div>' : '')
    + (waiting && act ? '<div><button type="button" class="ghost" data-shpb-act="' + act + '" data-sku="' + esc(sku) + '" style="width:auto;padding:1px 8px;font-size:11px;margin-top:2px">'
      + esc(label) + ' · ' + nf(waiting) + '</button></div>' : '') + '</td>';
}

function shpbOrdersCell(lines, sku, many) {
  const showAll = SHPB.open.has(sku), list = lines.slice().sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo));
  const edit = shpbCanEdit();
  return '<td style="text-align:left;font-size:12px;min-width:210px">' + list.slice(0, showAll ? list.length : 6).map(r => {
    const rd = shpbReadyOf(r), k = shpbKey(r.orderNo, r.sku);
    const late = rd.date && rd.date < dToday() && r.open;
    return '<div style="white-space:nowrap;margin-bottom:2px"><a href="#" data-ordj="' + esc(r.orderNo) + '" style="color:inherit;text-decoration:underline dotted;font-weight:700">'
      + esc(String(r.shopOrderNo || r.orderNo).replace(/^#\s*/, '')) + '</a><span class="muted"> ×' + nf(r.qty) + '</span> '
      + (edit ? '<input type="date" data-shpb-ready="' + esc(k) + '" value="' + esc(rd.date) + '" style="width:122px;padding:1px 3px;font-size:11.5px' + (late ? ';color:#b91c1c' : '') + '" title="When this order will be ready">'
        : '<span>' + esc(shpbDmy(rd.date) || '—') + '</span>')
      + (rd.how ? ' <span class="muted" style="font-size:10.5px">' + (rd.how === 'set' ? 'set' + (rd.by ? ' · ' + esc(rd.by) : '') : esc(rd.how)) + '</span>' : '') + '</div>';
  }).join('') + (list.length > 6 ? '<a href="#" data-shpb-more="' + esc(sku) + '" class="muted" style="font-size:11.5px">' + (showAll ? 'show fewer' : '+' + (list.length - 6) + ' more') + '</a>' : '') + '</td>';
}

function renderShpBoard() {
  if (!$('odTable')) return;
  if (!SHPB.readyAt && !SHPB.busy) shpbLoad(true);
  const f = ordFilters(), all = ordLines().filter(r => /^SHP-/.test(r.orderNo));
  ptFill('odArt', ordApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('odSub', ordApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('odCol', ordApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('odSz', ordApply(all, f, 'sz').map(r => r.size), 'All sizes');
  const shown = ordApply(all, f), tab = SHPB.tab;
  const pend = shown.filter(r => r.open), done = shown.filter(r => !r.open);
  const st = shpbStages(pend);
  const today = dToday(), withDate = pend.filter(r => shpbReadyOf(r).date).length, lateN = pend.filter(r => { const d = shpbReadyOf(r).date; return d && d < today; }).length;
  const tabBtn = (v, t) => `<button type="button" data-shpb-tab="${v}" style="height:38px;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
    + (tab === v ? 'background:#15803D;color:#fff;border:1px solid #15803D' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5') + `">${t}</button>`;
  $('odKpis').innerHTML = '<div class="jw-kpiname">SHP board — TEST window (preview link only; nothing here is on the live app)</div><div class="jw-kpis">'
    + ordKpiCard(nf(new Set(pend.map(r => r.sku)).size), 'SKUs pending', 'list', 'blue', nf(pend.length) + ' order lines')
    + ordKpiCard(nf(st.pcs), 'Pieces pending', 'box', 'blue', 'ordered, not handed over')
    + ordKpiCard(nf(st.ready), 'Ready to hand over', 'box', 'green', 'passed QC, not with shipping yet')
    + ordKpiCard(nf(withDate), 'Have a ready date', 'doc', 'blue', nf(pend.length - withDate) + ' without one')
    + ordKpiCard(nf(lateN), 'Past their ready date', 'alert', 'amber', 'still open') + '</div>'
    + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">${tabBtn('pending', 'Order pending · ' + nf(pend.length))}${tabBtn('done', 'SHP order complete · ' + nf(done.length))}</div>`;
  $('odMsg').className = 'muted';
  $('odMsg').textContent = (SHPB.err || 'Stage cells read "reached − (moved on)"; the number "here" is what still waits at that stage, with its button. Ready dates: type one on an order; until then the PPC plan\'s date (or the 5 working days) shows.');

  if (tab === 'done') return renderShpBoardDone(done);
  if (!pend.length) { ptEmpty('odTable', 'No Shopify order is pending.'); return; }
  const by = new Map(); pend.forEach(r => { const e = by.get(r.sku) || by.set(r.sku, []).get(r.sku); e.push(r); });
  const groups = [...by.entries()].map(([sku, ls]) => ({ sku, ls, date: ls.map(r => String(r.orderDate || '')).filter(Boolean).sort()[0] || '' }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku));
  const head = '<thead><tr><th class="frz" style="text-align:left">Date</th><th style="text-align:left">Order ID · ready on</th><th style="text-align:left">Item</th><th class="num">Orders</th><th class="num">Pieces</th>'
    + ['Cut', 'Issued', 'Received', 'QC passed', 'Press — ready to hand'].map(h => `<th class="num" style="${SHPB_STAGE_BG}">${h}</th>`).join('') + '</tr></thead>';
  const body = groups.slice(0, 400).map(g => {
    const s = shpbStages(g.ls), rep = g.ls[0];
    return '<tr><td class="frz" style="text-align:left;white-space:nowrap">' + esc(shpbDmy(ptIsoDate(g.date))) + '</td>'
      + shpbOrdersCell(g.ls, g.sku)
      + ordItemCell(rep, null, '')
      + `<td class="num">${nf(g.ls.length)}</td>`
      + `<td class="num"><b>${nf(s.pcs)}</b><div><button type="button" class="ghost" data-shpb-act="print" data-sku="${esc(g.sku)}" style="width:auto;padding:1px 8px;font-size:11px;margin-top:2px" title="Printing order — Production flow, this SKU">Printing</button></div></td>`
      + (s.cutNone && !s.cutX && !s.toCut ? `<td class="num" style="${SHPB_STAGE_BG}"><span class="muted" style="font-size:11.5px">not needed</span></td>`
        : shpbCell(s.cutX, s.cutMv, s.toCut, 'cut', 'Cut', g.sku, 'Cut, and how much of it has been issued to a karigar'))
      + shpbCell(s.issX, s.issMv, s.toIssue, 'issue', 'Issue', g.sku, 'Issued to karigars, and how much has come back')
      + shpbCell(s.recX, s.recMv, s.issX - s.recX, 'receive', 'Receive', g.sku, 'Received from karigars, and how much has gone to QC')
      + shpbCell(s.qcX, s.qcMv, s.recX - s.qcX, 'qc', 'QC', g.sku, 'Passed QC — goes to Press by itself')
      + `<td class="num" style="${SHPB_STAGE_BG}">${s.ready ? `<b style="color:#166534">${nf(s.ready)}</b> <span class="muted" style="font-size:11px">ready</span><div><button type="button" data-shpb-act="hand" data-sku="${esc(g.sku)}" style="width:auto;padding:1px 8px;font-size:11px;margin-top:2px">Hand to shipping</button></div>` : '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  $('odTable').innerHTML = head + '<tbody>' + body + '</tbody>';
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

/** The work itself is done on the screen that owns it — opened on this SKU. Hand-over is done right here. */
function shpbGo(act, sku) {
  const search = (tab, id) => { showTab(tab); const el = $(id); if (el) { el.value = sku; el.dispatchEvent(new Event('input', { bubbles: true })); } };
  if (act === 'cut') return search('pcut', 'pcQ');
  if (act === 'issue' || act === 'receive') return search('pbase', 'pbQ');
  if (act === 'qc') return search('qc', 'qcQ');
  if (act === 'print') return search('flow', 'flQ');
  if (act === 'hand') return shpbHandOpen(sku);
}
function shpbHandOpen(sku) {
  if (typeof shpReadyLines !== 'function' || !shpCanReceive()) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Handing over to shipping needs the Shopify tab.'; return; }
  const lines = shpReadyLines().filter(x => x.sku === obUC(sku));
  if (!lines.length) return;
  ptOpenDialog({
    title: 'Hand to shipping — ' + obUC(sku), subtitle: 'What passed QC and is not with shipping yet. Type what shipping is taking now.',
    html: '<div class="ptgrid" style="grid-template-columns:1fr 90px">' + lines.map((x, i) => `<div>${esc(String(x.shop).replace(/^#\s*/, ''))} <span class="muted">· ${nf(x.ready)} ready of ${nf(x.qty)}</span></div><input type="number" min="0" max="${x.ready}" value="${x.ready}" id="shpbH${i}">`).join('') + '</div>',
    saveLabel: 'Hand over',
    onSave: async () => {
      const items = lines.map((x, i) => ({ orderNo: x.orderNo, sku: x.sku, qty: Math.min(x.ready, Math.round(+$('shpbH' + i).value || 0)) })).filter(i => i.qty > 0);
      if (!items.length) return 'Type how many pieces shipping is taking.';
      const err = await shpReceive(items); if (!err) renderOrd(); return err;
    },
  });
}

if (SHPB_ON && $('odView') && $('odView').insertAdjacentHTML) $('odView').insertAdjacentHTML('beforeend', '<option value="shpboard">SHP board — test</option>');
if ($('odTable') && $('odTable').addEventListener) {
  $('odTable').addEventListener('click', e => {
    if (typeof ordView !== 'function' || ordView() !== 'shpboard') return;
    const a = e.target.closest && e.target.closest('[data-shpb-act]'); if (a) { e.preventDefault(); shpbGo(a.dataset.shpbAct, a.dataset.sku); return; }
    const m = e.target.closest && e.target.closest('[data-shpb-more]'); if (m) { e.preventDefault(); const k = m.dataset.shpbMore; if (SHPB.open.has(k)) SHPB.open.delete(k); else SHPB.open.add(k); renderShpBoard(); }
  });
  $('odTable').addEventListener('change', async e => {
    const i = e.target.closest && e.target.closest('[data-shpb-ready]'); if (!i || ordView() !== 'shpboard') return;
    const err = await shpbSetReady(i.dataset.shpbReady, i.value);
    if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; } else renderShpBoard();
  });
}
if ($('odKpis') && $('odKpis').addEventListener) $('odKpis').addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-shpb-tab]'); if (t && ordView() === 'shpboard') { SHPB.tab = t.dataset.shpbTab; renderShpBoard(); }
});
