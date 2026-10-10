/* ================= PRODUCTION FLOW · RFD CHALLAN — the fabric of one order, to one vendor =================
 * Ravi, 10 Oct: "i need a challan here order wise and kis vendor ko de rahe h, yahin se challan generate kare".
 * From Demand · RFD fabric: pick the PO's lines, the vendor, the metres → a numbered delivery challan to print, and
 * those lines' fabric is marked given (it IS ready: it left the store on this paper), so they move on by themselves.
 *   pt_flowChallans/<no> = { no, date, orderNo, vendor:{code, name}, lines:[{key, sku, item, fabric, pcs, metres}], note, at, by }
 *   pt_flowDemand/<line>/fabricReady gets { …, challan: no, vendor: name }
 * The challan's metres stay KEPT out of the RFD stock shown here until the printed cloth is back (or cut / issued) —
 * the Fabric register itself is not written from this test view. */

/* WHAT THE PRINTER PRINTS (Ravi, 10 Oct): printing job work goes out two ways.
 *   running fabric            the printed FABRIC SKU of the catalogue (fabric + colour + direction + colour code,
 *                             e.g. CPCSF001-V-62 · Light Steel Blue · Sheeting 62 · Vertical), in metres
 *   cut pieces, no cutting    the product SKU itself is printed — the printer gets the pieces, prints on the SKU
 *   cut pieces, cutting req.  cut from the printed cloth here, so the printer prints the FABRIC SKU, like running
 * Running vs cut pieces is the app's own rule (ordPrintAsPcs: the printing rule, else "Cutting required: no" = pieces).
 * A fabric SKU the catalogue does not have is said, never made up. */
/* FROM THE MASTER DATA (Ravi, 10 Oct: "fetch the data correctly from the master data"). The master row decides:
 *   Cutting required: no   → the SKU itself is printed (the pieces go to the printer)
 *   Cutting required: yes  → the printed FABRIC SKU of the master row's fabric + colour + colour code + direction
 * The fabric is PPC's plan (which starts from the master row), else the master row's own fabric. The direction is PPC's
 * choice (plan.print.dir); a quilt's comes from its lay; a fabric made only one way (Canvas, Cambric) needs none. A
 * sheeting or voil with no direction chosen says so — it is never shown as both. */
function flowPrintWhat(r, plan) {
  const m = cutSkuOf(r.sku) || {};
  if (m.cuttingRequired === false)
    return { kind: 'sku', code: obUC(r.sku), mode: 'Cut pieces', label: 'printed on the SKU itself (no cutting)', unit: 'pcs' };
  const fab = String((plan && plan.fabric && plan.fabric.name) || m.fabric || '').trim();
  const colour = String(m.color || r.color || '').trim(), cc = ordColCodeOf(r.sku);
  const dirs = flowFabDirs(fab, colour, cc);
  let dir = (plan && plan.print && plan.print.dir) || flowDirDefault(m, fab);
  if (!dir && dirs.length === 1) dir = dirs[0];
  let rule = ''; try { rule = ptPrintIssueAs(m) || ''; } catch (e) { rule = ''; }
  const mode = rule === 'cut' ? 'Cut pieces (cut here from the printed fabric)' : 'Running fabric';
  if (!dir && dirs.length > 1)
    return { kind: 'fabric', code: '', needDir: true, mode, label: [colour, fab].filter(Boolean).join(' · '), unit: 'm' };
  /* FRONT AND BACK (Ravi, 10 Oct: "quilt ka total 5 m, 2.5 front aur 2.5 back"). A voil comes as a Front SKU and a Back
   * SKU; the line's cloth is split evenly between the sides the catalogue has, each its own printed fabric. */
  const hits = flowFabHits(fab, colour, dir, cc);
  const sideNames = [...new Set(hits.map(h => String(h.side || '').trim()).filter(Boolean))].sort((a, b) => (/front/i.test(b) ? 1 : 0) - (/front/i.test(a) ? 1 : 0) || a.localeCompare(b));
  if (sideNames.length > 1) {
    const sides = sideNames.map(sd => ({ side: sd, code: [...new Set(hits.filter(h => String(h.side || '').trim() === sd).map(h => h.sku))].join(' ') }));
    return { kind: 'fabric', code: sides.map(x => x.code).join(' + '), sides, mode, label: [colour, fab, dir, sideNames.join(' + ')].filter(Boolean).join(' · '), unit: 'm' };
  }
  const code = [...new Set(hits.map(c => c.sku))].join(' ');
  return { kind: 'fabric', code, mode, label: [colour, fab, dir].filter(Boolean).join(' · '), unit: 'm' };
}
/* THE RUFFLE CLOTH IS PRINTED TOO (Ravi, 10 Oct, the 327 catalogue: Cambric → LSB). A ruffle SKU's ruffle cloth (the
 * plan's "Ruffle — <fabric>", from the master row / recipe / ruffle rule) goes to the same printer as the body: its
 * printed fabric SKU, in metres. Only for a printed line. */
