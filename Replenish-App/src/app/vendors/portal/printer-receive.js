/* ================= PRINTER'S VIEW · RECEIVE ON THE LINE =================
 * Ravi, 19 Nov: "lets merge these two pages and show in the printer view page only … the user which was seeing from his access at the
 * printed fabric in page will work on this page and receive from this page … and can also access what the printer is seeing but only the
 * view access … the printer fabrics also come in sheeting … visibility of the fabric that went, like sheeting 82 or cambric".
 *
 * Vendors → Printer's portal (view) is now the one place printed goods are taken in (Design A, chosen 19 Nov). An office user picks a
 * printer and every tab (Bulk, Custom, Vendor sent) is the same one table: Order, Item, Fabric, Ordered, Sent by printer, Received, Due,
 * Receive. "Orders with printers · receive" on Printed fabric in is gone.
 *   WHO: the "Printed fabric in" right (flchl) or an admin receives. The view-only box (vpview) sees the same table with no Receive.
 *   A printer's own sign-in never sees this table — it keeps its own screens.
 *   RECEIVE N takes in what the printer entered as sent and we have not taken in yet, dated today, through the save every receive screen
 *   uses (flowDueRecvSave) — so the challans, the no-RFD-challan record and RFD stock work as before. ✎ opens a box for another amount,
 *   up to what is still to come. A line the printer entered nothing for gets the box straight away.
 *   A CLOTH LINE FOR SEVERAL SKUs (one print for Pillow 16x16 and 18x18) is shared out by what was ordered for each, never more than each
 *   still has to come (Ravi, 19 Nov: "based on the order sended").
 * ERRORS: a failed save is said in red under the table and nothing is taken in. If the figures to receive cannot be read, the table still
 * shows, without Receive, and says why. The figures are the same read Printed fabric in made (flowEnsureData), and only for those who
 * may receive. */
const VPR = { less: '', loading: null, err: '', said: '', at: 0, saving: '' };   // less: the line whose ✎ box is open; at: when the figures were last asked for; saving: the line being saved
const VPR_RETRY_MS = 60e3;   // a read that came back short is tried again on a later draw, at most once a minute
const VPR_TABS = ['bulk', 'shop', 'vsent'];

/** The office's table (not the printer's own screens): someone looking at a printer's portal. */
const vprOn = () => !!(typeof VP !== 'undefined' && VP.viewAs && !(typeof NAV_IS_VENDOR !== 'undefined' && NAV_IS_VENDOR));
/** May take printed goods in here: the "Printed fabric in" right, or an admin. The view-only box only looks. */
const vprMay = () => vprOn() && !!FLOW_ON && flowMay('flchl');
/** Everything the Receive figures are worked out from has been read. */
const vprReady = () => !!(FLOW.ppc && FLOW.ch && typeof VO !== 'undefined' && VO.rows);

/** Read what Receive needs once, then draw again. Never throws: a failed read leaves the table without Receive and says why. */
function vprEnsure() {
  if (!vprMay() || vprReady() || VPR.loading || Date.now() - VPR.at < VPR_RETRY_MS) return;
  VPR.err = ''; VPR.at = Date.now();
  VPR.loading = flowEnsureData()
    .catch(e => { VPR.err = (e && e.message) || String(e); console.warn('[printer\'s view] receive figures not read:', VPR.err); })
    .finally(() => {
      VPR.loading = null;
      const short = (FLOW.readErr || []).join(', ');
      if (!vprReady() && !VPR.err) { VPR.err = short || 'not all of it came'; console.warn('[printer’s view] receive figures not complete:', VPR.err); }
      if (typeof renderVp === 'function') renderVp();
    });
}

/** Refresh on the portal: the challans are read again too, so what someone took in on another computer is not offered twice. */
function vprRefresh() {
  VPR.at = 0;
  if (!vprMay() || !vprReady()) return;
  flowLoad(true).then(() => renderVp()).catch(e => console.warn("[printer's view] challans not read again:", (e && e.message) || e));
}

/* ---- what one portal line still has to come ---- */
/** The Production flow lines a portal line stands for (its parts) — the ruffle cloth is received on its challan, not here. */
const vprKeys = l => { const parts = voParts(l).length ? voParts(l) : (l.flowKey ? [l.flowKey] : []);   // an older line names its flow line alone, as vpRecvOf reads it
  return [...new Set(parts.map(p => String(p).split('|')).filter(([, part]) => part !== 'ruffle').map(([k]) => k))]; };
/** Every line still owed by a printer, by its flow key — built once per read of the flow, not once per row drawn. */
let VPR_IX = { rows: null, vo: null, map: new Map() };
function vprDueIndex() {
  const rows = flowRows(), vo = VO.rows;
  if (VPR_IX.rows !== rows || VPR_IX.vo !== vo) VPR_IX = { rows, vo, map: new Map(flowDueRows('', false).map(x => [x.l.key, x])) };
  return VPR_IX.map;
}
/** The flow lines behind a portal line that this printer still owes: each with its share of the line's order and what may still come.
 * A flow line drawn on two portal lines (front and back print) is shared half and half, the way Received is shown. */
