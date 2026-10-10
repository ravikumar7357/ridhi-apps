/* ================= PRODUCTION FLOW · DEMAND HISTORY — challans, and the printed fabric received against them =================
 * Ravi, 10 Oct: the challans do not belong in Demand; they go to a Demand history tab, and "jab mal aay to yahin se
 * challan guy entry kare ki ye mal aaya h ya nahi, then move ho store me, or yahan se open challan close ho jay".
 *   pt_flowChallans/<no>/receipts/<id> = { date, items: { LINEKEY: metres }, note, at, by }
 *   pt_flowChallans/<no>/closed = { at, by, why }   — set by itself when every line is back, or by hand ("close short")
 * A line on a challan IS given to that printer (Vendor allocation is done by the challan). Its printed fabric is back
 * in the share received of what was sent; a closed challan sends its lines on to the store (cutting) whatever came. */

/** Every challan's lines, by line key: { no, vendor, sent, recv, closed } — cached on FLOW.ch. */
let FLOW_CHX = { src: null, map: {} };
function flowChIndex() {
  if (FLOW_CHX.src === FLOW.ch) return FLOW_CHX.map;
  const map = {};
  Object.values(FLOW.ch || {}).forEach(c => {
    const recv = flowChRecv(c);
    (c.lines || []).forEach(l => { const e = map[l.key] || (map[l.key] = { no: c.no, vendor: c.vendor && c.vendor.name, sent: 0, recv: 0, closed: true });
      e.no = c.no; e.vendor = c.vendor && c.vendor.name; e.sent += +l.metres || 0; e.recv += recv[l.key] || 0; e.closed = e.closed && !!c.closed; });
  });
  FLOW_CHX = { src: FLOW.ch, map };
  return map;
}
/** Metres received so far, per line key, on one challan. */
function flowChRecv(c) {
  const out = {};
  Object.values(c.receipts || {}).forEach(rc => Object.entries(rc.items || {}).forEach(([k, m]) => { out[k] = flowR2((out[k] || 0) + (+m || 0)); }));
  return out;
}
function flowChState(c) {
  if (c.closed) return 'closed';
  const recv = flowChRecv(c), any = Object.values(recv).some(m => m > 0);
  return any ? 'part' : 'open';
}

/** The Demand history list: open challans first, then the closed ones. */
function flowHistTable(q) {
  const list = Object.values(FLOW.ch || {})
    .filter(c => !q || [c.no, c.orderNo, c.vendor && c.vendor.name].concat((c.lines || []).map(l => l.sku)).join(' ').toLowerCase().includes(q))
    .sort((a, b) => (flowChState(a) === 'closed') - (flowChState(b) === 'closed') || String(b.no).localeCompare(String(a.no)));
  const pill = st => st === 'closed' ? '<span class="jw-st done">closed</span>' : st === 'part' ? '<span class="jw-st prog">part received</span>' : '<span class="jw-st pend">open</span>';
  const body = list.map(c => { const recv = flowChRecv(c), st = flowChState(c);
    const sent = flowR2((c.lines || []).reduce((a, l) => a + (+l.metres || 0), 0)), got = flowR2(Object.values(recv).reduce((a, m) => a + m, 0));
    return `<tr><td class="frz" style="text-align:left"><b>${esc(c.no)}</b>${flowIsTest(c.orderNo) ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}<div class="muted" style="font-size:10.5px">${esc(c.date || '')}</div></td>
      <td style="text-align:left">${esc(c.orderNo)}</td><td style="text-align:left"><b>${esc(c.vendor && c.vendor.name)}</b></td>
      <td style="text-align:left;font-size:11.5px">${(c.lines || []).map(l => `${esc(l.sku)} · ${nf(l.metres)} m${recv[l.key] ? ` <span style="color:#166534">(${nf(recv[l.key])} back)</span>` : ''}`).join('<br>')}</td>
      <td class="num">${nf(sent)} m</td><td class="num">${nf(got)} m</td>
      <td>${pill(st)}${c.closed && c.closed.why ? `<div class="muted" style="font-size:10.5px">${esc(c.closed.why)}</div>` : ''}</td>
      <td style="white-space:nowrap">${st !== 'closed' ? `<button data-flchr="${esc(c.no)}" style="width:auto;padding:3px 10px;font-size:12px">Receive</button> <button class="ghost" data-flchc="${esc(c.no)}" style="width:auto;padding:2px 8px;font-size:11.5px">Close short</button> ` : ''}<button class="ghost" data-flchp="${esc(c.no)}" style="width:auto;padding:2px 8px;font-size:11.5px">Print</button></td></tr>`; }).join('');
  return `<thead><tr><th class="frz" style="text-align:left">Challan</th><th style="text-align:left">Order</th><th style="text-align:left">Vendor</th><th style="text-align:left">Lines · sent</th><th>Sent</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>`
    + (body || '<tr><td colspan="8" class="muted" style="padding:16px">No challan yet — they are made in Demand · RFD fabric.</td></tr>') + '</tbody>';
}

