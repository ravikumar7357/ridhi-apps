/* ================= THE WEEKLY PRODUCTION MEETING (Reports → Production meeting) =================
 *
 * Ravi, 2026-10-07: "these are my production meeting point jo ki mujhe share krne h isme se kitna kam automate kar sakte
 * h" — then "reports ke andar banao, freight sheet upload karenge with order number and shopify order hamare portal me
 * aate h unko ham pahchan sakte h". His sheet, in his order:
 *   1 Production report (deep)          2 People — vacancy, challenges, initiatives
 *   3 Open orders — sea production, fabric, printing alignment
 *   4 D2C orders (delivery within a week) 5 Supply chain
 *   6 Last week's shipments — Sea / Air / Shop / LC Air, air freight break-up (freight from an uploaded sheet)
 *   7 Shopify pre-order (Sea) — the SPY- stock orders raised in this portal
 *   8 Shopify / Etsy — shipped within a week, FedEx / DHL
 * One week, Sunday to Saturday like every other weekly report. Every figure is worked out from the registers each time;
 * only what a person writes is stored: notes and action points (pt_meeting/<week>), the freight sheet (pt_freight) and a
 * frozen summary of the figures as they stood in the meeting.
 */
let MTG = { busy: false, err: [], at: '', meet: null, freight: null, shop: null, shopBusy: false };

/** Everything the meeting reads, at once. One register that cannot be read blanks its section and is named. */
async function mtgLoad(force) {
  if (MTG.busy) return;
  MTG.busy = true; MTG.err = [];
  if (force) { MTG.meet = null; MTG.freight = null; MTG.shop = null; }
  const take = async (name, f) => { try { await f(); } catch (e) { MTG.err.push(name + ': ' + (e.message || e)); } };
  await Promise.all([
    take('order book', () => ptLoadGates()),
    take('vendor orders and fabric', () => ordDemandLoad()),
    take('finished goods', async () => { if (FGI.rows == null) await fgiLoad(); }),
    take('sales orders', async () => { if (SOX.rows == null) SOX.rows = ptList(await ptGet('pt_salesOrders')); }),
    take('accessories', async () => { await ptLoadGates(); if (ACC.ledger == null) { ACC.items = ptList((PTG.masters || {}).accessories); ACC.ledger = ptList(await ptGet('pt_accLedger')); } }),
    take('greige POs', () => ensureGpo()),
    take('contractor headcount', async () => { if (REP_HEADS === null) REP_HEADS = (await ptGet('pt_contractorHeads')) || {}; }),
    take('meeting notes', async () => { if (MTG.meet == null) MTG.meet = (await ptGet('pt_meeting')) || {}; }),
    take('freight sheet', async () => { if (MTG.freight == null) MTG.freight = ptList(await ptGet('pt_freight')); }),
    take('Shopify notes', async () => { if (typeof loadShopMeta === 'function') await loadShopMeta(); }),
    take('imported orders', async () => { if (typeof loadShopImported === 'function') await loadShopImported(); }),
  ]);
  MTG.busy = false; MTG.at = ptStamp();
}
/** The two Shopify stores' orders around the week — the slow read, done after the rest is on screen. */
async function mtgShopLoad(wk) {
  if (MTG.shopBusy || (MTG.shop && MTG.shop.wk === wk)) return;
  MTG.shopBusy = true;
  const from = mtgMs(wk), iso = ms => repWkIso(new Date(ms));
  try {
    const r = await repShopFetch({ start: iso(from - 35 * 864e5), end: iso(from + 6 * 864e5), open: '0' });
    MTG.shop = { wk, orders: r.orders || [], errs: r.errs || [], more: !!r.more };
  } catch (e) { MTG.shop = { wk, orders: [], errs: [e.message || String(e)], more: false }; }
  MTG.shopBusy = false;
  if ($('repView').value === 'mtg' && ($('repWk') || {}).value === wk) renderRep();
}

const mtgMs = wk => { const p = String(wk).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); };
/** DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD or an ISO stamp → ms at local midnight-ish; 0 when unreadable. */
function mtgDayMs(s) {
  const t = String(s || '').trim(); if (!t) return 0;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/); if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1], 12).getTime();
  return ptDtMs(t) || 0;
}
const mtgIn = (ms, from) => ms >= from && ms < from + 7 * 864e5;
/** Any date shape → YYYY-MM-DD, or '' — so dates from different registers compare as text. */
const mtgIso = s => { const ms = mtgDayMs(s); return ms ? repWkIso(new Date(ms)) : ''; };
/* The Shopify notes, where this part of the page has them (the Shopify block is not always joined in). */
const mtgMeta = () => (typeof SHOP_META !== 'undefined' && SHOP_META) || {};
const MTG_CHANNEL = { AMZ: 'Amazon (sea)', SPY: 'Shopify stock / pre-order (sea)', SHP: 'Shopify D2C', ONL: 'Online D2C', B: 'B2B' };
const mtgChan = no => { const p = String(no || '').split('-')[0].toUpperCase(); return /^B\d*$/.test(p) ? 'B' : p; };

