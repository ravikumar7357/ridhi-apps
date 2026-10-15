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
  const g = await flowGuard('acc'); if (g) return g;   // the shelf is shared: two reservations at once must not both take the same zips
  try { await ptPatch({ ['pt_accReserve/' + s.key]: rec }); } catch (e) { return 'Could not save: ' + (e.message || e); }
  FLOW.res = Object.assign({}, FLOW.res, { [s.key]: rec });
  return '';
}
async function flowUnreserve(s) {
  const g = await flowGuard('acc'); if (g) return g;
  try { await ptPatch({ ['pt_accReserve/' + s.key]: null }); } catch (e) { return 'Could not save: ' + (e.message || e); }
  FLOW.res = Object.assign({}, FLOW.res); delete FLOW.res[s.key];
  return '';
}

/** The store says the fabric for a line is ready: what, how much, a note. */
function flowFabricOpen(r, s) {
  const p = s.plan || {}, cur = s.demand && s.demand.fabricReady;
  ptOpenDialog({
    title: `Fabric ready — ${r.orderNo} · ${obUC(r.sku)}`,
    subtitle: (() => { const st = p.fabric && p.fabric.name ? flowRfdStock(p.fabric.name) : 0;
      return `PPC raised: ${p.fabric ? `${p.fabric.name || '?'} · ${nf(p.fabric.metres)} m` : 'no fabric'}${p.print && p.print.need ? ' · to be printed by a vendor' : ' · no printing'}.`
        + ` RFD in stock for this fabric: ${nf(flowR2(st))} m${p.fabric && st < +p.fabric.metres ? ' — LESS than this line needs' : ''}.`; })(),
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

/* ---- RFD fabric: what is in stock against what the waiting lines need (Ravi, 10 Oct: "instock rfd kitna h and us
 * particular order me kitna fabric use hoga, if short it will give me a red flag") ----
 * Stock is the Fabric register's RFD balance for that fabric (fabStockOf). Lines already marked ready whose cloth has
 * not moved yet (nothing given to a printer, cut or issued) still sit in that balance, so they are taken off it first —
 * otherwise two orders would be shown the same metres. The rest is handed out oldest order first; a line the stock
 * does not reach is short by what it misses. */
const flowFabKey = n => String(n || '').trim().toUpperCase();
function flowRfdStock(name) {
  /* The Greige Desk's RFD on the shelf counts too (its own records, flow/greige-desk.js). */
  let desk = 0; try { desk = FLOW_ON && typeof GD !== 'undefined' ? +GD.rfdShelf(name) || 0 : 0; } catch (e) { desk = 0; }
  try { return Math.max(0, +fabStockOf(name, 'RFD') || 0) + desk; } catch (e) { return desk; }
}
function flowRfdCover() {
  const rows = flowRows(), fab = {}, line = {};
  const F = name => { const k = flowFabKey(name); return fab[k] || (fab[k] = { name: String(name || '').trim(), stock: flowRfdStock(name), held: 0, need: 0, lines: 0 }); };
  rows.forEach(({ s }) => {
    const fr = s.demand && s.demand.fabricReady, p = s.plan;
    /* A line on a challan has left the store on paper, not in the register: kept until the printed cloth is back. */
    if (!fr || !p || s.route === 'outsource' || s.cut || s.issued || (fr.challan ? s.back : s.given)) return;
    const name = fr.what || (p.fabric && p.fabric.name); if (!name) return;
    F(name).held += +fr.metres || +(p.fabric && p.fabric.metres) || 0;
  });
  rows.filter(x => flowInView('drfd', x.s))
    .sort((a, b) => String(a.r.orderDate || '').localeCompare(String(b.r.orderDate || '')) || String(a.r.orderNo).localeCompare(String(b.r.orderNo)))
    .forEach(({ s }) => {
      const p = s.plan || {}, name = p.fabric && p.fabric.name;
      const need = s.route === 'inhouse' ? flowFabOwed({ qty: p.qty || 0 }, s).metres : flowToPrint({ qty: p.qty || 0 }, p).metres;
      if (!name) { line[s.key] = { name: '', need, short: need, avail: 0 }; return; }
      const f = F(name), avail = Math.max(0, f.stock - f.held - f.need);
      line[s.key] = { name: f.name, need, avail: flowR2(avail), short: flowR2(Math.max(0, need - avail)) };
      f.need = flowR2(f.need + need); f.lines++;
    });
  Object.values(fab).forEach(f => { f.free = flowR2(f.stock - f.held); f.short = flowR2(Math.max(0, f.need - Math.max(0, f.free))); });
  return { fab, line };
}
/** Accessories the same way, for the Accessories department: on the shelf, held, and what the lines waiting need. */
function flowAccCover() {
  const free = flowAccFree(), want = {};
  flowRows().filter(x => flowInView('dacc', x.s)).forEach(({ s }) => ((s.plan && s.plan.acc) || []).forEach(a => {
    if (!a.code || !(+a.qty > 0)) return; const c = accCode(a.code);
    want[c] = (want[c] || 0) + (+a.qty);
  }));
  return Object.keys(want).sort().map(c => { const f = free[c] || { name: c, shelf: 0, held: 0, free: 0 };
    return { code: c, name: f.name, shelf: f.shelf, held: f.held, free: f.free, need: want[c], short: Math.max(0, want[c] - Math.max(0, f.free)) }; });
}
