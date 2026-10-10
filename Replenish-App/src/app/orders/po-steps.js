/* ================= PO — 10 STEPS (2026-10-10, TEST ONLY until Ravi says deploy) =================
 *
 * Ravi's "production plan" document: every PO goes Order → PPC → Demand (accessories / RFD fabric) → Vendor
 * allocation → Printed fabric in store → Cutting → Cutting done, back to store → Raw cutting in store → WIP (issue →
 * receive → QC) → India stock "ready from production". This view puts every PO on one line across those ten steps.
 *
 * HOW THIS FILE IS LAID OUT:
 *   1. Switch            — shown only on a Firebase preview link (host has "--") or with localStorage poSteps = '1';
 *                          the live app never offers it until Ravi has checked it and says deploy
 *   2. The ten steps     — what each one counts, and from which register
 *   3. Per PO            — the lines of each PO added up, step by step; where it is stuck
 *   4. The two ticks     — PPC and Demand have no register in this app, so they are ticked here: pt_poSteps/<order>
 *   5. The screen        — Order Console → view "PO — 10 steps"
 *
 * Every figure except the two ticks is the one the Order Console already shows (ordLines, ordVendorOf, ordQcOf, ordFgAt),
 * so this view and the console can never disagree. */

/* ============================================================================================
 * 1. SWITCH
 * ============================================================================================ */
const POS_ON = (() => {
  try { if (localStorage.getItem('poSteps') === '0') return false; if (localStorage.getItem('poSteps') === '1') return true; } catch (e) { /* storage blocked */ }
  try { return /--/.test(location.hostname) || /^(localhost|127\.)/.test(location.hostname); } catch (e) { return false; }
})();

/* ============================================================================================
 * 2. THE TEN STEPS
 * ============================================================================================ */
const POS_STEPS = [
  { k: 'po', l: '1 · PO', tip: 'The PO in the order book: its lines and pieces, the platform and the date.' },
  { k: 'ppc', l: '2 · PPC', tip: 'Production planning. No register holds it — ticked here, with a date and a note.', manual: true },
  { k: 'demand', l: '3 · Demand', tip: 'Accessories and RFD fabric asked for. Ticked here; shown done on its own once printing has been given for every printed line.', manual: true },
  { k: 'vendor', l: '4 · Vendor', tip: 'Pieces given to a printer for this PO (vendor orders, shared by SKU the way the Order Console shares them). Lines that are not printed: n/a.' },
  { k: 'fabric', l: '5 · Fabric in', tip: 'Printed pieces back from the printer and accepted (History → Accept).' },
  { k: 'cut', l: '6 · Cutting', tip: 'Cutting register entries naming this PO. Only lines whose SKU needs cutting.' },
  { k: 'cutstore', l: '7 · Cut → store', tip: 'The cutting master\'s entry is what puts cut pieces in the store, so this is the same figure as Cutting until a separate hand-over is recorded.' },
  { k: 'raw', l: '8 · Raw in store', tip: 'Cut (or, for a line with no cutting, printed) pieces not yet issued to a karigar — what is sitting in the store now.' },
  { k: 'wip', l: '9 · WIP', tip: 'Issued to karigars → received back → QC passed. Done when QC has passed every piece.' },
  { k: 'india', l: '10 · India stock', tip: 'Received into Finished Goods (India stock) for this PO. A Shopify line: handed to shipping.' },
];

/* ============================================================================================
 * 3. PER PO
 * ============================================================================================ */
