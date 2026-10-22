/* ================= PRODUCTION FLOW · DEMAND HISTORY — challans, and the printed fabric received against them =================
 * Ravi, 10 Oct: the challans do not belong in Demand; they go to a Demand history tab, and "jab mal aay to yahin se
 * challan guy entry kare ki ye mal aaya h ya nahi, then move ho store me, or yahan se open challan close ho jay".
 *   pt_flowChallans/<no>/receipts/<id> = { date, items: { LINEKEY: metres }, note, at, by }
 *   pt_flowChallans/<no>/closed = { at, by, why }   — set by itself when every line is back, or by hand ("close short")
 * A line on a challan IS given to that printer (Vendor allocation is done by the challan). Its printed fabric is back
 * in the share received of what was sent; a closed challan sends its lines on to the store (cutting) whatever came. */

/* RECEIVED IN THE UNIT IT WAS GIVEN (Ravi, 10 Oct: "jis form me order de raha hu printing ke liye, usi form me milna
 * chahiye"). A line printed on the SKU itself (cutting not required) goes out as PIECES and comes back as pieces —
 * 10 given, 10 back — whatever cloth they take (shown beside, for information). Printed cloth goes and comes in metres.
 * A challan made before lines knew what they print is metres, as it was. */
const flowChUnit = l => (l && l.print && l.print.kind === 'sku' ? 'pcs' : 'm');
const flowChSent = l => (flowChUnit(l) === 'pcs' ? (+l.pcs || 0) : (+l.metres || 0));
const flowQtyTxt = (q, u) => nf(flowR2(q)) + (u === 'pcs' ? ' pcs' : ' m');
/** Totals in mixed units, each said in its own: "105.75 m · 45 pcs". */
const flowMixTxt = parts => { const t = { m: 0, pcs: 0 }; parts.forEach(([q, u]) => { t[u] += +q || 0; });
  return [t.m ? flowQtyTxt(t.m, 'm') : '', t.pcs ? flowQtyTxt(t.pcs, 'pcs') : ''].filter(Boolean).join(' · ') || '0'; };
/** Every challan's lines, by line key: { no, vendor, sent, recv, closed } — cached on FLOW.ch. */
let FLOW_CHX = { src: null, map: {} };
/* MOVED TO ANOTHER PRINTER (Ravi, 22 Oct: "me yaha printer change kar saku … us fabric ko stand dikhay ki ye order diya tha
 * ab cancel ho gya but fabric abhi stand h"). pt_flowChallans/<no>/moved/<line key> = { at, by, from, to, metres, unit,
 * fabric, sku, orderNo, why }: the line is off that challan — the order line goes back to Demand · RFD for its new printer —
 * and the cloth it took stays with the old printer, STANDING: given against an order that no longer has it (flowStanding). */
const flowChMoved = (c, l) => !!(c && l && !l.ruffleOnly && c.moved && c.moved[l.key]);
/* WHAT COMES BACK, BY ITS OWN NAME (Ravi, 22 Oct: "yaha mere pas printed fabric print hokar aayega to printed fabric sku and
 * color name show hona chahiye"): running cloth is said as the printed fabric SKU and its colour (the product it is for after
 * it); pieces printed on the SKU as the SKU and its colour; a ruffle as its printed ruffle cloth. */
function flowChLineWhat(l, big) {
  const p = (l && l.print) || {}, lab = String(p.label || '').split(' · ');
  let m = {}; try { m = (typeof cutSkuOf === 'function' && cutSkuOf(l.sku)) || {}; } catch (e) { m = {}; }
  const colour = String((p.kind === 'fabric' && lab[0]) || m.color || String(l.item || '').split(' · ')[1] || '').trim();
  const b = t => big ? `<b>${esc(t)}</b>` : `<b style="font-weight:600">${esc(t)}</b>`;
  if (l.ruffleOnly) { const x = (l.extras || [])[0] || {}; return `${b((l.extras || []).map(e => e.code).filter(Boolean).join(' + ') || l.fabric || 'ruffle cloth')} · ${esc(String(x.label || '').split(' · ')[0] || colour)} <span class="muted">(ruffle, for ${esc(l.sku)})</span>`; }
  if (p.kind === 'fabric') {
    const code = p.sides && p.sides.length ? p.sides.map(sd => sd.side + ' ' + sd.code).join(' + ') : (p.code || '');
    return `${code ? b(code) : `<b style="color:#b91c1c">no fabric SKU</b>`} · ${esc(colour)}${l.fabric ? ` <span class="muted">${esc(l.fabric)}</span>` : ''} <span class="muted">for ${esc(l.sku)}</span>`;
  }
  return `${b(l.sku)}${colour ? ' · ' + esc(colour) : ''}`;
}
function flowChIndex() {
  if (FLOW_CHX.src === FLOW.ch) return FLOW_CHX.map;
  const map = {};
  Object.values(FLOW.ch || {}).forEach(c => {
    if (c.cancelled) return;   // a cancelled challan gave nothing to anybody
    const recv = flowChRecv(c);
    (c.lines || []).forEach(l => { if (flowChMoved(c, l)) return;
      const k = l.ruffleOnly ? l.key + FLOW_RUF : l.key, e = map[k] || (map[k] = { no: c.no, vendor: c.vendor && c.vendor.name, sent: 0, recv: 0, closed: true });
      e.no = c.no; e.vendor = c.vendor && c.vendor.name; e.sent += flowChSent(l); e.recv += recv[l.key] || 0; e.closed = e.closed && !!c.closed; });
  });
  FLOW_CHX = { src: FLOW.ch, map };
  return map;
}
/* SEEN IN HISTORY (Ravi, 11 Oct: "dekhne ke liye hum History tab use karenge, Printed fabric in ko hata dete h"). Every
 * receipt on a flow challan is a row of Vendors & printers → History (voLogRows) — accepted as it was received, by who
 * received it — and so, like a printer's delivery, printed cloth / printed pieces IN at the store, which reads the same
 * log. Preview only (FLOW_ON); a TEST challan's rows say TEST. History does not change them: they are changed on the
 * challan (Demand history: undo receipt). */
