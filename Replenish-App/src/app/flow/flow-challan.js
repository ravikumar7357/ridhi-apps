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
  /* TWO ADDED BY HAND FOR THE SAME CLOTH (17 Oct: Apatite Blue cambric 007 is AB and APB, Agate Green 005 is AG and AGTG —
   * the printer order said "AB APB"): the one added (or changed) last is the decision that stands. The printers were sent
   * APB and AGTG; AG had been used for Asparagus Green. */
  const at = c => String(c.at || '');
  const byDir = new Map();
  hits.forEach(c => { const k = lo(c.dir) + '|' + lo(c.side); const e = byDir.get(k);
    if (!e || (c.manual && !e.some(x => x.manual)) || (c.manual && e[0].manual && at(c) > at(e[0]))) byDir.set(k, [c]);
    else if (!!c.manual === !!e[0].manual && (!c.manual || at(c) === at(e[0]))) e.push(c); });
  return [].concat(...byDir.values());
}
const flowFabSku = (fab, colour, dir, cc) => [...new Set(flowFabHits(fab, colour, dir, cc).map(c => c.sku))].join(' ');
/* WHAT STILL HAS TO BE PRINTED (Ravi, 10 Oct: the ruffle showed short with 1,500 m of printed LSB in the store). PPC
 * takes printed stock first; only the rest goes to RFD and the printer. A line printed on the SKU counts pieces. */
/** What the fabric team still owes a line: in its unit (m, or pcs for a SKU printed on itself) and in metres. */
function flowFabOwed(r, s) {
  const p = s.plan || {}, tp = flowToPrint(r, p), pcsWise = s.fabUnit === 'pcs';
  /* Never more than the part of the line not yet cut / issued / passed (flowRemFrac, 17 Oct): pieces cut from cloth that
   * came some other way leave nothing to print for. */
  const need = pcsWise ? tp.pcs : tp.metres, rem = typeof flowRemFrac === 'function' ? flowRemFrac(r, s) : 1;
  const left = Math.max(0, Math.min(need - (s.fabSent || 0), need * rem));
  return { unit: pcsWise ? 'pcs' : 'm', need, sent: s.fabSent || 0, left: flowR2(left), metres: pcsWise ? (need ? flowR2(tp.metres * left / need) : 0) : flowR2(left) };
}
function flowToPrint(r, p) {
  const qty = +r.qty || 0, m = flowR2(+(p && p.fabric && p.fabric.metres) || 0), fp = +(p && p.fabric && p.fabric.fromPrinted) || 0;
  if (p && p.fabric && p.fabric.printedUnit === 'pcs') { const pcs = Math.max(0, qty - fp); return { pcs, metres: qty ? flowR2(m * pcs / qty) : 0 }; }
  return { pcs: qty, metres: flowR2(Math.max(0, m - fp)) };
}
/* CUT FROM THE CLOTH PRINTED FOR IT (Ravi, 11 Oct: "jab cutting ho to particular wahi fabric use ho jo iske liye print hokar
 * aaya tha"). The printed fabric SKU(s) a line is cut from — '' when nothing is printed as cloth for it (stitching only,
 * or the SKU itself is printed). A quilt names its Front and Back. */
