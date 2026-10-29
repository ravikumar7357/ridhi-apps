/* ================================================================
 * PPC REPORT (Ravi, 28 Oct: "a report system so that a person can download it on the basis of days or choosing the date
 * from calendar — this is the ppc report of it", in the layout of Sheet3 of his WIP workbook: one row a line, then the
 * Row Labels / Sum of PCS summary). Nothing is read for it but the sales orders' due dates: the lines, plans, print orders,
 * challans and Job Work issues are the ones the PPC screen has already read, so opening it costs the database nothing.
 *
 *   Plan date     the day the plan was FIRST saved (plan.firstAt, kept from 28 Oct). A plan saved before then has only its
 *                 last save (plan.at).
 *   Stages        (Ravi, 28 Oct, his v6 workbook): Printing, Cutting, Stitching, QC and Press, each a status in colour
 *                 (Done / Passed, In progress, Not started, Not needed) with its pieces beside it (flowRepStages).
 *   Sheets        Lines — row 1 adds the counts with SUBTOTAL (a filter re-adds them), row 2 names the groups, row 3 has
 *                 the filters — and Summary, a pivot by SKU: ordered, completed, pending, lines, late lines, Grand Total.
 *   Last moved    the last thing that happened to the line, its day and its step (flowRepLastMoved).
 *   Exp. completion  the plan's Ready date — PPC must give one to save a plan (28 Oct).
 *   Due date      the sales order's delivery date; for a Shopify / online line, 5 working days from when it opened (the
 *                 made-to-order rule of Production to Shipping); for the rest (Amazon), the Ready date — Amazon gives none.
 *   Delay         today against the due date, for a line not yet made; a made line says "made".
 *   Who           admins, and whoever holds the Reports right.
 * ================================================================ */
const FLOW_REP = { from: '', to: '', on: 'planned', soErr: '' };
const flowRepAllowed = () => !!(ME.admin || (ME.tabs || []).includes('rep'));
/* Made — passed QC: nothing left to be late on. */
const FLOW_REP_MADE = ['ship', 'fgin', 'done'];
const flowRepPad = n => String(n).padStart(2, '0');
/** A saved time (ISO, UTC) as the calendar day it was here. */
const flowRepDay = at => { if (!at) return ''; const d = new Date(at); return isNaN(d) ? String(at).slice(0, 10) : d.getFullYear() + '-' + flowRepPad(d.getMonth() + 1) + '-' + flowRepPad(d.getDate()); };
const flowRepShow = iso => { const q = String(iso || '').slice(0, 10).split('-'); return q.length === 3 && q[0] ? q[2] + '/' + q[1] + '/' + q[0] : ''; };
const flowRepAdd = (iso, n) => { const q = String(iso).split('-').map(Number), d = new Date(q[0], q[1] - 1, q[2] + n); return d.getFullYear() + '-' + flowRepPad(d.getMonth() + 1) + '-' + flowRepPad(d.getDate()); };
const flowRepDaysBetween = (a, b) => { const p = s => { const q = String(s).split('-').map(Number); return Date.UTC(q[0], q[1] - 1, q[2]); }; return Math.round((p(b) - p(a)) / 864e5); };
const FLOW_REP_CHANNEL = { AMZ: 'Amazon', SHP: 'Shopify', ONL: 'Online', B2B: 'B2B', SO: 'Sales order', FBA: 'Amazon' };
const flowRepChannel = r => { const pre = obUC(String(r.orderNo || '').split('-')[0]); return FLOW_REP_CHANNEL[pre] || FLOW_REP_CHANNEL[obUC(r.src)] || String(r.src || pre || ''); };

/** The quick choices: [label, from, to]. */
function flowRepRanges() {
  const t = dToday(), m = t.slice(0, 8) + '01';
  return [['Today', t, t], ['Yesterday', flowRepAdd(t, -1), flowRepAdd(t, -1)], ['Last 7 days', flowRepAdd(t, -6), t], ['Last 30 days', flowRepAdd(t, -29), t], ['This month', m, t]];
}

