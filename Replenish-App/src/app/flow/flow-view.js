/* ================= PRODUCTION FLOW · THE SCREEN =================
 * The bucket buttons across the top (each with how many lines are in it; only the buckets this account may open), and
 * the chosen bucket's list: SKU by SKU, with what that bucket is waiting for and a button to the screen where the work
 * is entered. The lines move on by themselves when that entry is made. */
let FLOW_VIEW = '';
const FLOW_ANGLE = {};   // per Demand view: 'line' or 'stock'

async function ensureFlow() { await flowEnsureData(); renderFlow(); }
/** Everything the lines are worked out from — also read by the Finished Goods screen's "From QC — to accept". */
async function flowEnsureData() {
  if (!PTG.mdb) { if ($('flMsg')) $('flMsg').textContent = 'Reading the order book…'; await ptLoadGates(); }
  /* Printer Allocation too: PPC's printer is suggested from it. */
  /* The store too: the printed stock PPC sees beside the RFD balance (Store Stock Balance; its Job Work and cutting
   * registers are the ones the order book has already read). */
  /* QC checks and the Finished Goods ledger: the QC bucket and the hand-over read them. */
  if (typeof QC !== 'undefined' && QC.checks == null) { try { QC.checks = ptList(await ptGet('pt_qcChecks')); } catch (e) { /* the QC bucket waits */ } }
  if (typeof FGI !== 'undefined' && FGI.rows == null && typeof fgiLoad === 'function') { try { await fgiLoad(); } catch (e) { /* India stock waits */ } }
  await Promise.all([flowLoad(), flowFabLoad(), (typeof STORE !== 'undefined' && STORE.rows === null ? ensureStore().catch(() => {}) : null), (PAL.printers === null ? palLoad().catch(() => {}) : null), (typeof ensureVo === 'function' ? ensureVo().catch(() => {}) : null),
    (typeof ensureAcc === 'function' ? ensureAcc().catch(() => {}) : null),
    /* The Greige Desk's RFD counts in Demand → RFD on the test link. */
    (FLOW_ON && typeof GD !== 'undefined' && gdAllowed() ? GD.ensure().catch(() => {}) : null)]);
}

/* The Fabric register, for the RFD stock Demand shows — read here without drawing the Fabric screen. */
async function flowFabLoad() {
  if (FAB.rows) return;
  try { FAB.rows = ptList(await ptGet('pt_fabInvLedger')); await fabAutoLoad(); } catch (e) { FAB.rows = FAB.rows || []; }
}
function flowCounts(rows) {
  const n = {}; FLOW_BUCKETS.forEach(b => { n[b[0]] = 0; });
  rows.forEach(({ s, recent }) => { FLOW_BUCKETS.forEach(([k]) => { if (k !== 'new' && flowInView(k, s)) n[k]++; }); if (recent) n.new++; });
  const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly();
  n.dhist = Object.values(FLOW.ch || {}).filter(c => !c.closed && !c.cancelled && (!only || flowIsTest(c.orderNo))).length;   // open challans
  n.pord = Object.values(FLOW.po || {}).filter(o => o && (!only || o.test) && !['done', 'cancelled'].includes(flowPoState(o))).length;   // print orders not finished
  return n;
}
const flowDays = iso => { const d = ptIsoDate(iso); if (!d) return null; return Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5)); };
const flowLate = iso => iso && iso < dToday();

