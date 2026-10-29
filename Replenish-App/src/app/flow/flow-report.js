/* ================================================================
 * PPC REPORT (Ravi, 28 Oct: "a report system so that a person can download it on the basis of days or choosing the date
 * from calendar — this is the ppc report of it", in the layout of Sheet3 of his WIP workbook: one row a line, then the
 * Row Labels / Sum of PCS summary). Nothing is read for it but the sales orders' due dates: the lines, plans, print orders,
 * challans and Job Work issues are the ones the PPC screen has already read, so opening it costs the database nothing.
 *
 *   Plan date     the day the plan was FIRST saved (plan.firstAt, kept from 28 Oct). A plan saved before then has only its
 *                 last save (plan.at).
 *   Stages        (Ravi, 28 Oct, the design he approved): for each of Greige, RFD, Printing, Embroidery, Cutting, Job work,
 *                 QC and Finished a Status (Done / In progress / Not started / Not needed, in colour), the Pcs through it
 *                 ("-" before it starts) and its paper beside it (flowRepStages). A Stage board sheet says where work waits.
 *   Last moved    the last thing that happened to the line and its day (flowRepLastMoved).
 *   Completion date  the plan's Ready date — PPC must give one to save a plan (28 Oct).
 *   Due date      the sales order's delivery date; for a Shopify / online line, 5 working days from when it opened (the
 *                 made-to-order rule of Production to Shipping); for the rest (Amazon), the Ready date — Amazon gives none.
 *   Delay         today against the due date, for a line not yet made; a made line says "made".
 *   Who           admins, and whoever holds the Reports right.
 * ================================================================ */
const FLOW_REP = { from: '', to: '', on: 'planned', by: 'sku', soErr: '', gpo: null };
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
/** Who has the work: the printer (or embroiderer / outside vendor) on the plan, then the karigars Job Work issued it to. */
function flowRepWho(r, p) {
  const out = [];
  if (p && p.printer && (p.printer.name || p.printer.code)) out.push(p.printer.name || p.printer.code);
  if (p && p.emb && (p.emb.name || p.emb.code)) out.push(p.emb.name || p.emb.code);
  if (p && p.route === 'outsource' && String(p.outVendor || '').trim()) out.push(String(p.outVendor).trim());
  const kar = new Map();
  (PT.base || []).forEach(b => { const n = +(b && b.issuePieces) || 0;
    if (n > 0 && obUC(b.orderNo) === obUC(r.orderNo) && obUC(b.sku) === obUC(r.sku)) { const w = String(b.empName || '').trim() || 'karigar'; kar.set(w, (kar.get(w) || 0) + n); } });
  kar.forEach((n, w) => out.push(`${w} (${n})`));
  return out.join(', ');
}
/* THE STAGES OF A LINE (Ravi, 28 Oct: "one [column] to tell done / not done … if the process is not done show '-' … if the
 * process is work in progress show the actual count of pieces"). Each stage is { need, done }: need false = the line does
 * not go through it ("Not needed"); done = the pieces through it so far. A piece past a stage has been through it — a piece
 * cut was printed, one back from the karigar was cut — so each stage counts what any later stage has.
 *   Greige     pieces whose RFD cloth is in stock or already sent (Demand · RFD, flowRfdCover); greige is bought per fabric.
 *   RFD        pieces whose cloth has gone to the printer (printed lines, flowFabOwed), or is ready (cutting lines).
 *   Printing   printed pieces back.  Embroidery  embroidered pieces back.  Cutting  pieces cut.
 *   Job work   pieces back from the karigars.  QC  pieces passed.  Finished  in India stock / handed to shipping. */
const FLOW_REP_STAGES = [['greige', 'Greige', 'Greige PO'], ['rfd', 'RFD', 'RFD challan'], ['print', 'Printing', 'Print order'], ['emb', 'Embroidery', 'Emb challan'],
  ['cut', 'Cutting', ''], ['job', 'Job work', 'Karigar (pcs)'], ['qc', 'QC', ''], ['fin', 'Finished', '']];