/* ---------- the eight sections: each returns { html, text } — the text is what the WhatsApp summary says ---------- */
function mtgProduction(wk, brand) {
  const from = mtgMs(wk);
  const Q = repQcByWindow(brand, from, from + 7 * 864e5), Qp = repQcByWindow(brand, from - 7 * 864e5, from);
  const made = repByWindow(brand, false, from, from + 7 * 864e5), madeTot = Object.values(made).reduce((t, a) => t + a.prod, 0);
  const tgt = repTarget(), pc = (v, b) => (b > 0 ? Math.round(v / b * 100) + '%' : '—');
  const arts = [...new Set(Object.keys(made).concat(Object.keys(Q.byArt), Object.keys(Qp.byArt)))]
    .map(a => ({ a, made: (made[a] || {}).prod || 0, qc: Q.byArt[a] || 0, prev: Qp.byArt[a] || 0 })).filter(x => x.made || x.qc || x.prev)
    .sort((x, y) => y.qc - x.qc || y.made - x.made);
  const kar = new Map();
  repQcRows().forEach(r => { if (!r || !r.karigar || qaApart(r) || !mtgIn(ptDtMs(r.date), from) || (brand && repBrand(r.sku) !== brand)) return;
    kar.set(r.karigar, (kar.get(r.karigar) || 0) + ptNum(r.ok)); });
  const wasChecks = QC.checks; if (!wasChecks) QC.checks = PTG.qc || [];
  let waiting = 0; try { waiting = qcInboxRows().reduce((t, x) => t + x.wait, 0); } catch (e) { /* QC not readable */ }
  QC.checks = wasChecks;
  const d = Q.ok - Qp.ok;
  const html = mtgMetrics([
    ['QC passed — production', nf(Q.ok), '#166534', `${d >= 0 ? '▲' : '▼'} ${nf(Math.abs(d))} vs last week (${nf(Qp.ok)})`],
    ['Of the ' + nf(tgt) + ' target', pc(Q.ok, tgt), Q.ok >= tgt ? '#166534' : 'var(--bad)', nf(Math.max(0, tgt - Q.ok)) + ' short'],
    ['Made (received from karigars)', nf(Math.round(madeTot)), '', 'passed ' + pc(Q.ok, madeTot) + ' of made'],
    ['Rejected · alteration', nf(Q.rej) + ' · ' + nf(Q.alt), 'var(--bad)', pc(Q.rej + Q.alt, Q.chk) + ' of ' + nf(Q.chk) + ' checked'],
    ['Waiting for QC now', nf(waiting), '#B45309', 'back from karigars, not checked'],
    ['Kept apart (QC passed)', nf(Q.apart['Pillow insert'] + Q.apart['Embroidery napkin']), '#B45309', `pillow insert ${nf(Q.apart['Pillow insert'])} · embroidery napkin ${nf(Q.apart['Embroidery napkin'])}`],
  ]) + '<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px;margin-top:8px">'
    + mtgTable(['Article', 'Made', 'QC passed', 'Last week QC', 'Change'], arts.map(x => [x.a, nf(Math.round(x.made)), `<b>${nf(x.qc)}</b>`, nf(x.prev), mtgDelta(x.qc - x.prev)]))
    + mtgTable(['Karigar (QC passed)', 'Pcs'], [...kar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [esc(k), nf(v)]),
      'only pieces taken from Waiting for QC carry the karigar') + '</div>'
    + repManpowerCard(wk, brand);
  return { html, text: `1) Production (QC passed): ${nf(Q.ok)} pcs (${d >= 0 ? '+' : '−'}${nf(Math.abs(d))} vs last week) · ${pc(Q.ok, tgt)} of ${nf(tgt)} · made ${nf(Math.round(madeTot))} · rejected ${nf(Q.rej)}, alteration ${nf(Q.alt)} · waiting for QC ${nf(waiting)}`,
    csv: [['Production', 'QC passed', Q.ok], ['Production', 'QC passed last week', Qp.ok], ['Production', 'Made', Math.round(madeTot)], ['Production', 'Rejected', Q.rej], ['Production', 'For alteration', Q.alt], ['Production', 'Waiting for QC', waiting]]
      .concat(arts.map(x => ['Production by article', x.a, x.qc, Math.round(x.made), x.prev])) };
}

function mtgPeople(wk, brand) {
  const g = repGap(wk, brand), gp = repGap(repWkShift(wk, -1), brand), m = repManpower(wk, brand);
  const T = g.perDay, conPcs = m.contractors.reduce((t, c) => t + c.pcs, 0), tgt = repTarget();
  const ours = Math.max(0, tgt - conPcs), need = g.days ? Math.ceil(ours / (T * g.days)) : 0;
  const vacancy = Math.max(0, need - Math.ceil(g.perDayPeople || 0));
  const html = mtgMetrics([
    ['Karigars who worked', nf(g.karigars), '', `${nf(gp.karigars)} the week before`],
    ['People a day, average', g.days ? String(Math.round(g.perDayPeople * 10) / 10) : '—', '', nf(g.days) + ' working day(s)'],
    ['One person a day', g.personDays ? nf(Math.round(g.perPersonDay)) : '—', g.perPersonDay >= T ? '#166534' : 'var(--bad)', 'aim ' + nf(T)],
    ['Needed a day for ' + nf(tgt), nf(need), '', 'Pradeep kept at ' + nf(conPcs)],
    ['Vacancy — more people a day', nf(vacancy), vacancy ? 'var(--bad)' : '#166534', vacancy ? 'to reach the target at ' + nf(T) + ' a day each' : 'enough people'],
    ['Pradeep', nf(conPcs) + ' pcs', '#7C3AED', m.contractors[0] && m.contractors[0].heads ? nf(m.contractors[0].heads) + ' attendance in the week' : 'attendance not entered'],
  ]);
  return { html, text: `2) People: ${nf(g.karigars)} karigars worked, ${g.days ? Math.round(g.perDayPeople * 10) / 10 : '—'} a day, ${g.personDays ? nf(Math.round(g.perPersonDay)) : '—'} pcs a person a day · vacancy ${nf(vacancy)} a day for ${nf(tgt)}`,
    csv: [['People', 'Karigars worked', g.karigars], ['People', 'People a day', Math.round(g.perDayPeople * 10) / 10], ['People', 'One person a day', Math.round(g.perPersonDay || 0)], ['People', 'Needed a day', need], ['People', 'Vacancy a day', vacancy]],
    notes: [['challenges', 'Employee challenges'], ['initiatives', 'Initiatives']] };
}

