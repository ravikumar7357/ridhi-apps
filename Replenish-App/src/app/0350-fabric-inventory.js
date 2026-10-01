/* ================= FABRIC INVENTORY =================
 *
 * A ledger, and the balance that falls out of it. Every movement is a row; the stock is never stored
 * anywhere, it is always the sum of the rows — so a wrong balance can always be traced to a
 * transaction rather than argued about.
 *
 * THE SIGNS ARE THE WHOLE THING. Opening and every kind of receipt add; every kind of issue or send
 * subtracts; an adjustment carries its own sign, so a correction of −20 must be entered as −20 and
 * is not silently flipped. `CUT_WHITE` moves cloth between locations without changing how much there
 * is, so it counts as zero here.
 *
 * WHAT IS NOT PORTED, AND WHY: the old tool also tracks WHERE fabric is — RFD store, fabric store,
 * cut vs running, and what is out with a printer against an open send. Not one row in this data uses
 * any of it: all 511 are form RUNNING, state PRINTED, factory MU, and only three transaction types
 * appear. Building that model on no data would be building a guess, so the balance here is by fabric
 * and colour, and this says so rather than showing empty location columns.
 */
const FAB_SIGN = {
  OPENING: 1, RECEIVE_WHITE: 1, RECEIVE_PRINTED: 1, RECEIVE_FROM_FABRICATOR: 1,
  SEND_TO_PRINTER: -1, ISSUE_TO_CUTTING: -1, ISSUE_TO_STITCHERS: -1, SEND_TO_FABRICATOR: -1,
  CUT_WHITE: 0,          // a move between locations, not a change in how much cloth exists
  ADJUST: 1,             // carries its own sign in the quantity
  /* ---- the cloth's earlier lives ----
   * Greige in from the mill, out to the processing house, and back as RFD. The two halves of that
   * round trip are separate movements on purpose: what is with the processor is neither greige stock
   * nor RFD stock, and a factory that cannot see that number cannot chase it. */
  RECEIVE_GREIGE: 1, ISSUE_TO_RFD: -1, RECEIVE_RFD: 1,
  /* RFD ALREADY ON THE FLOOR the day this started (Ravi, 2026-09-22). It opens a lot of its own, so it
   * can be issued to cutting like any other, and it is kept apart from "RFD back" so it never looks
   * like cloth that came back from a processor — which would make up a processing loss. */
  OPENING_RFD: 1,
  /* RFD BOUGHT READY — from a vendor, not processed from our own greige. A lot of its own, like the
   * opening stock, and never counted as "back from the processor". */
  PURCHASE_RFD: 1,
  /* WORKED OUT, NEVER TYPED (Ravi, 2026-09-22: "auto minus hona chahiye"). A cutting entry takes the
   * cloth its pieces need; an RFD requirement handed over in metres takes those metres. These rows are
   * built fresh from the cutting register and the RFD office every time — see fabAutoRows. */
  RFD_TO_PRINTER: -1,
};
const FAB_LABEL = {
  OPENING: 'Opening', RECEIVE_WHITE: 'Receive white', RECEIVE_PRINTED: 'Receive from printer',
  RECEIVE_FROM_FABRICATOR: 'Receive from fabricator', SEND_TO_PRINTER: 'Send to printer',
  ISSUE_TO_CUTTING: 'RFD to cutting', ISSUE_TO_STITCHERS: 'Issue to stitchers',
  SEND_TO_FABRICATOR: 'Send to fabricator', CUT_WHITE: 'Cut white', ADJUST: 'Adjust',
  RECEIVE_GREIGE: 'Greige received', ISSUE_TO_RFD: 'Greige sent for RFD', RECEIVE_RFD: 'RFD received',
  OPENING_RFD: 'RFD opening stock', PURCHASE_RFD: 'RFD bought (received ready)',
  RFD_TO_PRINTER: 'Handed to a printer (RFD requirement)',
};

/* ---- what the cloth IS at each point ----
 *
 * The state travels on the row. Rows written before any of this say PRINTED, which is what they were.
 */
