/* ================= PRODUCTION FLOW · THE SCREEN =================
 * The bucket buttons across the top (each with how many lines are in it; only the buckets this account may open), and
 * the chosen bucket's list: SKU by SKU, with what that bucket is waiting for and a button to the screen where the work
 * is entered. The lines move on by themselves when that entry is made. */
let FLOW_VIEW = '';
const FLOW_ANGLE = {};   // per Demand view: 'line' or 'stock'

async function ensureFlow() { try { await flowEnsureData(); } finally { renderFlow(); } }
/* WHAT IS STILL BEING READ (Ravi, 23 Oct: "data load hone me bahut jyada time lag raha h" — the screen sat on "Reading again…"
 * with nothing to say what it waited for, and a read that failed left it there for good, the screen never drawn). Each read
 * is named; the line under the toolbar says which are still coming and for how long; one that fails is said (FLOW.readErr)
 * and the screen is drawn with what did come. */
async function flowReads(parts) {
  const t0 = Date.now(), left = new Set(), errs = [];
  const say = () => { const el = typeof $ === 'function' && $('flMsg'); if (!el || !left.size) return;
    el.className = 'muted'; el.textContent = `Reading ${[...left].join(', ')}… ${Math.round((Date.now() - t0) / 1000)} s`; };
  const run = parts.filter(p => p && p[1]).map(([n, p]) => { left.add(n);
    return Promise.resolve(p).catch(e => { errs.push(`${n} (${(e && e.message) || e})`); }).then(() => { left.delete(n); say(); }); });
  say(); const tick = setInterval(say, 1000);
  try { await Promise.all(run); } finally { clearInterval(tick); }
  return errs;
}
/** Everything the lines are worked out from — also read by the Finished Goods screen's "From QC — to accept". */
async function flowEnsureData() {
  const errs = [];
  if (!PTG.mdb) errs.push(...await flowReads([['the order book and registers', ptLoadGates()]]));
  /* Printer Allocation too: PPC's printer is suggested from it. */
  /* The store too: the printed stock PPC sees beside the RFD balance (Store Stock Balance; its Job Work and cutting
   * registers are the ones the order book has already read). */
  /* QC checks and the Finished Goods ledger: the QC bucket and the hand-over read them. All at once now — they were read
   * one after the other before the rest (23 Oct); the QC checks the gates have just read are not read a second time. */
  if (typeof QC !== 'undefined' && QC.checks == null && PTG.qc && PTG.qc.length) QC.checks = PTG.qc;
  errs.push(...await flowReads([
    ['QC checks', typeof QC !== 'undefined' && QC.checks == null ? ptGet('pt_qcChecks').then(v => { QC.checks = ptList(v); }) : null],
    ['Finished Goods', typeof FGI !== 'undefined' && FGI.rows == null && typeof fgiLoad === 'function' ? fgiLoad() : null],
    ['plans and challans', flowLoad()], ['the fabric register', flowFabLoad()],
    ['store stock', typeof STORE !== 'undefined' && STORE.rows === null ? ensureStore() : null],
    ['printer allocation', PAL.printers === null ? palLoad() : null],
    ['vendor orders', typeof ensureVo === 'function' ? ensureVo() : null],
    ['accessories', typeof ensureAcc === 'function' ? ensureAcc() : null],
    /* the Custom SKUs list: a Shopify / B2B SKU that is only there has its BOM written there from PPC (flowMasterBox) */
    ['custom SKUs', typeof ptEnsureCustom === 'function' ? ptEnsureCustom() : null],
    /* The Greige Desk's RFD counts in Demand → RFD on the test link. */
    ['the Greige Desk', FLOW_ON && typeof GD !== 'undefined' && flowGdReads() ? GD.ensure() : null]]));
  FLOW.readErr = errs;
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
  const q = String($('flQ').value || '').trim().toLowerCase(), ff = flowFiltVals(), src = ff.src;
  /* THE LISTS FOLLOW THE BUCKET ON SCREEN (Ravi, 17 Oct: "open PPC window par hu to sirf open po hi dropdown me ho"): the
   * PO, article, colour… a dropdown offers are those of the lines in this bucket — a pick from another bucket left every
   * count at 0. The history and print-order lists are not line lists; they keep every line's. */
  const inBucket = ['pord', 'dhist'].includes(FLOW_VIEW) ? all : all.filter(x => FLOW_VIEW === 'new' ? x.recent : flowInView(FLOW_VIEW, x.s));
  flowFiltFill(inBucket, ff, q);
  const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly();
  if ($('flTestOnly')) $('flTestOnly').checked = only;
  /* With test orders off (flow-core.js) there is no test order to raise or narrow to: the button and the switch go. */
  const tests = flowTestsOn();
  if ($('flTest') && $('flTest').style) $('flTest').style.display = tests ? '' : 'none';
  const tLab = $('flTestOnly') && $('flTestOnly').parentNode;
  if (tLab && tLab.style) tLab.style.display = tests ? 'inline-flex' : 'none';
  const pass = x => (!only || x.r.__t) && (!src || flowSrcOf(x) === src) && flowFiltPass(x, ff)
    && (!q || [x.r.orderNo, x.r.sku, x.r.color, x.r.size, x.r.articleSubtype, x.r.articleType, x.r.shopOrderNo, flowFacet(x).fab, flowFacet(x).prn]
      .join(' ').toLowerCase().includes(q));
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
  FLOW.panel = ''; FLOW.stock = ''; FLOW.byprint = ''; FLOW.bysize = '';
  // The Accessories tab also lists what is reserved and not issued, so a reservation can be let go (flowTable, 'dacc').
  FLOW.held = FLOW_VIEW === 'dacc' ? shown.filter(x => x.s.res && !x.s.issued && x.s.bucket !== 'done') : [];
  $('flTable').innerHTML = flowTable(FLOW_VIEW, rows.slice(0, 800));
  /* PPC in Excel: on the PPC bucket only — the lines on screen are what the sheet holds. */
  FLOW.shownPpc = FLOW_VIEW === 'ppc' ? rows : [];
  FLOW.shownDrfd = FLOW_VIEW === 'drfd' ? rows : [];     // every line the filters let through, not only the 800 drawn
  ['flXlOut', 'flXlIn'].forEach(id => { const b = $(id); if (b && b.classList) b.classList.toggle('hide', FLOW_VIEW !== 'ppc'); });
  try { flowXlBtn(); } catch (e) { /* not drawn */ }
  try { flowRepBtn(); } catch (e) { /* not drawn */ }
  /* DEMAND HAS TWO ANGLES (Ravi, 10 Oct: "keep this section in a different angle"): the lines, or the stock by
   * fabric / accessory against them — one at a time, never stacked. */
  if (FLOW.stock) {
    if (FLOW_ANGLE[FLOW_VIEW] === 'printer') FLOW_ANGLE[FLOW_VIEW] = 'size';   // the metres pivot was taken out (18 Oct)
    const ang = FLOW_ANGLE[FLOW_VIEW] || 'line', what = FLOW_VIEW === 'drfd' ? 'By fabric (RFD stock)' : 'By accessory (shelf stock)';
    const angles = [['line', 'By line']].concat(FLOW_VIEW === 'drfd' ? [['size', 'Challan by size (pcs)'], ['print', 'By printed fabric (all orders)']] : []).concat([['stock', what]]);
    FLOW.panel = `<div class="seg" style="display:inline-flex;gap:4px">${angles.map(([k, l]) =>
      `<button data-flang="${k}" class="${ang === k ? '' : 'ghost'}" style="width:auto;padding:4px 12px;font-size:12.5px">${l}</button>`).join('')}</div>`;
    if (ang === 'stock') $('flTable').innerHTML = FLOW.stock;
    if (ang === 'print' && FLOW.byprint) $('flTable').innerHTML = FLOW.byprint;
    /* RFD BY LINE IN EXCEL (Ravi, 21 Oct: "need export button here") */
    if (ang === 'line' && FLOW_VIEW === 'drfd')
      FLOW.panel += ' <button type="button" class="ghost" data-flpivxl="line" style="width:auto;padding:4px 12px;font-size:12.5px;margin-left:6px">Download Excel</button>'
        + ' <button type="button" class="ghost" data-flchxl="1" style="width:auto;padding:4px 12px;font-size:12.5px" title="The Download Excel sheet with Make challan = yes on the lines to send">Challans from Excel</button>'
        + ` <button type="button" data-flchpick="1" style="width:auto;padding:4px 12px;font-size:12.5px"${FLOW_CHPICK.size ? '' : ' disabled'}>Challan for ticked (${nf(FLOW_CHPICK.size)})</button>`;
    if (ang === 'line' && FLOW_VIEW === 'drfd') {
      const cvT = flowRfdCover(), sOf = x => (cvT.line[x.s.key] || {}).short || 0, tile = (k, label, ls) => {
        const m = flowR2(ls.reduce((t, x) => t + ((cvT.line[x.s.key] || {}).need || 0), 0)), on = FLOW_DRFD_FILT === k;
        return `<button type="button" data-fldfilt="${k}" title="Show only these lines; press again for all" style="width:auto;padding:6px 14px;border-radius:14px;font:inherit;cursor:pointer;box-shadow:none;transform:none;text-align:left;line-height:1.25;`
          + (on ? 'background:#b45309;color:#fff;border:1px solid #b45309' : 'background:#fdf0e8;color:#17202b;border:1px solid #f0cdb5') + `"><b>${label} (${nf(ls.length)})</b><div style="font-size:10.5px;opacity:.85">${nf(new Set(ls.map(x => x.r.orderNo)).size)} orders · ${nf(m)} m</div></button>`; };
      FLOW.panel = `<div style="display:flex;gap:8px;flex-basis:100%;margin-bottom:8px">${tile('covered', 'Cloth in stock', rows.filter(x => !(sOf(x) > 0)))}${tile('short', 'Short of cloth', rows.filter(x => sOf(x) > 0))}</div>` + FLOW.panel;
    }
    if (ang === 'size' && FLOW.bysize) { $('flTable').innerHTML = FLOW.bysize;
      FLOW.panel += ' <button type="button" class="ghost" data-flpivxl="size" style="width:auto;padding:4px 12px;font-size:12.5px;margin-left:6px">Download Excel</button>'; }
  }
  /* DEMAND, ONE TAB (Ravi, 12 Oct): its parts as tabs, like Listing Health's — RFD out to printers, printed fabric in, accessories. */
  if (FLOW_DEMAND.includes(FLOW_VIEW)) FLOW.panel = `<div class="seg" style="display:inline-flex;gap:4px;flex-wrap:wrap;margin-right:14px">${dem.map(([k, l]) =>
    `<button data-fldem="${k}" class="${k === FLOW_VIEW ? '' : 'ghost'}" style="width:auto;padding:5px 14px;font-size:13px">${esc(l)} <b>${nf(n[k] || 0)}</b></button>`).join('')}</div>` + (FLOW.panel || '')
    + (FLOW_VIEW === 'dhist' ? `<div class="seg" style="display:inline-flex;gap:4px">${[['due', 'Orders with printers · receive'], ['challan', 'By challan'], ['day', 'Received by date']].map(([k, l]) =>
      `<button data-flang="${k}" class="${(FLOW_ANGLE.dhist || 'due') === k ? '' : 'ghost'}" style="width:auto;padding:4px 12px;font-size:12.5px">${l}</button>`).join('')}</div>`
      + (FLOW_ANGLE.dhist === 'day' ? flowRecvDayBar(q, only) : '')
      + ((FLOW_ANGLE.dhist || 'due') === 'due' ? flowDueBar(only) + ' <button type="button" class="ghost" data-fldxl="1" style="width:auto;padding:4px 12px;font-size:12.5px;margin-left:6px">Download Excel</button>' : flowStandingHtml()) : '');
  /* RFD short? The Greige Desk shows the greige to order for it (Ravi, 13 Oct: Greige Desk joined to the PPC flow). */
  if (FLOW_VIEW === 'drfd' && typeof GD !== 'undefined' && gdAllowed()) FLOW.panel = (FLOW.panel || '') + '<button type="button" class="ghost" data-gdgo="inv" style="width:auto;padding:5px 14px;font-size:13px;margin-left:10px">Greige Desk · PPC demand</button>';
  /* RFD stock is the Greige Desk's count: not read here, the Demand figures say so instead of showing a false "short". */
  if (FLOW_DEMAND.includes(FLOW_VIEW) && !flowRfdKnown()) FLOW.panel = (FLOW.panel || '') + `<span style="font-size:12.5px;color:#b45309;margin-left:10px">⚠ The Greige Desk's RFD stock could not be read on this computer — the RFD figures here are not complete. Press Refresh.</span>`;
  $('flPanel').innerHTML = FLOW.panel; $('flPanel').classList.toggle('hide', !FLOW.panel);
  $('flMsg').className = FLOW.err || (FLOW.readErr || []).length || PTG.err ? 'err' : 'muted';
  /* ONLY WHAT NEEDS SAYING (Ravi, 15 Oct: "remove the extra lines"). The count is on the bucket button and what the bucket
   * means is its tooltip, so the line under the toolbar is kept for what is NOT on screen: a failed read, a list cut at
   * 800, a narrowed list (test orders only, filters, a search). Nothing to say → nothing shown. The phase is in the
   * Refresh button's tooltip. */
  try { flowVoProgSync(); } catch (e) { /* the printers' orders wait for the next draw */ }
  const nFilt = flowFiltCount(ff);
  if ($('flRefresh')) $('flRefresh').title = flowPhaseTxt();
  if ($('flMsg').style) { $('flMsg').style.whiteSpace = 'pre-line'; $('flMsg').style.lineHeight = '1.6'; }
  $('flMsg').textContent = [FLOW.err ? 'Could not read the plans: ' + FLOW.err : '',
    (FLOW.readErr || []).length ? 'Could not read ' + FLOW.readErr.join(', ') + ' — press Refresh' : '',
    PTG.err ? 'Could not read the order book: ' + PTG.err : '',
    rows.length > 800 ? `${nf(rows.length)} line(s) — showing the oldest 800` : '',
    (FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly()) ? 'Showing test orders only' : '',
    (nFilt || q) && shown.length < all.length ? `Showing ${nf(shown.length)} of ${nf(all.length)} line(s) — ${[q ? `search “${q}”` : '', nFilt ? nFilt + ' filter(s)' : ''].filter(Boolean).join(' + ')}` : '']
    .filter(Boolean).join('\n');
}

