/* ================= PRODUCTION FLOW · DEMAND HISTORY — challans, and the printed fabric received against them =================
 * Ravi, 10 Oct: the challans do not belong in Demand; they go to a Demand history tab, and "jab mal aay to yahin se
 * challan guy entry kare ki ye mal aaya h ya nahi, then move ho store me, or yahan se open challan close ho jay".
 *   pt_flowChallans/<no>/receipts/<id> = { date, items: { LINEKEY: metres }, note, at, by }
 *   pt_flowChallans/<no>/closed = { at, by, why }   — set by itself when every line is back, or by hand ("close short")
 * A line on a challan IS given to that printer (Vendor allocation is done by the challan). Its printed fabric is back
 * in the share received of what was sent; a closed challan sends its lines on to the store (cutting) whatever came. */

/* RECEIVED IN THE UNIT IT WAS GIVEN (Ravi, 10 Oct: "jis form me order de raha hu printing ke liye, usi form me milna
 * chahiye"). A line printed on the SKU itself (cutting not required) goes out as PIECES and comes back as pieces —
 * 10 given, 10 back — whatever cloth they take (shown beside, for information). Printed cloth goes and comes in metres.
 * A challan made before lines knew what they print is metres, as it was. */
const flowChUnit = l => (l && l.print && l.print.kind === 'sku' ? 'pcs' : 'm');
const flowChSent = l => (flowChUnit(l) === 'pcs' ? (+l.pcs || 0) : (+l.metres || 0));
const flowQtyTxt = (q, u) => nf(flowR2(q)) + (u === 'pcs' ? ' pcs' : ' m');
/** Totals in mixed units, each said in its own: "105.75 m · 45 pcs". */
const flowMixTxt = parts => { const t = { m: 0, pcs: 0 }; parts.forEach(([q, u]) => { t[u] += +q || 0; });
  return [t.m ? flowQtyTxt(t.m, 'm') : '', t.pcs ? flowQtyTxt(t.pcs, 'pcs') : ''].filter(Boolean).join(' · ') || '0'; };
/** Every challan's lines, by line key: { no, vendor, sent, recv, closed } — cached on FLOW.ch. */
let FLOW_CHX = { src: null, map: {} };
function flowChIndex() {
  if (FLOW_CHX.src === FLOW.ch) return FLOW_CHX.map;
  const map = {};
  Object.values(FLOW.ch || {}).forEach(c => {
    if (c.cancelled) return;   // a cancelled challan gave nothing to anybody
    const recv = flowChRecv(c);
    (c.lines || []).forEach(l => { const k = l.ruffleOnly ? l.key + FLOW_RUF : l.key, e = map[k] || (map[k] = { no: c.no, vendor: c.vendor && c.vendor.name, sent: 0, recv: 0, closed: true });
      e.no = c.no; e.vendor = c.vendor && c.vendor.name; e.sent += flowChSent(l); e.recv += recv[l.key] || 0; e.closed = e.closed && !!c.closed; });
  });
  FLOW_CHX = { src: FLOW.ch, map };
  return map;
}
/* SEEN IN HISTORY (Ravi, 11 Oct: "dekhne ke liye hum History tab use karenge, Printed fabric in ko hata dete h"). Every
 * receipt on a flow challan is a row of Vendors & printers → History (voLogRows) — accepted as it was received, by who
 * received it — and so, like a printer's delivery, printed cloth / printed pieces IN at the store, which reads the same
 * log. Preview only (FLOW_ON); a TEST challan's rows say TEST. History does not change them: they are changed on the
 * challan (Demand history: undo receipt). */
