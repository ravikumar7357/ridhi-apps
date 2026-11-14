/* ================= PRODUCTION FLOW · CLOTH LEFT BY CHALLAN =================
 * Ravi, 14 Nov 2026, from the team handover "Printed Fabric Flow" (proposal b): for every challan, how much came, how much was
 * used, how much is left and how many days it has been lying. Production flow → Demand → Printed fabric in → Cloth left by challan.
 *   Received  what came back on that challan line (its receipts), in the unit it went out in — metres, or pieces for a SKU printed
 *             as pieces.
 *   Used      metres: the order line's cutting entries (Cutting Data, the metres typed or worked out, as the store reads them) less
 *             the waste strips the cutter put back in the store. Pieces: what was issued to karigars for the order line, less QC
 *             rejects issued again. One order line on two or more challans: what was used comes off the oldest receipt first.
 *   Left      Received − Used, never below 0. Used more than came (cloth from other stock): 0, and a red note says by how much.
 *             For pieces it says "Issued … more than came": on live data (14 Nov) these are pieces that came back through Vendor
 *             Orders, not on the challan, or were issued before the challan receipt was typed.
 *             Pieces cut with no metres typed (and none in the master to work out): "Cut … pcs — metres not typed", in grey, and
 *             not counted as leftover or waiting — the cloth they took is not known until the cutting entry is put right.
 *   Days      since the last receipt on that challan, while cloth is left; red after FLOW_BAL_LYING_DAYS.
 *   Where     "Waiting to cut / issue" while the order line has not got past that step — that cloth is still to be used.
 *             "Leftover" once the line has moved on — that is the cloth really left over.
 * Left out: cancelled challans, a line moved to another printer (it shows under Standing with printers), a ruffle-only line
 * (cutting does not record ruffle cloth on its own). Orders before 15 Oct are not in the flow, so not here. The totals will not
 * match Store Stock Balance: the store also holds opening stock and what is typed by hand.
 * Error handling: a view — it saves nothing and never throws. A cutting entry it cannot read counts as nothing used, with a
 * console note, so the screen still opens. */
const FLOW_BAL_LYING_DAYS = 7;   // Ravi, 14 Nov: red after a week
/* THE DROP-DOWNS (Ravi, 14 Nov: "drop down ke tareeke se aur multiple columns ke saath", not tabs and chips).
 *   todo     '' = every line with a job · one job ('cut', 'issue' …) · 'every' = every line, the used-up ones too
 *   late     false = any age · true = only over FLOW_BAL_LYING_DAYS
 *   printer  '' = every printer · one printer's name */
const FLOW_BAL = { todo: '', late: false, printer: '' };
/* WHAT TO DO (Ravi, 14 Nov: "make it actionable"). Every line with something left is one job for one desk, and its button opens
 * the screen that job is done on today — the same form, the same checks. Nothing here saves: the save is made on that screen.
 *   cut    Cutting      metres waiting to cut          → the cutting entry for the line (as To cut opens it)
 *   issue  Job Work     pieces waiting for a karigar   → the issue to karigar for the line (as Raw cutting in store opens it)
 *   fix    Cutting      pieces cut, no metres typed    → that cutting entry's Edit, to type the fabric used
 *   over   Receiving    issued / used more than came   → the printer's Receive dialog, searched to the SKU, when the printer
 *                                                         still owes the line; else it came another way (Vendor Orders) — check there
 *   left   Store        leftover cloth                 → check it is on the shelf (no button: Store Stock Balance already holds it) */
const FLOW_BAL_TODO = [['cut', 'Cut', 'Cutting'], ['issue', 'Issue', 'Job Work'], ['fix', 'Fix metres', 'Cutting'], ['over', 'Check receipt', 'Receiving'], ['left', 'Leftover', 'Store']];
/* The steps after which a line's cloth has been used: cut cloth goes on to Raw cutting in store, printed pieces on to karigars.
 * A line no longer in the flow's rows is done (flowRows keeps a done line only for a week). */
const FLOW_BAL_PAST = { m: ['raw', 'wip', 'qcb', 'fgin', 'ship', 'done', 'out'], pcs: ['wip', 'qcb', 'fgin', 'ship', 'done', 'out'] };

/** The metres each order line's cutting entries used: { lineKey: { cut, waste, pcsNoMetres } }. pcsNoMetres: pieces cut
 * with no metres typed and none to work out (no cloth per piece in the master) — that cloth's use is not known. */