/** Printed fabric back from the printer against a challan: metres per line. Closes by itself when all of it is back. */
function flowReceiveOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  const recv = flowChRecv(c);
  ptOpenDialog({
    title: `Receive against ${no}`,
    subtitle: `${c.orderNo} · ${c.vendor && c.vendor.name}. Type the printed metres that came back now. When every line is back the challan closes and the lines move to the store (Cutting) by themselves.`,
    html: `<label>Date<input id="flrDate" type="date" value="${esc(dToday())}"></label>
      <table class="xl" style="margin-top:8px;width:100%"><thead><tr><th style="text-align:left">SKU</th><th>Sent</th><th>Back so far</th><th>Received now (m)</th></tr></thead><tbody>
      ${(c.lines || []).map((l, i) => { const left = flowR2(Math.max(0, (+l.metres || 0) - (recv[l.key] || 0)));
        return `<tr><td style="text-align:left"><b>${esc(l.sku)}</b><div class="muted" style="font-size:10.5px">${esc(l.item || '')}</div></td><td class="num">${nf(l.metres)}</td><td class="num">${nf(recv[l.key] || 0)}</td>
          <td class="num"><input data-flrm="${i}" type="number" step="0.01" min="0" value="${left > 0 ? esc(left) : ''}" ${left > 0 ? '' : 'disabled'} style="width:95px;padding:3px 6px;font-size:12px"></td></tr>`; }).join('')}
      </tbody></table><label style="display:block;margin-top:8px">Note (lot, vehicle, quality…)<input id="flrNote"></label>`,
    saveLabel: 'Received',
    onSave: async () => {
      const items = {};
      (c.lines || []).forEach((l, i) => { const m = +((document.querySelector(`[data-flrm="${i}"]`) || {}).value || 0); if (m > 0) items[l.key] = flowR2(m); });
      if (!Object.keys(items).length) return 'Type the metres that came back for at least one line.';
      const over = (c.lines || []).filter(l => (recv[l.key] || 0) + (items[l.key] || 0) > (+l.metres || 0) * 1.1).map(l => l.sku);
      if (over.length) return `More than 10% over what was sent for ${over.join(', ')} — check the metres.`;
      const now = new Date().toISOString(), id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rc = { date: $('flrDate').value || dToday(), items, note: $('flrNote').value.trim(), at: now, by: ME.email || '' };
      const allBack = (c.lines || []).every(l => (recv[l.key] || 0) + (items[l.key] || 0) >= (+l.metres || 0) - 0.01);
      const patch = { [`pt_flowChallans/${no}/receipts/${id}`]: rc };
      if (allBack) patch[`pt_flowChallans/${no}/closed`] = { at: now, by: ME.email || '', why: 'all received' };
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      const nc = Object.assign({}, c, { receipts: Object.assign({}, c.receipts, { [id]: rc }) });
      if (allBack) nc.closed = patch[`pt_flowChallans/${no}/closed`];
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: nc });
      renderFlow();
      return '';
    },
  });
}
/** Close a challan that will not come back in full — the reason is kept, and its lines move on with what came. */
function flowCloseShortOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  ptOpenDialog({
    title: `Close ${no} short`,
    subtitle: 'What has not come back will not come. The lines move on to the store with what was received.',
    html: '<label>Why (shortage, damage, the printer kept it…)<input id="flcWhy"></label>',
    saveLabel: 'Close the challan',
    onSave: async () => {
      const why = $('flcWhy').value.trim(); if (!why) return 'Say why it is closed short.';
      const val = { at: new Date().toISOString(), by: ME.email || '', why, short: true };
      try { await ptPatch({ [`pt_flowChallans/${no}/closed`]: val }); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: Object.assign({}, c, { closed: val }) });
      renderFlow();
      return '';
    },
  });
}

/* ---- the printer PPC gives a printed line to — suggested from the current planning ----
 * 1. Printer Allocation: the printer fed against that brand + colour (the colour IS the design)
 * 2. else the printer this colour was last given to — a vendor order with one of its SKUs, or an earlier challan
 * Nothing found → blank, and PPC picks. */
function flowPrinterFor(r) {
  const m = cutSkuOf(r.sku) || {}, color = String(m.color || r.color || '').trim(), brand = m.brand || '';
  let vens = []; try { vens = flowChVendors(); } catch (e) { vens = []; }
  const find = x => { const k = String(x || '').trim().toLowerCase(); if (!k) return null;
    return vens.find(v => [v.code, v.desc, v.name].some(y => String(y || '').trim().toLowerCase() === k)) || null; };
  const as = (v, why) => ({ code: v.code, name: v.desc || v.name || v.code, why });
  if (color) {
    try { const info = palInfoOf(palKey(brand, color)); const v = find(info && info.printer); if (v) return as(v, `Printer Allocation: ${color} is allocated to this printer`); } catch (e) { /* allocation not read */ }
    let best = null;
    try { (VO.rows || []).forEach(o => voLines(o).forEach(l => { const lm = l.sku && cutSkuOf(l.sku);
      if (lm && String(lm.color || '').trim() === color && (!best || String(o.orderDate || '') > String(best.date))) best = { code: o.vendorCode, date: String(o.orderDate || '') }; })); } catch (e) { /* vendor orders not read */ }
    Object.values(FLOW.ch || {}).forEach(c => (c.lines || []).forEach(l => { const lm = cutSkuOf(l.sku);
      if (lm && String(lm.color || '').trim() === color && (!best || String(c.date || '') > best.date)) best = { code: c.vendor && c.vendor.code, date: String(c.date || '') }; }));
    const v = best && find(best.code); if (v) return as(v, `last given ${color} (${best.date.slice(0, 10)})`);
  }
  return { code: '', name: '', why: color ? `no printer allocated to ${color} yet` : 'no colour on the master' };
}