function flowVlogRows() {
  if (typeof FLOW_ON === 'undefined' || !FLOW_ON || !FLOW.ch) return [];
  const out = [];
  Object.values(FLOW.ch).forEach(c => {
    if (!c || c.cancelled) return;
    Object.entries(c.receipts || {}).forEach(([rid, rc]) => Object.entries((rc && rc.items) || {}).forEach(([key, q]) => {
      const qty = +q || 0, l = (c.lines || []).find(x => x.key === key); if (!qty || !l) return;
      const u = flowChUnit(l), run = u === 'm';
      let m = {}; try { m = cutSkuOf(l.sku) || {}; } catch (e) { m = {}; }
      const colour = String(m.color || String(l.item || '').split(' · ')[1] || '').trim();
      const code = l.ruffleOnly ? (l.extras || []).map(x => x.code).filter(Boolean).join(' + ')
        : l.print && l.print.sides && l.print.sides.length ? l.print.sides.map(sd => sd.code).join(' + ') : ((l.print && l.print.code) || '');
      const day = voDayOf(rc.date || String(rc.at || '').slice(0, 10)), test = /^T/.test(String(c.no));
      out.push({ day, key: voDayKey(day), raw: String(rc.date || ''), li: -1, di: -1, del: { qty, date: rc.date, by: rc.by || '', at: rc.at || '' },
        ok: { qty, at: rc.at || '', by: rc.by || '', note: (test ? 'TEST · ' : '') + (c.recordOnly ? 'record of cloth given earlier · ' : '') + 'received on challan ' + c.no + (rc.note ? ' · ' + rc.note : '') },
        key2: 'flow/' + c.no + '/' + rid + '/' + key, vendorCode: (c.vendor && c.vendor.code) || '', vendor: (c.vendor && c.vendor.name) || '',
        orderNo: (test ? 'TEST · ' : '') + c.no + ' · ' + (l.orderNo || c.orderNo || ''), id: c.no, run, unit: u, printing: true,
        sku: run ? code : obUC(l.sku), fabric: run ? (l.fabric || '') : '', colour,
        what: run ? [code, l.fabric, colour].filter(Boolean).join(' · ') + (l.ruffleOnly ? ' (ruffle)' : '') + ' — for ' + obUC(l.sku) : (l.item || l.sku),
        qty, by: rc.by || '', at: rc.at || '', flow: true, test });
    }));
  });
  return out;
}
/** Received so far, per line key, on one challan — in the line's own unit (metres, or pieces). */
function flowChRecv(c) {
  const out = {};
  Object.values(c.receipts || {}).forEach(rc => Object.entries(rc.items || {}).forEach(([k, m]) => { out[k] = flowR2((out[k] || 0) + (+m || 0)); }));
  return out;
}
function flowChState(c) {
  if (c.cancelled) return 'cancelled';
  if (c.closed) return 'closed';
  const recv = flowChRecv(c), any = Object.values(recv).some(m => m > 0);
  return any ? 'part' : 'open';
}

/** The Demand history list: open challans first, then the closed ones. */
/* A CHALLAN OF MANY ORDERS (Ravi, 22 Oct: "it's looking very odd" — RFD-202610-038 carries 20+ Shopify orders, written on one
 * line that pushed every other column off the screen). The first few are shown, the rest open under "+N more"; the lines
 * the same way. */