function renderFlow() {
  flowEmbedRefresh();
  const allowed = flowScreenAllowed();
  if (!allowed.length) { $('flTable').innerHTML = ''; $('flMsg').textContent = 'No bucket of the production flow is given to this account.'; return; }
  if (!allowed.some(b => b[0] === FLOW_VIEW)) FLOW_VIEW = allowed.find(b => b[0] === 'ppc') ? 'ppc' : allowed[0][0];
  if (FLOW_DEMAND.includes(FLOW_VIEW)) FLOW.demView = FLOW_VIEW;
  const all = flowRows();
  const q = String($('flQ').value || '').trim().toLowerCase(), src = $('flSrc').value;
  const srcs = [...new Set(all.map(x => x.r.src || String(x.r.orderNo).split('-')[0]))].sort();
  ptFillSelect('flSrc', srcs.map(s => [s, s]), 'Every platform');
  const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly();
  if ($('flTestOnly')) $('flTestOnly').checked = only;
  /* With test orders off (flow-core.js) there is no test order to raise or narrow to: the button and the switch go. */
  const tests = flowTestsOn();
  if ($('flTest') && $('flTest').style) $('flTest').style.display = tests ? '' : 'none';
  const tLab = $('flTestOnly') && $('flTestOnly').parentNode;
  if (tLab && tLab.style) tLab.style.display = tests ? '' : 'none';
  const pass = x => (!only || x.r.__t) && (!src || (x.r.src || String(x.r.orderNo).split('-')[0]) === src)
    && (!q || [x.r.orderNo, x.r.sku, x.r.color, x.r.size, x.r.articleSubtype, x.r.articleType].join(' ').toLowerCase().includes(q));
  const shown = all.filter(pass), n = flowCounts(shown);
  /* PPC › Demand › Outsourced — Demand is one bucket with its tabs (flowDemandTabs). */
  const dem = allowed.filter(b => b[4] === 'demand'), bar = [];
  const before = allowed.some(x => x[0] === 'ppcdone') ? 'ppcdone' : 'ppc';
  allowed.forEach(b => { if (b[4] === 'flow') bar.push(b); if (b[0] === before && dem.length) bar.push(['demand', 'Demand', '', 'What PPC raised: RFD fabric out to printers, printed fabric in, accessories.']); });
  if (dem.length && !bar.some(b => b[0] === 'demand')) bar.unshift(['demand', 'Demand', '', 'What PPC raised: RFD fabric out to printers, printed fabric in, accessories.']);
  n.demand = dem.reduce((t, b) => t + (+n[b[0]] || 0), 0);
  /* One menu item, "PPC · Production flow"; inside it the buckets PPC › Demand (Ravi, 12 Oct: "main tab PPC Production flow
   * rakhna h, aur andar PPC and Demand like before — outsource rakhna hi nahi h"). */
  $('flBuckets').innerHTML = bar.map(([k, l, , tip]) => `<button class="fl-b${k === FLOW_VIEW || (k === 'demand' && FLOW_DEMAND.includes(FLOW_VIEW)) ? ' on' : ''}" data-flb="${k}" title="${esc(tip)}">
      <span class="fl-n">${nf(n[k] || 0)}</span><span>${esc(l)}</span></button>`).join('<span class="fl-arrow">›</span>');
  const rows = FLOW_VIEW === 'new' ? shown.filter(x => x.recent) : shown.filter(x => flowInView(FLOW_VIEW, x.s));
  rows.sort((a, b) => String(a.r.orderDate || '').localeCompare(String(b.r.orderDate || '')) || String(a.r.orderNo).localeCompare(String(b.r.orderNo)));
  FLOW.panel = ''; FLOW.stock = ''; FLOW.byprint = '';
  $('flTable').innerHTML = flowTable(FLOW_VIEW, rows.slice(0, 800));
  /* DEMAND HAS TWO ANGLES (Ravi, 10 Oct: "keep this section in a different angle"): the lines, or the stock by
   * fabric / accessory against them — one at a time, never stacked. */
  if (FLOW.stock) {
    const ang = FLOW_ANGLE[FLOW_VIEW] || 'line', what = FLOW_VIEW === 'drfd' ? 'By fabric (RFD stock)' : 'By accessory (shelf stock)';
    const angles = [['line', 'By line']].concat(FLOW_VIEW === 'drfd' ? [['print', 'By printed fabric (all orders)']] : []).concat([['stock', what]]);
    FLOW.panel = `<div class="seg" style="display:inline-flex;gap:4px">${angles.map(([k, l]) =>
      `<button data-flang="${k}" class="${ang === k ? '' : 'ghost'}" style="width:auto;padding:4px 12px;font-size:12.5px">${l}</button>`).join('')}</div>`;
    if (ang === 'stock') $('flTable').innerHTML = FLOW.stock;
    if (ang === 'print' && FLOW.byprint) $('flTable').innerHTML = FLOW.byprint;
  }
  /* DEMAND, ONE TAB (Ravi, 12 Oct): its parts as tabs, like Listing Health's — RFD out to printers, printed fabric in, accessories. */
  if (FLOW_DEMAND.includes(FLOW_VIEW)) FLOW.panel = `<div class="seg" style="display:inline-flex;gap:4px;flex-wrap:wrap;margin-right:14px">${dem.map(([k, l]) =>
    `<button data-fldem="${k}" class="${k === FLOW_VIEW ? '' : 'ghost'}" style="width:auto;padding:5px 14px;font-size:13px">${esc(l)} <b>${nf(n[k] || 0)}</b></button>`).join('')}</div>` + (FLOW.panel || '');
  /* RFD short? The Greige Desk shows the greige to order for it (Ravi, 13 Oct: Greige Desk joined to the PPC flow). */
  if (FLOW_VIEW === 'drfd' && typeof GD !== 'undefined' && gdAllowed()) FLOW.panel = (FLOW.panel || '') + '<button type="button" class="ghost" data-gdgo="ppc" style="width:auto;padding:5px 14px;font-size:13px;margin-left:10px">Greige Desk · greige for PPC</button>';
  $('flPanel').innerHTML = FLOW.panel; $('flPanel').classList.toggle('hide', !FLOW.panel);
  const b = FLOW_BUCKETS.find(x => x[0] === FLOW_VIEW);
  $('flMsg').className = FLOW.err ? 'err' : 'muted';
  $('flMsg').textContent = (FLOW.err ? 'Could not read the plans: ' + FLOW.err + ' · ' : '')
    + `${b[1]}: ${FLOW_VIEW === 'dhist' ? nf(n.dhist) + ' open challan(s)' : FLOW_VIEW === 'pord' ? nf(n.pord) + ' print order(s) not finished' : nf(rows.length) + ' line(s)'} — ${b[3]}` + (rows.length > 800 ? ' · showing the oldest 800' : '')
    + ` · PPC and Demand apply to orders from ${flowFrom()} · cutting is in Cutting Data, raw cutting and WIP in the Job Work Register · TEST VIEW, not on the live app`
    + ((FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly()) ? ' · SHOWING TEST ORDERS ONLY' : '');
}

/* BY PRINTED FABRIC: every line waiting for fabric, across every order, grouped by what the printer prints and the
 * printer PPC planned — the total to print, the orders it is for, and one challan for all of it. */
let FLOW_GROUPS = [];
function flowByPrintTable(rows) {
  const g = new Map();
  rows.filter(x => x.s.route !== 'stitch').forEach(x => {
    const p = x.s.plan || {}, w = flowPrintWhat(x.r, p), tp = flowToPrint(x.r, p), pc = flowPlanPrinter(x.s);
    const k = (x.r.__t ? 'T|' : 'R|') + (pc || '?') + '|' + (w.code || '?' + w.label);
    const e = g.get(k) || { w, pc, pname: (p.printer && p.printer.name) || '', keys: [], orders: new Set(), metres: 0, pcs: 0, test: !!x.r.__t };
    e.keys.push(x.s.key); e.orders.add(x.r.orderNo); e.metres += tp.metres; e.pcs += tp.pcs; g.set(k, e);
  });
  FLOW_GROUPS = [...g.values()].sort((a, b) => b.orders.size - a.orders.size || b.metres - a.metres);
  const body = FLOW_GROUPS.map((e, i) => `<tr><td class="frz" style="text-align:left">${e.w.needDir ? '<b style="color:#b91c1c">direction not picked</b>' : e.w.code ? `<b>${esc(e.w.code)}</b>` : '<b style="color:#b91c1c">no fabric SKU</b>'}${e.test ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}
      <div class="muted" style="font-size:10.5px">${esc(e.w.mode)} · ${esc(e.w.label)}</div></td>
    <td style="text-align:left;font-size:12px">${[...e.orders].map(esc).join('<br>')}</td>
    <td class="num">${nf(e.keys.length)}</td>
    <td class="num"><b>${e.w.kind === 'sku' ? nf(e.pcs) + ' pcs' : nf(flowR2(e.metres)) + ' m'}</b></td>
    <td style="text-align:left">${e.pname ? esc(e.pname) : '<span class="muted">not chosen</span>'}</td>
    <td><button data-flchg="${i}" style="width:auto;padding:3px 10px;font-size:12px">${e.orders.size > 1 ? `One challan for ${e.orders.size} orders` : 'Challan'}</button></td></tr>`).join('');
  return `<thead><tr><th class="frz" style="text-align:left">Printed fabric</th><th style="text-align:left">Orders</th><th>Lines</th><th>To print</th><th style="text-align:left">Printer</th><th></th></tr></thead><tbody>`
    + (body || '<tr><td colspan="6" class="muted" style="padding:16px">No line is waiting for fabric.</td></tr>') + '</tbody>';
}
/* WHAT THE CUTTING DEPARTMENT CUTS FROM, for a planned line: the printed fabric (from the store, or back from the
 * printer), how much, for how many pieces of the order. */
