/* ---------- India stock, SHARED OUT ACROSS ORDERS ------------------------------------------
 *
 * THE BUG THIS EXISTS TO KILL (Ravi, 2026-09-01): five pieces in India and ten orders wanting one
 * each used to read "India ready" on all ten. Every order was compared against the whole shelf, so
 * the same five pieces were promised five times over — and the promise looked identical on every
 * row, which is what made it so hard to see.
 *
 * A shelf is not a per-order fact. It is one pile that runs out. So it is shared out ONCE, over all
 * the orders together, before a single verdict is drawn.
 *
 * WHO IS IN THE QUEUE, and why:
 *   · OLDEST FIRST. Whoever ordered first has the first claim — the same rule the warehouse would
 *     use, and the only one that does not need a person to arbitrate.
 *   · Cancelled orders take nothing.
 *   · An order already sent to Amazon takes nothing — it is coming out of Amazon's stock, not ours.
 *   · An order Amazon can fill COMPLETELY takes nothing either. soRoute prefers MCF over India, so
 *     reserving Indian stock for it would hold goods back for a parcel that is never going to use
 *     them. (That check reads FBA only, so it cannot loop back into this one.)
 *
 * What is deliberately NOT attempted: splitting a line between Amazon and India. An order Amazon can
 * only half fill asks India for the whole line. Modelling the split properly means deciding how a
 * part-shipment is actually picked and packed, and that is a decision about the warehouse, not a
 * calculation.
 */
let SO_INDIA_TAKEN = {};      // order id → { sku key → { stock, before, got, need } }

/** The key an India row was actually found under — the Shopify code or the Amazon one. */
function soIndiaKey(sku) {
  const shop = String(sku || '').trim().toUpperCase();
  if (SHOP_INDIA[shop]) return shop;
  const amz = soAmzKey(sku);
  if (SHOP_INDIA[amz]) return amz;
  return '';
}