function flowHistMore(items, n, what) {
  if (items.length <= n + 1) return items.join('<br>');
  return items.slice(0, n).join('<br>') + `<details style="margin-top:2px"><summary style="cursor:pointer;color:var(--accent,#4f46e5);font-size:11.5px">+${nf(items.length - n)} more ${what}s</summary>`
    + `<div style="margin-top:2px">${items.slice(n).join('<br>')}</div></details>`;
}
function flowHistOrders(c) {
  const os = (c.orders && c.orders.length ? c.orders : String(c.orderNo || '').split(/,\s*/)).filter(Boolean);
  if (os.length <= 1) return esc(os[0] || c.orderNo || '');
  return `<div style="font-size:11.5px;color:var(--muted,#64748b)">${nf(os.length)} orders</div>` + flowHistMore(os.map(o => esc(o)), 3, 'order');
}
/** Every cloth standing with a printer: given on a challan against an order line that has since gone to another printer. */
/* SETTLING IT (Ravi, 22 Oct: "is fabric ka sattlement bhi kar saku" — back to the store, or used for another order; admins
 * only). moved/<key>/settles/<id> = { at, by, how: 'store' | 'order', qty (in the line's unit), metres (cloth), as: 'rfd' |
 * 'printed' (store), toNo, toKey (order), note }. Part of it may be settled at a time; what is left still stands. */
