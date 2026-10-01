/* ================= THE PRODUCTION VIEW =====================================================
 *
 * A second app, in a DIFFERENT Firebase project, needs to see these orders and write a comment back
 * against them. Two ways to do that, and the choice matters more than the code:
 *
 *   COPY the orders into the other project — rejected. Two copies means two truths, and the day
 *   they drift apart nothing announces it; somebody makes a quilt against a line that was refunded
 *   yesterday.
 *
 *   PUBLISH ONCE, READ FROM BOTH — what this does. The orders are written here, in this project, and
 *   the other app opens a second Firebase connection to this project to read them. One copy, one
 *   set of rules, and a production account signs in as itself rather than everybody sharing a key.
 *
 * WHAT IS PUBLISHED, AND WHAT DELIBERATELY IS NOT. Production needs to know what to make: the order
 * number, when it came, the SKUs, the sizes and the quantities. It does NOT need the customer's
 * name, address, phone or email, so none of that is written. Copying somebody's home address into a
 * second system because it happened to be in the same object is how personal data spreads without
 * anybody deciding to spread it. If production ever genuinely needs an address, that is a separate
 * decision with a reason attached — not a field that came along for the ride.
 *
 * Refunded and removed lines are dropped and cancelled orders are marked, because the one thing
 * worse than production not seeing an order is production making something nobody is owed.
 */
const PROD_CHUNK = 200;
let PROD_NOTES = {};          // order id → { c, by, at } — written by the production app, read here
let PROD_LOADED = false;

/** Only what somebody at a workbench has to know. */
function soProdRow(o) {
  const lines = o.items
    .filter(i => soSendQty(o.id, i.sku, soLive(i)) > 0)
    .map(i => ({
      sku: String(i.sku || ''),
      n: String(i.name || '').slice(0, 60),
      v: String(i.variant || '').slice(0, 40),
      q: soSendQty(o.id, i.sku, soLive(i)),
    }));
  const meta = SHOP_META[o.id] || {};
  return {
    id: o.id, no: o.no, at: o.at, ch: o.channel || 'Shopify',
    items: lines,
    // Where the order stands on OUR side, so production is not asked to make something Amazon is
    // already shipping. It is a copy of a live figure and it says when it was taken.
    route: soRoute({ ...o, mcf: soMcf(o).v, india: soIndia(o).v, cancelled: o.cancelled }),
    st: meta.s || '',
    cancelled: !!o.cancelled,
  };
}

/**
 * Publish the current order list for the production app.
 *
 * Runs after a fetch, not on a timer: the orders only change when Shopify is asked, so writing at
 * any other moment would just be the same documents again. Failure is reported and never thrown —
 * the Shopify tab working does not depend on the other app being fed.
 */
async function publishProdOrders() {
  try {
    const rows = SHOP.orders.concat(SHOP_IMP).map(soProdRow).filter(r => r.items.length || r.cancelled);
    const chunks = Math.ceil(rows.length / PROD_CHUNK) || 1;
    for (let i = 0; i < chunks; i++) {
      await setDoc(doc(db, 'prodorders', String(i)),
        { r: rows.slice(i * PROD_CHUNK, (i + 1) * PROD_CHUNK) });
    }
    await setDoc(doc(db, 'prod', 'orders'), {
      chunks, n: rows.length, from: SHOP.from || '', to: SHOP.to || '',
      at: serverTimestamp(), by: ME.email,
    });
    return rows.length;
  } catch (e) {
    soMsg('Orders are on screen, but the production app was not updated: ' + (e.message || e), true);
    return -1;
  }
}

/** Production's own words, or a dash. Never invented, never edited from this side. */
function soProdNoteCell(id) {
  const n = PROD_NOTES[id];
  const esc0 = s2 => String(s2 == null ? '' : s2).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  if (!n || !String(n.c || '').trim()) {
    // "Nothing written yet" and "we could not read their document" are different, and only the
    // second one is a fault. The dash never claims to be the first when it might be the second.
    return PROD_LOADED ? '<span class="muted">—</span>'
      : '<span class="muted" style="font-size:11px">not read yet</span>';
  }
  return esc0(String(n.c).slice(0, 60));
}
function soProdNoteWhy(id) {
  const n = PROD_NOTES[id];
  if (!n || !String(n.c || '').trim()) return PROD_LOADED ? 'Production has not written anything on this order.' : '';
  return String(n.c) + (n.by ? ' — ' + n.by : '') + (n.at ? ' · ' + n.at : '');
}