function flowPrintExtras(r, plan) {
  if (!plan || flowRouteOf(plan) !== 'inhouse') return [];
  const m = cutSkuOf(r.sku) || {}, colour = String(m.color || r.color || '').trim(), cc = ordColCodeOf(r.sku);
  return (plan.extra || []).filter(x => x.unit === 'm' && /^Ruffle — /.test(String(x.what || '')) && +x.qty > 0).map(x => {
    const fab = String(x.what).replace(/^Ruffle — /, '').trim(), dirs = flowFabDirs(fab, colour, cc);
    const dir = dirs.length === 1 ? dirs[0] : ((plan.print && plan.print.dir) || '');
    const code = dir || !dirs.length ? flowFabSku(fab, colour, dir, cc) : '';
    const left = flowR2(Math.max(0, (+x.qty || 0) - (+x.fromPrinted || 0)));
    return { kind: 'fabric', code, mode: 'Ruffle cloth', label: [colour, fab, dir].filter(Boolean).join(' · '), unit: 'm', metres: left, total: flowR2(+x.qty), fromPrinted: flowR2(+x.fromPrinted || 0), what: 'ruffle' };
  }).filter(x => x.metres > 0);
}
const flowExtrasTxt = xs => xs.map(w => `<div style="font-size:11px;color:#4338ca">+ Ruffle: ${w.code ? `<b>${esc(w.code)}</b>` : '<b style="color:#b91c1c">no fabric SKU in the catalogue</b>'} · ${esc(w.label)} · ${nf(w.metres)} m</div>`).join('');
/* THE FABRIC CATALOGUE, BY ITS OWN COLOUR CODE (Ravi, 10 Oct: Canvas showed "no fabric SKU"). Each catalogue row
 * carries its colour code; reading it back out of the SKU text fails for RBP-CANVAS-327 and for a code added by hand
 * like LSB. Where a fabric SKU was ADDED BY HAND for the same fabric, colour and direction, it is the one — it is a
 * decision somebody made over the built name. */
function flowFabHits(fab, colour, dir, cc) {
  const lo = x => String(x || '').trim().toLowerCase(), num = x => Number(String(x || '').replace(/\D/g, '')) || 0;
  let cat = []; try { cat = [...voFabricCatalogue().values()]; } catch (e) { cat = []; }
  const codeOf = c => String(c.code || ordColCodeOf(c.sku) || '');
  const hits = cat.filter(c => lo(c.fabric) === lo(fab) && lo(c.colour) === lo(colour) && (!lo(dir) || !lo(c.dir) || lo(c.dir) === lo(dir))
    && (!cc || codeOf(c) === String(cc) || (num(codeOf(c)) && num(codeOf(c)) === num(cc))));
  const byDir = new Map();
  hits.forEach(c => { const k = lo(c.dir) + '|' + lo(c.side); const e = byDir.get(k);
    if (!e || (c.manual && !e.some(x => x.manual))) byDir.set(k, [c]); else if (!!c.manual === !!e[0].manual) e.push(c); });
  return [].concat(...byDir.values());
}
const flowFabSku = (fab, colour, dir, cc) => [...new Set(flowFabHits(fab, colour, dir, cc).map(c => c.sku))].join(' ');
/* WHAT STILL HAS TO BE PRINTED (Ravi, 10 Oct: the ruffle showed short with 1,500 m of printed LSB in the store). PPC
 * takes printed stock first; only the rest goes to RFD and the printer. A line printed on the SKU counts pieces. */