function flowRepStages(r, s, p, cover) {
  const qty = +r.qty || 0, cap = n => Math.max(0, Math.min(qty, Math.floor((+n || 0) + 1e-9)));
  const no = { need: false, done: 0 }, at = n => ({ need: true, done: cap(n) });
  const fin = cap(s.india);
  if (!p) return { greige: no, rfd: no, print: no, emb: no, cut: no, job: no, qc: no, fin: at(fin) };
  const route = s.route, outside = route === 'outsource', embVen = route === 'emb' && flowEmbByVendor(p);
  const perPc = +(p.fabric && p.fabric.perPc) || (qty ? (+(p.fabric && p.fabric.metres) || 0) / qty : 0);
  const toPcs = m => perPc > 0 ? Math.ceil(m / perPc - 1e-9) : 0;
  const qc = Math.max(cap(s.made), fin), job = Math.max(cap(s.received), qc);
  const cut = Math.max(cap(s.cut), cap(s.issuedNet || 0), job);
  const printOn = flowPrinted(route) && !s.fromStock, print = Math.max(cap(s.back), cut);
  const emb = embVen ? Math.max(cap(s.embOk || 0), cut) : job;
  /* cloth: none for job work / outsourced, nor for cloth already in hand or a line made all from printed stock */
  const usesRfd = !outside && route !== 'jobwork' && !flowInHand(p) && !s.fromStock;
  let rfd = 0;
  if (usesRfd) {
    if (flowPrinted(route)) { const o = flowFabOwed(r, s); rfd = qty - (o.unit === 'pcs' ? Math.ceil(o.left - 1e-9) : toPcs(o.left)); }
    else rfd = (s.demand && s.demand.fabricReady) || s.cut > 0 || s.issued > 0 ? qty : qty - Math.ceil(qty * flowRemFrac(r, s) - 1e-9);
    rfd = Math.max(cap(rfd), printOn ? print : cut);
  }
  const c = cover && cover.line[s.key];
  const greige = rfd >= qty || !(c && c.short > 0) ? qty : Math.max(rfd, qty - toPcs(c.short));
  return {
    greige: usesRfd ? at(greige) : no, rfd: usesRfd ? at(rfd) : no, print: printOn ? at(print) : no, emb: route === 'emb' ? at(emb) : no,
    cut: s.cutReq && !outside ? at(cut) : no, job: outside || embVen ? no : at(job), qc: outside ? no : at(qc), fin: at(fin),
  };
}
/** "Done" · "In progress" · "Not started" · "Not needed" — and the pieces: the count while it is under way or done, "-" before. */
const flowRepStatus = (x, qty) => !x.need ? 'Not needed' : x.done >= qty && qty > 0 ? 'Done' : x.done > 0 ? 'In progress' : 'Not started';
const flowRepPcs = x => x.need && x.done > 0 ? x.done : '-';
/** The karigars Job Work issued the line to, with their pieces: "Ramesh (25), Suresh (15)". */
function flowRepKarigars(r) {
  const kar = new Map();
  (PT.base || []).forEach(b => { const n = +(b && b.issuePieces) || 0;
    if (n > 0 && obUC(b.orderNo) === obUC(r.orderNo) && obUC(b.sku) === obUC(r.sku)) { const w = String(b.empName || '').trim() || 'karigar'; kar.set(w, (kar.get(w) || 0) + n); } });
  return [...kar].map(([w, n]) => `${w} (${n})`).join(', ');
}
/** The open greige POs for a fabric (Greige Desk, read once when the report opens): newest first, at most two. */
function flowRepGreigePo(fabric) {
  const k = flowFabKey(fabric); if (!k) return '';
  return (FLOW_REP.gpo || []).filter(po => po && po.status !== 'cancelled' && !po.closed && (po.lines || []).some(l => l && flowFabKey(l.rfd) === k))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 2).map(po => po.poNo).filter(Boolean).join(', ');
}
/** The last thing that happened to the line, and when: the plan, its print order, a challan or printed cloth back, cutting,
 * a karigar issue or receipt, a QC check, the hand-over. */
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
  return best;
}

