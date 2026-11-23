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
/* PRINT DIRECTION IS ASKED ONLY FOR A PIPING OR RUFFLE TABLECLOTH (Ravi, 2 Nov: "piping tablecloth and ruffle tablecloth ke alawa print direction
 * nahi mangna chahiye"). Every other line takes its direction by itself — the master's default, else Vertical, else the one way the catalogue
 * has — so its printed fabric SKU is still found and nobody is asked. */
function flowDirAsked(r) {
  const m = (typeof cutSkuOf === 'function' && cutSkuOf(r.sku)) || {};
  const what = [m.subtype, m.articleType, r.articleSubtype, r.articleType, r.itemName].filter(Boolean).join(' ');
  return /tablecloth/i.test(what) && /piping|ruffle/i.test(what);
}
const flowDirAuto = dirs => (dirs || []).find(d => /^vert/i.test(d)) || (dirs || [])[0] || '';
function flowPrintWhat(r, plan) {
  const m = cutSkuOf(r.sku) || {};
  /* EMBROIDERY IS DONE ON THE RUNNING CLOTH (Ravi, 21 Oct): a line on Printing + Embroidery is printed as fabric, whatever the
   * master says about cutting — the pieces are cut out after the embroidery. */
  const emb = !!plan && flowRouteOf(plan) === 'emb';
  if (m.cuttingRequired === false && !emb)
    return { kind: 'sku', code: obUC(r.sku), mode: 'Cut pieces', label: 'printed on the SKU itself (no cutting)', unit: 'pcs' };
  const fab = String((plan && plan.fabric && plan.fabric.name) || m.fabric || '').trim();
  const colour = String(m.color || r.color || '').trim(), cc = ordColCodeOf(r.sku);
  const dirs = flowFabDirs(fab, colour, cc);
  let dir = (plan && plan.print && plan.print.dir) || flowDirDefault(m, fab);
  if (!dir && dirs.length === 1) dir = dirs[0];
  if (!dir && dirs.length > 1 && !flowDirAsked(r)) dir = flowDirAuto(dirs);
  let rule = ''; try { rule = ptPrintIssueAs(m) || ''; } catch (e) { rule = ''; }
  const mode = emb ? 'Running fabric — for embroidery' : rule === 'cut' ? 'Cut pieces (cut here from the printed fabric)' : 'Running fabric';
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
/* rem (4 Nov): the share of the line still to make — pieces already cut / issued / passed need no ruffle cloth again (Ravi: "224 pcs
 * pahle hi cut ho chuke … only pending fabric hi print par jana chahiye"). 1 when not given. */
function flowPrintExtras(r, plan, rem) {
  if (!plan || !flowPrinted(flowRouteOf(plan))) return [];
  const rf = rem == null ? 1 : Math.max(0, Math.min(1, +rem || 0));
  const m = cutSkuOf(r.sku) || {}, colour = String(m.color || r.color || '').trim(), cc = ordColCodeOf(r.sku);
  return (plan.extra || []).filter(x => x.unit === 'm' && /^Ruffle — /.test(String(x.what || '')) && +x.qty > 0).map(x => {
    const fab = String(x.what).replace(/^Ruffle — /, '').trim(), dirs = flowFabDirs(fab, colour, cc);
    const dir = dirs.length === 1 ? dirs[0] : ((plan.print && plan.print.dir) || '');
    const code = dir || !dirs.length ? flowFabSku(fab, colour, dir, cc) : '';
    const need = flowR2((+x.qty || 0) * rf), left = flowR2(Math.max(0, need - (+x.fromPrinted || 0)));
    return { kind: 'fabric', code, mode: 'Ruffle cloth', label: [colour, fab, dir].filter(Boolean).join(' · '), unit: 'm', metres: left, total: need, fromPrinted: flowR2(+x.fromPrinted || 0), what: 'ruffle' };
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
/** flowToPrint for only the part of the line still to make (rem, 4 Nov): what a NEW print order asks the printer for. */
function flowToPrintRem(r, p, rem) {
  const rf = rem == null ? 1 : Math.max(0, Math.min(1, +rem || 0));
  if (rf >= 1) return flowToPrint(r, p);
  const qty = +r.qty || 0, m = flowR2(+(p && p.fabric && p.fabric.metres) || 0), fp = +(p && p.fabric && p.fabric.fromPrinted) || 0;
  if (p && p.fabric && p.fabric.printedUnit === 'pcs') { const pcs = Math.max(0, Math.round(qty * rf) - fp); return { pcs, metres: qty ? flowR2(m * pcs / qty) : 0 }; }
  return { pcs: Math.round(qty * rf), metres: flowR2(Math.max(0, m * rf - fp)) };
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
  if (!p || !flowPrinted(flowRouteOf(p))) return { code: '', label: '' };
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
const flowIsPrinter = v => String((v && v.category) || '').trim().toLowerCase() === 'printer';
/** The vendor master's vendors, printers first (the Demand window lets any vendor take the cloth). */
const flowChVendors = () => {
  let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const pr = all.filter(flowIsPrinter);
  return pr.concat(all.filter(v => !pr.includes(v)));
};
/** The vendor master's printers only. */
const flowPrinters = () => { let all = []; try { all = voAllVendors(); } catch (e) { all = []; } return all.filter(flowIsPrinter); };

/** The challan for one PO: its lines still waiting for fabric. */
/* ONE CHALLAN, ONE PRINTER, THE PRINTER PPC PLANNED (Ravi, 10 Oct: "the challan and the PO's made-as do not match").
 * A PO's lines can be planned for different printers; each printer gets its own challan with only its own lines.
 * A stitching-only line goes to no printer, so never on a challan (Mark fabric ready). A line PPC left without a
 * printer takes the one picked here, and its plan says so from then on. */
const flowPlanPrinter = s => (s.plan && s.plan.printer && s.plan.printer.code) || '';
/** A line's ruffle going to its own printer, not sent yet: { printer, extras, metres, fabric } or null. */
function flowRuffleOwed(x) {
  const p = x.s.plan, rp = flowRufflePrinter(p); if (!rp || !flowPrinted(x.s.route)) return null;
  if (flowChIndex()[x.s.key + FLOW_RUF]) return null;   // sent already
  const xs = flowPrintExtras(x.r, p, flowPoRemOf(x.r, x.s)); if (!xs.length) return null;
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
/* CLOTH GIVEN EARLIER, WITHOUT A CHALLAN (Ravi, 22 Oct, AMZ-15102026-01 · CPC007-04: "400 pcs already made against this order but
 * mene abhi fabric nahi bheja mujhe fabric bhejkar old entry close karni h" — the 400 are real; their cloth went to the printer
 * before the flow had a challan for it). A RECORD-ONLY challan says so: that cloth, to that printer, on the day it went, already
 * printed and back (the pieces are made) — closed as it is made. It takes nothing off the RFD count unless asked (the cloth
 * left the store then), and the line's fabric is then counted in full: only what is truly still owed is offered. */
/** What of a line was made from cloth no challan records: { qty (in the line's unit), pcs, metres } — 0s when nothing. */
function flowEarlierOf(x) {
  const s = x.s, p = s.plan || {}; if (!p || !flowPrinted(s.route)) return { qty: 0, pcs: 0, metres: 0 };
  const q = +x.r.qty || 0, done = Math.round(q * (1 - flowRemFrac(x.r, s))), per = +(p.fabric && p.fabric.perPc) || 0;
  const pcsWise = s.fabUnit === 'pcs', need = s.fabNeed || 0, sent = s.fabSent || 0;
  const doneU = pcsWise ? done : flowR2(done * per), qty = flowR2(Math.max(0, Math.min(doneU, need - sent)));
  const pcs = pcsWise ? qty : (per ? Math.round(qty / per) : 0);
  return { qty, pcs, metres: flowR2(pcsWise ? pcs * per : qty) };
}
async function flowRecordEarlier(key, o) {
  const x = flowRows().find(y => y.s.key === key); if (!x) return 'That line is not here any more — press Refresh.';
  const e = flowEarlierOf(x), pcsWise = x.s.fabUnit === 'pcs', p = x.s.plan || {}, per = +(p.fabric && p.fabric.perPc) || 0;
  const pcs = Math.round(+o.pcs || 0);
  if (!(pcs >= 1) || pcs > (pcsWise ? e.qty : e.pcs)) return `Type the pieces made from that cloth — at most ${nf(pcsWise ? e.qty : e.pcs)}.`;
  const pr = (p.printer && p.printer.code) ? p.printer : null; if (!pr) return 'This line has no printer planned — pick it with "edit plan" first.';
  const metres = flowR2(+o.metres > 0 ? +o.metres : pcs * per), qty = pcsWise ? pcs : metres, now = new Date().toISOString(), date = o.date || dToday();
  let no = flowChallanNo(dToday(), !!x.r.__t);
  const ch = { no, date, orderNo: x.r.orderNo, orders: [x.r.orderNo], vendor: { code: pr.code, name: pr.name }, at: now, by: ME.email || '',
    recordOnly: true, deduct: !!o.deduct, note: `Given earlier without a challan — record only. ${nf(pcs)} pcs made already${o.note ? ' · ' + o.note : ''}`,
    lines: [{ key, sku: obUC(x.r.sku), item: flowChItem(x.r), print: flowPrintWhat(x.r, p), extras: [], fabric: (p.fabric && p.fabric.name) || '', pcs, metres }],
    receipts: { r0: { date, at: now, by: ME.email || '', items: { [key]: qty }, note: 'made already — the cloth was given earlier' } },
    closed: { at: now, by: ME.email || '', why: 'given earlier, already made — record only' } };
  for (let k = 0, taken = []; ; k++) {
    let er = ''; try { er = await flowClaim('pt_flowChallans/' + no, ch); } catch (err) { return 'Could not save: ' + (err.message || err); }
    if (!er) break;
    if (k >= 15) return 'Could not get a free challan number — press Refresh and try again.';
    taken.push(no); no = flowChallanNo(dToday(), !!x.r.__t, taken); ch.no = no;
  }
  if (typeof ptCas !== 'function') { try { await ptPatch({ ['pt_flowChallans/' + no]: ch }); } catch (err) { return 'Could not save: ' + (err.message || err); } }
  FLOW.ch = Object.assign({}, FLOW.ch, { [no]: ch });
  flowRecordEarlier.no = no;
  return '';
}
function flowRecordEarlierOpen(key) {
  const x = flowRows().find(y => y.s.key === key); if (!x) return;
  const e = flowEarlierOf(x), pcsWise = x.s.fabUnit === 'pcs', p = x.s.plan || {};
  ptOpenDialog({
    title: `Record cloth given earlier — ${x.r.orderNo} · ${obUC(x.r.sku)}`,
    subtitle: `${nf(e.pcs)} pcs of this line are made, but no challan says their cloth went to ${(p.printer && p.printer.name) || 'the printer'}. This records it — closed at once, the pieces being made — so only what is truly still owed stays in Demand.`,
    html: `<div class="ptgrid" style="grid-template-columns:1fr 1fr 1fr"><label>Pieces made from it<input id="flreP" type="number" min="1" step="1" value="${esc(e.pcs)}"></label>
      <label>Metres of cloth<input id="flreM" type="number" min="0" step="0.01" value="${esc(e.metres)}"></label>
      <label>Given on<input id="flreD" type="date" value="${esc(dToday())}"></label></div>
      <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="flreX" type="checkbox" style="width:auto"> Also take it off the RFD stock now (only if the store still counts that cloth)</label>
      <label style="display:block;margin-top:8px">Note<input id="flreN" placeholder="e.g. given on the old process"></label>`,
    saveLabel: 'Record it',
    onSave: async () => {
      const er = await flowRecordEarlier(key, { pcs: $('flreP').value, metres: $('flreM').value, date: $('flreD').value, deduct: !!$('flreX').checked, note: ($('flreN').value || '').trim() });
      if (er) return er;
      renderFlow(); $('flMsg').className = 'muted'; $('flMsg').textContent = `Recorded on ${flowRecordEarlier.no} (closed) — the line now owes only what is still to make.`; return '';
    },
  });
}
/** Under a challan line: "of 446 · 400 already made / with karigars" when part of the order needs no fabric (19 Oct). */
function flowDoneTxt(x) {
  const q = +x.r.qty || 0, d = Math.round(q * (1 - flowRemFrac(x.r, x.s)));
  return d > 0 ? `<div class="muted" style="font-size:10px;white-space:nowrap">of ${nf(q)} · ${nf(d)} already made / with karigars</div>` : '';
}
/* ---- THE CHALLAN WINDOW, WIDE AND ACTIONABLE (Ravi, 21 Nov: "make it look actionable plus easy to understand"; "make the card
 * bigger … so that everything can fit in") ----
 * Lines on the left, what goes on the right: first what cannot go (a fabric name that is not a real fabric — "nayiia 56",
 * "Sheetilg 6" were on live plans), then each fabric with its total, its sizes under it, and whether the RFD on the shelf
 * covers it. Those lines come unticked and cannot be ticked until the plan names a real fabric.
 * Errors: the fabric check falls back quietly to "known" whenever the Greige Desk or the fabric register is not read yet, so
 * a slow read never holds a challan back; the console says so. */
/** Whether a plan's fabric name is NOT a real fabric: not in the fabric register (PPC's own flowFabKnown), not in the Greige
 *  Desk's Master data, and no RFD stock. An empty name is the plan's own gap, said on its line, not here. */
function flowChFabricWrong(name) {
  if (!flowFabKey(name) || !flowFabCheckable()) return false;
  if (flowFabKnown(name) !== false || flowRfdStock(name) > 0.05) return false;
  try { return !GD.rfdKnown(name); } catch (e) { console.warn('Challan: the Greige Desk could not say whether "' + name + '" is a fabric', e); return false; }
}
/** The fabric check needs the Greige Desk and the fabric register read; until then every name counts as known. */
function flowFabCheckable() {
  try { return flowGdState() === 'ok' && Array.isArray(FAB.rows); } catch (e) { return false; }
}
/** The pieces line i sends: what is typed for a line sent by pieces, else the line's pieces; a ruffle line none. One count for
 *  the totals and the summary (21 Nov: the totals said 1,153 pcs while the size table added up to over 2,000). */
function flowChLinePcs(i) {
  const z = FLOW_CH_SZ[i] || {}; if (z.ruffle) return 0;
  const typed = document.querySelector(`[data-chp="${i}"]`);
  return typed ? (+typed.value || 0) : (+z.pcs || 0);
}
/** "Ticked: 20 line(s) · 993 pcs · 911.13 m · 4 held back" — what is ticked on the challan form now (n = how many lines it has). */
function flowChTotals(n) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  let lines = 0, pcs = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const chk = document.querySelector(`[data-chk="${i}"]`);
    if (!chk || !chk.checked) continue;
    lines++; pcs += flowChLinePcs(i); m += +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0);
  }
  const held = FLOW_CH_SZ.slice(0, n).filter(z => z && z.unknown).length;
  return `Ticked: ${nf(lines)} line(s)${pcs ? ` · ${nf(pcs)} pcs` : ''} · ${nf(flowR2(m))} m${held ? ` · ${nf(held)} held back` : ''}`;
}
let FLOW_CH_N = 0;
/* THE REVIEW, BY SIZE (Ravi, 22 Oct: "yaha jab ham challan ka review kare tab size combine hokar dikhe"): what is ticked on the
 * form, added up by fabric and size — pieces and metres — as it will go; it changes as a line is ticked or a figure typed.
 * FLOW_CH_SZ[i] = { fabric, size } for the form's line i (a ruffle line has no size). */
let FLOW_CH_SZ = [];
/** What the summary needs of a challan line: its fabric (and whether it is a real one), size and pieces, and enough to name it. */
function flowChLineFacts(x, cat) {
  const fabric = (x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || '';
  return { fabric, size: String(cat.size || x.r.size || '').trim(), pcs: x.s.fabUnit === 'pcs' ? 0 : (+x.r.qty || 0), unknown: flowChFabricWrong(fabric),
    sku: obUC(x.r.sku), item: flowChItem(x.r), orderNo: x.r.orderNo, pcsAll: +x.r.qty || 0 };
}
/** The RFD cover worked out when the window opened (flowRfdCover reads every line, too slow to redo on each keystroke). */
let FLOW_CH_COVER = { fab: {}, line: {} };
function flowChSizeLive(n) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  const ven = document.querySelector('#flcVen'), vname = ven && ven.value && ven.options ? String((ven.options[ven.selectedIndex] || {}).text || '').split(' · ')[0] : '';
  return `<div style="font-size:14px;font-weight:700;margin:0 0 8px">What goes ${vname ? 'to ' + esc(vname) + ' ' : ''}on this challan</div>`
    + flowChHeldHtml(FLOW_CH_SZ.slice(0, n)) + flowChFabricHtml(flowChByFabric(n));
}
/** What is ticked, by fabric and, under each, by size: [{ fabric, pcs, lines, m, sizes: [{ size, pcs, lines, m }] }]. */
function flowChByFabric(n) {
  const fabs = new Map();
  for (let i = 0; i < n; i++) {
    const chk = document.querySelector(`[data-chk="${i}"]`); if (!chk || !chk.checked) continue;
    const z = FLOW_CH_SZ[i] || {}, pcs = flowChLinePcs(i), m = +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0);
    const f = fabs.get(flowFabKey(z.fabric)) || { fabric: z.fabric || '—', pcs: 0, lines: 0, m: 0, sizes: new Map() };
    const sk = typeof flowSizeKey === 'function' ? flowSizeKey(z.size) : String(z.size || '').toLowerCase();
    const g = f.sizes.get(sk) || { size: z.size || (z.ruffle ? 'ruffle cloth' : '—'), pcs: 0, lines: 0, m: 0 };
    g.lines++; g.pcs += pcs; g.m = flowR2(g.m + m); f.sizes.set(sk, g);
    f.lines++; f.pcs += pcs; f.m = flowR2(f.m + m); fabs.set(flowFabKey(z.fabric), f);
  }
  const bySize = (a, b) => (typeof flowSizeSort === 'function' ? flowSizeSort(a.size, b.size) : String(a.size).localeCompare(String(b.size)));
  return [...fabs.values()].sort((a, b) => a.fabric.localeCompare(b.fabric)).map(f => Object.assign({}, f, { sizes: [...f.sizes.values()].sort(bySize) }));
}
/** Whether the RFD on the shelf covers what this challan sends of a fabric: { free, short } (free null when unknown). */
function flowChStock(fabric, metres) {
  const c = FLOW_CH_COVER.fab[flowFabKey(fabric)]; if (!c) return { free: null, short: 0 };
  const free = Math.max(0, Math.round(+c.free || 0));   // whole metres: a shelf is not counted to the centimetre
  return { free, short: flowR2(Math.max(0, metres - free)) };
}
/** The red box: lines whose fabric is not a real fabric, each with the way to fix it. */
function flowChHeldHtml(zs) {
  const held = zs.filter(z => z && z.unknown); if (!held.length) return '';
  return `<div style="background:#fdecec;border:1px solid #f3c2c2;border-radius:10px;padding:10px 12px;margin-bottom:12px;color:#b42318;font-size:12.5px">
    <div style="font-weight:700;margin-bottom:6px">${nf(held.length)} line${held.length === 1 ? '' : 's'} can't go yet — the fabric on ${held.length === 1 ? 'its' : 'their'} plan is not a real fabric</div>
    <table style="width:100%;border-collapse:collapse;color:#b42318;font-size:12px">`
    + held.map(z => `<tr><td style="padding:4px 8px 4px 0;font-weight:700;vertical-align:top;white-space:nowrap">“${esc(z.fabric)}”</td>
      <td style="padding:4px 8px;vertical-align:top"><span style="font-family:ui-monospace,monospace">${esc(z.sku)}</span> · ${esc(z.item)} · ${nf(z.pcsAll)} pcs</td>
      <td style="text-align:right;vertical-align:top"><button type="button" class="ghost" data-chfix="${esc(z.orderNo)}|${esc(z.sku)}" style="width:auto;white-space:nowrap;font-size:11.5px;padding:3px 10px;color:#b42318;border-color:#e3a5a5">Fix fabric in PPC →</button></td></tr>`).join('')
    + `</table><div style="font-size:11px;margin-top:6px">They stay unticked. <b>Make the challan</b> sends the other lines; these stay in Demand until the plan names a real fabric.</div></div>`;
}
const flowChPill = (ok, text) => `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${ok ? '#e7f5ec' : '#fde8e8'};color:${ok ? '#166534' : '#b42318'};font-weight:700;font-size:11.5px;white-space:nowrap">${text}</span>`;
/** Each fabric: its total and the RFD check on one row, its sizes under it. */
function flowChFabricHtml(fabs) {
  if (!fabs.length) return '<div class="muted" style="font-size:12px">Tick a line to see what goes.</div>';
  const stockCell = f => { const st = flowChStock(f.fabric, f.m);
    if (st.free == null) return '<span class="muted" style="font-size:11.5px">stock not known</span>';
    return st.short > 0.05
      ? flowChPill(false, `${nf(st.free)} m · ${nf(st.short)} m short`) + ` <button type="button" class="ghost" data-chpo="1" style="width:auto;font-size:11px;padding:2px 8px">Raise PO →</button>`
      : flowChPill(true, `${nf(st.free)} m · enough`); };
  return `<table class="xl" style="width:100%"><thead><tr><th style="text-align:left">Fabric · size</th><th>Pcs</th><th>Lines</th><th>Metres</th><th style="text-align:left">RFD on the shelf</th></tr></thead><tbody>`
    + fabs.map(f => `<tr style="background:var(--hover,#f4f6fb)"><td style="text-align:left;font-weight:700">${esc(f.fabric)}</td><td class="num"><b>${f.pcs ? nf(f.pcs) : '—'}</b></td><td class="num">${nf(f.lines)}</td><td class="num"><b>${nf(f.m)} m</b></td><td style="text-align:left;white-space:normal">${stockCell(f)}</td></tr>`
      + f.sizes.map(g => `<tr><td style="text-align:left;padding-left:22px" class="muted">${esc(g.size)}</td><td class="num">${g.pcs ? nf(g.pcs) : '—'}</td><td class="num">${nf(g.lines)}</td><td class="num">${nf(g.m)} m</td><td></td></tr>`).join('')).join('')
    + `</tbody></table><div class="muted" style="font-size:11px;margin-top:6px">Green: the RFD on the shelf covers it. Red: short — Raise PO opens the Greige Desk.</div>`;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') ['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const t = e.target; if (!t || !t.closest || !t.closest('[data-chk],[data-chp],[data-chm],#flcVen')) return;
  const box = document.getElementById && document.getElementById('flcTot'); if (box) box.textContent = flowChTotals(FLOW_CH_N);
  const sz = document.getElementById && document.getElementById('flcSize'); if (sz) sz.innerHTML = flowChSizeLive(FLOW_CH_N);
}));
/* Fix fabric in PPC opens that line's plan; Raise PO opens the Greige Desk's Inventory (21 Nov). Both leave the challan unsaved. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target && e.target.closest ? e.target.closest('[data-chfix],[data-chpo]') : null; if (!t) return;
  ptDlgClose();
  if (t.dataset.chfix) { const [no, sku] = t.dataset.chfix.split('|'); flowPpcOpen(no, sku); return; }
  showTab('gdesk'); GD.open('inv');
});
function flowChallanDialog(rows, pcode, rufRows, pre, after) {
  /* pre (18 Oct, the size challan): what to send on each line, worked out FIFO — those lines come ticked with those figures. */
  const preOf = x => (pre && x && x.s ? pre.get(x.s.key) : null);
  const cv = flowRfdCover(); FLOW_CH_COVER = cv;
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
  FLOW_CH_SZ = rows.map((x, i) => { let m = {}; try { m = cutSkuOf(x.r.sku) || {}; } catch (e) { m = {}; }
    return isRuf(i) ? { fabric: (flowRuffleOwed(x) || {}).fabric || '', size: '', ruffle: true }
      : flowChLineFacts(x, m); });
  const held = i => !!(FLOW_CH_SZ[i] || {}).unknown;
  const orders = [...new Set(rows.map(x => x.r.orderNo))], orderNo = orders.join(', '), isTest = rows.every(x => !!x.r.__t);
  const vens = flowChVendors();
  /* The printer PPC planned for these lines comes ready picked. */
  const planned = (pcode && pcode !== '?' ? pcode : rows.map(x => flowPlanPrinter(x.s)).find(Boolean)) || '';
  const lineHtml = rows.slice(0, nM).map((x, i) => { const p = x.s.plan || {}, c = cv.line[x.s.key] || {}, sepR = !!flowRufflePrinter(p);
    const pr = preOf(x), on = !held(i) && (pre ? !!pr : (flowFabOwed(x.r, x.s).metres > 0 || (!sepR && !x.s.fabSent && flowPrintExtras(x.r, p).length)));
    /* DESIGN A (Ravi, 20 Oct): the photo and the SKU share one cell, the figures sit side by side, nothing runs off the
     * right of the window; covered / short is a pill; the totals of what is ticked stand under the table (flowChTotals). */
    return `<tr${held(i) ? ' style="background:#fdf2f2"' : ''}><td><input type="checkbox" data-chk="${i}"${on ? ' checked' : ''}${held(i) ? ' disabled title="Fix the fabric in PPC first"' : ''} style="width:auto"></td>
      <td style="text-align:left;white-space:normal"><div style="display:flex;gap:10px;align-items:center;min-width:0">${typeof ptImgSpan === 'function' ? ptImgSpan(obUC(x.r.sku), 40) : ''}<div style="min-width:0"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b>${orders.length > 1 ? ` <span class="muted" style="font-size:10.5px">· ${esc(x.r.orderNo)}</span>` : ''}<div class="muted" style="font-size:10.5px">${esc(flowChItem(x.r))}</div>
        <div style="font-size:11px;color:#4338ca">Print: ${flowPrintTxt(flowPrintWhat(x.r, p))}</div>${sepR ? `<div class="muted" style="font-size:10.5px">ruffle → ${esc(flowRufflePrinter(p).name)} (its own challan)</div>` : flowExtrasTxt(flowPrintExtras(x.r, p))}</div></div></td>
      <td style="text-align:left;white-space:normal">${esc((p.fabric && p.fabric.name) || '—')}</td>
      <td class="num">${x.s.fabUnit === 'pcs'
        /* PART OF IT FOR NOW (Ravi, 15 Oct: "order ke 100 pcs h but me bhej 50 hi raha hu to wo partially challan bana saku"):
         * the pieces can be fewer than are owed; the rest stays in Demand → RFD, and the line says it went in part. */
        ? `<input data-chp="${i}" type="number" min="1" step="1" max="${flowFabOwed(x.r, x.s).left}" value="${pr ? pr.pcs : flowFabOwed(x.r, x.s).left}" title="Send fewer pieces for now — the rest stays in Demand" style="width:60px;padding:3px 6px;font-size:12px">${flowDoneTxt(x)}`
        : (pr ? `${nf(pr.pcs)} <span class="muted" style="font-size:10px">of ${nf(x.r.qty)}</span>` : nf(x.r.qty))}</td>
      <td class="num" style="white-space:normal"><input data-chm="${i}" type="number" step="0.01" value="${esc((pr ? pr.metres : flowFabOwed(x.r, x.s).metres) || '')}" style="width:72px;padding:3px 6px;font-size:12px">${x.s.fabSent > 0 ? `<div class="muted" style="font-size:10px">${nf(x.s.fabSent)} ${x.s.fabUnit} sent already</div>` : ''}${+(p.fabric && p.fabric.fromPrinted) ? `<div class="muted" style="font-size:10px">${nf(p.fabric.fromPrinted)} ${p.fabric.printedUnit === 'pcs' ? 'pcs' : 'm'} from printed stock</div>` : ''}</td>
      <td style="font-size:11px;white-space:normal">${held(i) ? flowChPill(false, 'fix fabric first') : c.short ? `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#fde8e8;color:#b42318;font-weight:700">short ${nf(c.short)} m</span>` : '<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#e7f5ec;color:#166534;font-weight:700">covered</span>'}</td></tr>`; }).join('') + rufHtml;
  ptOpenDialog({
    title: `RFD challan — ${orderNo}${pcode && pcode !== '?' ? ' → ' + ((vens.find(v => String(v.code) === String(pcode)) || {}).desc || ((rows[0].s.plan.printer || {}).name) || pcode) : ''}`,
    subtitle: (orders.length > 1 ? `${orders.length} orders, one printed fabric, one vendor. ` : 'The fabric of this order, to one vendor. ') + 'Saving numbers the challan, opens it to print, and marks these lines\' fabric as given — they leave Demand by themselves.',
    wide: true,
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Vendor<select id="flcVen"><option value="">— pick the vendor —</option>${vens.map(v => `<option value="${esc(v.code)}"${String(v.code) === String(planned) ? ' selected' : ''}>${esc((v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('')}</select></label>
        <label>Date<input id="flcDate" value="${esc(dToday())}" readonly title="Cloth is given to a printer today — the date cannot be changed"></label></div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;align-items:flex-start">
        <div style="flex:1.4 1 560px;min-width:0;border:1px solid var(--line,#e3e7ef);border-radius:10px;max-height:62vh;overflow:auto">
          <div style="position:sticky;top:0;z-index:1;background:var(--card,#fff);padding:8px 12px;font-weight:700;font-size:13px;border-bottom:1px solid var(--line,#e3e7ef)">Lines on this challan — untick any that should not go</div>
          <table class="xl" style="width:100%;table-layout:fixed"><colgroup><col style="width:34px"><col><col style="width:100px"><col style="width:84px"><col style="width:92px"><col style="width:104px"></colgroup>
            <thead><tr><th></th><th style="text-align:left">Item</th><th style="text-align:left">Fabric</th><th>Pcs</th><th>Metres</th><th>RFD</th></tr></thead><tbody>${lineHtml}</tbody></table></div>
        <div style="flex:1 1 380px;min-width:0;border:1px solid var(--line,#e3e7ef);border-radius:10px;padding:12px 14px;max-height:62vh;overflow:auto">
          <div id="flcTot" style="margin-bottom:8px;font-size:12.5px;font-weight:600"></div>
          <div id="flcSize"></div>
          <label style="display:block;margin-top:10px">Note (vehicle, who carried it…)<input id="flcNote"></label></div></div>`,
    saveLabel: 'Make the challan',
    onSave: async () => {
      const code = $('flcVen').value, v = vens.find(x => String(x.code) === String(code));
      if (!v) return 'Which vendor is the fabric going to? Pick one.';
      const date = dToday();   // issued today, whatever the box says (Vishesh, 23 Nov: "any date of issue is to be fixed")
      const picked = rows.map((x, i) => ({ x, ruf: isRuf(i), on: (document.querySelector(`[data-chk="${i}"]`) || {}).checked, m: +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0),
        pc: !isRuf(i) && x.s.fabUnit === 'pcs' ? +((document.querySelector(`[data-chp="${i}"]`) || {}).value || flowFabOwed(x.r, x.s).left) : null }))
        .filter(y => y.on);
      if (!picked.length) return 'Tick at least one line.';
      const badF = picked.filter(y => !y.ruf && (FLOW_CH_SZ[rows.indexOf(y.x)] || {}).unknown);
      if (badF.length) return badF.map(y => `${obUC(y.x.r.sku)}: "${(y.x.s.plan.fabric || {}).name}" is not a real fabric`).join(' · ') + ' — fix the fabric in PPC first.';
      const badP = picked.filter(y => y.pc != null && !(y.pc >= 1 && y.pc === Math.round(y.pc) && y.pc <= flowFabOwed(y.x.r, y.x.s).left));
      if (badP.length) return badP.map(y => `${obUC(y.x.r.sku)}: pieces are whole, at least 1 and at most the ${nf(flowFabOwed(y.x.r, y.x.s).left)} still owed`).join(' · ');
      const other = picked.filter(y => !y.ruf && flowPlanPrinter(y.x.s) && flowPlanPrinter(y.x.s) !== String(v.code));
      if (other.length) return `${other.map(y => `${obUC(y.x.r.sku)} is planned for ${y.x.s.plan.printer.name}`).join(' · ')} — give it to that printer, or change the printer with "edit plan" first.`;
      const otherR = picked.filter(y => y.ruf && String(flowRufflePrinter(y.x.s.plan).code) !== String(v.code));
      if (otherR.length) return `${otherR.map(y => `${obUC(y.x.r.sku)}'s ruffle is planned for ${flowRufflePrinter(y.x.s.plan).name}`).join(' · ')} — give it to that printer, or change it with "edit plan" first.`;
      /* A line whose body is all from printed stock may go for its ruffle cloth alone. */
      const noM = picked.filter(y => !(y.m > 0) && (y.ruf || flowRufflePrinter(y.x.s.plan) || !(!y.x.s.fabSent && flowPrintExtras(y.x.r, y.x.s.plan).length))).map(y => obUC(y.x.r.sku) + (y.ruf ? ' (ruffle)' : ''));
      if (noM.length) return `How many metres? Type them for ${noM.join(', ')}.`;
      const now = new Date().toISOString(), vname = v.desc || v.name || v.code;
      const ch = { no: '', date, orderNo, orders, vendor: { code: v.code, name: vname }, note: $('flcNote').value.trim(), at: now, by: ME.email || '',
        lines: picked.map(({ x, m, ruf, pc }) => ruf
          /* the ruffle cloth alone, to its own printer: its key is the line's, marked ruffleOnly (indexed as <key>~ruffle) */
          ? { key: x.s.key, ruffleOnly: true, sku: obUC(x.r.sku), item: flowChItem(x.r), print: null, extras: flowPrintExtras(x.r, x.s.plan, flowPoRemOf(x.r, x.s)), fabric: (flowRuffleOwed(x) || {}).fabric || '', pcs: 0, metres: flowR2(m) }
          : { key: x.s.key, sku: obUC(x.r.sku), item: flowChItem(x.r), print: flowPrintWhat(x.r, x.s.plan), extras: flowPrintExtras(x.r, x.s.plan, flowPoRemOf(x.r, x.s)), fabric: (x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || '', pcs: x.s.fabUnit === 'pcs' ? (pc != null ? pc : flowFabOwed(x.r, x.s).left) : (preOf(x) ? preOf(x).pcs : flowToPrint(x.r, x.s.plan).pcs), metres: flowR2(m),
          /* the ruffle cloth goes once, on the first challan for the line — never when it has a printer of its own */ ...(x.s.fabSent > 0 || flowRufflePrinter(x.s.plan) ? { extras: [] } : {}) }) };
      const unplanned = picked.filter(y => !y.ruf && !flowPlanPrinter(y.x.s)).map(y => y.x.s.key);
      const wrote = await flowChallanWrite(ch, v, { isTest, unplanned });
      if (wrote) return wrote;
      const no = ch.no;
      renderFlow();
      const err = flowChallanPrint(no);
      if (err) { $('flMsg').className = 'err'; $('flMsg').textContent = `Challan ${no} saved. ${err}`; }
      if (typeof after === 'function') setTimeout(after, 0);   // the next challan of a bulk run (flowChQueue)
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
  const szb = document.getElementById && document.getElementById('flcSize'); if (szb) szb.innerHTML = flowChSizeLive(rows.length);
  if (typeof ptImgFill === 'function') ptImgFill(rows.map(x => obUC(x.r.sku)), false, typeof ptImgPatch === 'function' ? ptImgPatch : null);
}

/* ONE WAY TO SAVE A CHALLAN (23 Nov): the Demand window and the Inventory's Send to printer card both come here.
 * THE NUMBER IS CLAIMED: the challan is written only where no challan of that number is yet — two people making one at the
 * same moment get two numbers, never one challan written over the other. A line PPC left without a printer gets the one its
 * cloth went to. Each line's fabric is marked as given, so it leaves Demand by itself.
 * Returns '' when saved (ch.no is then its number), else what went wrong in words, for the window to show. */
async function flowChallanWrite(ch, v, how) {
  const vname = ch.vendor.name, now = ch.at;
  let no = flowChallanNo(ch.date, how.isTest); ch.no = no;
  for (let k = 0, taken = []; ; k++) {
    let er = ''; try { er = await flowClaim('pt_flowChallans/' + no, ch); } catch (e) { return 'Could not save: ' + (e.message || e); }
    if (!er) break;
    if (k >= 15) return 'Could not get a free challan number — press Refresh and try again.';
    taken.push(no); no = flowChallanNo(ch.date, how.isTest, taken); ch.no = no;
  }
  const patch = typeof ptCas === 'function' ? {} : { ['pt_flowChallans/' + no]: ch };
  const setP = how.unplanned || [];
  setP.forEach(k => { patch[`pt_ppc/${k}/printer`] = { code: v.code, name: vname, why: 'set by challan ' + no }; });
  ch.lines.filter(l => !l.ruffleOnly).forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = { at: now, by: ME.email || '', what: l.fabric, metres: l.metres, note: `Challan ${no} to ${vname}`, challan: no, vendor: vname }; });
  /* THE PRINTER SEES IT NOW (Vishesh, 23 Nov): a line held from the printer's own login until its RFD challan is shown to them
   * from this challan on — in the same write. If the printer's orders cannot be read, the challan still saves and the console says
   * so; those lines stay held until the next challan or a release by hand. */
  if (typeof flowVoRelease === 'function') {
    try {
      if (typeof ensureVo === 'function' && typeof VO !== 'undefined' && !Array.isArray(VO.rows)) await ensureVo();
      flowVoRelease(ch.lines.map(l => (l.ruffleOnly ? l.key + FLOW_RUF : l.key)), patch);
    } catch (e) { console.warn(`Challan ${no}: could not lift the printer's hold (${e.message || e}); the lines stay held from the printer.`); }
  }
  /* the printer's own copy of the challan, in the same save (CLOTH ON ITS WAY TO THE PRINTER, below) */
  const cloth = flowClothFor(ch, how);
  if (cloth) patch[`pt_vendorChallans/${v.code}/${no}`] = cloth;
  try { if (Object.keys(patch).length) await ptPatch(patch); } catch (e) { return `Challan ${no} is saved, but the lines could not be marked (${e.message || e}) — press Refresh.`; }
  FLOW.ch = Object.assign({}, FLOW.ch, { [no]: ch });
  if (cloth) FLOW.cloth = Object.assign({}, FLOW.cloth, { [v.code]: Object.assign({}, (FLOW.cloth || {})[v.code], { [no]: cloth }) });
  if (setP.length) { FLOW.ppc = Object.assign({}, FLOW.ppc); setP.forEach(k => { FLOW.ppc[k] = Object.assign({}, FLOW.ppc[k], { printer: patch[`pt_ppc/${k}/printer`] }); }); }
  const dem = Object.assign({}, FLOW.dem);
  ch.lines.filter(l => !l.ruffleOnly).forEach(l => { dem[l.key] = Object.assign({}, dem[l.key] || {}, { fabricReady: patch[`pt_flowDemand/${l.key}/fabricReady`] }); });
  FLOW.dem = dem;
  return '';
}

/* ---- CLOTH ON ITS WAY TO THE PRINTER (Vishesh, 23 Nov: "in fabric inventory it should be minus from the inventory and show as
 * transit to vendor, and when vendor receives the fabric it must minus"; "when I open the printer portal and search for that order
 * I should be able to see that order under that printer") ----
 * Every RFD challan to a printer leaves a copy in that printer's own branch, pt_vendorChallans/<code>/<no> -- the one place a
 * printer's sign-in may both read and write:
 *   { kind: 'cloth', no, date, vendor: { code, name }, lines: [{ orderNo, sku, fabric, pcs, metres }], metres, at, by }
 * The printer presses "Cloth received" in the portal (printer-cloth.js), which adds received = { at, by }. Until then the
 * challan's metres show "in transit" under RFD on shelf on the Greige Desk's Inventory; after it they are gone from our count.
 * A test order, a challan of cloth already standing with the printer and a record of cloth given earlier get no copy -- no cloth
 * travels on them. Challans made before this have no copy and are not shown as in transit: nobody could ever mark them received.
 * Errors: the copy goes in the same save as the challan's marks. A failed read of the copies shows nothing in transit and says so
 * on the console (it is a count to look at, not stock that is moved). */
const FLOW_CLOTH = 'cloth';
/** The printer's copy of a challan, or null when no cloth travels on it. */
function flowClothFor(ch, how) {
  if ((how && how.isTest) || ch.standing || ch.recordOnly) return null;
  const orders = ch.orders || [];
  const orderOf = l => orders.find(o => flowKey(o, l.sku) === l.key) || orders[0] || ch.orderNo || '';
  const lines = (ch.lines || []).filter(l => +l.metres > 0 || +l.pcs > 0)
    .map(l => ({ orderNo: orderOf(l), sku: l.sku || '', fabric: l.fabric || '', pcs: +l.pcs || 0, metres: flowR2(+l.metres || 0) }));
  if (!lines.length) return null;
  return { kind: FLOW_CLOTH, no: ch.no, date: ch.date, vendor: ch.vendor, lines, metres: flowR2(lines.reduce((a, l) => a + l.metres, 0)), at: ch.at, by: ch.by || '' };
}
/** Reads every printer's copies once (FLOW.cloth = { <code>: { <no>: copy } }). Never throws. */
async function flowClothLoad() {
  try { FLOW.cloth = (await ptGet('pt_vendorChallans')) || {}; }
  catch (e) { FLOW.cloth = {}; console.warn(`Cloth on its way to printers: the printers' copies could not be read (${e.message || e}) — nothing shows as in transit.`); }
}
/** The challan lines of one fabric not yet received by the printer, from fromDay on: [{ no, date, vendor, orderNo, sku, metres }]. */
function flowClothInTransit(fabric, fromDay) {
  const k = flowFabKey(fabric), out = [];
  Object.values(FLOW.cloth || {}).forEach(byNo => Object.values(byNo || {}).forEach(c => {
    if (!c || c.kind !== FLOW_CLOTH || c.received) return;
    if ((FLOW.ch && FLOW.ch[c.no] && FLOW.ch[c.no].cancelled) || (fromDay && String(c.date || '') < fromDay)) return;
    (c.lines || []).forEach(l => { if (l && +l.metres > 0 && flowFabKey(l.fabric) === k) out.push({ no: c.no, date: c.date, vendor: (c.vendor || {}).name || '', orderNo: l.orderNo, sku: l.sku, metres: +l.metres }); });
  }));
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.no).localeCompare(String(b.no)));
}

/* ---- SEND TO PRINTER FROM THE GREIGE DESK'S INVENTORY (Vishesh, 23 Nov) ---------------------------------------------- *
 *
 * "Send to printer" on a fabric's RFD on the shelf opens this card over the Inventory page: every line still waiting for
 * that fabric on Demand → RFD, a printer from the vendor master (printers only), and Choose by order or by print to narrow
 * the list. Unlike the Demand window nothing is typed: each line carries all the pieces it still needs, the date is today,
 * and the metres are those pieces × the cloth per piece on the SKU's master row.
 *
 * A CHANGE OF PRINTER NEEDS APPROVAL (Vishesh, 23 Nov: "PPC ne jis printer ko diya, usse doosre ko dena ho to approval"). Picking a
 * printer shows EVERY line of the fabric. A line PPC gave to another printer is flagged "moving"; it does not go on the challan
 * at once. Make the challan opens a Review first: "Goes now" (the lines PPC gave to this printer, or to none) and "Waits for
 * approval" (the moving ones). Confirm makes the challan for the first and leaves a waiting request on each of the second
 * (pt_flowDemand/<line>/printerMove). Ravi, or anyone with the right "Approve a change of printer" (flprn), approves it from
 * this card: the plan and its print order move to the new printer (flowChangePrinterSave, the same code as Demand's Change
 * printer) and the challan to it is made. A line whose cloth is already partly given, or whose printer cannot be changed
 * (flowChangePrinterPlan refuses), cannot be moved from here — PPC changes it.
 * Errors: the card only reads until Confirm. A refused save says why in the card. Money-like steps fail loudly: nothing is
 * written when the challan is refused; once the challan is made, a request that could not be saved is said in the result, never
 * hidden. Approving is claimed first (ptCas waiting → approving), so two approvers cannot both do it; if the printer change
 * fails the request goes back to waiting, and if only the challan fails it is marked moved and says so.
 * A line whose master row has no cloth per piece is shown but cannot go. */
let FLOW_SH = null;   // the open card: { fabric, lines, tick: Set of line keys, by: 'order' | 'print', pick, after, review: { code, note } }

/** One line on the card: the pieces still owed, the master's cloth per piece, the metres they make, its printer and print. */
function flowShLine(x) {
  const o = flowFabOwed(x.r, x.s), qty = +x.r.qty || 0;
  const pcs = o.unit === 'pcs' ? Math.round(o.left) : (o.need > 0 ? Math.round(qty * o.left / o.need) : 0);
  let m = null; try { m = cutSkuOf(x.r.sku); } catch (e) { m = null; }
  const perPc = flowR2(+((m || {}).consumption) || 0);
  let print = null; try { print = flowPrintWhat(x.r, x.s.plan); } catch (e) { print = null; }
  const pl = (x.s.plan && x.s.plan.printer) || {};
  return { x, key: x.s.key, pcs, perPc, metres: flowR2(pcs * perPc), printer: flowPlanPrinter(x.s), printerName: pl.name || '',
    print, printKey: print ? String(print.code || print.label || '') : '' };
}
/** The lines of one fabric still waiting on Demand → RFD for cloth, oldest order first. */
function flowShLines(fabric) {
  const F = flowFabKey(fabric);
  return flowRows().filter(x => flowInView('drfd', x.s) && x.s.route !== 'stitch' && flowFabKey(((x.s.plan || {}).fabric || {}).name) === F)
    .map(flowShLine).filter(l => l.pcs > 0)
    .sort((a, b) => String(a.x.r.orderDate || '').localeCompare(String(b.x.r.orderDate || '')) || String(a.x.r.orderNo).localeCompare(String(b.x.r.orderNo)));
}
/** What the card shows: every line of the fabric, narrowed to the order or print chosen (whatever printer is picked). */
/* THE PRINTER'S OWN LINES FIRST (Vishesh, 23 Nov: "when I choose the printer … show me only those 10 articles which are of SS
 * Hand Block … then I can select more"). With a printer picked the card shows the lines PPC set for it, ticked; "Show N more
 * lines" (S.more) brings in the rest — no printer yet, or another printer's — unticked, to add by hand. */
function flowShShown(S, code) {
  const chosen = l => !S.pick || (S.by === 'print' ? l.printKey === S.pick : String(l.x.r.orderNo) === S.pick);
  return S.lines.filter(l => chosen(l) && (!code || S.more || flowShPlannedFor(l, code)));
}
/** The line is one PPC set for this printer. */
const flowShPlannedFor = (l, code) => !!(code && l.printer && String(l.printer) === String(code));
/** Picking a printer ticks exactly its own lines (those PPC set for it, with cloth per piece) and shows only them. */
function flowShTickFor(S, code) {
  S.tick = new Set(S.lines.filter(l => flowShPlannedFor(l, code) && l.perPc > 0).map(l => l.key));
  S.more = false;
}
/** True when PPC gave the line to a printer other than the one picked — sending it there is a change of printer. */
const flowShMoving = (l, code) => !!(code && l.printer && String(l.printer) !== String(code));
/** The request waiting for approval on a line, or null. */
const flowShWaits = l => flowPrnReq(l.key, 'waiting');
/** Why a moving line cannot be moved from this card ('' when it can): cloth already given, or the printer change refuses it. */
function flowShStuck(l, code) {
  if (!flowShMoving(l, code)) return '';
  if (l.x.s.fabSent > 0) return 'part of its cloth is already given';
  return flowChangePrinterPlan(l.key, code).err || '';
}
/** The lines ticked and able to go for this printer: cloth per piece known, nothing waiting, not stuck with its planned printer. */
const flowShGoing = (S, code) => flowShShown(S, code).filter(l => S.tick.has(l.key) && l.perPc > 0 && !flowShWaits(l) && !flowShStuck(l, code));
/** The second drop-down: each order (or print) among the printer's lines, with how many lines it has. */
function flowShChoices(S, code) {
  const seen = new Map();
  flowShShown(Object.assign({}, S, { pick: '' }), code).forEach(l => {
    const k = S.by === 'print' ? l.printKey : String(l.x.r.orderNo); if (!k) return;
    const label = S.by === 'print' ? [l.print.code, l.print.label].filter(Boolean).join(' · ') : k;
    seen.set(k, { k, label, n: ((seen.get(k) || {}).n || 0) + 1 });
  });
  return [...seen.values()];
}

/** Reads what the card needs, then opens it. Returns why it could not open, or '' (after(no, printError) runs once a challan is made). */
async function flowShelfChallanOpen(fabric, after) {
  if (!flowScreenAllowed().some(b => b[0] === 'drfd')) return 'Making an RFD challan needs Demand → RFD access.';
  await flowEnsureData();
  return flowShelfChallanShow(fabric, after);
}
/** Opens the card. `keep` is the card as it was (the Back button of the Review): the same ticks, choice, printer and note come back. */
function flowShelfChallanShow(fabric, after, keep) {
  const lines = flowShLines(fabric);
  if (!lines.length) return `No line is waiting for ${fabric} on Demand → RFD.`;
  FLOW_CH_COVER = flowRfdCover();
  const plannedOne = keep ? [keep.review.code] : [...new Set(lines.map(l => l.printer).filter(Boolean))];
  FLOW_SH = keep ? Object.assign({}, keep, { lines, review: null }) : { fabric, lines, tick: new Set(), more: false, by: 'order', pick: '', after };
  /* a card that opens with its printer already picked (every line PPC set is for one printer) ticks that printer's lines */
  if (!keep && plannedOne.length === 1 && flowPrinters().some(v => String(v.code) === String(plannedOne[0]))) flowShTickFor(FLOW_SH, plannedOne[0]);
  const pr = flowPrinters();
  ptOpenDialog({
    title: `RFD challan — ${fabric} → printer`,
    subtitle: 'From the RFD on the shelf. Each line goes with all the pieces it still needs; metres are pieces × the cloth per piece on its master row. Untick a line to leave it out.',
    wide: true,
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label>Printer<select id="flshVen"><option value="">— pick the printer —</option>${pr.map(v => `<option value="${esc(v.code)}"${plannedOne.length === 1 && String(v.code) === String(plannedOne[0]) ? ' selected' : ''}>${esc(v.desc || v.name || v.code)}</option>`).join('')}</select></label>
        <label>Date<input id="flshDate" value="${esc(dToday())}" readonly title="A challan from here is made today"></label>
        <label>Choose by<select id="flshBy"><option value="order"${FLOW_SH.by === 'order' ? ' selected' : ''}>By order</option><option value="print"${FLOW_SH.by === 'print' ? ' selected' : ''}>By print</option></select></label>
        <label><span id="flshPickT">Order</span><select id="flshPick"></select></label></div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;align-items:flex-start">
        <div id="flshBody" style="flex:1.5 1 560px;min-width:0;border:1px solid var(--line,#e3e7ef);border-radius:10px;max-height:60vh;overflow:auto"></div>
        <div style="flex:1 1 320px;min-width:0;border:1px solid var(--line,#e3e7ef);border-radius:10px;padding:12px 14px">
          <div id="flshSum"></div>
          <label style="display:block;margin-top:10px">Note (vehicle, who carried it…)<input id="flshNote" value="${esc(keep ? keep.review.note : '')}"></label></div></div>
      <div id="flshWait"></div>`,
    saveLabel: 'Make the challan',
    onSave: flowShSave,
  });
  flowShDraw();
  return '';
}
/** Draws the card's lines, the second drop-down and the summary from FLOW_SH and the printer picked. */
function flowShDraw() {
  const S = FLOW_SH; if (!S) return;
  const code = ($('flshVen') || {}).value || '';
  const ch = flowShChoices(S, code);
  if (S.pick && !ch.some(c => c.k === S.pick)) S.pick = '';
  $('flshPickT').textContent = S.by === 'print' ? 'Print' : 'Order';
  $('flshPick').innerHTML = `<option value="">All ${S.by === 'print' ? 'prints' : 'orders'} (${ch.length})</option>`
    + ch.map(c => `<option value="${esc(c.k)}"${c.k === S.pick ? ' selected' : ''}>${esc(c.label)} · ${nf(c.n)} line${c.n === 1 ? '' : 's'}</option>`).join('');
  $('flshBody').innerHTML = flowShTableHtml(S, code);
  $('flshSum').innerHTML = flowShSumHtml(S, code);
  $('flshWait').innerHTML = flowShWaitHtml(S);
  if (typeof ptImgFill === 'function') ptImgFill(flowShShown(S, code).map(l => obUC(l.x.r.sku)), false, typeof ptImgPatch === 'function' ? ptImgPatch : null);
}
function flowShTableHtml(S, code) {
  const shown = flowShShown(S, code);
  return flowShMoreHtml(S, code) + (shown.length ? flowShRowsHtml(S, code, shown)
    : `<div class="muted" style="padding:14px">${code && !S.more ? 'PPC has set no line of this fabric for this printer. Show the other lines to choose some.' : 'No line for this choice.'}</div>`);
}
/** The link above the lines: show the other lines (no printer yet, or another printer's), or only this printer's again. */
function flowShMoreHtml(S, code) {
  if (!code) return '';
  const others = flowShShown(Object.assign({}, S, { more: true }), code).filter(l => !flowShPlannedFor(l, code)).length;
  if (!others) return '';
  const v = flowPrinters().find(p => String(p.code) === String(code)) || {};
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--line,#e3e7ef);font-size:12.5px">`
    + (S.more ? `<button type="button" class="ghost" data-shmore="0" style="width:auto;font-size:12px;padding:3px 10px">Show only ${esc(v.desc || v.name || code)}'s lines</button>`
      : `<button type="button" class="ghost" data-shmore="1" style="width:auto;font-size:12px;padding:3px 10px">Show ${nf(others)} more line${others === 1 ? '' : 's'}</button> <span class="muted">— no printer yet, or another printer's (ticking one of another printer's asks for approval)</span>`)
    + '</div>';
}
function flowShRowsHtml(S, code, shown) {
  const head = l => S.by === 'print' ? ([l.print && l.print.code, l.print && l.print.label].filter(Boolean).join(' · ') || 'No print named') : String(l.x.r.orderNo);
  let last = null;
  /* min-width: on a phone the table scrolls sideways rather than wrapping the item names a word to a line */
  return `<table class="xl" style="width:100%;min-width:500px;table-layout:fixed"><colgroup><col style="width:34px"><col><col style="width:64px"><col style="width:64px"><col style="width:78px"></colgroup>
    <thead><tr><th></th><th style="text-align:left">Item</th><th>Pcs</th><th>m / pc</th><th>Metres</th></tr></thead><tbody>`
    + shown.map(l => {
      const h = head(l), grp = h !== last ? `<tr><td colspan="5" style="text-align:left;font-weight:700;background:var(--hover,#f4f6fb)">${esc(h)}</td></tr>` : '';
      last = h;
      const noCloth = !(l.perPc > 0), wait = flowShWaits(l), stuck = flowShStuck(l, code), blocked = noCloth || !!wait || !!stuck;
      const why = noCloth ? 'No cloth per piece on its master row' : wait ? 'Waiting for approval' : stuck;
      return grp + `<tr${noCloth ? ' style="background:#fdf2f2"' : ''}><td><input type="checkbox" data-shk="${esc(l.key)}"${S.tick.has(l.key) && !blocked ? ' checked' : ''}${blocked ? ` disabled title="${esc(why)}"` : ''} style="width:auto"></td>
        <td style="text-align:left;white-space:normal"><div style="display:flex;gap:10px;align-items:center;min-width:0">${typeof ptImgSpan === 'function' ? ptImgSpan(obUC(l.x.r.sku), 36) : ''}<div style="min-width:0"><b style="font-family:ui-monospace,monospace">${esc(obUC(l.x.r.sku))}</b>${S.by === 'print' ? ` <span class="muted" style="font-size:10.5px">· ${esc(l.x.r.orderNo)}</span>` : ''}<div class="muted" style="font-size:10.5px">${esc(flowChItem(l.x.r))}</div>
          ${l.print ? `<div style="font-size:11px;color:#4338ca">Print: ${flowPrintTxt(l.print)}</div>` : ''}${flowShPlanTxt(l, code, wait, stuck)}${noCloth ? '<div style="font-size:11px;color:#b42318;font-weight:600">No cloth per piece on its master row — add it there first</div>' : ''}</div></div></td>
        <td class="num">${nf(l.pcs)}</td><td class="num">${noCloth ? '—' : nf(l.perPc)}</td><td class="num"><b>${noCloth ? '—' : nf(l.metres)}</b></td></tr>`;
    }).join('') + '</tbody></table>';
}
function flowShSumHtml(S, code) {
  const go = flowShGoing(S, code), pcs = go.reduce((a, l) => a + l.pcs, 0), m = flowR2(go.reduce((a, l) => a + l.metres, 0));
  const v = flowPrinters().find(p => String(p.code) === String(code));
  const st = flowChStock(S.fabric, m);
  const stock = st.free == null ? '<span class="muted" style="font-size:11.5px">RFD on the shelf not known</span>'
    : st.short > 0.05 ? flowChPill(false, `${nf(st.free)} m on the shelf · ${nf(st.short)} m short`) : flowChPill(true, `${nf(st.free)} m on the shelf · enough`);
  return `<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">Ticked: ${nf(go.length)} line${go.length === 1 ? '' : 's'} · ${nf(pcs)} pcs · ${nf(m)} m</div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">${v ? 'Goes to <b>' + esc(v.desc || v.name || v.code) + '</b>' : 'Pick the printer'} · ${esc(dToday())}</div>
    <div>${stock}</div>`;
}
/** What a row says about its printer: the plan, a change waiting for approval, or why it cannot be moved from here. */
function flowShPlanTxt(l, code, wait, stuck) {
  const line = (txt, colour) => `<div style="font-size:11px;${colour ? 'color:' + colour + ';font-weight:600' : ''}"${colour ? '' : ' class="muted"'}>${esc(txt)}</div>`;
  if (wait) return line(`waits for approval to ${wait.to.name}`, '#b54708');
  if (stuck) return line(`Already started with ${l.printerName || l.printer} — change the printer from PPC`, '#b42318');
  if (flowShMoving(l, code)) {
    const to = flowPrinters().find(p => String(p.code) === String(code)) || {};
    return line(`PPC gave this to ${l.printerName || l.printer} — moving it to ${to.desc || to.name || code} needs approval`, '#b54708');
  }
  return !code && l.printerName ? line(`planned: ${l.printerName}`) : '';
}
/* ---- ASKING FOR, AND DECIDING, A CHANGE OF PRINTER (Vishesh, 23 Nov) ---- */
const flowPrnMay = () => flowMay('flprn');
/** The request on a line (pt_flowDemand/<line>/printerMove); with a status given, only if it is in that status. */
function flowPrnReq(key, status) {
  const r = ((FLOW.dem || {})[key] || {}).printerMove;
  return r && (!status || r.status === status) ? r : null;
}
/** The requests waiting for approval, each with its line; only those of one fabric when a fabric is given. */
/* A request left "approving" (the approver's browser closed half-way) comes back as waiting after 10 minutes, so it is never lost. */
const FLOW_PRN_STALE_MS = 10 * 60 * 1000;
function flowPrnOpen(key) {
  const r = flowPrnReq(key); if (!r) return null;
  if (r.status === 'waiting') return r;
  return r.status === 'approving' && Date.now() - Date.parse(r.claimAt || 0) > FLOW_PRN_STALE_MS ? r : null;
}
function flowPrnWaiting(fabric) {
  const F = fabric == null ? null : flowFabKey(fabric);
  return flowRows().map(x => ({ key: x.s.key, x, req: flowPrnOpen(x.s.key) }))
    .filter(w => w.req && (F === null || flowFabKey(((w.x.s.plan || {}).fabric || {}).name) === F));
}
/** Writes the request on a line only where it is still `expect` (null = none), so two people cannot decide one request twice.
 * Returns '' written, 'changed' somebody else got there first, or what went wrong in words. */
async function flowPrnSet(key, expect, next) {
  const path = `pt_flowDemand/${key}/printerMove`;
  try { if (typeof ptCas === 'function') { if (await ptCas(path, expect, next)) return 'changed'; } else await ptPatch({ [path]: next }); } catch (e) { return 'Could not save: ' + (e.message || e); }
  FLOW.dem = Object.assign({}, FLOW.dem, { [key]: Object.assign({}, (FLOW.dem || {})[key], { printerMove: next }) });
  return '';
}
/** Approve: the plan and its print order move to the asked printer, then the challan to it is made. '' = done (words in .said). */
async function flowPrnApprove(key) {
  if (!flowPrnMay()) return 'Only Ravi, or someone with the right "Approve a change of printer", can approve this.';
  const req = flowPrnOpen(key); if (!req) return 'That request is not waiting any more — press Refresh.';
  const claim = Object.assign({}, req, { status: 'approving', claimBy: ME.email || '', claimAt: new Date().toISOString() });
  const lost = await flowPrnSet(key, req, claim);
  if (lost) return lost === 'changed' ? 'Somebody else has just decided this — press Refresh.' : lost;
  const er = await flowPrnMove(key, req);
  if (er) { await flowPrnSet(key, claim, req); return er; }   // nothing moved: it waits again
  const made = await flowPrnChallan(key, req), decided = { decidedBy: ME.email || '', decidedAt: new Date().toISOString() };
  if (made.err) { await flowPrnSet(key, claim, Object.assign({}, claim, decided, { status: 'moved' })); return `Printer changed; make the challan from Send to printer. (${made.err})`; }
  const left = await flowPrnSet(key, claim, Object.assign({}, claim, decided, { status: 'done', challan: made.no }));
  flowPrnApprove.no = made.no;
  flowPrnApprove.said = `${req.sku} moved to ${req.to.name}; challan ${made.no} made.${left ? ' The request could not be marked done — press Refresh.' : ''}`;
  return '';
}
/** The printer change itself, through Demand's Change printer; its own questions (the Vendor Order) are still asked. */
async function flowPrnMove(key, req) {
  const x = flowRows().find(y => y.s.key === key); if (!x) return 'That line is not here any more — press Refresh.';
  if (x.s.fabSent > 0) return `${req.sku}: part of its cloth is already given — change the printer from PPC.`;
  const stuck = flowChangePrinterPlan(key, req.to.code).err; if (stuck) return stuck;
  return flowChangePrinterSave(key, req.to.code, `approved on the Send to printer card — asked by ${req.by || 'someone'}`);
}
/** The challan for one approved line, to its new printer: the pieces and metres asked for, made as the card makes them. */
async function flowPrnChallan(key, req) {
  const x = flowRows().find(y => y.s.key === key), v = flowPrinters().find(p => String(p.code) === String(req.to.code));
  if (!x || !v) return { err: 'the line or the printer is not here' };
  return flowShMake(v, [Object.assign({}, flowShLine(x), { pcs: req.pcs, metres: req.metres })], '', req.fabric);
}
/** Refuse: the line stays with PPC's printer. */
async function flowPrnRefuse(key, why) {
  if (!flowPrnMay()) return 'Only Ravi, or someone with the right "Approve a change of printer", can refuse this.';
  const req = flowPrnOpen(key); if (!req) return 'That request is not waiting any more — press Refresh.';
  const er = await flowPrnSet(key, req, Object.assign({}, req, { status: 'refused', decidedBy: ME.email || '', decidedAt: new Date().toISOString(), why: why || '' }));
  return er === 'changed' ? 'Somebody else has just decided this — press Refresh.' : er;
}
/** The "Waiting for approval" block under the card: who asked what, with Approve / Refuse for those who may decide. */
function flowShWaitHtml(S) {
  const list = flowPrnWaiting(S.fabric), may = flowPrnMay();
  if (!list.length) return '';
  return `<div style="margin-top:12px;border:1px solid #f5c26b;background:#fffaeb;border-radius:10px;padding:10px 14px"><div style="font-weight:700;font-size:12.5px;margin-bottom:6px">Waiting for approval — change of printer</div>`
    + list.map(w => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;padding:4px 0"><span style="flex:1 1 320px"><b>${esc(w.req.sku)}</b> · ${esc(w.req.orderNo)} · ${esc(w.req.from.name)} → <b>${esc(w.req.to.name)}</b> · ${nf(w.req.pcs)} pcs · ${nf(w.req.metres)} m <span class="muted">· asked by ${esc(String(w.req.by || '').split('@')[0] || '—')} ${esc(String(w.req.at || '').slice(0, 10))}</span></span>`
      + (may ? `<button type="button" class="btn" data-prnok="${esc(w.key)}">Approve</button><button type="button" class="btn ghost" data-prnno="${esc(w.key)}">Refuse</button>` : '') + '</div>').join('') + '</div>';
}

/** One challan for the lines given, to one printer. Returns { err } when refused, else { no }. */
async function flowShMake(v, go, note, fabric) {
  const orders = [...new Set(go.map(l => l.x.r.orderNo))];
  const ch = { no: '', date: dToday(), orderNo: orders.join(', '), orders, vendor: { code: v.code, name: v.desc || v.name || v.code },
    note, at: new Date().toISOString(), by: ME.email || '', from: 'Greige Desk inventory',
    lines: go.map(l => ({ key: l.key, sku: obUC(l.x.r.sku), item: flowChItem(l.x.r), print: l.print,
      /* the ruffle cloth goes once, on the first challan for the line — never when it has a printer of its own */
      extras: l.x.s.fabSent > 0 || flowRufflePrinter(l.x.s.plan) ? [] : flowPrintExtras(l.x.r, l.x.s.plan, flowPoRemOf(l.x.r, l.x.s)),
      fabric: ((l.x.s.plan || {}).fabric || {}).name || fabric, pcs: l.pcs, metres: l.metres })) };
  const err = await flowChallanWrite(ch, v, { isTest: go.every(l => !!l.x.r.__t), unplanned: go.filter(l => !l.printer).map(l => l.key) });
  return err ? { err } : { no: ch.no };
}
/** Make the challan: checks what is ticked, then always asks first (the Review). Nothing is written until "Yes, make the challan". */
async function flowShSave() {
  const S = FLOW_SH; if (!S) return 'The card was closed — open it again.';
  const code = $('flshVen').value, v = flowPrinters().find(p => String(p.code) === String(code));
  if (!v) return 'Which printer is the fabric going to? Pick one.';
  const go = flowShGoing(S, code);
  if (!go.length) return 'Tick at least one line.';
  if (go.some(l => !!l.x.r.__t) && go.some(l => !l.x.r.__t)) return 'A test order and a real one cannot share a challan.';
  S.review = { code, note: $('flshNote').value.trim() };
  /* ASK BEFORE IT GOES (Vishesh, 23 Nov, later the same day: "when I click on make challan it should give a notification that this
   * order will be sent to this vendor"): the Review always opens -- what goes, to whom, and what waits for a change of printer. */
  setTimeout(flowShReviewOpen, 0);   // the card closes when this returns; the Review opens on the next tick
  return '';
}
/** "Show this change at last": what goes now, and what waits for approval, before anything is saved. */
function flowShReviewOpen() {
  const S = FLOW_SH; if (!S || !S.review) return;
  const { code } = S.review, v = flowPrinters().find(p => String(p.code) === String(code)) || {}, vname = v.desc || v.name || code;
  const go = flowShGoing(S, code), now = go.filter(l => !flowShMoving(l, code)), moving = go.filter(l => flowShMoving(l, code));
  const cell = 'padding:4px 8px;text-align:left', th = h => `<th style="${cell}">${h}</th>`;
  const rows = (ls, mid) => ls.map(l => `<tr><td style="${cell}"><b>${esc(obUC(l.x.r.sku))}</b></td><td style="${cell}">${esc(l.x.r.orderNo)}</td>${mid(l)}<td class="num">${nf(l.pcs)}</td><td class="num">${nf(l.metres)}</td></tr>`).join('');
  const total = ls => `<tr><td colspan="2" style="${cell}"><b>Total</b></td><td class="num"><b>${nf(ls.reduce((a, l) => a + l.pcs, 0))}</b></td><td class="num"><b>${nf(flowR2(ls.reduce((a, l) => a + l.metres, 0)))}</b></td></tr>`;
  const goes = now.length ? `<table class="xl" style="width:100%"><thead><tr>${th('SKU')}${th('Order')}<th>Pcs</th><th>Metres</th></tr></thead><tbody>${rows(now, () => '')}${total(now)}</tbody></table>` : '<div class="muted">Nothing goes now.</div>';
  const waits = moving.length ? `<table class="xl" style="width:100%"><thead><tr>${th('SKU')}${th('Order')}${th('Printer')}<th>Pcs</th><th>Metres</th></tr></thead><tbody>${rows(moving, l => `<td style="${cell}">${esc(l.printerName || l.printer)} → ${esc(vname)}</td>`)}</tbody></table>
      <div class="muted" style="font-size:12px;margin-top:6px">Approved by Ravi or anyone with 'Approve a change of printer'. Once approved, the plan and its print order move and a challan is made for it.</div>` : '<div class="muted">Nothing waits.</div>';
  const metres = flowR2(now.reduce((a, l) => a + l.metres, 0));
  const transit = now.length ? `<div class="muted" style="font-size:12px;margin-top:6px">${nf(metres)} m leaves RFD on shelf and shows as in transit until ${esc(vname)} presses "Cloth received" in their portal.</div>` : '';
  ptOpenDialog({
    title: `Send this cloth to ${vname}?`, subtitle: `${S.fabric} · challan dated ${dToday()}. Nothing is saved until you press "Yes, make the challan".`, wide: true,
    html: `<div style="font-weight:700;margin:4px 0">Goes now</div>${goes}${transit}${moving.length ? `<div style="font-weight:700;margin:14px 0 4px">Waits for approval — change of printer</div>${waits}` : ''}`,
    saveLabel: now.length ? 'Yes, make the challan' : 'Yes, ask for approval', onSave: flowShCommit,
    alt: { label: 'Go back', run: async () => { setTimeout(() => flowShelfChallanShow(S.fabric, S.after, S), 0); return ''; } },
  });
}
/** Confirm: the challan for the lines that go now, a waiting request for each line that moves. What it did is in flowShCommit.said. */
async function flowShCommit() {
  const S = FLOW_SH; if (!S || !S.review) return 'The card was closed — open it again.';
  const { code, note } = S.review, v = flowPrinters().find(p => String(p.code) === String(code)); if (!v) return 'Which printer is the fabric going to? Pick one.';
  const go = flowShGoing(S, code), now = go.filter(l => !flowShMoving(l, code)), moving = go.filter(l => flowShMoving(l, code));
  let no = '', err = '';
  if (now.length) {
    const made = await flowShMake(v, now, note, S.fabric); if (made.err) return made.err;
    no = made.no; err = flowChallanPrint(no);
  }
  const asked = []; for (const l of moving) asked.push(await flowShAsk(l, v));
  FLOW_SH = null;
  flowShCommit.said = (no ? [`Challan ${no} made.`] : []).concat(asked).join(' ');
  if (typeof S.after === 'function') setTimeout(() => S.after(no, [err, asked.join(' ')].filter(Boolean).join(' ')), 0);
  return '';
}
/** One waiting request for a line that moves; a line that already waits is left as it is. Returns what to say. */
async function flowShAsk(l, v) {
  const sku = obUC(l.x.r.sku), open = flowPrnReq(l.key);
  if (open && open.status === 'waiting') return `${sku} already waits for approval.`;
  const pl = (l.x.s.plan && l.x.s.plan.printer) || {};
  const req = { status: 'waiting', to: { code: String(v.code), name: v.desc || v.name || v.code }, from: { code: String(pl.code || ''), name: pl.name || '' }, fabric: ((l.x.s.plan || {}).fabric || {}).name || '',
    pcs: l.pcs, metres: l.metres, orderNo: l.x.r.orderNo, sku, by: ME.email || '', at: new Date().toISOString() };
  const er = await flowPrnSet(l.key, open, req);
  return er === 'changed' ? `${sku} already waits for approval.` : er ? `${sku}: ${er}` : `${sku} waits for approval to ${req.to.name}.`;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', async e => {
  const t = e.target && e.target.closest && e.target.closest('[data-prnok],[data-prnno]'); if (!FLOW_SH || !t) return;
  const approve = !!t.dataset.prnok, key = t.dataset.prnok || t.dataset.prnno;
  let why = '';
  if (!approve) { why = typeof prompt === 'function' ? prompt('Why is this change of printer refused? (the person who asked will see it)', '') : ''; if (why === null) return; }
  const er = approve ? await flowPrnApprove(key) : await flowPrnRefuse(key, String(why).trim());
  const S = FLOW_SH; if (!S) return;
  S.lines = flowShLines(S.fabric);
  flowShDraw();
  ptDlgMsg(er || (approve ? flowPrnApprove.said : 'Refused — the line stays with the printer PPC gave it.'), !!er);
  if (approve && !er && typeof S.after === 'function') setTimeout(() => S.after(flowPrnApprove.no, ''), 0);
});
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('change', e => {
  const t = e.target; if (!FLOW_SH || !t || !t.closest || !t.closest('#flshVen,#flshBy,#flshPick,[data-shk]')) return;
  if (t.id === 'flshVen') flowShTickFor(FLOW_SH, t.value);   // a new printer: its own lines, ticked
  if (t.id === 'flshBy') { FLOW_SH.by = t.value === 'print' ? 'print' : 'order'; FLOW_SH.pick = ''; }
  if (t.id === 'flshPick') FLOW_SH.pick = t.value;
  if (t.dataset && t.dataset.shk) { if (t.checked) FLOW_SH.tick.add(t.dataset.shk); else FLOW_SH.tick.delete(t.dataset.shk); }
  flowShDraw();
});
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-shmore]'); if (!FLOW_SH || !t) return;
  FLOW_SH.more = t.dataset.shmore === '1'; flowShDraw();
});

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
