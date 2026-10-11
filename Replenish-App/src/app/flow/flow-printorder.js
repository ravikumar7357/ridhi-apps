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

/** Whether a planned line still sends anything to a printer once printed stock is taken: body or ruffle cloth. */
const flowPrintsSomething = (r, p) => { const w = flowPrintWhat(r, p), tp = flowToPrint(r, p);
  return (w.kind === 'sku' ? tp.pcs > 0 : tp.metres > 0.01) || flowPrintExtras(r, p).length > 0; };
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
    /* All from printed stock (body and ruffle): nothing for a printer — no print order, no vendor order. */
    const prints = p && flowRouteOf(p) === 'inhouse' && flowPrintsSomething(r, p);
    const key = flowKey(r.orderNo, r.sku), cur = idx[key], pc = prints && p.printer && p.printer.code;
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
      <td style="text-align:left;font-size:11.5px">${pr.length > 1 ? `<div style="margin-bottom:3px">Print, combined: ${flowChPrintGroups({ lines: pr.map(x => x.it) }).filter(g => (g.kind === 'sku' ? g.pcs : g.metres) > 0)
          .map(g => `<b>${esc(g.code || 'fabric SKU to be confirmed')}</b> ${g.kind === 'sku' ? nf(g.pcs) + ' pcs' : nf(flowR2(g.metres)) + ' m'}`).join(' · ')}</div>` : ''}${pr.map(x => `<span${pr.length > 1 ? ' class="muted"' : ''}>${esc(x.it.sku)} · ${x.it.print && x.it.print.code ? `<b>${esc(x.it.print.code)}</b>` : '<span style="color:#b91c1c">no fabric SKU</span>'} · ${q2(x.need, x.it.unit)}</span>
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

/* ---- THE REAL VENDOR ORDER (Ravi, 10 Oct: "PPC se vendor order me printer ko order jay" — placed directly, the printer
 * sees it in the Vendor Portal) ----
 * A flow print order for a REAL order is placed as Vendor Order(s) in pt_vendorOrders, in the very shape the Vendor Orders
 * screen writes: one running order (printed cloth: fabric SKU, fabric, colour, direction, metres — a quilt's Front and Back
 * as two lines, the ruffle cloth its own line) and one cut order (pieces printed on the SKU), each line naming the sales
 * order it is for (forOrders) and its flow line (flowKey/flowPart) so a re-plan finds it again. A test order never makes
 * one. A vendor order the printer has started delivering is never rewritten from here. */
function flowChannelOf(r, m) {
  const s = String((r && r.src) || String((r && r.orderNo) || '').split('-')[0]).toUpperCase();
  if (s === 'AMZ') return 'Amazon'; if (s === 'B2B') return 'B2B';
  if (/SHP|ONL/.test(s)) return /CPC/i.test(String((m && m.brand) || '')) ? 'CPC Shopify' : 'Shopify';
  return '';
}
/** The vendor-order lines a flow print order stands for: { running: [...], cut: [...], channel }. */
function flowVoLines(o, planOf) {
  const out = { running: [], cut: [], channel: '' };
  Object.entries(o.items || {}).forEach(([key, it]) => {
    if (!it) return;
    const row = flowRows().find(x => x.s.key === key), r = row ? row.r : { orderNo: o.orderNo, sku: it.sku };
    const p = (planOf && planOf(key)) || (row && row.s.plan) || {};   // the plan being saved, not the one it replaces
    const m = cutSkuOf(it.sku) || {}, w = it.print || {};
    if (!out.channel) out.channel = flowChannelOf(r, m);
    const base = { brand: m.brand || '', color: String(m.color || r.color || '').trim(), deliveryDate: (p.dates && p.dates.cut) || '', dispatchedQty: 0,
      notes: `${o.orderNo} · ${it.sku} (PPC ${o.no})`, priority: 'P2', forOrders: [{ orderNo: o.orderNo, qty: +r.qty || it.pcs || 0 }], flowKey: key };
    if (w.kind === 'sku') {
      if (it.pcs > 0) out.cut.push(Object.assign({}, base, { kind: 'cut', sku: it.sku, qty: it.pcs, articleType: m.articleType || '',
        articleSubtype: m.subtype || m.articleSubtype || '', size: m.size || '', flowPart: key + '|sku' }));
    } else {
      const fab = String((p.fabric && p.fabric.name) || m.fabric || '').trim(), dir = (p.print && p.print.dir) || String(w.label || '').split(' · ')[2] || '';
      const parts = w.sides && w.sides.length ? w.sides.map(sd => ({ sku: sd.code, meters: flowR2(it.metres / w.sides.length), part: sd.side }))
        : [{ sku: w.code, meters: it.metres, part: 'body' }];
      parts.forEach(pt => { if (pt.meters > 0) out.running.push(Object.assign({}, base, { kind: 'running', sku: pt.sku, fabricType: fab, printDirection: dir, meters: pt.meters, flowPart: key + '|' + pt.part })); });
    }
    (it.extras || []).forEach(x => { if (+x.metres > 0) out.running.push(Object.assign({}, base, { kind: 'running', sku: x.code, fabricType: String(x.label || '').split(' · ')[1] || '',
      printDirection: String(x.label || '').split(' · ')[2] || '', meters: flowR2(+x.metres), notes: base.notes + ' · ruffle', flowPart: key + '|ruffle' })); });
  });
  /* COMBINED (Ravi, 11 Oct): one vendor-order line per printed fabric (fabric, colour, direction) and per printed SKU, across
   * the order's lines — the printer prints RBPSF9-H-82 once, for both pillow sizes. flowPart names every part it stands for. */
  const merge = (list, keyOf, qty) => { const m = new Map();
    list.forEach(l => { const k = keyOf(l), e = m.get(k);
      if (!e) { m.set(k, Object.assign({}, l, { forOrders: (l.forOrders || []).map(f => Object.assign({}, f)), parts: [l.flowPart], skus: [String(l.notes || '').split(' · ')[1] || ''] })); return; }
      e[qty] = qty === 'meters' ? flowR2((+e[qty] || 0) + (+l[qty] || 0)) : (+e[qty] || 0) + (+l[qty] || 0);
      (l.forOrders || []).forEach(f => { const o = e.forOrders.find(x => x.orderNo === f.orderNo); if (o) o.qty = (+o.qty || 0) + (+f.qty || 0); else e.forOrders.push(Object.assign({}, f)); });
      e.parts.push(l.flowPart); e.skus.push(String(l.notes || '').split(' · ')[1] || '');
      if (l.deliveryDate && (!e.deliveryDate || l.deliveryDate < e.deliveryDate)) e.deliveryDate = l.deliveryDate; });
    return [...m.values()].map(e => { const { parts, skus, ...l } = e; const u = [...new Set(skus.map(x => x.replace(/ \(PPC.*$/, '')).filter(Boolean))];
      return Object.assign(l, { flowPart: parts.slice().sort().join('+'), ...(parts.length > 1 ? { notes: `${o.orderNo} · ${u.join(', ')} (PPC ${o.no})${/· ruffle$/.test(l.notes || '') ? ' · ruffle' : ''}`, forOrders: l.forOrders } : {}) }); }); };
  out.running = merge(out.running, l => [obUC(l.sku), fabKey(l.fabricType), String(l.printDirection || '').toLowerCase(), fabKey(l.color)].join('|'), 'meters');
  out.cut = merge(out.cut, l => obUC(l.sku), 'qty');
  return out;
}
/**
 * The Vendor Order writes for the flow print orders `nos` (already updated in `local`). Mutates `local[no].vo` and puts the
 * link into `patch` the safe way (inside a whole-record write when the same save writes the whole record).
 */
function flowVoSync(local, nos, patch, planOf) {
  const said = [], placed = [], now = new Date().toISOString();
  [...new Set(nos)].forEach(no => {
    const o = local[no]; if (!o || o.test) return;
    const want = o.cancelled ? { running: [], cut: [], channel: '' } : flowVoLines(o, planOf);
    const vo = Object.assign({}, o.vo || {});
    ['running', 'cut'].forEach(kind => {
      const ref = vo[kind], existing = ref ? (VO.rows || []).find(x => x && x.vendorCode === ref.code && x.id === ref.id) : null;
      if (existing && voLines(existing).some(l => (l.deliveries || []).length || +l.dispatchedQty > 0)) {
        said.push(`${existing.orderNo} has deliveries already — change it on Vendor Orders`); return; }
      const lines = want[kind];
      if (!lines.length) {
        if (existing && existing.status !== 'Cancelled') {
          const c = Object.assign({}, existing, { status: 'Cancelled', staffUpdatedAt: now });
          patch[`pt_vendorOrders/${ref.code}/${ref.id}`] = c; placed.push(c); said.push(`${existing.orderNo} cancelled`); }
        return;
      }
      const prev = {}; if (existing) voLines(existing).forEach(l => { if (l.flowPart) prev[l.flowPart] = l; });
      const ln = lines.map(l => Object.assign({ lineId: (prev[l.flowPart] || {}).lineId || 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }, l));
      const order = existing
        ? Object.assign({}, existing, { lines: ln, status: existing.status === 'Cancelled' ? 'Placed' : existing.status, staffUpdatedAt: now })
        : { id: 'vpo_flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), orderNo: voNewOrderNo(), vendorCode: o.printer.code, vendorName: o.printer.name,
            service: 'Block print', ...(want.channel ? { channel: want.channel } : {}), orderType: kind, orderDate: voTodayDMY(), status: 'Placed',
            notes: `From the PPC plan — ${o.orderNo} (${o.no})`, lines: ln, createdBy: ME.email || '', createdAt: now, demandSource: 'ppc', flowPrintOrder: o.no };
      patch[`pt_vendorOrders/${order.vendorCode}/${order.id}`] = order; placed.push(order);
      vo[kind] = { code: order.vendorCode, id: order.id, orderNo: order.orderNo };
      if (!existing) VO.rows = (VO.rows || []).concat([order]);   // so the next number drawn this save is a different one
      said.push(existing ? `${order.orderNo} updated` : `Vendor Order ${order.orderNo} placed with ${o.printer.name}`);
    });
    local[no] = Object.assign({}, local[no], { vo });
    if (patch['pt_flowPrintOrders/' + no]) patch['pt_flowPrintOrders/' + no] = Object.assign({}, patch['pt_flowPrintOrders/' + no], { vo });
    else patch[`pt_flowPrintOrders/${no}/vo`] = vo;
  });
  return { said, placed };
}
/**
 * Everything the Vendor Order side of a save needs: the writes, the question to ask before a printer is told, and
 * how to put VO.rows back if the answer is no or the write is refused.
 */
async function flowVoPrepare(local, patch, planOf) {
  if (VO.rows == null && typeof ensureVo === 'function') { try { await ensureVo(); } catch (e) { /* placed fresh; a re-plan cannot find the old one */ } }
  const before = VO.rows, vs = flowVoSync(local, flowPoNosIn(patch), patch, planOf);
  const live = vs.placed.filter(o => o.status !== 'Cancelled');
  const ask = vs.placed.length ? `This ${live.length ? 'places / changes' : 'cancels'} Vendor Order(s) the printer sees in the Vendor Portal now:\n`
    + vs.placed.map(o => `• ${o.orderNo} — ${o.vendorName} — ${o.status === 'Cancelled' ? 'cancelled' : voLines(o).length + ' line(s)'}`).join('\n') + '\n\nGo ahead?' : '';
  return { said: vs.said, placed: vs.placed, ask, undo: () => { VO.rows = before; } };
}
/** The flow print orders a patch touches. */
const flowPoNosIn = patch => [...new Set(Object.keys(patch).filter(k => k.startsWith('pt_flowPrintOrders/')).map(k => k.split('/')[1]))];
/** After a write: the vendor orders it placed or changed, into VO.rows — the Vendor Orders screen and the portal read those. */
function flowVoAfter(placed) {
  if (!placed.length) return;
  const byId = new Map(placed.map(o => [o.vendorCode + '/' + o.id, o]));
  VO.rows = (VO.rows || []).filter(o => !(o && byId.has(o.vendorCode + '/' + o.id))).concat(placed);
}
