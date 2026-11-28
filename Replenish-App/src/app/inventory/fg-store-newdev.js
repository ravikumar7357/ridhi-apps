/* ================= INDIA STORE: NEW DEVELOPMENT PIECES FOR FBA =================
 * Business rule (28 Nov, agreed): the pending pieces of a sales order of type New development are never Custom, whatever
 * the channel. They are kept for FBA, even for a SKU Replenishment does not ask for, in the Air, Sea or AWD column by the
 * order's shipping mode (none, or not one of these: Air).
 *   Pending = ordered, less issues naming the order and less pieces sent to FBA that did not come back: those naming the
 *             order, then those naming no order and sent on or after its date (oldest order first).
 *             With FBA lists (fba-lists.js): pieces on a list not yet shipped count as sent already. A list's pieces, before
 *             and after Ship, count as naming no order (the order numbers on its movements are dealt by the store, not
 *             chosen), so shipping never frees them again. Those that met New development also come off what Replenishment
 *             asks, in another lane when their own asks less, until the Amazon figures have seen them.
 *   A SKU's FBA total is the LARGER of its New development pending and what Replenishment still asks, never both added:
 *             New development fills its own columns first, then Replenishment's extra goes to Air, then Sea, then AWD.
 *   FBA may take the New development part only when Amazon lists the SKU (live or inactive). Otherwise the pieces stay in
 *   their column and only Replenishment's own quantity may leave. An admin's release works as for any SKU. An FBA list is
 *   held to the same when it is made and again when it is shipped.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — the sales orders cannot be read (some accounts may not read them): no line counts as New
 *   development, which is how the store worked before; the stock list and a refused FBA entry say so. A listing that is
 *   not there or cannot be read: the New development part may not go, with what to do.
 *   quiet, with a console line — the failed read of the sales orders itself.
 *
 * BEHIND SWITCH storeAlloc (fg-store-alloc.js). */
const FGA_MODE_LANE = { SEA: 'sea', AWD: 'awd' };
const FGA_NOT_SHIPPED = '9999-12-31';   // the day of pieces still on an FBA list: they go after every order's date
let FGA_SALES = { rows: [], err: '' };

/** Read the sales orders, which say what is New development. Never throws. */
async function fgaSalesRead() {
  if (!fgaOn()) return;
  try { FGA_SALES = { rows: ptList(await ptGet('pt_salesOrders')), err: '' }; }
  catch (e) {
    console.warn('India store shares: the sales orders could not be read, so no order counts as New development:', e.message || e);
    FGA_SALES = { rows: [], err: e.message || String(e) };
  }
}
/** Why New development orders are not counted at all, or ''. */
const fgaSalesWhy = () => (FGA_SALES.err ? 'The sales orders could not be read, so New development orders are not counted or marked'
  + ' and nothing goes to FBA for them — press Refresh; if this stays, ask an admin to let this account see Sales Orders.' : '');

/* ---- the orders ---- */
/** Order book lines parted into { newDev, rest } by the type on their sales order. */
function fgaSplitNewDev(lines) {
  const set = ordNewDevSet(FGA_SALES.rows), out = { newDev: [], rest: [] };
  lines.forEach(l => out[set.has(obUC(l.orderNo) + '|' + obUC(l.sku)) ? 'newDev' : 'rest'].push(l));
  return out;
}
/** What dispatches to FBA took, less returns, and what FBA lists keep: { named: pieces by 'ORDER|SKU key',
 *  loose: [{ key, day, pieces }] for the pieces that name no order, and every FBA list's, oldest first }.
 *  allotted: the pieces on lists not yet shipped (fblAllotted). */
function fgaSentToFba(ledgerRows, allotted) {
  const named = new Map(), loose = [];
  (ledgerRows || []).forEach(r => {
    if (!r || r.txnType !== 'FBA') return;
    const key = shpHoldKey(r.sku);
    let left = fbaState(r).open;
    (r.fbaListId ? [] : fgiOutParts(r)).forEach(p => {
      const pieces = Math.min(left, p.qty), id = p.orderNo + '|' + key;
      left -= pieces;
      named.set(id, (named.get(id) || 0) + pieces);
    });
    if (left > 0) loose.push({ key, day: fapDayOf(r), pieces: left });
  });
  Object.entries(allotted || {}).forEach(([key, a]) => loose.push({ key, day: FGA_NOT_SHIPPED, pieces: a.total }));
  return { named, loose: loose.sort((a, b) => a.day.localeCompare(b.day)) };
}
/** The orders less what went to FBA for them, each dispatched piece counted once. orders: oldest first; new ones returned. */
function fgaLessFba(orders, sent) {
  const left = orders.map(o => Object.assign({}, o, { pending: o.pending - Math.min(o.pending, sent.named.get(o.no + '|' + o.key) || 0) }));
  sent.loose.forEach(d => {
    let pieces = d.pieces;
    left.filter(o => o.key === d.key && o.on <= d.day).forEach(o => {
      const met = Math.min(pieces, o.pending);
      pieces -= met; o.pending -= met;
    });
  });
  return left.filter(o => o.pending > 0);
}
/** The New development orders still waiting, per SKU key, oldest first: [{ no, key, channel, on, lane, ordered, pending }].
 *  lines: their open order book lines; allotted: the pieces on FBA lists not yet shipped. */
