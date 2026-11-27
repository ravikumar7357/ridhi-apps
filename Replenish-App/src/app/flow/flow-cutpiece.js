/* ================= CUT PIECES: CHALLAN → CUT TO SIZE → PRINTER (Vishesh, 27 Nov) =================
 *
 * The "Cut pieces" lines of the Send to printer card are cut before they go. Ticked lines make a Cut Pieces Challan; they
 * show in the Greige Desk's Cut to size column as Waiting to cut → (Piece Ready for Cut) → Ready for cut → (Cut done) →
 * Cut → (Send to printer) → in transit, until the printer presses "Cloth received". No approval. The cloth leaves RFD on
 * shelf when the challan is made, so the later printer challan (ch.fromCut) takes nothing more from the shelf.
 *
 * ONE RECORD PER ORDER LINE, so a product can never be in two cutting records at once: pt_flowDemand/<line>/cutPc =
 *   { no, status, orderNo, orderDate, sku, article, item, fabric, size, pcs, perPc, metres, printer, at, by,
 *     ready, cutAt, challan }
 * Challan numbers are claimed at pt_gdTest/cutch/<no>. The stock rows are the desk's (GD.cutIssue / GD.cutReturn).
 *
 * Behind the switch cutPieces (off): priority order, the download, this flow and the desk's transit column. Records that
 * already exist are honoured whatever the switch says, so no PC can send the same cloth twice.
 * Errors: every save is stock, so a refusal or failure is said in words and nothing is guessed. The priority reads are quiet
 * (console line; lines then show "No priority"). */
function cutPiecesOn() {
  try { return localStorage.getItem('cutPieces') === '1'; } catch (e) { return false; }
}

/* ---- priority: the order line's own P1–P4, else the SKU's tag, else none (which goes last) ---- */
async function flowPriLoad() {
  try {
    if (typeof SOX !== 'undefined' && !SOX.rows) SOX.rows = ptList(await ptGet('pt_salesOrders'));
    if (!PTE.priority) PTE.priority = (await ptGet('pt_skuPriority')) || {};
  } catch (e) { console.warn(`Priority could not be read (${e.message || e}) — lines show "No priority".`); }
}
const flowPriClean = v => { const s = String((v && typeof v === 'object' ? v.priority || v.value : v) || '').trim().toUpperCase(); return /^P[1-4]$/.test(s) ? s : ''; };
function flowPri(orderNo, sku) {
  const no = obUC(orderNo), code = obUC(sku);
  const so = ((typeof SOX !== 'undefined' && SOX.rows) || []).find(o => o && obUC(o._id) === no);
  const own = ((so && so.lines) || []).filter(l => l && obUC(l.sku) === code).map(l => flowPriClean(l.priority)).filter(Boolean).sort()[0];
  return own || flowPriClean(((typeof PTE !== 'undefined' && PTE.priority) || {})[code]);
}
const flowPriRank = p => (p ? +p.slice(1) : 9);
const flowPriText = p => p || 'No priority';
/** P1 → P4 → none; inside one priority the oldest order first; an order's lines stay together, placed by its most urgent. */
function flowPriSort(list, of) {
  const best = new Map();
  list.forEach(x => { const o = of(x), k = String(o.orderNo), r = flowPriRank(o.priority); if (!best.has(k) || r < best.get(k)) best.set(k, r); });
  return list.slice().sort((a, b) => {
    const x = of(a), y = of(b);
    return best.get(String(x.orderNo)) - best.get(String(y.orderNo))
      || String(x.orderDate || '').localeCompare(String(y.orderDate || '')) || String(x.orderNo).localeCompare(String(y.orderNo))
      || flowPriRank(x.priority) - flowPriRank(y.priority);
  });
}

