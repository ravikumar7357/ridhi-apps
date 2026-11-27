/* ================= CUT TO SIZE FROM THE SEND TO PRINTER CARD (Vishesh, 27 Nov) =================
 *
 * Cutting is allotted from the order list of the Send to printer card, its "Cut pieces" tab: no challan is made and there
 * is no separate Send to cutting button. Ticked lines show in the Greige Desk's Cut to size column as Waiting to cut →
 * (Piece Ready for Cut) → Ready for cut → (Cut done), on screen and as a download. No approval. The cloth leaves RFD on
 * shelf when the lines are allotted.
 *   - a printed line (printed on the SKU itself) then goes: (Send to printer) → in transit, until the printer presses
 *     "Cloth received". Its printer challan (ch.fromCut) takes nothing more from the shelf.
 *   - a line with no printing is finished at Cut done. Allotting marks its fabric ready (as Send to cutting did), so it
 *     shows on Cutting Data with its lot.
 *
 * ONE RECORD PER ORDER LINE, so a product can never be in cutting twice: pt_flowDemand/<line>/cutPc =
 *   { no, status, orderNo, orderDate, sku, article, item, fabric, size, pcs, perPc, metres, printer, noPrint, was, at, by,
 *     ready, cutAt, challan }
 * `no` marks one allotment and its stock rows (GD.cutIssue / GD.cutReturn); it is not shown to anyone.
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
const FLOW_CP_LABEL = { wait: 'Waiting to cut', ready: 'Ready for cut', cut: 'Cut done', sending: 'Going to the printer', sent: 'Sent to printer' };
/** The line's record while it is still in cutting: null once it has gone to a printer (unless that challan was cancelled),
 *  or once a line with no printing is cut (Cut done here, or its pieces recorded on Cutting Data). */
function flowCpActive(key) {
  const r = (((typeof FLOW !== 'undefined' && FLOW.dem) || {})[key] || {}).cutPc;
  if (!r || (r.noPrint && (r.status === 'cut' || flowCpLineCut(key)))) return null;
  if (r.status === 'sending') return flowCpSending(key, r);
  if (r.status !== 'sent') return r;
  const ch = (FLOW.ch || {})[r.challan];
  return ch && ch.cancelled ? Object.assign({}, r, { status: 'cut' }) : null;
}
/** Cutting Data already holds cut pieces for the line. */
function flowCpLineCut(key) {
  const x = flowRows().find(y => y.s.key === key);
  return !!(x && x.s.cut);
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

/* ---- what one line says, on the card, in Cut to size and in the downloads ---- */
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
  ['Cutting', x => x.cutting || 'Cut to size', 18], ['Printer', x => x.printerName || '', 22], ['Allotted on', x => x.allotted || '', 13], ['Status', x => x.status, 22]];
function flowCpXlsx(name, rows) {
  const head = { b: 1, fill: 'F1EFE8' };
  const sheet = [FLOW_CP_COLS.map(c => ({ v: c[0], st: head }))].concat(rows.map(r => FLOW_CP_COLS.map(c => ({ v: c[1](r), st: {} }))));
  try {
    const bytes = flowRepXlsx([{ name: 'List', rows: sheet, freeze: { x: 0, y: 1 }, widths: FLOW_CP_COLS.map(c => c[2]), merges: [], filter: 'A1:O' + sheet.length, heights: {} }]);
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
    return Object.assign(flowCpDetail(as), { cutting: kind === 'cut' ? 'Cutting required' : label,
      printerName: l.noPrint ? 'No printing' : flowShVname(flowShPrn(S, l)),
      status: why || 'Waiting on Demand → RFD' });
  }));
}

