/* ================= TRACKING — EVERY ORDER, START TO FINISH (Ravi, 2026-09-25) =================
 *
 * "mujhe fully tracking wala system banana h". One row per order. Each line is placed at ONE stage — the
 * furthest-back place any of its pieces are — and the order sits at the stage of its most-behind line, because
 * that is what it is waiting for. Past the press it follows the pieces: into the store, to FBA (waiting for the
 * FBA team, or shipped with a shipment id), out to a buyer, or handed to Shopify shipping.
 */
const ORD_TRACK = [
  ['vendor', 'With vendor', 'clock', 'amber'],
  ['cut', 'Cutting', 'cut', 'blue'],
  ['issue', 'To give a karigar', 'up', 'blue'],
  ['karigar', 'With karigar', 'clock', 'blue'],
  ['press', 'Press', 'press', 'blue'],
  ['ready', 'Ready to hand over', 'box', 'amber'],
  ['nostore', 'Made, not in store', 'alert', 'amber'],
  ['store', 'In store', 'box', 'blue'],
  ['fba', 'Sent to FBA, not shipped', 'clock', 'amber'],
  ['done', 'Shipped / delivered', 'ok', 'green'],
];
/** Where one line is: the index into ORD_TRACK. */
function ordTrackStage(r) {
  if (r.open) {
    const w = ordWaitingAt(r);
    return /^Vendor/.test(w) ? 0 : /^Cutting/.test(w) ? 1 : /^Issue/.test(w) ? 2 : /^Karigar/.test(w) ? 3 : /^Press/.test(w) ? 4 : 5;
  }
  if (r.handedAt || r.shopDoneAt) return 9;
  const g = ordFgAt(r.orderNo, r.sku) || { in: 0, store: 0, fbaOpen: 0, fbaShip: 0, issued: 0, out: 0 };
  if (g.store > 0) return 7;
  if (g.fbaOpen > 0) return 8;
  if (g.out > 0) return 9;
  /* A Shopify line pressed in full but never handed to shipping is waiting for the handover, not the store. */
  return ordIsMto(r.orderNo) ? 5 : 6;
}
/**
 * Shopify's own record of every Shopify order in the book: orderId → { no, ff, trk[], trkCo, trkUrl, shippedAt,
 * cancelledAt, via }. Read once per quarter of an hour, both stores, from the oldest Shopify order in the book.
 */
async function ordTrackShopLoad(force) {
  if (ORD.shopTrkBusy) return;
  if (ORD.shopTrk && !force && Date.now() - (ORD.shopTrkAt || 0) < 15 * 60e3) return;
  const lines = ordLines().filter(r => r.shopOrderId);
  const days = lines.map(r => ptIsoDate(r.orderDate)).filter(Boolean).sort();
  if (!days.length) { ORD.shopTrk = new Map(); ORD.shopTrkAt = Date.now(); return; }
  ORD.shopTrkBusy = true; ORD.shopTrkErr = '';
  try {
    if (typeof SHOP_META !== 'undefined' && !Object.keys(SHOP_META).length && typeof loadShopMeta === 'function') { try { await loadShopMeta(); } catch (e) { /* carrier falls back to Shopify's */ } }
    const r = await repShopFetch({ start: days[0], end: new Date().toISOString().slice(0, 10), open: '0' });
    const m = new Map();
    r.orders.forEach(o => m.set(String(o.id), { no: o.no || '', ff: String(o.ff || 'unfulfilled').toLowerCase(), trk: o.trk || [], trkCo: o.trkCo || '',
      trkUrl: o.trkUrl || '', shippedAt: o.shippedAt || '', cancelledAt: o.cancelledAt || '',
      via: repShipVia(o, typeof SHOP_META !== 'undefined' ? SHOP_META[o.id] : null) }));
    ORD.shopTrk = m; ORD.shopTrkErr = r.errs.join(' · '); ORD.shopTrkMore = !!r.more;
  } catch (e) { ORD.shopTrkErr = e.message || String(e); ORD.shopTrk = ORD.shopTrk || new Map(); }
  ORD.shopTrkBusy = false; ORD.shopTrkAt = Date.now();
  if (ordView() === 'track') renderOrd();
}
/** Shopify's word on one order, or null when it has not been read or does not know the order. */
const ordShopTrkOf = id => (id && ORD.shopTrk ? ORD.shopTrk.get(String(id)) || null : null);

function ordTrackRows() {
  const by = new Map();
  ordApply(ordLines(), ordFilters()).forEach(r => {
    let o = by.get(r.orderNo);
    if (!o) { o = { orderNo: r.orderNo, date: r.orderDate || '', src: ordSrcOf(r.orderNo) || String(r.orderNo).split('-')[0], lines: 0,
      ordered: 0, pressed: 0, store: 0, fba: 0, fbaOpen: 0, fbaShip: 0, issued: 0, handed: 0, stage: 9, n: new Array(ORD_TRACK.length).fill(0), ships: new Set() };
      by.set(r.orderNo, o); }
    const g = ordFgAt(r.orderNo, r.sku) || {};
    const st = ordTrackStage(r);
    o.lines++; o.ordered += r.qty; o.pressed += Math.min(r.qty, r.pressed || 0);
    o.store += g.store || 0; o.fba += g.fba || 0; o.fbaOpen += g.fbaOpen || 0; o.fbaShip += g.fbaShip || 0; o.issued += g.issued || 0;
    if (r.handedAt) o.handed += r.qty;
    if (r.shopOrderId) (o.shopIds || (o.shopIds = new Set())).add(String(r.shopOrderId));
    (g.docs || []).forEach(d => { if (d.shipment) o.ships.add(d.shipment); if (d.lr) o.ships.add('LR ' + d.lr); if (d.invoice) o.ships.add('inv ' + d.invoice); });
    o.n[st]++; o.stage = Math.min(o.stage, st);
  });
  /* SHOPIFY'S WORD ON ITS OWN ORDERS. Fulfilled (or cancelled) in Shopify is the end of the order — the parcel has
   * gone, or never will — whatever the floor registers still say; part-fulfilled keeps its stage and shows its parcels. */
  by.forEach(o => {
    const sh = [...(o.shopIds || [])].map(ordShopTrkOf).filter(Boolean);
    o.shop = sh;
    if (!sh.length) return;
    o.shopState = sh.every(x => x.cancelledAt) ? 'cancelled' : sh.every(x => x.ff === 'fulfilled' || x.cancelledAt) ? 'shipped'
      : sh.some(x => x.ff === 'partial' || x.ff === 'fulfilled') ? 'partial' : 'open';
    if (o.shopState === 'shipped' || o.shopState === 'cancelled') o.stage = 9;
  });
  const now = Date.now();
  return [...by.values()].map(o => Object.assign(o, { days: o.date ? Math.max(0, Math.floor((now - (ptDtMs(o.date) || now)) / 864e5)) : null }))
    .sort((a, b) => a.stage - b.stage || (ptDtMs(a.date) || 0) - (ptDtMs(b.date) || 0));
}
