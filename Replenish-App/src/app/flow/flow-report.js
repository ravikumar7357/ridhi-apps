/* ================================================================
 * PPC REPORT (Ravi, 28 Oct: "a report system so that a person can download it on the basis of days or choosing the date
 * from calendar — this is the ppc report of it", in the layout of Sheet3 of his WIP workbook: one row a line, then the
 * Row Labels / Sum of PCS summary). Nothing is read for it but the sales orders' due dates: the lines, plans, print orders,
 * challans and Job Work issues are the ones the PPC screen has already read, so opening it costs the database nothing.
 *
 *   Plan date     the day the plan was FIRST saved (plan.firstAt, kept from 28 Oct). A plan saved before then has only its
 *                 last save (plan.at).
 *   Stages        where every piece of the line is NOW, adding up to its order (flowRepWhere, 25 Nov): at RFD (with Send to
 *                 printer / On RFD beside it), at the printer, at embroidery, printed in store, to cut, cut in store, with the
 *                 karigars, received (to QC), passed (to press), pressed (to Finished Goods) — blank once they have moved on.
 *   Completed     in Finished Goods or handed to shipping (25 Nov; it was "pressed").
 *   Sheets        Lines — row 1 adds the counts with SUBTOTAL (a filter re-adds them), row 2 names the groups, row 3 has
 *                 the filters — and Summary, a pivot by SKU: ordered, completed, pending, lines, late lines, Grand Total.
 *   Last moved    the last thing that happened to the line, its day and its step (flowRepLastMoved).
 *   Exp. completion  the plan's Ready date — PPC must give one to save a plan (28 Oct).
 *   Due date      the sales order's delivery date; for a Shopify / online line, 5 working days from when it opened (the
 *                 made-to-order rule of Production to Shipping); for the rest (Amazon), the Ready date — Amazon gives none.
 *   Delay         today against the due date, for a line not yet completed; a completed line says "Completed".
 *   Page          PPC → Report shows the same lines, made by flowRepLines, as a dashboard and the two sheets (ppc-one.js).
 *   SHP report    the same sheet for the Shopify orders the SHP board owns, read from the board (flowRepShpFill) — the toolbar's
 *                 PPC report button is a drop-down: PPC report · SHP board report; each Shopify line is in one of the two, never both.
 *   Who           admins, and whoever holds the Reports right.
 * ================================================================ */
const FLOW_REP = { from: '', to: '', on: 'planned', kind: 'ppc', soErr: '' };
const flowRepAllowed = () => !!(ME.admin || (ME.tabs || []).includes('rep'));
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
  if (made) return { txt: 'Completed', late: 0 };
  if (!due) return { txt: 'no date set', late: 0 };
  const d = flowRepDaysBetween(due, today);
  if (d > 0) return { txt: `LATE · ${d} day${d > 1 ? 's' : ''}`, late: d };
  if (d === 0) return { txt: 'due today', late: 0 };
  return { txt: `${-d} day${d < -1 ? 's' : ''} left`, late: 0 };
}
/* WHERE EVERY PIECE OF A LINE IS (Ravi, 25 Nov, of the report file: "I want it to be acurate in its report"). The 29 Oct columns
 * were each worked out on their own, so they could disagree: 35 lines said Completed while their pieces still sat at Press, 15
 * named a stage whose column was blank, and a line's columns did not add up to its order. Now one count, from the furthest step
 * back — a piece in Finished Goods was pressed, a pressed one passed QC, a passed one came back from a karigar, and so on — so a
 * step with no entry of its own (issued with no Cutting Data row) is not left holding pieces that went on. Each place is the
 * difference of two steps, so the places of a line ALWAYS add up to its order:
 *   To plan · At RFD (cloth not sent yet) · At printer · At embroidery (a vendor's) · Printed, in store · To cut · Cut, in store
 *   (to give a karigar) · With karigar · Received, to QC · Passed QC, to press · Pressed, to Finished Goods · With the outside
 *   maker · Completed.
 * COMPLETED = in Finished Goods (India stock) or handed to shipping (Ravi, 25 Nov — it was "pressed", 29 Oct): a pressed piece
 * not yet counted in waits at Press. The page (PPC → Report) and the Excel are made from these same figures. */
const FLOW_REP_PLACES = [['plan', 'To plan', 'PPC'], ['rfd', 'At RFD', 'RFD'], ['prn', 'At printer', 'Printing'], ['emb', 'At embroidery', 'Embroidery'],
  ['prnStore', 'Printed, in store', 'Printed, in store'], ['toCut', 'To cut', 'Cutting'], ['cutStore', 'Cut, in store', 'Cut, in store'], ['kar', 'With karigar', 'Karigar'],
  ['recv', 'Received, to QC', 'QC'], ['qc', 'Passed QC, to press', 'Press'], ['press', 'Pressed, to Finished Goods', 'To Finished Goods'],
  ['out', 'With the outside maker', 'Outside maker'], ['done', 'Completed', 'Completed']];