function flowVlogRows() {
  if (typeof FLOW_ON === 'undefined' || !FLOW_ON || !FLOW.ch) return [];
  const out = [];
  Object.values(FLOW.ch).forEach(c => {
    if (!c || c.cancelled) return;
    Object.entries(c.receipts || {}).forEach(([rid, rc]) => Object.entries((rc && rc.items) || {}).forEach(([key, q]) => {
      const qty = +q || 0, l = (c.lines || []).find(x => x.key === key); if (!qty || !l) return;
      const u = flowChUnit(l), run = u === 'm';
      let m = {}; try { m = cutSkuOf(l.sku) || {}; } catch (e) { m = {}; }
      const colour = String(m.color || String(l.item || '').split(' · ')[1] || '').trim();
      const code = l.ruffleOnly ? (l.extras || []).map(x => x.code).filter(Boolean).join(' + ')
        : l.print && l.print.sides && l.print.sides.length ? l.print.sides.map(sd => sd.code).join(' + ') : ((l.print && l.print.code) || '');
      const day = voDayOf(rc.date || String(rc.at || '').slice(0, 10)), test = /^T/.test(String(c.no));
      out.push({ day, key: voDayKey(day), raw: String(rc.date || ''), li: -1, di: -1, del: { qty, date: rc.date, by: rc.by || '', at: rc.at || '' },
        ok: { qty, at: rc.at || '', by: rc.by || '', note: (test ? 'TEST · ' : '') + 'received on challan ' + c.no + (rc.note ? ' · ' + rc.note : '') },
        key2: 'flow/' + c.no + '/' + rid + '/' + key, vendorCode: (c.vendor && c.vendor.code) || '', vendor: (c.vendor && c.vendor.name) || '',
        orderNo: (test ? 'TEST · ' : '') + c.no + ' · ' + (l.orderNo || c.orderNo || ''), id: c.no, run, unit: u, printing: true,
        sku: run ? code : obUC(l.sku), fabric: run ? (l.fabric || '') : '', colour,
        what: run ? [code, l.fabric, colour].filter(Boolean).join(' · ') + (l.ruffleOnly ? ' (ruffle)' : '') + ' — for ' + obUC(l.sku) : (l.item || l.sku),
        qty, by: rc.by || '', at: rc.at || '', flow: true, test });
    }));
  });
  return out;
}
/** Received so far, per line key, on one challan — in the line's own unit (metres, or pieces). */
function flowChRecv(c) {
  const out = {};
  Object.values(c.receipts || {}).forEach(rc => Object.entries(rc.items || {}).forEach(([k, m]) => { out[k] = flowR2((out[k] || 0) + (+m || 0)); }));
  return out;
}
function flowChState(c) {
  if (c.cancelled) return 'cancelled';
  if (c.closed) return 'closed';
  const recv = flowChRecv(c), any = Object.values(recv).some(m => m > 0);
  return any ? 'part' : 'open';
}

/** The Demand history list: open challans first, then the closed ones. */
function flowHistTable(q, testOnly) {
  /* A cancelled challan is not shown (Ravi, 19 Oct: "cancel order yaha show hi n ho") — it moved nothing and owes nothing. */
  const list = Object.values(FLOW.ch || {}).filter(c => c && !c.cancelled && (!testOnly || flowIsTest(c.orderNo)))
    .filter(c => !q || [c.no, c.orderNo, c.vendor && c.vendor.name].concat((c.lines || []).map(l => l.sku)).join(' ').toLowerCase().includes(q))
    .sort((a, b) => (['closed', 'cancelled'].includes(flowChState(a))) - (['closed', 'cancelled'].includes(flowChState(b))) || String(b.no).localeCompare(String(a.no)));
  const pill = st => st === 'cancelled' ? '<span class="jw-st" style="background:#f1f5f9;color:#64748b">cancelled</span>' : st === 'closed' ? '<span class="jw-st done">closed</span>' : st === 'part' ? '<span class="jw-st prog">part received</span>' : '<span class="jw-st pend">open</span>';
  const body = list.map(c => { const recv = flowChRecv(c), st = flowChState(c);
    const sent = flowMixTxt((c.lines || []).map(l => [flowChSent(l), flowChUnit(l)])), got = flowMixTxt((c.lines || []).map(l => [recv[l.key] || 0, flowChUnit(l)]));
    return `<tr><td class="frz" style="text-align:left"><b>${esc(c.no)}</b>${flowIsTest(c.orderNo) ? ' <span class="navbadge" style="background:#7c3aed;position:static">TEST</span>' : ''}<div class="muted" style="font-size:10.5px">${esc(c.date || '')}</div></td>
      <td style="text-align:left">${esc(c.orderNo)}${(c.orders || [c.orderNo]).map(o => typeof ordBuyerOf === 'function' ? ordBuyerOf(o) : '').filter(Boolean).filter((b, i, a) => a.indexOf(b) === i).map(b => `<div style="font-size:12px;font-weight:600">${esc(b)}</div>`).join('')}</td><td style="text-align:left"><b>${esc(c.vendor && c.vendor.name)}</b></td>
      <td style="text-align:left;font-size:11.5px">${(c.lines || []).map(l => `${esc(l.sku)} · ${flowQtyTxt(flowChSent(l), flowChUnit(l))}${recv[l.key] ? ` <span style="color:#166534">(${flowQtyTxt(recv[l.key], flowChUnit(l))} back)</span>` : ''}`).join('<br>')}</td>
      <td class="num">${sent}</td><td class="num">${got}</td>
      <td>${pill(st)}${(c.cancelled || c.closed) && (c.cancelled || c.closed).why ? `<div class="muted" style="font-size:10.5px">${esc((c.cancelled || c.closed).why)}</div>` : ''}</td>
      <td style="white-space:nowrap">${flowChActions(c, st)}</td></tr>`; }).join('');
  return `<thead><tr><th class="frz" style="text-align:left">Challan</th><th style="text-align:left">Order</th><th style="text-align:left">Vendor</th><th style="text-align:left">Lines · sent</th><th>Sent</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>`
    + (body || '<tr><td colspan="8" class="muted" style="padding:16px">No challan yet — they are made in Demand · RFD fabric.</td></tr>') + '</tbody>';
}