/** Due date and where it came from — the sales order's, the made-to-order rule's, or PPC's own Ready date. */
function flowRepDue(r, p, soDue) {
  const so = soDue && soDue.get(obUC(r.orderNo) + '|' + obUC(r.sku));
  if (so) return { due: so, from: 'sales order' };
  if (r.mtoDue) return { due: String(r.mtoDue).slice(0, 10), from: 'Shopify · 5 working days' };
  const ready = p && p.dates && p.dates.ready;
  if (ready) return { due: String(ready).slice(0, 10), from: 'PPC ready date' };
  return { due: '', from: '' };
}
/** "LATE · 2 days" / "3 days left" / "due today" / "made" / "no date set" — and the days late as a number (0 when not late). */
function flowRepDelay(due, made, today) {
  if (made) return { txt: 'made', late: 0 };
  if (!due) return { txt: 'no date set', late: 0 };
  const d = flowRepDaysBetween(due, today);
  if (d > 0) return { txt: `LATE · ${d} day${d > 1 ? 's' : ''}`, late: d };
  if (d === 0) return { txt: 'due today', late: 0 };
  return { txt: `${-d} day${d < -1 ? 's' : ''} left`, late: 0 };
}
/* THE STAGES OF A LINE (Ravi, 28 Oct — his v6 workbook, ppc-report-v6-sample.xlsx): Printing, Cutting, Stitching, QC and
 * Press, each with a status — Done (QC: Passed), In progress, Not started, Not needed — and the pieces beside it. A piece
 * past a stage has been through it (a piece cut was printed), so a stage counts what any later stage has. */
const FLOW_REP_DONE = 'Done', FLOW_REP_WIP = 'In progress', FLOW_REP_NOT = 'Not started', FLOW_REP_NA = 'Not needed';
const flowRepSt = (need, done, started, qty, doneWord) => !need ? FLOW_REP_NA : qty > 0 && done >= qty ? (doneWord || FLOW_REP_DONE) : started ? FLOW_REP_WIP : FLOW_REP_NOT;
function flowRepStages(r, s, p) {
  const qty = +r.qty || 0, cap = n => Math.max(0, Math.min(qty, Math.floor((+n || 0) + 1e-9)));
  const route = s.route, outside = route === 'outsource';
  const pressed = cap(r.pressed), passed = cap(s.qc), rejected = Math.max(0, +s.qcRej || 0);
  const given = Math.max(0, +s.issuedAll || 0), received = Math.max(0, +s.receivedAll || 0);
  const stitched = Math.max(cap(received), passed, pressed), cutC = Math.max(cap(s.cut), cap(s.issuedNet || 0), stitched);
  const cut = Math.max(0, +r.cut || 0) || (s.cutReq ? cap(s.cut) : 0);
  const printOn = !!p && flowPrinted(route) && !s.fromStock, printed = Math.max(cap(s.back), cutC);
  const ch = s.challan || null;
  return {
    print: { status: flowRepSt(printOn, printed, printed > 0 || +s.fabSent > 0 || !!ch, qty),
      printer: printOn ? ((p.printer && (p.printer.name || p.printer.code)) || (ch && ch.vendor) || '') : '' },
    cut: { status: flowRepSt(!!s.cutReq && !outside, cutC, cutC > 0, qty), cut, store: s.cutReq ? Math.max(0, cut - Math.max(0, +s.issuedNet || 0)) : 0 },
    stitch: { status: flowRepSt(!outside, stitched, given > 0 || stitched > 0, qty), given, received },
    qc: { status: flowRepSt(!outside, Math.max(passed + Math.min(rejected, qty), pressed), passed + rejected > 0 || pressed > 0, qty, 'Passed'), passed, rejected },
    press: { status: flowRepSt(!outside, pressed, pressed > 0, qty), pressed },
    /* completed = made: passed QC and pressed (or, for a line made outside, received finished) */
    completed: outside ? cap(s.india) : Math.max(pressed, Math.min(passed, cap(s.made))),
  };
}
/* The last thing that happened to the line, in the floor's words. */
const FLOW_REP_STEP = { plan: 'Planned', 'print order': 'Print order', 'RFD challan': 'RFD challan', 'printed back': 'Back from printer', cut: 'Cut',
  'karigar issue': 'Given to karigar', 'karigar back': 'Received from karigar', QC: 'QC', handed: 'Made' };