let POS_TICKS = null, POS_TICKS_AT = 0;
async function posLoadTicks(force) {
  if (POS_TICKS && !force && Date.now() - POS_TICKS_AT < 60e3) return POS_TICKS;
  try { POS_TICKS = (await ptGet('pt_poSteps')) || {}; } catch (e) { POS_TICKS = POS_TICKS || {}; }
  POS_TICKS_AT = Date.now();
  return POS_TICKS;
}
/** The database key for an order number (it may not hold . # $ [ ] /). */
const posKey = no => String(no || '').replace(/[.#$\[\]\/]/g, '_');

/** One line's figures for each step: { need, done } (need 0 = not this line's step), plus the WIP three. */
function posLine(r) {
  const v = ordVendorOf(r.orderNo, r.sku), q = ordQcOf(r.orderNo, r.sku), g = ordFgAt(r.orderNo, r.sku) || {};
  const qty = +r.qty || 0, cap = n => Math.max(0, Math.min(qty, +n || 0));
  const printed = !!(r.printer || (v && v.given > 0) || /^Vendor/.test(ordWaitingAt(r) || ''));
  const given = r.printer ? qty : (v ? cap(v.given) : 0), back = r.printer ? cap(r.printed) : (v ? cap(v.back) : 0);
  const cut = r.cutReq ? cap(r.cut) : 0, issued = cap(r.issued), received = cap(r.received), qc = q ? cap(q.ok) : 0;
  const avail = r.cutReq ? cut : (printed ? back : qty);
  const india = r.handedAt || r.shopDoneAt ? qty : cap(g.in);
  return {
    po: { need: qty, done: qty },
    vendor: { need: printed ? qty : 0, done: given },
    fabric: { need: printed ? qty : 0, done: back },
    cut: { need: r.cutReq ? qty : 0, done: cut },
    cutstore: { need: r.cutReq ? qty : 0, done: cut },
    raw: { need: 0, done: 0, now: Math.max(0, avail - issued) },
    wip: { need: qty, done: qc, issued, received, qc },
    india: { need: qty, done: india },
    printed,
  };
}

/** Every PO on the book (after the console's own filters), each step added up over its lines. */
function posRows(lines, ticks) {
  const by = new Map();
  (lines || []).forEach(r => {
    let o = by.get(r.orderNo);
    if (!o) {
      o = { orderNo: r.orderNo, date: r.orderDate || '', src: (typeof ordSrcOf === 'function' && ordSrcOf(r.orderNo)) || String(r.orderNo).split('-')[0],
        lines: 0, open: 0, s: {}, wip: { issued: 0, received: 0, qc: 0 }, raw: 0, printedLines: 0 };
      POS_STEPS.forEach(st => { o.s[st.k] = { need: 0, done: 0 }; });
      by.set(r.orderNo, o);
    }
    const x = posLine(r);
    o.lines++; if (r.open) o.open++;
    if (x.printed) o.printedLines++;
    ['po', 'vendor', 'fabric', 'cut', 'cutstore', 'wip', 'india'].forEach(k => { o.s[k].need += x[k].need; o.s[k].done += x[k].done; });
    o.raw += x.raw.now; o.wip.issued += x.wip.issued; o.wip.received += x.wip.received; o.wip.qc += x.wip.qc;
  });
  by.forEach(o => {
    const t = (ticks || {})[posKey(o.orderNo)] || {};
    o.ticks = t;
    o.s.ppc = { need: 1, done: t.ppc ? 1 : 0, manual: true };
    /* Demand: ticked, or every printed line already given out (the demand evidently went). */
    const auto = o.printedLines > 0 && o.s.vendor.done >= o.s.vendor.need;
    o.s.demand = { need: 1, done: t.demand || auto ? 1 : 0, manual: true, auto: !t.demand && auto };
    o.s.raw = { need: 0, done: 0, now: o.raw };
    /* Stuck at: the first step not finished, in the document's order (n/a steps are passed). */
    o.at = POS_STEPS.findIndex(st => { const c = o.s[st.k]; return c.need > 0 && c.done < c.need; });
    if (o.at < 0) o.at = POS_STEPS.length;
  });
  return [...by.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.orderNo).localeCompare(String(b.orderNo)));
}

/* ============================================================================================
 * 4. THE TWO TICKS — pt_poSteps/<order>/{ppc|demand} = { at, by, date, note }
 * ============================================================================================ */
function posTickOpen(orderNo, k) {
  const st = POS_STEPS.find(x => x.k === k), cur = ((POS_TICKS || {})[posKey(orderNo)] || {})[k];
  ptOpenDialog({
    title: `${st.l} — ${orderNo}`,
    subtitle: st.tip,
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
      <label>Date<input id="posDate" type="date" value="${esc((cur && cur.date) || dToday())}"></label>
      <label>Note (what was planned / asked for, by whom)<input id="posNote" value="${esc((cur && cur.note) || '')}"></label>
      ${cur ? `<div class="muted" style="font-size:12px">Ticked by ${esc(String(cur.by || '').split('@')[0])} on ${esc(String(cur.at || '').slice(0, 10))}.
        <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input id="posUndo" type="checkbox" style="width:auto"> Take the tick off</label></div>` : ''}
    </div>`,
    saveLabel: cur ? 'Save' : 'Mark done',
    onSave: async () => {
      const path = `pt_poSteps/${posKey(orderNo)}/${k}`;
      const undo = $('posUndo') && $('posUndo').checked;
      const val = undo ? null : { at: new Date().toISOString(), by: ME.email || '', date: $('posDate').value || dToday(), note: String($('posNote').value || '').trim(), orderNo };
      try { await ptPatch({ [path]: val }); }
      catch (e) { return 'Could not save: ' + (e.message || e); }
      POS_TICKS = POS_TICKS || {};
      const t = POS_TICKS[posKey(orderNo)] = POS_TICKS[posKey(orderNo)] || {};
      if (val) t[k] = val; else delete t[k];
      renderOrdSteps();
      return '';
    },
  });
}

/* ============================================================================================
 * 5. THE SCREEN
 * ============================================================================================ */
function posCell(o, st) {
  const c = o.s[st.k];
  if (st.k === 'po') return `<td class="num"><b>${nf(c.need)}</b><div class="muted" style="font-size:10.5px">${nf(o.lines)} line(s)</div></td>`;
  if (st.k === 'raw') return `<td class="num">${c.now ? `<b>${nf(c.now)}</b><div class="muted" style="font-size:10.5px">waiting to issue</div>` : '<span class="muted">0</span>'}</td>`;
  if (st.manual) {
    const t = (o.ticks || {})[st.k];
    const body = c.done ? (t ? `<span class="jw-st done">✓ ${esc(String(t.date || '').slice(5))}</span>${t.note ? `<div class="muted" style="font-size:10.5px;max-width:120px;white-space:normal">${esc(t.note.slice(0, 40))}</div>` : ''}`
      : '<span class="jw-st done" title="Every printed line has been given to a printer">✓ auto</span>') : '<span class="jw-st pend">Mark</span>';
    return `<td style="text-align:center"><a href="#" data-postick="${esc(o.orderNo)}|${st.k}" title="${esc(st.tip)}">${body}</a></td>`;
  }
  if (!c.need) return '<td class="num"><span class="muted" title="Not a step for this PO\'s lines">n/a</span></td>';
  const tone = c.done >= c.need ? 'done' : c.done > 0 ? 'prog' : 'pend';
  const extra = st.k === 'wip' ? `<div class="muted" style="font-size:10.5px">iss ${nf(o.wip.issued)} · rec ${nf(o.wip.received)} · QC ${nf(o.wip.qc)}</div>` : '';
  return `<td class="num"><span class="jw-st ${tone}">${nf(c.done)} / ${nf(c.need)}</span>${extra}</td>`;
}

async function renderOrdSteps() {
  await posLoadTicks();
  const all = posRows(ordApply(ordLines(), ordFilters()), POS_TICKS);
  const pick = /^step\d+$/.test(ORD_KPI) ? +ORD_KPI.slice(4) : -1;
  const openOnly = all.filter(o => o.open > 0 || o.at < POS_STEPS.length);
  const rows = pick >= 0 ? openOnly.filter(o => o.at === pick) : openOnly;
  ORD.rows = rows;
  $('odKpis').innerHTML = '<div class="jw-kpiname">PO — 10 steps · TEST VIEW (not on the live app)</div><div class="jw-kpis">'
    + ordKpiCard(nf(openOnly.length), 'POs not finished', 'doc', 'blue', 'the filters above decide which')
    + POS_STEPS.map((st, i) => { const n = openOnly.filter(o => o.at === i).length;
      return ordKpiCard(nf(n), st.l, i < 3 ? 'doc' : i < 8 ? 'cut' : i === 8 ? 'clock' : 'box', n ? 'amber' : 'green', 'POs stuck here',
        { key: 'step' + i, tip: (pick === i ? 'Showing only these POs. Click again for all.' : 'Show only the POs whose first unfinished step is this one.') + ' ' + st.tip }); }).join('')
    + '</div>';
  const head = '<thead><tr><th class="frz" style="text-align:left">PO</th><th>From</th><th>Date</th>'
    + POS_STEPS.map(st => `<th title="${esc(st.tip)}">${esc(st.l)}</th>`).join('') + '<th style="text-align:left">Stuck at</th></tr></thead>';
  const body = rows.slice(0, 600).map(o => '<tr>'
    + `<td class="frz" style="text-align:left"><a href="#" data-ordj="${esc(o.orderNo)}" title="Every line of this PO, start to finish" style="font-weight:600">${esc(o.orderNo)}</a></td>`
    + `<td>${esc(o.src)}</td><td>${esc(o.date)}</td>`
    + POS_STEPS.map(st => posCell(o, st)).join('')
    + `<td style="text-align:left">${o.at < POS_STEPS.length ? `<span class="jw-st pend">${esc(POS_STEPS[o.at].l)}</span>` : '<span class="jw-st done">All ten done</span>'}</td></tr>`).join('');
  $('odTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="${POS_STEPS.length + 4}" class="muted" style="padding:16px">No PO matches.</td></tr>`) + '</tbody>';
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(rows.length)} PO(s)${pick >= 0 ? ' stuck at ' + POS_STEPS[pick].l + ' — click the card again for all' : ''}`
    + (rows.length > 600 ? ' · showing the first 600' : '')
    + ' · finished POs are left out · PPC and Demand are ticked here (click them); every other figure comes from its own register · click a PO for its lines';
}

/* Wiring: the view joins the console's picker only where it is switched on; the ticks open their dialog. */
if (POS_ON && $('odView') && !$('odView').querySelector('option[value="steps"]')) {
  const op = document.createElement('option'); op.value = 'steps'; op.textContent = 'PO — 10 steps (test)';
  $('odView').insertBefore(op, $('odView').firstChild);
}
$('odTable').addEventListener('click', e => {
  const t = e.target.closest('[data-postick]'); if (!t) return;
  e.preventDefault();
  const [no, k] = t.getAttribute('data-postick').split('|');
  posTickOpen(no, k);
});
