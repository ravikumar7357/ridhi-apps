/* ================= PRODUCTION FLOW · DEMAND — fabric ready, accessories reserved =================
 * A planned line waits here until (a) its fabric is ready — the store says so, with what and how much — and (b) every
 * accessory PPC raised for it is RESERVED: held for this line so no other order takes it.
 *
 * A RESERVATION LETS GO BY ITSELF as the line is issued to karigars: the zipper is taken off the shelf at issue
 * (ptConsumeZippers), so what is still held is the reservation × the share of the line not yet issued. Counting the
 * full reservation AND the issue would hold the same zipper twice.
 *   pt_flowDemand/<line> = { fabricReady: { at, by, what, metres, note } }
 *   pt_accReserve/<line> = { orderNo, sku, items: { CODE: qty }, at, by } */

/** What a reservation still holds now: its items × the share of the line not yet issued. */
function flowHeld(key, issued, qty) {
  const res = (FLOW.res || {})[key]; if (!res || !res.items) return {};
  const left = qty > 0 ? Math.max(0, 1 - (+issued || 0) / qty) : 0, out = {};
  Object.entries(res.items).forEach(([code, n]) => { const h = Math.ceil((+n || 0) * left); if (h > 0) out[accCode(code)] = h; });
  return out;
}
/** Every accessory: on the shelf, held for lines, free to reserve. */
function flowAccFree() {
  const held = {};
  flowRows().forEach(({ r, s }) => Object.entries(flowHeld(s.key, s.issued, +r.qty || 0)).forEach(([c, n]) => { held[c] = (held[c] || 0) + n; }));
  const out = {};
  (accBalances() || []).forEach(b => { const c = accCode(b.code); out[c] = { name: b.name || c, shelf: +b.qty || 0, held: held[c] || 0, free: (+b.qty || 0) - (held[c] || 0) }; });
  Object.keys(held).forEach(c => { if (!out[c]) out[c] = { name: c, shelf: 0, held: held[c], free: -held[c] }; });
  return out;
}

/** Reserve every accessory this line's plan raised — all of it, or none, with what is short named. */
async function flowReserve(r, s) {
  const items = {};
  ((s.plan && s.plan.acc) || []).forEach(a => { if (a.code && +a.qty > 0) items[accCode(a.code)] = (items[accCode(a.code)] || 0) + (+a.qty); });
  if (!Object.keys(items).length) return 'Nothing to reserve: the plan raised no accessory from the shelf.';
  const free = flowAccFree(), short = Object.entries(items).filter(([c, n]) => !free[c] || free[c].free < n);
  if (short.length) return 'Short: ' + short.map(([c, n]) => `${c} needs ${n}, ${free[c] ? Math.max(0, free[c].free) : 0} free`).join(' · ') + ' — buy or free some first.';
  const rec = { orderNo: r.orderNo, sku: obUC(r.sku), items, at: new Date().toISOString(), by: ME.email || '' };
  try { await ptPatch({ ['pt_accReserve/' + s.key]: rec }); } catch (e) { return 'Could not save: ' + (e.message || e); }
  FLOW.res = Object.assign({}, FLOW.res, { [s.key]: rec });
  return '';
}
async function flowUnreserve(s) {
  try { await ptPatch({ ['pt_accReserve/' + s.key]: null }); } catch (e) { return 'Could not save: ' + (e.message || e); }
  FLOW.res = Object.assign({}, FLOW.res); delete FLOW.res[s.key];
  return '';
}

/** The store says the fabric for a line is ready: what, how much, a note. */
function flowFabricOpen(r, s) {
  const p = s.plan || {}, cur = s.demand && s.demand.fabricReady;
  ptOpenDialog({
    title: `Fabric ready — ${r.orderNo} · ${obUC(r.sku)}`,
    subtitle: `PPC raised: ${p.fabric ? `${p.fabric.name || '?'} · ${nf(p.fabric.metres)} m` : 'no fabric'}${p.print && p.print.need ? ' · to be printed by a vendor' : ''}.`,
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
      <label>Fabric<input id="flfWhat" value="${esc((cur && cur.what) || (p.fabric && p.fabric.name) || '')}"></label>
      <label>Metres ready<input id="flfM" type="number" step="0.01" value="${esc((cur && cur.metres) || (p.fabric && p.fabric.metres) || '')}"></label>
      <label>Note (where it is: RFD in store, sent to the printer, greige ordered…)<input id="flfNote" value="${esc((cur && cur.note) || '')}"></label>
      ${cur ? '<label style="display:flex;gap:6px;align-items:center"><input id="flfUndo" type="checkbox" style="width:auto"> Not ready after all — take it back</label>' : ''}</div>`,
    saveLabel: 'Fabric is ready',
    onSave: async () => {
      const undo = $('flfUndo') && $('flfUndo').checked;
      const metres = +($('flfM').value || 0), need = (p.fabric && +p.fabric.metres) || 0;
      if (!undo && need && metres < need) return `PPC raised ${nf(need)} m; ${nf(metres)} m is not all of it. Ready means all of it.`;
      const val = undo ? null : { at: new Date().toISOString(), by: ME.email || '', what: $('flfWhat').value.trim(), metres, note: $('flfNote').value.trim() };
      try { await ptPatch({ [`pt_flowDemand/${s.key}/fabricReady`]: val }); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.dem = Object.assign({}, FLOW.dem, { [s.key]: Object.assign({}, FLOW.dem[s.key] || {}, { fabricReady: val }) });
      renderFlow();
      return '';
    },
  });
}