function mtgOpenOrders() {
  const today = repWkIso(new Date()), dueIx = SOX.rows ? ordDueIndex() : new Map();
  const by = new Map();
  ordLines().filter(l => l.open).forEach(l => {
    const c = mtgChan(l.orderNo), e = by.get(c) || { c, orders: new Set(), lines: 0, qty: 0, made: 0, left: 0, late: 0, lateOrders: new Set() };
    const due = l.mto ? l.mtoDue : (dueIx.get(l.orderNo + '|' + l.sku) || '');
    e.orders.add(l.orderNo); e.lines++; e.qty += l.qty; e.made += Math.min(l.qty, l.pressed || 0); e.left += l.pendingMake;
    if (due && due < today && l.pendingMake > 0) { e.late += l.pendingMake; e.lateOrders.add(l.orderNo); }
    by.set(c, e);
  });
  const chans = [...by.values()].sort((a, b) => b.left - a.left);
  /* The Order Console's own filters must not narrow the meeting — they are cleared for the one call and put back. */
  const ids = ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odSrc', 'odBrand', 'odQ', 'odD1', 'odD2'];
  const kept = ids.map(i => ($(i) || {}).value); ids.forEach(i => { if ($(i)) $(i).value = ''; });
  let dem = null; try { dem = ordDemandRows(); } catch (e) { dem = null; }
  ids.forEach((i, k) => { if ($(i)) $(i).value = kept[k]; });
  const fab = dem ? (dem.rows || []).filter(r => r.need || r.cutPcs).sort((a, b) => (b.short || 0) - (a.short || 0) || b.need - a.need).slice(0, 12) : [];
  const prn = new Map();
  (VO.rows || []).forEach(o => { if (!o || o.status === 'Cancelled' || o.status === 'Draft') return;
    voLines(o).forEach(l => { if (!l || l.cancelled) return; const owed = voQty(o, l) - (parseFloat(voDone(l)) || 0); if (!(owed > 0)) return;
      const e = prn.get(o.vendorCode) || { v: o.vendorCode, cut: 0, run: 0, late: 0 };
      if (voKind(l) === 'running' || o.orderType === 'running') e.run += owed; else e.cut += owed;
      if ((voLateBy(o, l) || 0) > 0) e.late++;
      prn.set(o.vendorCode, e); }); });
  const r0 = v => nf(Math.round(v || 0));
  const html = mtgTable(['Channel', 'Orders', 'Ordered pcs', 'Made (QC)', 'Still to make', 'Late pcs (past due)'], chans.map(e =>
      [`<b>${esc(MTG_CHANNEL[e.c] || e.c)}</b>`, nf(e.orders.size), nf(e.qty), nf(e.made), `<b>${nf(e.left)}</b>`, e.late ? `<span style="color:var(--bad)">${nf(e.late)} · ${nf(e.lateOrders.size)} order(s)</span>` : '—']))
    + '<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:10px;margin-top:8px">'
    + mtgTable(['Fabric — to print', 'Cloth needed m', 'At printers m', 'To give m', 'Cut pcs to give', 'RFD in stock m', 'RFD short m'], fab.map(r =>
      [esc(r.fabric), r0(r.need), r0(r.atM), r0(r.give), r0(r.cutGive), r.have == null ? '—' : r0(r.have), r.short ? `<b style="color:var(--bad)">${r0(r.short)}</b>` : '0']),
      dem ? 'all open orders · metres include the cloth of cut pieces' : 'fabric or vendor orders could not be read')
    + mtgTable(['Printer', 'Cut pcs owed', 'Running m owed', 'Late lines'], [...prn.values()].sort((a, b) => b.cut + b.run - a.cut - a.run).slice(0, 12)
      .map(e => [esc(voName(e.v)), r0(e.cut), r0(e.run), e.late ? `<span style="color:var(--bad)">${nf(e.late)}</span>` : '—'])) + '</div>';
  const sea = ['AMZ', 'SPY'].map(c => by.get(c)).filter(Boolean);
  return { html, text: `3) Open orders: ${chans.map(e => (MTG_CHANNEL[e.c] || e.c) + ' ' + nf(e.left) + ' to make' + (e.late ? ' (' + nf(e.late) + ' late)' : '')).join(' · ')} · sea production ${nf(sea.reduce((t, e) => t + e.left, 0))} pcs · RFD short ${fab.filter(r => r.short).map(r => r.fabric + ' ' + r0(r.short) + ' m').slice(0, 3).join(', ') || 'none'}`,
    csv: chans.map(e => ['Open orders', MTG_CHANNEL[e.c] || e.c, e.left, e.qty, e.late]).concat(fab.map(r => ['Fabric', r.fabric, Math.round(r.give || 0), Math.round(r.have || 0), Math.round(r.short || 0)])) };
}

function mtgD2c(wk) {
  const from = mtgMs(wk), today = repWkIso(new Date()), in7 = repWkIso(new Date(Date.now() + 7 * 864e5));
  const all = ordLines().filter(l => l.mto), open = all.filter(l => l.open);
  const orders = new Map();
  open.forEach(l => { const e = orders.get(l.orderNo) || { no: l.orderNo, shop: l.shopOrderNo || '', due: l.mtoDue, late: 0, left: 0, at: '' };
    e.left += l.pendingMake; e.late = Math.max(e.late, l.mtoLate || 0); if (!e.at) { try { e.at = ordWaitingAt(l); } catch (er) { e.at = ''; } } orders.set(l.orderNo, e); });
  const list = [...orders.values()], late = list.filter(e => e.late > 0), dueSoon = list.filter(e => !e.late && e.due && e.due <= in7);
  const stage = new Map(); list.forEach(e => { const s = String(e.at || '—').split(' —')[0]; stage.set(s, (stage.get(s) || 0) + 1); });
  const handed = all.filter(l => l.handedAt && mtgIn(Date.parse(l.handedAt), from)).reduce((t, l) => t + l.qty, 0);
  const html = mtgMetrics([
    ['Open D2C orders', nf(list.length), '', nf(list.reduce((t, e) => t + e.left, 0)) + ' pcs still to make'],
    ['Late (past 5 working days)', nf(late.length), late.length ? 'var(--bad)' : '#166534', 'orders'],
    ['Due in the next 7 days', nf(dueSoon.length), '#B45309', 'orders'],
    ['Handed to shipping in the week', nf(handed), '#166534', 'pcs'],
  ]) + '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:10px;margin-top:8px">'
    + mtgTable(['Waiting at', 'Orders'], [...stage.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [esc(k), nf(v)]))
    + mtgTable(['Late order', 'Shopify', 'Due', 'Days late', 'Waiting at'], late.sort((a, b) => b.late - a.late).slice(0, 15)
      .map(e => [esc(e.no), esc(e.shop), esc(e.due), `<b style="color:var(--bad)">${nf(e.late)}</b>`, esc(e.at)])) + '</div>';
  return { html, text: `4) D2C (5 working days): ${nf(list.length)} open · ${nf(late.length)} late · ${nf(dueSoon.length)} due in 7 days · ${nf(handed)} pcs handed to shipping`,
    csv: [['D2C', 'Open orders', list.length], ['D2C', 'Late orders', late.length], ['D2C', 'Due in 7 days', dueSoon.length], ['D2C', 'Handed pcs', handed]].concat(late.map(e => ['D2C late', e.no, e.shop, e.due, e.late])) };
}