function flowToPrint(r, p) {
  const qty = +r.qty || 0, m = flowR2(+(p && p.fabric && p.fabric.metres) || 0), fp = +(p && p.fabric && p.fabric.fromPrinted) || 0;
  if (p && p.fabric && p.fabric.printedUnit === 'pcs') { const pcs = Math.max(0, qty - fp); return { pcs, metres: qty ? flowR2(m * pcs / qty) : 0 }; }
  return { pcs: qty, metres: flowR2(Math.max(0, m - fp)) };
}
/** The directions the fabric catalogue makes this fabric + colour (+ code) in. */
function flowFabDirs(fab, colour, cc) {
  return [...new Set(flowFabHits(fab, colour, '', cc).map(h => String(h.dir || '').trim()).filter(Boolean))].sort();
}
/** A direction nobody has to choose: a quilt's comes from how it lies on the roll. */
function flowDirDefault(m, fab) { try { return ptPrintDir(m, fab) || ''; } catch (e) { return ''; } }
const flowPrintTxt = w => w.kind === 'sku' ? `<b>${esc(w.code)}</b> · ${esc(w.label)}`
  : w.sides ? w.sides.map(x => `${esc(x.side)} <b>${esc(x.code)}</b>`).join(' + ') + ` · ${esc(w.label)} <span class="muted">(half the cloth each)</span>`
  : w.needDir ? `<b style="color:#b91c1c">pick the print direction</b> · ${esc(w.label)}`
  : `${w.code ? `<b>${esc(w.code)}</b>` : '<b style="color:#b91c1c">no fabric SKU in the catalogue</b>'} · ${esc(w.label)}`;

