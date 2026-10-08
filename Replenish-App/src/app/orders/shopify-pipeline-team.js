/* ==== SHOPIFY PIPELINE AND TEAM WORK (Ravi, 2026-09-28) ====
 * "shopify ka mera pas kya order aaya h and abhi kis stage par hai — cut, issue, receive, printing, press … meri team ka
 * work check nahi kar pa rha hu ki usne kya kam kiya". Both views read the registers the floor already fills: every
 * entry carries its work date and who made it (cutting: cutDate · addedBy; Job Work: issueDate / receivingDate · the
 * karigar; press: entryDate · addedBy; the handover: handedAt · handedBy). Nothing new is typed anywhere. */
const ordWho = e => String(e || '').split('@')[0];
const ORD_EV_KIND = { cut: 'Cut', issue: 'Given to karigar', receive: 'Back from karigar', press: 'Pressed', handover: 'Handed over' };
let ORD_EV_IX = { cut: null, base: null, press: null, ob: null, n: -1, list: null, last: null };
/** Every production entry, newest first: { kind, ms, day, orderNo, sku, pcs, by, karigar }. */
function ordEvents() {
  const cut = PT.cut || PT_NONE, base = PT.base || PT_NONE, press = PTG.press || PT_NONE, ob = PTG.ob || PT_NONE;
  /* The hand-overs are on pt_shopProd, and a receipt replaces that object — so it is part of the key. */
  const sp = PTG.shopProd || PT_NONE;
  const n = cut.length + base.length + press.length + ob.length;
  if (ORD_EV_IX.list && ORD_EV_IX.cut === cut && ORD_EV_IX.base === base && ORD_EV_IX.press === press && ORD_EV_IX.ob === ob && ORD_EV_IX.sp === sp && ORD_EV_IX.n === n) return ORD_EV_IX;
  const list = [];
  const push = (kind, r, day, pcs, by, karigar) => {
    const q = Number(pcs) || 0;
    if (!(q > 0) || !r) return;
    const d = ptIsoDate(day) || ptIsoDate(r.addedAt) || '';
    list.push({ kind, ms: ptDtMs(day) || ptDtMs(r.addedAt) || 0, day: d, orderNo: obUC(r.orderNo), sku: obUC(r.sku), pcs: q,
      by: ordWho(by), karigar: String(karigar || '').trim() });
  };
  cut.forEach(r => r && push('cut', r, r.cutDate, r.pieces, r.addedBy));
  base.forEach(r => {
    if (!r) return;
    push('issue', r, r.issueDate, r.issuePieces, r.addedBy, r.empName);
    if (r.receivingDate) push('receive', r, r.receivingDate, r.receivedPieces, r.recvBy || r.lastEditedBy || '', r.empName);
  });
  press.forEach(r => r && push('press', r, r.entryDate, r.pieces, r.addedBy));
  /* EVERY RECEIPT, not one event per finished line (2026-10-05): a line taken in three goes is three hand-overs, each on
   * its own day, and a part-taken line is work done too. */
  shpHandRegister().forEach(h => push('handover', h, h.at, h.pcs, h.acceptedBy || h.by));
  list.sort((a, b) => b.ms - a.ms);
  const last = new Map();
  list.forEach(e => { if (e.orderNo && !last.has(e.orderNo)) last.set(e.orderNo, e); });
  ORD_EV_IX = { cut, base, press, ob, sp, n, list, last };
  return ORD_EV_IX;
}