const FAB_STATES = ['GREIGE', 'RFD', 'PRINTED'];
const FAB_STATE_LABEL = { GREIGE: 'Greige', RFD: 'RFD', PRINTED: 'Printed', WHITE: 'White' };
/** The state a movement leaves the cloth in — a receipt of RFD makes RFD, whatever the row says. */
const FAB_TXN_STATE = { RECEIVE_GREIGE: 'GREIGE', ISSUE_TO_RFD: 'GREIGE', RECEIVE_RFD: 'RFD', OPENING_RFD: 'RFD',
  PURCHASE_RFD: 'RFD', RFD_TO_PRINTER: 'RFD' };
const fabState = r => String((r && (FAB_TXN_STATE[r.txnType] || r.state)) || 'PRINTED').trim().toUpperCase();
const fabSign = tt => (FAB_SIGN[tt] === undefined ? 0 : FAB_SIGN[tt]);
/** An unknown transaction type moves nothing until somebody decides what it means. */
const fabKnown = tt => FAB_SIGN[tt] !== undefined;

let FAB = { rows: null, err: '', busy: false, at: '', shown: [] };

async function ensureFab() {
  if (FAB.rows === null) {
    FAB.busy = true; renderFab();
    try { FAB.rows = ptList(await ptGet('pt_fabInvLedger')); FAB.err = ''; }
    catch (e) { FAB.err = e.message || String(e); FAB.rows = FAB.rows || []; }
    await fabAutoLoad();
    FAB.at = ptStamp(); FAB.busy = false;
  }
  renderFab();
}

const fabQty = r => { const n = parseFloat(r && r.qty); return isFinite(n) ? n : 0; };

/* ================= RFD STOCK GOES DOWN ON ITS OWN =================
 *
 * Ravi, 2026-09-22, after loading the RFD opening stock: "ye rfd fabric kese auto minus hoga … konse
 * size ke tablecloth usme se hum nikalenge then uske according auto fabric deduct hona chahiye … jese
 * hi wo kisi vendor ko fabric req accept kare and usko handover kre to auto minus ho".
 *
 * TWO WAYS OUT, and nobody types either twice:
 *
 *   TO CUTTING — the store's own "RFD to cutting" entry: fabric, size, pieces, and the metres they
 *     consume (worked out from the size on that roll, and the figure can be typed over). Ravi, same
 *     day: "not need to issued to cutting by hand, i need only RFD to Cutting — Fabric, Size, Pcs, Mtr
 *     Cons." The cutting REGISTER (cut by SKU and order) does NOT take cloth as well: the store issues
 *     the cloth, the table records what it made of it, and counting both would take it twice.
 *   THE RFD OFFICE — every hand-over in METRES ("Mark sent") is worked out here, never typed. Pieces
 *     handed over were cut from cloth already issued to cutting.
 *
 * FROM WHEN: only what happened after the RFD opening stock was entered — per fabric, and for a fabric
 * with no opening stock, after the first opening stock of any. Before that, the count on the floor
 * already had it out. With no opening stock at all, nothing is taken: there is no count to take from.
 *
 * These rows are built, never stored: change a hand-over and the stock follows.
 */
const fabKey = v => String(v || '').trim().toUpperCase();
let FAB_AUTO = { err: '', start: '' };

async function fabAutoLoad() {
  const errs = [];
  /* The sizes offered in "RFD to cutting", and the widths the consumption is worked out on. */
  if (!PTG.mdb) { try { await ptLoadGates(); } catch (e) { /* the dialog says so if it cannot work metres out */ } }
  if (typeof RFD !== 'undefined' && RFD.decisions === null) {
    try { RFD.decisions = (await ptGet('pt_rfdDecisions')) || {}; }
    catch (e) { errs.push('the RFD office (' + (e.message || e) + ')'); }
  }
  FAB_AUTO.err = errs.length ? 'Could not read ' + errs.join(' or ') + ', so the stock below does not take off what was handed to printers.' : '';
}