function flowCutFrom(x) {
  const p = x.s.plan; if (!p || x.s.route !== 'inhouse') return '<span class="muted">—</span>';
  const w = flowPrintWhat(x.r, p), m = flowR2(+(p.fabric && p.fabric.metres) || 0), fp = +(p.fabric && p.fabric.fromPrinted) || 0;
  return `${w.kind === 'sku' ? `<b>${esc(w.code)}</b> printed pieces` : flowPrintTxt(w)}<div class="muted" style="font-size:10.5px">${w.kind === 'sku' ? nf(x.r.qty) + ' pcs' : nf(m) + ' m'} for ${nf(x.r.qty)} pcs`
    + (x.s.fromStock ? ' · <b style="color:#166534">all from printed stock in the store</b>' : fp > 0 ? ` · ${nf(fp)} ${p.fabric.printedUnit === 'pcs' ? 'pcs' : 'm'} from printed stock, the rest from the printer` : ' · from the printer') + '</div>'
    + (x.s.bucket === 'fabric' ? `<div style="font-size:11px;color:#b45309"><b>${nf(x.s.canCut)} pcs can be cut now</b> — printed fabric back for ${nf(x.s.back)} of ${nf(x.r.qty)} pcs, the rest still with the printer</div>` : '');
}
/* THE WASTE OF THE CUTTING TABLE (Ravi, 11 Oct: "yadi kuch waste ho to wo show ho Raw cutting in store me"). Every cutting
 * entry of a planned line that left printed fabric on the table — the test order's own, and the Cutting Data rows of a
 * real one — with the printed fabric it is, and what the store holds of that cloth now (the waste goes back in there). */
function flowWasteRows() {
  const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly(), out = [];
  flowRows().forEach(({ r, s }) => {
    if (!s.plan || (only && !r.__t)) return;
    const pf = flowCutFabricOf(r, s.plan); if (!pf.code) return;
    const m = cutSkuOf(r.sku) || {}, colour = String(m.color || r.color || '').trim();
    let store = null; try { store = flowPrintedStock(Object.assign({ fabric: (s.plan.fabric || {}).name }, pf.w), colour); } catch (e) { store = null; }
    const cuts = r.__t ? Object.values(r.__t.cutLog || {}).map(c => ({ m: +c.waste || 0, width: +c.wasteWidth || 0, date: c.date || String(c.at || '').slice(0, 10) }))
      : (PT.cut || []).filter(c => c && obUC(c.orderNo) === obUC(r.orderNo) && obUC(c.sku) === obUC(r.sku)).map(c => ({ m: +c.fabricWaste || 0, width: +c.fabricWasteWidth || 0, date: ptIsoDate(c.cutDate) || String(c.addedAt || '').slice(0, 10) }));
    cuts.filter(c => c.m > 0).forEach(c => out.push({ date: c.date, orderNo: r.orderNo, sku: obUC(r.sku), code: pf.code, label: pf.label, m: flowR2(c.m), width: c.width, store, test: !!r.__t }));
  });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 50);
}
/** A test line asks what the factory's forms ask, and keeps it on the test order (flow-test-order.js). */
function flowTestEntryButtons(view, x) {
  const b = (what, label, main) => `<button data-flte="${what}|${esc(x.r.orderNo)}|${esc(obUC(x.r.sku))}" style="width:auto;padding:3px 10px;font-size:12px;margin:1px;background:${main ? '#7c3aed' : 'transparent'};border-color:#7c3aed;color:${main ? '#fff' : '#7c3aed'}">${label}</button>`;
  const btns = view === 'cut' ? b('cut', 'Cutting entry (test) →', true) : view === 'raw' ? b('issue', 'Issue to karigar (test) →', true)
    : (x.s.issued > x.s.received ? b('recv', 'Receive (test) →', true) : '');
  const note = flowTestNote(x, view);
  return btns + (note ? `<div class="muted" style="font-size:10.5px;margin-top:3px">${note}</div>` : '');
}
/** The factory's own entry, opened for the line (flow-entries.js) — what the bucket is waiting for. */
function flowEntryButtons(view, x) {
  const b = (what, label, main) => `<button ${main ? '' : 'class="ghost" '}data-flent="${what}|${esc(x.s.key)}" style="width:auto;padding:${main ? '3px 10px;font-size:12px' : '2px 9px;font-size:11.5px'};margin:1px">${label}</button>`;
  if (view === 'cut') return b('cut', 'Cutting entry →', true);
  if (view === 'raw') return b('issue', 'Issue to karigar →', true);
  return x.s.issued > x.s.received ? b('recv', 'Receive →', true) : '';
}
/** The challan a line's fabric went on, if it went on one. */
const flowChTag = s => { const fr = s.demand && s.demand.fabricReady; return fr && fr.challan
  ? `<div class="muted" style="font-size:10.5px">RFD on <a href="#" data-flchp="${esc(fr.challan)}">${esc(fr.challan)}</a> → ${esc(fr.vendor || '')}</div>` : ''; };
const FLOW_GO = { out: ['fgi', 'Finished Goods (receive)'], vendor: ['vreq', 'Vendor requests'], fabric: ['vlog', 'History (accept)'], cut: ['pcut', 'Cutting'], raw: ['pbase', 'Job Work (issue)'],
  wip: ['qc', 'QC'], fgin: ['fgi', 'Finished Goods (receive)'] };