/** A line's pieces by place (FLOW_REP_PLACES keys); they add up to the line's quantity. */
function flowRepWhere(r, s, p) {
  const qty = +r.qty || 0, cap = n => Math.max(0, Math.min(qty, Math.floor((+n || 0) + 1e-9))), w = {};
  FLOW_REP_PLACES.forEach(([k]) => { w[k] = 0; });
  if (!qty) return w;
  const done = (r.handedAt || r.shopDoneAt) ? qty : cap(s.india);
  w.done = done;
  if (!p) { w.plan = qty - done; return w; }
  const route = flowRouteOf(p);
  if (route === 'outsource') { w.out = qty - done; return w; }
  /* the steps every made line goes through, the furthest first */
  const pressed = Math.max(cap(r.pressed), done), passed = Math.max(cap(s.qc), pressed);
  /* SCRAPPED PIECES (Ravi, 27 Nov): only good pieces count as cut and received — a piece QC scrapped came back, but is gone */
  const received = s.recounted ? s.receivedAll - s.rej.qc : s.received;
  const issued = Math.max(cap(s.issuedNet), passed), back = Math.min(issued, Math.max(cap(received), passed));
  const cut = s.cutReq ? Math.max(cap(s.recounted ? s.cutGood : s.cut), issued) : issued;
  w.press = pressed - done; w.qc = passed - pressed; w.recv = back - passed; w.kar = issued - back;
  if (s.cutReq) w.cutStore = cut - issued;
  /* …and the new pieces owed for them show as to cut (to give a karigar where nothing is cut), wherever the line's cloth stands */
  let redo = s.recounted ? flowScrapRedo(r, s) : 0;
  const placed = () => {
    const to = s.cutReq ? 'toCut' : 'cutStore';
    ['prnStore', 'rfd', 'prn', 'emb'].forEach(k => { const n = Math.min(redo, w[k]); w[k] -= n; w[to] += n; redo -= n; });
    return w;
  };
  const printOn = flowPrinted(route) && !s.fromStock && !flowInHand(p);
  if (!printOn) {
    /* no printer: printed cloth already in the store (from stock, or in hand), cloth to cut, or straight to the karigars */
    const rest = qty - cut, ready = !!(s.demand && s.demand.fabricReady) || cut > 0;
    if (route === 'jobwork' || !s.cutReq) w.cutStore += rest;
    else if (flowPrinted(route)) w.prnStore = rest;
    else if (ready) w.toCut = rest; else w.rfd = rest;
    return placed();
  }
  /* printed by a printer: what went to them (the challans, or the printer's own count where no print order stands), what came back */
  const embVendor = route === 'emb' && !s.embDept, after = s.cutReq ? cut : issued;
  const embDone = embVendor ? Math.max(cap(s.embOk), after) : 0, printed = Math.max(cap(s.back), after, embDone);
  /* sent: the cloth the challans took, as a share of the line (a challan line counts as "given" whole, so its metres decide);
   * the printer's own count only where neither a print order nor a challan stands */
  let left = null;
  try { const o = flowFabOwed(r, s); if (o) left = o.unit === 'pcs' ? Math.round(+o.left || 0) : o.need > 0 ? Math.round(qty * (+o.left || 0) / o.need) : 0; } catch (e) { left = null; }
  const sent = Math.max(left == null ? 0 : qty - Math.min(qty, Math.max(0, left)), s.po || s.challan ? 0 : cap(s.given), printed);
  w.rfd = qty - sent; w.prn = sent - printed;
  /* a vendor's embroidery: printed cloth not back embroidered is at embroidery (or about to go); back embroidered, it is to cut */
  if (embVendor) { w.emb = printed - embDone; w.toCut = embDone - after; }
  /* printed on the item itself, never cut: ready for a karigar, under the name PPC gives it (fix 10, Ravi 26 Nov) */
  else if (!s.cutReq) w.cutStore += printed - after;
  else w.prnStore = printed - after;
  return placed();
}
/** The line's process: the earliest place still holding pieces (where it is held up); Completed once every piece is. */
function flowRepProcess(w, qty, mto) {
  if (qty > 0 && w.done >= qty) return 'Completed';
  const at = FLOW_REP_PLACES.find(([k]) => k !== 'done' && w[k] > 0);
  return at ? (at[0] === 'press' && mto ? 'To shipping' : at[2]) : '';
}
/* The last thing that happened to the line, in the floor's words — every register, pressing and Finished Goods included (25 Nov:
 * a line pressed after its plan still said "Planned"). The plan counts on the day it was FIRST saved: saving it again is not work. */