/* ---- the records ---- */
const FLOW_CP_LABEL = { wait: 'Waiting to cut', ready: 'Ready for cut', cut: 'Cut', sending: 'Going to the printer', sent: 'Sent to printer' };
/** The line's record while it is still ours: null once it has gone to a printer (unless that challan was cancelled). */
function flowCpActive(key) {
  const r = (((typeof FLOW !== 'undefined' && FLOW.dem) || {})[key] || {}).cutPc;
  if (!r) return null;
  if (r.status === 'sending') return flowCpSending(key, r);
  if (r.status !== 'sent') return r;
  const ch = (FLOW.ch || {})[r.challan];
  return ch && ch.cancelled ? Object.assign({}, r, { status: 'cut' }) : null;
}
/** A send that was cut short (page closed): gone if its challan was written, else 'cut' again after ten minutes. */
const FLOW_CP_SEND_MS = 600e3;
function flowCpSending(key, r) {
  const written = Object.values(FLOW.ch || {}).some(c => c && !c.cancelled && c.fromCut === r.no && c.at >= r.sendingAt && (c.lines || []).some(l => l.key === key));
  if (written) return null;
  return Date.now() - Date.parse(r.sendingAt) > FLOW_CP_SEND_MS ? Object.assign({}, r, { status: 'cut' }) : r;
}
/** The pieces of one fabric in Cut to size, most urgent first. */
function flowCpList(fabric) {
  const F = flowFabKey(fabric);
  const list = Object.keys((typeof FLOW !== 'undefined' && FLOW.dem) || {}).map(key => ({ key, rec: flowCpActive(key) }))
    .filter(x => x.rec && flowFabKey(x.rec.fabric) === F)
    .map(x => Object.assign({}, x.rec, { key: x.key, priority: flowPri(x.rec.orderNo, x.rec.sku) }));
  return flowPriSort(list, x => x);
}
/** Writes a line's record only if it is still what this screen read. '' when saved, else why not. */
async function flowCpPut(key, next) {
  const seen = ((FLOW.dem || {})[key] || {}).cutPc || null;
  const path = `pt_flowDemand/${key}/cutPc`, moved = 'Somebody changed this line meanwhile — press Refresh.';
  try {
    /* compared field by field, then swapped against the database's own copy: its field order is not this screen's */
    const fresh = await ptGetFresh(path);
    if (!ptSame(fresh, seen) || (await ptCas(path, fresh, next))) return moved;
  } catch (e) { return 'Could not save: ' + (e.message || e); }
  FLOW.dem = Object.assign({}, FLOW.dem, { [key]: Object.assign({}, (FLOW.dem || {})[key], { cutPc: next }) });
  return '';
}

/* ---- what one line says, on the card, the challan and the downloads ---- */
function flowCpDetail(l) {
  const sku = obUC(l.x.r.sku);
  let m = null; try { m = cutSkuOf(l.x.r.sku); } catch (e) { m = null; }
  m = m || {};
  return { orderNo: String(l.x.r.orderNo || ''), orderDate: String(ptIsoDate(l.x.r.orderDate) || ''), sku,
    article: [m.articleType || l.x.r.articleType, m.articleSubtype || m.subtype || l.x.r.articleSubtype].filter(Boolean).join(' · '),
    item: flowChItem(l.x.r), fabric: ((l.x.s.plan || {}).fabric || {}).name || '', size: String(l.x.r.size || m.size || '').trim(),
    pcs: l.pcs, perPc: l.perPc, metres: l.metres, priority: l.priority || '' };
}
const FLOW_CP_COLS = [['Priority', x => flowPriText(x.priority), 11], ['Order no', x => x.orderNo, 22], ['Order date', x => x.orderDate, 12],
  ['SKU / article no', x => x.sku, 16], ['Article details', x => x.article, 24], ['Product name', x => x.item, 36], ['Fabric', x => x.fabric, 14],
  ['Piece size', x => x.size, 14], ['Pieces', x => x.pcs, 9], ['Metres per piece', x => x.perPc, 12], ['Total metres', x => x.metres, 12],
  ['Cutting', x => x.cutting || 'Cut to size', 18], ['Printer', x => x.printerName || '', 22], ['Status', x => x.status, 22]];
