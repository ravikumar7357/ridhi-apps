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
    const share = cnt[x.l.key] || 1, most = x.unit === 'pcs' ? x.left : x.left * 1.1;   // cloth: the same 10% over every receive screen allows
    return { key: x.l.key, x, weight: x.need / share, cap: flowR2(most / share) };
  });
}
/** What the Receive cell offers on a portal line. Pieces: the most is whole on every flow line, so it is never offered and then refused. */
function vprOffer(o, l) {
  const unit = o.orderType === 'running' ? 'm' : 'pcs', t = vprTargets(o, l), list = vpVsOf(o, l);
  const whole = n => unit === 'pcs' ? Math.floor(n + 1e-9) : flowR2(n);
  const most = flowR2(t.reduce((a, p) => a + whole(p.cap), 0)), entered = vpVsSum(list);
  const pending = flowR2(Math.max(0, entered - vpRecvOf(l, o).qty));
  return { t, unit, most, entered, pending, n: whole(Math.min(pending, most, vprKeysPending(o, t))), wait: vpVsWait(list) };
}
/* A FLOW LINE ON TWO PORTAL LINES (a quilt's front and back print): Received is shown half on each, so a line alone would offer again cloth
 * already taken in on the other. What the printer entered on every portal line of the flow line, less what came back on it, is the limit. */