function flowTable(view, rows) {
  const pic = sku => { const u = typeof ptImgOf === 'function' ? ptImgOf(sku) : ''; return u ? `<img src="${esc(ptImgSrc(u, 34))}" alt="" style="width:34px;height:34px;object-fit:contain;background:#fff;border-radius:5px">` : ''; };
  /* COMPACT (Ravi, 14 Oct: "compact this"): the order column has a width it wraps in, and the order's name, badge, delete
   * link and date are written once — on the first of its lines in a run; the lines under it carry the order no small. */
  let prevNo = null;
  const poHead = x => {
    const again = x.r.orderNo === prevNo; prevNo = x.r.orderNo;
    if (again) return `<div class="muted" style="font-size:11px">${esc(x.r.orderNo)}</div>`;
    return (x.r.__t ? `<b>${esc(x.r.orderNo)}</b> <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>
      <a href="#" data-fltdel="${esc(x.r.orderNo)}" style="font-size:10.5px;color:#b91c1c;margin-left:4px">delete test</a>` : `<a href="#" data-ordj="${esc(x.r.orderNo)}" style="font-weight:600">${esc(x.r.orderNo)}</a>`)
      + `<div class="muted" style="font-size:10.5px">${esc(x.r.src || '')} · ${esc(ptIsoDate(x.r.orderDate) || '')} · ${nf(flowDays(x.r.orderDate) || 0)} d${x.r.fromSo ? ` · copy of sales order ${esc(x.r.fromSo)}` : ''}</div>`;
  };
  const base = x => `<td class="frz" style="text-align:left;width:300px;max-width:300px;white-space:normal">${poHead(x)}${flowDocsHtml(x)}</td>
    <td style="text-align:left;white-space:nowrap">${pic(x.r.sku)} <b style="font-family:ui-monospace,monospace;vertical-align:top">${esc(x.r.sku)}</b>
      <div class="muted" style="font-size:10.5px">${esc([x.r.articleSubtype || x.r.articleType, x.r.color, x.r.size].filter(Boolean).join(' · '))}</div></td>
    <td class="num"><b>${nf(x.r.qty)}</b></td>`;
  /* A test line has no register entry to make: its button stands in for that entry. */
  const go = (view, x) => x && x.r.__t && ['cut', 'raw', 'wip'].includes(view) ? flowTestEntryButtons(view, x)
    : x && x.r.__t && FLOW_SIM[view] ? `<button data-flsim="${esc(x.r.orderNo)}|${esc(x.r.sku)}|${view}" title="Stands in for: ${esc(FLOW_SIM[view][1])}" style="width:auto;padding:3px 10px;font-size:12px;background:#7c3aed;border-color:#7c3aed">${esc(FLOW_SIM[view][0])}</button>`
    : x && !x.r.__t && ['cut', 'raw', 'wip'].includes(view) ? flowEntryButtons(view, x)
    : FLOW_GO[view] ? `<button class="ghost" data-flgo="${FLOW_GO[view][0]}" style="width:auto;padding:2px 9px;font-size:11.5px">${FLOW_GO[view][1]} →</button>` : '';
  const prog = (d, of) => `<span class="jw-st ${d >= of ? 'done' : d > 0 ? 'prog' : 'pend'}">${nf(d)} / ${nf(of)}</span>`;
  const due = (iso, label) => iso ? `<div class="muted" style="font-size:10.5px${flowLate(iso) ? ';color:#b91c1c;font-weight:600' : ''}">${label} ${esc(iso.slice(5))}${flowLate(iso) ? ' · late' : ''}</div>` : '';
  let head = '', body = '';
  if (view === 'pord') return flowPoTable(String($('flQ').value || '').trim().toLowerCase(), FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly());
  if (view === 'dhist') return flowHistTable(String($('flQ').value || '').trim().toLowerCase(), FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly());
  if (view === 'new') {
    head = ['PO', 'SKU', 'Qty', 'Now in'];
    const now = s => s.bucket === 'done' ? 'Done' : s.bucket === 'demand' ? [s.needFab && 'Demand · RFD fabric', s.needAcc && 'Demand · Accessories'].filter(Boolean).join(' + ')
      : FLOW_ELSEWHERE[s.bucket] || (FLOW_BUCKETS.find(b => b[0] === s.bucket) || [, s.bucket])[1];
    /* A reserved line leaves the Accessories list, so this is where a reservation can be let go before issue. */
    body = rows.map(x => `<tr>${base(x)}<td style="text-align:left">${esc(now(x.s))}${x.s.res && !x.s.issued && flowBucketsAllowed().some(b => b[0] === 'dacc')
      ? ` <button class="ghost" data-flunres="${esc(x.s.key)}" style="width:auto;padding:1px 7px;font-size:11px">Release accessories</button>` : ''}</td></tr>`).join('');
  } else if (view === 'ppc') {
    head = ['PO', 'SKU', 'Qty', 'What the plan will hold', ''];
    const seen = new Set();
    body = rows.map(x => { const sg = flowSuggest(x.r), first = !seen.has(x.r.orderNo); seen.add(x.r.orderNo);
      return `<tr>${base(x)}<td style="text-align:left;font-size:12px">${esc(sg.fabric.name || '?')} ${sg.fabric.metres ? nf(sg.fabric.metres) + ' m' : '<b style="color:#b91c1c">metres not known</b>'}
        · ${sg.print.need ? `print: <b>${esc(sg.printer.name || 'printer not chosen')}</b>${sg.printer.why ? ` <span class="muted" style="font-size:10.5px">(${esc(sg.printer.why)})</span>` : ''}` : 'stitching only, no printing'}${sg.acc.length ? ' · ' + sg.acc.map(a => esc(a.code) + '×' + nf(a.qty)).join(', ') : ''}
        ${sg.gaps.length ? `<div style="font-size:10.5px;color:#92400e">${esc(sg.gaps[0])}${sg.gaps.length > 1 ? ' (+' + (sg.gaps.length - 1) + ')' : ''}</div>` : ''}</td>
        <td style="white-space:nowrap">${first ? `<button data-flppc="${esc(x.r.orderNo)}" style="width:auto;padding:3px 10px;font-size:12px">Plan this PO</button>` : ''}
          <button class="ghost" data-flppc="${esc(x.r.orderNo)}" data-sku="${esc(x.r.sku)}" style="width:auto;padding:2px 8px;font-size:11.5px">This line</button></td></tr>`; }).join('');
  } else if (view === 'ppcdone') {
    /* What PPC planned, line by line, where the line is now, and the one place to change it. */
    head = ['PO', 'SKU', 'Qty', 'Planned', 'Now in', 'Raised', ''];
    const now = s => s.bucket === 'demand' ? [s.needFab && 'Demand · RFD fabric', s.needAcc && 'Demand · Accessories'].filter(Boolean).join(' + ')
      : FLOW_ELSEWHERE[s.bucket] || (FLOW_BUCKETS.find(b => b[0] === s.bucket) || [, s.bucket])[1];
    body = rows.map(x => { const p = x.s.plan || {}, rp = flowRufflePrinter(p), rt = (FLOW_ROUTES.find(r => r[0] === flowRouteOf(p)) || [, , flowRouteOf(p)])[2];
      const locked = flowFabLocked(x.s);
      return `<tr>${base(x)}<td class="num">${nf(+x.r.qty || 0)}</td>
        <td style="text-align:left;font-size:12px"><b>${esc(rt || '')}</b>${p.fabric && p.fabric.name ? ` · ${esc(p.fabric.name)} ${nf(flowR2(+p.fabric.metres || 0))} m` : ''}
          ${p.printer && p.printer.name ? `<div>print: <b>${esc(p.printer.name)}</b>${rp ? ` · ruffle: <b>${esc(rp.name)}</b>` : ''}</div>` : ''}
          ${(p.acc || []).filter(a => a.code && +a.qty > 0).length ? `<div class="muted" style="font-size:10.5px">${(p.acc || []).filter(a => a.code && +a.qty > 0).map(a => esc(a.what || a.code) + ' × ' + nf(a.qty)).join(' · ')}</div>` : ''}</td>
        <td style="text-align:left;font-size:12px">${esc(now(x.s))}</td>
        <td style="text-align:left;font-size:11.5px" class="muted">${esc(String(p.at || '').slice(0, 10))}${p.by ? ' · ' + esc(String(p.by).split('@')[0]) : ''}</td>
        <td style="white-space:nowrap"><button data-flplan="${esc(x.r.orderNo)}|${esc(x.r.sku)}" style="width:auto;padding:3px 10px;font-size:12px" title="Change or undo what PPC planned">Edit plan</button>
          ${locked ? `<div class="muted" style="font-size:10.5px">fabric on ${esc(x.s.challan.no)} — fabric, route and printer stay</div>` : ''}</td></tr>`; }).join('');
  } else if (view === 'drfd') {
    head = ['PO', 'SKU', 'Qty', 'Made as', 'Fabric this line uses', 'RFD left for it', ''];
    const cv = flowRfdCover(), seen = new Set();
    body = rows.map(x => { const p = x.s.plan || {}, c = cv.line[x.s.key] || { need: 0, avail: 0, short: 0 };
      /* One challan button per PO and planned printer, on that printer's first line; none for stitching only. */
      const pk = x.s.route === 'stitch' ? '' : (flowPlanPrinter(x.s) || '?'), gk = x.r.orderNo + '|' + pk;
      const first = pk && !seen.has(gk); seen.add(gk);
      /* The ruffle cloth to its own printer: that printer's challan button too (once per PO and printer). */
      const ro = flowRuffleOwed(x), rk = ro ? x.r.orderNo + '|' + ro.printer.code : '', rfirst = !!ro && !seen.has(rk); if (ro) seen.add(rk);
      return `<tr${c.short ? ' style="background:#fef2f2"' : ''}>${base(x)}
        <td style="text-align:left;font-size:12px">${x.s.route === 'stitch' ? 'Stitching only' : `Print: <b>${esc((p.printer && p.printer.name) || '—')}</b><div style="font-size:11px;color:#4338ca">${flowPrintTxt(flowPrintWhat(x.r, p))}</div>${flowExtrasTxt(flowPrintExtras(x.r, p))}${flowRufflePrinter(p) ? `<div style="font-size:10.5px;color:#5b21b6">ruffle → <b>${esc(flowRufflePrinter(p).name)}</b>${ro ? '' : ' · sent'}</div>` : ''}`}</td>
        <td style="text-align:left;font-size:12px">${p.fabric ? `<b>${esc(p.fabric.name)}</b> · ${nf(c.need)} m to send` : '—'}${ro ? `<div style="font-size:10.5px;color:#5b21b6">ruffle: ${esc(ro.fabric)} · ${nf(ro.metres)} m to ${esc(ro.printer.name)}</div>` : ''}${x.s.fabSent > 0 ? `<div class="muted" style="font-size:10.5px">${nf(x.s.fabSent)} of ${nf(x.s.fabNeed)} ${x.s.fabUnit} sent</div>` : ''}${flowMasterDiffTxt(flowMasterDiff(x.r, p))}</td>
        <td style="text-align:left;font-size:12px">${c.short ? `<span class="jw-st" style="background:#fee2e2;color:#b91c1c;font-weight:700">⚑ SHORT ${nf(c.short)} m</span> <span class="muted">${nf(c.avail)} m left</span>`
          : `<span class="jw-st done">covered</span> <span class="muted">${nf(c.avail)} m left</span>`}</td>
        <td style="white-space:nowrap">${first ? `<button data-flch="${esc(x.r.orderNo)}" data-pc="${esc(pk)}" style="width:auto;padding:3px 10px;font-size:12px">${pk === '?' ? 'Challan (printer not chosen)' : 'Challan → ' + esc((p.printer && p.printer.name) || pk)}</button> ` : ''}${rfirst ? `<button data-flch="${esc(x.r.orderNo)}" data-pc="${esc(ro.printer.code)}" style="width:auto;padding:3px 10px;font-size:12px;background:#7c3aed;border-color:#7c3aed">Ruffle challan → ${esc(ro.printer.name)}</button> ` : ''}<button class="ghost" data-flfab="${esc(x.s.key)}" style="width:auto;padding:2px 9px;font-size:11.5px">Mark fabric ready</button></td></tr>`; }).join('');
    const fs = Object.values(cv.fab).filter(f => f.need > 0).sort((a, b) => b.short - a.short || a.name.localeCompare(b.name));
    FLOW.byprint = flowByPrintTable(rows);
    FLOW.stock = `<thead><tr><th style="text-align:left">Fabric</th><th>RFD in stock</th><th>Kept for lines already ready</th><th>These lines need</th><th>Short</th></tr></thead><tbody>`
      + fs.map(f => `<tr${f.short ? ' style="background:#fef2f2"' : ''}><td style="text-align:left"><b>${esc(f.name)}</b></td><td class="num">${nf(flowR2(f.stock))} m</td><td class="num">${nf(flowR2(f.held))} m</td><td class="num">${nf(f.need)} m · ${nf(f.lines)} line(s)</td>
        <td class="num">${f.short ? `<b style="color:#b91c1c">⚑ ${nf(f.short)} m</b>` : '<span style="color:#166534">—</span>'}</td></tr>`).join('') + (fs.length ? '' : '<tr><td colspan="5" class="muted" style="padding:16px">No line is waiting for fabric.</td></tr>') + '</tbody>';
  } else if (view === 'dacc') {
    head = ['PO', 'SKU', 'Qty', 'Accessories this line uses', ''];
    const free = flowAccFree();
    body = rows.map(x => { const acc = ((x.s.plan && x.s.plan.acc) || []).filter(a => a.code && +a.qty > 0);
      const short = acc.some(a => { const f = free[accCode(a.code)]; return !f || f.free < a.qty; });
      return `<tr${short ? ' style="background:#fef2f2"' : ''}>${base(x)}<td style="text-align:left">${acc.map(a => { const f = free[accCode(a.code)]; const ok = f && f.free >= a.qty;
          return `<div style="font-size:12px"><b>${esc(a.code)}</b> ${esc(a.what || '')} × ${nf(a.qty)} <span style="color:${ok ? '#166534' : '#b91c1c'};font-weight:600">${f ? nf(Math.max(0, f.free)) + ' free' : 'not on the shelf'}${ok ? '' : ' · ⚑ short ' + nf(a.qty - Math.max(0, f ? f.free : 0))}</span></div>`; }).join('')}</td>
        <td><button data-flres="${esc(x.s.key)}" style="width:auto;padding:3px 10px;font-size:12px">Reserve</button></td></tr>`; }).join('');
    const ac = flowAccCover();
    FLOW.stock = `<thead><tr><th style="text-align:left">Code</th><th>On the shelf</th><th>Reserved already</th><th>These lines need</th><th>Short</th></tr></thead><tbody>`
      + ac.map(a => `<tr${a.short ? ' style="background:#fef2f2"' : ''}><td style="text-align:left"><b>${esc(a.code)}</b> <span class="muted">${esc(a.name !== a.code ? a.name : '')}</span></td><td class="num">${nf(a.shelf)}</td><td class="num">${nf(a.held)}</td><td class="num">${nf(a.need)}</td>
        <td class="num">${a.short ? `<b style="color:#b91c1c">⚑ ${nf(a.short)}</b>` : '<span style="color:#166534">—</span>'}</td></tr>`).join('') + (ac.length ? '' : '<tr><td colspan="5" class="muted" style="padding:16px">No line is waiting for accessories.</td></tr>') + '</tbody>';
  } else if (view === 'out') {
    head = ['PO', 'SKU', 'Qty', 'Made by', 'Received in Finished Goods', ''];
    body = rows.map(x => `<tr>${base(x)}<td style="text-align:left"><b>${esc((x.s.plan && x.s.plan.outVendor) || '—')}</b></td>
      <td class="num">${prog(x.s.india, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.ready, 'due')}</td><td>${go(view, x)}</td></tr>`).join('');
  } else if (view === 'vendor') {
    head = ['PO', 'SKU', 'Qty', 'Given to a printer', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${prog(x.s.given, +x.r.qty)}${flowChTag(x.s)}</td><td>${go(view, x)}</td></tr>`).join('');
  } else if (view === 'cut') {
    head = ['PO', 'SKU', 'Qty', 'Printed fabric to cut', 'Cut', ''];
    body = rows.map(x => `<tr>${base(x)}<td style="text-align:left;font-size:12px">${flowCutFrom(x)}</td><td class="num">${prog(x.s.cut, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.cut, 'plan')}</td><td>${go(view, x)}</td></tr>`).join('');
  } else if (view === 'raw') {
    head = ['PO', 'SKU', 'Qty', 'In store, to issue', 'Issued', ''];
    const wr = flowWasteRows();
    const wasteHtml = wr.length ? `<tr style="background:rgba(180,83,9,.06)"><td colspan="6" style="text-align:left;font-size:12px"><b>Waste back in the store from cutting</b> <span class="muted">— printed fabric left on the table; it is in the store and the next plan can use it</span>`
      + `<table class="xl" style="margin-top:6px;width:auto"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Order · SKU</th><th style="text-align:left">Printed fabric</th><th>Waste</th><th>Width</th><th>In store now</th></tr></thead><tbody>`
      + wr.map(w => `<tr><td style="text-align:left">${esc(w.date)}</td><td style="text-align:left">${esc(w.orderNo)} · ${esc(w.sku)}${w.test ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}</td>`
        + `<td style="text-align:left"><b>${esc(w.code)}</b> <span class="muted">${esc(w.label)}</span></td><td class="num"><b>${nf(w.m)} m</b></td><td class="num">${w.width ? nf(w.width) + '"' : '—'}</td><td class="num">${w.store == null ? '…' : nf(w.store) + ' m'}</td></tr>`).join('')
      + '</tbody></table></td></tr>' : '';
    body = wasteHtml + rows.map(x => { const sp = flowStorePcs(x.r.sku);
      return `<tr>${base(x)}<td class="num"><b>${nf(flowIssuable(x.r, x.s))}</b>${x.s.bucket !== 'raw' ? `<div style="font-size:10.5px;color:#b45309">${x.s.bucket === 'fabric' ? 'part back from the printer' : 'part cut'} — the rest still to come</div>` : ''}${x.s.qcRej ? `<div style="font-size:10.5px;color:#b45309">${nf(x.s.qcRej)} rejected at QC — back in store, issue again</div>` : ''}${sp == null ? '' : `<div class="muted" style="font-size:10.5px">store balance ${nf(sp)} pcs of this SKU</div>`}</td><td class="num">${prog(x.s.issued, +x.r.qty)}</td><td>${go(view, x)}</td></tr>`; }).join('');
  } else if (view === 'wip') {
    head = ['PO', 'SKU', 'Qty', 'Issued', 'Received', 'QC passed', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${nf(x.s.issued)}</td><td class="num">${nf(x.s.received)}</td>
      <td class="num">${prog(x.s.made, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.qc, 'plan')}</td><td>${go(view, x)}</td></tr>`).join('');
  }
  return '<thead><tr>' + head.map((h, i) => `<th${i === 0 ? ' class="frz" style="text-align:left"' : i === 1 ? ' style="text-align:left"' : ''}>${esc(h)}</th>`).join('') + '</tr></thead><tbody>'
    + (body || `<tr><td colspan="${head.length}" class="muted" style="padding:16px">Nothing in this bucket.</td></tr>`) + '</tbody>';
}