/** When RFD started being counted: per fabric, and the first of all. ISO times, which sort as text. */
function fabRfdStart(ledger) {
  const by = {}; let first = '';
  (ledger || []).forEach(r => {
    if (!r || r.txnType !== 'OPENING_RFD') return;
    const t = String(r.createdAt || '');
    if (!t) return;
    const k = fabKey(r.fabricType);
    if (!by[k] || t < by[k]) by[k] = t;
    if (!first || t < first) first = t;
  });
  return { by, first };
}

/** The metres one piece of a size takes on one roll — size + 2", laid whichever way wastes least. */
function fabCutPerPiece(fabric, size) {
  const c = ptCutOf(size);
  if (c.why) return { why: c.why };
  const w = voFabWidthM(fabric) / 0.0254;
  if (!(w > 0)) return { why: 'the width of ' + (fabric || 'this fabric') + ' is not known — set it under Masters → Fabric type' };
  const on = ptLayOn(c, w, '');
  if (!on) return { why: size + ' (+2") does not fit on ' + Math.round(w) + '" cloth' };
  return { metres: Math.round(on.metres * 1000) / 1000, across: on.across, widthIn: Math.round(w) };
}

/** The ledger-shaped rows the RFD office adds. */
function fabAutoRows(ledger, decisions) {
  const st = fabRfdStart(ledger || FAB.rows || []);
  const out = [];
  FAB_AUTO.start = st.first;
  if (!st.first) return out;
  const since = fab => st.by[fabKey(fab)] || st.first;
  const day = at => ptIsoDate(at) || String(at).slice(0, 10);
  const dec = decisions || (typeof RFD !== 'undefined' ? RFD.decisions : null) || {};
  Object.keys(dec).forEach(rid => {
    const d = dec[rid];
    if (!d || d.unit === 'pcs' || !String(d.fabric || '').trim()) return;
    rfdSends(d).forEach((x, i) => {
      const at = String(x.at || ''), q = parseFloat(x.qty) || 0;
      if (!(q > 0) || !at || at <= since(d.fabric)) return;
      out.push({ _id: 'auto_' + rid + '_' + i, id: 'auto_' + rid + '_' + i, auto: 'printer', txnType: 'RFD_TO_PRINTER',
        date: day(at), createdAt: at, fabricType: String(d.fabric).trim(), colour: '', state: 'RFD', qty: q,
        orderNo: d.orderNo || '', counterpartyName: d.vendorName || d.vendorCode || '',
        remarks: 'RFD requirement handed over' + (x.note ? ' · ' + x.note : ''), createdBy: x.by || '' });
    });
  });
  return out;
}
/** The ledger as the stock sees it: what was typed, and what the floor's own records took. */
const fabAll = () => (FAB.rows || []).concat(fabAutoRows(FAB.rows || []));
const fabMove = r => fabQty(r) * fabSign(r && r.txnType);

/** Balance per fabric type + colour, out of the ledger. */
function fabBalances(rows) {
  const b = {};
  rows.forEach(r => {
    /* THE STATE IS PART OF WHAT THE CLOTH IS. Ten metres of greige and ten of RFD are not twenty
     * metres of anything — one has to be processed before it can be the other. */
    const k = `${String(r.fabricType || '').trim()}|${String(r.colour || '').trim()}|${fabState(r)}`;
    if (!b[k]) b[k] = { fabricType: r.fabricType || '', colour: r.colour || '', state: fabState(r),
      inQty: 0, outQty: 0, qty: 0, n: 0, unknown: 0 };
    const e = b[k];
    e.n++;
    if (!fabKnown(r.txnType)) { e.unknown++; return; }
    const m = fabMove(r);
    if (m >= 0) e.inQty += m; else e.outQty += -m;
    e.qty += m;
  });
  return Object.values(b).sort((a, b2) =>
    String(a.fabricType).localeCompare(String(b2.fabricType)) || String(a.colour).localeCompare(String(b2.colour)));
}