function mtgSupply() {
  const today = repWkIso(new Date()), in7 = repWkIso(new Date(Date.now() + 7 * 864e5));
  const prn = new Map(); let lateLines = 0, dueWeek = 0, unprom = 0;
  (VO.rows || []).forEach(o => { if (!o || o.status === 'Cancelled' || o.status === 'Draft') return;
    voLines(o).forEach(l => { if (!l || l.cancelled) return; const owed = voQty(o, l) - (parseFloat(voDone(l)) || 0); if (!(owed > 0)) return;
      const lt = voLateBy(o, l) || 0, due = mtgIso(voDue(l));        // vendor dates are DD-MM-YYYY
      const e = prn.get(o.vendorCode) || { v: o.vendorCode, late: 0, lateQty: 0, week: 0, oldest: '' };
      if (lt > 0) { e.late++; e.lateQty += owed; lateLines++; if (!e.oldest || due < e.oldest) e.oldest = due; }
      if (due && due >= today && due <= in7) { e.week++; dueWeek++; }
      if (!voProm(l)) unprom++;
      prn.set(o.vendorCode, e); }); });
  const gpo = (GPO.rows || []).filter(p => p && ['open', 'sent', 'part'].includes(gpoStatus(p))).map(p => {
    const g = gpoProgress(p), due = mtgIso(p.deliveryDate); return { no: p.poNo, mill: (p.mill || {}).name || '', pend: g.pending, due, late: !!due && due < today };
  }).filter(p => p.pend > 0);
  let low = []; try { low = accBalances().filter(b => !b.orphan && b.qty <= accLow(b)); } catch (e) { low = []; }
  const html = mtgMetrics([
    ['Printer lines late', nf(lateLines), lateLines ? 'var(--bad)' : '#166534', 'past their promised date'],
    ['Printer lines due in 7 days', nf(dueWeek), '#B45309', nf(unprom) + ' line(s) with no promise yet'],
    ['Greige POs open', nf(gpo.length), '', nf(Math.round(gpo.reduce((t, p) => t + p.pend, 0))) + ' m to come · ' + nf(gpo.filter(p => p.late).length) + ' late'],
    ['Accessories at / under re-order', nf(low.length), low.length ? 'var(--bad)' : '#166534', 'items'],
  ]) + '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px">'
    + mtgTable(['Printer', 'Late lines', 'Late qty', 'Oldest due', 'Due in 7 days'], [...prn.values()].filter(e => e.late || e.week).sort((a, b) => b.lateQty - a.lateQty)
      .map(e => [esc(voName(e.v)), e.late ? `<b style="color:var(--bad)">${nf(e.late)}</b>` : '—', nf(Math.round(e.lateQty)), esc(e.oldest || '—'), nf(e.week)]))
    + mtgTable(['Greige PO', 'Mill', 'Metres to come', 'Due'], gpo.sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 12)
      .map(p => [esc(p.no), esc(p.mill), nf(Math.round(p.pend)), p.late ? `<b style="color:var(--bad)">${esc(p.due)}</b>` : esc(p.due || '—')]))
    + mtgTable(['Accessory low', 'In stock', 'Re-order at'], low.sort((a, b) => a.qty - b.qty).slice(0, 12).map(b => [esc(b.name || b.code), nf(Math.round(b.qty)), nf(accLow(b))])) + '</div>';
  return { html, text: `5) Supply chain: ${nf(lateLines)} printer lines late · ${nf(dueWeek)} due in 7 days · ${nf(gpo.length)} greige POs open (${nf(gpo.filter(p => p.late).length)} late) · ${nf(low.length)} accessories low`,
    csv: [...prn.values()].map(e => ['Printer', voName(e.v), e.late, Math.round(e.lateQty), e.week]).concat(gpo.map(p => ['Greige PO', p.no, p.mill, Math.round(p.pend), p.due]), low.map(b => ['Accessory low', b.name || b.code, Math.round(b.qty), accLow(b)])) };
}