function soAllocIndia(orders) {
  SO_INDIA_TAKEN = {};
  if (!SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return;   // nothing read, nothing to share out

  const left = {};                                    // sku key → units still unspoken for
  const queue = orders.slice().sort((a, b) =>
    String(a.at || '').localeCompare(String(b.at || '')) || String(a.no || '').localeCompare(String(b.no || '')));

  queue.forEach(o => {
    if (o.cancelled) return;
    if ((SHOP_META[o.id] || {}).mcfId) return;         // already with Amazon
    const lines = o.items.filter(i => soSendQty(o.id, i.sku, soLive(i)) > 0);
    if (!lines.length) return;
    if (soMcf(o).v === 'yes') return;                  // Amazon has it covered; leave India alone

    const take = {};
    lines.forEach(i => {
      const key = soIndiaKey(i.sku);
      if (!key) return;                                // not in the India list at all
      const row = SHOP_INDIA[key];
      const stock = Number(row[0]) || 0;
      if (left[key] == null) left[key] = stock;
      const need = soSendQty(o.id, i.sku, soLive(i));
      const got = Math.max(0, Math.min(need, left[key]));
      // `before` is what earlier orders already hold. It is the whole explanation for a row that
      // reads "No stock" while the warehouse column still shows a number, so it is carried through
      // rather than recomputed later from figures that will have moved on.
      take[key] = { stock: stock, before: stock - left[key], got: got, need: need };
      left[key] -= got;
    });
    SO_INDIA_TAKEN[o.id] = take;
  });
}

function soIndia(order) {
  // Still on its way, or it failed. Either way this is NOT a verdict about the warehouse — the
  // column now fills in a moment after the orders, so it is briefly unknown by design.
  if (!SHOP_INDIA_LOADED || SHOP_INDIA_ERR) {
    return { v: 'unknown', why: SHOP_INDIA_ERR
      ? 'India stock could not be read: ' + SHOP_INDIA_ERR
      : 'Still reading India stock from the warehouse workbook…' };
  }
  const lines = order.items.filter(i => soSendQty(order.id, i.sku, soLive(i)) > 0);
  if (!lines.length) return { v: 'none', why: 'Nothing left to send — every line is refunded or set to 0.' };
  let ok = 0, short = 0, missing = 0;
  const detail = [];
  const mine = SO_INDIA_TAKEN[order.id] || {};
  lines.forEach(i => {
    const need = soSendQty(order.id, i.sku, soLive(i));
    const row = soIndiaOf(i.sku);
    const shown = String(i.sku || '').trim().toUpperCase();
    if (!row) { missing++; detail.push(`${shown}: not in the India list`); return; }
    const pieces = row[1], pack = row[2];
    const asPieces = pack > 1 ? ` — ${pieces} pieces, pack of ${pack}` : '';
    // What this order was actually given, not what is on the shelf. An order that arrived after the
    // stock ran out gets 0 even though the warehouse column still shows a number, and the reason
    // says exactly that instead of leaving somebody to wonder.
    const a = mine[soIndiaKey(i.sku)] || { stock: Number(row[0]) || 0, before: 0, got: 0 };
    const spoken = a.before
      ? `${a.stock} in India, ${a.before} already promised to earlier orders, ${a.got} left for this one`
      : `${a.stock} in India`;
    if (a.got >= need) { ok++; detail.push(`${shown}: ${spoken}, need ${need}${asPieces}`); }
    else { short++; detail.push(`${shown}: ${spoken}, need ${need}${asPieces}`); }
  });
  const why = detail.join(' · ') + (SHOP_INDIA_AT ? ` · read ${SHOP_INDIA_AT}` : '');
  if (missing === lines.length) return { v: 'unknown', why };
  if (ok === lines.length) return { v: 'yes', why };
  if (ok === 0 && short === 0) return { v: 'unknown', why };
  if (ok > 0) return { v: 'part', why };
  return { v: 'no', why };
}

/* ONE LINE'S OWN ANSWER to "what happens to this piece".
 *
 * The order-level route is a summary of these, and a summary is exactly what somebody packing,
 * costing or chasing a single line cannot use: an order half in FBA and half still to be made reads
 * "Need from production" and says nothing at all about the half that could go today.
 *
 * The order of preference is soRoute's, deliberately — already sent, then cancelled, then nothing
 * owed, then FBA, then India, then production. A line and its order can then never disagree about
 * which source was picked.
 */
function soLineState(order, item) {
  const q = Number(item.qty) || 0;
  const rq = Number(item.rq) || 0;
  const live = soLive(item);
  const note = [];
  if (rq) note.push(`${rq} of ${q} refunded`);
  const goneNow = soRemovedQty(item);
  if (goneNow) note.push(`${goneNow} of ${q} removed by buyer`);
  // A pack split, resolved or not, is the thing that explains an unexpected quantity — or an
  // unexpected "not in FBA". It belongs wherever the line explains itself.
  const fit = soPackFit(item.sku);
  if (fit) note.push(fit.why);
  const back = note.length ? ' · ' + note.join(', ') : '';

  const sentId = (SHOP_META[order.id] || {}).mcfId || '';
  if (sentId) return { v: 'sent', label: 'MCF done', why: `Sent to Amazon as ${sentId}` + back };

  const gone = soRemovedQty(item);
  if (q > 0 && live === 0) {
    // REMOVED IS NOT REFUNDED, and the picker needs the difference. One is the buyer changing the
    // order; the other is money going back. Reading both as "cancelled" loses the only fact that
    // explains why a paid-for line is not being sent.
    if (gone > 0 && gone >= rq) {
      return { v: 'removed', label: 'Not required',
        why: 'Removed by buyer' + (gone < q ? ` (${gone} of ${q})` : '') };
    }
    return {
      v: 'cancelled', label: 'Cancelled',
      why: rq >= q ? `Refunded on Shopify — all ${q}`
        : 'Shopify says fulfilment is not required for this line',
    };
  }

  const need = soSendQty(order.id, item.sku, live);
  if (!need) return { v: 'hold', label: 'Not being sent', why: 'send qty is set to 0 on this order' + back };

  const amz = soAmzSku(item.sku);
  const fbaKey = String(amz || '').toUpperCase();
  const fba = (fbaKey && fbaKey in SHOP_STOCK) ? SHOP_STOCK[fbaKey] : null;
  if (fba != null && fba >= need) {
    return { v: 'fba', label: 'FBA ready', why: `${fba} in FBA, need ${need}` + back };
  }
  const ind = soIndiaOf(item.sku);
  // The SHARE this order holds, so a line can never claim stock the order-level column has already
  // given to somebody earlier. A line and its order disagreeing is worse than either being wrong.
  const iShare = (SO_INDIA_TAKEN[order.id] || {})[soIndiaKey(item.sku)];
  const iHave = iShare ? iShare.got : (ind ? Number(ind[0]) || 0 : 0);
  if (ind && iHave >= need) {
    return { v: 'india', label: 'India stock ready',
      why: `${iHave} sellable in India for this order, need ${need}` + back };
  }
  // Neither can cover it alone. Both figures go in the reason: "make 2" and "make 40" are different
  // conversations, and the difference is sitting in exactly these two numbers.
  const has = [fba == null ? 'not in FBA' : `${fba} in FBA`];
  has.push(ind
    ? (iShare && iShare.before
        ? `${iShare.stock} in India but ${iShare.before} promised to earlier orders, ${iHave} left here`
        : `${iHave} sellable in India`)
    : (SHOP_INDIA_LOADED && !SHOP_INDIA_ERR ? 'not in the India list' : 'India stock not read yet'));
  return { v: 'make', label: 'Required from production', why: `need ${need} — ${has.join(', ')}` + back };
}

/* The India column's own words.
 *
 * It used to borrow SO_MCF_TAG, so an order India could fill printed "MCF ready" — Amazon's verdict,
 * in Amazon's words, sitting in the India column. On an order whose MCF cell said "SKU ?" that read
 * as a flat contradiction, and it is what sent Ravi hunting for a bug in the MCF logic (2026-08-25).
 * India can never be 'sent': only Amazon can be sent to, so that state is not in this map.
 */
const SO_INDIA_TAG = {
  yes:     '<span class="st st-approved">In stock</span>',
  part:    '<span class="st st-pending">Partly</span>',
  no:      '<span class="st st-rejected">No stock</span>',
  unknown: '<span class="st st-draft">SKU ?</span>',
  none:    '<span class="st st-draft">Nothing to send</span>',
};

const SO_LINE_TAG = {
  sent:      '<span class="st st-approved" style="font-weight:700">MCF done</span>',
  cancelled: '<span class="st st-rejected">Cancelled</span>',
  removed:   '<span class="st st-rejected">Not required</span>',
  hold:      '<span class="st st-draft">Not sent</span>',
  fba:       '<span class="st st-approved">FBA ready</span>',
  india:     '<span class="st st-approved">India ready</span>',
  make:      '<span class="st st-pending">To produce</span>',
};

/**
 * WHERE THIS ORDER CAN SHIP FROM — one verdict, worked out once.
 *
 * The MCF and India columns each answer half of it, and reading two columns to reach one decision is
 * how the same order gets judged differently by two people. This is that decision, and it is the same
 * string on screen, in the filter and in the export — so a routing call made in the app and one made
 * in a spreadsheet cannot disagree.
 *
 * PENDING is Ravi's definition: neither Amazon nor India can fill it, so something has to be MADE.
 * Partly-stocked counts as pending too — half an order shipped is not an order shipped, and the
 * missing half still has to come from somewhere.
 */
function soRoute(r) {
  if (r.mcf === 'sent') return 'MCF done';
  if (r.cancelled) return 'Cancelled';
  if (r.mcf === 'none') return 'Nothing to send';
  if (r.mcf === 'yes') return 'MCF ready';
  if (r.india === 'yes') return 'Ship from India';
  return 'Need from production';
}
const soIsPending = r => soRoute(r) === 'Need from production';

/** The MCF cell. 'unknown' is drawn differently depending on whether we have Amazon's stock yet. */
const soMcfTag = v => SO_MCF_TAG[(v === 'unknown' && SHOP_STOCK_LOADED) ? 'notamz' : v] || SO_MCF_TAG.unknown;

const SO_MCF_TAG = {
  // Placed with Amazon. Deliberately the loudest thing in the column: this is the one state where
  // acting again costs a second parcel.
  sent:    '<span class="st st-approved" style="font-weight:700">MCF done</span>',
  yes:     '<span class="st st-approved">MCF ready</span>',
  part:    '<span class="st st-pending">Partly</span>',
  no:      '<span class="st st-rejected">No stock</span>',
  /* Two different facts used to wear the same label. "SKU ?" now means ONLY "Amazon's stock has not
   * been read yet"; once it has, a code Amazon does not carry is not a mystery — it is an answer,
   * and it says so. Ravi, 2026-08-25: an item that is on Shopify and in India but not on Amazon
   * should read "Not in Amazon", not a question mark. */
  unknown: '<span class="st st-draft">SKU ?</span>',
  notamz:  '<span class="st st-draft">Not in Amazon</span>',
  // Nothing is owed on this order any more. Not a stock verdict at all, which is why it is not
  // dressed as one.
  none:    '<span class="st st-draft">Nothing to send</span>',
};

/* Shopify's own fulfilment state. "partial" is kept as its own thing rather than being rounded to
 * shipped or not — a half-shipped order is the one that actually needs somebody to look at it. */
const SO_FF_TAG = {
  fulfilled:   '<span class="st st-approved">Shipped</span>',
  partial:     '<span class="st st-pending">Part shipped</span>',
  restocked:   '<span class="st st-rejected">Restocked</span>',
  unfulfilled: '<span class="st st-draft">Not shipped</span>',
};
const soFfTag = v => SO_FF_TAG[String(v || 'unfulfilled').toLowerCase()]
  || '<span class="st st-draft">' + String(v) + '</span>';

/* Three states that change what you do with an order, none of which Shopify hands over as a field.
 *
 * CANCELLED is the one solid fact: `cancelledAt` comes straight from Shopify. It matters because a
 * cancelled order arrives looking exactly like a live one — status=any returns it and its
 * fulfilment status stays null, i.e. indistinguishable from "nobody has packed it yet".
 *
 * CHARGEBACK is NOT in Shopify's order payload at all. The real source is the Shopify Payments
 * disputes endpoint, which needs a scope this token does not hold (see the Shopify token blocker).
 * So it is read from what is WRITTEN on the order — its tags, either note, or the status typed in
 * this app. That means it is only as good as the tagging; it will never invent one, and it will
 * miss a dispute nobody has written down.
 *
 * MCF DONE is our own convention: the words "MCF done" in a note. Read from BOTH notes and the
 * status box, because it gets written in whichever one is to hand.
 */
const SO_CB_RE = /charge\s*-?\s*back|dispute/i;
const SO_MCFDONE_RE = /mcf\s*-?\s*done/i;
function soFlags(o, meta) {
  const written = [o.tags, o.note, meta.note, meta.s].filter(Boolean).join(' § ');
  const cbHit = written.match(SO_CB_RE);
  /* AN ORDER WHOSE EVERY LINE CAME BACK IS OVER, whatever Shopify calls it.
   *
   * Shopify only sets cancelled_at when somebody cancels the order itself. Refund every line instead
   * and the order stays "open" with fulfilment_status null — which is indistinguishable from
   * "nobody has packed it yet". It then sat in the pending list for ever, and an MCF parcel could
   * still be sent for goods that had already been paid back.
   *
   * Only when NOTHING SHIPPED. An order that went out and was refunded afterwards is a return, not a
   * cancellation, and calling it cancelled would hide a parcel that really did leave. */
  const owed = (o.items || []).filter(i => (Number(i.qty) || 0) > 0);
  const went = /^(ful|partial)/i.test(String(o.ff || ''));
  const allBack = !went && owed.length > 0 && owed.every(i => soLive(i) === 0);
  return {
    cancelled: !!o.cancelledAt || allBack,
    refundCancel: !o.cancelledAt && allBack,
    cancelReason: o.cancelReason || (allBack && !o.cancelledAt
      ? 'every line refunded on Shopify — fulfilment not required' : ''),
    chargeback: !!cbHit,
    cbWhy: cbHit ? `Read from the order text: “${String(written).slice(0, 120)}”` : '',
    mcfDone: SO_MCFDONE_RE.test(written),
  };
}

/** Tracking numbers as one cell — linked when Shopify gave a URL, plain when it did not. */
function soTrkCell(r, esc) {
  const list = r.trk || [];
  if (!list.length) return '<span class="muted">—</span>';
  const txt = esc(list.join(', '));
  const body = r.trkUrl
    ? '<a href="' + esc(r.trkUrl) + '" target="_blank" rel="noopener">' + txt + '</a>'
    : txt;
  return body + (r.trkCo ? '<div class="muted" style="font-size:10.5px">' + esc(r.trkCo) + '</div>' : '');
}

/* Today in the STORE's day, because that is the day every order date here is written in. Falling
 * back to PT is better than falling back to the viewer's clock — an evening in India is still the
 * previous day in any US store — but it can be a day out, so the strip says when it is guessing. */
function soStoreDay(offsetDays) {
  const tz = SHOP.tz;
  const now = tz ? new Date(new Date().toLocaleString('en-US', { timeZone: tz })) : sdPT(Date.now());
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (offsetDays || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// A cancelled order is not a sale, so it is out of the count, the units and the money alike.
function soDayStats(iso) {
  const live = SHOP.orders.filter(o => o.at === iso && !o.cancelledAt);
  return {
    orders: live.length,
    units: live.reduce((s, o) => s + o.items.reduce((n, i) => n + (i.qty || 0), 0), 0),
    value: live.reduce((s, o) => s + (o.total || 0), 0),
    cancelled: SHOP.orders.filter(o => o.at === iso && o.cancelledAt).length,
  };
}

/** Orders older than this are re-fetched when the tab is opened again. */
const SHOP_STALE_MS = 2 * 60 * 1000;
let SHOP_FETCHED_AT = 0;

/* Wrapped, so a failure on the way IN is visible instead of silent.
 *
 * Anything that throws in here — a denied read, a bad cache, a name used before its line — leaves the
 * tab looking simply empty: no table, no summary, no error. Somebody then presses Fetch, which
 * cannot help, and concludes the app is broken rather than that one step failed. */
async function ensureShop() {
  try { await ensureShop_(); }
  catch (e) {
    console.error('[shop] ensureShop failed:', e);
    soMsg('This tab could not finish loading: ' + (e && e.message || e)
      + ' — the list below may be incomplete. Press F12 → Console for the full trace.', true);
    try { renderShop(); } catch (e2) { /* already reported */ }
  }
}
async function ensureShop_() {
  if (!$('soFrom').value) {
    // A month back is the window somebody actually works in; older orders have shipped.
    //
    // The upper end is TOMORROW, not today. "Today" here is the marketplace's PT date, while the
    // Shopify store keeps its own — and an order placed this evening in the store's zone can
    // already be tomorrow by PT. Reaching a day further costs one page of orders and stops the
    // newest ones, which are the only ones anybody is waiting on, from falling off the end.
    $('soTo').value = sdShift(sdToday(), 1);
    $('soFrom').value = sdShift(sdToday(), -30);
  }
  if (!Object.keys(SHOP_META).length) await loadShopMeta();
  if (!Object.keys(SHOP_SKU).length) await loadShopSku();
  if (!Object.keys(SHOP_STOCK).length) await loadShopStock();
  if (!PROD_LOADED) await loadProdNotes();      // what production has written back
  /* NOT AWAITED — and that is the point.
   *
   * India stock reads a 4,878-row workbook through Apps Script, which takes seconds. Waiting for it
   * before fetching the orders meant the tab sat empty with nothing happening, so people pressed
   * Fetch — the orders had not even been asked for yet. The orders ARE this tab; India stock and the
   * imported list are two columns on it.
   *
   * Each one re-renders when it lands, so the columns fill in a moment later rather than holding
   * everything else up. */
  loadShopIndia().then(() => renderShop()).catch(() => {});
  loadShopImported().then(() => renderShop()).catch(() => {});
  // Re-fetched on the way back in, not only the first time. This is a queue of what has to ship
  // today: showing what Shopify said twenty minutes ago is the same as showing nothing.
  if (!SHOP.orders.length || Date.now() - SHOP_FETCHED_AT > SHOP_STALE_MS) await fetchShopOrders();
  else renderShop();
}

async function fetchShopOrders() {
  const btn = $('soGo');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>…';
  try {
    soMsg('Asking Shopify…');
    const r = await baCall({ shopify: 'orders', start: $('soFrom').value, end: $('soTo').value,
      open: $('soOpen').value });
    SHOP = { orders: r.orders || [], from: r.from, to: r.to, tz: r.tz || '', at: soStamp() };
    // Stamped only on SUCCESS. A failed call that marked itself fresh would sit there for two
    // minutes showing nothing and claiming to be up to date.
    SHOP_FETCHED_AT = Date.now();
    soMsg(r.more
      ? `${SHOP.orders.length} orders — Shopify had more than one page could hold; narrow the dates to see the rest.`
      : '');
    // Hand the same list to the production app. Awaited, so a failure is reported while the person
    // who pressed Fetch is still looking at the screen.
    await publishProdOrders();
  } catch (e) {
    soMsg('Could not reach Shopify: ' + (e.message || e), true);
  }
  btn.disabled = false; btn.textContent = 'Fetch orders';
  renderShop();
}

let SO_ALL_ROWS = [];      // every order mapped, before any filter — see the note below
function soRows() {
  soIndexNames();
  const q = $('soFilter').value.trim().toLowerCase();
  const mcfSel = soMcfPicked();
  /* FETCHED AND IMPORTED ORDERS ARE ONE LIST.
   *
   * Everything past this line — the columns, the MCF decision, the pick sheet, the export — treats
   * them the same, which is the whole point of importing them rather than keeping a second screen.
   * The only difference is where they came from, and that is a column, not a code path. */
  const ALL = SHOP.orders.concat(SHOP_IMP);
  // Before a single verdict: one pile, shared out oldest-first. Doing this inside the map would put
  // every order in front of the full shelf again, which is the bug this replaces.
  soAllocIndia(ALL);
  let rows = ALL.map(o => {
    const m = soMcf(o);
    const meta = SHOP_META[o.id] || {};
    const units = o.items.reduce((s, i) => s + i.qty, 0);
    // Ordered and SHIPPABLE are two different totals once a line is refunded, removed or set to 0.
    // FedEx has one commodity slot for the whole shipment, so it needs the second one.
    const shipUnits = o.items.reduce((s, i) => s + soShipQty(o.id, i), 0);
    const grams = o.items.reduce((s, i) => s + (i.grams || 0), 0);
    /* An MCF order ALREADY PLACED outranks anything the stock map has to say.
     *
     * soMcf() only ever answers "could Amazon fulfil this", so an order that has already been sent
     * kept showing "MCF ready" — an invitation to send it a second time, and a second real parcel
     * that cannot be cancelled from here. mcfId is set the moment Amazon accepts the order and is
     * saved with the rest of the meta, so it is the honest answer to "has this gone yet".
     *
     * Kept SEPARATE from the typed "MCF done" convention (flags.mcfDone, matched out of the notes).
     * That one is somebody's word; this one is Amazon's. */
    const sentId = meta.mcfId || '';
    const ind = soIndia(o);
    return {
      ...o, india: ind.v, indiaWhy: ind.why,
      mcf: sentId ? 'sent' : m.v, mcfSent: sentId,
      mcfWhy: sentId
        ? `Sent to Amazon as ${sentId}${meta.mcfAt ? ' on ' + meta.mcfAt : ''}`
          + `${meta.mcfSpeed ? ' (' + meta.mcfSpeed + ')' : ''}${meta.mcfStatus ? ' — ' + meta.mcfStatus : ''}`
        : m.why,
      units, shipUnits, kg: grams / 1000,
      // TWO different notes, and the spread above meant ours quietly replaced Shopify's. The
      // customer's instruction and our internal remark are not interchangeable — one changes what
      // goes in the box.
      shopNote: o.note || '',
      status: meta.s || '', note: meta.note || '', carrier: meta.carrier || '',
      skus: o.items.map(i => i.sku).filter(Boolean).join(' '),
      // Filled in below, once mcf/india/cancelled on this row are all settled.
      route: '',
      // 'Shopify' for anything fetched by API; the shop's name for anything imported.
      channel: o.channel || 'Shopify',
      // Sorting and filtering need one string; the cell still draws from the array, so an order
      // that shipped in three parcels keeps all three numbers.
      trk: o.trk || [], trkTxt: (o.trk || []).join(', '),
      // Every bin this order has to be picked from, deduped and in shelf order. One order that
      // spans A.1 and C.2 is a two-stop walk, and that is worth seeing before opening it.
      locTxt: [...new Set(o.items.map(i => soLocOf(i.sku)).filter(Boolean))].sort().join(', '),
      // Pieces this order is still waiting on from production, across all its lines.
      makeQty: Object.values(meta.lines || {}).reduce((s, l) => s + (Number(l && l.adjQty) || 0), 0),
      ...soFlags(o, meta),
    };
  });
  /* Several states at once, OR'd. "Partly stocked OR not stocked" is one question, and asking it
   * used to mean looking twice and holding the answer in your head.
   *
   * The last two choices are not MCF states at all; they are the routing decision, and it takes both
   * columns to make. They live in this control because it is where somebody is already standing when
   * they ask "so where does this one ship from".
   *
   * An order ALREADY SENT to Amazon is excluded from both routing answers: it has shipped, and
   * putting it on a "ship from India" list would send a second parcel for goods already on their way.
   *
   * NOTHING TICKED MEANS ALL, so no caller has to special-case an empty filter. */
  /* WHICH DAY IT WAS PLACED, in the STORE's day — the same day every other figure on this tab is
   * counted in. Filters what is already loaded rather than re-fetching: the question "what is still
   * pending from yesterday" is asked of orders you already have on screen. */
  const chanSel = msVals('soChan');
  if (chanSel.length) rows = rows.filter(r => chanSel.includes(r.channel));

  const daySel = $('soDay').value;
  if (daySel !== '') {
    const n = Number(daySel);
    if (n === -7) {
      const from = soStoreDay(-6);
      rows = rows.filter(r => r.at >= from);
    } else {
      const want = soStoreDay(n);
      rows = rows.filter(r => r.at === want);
    }
  }
  /* Worked out on every mapped row BEFORE any filter, and the unfiltered set is kept.
   * The pending count is meant to tell you there is something to deal with — counting it after a
   * filter would report none precisely when a filter is hiding them. */
  rows.forEach(r => { r.route = soRoute(r); });
  SO_ALL_ROWS = rows;

  if (mcfSel.length) {
    // 'none' is out of BOTH routing answers. Nothing is owed on it, so it is neither a candidate
    // for India nor something production has to make — and it was landing in "Need from
    // production", which is the list people work from.
    const cannotMcf = r => r.mcf !== 'sent' && r.mcf !== 'yes' && r.mcf !== 'none';
    rows = rows.filter(r => mcfSel.some(v =>
      v === 'fromIndia' ? (cannotMcf(r) && r.india === 'yes')
      : v === 'needProd' ? (cannotMcf(r) && r.india !== 'yes')
      : r.mcf === v));
  }
  // The state filter. "Live" is the working queue — what is still actually owed to somebody — so it
  // drops all three of the states that mean "stop looking at this one".
  const stSel = $('soState').value;
  if (stSel === 'live') rows = rows.filter(r => !r.cancelled && !r.chargeback && !r.mcfDone);
  else if (stSel === 'cancel') rows = rows.filter(r => r.cancelled);
  else if (stSel === 'cb') rows = rows.filter(r => r.chargeback);
  else if (stSel === 'mcfdone') rows = rows.filter(r => r.mcfDone);

  /* "NOT YET SHIPPED" MEANS STILL OWED, NOT MERELY UNFULFILLED ON SHOPIFY (Ravi, 2026-09-03).
   *
   * The backend always asks Shopify for status=any and this picker only drops the FULFILLED ones —
   * so two kinds of finished order kept sitting in the working queue:
   *
   *   CANCELLED — never shipping at all.
   *   MCF DONE  — already handed to Amazon. Shopify still reads "Not shipped" until the tracking
   *               number comes back hours later, but there is nothing left for anybody to do.
   *
   * Both are dropped, UNLESS the state picker is asking for that very thing — then it is not a queue
   * any more, it is a deliberate look, and hiding what was just asked for is the worse surprise. */
  if ($('soOpen').value === '1') {
    if (stSel !== 'cancel') rows = rows.filter(r => !r.cancelled);
    if (stSel !== 'mcfdone') rows = rows.filter(r => !r.mcfDone);
  }
  if (q) rows = rows.filter(r =>
    (r.no + ' ' + r.skus + ' ' + (r.ship.name || '') + ' ' + (r.ship.country || '')
      + ' ' + r.shopNote + ' ' + r.note + ' ' + r.status + ' ' + r.trkTxt
      + ' ' + r.items.map(i => i.name).join(' ')).toLowerCase().includes(q));

  const k = SHOP_SORT.k, dir = SHOP_SORT.dir;
  rows.sort((a, b) => (typeof a[k] === 'string')
    ? String(a[k] || '').localeCompare(String(b[k] || '')) * dir
    : ((a[k] == null ? -Infinity : a[k]) - (b[k] == null ? -Infinity : b[k])) * dir);
  return rows;
}

function renderShop() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const rows = soRows();
  // Before the empty-list bail-out below, so the strip clears itself instead of keeping the previous
  // fetch's numbers on screen next to "no orders loaded".
  renderShopToday();

  /* Counted over BOTH sources. This used to test the fetched list alone, so a shop whose orders are
   * imported showed "no orders loaded" and made somebody press Fetch — which does nothing for a
   * channel that has no API key in the first place. */
  if (!SHOP.orders.length && !SHOP_IMP.length) {
    $('soTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">'
      + 'No orders yet — pick a date range and hit “Fetch orders”, or bring some in with Import orders.</td></tr></tbody>';
    return;
  }

  const n = v => rows.filter(r => r.mcf === v).length;
  // Counted over EVERY loaded order, not the filtered rows — otherwise picking "Live only" would
  // report zero cancellations and read as "there are none".
  const all = SHOP.orders.concat(SHOP_IMP).map(o => soFlags(o, SHOP_META[o.id] || {}));
  const nAll = f => all.filter(x => x[f]).length;
  // SHOP.from/to are what the BACKEND says it used, echoed back — not what is typed in the boxes.
  // When they disagree, the boxes were changed and Fetch was never pressed, and the list on screen
  // is answering a question nobody is asking any more. Saying so beats letting somebody conclude
  // the date range is broken.
  const stale = ($('soFrom').value && $('soFrom').value !== SHOP.from)
    || ($('soTo').value && $('soTo').value !== SHOP.to);
  // The denominator has to be BOTH sources, or a screen full of imported orders reports "12 of 0".
  soMsg(`${rows.length} of ${SHOP.orders.length + SHOP_IMP.length} orders`
    + (SHOP_IMP.length ? ` (${SHOP_IMP.length} imported)` : '')
    + ` · ${SHOP.from} → ${SHOP.to}`
    + (() => {
        // Over every loaded order, and split by day, because "still pending from yesterday" is the
        // question somebody actually walks in with.
        const pend = SO_ALL_ROWS.filter(soIsPending);
        if (!pend.length) return '';
        const y = soStoreDay(-1), t = soStoreDay(0);
        const yd = pend.filter(r => r.at === y).length, td = pend.filter(r => r.at === t).length;
        // PLAIN TEXT. soMsg writes with textContent, so markup here prints as markup — which is
        // exactly what it did: the tab showed a literal <b style=...> in the middle of the summary.
        return ` · ${pend.length} PENDING`
          + ` (neither Amazon nor India can fill them${yd ? ` — ${yd} from yesterday` : ''}${td ? `, ${td} from today` : ''})`;
      })()
    + (n('sent') ? ` · ${n('sent')} already sent to Amazon` : '')
    + ` · ${n('yes')} MCF ready, ${n('part')} partly, ${n('no')} not stocked`
    + (n('unknown') ? `, ${n('unknown')} with SKUs Amazon has never seen` : '')
    /* PLAIN TEXT ONLY. soMsg sets textContent, so a tag written here appears on screen as a tag —
     * which is exactly what happened the first time this note was added. */
    + (nAll('cancelled')
        ? ` · ${nAll('cancelled')} cancelled`
          + ($('soOpen').value === '1' && $('soState').value !== 'cancel'
              ? ' (hidden — pick "Cancelled" in the state box)' : '')
        : '')
    + (nAll('chargeback') ? `, ${nAll('chargeback')} chargeback` : '')
    + (nAll('mcfDone')
        ? `, ${nAll('mcfDone')} MCF done`
          + ($('soOpen').value === '1' && $('soState').value !== 'mcfdone'
              ? ' (hidden — already with Amazon; pick "MCF done" in the state box)' : '')
        : '')
    + (SHOP.at ? ` · fetched ${SHOP.at}` : '')
    /* WHICH SHOPS THIS SCREEN CAN ACTUALLY FETCH (2026-09-23: a colleague ticked CPC Shopify here and
     * saw nothing). This app has an API key for one store only; CPC and the Etsy shops arrive through
     * Import orders, and the live CPC store is connected in the Replenishment app. Saying so beats a
     * silent "Nothing matches that filter". */
    + soNoKeyNote()
    + (stale ? ` — the boxes now say ${$('soFrom').value} → ${$('soTo').value}; press Fetch orders` : ''),
    stale);

  const COLS = [
    { k: 'pick', t: '', noSort: 1 },
    { k: 'no', t: 'Order', frz: 1 },
    { k: 'at', t: 'Date' },
    { k: 'name', t: 'Ship to' },
    { k: 'country', t: 'Country' },
    { k: 'units', t: 'Units', num: 1 },
    { k: 'kg', t: 'Weight kg', num: 1 },
    { k: 'total', t: 'Order value', num: 1 },
    { k: 'locTxt', t: 'Location', tip: 'Which shelf bins this order has to be picked from. Set it against the SKU inside the order — it then fills itself on every future order carrying that SKU.' },
    { k: 'makeQty', t: 'To make', num: 1, tip: 'Pieces this order is short and waiting on from production. Raised inside the order; printed from the Adjustments button.' },
    /* THE ORDER HERE MUST MATCH THE ORDER THE CELLS ARE WRITTEN IN, BELOW.
     *
     * It did not. The body wrote mcf · india · channel · route, this list said mcf · channel ·
     * route · india, and nothing anywhere compares the two — so every header from MCF onward sat
     * over the wrong column. On screen that made India's verdict appear under "Shop", the shop name
     * under "Ship from", and the route under "India"; clicking a header sorted by a different
     * column than the one you were pointing at. Found 2026-08-25 from an order reading "SKU ?" and
     * "MCF ready" side by side. Change one of these two lists and you must change the other. */
    { k: 'mcf', t: 'MCF', tip: 'Whether Amazon FBA holds enough stock for every line. Hover a cell for the per-SKU numbers.' },
    { k: 'india', t: 'India', tip: 'Whether the India warehouse holds enough for every line — read live from the Ready Goods workbook, in SELLABLE units (pieces ÷ pack), because that is what an order line is counted in. Hover a cell for the per-SKU numbers.' },
    { k: 'channel', t: 'Shop', tip: 'Which shop the order came from. "Shopify" is fetched live; the rest are imported, because this app has no API key for them.' },
    { k: 'route', t: 'Ship from', tip: 'One answer instead of two columns: MCF done · MCF ready · Ship from India · Need from production. "Need from production" means neither Amazon nor India can fill it — those are the pending ones.' },
    { k: 'prod', t: 'Production', tip: 'Written by the production team in their own app. Read-only here — this is their column, and editing it from two places is how one of the two silently loses.' },
    { k: 'ff', t: 'Shopify', tip: 'What Shopify itself says has shipped — separate from your own status below.' },
    { k: 'trkTxt', t: 'Tracking', tip: 'Every tracking number on the order, across all its parcels.' },
    { k: 'status', t: 'Status' },
    { k: 'carrier', t: 'Ship via' },
    { k: 'items', t: 'Items' },
  ];
  const arrow = k => (SHOP_SORT.k === k ? (SHOP_SORT.dir > 0 ? ' ↑' : ' ↓') : '');
  const head = '<thead><tr>' + COLS.map(c =>
    c.noSort
      ? '<th style="width:28px"><input type="checkbox" id="soAll" title="Tick every order on screen"></th>'
      : '<th class="' + (c.num ? 'num' : '') + (c.frz ? ' frz' : '') + '" data-so-sort="' + c.k + '"'
        + ' style="cursor:pointer"' + (c.tip ? ' title="' + c.tip + '"' : '')
        + '>' + c.t + arrow(c.k) + '</th>').join('') + '</tr></thead>';

  const body = rows.map(r => '<tr data-so="' + esc(r.id) + '" style="cursor:pointer"'
    + ' class="' + [r.cancelled ? 'so-cancel' : '', r.chargeback ? 'so-cb' : ''].filter(Boolean).join(' ') + '"'
    + (r.cancelled ? ' title="Cancelled ' + esc(r.cancelledAt) + (r.cancelReason ? ' — ' + esc(r.cancelReason) : '') + '"' : '')
    + '>'
    // The tick lives in its own cell and swallows the click, so ticking an order does not also open it.
    + '<td><input type="checkbox" class="soPick" data-id="' + esc(r.id) + '"'
      + (SO_PICKED.has(r.id) ? ' checked' : '') + '></td>'
    // A Shopify note is flagged on the row itself, not left to be discovered by opening the order.
    + '<td class="frz" style="font-weight:600">' + esc(r.no)
      + (r.shopNote ? ' <span title="Shopify note: ' + esc(r.shopNote) + '" style="color:#854d0e">&#9998;</span>' : '')
    + '</td>'
    + '<td>' + esc(r.at) + '</td>'
    + '<td title="' + esc([r.ship.a1, r.ship.a2, r.ship.city, r.ship.state, r.ship.zip].filter(Boolean).join(', ')) + '">'
      + esc(String(r.ship.name || '').slice(0, 22)) + '</td>'
    + '<td>' + esc(r.ship.country) + '</td>'
    + '<td class="num">' + r.units + '</td>'
    + '<td class="num">' + (r.kg ? r.kg.toFixed(2) : '<span class="muted">—</span>') + '</td>'
    + '<td class="num">' + money(r.total) + '</td>'
    + '<td style="font-weight:600;white-space:nowrap"'
      + ' title="' + esc(r.items.map(i => `${i.sku || i.name}: ${soLocOf(i.sku) || 'no bin set'}`).join(' · ')) + '">'
      + (r.locTxt ? esc(r.locTxt) : '<span class="muted">—</span>') + '</td>'
    + '<td class="num">' + (r.makeQty
        ? '<span class="st st-pending">' + r.makeQty + '</span>' : '<span class="muted">—</span>') + '</td>'
    + '<td title="' + esc(r.mcfWhy) + '">' + soMcfTag(r.mcf) + '</td>'
    + '<td title="' + esc(r.indiaWhy) + '">' + (SO_INDIA_TAG[r.india] || SO_MCF_TAG[r.india]) + '</td>'
    + '<td>' + (r.channel === 'Shopify' ? '<span class="muted">Shopify</span>'
        : '<span class="st st-draft">' + esc(r.channel) + '</span>') + '</td>'
    + '<td>' + (r.route === 'Need from production'
        ? '<span class="st st-rejected">' + esc(r.route) + '</span>'
        : r.route === 'Ship from India'
          ? '<span class="st st-pending">' + esc(r.route) + '</span>'
          : '<span class="muted">' + esc(r.route) + '</span>') + '</td>'
    + '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"'
      + ' title="' + esc(soProdNoteWhy(r.id)) + '">' + soProdNoteCell(r.id) + '</td>'
    + '<td' + (r.shippedAt ? ' title="shipped ' + esc(r.shippedAt) + '"' : '') + '>' + soFfTag(r.ff) + '</td>'
    + '<td style="max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + soTrkCell(r, esc) + '</td>'
    // Every state that is drawn on the row also says its name here — the strike and the red tint are
    // the second signal, never the only one.
    + '<td class="so-keep">'
      + (r.cancelled ? '<span class="st st-rejected" title="Cancelled in Shopify'
          + (r.cancelReason ? ': ' + esc(r.cancelReason) : '') + '">Cancelled</span> ' : '')
      + (r.chargeback ? '<span class="st st-rejected" title="' + esc(r.cbWhy) + '">Chargeback</span> ' : '')
      + (r.mcfDone ? '<span class="st st-approved" title="“MCF done” is written on this order.">Done</span> ' : '')
      + (r.status ? esc(r.status) : (r.cancelled || r.chargeback || r.mcfDone ? '' : '<span class="muted">—</span>'))
      + (r.note ? '<div class="muted" style="font-size:10.5px">' + esc(String(r.note).slice(0, 24)) + '</div>' : '') + '</td>'
    + '<td>' + (r.carrier ? esc(r.carrier) : '<span class="muted">—</span>') + '</td>'
    + '<td title="' + esc(r.items.map(i => `${i.sku || i.name} × ${i.qty}`).join(' · ')) + '"'
      + ' style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + esc(r.items.map(i => `${i.sku || i.name} × ${i.qty}`).join(' · ')) + '</td>'
    + '</tr>').join('');

  $('soTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="' + COLS.length + '" class="muted" style="padding:14px">Nothing matches that filter.</td></tr>')
    + '</tbody>';

  $('soTable').querySelectorAll('[data-so-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.soSort;
    const text = !['units', 'kg', 'total', 'makeQty'].includes(k);
    SHOP_SORT = { k, dir: SHOP_SORT.k === k ? -SHOP_SORT.dir : (text ? 1 : -1) };
    renderShop();
  });
  $('soTable').querySelectorAll('[data-so]').forEach(tr => tr.onclick = () => openShopOrder(tr.dataset.so));
  // Bound AFTER the row handler and stopping propagation, or every tick would also open the order.
  $('soTable').querySelectorAll('.soPick').forEach(cb => {
    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => {
      cb.checked ? SO_PICKED.add(cb.dataset.id) : SO_PICKED.delete(cb.dataset.id);
      soPickedMsg();
    };
  });
  const allBox = $('soAll');
  if (allBox) {
    allBox.onclick = e => e.stopPropagation();
    allBox.onchange = () => {
      $('soTable').querySelectorAll('.soPick').forEach(cb => {
        cb.checked = allBox.checked;
        allBox.checked ? SO_PICKED.add(cb.dataset.id) : SO_PICKED.delete(cb.dataset.id);
      });
      soPickedMsg();
    };
  }
  soPickedMsg();
}

/* Which orders are ticked. Kept as ids rather than rows, so a tick survives a re-render — sorting or
 * filtering must not quietly drop something somebody had already chosen to print. */
let SO_PICKED = new Set();
function soPickedMsg() {
  const el = $('soPickMsg');
  if (!el) return;
  // Counted against what is ON SCREEN. A tick on an order that has since been filtered away is still
  // held, but saying "12 ticked" while showing three of them would be a lie about what Print will do.
  const shown = [...$('soTable').querySelectorAll('.soPick')].filter(cb => cb.checked).length;
  el.textContent = SO_PICKED.size
    ? `${shown} ticked${SO_PICKED.size !== shown ? ` on screen (${SO_PICKED.size} in total, the rest are filtered out)` : ''} · Print and Export will use these`
    : 'Nothing ticked · Print and Export will use everything shown.';
}

/* Today and yesterday, side by side. Not filtered by anything in the toolbar — "how are we doing
 * today" is a question about the shop, not about the rows somebody has narrowed to. */
function renderShopToday() {
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const today = soStoreDay(0), yday = soStoreDay(-1);
  const box = (label, iso, s) => `<div>`
    + `<div class="muted" style="font-size:11px">${label} · ${iso}</div>`
    + `<div style="font-weight:700">${s.orders} order${s.orders === 1 ? '' : 's'}`
    + ` · ${s.units} unit${s.units === 1 ? '' : 's'} · ${money(s.value)}</div>`
    + (s.cancelled ? `<div class="muted" style="font-size:11px">${s.cancelled} cancelled, not counted</div>` : '')
    + `</div>`;
  // The window is the user's choice and can easily not reach today — saying so beats showing a
  // truthful zero that reads as "no sales today".
  const covers = d => (!SHOP.from || d >= SHOP.from) && (!SHOP.to || d <= SHOP.to);
  $('soToday').innerHTML = box('Today', today, soDayStats(today))
    + box('Yesterday', yday, soDayStats(yday))
    + (SHOP.tz ? '' : '<div class="muted" style="font-size:11px;align-self:center">'
        + 'Store timezone unknown — these two days are counted in PT and may be a day out. '
        + 'Press Fetch orders to pick it up.</div>')
    + (covers(today) && covers(yday) ? '' : '<div style="color:var(--warn);font-size:11.5px;align-self:center">'
        + 'The date range does not cover both days — widen it before reading these.</div>');
}

