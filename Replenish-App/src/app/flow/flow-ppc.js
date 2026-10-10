/* ================= PRODUCTION FLOW · PPC — the plan for a line =================
 * What PPC raises for each order line: the fabric (which, how many metres), the accessories (zippers by their code,
 * which is what Demand reserves), whether it is printed, and the planned dates. Worked out from what the app already
 * knows — cloth per piece (ptConsPlan), the recipe, the print rules, the Job Work materials planner — and shown for PPC
 * to check and change before saving. Saving IS raising: the line leaves PPC for Demand by itself.
 *   pt_ppc/<line> = { orderNo, sku, qty, fabric:{name, perPc, metres, how}, extra:[{what, qty, unit}],
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
  return { orderNo: r.orderNo, sku: obUC(r.sku), qty, fabric, acc, extra, print: { need, as },
    dates: { cut: flowAddDays(t, 3), qc: flowAddDays(t, 7), ready: ptIsoDate(r.mtoDue) || flowAddDays(t, 10) }, note: '', gaps };
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
          <span class="muted" style="font-size:11px">${esc(p.fabric.how || 'not known — type it')}</span></span>
        <span class="muted">Printing</span><span><label style="display:inline-flex;gap:5px;align-items:center"><input data-fp="${i}" data-k="print.need" type="checkbox" ${p.print.need ? 'checked' : ''} style="width:auto"> printed by a vendor</label>
          ${p.print.as ? `<span class="muted" style="font-size:11px"> · given as ${esc(p.print.as)}</span>` : ''}</span>
        <span class="muted">Accessories</span><span>${(p.acc || []).length ? p.acc.map((a, j) => `${esc(a.what)} (code ${esc(a.code)}) × ${f(i, 'acc.' + j + '.qty', a.qty, 'number')}`).join('<br>') : '<span class="muted">none from the accessories shelf</span>'}</span>
        <span class="muted">Other materials</span><span>${(p.extra || []).length ? p.extra.map(x => `${esc(x.what)}: <b>${nf(x.qty)}</b> ${esc(x.unit)}`).join(' · ') : '<span class="muted">none</span>'}</span>
        <span class="muted">Planned dates</span><span>cut ${f(i, 'dates.cut', p.dates.cut, 'date')} QC ${f(i, 'dates.qc', p.dates.qc, 'date')} ready ${f(i, 'dates.ready', p.dates.ready, 'date')}</span>
        <span class="muted">Note</span><span>${f(i, 'note', p.note)}</span>
      </div>
      ${(p.gaps || []).length ? `<div style="font-size:11.5px;color:#92400e;margin-top:6px">• ${p.gaps.map(esc).join('<br>• ')}</div>` : ''}
    </div>`;
  }).join('');
  ptOpenDialog({
    title: `PPC — ${orderNo}`,
    subtitle: `${nf(rows.length)} line(s). Worked out from cloth per piece, the recipe and the print rules — check, change, save. Saving raises it: the line moves on to Demand by itself.`,
    html,
    saveLabel: rows.length > 1 ? `Raise the plan for ${rows.length} lines` : 'Raise the plan',
    onSave: async () => {
      const set = (o, path, v) => { const ks = path.split('.'); let t = o; ks.slice(0, -1).forEach(k => { t = t[/^\d+$/.test(k) ? +k : k]; }); t[ks[ks.length - 1]] = v; };
      document.querySelectorAll('[data-fp]').forEach(inp => {
        const p = plans[+inp.dataset.fp], k = inp.dataset.k;
        set(p, k, inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (+inp.value || 0) : inp.value.trim());
      });
      const patch = {}, now = new Date().toISOString();
      const noFab = plans.filter(p => !String(p.fabric.name || '').trim()).map(p => p.sku);
      if (noFab.length) return `Which fabric? Type it for ${noFab.join(', ')} before raising the plan.`;
      plans.forEach(p => {
        p.fabric.metres = flowR2(p.fabric.perPc * p.qty);
        const rec = Object.assign({}, p, { at: now, by: ME.email || '' }); delete rec.gaps;
        patch['pt_ppc/' + flowKey(p.orderNo, p.sku)] = rec;
      });
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      /* A new object, so every cache keyed on it knows it changed. */
      FLOW.ppc = Object.assign({}, FLOW.ppc);
      Object.entries(patch).forEach(([path, rec]) => { FLOW.ppc[path.slice('pt_ppc/'.length)] = rec; });
      renderFlow();
      return '';
    },
  });
  /* The metres follow the per-piece figure as it is typed. */
  document.querySelectorAll('[data-k="fabric.perPc"]').forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.fp, el = document.querySelector(`[data-fm="${i}"]`);
    if (el) el.textContent = nf(flowR2((+inp.value || 0) * plans[i].qty));
  });
}