const flowStandSettled = m => flowR2(Object.values((m && m.settles) || {}).reduce((a, x) => a + (+(x && x.qty) || 0), 0));
function flowStanding(all) {
  const out = [];
  Object.values(FLOW.ch || {}).forEach(c => {
    if (!c || c.cancelled || !c.moved) return;
    (c.lines || []).forEach(l => { const m = flowChMoved(c, l) ? c.moved[l.key] : null; if (!m) return;
      const qty = +m.metres || flowChSent(l), settled = flowStandSettled(m), left = flowR2(Math.max(0, qty - settled));
      if (!all && left <= 0) return;
      out.push({ printer: (c.vendor && c.vendor.name) || '', code: (c.vendor && c.vendor.code) || '', fabric: l.fabric || m.fabric || '', qty: left, total: qty, settled, unit: m.unit || flowChUnit(l),
        clothPer: qty > 0 ? (+l.metres || 0) / qty : 0, key: l.key, line: l,
        no: c.no, orderNo: m.orderNo || String(l.key).split('__')[0], sku: l.sku, to: (m.to && m.to.name) || '', at: String(m.at || '').slice(0, 10), why: m.why || '' }); });
  });
  return out.sort((a, b) => a.printer.localeCompare(b.printer) || a.fabric.localeCompare(b.fabric) || b.at.localeCompare(a.at));
}
function flowStandingHtml() {
  const st = flowStanding(); if (!st.length) return '';
  const tot = new Map(); st.forEach(x => { const k = x.printer + '|' + x.fabric + '|' + x.unit; tot.set(k, flowR2((tot.get(k) || 0) + x.qty)); });
  return `<details style="margin-top:8px;flex-basis:100%"><summary style="cursor:pointer;font-weight:600;color:#b45309">Standing with printers — ${[...tot.entries()].map(([k, q]) => { const [p, f, u] = k.split('|'); return `${esc(p)}: ${esc(f || '—')} ${flowQtyTxt(q, u)}`; }).join(' · ')}</summary>`
    + `<div class="muted" style="font-size:12px;margin:4px 0">Cloth given to a printer against an order line that was then moved to another printer. It is still with them.</div>`
    + `<table class="xl" style="width:auto"><thead><tr><th style="text-align:left">Printer</th><th style="text-align:left">Fabric</th><th>Standing</th><th style="text-align:left">Given on</th><th style="text-align:left">Order · SKU</th><th style="text-align:left">Moved to</th><th>On</th>${ME.admin ? '<th>Settle</th>' : ''}</tr></thead><tbody>`
    + st.map(x => `<tr><td style="text-align:left"><b>${esc(x.printer)}</b></td><td style="text-align:left">${esc(x.fabric || '—')}</td><td class="num">${flowQtyTxt(x.qty, x.unit)}${x.settled ? `<div class="muted" style="font-size:10.5px">of ${flowQtyTxt(x.total, x.unit)} · ${flowQtyTxt(x.settled, x.unit)} settled</div>` : ''}</td>`
      + `<td style="text-align:left"><a href="#" data-flchp="${esc(x.no)}">${esc(x.no)}</a></td><td style="text-align:left">${esc(x.orderNo)} · ${esc(x.sku)}</td><td style="text-align:left" title="${esc(x.why)}">${esc(x.to)}</td><td>${esc(x.at)}</td>`
      + (ME.admin ? `<td style="white-space:nowrap"><button class="ghost" data-flstb="${esc(x.no + '|' + x.key)}" style="width:auto;padding:2px 8px;font-size:11.5px" title="The printer sent it back to the store">Back to store</button> `
        + `<button class="ghost" data-flstu="${esc(x.no + '|' + x.key)}" style="width:auto;padding:2px 8px;font-size:11.5px" title="Give it to another order line of this printer and fabric — no RFD leaves the store">Use for another order</button></td>` : '') + '</tr>').join('')
    + '</tbody></table></details>';
}
const flowStandOf = (no, key) => flowStanding().find(x => x.no === no && x.key === key) || null;
/** Write one settlement on the moved line (and whatever goes with it). */
async function flowStandWrite(x, rec, extra) {
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), path = `pt_flowChallans/${x.no}/moved/${x.key}/settles/${id}`;
  const patch = Object.assign({ [path]: rec }, extra || {});
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  const c = FLOW.ch[x.no], m = c.moved[x.key];
  FLOW.ch = Object.assign({}, FLOW.ch, { [x.no]: Object.assign({}, c, { moved: Object.assign({}, c.moved, { [x.key]: Object.assign({}, m, { settles: Object.assign({}, m.settles, { [id]: rec }) }) }) }) });
  return '';
}
/** Back to the store: unprinted → RFD again (the RFD count adds it back); printed → recorded, put in Store stock by hand. */
async function flowStandBack(no, key, qty, as, note) {
  if (!ME.admin) return 'Only an admin can settle standing cloth.';
  const x = flowStandOf(no, key); if (!x) return 'That standing cloth is not here any more — press Refresh.';
  const q = flowR2(+qty || 0);
  if (!(q > 0) || q > x.qty + 1e-9) return `Type how much came back — at most the ${flowQtyTxt(x.qty, x.unit)} still standing.`;
  if (x.unit === 'pcs' && q !== Math.round(q)) return 'Pieces are whole.';
  return flowStandWrite(x, { at: new Date().toISOString(), by: ME.email || '', how: 'store', as: as === 'printed' ? 'printed' : 'rfd', qty: q, metres: flowR2(x.unit === 'pcs' ? q * x.clothPer : q), note: note || '' });
}
/** The order lines this standing cloth can go to: waiting for RFD, planned to this printer, the same fabric and unit. */
function flowStandTargets(x) {
  return flowRows().filter(y => flowInView('drfd', y.s) && y.s.route !== 'stitch' && String(flowPlanPrinter(y.s)) === String(x.code)
    && flowFabKey((y.s.plan && y.s.plan.fabric && y.s.plan.fabric.name) || '') === flowFabKey(x.fabric) && (y.s.fabUnit || 'm') === x.unit && flowFabOwed(y.r, y.s).left > 0);
}
/** Used for another order: a challan to the same printer for that line, made from the standing cloth — nothing leaves the store. */
async function flowStandUse(no, key, toKey, qty, note) {
  if (!ME.admin) return 'Only an admin can settle standing cloth.';
  const x = flowStandOf(no, key); if (!x) return 'That standing cloth is not here any more — press Refresh.';
  const y = flowStandTargets(x).find(z => z.s.key === toKey); if (!y) return 'Pick the order line it goes to.';
  const o = flowFabOwed(y.r, y.s), q = flowR2(+qty || 0), most = flowR2(Math.min(x.qty, o.left));
  if (!(q > 0) || q > most + 1e-9) return `Type how much — at most ${flowQtyTxt(most, x.unit)} (what stands, and what the line still needs).`;
  if (x.unit === 'pcs' && q !== Math.round(q)) return 'Pieces are whole.';
  const now = new Date().toISOString(), date = dToday(), metres = flowR2(x.unit === 'pcs' ? (o.left ? o.metres * q / o.left : 0) : q);
  let cno = flowChallanNo(date, false);
  const ch = { no: cno, date, orderNo: y.r.orderNo, orders: [y.r.orderNo], vendor: { code: x.code, name: x.printer }, at: now, by: ME.email || '',
    standing: { from: no, key, sku: x.sku }, note: `From cloth standing with ${x.printer} (${no}, ${x.orderNo} · ${x.sku})${note ? ' — ' + note : ''}`,
    lines: [{ key: y.s.key, sku: obUC(y.r.sku), item: flowChItem(y.r), print: flowPrintWhat(y.r, y.s.plan), extras: [], fabric: (y.s.plan.fabric && y.s.plan.fabric.name) || x.fabric, pcs: x.unit === 'pcs' ? q : +y.r.qty || 0, metres }] };
  for (let k = 0, taken = []; ; k++) {
    let er = ''; try { er = await flowClaim('pt_flowChallans/' + cno, ch); } catch (e) { return 'Could not save: ' + (e.message || e); }
    if (!er) break;
    if (k >= 15) return 'Could not get a free challan number — press Refresh and try again.';
    taken.push(cno); cno = flowChallanNo(date, false, taken); ch.no = cno;
  }
  const extra = typeof ptCas === 'function' ? {} : { ['pt_flowChallans/' + cno]: ch };
  extra[`pt_flowDemand/${y.s.key}/fabricReady`] = { at: now, by: ME.email || '', what: ch.lines[0].fabric, metres, note: `Challan ${cno} — standing cloth with ${x.printer}`, challan: cno, vendor: x.printer };
  const er = await flowStandWrite(x, { at: now, by: ME.email || '', how: 'order', qty: q, metres, toNo: cno, toKey: y.s.key, toOrder: y.r.orderNo, note: note || '' }, extra);
  if (er) return er;
  FLOW.ch = Object.assign({}, FLOW.ch, { [cno]: ch });
  FLOW.dem = Object.assign({}, FLOW.dem, { [y.s.key]: Object.assign({}, (FLOW.dem || {})[y.s.key], { fabricReady: extra[`pt_flowDemand/${y.s.key}/fabricReady`] }) });
  flowStandUse.no = cno;
  return '';
}
function flowStandBackOpen(no, key) {
  const x = flowStandOf(no, key); if (!x) return;
  ptOpenDialog({
    title: `Back to store — ${x.printer}`,
    subtitle: `${x.fabric} · ${flowQtyTxt(x.qty, x.unit)} standing (${no}, ${x.orderNo} · ${x.sku}). Unprinted cloth is RFD again; printed cloth is recorded here — put it in Store stock by hand.`,
    html: `<div class="ptgrid" style="grid-template-columns:1fr 1fr 2fr"><label>Came back (${esc(x.unit)})<input id="flstQ" type="number" min="0" step="${x.unit === 'pcs' ? 1 : 0.01}" value="${esc(x.qty)}"></label>
      <label>As<select id="flstAs"><option value="rfd">Unprinted RFD — back in RFD stock</option><option value="printed">Printed — put it in Store stock by hand</option></select></label>
      <label>Note<input id="flstN" placeholder="challan / vehicle"></label></div>`,
    saveLabel: 'Settle',
    onSave: async () => { const er = await flowStandBack(no, key, $('flstQ').value, $('flstAs').value, ($('flstN').value || '').trim()); if (er) return er; renderFlow(); return ''; },
  });
}
function flowStandUseOpen(no, key) {
  const x = flowStandOf(no, key); if (!x) return;
  const ts = flowStandTargets(x);
  if (!ts.length) { $('flMsg').className = 'err'; $('flMsg').textContent = `No order line waits for ${x.fabric} with ${x.printer} in Demand · RFD — plan one to this printer first.`; return; }
  ptOpenDialog({
    title: `Use for another order — ${x.printer}`,
    subtitle: `${x.fabric} · ${flowQtyTxt(x.qty, x.unit)} standing (${no}). A challan to ${x.printer} is made for the line picked — from the cloth they already have; nothing leaves the store.`,
    html: `<label>Order line<select id="flstT">${ts.map(y => `<option value="${esc(y.s.key)}">${esc(y.r.orderNo)} · ${esc(obUC(y.r.sku))} — needs ${esc(flowQtyTxt(flowFabOwed(y.r, y.s).left, x.unit))}</option>`).join('')}</select></label>
      <div class="ptgrid" style="grid-template-columns:1fr 2fr;margin-top:8px"><label>How much (${esc(x.unit)})<input id="flstQ" type="number" min="0" step="${x.unit === 'pcs' ? 1 : 0.01}" value="${esc(Math.min(x.qty, flowFabOwed(ts[0].r, ts[0].s).left))}"></label>
      <label>Note<input id="flstN"></label></div>`,
    saveLabel: 'Make the challan',
    onSave: async () => { const er = await flowStandUse(no, key, $('flstT').value, $('flstQ').value, ($('flstN').value || '').trim()); if (er) return er;
      renderFlow(); $('flMsg').className = 'muted'; $('flMsg').textContent = `Challan ${flowStandUse.no} made from the standing cloth — the line has its fabric with ${x.printer}.`; return ''; },
  });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target; if (!t || !t.closest) return;
  const b = t.closest('[data-flstb]'), u = t.closest('[data-flstu]'); if (!b && !u) return;
  e.preventDefault(); const [no, key] = (b || u).getAttribute(b ? 'data-flstb' : 'data-flstu').split('|');
  if (b) flowStandBackOpen(no, key); else flowStandUseOpen(no, key);
});
/* (end of standing cloth) */
function flowHistTable(q, testOnly) {
  /* A cancelled challan is not shown (Ravi, 19 Oct: "cancel order yaha show hi n ho") — it moved nothing and owes nothing. */
  const list = Object.values(FLOW.ch || {}).filter(c => c && !c.cancelled && (!testOnly || flowIsTest(c.orderNo)))
    .filter(c => !q || [c.no, c.orderNo, c.vendor && c.vendor.name].concat((c.lines || []).map(l => l.sku)).join(' ').toLowerCase().includes(q))
    .sort((a, b) => (['closed', 'cancelled'].includes(flowChState(a))) - (['closed', 'cancelled'].includes(flowChState(b))) || String(b.no).localeCompare(String(a.no)));
  const pill = st => st === 'cancelled' ? '<span class="jw-st" style="background:#f1f5f9;color:#64748b">cancelled</span>' : st === 'closed' ? '<span class="jw-st done">closed</span>' : st === 'part' ? '<span class="jw-st prog">part received</span>' : '<span class="jw-st pend">open</span>';
  const body = list.map(c => { const recv = flowChRecv(c), st = flowChState(c);
    const sent = flowMixTxt((c.lines || []).map(l => [flowChSent(l), flowChUnit(l)])), got = flowMixTxt((c.lines || []).map(l => [recv[l.key] || 0, flowChUnit(l)]));
    return `<tr><td class="frz" style="text-align:left"><b>${esc(c.no)}</b>${flowIsTest(c.orderNo) ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}<div class="muted" style="font-size:10.5px">${esc(c.date || '')}</div></td>
      <td style="text-align:left;white-space:normal;min-width:150px;max-width:240px;vertical-align:top">${flowHistOrders(c)}${(c.orders || [c.orderNo]).map(o => typeof ordBuyerOf === 'function' ? ordBuyerOf(o) : '').filter(Boolean).filter((b, i, a) => a.indexOf(b) === i).map(b => `<div style="font-size:12px;font-weight:600">${esc(b)}</div>`).join('')}</td><td style="text-align:left"><b>${esc(c.vendor && c.vendor.name)}</b></td>
      <td style="text-align:left;font-size:11.5px;white-space:normal;min-width:200px;vertical-align:top">${flowHistMore((c.lines || []).map(l => `${flowChLineWhat(l)} · ${flowQtyTxt(flowChSent(l), flowChUnit(l))}${recv[l.key] ? ` <span style="color:#166534">(${flowQtyTxt(recv[l.key], flowChUnit(l))} back)</span>` : ''}`
        + (flowChMoved(c, l) ? ` <span style="color:#b45309" title="${esc((c.moved[l.key] || {}).why || '')}">· order moved to ${esc(((c.moved[l.key] || {}).to || {}).name || '')} — cloth standing</span>` : '')), 5, 'line')}</td>
      <td class="num">${sent}</td><td class="num">${got}</td>
      <td>${pill(st)}${(c.cancelled || c.closed) && (c.cancelled || c.closed).why ? `<div class="muted" style="font-size:10.5px">${esc((c.cancelled || c.closed).why)}</div>` : ''}</td>
      <td style="white-space:nowrap">${flowChActions(c, st)}</td></tr>`; }).join('');
  return `<thead><tr><th class="frz" style="text-align:left">Challan</th><th style="text-align:left">Order</th><th style="text-align:left">Vendor</th><th style="text-align:left">Lines · sent</th><th>Sent</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>`
    + (body || '<tr><td colspan="8" class="muted" style="padding:16px">No challan yet — they are made in Demand · RFD fabric.</td></tr>') + '</tbody>';
}