/* ---- Shopify — production pipeline ---- */
const ORD_PIPE_STALE_DAYS = 5;
/** The stages a Shopify line passes, by their place in ORD_TRACK. */
const ORD_PIPE = [[0, 'At the printer'], [1, 'Cutting'], [2, 'To give a karigar'], [3, 'With karigar'], [4, 'Press'], [5, 'Ready to hand over'], [9, 'Handed over / shipped']];
function ordPipeRows() {
  const ev = ordEvents(), now = Date.now(), by = new Map();
  ordApply(shppLines(), ordFilters()).forEach(r => {
    let o = by.get(r.orderNo);
    if (!o) {
      o = { orderNo: r.orderNo, shopNo: r.shopOrderNo || '', shopId: r.shopOrderId || '', date: r.orderDate || '', lines: 0, ordered: 0,
        given: 0, back: 0, cut: 0, cutOf: 0, issued: 0, received: 0, qc: 0, pressed: 0, handed: 0, stage: 99, n: {} };
      by.set(r.orderNo, o);
    }
    const v = ordVendorOf(r.orderNo, r.sku), q = ordQcOf(r.orderNo, r.sku);
    const cap = x => Math.min(r.qty, Number(x) || 0);
    o.lines++; o.ordered += r.qty;
    o.given += cap(r.printer ? r.qty : (v ? v.given : 0)); o.back += cap(r.printer ? r.printed : (v ? v.back : 0));
    if (r.cutReq) { o.cut += cap(r.cut); o.cutOf += r.qty; }
    o.issued += cap(r.issued); o.received += cap(r.received); o.qc += cap(q ? q.ok : 0); o.pressed += cap(r.pressed);
    if (r.handedAt || r.shopDoneAt) o.handed += r.qty;
    const st = (r.handedAt || r.shopDoneAt) ? 9 : Math.min(5, ordTrackStage(r));
    o.n[st] = (o.n[st] || 0) + 1; o.stage = Math.min(o.stage, st);
  });
  return [...by.values()].map(o => {
    const last = ev.last.get(o.orderNo) || null;
    const placed = ptDtMs(o.date) || 0;
    const idle = Math.floor((now - (last ? last.ms : placed || now)) / 864e5);
    return Object.assign(o, { last, days: placed ? Math.max(0, Math.floor((now - placed) / 864e5)) : null, idle,
      stuck: o.stage !== 9 && idle >= ORD_PIPE_STALE_DAYS });
  }).sort((a, b) => (a.stage === 9) - (b.stage === 9) || (b.stuck - a.stuck) || (ptDtMs(a.date) || 0) - (ptDtMs(b.date) || 0));
}
function renderOrdPipe() {
  if (!ORD.shopTrk && !ORD.shopTrkBusy) ordTrackShopLoad();
  const all = ordPipeRows();
  const key = /^pp(\d+|stuck)$/.test(ORD_KPI) ? ORD_KPI.slice(2) : '';
  const rows = key === 'stuck' ? all.filter(o => o.stuck) : key !== '' ? all.filter(o => o.stage === +key) : all.filter(o => o.stage !== 9);
  ORD.rows = rows;
  const cnt = st => all.filter(o => o.stage === st).length;
  $('odKpis').innerHTML = '<div class="jw-kpiname">Shopify — production pipeline · every order, stage by stage</div><div class="jw-kpis">'
    + ORD_PIPE.map(([st, l]) => ordKpiCard(nf(cnt(st)), l, st === 9 ? 'ok' : st === 5 ? 'box' : 'clock', st === 9 ? 'green' : st === 0 || st === 5 ? 'amber' : 'blue',
      st === 9 ? 'finished' : 'orders whose furthest-back line is here', { key: 'pp' + st, tip: 'Show only these orders. Click again for every open one.' })).join('')
    + ordKpiCard(nf(all.filter(o => o.stuck).length), `No work for ${ORD_PIPE_STALE_DAYS}+ days`, 'alert', 'amber', 'nothing entered against them', { key: 'ppstuck', colour: 'var(--bad)', tip: 'Open orders nobody has entered anything against for ' + ORD_PIPE_STALE_DAYS + ' days or more.' })
    + '</div>';
  const cell = (n, of) => !of ? '<span class="muted">—</span>'
    : `<span${n >= of ? ' style="color:var(--accent);font-weight:700"' : n > 0 ? ' style="color:#7f6000;font-weight:700"' : ''}>${nf(n)}</span><span class="muted" style="font-size:11px"> / ${nf(of)}</span>`;
  const head = ordHead([['Order', ''], ['Placed', ''], ['Days', 'num'], ['Pcs', 'num'], ['Printer back', 'num'], ['Cut', 'num'], ['Given to karigar', 'num'],
    ['Back from karigar', 'num'], ['QC', 'num'], ['Made', 'num'], ['Handed over', 'num'], ['Now', ''], ['Last work', ''], ['Shopify', '']]);
  const body = rows.slice(0, ORD_CAP).map(o => {
    const now = o.stage === 9 ? '<span class="jw-st done">Done</span>'
      : `<span class="jw-st ${o.stuck ? 'pend' : 'prog'}">${esc((ORD_PIPE.find(x => x[0] === o.stage) || [0, ''])[1])}</span>`
        + (o.lines > 1 && (o.n[o.stage] || 0) < o.lines ? `<div class="muted" style="font-size:11px">${nf(o.n[o.stage])} of ${nf(o.lines)} lines</div>` : '');
    const l = o.last;
    const lastTxt = l ? `${esc(ORD_EV_KIND[l.kind])} ${nf(l.pcs)} · ${esc(l.day)}<div class="muted" style="font-size:11px">${esc(l.karigar ? l.karigar + (l.by ? ' · by ' + l.by : '') : l.by || '')}</div>`
      : '<span class="muted">nothing entered yet</span>';
    const sh = o.shopId ? ordShopTrkOf(o.shopId) : null;
    const shTxt = sh ? (sh.cancelledAt ? 'Cancelled' : sh.ff === 'fulfilled' ? 'Shipped' : sh.ff === 'partial' ? 'Part shipped' : 'Not shipped') : '';
    return '<tr>'
      + `<td class="frz" style="text-align:left"><a href="#" data-ordj="${esc(o.orderNo)}" title="This order, start to finish" style="font-weight:700">${esc(o.shopNo || o.orderNo)}</a>`
        + `<div class="muted" style="font-size:11px">${esc(o.orderNo)} · ${nf(o.lines)} line${o.lines > 1 ? 's' : ''}</div></td>`
      + `<td>${esc(ptIsoDate(o.date) || o.date)}</td><td class="num">${o.days == null ? '—' : nf(o.days)}</td><td class="num" style="font-weight:700">${nf(o.ordered)}</td>`
      + `<td class="num">${cell(o.back, o.given)}</td><td class="num">${cell(o.cut, o.cutOf)}</td><td class="num">${cell(o.issued, o.ordered)}</td>`
      + `<td class="num">${cell(o.received, o.ordered)}</td><td class="num">${o.qc ? cell(o.qc, o.ordered) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${cell(o.pressed, o.ordered)}</td><td class="num">${cell(o.handed, o.ordered)}</td>`
      + `<td style="text-align:left">${now}</td>`
      + `<td style="text-align:left${o.stuck ? ';color:var(--bad)' : ''}">${lastTxt}${o.stuck ? `<div style="font-size:11px;font-weight:700">${nf(o.idle)} days ago</div>` : ''}</td>`
      + `<td style="text-align:left">${shTxt ? esc(shTxt) : '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  $('odTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="14" class="muted" style="padding:14px;text-align:left">Nothing here.</td></tr>`) + '</tbody>';
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(rows.length)} Shopify order(s)` + (key === '' ? ' still open' : '')
    + (rows.length > ORD_CAP ? ` · showing ${nf(ORD_CAP)}` : '')
    + ` · a figure is pieces of the order that have passed that step · click an order for its whole journey`;
  ordMoreBtn(rows.length);
}

/* ---- Team work — who did what ---- */
let ORD_TEAM_PICK = null;
/** The entries in the dates picked (today when none), narrowed by the Source filter and the search box. */
function ordTeamEvents() {
  const f = ordFilters(), today = dToday();
  const d1 = f.d1 || (f.d2 ? '' : today), d2 = f.d2 || (f.d1 ? '' : today);
  const q = f.q;
  const list = ordEvents().list.filter(e => (!d1 || e.day >= d1) && (!d2 || e.day <= d2)
    && (!f.src || ordSrcOf(e.orderNo) === f.src)
    && (!q || [e.by, e.karigar, e.orderNo, e.sku].join(' ').toLowerCase().includes(q)));
  return { list, d1, d2 };
}
function ordTeamTables(list) {
  const staff = new Map(), kar = new Map();
  list.forEach(e => {
    const k = e.kind === 'receive' && !e.by ? '(not recorded)' : (e.by || '(not recorded)');
    let s = staff.get(k); if (!s) staff.set(k, s = { who: k, cut: 0, issue: 0, receive: 0, press: 0, handover: 0, entries: 0, last: 0 });
    s[e.kind] += e.pcs; s.entries++; if (e.ms > s.last) s.last = e.ms;
    if (e.karigar && (e.kind === 'issue' || e.kind === 'receive')) {
      let g = kar.get(e.karigar); if (!g) kar.set(e.karigar, g = { who: e.karigar, issue: 0, receive: 0, entries: 0, last: 0 });
      g[e.kind] += e.pcs; g.entries++; if (e.ms > g.last) g.last = e.ms;
    }
  });
  const order = (a, b) => b.entries - a.entries || a.who.localeCompare(b.who);
  return { staff: [...staff.values()].sort(order), kar: [...kar.values()].sort(order) };
}
function renderOrdTeam() {
  const { list, d1, d2 } = ordTeamEvents();
  const { staff, kar } = ordTeamTables(list);
  const tot = k => list.filter(e => e.kind === k).reduce((t, e) => t + e.pcs, 0);
  const span = d1 === d2 ? (d1 === dToday() ? 'today' : d1) : `${d1 || '…'} to ${d2 || '…'}`;
  $('odKpis').innerHTML = `<div class="jw-kpiname">Team work — ${esc(span)} · pieces entered in the registers</div><div class="jw-kpis">`
    + ordKpiCard(nf(tot('cut')), 'Cut', 'cut', 'blue', 'cutting register')
    + ordKpiCard(nf(tot('issue')), 'Given to karigars', 'up', 'blue', 'Job Work — issued')
    + ordKpiCard(nf(tot('receive')), 'Back from karigars', 'tick', 'green', 'Job Work — received')
    + ordKpiCard(nf(tot('press')), 'Pressed', 'press', 'blue', 'press register')
    + ordKpiCard(nf(tot('handover')), 'Handed over', 'box', 'green', 'to the shipping team')
    + ordKpiCard(nf(list.length), 'Entries', 'doc', 'blue', 'made by ' + nf(staff.length) + ' people')
    + '</div>';
  const n = v => v ? nf(v) : '<span class="muted">—</span>';
  const t = ms => ms ? esc(new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })) : '';
  const staffRows = staff.map(s => `<tr data-teamwho="by|${esc(s.who)}" style="cursor:pointer"><td class="frz" style="text-align:left;font-weight:700">${esc(s.who)}</td>`
    + `<td class="num">${n(s.cut)}</td><td class="num">${n(s.issue)}</td><td class="num">${n(s.receive)}</td><td class="num">${n(s.press)}</td><td class="num">${n(s.handover)}</td>`
    + `<td class="num">${nf(s.entries)}</td><td>${t(s.last)}</td></tr>`).join('');
  const karRows = kar.map(k => `<tr data-teamwho="kar|${esc(k.who)}" style="cursor:pointer"><td class="frz" style="text-align:left;font-weight:700">${esc(k.who)}</td>`
    + `<td class="num">${n(k.issue)}</td><td class="num">${n(k.receive)}</td><td class="num">${nf(k.entries)}</td><td>${t(k.last)}</td></tr>`).join('');
  $('odTable').innerHTML = ordHead([['Entered by', ''], ['Cut', 'num'], ['Given to karigar', 'num'], ['Back from karigar', 'num'], ['Pressed', 'num'], ['Handed over', 'num'], ['Entries', 'num'], ['Last', '']])
    + '<tbody>' + (staffRows || '<tr><td colspan="8" class="muted" style="padding:14px;text-align:left">Nothing entered in these dates.</td></tr>') + '</tbody>'
    + (karRows ? '<thead><tr><th class="frz" style="padding-top:18px">Karigar</th><th class="num" style="padding-top:18px">Given</th><th class="num" style="padding-top:18px">Brought back</th><th class="num" style="padding-top:18px">Entries</th><th style="padding-top:18px">Last</th><th></th><th></th><th></th></tr></thead>'
      + '<tbody>' + karRows.replace(/<\/tr>/g, '<td></td><td></td><td></td></tr>') + '</tbody>' : '');
  ORD.rows = list;
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(list.length)} entr${list.length === 1 ? 'y' : 'ies'} ${d1 === d2 && d1 === dToday() ? 'today' : 'in these dates'}`
    + ' · pick dates in the From / To boxes above, Source for Shopify only · click a name for every entry behind it';
}
function ordTeamOpen(which) {
  const [kind, who] = String(which || '').split(/\|(.*)/s);
  const mine = ordTeamEvents().list.filter(e => kind === 'kar' ? e.karigar === who : ((e.kind === 'receive' && !e.by ? '(not recorded)' : (e.by || '(not recorded)')) === who));
  ptOpenDialog({
    title: (kind === 'kar' ? 'Karigar ' : '') + who,
    subtitle: `${nf(mine.length)} entr${mine.length === 1 ? 'y' : 'ies'} · ${nf(mine.reduce((a, e) => a + e.pcs, 0))} piece(s)`,
    html: `<div class="xlwrap" style="max-height:56vh;border:1px solid var(--line);border-radius:10px"><table class="xl" style="font-size:12.5px"><thead><tr>`
      + '<th style="text-align:left">Date</th><th style="text-align:left">Step</th><th style="text-align:left">Order</th><th style="text-align:left">SKU</th><th class="num">Pcs</th><th style="text-align:left">' + (kind === 'kar' ? 'Entered by' : 'Karigar') + '</th></tr></thead><tbody>'
      + mine.slice(0, 400).map(e => `<tr><td style="text-align:left">${esc(e.day)}</td><td style="text-align:left">${esc(ORD_EV_KIND[e.kind])}</td>`
        + `<td style="text-align:left">${esc(e.orderNo || '—')}</td><td style="text-align:left;font-family:ui-monospace,monospace">${esc(e.sku)}</td>`
        + `<td class="num">${nf(e.pcs)}</td><td style="text-align:left">${esc(kind === 'kar' ? e.by : e.karigar)}</td></tr>`).join('')
      + '</tbody></table></div>' + (mine.length > 400 ? `<div class="muted" style="margin-top:6px">…and ${nf(mine.length - 400)} more.</div>` : ''),
  });
}
$('odTable').addEventListener('click', e => { const t = e.target.closest('[data-teamwho]'); if (t) ordTeamOpen(t.getAttribute('data-teamwho')); });
/* "+16 more" opens every order of that SKU; "show fewer" puts it back (2026-10-08, Ravi). */
$('odTable').addEventListener('click', e => {
  const m = e.target.closest && e.target.closest('[data-chipmore]'); if (!m) return;
  e.preventDefault();
  ORD.chipOpen = ORD.chipOpen || new Set();
  const k = m.getAttribute('data-chipmore');
  if (ORD.chipOpen.has(k)) ORD.chipOpen.delete(k); else ORD.chipOpen.add(k);
  renderOrd();
});