function flowRepLastMoved(r, s, p) {
  let best = { day: '', what: '' };
  const see = (d, what) => { const day = String(ptIsoDate(d) || '').slice(0, 10); if (/^\d{4}-\d\d-\d\d$/.test(day) && day >= best.day) best = { day, what }; };
  const mine = x => x && obUC(x.orderNo) === obUC(r.orderNo) && obUC(x.sku) === obUC(r.sku);
  if (p) see(flowRepDay(p.at), 'plan');
  Object.values(FLOW.po || {}).forEach(o => { if (o && !o.cancelled && o.items && o.items[s.key]) see(o.date, 'print order'); });
  Object.values(FLOW.ch || {}).forEach(c => { if (!c || c.cancelled || !(c.lines || []).some(l => l && l.key === s.key)) return;
    see(c.date, 'RFD challan'); Object.values(c.receipts || {}).forEach(rc => { if (rc && rc.items && +rc.items[s.key] > 0) see(rc.date, 'printed back'); }); });
  (PT.cut || []).forEach(x => { if (mine(x)) see(x.cutDate, 'cut'); });
  (PT.base || []).forEach(x => { if (!mine(x)) return; see(x.issueDate, 'karigar issue'); if (+x.receivedPieces > 0) see(x.receivingDate, 'karigar back'); });
  ((typeof QC !== 'undefined' && QC.checks) || []).forEach(x => { if (mine(x)) see(x.date, 'QC'); });
  if (r.handedAt) see(r.handedAt, 'handed');
  return { day: best.day, step: FLOW_REP_STEP[best.what] || best.what };
}

/** The report's lines: o = { from, to, on: planned|came|waiting, today, soDue }. Real orders only — never a TEST line. */
function flowRepLines(o) {
  const today = o.today || dToday(), soDue = o.soDue || null;
  const mdb = new Map(((typeof PTG !== 'undefined' && PTG.mdb) || []).map(m => [obUC(m && m.sku), m]));
  const lines = FLOW_REAL ? ordLines() : flowMtoLines();
  const inRange = d => !!d && d >= o.from && d <= o.to;
  const out = [];
  (lines || []).forEach(r => {
    if (!r || r.__t) return;
    const s = flowState(r), p = s.plan || null;
    const first = p ? flowRepDay(p.firstAt || p.at) : '';
    const keep = o.on === 'waiting' ? s.bucket === 'ppc'
      : o.on === 'came' ? inRange(ptIsoDate(r.orderDate))
      : !!p && inRange(first);
    if (!keep) return;
    const m = mdb.get(obUC(r.sku)) || cutSkuOf(r.sku) || {};
    const due = flowRepDue(r, p, soDue), made = FLOW_REP_MADE.includes(s.bucket), dl = flowRepDelay(due.due, made, today);
    const route = p ? flowRouteOf(p) : '', mv = flowRepLastMoved(r, s, p);
    out.push(Object.assign({
      key: s.key, planned: first, plannedKnown: !!(p && p.firstAt), orderNo: String(r.orderNo || ''), orderDate: ptIsoDate(r.orderDate) || '',
      channel: flowRepChannel(r), sku: obUC(r.sku),
      category: String(m.articleType || r.articleType || ''), subCategory: String(m.subtype || m.articleSubtype || r.articleSubtype || ''),
      parent: String(m.parentAsin || ''), colour: String(m.color || r.color || ''), size: String(m.size || r.size || ''),
      fabric: String((p && p.fabric && p.fabric.name) || m.fabric || ''), pcs: +r.qty || 0, process: route ? ((FLOW_ROUTES.find(x => x[0] === route) || [])[2] || route) : '',
      completion: p && p.dates && p.dates.ready ? String(p.dates.ready).slice(0, 10) : '',
      due: due.due, dueFrom: due.from, delay: dl.txt, late: dl.late, made, moved: made && mv.day ? { day: mv.day, step: 'Made' } : mv,
      waitDays: s.bucket === 'ppc' && r.orderDate ? Math.max(0, flowRepDaysBetween(ptIsoDate(r.orderDate), today)) : 0,
    }, flowRepStages(r, s, p), made ? { completed: +r.qty || 0 } : {}));
  });
  return out.sort((a, b) => (a.planned || a.orderDate).localeCompare(b.planned || b.orderDate) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));
}