/* ---- allotting from the card ---- */
/** The no-printing lines of a fabric that cloth off the shelf may go for, shaped like the card's own lines. */
function flowCpNoPrintLines(fabric) {
  return flowCutLines(fabric).map(c => {
    const x = flowRows().find(y => y.s.key === c.key);
    return { x, key: c.key, pcs: c.pcs, perPc: c.pcs ? flowR2(c.metres / c.pcs) : 0, metres: c.metres, printer: '', printerName: '',
      print: null, printKey: '', priority: flowPri(c.orderNo, c.sku), noPrint: true, ready: c.ready, was: c.was };
  }).filter(l => l.x && l.pcs > 0);
}
/** The ticked cut lines as they will be allotted; `err` in words when this tick cannot go to Cut to size. */
function flowCpPicked(S) {
  const go = flowShGoing(S), cut = go.filter(l => flowShKind(l) === 'cut');
  if (!cut.length) return { err: 'Tick at least one cut-pieces line.' };
  if (cut.length !== go.length) return { err: 'Running cloth is ticked too. Send the cut pieces and the running cloth separately.' };
  if (cut.some(l => !!l.x.r.__t) && cut.some(l => !l.x.r.__t)) return { err: 'A test order and a real one cannot be allotted together.' };
  return { lines: cut };
}
/** Removes the records of an allotment whose cloth could not be taken; says which could not be removed. */
async function flowCpUndo(made) {
  const stuck = [];
  for (const r of made) if (await flowCpPut(r.key, null)) stuck.push(r.sku);
  if (!stuck.length) return '';
  console.error(`Cut pieces: records without cloth left behind for ${stuck.join(', ')}`);
  return ` These still show in Cut to size without their cloth — take them back: ${stuck.join(', ')}.`;
}
function flowCpRecord(l, no, note) {
  const rec = Object.assign(flowCpDetail(l), { no, status: 'wait', note: note || '', at: new Date().toISOString(), by: ME.email || '',
    printer: { code: String(l.to || ''), name: l.noPrint ? '' : flowShVname(l.to) } });
  delete rec.priority;
  /* the database keeps no empty values, so "was" is written only when the line had a mark before */
  if (l.noPrint) { rec.noPrint = true; if (l.was) rec.was = l.was; }
  return rec;
}
/** A no-printing line is marked fabric ready by the allotment, so its mark must still be what the card read. */
async function flowCpMarkMoved(l) {
  if (!l.noPrint) return '';
  try {
    if (ptSame(await ptGetFresh(`pt_flowDemand/${l.key}/fabricReady`), l.was)) return '';
  } catch (e) { return 'could not be checked: ' + (e.message || e); }
  return 'somebody changed this line meanwhile — press Refresh';
}
/** Each line claimed, then the cloth taken off the shelf for the lines that were claimed. { err } or { no, rows, said }. */
async function flowCpAllot(fabric, lines, note) {
  const metres = flowR2(lines.reduce((a, l) => a + l.metres, 0));
  await GD.cutFresh();   // another PC may have taken cloth since this one read the desk
  const short = GD.cutCheck(fabric, metres); if (short) return { err: short };
  const no = 'cut-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const made = [], errs = [];
  for (const l of lines) {
    const rec = Object.assign(flowCpRecord(l, no, note), { fabric });
    const er = flowCpActive(l.key) ? 'already in Cut to size' : (await flowCpMarkMoved(l)) || (await flowCpPut(l.key, rec));
    if (er) errs.push(`${rec.sku}: ${er}`); else made.push(Object.assign({ key: l.key }, rec));
  }
  if (!made.length) return { err: errs.join(' ') || 'Nothing was saved.' };
  const stock = await GD.cutIssue(fabric, no, made);
  if (stock) return { err: stock + (await flowCpUndo(made)) };
  return { no, rows: made, said: errs.join(' ') };
}