function vprTargets(o, l) {
  if (!vprReady()) return [];
  const ix = vprDueIndex(), cnt = vpRecvCnt(o, l), code = obUC(VP.code);
  return vprKeys(l).map(k => ix.get(k)).filter(x => x && obUC(x.code) === code).map(x => {
    const share = cnt[x.l.key] || 1, most = flowMostOf(x.unit, x.need, x.back);   // cloth: 10% over the order, as on every receive screen
    return { key: x.l.key, x, weight: x.need / share, cap: flowR2(most / share) };
  });
}
/** What the Receive cell offers on a portal line. Pieces: the most is whole on every flow line, so it is never offered and then refused. */
function vprOffer(o, l) {
  const unit = o.orderType === 'running' ? 'm' : 'pcs', t = vprTargets(o, l), list = vpVsOf(o, l);
  const whole = n => unit === 'pcs' ? Math.floor(n + 1e-9) : flowR2(n);
  const most = flowR2(t.reduce((a, p) => a + whole(p.cap), 0)), entered = vpVsSum(list);
  const pending = flowR2(Math.max(0, vpSentKept(o, l) - vpRecvOf(l, o).qty));   // what we rejected is not offered again until the printer sends it again
  return { t, unit, most, entered, pending, n: whole(Math.min(pending, most, vprKeysPending(o, t))), wait: vpVsWait(list) };
}
/* A FLOW LINE ON TWO PORTAL LINES (a quilt's front and back print): Received is shown half on each, so a line alone would offer again cloth
 * already taken in on the other. What the printer entered on every portal line of the flow line, less what came back on it, is the limit. */
function vprKeysPending(o, t) {
  const ix = flowChIndex();
  return flowR2(t.reduce((sum, p) => {
    const sent = voLines(o).filter(m => m && vprKeys(m).includes(p.key)).reduce((a, m) => a + vpSentKept(o, m) / vprKeys(m).length, 0);
    return sum + Math.max(0, sent - (+((ix[p.key] || {}).recv) || 0));
  }, 0));
}

/**
 * Share a figure out over the flow lines of one portal line, by what was ordered for each (weight), never more than each may still
 * take (cap). Pieces stay whole: the odd piece goes to the line with the biggest fraction that still has room. Null when the figure is
 * more than all of them can take.
 */
function vprSplit(q, parts, whole) {
  const room = parts.filter(p => p.cap > 0), total = room.reduce((a, p) => a + p.cap, 0);
  if (!(q > 0) || q > total + 1e-9) return null;
  const give = vprShareOut(q, room);
  return whole ? vprWholePieces(q, room, give) : vprRoundMetres(q, room, give);
}
/** Fill by weight; a line that would get more than its cap is filled to the cap and the rest shared over the others again. */
function vprShareOut(q, room) {
  const give = {}, w = p => (p.weight > 0 ? p.weight : 1);
  let left = q, open = room.slice();
  while (open.length && left > 1e-9) {
    const sum = open.reduce((a, p) => a + w(p), 0), full = open.filter(p => left * w(p) / sum >= p.cap - 1e-9);
    if (!full.length) { open.forEach(p => { give[p.key] = left * w(p) / sum; }); break; }
    full.forEach(p => { give[p.key] = p.cap; left -= p.cap; });
    open = open.filter(p => !full.includes(p));
  }
  return give;
}
/** The pieces left after rounding down go one a line, biggest fraction first, round after round, so no line takes them all. */
function vprWholePieces(q, room, give) {
  const out = {}; room.forEach(p => { out[p.key] = Math.floor((give[p.key] || 0) + 1e-9); });
  let rest = Math.round(q - Object.values(out).reduce((a, v) => a + v, 0));
  const byFraction = room.slice().sort((a, b) => ((give[b.key] || 0) % 1) - ((give[a.key] || 0) % 1));
  while (rest > 0) {
    const before = rest;
    byFraction.forEach(y => { if (rest > 0 && out[y.key] + 1 <= Math.floor(y.cap + 1e-9)) { out[y.key] += 1; rest -= 1; } });
    if (rest === before) return null;
  }
  return vprOnlyGiven(out);
}
function vprRoundMetres(q, room, give) {
  const out = {}; room.forEach(p => { out[p.key] = flowR2(give[p.key] || 0); });
  const diff = flowR2(q - Object.values(out).reduce((a, v) => a + v, 0));
  if (diff) {   // the rounding left over goes to a line with room for it, never over its cap
    const p = room.find(y => y.cap - out[y.key] >= diff - 1e-9 && out[y.key] + diff >= 0); if (!p) return null;
    out[p.key] = flowR2(out[p.key] + diff);
  }
  return vprOnlyGiven(out);
}
const vprOnlyGiven = out => Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0));