const flowChItem = r => [r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · ');
/** The next number for a month: RFD-YYYYMM-001, after every challan already saved that month. */
function flowChallanNo(date, test) {
  /* A test order's challans count on their own (TRFD-…), so testing never uses up a real number. */
  const pre = (test ? 'TRFD-' : 'RFD-') + String(date || dToday()).slice(0, 7).replace('-', '') + '-';
  const used = Object.keys(FLOW.ch || {}).filter(k => k.startsWith(pre)).map(k => +k.slice(-3) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}
const flowChVendors = () => {
  let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const pr = all.filter(v => String(v.category || '').trim().toLowerCase() === 'printer');
  return pr.concat(all.filter(v => !pr.includes(v)));
};

/** The challan for one PO: its lines still waiting for fabric. */
/* ONE CHALLAN, ONE PRINTER, THE PRINTER PPC PLANNED (Ravi, 10 Oct: "the challan and the PO's made-as do not match").
 * A PO's lines can be planned for different printers; each printer gets its own challan with only its own lines.
 * A stitching-only line goes to no printer, so never on a challan (Mark fabric ready). A line PPC left without a
 * printer takes the one picked here, and its plan says so from then on. */
const flowPlanPrinter = s => (s.plan && s.plan.printer && s.plan.printer.code) || '';
function flowChallanOpen(orderNo, pcode) {
  const rows = flowRows().filter(x => x.r.orderNo === orderNo && flowInView('drfd', x.s) && x.s.route !== 'stitch'
    && (pcode == null || (pcode === '?' ? !flowPlanPrinter(x.s) : flowPlanPrinter(x.s) === pcode)));
  return flowChallanDialog(rows, pcode);
}
/* SEVERAL ORDERS, ONE PRINTED FABRIC, ONE VENDOR (Ravi, 10 Oct: "same printed fabric ki requirement alag alag order me h
 * to sabka total hokar vendor ko ek saath assign karne ka option ho"). Demand · RFD → By printed fabric lists each printed
 * fabric with every order waiting for it; one press makes one challan for all of them. */
function flowChallanForKeys(keys) {
  const want = new Set(keys), rows = flowRows().filter(x => want.has(x.s.key) && flowInView('drfd', x.s) && x.s.route !== 'stitch');
  if (rows.some(x => !!x.r.__t) && rows.some(x => !x.r.__t)) { $('flMsg').className = 'err'; $('flMsg').textContent = 'A test order and a real one cannot share a challan.'; return; }
  const pcs = [...new Set(rows.map(x => flowPlanPrinter(x.s)).filter(Boolean))];
  return flowChallanDialog(rows, pcs.length === 1 ? pcs[0] : null);
}
function flowChallanDialog(rows, pcode) {
  const cv = flowRfdCover();
  if (!rows.length) return;
  const orders = [...new Set(rows.map(x => x.r.orderNo))], orderNo = orders.join(', '), isTest = rows.every(x => !!x.r.__t);
  const vens = flowChVendors();
  /* The printer PPC planned for these lines comes ready picked. */
  const planned = (pcode && pcode !== '?' ? pcode : rows.map(x => flowPlanPrinter(x.s)).find(Boolean)) || '';
  const lineHtml = rows.map((x, i) => { const p = x.s.plan || {}, c = cv.line[x.s.key] || {};
    return `<tr><td><input type="checkbox" data-chk="${i}"${flowToPrint(x.r, p).metres > 0 || flowPrintExtras(x.r, p).length ? ' checked' : ''} style="width:auto"></td>
      <td style="text-align:left"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b>${orders.length > 1 ? ` <span class="muted" style="font-size:10.5px">· ${esc(x.r.orderNo)}</span>` : ''}<div class="muted" style="font-size:10.5px">${esc(flowChItem(x.r))}</div>
        <div style="font-size:11px;color:#4338ca">Print: ${flowPrintTxt(flowPrintWhat(x.r, p))}</div>${flowExtrasTxt(flowPrintExtras(x.r, p))}</td>
      <td style="text-align:left">${esc((p.fabric && p.fabric.name) || '—')}</td>
      <td class="num">${nf(x.r.qty)}</td>
      <td class="num"><input data-chm="${i}" type="number" step="0.01" value="${esc(flowToPrint(x.r, p).metres || '')}" style="width:90px;padding:3px 6px;font-size:12px">${+(p.fabric && p.fabric.fromPrinted) ? `<div class="muted" style="font-size:10px">${nf(p.fabric.fromPrinted)} ${p.fabric.printedUnit === 'pcs' ? 'pcs' : 'm'} from printed stock</div>` : ''}</td>
      <td style="font-size:11px">${c.short ? `<b style="color:#b91c1c">⚑ short ${nf(c.short)} m</b>` : '<span style="color:#166534">covered</span>'}</td></tr>`; }).join('');
  ptOpenDialog({
    title: `RFD challan — ${orderNo}${pcode && pcode !== '?' ? ' → ' + ((rows[0].s.plan.printer || {}).name || pcode) : ''}`,
    subtitle: (orders.length > 1 ? `${orders.length} orders, one printed fabric, one vendor. ` : 'The fabric of this order, to one vendor. ') + 'Saving numbers the challan, opens it to print, and marks these lines\' fabric as given — they leave Demand by themselves.',
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Vendor<select id="flcVen"><option value="">— pick the vendor —</option>${vens.map(v => `<option value="${esc(v.code)}"${String(v.code) === String(planned) ? ' selected' : ''}>${esc((v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('')}</select></label>
        <label>Date<input id="flcDate" type="date" value="${esc(dToday())}"></label></div>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th></th><th style="text-align:left">SKU</th><th style="text-align:left">Fabric</th><th>Pcs</th><th>Metres</th><th>RFD</th></tr></thead><tbody>${lineHtml}</tbody></table>
      <label style="display:block;margin-top:8px">Note (vehicle, who carried it…)<input id="flcNote"></label>`,
    saveLabel: 'Make the challan',
    onSave: async () => {
      const code = $('flcVen').value, v = vens.find(x => String(x.code) === String(code));
      if (!v) return 'Which vendor is the fabric going to? Pick one.';
      const date = $('flcDate').value || dToday();
      const picked = rows.map((x, i) => ({ x, on: (document.querySelector(`[data-chk="${i}"]`) || {}).checked, m: +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0) }))
        .filter(y => y.on);
      if (!picked.length) return 'Tick at least one line.';
      const other = picked.filter(y => flowPlanPrinter(y.x.s) && flowPlanPrinter(y.x.s) !== String(v.code));
      if (other.length) return `${other.map(y => `${obUC(y.x.r.sku)} is planned for ${y.x.s.plan.printer.name}`).join(' · ')} — give it to that printer, or change the printer with "edit plan" first.`;
      const noM = picked.filter(y => !(y.m > 0)).map(y => obUC(y.x.r.sku));
      if (noM.length) return `How many metres? Type them for ${noM.join(', ')}.`;
      const no = flowChallanNo(date, isTest), now = new Date().toISOString(), vname = v.desc || v.name || v.code;
      const ch = { no, date, orderNo, orders, vendor: { code: v.code, name: vname }, note: $('flcNote').value.trim(), at: now, by: ME.email || '',
        lines: picked.map(({ x, m }) => ({ key: x.s.key, sku: obUC(x.r.sku), item: flowChItem(x.r), print: flowPrintWhat(x.r, x.s.plan), extras: flowPrintExtras(x.r, x.s.plan), fabric: (x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || '', pcs: flowToPrint(x.r, x.s.plan).pcs, metres: flowR2(m) })) };
      const patch = { ['pt_flowChallans/' + no]: ch };
      /* A line PPC left without a printer: the one it went to is now its printer. */
      const setP = picked.filter(y => !flowPlanPrinter(y.x.s)).map(y => y.x.s.key);
      setP.forEach(k => { patch[`pt_ppc/${k}/printer`] = { code: v.code, name: vname, why: 'set by challan ' + no }; });
      ch.lines.forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = { at: now, by: ME.email || '', what: l.fabric, metres: l.metres, note: `Challan ${no} to ${vname}`, challan: no, vendor: vname }; });
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: ch });
      if (setP.length) { FLOW.ppc = Object.assign({}, FLOW.ppc); setP.forEach(k => { FLOW.ppc[k] = Object.assign({}, FLOW.ppc[k], { printer: patch[`pt_ppc/${k}/printer`] }); }); }
      const dem = Object.assign({}, FLOW.dem);
      ch.lines.forEach(l => { dem[l.key] = Object.assign({}, dem[l.key] || {}, { fabricReady: patch[`pt_flowDemand/${l.key}/fabricReady`] }); });
      FLOW.dem = dem;
      renderFlow();
      const err = flowChallanPrint(no);
      if (err) { $('flMsg').className = 'err'; $('flMsg').textContent = `Challan ${no} saved. ${err}`; }
      return '';
    },
  });
}