const FLOW_REP_STEP = { plan: 'Planned', 'print order': 'Print order', 'RFD challan': 'RFD challan', 'printed back': 'Back from printer', cut: 'Cut',
  'karigar issue': 'Given to karigar', 'karigar back': 'Received from karigar', QC: 'QC', press: 'Pressed', fg: 'Into Finished Goods', handed: 'Completed' };
function flowRepLastMoved(r, s, p) {
  let best = { day: '', what: '' };
  const see = (d, what) => { const day = String(ptIsoDate(d) || '').slice(0, 10); if (/^\d{4}-\d\d-\d\d$/.test(day) && day >= best.day) best = { day, what }; };
  const mine = x => x && obUC(x.orderNo) === obUC(r.orderNo) && obUC(x.sku) === obUC(r.sku);
  if (p) see(flowRepDay(p.firstAt || p.at), 'plan');
  Object.values(FLOW.po || {}).forEach(o => { if (o && !o.cancelled && o.items && o.items[s.key]) see(o.date, 'print order'); });
  Object.values(FLOW.ch || {}).forEach(c => { if (!c || c.cancelled || !(c.lines || []).some(l => l && l.key === s.key)) return;
    see(c.date, 'RFD challan'); Object.values(c.receipts || {}).forEach(rc => { if (rc && rc.items && +rc.items[s.key] > 0) see(rc.date, 'printed back'); }); });
  (PT.cut || []).forEach(x => { if (mine(x)) see(x.cutDate, 'cut'); });
  (PT.base || []).forEach(x => { if (!mine(x)) return; see(x.issueDate, 'karigar issue'); if (+x.receivedPieces > 0) see(x.receivingDate, 'karigar back'); });
  ((typeof QC !== 'undefined' && QC.checks) || []).forEach(x => { if (mine(x)) see(x.date, 'QC'); });
  ((typeof PTG !== 'undefined' && PTG.press) || []).forEach(x => { if (mine(x) && +x.pieces > 0) see(x.entryDate || x.addedAt, 'press'); });
  ((typeof FGI !== 'undefined' && FGI.rows) || []).forEach(x => { if (mine(x) && !x.test && x.txnType === 'RECEIVE') see(x.createdAt || x.date, 'fg'); });
  if (r.handedAt) see(r.handedAt, 'handed');
  return { day: best.day, step: FLOW_REP_STEP[best.what] || best.what };
}

/** PRINTED BY (Ravi, 30 Oct: "in Printed by add the printer name if assigned"): the printer assigned to the line — on its PPC plan,
 * else the one its RFD challan went to — at whatever stage the line is; blank when no printer is assigned. */
const flowRepPrintedBy = (s, p) => String((p && p.printer && (p.printer.name || p.printer.code)) || (s.challan && s.challan.vendor) || '').trim();
/** RFD (Ravi, 29 Oct: "RFD — Send to printer and On RFD, a drop-down column; when the RFD challan is made it turns to Send to
 * printer by itself, otherwise On RFD"), shown only while cloth of the line is still at RFD. */
const FLOW_REP_RFD = ['Send to printer', 'On RFD'];
/** THE SHP REPORT (Ravi, 30 Oct: "a drop-down in the PPC report button where we can switch to the SHP report — the report of the SHP
 * board in the same format"). The Shopify orders the SHP board owns are read from the board's own stage figures (shpbStages) into
 * the same places: printer receive → At printer · printed back, to cut → Printed, in store · to cut → To cut · cut, to issue → Cut,
 * in store · issued, not back → With karigar · back, to pass → Received · passed, to press → Passed QC · pressed, shipping to accept
 * → Press. Completed = what shipping has accepted (25 Nov, as the PPC lines: handed over, not just pressed). Exp. completion = the
 * board's ready date; a line with nothing moving shows the board's own status (In production, OOS, Need from printer, Planned). */