/* ---- the workbook, cell for cell as Ravi's v6 ---- */
/* The groups over the columns: [name, fill, text colour] — the colours of his sheet. */
const FLOW_REP_GRP = { Order: ['E6F1FB', '0C447C'], Product: ['F1EFE8', '444441'], Qty: ['EEEDFE', '3C3489'], Pieces: ['EEEDFE', '3C3489'],
  Printing: ['FBEAF0', '72243E'], Cutting: ['FAEEDA', '633806'], Stitching: ['E1F5EE', '085041'], QC: ['EAF3DE', '27500A'], Press: ['EEEDFE', '3C3489'], Dates: ['FAECE7', '712B13'] };
const FLOW_REP_TONE = { Done: ['C0DD97', '173404', 1], Passed: ['C0DD97', '173404', 1], 'In progress': ['FAC775', '412402'], 'Not started': ['F1EFE8', '444441'], 'Not needed': ['FFFFFF', '888780'] };
/* A STAGE DONE SHOWS "-" (Ravi, 28 Oct): once Cutting / Stitching / QC / Press is done, its Cut / Given / Passed / Pressed cell says
 * "-" rather than the count — the status beside it already says it is all through. */
const flowRepDash = (status, n) => status === FLOW_REP_DONE || status === 'Passed' ? '-' : n;
/* Lines sheet: [group, heading, value, kind, width]; kind: date · num (a count, blank when 0) · qty · st (a status) · late · sku */
const FLOW_REP_COLS = [
  ['Order', 'Plan date', x => x.planned, 'date', 13.5], ['Order', 'Order no', x => x.orderNo, '', 13], ['Order', 'Order date', x => x.orderDate, 'date', 13.5], ['Order', 'Channel', x => x.channel, '', 12],
  ['Product', 'SKU', x => x.sku, 'sku', 14], ['Product', 'Category', x => x.category, '', 16], ['Product', 'Sub-category', x => x.subCategory, '', 15], ['Product', 'Parent ASIN', x => x.parent, '', 14],
  ['Product', 'Colour', x => x.colour, '', 15], ['Product', 'Size', x => x.size, '', 12], ['Product', 'Fabric', x => x.fabric, '', 12], ['Product', 'Process', x => x.process, '', 12],
  ['Qty', 'Ordered', x => x.pcs, 'qty', 12],
  ['Printing', 'Printing', x => x.print.status, 'st', 15], ['Printing', 'Printer', x => x.print.printer, '', 15],
  ['Cutting', 'Cutting', x => x.cut.status, 'st', 15], ['Cutting', 'Cut', x => flowRepDash(x.cut.status, x.cut.cut), 'num', 12], ['Cutting', 'Cut, in store', x => x.cut.store, 'num', 13.4],
  ['Stitching', 'Stitching', x => x.stitch.status, 'st', 15], ['Stitching', 'Given', x => flowRepDash(x.stitch.status, x.stitch.given), 'num', 12], ['Stitching', 'Received', x => x.stitch.received, 'num', 12],
  ['QC', 'QC', x => x.qc.status, 'st', 15], ['QC', 'Passed', x => flowRepDash(x.qc.status, x.qc.passed), 'num', 12], ['QC', 'Rejected', x => x.qc.rejected, 'num', 12],
  ['Press', 'Press', x => x.press.status, 'st', 15], ['Press', 'Pressed', x => flowRepDash(x.press.status, x.press.pressed), 'num', 12],
  ['Dates', 'Due', x => x.due, 'date', 13.5], ['Dates', 'Exp. completion', x => x.completion, 'date', 13.5], ['Dates', 'Days late', x => x.late || '', 'late', 12],
  ['Dates', 'Last moved', x => x.moved && x.moved.day, 'date', 13.5], ['Dates', 'Last step', x => x.moved && x.moved.step, '', 24]];
/** The Summary sheet's rows: one a SKU — how many ordered, how many completed, how many still pending (Ravi, 28 Oct: "what SKU,
 * how many completed and how many ordered"), on how many lines, how many of them late. */