function flowCpXlsx(name, rows) {
  const head = { b: 1, fill: 'F1EFE8' };
  const sheet = [FLOW_CP_COLS.map(c => ({ v: c[0], st: head }))].concat(rows.map(r => FLOW_CP_COLS.map(c => ({ v: c[1](r), st: {} }))));
  try {
    const bytes = flowRepXlsx([{ name: 'List', rows: sheet, freeze: { x: 0, y: 1 }, widths: FLOW_CP_COLS.map(c => c[2]), merges: [], filter: 'A1:N' + sheet.length, heights: {} }]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = name.replace(/[^A-Za-z0-9._-]+/g, '-') + '.xlsx';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return '';
  } catch (e) { console.error(`Download ${name} failed:`, e); return 'The Excel file could not be made. Nothing was downloaded.'; }
}
/** The Send to printer card's list, every line in the card's own order: cut pieces first, then running cloth. */
function flowCpCardRows(S) {
  return FLOW_SH_KINDS.flatMap(([kind, label]) => S.lines.filter(l => flowShKind(l) === kind).map(l => {
    const as = flowShAs(S, l), why = flowShWhyNot(S, l);
    return Object.assign(flowCpDetail(as), { cutting: kind === 'cut' ? 'Cutting required' : label, printerName: flowShVname(flowShPrn(S, l)),
      status: why || 'Waiting on Demand → RFD' });
  }));
}

/* ---- making the challan ---- */
/** The ticked cut lines as they will be written; `err` in words when this tick cannot make a cut challan. */
function flowCpPicked(S) {
  const go = flowShGoing(S), cut = go.filter(l => flowShKind(l) === 'cut');
  if (!cut.length) return { err: 'Tick at least one cut-pieces line.' };
  if (cut.length !== go.length) return { err: 'Running cloth is ticked too. Make the cut pieces challan and the running cloth challans separately.' };
  if (cut.some(l => !!l.x.r.__t) && cut.some(l => !l.x.r.__t)) return { err: 'A test order and a real one cannot share a challan.' };
  return { lines: cut };
}
async function flowCpNumber(isTest, head) {
  const day = dToday().replace(/\D/g, '');
  for (let n = 1; n < 100; n++) {
    const no = `${isTest ? 'TEST-' : ''}CP-${day}-${String(n).padStart(2, '0')}`;
    if (!(await flowClaim('pt_gdTest/cutch/' + no, head))) return no;
  }
  throw new Error('no free challan number today');
}
/** Removes the records of a challan whose cloth could not be taken; says which could not be removed. */
async function flowCpUndo(made) {
  const stuck = [];
  for (const r of made) if (await flowCpPut(r.key, null)) stuck.push(r.sku);
  if (!stuck.length) return '';
  console.error(`Cut pieces: records without cloth left behind for ${stuck.join(', ')}`);
  return ` These still show in Cut to size without their cloth — take them back: ${stuck.join(', ')}.`;
}
/** Number claimed, each line claimed, then the cloth taken off the shelf for the lines that were claimed.
 *  Returns { err } or { no, rows, said }. */
async function flowCpMake(fabric, lines, note) {
  const metres = flowR2(lines.reduce((a, l) => a + l.metres, 0));
  await GD.cutFresh();   // another PC may have taken cloth since this one read the desk
  const short = GD.cutCheck(fabric, metres); if (short) return { err: short };
  const at = new Date().toISOString(), by = ME.email || '';
  let no = '';
  try { no = await flowCpNumber(!!lines[0].x.r.__t, { fabric, note: note || '', at, by }); }
  catch (e) { return { err: 'The challan number could not be taken (' + (e.message || e) + '). Nothing was saved.' }; }
  const made = [], errs = [];
  for (const l of lines) {
    const d = flowCpDetail(l);
    const rec = Object.assign(d, { no, status: 'wait', printer: { code: String(l.to), name: flowShVname(l.to) }, note: note || '', at, by });
    delete rec.priority;
    const er = flowCpActive(l.key) ? 'already in Cut to size' : await flowCpPut(l.key, rec);
    if (er) errs.push(`${d.sku}: ${er}`); else made.push(Object.assign({ key: l.key }, rec));
  }
  if (!made.length) return { err: errs.join(' ') || 'Nothing was saved.' };
  const stock = await GD.cutIssue(fabric, no, made);
  if (stock) return { err: stock + (await flowCpUndo(made)) };
  return { no, rows: made, said: errs.join(' ') };
}

/** Make Cut Pieces Challan pressed on the card: the challan, then its list. '' closes the card. */
async function flowCpCardSave(S) {
  const picked = flowCpPicked(S); if (picked.err) return picked.err;
  const pcs = picked.lines.reduce((a, l) => a + l.pcs, 0), m = flowR2(picked.lines.reduce((a, l) => a + l.metres, 0));
  if (!window.confirm(`Make a Cut Pieces Challan for ${picked.lines.length} product(s), ${nf(pcs)} pcs, ${nf(m)} m? The cloth leaves RFD on shelf now.`)) return 'No challan was made.';
  const made = await flowCpMake(S.fabric, picked.lines, S.note); if (made.err) return made.err;
  FLOW_SH = null;
  setTimeout(() => {
    if (typeof S.after === 'function') S.after('', `Cut Pieces Challan ${made.no} made.`);
    flowCpResultOpen(S.fabric, made.no, made.said, S.after);
  }, 0);   // the card closes when this returns
  return '';
}

/* ---- the three presses in Cut to size ---- */
const FLOW_CP_NEXT = { ready: { from: 'wait', stamp: 'ready' }, cut: { from: 'ready', stamp: 'cutAt' } };
async function flowCpStep(key, to) {
  const r = flowCpActive(key), step = FLOW_CP_NEXT[to];
  if (!r || r.status !== step.from) return 'This piece has moved on — press Refresh.';
  return flowCpPut(key, Object.assign({}, r, { status: to, [step.stamp]: { at: new Date().toISOString(), by: ME.email || '' } }));
}
/** A challan made by mistake: allowed until the piece is cut. The cloth goes back on the shelf. */
async function flowCpTakeBack(key) {
  const r = flowCpActive(key);
  if (!r || (r.status !== 'wait' && r.status !== 'ready')) return 'Only a piece not yet cut can be taken back.';
  await GD.cutFresh();
  if (GD.state() !== 'ok') return 'The Greige Desk could not be read, so nothing was taken back.';
  const er = await flowCpPut(key, null);
  return er || GD.cutReturn(r.no, key);
}
/** One cut piece goes to its printer on the usual RFD challan. Claimed first, so two people cannot both send it. */
async function flowCpSend(key) {
  await flowEnsureData();
  const r = flowCpActive(key);
  if (!r || r.status !== 'cut') return { err: 'Only a cut piece can be sent — press Refresh.' };
  const x = flowRows().find(y => y.s.key === key);
  if (!x) return { err: `${r.orderNo} ${r.sku}: the order line is no longer open, so no challan was made.` };
  const v = flowShVen(r.printer.code);
  if (!v) return { err: `${r.printer.name} is not a printer in the vendor master any more.` };
  const claim = await flowCpPut(key, Object.assign({}, r, { status: 'sending', sendingAt: new Date().toISOString() }));
  if (claim) return { err: claim };
  const line = Object.assign(flowShLine(x), { pcs: r.pcs, metres: r.metres, to: r.printer.code });
  const made = await flowShMake(v, [line], `Cut pieces challan ${r.no}`, r.fabric, { fromCut: r.no });
  /* a challan that was saved counts as sent even if marking the lines failed: sending again would make a second one */
  const no = made.no || made.claimed;
  const now = (FLOW.dem[key] || {}).cutPc;
  const er = await flowCpPut(key, Object.assign({}, now, no ? { status: 'sent', challan: no } : { status: 'cut' }));
  if (made.err) return { err: made.err };
  return er ? { err: `Challan ${no} is made, but the piece could not be marked sent: ${er}` } : { no };
}

/* ---- the list with its buttons: after the challan is made, and in the desk's Cut to size drop-down ---- */
function flowCpButtons(r) {
  const b = (act, words, cls) => `<button type="button" class="${cls || 'jw-btn jw-primary'}" data-cp="${act}" data-cpkey="${esc(r.key)}">${words}</button>`;
  if (r.status === 'wait') return b('ready', 'Piece Ready for Cut') + ' ' + b('back', 'Take back', 'jw-btn ghost');
  if (r.status === 'ready') return b('cut', 'Cut done') + ' ' + b('back', 'Take back', 'jw-btn ghost');
  if (r.status === 'cut') return b('send', 'Send to printer');
  return '';
}
function flowCpTableHtml(rows) {
  const heads = ['Priority', 'Challan', 'Order', 'SKU / product', 'Piece size', 'Pcs', 'Total metres', 'Printer', 'Status', 'Next step'];
  const total = flowR2(rows.reduce((a, r) => a + r.metres, 0)), pcs = rows.reduce((a, r) => a + r.pcs, 0);
  return `<input type="search" data-cpq="1" placeholder="Search order, SKU, challan or printer" aria-label="Search cut pieces" style="margin:0 0 6px;max-width:320px">`
    + `<div class="box scroll"><table class="ct li xl"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
    + rows.map(r => `<tr data-cprow="1"><td><b>${esc(flowPriText(r.priority))}</b></td><td class="mono">${esc(r.no)}</td><td>${esc(r.orderNo)}<div class="muted" style="font-size:11px">${esc(r.orderDate || '')}</div></td>`
      + `<td style="text-align:left"><b>${esc(r.sku)}</b><div class="muted" style="font-size:11px">${esc([r.article, r.item].filter(Boolean).join(' · '))}</div></td>`
      + `<td>${esc(r.size || '—')}<div class="muted" style="font-size:11px">${nf(r.perPc)} m / pc</div></td><td class="num">${nf(r.pcs)}</td><td class="num">${nf(r.metres)} m</td>`
      + `<td>${esc((r.printer || {}).name || '')}</td><td>${esc(FLOW_CP_LABEL[r.status] || r.status)}</td><td style="white-space:nowrap">${flowCpButtons(r)}</td></tr>`).join('')
    + `<tr><td colspan="5"><b>Total · ${nf(rows.length)} product${rows.length === 1 ? '' : 's'}</b></td><td class="num"><b>${nf(pcs)}</b></td><td class="num"><b>${nf(total)} m</b></td><td colspan="3"></td></tr>`
    + '</tbody></table></div>';
}
/** Typing in the search box hides the rows that do not match every word. */
function flowCpFilter(box) {
  const words = String(box.value || '').toLowerCase().split(/\s+/).filter(Boolean);
  box.parentNode.querySelectorAll('[data-cprow]').forEach(tr => { const t = tr.textContent.toLowerCase(); tr.hidden = !words.every(w => t.includes(w)); });
}
const flowCpSheetRows = rows => rows.map(r => Object.assign({}, r, { printerName: (r.printer || {}).name || '', status: FLOW_CP_LABEL[r.status] || r.status }));
function flowCpChallanHtml(no, rows) {
  const cell = 'border:1px solid #999;padding:5px 6px;font-size:11px;text-align:left';
  const cols = FLOW_CP_COLS.filter(c => !['Cutting', 'Status'].includes(c[0]));
  const pcs = rows.reduce((a, r) => a + r.pcs, 0), m = flowR2(rows.reduce((a, r) => a + r.metres, 0));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(no)}</title><style>@page{size:A4 landscape;margin:10mm}@media print{.noprint{display:none}}</style></head>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:20px"><div style="font-size:20px;font-weight:bold">CUT PIECES CHALLAN</div>`
    + `<div style="font-size:12px;margin:4px 0 12px">Challan No: <b>${esc(no)}</b> · Date: ${esc(dToday())} · Fabric: <b>${esc(rows[0].fabric)}</b></div>`
    + `<table style="border-collapse:collapse;width:100%"><tr>${cols.map(c => `<th style="${cell}">${esc(c[0])}</th>`).join('')}</tr>`
    + flowCpSheetRows(rows).map(r => `<tr>${cols.map(c => `<td style="${cell}">${esc(String(c[1](r)))}</td>`).join('')}</tr>`).join('')
    + `</table><div style="margin-top:10px;font-size:13px"><b>Total: ${nf(rows.length)} products · ${nf(pcs)} pieces · ${nf(m)} metres</b></div>`
    + (rows[0].note ? `<div style="font-size:11px;margin-top:6px">Note: ${esc(rows[0].note)}</div>` : '')
    + `<table style="width:100%;margin-top:40px;font-size:11px"><tr><td>Issued by</td><td style="text-align:right">Cutting received by</td></tr></table>`
    + '<div class="noprint" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div></body></html>';
}
function flowCpPrint(no, rows) {
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press Print again.';
  w.document.open(); w.document.write(flowCpChallanHtml(no, rows)); w.document.close();
  return '';
}

/* The list shown after the challan is made: { no, keys, after }. */
let FLOW_CP = null;
const flowCpShownRows = () => flowCpList(FLOW_CP.fabric).filter(r => r.no === FLOW_CP.no);
function flowCpResultOpen(fabric, no, said, after) {
  FLOW_CP = { fabric, no, after };
  flowCpWire();
  ptOpenDialog({
    title: `Cut Pieces Challan ${no}`, wide: true,
    subtitle: `${fabric} · saved. These products are now in Cut to size on the Greige Desk.${said ? ' ' + said : ''}`,
    html: '<div style="display:flex;gap:8px;margin-bottom:8px"><button type="button" class="ghost" data-cpdl="xlsx" style="width:auto">Download List</button>'
      + '<button type="button" class="ghost" data-cpdl="print" style="width:auto">Print challan</button></div><div id="flcpBody"></div>',
    saveLabel: 'Done', onSave: async () => '',
  });
  flowCpDraw();
}
function flowCpDraw() { const box = $('flcpBody'); if (box && FLOW_CP) box.innerHTML = flowCpTableHtml(flowCpShownRows()); }

/** One press of a Cut to size button. Returns { ok, text } to say; null when the person said no. */
async function flowCpPress(act, key) {
  if (!flowScreenAllowed().some(b => b[0] === 'drfd')) return { ok: false, text: 'Cut to size needs Demand → RFD access.' };
  const r = flowCpActive(key) || {}, what = `${r.orderNo || ''} · ${r.sku || ''} · ${nf(r.pcs || 0)} pcs ${r.size || ''}`;
  if (act === 'send' && !window.confirm(`Send ${what} to ${(r.printer || {}).name}?`)) return null;
  if (act === 'back' && !window.confirm(`Take back ${what} from challan ${r.no}? The cloth goes back on RFD on shelf.`)) return null;
  if (act === 'send') {
    const sent = await flowCpSend(key);
    if (sent.err) return { ok: false, text: sent.err };
    const pe = flowChallanPrint(sent.no);
    return { ok: !pe, text: `Challan ${sent.no} made: ${what} is in transit to ${r.printer.name}. ${pe}` };
  }
  const er = act === 'back' ? await flowCpTakeBack(key) : await flowCpStep(key, act);
  const done = { ready: 'is ready for cut', cut: 'is cut', back: 'is taken back' }[act];
  return { ok: !er, text: er || `${what} · challan ${r.no} · ${nf(r.metres)} m · ${flowPriText(flowPri(r.orderNo, r.sku))} ${done}.` };
}
let FLOW_CP_WIRED = false;
/** The challan list lives in the app's own dialog, so its buttons are heard on the page (the desk hears its own). */
function flowCpWire() {
  if (FLOW_CP_WIRED) return; FLOW_CP_WIRED = true;
  document.addEventListener('input', ev => { if (ev.target && ev.target.matches && ev.target.matches('[data-cpq]')) flowCpFilter(ev.target); });
  document.addEventListener('click', async ev => {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-cp],[data-cpdl]') : null; if (!t || !FLOW_CP) return;
    if (t.dataset.cpdl) {
      const rows = flowCpShownRows(); if (!rows.length) return;
      const er = t.dataset.cpdl === 'print' ? flowCpPrint(FLOW_CP.no, rows) : flowCpXlsx(FLOW_CP.no, flowCpSheetRows(rows));
      if (er) window.alert(er);
      return;
    }
    t.disabled = true;
    const said = await flowCpPress(t.dataset.cp, t.dataset.cpkey);
    if (said && !said.ok) window.alert(said.text);
    flowCpDraw();
    if (typeof FLOW_CP.after === 'function') FLOW_CP.after('', said ? said.text : '');
  });
}