function flowCutFabricOf(r, p) {
  if (!p || flowRouteOf(p) !== 'inhouse') return { code: '', label: '' };
  let w = null; try { w = flowPrintWhat(r, p); } catch (e) { w = null; }
  if (!w || w.kind === 'sku') return { code: '', label: '' };
  return { code: w.sides && w.sides.length ? w.sides.map(sd => sd.code).join(' + ') : (w.code || ''), label: w.label || '', w };
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
function flowChallanNo(date, test, taken) {
  /* A test order's challans count on their own (TRFD-…), so testing never uses up a real number. */
  const pre = (test ? 'TRFD-' : 'RFD-') + String(date || dToday()).slice(0, 7).replace('-', '') + '-';
  const used = Object.keys(FLOW.ch || {}).concat(taken || []).filter(k => k.startsWith(pre)).map(k => +k.slice(-3) || 0);
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
/** A line's ruffle going to its own printer, not sent yet: { printer, extras, metres, fabric } or null. */
function flowRuffleOwed(x) {
  const p = x.s.plan, rp = flowRufflePrinter(p); if (!rp || x.s.route !== 'inhouse') return null;
  if (flowChIndex()[x.s.key + FLOW_RUF]) return null;   // sent already
  const xs = flowPrintExtras(x.r, p); if (!xs.length) return null;
  const ruf = (p.extra || []).find(e => /^Ruffle — /.test(String(e.what || '')));
  return { printer: rp, extras: xs, metres: flowR2(xs.reduce((a, e) => a + (+e.metres || 0), 0)), fabric: ruf ? String(ruf.what).replace(/^Ruffle — /, '') : '' };
}
function flowChallanOpen(orderNo, pcode) {
  const rows = flowRows().filter(x => x.r.orderNo === orderNo && flowInView('drfd', x.s) && x.s.route !== 'stitch'
    && (pcode == null || (pcode === '?' ? !flowPlanPrinter(x.s) : flowPlanPrinter(x.s) === pcode)));
  /* …and the lines whose ruffle cloth goes to this printer as their ruffle printer. */
  const ruf = pcode && pcode !== '?' ? flowRows().filter(x => x.r.orderNo === orderNo && flowInView('drfd', x.s) && (flowRuffleOwed(x) || {}).printer
    && String(flowRuffleOwed(x).printer.code) === String(pcode)) : [];
  return flowChallanDialog(rows, pcode, ruf);
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
/** Under a challan line: "of 446 · 400 already made / with karigars" when part of the order needs no fabric (19 Oct). */
function flowDoneTxt(x) {
  const q = +x.r.qty || 0, d = Math.round(q * (1 - flowRemFrac(x.r, x.s)));
  return d > 0 ? `<div class="muted" style="font-size:10px;white-space:nowrap">of ${nf(q)} · ${nf(d)} already made / with karigars</div>` : '';
}
/** "8 lines · 82 pcs · 227.58 m" — what is ticked on the challan form now (n = how many lines it has). */
function flowChTotals(n) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  let lines = 0, pcs = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const chk = document.querySelector(`[data-chk="${i}"]`);
    if (chk && !chk.checked) continue;
    if (!chk) continue;
    lines++; pcs += +((document.querySelector(`[data-chp="${i}"]`) || {}).value || 0); m += +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0);
  }
  return `Ticked: ${nf(lines)} line(s)${pcs ? ` · ${nf(pcs)} pcs` : ''} · ${nf(flowR2(m))} m`;
}
let FLOW_CH_N = 0;
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') ['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const t = e.target; if (!t || !t.closest || !t.closest('[data-chk],[data-chp],[data-chm]')) return;
  const box = document.getElementById && document.getElementById('flcTot'); if (box) box.textContent = flowChTotals(FLOW_CH_N);
}));
function flowChallanDialog(rows, pcode, rufRows, pre) {
  /* pre (18 Oct, the size challan): what to send on each line, worked out FIFO — those lines come ticked with those figures. */
  const preOf = x => (pre && x && x.s ? pre.get(x.s.key) : null);
  const cv = flowRfdCover();
  rufRows = rufRows || [];
  if (!rows.length && !rufRows.length) return;
  const nM = rows.length;
  const rufHtml = rufRows.map((x, j) => { const o = flowRuffleOwed(x), i = nM + j;
    return `<tr><td><input type="checkbox" data-chk="${i}" checked style="width:auto"></td>
      <td style="text-align:left"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b> <span class="fpc-mode" style="background:rgba(124,58,237,.14);color:#5b21b6;border-radius:6px;padding:0 6px;font-size:10.5px">ruffle only</span><div class="muted" style="font-size:10.5px">${esc(flowChItem(x.r))}</div>${flowExtrasTxt(o.extras)}</td>
      <td style="text-align:left">${esc(o.fabric || '—')}</td><td class="num">—</td>
      <td class="num"><input data-chm="${i}" type="number" step="0.01" value="${esc(o.metres || '')}" style="width:72px;padding:3px 6px;font-size:12px"></td>
      <td style="font-size:11px"><span class="muted">ruffle cloth</span></td></tr>`; }).join('');
  rows = rows.concat(rufRows); const isRuf = i => i >= nM; FLOW_CH_N = rows.length;
  const orders = [...new Set(rows.map(x => x.r.orderNo))], orderNo = orders.join(', '), isTest = rows.every(x => !!x.r.__t);
  const vens = flowChVendors();
  /* The printer PPC planned for these lines comes ready picked. */
  const planned = (pcode && pcode !== '?' ? pcode : rows.map(x => flowPlanPrinter(x.s)).find(Boolean)) || '';
  const lineHtml = rows.slice(0, nM).map((x, i) => { const p = x.s.plan || {}, c = cv.line[x.s.key] || {}, sepR = !!flowRufflePrinter(p);
    const pr = preOf(x), on = pre ? !!pr : (flowFabOwed(x.r, x.s).metres > 0 || (!sepR && !x.s.fabSent && flowPrintExtras(x.r, p).length));
    /* DESIGN A (Ravi, 20 Oct): the photo and the SKU share one cell, the figures sit side by side, nothing runs off the
     * right of the window; covered / short is a pill; the totals of what is ticked stand under the table (flowChTotals). */
    return `<tr><td><input type="checkbox" data-chk="${i}"${on ? ' checked' : ''} style="width:auto"></td>
      <td style="text-align:left;white-space:normal"><div style="display:flex;gap:10px;align-items:center;min-width:0">${typeof ptImgSpan === 'function' ? ptImgSpan(obUC(x.r.sku), 40) : ''}<div style="min-width:0"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b>${orders.length > 1 ? ` <span class="muted" style="font-size:10.5px">· ${esc(x.r.orderNo)}</span>` : ''}<div class="muted" style="font-size:10.5px">${esc(flowChItem(x.r))}</div>
        <div style="font-size:11px;color:#4338ca">Print: ${flowPrintTxt(flowPrintWhat(x.r, p))}</div>${sepR ? `<div class="muted" style="font-size:10.5px">ruffle → ${esc(flowRufflePrinter(p).name)} (its own challan)</div>` : flowExtrasTxt(flowPrintExtras(x.r, p))}</div></div></td>
      <td style="text-align:left;white-space:normal">${esc((p.fabric && p.fabric.name) || '—')}</td>
      <td class="num">${x.s.fabUnit === 'pcs'
        /* PART OF IT FOR NOW (Ravi, 15 Oct: "order ke 100 pcs h but me bhej 50 hi raha hu to wo partially challan bana saku"):
         * the pieces can be fewer than are owed; the rest stays in Demand → RFD, and the line says it went in part. */
        ? `<input data-chp="${i}" type="number" min="1" step="1" max="${flowFabOwed(x.r, x.s).left}" value="${pr ? pr.pcs : flowFabOwed(x.r, x.s).left}" title="Send fewer pieces for now — the rest stays in Demand" style="width:60px;padding:3px 6px;font-size:12px">${flowDoneTxt(x)}`
        : (pr ? `${nf(pr.pcs)} <span class="muted" style="font-size:10px">of ${nf(x.r.qty)}</span>` : nf(x.r.qty))}</td>
      <td class="num" style="white-space:normal"><input data-chm="${i}" type="number" step="0.01" value="${esc((pr ? pr.metres : flowFabOwed(x.r, x.s).metres) || '')}" style="width:72px;padding:3px 6px;font-size:12px">${x.s.fabSent > 0 ? `<div class="muted" style="font-size:10px">${nf(x.s.fabSent)} ${x.s.fabUnit} sent already</div>` : ''}${+(p.fabric && p.fabric.fromPrinted) ? `<div class="muted" style="font-size:10px">${nf(p.fabric.fromPrinted)} ${p.fabric.printedUnit === 'pcs' ? 'pcs' : 'm'} from printed stock</div>` : ''}</td>
      <td style="font-size:11px;white-space:normal">${c.short ? `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#fde8e8;color:#b42318;font-weight:700">short ${nf(c.short)} m</span>` : '<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#e7f5ec;color:#166534;font-weight:700">covered</span>'}</td></tr>`; }).join('') + rufHtml;
  ptOpenDialog({
    title: `RFD challan — ${orderNo}${pcode && pcode !== '?' ? ' → ' + ((vens.find(v => String(v.code) === String(pcode)) || {}).desc || ((rows[0].s.plan.printer || {}).name) || pcode) : ''}`,
    subtitle: (orders.length > 1 ? `${orders.length} orders, one printed fabric, one vendor. ` : 'The fabric of this order, to one vendor. ') + 'Saving numbers the challan, opens it to print, and marks these lines\' fabric as given — they leave Demand by themselves.',
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Vendor<select id="flcVen"><option value="">— pick the vendor —</option>${vens.map(v => `<option value="${esc(v.code)}"${String(v.code) === String(planned) ? ' selected' : ''}>${esc((v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('')}</select></label>
        <label>Date<input id="flcDate" type="date" value="${esc(dToday())}"></label></div>
      <table class="xl" style="margin-top:10px;width:100%;table-layout:fixed"><colgroup><col style="width:34px"><col><col style="width:100px"><col style="width:84px"><col style="width:92px"><col style="width:104px"></colgroup>
        <thead><tr><th></th><th style="text-align:left">Item</th><th style="text-align:left">Fabric</th><th>Pcs</th><th>Metres</th><th>RFD</th></tr></thead><tbody>${lineHtml}</tbody></table>
      <div id="flcTot" style="margin-top:8px;font-size:13px;font-weight:600"></div>
      <label style="display:block;margin-top:8px">Note (vehicle, who carried it…)<input id="flcNote"></label>`,
    saveLabel: 'Make the challan',
    onSave: async () => {
      const code = $('flcVen').value, v = vens.find(x => String(x.code) === String(code));
      if (!v) return 'Which vendor is the fabric going to? Pick one.';
      const date = $('flcDate').value || dToday();
      const picked = rows.map((x, i) => ({ x, ruf: isRuf(i), on: (document.querySelector(`[data-chk="${i}"]`) || {}).checked, m: +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0),
        pc: !isRuf(i) && x.s.fabUnit === 'pcs' ? +((document.querySelector(`[data-chp="${i}"]`) || {}).value || flowFabOwed(x.r, x.s).left) : null }))
        .filter(y => y.on);
      if (!picked.length) return 'Tick at least one line.';
      const badP = picked.filter(y => y.pc != null && !(y.pc >= 1 && y.pc === Math.round(y.pc) && y.pc <= flowFabOwed(y.x.r, y.x.s).left));
      if (badP.length) return badP.map(y => `${obUC(y.x.r.sku)}: pieces are whole, at least 1 and at most the ${nf(flowFabOwed(y.x.r, y.x.s).left)} still owed`).join(' · ');
      const other = picked.filter(y => !y.ruf && flowPlanPrinter(y.x.s) && flowPlanPrinter(y.x.s) !== String(v.code));
      if (other.length) return `${other.map(y => `${obUC(y.x.r.sku)} is planned for ${y.x.s.plan.printer.name}`).join(' · ')} — give it to that printer, or change the printer with "edit plan" first.`;
      const otherR = picked.filter(y => y.ruf && String(flowRufflePrinter(y.x.s.plan).code) !== String(v.code));
      if (otherR.length) return `${otherR.map(y => `${obUC(y.x.r.sku)}'s ruffle is planned for ${flowRufflePrinter(y.x.s.plan).name}`).join(' · ')} — give it to that printer, or change it with "edit plan" first.`;
      /* A line whose body is all from printed stock may go for its ruffle cloth alone. */
      const noM = picked.filter(y => !(y.m > 0) && (y.ruf || flowRufflePrinter(y.x.s.plan) || !(!y.x.s.fabSent && flowPrintExtras(y.x.r, y.x.s.plan).length))).map(y => obUC(y.x.r.sku) + (y.ruf ? ' (ruffle)' : ''));
      if (noM.length) return `How many metres? Type them for ${noM.join(', ')}.`;
      let no = flowChallanNo(date, isTest); const now = new Date().toISOString(), vname = v.desc || v.name || v.code;
      const ch = { no, date, orderNo, orders, vendor: { code: v.code, name: vname }, note: $('flcNote').value.trim(), at: now, by: ME.email || '',
        lines: picked.map(({ x, m, ruf, pc }) => ruf
          /* the ruffle cloth alone, to its own printer: its key is the line's, marked ruffleOnly (indexed as <key>~ruffle) */
          ? { key: x.s.key, ruffleOnly: true, sku: obUC(x.r.sku), item: flowChItem(x.r), print: null, extras: flowPrintExtras(x.r, x.s.plan), fabric: (flowRuffleOwed(x) || {}).fabric || '', pcs: 0, metres: flowR2(m) }
          : { key: x.s.key, sku: obUC(x.r.sku), item: flowChItem(x.r), print: flowPrintWhat(x.r, x.s.plan), extras: flowPrintExtras(x.r, x.s.plan), fabric: (x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || '', pcs: x.s.fabUnit === 'pcs' ? (pc != null ? pc : flowFabOwed(x.r, x.s).left) : (preOf(x) ? preOf(x).pcs : flowToPrint(x.r, x.s.plan).pcs), metres: flowR2(m),
          /* the ruffle cloth goes once, on the first challan for the line — never when it has a printer of its own */ ...(x.s.fabSent > 0 || flowRufflePrinter(x.s.plan) ? { extras: [] } : {}) }) };
      /* THE NUMBER IS CLAIMED: the challan is written only where no challan of that number is yet — two people making one at
       * the same moment get two numbers, never one challan written over the other. */
      for (let k = 0, taken = []; ; k++) {
        let er = ''; try { er = await flowClaim('pt_flowChallans/' + no, ch); } catch (e) { return 'Could not save: ' + (e.message || e); }
        if (!er) break;
        if (k >= 15) return 'Could not get a free challan number — press Refresh and try again.';
        taken.push(no); no = flowChallanNo(date, isTest, taken); ch.no = no;
      }
      const patch = typeof ptCas === 'function' ? {} : { ['pt_flowChallans/' + no]: ch };
      /* A line PPC left without a printer: the one it went to is now its printer. */
      const setP = picked.filter(y => !y.ruf && !flowPlanPrinter(y.x.s)).map(y => y.x.s.key);
      setP.forEach(k => { patch[`pt_ppc/${k}/printer`] = { code: v.code, name: vname, why: 'set by challan ' + no }; });
      ch.lines.filter(l => !l.ruffleOnly).forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = { at: now, by: ME.email || '', what: l.fabric, metres: l.metres, note: `Challan ${no} to ${vname}`, challan: no, vendor: vname }; });
      try { if (Object.keys(patch).length) await ptPatch(patch); } catch (e) { return `Challan ${no} is saved, but the lines could not be marked (${e.message || e}) — press Refresh.`; }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: ch });
      if (setP.length) { FLOW.ppc = Object.assign({}, FLOW.ppc); setP.forEach(k => { FLOW.ppc[k] = Object.assign({}, FLOW.ppc[k], { printer: patch[`pt_ppc/${k}/printer`] }); }); }
      const dem = Object.assign({}, FLOW.dem);
      ch.lines.filter(l => !l.ruffleOnly).forEach(l => { dem[l.key] = Object.assign({}, dem[l.key] || {}, { fabricReady: patch[`pt_flowDemand/${l.key}/fabricReady`] }); });
      FLOW.dem = dem;
      renderFlow();
      const err = flowChallanPrint(no);
      if (err) { $('flMsg').className = 'err'; $('flMsg').textContent = `Challan ${no} saved. ${err}`; }
      return '';
    },
  });
  /* Fewer pieces → the cloth for those pieces, worked out the way the line's is (the metres box can still be typed over). */
  rows.slice(0, nM).forEach((x, i) => {
    const pi = document.querySelector(`[data-chp="${i}"]`), mi = document.querySelector(`[data-chm="${i}"]`);
    if (!pi || !mi || !pi.addEventListener) return;
    const o = flowFabOwed(x.r, x.s);
    pi.addEventListener('input', () => { const n = Math.max(0, Math.min(+pi.value || 0, o.left)); if (o.left > 0) mi.value = flowR2(o.metres * n / o.left); });
  });
  /* design A: the totals of what is ticked, and each line's photo */
  const tot = document.getElementById && document.getElementById('flcTot'); if (tot) tot.textContent = flowChTotals(rows.length);
  if (typeof ptImgFill === 'function') ptImgFill(rows.map(x => obUC(x.r.sku)), false, typeof ptImgPatch === 'function' ? ptImgPatch : null);
}