function vprKeysPending(o, t) {
  const ix = flowChIndex();
  return flowR2(t.reduce((sum, p) => {
    const sent = voLines(o).filter(m => m && vprKeys(m).includes(p.key)).reduce((a, m) => a + vpVsSum(vpVsOf(o, m)) / vprKeys(m).length, 0);
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
function vprFabricCell(o, l) {
  const run = o.orderType === 'running', due = vprReady() ? vprKeys(l).map(k => vprDueIndex().get(k)).find(Boolean) : null;
  let m = {}; try { m = cutSkuOf(l.sku) || {}; } catch (e) { m = {}; }
  const cloth = String((run ? l.fabricType : '') || (due && due.l.fabric) || m.fabric || '').trim();
  const sub = run ? (l.sku || '') : 'printed as pieces';
  return `<td style="text-align:left;line-height:1.3">${cloth ? `<b style="font-size:12.5px">${esc(cloth)}</b>` : '<span class="muted">—</span>'}`
    + `<div class="muted" style="font-size:11px;font-family:ui-monospace,monospace">${esc(sub)}</div></td>`;
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
  if (VPR.less === id) return cell(box(v.n, ''));
  return cell(`<button type="button" data-vprgo="${esc(id)}" data-q="${esc(String(v.n))}" style="width:auto;padding:5px 12px;font-size:12.5px;background:#166534;border-color:#166534">Receive ${esc(q(v.n))}</button>`
    + ` <a href="#" data-vprless="${esc(id)}" title="Another amount" style="font-size:13px;text-decoration:none">✎</a>${waitTxt}`);
}
/** "Pillow 16x16 3 m · Pillow 18x18 2 m": where Receive N goes on a cloth line for several SKUs. */
function vprSplitHint(v) {
  if (v.t.length < 2 || !(v.n > 0)) return '';
  const got = vprSplit(v.n, v.t, v.unit === 'pcs') || {};
  const name = x => [x.r.articleSubtype || x.r.articleType, x.r.size].filter(Boolean).join(' ') || x.sku;
  return `<div style="font-size:11px;color:#475569;margin-top:4px;text-align:left">${v.t.map(p => `${esc(name(p.x))} <b>${esc(flowQtyTxt(got[p.key] || 0, v.unit))}</b>`).join(' · ')}</div>`;
}

/* ---- the table ---- */
/** One table for every tab: each line still to show, the oldest due date first, late lines red and due-soon yellow (voDueTone). */
function vprSheet(rows, f) {
  const may = vprMay(), on = !!(f && vpLineOn(f)), items = [];
  rows.forEach(o => voLines(o).forEach((l, i) => {
    if (!l || l.cancelled || !vpPartOk(o, l) || !vpQOk(o, l, f) || (on && !voLineMatches(l, f))) return;
    items.push({ o, l, i, due: voDueOf(o, l) });
  }));
  const dueIso = x => (x.due && x.due.due) || voWant(x.l) || '9999';
  items.sort((a, b) => dueIso(a).localeCompare(dueIso(b)) || String(a.o.orderNo || a.o.id).localeCompare(String(b.o.orderNo || b.o.id)));
  if (!items.length) return `<div class="card" style="padding:34px;text-align:center;color:var(--muted)">No line to show.</div>`;
  const COLS = ['Order', 'Image', 'Item', 'Fabric', 'Ordered', 'Sent by printer', 'Received', 'Due'].concat(may ? ['Receive'] : []);
  const body = items.map(({ o, l, i, due }) => {
    const run = o.orderType === 'running', unit = run ? 'm' : 'pcs', list = vpVsOf(o, l), sent = vpVsSum(list), wait = vpVsWait(list);
    const what = run ? [l.fabricType, l.printDirection].filter(Boolean).join(' · ') : (l.articleSubtype || l.articleType || '');
    const sub = [l.color, l.sku, run ? '' : l.size].filter(Boolean).join(' · ');
    const pic = l.img ? ptImgCellSrc(l.sku, l.img) : (run ? vpRunPic(l, 38, true) : ptImgCell(l.sku));
    const ord = vpOrdOf(o, l), extra = vpVsApproved(list), rc = vpRecvOf(l, o);
    return `<tr class="${vpDueClass(due)}">`
      + `<td style="text-align:left;font-weight:700;font-size:12.5px">${esc(vpIsShop(o) && (l.shopRef || l.shopOrderNo) ? (l.shopRef || l.shopOrderNo) : (o.orderNo || o.id))}<div class="muted" style="font-size:11px;font-weight:400">${esc(o.orderDate || '')}</div></td>`
      + pic
      + `<td style="text-align:left;font-size:12.5px;line-height:1.35">${esc(what) || '<span class="muted">—</span>'}${sub ? `<div class="muted" style="font-size:11px">${esc(sub)}</div>` : ''}</td>`
      + vprFabricCell(o, l)
      + `<td class="num" style="font-weight:700">${nf(ord)} <span class="muted" style="font-weight:400;font-size:10px">${unit}</span>${extra > 0 ? `<div class="muted" style="font-size:10.5px;font-weight:400">incl. +${nf(extra)} approved</div>` : ''}</td>`
      + `<td class="num">${sent > 0 ? `<b>${nf(sent)}</b>` : '<span class="muted">—</span>'}${wait > 0 ? `<div style="font-size:10.5px;color:#b45309">+${nf(wait)} waiting approval</div>` : ''}</td>`
      + `<td class="num" title="${esc(rc.how)}">${rc.qty > 0 ? `<b style="color:#166534">${nf(rc.qty)}</b>` : '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left;font-size:12px;white-space:nowrap">${voDueHtml(due, voWant(l))}</td>`
      + (may ? vprRecvCell(o, l, o.id + '|' + i) : '')
      + '</tr>';
  }).join('');
  return `<div class="card xlwrap" style="padding:0"><table class="xl"><thead><tr>${COLS.map(h => `<th${['Ordered', 'Sent by printer', 'Received'].includes(h) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ---- taking it in ---- */
/** Take in q on one portal line, shared over its flow lines; '' when saved, else what is wrong (nothing is saved then). One save at a time:
 * a redraw during a save draws a fresh button, and a second press must not take the same goods in twice. */
async function vprReceive(id, q) {
  if (VPR.saving) return 'Still saving the last receive — wait a moment.';
  VPR.saving = id;
  try { return await vprReceiveLine(id, q); } finally { VPR.saving = ''; }
}
async function vprReceiveLine(id, q) {
  const [oid, i] = String(id).split('|'), o = (VP.rows || []).find(r => r && r.id === oid), l = o && voLines(o)[+i];
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
/** The button in the PRINTER'S VIEW bar, filled on every draw: how many extras this printer is waiting on. */
function vprBarSync() {
  const slot = $('flVpX'); if (!slot) return;
  const n = vprOn() && ME.admin && vprReady() ? flowExtraAsks(VP.code).length : 0;
  slot.innerHTML = n ? `<button type="button" data-vprxopen="1" style="width:auto;padding:6px 12px;font-size:12.5px;background:#b45309;border-color:#b45309">Extra pieces to approve <span class="navbadge" style="position:static;background:#fff;color:#b45309">${nf(n)}</span></button>` : '';
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target; if (!t || !t.closest || !t.closest('[data-vprxopen]')) return;
  e.preventDefault();
  /* The answer is written on the printer's own branch: read it again when the window closes, so the table counts what was approved. */
  flowExtraOpen(VP.code, async () => { VP.rows = null; await ensureVp(); });
});