/* ---------- the freight sheet (Ravi: "freight sheet upload karenge with order number") ---------- */
const MTG_FREIGHT_COLS = ['Date', 'Order / Shipment No', 'Mode', 'Carrier', 'Cartons', 'Weight kg', 'Pieces', 'Freight', 'Currency', 'Notes'];
const MTG_MODES = ['Sea', 'Air', 'Shop', 'LC Air'];
const mtgMode = v => { const s = String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return s === 'lc air' || s === 'lcair' || s === 'lc' ? 'LC Air' : s === 'sea' ? 'Sea' : s === 'air' ? 'Air' : s === 'shop' || s === 'shopify' ? 'Shop' : ''; };
function mtgFreightPlan(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const ix = { d: at(['date']), no: at(['order / shipment no', 'order no', 'order number', 'shipment no', 'shipment', 'order']), mode: at(['mode']),
    car: at(['carrier']), ctn: at(['cartons', 'boxes']), kg: at(['weight kg', 'weight', 'kg']), pcs: at(['pieces', 'pcs', 'qty']),
    amt: at(['freight', 'amount', 'freight amount']), cur: at(['currency']), note: at(['notes', 'note', 'remarks']) };
  if (ix.d < 0 || ix.no < 0 || ix.mode < 0 || ix.amt < 0) return { err: 'The sheet needs Date, Order / Shipment No, Mode and Freight columns. Download the template to see them.' };
  const out = [], bad = [];
  for (let i = 1; i < rows.length; i++) {
    const c = j => (j >= 0 && rows[i][j] != null ? String(rows[i][j]).trim() : '');
    if (!c(ix.no) && !c(ix.amt)) continue;
    const ms = mtgDayMs(c(ix.d)), mode = mtgMode(c(ix.mode)), amt = parseFloat(c(ix.amt).replace(/[, ]/g, ''));
    if (!ms) { bad.push(`row ${i + 1}: the date "${c(ix.d)}" cannot be read (DD-MM-YYYY)`); continue; }
    if (!c(ix.no)) { bad.push(`row ${i + 1}: no order / shipment number`); continue; }
    if (!mode) { bad.push(`row ${i + 1}: mode must be Sea, Air, Shop or LC Air, not "${c(ix.mode)}"`); continue; }
    if (!(amt >= 0)) { bad.push(`row ${i + 1}: the freight "${c(ix.amt)}" is not a number`); continue; }
    const date = repWkIso(new Date(ms)), no = c(ix.no);
    out.push({ id: 'fr_' + (date + '_' + no).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 80), date, no, mode, carrier: c(ix.car),
      cartons: parseFloat(c(ix.ctn)) || 0, kg: parseFloat(c(ix.kg)) || 0, pcs: parseFloat(c(ix.pcs)) || 0, amount: amt,
      cur: (c(ix.cur) || 'INR').toUpperCase(), notes: c(ix.note) });
  }
  return { rows: out, bad };
}
async function mtgFreightSave(rows) {
  if (!(ME.admin || ptCanEdit())) return 'Only somebody who can edit production data can upload the freight sheet.';
  const p = mtgFreightPlan(rows);
  if (p.err) return p.err;
  if (p.bad.length) return 'Nothing was saved. ' + p.bad.slice(0, 6).join(' · ') + (p.bad.length > 6 ? ` …and ${nf(p.bad.length - 6)} more` : '');
  if (!p.rows.length) return 'The sheet has no freight rows.';
  const patch = {}; const now = new Date().toISOString();
  p.rows.forEach(r => { patch['pt_freight/' + r.id] = Object.assign({}, r, { by: ME.email, at: now }); });   // the same date + number again replaces it
  await ptPatch(patch);
  const keep = new Map((MTG.freight || []).map(r => [r.id, r])); p.rows.forEach(r => keep.set(r.id, Object.assign({}, r, { by: ME.email, at: now })));
  MTG.freight = [...keep.values()];
  return '';
}
function mtgShipments(wk) {
  const from = mtgMs(wk);
  const ships = new Map();
  (FGI.rows ? fbaAll() : []).forEach(r => { const ms = mtgDayMs(r.fbaShipDate); if (!r.fbaShipment || !mtgIn(ms, from)) return;
    const e = ships.get(r.fbaShipment) || { no: r.fbaShipment, acct: r.issuedFor || '', date: r.fbaShipDate, pcs: 0 }; e.pcs += fbaState(r).qty; ships.set(r.fbaShipment, e); });
  const fr = (MTG.freight || []).filter(r => mtgIn(mtgDayMs(r.date), from));
  const pcsOf = r => r.pcs || (ships.get(r.no) || {}).pcs || 0;
  const modes = MTG_MODES.map(m => { const rs = fr.filter(r => r.mode === m);
    const amt = rs.reduce((t, r) => t + r.amount, 0), kg = rs.reduce((t, r) => t + r.kg, 0), pcs = rs.reduce((t, r) => t + pcsOf(r), 0);
    return { m, n: rs.length, amt, kg, pcs, cur: [...new Set(rs.map(r => r.cur))].join('/') || 'INR' }; });
  const money = (v, c) => (c === 'USD' ? '$' : '₹') + nf(Math.round(v));
  const air = modes.filter(x => /Air/.test(x.m));
  const html = mtgMetrics(modes.map(x => [x.m + ' shipments', nf(x.n), '', x.n ? `${money(x.amt, x.cur)} · ${nf(Math.round(x.kg))} kg${x.kg ? ' · ' + money(x.amt / x.kg, x.cur) + '/kg' : ''}${x.pcs ? ' · ' + money(x.amt / x.pcs, x.cur) + '/pc' : ''}` : 'none in the sheet']))
    + '<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:10px;margin-top:8px">'
    + mtgTable(['Freight sheet — date', 'Order / shipment', 'Mode', 'Carrier', 'Kg', 'Pcs', 'Freight', 'Per kg'], fr.sort((a, b) => a.date.localeCompare(b.date)).map(r =>
      [esc(r.date.split('-').reverse().join('/')), esc(r.no), esc(r.mode), esc(r.carrier), nf(Math.round(r.kg)), pcsOf(r) ? nf(pcsOf(r)) : '—', money(r.amount, r.cur), r.kg ? money(r.amount / r.kg, r.cur) : '—']),
      'upload the sheet with the buttons above · the same date and number uploaded again replaces the row')
    + mtgTable(['FBA shipment (Finished Goods)', 'Account', 'Shipped', 'Pcs', 'Freight in sheet'], [...ships.values()].map(s =>
      [esc(s.no), esc(s.acct), esc(s.date), nf(s.pcs), fr.some(r => r.no === s.no) ? '✓' : '<span class="muted">not yet</span>'])) + '</div>';
  return { html, text: `6) Shipments: ${modes.map(x => x.m + ' ' + nf(x.n) + (x.n ? ' (' + money(x.amt, x.cur) + ')' : '')).join(' · ')} · air freight ${money(air.reduce((t, x) => t + x.amt, 0), 'INR')} for ${nf(Math.round(air.reduce((t, x) => t + x.kg, 0)))} kg · FBA ${nf(ships.size)} shipment(s), ${nf([...ships.values()].reduce((t, s) => t + s.pcs, 0))} pcs`,
    csv: fr.map(r => ['Freight', r.date, r.no, r.mode, r.carrier, r.kg, pcsOf(r), r.amount, r.cur]).concat([...ships.values()].map(s => ['FBA shipment', s.no, s.acct, s.date, s.pcs])) };
}

function mtgPreOrder() {
  const today = repWkIso(new Date()), dueIx = SOX.rows ? ordDueIndex() : new Map();
  const by = new Map();
  ordLines().filter(l => /^SPY-/.test(l.orderNo)).forEach(l => {
    const e = by.get(l.orderNo) || { no: l.orderNo, date: l.orderDate || '', due: '', qty: 0, made: 0, left: 0, open: false };
    const d = dueIx.get(l.orderNo + '|' + l.sku) || ''; if (d && (!e.due || d < e.due)) e.due = d;
    e.qty += l.qty; e.made += Math.min(l.qty, l.pressed || 0); e.left += l.pendingMake; e.open = e.open || l.open; by.set(l.orderNo, e); });
  const list = [...by.values()].filter(e => e.open).sort((a, b) => String(a.due || a.date).localeCompare(String(b.due || b.date)));
  const html = mtgMetrics([
    ['Open pre-orders (SPY)', nf(list.length), '', nf(list.reduce((t, e) => t + e.qty, 0)) + ' pcs ordered'],
    ['Made (QC passed)', nf(list.reduce((t, e) => t + e.made, 0)), '#166534', 'pcs'],
    ['Still to make', nf(list.reduce((t, e) => t + e.left, 0)), '#B45309', 'pcs'],
    ['Past due', nf(list.filter(e => e.due && e.due < today).length), 'var(--bad)', 'orders'],
  ]) + mtgTable(['Order', 'Ordered on', 'Due', 'Pcs', 'Made', 'To make', 'Done'], list.map(e =>
    [esc(e.no), esc(e.date), e.due && e.due < today ? `<b style="color:var(--bad)">${esc(e.due)}</b>` : esc(e.due || '—'), nf(e.qty), nf(e.made), `<b>${nf(e.left)}</b>`, (e.qty ? Math.round(e.made / e.qty * 100) : 0) + '%']),
    'Shopify stock orders raised in this portal as SPY- — they go to the US by sea');
  return { html, text: `7) Shopify pre-order (sea): ${nf(list.length)} open SPY order(s) · ${nf(list.reduce((t, e) => t + e.made, 0))} made of ${nf(list.reduce((t, e) => t + e.qty, 0))} · ${nf(list.reduce((t, e) => t + e.left, 0))} to make`,
    csv: list.map(e => ['Pre-order', e.no, e.due, e.qty, e.made, e.left]) };
}