function flowRepSkus(lines) {
  const m = new Map();
  lines.forEach(x => { const e = m.get(x.sku) || m.set(x.sku, { sku: x.sku, lines: 0, pcs: 0, completed: 0, late: 0 }).get(x.sku);
    e.lines++; e.pcs += +x.pcs || 0; e.completed += +x.completed || 0; if (x.late > 0) e.late++; });
  return [...m.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map(e => Object.assign(e, { pending: Math.max(0, e.pcs - e.completed) }));
}
/** The Summary as the first report had it — a pivot: Row Labels, the sums beside them, Grand Total at the foot. */
function flowRepPivot(lines) {
  const sk = flowRepSkus(lines), H = ['Row Labels (SKU)', 'Ordered', 'Completed', 'Pending', 'Lines', 'Late lines'];
  const head = { b: 1, fill: 'DDEBF7', bb: 1 }, n = sk.length, tot = k => sk.reduce((a, e) => a + e[k], 0);
  const num = (v, st) => ({ v, st: Object.assign({ fmt: 3 }, st || {}) });
  return { name: 'Summary', freeze: { x: 1, y: 1 }, widths: [22, 12, 12, 12, 10, 11], merges: [], heights: {}, filter: `A1:F${n + 1}`,
    rows: [H.map((v, i) => ({ v, st: Object.assign({ h: i ? 'right' : 'left' }, head) }))]
      .concat(sk.map(e => [{ v: e.sku, st: { b: 1 } }, num(e.pcs), num(e.completed), num(e.pending), num(e.lines), num(e.late, e.late > 0 ? { b: 1, color: 'A32D2D' } : {})]))
      .concat([[{ v: 'Grand Total', st: head }].concat(['pcs', 'completed', 'pending', 'lines', 'late'].map(k => num(tot(k), head)))]) };
}

/** A sheet as Ravi's v6 lays it out: row 1 the totals of the counts (SUBTOTAL, so a filter re-adds them), row 2 the groups,
 * row 3 the headings with the filter, then the rows; a thick line where each group starts; late lines tinted on the Lines
 * sheet. Cells come back as { v, f, st } — st is a style the writer turns into Excel's. */
function flowRepGrid(name, cols, items, o) {
  o = o || {};
  const n = items.length, last = 3 + Math.max(n, 1), starts = new Set(cols.map((c, i) => (i === 0 || cols[i - 1][0] !== c[0]) ? i : -1).filter(i => i >= 0));
  const sumCol = c => c[3] === 'num' || c[3] === 'qty';
  const edge = i => ({ bl: starts.has(i) || cols[i][3] === 'sku', br: cols[i][3] === 'sku' });
  const tot = cols.map((c, i) => i === 0 ? { v: 'Total (shown lines)', st: { b: 1, fill: 'F1EFE8' } }
    : sumCol(c) ? { f: `SUBTOTAL(109,${soColName(i)}4:${soColName(i)}${last})`, st: { b: 1, fill: 'F1EFE8', fmt: 3 } } : { v: '', st: { fill: 'F1EFE8' } });
  const grp = cols.map((c, i) => { const g = FLOW_REP_GRP[c[0]] || ['F1EFE8', '444441'];
    return starts.has(i) ? { v: c[0], st: { b: 1, color: g[1], fill: g[0], h: 'center' } } : { v: '', st: { fill: g[0] } }; });
  const head = cols.map((c, i) => { const g = FLOW_REP_GRP[c[0]] || ['F1EFE8', '444441'];
    return { v: c[1], st: Object.assign({ b: 1, color: g[1], fill: g[0], bb: 1, wrap: 1, v: 'bottom', h: ['num', 'qty', 'late'].includes(c[3]) ? 'right' : 'left' }, edge(i)) }; });
  const body = items.map(x => { const tint = o.tint && x.late > 0 ? 'FCEBEB' : '';
    return cols.map((c, i) => { let v = c[2](x); const e = edge(i), base = Object.assign({ fill: tint }, e);
      if (c[3] === 'st') { const t = FLOW_REP_TONE[v] || FLOW_REP_TONE['Not started']; return { v, st: { fill: t[0], color: t[1], b: t[2] || 0, h: 'center', bl: 1 } }; }
      if (c[3] === 'date') return { v: v ? flowRepSerial(v) : '', st: Object.assign(base, { fmt: 165, h: 'left' }) };
      if (v === '-') return { v, st: Object.assign(base, { h: 'right' }) };
      if (c[3] === 'num' || c[3] === 'qty') return { v: +v > 0 ? +v : '', st: Object.assign(base, { fmt: 3 }) };
      if (c[3] === 'late') return { v: +v > 0 ? +v : '', st: Object.assign(base, { fmt: 1 }, +v > 0 ? { b: 1, color: 'A32D2D' } : {}) };
      if (c[3] === 'sku') return { v, st: Object.assign(base, { b: 1 }) };
      return { v: v == null ? '' : v, st: base }; }); });
  return { name, rows: [tot, grp, head].concat(body), freeze: { x: o.xSplit == null ? 5 : o.xSplit, y: 3 }, widths: cols.map(c => c[4] || 12),
    merges: [...starts].map(i => { let j = i; while (j + 1 < cols.length && cols[j + 1][0] === cols[i][0]) j++; return soColName(i) + '2' + (j > i ? ':' + soColName(j) + '2' : ''); }),
    filter: `A3:${soColName(cols.length - 1)}${last}`, heights: { 3: 30 } };
}
/** A day as Excel counts it (days from 30 Dec 1899), so it sorts and filters as a date. */
const flowRepSerial = iso => { const q = String(iso).slice(0, 10).split('-').map(Number); return q.length === 3 && q[0] ? Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(1899, 11, 30)) / 864e5) : ''; };
/** The workbook: Lines (Ravi's v6 sheet) and Summary (the pivot by SKU). No late-lines sheet (Ravi, 28 Oct). */
function flowRepSheets(lines) {
  return [flowRepGrid('Lines', FLOW_REP_COLS, lines, { tint: true }), flowRepPivot(lines)];
}