/* ---- wiring ---- */
$('flBuckets').addEventListener('click', e => { const b = e.target.closest('[data-flb]'); if (!b) return;
  FLOW_VIEW = b.dataset.flb === 'demand' ? (FLOW.demView || (flowScreenAllowed().find(x => x[4] === 'demand') || [])[0] || 'drfd') : b.dataset.flb; renderFlow(); });
$('flPanel').addEventListener('click', e => { const gg = e.target.closest('[data-gdgo]'); if (gg) { showTab('gdesk'); GD.open(gg.dataset.gdgo); return; } const dm = e.target.closest('[data-fldem]'); if (dm) { FLOW_VIEW = dm.dataset.fldem; renderFlow(); return; }
  const an = e.target.closest('[data-flang]'); if (an) { FLOW_ANGLE[FLOW_VIEW] = an.dataset.flang; renderFlow(); return; }
  const cp = e.target.closest('[data-flchp]'); if (!cp) return;
  const er = flowChallanPrint(cp.dataset.flchp); if (er) { $('flMsg').className = 'err'; $('flMsg').textContent = er; } });
$('flQ').addEventListener('input', () => { clearTimeout(FLOW.qt); FLOW.qt = setTimeout(renderFlow, 220); });
$('flSrc').addEventListener('change', renderFlow);
$('flTest').onclick = () => flowTestOpen();
$('flTestOnly').addEventListener('change', () => { flowTestOnlySet($('flTestOnly').checked); renderFlow(); });
$('flRefresh').onclick = async () => { $('flMsg').textContent = 'Reading again…'; await Promise.all([ptLoadGates(true), flowLoad(true)]); renderFlow(); };
/* The bucket table's buttons — on the flow screen, and in its tabs inside Cutting Data and the Job Work Register. */
async function flowTableClick(e) {
  const sm = e.target.closest('[data-flsim]');
  if (sm) { const [no, sku, view] = sm.dataset.flsim.split('|'); const er = await flowSimulate(no, sku, view);
    $('flMsg').className = er ? 'err' : 'muted'; if (er) $('flMsg').textContent = er; else renderFlow(); return; }
  const td = e.target.closest('[data-fltdel]');
  if (td) { e.preventDefault(); const er = await flowTestDelete(td.dataset.fltdel); $('flMsg').className = er ? 'err' : 'muted'; if (er) $('flMsg').textContent = er; else renderFlow(); return; }
  const oj = e.target.closest('[data-ordj]');
  if (oj) { e.preventDefault(); try { ordJourney(oj.getAttribute('data-ordj')); } catch (err) { /* the order book is not read yet */ } return; }
  const g = e.target.closest('[data-flgo]'); if (g) { showTab(g.dataset.flgo); return; }
  const rv = e.target.closest('[data-flchr]'); if (rv) { flowReceiveOpen(rv.dataset.flchr); return; }
  const pl = e.target.closest('[data-flplan]'); if (pl) { e.preventDefault(); const [no, sku] = pl.dataset.flplan.split('|'); flowPpcOpen(no, sku); return; }
  const ce = e.target.closest('[data-flche]'); if (ce) { flowChallanEditOpen(ce.dataset.flche); return; }
  const cx = e.target.closest('[data-flchx]'); if (cx) { flowChallanCancelOpen(cx.dataset.flchx); return; }
  const cu = e.target.closest('[data-flchu],[data-flcho]');
  if (cu) { const er = cu.dataset.flchu ? await flowUndoReceipt(cu.dataset.flchu) : await flowReopen(cu.dataset.flcho);
    $('flMsg').className = er ? 'err' : 'muted'; if (er) $('flMsg').textContent = er; else renderFlow(); return; }
  const cs = e.target.closest('[data-flchc]'); if (cs) { flowCloseShortOpen(cs.dataset.flchc); return; }
  const ch = e.target.closest('[data-flch]'); if (ch) { flowChallanOpen(ch.dataset.flch, ch.dataset.pc); return; }
  const qb = e.target.closest('[data-flqb]');
  if (qb) { const [what, key] = qb.dataset.flqb.split('|'), x = flowRows().find(y => y.s.key === key); if (!x) return;
    if (what === 'qc') flowQcEntry(x.r); else if (what === 'fg') flowFgOpen(); else if (what === 'recv') flowRecvEntry(x.r); else if (what === 'issue') flowIssueEntry(x.r, x.s);
    return; }
  const te = e.target.closest('[data-flte]');
  if (te) { const [what, no, sku] = te.dataset.flte.split('|');
    if (what === 'cut') flowTestCutOpen(no, sku); else if (what === 'issue') flowTestIssueOpen(no, sku); else if (what === 'recv') flowTestRecvOpen(no, sku);
    return; }
  const en = e.target.closest('[data-flent]');
  if (en) { const [what, key] = en.dataset.flent.split('|'), x = flowRows().find(y => y.s.key === key); if (!x) return;
    if (what === 'cut') flowCutEntry(x.r, x.s); else if (what === 'issue') flowIssueEntry(x.r, x.s); else if (what === 'recv') flowRecvEntry(x.r); else if (what === 'qc') flowQcEntry(x.r);
    return; }
  const pop = e.target.closest('[data-flpop]'); if (pop) { const er = flowPoPrint(pop.dataset.flpop); if (er) { $('flMsg').className = 'err'; $('flMsg').textContent = er; } return; }
  const cg = e.target.closest('[data-flchg]'); if (cg) { const grp = FLOW_GROUPS[+cg.dataset.flchg]; if (grp) flowChallanForKeys(grp.keys); return; }
  const cp = e.target.closest('[data-flchp]'); if (cp) { e.preventDefault(); const er = flowChallanPrint(cp.dataset.flchp); if (er) { $('flMsg').className = 'err'; $('flMsg').textContent = er; } return; }
  const pp = e.target.closest('[data-flppc]'); if (pp) { flowPpcOpen(pp.dataset.flppc, pp.dataset.sku || ''); return; }
  const key = (e.target.closest('[data-flfab],[data-flres],[data-flunres]') || {}).dataset;
  if (!key) return;
  const x = flowRows().find(y => y.s.key === (key.flfab || key.flres || key.flunres)); if (!x) return;
  if (key.flfab) return flowFabricOpen(x.r, x.s);
  const err = key.flres ? await flowReserve(x.r, x.s) : await flowUnreserve(x.s);
  $('flMsg').className = err ? 'err' : 'muted';
  if (err) $('flMsg').textContent = err; else renderFlow();
}
$('flTable').addEventListener('click', flowTableClick);
/* The menu button shows only where the flow is switched on, and only to an account with a bucket. */
/* The Greige Desk (test) is for anyone holding one of its rights, on the test link only. */
function gdAllowed() { return ['gdesk', 'gdled', 'gdledit', 'gdappr'].some(k => ME.admin || !(ME.tabs && ME.tabs.length) || ME.tabs.includes(k)); }
function flowNavShow() { if ($('tabGdesk')) $('tabGdesk').style.display = FLOW_ON && gdAllowed() ? '' : 'none'; if ($('tabFlow')) $('tabFlow').style.display = FLOW_ON && flowScreenAllowed().length ? '' : 'none'; flowEmbedSetup(); flowDupViewsOff(); }

