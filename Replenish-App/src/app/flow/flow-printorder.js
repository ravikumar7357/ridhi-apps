/* ================= PRODUCTION FLOW · PRINT ORDERS — what each printer prints, sent the moment PPC plans =================
 * Ravi, 10 Oct: "PPC team jab demand generate kare to uska demand 3 jagah jay — printer ko kya print karna h uska order same
 * time chala jay, and uske baad usase related fabric team bhejti rahe". Raising a plan does three things at once:
 *   1. the PRINTER gets a print order — what to print (fabric SKU or the SKU itself) and how much      (this file)
 *   2. the FABRIC TEAM gets the cloth to send for it — Demand · RFD, in as many challans as it takes  (flow-challan.js)
 *   3. the ACCESSORIES TEAM gets what to reserve — Demand · Accessories                                 (flow-demand.js)
 * One print order per PO and printer; a re-plan updates its line, a printer changed moves the line, an undone plan takes
 * it off. On the test link a print order stays in the flow (numbered, printable) — it is not a Vendor Order, so no real
 * printer's portal shows it.
 *   pt_flowPrintOrders/<no> = { no, date, orderNo, printer:{code,name}, items:{ <line>: {sku, item, print, extras, pcs,
 *                               metres, unit} }, at, by, cancelled? }  */