function flowChallanHtml(ch) {
  let s = {}; try { s = (GPO && GPO.settings) || {}; } catch (e) { s = {}; }
  const e = v => esc(v == null ? '' : String(v));
  const cell = 'border:1px solid #999;padding:6px 8px;font-size:11px';
  const dmy = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(ch.no) + '</title></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top">`
    + `<div style="font-size:18px;font-weight:bold">${e(s.company || FLOW_COMPANY)}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(s.address)}</div>`
    + (s.gstin ? `<div style="font-size:11px">GSTIN: ${e(s.gstin)}</div>` : '')
    + `</td><td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">DELIVERY CHALLAN</div>`
    + `<div style="font-size:11px">RFD fabric for job work — not for sale</div>`
    + `<div style="font-size:12px;margin-top:4px">Challan No: <b>${e(ch.no)}</b></div><div style="font-size:12px">Date: ${e(dmy(ch.date))}</div>`
    + `<div style="font-size:12px">Order: <b>${e(ch.orderNo)}</b></div></td></tr></table>`
    /* PRINTER AND DATE, SAID PLAINLY (Ravi, 19 Oct: "challan me printer ka naam aur date bhi print ho"): one box across the top. */
    + `<table style="width:100%;border-collapse:collapse;margin:16px 0 10px"><tr>`
    + `<td style="border:2px solid #111;padding:8px 12px;width:70%"><div style="font-size:11px;color:#555">Printer (To)</div><div style="font-size:17px;font-weight:bold">${e(ch.vendor && ch.vendor.name)}${ch.vendor && ch.vendor.code ? ` <span style="font-size:12px;font-weight:normal;color:#666">(${e(ch.vendor.code)})</span>` : ''}</div></td>`
    + `<td style="border:2px solid #111;border-left:0;padding:8px 12px"><div style="font-size:11px;color:#555">Date</div><div style="font-size:17px;font-weight:bold">${e(dmy(ch.date))}</div></td></tr></table>`
    + flowChSizeHtml(ch.lines || [], cell)
    + flowPrintSheetHtml(ch.lines || [], cell, true)
    + (ch.note ? `<div style="margin-top:10px;font-size:11px"><b>Note:</b> ${e(ch.note)}</div>` : '')
    + `<table style="width:100%;margin-top:50px;font-size:11px"><tr><td>Issued by<br><br><br>${e(String(ch.by || '').split('@')[0])}</td>`
    + `<td style="text-align:right">Received by (${e(ch.vendor && ch.vendor.name)})<br><br><br>Signature &amp; date</td></tr></table>`
    + '</body></html>';
}
/* THE RFD BY SIZE ON THE CHALLAN (19 Oct): what cloth goes, as Fabric · Size · Pieces · Metres — every colour of a size in one
 * row, as the challan by size was made. Said only when the lines carry sizes. */
