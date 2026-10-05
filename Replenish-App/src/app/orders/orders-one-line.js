/* ==== ORDERS — ONE LINE PER ORDER (Ravi, 2026-09-28: picked design 8, "Clean sheet") ====
 * "ek anpad insan bhi samjh jay … order by order … sara order ek hi window me". Every order the book holds, whatever the
 * platform, one line: platform, pieces, the step it is at (the furthest-back of its lines), who has it, how far that step
 * has got, and days. Six steps only — the fine distinctions of the Tracking view fold into them. Clicking the order
 * opens its whole journey (ordJourney). Nothing here is new data: ordLines, ordTrackStage and the registers. */
const ORD_SHEET_STEPS = [
  ['printer', 'At printer', '#6D4BD8', '#EFEAFD'], ['cut', 'Cutting', '#2F6FE0', '#E6EEFD'], ['karigar', 'With karigar', '#0B8C8C', '#DFF4F2'],
  ['press', 'Press', '#B45309', '#FEF1DE'], ['ready', 'Ready to ship', '#15803D', '#DFF6E7'], ['done', 'Done', '#4A5A3C', '#EDF0E7']];
const ORD_SHEET_LATE = ['late', 'Late — no work 5+ days', '#B91C1C', '#FDE8E7'];
const ordSheetStepOf = r => {
  if (r.handedAt || r.shopDoneAt) return 'done';
  const i = ordTrackStage(r);
  return i === 0 ? 'printer' : i === 1 ? 'cut' : (i === 2 || i === 3) ? 'karigar' : i === 4 ? 'press' : i === 9 ? 'done' : 'ready';
};
/** Who holds each order's pieces with a karigar now: orderNo → Map(karigar → pieces not back). */
let ORD_KAR_IX = { src: null, n: -1, map: null };
function ordKarigarsOf(orderNo) {
  const base = PT.base || PT_NONE;
  if (ORD_KAR_IX.src !== base || ORD_KAR_IX.n !== base.length || !ORD_KAR_IX.map) {
    const m = new Map();
    base.forEach(r => {
      if (!r || !r.orderNo) return;
      const left = (Number(r.issuePieces) || 0) - (Number(r.receivedPieces) || 0) - (Number(r.rejectionPieces) || 0);
      if (!(left > 0)) return;
      const k = obUC(r.orderNo), who = String(r.empName || '').trim() || 'karigar';
      if (!m.has(k)) m.set(k, new Map());
      m.get(k).set(who, (m.get(k).get(who) || 0) + left);
    });
    ORD_KAR_IX = { src: base, n: base.length, map: m };
  }
  return ORD_KAR_IX.map.get(obUC(orderNo)) || new Map();
}
function ordSheetRows() {
  const idx = s => ORD_SHEET_STEPS.findIndex(x => x[0] === s);
  const ev = ordEvents(), now = Date.now(), by = new Map();
  let lines = ordApply(ordLines(), ordFilters());
  if (SHOP_ONLY()) lines = lines.filter(r => ordSrcOf(r.orderNo) === 'SHP');
  lines.forEach(r => {
    let o = by.get(r.orderNo);
    if (!o) { o = { orderNo: r.orderNo, ref: r.shopOrderNo || '', date: r.orderDate || '', sku: r.sku, lines: 0, pcs: 0, step: 'done',
      given: 0, back: 0, cut: 0, cutOf: 0, issued: 0, received: 0, pressed: 0, printers: new Set(), addedMs: 0 }; by.set(r.orderNo, o); }
    const v = ordVendorOf(r.orderNo, r.sku), cap = x => Math.min(r.qty, Number(x) || 0);
    o.lines++; o.pcs += r.qty; o.addedMs = Math.max(o.addedMs, r.addedMs || 0);
    o.given += cap(r.printer ? r.qty : (v ? v.given : 0)); o.back += cap(r.printer ? r.printed : (v ? v.back : 0));
    if (r.printer) o.printers.add(voName(r.printer)); else if (v) v.parts.forEach(pp => o.printers.add(voName(pp.vendorCode)));
    if (r.cutReq) { o.cut += cap(r.cut); o.cutOf += r.qty; }
    o.issued += cap(r.issued); o.received += cap(r.received); o.pressed += cap(r.pressed);
    const st = ordSheetStepOf(r);
    if (idx(st) < idx(o.step)) o.step = st;
  });
  return [...by.values()].map(o => {
    const last = ev.last.get(o.orderNo) || null, placed = ptDtMs(o.date) || 0;
    const idle = Math.floor((now - (last ? last.ms : placed || now)) / 864e5);
    const kar = ordKarigarsOf(o.orderNo);
    const lastOf = kind => ev.list.find(e => e.orderNo === o.orderNo && e.kind === kind) || null;
    const who = o.step === 'printer' ? [...o.printers].join(', ')
      : o.step === 'karigar' ? [...kar.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + nf(n)).join(' · ')
      : o.step === 'cut' ? ((lastOf('cut') || {}).by || '')
      : o.step === 'press' ? ((lastOf('press') || {}).by || '')
      : (last && last.by) || '';
    const done = o.step === 'printer' ? `${nf(o.back)} of ${nf(o.given || o.pcs)} back`
      : o.step === 'cut' ? `${nf(o.cut)} of ${nf(o.cutOf || o.pcs)} cut`
      : o.step === 'karigar' ? `${nf(o.received)} of ${nf(o.pcs)} back`
      : o.step === 'press' ? `${nf(o.pressed)} of ${nf(o.pcs)} pressed`
      : o.step === 'ready' ? `${nf(o.pcs)} made` : 'handed over';
    return Object.assign(o, { last, who, done, days: placed ? Math.max(0, Math.floor((now - placed) / 864e5)) : null, idle,
      late: o.step !== 'done' && idle >= ORD_PIPE_STALE_DAYS });
  });
}
function renderOrdSheet() {
  if (!ORD.shopTrk && !ORD.shopTrkBusy && typeof ordTrackShopLoad === 'function') ordTrackShopLoad();
  const all = ordSheetRows();
  const key = /^os:/.test(ORD_KPI) ? ORD_KPI.slice(3) : '';
  const rows = ordNewest(key === 'late' ? all.filter(o => o.late) : key ? all.filter(o => o.step === key) : all.filter(o => o.step !== 'done'));
  ORD.rows = rows;
  const src = (($('odSrc') || {}).value || '');
  const count = k => all.filter(o => (k === 'late' ? o.late : o.step === k)).length;
  const tile = ([k, l, c, bg]) => { const on = key === k;
    return `<button type="button" data-odkpi="os:${k}" style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border-radius:16px;cursor:pointer;text-align:left;box-shadow:none;transform:none;`
      + `background:${bg};color:${c};border:2px solid ${on ? c : 'transparent'};font:inherit;min-width:0">`
      + `<b style="font-size:24px;line-height:1.1">${nf(count(k))}</b><span style="font-weight:700;font-size:13px">${esc(l)}</span></button>`; };
  /* The app's own button style is white text on blue with a shadow; each of these sets its own colours and none. */
  const chip = (v, l) => `<button type="button" data-ordsrc="${v}" style="height:38px;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
    + (src === v ? 'background:#17202B;color:#fff;border:1px solid #17202B' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5') + `">${l}</button>`;
  $('odKpis').innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;width:100%;margin-bottom:14px">
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px">${ORD_SHEET_STEPS.map(tile).join('') + tile(ORD_SHEET_LATE)}</div>
    ${SHOP_ONLY() ? '' : `<div style="display:flex;gap:8px;flex-wrap:wrap">${chip('', 'All')}${chip('SHP', 'Shopify')}${chip('AMZ', 'Amazon')}${chip('B2B', 'B2B')}</div>`}</div>`;
  const pill = st => { const x = ORD_SHEET_STEPS.find(y => y[0] === st) || ORD_SHEET_STEPS[0];
    return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;font-size:12.5px;background:${x[3]};color:${x[2]}">${esc(x[1])}</span>`; };
  const head = ordHead([['Order', ''], ['Platform', ''], ['Pcs', 'num'], ['Step', ''], ['With', ''], ['Done', ''], ['Days', 'num']]);
  const body = rows.slice(0, ORD_CAP).map(o => '<tr>'
    + `<td class="frz" style="text-align:left"><a href="#" data-ordj="${esc(o.orderNo)}" title="Open this order — every item, start to finish" style="font-weight:800">${esc(o.ref || o.orderNo)}</a>`
      + (o.ref ? `<div class="muted" style="font-size:11px">${esc(o.orderNo)}</div>` : '') + '</td>'
    + `<td style="text-align:left">${esc(ordPlatOf(o.orderNo, o.sku))}</td>`
    + `<td class="num" style="font-weight:700">${nf(o.pcs)}</td>`
    + `<td style="text-align:left">${pill(o.step)}</td>`
    + `<td style="text-align:left">${o.who ? esc(o.who) : '<span class="muted">—</span>'}</td>`
    + `<td style="text-align:left">${esc(o.done)}</td>`
    + `<td class="num" style="font-weight:800${o.late ? ';color:#B91C1C' : ''}" title="${o.late ? 'Nothing entered against it for ' + nf(o.idle) + ' days' : 'Days since it was placed'}">${o.days == null ? '—' : nf(o.days)}${o.late ? ' ⚠' : ''}</td>`
    + '</tr>').join('');
  $('odTable').innerHTML = head + '<tbody>' + (body || '<tr><td colspan="7" class="muted" style="padding:16px;text-align:left">No order here.</td></tr>') + '</tbody>';
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(rows.length)} order(s)` + (key ? '' : ' in the factory') + (rows.length > ORD_CAP ? ` · showing ${nf(ORD_CAP)}` : '')
    + ' · click an order to open it · the other views are under More in the list on the left';
  ordMoreBtn(rows.length);
}
if ($('odKpis')) $('odKpis').addEventListener('click', e => {
  const d = e.target.closest('[data-skudone]');
  if (d && ['0', '1'].indexOf(d.getAttribute('data-skudone')) >= 0) { ORD.skuDone = d.getAttribute('data-skudone') === '1'; ORD.pick = new Set(); ORD_KPI = ''; return renderOrd(); }
});
if ($('odKpis')) $('odKpis').addEventListener('click', e => {
  const t = e.target.closest('[data-ordsrc]'); if (!t) return;
  /* Shopify is worked on the combined view; every other choice is the order book of that platform. */
  const v = t.getAttribute('data-ordsrc');
  if (['', 'SHP', 'ONL', 'AMZ', 'B2B'].indexOf(v) < 0) return;
  /* Shopify and Online are both made to order and worked on the same combined view (2026-10-05). */
  const mto = v === 'SHP' || v === 'ONL';
  if (mto) ORD.mtoSrc = v;
  if ($('odView')) $('odView').value = mto ? 'shopsku' : 'book';
  if ($('odSrc')) $('odSrc').value = mto ? '' : v;
  ORD_KPI = ''; ORD.pick = new Set();
  renderOrd();
});
/** The four platform buttons (Ravi liked them on the Orders sheet): which one is lit follows the view on screen. */
function ordSrcChips() {
  if (SHOP_ONLY()) return '';
  const on = ordView() === 'shopsku' ? (ORD.mtoSrc === 'ONL' ? 'ONL' : 'SHP') : ((($('odSrc') || {}).value) || '');
  const chip = (v, l) => `<button type="button" data-ordsrc="${v}" style="height:38px;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
    + (on === v ? 'background:#17202B;color:#fff;border:1px solid #17202B' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5') + `">${l}</button>`;
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;width:100%">${chip('', 'All')}${chip('SHP', 'Shopify')}${chip('ONL', 'Online')}${chip('AMZ', 'Amazon')}${chip('B2B', 'B2B')}</div>`;
}