/* The app's own writer (no library). Styles are made as the cells ask for them: { b, color, fill, bl, br, bb, fmt, h, v, wrap }. */
function flowRepXlsx(sheets) {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = [], xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], seen = {};
  const idx = (list, xml) => { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; };
  const side = (e, thick) => thick ? `<${e} style="medium"><color rgb="FF888780"/></${e}>` : `<${e} style="thin"><color rgb="FFD3D1C7"/></${e}>`;
  const style = st => { st = st || {}; const k = JSON.stringify(st); if (seen[k] != null) return seen[k];
    const font = idx(fonts, `<font>${st.b ? '<b/>' : ''}<sz val="11"/>${st.color ? `<color rgb="FF${st.color}"/>` : ''}<name val="Calibri"/></font>`);
    const fill = st.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${st.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const border = idx(borders, '<border>' + side('left', st.bl) + side('right', st.br) + side('top') + side('bottom', st.bb) + '<diagonal/></border>');
    const al = st.h || st.v || st.wrap ? `<alignment${st.h ? ` horizontal="${st.h}"` : ''}${st.v ? ` vertical="${st.v}"` : ''}${st.wrap ? ' wrapText="1"' : ''}/>` : '';
    xfs.push(`<xf numFmtId="${st.fmt || 0}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`);
    return (seen[k] = xfs.length - 1); };
  const cell = (c, ref) => { const s = ` s="${style(c.st)}"`;
    if (c.f) return `<c r="${ref}"${s}><f>${soXml(c.f)}</f></c>`;
    if (typeof c.v === 'number' && isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
    const t = String(c.v == null ? '' : c.v); return t === '' ? `<c r="${ref}"${s}/>` : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`; };
  const ws = sh => { const fx = sh.freeze.x, fy = sh.freeze.y, tl = soColName(fx) + (fy + 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<sheetViews><sheetView zoomScale="90" zoomScaleNormal="90" workbookViewId="0"><pane${fx ? ` xSplit="${fx}"` : ''} ySplit="${fy}" topLeftCell="${tl}" activePane="${fx ? 'bottomRight' : 'bottomLeft'}" state="frozen"/></sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/><cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + sh.rows.map((r, i) => `<row r="${i + 1}"${sh.heights[i + 1] ? ` ht="${sh.heights[i + 1]}" customHeight="1"` : ''}>${r.map((c, j) => cell(c, soColName(j) + (i + 1))).join('')}</row>`).join('') + '</sheetData>'
    + `<autoFilter ref="${sh.filter}"/>` + (sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')   // an empty list is refused by Excel
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>'; };
  const sheetXml = sheets.map(ws);   // first, so every style the cells ask for exists before the style sheet is written
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="165" formatCode="dd-mmm-yy"/></numFmts>'
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs></styleSheet>`;
  const q = n => "'" + String(n).replace(/'/g, "''") + "'";
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')
      + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${soXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets><definedNames>'
      + sheets.map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${soXml(q(s.name))}!${s.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>`
        + `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${soXml(q(s.name))}!$1:$3</definedName>`).join('')
      + '</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ...sheetXml.map((x, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', x]),
    ['xl/styles.xml', styles]]);
}

/* ---- the panel ---- */
const FLOW_REP_ON = [['planned', 'Planned in PPC (plans first saved on these days)'], ['came', 'Came into PPC (orders dated these days)'], ['waiting', 'Still waiting in PPC (today — the dates do not apply)']];
function flowRepSoDue() { try { return typeof SOX !== 'undefined' && SOX.rows && typeof ordDueIndex === 'function' ? ordDueIndex() : null; } catch (e) { return null; } }
function flowRepNow() { return flowRepLines({ from: FLOW_REP.from, to: FLOW_REP.to, on: FLOW_REP.on, soDue: flowRepSoDue() }); }
function flowRepBody() {
  const lines = flowRepNow(), tot = lines.reduce((a, x) => a + x.pcs, 0), skus = new Set(lines.map(x => x.sku)).size;
  const late = lines.filter(x => x.late > 0).length, orders = new Set(lines.map(x => x.orderNo)).size, old = lines.filter(x => x.planned && !x.plannedKnown).length;
  const rng = FLOW_REP.on === 'waiting' ? 'waiting in PPC today' : `${flowRepShow(FLOW_REP.from)} – ${flowRepShow(FLOW_REP.to)}`;
  const groups = []; FLOW_REP_COLS.forEach(c => { const l = groups[groups.length - 1]; if (l && l[0] === c[0]) l[1]++; else groups.push([c[0], 1]); });
  const show = (v, c) => v === '-' ? v : c[3] === 'date' ? flowRepShow(v) : (c[3] === 'num' || c[3] === 'late') ? (+v > 0 ? nf(+v) : '') : c[3] === 'qty' ? nf(+v || 0) : (v == null ? '' : v);
  const td = (v, c, x) => { const t = c[3] === 'st' && FLOW_REP_TONE[v];
    return `<td style="white-space:nowrap${['num', 'qty', 'late'].includes(c[3]) ? ';text-align:right' : ''}${t ? `;text-align:center;background:#${t[0]};color:#${t[1]}${t[2] ? ';font-weight:700' : ''}` : x.late > 0 ? ';background:#fcebeb' : ''}${c[3] === 'late' && x.late > 0 ? ';color:#a32d2d;font-weight:700' : ''}${c[3] === 'sku' ? ';font-weight:600' : ''}">${esc(show(v, c))}</td>`; };
  return `<div style="display:flex;gap:22px;flex-wrap:wrap;background:var(--hover,#f8fafc);border-radius:8px;padding:8px 12px;margin:6px 0 10px">
      <div><b style="font-size:15px">${nf(lines.length)}</b> lines</div><div><b style="font-size:15px">${nf(skus)}</b> SKUs</div><div><b style="font-size:15px">${nf(tot)}</b> pieces</div><div><b style="font-size:15px">${nf(orders)}</b> orders</div>
      <div><b style="font-size:15px;${late ? 'color:var(--bad)' : ''}">${nf(late)}</b> late</div><div><b>${esc(rng)}</b></div></div>`
    + (FLOW_REP.soErr ? `<div class="muted" style="font-size:12px;margin-bottom:6px">⚠ ${esc(FLOW_REP.soErr)}</div>` : '')
    + (old ? `<div class="muted" style="font-size:12px;margin-bottom:6px">${nf(old)} plan(s) were saved before 28 Oct 2026: their plan date is the day they were last saved.</div>` : '')
    + (lines.length ? `<div style="overflow:auto;max-height:46vh"><table class="xl" style="font-size:12px"><thead>`
      + `<tr>${groups.map(([n, k]) => { const g = FLOW_REP_GRP[n] || ['F1EFE8', '444441']; return `<th colspan="${k}" style="text-align:center;background:#${g[0]};color:#${g[1]}">${esc(n)}</th>`; }).join('')}</tr>`
      + `<tr>${FLOW_REP_COLS.map(c => { const g = FLOW_REP_GRP[c[0]] || ['F1EFE8', '444441']; return `<th style="white-space:nowrap;background:#${g[0]};color:#${g[1]}">${esc(c[1])}</th>`; }).join('')}</tr></thead><tbody>`
      + lines.slice(0, 300).map(x => `<tr>${FLOW_REP_COLS.map(c => td(c[2](x), c, x)).join('')}</tr>`).join('')
      + `</tbody></table></div>${lines.length > 300 ? `<div class="muted" style="font-size:12px">Showing 300 of ${nf(lines.length)} lines — the Excel has them all.</div>` : ''}`
      : '<div class="muted" style="padding:14px 0">No lines for these days.</div>');
}
function flowRepPaint() {
  const box = $('flRepOut'); if (box) box.innerHTML = flowRepBody();
  document.querySelectorAll('[data-flrepq]').forEach(b => { const r = flowRepRanges()[+b.dataset.flrepq]; b.className = r && r[1] === FLOW_REP.from && r[2] === FLOW_REP.to ? '' : 'ghost'; });
}
async function flowRepOpen() {
  if (!flowRepAllowed()) return;
  if (!FLOW_REP.from) { const r = flowRepRanges()[2]; FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; }
  const sel = (id, list, v) => `<select id="${id}" style="width:auto">${list.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  ptOpenDialog({
    title: 'PPC report', wide: true,
    subtitle: 'Pick the days, check the lines, download the Excel (Lines, Summary).',
    html: `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${flowRepRanges().map((r, i) => `<button type="button" class="ghost" data-flrepq="${i}" style="width:auto;padding:4px 12px;font-size:12.5px">${esc(r[0])}</button>`).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px">
        From <input type="date" id="flRepFrom" value="${esc(FLOW_REP.from)}" style="width:auto"> To <input type="date" id="flRepTo" value="${esc(FLOW_REP.to)}" style="width:auto">
        <span style="margin-left:8px">Report on</span> ${sel('flRepOn', FLOW_REP_ON, FLOW_REP.on)}</div>
      <div id="flRepOut">${flowRepBody()}</div>`,
    saveLabel: 'Download Excel',
    onSave: async () => {
      const lines = flowRepNow();
      if (!lines.length) return 'Nothing to download for these days.';
      const bytes = flowRepXlsx(flowRepSheets(lines));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = 'ppc-report-' + (FLOW_REP.on === 'waiting' ? 'waiting-' + dToday() : FLOW_REP.from + '-to-' + FLOW_REP.to) + '.xlsx';
      a.click(); URL.revokeObjectURL(a.href);
      return '';
    },
  });
  const day = () => { const f = $('flRepFrom').value, t = $('flRepTo').value; if (f && t) { FLOW_REP.from = f <= t ? f : t; FLOW_REP.to = f <= t ? t : f; } flowRepPaint(); };
  $('flRepFrom').onchange = day; $('flRepTo').onchange = day;
  $('flRepOn').onchange = () => { FLOW_REP.on = $('flRepOn').value; flowRepPaint(); };
  document.querySelectorAll('[data-flrepq]').forEach(b => { b.onclick = () => { const r = flowRepRanges()[+b.dataset.flrepq];
    FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; $('flRepFrom').value = r[1]; $('flRepTo').value = r[2]; flowRepPaint(); }; });
  flowRepPaint();
  /* The sales orders' delivery dates: read once, only here, and only when no other screen has read them already. */
  if (typeof SOX !== 'undefined' && SOX.rows == null) {
    try { SOX.rows = ptList(await ptGet('pt_salesOrders')); FLOW_REP.soErr = ''; }
    catch (e) { FLOW_REP.soErr = 'Could not read the sales orders, so their due dates are missing here (' + (e.message || e) + ').'; }
    flowRepPaint();
  }
}
/** The toolbar button: on the Production flow screen, for admins and the Reports right. */
function flowRepBtn() { const b = $('flRep'); if (b && b.classList) b.classList.toggle('hide', !flowRepAllowed()); }
if ($('flRep')) $('flRep').onclick = () => { flowRepOpen().catch(e => { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not open the report: ' + (e.message || e); }); };