function flowRepShpFill(x, st, o) {
  o = o || {};
  const q0 = +x.pcs || 0, printerLine = st.prcA > 0, w = {};
  FLOW_REP_PLACES.forEach(([k]) => { w[k] = 0; });
  x.printedBy = String(o.printer || x.printedBy || '').trim();
  Object.assign(w, { plan: st.planW, prn: st.prcW, prnStore: printerLine ? st.cutW : 0, toCut: printerLine ? 0 : st.cutW, cutStore: st.issW,
    kar: st.recW, recv: st.qcW, qc: st.prsW, press: st.handW, done: Math.min(q0, st.handD) });
  x.at = w; x.completed = w.done; x.made = q0 > 0 && w.done >= q0;
  if (o.ready) x.completion = String(o.ready).slice(0, 10);
  const pr = flowRepProcess(w, q0, true);
  x.process = pr === 'PPC' ? 'To plan' : pr || o.status || 'In production';
  return x;
}
/** The report's lines: o = { from, to, on: planned|came|waiting, today, soDue }. Real orders only — never a TEST line. */
function flowRepLines(o) {
  const today = o.today || dToday(), soDue = o.soDue || null, shp = o.kind === 'shp';
  const mdb = new Map(((typeof PTG !== 'undefined' && PTG.mdb) || []).map(m => [obUC(m && m.sku), m]));
  const lines = FLOW_REAL ? ordLines() : flowMtoLines();
  const inRange = d => !!d && d >= o.from && d <= o.to;
  const out = [];
  (lines || []).forEach(r => {
    if (!r || r.__t) return;
    /* each Shopify line in ONE report: the SHP board's in the SHP report, the rest in PPC's */
    const board = flowBoardOwns(r) && (typeof shpbIsMine !== 'function' || shpbIsMine(r));
    if (shp ? !board : board) return;
    const s = flowState(r), p = s.plan || null;
    const first = p ? flowRepDay(p.firstAt || p.at) : '';
    const keep = shp ? (o.on === 'waiting' || inRange(ptIsoDate(r.orderDate)))
      : o.on === 'waiting' ? s.bucket === 'ppc'
      : o.on === 'came' ? inRange(ptIsoDate(r.orderDate))
      : !!p && inRange(first);
    if (!keep) return;
    const m = mdb.get(obUC(r.sku)) || cutSkuOf(r.sku) || {}, qty = +r.qty || 0, mto = typeof flowIsMto === 'function' && flowIsMto(r);
    const w = flowRepWhere(r, s, p), made = qty > 0 && w.done >= qty;
    const due = flowRepDue(r, p, soDue), dl = flowRepDelay(due.due, made, today);
    const x = {
      key: s.key, planned: first, plannedKnown: !!(p && p.firstAt), orderNo: String(r.orderNo || ''), orderDate: ptIsoDate(r.orderDate) || '',
      channel: flowRepChannel(r), sku: obUC(r.sku),
      category: String(m.articleType || r.articleType || ''), subCategory: String(m.subtype || m.articleSubtype || r.articleSubtype || ''),
      parent: String(m.parentAsin || ''), colour: String(m.color || r.color || ''), size: String(m.size || r.size || ''),
      fabric: String((p && p.fabric && p.fabric.name) || m.fabric || ''), pcs: qty,
      printedBy: flowRepPrintedBy(s, p), completion: p && p.dates && p.dates.ready ? String(p.dates.ready).slice(0, 10) : '',
      due: due.due, dueFrom: due.from, delay: dl.txt, late: dl.late, made, at: w, completed: w.done, moved: flowRepLastMoved(r, s, p),
      rejected: s.recounted ? s.rej.scrap : 0,
      waitDays: s.bucket === 'ppc' && r.orderDate ? Math.max(0, flowRepDaysBetween(ptIsoDate(r.orderDate), today)) : 0,
      process: flowRepProcess(w, qty, mto) };
    if (shp) {
      const st = typeof shpbStages === 'function' ? shpbStages([r]) : o.shpStages && o.shpStages(r);
      if (st) flowRepShpFill(x, st, { printer: typeof shpbPrinterOf === 'function' ? shpbPrinterOf(r) : '', ready: typeof shpbReadyOf === 'function' ? shpbReadyOf(r).date : '',
        status: typeof shpbStatusInfo === 'function' ? shpbStatusInfo(r, st).label : '' });
      const d2 = flowRepDelay(x.due, x.made, today); x.delay = d2.txt; x.late = d2.late;
      if (o.on === 'waiting' && x.process === 'Completed') return;   // still open: what is not completed yet
    }
    /* RFD (29 Oct): Send to printer once its RFD challan is made, else On RFD — only while cloth of it is still at RFD */
    x.rfd = x.at.rfd > 0 && p && flowPrinted(flowRouteOf(p)) ? FLOW_REP_RFD[s.challan ? 0 : 1] : '';
    /* planned to finish after it is due (25 Nov: 218 lines of the 19–25 Nov file, said nowhere) */
    x.plannedLate = !made && x.completion && x.due && x.completion > x.due ? flowRepDaysBetween(x.due, x.completion) : 0;
    /* a completed line's last step says Completed (Ravi, 29 Oct), whatever its last register entry was */
    if (x.process === 'Completed' && x.moved && x.moved.day) x.moved = { day: x.moved.day, step: 'Completed' };
    out.push(x);
  });
  return out.sort((a, b) => (a.planned || a.orderDate).localeCompare(b.planned || b.orderDate) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));
}