function renderOrdTrack() {
  if (!ORD.shopTrk && !ORD.shopTrkBusy) ordTrackShopLoad();
  const all = ordTrackRows();
  const pick = /^trk\d+$/.test(ORD_KPI) ? +ORD_KPI.slice(3) : -1;
  const rows = pick >= 0 ? all.filter(o => o.stage === pick) : all;
  ORD.rows = rows;
  $('odKpis').innerHTML = '<div class="jw-kpiname">Tracking — every order, start to finish</div><div class="jw-kpis">'
    + ordKpiCard(nf(all.length), 'Orders', 'doc', 'blue', 'the filters above decide which')
    + ORD_TRACK.map(([k, l, icon, tone], i) => { const n = all.filter(o => o.stage === i).length;
      return ordKpiCard(nf(n), l, icon, tone, 'orders held here', { key: 'trk' + i,
        tip: (pick === i ? 'Showing only these orders. Click again to show all.' : 'Show only the orders whose furthest-back line is here.') }); }).join('')
    + '</div>';
  const head = ordHead([['Order', ''], ['From', ''], ['Date', ''], ['Days', 'num'], ['Lines', 'num'], ['Ordered', 'num'], ['Made', 'num'],
    ['In store', 'num'], ['To FBA', 'num'], ['Shipped to Amazon', 'num'], ['Dispatched', 'num'], ['Handed over', 'num'], ['Where it is', ''], ['Shopify', ''], ['Shipment / papers', '']]);
  /* A Shopify parcel: carrier, and each tracking number — a link when Shopify gives one. */
  const shopCell = o => {
    if (!o.shop || !o.shop.length) return (o.shopIds && o.shopIds.size) ? `<span class="muted">${ORD.shopTrkBusy ? 'reading…' : 'not found'}</span>` : '<span class="muted">—</span>';
    const st = { shipped: ['done', 'Shipped'], partial: ['prog', 'Part shipped'], open: ['pend', 'Not shipped'], cancelled: ['pend', 'Cancelled'] }[o.shopState] || ['pend', o.shopState];
    const parcels = o.shop.filter(x => x.trk.length).map(x => esc(x.via) + ' ' + x.trk.map(t => x.trkUrl && x.trk.length === 1
      ? `<a href="${esc(x.trkUrl)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t)).join(', ') + (x.shippedAt ? ' <span class="muted">' + esc(String(x.shippedAt).slice(0, 10)) + '</span>' : ''));
    return `<span class="jw-st ${st[0]}">${st[1]}</span>` + (parcels.length ? '<div style="font-size:11px;margin-top:2px">' + parcels.join('<br>') + '</div>' : '');
  };
  const cell = n => n ? nf(Math.round(n)) : '<span class="muted">—</span>';
  const body = rows.slice(0, 800).map(o => {
    const where = ORD_TRACK[o.stage][1] + (o.lines > 1 && o.n[o.stage] < o.lines ? ` <span class="muted">(${nf(o.n[o.stage])} of ${nf(o.lines)} lines)</span>` : '');
    const tone = o.stage === 9 ? 'done' : (o.stage >= 7 ? 'prog' : 'pend');
    return '<tr>'
      + `<td class="frz" style="text-align:left"><a href="#" data-ordj="${esc(o.orderNo)}" title="This order, start to finish" style="font-weight:600">${esc(o.orderNo)}</a></td>`
      + `<td>${esc(o.src)}</td><td>${esc(o.date)}</td><td class="num">${o.days == null ? '—' : nf(o.days)}</td>`
      + `<td class="num">${nf(o.lines)}</td><td class="num" style="font-weight:700">${nf(o.ordered)}</td>`
      + `<td class="num">${cell(o.pressed)}</td><td class="num">${cell(o.store)}</td><td class="num">${cell(o.fba)}</td>`
      + `<td class="num">${cell(o.fbaShip)}</td><td class="num">${cell(o.issued)}</td><td class="num">${cell(o.handed)}</td>`
      + `<td style="text-align:left"><span class="jw-st ${tone}">${where}</span>${o.shopState === 'shipped' && o.n[9] < o.lines ? '<div class="muted" style="font-size:10.5px">Shopify says shipped</div>' : ''}</td>`
      + `<td style="text-align:left">${shopCell(o)}</td>`
      + `<td style="text-align:left;font-size:11.5px">${o.ships.size ? [...o.ships].slice(0, 4).map(esc).join(' · ') + (o.ships.size > 4 ? ' …' : '') : '<span class="muted">—</span>'}</td>`
      + '</tr>';
  }).join('');
  $('odTable').innerHTML = head + '<tbody>' + (body || '<tr><td colspan="15" class="muted" style="padding:16px">No order matches.</td></tr>') + '</tbody>';
  $('odMsg').className = ORD.shopTrkErr ? 'err' : 'muted';
  $('odMsg').textContent = `${nf(rows.length)} order(s)${pick >= 0 ? ' held at ' + ORD_TRACK[pick][1].toLowerCase() + ' — click the card again for all' : ''}`
    + (rows.length > 800 ? ' · showing the first 800' : '')
    + (ORD.shopTrkBusy ? ' · reading Shopify for tracking…' : (ORD.shopTrkErr ? ' · Shopify could not be read: ' + ORD.shopTrkErr : (ORD.shopTrk ? ' · Shopify read ' + new Date(ORD.shopTrkAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')))
    + (ORD.shopTrkMore ? ' · Shopify had more orders than one read holds' : '')
    + ' · an order sits where its furthest-back line is · click an order number for every line, start to finish';
}

function renderOrdDemandTot() {
  ordDemandLoad();
  const d = ordDemandColRows();
  const rows = d.cols.slice().sort((a, b) => String(a.fabric).localeCompare(String(b.fabric), undefined, { numeric: true })
    || String(a.colour).localeCompare(String(b.colour)));
  ORD.rows = rows;
  ORD.demRows = new Map(rows.map(r => [r.key, r]));
  const s = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const anyAt = rows.some(r => r.atM != null);
  $('odKpis').innerHTML = '<div class="jw-kpiname">Demand — fabric &amp; colour totals</div><div class="jw-kpis">'
    + ordKpiCard(nf(rows.length), 'Fabric · colours', 'list', 'blue', 'that the open book needs')
    + ordKpiCard(ordDemBoth(s('need'), s('cutPcs')), 'Cloth needed', 'cut', 'blue', 'running in metres, cut pieces in pcs')
    + ordKpiCard(anyAt ? ordDemBoth(s('atM'), s('cutAtPcs')) : '—', 'With printers', 'clock', anyAt ? 'amber' : 'blue', anyAt ? 'given, not yet back' : 'vendor orders not read')
    + ordKpiCard(ordDemBoth(s('give'), s('cutGive')), 'Still to give', 'up', 'blue', 'needed − already with printers')
    + '</div>';
  /* GIVE THE RUNNING CLOTH (Ravi, 2026-09-25: "mujhe running assign karni h … only printer ko 285 assign krna h").
   * The button opens the ordinary vendor order form, as running, with the fabric, the colour and only what is
   * still to give — so the order is placed, checked and shown exactly as any other running order. */
  const canOrder = !spIsVendor();
  const giveM = r => Math.round(r.give || 0);
  /* The printers, and each row's picks kept across redraws. A direction nobody has picked yet starts at the one
   * this colour is already printed on, where an open order says one; otherwise it waits to be chosen. */
  const printers = voAllVendors().filter(v => /print/i.test(String(v.category || '')));
  ORD.demPick = ORD.demPick || {};
  ORD.demBasket = ORD.demBasket || {};
  const inBasket = k => Object.keys(ORD.demBasket).find(c => (ORD.demBasket[c] || []).some(x => x.key === k)) || '';
  const dirOf = r => { const p = ORD.demPick[r.key] || {}; if (p.dir != null) return p.dir;
    if (r.dir) return r.dir;                                   // a quilt row knows its own
    const h = voRunningOpenOf(r.colour, r.fabric).find(x => x.dir); return h ? h.dir : ''; };
  /* WHICH SIZES THIS CLOTH IS FOR, under the colour (Ravi, 2026-09-30: "pata nahi laga pa rha hu ki kis size ke liye"). */
  const forWhat = r => (r.products || []).filter(p => !p.asPcs && p.pcs > 0).slice(0, 6)
    .map(p => esc([p.what, p.size].filter(Boolean).join(' ')) + ' <span class="muted">(' + nf(p.pcs) + ')</span>').join(', ');
  const runWith = r => {
    const w = [...(r.runWho || new Map())].filter(x => Math.round(x[1])).sort((x, y) => y[1] - x[1]);
    return w.length ? w.map(([n, m]) => esc(n) + (r.narrowed ? '' : ' <span class="muted">' + nf(Math.round(m)) + ' m</span>')).join(', ') : '<span class="muted">—</span>';
  };
  /* A printer already holding this colour's running is not offered again for it. */
  const heldBy = r => {
    const names = new Set([...(r.runWho || new Map())].filter(x => Math.round(x[1])).map(x => obUC(x[0])));
    const codes = r.runCodes || new Set();
    return v => codes.has(obUC(v.code)) || names.has(obUC(v.desc || v.name || v.code)) || names.has(obUC(voName(v.code)));
  };
  const head = ordHead([['Fabric', ''], ['Colour', ''], ['Pieces to make', 'num'], ['Cloth needed', 'num'], ['With printers', 'num'],
    ['Still to give', 'num'], ['Running is with', '']].concat(canOrder ? [['Give to a printer', '']] : []));
  const dash = '<span class="muted">—</span>';
  $('odTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(r => '<tr>'
      + '<td class="frz" style="text-align:left"><b>' + esc(r.fabric) + '</b></td>'
      + '<td style="text-align:left;white-space:normal;max-width:320px"><b>' + (esc(r.colour) || '<span class="muted">no colour</span>') + '</b>'
        + (r.dir ? ' <span style="font-size:11px;font-weight:700;color:#7C3AED;background:#F4EFFE;border-radius:6px;padding:1px 6px">' + esc(r.dir) + '</span>' : '')
        + (forWhat(r) ? '<div style="font-size:11.5px;margin-top:2px">for ' + forWhat(r) + '</div>' : '') + '</td>'
      + '<td class="num">' + nf(r.pcs) + '</td>'
      + '<td class="num" style="font-weight:800">' + ordDemBoth(r.need, r.cutPcs) + '</td>'
      + '<td class="num">' + (r.atM == null ? dash : ordDemBoth(r.atM, r.cutAtPcs)) + '</td>'
      + '<td class="num" style="font-weight:800">' + ordDemBoth(r.give, r.cutGive) + '</td>'
      + '<td style="text-align:left;white-space:normal;max-width:280px;font-size:12.5px">' + runWith(r) + '</td>'
      + (canOrder ? '<td style="white-space:nowrap">' + (giveM(r) >= 1
          ? '<div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">'
            + '<select data-demprn="' + esc(r.key) + '" aria-label="Printer" style="width:170px;padding:6px 8px;font-size:12.5px">'
            + '<option value="">— printer —</option>' + (h => printers.filter(v => !h(v)))(heldBy(r)).map(v => '<option value="' + esc(v.code) + '"' + (v.code === (ORD.demPick[r.key] || {}).prn ? ' selected' : '') + '>' + esc(v.desc || v.name || v.code) + '</option>').join('') + '</select>'
            + '<select data-demdir="' + esc(r.key) + '" aria-label="Print direction" style="width:118px;padding:6px 8px;font-size:12.5px">'
            + ['', 'Vertical', 'Horizontal'].map(d => '<option value="' + d + '"' + (d === dirOf(r) ? ' selected' : '') + '>' + (d || '— direction —') + '</option>').join('') + '</select>'
            + (inBasket(r.key)
              ? '<button class="jw-btn" data-demrm="' + esc(r.key) + '" title="In the order for ' + esc(voName(inBasket(r.key))) + ' — press to take it out">✓ ' + esc(voName(inBasket(r.key))) + ' · remove</button>'
              : '<button class="jw-btn jw-primary" data-demrun="' + esc(r.key) + '" title="Add the ' + nf(giveM(r)) + ' m still to give to the order for the printer chosen — or, with none chosen, open the full vendor order form">'
                + 'Add ' + nf(giveM(r)) + ' m</button>') + '</div>'
          : dash) + '</td>' : '') + '</tr>').join('')
    : '<tr><td colspan="' + (canOrder ? 8 : 7) + '" class="muted" style="padding:16px">Nothing on the open book needs printing.</td></tr>')
    + '</tbody>';
  demBasketBar();
  const say = [];
  if (ORD_DEM.busy) say.push('reading the vendor orders…');
  if (d.unknownPcs) say.push(nf(d.unknownPcs) + ' piece(s) have no fabric or consumption and are not counted');
  if (ORD.demSaid) { $('odMsg').className = 'muted'; $('odMsg').textContent = ORD.demSaid; ORD.demSaid = ''; return; }
  $('odMsg').className = 'muted';
  $('odMsg').textContent = nf(rows.length) + ' fabric · colour(s) · ' + nf(d.pcs) + ' piece(s) to make'
    + (d.narrowed ? ' · filtered: "With printers" is these orders\' share of what the printers hold, oldest order first' : '')
    + ' · the products behind each line are in "Demand — by colour & product"' + (say.length ? ' · ' + say.join(' · ') : '');
}

/**
 * Add a row's cloth to the order being built for the printer picked (Ravi, 2026-09-25: one order, not one per row).
 * Nothing is written here; Place order on the bar writes the whole order.
 */
function demBasketAdd(key, code, dir) {
  const r = (ORD.demRows || new Map()).get(key);
  if (!r) return '';
  const m = Math.round(r.give || 0);
  if (m < 1) return 'Nothing is left to give for this colour.';
  if (!dir) return `Pick the print direction for ${r.fabric} · ${r.colour} first.`;
  if (!voMasterRow(code)) return 'That printer is not in the vendor master.';
  ORD.demBasket = ORD.demBasket || {};
  Object.keys(ORD.demBasket).forEach(c => { ORD.demBasket[c] = (ORD.demBasket[c] || []).filter(x => x.key !== key); });
  (ORD.demBasket[code] = ORD.demBasket[code] || []).push({ key, fabric: r.fabric, colour: r.colour, dir, m,
    need: Math.round(r.need || 0), atM: Math.round(r.atM || 0),
    /* The sizes it is for travel with the line, so the printer and the office both read "for Queen Quilt 90x96". */
    forWhat: (r.products || []).filter(p => !p.asPcs && p.pcs > 0).map(p => [p.what, p.size].filter(Boolean).join(' ') + ' (' + p.pcs + ')').join(', ') });
  ORD.demSaid = `${nf(m)} m of ${r.fabric} · ${r.colour} · ${dir} added to the order for ${voName(code)} — Place order on the bar above when it has everything.`;
  renderOrd();
  return '';
}

/**
 * Place the order built for one printer: every line in it, with the delivery date and priority asked for once.
 * Written by voPlace, the form's own save — a request for anyone who may not place.
 */
function demBasketPlace(code) {
  const ls = ((ORD.demBasket || {})[code] || []).slice();
  if (!ls.length) return;
  const name = voName(code), may = vrqCanApprove(), m = ls.reduce((t, x) => t + x.m, 0);
  ptOpenDialog({
    title: (may ? 'Order to ' : 'Request an order to ') + name,
    subtitle: nf(ls.length) + ' running line(s) · ' + nf(m) + ' m' + (may ? '' : ' · goes to an approver first'),
    html: '<table class="xl" style="font-size:12.5px;margin-bottom:12px"><thead><tr><th style="text-align:left">Fabric · colour</th><th>Direction</th>'
      + '<th class="num">Metres</th><th class="num">Needed</th><th class="num">With printers</th></tr></thead><tbody>'
      + ls.map(x => '<tr><td style="text-align:left"><b>' + esc(x.fabric) + '</b> · ' + esc(x.colour) + '</td><td>' + esc(x.dir) + '</td>'
        + '<td class="num" style="font-weight:800">' + nf(x.m) + '</td><td class="num">' + nf(x.need) + '</td><td class="num">' + nf(x.atM) + '</td></tr>').join('')
      + '</tbody></table>',
    fields: [
      { key: 'deliv', label: 'Delivery date *', type: 'date', value: (ORD.demLast || {}).deliv || '' },
      { key: 'pri', label: 'Priority *', type: 'select', value: (ORD.demLast || {}).pri || '', options: [['', '— pick —'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'], ['P4', 'P4']] },
      { key: 'notes', label: 'Notes for the printer', value: '', span: true },
    ],
    onSave: async v => {
      if (!v.deliv) return 'Put in the delivery date.';
      if (!/^P[1-4]$/.test(v.pri || '')) return 'Pick the priority.';
      if (VO.rows === null) await ensureVo();
      const lo = x => String(x || '').trim().toLowerCase();
      const cat = [...voFabricCatalogue().values()];
      VOF = { kind: 'running', service: 'Block print', mode: may ? 'place' : 'request',
        dupOk: Object.fromEntries(ls.map(x => [lo(x.colour) + '|' + lo(x.fabric) + '|', true])),
        lines: ls.map(x => {
          /* The fabric SKU, where exactly one line of the catalogue is this cloth. */
          const hits = cat.filter(c => lo(c.fabric) === lo(x.fabric) && lo(c.colour) === lo(x.colour) && lo(c.dir) === lo(x.dir));
          const fr = hits.length === 1 ? hits[0] : null;
          return Object.assign({ lineId: 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), kind: 'running',
            fabricType: x.fabric, color: x.colour, printDirection: x.dir, meters: x.m, deliveryDate: v.deliv, priority: v.pri,
            notes: (x.forWhat ? 'For ' + x.forWhat + ' · ' : '') + 'Order Console: needs ' + nf(x.need) + ' m, ' + nf(x.atM) + ' m already with printers', dispatchedQty: 0 },
            fr ? { sku: fr.sku, img: fr.imageUrl || '', brand: fr.brandName || '' } : {});
        }) };
      const err = await voPlace({ code, notes: v.notes || '', why: may ? '' : 'Order Console demand — ' + nf(m) + ' m still to give' });
      if (err) return err;
      ORD.demLast = { deliv: v.deliv, pri: v.pri };
      delete ORD.demBasket[code];
      ORD.demSaid = may ? `${($('voMsg') || {}).textContent || 'Order placed'} — ${nf(ls.length)} line(s), ${nf(m)} m, delivery ${v.deliv}, ${v.pri}.`
        : `Request for ${nf(ls.length)} line(s), ${nf(m)} m to ${name} sent for approval.`;
      renderOrd();
      return '';
    },
    saveLabel: (may ? 'Place order · ' : 'Send for approval · ') + nf(ls.length) + ' line(s)',
  });
}

/** "Give 285 m": the ordinary vendor order form, running, with this colour's cloth still to give filled in. */
async function demRunGive(key) {
  const r = (ORD.demRows || new Map()).get(key);
  if (!r) return;
  const m = Math.round(r.give || 0);
  if (m < 1) return;
  await voFormOpen();
  voSetKind('running');
  /* The form's lists spell a fabric or a colour their own way; the one that matches, ignoring case, is picked. */
  const pick = (id, want) => {
    const el = $(id); if (!el || !el.options) return false;
    const o = [...el.options].find(x => String(x.value).trim().toLowerCase() === String(want || '').trim().toLowerCase());
    if (o) el.value = o.value;
    return !!o;
  };
  const okF = pick('vof_fab', r.fabric), okC = pick('vof_col', r.colour);
  if ($('vof_qty')) $('vof_qty').value = String(m);
  if ($('vof_lnotes')) $('vof_lnotes').value = 'Order Console: needs ' + nf(Math.round(r.need)) + ' m, '
    + nf(Math.round(r.atM || 0)) + ' m already with printers';
  /* The colour is on an open order by design — that is the cloth this figure already takes off. */
  VOF.dupOk = Object.assign({}, VOF.dupOk || {}, { [String(r.colour || '').trim().toLowerCase() + '|' + String(r.fabric || '').trim().toLowerCase() + '|']: true });
  if (okF && okC && typeof voFabricFromFields === 'function') voFabricFromFields();
  ptDlgMsg(`${r.fabric} · ${r.colour}: ${nf(m)} m still to give (${nf(Math.round(r.need))} needed − ${nf(Math.round(r.atM || 0))} m with printers). `
    + (okF && okC ? 'Pick the printer and the print direction, press "Add this line", then place the order.'
      : `${!okF ? r.fabric : r.colour} is not in the form's list — pick it by hand.`), !(okF && okC));
}

function renderOrdDemand() {
  ordDemandLoad();
  if ($('odPickBar')) { $('odPickBar').classList.add('hide'); $('odPickBar').innerHTML = ''; }
  const d = ordDemandRows();
  ORD.rows = d.rows;
  const s = k => d.rows.reduce((a, r) => a + (r[k] || 0), 0);
  const anyAt = d.rows.some(r => r.atM != null), anyRfd = d.rows.some(r => r.have != null);

  $('odKpis').innerHTML = '<div class="jw-kpiname">Demand — printing &amp; cloth</div><div class="jw-kpis">'
    + ordKpiCard(nf(Math.round(s('runNeed'))) + ' m', 'Running cloth', 'cut', 'blue', 'to print on sheeting')
    + ordKpiCard(nf(Math.round(s('runGive'))) + ' m', 'Running to give', 'up', 'blue',
        anyAt ? nf(Math.round(s('runAtM'))) + ' m already at printers' : 'vendor orders not read')
    + ordKpiCard(nf(s('cutPcs')) + ' pcs', 'Cut pieces', 'list', 'amber', 'to print as pieces')
    + ordKpiCard(nf(s('cutGive')) + ' pcs', 'Pieces to give', 'up', 'amber',
        anyAt ? nf(s('cutAtPcs')) + ' already at printers' : 'vendor orders not read')
    + ordKpiCard(anyRfd ? nf(Math.round(s('have'))) + ' m' : '—', 'RFD in stock', 'ok',
        anyRfd ? 'green' : 'blue', anyRfd ? 'on the shelf today' : 'fabric ledger not read')
    + ordKpiCard(anyRfd ? nf(Math.round(s('short'))) + ' m' : '—', 'Short by', 'alert',
        anyRfd && s('short') > 0 ? 'red' : 'green', anyRfd ? 'cloth for both kinds' : 'needs the fabric ledger')
    + '</div>';

  const head = ordHead([['Fabric', ''], ['SKUs', 'num'],
    ['Running · needed', 'num'], ['Running · at printers', 'num'], ['Running · to give', 'num'],
    ['Cut pcs · to print', 'num'], ['Cut pcs · at printers', 'num'], ['Cut pcs · to give', 'num'],
    ['RFD in stock', 'num'], ['Short by', 'num']]);
  const dash = '<span class="muted">—</span>';
  $('odTable').innerHTML = head + '<tbody>' + (d.rows.length ? d.rows.map(r => '<tr>'
    + '<td class="frz" style="text-align:left"><b>' + esc(r.fabric) + '</b></td>'
    + '<td class="num">' + (r.skus || dash) + '</td>'
    + '<td class="num">' + ordDemN(r.runNeed, ' m') + '</td>'
    + '<td class="num">' + (r.runAtM == null ? dash : ordDemN(r.runAtM, ' m')) + '</td>'
    + '<td class="num" style="font-weight:700">' + ordDemN(r.runGive, ' m') + '</td>'
    + '<td class="num">' + ordDemN(r.cutPcs, ' pcs') + '</td>'
    + '<td class="num">' + (r.cutAtPcs == null ? dash : ordDemN(r.cutAtPcs, ' pcs')) + '</td>'
    + '<td class="num" style="font-weight:700">' + ordDemN(r.cutGive, ' pcs') + '</td>'
    + '<td class="num"' + (r.have != null && r.have < 0 ? ' style="color:var(--bad)" title="More cloth has gone out under this name than ever came in — is its opening stock entered under a different spelling?"' : '') + '>' + ordDemM(r.have) + '</td>'
    + '<td class="num" style="font-weight:700' + (r.short ? ';color:var(--bad)' : '') + '" title="All the cloth still to leave RFD — running cloth to give, and the cloth the cut pieces are cut from — less what is on the shelf.">' + ordDemM(r.short) + '</td>'
    + '</tr>').join('')
    : '<tr><td colspan="10" class="muted" style="padding:16px">Nothing on the open book needs printing.</td></tr>')
    + '</tbody>';

  /* WHAT IS NOT IN THE TOTAL, AND WHY. A figure quietly short by the pieces nobody could price is the
   * one mistake this screen must not make. */
  const say = [];
  if (ORD_DEM.busy) say.push('reading the fabric ledger and the vendor orders…');
  if (ORD_DEM.tried && !ORD_DEM.voOk) say.push('"At printers" is blank — the vendor orders could not be read, so this shows the whole requirement, not what is left to give');
  if (ORD_DEM.tried && !ORD_DEM.fabOk) say.push('"RFD in stock" is blank — the fabric ledger could not be read');
  if (d.unknownPcs) say.push(nf(d.unknownPcs) + ' piece(s) are NOT counted: '
    + d.unknown.slice(0, 4).map(u => u.sku + ' (' + u.why + ')').join(', ')
    + (d.unknown.length > 4 ? ' and ' + nf(d.unknown.length - 4) + ' more SKU(s)' : ''));
  if (d.cutNoConsPcs) say.push(nf(d.cutNoConsPcs) + ' cut piece(s) have no consumption, so their cloth is not in RFD or Short by');
  if (d.noPrintPcs) say.push(nf(d.noPrintPcs) + ' piece(s) are left out because they are never printed — '
    + d.noPrint.slice(0, 3).map(u => u.why).join('; '));
  $('odMsg').className = 'muted';
  $('odMsg').textContent = nf(d.rows.length) + ' fabric(s) · ' + nf(d.pcs) + ' piece(s) to make'
    + (say.length ? ' · ' + say.join(' · ') : '');
}

/** The order book as CSV lines — a function so that a test can read the file and not only its name. */
function ordBookCsv(rows) {
  /* Two columns here, not the one the table stacks: a spreadsheet is sorted and filtered on them
   * separately. */
  const lines = [['Order No', 'Shopify Order', 'Adjustment', 'Date', 'SKU', 'Priority', 'Article', 'Subtype', 'Color', 'Size', 'Ordered', 'Cut',
    'Cut %', 'Issued', 'Received', 'Made', 'To cut', 'To make', 'Status', 'Printer', 'Printed',
    /* What the vendors hold for the line, as the screen shows it — one column each, because a spreadsheet
     * is filtered on "with vendor" and "waiting at", not read a cell at a time. */
    'Vendor', 'Given to vendor', 'Back from vendor', 'Not given', 'Vendor orders', 'Promised', 'How linked',
    'Into store', 'In store now', 'To FBA', 'FBA not yet shipped', 'Sent never recorded', 'Waiting at'].map(csvCell).join(',')];
  rows.forEach(r => { const v = ordVendorOf(r.orderNo, r.sku);
    lines.push([r.orderNo, r.shopOrderNo || '', r.adjId || '', r.orderDate, r.sku, ordPri(r.sku), r.articleType, r.articleSubtype, r.color, r.size,
    r.qty, r.cutReq ? r.cut : '', r.cutReq ? r.cutPct.toFixed(1) : '', r.issued, r.received, r.pressed,
    r.pendingCut, r.pendingMake, r.open ? 'Open' : 'Complete', r.printer ? voName(r.printer) : '', r.printer ? r.printed : '',
    v ? [...new Set(v.parts.map(p => voName(p.vendorCode)))].join(' + ') : '', v ? v.given : '', v ? v.back : '',
    v ? Math.max(0, r.qty - v.given) : '', v ? [...new Set(v.parts.map(p => p.vpo))].join(' ') : '',
    v ? [...new Set(v.parts.map(p => p.due).filter(Boolean))].join(' ') : '',
    v ? (v.shared ? 'shared by SKU' : (v.parts.every(p => p.stamped) ? 'placed for this order' : 'only order for this SKU')) : '',
    (g => g ? [g.in, g.store, g.fba, g.fbaOpen] : ['', '', '', ''])(ordFgAt(r.orderNo, r.sku)),
    r.unrecorded || '', ordWaitingAt(r)].flat().map(csvCell).join(',')); });
  return lines;
}

/** The colour code in a SKU: the digits after the leading letters — RQL351-Q → "351", RQL0009-Q-Front → "0009". */
const ordColCodeOf = sku => (String(sku || '').toUpperCase().match(/^[A-Z]+(\d{1,5})/) || ['', ''])[1];
/** The catalogue lines for a fabric, colour, print direction (when given) and colour code (when given — the exact code,
 * else the same number: 009 and 0009). */
function ordFabHits(fabric, colour, dir, code) {
  const lo = x => String(x || '').trim().toLowerCase();
  let cat;
  try { cat = [...voFabricCatalogue().values()]; } catch (e) { return []; }
  const hits = cat.filter(c => lo(c.fabric) === lo(fabric) && lo(c.colour) === lo(colour) && (!lo(dir) || !c.width || lo(c.dir) === lo(dir)));
  if (!code) return hits;
  const exact = hits.filter(c => ordColCodeOf(c.sku) === code);
  return exact.length ? exact : hits.filter(c => Number(ordColCodeOf(c.sku)) === Number(code));
}
/** The fabric SKU(s) of the catalogue for a fabric, colour and — when given — print direction. */
function ordFabSkuOf(fabric, colour, dir, code) {
  return [...new Set(ordFabHits(fabric, colour, dir, code).map(c => c.sku))].join(' ');
}
/* FRONT AND BACK (Ravi, 2026-09-30: "back and front ke sku ka fabric alag alag dikhay — 90x96 ka cons 5 h to 2.5 front
 * ke liye 2.5 back ke liye"). A quilt's voil comes as a Front SKU and a Back SKU; the cloth is split evenly between the
 * sides the catalogue has. Map side → SKUs; empty when the catalogue has no sides for it. */
function ordFabSides(fabric, colour, dir, code) {
  const out = new Map();
  ordFabHits(fabric, colour, dir, code).forEach(c => { const sd = String(c.side || '').trim(); if (!sd) return;
    if (!out.has(sd)) out.set(sd, new Set()); out.get(sd).add(c.sku); });
  return out;
}
$('odExport').onclick = () => {
  const rows = ORD.rows || []; if (!rows.length) return;
  const v = ordView();
  if (v === 'track') {
    const out = [['Order No', 'From', 'Date', 'Days open', 'Lines', 'Ordered', 'Made', 'In store', 'To FBA', 'Shipped to Amazon',
      'Dispatched', 'Handed over', 'Where it is', 'Lines there', 'Shopify', 'Shopify carrier', 'Shopify tracking', 'Shipment / papers'].map(csvCell).join(',')];
    rows.forEach(o => out.push([o.orderNo, o.src, o.date, o.days == null ? '' : o.days, o.lines, o.ordered, o.pressed, o.store, o.fba,
      o.fbaShip, o.issued, o.handed, ORD_TRACK[o.stage][1], o.n[o.stage], o.shopState || '',
      [...new Set((o.shop || []).map(x => x.via))].join(' '), (o.shop || []).flatMap(x => x.trk).join(' '), [...o.ships].join(' · ')].map(csvCell).join(',')));
    return ptDownload('order-tracking', out);
  }
  if (v === 'demtot') {
    const r2 = v2 => v2 == null ? '' : Math.round(v2 * 100) / 100;
    /* The print direction and the sizes each line is for, as on the screen (Ravi, 2026-09-30: "export me bhi dikhe
     * horizontal ya vertical me print hona h"). */
    const dirOf = r => r.dir || ((ORD.demPick || {})[r.key] || {}).dir || '';
    const forWhat = r => (r.products || []).filter(p => !p.asPcs && p.pcs > 0).map(p => [p.what, p.size].filter(Boolean).join(' ') + ' (' + p.pcs + ')').join(', ');
    /* THE FABRIC SKU, in the file only (Ravi, 2026-09-30: "fabric ka sku bhi aa jay but sirf export file me") — the
     * catalogue line that is this fabric, colour and direction; every match when more than one, none guessed. */
    const out = [['Fabric', 'Fabric SKU', 'Side', 'Colour', 'Print direction', 'For', 'Pieces to make', 'Running cloth needed (m)', 'Running with printers (m)', 'Running still to give (m)',
      'Cut pieces needed', 'Cut pieces with printers', 'Cut pieces still to give'].map(csvCell).join(',')];
    rows.forEach(r => {
      const codes = [...(r.codes || new Map()).values()].filter(c => c.need > 0);
      /* ONE LINE PER COLOUR CODE (each its own share of the cloth, and with printers / to give shared the same way),
       * then one per side. A row with no running cloth, or no code to read, is one line as before. */
      const parts = codes.length ? codes : [null];
      parts.forEach(c => {
        const f = c && r.need ? c.need / r.need : 1, code = c ? c.code : '';
        const pcs = c ? c.pcs : r.pcs;
        const what = c ? [...c.products].map(([w, n]) => w + ' (' + n + ')').join(', ') : forWhat(r);
        const sides = r.need ? ordFabSides(r.fabric, r.colour, dirOf(r), code) : new Map();
        if (sides.size > 1) {
          /* One line per side, each with its share of the running cloth; every piece needs every side. */
          const n = sides.size, h = v => v == null ? '' : r2(v * f / n);
          [...sides.entries()].sort((a, b) => a[0].localeCompare(b[0]) * -1).forEach(([sd, skus]) =>
            out.push([r.fabric, [...skus].join(' '), sd, r.colour, dirOf(r), what, pcs, h(r.need), h(r.atM), h(r.give), '', '', ''].map(csvCell).join(',')));
          return;
        }
        const h = v => v == null ? '' : r2(v * f);
        out.push([r.fabric, ordFabSkuOf(r.fabric, r.colour, dirOf(r), code), '', r.colour, dirOf(r), what, pcs, h(r.need), h(r.atM), h(r.give),
          c ? '' : (r.cutPcs || ''), c ? '' : r2(r.cutAtPcs), c ? '' : r2(r.cutGive)].map(csvCell).join(','));
      });
      /* Cut pieces of the same colour, when the row also has running cloth split above, on a line of their own. */
      if (codes.length && r.cutPcs) out.push([r.fabric, ordFabSkuOf(r.fabric, r.colour, dirOf(r)), '', r.colour, dirOf(r), 'cut pieces', r.cutPcs, '', '', '', r.cutPcs, r2(r.cutAtPcs), r2(r.cutGive)].map(csvCell).join(','));
    });
    return ptDownload('cloth-by-fabric-colour', out);
  }
  if (v === 'democol') {
    const r2 = v2 => v2 == null ? '' : Math.round(v2 * 100) / 100;
    const out = [['Fabric', 'Fabric SKU', 'Colour', 'Print direction', 'Product', 'Size', 'Printed as', 'SKUs', 'To make', 'Per piece (m)', 'Running cloth (m)',
      'Cut pieces', 'At printers (pcs)', 'Running at printers (m)', 'Running to give (m)', 'Pieces to give', 'Ruffle fabric', 'Ruffle cloth (m)'].map(csvCell).join(',')];
    rows.forEach(r => out.push((r.kind === 'col'
      ? [r.fabric, ordFabSkuOf(r.fabric, r.colour, r.dir), r.colour, r.dir || '', '(all)', '', '', r.skus, r.pcs, '', r2(r.need), r.cutPcs, r2(r.atPcs), r2(r.atM), r2(r.give), r2(r.cutGive), '', r2(r.rufM)]
      : [r.fabric, ordFabSkuOf(r.fabric, r.colour, r.dir), r.colour, r.dir || '', r.what, r.size, r.asPcs ? 'Cut pieces' : 'Running', r.skus, r.pcs,
        !r.asPcs && isFinite(r.perMin) ? r2(r.perMin) : '', r.asPcs ? '' : r2(r.need), r.asPcs ? r.pcs : '',
        r2(r.atPcs), '', '', r.asPcs ? r2(r.cutGive) : '', r.rufFab, r2(r.rufM)])
      .map(csvCell).join(',')));
    return ptDownload('printing-cloth-by-colour', out);
  }
  if (v === 'demand') {
    const out = [['Fabric', 'SKUs', 'To make', 'Running needed (m)', 'Running at printers (m)', 'Running to give (m)',
      'Cut pieces to print', 'Cut pieces at printers', 'Cut pieces to give', 'All cloth needed (m)', 'All cloth still to give (m)',
      'RFD in stock (m)', 'Short by (m)'].map(csvCell).join(',')];
    const r2 = v2 => v2 == null ? '' : Math.round(v2);
    rows.forEach(r => out.push([r.fabric, r.skus, r.pcs, r2(r.runNeed), r2(r.runAtM), r2(r.runGive),
      r2(r.cutPcs), r2(r.cutAtPcs), r2(r.cutGive), r2(r.need), r2(r.give), r2(r.have), r2(r.short)].map(csvCell).join(',')));
    return ptDownload('printing-and-cloth-demand', out);
  }
  if (v !== 'book' && v !== 'bookdone') {
    /* Two columns for the two ids, not the one the table stacks — a spreadsheet sorts on them
     * separately. */
    const bySku = v === 'shopsku';
    const out = bySku
      ? [['SKU', 'Priority', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Received', 'Made',
          'To make', 'Shopify orders', 'Needs master row'].map(csvCell).join(',')]
      : [['Order No', 'Shopify Order', 'Adjustment', 'Date', 'SKU', 'Priority', 'Article', 'Subtype', 'Color',
          'Size', 'Pieces', 'Cut', 'Issued', 'Received', 'QC passed', 'Made', 'To make', 'Status', 'Printer', 'Printed',
          'With vendor', 'Back from vendor', 'Handed over', 'Sent never recorded', 'Waiting at'].map(csvCell).join(',')];
    rows.forEach(r => out.push(bySku
      ? [r.sku, ordPri(r.sku), r.articleType, r.articleSubtype, r.color, r.size, r.orders.length, r.qty, r.cut,
        r.issued, r.received, r.pressed, r.pendingMake,
        r.orders.map(o => (o.shop || o.no) + '×' + o.qty).join(' '), r.needsSku ? 'yes' : ''].map(csvCell).join(',')
      : ((v, q) => [r.orderNo, r.shopOrderNo || '', r.adjId || '', r.orderDate, r.sku, ordPri(r.sku), r.articleType,
        r.articleSubtype, r.color, r.size, r.qty, r.cut, r.issued, r.received, q ? q.ok : '', r.pressed, r.pendingMake,
        r.handedAt ? 'Handed over' : (r.open ? 'Open' : 'Complete'),
        r.printer ? voName(r.printer) : (v ? [...new Set(v.parts.map(p => voName(p.vendorCode)))].join(' + ') : ''),
        r.printer ? r.printed : '',
        v ? v.given : '', v ? v.back : '', r.handedAt ? ptIsoDate(r.handedAt) : '', r.unrecorded || '', ordWaitingAt(r)].map(csvCell).join(','))(
          ordVendorOf(r.orderNo, r.sku), ordQcOf(r.orderNo, r.sku))));
    ptDownload(bySku ? 'shopify-production-by-sku' : (v === 'shopdone' ? 'shopify-complete-by-order' : 'shopify-production-by-order'), out);
    return;
  }
  ptDownload('order-console', ordBookCsv(rows));
};