function flowBalCutByLine() {
  const out = {};
  ((typeof PT !== 'undefined' && PT.cut) || []).forEach(c => {
    if (!c || c.clothFrom) return;   // cut from rejected or wastage cloth: none of a challan's cloth
    let k;
    try { k = stCutting(c); } catch (e) { console.warn('Cloth left by challan: cutting entry not read', c.id || c._key, e); return; }
    const noMetres = k.pcs > 0 && !(k.metres > 0) ? k.pcs : 0;
    if (!(k.metres > 0) && !(k.waste > 0) && !noMetres) return;
    const key = flowKey(c.orderNo || '', c.sku || ''), e = out[key] || (out[key] = { cut: 0, waste: 0, pcsNoMetres: 0, noMetresIds: [] });
    e.cut = flowR2(e.cut + k.metres); e.waste = flowR2(e.waste + k.waste); e.pcsNoMetres += noMetres;
    if (noMetres) e.noMetresIds.push(c.id);
  });
  return out;
}

/** The first and last day cloth came back on a challan line. */
function flowBalRecvDays(c, key) {
  const days = Object.values(c.receipts || {}).filter(rc => rc && rc.items && +rc.items[key] > 0)
    .map(rc => String(rc.date || String(rc.at || '').slice(0, 10)).slice(0, 10)).filter(Boolean).sort();
  return { first: days[0] || '', last: days[days.length - 1] || '' };
}

/** The lines a printer still owes: { lineKey: printer code (or name) } — the key its Receive dialog opens with. */
function flowBalOwed() {
  const out = new Map();
  try { flowDueRows('', false).forEach(x => out.set(x.l.key, x.code || x.printer)); } catch (e) { console.warn('Cloth left by challan: lines owed not read', e); }
  return out;
}

/** The one job a line asks for ('' when nothing is left to do). */
function flowBalTodo(r) {
  if (r.over > 0) return 'over';
  if (r.where === 'nometres') return 'fix';
  if (r.where === 'leftover') return 'left';
  if (r.where === 'waiting') return r.unit === 'pcs' ? 'issue' : 'cut';
  return '';
}

/* WORKED OUT ONCE PER SCREEN (Ravi, 14 Nov: "screen slow / bhaari"). The drop-downs and the table both need the lines, and the
 * screen is drawn again on every search letter and every drop-down: the lines are worked out again only when the challans, the
 * cutting entries, the flow's lines (flowRows keeps the same list until something changes) or the search change. */
let FLOW_BAL_C = {};
/** Every challan line with cloth received, with what was used and what is left. */
function flowBalRows(q, testOnly) {
  const rows = flowRows(), cut = (typeof PT !== 'undefined' && PT.cut) || null, c = FLOW_BAL_C, only = !!testOnly;
  if (c.out && c.ch === FLOW.ch && c.cut === cut && c.rows === rows && c.q === q && c.only === only) return c.out;
  const out = flowBalBuild(q, only, rows);
  FLOW_BAL_C = { ch: FLOW.ch, cut, rows, q, only, out };
  return out;
}
function flowBalBuild(q, testOnly, flowLines) {
  const state = new Map(flowLines.map(x => [x.s.key, x.s])), cuts = flowBalCutByLine(), byLine = new Map(), owed = flowBalOwed();
  Object.values(FLOW.ch || {}).forEach(c => {
    if (!c || c.cancelled || (testOnly && !flowIsTest(c.orderNo))) return;
    const recv = flowChRecv(c);
    (c.lines || []).forEach(l => {
      if (l.ruffleOnly || flowChMoved(c, l) || !(recv[l.key] > 0)) return;
      const list = byLine.get(l.key) || byLine.set(l.key, []).get(l.key);
      list.push(Object.assign({ c, l, recv: recv[l.key] }, flowBalRecvDays(c, l.key)));
    });
  });
  const today = dToday(), out = [];
  byLine.forEach((list, key) => {
    const unit = flowChUnit(list[0].l), s = state.get(key), cut = cuts[key] || { cut: 0, waste: 0, pcsNoMetres: 0, noMetresIds: [] };
    /* Pieces cut with no metres: what is "left" is not known, so it is not called leftover or waiting (live, 14 Nov: 807 pcs of CPC-SC-007). */
    const noMetres = unit === 'm' && cut.pcsNoMetres > 0;
    const recvAll = list.reduce((t, e) => t + e.recv, 0);
    /* A pieces line gone from the flow's rows is done, so every piece was issued. */
    const used = unit === 'm' ? Math.max(0, flowR2(cut.cut - cut.waste)) : (s ? +s.issuedNet || 0 : recvAll);
    const past = !s || FLOW_BAL_PAST[unit].includes(s.bucket);
    let rest = used;
    list.sort((a, b) => a.first.localeCompare(b.first) || String(a.c.no).localeCompare(String(b.c.no)));
    list.forEach((e, i) => {
      const take = flowR2(Math.min(rest, e.recv)); rest = flowR2(rest - take);
      const left = flowR2(e.recv - take), over = i === list.length - 1 && rest > 0 ? rest : 0;
      const where = left <= 0 ? 'used' : noMetres ? 'nometres' : past ? 'leftover' : 'waiting';
      const r = { no: e.c.no, printer: (e.c.vendor && e.c.vendor.name) || '', orderNo: e.l.orderNo || String(key).split('__')[0] || e.c.orderNo || '',
        sku: obUC(e.l.sku), l: e.l, key, unit, sent: flowChSent(e.l), recv: e.recv, used: take, left, over, cut, last: e.last, where,
        days: left > 0 && e.last ? flowRemDays(e.last, today) : null, recordOnly: !!e.c.noChallan, test: flowIsTest(e.c.orderNo),
        owedBy: owed.get(key) || '' };
      r.todo = flowBalTodo(r);
      out.push(r);
    });
  });
  const hay = r => [r.no, r.printer, r.orderNo, r.sku, r.l.fabric, r.l.print && r.l.print.code].join(' ').toLowerCase();
  const rank = { leftover: 0, nometres: 1, waiting: 2, used: 3 };
  return out.filter(r => !q || hay(r).includes(q))
    .sort((a, b) => rank[a.where] - rank[b.where] || (b.days || 0) - (a.days || 0) || String(a.no).localeCompare(String(b.no)));
}