/* ---- SEARCH AND FILTERS (Ravi, 15 Oct: "add a search bar and filter all action") ----
 * One search box, and a Filters button holding one dropdown per thing a line can be narrowed by: platform, article,
 * subtype, colour, size, fabric, printer and how old the order is. They apply to every bucket alike. Fabric and printer
 * are the plan's where there is one, else what PPC would suggest — worked out only when the search, those filters or the
 * Filters panel ask for them, and kept until the lines change. */
/* PO too (Ravi, 16 Oct: "filter me PO add karo"): the order numbers the lines on screen carry. */
const FLOW_FILT = [['src', 'flSrc', 'Every platform'], ['po', 'flFPo', 'Every PO'], ['art', 'flFArt', 'Every article'], ['sub', 'flFSub', 'Every subtype'],
  ['col', 'flFCol', 'Every colour'], ['size', 'flFSize', 'Every size'], ['fab', 'flFFab', 'Every fabric'], ['prn', 'flFPrn', 'Every printer']];
/* The platform: the order number's own prefix where the line only says it came in on a sales order ("SO", 16 Oct). */
const flowSrcOf = x => { const s = String(x.r.src || '').trim(), pre = String(x.r.orderNo || '').split('-')[0];
  return s && s.toUpperCase() !== 'SO' ? s : (pre || s); };
const flowFiltVals = () => { const v = {}; FLOW_FILT.forEach(([k, id]) => { v[k] = $(id) ? String($(id).value || '') : ''; });
  v.age = $('flFAge') ? String($('flFAge').value || '') : ''; return v; };
const flowFiltCount = f => Object.values(f).filter(Boolean).length;
const flowFiltOpen = () => !!($('flFilt') && $('flFilt').open);
function flowFacet(x) {
  if (!FLOW.fc || FLOW.fc.src !== FLOW_C.rows) FLOW.fc = { src: FLOW_C.rows, m: new Map() };
  let f = FLOW.fc.m.get(x.s.key);
  if (!f) {
    const p = x.s.plan;
    let fab = p && p.fabric ? p.fabric.name : '', prn = p && p.printer ? p.printer.name : '';
    if (!p) { try { const sg = flowSuggest(x.r); fab = sg.fabric.name; prn = sg.print.need ? sg.printer.name : ''; } catch (e) { /* left blank */ } }
    f = { fab: String(fab || (cutSkuOf(x.r.sku) || {}).fabric || '').trim(), prn: String(prn || '').trim() };
    FLOW.fc.m.set(x.s.key, f);
  }
  return f;
}
const flowFiltPass = (x, f) => (!f.po || x.r.orderNo === f.po) && (!f.art || x.r.articleType === f.art) && (!f.sub || x.r.articleSubtype === f.sub)
  && (!f.col || x.r.color === f.col) && (!f.size || x.r.size === f.size)
  && (!f.age || (flowDays(x.r.orderDate) || 0) > +f.age)
  && (!f.fab || flowFacet(x).fab === f.fab) && (!f.prn || flowFacet(x).prn === f.prn);
/** The dropdowns hold what the lines actually carry. Fabric and printer are listed once the panel is open. */
/* EACH LIST FOLLOWS THE OTHER PICKS AND THE SEARCH (Ravi, 22 Oct: "jese humne SHP par filter lagaya to SHP me jitne article h sirf
 * bahi dikhne chahiye all nahi"): a dropdown offers what the lines left by the search and every OTHER filter carry — never
 * its own pick, so it can still be changed. */
function flowFiltFill(all, f, q) {
  const vals = list => [...new Set(list)].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const facets = flowFiltOpen() || f.fab || f.prn;
  const by = { src: flowSrcOf, po: x => x.r.orderNo, art: x => x.r.articleType, sub: x => x.r.articleSubtype, col: x => x.r.color, size: x => x.r.size,
    fab: x => (facets ? flowFacet(x).fab : ''), prn: x => (facets ? flowFacet(x).prn : '') };
  const qOk = x => !q || [x.r.orderNo, x.r.sku, x.r.color, x.r.size, x.r.articleSubtype, x.r.articleType, x.r.shopOrderNo, flowFacet(x).fab, flowFacet(x).prn].join(' ').toLowerCase().includes(q);
  const live = q ? all.filter(qOk) : all;
  FLOW_FILT.forEach(([k, id, all0]) => { if (!$(id)) return;
    const g = Object.assign({}, f, { [k]: '' });
    const lines = live.filter(x => (!g.src || flowSrcOf(x) === g.src) && flowFiltPass(x, g));
    const list = vals(lines.map(by[k])); if (f[k] && !list.includes(f[k])) list.push(f[k]);
    ptFillSelect(id, list.map(v => [v, v + ' (' + nf(lines.filter(x => by[k](x) === v).length) + ')']), all0); });
  const n = flowFiltCount(f);
  if ($('flFiltN')) $('flFiltN').textContent = n ? String(n) : '';
}

/* BY PRINTER × SIZE, IN PIECES (Ravi, 18 Oct: "pivot mujhe size wise chahiye like 60x60 me kitne pcs chahiye"). The same
 * lines, as pieces still to make: printer down the side with its articles under it (one size can be a pillow cover and a
 * napkin), every size across, totals both ways. Sizes are read as written on the line; 60X60 and 60x60 are one. */
const flowSizeKey = v => String(v || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[×*]/g, 'x');
const flowSizeSort = (a, b) => { const n = s => (String(s).match(/\d+(\.\d+)?/g) || []).map(Number); const x = n(a), y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return String(a).localeCompare(String(b)); };
/* DEMAND IN CHALLAN FORM, BY SIZE — AND THE CHALLAN MADE FIFO (Ravi, 18 Oct: "ye mujhe challan ke format me dikhe … 1 order me
 * alag alag color me 1 size me (60x60) 20 pcs ka order h then mujhe dikhe total 60x60 ke 20 pcs and jab challan banau to auto
 * FIFO method se order demand complete ho jay, same for Shopify"). RFD is plain cloth — the printer gives it its colour — so
 * every colour of one fabric and size is one line: the pieces still owed and their metres, and the orders they are for,
 * oldest first (Amazon and Shopify alike). "Make challan" asks how many pieces of each size go now, fills the oldest orders
 * first, and opens the ordinary challan form with those lines and figures in it: the challan is saved the one way it always
 * is. Lines on the Cutting route (no printer) and lines with no printer chosen are listed apart, with no challan button. */
let FLOW_SIZE_PIVOT = null;
const flowFifoSort = (a, b) => String(a.x.r.orderDate || '').localeCompare(String(b.x.r.orderDate || '')) || String(a.x.r.orderNo).localeCompare(String(b.x.r.orderNo)) || String(a.x.s.key).localeCompare(String(b.x.s.key));
/** What one line still owes, in pieces and metres, and metres per piece. */
function flowSizeOwed(x) {
  const p = x.s.plan || {}, o = flowFabOwed(x.r, x.s);
  if (x.s.fabUnit === 'pcs') { const pcs = Math.max(0, Math.round(o.left)); return { pcs, metres: o.metres, mpp: pcs ? o.metres / pcs : 0 }; }
  const per = +(p.fabric && p.fabric.perPc) || ((+x.r.qty || 0) ? (+(p.fabric && p.fabric.metres) || 0) / (+x.r.qty || 1) : 0);
  return { pcs: per ? Math.round(o.metres / per) : 0, metres: o.metres, mpp: per };
}
function flowBySizeData(rows) {
  const P = new Map();
  rows.forEach(x => {
    const p = x.s.plan || {}, w = flowSizeOwed(x);
    if (!(w.pcs > 0) && !(w.metres > 0.01)) return;
    const m = (typeof cutSkuOf === 'function' && cutSkuOf(x.r.sku)) || {};
    const size = String(x.r.size || m.size || '').trim() || '(no size)', sk = flowSizeKey(size);
    const fab = String((p.fabric && p.fabric.name) || '').trim() || '(no fabric)';
    const pc = x.s.route === 'stitch' ? '~cut' : (flowPlanPrinter(x.s) || '?');
    const pname = pc === '~cut' ? 'Cutting department (no printing)' : pc === '?' ? 'Printer not chosen' : ((p.printer && p.printer.name) || pc);
    const pr = P.get(pc) || { pk: pc, name: pname, pcs: 0, metres: 0, groups: new Map(), orders: new Set() };
    const gk = fabKey(fab) + '|' + sk, g = pr.groups.get(gk) || { gk, fab, size, pcs: 0, metres: 0, lines: [] };
    g.pcs += w.pcs; g.metres += w.metres; g.lines.push({ x, w }); pr.groups.set(gk, g);
    pr.pcs += w.pcs; pr.metres += w.metres; pr.orders.add(x.r.orderNo); P.set(pc, pr);
  });
  const order = pk => (pk === '~cut' ? 2 : pk === '?' ? 1 : 0);
  const PL = [...P.values()].sort((a, b) => order(a.pk) - order(b.pk) || b.pcs - a.pcs);
  PL.forEach(pr => { pr.list = [...pr.groups.values()].sort((a, b) => a.fab.localeCompare(b.fab) || flowSizeSort(a.size, b.size)); pr.list.forEach(g => g.lines.sort(flowFifoSort)); });
  return { P: PL, total: PL.reduce((t, pr) => t + pr.pcs, 0) };
}
const flowOrdersTxt = (lines, n) => { const by = new Map(); lines.forEach(({ x, w }) => by.set(x.r.orderNo, (by.get(x.r.orderNo) || 0) + w.pcs));
  const arr = [...by.entries()]; return arr.slice(0, n || 3).map(([o, q]) => `${esc(o)} · ${nf(q)}`).join(', ') + (arr.length > (n || 3) ? ` <span class="muted">+${nf(arr.length - (n || 3))} more</span>` : ''); };