/* ---- the cells ---- */
/** Fabric: the cloth it is printed on (Sheeting 82, Cambric 60) and, small under it, the printed fabric's SKU. */
function vprFabricOf(o, l) {
  const run = o.orderType === 'running', due = vprReady() ? vprKeys(l).map(k => vprDueIndex().get(k)).find(Boolean) : null;
  let m = {}; try { m = cutSkuOf(l.sku) || {}; } catch (e) { m = {}; }
  return { cloth: String((run ? l.fabricType : '') || (due && due.l.fabric) || m.fabric || '').trim(), sub: run ? (l.sku || '') : 'printed as pieces' };
}
/** Receive: "Receive 5 m" and ✎, or a box when the printer entered nothing; a shared cloth line says where it goes. */
function vprRecvCell(o, l, id) {
  if (!vprReady()) return `<td><span class="muted" style="font-size:11px">${VPR.err ? 'could not read the figures — press Refresh' : 'reading…'}</span></td>`;
  if (VPR.saving === id) return '<td style="text-align:right"><button type="button" disabled style="width:auto;padding:5px 12px;font-size:12.5px">Saving…</button></td>';
  const v = vprOffer(o, l);
  if (!v.t.length || !(v.most > 0)) return '<td><span class="muted">—</span></td>';
  const q = n => flowQtyTxt(n, v.unit), note = (t, c) => `<div style="font-size:11px;color:${c || '#b45309'};margin-top:3px;white-space:normal">${t}</div>`;
  const waitTxt = v.wait > 0 ? note(`+${esc(q(v.wait))} waiting approval`) : '';
  const box = (val, why) => `<span style="display:inline-flex;gap:4px;align-items:center"><input data-vprbox="${esc(id)}" type="number" min="${v.unit === 'pcs' ? 1 : 0.01}" max="${esc(String(v.most))}" step="${v.unit === 'pcs' ? 1 : 0.01}" value="${esc(String(val || ''))}" placeholder="0" style="width:70px;padding:3px 6px;font-size:12px;text-align:right" aria-label="How much came">`
    + `<button type="button" data-vprgo="${esc(id)}" style="width:auto;padding:4px 10px;font-size:12px">Receive</button>${VPR.less === id ? '<button type="button" class="ghost" data-vprx="1" style="width:auto;padding:4px 8px;font-size:12px">Cancel</button>' : ''}</span>`
    + note(`${why}At most ${esc(q(v.most))} — still to come`, 'var(--muted,#6b7686)') + waitTxt;
  const cell = inner => `<td style="text-align:right;white-space:nowrap"><div style="width:230px;margin-left:auto;white-space:normal">${inner}${vprSplitHint(v)}</div></td>`;
  if (!v.entered) return cell(box('', '<span style="color:#b45309">Printer has not entered it.</span> '));
  if (!(v.n > 0)) return cell(box('', '<span style="color:#b45309">All the printer entered is in.</span> '));
  if (VPR.less === id) return cell(box(v.n, '') + vprRejLink(v, id));
  return cell(`<button type="button" data-vprgo="${esc(id)}" data-q="${esc(String(v.n))}" style="width:auto;padding:5px 12px;font-size:12.5px;background:#166534;border-color:#166534">Receive ${esc(q(v.n))}</button>`
    + ` <a href="#" data-vprless="${esc(id)}" title="Another amount" style="font-size:13px;text-decoration:none">✎</a>${vprRejLink(v, id)}${waitTxt}`);
}
/** Reject: only when the printer entered something we have not taken in. */
const vprRejLink = (v, id) => (v.pending > 0 ? `<div style="margin-top:3px"><a href="#" data-vprrej="${esc(id)}" style="font-size:11.5px;color:var(--bad)">Reject</a></div>` : '');
/** "Pillow 16x16 3 m · Pillow 18x18 2 m": where Receive N goes on a cloth line for several SKUs. */
function vprSplitHint(v) {
  if (v.t.length < 2 || !(v.n > 0)) return '';
  const got = vprSplit(v.n, v.t, v.unit === 'pcs') || {};
  const name = x => [x.r.articleSubtype || x.r.articleType, x.r.size].filter(Boolean).join(' ') || x.sku;
  return `<div style="font-size:11px;color:#475569;margin-top:4px;text-align:left">${v.t.map(p => `${esc(name(p.x))} <b>${esc(flowQtyTxt(got[p.key] || 0, v.unit))}</b>`).join(' · ')}</div>`;
}

/* ---- the table ---- */
/** One table for every tab: the order sheet of the sketch (vpSheetCells, vendor-portal.js, 21 Nov) and Receive at the end. */
function vprSheet(rows, f) {
  const may = vprMay(), items = vpSheetLines(rows, f);
  if (!items.length) return VP_SHEET_EMPTY;
  const body = items.map(({ o, l, i, due }) => `<tr class="${vpDueClass(due)}">` + vpSheetCells(o, l, '')
    + (may ? vprRecvCell(o, l, o.id + '|' + i) : '') + '</tr>').join('');
  return vpSheetTable(VP_SHEET_COLS.concat(may ? ['Receive'] : []), body);
}

/* ---- taking it in ---- */
/** Take in q on one portal line, shared over its flow lines; '' when saved, else what is wrong (nothing is saved then). One save at a time:
 * a redraw during a save draws a fresh button, and a second press must not take the same goods in twice. */
async function vprReceive(id, q, rows) {
  if (VPR.saving) return 'Still saving the last receive — wait a moment.';
  VPR.saving = id;
  try { return await vprReceiveLine(id, q, rows); } finally { VPR.saving = ''; }
}
async function vprReceiveLine(id, q, rows) {
  const [oid, i] = String(id).split('|'), o = (rows || VP.rows || []).find(r => r && r.id === oid), l = o && voLines(o)[+i];
  if (!l) return 'That line is not on screen any more — press Refresh.';
  const v = vprOffer(o, l), what = `${o.orderNo || o.id} ${l.sku || ''}`.trim();
  if (!v.t.length) return `${what}: nothing is still to come on this line.`;
  if (!(q > 0)) return `Type how much came for ${what}.`;
  if (v.unit === 'pcs' && q !== Math.round(q)) return `${what}: pieces are whole.`;
  const got = q > v.most + 1e-9 ? null : vprSplit(q, v.t, v.unit === 'pcs');
  if (!got) return `${what}: ${flowQtyTxt(q, v.unit)} is more than the ${flowQtyTxt(v.most, v.unit)} still to come.`;
  const er = await flowDueRecvSave(v.t[0].x.code || v.t[0].x.printer, got, { date: dToday(), note: '', deduct: true });
  if (er) return er;
  if (typeof flowVoProgSync === 'function') flowVoProgSync();   // the printer's copy of what came back (flowProg), so its portal shows it
  VPR.less = '';
  VPR.said = flowDueRecvSave.said + " The printer's portal shows it in a few seconds.";
  return '';
}
/* FROM THE STORE (Ravi, 24 Nov: "yaha par bhi ye phle receive ke liye show ho, jese vendor sent me hota h"): every line any printer has sent that we have not
 * taken in, each with what Receive offers — the same figures and the same receive as the portal's Receive button. The offer is worked out per printer
 * (VP.code is that printer's for the moment, and put back at once). Null while the figures are not read. Oldest batch first. */