function flowChSizeHtml(lines, cell) {
  const e = v => esc(v == null ? '' : String(v)), by = new Map();
  (lines || []).filter(l => l && !l.ruffleOnly).forEach(l => {
    let m = {}; try { m = cutSkuOf(l.sku) || {}; } catch (er) { m = {}; }
    /* ONLY THE CUT PIECES (Ravi, 19 Oct: "napkin ka alag se print par kyo gya jabki running me hum de rahe h"). A line
     * given as running fabric is in "Running fabric — to print" in metres; listing it here too, in pieces by size, read as
     * a second lot going to print. */
    if (l.print ? l.print.kind !== 'sku' : m.cuttingRequired !== false) return;
    const b = String(l.item || '').split(' · '), size = String(m.size || (b.length > 2 ? b[b.length - 1] : '') || '').trim();
    if (!size) return;
    const k = String(l.fabric || '').toUpperCase() + '|' + (typeof flowSizeKey === 'function' ? flowSizeKey(size) : size.toLowerCase());
    const g = by.get(k) || { fabric: l.fabric || '—', size, pcs: 0, metres: 0 }; g.pcs += +l.pcs || 0; g.metres += +l.metres || 0; by.set(k, g);
  });
  if (!by.size) return '';
  const gs = [...by.values()].sort((a, b) => String(a.fabric).localeCompare(String(b.fabric)) || (typeof flowSizeSort === 'function' ? flowSizeSort(a.size, b.size) : 0));
  const th = h => `<th style="${cell};text-align:${/Pieces|Metres/.test(h) ? 'right' : 'left'};background:#f0f0f0">${h}</th>`;
  return `<div style="font-size:12px;font-weight:bold;margin:6px 0 4px">RFD by size — cut pieces</div><table style="width:100%;border-collapse:collapse;margin-bottom:12px"><tr>${['Fabric (RFD)', 'Size', 'Pieces', 'Metres'].map(th).join('')}</tr>`
    + gs.map(g => `<tr><td style="${cell}">${e(g.fabric)}</td><td style="${cell}"><b>${e(g.size)}</b></td><td style="${cell};text-align:right">${nf(g.pcs)}</td><td style="${cell};text-align:right">${nf(flowR2(g.metres))}</td></tr>`).join('')
    + `<tr><td style="${cell}" colspan="2"><b>Total</b></td><td style="${cell};text-align:right"><b>${nf(gs.reduce((t, g) => t + g.pcs, 0))}</b></td><td style="${cell};text-align:right"><b>${nf(flowR2(gs.reduce((t, g) => t + g.metres, 0)))}</b></td></tr></table>`;
}
/* WHAT THE PRINTER IS TOLD (Ravi, 11 Oct: "vendor ko jab cut piece ke alawa running me order de to sirf usko challan me
 * dikhana chahiye: print SKU, fabric, colour name, and ek saath combine jitna metre print karna h — abhi 52 aur 184 alag
 * alag dikh rahe h jabki wo ek hi fabric me se banenge"). Running fabric: one row per printed fabric SKU — fabric, colour,
 * direction, the metres of every order line together; the order lines are not listed. Cut pieces (printed on the SKU):
 * one row per SKU, in pieces, with the cloth that goes for them. Used by the RFD challan and the print order alike. */