const flowBalLying = r => r.days != null && r.days > FLOW_BAL_LYING_DAYS;
/** The lines the Days and Printer drop-downs let through, with a job (or every line when "Every line" is picked). */
const flowBalOpen = rows => rows.filter(r => (FLOW_BAL.todo === 'every' || r.todo) && (!FLOW_BAL.late || flowBalLying(r)) && (!FLOW_BAL.printer || r.printer === FLOW_BAL.printer));
/** …and of the one job picked in "What to do". */
const flowBalShown = rows => flowBalOpen(rows).filter(r => !FLOW_BAL.todo || FLOW_BAL.todo === 'every' || r.todo === FLOW_BAL.todo);
const flowBalJob = k => (FLOW_BAL_TODO.find(t => t[0] === k) || [, '', ''])[1];
/** Who does the line's job, in words (for the screen and the Excel). */
const flowBalWho = r => (FLOW_BAL_TODO.find(t => t[0] === r.todo) || [, , ''])[2];

/** Above the table: the What to do, Days and Printer drop-downs (each with its count), Excel, and one line of totals. */
function flowBalBar(q, testOnly) {
  const rows = flowBalRows(q, testOnly), open = flowBalOpen(rows);
  const sum = w => flowMixTxt(rows.filter(r => r.where === w).map(r => [r.left, r.unit]));
  const lying = new Set(rows.filter(flowBalLying).map(r => r.no)).size;
  const sel = (key, label, opts, cur) => `<label style="display:inline-flex;flex-direction:column;font-size:11px;color:var(--muted);margin-right:8px">${label}`
    + `<select data-flbalsel="${key}" style="width:auto;min-width:150px;padding:6px 10px;font-size:13px;border-radius:10px">`
    + opts.map(([v, t]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('') + '</select></label>';
  const printers = [...new Set(rows.map(r => r.printer).filter(Boolean))].sort();
  return `<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:4px;margin-top:8px;flex-basis:100%">`
    + sel('todo', 'What to do', [['', `All jobs — ${nf(open.filter(r => r.todo).length)}`], ...FLOW_BAL_TODO.map(([k, t]) => [k, `${t} — ${nf(open.filter(r => r.todo === k).length)}`]),
      ['every', 'Every line (used up too)']], FLOW_BAL.todo)
    + sel('late', 'Days', [['', 'Any age'], ['1', `Over ${FLOW_BAL_LYING_DAYS} days`]], FLOW_BAL.late ? '1' : '')
    + sel('printer', 'Printer', [['', 'All printers'], ...printers.map(p => [p, p])], FLOW_BAL.printer)
    + '<button type="button" class="ghost" data-flbalxl="1" style="width:auto;padding:6px 14px;font-size:12.5px">Download Excel</button></div>'
    + `<div class="muted" style="font-size:12px;margin-top:6px;flex-basis:100%">Leftover ${sum('leftover')} · Waiting to cut / issue ${sum('waiting')}`
    + ` · <span${lying ? ' style="color:#b91c1c;font-weight:600"' : ''}>${nf(lying)} challan(s) over ${FLOW_BAL_LYING_DAYS} days</span></div>`;
}

/** The line's job, said in one short label (red when more went out than came). */
function flowBalJobHtml(r) {
  if (!r.todo) return '<span class="jw-st" style="background:#f0fdf4;color:#166534">All used</span>';
  const txt = r.todo === 'over' ? `${r.unit === 'pcs' ? 'Issued' : 'Used'} ${flowQtyTxt(r.over, r.unit)} more than came`
    : r.todo === 'fix' ? `Fix metres · ${nf(r.cut.pcsNoMetres)} pcs cut` : flowBalJob(r.todo);
  const [bg, ink] = r.todo === 'over' ? ['#fef2f2', '#b91c1c'] : r.todo === 'left' ? ['#fffbeb', '#b45309'] : r.todo === 'fix' ? ['#f1f5f9', '#475569'] : ['#eff6ff', '#1d4ed8'];
  return `<span class="jw-st" style="background:${bg};color:${ink};white-space:normal">${txt}</span>`;
}

/** Who does it, and the button that opens the screen it is done on. */
function flowBalAction(r) {
  const btn = (attr, label) => `<button type="button" ${attr} style="width:auto;padding:3px 10px;font-size:12px;margin-top:2px">${label}</button>`;
  const who = `<div class="muted" style="font-size:10.5px">${esc(flowBalWho(r))}</div>`;
  /* Waiting means the line is still in the flow (one gone from it is done: Leftover or used), so its entry can be opened. */
  if (r.todo === 'cut') return who + btn(`data-flent="cut|${esc(r.key)}"`, 'Cutting entry →');
  if (r.todo === 'issue') return who + btn(`data-flent="issue|${esc(r.key)}"`, 'Issue to karigar →');
  if (r.todo === 'fix') return who + btn(`data-flbalfix="${esc(r.cut.noMetresIds[0] || '')}"`, 'Fix metres →')
    + (r.cut.noMetresIds.length > 1 ? `<div class="muted" style="font-size:10.5px">${nf(r.cut.noMetresIds.length)} entries to fix</div>` : '');
  if (r.todo === 'over') return who + (r.owedBy ? btn(`data-flbalrecv="${esc(r.owedBy)}|${esc(r.sku)}"`, 'Receive on challan →')
    : '<div style="font-size:11.5px;white-space:normal;max-width:190px">Nothing owed on the challan — it came another way: check Vendor Orders</div>');
  if (r.todo === 'left') return who + '<div style="font-size:11.5px">Check it is on the shelf</div>';
  return '';
}

/* ONE WIDE TABLE (Ravi, 14 Nov: "multiple columns ke saath"): every fact in a column of its own, so a row is read across. */
const FLOW_BAL_COLS = ['Challan', 'Printer', 'Order', 'SKU', 'Printed fabric', 'Sent', 'Received', 'Used', 'Left', 'Last received', 'Days', 'What to do', 'Who · open'];
/** The table: one row per challan line, the totals at the foot. */
function flowBalTable(q, testOnly) {
  const rows = flowBalShown(flowBalRows(q, testOnly)), L = 'text-align:left', S = 'font-size:10.5px';
  const usedNote = r => r.unit === 'm' && r.cut.waste ? `<div class="muted" style="${S}">cut ${flowQtyTxt(r.cut.cut, 'm')}, ${flowQtyTxt(r.cut.waste, 'm')} waste back</div>` : '';
  const body = rows.map(r => `<tr><td class="frz" style="${L};white-space:nowrap"><b>${esc(r.no)}</b>${r.test ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}${r.recordOnly ? `<div class="muted" style="${S}">no RFD challan</div>` : ''}</td>
    <td style="${L}">${esc(r.printer)}</td><td style="${L};white-space:nowrap">${esc(r.orderNo)}</td><td style="${L};white-space:nowrap">${esc(r.sku)}</td>
    <td style="${L};font-size:12px;white-space:normal;min-width:180px">${flowChLineWhat(r.l)}</td>
    <td class="num">${flowQtyTxt(r.sent, r.unit)}</td><td class="num">${flowQtyTxt(r.recv, r.unit)}</td>
    <td class="num">${r.todo === 'fix' ? '<span class="muted">not typed</span>' : flowQtyTxt(r.used, r.unit)}${usedNote(r)}</td>
    <td class="num"><b>${flowQtyTxt(r.left, r.unit)}</b></td><td style="white-space:nowrap">${esc(r.last)}</td>
    <td class="num"${flowBalLying(r) ? ' style="color:#b91c1c;font-weight:700"' : ''}>${r.days == null ? '—' : nf(r.days)}</td>
    <td style="${L};min-width:120px">${flowBalJobHtml(r)}</td><td style="${L};white-space:nowrap">${flowBalAction(r)}</td></tr>`).join('');
  const foot = rows.length ? `<tr style="background:#f8fafc;font-weight:700"><td class="frz" colspan="5" style="${L}">Total · ${nf(rows.length)} line(s)</td>`
    + ['sent', 'recv', 'used', 'left'].map(f => `<td class="num">${flowMixTxt(rows.map(r => [r[f], r.unit]))}</td>`).join('') + '<td></td><td></td><td></td><td></td></tr>' : '';
  return `<thead><tr>${FLOW_BAL_COLS.map((h, i) => `<th${i === 0 ? ' class="frz"' : ''} style="${i < 5 || i > 10 ? L : ''}">${h}</th>`).join('')}</tr></thead><tbody>`
    + (body || `<tr><td colspan="${FLOW_BAL_COLS.length}" class="muted" style="padding:16px">${q ? `Nothing for “${esc(q)}”.` : 'Nothing to do here.'}</td></tr>`) + foot + '</tbody>';
}

/** The same lines as an Excel sheet — what the screen shows, with who does what. */
function flowBalXl(q, testOnly) {
  const rows = flowBalShown(flowBalRows(q, testOnly));
  if (!rows.length) return 'Nothing to download — no line is shown.';
  const colour = r => { let m = {}; try { m = cutSkuOf(r.l.sku) || {}; } catch (e) { m = {}; } return String(m.color || '').trim(); };
  const out = [['Challan', 'Printer', 'Order', 'SKU', 'Printed fabric SKU', 'Colour', 'Fabric', 'Unit', 'Sent', 'Received', 'Used', 'Left',
    'More than came', 'Last received', 'Days', 'What to do', 'Who']];
  rows.forEach(r => out.push([r.no, r.printer, r.orderNo, r.sku, (r.l.print && r.l.print.code) || '', colour(r), r.l.fabric || '', r.unit,
    r.sent, r.recv, r.used, r.left, r.over || '', r.last, r.days == null ? '' : r.days, r.todo ? flowBalJob(r.todo) : 'All used', flowBalWho(r)]));
  const bytes = recipeXlsx(out, { name: 'Cloth left by challan', freeze: 1, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'cloth-left-by-challan-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
  return '';
}

/** Receive on challan: the printer's own Receive dialog, searched to the SKU so its line is the one in view. */
function flowBalRecvOpen(code, sku) {
  flowDueRecvOpen(code);
  const box = $('fldrQ'); if (!box) return;
  box.value = sku; box.dispatchEvent(new Event('input', { bubbles: true }));
  flowAfterDialog();
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('change', e => { const t = e.target; if (!t || !t.dataset || !t.dataset.flbalsel) return;
    const k = t.dataset.flbalsel; FLOW_BAL[k] = k === 'late' ? t.value === '1' : t.value; renderFlow(); });
  document.addEventListener('click', e => { const t = e.target; if (!t || !t.closest) return;
    const fix = t.closest('[data-flbalfix]'), recv = t.closest('[data-flbalrecv]'), xl = t.closest('[data-flbalxl]');
    if (!fix && !recv && !xl) return;
    e.preventDefault();
    /* Changing a cutting entry needs "Can edit production entries"; without it cutEdit says so on the Cutting screen, out of sight — so say it here. */
    if (fix) { if (!ptCanEdit()) { flowSay(PT_NO_EDIT, true); return; } cutEdit(fix.dataset.flbalfix); flowAfterDialog(); return; }
    if (recv) { const [code, sku] = recv.dataset.flbalrecv.split('|'); flowBalRecvOpen(code, sku); return; }
    const er = flowBalXl(String($('flQ').value || '').trim().toLowerCase(), FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly());
    if (er) { $('flMsg').className = 'err'; $('flMsg').textContent = er; } });
}