function vprPendingAll() {
  if (!vprReady()) return null;
  const keep = VP.code, out = [];
  try {
    (VO.rows || []).forEach(o => {
      if (!o || o.status === 'Cancelled' || !o.vendorCode || /^TEST/i.test(String(o.orderNo || ''))) return;
      VP.code = o.vendorCode;
      voLines(o).forEach((l, i) => {
        if (!l || l.cancelled) return;
        const sent = vpSentKept(o, l), got = vpRecvOf(l, o).qty;
        if (!(sent - got > 0.01)) return;
        const at = vpVsOf(o, l).filter(vpVsCounts).map(b => String(b.at || '')).filter(Boolean).sort()[0] || '9999';
        out.push({ id: o.id + '|' + i, o, l, v: vprOffer(o, l), sent, got, at, printer: o.vendorName || voName(o.vendorCode), code: o.vendorCode });
      });
    });
  } finally { VP.code = keep; }
  return out.sort((a, b) => a.at.localeCompare(b.at) || String(a.o.orderNo || '').localeCompare(String(b.o.orderNo || '')));
}
/** Take in q on one line of any printer's order (the Store's Receive button). */
async function vprReceiveFor(id, q) {
  const oid = String(id).split('|')[0], o = (VO.rows || []).find(r => r && r.id === oid);
  if (!o) return 'That order is not on the list any more — press Refresh.';
  const keep = VP.code; VP.code = o.vendorCode;
  try { return await vprReceive(id, q, VO.rows); } finally { VP.code = keep; }
}
function vprSay(er) {
  const m = $('vpMsg'); if (!m) return;
  m.className = er ? 'err' : 'muted'; m.textContent = er || VPR.said;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', async e => {
  const t = e.target; if (!t || !t.closest) return;
  const less = t.closest('a[data-vprless]'); if (less) { e.preventDefault(); VPR.less = less.getAttribute('data-vprless'); renderVp(); return; }
  if (t.closest('[data-vprx]')) { e.preventDefault(); VPR.less = ''; renderVp(); return; }
  const go = t.closest('[data-vprgo]'); if (!go || go.disabled) return;
  e.preventDefault(); go.disabled = true;
  const id = go.getAttribute('data-vprgo'), box = document.querySelector(`input[data-vprbox="${CSS.escape(id)}"]`);
  const er = await vprReceive(id, flowR2(+(box ? box.value : go.getAttribute('data-q')) || 0));
  renderVp(); vprSay(er);
});
/* A typed figure comes back down to what may still come (the box's max). */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('input', e => {
  const t = e.target; if (!t || !t.dataset || t.dataset.vprbox == null || !t.max) return;
  if (+t.value > +t.max) t.value = t.max;
});

/* ---- extra pieces to approve, for the printer on screen (admins) ---- */
/** The PRINTER'S VIEW bar, filled on every draw: how many extras this printer is waiting on (admins). */
function vprBarSync() {
  const slot = $('flVpX'); if (!slot) return;
  const n = vprOn() && ME.admin && vprReady() ? flowExtraAsks(VP.code).length : 0;
  slot.innerHTML = (n ? `<button type="button" data-vprxopen="1" style="width:auto;padding:6px 12px;font-size:12.5px;background:#b45309;border-color:#b45309">Extra pieces to approve <span class="navbadge" style="position:static;background:#fff;color:#b45309">${nf(n)}</span></button>` : '');
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target; if (!t || !t.closest || !t.closest('[data-vprxopen]')) return;
  e.preventDefault();
  /* The answer is written on the printer's own branch: read it again when the window closes, so the table counts what was approved. */
  flowExtraOpen(VP.code, async () => { VP.rows = null; await ensureVp(); });
});

/* HISTORY IN THE TAB ROW (Ravi, 20 Nov), right after Completed — which came back on 21 Nov ("bring the complete button back too"). For
 * those who may receive; a printer's own sign-in has no History: it cannot read our challans, which History is made from. */
function vprTabSync() {
  const done = $('vpTabDone'); if (!done || !done.insertAdjacentHTML) return;
  const show = vprMay() && vprReady() && !!VP.code;
  if (show && !$('vpTabRx')) done.insertAdjacentHTML('afterend', '<button type="button" id="vpTabRx" class="ghost" data-vprhist="1" title="What came from this printer, with the fabric — and what was rejected">History</button>');
  if ($('vpTabRx')) $('vpTabRx').classList.toggle('hide', !show);
}

/* ---- History: what came from the printer on screen ----
 * Ravi, 19 Nov: "add a history button to see what fabric we have got". Every receipt from this printer, newest first: the day, the
 * challan, the order, the item, the fabric it was printed on, how much and who took it in — over a date range (the last 30 days to start),
 * with the totals by fabric and an Excel. Read from the challans already on screen (flowRecvRows); nothing is saved. Those who may receive
 * see it: the figures are theirs already. */