/* ---- the workbook, cell for cell as Ravi's v6 ---- */
/* The groups over the columns: [name, fill, text colour] — the colours of his sheet. */
const FLOW_REP_GRP = { Order: ['E6F1FB', '0C447C'], Product: ['F1EFE8', '444441'], Qty: ['EEEDFE', '3C3489'], Pieces: ['EEEDFE', '3C3489'],
  RFD: ['E6F1FB', '0C447C'], Printing: ['FBEAF0', '72243E'], Cutting: ['FAEEDA', '633806'], Karigar: ['E1F5EE', '085041'], QC: ['EAF3DE', '27500A'], Press: ['EEEDFE', '3C3489'], Dates: ['FAECE7', '712B13'] };
/* Lines sheet: [group, heading, value, kind, width, list]; kind: date · num (a count, blank when 0) · qty · late · sku · list (a drop-down
 * of the values in the sixth place). Each stage column is a place of flowRepWhere, so a line's stage columns and Completed add up to
 * Ordered (25 Nov). */
const FLOW_REP_COLS = [
  ['Order', 'Plan date', x => x.planned, 'date', 13.5], ['Order', 'Order no', x => x.orderNo, '', 13], ['Order', 'Order date', x => x.orderDate, 'date', 13.5], ['Order', 'Channel', x => x.channel, '', 12],
  ['Product', 'SKU', x => x.sku, 'sku', 14], ['Product', 'Category', x => x.category, '', 16], ['Product', 'Sub-category', x => x.subCategory, '', 15], ['Product', 'Parent ASIN', x => x.parent, '', 14],
  ['Product', 'Colour', x => x.colour, '', 15], ['Product', 'Size', x => x.size, '', 12], ['Product', 'Fabric', x => x.fabric, '', 12], ['Product', 'Process', x => x.process, '', 14], ['Product', 'Printed by', x => x.printedBy, '', 18],
  ['Qty', 'Ordered', x => x.pcs, 'qty', 11], ['Qty', 'Completed', x => x.completed, 'num', 11.5],
  ['RFD', 'RFD', x => x.rfd, 'list', 15, FLOW_REP_RFD], ['RFD', 'At RFD', x => x.at.rfd, 'num', 10],
  ['Printing', 'At printer', x => x.at.prn, 'num', 11], ['Printing', 'Embroidery', x => x.at.emb, 'num', 12], ['Printing', 'Printing in store', x => x.at.prnStore, 'num', 13],
  ['Cutting', 'Cutting', x => x.at.toCut, 'num', 12], ['Cutting', 'Cut, in store', x => x.at.cutStore, 'num', 13.4],
  /* "Stitching" is called Karigar (Ravi, 29 Oct) — the pieces with the karigars now */
  ['Karigar', 'Karigar', x => x.at.kar, 'num', 12], ['Karigar', 'Received', x => x.at.recv, 'num', 12],
  ['QC', 'QC', x => x.at.qc, 'num', 12], ['Press', 'Press', x => x.at.press, 'num', 12],
  ['Dates', 'Due', x => x.due, 'date', 13.5], ['Dates', 'Exp. completion', x => x.completion, 'date', 13.5], ['Dates', 'Days late', x => x.process === 'Completed' ? 'Completed' : (x.late || ''), 'late', 12],
  ['Dates', 'Last moved', x => x.moved && x.moved.day, 'date', 13.5], ['Dates', 'Last step', x => x.moved && x.moved.step, '', 24]];
/* REJECTED (Ravi, 27 Nov): the pieces scrapped on a line, beside Completed. Not a place — a line's stages still add up to its
 * order without it. The column is there only when some line of the report has scrapped pieces. */
const FLOW_REP_REJ_COL = ['Qty', 'Rejected', x => x.rejected, 'num', 11];
function flowRepCols(lines) {
  if (!lines.some(x => x.rejected > 0)) return FLOW_REP_COLS;
  const after = FLOW_REP_COLS.findIndex(c => c[1] === 'Completed') + 1;
  return FLOW_REP_COLS.slice(0, after).concat([FLOW_REP_REJ_COL], FLOW_REP_COLS.slice(after));
}
/** The Summary sheet's rows: one a SKU — how many ordered, how many completed, how many still pending (Ravi, 28 Oct: "what SKU,
 * how many completed and how many ordered"), on how many lines, how many of them late. */