function fabFilters() {
  const v = id => ($(id) || {}).value || '';
  return { txn: v('fbTxn'), fab: v('fbFab'), col: v('fbCol'), cp: v('fbCp'), state: v('fbState'),
    q: v('fbQ').trim().toLowerCase(), d1: v('fbD1'), d2: v('fbD2') };
}

function fabApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'state' && f.state && fabState(r) !== f.state) return false;
    if (skip !== 'txn' && f.txn && r.txnType !== f.txn) return false;
    if (skip !== 'fab' && f.fab && !ptCi(r.fabricType, f.fab)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.colour, f.col)) return false;
    if (skip !== 'cp' && f.cp && !ptCi(r.counterpartyName || r.counterparty, f.cp)) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.fabricType, r.colour, r.counterpartyName, r.counterparty, r.orderNo, r.sku, r.remarks].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    // These dates are plain YYYY-MM-DD, so they compare as text — no parsing needed and none guessed.
    if (skip !== 'date' && f.d1 && String(r.date || '') < f.d1) return false;
    if (skip !== 'date' && f.d2 && String(r.date || '') > f.d2) return false;
    return true;
  });
}

/**
 * Where the cloth is, from the mill to the cutting table.
 *
 * Greige comes in, goes to the processing house, comes back as RFD, and leaves for cutting. Four
 * numbers, and the one that never had a home before is the middle one: cloth that is WITH the
 * processor is neither greige stock nor RFD stock, and a factory that cannot see that figure cannot
 * chase it.
 *
 * PROCESS LOSS IS SHOWN, NOT HIDDEN. A hundred metres of greige comes back as ninety-something — that
 * is what bleaching does. The percentage is the number worth watching: one processor at 6% and
 * another at 14% is a conversation, and it can only be had if somebody writes it down.
 */
function fabFlowRows(rows) {
  const by = new Map();
  (rows || []).forEach(r => {
    const k = String(r.fabricType || '').trim().toUpperCase();
    if (!k) return;
    let g = by.get(k);
    if (!g) { g = { fabricType: r.fabricType || '', greigeIn: 0, toRfd: 0, rfdIn: 0, rfdOpen: 0, rfdBuy: 0, rfdOut: 0, printedOut: 0,
      toPrinter: 0 }; by.set(k, g); }
    const q = fabQty(r);
    if (r.txnType === 'RECEIVE_GREIGE') g.greigeIn += q;
    else if (r.txnType === 'ISSUE_TO_RFD') g.toRfd += q;
    else if (r.txnType === 'RECEIVE_RFD') g.rfdIn += q;
    else if (r.txnType === 'OPENING_RFD') g.rfdOpen += q;
    else if (r.txnType === 'PURCHASE_RFD') g.rfdBuy += q;
    else if (r.txnType === 'RFD_TO_PRINTER') g.toPrinter += q;
    else if (r.txnType === 'ISSUE_TO_CUTTING') {
      if (fabState(r) === 'RFD') g.rfdOut += q; else g.printedOut += q;
    }
  });
  return [...by.values()].map(g => Object.assign(g, {
    greigeLeft: g.greigeIn - g.toRfd,
    withProcessor: Math.max(0, g.toRfd - g.rfdIn),
    /* Only counted once the cloth is back: cloth still at the processor has not lost anything yet. */
    loss: Math.max(0, Math.min(g.toRfd, g.toRfd - g.rfdIn) * (g.rfdIn > 0 ? 1 : 0)),
    lossPct: g.rfdIn > 0 && g.toRfd > 0 ? Math.round(((g.toRfd - g.rfdIn) / g.toRfd) * 1000) / 10 : null,
    rfdLeft: g.rfdOpen + g.rfdBuy + g.rfdIn - g.rfdOut - g.toPrinter,
  })).sort((a, b) => (b.greigeIn + b.rfdIn + b.rfdOpen + b.rfdBuy) - (a.greigeIn + a.rfdIn + a.rfdOpen + a.rfdBuy));
}