/** Which print order holds each line: { lineKey: no } — cached on FLOW.po. */
let FLOW_POX = { src: null, map: {} };
function flowPoIndex() {
  if (FLOW_POX.src === FLOW.po) return FLOW_POX.map;
  const map = {};
  Object.values(FLOW.po || {}).forEach(o => { if (o && !o.cancelled) Object.keys(o.items || {}).forEach(k => { if (o.items[k]) map[k] = o.no; }); });
  FLOW_POX = { src: FLOW.po, map };
  return map;
}
function flowPoNo(date, test) {
  const pre = (test ? 'TPRN-' : 'PRN-') + String(date || dToday()).slice(0, 7).replace('-', '') + '-';
  const used = Object.keys(FLOW.po || {}).filter(k => k.startsWith(pre)).map(k => +k.slice(-3) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}
/** The item a print order carries for one planned line: what is printed, and how much is still to print. */
function flowPoItem(r, p) {
  const w = flowPrintWhat(r, p), tp = flowToPrint(r, p);
  return { sku: obUC(r.sku), item: flowChItem(r), print: w, extras: flowPrintExtras(r, p), unit: w.kind === 'sku' ? 'pcs' : 'm',
    pcs: tp.pcs, metres: tp.metres };
}
/**
 * The writes that keep print orders in step with the plans being saved: [{ r, p (null = no plan any more) }].
 * Returns { patch, said, local } — local is FLOW.po as it will be after the writes.
 */
function flowPoSync(items, date) {
  const local = Object.assign({}, FLOW.po || {}), patch = {}, said = [], idx = Object.assign({}, flowPoIndex()), now = new Date().toISOString();
  const take = (no, key) => { const o = local[no]; if (!o || !o.items || !o.items[key]) return;
    local[no] = Object.assign({}, o, { items: Object.assign({}, o.items, { [key]: null }) }); patch[`pt_flowPrintOrders/${no}/items/${key}`] = null; delete idx[key];
    if (!Object.values(local[no].items).some(Boolean)) { const c = { at: now, by: ME.email || '', why: 'no line left' }; local[no] = Object.assign({}, local[no], { cancelled: c }); patch[`pt_flowPrintOrders/${no}/cancelled`] = c; } };
  items.forEach(({ r, p }) => {
    const key = flowKey(r.orderNo, r.sku), cur = idx[key], pc = p && flowRouteOf(p) === 'inhouse' && p.printer && p.printer.code;
    if (!pc) { if (cur) { take(cur, key); said.push(`${obUC(r.sku)} taken off print order ${cur}`); } return; }
    if (cur && String((local[cur].printer || {}).code) !== String(pc)) { take(cur, key); said.push(`${obUC(r.sku)} moved off ${cur}`); }
    let no = idx[key];
    if (!no) no = Object.keys(local).find(n => { const o = local[n]; return o && !o.cancelled && o.orderNo === r.orderNo && String((o.printer || {}).code) === String(pc); });
    const item = flowPoItem(r, p);
    if (!no) {
      no = flowPoNo(date, !!r.__t);
      local[no] = { no, date: date || dToday(), orderNo: r.orderNo, printer: { code: pc, name: p.printer.name }, items: {}, at: now, by: ME.email || '', test: !!r.__t };
      patch['pt_flowPrintOrders/' + no] = Object.assign({}, local[no], { items: { [key]: item } });
      said.push(`print order ${no} → ${p.printer.name}`);
    } else if (patch['pt_flowPrintOrders/' + no]) patch['pt_flowPrintOrders/' + no].items[key] = item;
    else patch[`pt_flowPrintOrders/${no}/items/${key}`] = item;
    local[no] = Object.assign({}, local[no], { items: Object.assign({}, local[no].items, { [key]: item }) }); idx[key] = no;
  });
  return { patch, said, local };
}

/** How far a print order has got: per item the cloth sent (challans) and the printed back, in the item's unit. */
function flowPoProgress(o) {
  const cx = flowChIndex();
  return Object.entries(o.items || {}).filter(([, it]) => it).map(([key, it]) => {
    const c = cx[key] || { sent: 0, recv: 0 }, need = it.unit === 'pcs' ? it.pcs : it.metres;
    return { key, it, need, sent: flowR2(c.sent || 0), back: flowR2(c.recv || 0), done: need <= 0 || ((c.recv || 0) >= need - 0.01) };
  });
}
const flowPoState = o => o.cancelled ? 'cancelled' : flowPoProgress(o).every(x => x.done) ? 'done' : flowPoProgress(o).some(x => x.sent > 0) ? 'part' : 'open';

/** The Print orders bucket: every print order, open first. */
function flowPoTable(q, testOnly) {
  const list = Object.values(FLOW.po || {}).filter(o => o && (!testOnly || o.test))
    .filter(o => !q || [o.no, o.orderNo, o.printer && o.printer.name].concat(Object.values(o.items || {}).filter(Boolean).map(i => i.sku)).join(' ').toLowerCase().includes(q))
    .sort((a, b) => (['done', 'cancelled'].includes(flowPoState(a))) - (['done', 'cancelled'].includes(flowPoState(b))) || String(b.no).localeCompare(String(a.no)));
  const pill = st => ({ open: '<span class="jw-st pend">sent to printer</span>', part: '<span class="jw-st prog">fabric going</span>', done: '<span class="jw-st done">printed, back</span>',
    cancelled: '<span class="jw-st" style="background:#f1f5f9;color:#64748b">cancelled</span>' })[st];
  const q2 = (n, u) => nf(flowR2(n)) + (u === 'pcs' ? ' pcs' : ' m');
  const body = list.map(o => { const pr = flowPoProgress(o), st = flowPoState(o);
    return `<tr><td class="frz" style="text-align:left"><b>${esc(o.no)}</b>${o.test ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}<div class="muted" style="font-size:10.5px">${esc(o.date || '')}</div></td>
      <td style="text-align:left">${esc(o.orderNo)}</td><td style="text-align:left"><b>${esc(o.printer && o.printer.name)}</b></td>
      <td style="text-align:left;font-size:11.5px">${pr.map(x => `${esc(x.it.sku)} · ${x.it.print && x.it.print.code ? `<b>${esc(x.it.print.code)}</b>` : '<span style="color:#b91c1c">no fabric SKU</span>'} · ${q2(x.need, x.it.unit)}
        <span class="muted">— cloth sent ${q2(x.sent, x.it.unit)}, back ${q2(x.back, x.it.unit)}</span>`).join('<br>')}</td>
      <td>${pill(st)}</td><td><button class="ghost" data-flpop="${esc(o.no)}" style="width:auto;padding:2px 8px;font-size:11.5px">Print</button></td></tr>`; }).join('');
  return `<thead><tr><th class="frz" style="text-align:left">Print order</th><th style="text-align:left">Order</th><th style="text-align:left">Printer</th><th style="text-align:left">What to print · fabric sent · printed back</th><th>Status</th><th></th></tr></thead><tbody>`
    + (body || '<tr><td colspan="6" class="muted" style="padding:16px">No print order yet — PPC raising a plan sends one.</td></tr>') + '</tbody>';
}

/** The print order as a page for the printer: what to print, grouped like a challan's "To print". */
function flowPoHtml(o) {
  let s = {}; try { s = (GPO && GPO.settings) || {}; } catch (e) { s = {}; }
  const e = v => esc(v == null ? '' : String(v)), cell = 'border:1px solid #999;padding:6px 8px;font-size:11px';
  const lines = Object.values(o.items || {}).filter(Boolean);
  const groups = flowChPrintGroups({ lines: lines.map(it => ({ print: it.print, extras: it.extras, metres: it.metres, pcs: it.pcs, fabric: '' })) });
  const dmy = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(o.no) + '</title></head><body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top"><div style="font-size:18px;font-weight:bold">${e(s.company || 'The Fabric Rush')}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(s.address)}</div></td><td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">PRINT ORDER</div>`
    + `<div style="font-size:12px;margin-top:4px">No: <b>${e(o.no)}</b></div><div style="font-size:12px">Date: ${e(dmy(o.date))}</div><div style="font-size:12px">Order: <b>${e(o.orderNo)}</b></div></td></tr></table>`
    + `<div style="margin:16px 0 8px;font-size:12px"><b>To</b><br>${e(o.printer && o.printer.name)}</div>`
    + `<div style="font-size:12px;margin-bottom:6px">Please print the following. The RFD cloth follows on our delivery challans.</div>`
    + `<table style="width:100%;border-collapse:collapse"><tr style="background:#f0f0f0">${['Print', 'What it is', 'Given as', 'Quantity'].map(h => `<th style="${cell};text-align:left">${h}</th>`).join('')}</tr>`
    + groups.map(g => `<tr><td style="${cell}"><b>${e(g.code || 'fabric SKU to be confirmed')}</b></td><td style="${cell}">${e(g.label)}</td><td style="${cell}">${e(g.mode)}</td>`
      + `<td style="${cell};text-align:right"><b>${e(g.kind === 'sku' ? nf(g.pcs) + ' pcs' : nf(flowR2(g.metres)) + ' m')}</b></td></tr>`).join('') + '</table>'
    + `<div style="font-size:12px;font-weight:bold;margin:14px 0 6px">For these order lines</div><table style="width:100%;border-collapse:collapse"><tr style="background:#f0f0f0">`
    + ['SKU', 'Item', 'Print', 'Quantity'].map(h => `<th style="${cell};text-align:left">${h}</th>`).join('') + '</tr>'
    + lines.map(it => `<tr><td style="${cell}">${e(it.sku)}</td><td style="${cell}">${e(it.item)}</td><td style="${cell}">${e((it.print && it.print.code) || '—')}</td><td style="${cell};text-align:right">${e(it.unit === 'pcs' ? nf(it.pcs) + ' pcs' : nf(it.metres) + ' m')}</td></tr>`).join('')
    + '</table><table style="width:100%;margin-top:50px;font-size:11px"><tr><td>Issued by<br><br><br>' + e(String(o.by || '').split('@')[0]) + '</td><td style="text-align:right">Accepted by (' + e(o.printer && o.printer.name) + ')<br><br><br>Signature &amp; date</td></tr></table></body></html>';
}
function flowPoPrint(no) {
  const o = (FLOW.po || {})[no]; if (!o) return 'That print order is not here — press Refresh.';
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press Print again.';
  w.document.open();
  w.document.write(flowPoHtml(o).replace('</body>', '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div><style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
  return '';
}