function flowRepSkus(lines) {
  const m = new Map();
  lines.forEach(x => { const e = m.get(x.sku) || m.set(x.sku, { sku: x.sku, lines: 0, pcs: 0, completed: 0, late: 0 }).get(x.sku);
    e.lines++; e.pcs += +x.pcs || 0; e.completed += +x.completed || 0; if (x.late > 0) e.late++; });
  return [...m.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map(e => Object.assign(e, { pending: Math.max(0, e.pcs - e.completed) }));
}
/* THE REPORT PAGE'S FIGURES (Ravi, 25 Nov: "make it work in such a way its really impressive and show really good way of data"):
 * the headline counts, where all the pieces are, when the open lines fall due (week by week, the late ones first), and how each
 * channel and category is doing — every figure added up from the same lines as the two sheets, so page, sheets and Excel agree. */
const flowRepWeekOf = iso => { const q = String(iso).split('-').map(Number), d = new Date(q[0], q[1] - 1, q[2]); return flowRepAdd(iso, -((d.getDay() + 6) % 7)); };
function flowRepDash(lines, today) {
  const add = (xs, f) => xs.reduce((t, x) => t + (+f(x) || 0), 0), open = lines.filter(x => !x.made), late = open.filter(x => x.late > 0);
  const places = FLOW_REP_PLACES.map(([k, label, proc]) => ({ k, label, proc, pcs: add(lines, x => x.at && x.at[k]) })).filter(e => e.pcs > 0);
  /* open lines by the week they fall due: the past weeks are late; no date set kept apart */
  const thisWeek = flowRepWeekOf(today), wk = new Map();
  open.forEach(x => { const k = x.due ? flowRepWeekOf(x.due) : ''; const e = wk.get(k) || wk.set(k, { week: k, lines: 0, pcs: 0, late: !!k && k < thisWeek }).get(k);
    e.lines++; e.pcs += Math.max(0, x.pcs - x.completed); if (x.late > 0) e.late = true; });
  const weeks = [...wk.values()].sort((a, b) => (a.week || '9').localeCompare(b.week || '9'));
  const group = f => { const m = new Map(); lines.forEach(x => { const k = f(x) || 'Other';
      const e = m.get(k) || m.set(k, { name: k, lines: 0, ordered: 0, completed: 0, late: 0 }).get(k);
      e.lines++; e.ordered += x.pcs; e.completed += x.completed; if (x.late > 0) e.late++; });
    return [...m.values()].sort((a, b) => b.ordered - a.ordered); };
  const proc = new Map(); lines.forEach(x => { const k = x.process || '—', e = proc.get(k) || proc.set(k, { name: k, lines: 0, pcs: 0 }).get(k); e.lines++; e.pcs += x.pcs; });
  return { lines: lines.length, orders: new Set(lines.map(x => x.orderNo)).size, skus: new Set(lines.map(x => x.sku)).size,
    ordered: add(lines, x => x.pcs), completed: add(lines, x => x.completed), late: late.length, latePcs: add(late, x => x.pcs - x.completed),
    plannedLate: open.filter(x => x.plannedLate > 0).length, noDue: open.filter(x => !x.due).length, places, weeks,
    channels: group(x => x.channel), categories: group(x => x.category), processes: [...proc.values()] };
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
      if (c[3] === 'date') return { v: v ? flowRepSerial(v) : '', st: Object.assign(base, { fmt: 165, h: 'left' }) };
      if (c[3] === 'num' || c[3] === 'qty') return { v: +v > 0 ? +v : '', st: Object.assign(base, { fmt: 3 }) };
      if (c[3] === 'late') return typeof v === 'string' && v ? { v, st: base } : { v: +v > 0 ? +v : '', st: Object.assign(base, { fmt: 1 }, +v > 0 ? { b: 1, color: 'A32D2D' } : {}) };
      if (c[3] === 'sku') return { v, st: Object.assign(base, { b: 1 }) };
      return { v: v == null ? '' : v, st: base }; }); });
  return { name, rows: [tot, grp, head].concat(body), freeze: { x: o.xSplit == null ? 5 : o.xSplit, y: 3 }, widths: cols.map(c => c[4] || 12),
    merges: [...starts].map(i => { let j = i; while (j + 1 < cols.length && cols[j + 1][0] === cols[i][0]) j++; return soColName(i) + '2' + (j > i ? ':' + soColName(j) + '2' : ''); }),
    filter: `A3:${soColName(cols.length - 1)}${last}`, heights: { 3: 30 },
    lists: cols.map((c, i) => c[3] === 'list' ? { ref: `${soColName(i)}4:${soColName(i)}${last}`, values: c[5] } : null).filter(Boolean) };
}
/** A day as Excel counts it (days from 30 Dec 1899), so it sorts and filters as a date. */
const flowRepSerial = iso => { const q = String(iso).slice(0, 10).split('-').map(Number); return q.length === 3 && q[0] ? Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(1899, 11, 30)) / 864e5) : ''; };
/** The workbook: Lines (Ravi's v6 sheet) and Summary (the pivot by SKU). No late-lines sheet (Ravi, 28 Oct). */
function flowRepSheets(lines) {
  return [flowRepGrid('Lines', flowRepCols(lines), lines, { tint: true }), flowRepPivot(lines)];
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
    + ((sh.lists || []).length ? `<dataValidations count="${sh.lists.length}">${sh.lists.map(l => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${l.ref}"><formula1>"${soXml(l.values.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>` : '')
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
const FLOW_REP_SHP_ON = [['came', 'Orders dated these days'], ['waiting', 'Still open (today — the dates do not apply)']];
const flowRepOnList = () => FLOW_REP.kind === 'shp' ? FLOW_REP_SHP_ON : FLOW_REP_ON;
function flowRepSoDue() { try { return typeof SOX !== 'undefined' && SOX.rows && typeof ordDueIndex === 'function' ? ordDueIndex() : null; } catch (e) { return null; } }
function flowRepNow() { return flowRepLines({ from: FLOW_REP.from, to: FLOW_REP.to, on: FLOW_REP.on, kind: FLOW_REP.kind, soDue: flowRepSoDue() }); }
function flowRepBody() {
  const lines = flowRepNow(), tot = lines.reduce((a, x) => a + x.pcs, 0), skus = new Set(lines.map(x => x.sku)).size;
  const late = lines.filter(x => x.late > 0).length, orders = new Set(lines.map(x => x.orderNo)).size, old = lines.filter(x => x.planned && !x.plannedKnown).length;
  const rng = FLOW_REP.on === 'waiting' ? (FLOW_REP.kind === 'shp' ? 'open on the SHP board today' : 'waiting in PPC today') : `${flowRepShow(FLOW_REP.from)} – ${flowRepShow(FLOW_REP.to)}`;
  const cols = flowRepCols(lines), groups = []; cols.forEach(c =>{ const l = groups[groups.length - 1]; if (l && l[0] === c[0]) l[1]++; else groups.push([c[0], 1]); });
  const show = (v, c) => c[3] === 'date' ? flowRepShow(v) : (c[3] === 'num' || c[3] === 'late') ? (typeof v === 'string' && v ? v : +v > 0 ? nf(+v) : '') : c[3] === 'qty' ? nf(+v || 0) : (v == null ? '' : v);
  const td = (v, c, x) => `<td style="white-space:nowrap${['num', 'qty', 'late'].includes(c[3]) ? ';text-align:right' : ''}${x.late > 0 ? ';background:#fcebeb' : ''}${c[3] === 'late' && x.late > 0 ? ';color:#a32d2d;font-weight:700' : ''}${c[3] === 'sku' ? ';font-weight:600' : ''}">${esc(show(v, c))}</td>`;
  return `<div style="display:flex;gap:22px;flex-wrap:wrap;background:var(--hover,#f8fafc);border-radius:8px;padding:8px 12px;margin:6px 0 10px">
      <div><b style="font-size:15px">${nf(lines.length)}</b> lines</div><div><b style="font-size:15px">${nf(skus)}</b> SKUs</div><div><b style="font-size:15px">${nf(tot)}</b> pieces</div><div><b style="font-size:15px">${nf(orders)}</b> orders</div>
      <div><b style="font-size:15px;${late ? 'color:var(--bad)' : ''}">${nf(late)}</b> late</div><div><b>${esc(rng)}</b></div></div>`
    + (FLOW_REP.soErr ? `<div class="muted" style="font-size:12px;margin-bottom:6px">⚠ ${esc(FLOW_REP.soErr)}</div>` : '')
    + (old ? `<div class="muted" style="font-size:12px;margin-bottom:6px">${nf(old)} plan(s) were saved before 28 Oct 2026: their plan date is the day they were last saved.</div>` : '')
    + (lines.length ? `<div style="overflow:auto;max-height:46vh"><table class="xl" style="font-size:12px"><thead>`
      + `<tr>${groups.map(([n, k]) => { const g = FLOW_REP_GRP[n] || ['F1EFE8', '444441']; return `<th colspan="${k}" style="text-align:center;background:#${g[0]};color:#${g[1]}">${esc(n)}</th>`; }).join('')}</tr>`
      + `<tr>${cols.map(c => { const g = FLOW_REP_GRP[c[0]] || ['F1EFE8', '444441']; return `<th style="white-space:nowrap;background:#${g[0]};color:#${g[1]}">${esc(c[1])}</th>`; }).join('')}</tr></thead><tbody>`
      + lines.slice(0, 300).map(x => `<tr>${cols.map(c => td(c[2](x), c, x)).join('')}</tr>`).join('')
      + `</tbody></table></div>${lines.length > 300 ? `<div class="muted" style="font-size:12px">Showing 300 of ${nf(lines.length)} lines — the Excel has them all.</div>` : ''}`
      : '<div class="muted" style="padding:14px 0">No lines for these days.</div>');
}
function flowRepPaint() {
  const box = $('flRepOut'); if (box) box.innerHTML = flowRepBody();
  document.querySelectorAll('[data-flrepq]').forEach(b => { const r = flowRepRanges()[+b.dataset.flrepq]; b.className = r && r[1] === FLOW_REP.from && r[2] === FLOW_REP.to ? '' : 'ghost'; });
}
async function flowRepOpen(kind) {
  if (!flowRepAllowed()) return;
  FLOW_REP.kind = kind === 'shp' ? 'shp' : 'ppc';
  if (!flowRepOnList().some(([k]) => k === FLOW_REP.on)) FLOW_REP.on = flowRepOnList()[0][0];
  if (!FLOW_REP.from) { const r = flowRepRanges()[2]; FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; }
  const sel = (id, list, v) => `<select id="${id}" style="width:auto">${list.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  ptOpenDialog({
    title: FLOW_REP.kind === 'shp' ? 'SHP board report' : 'PPC report', wide: true,
    subtitle: 'Pick the days, check the lines, download the Excel (Lines, Summary).',
    html: `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${flowRepRanges().map((r, i) => `<button type="button" class="ghost" data-flrepq="${i}" style="width:auto;padding:4px 12px;font-size:12.5px">${esc(r[0])}</button>`).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px">
        From <input type="date" id="flRepFrom" value="${esc(FLOW_REP.from)}" style="width:auto"> To <input type="date" id="flRepTo" value="${esc(FLOW_REP.to)}" style="width:auto">
        <span style="margin-left:8px">Report on</span> ${sel('flRepOn', flowRepOnList(), FLOW_REP.on)}</div>
      <div id="flRepOut">${flowRepBody()}</div>`,
    saveLabel: 'Download Excel',
    onSave: async () => {
      const lines = flowRepNow();
      if (!lines.length) return 'Nothing to download for these days.';
      flowRepDownload(lines, FLOW_REP);
      return '';
    },
  });
  const day = () => { const f = $('flRepFrom').value, t = $('flRepTo').value; if (f && t) { FLOW_REP.from = f <= t ? f : t; FLOW_REP.to = f <= t ? t : f; } flowRepPaint(); };
  $('flRepFrom').onchange = day; $('flRepTo').onchange = day;
  $('flRepOn').onchange = () => { FLOW_REP.on = $('flRepOn').value; flowRepPaint(); };
  /* the SHP board report reads the board's own records (ready dates, press entries) once */
  if (FLOW_REP.kind === 'shp' && typeof shpbLoad === 'function') { try { await shpbLoad(); } catch (e) { /* the report says what it has */ } flowRepPaint(); }
  document.querySelectorAll('[data-flrepq]').forEach(b => { b.onclick = () => { const r = flowRepRanges()[+b.dataset.flrepq];
    FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; $('flRepFrom').value = r[1]; $('flRepTo').value = r[2]; flowRepPaint(); }; });
  flowRepPaint();
  if (await flowRepSoLoad()) flowRepPaint();
}
/** The Excel of some lines (Lines and Summary), named for the report and its days: o = { kind, on, from, to }. The dialog and
 *  the PPC → Report page both download through here, so the file is the same from either. */
function flowRepDownload(lines, o) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([flowRepXlsx(flowRepSheets(lines))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = (o.kind === 'shp' ? 'shp-report-' : 'ppc-report-') + (o.on === 'waiting' ? 'waiting-' + dToday() : (o.from || 'start') + '-to-' + (o.to || dToday())) + '.xlsx';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
/** The sales orders' delivery dates: read once, only for a report, and only when no other screen has read them already. Says
 *  true when it read (so the caller draws again); a failed read leaves the due dates out and says why in FLOW_REP.soErr. */
async function flowRepSoLoad() {
  if (typeof SOX === 'undefined' || SOX.rows != null) return false;
  try { SOX.rows = ptList(await ptGet('pt_salesOrders')); FLOW_REP.soErr = ''; }
  catch (e) { FLOW_REP.soErr = 'Could not read the sales orders, so their due dates are missing here (' + (e.message || e) + ').'; }
  return true;
}
/** The toolbar button — a drop-down (Ravi, 30 Oct: "I want the dropdown where I encircled"): PPC report · SHP board report.
 *  On the Production flow screen, for admins and the Reports right. */
function flowRepBtn() { const b = $('flRepWrap'); if (b && b.classList) b.classList.toggle('hide', !flowRepAllowed()); }
if ($('flRep')) {
  const menu = $('flRepMenu');
  $('flRep').onclick = e => { if (e && e.stopPropagation) e.stopPropagation(); if (menu && menu.classList) menu.classList.toggle('hide'); };
  document.querySelectorAll('[data-flrepkind]').forEach(b => { b.onclick = () => { if (menu && menu.classList) menu.classList.add('hide');
    flowRepOpen(b.dataset.flrepkind).catch(e => { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not open the report: ' + (e.message || e); }); }; });
  if (typeof document.addEventListener === 'function') document.addEventListener('click', e => { if (menu && menu.classList && !(e.target && e.target.closest && e.target.closest('#flRepWrap'))) menu.classList.add('hide'); });
}