/** What production has written back. Read-only here — this app never edits their column. */
async function loadProdNotes() {
  try {
    const s = await getDoc(doc(db, 'prod', 'notes'));
    PROD_NOTES = s.exists() ? (s.data().m || {}) : {};
  } catch (e) { PROD_NOTES = {}; }
  PROD_LOADED = true;
}

/** The way AMAZON spells a code, when Amazon knows it. Otherwise the code exactly as it was typed. */
const soAmzCase = code => SHOP_STOCK_CASE[String(code || '').trim().toUpperCase()] || String(code || '').trim();
/** The key to look a code up by. Case-insensitive on purpose — only the SPELLING is preserved. */
const soAmzKey = sku => String(soAmzSku(sku) || '').trim().toUpperCase();

/**
 * Can Amazon fulfil this order, and how completely?
 *
 * Judged line by line against FBA stock, because a partly stocked order is a different decision
 * from a fully stocked one — one ships today, the other has to be split or waited on.
 *
 * A SKU the stock map has never heard of is 'unknown', NOT 'no'. Shopify-only products and typos
 * both land there, and telling somebody there is no stock for a SKU that Amazon has never been
 * asked about would be a guess dressed up as an answer.
 */
function soMcf(order) {
  // Refunded lines are OUT, not counted as a shortage. A line that came back is not something the
  // warehouse has to find — leaving it in kept whole orders sitting in "Need from production" for
  // goods nobody is owed.
  const lines = order.items.filter(i => soLive(i) > 0);
  if (!lines.length) {
    return order.items.length
      ? { v: 'none', why: 'Nothing left to send — every line is refunded or set to 0.' }
      : { v: 'unknown', why: 'No line items.' };
  }
  let ok = 0, short = 0, missing = 0;
  const detail = [];
  lines.forEach(i => {
    // Judged on the AMAZON sku, which is the Shopify one unless somebody has mapped it, and against
    // the quantity actually BEING SENT — not the ordered one, once those differ.
    const sku = soAmzSku(i.sku);                          // spelled Amazon's way, for people
    const key = soAmzKey(i.sku);                          // upper case, for looking up
    const shown = String(i.sku || '').trim().toUpperCase();
    const as = key !== shown ? ` (as ${sku})` : '';
    const need = soSendQty(order.id, i.sku, soLive(i));
    const live = soLive(i);
    const back = (Number(i.rq) || 0) ? `, ${i.rq} refunded` : '';
    const sending = need !== i.qty ? ` (sending ${need} of ${i.qty}${back})` : back;
    if (!need) return;                                   // set to 0 on purpose — not a shortage
    if (!key || !(key in SHOP_STOCK)) { missing++; detail.push(`${i.sku || i.name}${as}: not in FBA`); return; }
    const have = SHOP_STOCK[key];
    if (have >= need) { ok++; detail.push(`${shown}${as}: ${have} in FBA, need ${need}${sending}`); }
    else { short++; detail.push(`${shown}${as}: only ${have} in FBA, need ${need}${sending}`); }
  });
  const why = detail.join(' · ');
  if (missing === lines.length) return { v: 'unknown', why };
  if (ok === lines.length) return { v: 'yes', why };
  if (ok === 0 && short === 0) return { v: 'unknown', why };
  if (ok > 0) return { v: 'part', why };
  return { v: 'no', why };
}

/**
 * Can INDIA fulfil this order, and how completely? Same shape as soMcf so the two columns read the
 * same way — a person scanning the list is asking one question, "where can this ship from".
 *
 * Judged in SELLABLE units. The warehouse counts pieces and a pack of 2 is one orderable set, so a
 * line for ×1 needs 1 sellable unit, not 1 piece. Comparing an order line against pieces would call
 * a set-of-two "in stock" on a single loose piece.
 *
 * Quantities are the ones being SENT, so a line adjusted down asks India for less too.
 */