/** What can be done to a challan in its state — and, to put a mistake right, Edit / Cancel / Undo receipt / Reopen. */
function flowChActions(c, st) {
  const b = (attr, label, main) => `<button ${main ? '' : 'class="ghost" '}${attr}="${esc(c.no)}" style="width:auto;padding:${main ? '3px 10px;font-size:12px' : '2px 8px;font-size:11.5px'}">${label}</button>`;
  if (st === 'cancelled') return '';
  const out = [];
  if (st !== 'closed') out.push(b('data-flchr', 'Receive', true), b('data-flchc', 'Close short'));
  if (!flowChHasRecv(c) && st !== 'closed') out.push(b('data-flche', 'Edit'), b('data-flchx', 'Cancel'));
  if (flowChHasRecv(c)) out.push(b('data-flchu', 'Undo last receipt'));
  if (st === 'closed' && c.closed.short) out.push(b('data-flcho', 'Reopen'));
  out.push(b('data-flchp', 'Print'));
  return out.join(' ');
}
/* NOT RECEIVED THIS TIME (Ravi, 20 Oct, design A): a ✕ at the end of a line marks it "Not received" for this receipt
 * only — the line stays on the challan, still owed, and comes up again next time. ↶ undoes it. The lines crossed are kept
 * on the receipt (notCame) so the history says what was missing that day. */