function flowChallanHtml(ch) {
  let s = {}; try { s = (GPO && GPO.settings) || {}; } catch (e) { s = {}; }
  const e = v => esc(v == null ? '' : String(v));
  const cell = 'border:1px solid #999;padding:6px 8px;font-size:11px';
  const tm = flowR2((ch.lines || []).reduce((a, l) => a + (+l.metres || 0), 0)), tp = (ch.lines || []).reduce((a, l) => a + (+l.pcs || 0), 0);
  const dmy = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(ch.no) + '</title></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top">`
    + `<div style="font-size:18px;font-weight:bold">${e(s.company || 'The Fabric Rush')}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(s.address)}</div>`
    + (s.gstin ? `<div style="font-size:11px">GSTIN: ${e(s.gstin)}</div>` : '')
    + `</td><td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">DELIVERY CHALLAN</div>`
    + `<div style="font-size:11px">RFD fabric for job work — not for sale</div>`
    + `<div style="font-size:12px;margin-top:4px">Challan No: <b>${e(ch.no)}</b></div><div style="font-size:12px">Date: ${e(dmy(ch.date))}</div>`
    + `<div style="font-size:12px">Order: <b>${e(ch.orderNo)}</b></div></td></tr></table>`
    + `<div style="margin:16px 0 8px;font-size:12px"><b>To</b><br>${e(ch.vendor && ch.vendor.name)}${ch.vendor && ch.vendor.code ? ` <span style="color:#666">(${e(ch.vendor.code)})</span>` : ''}</div>`
    /* TO PRINT: what the printer prints, one line per printed fabric SKU (several order lines can share one) or SKU. */
    + `<div style="font-size:12px;font-weight:bold;margin:4px 0 6px">To print</div><table style="width:100%;border-collapse:collapse;margin-bottom:14px"><tr style="background:#f0f0f0">`
    + ['Print', 'What it is', 'Given as', 'Quantity'].map(h => `<th style="${cell};text-align:left">${h}</th>`).join('') + '</tr>'
    + flowChPrintGroups(ch).map(g => `<tr><td style="${cell}"><b>${e(g.code || 'no fabric SKU in the catalogue')}</b></td><td style="${cell}">${e(g.label)}</td><td style="${cell}">${e(g.mode)}</td>`
      + `<td style="${cell};text-align:right"><b>${e(g.kind === 'sku' ? nf(g.pcs) + ' pcs' : nf(flowR2(g.metres)) + ' m')}</b></td></tr>`).join('') + '</table>'
    + `<div style="font-size:12px;font-weight:bold;margin:4px 0 6px">For these order lines</div>`
    + `<table style="width:100%;border-collapse:collapse"><tr style="background:#f0f0f0">`
    + ['#', 'SKU', 'Item', 'Print', 'Fabric (RFD)', 'Pieces to make', 'Metres'].map(h => `<th style="${cell};text-align:left">${h}</th>`).join('') + '</tr>'
    + (ch.lines || []).map((l, i) => `<tr><td style="${cell};text-align:center">${i + 1}</td><td style="${cell}">${e(l.sku)}</td><td style="${cell}">${e(l.item)}</td>`
      + `<td style="${cell}">${e((l.print && l.print.code) || '—')}${(l.extras || []).map(x => `<br>+ ruffle ${e(x.code || '?')} · ${e(nf(x.metres))} m`).join('')}</td>`
      + `<td style="${cell}">${e(l.fabric)}</td><td style="${cell};text-align:right">${e(nf(l.pcs))}</td><td style="${cell};text-align:right">${e(nf(l.metres))}</td></tr>`).join('')
    + `<tr><td style="${cell}" colspan="5"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(tp))}</b></td><td style="${cell};text-align:right"><b>${e(nf(tm))}</b></td></tr></table>`
    + (ch.note ? `<div style="margin-top:10px;font-size:11px"><b>Note:</b> ${e(ch.note)}</div>` : '')
    + `<table style="width:100%;margin-top:50px;font-size:11px"><tr><td>Issued by<br><br><br>${e(String(ch.by || '').split('@')[0])}</td>`
    + `<td style="text-align:right">Received by (${e(ch.vendor && ch.vendor.name)})<br><br><br>Signature &amp; date</td></tr></table>`
    + '</body></html>';
}
/** The challan's lines grouped by what is printed: a fabric SKU's metres add up; a SKU printed on is counted in pieces. */
function flowChPrintGroups(ch) {
  const g = new Map();
  (ch.lines || []).forEach(l => { const w = l.print || { kind: 'fabric', code: '', label: l.fabric, mode: 'Running fabric' };
    if (w.sides && w.sides.length) {   /* a Front and a Back: each its own printed SKU, half the metres */
      w.sides.forEach(sd => { const sk = 'fabric|' + sd.code;
        const se = g.get(sk) || { kind: 'fabric', code: sd.code, label: w.label.replace(/ · [^·]*\+[^·]*$/, '') + ' · ' + sd.side, mode: w.mode, metres: 0, pcs: 0 };
        se.metres += (+l.metres || 0) / w.sides.length; se.pcs += +l.pcs || 0; g.set(sk, se); });
      (l.extras || []).forEach(x => { const xk = 'fabric|' + (x.code || '?' + x.label);
        const xe = g.get(xk) || { kind: 'fabric', code: x.code, label: x.label, mode: x.mode, metres: 0, pcs: 0 }; xe.metres += +x.metres || 0; g.set(xk, xe); });
      return; }
    const k = w.kind + '|' + (w.code || '?' + w.label);
    const e = g.get(k) || { kind: w.kind, code: w.code, label: w.label, mode: w.mode, metres: 0, pcs: 0 };
    e.metres += +l.metres || 0; e.pcs += +l.pcs || 0; g.set(k, e);
    /* The ruffle cloth: its own printed fabric SKU, its own metres. */
    (l.extras || []).forEach(x => { const xk = 'fabric|' + (x.code || '?' + x.label);
      const xe = g.get(xk) || { kind: 'fabric', code: x.code, label: x.label, mode: x.mode, metres: 0, pcs: 0 };
      xe.metres += +x.metres || 0; g.set(xk, xe); }); });
  return [...g.values()];
}
function flowChallanPrint(no) {
  const ch = (FLOW.ch || {})[no]; if (!ch) return 'That challan is not here — press Refresh.';
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press Print again.';
  w.document.open();
  w.document.write(flowChallanHtml(ch).replace('</body>',
    '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div>'
    + '<style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
  return '';
}