function mtgShopShipped(wk) {
  const from = mtgMs(wk);
  if (!MTG.shop || MTG.shop.wk !== wk) {
    return { html: `<div class="muted" style="padding:8px">${MTG.shopBusy ? 'Reading both Shopify stores…' : 'Shopify not read yet.'}</div>`, text: '8) Shopify / Etsy: not read yet', csv: [] };
  }
  const days = (a, b) => Math.round((mtgDayMs(b) - mtgDayMs(a)) / 864e5);
  const shipped = MTG.shop.orders.filter(o => o && !o.cancelledAt && o.shippedAt && mtgIn(mtgDayMs(o.shippedAt), from))
    .map(o => ({ o, d: days(o.at, o.shippedAt), via: repShipVia(o, mtgMeta()[o.id] || {}) }));
  const in7 = shipped.filter(s => s.d <= 7), late = shipped.filter(s => s.d > 7).sort((a, b) => b.d - a.d);
  const carriers = new Map(); shipped.forEach(s => { const e = carriers.get(s.via) || { SP: 0, CPC: 0 }; e[s.o.shopBrand] = (e[s.o.shopBrand] || 0) + 1; carriers.set(s.via, e); });
  const nowMs = Date.now(), stuck = MTG.shop.orders.filter(o => o && !o.cancelledAt && !o.shippedAt && o.ff !== 'fulfilled' && nowMs - mtgDayMs(o.at) > 7 * 864e5);
  const imp = (typeof SHOP_IMP !== 'undefined' ? SHOP_IMP : []).filter(o => o && !o.cancelledAt && !(mtgMeta()[o.id] || {}).mcfId && nowMs - mtgDayMs(o.at) > 7 * 864e5 && nowMs - mtgDayMs(o.at) < 60 * 864e5);
  const impBy = new Map(); imp.forEach(o => impBy.set(o.channel || 'Imported', (impBy.get(o.channel || 'Imported') || 0) + 1));
  const html = mtgMetrics([
    ['Shopify orders shipped in the week', nf(shipped.length), '', `Ridhi ${nf(shipped.filter(s => s.o.shopBrand === 'SP').length)} · CPC ${nf(shipped.filter(s => s.o.shopBrand === 'CPC').length)}`],
    ['Shipped within 7 days', shipped.length ? Math.round(in7.length / shipped.length * 100) + '%' : '—', in7.length === shipped.length ? '#166534' : '#B45309', `${nf(in7.length)} of ${nf(shipped.length)}`],
    ['Shipped after 7 days', nf(late.length), late.length ? 'var(--bad)' : '#166534', 'orders'],
    ['Older than 7 days, not shipped', nf(stuck.length), stuck.length ? 'var(--bad)' : '#166534', 'Shopify, both stores, now'],
  ]) + '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px">'
    + mtgTable(['Shipped via', 'Ridhi', 'CPC'], [...carriers.entries()].sort((a, b) => (b[1].SP + b[1].CPC) - (a[1].SP + a[1].CPC)).map(([k, v]) => [esc(k), nf(v.SP || 0), nf(v.CPC || 0)]))
    + mtgTable(['Shipped late', 'Store', 'Ordered', 'Days'], late.slice(0, 15).map(s => [esc(s.o.no), s.o.shopBrand === 'CPC' ? 'CPC' : 'Ridhi', esc(String(s.o.at).slice(0, 10)), `<b style="color:var(--bad)">${nf(s.d)}</b>`]))
    + mtgTable(['Etsy / imported, open > 7 days', 'Orders'], [...impBy.entries()].map(([k, v]) => [esc(k), nf(v)]), 'imported orders carry no ship date — open means not sent by MCF') + '</div>'
    + (MTG.shop.errs.length ? `<div class="err" style="margin-top:6px">${esc(MTG.shop.errs.join(' · '))}</div>` : '');
  return { html, text: `8) Shopify shipped: ${nf(shipped.length)} in the week · ${shipped.length ? Math.round(in7.length / shipped.length * 100) : 0}% within 7 days · ${nf(late.length)} late · ${nf(stuck.length)} older than 7 days not shipped · ${[...carriers.entries()].map(([k, v]) => k + ' ' + nf((v.SP || 0) + (v.CPC || 0))).join(', ')}`,
    csv: [...carriers.entries()].map(([k, v]) => ['Shipped via', k, v.SP || 0, v.CPC || 0]).concat(late.map(s => ['Shipped late', s.o.no, s.o.shopBrand, s.o.at, s.d])) };
}