const VPR_HIST_DAYS = 30;
const VPR_HIST = { from: '', to: '', edit: '', said: '' };   // edit: the receipt whose "move to rejected" form is open
const vprIsoMinus = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
/** The receipts from one printer between two days (YYYY-MM-DD, both counted), newest first. */
const vprHistRows = (code, from, to) => flowRecvRows('', false).filter(r => obUC(r.printerCode) === obUC(code) && r.day >= from && r.day <= to);
/** What was rejected from this printer's orders on screen between two days — shown in History in red (Ravi, 19 Nov). */
function vprHistRejects(from, to) {
  const out = [];
  (VP.rows || []).forEach(o => voLines(o).forEach(l => vpRejOf(o, l).forEach(r => {
    const day = String(r.at || '').slice(0, 10); if (day < from || day > to) return;
    let time = ''; try { time = new Date(r.at).toTimeString().slice(0, 5); } catch (e) { time = ''; }
    out.push({ day, time, at: String(r.at || ''), no: '', orderNo: o.orderNo || o.id, sku: obUC(l.sku), code: '', fabric: (vprFabricOf(o, l) || {}).cloth || '',
      qty: +r.qty || 0, unit: r.unit || (o.orderType === 'running' ? 'm' : 'pcs'), by: String(r.by || '').split('@')[0],
      note: [r.reason, r.note].filter(Boolean).join(' — '), l: { item: o.orderType === 'running' ? (l.printDirection || '') : (l.articleSubtype || l.articleType || '') }, rejected: true });
  })));
  return out;
}
/** What came, added up by fabric and unit: "Sheeting 82 · 420 m". Rejects are not counted as come. */
function vprHistTotals(rows) {
  const by = new Map();
  rows.filter(r => !r.rejected && !r.notCome).forEach(r => { const k = (r.fabric || 'fabric not named') + '|' + r.unit; by.set(k, flowR2((by.get(k) || 0) + r.qty)); });
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, q]) => { const [fab, unit] = k.split('|'); return { fab, unit, q }; });
}
/* THE OLD "SENDING NOW" DELIVERIES (Ravi, 20 Nov: "put the record of that inside the history"): what a printer recorded the old way, on
 * orders from before the Production flow (vpHistRows — the "What I have sent" tab, gone from the office's view). Each shows what our team
 * accepted; one nobody has checked yet, or not accepted, is listed but not counted as come. */
const vprIsoOfDmy = d => { const m = String(d || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d || '').slice(0, 10); };
/** The cloth a pieces SKU is printed on, from the master; '' when it is not known. */
const vprSkuFabric = sku => { try { return String((cutSkuOf(sku) || {}).fabric || '').trim(); } catch (e) { return ''; } };
function vprHistOld(from, to) {
  return vpHistRows().map(r => {
    const day = vprIsoOfDmy(r.day || r.date), notCome = r.kept === null || r.no;
    const note = r.kept === null ? `printer said ${nf(r.sent)} ${r.unit} — not checked yet` : r.no ? `printer said ${nf(r.sent)} ${r.unit} — not accepted`
      : r.short > 0 ? `printer said ${nf(r.sent)} ${r.unit}, ${nf(r.short)} short` : '';
    return { day, time: '', at: r.at, no: '', orderNo: r.orderNo, sku: r.run ? '' : obUC(r.sku), code: '', fabric: r.run ? r.sku : vprSkuFabric(obUC(r.sku)),
      qty: notCome ? r.sent : r.kept, unit: r.unit, by: 'printer (old way)', note: [note, r.note].filter(Boolean).join(' · '), l: { item: r.what },
      old: true, notCome };
  }).filter(r => r.day >= from && r.day <= to);
}
const vprHistAll = () => vprHistRows(VP.code, VPR_HIST.from, VPR_HIST.to).concat(vprHistRejects(VPR_HIST.from, VPR_HIST.to), vprHistOld(VPR_HIST.from, VPR_HIST.to))
  .sort((a, b) => b.day.localeCompare(a.day) || String(b.at || '').localeCompare(String(a.at || '')));
function vprHistHtml() {
  const rows = vprHistAll(), rej = rows.filter(r => r.rejected);
  const range = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">`
    + `<label style="margin:0;font-size:12.5px">From <input type="date" data-vprhfrom value="${esc(VPR_HIST.from)}" style="width:auto"></label>`
    + `<label style="margin:0;font-size:12.5px">To <input type="date" data-vprhto value="${esc(VPR_HIST.to)}" style="width:auto"></label>`
    + `<span style="flex:1"></span><button type="button" class="ghost" data-vprhxl="1" style="width:auto;padding:4px 12px;font-size:12.5px"${rows.length ? '' : ' disabled'}>Download Excel</button></div>`;
  if (!rows.length) return range + '<div class="muted" style="padding:16px;text-align:center">Nothing was received from this printer on those days.</div>';
  const totals = vprHistTotals(rows).map(t => `<span class="pill" style="background:var(--card,#fff);border:1px solid var(--line,#e3e6ed);color:var(--muted);font-weight:500">${esc(t.fab)} <b style="color:var(--ink,#17202b)">${esc(flowQtyTxt(t.q, t.unit))}</b></span>`).join(' ');
  const rejChip = rej.length ? ` <span class="pill pill-out">Rejected ${esc(flowMixTxt(rej.map(r => [r.qty, r.unit])))}</span>` : '';
  return range + `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${totals}${rejChip}</div>`
    + `<div class="xlwrap"><table class="xl" style="width:100%"><thead><tr><th style="text-align:left">Received on</th><th style="text-align:left">Challan</th><th style="text-align:left">Order</th><th style="text-align:left">Item</th><th style="text-align:left">Fabric</th><th class="num">Qty</th><th style="text-align:left">Taken in by</th></tr></thead><tbody>`
    + rows.map(r => `<tr${r.rejected ? ' class="vo-late" title="Rejected — the printer must send it again"' : ''}><td style="text-align:left;white-space:nowrap">${esc(flowDueDay(r.day))}${r.time ? ` <span class="muted" style="font-size:11px">${esc(r.time)}</span>` : ''}</td>`
      + `<td style="text-align:left">${esc(r.no)}</td><td style="text-align:left"><b>${esc(r.orderNo)}</b></td>`
      + `<td style="text-align:left">${esc((r.l && r.l.item) || '')}<div class="muted" style="font-size:11px;font-family:ui-monospace,monospace">${esc(r.sku)}</div></td>`
      + `<td style="text-align:left"><b>${esc(r.fabric) || '<span class="muted">—</span>'}</b>${r.code ? `<div class="muted" style="font-size:11px;font-family:ui-monospace,monospace">${esc(r.code)}</div>` : ''}</td>`
      + `<td class="num"><b${r.rejected ? ' style="color:var(--bad)"' : ''}>${esc(flowQtyTxt(r.qty, r.unit))}</b>${r.old ? '<div class="muted" style="font-size:10.5px">old way</div>' : ''}${r.rejected ? '<div style="font-size:10.5px;color:var(--bad);font-weight:700">REJECTED</div>' : ''}</td><td style="text-align:left">${esc(r.by)}${r.note ? `<div class="muted" style="font-size:11px">${esc(r.note)}</div>` : ''}${vprHistEditLink(r)}</td></tr>`
      + (VPR_HIST.edit === vprHistId(r) ? vprHistEditForm(r) : '')).join('')
    + '</tbody></table></div>' + (VPR_HIST.said ? `<div class="muted" style="margin-top:8px">${esc(VPR_HIST.said)}</div>` : '');
}
/* ---- History → Edit: found damaged later, turned into a reject ----
 * Ravi, 21 Nov: "add an edit button on the history tab for each line so that we can edit that order if we later find out that our order
 * was damaged and we can send it back to rejection with a specific amount" — admins only. Part of a receipt comes off what was received
 * (the challan reopens if it had closed as all received) and becomes a reject like one made on receive: on the printer's order (it must
 * send it again) and on every admin's bell. The receipt keeps a note of it (rejectedLater). One save writes all of it, after the challan's
 * own two-people check (flowGuard). Errors: said in red inside the History window; nothing is changed then. */