/** What can be done to a challan in its state — and, to put a mistake right, Edit / Cancel / Undo receipt / Reopen. */
function flowChActions(c, st) {
  const b = (attr, label, main) => `<button ${main ? '' : 'class="ghost" '}${attr}="${esc(c.no)}" style="width:auto;padding:${main ? '3px 10px;font-size:12px' : '2px 8px;font-size:11.5px'}">${label}</button>`;
  if (st === 'cancelled') return '';
  const out = [];
  if (st !== 'closed') out.push(b('data-flchr', 'Receive', true), b('data-flchc', 'Close short'));
  if (!flowChHasRecv(c) && st !== 'closed') out.push(b('data-flche', 'Edit'), b('data-flchx', 'Cancel'));
  if (flowChHasRecv(c)) out.push(b('data-flchu', 'Undo last receipt'));
  if (st === 'closed' && c.closed.short) out.push(b('data-flcho', 'Reopen'));
  out.push(b('data-flchp', 'Print'));
  return out.join(' ');
}
/* NOT RECEIVED THIS TIME (Ravi, 20 Oct, design A): a ✕ at the end of a line marks it "Not received" for this receipt
 * only — the line stays on the challan, still owed, and comes up again next time. ↶ undoes it. The lines crossed are kept
 * on the receipt (notCame) so the history says what was missing that day. */
