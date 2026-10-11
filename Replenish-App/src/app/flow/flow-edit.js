/* ================= PRODUCTION FLOW · CORRECTIONS — a wrong plan, a wrong challan, a wrong receipt =================
 * Ravi, 10 Oct: "yadi mere se galat demand generate ho gya ya kuch bhi data galat select ho gya and want to edit,
 * please give me option for this". Every step that writes can be put right:
 *   the plan        "edit plan" on any planned line — the PPC form again; or undo it: the line goes back to PPC
 *                   (its fabric-ready and reservation go with it). Locked parts are said, never silently ignored:
 *                   a line whose fabric is on a challan keeps its fabric/route/printer until the challan is
 *                   cancelled; a changed accessory list lets go of the old reservation; changed cloth undoes
 *                   "fabric ready" (it was ready for the OLD plan).
 *   a challan       Edit (vendor, date, metres, note; untick a line to take it off) or Cancel with a reason —
 *                   only while nothing has been received against it. A cancelled challan keeps its number and
 *                   shows as cancelled; its lines go back to Demand · RFD.
 *   a receipt       Undo the last receipt (re-opens a challan it closed); Reopen a challan closed by hand. */

/** Why a planned line's fabric cannot change: it already left on a challan that is not cancelled. */
const flowFabLocked = s => !!(s && s.challan);

/** Applied by the PPC form's save when it re-plans a line that already had a plan (flow-ppc.js calls it). Returns the
 *  extra writes and what was said about them. */
function flowReplanSide(old, nu, s) {
  const patch = {}, said = [];
  if (!old || !s) return { patch, said };
  const accSig = p => JSON.stringify(((p && p.acc) || []).filter(a => a.code && +a.qty > 0).map(a => [accCode(a.code), +a.qty]).sort());
  if (s.res && accSig(old) !== accSig(nu)) { patch['pt_accReserve/' + s.key] = null; said.push('accessories changed — the old reservation was let go; reserve again'); }
  const fr = s.demand && s.demand.fabricReady;
  const fabSig = p => [p && p.fabric && flowFabKey(p.fabric.name), p && p.fabric && flowR2(p.fabric.metres), flowRouteOf(p)].join('|');
  if (fr && !fr.challan && fabSig(old) !== fabSig(nu)) { patch[`pt_flowDemand/${s.key}/fabricReady`] = null; said.push('fabric changed — "fabric ready" was undone; mark it again'); }
  return { patch, said };
}

/** Undo a plan: the line goes back to PPC. Not while its fabric is on a challan. */
async function flowUnplan(s) {
  if (flowFabLocked(s)) return `Its fabric is on challan ${s.challan.no} — cancel that challan first (Demand history).`;
  const patch = { ['pt_ppc/' + s.key]: null, ['pt_flowDemand/' + s.key]: null, ['pt_accReserve/' + s.key]: null };
  const row = flowRows().find(x => x.s.key === s.key), pos = row ? flowPoSync([{ r: row.r, p: null }], dToday()) : { patch: {}, local: FLOW.po };
  Object.assign(patch, pos.patch);
  const vop = await flowVoPrepare(pos.local, patch, () => null);
  if (vop.ask && !confirm(vop.ask)) { vop.undo(); return 'Not undone — the Vendor Order was left as it is.'; }
  try { await ptPatch(patch); } catch (e) { vop.undo(); return 'Could not save: ' + (e.message || e); }
  FLOW.po = pos.local; flowVoAfter(vop.placed);
  const drop = (o) => { const n = Object.assign({}, o); delete n[s.key]; return n; };
  FLOW.ppc = drop(FLOW.ppc); FLOW.dem = drop(FLOW.dem); FLOW.res = drop(FLOW.res);
  return '';
}

/* ---- challans ---- */
const flowChHasRecv = c => Object.keys(c.receipts || {}).length > 0;

function flowChallanEditOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  if (flowChHasRecv(c)) { $('flMsg').className = 'err'; $('flMsg').textContent = `${no} has fabric received against it — undo the receipt first.`; return; }
  const vens = flowChVendors();
  ptOpenDialog({
    title: `Edit ${no}`,
    subtitle: `${c.orderNo}. Nothing has come back against it yet, so it can still change. Untick a line to take it off — it goes back to Demand · RFD fabric.`,
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Vendor<select id="flceVen">${vens.map(v => `<option value="${esc(v.code)}"${String(v.code) === String(c.vendor && c.vendor.code) ? ' selected' : ''}>${esc((v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('')}</select></label>
        <label>Date<input id="flceDate" type="date" value="${esc(c.date || dToday())}"></label></div>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th></th><th style="text-align:left">SKU</th><th style="text-align:left">Fabric</th><th>Metres</th></tr></thead><tbody>
      ${(c.lines || []).map((l, i) => `<tr><td><input type="checkbox" data-cek="${i}" checked style="width:auto"></td><td style="text-align:left"><b>${esc(l.sku)}</b></td><td style="text-align:left">${esc(l.fabric)}</td>
        <td class="num"><input data-cem="${i}" type="number" step="0.01" value="${esc(l.metres)}" style="width:90px;padding:3px 6px;font-size:12px"></td></tr>`).join('')}
      </tbody></table><label style="display:block;margin-top:8px">Note<input id="flceNote" value="${esc(c.note || '')}"></label>`,
    saveLabel: 'Save the challan',
    onSave: async () => {
      const v = vens.find(x => String(x.code) === String($('flceVen').value)); if (!v) return 'Pick the vendor.';
      const keep = [], drop = [];
      (c.lines || []).forEach((l, i) => { const on = (document.querySelector(`[data-cek="${i}"]`) || {}).checked;
        const m = flowR2(+((document.querySelector(`[data-cem="${i}"]`) || {}).value || 0));
        (on ? keep : drop).push(Object.assign({}, l, { metres: on ? m : l.metres })); });
      if (!keep.length) return 'Every line is unticked — use Cancel to cancel the whole challan.';
      /* Same rule as making it: a line goes to the printer PPC planned for it. */
      const pOf = l => { const pl = (FLOW.ppc || {})[l.key]; return l.ruffleOnly ? flowRufflePrinter(pl) : (pl && pl.printer); };
      const other = keep.filter(l => { const pp = pOf(l), pc = pp && pp.code; return pc && String(pc) !== String(v.code); });
      if (other.length) return `${other.map(l => `${l.sku}${l.ruffleOnly ? '\'s ruffle' : ''} is planned for ${pOf(l).name}`).join(' · ')} — untick it, or change its printer with "edit plan" first.`;
      const noM = keep.filter(l => !(l.metres > 0)).map(l => l.sku); if (noM.length) return `How many metres for ${noM.join(', ')}?`;
      const vname = v.desc || v.name || v.code, now = new Date().toISOString();
      const nc = Object.assign({}, c, { vendor: { code: v.code, name: vname }, date: $('flceDate').value || c.date, note: $('flceNote').value.trim(), lines: keep, editedAt: now, editedBy: ME.email || '' });
      const patch = { ['pt_flowChallans/' + no]: nc };
      keep.filter(l => !l.ruffleOnly).forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = { at: now, by: ME.email || '', what: l.fabric, metres: l.metres, note: `Challan ${no} to ${vname}`, challan: no, vendor: vname }; });
      drop.filter(l => !l.ruffleOnly).forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = null; });
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: nc });
      const dem = Object.assign({}, FLOW.dem);
      keep.concat(drop).filter(l => !l.ruffleOnly).forEach(l => { dem[l.key] = Object.assign({}, dem[l.key] || {}, { fabricReady: patch[`pt_flowDemand/${l.key}/fabricReady`] }); });
      FLOW.dem = dem;
      renderFlow();
      return '';
    },
  });
}

function flowChallanCancelOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  if (flowChHasRecv(c)) { $('flMsg').className = 'err'; $('flMsg').textContent = `${no} has fabric received against it — undo the receipt first, or close it short.`; return; }
  ptOpenDialog({
    title: `Cancel ${no}`,
    subtitle: `The challan keeps its number and shows as cancelled. Its ${nf((c.lines || []).length)} line(s) go back to Demand · RFD fabric.`,
    html: '<label>Why (wrong vendor, wrong order, made twice…)<input id="flccWhy"></label>',
    saveLabel: 'Cancel the challan',
    onSave: async () => {
      const why = $('flccWhy').value.trim(); if (!why) return 'Say why it is cancelled.';
      const val = { at: new Date().toISOString(), by: ME.email || '', why };
      const patch = { [`pt_flowChallans/${no}/cancelled`]: val };
      (c.lines || []).filter(l => !l.ruffleOnly).forEach(l => { const fr = FLOW.dem && FLOW.dem[l.key] && FLOW.dem[l.key].fabricReady;
        if (fr && fr.challan === no) patch[`pt_flowDemand/${l.key}/fabricReady`] = null; });
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: Object.assign({}, c, { cancelled: val }) });
      const dem = Object.assign({}, FLOW.dem);
      Object.keys(patch).filter(k => k.startsWith('pt_flowDemand/')).forEach(k => { const key = k.split('/')[1]; dem[key] = Object.assign({}, dem[key], { fabricReady: null }); });
      FLOW.dem = dem;
      renderFlow();
      return '';
    },
  });
}

/** Take back the newest receipt — typed wrong. A challan it closed opens again. */
async function flowUndoReceipt(no) {
  const c = (FLOW.ch || {})[no]; if (!c || !flowChHasRecv(c)) return 'Nothing received on it to undo.';
  const [id, rc] = Object.entries(c.receipts).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))[0];
  if (!confirm(`Undo the receipt of ${flowMixTxt(Object.entries(rc.items || {}).map(([k, q]) => [q, flowChUnit((c.lines || []).find(l => l.key === k))]))} on ${rc.date} against ${no}?`)) return '';
  const patch = { [`pt_flowChallans/${no}/receipts/${id}`]: null };
  if (c.closed && !c.closed.short) patch[`pt_flowChallans/${no}/closed`] = null;
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  const receipts = Object.assign({}, c.receipts); delete receipts[id];
  const nc = Object.assign({}, c, { receipts }); if (patch[`pt_flowChallans/${no}/closed`] === null) delete nc.closed;
  FLOW.ch = Object.assign({}, FLOW.ch, { [no]: nc });
  return '';
}
/** Open a challan closed by hand (closed short) again. */
async function flowReopen(no) {
  const c = (FLOW.ch || {})[no]; if (!c || !c.closed) return '';
  try { await ptPatch({ [`pt_flowChallans/${no}/closed`]: null }); } catch (e) { return 'Could not save: ' + (e.message || e); }
  const nc = Object.assign({}, c); delete nc.closed;
  FLOW.ch = Object.assign({}, FLOW.ch, { [no]: nc });
  return '';
}