function flowBySizeTable(rows) {
  const d = FLOW_SIZE_PIVOT = flowBySizeData(rows);
  if (!d.P.length) return '<tbody><tr><td class="muted" style="padding:16px">No line is waiting for RFD.</td></tr></tbody>';
  return '<tbody>' + d.P.map(pr => {
    const can = pr.pk !== '~cut' && pr.pk !== '?';
    return `<tr style="background:var(--soft,#f4f6fb)"><td colspan="5" style="text-align:left;padding:9px 10px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b style="font-size:14px">${esc(pr.name)}</b><span class="muted" style="font-size:12px">${nf(pr.orders.size)} order(s) · ${nf(pr.pcs)} pcs · ${nf(flowR2(pr.metres))} m</span><span style="flex:1"></span>
        ${can ? `<button type="button" data-flszch="${esc(pr.pk)}" style="width:auto;padding:4px 14px;font-size:12.5px">Make challan</button>`
          : `<span class="muted" style="font-size:11.5px">${pr.pk === '~cut' ? 'RFD goes to the cutting department — "Mark fabric ready" on By line' : 'Pick the printer in the plan first'}</span>`}</div></td></tr>`
      + `<tr><th style="text-align:left">Fabric (RFD)</th><th style="text-align:left">Size</th><th>Pcs</th><th>Metres</th><th style="text-align:left">Orders (oldest first)</th></tr>`
      + pr.list.map(g => `<tr><td style="text-align:left">${esc(g.fab)}</td><td style="text-align:left"><b>${esc(g.size)}</b></td><td class="num"><b>${nf(g.pcs)}</b></td><td class="num">${nf(flowR2(g.metres))}</td><td style="text-align:left;font-size:12px">${flowOrdersTxt(g.lines)}</td></tr>`).join('');
  }).join('') + `<tr style="font-weight:700"><td colspan="2" style="text-align:left">Total</td><td class="num">${nf(d.total)}</td><td></td><td></td></tr></tbody>`;
}
function flowBySizeXl() {
  const d = FLOW_SIZE_PIVOT; if (!d || !d.P.length) return;
  const out = [['Printer', 'Fabric (RFD)', 'Size', 'Pcs', 'Metres', 'Order', 'Order date', 'SKU', 'Colour', 'Pcs for this order']];
  d.P.forEach(pr => pr.list.forEach(g => g.lines.forEach(({ x, w }, k) => out.push([pr.name, g.fab, g.size, k ? '' : g.pcs, k ? '' : flowR2(g.metres), x.r.orderNo, ptIsoDate(x.r.orderDate) || '', obUC(x.r.sku), x.r.color || '', w.pcs]))));
  const bytes = recipeXlsx(out, { name: 'RFD by size', freeze: 2, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'rfd-challan-by-size-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
/** Demand · RFD fabric, By line, as a sheet: the lines on screen (search and filters applied), one row each, with what the
 * table shows — printer, what is printed, fabric and metres to send, covered / short, stock — and the papers raised. */
function flowDrfdLineRows(rows) {
  const cv = flowRfdCover(), today = dToday();
  const days = iso => { const a = Date.parse(String(iso || '').slice(0, 10)), b = Date.parse(today); return isNaN(a) || isNaN(b) ? '' : Math.max(0, Math.round((b - a) / 864e5)); };
  const what = w => w.kind === 'sku' ? [w.code, w.label] : w.sides ? [w.sides.map(x => x.side + ' ' + x.code).join(' + '), w.label + ' (half the cloth each)']
    : w.needDir ? ['', 'pick the print direction · ' + w.label] : [w.code || '', w.code ? w.label : 'no fabric SKU in the catalogue · ' + w.label];
  const out = [['PO', 'Order date', 'Days old', 'SKU', 'Item', 'Colour', 'Size', 'Qty', 'Route', 'Printer', 'Print on', 'What is printed',
    'Fabric', 'To send (m)', 'Ruffle fabric', 'Ruffle (m)', 'Ruffle printer', 'RFD', 'Short (m)', 'In stock (m)', 'Print order', 'Vendor order', 'RFD challan'].concat(FLOW_CHXL_COLS)];
  rows.forEach(x => {
    const p = x.s.plan || {}, c = cv.line[x.s.key] || { need: 0, avail: 0, short: 0 }, stitch = x.s.route === 'stitch';
    const [on, lab] = stitch ? ['', 'No printing — straight to cutting'] : what(flowPrintWhat(x.r, p)), ro = flowRuffleOwed(x);
    const docs = flowDocsOf(x), kind = re => docs.filter(d => re.test(d.kind)).map(d => d.no + (d.closed ? ' (closed)' : '')).join(', ');
    const route = (FLOW_ROUTES.find(r => r[0] === flowRouteOf(p)) || [, , flowRouteOf(p)])[2] || '';
    out.push([x.r.orderNo, ptIsoDate(x.r.orderDate) || '', days(ptIsoDate(x.r.orderDate)), x.r.sku, x.r.articleSubtype || x.r.articleType || '', x.r.color || '', x.r.size || '',
      +x.r.qty || 0, route, stitch ? '' : ((p.printer && p.printer.name) || ''), on, lab, (p.fabric && p.fabric.name) || '', p.fabric ? c.need : '',
      ro ? ro.fabric : '', ro ? ro.metres : '', ro ? ro.printer.name : '', c.short ? 'Short' : 'Covered', c.short || '', c.avail,
      kind(/^Print order/), kind(/^Vendor order/), kind(/challan/i)].concat(stitch ? ['', '', 'no — cutting, no printer', x.s.key]
      : [x.s.fabUnit === 'pcs' ? flowFabOwed(x.r, x.s).left : '', flowFabOwed(x.r, x.s).metres, '', x.s.key]));
  });
  return out;
}
/* ================= MANY ORDERS, ONE CHALLAN — by ticks, or from Excel =================
 * Ravi, 21 Oct: "yaha me bulk me challan bhi bana saku excel se and multiple order ko 1 hi challan me bhej saku".
 * Tick lines of any orders (or mark them "yes" in the Download Excel sheet, with the pieces / metres to send now): they go
 * on ONE challan per printer — each the printer PPC planned for the line — however many orders they come from. The forms
 * open one after another, filled in; nothing is saved until each is saved, with every check the single challan has. */
const FLOW_CHPICK = new Set();
/** RFD out to printers, By line: '' every line, 'covered' the cloth is in stock, 'short' it is not (the two tiles above the list). */
let FLOW_DRFD_FILT = '';
const FLOW_CHXL_COLS = ['Send now (pcs)', 'Send now (m)', 'Make challan (yes/no)', 'Line ID'];
/** The ticked / imported lines, as challan forms: one per planned printer, lines oldest order first. */
function flowChGroups(keys, pre) {
  const want = new Set(keys), out = new Map(), skipped = [];
  flowRows().filter(x => want.has(x.s.key)).forEach(x => {
    if (!flowInView('drfd', x.s)) { skipped.push(`${x.r.orderNo} ${obUC(x.r.sku)}: its fabric is not waiting any more`); return; }
    if (x.s.route === 'stitch') { skipped.push(`${x.r.orderNo} ${obUC(x.r.sku)}: Cutting route — no printer, use Mark fabric ready`); return; }
    const to = pre && pre.get && (pre.get(x.s.key) || {}).to;
    const pc = (to && String(to.code)) || flowPlanPrinter(x.s) || '?', g = out.get(pc) || { pcode: pc, rows: [] }; g.rows.push(x); out.set(pc, g);
  });
  const groups = [...out.values()].map(g => Object.assign(g, { pre: pre || null,
    rows: g.rows.sort((a, b) => String(a.r.orderDate || '').localeCompare(String(b.r.orderDate || '')) || String(a.r.orderNo).localeCompare(String(b.r.orderNo))) }));
  return { groups, skipped };
}
/** Open the challan forms one after another. */
function flowChQueue(groups, done) {
  const list = groups.slice(), total = list.length;
  const next = () => { const g = list.shift(); if (!g) { if (done) done(); return; }
    flowChallanDialog(g.rows, g.pcode, [], g.pre, next);
    if ($('flMsg')) { $('flMsg').className = 'muted'; $('flMsg').textContent = `Challan ${total - list.length} of ${total}${list.length ? ' — the next opens when this one is saved' : ''}.`; } };
  next();
}
function flowChPickOpen() {
  if (!FLOW_CHPICK.size) return;
  const { groups, skipped } = flowChGroups([...FLOW_CHPICK]);
  if (skipped.length) { $('flMsg').className = 'err'; $('flMsg').textContent = 'Left out: ' + skipped.join(' · '); }
  if (!groups.length) return;
  flowChQueue(groups, () => { FLOW_CHPICK.clear(); renderFlow(); });
}
/** The sheet back: the rows marked yes → { keys, pre: Map(key → {pcs, metres}), errs, skipped }. */
function flowChXlRead(sheet) {
  if (!sheet || sheet.length < 2) return { err: 'That file has no rows.' };
  const H = sheet[0].map(h => String(h == null ? '' : h).replace(/^\uFEFF/, '').trim().toLowerCase()), at = n => H.indexOf(n.toLowerCase());
  const iK = at('Line ID'), iY = at('Make challan (yes/no)');
  if (iK < 0 || iY < 0) return { err: 'The file needs the "Line ID" and "Make challan (yes/no)" columns — press Download Excel here and fill that sheet.' };
  const byKey = new Map(flowRows().filter(x => flowInView('drfd', x.s)).map(x => [x.s.key, x]));
  const keys = [], pre = new Map(), errs = [], skipped = [];
  for (let i = 1; i < sheet.length; i++) {
    const row = sheet[i] || [], c = n => { const j = at(n); return j >= 0 && row[j] != null ? String(row[j]).trim() : ''; };
    if (!/^(y|yes|1|true)$/i.test(c('Make challan (yes/no)'))) continue;
    const key = c('Line ID'), tag = `row ${i + 1} (${c('PO')} ${c('SKU')})`, x = byKey.get(key);
    if (!x) { skipped.push(tag + ': not waiting for fabric any more — sent already, or the plan changed'); continue; }
    if (x.s.route === 'stitch') { skipped.push(tag + ': Cutting route — no printer'); continue; }
    const o = flowFabOwed(x.r, x.s), pcsWise = x.s.fabUnit === 'pcs';
    const pcsT = c('Send now (pcs)'), mT = c('Send now (m)');
    let pcs = pcsWise ? (pcsT === '' ? o.left : Number(pcsT)) : 0, m = mT === '' ? null : Number(mT);
    if (pcsWise && !(pcs >= 1 && pcs === Math.round(pcs) && pcs <= o.left)) { errs.push(`${tag}: pieces are whole, at least 1 and at most the ${nf(o.left)} still owed`); continue; }
    if (m == null) m = pcsWise ? (o.left ? flowR2(o.metres * pcs / o.left) : 0) : o.metres;
    if (!(m > 0)) { errs.push(`${tag}: how many metres? "Send now (m)" is not a number above 0`); continue; }
    /* THE PRINTER THE SHEET NAMES (Ravi, 22 Oct: "mene tamplate me bhavya ko sirf 3 order place kiye but in real or bhi order gye h
     * vendor ko" — 11 lines he gave to other printers in the sheet went to Bhavya, the printer of their plan; "dono ka jaha se bhi
     * assign karu bahi se sahi ho"). A Printer typed in the sheet that is not the plan's is a change of printer: the plan, the print
     * order and the Vendor Order move to it (flowChangePrinterSave) before the challan forms open. */
    const pName = c('Printer'), cur = (x.s.plan && x.s.plan.printer) || {}, nk = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let to = null;
    if (pName && nk(pName) !== nk(cur.name) && nk(pName) !== nk(cur.code)) {
      const v = flowChVendors().find(y => [y.desc, y.name, y.code].some(t => t && nk(t) === nk(pName)));
      if (!v) { errs.push(`${tag}: no vendor is called "${pName}" — type the printer as the vendor list has it`); continue; }
      if (String(v.code) !== String(cur.code || '')) to = { code: String(v.code), name: v.desc || v.name || String(v.code), from: cur.name || cur.code || '' };
    }
    keys.push(x.s.key); pre.set(x.s.key, Object.assign({ pcs: pcsWise ? pcs : +x.r.qty || 0, metres: flowR2(m), orderNo: x.r.orderNo, sku: obUC(x.r.sku), of: +x.r.qty || 0 }, to ? { to } : {}));
  }
  return { keys, pre, errs, skipped };
}
async function flowChXlIn(file) {
  if (!file) return;
  let sheet; try { sheet = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text()); }
  catch (e) { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not read the file: ' + (e.message || e); return; }
  const rd = flowChXlRead(sheet);
  if (rd.err) { $('flMsg').className = 'err'; $('flMsg').textContent = rd.err; return; }
  const { groups, skipped } = flowChGroups(rd.keys, rd.pre);
  const list = (a, n) => a.length ? `<div style="margin-top:6px"><b>${nf(a.length)}</b> ${n}:<div class="muted" style="font-size:12px">${a.slice(0, 12).map(esc).join('<br>')}${a.length > 12 ? '<br>…' : ''}</div></div>` : '';
  const pname = g => g.pcode === '?' ? 'printer not chosen' : (((rd.pre.get(g.rows[0].s.key) || {}).to || {}).name || (g.rows[0].s.plan.printer || {}).name || g.pcode);
  const moves = rd.keys.map(k => [k, rd.pre.get(k)]).filter(([, p]) => p && p.to);
  ptOpenDialog({
    title: 'Challans from Excel',
    subtitle: `${file.name} · ${nf(rd.keys.length)} line(s) marked yes`,
    note: 'Nothing is saved from the sheet by itself: one challan form opens per printer, filled in from the sheet — check it and press Make the challan; the next opens after it.',
    html: '<div style="font-size:12.5px;line-height:1.6">'
      + (groups.length ? `<div><b>${nf(groups.length)}</b> challan(s):</div>` + groups.map(g => `<div>· ${esc(pname(g))} — ${nf(g.rows.length)} line(s) of ${nf(new Set(g.rows.map(x => x.r.orderNo)).size)} order(s)</div>`).join('') : '<div>No line to send.</div>')
      + (moves.length ? `<div style="margin-top:6px;color:#b45309"><b>${nf(moves.length)}</b> line(s) get the printer the sheet names — their plan, print order and Vendor Order move to it:<div style="font-size:12px">${moves.slice(0, 15).map(([, p]) => `${esc(p.orderNo)} ${esc(p.sku)}: ${esc(p.to.from || '—')} → <b>${esc(p.to.name)}</b>`).join('<br>')}${moves.length > 15 ? '<br>…' : ''}</div></div>` : '')
      + list(rd.errs, 'row(s) with a mistake — fix them in the sheet and import again') + list(rd.skipped.concat(skipped), 'row(s) left alone') + '</div>',
    saveLabel: groups.length ? `Open ${nf(groups.length)} challan form(s)` : 'Close',
    onSave: async () => {
      if (!groups.length) return '';
      for (const [k, p] of moves) {
        const er = await flowChangePrinterSave(k, p.to.code, 'printer given in the Challans from Excel sheet');
        if (er) return `${p.orderNo} ${p.sku}: ${er}`;
      }
      const again = moves.length ? flowChGroups(rd.keys, rd.pre).groups : groups;
      if (moves.length) renderFlow();
      setTimeout(() => flowChQueue(again), 0); return ''; },
  });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('change', e => { const t = e.target; if (!t || !t.dataset || !t.dataset.flchk) return;
    if (t.checked) FLOW_CHPICK.add(t.dataset.flchk); else FLOW_CHPICK.delete(t.dataset.flchk);
    const b = document.querySelector && document.querySelector('[data-flchpick]');
    if (b) { b.textContent = `Challan for ticked (${nf(FLOW_CHPICK.size)})`; b.disabled = !FLOW_CHPICK.size; } });
  document.addEventListener('click', e => { const t = e.target; if (!t || !t.closest) return;
    if (t.closest('[data-flchpick]')) { e.preventDefault(); flowChPickOpen(); return; }
    const fd = t.closest('[data-fldfilt]'); if (fd) { e.preventDefault(); FLOW_DRFD_FILT = FLOW_DRFD_FILT === fd.dataset.fldfilt ? '' : fd.dataset.fldfilt; renderFlow(); return; }
    const pa = t.closest('[data-flpickall]'); if (pa) { e.preventDefault(); const ks = String(pa.dataset.flpickall).split(','), all = ks.every(k => FLOW_CHPICK.has(k)); ks.forEach(k => { if (all) FLOW_CHPICK.delete(k); else FLOW_CHPICK.add(k); }); renderFlow(); return; }
    if (t.closest('[data-flchxl]')) { e.preventDefault();
      const f = document.createElement('input'); f.type = 'file'; f.accept = '.xlsx,.csv'; f.onchange = () => flowChXlIn(f.files && f.files[0]); f.click(); } });
}
function flowDrfdLineXl(rows) {
  if (!rows.length) { $('flMsg').className = 'err'; $('flMsg').textContent = 'No line to put in the sheet.'; return; }
  const bytes = recipeXlsx(flowDrfdLineRows(rows), { name: 'RFD by line', freeze: 2, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'rfd-demand-by-line-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
/** FIFO: pieces to send per size group → { key: {pcs, metres} }, oldest orders filled first. */
function flowSizeFifo(groups, send) {
  const pre = new Map();
  groups.forEach(g => {
    let n = Math.max(0, Math.round(+send[g.gk] || 0));
    g.lines.forEach(({ x, w }) => { if (n <= 0 || !(w.pcs > 0)) return; const take = Math.min(n, w.pcs); n -= take;
      pre.set(x.s.key, { pcs: take, metres: take === w.pcs ? flowR2(w.metres) : flowR2(take * w.mpp), orderNo: x.r.orderNo, of: w.pcs }); });
  });
  return pre;
}
function flowSizeChallanOpen(pcode) {
  /* worked out again now, from the lines as they are — never from a table drawn minutes ago */
  const d = flowBySizeData(flowRows().filter(x => flowInView('drfd', x.s))), pr = d.P.find(p => p.pk === pcode); if (!pr) return;
  const groups = pr.list.filter(g => g.pcs > 0), send = {};
  groups.forEach(g => { send[g.gk] = g.pcs; });
  const preview = () => { const pre = flowSizeFifo(groups, send);
    return groups.map(g => { const ls = g.lines.filter(({ x }) => pre.has(x.s.key)); if (!ls.length) return '';
      return `<div style="margin-top:6px"><b>${esc(g.fab)} · ${esc(g.size)}</b>: ` + ls.map(({ x, w }) => { const t = pre.get(x.s.key);
        return `${esc(x.r.orderNo)} <span class="muted">(${esc(ptIsoDate(x.r.orderDate) || '')}${x.r.color ? ' · ' + esc(x.r.color) : ''})</span> ${nf(t.pcs)}${t.pcs < w.pcs ? ` <span style="color:#b45309">of ${nf(w.pcs)}</span>` : ' <span style="color:#166534">✓</span>'}`; }).join(' · ') + '</div>'; }).join('') || '<span class="muted">Nothing to send.</span>'; };
  ptOpenDialog({
    title: `Challan by size → ${pr.name}`,
    subtitle: 'How many pieces of each size go now. The oldest orders are filled first (Amazon and Shopify alike); what is not sent stays in Demand.',
    html: `<table class="xl" style="width:100%"><thead><tr><th style="text-align:left">Fabric (RFD)</th><th style="text-align:left">Size</th><th>Needed</th><th>Send now (pcs)</th><th>Metres</th></tr></thead><tbody>`
      + groups.map(g => `<tr><td style="text-align:left">${esc(g.fab)}</td><td style="text-align:left"><b>${esc(g.size)}</b></td><td class="num">${nf(g.pcs)}</td>`
        + `<td class="num"><input data-szq="${esc(g.gk)}" type="number" min="0" step="1" max="${g.pcs}" value="${g.pcs}" style="width:90px;padding:3px 6px;font-size:12px"></td><td class="num" data-szm="${esc(g.gk)}">${nf(flowR2(g.metres))}</td></tr>`).join('')
      + `</tbody></table><div style="margin-top:10px;font-size:12.5px"><b>These pieces go to (oldest first):</b><div id="flSzPrev">${preview()}</div></div>`,
    saveLabel: 'Review challan →',
    onSave: async () => {
      const bad = groups.filter(g => !(send[g.gk] >= 0 && send[g.gk] <= g.pcs && send[g.gk] === Math.round(send[g.gk])));
      if (bad.length) return bad.map(g => `${g.fab} ${g.size}: whole pieces, at most ${nf(g.pcs)}`).join(' · ');
      const pre = flowSizeFifo(groups, send);
      if (!pre.size) return 'Type how many pieces go now.';
      const rows = groups.flatMap(g => g.lines.map(l => l.x)).filter(x => pre.has(x.s.key));
      setTimeout(() => flowChallanDialog(rows, pcode, [], pre), 0);
      return '';
    },
  });
  document.querySelectorAll('[data-szq]').forEach(inp => inp.addEventListener('input', () => {
    const g = groups.find(y => y.gk === inp.dataset.szq); send[g.gk] = Math.max(0, Math.min(g.pcs, Math.round(+inp.value || 0)));
    const pre = flowSizeFifo([g], send), m = [...pre.values()].reduce((t, v) => t + v.metres, 0);
    const mc = document.querySelector(`[data-szm="${g.gk}"]`); if (mc) mc.textContent = nf(flowR2(m));
    const pv = $('flSzPrev'); if (pv) pv.innerHTML = preview(); }));
}
/* BY PRINTED FABRIC: every line waiting for fabric, across every order, grouped by what the printer prints and the
 * printer PPC planned — the total to print, the orders it is for, and one challan for all of it. */
let FLOW_GROUPS = [];
function flowByPrintTable(rows) {
  const g = new Map();
  rows.filter(x => x.s.route !== 'stitch').forEach(x => {
    const p = x.s.plan || {}, w = flowPrintWhat(x.r, p), tp = flowToPrint(x.r, p), pc = flowPlanPrinter(x.s);
    /* ONLY WHAT IS STILL OWED (Ravi, 19 Oct: the row said 447 pcs, the challan 47 — 400 were already issued to karigars).
     * The total is what the challan will offer: the order less what is cut / issued / passed, less fabric already sent. */
    const o = flowFabOwed(x.r, x.s), rem = flowRemFrac(x.r, x.s), qty = +x.r.qty || 0;
    const k = (x.r.__t ? 'T|' : 'R|') + (pc || '?') + '|' + (w.code || '?' + w.label);
    const e = g.get(k) || { w, pc, pname: (p.printer && p.printer.name) || '', keys: [], orders: new Set(), metres: 0, pcs: 0, ord: 0, done: 0, test: !!x.r.__t };
    e.keys.push(x.s.key); e.orders.add(x.r.orderNo); e.metres += o.metres;
    e.pcs += x.s.fabUnit === 'pcs' ? o.left : Math.round(tp.pcs * rem); e.ord += qty; e.done += Math.round(qty * (1 - rem)); g.set(k, e);
  });
  FLOW_GROUPS = [...g.values()].sort((a, b) => b.orders.size - a.orders.size || b.metres - a.metres);
  const body = FLOW_GROUPS.map((e, i) => `<tr><td class="frz" style="text-align:left">${e.w.needDir ? '<b style="color:#b91c1c">direction not picked</b>' : e.w.code ? `<b>${esc(e.w.code)}</b>` : '<b style="color:#b91c1c">no fabric SKU</b>'}${e.test ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}
      <div class="muted" style="font-size:10.5px">${esc(e.w.mode)} · ${esc(e.w.label)}</div></td>
    <td style="text-align:left;font-size:12px">${[...e.orders].map(esc).join('<br>')}</td>
    <td class="num">${nf(e.keys.length)}</td>
    <td class="num"><b>${e.w.kind === 'sku' ? nf(e.pcs) + ' pcs' : nf(flowR2(e.metres)) + ' m'}</b>${e.done > 0 ? `<div class="muted" style="font-size:10.5px">of ${nf(e.ord)} pcs ordered · ${nf(e.done)} already made / with karigars</div>` : ''}</td>
    <td style="text-align:left">${e.pname ? esc(e.pname) : '<span class="muted">not chosen</span>'}</td>
    <td><button data-flchg="${i}" style="width:auto;padding:3px 10px;font-size:12px">${e.orders.size > 1 ? `One challan for ${e.orders.size} orders` : 'Challan'}</button></td></tr>`).join('');
  return `<thead><tr><th class="frz" style="text-align:left">Printed fabric</th><th style="text-align:left">Orders</th><th>Lines</th><th>To print</th><th style="text-align:left">Printer</th><th></th></tr></thead><tbody>`
    + (body || '<tr><td colspan="6" class="muted" style="padding:16px">No line is waiting for fabric.</td></tr>') + '</tbody>';
}
/* WHAT THE CUTTING DEPARTMENT CUTS FROM, for a planned line: the printed fabric (from the store, or back from the
 * printer), how much, for how many pieces of the order. */
function flowCutFrom(x) {
  const p = x.s.plan;
  /* THE CUTTING ROUTE (16 Oct: the column said "—"). No printer: the line is cut from RFD — or, ticked "already printed / in
   * hand", from the printed cloth in the store. Fabric, colour and the metres it takes, from the plan. */
  if (p && x.s.route === 'stitch' && p.fabric && p.fabric.name) {
    const colour = String(((cutSkuOf(x.r.sku) || {}).color) || x.r.color || '').trim();
    const m = flowR2((+p.fabric.metres || 0) || (+p.fabric.perPc || 0) * (+x.r.qty || 0));
    return `<b>${esc(p.fabric.name)}</b>${p.fabric.noRfd && colour ? ' · ' + esc(colour) : ''} <span class="pill ${p.fabric.noRfd ? 'ok' : 'mute'}" style="font-size:10.5px">${p.fabric.noRfd ? 'printed, in hand' : 'RFD'}</span>`
      + `<div class="muted" style="font-size:10.5px">${nf(m)} m for ${nf(x.r.qty)} pcs</div>`;
  }
  if (!p || !flowPrinted(x.s.route)) return '<span class="muted">—</span>';
  const w = flowPrintWhat(x.r, p), m = flowR2(+(p.fabric && p.fabric.metres) || 0), fp = +(p.fabric && p.fabric.fromPrinted) || 0;
  return `${w.kind === 'sku' ? `<b>${esc(w.code)}</b> printed pieces` : flowPrintTxt(w)}<div class="muted" style="font-size:10.5px">${w.kind === 'sku' ? nf(x.r.qty) + ' pcs' : nf(m) + ' m'} for ${nf(x.r.qty)} pcs`
    + (x.s.noneLeft ? ' · <b style="color:#166534">nothing to print — the whole line was cut or issued already</b>' : x.s.fromStock ? ' · <b style="color:#166534">all from printed stock in the store</b>' : fp > 0 ? ` · ${nf(fp)} ${p.fabric.printedUnit === 'pcs' ? 'pcs' : 'm'} from printed stock, the rest from the printer` : ' · from the printer') + '</div>'
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

/* ALREADY STARTED, NOT PLANNED (Ravi, 27 Oct): a PPC line somebody has cut or issued from the Job Work Register says so —
 * what is cut, who it is with, what is back and passed — and how much the plan is still for (flowState s.startedNoPlan). */
function flowStartedHtml(x) {
  if (!x || !x.s || !x.s.startedNoPlan) return '';
  const r = x.r, s = x.s, q = +r.qty || 0, left = Math.round(q * flowRemFrac(r, s));
  const who = new Map();
  (PT.base || []).forEach(b => { const pcs = +(b && b.issuePieces) || 0;
    if (pcs > 0 && obUC(b.orderNo) === obUC(r.orderNo) && obUC(b.sku) === obUC(r.sku)) { const n = String(b.empName || '').trim() || 'karigar'; who.set(n, (who.get(n) || 0) + pcs); } });
  const parts = [
    +r.cut > 0 && `cut <b>${nf(+r.cut)}</b>`,
    s.issuedAll > 0 && `issued <b>${nf(s.issuedAll)}</b>${who.size ? ' to ' + [...who].map(([n, p]) => `${esc(n)} (${nf(p)})`).join(', ') : ''}`,
    s.receivedAll > 0 && `back <b>${nf(s.receivedAll)}</b>`,
    s.made > 0 && `passed <b>${nf(s.made)}</b>`].filter(Boolean);
  return `<div style="font-size:12px;color:#1d4ed8;margin-top:3px;white-space:normal">Already started: ${parts.join(' · ')}`
    + ` — ${left > 0 ? `plan the other <b>${nf(left)}</b> pcs` : `<b>all ${s.issuedAll >= q ? 'issued' : (+r.cut || 0) >= q ? 'cut' : 'done'} — nothing left to make</b>`}</div>`;
}
function flowTable(view, rows) {
  const pic = sku => { const u = typeof ptImgOf === 'function' ? ptImgOf(sku) : ''; return u ? `<img src="${esc(ptImgSrc(u, 34))}" alt="" style="width:34px;height:34px;object-fit:contain;background:#fff;border-radius:5px">` : ''; };
  /* COMPACT (Ravi, 14 Oct: "compact this"): the order column has a width it wraps in, and the order's name, badge, delete
   * link and date are written once — on the first of its lines in a run; the lines under it carry the order no small. */
  let prevNo = null;
  /* DESIGN A (Ravi, 14 Oct: "A · Table, each cell in short lines (label: value)"): every cell says one thing a line — the
   * order, then its date, then one paper a line, the delete link last; the SKU, then its item, colour and size. */
  const poHead = x => {
    const again = x.r.orderNo === prevNo; prevNo = x.r.orderNo;
    const buyer = typeof ordBuyerOf === 'function' ? ordBuyerOf(x.r.orderNo) : '';
    if (again) return `<div class="muted" style="font-size:11px">${esc(x.r.orderNo)}${buyer ? ' · ' + esc(buyer) : ''}</div>`;
    return (x.r.__t ? `<b>${esc(x.r.orderNo)}</b> <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>`
      : `<a href="#" data-ordj="${esc(x.r.orderNo)}" style="font-weight:600">${esc(x.r.orderNo)}</a>`)
      + (buyer ? `<div style="font-size:13px;font-weight:600">${esc(buyer)}</div>` : '')
      + `<div class="muted" style="font-size:12px">${esc(flowSrcOf(x))} · ${esc(ptIsoDate(x.r.orderDate) || '')} · ${nf(flowDays(x.r.orderDate) || 0)} d</div>`
      + (x.r.fromSo ? `<div class="muted" style="font-size:12px">Copy of sales order ${esc(x.r.fromSo)}</div>` : '');
  };
  const base = x => { const first = x.r.orderNo !== prevNo, h = poHead(x);
    return `<td class="frz" style="text-align:left;width:250px;max-width:250px;white-space:normal;vertical-align:top">${h}${flowDocsHtml(x)}${x.r.__t && first
      ? `<a href="#" data-fltdel="${esc(x.r.orderNo)}" style="font-size:11.5px;color:#b91c1c">delete test</a>` : ''}</td>
    <td style="text-align:left;white-space:nowrap;vertical-align:top"><div style="display:flex;gap:8px;align-items:flex-start">${pic(x.r.sku)}<div style="line-height:1.5">
      <b style="font-family:ui-monospace,monospace">${esc(x.r.sku)}</b>${(x.r.articleSubtype || x.r.articleType ? [x.r.articleSubtype || x.r.articleType, x.r.color, x.r.size] : [x.r.itemName, x.r.material, x.r.color, x.r.size]).filter(Boolean)
        .map(t => `<div class="muted" style="font-size:12px">${esc(t)}</div>`).join('')}</div></div></td>
    <td class="num" style="vertical-align:top"><b>${nf(x.r.qty)}</b></td>`; };
  /* A test line has no register entry to make: its button stands in for that entry. */
  const go = (view, x) => x && x.r.__t && ['cut', 'raw', 'wip'].includes(view) ? flowTestEntryButtons(view, x)
    : x && x.r.__t && FLOW_SIM[view] ? `<button data-flsim="${esc(x.r.orderNo)}|${esc(x.r.sku)}|${view}" title="Stands in for: ${esc(FLOW_SIM[view][1])}" style="width:auto;padding:3px 10px;font-size:12px;background:#7c3aed;border-color:#7c3aed">${esc(FLOW_SIM[view][0])}</button>`
    : x && !x.r.__t && ['cut', 'raw', 'wip'].includes(view) ? flowEntryButtons(view, x)
    : FLOW_GO[view] ? `<button class="ghost" data-flgo="${FLOW_GO[view][0]}" style="width:auto;padding:2px 9px;font-size:11.5px">${FLOW_GO[view][1]} →</button>` : '';
  const prog = (d, of) => `<span class="jw-st ${d >= of ? 'done' : d > 0 ? 'prog' : 'pend'}">${nf(d)} / ${nf(of)}</span>`;
  const due = (iso, label) => iso ? `<div class="muted" style="font-size:10.5px${flowLate(iso) ? ';color:#b91c1c;font-weight:600' : ''}">${label} ${esc(iso.slice(5))}${flowLate(iso) ? ' · late' : ''}</div>` : '';
  let head = '', body = '';
  if (view === 'pord') return flowPoTable(String($('flQ').value || '').trim().toLowerCase(), FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly());
  /* PRINTED FABRIC IN OPENS ON THE ORDERS WITH PRINTERS (Ravi, 23 Oct): every order given to a printer, received right there. */
  if (view === 'dhist' && (FLOW_ANGLE.dhist || 'due') === 'due') return flowDueTable(String($('flQ').value || '').trim().toLowerCase(), FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly());
  if (view === 'dhist' && FLOW_ANGLE.dhist === 'day') return flowRecvDayTable(String($('flQ').value || '').trim().toLowerCase(), FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly());
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
    /* SAME SKU, SAME DAY, COMBINED (Ravi, 15 Oct: "yadi mere pas 1 SKU ka same day order aay to wo sare order combine hokar
     * dikhe PPC team ko"). Two or more orders of one day asking for one SKU are one row: the orders and their quantities,
     * the total, what the plan holds for the total, and "Plan together" — each line still gets its own plan. */
    const grpOf = x => obUC(x.r.sku) + '|' + String(ptIsoDate(x.r.orderDate) || '') + '|' + (x.r.__t ? 'T' : 'R');
    /* BACK TO THE SALES TEAM (flow-back.js): a line PPC cannot plan goes back with a reason. */
    const backBtn = g => flowCanBack() && !g.some(x => x.r.__t) ? `<button class="ghost" data-flback="${esc(g.map(x => x.s.key).join(','))}" title="Something is wrong with the order or its master — send it back to the sales team with a reason" style="width:auto;padding:2px 8px;font-size:11.5px;color:#b91c1c;border-color:#fca5a5">Back to sales</button>` : '';
    const grps = new Map(); rows.forEach(x => { const k = grpOf(x); (grps.get(k) || grps.set(k, []).get(k)).push(x); });
    const drawn = new Set();
    const combined = g => { const x0 = g[0], tot = g.reduce((a, x) => a + (+x.r.qty || 0), 0), sg = flowSuggest(Object.assign({}, x0.r, { qty: tot }));
      prevNo = null;
      return `<tr style="background:#f5f3ff"><td class="frz" style="text-align:left;width:250px;max-width:250px;white-space:normal;vertical-align:top">
          <span class="jw-st prog">Combined · ${nf(g.length)} orders</span><div class="muted" style="font-size:12px;margin-top:3px">same SKU, ordered ${esc(ptIsoDate(x0.r.orderDate) || '')}</div>
          ${g.map(x => `<div style="font-size:12.5px">${x.r.__t ? `<b>${esc(x.r.orderNo)}</b>` : `<a href="#" data-ordj="${esc(x.r.orderNo)}">${esc(x.r.orderNo)}</a>`} · <b>${nf(x.r.qty)}</b> <span class="muted">${esc(x.r.src || '')}</span></div>${flowStartedHtml(x)}`).join('')}</td>
        <td style="text-align:left;white-space:nowrap;vertical-align:top"><div style="display:flex;gap:8px;align-items:flex-start">${pic(x0.r.sku)}<div style="line-height:1.5">
          <b style="font-family:ui-monospace,monospace">${esc(x0.r.sku)}</b>${[x0.r.articleSubtype || x0.r.articleType, x0.r.color, x0.r.size].filter(Boolean).map(t => `<div class="muted" style="font-size:12px">${esc(t)}</div>`).join('')}</div></div></td>
        <td class="num" style="vertical-align:top"><b>${nf(tot)}</b><div class="muted" style="font-size:11px">${g.map(x => nf(x.r.qty)).join(' + ')}</div></td>
        <td style="text-align:left;font-size:13px;line-height:1.55;white-space:normal;min-width:240px;vertical-align:top">
          <div>Fabric: <b>${esc(sg.fabric.name || '?')}</b> · ${sg.fabric.metres ? nf(sg.fabric.metres) + ' m' : '<b style="color:#b91c1c">metres not known</b>'}</div>
          <div>${sg.print.need ? `Print: <b>${esc(sg.printer.name || 'printer not chosen')}</b>` : 'No printing — straight to cutting'}</div></td>
        <td style="white-space:nowrap;vertical-align:top"><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start"><button data-flppck="${esc(g.map(x => x.s.key).join(','))}" style="width:auto;padding:3px 10px;font-size:12px">Plan together · ${nf(g.length)} orders</button>
          ${backBtn(g)}</div></td></tr>`; };
    body = rows.map(x => { const g = grps.get(grpOf(x));
      if (g.length > 1) { const k = grpOf(x); if (drawn.has(k)) return ''; drawn.add(k); return combined(g); }
      const sg = flowSuggest(x.r), first = !seen.has(x.r.orderNo); seen.add(x.r.orderNo);
      return `<tr>${base(x)}<td style="text-align:left;font-size:13px;line-height:1.55;white-space:normal;min-width:240px;vertical-align:top">
        <div>Fabric: <b>${esc(sg.fabric.name || '?')}</b> · ${sg.fabric.metres ? nf(sg.fabric.metres) + ' m' : '<b style="color:#b91c1c">metres not known</b>'}</div>
        <div>${sg.print.need ? `Print: <b>${esc(sg.printer.name || 'printer not chosen')}</b>${sg.printer.why ? `<div class="muted" style="font-size:12px">${esc(sg.printer.why)}</div>` : ''}` : 'No printing — straight to cutting'}</div>
        ${sg.acc.length ? `<div>Accessories: ${sg.acc.map(a => esc(a.code) + ' × ' + nf(a.qty)).join(', ')}</div>` : ''}
        ${sg.gaps.length ? `<div style="font-size:12px;color:#92400e">${esc(sg.gaps[0])}${sg.gaps.length > 1 ? ' (+' + (sg.gaps.length - 1) + ')' : ''}</div>` : ''}${flowStartedHtml(x)}</td>
        <td style="white-space:nowrap;vertical-align:top"><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start">${flowPpcHasDraft(x.s.key) ? '<span class="jw-st prog" title="Started in PPC and saved as a draft on this computer — open it to carry on">Draft saved</span>' : ''}${first ? `<button data-flppc="${esc(x.r.orderNo)}" style="width:auto;padding:3px 10px;font-size:12px">Plan this PO</button>` : ''}
          <button class="ghost" data-flppc="${esc(x.r.orderNo)}" data-sku="${esc(x.r.sku)}" style="width:auto;padding:2px 8px;font-size:11.5px">This line</button>
          ${backBtn([x])}</div></td></tr>`; }).join('');
  } else if (view === 'back') {
    /* What PPC sent back, why, and who has it now: the sales team sends it again from Sales Orders (or PPC takes it back). */
    head = ['PO', 'SKU', 'Qty', 'What is wrong', 'Sent back', ''];
    body = rows.map(x => { const b = x.r.ppcBack || {};
      return `<tr>${base(x)}
        <td style="text-align:left;font-size:13px;line-height:1.5;white-space:normal;min-width:240px;max-width:420px;vertical-align:top"><b style="color:#b91c1c">${esc(flowBackTxt(b.why))}</b>${b.note ? `<div>${esc(b.note)}</div>` : ''}
          <div class="muted" style="font-size:11.5px">With the sales team — Sales Orders → Sent back by PPC</div></td>
        <td class="muted" style="text-align:left;font-size:12px;line-height:1.55;vertical-align:top">${esc(String(b.at || '').slice(0, 10))}<br>${esc(String(b.by || '').split('@')[0])}</td>
        <td style="white-space:nowrap;vertical-align:top">${flowCanAgain() ? `<button class="ghost" data-flagain="${esc(x.r.orderNo + '|' + x.r.sku)}" style="width:auto;padding:2px 8px;font-size:11.5px">Take back into PPC</button>` : ''}</td></tr>`; }).join('');
  } else if (view === 'ppcdone') {
    /* What PPC planned, line by line, where the line is now, and the one place to change it. */
    head = ['PO', 'SKU', 'Qty', 'Planned', 'Now in', 'Raised', ''];
    const resyncSeen = new Set();     // one "Resync printer orders" per order, on its first line
    const now = s => s.bucket === 'demand' ? [s.needFab && 'Demand · RFD fabric', s.needAcc && 'Demand · Accessories'].filter(Boolean).join(' + ')
      : FLOW_ELSEWHERE[s.bucket] || (FLOW_BUCKETS.find(b => b[0] === s.bucket) || [, s.bucket])[1];
    body = rows.map(x => { const p = x.s.plan || {}, rp = flowRufflePrinter(p), rt = (FLOW_ROUTES.find(r => r[0] === flowRouteOf(p)) || [, , flowRouteOf(p)])[2];
      const locked = flowFabLocked(x.s);
      /* One cell per heading (Ravi, 14 Oct: "too hotch potch"): base() already gives Qty — a second Qty cell here pushed every
       * column one to the right of its heading. The long words wrap, so the table fits the screen without scrolling sideways. */
      return `<tr>${base(x)}
        <td style="text-align:left;font-size:13px;line-height:1.55;white-space:normal;min-width:220px;vertical-align:top"><div>Route: <b>${esc(rt || '')}</b>${p.fabric && p.fabric.noRfd ? ' <span class="muted" style="font-size:12px">· printed fabric in hand, no RFD</span>' : ''}</div>
          ${p.fabric && p.fabric.name ? `<div>Fabric: <b>${esc(p.fabric.name)}</b> · ${nf(flowR2(+p.fabric.metres || 0))} m</div>` : ''}
          ${p.printer && p.printer.name ? `<div>Print: <b>${esc(p.printer.name)}</b></div>` : ''}${rp ? `<div>Ruffle: <b>${esc(rp.name)}</b></div>` : ''}
          ${(p.acc || []).filter(a => a.code && +a.qty > 0).map(a => `<div class="muted" style="font-size:12px">${esc(a.what || a.code)} × ${nf(a.qty)}</div>`).join('')}</td>
        <td style="text-align:left;font-size:13px;white-space:normal;min-width:160px;max-width:240px;vertical-align:top">${esc(now(x.s))}</td>
        <td style="text-align:left;font-size:12px;line-height:1.55;vertical-align:top" class="muted">${esc(String(p.at || '').slice(0, 10))}${p.by ? '<br>' + esc(String(p.by).split('@')[0]) : ''}</td>
        <td style="white-space:normal;max-width:170px;vertical-align:top">${x.r.__t && x.s.bucket === 'ship'
          ? `<button data-flsim="${esc(x.r.orderNo)}|${esc(x.r.sku)}|ship" title="Stands in for: ${esc(FLOW_SIM.ship[1])}" style="width:auto;padding:3px 10px;font-size:12px;margin-bottom:6px;background:#7c3aed;border-color:#7c3aed">${esc(FLOW_SIM.ship[0])}</button><br>` : ''}<button data-flplan="${esc(x.r.orderNo)}|${esc(x.r.sku)}" style="width:auto;padding:3px 10px;font-size:12px" title="Change or undo what PPC planned">Edit plan</button>${ME.admin && !x.r.__t && !resyncSeen.has(x.r.orderNo) && resyncSeen.add(x.r.orderNo) ? `<br><button class="ghost" data-flposync="${esc(x.r.orderNo)}" style="width:auto;padding:2px 8px;font-size:11px;margin-top:6px" title="Rebuild this order's print order and the printer's Vendor Order from the plans as they are now">Resync printer orders</button>` : ''}
          ${locked ? `<div class="muted" style="font-size:10.5px;margin-top:3px" title="The fabric went on ${esc(x.s.challan.no)}: fabric and route can no longer change">fabric sent · ${esc(x.s.challan.no)}</div>` : ''}
          ${locked && flowPrinted(x.s.route) && !x.r.__t && flowBucketsAllowed().some(b => b[0] === 'ppcdone') ? `<button class="ghost" data-flchpr="${esc(x.s.key)}" title="Give this line to another printer — the cloth already given stays with the old printer, shown as standing" style="width:auto;padding:2px 8px;font-size:11.5px;margin-top:4px">Change printer</button>` : ''}</td></tr>`; }).join('');
  } else if (view === 'demb') {
    /* EMBROIDERY (Ravi, 21 Oct; flow-emb.js): the printed cloth back for each line, what the embroiderer has, Send / Receive. */
    head = ['PO', 'SKU', 'Qty', 'Printed fabric', 'Embroidery', ''];
    const seenE = new Set();
    body = rows.map(x => { const first = !seenE.has(x.r.orderNo); seenE.add(x.r.orderNo); return `<tr>${base(x)}${flowEmbCells(x, first)}</tr>`; }).join('');
  } else if (view === 'drfd') {
    /* THE SHP BOARD'S LOOK (Ravi, 31 Oct: "E · Like the SHP board — do this"): Date, Order ID, Item, Pcs, Print on, Cloth to send, and the stock with its
     * buttons in one cell; a peach band over each printer's lines with the metres and whether the cloth covers them. Every button and tick of the old
     * table is here still (pick, Challan → printer, ruffle challan, Mark fabric ready, Record cloth given earlier). */
    head = ['Date', 'Order ID', 'Item', 'Pcs', 'Print on', 'Cloth to send', 'Stock · action'];
    const cv = flowRfdCover(), seen = new Set();
    const shortOf = x => (cv.line[x.s.key] || {}).short || 0;
    const shownRows = FLOW_DRFD_FILT === 'short' ? rows.filter(x => shortOf(x) > 0) : FLOW_DRFD_FILT === 'covered' ? rows.filter(x => !(shortOf(x) > 0)) : rows;
    const gmap = new Map();
    shownRows.forEach(x => { const pl = x.s.plan || {}, pk0 = x.s.route === 'stitch' ? '' : (flowPlanPrinter(x.s) || '?');
      const nm = pk0 === '' ? 'No printing — straight to cutting' : ((pl.printer && pl.printer.name) || (pk0 === '?' ? 'Printer not chosen' : pk0));
      (gmap.get(nm) || gmap.set(nm, { nm, rows: [] }).get(nm)).rows.push(x); });
    const SB = 'font-size:11.5px;color:#6b7686';
    const lineRow = x => { const p = x.s.plan || {}, c = cv.line[x.s.key] || { need: 0, avail: 0, short: 0 };
      /* One challan button per PO and planned printer, on that printer's first line; none for stitching only. */
      const pk = x.s.route === 'stitch' ? '' : (flowPlanPrinter(x.s) || '?'), gk = x.r.orderNo + '|' + pk;
      const first = pk && !seen.has(gk); seen.add(gk);
      /* The ruffle cloth to its own printer: that printer's challan button too (once per PO and printer). */
      const ro = flowRuffleOwed(x), rk = ro ? x.r.orderNo + '|' + ro.printer.code : '', rfirst = !!ro && !seen.has(rk); if (ro) seen.add(rk);
      const pt = flowPrintTxt(flowPrintWhat(x.r, p)), cut = pt.indexOf(' · ');
      const on = cut < 0 ? pt : pt.slice(0, cut) + `</div><div style="${SB}">` + pt.slice(cut + 3).replace(/^./, ch => ch.toUpperCase());
      const day = ptIsoDate(x.r.orderDate) || '', dmy = day ? day.slice(8, 10) + '-' + day.slice(5, 7) + '-' + day.slice(0, 4) : '', age = flowDays(x.r.orderDate);
      const buyer = typeof ordBuyerOf === 'function' ? ordBuyerOf(x.r.orderNo) : '';
      const T = 'text-align:left;vertical-align:top;white-space:normal';
      const e = x.r.__t ? null : flowEarlierOf(x);
      return `<tr${c.short ? ' style="background:#fef2f2"' : ''}>
        <td class="frz" style="${T};white-space:nowrap;font-size:12.5px">${esc(dmy)}${age != null ? `<div style="${SB}">${nf(age)} d</div>` : ''}</td>
        <td style="${T};min-width:150px">${x.r.__t ? `<b>${esc(x.r.orderNo)}</b> <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>` : `<a href="#" data-ordj="${esc(x.r.orderNo)}" style="color:inherit;font-weight:700;text-decoration:underline dotted;font-size:14px">${esc(x.r.orderNo)}</a>`}${buyer ? `<div style="font-size:12px;font-weight:600">${esc(buyer)}</div>` : ''}${flowDocsHtml(x)}</td>
        <td style="${T};min-width:230px"><div style="display:flex;gap:8px;align-items:center">${pic(x.r.sku)}<div style="line-height:1.3"><div style="font-weight:600;font-size:13px">${esc(x.r.articleSubtype || x.r.articleType || x.r.itemName || '—')}</div>
          <div style="${SB}">${esc([x.r.color, x.r.size].filter(Boolean).join(' · '))} · <span style="font-family:ui-monospace,monospace">${esc(x.r.sku)}</span></div></div></div></td>
        <td class="num" style="vertical-align:top"><b style="font-size:15px">${nf(x.r.qty)}</b></td>
        <td style="${T};font-size:13px;line-height:1.5;min-width:210px">${x.s.route === 'stitch' ? 'No printing — straight to cutting' : `<div style="color:#4338ca;font-weight:600">${on}</div>${flowExtrasTxt(flowPrintExtras(x.r, p))}${flowRufflePrinter(p) ? `<div style="font-size:12px;color:#5b21b6">ruffle → <b>${esc(flowRufflePrinter(p).name)}</b>${ro ? '' : ' · sent'}</div>` : ''}`}</td>
        <td style="${T};font-size:13px;line-height:1.5;min-width:160px">${p.fabric ? `<div style="${SB}">${esc(p.fabric.name)}</div><div><b style="font-size:14px">${nf(c.need)} m</b></div>` : '—'}${ro ? `<div style="font-size:12px;color:#5b21b6">ruffle: ${esc(ro.fabric)} · ${nf(ro.metres)} m to ${esc(ro.printer.name)}</div>` : ''}${x.s.fabSent > 0 ? `<div style="margin-top:3px"><span class="jw-st prog" title="Sent on a challan in part — the rest is still to send">Partly sent</span> <span style="font-size:12px">${nf(x.s.fabSent)} of ${nf(x.s.fabNeed)} ${x.s.fabUnit} sent · ${nf(flowR2(Math.max(0, x.s.fabNeed - x.s.fabSent)))} still to send</span></div>` : ''}${flowMasterDiffTxt(flowMasterDiff(x.r, p))}</td>
        <td style="${T};white-space:nowrap;min-width:230px"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${c.short ? `<span class="jw-st" style="background:#fee2e2;color:#b91c1c;font-weight:700">⚑ Short: ${nf(c.short)} m</span>` : `<span class="jw-st done">covered</span>`}<span style="${SB}">${nf(c.avail)} m in stock</span></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">${x.s.route !== 'stitch' ? `<label style="display:inline-flex;gap:5px;align-items:center;font-size:11.5px;cursor:pointer" title="Tick lines of any orders — one challan per printer"><input type="checkbox" data-flchk="${esc(x.s.key)}"${FLOW_CHPICK.has(x.s.key) ? ' checked' : ''} style="width:auto;margin:0"> pick</label>` : ''}${first ? `<button data-flch="${esc(x.r.orderNo)}" data-pc="${esc(pk)}" title="${pk === '?' ? 'No printer is chosen for this line' : 'Challan for the cloth of this order that goes to ' + esc((p.printer && p.printer.name) || pk)}" style="width:auto;padding:3px 12px;font-size:12px;border-radius:999px">${pk === '?' ? 'Challan (printer not chosen)' : 'Challan'}</button>` : ''}${rfirst ? `<button data-flch="${esc(x.r.orderNo)}" data-pc="${esc(ro.printer.code)}" style="width:auto;padding:3px 12px;font-size:12px;border-radius:999px;background:#7c3aed;border-color:#7c3aed">Ruffle challan → ${esc(ro.printer.name)}</button>` : ''}<button class="ghost" data-flfab="${esc(x.s.key)}" style="width:auto;padding:3px 11px;font-size:12px;border-radius:999px">Ready</button></div>
          ${e && e.pcs > 0 ? `<div style="margin-top:6px"><button class="ghost" data-flrec="${esc(x.s.key)}" title="${nf(e.pcs)} pcs are made but no challan says their cloth went — record it (closed at once)" style="width:auto;padding:2px 8px;font-size:11.5px;color:#b45309;border-color:#f59e0b">Record cloth given earlier (${nf(e.pcs)} pcs)</button></div>` : ''}</td></tr>`; };
    body = [...gmap.values()].map(g => { const need = g.rows.reduce((t, x) => t + ((cv.line[x.s.key] || {}).need || 0), 0), sh = g.rows.reduce((t, x) => t + shortOf(x), 0), pickable = g.rows.filter(x => x.s.route !== 'stitch').map(x => x.s.key);
      return `<tr><td colspan="7" style="text-align:left;background:${sh ? '#fdeceb' : '#fdf0e8'};font-weight:700;font-size:13.5px;padding:8px 12px"><span style="display:inline-flex;gap:14px;align-items:center;flex-wrap:wrap">${esc(g.nm)} — ${nf(g.rows.length)} line(s) · ${nf(flowR2(need))} m `
        + (sh ? `<span class="jw-st" style="background:#fee2e2;color:#b91c1c;font-weight:700">⚑ short ${nf(flowR2(sh))} m</span>` : '<span class="jw-st done">all covered</span>')
        + (pickable.length ? ` <button class="ghost" data-flpickall="${esc(pickable.join(','))}" style="width:auto;padding:2px 11px;font-size:12px;border-radius:999px">Pick all ${nf(pickable.length)}</button>` : '') + '</span></td></tr>'
        + g.rows.map(lineRow).join(''); }).join('');
    const fs = Object.values(cv.fab).filter(f => f.need > 0).sort((a, b) => b.short - a.short || a.name.localeCompare(b.name));
    FLOW.byprint = flowByPrintTable(rows);
    FLOW.bysize = flowBySizeTable(rows);
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
    /* RESERVED, NOT ISSUED YET — RELEASE IS HERE. A reserved line leaves the list above, and the only Release button sat on
     * a view no tab opens, so a reservation made by mistake held the zips for good. Under the lines to reserve, the ones
     * holding accessories that have not gone to a karigar, each with Release: the accessories go back to the shelf. */
    const held = (FLOW.held || []).slice().sort((a, b) => String(a.r.orderNo).localeCompare(String(b.r.orderNo)));
    prevNo = null;
    if (held.length) body = (body || '<tr><td colspan="5" class="muted" style="padding:16px">No line is waiting to be reserved.</td></tr>')
      + `<tr><td colspan="5" style="text-align:left;background:#f8fafc;font-weight:600;font-size:12.5px;padding:8px 10px">Reserved, not issued yet · ${nf(held.length)} line(s) — Release puts the accessories back on the shelf</td></tr>`
      + held.map(x => `<tr>${base(x)}<td style="text-align:left">${Object.entries((x.s.res && x.s.res.items) || {}).map(([c, q]) => `<div style="font-size:12px"><b>${esc(c)}</b> × ${nf(q)} <span class="muted">reserved</span></div>`).join('')}</td>
        <td><button class="ghost" data-flunres="${esc(x.s.key)}" style="width:auto;padding:3px 10px;font-size:12px">Release accessories</button></td></tr>`).join('');
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
    /* CUTTING PENDING (Ravi, 17 Oct: "yaha kitne pcs cut krne h wo cutting pending me show ho"): what is still to cut on each
     * line — the order less what is cut — and, where part is still with the printer, how much of it can be cut today. The
     * total for the list on top. */
    head = ['PO', 'SKU', 'Qty', 'Printed fabric to cut', 'Cut', 'Pending to cut', ''];
    const pend = x => Math.max(0, (+x.r.qty || 0) - (+x.s.cut || 0));
    const totP = rows.reduce((t, x) => t + pend(x), 0), totNow = rows.reduce((t, x) => t + Math.min(pend(x), +x.s.canCut || 0), 0);
    body = (rows.length ? `<tr style="background:var(--soft,#f4f6fb)"><td colspan="7" style="text-align:left;font-size:13px">Cutting pending: <b>${nf(totP)} pcs</b> on ${nf(rows.length)} line(s)${totNow < totP ? ` · <b>${nf(totNow)} pcs</b> can be cut now — the rest is still with the printer` : ''}</td></tr>` : '')
      + rows.map(x => { const pd = pend(x), now = Math.min(pd, +x.s.canCut || 0);
        return `<tr>${base(x)}<td style="text-align:left;font-size:12px">${flowCutFrom(x)}</td><td class="num">${prog(x.s.cut, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.cut, 'plan')}</td>`
          + `<td class="num"><b style="font-size:15px">${nf(pd)}</b> pcs${now < pd ? `<div style="font-size:10.5px;color:#b45309">${nf(now)} can be cut now</div>` : ''}</td><td>${go(view, x)}</td></tr>`; }).join('');
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
  const xl = e.target.closest('[data-flpivxl]');
  if (xl) { try { if (xl.dataset.flpivxl === 'line') flowDrfdLineXl(FLOW.shownDrfd || []); else flowBySizeXl(); } catch (er) { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not make the sheet: ' + (er.message || er); } return; }
  const cp = e.target.closest('[data-flchp]'); if (!cp) return;
  const er = flowChallanPrint(cp.dataset.flchp); if (er) { $('flMsg').className = 'err'; $('flMsg').textContent = er; } });
$('flQ').addEventListener('input', () => { clearTimeout(FLOW.qt); FLOW.qt = setTimeout(renderFlow, 220); });
FLOW_FILT.map(f => f[1]).concat('flFAge').forEach(id => { if ($(id)) $(id).addEventListener('change', renderFlow); });
if ($('flFilt')) $('flFilt').addEventListener('toggle', () => { if ($('flFilt').open) renderFlow(); });
if ($('flFClear')) $('flFClear').onclick = () => { FLOW_FILT.map(f => f[1]).concat('flFAge').forEach(id => { if ($(id)) $(id).value = ''; }); renderFlow(); };
if (document.addEventListener) document.addEventListener('click', e => { const d = $('flFilt'); if (d && d.open && !d.contains(e.target)) d.open = false; });
/* The test-order button and switch are gone from the page (16 Oct); nothing to wire. */
if ($('flTest')) $('flTest').onclick = () => flowTestOpen();
if ($('flTestOnly')) $('flTestOnly').addEventListener('change', () => { flowTestOnlySet($('flTestOnly').checked); renderFlow(); });
/* PPC in Excel (flow-ppc.js): out = the PPC lines on screen; in = drafts, then the form. */
if ($('flXlOut')) $('flXlOut').onclick = () => { try { flowPpcXlOut(FLOW.shownPpc || []); } catch (e) { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not make the sheet: ' + (e.message || e); } };
if ($('flXlIn')) $('flXlIn').onclick = () => $('flXlFile').click();
if ($('flXlFile')) $('flXlFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; flowPpcXlIn(f); };
if ($('flXlNext')) $('flXlNext').onclick = () => flowXlOpenNext();
$('flRefresh').onclick = async () => {
  try {
    FLOW.readErr = await flowReads([['the order book and registers', ptLoadGates(true)], ['plans and challans', flowLoad(true)],
      /* the Greige Desk too: the RFD stock is its count (flowRfdStock) */
      ['the Greige Desk', FLOW_ON && typeof GD !== 'undefined' && GD.reload && flowGdReads() ? GD.reload() : null]]);
  } finally { renderFlow(); }
};
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
  const rec = e.target.closest('[data-flrec]'); if (rec) { e.preventDefault(); flowRecordEarlierOpen(rec.dataset.flrec); return; }
  const cpr = e.target.closest('[data-flchpr]'); if (cpr) { e.preventDefault(); flowChangePrinterOpen(cpr.dataset.flchpr); return; }
  const rs = e.target.closest('[data-flposync]');
  if (rs) { e.preventDefault(); const er = await flowPoResync(rs.dataset.flposync); if (er) { $('flMsg').className = 'err'; $('flMsg').textContent = er; } else { renderFlow(); $('flMsg').className = 'muted'; $('flMsg').textContent = flowPoResync.said || ''; } return; }
  const ce = e.target.closest('[data-flche]'); if (ce) { flowChallanEditOpen(ce.dataset.flche); return; }
  const cx = e.target.closest('[data-flchx]'); if (cx) { flowChallanCancelOpen(cx.dataset.flchx); return; }
  const cu = e.target.closest('[data-flchu],[data-flcho]');
  if (cu) { const er = cu.dataset.flchu ? await flowUndoReceipt(cu.dataset.flchu) : await flowReopen(cu.dataset.flcho);
    $('flMsg').className = er ? 'err' : 'muted'; if (er) $('flMsg').textContent = er; else renderFlow(); return; }
  const cs = e.target.closest('[data-flchc]'); if (cs) { flowCloseShortOpen(cs.dataset.flchc); return; }
  const ch = e.target.closest('[data-flch]'); if (ch) { flowChallanOpen(ch.dataset.flch, ch.dataset.pc); return; }
  const sz = e.target.closest('[data-flszch]'); if (sz) { flowSizeChallanOpen(sz.dataset.flszch); return; }
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
  const pk = e.target.closest('[data-flppck]'); if (pk) { flowPpcOpen('', '', String(pk.dataset.flppck || '').split(',').filter(Boolean)); return; }
  const pp = e.target.closest('[data-flppc]'); if (pp) { flowPpcOpen(pp.dataset.flppc, pp.dataset.sku || ''); return; }
  const bk = e.target.closest('[data-flback]'); if (bk) { flowBackOpen(String(bk.dataset.flback || '').split(',').filter(Boolean)); return; }
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
/* The Greige Desk is for anyone holding one of its rights (real working since 15 Oct). */
/* THE RFD STOCK IS THE GREIGE DESK'S COUNT (flowRfdStock), so whoever works PPC or Demand reads the desk — only reads it;
 * the Greige Desk menu stays for its own rights (Ravi, 16 Oct: Vikram, PPC without a Greige Desk right, saw "stock not read"). */
function flowGdReads() { return gdAllowed() || flowScreenAllowed().length > 0; }
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
const FLOW_EMB_SHOWN = {};
/** The lines on screen in an embedded flow list (every one the filters let through, not only the 800 drawn), as a sheet. */
function flowEmbedRows(view, rows) {
  const days = iso => { const a = Date.parse(String(iso || '').slice(0, 10)), b = Date.parse(dToday()); return isNaN(a) || isNaN(b) ? '' : Math.max(0, Math.round((b - a) / 864e5)); };
  const out = [['PO', 'Platform', 'Order date', 'Days old', 'SKU', 'Article', 'Subtype', 'Colour', 'Size', 'Qty', 'Printed fabric', 'Cut', 'Pending to cut', 'Can cut now',
    'Issued', 'Received', 'QC passed', 'In store, to issue', 'Planned cut date']];
  rows.forEach(x => {
    const q = +x.r.qty || 0, pend = Math.max(0, q - (+x.s.cut || 0)), pf = (() => { try { const f = flowCutFabricOf(x.r, x.s.plan); return [f.code, f.label].filter(Boolean).join(' · '); } catch (e) { return ''; } })();
    out.push([x.r.orderNo, flowSrcOf(x) || '', ptIsoDate(x.r.orderDate) || '', days(ptIsoDate(x.r.orderDate)), x.r.sku, x.r.articleType || '', x.r.articleSubtype || '', x.r.color || '', x.r.size || '', q, pf,
      +x.s.cut || 0, x.s.cutReq ? pend : '', x.s.cutReq ? Math.min(pend, +x.s.canCut || 0) : '', +x.s.issuedNet || +x.s.issued || 0, +x.s.received || 0, +x.s.made || 0, +x.s.canIssue || 0,
      (x.s.plan && x.s.plan.dates && x.s.plan.dates.cut) || '']);
  });
  return out;
}
function flowEmbedXl(tab) {
  const sh = FLOW_EMB_SHOWN[tab]; if (!sh || !sh.rows.length) { const m = $('flEmbMsg_' + tab); if (m) m.textContent = 'No line to put in the sheet.'; return; }
  const name = ((FLOW_BUCKETS.find(b => b[0] === sh.view) || [, sh.view])[1] || sh.view).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const bytes = recipeXlsx(flowEmbedRows(sh.view, sh.rows), { name: 'Lines', freeze: 2, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name + '-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
function flowEmbedViews(tab) { const mine = new Set(flowBucketsAllowed().map(b => b[0])); return FLOW_ON ? FLOW_EMBED[tab].views.filter(v => mine.has(v)) : []; }
function flowEmbedSetup() {
  Object.keys(FLOW_EMBED).forEach(tab => {
    const pane = $(FLOW_EMBED[tab].pane); if (!pane || !pane.insertAdjacentHTML) return;
    const views = flowEmbedViews(tab), seg = $('flSeg_' + tab);
    if (!views.length) { if (seg && seg.remove) { seg.remove(); const b = $('flEmb_' + tab); if (b && b.remove) b.remove(); } FLOW_EMB[tab] = ''; return; }
    if (!seg || !seg.isConnected) {
      pane.insertAdjacentHTML('afterbegin', `<div id="flSeg_${tab}" class="card" style="padding:8px 10px;margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"></div>`
        + `<div id="flEmb_${tab}" class="hide"><div class="card" style="padding:10px 14px">`
        /* PLATFORM AND SEARCH (Ravi, 16 Oct: "to cut wale me filter laga kar check kar saku ki kis platform ka h"). */
        + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><select id="flEmbSrc_${tab}" style="width:auto;min-width:170px"><option value="">Every platform</option></select>`
        /* ARTICLE, SUBTYPE, COLOUR AND EXCEL (Ravi, 22 Oct: "yaha par bhi export button ho and filter me color article subtype add krdo") */
        + `<select id="flEmbAt_${tab}" style="width:auto;min-width:150px"><option value="">Every article</option></select>`
        + `<select id="flEmbSub_${tab}" style="width:auto;min-width:170px"><option value="">Every subtype</option></select>`
        + `<select id="flEmbCol_${tab}" style="width:auto;min-width:150px"><option value="">Every colour</option></select>`
        + `<input id="flEmbQ_${tab}" placeholder="Search PO, SKU, colour…" style="flex:1 1 240px;min-width:0;max-width:420px">`
        + `<button type="button" class="ghost" id="flEmbXl_${tab}" style="width:auto;padding:6px 14px;font-size:13px">Download Excel</button></div>`
        + `<div id="flEmbMsg_${tab}" class="muted" style="font-size:12.5px"></div></div>`
        + `<div class="card xlwrap" style="margin-top:12px"><table class="xl" id="flEmbT_${tab}"></table></div></div>`);
      $('flSeg_' + tab).addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-flemb]'); if (!b) return; FLOW_EMB[tab] = b.dataset.flemb; flowEmbedRender(tab); });
      $('flEmbT_' + tab).addEventListener('click', flowTableClick);
      ['flEmbSrc_', 'flEmbAt_', 'flEmbSub_', 'flEmbCol_'].forEach(id => { if ($(id + tab)) $(id + tab).addEventListener('change', () => flowEmbedRender(tab)); });
      if ($('flEmbXl_' + tab)) $('flEmbXl_' + tab).addEventListener('click', () => { try { flowEmbedXl(tab); } catch (e) { const m = $('flEmbMsg_' + tab); if (m) m.textContent = 'Could not make the sheet: ' + (e.message || e); } });
      if ($('flEmbQ_' + tab)) $('flEmbQ_' + tab).addEventListener('input', () => flowEmbedRender(tab));
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
    + '';
  [...pane.children].forEach(ch => { if (ch !== seg && ch !== box && ch.classList) ch.classList.toggle('fl-embhide', !!v); });
  box.classList.toggle('hide', !v);
  if (!v) return;
  const msg = $('flEmbMsg_' + tab), tbl = $('flEmbT_' + tab);
  if (!FLOW.ppc) { msg.textContent = 'Reading the production flow…'; tbl.innerHTML = ''; try { await flowEnsureData(); } catch (e) { msg.textContent = 'Could not read the production flow.'; return; } return flowEmbedRender(tab); }
  const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly();
  const inView = flowRows().filter(x => (!only || x.r.__t) && flowInView(v, x.s));
  /* The platform list is what this bucket's lines carry; the pick survives a redraw. */
  const srcSel = $('flEmbSrc_' + tab), qBox = $('flEmbQ_' + tab);
  const src = srcSel ? String(srcSel.value || '') : '', q = qBox ? String(qBox.value || '').trim().toLowerCase() : '';
  if (srcSel && typeof ptFillSelect === 'function') { const list = [...new Set(inView.map(flowSrcOf).filter(Boolean))].sort(); if (src && !list.includes(src)) list.push(src);
    ptFillSelect('flEmbSrc_' + tab, list.map(s => [s, s + ' (' + nf(inView.filter(x => flowSrcOf(x) === s).length) + ')']), 'Every platform'); srcSel.value = src; }
  /* article, subtype and colour: each list is what the lines left by the other picks carry; a pick survives a redraw */
  const pick = id => String(($(id + tab) || {}).value || ''), at = pick('flEmbAt_'), sub = pick('flEmbSub_'), col = pick('flEmbCol_');
  const fAt = x => String(x.r.articleType || '').trim(), fSub = x => String(x.r.articleSubtype || '').trim(), fCol = x => String(x.r.color || '').trim();
  const pass = (x, skip) => (!src || flowSrcOf(x) === src) && (skip === 'at' || !at || fAt(x) === at) && (skip === 'sub' || !sub || fSub(x) === sub) && (skip === 'col' || !col || fCol(x) === col);
  [['flEmbAt_', 'at', fAt, at, 'Every article'], ['flEmbSub_', 'sub', fSub, sub, 'Every subtype'], ['flEmbCol_', 'col', fCol, col, 'Every colour']].forEach(([id, k, fn, cur, all]) => {
    if (!$(id + tab) || typeof ptFillSelect !== 'function') return;
    const these = inView.filter(x => pass(x, k)), list = [...new Set(these.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (cur && !list.includes(cur)) list.push(cur);
    ptFillSelect(id + tab, list.map(s => [s, s + ' (' + nf(these.filter(x => fn(x) === s).length) + ')']), all); $(id + tab).value = cur; });
  const rows = inView.filter(x => pass(x)
      && (!q || [x.r.orderNo, x.r.sku, x.r.color, x.r.size, x.r.articleSubtype, x.r.articleType, x.r.shopOrderNo].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => String(a.r.orderDate || '').localeCompare(String(b.r.orderDate || '')) || String(a.r.orderNo).localeCompare(String(b.r.orderNo)));
  tbl.innerHTML = flowTable(v, rows.slice(0, 800));
  FLOW_EMB_SHOWN[tab] = { view: v, rows };
  const b = FLOW_BUCKETS.find(x => x[0] === v) || [];
  msg.textContent = `${b[1]}: ${rows.length < inView.length ? `${nf(rows.length)} of ${nf(inView.length)}` : nf(rows.length)} line(s)${src ? ' · ' + src : ''}${q ? ` · search “${q}”` : ''} — ${b[3]}${only ? ' · SHOWING TEST ORDERS ONLY (switch on the Production flow screen)' : ''} · ${flowPhaseTxt()}`;
}
/** Finished Goods → From QC — to accept. */
async function flowFgOpen() {
  if (!flowMay('fgi') && !flowMayFg()) return flowSay('Finished Goods is not open to this account.', true);
  showTab('fgi'); if ($('fgView')) $('fgView').value = 'flow';
  if (typeof ensureFgi === 'function') await ensureFgi(); else renderFgi();
}