let FLOW_RX = new Set();
const FLOW_RX_WAS = new Map();     // what was typed before the cross, put back by ↶
function flowRecvCross(i) {
  const on = !FLOW_RX.has(i);
  if (on) FLOW_RX.add(i); else FLOW_RX.delete(i);
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const q = s => document.querySelector(s);
  const inp = q(`[data-flrm="${i}"]`), box = q(`[data-flrin="${i}"]`), pill = q(`[data-flrno="${i}"]`), tr = q(`[data-flrrow="${i}"]`), b = q(`[data-flrx="${i}"]`);
  if (inp) { if (on) { FLOW_RX_WAS.set(i, inp.value); inp.value = ''; } else if (FLOW_RX_WAS.has(i)) inp.value = FLOW_RX_WAS.get(i); }
  if (box) box.style.display = on ? 'none' : '';
  if (pill) pill.style.display = on ? '' : 'none';
  if (tr) tr.style.opacity = on ? '0.55' : '';
  if (b) { b.textContent = on ? '↶' : '✕'; b.title = on ? 'Undo — it came after all' : 'Not received this time — the line stays on the challan'; }
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('[data-flrx]');
  if (b) { e.preventDefault(); flowRecvCross(+b.dataset.flrx); }
});
/** Printed fabric back from the printer against a challan: metres per line. Closes by itself when all of it is back. */
function flowReceiveOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  const recv = flowChRecv(c);
  FLOW_RX = new Set(); FLOW_RX_WAS.clear();
  /* the picture of each line (20 Oct), from wherever the app has it — master, Shopify, the B2B sheet */
  const pic = sku => (typeof ptImgSpan === 'function' ? ptImgSpan(sku, 40) : '');
  ptOpenDialog({
    title: `Receive against ${no}`,
    subtitle: `${c.orderNo} · ${c.vendor && c.vendor.name}. Type what came back now, in the form it was given: printed cloth in metres, pieces printed on the SKU in pieces. When every line is back the challan closes and the lines move to the store by themselves.`,
    html: `<label>Date<input id="flrDate" type="date" value="${esc(dToday())}"></label>
      <table class="xl" style="margin-top:8px;width:100%"><thead><tr><th style="width:52px">Photo</th><th style="text-align:left">SKU</th><th>Given as</th><th>Sent</th><th>Back so far</th><th>Received now</th></tr></thead><tbody>
      ${/* STARTS AT 0 (Ravi, 22 Oct: "received now me auto 0 aana chahiye jisase cross krne ki need hi n pade jisme aayega usme qty
         fill kar denge"): only the lines typed in are received; a line left at 0 stays owed on the challan. */ ''}
      ${(c.lines || []).map((l, i) => { const u = flowChUnit(l), left = flowChMoved(c, l) ? 0 : flowR2(Math.max(0, flowChSent(l) - (recv[l.key] || 0)));
        return `<tr data-flrrow="${i}"><td>${pic(l.sku)}</td><td style="text-align:left">${flowChLineWhat(l, true)}<div class="muted" style="font-size:10.5px">${esc(l.item || '')}</div></td>
          <td style="text-align:left;font-size:11.5px">${u === 'pcs' ? 'Cut pieces' : l.ruffleOnly ? 'Printed ruffle cloth' : 'Printed cloth'}</td>
          <td class="num"><b>${flowQtyTxt(flowChSent(l), u)}</b>${u === 'pcs' ? `<div class="muted" style="font-size:10.5px">${flowQtyTxt(l.metres, 'm')} cloth</div>` : ''}</td><td class="num">${flowQtyTxt(recv[l.key] || 0, u)}</td>
          <td class="num"><span data-flrin="${i}"><input data-flrm="${i}" type="number" step="${u === 'pcs' ? '1' : '0.01'}" min="0" value="${left > 0 ? '0' : ''}" ${left > 0 ? `title="still to come: ${esc(flowQtyTxt(left, u))}" onfocus="this.select()"` : 'disabled'} style="width:85px;padding:3px 6px;font-size:12px"> ${u}</span>`
          + `<span data-flrno="${i}" class="pill bad" style="display:none;font-size:11px">Not received</span>`
          + (flowChMoved(c, l) ? ` <span class="pill" style="font-size:11px" title="the printer was changed — the cloth stands with ${esc(c.vendor && c.vendor.name)}">moved → ${esc(((c.moved[l.key] || {}).to || {}).name || '')}</span>` : '')
          /* the ✕ sits in the same cell as the figure: a column of its own ran off the right of the window (20 Oct) */
          + `${left > 0 ? ` <button type="button" class="ghost" data-flrx="${i}" title="Not received this time — the line stays on the challan" style="width:auto;padding:2px 9px;font-size:13px;margin-left:4px">✕</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table><label style="display:block;margin-top:8px">Note (lot, vehicle, quality…)<input id="flrNote"></label>`,
    saveLabel: 'Received',
    onSave: async () => {
      const items = {};
      const frac = [];
      (c.lines || []).forEach((l, i) => { if (FLOW_RX.has(i) || flowChMoved(c, l)) return;       // not received this time / moved
        const m = +((document.querySelector(`[data-flrm="${i}"]`) || {}).value || 0);
        if (m > 0) { items[l.key] = flowR2(m); if (flowChUnit(l) === 'pcs' && m !== Math.round(m)) frac.push(l.sku); } });
      if (!Object.keys(items).length) return 'Type what came back for at least one line.';
      if (frac.length) return `Pieces are whole: ${frac.join(', ')}.`;
      /* Pieces back are pieces given — never more. Cloth may come back a little over (shrinkage, roll ends): up to 10%. */
      const over = (c.lines || []).filter(l => (recv[l.key] || 0) + (items[l.key] || 0) > flowChSent(l) * (flowChUnit(l) === 'pcs' ? 1 : 1.1) + 1e-9).map(l => l.sku);
      if (over.length) return `More came back than was given for ${over.join(', ')} — check the figure.`;
      const g = await flowGuard('ch_' + no); if (g) return g;   // two people receiving on one challan at once
      const now = new Date().toISOString(), id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rc = { date: $('flrDate').value || dToday(), items, note: $('flrNote').value.trim(), at: now, by: ME.email || '' };
      const notCame = (c.lines || []).filter((l, i) => FLOW_RX.has(i)).map(l => l.key);
      if (notCame.length) rc.notCame = notCame;
      const allBack = (c.lines || []).every(l => flowChMoved(c, l) || (recv[l.key] || 0) + (items[l.key] || 0) >= flowChSent(l) - 0.01);
      const patch = { [`pt_flowChallans/${no}/receipts/${id}`]: rc };
      if (allBack) patch[`pt_flowChallans/${no}/closed`] = { at: now, by: ME.email || '', why: 'all received' };
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      const nc = Object.assign({}, c, { receipts: Object.assign({}, c.receipts, { [id]: rc }) });
      if (allBack) nc.closed = patch[`pt_flowChallans/${no}/closed`];
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: nc });
      renderFlow();
      return '';
    },
  });
  if (typeof ptImgFill === 'function') ptImgFill((c.lines || []).map(l => l.sku), false, typeof ptImgPatch === 'function' ? ptImgPatch : null);
}
/** Close a challan that will not come back in full — the reason is kept, and its lines move on with what came. */
function flowCloseShortOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  ptOpenDialog({
    title: `Close ${no} short`,
    subtitle: 'What has not come back will not come. The lines move on to the store with what was received.',
    html: '<label>Why (shortage, damage, the printer kept it…)<input id="flcWhy"></label>',
    saveLabel: 'Close the challan',
    onSave: async () => {
      const why = $('flcWhy').value.trim(); if (!why) return 'Say why it is closed short.';
      const g = await flowGuard('ch_' + no); if (g) return g;
      const val = { at: new Date().toISOString(), by: ME.email || '', why, short: true };
      try { await ptPatch({ [`pt_flowChallans/${no}/closed`]: val }); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: Object.assign({}, c, { closed: val }) });
      renderFlow();
      return '';
    },
  });
}