/* ---- Printers — which platform each order is for (Ravi, 2026-09-28) ----
 * A printer is given work two ways, and both are read here:
 *   from the Order Console (Assign printer) — the line names its customer order (shopOrderNo);
 *   from the vendor order form — the line names the orders it was placed for (forOrders, since 19 Sep), and an older
 *   line is shared among the orders wanting its SKU, oldest first, exactly as ordVendorAlloc deals it everywhere else.
 * The platform is the order number's: SHP / SPY Shopify, AMZ Amazon, B2B wholesale, ONL online; and whose, from the
 * master's brand for the SKU (else CPC… is CPC, R… is Ridhi). */
const ORD_PLAT_SRC = { SHP: 'Shopify', SPY: 'Shopify', ADJ: 'Shopify', AMZ: 'Amazon', B2B: 'B2B', ONL: 'Online' };
function ordPlatOf(orderNo, sku) {
  const src = ORD_PLAT_SRC[String(obUC(orderNo)).split('-')[0]] || 'Other';
  const m = typeof mdbOf === 'function' ? mdbOf(sku) : null, k = obUC(sku);
  const mb = String((m && m.brand) || '').trim();
  const brand = VP_BRANDS[obUC(mb)] || mb || (/^CPC/.test(k) ? 'CPC' : /^R/.test(k) ? 'Ridhi' : '');
  return src + (brand ? ' · ' + brand : '');
}
const ORD_PLAT_STOCK = 'Stock — no customer order';
function ordPrnPlatRows() {
  const rev = new Map();
  ordVendorAlloc().forEach((v, key) => {
    const cut = key.lastIndexOf('|'), orderNo = key.slice(0, cut), sku = key.slice(cut + 1);
    ((v && v.parts) || []).forEach(p => {
      const k = p.vendorCode + '|' + p.vpo + '|' + sku;
      if (!rev.has(k)) rev.set(k, []);
      rev.get(k).push({ orderNo, qty: p.qty });
    });
  });
  const out = [];
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled' || !voIsPrinting(o)) return;
    const vpo = o.orderNo || o.id, run = voRunning(o);
    voLines(o).forEach(l => {
      if (!l || l.cancelled) return;
      const given = voQty(o, l), back = voDone(l);
      if (!(given > 0)) return;
      const sku = obUC(l.sku);
      let orders = [];
      if (!run && l.shopOrderNo) orders = [{ orderNo: obUC(l.shopOrderNo), qty: given, ref: String(l.shopRef || '') }];
      else if (!run && Array.isArray(l.forOrders) && l.forOrders.length) orders = l.forOrders.map(f => ({ orderNo: obUC(f.orderNo), qty: parseFloat(f.qty) || 0 }));
      else if (!run) orders = rev.get(o.vendorCode + '|' + vpo + '|' + sku) || [];
      const taken = orders.reduce((t, x) => t + (x.qty || 0), 0);
      const plats = new Map();
      orders.forEach(x => { const p = ordPlatOf(x.orderNo, sku); plats.set(p, (plats.get(p) || 0) + (x.qty || 0)); });
      if (run) plats.set('Running cloth', given);
      else if (given - taken > 0.001) plats.set(ORD_PLAT_STOCK, (plats.get(ORD_PLAT_STOCK) || 0) + given - taken);
      out.push({ vendorCode: o.vendorCode, vpo, date: o.orderDate || o.createdAt || '', sku: run ? '' : sku,
        item: run ? [l.fabricType, l.color].filter(Boolean).join(' · ') : [l.articleSubtype || l.articleType, l.color, l.size].filter(Boolean).join(' · '),
        unit: run ? 'm' : 'pcs', given, back, bal: Math.max(0, given - back), orders, plats,
        via: l.shopOrderNo ? 'Order Console' : (l.forOrders && l.forOrders.length ? 'Placed for these orders' : run ? 'Running cloth' : 'Shared by SKU, oldest order first') });
    });
  });
  return out.sort((a, b) => (b.bal > 0) - (a.bal > 0) || (ptDtMs(b.date) || 0) - (ptDtMs(a.date) || 0));
}
function renderOrdPrnPlat() {
  if (VO.rows === null) { ensureVo().then(() => { if (ordView() === 'prnplat') renderOrd(); }).catch(() => {}); ptEmpty('odTable', 'Reading the vendor orders…'); return; }
  const f = ordFilters();
  const all = ordPrnPlatRows().filter(r => (!f.q || [voName(r.vendorCode), r.vpo, r.sku, r.item, r.orders.map(x => x.orderNo + ' ' + (x.ref || '')).join(' ')].join(' ').toLowerCase().includes(f.q))
    && (!f.src || r.orders.some(x => ordSrcOf(x.orderNo) === f.src)));
  /* The tiles: pieces still with printers, per platform. */
  const tot = new Map();
  all.forEach(r => r.plats.forEach((q, p) => { const t = tot.get(p) || { given: 0, bal: 0 }; t.given += q; t.bal += r.given ? r.bal * (q / r.given) : 0; tot.set(p, t); }));
  const plats = [...tot.entries()].sort((a, b) => b[1].bal - a[1].bal);
  const pick = /^pl\d+$/.test(ORD_KPI) ? plats[+ORD_KPI.slice(2)] : null;
  const rows = pick ? all.filter(r => r.plats.has(pick[0])) : all;
  ORD.rows = rows;
  $('odKpis').innerHTML = '<div class="jw-kpiname">Printers — which platform each order is for · pieces still with the printer</div><div class="jw-kpis">'
    + plats.map(([p, t], i) => ordKpiCard(nf(Math.round(t.bal)), p, p === ORD_PLAT_STOCK ? 'box' : 'doc', p === ORD_PLAT_STOCK ? 'amber' : 'blue',
      nf(Math.round(t.given)) + ' given in all', { key: 'pl' + i, tip: 'Show only printer lines for ' + p + '. Click again for all.' })).join('')
    + '</div>';
  const head = ordHead([['Printer', ''], ['Printer order', ''], ['Placed', ''], ['Item', ''], ['Customer orders', ''], ['Platform', ''], ['Given', 'num'], ['Back', 'num'], ['With printer', 'num']]);
  const body = rows.slice(0, ORD_CAP).map(r => '<tr>'
    + `<td class="frz" style="text-align:left;font-weight:700">${esc(voName(r.vendorCode))}</td>`
    + `<td style="text-align:left">${esc(r.vpo)}<div class="muted" style="font-size:11px">${esc(r.via)}</div></td>`
    + `<td>${esc(ptIsoDate(r.date) || '')}</td>`
    + `<td style="text-align:left">${r.sku ? `<span style="font-family:ui-monospace,monospace;font-size:12px">${esc(r.sku)}</span><div class="muted" style="font-size:11px">${esc(r.item)}</div>` : esc(r.item)}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:240px">${r.orders.length ? r.orders.map(x => `<a href="#" data-ordj="${esc(x.orderNo)}" title="This order, start to finish">${esc(x.ref || x.orderNo)}</a><span class="muted">×${nf(x.qty)}</span>`).join(' ') : '<span class="muted">—</span>'}</td>`
    + `<td style="text-align:left;white-space:normal">${[...r.plats.entries()].map(([p, q]) => `<span class="jw-st ${p === ORD_PLAT_STOCK ? 'pend' : 'prog'}">${esc(p)}${r.plats.size > 1 ? ' ' + nf(q) : ''}</span>`).join(' ')}</td>`
    + `<td class="num">${nf(r.given)} <span class="muted" style="font-size:10px">${r.unit}</span></td><td class="num">${r.back ? nf(r.back) : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${r.bal > 0 ? `<b style="color:var(--bad)">${nf(r.bal)}</b>` : '<span class="jw-st done">done</span>'}</td></tr>`).join('');
  $('odTable').innerHTML = head + '<tbody>' + (body || '<tr><td colspan="9" class="muted" style="padding:14px;text-align:left">No printing lines match.</td></tr>') + '</tbody>';
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(rows.length)} printer line(s)` + (pick ? ` · only ${pick[0]} — click the tile again for all` : '')
    + (rows.length > ORD_CAP ? ` · showing ${nf(ORD_CAP)}` : '') + ' · Source and the search box narrow it · click a customer order for its whole journey';
  ordMoreBtn(rows.length);
}