function flowPrintSheetHtml(lines, cell, withCloth) {
  const e = v => esc(v == null ? '' : String(v)), gs = flowChPrintGroups({ lines });
  const run = gs.filter(g => g.kind !== 'sku' && g.metres > 0), pcs = gs.filter(g => g.kind === 'sku' && g.pcs > 0);
  const bits = l => String(l || '').split(' · ');   // colour · fabric · direction (· Front / Back)
  const th = hs => '<tr style="background:#f0f0f0">' + hs.map(h => `<th style="${cell};text-align:${/Metres|Pieces|Cloth/.test(h) ? 'right' : 'left'}">${h}</th>`).join('') + '</tr>';
  const tR = flowR2(run.reduce((a, g) => a + g.metres, 0)), tP = pcs.reduce((a, g) => a + g.pcs, 0);
  /* the cloth that goes for the pieces: the lines printed on each SKU */
  const clothOf = code => flowR2(lines.filter(l => l.print && l.print.kind === 'sku' && obUC(l.print.code) === obUC(code)).reduce((a, l) => a + (+l.metres || 0), 0));
  const fabOf = code => [...new Set(lines.filter(l => l.print && l.print.kind === 'sku' && obUC(l.print.code) === obUC(code)).map(l => l.fabric).filter(Boolean))].join(', ');
  /* What the piece is, its colour and its size (Ravi, 11 Oct: "cut pcs me bhi colour name and size show ho — kya size banega
   * aur kis colour me"): the master row first, then the order line's own words (item = subtype · colour · size). */
  const partsOf = code => { let m = {}; try { m = cutSkuOf(code) || {}; } catch (e) { m = {}; }
    const l = lines.find(x => x.print && x.print.kind === 'sku' && obUC(x.print.code) === obUC(code)), b = String((l && l.item) || '').split(' · ');
    return { what: m.subtype || m.articleSubtype || m.articleType || (b.length > 2 ? b[0] : ''), colour: m.color || (b.length > 2 ? b[1] : ''), size: m.size || (b.length > 2 ? b[2] : '') }; };
  return (run.length ? `<div style="font-size:12px;font-weight:bold;margin:4px 0 6px">Running fabric — to print</div><table style="width:100%;border-collapse:collapse;margin-bottom:14px">`
      + th(['Print SKU', 'Fabric', 'Colour', 'Direction', 'Metres'])
      + run.map(g => { const b = bits(g.label); return `<tr><td style="${cell}"><b>${e(g.code || 'no fabric SKU in the catalogue')}</b></td><td style="${cell}">${e(b[1] || '')}</td><td style="${cell}">${e(b[0] || '')}</td>`
        + `<td style="${cell}">${e(b.slice(2).join(' · '))}</td><td style="${cell};text-align:right"><b>${e(nf(flowR2(g.metres)))} m</b></td></tr>`; }).join('')
      + (run.length > 1 ? `<tr><td style="${cell}" colspan="4"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(tR))} m</b></td></tr>` : '') + '</table>' : '')
    + (pcs.length ? `<div style="font-size:12px;font-weight:bold;margin:4px 0 6px">Cut pieces — print on the SKU</div><table style="width:100%;border-collapse:collapse;margin-bottom:14px">`
      + th(['SKU', 'Item', 'Colour', 'Size', 'Pieces'].concat(withCloth ? ['Fabric (RFD)', 'Cloth'] : []))
      + pcs.map(g => { const pt = partsOf(g.code); return `<tr><td style="${cell}"><b>${e(g.code)}</b></td><td style="${cell}">${e(pt.what)}</td><td style="${cell}"><b>${e(pt.colour)}</b></td><td style="${cell}"><b>${e(pt.size)}</b></td><td style="${cell};text-align:right"><b>${e(nf(g.pcs))} pcs</b></td>`
        + (withCloth ? `<td style="${cell}">${e(fabOf(g.code))}</td><td style="${cell};text-align:right">${e(nf(clothOf(g.code)))} m</td>` : '') + '</tr>'; }).join('')
      + (pcs.length > 1 ? `<tr><td style="${cell}" colspan="4"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(tP))} pcs</b></td>${withCloth ? `<td style="${cell}"></td><td style="${cell};text-align:right"><b>${e(nf(flowR2(pcs.reduce((a, g) => a + clothOf(g.code), 0))))} m</b></td>` : ''}</tr>` : '') + '</table>' : '')
    + (!run.length && !pcs.length ? '<div style="font-size:12px;color:#666">Nothing to print on this one.</div>' : '');
}
/** The challan's lines grouped by what is printed: a fabric SKU's metres add up; a SKU printed on is counted in pieces. */
function flowChPrintGroups(ch) {
  const g = new Map();
  (ch.lines || []).forEach(l => { const w = l.print || { kind: 'fabric', code: '', label: l.fabric, mode: 'Running fabric' };
    if (l.ruffle || l.ruffleOnly) {   /* the ruffle cloth alone (its own printer): only its printed fabric */
      (l.extras || []).forEach(x => { const xk = 'fabric|' + (x.code || '?' + x.label);
        const xe = g.get(xk) || { kind: 'fabric', code: x.code, label: x.label, mode: x.mode, metres: 0, pcs: 0 }; xe.metres += +x.metres || 0; g.set(xk, xe); });
      return; }
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