/* ---- the printer PPC gives a printed line to — suggested from the current planning ----
 * 1. Printer Allocation: the printer fed against that brand + colour (the colour IS the design)
 * 2. else the printer this colour was last given to — a vendor order with one of its SKUs, or an earlier challan
 * Nothing found → blank, and PPC picks. */
function flowPrinterFor(r) {
  const m = cutSkuOf(r.sku) || {}, color = String(m.color || r.color || '').trim(), brand = m.brand || '';
  let vens = []; try { vens = flowChVendors(); } catch (e) { vens = []; }
  const find = x => { const k = String(x || '').trim().toLowerCase(); if (!k) return null;
    return vens.find(v => [v.code, v.desc, v.name].some(y => String(y || '').trim().toLowerCase() === k)) || null; };
  const as = (v, why) => ({ code: v.code, name: v.desc || v.name || v.code, why });
  if (color) {
    try { const info = palInfoOf(palKey(brand, color)); const v = find(info && info.printer); if (v) return as(v, `Printer Allocation: ${color} is allocated to this printer`); } catch (e) { /* allocation not read */ }
    let best = null;
    try { (VO.rows || []).forEach(o => voLines(o).forEach(l => { const lm = l.sku && cutSkuOf(l.sku);
      if (lm && String(lm.color || '').trim() === color && (!best || String(o.orderDate || '') > String(best.date))) best = { code: o.vendorCode, date: String(o.orderDate || '') }; })); } catch (e) { /* vendor orders not read */ }
    Object.values(FLOW.ch || {}).forEach(c => (c.lines || []).forEach(l => { const lm = cutSkuOf(l.sku);
      if (lm && String(lm.color || '').trim() === color && (!best || String(c.date || '') > best.date)) best = { code: c.vendor && c.vendor.code, date: String(c.date || '') }; }));
    const v = best && find(best.code); if (v) return as(v, `last given ${color} (${best.date.slice(0, 10)})`);
  }
  return { code: '', name: '', why: color ? `no printer allocated to ${color} yet` : 'no colour on the master' };
}