function fgaNewDevOrders(lines, ledgerRows, allotted) {
  const laneOf = new Map(FGA_SALES.rows.map(o => [obUC(o._id), FGA_MODE_LANE[soShipMode(o)] || 'air']));
  const waiting = shpHoldLeft(lines.map(fgaClaim), ledgerRows).map(n => ({ no: n.orderNo, key: n.key,
    channel: ORD_PLAT_SRC[n.orderNo.split('-')[0]] || 'Other', on: pdIso(n.on), lane: laneOf.get(n.orderNo) || 'air',
    ordered: n.asked, pending: n.pieces })).sort(shpHoldOldestFirst);
  const out = new Map();
  fgaLessFba(waiting, fgaSentToFba(ledgerRows, allotted))
    .forEach(o => out.set(o.key, (out.get(o.key) || []).concat(o)));
  return out;
}

/** Pieces per SKU key that New development orders got from FBA lists the Amazon figures do not know yet: lists not
 *  shipped, and shipments still on the way. now: { rows, need, newDev: the orders still waiting with every list counted }. */
function fgaListMet(lines, now) {
  if (!shpListsOn()) return new Map();
  const others = now.rows.filter(r => !(r && r.fbaListId && fgaOnTheWay([r], now.need).size));
  return new Map([...fgaNewDevOrders(lines, others)].map(([key, orders]) =>
    [key, fgaSum(orders, 'pending') - fgaSum(now.newDev.get(key) || [], 'pending')]));
}

/* ---- the FBA columns ---- */
const fgaLaneSum = lanes => FGA_LANES.reduce((n, k) => n + lanes[k], 0);
/** A SKU's pending New development pieces per column. */
function fgaNewDevLanes(sku, book) {
  const lanes = { air: 0, sea: 0, awd: 0 };
  (book.newDev.get(shpHoldKey(sku)) || []).forEach(o => { lanes[o.lane] += o.pending; });
  return lanes;
}
/** New development and Replenishment together, adding up to the larger of the two totals. */
function fgaJoinLanes(newDev, repl) {
  let extra = Math.max(0, fgaLaneSum(repl) - fgaLaneSum(newDev));
  const out = {};
  FGA_LANES.forEach(k => {
    const more = Math.min(extra, Math.max(0, repl[k] - newDev[k]));
    extra -= more;
    out[k] = newDev[k] + more;
  });
  return out;
}

/* ---- only what Amazon lists ---- */
/** Why a SKU's New development pieces may not go to FBA, or '' when Amazon lists it. */
function fgaListingWhy(sku) {
  const st = LST.err ? 'unknown' : lstOf(sku).st;
  if (st === 'listed' || st === 'inactive') return '';
  if (st === 'not') return `${obUC(sku)} is a New development article that is not listed on Amazon, so its New development pieces cannot go to FBA`
    + ' — ask the listing team to list it ("Needs listing on Amazon"), refresh the Amazon listings, then try again.';
  return `The Amazon listing of ${obUC(sku)} could not be checked, so its New development pieces cannot go to FBA`
    + ' — press Refresh on Finished Goods; if this stays, ask someone with Replenishment access to refresh the Amazon listings.';
}
/** What to add when FBA is refused: why New development pieces are not counted or may not go; '' when neither. */
function fgaNewDevWhy(sku) {
  return fgaSalesWhy() || (fgaBook().newDev.has(shpHoldKey(sku)) ? fgaListingWhy(sku) : '');
}

/* ---- on screen ---- */
const FGA_NEW_DEV_TAG = '<span class="pill pill-low">New dev</span>';
/** For "Needs listing on Amazon": answers a SKU's New development orders as tagged lines, '' for none. */
function fgaNewDevTagger() {
  if (!fgaOn()) return () => '';
  const { newDev } = fgaBook();
  return sku => (newDev.get(shpHoldKey(sku)) || [])
    .map(o => `<div style="font-size:11.5px">${FGA_NEW_DEV_TAG} ${esc(o.no)} · ${nf(o.pending)} pending</div>`).join('');
}
function fgaNewDevRow(o) {
  return `<tr><td style="text-align:left">${esc(o.no)} ${FGA_NEW_DEV_TAG}</td><td style="text-align:left">${esc(o.channel)}</td>`
    + `<td style="text-align:left;white-space:nowrap">${esc(fgiDmy(o.on) || '—')}</td>`
    + `<td class="num">${nf(o.ordered)}</td><td class="num">${fgaNum(o.ordered - o.pending)}</td><td class="num">${nf(o.pending)}</td></tr>`;
}
/** The box an FBA figure with New development pieces opens: that column's orders. */
function fgaNewDevOpen(sku, lane) {
  const s = obUC(sku), m = fgiMaster(s), label = FGA_SHARES.find(x => x[0] === lane)[1];
  const orders = (fgaBook().newDev.get(shpHoldKey(s)) || []).filter(o => o.lane === lane);
  ptOpenDialog({
    title: `New development orders in ${label}`,
    subtitle: [s, m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · '),
    note: `${nf(fgaSum(orders, 'pending'))} pending New development piece(s) ship by ${label}. The column shows what stock covers,`
      + ` and may also hold pieces Replenishment asks for. ${fgaListingWhy(s)}`,
    wide: true,
    html: fgaOrdersTable(['Ordered', shpListsOn() ? 'Issued or on FBA lists' : 'Already issued', 'Pending'], orders.map(fgaNewDevRow)),
  });
}