/* ---- THE OLD VIEWS OF THE SAME WORK, TAKEN OUT (Ravi, 13 Oct: "remove the duplicate") ----
 * Cutting Data's "Cut, not yet issued" is Job Work → Raw cutting in store, and the Job Work Register's "Has pending" (and its
 * Pending pieces card) is the WIP tab — both read every open line, old orders too. Taken out only for an account that has
 * the flow tab in their place, so nobody loses the list. */
const FLOW_DUP_VIEWS = [['pcView', 'wait', 'raw'], ['pbStatus', 'pending', 'wip']];
function flowDupViewsOff() {
  FLOW_DUP_VIEWS.forEach(([id, val, view]) => {
    const sel = $(id);   // both flow tabs that replace them live in the Job Work Register
    if (!sel || !sel.querySelector || !flowEmbedViews('pbase').includes(view)) return;
    const o = sel.querySelector(`option[value="${val}"]`); if (!o) return;
    if (sel.value === val) { sel.value = ''; sel.dispatchEvent(new Event('change')); }
    o.remove();
  });
}
/** The Pending pieces card opens the WIP tab instead, where the flow has it. */
const flowPendingToWip = () => (flowEmbedViews('pbase').includes('wip') ? (FLOW_EMB.pbase = 'wip', flowEmbedRender('pbase'), true) : false);