/* ---------- drawing ---------- */
const mtgDelta = v => v === 0 ? '<span class="muted">±0</span>' : `<span style="color:${v > 0 ? '#166534' : 'var(--bad)'}">${v > 0 ? '+' : '−'}${nf(Math.abs(v))}</span>`;
function mtgMetrics(list) {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">${list.map(([l, v, col, sub]) =>
    `<div style="border:1px solid var(--line);border-radius:12px;padding:9px 12px;min-width:0;background:#fff"><div style="font-size:12px;color:var(--muted);font-weight:600">${esc(l)}</div>`
    + `<div style="font-size:21px;font-weight:800;color:${col || 'var(--ink)'};font-variant-numeric:tabular-nums">${v}</div><div style="font-size:11.5px;color:var(--muted)">${sub || ''}</div></div>`).join('')}</div>`;
}
function mtgTable(cols, rows, note) {
  return `<div style="min-width:0;overflow-x:auto"><table class="xl" style="font-size:12.5px;width:100%"><thead><tr>${cols.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>`
    + (rows.length ? rows.map(r => '<tr>' + r.map((v, i) => `<td${i ? ' class="num"' : ' style="text-align:left"'}>${v == null ? '' : v}</td>`).join('') + '</tr>').join('')
      : `<tr><td colspan="${cols.length}" class="muted" style="padding:8px">Nothing.</td></tr>`) + '</tbody></table>'
    + (note ? `<div class="muted" style="font-size:11px;margin-top:3px">${esc(note)}</div>` : '') + '</div>';
}
const MTG_SECTIONS = [['prod', '1 · Production report'], ['people', '2 · People — vacancy, challenges, initiatives'], ['open', '3 · Open orders — sea production, fabric, printing'],
  ['d2c', '4 · D2C orders — delivery within a week'], ['supply', '5 · Supply chain'], ['ship', "6 · Last week's shipments — Sea / Air / Shop / LC Air"],
  ['pre', '7 · Shopify pre-order (sea)'], ['shop', '8 · Shopify / Etsy — shipped within a week']];
function mtgCanWrite() { return !!(ME.admin || ptCanEdit()); }
function mtgBuild(wk, brand) {
  const safe = (f, ...a) => { try { return f(...a); } catch (e) { return { html: `<div class="err">Could not be worked out: ${esc(e.message || e)}</div>`, text: '', csv: [] }; } };
  return { prod: safe(mtgProduction, wk, brand), people: safe(mtgPeople, wk, brand), open: safe(mtgOpenOrders), d2c: safe(mtgD2c, wk), supply: safe(mtgSupply),
    ship: safe(mtgShipments, wk), pre: safe(mtgPreOrder), shop: safe(mtgShopShipped, wk) };
}
function mtgSummary(wk, S) {
  return `Production meeting · ${repWkRange(wk)}\n` + MTG_SECTIONS.map(([k]) => S[k].text).filter(Boolean).join('\n')
    + (() => { const a = mtgActions(wk).filter(x => x.status !== 'done'); return a.length ? '\nAction points:\n' + a.map(x => `• ${x.what}${x.who ? ' — ' + x.who : ''}${x.by ? ' (by ' + x.by.split('-').reverse().join('/') + ')' : ''}`).join('\n') : ''; })();
}
/** Open action points from every week up to this one, and this week's closed ones. */
function mtgActions(wk) {
  const out = [];
  Object.entries(MTG.meet || {}).forEach(([w, m]) => Object.entries((m && m.actions) || {}).forEach(([id, a]) => {
    if (!a || w > wk) return; if (a.status === 'done' && w !== wk) return; out.push(Object.assign({ id, week: w }, a)); }));
  return out.sort((a, b) => (a.status === 'done') - (b.status === 'done') || String(a.by || '9').localeCompare(String(b.by || '9')));
}
function renderMtg() {
  repFillWeeks();
  const wk = $('repWk').value, brand = $('repBrand').value;
  if (MTG.meet == null && !MTG.busy) mtgLoad().then(() => { if ($('repView').value === 'mtg') renderRep(); });
  if (MTG.busy || MTG.meet == null) { $('repKpis').innerHTML = ''; $('repMsg').className = 'muted'; $('repMsg').textContent = 'Reading every register for the meeting…'; $('repTable').innerHTML = ''; return; }
  if (!MTG.shop || MTG.shop.wk !== wk) mtgShopLoad(wk);
  const S = mtgBuild(wk, brand); MTG.last = { wk, S };
  const meet = (MTG.meet || {})[wk] || {}, notes = meet.notes || {}, can = mtgCanWrite();
  const note = (key, label) => `<label style="display:block;margin-top:8px;font-size:12px;font-weight:600;color:var(--muted)">${esc(label)}`
    + `<textarea data-mtgnote="${key}" rows="2" ${can ? '' : 'disabled'} placeholder="${can ? 'Type here — saved for this week' : 'notes'}" style="width:100%;margin-top:3px;font:inherit;font-weight:400">${esc(notes[key] || '')}</textarea></label>`;
  const fz = meet.frozen;
  const head = `<div class="kpi" style="flex-basis:100%;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span class="kpiname" style="font-size:15px">Production meeting — ${esc(repWkRange(wk))}</span>
      <span class="muted" style="font-size:12px">read ${esc(MTG.at)}${MTG.err.length ? ' · <span style="color:var(--bad)">not read: ' + esc(MTG.err.join(' · ')) + '</span>' : ''}</span>
      <span style="flex:1"></span>
      <button type="button" class="ghost" data-mtg="wa">Share on WhatsApp</button>
      <button type="button" class="ghost" data-mtg="copy">Copy summary</button>
      ${can ? `<button type="button" class="ghost" data-mtg="ftpl">Freight template</button><button type="button" class="ghost" data-mtg="fup">Upload freight sheet</button>
      <input type="file" id="mtgFreightFile" accept=".csv,.xlsx" style="display:none">
      <button type="button" data-mtg="freeze">${fz ? 'Freeze again' : 'Freeze this week'}</button>` : ''}
      <span id="mtgMsg" class="muted" style="flex-basis:100%;font-size:12.5px"></span></div>`
    + (fz ? `<div class="kpi" style="flex-basis:100%;background:#F0F9FF"><div class="kpihead"><span class="kpiname">As it stood in the meeting</span><span class="kpiwhen">frozen ${esc(fz.at || '')} · ${esc(fz.by || '')}</span></div>
      <pre style="white-space:pre-wrap;font:inherit;font-size:12.5px;margin:4px 0 0">${esc(fz.text || '')}</pre></div>` : '');
  const sec = MTG_SECTIONS.map(([k, t]) => `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname" style="font-size:14px">${esc(t)}</span></div>${S[k].html}
      ${(S[k].notes || [[k, 'Notes']]).map(([nk, nl]) => note(nk, nl)).join('')}</div>`).join('');
  const acts = mtgActions(wk);
  const actHtml = `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname" style="font-size:14px">Action points</span>
      <span class="kpiwhen">open ones from earlier weeks stay here until they are done</span></div>`
    + mtgTable(['What', 'Who', 'By', 'From the week of', 'Status'], acts.map(a => [esc(a.what), esc(a.who || ''), esc(a.by ? a.by.split('-').reverse().join('/') : ''),
        esc(repWkRange(a.week)), can ? `<button type="button" class="ghost" data-mtgact="${esc(a.week + '|' + a.id)}" style="padding:2px 10px;font-size:12px">${a.status === 'done' ? '✓ done — reopen' : 'Mark done'}</button>` : esc(a.status || 'open')]))
    + (can ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><input id="mtgActWhat" placeholder="What has to be done" style="flex:3 1 260px;min-width:0">
        <input id="mtgActWho" placeholder="Who" style="flex:1 1 120px;min-width:0"><input id="mtgActBy" type="date" style="flex:0 0 150px">
        <button type="button" data-mtg="act">Add</button></div>` : '') + '</div>';
  $('repKpis').innerHTML = head + sec + actHtml;
  $('repTable').innerHTML = '';
  $('repMsg').className = 'muted';
  $('repMsg').textContent = 'Every figure is read from the registers for the week picked (Sunday to Saturday); notes, action points and the freight sheet are saved for that week.';
}

