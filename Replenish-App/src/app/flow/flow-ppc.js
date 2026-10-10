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
  /* Fabric: cloth per piece first (print rules, widths, panels), then the recipe's consumption. */
  let fabric = { name: '', perPc: 0, metres: 0, how: '' };
  let cons = null;
  try { cons = ptConsPlan(m); } catch (e) { cons = null; }
  if (cons && cons.metres > 0) fabric = { name: cons.fabric || '', perPc: flowR2(cons.metres), metres: flowR2(cons.metres * qty), how: 'cloth per piece' };
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

/* ---- STOCK SEEN FROM PPC (Ravi, 10 Oct: "yahan current stock visibility show ho … 100 in stock, an earlier order of 40
 * → this order sees 60 available") — shown only, never written ----
 * What the plans of OTHER lines already take, still unused:
 *   accessories  plan qty × the share of that line not yet issued (the zipper leaves the shelf at issue)
 *   fabric (RFD) plan metres, until the line's cloth moves (cut, issued, or back from the printer / given without a challan)
 *   ruffle cloth plan metres until issued (taken off the RFD register at issue, ptConsumeRuffle)
 * Lines in the form itself count in their order, each after the ones above it. */
function flowCommitted(skipKeys, withTest) {
  const skip = new Set(skipKeys || []), acc = {}, fab = {}, extra = {};
  flowRows().forEach(({ r, s }) => {
    const p = s.plan; if (!p || skip.has(s.key) || s.route === 'outsource' || (r.__t && !withTest)) return;   // a test order never eats a real one's stock
    const qty = +r.qty || 0, left = qty > 0 ? Math.max(0, 1 - s.issued / qty) : 0;
    (p.acc || []).forEach(a => { if (!a.code || !(+a.qty > 0)) return; const c = accCode(a.code); acc[c] = (acc[c] || 0) + Math.ceil(+a.qty * left); });
    const fr = s.demand && s.demand.fabricReady;
    const unmoved = !s.cut && !s.issued && (fr && fr.challan ? !s.back : !s.given);
    if (unmoved && p.fabric && p.fabric.name) { const k = flowFabKey(p.fabric.name); fab[k] = flowR2((fab[k] || 0) + (+p.fabric.metres || 0)); }
    (p.extra || []).forEach(x => { if (x.unit !== 'm' || !x.what) return; const k = flowFabKey(String(x.what).replace(/^Ruffle — /, ''));
      extra[k] = flowR2((extra[k] || 0) + (+x.qty || 0) * left); });
  });
  return { acc, fab, extra };
}
/** One stock line: in stock · planned for earlier orders · available for this line, and whether it is enough. */
function flowStockTxt(stock, earlier, need, unit, known) {
  if (!known) return '<span class="muted" style="font-size:11px">stock not kept in the app</span>';
  const avail = flowR2(stock - earlier), ok = avail >= need;
  return `<span style="font-size:11px;color:${ok ? '#166534' : '#b91c1c'}">in stock ${nf(flowR2(stock))}${unit} · planned for earlier orders ${nf(flowR2(earlier))}${unit} · <b>available ${nf(Math.max(0, avail))}${unit}</b>${ok ? '' : ` · ⚑ short ${nf(flowR2(need - Math.max(0, avail)))}${unit}`}</span>`;
}
function flowFabKnown(name) { const k = flowFabKey(name); try { return fabAll().some(r => flowFabKey(r.fabricType) === k); } catch (e) { return false; } }

