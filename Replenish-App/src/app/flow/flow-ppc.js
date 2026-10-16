/* ================= PRODUCTION FLOW · PPC — the plan for a line =================
 * What PPC raises for each order line: the fabric (which, how many metres), the accessories (zippers by their code,
 * which is what Demand reserves), whether it is printed, and the planned dates. Worked out from what the app already
 * knows — cloth per piece (ptConsPlan), the recipe, the print rules, the Job Work materials planner — and shown for PPC
 * to check and change before saving. Saving IS raising: the line leaves PPC for Demand by itself.
 *   pt_ppc/<line> = { orderNo, sku, qty, route (inhouse|stitch|outsource), outVendor, fabric:{name, perPc, metres, how}, extra:[{what, qty, unit}],
 *                     acc:[{code, what, qty}], print:{need, as}, dates:{cut, qc, ready}, note, at, by } */

const flowR2 = n => Math.round((+n || 0) * 100) / 100;
const flowAddDays = (iso, n) => { const d = new Date((iso || dToday()) + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

/** The plan the app would raise for this line, from the recipe and the rules. Nothing invented: what is not known is
 *  left blank and named in `gaps`. */
function flowSuggest(r) {
  const m = cutSkuOf(r.sku) || {}, qty = +r.qty || 0, gaps = [];
  /* Fabric: THE MASTER ROW first (Ravi, 10 Oct: "fetch the data correctly from the master data") — its fabric and its
   * consumption. Only where the master row leaves them blank: cloth per piece (widths, panels), then the recipe. */
  let fabric = { name: '', perPc: 0, metres: 0, how: '' };
  let cons = null;
  const mFab = String(m.fabric || '').trim(), mCons = +m.consumption || 0;
  if (mFab && mCons > 0) fabric = { name: mFab, perPc: flowR2(mCons), metres: flowR2(mCons * qty), how: 'master data' };
  else { try { cons = ptConsPlan(m); } catch (e) { cons = null; } }
  if (fabric.how) { /* from the master row */ }
  else if (cons && cons.metres > 0) fabric = { name: mFab || cons.fabric || '', perPc: flowR2(cons.metres), metres: flowR2(cons.metres * qty), how: 'cloth per piece (no consumption on the master row)' };
  else {
    const per = +(recipeValue(m, 'consumption') || 0), name = recipeValue(m, 'fabric') || m.fabric || '';
    fabric = { name, perPc: flowR2(per), metres: flowR2(per * qty), how: per ? 'recipe consumption' : '' };
    if (!per) gaps.push('no cloth per piece or consumption for this SKU' + (cons && cons.why ? ' (' + cons.why + ')' : ''));
  }
  /* Accessories that come off the accessories shelf (zippers, by code) — and other materials, which do not. */
  const acc = [], extra = [];
  (bdMaterialsFor(r.sku, qty) || []).forEach(x => {
    if (x.why) { gaps.push(x.why); return; }
    if (x.kind === 'zip') acc.push({ code: accCode(m.chainLength), what: x.what, qty: x.qty });
    else extra.push({ what: (x.kind === 'ruffle' ? 'Ruffle — ' : '') + x.what, qty: x.qty, unit: x.unit });
  });
  if (recipeValue(m, 'isPiping') === true) {
    const pm = +(recipeValue(m, 'pipingMeters') || 0);
    if (pm) extra.push({ what: 'Piping', qty: flowR2(pm * qty), unit: 'm' }); else gaps.push('piping SKU with no piping metres in its recipe');
  }
  if (recipeValue(m, 'fillerFabricRequired') === true) {
    const fq = +(recipeValue(m, 'standardFillingQty') || 0);
    if (fq) extra.push({ what: 'Filler', qty: flowR2(fq * qty), unit: '' }); else gaps.push('filler SKU with no standard filling quantity in its recipe');
  }
  let need = true, as = '';
  try { need = !!ptPrintNeeded(m); as = ptPrintIssueAs(m) || ''; } catch (e) { /* no print rules loaded: printed, as the rules default */ }
  const t = dToday();
  let printer = { code: '', name: '', why: '' };
  if (need) try { printer = flowPrinterFor(r); } catch (e) { /* no planning read yet */ }
  return { orderNo: r.orderNo, sku: obUC(r.sku), qty, route: need ? 'inhouse' : 'stitch', outVendor: '', printer, fabric, acc, extra, print: { need, as },
    dates: { cut: flowAddDays(t, 3), qc: flowAddDays(t, 7), ready: ptIsoDate(r.mtoDue) || flowAddDays(t, 10) }, note: '', gaps };
}
/* A SAVED PLAN THAT NO LONGER MATCHES THE MASTER ROW (Ravi, 10 Oct: "it is only showing Sheeting 82 — is it canvas or
 * what?"). Plans saved before the fabric came from the master row keep what they were saved with; that is never
 * hidden — the master row's fabric and m/pc are shown beside it, in red, with a way to take them. */
function flowMasterDiff(r, p) {
  const m = cutSkuOf(r.sku) || {}, mf = String(m.fabric || '').trim(), mc = +m.consumption || 0;
  if (!p || !p.fabric || flowRouteOf(p) === 'outsource' || !mf) return null;
  const nameOff = flowFabKey(p.fabric.name) !== flowFabKey(mf), perOff = mc > 0 && Math.abs((+p.fabric.perPc || 0) - mc) > 0.005;
  return nameOff || perOff ? { name: mf, perPc: mc, metres: flowR2(mc * (+r.qty || 0)) } : null;
}
const flowMasterDiffTxt = d => d ? `<div style="font-size:11px;color:#b91c1c;font-weight:600">⚑ master data says ${esc(d.name)}${d.perPc ? ` · ${nf(d.perPc)} m/pc → ${nf(d.metres)} m` : ''}</div>` : '';

/** The print direction offered for a line: the directions its fabric is made in (none for Canvas / Cambric). */
function flowDirOpts(r, p) {
  const m = cutSkuOf(r.sku) || {}, fab = String((p.fabric && p.fabric.name) || m.fabric || '').trim();
  /* Cutting required: no → the SKU itself is printed; no printed cloth, so no direction to ask (Ravi, 10 Oct). */
  if (m.cuttingRequired === false) return { dirs: [], cur: '' };
  const dirs = flowFabDirs(fab, String(m.color || r.color || '').trim(), ordColCodeOf(r.sku));
  const cur = (p.print && p.print.dir) || flowDirDefault(m, fab) || (dirs.length === 1 ? dirs[0] : '');
  return { dirs, cur };
}

/* ---- STOCK SEEN FROM PPC (Ravi, 10 Oct: "yahan current stock visibility show ho … 100 in stock, an earlier order of 40
 * → this order sees 60 available") — shown only, never written ----
 * What the plans of OTHER lines already take, still unused:
 *   accessories  plan qty × the share of that line not yet issued (the zipper leaves the shelf at issue)
 *   fabric (RFD) plan metres, until the line's cloth moves (cut, issued, or back from the printer / given without a challan)
 *   ruffle cloth plan metres until issued (taken off the RFD register at issue, ptConsumeRuffle)
 * Lines in the form itself count in their order, each after the ones above it. */
function flowCommitted(skipKeys, withTest) {
  const skip = new Set(skipKeys || []), acc = {}, fab = {}, extra = {}, printed = {};
  flowRows().forEach(({ r, s }) => {
    const p = s.plan; if (!p || skip.has(s.key) || s.route === 'outsource' || (r.__t && !withTest)) return;   // a test order never eats a real one's stock
    const qty = +r.qty || 0, left = qty > 0 ? Math.max(0, 1 - s.issued / qty) : 0;
    (p.acc || []).forEach(a => { if (!a.code || !(+a.qty > 0)) return; const c = accCode(a.code); acc[c] = (acc[c] || 0) + Math.ceil(+a.qty * left); });
    const fr = s.demand && s.demand.fabricReady;
    const unmoved = !s.cut && !s.issued && (fr && fr.challan ? !s.back : !s.given);
    /* WHAT AN EARLIER PLAN STILL HAS TO TAKE FROM THE RFD (16 Oct, one rule with flowRfdStock). A printed line: what its
     * challans have not sent yet — what they sent is already off the stock. Cutting straight from RFD: all of it until
     * the line is cut or issued. Job Work and outsourced lines take no RFD. */
    if (p.fabric && p.fabric.name && s.route !== 'jobwork' && !s.cut && !s.issued) {   // cut or issued: its cloth has gone
      const owed = s.route === 'inhouse' ? flowFabOwed({ qty: +r.qty || 0 }, s).metres
        : (fr && !fr.challan && +fr.metres > 0 ? +fr.metres : flowToPrint(r, p).metres);
      if (owed > 0) { const k = flowFabKey(p.fabric.name); fab[k] = flowR2((fab[k] || 0) + owed); }
    }
    (p.extra || []).forEach(x => { if (x.unit !== 'm' || !x.what) return; const k = flowFabKey(String(x.what).replace(/^Ruffle — /, ''));
      extra[k] = flowR2((extra[k] || 0) + Math.max(0, (+x.qty || 0) - (+x.fromPrinted || 0)) * left); });
    /* Printed stock an earlier plan took, until that line's cloth moves — unless the store already took it out at the plan
     * (inventory/store.js, since 16 Oct): then it is off the store's own figure, and holding it here would take it twice. */
    if (unmoved && s.route === 'inhouse' && !(typeof stPlanTookOut === 'function' && stPlanTookOut(p))) {
      const m = cutSkuOf(r.sku) || {}, colour = String(m.color || r.color || '').trim();
      if (+(p.fabric && p.fabric.fromPrinted) > 0) { const k = flowPrintedKey(flowPrintWhat(r, p), p.fabric.name, colour); printed[k] = flowR2((printed[k] || 0) + (+p.fabric.fromPrinted)); }
      (p.extra || []).forEach(x => { if (!(+x.fromPrinted > 0)) return; const k = 'M|' + fabKey(String(x.what).replace(/^Ruffle — /, '')) + '|' + fabKey(colour); printed[k] = flowR2((printed[k] || 0) + (+x.fromPrinted)); });
    }
  });
  return { acc, fab, extra, printed };
}
/* STORE STOCK BELONGS TO THE EARLIER ORDERS FIRST (Ravi, 11 Oct: "store me pahle dikha rahe but wo kisi aur order ke h;
 * yadi store me pahle order se jyada piece pade h tab direct yahan show ho, otherwise ye apne system se aane chahiye").
 * Before a new plan may take printed stock, what the OTHER open lines still need from the store comes off it:
 *   pieces of a SKU (P|SKU)   a line no plan covers: what it has still to issue (qty − issued); a planned line whose
 *                             pieces have moved: what is in the store for it, not yet issued (flowIssuable)
 *   printed cloth (M|…)       a line printed on that cloth + colour and cut from it: what it has still to cut, in metres
 * A planned line that has not moved holds only what its plan took from the store (flowCommitted). Shown, never written. */
function flowStoreHold(pk, skipKeys, withTest) {
  const skip = new Set(skipKeys || []), sku = pk.startsWith('P|') ? pk.slice(2) : '';
  let held = 0;
  flowRows().forEach(({ r, s }) => {
    if (skip.has(s.key) || s.bucket === 'done' || (r.__t && !withTest)) return;
    const p = s.plan, qty = +r.qty || 0;
    if (p && s.route === 'outsource') return;
    const fr = s.demand && s.demand.fabricReady;
    if (p && !s.cut && !s.issued && (fr && fr.challan ? !s.back : !s.given)) return;   // unmoved: its plan's own figure counts
    if (sku) {
      if (obUC(r.sku) !== sku) return;
      held += p ? Math.max(0, flowIssuable(r, s)) : Math.max(0, qty - (s.issuedAll != null ? s.issuedAll : s.issued || 0));
      return;
    }
    if (!r.cutReq) return;
    const m = cutSkuOf(r.sku) || {}, colour = String(m.color || r.color || '').trim();
    if (!pk.endsWith('|' + fabKey(colour))) return;   // cheap test first
    if (!p && typeof ptPrintNeeded === 'function' && !ptPrintNeeded(m)) return;
    const pl = p || flowSuggest(r), fab = (pl.fabric && pl.fabric.name) || '';
    if ('M|' + fabKey(fab) + '|' + fabKey(colour) !== pk) return;
    if (p && (s.route !== 'inhouse' || flowPrintWhat(r, p).kind === 'sku')) return;
    held += Math.max(0, qty - (s.cut || 0)) * (+(pl.fabric && pl.fabric.perPc) || 0);
  });
  return flowR2(held);
}
/** One stock line: in stock · planned for earlier orders · available for this line, and whether it is enough. */
/* NEAT AND CLEAN (Ravi, 10 Oct: "neat and clean information … RFD: the main fabric's requirement and availability …
 * after old orders only the balance … and the printed stock of it"). One small table per line: what it needs, the
 * BALANCE left after every earlier plan, enough or short — the stock and what the earlier plans hold are in the tooltip. */
function flowMatRow(what, need, stock, earlier, unit, known) {
  const bal = flowR2(stock - earlier), ok = bal >= need;
  if (known === 'unread') return `<tr><td style="text-align:left">${what}</td><td class="num">${nf(flowR2(need))}${unit}</td><td class="num">—</td>`
    + `<td style="text-align:left"><span class="pill mute" title="The Greige Desk's stock could not be read on this computer — close the form and press Refresh">stock not read — Refresh</span></td></tr>`;
  const st = !(need > 0) ? '<span class="pill mute">not needed</span>'
    : !known ? '<span class="pill mute">stock not kept in the app</span>'
    : ok ? '<span class="pill ok">✓ enough</span>' : `<span class="pill bad">⚑ short ${nf(flowR2(need - Math.max(0, bal)))}${unit}</span>`;
  const tip = known ? `in stock ${nf(flowR2(stock))}${unit}, already planned for earlier orders / lines above ${nf(flowR2(earlier))}${unit}` : '';
  return `<tr><td style="text-align:left">${what}</td><td class="num">${nf(flowR2(need))}${unit}</td>
    <td class="num" title="${esc(tip)}">${known ? `<b>${nf(flowR2(Math.max(0, bal)))}${unit}</b>` : '—'}</td><td style="text-align:left">${st}</td></tr>`;
}
const flowPrintedKey = (w, fabric, colour) => (w.kind === 'sku' ? 'P|' + obUC(w.code) : 'M|' + fabKey(fabric) + '|' + fabKey(colour));
/** Printed stock in the store (Store Stock Balance): cloth by fabric + colour, pieces by SKU. Null while not read. */
let FLOW_STB = { src: null, map: null };
function flowPrintedStock(w, colour) {
  if (typeof STORE === 'undefined' || !STORE.rows) return null;
  if (FLOW_STB.src !== STORE.rows) { try { FLOW_STB = { src: STORE.rows, map: new Map(stBalances(stMoves()).map(e => [e.key, e])) }; } catch (e) { return null; } }
  const key = flowPrintedKey(w, w.fabric, colour);
  const e = FLOW_STB.map.get(key); return e ? Math.max(0, +e.qty || 0) : 0;
}
const flowPrintedRow = (label, qty, unit, use, stock, held, above) => `<tr style="background:rgba(124,58,237,.05)"><td style="text-align:left">Printed in store · ${label}${held > 0 || above > 0 ? `<div class="muted" style="font-size:10.5px">in store ${nf(flowR2(stock || 0))}${unit}${held > 0 ? `, ${nf(flowR2(held))}${unit} of it for earlier orders` : ''}${above > 0 ? `, ${nf(flowR2(above))}${unit} taken by the line(s) above` : ''}</div>` : ''}</td><td class="num">${use ? nf(flowR2(use)) + unit : '—'}</td>
  <td class="num"${stock != null ? ` title="in store ${esc(nf(flowR2(stock)))}${unit}${held > 0 ? `, earlier orders still need ${esc(nf(flowR2(held)))}${unit}` : ''}${above > 0 ? `, the lines above in this order take ${esc(nf(flowR2(above)))}${unit}` : ''}"` : ''}>${qty == null ? '<span class="muted">…</span>' : `<b>${nf(flowR2(Math.max(0, qty)))}${unit}</b>`}</td><td style="text-align:left">${use > 0 ? `<span class="pill ok">✓ covers ${nf(flowR2(use))}${unit}</span>`
    : above > 0 && stock > 0 ? '<span class="pill mute">the line above took it — goes to the printer</span>' : held > 0 && stock > 0 ? '<span class="pill mute">all for earlier orders — goes to the printer</span>' : '<span class="pill mute">none in store</span>'}</td></tr>`;
function flowFabKnown(name) {
  if (!flowRfdKnown()) return 'unread';   // the Greige Desk was not read here: the figure would be the old ledger alone
  const k = flowFabKey(name);
  try { if (flowGdState() === 'ok' && GD.rfdOpened && GD.rfdOpened(name)) return true; } catch (e) { /* the ledger decides */ }
  try { return fabAll().some(r => flowFabKey(r.fabricType) === k); } catch (e) { return false; }
}

/* The line card's look — scoped to .fpc, so nothing else in the app changes. */
const FLOW_PPC_CSS = `<style>
.fpc{border:1px solid var(--line);border-radius:14px;margin-bottom:14px;overflow:hidden;background:var(--card)}
.fpc-h{display:flex;gap:12px;align-items:center;padding:10px 14px;background:rgba(148,163,184,.09);border-bottom:1px solid var(--line)}
.fpc-h img,.fpc-noimg{width:52px;height:52px;object-fit:contain;border-radius:10px;background:#fff;border:1px solid var(--line);flex:none}
.fpc-t{flex:1;min-width:0}.fpc-sku{font-family:ui-monospace,monospace;font-size:14.5px}
.fpc-qty{margin-left:8px;background:rgba(79,70,229,.12);color:#4338ca;border-radius:999px;padding:1px 10px;font-weight:700;font-size:12.5px}
.fpc-sub{color:var(--muted,#64748b);font-size:12px;margin-top:3px}
.fpc-chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.fpc-chip{border-radius:999px;padding:3px 11px;font-size:11.5px;font-weight:600;background:rgba(148,163,184,.18);white-space:nowrap}
.fpc-chip.ok{background:rgba(22,163,74,.14);color:#166534}.fpc-chip.bad{background:rgba(220,38,38,.12);color:#b91c1c}.fpc-chip.vio{background:rgba(124,58,237,.12);color:#5b21b6}
.fpc-b{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:4px 22px;padding:12px 14px 14px}
.fpc-col{min-width:0}
.fpc-sec{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#64748b);margin:12px 0 6px}
.fpc-col>.fpc-sec:first-child{margin-top:2px}.fpc-sec small{text-transform:none;letter-spacing:0;font-weight:500;margin-left:6px}
.fpc-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px}
.fpc-f{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--muted,#64748b);margin:0;min-width:0}
.fpc-f input,.fpc-f select{width:100%;padding:6px 9px;font-size:12.5px;color:var(--ink,inherit)}
.fpc-f.w2{grid-column:span 2}.fpc-f.w3{grid-column:1/-1}
.fpc-tot{font-size:13.5px;padding:6px 0;color:var(--ink,inherit)}.fpc-tot small{color:var(--muted,#64748b);font-size:11px;margin-left:4px}
.fpc-why{font-size:10.5px;color:var(--muted,#94a3b8)}
.fpc-pget{background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.22);border-radius:10px;padding:8px 11px;font-size:12px;color:#4338ca;min-height:18px}
.fpc-mat{width:100%}.fpc table.fpc-mat td,.fpc table.fpc-mat th{padding:6px 8px;font-size:12px !important}
.fpc-mode{display:inline-block;background:rgba(124,58,237,.14);color:#5b21b6;border-radius:6px;padding:0 7px;font-weight:700;font-size:11px;margin-right:4px}
.fpc-pget>div{margin-top:3px}
.fpc .pill{display:inline-block;border-radius:999px;padding:1px 10px;font-weight:600;font-size:11.5px}
.fpc .pill.ok{background:rgba(22,163,74,.14);color:#166534}.fpc .pill.bad{background:rgba(220,38,38,.12);color:#b91c1c}.fpc .pill.mute{background:rgba(148,163,184,.18);color:var(--muted,#64748b)}
.fpc-gaps{font-size:11.5px;color:#92400e;margin-top:8px}
</style>`;

/* THE ORDER, COMBINED (Ravi, 11 Oct: "jitna store me pahle order me consume hone ke bad bacha fabric is order me use karne ke
 * bad jo printing se required rahega uska demand dono SKU ke order ka combine karke, jahan jahan demand generate ho"). Under
 * the lines of one PO: what goes to each printer once the store has given what it can, one row per printed fabric / SKU
 * across the lines; the RFD cloth and the accessories the whole order needs against the balance after earlier orders. The
 * print order, its challans and the Vendor Order carry the same totals (flowChPrintGroups, flowVoLines). */
function flowComboPaint(combo, run, com, names, shelf) {
  const box = document.querySelector('[data-combo]'); if (!box) return;
  const byPr = new Map(); combo.forEach(it => { const k = it.printer || ''; byPr.set(k, (byPr.get(k) || []).concat([it])); });
  let vens = []; try { vens = flowChVendors(); } catch (e) { vens = []; }
  const prName = c => { const v = vens.find(x => String(x.code) === String(c)); return v ? (v.desc || v.name || v.code) : (c || 'printer not chosen'); };
  const q = g => g.kind === 'sku' ? nf(g.pcs) + ' pcs' : nf(flowR2(g.metres)) + ' m';
  const prints = [...byPr.entries()].map(([pc, items]) => flowChPrintGroups({ lines: items }).filter(g => (g.kind === 'sku' ? g.pcs : g.metres) > 0)
    .map(g => `<tr><td style="text-align:left"><span class="fpc-mode">${esc(g.mode || '')}</span> <b>${esc(g.code || 'fabric SKU to be confirmed')}</b> <span class="muted">${esc(g.label || '')}</span></td>
      <td class="num"><b>${q(g)}</b></td><td style="text-align:left">🖨 ${esc(prName(pc))}</td></tr>`).join('')).join('');
  const mats = [];
  Object.entries(run.fab).forEach(([k, need]) => { if (need > 0) mats.push(flowMatRow(`RFD · <b>${esc(names['f|' + k] || k)}</b>`, need, flowRfdStock(names['f|' + k] || k), com.fab[k] || 0, ' m', flowFabKnown(names['f|' + k] || k))); });
  Object.entries(run.extra).forEach(([k, need]) => { if (need > 0 && names['x|' + k]) mats.push(flowMatRow(`RFD · <b>${esc(names['x|' + k])}</b> <span class="muted">(ruffle)</span>`, need, flowRfdStock(names['x|' + k]), com.extra[k] || 0, ' m', flowFabKnown(names['x|' + k]))); });
  Object.entries(run.acc).forEach(([c, need]) => { if (need > 0) mats.push(flowMatRow(`${esc(names['a|' + c] || c)} <span class="muted">(code ${esc(c)})</span>`, need, shelf[c] || 0, com.acc[c] || 0, '', c in shelf)); });
  box.innerHTML = `<div class="fpc-sec" style="margin-top:0">This order, combined <small>all its lines together — after what the store gives</small></div>
    <div class="fpc-b" style="padding:0">
      <div class="fpc-col"><div class="fpc-sec">To print</div><table class="xl fpc-mat"><thead><tr><th style="text-align:left">Printed fabric / SKU</th><th>To print</th><th style="text-align:left">Printer</th></tr></thead>
        <tbody>${prints || '<tr><td colspan="3" class="muted" style="text-align:left">nothing to print — all from printed stock</td></tr>'}</tbody></table></div>
      <div class="fpc-col"><div class="fpc-sec">RFD fabric &amp; accessories</div><table class="xl fpc-mat"><thead><tr><th style="text-align:left">Item</th><th>Needs</th><th>Balance</th><th></th></tr></thead>
        <tbody>${mats.join('') || '<tr><td colspan="4" class="muted" style="text-align:left">nothing</td></tr>'}</tbody></table></div></div>`;
}
/** The printers to pick from, the chosen one selected. */
function flowPrinterOpts(code) {
  let vens = []; try { vens = flowChVendors(); } catch (e) { vens = []; }
  return vens.filter(v => /print/i.test(String(v.category || ''))).map(v => `<option value="${esc(v.code)}"${String(v.code) === String(code || '') ? ' selected' : ''}>${esc(v.desc || v.name || v.code)}</option>`).join('');
}
/** PPC's form for every line of one PO that is still in PPC (or one line). */
/* ---- DRAFTS (Ravi, 15 Oct: "mera PO bahut bada h and mene working kar liya aadha but by mistake window cut ho gyi to isme
 * save as draft ka option and auto save bhi") ----
 * What is typed in the PPC form is kept on this computer as it is typed (auto-save), and "Save as draft" keeps it and
 * closes the form. Opening the same lines again puts it all back. Kept per line (its flow key), so a PO opened whole, one
 * line, or combined with another order finds the same draft. Raising the plan clears it; a draft older than 14 days is
 * dropped. localStorage ppcDraft = { <line key>: { at, by, v: { <box>: value } } }. Nothing goes to the database. */
const FLOW_DRAFT_LS = 'ppcDraft', FLOW_DRAFT_DAYS = 14;
/* Read once per change of what is stored: the PPC list asks for every one of up to 800 lines. A copy is handed out, so a
 * caller changing it never changes the cache. */
let FLOW_DRAFT_C = { raw: null, d: {} };
function flowPpcDrafts() {
  let raw = ''; try { raw = localStorage.getItem(FLOW_DRAFT_LS) || ''; } catch (e) { raw = ''; }
  if (raw !== FLOW_DRAFT_C.raw) {
    let d = {}; try { d = JSON.parse(raw || '{}') || {}; } catch (e) { d = {}; }
    const old = new Date(Date.now() - FLOW_DRAFT_DAYS * 864e5).toISOString();
    Object.keys(d).forEach(k => { if (!d[k] || String(d[k].at || '') < old) delete d[k]; });
    FLOW_DRAFT_C = { raw, d };
  }
  return Object.assign({}, FLOW_DRAFT_C.d);
}
const flowPpcHasDraftC = key => { flowPpcDrafts(); return !!FLOW_DRAFT_C.d[key]; };
function flowPpcDraftsPut(d) { try { localStorage.setItem(FLOW_DRAFT_LS, JSON.stringify(d)); return true; } catch (e) { return false; } }
/** Is a draft kept for this line? (the PPC list says so) */
const flowPpcHasDraft = key => flowPpcHasDraftC(key);
/** Every box of the open form, line by line, into the drafts. Returns when it was saved, '' if it could not be. */
function flowPpcDraftSave(keys) {
  const d = flowPpcDrafts(), at = new Date().toISOString(), v = {};
  document.querySelectorAll('[data-fp]').forEach(inp => { const i = +inp.dataset.fp; if (!keys[i] || inp.disabled) return;
    (v[i] = v[i] || {})[inp.dataset.k] = inp.type === 'checkbox' ? !!inp.checked : String(inp.value == null ? '' : inp.value); });
  Object.entries(v).forEach(([i, vals]) => { d[keys[i]] = { at, by: ME.email || '', v: vals }; });
  return flowPpcDraftsPut(d) ? at : '';
}
let FLOW_DRAFT_T = null;
function flowPpcDraftSoon(keys, say) { clearTimeout(FLOW_DRAFT_T); FLOW_DRAFT_T = setTimeout(() => { const at = flowPpcDraftSave(keys); if (say) say(at); }, 600); }
/** Put a kept draft back into the boxes. Returns the newest time restored, '' when there was none. */
function flowPpcDraftApply(keys) {
  const d = flowPpcDrafts(); let at = '';
  keys.forEach((key, i) => { const x = d[key]; if (!x || !x.v) return;
    Object.entries(x.v).forEach(([k, val]) => { const el = document.querySelector(`[data-fp="${i}"][data-k="${k}"]`); if (!el || el.disabled) return;
      if (el.type === 'checkbox') el.checked = !!val; else el.value = val; });
    if (String(x.at) > at) at = String(x.at); });
  return at;
}
function flowPpcDraftDrop(keys) { const d = flowPpcDrafts(); keys.forEach(k => { delete d[k]; }); flowPpcDraftsPut(d); }
const flowDraftWhen = at => { const t = new Date(at); return isNaN(t) ? '' : t.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

/* RFD stock comes from the Greige Desk's count (flowRfdStock). Where this computer could not read the desk, the figure
 * is the old ledger alone — which reads 0 for most fabrics now — so the form says so rather than show a false "short". */
const flowGdNote = () => { const st = flowGdState();
  return st === 'ok' || st === 'none' ? '' : `<div style="font-size:11.5px;color:#b45309;margin:2px 0 6px">⚠ The Greige Desk's RFD stock ${st ? 'could not be read on this computer' : 'is being read'} — the RFD figures wait for it${st ? '; trying again…' : '…'}</div>`; };

function flowPpcOpen(orderNo, onlySku, keys) {
  /* SAME SKU, SAME DAY, ONE PLAN (Ravi, 15 Oct: "1 SKU ka same day order aay to wo sare order combine hokar dikhe PPC team
   * ko"): `keys` names lines of several orders, planned in one go — each keeps its own plan, its own print order. */
  const rows = flowRows().filter(x => keys && keys.length ? keys.includes(x.s.key) && x.s.bucket === 'ppc'
    : x.r.orderNo === orderNo && (onlySku ? obUC(x.r.sku) === obUC(onlySku) : x.s.bucket === 'ppc'));
  if (!rows.length) return;
  if (keys && keys.length) orderNo = [...new Set(rows.map(x => x.r.orderNo))].join(', ');
  /* AN OLD PLAN OPENS ON THE MASTER DATA (Ravi, 10 Oct: "main fabric galat select kar raha h"). Plans saved before the
   * fabric came from the master row carry the width calculator's answer (RPC327-1818: Sheeting 82 · 0.13 m/pc, where the
   * master row says Canvas · 0.53). Unless PPC typed that fabric on purpose, the form opens with the master row's and
   * says what the old plan had. A line whose fabric is already on a challan keeps it. */
  const plans = rows.map(x => {
    const p = Object.assign(flowSuggest(x.r), x.s.plan ? JSON.parse(JSON.stringify(x.s.plan)) : {});
    const d = x.s.plan && !flowFabLocked(x.s) && p.fabric && p.fabric.how !== 'typed by PPC' ? flowMasterDiff(x.r, p) : null;
    if (d) p.fabric = { name: d.name, perPc: d.perPc, metres: d.metres, how: 'master data', was: `${p.fabric.name || '?'} · ${nf(p.fabric.perPc)} m/pc` };
    return p;
  });
  /* THE LINE CARD (Ravi, 10 Oct: "need more design"). A header with what the line is and, as chips, how it is made,
   * the printer and whether everything is there; then two columns — the plan on the left, what it needs and what is in
   * stock on the right — and the dates last. Every box keeps its data-fp / data-k, so saving is unchanged. */
  const inp = (i, k, v, type, extra) => `<input data-fp="${i}" data-k="${k}" ${type ? `type="${type}"` : ''} ${type === 'number' ? 'step="0.01"' : ''} value="${esc(v == null ? '' : v)}"${extra || ''}>`;
  const fld = (label, inner, cls) => `<label class="fpc-f${cls ? ' ' + cls : ''}"><span>${label}</span>${inner}</label>`;
  const html = FLOW_PPC_CSS + plans.map((p, i) => {
    const r = rows[i].r, img = (typeof ptImgOf === 'function' && ptImgOf(r.sku)) || '';
    const d = flowDirOpts(r, p), md = flowMasterDiff(r, p);
    return `<div class="fpc">
      <div class="fpc-h">
        ${img ? `<img src="${esc(ptImgSrc ? ptImgSrc(img, 52) : img)}" alt="">` : '<div class="fpc-noimg"></div>'}
        <div class="fpc-t"><div><b class="fpc-sku">${esc(p.sku)}</b><span class="fpc-qty">${nf(p.qty)} pcs</span></div>
          <div class="fpc-sub">${esc([r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · '))}</div></div>
        <div class="fpc-chips" data-chips="${i}"></div>
      </div>
      <div class="fpc-b">
        <div class="fpc-col">
          <div class="fpc-sec">Fabric</div>
          <div class="fpc-g">
            ${fld('Fabric', inp(i, 'fabric.name', p.fabric.name))}
            ${fld('Metres / piece', inp(i, 'fabric.perPc', p.fabric.perPc, 'number'))}
            ${fld('Total for ' + nf(p.qty) + ' pcs', `<div class="fpc-tot"><b data-fm="${i}">${nf(p.fabric.metres)}</b> m <small>${esc(p.fabric.how || 'not known — type it')}</small>${p.fabric.was ? `<div style="font-size:10.5px;color:#b45309">old plan had ${esc(p.fabric.was)}</div>` : ''}</div>`)}
          </div>
          ${md ? flowMasterDiffTxt(md).replace('</div>', ` <button type="button" class="ghost" data-usem="${i}" data-n="${esc(md.name)}" data-p="${md.perPc}" style="width:auto;padding:1px 8px;font-size:11px">Use the master data</button></div>`) : ''}
          <div class="fpc-sec">Printing</div>
          <div class="fpc-g">
            ${fld('How it is made', `<select data-fp="${i}" data-k="route">${FLOW_ROUTES.map(([k, l]) => `<option value="${k}"${flowRouteOf(p) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`, 'w2')}
            ${d.dirs.length > 1 ? fld('Print direction', `<select data-fp="${i}" data-k="print.dir"><option value="">— pick —</option>${d.dirs.map(x => `<option${x === d.cur ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`) : ''}
            ${fld('Printer', `<select data-fp="${i}" data-k="printer.code"><option value="">— PPC decides —</option>${flowPrinterOpts((p.printer || {}).code)}</select>`
              + `<small class="fpc-why">${esc((p.printer || {}).why || '')}</small>`, 'w2')}
            ${(p.extra || []).some(x => /^Ruffle — /.test(String(x.what || ''))) ? fld('Ruffle printer', `<select data-fp="${i}" data-k="rufflePrinter.code"><option value="">— same as the printer —</option>${flowPrinterOpts((flowRufflePrinter(p) || {}).code)}</select>`
              + '<small class="fpc-why">the ruffle cloth can go to another printer — its own print order and challan</small>', 'w2') : ''}
            ${fld('Outsource vendor', inp(i, 'outVendor', p.outVendor || '', '', ' placeholder="who makes it"') + '<small class="fpc-why">no fabric or accessories are raised for it</small>', 'w2" data-outrow="' + i)}
          </div>
          ${(p.acc || []).length ? `<div class="fpc-sec">Accessories</div><div class="fpc-g">${p.acc.map((a, j) => fld(`${esc(a.what)} <small>code ${esc(a.code)}</small>`, inp(i, 'acc.' + j + '.qty', a.qty, 'number'))).join('')}</div>` : ''}
          <div class="fpc-sec">Planned dates</div>
          <div class="fpc-g">
            ${fld('Cut', inp(i, 'dates.cut', p.dates.cut, 'date'))}${fld('QC', inp(i, 'dates.qc', p.dates.qc, 'date'))}${fld('Ready', inp(i, 'dates.ready', p.dates.ready, 'date'))}
            ${fld('Note', inp(i, 'note', p.note), 'w3')}
          </div>
        </div>
        <div class="fpc-col">
          <div class="fpc-sec">The printer gets</div>
          <div class="fpc-pget" data-pget="${i}"></div>
          <div class="fpc-sec">Requirement &amp; stock <small>balance = what is left after every earlier plan</small></div><div data-gdnote>${flowGdNote()}</div>
          <table class="xl fpc-mat"><thead><tr><th style="text-align:left">Item</th><th>Needs</th><th title="what is left after every earlier plan">Balance</th><th></th></tr></thead><tbody data-mat="${i}"></tbody></table>
          ${(p.gaps || []).length ? `<div class="fpc-gaps">• ${p.gaps.map(esc).join('<br>• ')}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  /* EDITING A PLAN ALREADY RAISED (flow-edit.js): the same form, plus "undo — back to PPC"; a line whose fabric is on a
   * challan keeps its fabric, route and printer. */
  const editing = rows.length === 1 && !!rows[0].s.plan, locked = editing && flowFabLocked(rows[0].s);
  ptOpenDialog({
    title: editing ? `Edit plan — ${orderNo} · ${obUC(rows[0].r.sku)}` : `PPC — ${orderNo}`,
    subtitle: editing ? `Change what was planned and save; the line moves to wherever it now belongs.${locked ? ` Its fabric is on challan ${rows[0].s.challan.no}: fabric, route and printer stay as they are until that challan is cancelled (Demand history).` : ''}`
      : `${nf(rows.length)} line(s). Worked out from cloth per piece, the recipe and the print rules — check, change, save. Saving raises it: the line moves on to Demand by itself.`,
    html: `<div id="flpDraft" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 10px;font-size:12.5px"><span id="flpDraftSay" class="muted">Auto-save is on: what you type is kept on this computer.</span>`
      + `<button type="button" id="flpDraftBtn" class="ghost" style="width:auto;padding:3px 12px;font-size:12.5px">Save as draft</button>`
      + `<a href="#" id="flpDraftDrop" style="font-size:12px;color:#b91c1c;display:none">Discard draft</a></div>`
      + html + (rows.length > 1 ? '<div class="fpc" data-combo style="padding:12px 14px"></div>' : '') + (editing ? `<label style="display:flex;gap:6px;align-items:center;margin-top:4px;color:#b91c1c"><input id="flpUndo" type="checkbox" style="width:auto"${locked ? ' disabled' : ''}> Undo this plan — send the line back to PPC (its fabric-ready and reservation go too)${locked ? ' · not while its fabric is on a challan' : ''}</label>` : ''),
    wide: true,
    saveLabel: editing ? 'Save the plan' : rows.length > 1 ? `Raise the plan for ${rows.length} lines` : 'Raise the plan',
    onSave: async () => {
      if (editing && $('flpUndo') && $('flpUndo').checked) { const er = await flowUnplan(rows[0].s); if (er) return er; flowPpcDraftDrop(rows.map(x => x.s.key)); renderFlow(); return ''; }
      /* A box's value into the plan; a part the plan has lost (a refused save can leave printer null) is made again. */
      const set = (o, path, v) => { const ks = path.split('.'); let t = o; ks.slice(0, -1).forEach(k => { const kk = /^\d+$/.test(k) ? +k : k; if (t[kk] == null) t[kk] = {}; t = t[kk]; }); t[ks[ks.length - 1]] = v; };
      document.querySelectorAll('[data-fp]').forEach(inp => {
        const p = plans[+inp.dataset.fp], k = inp.dataset.k;
        set(p, k, inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (+inp.value || 0) : inp.value.trim());
      });
      /* The route decides printing; an outsourced line raises no cloth and no accessories, and must name who makes it. */
      plans.forEach(p => { p.route = p.route || 'inhouse'; p.print = Object.assign({}, p.print, { need: p.route === 'inhouse' });
        /* The printer is kept by code and name; a line not printed has none. */
        const v = p.route === 'inhouse' && p.printer && p.printer.code ? flowChVendors().find(x => String(x.code) === String(p.printer.code)) : null;
        p.printer = v ? { code: v.code, name: v.desc || v.name || v.code, why: p.printer.why || '' } : null;
        const rv = p.route === 'inhouse' && p.rufflePrinter && p.rufflePrinter.code ? flowChVendors().find(x => String(x.code) === String(p.rufflePrinter.code)) : null;
        p.rufflePrinter = rv && (!p.printer || String(rv.code) !== String(p.printer.code)) ? { code: rv.code, name: rv.desc || rv.name || rv.code } : null; });
      /* A printed line on a fabric made both ways must say which way — the printer cannot print "either". */
      const noDir = plans.filter((p, i) => p.route === 'inhouse' && flowPrintWhat(rows[i].r, p).needDir).map(p => p.sku);
      if (noDir.length) return `Which way is it printed? Pick the print direction for ${noDir.join(', ')}.`;
      /* The print order goes to the printer now — so a printed line has to say which printer. */
      /* What still goes to a printer once printed stock is taken: the body not covered, or a ruffle cloth not covered. */
      const printsAt = (i, which) => { const c = cover[i] || { fab: 0, unit: 'm', extra: {} }, p = plans[i], qty = +p.qty || 0, m = flowR2((+p.fabric.perPc || 0) * qty);
        const bodyLeft = c.unit === 'pcs' ? qty - (c.fab || 0) : m - (c.fab || 0);
        const rufLeft = (p.extra || []).some((x, j) => /^Ruffle — /.test(String(x.what || '')) && (+x.qty || 0) - ((c.extra || {})[j] || 0) > 0.01);
        if (which) return bodyLeft > 0.01 ? 'body' : rufLeft ? 'ruffle' : '';   // only the ruffle prints → the ruffle printer is enough
        return bodyLeft > 0.01 || rufLeft; };
      const noPr = plans.filter((p, i) => p.route === 'inhouse' && printsAt(i) && !(p.printer && p.printer.code) && !(p.rufflePrinter && printsAt(i, true) === 'ruffle')).map(p => p.sku);
      if (noPr.length) return `Which printer? The print order goes to them now — pick it for ${noPr.join(', ')}.`;
      const noVen = plans.filter(p => p.route === 'outsource' && !String(p.outVendor || '').trim()).map(p => p.sku);
      if (noVen.length) return `Who makes it? Type the outsource vendor for ${noVen.join(', ')}.`;
      const patch = {}, now = new Date().toISOString();
      const noFab = plans.filter(p => p.route !== 'outsource' && !String(p.fabric.name || '').trim()).map(p => p.sku);
      if (noFab.length) return `Which fabric? Type it for ${noFab.join(', ')} before raising the plan.`;
      plans.forEach((p, i) => {
        p.fabric.metres = flowR2(p.fabric.perPc * p.qty); delete p.fabric.was;
        /* Where the fabric came from: the master row, or PPC typing something else on purpose (kept as PPC's choice). */
        if (String(((cutSkuOf(rows[i].r.sku) || {}).fabric) || '').trim()) p.fabric.how = flowMasterDiff(rows[i].r, p) ? 'typed by PPC' : 'master data';
        /* What printed stock covers (worked out on screen): the challan sends only the rest. */
        const cv0 = cover[i] || { fab: 0, unit: 'm', extra: {} };
        p.fabric.fromPrinted = flowR2(cv0.fab || 0); p.fabric.printedUnit = cv0.unit;
        p.extra = (p.extra || []).map((x, j) => Object.assign({}, x, { fromPrinted: flowR2((cv0.extra || {})[j] || 0) }));
        if (p.route === 'outsource') { p.acc = []; p.fabric = Object.assign({}, p.fabric, { metres: 0 }); }
        if (p.route === 'jobwork') p.fabric = Object.assign({}, p.fabric, { metres: 0, fromPrinted: 0 });   // no cloth raised
        const rec = Object.assign({}, p, { at: now, by: ME.email || '' }); delete rec.gaps;
        patch['pt_ppc/' + flowKey(p.orderNo, p.sku)] = rec;
      });
      /* A re-plan: what it undoes downstream, written in the same save and said. */
      const said = [];
      rows.forEach((x, i) => { if (!x.s.plan) return;
        const nu = patch['pt_ppc/' + x.s.key];
        if (locked) ['fabric', 'route', 'printer', 'print'].forEach(k => { nu[k] = x.s.plan[k]; });
        if (locked && flowChIndex()[x.s.key + FLOW_RUF]) nu.rufflePrinter = x.s.plan.rufflePrinter || null;   // its ruffle is on a challan too
        const side = flowReplanSide(x.s.plan, nu, x.s); Object.assign(patch, side.patch); said.push(...side.said); });
      /* ACCESSORIES RESERVED BY THEMSELVES (Ravi, 10 Oct: "zip available ho to us order ke liye auto reserve ho"). Each
       * line's accessories are held in the same save when the shelf has them free — after every earlier reservation
       * and the lines above in this save. One that is short stays in Demand · Accessories, saying what is short. */
      { const free = flowAccFree(), took = {};
        rows.forEach((x, i) => { const p = patch['pt_ppc/' + x.s.key]; if (!p || p.route === 'outsource') return;
          const items = {}; (p.acc || []).forEach(a => { if (a.code && +a.qty > 0) items[accCode(a.code)] = (items[accCode(a.code)] || 0) + (+a.qty); });
          if (!Object.keys(items).length) return;
          const had = (FLOW.res || {})[x.s.key], dropped = had && patch['pt_accReserve/' + x.s.key] === null;
          if (had && !dropped) return;   // already reserved and the accessories did not change
          if (had) Object.entries(flowHeld(x.s.key, x.s.issued, +x.r.qty || 0)).forEach(([c, n]) => { if (free[c]) free[c].free += n; });   // its own old hold
          const short = Object.entries(items).filter(([c, n]) => ((free[c] || {}).free || 0) - (took[c] || 0) < n);
          if (short.length) { said.push(`${x.s.sku || obUC(x.r.sku)}: ${short.map(([c, n]) => `${c} short ${n - Math.max(0, ((free[c] || {}).free || 0) - (took[c] || 0))}`).join(', ')} — waits in Demand · Accessories`); return; }
          Object.entries(items).forEach(([c, n]) => { took[c] = (took[c] || 0) + n; });
          patch['pt_accReserve/' + x.s.key] = { orderNo: x.r.orderNo, sku: obUC(x.r.sku), items, at: now, by: ME.email || '', auto: true };
          said.push(`${obUC(x.r.sku)}: accessories reserved`); }); }
      /* The print orders, in the same write. */
      const pos = flowPoSync(rows.map((x, i) => ({ r: x.r, p: patch['pt_ppc/' + x.s.key] })), dToday());
      Object.assign(patch, pos.patch); said.push(...pos.said);
      /* …and for a real order, the Vendor Order(s) the printer sees — asked first, because the printer sees it at once. */
      const vop = await flowVoPrepare(pos.local, patch, key => patch['pt_ppc/' + key]);
      if (vop.ask && !confirm(vop.ask)) { vop.undo(); return 'Not saved — no Vendor Order was placed or changed.'; }
      /* Reservations made here take from the shared shelf: only if nobody else reserved since this screen read it. */
      if (Object.entries(patch).some(([k, v]) => k.startsWith('pt_accReserve/') && v) && await flowGuard('acc')) {
        Object.keys(patch).filter(k => k.startsWith('pt_accReserve/') && patch[k]).forEach(k => { delete patch[k]; });
        said.push('accessories not reserved — somebody else reserved at the same moment; reserve them from Demand · Accessories'); }
      /* A NEW print order is written only where no print order of that number is yet (two plans raised at once). */
      const fresh = Object.keys(patch).filter(k => /^pt_flowPrintOrders\/[^/]+$/.test(k) && !(FLOW.po || {})[k.split('/')[1]]), claimed = [];
      for (const k of fresh) {
        let er = ''; try { er = await flowClaim(k, patch[k]); } catch (e) { er = e.message || String(e); }
        if (er) { vop.undo(); if (claimed.length) { try { await ptPatch(Object.fromEntries(claimed.map(c => [c, null]))); } catch (e) { /* left to Refresh */ } }
          try { await flowLoad(true); } catch (e) { /* the message still stands */ }
          return er === 'taken' ? `Print order ${k.split('/')[1]} was raised by somebody else at the same moment — nothing was saved. Press "${rows.length > 1 ? 'Raise the plan' : 'Save'}" again.` : 'Could not save: ' + er; }
        claimed.push(k);
      }
      try { await ptPatch(patch); } catch (e) { vop.undo(); return 'Could not save: ' + (e.message || e); }
      FLOW.po = pos.local; flowVoAfter(vop.placed); said.push(...vop.said);
      if (Object.keys(patch).some(k => k.startsWith('pt_accReserve/'))) { FLOW.res = Object.assign({}, FLOW.res);
        Object.keys(patch).filter(k => k.startsWith('pt_accReserve/')).forEach(k => { if (patch[k]) FLOW.res[k.slice(14)] = patch[k]; else delete FLOW.res[k.slice(14)]; }); }
      Object.keys(patch).filter(k => k.startsWith('pt_flowDemand/')).forEach(k => { const key = k.split('/')[1]; FLOW.dem = Object.assign({}, FLOW.dem, { [key]: Object.assign({}, (FLOW.dem || {})[key], { fabricReady: null }) }); });
      if (said.length) setTimeout(() => { $('flMsg').className = 'muted'; $('flMsg').textContent = 'Plan saved · ' + said.join(' · ') + ' · the fabric team and the accessories team have their demand.'; }, 0);
      /* A new object, so every cache keyed on it knows it changed. */
      FLOW.ppc = Object.assign({}, FLOW.ppc);
      Object.entries(patch).filter(([path]) => path.startsWith('pt_ppc/')).forEach(([path, rec]) => { FLOW.ppc[path.slice('pt_ppc/'.length)] = rec; });
      flowPpcDraftDrop(rows.map(x => x.s.key));   // raised: its draft is done with
      renderFlow();
      return '';
    },
  });
  if (locked) ['fabric.name', 'fabric.perPc', 'route', 'printer.code'].forEach(k => { const el = document.querySelector(`[data-fp="0"][data-k="${k}"]`); if (el) el.disabled = true; });
  /* "Use the master data": the master row's fabric and m/pc into the boxes (not saved until the plan is). */
  document.querySelectorAll('[data-usem]').forEach(b => { if (locked) { b.remove(); return; } b.onclick = () => {
    const i = b.dataset.usem, n = document.querySelector(`[data-fp="${i}"][data-k="fabric.name"]`), pc = document.querySelector(`[data-fp="${i}"][data-k="fabric.perPc"]`);
    if (n) n.value = b.dataset.n; if (pc && +b.dataset.p) pc.value = b.dataset.p;
    if (pc) pc.dispatchEvent(new Event('input')); b.parentNode.textContent = 'master data taken — save the plan'; }; });
  /* What printed stock covers, per line — worked out by the drawing below, kept on the plan when it is saved. */
  const cover = {};
  /* THE STOCK LINES: worked out again whenever a quantity, a fabric or the route changes, in the form's own order. */
  const com = flowCommitted(rows.map(x => x.s.key), flowIsTest(orderNo));
  const holdC = new Map(), hold = pk => { if (!holdC.has(pk)) { let h = 0; try { h = flowStoreHold(pk, rows.map(x => x.s.key), flowIsTest(orderNo)); } catch (e) { h = 0; } holdC.set(pk, h); } return holdC.get(pk); };
  let shelf = {}; try { (accBalances() || []).forEach(b => { shelf[accCode(b.code)] = +b.qty || 0; }); } catch (e) { shelf = {}; }
  const val = (i, k) => { const el = document.querySelector(`[data-fp="${i}"][data-k="${k}"]`); return el ? el.value : null; };
  const paint = () => {
    const run = { acc: {}, fab: {}, extra: {}, printed: {} }, combo = [], names = {};
    plans.forEach((p, i) => {
      const route = val(i, 'route') || flowRouteOf(p), out = route === 'outsource';
      const fname = (val(i, 'fabric.name') ?? p.fabric.name) || '', per = +(val(i, 'fabric.perPc') ?? p.fabric.perPc) || 0, metres = flowR2(per * p.qty);
      const fm = document.querySelector(`[data-fm="${i}"]`); if (fm) fm.textContent = nf(metres);
      document.querySelectorAll(`[data-outrow="${i}"]`).forEach(el => { if (el.style) el.style.display = out ? '' : 'none'; });
      const r = rows[i].r, colour = String(((cutSkuOf(r.sku) || {}).color) || r.color || '').trim();
      const cur = Object.assign({}, p, { route, fabric: Object.assign({}, p.fabric, { name: fname, metres }),
        print: Object.assign({}, p.print, { dir: val(i, 'print.dir') ?? flowDirOpts(r, p).cur }) });
      const w = route === 'inhouse' ? flowPrintWhat(r, cur) : null, xw = route === 'inhouse' ? flowPrintExtras(r, cur) : [];
      const pg = document.querySelector(`[data-pget="${i}"]`);
      if (pg) pg.innerHTML = w ? `<span class="fpc-mode">${esc(w.mode)}</span> ` + flowPrintTxt(w) + flowExtrasTxt(xw) + '<div data-pcov></div>'
        : `<span class="muted">${route === 'stitch' ? 'Nothing — no printing; the RFD goes straight to the cutting department.'
          : route === 'jobwork' ? 'Nothing — no printing, no cutting; the line goes straight to Raw cutting in store, to be issued to a karigar.'
          : 'Nothing — made outside.'}</span>`;
      const mat = document.querySelector(`[data-mat="${i}"]`); if (!mat) return;
      if (out) { mat.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:left">Outsourced — nothing is raised from our stock.</td></tr>';
        const ch = document.querySelector(`[data-chips="${i}"]`); if (ch) ch.innerHTML = '<span class="fpc-chip vio">Outsourced</span>'; return; }
      const h = []; cover[i] = { fab: 0, unit: w && w.kind === 'sku' ? 'pcs' : 'm', extra: {} };
      let rfdNeed = metres;
      /* PRINTED STOCK FIRST: what is already printed in the store, less what earlier plans and the lines above took. */
      if (w && w.code) {
        const pu = w.kind === 'sku' ? ' pcs' : ' m', pk = flowPrintedKey(w, fname, colour), ps0 = flowPrintedStock(Object.assign({ fabric: fname }, w), colour);
        /* A plan being changed here already took its printed stock out of the store (inventory/store.js): put its own back. */
        const ps = ps0 == null ? null : flowR2(ps0 + rows.reduce((a, x) => { const op = x.s.plan;
          if (!op || typeof stPlanTookOut !== 'function' || !stPlanTookOut(op) || !(+(op.fabric && op.fabric.fromPrinted) > 0)) return a;
          const oc = String(((cutSkuOf(x.r.sku) || {}).color) || x.r.color || '').trim();
          let ok = ''; try { ok = flowPrintedKey(flowPrintWhat(x.r, op), op.fabric.name, oc); } catch (e) { ok = ''; }
          return ok === pk ? a + (+op.fabric.fromPrinted) : a; }, 0));
        const held = ps == null ? 0 : hold(pk), pleft = ps == null ? null : ps - held - (com.printed[pk] || 0) - (run.printed[pk] || 0);
        const want = w.kind === 'sku' ? (+p.qty || 0) : metres, use = pleft == null ? 0 : flowR2(Math.max(0, Math.min(want, pleft)));
        h.push(flowPrintedRow(`<b>${esc(w.code)}</b>`, pleft, pu, use, ps, held + (com.printed[pk] || 0), run.printed[pk] || 0));
        run.printed[pk] = flowR2((run.printed[pk] || 0) + use); cover[i].fab = use;
        rfdNeed = w.kind === 'sku' ? flowR2(metres * (1 - (p.qty ? use / p.qty : 0))) : flowR2(metres - use);
      }
      /* Job Work straight away: no cloth is raised for it — accessories only. */
      if (fname && route !== 'jobwork') { const k = flowFabKey(fname), before = (com.fab[k] || 0) + (run.fab[k] || 0); names['f|' + k] = fname;
        h.push(flowMatRow(`RFD · <b>${esc(fname)}</b>${rfdNeed < metres ? ' <span class="muted">(the rest)</span>' : ''}`, rfdNeed, flowRfdStock(fname), before, ' m', flowFabKnown(fname)));
        run.fab[k] = flowR2((run.fab[k] || 0) + rfdNeed); }
      (p.extra || []).forEach((x, j) => {
        if (route === 'jobwork' && x.unit === 'm') return;   // no cloth for a line going straight to job work
        if (x.unit !== 'm') { h.push(flowMatRow(esc(x.what), +x.qty || 0, 0, 0, ' ' + esc(x.unit || ''), false)); return; }
        const name = String(x.what).replace(/^Ruffle — /, ''), k = flowFabKey(name), ruf = /^Ruffle — /.test(x.what);
        let need = +x.qty || 0;
        if (ruf && w) {
          /* the ruffle cloth: printed stock first too (Ravi, 10 Oct: printed LSB in the store is used — a printed ruffle
           * needs no printer). The store does not yet take ruffle cloth out at the Job Work issue, so its figure can read
           * high — the row says what it takes. */
          const xc = (flowPrintExtras(r, Object.assign({}, cur, { extra: [Object.assign({}, x, { fromPrinted: 0 })] }))[0] || {}).code;
          const pk = 'M|' + fabKey(name) + '|' + fabKey(colour), ps = flowPrintedStock({ kind: 'fabric', fabric: name }, colour);
          const held = ps == null ? 0 : hold(pk), pleft = ps == null ? null : ps - held - (com.printed[pk] || 0) - (run.printed[pk] || 0), use = pleft == null ? 0 : flowR2(Math.max(0, Math.min(need, pleft)));
          h.push(flowPrintedRow(`<b>${esc(xc || name)}</b> <span class="muted">(ruffle)</span>`, pleft, ' m', use, ps, held + (com.printed[pk] || 0), run.printed[pk] || 0));
          run.printed[pk] = flowR2((run.printed[pk] || 0) + use); cover[i].extra[j] = use; need = flowR2(need - use);
        }
        const before = (com.extra[k] || 0) + (run.extra[k] || 0); if (ruf) names['x|' + k] = name;
        h.push(flowMatRow(ruf ? `RFD · <b>${esc(name)}</b> <span class="muted">(ruffle${need < (+x.qty || 0) ? ', the rest' : ''})</span>` : `<b>${esc(x.what)}</b>`, need, ruf ? flowRfdStock(name) : 0, before, ' m', ruf && flowFabKnown(name)));
        run.extra[k] = flowR2((run.extra[k] || 0) + need); });
      (p.acc || []).forEach((a, j) => { const c = accCode(a.code), need = +(val(i, 'acc.' + j + '.qty') ?? a.qty) || 0, before = (com.acc[c] || 0) + (run.acc[c] || 0); names['a|' + c] = a.what;
        h.push(flowMatRow(`${esc(a.what)} <span class="muted">(code ${esc(a.code)})</span>`, need, shelf[c] || 0, before, '', c in shelf));
        run.acc[c] = (run.acc[c] || 0) + need; });
      mat.innerHTML = h.join('') || '<tr><td colspan="4" class="muted" style="text-align:left">nothing to raise</td></tr>';
      /* What this line sends to the printer once the store has given what it can — for the order's combined demand. */
      if (w) { try { const curC = Object.assign({}, cur, { fabric: Object.assign({}, cur.fabric, { fromPrinted: cover[i].fab }),
          extra: (p.extra || []).map((x, j) => Object.assign({}, x, { fromPrinted: cover[i].extra[j] || 0 })) });
        const pcV = val(i, 'printer.code') ?? (p.printer && p.printer.code) ?? '', rcV = val(i, 'rufflePrinter.code') ?? (p.rufflePrinter && p.rufflePrinter.code) ?? '';
        Object.assign(curC, { printer: pcV ? { code: pcV } : null, rufflePrinter: rcV ? { code: rcV } : null });
        flowPoParts(r, curC).forEach(x => combo.push(Object.assign({}, x.item, { printer: (x.printer && x.printer.code) || '' }))); } catch (e) { /* the line's own box still shows it */ } }
      const allPrinted = w && (cover[i].unit === 'pcs' ? cover[i].fab >= (+p.qty || 0) : cover[i].fab >= metres - 0.01)
        && (p.extra || []).every((x, j) => !/^Ruffle — /.test(String(x.what || '')) || (cover[i].extra[j] || 0) >= (+x.qty || 0) - 0.01);
      if (pg && allPrinted) pg.innerHTML = `<div style="color:#166534;font-weight:600">✓ All already printed, in the store — nothing goes to the printer. The line goes straight to Cutting.</div>`
        + `<div style="font-size:11.5px">${flowPrintTxt(w)}${Object.values(cover[i].extra).some(v => v > 0) ? ' · ruffle ' + nf(Object.values(cover[i].extra).reduce((a, v) => a + v, 0)) + ' m' : ''}</div>`;
      else if (pg && w && (cover[i].fab > 0 || Object.values(cover[i].extra).some(v => v > 0))) {
        const u = cover[i].unit === 'pcs' ? ' pcs' : ' m', left = cover[i].unit === 'pcs' ? Math.max(0, (+p.qty || 0) - cover[i].fab) : flowR2(Math.max(0, metres - cover[i].fab));
        pg.innerHTML += `<div style="color:#166534">✓ ${nf(cover[i].fab)}${u} from printed stock — <b>print ${nf(left)}${u}</b>${Object.values(cover[i].extra).some(v => v > 0) ? ` · ruffle ${nf(Object.values(cover[i].extra).reduce((a, v) => a + v, 0))} m from printed stock` : ''}</div>`; }
      /* The chips: how it is made, the printer, and whether everything is there. */
      const ch = document.querySelector(`[data-chips="${i}"]`);
      if (ch) { const pc = val(i, 'printer.code'), pv = pc ? flowChVendors().find(v => String(v.code) === String(pc)) : null;
        const short = /pill bad/.test(mat.innerHTML);
        ch.innerHTML = `<span class="fpc-chip vio">${esc((FLOW_ROUTES.find(x => x[0] === route) || [, , route])[2])}</span>`
          + (route === 'inhouse' ? `<span class="fpc-chip">${pv ? '🖨 ' + esc(pv.desc || pv.name || pv.code) : 'printer not chosen'}</span>` : '')
          + `<span class="fpc-chip ${short ? 'bad' : 'ok'}">${short ? '⚑ something is short' : '✓ all in stock'}</span>`; }
    });
    flowComboPaint(combo, run, com, names, shelf);
  };
  /* THE GREIGE DESK NOT READ YET (or the read failed): ask for it now, and draw the stock again once it is here. */
  if (!flowRfdKnown() && typeof GD !== 'undefined' && GD.ensure && typeof gdAllowed === 'function' && gdAllowed()) {
    GD.ensure().catch(() => {}).then(() => { if (!PTD) return;
      document.querySelectorAll('[data-gdnote]').forEach(el => { el.innerHTML = flowGdNote(); }); try { paint(); } catch (e) { /* the form was closed */ } });
  }
  /* THE DRAFT: put back before the first drawing, then kept as the boxes change. */
  const dkeys = rows.map(x => x.s.key);
  const sayD = (t, bad) => { const el = $('flpDraftSay'); if (el) { el.textContent = t; el.className = bad ? 'err' : 'muted'; } };
  const dropA = $('flpDraftDrop');
  const restored = flowPpcDraftApply(dkeys);
  if (restored) { sayD(`Draft put back — saved ${flowDraftWhen(restored)} on this computer. Auto-save is on.`); if (dropA && dropA.style) dropA.style.display = ''; }
  const said = at => { if (at) { sayD(`Draft auto-saved ${flowDraftWhen(at)} — on this computer.`); if (dropA && dropA.style) dropA.style.display = ''; } else sayD('Could not keep a draft on this computer (browser storage is blocked).', true); };
  document.querySelectorAll('[data-fp]').forEach(inp => { inp.addEventListener('input', paint); inp.addEventListener('change', paint);
    inp.addEventListener('input', () => flowPpcDraftSoon(dkeys, said)); inp.addEventListener('change', () => flowPpcDraftSoon(dkeys, said)); });
  if ($('flpDraftBtn')) $('flpDraftBtn').onclick = () => { clearTimeout(FLOW_DRAFT_T); const at = flowPpcDraftSave(dkeys);
    if (!at) { sayD('Could not keep a draft on this computer (browser storage is blocked).', true); return; }
    ptDlgClose(); try { renderFlow(); } catch (e) { /* the list redraws on its next read */ }
    if ($('flMsg')) { $('flMsg').className = 'muted'; $('flMsg').textContent = `Draft saved for ${orderNo} (${nf(dkeys.length)} line(s)) — open it again to carry on; it is not raised until you raise it.`; } };
  if (dropA) dropA.onclick = e => { if (e && e.preventDefault) e.preventDefault(); if (!confirm('Throw away the draft and start again from the suggestion?')) return;
    clearTimeout(FLOW_DRAFT_T); flowPpcDraftDrop(dkeys); ptDlgClose(); flowPpcOpen(keys && keys.length ? '' : orderNo, onlySku, keys); };
  paint();
}