let FLOW_RX = new Set();
const FLOW_RX_WAS = new Map();     // what was typed before the cross, put back by ↶
function flowRecvCross(i) {
  const on = !FLOW_RX.has(i);
  if (on) FLOW_RX.add(i); else FLOW_RX.delete(i);
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const q = s => document.querySelector(s);
  const inp = q(`[data-flrm="${i}"]`), box = q(`[data-flrin="${i}"]`), pill = q(`[data-flrno="${i}"]`), tr = q(`[data-flrrow="${i}"]`), b = q(`[data-flrx="${i}"]`);
  if (inp) { if (on) { FLOW_RX_WAS.set(i, inp.value); inp.value = ''; } else if (FLOW_RX_WAS.has(i)) inp.value = FLOW_RX_WAS.get(i); }
  if (box) box.style.display = on ? 'none' : '';
  if (pill) pill.style.display = on ? '' : 'none';
  if (tr) tr.style.opacity = on ? '0.55' : '';
  if (b) { b.textContent = on ? '↶' : '✕'; b.title = on ? 'Undo — it came after all' : 'Not received this time — the line stays on the challan'; }
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('[data-flrx]');
  if (b) { e.preventDefault(); flowRecvCross(+b.dataset.flrx); }
});
/** Printed fabric back from the printer against a challan: metres per line. Closes by itself when all of it is back. */
function flowReceiveOpen(no) {
  const c = (FLOW.ch || {})[no]; if (!c) return;
  const recv = flowChRecv(c);
  FLOW_RX = new Set(); FLOW_RX_WAS.clear();
  /* the picture of each line (20 Oct), from wherever the app has it — master, Shopify, the B2B sheet */
  const pic = sku => (typeof ptImgSpan === 'function' ? ptImgSpan(sku, 40) : '');
  ptOpenDialog({
    title: `Receive against ${no}`,
    subtitle: `${c.orderNo} · ${c.vendor && c.vendor.name}. Type what came back now, in the form it was given: printed cloth in metres, pieces printed on the SKU in pieces. When every line is back the challan closes and the lines move to the store by themselves.`,
    html: `<label>Date<input id="flrDate" type="date" value="${esc(dToday())}"></label>
      <table class="xl" style="margin-top:8px;width:100%"><thead><tr><th style="width:52px">Photo</th><th style="text-align:left">SKU</th><th>Given as</th><th>Sent</th><th>Back so far</th><th>Received now</th></tr></thead><tbody>
      ${(c.lines || []).map((l, i) => { const u = flowChUnit(l), left = flowR2(Math.max(0, flowChSent(l) - (recv[l.key] || 0)));
        return `<tr data-flrrow="${i}"><td>${pic(l.sku)}</td><td style="text-align:left"><b>${esc(l.sku)}</b><div class="muted" style="font-size:10.5px">${esc(l.item || '')}</div></td>
          <td style="text-align:left;font-size:11.5px">${u === 'pcs' ? 'Cut pieces' : l.ruffleOnly ? 'Printed ruffle cloth' : 'Printed cloth'}</td>
          <td class="num"><b>${flowQtyTxt(flowChSent(l), u)}</b>${u === 'pcs' ? `<div class="muted" style="font-size:10.5px">${flowQtyTxt(l.metres, 'm')} cloth</div>` : ''}</td><td class="num">${flowQtyTxt(recv[l.key] || 0, u)}</td>
          <td class="num"><span data-flrin="${i}"><input data-flrm="${i}" type="number" step="${u === 'pcs' ? '1' : '0.01'}" min="0" value="${left > 0 ? esc(left) : ''}" ${left > 0 ? '' : 'disabled'} style="width:85px;padding:3px 6px;font-size:12px"> ${u}</span>`
          + `<span data-flrno="${i}" class="pill bad" style="display:none;font-size:11px">Not received</span>`
          /* the ✕ sits in the same cell as the figure: a column of its own ran off the right of the window (20 Oct) */
          + `${left > 0 ? ` <button type="button" class="ghost" data-flrx="${i}" title="Not received this time — the line stays on the challan" style="width:auto;padding:2px 9px;font-size:13px;margin-left:4px">✕</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table><label style="display:block;margin-top:8px">Note (lot, vehicle, quality…)<input id="flrNote"></label>`,
    saveLabel: 'Received',
    onSave: async () => {
      const items = {};
      const frac = [];
      (c.lines || []).forEach((l, i) => { if (FLOW_RX.has(i)) return;       // not received this time
        const m = +((document.querySelector(`[data-flrm="${i}"]`) || {}).value || 0);
        if (m > 0) { items[l.key] = flowR2(m); if (flowChUnit(l) === 'pcs' && m !== Math.round(m)) frac.push(l.sku); } });
      if (!Object.keys(items).length) return 'Type what came back for at least one line.';
      if (frac.length) return `Pieces are whole: ${frac.join(', ')}.`;
      /* Pieces back are pieces given — never more. Cloth may come back a little over (shrinkage, roll ends): up to 10%. */
      const over = (c.lines || []).filter(l => (recv[l.key] || 0) + (items[l.key] || 0) > flowChSent(l) * (flowChUnit(l) === 'pcs' ? 1 : 1.1) + 1e-9).map(l => l.sku);
      if (over.length) return `More came back than was given for ${over.join(', ')} — check the figure.`;
      const g = await flowGuard('ch_' + no); if (g) return g;   // two people receiving on one challan at once
      const now = new Date().toISOString(), id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rc = { date: $('flrDate').value || dToday(), items, note: $('flrNote').value.trim(), at: now, by: ME.email || '' };
      const notCame = (c.lines || []).filter((l, i) => FLOW_RX.has(i)).map(l => l.key);
      if (notCame.length) rc.notCame = notCame;
      const allBack = (c.lines || []).every(l => (recv[l.key] || 0) + (items[l.key] || 0) >= flowChSent(l) - 0.01);
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
  if (typeof ptImgFill === 'function') ptImgFill((c.lines || []).map(l => l.sku), false, typeof ptImgPatch === 'function' ? ptImgPatch : null);
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
      const g = await flowGuard('ch_' + no); if (g) return g;
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