const vprHistId = r => [r.no, r.rid, r.l && r.l.key].join('|');
const vprHistEditLink = r => (ME.admin && !r.rejected && !r.old && r.rid
  ? `<div><a href="#" data-vprhedit="${esc(vprHistId(r))}" style="font-size:11.5px">Edit</a></div>` : '');
function vprHistEditForm(r) {
  const id = vprHistId(r);
  return `<tr><td colspan="7" style="text-align:left;background:var(--bad-bg,#fdecec);padding:8px 12px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">`
    + `<b>Found damaged later — move to rejected:</b>`
    + `<label style="margin:0">How much <input data-vprhq type="number" min="${r.unit === 'pcs' ? 1 : 0.01}" max="${esc(String(r.qty))}" step="${r.unit === 'pcs' ? 1 : 0.01}" value="${esc(String(r.qty))}" style="width:90px"> ${esc(r.unit)}</label>`
    + `<label style="margin:0">Reason <select data-vprhwhy style="width:auto"><option value="">— pick a reason —</option>${VPR_REJ_REASONS.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>`
    + `<input data-vprhnote type="text" maxlength="200" placeholder="What is wrong (needed for Other)" style="width:220px">`
    + `<button type="button" data-vprhgo="${esc(id)}" style="width:auto;padding:4px 12px;background:var(--bad);border-color:var(--bad)">Move to rejected</button>`
    + `<button type="button" class="ghost" data-vprhx="1" style="width:auto;padding:4px 10px">Cancel</button>`
    + `<span data-vprhmsg class="err" style="flex-basis:100%"></span></div></td></tr>`;
}
/** Take q of one received line off its receipt and make it a reject; '' when saved, else what is wrong (nothing is saved then). */
async function vprRejectReceived(id, q, reason, note) {
  if (!ME.admin) return 'Only an admin can change a receipt.';
  const [no, rid, key] = String(id).split('|'), c = (FLOW.ch || {})[no], rc = c && (c.receipts || {})[rid], l = c && (c.lines || []).find(x => x.key === key);
  const had = rc ? +((rc.items || {})[key]) || 0 : 0;
  if (!l || !(had > 0)) return 'That receipt is not there any more — close History and press Refresh.';
  const unit = flowChUnit(l), what = `${l.orderNo || c.orderNo} ${l.sku || ''}`.trim();
  if (!(q > 0)) return `Type how much of ${what} is damaged.`;
  if (unit === 'pcs' && q !== Math.round(q)) return `${what}: pieces are whole.`;
  if (q > had + 1e-9) return `${what}: only ${flowQtyTxt(had, unit)} was received on this receipt.`;
  if (!VPR_REJ_REASONS.includes(reason)) return 'Pick a reason.';
  if (reason === 'Other' && !note) return 'Write what is wrong in the note.';
  const o = (VP.rows || []).find(x => x && voLines(x).some(m => vprKeys(m).includes(key))), m = o && voLines(o).find(x => vprKeys(x).includes(key));
  if (!m) return `${what}: its printer order is not on this printer's view — reject it on the challan instead.`;
  const g = await flowGuard('ch_' + no); if (g) return g;
  const at = new Date().toISOString(), rk = 'rj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), left = flowR2(had - q);
  const later = { key, qty: q, reason, note, at, by: ME.email || '' };
  const rec = { lineId: m.lineId || '', sku: m.sku || '', qty: q, unit, reason, note, at, by: ME.email || '', fromReceipt: no + '/' + rid };
  const notice = Object.assign({ status: 'pending', code: VP.code, printer: VP.name || VP.code, orderNo: o.orderNo || o.id, voId: o.id, fabric: l.fabric || '',
    item: l.item || '', later: true }, rec);
  const patch = { [`pt_flowChallans/${no}/receipts/${rid}/items/${key}`]: left > 0 ? left : null,
    [`pt_flowChallans/${no}/receipts/${rid}/rejectedLater/${rk}`]: later,
    [`pt_vendorOrders/${VP.code}/${o.id}/vRej/${rk}`]: rec, [`pt_recvRejects/${rk}`]: notice };
  const reopen = !!(c.closed && !c.closed.short);
  if (reopen) patch[`pt_flowChallans/${no}/closed`] = null;
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + ((e && e.message) || e); }
  const items = Object.assign({}, rc.items); if (left > 0) items[key] = left; else delete items[key];
  const nrc = Object.assign({}, rc, { items, rejectedLater: Object.assign({}, rc.rejectedLater, { [rk]: later }) });
  const nc = Object.assign({}, c, { receipts: Object.assign({}, c.receipts, { [rid]: nrc }) }); if (reopen) delete nc.closed;
  FLOW.ch = Object.assign({}, FLOW.ch, { [no]: nc });
  VP.rows = VP.rows.map(x => (x === o ? Object.assign({}, o, { vRej: Object.assign({}, o.vRej, { [rk]: rec }) }) : x));
  if (VPR_REJ.rows) VPR_REJ.rows = VPR_REJ.rows.concat(Object.assign({ id: rk }, notice));
  if (typeof flowVoProgSync === 'function') flowVoProgSync();   // the printer's copy of what came back
  VPR_HIST.said = `Moved ${flowQtyTxt(q, unit)} of ${what} to rejected — ${reason}. The printer must send it again; admins are told.`;
  return '';
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', async e => {
  const t = e.target; if (!t || !t.closest) return;
  const body = () => document.getElementById('vprHistBody');
  const ed = t.closest('a[data-vprhedit]');
  if (ed) { e.preventDefault(); VPR_HIST.edit = ed.getAttribute('data-vprhedit'); VPR_HIST.said = ''; if (body()) body().innerHTML = vprHistHtml(); return; }
  if (t.closest('[data-vprhx]')) { e.preventDefault(); VPR_HIST.edit = ''; if (body()) body().innerHTML = vprHistHtml(); return; }
  const go = t.closest('[data-vprhgo]'); if (!go || go.disabled) return;
  e.preventDefault(); go.disabled = true;
  const row = go.closest('tr'), val = sel => (row.querySelector(sel) || {}).value || '';
  const er = await vprRejectReceived(go.getAttribute('data-vprhgo'), flowR2(+val('[data-vprhq]') || 0), val('[data-vprhwhy]'), String(val('[data-vprhnote]')).trim());
  if (er) { go.disabled = false; const m = row.querySelector('[data-vprhmsg]'); if (m) m.textContent = er; return; }
  VPR_HIST.edit = ''; if (body()) body().innerHTML = vprHistHtml();
  if (typeof renderVp === 'function') renderVp();
});
function vprHistOpen() {
  VPR_HIST.edit = ''; VPR_HIST.said = '';
  VPR_HIST.to = dToday(); VPR_HIST.from = vprIsoMinus(VPR_HIST.to, VPR_HIST_DAYS);
  ptOpenDialog({ title: 'Received from ' + (VP.name || VP.code), subtitle: 'Every receipt from this printer, and every reject (in red), newest first, with the fabric it was printed on.',
    wide: true,   // the whole table at once, no sideways scroll bar (Ravi, 19 Nov: "complete data instead of a slider")
    html: '<div id="vprHistBody">' + vprHistHtml() + '</div>', saveLabel: 'Close', onSave: async () => '' });
}
function vprHistXl() {
  const rows = vprHistAll(); if (!rows.length) return;
  const out = [['Date', 'Time', 'Received / Rejected', 'Challan', 'Order', 'Item', 'For SKU', 'Fabric', 'Printed fabric SKU', 'Qty', 'Unit', 'By', 'Note / reason']];
  rows.forEach(r => out.push([r.day, r.time, r.rejected ? 'Rejected' : r.old ? 'Delivery (old way)' : 'Received', r.no, r.orderNo, (r.l && r.l.item) || '', r.sku, r.fabric, r.code, r.qty, r.unit, r.by, r.note]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([recipeXlsx(out, { name: 'Received', freeze: 1, cols: {} })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'received-from-' + String(VP.code).toLowerCase() + '-' + VPR_HIST.from + '-to-' + VPR_HIST.to + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', e => { const t = e.target; if (!t || !t.closest) return;
    if (t.closest('[data-vprhist]')) { e.preventDefault(); vprHistOpen(); return; }
    if (t.closest('[data-vprhxl]')) { e.preventDefault(); vprHistXl(); } });
  document.addEventListener('change', e => { const t = e.target; if (!t || !t.dataset || (t.dataset.vprhfrom == null && t.dataset.vprhto == null)) return;
    VPR_HIST[t.dataset.vprhfrom != null ? 'from' : 'to'] = t.value || dToday();
    const b = document.getElementById('vprHistBody'); if (b) b.innerHTML = vprHistHtml(); });
}

/* ---- Reject: bad goods turned away on receive ----
 * Ravi, 19 Nov: "give them a reject option" — bad goods on receive; "printer must send again … and ravi must be informed"; a reason is
 * picked from a short list. Reject takes up to what the printer entered and we have not taken in. One save writes two records together:
 * the reject on the printer's own order (vRej — its portal shows "N rejected by Ridhi — send again", and the line owes it again) and a
 * notice in pt_recvRejects that puts it on every admin's bell until one of them marks it seen; the mail to Ravi is sent from that notice.
 * Errors: a failed save is said in the window in red and nothing is written. Nothing is taken in by a reject. */
const VPR_REJ_REASONS = ['Print fault', 'Colour wrong', 'Damaged / stain', 'Short length', 'Other'];
const VPR_REJ = { rows: null };
function vprRejectOpen(id) {
  const [oid, i] = String(id).split('|'), o = (VP.rows || []).find(r => r && r.id === oid), l = o && voLines(o)[+i];
  if (!l) return;
  const v = vprOffer(o, l), q = n => flowQtyTxt(n, v.unit);
  ptOpenDialog({ title: 'Reject goods — ' + (o.orderNo || o.id), subtitle: `${l.sku || ''} · the printer entered ${q(v.entered)}; ${q(v.pending)} not taken in yet. What is rejected is not taken in, and the printer must send it again.`,
    html: `<div style="display:grid;grid-template-columns:auto 1fr;gap:10px 12px;align-items:center">`
      + `<label for="vprRejQ" style="margin:0">How much is rejected</label><input id="vprRejQ" type="number" min="${v.unit === 'pcs' ? 1 : 0.01}" max="${esc(String(v.pending))}" step="${v.unit === 'pcs' ? 1 : 0.01}" value="${esc(String(v.pending))}" style="width:120px">`
      + `<label for="vprRejWhy" style="margin:0">Reason</label><select id="vprRejWhy" style="width:auto"><option value="">— pick a reason —</option>${VPR_REJ_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}</select>`
      + `<label for="vprRejNote" style="margin:0">Note</label><input id="vprRejNote" type="text" maxlength="200" placeholder="What is wrong (needed for Other)"></div>`,
    saveLabel: 'Reject', onSave: async () => vprReject(id, flowR2(+$('vprRejQ').value || 0), $('vprRejWhy').value, String($('vprRejNote').value || '').trim()) });
}
/** Reject q of one portal line: '' when saved, else what is wrong (nothing is written then). */
async function vprReject(id, q, reason, note) {
  const [oid, i] = String(id).split('|'), o = (VP.rows || []).find(r => r && r.id === oid), l = o && voLines(o)[+i];
  if (!l) return 'That line is not on screen any more — press Refresh.';
  const v = vprOffer(o, l), what = `${o.orderNo || o.id} ${l.sku || ''}`.trim();
  if (!(q > 0)) return `Type how much of ${what} is rejected.`;
  if (v.unit === 'pcs' && q !== Math.round(q)) return `${what}: pieces are whole.`;
  if (q > v.pending + 1e-9) return `${what}: ${flowQtyTxt(q, v.unit)} is more than the ${flowQtyTxt(v.pending, v.unit)} the printer entered and we have not taken in.`;
  if (!VPR_REJ_REASONS.includes(reason)) return 'Pick a reason.';
  if (reason === 'Other' && !note) return 'Write what is wrong in the note.';
  const at = new Date().toISOString(), key = 'rj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rec = { lineId: l.lineId || '', sku: l.sku || '', qty: q, unit: v.unit, reason, note, at, by: ME.email || '' };
  const fabric = (vprFabricOf(o, l) || {}).cloth || '';
  const notice = Object.assign({ status: 'pending', code: VP.code, printer: VP.name || VP.code, orderNo: o.orderNo || o.id, voId: o.id, fabric,
    item: o.orderType === 'running' ? [l.fabricType, l.printDirection].filter(Boolean).join(' · ') : (l.articleSubtype || l.articleType || '') }, rec);
  try { await ptPatch({ [`pt_vendorOrders/${VP.code}/${o.id}/vRej/${key}`]: rec, [`pt_recvRejects/${key}`]: notice }); }
  catch (e) { return 'Could not save: ' + ((e && e.message) || e); }
  VP.rows = VP.rows.map(r => (r === o ? Object.assign({}, o, { vRej: Object.assign({}, o.vRej, { [key]: rec }) }) : r));
  if (VPR_REJ.rows) VPR_REJ.rows = VPR_REJ.rows.concat(Object.assign({ id: key }, notice));
  VPR.said = `Rejected ${flowQtyTxt(q, v.unit)} of ${what} — ${reason}. The printer sees it on its portal; Ravi is told.`;
  return '';
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target && e.target.closest && e.target.closest('a[data-vprrej]'); if (!t) return;
  e.preventDefault(); vprRejectOpen(t.getAttribute('data-vprrej'));
});

/* The bell (core/friendly.js): rejects nobody has marked seen, for admins. Read whole — a small list that only grows by rejects. */
async function vprRejLoad() {
  try { VPR_REJ.rows = ptList(await ptGet('pt_recvRejects')).filter(r => r && r.status === 'pending').map(r => Object.assign({ id: r._key }, r)); }
  catch (e) { console.warn('[rejects] not read:', (e && e.message) || e); }
}
const vprRejPending = () => (VPR_REJ.rows || []).filter(r => r.status === 'pending');
async function vprRejSeen(id) {
  try { await ptPatch({ [`pt_recvRejects/${id}/status`]: 'seen', [`pt_recvRejects/${id}/seenBy`]: ME.email || '', [`pt_recvRejects/${id}/seenAt`]: new Date().toISOString() }); }
  catch (e) { return 'Could not save: ' + ((e && e.message) || e); }
  VPR_REJ.rows = (VPR_REJ.rows || []).filter(r => r.id !== id);
  return '';
}
/** Open the printer's view on one printer (from the bell). */
function vprOpenPrinter(code) { flowVpLinkPrepare({ code }); showTab('vend'); }