/** The printers to pick from, the chosen one selected. */
function flowPrinterOpts(code) {
  let vens = []; try { vens = flowChVendors(); } catch (e) { vens = []; }
  return vens.filter(v => /print/i.test(String(v.category || ''))).map(v => `<option value="${esc(v.code)}"${String(v.code) === String(code || '') ? ' selected' : ''}>${esc(v.desc || v.name || v.code)}</option>`).join('');
}
/** PPC's form for every line of one PO that is still in PPC (or one line). */
function flowPpcOpen(orderNo, onlySku) {
  const rows = flowRows().filter(x => x.r.orderNo === orderNo && (onlySku ? obUC(x.r.sku) === obUC(onlySku) : x.s.bucket === 'ppc'));
  if (!rows.length) return;
  const plans = rows.map(x => Object.assign(flowSuggest(x.r), x.s.plan ? JSON.parse(JSON.stringify(x.s.plan)) : {}));
  const f = (i, k, v, type) => `<input data-fp="${i}" data-k="${k}" ${type ? `type="${type}"` : ''} value="${esc(v == null ? '' : v)}" style="width:${type === 'date' ? 135 : type === 'number' ? 80 : 150}px;padding:3px 6px;font-size:12px">`;
  const html = plans.map((p, i) => {
    const r = rows[i].r, img = (typeof ptImgOf === 'function' && ptImgOf(r.sku)) || '';
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px">
      <div style="display:flex;gap:10px;align-items:center">
        ${img ? `<img src="${esc(ptImgSrc ? ptImgSrc(img, 48) : img)}" style="width:48px;height:48px;object-fit:contain;border-radius:6px;background:#fff" alt="">` : ''}
        <div><b style="font-family:ui-monospace,monospace">${esc(p.sku)}</b> · <b>${nf(p.qty)} pcs</b>
          <div class="muted" style="font-size:11.5px">${esc([r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · '))}</div></div></div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:6px 10px;margin-top:8px;font-size:12.5px;align-items:center">
        <span class="muted">Fabric</span><span>${f(i, 'fabric.name', p.fabric.name)} ${f(i, 'fabric.perPc', p.fabric.perPc, 'number')} m/pc → <b data-fm="${i}">${nf(p.fabric.metres)}</b> m
          <span class="muted" style="font-size:11px">${esc(p.fabric.how || 'not known — type it')}</span><br><span data-fstk="${i}"></span></span>
        <span class="muted">How it is made</span><span><select data-fp="${i}" data-k="route" style="width:auto;padding:3px 6px;font-size:12px">${FLOW_ROUTES.map(([k, l]) => `<option value="${k}"${flowRouteOf(p) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${p.print.as ? `<span class="muted" style="font-size:11px"> · print rule: given as ${esc(p.print.as)}</span>` : ''}</span>
        <span class="muted">Printer</span><span><select data-fp="${i}" data-k="printer.code" style="width:auto;padding:3px 6px;font-size:12px"><option value="">— PPC decides —</option>${flowPrinterOpts((p.printer || {}).code)}</select>
          <span class="muted" style="font-size:11px">${esc((p.printer || {}).why || '')} · only for a printed line</span></span>
        <span class="muted">Outsource vendor</span><span>${f(i, 'outVendor', p.outVendor || '')} <span class="muted" style="font-size:11px">only for an outsourced line — no fabric or accessories are raised for it</span></span>
        <span class="muted">Accessories</span><span>${(p.acc || []).length ? p.acc.map((a, j) => `${esc(a.what)} (code ${esc(a.code)}) × ${f(i, 'acc.' + j + '.qty', a.qty, 'number')} <span data-astk="${i}.${j}"></span>`).join('<br>') : '<span class="muted">none from the accessories shelf</span>'}</span>
        <span class="muted">Other materials</span><span>${(p.extra || []).length ? p.extra.map((x, j) => `${esc(x.what)}: <b>${nf(x.qty)}</b> ${esc(x.unit)} <span data-xstk="${i}.${j}"></span>`).join('<br>') : '<span class="muted">none</span>'}</span>
        <span class="muted">Planned dates</span><span>cut ${f(i, 'dates.cut', p.dates.cut, 'date')} QC ${f(i, 'dates.qc', p.dates.qc, 'date')} ready ${f(i, 'dates.ready', p.dates.ready, 'date')}</span>
        <span class="muted">Note</span><span>${f(i, 'note', p.note)}</span>
      </div>
      ${(p.gaps || []).length ? `<div style="font-size:11.5px;color:#92400e;margin-top:6px">• ${p.gaps.map(esc).join('<br>• ')}</div>` : ''}
    </div>`;
  }).join('');
  /* EDITING A PLAN ALREADY RAISED (flow-edit.js): the same form, plus "undo — back to PPC"; a line whose fabric is on a
   * challan keeps its fabric, route and printer. */
  const editing = rows.length === 1 && !!rows[0].s.plan, locked = editing && flowFabLocked(rows[0].s);
  ptOpenDialog({
    title: editing ? `Edit plan — ${orderNo} · ${obUC(rows[0].r.sku)}` : `PPC — ${orderNo}`,
    subtitle: editing ? `Change what was planned and save; the line moves to wherever it now belongs.${locked ? ` Its fabric is on challan ${rows[0].s.challan.no}: fabric, route and printer stay as they are until that challan is cancelled (Demand history).` : ''}`
      : `${nf(rows.length)} line(s). Worked out from cloth per piece, the recipe and the print rules — check, change, save. Saving raises it: the line moves on to Demand by itself.`,
    html: html + (editing ? `<label style="display:flex;gap:6px;align-items:center;margin-top:4px;color:#b91c1c"><input id="flpUndo" type="checkbox" style="width:auto"${locked ? ' disabled' : ''}> Undo this plan — send the line back to PPC (its fabric-ready and reservation go too)${locked ? ' · not while its fabric is on a challan' : ''}</label>` : ''),
    saveLabel: editing ? 'Save the plan' : rows.length > 1 ? `Raise the plan for ${rows.length} lines` : 'Raise the plan',
    onSave: async () => {
      if (editing && $('flpUndo') && $('flpUndo').checked) { const er = await flowUnplan(rows[0].s); if (er) return er; renderFlow(); return ''; }
      const set = (o, path, v) => { const ks = path.split('.'); let t = o; ks.slice(0, -1).forEach(k => { t = t[/^\d+$/.test(k) ? +k : k]; }); t[ks[ks.length - 1]] = v; };
      document.querySelectorAll('[data-fp]').forEach(inp => {
        const p = plans[+inp.dataset.fp], k = inp.dataset.k;
        set(p, k, inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (+inp.value || 0) : inp.value.trim());
      });
      /* The route decides printing; an outsourced line raises no cloth and no accessories, and must name who makes it. */
      plans.forEach(p => { p.route = p.route || 'inhouse'; p.print = Object.assign({}, p.print, { need: p.route === 'inhouse' });
        /* The printer is kept by code and name; a line not printed has none. */
        const v = p.route === 'inhouse' && p.printer && p.printer.code ? flowChVendors().find(x => String(x.code) === String(p.printer.code)) : null;
        p.printer = v ? { code: v.code, name: v.desc || v.name || v.code, why: p.printer.why || '' } : null; });
      const noVen = plans.filter(p => p.route === 'outsource' && !String(p.outVendor || '').trim()).map(p => p.sku);
      if (noVen.length) return `Who makes it? Type the outsource vendor for ${noVen.join(', ')}.`;
      const patch = {}, now = new Date().toISOString();
      const noFab = plans.filter(p => p.route !== 'outsource' && !String(p.fabric.name || '').trim()).map(p => p.sku);
      if (noFab.length) return `Which fabric? Type it for ${noFab.join(', ')} before raising the plan.`;
      plans.forEach(p => {
        p.fabric.metres = flowR2(p.fabric.perPc * p.qty);
        if (p.route === 'outsource') { p.acc = []; p.fabric = Object.assign({}, p.fabric, { metres: 0 }); }
        const rec = Object.assign({}, p, { at: now, by: ME.email || '' }); delete rec.gaps;
        patch['pt_ppc/' + flowKey(p.orderNo, p.sku)] = rec;
      });
      /* A re-plan: what it undoes downstream, written in the same save and said. */
      const said = [];
      rows.forEach((x, i) => { if (!x.s.plan) return;
        const nu = patch['pt_ppc/' + x.s.key];
        if (locked) ['fabric', 'route', 'printer', 'print'].forEach(k => { nu[k] = x.s.plan[k]; });
        const side = flowReplanSide(x.s.plan, nu, x.s); Object.assign(patch, side.patch); said.push(...side.said); });
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      if (Object.keys(patch).some(k => k.startsWith('pt_accReserve/'))) { FLOW.res = Object.assign({}, FLOW.res); Object.keys(patch).filter(k => k.startsWith('pt_accReserve/')).forEach(k => { delete FLOW.res[k.slice(14)]; }); }
      Object.keys(patch).filter(k => k.startsWith('pt_flowDemand/')).forEach(k => { const key = k.split('/')[1]; FLOW.dem = Object.assign({}, FLOW.dem, { [key]: Object.assign({}, (FLOW.dem || {})[key], { fabricReady: null }) }); });
      if (said.length) setTimeout(() => { $('flMsg').className = 'muted'; $('flMsg').textContent = 'Plan saved · ' + said.join(' · '); }, 0);
      /* A new object, so every cache keyed on it knows it changed. */
      FLOW.ppc = Object.assign({}, FLOW.ppc);
      Object.entries(patch).filter(([path]) => path.startsWith('pt_ppc/')).forEach(([path, rec]) => { FLOW.ppc[path.slice('pt_ppc/'.length)] = rec; });
      renderFlow();
      return '';
    },
  });
  if (locked) ['fabric.name', 'fabric.perPc', 'route', 'printer.code'].forEach(k => { const el = document.querySelector(`[data-fp="0"][data-k="${k}"]`); if (el) el.disabled = true; });
  /* THE STOCK LINES: worked out again whenever a quantity, a fabric or the route changes, in the form's own order. */
  const com = flowCommitted(rows.map(x => x.s.key), flowIsTest(orderNo));
  let shelf = {}; try { (accBalances() || []).forEach(b => { shelf[accCode(b.code)] = +b.qty || 0; }); } catch (e) { shelf = {}; }
  const val = (i, k) => { const el = document.querySelector(`[data-fp="${i}"][data-k="${k}"]`); return el ? el.value : null; };
  const paint = () => {
    const run = { acc: {}, fab: {}, extra: {} };
    plans.forEach((p, i) => {
      const route = val(i, 'route') || flowRouteOf(p), out = route === 'outsource';
      const fname = (val(i, 'fabric.name') ?? p.fabric.name) || '', per = +(val(i, 'fabric.perPc') ?? p.fabric.perPc) || 0, metres = flowR2(per * p.qty);
      const fm = document.querySelector(`[data-fm="${i}"]`); if (fm) fm.textContent = nf(metres);
      const fs = document.querySelector(`[data-fstk="${i}"]`);
      if (fs) { const k = flowFabKey(fname), before = (com.fab[k] || 0) + (run.fab[k] || 0);
        fs.innerHTML = out || !fname ? '' : 'RFD ' + flowStockTxt(flowRfdStock(fname), before, metres, ' m', flowFabKnown(fname));
        if (!out && fname) run.fab[k] = flowR2((run.fab[k] || 0) + metres); }
      (p.acc || []).forEach((a, j) => { const el = document.querySelector(`[data-astk="${i}.${j}"]`); if (!el) return;
        const c = accCode(a.code), need = +(val(i, 'acc.' + j + '.qty') ?? a.qty) || 0, before = (com.acc[c] || 0) + (run.acc[c] || 0);
        el.innerHTML = out ? '' : '<br>' + flowStockTxt(shelf[c] || 0, before, need, '', c in shelf);
        if (!out) run.acc[c] = (run.acc[c] || 0) + need; });
      (p.extra || []).forEach((x, j) => { const el = document.querySelector(`[data-xstk="${i}.${j}"]`); if (!el) return;
        if (x.unit !== 'm') { el.innerHTML = flowStockTxt(0, 0, 0, '', false); return; }
        const name = String(x.what).replace(/^Ruffle — /, ''), k = flowFabKey(name), before = (com.extra[k] || 0) + (run.extra[k] || 0);
        el.innerHTML = out ? '' : '<br>' + flowStockTxt(flowRfdStock(name), before, +x.qty || 0, ' m', flowFabKnown(name));
        if (!out) run.extra[k] = flowR2((run.extra[k] || 0) + (+x.qty || 0)); });
    });
  };
  document.querySelectorAll('[data-fp]').forEach(inp => { inp.addEventListener('input', paint); inp.addEventListener('change', paint); });
  paint();
}