/** The report's lines: o = { from, to, on: planned|came|waiting, today, soDue }. Real orders only — never a TEST line. */
function flowRepLines(o) {
  const today = o.today || dToday(), soDue = o.soDue || null;
  const mdb = new Map(((typeof PTG !== 'undefined' && PTG.mdb) || []).map(m => [obUC(m && m.sku), m]));
  let cover = null; try { cover = flowRfdCover(); } catch (e) { cover = null; }   // the RFD stock against each line, as Demand shows it
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
    const route = p ? flowRouteOf(p) : '', fabric = String((p && p.fabric && p.fabric.name) || m.fabric || '');
    const docs = p ? flowDocsOf({ s }) : [], docOf = re => [...new Set(docs.filter(d => re.test(d.kind)).map(d => d.no))].join(', ');
    const st = flowRepStages(r, s, p, cover), mv = flowRepLastMoved(r, s, p);
    out.push({
      key: s.key, planned: first, plannedKnown: !!(p && p.firstAt), orderNo: String(r.orderNo || ''), orderDate: ptIsoDate(r.orderDate) || '',
      channel: flowRepChannel(r), sku: obUC(r.sku),
      category: String(m.articleType || r.articleType || ''), subCategory: String(m.subtype || m.articleSubtype || r.articleSubtype || ''),
      parent: String(m.parentAsin || ''), colour: String(m.color || r.color || ''), size: String(m.size || r.size || ''),
      fabric, pcs: +r.qty || 0, process: route ? ((FLOW_ROUTES.find(x => x[0] === route) || [])[2] || route) : '', who: flowRepWho(r, p),
      st, paper: { greige: st.greige.need && st.greige.done < (+r.qty || 0) ? flowRepGreigePo(fabric) : '', rfd: docOf(/challan/i), print: docOf(/^Print order/),
        emb: (s.embNos || []).join(', '), job: flowRepKarigars(r) },
      completion: p && p.dates && p.dates.ready ? String(p.dates.ready).slice(0, 10) : '',
      due: due.due, dueFrom: due.from, delay: dl.txt, late: dl.late, made, moved: mv,
      waitDays: s.bucket === 'ppc' && r.orderDate ? Math.max(0, flowRepDaysBetween(ptIsoDate(r.orderDate), today)) : 0,
    });
  });
  return out.sort((a, b) => (a.planned || a.orderDate).localeCompare(b.planned || b.orderDate) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));
}

/* THE LINE SHEET (Ravi, 28 Oct, the approved design): the line itself, then each stage — Status, Pcs, and its paper beside
 * it — then the dates. [group, heading, value, style]; style 'st' colours a stage status, 'late' a late delay. */
const FLOW_REP_COLS = [
  ['', 'Plan date', x => flowRepShow(x.planned)], ['', 'Order no', x => x.orderNo], ['', 'Order date', x => flowRepShow(x.orderDate)], ['', 'Channel', x => x.channel],
  ['', 'SKU', x => x.sku], ['', 'Category', x => x.category], ['', 'Sub-category', x => x.subCategory], ['', 'Parent ASIN', x => x.parent],
  ['', 'Colour', x => x.colour], ['', 'Size', x => x.size], ['', 'Fabric', x => x.fabric], ['', 'PCS', x => x.pcs], ['', 'Process', x => x.process]]
  .concat(...FLOW_REP_STAGES.map(([k, name, paper]) => [[name, 'Status', x => flowRepStatus(x.st[k], x.pcs), 'st'], [name, 'Pcs', x => flowRepPcs(x.st[k])]]
    .concat(paper ? [[name, paper, x => x.paper[k] || '']] : [])))
  .concat([['Dates', 'Completion', x => flowRepShow(x.completion)], ['Dates', 'Due', x => flowRepShow(x.due)], ['Dates', 'Delay', x => x.delay, 'late'],
    ['Dates', 'Last moved', x => x.moved && x.moved.day ? flowRepShow(x.moved.day) + ' · ' + x.moved.what : '']]);
const FLOW_REP_BY = [['sku', 'SKU'], ['order', 'SKU and order'], ['day', 'Day and SKU'], ['who', 'Printer / karigar'], ['category', 'Category']];
/** The summary: Row Labels / Sum of PCS (and lines, late lines), grouped as asked. */
function flowRepSummary(lines, by) {
  const label = x => by === 'order' ? x.sku + ' · ' + x.orderNo : by === 'day' ? flowRepShow(x.planned || x.orderDate) + ' · ' + x.sku
    : by === 'who' ? (x.who || '(nobody yet)') : by === 'category' ? (x.category || '(no category)') : x.sku;
  const m = new Map();
  lines.forEach(x => { const k = label(x), e = m.get(k) || { label: k, pcs: 0, lines: 0, late: 0 }; e.pcs += x.pcs; e.lines++; if (x.late > 0) e.late++; m.set(k, e); });
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}
/** THE STAGE BOARD: where the work is stuck — per stage, its lines not started / in progress / done, the pieces still to come
 * through it, and the late lines waiting there (a line waits at the first stage it needs that is not done). */