/** Send to Cut to size pressed on the card: allots, then shows the list. '' closes the card. */
async function flowCpCardSave(S) {
  const picked = flowCpPicked(S); if (picked.err) return picked.err;
  const pcs = picked.lines.reduce((a, l) => a + l.pcs, 0), m = flowR2(picked.lines.reduce((a, l) => a + l.metres, 0));
  if (!window.confirm(`Send ${picked.lines.length} product(s), ${nf(pcs)} pcs, ${nf(m)} m to Cut to size? The cloth leaves RFD on shelf now.`)) return 'Nothing was sent to cutting.';
  const made = await flowCpAllot(S.fabric, picked.lines, S.note); if (made.err) return made.err;
  FLOW_SH = null;
  const said = `${made.rows.length} product(s) sent to Cut to size.`;
  setTimeout(() => {
    if (typeof S.after === 'function') S.after('', said);
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
/** Allotted by mistake: allowed until the piece is cut. The cloth goes back on the shelf, and a no-printing line goes back
 *  to what it was before. */
async function flowCpTakeBack(key) {
  const r = flowCpActive(key);
  if (!r || (r.status !== 'wait' && r.status !== 'ready')) return 'Only a piece not yet cut can be taken back.';
  await GD.cutFresh();
  if (GD.state() !== 'ok') return 'The Greige Desk could not be read, so nothing was taken back.';
  const er = await flowCpPut(key, null);
  return er || GD.cutReturn(r.no, key, r.noPrint ? { was: r.was || null } : null);
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
  const made = await flowShMake(v, [line], 'Cut pieces', r.fabric, { fromCut: r.no });
  /* a challan that was saved counts as sent even if marking the lines failed: sending again would make a second one */
  const no = made.no || made.claimed;
  const now = (FLOW.dem[key] || {}).cutPc;
  const er = await flowCpPut(key, Object.assign({}, now, no ? { status: 'sent', challan: no } : { status: 'cut' }));
  if (made.err) return { err: made.err };
  return er ? { err: `Challan ${no} is made, but the piece could not be marked sent: ${er}` } : { no };
}

/* ---- the list with its buttons: after allotting, and in the desk's Cut to size drop-down ---- */
function flowCpButtons(r) {
  const b = (act, words, cls) => `<button type="button" class="${cls || 'jw-btn jw-primary'}" data-cp="${act}" data-cpkey="${esc(r.key)}">${words}</button>`;
  if (r.status === 'wait') return b('ready', 'Piece Ready for Cut') + ' ' + b('back', 'Take back', 'jw-btn ghost');
  if (r.status === 'ready') return b('cut', 'Cut done') + ' ' + b('back', 'Take back', 'jw-btn ghost');
  if (r.status === 'cut') return b('send', 'Send to printer');
  return '';
}
/** The day a line was allotted, in India. */
const flowCpDay = at => (at ? new Date(at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }) : '');
const FLOW_CP_FILTERS = [['', 'All'], ['wait', 'Waiting'], ['ready', 'Ready'], ['cut', 'Cut done']];
function flowCpRowHtml(r) {
  const sub = t => `<div class="muted" style="font-size:11px">${esc(t)}</div>`;
  return `<tr data-cprow="1" data-cpkey="${esc(r.key)}" data-cpst="${r.status === 'sending' ? 'cut' : esc(r.status)}"><td><b>${esc(flowPriText(r.priority))}</b></td>`
    + `<td>${esc(r.orderNo)}${sub(r.orderDate || '')}</td><td style="text-align:left"><b>${esc(r.sku)}</b>${sub([r.article, r.item].filter(Boolean).join(' · '))}</td>`
    + `<td>${esc(r.size || '—')}${sub(nf(r.perPc) + ' m / pc')}</td><td class="num">${nf(r.pcs)}</td><td class="num">${nf(r.metres)} m</td>`
    + `<td>${esc(r.noPrint ? 'No printing' : (r.printer || {}).name || '')}</td><td>${esc(flowCpDay(r.at))}</td><td>${esc(FLOW_CP_LABEL[r.status] || r.status)}</td>`
    + `<td style="white-space:nowrap">${flowCpButtons(r)}</td></tr>`;
}
function flowCpTableHtml(rows) {
  const heads = ['Priority', 'Order', 'SKU / product', 'Piece size', 'Pcs', 'Total metres', 'Printer', 'Allotted', 'Status', 'Next step'];
  const total = flowR2(rows.reduce((a, r) => a + r.metres, 0)), pcs = rows.reduce((a, r) => a + r.pcs, 0);
  return `<div data-cpwrap="${esc((rows[0] || {}).fabric || '')}"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 6px">`
    + '<button type="button" class="jw-btn" data-cpdl="1" style="width:auto">Download List</button>'
    + FLOW_CP_FILTERS.map(([k, words]) => `<button type="button" class="jw-btn${k ? '' : ' jw-primary'}" data-cpf="${k}" aria-pressed="${!k}" style="width:auto">${words}</button>`).join('')
    + '<input type="search" data-cpq="1" placeholder="Search order, SKU or printer" aria-label="Search cut to size" style="width:auto;flex:0 1 280px"></div>'
    + `<div class="box scroll"><table class="ct li xl"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
    + rows.map(flowCpRowHtml).join('')
    + `<tr><td colspan="4"><b>Total · ${nf(rows.length)} product${rows.length === 1 ? '' : 's'}</b></td><td class="num"><b>${nf(pcs)}</b></td><td class="num"><b>${nf(total)} m</b></td><td colspan="4"></td></tr>`
    + '</tbody></table></div></div>';
}
/** Shows the rows that match the status picked and every word typed. */
function flowCpFilter(wrap) {
  const words = String(wrap.querySelector('[data-cpq]').value || '').toLowerCase().split(/\s+/).filter(Boolean);
  const status = (wrap.querySelector('[data-cpf][aria-pressed="true"]') || { getAttribute: () => '' }).getAttribute('data-cpf');
  wrap.querySelectorAll('[data-cprow]').forEach(tr => {
    const t = tr.textContent.toLowerCase();
    tr.hidden = !((!status || tr.getAttribute('data-cpst') === status) && words.every(w => t.includes(w)));
  });
}
function flowCpPickStatus(button) {
  const wrap = button.closest('[data-cpwrap]');
  wrap.querySelectorAll('[data-cpf]').forEach(b => { b.setAttribute('aria-pressed', String(b === button)); b.classList.toggle('jw-primary', b === button); });
  flowCpFilter(wrap);
}
const flowCpSheetRows = rows => rows.map(r => Object.assign({}, r, { printerName: r.noPrint ? 'No printing' : (r.printer || {}).name || '',
  allotted: flowCpDay(r.at), status: FLOW_CP_LABEL[r.status] || r.status }));
/** Downloads the rows on screen, in the order shown. */
function flowCpDownload(wrap) {
  const fabric = wrap.getAttribute('data-cpwrap');
  const shown = new Set([...wrap.querySelectorAll('[data-cprow]')].filter(tr => !tr.hidden).map(tr => tr.getAttribute('data-cpkey')));
  const rows = flowCpList(fabric).filter(r => shown.has(r.key));
  return rows.length ? flowCpXlsx(`cut-to-size-${fabric}-${dToday()}`, flowCpSheetRows(rows)) : 'No row is on screen to download.';
}

/* The list shown after allotting: { fabric, no, after }. */
let FLOW_CP = null;
const flowCpShownRows = () => flowCpList(FLOW_CP.fabric).filter(r => r.no === FLOW_CP.no);
function flowCpResultOpen(fabric, no, said, after) {
  FLOW_CP = { fabric, no, after };
  flowCpWire();
  ptOpenDialog({
    title: 'Sent to Cut to size', wide: true,
    subtitle: `${fabric} · saved. These products are now in Cut to size on the Greige Desk.${said ? ' ' + said : ''}`,
    html: '<div id="flcpBody"></div>',
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
  if (act === 'back' && !window.confirm(`Take back ${what} from Cut to size? The cloth goes back on RFD on shelf.`)) return null;
  if (act === 'send') {
    const sent = await flowCpSend(key);
    if (sent.err) return { ok: false, text: sent.err };
    const pe = flowChallanPrint(sent.no);
    return { ok: !pe, text: `Challan ${sent.no} made: ${what} is in transit to ${r.printer.name}. ${pe}` };
  }
  const er = act === 'back' ? await flowCpTakeBack(key) : await flowCpStep(key, act);
  const done = { ready: 'is ready for cut', cut: r.noPrint ? 'is cut — it has no printing, so it is finished here' : 'is cut', back: 'is taken back' }[act];
  return { ok: !er, text: er || `${what} · ${nf(r.metres)} m · ${flowPriText(flowPri(r.orderNo, r.sku))} ${done}.` };
}
let FLOW_CP_WIRED = false;
/** The list after allotting lives in the app's own dialog, so its buttons are heard on the page (the desk hears its own). */
function flowCpWire() {
  if (FLOW_CP_WIRED) return; FLOW_CP_WIRED = true;
  document.addEventListener('input', ev => { if (ev.target && ev.target.matches && ev.target.matches('[data-cpq]')) flowCpFilter(ev.target.closest('[data-cpwrap]')); });
  document.addEventListener('click', async ev => {
    const t = ev.target && ev.target.closest ? ev.target.closest('[data-cp],[data-cpf],[data-cpdl]') : null; if (!t || !FLOW_CP) return;
    if (t.hasAttribute('data-cpf')) { flowCpPickStatus(t); return; }
    if (t.hasAttribute('data-cpdl')) { const er = flowCpDownload(t.closest('[data-cpwrap]')); if (er) window.alert(er); return; }
    t.disabled = true;
    const said = await flowCpPress(t.dataset.cp, t.dataset.cpkey);
    if (said && !said.ok) window.alert(said.text);
    flowCpDraw();
    if (typeof FLOW_CP.after === 'function') FLOW_CP.after('', said ? said.text : '');
  });
}