/* ---- TABS INSIDE THE FACTORY'S OWN SCREENS (Ravi, 12 Oct: "cutting should be shown in cutting department which is already
 * there; raw cutting should be shown in Job Work Register — like Listing Health's tabs; WIP part of Job Work Register") ----
 * Cutting Data gets "To cut · Production flow"; the Job Work Register gets "Raw cutting in store" and "WIP · with karigars".
 * The first tab is the screen as it is; a flow tab sets the screen's own content aside and shows that bucket, with the
 * same buttons as before. Only where the flow is switched on, and only the tabs this account may open. */
const FLOW_EMBED = { pcut: { pane: 'panePcut', own: 'Cutting Data', views: ['cut'] }, pbase: { pane: 'panePbase', own: 'Job Work Register', views: ['raw', 'wip'] } };
const FLOW_EMB = { pcut: '', pbase: '' };
function flowEmbedViews(tab) { const mine = new Set(flowBucketsAllowed().map(b => b[0])); return FLOW_ON ? FLOW_EMBED[tab].views.filter(v => mine.has(v)) : []; }
function flowEmbedSetup() {
  Object.keys(FLOW_EMBED).forEach(tab => {
    const pane = $(FLOW_EMBED[tab].pane); if (!pane || !pane.insertAdjacentHTML) return;
    const views = flowEmbedViews(tab), seg = $('flSeg_' + tab);
    if (!views.length) { if (seg && seg.remove) { seg.remove(); const b = $('flEmb_' + tab); if (b && b.remove) b.remove(); } FLOW_EMB[tab] = ''; return; }
    if (!seg || !seg.isConnected) {
      pane.insertAdjacentHTML('afterbegin', `<div id="flSeg_${tab}" class="card" style="padding:8px 10px;margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"></div>`
        + `<div id="flEmb_${tab}" class="hide"><div class="card" style="padding:10px 14px"><div id="flEmbMsg_${tab}" class="muted" style="font-size:12.5px"></div></div>`
        + `<div class="card xlwrap" style="margin-top:12px"><table class="xl" id="flEmbT_${tab}"></table></div></div>`);
      $('flSeg_' + tab).addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-flemb]'); if (!b) return; FLOW_EMB[tab] = b.dataset.flemb; flowEmbedRender(tab); });
      $('flEmbT_' + tab).addEventListener('click', flowTableClick);
    }
    flowEmbedRender(tab);
  });
}
/** Back to the screen's own content (a flow tab's button opens the screen's form). */
function flowEmbedOff(tab) { if (FLOW_EMB[tab]) { FLOW_EMB[tab] = ''; flowEmbedRender(tab); } }
function flowEmbedRefresh() { Object.keys(FLOW_EMBED).forEach(tab => { if (FLOW_EMB[tab]) flowEmbedRender(tab); }); }
async function flowEmbedRender(tab) {
  const cfg = FLOW_EMBED[tab], pane = $(cfg.pane), seg = $('flSeg_' + tab), box = $('flEmb_' + tab);
  if (!pane || !seg || !box || !pane.children) return;
  const views = flowEmbedViews(tab), v = views.includes(FLOW_EMB[tab]) ? FLOW_EMB[tab] : '';
  FLOW_EMB[tab] = v;
  const label = k => (FLOW_BUCKETS.find(b => b[0] === k) || [, k])[1];
  const count = k => { try { if (!FLOW.ppc) return ''; const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly();
    return String(flowRows().filter(x => (!only || x.r.__t) && flowInView(k, x.s)).length); } catch (e) { return ''; } };
  seg.innerHTML = [['', cfg.own]].concat(views.map(k => [k, label(k)])).map(([k, l]) => { const c = k ? count(k) : '';
    return `<button type="button" data-flemb="${k}" class="${k === v ? '' : 'ghost'}" style="width:auto;padding:6px 16px;font-size:13.5px">${esc(l)}${c !== '' ? ` <b style="margin-left:4px">${c}</b>` : ''}</button>`; }).join('')
    + (views.length ? '<span class="navbadge" style="background:#7c3aed;position:static;margin-left:auto">TEST · Production flow</span>' : '');
  [...pane.children].forEach(ch => { if (ch !== seg && ch !== box && ch.classList) ch.classList.toggle('fl-embhide', !!v); });
  box.classList.toggle('hide', !v);
  if (!v) return;
  const msg = $('flEmbMsg_' + tab), tbl = $('flEmbT_' + tab);
  if (!FLOW.ppc) { msg.textContent = 'Reading the production flow…'; tbl.innerHTML = ''; try { await flowEnsureData(); } catch (e) { msg.textContent = 'Could not read the production flow.'; return; } return flowEmbedRender(tab); }
  const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly();
  const rows = flowRows().filter(x => (!only || x.r.__t) && flowInView(v, x.s))
    .sort((a, b) => String(a.r.orderDate || '').localeCompare(String(b.r.orderDate || '')) || String(a.r.orderNo).localeCompare(String(b.r.orderNo)));
  tbl.innerHTML = flowTable(v, rows.slice(0, 800));
  const b = FLOW_BUCKETS.find(x => x[0] === v) || [];
  msg.textContent = `${b[1]}: ${nf(rows.length)} line(s) — ${b[3]}${only ? ' · SHOWING TEST ORDERS ONLY (switch on the Production flow screen)' : ''} · TEST VIEW, not on the live app`;
}
/** Finished Goods → From QC — to accept. */
async function flowFgOpen() {
  if (!flowMay('fgi') && !flowMayFg()) return flowSay('Finished Goods is not open to this account.', true);
  showTab('fgi'); if ($('fgView')) $('fgView').value = 'flow';
  if (typeof ensureFgi === 'function') await ensureFgi(); else renderFgi();
}