function flowRepBoard(lines) {
  return FLOW_REP_STAGES.map(([k, name]) => {
    const e = { name, not: 0, wip: 0, done: 0, waiting: 0, late: 0 };
    lines.forEach(x => { const t = x.st[k]; if (!t || !t.need) return;
      const sv = flowRepStatus(t, x.pcs); if (sv === 'Done') e.done++; else if (sv === 'In progress') e.wip++; else e.not++;
      e.waiting += Math.max(0, x.pcs - t.done);
      const at = FLOW_REP_STAGES.find(([kk]) => x.st[kk].need && x.st[kk].done < x.pcs);
      if (x.late > 0 && at && at[0] === k) e.late++; });
    return e;
  });
}

/* The workbook — the app's own writer (no library): numbers as numbers, two heading rows with the stage names over their
 * columns, each status in its colour, the headings frozen. A cell is a value, or { v, s } with a style below. */
const FLOW_REP_XS = { head: 1, group: 2, Done: 3, 'In progress': 4, 'Not started': 5, 'Not needed': 6, late: 7, body: 8 };
function flowRepXlsx(sheets) {
  const cell = (c, ref) => {
    const v = c && typeof c === 'object' ? c.v : c, s = c && typeof c === 'object' && c.s ? ` s="${c.s}"` : ` s="${FLOW_REP_XS.body}"`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    const t = String(v == null ? '' : v);
    return t === '' ? `<c r="${ref}"${s}/>` : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`; };
  const ws = sh => { const fz = sh.freeze || 1, rows = sh.rows, hd = rows[fz - 1] || [];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${fz}" topLeftCell="A${fz + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + '<cols>' + hd.map((h, i) => { const t = String(h && typeof h === 'object' ? h.v : h);
      return `<col min="${i + 1}" max="${i + 1}" width="${(sh.widths || {})[i] || Math.min(30, Math.max(9, t.length + 3))}" customWidth="1"/>`; }).join('') + '</cols>'
    + '<sheetData>' + rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, soColName(j) + (i + 1))).join('')}</row>`).join('') + '</sheetData>'
    + ((sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') + '</worksheet>'; };
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const font = (c, b) => `<font>${b ? '<b/>' : ''}<sz val="11"/>${c ? `<color rgb="FF${c}"/>` : ''}<name val="Calibri"/></font>`;
  const fill = c => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`;
  const xf = (f, fl, al) => `<xf numFmtId="0" fontId="${f}" fillId="${fl}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' : '/>'}`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<fonts count="8">${font('', 0)}${font('', 1)}${font('FFFFFF', 1)}${font('166534', 1)}${font('92400E', 1)}${font('991B1B', 0)}${font('9CA3AF', 0)}${font('B91C1C', 1)}</fonts>`
    + `<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['E5E7EB', '1F2937', 'DCFCE7', 'FEF3C7', 'FEE2E2', 'F3F4F6'].map(fill).join('')}</fills>`
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>' + ['left', 'right', 'top', 'bottom'].map(e => `<${e} style="thin"><color rgb="FFD1D5DB"/></${e}>`).join('') + '<diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xf(1, 2)}${xf(2, 3, 1)}${xf(3, 4, 1)}${xf(4, 5, 1)}${xf(5, 6, 1)}${xf(6, 7, 1)}${xf(7, 0)}${xf(0, 0)}</cellXfs></styleSheet>`;
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')
      + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${soXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ...sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', ws(s)]),
    ['xl/styles.xml', styles]]);
}
/** The workbook's three sheets — Lines (two heading rows), Stage board, Summary by SKU — as rows of cells. */
function flowRepSheets(lines, by) {
  const H = FLOW_REP_XS, sum = flowRepSummary(lines, by), tot = lines.reduce((a, x) => a + x.pcs, 0), byName = (FLOW_REP_BY.find(b => b[0] === by) || FLOW_REP_BY[0])[1];
  /* the stage names over their columns, one merged cell each */
  const g = FLOW_REP_COLS.map(c => ({ v: c[0], s: c[0] ? H.group : H.head })), merges = [];
  for (let i = 0; i < FLOW_REP_COLS.length;) { let j = i; while (j + 1 < FLOW_REP_COLS.length && FLOW_REP_COLS[j + 1][0] === FLOW_REP_COLS[i][0]) j++;
    if (FLOW_REP_COLS[i][0] && j > i) { merges.push(soColName(i) + '1:' + soColName(j) + '1'); for (let k = i + 1; k <= j; k++) g[k] = { v: '', s: H.group }; }
    i = j + 1; }
  const body = x => FLOW_REP_COLS.map(c => { const v = c[2](x);
    return c[3] === 'st' ? { v, s: H[v] } : c[3] === 'late' && x.late > 0 ? { v, s: H.late } : v; });
  const board = flowRepBoard(lines);
  return [
    { name: 'Lines', freeze: 2, merges, rows: [g, FLOW_REP_COLS.map(c => ({ v: c[1], s: H.head }))].concat(lines.map(body)) },
    { name: 'Stage board', rows: [['Stage', 'Not started (lines)', 'In progress (lines)', 'Done (lines)', 'Pcs waiting', 'Late lines waiting here'].map(v => ({ v, s: H.head }))]
      .concat(board.map(e => [{ v: e.name, s: H.head }, e.not, e.wip, e.done, e.waiting, e.late > 0 ? { v: e.late, s: H.late } : e.late])) },
    { name: 'Summary', rows: [['Row Labels (' + byName + ')', 'Sum of PCS', 'Lines', 'Late lines'].map(v => ({ v, s: H.head }))]
      .concat(sum.map(e => [e.label, e.pcs, e.lines, e.late]), [[{ v: 'Grand Total', s: H.head }, { v: tot, s: H.head }, { v: lines.length, s: H.head }, { v: lines.filter(x => x.late > 0).length, s: H.head }]]) }];
}

/* ---- the panel ---- */
const FLOW_REP_ON = [['planned', 'Planned in PPC (plans first saved on these days)'], ['came', 'Came into PPC (orders dated these days)'], ['waiting', 'Still waiting in PPC (today — the dates do not apply)']];
const FLOW_REP_TINT = { Done: 'background:#dcfce7;color:#166534;font-weight:700', 'In progress': 'background:#fef3c7;color:#92400e;font-weight:700',
  'Not started': 'background:#fee2e2;color:#991b1b', 'Not needed': 'background:#f3f4f6;color:#9ca3af' };
function flowRepSoDue() { try { return typeof SOX !== 'undefined' && SOX.rows && typeof ordDueIndex === 'function' ? ordDueIndex() : null; } catch (e) { return null; } }
function flowRepNow() { return flowRepLines({ from: FLOW_REP.from, to: FLOW_REP.to, on: FLOW_REP.on, soDue: flowRepSoDue() }); }
function flowRepBody() {
  const lines = flowRepNow(), sum = flowRepSummary(lines, FLOW_REP.by), tot = lines.reduce((a, x) => a + x.pcs, 0);
  const late = lines.filter(x => x.late > 0).length, orders = new Set(lines.map(x => x.orderNo)).size, old = lines.filter(x => x.planned && !x.plannedKnown).length;
  const rng = FLOW_REP.on === 'waiting' ? 'waiting in PPC today' : `${flowRepShow(FLOW_REP.from)} – ${flowRepShow(FLOW_REP.to)}`;
  const groups = []; FLOW_REP_COLS.forEach(c => { const l = groups[groups.length - 1]; if (l && l[0] === c[0]) l[1]++; else groups.push([c[0], 1]); });
  const td = (v, c, x) => `<td style="white-space:nowrap${typeof v === 'number' ? ';text-align:right' : ''}${c[3] === 'st' ? ';text-align:center;' + (FLOW_REP_TINT[v] || '') : ''}${c[3] === 'late' && x.late > 0 ? ';color:var(--bad);font-weight:600' : ''}">${esc(typeof v === 'number' ? nf(v) : v)}</td>`;
  return `<div style="display:flex;gap:22px;flex-wrap:wrap;background:var(--hover,#f8fafc);border-radius:8px;padding:8px 12px;margin:6px 0 10px">
      <div><b style="font-size:15px">${nf(sum.length)}</b> rows</div><div><b style="font-size:15px">${nf(tot)}</b> pieces</div><div><b style="font-size:15px">${nf(orders)}</b> orders</div>
      <div><b style="font-size:15px;${late ? 'color:var(--bad)' : ''}">${nf(late)}</b> late</div><div><b>${esc(rng)}</b></div></div>`
    + (FLOW_REP.soErr ? `<div class="muted" style="font-size:12px;margin-bottom:6px">⚠ ${esc(FLOW_REP.soErr)}</div>` : '')
    + (old ? `<div class="muted" style="font-size:12px;margin-bottom:6px">${nf(old)} plan(s) were saved before 28 Oct 2026: their plan date is the day they were last saved.</div>` : '')
    + (lines.length ? `<div style="overflow:auto;max-height:46vh"><table class="xl" style="font-size:12px"><thead>`
      + `<tr>${groups.map(([n, k]) => `<th colspan="${k}" style="text-align:center;${n ? 'background:#1f2937;color:#fff' : ''}">${esc(n)}</th>`).join('')}</tr>`
      + `<tr>${FLOW_REP_COLS.map(c => `<th style="white-space:nowrap">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>`
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
    subtitle: 'Pick the days, check the lines, download the Excel (Lines, Stage board, Summary).',
    html: `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${flowRepRanges().map((r, i) => `<button type="button" class="ghost" data-flrepq="${i}" style="width:auto;padding:4px 12px;font-size:12.5px">${esc(r[0])}</button>`).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px">
        From <input type="date" id="flRepFrom" value="${esc(FLOW_REP.from)}" style="width:auto"> To <input type="date" id="flRepTo" value="${esc(FLOW_REP.to)}" style="width:auto">
        <span style="margin-left:8px">Report on</span> ${sel('flRepOn', FLOW_REP_ON, FLOW_REP.on)} <span>Summary by</span> ${sel('flRepBy', FLOW_REP_BY, FLOW_REP.by)}</div>
      <div id="flRepOut">${flowRepBody()}</div>`,
    saveLabel: 'Download Excel',
    onSave: async () => {
      const lines = flowRepNow();
      if (!lines.length) return 'Nothing to download for these days.';
      const bytes = flowRepXlsx(flowRepSheets(lines, FLOW_REP.by));
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
  $('flRepBy').onchange = () => { FLOW_REP.by = $('flRepBy').value; flowRepPaint(); };
  document.querySelectorAll('[data-flrepq]').forEach(b => { b.onclick = () => { const r = flowRepRanges()[+b.dataset.flrepq];
    FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; $('flRepFrom').value = r[1]; $('flRepTo').value = r[2]; flowRepPaint(); }; });
  flowRepPaint();
  /* Read once, only here: the sales orders' delivery dates (when no other screen has read them), and the Greige Desk's POs
   * (its own node — the desk keeps them inside its sealed screen) for the Greige PO beside Greige. A read refused leaves
   * that column blank, nothing else. */
  const reads = [];
  if (typeof SOX !== 'undefined' && SOX.rows == null) reads.push(ptGet('pt_salesOrders').then(v => { SOX.rows = ptList(v); FLOW_REP.soErr = ''; })
    .catch(e => { FLOW_REP.soErr = 'Could not read the sales orders, so their due dates are missing here (' + (e.message || e) + ').'; }));
  if (FLOW_REP.gpo == null) reads.push(ptGet('pt_gdTest/gpo').then(v => { FLOW_REP.gpo = Object.values(v || {}); }).catch(() => { FLOW_REP.gpo = []; }));
  if (reads.length) { await Promise.all(reads); flowRepPaint(); }
}
/** The toolbar button: on the Production flow screen, for admins and the Reports right. */
function flowRepBtn() { const b = $('flRep'); if (b && b.classList) b.classList.toggle('hide', !flowRepAllowed()); }
if ($('flRep')) $('flRep').onclick = () => { flowRepOpen().catch(e => { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not open the report: ' + (e.message || e); }); };