/* ---------- writes ---------- */
async function mtgSaveNote(wk, key, text) {
  if (!mtgCanWrite()) return 'Not allowed.';
  await ptPut('pt_meeting/' + wk + '/notes/' + key, String(text || '').slice(0, 4000));
  MTG.meet = MTG.meet || {}; MTG.meet[wk] = MTG.meet[wk] || {}; (MTG.meet[wk].notes = MTG.meet[wk].notes || {})[key] = String(text || '').slice(0, 4000);
  return '';
}
async function mtgAddAction(wk, what, who, by) {
  if (!mtgCanWrite()) return 'Not allowed.';
  if (!String(what || '').trim()) return 'Write what has to be done.';
  const id = 'a' + Date.now().toString(36), rec = { what: String(what).trim().slice(0, 300), who: String(who || '').trim().slice(0, 80), by: by || '', status: 'open', addedBy: ME.email, addedAt: new Date().toISOString() };
  await ptPut('pt_meeting/' + wk + '/actions/' + id, rec);
  MTG.meet = MTG.meet || {}; MTG.meet[wk] = MTG.meet[wk] || {}; (MTG.meet[wk].actions = MTG.meet[wk].actions || {})[id] = rec;
  return '';
}
async function mtgToggleAction(week, id) {
  if (!mtgCanWrite()) return 'Not allowed.';
  const a = (((MTG.meet || {})[week] || {}).actions || {})[id]; if (!a) return 'That action point is gone — press Refresh.';
  const st = a.status === 'done' ? 'open' : 'done';
  await ptPatch({ ['pt_meeting/' + week + '/actions/' + id + '/status']: st, ['pt_meeting/' + week + '/actions/' + id + '/doneAt']: st === 'done' ? new Date().toISOString() : null });
  a.status = st;
  return '';
}
async function mtgFreeze(wk) {
  if (!mtgCanWrite() || !MTG.last || MTG.last.wk !== wk) return 'Not allowed.';
  const rec = { at: ptStamp(), by: ME.email, text: mtgSummary(wk, MTG.last.S) };
  await ptPut('pt_meeting/' + wk + '/frozen', rec);
  MTG.meet = MTG.meet || {}; MTG.meet[wk] = MTG.meet[wk] || {}; MTG.meet[wk].frozen = rec;
  return '';
}

$('repKpis').addEventListener('change', async e => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-mtgnote') != null) {
    const err = await mtgSaveNote($('repWk').value, t.getAttribute('data-mtgnote'), t.value).catch(er => 'Not saved: ' + (er.message || er));
    if ($('mtgMsg')) { $('mtgMsg').className = err ? 'err' : 'muted'; $('mtgMsg').textContent = err || 'Note saved.'; }
  }
  if (t && t.id === 'mtgFreightFile' && t.files && t.files[0]) {
    let err = '';
    try { err = await mtgFreightSave(await pkReadFile(t.files[0])); } catch (er) { err = 'Could not read that file: ' + (er.message || er); }
    t.value = '';
    renderMtg();
    if ($('mtgMsg')) { $('mtgMsg').className = err ? 'err' : 'muted'; $('mtgMsg').textContent = err || 'Freight sheet saved.'; }
  }
});
$('repKpis').addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-mtg],[data-mtgact]'); if (!b || $('repView').value !== 'mtg') return;
  const wk = $('repWk').value, say = (m, bad) => { if ($('mtgMsg')) { $('mtgMsg').className = bad ? 'err' : 'muted'; $('mtgMsg').textContent = m; } };
  const act = b.getAttribute('data-mtgact');
  if (act) { const [w, id] = act.split('|'); const err = await mtgToggleAction(w, id).catch(er => 'Not saved: ' + (er.message || er)); renderMtg(); return say(err || 'Saved.', !!err); }
  const k = b.getAttribute('data-mtg'), text = MTG.last ? mtgSummary(wk, MTG.last.S) : '';
  if (k === 'wa') { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); return; }
  if (k === 'copy') { try { await navigator.clipboard.writeText(text); say('Summary copied — paste it anywhere.'); } catch (er) { say('Could not copy — use Share on WhatsApp instead.', true); } return; }
  if (k === 'ftpl') return ptDownload('freight-sheet', [MTG_FREIGHT_COLS.map(csvCell).join(','), ['06-10-2026', 'FBA15XXXXXXX', 'Air', 'DHL', 4, 62, 180, 31500, 'INR', 'example — delete this row'].map(csvCell).join(',')]);
  if (k === 'fup') { const f = $('mtgFreightFile'); if (f) f.click(); return; }
  if (k === 'freeze') { const err = await mtgFreeze(wk).catch(er => 'Not saved: ' + (er.message || er)); renderMtg(); return say(err || 'Frozen — this is what the meeting saw.', !!err); }
  if (k === 'act') { const err = await mtgAddAction(wk, ($('mtgActWhat') || {}).value, ($('mtgActWho') || {}).value, ($('mtgActBy') || {}).value).catch(er => 'Not saved: ' + (er.message || er)); if (!err) renderMtg(); return say(err || 'Action point added.', !!err); }
});
function mtgExport() {
  if (!MTG.last) return;
  const { wk, S } = MTG.last;
  const lines = [['Production meeting', repWkRange(wk)].map(csvCell).join(',')];
  MTG_SECTIONS.forEach(([k, t]) => { lines.push(''); lines.push(csvCell(t)); (S[k].csv || []).forEach(r => lines.push(r.map(csvCell).join(','))); });
  lines.push(''); lines.push(csvCell('Action points'));
  mtgActions(wk).forEach(a => lines.push([a.what, a.who, a.by, a.status || 'open'].map(csvCell).join(',')));
  ptDownload('production-meeting-' + wk, lines);
}