function renderFabFlow(all) {
  const f = fabFilters();
  const rows = fabApply(all, f);
  const flow = fabFlowRows(rows);
  FAB.shown = flow;
  const s = k => flow.reduce((a, x) => a + (x[k] || 0), 0);
  const lossPct = s('toRfd') > 0 && s('rfdIn') > 0
    ? Math.round(((s('toRfd') - s('rfdIn')) / s('toRfd')) * 1000) / 10 : null;
  $('fbKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Greige → RFD → cutting</span>
      <span class="kpiwhen">read live${FAB.at ? ' · ' + esc(FAB.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric" title="Greige received from the mill and not yet sent for processing."><div class="v">${nf(Math.round(s('greigeLeft')))}</div><div class="l">Greige in stock</div></div>
      <div class="metric" title="Sent for processing and not yet back. Neither greige stock nor RFD stock."><div class="v"${s('withProcessor') ? ' style="color:#7f6000"' : ''}>${nf(Math.round(s('withProcessor')))}</div><div class="l">With the processor</div></div>
      <div class="metric" title="RFD received and not yet issued to cutting."><div class="v" style="color:#166534">${nf(Math.round(s('rfdLeft')))}</div><div class="l">RFD in stock</div></div>
      <div class="metric" title="RFD issued to the cutting table (RFD to cutting)."><div class="v">${nf(Math.round(s('rfdOut')))}</div><div class="l">Gone to cutting</div></div>
      <div class="metric" title="RFD handed to printers in metres from the RFD Requirements screen."><div class="v">${nf(Math.round(s('toPrinter')))}</div><div class="l">Given to printers</div></div>
      ${lossPct == null ? '' : `<div class="metric" title="Metres sent for processing, less metres that came back."><div class="v" style="color:var(--bad)">${lossPct}%</div><div class="l">Process loss</div></div>`}
    </div></div>`;

  const dash = v => (v ? nf(Math.round(v)) : '<span class="muted">—</span>');
  const head = '<thead><tr>' + ['Fabric', 'Greige in', 'Sent for RFD', 'Greige left', 'With processor',
    'RFD back', 'Loss', 'RFD opening', 'RFD bought', 'To cutting', 'To printers', 'RFD left']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ' class="num"'}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('fbTable').innerHTML = head + '<tbody>' + flow.map(g => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(g.fabricType)}</td>`
    + `<td class="num">${nf(Math.round(g.greigeIn))}</td>`
    + `<td class="num">${nf(Math.round(g.toRfd))}</td>`
    + `<td class="num" style="font-weight:700${g.greigeLeft < 0 ? ';color:var(--bad)' : ''}">${nf(Math.round(g.greigeLeft))}</td>`
    + `<td class="num"${g.withProcessor ? ' style="color:#7f6000;font-weight:700"' : ''}>${g.withProcessor ? nf(Math.round(g.withProcessor)) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="color:#166534">${nf(Math.round(g.rfdIn))}</td>`
    + `<td class="num">${g.lossPct == null ? '<span class="muted">—</span>' : `<span style="color:var(--bad)">${g.lossPct}%</span>`}</td>`
    + `<td class="num">${dash(g.rfdOpen)}</td>`
    + `<td class="num" style="color:#166534">${dash(g.rfdBuy)}</td>`
    + `<td class="num">${g.rfdOut ? `<a href="#" data-fbauto="ISSUE_TO_CUTTING" data-fbfab="${esc(g.fabricType)}">${nf(Math.round(g.rfdOut))}</a>` : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${g.toPrinter ? `<a href="#" data-fbauto="RFD_TO_PRINTER" data-fbfab="${esc(g.fabricType)}">${nf(Math.round(g.toPrinter))}</a>` : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="font-weight:700${g.rfdLeft < 0 ? ';color:var(--bad)' : ''}"${g.rfdLeft < 0 ? ' title="More went out than came in — is its opening stock entered under this name?"' : ''}>${nf(Math.round(g.rfdLeft))}</td></tr>`).join('') + '</tbody>';
  $('fbMsg').className = FAB_AUTO.err ? 'err' : 'muted';
  $('fbMsg').innerHTML = esc(`${nf(flow.length)} fabric(s) · `)
    + 'To cutting is the store\'s "RFD to cutting" entry; To printers comes off on its own from the RFD office — click a number to see the entries'
    + (FAB_AUTO.err ? ' · ' + esc(FAB_AUTO.err) : '');
}

/**
 * Every lot, and where its cloth is.
 *
 * This is the answer to "which bale was that?" — the bill it came on, the mill that sent it, the
 * processor that has it, what is left of it, and what it lost on the way. A fabric total cannot
 * answer any of those, which is why the lot exists.
 */
function renderFabLots(all) {
  const f = fabFilters();
  const rows = fabApply(all, f);
  const lots = fabLots(rows).filter(g => g.lot !== FAB_NO_LOT || g.n);
  FAB.shown = lots;
  const s = k => lots.reduce((a, g) => a + (g[k] || 0), 0);
  $('fbKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Lots</span>
      <span class="kpiwhen">read live${FAB.at ? ' · ' + esc(FAB.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(lots.length)}</div><div class="l">Lots</div></div>
      <div class="metric"><div class="v">${nf(Math.round(s('greigeLeft')))}</div><div class="l">Greige left</div></div>
      <div class="metric"><div class="v"${s('withProcessor') ? ' style="color:#7f6000"' : ''}>${nf(Math.round(s('withProcessor')))}</div><div class="l">With processors</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(Math.round(s('rfdLeft')))}</div><div class="l">RFD left</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Lot', 'Date', 'Fabric', 'Bill', 'Mill', 'Greige in', 'Sent',
    'Greige left', 'With', 'RFD back', 'Loss', 'RFD left', 'To cutting']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 5 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('fbTable').innerHTML = head + '<tbody>' + lots.map(g => '<tr>'
    + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(g.lot)}</td>`
    + `<td style="text-align:left;font-size:12px">${esc(g.date) || '<span class="muted">—</span>'}</td>`
    + `<td style="text-align:left">${esc(g.fabricType)}</td>`
    + `<td style="text-align:left;font-size:12px">${esc(g.bill) || '<span class="muted">—</span>'}</td>`
    + `<td style="text-align:left;font-size:12px">${esc(g.mill) || '<span class="muted">—</span>'}</td>`
    + `<td class="num">${nf(Math.round(g.greigeIn))}</td>`
    + `<td class="num">${nf(Math.round(g.toRfd))}</td>`
    + `<td class="num" style="font-weight:700">${nf(Math.round(g.greigeLeft))}</td>`
    + `<td class="num"${g.withProcessor > 0 ? ' style="color:#7f6000;font-weight:700"' : ''} title="${esc(g.processor || '')}">${
        g.withProcessor > 0 ? nf(Math.round(g.withProcessor)) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="color:#166534">${nf(Math.round(g.rfdIn))}</td>`
    + `<td class="num">${g.lossPct == null ? '<span class="muted">—</span>' : `<span style="color:var(--bad)">${g.lossPct}%</span>`}</td>`
    + `<td class="num" style="font-weight:700">${nf(Math.round(g.rfdLeft))}</td>`
    + `<td class="num">${nf(Math.round(g.rfdOut))}</td></tr>`).join('') + '</tbody>';
  $('fbMsg').className = 'muted';
  $('fbMsg').textContent = `${nf(lots.length)} lot(s) · each one a delivery, followed from the bill it came on to the cutting table`;
}

/** The store has its own buttons; the fabric ledger keeps its own. */
function fabTools(view) {
  const store = view === 'store' || view === 'storemov';
  [['fbStoreNew', store && ptCanEdit()], ['fbEntry', !store], ['fbPoNew', false], ['fbPoSet', false]].forEach(([id, on]) => {
    const el = $(id); if (el && id.indexOf('Po') < 0) el.classList.toggle('hide', !on);
  });
  if ($('fbTemplate')) $('fbTemplate').textContent = store ? 'Opening stock template' : 'Template';
  if ($('fbImport')) $('fbImport').textContent = store ? 'Upload opening stock' : 'Bulk upload';
}

